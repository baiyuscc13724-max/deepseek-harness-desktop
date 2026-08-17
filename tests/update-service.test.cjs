const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_APP_FEED, DEFAULT_UPSTREAM_MANIFEST, checkAppUpdate, checkHarnessUpstream, compareVersions, parseChecksumFile, parseReleasePayload, selectChecksumAsset, selectReleasePayload, selectWindowsInstallerAsset } = require('../electron/bridge/update-service.cjs')

test('desktop update checks use the repository manifest instead of the rate-limited Releases API', () => {
  assert.equal(DEFAULT_APP_FEED, 'https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/release-manifest.json')
  assert.doesNotMatch(DEFAULT_APP_FEED, /api\.github\.com/)
})

test('Harness update checks prefer the domestic npm mirror', () => {
  assert.match(DEFAULT_UPSTREAM_MANIFEST, /^https:\/\/registry\.npmmirror\.com\//)
})

test('compareVersions handles prerelease and patch changes', () => {
  assert.equal(compareVersions('0.8.1', '0.8.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('0.1.0-rc.6', '0.1.0-rc.5'), 1)
})

test('app update checker accepts GitHub release payloads', async () => {
  const assets = [
    { name: 'Harness-Desktop-0.9.0-win-x64.exe', browser_download_url: 'https://example.test/setup.exe', size: 123 },
    { name: 'Harness-Desktop-0.9.0-portable-x64.exe', browser_download_url: 'https://example.test/portable.exe', size: 120 },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 200 }
  ]
  const result = await checkAppUpdate({ currentVersion: '0.8.0', feedUrl: 'https://example.test/latest', fetchJsonImpl: async () => ({ tag_name: 'v0.9.0', html_url: 'https://example.test/release', body: 'notes', assets }) })
  assert.equal(result.configured, true)
  assert.equal(result.updateAvailable, true)
  assert.equal(result.latestVersion, '0.9.0')
  assert.equal(result.url, 'https://example.test/release')
  assert.equal(result.installer.name, 'Harness-Desktop-0.9.0-win-x64.exe')
  assert.equal(result.checksums.name, 'SHA256SUMS.txt')
  assert.equal(selectWindowsInstallerAsset(result.installer ? [result.installer] : []).url, 'https://example.test/setup.exe')
  assert.equal(selectChecksumAsset(result.checksums ? [result.checksums] : []).url, 'https://example.test/SHA256SUMS.txt')
  assert.equal(parseReleasePayload({ version: '1.0.0' }).version, '1.0.0')
})

test('app update checker falls back to the next manifest and prefers asset mirrors', async () => {
  const calls = []
  const result = await checkAppUpdate({
    currentVersion: '1.0.18',
    feedUrls: ['https://cn.example.test/release.json', 'https://global.example.test/release.json'],
    fetchJsonImpl: async url => {
      calls.push(url)
      if (url.includes('cn.example')) throw new Error('timeout')
      return {
        version: '1.0.19',
        assets: [
          {
            name: 'Harness-Desktop-1.0.19-win-x64.exe',
            browser_download_url: 'https://github.example.test/setup.exe',
            mirror_urls: ['https://download.example.cn/setup.exe'],
            size: 123
          },
          {
            name: 'SHA256SUMS.txt',
            browser_download_url: 'https://github.example.test/SHA256SUMS.txt',
            mirror_urls: ['https://download.example.cn/SHA256SUMS.txt']
          }
        ]
      }
    }
  })
  assert.deepEqual(calls, ['https://cn.example.test/release.json', 'https://global.example.test/release.json'])
  assert.equal(result.source, 'https://global.example.test/release.json')
  assert.deepEqual(result.installer.urls, ['https://download.example.cn/setup.exe', 'https://github.example.test/setup.exe'])
  assert.equal(result.installer.url, 'https://download.example.cn/setup.exe')
})

test('desktop updater requires the installer hash from SHA256SUMS', () => {
  const name = 'Harness-Desktop-0.9.0-win-x64.exe'
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
  assert.equal(result.actionable, false)
  assert.equal(result.updatePolicy, 'desktop-bundled')
})

test('Harness upstream checker falls back when the domestic mirror is unavailable', async () => {
  const calls = []
  const result = await checkHarnessUpstream({
    currentVersion: '0.1.0-rc.6',
    manifestUrls: ['https://registry.example.cn/latest', 'https://registry.example.com/latest'],
    fetchJsonImpl: async url => {
      calls.push(url)
      if (url.endsWith('.cn/latest')) throw new Error('unreachable')
      return { version: '0.1.0-rc.7' }
    }
  })
  assert.equal(result.updateAvailable, true)
  assert.equal(result.source, 'https://registry.example.com/latest')
  assert.deepEqual(calls, ['https://registry.example.cn/latest', 'https://registry.example.com/latest'])
})
