const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

async function source(relative) {
  return readFile(path.join(root, relative), 'utf8')
}

test('all third-party GitHub Actions are pinned to immutable commits', async () => {
  for (const file of ['release.yml', 'publish-production-components.yml', 'android-mobile-release.yml', 'apple-virtual-tests.yml', 'ci.yml', 'upstream-watch.yml']) {
    const workflow = await source(path.join('.github', 'workflows', file))
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)@([^\s#]+)/g)]
    assert.ok(uses.length > 0, `${file} must use at least one pinned action`)
    for (const match of uses) assert.match(match[2], /^[0-9a-f]{40}$/, `${file}: ${match[0]}`)
  }
})

test('signed Android publication follows the tag and waits for the verified desktop release', async () => {
  const workflow = await source(path.join('.github', 'workflows', 'android-mobile-release.yml'))
  assert.match(workflow, /push:[\s\S]*tags:[\s\S]*'v\*'/u)
  assert.ok(workflow.includes('RELEASE_TAG: ${{ inputs.tag || github.ref_name }}'))
  assert.match(workflow, /Waiting for verified desktop release/u)
  assert.match(workflow, /gh release upload "\$RELEASE_TAG"/u)
  assert.match(workflow, /seq 1 180/u)
  assert.match(workflow, /android-universal\.apk\.sha256/u)
  assert.match(workflow, /Only one Android release asset exists/u)
  assert.match(workflow, /Verify public signed APK bytes and identity/u)
  assert.doesNotMatch(workflow, /--clobber|assembleDebug|app-debug\.apk/u)
  const desktopWorkflow = await source(path.join('.github', 'workflows', 'release.yml'))
  assert.match(desktopWorkflow, /overwrite_files: false/u)
  assert.match(desktopWorkflow, /draft: true/u)
  assert.match(desktopWorkflow, /release-retry\/v1\.0\.26/u)
  assert.match(desktopWorkflow, /ref: \$\{\{ env\.RELEASE_TAG \}\}/u)
  assert.match(desktopWorkflow, /--allow-downgrade --force/u)
  assert.match(desktopWorkflow, /tag_name: \$\{\{ env\.RELEASE_TAG \}\}/u)
  assert.match(desktopWorkflow, /Refuse an existing release mutation/u)
  assert.match(desktopWorkflow, /Verify draft assets and publish atomically/u)
  assert.match(desktopWorkflow, /sha256sum -c SHA256SUMS\.txt/u)
  assert.match(workflow, /--json isDraft/u)
})

test('production component preparation binds the private key to target-correct fallbacks', async () => {
  const builder = await source('scripts/prepare-production-components.mjs')
  assert.match(builder, /does not match the public key embedded/u)
  assert.match(builder, /win32-x64[\s\S]*win-x64\.exe/u)
  assert.match(builder, /darwin-x64[\s\S]*mac-x64\.dmg/u)
  assert.match(builder, /darwin-arm64[\s\S]*mac-arm64\.dmg/u)
  assert.match(builder, /validateAndVerifyManifest/u)
  assert.doesNotMatch(builder, /console\.log\([^\n]*(privateKey|privatePem|recoveryKey)/u)
  const publisher = await source(path.join('.github', 'workflows', 'publish-production-components.yml'))
  assert.match(publisher, /HARNESS_COMPONENT_SIGNING_PRIVATE_KEY_BASE64/u)
  assert.match(publisher, /prepare-production-components\.mjs/u)
  assert.match(publisher, /base64 --decode/u)
  assert.match(publisher, /Refuse replacement or partial component publication/u)
  assert.match(publisher, /verify-production-component-staging\.mjs/u)
  assert.match(publisher, /Re-download and verify public component assets/u)
  assert.doesNotMatch(publisher, /--clobber/u)
})

test('release orchestration is resumable and defaults to non-publishing verification', async () => {
  const orchestrator = await source('scripts/release-orchestrator.mjs')
  assert.match(orchestrator, /const through = argument\('through', 'verify'\)/u)
  assert.match(orchestrator, /\.release-state/u)
  assert.match(orchestrator, /process\.env\.npm_execpath/u)
  assert.match(orchestrator, /Skipping completed phase/u)
  assert.match(orchestrator, /cleanSourceRevision/u)
  assert.match(orchestrator, /sourceRevision !== sourceRevision/u)
  assert.match(orchestrator, /Release orchestration requires a clean source tree/u)
  assert.match(orchestrator, /PHASES\.slice\(phaseIndex\)/u)
  assert.match(orchestrator, /test:component-local/u)
  const componentTest = await source('scripts/local-component-update-test.mjs')
  assert.match(componentTest, /path\.join\(root, 'plugins'\)/u)
  assert.match(componentTest, /value\.phase === 'rollback-required'/u)
  assert.match(componentTest, /clearTimeout\(timer\)/u)
  assert.doesNotMatch(orchestrator, /gh release (create|upload)|git push/u)
})
