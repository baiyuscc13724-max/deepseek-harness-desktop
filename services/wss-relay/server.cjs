const http = require('node:http')
const net = require('node:net')
const { randomBytes } = require('node:crypto')
const WebSocket = require('ws')

// Keep the blind relay independently deployable: it only needs the public
// envelope limits, never Desktop code, tunnel keys, or application protocol.
const DESKTOP_PEER_ID = Buffer.alloc(8)
const RELAY_MAX_PAYLOAD_BYTES = 64 * 1024
const RELAY_MAX_PACKET_BYTES = RELAY_MAX_PAYLOAD_BYTES + 64
const MAX_ENVELOPE_BYTES = 8 + RELAY_MAX_PACKET_BYTES
const MAX_MOBILE_PEERS_PER_ROOM = 32
const HELLO_TIMEOUT_MS = 8_000
const RATE_WINDOW_MS = 10_000
const RATE_WINDOW_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_CONNECTIONS = 512
const MAX_PENDING_HELLOS = 64
const MAX_ROOMS = 256
const MAX_CONNECTIONS_PER_SOURCE = 32

function validRoomId(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''))
}

function nextPeerId(room) {
  for (;;) {
    const value = randomBytes(8)
    if (!value.equals(DESKTOP_PEER_ID) && !room.mobiles.has(value.toString('hex'))) return value
  }
}

function sendJson(socket, value) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
}

function rateAllowed(client, bytes, now = Date.now()) {
  if (!client.rate || now - client.rate.startedAt >= RATE_WINDOW_MS) client.rate = { startedAt: now, bytes: 0 }
  client.rate.bytes += bytes
  return client.rate.bytes <= RATE_WINDOW_BYTES
}

function relayLimit(value, fallback) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) throw new Error('WSS relay connection limit is invalid.')
  return value
}

function normalizedSourceAddress(value) {
  let address = String(value || '').trim()
  if (address.toLowerCase().startsWith('::ffff:') && net.isIP(address.slice(7)) === 4) address = address.slice(7)
  return net.isIP(address) ? address : 'unknown'
}

function isLoopbackAddress(value) {
  const address = normalizedSourceAddress(value)
  return address === '::1' || address.startsWith('127.')
}

function relaySourceAddress(request) {
  const direct = normalizedSourceAddress(request?.socket?.remoteAddress)
  if (isLoopbackAddress(direct)) {
    const forwardedChain = String(request?.headers?.['x-forwarded-for'] || '').split(',')
    const forwarded = normalizedSourceAddress(forwardedChain[forwardedChain.length - 1])
    if (forwarded !== 'unknown') return forwarded
  }
  return direct
}

function createRelayRouter({ server, WebSocketServerImpl = WebSocket.WebSocketServer, limits = {} } = {}) {
  if (!server) throw new Error('WSS relay requires an HTTP server behind a TLS reverse proxy.')
  const maxTotalConnections = relayLimit(limits.maxTotalConnections, MAX_TOTAL_CONNECTIONS)
  const maxPendingHellos = relayLimit(limits.maxPendingHellos, MAX_PENDING_HELLOS)
  const maxRooms = relayLimit(limits.maxRooms, MAX_ROOMS)
  const maxConnectionsPerSource = relayLimit(limits.maxConnectionsPerSource, MAX_CONNECTIONS_PER_SOURCE)
  const rooms = new Map()
  const sourceCounts = new Map()
  let pendingHellos = 0
  const wss = new WebSocketServerImpl({ server, maxPayload: MAX_ENVELOPE_BYTES, perMessageDeflate: false })

  function remove(client) {
    if (client.removed) return
    client.removed = true
    if (client.pendingHello) {
      client.pendingHello = false
      pendingHellos = Math.max(0, pendingHellos - 1)
    }
    const sourceCount = sourceCounts.get(client.source) || 0
    if (sourceCount <= 1) sourceCounts.delete(client.source)
    else sourceCounts.set(client.source, sourceCount - 1)
    if (!client.room) return
    const room = client.room
    if (client.role === 'desktop' && room.desktop === client) {
      room.desktop = null
      for (const mobile of room.mobiles.values()) sendJson(mobile.socket, { type: 'desktop-offline' })
    } else if (client.role === 'mobile' && client.peerId) {
      room.mobiles.delete(client.peerId.toString('hex'))
      if (room.desktop) sendJson(room.desktop.socket, { type: 'peer-left', peerId: client.peerId.toString('hex') })
    }
    if (!room.desktop && room.mobiles.size === 0) rooms.delete(room.id)
    client.room = null
  }

  wss.on('connection', (socket, request) => {
    if (wss.clients.size > maxTotalConnections) return socket.close(4429, 'connection limit exceeded')
    const source = relaySourceAddress(request)
    const sourceCount = sourceCounts.get(source) || 0
    if (sourceCount >= maxConnectionsPerSource) return socket.close(4429, 'source connection limit exceeded')
    if (pendingHellos >= maxPendingHellos) return socket.close(4429, 'hello capacity exceeded')
    sourceCounts.set(source, sourceCount + 1)
    pendingHellos += 1
    const client = { socket, source, role: '', room: null, peerId: null, rate: null, pendingHello: true, removed: false }
    const finishHello = () => {
      if (!client.pendingHello) return
      client.pendingHello = false
      pendingHellos = Math.max(0, pendingHellos - 1)
    }
    const helloTimer = setTimeout(() => socket.close(4408, 'hello timeout'), HELLO_TIMEOUT_MS)
    helloTimer.unref?.()

    socket.on('message', (raw, isBinary) => {
      if (!client.room) {
        if (isBinary) return socket.close(4400, 'hello required')
        let hello
        try { hello = JSON.parse(String(raw)) } catch { return socket.close(4400, 'invalid hello') }
        if (hello.type !== 'hello' || hello.version !== 1 || !['desktop', 'mobile'].includes(hello.role) || !validRoomId(hello.roomId)) {
          return socket.close(4400, 'invalid hello')
        }
        let room = rooms.get(hello.roomId)
        if (!room) {
          if (rooms.size >= maxRooms) return socket.close(4429, 'room capacity exceeded')
          room = { id: hello.roomId, desktop: null, mobiles: new Map() }
          rooms.set(room.id, room)
        }
        client.role = hello.role
        client.room = room
        if (client.role === 'desktop') {
          if (room.desktop) {
            client.room = null
            return socket.close(4409, 'desktop already connected')
          }
          room.desktop = client
          finishHello()
          clearTimeout(helloTimer)
          sendJson(socket, { type: 'welcome', version: 1, role: 'desktop' })
          for (const mobile of room.mobiles.values()) sendJson(mobile.socket, { type: 'desktop-online' })
          return
        }
        if (room.mobiles.size >= MAX_MOBILE_PEERS_PER_ROOM) {
          client.room = null
          return socket.close(4429, 'room full')
        }
        client.peerId = nextPeerId(room)
        room.mobiles.set(client.peerId.toString('hex'), client)
        finishHello()
        clearTimeout(helloTimer)
        sendJson(socket, { type: 'welcome', version: 1, role: 'mobile', peerId: client.peerId.toString('hex'), desktopOnline: Boolean(room.desktop) })
        if (room.desktop) sendJson(room.desktop.socket, { type: 'peer-joined', peerId: client.peerId.toString('hex') })
        return
      }

      if (!isBinary) return socket.close(4400, 'binary tunnel frames required')
      const packet = Buffer.from(raw)
      if (packet.length < 8 || packet.length > MAX_ENVELOPE_BYTES || !rateAllowed(client, packet.length)) return socket.close(4429, 'relay limit exceeded')
      if (client.role === 'mobile') {
        if (!packet.subarray(0, 8).equals(DESKTOP_PEER_ID) || !client.room.desktop) return
        const destination = client.room.desktop.socket
        if (destination.readyState === WebSocket.OPEN) destination.send(Buffer.concat([client.peerId, packet.subarray(8)]), { binary: true })
        return
      }
      const peerHex = packet.subarray(0, 8).toString('hex')
      const destination = client.room.mobiles.get(peerHex)?.socket
      if (destination?.readyState === WebSocket.OPEN) destination.send(Buffer.concat([DESKTOP_PEER_ID, packet.subarray(8)]), { binary: true })
    })
    socket.once('close', () => { clearTimeout(helloTimer); remove(client) })
    socket.once('error', () => { clearTimeout(helloTimer); remove(client) })
  })

  return { wss, rooms, close: () => new Promise(resolve => wss.close(resolve)) }
}

function createHealthServer() {
  return http.createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end('{"ok":true,"protocolVersion":1}')
      return
    }
    response.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    response.end('not found')
  })
}

if (require.main === module) {
  const host = String(process.env.HARNESS_RELAY_HOST || '127.0.0.1')
  const port = Number(process.env.HARNESS_RELAY_PORT || 8787)
  const server = createHealthServer()
  createRelayRouter({ server })
  server.listen(port, host, () => console.log(`Harness WSS relay listening behind TLS proxy on http://${host}:${port}`))
}

module.exports = {
  HELLO_TIMEOUT_MS,
  MAX_CONNECTIONS_PER_SOURCE,
  MAX_ENVELOPE_BYTES,
  MAX_MOBILE_PEERS_PER_ROOM,
  MAX_PENDING_HELLOS,
  MAX_ROOMS,
  MAX_TOTAL_CONNECTIONS,
  RATE_WINDOW_BYTES,
  createHealthServer,
  createRelayRouter,
  rateAllowed,
  relaySourceAddress,
  validRoomId
}
