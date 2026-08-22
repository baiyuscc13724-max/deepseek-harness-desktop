const test = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, sign } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const {
  canonicalJson,
  createComponentUpdatePlan,
  validateAndVerifyManifest,
  withoutSignature
} = require('../electron/bridge/component-update-contract.cjs')
const {
  ComponentUpdateStore,
  componentDirectoryName
} = require('../electron/bridge/component-update-store.cjs')

function signObject(value, privateKey) {
  value.signature = sign(null, Buffer.from(canonicalJson(withoutSignature(value))), privateKey).toString('base64')
  return value
}

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const component = signObject({
    id: 'desktop-shell',
    version: '1.0.24',
    kind: 'zip',
    target: 'shell',
    platform: 'win32',
    arch: 'x64',
    size: 12345,
    unpackedSize: 54321,
    sha256: 'a'.repeat(64),
    urls: [
      'https://cnb.example/releases/desktop-shell.zip',
      'https://github.example/releases/desktop-shell.zip'
    ],
    required: true,
    restart: true
  }, privateKey)
  const manifest = signObject({
    schemaVersion: 1,
    releaseVersion: '1.0.24',
    channel: 'stable',
    publishedAt: '2026-08-19T00:00:00.000Z',
    keyId: 'release-2026',
    bootstrap: { minVersion: '1.0.23' },
    components: [component],
    fallback: {
      version: '1.0.24',
      size: 23456,
      sha256: 'b'.repeat(64),
      urls: ['https://cnb.example/releases/Harness-Desktop-1.0.24.exe']
    },
    notes: 'component update fixture'
  }, privateKey)
  return {
    manifest,
    privateKey,
    trustedKeys: { 'release-2026': publicKey.export({ type: 'spki', format: 'pem' }) }
  }
}

test('signed component manifest verifies and selects only changed components', () => {
  const { manifest, trustedKeys } = fixture()
  const verified = validateAndVerifyManifest(manifest, trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') })
  const plan = createComponentUpdatePlan({
    manifest: verified,
    bootstrapVersion: '1.0.23',
    platform: 'win32',
    arch: 'x64',
    current: {
      'desktop-shell': { version: '1.0.23', sha256: 'c'.repeat(64) }
    }
  })
  assert.equal(plan.mode, 'components')
  assert.equal(plan.components.length, 1)
  assert.equal(plan.components[0].id, 'desktop-shell')
  assert.equal(plan.totalSize, 12345)
})

test('current or older component releases never reappear after a full desktop update', () => {
  const { manifest, trustedKeys } = fixture()
  const verified = validateAndVerifyManifest(manifest, trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') })

  for (const bootstrapVersion of ['1.0.24', '1.0.25']) {
    const plan = createComponentUpdatePlan({
      manifest: verified,
      bootstrapVersion,
      platform: 'win32',
      arch: 'x64',
      // A full installer can legitimately leave no component pointer, or retain
      // the pointer from an older incremental activation in user data.
      current: bootstrapVersion === '1.0.24'
        ? {}
        : { 'desktop-shell': { version: '1.0.23', sha256: 'c'.repeat(64) } }
    })
    assert.equal(plan.mode, 'none')
    assert.equal(plan.reason, 'release-not-newer')
    assert.equal(plan.releaseVersion, '1.0.24')
    assert.deepEqual(plan.components, [])
  }
})

test('manifest or component tampering is rejected', () => {
  const first = fixture()
  first.manifest.notes = 'tampered'
  assert.throws(
    () => validateAndVerifyManifest(first.manifest, first.trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') }),
    /签名校验失败/
  )

  const second = fixture()
  second.manifest.components[0].size += 1
  signObject(second.manifest, second.privateKey)
  assert.throws(
    () => validateAndVerifyManifest(second.manifest, second.trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') }),
    /组件 desktop-shell签名校验失败/
  )
})

test('unknown fields and insecure component URLs are rejected even when signed', () => {
  const unknown = fixture()
  unknown.manifest.untrustedBehavior = true
  signObject(unknown.manifest, unknown.privateKey)
  assert.throws(
    () => validateAndVerifyManifest(unknown.manifest, unknown.trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') }),
    /未知字段/
  )

  const insecure = fixture()
  insecure.manifest.components[0].urls = ['http://example.com/component.zip']
  signObject(insecure.manifest.components[0], insecure.privateKey)
  signObject(insecure.manifest, insecure.privateKey)
  assert.throws(
    () => validateAndVerifyManifest(insecure.manifest, insecure.trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') }),
    /HTTPS/
  )
})

test('incompatible bootstrap falls back to the full installer', () => {
  const { manifest, trustedKeys } = fixture()
  const verified = validateAndVerifyManifest(manifest, trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') })
  const plan = createComponentUpdatePlan({ manifest: verified, bootstrapVersion: '1.0.22', platform: 'win32', arch: 'x64' })
  assert.equal(plan.mode, 'full')
  assert.equal(plan.reason, 'bootstrap-incompatible')
  assert.equal(plan.fallback.version, '1.0.24')
})

test('same component version with a different hash is rejected', () => {
  const { manifest, trustedKeys } = fixture()
  const verified = validateAndVerifyManifest(manifest, trustedKeys, { now: Date.parse('2026-08-19T01:00:00.000Z') })
  assert.throws(() => createComponentUpdatePlan({
    manifest: verified,
    bootstrapVersion: '1.0.23',
    platform: 'win32',
    arch: 'x64',
    current: { 'desktop-shell': { version: '1.0.24', sha256: 'f'.repeat(64) } }
  }), /同版本出现不同哈希/)
})

test('component update store activates, confirms and rolls back immutable pointers', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-update-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new ComponentUpdateStore(root)
  const component = { id: 'desktop-shell', version: '1.0.24', sha256: 'a'.repeat(64) }
  const plan = { mode: 'components', releaseVersion: '1.0.24', components: [component] }

  let state = await store.beginStaging(plan, new Date('2026-08-19T00:00:00.000Z'))
  assert.equal(state.phase, 'staging')
  assert.equal(state.pending.components[0].directory, componentDirectoryName(component))
  state = await store.markReady()
  assert.equal(state.phase, 'ready')
  state = await store.markApplying()
  assert.equal(state.phase, 'applying')
  state = await store.activatePending()
  assert.equal(state.phase, 'awaiting-health')
  assert.equal((await store.pointer()).releaseVersion, '1.0.24')
  state = await store.confirmHealthy()
  assert.equal(state.phase, 'idle')
  assert.equal(state.lastKnownGood.releaseVersion, '1.0.24')

  const pointerText = await readFile(path.join(root, 'current.json'), 'utf8')
  assert.match(pointerText, /desktop-shell-1\.0\.24-aaaaaaaaaaaaaaaa/)
})

test('component update store restores last-known-good after failed health check', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-rollback-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new ComponentUpdateStore(root)
  const first = { id: 'desktop-shell', version: '1.0.23', sha256: '1'.repeat(64) }
  await store.beginStaging({ mode: 'components', releaseVersion: '1.0.23', components: [first] })
  await store.markReady()
  await store.markApplying()
  await store.activatePending()
  await store.confirmHealthy()

  const second = { id: 'desktop-shell', version: '1.0.24', sha256: '2'.repeat(64) }
  await store.beginStaging({ mode: 'components', releaseVersion: '1.0.24', components: [second] })
  await store.markReady()
  await store.markApplying()
  await store.activatePending()
  await store.requireRollback(new Error('self-test failed'))
  const state = await store.rollback()

  assert.equal(state.phase, 'failed')
  assert.equal(state.active.releaseVersion, '1.0.23')
  assert.equal((await store.pointer()).releaseVersion, '1.0.23')
})
