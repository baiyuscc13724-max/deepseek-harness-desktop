const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { generateKeyPairSync, randomBytes } = require('node:crypto')
const { mkdtemp, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const authorityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-collaboration.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-authority-service.js')).href

async function fixture() {
  const authorityMod = await import(authorityUrl)
  const storeMod = await import(storeUrl)
  const serviceMod = await import(serviceUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-authority-service-'))
  const key = randomBytes(32)
  const authorityKeys = generateKeyPairSync('ed25519')
  const authority = new authorityMod.ProjectCollaborationAuthority({
    projectIdentity: 'private-service-project', secret: 'private-service-secret-with-twenty-four-characters',
    authorityPrivateKey: authorityKeys.privateKey, now: () => 70_000_000
  })
  const filePath = path.join(root, 'project.enc')
  const store = new storeMod.EncryptedProjectStateStore(filePath, { projectRef: authority.projectRef, encryptionKey: key })
  const service = await serviceMod.PersistedProjectAuthority.create({ store, authority })
  return { authorityMod, storeMod, serviceMod, root, key, filePath, service }
}

async function usingFixture(run) {
  const state = await fixture()
  try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) }
}

test('persisted authority publishes mutations only after encrypted CAS save succeeds', async () => usingFixture(async state => {
  const ownerKeys = generateKeyPairSync('ed25519')
  const created = await state.service.mutate('registerDevice', {
    userHandle: 'private-owner', deviceHandle: 'private-owner-device', displayName: 'Owner', role: 'owner', publicKey: ownerKeys.publicKey
  })
  assert.equal(created.revision, 2)
  assert.equal(state.service.toJSON().memberCount, 1)
  assert.equal(state.service.toJSON().persistedRevision, 2)
  assert.throws(() => state.service.mutate('exportHostState'), /is not allowed/u)

  const reopenedStore = new state.storeMod.EncryptedProjectStateStore(state.filePath, { projectRef: state.service.toJSON().projectRef, encryptionKey: state.key })
  const reopened = await state.serviceMod.PersistedProjectAuthority.open({ store: reopenedStore, now: () => 70_000_000 })
  assert.equal(reopened.toJSON().memberCount, 1)
  assert.equal(reopened.read('listMembers', created.result.member.deviceRef).length, 1)

  const event = reopened.read('nextEvent', { deviceRef: created.result.member.deviceRef, type: 'task.upsert', payload: { taskRef: 'task_persisted' } })
  const signed = state.authorityMod.signProjectEvent(event, ownerKeys.privateKey)
  const submitted = await reopened.mutate('submitEvent', { grant: created.result.grant, event: signed, signature: signed.signature })
  assert.equal(submitted.result.admitted, true)
  assert.equal(submitted.revision, 3)
}))

test('competing services never publish a mutation that lost encrypted-store CAS', async () => usingFixture(async state => {
  const ownerKeys = generateKeyPairSync('ed25519')
  const owner = (await state.service.mutate('registerDevice', {
    userHandle: 'owner', deviceHandle: 'owner-device', displayName: 'Owner', role: 'owner', publicKey: ownerKeys.publicKey
  })).result
  const secondStore = new state.storeMod.EncryptedProjectStateStore(state.filePath, { projectRef: state.service.toJSON().projectRef, encryptionKey: state.key })
  const competing = await state.serviceMod.PersistedProjectAuthority.open({ store: secondStore, now: () => 70_000_000 })
  const contributorKeys = generateKeyPairSync('ed25519')
  await state.service.mutate('registerDevice', {
    actorDeviceRef: owner.member.deviceRef, userHandle: 'contributor', deviceHandle: 'contributor-device', displayName: 'Contributor', role: 'contributor', publicKey: contributorKeys.publicKey
  })
  const reviewerKeys = generateKeyPairSync('ed25519')
  await assert.rejects(competing.mutate('registerDevice', {
    actorDeviceRef: owner.member.deviceRef, userHandle: 'reviewer', deviceHandle: 'reviewer-device', displayName: 'Reviewer', role: 'reviewer', publicKey: reviewerKeys.publicKey
  }), error => error?.code === 'PROJECT_STATE_CONFLICT' && error.currentRevision === 3)
  assert.equal(competing.toJSON().memberCount, 1, 'failed persistence must not publish the working authority')
  await competing.refresh()
  assert.equal(competing.toJSON().memberCount, 2)
  const retried = await competing.mutate('registerDevice', {
    actorDeviceRef: owner.member.deviceRef, userHandle: 'reviewer', deviceHandle: 'reviewer-device', displayName: 'Reviewer', role: 'reviewer', publicKey: reviewerKeys.publicKey
  })
  assert.equal(retried.revision, 4)
  assert.equal(competing.toJSON().memberCount, 3)
}))
