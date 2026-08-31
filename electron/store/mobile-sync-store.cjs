const { createHash, randomBytes } = require('node:crypto')
const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const DEFAULT_SERVICE_ADDRESS = '10.253.77.254'
const LEGACY_SERVICE_ADDRESS = '10.254.77.254'
const SECRET_ENVELOPE_VERSION = 1
const SYNC_PROTOCOL_VERSION = 1
const SYNC_EVENT_LIMIT = 128
const SYNC_OPERATION_LIMIT = 64
const SYNC_TOMBSTONE_LIMIT = 512
const STATE_SCHEMA_VERSION = 5

const DEFAULT_STATE = Object.freeze({
  schemaVersion: STATE_SCHEMA_VERSION,
  enabled: false,
  remoteEnabled: true,
  transportPreference: 'auto',
  preferredPort: 3081,
  mesh: null,
  devices: [],
  sync: null
})

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE))
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

function normalizeSyncState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshotEpoch = Number(value.snapshotEpoch)
  const revision = Number(value.revision)
  const cursor = safeSyncCursor(value.cursor)
  if (!Number.isSafeInteger(snapshotEpoch) || snapshotEpoch < 0 || !Number.isSafeInteger(revision) || revision < 0 || !cursor) return null
  const workspaces = normalizeSyncItems('workspace', value.workspaces)
  const sessions = normalizeSyncItems('session', value.sessions)
  const readMessages = normalizeReadMessages(value.readMessages)
  const tombstones = (Array.isArray(value.tombstones) ? value.tombstones : []).map(normalizeSyncTombstone).filter(Boolean).slice(-SYNC_TOMBSTONE_LIMIT)
  const events = (Array.isArray(value.events) ? value.events : []).flatMap(event => {
    const eventCursor = safeSyncCursor(event?.cursor)
    const eventRevision = Number(event?.revision)
    if (!eventCursor || !Number.isSafeInteger(eventRevision) || eventRevision < 1 || eventRevision > revision) return []
    return [{
      cursor: eventCursor,
      revision: eventRevision,
      operationId: safeSyncText(event.operationId, 160),
      recordedAt: safeDate(event.recordedAt) || new Date(0).toISOString(),
      complete: event.complete === true,
      workspaces: normalizeSyncItems('workspace', event.workspaces),
      sessions: normalizeSyncItems('session', event.sessions),
      readMessages: normalizeReadMessages(event.readMessages),
      tombstones: (Array.isArray(event.tombstones) ? event.tombstones : []).map(normalizeSyncTombstone).filter(Boolean).slice(-SYNC_TOMBSTONE_LIMIT)
    }]
  }).sort((left, right) => left.revision - right.revision).slice(-SYNC_EVENT_LIMIT)
  const operations = (Array.isArray(value.operations) ? value.operations : []).flatMap(operation => {
    const operationId = safeSyncText(operation?.operationId, 160)
    const digest = /^[a-f0-9]{64}$/.test(operation?.digest || '') ? operation.digest : ''
    const operationCursor = safeSyncCursor(operation?.cursor)
    if (!operationId || !digest || !operationCursor) return []
    return [{ operationId, digest, cursor: operationCursor }]
  }).slice(-SYNC_OPERATION_LIMIT)
  return {
    schemaVersion: SYNC_PROTOCOL_VERSION,
    snapshotEpoch,
    revision,
    cursor,
    complete: value.complete === true,
    updatedAt: safeDate(value.updatedAt),
    workspaces,
    sessions,
    readMessages,
    tombstones,
    events,
    operations
  }
}

function normalizeState(input) {
  const value = input && typeof input === 'object' ? input : {}
  const preferredPort = Number(value.preferredPort)
  const devices = Array.isArray(value.devices)
    ? value.devices.map(normalizeDevice).filter(Boolean).slice(-32)
    : []
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
    sync: normalizeSyncState(value.sync)
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

class MobileSyncStore {
  constructor(file, secretAdapter = null) {
    this.file = file
    this.secretAdapter = normalizeSecretAdapter(secretAdapter)
    const loaded = this.#load()
    this.state = loaded.state
    if (loaded.rewrite) this.#persist()
  }

  #load() {
    let source
    try {
      source = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: cloneDefaultState(), rewrite: false }
      throw new Error('Unable to read mobile sync state; the file is missing, unreadable, or invalid.')
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Mobile sync state must be a JSON object.')

    const storedMesh = source.mesh
    if (storedMesh?.secretEnvelope != null) {
      const mesh = decryptStoredMesh(storedMesh, this.secretAdapter)
      const state = normalizeState({ ...source, mesh })
      if (!state.mesh) throw new Error('Protected mobile sync mesh is invalid.')
      const rewrite = Number(source.schemaVersion) !== STATE_SCHEMA_VERSION || storedMesh.serviceAddress !== state.mesh.serviceAddress
      return { state, rewrite }
    }

    const state = normalizeState(source)
    if (state.mesh && !this.secretAdapter) {
      throw new Error('Legacy plaintext mobile sync secrets require OS-backed encryption before they can be loaded.')
    }
    return {
      state,
      rewrite: Boolean(state.mesh) || Number(source.schemaVersion) !== STATE_SCHEMA_VERSION
    }
  }

  #diskState() {
    return {
      ...this.state,
      mesh: publicStoredMesh(this.state.mesh, this.secretAdapter)
    }
  }

  #persist() {
    const serialized = `${JSON.stringify(this.#diskState(), null, 2)}\n`
    mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, serialized, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.file)
  }

  #update(mutator) {
    const previous = this.get()
    mutator(this.state)
    try {
      this.#persist()
    } catch (error) {
      this.state = previous
      throw error
    }
    return this.get()
  }

  get() {
    return JSON.parse(JSON.stringify(this.state))
  }

  setEnabled(enabled) {
    return this.#update(state => { state.enabled = enabled === true })
  }

  setRemoteEnabled(enabled) {
    return this.#update(state => { state.remoteEnabled = enabled === true })
  }

  setTransportPreference(preference) {
    return this.#update(state => {
      state.transportPreference = ['auto', 'native-p2p', 'easytier', 'wss-relay', 'tailscale'].includes(preference) ? preference : 'auto'
    })
  }

  ensureMesh(meshFactory) {
    const generated = meshFactory()
    const merged = this.state.mesh ? { ...generated, ...this.state.mesh } : generated
    const normalized = normalizeMesh(merged)
    if (!normalized) throw new Error('Invalid mobile sync mesh configuration.')
    if (!this.secretAdapter) throw new Error('OS-backed mobile sync secret protection is unavailable.')
    if (JSON.stringify(normalized) !== JSON.stringify(this.state.mesh)) {
      this.#update(state => { state.mesh = normalized })
    }
    return JSON.parse(JSON.stringify(this.state.mesh))
  }

  setPreferredPort(port) {
    const normalized = Number(port)
    if (Number.isInteger(normalized) && normalized >= 1024 && normalized <= 65535) {
      return this.#update(state => { state.preferredPort = normalized })
    }
    return this.get()
  }

  addDevice(device) {
    const normalized = normalizeDevice(device)
    if (!normalized) throw new Error('Invalid mobile device record.')
    return this.#update(state => {
      state.devices = state.devices.filter(entry => entry.id !== normalized.id)
      state.devices.push(normalized)
      state.devices = state.devices.slice(-32)
    })
  }

  touchDevice(id, date = new Date()) {
    const device = this.state.devices.find(entry => entry.id === id)
    if (!device) return this.get()
    return this.#update(state => {
      state.devices.find(entry => entry.id === id).lastSeenAt = date.toISOString()
    })
  }

  revokeDevice(id) {
    if (!this.state.devices.some(entry => entry.id === id)) return this.get()
    return this.#update(state => {
      state.devices = state.devices.filter(entry => entry.id !== id)
    })
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
        snapshot: { workspaces: [], sessions: [], readMessages: [], tombstones: [] },
        changes: []
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
      snapshot: canResume ? null : {
        workspaces: JSON.parse(JSON.stringify(sync.workspaces)),
        sessions: JSON.parse(JSON.stringify(sync.sessions)),
        readMessages: JSON.parse(JSON.stringify(sync.readMessages)),
        tombstones: JSON.parse(JSON.stringify(sync.tombstones))
      },
      changes: canResume
        ? JSON.parse(JSON.stringify(requestedCursor === sync.cursor ? [] : sync.events.slice(eventIndex + 1)))
        : []
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
    })
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
        JSON.stringify(workspaces) === JSON.stringify(current.workspaces) &&
        JSON.stringify(sessions) === JSON.stringify(current.sessions) &&
        JSON.stringify(readMessages || []) === JSON.stringify(current.readMessages)
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
    nextWorkspaces = nextWorkspaces.filter(item => !deletedWorkspaces.has(item.workspaceId))
    nextSessions = nextSessions.filter(item => !deletedSessions.has(item.sessionId) && !deletedWorkspaces.has(item.workspaceId))
    nextReadMessages = nextReadMessages.filter(item => !deletedReads.has(`${item.sessionId}:${item.messageId}`) && !deletedSessions.has(item.sessionId))
    const retainedTombstones = new Map((current?.tombstones || []).map(value => [`${value.kind}:${value.id}`, value]))
    for (const tombstone of eventTombstones) retainedTombstones.set(`${tombstone.kind}:${tombstone.id}`, tombstone)
    for (const item of nextWorkspaces) retainedTombstones.delete(`workspace:${item.workspaceId}`)
    for (const item of nextSessions) retainedTombstones.delete(`session:${item.sessionId}`)
    for (const item of nextReadMessages) retainedTombstones.delete(`read-message:${item.sessionId}:${item.messageId}`)
    const event = {
      cursor: cursorValue,
      revision,
      operationId,
      recordedAt,
      complete,
      workspaces: workspaces || [],
      sessions: sessions || [],
      readMessages: readMessages || [],
      tombstones: eventTombstones
    }
    this.#update(state => {
      state.sync = {
        schemaVersion: SYNC_PROTOCOL_VERSION,
        snapshotEpoch: snapshotEpochValue,
        revision,
        cursor: cursorValue,
        complete: complete || current?.complete === true,
        updatedAt: recordedAt,
        workspaces: nextWorkspaces,
        sessions: nextSessions,
        readMessages: nextReadMessages,
        tombstones: [...retainedTombstones.values()].slice(-SYNC_TOMBSTONE_LIMIT),
        events: [...(current?.events || []), event].slice(-SYNC_EVENT_LIMIT),
        operations: [...(current?.operations || []), { operationId, digest, cursor: cursorValue }].slice(-SYNC_OPERATION_LIMIT)
      }
    })
    const previousCursor = current?.cursor || null
    return { ...this.readSyncChanges(previousCursor ? { snapshotEpoch: snapshotEpochValue, cursor: previousCursor } : {}), applied: true, duplicate: false, protected: false }
  }
}

module.exports = {
  MobileSyncStore,
  DEFAULT_STATE,
  SECRET_ENVELOPE_VERSION,
  STATE_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_EVENT_LIMIT,
  SYNC_OPERATION_LIMIT,
  SYNC_TOMBSTONE_LIMIT,
  normalizeState,
  normalizeDevice,
  normalizeMesh,
  normalizeSyncItem,
  normalizeSyncState,
  safeName,
  DEFAULT_SERVICE_ADDRESS
}
