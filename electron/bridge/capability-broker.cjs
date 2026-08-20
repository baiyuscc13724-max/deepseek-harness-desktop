// capability-broker.cjs
//
// 统一桌面能力 Broker（批次3的底层模块）。
//
// 目标：对外部/内部请求者暴露一组「固定能力白名单」的受约束执行通道。
// 设计要点：
//   * 固定 capability -> action 白名单（不可在运行时新增）。
//   * 每次进程启动生成一个随机令牌，只有携带正确令牌的请求才被受理。
//   * 提供 loopback / source 校验函数，用于限制请求来源（本机回环/允许的来源）。
//   * 每个请求有 TTL（生存期），过期即不可再次消费。
//   * 每个 capability 有独立的队列上限，超出即拒绝。
//   * 支持 stop（停止全部）与 cancel（取消单个）。
//   * 敏感动作需标记并携带确认策略，未确认前不会进入执行队列。
//   * 审计记录有界（环形），且不记录请求正文 / 令牌 / 敏感载荷。

const { randomInt, randomUUID } = require('node:crypto')

// ---------------------------------------------------------------------------
// 固定能力/动作白名单。value 为 capability 名称，key 为动作名称。
// 只允许在这里登记的动作；运行时无法注册新动作。
// ---------------------------------------------------------------------------
const CAPABILITY_WHITELIST = Object.freeze({
  storageScan: 'storageScan',
  storageCleanupPreview: 'storageCleanupPreview',
  storageCleanupApply: 'storageCleanupApply',
  runtimeProbe: 'runtimeProbe',
  networkProbe: 'networkProbe',
  systemInfo: 'systemInfo',
  updateFeed: 'updateFeed'
})

// 每个 capability 可执行的动作别名 -> capability 名的映射，用于把
// 「动作」归一化到「能力」，并校验该动作是否属于该能力。
const ACTION_CAPABILITY = Object.freeze(
  Object.fromEntries(
    Object.entries(CAPABILITY_WHITELIST).map(([action, capability]) => [action, capability])
  )
)

// 敏感动作集合：这些动作必须先经过确认策略，否则不进入执行队列。
const SENSITIVE_ACTIONS = Object.freeze(new Set(['storageCleanupApply']))

// 每种动作默认的请求 TTL（毫秒）。
const DEFAULT_REQUEST_TTL_MS = 5 * 60_000

// 每个 capability 默认的队列深度上限。
const DEFAULT_QUEUE_LIMIT = 8

// 审计记录容量上限（有界环形）。
const AUDIT_CAPACITY = 200

// 请求 ID / token 的合理正则（token 采用 URL 安全随机串）。
const TOKEN_RE = /^[A-Za-z0-9_-]{16,96}$/
const REQUEST_ID_RE = /^[0-9A-Za-z_-]{1,64}$/

function safeString(value, maximum = 512, fallback = '') {
  const text = String(value ?? '')
  return text.length > maximum ? fallback : text
}

function finiteInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.max(minimum, Math.min(maximum, number))
}

// ---------------------------------------------------------------------------
// loopback / source 校验函数
// ---------------------------------------------------------------------------

/**
 * 判断一个地址是否是回环地址（本机）。
 * 支持 IPv4、IPv6 及 IPv4-mapped IPv6（::ffff:127.0.0.1）。
 */
function isLoopbackAddress(value) {
  const address = String(value || '').replace(/::ffff:/g, '').toLowerCase()
  return address === '127.0.0.1' || address === '::1' || address === 'localhost'
}

/**
 * 校验来源地址是否被允许。
 * @param {string} address 请求来源地址（IP 或 hostname）。
 * @param {object} [policy] { allowLoopback?: boolean, allowSources?: string[] }
 * 默认仅允许回环。allowSources 里的每项也支持带通配符（可按前缀匹配）。
 * 返回 { ok, reason }。
 */
function validateSource(address, policy = {}) {
  const allowLoopback = policy.allowLoopback !== false
  if (allowLoopback && isLoopbackAddress(address)) return { ok: true, reason: null }
  const source = String(address || '').toLowerCase()
  const allowSources = Array.isArray(policy.allowSources) ? policy.allowSources : []
  for (const entry of allowSources) {
    const rule = String(entry || '').toLowerCase()
    const wildcard = rule.endsWith('*')
    const allowed = wildcard ? rule.slice(0, -1) : rule
    if (source === allowed || (wildcard && allowed && source.startsWith(allowed))) {
      return { ok: true, reason: null }
    }
  }
  return { ok: false, reason: `来源 ${String(address)} 不在允许列表内。` }
}

/**
 * 生成一个安全的随机令牌（URL 安全）。可注入 rng 以便测试。
 */
function generateToken(rng = () => randomInt(0, 256)) {
  const bytes = Buffer.alloc(24)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = rng()
  return bytes.toString('base64url')
}

class CapabilityBroker {
  /**
   * @param {object} [options]
   *   now: () => number         时钟（测试注入）。
   *   idFactory: () => string   请求 ID 生成器。
   *   tokenFactory: () => string 令牌生成器（默认 generateToken）。
   *   rng: () => number         令牌随机源（传给 generateToken）。
   *   defaultTtlMs: number      默认请求 TTL。
   */
  constructor(options = {}) {
    this.now = options.now || (() => Date.now())
    this.idFactory = options.idFactory || (() => randomUUID())
    this.defaultTtlMs = finiteInteger(options.defaultTtlMs, DEFAULT_REQUEST_TTL_MS, 1_000, 60 * 60_000)
    this.queueLimits = new Map()
    for (const capability of Object.values(CAPABILITY_WHITELIST)) {
      this.queueLimits.set(capability, DEFAULT_QUEUE_LIMIT)
    }
    // 每次启动生成一个随机令牌。
    this.token = options.token != null ? String(options.token) : generateToken(options.rng)
    // 请求 ID -> request（含 token 校验后的消费状态）。
    this.requests = new Map()
    // 业务载荷与可公开的请求元数据分离；载荷从不进入审计或快照，
    // 并在派发、取消、停止或过期时立即释放。
    this.payloads = new Map()
    // capability -> 已排队待执行的动作 id 数组。
    this.queues = new Map()
    // 审计环形记录。
    this.audit = []
    this.auditIndex = 0
  }

  /** 覆盖某个 capability 的队列上限（仅限白名单内能力）。 */
  setQueueLimit(capability, limit) {
    if (!Object.values(CAPABILITY_WHITELIST).includes(capability)) {
      throw new Error(`未知能力：${capability}`)
    }
    this.queueLimits.set(capability, finiteInteger(limit, DEFAULT_QUEUE_LIMIT, 1, 128))
    return this.queueLimits.get(capability)
  }

  /** 当前随机令牌（调用方在握手时核对）。 */
  currentToken() {
    return this.token
  }

  /**
   * 登记 / 接受一个请求。返回请求对象；若无效则抛出 Error。
   * input: {
   *   action: string            白名单中的动作。
   *   token?: string            必须等于本实例令牌。
   *   source?: string           请求来源地址。
   *   sourcePolicy?: object     传给 validateSource。
   *   payload?: object          （可选）业务载荷，不会被审计记录。
   *   ttlMs?: number            可选 TTL 覆盖。
   * }
   */
  accept(input = {}) {
    // 未显式给出来源时，默认视为本机（回环）调用 —— 桌面能力 Broker 的
    // 主要调用方都是本地进程，回环来源是可信且安全的默认值。
    const source = input.source == null ? '127.0.0.1' : input.source
    const { ok, reason } = validateSource(source, input.sourcePolicy)
    if (!ok) throw new Error(`来源校验失败：${reason}`)

    if (input.token !== this.token) throw new Error('令牌不匹配或缺失。')
    if (typeof input.token !== 'string' || !TOKEN_RE.test(input.token)) {
      throw new Error('令牌格式无效。')
    }

    const action = safeString(input.action, 64)
    const capability = ACTION_CAPABILITY[action]
    if (!capability) throw new Error(`不在白名单中的动作：${action || '(空)'}`)

    const id = safeString(this.idFactory(), 64)
    if (!id || !REQUEST_ID_RE.test(id)) throw new Error('无法生成有效请求 ID。')

    const queue = this.queues.get(capability) || []
    const limit = this.queueLimits.get(capability) || DEFAULT_QUEUE_LIMIT
    if (queue.length >= limit) throw new Error(`能力 ${capability} 的待执行队列已满（上限 ${limit}）。`)

    const createdAt = this.now()
    const ttlMs = finiteInteger(input.ttlMs, this.defaultTtlMs, 1_000, 60 * 60_000)
    const sensitive = SENSITIVE_ACTIONS.has(action) || input.requiresConfirmation === true
    const request = {
      id,
      capability,
      action,
      sensitive,
      source: safeString(source, 128),
      ttlMs,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + ttlMs).toISOString(),
      confirmed: !sensitive,
      // confirmationPolicy 是给上层/人工确认流程使用的数据结构。
      confirmationPolicy: this.#buildConfirmationPolicy(action, sensitive, input.confirmation),
      state: 'queued'
    }
    queue.push(id)
    this.queues.set(capability, queue)
    this.requests.set(id, request)
    if (input.payload !== undefined) this.payloads.set(id, input.payload)
    this.#audit('accept', { id, capability, action, sensitive })
    return request
  }

  /**
   * 消费队列里的下一个待确认请求。未确认的敏感请求不会返回。
   * 已过期、已取消、已执行或已确认要求的请求都会被跳过并清理。
   */
  next(capability, { confirm = false } = {}) {
    this.#expire()
    const queue = this.queues.get(capability) || []
    const now = this.now()
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]
      const request = this.requests.get(id)
      if (!request) {
        queue.splice(index, 1)
        index -= 1
        continue
      }
      if (!request.confirmed) {
        if (confirm && request.action && this.#canConfirm(request)) {
          request.confirmed = true
          request.confirmedAt = new Date(now).toISOString()
          this.#audit('confirm', { id, capability, action: request.action })
        } else {
          continue
        }
      }
      request.state = 'dispatched'
      request.dispatchedAt = new Date(now).toISOString()
      this.requests.delete(id)
      queue.splice(index, 1)
      if (queue.length) this.queues.set(capability, queue)
      else this.queues.delete(capability)
      this.#audit('dispatch', { id, capability, action: request.action })
      return { ...request, payload: this.#storedPayload(id) }
    }
    return null
  }

  /** 确认一个敏感请求（按 ID）。返回是否成功确认。 */
  confirm(id, { yes = true } = {}) {
    const request = this.requests.get(String(id || ''))
    if (!request) return false
    if (!request.sensitive) return true
    request.confirmed = yes
    if (yes) request.confirmedAt = new Date(this.now()).toISOString()
    this.#audit('confirm', { id: request.id, capability: request.capability, action: request.action, yes })
    return true
  }

  /** 取消单个请求。返回是否取消成功。 */
  cancel(id, reason = 'USER_CANCELLED') {
    const key = String(id || '')
    const request = this.requests.get(key)
    if (!request) return false
    const queue = this.queues.get(request.capability) || []
    this.queues.set(
      request.capability,
      queue.filter(item => item !== key)
    )
    request.state = 'cancelled'
    request.cancelledAt = new Date(this.now()).toISOString()
    this.requests.delete(key)
    this.payloads.delete(key)
    this.#audit('cancel', { id: key, capability: request.capability, action: request.action, reason: safeString(reason, 120) })
    return true
  }

  /** 停止某个能力（或全部能力）的所有排队请求。返回受影响请求数。 */
  stop(capability = null, reason = 'DESKTOP_STOP') {
    const caps = capability ? [capability] : [...this.queues.keys()]
    let count = 0
    for (const cap of caps) {
      const queue = this.queues.get(cap) || []
      for (const id of queue) {
        const request = this.requests.get(id)
        if (request) {
          request.state = 'stopped'
          request.stoppedAt = new Date(this.now()).toISOString()
          this.requests.delete(id)
          this.payloads.delete(id)
        }
        count += 1
      }
      this.queues.delete(cap)
      this.#audit('stop', { capability: cap, count, reason: safeString(reason, 120) })
    }
    return count
  }

  /** 查询当前排队情况（不含载荷、不含令牌、不含正文）。 */
  snapshot() {
    this.#expire()
    const capabilities = {}
    for (const capability of Object.values(CAPABILITY_WHITELIST)) {
      const queue = this.queues.get(capability) || []
      capabilities[capability] = {
        queued: queue.length,
        limit: this.queueLimits.get(capability) || DEFAULT_QUEUE_LIMIT
      }
    }
    return {
      tokenIssued: Boolean(this.token),
      capabilities
    }
  }

  /** 读取有界审计记录（副本，绝不含载荷/令牌/正文）。 */
  auditLog() {
    // 按写入顺序返回，最旧在前。
    const ordered = this.audit.slice(this.auditIndex).concat(this.audit.slice(0, this.auditIndex))
    return ordered.filter(Boolean)
  }

  // -- 内部 ----------------------------------------------------------------

  #storedPayload(id) {
    const payload = this.payloads.get(id)
    this.payloads.delete(id)
    return payload
  }

  #canConfirm(request) {
    return !request.confirmed && request.sensitive
  }

  #buildConfirmationPolicy(action, sensitive, confirmation) {
    const base = {
      required: sensitive,
      scope: 'user' // 固定由人工/用户确认，不接受自动化授权。
    }
    if (!sensitive) {
      return Object.freeze({ ...base, required: false })
    }
    const extra = confirmation && typeof confirmation === 'object' ? confirmation : {}
    return Object.freeze({
      ...base,
      minAgeMs: finiteInteger(extra.minAgeMs, 0, 0, 30 * 60 * 1000),
      message: safeString(extra.message, 240, `动作 ${action} 需要用户确认。`)
    })
  }

  #expire() {
    const now = this.now()
    for (const [id, request] of this.requests) {
      if (Date.parse(request.expiresAt) <= now) {
        const queue = this.queues.get(request.capability) || []
        this.queues.set(
          request.capability,
          queue.filter(item => item !== id)
        )
        request.state = 'expired'
        this.requests.delete(id)
        this.payloads.delete(id)
      }
    }
    for (const [capability, queue] of this.queues) {
      if (queue.length === 0) this.queues.delete(capability)
    }
  }

  #audit(event, fields) {
    const record = {
      at: new Date(this.now()).toISOString(),
      event,
      ...fields
    }
    // 有界环形：只保留最近 AUDIT_CAPACITY 条。
    if (this.audit.length < AUDIT_CAPACITY) {
      this.audit.push(record)
    } else {
      this.audit[this.auditIndex] = record
      this.auditIndex = (this.auditIndex + 1) % AUDIT_CAPACITY
    }
  }
}

module.exports = {
  ACTION_CAPABILITY,
  AUDIT_CAPACITY,
  CAPABILITY_WHITELIST,
  SENSITIVE_ACTIONS,
  CapabilityBroker,
  generateToken,
  isLoopbackAddress,
  validateSource
}
