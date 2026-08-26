const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const { FRAME_TYPES, NATIVE_P2P_DIRECTION, NATIVE_P2P_REPLAY_WINDOW, NativeP2pSessionCodec, RelayTunnelCodec, deriveNativeP2pSession } = require('../electron/bridge/relay-tunnel-codec.cjs')
const { NativeP2pAdapter } = require('../electron/bridge/sync-transports/native-p2p-adapter.cjs')
const { COMMAND_CHANNEL, EVENT_CHANNEL, NativeP2pHost } = require('../electron/bridge/native-p2p-host.cjs')

const ROOM_ID = 'r'.repeat(43)
const TUNNEL_KEY = Buffer.alloc(32, 7).toString('base64url')
const PEER_ID = '0102030405060708'
const DESKTOP_NONCE = Buffer.alloc(32, 0x11).toString('base64url')
const MOBILE_NONCE = Buffer.alloc(32, 0x22).toString('base64url')

class FakeHost extends EventEmitter {
  constructor() {
    super()
    this.sent = []
    this.stops = 0
  }
  async start(config) {
    this.config = config
    queueMicrotask(() => this.emit('relay-ready', { type: 'relay-ready' }))
  }
  sendPacket(peerId, packet, path, streamId) {
    this.sent.push({ peerId, packet: Buffer.from(packet), path, streamId })
    return true
  }
  async stop() { this.stops += 1 }
}

class FakeSocket extends EventEmitter {
  constructor() {
    super()
    this.writableLength = 0
    this.writes = []
    this.destroyed = false
  }
  write(data) { this.writes.push(Buffer.from(data)); return true }
  end() { this.ended = true }
  destroy() { this.destroyed = true; this.emit('close') }
}

function context() {
  return {
    port: 3081,
    mesh: {
      relayRoomId: ROOM_ID,
      relayTunnelKey: TUNNEL_KEY,
      serviceAddress: '10.253.77.254'
    }
  }
}

test('native P2P host isolates the hidden Chromium transport renderer', async t => {
  const ipcMain = new EventEmitter()
  let created
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.destroyed = false
      this.sent = []
      this.webContents = new EventEmitter()
      this.webContents.send = (channel, payload) => this.sent.push({ channel, payload })
      this.webContents.setWindowOpenHandler = handler => { this.windowOpenHandler = handler }
      created = this
    }
    isDestroyed() { return this.destroyed }
    setMenuBarVisibility() {}
    async loadFile(file) {
      this.loadedFile = file
      queueMicrotask(() => ipcMain.emit(EVENT_CHANNEL, { sender: this.webContents }, { type: 'ready' }))
    }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const host = new NativeP2pHost({ BrowserWindow: FakeWindow, ipcMain, rendererFile: 'transport.html', preloadFile: 'transport.js' })
  t.after(() => host.dispose())
  await host.start({ relayUrl: 'wss://relay.example/' })
  assert.equal(created.options.show, false)
  assert.deepEqual(created.options.webPreferences, {
    preload: 'transport.js',
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    backgroundThrottling: false
  })
  assert.deepEqual(created.windowOpenHandler(), { action: 'deny' })
  assert.deepEqual(created.sent, [{ channel: COMMAND_CHANNEL, payload: { type: 'start', payload: { relayUrl: 'wss://relay.example/' } } }])
  let packetEvents = 0
  host.on('packet', () => { packetEvents += 1 })
  ipcMain.emit(EVENT_CHANNEL, { sender: created.webContents }, { type: 'packet', peerId: PEER_ID, path: 'direct', data: 'A'.repeat(100_000) })
  assert.equal(packetEvents, 0)
  assert.equal(host.sendPacket(PEER_ID, Buffer.alloc(70 * 1024), 'relay', 1), false)
})

test('native P2P host bounds commands queued before renderer readiness', t => {
  const ipcMain = new EventEmitter()
  class NeverCreatedWindow {}
  const host = new NativeP2pHost({ BrowserWindow: NeverCreatedWindow, ipcMain })
  t.after(() => host.dispose())
  for (let index = 0; index < 100; index += 1) host.send('packet', { index })
  assert.equal(host.pending.length, 64)
})

test('native P2P starts on the existing WSS room and publishes backward-compatible pairing', async t => {
  const host = new FakeHost()
  const adapter = new NativeP2pAdapter({ relayUrl: 'wss://relay.example/', host })
  t.after(() => adapter.stop())
  const state = await adapter.start(context())
  assert.equal(state.status, 'connected')
  assert.equal(state.path, 'relay')
  assert.deepEqual(host.config, { relayUrl: 'wss://relay.example/', roomId: ROOM_ID, signalKey: TUNNEL_KEY, protocolVersion: 1 })
  const pairing = adapter.pairingConfig()
  assert.deepEqual(pairing.map(entry => entry.id), ['native-p2p', 'wss-relay'])
  assert.equal(pairing[0].fallbackTransport, 'wss-relay')
  assert.deepEqual(pairing[0].iceServers, [{ urls: ['stun:stun.cloudflare.com:3478'] }])
  assert.equal(pairing[1].tunnelKey, TUNNEL_KEY)
  assert.equal(pairing[1].p2p, true)
  assert.equal(pairing[1].signalingVersion, 1)
  assert.deepEqual(pairing[1].stunUrls, ['stun:stun.cloudflare.com:3478'])
})

test('native P2P reports the real selected line and returns to relay after ICE failure', async t => {
  const host = new FakeHost()
  const adapter = new NativeP2pAdapter({ relayUrl: 'wss://relay.example/', host })
  t.after(() => adapter.stop())
  await adapter.start(context())
  host.emit('path', { peerId: PEER_ID, path: 'negotiating' })
  assert.equal(adapter.state().path, 'negotiating')
  assert.equal(adapter.state().negotiatingPeers, 1)
  assert.match(adapter.state().detail, /正在协商/)
  host.emit('path', { peerId: PEER_ID, path: 'direct' })
  assert.equal(adapter.state().path, 'direct')
  assert.equal(adapter.state().directPeers, 1)
  assert.match(adapter.state().detail, /WebRTC/)
  host.emit('path', { peerId: PEER_ID, path: 'relay' })
  assert.equal(adapter.state().path, 'relay')
  assert.match(adapter.state().detail, /WSS/)
})

test('native P2P preserves transparent encrypted stream forwarding to localhost gateway', async t => {
  const host = new FakeHost()
  const upstream = new FakeSocket()
  const adapter = new NativeP2pAdapter({ relayUrl: 'wss://relay.example/', host, connectImpl: options => {
    assert.deepEqual(options, { host: '127.0.0.1', port: 3081 })
    return upstream
  } })
  t.after(() => adapter.stop())
  await adapter.start(context())
  let nonce = 0
  const mobileCodec = new RelayTunnelCodec(TUNNEL_KEY, { randomBytesImpl: () => Buffer.alloc(12, ++nonce) })
  host.emit('packet', { peerId: PEER_ID, data: mobileCodec.encode(FRAME_TYPES.OPEN, 9).toString('base64'), path: 'relay' })
  host.emit('packet', { peerId: PEER_ID, data: mobileCodec.encode(FRAME_TYPES.DATA, 9, Buffer.from('GET / HTTP/1.1\r\n\r\n')).toString('base64'), path: 'relay' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(Buffer.concat(upstream.writes).toString(), 'GET / HTTP/1.1\r\n\r\n')

  upstream.emit('data', Buffer.from('HTTP/1.1 200 OK\r\n\r\n'))
  assert.equal(host.sent.length, 1)
  assert.equal(host.sent[0].peerId, PEER_ID)
  assert.equal(host.sent[0].path, 'relay')
  assert.equal(host.sent[0].streamId, 9)
  const responseCodec = new RelayTunnelCodec(TUNNEL_KEY)
  const response = responseCodec.decode(host.sent[0].packet)
  assert.equal(response.type, FRAME_TYPES.DATA)
  assert.equal(response.streamId, 9)
  assert.equal(response.payload.toString(), 'HTTP/1.1 200 OK\r\n\r\n')
})

test('native P2P accepts legacy relay frames only until that peer establishes v2', async t => {
  const host = new FakeHost()
  let connects = 0
  const adapter = new NativeP2pAdapter({ relayUrl: 'wss://relay.example/', host, connectImpl: () => { connects += 1; return new FakeSocket() } })
  t.after(() => adapter.stop())
  await adapter.start(context())
  const legacy = new RelayTunnelCodec(TUNNEL_KEY, { randomBytesImpl: () => Buffer.alloc(12, 7) })
  host.emit('packet', { peerId: PEER_ID, data: legacy.encode(FRAME_TYPES.OPEN, 1).toString('base64'), path: 'relay' })
  assert.equal(connects, 1)
  const derived = deriveNativeP2pSession(TUNNEL_KEY, { roomId: ROOM_ID, peerId: PEER_ID, desktopNonce: DESKTOP_NONCE, mobileNonce: MOBILE_NONCE })
  host.emit('session', { peerId: PEER_ID, desktopNonce: DESKTOP_NONCE, mobileNonce: MOBILE_NONCE, sessionId: derived.sessionId.toString('base64url') })
  host.emit('packet', { peerId: PEER_ID, data: legacy.encode(FRAME_TYPES.OPEN, 2).toString('base64'), path: 'relay' })
  assert.equal(connects, 1)
})

test('native P2P v2 transcript and codec bind peer, session, direction and a 4096-packet replay window', () => {
  const fields = { roomId: ROOM_ID, peerId: PEER_ID, desktopNonce: DESKTOP_NONCE, mobileNonce: MOBILE_NONCE }
  const derived = deriveNativeP2pSession(TUNNEL_KEY, fields)
  assert.equal(derived.transcript.toString('ascii'), `native-p2p-v2\n${ROOM_ID}\n${PEER_ID}\n${DESKTOP_NONCE}\n${MOBILE_NONCE}`)
  assert.throws(() => deriveNativeP2pSession(TUNNEL_KEY, { ...fields, roomId: 'r'.repeat(42) }), /room id/u)
  assert.throws(() => deriveNativeP2pSession(TUNNEL_KEY, { ...fields, roomId: 'r'.repeat(44) }), /room id/u)
  assert.equal(derived.sessionKey.toString('hex'), '1a9ec333b9c2197584dd67713757e9da5579cbde5478d916940e6ed5c6228093')
  assert.equal(derived.sessionId.toString('hex'), 'e0d48e4e9db3f592489d54bfee667da7')
  const vectorCodec = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: 1,
    receiveDirection: 2,
    randomBytesImpl: () => Buffer.from('000102030405060708090a0b', 'hex')
  })
  assert.equal(vectorCodec.encode(FRAME_TYPES.DATA, 9, Buffer.from('interop')).toString('hex'), '02010000000000000000000102030405060708090a0b0789a2866244dde15a7892db042d6ab74e973411e337c7fb3e28dad64f')
  let desktopNonce = 0
  let mobileNonce = 32
  const desktop = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: NATIVE_P2P_DIRECTION.DESKTOP_TO_MOBILE,
    receiveDirection: NATIVE_P2P_DIRECTION.MOBILE_TO_DESKTOP,
    randomBytesImpl: () => Buffer.alloc(12, ++desktopNonce)
  })
  const mobile = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: NATIVE_P2P_DIRECTION.MOBILE_TO_DESKTOP,
    receiveDirection: NATIVE_P2P_DIRECTION.DESKTOP_TO_MOBILE,
    randomBytesImpl: () => Buffer.alloc(12, ++mobileNonce)
  })
  const packets = [0, 1, 2].map(index => desktop.encode(FRAME_TYPES.DATA, 7, Buffer.from(`p${index}`)))
  assert.equal(packets[0][0], 2)
  assert.equal(packets[0][1], NATIVE_P2P_DIRECTION.DESKTOP_TO_MOBILE)
  assert.equal(packets[0].readBigUInt64BE(2), 0n)
  assert.equal(NATIVE_P2P_REPLAY_WINDOW, 4096n)
  assert.equal(mobile.decode(packets[2]).payload.toString(), 'p2')
  assert.equal(mobile.decode(packets[0]).payload.toString(), 'p0')
  assert.equal(mobile.decode(packets[1]).payload.toString(), 'p1')
  assert.throws(() => mobile.decode(packets[1]), /replayed/u)
  assert.throws(() => desktop.decode(packets[0]), /direction/u)

  const packetAt = (sequence, nonceByte) => new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: 1,
    receiveDirection: 2,
    initialSequence: sequence,
    randomBytesImpl: () => Buffer.alloc(12, nonceByte)
  }).encode(FRAME_TYPES.PING, 8)
  const zeroReceiver = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: 2,
    receiveDirection: 1
  })
  assert.equal(zeroReceiver.decode(packetAt(0n, 0x40)).sequence, 0n)
  const boundaryReceiver = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: 2,
    receiveDirection: 1
  })
  boundaryReceiver.decode(packetAt(4096n, 0x41))
  assert.equal(boundaryReceiver.decode(packetAt(1n, 0x42)).sequence, 1n) // highest - 4095
  assert.throws(() => boundaryReceiver.decode(packetAt(0n, 0x43)), /outside the replay window/u) // highest - 4096

  const rebound = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: '1111111111111111',
    sendDirection: 2,
    receiveDirection: 1
  })
  assert.throws(() => rebound.decode(packets[0]), /authentication/u)
  const next = deriveNativeP2pSession(TUNNEL_KEY, { ...fields, mobileNonce: Buffer.alloc(32, 0x33).toString('base64url') })
  const reconnected = new NativeP2pSessionCodec(next.sessionKey, {
    sessionId: next.sessionId,
    peerId: PEER_ID,
    sendDirection: 2,
    receiveDirection: 1
  })
  assert.throws(() => reconnected.decode(packets[0]), /authentication/u)
})

test('native P2P v2 pins every stream to its OPEN path', async t => {
  const host = new FakeHost()
  const upstream = new FakeSocket()
  const adapter = new NativeP2pAdapter({ relayUrl: 'wss://relay.example/', host, connectImpl: () => upstream })
  t.after(() => adapter.stop())
  await adapter.start(context())
  const derived = deriveNativeP2pSession(TUNNEL_KEY, { roomId: ROOM_ID, peerId: PEER_ID, desktopNonce: DESKTOP_NONCE, mobileNonce: MOBILE_NONCE })
  host.emit('session', { peerId: PEER_ID, desktopNonce: DESKTOP_NONCE, mobileNonce: MOBILE_NONCE, sessionId: derived.sessionId.toString('base64url') })
  let nonce = 64
  const mobile = new NativeP2pSessionCodec(derived.sessionKey, {
    sessionId: derived.sessionId,
    peerId: PEER_ID,
    sendDirection: NATIVE_P2P_DIRECTION.MOBILE_TO_DESKTOP,
    receiveDirection: NATIVE_P2P_DIRECTION.DESKTOP_TO_MOBILE,
    randomBytesImpl: () => Buffer.alloc(12, ++nonce)
  })
  host.emit('packet', { peerId: PEER_ID, path: 'direct', data: mobile.encode(FRAME_TYPES.OPEN, 17).toString('base64') })
  await new Promise(resolve => setImmediate(resolve))
  upstream.emit('data', Buffer.from('bound'))
  assert.equal(host.sent[0].path, 'direct')
  assert.equal(host.sent[0].streamId, 17)
  host.emit('packet', { peerId: PEER_ID, path: 'relay', data: mobile.encode(FRAME_TYPES.DATA, 17, Buffer.from('rebind')).toString('base64') })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(upstream.destroyed, true)
  assert.equal(adapter.state().status, 'connected')
})

test('native P2P enforces per-peer and total stream ceilings without dropping the relay', async t => {
  const host = new FakeHost()
  let connects = 0
  const adapter = new NativeP2pAdapter({ relayUrl: 'wss://relay.example/', host, connectImpl: () => { connects += 1; return new FakeSocket() } })
  t.after(() => adapter.stop())
  await adapter.start(context())
  const mobileCodecs = []
  for (let peerIndex = 1; peerIndex <= 5; peerIndex += 1) {
    const peerId = peerIndex.toString(16).padStart(16, '0')
    const desktopNonce = Buffer.alloc(32, peerIndex).toString('base64url')
    const mobileNonce = Buffer.alloc(32, peerIndex + 8).toString('base64url')
    const derived = deriveNativeP2pSession(TUNNEL_KEY, { roomId: ROOM_ID, peerId, desktopNonce, mobileNonce })
    host.emit('session', { peerId, desktopNonce, mobileNonce, sessionId: derived.sessionId.toString('base64url') })
    let nonceCounter = 0
    mobileCodecs.push({ peerId, codec: new NativeP2pSessionCodec(derived.sessionKey, {
      sessionId: derived.sessionId,
      peerId,
      sendDirection: 2,
      receiveDirection: 1,
      randomBytesImpl: () => { const value = Buffer.alloc(12, peerIndex + 64); value.writeUInt32BE(++nonceCounter, 8); return value }
    }) })
  }
  const first = mobileCodecs[0]
  for (let streamId = 1; streamId <= 64; streamId += 1) host.emit('packet', { peerId: first.peerId, path: 'relay', data: first.codec.encode(FRAME_TYPES.OPEN, streamId).toString('base64') })
  host.emit('packet', { peerId: first.peerId, path: 'relay', data: first.codec.encode(FRAME_TYPES.OPEN, 65).toString('base64') })
  assert.equal(connects, 64)
  for (let peerIndex = 1; peerIndex < 4; peerIndex += 1) {
    const { peerId, codec } = mobileCodecs[peerIndex]
    for (let streamId = 1; streamId <= 64; streamId += 1) host.emit('packet', { peerId, path: 'relay', data: codec.encode(FRAME_TYPES.OPEN, streamId).toString('base64') })
  }
  assert.equal(connects, 256)
  const extra = mobileCodecs[4]
  host.emit('packet', { peerId: extra.peerId, path: 'relay', data: extra.codec.encode(FRAME_TYPES.OPEN, 1).toString('base64') })
  assert.equal(connects, 256)
  assert.equal(adapter.state().status, 'connected')
  assert.equal(host.sent.at(-1).path, 'relay')
})

test('native P2P renderer gates negotiation and bounds every untrusted path', () => {
  const root = path.join(__dirname, '..')
  const source = readFileSync(path.join(root, 'renderer', 'native-p2p.js'), 'utf8')
  const html = readFileSync(path.join(root, 'renderer', 'native-p2p.html'), 'utf8')
  const androidSource = readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'java', 'io', 'harnessdesktop', 'mobile', 'NativeP2pClient.java'), 'utf8')
  const androidTests = readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'test', 'java', 'io', 'harnessdesktop', 'mobile', 'MainActivityTest.java'), 'utf8')
  assert.match(source, /signalingEnabled = message\.signalingVersion === 1/u)
  assert.match(source, /signalingEnabled && message\.type === 'peer-joined'/u)
  assert.match(source, /MAX_SIGNAL_PAYLOAD_CHARS = 48 \* 1024/u)
  assert.match(source, /MAX_TUNNEL_PACKET_BYTES = 64 \* 1024 \+ 64/u)
  assert.match(source, /MAX_SIGNAL_REPLAY_NONCES = 4096/u)
  assert.match(source, /MAX_PEERS = 32/u)
  assert.match(source, /capabilities: \['native-p2p-v2'\]/u)
  assert.match(source, /message\?\.source !== peerId \|\| message\?\.target !== 'desktop'/u)
  assert.doesNotMatch(source, /protocolVersion/u)
  assert.match(source, /if \(!validNonce\(message\.mobileNonce\)\) throw new Error\('Native P2P ICE nonce binding was rejected\.'/u)
  assert.match(source, /peer\.pendingMobileNonce && peer\.pendingMobileNonce !== message\.mobileNonce/u)
  assert.match(source, /peer\.offerSent = true/u)
  assert.match(source, /peer\.pendingLocalIce\.splice\(0\)/u)
  assert.match(source, /let messageChain = Promise\.resolve\(\)/u)
  assert.match(source, /messageChain = messageChain\.then\(async \(\) =>/u)
  assert.match(source, /await handleSignal\(message\.source, await decryptSignal\(message\.payload\)\)/u)
  assert.match(source, /\^\[A-Za-z0-9_-\]\{43\}\$/u)
  assert.match(source, /replayed signal was rejected/u)
  assert.match(source, /\^stun:/u)
  assert.doesNotMatch(source, /turns:/u)
  assert.match(source, /connection\.connectionState === 'connected' && peer\.channel\?\.readyState === 'open' && peer\.sessionReady/u)
  assert.match(source, /\['direct', 'relay'\]\.includes\(path\)/u)
  assert.doesNotMatch(source, /preferDirect/u)
  assert.match(source, /envelope\.byteLength > 8 \+ MAX_TUNNEL_PACKET_BYTES/u)
  assert.match(androidSource, /if \(!sessionReady\) \{\s*try \{ openSocksServer\(activeGeneration\); \}/u)
  assert.match(androidSource, /packet\[0\] == RelayTunnelCodec\.VERSION && path == StreamPath\.RELAY && !sessionReady/u)
  assert.match(androidSource, /closeStreamsForPath\(StreamPath\.RELAY\);\s*sessionReady = true;/u)
  assert.match(androidSource, /if \(!sessionReady\) return roomCodec\.encode/u)
  assert.match(androidTests, /02010000000000000000000102030405060708090a0b0789a2866244dde15a7892db042d6ab74e973411e337c7fb3e28dad64f/u)
  assert.match(html, /Content-Security-Policy/u)
  assert.match(html, /connect-src wss:/u)
})
