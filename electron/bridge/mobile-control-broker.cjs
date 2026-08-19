const { randomUUID } = require('node:crypto')

const CONTROL_PROTOCOL_VERSION = 1
const MAX_QUEUE_PER_DEVICE = 32
const STATUS_TTL_MS = 15_000
const COMMAND_TTL_MS = 2 * 60_000

const ACTION_CAPABILITY = Object.freeze({
  observe: 'nodeSummary',
  tap: 'tap',
  longPress: 'longPress',
  swipe: 'swipe',
  back: 'back',
  home: 'home',
  recents: 'recents',
  textInput: 'textInput',
  openApp: 'openApp',
  openUri: 'openUri',
  openSettings: 'openSettings',
  screenshot: 'screenshot',
  fileOpen: 'filePicker',
  fileCreate: 'filePicker',
  clearCache: 'clearCache'
})

const SENSITIVE_ACTIONS = new Set(['textInput', 'fileCreate', 'clearCache'])
const FORBIDDEN_ACTIONS = new Set([
  'unlock', 'password', 'otp', 'payment', 'banking', 'clearData', 'installApp',
  'uninstallApp', 'grantPermission', 'shell', 'script', 'deleteFile', 'sendMessage'
])

function finiteInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.max(minimum, Math.min(maximum, number))
}

function safeString(value, maximum = 2048) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum)
}

function normalizeClientPlatform(value) {
  return ['android', 'ios'].includes(value) ? value : 'unknown'
}

function normalizeDeviceClass(value) {
  return ['phone', 'tablet'].includes(value) ? value : 'unknown'
}

function normalizeAppVersion(value) {
  const version = safeString(value, 40).replace(/[^0-9A-Za-z._+-]/g, '')
  return version || null
}

function normalizePoint(value) {
  if (!value || typeof value !== 'object') return null
  const x = Number(value.x)
  const y = Number(value.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) }
}

function normalizePayload(action, input) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  if (action === 'tap' || action === 'longPress') {
    const point = normalizePoint(value)
    if (!point) throw new Error(`${action} 需要有效的 x/y 坐标。`)
    return { ...point, ...(action === 'longPress' ? { durationMs: finiteInteger(value.durationMs, 650, 350, 2000) } : {}) }
  }
  if (action === 'swipe') {
    const start = normalizePoint({ x: value.startX, y: value.startY })
    const end = normalizePoint({ x: value.endX, y: value.endY })
    if (!start || !end) throw new Error('swipe 需要有效的起点和终点。')
    return { startX: start.x, startY: start.y, endX: end.x, endY: end.y, durationMs: finiteInteger(value.durationMs, 450, 120, 3000) }
  }
  if (action === 'textInput') {
    const text = safeString(value.text, 4000)
    if (!text) throw new Error('textInput 需要非空文字。')
    return { text, sensitive: value.sensitive !== false }
  }
  if (action === 'openApp') {
    const packageName = safeString(value.packageName, 180)
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) throw new Error('openApp 需要有效的应用标识。')
    return { packageName }
  }
  if (action === 'openUri') {
    const uri = safeString(value.uri, 2048)
    if (!/^(?:https?|geo|mailto|tel):/i.test(uri)) throw new Error('openUri 只允许明确的 http、https、geo、mailto 或 tel URI。')
    return { uri }
  }
  if (action === 'openSettings') {
    const target = safeString(value.target || 'settings', 80)
    if (!['settings', 'accessibility', 'usageAccess', 'notifications', 'appDetails', 'appStorage'].includes(target)) throw new Error('不支持的系统设置目标。')
    const packageName = safeString(value.packageName, 180)
    return { target, ...(packageName ? { packageName } : {}) }
  }
  if (action === 'clearCache') {
    const packageName = safeString(value.packageName, 180)
    if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) throw new Error('clearCache 需要有效的应用标识。')
    return { packageName, requireConfirmation: true, neverClearData: true }
  }
  if (action === 'screenshot') return { maxWidth: finiteInteger(value.maxWidth, 720, 320, 1440), quality: finiteInteger(value.quality, 62, 35, 85) }
  if (action === 'observe') return { maxNodes: finiteInteger(value.maxNodes, 80, 10, 160), includeText: value.includeText !== false }
  if (action === 'fileOpen') return { mimeType: safeString(value.mimeType || '*/*', 120), maxBytes: finiteInteger(value.maxBytes, 2 * 1024 * 1024, 1024, 8 * 1024 * 1024) }
  if (action === 'fileCreate') {
    const contentBase64 = safeString(value.contentBase64, 11 * 1024 * 1024)
    if (contentBase64 && (!/^[A-Za-z0-9+/=]+$/.test(contentBase64) || contentBase64.length > 11 * 1024 * 1024)) throw new Error('fileCreate 内容必须是 8 MB 以内的 Base64。')
    return { mimeType: safeString(value.mimeType || 'application/octet-stream', 120), suggestedName: safeString(value.suggestedName || 'Harness-export', 160), contentBase64, requireConfirmation: true }
  }
  return {}
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) return []
  const known = new Set(Object.values(ACTION_CAPABILITY))
  return [...new Set(value.map(entry => safeString(entry, 40)).filter(entry => known.has(entry)))].sort()
}

function isLoopbackAddress(value) {
  const address = String(value || '').replace(/^::ffff:/, '')
  return address === '127.0.0.1' || address === '::1'
}

class MobileControlBroker {
  constructor({ now = () => Date.now(), idFactory = () => randomUUID() } = {}) {
    this.now = now
    this.idFactory = idFactory
    this.devices = new Map()
    this.queues = new Map()
    this.pending = new Map()
    this.results = new Map()
  }

  reportStatus(deviceId, payload = {}) {
    const capabilities = normalizeCapabilities(payload.capabilities)
    const status = {
      protocolVersion: Number(payload.protocolVersion) === CONTROL_PROTOCOL_VERSION ? CONTROL_PROTOCOL_VERSION : 0,
      platform: normalizeClientPlatform(payload.platform),
      deviceClass: normalizeDeviceClass(payload.deviceClass),
      appVersion: normalizeAppVersion(payload.appVersion),
      enabled: payload.enabled === true,
      ready: payload.ready === true,
      accessibility: payload.accessibility === true,
      captureActive: payload.captureActive === true,
      capabilities,
      phase: safeString(payload.phase || (payload.ready ? 'ready' : 'disabled'), 80),
      detail: safeString(payload.detail, 240),
      currentCommandId: /^[0-9a-f-]{16,64}$/i.test(payload.currentCommandId || '') ? payload.currentCommandId : null,
      lastSeenAt: new Date(this.now()).toISOString()
    }
    this.devices.set(deviceId, status)
    if (!status.enabled) this.clearDevice(deviceId, 'CONTROL_DISABLED')
    return status
  }

  state(knownDevices = []) {
    this.#expire()
    return {
      protocolVersion: CONTROL_PROTOCOL_VERSION,
      supportedActions: Object.keys(ACTION_CAPABILITY),
      devices: knownDevices.map(device => {
        const status = this.devices.get(device.id)
        const online = Boolean(status && this.now() - Date.parse(status.lastSeenAt) <= STATUS_TTL_MS)
        return {
          id: device.id,
          name: device.name,
          platform: status?.platform || normalizeClientPlatform(device.platform),
          deviceClass: status?.deviceClass || normalizeDeviceClass(device.deviceClass),
          appVersion: status?.appVersion || normalizeAppVersion(device.appVersion),
          online,
          enabled: online && status.enabled,
          ready: online && status.enabled && status.ready && status.protocolVersion === CONTROL_PROTOCOL_VERSION,
          accessibility: online && status.accessibility,
          captureActive: online && status.captureActive,
          capabilities: online ? status.capabilities : [],
          phase: online ? status.phase : 'offline',
          detail: online ? status.detail : '手机控制未连接',
          currentCommandId: online ? status.currentCommandId : null,
          queued: (this.queues.get(device.id) || []).length,
          lastSeenAt: status?.lastSeenAt || null
        }
      })
    }
  }

  enqueue(deviceId, input = {}) {
    this.#expire()
    const action = safeString(input.action, 40)
    if (FORBIDDEN_ACTIONS.has(action)) throw new Error(`出于安全原因，手机控制拒绝 ${action}。`)
    const capability = ACTION_CAPABILITY[action]
    if (!capability) throw new Error('不支持的手机控制动作。')
    const status = this.devices.get(deviceId)
    if (!status || !status.enabled || !status.ready || status.protocolVersion !== CONTROL_PROTOCOL_VERSION) throw new Error('目标手机尚未开启并准备好手机控制。')
    if (!status.capabilities.includes(capability)) throw new Error(`目标手机未上报 ${capability} 能力。`)
    const queue = this.queues.get(deviceId) || []
    if (queue.length >= MAX_QUEUE_PER_DEVICE) throw new Error('目标手机待执行队列已满。')
    const createdAt = this.now()
    const command = {
      type: 'command',
      protocolVersion: CONTROL_PROTOCOL_VERSION,
      id: this.idFactory(),
      action,
      payload: normalizePayload(action, input.payload),
      timeoutMs: finiteInteger(input.timeoutMs, 15_000, 1_000, 60_000),
      retryLimit: finiteInteger(input.retryLimit, 0, 0, 2),
      requiresConfirmation: SENSITIVE_ACTIONS.has(action) || input.requiresConfirmation === true,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + COMMAND_TTL_MS).toISOString()
    }
    queue.push(command)
    this.queues.set(deviceId, queue)
    this.pending.set(command.id, { deviceId, command, deliveredAt: null })
    return command
  }

  poll(deviceId, protocolVersion) {
    this.#expire()
    if (Number(protocolVersion) !== CONTROL_PROTOCOL_VERSION) return { protocolVersion: CONTROL_PROTOCOL_VERSION, error: { code: 'PROTOCOL_MISMATCH', message: '请更新 Harness Mobile。' } }
    const queue = this.queues.get(deviceId) || []
    const command = queue.shift() || null
    if (queue.length) this.queues.set(deviceId, queue)
    else this.queues.delete(deviceId)
    if (command) {
      const pending = this.pending.get(command.id)
      if (pending) pending.deliveredAt = this.now()
    }
    return { protocolVersion: CONTROL_PROTOCOL_VERSION, command }
  }

  reportResult(deviceId, payload = {}) {
    const id = safeString(payload.id || payload.commandId, 80)
    const pending = this.pending.get(id)
    if (!pending || pending.deviceId !== deviceId) throw new Error('未知或已失效的手机控制命令。')
    const result = {
      id,
      deviceId,
      action: pending.command.action,
      ok: payload.ok === true,
      code: safeString(payload.code || (payload.ok ? 'OK' : 'FAILED'), 80),
      message: safeString(payload.message, 500),
      data: payload.data && typeof payload.data === 'object' ? payload.data : null,
      completedAt: new Date(this.now()).toISOString()
    }
    this.pending.delete(id)
    this.results.set(id, result)
    if (this.results.size > 128) this.results.delete(this.results.keys().next().value)
    return result
  }

  result(id) {
    this.#expire()
    return this.results.get(String(id)) || null
  }

  cancel(id, reason = 'USER_CANCELLED') {
    const pending = this.pending.get(String(id))
    if (!pending) return false
    const queue = this.queues.get(pending.deviceId) || []
    this.queues.set(pending.deviceId, queue.filter(command => command.id !== pending.command.id))
    this.pending.delete(pending.command.id)
    this.#pushDirective(pending.deviceId, 'cancel', { commandId: pending.command.id, reason: safeString(reason, 120) })
    return true
  }

  stop(deviceId = null, reason = 'DESKTOP_STOP') {
    const ids = deviceId ? [deviceId] : [...new Set([...this.devices.keys(), ...this.queues.keys()])]
    for (const id of ids) {
      this.clearDevice(id, reason)
      this.#pushDirective(id, 'stop', { reason: safeString(reason, 120) })
    }
    return ids.length
  }

  clearDevice(deviceId, reason = 'DISCONNECTED') {
    this.queues.delete(deviceId)
    for (const [id, pending] of this.pending) {
      if (pending.deviceId === deviceId) this.pending.delete(id)
    }
    const status = this.devices.get(deviceId)
    if (status) this.devices.set(deviceId, { ...status, ready: false, phase: 'stopped', detail: safeString(reason, 120), currentCommandId: null })
  }

  #pushDirective(deviceId, action, payload) {
    const queue = this.queues.get(deviceId) || []
    queue.unshift({ type: action, protocolVersion: CONTROL_PROTOCOL_VERSION, id: this.idFactory(), payload, createdAt: new Date(this.now()).toISOString() })
    this.queues.set(deviceId, queue.slice(0, MAX_QUEUE_PER_DEVICE))
  }

  #expire() {
    const now = this.now()
    for (const [id, pending] of this.pending) {
      if (Date.parse(pending.command.expiresAt) <= now) {
        this.pending.delete(id)
        const queue = this.queues.get(pending.deviceId) || []
        this.queues.set(pending.deviceId, queue.filter(command => command.id !== id))
      }
    }
  }
}

module.exports = {
  ACTION_CAPABILITY,
  CONTROL_PROTOCOL_VERSION,
  FORBIDDEN_ACTIONS,
  MobileControlBroker,
  SENSITIVE_ACTIONS,
  isLoopbackAddress,
  normalizeCapabilities,
  normalizePayload
}
