// 跨应用 Computer Use 的持久应用授权策略（computer-use-app-policy）。
//
// 语义对齐 Codex 的 computer_use 公共配置：computer use 是内置默认能力，
// 不要求每次会话重复开启技能；访问由「按应用身份」的持久允许/拒绝策略决定：
//   - default_app_access：Codex 风格持久值 allow/deny（UI 的 ask 表示未授权默认），内部兼容旧 trusted/untrusted/never；
//   - allowlist / denylist：显式允许/拒绝规则，规则按 Windows AUMID 或
//     EXE 路径（或文件名）标识应用；
//   - aumids / exes：Codex 风格的便捷字段，等价追加到 allowlist；
//   - 身份指纹绑定：授权必须绑定到应用身份指纹（已签名应用用发布者+产品+
//     签名证书指纹，未签名或无法验证时用规范化 EXE 路径+文件 SHA-256），
//     应用升级/重装导致身份变化时旧授权自动失效（identity-change invalidation）。
//
// 本模块只负责「用户可授予/可撤销的持久策略」与指纹绑定，不做系统级判断：
// UAC/提权/系统进程/敏感窗口等不可绕过禁令由 windows-computer-use.cjs
// 的 classifySystemDeny 负责，两者组合成最终授权决策。
//
// 注意：本层不实现「允许一次」或逐动作确认——点击/输入/滚动等动作的逐次
// 人工确认是 Harness 不可覆盖的安全约定，由上层主进程确认门禁负责，
// 本模块只决定「该应用是否已被持久允许/拒绝」。
//
// 纯 Node 实现（无原生依赖），可用 node:test 独立测试。

const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { assertSafePolicyPath } = require('./browser-session-policy.cjs')

// Codex computer_use.default_app_access 支持的默认档位。
const DEFAULT_ACCESS_VALUES = Object.freeze(['trusted', 'untrusted', 'never'])
const DEFAULT_ACCESS = 'untrusted' // 未显式列出的应用默认不可控，需真实用户显式允许

const SCHEMA_VERSION = 1
const DEFAULT_MAX_RULES = 64
const MAX_RULES = 256
// 策略文件体积上限：超过视为损坏并安全重建（防内存炸弹）。
const MAX_POLICY_FILE_BYTES = 1024 * 1024

const EXE_PATH_HINT = /[\\/]|\.exe$/i

function normalizeDefaultAccess(value) {
  const candidate = String(value || '').toLowerCase().trim()
  if (candidate === 'allow') return 'trusted'
  if (candidate === 'deny') return 'never'
  if (candidate === 'ask') return 'untrusted'
  return DEFAULT_ACCESS_VALUES.includes(candidate) ? candidate : DEFAULT_ACCESS
}

function serializeDefaultAccess(value) {
  if (value === 'trusted') return 'allow'
  if (value === 'never') return 'deny'
  return 'ask'
}

function boundedRuleCount(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? Math.max(1, Math.min(MAX_RULES, number)) : DEFAULT_MAX_RULES
}

function canonicalPath(value) {
  return path.win32.normalize(String(value || '')).replace(/[/\\]+$/, '')
}

function lowerIdentity(value) {
  return String(value || '').toLowerCase()
}

/**
 * 解析一条应用规则：{ aumid: '...' } 或 { exe: '...' }；纯字符串按形态启发式
 * （含路径分隔符或以 .exe 结尾 → exe，否则 → aumid）。
 * @returns {{kind:'aumid'|'exe', value:string}|null}
 */
function parseAppRule(value) {
  if (!value || typeof value !== 'object' && typeof value !== 'string') return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const kind = EXE_PATH_HINT.test(trimmed) ? 'exe' : 'aumid'
    return { kind, value: kind === 'exe' ? canonicalPath(trimmed) : trimmed }
  }
  if (typeof value.aumid === 'string' && value.aumid.trim()) return { kind: 'aumid', value: value.aumid.trim() }
  const publisherName = String(value.publisher_name || value.publisherName || '').trim()
  const productName = String(value.product_name || value.productName || '').trim()
  const binaryName = String(value.binary_name || value.binaryName || '').trim()
  if (publisherName && productName) {
    return {
      kind: 'windows-exe',
      value: `${publisherName} · ${productName}${binaryName ? ` · ${binaryName}` : ''}`,
      publisherName,
      productName,
      binaryName: binaryName || null
    }
  }
  if (typeof value.exe === 'string' && value.exe.trim()) return { kind: 'exe', value: canonicalPath(value.exe) }
  return null
}

/** 规则在某一列表内的规范化键（大小写不敏感）。 */
function ruleKey(rule) {
  if (rule.kind === 'windows-exe') return `windows-exe:${lowerIdentity(rule.publisherName)}\n${lowerIdentity(rule.productName)}\n${lowerIdentity(rule.binaryName || '')}`
  return `${rule.kind}:${lowerIdentity(rule.value)}`
}

/** 应用身份是否命中一条规则（EXE 按路径或文件名，AUMID 精确匹配）。 */
function identityMatchesRule(identity, rule) {
  if (!identity || typeof identity !== 'object') return false
  if (rule.kind === 'aumid') {
    return Boolean(identity.aumid) && lowerIdentity(identity.aumid) === lowerIdentity(rule.value)
  }
  if (rule.kind === 'windows-exe') {
    const publisherMatches = lowerIdentity(identity.publisher).trim() === lowerIdentity(rule.publisherName).trim()
    const productMatches = lowerIdentity(identity.product).trim() === lowerIdentity(rule.productName).trim()
    const binaryMatches = !rule.binaryName || lowerIdentity(identity.exeName).trim() === lowerIdentity(rule.binaryName).trim()
    return publisherMatches && productMatches && binaryMatches
  }
  const exePath = typeof identity.exePath === 'string' ? canonicalPath(identity.exePath) : ''
  const exeName = typeof identity.exeName === 'string' ? identity.exeName : ''
  if (exePath && lowerIdentity(exePath) === lowerIdentity(rule.value)) return true
  // 无路径分隔符的裸文件名规则：按 EXE 文件名匹配。
  if (!/[\\/]/.test(rule.value) && exeName && lowerIdentity(exeName) === lowerIdentity(rule.value)) return true
  return false
}

/**
 * 计算应用身份指纹：
 *   - 已签名且取得证书指纹：signed|发布者|产品|证书指纹（大小写不敏感）；
 *   - 其余（未签名/签名信息不可用）：unsigned|规范化EXE路径|文件SHA-256。
 * 无法取得可绑定字段时返回 null（调用方应 fail-closed）。
 * @returns {{kind:'signed'|'unsigned', fingerprint:string}|null}
 */
function identityFingerprintFor(identity) {
  if (!identity || typeof identity !== 'object') return null
  const signature = identity.signature && typeof identity.signature === 'object' ? identity.signature : null
  const verified = signature?.verified === true
  const thumbprint = typeof signature?.thumbprint === 'string' && /^[a-f0-9]{40}$/i.test(signature.thumbprint)
    ? signature.thumbprint.toLowerCase()
    : ''
  const publisher = typeof identity.publisher === 'string' ? lowerIdentity(identity.publisher.trim()) : ''
  const product = typeof identity.product === 'string' ? lowerIdentity(identity.product.trim()) : ''
  if (verified && thumbprint) {
    if (!publisher || !product) return null
    const payload = `signed\n${publisher}\n${product}\n${thumbprint}`
    return { kind: 'signed', fingerprint: createHash('sha256').update(payload).digest('hex') }
  }
  const exePath = typeof identity.exePath === 'string' ? canonicalPath(identity.exePath) : ''
  const fileHash = typeof identity.fileHash === 'string' ? identity.fileHash.toLowerCase() : ''
  if (!exePath || !/^[a-f0-9]{64}$/.test(fileHash)) return null
  const payload = `unsigned\n${lowerIdentity(exePath)}\n${fileHash}`
  return { kind: 'unsigned', fingerprint: createHash('sha256').update(payload).digest('hex') }
}

function ruleSnapshots(rules) {
  return [...rules.values()]
    .map(rule => ({
      kind: rule.kind,
      value: rule.value,
      ...(rule.kind === 'windows-exe' ? { publisher_name: rule.publisherName, product_name: rule.productName, ...(rule.binaryName ? { binary_name: rule.binaryName } : {}) } : {}),
      fingerprint: rule.fingerprint,
      grantedAt: rule.grantedAt,
      by: rule.by
    }))
    .sort((a, b) => ruleKey(parseAppRule(a) || a).localeCompare(ruleKey(parseAppRule(b) || b)))
}

function codexWindowsSnapshot(allowlist, denylist) {
  const aumids = {}
  const exes = []
  const append = (rules, access) => {
    for (const rule of rules.values()) {
      if (rule.kind === 'aumid') aumids[rule.value] = access
      else if (rule.kind === 'windows-exe') exes.push({
        publisher_name: rule.publisherName,
        product_name: rule.productName,
        ...(rule.binaryName ? { binary_name: rule.binaryName } : {}),
        access
      })
    }
  }
  append(allowlist, 'allow')
  append(denylist, 'deny')
  exes.sort((a, b) => `${a.publisher_name}\n${a.product_name}\n${a.binary_name || ''}\n${a.access}`.localeCompare(`${b.publisher_name}\n${b.product_name}\n${b.binary_name || ''}\n${b.access}`))
  return { aumids, exes }
}

class ComputerUseAppPolicy {
  /**
   * @param {{ file?: string|null, rootDir?: string|null, now?: () => number,
   *           config?: { default_app_access?: string, allowlist?: any[],
   *             denylist?: any[], aumids?: string[], exes?: string[] },
   *           maxRules?: number }} options
   */
  constructor({ file = null, rootDir = null, now = () => Date.now(), config = {}, maxRules = DEFAULT_MAX_RULES } = {}) {
    this.now = now
    this.file = file == null ? null : assertSafePolicyPath(file, { rootDir })
    this.maxRules = boundedRuleCount(maxRules)
    this.bootstrapConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
    this.defaultAppAccess = normalizeDefaultAccess(this.bootstrapConfig.default_app_access)
    this.allowlist = new Map() // ruleKey -> {kind,value,fingerprint,grantedAt,by}
    this.denylist = new Map() // ruleKey -> 同结构
    this.migratedOnLoad = false
    this.#seedBootstrapRules()
    this.#load()
  }

  #seedBootstrapRules() {
    const allowSources = [
      ...(Array.isArray(this.bootstrapConfig.allowlist) ? this.bootstrapConfig.allowlist : []),
      ...(Array.isArray(this.bootstrapConfig.aumids) ? this.bootstrapConfig.aumids.map(value => ({ aumid: value })) : []),
      ...(Array.isArray(this.bootstrapConfig.exes) ? this.bootstrapConfig.exes.map(value => typeof value === 'string' ? { exe: value } : value) : [])
    ]
    const denySources = [...(Array.isArray(this.bootstrapConfig.denylist) ? this.bootstrapConfig.denylist : [])]
    const windows = this.bootstrapConfig.windows && typeof this.bootstrapConfig.windows === 'object' ? this.bootstrapConfig.windows : {}
    if (windows.aumids && typeof windows.aumids === 'object' && !Array.isArray(windows.aumids)) {
      for (const [aumid, access] of Object.entries(windows.aumids)) (String(access).toLowerCase() === 'allow' ? allowSources : denySources).push({ aumid })
    }
    for (const entry of Array.isArray(windows.exes) ? windows.exes : []) {
      if (!entry || typeof entry !== 'object') continue
      ;(String(entry.access).toLowerCase() === 'allow' ? allowSources : denySources).push(entry)
    }
    for (const source of allowSources) {
      const rule = parseAppRule(source)
      if (rule) this.allowlist.set(ruleKey(rule), { ...rule, fingerprint: null, grantedAt: 0, by: 'config' })
    }
    for (const source of denySources) {
      const rule = parseAppRule(source)
      if (rule) this.denylist.set(ruleKey(rule), { ...rule, fingerprint: null, grantedAt: 0, by: 'config' })
    }
  }

  #load() {
    if (!this.file) return
    let parsed = null
    let oversized = false
    try {
      const stat = fs.statSync(this.file)
      if (!stat.isFile()) return
      if (stat.size > MAX_POLICY_FILE_BYTES) {
        oversized = true
      } else {
        parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      }
    } catch {
      return // 无法读取/损坏：保持空策略（安全降级，绝不崩溃）
    }
    if (oversized) {
      this.allowlist = new Map()
      this.denylist = new Map()
      this.#persist() // 立即用空策略重建
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    if (Number(parsed.schemaVersion) !== SCHEMA_VERSION) return
    if (parsed.default_app_access || parsed.defaultAppAccess) this.defaultAppAccess = normalizeDefaultAccess(parsed.default_app_access || parsed.defaultAppAccess)
    this.#loadRules(this.allowlist, parsed.allowlist)
    this.#loadRules(this.denylist, parsed.denylist)
    this.#enforceCapacity()
  }

  #loadRules(target, rawList) {
    if (!Array.isArray(rawList)) return
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const fingerprint = typeof raw.fingerprint === 'string' ? raw.fingerprint : null
      if (fingerprint && !/^[a-f0-9]{64}$/.test(fingerprint)) continue
      const rule = parseAppRule(raw.kind === 'exe'
        ? { exe: raw.value }
        : raw.kind === 'aumid'
          ? { aumid: raw.value }
          : raw.kind === 'windows-exe'
            ? { publisher_name: raw.publisher_name, product_name: raw.product_name, binary_name: raw.binary_name }
            : null)
      if (!rule) continue
      const grantedAt = Number.isFinite(Number(raw.grantedAt)) ? Number(raw.grantedAt) : 0
      target.set(ruleKey(rule), { ...rule, fingerprint, grantedAt, by: raw.by === 'user' ? 'user' : 'config' })
    }
  }

  #enforceCapacity() {
    while (this.allowlist.size + this.denylist.size > this.maxRules) {
      const allowFirst = this.allowlist.keys().next().value
      const denyFirst = this.denylist.keys().next().value
      if (denyFirst == null || (allowFirst != null && allowFirst <= denyFirst)) this.allowlist.delete(allowFirst)
      else this.denylist.delete(denyFirst)
    }
  }

  #persist() {
    if (!this.file) return
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      default_app_access: serializeDefaultAccess(this.defaultAppAccess),
      windows: codexWindowsSnapshot(this.allowlist, this.denylist),
      allowlist: ruleSnapshots(this.allowlist),
      denylist: ruleSnapshots(this.denylist)
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temp, this.file)
  }

  #setDefaultAccess(value, by) {
    if (by !== 'user') throw Object.assign(new Error('策略默认档位只能由真实用户修改。'), { code: 'user-consent-required' })
    this.defaultAppAccess = normalizeDefaultAccess(value)
    this.#persist()
    return this.defaultAppAccess
  }

  setDefaultAccess(value, { by = 'user' } = {}) {
    return this.#setDefaultAccess(value, by)
  }

  /**
   * 持久允许一个应用身份：把绑定当前身份指纹的 allowlist 规则写入策略。
   * identity-change invalidation：之后该 EXE 升级/重签名 → 指纹变 → 规则不再生效，
   * 应用回落默认档位，需用户重新允许。
   */
  allow(identity, { by = 'user' } = {}) {
    if (by !== 'user') throw Object.assign(new Error('持久授权只能由真实用户授予。'), { code: 'user-consent-required' })
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new Error('授权目标必须是应用身份对象。')
    const rule = parseAppRule(ruleFromIdentity(identity))
    if (!rule) throw Object.assign(new Error('无法解析应用身份，不能建立持久授权。'), { code: 'identity-unresolved' })
    const fingerprint = identityFingerprintFor(identity)
    if (!fingerprint) throw Object.assign(new Error('应用身份指纹不可解析（缺少 EXE 路径/文件哈希或签名信息），拒绝持久授权。'), { code: 'identity-unresolved' })
    const now = this.now()
    this.allowlist.set(ruleKey(rule), { ...rule, fingerprint: fingerprint.fingerprint, grantedAt: now, by: 'user' })
    this.#enforceCapacity()
    this.#persist()
    return { rule, fingerprint: fingerprint.fingerprint, grantedAt: now }
  }

  /**
   * 持久拒绝一个应用身份。denylist 是持久且不可因身份变化而失效的：
   * 以 EXE 路径/AUMID 为准，应用更新后旧拒绝依然生效（安全优先）。
   */
  deny(identity, { by = 'user' } = {}) {
    if (by !== 'user') throw Object.assign(new Error('持久拒绝只能由真实用户设置。'), { code: 'user-consent-required' })
    const rule = parseAppRule(ruleFromIdentity(identity))
    if (!rule) throw Object.assign(new Error('无法解析应用身份，不能建立持久拒绝。'), { code: 'identity-unresolved' })
    const fingerprint = identityFingerprintFor(identity)
    const now = this.now()
    // deny 不需要绑定指纹才能生效；记录指纹仅用于报告身份是否变化。
    this.denylist.set(ruleKey(rule), { ...rule, fingerprint: fingerprint ? fingerprint.fingerprint : null, grantedAt: now, by: 'user' })
    this.#enforceCapacity()
    this.#persist()
    return { rule, fingerprint: fingerprint ? fingerprint.fingerprint : null, grantedAt: now }
  }

  /** 撤销单条规则；list 为 'allowlist' | 'denylist'。 */
  revoke(ruleLike, { list = 'allowlist', by = 'user' } = {}) {
    if (by !== 'user') throw Object.assign(new Error('撤销授权只能由真实用户执行。'), { code: 'user-consent-required' })
    const rule = parseAppRule(ruleLike)
    if (!rule) return false
    const target = list === 'denylist' ? this.denylist : this.allowlist
    const removed = target.delete(ruleKey(rule))
    if (removed) this.#persist()
    return removed
  }

  revokeAll({ list = 'allowlist', by = 'user' } = {}) {
    if (by !== 'user') throw Object.assign(new Error('撤销授权只能由真实用户执行。'), { code: 'user-consent-required' })
    const target = list === 'denylist' ? this.denylist : this.allowlist
    const count = target.size
    target.clear()
    if (count) this.#persist()
    return count
  }

  /** 决策入口（不含系统级禁令）：先 denylist、再 allowlist、最后默认档位。 */
  decide(identity) {
    const fingerprint = identityFingerprintFor(identity)
    if (!identity || typeof identity !== 'object') {
      return { status: 'denied', reason: 'identity-unresolved', matchedBy: null, invalidated: false, invalidatedRule: null, fingerprint: null, defaultAppAccess: this.defaultAppAccess }
    }
    // 1) 显式拒绝：持久生效。config 规则始终生效；用户拒绝即使身份变化仍生效，
    //    只报告 identityChanged（同样路径上的同一应用升级后依然被拒）。
    for (const rule of this.denylist.values()) {
      if (!identityMatchesRule(identity, rule)) continue
      const bound = Boolean(rule.fingerprint)
      const identityChanged = bound && rule.fingerprint !== fingerprint?.fingerprint
      return { status: 'denied', reason: 'denylist', matchedBy: ruleToPublic(rule), invalidated: false, identityChanged, invalidatedRule: null, fingerprint: fingerprint?.fingerprint ?? null, defaultAppAccess: this.defaultAppAccess }
    }
    // 2) 显式允许。config 规则（未绑定指纹）为静态身份规则，始终生效；
    //    用户授权绑定指纹，身份变化 → 失效并按默认档位处理。
    for (const rule of this.allowlist.values()) {
      if (!identityMatchesRule(identity, rule)) continue
      if (!rule.fingerprint || (fingerprint && rule.fingerprint === fingerprint.fingerprint)) {
        return { status: 'allowed', reason: 'allowlist', matchedBy: ruleToPublic(rule), invalidated: false, invalidatedRule: null, fingerprint: fingerprint?.fingerprint ?? null, defaultAppAccess: this.defaultAppAccess }
      }
      return { status: defaultStatusFor(this.defaultAppAccess), reason: 'allowlist-invalidated', matchedBy: null, invalidated: true, invalidatedRule: ruleKey(rule), fingerprint: fingerprint?.fingerprint ?? null, defaultAppAccess: this.defaultAppAccess }
    }
    // 3) 默认档位。
    if (this.defaultAppAccess === 'trusted') {
      return { status: 'allowed', reason: 'default-trusted', matchedBy: null, invalidated: false, invalidatedRule: null, fingerprint: fingerprint?.fingerprint ?? null, defaultAppAccess: this.defaultAppAccess }
    }
    if (this.defaultAppAccess === 'never') {
      return { status: 'denied', reason: 'default-deny', matchedBy: null, invalidated: false, invalidatedRule: null, fingerprint: fingerprint?.fingerprint ?? null, defaultAppAccess: this.defaultAppAccess }
    }
    return { status: 'untrusted', reason: 'default-untrusted', matchedBy: null, invalidated: false, invalidatedRule: null, fingerprint: fingerprint?.fingerprint ?? null, defaultAppAccess: this.defaultAppAccess }
  }

  /** 仅权限元数据快照（fingerprint 为哈希，不含任何会话/敏感数据）。 */
  snapshot() {
    return {
      schemaVersion: SCHEMA_VERSION,
      default_app_access: serializeDefaultAccess(this.defaultAppAccess),
      defaultAppAccess: this.defaultAppAccess,
      windows: codexWindowsSnapshot(this.allowlist, this.denylist),
      maxRules: this.maxRules,
      allowlist: ruleSnapshots(this.allowlist),
      denylist: ruleSnapshots(this.denylist)
    }
  }
}

function defaultStatusFor(defaultAccess) {
  if (defaultAccess === 'trusted') return 'allowed'
  if (defaultAccess === 'never') return 'denied'
  return 'untrusted'
}

function ruleFromIdentity(identity) {
  if (!identity || typeof identity !== 'object') return null
  if (typeof identity.aumid === 'string' && identity.aumid.trim()) return { aumid: identity.aumid }
  if (typeof identity.publisher === 'string' && identity.publisher.trim() && typeof identity.product === 'string' && identity.product.trim()) {
    return { publisher_name: identity.publisher, product_name: identity.product, ...(identity.exeName ? { binary_name: identity.exeName } : {}) }
  }
  if (typeof identity.exe === 'string' && identity.exe.trim()) return { exe: identity.exe }
  if (typeof identity.exePath === 'string' && identity.exePath.trim()) return { exe: identity.exePath }
  return null
}

function ruleToPublic(rule) {
  return {
    kind: rule.kind,
    value: rule.value,
    ...(rule.kind === 'windows-exe' ? { publisher_name: rule.publisherName, product_name: rule.productName, ...(rule.binaryName ? { binary_name: rule.binaryName } : {}) } : {})
  }
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_ACCESS_VALUES,
  DEFAULT_ACCESS,
  DEFAULT_MAX_RULES,
  MAX_RULES,
  MAX_POLICY_FILE_BYTES,
  ComputerUseAppPolicy,
  normalizeDefaultAccess,
  serializeDefaultAccess,
  parseAppRule,
  ruleKey,
  identityMatchesRule,
  identityFingerprintFor
}