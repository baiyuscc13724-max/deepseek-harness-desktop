const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const currentVersion = '1.0.59'
const ownedPlugins = [
  'dsh-agent-teams',
  'dsh-codex-image-bridge',
  'dsh-desktop-browser-tools',
  'dsh-desktop-compaction',
  'dsh-desktop-computer-use',
  'dsh-desktop-directory-picker',
  'dsh-desktop-files',
  'dsh-desktop-mcp-manager',
  'dsh-desktop-memory-tools',
  'dsh-desktop-progress',
  'dsh-desktop-schedules',
  'dsh-desktop-web-search',
  'dsh-mobile-control',
  'dsh-model-admission',
  'dsh-session-experience'
]

function json(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))
}

function text(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

test('v1.0.59 release identity stays synchronized across owned packages', () => {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  assert.equal(pkg.version, currentVersion)
  assert.equal(lock.version, currentVersion)
  assert.equal(lock.packages[''].version, currentVersion)
  assert.deepEqual(
    ownedPlugins.map(name => [name, json(path.join('plugins', name, 'package.json')).version]),
    ownedPlugins.map(name => [name, currentVersion])
  )

  const android = json(path.join('plugins', 'dsh-android', 'package.json'))
  assert.equal(android.name, '@zseven-w/dsh-android')
  assert.equal(android.version, '0.1.0-rc.4')
})

test('v1.0.59 release identity stays synchronized across mobile, UA, workflow and docs', () => {
  assert.match(text('mobile/android/app/version.properties'), /^integrationVersion=1\.0\.59\r?\nversionName=1\.0\.59\r?\nversionCode=1005900\r?\n?$/u)
  assert.match(text('mobile/ios/project.yml'), /CURRENT_PROJECT_VERSION: 10059[\s\S]*MARKETING_VERSION: 1\.0\.59/u)
  assert.match(text('electron/bridge/mobile-sync-service.cjs'), /CURRENT_MOBILE_VERSION = '1\.0\.59'/u)
  assert.match(text('plugins/dsh-desktop-web-search/lib/index.js'), /HarnessDesktop\/1\.0\.59/u)
  assert.match(text('.github/workflows/verify-component-signing-secret.yml'), /verify-component-signing-secret\/v1\.0\.59/u)

  const updateExample = json('mobile/mobile-app-update.example.json')
  assert.equal(updateExample.platforms.android.version, currentVersion)
  assert.match(updateExample.platforms.android.url, /\/v1\.0\.59\/Harness-Mobile-1\.0\.59-android-universal\.apk$/u)
  assert.equal(updateExample.platforms.ios.version, currentVersion)

  for (const relative of ['README.md', 'CHANGELOG.md', 'release-notes.md']) {
    assert.match(text(relative), /1\.0\.59/u, `${relative} must name v1.0.59`)
  }
})
