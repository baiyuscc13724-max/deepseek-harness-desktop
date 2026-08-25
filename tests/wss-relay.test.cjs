const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')
const {
  MAX_CONNECTIONS_PER_SOURCE,
  MAX_PENDING_HELLOS,
  MAX_ROOMS,
  MAX_TOTAL_CONNECTIONS,
  createHealthServer,
  createRelayRouter,
  relaySourceAddress,
  validRoomId
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
