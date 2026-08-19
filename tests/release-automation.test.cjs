const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

async function source(relative) {
  return readFile(path.join(root, relative), 'utf8')
}

test('all third-party GitHub Actions are pinned to immutable commits', async () => {
  for (const file of ['release.yml', 'android-mobile-release.yml', 'apple-virtual-tests.yml', 'ci.yml', 'upstream-watch.yml']) {
    const workflow = await source(path.join('.github', 'workflows', file))
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)@([^\s#]+)/g)]
    assert.ok(uses.length > 0, `${file} must use at least one pinned action`)
    for (const match of uses) assert.match(match[2], /^[0-9a-f]{40}$/, `${file}: ${match[0]}`)
  }
})

test('production component preparation binds the private key to target-correct fallbacks', async () => {
  const builder = await source('scripts/prepare-production-components.mjs')
  assert.match(builder, /does not match the public key embedded/u)
  assert.match(builder, /win32-x64[\s\S]*win-x64\.exe/u)
  assert.match(builder, /darwin-x64[\s\S]*mac-x64\.dmg/u)
  assert.match(builder, /darwin-arm64[\s\S]*mac-arm64\.dmg/u)
  assert.match(builder, /validateAndVerifyManifest/u)
  assert.doesNotMatch(builder, /console\.log\([^\n]*(privateKey|privatePem|recoveryKey)/u)
})

test('release orchestration is resumable and defaults to non-publishing verification', async () => {
  const orchestrator = await source('scripts/release-orchestrator.mjs')
  assert.match(orchestrator, /const through = argument\('through', 'verify'\)/u)
  assert.match(orchestrator, /\.release-state/u)
  assert.match(orchestrator, /process\.env\.npm_execpath/u)
  assert.match(orchestrator, /Skipping completed phase/u)
  assert.match(orchestrator, /test:component-local/u)
  assert.doesNotMatch(orchestrator, /gh release (create|upload)|git push/u)
})
