'use strict'
// Offline cross-language integration fixture, not a relay/application reimplementation.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), http = require('node:http')
const crypto = require('node:crypto'), assert = require('node:assert/strict'), { once } = require('node:events')
const { spawn } = require('node:child_process'), { performance } = require('node:perf_hooks')
const root = path.resolve(__dirname, '../..'), artifactRoot = path.join(root, '.artifacts/deep-audit-mobile-chain')
const run = path.join(artifactRoot, `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`)
fs.mkdirSync(run, { recursive: true }); const home = path.join(run, 'home'); fs.mkdirSync(home)
// No inherited DSH auth/session/plugin/Node preload/proxy/Java-agent credentials.
const keep = new Set(['PATH','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS'])
for (const key of Object.keys(process.env)) if (!keep.has(key.toUpperCase())) delete process.env[key]
Object.assign(process.env, { HOME: home, USERPROFILE: home, TEMP: home, TMP: home, APPDATA: home, LOCALAPPDATA: home, DSH_HOME: home, JAVA_HOME: 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot', ANDROID_HOME: 'D:\\Android\\Sdk', GRADLE_USER_HOME: path.join(home, 'unused-gradle-home') })
const now = () => performance.timeOrigin + performance.now(), hash = b => crypto.createHash('sha256').update(b).digest('hex')
const events = [], sources = [], children = [], pendingTimers = new Set(), allowedPorts = new Set()
let allocating = false, profile = 'normal', router, relayServer, core, controlServer, gateway, adapter, failure
function log(stage, extra = {}) { events.push({ stage, at: now(), ...extra }) }
function later(fn, ms) { const t = setTimeout(() => { pendingTimers.delete(t); fn() }, ms); pendingTimers.add(t); return t }
const connect = net.Socket.prototype.connect, listen = net.Server.prototype.listen
net.Socket.prototype.connect = function (...args) { const [o] = Array.isArray(args[0]) ? args[0] : net._normalizeArgs(args); if (o.path || o.host !== '127.0.0.1' || !allowedPorts.has(Number(o.port))) { log('networkFenceReject',{host:o.host||null,port:Number.isFinite(Number(o.port))?Number(o.port):null,ipc:Boolean(o.path)}); throw new Error('fixture network fence rejected non-fixture connect') }; return connect.apply(this, args) }
net.Server.prototype.listen = function (...args) { const [o] = net._normalizeArgs(args); if (!allocating || o.path || o.host !== '127.0.0.1' || Number(o.port) !== 0) throw new Error('fixture listen fence rejected non-owned allocation'); return listen.apply(this, args) }
async function bind(server) { allocating = true; try { server.listen(0, '127.0.0.1'); await once(server, 'listening') } finally { allocating = false }; const port = server.address().port; allowedPorts.add(port); return port }
async function reserve() { const s = net.createServer(); const port = await bind(s); await new Promise(r => s.close(r)); allowedPorts.delete(port); return port }
function readSource(relative) { const absolute = path.join(root, relative); sources.push({ path: relative, sha256: hash(fs.readFileSync(absolute)) }); return absolute }
function artifact(name, data) { fs.writeFileSync(path.join(run, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2)) }
function child(command, args, timeout) { return new Promise((resolve,reject) => {
  const c=spawn(command,args,{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});children.push(c)
  const t=setTimeout(()=>{c.kill();reject(new Error('bounded JVM subprocess deadline exceeded'))},timeout)
  c.once('error',e=>{clearTimeout(t);reject(e)});c.once('exit',(code,signal)=>{clearTimeout(t);code===0?resolve():reject(new Error(`JVM subprocess exit ${code} ${signal||''}`))})
}) }
function cachedJar(group, name, version) {
  const base=path.join('C:\\Users\\Administrator\\.gradle\\caches\\modules-2\\files-2.1',group,name,version)
  const values=[];for(const dir of fs.readdirSync(base,{withFileTypes:true}))if(dir.isDirectory())for(const file of fs.readdirSync(path.join(base,dir.name)))if(file===`${name}-${version}.jar`)values.push(path.join(base,dir.name,file))
  assert.equal(values.length,1,`one offline ${name} jar required`);return values[0]
}
const barriers = new Map(), reached = new Set()
function reach(name) { reached.add(name);for(const resolve of barriers.get(name)||[])resolve();barriers.delete(name) }
function barrier(name) { if(reached.has(name))return Promise.resolve();return new Promise((resolve,reject)=>{const t=later(()=>reject(new Error(`barrier timeout ${name}`)),6500);const done=()=>{clearTimeout(t);pendingTimers.delete(t);resolve()};barriers.set(name,[...(barriers.get(name)||[]),done])}) }
const bodyIds = new Map()
function packet(raw, codec) {
  const buffer=Buffer.from(raw), peer=buffer.subarray(0,8).toString('hex'), frame=codec.decode(buffer.subarray(8)), stream=`${peer}:${frame.streamId}`
  const match=frame.payload.toString('latin1').match(/X-Fixture-Id: ([a-z0-9-]+)/i);if(match)bodyIds.set(stream,match[1])
  return {packet:hash(buffer.subarray(8)),stream,streamId:frame.streamId,type:frame.type,bytes:buffer.length,id:bodyIds.get(stream)||null}
}
function quantile(values) { const a=values.filter(Number.isFinite).sort((a,b)=>a-b);const p=n=>a.length?+a[Math.min(a.length-1,Math.ceil(n*a.length)-1)].toFixed(3):null;return {n:a.length,p50:p(.5),p95:p(.95),p99:p(.99),max:p(1)} }
async function main() {
  const WebSocket=require('ws'), {createHealthServer,createRelayRouter}=require('../../services/wss-relay/server.cjs')
  const {WssRelayAdapter}=require('../../electron/bridge/sync-transports/wss-relay-adapter.cjs'), {RelayTunnelCodec}=require('../../electron/bridge/relay-tunnel-codec.cjs')
  const {MobileSyncService,COOKIE_NAME}=require('../../electron/bridge/mobile-sync-service.cjs'), {MobileSyncStore}=require('../../electron/store/mobile-sync-store.cjs')
  for(const file of ['services/wss-relay/server.cjs','electron/bridge/sync-transports/wss-relay-adapter.cjs','electron/bridge/relay-tunnel-codec.cjs','electron/bridge/mobile-sync-service.cjs','electron/store/mobile-sync-store.cjs','tests/fixtures/deep-audit-mobile-chain.cjs'])readSource(file)
  readSource('mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java')
  const src='mobile/android/app/src/main/java/io/harnessdesktop/mobile/'
  const javaSources=['HarnessWebProxy.java','WssRelayClient.java','RelayTunnelCodec.java','PairingProfile.java','PairingLinkValidator.java','ManifestDownload.java','MobileAssetCache.java'].map(f=>readSource(src+f))
  const testSources=['DeepAuditMobileChainTest.java','DeepAuditMobileManifestPagingTest.java'].map(f=>readSource('mobile/android/app/src/test/java/io/harnessdesktop/mobile/'+f))
  const jars=[cachedJar('com.squareup.okhttp3','okhttp','4.12.0'),cachedJar('com.squareup.okio','okio-jvm','3.6.0'),cachedJar('org.jetbrains.kotlin','kotlin-stdlib','2.1.0'),cachedJar('org.json','json','20240303'),path.join(process.env.ANDROID_HOME,'platforms/android-35/android.jar')]
  const dependencies=jars.map(p=>({path:p,sha256:hash(fs.readFileSync(p))}))
  // Only logging is stubbed: SDK android.jar's Log.w throws in a desktop JVM.
  const stub=path.join(run,'Log.java');fs.writeFileSync(stub,'package android.util; public final class Log { public static int w(String a,String b){System.err.println("[Android Log] "+a+": "+b);return 0;} public static int i(String a,String b){return 0;} }\n')
  const classes=path.join(run,'classes');fs.mkdirSync(classes);javaSources.push(stub)
  const jvm=path.join(process.env.JAVA_HOME,'bin'), cp=[classes,...jars].join(path.delimiter)
  const compileArgs=[`-J-Duser.home=${home}`,`-J-Djava.io.tmpdir=${home}`,'-encoding','UTF-8','--release','17','-cp',[jars.at(-1),...jars.slice(0,-1)].join(path.delimiter),'-d',classes,...javaSources]
  artifact('source-manifest.json',{sources,dependencies,loggingStubSha256:hash(fs.readFileSync(stub)),isolation:{home,gradle:'not launched; only explicitly selected cached jars read, no gradle.properties/init.d',network:'exact owned fixture ports only; no GUI/IPC/WAN'},compileArgs})
  await child(path.join(jvm,'javac.exe'),compileArgs,30000)
  // Match Gradle's split: production sees Android checked JSONException; JVM fixture uses org.json implementation.
  const testCompileArgs=[`-J-Duser.home=${home}`,`-J-Djava.io.tmpdir=${home}`,'-encoding','UTF-8','--release','17','-cp',cp,'-d',classes,...testSources]
  artifact('test-compile-command.json',testCompileArgs)
  await child(path.join(jvm,'javac.exe'),testCompileArgs,30000)
  await child(path.join(jvm,'java.exe'),[`-Duser.home=${home}`,`-Djava.io.tmpdir=${home}`,'-cp',cp,'io.harnessdesktop.mobile.DeepAuditMobileManifestPagingTest',run],30000)
  if(process.argv.includes('--contracts-only'))return
  try {net.connect({host:'127.0.0.1',port:60131});throw new Error('fence failed')}catch(e){assert.match(e.message,/fence rejected/);log('networkFence',{denied:60131})}
  const room=Buffer.alloc(32,37).toString('base64url'), key=Buffer.alloc(32,91).toString('base64url'), deviceId='c'.repeat(16), secret='synthetic_chain_secret_not_real'.repeat(2)
  const seen=new Map()
  core=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://fixture.invalid'), id=u.searchParams.get('id')
    if(req.method!=='POST'||u.pathname!=='/fixture/ack'||!/^((normal|jitter|hol|reconnect|bulk|paged)-\d+|late-0)$/.test(id||'')){res.writeHead(403);res.end();return}
    log('coreReceipt',{id});const parts=[];let bytes=0;for await(const p of req){bytes+=p.length;if(bytes>4096)throw new Error('fixture command too large');parts.push(p)}
    seen.set(id,(seen.get(id)||0)+1);const payload=Buffer.concat(parts);assert.equal(JSON.parse(payload).id,id)
    const ack=()=>{log('coreAck',{id,downstreamDestroyed:res.destroyed});res.setHeader('X-Fixture-Id',id);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id,echoHash:hash(payload)}));if(id==='late-0')reach('lateAck')}
    if(id==='late-0'){reach('late');later(ack,700)}else later(ack,3)
  })
  const corePort=await bind(core)
  const store=new MobileSyncStore(path.join(home,'synthetic-mobile.json'))
  const device={id:deviceId,secretHash:hash(secret),name:'synthetic fixture',platform:'android',createdAt:new Date(0).toISOString()};store.addDevice(device)
  store.commitSyncManifest({complete:true,workspaces:[{workspaceId:'fixture',title:'fixture'}],sessions:Array.from({length:1400},(_,i)=>({sessionId:`chain-${i}`,workspaceId:'fixture',title:'s'.repeat(300)})),readMessages:[],operationId:'synthetic-chain-snapshot'})
  gateway=new MobileSyncService({store,getRuntimeTarget:()=>`http://127.0.0.1:${corePort}`,stateDir:home,desktopControlStateFile:path.join(home,'synthetic-desktop-control.json'),host:'127.0.0.1',port:0,cookieProvider:async(origin)=>{assert.equal(origin,`http://127.0.0.1:${corePort}`);return ''},fetchImpl:()=>{throw new Error('fixture forbids runtime fetch')} })
  allocating=true;try{await gateway.start({persist:false})}finally{allocating=false};allowedPorts.add(gateway.port)
  const handlers=gateway.server.listeners('request');gateway.server.removeAllListeners('request')
  gateway.server.on('request',(req,res)=>{
    const id=req.headers['x-fixture-id'], u=new URL(req.url,'http://fixture.invalid')
    const allowedManifest=u.pathname==='/__harness_mobile__/sync/manifest' && (u.search==='?refresh=0'||u.search==='?refresh=0&paging=1'||/^\?paging=1&token=[A-Za-z0-9_-]{43}&offset=[0-9]{1,7}$/.test(u.search))
    if(!/^(normal|jitter|hol|reconnect|snapshot|late|bulk|paged)-\d+$/.test(id||'')||!(u.pathname==='/fixture/ack'||allowedManifest)){res.writeHead(403);res.end();return}
    log('desktopHandler',{id});res.setHeader('X-Fixture-Id',id);for(const fn of handlers)fn.call(gateway.server,req,res)
  })
  gateway.server.removeAllListeners('upgrade');gateway.server.on('upgrade',(_req,socket)=>socket.destroy())
  gateway.proxy.on('proxyRes',(_response,request)=>log('gatewayAck',{id:request.headers['x-fixture-id']}))
  const snapshot=Buffer.from(JSON.stringify({ok:true,...await gateway.workspaceManifest({device,refresh:false})}))
  relayServer=createHealthServer();router=createRelayRouter({server:relayServer});const relayPort=await bind(relayServer)
  router.wss.on('connection',socket=>{
    let role='', seq=0, inTail=0, outTail=0, pendingBytes=0
    // One head timer per connection/direction. Independent setTimeout calls with
    // equal floating deadlines can invert after millisecond rounding: not TCP.
    function fifo() {
      const queue=[];let waiting=false
      function drain(){if(waiting)return;while(queue.length){const h=queue[0],remaining=h.due-now();if(remaining>0){waiting=true;later(()=>{waiting=false;drain()},Math.max(1,Math.ceil(remaining)));return}queue.shift();h.fn()}}
      return (fn,due)=>{queue.push({fn,due});drain()}
    }
    const inbound=fifo(), outbound=fifo()
    const originalEmit=socket.emit, originalSend=socket.send.bind(socket), getBuffered=Object.getOwnPropertyDescriptor(WebSocket.prototype,'bufferedAmount').get
    Object.defineProperty(socket,'bufferedAmount',{get(){return getBuffered.call(socket)+pendingBytes}})
    socket.emit=function(name,...args){
      if(name!=='message')return originalEmit.call(this,name,...args)
      const [data,binary]=args;if(!binary){try{role=JSON.parse(String(data)).role||role}catch{};return originalEmit.call(this,name,...args)}
      const packet=hash(Buffer.from(data).subarray(8));log('relayWireReceive',{role,packet})
      const dispatch=()=>{log('relayIngress',{role,packet});originalEmit.call(this,name,...args)}
      let due=now();if(['jitter','bulkJitter','paged','pagedAbort'].includes(profile)&&role==='mobile')due=inTail=Math.max(inTail,now()+30+(seq++%5)*4)
      inbound(dispatch,due);return true
    }
    socket.send=function(data,...args){
      if(!Buffer.isBuffer(data))return originalSend(data,...args)
      const packet=hash(data.subarray(8)), bytes=data.length, mode=profile;log('relayQueue',{role,packet,bytes})
      const transmit=()=>{pendingBytes-=bytes;log('relayForward',{role,packet,bytes});if(socket.readyState===WebSocket.OPEN)originalSend(data,...args);else {const callback=args.find(x=>typeof x==='function');callback?.(new Error('fixture socket closed before shaped delivery'))}}
      let due=now()
      if(role==='mobile'&&['snapshot','bulkJitter','paged','pagedAbort'].includes(mode))due=outTail=Math.max(outTail,now()+(mode==='snapshot'?0:30+(seq++%5)*4))+bytes/(64*1024)*1000
      else if(role==='mobile'&&mode==='jitter')due=outTail=Math.max(outTail,now()+30+(seq++%5)*4)
      pendingBytes+=bytes
      if(role==='mobile'&&['snapshot','bulkJitter'].includes(mode)&&pendingBytes>=400*1024)reach(mode)
      if(role==='mobile'&&['paged','pagedAbort'].includes(mode)&&pendingBytes>=8*1024)reach(mode)
      outbound(transmit,due)
    }
  })
  class FixtureDesktopWs extends WebSocket {
    constructor(url,options){assert.equal(url,'wss://fixture.invalid/chain');super(`ws://127.0.0.1:${relayPort}/chain`,options);this.readObserver=new RelayTunnelCodec(key);this.writeObserver=new RelayTunnelCodec(key);this.prependListener('message',(raw,binary)=>{if(binary)log('desktopReceive',packet(raw,this.readObserver))})}
    send(data,...args){if(Buffer.isBuffer(data))log('desktopEnqueue',packet(data,this.writeObserver));return super.send(data,...args)}
  }
  adapter=new WssRelayAdapter({relayUrl:'wss://fixture.invalid/chain',WebSocketImpl:FixtureDesktopWs,connectImpl:options=>{assert.deepEqual(options,{host:'127.0.0.1',port:gateway.port});return net.connect(options)}})
  await adapter.start({port:gateway.port,mesh:{relayRoomId:room,relayTunnelKey:key,serviceAddress:'127.0.0.1'}})
  controlServer=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://fixture.invalid');try{
      if(req.method!=='GET')throw new Error('method not allowed')
      if(u.pathname==='/clock'){res.end(JSON.stringify({at:now()}));return}
      if(u.pathname==='/mode'){const name=u.searchParams.get('name');assert.ok(['normal','jitter','snapshot','bulkJitter','paged','pagedAbort'].includes(name));profile=name;log('mode',{profile});res.end('{}');return}
      if(u.pathname==='/barrier'){await barrier(u.searchParams.get('name'));res.end('{}');return}
      if(u.pathname==='/drop'){for(const room of router.rooms.values())for(const mobile of room.mobiles.values())mobile.socket.terminate();log('forcedDisconnect');res.end('{}');return}
      throw new Error('unknown fixture endpoint')
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}
  })
  const controlPort=await bind(controlServer), proxyPort=await reserve(), socksPort=await reserve()
  const config={home,room,key,cookie:`${COOKIE_NAME}=${deviceId}.${secret}`,relayPort,controlPort,proxyPort,socksPort,gatewayPort:gateway.port,snapshotBytes:snapshot.length,snapshotHash:hash(snapshot)}
  artifact('fixture-config.json',config);artifact('ports.json',{relayPort,controlPort,proxyPort,socksPort,gatewayPort:gateway.port,corePort})
  const args=[`-Duser.home=${home}`,`-Djava.io.tmpdir=${home}`,'-Djava.security.manager=allow','-cp',cp,'io.harnessdesktop.mobile.DeepAuditMobileChainTest',path.join(run,'fixture-config.json')]
  artifact('java-command.json',{command:path.join(jvm,'java.exe'),args,envKeys:Object.keys(process.env).sort()})
  await child(path.join(jvm,'java.exe'),args,100000)
  const java=JSON.parse(fs.readFileSync(path.join(run,'java-result.json'),'utf8'));assert.equal(java.ok,true)
  for(const e of java.events)e.at+=java.clockOffset
  const all=[...events,...java.events].sort((a,b)=>a.at-b.at), byPacket=new Map()
  for(const e of all)if(e.packet&&e.id)byPacket.set(e.packet,e.id)
  for(const e of all)if(e.packet&&!e.id)e.id=byPacket.get(e.packet)||null
  const commands=java.requests.filter(r=>!r.snapshot), rows=[]
  for(const r of commands){const e=all.filter(e=>e.id===r.id), at=stage=>e.find(e=>e.stage===stage)?.at
    const upload=e.find(e=>e.stage==='mobileEnqueue'&&e.type===2), download=e.find(e=>e.stage==='desktopEnqueue'&&e.type===2)
    const stagePacket=(stage,p)=>all.find(e=>e.stage===stage&&e.packet===p)?.at
    const points={submit:at('submit'),mobileEnqueue:upload?.at,relayRequestIngress:stagePacket('relayIngress',upload?.packet),relayRequestForward:stagePacket('relayForward',upload?.packet),desktopReceive:at('desktopReceive'),desktopHandler:at('desktopHandler'),coreReceipt:at('coreReceipt'),coreAck:at('coreAck'),desktopEnqueue:download?.at,relayAckIngress:stagePacket('relayIngress',download?.packet),relayAckForward:stagePacket('relayForward',download?.packet),mobileDecode:at('mobileDecode'),mobileReceipt:at('mobileReceipt')}
    rows.push({...r,points})
  }
  const segments=[['clientToTunnel','submit','mobileEnqueue'],['tunnelToRelay','mobileEnqueue','relayRequestIngress'],['relayRequestDispatch','relayRequestIngress','relayRequestForward'],['relayToAdapter','relayRequestForward','desktopReceive'],['adapterToGateway','desktopReceive','desktopHandler'],['gatewayToCore','desktopHandler','coreReceipt'],['syntheticCore','coreReceipt','coreAck'],['coreToTunnel','coreAck','desktopEnqueue'],['ackTunnelToRelay','desktopEnqueue','relayAckIngress'],['ackRelayQueue','relayAckIngress','relayAckForward'],['relayToClientDecoded','relayAckForward','mobileDecode'],['decodeToReceipt','mobileDecode','mobileReceipt']]
  const profiles={};for(const name of ['normal','jitter','hol','reconnect','bulk','paged']){const values=rows.filter(r=>r.id.startsWith(name+'-'));profiles[name]={total:quantile(values.map(r=>r.durationMs)),segments:Object.fromEntries(segments.map(([name,a,b])=>[name,quantile(values.map(r=>r.points[b]-r.points[a]))])),ackArrivalOrder:values.slice().sort((a,b)=>a.receipt-b.receipt).map(r=>r.id)}}
  const missing=commands.filter(r=>!r.expectLoss&&!r.ok).length, duplicate=[...seen.values()].reduce((a,n)=>a+Math.max(0,n-1),0)
  assert.equal(commands.length,61);assert.equal(duplicate,0);assert.equal(missing,0);assert.equal(commands.filter(r=>r.expectLoss&&!r.ok).length,1)
  assert.equal(java.requests.filter(r=>r.snapshot&&r.ok).length,3)
  const comparison={impairment:'both: 65536 bytes/s download plus FIFO 30–46ms mobile ingress/egress jitter',before:java.requests.find(r=>r.id==='snapshot-1'),after:java.requests.find(r=>r.id==='snapshot-2'),ackP95Before:profiles.bulk.total.p95,ackP95After:profiles.paged.total.p95}
  assert.equal(comparison.after.bodyHash,comparison.before.bodyHash);assert.equal(comparison.after.bodyBytes,comparison.before.bodyBytes)
  assert.equal(comparison.after.cachedSessions,1400)
  const interrupted=java.requests.find(r=>r.id==='snapshot-3');assert.equal(interrupted?.ok,false);assert.equal(interrupted?.oldCacheUnchanged,true)
  assert.ok(gateway.manifestDownloads.size<=1,'at most the deliberately abandoned bounded transfer may await TTL/stop')
  artifact('paging-interruption.json',{...interrupted,retainedTransfersBeforeStop:gateway.manifestDownloads.size})
  assert.ok(profiles.paged.total.p95<profiles.bulk.total.p95/3,'bounded paging should remove bulk head-of-line ACK delay')
  artifact('paging-comparison.json',comparison)
  const packetOrder={}
  for(const [direction,send,receive] of [['upload','mobileEnqueue','desktopReceive'],['download','desktopEnqueue','mobileDecode']]){
    let sent=0,received=0,dropped=0,duplicates=0,reordered=0
    for(const request of java.requests.filter(r=>r.ok)){
      const a=all.filter(e=>e.stage===send&&e.id===request.id&&e.type===2),positions=new Map(a.map((e,i)=>[e.packet,i]))
      const b=all.filter(e=>e.stage===receive&&e.id===request.id&&e.type===2&&positions.has(e.packet)),order=b.map(e=>positions.get(e.packet))
      sent+=a.length;received+=b.length;dropped+=a.length-new Set(b.map(e=>e.packet)).size;duplicates+=b.length-new Set(b.map(e=>e.packet)).size
      reordered+=order.filter((value,i)=>i>0&&value<=order[i-1]).length
    }
    packetOrder[direction]={sent,received,dropped,duplicates,reordered};assert.equal(dropped+duplicates+reordered,0,`${direction} per-stream packet order`)
  }
  const drift=sources.filter(s=>hash(fs.readFileSync(path.join(root,s.path)))!==s.sha256)
  assert.equal(drift.length,0,'production/fixture source changed during measurement')
  assert.equal(events.filter(e=>e.stage==='networkFenceReject').length,1,'only deliberate GUI-port probe must be denied')
  artifact('integrity.json',{packetOrder,sourceDrift:drift,clockUncertaintyMs:java.clockUncertaintyMs,claims:'packet DATA checks cover successful requests; deliberate disconnect is separately counted'})
  artifact('result.json',{ok:true,scope:'real Java WebProxy+SOCKS+Wss+AES-GCM -> real local blind relay -> real desktop adapter -> real MobileSyncService/http-proxy -> synthetic HTTP core ACK; not WebView/official composer RPC/LLM/WAN/TLS',clock:{javaToNodeOffsetMs:java.clockOffset,uncertaintyMs:java.clockUncertaintyMs},profiles,packetOrder,sourceDrift:drift,counts:{commands:commands.length,unplannedDrops:missing,expectedDisconnectLoss:1,duplicateCoreExecution:duplicate,byteOrderAndCrossStreamIdChecks:'all successful ACK payload hashes and snapshot hash exact'},snapshot:{bytes:snapshot.length,sha256:hash(snapshot),durationMs:java.requests.find(r=>r.snapshot).durationMs,rateBytesPerSecond:65536},rows,lateCoreAck:all.find(e=>e.stage==='coreAck'&&e.id==='late-0'),limitations:['No WebView render or official composer/RPC handler','No real phone/cellular/external WiFi/NAT/TLS','Delay and byte-rate are explicit FIFO transport scheduling shims, not OS network emulation','Cross-stream response order is not guaranteed; report observed arrival order, assert only IDs/payload byte integrity','Reconnect explicitly invoked by fixture, not MainActivity automatic lifecycle']})
  artifact('events.json',all)
}
main().catch(error=>{failure=error;console.error(error.stack||error)}).finally(async()=>{
  const cleanup=[]
  for(const t of pendingTimers)clearTimeout(t);pendingTimers.clear()
  for(const c of children)if(c.exitCode===null)c.kill()
  try{if(adapter)await adapter.stop()}catch(e){cleanup.push(String(e))}
  try{if(gateway){await gateway.stop({persist:false});assert.equal(gateway.manifestDownloads.size,0);assert.equal(gateway.manifestStarts.size,0)}}catch(e){cleanup.push(String(e))}
  try{if(router){for(const s of router.wss.clients)s.terminate();await router.close()}}catch(e){cleanup.push(String(e))}
  for(const s of [controlServer,core,relayServer])if(s?.listening)try{s.closeAllConnections?.();await new Promise((r,j)=>{const t=setTimeout(()=>j(new Error('server cleanup timeout')),2000);s.close(e=>{clearTimeout(t);e?j(e):r()})})}catch(e){cleanup.push(String(e))}
  artifact('node-events.json',events);artifact('completion.json',{ok:!failure&&!cleanup.length,error:failure?String(failure):null,cleanupErrors:cleanup,adapterStreams:adapter?.streams.size??null,manifestDownloads:gateway?.manifestDownloads.size??null,manifestStarts:gateway?.manifestStarts.size??null})
  console.log(JSON.stringify({mobileChainArtifact:run,ok:!failure&&!cleanup.length,error:failure?String(failure):null,cleanupErrors:cleanup}));process.exitCode=failure||cleanup.length?1:0
})
