const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const { createSignedDesktopReleaseManifest } = require('../electron/bridge/desktop-release-contract.cjs')
const { DEFAULT_APP_FEED, DEFAULT_UPSTREAM_MANIFEST, checkAppUpdate, checkHarnessUpstream, compareVersions, isAllowedUpdateRedirect, parseChecksumFile, parseReleasePayload, resolveUpdateRedirect, selectChecksumAsset, selectReleasePayload, selectDesktopInstallerAsset, selectWindowsInstallerAsset } = require('../electron/bridge/update-service.cjs')

const signing = generateKeyPairSync('ed25519')
const keyId = 'desktop-update-test'
const trustedKeys = { [keyId]: signing.publicKey.export({ type: 'spki', format: 'pem' }) }

function release(value = {}) {
  return {
    tag_name: value.tag_name || `v${value.version || '1.0.0'}`,
    name: value.name || 'Harness Desktop test',
    html_url: value.html_url || 'https://example.test/release',
    prerelease: value.prerelease === true,
    draft: value.draft === true,
    body: value.body || value.notes || '',
    assets: (value.assets || []).map(asset => ({
      ...asset,
      size: Number(asset.size || 1),
      sha256: asset.sha256 || 'a'.repeat(64),
      mirror_urls: Array.isArray(asset.mirror_urls) ? asset.mirror_urls : []
    }))
  }
}

function signed(releases) {
  const rows = (Array.isArray(releases) ? releases : [releases]).map(release)
  return createSignedDesktopReleaseManifest(rows, { keyId, privateKey: signing.privateKey })
}

function appOptions(options = {}) {
  return { trustedKeys, ...options }
}

test('desktop update checks use the repository manifest instead of the rate-limited Releases API', () => {
  assert.equal(DEFAULT_APP_FEED, 'https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/release-manifest.json')
  assert.doesNotMatch(DEFAULT_APP_FEED, /api\.github\.com/)
})

test('Harness update checks prefer the domestic npm mirror', () => {
  assert.match(DEFAULT_UPSTREAM_MANIFEST, /^https:\/\/registry\.npmmirror\.com\//)
})

test('compareVersions handles prerelease, patch, build metadata and identifier ordering', () => {
  assert.equal(compareVersions('0.8.1', '0.8.0'), 1)
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('0.1.0-rc.6', '0.1.0-rc.5'), 1)
  assert.equal(compareVersions('1.0.28+build.5', '1.0.28'), 0)
  assert.equal(compareVersions('v1.0.28+sha.abc', '1.0.28'), 0)
  assert.equal(compareVersions('1.0.28-rc.10', '1.0.28-rc.2'), 1)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1)
})

test('app update checker accepts a valid signed desktop release manifest', async () => {
  const assets = [
    { name: 'Harness-Desktop-0.9.0-win-x64.exe', browser_download_url: 'https://example.test/setup.exe', size: 123 },
    { name: 'Harness-Desktop-0.9.0-portable-x64.exe', browser_download_url: 'https://example.test/portable.exe', size: 120 },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 200 }
  ]
  const result = await checkAppUpdate(appOptions({ currentVersion: '0.8.0', platform: 'win32', arch: 'x64', feedUrl: 'https://example.test/latest', fetchJsonImpl: async () => signed({ tag_name: 'v0.9.0', body: 'notes', assets }) }))
  assert.equal(result.configured, true)
  assert.equal(result.updateAvailable, true)
  assert.equal(result.latestVersion, '0.9.0')
  assert.equal(result.url, 'https://example.test/release')
  assert.equal(result.installer.name, 'Harness-Desktop-0.9.0-win-x64.exe')
  assert.equal(result.checksums.name, 'SHA256SUMS.txt')
  assert.equal(selectWindowsInstallerAsset([result.installer]).url, 'https://example.test/setup.exe')
  assert.equal(selectChecksumAsset([result.checksums]).url, 'https://example.test/SHA256SUMS.txt')
  assert.equal(parseReleasePayload({ version: '1.0.0' }).version, '1.0.0')
})

test('production app update checker rejects unsigned, unknown-key and tampered manifests', async () => {
  const row = release({ version: '1.0.1' })
  await assert.rejects(checkAppUpdate(appOptions({ currentVersion: '1.0.0', fetchJsonImpl: async () => [row] })), /清单|协议|普通 JSON/)
  const unknown = createSignedDesktopReleaseManifest([row], { keyId: 'unknown-desktop-key', privateKey: signing.privateKey })
  await assert.rejects(checkAppUpdate(appOptions({ currentVersion: '1.0.0', fetchJsonImpl: async () => unknown })), /不受信任/)
  const tampered = signed(row)
  tampered[0].body = 'tampered after signing'
  await assert.rejects(checkAppUpdate(appOptions({ currentVersion: '1.0.0', fetchJsonImpl: async () => tampered })), /签名校验失败/)
})

test('app update checker selects native macOS installers by architecture', async () => {
  const assets = [
    { name: 'Harness Desktop-1.0.24-mac-x64.dmg', browser_download_url: 'https://example.test/x64.dmg', size: 100 },
    { name: 'Harness Desktop-1.0.24-mac-arm64.dmg', browser_download_url: 'https://example.test/arm64.dmg', size: 90 },
    { name: 'Harness-Desktop-1.0.24-win-x64.exe', browser_download_url: 'https://example.test/setup.exe', size: 120 },
    { name: 'SHA256SUMS.txt', browser_download_url: 'https://example.test/SHA256SUMS.txt', size: 200 }
  ]
  const result = await checkAppUpdate(appOptions({ currentVersion: '1.0.23', platform: 'darwin', arch: 'arm64', feedUrl: 'https://example.test/latest', fetchJsonImpl: async () => signed({ version: '1.0.24', assets }) }))
  assert.equal(result.installer.name, 'Harness Desktop-1.0.24-mac-arm64.dmg')
  assert.equal(selectDesktopInstallerAsset([result.installer], 'darwin', 'arm64').url, 'https://example.test/arm64.dmg')
})

test('app update checker falls back to the next signed manifest and prefers asset mirrors', async () => {
  const calls = []
  const result = await checkAppUpdate(appOptions({
    currentVersion: '1.0.18', platform: 'win32', arch: 'x64',
    feedUrls: ['https://cn.example.test/release.json', 'https://global.example.test/release.json'],
    fetchJsonImpl: async url => {
      calls.push(url)
      if (url.includes('cn.example')) throw new Error('timeout')
      return signed({ version: '1.0.19', assets: [
        { name: 'Harness-Desktop-1.0.19-win-x64.exe', browser_download_url: 'https://github.example.test/setup.exe', mirror_urls: ['https://download.example.cn/setup.exe'], size: 123 },
        { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.example.test/SHA256SUMS.txt', mirror_urls: ['https://download.example.cn/SHA256SUMS.txt'] }
      ] })
    }
  }))
  assert.deepEqual(calls, ['https://cn.example.test/release.json', 'https://global.example.test/release.json'])
  assert.equal(result.source, 'https://global.example.test/release.json')
  assert.deepEqual(result.installer.urls, ['https://download.example.cn/setup.exe', 'https://github.example.test/setup.exe'])
})

test('desktop update manifests and asset URLs require HTTPS before network use', async () => {
  let called = false
  await assert.rejects(checkAppUpdate(appOptions({ currentVersion: '1.0.0', feedUrl: 'http://example.test/latest', fetchJsonImpl: async () => { called = true; return {} } })), /HTTPS/)
  assert.equal(called, false)
  assert.throws(() => parseReleasePayload({ version: '1.0.1', assets: [{ name: 'Harness-Desktop-1.0.1-win-x64.exe', browser_download_url: 'http://example.test/setup.exe' }] }), /HTTPS/)
})

test('update redirects are bounded, remain HTTPS, and only migrate within approved sources', () => {
  assert.equal(isAllowedUpdateRedirect('https://github.com/example/release', 'https://release-assets.githubusercontent.com/example/file'), true)
  assert.equal(isAllowedUpdateRedirect('https://download.example.test/file', 'https://cdn.download.example.test/file'), true)
  assert.equal(isAllowedUpdateRedirect('https://cnb.cool/example/file', 'https://github.example/file', ['github.example']), true)
  assert.equal(isAllowedUpdateRedirect('https://download.example.test/file', 'https://evil.example/file'), false)
  assert.throws(() => resolveUpdateRedirect('https://download.example.test/file', 'http://download.example.test/file'), /HTTPS/)
  assert.throws(() => resolveUpdateRedirect('https://download.example.test/file', 'https://evil.example/file'), /跨来源/)
  assert.throws(() => resolveUpdateRedirect('https://download.example.test/file', '/again', { redirectCount: 5, maxRedirects: 5 }), /超过 5 次/)
})

test('desktop updater requires the installer hash from SHA256SUMS', () => {
  const name = 'Harness-Desktop-0.9.0-win-x64.exe'
  const digest = 'a'.repeat(64)
  assert.equal(parseChecksumFile(`${digest}  ${name}\n`, name), digest)
  assert.throws(() => parseChecksumFile(`${digest}  another.exe\n`, name), /SHA-256/)
})

test('app update checker selects prereleases only on the prerelease channel', async () => {
  const releases = [release({ tag_name: 'v1.1.0-rc.1', prerelease: true }), release({ tag_name: 'v1.0.0' })]
  assert.equal(selectReleasePayload(releases, 'stable').tag_name, 'v1.0.0')
  assert.equal(selectReleasePayload(releases, 'prerelease').tag_name, 'v1.1.0-rc.1')
  const result = await checkAppUpdate(appOptions({ currentVersion: '1.0.0', channel: 'prerelease', fetchJsonImpl: async () => signed(releases) }))
  assert.equal(result.updateAvailable, true)
  assert.equal(result.channel, 'prerelease')
})

test('Harness upstream checker never silently downgrades and preserves domestic fallback', async () => {
  const first = await checkHarnessUpstream({ currentVersion: '0.1.0-rc.6', fetchJsonImpl: async () => ({ version: '0.1.0-rc.5' }) })
  assert.equal(first.updateAvailable, false)
  assert.equal(first.aheadOfUpstream, true)
  const calls = []
  const result = await checkHarnessUpstream({ currentVersion: '0.1.0-rc.6', manifestUrls: ['https://registry.example.cn/latest', 'https://registry.example.com/latest'], fetchJsonImpl: async url => {
    calls.push(url)
    if (url.endsWith('.cn/latest')) throw new Error('unreachable')
    return { version: '0.1.0-rc.7' }
  } })
  assert.equal(result.updateAvailable, true)
  assert.deepEqual(calls, ['https://registry.example.cn/latest', 'https://registry.example.com/latest'])
})

test('app update checker rejects invalid signed versions and accepts build-equivalent versions', async () => {
  await assert.rejects(checkAppUpdate(appOptions({ currentVersion: '1.0.28', feedUrl: 'https://example.test/stale-feed', fetchJsonImpl: async () => signed({ tag_name: 'vbanana' }) })), /无效/)
  const result = await checkAppUpdate(appOptions({ currentVersion: '1.0.28', feedUrl: 'https://example.test/stale-feed', fetchJsonImpl: async () => signed({ tag_name: 'v1.0.28+build.5' }) }))
  assert.equal(result.latestVersion, '1.0.28+build.5')
  assert.equal(result.updateAvailable, false)
})
