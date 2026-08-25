const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const lifecycleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'defect-lifecycle.js')).href
const serviceUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'defect-lifecycle-service.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const PROJECT = `project_${'D'.repeat(26)}`
const REPOSITORY = 'repository_defectstore'
const OBSERVED = '1'.repeat(40)
const FIX = '2'.repeat(40)
function digest(value) { return `sha256:${createHash('sha256').update(String(value)).digest('hex')}` }
async function fixture() {
  const lifecycleMod = await import(lifecycleUrl)
  const serviceMod = await import(serviceUrl)
  const storeMod = await import(storeUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'defect-lifecycle-service-'))
  let now = 180_000_000
  const attestations = new Map()
  const resolveAttestation = ref => attestations.get(ref)
  const lifecycle = new lifecycleMod.DefectLifecycle({ projectRef: PROJECT, repositoryRef: REPOSITORY, secret: 'persistent-defect-secret-with-twenty-four-characters', now: () => now, resolveAttestation })
  const key = randomBytes(32)
  const filePath = path.join(root, 'defects.enc')
  const store = new storeMod.EncryptedAuthorityStateStore(filePath, { projectRef: PROJECT, encryptionKey: key })
  const service = await serviceMod.PersistedDefectLifecycle.create({ store, lifecycle, resolveAttestation })
  return { lifecycleMod, serviceMod, storeMod, root, key, filePath, store, service, attestations, resolveAttestation, getNow: () => now, setNow: value => { now = value } }
}
async function usingFixture(run) { const state = await fixture(); try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) } }
async function triage(state) {
  const signal = (await state.service.mutate('recordSignal', {
    sourceType: 'external', sourceRef: 'externalissue_opaque01', fingerprintDigest: digest('persistent-defect'), title: 'Persistent external regression', evidenceDigest: digest('failure-evidence'), observedCommit: OBSERVED, artifactSetRef: 'artifactset_observed01', severityHint: 'critical', observedAt: state.getNow()
  })).result
  const occurrence = (await state.service.mutate('recordOccurrence', { signalRef: signal.signalRef, environmentDigest: digest('environment'), reproductionDigest: digest('reproduction'), observedAt: state.getNow() })).result
  const defect = (await state.service.mutate('triageOccurrence', { occurrenceRef: occurrence.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })).result
  return { signal, occurrence, defect }
}

test('encrypted Defect Lifecycle restores an exact closed release-observation chain', async () => usingFixture(async state => {
  const records = await triage(state)
  const fix = (await state.service.mutate('linkFix', { defectRef: records.defect.defectRef, changeSetRef: 'changeset_persisted01', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' })).result
  const attestationRef = 'attestation_persisted01'
  state.attestations.set(attestationRef, { attestationRef, result: 'pass', evidenceDigest: digest('verification-evidence'), binding: { projectRef: PROJECT, repositoryRef: REPOSITORY, resultCommit: FIX, artifactSetRef: 'artifactset_fixed01' } })
  await state.service.mutate('recordVerification', { defectRef: records.defect.defectRef, fixRef: fix.fixRef, attestationRef })
  const release = (await state.service.mutate('recordReleaseObservation', { defectRef: records.defect.defectRef, releaseRef: 'release_version01', commit: FIX, artifactSetRef: 'artifactset_fixed01', observedAt: state.getNow() })).result
  await state.service.mutate('closeDefect', { defectRef: records.defect.defectRef, releaseObservationRef: release.releaseObservationRef })
  assert.equal(state.service.toJSON().persistedRevision, 8)
  const ciphertext = await readFile(state.filePath, 'utf8')
  for (const forbidden of ['persistent-defect-secret', 'Persistent external regression', 'collaborator_owner01', attestationRef]) assert.equal(ciphertext.includes(forbidden), false)
  const reopenedStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const reopened = await state.serviceMod.PersistedDefectLifecycle.open({ store: reopenedStore, resolveAttestation: state.resolveAttestation, now: () => state.getNow(), expectedRepositoryRef: REPOSITORY })
  const restored = reopened.getDefect(records.defect.defectRef)
  assert.equal(restored.state, 'closed')
  assert.equal(restored.fixRefs.length, 1)
  assert.equal(restored.verificationRefs.length, 1)
  assert.equal(restored.releaseObservationRefs.length, 1)
  const hostState = reopened.lifecycle.exportHostState()
  assert.throws(() => state.lifecycleMod.DefectLifecycle.restore({ ...hostState, repositoryRef: 'repo_tampered' }, { resolveAttestation: state.resolveAttestation }), /authentication failed/u)
}))

test('failed encrypted save cannot publish a lifecycle mutation in memory', async () => usingFixture(async state => {
  const originalSave = state.store.save.bind(state.store)
  state.store.save = async () => { throw new Error('simulated Defect persistence failure') }
  await assert.rejects(state.service.mutate('recordSignal', { sourceType: 'external', sourceRef: 'externalissue_failure01', fingerprintDigest: digest('failure'), title: 'Must not publish', evidenceDigest: digest('evidence'), observedCommit: OBSERVED, artifactSetRef: 'artifactset_observed01' }), /simulated Defect persistence failure/u)
  state.store.save = originalSave
  assert.equal(state.service.toJSON().signalCount, 0)
  assert.equal((await state.service.mutate('recordSignal', { sourceType: 'external', sourceRef: 'externalissue_failure01', fingerprintDigest: digest('failure'), title: 'Now publish', evidenceDigest: digest('evidence'), observedCommit: OBSERVED, artifactSetRef: 'artifactset_observed01' })).revision, 2)
}))

test('competing lifecycle services preserve the revision winner only', async () => usingFixture(async state => {
  const { defect } = await triage(state)
  const competingStore = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  const competing = await state.serviceMod.PersistedDefectLifecycle.open({ store: competingStore, resolveAttestation: state.resolveAttestation, now: () => state.getNow() })
  await state.service.mutate('assignDefect', { defectRef: defect.defectRef, ownerCollaboratorRef: 'collaborator_winner01' })
  await assert.rejects(competing.mutate('assignDefect', { defectRef: defect.defectRef, ownerCollaboratorRef: 'collaborator_loser01' }), /compare-and-swap revision changed/u)
  assert.equal(competing.getDefect(defect.defectRef).ownerCollaboratorRef, 'collaborator_owner01')
  await competing.refresh()
  assert.equal(competing.getDefect(defect.defectRef).ownerCollaboratorRef, 'collaborator_winner01')
}))

test('close drains accepted defect mutation, closes the store once, and gates reads', async () => usingFixture(async state => {
  const originalSave = state.store.save.bind(state.store), originalClose = state.store.close.bind(state.store)
  let release, closeCalls = 0
  const barrier = new Promise(resolve => { release = resolve })
  state.store.save = async (...args) => { await barrier; return originalSave(...args) }
  state.store.close = () => { closeCalls += 1; return originalClose().then(() => { throw new Error('simulated close cleanup failure') }) }
  const accepted = state.service.mutate('recordSignal', { sourceType: 'external', sourceRef: 'externalissue_close01', fingerprintDigest: digest('close'), title: 'Accepted before close', evidenceDigest: digest('close-evidence'), observedCommit: OBSERVED, artifactSetRef: 'artifactset_close01' })
  const closing = state.service.close()
  assert.equal(state.service.close(), closing)
  assert.throws(() => state.service.getDefect('defect_closed'), error => error.code === 'DEFECT_LIFECYCLE_CLOSED')
  await assert.rejects(state.service.refresh(), error => error.code === 'DEFECT_LIFECYCLE_CLOSED')
  await assert.rejects(state.service.mutate('not-a-method'), error => error.code === 'DEFECT_LIFECYCLE_CLOSED')
  release()
  assert.equal((await accepted).revision, 2)
  await assert.rejects(closing, /simulated close cleanup failure/u)
  assert.equal(closeCalls, 1)
}))
