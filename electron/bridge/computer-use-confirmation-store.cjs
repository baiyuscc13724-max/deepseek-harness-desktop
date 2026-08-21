const { createHash, randomUUID } = require('node:crypto')

const DEFAULT_CONFIRMATION_TTL_MS = 60_000
const DEFAULT_MAX_PENDING = 32

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isSafeInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function confirmationError(code, message) {
  return Object.assign(new Error(message), { code })
}

function normalizedSurface(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const generation = Number(value.generation)
  const width = Number(value.width)
  const height = Number(value.height)
  const url = String(value.url || '').slice(0, 4096)
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !url) return null
  return { generation, width, height, url }
}

function confirmationFingerprint(action, parameters = {}) {
  const canonical = JSON.stringify({
    action: String(action || ''),
    x: parameters.x ?? null,
    y: parameters.y ?? null,
    text: parameters.text ?? null,
    deltaY: parameters.delta_y ?? null,
    surface: normalizedSurface(parameters.surface)
  })
  return createHash('sha256').update(canonical).digest('hex')
}

function confirmationSummary(action, parameters = {}) {
  const target = normalizedSurface(parameters.surface)
  const point = Number.isFinite(Number(parameters.x)) && Number.isFinite(Number(parameters.y))
    ? ` @ (${Math.round(Number(parameters.x))}, ${Math.round(Number(parameters.y))})`
    : ''
  const surface = target ? `，当前窗口 ${target.width}×${target.height}` : ''
  return `${String(action || '')} Harness Desktop 窗口${point}${surface}`
}

class ComputerUseConfirmationStore {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now())
    this.idFactory = options.idFactory || (() => randomUUID())
    this.ttlMs = boundedInteger(options.ttlMs, DEFAULT_CONFIRMATION_TTL_MS, 5_000, 10 * 60_000)
    this.maxPending = boundedInteger(options.maxPending, DEFAULT_MAX_PENDING, 1, 128)
    this.items = new Map()
  }

  #public(item) {
    return {
      id: item.id,
      action: item.action,
      summary: item.summary,
      confirmed: item.confirmed,
      expiresAt: item.expiresAt
    }
  }

  prune() {
    const now = this.now()
    let removed = 0
    for (const [id, item] of this.items) {
      if (item.expiresAt <= now) {
        this.items.delete(id)
        removed += 1
      }
    }
    return removed
  }

  authorize(action, parameters = {}) {
    this.prune()
    const fingerprint = confirmationFingerprint(action, parameters)
    const confirmationId = String(parameters.confirmation_id || '')
    if (confirmationId) {
      const item = this.items.get(confirmationId)
      if (!item || item.fingerprint !== fingerprint || !item.confirmed) {
        throw confirmationError('confirmation-invalid', 'Computer Use 确认无效或已过期。')
      }
      this.items.delete(confirmationId)
      return null
    }
    const existing = [...this.items.values()].find(item => item.fingerprint === fingerprint)
    if (existing) return { requiresConfirmation: true, confirmationId: existing.id, ...this.#public(existing) }
    if (this.items.size >= this.maxPending) {
      throw confirmationError('too-many-confirmations', 'Computer Use 待确认请求过多，请先处理或等待过期。')
    }
    const now = this.now()
    const item = {
      id: this.idFactory(),
      action: String(action || ''),
      fingerprint,
      summary: confirmationSummary(action, parameters),
      confirmed: false,
      createdAt: now,
      expiresAt: now + this.ttlMs
    }
    this.items.set(item.id, item)
    return { requiresConfirmation: true, confirmationId: item.id, ...this.#public(item) }
  }

  confirm(id) {
    this.prune()
    const item = this.items.get(String(id || ''))
    if (!item) throw confirmationError('confirmation-invalid', 'Computer Use 确认已过期。')
    item.confirmed = true
    return this.snapshot()
  }

  reject(id) {
    this.prune()
    this.items.delete(String(id || ''))
    return this.snapshot()
  }

  snapshot() {
    this.prune()
    return [...this.items.values()].map(item => this.#public(item))
  }

  clear() {
    const count = this.items.size
    this.items.clear()
    return count
  }
}

module.exports = {
  ComputerUseConfirmationStore,
  DEFAULT_CONFIRMATION_TTL_MS,
  DEFAULT_MAX_PENDING,
  confirmationFingerprint
}
