const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync } = require('node:crypto')
const { mkdir, mkdtemp, rename, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { ComponentUpdateStore, componentDirectoryName } = require('../electron/bridge/component-update-store.cjs')
const { ComponentUpdateService, safeManifestUrl } = require('../electron/bridge/component-update-service.cjs')
const { createSignedComponentDescriptor, createSignedReleaseManifest } = require('../electron/bridge/component-update-builder.cjs')

function signedFixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const shell = createSignedComponentDescriptor({
    id: 'desktop-shell', version: '1.0.24', target: 'shell', platform: 'win32', arch: 'x64',
    archive: { size: 100, unpackedSize: 200, sha256: 'a'.repeat(64) },
    urls: ['https://cnb.example/desktop-shell.zip', 'https://github.example/desktop-shell.zip']
  }, privateKey)
  const plugins = createSignedComponentDescriptor({
    id: 'desktop-plugins', version: '1.0.23', target: 'plugins', platform: 'win32', arch: 'x64',
    archive: { size: 50, unpackedSize: 75, sha256: 'b'.repeat(64) },
    urls: ['https://cnb.example/desktop-plugins.zip']
  }, privateKey)
  const manifest = createSignedReleaseManifest({
    releaseVersion: '1.0.24', keyId: 'release-2026', publishedAt: '2026-08-19T00:00:00.000Z',
    bootstrap: { minVersion: '1.0.23' }, components: [shell, plugins]
  }, privateKey)
  return {
    manifest,
    trustedKeys: { 'release-2026': publicKey.export({ type: 'spki', format: 'pem' }) },
    shell,
    plugins
  }
}

test('component manifest sources must be strict HTTPS URLs', () => {
  assert.throws(() => safeManifestUrl('http://example.com/components.json'), /HTTPS/)
  assert.throws(() => safeManifestUrl('https://user:pass@example.com/components.json'), /无凭据/)
  assert.equal(safeManifestUrl('https://example.com/components.json'), 'https://example.com/components.json')
})

test('check falls back across signed manifest sources and preserves unchanged components', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = signedFixture()
  const store = new ComponentUpdateStore(root)
  const pluginBaseline = {
    version: '1.0.23',
    sha256: fixture.plugins.sha256,
    directory: componentDirectoryName(fixture.plugins)
  }
  const service = new ComponentUpdateService({
    store,
    manifestUrls: ['https://cnb.example/components.json', 'https://github.example/components.json'],
    trustedKeys: fixture.trustedKeys,
    bootstrapVersion: '1.0.23',
    platform: 'win32',
    arch: 'x64',
    baselineComponents: {
      'desktop-shell': { version: '1.0.23', sha256: 'c'.repeat(64), directory: 'desktop-shell-1.0.23-cccccccccccccccc' },
      'desktop-plugins': pluginBaseline
    },
    fetchJson: async url => {
      if (url.includes('cnb.example')) return { ...fixture.manifest, notes: 'tampered mirror' }
      return fixture.manifest
    }
  })

  const result = await service.check({ now: Date.parse('2026-08-19T01:00:00.000Z') })
  assert.equal(result.source, 'https://github.example/components.json')
  assert.equal(result.plan.mode, 'components')
  assert.deepEqual(result.plan.components.map(component => component.id), ['desktop-shell'])
  assert.equal(result.plan.desiredComponents.length, 2)
})

test('stage downloads only changed components and marks the full desired pointer ready', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-stage-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = signedFixture()
  const store = new ComponentUpdateStore(root)
  const calls = { downloads: [], commits: [], progress: [] }
  const service = new ComponentUpdateService({
    store,
    manifestUrls: ['https://cnb.example/components.json'],
    trustedKeys: fixture.trustedKeys,
    bootstrapVersion: '1.0.23',
    platform: 'win32', arch: 'x64',
    baselineComponents: {
      'desktop-shell': { version: '1.0.23', sha256: 'c'.repeat(64), directory: 'desktop-shell-1.0.23-cccccccccccccccc' },
      'desktop-plugins': { version: '1.0.23', sha256: fixture.plugins.sha256, directory: componentDirectoryName(fixture.plugins) }
    },
    fetchJson: async () => fixture.manifest,
    downloadImpl: async options => {
      calls.downloads.push(options)
      await writeFile(options.destination, 'archive')
      return { size: options.expectedSize, sha256: options.expectedHash }
    },
    extractImpl: async ({ destination }) => { await mkdir(destination, { recursive: true }) },
    commitImpl: async ({ source, destination, descriptor }) => {
      calls.commits.push({ destination, descriptor })
      await mkdir(path.dirname(destination), { recursive: true })
      await rename(source, destination)
    }
  })
  const checked = await service.check({ now: Date.parse('2026-08-19T01:00:00.000Z') })
  const result = await service.stage(checked, progress => calls.progress.push(progress))

  assert.equal(calls.downloads.length, 1)
  assert.equal(calls.downloads[0].expectedHash, fixture.shell.sha256)
  assert.equal(calls.commits.length, 1)
  assert.equal(result.state.phase, 'ready')
  assert.deepEqual(result.state.pending.components.map(component => component.id).sort(), ['desktop-plugins', 'desktop-shell'])
  assert.equal(calls.progress.at(-1).phase, 'ready')
})

test('staging failure is persisted and never becomes ready', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-failure-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = signedFixture()
  const store = new ComponentUpdateStore(root)
  const service = new ComponentUpdateService({
    store,
    manifestUrls: ['https://cnb.example/components.json'],
    trustedKeys: fixture.trustedKeys,
    bootstrapVersion: '1.0.23',
    platform: 'win32', arch: 'x64',
    fetchJson: async () => fixture.manifest,
    downloadImpl: async () => { throw new Error('network failed') }
  })
  const checked = await service.check({ now: Date.parse('2026-08-19T01:00:00.000Z') })
  await assert.rejects(() => service.stage(checked), /network failed/)
  const state = await store.get()
  assert.equal(state.phase, 'failed')
  assert.match(state.failure.message, /network failed/)
  assert.equal(state.pending, null)
})
