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
const SIGNALING_VERSION = 1
const MAX_SIGNAL_PAYLOAD_CHARS = 48 * 1024
const MAX_CONNECTION_BUFFERED_BYTES = 4 * 1024 * 1024
const MAX_GLOBAL_BUFFERED_BYTES = 64 * 1024 * 1024
const KNOWN_CAPABILITIES = Object.freeze(['native-p2p-v1', 'native-p2p-v2'])
const KNOWN_CAPABILITY_SET = new Set(KNOWN_CAPABILITIES)

function validRoomId(value) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(value || ''))
}

function validSignalPayload(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_SIGNAL_PAYLOAD_CHARS && /^[A-Za-z0-9_-]+$/.test(value)
}

function sanitizeCapabilities(value) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const capabilities = []
  for (const item of value) {
    if (typeof item !== 'string' || !KNOWN_CAPABILITY_SET.has(item) || seen.has(item)) continue
    seen.add(item)
    capabilities.push(item)
  }
  return capabilities
}

function nextPeerId(room) {
  for (;;) {
    const value = randomBytes(8)
    if (!value.equals(DESKTOP_PEER_ID) && !room.mobiles.has(value.toString('hex'))) return value
  }
}

function socketBufferedBytes(socket) {
  const value = Number(socket?.bufferedAmount || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function closeBackpressured(socket, reason) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close(4429, reason)
}

function sendBounded({ clients, destination, source, data, binary = false, maxConnectionBufferedBytes = MAX_CONNECTION_BUFFERED_BYTES, maxGlobalBufferedBytes = MAX_GLOBAL_BUFFERED_BYTES }) {
  if (!destination || destination.readyState !== WebSocket.OPEN) return false
  const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(String(data))
  let globalBufferedBytes = 0
  for (const socket of clients) globalBufferedBytes += socketBufferedBytes(socket)
  if (socketBufferedBytes(destination) + bytes > maxConnectionBufferedBytes || globalBufferedBytes + bytes > maxGlobalBufferedBytes) {
    closeBackpressured(destination, 'outbound backpressure exceeded')
    if (source && source !== destination) closeBackpressured(source, 'relay destination backpressure exceeded')
    return false
  }
  destination.send(data, binary ? { binary: true } : undefined)
  return true
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

function relayByteLimit(value, fallback) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > 1024 * 1024 * 1024) throw new Error('WSS relay buffer limit is invalid.')
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
  const maxConnectionBufferedBytes = relayByteLimit(limits.maxConnectionBufferedBytes, MAX_CONNECTION_BUFFERED_BYTES)
  const maxGlobalBufferedBytes = relayByteLimit(limits.maxGlobalBufferedBytes, MAX_GLOBAL_BUFFERED_BYTES)
  if (maxGlobalBufferedBytes < maxConnectionBufferedBytes) throw new Error('WSS relay global buffer limit must cover one connection buffer.')
  const rooms = new Map()
  const sourceCounts = new Map()
  let pendingHellos = 0
  const wss = new WebSocketServerImpl({ server, maxPayload: MAX_ENVELOPE_BYTES, perMessageDeflate: false })

  function sendJson(destination, value, source = null) {
    return sendBounded({
      clients: wss.clients,
      destination,
      source,
      data: JSON.stringify(value),
      maxConnectionBufferedBytes,
      maxGlobalBufferedBytes
    })
  }

  function sendBinary(destination, value, source = null) {
    return sendBounded({
      clients: wss.clients,
      destination,
      source,
      data: value,
      binary: true,
      maxConnectionBufferedBytes,
      maxGlobalBufferedBytes
    })
  }

  function peerJoinedMessage(mobile) {
    const value = { type: 'peer-joined', peerId: mobile.peerId.toString('hex'), signalingVersion: SIGNALING_VERSION }
    if (mobile.capabilities.length) value.capabilities = [...mobile.capabilities]
    return value
  }

  function withDesktopCapabilities(value, desktop) {
    if (desktop?.capabilities?.length) value.desktopCapabilities = [...desktop.capabilities]
    return value
  }

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
    const client = { socket, source, role: '', room: null, peerId: null, capabilities: [], rate: null, pendingHello: true, removed: false }
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
        client.capabilities = sanitizeCapabilities(hello.capabilities)
        client.room = room
        if (client.role === 'desktop') {
          if (room.desktop) {
            client.room = null
            return socket.close(4409, 'desktop already connected')
          }
          room.desktop = client
          finishHello()
          clearTimeout(helloTimer)
          sendJson(socket, { type: 'welcome', version: 1, role: 'desktop', signalingVersion: SIGNALING_VERSION }, socket)
          for (const mobile of room.mobiles.values()) {
            sendJson(mobile.socket, withDesktopCapabilities({ type: 'desktop-online', signalingVersion: SIGNALING_VERSION }, client), socket)
            sendJson(socket, peerJoinedMessage(mobile), mobile.socket)
          }
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
        sendJson(socket, withDesktopCapabilities({ type: 'welcome', version: 1, role: 'mobile', peerId: client.peerId.toString('hex'), desktopOnline: Boolean(room.desktop), signalingVersion: SIGNALING_VERSION }, room.desktop), socket)
        if (room.desktop) sendJson(room.desktop.socket, peerJoinedMessage(client), socket)
        return
      }

      if (!isBinary) {
        let message
        try { message = JSON.parse(String(raw)) } catch { return socket.close(4400, 'invalid control message') }
        if (message.type !== 'signal' || message.version !== SIGNALING_VERSION) return socket.close(4400, 'binary tunnel frames or signal required')
        if (!validSignalPayload(message.payload) || !rateAllowed(client, Buffer.byteLength(String(raw)))) return socket.close(4429, 'signaling limit exceeded')
        if (client.role === 'mobile') {
          if (message.target !== 'desktop') return socket.close(4403, 'mobile signal target denied')
          const destination = client.room.desktop?.socket
          if (destination?.readyState === WebSocket.OPEN) {
            sendJson(destination, { type: 'signal', version: SIGNALING_VERSION, source: client.peerId.toString('hex'), payload: message.payload }, socket)
          }
          return
        }
        if (!/^[a-f0-9]{16}$/.test(String(message.target || ''))) return socket.close(4403, 'desktop signal target denied')
        const destination = client.room.mobiles.get(message.target)?.socket
        if (destination?.readyState === WebSocket.OPEN) {
          sendJson(destination, { type: 'signal', version: SIGNALING_VERSION, source: 'desktop', payload: message.payload }, socket)
        }
        return
      }
      const packet = Buffer.from(raw)
      if (packet.length < 8 || packet.length > MAX_ENVELOPE_BYTES || !rateAllowed(client, packet.length)) return socket.close(4429, 'relay limit exceeded')
      if (client.role === 'mobile') {
        if (!packet.subarray(0, 8).equals(DESKTOP_PEER_ID) || !client.room.desktop) return
        const destination = client.room.desktop.socket
        if (destination.readyState === WebSocket.OPEN) sendBinary(destination, Buffer.concat([client.peerId, packet.subarray(8)]), socket)
        return
      }
      const peerHex = packet.subarray(0, 8).toString('hex')
      const destination = client.room.mobiles.get(peerHex)?.socket
      if (destination?.readyState === WebSocket.OPEN) sendBinary(destination, Buffer.concat([DESKTOP_PEER_ID, packet.subarray(8)]), socket)
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
      response.end('{"ok":true,"protocolVersion":1,"signalingVersion":1}')
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
  KNOWN_CAPABILITIES,
  MAX_CONNECTION_BUFFERED_BYTES,
  MAX_CONNECTIONS_PER_SOURCE,
  MAX_ENVELOPE_BYTES,
  MAX_GLOBAL_BUFFERED_BYTES,
  MAX_MOBILE_PEERS_PER_ROOM,
  MAX_SIGNAL_PAYLOAD_CHARS,
  MAX_PENDING_HELLOS,
  MAX_ROOMS,
  MAX_TOTAL_CONNECTIONS,
  RATE_WINDOW_BYTES,
  SIGNALING_VERSION,
  createHealthServer,
  createRelayRouter,
  rateAllowed,
  relaySourceAddress,
  sanitizeCapabilities,
  sendBounded,
  validRoomId,
  validSignalPayload
}
