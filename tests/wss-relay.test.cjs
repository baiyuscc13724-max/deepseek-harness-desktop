const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')
const {
  KNOWN_CAPABILITIES,
  MAX_CONNECTION_BUFFERED_BYTES,
  MAX_CONNECTIONS_PER_SOURCE,
  MAX_GLOBAL_BUFFERED_BYTES,
  MAX_PENDING_HELLOS,
  MAX_ROOMS,
  MAX_SIGNAL_PAYLOAD_CHARS,
  MAX_TOTAL_CONNECTIONS,
  SIGNALING_VERSION,
  createHealthServer,
  createRelayRouter,
  relaySourceAddress,
  sanitizeCapabilities,
  sendBounded,
  validRoomId,
  validSignalPayload
} = require('../services/wss-relay/server.cjs')
const { DESKTOP_PEER_ID, WssRelayAdapter, safeRelayUrl } = require('../electron/bridge/sync-transports/wss-relay-adapter.cjs')
const { FRAME_TYPES, RelayTunnelCodec } = require('../electron/bridge/relay-tunnel-codec.cjs')

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (data, binary) => { cleanup(); resolve({ data: Buffer.from(data), binary }) }
    const onError = error => { cleanup(); reject(error) }
    const cleanup = () => { socket.off('message', onMessage); socket.off('error', onError) }
    socket.on('message', onMessage)
    socket.on('error', onError)
  })
}

function nextMessages(socket, count) {
  return new Promise((resolve, reject) => {
    const messages = []
    const onMessage = (data, binary) => {
      messages.push({ data: Buffer.from(data), binary })
      if (messages.length === count) { cleanup(); resolve(messages) }
    }
    const onError = error => { cleanup(); reject(error) }
    const cleanup = () => { socket.off('message', onMessage); socket.off('error', onError) }
    socket.on('message', onMessage)
    socket.on('error', onError)
  })
}

async function openClient(url, options = {}) {
  const socket = new WebSocket(url, { perMessageDeflate: false, ...options })
  await once(socket, 'open')
  return socket
}

async function startTestRelay(t, limits) {
  const server = createHealthServer()
  const router = createRelayRouter({ server, limits })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    for (const client of router.wss.clients) client.terminate()
    await router.close().catch(() => {})
    await new Promise(resolve => server.close(resolve))
  })
  return { router, url: `ws://127.0.0.1:${server.address().port}` }
}

async function closeClient(socket) {
  if (socket.readyState === WebSocket.CLOSED) return
  const closed = once(socket, 'close')
  socket.close()
  await closed
}

async function openRejectedClient(url, options = {}) {
  const socket = new WebSocket(url, { perMessageDeflate: false, ...options })
  const closed = once(socket, 'close')
  await once(socket, 'open')
  const [code, reason] = await closed
  return { code, reason: String(reason) }
}

function fakeOpenSocket(bufferedAmount = 0) {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    sent: [],
    closed: [],
    send(data, options) { this.sent.push({ data, options }) },
    close(code, reason) { this.closed.push({ code, reason }); this.readyState = WebSocket.CLOSING }
  }
}

test('relay service is a standalone deployable package without Desktop runtime imports', () => {
  const directory = path.join(__dirname, '..', 'services', 'wss-relay')
  const source = readFileSync(path.join(directory, 'server.cjs'), 'utf8')
  const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  assert.doesNotMatch(source, /\.\.\/\.\.\/(?:electron|renderer|plugins)\//)
  assert.deepEqual(manifest.engines, { node: '>=20' })
  assert.equal(manifest.dependencies.ws, '8.21.3')
})

test('relay tunnel codec authenticates frames and rejects tampering or replay', () => {
  const key = Buffer.alloc(32, 7)
  const sender = new RelayTunnelCodec(key)
  const receiver = new RelayTunnelCodec(key)
  const packet = sender.encode(FRAME_TYPES.DATA, 42, Buffer.from('private payload'))
  const decoded = receiver.decode(packet)
  assert.equal(decoded.type, FRAME_TYPES.DATA)
  assert.equal(decoded.streamId, 42)
  assert.equal(decoded.payload.toString(), 'private payload')
  assert.throws(() => receiver.decode(packet), /replayed/)
  const tampered = Buffer.from(sender.encode(FRAME_TYPES.DATA, 43, Buffer.from('secret')))
  tampered[20] ^= 1
  assert.throws(() => new RelayTunnelCodec(key).decode(tampered), /authentication failed/)
})

test('public relay URLs require credential-free WSS', () => {
  assert.equal(safeRelayUrl('wss://relay.example.com/tunnel'), 'wss://relay.example.com/tunnel')
  assert.throws(() => safeRelayUrl('ws://relay.example.com/tunnel'), /wss/)
  assert.throws(() => safeRelayUrl('wss://relay.example.com:8443/tunnel'), /443/)
  assert.throws(() => safeRelayUrl('wss://user:pass@relay.example.com/tunnel'), /credential/)
  assert.throws(() => safeRelayUrl('wss://relay.example.com/tunnel?token=secret'), /query/)
  assert.throws(() => safeRelayUrl('wss://relay.example.com/tunnel#secret'), /fragment/)
  assert.equal(validRoomId(Buffer.alloc(32, 3).toString('base64url')), true)
})

test('WSS pairing uses the encrypted mesh service address without a second hard-coded subnet', () => {
  const adapter = new WssRelayAdapter({ relayUrl: 'wss://relay.example.com/', WebSocketImpl: WebSocket })
  adapter.status = 'connected'
  adapter.context = {
    port: 3081,
    mesh: {
      serviceAddress: '10.253.77.254',
      relayRoomId: Buffer.alloc(32, 3).toString('base64url'),
      relayTunnelKey: Buffer.alloc(32, 4).toString('base64url')
    }
  }
  assert.equal(adapter.pairingConfig().origin, 'http://10.253.77.254:3081')
})

test('public relay enforces bounded global, handshake, room, and source capacity', async t => {
  assert.ok(MAX_TOTAL_CONNECTIONS >= MAX_PENDING_HELLOS)
  assert.ok(MAX_ROOMS >= 1)
  assert.ok(MAX_CONNECTIONS_PER_SOURCE >= 2)
  assert.equal(relaySourceAddress({ socket: { remoteAddress: '::ffff:127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.10' } }), '198.51.100.10')
  assert.equal(relaySourceAddress({ socket: { remoteAddress: '198.51.100.20' }, headers: { 'x-forwarded-for': '203.0.113.99' } }), '198.51.100.20')

  await t.test('total connection limit rejects excess sockets', async t => {
    const { url } = await startTestRelay(t, { maxTotalConnections: 1, maxPendingHellos: 4, maxRooms: 4, maxConnectionsPerSource: 4 })
    const first = await openClient(url, { headers: { 'x-forwarded-for': '198.51.100.1' } })
    const rejected = await openRejectedClient(url, { headers: { 'x-forwarded-for': '198.51.100.2' } })
    assert.equal(rejected.code, 4429)
    assert.match(rejected.reason, /connection limit/u)
    await closeClient(first)
  })

  await t.test('pending hello, room, and per-source limits reject excess clients', async t => {
    const { url } = await startTestRelay(t, { maxTotalConnections: 8, maxPendingHellos: 1, maxRooms: 1, maxConnectionsPerSource: 2 })
    const idle = await openClient(url, { headers: { 'x-forwarded-for': '198.51.100.10' } })
    const pendingRejected = await openRejectedClient(url, { headers: { 'x-forwarded-for': '198.51.100.11' } })
    assert.equal(pendingRejected.code, 4429)
    assert.match(pendingRejected.reason, /hello capacity/u)
    await closeClient(idle)

    const roomId = Buffer.alloc(32, 10).toString('base64url')
    const first = await openClient(url, { headers: { 'x-forwarded-for': '198.51.100.20' } })
    const firstWelcome = nextMessage(first)
    first.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId }))
    await firstWelcome

    const otherRoom = await openClient(url, { headers: { 'x-forwarded-for': '198.51.100.21' } })
    const otherRoomClosed = once(otherRoom, 'close')
    otherRoom.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId: Buffer.alloc(32, 11).toString('base64url') }))
    const [roomCode, roomReason] = await otherRoomClosed
    assert.equal(roomCode, 4429)
    assert.match(String(roomReason), /room capacity/u)

    const second = await openClient(url, { headers: { 'x-forwarded-for': '198.51.100.20' } })
    const secondWelcome = nextMessage(second)
    second.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId }))
    await secondWelcome
    const sourceRejected = await openRejectedClient(url, { headers: { 'x-forwarded-for': '198.51.100.20' } })
    assert.equal(sourceRejected.code, 4429)
    assert.match(sourceRejected.reason, /source connection limit/u)
    await closeClient(first)
    await closeClient(second)
  })
})

test('P2P signaling payloads are bounded opaque base64url values', () => {
  assert.equal(SIGNALING_VERSION, 1)
  assert.equal(validSignalPayload(Buffer.alloc(32, 9).toString('base64url')), true)
  assert.equal(validSignalPayload('contains spaces'), false)
  assert.equal(validSignalPayload('a'.repeat(MAX_SIGNAL_PAYLOAD_CHARS + 1)), false)
})

test('relay capabilities are allowlisted, deduplicated, and bounded', () => {
  assert.deepEqual(KNOWN_CAPABILITIES, ['native-p2p-v1', 'native-p2p-v2'])
  assert.deepEqual(sanitizeCapabilities(null), [])
  assert.deepEqual(sanitizeCapabilities(['native-p2p-v2', 'unknown', 7, 'native-p2p-v1', 'native-p2p-v2']), ['native-p2p-v2', 'native-p2p-v1'])
})

test('bounded relay sends close a slow destination and its source before queue growth', () => {
  assert.ok(MAX_GLOBAL_BUFFERED_BYTES > MAX_CONNECTION_BUFFERED_BYTES)
  const source = fakeOpenSocket()
  const destination = fakeOpenSocket(61)
  const sent = sendBounded({
    clients: [source, destination],
    source,
    destination,
    data: Buffer.alloc(4),
    binary: true,
    maxConnectionBufferedBytes: 64,
    maxGlobalBufferedBytes: 128
  })
  assert.equal(sent, false)
  assert.equal(destination.sent.length, 0)
  assert.deepEqual(destination.closed, [{ code: 4429, reason: 'outbound backpressure exceeded' }])
  assert.deepEqual(source.closed, [{ code: 4429, reason: 'relay destination backpressure exceeded' }])
})

test('bounded relay sends enforce one global queued-byte ceiling', () => {
  const backlog = fakeOpenSocket(95)
  const source = fakeOpenSocket()
  const destination = fakeOpenSocket()
  const sent = sendBounded({
    clients: [backlog, source, destination],
    source,
    destination,
    data: '123456',
    maxConnectionBufferedBytes: 64,
    maxGlobalBufferedBytes: 100
  })
  assert.equal(sent, false)
  assert.equal(destination.sent.length, 0)
  assert.equal(destination.closed[0].code, 4429)
  assert.equal(source.closed[0].code, 4429)
  assert.equal(backlog.closed.length, 0)
})

test('desktop receives only cleaned mobile P2P capabilities', async t => {
  const { url } = await startTestRelay(t)
  const roomId = Buffer.alloc(32, 8).toString('base64url')
  const desktop = await openClient(url)
  const desktopWelcome = nextMessage(desktop)
  desktop.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId, capabilities: ['native-p2p-v2'] }))
  await desktopWelcome

  const mobile = await openClient(url)
  const mobileWelcome = nextMessage(mobile)
  const peerJoined = nextMessage(desktop)
  mobile.send(JSON.stringify({
    type: 'hello',
    version: 1,
    role: 'mobile',
    roomId,
    capabilities: ['unknown', 'native-p2p-v2', 'native-p2p-v1', 'native-p2p-v2', { injected: true }]
  }))
  const mobileGreeting = JSON.parse((await mobileWelcome).data.toString())
  assert.deepEqual(mobileGreeting.desktopCapabilities, ['native-p2p-v2'])
  const joined = JSON.parse((await peerJoined).data.toString())
  assert.deepEqual(joined.capabilities, ['native-p2p-v2', 'native-p2p-v1'])
  assert.equal(Object.hasOwn(joined, 'unknown'), false)
  await closeClient(mobile)
  await closeClient(desktop)
})

test('signal and binary routes apply the outbound hard limit', async t => {
  async function connectedRoom(t, fill) {
    const { url } = await startTestRelay(t, { maxConnectionBufferedBytes: 256, maxGlobalBufferedBytes: 1024 })
    const roomId = Buffer.alloc(32, fill).toString('base64url')
    const desktop = await openClient(url)
    const desktopWelcome = nextMessage(desktop)
    desktop.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId }))
    await desktopWelcome
    const mobile = await openClient(url)
    const mobileWelcome = nextMessage(mobile)
    const peerJoined = nextMessage(desktop)
    mobile.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId }))
    const welcome = JSON.parse((await mobileWelcome).data.toString())
    await peerJoined
    return { desktop, mobile, welcome }
  }

  await t.test('oversized projected signal queue closes destination and source', async t => {
    const { desktop, mobile } = await connectedRoom(t, 13)
    const desktopClosed = once(desktop, 'close')
    const mobileClosed = once(mobile, 'close')
    mobile.send(JSON.stringify({ type: 'signal', version: 1, target: 'desktop', payload: 'a'.repeat(240) }))
    assert.equal((await desktopClosed)[0], 4429)
    assert.equal((await mobileClosed)[0], 4429)
  })

  await t.test('oversized projected binary queue closes destination and source', async t => {
    const { desktop, mobile } = await connectedRoom(t, 14)
    const desktopClosed = once(desktop, 'close')
    const mobileClosed = once(mobile, 'close')
    mobile.send(Buffer.concat([DESKTOP_PEER_ID, Buffer.alloc(300)]))
    assert.equal((await desktopClosed)[0], 4429)
    assert.equal((await mobileClosed)[0], 4429)
  })
})

test('desktop receives peer identities for mobiles already waiting in its room', async t => {
  const { url } = await startTestRelay(t)
  const roomId = Buffer.alloc(32, 7).toString('base64url')
  const mobile = await openClient(url)
  const mobileWelcome = nextMessage(mobile)
  mobile.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId }))
  const welcome = JSON.parse((await mobileWelcome).data.toString())

  const desktop = await openClient(url)
  const desktopMessages = nextMessages(desktop, 2)
  const desktopOnline = nextMessage(mobile)
  desktop.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId }))
  const messages = (await desktopMessages).map(message => JSON.parse(message.data.toString()))
  assert.equal(messages[0].type, 'welcome')
  assert.deepEqual(messages[1], { type: 'peer-joined', peerId: welcome.peerId, signalingVersion: 1 })
  assert.deepEqual(JSON.parse((await desktopOnline).data.toString()), { type: 'desktop-online', signalingVersion: 1 })
  await closeClient(mobile)
  await closeClient(desktop)
})

test('waiting mobile receives only cleaned capabilities from a new desktop', async t => {
  const { url } = await startTestRelay(t)
  const roomId = Buffer.alloc(32, 15).toString('base64url')
  const mobile = await openClient(url)
  const mobileWelcome = nextMessage(mobile)
  mobile.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId, capabilities: ['native-p2p-v2'] }))
  await mobileWelcome

  const desktop = await openClient(url)
  const desktopMessages = nextMessages(desktop, 2)
  const desktopOnline = nextMessage(mobile)
  desktop.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId, capabilities: ['unknown', 'native-p2p-v2', 'native-p2p-v2'] }))
  await desktopMessages
  assert.deepEqual(JSON.parse((await desktopOnline).data.toString()), {
    type: 'desktop-online',
    signalingVersion: 1,
    desktopCapabilities: ['native-p2p-v2']
  })
  await closeClient(mobile)
  await closeClient(desktop)
})

test('relay routes opaque P2P signals by assigned peer without changing binary fallback', async t => {
  const { url } = await startTestRelay(t)
  const roomId = Buffer.alloc(32, 6).toString('base64url')
  const desktop = await openClient(url)
  const desktopWelcome = nextMessage(desktop)
  desktop.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId }))
  assert.equal(JSON.parse((await desktopWelcome).data.toString()).signalingVersion, 1)

  const mobile = await openClient(url)
  const mobileWelcome = nextMessage(mobile)
  const peerJoined = nextMessage(desktop)
  mobile.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId }))
  const welcome = JSON.parse((await mobileWelcome).data.toString())
  await peerJoined
  assert.deepEqual(welcome, {
    type: 'welcome',
    version: 1,
    role: 'mobile',
    peerId: welcome.peerId,
    desktopOnline: true,
    signalingVersion: 1
  })

  const tunnelKey = Buffer.alloc(32, 12)
  const mobileCodec = new RelayTunnelCodec(tunnelKey)
  const desktopCodec = new RelayTunnelCodec(tunnelKey)
  const offerPayload = mobileCodec.encode(FRAME_TYPES.DATA, 0, Buffer.from('{"kind":"offer","sdp":"opaque"}')).toString('base64url')
  const offer = nextMessage(desktop)
  mobile.send(JSON.stringify({ type: 'signal', version: 1, target: 'desktop', payload: offerPayload }))
  const routedOffer = JSON.parse((await offer).data.toString())
  assert.deepEqual(routedOffer, { type: 'signal', version: 1, source: welcome.peerId, payload: offerPayload })
  const decodedOffer = desktopCodec.decode(Buffer.from(routedOffer.payload, 'base64url'))
  assert.equal(decodedOffer.streamId, 0)
  assert.deepEqual(JSON.parse(decodedOffer.payload.toString()), { kind: 'offer', sdp: 'opaque' })

  const answerPayload = desktopCodec.encode(FRAME_TYPES.DATA, 0, Buffer.from('{"kind":"answer","sdp":"opaque"}')).toString('base64url')
  const answer = nextMessage(mobile)
  desktop.send(JSON.stringify({ type: 'signal', version: 1, target: welcome.peerId, payload: answerPayload }))
  const routedAnswer = JSON.parse((await answer).data.toString())
  assert.deepEqual(routedAnswer, { type: 'signal', version: 1, source: 'desktop', payload: answerPayload })
  const decodedAnswer = mobileCodec.decode(Buffer.from(routedAnswer.payload, 'base64url'))
  assert.equal(decodedAnswer.streamId, 0)
  assert.deepEqual(JSON.parse(decodedAnswer.payload.toString()), { kind: 'answer', sdp: 'opaque' })

  const denied = once(mobile, 'close')
  mobile.send(JSON.stringify({ type: 'signal', version: 1, target: welcome.peerId, payload: offerPayload }))
  const [code, reason] = await denied
  assert.equal(code, 4403)
  assert.match(String(reason), /target denied/u)
  await closeClient(desktop)
})

test('blind relay routes opaque packets only between desktop and assigned mobile peer', async t => {
  const server = createHealthServer()
  const router = createRelayRouter({ server })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    for (const client of router.wss.clients) client.terminate()
    await router.close().catch(() => {})
    await new Promise(resolve => server.close(resolve))
  })
  const port = server.address().port
  const url = `ws://127.0.0.1:${port}`
  const roomId = Buffer.alloc(32, 5).toString('base64url')
  const desktop = await openClient(url)
  const desktopWelcome = nextMessage(desktop)
  desktop.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId }))
  assert.equal(JSON.parse((await desktopWelcome).data.toString()).role, 'desktop')

  const mobile = await openClient(url)
  const mobileWelcome = nextMessage(mobile)
  const peerJoined = nextMessage(desktop)
  mobile.send(JSON.stringify({ type: 'hello', version: 1, role: 'mobile', roomId }))
  const welcome = JSON.parse((await mobileWelcome).data.toString())
  const peerId = Buffer.from(welcome.peerId, 'hex')
  assert.equal(peerId.length, 8)
  assert.equal(JSON.parse((await peerJoined).data.toString()).type, 'peer-joined')

  const opaqueMobilePacket = Buffer.from('opaque-mobile-ciphertext')
  const desktopPacket = nextMessage(desktop)
  mobile.send(Buffer.concat([DESKTOP_PEER_ID, opaqueMobilePacket]))
  const forwardedToDesktop = await desktopPacket
  assert.equal(forwardedToDesktop.binary, true)
  assert.deepEqual(forwardedToDesktop.data.subarray(0, 8), peerId)
  assert.deepEqual(forwardedToDesktop.data.subarray(8), opaqueMobilePacket)

  const opaqueDesktopPacket = Buffer.from('opaque-desktop-ciphertext')
  const mobilePacket = nextMessage(mobile)
  desktop.send(Buffer.concat([peerId, opaqueDesktopPacket]))
  const forwardedToMobile = await mobilePacket
  assert.equal(forwardedToMobile.binary, true)
  assert.deepEqual(forwardedToMobile.data.subarray(0, 8), DESKTOP_PEER_ID)
  assert.deepEqual(forwardedToMobile.data.subarray(8), opaqueDesktopPacket)

  desktop.close()
  mobile.close()
})
