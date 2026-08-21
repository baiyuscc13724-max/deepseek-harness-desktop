const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
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
  const projection = JSON.stringify(state.channel)
  assert.equal(projection.includes(packet.packetRef), false)
  assert.equal(projection.includes('PRIVATE KEY'), false)
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
