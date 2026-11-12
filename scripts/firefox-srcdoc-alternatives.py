import json, threading, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait
pages={}
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(pages.get(self.path,'<!doctype html><body>Host</body>').encode())
server=HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
options=Options();options.add_argument('-headless');options.binary_location=os.environ['FIREFOX_BINARY'];driver=webdriver.Firefox(options=options)
print('BROWSER '+driver.capabilities['browserVersion'],flush=True)
for sandbox in [False,True]:
 for mode in ['srcdoc-normal','srcdoc-parent-reset','srcdoc-child-reset','http','blob-host','blob-child']:
  reload="location.reload()"
  if mode=='srcdoc-parent-reset':reload='parent.postMessage({type:"reset-srcdoc"},"*")'
  if mode=='srcdoc-child-reset':reload='frameElement.srcdoc=frameElement.srcdoc'
  code='const report=(type,extra={})=>parent.postMessage({type,href:location.href,state:history.state,length:history.length,...extra},"*");report("load");document.querySelector("#operate").onclick=()=>{history.replaceState({probe:1},"");history.pushState({probe:2},"");report("operated")};document.querySelector("#reload").onclick=()=>{try{'+reload+'}catch(e){report("error",{error:String(e)})}};'
  if mode=='blob-child':code='if(location.protocol==="about:"){const blob=URL.createObjectURL(new Blob([document.documentElement.outerHTML],{type:"text/html"}));location.replace(blob)}else{'+code+'}'
  html='<!doctype html><button id="operate">Operate</button><button id="reload">Reload</button><script>'+code+'</'+'script>'
  pages['/document']=html;driver.get('http://127.0.0.1:'+str(server.server_port))
  driver.execute_script("""
   window.messages=[];const f=document.createElement('iframe');if(arguments[0])f.sandbox='allow-scripts';
   addEventListener('message',e=>{if(e.source!==f.contentWindow)return;if(e.data.type==='reset-srcdoc')f.srcdoc=f.srcdoc;else window.messages.push(e.data)});
   if(arguments[1]==='http')f.src='/document';else if(arguments[1]==='blob-host')f.src=URL.createObjectURL(new Blob([arguments[2]],{type:'text/html'}));else f.srcdoc=arguments[2];document.body.append(f);
  """,sandbox,mode,html)
  try:WebDriverWait(driver,5).until(lambda d:d.execute_script('return window.messages.length')>0)
  except Exception as e:print(json.dumps({'sandbox':sandbox,'mode':mode,'initError':str(e)}),flush=True);continue
  driver.switch_to.frame(driver.find_element('tag name','iframe'));driver.find_element('id','operate').click();driver.switch_to.default_content()
  WebDriverWait(driver,5).until(lambda d:d.execute_script('return window.messages.length')>1)
  driver.switch_to.frame(driver.find_element('tag name','iframe'))
  try:driver.find_element('id','reload').click()
  except Exception as e:print('RELOAD_EXCEPTION '+str(e).splitlines()[0],flush=True)
  driver.switch_to.default_content()
  try:WebDriverWait(driver,3).until(lambda d:d.execute_script('return window.messages.filter(x=>x.type==="load").length')>1)
  except:pass
  messages=driver.execute_script('return window.messages');print(json.dumps({'sandbox':sandbox,'mode':mode,'reloaded':sum(x['type']=='load' for x in messages)>1,'messages':messages}),flush=True)
driver.quit();server.shutdown()
