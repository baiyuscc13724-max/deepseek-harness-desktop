const test = require('node:test')
const assert = require('node:assert/strict')
const { checkAppUpdate, checkHarnessUpstream, compareVersions, parseChecksumFile, parseReleasePayload, selectChecksumAsset, selectReleasePayload, selectWindowsInstallerAsset } = require('../electron/bridge/update-service.cjs')

test('compareVersions handles prerelease and patch changes', () => {
  assert.equal(compareVersions('0.8.1', '0.8.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('0.1.0-rc.6', '0.1.0-rc.5'), 1)
})

test('app update checker accepts GitHub release payloads', async () => {
  const assets = [
    { name: 'Harness Desktop-0.9.0-win-x64.exe', browser_download_url: 'https://example.test/setup.exe', size: 123 },
    { name: 'Harness-Desktop-0.9.0-portable-x64.exe', browser_download_url: 'https://example.test/portable.exe', size: 120 },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 200 }
  ]
  const result = await checkAppUpdate({ currentVersion: '0.8.0', feedUrl: 'https://example.test/latest', fetchJsonImpl: async () => ({ tag_name: 'v0.9.0', html_url: 'https://example.test/release', body: 'notes', assets }) })
  assert.equal(result.configured, true)
  assert.equal(result.updateAvailable, true)
  assert.equal(result.latestVersion, '0.9.0')
  assert.equal(result.url, 'https://example.test/release')
  assert.equal(result.installer.name, 'Harness Desktop-0.9.0-win-x64.exe')
  assert.equal(result.checksums.name, 'SHA256SUMS.txt')
  assert.equal(selectWindowsInstallerAsset(result.installer ? [result.installer] : []).url, 'https://example.test/setup.exe')
  assert.equal(selectChecksumAsset(result.checksums ? [result.checksums] : []).url, 'https://example.test/SHA256SUMS.txt')
  assert.equal(parseReleasePayload({ version: '1.0.0' }).version, '1.0.0')
})

test('desktop updater requires the installer hash from SHA256SUMS', () => {
  const name = 'Harness Desktop-0.9.0-win-x64.exe'
  const digest = 'a'.repeat(64)
  assert.equal(parseChecksumFile(`${digest}  ${name}\n`, name), digest)
  assert.throws(() => parseChecksumFile(`${digest}  another.exe\n`, name), /SHA-256/)
})

test('app update checker selects prereleases only on the prerelease channel', async () => {
  const releases = [
    { tag_name: 'v1.1.0-rc.1', html_url: 'https://example.test/rc', prerelease: true, draft: false },
    { tag_name: 'v1.0.0', html_url: 'https://example.test/stable', prerelease: false, draft: false }
  ]
  assert.equal(selectReleasePayload(releases, 'stable').tag_name, 'v1.0.0')
  assert.equal(selectReleasePayload(releases, 'prerelease').tag_name, 'v1.1.0-rc.1')
  const result = await checkAppUpdate({ currentVersion: '1.0.0', channel: 'prerelease', fetchJsonImpl: async () => releases })
  assert.equal(result.updateAvailable, true)
  assert.equal(result.channel, 'prerelease')
})

test('Harness upstream checker never silently downgrades a newer pinned core', async () => {
  const result = await checkHarnessUpstream({ currentVersion: '0.1.0-rc.6', fetchJsonImpl: async () => ({ version: '0.1.0-rc.5' }) })
  assert.equal(result.updateAvailable, false)
  assert.equal(result.aheadOfUpstream, true)
})
