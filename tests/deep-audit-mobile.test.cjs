'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { MobileControlBroker } = require('../electron/bridge/mobile-control-broker.cjs')
const root = path.resolve(__dirname, '..')
const runtime = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-runtime.js'), 'utf8')
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const flush = () => new Promise(resolve => setImmediate(resolve))

class Element {
  constructor(tag) { this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.attrs={}; this.listeners={}; this.value=''; this.hidden=false; this.classList={ toggle() {} } }
  append(...nodes) { for (const n of nodes) { n.parentElement=this; this.children.push(n) } }
  appendChild(n) { this.append(n); return n }
  insertBefore(n) { n.parentElement=this; this.children.unshift(n) }
  replaceChildren(...nodes) { this.children=[]; this.append(...nodes) }
  setAttribute(k,v) { this.attrs[k]=String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k]; if(k==='src') this.src='' }
  querySelectorAll(selector) { return this.children.flatMap(n => [...(selector==='button' && n.tagName==='BUTTON' ? [n] : []), ...n.querySelectorAll(selector)]) }
  querySelector() { return null }
  addEventListener(k,f) { this.listeners[k]=f }
  async fire(k,event={}) { return this.listeners[k]?.({ button:0, pointerId:1, clientX:50,clientY:50,preventDefault(){}, ...event }) }
  setPointerCapture() {}
  getBoundingClientRect() { return { left:0,top:0,width:100,height:100 } }
}
function deviceFixture(androidImpl) {
  const nodes=[], calls=[]
  const context={ module:{exports:{}}, ArrayBuffer, Date, console, document:{createElement(tag){const n=new Element(tag);nodes.push(n);return n}}, window:{setTimeout(){return 1},clearTimeout(){},URL:{revokeObjectURL(){}}} }
  vm.runInNewContext(fs.readFileSync(path.join(root,'renderer/device-workspace.js'),'utf8'),context)
  const device=context.module.exports.create({api:{desktopDeviceAction:async()=>({ready:false}),desktopAndroidAction:async args=>{ calls.push(args); if(args.action==='devices')return {devices:[{serial:'A',state:'device'},{serial:'B',state:'device'}]};return androidImpl(args) }}})
  device.activate()
  const androidCard=nodes.find(n=>n.attrs['aria-label']==='在右侧栏打开 Android 设备')
  const select=nodes.find(n=>n.attrs['aria-label']==='选择 Android 真机或模拟器')
  const image=nodes.find(n=>n.alt==='当前 Android 设备的完整手机画面')
  return { device,nodes,calls,select,image,open:()=>androidCard.fire('click') }
}

test('device switch ignores late old preview and gestures cannot cross devices',async()=>{
  const late=deferred();let phase=0
  const f=deviceFixture(async args=>{
    if(args.action==='switchDevice' && phase===1)return late.promise
    return {device:args.payload.device,streamUrl:`http://fixture/${args.payload.device}`}
  })
  await f.open()
  await f.image.fire('pointerdown')
  phase=1;f.select.value='B';await f.select.fire('change')
  await f.image.fire('pointerup')
  assert.equal(f.calls.filter(c=>c.action==='control').length,0,'pointer started on A must not dispatch during switch')
  f.device.deactivate();late.resolve({device:'B',streamUrl:'http://fixture/B'});await flush()
  assert.equal(f.image.src,'','late switch must not resurrect inactive preview')
})

test('reverse-order device switch replies cannot select the older device',async()=>{
  const a=deferred(),b=deferred(); let pending=false
  const f=deviceFixture(async args=>pending ? (args.payload.device==='A'?a.promise:b.promise) : {device:'A',streamUrl:'http://fixture/A'})
  await f.open();pending=true
  f.select.value='B';await f.select.fire('change')
  f.select.value='A';await f.select.fire('change')
  a.resolve({device:'A',streamUrl:'http://fixture/A'});await flush()
  b.resolve({device:'B',streamUrl:'http://fixture/B'});await flush()
  assert.equal(f.select.value,'A')
  assert.equal(f.image.src,'http://fixture/A')
  f.device.dispose()
})

test('secondary pointers and cancellation cannot create phantom device taps',async()=>{
  const f=deviceFixture(async args=>({device:args.payload.device,streamUrl:`http://fixture/${args.payload.device}`}))
  await f.open(); await f.image.fire('pointerdown',{pointerId:1})
  await f.image.fire('pointerup',{pointerId:2})
  assert.equal(f.calls.filter(c=>c.action==='control').length,0)
  await f.image.fire('pointercancel',{pointerId:1}); await f.image.fire('pointerup',{pointerId:1})
  assert.equal(f.calls.filter(c=>c.action==='control').length,0)
  f.device.dispose()
})

function uploadFixture() {
  const wait=deferred(), states=[], uploads=[]; let draft='session B draft'
  const input={tagName:'TEXTAREA',value:draft,getAttribute:()=> 'active',focus(){},dispatchEvent(){}}
  const card=new Element('div');card.querySelector=s=>s.includes('composer-input')?input:null
  const document={querySelector:()=>card,createElement:tag=>new Element(tag)}
  const window={__harnessMobileCurrentSessionId:'A'}
  const ctx={window,document,console,Event:class{},CSS:{escape:v=>v},HTMLTextAreaElement:class{},composerInput:()=>input,composerInputUnavailable:()=>false,legacyComposerTextarea:()=>true,composerInputText:n=>n.value,fetch:async url=>{uploads.push(url);await wait.promise;return {status:201,json:async()=>({ok:true,file:{path:'uploads/A.pdf',name:'A.pdf',size:10}})}}}
  vm.runInNewContext(runtime.slice(runtime.indexOf('  const installDocumentUploadBridge ='),runtime.indexOf('  const installThemeBridge ='))+';installDocumentUploadBridge()',ctx)
  return {window,input,card,states,uploads,wait,start:()=>window.__harnessMobileReceiveDocuments([{name:'A.pdf',size:10},{name:'B.pdf',size:10}],(...args)=>states.push(args))}
}

test('document upload finishing after session switch cannot append to another composer',async()=>{
  const f=uploadFixture();const result=f.start();await flush();f.window.__harnessMobileCurrentSessionId='B';f.wait.resolve()
  assert.equal(await result,false)
  assert.equal(f.input.value,'session B draft')
  assert.equal(f.card.children.length,0)
  assert.equal(f.uploads.length,1,'stop queued uploads on context change')
  assert.equal(f.states.at(-1)[0],'error')
})

test('control broker polls cancel during active command without dispatching queued mutations',()=>{
  let n=0;const b=new MobileControlBroker({idFactory:()=>`fixture-command-${++n}`})
  b.reportStatus('A',{protocolVersion:1,enabled:true,ready:true,capabilities:['tap']})
  b.reportStatus('B',{protocolVersion:1,enabled:true,ready:true,capabilities:['tap']})
  const active=b.enqueue('A',{action:'tap',payload:{x:1,y:1}})
  assert.equal(b.poll('A',1).command.id,active.id)
  const next=b.enqueue('A',{action:'tap',payload:{x:2,y:2}})
  assert.equal(b.poll('A',1,true).command,null,'active command must fence normal dispatch')
  b.cancel(active.id)
  assert.equal(b.poll('A',1,true).command.type,'cancel')
  assert.throws(()=>b.reportResult('B',{id:active.id,ok:true}),/未知/)
  b.reportResult('A',{id:active.id,ok:false,code:'COMMAND_CANCELLED'})
  assert.equal(b.poll('A',1).command.id,next.id)
})

test('control broker 50 isolated device stop/cancel cycles retain honest receipts',()=>{
  let now=1_000,n=0;const b=new MobileControlBroker({now:()=>now,idFactory:()=>`fixture-command-${++n}`})
  for(let i=0;i<50;i++){
    const device=`device-${i}`;b.reportStatus(device,{protocolVersion:1,enabled:true,ready:true,capabilities:['tap']})
    const c=b.enqueue(device,{action:'tap',payload:{x:1,y:1}});b.poll(device,1);b.cancel(c.id);b.stop(device)
    assert.equal(b.result(c.id),null);assert.equal(b.poll(device,1).command.type,'stop')
    b.reportResult(device,{id:c.id,ok:false,code:'DESKTOP_STOP'});assert.equal(b.result(c.id).ok,false)
    assert.equal(b.poll(device,1).command,null)
  }
  assert.equal(b.pending.size,0);assert.equal(b.queues.size,0)
})

function pluginFixture(fetchImpl) {
  let tool;const calls=[]
  const ctx={path,process:{env:{HARNESS_MOBILE_SYNC_STATE_FILE:'/fixture/mobile.json'}},readFile:async()=>JSON.stringify({version:1,port:12345,bearer:'f'.repeat(40),generation:'a'.repeat(32)}),defineTool:t=>t,fetch:async(url,init)=>{calls.push({url,init});return fetchImpl(url,init)},AbortSignal,AbortController,setTimeout,clearTimeout,console}
  const source=fs.readFileSync(path.join(root,'plugins/dsh-mobile-control/lib/index.js'),'utf8').replace(/^import .*$/gm,'').replace(/^export .*$/gm,'')
  vm.runInNewContext(source+';globalThis.register=apply;globalThis.wait=delay',ctx)
  ctx.register({tools:{register:t=>{tool=t}}})
  return {ctx,calls,execute:(signal)=>tool.execute({action:'tap',payload:{x:1,y:1}},{signal})}
}
const json = value => new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})

test('mobile tool aborted during state load never submits a phone action',async()=>{
  const state=deferred();const abort=new AbortController()
  const f=pluginFixture(async url=>{if(url.endsWith('/desktop-state')){await state.promise;return json({control:{devices:[{id:'fixture-A',ready:true}]}})};if(url.endsWith('/desktop-command'))return json({command:{id:'fixture-command',action:'tap',timeoutMs:1000}});return json({pending:false,result:{ok:true}})})
  const work=f.execute(abort.signal);await flush();abort.abort(new Error('fixture abort'));state.resolve()
  await assert.rejects(work,/fixture abort/)
  assert.equal(f.calls.filter(c=>c.url.endsWith('/desktop-command')).length,0)
})

test('mobile tool delay removes its abort listener after every completed wait',async()=>{
  const f=pluginFixture(async()=>json({}));const listeners=new Set()
  const signal={aborted:false,addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)}
  for(let i=0;i<30;i++)await f.ctx.wait(0,signal)
  assert.equal(listeners.size,0)
})

function p2pFixture() {
  const sockets=[],events=[],imports=[],connections=[];let encryption=null, decryption=null, digest=null
  class PeerConnection {
    constructor(){connections.push(this);this.connectionState='new'}
    close(){this.connectionState='closed'}
    createDataChannel(){return {close(){},readyState:'open'}}
    async createOffer(){return {type:'offer',sdp:'fixture'}}
    async setLocalDescription(value){this.localDescription={toJSON:()=>value}}
    async setRemoteDescription(){}
    async addIceCandidate(){}
  }
  class Socket { static OPEN=1;static CLOSING=2;constructor(url){this.url=url;this.readyState=1;this.bufferedAmount=0;this.sent=[];sockets.push(this)}send(data){this.sent.push(data)}close(){this.readyState=3} }
  const ctx={require:()=>({ipcRenderer:{on(){},send:(_channel,event)=>events.push(event)}}),Buffer,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,WebSocket:Socket,RTCPeerConnection:PeerConnection,crypto:{getRandomValues:array=>array.fill(1),subtle:{importKey:()=>{const d=deferred();imports.push(d);return d.promise},encrypt:async()=>encryption ? encryption.promise : new Uint8Array([1,2]).buffer,decrypt:async()=>decryption.promise,digest:async()=>digest ? digest.promise : new Uint8Array(32).buffer}},console}
  vm.runInNewContext(fs.readFileSync(path.join(root,'renderer/native-p2p.js'),'utf8')+';globalThis.api={start,stop,sendSignal,attachChannel,ensurePeer,createOffer,handleSignal,decryptSignal,hasPeer:id=>peers.has(id),nonces:()=>seenSignalNonces.size,setPeer:(id,peer)=>peers.set(id,peer),enable:()=>{signalingEnabled=true}}',ctx)
  return {api:ctx.api,sockets,events,imports,connections,encryptWait:()=>{encryption=deferred();return encryption},decryptWait:()=>{decryption=deferred();return decryption},digestWait:()=>{digest=deferred();return digest},config:name=>({relayUrl:`wss://${name}.fixture.invalid`,roomId:name.repeat(43).slice(0,43),signalKey:Buffer.alloc(32).toString('base64url')})}
}

test('P2P key import settling after stop must not create a socket',async()=>{
  const f=p2pFixture();const work=f.api.start(f.config('a'));f.api.stop();f.imports[0].resolve({fixture:true})
  await work;assert.equal(f.sockets.length,0)
})

test('P2P reversed key imports preserve only the newest start',async()=>{
  const f=p2pFixture();const a=f.api.start(f.config('a')),b=f.api.start(f.config('b'))
  f.imports[1].resolve({key:'b'});await b;f.imports[0].resolve({key:'a'});await a
  assert.equal(f.sockets.length,1);assert.equal(f.sockets[0].url,'wss://b.fixture.invalid')
  f.api.stop()
})

test('P2P encrypted signal cannot leak to a replacement socket after async crypto',async()=>{
  const f=p2pFixture();const start=f.api.start(f.config('a'));f.imports[0].resolve({});await start;f.api.enable()
  const gate=f.encryptWait();const send=f.api.sendSignal('a'.repeat(16),'offer')
  const next=f.api.start(f.config('b'));f.imports[1].resolve({});await next;f.api.enable()
  gate.resolve(new Uint8Array([1,2]).buffer);assert.equal(await send,false)
  assert.equal(f.sockets[1].sent.length,0);f.api.stop()
})

test('P2P old data-channel callback cannot emit packets after peer removal',()=>{
  const f=p2pFixture();const id='a'.repeat(16),peer={connection:{close(){}}},channel={close(){},readyState:'open'}
  f.api.setPeer(id,peer);f.api.attachChannel(id,peer,channel);f.api.stop()
  channel.onmessage({data:new Uint8Array([1,2,3]).buffer})
  assert.equal(f.events.filter(e=>e.type==='packet').length,0)
})

test('P2P old peer callbacks cannot close or signal a same-ID replacement',async()=>{
  const f=p2pFixture(),id='a'.repeat(16)
  const old=f.api.ensurePeer(id);f.api.stop();const next=f.api.ensurePeer(id)
  old.connection.onconnectionstatechange()
  assert.equal(f.api.hasPeer(id),true,'closed old connection must not remove replacement')
  old.connection.onicecandidate({candidate:{toJSON:()=>({candidate:'old'})}})
  old.connection.ondatachannel({channel:{close(){},readyState:'open'}})
  assert.equal(old.pendingLocalIce.length,0)
  assert.equal(next.channel,null)
  assert.equal(f.events.filter(e=>e.type==='peer-left').length,0)
  f.api.stop()
})

test('P2P decrypted old-generation signal cannot poison replacement replay state',async()=>{
  const f=p2pFixture();const start=f.api.start(f.config('a'));f.imports[0].resolve({});await start
  const wait=f.decryptWait();const envelope=Buffer.alloc(32,1).toString('base64url')
  const work=f.api.decryptSignal(envelope);f.api.stop()
  wait.resolve(Uint8Array.from([1,2,0,0,0,0,123,125]).buffer)
  await assert.rejects(work,/stale|changed/i);assert.equal(f.api.nonces(),0)
})

test('P2P answer digest resolving after stop cannot emit a new session',async()=>{
  const f=p2pFixture(),id='a'.repeat(16);const start=f.api.start(f.config('a'));f.imports[0].resolve({});await start
  const peer=f.api.ensurePeer(id);peer.desktopNonce=Buffer.alloc(32,1).toString('base64url')
  const wait=f.digestWait();const work=f.api.handleSignal(id,{kind:'answer',source:id,target:'desktop',desktopNonce:peer.desktopNonce,mobileNonce:Buffer.alloc(32,2).toString('base64url'),description:{type:'answer',sdp:'fixture'}})
  f.api.stop();wait.resolve(new Uint8Array(32).buffer);await work
  assert.equal(f.events.filter(e=>e.type==='session').length,0)
})

const {DesktopDeviceProvider}=require('../electron/bridge/desktop-device-stream.cjs')
function desktopFixture() {
  const state={enabled:true,ready:true,generation:1,authorization:{scope:'session'}}, calls=[]
  const native={setUnlimited(){},capabilities:()=>({native:{windowEnumeration:true}}),desktopBounds:()=>({x:0,y:0,width:100,height:100}),windows:async()=>[{hwnd:7,width:100,height:100}],desktopScreenshot:async()=>({width:100,height:100}),screenshot:async()=>({width:100,height:100}),globalClick:async()=>calls.push('click'),globalType:async()=>calls.push('type')}
  const provider=new DesktopDeviceProvider({computerUse:native,getControlState:()=>state,frameEncoder:async()=>({width:100,height:100,png:Buffer.from('fixture')})})
  return {state,calls,native,provider}
}

test('desktop device late capture cannot restore a frame after target switch or clear',async()=>{
  for(const action of ['switch','clear']) {
    const f=desktopFixture();await f.provider.targets();const wait=deferred();f.native.desktopScreenshot=()=>wait.promise
    const work=f.provider.captureFrame();await flush()
    if(action==='switch')await f.provider.selectTarget('window:7');else f.provider.clearFrame()
    wait.resolve({width:100,height:100});await assert.rejects(work,/stale|changed|失效|变化/)
    assert.equal(f.provider.lastFrame,null)
  }
})

test('desktop device rejects an old authorization-generation frame before pointer input',async()=>{
  const f=desktopFixture();await f.provider.captureFrame();f.state.generation++
  await assert.rejects(f.provider.pointer('click',{x:1,y:1}),/frame|帧|失效/)
  assert.deepEqual(f.calls,[])
})

test('desktop device rechecks authorization after target await before keyboard input',async()=>{
  const f=desktopFixture();const wait=deferred();f.native.windows=()=>wait.promise
  const work=f.provider.keyboard('fixture');await flush();f.state.enabled=false;f.state.generation++;wait.resolve([])
  await assert.rejects(work);assert.deepEqual(f.calls,[])
})

test('late P2P socket errors and failed key imports cannot mark replacement failed',async()=>{
  const f=p2pFixture();const first=f.api.start(f.config('a'));f.imports[0].resolve({});await first
  const old=f.sockets[0];const next=f.api.start(f.config('b'));f.imports[1].resolve({});await next
  const count=f.events.length;old.onerror();assert.equal(f.events.length,count)
  const stale=f.api.start(f.config('c'));f.api.stop();f.imports[2].reject(new Error('old key import failed'))
  await stale
})

test('desktop reversed captures keep the newest frame and stale saved preview cannot return',async()=>{
  const f=desktopFixture();await f.provider.targets();const a=deferred(),b=deferred();let n=0
  f.native.desktopScreenshot=()=>++n===1?a.promise:b.promise
  const first=f.provider.captureFrame({force:true});await flush();const second=f.provider.captureFrame({force:true});await flush()
  b.resolve({width:80,height:80});const recent=await second
  a.resolve({width:100,height:100});await assert.rejects(first,/失效/)
  assert.equal(f.provider.lastFrame.public.sequence,recent.sequence)
  const save=deferred();f.provider.previewStore={save:()=>save.promise}
  const delivery=f.provider.captureFrame({delivery:'preview-file'});await flush();f.provider.clearFrame();save.resolve({path:'fixture-only'})
  await assert.rejects(delivery,/失效|变化/)
})

test('Android and iOS runtime stay byte-identical after isolation repair',()=>{
  assert.equal(runtime,fs.readFileSync(path.join(root,'mobile/ios/HarnessMobile/Resources/mobile-runtime.js'),'utf8'))
})
