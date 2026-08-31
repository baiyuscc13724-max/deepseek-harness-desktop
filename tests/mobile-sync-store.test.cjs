const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { MobileSyncStore, normalizeState, DEFAULT_SERVICE_ADDRESS, STATE_SCHEMA_VERSION, SYNC_PROTOCOL_VERSION } = require('../electron/store/mobile-sync-store.cjs')

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

test('workspace manifest persists only bounded non-sensitive project, session, and read metadata', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-manifest-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file, secretAdapter())
  const committed = store.commitSyncManifest({
    complete: true,
    operationId: 'initial-authoritative-snapshot',
    observedAt: '2026-08-30T12:00:00.000Z',
    workspaces: [{ workspaceId: 'workspace-one', title: 'Project One', path: 'D:\\Private\\project', token: 'WORKSPACE_TOKEN' }],
    sessions: [{ sessionId: 'session-one', workspaceId: 'workspace-one', title: 'Session One', status: 'idle', transcript: 'PRIVATE_BODY', credential: 'SESSION_TOKEN' }],
    readMessages: [{ sessionId: 'session-one', messageId: 'message-one', readAt: '2026-08-30T11:59:00.000Z', body: 'PRIVATE_BODY' }]
  })
  assert.equal(committed.schemaVersion, SYNC_PROTOCOL_VERSION)
  assert.equal(Number.isSafeInteger(committed.snapshotEpoch), true)
  assert.ok(committed.snapshotEpoch >= 0)
  assert.equal(committed.revision, 1)
  assert.match(committed.cursor, /^[A-Za-z0-9_-]{16,128}$/)
  assert.equal(committed.complete, true)
  assert.deepEqual(committed.snapshot.workspaces, [{ workspaceId: 'workspace-one', title: 'Project One' }])
  assert.deepEqual(committed.snapshot.sessions, [{ sessionId: 'session-one', workspaceId: 'workspace-one', title: 'Session One', status: 'idle' }])
  assert.deepEqual(committed.snapshot.readMessages, [{ sessionId: 'session-one', messageId: 'message-one', readAt: '2026-08-30T11:59:00.000Z' }])
  const serialized = readFileSync(file, 'utf8')
  for (const forbidden of ['D:\\Private', 'WORKSPACE_TOKEN', 'SESSION_TOKEN', 'PRIVATE_BODY', 'credential', 'transcript']) assert.equal(serialized.includes(forbidden), false)

  const reopened = new MobileSyncStore(file, secretAdapter()).readSyncChanges()
  assert.equal(reopened.snapshotEpoch, committed.snapshotEpoch)
  assert.equal(reopened.revision, committed.revision)
  assert.equal(reopened.cursor, committed.cursor)
  assert.deepEqual(reopened.snapshot, committed.snapshot)
})

test('temporary empty results cannot replace a valid manifest and deletion requires an explicit tombstone', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-empty-guard-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file, secretAdapter())
  const first = store.commitSyncManifest({
    complete: true,
    operationId: 'snapshot-one',
    workspaces: [{ workspaceId: 'workspace-one', title: 'Project' }],
    sessions: [{ sessionId: 'session-one', workspaceId: 'workspace-one', title: 'Session' }]
  })
  const diskBefore = readFileSync(file, 'utf8')
  const guarded = store.commitSyncManifest({ complete: true, operationId: 'transient-empty', workspaces: [{ workspaceId: 'workspace-one', title: 'Project' }], sessions: [] })
  assert.equal(guarded.protected, true)
  assert.equal(guarded.complete, false)
  assert.equal(guarded.revision, first.revision)
  assert.equal(guarded.cursor, first.cursor)
  assert.equal(readFileSync(file, 'utf8'), diskBefore, 'incomplete observations never touch durable state')
  assert.equal(store.readSyncChanges().snapshot.sessions.length, 1)

  const deleted = store.commitSyncManifest({
    complete: true,
    operationId: 'explicit-session-delete',
    workspaces: [{ workspaceId: 'workspace-one', title: 'Project' }],
    sessions: [],
    tombstones: [{ kind: 'session', id: 'session-one' }]
  })
  assert.equal(deleted.protected, false)
  assert.equal(deleted.revision, first.revision + 1)
  assert.deepEqual(store.readSyncChanges().snapshot.sessions, [])
  assert.deepEqual(store.readSyncChanges().snapshot.tombstones.map(({ kind, id }) => ({ kind, id })), [{ kind: 'session', id: 'session-one' }])
})

test('same-epoch incremental cursors are resumable and operation ids are short-term idempotency keys', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-cursor-'))
  const store = new MobileSyncStore(path.join(directory, 'mobile-sync.json'), secretAdapter())
  const first = store.commitSyncManifest({ complete: true, operationId: 'base', workspaces: [], sessions: [] })
  const secondInput = {
    complete: false,
    operationId: 'increment-one',
    snapshotEpoch: first.snapshotEpoch,
    revision: first.revision + 1,
    sessions: [{ sessionId: 'session-two', title: 'Second' }]
  }
  const second = store.commitSyncManifest(secondInput)
  assert.equal(second.revision, first.revision + 1)
  const resumed = store.readSyncChanges({ snapshotEpoch: first.snapshotEpoch, cursor: first.cursor })
  assert.equal(resumed.resetRequired, false)
  assert.equal(resumed.snapshot, null)
  assert.equal(resumed.changes.length, 1)
  assert.equal(resumed.changes[0].revision, second.revision)
  assert.equal(resumed.changes[0].sessions[0].sessionId, 'session-two')

  const duplicate = store.commitSyncManifest(secondInput)
  assert.equal(duplicate.applied, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(store.readSyncChanges().revision, second.revision)
  assert.throws(() => store.commitSyncManifest({ ...secondInput, sessions: [{ sessionId: 'different' }] }), error => error.code === 'MOBILE_SYNC_OPERATION_CONFLICT')
  assert.throws(() => store.commitSyncManifest({ complete: false, operationId: 'wrong-epoch', snapshotEpoch: first.snapshotEpoch + 1, revision: second.revision + 1, sessions: [{ sessionId: 'third' }] }), error => error.code === 'MOBILE_SYNC_EPOCH_CONFLICT')
  const stale = store.readSyncChanges({ snapshotEpoch: first.snapshotEpoch + 1, cursor: first.cursor })
  assert.equal(stale.resetRequired, true)
  assert.ok(stale.snapshot)
  for (const request of [
    { snapshotEpoch: first.snapshotEpoch },
    { cursor: first.cursor },
    { snapshotEpoch: first.snapshotEpoch, cursor: 'A'.repeat(24) }
  ]) {
    const reset = store.readSyncChanges(request)
    assert.equal(reset.resetRequired, true)
    assert.ok(reset.snapshot)
    assert.deepEqual(reset.changes, [])
  }
})
