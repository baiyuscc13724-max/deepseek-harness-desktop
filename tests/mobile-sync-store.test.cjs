const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { MobileSyncStore, normalizeState, DEFAULT_SERVICE_ADDRESS, STATE_SCHEMA_VERSION } = require('../electron/store/mobile-sync-store.cjs')

function secretAdapter() {
  const transform = value => Buffer.from(value).map(byte => byte ^ 0xa5)
  return {
    protect: plaintext => transform(Buffer.from(String(plaintext), 'utf8')),
    unprotect: ciphertext => transform(Buffer.from(ciphertext)).toString('utf8')
  }
}

function meshFixture(overrides = {}) {
  return {
    networkName: 'harness-0123456789abcdef',
    networkSecret: 'n'.repeat(43),
    desktopAddress: '10.254.77.1',
    serviceAddress: DEFAULT_SERVICE_ADDRESS,
    ...overrides
  }
}

test('MobileSyncStore persists safe pairing records and only encrypted mesh secrets', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-store-'))
  const file = path.join(directory, 'mobile-sync.json')
  const adapter = secretAdapter()
  const store = new MobileSyncStore(file, adapter)
  store.setEnabled(true)
  store.setRemoteEnabled(false)
  store.setTransportPreference('tailscale')
  store.setPreferredPort(4567)
  const mesh = store.ensureMesh(() => meshFixture())
  store.addDevice({
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: ' Pixel 9\u0000 ',
    platform: 'android',
    deviceClass: 'phone',
    appVersion: '1.0.20',
    createdAt: '2026-08-17T01:02:03.000Z',
    lastSeenAt: null
  })
  const serialized = readFileSync(file, 'utf8')
  const disk = JSON.parse(serialized)
  assert.equal(disk.schemaVersion, STATE_SCHEMA_VERSION)
  assert.equal(disk.mesh.networkSecret, undefined)
  assert.equal(disk.mesh.relayRoomId, undefined)
  assert.equal(disk.mesh.relayTunnelKey, undefined)
  assert.deepEqual(Object.keys(disk.mesh.secretEnvelope).sort(), ['ciphertext', 'encoding', 'version'])
  assert.doesNotMatch(serialized, new RegExp(mesh.networkSecret))

  const restored = new MobileSyncStore(file, adapter).get()
  assert.equal(restored.schemaVersion, STATE_SCHEMA_VERSION)
  assert.equal(restored.enabled, true)
  assert.equal(restored.remoteEnabled, false)
  assert.equal(restored.transportPreference, 'tailscale')
  assert.equal(restored.preferredPort, 4567)
  assert.deepEqual(restored.mesh, mesh)
  assert.deepEqual(restored.devices[0], {
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: 'Pixel 9',
    platform: 'android',
    deviceClass: 'phone',
    appVersion: '1.0.20',
    createdAt: '2026-08-17T01:02:03.000Z',
    lastSeenAt: null
  })
})

test('normalizeState migrates the legacy mapped service address out of the node subnet', () => {
  const state = normalizeState({ mesh: meshFixture({ serviceAddress: '10.254.77.254' }) })
  assert.equal(state.mesh.serviceAddress, DEFAULT_SERVICE_ADDRESS)
})

test('legacy plaintext state is immediately migrated to an encrypted versioned envelope', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-plaintext-migration-'))
  const file = path.join(directory, 'mobile-sync.json')
  const legacy = {
    schemaVersion: 3,
    enabled: true,
    remoteEnabled: true,
    preferredPort: 3081,
    mesh: meshFixture({
      serviceAddress: '10.254.77.254',
      relayRoomId: 'r'.repeat(43),
      relayTunnelKey: 'k'.repeat(43)
    }),
    devices: []
  }
  writeFileSync(file, JSON.stringify(legacy), { mode: 0o600 })
  const store = new MobileSyncStore(file, secretAdapter())
  assert.equal(store.get().mesh.serviceAddress, DEFAULT_SERVICE_ADDRESS)
  assert.equal(store.get().mesh.relayTunnelKey, 'k'.repeat(43))
  const migratedText = readFileSync(file, 'utf8')
  const migrated = JSON.parse(migratedText)
  assert.equal(migrated.schemaVersion, STATE_SCHEMA_VERSION)
  assert.equal(migrated.mesh.serviceAddress, DEFAULT_SERVICE_ADDRESS)
  assert.ok(migrated.mesh.secretEnvelope.ciphertext)
  for (const secret of [legacy.mesh.networkSecret, legacy.mesh.relayRoomId, legacy.mesh.relayTunnelKey]) {
    assert.equal(migratedText.includes(secret), false)
  }
})

test('existing EasyTier identities gain WSS relay secrets without changing the mesh', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-relay-migration-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file, secretAdapter())
  const first = store.ensureMesh(() => meshFixture())
  const migrated = store.ensureMesh(() => ({
    networkName: 'unused-new-network-name',
    networkSecret: 'b'.repeat(43),
    desktopAddress: '10.254.77.9',
    serviceAddress: '10.253.77.253',
    relayRoomId: 'r'.repeat(43),
    relayTunnelKey: 'k'.repeat(43)
  }))
  assert.equal(migrated.networkName, first.networkName)
  assert.equal(migrated.networkSecret, first.networkSecret)
  assert.equal(migrated.relayRoomId, 'r'.repeat(43))
  assert.equal(migrated.relayTunnelKey, 'k'.repeat(43))
  store.setTransportPreference('wss-relay')
  assert.equal(store.get().transportPreference, 'wss-relay')
  const serialized = readFileSync(file, 'utf8')
  assert.equal(serialized.includes(first.networkSecret), false)
  assert.equal(serialized.includes(migrated.relayTunnelKey), false)
})

test('secret protection unavailable never creates or loads plaintext mesh secrets', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-no-protection-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  assert.throws(() => store.ensureMesh(() => meshFixture()), /protection is unavailable/)
  assert.equal(store.get().mesh, null)
  assert.equal(existsSync(file), false)

  writeFileSync(file, JSON.stringify({ schemaVersion: 3, mesh: meshFixture() }), { mode: 0o600 })
  assert.throws(() => new MobileSyncStore(file), /require OS-backed encryption/)
})

test('protected state fails closed when its envelope or decryption is damaged', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-corrupt-envelope-'))
  const file = path.join(directory, 'mobile-sync.json')
  const adapter = secretAdapter()
  new MobileSyncStore(file, adapter).ensureMesh(() => meshFixture())
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  disk.mesh.secretEnvelope.ciphertext = 'not-base64'
  writeFileSync(file, JSON.stringify(disk), { mode: 0o600 })
  assert.throws(() => new MobileSyncStore(file, adapter), /corrupt|decrypt/i)

  disk.mesh.secretEnvelope.ciphertext = Buffer.from('valid-ciphertext').toString('base64')
  writeFileSync(file, JSON.stringify(disk), { mode: 0o600 })
  const leaked = 'plaintext-secret-must-not-echo'
  assert.throws(
    () => new MobileSyncStore(file, { protect: adapter.protect, unprotect: () => { throw new Error(leaked) } }),
    error => /Unable to decrypt/.test(error.message) && !error.message.includes(leaked)
  )

  const fresh = path.join(directory, 'protect-failure.json')
  const store = new MobileSyncStore(fresh, { protect: () => { throw new Error(leaked) }, unprotect: adapter.unprotect })
  assert.throws(
    () => store.ensureMesh(() => meshFixture()),
    error => /Unable to protect/.test(error.message) && !error.message.includes(leaked)
  )
  assert.equal(existsSync(fresh), false)
})

test('invalid state errors never echo file contents', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-invalid-state-'))
  const file = path.join(directory, 'mobile-sync.json')
  const leaked = 'plaintext-secret-must-not-echo'
  writeFileSync(file, `{\"mesh\":${leaked}}`, { mode: 0o600 })
  assert.throws(
    () => new MobileSyncStore(file, secretAdapter()),
    error => /Unable to read mobile sync state/.test(error.message) && !error.message.includes(leaked)
  )
})

test('Electron main only injects the safeStorage adapter when OS encryption is available', () => {
  const main = readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /safeStorage\.isEncryptionAvailable\(\)/)
  assert.match(main, /protect: plaintext => safeStorage\.encryptString/)
  assert.match(main, /unprotect: ciphertext => safeStorage\.decryptString/)
  assert.match(main, /new MobileSyncStore\(path\.join\(userData, 'mobile-sync\.json'\), mobileSyncSecretAdapter\(\)\)/)
})

test('normalizeState drops malformed secrets and invalid ports', () => {
  const state = normalizeState({
    enabled: 1,
    preferredPort: 80,
    devices: [
      { id: '../../escape', secretHash: 'bad' },
      { id: 'fedcba9876543210', secretHash: 'b'.repeat(64), name: 'OK' }
    ]
  })
  assert.equal(state.enabled, false)
  assert.equal(state.preferredPort, 3081)
  assert.equal(state.devices.length, 1)
  assert.equal(state.devices[0].name, 'OK')
  assert.equal(state.devices[0].platform, 'unknown')
  assert.equal(state.devices[0].deviceClass, 'unknown')
  assert.equal(state.devices[0].appVersion, null)
  assert.equal(state.remoteEnabled, true)
  assert.equal(state.transportPreference, 'auto')
})
