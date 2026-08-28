'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const { ACTIONS, validateFrame } = require('./protocol.cjs')
const { detectUiBackend, requireUiBackend } = require('./platforms.cjs')
const { GuestBridgeError, fail } = require('./errors.cjs')

const MAX_TEXT_BYTES = 1024 * 1024
const MAX_LOG_LINES = 2000
const MAX_PROCESS_ROWS = 2000
const UI_ACTIONS = new Set(['ui.snapshot', 'ui.query', 'ui.invoke', 'ui.setValue'])
const FILE_ACTIONS = new Set(['file.read', 'file.list', 'file.stat'])
const SAFE_SIGNALS = new Set(['SIGTERM', 'SIGINT'])

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }

function assertAdapterMethod(adapter, method, code) {
  if (!adapter || typeof adapter[method] !== 'function') fail(code, `Guest adapter does not implement ${method}`)
}

function pathApiFor(platform) { return platform === 'win32' ? path.win32 : path.posix }

function normalizeRoots(roots, platform) {
  const api = pathApiFor(platform)
  if (!Array.isArray(roots) || roots.length === 0) return []
  return roots.map(root => {
    if (typeof root !== 'string' || root.includes('\0') || !api.isAbsolute(root)) fail('invalid-root', 'Allowed file roots must be absolute paths')
    return api.resolve(root)
  })
}

function resolveAllowedPath(target, roots, platform) {
  const api = pathApiFor(platform)
  if (typeof target !== 'string' || target.length === 0 || target.length > 4096 || target.includes('\0')) fail('invalid-path', 'Guest path is invalid')
  if (!api.isAbsolute(target)) fail('invalid-path', 'Guest paths must be absolute')
  const resolved = api.resolve(target)
  const allowed = roots.some(root => {
    const relative = api.relative(root, resolved)
    return relative === '' || (!relative.startsWith(`..${api.sep}`) && relative !== '..' && !api.isAbsolute(relative))
  })
  if (!allowed) fail('path-denied', 'Guest path is outside the explicitly allowed roots')
  return resolved
}

function redactText(value) {
  return String(value)
    .replace(/\b(bearer|authorization|cookie|password|passwd|token|secret)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/gu, '[redacted]')
}

class CapabilityAuthority {
  constructor(options = {}) {
    this.clock = options.clock || Date.now
    this.defaultTtlMs = options.defaultTtlMs || 15 * 60 * 1000
    this.grants = new Map()
  }

  grant({ peerFingerprint, actions, ttlMs }) {
    if (typeof peerFingerprint !== 'string' || !peerFingerprint) fail('peer-required', 'A verified peer fingerprint is required')
    if (!Array.isArray(actions) || actions.length === 0 || actions.some(action => !ACTIONS.includes(action))) fail('invalid-capability', 'Capability grant contains an unsupported action')
    const effectiveTtl = Number.isSafeInteger(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, 24 * 60 * 60 * 1000) : this.defaultTtlMs
    const token = crypto.randomBytes(32).toString('base64url')
    this.grants.set(token, { peerFingerprint, actions: new Set(actions), expiresAt: this.clock() + effectiveTtl })
    return token
  }

  verify(token, peerFingerprint, action) {
    const grant = typeof token === 'string' ? this.grants.get(token) : null
    if (!grant) fail('not-authorized', 'A valid Guest Bridge capability token is required')
    if (this.clock() >= grant.expiresAt) {
      this.grants.delete(token)
      fail('authorization-expired', 'Guest Bridge authorization expired')
    }
    if (grant.peerFingerprint !== peerFingerprint) fail('peer-mismatch', 'Authorization is bound to another peer')
    if (!grant.actions.has(action)) fail('capability-denied', 'Action is outside the granted capabilities')
    return grant
  }

  revoke(token) { return this.grants.delete(token) }
  revokeAll() { const count = this.grants.size; this.grants.clear(); return count }
}

class GuestBridge {
  constructor(options = {}) {
    this.platform = options.platform || process.platform
    this.fileRoots = normalizeRoots(options.fileRoots || [], this.platform)
    this.adapters = Object.freeze({ ...(options.adapters || {}) })
    this.uiStatus = options.uiStatus || detectUiBackend({ platform: this.platform, ...(options.uiProbe || {}) })
    this.authority = options.authority || new CapabilityAuthority(options.authorityOptions)
    this.stopped = false
  }

  describe() {
    const adapter = this.adapters
    return {
      protocolVersion: 1,
      platform: this.platform,
      ui: this.uiStatus,
      capabilities: {
        file: { available: Boolean(adapter.file), readOnly: true, allowedRootCount: this.fileRoots.length },
        process: { available: Boolean(adapter.process), operations: ['list', 'signal'], signals: [...SAFE_SIGNALS] },
        log: { available: Boolean(adapter.log), maxLines: MAX_LOG_LINES, redacted: true },
        ui: { available: this.uiStatus.available === true && Boolean(adapter.ui), structuredOnly: true }
      },
      packaging: { bundledGuestRuntime: false, bundledVm: false, bundledSystemImage: false, bundledSdk: false }
    }
  }

  stop() { this.stopped = true; return this.authority.revokeAll() }

  async handle(frame, context = {}) {
    if (this.stopped) fail('stopped', 'Guest Bridge is stopped')
    validateFrame(frame)
    if (frame.type !== 'request') fail('invalid-frame', 'Only request frames can be handled')
    this.authority.verify(context.token, context.peerFingerprint, frame.action)
    try {
      const result = await this.#dispatch(frame.action, frame.params || {})
      return { protocol: frame.protocol, version: frame.version, type: 'response', id: frame.id, ok: true, result }
    } catch (error) {
      if (!(error instanceof GuestBridgeError)) throw error
      return { protocol: frame.protocol, version: frame.version, type: 'response', id: frame.id, ok: false, error: { code: error.code, message: error.message } }
    }
  }

  async #dispatch(action, params) {
    if (!isRecord(params)) fail('invalid-params', 'Action params must be an object')
    if (action === 'capabilities.describe') return this.describe()
    if (FILE_ACTIONS.has(action)) return this.#file(action, params)
    if (action.startsWith('process.')) return this.#process(action, params)
    if (action === 'log.read') return this.#logs(params)
    if (UI_ACTIONS.has(action)) return this.#ui(action, params)
    fail('unsupported-action', 'Guest Bridge action is not supported')
  }

  async #file(action, params) {
    const method = action.slice('file.'.length)
    assertAdapterMethod(this.adapters.file, method, 'file-unavailable')
    const target = resolveAllowedPath(params.path, this.fileRoots, this.platform)
    const result = await this.adapters.file[method](target, { followSymlinks: false, maxBytes: MAX_TEXT_BYTES })
    if (method === 'read' && Buffer.byteLength(String(result), 'utf8') > MAX_TEXT_BYTES) fail('result-too-large', 'File result exceeds the size limit')
    return result
  }

  async #process(action, params) {
    const method = action.slice('process.'.length)
    assertAdapterMethod(this.adapters.process, method, 'process-unavailable')
    if (method === 'list') {
      const rows = await this.adapters.process.list({ maxRows: MAX_PROCESS_ROWS })
      if (!Array.isArray(rows)) fail('adapter-contract', 'Process adapter must return an array')
      return rows.slice(0, MAX_PROCESS_ROWS).map(row => ({ pid: row.pid, name: String(row.name || '').slice(0, 256) }))
    }
    if (!Number.isSafeInteger(params.pid) || params.pid <= 0) fail('invalid-pid', 'Process id must be a positive integer')
    if (!SAFE_SIGNALS.has(params.signal)) fail('signal-denied', 'Only non-destructive termination signals are allowed')
    return this.adapters.process.signal(params.pid, params.signal)
  }

  async #logs(params) {
    assertAdapterMethod(this.adapters.log, 'read', 'log-unavailable')
    const lines = Number.isSafeInteger(params.lines) ? Math.max(1, Math.min(params.lines, MAX_LOG_LINES)) : 200
    const result = await this.adapters.log.read({ lines })
    if (!Array.isArray(result)) fail('adapter-contract', 'Log adapter must return an array')
    return result.slice(-lines).map(line => redactText(line).slice(0, 8192))
  }

  async #ui(action, params) {
    requireUiBackend(this.uiStatus)
    const method = action.slice('ui.'.length)
    assertAdapterMethod(this.adapters.ui, method, 'ui-unavailable')
    if ('x' in params || 'y' in params || 'script' in params || 'keyCode' in params) fail('unstructured-ui-denied', 'Raw coordinates, scripts, and key injection are not allowed')
    if (method !== 'snapshot' && (typeof params.elementId !== 'string' || !params.elementId)) fail('element-required', 'A structured element identity is required')
    if (method === 'setValue') {
      const metadata = isRecord(params.metadata) ? params.metadata : {}
      const descriptor = `${metadata.role || ''} ${metadata.name || ''} ${metadata.autocomplete || ''}`.toLowerCase()
      if (/password|credential|secret|token|otp|one-time|验证码/u.test(descriptor)) fail('sensitive-field', 'Sensitive or credential fields cannot be controlled')
      if (typeof params.value !== 'string' || Buffer.byteLength(params.value, 'utf8') > 16 * 1024) fail('invalid-value', 'UI value must be bounded text')
    }
    return this.adapters.ui[method]({ ...params })
  }
}

module.exports = {
  GuestBridge, CapabilityAuthority, resolveAllowedPath, redactText,
  MAX_TEXT_BYTES, MAX_LOG_LINES, MAX_PROCESS_ROWS, SAFE_SIGNALS
}
