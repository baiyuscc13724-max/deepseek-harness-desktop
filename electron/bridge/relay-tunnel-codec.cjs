const { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } = require('node:crypto')

const RELAY_TUNNEL_VERSION = 1
const NATIVE_P2P_TUNNEL_VERSION = 2
const NATIVE_P2P_DIRECTION = Object.freeze({ DESKTOP_TO_MOBILE: 1, MOBILE_TO_DESKTOP: 2 })
const NATIVE_P2P_REPLAY_WINDOW = 4096n
const NATIVE_P2P_REPLAY_MASK = (1n << NATIVE_P2P_REPLAY_WINDOW) - 1n
const RELAY_MAX_PAYLOAD_BYTES = 64 * 1024
const RELAY_MAX_PACKET_BYTES = RELAY_MAX_PAYLOAD_BYTES + 64
const FRAME_TYPES = Object.freeze({ OPEN: 1, DATA: 2, FIN: 3, RESET: 4, PING: 5, PONG: 6 })
const FRAME_TYPE_VALUES = new Set(Object.values(FRAME_TYPES))

function decodeTunnelKey(value) {
  const key = Buffer.from(String(value || ''), 'base64url')
  if (key.length !== 32) throw new Error('WSS relay tunnel key must contain 32 bytes.')
  return key
}

function encodePlainFrame(type, streamId, payload = Buffer.alloc(0)) {
  if (!FRAME_TYPE_VALUES.has(type)) throw new Error('WSS relay frame type is invalid.')
  if (!Number.isSafeInteger(streamId) || streamId < 0 || streamId > 0xffffffff) throw new Error('WSS relay stream id is invalid.')
  const content = Buffer.from(payload)
  if (content.length > RELAY_MAX_PAYLOAD_BYTES) throw new Error('WSS relay frame payload exceeds the limit.')
  const frame = Buffer.allocUnsafe(6 + content.length)
  frame[0] = RELAY_TUNNEL_VERSION
  frame[1] = type
  frame.writeUInt32BE(streamId, 2)
  content.copy(frame, 6)
  return frame
}

function decodePlainFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 6 || frame.length > RELAY_MAX_PAYLOAD_BYTES + 6) throw new Error('WSS relay frame size is invalid.')
  if (frame[0] !== RELAY_TUNNEL_VERSION || !FRAME_TYPE_VALUES.has(frame[1])) throw new Error('WSS relay frame header is invalid.')
  return { type: frame[1], streamId: frame.readUInt32BE(2), payload: frame.subarray(6) }
}

function encodeNativeP2pPlainFrame(type, streamId, payload = Buffer.alloc(0)) {
  const frame = encodePlainFrame(type, streamId, payload)
  frame[0] = NATIVE_P2P_TUNNEL_VERSION
  return frame
}

function decodeNativeP2pPlainFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 6 || frame.length > RELAY_MAX_PAYLOAD_BYTES + 6) throw new Error('Native P2P frame size is invalid.')
  if (frame[0] !== NATIVE_P2P_TUNNEL_VERSION || !FRAME_TYPE_VALUES.has(frame[1])) throw new Error('Native P2P frame header is invalid.')
  return { type: frame[1], streamId: frame.readUInt32BE(2), payload: frame.subarray(6) }
}

class RelayTunnelCodec {
  constructor(key, { randomBytesImpl = randomBytes, replayWindow = 4096 } = {}) {
    this.key = Buffer.isBuffer(key) ? Buffer.from(key) : decodeTunnelKey(key)
    if (this.key.length !== 32) throw new Error('WSS relay tunnel key must contain 32 bytes.')
    this.randomBytes = randomBytesImpl
    this.replayWindow = replayWindow
    this.seen = new Set()
    this.seenOrder = []
  }

  encode(type, streamId, payload) {
    const plain = encodePlainFrame(type, streamId, payload)
    const nonce = this.randomBytes(12)
    if (!Buffer.isBuffer(nonce) || nonce.length !== 12) throw new Error('WSS relay nonce generator failed.')
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(Buffer.from([RELAY_TUNNEL_VERSION]))
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([Buffer.from([RELAY_TUNNEL_VERSION]), nonce, encrypted, tag])
  }

  decode(packet) {
    const value = Buffer.from(packet)
    if (value.length < 1 + 12 + 6 + 16 || value.length > RELAY_MAX_PACKET_BYTES || value[0] !== RELAY_TUNNEL_VERSION) {
      throw new Error('WSS relay encrypted packet is invalid.')
    }
    const nonce = value.subarray(1, 13)
    const replayKey = nonce.toString('hex')
    if (this.seen.has(replayKey)) throw new Error('WSS relay replayed packet was rejected.')
    const tag = value.subarray(value.length - 16)
    const encrypted = value.subarray(13, value.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce)
    decipher.setAAD(Buffer.from([RELAY_TUNNEL_VERSION]))
    decipher.setAuthTag(tag)
    let plain
    try { plain = Buffer.concat([decipher.update(encrypted), decipher.final()]) }
    catch { throw new Error('WSS relay packet authentication failed.') }
    this.seen.add(replayKey)
    this.seenOrder.push(replayKey)
    if (this.seenOrder.length > this.replayWindow) this.seen.delete(this.seenOrder.shift())
    return decodePlainFrame(plain)
  }
}

function nativeP2pTranscript({ roomId, peerId, desktopNonce, mobileNonce }) {
  const room = String(roomId || '')
  const peer = String(peerId || '')
  const desktop = String(desktopNonce || '')
  const mobile = String(mobileNonce || '')
  if (!/^[A-Za-z0-9_-]{43}$/.test(room)) throw new Error('Native P2P room id is invalid.')
  if (!/^[a-f0-9]{16}$/.test(peer)) throw new Error('Native P2P peer id is invalid.')
  if (Buffer.from(desktop, 'base64url').length !== 32 || !/^[A-Za-z0-9_-]{43}$/.test(desktop)) throw new Error('Native P2P desktop nonce is invalid.')
  if (Buffer.from(mobile, 'base64url').length !== 32 || !/^[A-Za-z0-9_-]{43}$/.test(mobile)) throw new Error('Native P2P mobile nonce is invalid.')
  return Buffer.from(`native-p2p-v2\n${room}\n${peer}\n${desktop}\n${mobile}`, 'ascii')
}

function deriveNativeP2pSession(roomKey, fields) {
  const key = Buffer.isBuffer(roomKey) ? Buffer.from(roomKey) : decodeTunnelKey(roomKey)
  if (key.length !== 32) throw new Error('Native P2P room key must contain 32 bytes.')
  const transcript = nativeP2pTranscript(fields)
  return {
    transcript,
    sessionKey: createHmac('sha256', key).update(transcript).digest(),
    sessionId: createHash('sha256').update(transcript).digest().subarray(0, 16)
  }
}

function nativeP2pPeerBuffer(value) {
  const peer = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'hex')
  if (peer.length !== 8) throw new Error('Native P2P peer id is invalid.')
  return peer
}

function nativeP2pSessionIdBuffer(value) {
  const sessionId = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'base64url')
  if (sessionId.length !== 16) throw new Error('Native P2P session id is invalid.')
  return sessionId
}

class NativeP2pSessionCodec {
  constructor(key, {
    sessionId,
    peerId,
    sendDirection,
    receiveDirection,
    randomBytesImpl = randomBytes,
    initialSequence = 0n
  }) {
    this.key = Buffer.isBuffer(key) ? Buffer.from(key) : Buffer.from(String(key || ''), 'base64url')
    if (this.key.length !== 32) throw new Error('Native P2P session key must contain 32 bytes.')
    this.sessionId = nativeP2pSessionIdBuffer(sessionId)
    this.peerId = nativeP2pPeerBuffer(peerId)
    if (![1, 2].includes(sendDirection) || ![1, 2].includes(receiveDirection) || sendDirection === receiveDirection) throw new Error('Native P2P directions are invalid.')
    this.sendDirection = sendDirection
    this.receiveDirection = receiveDirection
    this.randomBytes = randomBytesImpl
    this.sendSequence = BigInt(initialSequence)
    if (this.sendSequence < 0n || this.sendSequence > 0xffffffffffffffffn) throw new Error('Native P2P initial sequence is invalid.')
    this.receiveHighest = -1n
    this.receiveBitmap = 0n
  }

  #aad(header) { return Buffer.concat([header, this.peerId, this.sessionId]) }

  encode(type, streamId, payload) {
    if (this.sendSequence > 0xffffffffffffffffn) throw new Error('Native P2P sequence exhausted.')
    const plain = encodeNativeP2pPlainFrame(type, streamId, payload)
    const header = Buffer.allocUnsafe(10)
    header[0] = NATIVE_P2P_TUNNEL_VERSION
    header[1] = this.sendDirection
    header.writeBigUInt64BE(this.sendSequence, 2)
    this.sendSequence += 1n
    const nonce = this.randomBytes(12)
    if (!Buffer.isBuffer(nonce) || nonce.length !== 12) throw new Error('Native P2P nonce generator failed.')
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce)
    cipher.setAAD(this.#aad(header))
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
    return Buffer.concat([header, nonce, encrypted, cipher.getAuthTag()])
  }

  #acceptSequence(sequence) {
    if (this.receiveHighest < 0n) {
      this.receiveHighest = sequence
      this.receiveBitmap = 1n
      return
    }
    if (sequence > this.receiveHighest) {
      const shift = sequence - this.receiveHighest
      this.receiveBitmap = shift >= NATIVE_P2P_REPLAY_WINDOW ? 1n : ((this.receiveBitmap << shift) | 1n) & NATIVE_P2P_REPLAY_MASK
      this.receiveHighest = sequence
      return
    }
    const delta = this.receiveHighest - sequence
    if (delta >= NATIVE_P2P_REPLAY_WINDOW) throw new Error('Native P2P packet is outside the replay window.')
    const bit = 1n << delta
    if ((this.receiveBitmap & bit) !== 0n) throw new Error('Native P2P replayed packet was rejected.')
    this.receiveBitmap |= bit
  }

  decode(packet) {
    const value = Buffer.from(packet)
    if (value.length < 10 + 12 + 6 + 16 || value.length > RELAY_MAX_PACKET_BYTES || value[0] !== NATIVE_P2P_TUNNEL_VERSION) throw new Error('Native P2P encrypted packet is invalid.')
    if (value[1] !== this.receiveDirection) throw new Error('Native P2P packet direction was rejected.')
    const header = value.subarray(0, 10)
    const sequence = header.readBigUInt64BE(2)
    const nonce = value.subarray(10, 22)
    const tag = value.subarray(value.length - 16)
    const encrypted = value.subarray(22, value.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce)
    decipher.setAAD(this.#aad(header))
    decipher.setAuthTag(tag)
    let plain
    try { plain = Buffer.concat([decipher.update(encrypted), decipher.final()]) }
    catch { throw new Error('Native P2P packet authentication failed.') }
    this.#acceptSequence(sequence)
    return { ...decodeNativeP2pPlainFrame(plain), sequence }
  }
}

module.exports = {
  FRAME_TYPES,
  NATIVE_P2P_DIRECTION,
  NATIVE_P2P_REPLAY_WINDOW,
  NATIVE_P2P_TUNNEL_VERSION,
  NativeP2pSessionCodec,
  RELAY_MAX_PACKET_BYTES,
  RELAY_MAX_PAYLOAD_BYTES,
  RELAY_TUNNEL_VERSION,
  RelayTunnelCodec,
  decodePlainFrame,
  decodeTunnelKey,
  deriveNativeP2pSession,
  encodePlainFrame,
  nativeP2pTranscript
}
