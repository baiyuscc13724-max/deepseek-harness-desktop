const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const currentVersion = json('package.json').version
const escapedVersion = currentVersion.replace(/\./gu, '\\.')
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

test('candidate source identity stays synchronized across lockfile and owned packages without moving published history', () => {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/u)
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

test('candidate mobile, UA, workflow and examples derive one version while README stable downloads remain historical', () => {
  const { readAndroidMobileVersion, encodeAndroidVersionCode } = require('../scripts/mobile-release-version.cjs')
  const mobile = readAndroidMobileVersion(root)
  assert.equal(mobile.integrationVersion, currentVersion)
  assert.equal(mobile.versionCode, encodeAndroidVersionCode(mobile.versionName))
  const ios = text('mobile/ios/project.yml')
  assert.equal(Number(/CURRENT_PROJECT_VERSION:\s*(\d+)/u.exec(ios)?.[1]), Math.floor(encodeAndroidVersionCode(currentVersion) / 100))
  assert.equal(/MARKETING_VERSION:\s*([^\s]+)/u.exec(ios)?.[1], currentVersion)
  assert.equal(/CURRENT_MOBILE_VERSION = '([^']+)'/u.exec(text('electron/bridge/mobile-sync-service.cjs'))?.[1], mobile.versionName)
  assert.match(text('plugins/dsh-desktop-web-search/lib/index.js'), new RegExp(`HarnessDesktop/${escapedVersion}`, 'u'))
  assert.match(text('.github/workflows/verify-component-signing-secret.yml'), new RegExp(`verify-component-signing-secret/v${escapedVersion}`, 'u'))

  const updateExample = json('mobile/mobile-app-update.example.json')
  assert.equal(updateExample.platforms.android.version, mobile.versionName)
  assert.equal(new URL(updateExample.platforms.android.url).pathname.split('/').at(-1), mobile.assetName)
  assert.ok(new URL(updateExample.platforms.android.url).pathname.includes(`/v${currentVersion}/`))
  assert.equal(updateExample.platforms.ios.version, currentVersion)
  assert.equal(updateExample.platforms.android.sha256, '0'.repeat(64), 'example is not a signed release feed')

  const readme = text('README.md')
  const stable = /当前稳定版：\*\*v(\d+\.\d+\.\d+)\*\*/u.exec(readme)?.[1]
  assert.ok(stable, 'README explicitly identifies the stable release separately')
  assert.ok(readme.includes(`releases/download/v${stable}/`), 'public download links retain the declared stable release')
  assert.ok(readme.includes(`下一发布候选：**v${currentVersion}`), 'candidate label follows source identity, not stable history')
  for (const relative of ['README.md', 'CHANGELOG.md', 'release-notes.md']) assert.ok(text(relative).includes(currentVersion), `${relative} describes this candidate`)
})
