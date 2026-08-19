// 右栏内置浏览器「有界审计」（browser-audit）。
//
// 职责：以有界队列记录浏览器安全策略的决策元数据（谁、何时、针对哪个
// origin/标签、什么动作、什么结果），支撑事后排查与「最近策略事件」展示。
//
// 安全红线（结构级保证）：
//   - 白名单投影：只有 AUDIT_ENTRY_KEYS 中的字段会被保留，其余一律丢弃——
//     即使调用方误传 text/cookie/token/password/body/value/content 等，也
//     不可能进入审计；正文、Cookie、token、输入值从结构上无法落库；
//   - 字符串字段（message/detail）入库前统一脱敏（复用 memory-censor.redact）；
//   - 只记录 canonical origin（不含 query/hash），URL 上的令牌参数同样进不来；
//   - 有界容量：超出上限丢弃最旧记录。
// 纯 Node 实现，无 Electron 依赖，可独立用 node:test 测试。

const { redact } = require('./memory-censor.cjs')
const { canonicalOrigin } = require('./browser-url-policy.cjs')

const DEFAULT_MAX_ENTRIES = 512
const HARD_MAX_ENTRIES = 10_000
const MESSAGE_MAX_LENGTH = 500

const ACTORS = new Set(['user', 'model', 'system'])
// 审计白名单：仅保留决策元数据字段。
const AUDIT_ENTRY_KEYS = new Set([
  'ts', 'actor', 'action', 'origin', 'tabId', 'result', 'code', 'message', 'detail'
])
const STRING_SANITIZED_KEYS = new Set(['message', 'detail'])

function auditError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function keepOriginOnly(value) {
  if (value == null) return null
  try { return canonicalOrigin(value) } catch { return null }
}

function safeText(value) {
  return redact(String(value == null ? '' : value))
    .text.replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, MESSAGE_MAX_LENGTH)
}

class BrowserAudit {
  /**
   * @param {{ maxEntries?: number, now?: () => number }} options
   */
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
    const number = Math.trunc(Number(maxEntries) || DEFAULT_MAX_ENTRIES)
    this.maxEntries = Math.max(1, Math.min(HARD_MAX_ENTRIES, number))
    this.now = now
    this.entries = []
    this.stopped = false
    this.total = 0
    this.dropped = 0
  }

  /**
   * 记录一条决策元数据。
   * @param {object} input 任何对象；只有白名单字段会被保留。
   * @returns {object} 实际入库的投影条目（便于测试与回显）。
   * @throws 审计已停止时抛带 code 的错误。
   */
  record(input) {
    if (this.stopped) throw auditError('audit-stopped', '审计已停止，不再接受新记录。')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw auditError('invalid-record', '审计记录必须是对象。')
    }
    const actor = ACTORS.has(input.actor) ? input.actor : 'system'
    const entry = {
      ts: new Date(this.now()).toISOString(),
      actor,
      result: String(input.result == null ? 'info' : input.result).slice(0, 40)
    }
    for (const key of ['action', 'origin', 'tabId', 'code', 'message', 'detail']) {
      const value = input[key]
      if (value === undefined || value === null) continue
      if (key === 'origin') {
        const origin = keepOriginOnly(value)
        if (origin) entry.origin = origin
      } else if (STRING_SANITIZED_KEYS.has(key)) {
        entry[key] = safeText(value)
      } else if (key === 'tabId') {
        entry.tabId = String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64)
      } else {
        entry[key] = String(value).slice(0, 120)
      }
    }
    this.entries.push(entry)
    this.total += 1
    if (this.entries.length > this.maxEntries) {
      this.entries.shift()
      this.dropped += 1
    }
    return entry
  }

  /** 只读快照（深拷贝，不暴露内部引用）。 */
  snapshot() {
    return {
      maxEntries: this.maxEntries,
      count: this.entries.length,
      total: this.total,
      dropped: this.dropped,
      stopped: this.stopped,
      entries: this.entries.map(entry => ({ ...entry }))
    }
  }

  entriesCopy() {
    return this.entries.map(entry => ({ ...entry }))
  }

  clear() {
    const removed = this.entries.length
    this.entries = []
    this.total = 0
    this.dropped = 0
    return removed
  }

  /** 停用审计：之后 record() 一律拒绝，已有记录仍可读取。 */
  stop() {
    if (this.stopped) return this.snapshot()
    this.stopped = true
    return this.snapshot()
  }
}

module.exports = {
  ACTORS,
  AUDIT_ENTRY_KEYS,
  DEFAULT_MAX_ENTRIES,
  HARD_MAX_ENTRIES,
  BrowserAudit,
  keepOriginOnly,
  safeText
}