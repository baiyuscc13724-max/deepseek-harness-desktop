// 右栏内置浏览器统一安全策略（browser-security-policy）。
//
// 职责：作为浏览器安全策略的组合根，把 URL 导航策略、会话分区策略、按
// origin 的站点授权、模型动作门禁与有界审计串成一条不可绕过的链路。集成方
// （右栏浏览器宿主）只与本模块打交道：
//   - 用户导航（userNavigate）：走用户档策略（仅 http/https），导航成功后
//     宿主应回调 setActiveTab 上报当前可见活动标签；
//   - 登录由用户在真实右栏浏览器页面亲自完成：模型既看不到密码输入框中的值，
//     也无法读取或写入任何敏感字段，Cookie 只在独立分区内由真实浏览器管理；
//   - 模型访问（modelNavigate/modelAction）：走更严策略（公网 + origin 已
//     授权 + 分权 + 敏感拦截 + 关键动作人工确认）；
//   - stop() 停机、revokeAll() 整体撤销授权、auditSnapshot() 查看有界审计。
// 纯 Node 实现，无 Electron 依赖，可独立用 node:test 测试。

const { randomUUID } = require('node:crypto')
const { BROWSER_PARTITION, assertIndependentPartition, resolveBrowserPartition } = require('./browser-session-policy.cjs')
const { canonicalOrigin, checkModelNavigation, checkUserNavigation } = require('./browser-url-policy.cjs')
const { BrowserAudit } = require('./browser-audit.cjs')
const { ActionGate } = require('./browser-action-gate.cjs')
const { SiteAuthorizationStore } = require('./browser-site-authz.cjs')

function policyError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

class BrowserSecurityPolicy {
  /**
   * @param {{ authzFile?: string|null, authzRootDir?: string, auditMaxEntries?: number,
   *           now?: () => number, idFactory?: () => string,
   *           confirmationTtlMs?: number }} options
   */
  constructor({ authzFile = null, authzRootDir = null, auditMaxEntries, now = () => Date.now(), idFactory = () => randomUUID(), confirmationTtlMs } = {}) {
    this.now = now
    this.idFactory = idFactory
    this.stopped = false
    this.partition = BROWSER_PARTITION // 固定独立持久化分区，与官方 persist:harness 隔离
    this.authz = new SiteAuthorizationStore({ file: authzFile, rootDir: authzRootDir, now })
    this.gate = new ActionGate({ now, idFactory, confirmationTtlMs })
    this.auditLog = new BrowserAudit({ maxEntries: auditMaxEntries, now })
  }

  /** 供接入方核对并采用的分区名（与官方 persist:harness 绝不共用）。 */
  static partitionName() {
    return resolveBrowserPartition()
  }

  /** 校验任意分区名满足隔离要求（接入方如自定义分区名时使用）。 */
  static assertPartition(name) {
    return assertIndependentPartition(name)
  }

  /** 当前右栏浏览器的固定分区名。 */
  get partitionName() {
    return this.partition
  }

  get isStopped() {
    return this.stopped
  }

  /** 由集成方上报当前可见的右栏活动标签（DID-NAVIGATE / 标签切换时）。 */
  setActiveTab(tab) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    const info = this.gate.setActiveTab(tab)
    this.auditLog.record({ actor: 'user', action: 'tab-active', origin: info.origin, tabId: info.id, result: 'info' })
    return info
  }

  /** 用户浏览档导航：仅 http/https。成功后由集成方跟进 setActiveTab。 */
  userNavigate(url, { base } = {}) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    const nav = checkUserNavigation(url, { base })
    this.auditLog.record({ actor: 'user', action: 'navigate', origin: nav.origin, result: 'allowed', code: 'ok' })
    return { normalized: nav.normalized, origin: nav.origin }
  }

  /**
   * 模型访问档导航：公网 + origin 已授权，且必须作用于当前可见活动标签。
   * 成功后活动标签 origin 随之更新（同一标签发生了导航）。
   */
  modelNavigate(url, { tabId, base } = {}) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    try {
      const tab = this.gate.activeTabInfo
      if (!tab) throw policyError('no-active-tab', '当前没有可操作的右栏活动标签。')
      if (!tab.visible) throw policyError('tab-not-visible', '模型仅可操作当前可见的右栏活动标签。')
      if (String(tabId) !== tab.id) throw policyError('tab-mismatch', '模型仅可操作当前可见的右栏活动标签，标签不一致。')
      const nav = checkModelNavigation(url, { authorizedOrigins: this.authz.origins(), base })
      this.gate.setActiveTab({ id: tab.id, origin: nav.origin, visible: true })
      this.auditLog.record({ actor: 'model', action: 'navigate', origin: nav.origin, tabId: tab.id, result: 'allowed', code: 'ok' })
      return { normalized: nav.normalized, origin: nav.origin }
    } catch (error) {
      this.auditLog.record({ actor: 'model', action: 'navigate', origin: null, tabId: tabId, result: 'denied', code: error.code || 'denied' })
      throw error
    }
  }

  /**
   * 模型对当前可见活动标签发起动作，经过完整门禁。
   * @returns {{ allowed: true, action, origin, tabId } |
   *           { allowed: false, requiresConfirmation: true, confirmationId, action, origin, summary }}
   * @throws 带 code 的拒绝错误（门禁拒绝）。
   */
  modelAction({ action, tabId, declaredOrigin, field, payload, confirmationId } = {}) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    let origin = null
    try {
      const decision = this.gate.gate({ action, tabId, declaredOrigin, field, payload, confirmationId, authorizations: this.authz })
      if (decision.verdict === 'confirm-required') {
        origin = decision.origin
        this.auditLog.record({ actor: 'model', action, origin, tabId: decision.tabId, result: 'confirm-required', code: 'confirmation-required' })
        return { allowed: false, requiresConfirmation: true, confirmationId: decision.confirmationId, action, origin, tabId: decision.tabId, summary: decision.summary }
      }
      origin = decision.origin
      this.auditLog.record({ actor: 'model', action, origin, tabId: decision.tabId, result: 'allowed', code: 'ok' })
      return { allowed: true, action, origin, tabId: decision.tabId }
    } catch (error) {
      this.auditLog.record({ actor: 'model', action, origin, tabId: null, result: 'denied', code: error.code || 'denied' })
      throw error
    }
  }

  /** 模型站点授权管理（委托给按 origin 授权存储）。 */
  grant(origin, options) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    const entry = this.authz.grant(origin, options)
    this.auditLog.record({ actor: 'system', action: 'grant', origin: entry.origin, result: 'allowed' })
    return entry
  }

  revoke(origin) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    const removed = this.authz.revoke(origin)
    if (removed) {
      let auditOrigin = null
      try { auditOrigin = canonicalOrigin(origin) } catch { /* 非合规 origin 不记审计 origin */ }
      this.auditLog.record({ actor: 'system', action: 'revoke', origin: auditOrigin, result: 'allowed' })
    }
    return removed
  }

  /** 整体撤销全部模型站点授权，并清空待确认请求。 */
  revokeAll() {
    const count = this.authz.revokeAll()
    this.gate.clearConfirmations()
    this.auditLog.record({ actor: 'system', action: 'revoke-all', origin: null, result: 'info', message: `已撤销 ${count} 个站点的模型授权` })
    return count
  }

  /** 用户接管或 Profile 重置：立即清空活动标签与全部一次性确认，不改变授权。 */
  clearPendingControl() {
    this.gate.clearActiveTab()
    this.gate.clearConfirmations()
    return true
  }

  /** 当前生效中的授权快照（仅权限元数据）。 */
  authorizations() {
    return this.authz.snapshot()
  }

  /** 待确认请求（只读、无敏感内容）。 */
  pendingConfirmations() {
    return this.gate.pendingConfirmations()
  }

  /** 用户确认一次待确认请求（只有真实用户能确认）。 */
  confirm(confirmationId, { by = 'user' } = {}) {
    if (this.stopped) throw policyError('stopped', '浏览器安全策略已停止。')
    const request = this.gate.confirm(confirmationId, { by })
    this.auditLog.record({ actor: 'user', action: 'confirm', origin: request.origin, tabId: request.tabId, result: 'confirmed', code: 'ok' })
    return request
  }

  rejectConfirmation(confirmationId) {
    if (this.stopped) return false
    return this.gate.rejectConfirmation(confirmationId)
  }

  /** 有界审计只读快照。 */
  auditSnapshot() {
    return this.auditLog.snapshot()
  }

  /** 清除浏览器策略审计元数据；用于用户确认后的完整 Profile 重置。 */
  clearAudit() {
    return this.auditLog.clear()
  }

  /** 停机：停止接受一切新操作并关闭审计；幂等。 */
  stop() {
    if (this.stopped) return this.auditSnapshot()
    this.stopped = true
    this.gate.clearActiveTab()
    this.gate.clearConfirmations()
    this.auditLog.record({ actor: 'system', action: 'stop', origin: null, result: 'info', code: 'ok' })
    return this.auditLog.stop()
  }
}

module.exports = {
  BrowserSecurityPolicy
}