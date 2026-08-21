const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const {
  DESKTOP_RELEASE_MANIFEST_KIND,
  createSignedDesktopReleaseManifest,
  validateAndVerifyDesktopReleaseManifest
} = require('../electron/bridge/desktop-release-contract.cjs')

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = 'desktop-test-key'
  const trustedKeys = { [keyId]: publicKey.export({ type: 'spki', format: 'pem' }) }
  const release = {
    tag_name: 'v1.2.3',
    name: 'Harness Desktop 1.2.3',
    html_url: 'https://github.example/releases/v1.2.3',
    prerelease: false,
    draft: false,
    body: 'notes',
    assets: [{
      name: 'Harness-Desktop-1.2.3-win-x64.exe',
      browser_download_url: 'https://github.example/setup.exe',
      size: 123,
      sha256: 'a'.repeat(64),
      mirror_urls: ['https://cnb.example/setup.exe']
    }]
  }
  return { keyId, privateKey, release, trustedKeys }
}

test('desktop release manifest adds domain-separated Ed25519 fields to compatible release records', () => {
  const { keyId, privateKey, release, trustedKeys } = fixture()
  const manifest = createSignedDesktopReleaseManifest([release], { keyId, privateKey })
  const verified = validateAndVerifyDesktopReleaseManifest(manifest, trustedKeys)
  assert.equal(verified[0].kind, DESKTOP_RELEASE_MANIFEST_KIND)
  assert.equal(verified[0].tag_name, 'v1.2.3')
  assert.match(verified[0].signature, /^[A-Za-z0-9+/]+={0,2}$/)
})

test('desktop release manifest fails closed for missing signatures and unknown keys', () => {
  const { keyId, privateKey, release, trustedKeys } = fixture()
  const manifest = createSignedDesktopReleaseManifest([release], { keyId, privateKey })
  const { signature, ...unsigned } = manifest[0]
  assert.throws(() => validateAndVerifyDesktopReleaseManifest([unsigned], trustedKeys), /签名/)
  assert.throws(() => validateAndVerifyDesktopReleaseManifest([{ ...manifest[0], keyId: 'unknown-key' }], trustedKeys), /不受信任/)
})

test('desktop release contract requires HTTPS release, asset and mirror URLs', () => {
  const { keyId, privateKey, release } = fixture()
  assert.throws(() => createSignedDesktopReleaseManifest([{ ...release, html_url: 'http://github.example/releases/v1.2.3' }], { keyId, privateKey }), /HTTPS/)
  assert.throws(() => createSignedDesktopReleaseManifest([{ ...release, assets: [{ ...release.assets[0], browser_download_url: 'https://user:pass@github.example/setup.exe' }] }], { keyId, privateKey }), /HTTPS/)
  assert.throws(() => createSignedDesktopReleaseManifest([{ ...release, assets: [{ ...release.assets[0], mirror_urls: ['http://cnb.example/setup.exe'] }] }], { keyId, privateKey }), /HTTPS/)
})

test('desktop release manifest rejects signed payload tampering', () => {
  const { keyId, privateKey, release, trustedKeys } = fixture()
  const manifest = createSignedDesktopReleaseManifest([release], { keyId, privateKey })
  const tampered = JSON.parse(JSON.stringify(manifest))
  tampered[0].assets[0].browser_download_url = 'https://attacker.example/setup.exe'
  assert.throws(() => validateAndVerifyDesktopReleaseManifest(tampered, trustedKeys), /签名校验失败/)
})
