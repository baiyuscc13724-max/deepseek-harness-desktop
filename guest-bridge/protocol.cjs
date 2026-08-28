'use strict'

const crypto = require('node:crypto')
const { fail } = require('./errors.cjs')

const PROTOCOL_NAME = 'dsh.guest-bridge'
const PROTOCOL_VERSION = 1
const MAX_FRAME_BYTES = 256 * 1024
const MAX_ID_LENGTH = 96
const ACTIONS = Object.freeze([
  'capabilities.describe',
  'file.read', 'file.list', 'file.stat',
  'process.list', 'process.signal',
  'log.read',
  'ui.snapshot', 'ui.query', 'ui.invoke', 'ui.setValue'
])
const ACTION_SET = new Set(ACTIONS)

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateId(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_ID_LENGTH || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
    fail('invalid-frame', `${field} must be an opaque ASCII identifier`)
  }
  return value
}

function decodeFrame(input) {
  let text
  if (Buffer.isBuffer(input)) {
    if (input.byteLength > MAX_FRAME_BYTES) fail('frame-too-large', 'Guest Bridge frame exceeds the size limit')
    text = input.toString('utf8')
  } else if (typeof input === 'string') {
    if (Buffer.byteLength(input, 'utf8') > MAX_FRAME_BYTES) fail('frame-too-large', 'Guest Bridge frame exceeds the size limit')
    text = input
  } else {
    fail('invalid-frame', 'Guest Bridge frame must be UTF-8 JSON')
  }
  let parsed
  try { parsed = JSON.parse(text) } catch { fail('invalid-json', 'Guest Bridge frame is not valid JSON') }
  return validateFrame(parsed)
}

function validateFrame(frame) {
  if (!isRecord(frame)) fail('invalid-frame', 'Guest Bridge frame must be an object')
  if (frame.protocol !== PROTOCOL_NAME || frame.version !== PROTOCOL_VERSION) {
    fail('unsupported-protocol', 'Guest Bridge protocol or version is unsupported', { supportedVersion: PROTOCOL_VERSION })
  }
  const type = frame.type
  if (!['request', 'response', 'event'].includes(type)) fail('invalid-frame', 'Unknown Guest Bridge frame type')
  validateId(frame.id, 'id')
  if (type === 'request') {
    if (!ACTION_SET.has(frame.action)) fail('unsupported-action', 'Guest Bridge action is not supported')
    if (frame.params !== undefined && !isRecord(frame.params)) fail('invalid-frame', 'request params must be an object')
  } else if (type === 'response') {
    if (typeof frame.ok !== 'boolean') fail('invalid-frame', 'response ok must be boolean')
    if (!frame.ok && (!isRecord(frame.error) || typeof frame.error.code !== 'string')) fail('invalid-frame', 'failed response must contain a coded error')
  } else if (typeof frame.event !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/u.test(frame.event)) {
    fail('invalid-frame', 'event name is invalid')
  }
  return frame
}

function encodeFrame(frame) {
  const validated = validateFrame(frame)
  const encoded = JSON.stringify(validated)
  if (Buffer.byteLength(encoded, 'utf8') > MAX_FRAME_BYTES) fail('frame-too-large', 'Guest Bridge frame exceeds the size limit')
  return encoded
}

class PairingSession {
  constructor(options = {}) {
    this.clock = options.clock || Date.now
    this.randomBytes = options.randomBytes || crypto.randomBytes
    this.ttlMs = Number.isSafeInteger(options.ttlMs) ? options.ttlMs : 2 * 60 * 1000
    this.maxAttempts = Number.isSafeInteger(options.maxAttempts) ? options.maxAttempts : 5
    this.sessions = new Map()
  }

  create(peerFingerprint) {
    validateId(peerFingerprint, 'peerFingerprint')
    const id = this.randomBytes(18).toString('base64url')
    const secret = this.randomBytes(32)
    const code = String(secret.readUInt32BE(0) % 1000000).padStart(6, '0')
    const salt = this.randomBytes(16)
    const codeDigest = crypto.scryptSync(code, salt, 32)
    const createdAt = this.clock()
    this.sessions.set(id, { peerFingerprint, secret, salt, codeDigest, createdAt, expiresAt: createdAt + this.ttlMs, attempts: 0 })
    return {
      offer: { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, pairingId: id, peerFingerprint, expiresAt: createdAt + this.ttlMs },
      // This value is for a trusted, local user-confirmation surface only; never transmit it to the peer.
      userCode: code
    }
  }

  confirm({ pairingId, peerFingerprint, userCode }) {
    const item = this.sessions.get(pairingId)
    if (!item) fail('pairing-not-found', 'Pairing request was not found')
    if (this.clock() >= item.expiresAt) {
      this.sessions.delete(pairingId)
      fail('pairing-expired', 'Pairing request expired')
    }
    if (item.peerFingerprint !== peerFingerprint) fail('peer-mismatch', 'Pairing is bound to another peer')
    item.attempts += 1
    if (typeof userCode !== 'string' || !/^\d{6}$/u.test(userCode)) fail('pairing-code-invalid', 'Pairing code is invalid')
    const candidate = crypto.scryptSync(userCode, item.salt, 32)
    if (!crypto.timingSafeEqual(candidate, item.codeDigest)) {
      if (item.attempts >= this.maxAttempts) this.sessions.delete(pairingId)
      fail('pairing-code-invalid', 'Pairing code is invalid')
    }
    this.sessions.delete(pairingId)
    return crypto.createHmac('sha256', item.secret).update(`${pairingId}\0${peerFingerprint}`).digest('base64url')
  }
}

module.exports = {
  PROTOCOL_NAME, PROTOCOL_VERSION, MAX_FRAME_BYTES, ACTIONS,
  decodeFrame, encodeFrame, validateFrame, PairingSession
}
