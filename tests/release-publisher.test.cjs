const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('node:test')
const YAML = require('yaml')
const {
  FORMAL_WINDOWS_DOWNLOAD_TIMEOUT_MS,
  SELF_TEST_CHECKS,
  normalizeFormalWindowsAsset,
  performFormalWindowsValidation,
  revalidateFormalWindowsValidation,
} = require('../scripts/release-local-formal-windows-validation.cjs')
const {
  assertCandidateRebindAllowed,
  assertExistingTagRecoveryAllowed,
  canReattachPreferredDraft,
  classifyCnbAssetStatuses,
  isExactDetachedDraft,
  matchesWorkflowRunIdentity,
  normalizePublisherPackagingState,
  normalizeReleaseBody,
  selectReleaseForTag,
  selectUniqueWorkflowRunByDisplayTitle,
  validateCnbMirrorObservations,
  validateCompletedPhaseEvidence,
  validateGithubReleaseAgainstManifest
} = require('../scripts/release-publish-selection.cjs')

const root = path.resolve(__dirname, '..')
const read = file => readFileSync(path.join(root, file), 'utf8')

const expectedPhases = [
  'local-source-gates',
  'desktop-cloud-builds',
  'immutable-tag',
  'desktop-publication',
  'local-formal-windows-validation',
  'signed-android',
  'signed-components',
  'release-manifest',
  'cnb-assets',
  'stable-components',
  'cnb-stable',
  'complete'
]

test('legacy local packaging state always reruns the cloud-only local source gate', () => {
  const legacy = { schemaVersion: 1, phases: { 'local-windows': { status: 'completed' } } }
  assert.equal(normalizePublisherPackagingState(legacy), true)
  assert.equal(legacy.schemaVersion, 3)
  assert.equal(legacy.packagingMode, 'github-actions-only')
  assert.equal(legacy.releaseOrder, 'cloud-build-before-tag')
  assert.equal(Object.hasOwn(legacy.phases, 'local-windows'), false)
  assert.equal(Object.hasOwn(legacy.phases, 'local-source-gates'), false)

  const incorrectlyMigrated = {
    schemaVersion: 2,
    packagingMode: 'github-actions-only',
    phases: { 'local-source-gates': { status: 'completed', migratedFrom: 'local-windows' } }
  }
  assert.equal(normalizePublisherPackagingState(incorrectlyMigrated), true)
  assert.equal(Object.hasOwn(incorrectlyMigrated.phases, 'local-source-gates'), false)

  const current = { schemaVersion: 3, packagingMode: 'github-actions-only', releaseOrder: 'cloud-build-before-tag', phases: { 'local-source-gates': { status: 'completed' } } }
  assert.equal(normalizePublisherPackagingState(current), false)
  assert.equal(current.phases['local-source-gates'].status, 'completed')
  assert.throws(
    () => normalizePublisherPackagingState({ packagingMode: 'local-windows', phases: {} }),
    /packaging mode mismatch/u
  )
})

test('historical tag-first state remains explicitly readable without reinterpreting completed phases', () => {
  const historical = {
    schemaVersion: 2,
    packagingMode: 'github-actions-only',
    productRevision: 'a'.repeat(40),
    phases: { 'immutable-tag': { status: 'completed' }, 'desktop-cloud-builds': { status: 'failed' } }
  }
  assert.equal(normalizePublisherPackagingState(historical), true)
  assert.equal(historical.schemaVersion, 3)
  assert.equal(historical.releaseOrder, 'legacy-tag-first')
  assert.equal(historical.phases['immutable-tag'].status, 'completed')
  assert.equal(historical.phases['desktop-cloud-builds'].status, 'failed')
})

test('same-version candidate rebind is allowed only before every publication side effect', () => {
  const state = { sourceRevision: 'a'.repeat(40), productRevision: '', phases: { 'desktop-cloud-builds': { status: 'failed', runId: 1 } } }
  const safe = { oldRunTerminal: true, sameVersion: true, fastForward: true, localTagExists: false, remoteTagExists: false, githubReleaseExists: false, cnbReleaseExists: false, stablePromoted: false }
  assert.equal(assertCandidateRebindAllowed(state, safe), true)
  for (const [field, value, message] of [
    ['oldRunTerminal', false, /previous cloud run/u],
    ['sameVersion', false, /product versions/u],
    ['fastForward', false, /fast-forward/u],
    ['localTagExists', true, /immutable tag/u],
    ['remoteTagExists', true, /immutable tag/u],
    ['githubReleaseExists', true, /publication side effect/u],
    ['cnbReleaseExists', true, /publication side effect/u],
    ['stablePromoted', true, /publication side effect/u]
  ]) assert.throws(() => assertCandidateRebindAllowed(state, { ...safe, [field]: value }), message, field)
  assert.throws(() => assertCandidateRebindAllowed({ ...state, productRevision: 'a'.repeat(40) }, safe), /immutable tag/u)

  const failedBeforeTagAuthorization = {
    status: 'failed',
    startedAt: '2026-08-26T11:00:31.214Z',
    failedAt: '2026-08-26T11:00:31.682Z',
    error: 'Publication requires a clean tree.'
  }
  assert.equal(assertCandidateRebindAllowed({
    ...state,
    phases: { ...state.phases, 'immutable-tag': failedBeforeTagAuthorization }
  }, safe), true, 'a failed immutable-tag preflight with no authorization checkpoint has no tag side effect')
  for (const immutable of [
    { status: 'running' },
    { ...failedBeforeTagAuthorization, status: 'completed' },
    { ...failedBeforeTagAuthorization, tagAuthorization: { operation: 'create-local' } },
    { ...failedBeforeTagAuthorization, productRevision: 'a'.repeat(40) }
  ]) assert.throws(
    () => assertCandidateRebindAllowed({ ...state, phases: { ...state.phases, 'immutable-tag': immutable } }, safe),
    /tag-dependent/u
  )

  const publisher = read('scripts/release-publish.mjs')
  assert.match(publisher, /candidateAttempts\.push\([\s\S]*sourceRevision: previous[\s\S]*desktopRunId[\s\S]*desktopConclusion: oldRunConclusion[\s\S]*phases: structuredClone/u)
  assert.match(publisher, /oldRunTerminal = matchesWorkflowRunIdentity[\s\S]*oldRun\.status === 'completed'[\s\S]*oldRunConclusion = String\(oldRun\.conclusion/u)
  assert.match(publisher, /state\.sourceRevision = currentHead[\s\S]*state\.phases = \{\}/u)
  const immutableTagPhase = publisher.slice(publisher.indexOf("phase(state, 'immutable-tag'"), publisher.indexOf("phase(state, 'desktop-publication'"))
  const tagAuthorizationCheckpoint = immutableTagPhase.indexOf("await checkpoint(state, 'immutable-tag'")
  const tagCreation = immutableTagPhase.indexOf("gitRun(['tag'")
  assert.ok(
    tagAuthorizationCheckpoint >= 0 && tagCreation > tagAuthorizationCheckpoint,
    'the first irreversible tag mutation must remain behind its durable authorization checkpoint'
  )
})

test('dirty preflight state corrects an old-version binding only before every effect', () => {
  const state = {
    sourceRevision: 'a'.repeat(40),
    productRevision: '',
    candidateAttempts: [],
    phases: {
      'local-source-gates': {
        status: 'failed',
        startedAt: '2026-09-01T08:34:30.801Z',
        failedAt: '2026-09-01T08:34:30.870Z',
        error: 'Publication requires a clean tree. Commit or remove:\n M package.json'
      }
    }
  }
  const safe = {
    oldRunTerminal: true,
    previousVersion: false,
    currentVersion: true,
    sameVersion: false,
    fastForward: true,
    localTagExists: false,
    remoteTagExists: false,
    githubReleaseExists: false,
    cnbReleaseExists: false,
    stablePromoted: false
  }
  assert.equal(assertCandidateRebindAllowed(state, safe), true)
  for (const changed of [
    { candidateAttempts: [{ sourceRevision: '0'.repeat(40) }] },
    { phases: { ...state.phases, 'desktop-cloud-builds': { status: 'failed' } } },
    { phases: { 'local-source-gates': { ...state.phases['local-source-gates'], error: 'release verification failed' } } },
    { phases: { 'local-source-gates': { ...state.phases['local-source-gates'], sourceRevision: 'a'.repeat(40) } } }
  ]) assert.throws(() => assertCandidateRebindAllowed({ ...state, ...changed }, safe), /product versions/u)
  assert.throws(() => assertCandidateRebindAllowed(state, { ...safe, currentVersion: false }), /product versions/u)
  assert.throws(() => assertCandidateRebindAllowed(state, { ...safe, oldRunTerminal: false }), /previous cloud run/u)
  assert.throws(() => assertCandidateRebindAllowed(state, { ...safe, githubReleaseExists: true }), /publication side effect/u)

  const publisher = read('scripts/release-publish.mjs')
  assert.match(publisher, /if \(!state\.sourceRevision\) \{\s*assertClean\(\)\s*if \(!revisionHasVersion\(currentHead\)\)/u)
})

test('pre-existing Tag is adopted only inside the publisher create/push crash window', () => {
  const revision = 'a'.repeat(40)
  const desktop = { status: 'completed', requestId: 'request-1', runId: 42 }
  const external = { sourceRevision: revision, phases: { 'local-source-gates': { status: 'completed' }, 'desktop-cloud-builds': desktop } }
  assert.throws(
    () => assertExistingTagRecoveryAllowed(external, { tagRevision: revision, localTagExists: true, remoteTagExists: false }),
    /not authorized/u
  )
  const lateExternal = structuredClone(external)
  lateExternal.phases['immutable-tag'] = { status: 'running' }
  assert.throws(
    () => assertExistingTagRecoveryAllowed(lateExternal, { tagRevision: revision, localTagExists: true, remoteTagExists: true }),
    /not authorized/u,
    'a same-SHA external Tag created after startup must not bypass the phase-local authorization marker'
  )
  const authorized = {
    ...external,
    phases: {
      ...external.phases,
      'immutable-tag': {
        status: 'running',
        tagAuthorization: {
          operation: 'create-local',
          sourceRevision: revision,
          requestId: desktop.requestId,
          runId: desktop.runId,
          authorizedAt: '2026-08-24T00:00:00.000Z'
        }
      }
    }
  }
  assert.equal(assertExistingTagRecoveryAllowed(authorized, { tagRevision: revision, localTagExists: true, remoteTagExists: false }), true)
  assert.throws(() => assertExistingTagRecoveryAllowed(authorized, { tagRevision: revision, localTagExists: true, remoteTagExists: true }), /not authorized/u)
  const pushAuthorized = structuredClone(authorized)
  pushAuthorized.phases['immutable-tag'].tagAuthorization.operation = 'push-remote'
  assert.equal(assertExistingTagRecoveryAllowed(pushAuthorized, { tagRevision: revision, localTagExists: true, remoteTagExists: true }), true)
  for (const mutate of [
    state => { state.phases['immutable-tag'].tagAuthorization.sourceRevision = 'b'.repeat(40) },
    state => { state.phases['immutable-tag'].tagAuthorization.requestId = 'other' },
    state => { state.phases['immutable-tag'].tagAuthorization.runId = 43 },
    state => { state.phases['immutable-tag'].status = 'completed' }
  ]) {
    const tampered = structuredClone(pushAuthorized)
    mutate(tampered)
    assert.throws(() => assertExistingTagRecoveryAllowed(tampered, { tagRevision: revision, localTagExists: true, remoteTagExists: true }), /not authorized/u)
  }

  const publisher = read('scripts/release-publish.mjs')
  const guard = publisher.slice(publisher.indexOf('function requireExistingTagCandidateEvidence'), publisher.indexOf('async function publish()'))
  assert.match(guard, /assertExistingTagRecoveryAllowed\(state/u)
  assert.match(guard, /requireDesktopBuildEvidence\(desktop\.runId, stateDesktopRequestId\)/u)
  const tagPhase = publisher.slice(publisher.indexOf("phase(state, 'immutable-tag'"), publisher.indexOf("phase(state, 'desktop-publication'"))
  const phaseGuard = tagPhase.indexOf('assertExistingTagRecoveryAllowed(state')
  const createBranch = tagPhase.indexOf('if (!local)')
  const pushBranch = tagPhase.indexOf('if (!existing)')
  assert.ok(phaseGuard >= 0 && phaseGuard < createBranch && phaseGuard < pushBranch, 'immutable-tag phase must guard observed refs before skipping create or push')
  assert.match(tagPhase, /operation: 'create-local'[\s\S]*gitRun\(\['tag'/u)
  assert.match(tagPhase, /operation: 'push-remote'[\s\S]*gitRun\(\['push'/u)
})

test('CNB absence requires exactly 18 canonical assets all returning 404', () => {
  assert.equal(classifyCnbAssetStatuses(Array(18).fill(404)), false)
  assert.equal(classifyCnbAssetStatuses([...Array(17).fill(404), 200]), true)
  assert.equal(classifyCnbAssetStatuses([...Array(17).fill(404), 302]), true)
  assert.throws(() => classifyCnbAssetStatuses([...Array(17).fill(404), 410]), /unknown/u)
  assert.throws(() => classifyCnbAssetStatuses([...Array(17).fill(404), 500]), /unknown/u)
  assert.throws(() => classifyCnbAssetStatuses(Array(17).fill(404)), /exactly 18/u)
  assert.throws(() => classifyCnbAssetStatuses(Array(19).fill(404)), /exactly 18/u)
  assert.throws(() => classifyCnbAssetStatuses([]), /exactly 18/u)
  const publisher = read('scripts/release-publish.mjs')
  const sideEffects = publisher.slice(publisher.indexOf('async function candidateSideEffects'), publisher.indexOf('async function rebindCandidateRevision'))
  assert.match(sideEffects, /Promise\.all\(expectedAllNames\(\)\.map[\s\S]*releases\/download\/\$\{tag\}\/[\s\S]*method: 'HEAD'[\s\S]*AbortSignal\.timeout/u)
  assert.doesNotMatch(sideEffects, /releases\/tag\/\$\{tag\}/u)
})

test('tampered stored workflow run identities cannot satisfy a release phase', () => {
  const run = {
    workflowName: 'Publish Signed Android Mobile',
    workflowPath: '.github/workflows/android-mobile-release.yml',
    event: 'workflow_dispatch',
    headSha: 'a'.repeat(40),
    headBranch: 'v1.0.44',
    displayTitle: `Candidate v1.0.44 @ ${'a'.repeat(40)} · request-1`
  }
  const expected = {
    workflowName: run.workflowName,
    workflowPath: run.workflowPath,
    events: ['workflow_dispatch'],
    headSha: run.headSha,
    headBranch: run.headBranch,
    displayTitle: run.displayTitle
  }
  assert.equal(matchesWorkflowRunIdentity(run, expected), true)
  for (const [field, value] of [
    ['workflowName', 'Unrelated Workflow'],
    ['workflowPath', '.github/workflows/unrelated.yml'],
    ['event', 'schedule'],
    ['headSha', 'b'.repeat(40)],
    ['headBranch', 'main'],
    ['displayTitle', `${run.displayTitle}-tampered`]
  ]) {
    assert.equal(matchesWorkflowRunIdentity({ ...run, [field]: value }, expected), false, field)
  }
})

test('workflow run discovery treats zero, one, and duplicate exact display titles distinctly', () => {
  const title = 'Candidate v1.0.44 @ source · request-1'
  assert.equal(selectUniqueWorkflowRunByDisplayTitle([], title, 'Candidate'), null)
  const one = { databaseId: 1, displayTitle: title }
  assert.equal(selectUniqueWorkflowRunByDisplayTitle([one], title, 'Candidate'), one)
  assert.equal(selectUniqueWorkflowRunByDisplayTitle([{ databaseId: 2, displayTitle: 'other' }, one], title, 'Candidate'), one)
  assert.throws(() => selectUniqueWorkflowRunByDisplayTitle([one, { ...one, databaseId: 3 }], title, 'Candidate'), /ambiguous \(2 runs\)/u)
  const publisher = read('scripts/release-publish.mjs')
  assert.match(publisher, /apiDisplayTitle[\s\S]*viewDisplayTitle[\s\S]*apiDisplayTitle !== viewDisplayTitle/u)
})

test('completed publication phases cannot skip fresh run evidence validation', async () => {
  let validations = 0
  const completed = { status: 'completed', runId: 123 }
  assert.equal(await validateCompletedPhaseEvidence(completed, async phase => {
    validations += 1
    assert.equal(phase.runId, 123)
  }), true)
  assert.equal(validations, 1)
  assert.equal(await validateCompletedPhaseEvidence({ status: 'running', runId: 123 }, async () => { validations += 1 }), false)
  assert.equal(validations, 1)
  await assert.rejects(() => validateCompletedPhaseEvidence(completed), /requires fresh evidence validation/u)
  await assert.rejects(() => validateCompletedPhaseEvidence(completed, async () => { throw new Error('forged run') }), /forged run/u)
})

test('GitHub and CNB 18-asset drift is rejected before stable component promotion', () => {
  const names = [...Array.from({ length: 17 }, (_, index) => `asset-${String(index + 1).padStart(2, '0')}.bin`), 'SHA256SUMS.txt']
  const assets = names.map((name, index) => {
    const encoded = encodeURIComponent(name)
    return {
      name,
      size: 100 + index,
      sha256: (index + 1).toString(16).padStart(64, '0'),
      browser_download_url: `https://github.com/org/repo/releases/download/v1.0.44/${encoded}`,
      mirror_urls: [`https://cnb.cool/org/repo/-/releases/download/v1.0.44/${encoded}`]
    }
  })
  const liveGithubAssets = assets.map(asset => ({
    name: asset.name,
    size: asset.size,
    digest: `sha256:${asset.sha256}`,
    browser_download_url: asset.browser_download_url
  }))
  const observations = assets.map(asset => ({
    name: asset.name,
    url: asset.mirror_urls[0],
    status: 200,
    size: asset.size,
    ...(asset.name === 'SHA256SUMS.txt' ? { sha256: asset.sha256 } : {})
  }))
  assert.equal(assets.length, 18)
  assert.equal(validateGithubReleaseAgainstManifest(assets, liveGithubAssets), true)
  assert.equal(validateCnbMirrorObservations(assets, observations), true)
  assert.throws(() => validateGithubReleaseAgainstManifest(assets, liveGithubAssets.slice(1)), /exact signed asset set/u)
  assert.throws(() => validateGithubReleaseAgainstManifest(assets, liveGithubAssets.map(item => item.name === assets[0].name ? { ...item, digest: `sha256:${'f'.repeat(64)}` } : item)), /asset drifted/u)
  assert.throws(() => validateCnbMirrorObservations(assets, observations.slice(1)), /exact signed asset set/u)
  assert.throws(() => validateCnbMirrorObservations(assets, observations.map(item => item.name === assets[0].name ? { ...item, url: 'https://cnb.cool/wrong' } : item)), /asset drifted/u)
  assert.throws(() => validateCnbMirrorObservations(assets, observations.map(item => item.name === assets[1].name ? { ...item, status: 404 } : item)), /asset drifted/u)
  assert.throws(() => validateCnbMirrorObservations(assets, observations.map(item => item.name === assets[2].name ? { ...item, size: item.size - 1 } : item)), /asset drifted/u)
  assert.throws(() => validateCnbMirrorObservations(assets, observations.map(item => item.name === 'SHA256SUMS.txt' ? { ...item, sha256: 'f'.repeat(64) } : item)), /digest drifted/u)
})

test('one publisher command exposes the immutable resumable release order', () => {
  const pkg = JSON.parse(read('package.json'))
  const output = execFileSync(process.execPath, ['scripts/release-publish.mjs', 'plan', '--version', pkg.version, '--poll-seconds', '1'], {
    cwd: root,
    encoding: 'utf8'
  })
  const plan = JSON.parse(output)
  assert.equal(plan.command, `npm run release:publish -- run --version ${pkg.version}`)
  assert.deepEqual(plan.phases, expectedPhases)
  assert.equal(plan.packagingMode, 'github-actions-only')
  assert.ok(plan.stateFile.endsWith(`v${pkg.version}-publish.json`))
  assert.ok(plan.guarantees.includes('local source gates without local release packaging'))
  assert.ok(plan.guarantees.includes('all release packages built and tested by GitHub Actions before tagging'))
  assert.ok(plan.guarantees.includes('cloud-only same-run release artifact transfer'))
  assert.ok(plan.guarantees.includes('public formal Windows portable isolated self-test before signed publication'))
  assert.ok(plan.guarantees.includes('stable feeds last'))
  assert.equal(pkg.scripts['release:publish'], 'node scripts/release-publish.mjs')
})

test('publisher resumes atomically and never downloads Actions binaries locally', () => {
  const source = read('scripts/release-publish.mjs')
  assert.match(source, /acquirePublicationLock/u)
  assert.match(source, /status === 'completed'/u)
  assert.match(source, /function gitCaptureRaw[\s\S]*trim: false/u)
  assert.match(source, /function assertClean[\s\S]*gitCaptureRaw\(\['status'/u)
  assert.match(source, /\$\{tag\}-publish\.json/u)
  assert.match(source, /PACKAGING_MODE = 'github-actions-only'/u)
  assert.match(source, /normalizePackagingState[\s\S]*normalizePublisherPackagingState/u)
  const localGate = source.slice(source.indexOf('await phase(state, LOCAL_GATE_PHASE'), source.indexOf("await phase(state, 'desktop-cloud-builds'"))
  assert.match(localGate, /release:orchestrate[\s\S]*--through', 'verify'/u)
  assert.match(localGate, /rmSync\(localDist[\s\S]*existsSync\(localDist\)/u)
  assert.doesNotMatch(localGate, /--through', 'windows'|npmRun\(\['run', 'dist'/u)
  assert.match(source, /recover-release-from-actions\.yml/u)
  assert.match(source, /release:cnb-cloud/u)
  assert.match(source, /workflowRun[\s\S]*actions\/runs\/[\s\S]*actions\/workflows\/\$\{api\?\.workflow_id\}[\s\S]*workflowMetadata\?\.name[\s\S]*workflowPath[\s\S]*matchesWorkflowRunIdentity/u)
  assert.doesNotMatch(source, /workflowName: String\(api\?\.name/u)
  assert.match(source, /run\.status === 'completed'[\s\S]*required\.every/u)
  assert.match(source, /signed-android'[\s\S]*androidWorkflowIdentity\(requestId\)[\s\S]*signed-components'[\s\S]*publishPostTagRecoveryFix\(\)[\s\S]*componentCheckpointWorkflowIdentity\(completed\)/u)
  for (const [phaseName, nextPhase] of [
    ['desktop-cloud-builds', 'immutable-tag'],
    ['immutable-tag', 'desktop-publication'],
    ['desktop-publication', 'local-formal-windows-validation'],
    ['local-formal-windows-validation', 'signed-android'],
    ['signed-android', 'signed-components'],
    ['signed-components', 'release-manifest']
  ]) {
    const completedSegment = source.slice(source.indexOf(`phase(state, '${phaseName}'`), source.indexOf(`phase(state, '${nextPhase}'`))
    assert.match(completedSegment, /validateCompleted:/u, phaseName)
  }
  assert.match(source, /waitForDesktopBuildDiscovery/u)
  assert.match(source, /Workflow completed without successful required jobs/u)
  assert.match(source, /failedBuild \? null : run/u)
  assert.match(source, /promoteStableFeeds/u)
  const stablePhase = source.slice(source.indexOf("phase(state, 'stable-components'"), source.indexOf("phase(state, 'cnb-stable'"))
  assert.ok(stablePhase.indexOf('verifyCloudAssetMirrorsBeforeStable') < stablePhase.indexOf('promoteStableFeeds'))
  assert.match(source, /publishPostTagRecoveryFix[\s\S]*publisher_revision[\s\S]*recoverySource\.ref/u)
  assert.match(source, /normalizeReleaseBody\(readFileSync[\s\S]*release-notes\.md/u)
  assert.match(source, /release\.body !== expectedBody[\s\S]*--method', 'PATCH'[\s\S]*normalized\.draft !== true/u)
  assert.match(source, /preferredReleaseId[\s\S]*reattachPreferredDraft/u)
  assert.match(source, /canReattachPreferredDraft[\s\S]*--method', 'DELETE'[\s\S]*--method', 'PATCH'/u)
  assert.doesNotMatch(source, /gh[^\n]*run[^\n]*download/u)
  assert.ok(source.indexOf("'cnb-assets'") < source.indexOf("'stable-components'"))
  assert.ok(source.indexOf("'stable-components'") < source.indexOf("'cnb-stable'"))
  assert.match(source, /'release:cnb-cloud', '--', '-StableOnly'/u)
})

test('formal Windows validation is ordered after public desktop bytes and before every remaining publication', () => {
  const publisher = read('scripts/release-publish.mjs')
  const desktop = publisher.indexOf("phase(state, 'desktop-publication'")
  const localFormal = publisher.indexOf("phase(state, 'local-formal-windows-validation'")
  const android = publisher.indexOf("phase(state, 'signed-android'")
  const components = publisher.indexOf("phase(state, 'signed-components'")
  const releaseManifest = publisher.indexOf("phase(state, 'release-manifest'")
  assert.ok(desktop >= 0 && desktop < localFormal)
  assert.ok(localFormal < android && localFormal < components && localFormal < releaseManifest)
  const segment = publisher.slice(localFormal, android)
  assert.match(segment, /releaseForTag\(\)[\s\S]*performFormalWindowsValidation/u)
  assert.match(segment, /validateCompleted:[\s\S]*releaseForTag\(\)[\s\S]*revalidateFormalWindowsValidation/u)
  assert.doesNotMatch(segment, /localDist|\bdist\b|desktopBuildArtifacts/u)
  assert.match(publisher, /scripts\/release-local-formal-windows-validation\.cjs/u)
  for (const phaseName of ['signed-android', 'signed-components', 'release-manifest', 'cnb-assets', 'stable-components', 'cnb-stable', 'complete']) {
    const boundary = publisher.indexOf(`requireCurrentFormalWindowsValidation(state, '${phaseName}')`)
    const phase = publisher.indexOf(`phase(state, '${phaseName}'`)
    assert.ok(boundary > localFormal && boundary < phase, `${phaseName} must freshly revalidate the formal Windows identity before entering the phase`)
  }
  assert.match(publisher, /signed-android completion/u)
  assert.match(publisher, /signed-components completion/u)
  assert.match(publisher, /formalWindowsWorkflowFields\(formalBeforeAndroid\.evidence\)/u)
  assert.match(publisher, /formalWindowsWorkflowFields\(formalBeforeComponents\.evidence\)/u)
})

test('same-run formal Windows asset drift fails the cloud workflow and the publisher next-phase boundary', async () => {
  const { verifyFormalWindowsReleaseIdentity } = await import('../scripts/verify-formal-windows-release-identity.mjs')
  const expected = {
    repo: 'example/harness',
    tag: 'v9.8.7',
    productRevision: 'c'.repeat(40),
    releaseId: 17,
    assetId: 23,
    assetName: 'Harness-Desktop-9.8.7-portable-x64.exe',
    assetSize: 41,
    assetDigest: `sha256:${'d'.repeat(64)}`,
    assetUrl: 'https://github.com/example/harness/releases/download/v9.8.7/Harness-Desktop-9.8.7-portable-x64.exe',
  }
  const release = {
    id: expected.releaseId,
    tag_name: expected.tag,
    target_commitish: expected.productRevision,
    draft: false,
    prerelease: false,
    assets: [{
      id: expected.assetId,
      name: expected.assetName,
      size: expected.assetSize,
      digest: expected.assetDigest,
      browser_download_url: expected.assetUrl,
    }],
  }
  assert.equal(verifyFormalWindowsReleaseIdentity(release, expected), true)
  assert.throws(
    () => verifyFormalWindowsReleaseIdentity({ ...release, assets: [{ ...release.assets[0], id: expected.assetId + 1 }] }, expected),
    /asset identity changed/u,
  )
  assert.throws(
    () => verifyFormalWindowsReleaseIdentity({ ...release, assets: [] }, expected),
    /missing or duplicated/u,
  )

  const android = read('.github/workflows/android-mobile-release.yml')
  const components = read('.github/workflows/publish-production-components.yml')
  for (const workflow of [android, components]) {
    for (const field of ['product_revision', 'release_id', 'asset_id', 'asset_name', 'asset_size', 'asset_digest', 'asset_url']) {
      assert.match(workflow, new RegExp(`formal_windows_${field}:`, 'u'))
    }
    assert.match(workflow, /verify-formal-windows-release-identity\.mjs/u)
  }
  assert.ok(android.indexOf('verify-formal-windows-release-identity.mjs', android.indexOf('Add immutable signed APK')) > android.indexOf('Add immutable signed APK'))
  assert.ok(components.indexOf('verify-formal-windows-release-identity.mjs', components.indexOf('Upload only missing immutable signed component assets')) > components.indexOf('Upload only missing immutable signed component assets'))
  assert.ok(components.indexOf('verify-formal-windows-release-identity.mjs', components.indexOf('Sign exact desktop release manifest')) > components.indexOf('Sign exact desktop release manifest'))
  assert.ok(android.lastIndexOf('verify-formal-windows-release-identity.mjs') > android.indexOf('Verify public signed APK bytes and identity'))
  assert.ok(components.lastIndexOf('verify-formal-windows-release-identity.mjs') > components.indexOf('git push origin "HEAD:refs/heads/$branch"'))
  assert.match(components, /Revalidate formal Windows identity after all component side effects/u)
  assert.match(read('scripts/release-publish.mjs'), /signed-components completion[\s\S]*requireCurrentFormalWindowsValidation\(state, 'release-manifest'\)/u)
})

test('formal Windows validation downloads digest-bound public bytes and runs an isolated strict self-test', async t => {
  assert.equal(FORMAL_WINDOWS_DOWNLOAD_TIMEOUT_MS, 15 * 60 * 1000, 'public release downloads retain a bounded slow-network window')
  const temporary = mkdtempSync(path.join(tmpdir(), 'harness-formal-windows-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const version = '9.8.7'
  const tag = `v${version}`
  const repo = 'example/harness'
  const productRevision = 'a'.repeat(40)
  const bytes = Buffer.from('formal-public-portable-windows-bytes')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const name = `Harness-Desktop-${version}-portable-x64.exe`
  const asset = {
    id: 731,
    name,
    size: bytes.length,
    digest: `sha256:${digest}`,
    browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
  }
  let downloadedUrl = ''
  let observedArgs
  const evidence = await performFormalWindowsValidation({
    stateDir: temporary,
    version,
    productRevision,
    releaseId: 419,
    asset,
    repo,
    tag,
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async url => {
      downloadedUrl = url
      return new Response(bytes, { status: 200 })
    },
    spawnSyncImpl: (executable, args, options) => {
      observedArgs = args
      assert.ok(executable.startsWith(path.resolve(temporary)))
      assert.equal(options.windowsHide, true)
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined)
      const output = args.find(value => value.startsWith('--self-test-output=')).slice('--self-test-output='.length)
      writeFileSync(output, JSON.stringify({
        ok: true,
        product: { version },
        checks: Object.fromEntries(SELF_TEST_CHECKS.map(check => [check, true])),
      }))
      return { status: 0, signal: null }
    },
  })

  assert.equal(downloadedUrl, asset.browser_download_url)
  assert.deepEqual(readFileSync(evidence.executablePath), bytes)
  assert.equal(evidence.asset.id, asset.id)
  assert.equal(evidence.asset.size, bytes.length)
  assert.equal(evidence.asset.digest, asset.digest)
  assert.equal(evidence.productRevision, productRevision)
  assert.deepEqual(observedArgs, evidence.selfTestArguments)
  assert.ok(observedArgs.includes('--self-test'))
  assert.ok(observedArgs.includes(`--user-data-dir=${evidence.userDataDir}`))
  assert.ok(observedArgs.includes(`--harness-user-data-dir=${evidence.harnessUserDataDir}`))
  assert.notEqual(evidence.userDataDir, evidence.harnessUserDataDir)
  assert.ok(evidence.userDataDir.startsWith(path.resolve(temporary)))
  assert.ok(evidence.harnessUserDataDir.startsWith(path.resolve(temporary)))

  await revalidateFormalWindowsValidation({
    evidence,
    stateDir: temporary,
    version,
    productRevision,
    releaseId: 419,
    asset,
    repo,
    tag,
    platform: 'win32',
    arch: 'x64',
  })
})

test('formal Windows validation fails closed and completed evidence is revalidated', async t => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'harness-formal-windows-fail-'))
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const version = '9.8.7'
  const tag = `v${version}`
  const repo = 'example/harness'
  const productRevision = 'b'.repeat(40)
  const bytes = Buffer.from('official-byte-sequence')
  const digest = createHash('sha256').update(bytes).digest('hex')
  const name = `Harness-Desktop-${version}-portable-x64.exe`
  const asset = {
    id: 992,
    name,
    size: bytes.length,
    digest: `sha256:${digest}`,
    browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
  }
  assert.throws(
    () => normalizeFormalWindowsAsset({ ...asset, size: bytes.length + 1, digest: 'sha256:not-a-digest' }, { version, repo, tag }),
    /invalid sha256 digest/u,
  )
  await assert.rejects(
    performFormalWindowsValidation({
      stateDir: temporary,
      version,
      productRevision,
      releaseId: 42,
      asset,
      repo,
      tag,
      platform: 'linux',
      arch: 'x64',
      fetchImpl: async () => { throw new Error('must not download') },
      spawnSyncImpl: () => { throw new Error('must not launch') },
    }),
    /requires a Windows x64 host/u,
  )
  await assert.rejects(
    performFormalWindowsValidation({
      stateDir: temporary,
      version,
      productRevision,
      releaseId: 42,
      asset,
      repo,
      tag,
      platform: 'win32',
      arch: 'x64',
      fetchImpl: async () => new Response(Buffer.from('wrong bytes'), { status: 200 }),
      spawnSyncImpl: () => { throw new Error('must not launch') },
    }),
    /size mismatch|digest mismatch/u,
  )

  const evidence = await performFormalWindowsValidation({
    stateDir: temporary,
    version,
    productRevision,
    releaseId: 42,
    asset,
    repo,
    tag,
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async () => new Response(bytes, { status: 200 }),
    spawnSyncImpl: (_executable, args) => {
      const output = args.find(value => value.startsWith('--self-test-output=')).slice('--self-test-output='.length)
      writeFileSync(output, JSON.stringify({
        ok: true,
        product: { version },
        checks: Object.fromEntries(SELF_TEST_CHECKS.map(check => [check, true])),
      }))
      return { status: 0, signal: null }
    },
  })

  await assert.rejects(
    revalidateFormalWindowsValidation({
      evidence,
      stateDir: temporary,
      version,
      productRevision,
      releaseId: 42,
      asset: { ...asset, id: asset.id + 1 },
      repo,
      tag,
      platform: 'win32',
      arch: 'x64',
    }),
    /asset metadata changed: id/u,
  )
  writeFileSync(evidence.executablePath, Buffer.alloc(bytes.length, 0x78))
  await assert.rejects(
    revalidateFormalWindowsValidation({
      evidence,
      stateDir: temporary,
      version,
      productRevision,
      releaseId: 42,
      asset,
      repo,
      tag,
      platform: 'win32',
      arch: 'x64',
    }),
    /digest mismatch/u,
  )
  writeFileSync(evidence.executablePath, bytes)
  mkdirSync(path.dirname(evidence.reportPath), { recursive: true })
  writeFileSync(evidence.reportPath, JSON.stringify({
    ok: true,
    product: { version },
    checks: Object.fromEntries(SELF_TEST_CHECKS.map(check => [check, true])),
    harmlessButUncheckpointedChange: true,
  }))
  await assert.rejects(
    revalidateFormalWindowsValidation({
      evidence,
      stateDir: temporary,
      version,
      productRevision,
      releaseId: 42,
      asset,
      repo,
      tag,
      platform: 'win32',
      arch: 'x64',
    }),
    /report digest no longer matches/u,
  )
  writeFileSync(evidence.reportPath, JSON.stringify({
    ok: true,
    product: { version },
    checks: Object.fromEntries(SELF_TEST_CHECKS.map(check => [check, check !== SELF_TEST_CHECKS[0]])),
  }))
  await assert.rejects(
    revalidateFormalWindowsValidation({
      evidence,
      stateDir: temporary,
      version,
      productRevision,
      releaseId: 42,
      asset,
      repo,
      tag,
      platform: 'win32',
      arch: 'x64',
    }),
    /self-test check did not pass/u,
  )
})

test('successful pre-Tag run is the sole artifact source for post-Tag publication', () => {
  const source = read('scripts/release-publish.mjs')
  const build = source.slice(source.indexOf("phase(state, 'desktop-cloud-builds'"), source.indexOf("phase(state, 'immutable-tag'"))
  const tagPhase = source.slice(source.indexOf("phase(state, 'immutable-tag'"), source.indexOf("phase(state, 'desktop-publication'"))
  const publication = source.slice(source.indexOf("phase(state, 'desktop-publication'"), source.indexOf("phase(state, 'local-formal-windows-validation'"))
  assert.match(build, /await waitForRun\(run\.databaseId\)[\s\S]*desktopBuildArtifacts\(run\.databaseId\)/u)
  assert.match(tagPhase, /requireDesktopBuildEvidence\(desktopRunId\)[\s\S]*gitRun\(\['tag'/u)
  assert.match(publication, /requireDesktopBuildEvidence\(desktopRunId\)[\s\S]*source_run_id', desktopRunId/u)
  assert.match(publication, /displayTitle: `Recover \$\{tag\} from run \$\{desktopRunId\} release \$\{release\.id\} · \$\{recoveryRequestId\}`/u)
  assert.match(publication, /\['source_request_id', stateDesktopRequestId\]/u)
  assert.match(publication, /recoveryDispatchAttemptedAt[\s\S]*waitForExactWorkflowDiscovery[\s\S]*recoveryAttempts[\s\S]*retriedAt/u)
  assert.doesNotMatch(publication, /inputs:/u)
  assert.doesNotMatch(publication, /sourceRun\.conclusion === 'success'/u)
  assert.doesNotMatch(source, /gh[^\n]*run[^\n]*download/u)
})

test('v1.0.58 one-off UI failure blocks Tag and every public or stable phase while preserving same-version retry', () => {
  const publisher = read('scripts/release-publish.mjs')
  const workflow = read('.github/workflows/release.yml')
  const oneoffStart = workflow.indexOf('  oneoff-v1-0-58-windows-ui-validation:')
  const oneoffEnd = workflow.indexOf('\n  ios-simulators:', oneoffStart)
  assert.ok(oneoffStart >= 0 && oneoffEnd > oneoffStart)
  const oneoff = workflow.slice(oneoffStart, oneoffEnd)
  assert.match(oneoff, /^    if: \$\{\{ inputs\.tag == 'v1\.0\.58' \}\}$/mu)
  assert.match(oneoff, /^    needs: build$/mu)
  assert.doesNotMatch(oneoff, /contents: write|gh release|stable-components|cnb|immutable-tag/u)
  assert.match(oneoff, /git ls-remote --tags origin "refs\/tags\/\$env:ONEOFF_TAG"/u)
  assert.doesNotMatch(oneoff, /git ls-remote --exit-code/u)
  assert.match(oneoff, /\$remoteTagStatus -ne 0/u)
  assert.match(oneoff, /\$remoteTag\.Count -ne 0/u)

  const waitForRun = publisher.slice(publisher.indexOf('async function waitForRun(runId)'), publisher.indexOf('async function sleep()'))
  assert.match(waitForRun, /await waitForRunCompletion\(runId\)[\s\S]*run\.conclusion !== 'success'[\s\S]*throw new Error/u)
  const evidenceGate = publisher.slice(publisher.indexOf('function requireDesktopBuildEvidence'), publisher.indexOf('function requireSuccessfulWorkflowEvidence'))
  assert.match(evidenceGate, /run\.status !== 'completed' \|\| run\.conclusion !== 'success'/u)

  const buildPhase = publisher.indexOf("phase(state, 'desktop-cloud-builds'")
  const tagPhase = publisher.indexOf("phase(state, 'immutable-tag'")
  const publicationPhase = publisher.indexOf("phase(state, 'desktop-publication'")
  const stablePhase = publisher.indexOf("phase(state, 'stable-components'")
  assert.ok(buildPhase >= 0 && buildPhase < tagPhase && tagPhase < publicationPhase && publicationPhase < stablePhase)
  const preTag = publisher.slice(buildPhase, tagPhase)
  assert.match(preTag, /await waitForRun\(run\.databaseId\)/u)
  assert.match(preTag, /desktopBuildArtifacts\(run\.databaseId\)/u)

  const retryState = { sourceRevision: 'a'.repeat(40), productRevision: '', phases: { 'desktop-cloud-builds': { status: 'failed', runId: 731 } } }
  const noEffects = { oldRunTerminal: true, sameVersion: true, fastForward: true, localTagExists: false, remoteTagExists: false, githubReleaseExists: false, cnbReleaseExists: false, stablePromoted: false }
  assert.equal(assertCandidateRebindAllowed(retryState, noEffects), true)
})

test('second CNB synchronization is metadata-only and never repeats the 18-asset mirror', () => {
  const publisher = read('scripts/publish-cnb-cloud-mirror.ps1')
  const pipeline = read('.cnb.yml')
  assert.match(publisher, /\[switch\]\$StableOnly/u)
  assert.match(publisher, /\.cnb-stable-only/u)
  assert.match(publisher, /Stable-only mode: CNB Runner will validate metadata/u)
  assert.match(publisher, /if \(\$StableOnly\)[\s\S]*CNB stable feed verified/u)
  assert.match(pipeline, /Validate stable metadata-only synchronization/u)
  assert.match(pipeline, /if: test -f \.cnb-stable-only/u)
  assert.match(pipeline, /\.releaseVersion[\s\S]*\.channel == "stable"[\s\S]*\.components \| length > 0/u)
  assert.match(pipeline, /Prepare verified GitHub release assets\r?\n\s+if: test ! -f \.cnb-stable-only/u)
  assert.match(pipeline, /Upload verified assets with official plugin\r?\n\s+if: test ! -f \.cnb-stable-only/u)
  assert.match(publisher, /component-feeds\/pr-preview\/latest\.json/u)
  assert.match(publisher, /PR preview latest feed is missing its immutable manifest wrapper/u)
  assert.match(publisher, /\$mirrorFiles \+= @\(\$previewIndexFile, \$previewManifestFile\)/u)
  assert.match(pipeline, /! -f \.cnb-preview-feed-only/u)
})

test('publisher deterministically selects the one exact draft when cloud and local creation race', () => {
  const identity = {
    tag: 'v1.0.32',
    productRevision: 'a'.repeat(40),
    name: 'Harness Desktop v1.0.32',
    body: '# exact notes\n'
  }
  const stale = {
    id: 1,
    tag_name: identity.tag,
    target_commitish: identity.productRevision,
    name: identity.name,
    body: '# stale notes\n',
    draft: true,
    prerelease: false,
    assets: []
  }
  const exact = {
    id: 2,
    tag_name: identity.tag,
    target_commitish: identity.productRevision,
    name: identity.name,
    body: identity.body.replaceAll('\n', '\r\n'),
    draft: true,
    prerelease: false,
    assets: [{ name: 'SHA256SUMS.txt' }]
  }
  assert.equal(normalizeReleaseBody(exact.body), identity.body)
  assert.equal(selectReleaseForTag([stale, exact], identity), exact)
  assert.equal(selectReleaseForTag([exact, stale], identity), exact)

  const repairIdentity = { ...identity, expectedAssetNames: ['SHA256SUMS.txt'] }
  const detached = { ...exact, tag_name: 'untagged-48bc97277dc744d45c4e' }
  const emptyClaimant = { ...stale, body: identity.body.replace(/\n$/u, ''), assets: [] }
  assert.equal(isExactDetachedDraft(detached, repairIdentity), true)
  assert.equal(canReattachPreferredDraft(detached, emptyClaimant, repairIdentity), true)
  assert.equal(canReattachPreferredDraft(detached, { ...emptyClaimant, assets: [{ name: 'unexpected.bin' }] }, repairIdentity), false)
  assert.equal(canReattachPreferredDraft({ ...detached, assets: [] }, emptyClaimant, repairIdentity), false)

  const published = { ...exact, id: 3, draft: false }
  assert.equal(selectReleaseForTag([stale, published, exact], identity), published)
  assert.throws(() => selectReleaseForTag([exact, { ...exact, id: 4 }], identity), /Multiple exact private drafts/u)
  assert.throws(() => selectReleaseForTag([published, { ...published, id: 5 }], identity), /Multiple published releases/u)
})

test('publisher fails closed unless the desktop manifest is signed and verified before commit or mirroring', () => {
  const publisher = read('scripts/release-publish.mjs')
  const refresher = read('scripts/refresh-release-manifest.mjs')
  assert.match(refresher, /HARNESS_COMPONENT_SIGNING_KEY_FILE/u)
  assert.match(refresher, /HARNESS_COMPONENT_KEY_ID/u)
  assert.match(refresher, /createSignedDesktopReleaseManifest/u)
  assert.match(refresher, /validateAndVerifyDesktopReleaseManifest/u)
  assert.match(refresher, /assetName === 'SHA256SUMS\.txt'/u)
  assert.match(refresher, /-\/git\/raw\/main\/SHA256SUMS\.txt/u)
  assert.match(publisher, /release-update-sources\.json trust root drifted from component-update-sources\.json/u)
  assert.match(publisher, /Object\.entries\(componentKeys\)[\s\S]*Object\.entries\(desktopKeys\)/u)
  const components = read('.github/workflows/publish-production-components.yml')
  assert.match(components, /Sign exact desktop release manifest in protected CI/u)
  assert.match(components, /HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64/u)
  assert.match(components, /fetch-depth: 0/u)
  assert.match(components, /refresh-release-manifest\.mjs[\s\S]*release-manifest\/\$RELEASE_TAG/u)
  assert.match(components, /refs\/tags\/\$RELEASE_TAG/u)
  assert.match(components, /git rev-parse "refs\/tags\/\$RELEASE_TAG\^\{\}"/u)
  assert.match(components, /test "\$\(git rev-parse HEAD\)" = "\$tag_revision"/u)
  assert.match(components, /assert_bounded_manifest_parent[\s\S]*git merge-base --is-ancestor "\$tag_revision" "\$candidate"[\s\S]*Manifest parent contains forbidden post-tag file/u)
  assert.match(components, /git reset --hard HEAD[\s\S]*git clean -fd[\s\S]*git checkout --detach "\$publisher_revision"/u)
  assert.match(components, /test "\$\(git rev-parse HEAD\^\)" = "\$publisher_revision"/u)
  assert.match(components, /git push origin "HEAD:refs\/heads\/\$branch"/u)
  assert.doesNotMatch(components, /git push origin "HEAD:refs\/heads\/main"|release: refresh \$RELEASE_TAG signed manifest/u)
  assert.match(components, /trap 'rm -f "\$key_file" "\$manifest_file"'/u)
  assert.match(publisher, /preflightDesktopManifestTrust/u)
  assert.match(publisher, /await preflightDesktopManifestTrust\(\)/u)
  assert.match(publisher, /adoptCloudSignedManifest/u)
  assert.match(publisher, /parents\.length !== 2[\s\S]*manifestParent[\s\S]*Cloud-signed release manifest parent is not the immutable tag or a published bounded publisher-fix revision/u)
  assert.match(publisher, /changed\.length !== 1 \|\| changed\[0\] !== 'release-manifest\.json'/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*publish-production-components\.yml/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/release-audit\.mjs/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/release-local-formal-windows-validation\.cjs/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/verify-formal-windows-release-identity\.mjs/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/release-publish-selection\.cjs/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/publish-cnb-cloud-mirror\.ps1/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*'\.cnb\.yml'/u)
  assert.match(publisher, /postTagChanges\.some\(file => !POST_TAG_PUBLISHER_FIX_FILES\.has\(file\)\)/u)
  const recovery = read('.github/workflows/recover-release-from-actions.yml')
  assert.match(recovery, /scripts\/release-local-formal-windows-validation\.cjs/u)
  assert.match(recovery, /scripts\/verify-formal-windows-release-identity\.mjs/u)
  assert.match(publisher, /gitRun\(\['cherry-pick', candidate\]\)/u)
  assert.match(publisher, /readVerifiedDesktopRelease/u)
  assert.match(publisher, /await readVerifiedDesktopRelease\(\)[\s\S]*gitRun\(\['push', 'origin', 'HEAD:main'\]\)/u)
  assert.match(publisher, /phase\(state, 'release-manifest'[\s\S]*await adoptCloudSignedManifest\(\)[\s\S]*phase\(state, 'cnb-assets'/u)
  const pkg = JSON.parse(read('package.json'))
  const env = { ...process.env }
  delete env.HARNESS_COMPONENT_SIGNING_KEY_FILE
  delete env.HARNESS_COMPONENT_KEY_ID
  const result = spawnSync(process.execPath, ['scripts/refresh-release-manifest.mjs', `--version=${pkg.version}`], { cwd: root, encoding: 'utf8', env })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /HARNESS_COMPONENT_SIGNING_KEY_FILE and HARNESS_COMPONENT_KEY_ID are required/u)
})

test('official publisher delegates every release package to commit-bound GitHub Actions', () => {
  const publisher = read('scripts/release-publish.mjs')
  const workflow = YAML.parse(read('.github/workflows/release.yml'))
  assert.equal(workflow.name, 'Cloud Build & Release Desktop')
  assert.equal(workflow.env.HARNESS_RELEASE_PACKAGING_MODE, 'github-actions-only')
  assert.equal(workflow.on.workflow_dispatch.inputs.source_revision.required, true)
  assert.equal(workflow.on.workflow_dispatch.inputs.request_id.required, true)
  assert.equal(workflow['run-name'], 'Candidate ${{ inputs.tag }} @ ${{ inputs.source_revision }} · ${{ inputs.request_id }}')
  assert.equal(workflow.on.push, undefined)
  assert.doesNotMatch(read('.github/workflows/release.yml'), /release-retry\/v|inputs\.request_id \|\|/u)
  assert.deepEqual(workflow.jobs.build.strategy.matrix.os, ['windows-latest', 'macos-latest', 'ubuntu-latest'])
  assert.match(publisher, /checkpoint\(state, 'desktop-cloud-builds', \{ requestId[\s\S]*dispatchAttemptedAt: null[\s\S]*waitForDesktopBuildDiscovery\(state, requestId\)/u)
  assert.match(publisher, /if \(phaseState\.dispatchAttemptedAt\)[\s\S]*5 \* 60_000[\s\S]*redispatchCount/u)
  assert.match(publisher, /request id is fresh and unique[\s\S]*checkpoint[\s\S]*dispatchWorkflow\('release\.yml'/u)
  assert.match(publisher, /dispatchWorkflow\('release\.yml',[\s\S]*\['source_revision', stateProductRevision\][\s\S]*'main', requestId\)/u)
  assert.doesNotMatch(publisher, /DESKTOP_DISCOVERY_TIMEOUT_MS|inputs:/u)
  assert.doesNotMatch(publisher, /npmRun\(\['run', 'dist'/u)
  const buildSteps = workflow.jobs.build.steps
  const componentGate = buildSteps.find(step => step.name === 'Verify packaged Windows component health and rollback')
  const artifactUpload = buildSteps.find(step => String(step.uses || '').startsWith('actions/upload-artifact@'))
  assert.equal(componentGate.if, "runner.os == 'Windows'")
  assert.match(componentGate.run, /npm run test:component-local[\s\S]*--app-exe[\s\S]*--profile/u)
  const componentTest = read('scripts/local-component-update-test.mjs')
  assert.match(componentTest, /const exitCode = await exitPromise[\s\S]*Packaged baseline exited with code/u, 'the baseline process must release its single-instance lock before component activation')
  assert.doesNotMatch(componentTest, /Promise\.race\(\[exitPromise, delay\(2_000\)\]\)/u)
  assert.ok(buildSteps.indexOf(componentGate) < buildSteps.indexOf(artifactUpload))
  for (const jobName of ['build', 'ios-simulators', 'prepare-windows-candidate']) {
    const steps = workflow.jobs[jobName].steps
    const bind = steps.find(step => step.name === 'Bind cloud package build to exact pre-Tag candidate revision')
    assert.ok(bind, `${jobName} must bind checkout to the exact candidate revision`)
    assert.match(bind.run, /HARNESS_RELEASE_PACKAGING_MODE[\s\S]*github-actions-only/u)
    assert.match(bind.run, /git rev-parse HEAD/u)
    assert.match(bind.run, /PUBLISHER_SOURCE_REVISION/u)
    assert.match(bind.run, /test "\$GITHUB_SHA" = "\$expected_revision"/u)
    assert.match(bind.run, /git ls-remote --exit-code --tags origin "refs\/tags\/\$RELEASE_TAG"/u)
    assert.match(bind.run, /remote_tag_status[\s\S]*-ne 2[\s\S]*-n "\$remote_tag_output"/u)
    assert.match(bind.run, /\^\[0-9a-f\]\{40\}\$/u)
  }
})

test('desktop publication cannot stage a macOS artifact before the unsigned build gate succeeds', () => {
  const source = read('.github/workflows/release.yml')
  const workflow = YAML.parse(source)
  assert.equal(workflow.jobs.build.environment.name, 'desktop-build')
  assert.deepEqual(workflow.jobs['prepare-windows-candidate'].needs, ['build', 'ios-simulators'])
  const steps = workflow.jobs.build.steps
  const unsignedBuild = steps.find(step => step.name === 'Build unsigned macOS packages')
  const unsignedGate = steps.find(step => step.name === 'Verify unsigned macOS packages')
  const upload = steps.find(step => String(step.uses || '').startsWith('actions/upload-artifact@'))
  assert.equal(unsignedBuild.if, "runner.os == 'macOS'")
  assert.equal(unsignedGate.if, "runner.os == 'macOS'")
  assert.ok(steps.indexOf(unsignedBuild) < steps.indexOf(unsignedGate))
  assert.ok(steps.indexOf(unsignedGate) < steps.indexOf(upload))
  assert.match(unsignedBuild.run, /npm run dist/u)
  assert.match(unsignedGate.run, /hdiutil attach/u)
  assert.doesNotMatch(source.slice(0, source.indexOf('steps:')), /MACOS_DEVELOPER_ID|APPLE_NOTARY/u)
  for (const forbidden of ['macos-signing', 'xcrun notarytool submit', 'spctl --assess', 'codesign --verify']) assert.ok(!source.includes(forbidden), forbidden)
})

test('Linux Electron gates install and configure the SUID sandbox before exercising Electron', () => {
  const workflows = [
    { file: '.github/workflows/ci.yml', job: 'verify', performance: 'Run synthetic Electron performance budget', exercise: 'Verify browser navigation security in Electron' },
    { file: '.github/workflows/release.yml', job: 'build', performance: 'Run synthetic Electron performance budget (Linux)', exercise: 'Verify browser navigation security in Electron (Linux)' }
  ]

  for (const contract of workflows) {
    const source = read(contract.file)
    const workflow = YAML.parse(source)
    const steps = workflow.jobs[contract.job].steps
    const installDependencies = steps.find(step => /^npm ci(?:\s|$)/u.test(String(step.run || '')))
    const configure = steps.find(step => String(step.name || '').startsWith('Configure Electron sandbox'))
    const performance = steps.find(step => step.name === contract.performance)
    const exercise = steps.find(step => step.name === contract.exercise)
    assert.ok(installDependencies, `${contract.file} must install dependencies`)
    assert.ok(configure, `${contract.file} must configure the Electron sandbox`)
    assert.ok(performance, `${contract.file} must run the synthetic Electron performance budget`)
    assert.ok(exercise, `${contract.file} must exercise Electron`)
    assert.ok(steps.indexOf(installDependencies) < steps.indexOf(configure))
    assert.ok(steps.indexOf(configure) < steps.indexOf(performance))
    assert.ok(steps.indexOf(performance) < steps.indexOf(exercise))
    assert.equal(performance.env.HARNESS_PERFORMANCE_ELECTRON_REQUIRED, '1')
    assert.match(performance.run, /xvfb-run -a npm run test:performance:synthetic/u)
    assert.match(configure.run, /set -euo pipefail/u)
    assert.match(configure.run, /node node_modules\/electron\/install\.js/u)
    assert.match(configure.run, /sandbox="\$GITHUB_WORKSPACE\/node_modules\/electron\/dist\/chrome-sandbox"/u)
    assert.match(configure.run, /test -f "\$sandbox"/u)
    assert.match(configure.run, /test ! -L "\$sandbox"/u)
    assert.match(configure.run, /sudo chown root:root "\$sandbox"/u)
    assert.match(configure.run, /sudo chmod 4755 "\$sandbox"/u)
    assert.match(configure.run, /stat -c '%u:%g:%a' "\$sandbox"/u)
    const sandboxOrder = [
      'node node_modules/electron/install.js',
      'test -f "$sandbox"',
      'test ! -L "$sandbox"',
      'sudo chown root:root',
      'sudo chmod 4755',
      "stat -c '%u:%g:%a'"
    ].map(fragment => configure.run.indexOf(fragment))
    assert.ok(sandboxOrder.every((index, position) => index >= 0 && (position === 0 || sandboxOrder[position - 1] < index)))
    assert.doesNotMatch(source, /--no-sandbox|--disable-setuid-sandbox|ELECTRON_DISABLE_SANDBOX/u)
  }

  const release = YAML.parse(read('.github/workflows/release.yml'))
  const releaseSteps = release.jobs.build.steps
  const linuxConfigure = releaseSteps.find(step => step.name === 'Configure Electron sandbox for Linux')
  const linuxPerformance = releaseSteps.find(step => step.name === 'Run synthetic Electron performance budget (Linux)')
  const desktopPerformance = releaseSteps.find(step => step.name === 'Run synthetic Electron performance budget (Windows and macOS)')
  const linuxExercise = releaseSteps.find(step => step.name === 'Verify browser navigation security in Electron (Linux)')
  const desktopExercise = releaseSteps.find(step => step.name === 'Verify browser navigation security in Electron (Windows and macOS)')
  assert.equal(linuxConfigure.if, "runner.os == 'Linux'")
  assert.equal(linuxPerformance.if, "runner.os == 'Linux'")
  assert.equal(linuxExercise.if, "runner.os == 'Linux'")
  assert.equal(linuxExercise.env.HARNESS_BROWSER_TEST_REAL_INPUT, '1')
  assert.equal(desktopPerformance.if, "runner.os != 'Linux'")
  assert.equal(desktopPerformance.env.HARNESS_PERFORMANCE_ELECTRON_REQUIRED, '1')
  assert.match(desktopPerformance.run, /node node_modules\/electron\/install\.js[\s\S]*npm run test:performance:synthetic/u)
  assert.equal(desktopExercise.if, "runner.os != 'Linux'")
  assert.ok(releaseSteps.indexOf(linuxConfigure) < releaseSteps.indexOf(linuxPerformance))
  assert.ok(releaseSteps.indexOf(linuxPerformance) < releaseSteps.indexOf(linuxExercise))
  assert.ok(releaseSteps.indexOf(desktopPerformance) < releaseSteps.indexOf(desktopExercise))
  const browserFixture = read('tests/fixtures/browser-navigation-guard-electron.cjs')
  assert.match(browserFixture, /requestAnimationFrame\(\(\) => requestAnimationFrame/u, 'real input must wait for a composited renderer frame')
  assert.match(browserFixture, /type: 'mouseMove'[\s\S]*await wait\(20\)[\s\S]*type: 'mouseDown'/u, 'real input must establish hit testing before the click')
  assert.match(browserFixture, /waitForDomClick\(view\.webContents, 'no-navigation'\)/u, 'DOM provenance must use a bounded asynchronous observation')
  assert.match(browserFixture, /waitForDeniedCode\(denied, 'browser-action-cancelled'\)/u, 'stopped renderer timers must await the exact guard receipt within a bound')
  assert.doesNotMatch(browserFixture, /await wait\(1_200\)/u, 'cloud navigation safety must not depend on one fixed macOS timer delay')
})

test('pre-Tag candidate disables the opaque previous-stable upgrade loop and retains fast current-package gates', () => {
  const workflow = YAML.parse(read('.github/workflows/release.yml'))
  const publisher = read('scripts/release-publish.mjs')
  assert.equal(workflow.jobs['prepare-windows-candidate'].if, '${{ false }}')
  assert.equal(workflow.jobs['verify-windows-candidate'].if, '${{ false }}')

  const buildSteps = workflow.jobs.build.steps
  for (const name of [
    'Run packaged Windows self-test',
    'Verify packaged Windows component health and rollback',
    'Run Windows installer smoke test'
  ]) assert.ok(buildSteps.some(step => step.name === name), `missing current-package gate: ${name}`)
  const installerGate = buildSteps.find(step => step.name === 'Run Windows installer smoke test')
  assert.match(installerGate.run, /function Invoke-BoundedProcess[\s\S]*WaitForExit\(\$TimeoutSeconds \* 1000\)[\s\S]*taskkill\.exe \/PID \$process\.Id \/T \/F/u)
  for (const label of ['Current-version portable self-test', 'Current-version Windows installer', 'Current-version installed self-test', 'Current-version Windows uninstaller']) {
    assert.match(installerGate.run, new RegExp(`-Label '${label}'`, 'u'))
  }
  assert.match(installerGate.run, /\$portableResult\.product\.version -ne \$version/u)
  assert.match(installerGate.run, /\$report\.product\.version -ne \$version/u)
  assert.match(installerGate.run, /Current-version installed uninstaller is missing/u)
  assert.match(installerGate.run, /Windows uninstaller did not remove the temporary installation/u)
  assert.doesNotMatch(installerGate.run, /Start-Process[^\n]*-Wait/u)

  const buildJobs = publisher.slice(publisher.indexOf('const BUILD_JOBS = ['), publisher.indexOf('const WORKFLOWS'))
  for (const name of ['Build windows-latest', 'Build macos-latest', 'Build ubuntu-latest', 'Validate iPhone and iPad simulators']) {
    assert.match(buildJobs, new RegExp(name, 'u'))
  }
  assert.doesNotMatch(buildJobs, /Verify Windows candidate upgrade and installation/u)
})

test('desktop workflow is dispatch-only build/test mode and cannot publish on Tag push', () => {
  const workflowText = read('.github/workflows/release.yml')
  const workflow = YAML.parse(workflowText)
  assert.ok(workflow.on.workflow_dispatch)
  assert.equal(workflow.on.push, undefined)
  assert.ok(workflow.on.workflow_dispatch.inputs.source_revision)
  assert.equal(workflow.jobs['prepare-windows-candidate'].if, '${{ false }}')
  assert.equal(workflow.jobs['verify-windows-candidate'].if, '${{ false }}')
  assert.equal(workflow.jobs['stage-draft'], undefined)
  assert.equal(workflow.jobs['verify-windows-draft'], undefined)
  assert.equal(workflow.jobs.publish, undefined)
  assert.doesNotMatch(workflowText, /contents: write|uploads\.github\.com|--method (?:POST|PATCH).*releases|gh release upload/u)
  assert.match(workflowText, /ref: \$\{\{ env\.SOURCE_REVISION \}\}/u)
  assert.match(workflowText, /test "\$GITHUB_SHA" = "\$expected_revision"/u)
  assert.equal(workflow.on.workflow_dispatch.inputs.request_id.required, true)
  assert.doesNotMatch(workflowText, /inputs\.request_id \|\| github\.run_id/u)
  assert.match(workflowText, /git ls-remote --exit-code --tags origin "refs\/tags\/\$RELEASE_TAG"/u)
  assert.match(workflowText, /name: desktop-\$\{\{ matrix\.os \}\}/u)
})

test('cloud recovery byte-verifies the exact draft and disables both previous-stable upgrade loops', () => {
  const workflowText = read('.github/workflows/recover-release-from-actions.yml')
  const workflow = YAML.parse(workflowText)
  const recovery = workflow.jobs.recover
  const windows = workflow.jobs['verify-windows-draft']
  const publish = workflow.jobs.publish
  assert.ok(recovery)
  assert.equal(workflow.concurrency.group, 'release-${{ inputs.tag }}')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(windows.if, '${{ false }}')
  assert.equal(publish.needs, 'recover')

  const sourceVerifier = recovery.steps.find(step => step.name === 'Verify immutable source run, successful jobs, and exact draft subset')
  const stableBinding = recovery.steps.find(step => step.name === 'Bind the signed previous stable Windows installer to an exact public asset')
  const prefetch = recovery.steps.find(step => step.name === 'Prefetch and verify every exact draft byte on Ubuntu')
  const upload = recovery.steps.find(step => step.with?.name === 'recovered-draft-snapshot')
  const publishDownload = publish.steps.find(step => step.with?.name === 'recovered-draft-snapshot')
  assert.equal(stableBinding.if, '${{ false }}')
  assert.ok(prefetch)
  assert.ok(upload)
  assert.ok(publishDownload)
  assert.equal(upload.with.path, '${{ runner.temp }}/recovered-draft-state')
  assert.equal(upload.with['retention-days'], 1)
  assert.equal(upload.with['compression-level'], undefined)
  assert.ok(recovery.steps.indexOf(prefetch) < recovery.steps.indexOf(upload))

  for (const name of ['Build windows-latest', 'Build macos-latest', 'Build ubuntu-latest', 'Validate iPhone and iPad simulators']) {
    assert.match(sourceVerifier.run, new RegExp(name, 'u'))
  }
  assert.doesNotMatch(sourceVerifier.run, /Verify Windows candidate upgrade and installation/u)
  assert.match(sourceVerifier.run, /\.head_sha == \$sha/u)
  assert.match(sourceVerifier.run, /\.head_branch == "main"/u)
  assert.match(sourceVerifier.run, /\.event == "workflow_dispatch"[\s\S]*\.conclusion == "success"/u)
  assert.match(sourceVerifier.run, /display_title == "Candidate \\\(\$tag\) @ \\\(\$sha\) · \\\(\$request\)"/u)
  assert.match(sourceVerifier.run, /select\(\.name \| startswith\("desktop-"\)\)[\s\S]*Exact same-run desktop artifact set is unavailable/u)

  assert.match(prefetch.run, /releases\/assets\/\$id/u)
  assert.match(prefetch.run, /--connect-timeout 15 --max-time 900/u)
  assert.match(prefetch.run, /jq -c '\.assets\[\]'/u)
  assert.match(prefetch.run, /pids=\(\)[\s\S]*\$\{#pids\[@\]\} >= 3/u)
  assert.match(prefetch.run, /Snapshot size mismatch/u)
  assert.match(prefetch.run, /Snapshot digest mismatch/u)
  assert.match(prefetch.run, /sha256sum --strict -c SHA256SUMS\.txt/u)
  assert.match(prefetch.run, /SHA256SUMS\.txt must contain exactly eight desktop asset entries/u)
  assert.doesNotMatch(prefetch.run, /previous-stable|previous_installer|required_windows|windows_root/u)

  const recoveryRuns = recovery.steps.map(step => step.run || '').join('\n')
  const publishRuns = publish.steps.map(step => step.run || '').join('\n')
  assert.doesNotMatch(recoveryRuns, /--method PATCH/u)
  assert.match(publishRuns, /--method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"/u)
  assert.match(workflowText, /run-id: \$\{\{ inputs\.source_run_id \}\}/u)
  assert.match(workflowText, /Unexpected private draft assets/u)
  assert.match(workflowText, /Preserving verified existing asset/u)
  assert.match(workflowText, /A concurrent verified uploader won/u)
  assert.match(workflowText, /Reconfirm exact draft snapshot and publish by immutable release id/u)
  assert.match(workflowText, /diff -u <\(jq -S \. draft-snapshot\.json\) <\(jq -S \. current-draft\.json\)/u)
  assert.doesNotMatch(workflowText, /^\s*gh release upload|--clobber/mu)
})

test('post-Tag recovery rotates only exact terminal failed requests and preserves their audit trail', () => {
  const publisher = read('scripts/release-publish.mjs')
  const recovery = publisher.slice(publisher.indexOf("phase(state, 'desktop-publication'"), publisher.indexOf("phase(state, 'signed-android'"))
  assert.match(recovery, /checkpointedRecoveryHeadSha !== expectedRecoveryHeadSha[\s\S]*checkpointedRecoveryHeadBranch !== expectedRecoveryHeadBranch/u)
  assert.match(recovery, /selectUniqueWorkflowRunByDisplayTitle\(workflowRuns\('recover-release-from-actions\.yml'\), previousDisplayTitle, 'Previous recovery'\)/u)
  assert.match(recovery, /recoveryCheckpointWorkflowIdentity\(\{ recoveryHeadSha: previousRecovery\.headSha, recoveryHeadBranch: previousRecovery\.headBranch \}\)/u)
  assert.match(recovery, /previousRecovery\.status !== 'completed' \|\| previousRecovery\.conclusion === 'success'[\s\S]*refusing ambiguous redispatch/u)
  assert.match(recovery, /recoveryAttempts[\s\S]*requestId: recoveryRequestId[\s\S]*runId: Number\(previousRecovery\.databaseId\)[\s\S]*invalidatedAt/u)
  assert.match(recovery, /for \(;;\)[\s\S]*workflowRunByExactIdentity\('recover-release-from-actions\.yml', expectedRecoveryIdentity, 'Recovery'\)[\s\S]*discoveredRecovery\?\.status !== 'completed' \|\| discoveredRecovery\.conclusion === 'success'[\s\S]*state\.phases\['desktop-publication'\]\?\.recoveryAttempts[\s\S]*runId: Number\(discoveredRecovery\.databaseId\)[\s\S]*retriedAt/u)
  assert.match(recovery, /recoveryRequestId: null[\s\S]*recoveryRunId: null[\s\S]*recoveryDispatchAttemptedAt: null[\s\S]*recoveryHeadSha: null[\s\S]*recoveryRequestId = ''[\s\S]*storedRecoveryRunId = 0[\s\S]*recoveryDispatchAttemptedAt = null/u)
  const terminalGuard = recovery.indexOf("previousRecovery.status !== 'completed'")
  const rotatedRequest = recovery.indexOf('recoveryRequestId = `${tag}-recovery-${randomUUID()}`')
  assert.ok(terminalGuard >= 0 && rotatedRequest > terminalGuard, 'new recovery request id must be created only after the prior exact run is terminal and unsuccessful')
})

test('manual workflow recovery is uniquely identified and candidate build binds exact SHA before Tag', () => {
  const source = read('scripts/release-publish.mjs')
  const release = read('.github/workflows/release.yml')
  const android = read('.github/workflows/android-mobile-release.yml')
  const recovery = read('.github/workflows/recover-release-from-actions.yml')
  assert.match(source, /requestId[\s\S]*request_id/u)
  assert.match(source, /selectUniqueWorkflowRunByDisplayTitle\(workflowRuns\(file\), expected\.displayTitle/u)
  assert.match(source, /async function dispatchWorkflow\(file, fields = \[\], ref = tag, persistedRequestId = ''\)/u)
  assert.match(source, /dispatchWorkflow\('release\.yml',[\s\S]*\['source_revision', stateProductRevision\][\s\S]*'main', requestId\)/u)
  assert.doesNotMatch(source, /api\?\.inputs|run\.inputs|expected\.inputs/u)
  assert.match(release, /source_revision:[\s\S]*Exact 40-character candidate commit/u)
  assert.doesNotMatch(release, /push:\s*[\r\n]+\s+tags:/u)
  assert.match(source, /gitRun\(\['push', 'origin', 'HEAD:main'\]\)[\s\S]*publisher_revision/u)
  assert.match(recovery, /publisher_revision:/u)
  assert.match(recovery, /WORKFLOW_REVISION[\s\S]*Post-tag recovery workflow revision mismatch/u)
  assert.match(recovery, /git merge-base --is-ancestor "\$tag_commit" "\$PUBLISHER_REVISION"/u)
  assert.match(recovery, /git diff --name-only "\$tag_commit\.\.\$PUBLISHER_REVISION"/u)
  for (const file of ['.cnb.yml', '.github/workflows/recover-release-from-actions.yml', 'scripts/publish-cnb-cloud-mirror.ps1', 'scripts/release-publish.mjs', 'scripts/release-publish-selection.cjs', 'tests/release-publisher.test.cjs']) {
    assert.ok(recovery.includes(file), `recovery workflow must allow only reviewed publisher fix file ${file}`)
  }
  assert.match(recovery, /Post-tag recovery revision contains forbidden file/u)
  for (const workflow of [release, android, recovery]) {
    assert.match(workflow, /request_id:/u)
    assert.match(workflow, /run-name:/u)
  }
  assert.match(android, /ref: \$\{\{ inputs\.tag \}\}/u)
  assert.match(android, /run-name: Android \$\{\{ inputs\.tag \}\} · \$\{\{ inputs\.request_id \}\}/u)
  assert.doesNotMatch(android, /\n\s+push:|github\.ref_name|github\.run_id|inputs\.tag \|\|/u)
  assert.match(android, /git rev-parse HEAD[\s\S]*git rev-list -n 1/u)
})

test('component and CNB publication retries preserve only byte-identical output', () => {
  const components = read('.github/workflows/publish-production-components.yml')
  const prepare = read('scripts/prepare-production-components.mjs')
  const cnb = read('scripts/publish-cnb-cloud-mirror.ps1')
  const publisher = read('scripts/release-publish.mjs')
  assert.match(components, /git show -s --format=%cI "\$RELEASE_TAG\^\{\}"/u)
  assert.match(components, /product_revision:[\s\S]*required: true/u)
  assert.match(components, /ref: \$\{\{ env\.RELEASE_TAG \}\}[\s\S]*PUBLISHER_PRODUCT_REVISION[\s\S]*git rev-list -n 1 "\$RELEASE_TAG"/u)
  assert.doesNotMatch(components, /component-publish\/v1\.0\.41/u)
  assert.match(publisher, /const componentSource = publishPostTagRecoveryFix\(\)[\s\S]*publish-production-components\.yml'[\s\S]*\['product_revision', stateProductRevision\][\s\S]*componentSource\.ref/u)
  assert.match(publisher, /workflowHeadSha: componentSource\.headSha[\s\S]*componentCheckpointWorkflowIdentity\(completed\)/u)
  assert.match(components, /--published-at "\$published_at"/u)
  assert.match(components, /test "\$\{#files\[@\]\}" -eq 7/u)
  for (const fallback of ['Harness-Desktop-$version-win-x64.exe', 'Harness-Desktop-$version-mac-x64.dmg', 'Harness-Desktop-$version-mac-arm64.dmg']) assert.ok(components.includes(fallback))
  assert.match(components, /Preserving verified existing component/u)
  assert.match(components, /Upload only missing immutable signed component assets/u)
  assert.match(prepare, /publishedAtInput/u)
  assert.match(cnb, /HARNESS_RELEASE_GIT/u)
  assert.match(cnb, /function Get-Sha256Hex[\s\S]*System\.Security\.Cryptography\.SHA256/u)
  assert.doesNotMatch(cnb, /Get-FileHash/u)
  assert.match(cnb, /if \(\$StableOnly\)[\s\S]*rev-parse "\$Remote\/main`:SHA256SUMS\.txt"[\s\S]*Stable-only CNB synchronization requires the verified SHA256SUMS\.txt/u)
  assert.match(cnb, /if \(\$StableOnly\)[\s\S]*update-index --add --cacheinfo "100644,\$stableChecksumBlob,SHA256SUMS\.txt"/u)
  assert.match(publisher, /finalRemoteCheck[\s\S]*git\/raw\/main\/SHA256SUMS\.txt[\s\S]*Legacy desktop checksum mirror digest mismatch/u)
  assert.match(publisher, /HARNESS_RELEASE_GIT: git/u)
  assert.match(publisher, /third_party['"], 'mingit['"], 'cmd['"], 'git\.exe'/u)
  assert.match(publisher, /gitEnvironment\(\)[\s\S]*mingw64['"], 'bin/u)
  assert.match(publisher, /gitCapture\(args\)[\s\S]*gitEnvironment\(\)/u)
  assert.match(publisher, /key\.toLowerCase\(\) === 'path'/u)
  assert.match(publisher, /WindowsPowerShell['"], 'v1\.0'/u)
})

test('Android-only publication stays inside the unified publisher and excludes desktop/component side effects', () => {
  const wrapper = read('scripts/release-publish.mjs')
  const publisher = read('scripts/release-publish-android.mjs')
  assert.match(wrapper, /scope === 'android'[\s\S]*import\('\.\/release-publish-android\.mjs'\)/u)
  assert.match(publisher, /npm run release:publish -- run --version \$\{integrationVersion\} --scope android/u)
  for (const phase of ['local-mobile-gates', 'immutable-mobile-tag', 'github-signed-android', 'cnb-mobile-assets', 'complete']) {
    assert.match(publisher, new RegExp(`['"]${phase}['"]`, 'u'))
  }
  assert.match(publisher, /workflow', 'run', 'android-mobile-release\.yml'/u)
  assert.match(publisher, /const workflowRef = mobile\.tag/u)
  assert.match(publisher, /'--ref', workflowRef/u)
  assert.match(publisher, /npmRun\(\['run', 'verify'\]/u)
  assert.match(publisher, /waitForAndroidCiEvidence/u)
  assert.match(publisher, /Android mobile compile\/test/u)
  assert.match(publisher, /'--workflow', 'ci\.yml'/u)
  assert.match(publisher, /ensureAppleMobileEvidence/u)
  assert.match(publisher, /'mobile_only=true'/u)
  assert.match(publisher, /iPhone and iPad simulators/u)
  assert.match(publisher, /macOS Desktop package contracts/u)
  assert.match(publisher, /verifyProtectedState/u)
  assert.match(publisher, /assertProtectedMetadataMatchesLocal/u)
  assert.match(publisher, /gitCaptureRaw\(\['cat-file', 'blob', `HEAD:\$\{file\}`\]\)/u)
  assert.doesNotMatch(publisher, /const expected = sha256\(readFileSync\(path\.join\(root, file\)\)\)/u)
  assert.match(publisher, /Protected GitHub\/CNB metadata differs from the committed source/u)
  assert.match(publisher, /assertProtectedReleaseMatchesManifest/u)
  assert.match(publisher, /Protected \$\{protectedTag\} GitHub asset evidence changed/u)
  assert.match(publisher, /GitHub release metadata differs from the reviewed manifest/u)
  assert.match(publisher, /release target differs from its immutable tag/u)
  assert.match(publisher, /tagRevision: remoteTagRevision/u)
  assert.match(publisher, /latestTag: readLatestGithubReleaseTag/u)
  assert.match(publisher, /Protected desktop latest release must remain/u)
  assert.match(publisher, /verifyProtectedCnbAssetBytes/u)
  assert.match(publisher, /Protected CNB asset bytes changed/u)
  assert.match(publisher, /verifyCnbBytes: true/u)
  assert.match(publisher, /maybeRebindPreTagCandidate/u)
  assert.match(publisher, /safe-pre-tag-main-fast-forward/u)
  assert.match(publisher, /candidateAttempts/u)
  assert.match(publisher, /Cannot prove CNB Android side-effect absence/u)
  assert.match(publisher, /POST_TAG_CONTROLLER_PATHS/u)
  assert.match(publisher, /assertPostTagControllerAdvance/u)
  assert.match(publisher, /const controllerCi = await waitForAndroidCiEvidence\(repo, currentHead, pollSeconds\)/u)
  assert.match(publisher, /controllerCiRunId/u)
  assert.match(publisher, /Post-Tag Android recovery may change only controller files/u)
  assert.match(publisher, /assertRecoverableAndroidPreflightFailure/u)
  assert.match(publisher, /Verify release tag and signing inputs/u)
  assert.match(publisher, /releaseRecoveryAuthorization/u)
  assert.match(publisher, /createEmptyStandaloneRelease/u)
  assert.match(publisher, /assertStandaloneCnbAssetsAbsent/u)
  assert.match(publisher, /failedRequests\.length >= 5/u)
  const ci = YAML.parse(read('.github/workflows/ci.yml'))
  assert.equal(ci.jobs['android-mobile'].name, 'Android mobile compile/test')
  const androidCiKey = ci.jobs['android-mobile'].steps.find(step => step.name === 'Create ephemeral CI-only Android signing key')
  const androidCiBuild = ci.jobs['android-mobile'].steps.at(-1)
  assert.match(androidCiKey.run, /keytool -genkeypair -noprompt/u)
  assert.match(androidCiKey.run, /harness-mobile-ci-only\.jks/u)
  assert.match(androidCiKey.run, /HARNESS_ANDROID_KEYSTORE_PATH/u)
  assert.match(androidCiBuild.run, /gradlew --no-daemon clean test lintDebug assembleDebug assembleRelease/u)
  assert.doesNotMatch(JSON.stringify(ci.jobs['android-mobile']), /upload-artifact|gh release upload/u)
  const apple = YAML.parse(read('.github/workflows/apple-virtual-tests.yml'))
  assert.ok(apple.on.workflow_dispatch.inputs.source_revision)
  assert.equal(apple.on.workflow_dispatch.inputs.mobile_only.type, 'boolean')
  assert.equal(apple.jobs['macos-desktop'].if, '${{ inputs.mobile_only != true }}')
  assert.equal(apple.jobs['ios-simulators'].steps[0].with.ref, '${{ inputs.source_revision || github.sha }}')
  assert.match(publisher, /assets\.length !== 2/u)
  assert.match(publisher, /release:cnb-mobile-cloud/u)
  assert.doesNotMatch(publisher, /workflow', 'run', 'release\.yml'/u)
  assert.doesNotMatch(publisher, /publish-production-components\.yml/u)
  assert.doesNotMatch(publisher, /release:orchestrate/u)
})

test('signed Android workflow supports a standalone immutable release without weakening the desktop path', () => {
  const workflowText = read('.github/workflows/android-mobile-release.yml')
  const workflow = YAML.parse(workflowText)
  const job = workflow.jobs['signed-apk']
  assert.match(job.env.MOBILE_ONLY, /startsWith\(.+android-v/u)
  const verify = job.steps.find(step => step.name === 'Verify release tag and signing inputs')
  const build = job.steps.find(step => step.name === 'Build signed Android APK')
  const packageVerify = job.steps.find(step => step.name === 'Verify package, version and signing identity')
  const create = job.steps.find(step => step.name === 'Create immutable standalone Android release when requested')
  const upload = job.steps.find(step => step.name === 'Add immutable signed APK to the existing release')
  const readback = job.steps.find(step => step.name === 'Verify public signed APK bytes and identity')
  assert.ok(verify)
  assert.ok(create)
  assert.equal(create.if, "env.MOBILE_ONLY == 'true'")
  assert.match(verify.run, /m\.integrationVersion!==p\.version/u)
  assert.match(verify.run, /tag!==m\.tag/u)
  assert.match(verify.run, /if test "\$MOBILE_ONLY" = true; then/u)
  assert.match(verify.run, /version="\$\(node -p "require\('\.\/package\.json'\)\.version"\)"/u)
  assert.match(verify.run, /encodeAndroidVersionCode\(require\('\.\/package\.json'\)\.version\)/u)
  assert.doesNotMatch(verify.run, /major\*10000\+minor\*100\+patch/u)
  assert.match(verify.run, /MOBILE_VERSION_NAME=\$version/u)
  assert.match(verify.run, /MOBILE_VERSION_CODE=\$version_code/u)
  assert.match(verify.run, /existing=''/u)
  assert.match(verify.run, /release_error="\$\(mktemp\)"/u)
  assert.match(verify.run, /response="\$\(gh api .+ 2>"\$release_error"\)"/u)
  assert.match(verify.run, /release_status=\$\?/u)
  assert.match(verify.run, /grep -F 'HTTP 404'/u)
  assert.doesNotMatch(verify.run, /existing="\$\(gh api .+ \|\| true\)"/u)
  assert.match(verify.run, /Waiting for verified desktop release/u)
  assert.match(build.run, /-PHARNESS_MOBILE_VERSION_NAME=\$MOBILE_VERSION_NAME/u)
  assert.match(build.run, /-PHARNESS_MOBILE_VERSION_CODE=\$MOBILE_VERSION_CODE/u)
  assert.match(packageVerify.run, /version="\$MOBILE_VERSION_NAME"/u)
  assert.match(packageVerify.run, /expected_version_code="\$MOBILE_VERSION_CODE"/u)
  assert.doesNotMatch(packageVerify.run, /readAndroidMobileVersion/u)
  assert.match(create.run, /make_latest:"false"/u)
  assert.match(create.run, /target_commitish:\$commit/u)
  assert.match(upload.run, /Unexpected standalone Android release assets/u)
  assert.match(readback.run, /grep -c \. <<< "\$assets"/u)
  assert.match(readback.run, /repos\/\$GITHUB_REPOSITORY\/releases\/latest/u)
  assert.match(readback.run, /\.tag_name/u)
  assert.match(workflowText, /mobile-release-version\.cjs/u)
  assert.doesNotMatch(workflowText, /app-debug\.apk|assembleDebug|--clobber/u)
})

test('CNB standalone Android mirror is cloud-to-cloud, exact, and preserves stable metadata', () => {
  const pipelineText = read('.cnb.yml')
  const pipeline = YAML.parse(pipelineText)
  const stages = pipeline.main.push[0].stages
  const desktop = stages.find(stage => stage.name === 'Prepare verified GitHub release assets')
  const prepare = stages.find(stage => stage.name === 'Prepare standalone Android cloud mirror')
  const upload = stages.find(stage => stage.name === 'Upload standalone Android assets with official plugin')
  const readback = stages.find(stage => stage.name === 'Read back standalone Android assets')
  assert.match(desktop.if, /test ! -f \.cnb-mobile-only/u)
  assert.equal(prepare.if, 'test -f .cnb-mobile-only')
  assert.equal(upload.image, 'cnbcool/attachments:latest')
  assert.equal(upload.settings.type, 'UPLOAD')
  assert.equal(upload.settings.ttl, 0)
  assert.match(prepare.script, /github\.com\/baiyuscc13724-max\/deepseek-harness-desktop\/releases\/download/u)
  assert.match(prepare.script, /Unexpected standalone Android CNB asset/u)
  assert.match(readback.script, /diff -u \.cnb-mobile-expected\.txt \.cnb-mobile-actual\.txt/u)
  assert.match(readback.script, /sha256sum/u)

  const mirror = read('scripts/publish-cnb-mobile-cloud-mirror.ps1')
  assert.match(mirror, /read-tree \$baseCommit/u)
  assert.match(mirror, /CNB main changed while preparing the mobile mirror/u)
  assert.match(mirror, /commit-tree \$tree -p \$baseCommit/u)
  assert.match(mirror, /hash-object -w \$manifestPath/u)
  assert.match(mirror, /\.cnb-mobile-only/u)
  assert.match(mirror, /credential\.helper=!npx\.cmd --yes @cnbcool\/cnb-cli git-credential/u)
  assert.match(mirror, /Invoke-WebRequest[\s\S]*-Method Head/u)
  assert.doesNotMatch(mirror, /--clobber|Invoke-RestMethod.+-InFile/u)
})

test('the real release audit accepts the checked-in publisher contract', () => {
  const result = spawnSync(process.execPath, ['scripts/release-audit.mjs'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `release audit failed:\n${result.stdout}\n${result.stderr}`)
  assert.match(result.stdout, /Release audit passed/u)
})

test('Harness automatically receives the fixed publisher instruction in future sessions', () => {
  const agents = read('AGENTS.md')
  const guide = read('docs/RELEASING.zh-CN.md')
  assert.match(agents, /npm run release:publish -- run --version/u)
  assert.match(agents, /never upload local binaries to CNB/u)
  assert.match(agents, /Do not run individual publication commands/u)
  assert.match(guide, /换会话后不需要用户重新解释上传步骤/u)
  assert.match(guide, /首次发布和断点续跑使用同一条命令/u)
})
