const { randomBytes } = require('node:crypto')
const { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const USER_RELAY_CONFIG_VERSION = 1
const DEFAULT_PROBE_TIMEOUT_MS = 10_000

function normalizeRelayUrl(value, { allowBareHost = false } = {}) {
  let input = String(value || '').trim()
  if (!input || input.length > 2048 || /\s/u.test(input)) throw new Error('Mobile relay URL is required and must not contain whitespace.')
  if (allowBareHost && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(input)) input = `wss://${input}`
  const url = new URL(input)
  if (url.protocol !== 'wss:' || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) {
    throw new Error('Mobile relay URL must use credential-free wss:// on port 443 without query parameters or fragments.')
  }
  if (!url.hostname || url.hostname === '0.0.0.0' || url.hostname === '[::]' || url.hostname.includes('%')) throw new Error('Mobile relay URL hostname is invalid.')
  return url.toString()
}

function validateRelayUrl(value) {
  return normalizeRelayUrl(value)
}

function loadMobileRelayConfig({ file, env = process.env, allowEnvironmentOverride = false } = {}) {
  let source = {}
  try { source = JSON.parse(readFileSync(file, 'utf8')) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Unable to read mobile relay config: ${error.message}`)
  }
  const override = allowEnvironmentOverride ? String(env.HARNESS_MOBILE_RELAY_URL || '').trim() : ''
  const enabled = override ? true : source.enabled === true
  const relayUrl = override || String(source.relayUrl || '').trim()
  if (!enabled) return Object.freeze({ enabled: false, relayUrl: '' })
  if (!relayUrl) throw new Error('Enabled mobile relay config is missing relayUrl.')
  return Object.freeze({ enabled: true, relayUrl: validateRelayUrl(relayUrl) })
}

function probeMobileRelay(value, { WebSocketImpl, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
  const relayUrl = normalizeRelayUrl(value, { allowBareHost: true })
  if (typeof WebSocketImpl !== 'function') return Promise.reject(new Error('WSS relay health detection is unavailable.'))
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) return Promise.reject(new Error('WSS relay health detection timeout is invalid.'))
  return new Promise((resolve, reject) => {
    let settled = false
    let socket
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (socket && socket.readyState < (WebSocketImpl.CLOSING ?? 2)) socket.close(1000, 'relay health check complete')
      if (error) reject(new Error(`Unable to reach WSS relay: ${error.message || String(error)}`))
      else resolve(Object.freeze({ ok: true, relayUrl, checkedAt: new Date().toISOString() }))
    }
    const timer = setTimeout(() => finish(new Error('connection timed out')), timeoutMs)
    timer.unref?.()
    try {
      socket = new WebSocketImpl(relayUrl, { perMessageDeflate: false, handshakeTimeout: timeoutMs })
      socket.once('open', () => socket.send(JSON.stringify({ type: 'hello', version: 1, role: 'desktop', roomId: randomBytes(32).toString('base64url') })))
      socket.on('message', data => {
        let message
        try { message = JSON.parse(String(data)) } catch { return }
        if (message.type === 'welcome' && message.role === 'desktop') finish()
        else if (message.type === 'error') finish(new Error(String(message.message || 'relay rejected the health check')))
      })
      socket.once('error', error => finish(error))
      socket.once('close', () => finish(new Error('connection closed before the relay became ready')))
    } catch (error) {
      finish(error)
    }
  })
}

function readUserRelayConfig(file) {
  try {
    const source = JSON.parse(readFileSync(file, 'utf8'))
    if (!source || source.version !== USER_RELAY_CONFIG_VERSION || source.enabled !== true) throw new Error('unsupported user relay config')
    return Object.freeze({
      enabled: true,
      relayUrl: validateRelayUrl(source.relayUrl),
      source: 'user',
      checkedAt: typeof source.checkedAt === 'string' && Number.isFinite(Date.parse(source.checkedAt)) ? new Date(source.checkedAt).toISOString() : null
    })
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`Unable to read user mobile relay config: ${error.message}`)
  }
}

function writeUserRelayConfig(file, config) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}-${Date.now()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: USER_RELAY_CONFIG_VERSION, enabled: true, relayUrl: config.relayUrl, checkedAt: config.checkedAt })}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    chmodSync(temporary, 0o600)
    renameSync(temporary, file)
    chmodSync(file, 0o600)
  } finally {
    rmSync(temporary, { force: true })
  }
}

class MobileRelayConfigStore {
  constructor({ file, packagedFile, env = process.env, allowEnvironmentOverride = false, WebSocketImpl, probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {}) {
    if (!file || !path.isAbsolute(file)) throw new Error('User mobile relay config file must be absolute.')
    this.file = file
    this.packagedFile = packagedFile
    this.env = env
    this.allowEnvironmentOverride = allowEnvironmentOverride
    this.WebSocketImpl = WebSocketImpl
    this.probeTimeoutMs = probeTimeoutMs
  }

  get() {
    let user
    try { user = readUserRelayConfig(this.file) }
    catch (error) { return Object.freeze({ enabled: false, relayUrl: '', source: 'invalid', checkedAt: null, error: error.message }) }
    if (user) return user
    let packaged
    try { packaged = loadMobileRelayConfig({ file: this.packagedFile, env: this.env, allowEnvironmentOverride: this.allowEnvironmentOverride }) }
    catch (error) { return Object.freeze({ enabled: false, relayUrl: '', source: 'invalid', checkedAt: null, error: error.message }) }
    return Object.freeze({ ...packaged, source: packaged.enabled ? (this.allowEnvironmentOverride && String(this.env.HARNESS_MOBILE_RELAY_URL || '').trim() ? 'development' : 'packaged') : 'disabled', checkedAt: null })
  }

  async detect(value) {
    return probeMobileRelay(value, { WebSocketImpl: this.WebSocketImpl, timeoutMs: this.probeTimeoutMs })
  }

  async set(value) {
    const detected = await this.detect(value)
    writeUserRelayConfig(this.file, detected)
    return this.get()
  }

  clear() {
    rmSync(this.file, { force: true })
    return this.get()
  }
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  MobileRelayConfigStore,
  USER_RELAY_CONFIG_VERSION,
  loadMobileRelayConfig,
  normalizeRelayUrl,
  probeMobileRelay,
  readUserRelayConfig,
  validateRelayUrl
}
