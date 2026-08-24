const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, generateKeyPairSync, randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const qualityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'quality-evidence.js')).href
const orchestratorUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'test-orchestrator.js')).href
const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'test-orchestrator-service.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const PROJECT = `project_${'R'.repeat(26)}`
const REPOSITORY = 'repository_runnerstore'
const HEAD = '1'.repeat(40)
const RESULT = '2'.repeat(40)
function digest(value) { return `sha256:${createHash('sha256').update(String(value)).digest('hex')}` }
function binding() {
  return { projectRef: PROJECT, repositoryRef: REPOSITORY, authorityEpoch: 1, mergeGroupRef: 'mergegroup_persistedrunner', baseHead: HEAD, resultCommit: RESULT, artifactSetRef: 'artifactset_persistedrunner', manifestDigest: digest('persisted-manifest') }
}
async function fixture() {
  const qualityMod = await import(qualityUrl)
  const orchestratorMod = await import(orchestratorUrl)
  const serviceMod = await import(serviceUrl)
  const storeMod = await import(storeUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'test-orchestrator-service-'))
  let now = 140_000_000
  const qualityKeys = generateKeyPairSync('ed25519')
  const runnerKeys = generateKeyPairSync('ed25519')
  const quality = new qualityMod.QualityEvidenceAuthority({ projectRef: PROJECT, repositoryRef: REPOSITORY, secret: 'persisted-quality-secret-with-twenty-four-characters', qualityPrivateKey: qualityKeys.privateKey, now: () => now })
  const runner = quality.registerRunner({ runnerHandle: 'private-persisted-runner', displayName: 'Persisted', trust: 'trusted', capabilities: ['unit'], publicKey: runnerKeys.publicKey })
  const plan = quality.createPlan({ name: 'Persisted plan', suites: [{ suiteRef: 'unit', tier: 'fast', required: true, minimumTrust: 'trusted', minimumTests: 1 }] })
  const orchestrator = new orchestratorMod.TestOrchestrator({ qualityAuthority: quality, secret: 'persisted-orchestrator-secret-with-twenty-four-characters', now: () => now })
  const key = randomBytes(32)
  const filePath = path.join(root, 'runner-state.enc')
  const store = new storeMod.EncryptedAuthorityStateStore(filePath, { projectRef: PROJECT, encryptionKey: key })
  const service = await serviceMod.PersistedTestOrchestrator.create({ store, orchestrator })
  return { qualityMod, orchestratorMod, serviceMod, storeMod, root, now: () => now, setNow: value => { now = value }, key, filePath, store, service, runner, runnerKeys, plan }
}
async function usingFixture(run) { const state = await fixture(); try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) } }
async function schedule(state) {
  const template = (await state.service.mutate('registerTemplate', { suiteRef: 'unit', templateDigest: digest('template'), environmentDigest: digest('environment'), version: '1', allowedProfiles: ['merge'], timeoutMs: 60_000, maxAttempts: 2 })).result
  const campaign = (await state.service.mutate('startCampaign', { profile: 'merge', planRef: state.plan.planRef, binding: binding(), templateRefs: [template.templateRef] })).result
  const lease = (await state.service.mutate('claimJob', { runnerRef: state.runner.runnerRef, leaseMs: 10_000 })).result
  return { template, campaign, lease }
}
function signed(state, lease) {
  const prepared = state.service.orchestrator.qualityAuthority.prepareAttestation({ planRef: lease.planRef, suiteRef: lease.suiteRef, runnerRef: state.runner.runnerRef, binding: lease.binding, result: 'pass', counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, environmentDigest: lease.environmentDigest, evidenceDigest: digest('persisted-evidence'), startedAt: state.now(), finishedAt: state.now() })
  return state.qualityMod.signTestAttestation(prepared, state.runnerKeys.privateKey)
}

test('encrypted scheduler restart preserves exact leases and publishes signed completion atomically', async () => usingFixture(async state => {
  const records = await schedule(state)
  assert.equal(state.service.toJSON().persistedRevision, 4)
  const ciphertext = await readFile(state.filePath, 'utf8')
  for (const forbidden of ['private-persisted-runner', 'persisted-quality-secret', 'persisted-orchestrator-secret', records.lease.leaseToken]) assert.equal(ciphertext.includes(forbidden), false)
  const reopenedStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const reopened = await state.serviceMod.PersistedTestOrchestrator.open({ store: reopenedStore, now: () => state.now(), expectedRepositoryRef: REPOSITORY })
  const prepared = reopened.orchestrator.qualityAuthority.prepareAttestation({ planRef: records.lease.planRef, suiteRef: records.lease.suiteRef, runnerRef: state.runner.runnerRef, binding: records.lease.binding, result: 'pass', counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, environmentDigest: records.lease.environmentDigest, evidenceDigest: digest('persisted-evidence'), startedAt: state.now(), finishedAt: state.now() })
  const attestation = state.qualityMod.signTestAttestation(prepared, state.runnerKeys.privateKey)
  const completed = (await reopened.mutate('completeJob', { jobRef: records.lease.jobRef, runnerRef: state.runner.runnerRef, leaseToken: records.lease.leaseToken, attestation, signature: attestation.signature })).result
  assert.equal(completed.campaign.state, 'passed')
  assert.equal(reopened.toJSON().persistedRevision, 5)
}))

test('failed state CAS cannot leak an attestation or consume the active lease', async () => usingFixture(async state => {
  const { lease } = await schedule(state)
  const attestation = signed(state, lease)
  const originalSave = state.store.save.bind(state.store)
  state.store.save = async () => { throw new Error('simulated persistence failure') }
  await assert.rejects(state.service.mutate('completeJob', { jobRef: lease.jobRef, runnerRef: state.runner.runnerRef, leaseToken: lease.leaseToken, attestation, signature: attestation.signature }), /simulated persistence failure/u)
  state.store.save = originalSave
  assert.equal(state.service.orchestrator.qualityAuthority.toJSON().attestationCount, 0)
  assert.equal(state.service.jobStatus(lease.jobRef).state, 'running')
  const completed = (await state.service.mutate('completeJob', { jobRef: lease.jobRef, runnerRef: state.runner.runnerRef, leaseToken: lease.leaseToken, attestation, signature: attestation.signature })).result
  assert.equal(completed.job.state, 'passed')
}))

test('competing service revisions reject stale mutations without publishing memory state', async () => usingFixture(async state => {
  await schedule(state)
  const competingStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const competing = await state.serviceMod.PersistedTestOrchestrator.open({ store: competingStore, now: () => state.now() })
  await state.service.mutate('pauseProject')
  await assert.rejects(competing.mutate('resumeProject'), /compare-and-swap revision changed/u)
  assert.equal(competing.toJSON().projectPaused, false)
  await competing.refresh()
  assert.equal(competing.toJSON().projectPaused, true)
}))

test('Host snapshot authentication and restart lease expiry fail closed', async () => usingFixture(async state => {
  const { lease } = await schedule(state)
  const hostState = state.service.orchestrator.exportHostState()
  assert.throws(() => state.orchestratorMod.TestOrchestrator.restore({ ...hostState, pauseEpoch: 99 }, { now: () => state.now() }), /authentication failed/u)
  state.setNow(state.now() + 10_001)
  const reopenedStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const reopened = await state.serviceMod.PersistedTestOrchestrator.open({ store: reopenedStore, now: () => state.now() })
  assert.equal(reopened.jobStatus(lease.jobRef).state, 'queued')
  assert.throws(() => reopened.orchestrator.heartbeat({ jobRef: lease.jobRef, runnerRef: state.runner.runnerRef, leaseToken: lease.leaseToken }), /stale/u)
}))

test('close drains accepted scheduler mutation and gates status with one close promise', async () => usingFixture(async state => {
  const competingStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const competing = await state.serviceMod.PersistedTestOrchestrator.open({ store: competingStore, now: () => state.now() })
  const originalSave = state.store.save.bind(state.store), originalClose = state.store.close.bind(state.store)
  let release, closeCalls = 0
  const barrier = new Promise(resolve => { release = resolve })
  state.store.save = async (...args) => { await barrier; return originalSave(...args) }
  state.store.close = () => { closeCalls += 1; return originalClose() }
  const accepted = state.service.mutate('pauseProject')
  const closing = state.service.close()
  assert.equal(state.service.close(), closing)
  assert.throws(() => state.service.jobStatus('job_closed'), error => error.code === 'TEST_ORCHESTRATOR_CLOSED')
  await assert.rejects(state.service.refresh(), error => error.code === 'TEST_ORCHESTRATOR_CLOSED')
  await assert.rejects(state.service.mutate('not-a-method'), error => error.code === 'TEST_ORCHESTRATOR_CLOSED')
  release()
  assert.equal((await accepted).revision, 2)
  await closing
  assert.equal(closeCalls, 1)
  await competing.refresh()
  assert.equal(competing.toJSON().projectPaused, true, 'closing one instance must not affect a peer instance')
  await competing.close()
  await assert.rejects(state.service.mutate('resumeProject'), error => error.code === 'TEST_ORCHESTRATOR_CLOSED')
}))
