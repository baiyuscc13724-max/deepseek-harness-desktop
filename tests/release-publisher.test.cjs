const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const YAML = require('yaml')
const {
  canReattachPreferredDraft,
  isExactDetachedDraft,
  matchesWorkflowRunIdentity,
  normalizePublisherPackagingState,
  normalizeReleaseBody,
  selectReleaseForTag,
  validateCnbMirrorObservations,
  validateCompletedPhaseEvidence,
  validateGithubReleaseAgainstManifest
} = require('../scripts/release-publish-selection.cjs')

const root = path.resolve(__dirname, '..')
const read = file => readFileSync(path.join(root, file), 'utf8')

const expectedPhases = [
  'local-source-gates',
  'immutable-tag',
  'desktop-cloud-builds',
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
  assert.equal(legacy.schemaVersion, 2)
  assert.equal(legacy.packagingMode, 'github-actions-only')
  assert.equal(Object.hasOwn(legacy.phases, 'local-windows'), false)
  assert.equal(Object.hasOwn(legacy.phases, 'local-source-gates'), false)

  const incorrectlyMigrated = {
    schemaVersion: 2,
    packagingMode: 'github-actions-only',
    phases: { 'local-source-gates': { status: 'completed', migratedFrom: 'local-windows' } }
  }
  assert.equal(normalizePublisherPackagingState(incorrectlyMigrated), true)
  assert.equal(Object.hasOwn(incorrectlyMigrated.phases, 'local-source-gates'), false)

  const current = { schemaVersion: 2, packagingMode: 'github-actions-only', phases: { 'local-source-gates': { status: 'completed' } } }
  assert.equal(normalizePublisherPackagingState(current), false)
  assert.equal(current.phases['local-source-gates'].status, 'completed')
  assert.throws(
    () => normalizePublisherPackagingState({ packagingMode: 'local-windows', phases: {} }),
    /packaging mode mismatch/u
  )
})

test('tampered stored workflow run identities cannot satisfy a release phase', () => {
  const run = {
    workflowName: 'Publish Signed Android Mobile',
    workflowPath: '.github/workflows/android-mobile-release.yml',
    event: 'workflow_dispatch',
    headSha: 'a'.repeat(40),
    headBranch: 'v1.0.41'
  }
  const expected = {
    workflowName: run.workflowName,
    workflowPath: run.workflowPath,
    events: ['push', 'workflow_dispatch'],
    headSha: run.headSha,
    headBranch: run.headBranch
  }
  assert.equal(matchesWorkflowRunIdentity(run, expected), true)
  for (const [field, value] of [
    ['workflowName', 'Unrelated Workflow'],
    ['workflowPath', '.github/workflows/unrelated.yml'],
    ['event', 'schedule'],
    ['headSha', 'b'.repeat(40)],
    ['headBranch', 'main']
  ]) {
    assert.equal(matchesWorkflowRunIdentity({ ...run, [field]: value }, expected), false, field)
  }
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
      browser_download_url: `https://github.com/org/repo/releases/download/v1.0.41/${encoded}`,
      mirror_urls: [`https://cnb.cool/org/repo/-/releases/download/v1.0.41/${encoded}`]
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
  assert.ok(plan.guarantees.includes('all release packages built by GitHub Actions'))
  assert.ok(plan.guarantees.includes('cloud-only release artifact transfer'))
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
  const localGate = source.slice(source.indexOf('await phase(state, LOCAL_GATE_PHASE'), source.indexOf("await phase(state, 'immutable-tag'"))
  assert.match(localGate, /release:orchestrate[\s\S]*--through', 'verify'/u)
  assert.match(localGate, /rmSync\(localDist[\s\S]*existsSync\(localDist\)/u)
  assert.doesNotMatch(localGate, /--through', 'windows'|npmRun\(\['run', 'dist'/u)
  assert.match(source, /recover-release-from-actions\.yml/u)
  assert.match(source, /release:cnb-cloud/u)
  assert.match(source, /workflowRun[\s\S]*actions\/runs\/[\s\S]*workflowPath[\s\S]*matchesWorkflowRunIdentity/u)
  assert.match(source, /run\.status === 'completed'[\s\S]*required\.every/u)
  assert.match(source, /signed-android'[\s\S]*productWorkflowIdentity\(WORKFLOWS\.android\)[\s\S]*signed-components'[\s\S]*productWorkflowIdentity\(WORKFLOWS\.components\)/u)
  for (const [phaseName, nextPhase] of [
    ['desktop-cloud-builds', 'desktop-publication'],
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

test('desktop recovery waits for the complete source workflow and only runs after source failure', () => {
  const source = read('scripts/release-publish.mjs')
  const completion = source.slice(source.indexOf('async function waitForRunCompletion'), source.indexOf('async function sleep'))
  const publication = source.slice(source.indexOf("phase(state, 'desktop-publication'"), source.indexOf("phase(state, 'signed-android'"))
  assert.match(completion, /if \(run\.status === 'completed'\) return run/u)
  assert.match(completion, /async function waitForRun\(runId\)[\s\S]*await waitForRunCompletion\(runId\)[\s\S]*run\.conclusion !== 'success'/u)
  assert.match(publication, /const sourceRun = await waitForRunCompletion\(desktopRunId\)/u)
  assert.ok(publication.indexOf('waitForRunCompletion(desktopRunId)') < publication.indexOf('ensureExactDraft('))
  assert.match(publication, /if \(sourceRun\.conclusion === 'success'\) \{[\s\S]*assertReleaseAssets\(release, expectedDesktopNames\(\), \{ draft: false, allowAdditional: true \}\)[\s\S]*recoveryRunId: null/u)
  assert.ok(publication.indexOf("sourceRun.conclusion === 'success'") < publication.indexOf("dispatchWorkflow('recover-release-from-actions.yml'"))
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
  assert.match(components, /git rev-parse 'FETCH_HEAD\^\{\}'/u)
  assert.match(components, /test "\$\(git rev-parse HEAD\)" = "\$tag_revision"/u)
  assert.match(components, /git reset --hard HEAD[\s\S]*git clean -fd[\s\S]*git checkout --detach "\$tag_revision"/u)
  assert.match(components, /git push origin "HEAD:refs\/heads\/\$branch"/u)
  assert.doesNotMatch(components, /git push origin "HEAD:refs\/heads\/main"|release: refresh \$RELEASE_TAG signed manifest/u)
  assert.match(components, /trap 'rm -f "\$key_file" "\$manifest_file"'/u)
  assert.match(publisher, /preflightDesktopManifestTrust/u)
  assert.match(publisher, /await preflightDesktopManifestTrust\(\)/u)
  assert.match(publisher, /adoptCloudSignedManifest/u)
  assert.match(publisher, /parents\.length !== 2 \|\| parents\[1\] !== stateProductRevision/u)
  assert.match(publisher, /changed\.length !== 1 \|\| changed\[0\] !== 'release-manifest\.json'/u)
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
  assert.equal(workflow.on.workflow_dispatch.inputs.product_revision.required, true)
  assert.equal(workflow.on.push.branches, undefined)
  assert.doesNotMatch(read('.github/workflows/release.yml'), /release-retry\/v/u)
  assert.deepEqual(workflow.jobs.build.strategy.matrix.os, ['windows-latest', 'macos-latest', 'ubuntu-latest'])
  assert.match(publisher, /dispatchWorkflow\('release\.yml',[\s\S]*\['product_revision', stateProductRevision\]/u)
  assert.match(publisher, /DESKTOP_DISCOVERY_TIMEOUT_MS = 5 \* 60 \* 1000/u)
  assert.doesNotMatch(publisher, /npmRun\(\['run', 'dist'/u)
  const buildSteps = workflow.jobs.build.steps
  const componentGate = buildSteps.find(step => step.name === 'Verify packaged Windows component health and rollback')
  const artifactUpload = buildSteps.find(step => String(step.uses || '').startsWith('actions/upload-artifact@'))
  assert.equal(componentGate.if, "runner.os == 'Windows'")
  assert.match(componentGate.run, /npm run test:component-local[\s\S]*--app-exe[\s\S]*--profile/u)
  assert.ok(buildSteps.indexOf(componentGate) < buildSteps.indexOf(artifactUpload))
  for (const jobName of ['build', 'ios-simulators', 'stage-draft']) {
    const steps = workflow.jobs[jobName].steps
    const bind = steps.find(step => step.name === 'Bind cloud package build to immutable source revision')
    assert.ok(bind, `${jobName} must bind checkout to the immutable product revision`)
    assert.match(bind.run, /HARNESS_RELEASE_PACKAGING_MODE[\s\S]*github-actions-only/u)
    assert.match(bind.run, /git rev-parse HEAD/u)
    assert.match(bind.run, /git rev-list -n 1 "\$RELEASE_TAG"/u)
    assert.match(bind.run, /PUBLISHER_PRODUCT_REVISION/u)
    assert.match(bind.run, /GITHUB_SHA/u)
    assert.match(bind.run, /\^\[0-9a-f\]\{40\}\$/u)
  }
})

test('desktop publication cannot stage a macOS artifact before the unsigned build gate succeeds', () => {
  const source = read('.github/workflows/release.yml')
  const workflow = YAML.parse(source)
  assert.equal(workflow.jobs.build.environment.name, 'desktop-build')
  assert.deepEqual(workflow.jobs['stage-draft'].needs, ['build', 'ios-simulators'])
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

test('primary desktop publication proves an exact signed stable in-place Windows upgrade before going public', () => {
  const workflowText = read('.github/workflows/release.yml')
  const workflow = YAML.parse(workflowText)
  const stage = workflow.jobs['stage-draft']
  const windows = workflow.jobs['verify-windows-draft']
  assert.equal(windows.needs, 'stage-draft')
  assert.equal(workflow.jobs.publish.needs, 'verify-windows-draft')
  assert.equal(windows['timeout-minutes'], 30)

  const bindStep = stage.steps.find(step => step.name === 'Bind the signed previous stable Windows installer to an exact public asset')
  const snapshotUpload = stage.steps.find(step => step.with?.name === 'draft-snapshot')
  const windowsRuns = windows.steps.map(step => step.run || '').join('\n')
  assert.ok(bindStep)
  assert.ok(stage.steps.indexOf(bindStep) < stage.steps.indexOf(snapshotUpload))
  assert.match(snapshotUpload.with.path, /draft-snapshot\.json[\s\S]*previous-stable\.json/u)
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
  assert.match(windowsRuns, /Authenticated draft installer did not close every previous stable desktop process/u)
  assert.match(windowsRuns, /RestartApplications=no contract failed/u)
  assert.match(windowsRuns, /Authenticated draft upgrade did not preserve the same profile marker/u)
  assert.match(windowsRuns, /Upgraded installed self-test JSON failed or reported the wrong version/u)
  assert.match(windowsRuns, /Upgraded installed uninstaller is missing/u)
  assert.match(windowsRuns, /Uninstaller left the temporary installation directory behind/u)
  assert.doesNotMatch(windowsRuns, /\$install = Start-Process -FilePath \$installer|Downloaded installer exited/u)
})

test('primary desktop publication uploads and publishes only the snapshotted release id', () => {
  const workflowText = read('.github/workflows/release.yml')
  const workflow = YAML.parse(workflowText)
  const stage = workflow.jobs['stage-draft']
  const stageRuns = stage.steps.map(step => step.run || '').join('\n')
  const publishRuns = workflow.jobs.publish.steps.map(step => step.run || '').join('\n')
  const createRun = stage.steps.find(step => step.name === 'Refuse an existing release mutation with atomic REST create').run
  const initialIdentityRun = stage.steps.find(step => step.name === 'Verify exact draft assets and immutable snapshot metadata').run

  assert.match(createRun, /--rawfile body release-notes\.md/u)
  assert.match(createRun, /--input create-release-request\.json/u)
  assert.doesNotMatch(createRun, /body=\$\(cat release-notes\.md\)/u)
  assert.match(createRun, /\.target_commitish == \$expected\[0\]\.target_commitish[\s\S]*\.body == \$expected\[0\]\.body/u)
  assert.match(initialIdentityRun, /--slurpfile expected create-release-request\.json/u)
  assert.match(initialIdentityRun, /\.id == \$id[\s\S]*\.target_commitish == \$expected\[0\]\.target_commitish[\s\S]*\.name == \$expected\[0\]\.name[\s\S]*\.body == \$expected\[0\]\.body[\s\S]*\.prerelease == \$expected\[0\]\.prerelease/u)
  assert.match(stageRuns, /release_id="\$\(jq -er '\.id' created-release\.json\)"/u)
  assert.match(stageRuns, /uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$release_id\/assets\?name=\$encoded_name/u)
  assert.match(stageRuns, /--data-binary "@\$file"/u)
  assert.doesNotMatch(stageRuns, /^\s*gh release upload/mu)
  assert.match(publishRuns, /snapshot_id="\$\(jq -er '\.id' draft-state\/draft-snapshot\.json\)"/u)
  assert.match(publishRuns, /gh api --method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$snapshot_id" -F draft=false/u)
  assert.match(publishRuns, /jq '\.draft = false' draft-state\/draft-snapshot\.json > expected-published\.json/u)
  assert.match(publishRuns, /current-published\.json/u)
  assert.doesNotMatch(publishRuns, /gh release (?:edit|view)|releases\/tags\//u)
})

test('cloud recovery binds artifacts to the tag and safely resumes any verified subset', () => {
  const workflowText = read('.github/workflows/recover-release-from-actions.yml')
  const workflow = YAML.parse(workflowText)
  assert.ok(workflow.jobs.recover)
  assert.equal(workflow.concurrency.group, 'release-${{ inputs.tag }}')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  assert.equal(workflow.jobs['verify-windows-draft'].needs, 'recover')
  assert.equal(workflow.jobs['verify-windows-draft']['timeout-minutes'], 90)
  assert.equal(workflow.jobs.publish.needs, 'verify-windows-draft')
  const recoveryRuns = workflow.jobs.recover.steps.map(step => step.run || '').join('\n')
  const windowsRuns = workflow.jobs['verify-windows-draft'].steps.map(step => step.run || '').join('\n')
  const publishRuns = workflow.jobs.publish.steps.map(step => step.run || '').join('\n')
  assert.doesNotMatch(recoveryRuns, /--method PATCH/u)
  assert.doesNotMatch(windowsRuns, /--method PATCH|uploads\.github\.com/u)
  assert.match(publishRuns, /--method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"/u)
  assert.match(workflowText, /\.head_sha == \$sha/u)
  assert.match(workflowText, /\.path == \$path/u)
  assert.match(workflowText, /Unexpected private draft assets/u)
  assert.match(workflowText, /Preserving verified existing asset/u)
  assert.match(workflowText, /A concurrent verified uploader won/u)
  assert.match(workflowText, /uploads\.github\.com\/repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID\/assets\?name=\$encoded_name/u)
  assert.match(workflowText, /--data-binary "@\$file"/u)
  assert.doesNotMatch(workflowText, /^\s*gh release upload/mu)
  assert.match(workflowText, /name: recovered-draft-snapshot/u)
  assert.match(workflowText, /Authenticated exact-id download, checksum, stable upgrade, self-test, and uninstall/u)
  assert.match(workflowText, /validateAndVerifyDesktopReleaseManifest/u)
  assert.match(workflowText, /validateAndVerifyManifest/u)
  assert.match(workflowText, /component-feeds\/stable\/win32-x64\.json/u)
  assert.match(workflowText, /compareVersions\(stable\.releaseVersion, currentVersion\) >= 0/u)
  assert.match(workflowText, /Signed Windows stable fallback does not match the signed desktop installer asset/u)
  assert.match(workflowText, /releases\/tags\/\$stable_tag/u)
  assert.doesNotMatch(workflowText, /releases\/latest|release view latest/u)
  assert.match(workflowText, /previous-stable\.json/u)
  assert.match(workflowText, /releases\/\$\(\$previous\.releaseId\)/u)
  assert.match(workflowText, /releases\/assets\/\$\(\$previous\.asset\.id\)/u)
  assert.match(workflowText, /Previous stable installer SHA-256 mismatch/u)
  assert.match(workflowText, /\$previousInstallerPath = Join-Path \$env:RUNNER_TEMP 'recovered-previous-stable-installer\.exe'/u)
  assert.doesNotMatch(workflowText, /\$previousInstaller = Join-Path \$downloadRoot/u)
  assert.match(workflowText, /\$snapshot\.id\.ToString\(\) -ne \$env:RELEASE_ID/u)
  assert.match(workflowText, /releases\/assets\/\$\(\$asset\.id\)/u)
  assert.match(workflowText, /\$downloaded\.Length -ne \[int64\]\$asset\.size/u)
  assert.match(workflowText, /Snapshot digest mismatch/u)
  assert.match(workflowText, /Downloaded files do not exactly match SHA256SUMS\.txt/u)
  assert.match(workflowText, /Harness-Desktop-\$version-portable-x64\.exe/u)
  assert.match(workflowText, /\$portableSelfTest\.ExitCode -ne 0/u)
  assert.match(workflowText, /Harness-Desktop-\$version-win-x64\.exe/u)
  assert.match(workflowText, /Previous stable installed self-test JSON failed or reported the wrong version/u)
  assert.match(workflowText, /Find-DllHoldingProcess[\s\S]*d3dcompiler_47\.dll/u)
  assert.match(workflowText, /\/NORESTARTAPPLICATIONS/u)
  assert.match(workflowText, /\/LOGCLOSEAPPLICATIONS/u)
  assert.match(workflowText, /recovered-upgrade-installer\.log/u)
  assert.doesNotMatch(workflowText, /\/FORCECLOSEAPPLICATIONS/u)
  assert.match(workflowText, /Recovered draft installer did not close every previous stable desktop process/u)
  assert.match(workflowText, /RestartApplications=no contract failed/u)
  assert.match(workflowText, /stable-upgrade-profile\.marker/u)
  assert.match(workflowText, /Recovered draft upgrade did not preserve the same profile marker/u)
  assert.match(workflowText, /Upgraded installed self-test JSON failed or reported the wrong version/u)
  assert.match(workflowText, /Filter 'unins\*\.exe'/u)
  assert.match(workflowText, /Uninstaller left the temporary installation directory behind/u)
  assert.match(workflowText, /Reconfirm exact draft snapshot and publish by immutable release id/u)
  assert.match(workflowText, /gh api --method PATCH "repos\/\$GITHUB_REPOSITORY\/releases\/\$RELEASE_ID"/u)
  assert.match(workflowText, /diff -u <\(jq -S \. draft-snapshot\.json\) <\(jq -S \. current-draft\.json\)/u)
  assert.doesNotMatch(workflowText, /--clobber/u)
})

test('manual workflow recovery is uniquely identified and always builds the immutable tag', () => {
  const source = read('scripts/release-publish.mjs')
  const release = read('.github/workflows/release.yml')
  const android = read('.github/workflows/android-mobile-release.yml')
  const recovery = read('.github/workflows/recover-release-from-actions.yml')
  assert.match(source, /requestId[\s\S]*request_id/u)
  assert.match(source, /displayTitle\?\.includes\(requestId\)/u)
  assert.match(source, /async function dispatchWorkflow\(file, fields = \[\], ref = tag\)/u)
  assert.match(source, /dispatchWorkflow\('release\.yml',[\s\S]*\['product_revision', stateProductRevision\]/u)
  assert.match(release, /product_revision:[\s\S]*Exact 40-character commit/u)
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
  assert.match(publisher, /publish-production-components\.yml'[\s\S]*\['product_revision', stateProductRevision\]/u)
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

test('Harness automatically receives the fixed publisher instruction in future sessions', () => {
  const agents = read('AGENTS.md')
  const guide = read('docs/RELEASING.zh-CN.md')
  assert.match(agents, /npm run release:publish -- run --version/u)
  assert.match(agents, /never upload local binaries to CNB/u)
  assert.match(agents, /Do not run individual publication commands/u)
  assert.match(guide, /换会话后不需要用户重新解释上传步骤/u)
  assert.match(guide, /首次发布和断点续跑使用同一条命令/u)
})
