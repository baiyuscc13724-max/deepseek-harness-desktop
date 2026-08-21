const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
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
