import { firefox } from '@playwright/test';
import { createServer } from 'node:http';
const server = createServer((req,res)=>{res.writeHead(200, {'content-type':'text/html'});res.end('<!doctype html><body>Host</body>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await firefox.launch();
const cases=[
 ['none',''],
 ['replace','history.replaceState({probe:1},"")'],
 ['push','history.pushState({probe:1},"")'],
 ['replace-null','history.replaceState(null,"")'],
 ['replace-empty-url','history.replaceState({probe:1},"","")'],
 ['hash-only','location.hash="probe";await pause()'],
 ['hash-before-replace','location.hash="probe";await pause();history.replaceState({probe:1},"")'],
 ['replace-before-hash','history.replaceState({probe:1},"");location.hash="probe";await pause()'],
 ['replace-location-hash-first','location.replace("about:srcdoc#probe");await pause();history.replaceState({probe:1},"")'],
 ['replace-location-hash-after','history.replaceState({probe:1},"");location.replace("about:srcdoc#probe");await pause()'],
 ['same-hash-before-replace','location.hash=location.hash;await pause();history.replaceState({probe:1},"")'],
 ['navigation-update','navigation.updateCurrentEntry({state:{probe:1}})'],
 ['navigation-replace','await navigation.navigate("about:srcdoc#probe",{history:"replace",state:{probe:1}}).finished'],
 ['navigation-push','await navigation.navigate("about:srcdoc#probe",{state:{probe:1}}).finished'],
 ['replace-then-navigation-update','history.replaceState({probe:1},"");navigation.updateCurrentEntry({state:{probe:1}})'],
 ['load-delay-replace','await new Promise(r=>setTimeout(r,500));history.replaceState({probe:1},"")']
];
console.log('BROWSER '+browser.version());
const rows=[];
for(const sandbox of [false,true]) for(const [name,operation] of cases){
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(({sandbox,operation})=>{
 window.messages=[];
 const f=document.createElement('iframe');if(sandbox)f.sandbox='allow-scripts';
 addEventListener('message',e=>{if(e.source===f.contentWindow)window.messages.push(e.data)});
 const js=`const pause=()=>new Promise(r=>setTimeout(r,100));const report=(type,extra={})=>parent.postMessage({type,href:location.href,state:history.state,navState:window.navigation?.currentEntry?.getState(),...extra},"*");report("load");document.querySelector("#operate").onclick=async()=>{try{${operation};report("operated")}catch(e){report("operation-error",{error:String(e)})}};document.querySelector("#reload").onclick=()=>location.reload();`;
 f.srcdoc='<!doctype html><button id="operate">Operate</button><button id="reload">Reload</button><script>'+js+'</'+'script>';
 document.body.append(f);
 },{sandbox,operation});
 const f=page.frameLocator('iframe');
 await f.locator('#operate').click();
 try{await page.waitForFunction(()=>window.messages.some(m=>m.type==='operated'||m.type==='operation-error'),{},{timeout:3000})}catch{console.log('OPERATION_TIMEOUT '+JSON.stringify({sandbox,name}));}
 const before=await page.evaluate(()=>window.messages);
 if(!before.some(m=>m.type==='operation-error')){
 try{await f.locator('#reload').click({timeout:2000});await page.waitForFunction(()=>window.messages.filter(m=>m.type==='load').length>1,{},{timeout:2500});}catch{}
 }
 let after;try{after=await page.evaluate(()=>window.messages)}catch(e){after=[{error:String(e)}]}
 const row={sandbox,name,reloaded:after.filter(m=>m.type==='load').length>1,messages:after};rows.push(row);console.log(JSON.stringify(row));await page.close();
}
console.log('RESULTS '+JSON.stringify(rows));await browser.close();await new Promise(r=>server.close(r));
