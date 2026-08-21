const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const DEFAULT_SERVICE_ADDRESS = '10.253.77.254'
const LEGACY_SERVICE_ADDRESS = '10.254.77.254'
const SECRET_ENVELOPE_VERSION = 1
const STATE_SCHEMA_VERSION = 4

const DEFAULT_STATE = Object.freeze({
  schemaVersion: STATE_SCHEMA_VERSION,
  enabled: false,
  remoteEnabled: true,
  transportPreference: 'auto',
  preferredPort: 3081,
  mesh: null,
  devices: []
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
    transportPreference: ['auto', 'easytier', 'wss-relay', 'tailscale'].includes(value.transportPreference)
      ? value.transportPreference
      : DEFAULT_STATE.transportPreference,
    preferredPort: Number.isInteger(preferredPort) && preferredPort >= 1024 && preferredPort <= 65535
      ? preferredPort
      : DEFAULT_STATE.preferredPort,
    mesh: normalizeMesh(value.mesh),
    devices
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
      rewrite: Boolean(state.mesh) || (Number(source.schemaVersion) !== STATE_SCHEMA_VERSION && source.mesh != null)
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
      state.transportPreference = ['auto', 'easytier', 'wss-relay', 'tailscale'].includes(preference) ? preference : 'auto'
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
}

module.exports = {
  MobileSyncStore,
  DEFAULT_STATE,
  SECRET_ENVELOPE_VERSION,
  STATE_SCHEMA_VERSION,
  normalizeState,
  normalizeDevice,
  normalizeMesh,
  safeName,
  DEFAULT_SERVICE_ADDRESS
}
