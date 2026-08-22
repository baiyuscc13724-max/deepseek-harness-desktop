const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const read = file => readFileSync(path.join(root, file), 'utf8')

const expectedPhases = [
  'local-windows',
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

test('one publisher command exposes the immutable resumable release order', () => {
  const pkg = JSON.parse(read('package.json'))
  const output = execFileSync(process.execPath, ['scripts/release-publish.mjs', 'plan', '--version', pkg.version, '--poll-seconds', '1'], {
    cwd: root,
    encoding: 'utf8'
  })
  const plan = JSON.parse(output)
  assert.equal(plan.command, `npm run release:publish -- run --version ${pkg.version}`)
  assert.deepEqual(plan.phases, expectedPhases)
  assert.ok(plan.stateFile.endsWith(`v${pkg.version}-publish.json`))
  assert.ok(plan.guarantees.includes('cloud-only release artifact transfer'))
  assert.ok(plan.guarantees.includes('stable feeds last'))
  assert.equal(pkg.scripts['release:publish'], 'node scripts/release-publish.mjs')
})

test('publisher resumes atomically and never downloads Actions binaries locally', () => {
  const source = read('scripts/release-publish.mjs')
  assert.match(source, /acquirePublicationLock/u)
  assert.match(source, /status === 'completed'/u)
  assert.match(source, /\$\{tag\}-publish\.json/u)
  assert.match(source, /release:orchestrate[\s\S]*--through', 'windows'/u)
  assert.match(source, /recover-release-from-actions\.yml/u)
  assert.match(source, /release:cnb-cloud/u)
  assert.match(source, /reusableDesktopBuildRun/u)
  assert.match(source, /run\.status === 'completed'[\s\S]*required\.every/u)
  assert.match(source, /waitForDesktopBuildDiscovery/u)
  assert.match(source, /Workflow completed without successful required jobs/u)
  assert.match(source, /failedBuild \? null : run/u)
  assert.match(source, /promoteStableFeeds/u)
  assert.doesNotMatch(source, /gh[^\n]*run[^\n]*download/u)
  assert.ok(source.indexOf("'cnb-assets'") < source.indexOf("'stable-components'"))
  assert.ok(source.indexOf("'stable-components'") < source.indexOf("'cnb-stable'"))
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
  assert.match(components, /refresh-release-manifest\.mjs[\s\S]*release-manifest\/\$RELEASE_TAG/u)
  assert.match(components, /refs\/tags\/\$RELEASE_TAG/u)
  assert.match(components, /git rev-list -n 1 FETCH_HEAD/u)
  assert.match(components, /refs\/heads\/main:refs\/remotes\/origin\/main/u)
  assert.match(components, /trap 'rm -f "\$key_file" "\$manifest_file"'/u)
  assert.match(publisher, /preflightDesktopManifestTrust/u)
  assert.match(publisher, /await preflightDesktopManifestTrust\(\)/u)
  assert.match(publisher, /adoptCloudSignedManifest/u)
  assert.match(publisher, /parents\.length !== 2 \|\| parents\[1\] !== stateProductRevision/u)
  assert.match(publisher, /changed\.length !== 1 \|\| changed\[0\] !== 'release-manifest\.json'/u)
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

test('cloud recovery binds artifacts to the tag and safely resumes any verified subset', () => {
  const workflowText = read('.github/workflows/recover-release-from-actions.yml')
  const workflow = YAML.parse(workflowText)
  assert.ok(workflow.jobs.recover)
  assert.match(workflowText, /\.head_sha == \$sha/u)
  assert.match(workflowText, /\.path == \$path/u)
  assert.match(workflowText, /Unexpected private draft assets/u)
  assert.match(workflowText, /Preserving verified existing asset/u)
  assert.match(workflowText, /A concurrent verified uploader won/u)
  assert.match(workflowText, /releases\/assets\/\$id/u)
  assert.match(workflowText, /sha256sum -c SHA256SUMS\.txt/u)
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
  assert.match(components, /--published-at "\$published_at"/u)
  assert.match(components, /Preserving verified existing component/u)
  assert.match(components, /Upload only missing immutable signed component assets/u)
  assert.match(prepare, /publishedAtInput/u)
  assert.match(cnb, /HARNESS_RELEASE_GIT/u)
  assert.match(publisher, /HARNESS_RELEASE_GIT: git/u)
  assert.match(publisher, /third_party['"], 'mingit['"], 'cmd['"], 'git\.exe'/u)
  assert.match(publisher, /gitEnvironment\(\)[\s\S]*mingw64['"], 'bin/u)
  assert.match(publisher, /gitCapture\(args\)[\s\S]*gitEnvironment\(\)/u)
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
