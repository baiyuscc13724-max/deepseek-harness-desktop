const { EventEmitter } = require('node:events')
const { randomBytes } = require('node:crypto')
const { DEFAULT_SERVICE_ADDRESS } = require('../store/mobile-sync-store.cjs')

const REMOTE_TRANSPORT_ORDER = Object.freeze(['wss-relay', 'easytier', 'tailscale'])

function createMeshIdentity() {
  return {
    networkName: `harness-${randomBytes(10).toString('hex')}`,
    networkSecret: randomBytes(32).toString('base64url'),
    desktopAddress: '10.254.77.1',
    serviceAddress: DEFAULT_SERVICE_ADDRESS,
    relayRoomId: randomBytes(32).toString('base64url'),
    relayTunnelKey: randomBytes(32).toString('base64url')
  }
}

class SyncTransportManager extends EventEmitter {
  constructor({
    store,
    adapters = [],
    now = () => Date.now(),
    random = Math.random,
    reconnectBaseMs = 1_000,
    reconnectMaxMs = 30_000
  }) {
    super()
    if (!store) throw new Error('SyncTransportManager requires a store.')
    this.store = store
    this.adapters = new Map(adapters.map(adapter => [adapter.id, adapter]))
    this.now = now
    this.random = random
    this.reconnectBaseMs = reconnectBaseMs
    this.reconnectMaxMs = reconnectMaxMs
    this.reconnectTimer = null
    this.reconnectAttempt = 0
    this.reconnectAt = null
    this.active = null
    this.status = 'stopped'
    this.error = null
    this.startedAt = null
    this.context = null
    this.switching = null
    for (const adapter of adapters) {
      adapter.on?.('disconnect', error => this.#handleDisconnect(adapter.id, error))
      adapter.on?.('state', () => this.publish())
    }
  }

  orderedAdapterIds(preference = this.store.get().transportPreference) {
    if (REMOTE_TRANSPORT_ORDER.includes(preference)) {
      return [preference, ...REMOTE_TRANSPORT_ORDER.filter(id => id !== preference)]
    }
    return [...REMOTE_TRANSPORT_ORDER]
  }

  state() {
    const saved = this.store.get()
    return {
      enabled: saved.remoteEnabled,
      preference: saved.transportPreference,
      status: saved.remoteEnabled ? this.status : 'disabled',
      active: this.active,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      error: this.error,
      reconnectAt: this.reconnectAt ? new Date(this.reconnectAt).toISOString() : null,
      adapters: this.orderedAdapterIds().map(id => {
        const adapter = this.adapters.get(id)
        return adapter?.state?.() || { id, available: false, status: 'unavailable', detail: '组件尚未准备' }
      })
    }
  }

  publish() {
    const state = this.state()
    this.emit('state', state)
    return state
  }

  #clearReconnect({ resetAttempt = false } = {}) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectAt = null
    if (resetAttempt) this.reconnectAttempt = 0
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || !this.store.get().remoteEnabled || !this.context?.port) return
    const exponential = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** Math.min(this.reconnectAttempt, 8)))
    const jitter = 0.75 + Math.max(0, Math.min(1, this.random())) * 0.5
    const delay = Math.max(1, Math.round(exponential * jitter))
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 9)
    this.reconnectAt = this.now() + delay
    this.status = 'reconnecting'
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAt = null
      if (!this.store.get().remoteEnabled || !this.context?.port) return
      this.start().catch(error => {
        this.error = error?.message || String(error)
        this.#scheduleReconnect()
      })
    }, delay)
    this.reconnectTimer.unref?.()
    this.publish()
  }

  async start(context = this.context) {
    this.context = context || this.context
    if (!this.store.get().remoteEnabled) return this.publish()
    if (!this.context?.port) throw new Error('Remote sync requires a running mobile gateway.')
    if (this.switching) return this.switching
    this.#clearReconnect()
    this.switching = this.#startAvailable().finally(() => { this.switching = null })
    return this.switching
  }

  async #startAvailable(exclude = new Set()) {
    this.status = 'connecting'
    this.error = null
    this.publish()
    const failures = []
    for (const id of this.orderedAdapterIds()) {
      if (exclude.has(id)) continue
      const adapter = this.adapters.get(id)
      if (!adapter?.available?.() && typeof adapter?.prepare === 'function') {
        try {
          await adapter.prepare()
        } catch (error) {
          failures.push(`${id}: ${error.message}`)
          continue
        }
      }
      if (!adapter?.available?.()) {
        failures.push(`${id}: 组件尚未准备`)
        continue
      }
      try {
        await adapter.start({ ...this.context, mesh: this.store.ensureMesh(createMeshIdentity) })
        this.active = id
        this.status = 'connected'
        this.startedAt = this.now()
        this.error = null
        this.#clearReconnect({ resetAttempt: true })
        return this.publish()
      } catch (error) {
        failures.push(`${id}: ${error.message}`)
        await adapter.stop?.().catch(() => {})
      }
    }
    this.active = null
    this.status = 'unavailable'
    this.startedAt = null
    this.error = failures.join('；') || '没有可用的远程连接组件。'
    const state = this.publish()
    this.#scheduleReconnect()
    return state
  }

  async stop({ persist = false } = {}) {
    if (persist) this.store.setRemoteEnabled(false)
    this.#clearReconnect({ resetAttempt: true })
    const stops = [...this.adapters.values()].map(adapter => adapter.stop?.().catch(() => {}))
    await Promise.all(stops)
    this.active = null
    this.status = 'stopped'
    this.startedAt = null
    this.error = null
    return this.publish()
  }

  async setEnabled(enabled, context = this.context) {
    this.store.setRemoteEnabled(enabled)
    if (!enabled) return this.stop({ persist: false })
    return this.start(context)
  }

  async setPreference(preference) {
    this.store.setTransportPreference(preference)
    if (this.status === 'connected') {
      await this.stop({ persist: false })
      return this.start()
    }
    return this.publish()
  }

  async configureWssRelay(relayUrl) {
    const adapter = this.adapters.get('wss-relay')
    if (!adapter || typeof adapter.configureRelayUrl !== 'function') throw new Error('WSS relay adapter does not support runtime configuration.')
    if (this.switching) await this.switching
    const shouldRestart = Boolean(this.context?.port && this.store.get().remoteEnabled)
    await this.stop({ persist: false })
    adapter.configureRelayUrl(relayUrl)
    if (shouldRestart) return this.start()
    return this.publish()
  }

  pairingTransports() {
    const result = []
    for (const adapter of this.adapters.values()) {
      const config = adapter.pairingConfig?.()
      if (config) result.push(config)
    }
    return result
  }

  async #handleDisconnect(id, error) {
    if (id !== this.active || !this.store.get().remoteEnabled || this.switching) return
    this.active = null
    this.status = 'reconnecting'
    this.error = error?.message || '当前远程通道已断开，正在自动接管。'
    this.publish()
    const failed = this.adapters.get(id)
    await failed?.stop?.().catch(() => {})
    this.switching = this.#startAvailable(new Set([id])).finally(() => { this.switching = null })
    await this.switching
  }
}

module.exports = {
  SyncTransportManager,
  REMOTE_TRANSPORT_ORDER,
  createMeshIdentity
}
