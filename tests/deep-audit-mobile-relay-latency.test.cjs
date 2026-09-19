const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const { performance } = require('node:perf_hooks')
const WebSocket = require('ws')
const { createHealthServer, createRelayRouter, sendBounded } = require('../services/wss-relay/server.cjs')
const roomId = Buffer.alloc(32, 101).toString('base64url') // Synthetic fixture only, never a real pairing.
const tick = () => new Promise(setImmediate)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function envelope(id, bytes = 64, peer = Buffer.alloc(8)) { const out = Buffer.alloc(bytes + 8); peer.copy(out); out.writeUInt32BE(id, 8); return out }
function quantiles(values) { const a = [...values].sort((x,y) => x-y); const p = n => +a[Math.min(a.length-1, Math.ceil(n*a.length)-1)].toFixed(3); return { n:a.length, p50:p(.5), p95:p(.95), max:p(1) } }
function inbox(socket) {
  const queued = [], pending = []
  socket.on('message', (raw, binary) => { const item = {raw, binary, at:performance.now()}; const resolve = pending.shift(); if (resolve) resolve(item); else queued.push(item) })
  return () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => pending.push(resolve))
}
async function localRelay(t, options = {}) {
  const server = createHealthServer(), router = createRelayRouter({ server, ...options }), clients = []
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = `ws://127.0.0.1:${server.address().port}`
  t.after(async () => { for (const client of clients) client.terminate(); for (const socket of router.wss.clients) socket.terminate(); await router.close(); await new Promise(resolve => server.close(resolve)) })
  async function connect(role, extra = {}) {
    const socket = new WebSocket(url, extra), next = inbox(socket); clients.push(socket); socket.on('error', () => {})
    await once(socket, 'open'); socket.send(JSON.stringify({type:'hello', version:1, role, roomId}))
    const welcome = JSON.parse(String((await next()).raw)); assert.equal(welcome.type, 'welcome')
    return {socket, next, welcome}
  }
  return {router, connect}
}

// A monotone due timestamp alone does not make independent relative timers FIFO:
// timer quantization and time spent scheduling can let a later timer fire first.
// Only the head owns a timer; an early wake re-arms without releasing any frame.
function fifoScheduler({now=()=>performance.now(), setTimer=setTimeout, clearTimer=clearTimeout, beforeArm=()=>{}} = {}) {
  const queue=[]
  let tailDue=0, timer=null, draining=false, closed=false, maxPending=0
  function arm() {
    if(closed || draining || timer!==null || queue.length===0)return
    timer=setTimer(drain,Math.max(0,queue[0].due-now()))
  }
  function drain() {
    timer=null; draining=true
    try { while(!closed && queue.length && queue[0].due<=now()) queue.shift().run() }
    finally { draining=false; arm() }
  }
  return {
    enqueue(wait,run) {
      assert.ok(!closed,'cannot enqueue on a disposed fixture scheduler')
      const due=tailDue=Math.max(tailDue,now()+wait)
      queue.push({due,run}); maxPending=Math.max(maxPending,queue.length)
      beforeArm(); arm()
      return due
    },
    get pending(){return queue.length},
    get maxPending(){return maxPending},
    dispose(){closed=true; if(timer!==null)clearTimer(timer); timer=null; queue.length=0},
  }
}
function cpuPause(ms) {const end=performance.now()+ms; while(performance.now()<end){} }
const timelineStages=['mobileSend','relayIngress','relayForward','desktopReceive','desktopAck','relayAckIngress','relayAckForward','mobileReceipt']
function assertHealthyTimeline({drop,duplicate,reordered,segments}) {
  assert.equal(drop,0); assert.equal(duplicate,0); assert.equal(reordered,0,'receipt order must match submission order')
  assert.ok(segments.relayForward.p95<250,'local forwarding must not add a route-scale delay')
}
async function relayTimeline(t,profile,{scheduleCpuMs=0,swapRelayExit=false}={}) {
  const f=await localRelay(t), traces=new Map(), received=[], count=24
  const orders=Object.fromEntries(timelineStages.map(stage=>[stage,[]]))
  function mark(stage,id) {const row=traces.get(id); if(row){row[stage]=performance.now(); orders[stage].push(id)}}
  let swapped=false
  f.router.wss.on('connection',socket=>{
    let role='', held=null
    socket.prependListener('message',(raw,binary)=>{
      if(!binary){try{role=JSON.parse(String(raw)).role||role}catch{};return}
      mark(role==='mobile'?'relayIngress':'relayAckIngress',raw.readUInt32BE(8))
    })
    const send=socket.send.bind(socket)
    function write(data,args) {
      if(Buffer.isBuffer(data)&&data.length>=12)mark(role==='desktop'?'relayForward':'relayAckForward',data.readUInt32BE(8))
      return send(data,...args)
    }
    socket.send=(data,...args)=>{
      // Negative control acts on the REAL server-side ws.send outlet, not on
      // collected metrics or received arrays. Production relay source is untouched.
      if(swapRelayExit && role==='desktop' && Buffer.isBuffer(data) && data.length>=12) {
        const id=data.readUInt32BE(8)
        if(id===0 && !swapped){held={data,args};return}
        if(id===1 && held){const first=held;held=null;swapped=true;write(data,args);return write(first.data,first.args)}
      }
      return write(data,args)
    }
  })
  const desktop=await f.connect('desktop'), mobile=await f.connect('mobile')
  const options={beforeArm:()=>{if(scheduleCpuMs)cpuPause(scheduleCpuMs)}}
  const upstream=fifoScheduler(options), acknowledgments=fifoScheduler(options)
  t.after(()=>{upstream.dispose();acknowledgments.dispose()})
  desktop.socket.on('message',(raw,binary)=>{
    if(!binary)return
    const id=raw.readUInt32BE(8);mark('desktopReceive',id)
    if(profile==='snapshot-burst'&&id===0)for(let j=0;j<64;j++)desktop.socket.send(envelope(1000+j,8192,raw.subarray(0,8)))
    const wait=profile==='ordered-jitter'?4+(id%3):0
    acknowledgments.enqueue(wait,()=>{mark('desktopAck',id);desktop.socket.send(raw)})
  })
  const done=new Promise(resolve=>mobile.socket.on('message',(raw,binary)=>{
    if(!binary)return
    const id=raw.readUInt32BE(8);if(!traces.has(id))return
    mark('mobileReceipt',id);received.push(id);if(received.length===count)resolve()
  }))
  for(let id=0;id<count;id++) {
    traces.set(id,{submit:performance.now()})
    upstream.enqueue(profile==='ordered-jitter'?12+(id%7):0,()=>{mark('mobileSend',id);mobile.socket.send(envelope(id))})
  }
  assert.equal(upstream.pending,count,'all 24 submissions must be queued together, never one per ACK')
  assert.equal(received.length,0)
  await done
  const rows=[...traces.values()],segments={}
  for(const [label,a,b] of [['clientAdapter','submit','mobileSend'],['upstreamLoopback','mobileSend','relayIngress'],['relayForward','relayIngress','relayForward'],['downstreamLoopback','relayForward','desktopReceive'],['syntheticDesktop','desktopReceive','desktopAck'],['relayAck','relayAckIngress','relayAckForward'],['syntheticRoundTrip','submit','mobileReceipt']])segments[label]=quantiles(rows.map(row=>row[b]-row[a]))
  const duplicate=received.length-new Set(received).size,drop=count-new Set(received).size,reordered=received.filter((id,index)=>id!==index).length
  const result={profile,scheduleCpuMs,swapRelayExit,swapped,units:'ms',segments,drop,duplicate,reordered,orders,submittedTogether:upstream.maxPending,scope:'loopback relay plus declared synthetic scheduling; NOT actual phone/core/WAN'}
  t.diagnostic(JSON.stringify(result))
  return result
}
for(const profile of ['no-delay','ordered-jitter','snapshot-burst']) {
  test(`loopback real relay segment timeline: ${profile}, 24 concurrent synthetic commands`,{timeout:6000},async t=>{
    const result=await relayTimeline(t,profile)
    assertHealthyTimeline(result)
    for(const stage of timelineStages)assert.deepEqual(result.orders[stage],Array.from({length:24},(_,i)=>i),stage)
  })
}

test('strict FIFO survives 0.2ms CPU at each schedule in both directions with 24 concurrent commands',{timeout:6000},async t=>{
  const result=await relayTimeline(t,'ordered-jitter',{scheduleCpuMs:0.2})
  assertHealthyTimeline(result)
  for(const stage of timelineStages)assert.deepEqual(result.orders[stage],Array.from({length:24},(_,i)=>i),stage)
})

test('negative control: swapped real relay exit frames still fail the unchanged order assertion',{timeout:6000},async t=>{
  const result=await relayTimeline(t,'ordered-jitter',{scheduleCpuMs:0.2,swapRelayExit:true})
  assert.equal(result.swapped,true);assert.equal(result.drop,0);assert.equal(result.duplicate,0);assert.equal(result.reordered,2)
  const expected=Array.from({length:24},(_,i)=>i),swapped=[1,0,...expected.slice(2)]
  assert.deepEqual(result.orders.mobileSend,expected);assert.deepEqual(result.orders.relayIngress,expected)
  for(const stage of timelineStages.slice(2))assert.deepEqual(result.orders[stage],swapped,stage)
  assert.throws(()=>assertHealthyTimeline(result),{name:'AssertionError',message:/receipt order must match submission order/})
  assert.ok(result.segments.relayForward.p95<250,'negative control must isolate order, not latency')
})

test('FIFO absolute due drain rejects quantized early wakes and cancels its sole head timer',()=>{
  // Deterministic timer adversary: relative delays are integer-quantized and
  // each enqueue consumes 0.2ms, without firing callbacks inside the producer.
  let now=0,nextId=0,maxTimers=0,earlyWakes=0
  const timers=new Map(),delivered=[],dues=[]
  const scheduler=fifoScheduler({now:()=>now,beforeArm:()=>{now+=0.2},setTimer:(run,wait)=>{
    const id=++nextId,at=Math.floor(now)+Math.max(1,Math.floor(wait))
    timers.set(id,{run,at});maxTimers=Math.max(maxTimers,timers.size)
    if(at<now+wait)earlyWakes++
    return id
  },clearTimer:id=>timers.delete(id)})
  let expectedTail=0
  for(let id=0;id<24;id++) {
    expectedTail=Math.max(expectedTail,now+12+(id%7))
    const due=scheduler.enqueue(12+(id%7),()=>delivered.push({id,at:now}))
    assert.equal(due,expectedTail,'preserve the original absolute delay/jitter target')
    dues.push(due)
  }
  assert.equal(scheduler.pending,24);assert.equal(delivered.length,0)
  let steps=0
  while(timers.size){assert.ok(++steps<100,'drain must converge');const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];timers.delete(id);now=Math.max(now,timer.at);timer.run()}
  assert.deepEqual(delivered.map(row=>row.id),Array.from({length:24},(_,i)=>i))
  for(const row of delivered)assert.ok(row.at>=dues[row.id],'never dispatch a head before its absolute due')
  assert.equal(maxTimers,1);assert.ok(earlyWakes>0);assert.equal(scheduler.pending,0)
  scheduler.enqueue(100,()=>assert.fail('disposed scheduler fired'));assert.equal(timers.size,1)
  scheduler.dispose();scheduler.dispose();assert.equal(timers.size,0);assert.equal(scheduler.pending,0)
})

class FakeSocket extends EventEmitter {
  constructor() { super(); this.readyState=1; this.bufferedAmount=0; this.sent=[]; this.closes=[]; this.pings=0; this.terminations=0 }
  send(data) { this.sent.push(data) }
  close(code,reason) { this.closes.push({code,reason}); this.readyState=2 } // Deliberately never completes peer handshake.
  terminate() { if(this.readyState===3)return; this.terminations++; this.readyState=3; this.emit('close') }
  ping() { this.pings++ }
}
class FakeWss extends EventEmitter {
  constructor() { super(); this.clients=new Set() }
  close(callback) { this.emit('close'); callback?.() }
}
function fakeRelay(t) {
  t.mock.timers.enable({apis:['setTimeout','setInterval']})
  const router=createRelayRouter({server:{},WebSocketServerImpl:FakeWss})
  t.after(async()=> {for(const socket of router.wss.clients) socket.terminate(); await router.close(); t.mock.timers.reset()})
  function connect(role) {const socket=new FakeSocket(); router.wss.clients.add(socket); socket.once('close',()=>router.wss.clients.delete(socket)); router.wss.emit('connection',socket,{socket:{remoteAddress:'127.0.0.1'}}); socket.emit('message',Buffer.from(JSON.stringify({type:'hello',version:1,role,roomId})),false); return socket}
  return {router,connect}
}

test('half-open desktop has a bounded lifetime and releases its room for reconnect', t => {
  const f=fakeRelay(t), desktop=f.connect('desktop'), mobile=f.connect('mobile')
  t.mock.timers.tick(20000)
  assert.equal(desktop.pings,1,'idle transports need a WS ping instead of indefinite TCP liveness')
  mobile.emit('pong')
  t.mock.timers.tick(10000)
  assert.equal(desktop.terminations,1); assert.equal(mobile.terminations,0)
  const replacement=f.connect('desktop')
  assert.equal(replacement.closes.length,0)
  assert.equal(f.router.rooms.get(roomId).desktop.socket,replacement)
  assert.ok(mobile.sent.some(value=>String(value).includes('desktop-offline')))
})

test('backpressure closes terminate a noncooperative transport within one second', t => {
  const f=fakeRelay(t), desktop=f.connect('desktop'), mobile=f.connect('mobile')
  desktop.bufferedAmount=4*1024*1024
  const before=desktop.sent.length
  mobile.emit('message',envelope(1),true)
  assert.equal(desktop.sent.length,before); assert.equal(desktop.closes[0].code,4429)
  t.mock.timers.tick(1000)
  assert.equal(desktop.terminations,1); assert.equal(mobile.terminations,1)
  assert.equal(f.router.rooms.size,0)
})

test('one slow mobile cannot disconnect the shared desktop or a healthy sibling', t => {
  const f=fakeRelay(t), desktop=f.connect('desktop'), slow=f.connect('mobile'), healthy=f.connect('mobile')
  const peer=Buffer.from(JSON.parse(String(slow.sent[0])).peerId,'hex')
  slow.bufferedAmount=4*1024*1024
  desktop.emit('message',envelope(1,64,peer),true)
  assert.equal(slow.closes[0].code,4429)
  assert.equal(desktop.closes.length,0,'a slow mobile must not take down the shared multiplexed source')
  assert.equal(healthy.closes.length,0)
  t.mock.timers.tick(1000)
  const room=f.router.rooms.get(roomId)
  assert.equal(room.desktop.socket,desktop); assert.equal(room.mobiles.size,1)
  const before=desktop.sent.length
  healthy.emit('message',envelope(2),true)
  assert.equal(desktop.sent.length,before+1)
})

test('active desktop cannot be displaced; stale close cannot clear its replacement', t => {
  const f=fakeRelay(t), old=f.connect('desktop'), mobile=f.connect('mobile'), rejected=f.connect('desktop')
  assert.equal(rejected.closes[0].code,4409); assert.equal(f.router.rooms.get(roomId).desktop.socket,old)
  old.terminate(); const replacement=f.connect('desktop')
  old.emit('close'); old.emit('message',Buffer.from(JSON.stringify({type:'hello',version:1,role:'desktop',roomId})),false)
  assert.equal(f.router.rooms.get(roomId).desktop.socket,replacement)
  assert.equal(replacement.closes.length,0)
  mobile.terminate(); replacement.terminate(); rejected.terminate()
  assert.equal(f.router.rooms.size,0); assert.equal(f.router.wss.clients.size,0)
})

test('an errored removed socket cannot rejoin or forward stale frames', t => {
  const f=fakeRelay(t), desktop=f.connect('desktop'), mobile=f.connect('mobile')
  mobile.emit('error',new Error('synthetic disconnect'))
  mobile.emit('message',Buffer.from(JSON.stringify({type:'hello',version:1,role:'mobile',roomId})),false)
  const before=desktop.sent.length
  mobile.emit('message',envelope(1),true)
  assert.equal(desktop.sent.length,before)
  assert.equal(f.router.rooms.get(roomId).mobiles.size,0)
})

test('send failure is fenced rather than escaping the relay message handler', () => {
  const source=new FakeSocket(), destination=new FakeSocket()
  destination.send=()=>{throw new Error('synthetic closed write')}
  assert.equal(sendBounded({clients:[source,destination],source,destination,data:Buffer.from('x')}),false)
  source.terminate(); destination.terminate()
})

test('asynchronous send failure closes only the failed channel and signals its nonshared source', async () => {
  const source=new FakeSocket(), destination=new FakeSocket()
  destination.send=(_data,_options,callback)=>queueMicrotask(()=>callback(new Error('synthetic async write failure')))
  assert.equal(sendBounded({clients:[source,destination],source,destination,data:Buffer.from('x')}),true,'true means only queued')
  await tick(); assert.equal(destination.closes[0].code,1011); assert.equal(source.closes[0].code,1011)
  source.terminate(); destination.terminate()
})

test('closing transport rejects later frames before its close handshake finishes', t => {
  const f=fakeRelay(t), desktop=f.connect('desktop'), mobile=f.connect('mobile')
  mobile.close(1000,'fixture Stop transport')
  const before=desktop.sent.length; mobile.emit('message',envelope(88),true)
  assert.equal(desktop.sent.length,before)
})

test('50 reconnect cycles leave no rooms, stale liveness timers or source admission leaks', t => {
  const f=fakeRelay(t), history=[]
  for(let i=0;i<50;i++) {
    const desktop=f.connect('desktop'), mobile=f.connect('mobile'); history.push(desktop,mobile)
    assert.equal(desktop.closes.length,0); assert.equal(mobile.closes.length,0)
    desktop.terminate(); mobile.terminate()
    assert.equal(f.router.rooms.size,0); assert.equal(f.router.wss.clients.size,0)
  }
  t.mock.timers.tick(60000)
  assert.equal(history.reduce((sum,socket)=>sum+socket.pings,0),0)
  for(const socket of history) assert.equal(socket.listenerCount('pong'),0)
  t.diagnostic(JSON.stringify({reconnectCycles:50,remainingRooms:0,remainingClients:0,latePings:0}))
})

test('slow-link FIFO simulation quantifies snapshot head-of-line cost without reordering ciphertext', t => {
  const f=fakeRelay(t), desktop=f.connect('desktop'), mobile=f.connect('mobile'), delivered=[]
  const peer=Buffer.from(JSON.parse(String(mobile.sent[0])).peerId,'hex')
  let tail=0
  mobile.send=data=>{
    const bytes=data.length; mobile.bufferedAmount+=bytes; tail+=bytes/65536*1000
    const due=tail,id=data.readUInt32BE(8)
    setTimeout(()=>{mobile.bufferedAmount-=bytes; delivered.push({id,at:due})},due)
  }
  for(let i=0;i<20;i++) desktop.emit('message',envelope(1000+i,16384-8,peer),true)
  for(let i=0;i<24;i++) desktop.emit('message',envelope(i,64-8,peer),true)
  t.mock.timers.tick(6000)
  const commands=delivered.filter(row=>row.id<24)
  assert.deepEqual(commands.map(row=>row.id),Array.from({length:24},(_,i)=>i))
  assert.equal(mobile.bufferedAmount,0); assert.equal(desktop.closes.length,0)
  t.diagnostic(JSON.stringify({profile:'fake-clock FIFO at64KiB/s, 320KiB snapshot before24 commands',queuedReceiptMs:quantiles(commands.map(row=>row.at)),drop:24-commands.length,duplicate:commands.length-new Set(commands.map(row=>row.id)).size,reordered:0,note:'modeled bottleneck remains; opaque relay cannot safely prioritize application commands'}))
})

test('offline frames are not replayed; duplicate ciphertext remains endpoint-rejected', {timeout:3000}, async t => {
  const {RelayTunnelCodec,FRAME_TYPES}=require('../electron/bridge/relay-tunnel-codec.cjs')
  const sender=new RelayTunnelCodec(Buffer.alloc(32,33)), receiver=new RelayTunnelCodec(Buffer.alloc(32,33))
  const f=await localRelay(t), desktop=await f.connect('desktop'), mobile=await f.connect('mobile')
  const nextBinary=async client=>{for(;;){const row=await client.next();if(row.binary)return row.raw}}
  const packet=id=>Buffer.concat([Buffer.alloc(8),sender.encode(FRAME_TYPES.DATA,id,Buffer.from('synthetic'))])
  const first=packet(1)
  mobile.socket.send(first); receiver.decode((await nextBinary(desktop)).subarray(8))
  mobile.socket.send(first); const duplicate=await nextBinary(desktop)
  assert.throws(()=>receiver.decode(duplicate.subarray(8)),/replayed/u)
  const gone=once(desktop.socket,'close'); desktop.socket.terminate(); await gone
  assert.equal(JSON.parse(String((await mobile.next()).raw)).type,'desktop-offline')
  const serverMobile=[...f.router.rooms.get(roomId).mobiles.values()][0].socket
  const arrived=once(serverMobile,'message'); mobile.socket.send(packet(2)); await arrived
  const replacement=await f.connect('desktop')
  mobile.socket.send(packet(3))
  const resumed=receiver.decode((await nextBinary(replacement)).subarray(8))
  assert.equal(resumed.streamId,3,'the offline command must not be replayed before the fresh command')
  t.diagnostic(JSON.stringify({onlineFrames:2,relayDuplicateSuppression:0,endpointReplayRejected:1,offlineFrames:1,offlineReplays:0,freshAfterReconnect:1}))
})

test('real no-pong desktop is reclaimed; normal pong peer remains online', {timeout:3000}, async t => {
  const f=await localRelay(t,{timing:{heartbeatIntervalMs:40,pongTimeoutMs:60}})
  const desktop=await f.connect('desktop',{autoPong:false}), mobile=await f.connect('mobile')
  const closed=once(desktop.socket,'close')
  await Promise.race([closed,delay(400).then(()=>{throw new Error('stale desktop not reclaimed within test budget')})])
  assert.equal(mobile.socket.readyState,WebSocket.OPEN)
  const replacement=await f.connect('desktop'); assert.equal(replacement.welcome.role,'desktop')
})
