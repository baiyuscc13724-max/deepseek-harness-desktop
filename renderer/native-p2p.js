'use strict'

const { ipcRenderer } = require('electron')

const COMMAND_CHANNEL = 'native-p2p:command'
const EVENT_CHANNEL = 'native-p2p:event'
const MAX_SIGNAL_PAYLOAD_CHARS = 48 * 1024
const MAX_ICE_CANDIDATES = 128
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024
const MAX_TUNNEL_PACKET_BYTES = 64 * 1024 + 64
const MAX_SIGNAL_REPLAY_NONCES = 4096
const MAX_PEERS = 32
const DEFAULT_ICE_SERVERS = [{ urls: ['stun:stun.cloudflare.com:3478'] }]

let socket = null
let config = null
let signalKey = null
let signalingEnabled = false
let iceServers = DEFAULT_ICE_SERVERS
const peers = new Map()
const seenSignalNonces = new Set()
const seenSignalNonceOrder = []

function emit(type, payload = {}) { ipcRenderer.send(EVENT_CHANNEL, { type, ...payload }) }
function validPeerId(value) { return /^[a-f0-9]{16}$/.test(String(value || '')) }
function peerBytes(peerId) {
  const bytes = new Uint8Array(8)
  for (let index = 0; index < 8; index += 1) bytes[index] = Number.parseInt(peerId.slice(index * 2, index * 2 + 2), 16)
  return bytes
}
function bytesToHex(bytes) { return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('') }
function decodeBase64(value) { return Uint8Array.from(Buffer.from(String(value || ''), 'base64')) }
function encodeBase64(value) { return Buffer.from(value).toString('base64') }
function encodeBase64Url(value) { return Buffer.from(value).toString('base64url') }
function validNonce(value, bytes = 32) { return /^[A-Za-z0-9_-]+$/.test(String(value || '')) && Buffer.from(String(value), 'base64url').length === bytes }
function sessionTranscript(peerId, desktopNonce, mobileNonce) {
  if (!validPeerId(peerId) || !validNonce(desktopNonce) || !validNonce(mobileNonce)) throw new Error('Native P2P session transcript is invalid.')
  return new TextEncoder().encode(`native-p2p-v2\n${config.roomId}\n${peerId}\n${desktopNonce}\n${mobileNonce}`)
}
async function expectedSessionId(peerId, desktopNonce, mobileNonce) {
  return encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', sessionTranscript(peerId, desktopNonce, mobileNonce))).subarray(0, 16))
}
function safeIceServers(value) {
  if (!Array.isArray(value) || value.length > 8) return DEFAULT_ICE_SERVERS
  const result = []
  for (const entry of value) {
    const urls = (Array.isArray(entry?.urls) ? entry.urls : [entry?.urls]).filter(url => /^stun:[^\s]{1,500}$/.test(String(url || ''))).slice(0, 8)
    if (urls.length) result.push({ urls })
  }
  return result.length ? result : DEFAULT_ICE_SERVERS
}
async function importSignalKey(value) {
  const raw = Buffer.from(String(value || ''), 'base64url')
  if (raw.byteLength !== 32) throw new Error('Native P2P signal key is invalid.')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
async function encryptSignal(value) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const content = new TextEncoder().encode(JSON.stringify(value))
  const plain = new Uint8Array(6 + content.byteLength)
  plain[0] = 1
  plain[1] = 2 // RelayTunnelCodec FRAME_TYPES.DATA
  plain.set(content, 6) // stream id 0 is reserved for encrypted signaling
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new Uint8Array([1]), tagLength: 128 }, signalKey, plain))
  const envelope = new Uint8Array(13 + encrypted.byteLength)
  envelope[0] = 1
  envelope.set(nonce, 1)
  envelope.set(encrypted, 13)
  return Buffer.from(envelope).toString('base64url')
}
async function decryptSignal(value) {
  const encoded = String(value || '')
  if (!encoded || encoded.length > MAX_SIGNAL_PAYLOAD_CHARS || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Native P2P signal envelope is invalid.')
  const envelope = new Uint8Array(Buffer.from(encoded, 'base64url'))
  if (envelope.byteLength < 30 || envelope.byteLength > MAX_TUNNEL_PACKET_BYTES || envelope[0] !== 1) throw new Error('Native P2P signal envelope is invalid.')
  const nonceKey = Buffer.from(envelope.subarray(1, 13)).toString('hex')
  if (seenSignalNonces.has(nonceKey)) throw new Error('Native P2P replayed signal was rejected.')
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.subarray(1, 13), additionalData: new Uint8Array([1]), tagLength: 128 }, signalKey, envelope.subarray(13)))
  if (plain.byteLength < 7 || plain[0] !== 1 || plain[1] !== 2 || plain[2] !== 0 || plain[3] !== 0 || plain[4] !== 0 || plain[5] !== 0) {
    throw new Error('Native P2P signal frame is invalid.')
  }
  seenSignalNonces.add(nonceKey)
  seenSignalNonceOrder.push(nonceKey)
  if (seenSignalNonceOrder.length > MAX_SIGNAL_REPLAY_NONCES) seenSignalNonces.delete(seenSignalNonceOrder.shift())
  return JSON.parse(new TextDecoder().decode(plain.subarray(6)))
}
async function sendSignal(peerId, kind, payload = {}) {
  if (!signalingEnabled || !socket || socket.readyState !== WebSocket.OPEN || !validPeerId(peerId) || !signalKey) return false
  const peer = peers.get(peerId)
  const inner = {
    ...payload,
    kind,
    source: 'desktop',
    target: peerId,
    ...(peer?.desktopNonce ? { desktopNonce: peer.desktopNonce } : {}),
    ...(peer?.mobileNonce ? { mobileNonce: peer.mobileNonce } : {})
  }
  const encoded = await encryptSignal(inner)
  if (encoded.length > MAX_SIGNAL_PAYLOAD_CHARS) return false
  const outer = JSON.stringify({ type: 'signal', version: 1, target: peerId, payload: encoded })
  if (socket.bufferedAmount + Buffer.byteLength(outer) > MAX_BUFFERED_BYTES) {
    socket.close(4429, 'signaling backpressure exceeded')
    return false
  }
  socket.send(outer)
  return true
}
function peerPath(peerId, path) { emit('path', { peerId, path }) }
function closePeer(peerId, notify = true) {
  const peer = peers.get(peerId)
  if (!peer) return
  peers.delete(peerId)
  try { peer.channel?.close() } catch {}
  try { peer.connection.close() } catch {}
  if (notify) emit('peer-left', { peerId })
}
function attachChannel(peerId, peer, channel) {
  if (peer.channel && peer.channel !== channel) peer.channel.close()
  peer.channel = channel
  channel.binaryType = 'arraybuffer'
  channel.bufferedAmountLowThreshold = 512 * 1024
  channel.onopen = () => peerPath(peerId, peer.sessionReady ? 'direct' : 'negotiating')
  channel.onclose = () => peerPath(peerId, 'relay')
  channel.onerror = () => peerPath(peerId, 'relay')
  channel.onmessage = event => {
    const packet = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : ArrayBuffer.isView(event.data)
        ? new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
        : null
    if (!packet || packet.byteLength < 1 || packet.byteLength > MAX_TUNNEL_PACKET_BYTES) return
    emit('packet', { peerId, data: encodeBase64(packet), path: 'direct' })
  }
}
function ensurePeer(peerId) {
  if (!validPeerId(peerId)) throw new Error('Invalid native P2P peer id.')
  if (peers.has(peerId)) return peers.get(peerId)
  if (peers.size >= MAX_PEERS) throw new Error('Native P2P peer limit exceeded.')
  const connection = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'all', bundlePolicy: 'max-bundle' })
  const peer = {
    connection,
    channel: null,
    iceCandidates: 0,
    desktopNonce: null,
    pendingMobileNonce: null,
    mobileNonce: null,
    sessionId: null,
    sessionReady: false,
    offerSent: false,
    pendingLocalIce: [],
    signalChain: Promise.resolve()
  }
  peers.set(peerId, peer)
  connection.ondatachannel = event => attachChannel(peerId, peer, event.channel)
  connection.onicecandidate = event => {
    const item = { kind: event.candidate ? 'ice' : 'end-of-candidates', payload: event.candidate ? { candidate: event.candidate.toJSON() } : {} }
    if (!peer.offerSent) {
      if (peer.pendingLocalIce.length < MAX_ICE_CANDIDATES + 1) peer.pendingLocalIce.push(item)
      return
    }
    peer.signalChain = peer.signalChain.then(() => sendSignal(peerId, item.kind, item.payload)).catch(error => emit('error', { message: error.message }))
  }
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'connected' && peer.channel?.readyState === 'open' && peer.sessionReady) peerPath(peerId, 'direct')
    else if (connection.connectionState === 'connecting') peerPath(peerId, 'negotiating')
    else if (['failed', 'disconnected'].includes(connection.connectionState)) peerPath(peerId, 'relay')
    else if (connection.connectionState === 'closed') closePeer(peerId)
  }
  return peer
}
async function createOffer(peerId) {
  peerPath(peerId, 'negotiating')
  const peer = ensurePeer(peerId)
  peer.desktopNonce = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))
  peer.pendingMobileNonce = null
  peer.mobileNonce = null
  peer.sessionId = null
  peer.sessionReady = false
  peer.offerSent = false
  peer.pendingLocalIce = []
  peer.signalChain = Promise.resolve()
  if (!peer.channel) attachChannel(peerId, peer, peer.connection.createDataChannel('harness-sync-v1', { ordered: true }))
  const offer = await peer.connection.createOffer()
  await peer.connection.setLocalDescription(offer)
  if (!await sendSignal(peerId, 'offer', { description: peer.connection.localDescription.toJSON() })) throw new Error('Native P2P offer could not be sent.')
  peer.offerSent = true
  for (const item of peer.pendingLocalIce.splice(0)) {
    peer.signalChain = peer.signalChain.then(() => sendSignal(peerId, item.kind, item.payload)).catch(error => emit('error', { message: error.message }))
  }
}
async function handleSignal(peerId, message) {
  const encoded = JSON.stringify(message)
  if (encoded.length > MAX_SIGNAL_PAYLOAD_CHARS || !validPeerId(peerId)) return
  const peer = peers.get(peerId)
  if (!peer || message?.source !== peerId || message?.target !== 'desktop' || message?.desktopNonce !== peer.desktopNonce) {
    throw new Error('Native P2P signal session binding was rejected.')
  }
  if (message.kind === 'answer') {
    if (peer.sessionReady) throw new Error('Native P2P duplicate answer was rejected.')
    if (message.description?.type !== 'answer' || typeof message.description.sdp !== 'string' || !validNonce(message.mobileNonce)) return
    if (peer.pendingMobileNonce && peer.pendingMobileNonce !== message.mobileNonce) throw new Error('Native P2P answer nonce binding was rejected.')
    const sessionId = await expectedSessionId(peerId, peer.desktopNonce, message.mobileNonce)
    peer.mobileNonce = message.mobileNonce
    peer.sessionId = sessionId
    await peer.connection.setRemoteDescription(message.description)
    peer.sessionReady = true
    emit('session', { peerId, desktopNonce: peer.desktopNonce, mobileNonce: peer.mobileNonce, sessionId })
    if (peer.channel?.readyState === 'open' && peer.connection.connectionState === 'connected') peerPath(peerId, 'direct')
  } else if (message.kind === 'ice' || message.kind === 'end-of-candidates') {
    if (!validNonce(message.mobileNonce)) throw new Error('Native P2P ICE nonce binding was rejected.')
    const expectedMobileNonce = peer.mobileNonce || peer.pendingMobileNonce
    if (expectedMobileNonce && message.mobileNonce !== expectedMobileNonce) throw new Error('Native P2P ICE nonce binding was rejected.')
    if (!peer.mobileNonce) peer.pendingMobileNonce = message.mobileNonce
    if (message.kind === 'ice') {
      if (++peer.iceCandidates > MAX_ICE_CANDIDATES || typeof message.candidate?.candidate !== 'string') return
      await peer.connection.addIceCandidate(message.candidate)
    } else await peer.connection.addIceCandidate(null).catch(() => {})
  }
}
function sendPacket({ peerId, data, path, streamId }) {
  if (!validPeerId(peerId) || !['direct', 'relay'].includes(path) || !Number.isSafeInteger(streamId) || streamId < 0 || streamId > 0xffffffff) return
  const encoded = String(data || '')
  if (encoded.length > Math.ceil(MAX_TUNNEL_PACKET_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return
  const packet = decodeBase64(encoded)
  if (packet.byteLength < 1 || packet.byteLength > MAX_TUNNEL_PACKET_BYTES) return
  if (path === 'direct') {
    const channel = peers.get(peerId)?.channel
    if (channel?.readyState === 'open' && channel.bufferedAmount + packet.byteLength <= MAX_BUFFERED_BYTES) {
      channel.send(packet)
      return
    }
  } else if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount + packet.byteLength + 8 <= MAX_BUFFERED_BYTES) {
    const envelope = new Uint8Array(packet.byteLength + 8)
    envelope.set(peerBytes(peerId), 0)
    envelope.set(packet, 8)
    socket.send(envelope)
    return
  }
  emit('stream-failed', { peerId, streamId, path })
}
function stop() {
  for (const peerId of [...peers.keys()]) closePeer(peerId, false)
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'desktop stopping')
  socket = null
  config = null
  signalKey = null
  signalingEnabled = false
  iceServers = DEFAULT_ICE_SERVERS
  seenSignalNonces.clear()
  seenSignalNonceOrder.length = 0
}
async function start(next) {
  stop()
  config = next
  if (!/^wss:\/\//.test(String(config?.relayUrl || '')) || !/^[A-Za-z0-9_-]{43}$/.test(String(config?.roomId || ''))) {
    emit('error', { message: 'Native P2P configuration is invalid.' })
    return
  }
  signalKey = await importSignalKey(config.signalKey)
  const current = new WebSocket(config.relayUrl)
  socket = current
  current.binaryType = 'arraybuffer'
  current.onopen = () => current.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId: config.roomId, capabilities: ['native-p2p-v2'] }))
  let messageChain = Promise.resolve()
  current.onmessage = event => {
    messageChain = messageChain.then(async () => {
      if (socket !== current) return
      if (typeof event.data !== 'string') {
        const envelope = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null
        if (!envelope || envelope.byteLength < 9 || envelope.byteLength > 8 + MAX_TUNNEL_PACKET_BYTES) return
        const peerId = bytesToHex(envelope.subarray(0, 8))
        if (validPeerId(peerId)) emit('packet', { peerId, data: encodeBase64(envelope.subarray(8)), path: 'relay' })
        return
      }
      if (event.data.length > MAX_SIGNAL_PAYLOAD_CHARS + 1024) return
      let message
      try { message = JSON.parse(event.data) } catch { return }
      if (message.type === 'welcome' && message.role === 'desktop') {
        signalingEnabled = message.signalingVersion === 1
        iceServers = signalingEnabled ? safeIceServers(message.iceServers) : DEFAULT_ICE_SERVERS
        emit('relay-ready')
      } else if (signalingEnabled && message.type === 'signal' && message.version === 1 && validPeerId(message.source)) {
        await handleSignal(message.source, await decryptSignal(message.payload))
      } else if (signalingEnabled && message.type === 'peer-joined' && validPeerId(message.peerId) && Array.isArray(message.capabilities) && message.capabilities.includes('native-p2p-v2')) {
        await createOffer(message.peerId)
      } else if (message.type === 'peer-left' && validPeerId(message.peerId)) closePeer(message.peerId)
      else if (message.type === 'error') emit('error', { message: String(message.message || 'P2P signaling rejected.') })
    }).catch(error => emit('error', { message: error.message }))
  }
  current.onerror = () => emit('error', { message: 'Native P2P signaling socket failed.' })
  current.onclose = () => { if (socket === current) { socket = null; emit('closed') } }
}

ipcRenderer.on(COMMAND_CHANNEL, (_event, command) => {
  if (command?.type === 'start') start(command.payload).catch(error => emit('error', { message: error.message }))
  else if (command?.type === 'packet') sendPacket(command.payload || {})
  else if (command?.type === 'stop') stop()
})
emit('ready')
