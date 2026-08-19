const port = Number(process.argv[2] || 9338)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function targets(){const r=await fetch(`http://127.0.0.1:${port}/json/list`);if(!r.ok)throw new Error(`CDP ${r.status}`);return r.json()}
async function findGuest(){for(let i=0;i<100;i++){try{const all=await targets();const guest=all.find(x=>x.type==='webview'&&/^http:\/\/127\.0\.0\.1:/u.test(x.url));if(guest)return guest}catch{}await wait(400)}throw new Error('guest not ready')}
async function connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let id=0;const pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(String(event.data)),p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.j(new Error(m.error.message)):p.r(m.result)});return{ws,send:(method,params={})=>new Promise((r,j)=>{const n=++id;pending.set(n,{r,j});ws.send(JSON.stringify({id:n,method,params}))})}}
const guest=await findGuest();const cdp=await connect(guest.webSocketDebuggerUrl)
try{
 await cdp.send('Runtime.enable')
 const probe=await cdp.send('Runtime.evaluate',{returnByValue:true,expression:`(() => {
   const visible = element => { const r=element.getBoundingClientRect(); const s=getComputedStyle(element); return r.width>30&&r.height>8&&s.visibility!=='hidden'&&s.display!=='none' }
   const candidates=[...document.querySelectorAll('p,li,pre,code,span,div')].filter(element=>visible(element)&&String(element.innerText||element.textContent||'').trim().length>=12)
   const element=candidates.find(e=>[...e.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim().length>=8))||candidates[0]
   if(!element)return {found:false,body:{userSelect:getComputedStyle(document.body).userSelect,webkitUserSelect:getComputedStyle(document.body).webkitUserSelect,appRegion:getComputedStyle(document.body).webkitAppRegion}}
   const textNode=[...element.childNodes].find(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim().length>=8)||element.firstChild
   const range=document.createRange(); range.selectNodeContents(textNode); const selection=getSelection();selection.removeAllRanges();selection.addRange(range)
   const selected=selection.toString().slice(0,100)
   document.body.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}))
   const clearedByPointer=selection.isCollapsed
   selection.removeAllRanges();selection.addRange(range)
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))
   const clearedByEscape=selection.isCollapsed
   const ancestors=[];for(let node=element;node&&node.nodeType===1;node=node.parentElement){const s=getComputedStyle(node);if(s.userSelect!=='auto'||s.webkitUserSelect!=='auto'||s.webkitAppRegion!=='none')ancestors.push({tag:node.tagName,class:String(node.className).slice(0,120),userSelect:s.userSelect,webkitUserSelect:s.webkitUserSelect,appRegion:s.webkitAppRegion})}
   return {found:true,text:String(textNode.textContent).trim().slice(0,100),selected,clearedByPointer,clearedByEscape,rect:element.getBoundingClientRect().toJSON(),style:{userSelect:getComputedStyle(element).userSelect,webkitUserSelect:getComputedStyle(element).webkitUserSelect,selectionColor:getComputedStyle(element,'::selection').color,selectionBackground:getComputedStyle(element,'::selection').backgroundColor},ancestors}
 })()`})
 console.log(JSON.stringify({guest:guest.url,probe:probe.result.value},null,2))
}finally{cdp.ws.close()}
