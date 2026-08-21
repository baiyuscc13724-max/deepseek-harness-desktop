// 右栏内置浏览器「按 origin 的模型站点授权」存储与校验（browser-site-authz）。
//
// 职责：以规范化 origin（scheme://host[:非默认端口]，统一小写）为键，保存并
// 校验模型对站点的精细操作授权。设计要点：
//   - 分权：read/click/type/upload/download/submit 六类动作独立授权，默认全拒；
//   - TTL：每条授权带过期时间，读取/快照时惰性清理；
//   - 撤销：单 origin 撤销（revoke）与整体撤销（revokeAll）；
//   - 上限：最大条目数（LRU 淘汰，重新授权即刷新顺序）；
//   - 持久化：原子写 JSON，只落盘权限元数据（actions/grantedAt/expiresAt），
//     永不落盘 Cookie、密码、token 或任何会话数据；
//   - 迁移：旧版 v1（per-origin 布尔全量授权）加载时自动迁移为完整动作集，
//     结构不符或损坏的文件安全降级为空授权（绝不崩溃）。
// 纯 Node 实现，可独立用 node:test 测试。

const fs = require('node:fs')
const path = require('node:path')
const { URL } = require('node:url')
const { canonicalOrigin, hostPublicInfo } = require('./browser-url-policy.cjs')
const { assertSafePolicyPath } = require('./browser-session-policy.cjs')

// 模型对站点可被授权的精细动作（与浏览器实际操作一一对应）。
const ACTIONS = Object.freeze(['read', 'click', 'type', 'upload', 'download', 'submit'])
const ACTION_SET = new Set(ACTIONS)

const DEFAULT_MAX_ENTRIES = 64
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000 // 默认 2 小时
const MIN_TTL_MS = 60 * 1000 // 1 分钟
const MAX_TTL_MS = 24 * 60 * 60 * 1000 // 24 小时
const SCHEMA_VERSION = 3
// 策略文件体积上限：超过即视为损坏并安全重建（防内存炸弹）。
const MAX_AUTHZ_FILE_BYTES = 1024 * 1024

function boundedTtl(value, fallback = DEFAULT_TTL_MS) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.round(number)))
}

function finiteMs(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback
}

function tryOrigin(value) {
  try { return canonicalOrigin(value) } catch { return null }
}

function normalizeEntry(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const actions = Array.isArray(raw.actions)
    ? [...new Set(raw.actions.map(a => String(a)).filter(a => ACTION_SET.has(a)))]
    : ACTIONS.slice()
  if (!actions.length) return null
  const grantedAt = finiteMs(raw.grantedAt, now)
  const expiresAt = finiteMs(raw.expiresAt, Math.min(now + DEFAULT_TTL_MS, now + MAX_TTL_MS))
  if (expiresAt <= now) return null // 已过期条目直接丢弃
  return { actions: new Set(actions), grantedAt, expiresAt, privateNetwork: raw.privateNetwork === true }
}

function isPrivateNetworkOrigin(origin) {
  const normalized = tryOrigin(origin)
  if (!normalized) return false
  return !hostPublicInfo(new URL(normalized).hostname).public
}

class SiteAuthorizationStore {
  /**
   * @param {{ file?: string|null, rootDir?: string, now?: () => number,
   *           maxEntries?: number, defaultTtlMs?: number }} options
   */
  constructor({ file = null, rootDir = null, now = () => Date.now(), maxEntries = DEFAULT_MAX_ENTRIES, defaultTtlMs = DEFAULT_TTL_MS } = {}) {
    this.now = now
    this.file = file == null ? null : assertSafePolicyPath(file, { rootDir })
    this.maxEntries = Math.max(1, Math.min(256, Math.trunc(Number(maxEntries) || DEFAULT_MAX_ENTRIES)))
    this.defaultTtlMs = boundedTtl(defaultTtlMs)
    this.migratedOnLoad = false
    this.entries = new Map() // origin -> { actions: Set, grantedAt, expiresAt }
    this.#load()
  }

  #load() {
    if (!this.file) return
    let parsed = null
    let oversized = false
    try {
      const stat = fs.statSync(this.file)
      if (!stat.isFile()) return
      if (stat.size > MAX_AUTHZ_FILE_BYTES) {
        oversized = true
      } else {
        parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      }
    } catch {
      return // 无法读取/损坏：保持空授权
    }
    if (oversized) {
      this.entries = new Map()
      this.#persist() // 立即用空策略安全重建
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const version = Number(parsed.schemaVersion)
    if ((version === SCHEMA_VERSION || version === 2) && parsed.entries && typeof parsed.entries === 'object' && !Array.isArray(parsed.entries)) {
      const now = this.now()
      for (const [origin, raw] of Object.entries(parsed.entries)) {
        const normalized = tryOrigin(origin)
        if (!normalized) continue
        const entry = normalizeEntry(version === SCHEMA_VERSION ? raw : { ...raw, privateNetwork: false }, now)
        if (entry) this.entries.set(normalized, entry)
      }
      this.migratedOnLoad = false
    } else if (version === 1 && parsed.origins && typeof parsed.origins === 'object' && !Array.isArray(parsed.origins)) {
      // v1 迁移：origins: { origin: true } 视为全量动作授权。
      const now = this.now()
      for (const origin of Object.keys(parsed.origins)) {
        const normalized = tryOrigin(origin)
        if (!normalized) continue
        this.entries.set(normalized, { actions: new Set(ACTIONS), grantedAt: now, expiresAt: now + this.defaultTtlMs, privateNetwork: false })
      }
      this.migratedOnLoad = true
    } else {
      return // 未知结构：安全降级为空授权
    }
    this.#enforceCapacity()
    if (this.migratedOnLoad) this.#persist() // 迁移后立即落盘为当前版本
  }

  #enforceCapacity() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
  }

  #persist() {
    if (!this.file) return
    const payload = { schemaVersion: SCHEMA_VERSION, entries: {} }
    for (const [origin, entry] of this.entries) {
      payload.entries[origin] = {
        actions: [...entry.actions].sort(),
        grantedAt: entry.grantedAt,
        expiresAt: entry.expiresAt,
        privateNetwork: entry.privateNetwork === true
      }
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temp, this.file)
  }

  /** 授权（新增或更新，刷新 LRU 顺序与过期时间）。 */
  grant(origin, { actions = ACTIONS, ttlMs, allowPrivateNetwork = false, by = null } = {}) {
    const normalized = tryOrigin(origin)
    if (!normalized) throw new Error('授权目标必须是规范化的 http/https origin。')
    const privateNetwork = isPrivateNetworkOrigin(normalized)
    if (privateNetwork && !(allowPrivateNetwork === true && by === 'user')) {
      const error = new Error('localhost/内网站点只能由真实用户针对精确 origin 明确授权。')
      error.code = 'private-network-explicit-consent-required'
      throw error
    }
    const granted = Array.isArray(actions) ? [...new Set(actions.map(a => String(a)))] : []
    if (!granted.length) throw new Error('授权动作列表不能为空。')
    for (const action of granted) {
      if (!ACTION_SET.has(action)) throw new Error(`未知的授权动作：${action}`)
    }
    const now = this.now()
    const ttl = boundedTtl(ttlMs == null ? this.defaultTtlMs : ttlMs)
    this.entries.delete(normalized) // 重新插入以更新 LRU 顺序
    this.entries.set(normalized, {
      actions: new Set(granted),
      grantedAt: now,
      expiresAt: now + ttl,
      privateNetwork
    })
    this.#enforceCapacity()
    this.#persist()
    return this.entryOf(normalized)
  }

  /** 校验某 origin 是否拥有某动作授权（默认拒绝；顺带惰性清理过期）。 */
  authorized(origin, action) {
    if (!ACTION_SET.has(String(action))) return false
    const normalized = tryOrigin(origin)
    if (!normalized) return false
    const entry = this.entries.get(normalized)
    if (!entry) return false
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(normalized)
      this.#persist()
      return false
    }
    return entry.actions.has(String(action))
  }

  /** 某 origin 是否持有一组动作中的任意一项（用于导航等整体授权判断）。 */
  originGranted(origin) {
    return this.actionsFor(origin).length > 0
  }

  /** 返回某 origin 当前有效的授权动作列表（已过期返回空数组）。 */
  actionsFor(origin) {
    const normalized = tryOrigin(origin)
    if (!normalized) return []
    const entry = this.entries.get(normalized)
    if (!entry) return []
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(normalized)
      this.#persist()
      return []
    }
    return [...entry.actions].sort()
  }

  /** 当前有效的全部 origin 列表（已过期的不算）。 */
  origins() {
    this.prune()
    return [...this.entries.keys()]
  }

  /** 单条授权快照。 */
  entryOf(origin) {
    const normalized = tryOrigin(origin)
    if (!normalized) return null
    const entry = this.entries.get(normalized)
    if (!entry || entry.expiresAt <= this.now()) return null
    return { origin: normalized, actions: [...entry.actions].sort(), grantedAt: entry.grantedAt, expiresAt: entry.expiresAt, privateNetwork: entry.privateNetwork === true }
  }

  /** 仅返回经真实用户显式批准的 localhost/内网精确 origin。 */
  privateOrigins() {
    this.prune()
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.privateNetwork === true)
      .map(([origin]) => origin)
  }

  /** 撤销单个 origin 的所有授权。 */
  revoke(origin) {
    const normalized = tryOrigin(origin)
    if (!normalized || !this.entries.has(normalized)) return false
    this.entries.delete(normalized)
    this.#persist()
    return true
  }

  /** 撤销全部授权，返回被撤销的 origin 数量。 */
  revokeAll() {
    const count = this.entries.size
    this.entries.clear()
    this.#persist()
    return count
  }

  /** 清理全部过期条目，返回清除数量。 */
  prune() {
    const now = this.now()
    const expired = [...this.entries].filter(([, entry]) => entry.expiresAt <= now)
    for (const [origin] of expired) this.entries.delete(origin)
    if (expired.length) this.#persist()
    return expired.length
  }

  /** 只含权限元数据的快照，绝不包含任何会话数据。 */
  snapshot() {
    this.prune()
    const entries = [...this.entries.entries()]
      .map(([origin, entry]) => ({ origin, actions: [...entry.actions].sort(), grantedAt: entry.grantedAt, expiresAt: entry.expiresAt, privateNetwork: entry.privateNetwork === true }))
      .sort((a, b) => a.origin.localeCompare(b.origin))
    return {
      schemaVersion: SCHEMA_VERSION,
      maxEntries: this.maxEntries,
      count: entries.length,
      migratedOnLoad: this.migratedOnLoad,
      entries
    }
  }
}

module.exports = {
  ACTIONS,
  ACTION_SET,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
  MAX_AUTHZ_FILE_BYTES,
  MAX_TTL_MS,
  MIN_TTL_MS,
  SCHEMA_VERSION,
  SiteAuthorizationStore,
  boundedTtl,
  isPrivateNetworkOrigin,
  normalizeEntry,
  tryOrigin
}