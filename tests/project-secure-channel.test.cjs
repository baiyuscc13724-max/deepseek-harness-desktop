const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash, sign: cryptoSign } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-secure-channel.js')).href
const PROJECT = `project_${'A'.repeat(26)}`
const SENDER = `device_${'B'.repeat(26)}`
const TARGET = `device_${'C'.repeat(26)}`
const OTHER = `device_${'D'.repeat(26)}`

async function fixture(overrides = {}) {
  const mod = await import(moduleUrl)
  const sender = mod.generateProjectTransportKeys()
  const recipient = mod.generateProjectTransportKeys()
  let now = 60_000_000
  let tlsChecks = 0
  const channel = new mod.ProjectSecureChannel({
    projectRef: PROJECT,
    authorityEpoch: 3,
    targetDeviceRef: TARGET,
    recipientEncryptionPrivateKey: recipient.encryption.privateKey,
    resolveSenderSigningKey: (deviceRef, keyId) => deviceRef === SENDER && keyId ? sender.signing.publicKey : undefined,
    verifyTlsPeer: (peer, expected) => {
      tlsChecks += 1
      return peer?.certificateRef === 'cert_pinned_sender' && expected.senderDeviceRef === SENDER && expected.targetDeviceRef === TARGET
    },
    now: () => now,
    ...overrides
  })
  function seal(transport = 'remote_wss', payload = { type: 'project.event', deviceRef: SENDER, taskRef: 'task_opaque' }, input = {}) {
    return mod.sealProjectPacket({
      projectRef: PROJECT,
      authorityEpoch: 3,
      senderDeviceRef: SENDER,
      targetDeviceRef: TARGET,
      transport,
      payload,
      senderSigningPrivateKey: sender.signing.privateKey,
      recipientEncryptionPublicKey: recipient.encryption.publicKey,
      createdAt: now,
      expiresAt: now + 60_000,
      ...input
    })
  }
  return { mod, sender, recipient, channel, seal, setNow: value => { now = value }, tlsChecks: () => tlsChecks }
}

test('remote WSS packets expose only opaque routing metadata and decrypt exact lossless payloads', async () => {
  const state = await fixture()
  const packet = state.seal()
  const serialized = JSON.stringify(packet)
  assert.equal(serialized.includes('task_opaque'), false)
  assert.equal(serialized.includes('project.event'), false)
  assert.equal(serialized.includes('sessionId'), false)
  assert.equal(packet.hop, 0)
  assert.equal(packet.fanout, 1)
  assert.match(packet.packetRef, /^packet_/u)
  const opened = state.channel.open(JSON.parse(serialized))
  assert.deepEqual(opened.payload, { type: 'project.event', deviceRef: SENDER, taskRef: 'task_opaque' })
  assert.equal(opened.senderDeviceRef, SENDER)
  assert.equal(opened.targetDeviceRef, TARGET)
  assert.equal(state.tlsChecks(), 0)
})

test('LAN packets require a pinned mTLS peer in addition to E2EE and sender signature', async () => {
  const state = await fixture()
  const packet = state.seal('lan_mtls')
  assert.throws(() => state.channel.open(packet), /requires an authenticated pinned mTLS peer/u)
  assert.throws(() => state.channel.open(packet, { tlsPeer: { certificateRef: 'cert_wrong' } }), /requires an authenticated pinned mTLS peer/u)
  const opened = state.channel.open(packet, { tlsPeer: { certificateRef: 'cert_pinned_sender' } })
  assert.equal(opened.transport, 'lan_mtls')
  assert.equal(state.tlsChecks(), 3)
})

test('ciphertext, signature, exact target, key, and epoch tampering fail closed', async () => {
  const state = await fixture()
  const packet = state.seal()
  const ciphertextTamper = { ...packet, ciphertext: `${packet.ciphertext[0] === 'A' ? 'B' : 'A'}${packet.ciphertext.slice(1)}` }
  assert.throws(() => state.channel.open(ciphertextTamper), /ciphertext digest is invalid|packet reference is invalid|signature is invalid/u)
  const signatureTamper = { ...packet, signature: `${packet.signature[0] === 'A' ? 'B' : 'A'}${packet.signature.slice(1)}` }
  assert.throws(() => state.channel.open(signatureTamper), /signature is invalid/u)
  assert.throws(() => state.channel.open({ ...packet, targetDeviceRef: OTHER }), /scope, epoch, or exact target is invalid/u)
  assert.throws(() => state.channel.open({ ...packet, authorityEpoch: 4 }), /scope, epoch, or exact target is invalid/u)
  assert.throws(() => state.channel.open({ ...packet, recipientEncryptionKeyId: `key_${'Z'.repeat(43)}` }), /targets another encryption key/u)
})

test('authenticated packets are accepted exactly once and replay memory stays private', async () => {
  const state = await fixture()
  const packet = state.seal()
  state.channel.open(packet)
  assert.throws(() => state.channel.open(packet), error => error?.code === 'PROJECT_PACKET_REPLAY')
  assert.equal(state.mod.PACKET_REPLAY_SCOPE, 'channel_instance')
  const reconnected = new state.mod.ProjectSecureChannel({
    projectRef: PROJECT, authorityEpoch: 3, targetDeviceRef: TARGET,
    recipientEncryptionPrivateKey: state.recipient.encryption.privateKey,
    resolveSenderSigningKey: () => state.sender.signing.publicKey,
    now: () => 60_000_000,
  })
  assert.deepEqual(reconnected.open(packet).payload, { type: 'project.event', deviceRef: SENDER, taskRef: 'task_opaque' }, 'packet replay memory resets with a new channel; durable business idempotency must handle reconnects')
  const projection = JSON.stringify(state.channel)
  assert.equal(projection.includes(packet.packetRef), false)
  assert.equal(projection.includes('PRIVATE KEY'), false)
})

test('payload gate is deeply bounded, descriptor-safe, lossless, and permits shared non-cyclic JSON', async () => {
  const state = await fixture()
  assert.equal(state.mod.MAX_PAYLOAD_DEPTH, 32)
  let allowed = 'leaf'
  for (let index = 0; index < 32; index += 1) allowed = { next: allowed }
  assert.doesNotThrow(() => state.seal('remote_wss', allowed))
  let tooDeep = { next: allowed }
  assert.throws(() => state.seal('remote_wss', tooDeep), /maximum depth/u)

  let getterCalls = 0
  const accessor = {}
  Object.defineProperty(accessor, 'value', { enumerable: true, get() { getterCalls += 1; return 'secret' } })
  const hidden = {}
  Object.defineProperty(hidden, 'value', { enumerable: false, value: 'secret' })
  const symbolKey = { safe: true }; symbolKey[Symbol('hidden')] = 'secret'
  const customArray = [1]; customArray.extra = 2
  const sparse = []; sparse.length = 1
  class Payload { constructor() { this.value = 1 } }
  for (const [index, invalid] of [
    -0, () => {}, Symbol('value'), { value: -0 }, { value: undefined }, { value: () => {} }, { value: Symbol('value') },
    accessor, hidden, symbolKey, customArray, sparse, new Payload(), new Date(),
  ].entries()) assert.throws(() => state.seal('remote_wss', invalid), undefined, `invalid payload ${index} must be rejected`)
  assert.equal(getterCalls, 0, 'payload validation must never execute accessors')
  const cycle = {}; cycle.self = cycle
  assert.throws(() => state.seal('remote_wss', cycle), /cycle/u)
  const shared = { value: 1 }
  const packet = state.seal('remote_wss', { left: shared, right: shared })
  assert.deepEqual(state.channel.open(packet).payload, { left: { value: 1 }, right: { value: 1 } })
  let inheritedToJsonCalls = 0
  const objectHook = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON'), arrayHook = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { inheritedToJsonCalls += 1; return { replaced: true } } })
  Object.defineProperty(Array.prototype, 'toJSON', { configurable: true, value() { inheritedToJsonCalls += 1; return ['replaced'] } })
  try {
    const inheritedPacket = state.seal('remote_wss', { safe: 'value', list: [1, 2] })
    assert.deepEqual(state.channel.open(inheritedPacket).payload, { safe: 'value', list: [1, 2] })
  } finally {
    if (objectHook === undefined) delete Object.prototype.toJSON; else Object.defineProperty(Object.prototype, 'toJSON', objectHook)
    if (arrayHook === undefined) delete Array.prototype.toJSON; else Object.defineProperty(Array.prototype, 'toJSON', arrayHook)
  }
  assert.equal(inheritedToJsonCalls, 0, 'inherited toJSON hooks must never execute')
  assert.throws(() => state.seal('remote_wss', { value: 'x'.repeat(state.mod.MAX_PACKET_BYTES) }), /payload exceeds/u)
  assert.throws(() => state.seal('remote_wss', { value: '\u0000'.repeat(50_000) }), /payload exceeds/u, 'escaped encoded size is bounded during preflight')
})

test('packet key, shared secret, salt, info, AAD, and plaintext buffers are cleared on success and failure', async () => {
  const state = await fixture()
  const observeClears = (operation) => {
    const original = Buffer.prototype.fill
    const cleared = []
    Buffer.prototype.fill = function (value, ...args) {
      const result = original.call(this, value, ...args)
      if (value === 0) cleared.push(this)
      return result
    }
    try { return { result: operation(), cleared } } finally { Buffer.prototype.fill = original }
  }
  const sealed = observeClears(() => state.seal('remote_wss', { type: 'sensitive', value: 'plaintext' }))
  assert.ok(sealed.cleared.length >= 6)
  for (const buffer of sealed.cleared) assert.ok(buffer.every(byte => byte === 0))
  const ciphertext = sealed.result.ciphertext
  const opened = observeClears(() => state.channel.open(sealed.result))
  assert.equal(opened.result.payload.value, 'plaintext')
  assert.equal(sealed.result.ciphertext, ciphertext, 'caller-visible ciphertext must not be cleared')
  assert.ok(opened.cleared.length >= 7)
  for (const buffer of opened.cleared) assert.ok(buffer.every(byte => byte === 0))

  const other = await fixture()
  const valid = other.seal()
  const canonical = value => value === null || typeof value !== 'object'
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  const headerKeys = ['version', 'algorithm', 'projectRef', 'authorityEpoch', 'senderDeviceRef', 'targetDeviceRef', 'senderSigningKeyId', 'recipientEncryptionKeyId', 'transport', 'hop', 'fanout', 'createdAt', 'expiresAt', 'ephemeralPublicKey', 'nonce']
  const header = Object.fromEntries(headerKeys.map(key => [key, valid[key]]))
  const invalidTag = Buffer.alloc(16, 7)
  const ciphertextBytes = Buffer.from(valid.ciphertext, 'base64url')
  const packetRef = `packet_${createHash('sha256').update(Buffer.from(canonical(header))).update(ciphertextBytes).update(invalidTag).digest('base64url')}`
  const body = { ...header, ciphertext: valid.ciphertext, tag: invalidTag.toString('base64url'), ciphertextDigest: valid.ciphertextDigest, packetRef }
  const invalid = { ...body, signature: cryptoSign(null, Buffer.from(canonical(body)), other.sender.signing.privateKey).toString('base64url') }
  const failure = observeClears(() => assert.throws(() => other.channel.open(invalid), /authentication or decryption failed/u))
  assert.ok(failure.cleared.length >= 5)
  for (const buffer of failure.cleared) assert.ok(buffer.every(byte => byte === 0))
})

test('hop, fanout, raw identities, lifetime, and broad targets cannot be requested', async () => {
  const state = await fixture()
  assert.throws(() => state.seal('remote_wss', { targetSessionId: 'raw-session' }), /forbidden raw identity field/u)
  assert.throws(() => state.seal('remote_wss', { value: Number.NaN }), /non-finite/u)
  assert.throws(() => state.seal('remote_wss', {}, { targetDeviceRef: SENDER }), /distinct exact target/u)
  assert.throws(() => state.seal('remote_wss', {}, { expiresAt: 60_000_000 + state.mod.MAX_PACKET_LIFETIME_MS + 1 }), /outside the allowed lifetime/u)
  const packet = state.seal()
  assert.throws(() => state.channel.open({ ...packet, hop: 1 }), /hop or fanout policy is invalid/u)
  assert.throws(() => state.channel.open({ ...packet, fanout: 2 }), /hop or fanout policy is invalid/u)
})

test('expired packets and stale authority epochs are rejected before delivery', async () => {
  const state = await fixture()
  const packet = state.seal()
  state.setNow(60_060_000)
  assert.throws(() => state.channel.open(packet), /lifetime is invalid or expired/u)
  const staleChannel = new state.mod.ProjectSecureChannel({
    projectRef: PROJECT, authorityEpoch: 4, targetDeviceRef: TARGET,
    recipientEncryptionPrivateKey: state.recipient.encryption.privateKey,
    resolveSenderSigningKey: () => state.sender.signing.publicKey,
    now: () => 60_000_000
  })
  assert.throws(() => staleChannel.open(packet), /scope, epoch, or exact target is invalid/u)
})
