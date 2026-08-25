const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const YAML = require('yaml')
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
  assert.throws(() => assertCandidateRebindAllowed({ ...state, phases: { ...state.phases, 'immutable-tag': { status: 'running' } } }, safe), /tag-dependent/u)
  const publisher = read('scripts/release-publish.mjs')
  assert.match(publisher, /candidateAttempts\.push\([\s\S]*sourceRevision: previous[\s\S]*desktopRunId[\s\S]*phases: structuredClone/u)
  assert.match(publisher, /state\.sourceRevision = currentHead[\s\S]*state\.phases = \{\}/u)
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
    events: ['push', 'workflow_dispatch'],
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
  assert.match(source, /signed-android'[\s\S]*productWorkflowIdentity\(WORKFLOWS\.android\)[\s\S]*signed-components'[\s\S]*publishPostTagRecoveryFix\(\)[\s\S]*componentCheckpointWorkflowIdentity\(completed\)/u)
  for (const [phaseName, nextPhase] of [
    ['desktop-cloud-builds', 'immutable-tag'],
    ['immutable-tag', 'desktop-publication'],
    ['desktop-publication', 'signed-android'],
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

test('successful pre-Tag run is the sole artifact source for post-Tag publication', () => {
  const source = read('scripts/release-publish.mjs')
  const build = source.slice(source.indexOf("phase(state, 'desktop-cloud-builds'"), source.indexOf("phase(state, 'immutable-tag'"))
  const tagPhase = source.slice(source.indexOf("phase(state, 'immutable-tag'"), source.indexOf("phase(state, 'desktop-publication'"))
  const publication = source.slice(source.indexOf("phase(state, 'desktop-publication'"), source.indexOf("phase(state, 'signed-android'"))
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
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/release-publish-selection\.cjs/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*scripts\/publish-cnb-cloud-mirror\.ps1/u)
  assert.match(publisher, /POST_TAG_PUBLISHER_FIX_FILES[\s\S]*'\.cnb\.yml'/u)
  assert.match(publisher, /postTagChanges\.some\(file => !POST_TAG_PUBLISHER_FIX_FILES\.has\(file\)\)/u)
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
    { file: '.github/workflows/ci.yml', job: 'verify', exercise: 'Verify browser navigation security in Electron' },
    { file: '.github/workflows/release.yml', job: 'build', exercise: 'Verify browser navigation security in Electron (Linux)' }
  ]

  for (const contract of workflows) {
    const source = read(contract.file)
    const workflow = YAML.parse(source)
    const steps = workflow.jobs[contract.job].steps
    const installDependencies = steps.find(step => /^npm ci(?:\s|$)/u.test(String(step.run || '')))
    const configure = steps.find(step => String(step.name || '').startsWith('Configure Electron sandbox'))
    const exercise = steps.find(step => step.name === contract.exercise)
    assert.ok(installDependencies, `${contract.file} must install dependencies`)
    assert.ok(configure, `${contract.file} must configure the Electron sandbox`)
    assert.ok(exercise, `${contract.file} must exercise Electron`)
    assert.ok(steps.indexOf(installDependencies) < steps.indexOf(configure))
    assert.ok(steps.indexOf(configure) < steps.indexOf(exercise))
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
  const linuxExercise = releaseSteps.find(step => step.name === 'Verify browser navigation security in Electron (Linux)')
  const desktopExercise = releaseSteps.find(step => step.name === 'Verify browser navigation security in Electron (Windows and macOS)')
  assert.equal(linuxConfigure.if, "runner.os == 'Linux'")
  assert.equal(linuxExercise.if, "runner.os == 'Linux'")
  assert.equal(desktopExercise.if, "runner.os != 'Linux'")
})

test('pre-Tag candidate proves an exact signed stable in-place Windows upgrade before Tag creation', () => {
  const workflowText = read('.github/workflows/release.yml')
  const workflow = YAML.parse(workflowText)
  const stage = workflow.jobs['prepare-windows-candidate']
  const windows = workflow.jobs['verify-windows-candidate']
  assert.equal(windows.needs, 'prepare-windows-candidate')
  assert.equal(windows.name, 'Verify Windows candidate upgrade and installation')
  assert.equal(windows['timeout-minutes'], 45)

  const bindStep = stage.steps.find(step => step.name === 'Bind the signed previous stable Windows installer to an exact public asset')
  const bindingUpload = stage.steps.find(step => step.with?.name === 'previous-stable-windows-binding')
  const windowsRuns = windows.steps.map(step => step.run || '').join('\n')
  assert.ok(bindStep)
  assert.ok(stage.steps.indexOf(bindStep) < stage.steps.indexOf(bindingUpload))
  assert.equal(bindingUpload.with.path, 'previous-stable.json')
  assert.match(bindStep.run, /validateAndVerifyDesktopReleaseManifest/u)
  assert.match(bindStep.run, /validateAndVerifyManifest/u)
  assert.match(bindStep.run, /component-feeds\/stable\/win32-x64\.json/u)
  assert.match(bindStep.run, /compareVersions\(stable\.releaseVersion, currentVersion\) >= 0/u)
  assert.match(bindStep.run, /Signed Windows stable fallback does not match the signed desktop installer asset/u)
  assert.match(bindStep.run, /releases\/tags\/\$stable_tag/u)
  assert.doesNotMatch(bindStep.run, /releases\/latest|release view latest/u)

  assert.match(windowsRuns, /previous-stable\.json/u)
  assert.match(windowsRuns, /releases\/\$\(\$previous\.releaseId\)/u)
  assert.match(windowsRuns, /releases\/assets\/\$\(\$previous\.asset\.id\)/u)
  assert.match(windowsRuns, /Previous stable installer SHA-256 mismatch/u)
  assert.match(windowsRuns, /Find-DllHoldingProcess[\s\S]*d3dcompiler_47\.dll/u)
  assert.match(windowsRuns, /Previous stable installed self-test JSON failed or reported the wrong version/u)
  assert.match(windowsRuns, /stable-upgrade-profile\.marker/u)
  assert.match(windowsRuns, /\/NORESTARTAPPLICATIONS/u)
  assert.match(windowsRuns, /\/LOGCLOSEAPPLICATIONS/u)
  assert.match(windowsRuns, /authenticated-upgrade-installer\.log/u)
  assert.doesNotMatch(windowsRuns, /ArgumentList[^\n]*\/(?:FORCECLOSEAPPLICATIONS|CLOSEAPPLICATIONS)/u)
  assert.match(windowsRuns, /Current-run candidate installer did not close every previous stable desktop process/u)
  assert.match(windowsRuns, /RestartApplications=no contract failed/u)
  assert.match(windowsRuns, /Current-run candidate upgrade did not preserve the same profile marker/u)
  assert.match(windowsRuns, /candidate-files[\s\S]*Current-run Windows artifact contains an unexpected file set/u)
  assert.match(windowsRuns, /Upgraded installed self-test JSON failed or reported the wrong version/u)
  assert.match(windowsRuns, /Upgraded installed uninstaller is missing/u)
  assert.match(windowsRuns, /Uninstaller left the temporary installation directory behind/u)
  assert.match(windowsRuns, /function Invoke-BoundedDownload[\s\S]*CancellationTokenSource[\s\S]*CancelAfter\([\s\S]*ResponseHeadersRead[\s\S]*CopyToAsync\(\$target, 1048576, \$cts\.Token\)[\s\S]*Authenticated previous-stable download timed out/u)
  assert.match(windowsRuns, /Invoke-BoundedDownload[^\n]*-TimeoutSeconds 300/u)
  assert.match(windowsRuns, /function Invoke-BoundedProcess[\s\S]*WaitForExit\(\$TimeoutSeconds \* 1000\)[\s\S]*taskkill\.exe \/PID \$process\.Id \/T \/F[\s\S]*timed out after \$TimeoutSeconds seconds/u)
  for (const label of ['Current-run portable self-test', 'Previous stable installer', 'Previous stable installed self-test', 'Current-run candidate upgrade installer', 'Upgraded installed self-test', 'Upgraded Windows uninstaller', 'Cleanup Windows uninstaller']) assert.match(windowsRuns, new RegExp(`-Label '${label}'`, 'u'))
  assert.doesNotMatch(windowsRuns, /Invoke-WebRequest|Start-Process[^\n]*-Wait|\$install = Start-Process -FilePath \$installer|Downloaded installer exited/u)
})

test('desktop workflow is dispatch-only build/test mode and cannot publish on Tag push', () => {
  const workflowText = read('.github/workflows/release.yml')
  const workflow = YAML.parse(workflowText)
  assert.ok(workflow.on.workflow_dispatch)
  assert.equal(workflow.on.push, undefined)
  assert.ok(workflow.on.workflow_dispatch.inputs.source_revision)
  assert.ok(workflow.jobs['prepare-windows-candidate'])
  assert.ok(workflow.jobs['verify-windows-candidate'])
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

test('cloud recovery prefetches every exact byte on Ubuntu and keeps the Windows gate read-only', () => {
  const workflowText = read('.github/workflows/recover-release-from-actions.yml')
  const workflow = YAML.parse(workflowText)
  const recovery = workflow.jobs.recover
  const windows = workflow.jobs['verify-windows-draft']
  const publish = workflow.jobs.publish
  assert.ok(recovery)
  assert.equal(workflow.concurrency.group, 'release-${{ inputs.tag }}')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs['verify-non-windows-draft'], undefined)
  assert.equal(windows.needs, 'recover')
  assert.equal(windows['timeout-minutes'], 90)
  assert.deepEqual(windows.permissions, { actions: 'read', contents: 'read' })
  assert.equal(windows.env.GH_TOKEN, undefined)
  assert.equal(publish.needs, 'verify-windows-draft')
  assert.equal(windows.steps.some(step => String(step.uses || '').startsWith('actions/upload-artifact@')), false)

  const recoveryRuns = recovery.steps.map(step => step.run || '').join('\n')
  const windowsRuns = windows.steps.map(step => step.run || '').join('\n')
  const publishRuns = publish.steps.map(step => step.run || '').join('\n')
  const prefetch = recovery.steps.find(step => step.name === 'Prefetch and verify every exact draft byte on Ubuntu')
  const upload = recovery.steps.find(step => step.with?.name === 'recovered-windows-verification-inputs')
  const windowsDownload = windows.steps.find(step => step.with?.name === 'recovered-windows-verification-inputs')
  const publishDownload = publish.steps.find(step => step.with?.name === 'recovered-windows-verification-inputs')
  assert.ok(prefetch)
  assert.ok(upload)
  assert.ok(windowsDownload)
  assert.ok(publishDownload)
  assert.equal(upload.with['retention-days'], 1)
  assert.equal(upload.with['compression-level'], 0)
  assert.ok(recovery.steps.indexOf(prefetch) < recovery.steps.indexOf(upload))

  assert.doesNotMatch(recoveryRuns, /--method PATCH/u)
  assert.doesNotMatch(windowsRuns, /--method PATCH|uploads\.github\.com|Invoke-WebRequest|\bgh api\b|\bcurl\b/u)
  assert.match(publishRuns, /--method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"/u)
  assert.match(workflowText, /\.head_sha == \$sha/u)
  assert.match(workflowText, /\.head_branch == "main"/u)
  assert.match(workflowText, /\.event == "workflow_dispatch"[\s\S]*\.conclusion == "success"/u)
  assert.match(workflowText, /source_request_id:[\s\S]*required: true/u)
  assert.match(workflowText, /workflow_id[\s\S]*actions\/workflows\/\$workflow_id[\s\S]*Cloud Build & Release Desktop/u)
  assert.match(workflowText, /display_title == "Candidate \\\(\$tag\) @ \\\(\$sha\) · \\\(\$request\)"/u)
  assert.match(workflowText, /select\(\.name \| startswith\("desktop-"\)\)[\s\S]*Exact same-run desktop artifact set is unavailable/u)
  assert.match(workflowText, /Verify Windows candidate upgrade and installation/u)
  assert.doesNotMatch(workflowText, /\.inputs\./u)
  assert.match(workflowText, /run-id: \$\{\{ inputs\.source_run_id \}\}/u)
  assert.match(workflowText, /\.path == \$path/u)
  assert.match(workflowText, /Unexpected private draft assets/u)
  assert.match(workflowText, /Preserving verified existing asset/u)
  assert.match(workflowText, /A concurrent verified uploader won/u)
  assert.match(workflowText, /uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID\/assets\?name=\$encoded_name/u)
  assert.match(workflowText, /--data-binary "@\$file"/u)
  assert.doesNotMatch(workflowText, /^\s*gh release upload/mu)

  assert.match(recoveryRuns, /validateAndVerifyDesktopReleaseManifest/u)
  assert.match(recoveryRuns, /validateAndVerifyManifest/u)
  assert.match(recoveryRuns, /component-feeds\/stable\/win32-x64\.json/u)
  assert.match(recoveryRuns, /compareVersions\(stable\.releaseVersion, currentVersion\) >= 0/u)
  assert.match(recoveryRuns, /Signed Windows stable fallback does not match the signed desktop installer asset/u)
  assert.match(recoveryRuns, /releases\/tags\/\$stable_tag/u)
  assert.doesNotMatch(recoveryRuns, /releases\/latest|release view latest/u)
  assert.match(prefetch.run, /releases\/assets\/\$id/u)
  assert.match(prefetch.run, /--connect-timeout 15 --max-time 900/u)
  assert.match(prefetch.run, /jq -c '\.assets\[\]'/u)
  assert.match(prefetch.run, /pids=\(\)[\s\S]*\$\{#pids\[@\]\} >= 3/u)
  assert.match(prefetch.run, /Snapshot size mismatch/u)
  assert.match(prefetch.run, /Snapshot digest mismatch/u)
  assert.match(prefetch.run, /sha256sum --strict -c SHA256SUMS\.txt/u)
  assert.match(prefetch.run, /SHA256SUMS\.txt must contain exactly eight desktop asset entries/u)
  assert.match(prefetch.run, /required_windows[\s\S]*portable-x64\.exe[\s\S]*win-x64\.exe/u)
  assert.match(prefetch.run, /previous-stable-installer\.exe/u)
  assert.match(prefetch.run, /Previous stable installer size mismatch/u)
  assert.match(prefetch.run, /Previous stable installer SHA-256 mismatch/u)

  assert.match(windowsRuns, /Resolve-Path 'draft-state\/windows-files'/u)
  assert.match(windowsRuns, /Resolve-Path 'draft-state\/previous-stable-installer\.exe'/u)
  assert.match(windowsRuns, /Snapshot must bind exactly nine uniquely named draft assets/u)
  assert.match(windowsRuns, /\$snapshot\.id\.ToString\(\) -ne \$env:RELEASE_ID/u)
  assert.match(windowsRuns, /Prefetched Windows gate artifact contains an unexpected file set/u)
  assert.match(windowsRuns, /\$downloaded\.Length -ne \[int64\]\$asset\.size/u)
  assert.match(windowsRuns, /Snapshot digest mismatch/u)
  assert.match(windowsRuns, /SHA256SUMS\.txt must contain exactly eight desktop asset entries/u)
  assert.match(windowsRuns, /SHA256SUMS\.txt does not list the exact recovered binaries/u)
  assert.match(windowsRuns, /Snapshot digest and SHA256SUMS disagree/u)
  assert.match(windowsRuns, /Harness-Desktop-\$version-portable-x64\.exe/u)
  assert.match(windowsRuns, /\$portableSelfTestExit -ne 0/u)
  assert.match(windowsRuns, /Harness-Desktop-\$version-win-x64\.exe/u)
  assert.match(windowsRuns, /Previous stable installed self-test JSON failed or reported the wrong version/u)
  assert.match(windowsRuns, /Find-DllHoldingProcess[\s\S]*d3dcompiler_47\.dll/u)
  assert.match(windowsRuns, /function Invoke-BoundedProcess[\s\S]*WaitForExit\(\$TimeoutSeconds \* 1000\)[\s\S]*taskkill\.exe \/PID \$process\.Id \/T \/F/u)
  for (const label of ['Recovered portable self-test', 'Recovered previous stable installer', 'Recovered previous stable self-test', 'Recovered draft upgrade installer', 'Recovered upgraded self-test', 'Recovered Windows uninstaller', 'Recovered cleanup uninstaller']) assert.match(windowsRuns, new RegExp(`-Label '${label}'`, 'u'))
  assert.match(windowsRuns, /\/NORESTARTAPPLICATIONS/u)
  assert.match(windowsRuns, /\/LOGCLOSEAPPLICATIONS/u)
  assert.doesNotMatch(windowsRuns, /\/FORCECLOSEAPPLICATIONS|Start-Process[^\n]*-Wait/u)
  assert.match(windowsRuns, /Recovered draft installer did not close every previous stable desktop process/u)
  assert.match(windowsRuns, /RestartApplications=no contract failed/u)
  assert.match(windowsRuns, /stable-upgrade-profile\.marker/u)
  assert.match(windowsRuns, /Recovered draft upgrade did not preserve the same profile marker/u)
  assert.match(windowsRuns, /Upgraded installed self-test JSON failed or reported the wrong version/u)
  assert.match(windowsRuns, /Filter 'unins\*\.exe'/u)
  assert.match(windowsRuns, /Uninstaller left the temporary installation directory behind/u)

  assert.match(workflowText, /Reconfirm exact draft snapshot and publish by immutable release id/u)
  assert.match(workflowText, /gh api --method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"/u)
  assert.match(workflowText, /diff -u <\(jq -S \. draft-snapshot\.json\) <\(jq -S \. current-draft\.json\)/u)
  assert.doesNotMatch(workflowText, /--clobber/u)
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
  assert.match(android, /ref: \$\{\{ inputs\.tag \|\| github\.ref \}\}/u)
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
