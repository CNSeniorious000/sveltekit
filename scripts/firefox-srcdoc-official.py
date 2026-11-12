import json, time, threading, os
from http.server import HTTPServer, BaseHTTPRequestHandler
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><body>Host</body>')
server=HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
options=Options();options.add_argument('-headless');options.binary_location=os.environ['FIREFOX_BINARY']
driver=webdriver.Firefox(options=options)
print('BROWSER '+driver.capabilities['browserVersion'],flush=True)
cases=[('none',''),('replace','history.replaceState({probe:1},"")'),('push','history.pushState({probe:1},"")'),('hash','location.hash="probe";'),('nav-update','navigation.updateCurrentEntry({state:{probe:1}})'),('delay-replace','await new Promise(r=>setTimeout(r,500));history.replaceState({probe:1},"")')]
rows=[]
for sandbox in [False,True]:
 for name,operation in cases:
  driver.get('http://127.0.0.1:'+str(server.server_port))
  driver.execute_script("""
   window.messages=[];const f=document.createElement('iframe');if(arguments[0])f.sandbox='allow-scripts';
   addEventListener('message',e=>{if(e.source===f.contentWindow)window.messages.push(e.data)});
   const code='const report=(type,extra={})=>parent.postMessage({type,href:location.href,state:history.state,...extra},"*");report("load");document.querySelector("#operate").onclick=async()=>{try{'+arguments[1]+';report("operated")}catch(e){report("error",{error:String(e)})}};document.querySelector("#reload").onclick=()=>location.reload();';
   f.srcdoc='<!doctype html><button id="operate">Operate</button><button id="reload">Reload</button><script>'+code+'</'+'script>';document.body.append(f);
  """,sandbox,operation)
  WebDriverWait(driver,5).until(lambda d:d.execute_script('return window.messages.length')>0)
  driver.switch_to.frame(driver.find_element('tag name','iframe'));driver.find_element('id','operate').click();driver.switch_to.default_content()
  WebDriverWait(driver,5).until(lambda d:d.execute_script('return window.messages.length')>1)
  before=driver.execute_script('return window.messages')
  if not any(x['type']=='error' for x in before):
   driver.switch_to.frame(driver.find_element('tag name','iframe'));driver.find_element('id','reload').click();driver.switch_to.default_content()
   try:WebDriverWait(driver,3).until(lambda d:d.execute_script('return window.messages.filter(x=>x.type==="load").length')>1)
   except:pass
  messages=driver.execute_script('return window.messages');row={'sandbox':sandbox,'name':name,'reloaded':sum(x['type']=='load' for x in messages)>1,'messages':messages};rows.append(row);print(json.dumps(row),flush=True)
driver.quit();server.shutdown();print('RESULTS '+json.dumps(rows),flush=True)
