const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash, generateKeyPairSync } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const qualityUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'quality-evidence.js')).href
const orchestratorUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'test-orchestrator.js')).href
const HEAD = '1'.repeat(40)
const RESULT = '2'.repeat(40)
function digest(value) { return `sha256:${createHash('sha256').update(String(value)).digest('hex')}` }
function binding(overrides = {}) {
  return {
    projectRef: 'project_runner', repositoryRef: 'repository_runner', authorityEpoch: 1,
    mergeGroupRef: 'mergegroup_runner', baseHead: HEAD, resultCommit: RESULT,
    artifactSetRef: 'artifactset_runner', manifestDigest: digest('runner-manifest'), ...overrides
  }
}
async function fixture() {
  const qualityMod = await import(qualityUrl)
  const orchestratorMod = await import(orchestratorUrl)
  let now = 120_000_000
  const qualityKeys = generateKeyPairSync('ed25519')
  const quality = new qualityMod.QualityEvidenceAuthority({
    projectRef: 'project_runner', repositoryRef: 'repository_runner', secret: 'quality-runner-secret-with-twenty-four-characters',
    qualityPrivateKey: qualityKeys.privateKey, now: () => now
  })
  function runner(handle, trust, capabilities) {
    const keys = generateKeyPairSync('ed25519')
    const record = quality.registerRunner({ runnerHandle: handle, displayName: handle, trust, capabilities, publicKey: keys.publicKey })
    return { record, keys }
  }
  const standard = runner('private-standard-runner', 'standard', ['unit'])
  const trusted = runner('private-trusted-runner', 'trusted', ['security', 'e2e'])
  const untrusted = runner('private-untrusted-runner', 'untrusted', ['unit'])
  const plan = quality.createPlan({
    name: 'Distributed gate',
    suites: [
      { suiteRef: 'unit', tier: 'fast', required: true, minimumTrust: 'standard', minimumTests: 2 },
      { suiteRef: 'security', tier: 'security', required: true, minimumTrust: 'trusted', minimumTests: 1 },
      { suiteRef: 'e2e', tier: 'full', required: false, minimumTrust: 'trusted', minimumTests: 1 }
    ]
  })
  const orchestrator = new orchestratorMod.TestOrchestrator({ qualityAuthority: quality, secret: 'orchestrator-secret-with-twenty-four-characters', now: () => now })
  function template(suiteRef, profiles = ['merge', 'nightly', 'release'], maxAttempts = 2) {
    return orchestrator.registerTemplate({
      suiteRef, templateDigest: digest(`${suiteRef}-template`), environmentDigest: digest(`${suiteRef}-environment`),
      version: '1.0.0', allowedProfiles: profiles, timeoutMs: 60_000, maxAttempts
    })
  }
  const templates = { unit: template('unit'), security: template('security'), e2e: template('e2e', ['nightly', 'release']) }
  return {
    qualityMod, orchestratorMod, quality, orchestrator, plan, templates, standard, trusted, untrusted,
    getNow: () => now, setNow: value => { now = value }
  }
}
function templateRefs(state, profile = 'merge') {
  return profile === 'merge' ? [state.templates.unit.templateRef, state.templates.security.templateRef] : Object.values(state.templates).map(item => item.templateRef)
}
function signedAttestation(state, lease, runner, options = {}) {
  const minimum = lease.suiteRef === 'unit' ? 2 : 1
  const result = options.result ?? 'pass'
  const prepared = state.quality.prepareAttestation({
    planRef: lease.planRef, suiteRef: lease.suiteRef, runnerRef: runner.record.runnerRef,
    binding: options.binding ?? lease.binding, result,
    counts: options.counts ?? { total: minimum, passed: result === 'pass' ? minimum : 0, failed: result === 'fail' ? minimum : 0, skipped: 0 },
    environmentDigest: options.environmentDigest ?? lease.environmentDigest,
    evidenceDigest: digest(options.evidence ?? `${lease.jobRef}-${lease.attempt}`),
    startedAt: options.startedAt ?? state.getNow(), finishedAt: options.finishedAt ?? state.getNow()
  })
  return state.qualityMod.signTestAttestation(prepared, runner.keys.privateKey)
}

test('templates are digest-only admin policy and profiles select exact suites', async () => {
  const state = await fixture()
  assert.throws(() => state.orchestrator.registerTemplate({
    suiteRef: 'unsafe', templateDigest: digest('unsafe'), environmentDigest: digest('unsafe-env'), version: '1',
    allowedProfiles: ['merge'], timeoutMs: 1_000, command: 'rm -rf /'
  }), /unsupported fields: command/u)
  const merge = state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding(), templateRefs: templateRefs(state) })
  assert.deepEqual(merge.jobCounts, { queued: 2 })
  const nightly = state.orchestrator.startCampaign({ profile: 'nightly', planRef: state.plan.planRef, binding: binding({ artifactSetRef: 'artifactset_nightly' }), templateRefs: templateRefs(state, 'nightly') })
  assert.deepEqual(nightly.jobCounts, { queued: 3 })
  assert.deepEqual(state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding(), templateRefs: templateRefs(state) }), merge)
  assert.throws(() => state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding({ artifactSetRef: 'artifactset_missing' }), templateRefs: [state.templates.unit.templateRef] }), /exactly one template/u)
  const projection = JSON.stringify({ orchestrator: state.orchestrator, templates: state.templates })
  for (const forbidden of ['orchestrator-secret', 'private-standard-runner', 'command', 'rm -rf']) assert.equal(projection.includes(forbidden), false)
})

test('release outranks merge and nightly while capability and trust gates are authoritative', async () => {
  const state = await fixture()
  state.orchestrator.startCampaign({ profile: 'nightly', planRef: state.plan.planRef, binding: binding({ artifactSetRef: 'artifactset_nightly' }), templateRefs: templateRefs(state, 'nightly') })
  state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding({ artifactSetRef: 'artifactset_merge' }), templateRefs: templateRefs(state) })
  state.orchestrator.startCampaign({ profile: 'release', planRef: state.plan.planRef, binding: binding({ artifactSetRef: 'artifactset_release' }), templateRefs: templateRefs(state, 'release') })
  assert.equal(state.orchestrator.claimJob({ runnerRef: state.untrusted.record.runnerRef }), undefined)
  const standardLease = state.orchestrator.claimJob({ runnerRef: state.standard.record.runnerRef })
  assert.equal(standardLease.profile, 'release')
  assert.equal(standardLease.suiteRef, 'unit')
  const trustedLease = state.orchestrator.claimJob({ runnerRef: state.trusted.record.runnerRef })
  assert.equal(trustedLease.profile, 'release')
  assert.ok(['security', 'e2e'].includes(trustedLease.suiteRef))
  const projection = JSON.stringify(state.orchestrator)
  assert.equal(projection.includes(standardLease.leaseToken), false)
})

test('signed exact job evidence completes a merge campaign and issues a passing Gate Receipt', async () => {
  const state = await fixture()
  const campaign = state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding(), templateRefs: templateRefs(state) })
  const unitLease = state.orchestrator.claimJob({ runnerRef: state.standard.record.runnerRef })
  const wrong = signedAttestation(state, unitLease, state.standard, { binding: binding({ artifactSetRef: 'artifactset_wrong' }) })
  assert.throws(() => state.orchestrator.completeJob({ jobRef: unitLease.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: unitLease.leaseToken, attestation: wrong, signature: wrong.signature }), /does not match the exact leased test job/u)
  assert.equal(state.quality.toJSON().attestationCount, 0, 'mismatched evidence must not be admitted as a side effect')
  const unit = signedAttestation(state, unitLease, state.standard)
  assert.equal(state.orchestrator.completeJob({ jobRef: unitLease.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: unitLease.leaseToken, attestation: unit, signature: unit.signature }).job.state, 'passed')
  const securityLease = state.orchestrator.claimJob({ runnerRef: state.trusted.record.runnerRef })
  const security = signedAttestation(state, securityLease, state.trusted)
  const completed = state.orchestrator.completeJob({ jobRef: securityLease.jobRef, runnerRef: state.trusted.record.runnerRef, leaseToken: securityLease.leaseToken, attestation: security, signature: security.signature })
  assert.equal(completed.campaign.state, 'passed')
  assert.equal(completed.campaign.gateReceipt.decision, 'pass')
  assert.equal(state.quality.verifyGateReceipt(completed.campaign.gateReceipt, binding()), true)
  assert.equal(state.orchestrator.campaignStatus(campaign.campaignRef).jobCounts.passed, 2)
})

test('infrastructure errors and expired leases retry only to the template attempt bound', async () => {
  const state = await fixture()
  state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding(), templateRefs: templateRefs(state) })
  const first = state.orchestrator.claimJob({ runnerRef: state.standard.record.runnerRef, leaseMs: 1_000 })
  const retried = state.orchestrator.reportInfrastructureFailure({ jobRef: first.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: first.leaseToken, reasonCode: 'RUNNER_LOST' })
  assert.equal(retried.job.state, 'queued')
  const second = state.orchestrator.claimJob({ runnerRef: state.standard.record.runnerRef, leaseMs: 1_000 })
  assert.equal(second.attempt, 2)
  state.setNow(state.getNow() + 1_001)
  state.orchestrator.sweep()
  assert.equal(state.orchestrator.jobStatus(second.jobRef).state, 'error')
  assert.throws(() => state.orchestrator.reportInfrastructureFailure({ jobRef: second.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: second.leaseToken, reasonCode: 'RUNNER_LOST' }), /stale/u)
})

test('project pause requests cancellation, prevents wakeups, and only explicit resume requeues work', async () => {
  const state = await fixture()
  const campaign = state.orchestrator.startCampaign({ profile: 'merge', planRef: state.plan.planRef, binding: binding(), templateRefs: templateRefs(state) })
  const lease = state.orchestrator.claimJob({ runnerRef: state.standard.record.runnerRef })
  state.orchestrator.pauseProject()
  assert.equal(state.orchestrator.claimJob({ runnerRef: state.trusted.record.runnerRef }), undefined)
  assert.equal(state.orchestrator.heartbeat({ jobRef: lease.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: lease.leaseToken }).cancelRequested, true)
  state.orchestrator.resumeProject()
  const acknowledged = state.orchestrator.reportInfrastructureFailure({ jobRef: lease.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: lease.leaseToken, reasonCode: 'CANCELED' })
  assert.equal(acknowledged.job.state, 'queued')
  const replacement = state.orchestrator.claimJob({ runnerRef: state.standard.record.runnerRef })
  assert.equal(replacement.jobRef, lease.jobRef)
  assert.equal(replacement.attempt, 2)
  state.orchestrator.cancelCampaign(campaign.campaignRef)
  assert.equal(state.orchestrator.heartbeat({ jobRef: replacement.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: replacement.leaseToken }).cancelRequested, true)
  const canceled = state.orchestrator.reportInfrastructureFailure({ jobRef: replacement.jobRef, runnerRef: state.standard.record.runnerRef, leaseToken: replacement.leaseToken, reasonCode: 'CANCELED' })
  assert.equal(canceled.job.state, 'canceled')
  assert.equal(canceled.campaign.state, 'canceled')
})
