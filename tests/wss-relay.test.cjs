const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const WebSocket = require('ws')
const { createHealthServer, createRelayRouter, validRoomId } = require('../services/wss-relay/server.cjs')
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

async function openClient(url) {
  const socket = new WebSocket(url, { perMessageDeflate: false })
  await once(socket, 'open')
  return socket
}

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
