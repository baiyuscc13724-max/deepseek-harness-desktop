const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash, createHmac, generateKeyPairSync } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'defect-lifecycle.js')).href
const qualityModuleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'quality-evidence.js')).href
const OBSERVED = '1'.repeat(40)
const FIX = '2'.repeat(40)

function digest(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function authenticatedEmptyState(repositoryRef) {
  const state = {
    version: 1, stateKind: 'defect-lifecycle-host', projectRef: 'project_opaque', repositoryRef,
    secret: 'defect-state-secret-with-twenty-four-characters', signals: [], occurrences: [], defects: [], fixes: [], verifications: [], releaseObservations: []
  }
  return { ...state, stateMac: createHmac('sha256', state.secret).update(canonicalJson(state)).digest('base64url') }
}

async function fixture() {
  const mod = await import(moduleUrl)
  let now = 40_000_000
  const attestations = new Map()
  const lifecycle = new mod.DefectLifecycle({
    projectRef: 'project_opaque', repositoryRef: 'repository_opaque', now: () => now,
    resolveAttestation: ref => attestations.get(ref)
  })
  return {
    mod, lifecycle, attestations, getNow: () => now, setNow: value => { now = value },
    addAttestation(ref, result, commit = FIX, artifactSetRef = 'artifactset_fixed01') {
      const record = {
        attestationRef: ref,
        result,
        evidenceDigest: digest(`${ref}-evidence`),
        binding: { projectRef: 'project_opaque', repositoryRef: 'repository_opaque', resultCommit: commit, artifactSetRef }
      }
      attestations.set(ref, record)
      return record
    }
  }
}

test('DefectLifecycle accepts only the canonical repository_* reference across construction and Host restore', async () => {
  const { DefectLifecycle } = await import(moduleUrl)
  const options = { projectRef: 'project_opaque', now: () => 40_000_000, resolveAttestation: () => undefined }
  const lifecycle = new DefectLifecycle({ ...options, repositoryRef: 'repository_opaque', secret: 'defect-state-secret-with-twenty-four-characters' })
  assert.equal(lifecycle.repositoryRef, 'repository_opaque')
  const exported = lifecycle.exportHostState()
  assert.equal(exported.repositoryRef, 'repository_opaque')
  assert.equal(DefectLifecycle.restore(exported, options).repositoryRef, 'repository_opaque')

  for (const repositoryRef of ['repo_opaque', 'gitrepo_opaque', 'Repository_opaque', 'repository-', 'repository_short']) {
    assert.throws(() => new DefectLifecycle({ ...options, repositoryRef }), /repositoryRef must be an opaque public reference/u)
    assert.throws(() => DefectLifecycle.restore(authenticatedEmptyState(repositoryRef), options), /repositoryRef must be an opaque public reference/u)
  }
})

function signal(lifecycle, overrides = {}) {
  return lifecycle.recordSignal({
    sourceType: 'test', sourceRef: 'attestation_failure', fingerprintDigest: digest('same-defect'),
    title: 'Regression in merge queue', evidenceDigest: digest('failure-log'), observedCommit: OBSERVED,
    artifactSetRef: 'artifactset_initial', severityHint: 'major', observedAt: 40_000_000, ...overrides
  })
}

function occurrence(lifecycle, source, suffix = 'first') {
  return lifecycle.recordOccurrence({
    signalRef: source.signalRef,
    environmentDigest: digest(`environment-${suffix}`),
    reproductionDigest: digest(`reproduction-${suffix}`),
    observedAt: source.observedAt
  })
}

test('Signal and Occurrence records are immutable, idempotent, and deduplicate into one Defect', async () => {
  const { lifecycle } = await fixture()
  const firstSignal = signal(lifecycle)
  assert.equal(JSON.stringify(lifecycle).includes('attestation_failure'), false)
  assert.equal(signal(lifecycle), firstSignal)
  const firstOccurrence = occurrence(lifecycle, firstSignal)
  assert.equal(occurrence(lifecycle, firstSignal), firstOccurrence)
  const defect = lifecycle.triageOccurrence({ occurrenceRef: firstOccurrence.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  assert.equal(defect.state, 'open')
  assert.equal(defect.recurrenceCount, 0)
  assert.match(defect.defectRef, /^defect_/u)

  const laterSignal = signal(lifecycle, { sourceRef: 'runtime_second', sourceType: 'runtime', evidenceDigest: digest('later-log'), severityHint: 'critical', observedAt: 40_001_000 })
  const laterOccurrence = occurrence(lifecycle, laterSignal, 'later')
  const sameDefect = lifecycle.triageOccurrence({ occurrenceRef: laterOccurrence.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  assert.equal(sameDefect.defectRef, defect.defectRef)
  assert.equal(sameDefect.severity, 'critical')
  assert.equal(sameDefect.occurrenceRefs.length, 2)
  assert.equal(sameDefect.recurrenceCount, 1)
})

test('raw-looking identity fields and invalid lifecycle references fail closed', async () => {
  const { lifecycle } = await fixture()
  assert.throws(() => signal(lifecycle, { sourceRef: 'raw-session-value' }), /opaque public reference/u)
  const recorded = signal(lifecycle)
  const observed = occurrence(lifecycle, recorded)
  assert.throws(() => lifecycle.triageOccurrence({ occurrenceRef: observed.occurrenceRef, ownerCollaboratorRef: 'raw-owner-id' }), /opaque public reference/u)
  const defect = lifecycle.triageOccurrence({ occurrenceRef: observed.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  assert.throws(() => lifecycle.linkFix({ defectRef: defect.defectRef, changeSetRef: 'raw-change', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' }), /opaque public reference/u)
})

test('Fix and Verification require an authenticated attestation bound to the exact fix artifact', async () => {
  const state = await fixture()
  const observed = occurrence(state.lifecycle, signal(state.lifecycle))
  const defect = state.lifecycle.triageOccurrence({ occurrenceRef: observed.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  const fix = state.lifecycle.linkFix({ defectRef: defect.defectRef, changeSetRef: 'changeset_fixed01', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' })
  assert.equal(state.lifecycle.getDefect(defect.defectRef).state, 'verification_pending')
  assert.throws(() => state.lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: 'attestation_unknown' }), /unknown or unauthenticated/u)

  state.addAttestation('attestation_mismatch', 'pass', '3'.repeat(40), 'artifactset_fixed01')
  assert.throws(() => state.lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: 'attestation_mismatch' }), /not bound to the exact fix artifact/u)

  state.addAttestation('attestation_failure', 'fail')
  const failed = state.lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: 'attestation_failure' })
  assert.equal(failed.result, 'fail')
  assert.equal(state.lifecycle.getDefect(defect.defectRef).state, 'reopened')

  state.lifecycle.linkFix({ defectRef: defect.defectRef, changeSetRef: 'changeset_fixed01', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' })
  state.addAttestation('attestation_passing', 'pass')
  const passed = state.lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: 'attestation_passing' })
  assert.equal(passed.result, 'pass')
  assert.equal(state.lifecycle.getDefect(defect.defectRef).state, 'verified')
})

test('clean ReleaseObservation closes a verified defect while exact recurrence reopens it', async () => {
  const state = await fixture()
  const initialOccurrence = occurrence(state.lifecycle, signal(state.lifecycle))
  const defect = state.lifecycle.triageOccurrence({ occurrenceRef: initialOccurrence.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  const fix = state.lifecycle.linkFix({ defectRef: defect.defectRef, changeSetRef: 'changeset_fixed01', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' })
  state.addAttestation('attestation_passing', 'pass')
  state.lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: 'attestation_passing' })
  const clean = state.lifecycle.recordReleaseObservation({
    defectRef: defect.defectRef, releaseRef: 'release_version1', commit: FIX, artifactSetRef: 'artifactset_fixed01'
  })
  assert.equal(clean.outcome, 'clean')
  assert.equal(state.lifecycle.getDefect(defect.defectRef).state, 'released')
  const closed = state.lifecycle.closeDefect({ defectRef: defect.defectRef, releaseObservationRef: clean.releaseObservationRef })
  assert.equal(closed.state, 'closed')

  const recurrenceSignal = signal(state.lifecycle, {
    sourceType: 'release_observation', sourceRef: 'release_version1', observedCommit: FIX,
    artifactSetRef: 'artifactset_fixed01', evidenceDigest: digest('release-recurrence'), observedAt: state.getNow() + 1_000
  })
  const recurrenceOccurrence = occurrence(state.lifecycle, recurrenceSignal, 'release')
  const recurred = state.lifecycle.recordReleaseObservation({
    defectRef: defect.defectRef, releaseRef: 'release_version1', commit: FIX,
    artifactSetRef: 'artifactset_fixed01', occurrenceRef: recurrenceOccurrence.occurrenceRef, observedAt: state.getNow() + 1_000
  })
  assert.equal(recurred.outcome, 'recurred')
  assert.equal(state.lifecycle.getDefect(defect.defectRef).state, 'reopened')
  assert.equal(state.lifecycle.getDefect(defect.defectRef).recurrenceCount, 1)
})

test('Defect Verification consumes an admitted signed quality attestation without weakening build binding', async () => {
  const defectMod = await import(moduleUrl)
  const qualityMod = await import(qualityModuleUrl)
  const qualityKeys = generateKeyPairSync('ed25519')
  const runnerKeys = generateKeyPairSync('ed25519')
  const quality = new qualityMod.QualityEvidenceAuthority({
    projectRef: 'project_opaque', repositoryRef: 'repository_opaque',
    secret: 'integration-quality-secret-with-twenty-four-characters', qualityPrivateKey: qualityKeys.privateKey, now: () => 40_000_000
  })
  const runner = quality.registerRunner({ runnerHandle: 'private-verifier', displayName: 'Verifier', trust: 'trusted', capabilities: ['verification'], publicKey: runnerKeys.publicKey })
  const plan = quality.createPlan({ name: 'Defect verification', suites: [{ suiteRef: 'verification', tier: 'integration', minimumTrust: 'trusted', minimumTests: 1 }] })
  const exactBinding = {
    projectRef: 'project_opaque', repositoryRef: 'repository_opaque', authorityEpoch: 1,
    mergeGroupRef: 'mergegroup_fix001', baseHead: OBSERVED, resultCommit: FIX,
    artifactSetRef: 'artifactset_fixed01', manifestDigest: digest('fix-manifest')
  }
  const prepared = quality.prepareAttestation({
    planRef: plan.planRef, suiteRef: 'verification', runnerRef: runner.runnerRef, binding: exactBinding,
    result: 'pass', counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    environmentDigest: digest('verification-env'), evidenceDigest: digest('verification-evidence'),
    startedAt: 39_999_000, finishedAt: 40_000_000
  })
  const signed = qualityMod.signTestAttestation(prepared, runnerKeys.privateKey)
  const admitted = quality.submitAttestation({ attestation: signed, signature: signed.signature }).attestation
  const lifecycle = new defectMod.DefectLifecycle({ projectRef: 'project_opaque', repositoryRef: 'repository_opaque', now: () => 40_000_000, resolveAttestation: ref => quality.getAttestation(ref) })
  const source = signal(lifecycle)
  const observed = occurrence(lifecycle, source)
  const defect = lifecycle.triageOccurrence({ occurrenceRef: observed.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  const fix = lifecycle.linkFix({ defectRef: defect.defectRef, changeSetRef: 'changeset_fixed01', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' })
  const verification = lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: admitted.attestationRef })
  assert.equal(verification.result, 'pass')
  assert.equal(lifecycle.getDefect(defect.defectRef).state, 'verified')
})

test('ReleaseObservation rejects a recurrence from another fingerprint or artifact', async () => {
  const state = await fixture()
  const initialOccurrence = occurrence(state.lifecycle, signal(state.lifecycle))
  const defect = state.lifecycle.triageOccurrence({ occurrenceRef: initialOccurrence.occurrenceRef, ownerCollaboratorRef: 'collaborator_owner01' })
  const fix = state.lifecycle.linkFix({ defectRef: defect.defectRef, changeSetRef: 'changeset_fixed01', fixCommit: FIX, artifactSetRef: 'artifactset_fixed01' })
  state.addAttestation('attestation_passing', 'pass')
  state.lifecycle.recordVerification({ defectRef: defect.defectRef, fixRef: fix.fixRef, attestationRef: 'attestation_passing' })

  const otherSignal = signal(state.lifecycle, { sourceRef: 'release_other1', fingerprintDigest: digest('other-defect'), observedCommit: FIX, artifactSetRef: 'artifactset_fixed01', observedAt: state.getNow() + 1 })
  const otherOccurrence = occurrence(state.lifecycle, otherSignal, 'other')
  assert.throws(() => state.lifecycle.recordReleaseObservation({ defectRef: defect.defectRef, releaseRef: 'release_version1', commit: FIX, artifactSetRef: 'artifactset_fixed01', occurrenceRef: otherOccurrence.occurrenceRef }), /fingerprint does not match/u)

  const wrongArtifactSignal = signal(state.lifecycle, { sourceRef: 'release_wrong1', observedCommit: FIX, artifactSetRef: 'artifactset_other1', evidenceDigest: digest('wrong-artifact'), observedAt: state.getNow() + 2 })
  const wrongArtifactOccurrence = occurrence(state.lifecycle, wrongArtifactSignal, 'wrong-artifact')
  assert.throws(() => state.lifecycle.recordReleaseObservation({ defectRef: defect.defectRef, releaseRef: 'release_version1', commit: FIX, artifactSetRef: 'artifactset_fixed01', occurrenceRef: wrongArtifactOccurrence.occurrenceRef }), /not bound to the observed release artifact/u)
})
