const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const { normalizeComponentUpdateConfig, resolveComponentUpdateConfig } = require('../electron/bridge/component-update-config.cjs')

const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })

test('disabled component updater needs no release key', () => {
  assert.deepEqual(normalizeComponentUpdateConfig({ enabled: false }), {
    enabled: false,
    manifestUrls: [],
    trustedKeys: {},
    target: `${process.platform}-${process.arch}`
  })
})

test('enabled component updater requires signed HTTPS feed configuration', () => {
  assert.throws(() => normalizeComponentUpdateConfig({ enabled: true }), /必须配置/)
  assert.throws(() => normalizeComponentUpdateConfig({
    enabled: true,
    manifestUrls: ['http://example.com/components.json'],
    trustedKeys: { 'release-2026': publicKey }
  }), /HTTPS/)
  const config = normalizeComponentUpdateConfig({
    enabled: true,
    manifestUrls: ['https://cnb.example/components.json', 'https://github.example/components.json'],
    trustedKeys: { 'release-2026': publicKey }
  })
  assert.equal(config.enabled, true)
  assert.equal(config.manifestUrls.length, 2)
  assert.match(config.trustedKeys['release-2026'], /BEGIN PUBLIC KEY/)
})

test('platform-specific feeds keep macOS fallback installers architecture-correct', () => {
  const config = normalizeComponentUpdateConfig({
    enabled: true,
    manifestUrls: ['https://fallback.example/components.json'],
    targets: {
      'darwin-arm64': ['https://updates.example/darwin-arm64/components.json'],
      'darwin-x64': ['https://updates.example/darwin-x64/components.json']
    },
    trustedKeys: { 'release-2026': publicKey }
  }, { platform: 'darwin', arch: 'arm64' })
  assert.equal(config.target, 'darwin-arm64')
  assert.deepEqual(config.manifestUrls, ['https://updates.example/darwin-arm64/components.json'])
})

test('packaged component update config wins over app fallback', async () => {
  const payload = JSON.stringify({ enabled: false, manifestUrls: [], trustedKeys: {} })
  const reads = []
  const config = await resolveComponentUpdateConfig({
    resourcesPath: 'C:\\Resources',
    appRoot: 'C:\\App',
    readFileImpl: async file => {
      reads.push(file)
      if (file.includes('Resources')) return payload
      throw Object.assign(new Error('not found'), { code: 'ENOENT' })
    }
  })
  assert.equal(config.enabled, false)
  assert.equal(reads.length, 1)
  assert.match(config.source, /Resources/)
})
