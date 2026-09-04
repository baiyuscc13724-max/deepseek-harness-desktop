const { createHash, randomBytes } = require('node:crypto')
const {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const path = require('node:path')

const DEFAULT_SERVICE_ADDRESS = '10.253.77.254'
const LEGACY_SERVICE_ADDRESS = '10.254.77.254'
const SECRET_ENVELOPE_VERSION = 1
const SYNC_PROTOCOL_VERSION = 1
const SYNC_EVENT_LIMIT = 128
const SYNC_OPERATION_LIMIT = 64
const SYNC_TOMBSTONE_LIMIT = 512
const SYNC_JOURNAL_BYTE_LIMIT = 512 * 1024
const LEGACY_STATE_SCHEMA_VERSION = 5
const STATE_SCHEMA_VERSION = 6
const RUNTIME_RECORD_SCHEMA_VERSION = 1
const V6_STORAGE_FORMAT = 'canonical-delta-v1'
const V5_BACKUP_SUFFIX = '.v5.bak'
const RUNTIME_RECORD_SUFFIX = '.runtime'
const RUNTIME_HEARTBEAT_PERSIST_INTERVAL_MS = 1000
const ATOMIC_WRITE_PHASES = Object.freeze([
  'temp-created',
  'temp-written',
  'file-fsynced',
  'before-rename',
  'renamed',
  'directory-fsynced'
])
const EMPTY_ARRAY = Object.freeze([])
const EMPTY_SYNC_SNAPSHOT = Object.freeze({
  workspaces: EMPTY_ARRAY,
  sessions: EMPTY_ARRAY,
  readMessages: EMPTY_ARRAY,
  tombstones: EMPTY_ARRAY
})

const DEFAULT_STATE = Object.freeze({
  schemaVersion: STATE_SCHEMA_VERSION,
  enabled: false,
  remoteEnabled: true,
  transportPreference: 'auto',
  preferredPort: 3081,
  mesh: null,
  devices: EMPTY_ARRAY,
  sync: null
})

function cloneDefaultState() {
  return {
    ...DEFAULT_STATE,
    devices: []
  }
}

function safeDate(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function safeName(value) {
  const normalized = String(value || '移动设备')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80)
  return normalized || '移动设备'
}

function safeDevicePlatform(value) {
  return ['android', 'ios'].includes(value) ? value : 'unknown'
}

function safeDeviceClass(value) {
  return ['phone', 'tablet'].includes(value) ? value : 'unknown'
}

function safeAppVersion(value) {
  const normalized = String(value || '').replace(/[^0-9A-Za-z._+-]/g, '').slice(0, 40)
  return normalized || null
}

function normalizeDevice(value) {
  if (!value || typeof value !== 'object') return null
  if (!/^[a-f0-9]{16}$/.test(value.id || '')) return null
  if (!/^[a-f0-9]{64}$/.test(value.secretHash || '')) return null
  return {
    id: value.id,
    secretHash: value.secretHash,
    name: safeName(value.name),
    platform: safeDevicePlatform(value.platform),
    deviceClass: safeDeviceClass(value.deviceClass),
    appVersion: safeAppVersion(value.appVersion),
    createdAt: safeDate(value.createdAt) || new Date(0).toISOString(),
    lastSeenAt: safeDate(value.lastSeenAt)
  }
}

function normalizeMesh(value) {
  if (!value || typeof value !== 'object') return null
  const networkName = String(value.networkName || '').trim()
  const networkSecret = String(value.networkSecret || '').trim()
  const desktopAddress = String(value.desktopAddress || '').trim()
  const requestedServiceAddress = String(value.serviceAddress || DEFAULT_SERVICE_ADDRESS).trim()
  // 10.254.77.0/24 is the EasyTier node subnet. Keeping the mapped service
  // inside that subnet makes no-TUN clients treat it as an on-link host and
  // bypass the more specific proxy route on some platforms.
  const serviceAddress = requestedServiceAddress === LEGACY_SERVICE_ADDRESS
    ? DEFAULT_SERVICE_ADDRESS
    : requestedServiceAddress
  if (!/^[a-z0-9-]{12,80}$/.test(networkName)) return null
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(networkSecret)) return null
  if (!/^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(desktopAddress)) return null
  if (!/^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(serviceAddress)) return null
  if (serviceAddress === desktopAddress) return null
  const relayRoomId = String(value.relayRoomId || '').trim()
  const relayTunnelKey = String(value.relayTunnelKey || '').trim()
  if (relayRoomId && !/^[A-Za-z0-9_-]{40,64}$/.test(relayRoomId)) return null
  if (relayTunnelKey && !/^[A-Za-z0-9_-]{40,64}$/.test(relayTunnelKey)) return null
  if (Boolean(relayRoomId) !== Boolean(relayTunnelKey)) return null
  return {
    networkName,
    networkSecret,
    desktopAddress,
    serviceAddress,
    ...(relayRoomId && relayTunnelKey ? { relayRoomId, relayTunnelKey } : {})
  }
}

function safeSyncText(value, limit) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit)
}

function normalizeSyncItem(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (kind === 'workspace') {
    const workspaceId = safeSyncText(value.workspaceId, 512)
    if (!workspaceId) return null
    return {
      workspaceId,
      title: safeSyncText(value.title, 300) || workspaceId,
      ...(safeDate(value.createdAt) ? { createdAt: safeDate(value.createdAt) } : {}),
      ...(safeDate(value.updatedAt) ? { updatedAt: safeDate(value.updatedAt) } : {})
    }
  }
  const sessionId = safeSyncText(value.sessionId, 256)
  if (!sessionId) return null
  const workspaceId = safeSyncText(value.workspaceId, 512)
  const status = safeSyncText(value.status, 64)
  return {
    sessionId,
    ...(workspaceId ? { workspaceId } : {}),
    ...(safeSyncText(value.title, 300) ? { title: safeSyncText(value.title, 300) } : {}),
    ...(status ? { status } : {}),
    ...(value.archived === true ? { archived: true } : {}),
    ...(safeDate(value.createdAt) ? { createdAt: safeDate(value.createdAt) } : {}),
    ...(safeDate(value.updatedAt) ? { updatedAt: safeDate(value.updatedAt) } : {}),
    ...(safeDate(value.lastActivityAt) ? { lastActivityAt: safeDate(value.lastActivityAt) } : {})
  }
}

function normalizeSyncItems(kind, values) {
  const identity = kind === 'workspace' ? 'workspaceId' : 'sessionId'
  const items = new Map()
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeSyncItem(kind, value)
    if (normalized) items.set(normalized[identity], normalized)
  }
  return [...items.values()].slice(-4096)
}

function safeSyncCursor(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : ''
}

function normalizeReadMessage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const sessionId = safeSyncText(value.sessionId, 256)
  const messageId = safeSyncText(value.messageId, 256)
  const readAt = safeDate(value.readAt)
  return sessionId && messageId && readAt ? { sessionId, messageId, readAt } : null
}

function normalizeReadMessages(values) {
  const items = new Map()
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeReadMessage(value)
    if (normalized) items.set(`${normalized.sessionId}:${normalized.messageId}`, normalized)
  }
  return [...items.values()].slice(-4096)
}

function normalizeSyncTombstone(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const kind = ['workspace', 'session', 'read-message'].includes(value.kind) ? value.kind : ''
  const idLimit = kind === 'workspace' ? 512 : 520
  const id = safeSyncText(value.id, idLimit)
  const revision = Number(value.revision)
  const cursor = safeSyncCursor(value.cursor)
  if (!kind || !id || !Number.isSafeInteger(revision) || revision < 1 || !cursor) return null
  return { kind, id, revision, cursor, deletedAt: safeDate(value.deletedAt) || new Date(0).toISOString() }
}

function normalizeSyncEvent(event, revision) {
  const eventCursor = safeSyncCursor(event?.cursor)
  const eventRevision = Number(event?.revision)
  if (!eventCursor || !Number.isSafeInteger(eventRevision) || eventRevision < 1 || eventRevision > revision) return null
  return {
    cursor: eventCursor,
    revision: eventRevision,
    operationId: safeSyncText(event.operationId, 160),
    recordedAt: safeDate(event.recordedAt) || new Date(0).toISOString(),
    complete: event.complete === true,
    workspaces: normalizeSyncItems('workspace', event.workspaces),
    sessions: normalizeSyncItems('session', event.sessions),
    readMessages: normalizeReadMessages(event.readMessages),
    tombstones: (Array.isArray(event.tombstones) ? event.tombstones : []).map(normalizeSyncTombstone).filter(Boolean).slice(-SYNC_TOMBSTONE_LIMIT)
  }
}

function normalizeSyncOperations(values) {
  return (Array.isArray(values) ? values : []).flatMap(operation => {
    const operationId = safeSyncText(operation?.operationId, 160)
    const digest = /^[a-f0-9]{64}$/.test(operation?.digest || '') ? operation.digest : ''
    const operationCursor = safeSyncCursor(operation?.cursor)
    if (!operationId || !digest || !operationCursor) return []
    return [{ operationId, digest, cursor: operationCursor }]
  }).slice(-SYNC_OPERATION_LIMIT)
}

function normalizeSyncState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshotEpoch = Number(value.snapshotEpoch)
  const revision = Number(value.revision)
  const cursor = safeSyncCursor(value.cursor)
  if (!Number.isSafeInteger(snapshotEpoch) || snapshotEpoch < 0 || !Number.isSafeInteger(revision) || revision < 0 || !cursor) return null
  const events = (Array.isArray(value.events) ? value.events : [])
    .map(event => normalizeSyncEvent(event, revision))
    .filter(Boolean)
    .sort((left, right) => left.revision - right.revision)
    .slice(-SYNC_EVENT_LIMIT)
  return {
    schemaVersion: SYNC_PROTOCOL_VERSION,
    snapshotEpoch,
    revision,
    cursor,
    complete: value.complete === true,
    updatedAt: safeDate(value.updatedAt),
    workspaces: normalizeSyncItems('workspace', value.workspaces),
    sessions: normalizeSyncItems('session', value.sessions),
    readMessages: normalizeReadMessages(value.readMessages),
    tombstones: (Array.isArray(value.tombstones) ? value.tombstones : []).map(normalizeSyncTombstone).filter(Boolean).slice(-SYNC_TOMBSTONE_LIMIT),
    events,
    operations: normalizeSyncOperations(value.operations)
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  const output = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = canonicalValue(value[key])
  }
  return output
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

function sha256Canonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function syncDigestPayload(sync) {
  return {
    schemaVersion: SYNC_PROTOCOL_VERSION,
    snapshotEpoch: sync.snapshotEpoch,
    revision: sync.revision,
    cursor: sync.cursor,
    complete: sync.complete,
    updatedAt: sync.updatedAt,
    canonicalSnapshot: {
      workspaces: sync.workspaces,
      sessions: sync.sessions,
      readMessages: sync.readMessages,
      tombstones: sync.tombstones
    },
    deltaJournal: sync.events,
    operations: sync.operations
  }
}

function v6SyncState(sync) {
  if (!sync) return null
  const payload = syncDigestPayload(sync)
  return {
    ...payload,
    canonicalHash: sha256Canonical(payload)
  }
}

function normalizeV6SyncState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const canonicalSnapshot = value.canonicalSnapshot
  if (!canonicalSnapshot || typeof canonicalSnapshot !== 'object' || Array.isArray(canonicalSnapshot)) return null
  const logical = normalizeSyncState({
    schemaVersion: value.schemaVersion,
    snapshotEpoch: value.snapshotEpoch,
    revision: value.revision,
    cursor: value.cursor,
    complete: value.complete,
    updatedAt: value.updatedAt,
    workspaces: canonicalSnapshot.workspaces,
    sessions: canonicalSnapshot.sessions,
    readMessages: canonicalSnapshot.readMessages,
    tombstones: canonicalSnapshot.tombstones,
    events: value.deltaJournal,
    operations: value.operations
  })
  if (!logical || !/^[a-f0-9]{64}$/.test(value.canonicalHash || '')) return null
  if (sha256Canonical(syncDigestPayload(logical)) !== value.canonicalHash) return null
  return logical
}

function normalizeState(input) {
  const value = input && typeof input === 'object' ? input : {}
  const preferredPort = Number(value.preferredPort)
  const devices = Array.isArray(value.devices)
    ? value.devices.map(normalizeDevice).filter(Boolean).slice(-32)
    : []
  const sync = value.sync?.canonicalSnapshot
    ? normalizeV6SyncState(value.sync)
    : normalizeSyncState(value.sync)
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    enabled: value.enabled === true,
    remoteEnabled: value.remoteEnabled !== false,
    transportPreference: ['auto', 'native-p2p', 'easytier', 'wss-relay', 'tailscale'].includes(value.transportPreference)
      ? value.transportPreference
      : DEFAULT_STATE.transportPreference,
    preferredPort: Number.isInteger(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535
      ? preferredPort
      : DEFAULT_STATE.preferredPort,
    mesh: normalizeMesh(value.mesh),
    devices,
    sync
  }
}

function normalizeSecretAdapter(value) {
  return value && typeof value.protect === 'function' && typeof value.unprotect === 'function'
    ? { protect: value.protect, unprotect: value.unprotect }
    : null
}

function protectedBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  throw new Error('Mobile sync secret protection returned an invalid ciphertext.')
}

function decodeEnvelopeCiphertext(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('Mobile sync secret envelope is missing.')
  if (envelope.version !== SECRET_ENVELOPE_VERSION || envelope.encoding !== 'base64') throw new Error('Mobile sync secret envelope version is unsupported.')
  const ciphertext = String(envelope.ciphertext || '')
  if (!ciphertext || ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) throw new Error('Mobile sync secret envelope is corrupt.')
  const decoded = Buffer.from(ciphertext, 'base64')
  if (!decoded.length || decoded.toString('base64') !== ciphertext) throw new Error('Mobile sync secret envelope is corrupt.')
  return decoded
}

function publicStoredMesh(mesh, secretAdapter) {
  if (!mesh) return null
  if (!secretAdapter) throw new Error('OS-backed mobile sync secret protection is unavailable.')
  const secretPayload = JSON.stringify({
    networkSecret: mesh.networkSecret,
    ...(mesh.relayRoomId && mesh.relayTunnelKey ? { relayRoomId: mesh.relayRoomId, relayTunnelKey: mesh.relayTunnelKey } : {})
  })
  let ciphertext
  try {
    ciphertext = protectedBuffer(secretAdapter.protect(secretPayload))
  } catch {
    throw new Error('Unable to protect mobile sync secrets with OS-backed encryption.')
  }
  if (!ciphertext.length) throw new Error('Mobile sync secret protection returned an empty ciphertext.')
  return {
    networkName: mesh.networkName,
    desktopAddress: mesh.desktopAddress,
    serviceAddress: mesh.serviceAddress,
    secretEnvelope: {
      version: SECRET_ENVELOPE_VERSION,
      encoding: 'base64',
      ciphertext: ciphertext.toString('base64')
    }
  }
}

function decryptStoredMesh(value, secretAdapter) {
  if (!secretAdapter) throw new Error('OS-backed mobile sync secret protection is unavailable; protected state cannot be opened.')
  let secretPayload
  try {
    secretPayload = JSON.parse(String(secretAdapter.unprotect(decodeEnvelopeCiphertext(value.secretEnvelope))))
  } catch {
    throw new Error('Unable to decrypt mobile sync secrets with OS-backed encryption.')
  }
  const normalized = normalizeMesh({
    networkName: value.networkName,
    desktopAddress: value.desktopAddress,
    serviceAddress: value.serviceAddress,
    networkSecret: secretPayload?.networkSecret,
    relayRoomId: secretPayload?.relayRoomId,
    relayTunnelKey: secretPayload?.relayTunnelKey
  })
  if (!normalized) throw new Error('Decrypted mobile sync secrets are invalid.')
  return normalized
}

function legacyLogicalState(state) {
  return {
    schemaVersion: LEGACY_STATE_SCHEMA_VERSION,
    enabled: state.enabled,
    remoteEnabled: state.remoteEnabled,
    transportPreference: state.transportPreference,
    preferredPort: state.preferredPort,
    mesh: state.mesh,
    devices: state.devices,
    sync: state.sync
  }
}

function exportV5State(state, secretAdapter = null) {
  const normalized = normalizeState(state)
  return {
    ...legacyLogicalState(normalized),
    mesh: publicStoredMesh(normalized.mesh, normalizeSecretAdapter(secretAdapter))
  }
}

function stateSemanticPayload(state) {
  const normalized = normalizeState(state)
  const sync = normalized.sync
    ? {
        schemaVersion: normalized.sync.schemaVersion,
        snapshotEpoch: normalized.sync.snapshotEpoch,
        revision: normalized.sync.revision,
        cursor: normalized.sync.cursor,
        complete: normalized.sync.complete,
        updatedAt: normalized.sync.updatedAt,
        workspaces: normalized.sync.workspaces,
        sessions: normalized.sync.sessions,
        readMessages: normalized.sync.readMessages,
        tombstones: normalized.sync.tombstones,
        events: normalized.sync.events.map(event => ({
          cursor: event.cursor,
          revision: event.revision,
          operationId: event.operationId,
          recordedAt: event.recordedAt,
          complete: event.complete,
          tombstones: event.tombstones
        })),
        operations: normalized.sync.operations
      }
    : null
  return {
    enabled: normalized.enabled,
    remoteEnabled: normalized.remoteEnabled,
    transportPreference: normalized.transportPreference,
    preferredPort: normalized.preferredPort,
    mesh: normalized.mesh,
    devices: normalized.devices,
    sync
  }
}

function canonicalStateHash(state) {
  return sha256Canonical(stateSemanticPayload(state))
}

function diskV6State(state, secretAdapter) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    storageFormat: V6_STORAGE_FORMAT,
    enabled: state.enabled,
    remoteEnabled: state.remoteEnabled,
    transportPreference: state.transportPreference,
    preferredPort: state.preferredPort,
    mesh: publicStoredMesh(state.mesh, secretAdapter),
    devices: state.devices,
    sync: v6SyncState(state.sync)
  }
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value) || seen.has(value)) return value
  seen.add(value)
  for (const entry of Object.values(value)) deepFreeze(entry, seen)
  return Object.freeze(value)
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameFlatJsonRecord(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]
    if (key !== rightKeys[index] || left[key] !== right[key]) return false
  }
  return true
}

function changedItems(previous, next, identity) {
  const before = new Map(previous.map(item => [identity(item), item]))
  return next.filter(item => !sameFlatJsonRecord(before.get(identity(item)), item))
}

function sameIdentityOrder(previous, next, identity) {
  return previous.length === next.length && previous.every((item, index) => identity(item) === identity(next[index]))
}

function deltaJournalAnchor(events, current) {
  const currentCursor = safeSyncCursor(current?.cursor)
  const matching = currentCursor ? [...events].reverse().find(event => event.cursor === currentCursor) : null
  const latest = matching || events.at(-1) || current || {}
  // Once an individual transition exceeds the byte budget, every older cursor
  // must reset from the canonical snapshot. This empty event anchors the current
  // cursor so it remains a no-op and can resume later, bounded deltas.
  return {
    cursor: currentCursor || latest.cursor,
    revision: Number.isSafeInteger(current?.revision) ? current.revision : latest.revision,
    operationId: safeSyncText(latest.operationId, 160),
    recordedAt: safeDate(current?.recordedAt || current?.updatedAt || latest.recordedAt) || new Date(0).toISOString(),
    complete: false,
    workspaces: [],
    sessions: [],
    readMessages: [],
    tombstones: []
  }
}

function boundDeltaJournal(events, current = null) {
  const bounded = events.slice(-SYNC_EVENT_LIMIT)
  while (bounded.length && Buffer.byteLength(JSON.stringify(bounded)) > SYNC_JOURNAL_BYTE_LIMIT) {
    if (bounded.length === 1) {
      bounded[0] = deltaJournalAnchor(events, current || bounded[0])
      break
    }
    bounded.shift()
  }
  return bounded
}

function applyEventSnapshot(previous, event) {
  const merge = (current, incoming, identity) => {
    const values = new Map(current.map(item => [identity(item), item]))
    for (const item of incoming) values.set(identity(item), item)
    return [...values.values()]
  }
  let workspaces = event.complete ? [...event.workspaces] : merge(previous?.workspaces || [], event.workspaces, item => item.workspaceId)
  let sessions = event.complete ? [...event.sessions] : merge(previous?.sessions || [], event.sessions, item => item.sessionId)
  let readMessages = event.complete ? [...event.readMessages] : merge(previous?.readMessages || [], event.readMessages, item => `${item.sessionId}:${item.messageId}`)
  const deletedWorkspaces = new Set(event.tombstones.filter(value => value.kind === 'workspace').map(value => value.id))
  const deletedSessions = new Set(event.tombstones.filter(value => value.kind === 'session').map(value => value.id))
  const deletedReads = new Set(event.tombstones.filter(value => value.kind === 'read-message').map(value => value.id))
  const cascadedSessions = new Set(sessions.filter(item => deletedWorkspaces.has(item.workspaceId)).map(item => item.sessionId))
  workspaces = workspaces.filter(item => !deletedWorkspaces.has(item.workspaceId))
  sessions = sessions.filter(item => !deletedSessions.has(item.sessionId) && !cascadedSessions.has(item.sessionId))
  readMessages = readMessages.filter(item => !deletedReads.has(`${item.sessionId}:${item.messageId}`) && !deletedSessions.has(item.sessionId) && !cascadedSessions.has(item.sessionId))
  return { workspaces, sessions, readMessages }
}

function eventCanReplaceSnapshot(previous, event) {
  const explicit = new Set(event.tombstones.map(value => `${value.kind}:${value.id}`))
  const workspaceIds = new Set(event.workspaces.map(item => item.workspaceId))
  const sessionIds = new Set(event.sessions.map(item => item.sessionId))
  const readIds = new Set(event.readMessages.map(item => `${item.sessionId}:${item.messageId}`))
  const cascadedSessions = new Set(previous.sessions.filter(item => explicit.has(`workspace:${item.workspaceId}`)).map(item => item.sessionId))
  return previous.workspaces.every(item => workspaceIds.has(item.workspaceId) || explicit.has(`workspace:${item.workspaceId}`)) &&
    previous.sessions.every(item => sessionIds.has(item.sessionId) || explicit.has(`session:${item.sessionId}`) || cascadedSessions.has(item.sessionId)) &&
    previous.readMessages.every(item => readIds.has(`${item.sessionId}:${item.messageId}`) || explicit.has(`read-message:${item.sessionId}:${item.messageId}`) || explicit.has(`session:${item.sessionId}`) || cascadedSessions.has(item.sessionId))
}

function nonEmptyDeltaEvent(event, snapshot) {
  if (event.workspaces.length || event.sessions.length || event.readMessages.length || event.tombstones.length) return event
  if (snapshot.workspaces.length) return { ...event, workspaces: [snapshot.workspaces[0]] }
  if (snapshot.sessions.length) return { ...event, sessions: [snapshot.sessions[0]] }
  if (snapshot.readMessages.length) return { ...event, readMessages: [snapshot.readMessages[0]] }
  return event
}

function snapshotCollectionsEqual(left, right) {
  return sameJson(left.workspaces, right.workspaces) && sameJson(left.sessions, right.sessions) && sameJson(left.readMessages, right.readMessages)
}

function compactLegacyEvents(events) {
  let known = null
  const output = []
  for (const event of events) {
    if (!event.complete || (known && !eventCanReplaceSnapshot(known, event))) {
      output.push(event)
      if (known) known = applyEventSnapshot(known, { ...event, complete: false })
      continue
    }
    const next = applyEventSnapshot(null, event)
    if (!known) {
      output.push(event)
      known = next
      continue
    }
    const compacted = nonEmptyDeltaEvent({
      ...event,
      workspaces: changedItems(known.workspaces, next.workspaces, item => item.workspaceId),
      sessions: changedItems(known.sessions, next.sessions, item => item.sessionId),
      readMessages: changedItems(known.readMessages, next.readMessages, item => `${item.sessionId}:${item.messageId}`)
    }, next)
    if (snapshotCollectionsEqual(applyEventSnapshot(known, { ...compacted, complete: false }), next)) {
      output.push(compacted)
    } else {
      output.splice(0, output.length, event)
    }
    known = next
  }
  return output
}

function normalizeStoreMode(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase()
  if (['5', 'v5', 'legacy', 'off', 'false', '0'].includes(normalized)) return 'v5'
  if (['shadow', 'compare'].includes(normalized)) return 'shadow'
  return 'v6'
}

function runtimePayload(record) {
  return {
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    preferredPort: record.preferredPort,
    heartbeats: record.heartbeats
  }
}

function sealedRuntimeRecord(record) {
  const payload = runtimePayload(record)
  return { ...payload, digest: sha256Canonical(payload) }
}

function emptyRuntimeRecord() {
  return { schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION, preferredPort: null, heartbeats: [] }
}

function normalizeRuntimeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== RUNTIME_RECORD_SCHEMA_VERSION) return null
  const preferredPort = Number(value.preferredPort)
  const heartbeats = new Map()
  for (const entry of Array.isArray(value.heartbeats) ? value.heartbeats : []) {
    const id = /^[a-f0-9]{16}$/.test(entry?.id || '') ? entry.id : ''
    const secretHash = /^[a-f0-9]{64}$/.test(entry?.secretHash || '') ? entry.secretHash : ''
    const lastSeenAt = safeDate(entry?.lastSeenAt)
    if (id && secretHash && lastSeenAt) heartbeats.set(id, { id, secretHash, lastSeenAt })
  }
  const normalized = {
    schemaVersion: RUNTIME_RECORD_SCHEMA_VERSION,
    preferredPort: Number.isInteger(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535 ? preferredPort : null,
    heartbeats: [...heartbeats.values()].slice(-32)
  }
  if (!/^[a-f0-9]{64}$/.test(value.digest || '') || sha256Canonical(runtimePayload(normalized)) !== value.digest) return null
  return normalized
}

function applyRuntimeRecord(state, record) {
  let changed = false
  const heartbeatById = new Map(record.heartbeats.map(entry => [entry.id, entry]))
  const devices = state.devices.map(device => {
    const heartbeat = heartbeatById.get(device.id)
    if (!heartbeat || heartbeat.secretHash !== device.secretHash || heartbeat.lastSeenAt === device.lastSeenAt) return device
    changed = true
    return { ...device, lastSeenAt: heartbeat.lastSeenAt }
  })
  const preferredPort = record.preferredPort || state.preferredPort
  if (preferredPort !== state.preferredPort) changed = true
  return changed ? { ...state, preferredPort, devices } : state
}

function atomicTempPrefix(target) {
  return `${path.basename(target)}.atomic-`
}

function cleanupAtomicTemps(target) {
  const directory = path.dirname(target)
  let entries
  try { entries = readdirSync(directory) } catch { return }
  const prefix = atomicTempPrefix(target)
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith('.tmp')) {
      try { rmSync(path.join(directory, entry), { force: true }) } catch {}
    }
  }
}

function fsyncDirectory(directory) {
  // Windows does not expose a durable directory-fsync primitive through Node;
  // attempting to fsync a directory handle only adds a second synchronous disk
  // flush without strengthening rename durability. The replacement file itself
  // is always fsynced before rename on every platform.
  if (process.platform === 'win32') return
  let handle
  try {
    handle = openSync(directory, 'r')
    fsyncSync(handle)
  } catch {
    // Some filesystems reject directory handles; the file fsync still prevents
    // a partially written payload from being published.
  } finally {
    if (handle != null) try { closeSync(handle) } catch {}
  }
}

function atomicWriteFile(target, content, { mode = 0o600, kind = 'main', crashInjector = null } = {}) {
  const directory = path.dirname(target)
  const transaction = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`
  const temporary = path.join(directory, `${atomicTempPrefix(target)}${transaction}.tmp`)
  let handle
  let published = false
  const boundary = phase => {
    if (typeof crashInjector !== 'function') return
    const point = `${kind}:${phase}`
    try { crashInjector(point, { kind, phase, target, temporary }) } catch (error) {
      const failure = error instanceof Error ? error : new Error('Simulated mobile sync crash.')
      failure.code ||= 'MOBILE_SYNC_SIMULATED_CRASH'
      failure.mobileSyncCrashPoint = point
      throw failure
    }
  }
  try {
    try {
      handle = openSync(temporary, 'wx', mode)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      handle = openSync(temporary, 'wx', mode)
    }
    boundary('temp-created')
    writeFileSync(handle, content)
    boundary('temp-written')
    fsyncSync(handle)
    boundary('file-fsynced')
    closeSync(handle)
    handle = null
    boundary('before-rename')
    renameSync(temporary, target)
    published = true
    boundary('renamed')
    fsyncDirectory(directory)
    boundary('directory-fsynced')
  } catch (error) {
    if (handle != null) try { closeSync(handle) } catch {}
    if (!error?.mobileSyncCrashPoint && !published) {
      try { rmSync(temporary, { force: true }) } catch {}
    }
    if (error && typeof error === 'object') error.mobileSyncPublished = published
    throw error
  }
}

class MobileSyncStore {
  constructor(file, secretAdapter = null, options = {}) {
    if (secretAdapter && typeof secretAdapter === 'object' && !normalizeSecretAdapter(secretAdapter) && (!options || Object.keys(options).length === 0)) {
      options = secretAdapter
      secretAdapter = null
    }
    this.file = file
    this.secretAdapter = normalizeSecretAdapter(secretAdapter)
    this.options = options && typeof options === 'object' ? options : {}
    this.mode = normalizeStoreMode(
      this.options.storageMode ??
      this.options.mode ??
      process.env.DSH_MOBILE_SYNC_STORE_VERSION ??
      process.env.DSH_MOBILE_SYNC_V6
    )
    this.crashInjector = typeof this.options.crashInjector === 'function' ? this.options.crashInjector : null
    this.runtimeFile = this.options.runtimeFile || `${this.file}${RUNTIME_RECORD_SUFFIX}`
    this.v5BackupFile = this.options.v5BackupFile || `${this.file}${V5_BACKUP_SUFFIX}`
    this.shadowComparison = null
    this.shadowComparisons = 0

    cleanupAtomicTemps(this.file)
    cleanupAtomicTemps(this.runtimeFile)
    cleanupAtomicTemps(this.v5BackupFile)
    const loaded = this.#load()
    this.persistedHeartbeats = new Map()
    this.#assignRuntimeRecord(this.#loadRuntimeRecord(), true)
    this.#assignState(applyRuntimeRecord(loaded.state, this.runtimeRecord))
    if (loaded.backupSource != null) this.#ensureV5Backup(loaded.backupSource)
    if (loaded.rewrite) {
      try {
        this.#persistMain(this.state)
      } catch (error) {
        if (error?.mobileSyncPublished) this.#assignState(this.state)
        throw error
      }
    } else if (this.mode === 'shadow') {
      this.#compareShadow(this.state)
    }
  }

  #load() {
    let text
    let source
    try {
      text = readFileSync(this.file, 'utf8')
      source = JSON.parse(text)
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: cloneDefaultState(), rewrite: false, backupSource: null }
      throw new Error('Unable to read mobile sync state; the file is missing, unreadable, or invalid.')
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Mobile sync state must be a JSON object.')

    const sourceSchemaVersion = Number(source.schemaVersion)
    if (Number.isFinite(sourceSchemaVersion) && sourceSchemaVersion > STATE_SCHEMA_VERSION) {
      throw new Error('Unable to read mobile sync state; the schema version is newer than this application.')
    }
    if (sourceSchemaVersion === STATE_SCHEMA_VERSION && source.storageFormat !== V6_STORAGE_FORMAT) {
      throw new Error('Unable to read mobile sync state; the storage format is unsupported.')
    }
    const storedMesh = source.mesh
    let mesh = storedMesh
    if (storedMesh?.secretEnvelope != null) mesh = decryptStoredMesh(storedMesh, this.secretAdapter)
    const state = normalizeState({ ...source, mesh })
    if (source.sync != null && !state.sync) throw new Error('Unable to read mobile sync state; the sync ledger is invalid.')
    if (storedMesh?.secretEnvelope != null && !state.mesh) throw new Error('Protected mobile sync mesh is invalid.')
    if (state.mesh && storedMesh?.secretEnvelope == null && !this.secretAdapter) {
      throw new Error('Legacy plaintext mobile sync secrets require OS-backed encryption before they can be loaded.')
    }

    let journalRequiresRewrite = false
    if (this.mode === 'v6' && state.sync) {
      if (sourceSchemaVersion <= LEGACY_STATE_SCHEMA_VERSION) {
        state.sync = { ...state.sync, events: boundDeltaJournal(compactLegacyEvents(state.sync.events), state.sync) }
      } else {
        const rawJournal = Array.isArray(source.sync?.deltaJournal) ? source.sync.deltaJournal : []
        if (Buffer.byteLength(JSON.stringify(rawJournal)) > SYNC_JOURNAL_BYTE_LIMIT) {
          state.sync = { ...state.sync, events: boundDeltaJournal(state.sync.events, state.sync) }
          journalRequiresRewrite = true
        }
      }
    }
    const targetVersion = this.mode === 'v6' ? STATE_SCHEMA_VERSION : LEGACY_STATE_SCHEMA_VERSION
    const serviceAddressChanged = Boolean(state.mesh && storedMesh?.serviceAddress !== state.mesh.serviceAddress)
    const plaintextRequiresEncryption = Boolean(state.mesh && storedMesh?.secretEnvelope == null)
    const backupSource = this.mode === 'v6' && sourceSchemaVersion === LEGACY_STATE_SCHEMA_VERSION && (!storedMesh || storedMesh.secretEnvelope != null)
      ? text
      : null
    return {
      state,
      rewrite: sourceSchemaVersion !== targetVersion || serviceAddressChanged || plaintextRequiresEncryption || journalRequiresRewrite,
      backupSource
    }
  }

  #loadRuntimeRecord() {
    try {
      const parsed = JSON.parse(readFileSync(this.runtimeFile, 'utf8'))
      const normalized = normalizeRuntimeRecord(parsed)
      if (!normalized) throw new Error('invalid runtime record')
      return normalized
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyRuntimeRecord()
      throw new Error('Unable to read the mobile sync runtime record; it is unreadable or invalid.')
    }
  }

  #ensureV5Backup(sourceText) {
    if (existsSync(this.v5BackupFile)) return
    try {
      atomicWriteFile(this.v5BackupFile, sourceText, { mode: 0o400, kind: 'backup', crashInjector: this.crashInjector })
      try { chmodSync(this.v5BackupFile, 0o400) } catch {}
    } catch (error) {
      if (error?.mobileSyncPublished) try { chmodSync(this.v5BackupFile, 0o400) } catch {}
      throw error
    }
  }

  #diskState(state) {
    return this.mode === 'v6'
      ? diskV6State(state, this.secretAdapter)
      : exportV5State(state, this.secretAdapter)
  }

  #compareShadow(state) {
    const legacyCandidate = legacyLogicalState(state)
    const v6Candidate = diskV6State(state, this.secretAdapter)
    // Shadow conversion never writes and never calls commit twice. Replace the
    // protected envelope with the already-open in-memory secret solely for the
    // canonical semantic comparison.
    const normalizedLegacy = normalizeState(legacyCandidate)
    const normalizedV6 = normalizeState({ ...v6Candidate, mesh: state.mesh })
    const legacyHash = canonicalStateHash(normalizedLegacy)
    const v6Hash = canonicalStateHash(normalizedV6)
    this.shadowComparisons += 1
    this.shadowComparison = Object.freeze({
      legacyHash,
      v6Hash,
      equal: legacyHash === v6Hash,
      comparison: this.shadowComparisons
    })
    if (!this.shadowComparison.equal) {
      throw Object.assign(new Error('Mobile sync v6 shadow comparison diverged.'), { code: 'MOBILE_SYNC_SHADOW_DIVERGENCE' })
    }
  }

  #persistMain(state) {
    if (this.mode === 'shadow') this.#compareShadow(state)
    const disk = this.#diskState(state)
    const serialized = `${this.mode === 'v6' ? JSON.stringify(disk) : JSON.stringify(disk, null, 2)}\n`
    atomicWriteFile(this.file, serialized, { mode: 0o600, kind: 'main', crashInjector: this.crashInjector })
  }

  #persistRuntime(record) {
    const serialized = `${JSON.stringify(sealedRuntimeRecord(record))}\n`
    atomicWriteFile(this.runtimeFile, serialized, { mode: 0o600, kind: 'runtime', crashInjector: this.crashInjector })
  }

  #assignRuntimeRecord(record, persisted = false) {
    this.runtimeRecord = record
    if (!persisted) return
    const persistedHeartbeats = new Map()
    for (const heartbeat of record.heartbeats) {
      const timestamp = Date.parse(heartbeat.lastSeenAt)
      if (Number.isFinite(timestamp)) persistedHeartbeats.set(heartbeat.id, { timestamp, secretHash: heartbeat.secretHash })
    }
    this.persistedHeartbeats = persistedHeartbeats
  }

  #assignState(state) {
    const schemaVersion = this.mode === 'v6' ? STATE_SCHEMA_VERSION : LEGACY_STATE_SCHEMA_VERSION
    this.state = deepFreeze(state.schemaVersion === schemaVersion ? state : { ...state, schemaVersion })
    this.syncSnapshot = this.state.sync
      ? Object.freeze({
          workspaces: this.state.sync.workspaces,
          sessions: this.state.sync.sessions,
          readMessages: this.state.sync.readMessages,
          tombstones: this.state.sync.tombstones
        })
      : EMPTY_SYNC_SNAPSHOT
  }

  #commitMain(next) {
    const frozen = deepFreeze(next)
    try {
      this.#persistMain(frozen)
    } catch (error) {
      if (error?.mobileSyncPublished) this.#assignState(frozen)
      throw error
    }
    this.#assignState(frozen)
    return this.get()
  }

  #commitRuntime(nextRecord, nextState) {
    try {
      this.#persistRuntime(nextRecord)
    } catch (error) {
      if (error?.mobileSyncPublished) {
        this.#assignRuntimeRecord(nextRecord, true)
        this.#assignState(nextState)
      }
      throw error
    }
    this.#assignRuntimeRecord(nextRecord, true)
    this.#assignState(nextState)
    return this.get()
  }

  get() {
    return this.state
  }

  getShadowComparison() {
    return this.shadowComparison
  }

  exportV5State() {
    return exportV5State(this.state, this.secretAdapter)
  }

  storageDiagnostics() {
    return Object.freeze({
      schemaVersion: STATE_SCHEMA_VERSION,
      mode: this.mode,
      storageFormat: this.mode === 'v6' ? V6_STORAGE_FORMAT : 'legacy-v5',
      runtimeFile: this.runtimeFile,
      v5BackupFile: this.v5BackupFile,
      shadowComparison: this.shadowComparison
    })
  }

  setEnabled(enabled) {
    const value = enabled === true
    if (value === this.state.enabled) return this.get()
    return this.#commitMain({ ...this.state, enabled: value })
  }

  setRemoteEnabled(enabled) {
    const value = enabled === true
    if (value === this.state.remoteEnabled) return this.get()
    return this.#commitMain({ ...this.state, remoteEnabled: value })
  }

  setTransportPreference(preference) {
    const value = ['auto', 'native-p2p', 'easytier', 'wss-relay', 'tailscale'].includes(preference) ? preference : 'auto'
    if (value === this.state.transportPreference) return this.get()
    return this.#commitMain({ ...this.state, transportPreference: value })
  }

  ensureMesh(meshFactory) {
    const generated = meshFactory()
    const merged = this.state.mesh ? { ...generated, ...this.state.mesh } : generated
    const normalized = normalizeMesh(merged)
    if (!normalized) throw new Error('Invalid mobile sync mesh configuration.')
    if (!this.secretAdapter) throw new Error('OS-backed mobile sync secret protection is unavailable.')
    if (!sameJson(normalized, this.state.mesh)) this.#commitMain({ ...this.state, mesh: normalized })
    return this.state.mesh
  }

  setPreferredPort(port) {
    const normalized = Number(port)
    if (!Number.isInteger(normalized) || normalized < 1024 || normalized > 65535 || normalized === this.state.preferredPort) return this.get()
    const nextRecord = { ...this.runtimeRecord, preferredPort: normalized }
    return this.#commitRuntime(nextRecord, { ...this.state, preferredPort: normalized })
  }

  addDevice(device) {
    const normalized = normalizeDevice(device)
    if (!normalized) throw new Error('Invalid mobile device record.')
    const devices = [...this.state.devices.filter(entry => entry.id !== normalized.id), normalized].slice(-32)
    return this.#commitMain({ ...this.state, devices })
  }

  touchDevice(id, date = new Date()) {
    const index = this.state.devices.findIndex(entry => entry.id === id)
    if (index < 0) return this.get()
    const lastSeenAt = date.toISOString()
    const device = this.state.devices[index]
    if (device.lastSeenAt === lastSeenAt) return this.get()
    const heartbeats = this.runtimeRecord.heartbeats.filter(entry => entry.id !== id)
    heartbeats.push({ id, secretHash: device.secretHash, lastSeenAt })
    const nextRecord = { ...this.runtimeRecord, heartbeats: heartbeats.slice(-32) }
    const devices = [...this.state.devices]
    devices[index] = { ...device, lastSeenAt }
    const nextState = { ...this.state, devices }
    const timestamp = Date.parse(lastSeenAt)
    const persistedHeartbeat = this.persistedHeartbeats.get(id)
    const persistedTimestamp = persistedHeartbeat?.timestamp
    if (
      Number.isFinite(timestamp) &&
      Number.isFinite(persistedTimestamp) &&
      persistedHeartbeat.secretHash === device.secretHash &&
      timestamp >= persistedTimestamp &&
      timestamp - persistedTimestamp < RUNTIME_HEARTBEAT_PERSIST_INTERVAL_MS
    ) {
      // Sub-second heartbeat bursts update the authoritative in-memory view but
      // retain the most recent durable heartbeat. Normal heartbeats are spaced
      // beyond this window, and preferred-port changes always persist at once.
      this.#assignRuntimeRecord(nextRecord)
      this.#assignState(nextState)
      return this.get()
    }
    return this.#commitRuntime(nextRecord, nextState)
  }

  revokeDevice(id) {
    if (!this.state.devices.some(entry => entry.id === id)) return this.get()
    return this.#commitMain({ ...this.state, devices: this.state.devices.filter(entry => entry.id !== id) })
  }

  readSyncReadMessages() {
    return this.state.sync?.readMessages || EMPTY_ARRAY
  }

  readSyncChanges({ snapshotEpoch = null, cursor = null } = {}) {
    const sync = this.state.sync
    if (!sync) {
      return {
        schemaVersion: SYNC_PROTOCOL_VERSION,
        snapshotEpoch: 0,
        revision: 0,
        cursor: '',
        complete: false,
        resetRequired: snapshotEpoch != null || cursor != null,
        snapshot: EMPTY_SYNC_SNAPSHOT,
        changes: EMPTY_ARRAY
      }
    }
    const requestedCursor = safeSyncCursor(cursor)
    const resumeRequested = snapshotEpoch != null || cursor != null
    const sameEpoch = snapshotEpoch != null && snapshotEpoch !== '' && Number(snapshotEpoch) === sync.snapshotEpoch
    const eventIndex = requestedCursor ? sync.events.findIndex(event => event.cursor === requestedCursor) : -1
    const canResume = sameEpoch && Boolean(requestedCursor) && (requestedCursor === sync.cursor || eventIndex >= 0)
    return {
      schemaVersion: SYNC_PROTOCOL_VERSION,
      snapshotEpoch: sync.snapshotEpoch,
      revision: sync.revision,
      cursor: sync.cursor,
      complete: sync.complete,
      updatedAt: sync.updatedAt,
      resetRequired: resumeRequested && !canResume,
      snapshot: canResume ? null : this.syncSnapshot,
      changes: canResume
        ? (requestedCursor === sync.cursor ? EMPTY_ARRAY : sync.events.slice(eventIndex + 1))
        : EMPTY_ARRAY
    }
  }

  commitSyncManifest(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Mobile sync manifest must be an object.')
    const complete = input.complete === true
    const hasWorkspaces = Object.prototype.hasOwnProperty.call(input, 'workspaces')
    const hasSessions = Object.prototype.hasOwnProperty.call(input, 'sessions')
    const hasReadMessages = Object.prototype.hasOwnProperty.call(input, 'readMessages')
    if (complete && (!hasWorkspaces || !hasSessions)) throw new TypeError('A complete mobile sync manifest requires workspace and session snapshots.')
    if (hasWorkspaces && !Array.isArray(input.workspaces)) throw new TypeError('Mobile sync workspaces must be an array.')
    if (hasSessions && !Array.isArray(input.sessions)) throw new TypeError('Mobile sync sessions must be an array.')
    if (hasReadMessages && !Array.isArray(input.readMessages)) throw new TypeError('Mobile sync read-message metadata must be an array.')
    const workspaces = hasWorkspaces ? normalizeSyncItems('workspace', input.workspaces) : null
    const sessions = hasSessions ? normalizeSyncItems('session', input.sessions) : null
    const readMessages = hasReadMessages ? normalizeReadMessages(input.readMessages) : null
    const explicitTombstones = (Array.isArray(input.tombstones) ? input.tombstones : []).flatMap(value => {
      const kind = ['workspace', 'session', 'read-message'].includes(value?.kind) ? value.kind : ''
      const id = safeSyncText(value?.id, kind === 'workspace' ? 512 : 520)
      return kind && id ? [{ kind, id }] : []
    }).slice(-SYNC_TOMBSTONE_LIMIT)
    const operationId = safeSyncText(input.operationId, 160) || randomBytes(16).toString('hex')
    const recordedAt = safeDate(input.observedAt) || new Date().toISOString()
    const digest = createHash('sha256').update(JSON.stringify({ complete, workspaces, sessions, readMessages, explicitTombstones })).digest('hex')
    const current = this.state.sync
    const existing = current?.operations.find(operation => operation.operationId === operationId)
    if (existing) {
      if (existing.digest !== digest) throw Object.assign(new Error('Mobile sync operation id was reused with different content.'), { code: 'MOBILE_SYNC_OPERATION_CONFLICT' })
      return { ...this.readSyncChanges({ snapshotEpoch: current.snapshotEpoch, cursor: existing.cursor }), applied: false, duplicate: true, protected: false }
    }
    if (!complete && !current) return { ...this.readSyncChanges(), applied: false, duplicate: false, protected: true }
    if (!complete && input.snapshotEpoch != null && Number(input.snapshotEpoch) !== current.snapshotEpoch) throw Object.assign(new Error('Mobile sync snapshot epoch changed.'), { code: 'MOBILE_SYNC_EPOCH_CONFLICT' })
    if (!complete && input.revision != null && Number(input.revision) <= current.revision) throw Object.assign(new Error('Mobile sync revision must advance monotonically.'), { code: 'MOBILE_SYNC_REVISION_CONFLICT' })
    if (!complete && !workspaces?.length && !sessions?.length && !readMessages?.length && !explicitTombstones.length) {
      return { ...this.readSyncChanges(), complete: false, applied: false, duplicate: false, protected: true }
    }

    if (complete && current) {
      const explicit = new Set(explicitTombstones.map(value => `${value.kind}:${value.id}`))
      const workspaceIds = new Set(workspaces.map(item => item.workspaceId))
      const sessionIds = new Set(sessions.map(item => item.sessionId))
      const readIds = new Set((readMessages || []).map(item => `${item.sessionId}:${item.messageId}`))
      const missing = [
        ...current.workspaces.filter(item => !workspaceIds.has(item.workspaceId)).map(item => `workspace:${item.workspaceId}`),
        ...current.sessions.filter(item => !sessionIds.has(item.sessionId)).map(item => `session:${item.sessionId}`),
        ...current.readMessages.filter(item => !readIds.has(`${item.sessionId}:${item.messageId}`)).map(item => `read-message:${item.sessionId}:${item.messageId}`)
      ]
      if (missing.some(key => !explicit.has(key))) {
        return { ...this.readSyncChanges(), complete: false, applied: false, duplicate: false, protected: true }
      }
      const unchanged = explicitTombstones.length === 0 &&
        sameJson(workspaces, current.workspaces) &&
        sameJson(sessions, current.sessions) &&
        sameJson(readMessages || [], current.readMessages)
      if (unchanged) return { ...this.readSyncChanges(), applied: false, duplicate: false, protected: false }
    }

    const snapshotEpochValue = current?.snapshotEpoch ?? randomBytes(6).readUIntBE(0, 6)
    const revision = (current?.revision || 0) + 1
    const cursorValue = randomBytes(18).toString('base64url')
    const merge = (previous, incoming, identity) => {
      if (complete) return incoming || []
      const values = new Map(previous.map(item => [identity(item), item]))
      for (const item of incoming || []) values.set(identity(item), item)
      return [...values.values()]
    }
    let nextWorkspaces = merge(current?.workspaces || [], workspaces, item => item.workspaceId)
    let nextSessions = merge(current?.sessions || [], sessions, item => item.sessionId)
    let nextReadMessages = merge(current?.readMessages || [], readMessages, item => `${item.sessionId}:${item.messageId}`)
    const eventTombstones = explicitTombstones.map(value => ({ ...value, revision, cursor: cursorValue, deletedAt: recordedAt }))
    const deletedWorkspaces = new Set(eventTombstones.filter(value => value.kind === 'workspace').map(value => value.id))
    const deletedSessions = new Set(eventTombstones.filter(value => value.kind === 'session').map(value => value.id))
    const deletedReads = new Set(eventTombstones.filter(value => value.kind === 'read-message').map(value => value.id))
    const cascadedSessions = new Set(nextSessions.filter(item => deletedWorkspaces.has(item.workspaceId)).map(item => item.sessionId))
    nextWorkspaces = nextWorkspaces.filter(item => !deletedWorkspaces.has(item.workspaceId)).slice(-4096)
    nextSessions = nextSessions.filter(item => !deletedSessions.has(item.sessionId) && !cascadedSessions.has(item.sessionId)).slice(-4096)
    nextReadMessages = nextReadMessages.filter(item => !deletedReads.has(`${item.sessionId}:${item.messageId}`) && !deletedSessions.has(item.sessionId) && !cascadedSessions.has(item.sessionId)).slice(-4096)
    const retainedTombstones = new Map((current?.tombstones || []).map(value => [`${value.kind}:${value.id}`, value]))
    for (const tombstone of eventTombstones) retainedTombstones.set(`${tombstone.kind}:${tombstone.id}`, tombstone)
    for (const item of nextWorkspaces) retainedTombstones.delete(`workspace:${item.workspaceId}`)
    for (const item of nextSessions) retainedTombstones.delete(`session:${item.sessionId}`)
    for (const item of nextReadMessages) retainedTombstones.delete(`read-message:${item.sessionId}:${item.messageId}`)
    const allRetainedTombstones = [...retainedTombstones.values()]
    const tombstones = allRetainedTombstones.slice(-SYNC_TOMBSTONE_LIMIT)
    const tombstonesWerePruned = allRetainedTombstones.length !== tombstones.length

    const deltaEvent = nonEmptyDeltaEvent({
      cursor: cursorValue,
      revision,
      operationId,
      recordedAt,
      complete,
      workspaces: complete && current ? changedItems(current.workspaces, nextWorkspaces, item => item.workspaceId) : (workspaces || []),
      sessions: complete && current ? changedItems(current.sessions, nextSessions, item => item.sessionId) : (sessions || []),
      readMessages: complete && current ? changedItems(current.readMessages, nextReadMessages, item => `${item.sessionId}:${item.messageId}`) : (readMessages || []),
      tombstones: eventTombstones
    }, { workspaces: nextWorkspaces, sessions: nextSessions, readMessages: nextReadMessages })
    const completeOrderPreserved = Boolean(current && complete && explicitTombstones.length === 0 &&
      sameIdentityOrder(current.workspaces, nextWorkspaces, item => item.workspaceId) &&
      sameIdentityOrder(current.sessions, nextSessions, item => item.sessionId) &&
      sameIdentityOrder(current.readMessages, nextReadMessages, item => `${item.sessionId}:${item.messageId}`))
    const replayed = current && !completeOrderPreserved ? applyEventSnapshot(current, { ...deltaEvent, complete: false }) : null
    const deltaIsLossless = !tombstonesWerePruned && (!current || completeOrderPreserved || snapshotCollectionsEqual(
      replayed,
      { workspaces: nextWorkspaces, sessions: nextSessions, readMessages: nextReadMessages }
    ))
    const event = deltaIsLossless
      ? deltaEvent
      : { ...deltaEvent, complete: true, workspaces: nextWorkspaces, sessions: nextSessions, readMessages: nextReadMessages }
    const events = boundDeltaJournal(deltaIsLossless ? [...(current?.events || []), event] : [event], event)
    const sync = {
      schemaVersion: SYNC_PROTOCOL_VERSION,
      snapshotEpoch: snapshotEpochValue,
      revision,
      cursor: cursorValue,
      complete: complete || current?.complete === true,
      updatedAt: recordedAt,
      workspaces: nextWorkspaces,
      sessions: nextSessions,
      readMessages: nextReadMessages,
      tombstones,
      events,
      operations: [...(current?.operations || []), { operationId, digest, cursor: cursorValue }].slice(-SYNC_OPERATION_LIMIT)
    }
    this.#commitMain({ ...this.state, sync })
    const previousCursor = current?.cursor || null
    return { ...this.readSyncChanges(previousCursor ? { snapshotEpoch: snapshotEpochValue, cursor: previousCursor } : {}), applied: true, duplicate: false, protected: false }
  }
}

module.exports = {
  MobileSyncStore,
  DEFAULT_STATE,
  SECRET_ENVELOPE_VERSION,
  LEGACY_STATE_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
  RUNTIME_RECORD_SCHEMA_VERSION,
  V6_STORAGE_FORMAT,
  V5_BACKUP_SUFFIX,
  RUNTIME_RECORD_SUFFIX,
  ATOMIC_WRITE_PHASES,
  SYNC_PROTOCOL_VERSION,
  SYNC_EVENT_LIMIT,
  SYNC_OPERATION_LIMIT,
  SYNC_TOMBSTONE_LIMIT,
  SYNC_JOURNAL_BYTE_LIMIT,
  normalizeState,
  normalizeDevice,
  normalizeMesh,
  normalizeSyncItem,
  normalizeSyncState,
  normalizeV6SyncState,
  exportV5State,
  canonicalStateHash,
  safeName,
  DEFAULT_SERVICE_ADDRESS
}
