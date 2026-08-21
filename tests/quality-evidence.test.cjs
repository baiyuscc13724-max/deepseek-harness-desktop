const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash, generateKeyPairSync } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'quality-evidence.js')).href
const workspaceModuleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'workspace-authority.js')).href
const HEAD = '1'.repeat(40)
const RESULT = '2'.repeat(40)

function digest(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`
}
function keys() {
  return generateKeyPairSync('ed25519')
}
function binding(overrides = {}) {
  return {
    projectRef: 'project_opaque', repositoryRef: 'repo_opaque', authorityEpoch: 1,
    mergeGroupRef: 'mergegroup_opaque', baseHead: HEAD, resultCommit: RESULT,
    artifactSetRef: 'artifactset_opaque', manifestDigest: digest('manifest'), ...overrides
  }
}

async function fixture() {
  const mod = await import(moduleUrl)
  let now = 30_000_000
  const qualityKeys = keys()
  const quality = new mod.QualityEvidenceAuthority({
    projectRef: 'project_opaque', repositoryRef: 'repo_opaque',
    secret: 'quality-secret-with-at-least-twenty-four-characters',
    qualityPrivateKey: qualityKeys.privateKey,
    now: () => now
  })
  const standardKeys = keys()
  const standard = quality.registerRunner({ runnerHandle: 'private-standard-runner', displayName: 'Standard', trust: 'standard', capabilities: ['unit'], publicKey: standardKeys.publicKey })
  const trustedKeys = keys()
  const trusted = quality.registerRunner({ runnerHandle: 'private-trusted-runner', displayName: 'Trusted', trust: 'trusted', capabilities: ['security'], publicKey: trustedKeys.publicKey })
  const untrustedKeys = keys()
  const untrusted = quality.registerRunner({ runnerHandle: 'private-untrusted-runner', displayName: 'Untrusted', trust: 'untrusted', capabilities: ['unit'], publicKey: untrustedKeys.publicKey })
  const plan = quality.createPlan({
    name: 'Merge gate',
    suites: [
      { suiteRef: 'unit', tier: 'fast', required: true, minimumTrust: 'standard', minimumTests: 2 },
      { suiteRef: 'security', tier: 'security', required: true, minimumTrust: 'trusted', minimumTests: 1 }
    ]
  })
  return { mod, quality, qualityKeys, standard, standardKeys, trusted, trustedKeys, untrusted, untrustedKeys, plan, getNow: () => now, setNow: value => { now = value } }
}

function attest(state, runner, runnerKeys, suiteRef, options = {}) {
  const start = state.getNow() - 1_000
  const prepared = state.quality.prepareAttestation({
    planRef: state.plan.planRef,
    suiteRef,
    runnerRef: runner.runnerRef,
    binding: options.binding ?? binding(),
    result: options.result ?? 'pass',
    counts: options.counts ?? (suiteRef === 'unit' ? { total: 2, passed: 2, failed: 0, skipped: 0 } : { total: 1, passed: 1, failed: 0, skipped: 0 }),
    environmentDigest: digest(options.environment ?? `${suiteRef}-env`),
    evidenceDigest: digest(options.evidence ?? `${suiteRef}-evidence`),
    startedAt: start,
    finishedAt: state.getNow()
  })
  const signed = state.mod.signTestAttestation(prepared, runnerKeys.privateKey)
  return state.quality.submitAttestation({ attestation: signed, signature: signed.signature }).attestation
}

test('runner projections are opaque and signed attestations are immutable and idempotent', async () => {
  const state = await fixture()
  const { quality, standard, standardKeys } = state
  assert.match(standard.runnerRef, /^runner_/u)
  assert.equal(JSON.stringify({ standard, quality }).includes('private-standard-runner'), false)
  assert.equal(JSON.stringify(quality).includes('quality-secret-with-at-least-twenty-four-characters'), false)
  const evidence = attest(state, standard, standardKeys, 'unit')
  assert.match(evidence.attestationRef, /^attestation_/u)
  const duplicate = quality.submitAttestation({ attestation: evidence, signature: evidence.signature })
  assert.equal(duplicate.duplicate, true)
  const tampered = { ...evidence, counts: { total: 3, passed: 3, failed: 0, skipped: 0 } }
  assert.throws(() => quality.submitAttestation({ attestation: tampered, signature: evidence.signature }), /signature is invalid/u)
})

test('exact build binding and runner trust are mandatory for a passing GateDecision', async () => {
  const state = await fixture()
  const lowTrust = attest(state, state.untrusted, state.untrustedKeys, 'unit')
  const security = attest(state, state.trusted, state.trustedKeys, 'security')
  const failed = state.quality.evaluateGate({ planRef: state.plan.planRef, binding: binding(), attestationRefs: [lowTrust.attestationRef, security.attestationRef] })
  assert.equal(failed.decision, 'fail')
  assert.deepEqual(failed.reasonCodes, ['MISSING_PASS:unit'])
  assert.equal(state.quality.verifyGateReceipt(failed, binding()), false)

  const unit = attest(state, state.standard, state.standardKeys, 'unit')
  const passed = state.quality.evaluateGate({ planRef: state.plan.planRef, binding: binding(), attestationRefs: [unit.attestationRef, security.attestationRef] })
  assert.equal(passed.decision, 'pass')
  assert.equal(state.quality.verifyGateReceipt(passed, binding()), true)
  assert.equal(state.mod.verifyGateReceiptWithKey(passed, binding(), state.quality.qualityPublicKeyPem(), state.getNow()), true)
  assert.equal(state.quality.verifyGateReceipt(passed, binding({ artifactSetRef: 'artifactset_other' })), false)
})

test('the same artifact manifest tested by required suites is the only artifact admitted', async () => {
  const state = await fixture()
  const altered = binding({ manifestDigest: digest('other-manifest') })
  const unit = attest(state, state.standard, state.standardKeys, 'unit')
  const securityOnOtherBuild = attest(state, state.trusted, state.trustedKeys, 'security', { binding: altered })
  const receipt = state.quality.evaluateGate({ planRef: state.plan.planRef, binding: binding(), attestationRefs: [unit.attestationRef, securityOnOtherBuild.attestationRef] })
  assert.equal(receipt.decision, 'fail')
  assert.deepEqual(receipt.reasonCodes, ['MISSING_PASS:security'])
})

test('test count, time window, signature, and runner revocation gates fail closed', async () => {
  const state = await fixture()
  assert.throws(() => state.quality.prepareAttestation({
    planRef: state.plan.planRef, suiteRef: 'unit', runnerRef: state.standard.runnerRef, binding: binding(), result: 'pass',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, environmentDigest: digest('env'), evidenceDigest: digest('evidence'),
    startedAt: state.getNow() - 1, finishedAt: state.getNow()
  }), /minimum test counts/u)
  const unit = attest(state, state.standard, state.standardKeys, 'unit')
  const security = attest(state, state.trusted, state.trustedKeys, 'security')
  state.quality.revokeRunner(state.standard.runnerRef)
  const revokedReceipt = state.quality.evaluateGate({ planRef: state.plan.planRef, binding: binding(), attestationRefs: [unit.attestationRef, security.attestationRef] })
  assert.equal(revokedReceipt.decision, 'fail')
  state.setNow(state.getNow() + state.mod.MAX_EVIDENCE_AGE_MS + 1)
  const expiredReceipt = state.quality.evaluateGate({ planRef: state.plan.planRef, binding: binding(), attestationRefs: [unit.attestationRef, security.attestationRef] })
  assert.equal(expiredReceipt.decision, 'fail')
})

test('authenticated Quality Host snapshots restore runners, plans, evidence, and receipts', async () => {
  const state = await fixture()
  const unit = attest(state, state.standard, state.standardKeys, 'unit')
  const security = attest(state, state.trusted, state.trustedKeys, 'security')
  const receipt = state.quality.evaluateGate({ planRef: state.plan.planRef, binding: binding(), attestationRefs: [unit.attestationRef, security.attestationRef] })
  state.quality.revokeRunner(state.standard.runnerRef)
  const hostState = state.quality.exportHostState()
  const restored = state.mod.QualityEvidenceAuthority.restore(JSON.parse(JSON.stringify(hostState)), { now: () => state.getNow() })
  assert.deepEqual(restored.toJSON(), state.quality.toJSON())
  assert.equal(restored.getRunner(state.standard.runnerRef).status, 'revoked')
  assert.deepEqual(restored.getPlan(state.plan.planRef), state.plan)
  assert.deepEqual(restored.getAttestation(unit.attestationRef), unit)
  assert.equal(restored.verifyGateReceipt(receipt, binding()), true)
  assert.throws(() => state.mod.QualityEvidenceAuthority.restore({ ...hostState, projectRef: 'project_tampered' }), /authentication failed/u)
})

test('a signed passing receipt lands only the exact ArtifactSet in Workspace Authority', async () => {
  const qualityMod = await import(moduleUrl)
  const workspaceMod = await import(workspaceModuleUrl)
  const qualityKeys = keys()
  const runnerKeys = keys()
  const now = 35_000_000
  const quality = new qualityMod.QualityEvidenceAuthority({
    projectRef: 'project_opaque', repositoryRef: 'repo_opaque', secret: 'integrated-gate-secret-with-twenty-four-characters',
    qualityPrivateKey: qualityKeys.privateKey, now: () => now
  })
  const workspace = new workspaceMod.WorkspaceAuthority({
    projectRef: 'project_opaque', repositoryRef: 'repo_opaque',
    authorityRoot: path.resolve('integrated-authority'), sourceWorkspaceRoot: path.resolve('integrated-source'), workspaceRoot: path.resolve('integrated-workspaces'),
    initialHead: HEAD, secret: 'integrated-workspace-secret-with-twenty-four-characters', now: () => now,
    verifyGateReceipt: (receipt, exactBinding) => quality.verifyGateReceipt(receipt, exactBinding)
  })
  const lease = workspace.openWorkspace({ collaboratorRef: 'collaborator_test', taskRef: 'task_integrated', workspacePath: path.resolve('integrated-workspaces', 'task') })
  const claim = workspace.claimResources({ workspaceRef: lease.workspaceRef, mode: 'write', resources: ['src/integrated.js'] })
  const changeSet = workspace.publishChangeSet({
    workspaceRef: lease.workspaceRef, commit: '4'.repeat(40), parentCommit: HEAD,
    diffDigest: digest('integrated-diff'), treeDigest: digest('integrated-tree'), files: ['src/integrated.js'], claimRefs: [claim.claimRef], message: 'Integrated gate'
  })
  workspace.enqueueChangeSet(changeSet.changeSetRef)
  const planned = workspace.planMergeGroup()
  const merged = workspace.recordMergeResult({ mergeGroupRef: planned.mergeGroupRef, resultCommit: RESULT, treeDigest: digest('integrated-merge-tree') })
  const artifacts = workspace.recordArtifactSet({
    mergeGroupRef: merged.mergeGroupRef, commit: RESULT, buildEnvironmentDigest: digest('integrated-build-env'),
    artifacts: [{ name: 'integrated.zip', digest: digest('integrated.zip'), size: 10 }]
  })
  const exactBinding = {
    projectRef: workspace.projectRef, repositoryRef: workspace.repositoryRef, authorityEpoch: workspace.authorityEpoch,
    mergeGroupRef: merged.mergeGroupRef, baseHead: merged.baseHead, resultCommit: merged.resultCommit,
    artifactSetRef: artifacts.artifactSetRef, manifestDigest: artifacts.manifestDigest
  }
  const runner = quality.registerRunner({ runnerHandle: 'private-integrated-runner', displayName: 'Integrated', trust: 'trusted', capabilities: ['merge-gate'], publicKey: runnerKeys.publicKey })
  const plan = quality.createPlan({ name: 'Integrated gate', suites: [{ suiteRef: 'merge-gate', tier: 'integration', minimumTrust: 'trusted', minimumTests: 1 }] })
  const prepared = quality.prepareAttestation({
    planRef: plan.planRef, suiteRef: 'merge-gate', runnerRef: runner.runnerRef, binding: exactBinding, result: 'pass',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 }, environmentDigest: digest('integrated-test-env'), evidenceDigest: digest('integrated-test-evidence'),
    startedAt: now - 100, finishedAt: now
  })
  const signed = qualityMod.signTestAttestation(prepared, runnerKeys.privateKey)
  const attestation = quality.submitAttestation({ attestation: signed, signature: signed.signature }).attestation
  const receipt = quality.evaluateGate({ planRef: plan.planRef, binding: exactBinding, attestationRefs: [attestation.attestationRef] })
  const landed = workspace.landMergeGroup({ mergeGroupRef: merged.mergeGroupRef, artifactSetRef: artifacts.artifactSetRef, gateReceipt: receipt })
  assert.equal(landed.landed, true)
  assert.equal(landed.headCommit, RESULT)
})
