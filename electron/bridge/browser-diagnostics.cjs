const { redact } = require('./memory-censor.cjs')

const DEFAULT_CONSOLE_LIMIT = 200
const DEFAULT_NETWORK_LIMIT = 300
const MAX_TEXT = 2_000
const MAX_PATH = 1_000

function bounded(value, fallback, minimum = 1, maximum = 1_000) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function safeText(value, maximum = MAX_TEXT) {
  const boundedText = String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maximum)
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|auth[_-]?token|id[_-]?token|session[_-]?token|token|authorization|cookie|password|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '[REDACTED:browser-secret]')
  return redact(boundedText).text
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return safeText(`${url.origin}${url.pathname}`.slice(0, MAX_PATH), MAX_PATH)
  } catch {
    return ''
  }
}

function pushBounded(items, value, limit) {
  items.push(Object.freeze(value))
  if (items.length > limit) items.splice(0, items.length - limit)
}

class BrowserDiagnostics {
  constructor({ consoleLimit = DEFAULT_CONSOLE_LIMIT, networkLimit = DEFAULT_NETWORK_LIMIT, now = () => Date.now() } = {}) {
    this.consoleLimit = bounded(consoleLimit, DEFAULT_CONSOLE_LIMIT)
    this.networkLimit = bounded(networkLimit, DEFAULT_NETWORK_LIMIT)
    this.now = now
    this.consoleEntries = []
    this.networkEntries = []
  }

  recordConsole({ level = 'log', message = '', source = '', line = 0 } = {}) {
    const entry = {
      at: this.now(),
      level: ['debug', 'info', 'log', 'warning', 'error'].includes(String(level)) ? String(level) : 'log',
      message: safeText(message),
      source: safeUrl(source),
      line: Math.max(0, Math.floor(Number(line) || 0))
    }
    pushBounded(this.consoleEntries, entry, this.consoleLimit)
    return entry
  }

  recordNetwork({ id = '', phase = 'completed', method = 'GET', url = '', resourceType = 'other', status = 0, error = '', fromCache = false, startedAt = 0, completedAt } = {}) {
    const finished = Number(completedAt) || this.now()
    const start = Number(startedAt) || 0
    const entry = {
      at: finished,
      id: safeText(id, 120),
      phase: ['started', 'completed', 'failed'].includes(String(phase)) ? String(phase) : 'completed',
      method: safeText(method, 16).toUpperCase(),
      url: safeUrl(url),
      resourceType: safeText(resourceType, 40),
      status: Math.max(0, Math.floor(Number(status) || 0)),
      error: safeText(error, 300),
      fromCache: Boolean(fromCache),
      durationMs: start > 0 ? Math.max(0, Math.round(finished - start)) : null
    }
    pushBounded(this.networkEntries, entry, this.networkLimit)
    return entry
  }

  snapshot(kind = 'all', { limit = 100 } = {}) {
    const maximum = bounded(limit, 100, 1, 500)
    const result = {}
    if (kind === 'all' || kind === 'console') result.console = this.consoleEntries.slice(-maximum).map(item => ({ ...item }))
    if (kind === 'all' || kind === 'network') result.network = this.networkEntries.slice(-maximum).map(item => ({ ...item }))
    return result
  }

  clear(kind = 'all') {
    if (kind === 'all' || kind === 'console') this.consoleEntries.length = 0
    if (kind === 'all' || kind === 'network') this.networkEntries.length = 0
    return this.snapshot('all')
  }
}

module.exports = {
  BrowserDiagnostics,
  DEFAULT_CONSOLE_LIMIT,
  DEFAULT_NETWORK_LIMIT,
  MAX_PATH,
  MAX_TEXT,
  safeText,
  safeUrl
}
