const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const DEFAULT_SERVICE_ADDRESS = '10.253.77.254'
const LEGACY_SERVICE_ADDRESS = '10.254.77.254'

const DEFAULT_STATE = Object.freeze({
  schemaVersion: 3,
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

function normalizeDevice(value) {
  if (!value || typeof value !== 'object') return null
  if (!/^[a-f0-9]{16}$/.test(value.id || '')) return null
  if (!/^[a-f0-9]{64}$/.test(value.secretHash || '')) return null
  return {
    id: value.id,
    secretHash: value.secretHash,
    name: safeName(value.name),
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
    schemaVersion: 3,
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

class MobileSyncStore {
  constructor(file) {
    this.file = file
    this.state = this.#load()
  }

  #load() {
    try { return normalizeState(JSON.parse(readFileSync(this.file, 'utf8'))) }
    catch { return cloneDefaultState() }
  }

  #persist() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.file)
  }

  get() {
    return JSON.parse(JSON.stringify(this.state))
  }

  setEnabled(enabled) {
    this.state.enabled = enabled === true
    this.#persist()
    return this.get()
  }

  setRemoteEnabled(enabled) {
    this.state.remoteEnabled = enabled === true
    this.#persist()
    return this.get()
  }

  setTransportPreference(preference) {
    this.state.transportPreference = ['auto', 'easytier', 'wss-relay', 'tailscale'].includes(preference) ? preference : 'auto'
    this.#persist()
    return this.get()
  }

  ensureMesh(meshFactory) {
    const generated = meshFactory()
    const merged = this.state.mesh ? { ...generated, ...this.state.mesh } : generated
    const normalized = normalizeMesh(merged)
    if (!normalized) throw new Error('Invalid mobile sync mesh configuration.')
    if (JSON.stringify(normalized) !== JSON.stringify(this.state.mesh)) {
      this.state.mesh = normalized
      this.#persist()
    }
    return JSON.parse(JSON.stringify(this.state.mesh))
  }

  setPreferredPort(port) {
    const normalized = Number(port)
    if (Number.isInteger(normalized) && normalized >= 1024 && normalized <= 65535) {
      this.state.preferredPort = normalized
      this.#persist()
    }
    return this.get()
  }

  addDevice(device) {
    const normalized = normalizeDevice(device)
    if (!normalized) throw new Error('Invalid mobile device record.')
    this.state.devices = this.state.devices.filter(entry => entry.id !== normalized.id)
    this.state.devices.push(normalized)
    this.state.devices = this.state.devices.slice(-32)
    this.#persist()
    return this.get()
  }

  touchDevice(id, date = new Date()) {
    const device = this.state.devices.find(entry => entry.id === id)
    if (!device) return this.get()
    device.lastSeenAt = date.toISOString()
    this.#persist()
    return this.get()
  }

  revokeDevice(id) {
    const before = this.state.devices.length
    this.state.devices = this.state.devices.filter(entry => entry.id !== id)
    if (this.state.devices.length !== before) this.#persist()
    return this.get()
  }
}

module.exports = {
  MobileSyncStore,
  DEFAULT_STATE,
  normalizeState,
  normalizeDevice,
  normalizeMesh,
  safeName,
  DEFAULT_SERVICE_ADDRESS
}
