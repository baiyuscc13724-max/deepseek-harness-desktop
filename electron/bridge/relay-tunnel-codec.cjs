const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto')

const RELAY_TUNNEL_VERSION = 1
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

module.exports = {
  FRAME_TYPES,
  RELAY_MAX_PACKET_BYTES,
  RELAY_MAX_PAYLOAD_BYTES,
  RELAY_TUNNEL_VERSION,
  RelayTunnelCodec,
  decodePlainFrame,
  decodeTunnelKey,
  encodePlainFrame
}
