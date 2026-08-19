import { readFile } from 'node:fs/promises'
import path from 'node:path'
const port=Number(process.argv[2]||9336)
const stateFile=path.resolve(process.argv[3]||'.artifacts/memory-tools-smoke-profile/browser-control.json')
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function list(){return fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())}
async function shell(){for(let i=0;i<100;i++){try{const t=(await list()).find(x=>x.type==='page'&&/renderer(?:\\|\/)index\.html/i.test(decodeURIComponent(x.url)));if(t)return t}catch{}await wait(400)}throw new Error('shell not ready')}
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let id=0;const p=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data)),x=p.get(m.id);if(x){p.delete(m.id);m.error?x.j(new Error(m.error.message)):x.r(m.result)}});return{ws,send:(method,params={})=>new Promise((r,j)=>{const n=++id;p.set(n,{r,j});ws.send(JSON.stringify({id:n,method,params}))})}}
async function invoke(c,expression){const r=await c.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.result.subtype==='error')throw new Error(r.result.description);return r.result.value}
async function call(s,action,payload={}){const r=await fetch(`${s.origin}/action`,{method:'POST',headers:{Authorization:`Bearer ${s.token}`,'Content-Type':'application/json'},body:JSON.stringify({scope:'memory',action,payload})});return{status:r.status,body:await r.json()}}
const target=await shell(),cdp=await connect(target.webSocketDebuggerUrl)
try{
 await cdp.send('Runtime.enable')
 await invoke(cdp,`window.desktopHarness.setMemoryEnabled(true)`)
 await invoke(cdp,`window.desktopHarness.setMemoryPreferences({autoRecall:true,sensitivityMode:'reject'})`)
 await invoke(cdp,`window.desktopHarness.addMemory({kind:'preference',title:'运行验证',content:'用户偏好使用深色代码主题并保持简洁回答',tags:['smoke'],sensitivity:0,recallPolicy:'auto'})`)
 let state;for(let i=0;i<40;i++){try{state=JSON.parse(await readFile(stateFile,'utf8'));break}catch{}await wait(250)}
 if(!state)throw new Error('capability state missing')
 const status=await call(state,'status')
 const search=await call(state,'search',{query:'深色代码主题',max_results:3})
 if(status.status!==200||!status.body.result?.recallAllowed)throw new Error(`status failed ${JSON.stringify(status)}`)
 if(search.status!==200||search.body.result?.total!==1||search.body.result.hits[0].content.length>2000)throw new Error(`search failed ${JSON.stringify(search)}`)
 await invoke(cdp,`window.desktopHarness.setMemoryPreferences({autoRecall:false})`)
 const denied=await call(state,'search',{query:'深色'})
 if(denied.status===200||denied.body.code!=='memory-recall-disabled')throw new Error(`opt-out not enforced ${JSON.stringify(denied)}`)
 await invoke(cdp,`window.desktopHarness.deleteAllMemories({confirmed:true})`)
 await invoke(cdp,`window.desktopHarness.setMemoryEnabled(false)`)
 console.log(JSON.stringify({passed:true,total:search.body.result.total,matched:search.body.result.hits[0].matched,deniedAfterOptOut:denied.body.code},null,2))
}finally{cdp.ws.close()}
