const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const {
  ATOMIC_WRITE_PHASES,
  LEGACY_STATE_SCHEMA_VERSION,
  MobileSyncStore,
  normalizeState,
  DEFAULT_SERVICE_ADDRESS,
  STATE_SCHEMA_VERSION,
  SYNC_EVENT_LIMIT,
  SYNC_JOURNAL_BYTE_LIMIT,
  SYNC_PROTOCOL_VERSION,
  V5_BACKUP_SUFFIX,
  V6_STORAGE_FORMAT,
  canonicalStateHash
} = require('../electron/store/mobile-sync-store.cjs')

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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function applyOfflineChanges(snapshot, changes) {
  const workspaces = new Map(snapshot.workspaces.map(item => [item.workspaceId, cloneJson(item)]))
  const sessions = new Map(snapshot.sessions.map(item => [item.sessionId, cloneJson(item)]))
  const readMessages = new Map(snapshot.readMessages.map(item => [`${item.sessionId}:${item.messageId}`, cloneJson(item)]))
  const tombstones = new Map(snapshot.tombstones.map(item => [`${item.kind}:${item.id}`, cloneJson(item)]))
  for (const change of changes) {
    for (const item of change.workspaces) workspaces.set(item.workspaceId, cloneJson(item))
    for (const item of change.sessions) sessions.set(item.sessionId, cloneJson(item))
    for (const item of change.readMessages) readMessages.set(`${item.sessionId}:${item.messageId}`, cloneJson(item))
    for (const tombstone of change.tombstones) {
      tombstones.set(`${tombstone.kind}:${tombstone.id}`, cloneJson(tombstone))
      if (tombstone.kind === 'workspace') {
        workspaces.delete(tombstone.id)
        const cascaded = [...sessions.values()].filter(item => item.workspaceId === tombstone.id).map(item => item.sessionId)
        for (const sessionId of cascaded) {
          sessions.delete(sessionId)
          for (const [key, item] of readMessages) if (item.sessionId === sessionId) readMessages.delete(key)
        }
      } else if (tombstone.kind === 'session') {
        sessions.delete(tombstone.id)
        for (const [key, item] of readMessages) if (item.sessionId === tombstone.id) readMessages.delete(key)
      } else {
        readMessages.delete(tombstone.id)
      }
    }
    for (const item of workspaces.values()) tombstones.delete(`workspace:${item.workspaceId}`)
    for (const item of sessions.values()) tombstones.delete(`session:${item.sessionId}`)
    for (const item of readMessages.values()) tombstones.delete(`read-message:${item.sessionId}:${item.messageId}`)
  }
  return {
    workspaces: [...workspaces.values()],
    sessions: [...sessions.values()],
    readMessages: [...readMessages.values()],
    tombstones: [...tombstones.values()]
  }
}

function crashOnceAt(expectedPoint) {
  let armed = true
  return point => {
    if (armed && point === expectedPoint) {
      armed = false
      throw new Error(`simulated crash at ${point}`)
    }
  }
}

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)]
}

function measureSamples(count, operation) {
  const samples = []
  for (let index = 0; index < count; index++) {
    const started = performance.now()
    operation(index)
    samples.push(performance.now() - started)
  }
  return samples
}

test('v6 stores one canonical snapshot and only bounded lossless deltas while get returns one immutable projection', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-v6-layout-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const sessions = Array.from({ length: 1307 }, (_, index) => ({
    sessionId: `session-${index}`,
    workspaceId: 'workspace-one',
    title: `Session ${index}`,
    status: 'idle'
  }))
  const baseline = store.commitSyncManifest({
    complete: true,
    operationId: 'layout-baseline',
    workspaces: [{ workspaceId: 'workspace-one', title: 'Project' }],
    sessions
  })
  sessions[723] = { ...sessions[723], title: 'Only changed session' }
  const changed = store.commitSyncManifest({
    complete: true,
    operationId: 'layout-one-change',
    workspaces: [{ workspaceId: 'workspace-one', title: 'Project' }],
    sessions
  })

  const disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.schemaVersion, STATE_SCHEMA_VERSION)
  assert.equal(disk.storageFormat, V6_STORAGE_FORMAT)
  assert.equal(disk.sync.workspaces, undefined)
  assert.equal(disk.sync.events, undefined)
  assert.equal(disk.sync.canonicalSnapshot.sessions.length, 1307)
  assert.equal(disk.sync.deltaJournal.length, 2)
  assert.equal(disk.sync.deltaJournal[1].sessions.length, 1)
  assert.equal(disk.sync.deltaJournal[1].sessions[0].sessionId, 'session-723')
  assert.equal(disk.sync.deltaJournal[1].workspaces.length, 0)
  assert.match(disk.sync.canonicalHash, /^[a-f0-9]{64}$/)

  store.addDevice({
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: 'Runtime record phone',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: null
  })
  const mainBeforeRuntimeRecords = readFileSync(file, 'utf8')
  store.touchDevice('0123456789abcdef', new Date('2026-09-01T00:01:00.000Z'))
  store.setPreferredPort(4567)
  assert.equal(readFileSync(file, 'utf8'), mainBeforeRuntimeRecords, 'heartbeat and preferred-port updates must not rewrite the canonical ledger')
  assert.ok(statSync(store.runtimeFile).size < 2048, 'the runtime record stays small and bounded')

  const firstProjection = store.get()
  assert.strictEqual(store.get(), firstProjection)
  assert.equal(Object.isFrozen(firstProjection), true)
  assert.equal(Object.isFrozen(firstProjection.sync.sessions), true)
  assert.strictEqual(store.readSyncChanges().snapshot.sessions, firstProjection.sync.sessions)
  assert.deepEqual(store.readSyncChanges({ snapshotEpoch: baseline.snapshotEpoch, cursor: baseline.cursor }).changes.map(event => event.cursor), [changed.cursor])
})

test('v5 migration preserves an exact read-only backup, reverse export, encrypted secrets, and flag rollback', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-v5-roundtrip-'))
  const file = path.join(directory, 'mobile-sync.json')
  const adapter = secretAdapter()
  const legacy = new MobileSyncStore(file, adapter, { storageMode: 'v5' })
  assert.equal(legacy.get().schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  legacy.ensureMesh(() => meshFixture({ relayRoomId: 'r'.repeat(43), relayTunnelKey: 'k'.repeat(43) }))
  legacy.addDevice({
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: 'Roundtrip phone',
    platform: 'android',
    deviceClass: 'phone',
    appVersion: '1.0.58',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: null
  })
  const baseline = legacy.commitSyncManifest({
    complete: true,
    operationId: 'roundtrip-base',
    workspaces: [{ workspaceId: 'workspace-one', title: 'One' }],
    sessions: [{ sessionId: 'session-one', workspaceId: 'workspace-one', title: 'One' }],
    readMessages: [{ sessionId: 'session-one', messageId: 'message-one', readAt: '2026-09-01T00:01:00.000Z' }]
  })
  legacy.commitSyncManifest({
    complete: false,
    operationId: 'roundtrip-update',
    snapshotEpoch: baseline.snapshotEpoch,
    revision: baseline.revision + 1,
    sessions: [{ sessionId: 'session-two', workspaceId: 'workspace-one', title: 'Two' }]
  })
  legacy.touchDevice('0123456789abcdef', new Date('2026-09-01T00:02:00.000Z'))
  legacy.setPreferredPort(4567)
  const expectedHash = canonicalStateHash(legacy.get())
  const legacyBytes = readFileSync(file, 'utf8')
  assert.equal(JSON.parse(legacyBytes).schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  assert.doesNotMatch(legacyBytes, new RegExp(legacy.get().mesh.networkSecret))

  const migrated = new MobileSyncStore(file, adapter)
  const backup = `${file}${V5_BACKUP_SUFFIX}`
  assert.equal(readFileSync(backup, 'utf8'), legacyBytes)
  if (process.platform !== 'win32') assert.equal(statSync(backup).mode & 0o222, 0)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, STATE_SCHEMA_VERSION)
  assert.equal(canonicalStateHash(migrated.get()), expectedHash)
  assert.equal(migrated.get().preferredPort, 4567)
  assert.equal(migrated.get().devices[0].lastSeenAt, '2026-09-01T00:02:00.000Z')

  const reverseFile = path.join(directory, 'reverse-v5.json')
  const reverse = migrated.exportV5State()
  assert.equal(reverse.schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  assert.equal(reverse.mesh.networkSecret, undefined)
  assert.deepEqual(Object.keys(reverse.mesh.secretEnvelope).sort(), ['ciphertext', 'encoding', 'version'])
  writeFileSync(reverseFile, JSON.stringify(reverse), { mode: 0o600 })
  assert.equal(canonicalStateHash(new MobileSyncStore(reverseFile, adapter, { storageMode: 'v5' }).get()), expectedHash)

  const rolledBack = new MobileSyncStore(file, adapter, { storageMode: 'v5' })
  assert.equal(rolledBack.get().schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  assert.equal(canonicalStateHash(rolledBack.get()), expectedHash)
  assert.equal(readFileSync(backup, 'utf8'), legacyBytes)
  const remigrated = new MobileSyncStore(file, adapter)
  assert.equal(canonicalStateHash(remigrated.get()), expectedHash)
  assert.equal(readFileSync(backup, 'utf8'), legacyBytes)
})

test('shadow mode compares v5 and v6 canonical hashes in memory and persists one legacy transaction', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-shadow-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file, null, { storageMode: 'shadow' })
  const first = store.commitSyncManifest({
    complete: true,
    operationId: 'shadow-base',
    workspaces: [{ workspaceId: 'workspace-one', title: 'One' }],
    sessions: [{ sessionId: 'session-one', workspaceId: 'workspace-one', title: 'One' }]
  })
  store.commitSyncManifest({
    complete: false,
    operationId: 'shadow-delta',
    snapshotEpoch: first.snapshotEpoch,
    revision: first.revision + 1,
    sessions: [{ sessionId: 'session-two', workspaceId: 'workspace-one', title: 'Two' }]
  })
  const comparison = store.getShadowComparison()
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(comparison.equal, true)
  assert.equal(comparison.legacyHash, comparison.v6Hash)
  assert.equal(comparison.comparison, 3, 'startup plus each of two input transactions is compared exactly once')
  assert.equal(store.get().schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  assert.equal(disk.schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
  assert.equal(disk.sync.revision, 2)
  assert.equal(disk.sync.events.length, 2)
  assert.equal(disk.sync.operations.length, 2)
})

test('every main, runtime, backup, fsync, and rename crash boundary recovers only a complete old or new transaction', () => {
  const publishedPhases = new Set(['renamed', 'directory-fsynced'])
  for (const phase of ATOMIC_WRITE_PHASES) {
    const directory = mkdtempSync(path.join(os.tmpdir(), `harness-mobile-crash-main-${phase}-`))
    const file = path.join(directory, 'mobile-sync.json')
    const baselineStore = new MobileSyncStore(file)
    const baseline = baselineStore.commitSyncManifest({ complete: true, operationId: 'base', workspaces: [], sessions: [] })
    const crashing = new MobileSyncStore(file, null, { crashInjector: crashOnceAt(`main:${phase}`) })
    assert.throws(() => crashing.commitSyncManifest({
      complete: false,
      operationId: `main-${phase}`,
      snapshotEpoch: baseline.snapshotEpoch,
      revision: baseline.revision + 1,
      sessions: [{ sessionId: 'new-session' }]
    }), error => error.mobileSyncCrashPoint === `main:${phase}`)
    assert.doesNotThrow(() => JSON.parse(readFileSync(file, 'utf8')))
    const recovered = new MobileSyncStore(file)
    assert.equal(recovered.get().sync.revision, publishedPhases.has(phase) ? 2 : 1)
    assert.equal(recovered.get().sync.sessions.length, publishedPhases.has(phase) ? 1 : 0)
  }

  for (const operation of ['heartbeat', 'preferred-port']) {
    for (const phase of ATOMIC_WRITE_PHASES) {
      const directory = mkdtempSync(path.join(os.tmpdir(), `harness-mobile-crash-${operation}-${phase}-`))
      const file = path.join(directory, 'mobile-sync.json')
      const baselineStore = new MobileSyncStore(file)
      baselineStore.addDevice({
        id: '0123456789abcdef',
        secretHash: 'a'.repeat(64),
        name: 'Crash phone',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastSeenAt: null
      })
      const crashing = new MobileSyncStore(file, null, { crashInjector: crashOnceAt(`runtime:${phase}`) })
      const invoke = operation === 'heartbeat'
        ? () => crashing.touchDevice('0123456789abcdef', new Date('2026-09-01T00:01:00.000Z'))
        : () => crashing.setPreferredPort(4567)
      assert.throws(invoke, error => error.mobileSyncCrashPoint === `runtime:${phase}`)
      const recovered = new MobileSyncStore(file)
      if (operation === 'heartbeat') {
        assert.equal(recovered.get().devices[0].lastSeenAt, publishedPhases.has(phase) ? '2026-09-01T00:01:00.000Z' : null)
      } else {
        assert.equal(recovered.get().preferredPort, publishedPhases.has(phase) ? 4567 : 3081)
      }
    }
  }

  for (const phase of ATOMIC_WRITE_PHASES) {
    const directory = mkdtempSync(path.join(os.tmpdir(), `harness-mobile-crash-backup-${phase}-`))
    const file = path.join(directory, 'mobile-sync.json')
    const legacy = new MobileSyncStore(file, null, { storageMode: 'v5' })
    legacy.commitSyncManifest({ complete: true, operationId: 'legacy', workspaces: [], sessions: [] })
    const legacyBytes = readFileSync(file, 'utf8')
    assert.throws(
      () => new MobileSyncStore(file, null, { crashInjector: crashOnceAt(`backup:${phase}`) }),
      error => error.mobileSyncCrashPoint === `backup:${phase}`
    )
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, LEGACY_STATE_SCHEMA_VERSION)
    const recovered = new MobileSyncStore(file)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, STATE_SCHEMA_VERSION)
    assert.equal(readFileSync(`${file}${V5_BACKUP_SUFFIX}`, 'utf8'), legacyBytes)
    assert.equal(recovered.get().sync.revision, 1)
  }

  for (const phase of ATOMIC_WRITE_PHASES) {
    const directory = mkdtempSync(path.join(os.tmpdir(), `harness-mobile-crash-migration-${phase}-`))
    const file = path.join(directory, 'mobile-sync.json')
    const legacy = new MobileSyncStore(file, null, { storageMode: 'v5' })
    legacy.commitSyncManifest({ complete: true, operationId: 'legacy', workspaces: [], sessions: [] })
    assert.throws(
      () => new MobileSyncStore(file, null, { crashInjector: crashOnceAt(`main:${phase}`) }),
      error => error.mobileSyncCrashPoint === `main:${phase}`
    )
    const diskAfterCrash = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(diskAfterCrash.schemaVersion, publishedPhases.has(phase) ? STATE_SCHEMA_VERSION : LEGACY_STATE_SCHEMA_VERSION)
    const recovered = new MobileSyncStore(file)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).schemaVersion, STATE_SCHEMA_VERSION)
    assert.equal(recovered.get().sync.revision, 1)
  }
})

test('every retained cursor start and workspace/session/read tombstone converges to the canonical offline snapshot', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-cursor-matrix-'))
  const store = new MobileSyncStore(path.join(directory, 'mobile-sync.json'))
  const checkpoints = []
  const commit = input => {
    const result = store.commitSyncManifest(input)
    checkpoints.push({ cursor: result.cursor, snapshot: cloneJson(store.readSyncChanges().snapshot) })
    return result
  }
  const first = commit({
    complete: true,
    operationId: 'matrix-base',
    workspaces: [
      { workspaceId: 'workspace-a', title: 'A' },
      { workspaceId: 'workspace-b', title: 'B' }
    ],
    sessions: [
      { sessionId: 'session-a', workspaceId: 'workspace-a', title: 'A' },
      { sessionId: 'session-b', workspaceId: 'workspace-b', title: 'B' }
    ],
    readMessages: [
      { sessionId: 'session-a', messageId: 'message-a', readAt: '2026-09-01T00:00:00.000Z' },
      { sessionId: 'session-b', messageId: 'message-b', readAt: '2026-09-01T00:00:00.000Z' }
    ]
  })
  commit({
    complete: false,
    operationId: 'matrix-read',
    snapshotEpoch: first.snapshotEpoch,
    revision: first.revision + 1,
    readMessages: [{ sessionId: 'session-a', messageId: 'message-c', readAt: '2026-09-01T00:01:00.000Z' }]
  })
  commit({
    complete: true,
    operationId: 'matrix-complete-delta',
    workspaces: [
      { workspaceId: 'workspace-a', title: 'A changed' },
      { workspaceId: 'workspace-b', title: 'B' }
    ],
    sessions: [
      { sessionId: 'session-a', workspaceId: 'workspace-a', title: 'A' },
      { sessionId: 'session-b', workspaceId: 'workspace-b', title: 'B' }
    ],
    readMessages: cloneJson(store.readSyncReadMessages())
  })
  commit({ complete: false, operationId: 'matrix-delete-session', tombstones: [{ kind: 'session', id: 'session-a' }] })
  commit({ complete: false, operationId: 'matrix-delete-workspace', tombstones: [{ kind: 'workspace', id: 'workspace-b' }] })
  commit({
    complete: false,
    operationId: 'matrix-resurrect',
    sessions: [{ sessionId: 'session-a', workspaceId: 'workspace-a', title: 'A restored' }],
    readMessages: [{ sessionId: 'session-a', messageId: 'message-z', readAt: '2026-09-01T00:02:00.000Z' }]
  })

  const expected = cloneJson(store.readSyncChanges().snapshot)
  for (const checkpoint of checkpoints) {
    const resumed = store.readSyncChanges({ snapshotEpoch: first.snapshotEpoch, cursor: checkpoint.cursor })
    assert.equal(resumed.resetRequired, false)
    assert.deepEqual(applyOfflineChanges(checkpoint.snapshot, resumed.changes), expected)
  }
  assert.deepEqual(expected.workspaces.map(item => item.workspaceId), ['workspace-a'])
  assert.deepEqual(expected.sessions.map(item => item.sessionId), ['session-a'])
  assert.deepEqual(expected.readMessages.map(item => item.messageId), ['message-z'])
  assert.deepEqual(expected.tombstones.map(item => `${item.kind}:${item.id}`), ['workspace:workspace-b'])
})

test('1307-session current and 128-event journal meet latency and storage gates with n >= 30', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-v6-performance-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const sessions = Array.from({ length: 1307 }, (_, index) => ({
    sessionId: `session-${index}`,
    workspaceId: 'workspace-one',
    title: `Session ${index}`,
    status: 'idle'
  }))
  const workspaces = [{ workspaceId: 'workspace-one', title: 'Performance' }]
  store.commitSyncManifest({ complete: true, operationId: 'performance-base', workspaces, sessions })
  store.addDevice({
    id: '0123456789abcdef',
    secretHash: 'a'.repeat(64),
    name: 'Performance phone',
    createdAt: '2026-09-01T00:00:00.000Z',
    lastSeenAt: null
  })

  const currentGet = measureSamples(32, () => store.get())
  const currentTouch = measureSamples(32, index => store.touchDevice('0123456789abcdef', new Date(Date.UTC(2026, 8, 1, 0, 1, 0, index))))
  const currentCommit = measureSamples(32, index => {
    sessions[index] = { ...sessions[index], title: `Changed ${index}` }
    store.commitSyncManifest({ complete: true, operationId: `performance-change-${index}`, workspaces, sessions })
  })
  assert.ok(percentile(currentGet, 0.95) < 10, `current get p95 ${percentile(currentGet, 0.95)}ms`)
  assert.ok(percentile(currentTouch, 0.95) < 20, `current touch p95 ${percentile(currentTouch, 0.95)}ms`)
  assert.ok(percentile(currentCommit, 0.95) < 50, `current changed commit p95 ${percentile(currentCommit, 0.95)}ms`)

  for (let index = 0; index < SYNC_EVENT_LIMIT; index++) {
    store.commitSyncManifest({
      complete: false,
      operationId: `performance-tail-${index}`,
      readMessages: [{ sessionId: 'session-0', messageId: `message-${index}`, readAt: new Date(Date.UTC(2026, 8, 1, 1, 0, 0, index)).toISOString() }]
    })
  }
  assert.equal(store.get().sync.events.length, SYNC_EVENT_LIMIT)
  const oldestCursor = store.get().sync.events[0].cursor
  const epoch = store.get().sync.snapshotEpoch
  const journalGet = measureSamples(32, () => store.readSyncChanges({ snapshotEpoch: epoch, cursor: oldestCursor }))
  const journalTouch = measureSamples(32, index => store.touchDevice('0123456789abcdef', new Date(Date.UTC(2026, 8, 1, 2, 0, 0, index))))
  const journalCommit = measureSamples(32, index => store.commitSyncManifest({
    complete: false,
    operationId: `performance-final-${index}`,
    readMessages: [{ sessionId: 'session-0', messageId: `final-${index}`, readAt: new Date(Date.UTC(2026, 8, 1, 3, 0, 0, index)).toISOString() }]
  }))
  assert.ok(percentile(journalGet, 0.95) < 15, `128-event get p95 ${percentile(journalGet, 0.95)}ms`)
  assert.ok(percentile(journalTouch, 0.95) < 75, `128-event touch p95 ${percentile(journalTouch, 0.95)}ms`)
  assert.ok(percentile(journalCommit, 0.95) < 75, `128-event commit p95 ${percentile(journalCommit, 0.95)}ms`)

  const disk = JSON.parse(readFileSync(file, 'utf8'))
  const canonicalBytes = Buffer.byteLength(JSON.stringify(disk.sync.canonicalSnapshot))
  const journalBytes = Buffer.byteLength(JSON.stringify(disk.sync.deltaJournal))
  const boundedDeltaBytes = journalBytes + Buffer.byteLength(JSON.stringify(disk.sync.operations))
  const totalBytes = statSync(file).size + statSync(store.runtimeFile).size
  assert.equal(disk.sync.deltaJournal.length, SYNC_EVENT_LIMIT)
  assert.ok(journalBytes <= SYNC_JOURNAL_BYTE_LIMIT)
  assert.ok(totalBytes <= (2 * canonicalBytes) + boundedDeltaBytes + (64 * 1024), `${totalBytes} bytes exceeds the canonical + bounded-delta budget`)
  t.diagnostic(JSON.stringify({
    samples: 32,
    currentMs: {
      getP95: Number(percentile(currentGet, 0.95).toFixed(3)),
      touchP95: Number(percentile(currentTouch, 0.95).toFixed(3)),
      changedCommitP95: Number(percentile(currentCommit, 0.95).toFixed(3))
    },
    journal128Ms: {
      getP95: Number(percentile(journalGet, 0.95).toFixed(3)),
      touchP95: Number(percentile(journalTouch, 0.95).toFixed(3)),
      commitP95: Number(percentile(journalCommit, 0.95).toFixed(3))
    },
    storage: { totalBytes, canonicalBytes, boundedDeltaBytes }
  }))
})

test('a real full-event v5 fixture migrates every retained cursor to equivalent lossless deltas', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-v5-full-events-'))
  const file = path.join(directory, 'mobile-sync.json')
  const epoch = 123456
  const cursorOne = 'A'.repeat(24)
  const cursorTwo = 'B'.repeat(24)
  const cursorThree = 'C'.repeat(24)
  const atOne = '2026-09-01T00:00:00.000Z'
  const atTwo = '2026-09-01T00:01:00.000Z'
  const atThree = '2026-09-01T00:02:00.000Z'
  const workspacesOne = [
    { workspaceId: 'workspace-a', title: 'A' },
    { workspaceId: 'workspace-b', title: 'B' }
  ]
  const workspacesTwo = [
    { workspaceId: 'workspace-a', title: 'A changed' },
    { workspaceId: 'workspace-b', title: 'B' }
  ]
  const sessionsOne = [
    { sessionId: 'session-a', workspaceId: 'workspace-a', title: 'A' },
    { sessionId: 'session-b', workspaceId: 'workspace-b', title: 'B' }
  ]
  const readOne = [
    { sessionId: 'session-a', messageId: 'message-a', readAt: atOne },
    { sessionId: 'session-b', messageId: 'message-b', readAt: atOne }
  ]
  const removed = { kind: 'session', id: 'session-a', revision: 3, cursor: cursorThree, deletedAt: atThree }
  const legacy = {
    schemaVersion: LEGACY_STATE_SCHEMA_VERSION,
    enabled: true,
    remoteEnabled: true,
    transportPreference: 'auto',
    preferredPort: 3081,
    mesh: null,
    devices: [],
    sync: {
      schemaVersion: SYNC_PROTOCOL_VERSION,
      snapshotEpoch: epoch,
      revision: 3,
      cursor: cursorThree,
      complete: true,
      updatedAt: atThree,
      workspaces: workspacesTwo,
      sessions: [sessionsOne[1]],
      readMessages: [readOne[1]],
      tombstones: [removed],
      events: [
        { cursor: cursorOne, revision: 1, operationId: 'full-one', recordedAt: atOne, complete: true, workspaces: workspacesOne, sessions: sessionsOne, readMessages: readOne, tombstones: [] },
        { cursor: cursorTwo, revision: 2, operationId: 'full-two', recordedAt: atTwo, complete: true, workspaces: workspacesTwo, sessions: sessionsOne, readMessages: readOne, tombstones: [] },
        { cursor: cursorThree, revision: 3, operationId: 'full-three', recordedAt: atThree, complete: true, workspaces: workspacesTwo, sessions: [sessionsOne[1]], readMessages: [readOne[1]], tombstones: [removed] }
      ],
      operations: []
    }
  }
  writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 })
  const legacyBytes = readFileSync(file, 'utf8')
  const store = new MobileSyncStore(file)
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(disk.sync.deltaJournal[0].sessions.length, 2)
  assert.equal(disk.sync.deltaJournal[1].workspaces.length, 1)
  assert.equal(disk.sync.deltaJournal[1].sessions.length, 0)
  assert.equal(disk.sync.deltaJournal[2].sessions.length, 0)
  assert.equal(readFileSync(`${file}${V5_BACKUP_SUFFIX}`, 'utf8'), legacyBytes)

  const afterOne = store.readSyncChanges({ snapshotEpoch: epoch, cursor: cursorOne })
  assert.equal(afterOne.resetRequired, false)
  assert.deepEqual(applyOfflineChanges({ workspaces: workspacesOne, sessions: sessionsOne, readMessages: readOne, tombstones: [] }, afterOne.changes), cloneJson(store.readSyncChanges().snapshot))
  const afterTwo = store.readSyncChanges({ snapshotEpoch: epoch, cursor: cursorTwo })
  assert.equal(afterTwo.resetRequired, false)
  assert.deepEqual(applyOfflineChanges({ workspaces: workspacesTwo, sessions: sessionsOne, readMessages: readOne, tombstones: [] }, afterTwo.changes), cloneJson(store.readSyncChanges().snapshot))

  new MobileSyncStore(file, null, { storageMode: 'v5' })
  const remigrated = new MobileSyncStore(file)
  const afterRoundtrip = remigrated.readSyncChanges({ snapshotEpoch: epoch, cursor: cursorOne })
  assert.equal(afterRoundtrip.resetRequired, false)
  assert.deepEqual(applyOfflineChanges({ workspaces: workspacesOne, sessions: sessionsOne, readMessages: readOne, tombstones: [] }, afterRoundtrip.changes), cloneJson(remigrated.readSyncChanges().snapshot))
})

test('an ordering-only authoritative change prunes older cursors and sends a full lossless reset', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-order-reset-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const first = store.commitSyncManifest({
    complete: true,
    operationId: 'order-base',
    workspaces: [{ workspaceId: 'workspace-one' }],
    sessions: [
      { sessionId: 'session-a', workspaceId: 'workspace-one' },
      { sessionId: 'session-b', workspaceId: 'workspace-one' }
    ]
  })
  const reordered = store.commitSyncManifest({
    complete: true,
    operationId: 'order-changed',
    workspaces: [{ workspaceId: 'workspace-one' }],
    sessions: [
      { sessionId: 'session-b', workspaceId: 'workspace-one' },
      { sessionId: 'session-a', workspaceId: 'workspace-one' }
    ]
  })
  assert.equal(reordered.applied, true)
  assert.equal(reordered.resetRequired, true)
  assert.deepEqual(reordered.snapshot.sessions.map(item => item.sessionId), ['session-b', 'session-a'])
  assert.deepEqual(reordered.changes, [])
  assert.equal(store.get().sync.events.length, 1)
  assert.equal(store.readSyncChanges({ snapshotEpoch: first.snapshotEpoch, cursor: first.cursor }).resetRequired, true)
  assert.equal(store.readSyncChanges({ snapshotEpoch: reordered.snapshotEpoch, cursor: reordered.cursor }).resetRequired, false)

  new MobileSyncStore(file, null, { storageMode: 'v5' })
  const remigrated = new MobileSyncStore(file)
  assert.deepEqual(remigrated.readSyncChanges().snapshot.sessions.map(item => item.sessionId), ['session-b', 'session-a'])
})

test('large authoritative changes prune only old cursors and keep the byte-bounded retained journal lossless', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-journal-bytes-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const workspaces = [{ workspaceId: 'workspace-one', title: 'Large journal' }]
  const sessions = Array.from({ length: 320 }, (_, index) => ({
    sessionId: `session-${index}`,
    workspaceId: 'workspace-one',
    title: `Baseline ${index} ${'x'.repeat(220)}`
  }))
  const checkpoints = new Map()
  const first = store.commitSyncManifest({ complete: true, operationId: 'large-base', workspaces, sessions })
  checkpoints.set(first.cursor, cloneJson(store.readSyncChanges().snapshot))
  for (let revision = 1; revision <= 14; revision++) {
    for (let index = 0; index < sessions.length; index++) {
      sessions[index] = { ...sessions[index], title: `Revision ${revision} item ${index} ${String(revision).repeat(210)}` }
    }
    const committed = store.commitSyncManifest({ complete: true, operationId: `large-${revision}`, workspaces, sessions })
    checkpoints.set(committed.cursor, cloneJson(store.readSyncChanges().snapshot))
  }
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  const journalBytes = Buffer.byteLength(JSON.stringify(disk.sync.deltaJournal))
  assert.ok(journalBytes <= SYNC_JOURNAL_BYTE_LIMIT)
  assert.ok(disk.sync.deltaJournal.length < 15, 'byte bounding must prune old full-sized events')
  assert.equal(store.readSyncChanges({ snapshotEpoch: first.snapshotEpoch, cursor: first.cursor }).resetRequired, true)

  const oldestRetained = store.get().sync.events[0]
  const retainedBase = checkpoints.get(oldestRetained.cursor)
  assert.ok(retainedBase)
  const resumed = store.readSyncChanges({ snapshotEpoch: first.snapshotEpoch, cursor: oldestRetained.cursor })
  assert.equal(resumed.resetRequired, false)
  assert.deepEqual(applyOfflineChanges(retainedBase, resumed.changes), cloneJson(store.readSyncChanges().snapshot))
})

test('one oversized event becomes a strict bounded anchor across restart and v5 rollback-remigration', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-oversized-anchor-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const workspaces = [{ workspaceId: 'workspace-one', title: 'Oversized anchor' }]
  const base = store.commitSyncManifest({
    complete: true,
    operationId: 'oversized-base',
    workspaces,
    sessions: [{ sessionId: 'session-0', workspaceId: 'workspace-one', title: 'Baseline' }]
  })
  const oversizedSessions = Array.from({ length: 4096 }, (_, index) => ({
    sessionId: `session-${index}`,
    workspaceId: 'workspace-one',
    title: `Oversized ${index} ${'x'.repeat(280)}`
  }))
  const oversized = store.commitSyncManifest({
    complete: true,
    operationId: 'oversized-transition',
    workspaces,
    sessions: oversizedSessions
  })
  assert.equal(oversized.resetRequired, true)
  assert.equal(store.readSyncChanges({ snapshotEpoch: base.snapshotEpoch, cursor: base.cursor }).resetRequired, true)
  const oversizedSnapshot = cloneJson(oversized.snapshot)
  let disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(Buffer.byteLength(JSON.stringify(disk.sync.canonicalSnapshot)) > SYNC_JOURNAL_BYTE_LIMIT)
  assert.ok(Buffer.byteLength(JSON.stringify(disk.sync.deltaJournal)) <= SYNC_JOURNAL_BYTE_LIMIT)
  assert.equal(disk.sync.deltaJournal.length, 1)
  assert.equal(disk.sync.deltaJournal[0].cursor, oversized.cursor)
  assert.equal(disk.sync.deltaJournal[0].complete, false)
  assert.deepEqual(disk.sync.deltaJournal[0].sessions, [])
  const currentNoop = store.readSyncChanges({ snapshotEpoch: oversized.snapshotEpoch, cursor: oversized.cursor })
  assert.equal(currentNoop.resetRequired, false)
  assert.equal(currentNoop.snapshot, null)
  assert.deepEqual(currentNoop.changes, [])

  const followUpSessions = [...oversizedSessions]
  followUpSessions[0] = { ...followUpSessions[0], title: 'Small follow-up' }
  const small = store.commitSyncManifest({
    complete: true,
    operationId: 'oversized-follow-up',
    workspaces,
    sessions: followUpSessions
  })
  assert.equal(small.resetRequired, false)
  assert.equal(small.snapshot, null)
  assert.equal(small.changes.length, 1)
  const finalSnapshot = cloneJson(store.readSyncChanges().snapshot)
  assert.deepEqual(applyOfflineChanges(oversizedSnapshot, small.changes), finalSnapshot)
  disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(Buffer.byteLength(JSON.stringify(disk.sync.deltaJournal)) <= SYNC_JOURNAL_BYTE_LIMIT)
  assert.equal(disk.sync.deltaJournal.length, 2)
  assert.equal(disk.sync.deltaJournal[0].cursor, oversized.cursor)
  assert.equal(disk.sync.deltaJournal[1].sessions.length, 1)

  const reopened = new MobileSyncStore(file)
  const afterRestart = reopened.readSyncChanges({ snapshotEpoch: oversized.snapshotEpoch, cursor: oversized.cursor })
  assert.equal(afterRestart.resetRequired, false)
  assert.deepEqual(applyOfflineChanges(oversizedSnapshot, afterRestart.changes), finalSnapshot)

  const rolledBack = new MobileSyncStore(file, null, { storageMode: 'v5' })
  const afterRollback = rolledBack.readSyncChanges({ snapshotEpoch: oversized.snapshotEpoch, cursor: oversized.cursor })
  assert.equal(afterRollback.resetRequired, false)
  assert.deepEqual(applyOfflineChanges(oversizedSnapshot, afterRollback.changes), finalSnapshot)

  const remigrated = new MobileSyncStore(file)
  const afterRemigration = remigrated.readSyncChanges({ snapshotEpoch: oversized.snapshotEpoch, cursor: oversized.cursor })
  assert.equal(afterRemigration.resetRequired, false)
  assert.deepEqual(applyOfflineChanges(oversizedSnapshot, afterRemigration.changes), finalSnapshot)
  disk = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(Buffer.byteLength(JSON.stringify(disk.sync.deltaJournal)) <= SYNC_JOURNAL_BYTE_LIMIT)
})

test('v6 canonical and runtime integrity records fail closed without echoing damaged contents', () => {
  const mainDirectory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-v6-integrity-'))
  const mainFile = path.join(mainDirectory, 'mobile-sync.json')
  const mainStore = new MobileSyncStore(mainFile)
  mainStore.commitSyncManifest({
    complete: true,
    operationId: 'integrity-base',
    workspaces: [{ workspaceId: 'workspace-one' }],
    sessions: [{ sessionId: 'session-one', workspaceId: 'workspace-one', title: 'original' }]
  })
  const damagedMain = JSON.parse(readFileSync(mainFile, 'utf8'))
  damagedMain.sync.canonicalSnapshot.sessions[0].title = 'do-not-echo-canonical-damage'
  writeFileSync(mainFile, JSON.stringify(damagedMain))
  assert.throws(() => new MobileSyncStore(mainFile), error => {
    assert.match(error.message, /sync ledger is invalid/i)
    assert.doesNotMatch(error.message, /do-not-echo-canonical-damage/)
    return true
  })

  const runtimeDirectory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-runtime-integrity-'))
  const runtimeFile = path.join(runtimeDirectory, 'mobile-sync.json')
  const runtimeStore = new MobileSyncStore(runtimeFile)
  runtimeStore.addDevice({ id: 'abcdef0123456789', secretHash: 'a'.repeat(64), lastSeenAt: '2026-01-01T00:00:00.000Z' })
  runtimeStore.touchDevice('abcdef0123456789', new Date('2026-01-02T00:00:00.000Z'))
  const damagedRuntime = JSON.parse(readFileSync(runtimeStore.runtimeFile, 'utf8'))
  damagedRuntime.heartbeats[0].lastSeenAt = 'do-not-echo-runtime-damage'
  writeFileSync(runtimeStore.runtimeFile, JSON.stringify(damagedRuntime))
  assert.throws(() => new MobileSyncStore(runtimeFile), error => {
    assert.match(error.message, /runtime record.*invalid/i)
    assert.doesNotMatch(error.message, /do-not-echo-runtime-damage/)
    return true
  })
})

test('tombstone retention eviction prunes old cursors instead of producing a divergent offline merge', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-tombstone-boundary-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const sessions = Array.from({ length: 513 }, (_, index) => ({ sessionId: `session-${index}`, workspaceId: 'workspace-one' }))
  store.commitSyncManifest({
    complete: true,
    operationId: 'tombstone-base',
    workspaces: [{ workspaceId: 'workspace-one' }],
    sessions
  })
  const firstDeletion = store.commitSyncManifest({
    operationId: 'tombstone-first-512',
    tombstones: sessions.slice(0, 512).map(item => ({ kind: 'session', id: item.sessionId }))
  })
  assert.equal(firstDeletion.resetRequired, false)
  const overflowDeletion = store.commitSyncManifest({
    operationId: 'tombstone-overflow',
    tombstones: [{ kind: 'session', id: sessions[512].sessionId }]
  })
  assert.equal(overflowDeletion.resetRequired, true)
  assert.equal(overflowDeletion.snapshot.tombstones.length, 512)
  assert.equal(store.get().sync.events.length, 1)
  assert.equal(store.readSyncChanges({ snapshotEpoch: firstDeletion.snapshotEpoch, cursor: firstDeletion.cursor }).resetRequired, true)
  assert.ok(!store.get().sync.tombstones.some(item => item.id === 'session-0'))
})

test('collection capacity eviction resets older cursors and remains valid after reopen', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-collection-boundary-'))
  const file = path.join(directory, 'mobile-sync.json')
  const store = new MobileSyncStore(file)
  const sessions = Array.from({ length: 4096 }, (_, index) => ({ sessionId: `session-${index}`, workspaceId: 'workspace-one' }))
  const base = store.commitSyncManifest({
    complete: true,
    operationId: 'collection-base',
    workspaces: [{ workspaceId: 'workspace-one' }],
    sessions
  })
  const overflow = store.commitSyncManifest({
    operationId: 'collection-overflow',
    sessions: [{ sessionId: 'session-new', workspaceId: 'workspace-one' }]
  })
  assert.equal(overflow.resetRequired, true)
  assert.equal(overflow.snapshot.sessions.length, 4096)
  assert.ok(!overflow.snapshot.sessions.some(item => item.sessionId === 'session-0'))
  assert.ok(overflow.snapshot.sessions.some(item => item.sessionId === 'session-new'))
  assert.equal(store.readSyncChanges({ snapshotEpoch: base.snapshotEpoch, cursor: base.cursor }).resetRequired, true)
  assert.deepEqual(cloneJson(new MobileSyncStore(file).readSyncChanges().snapshot), cloneJson(overflow.snapshot))
})
