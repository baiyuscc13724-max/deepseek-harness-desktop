import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
const port=Number(process.argv[2]||9337)
const stateFile=path.resolve(process.argv[3]||'.artifacts/computer-use-smoke-profile/browser-control.json')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function list(){return fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())}
async function shell(){for(let i=0;i<100;i++){try{const t=(await list()).find(x=>x.type==='page'&&/renderer(?:\\|\/)index\.html/i.test(decodeURIComponent(x.url)));if(t)return t}catch{}await wait(400)}throw new Error('shell not ready')}
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let id=0;const p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)),x=p.get(m.id);if(x){p.delete(m.id);m.error?x.j(new Error(m.error.message)):x.r(m.result)}});return{ws,send:(method,params={})=>new Promise((r,j)=>{const n=++id;p.set(n,{r,j});ws.send(JSON.stringify({id:n,method,params}))})}}
async function invoke(c,expression){const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});return r.result.value}
async function call(s,action,payload={}){const r=await fetch(`${s.origin}/action`,{method:'POST',headers:{Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'},body:JSON.stringify({scope:'computer',action,payload})});return{status:r.status,body:await r.json()}}
const target=await shell(),cdp=await connect(target.webSocketDebuggerUrl);let screenshot
try{
 await cdp.send('Runtime.enable')
 let state;for(let i=0;i<40;i++){try{state=JSON.parse(await readFile(stateFile,'utf8'));break}catch{}await wait(250)}if(!state)throw new Error('capability state missing')
 const initial=await call(state,'status');if(initial.body.result?.enabled!==false)throw new Error('Computer Use must default off')
 const disabled=await call(state,'screenshot');if(disabled.status===200||disabled.body.code!=='computer-use-disabled')throw new Error('disabled screenshot was not rejected')
 await invoke(cdp,`window.desktopHarness.setComputerUseEnabled(true)`)
 const shot=await call(state,'screenshot');screenshot=shot.body.result?.file;if(shot.status!==200||!screenshot||shot.body.result.scope!=='Harness Desktop window only')throw new Error(`screenshot failed ${JSON.stringify(shot)}`)
 await readFile(screenshot)
 const first=await call(state,'click',{x:100,y:100});const confirmationId=first.body.result?.confirmationId;if(!confirmationId||first.body.result.requiresConfirmation!==true)throw new Error('click did not require confirmation')
 await invoke(cdp,`window.desktopHarness.confirmComputerUseAction(${JSON.stringify(confirmationId)})`)
 const clicked=await call(state,'click',{x:100,y:100,confirmation_id:confirmationId});if(clicked.status!==200||!clicked.body.result?.completed)throw new Error(`confirmed click failed ${JSON.stringify(clicked)}`)
 const sensitive=await call(state,'type',{x:200,y:200,text:'password=NeverStoreThis123'});if(sensitive.status===200||sensitive.body.code!=='sensitive-input-blocked')throw new Error(`sensitive type not blocked ${JSON.stringify(sensitive)}`)
 const stopped=await call(state,'stop');if(stopped.body.result?.enabled!==false)throw new Error('stop did not disable control')
 console.log(JSON.stringify({passed:true,defaultOff:true,screenshotScope:shot.body.result.scope,confirmationRequired:true,sensitiveBlocked:sensitive.body.code,stopped:true},null,2))
}finally{if(screenshot)await rm(screenshot,{force:true}).catch(()=>{});cdp.ws.close()}
