const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { generateKeyPairSync, randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const authorityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-collaboration.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href

async function fixture() {
  const authorityMod = await import(authorityUrl)
  const storeMod = await import(storeUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-state-store-'))
  const key = randomBytes(32)
  const authorityKeys = generateKeyPairSync('ed25519')
  const ownerKeys = generateKeyPairSync('ed25519')
  const authority = new authorityMod.ProjectCollaborationAuthority({
    projectIdentity: 'private-project-identity', secret: 'private-project-secret-with-twenty-four-characters',
    authorityPrivateKey: authorityKeys.privateKey, now: () => 50_000_000
  })
  const owner = authority.registerDevice({
    userHandle: 'private-owner-handle', deviceHandle: 'private-device-handle', displayName: 'Owner', role: 'owner', publicKey: ownerKeys.publicKey
  })
  const filePath = path.join(root, 'projects', `${authority.projectRef}.json.enc`)
  return { authorityMod, storeMod, root, key, authority, owner, ownerKeys, filePath }
}

async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) }
}

test('encrypted project store writes no raw handles, secret, or private key material', async () => usingFixture(async ({ storeMod, key, authority, filePath }) => {
  const store = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  const saved = await store.save(authority, { expectedRevision: 0 })
  assert.equal(saved.revision, 1)
  const text = await readFile(filePath, 'utf8')
  const envelope = JSON.parse(text)
  assert.equal(envelope.algorithm, 'aes-256-gcm')
  assert.equal(envelope.projectRef, authority.projectRef)
  for (const forbidden of ['private-project-identity', 'private-project-secret', 'private-owner-handle', 'private-device-handle', 'authorityPrivateKey', 'members', 'events']) {
    assert.equal(text.includes(forbidden), false)
  }
  assert.equal(JSON.stringify(store).includes(key.toString('base64url')), false)
}))

test('stored Host state restores member and event sequence continuity', async () => usingFixture(async ({ authorityMod, storeMod, key, authority, owner, ownerKeys, filePath }) => {
  const first = authority.nextEvent({ deviceRef: owner.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'before_disk_restart' } })
  const signed = authorityMod.signProjectEvent(first, ownerKeys.privateKey)
  const admitted = authority.submitEvent({ grant: owner.grant, event: signed, signature: signed.signature }).event
  const store = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  await store.save(authority, { expectedRevision: 0 })
  const loaded = await store.load()
  assert.equal(loaded.revision, 1)
  const restored = authorityMod.ProjectCollaborationAuthority.restore(loaded.state, { now: () => 50_000_000 })
  const renewed = restored.renewGrant({ actorDeviceRef: owner.member.deviceRef, deviceRef: owner.member.deviceRef })
  const second = restored.nextEvent({ deviceRef: owner.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'after_disk_restart' } })
  assert.equal(second.sequence, 2)
  assert.equal(second.prevDigest, admitted.eventRef)
  const signedSecond = authorityMod.signProjectEvent(second, ownerKeys.privateKey)
  assert.equal(restored.submitEvent({ grant: renewed, event: signedSecond, signature: signedSecond.signature }).admitted, true)
}))

test('wrong keys and authenticated-envelope tampering fail closed', async () => usingFixture(async ({ storeMod, key, authority, filePath }) => {
  const store = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  await store.save(authority, { expectedRevision: 0 })
  const wrong = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: randomBytes(32) })
  await assert.rejects(wrong.load(), /authentication or decryption failed/u)

  const envelope = JSON.parse(await readFile(filePath, 'utf8'))
  envelope.ciphertext = `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`
  await writeFile(filePath, `${JSON.stringify(envelope)}\n`, 'utf8')
  await assert.rejects(store.load(), /authentication or decryption failed/u)
}))

test('same-file stores serialize compare-and-swap saves without lost updates', async () => usingFixture(async ({ storeMod, key, authority, filePath }) => {
  const first = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  const second = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  await first.save(authority, { expectedRevision: 0 })
  await second.load()
  const results = await Promise.allSettled([
    first.save(authority, { expectedRevision: 1 }),
    second.save(authority, { expectedRevision: 1 })
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const failure = results.find(result => result.status === 'rejected').reason
  assert.equal(failure.code, 'PROJECT_STATE_CONFLICT')
  assert.equal(failure.currentRevision, 2)
  const latest = await first.load()
  assert.equal(latest.revision, 2)
}))

test('last-seen and externally anchored minimum revisions detect rollback', async () => usingFixture(async ({ storeMod, key, authority, filePath }) => {
  const store = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  await store.save(authority, { expectedRevision: 0 })
  const revisionOne = await readFile(filePath, 'utf8')
  await store.save(authority, { expectedRevision: 1 })
  await writeFile(filePath, revisionOne, 'utf8')
  await assert.rejects(store.load(), /rollback was detected/u)
  const anchored = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key, minimumRevision: 2 })
  await assert.rejects(anchored.load(), /rollback was detected/u)
}))

test('close drains accepted work, rejects new work, and zeroes only the private key copy', async () => usingFixture(async ({ storeMod, key, authority, filePath }) => {
  const store = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  const pending = store.save(authority, { expectedRevision: 0 })
  const closing = store.close()
  assert.equal(store.close(), closing)
  await assert.rejects(store.load(), error => error?.code === 'PROJECT_STATE_CLOSED')
  await assert.rejects(store.save(authority, { expectedRevision: 0 }), error => error?.code === 'PROJECT_STATE_CLOSED')
  assert.equal((await pending).revision, 1)
  await closing
  assert.equal(store.encryptionKey.every(byte => byte === 0), true)
  assert.equal(key.some(byte => byte !== 0), true, 'the caller-owned key is not mutated')

  const reopened = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  assert.equal((await reopened.load()).revision, 1)
  await reopened.close()
}))
