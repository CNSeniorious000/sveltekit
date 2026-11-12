const { chromium, firefox, webkit } = require('playwright');
const http = require('http');
(async () => {
const server = http.createServer((req,res) => {res.setHeader('content-type','text/html'); res.end('<!doctype html><body>Native host</body>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const results=[];
for (const [name,engine] of Object.entries({chromium,firefox,webkit})) {
 const browser=await engine.launch({headless:true});
 for (const mode of ['initial','srcdoc-then-blank','http-then-blank','blank-fragment','srcdoc']) {
  const page=await browser.newPage(); await page.goto(origin);
  try {
   await page.evaluate(async ({mode,origin})=>{
    const f=document.createElement('iframe');f.id='target';
    const loaded=()=>new Promise(r=>f.onload=r);
    let p=loaded(); f.src=mode==='http-then-blank'?origin+'/empty':'about:blank';
    if(mode==='srcdoc-then-blank'||mode==='srcdoc')f.srcdoc='<body>stage</body>';
    document.body.append(f);await p;
    if(mode==='srcdoc-then-blank'||mode==='http-then-blank'){
     p=loaded();f.removeAttribute('srcdoc');f.src='about:blank';await p;
    }
    const s=f.contentDocument.createElement('script');
    const html='<body data-written="yes"><button id="push">Push</button><button id="back">Back</button><pre id="out"></pre></body>';
    s.textContent='setTimeout(()=>{document.open();document.write('+JSON.stringify(html)+');document.close();'+
     (mode==='blank-fragment'?'location.hash="bootstrap";':'')+
     'document.getElementById("push").onclick=()=>{let steps=[];for(let n=0;n<3;n++){history[n?"pushState":"replaceState"]({n},"");steps.push({n,length:history.length,href:location.href,state:history.state});}document.getElementById("out").textContent=JSON.stringify(steps)};document.getElementById("back").onclick=()=>history.back();},0)';
    f.contentDocument.body.append(s);
   },{mode,origin});
   const frame=await (await page.locator('#target').elementHandle()).contentFrame();
   await frame.locator('#push').click();
   const before=await frame.locator('#out').textContent();
   await frame.locator('#back').click().catch(()=>{});
   await new Promise(r=>setTimeout(r,700));
   const after=await frame.evaluate(()=>({href:location.href,state:history.state,body:document.body?.textContent,written:document.body?.dataset.written})).catch(e=>({error:String(e)}));
   results.push({name,mode,before:JSON.parse(before),host:page.url(),after});
  }catch(e){results.push({name,mode,error:String(e)})}
  await page.close();
 }
 await browser.close();
}
console.log(JSON.stringify(results,null,2)); require('fs').writeFileSync('results.json',JSON.stringify(results,null,2)); server.close();
})().catch(e=>{console.error(e);process.exitCode=1});
