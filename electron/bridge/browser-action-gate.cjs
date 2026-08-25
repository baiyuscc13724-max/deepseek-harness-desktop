// 右栏内置浏览器「模型动作门禁」（browser-action-gate）。
//
// 职责：在模型对右栏浏览器发起任意动作之前做多道强制校验，任何一道不满足
// 都直接拒绝。校验维度：
//   1) 活动标签：模型只可操作「当前可见的右栏活动标签」（tabId 必须一致且
//      标签可见）；无活动标签或标签隐藏一律拒绝；
//   2) 来源校验：动作的 declaredOrigin/field.baseUrl 必须与活动标签的真实
//      origin 一致，杜绝模型伪造来源（来源以活动标签为准，调用方声明仅作核对）；
//   3) 分权授权：read/click/type/upload/download/submit 各自独立授权（由
//      browser-site-authz 提供），导航要求目标 origin 已授权且公网可达；
//   4) 敏感字段与敏感值：密码/银行卡/验证码/支付/银行/登录令牌/API key/
//      Cookie/Authorization 等字段永远禁止读取或输入；输入载荷与读取结果中
//      出现密码、token、Cookie、卡号等敏感内容一律拒绝（复用 memory-censor）；
//   5) 人工确认：上传/下载/提交/发布/删除 等关键动作必须经过真实用户确认，
//      确认请求一次性、带 TTL、绑定动作+origin+标签，模型无法自我确认；
//   6) 大小限制：输入文本、读取结果、上传内容、下载体积均有硬上限。
// 纯 Node 实现，无 Electron 依赖，可独立用 node:test 测试。

const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { detectHighRisk } = require('./memory-censor.cjs')
const { checkModelNavigation, canonicalOrigin, classifyNavigation } = require('./browser-url-policy.cjs')

// 模型可对浏览器发起的动作全集。
const MODEL_ACTIONS = Object.freeze([
  'navigate', 'read', 'click', 'type', 'upload', 'download', 'submit', 'publish', 'delete'
])

// 需要人工确认的关键动作（越权/破坏性强）。
const CRITICAL_ACTIONS = new Set(['upload', 'download', 'submit', 'publish', 'delete'])

// 动作 -> 需要的精细授权（navigate 不走细粒度授权，由「origin 已授权」决定；
// publish/delete 视为复合动作，要求 submit 级授权 + 人工确认）。
const ACTION_PERMISSION = Object.freeze({
  navigate: null,
  read: 'read',
  click: 'click',
  type: 'type',
  upload: 'upload',
  download: 'download',
  submit: 'submit',
  publish: 'submit',
  delete: 'submit'
})

// 大小限制。
const MAX_TYPE_LENGTH = 4000
const MAX_READ_TEXT_LENGTH = 1024 * 1024
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const MAX_UPLOAD_BASE64_LENGTH = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
const MAX_CONFIRMATIONS_PENDING = 16
const MAX_FILE_PATH_LENGTH = 1024
const DEFAULT_CONFIRMATION_TTL_MS = 60 * 1000

// 敏感输入类型（input[type] / 语义控件类型）。
const SENSITIVE_INPUT_TYPES = new Set([
  'password', 'passwd', 'pwd', 'cardnumber', 'cc-number', 'cc-csc', 'cvv',
  'cvc', 'ccv', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'otp', 'one-time-code',
  'totp', 'token', 'api-key', 'secret', 'authorization', 'cookie', 'username',
  'email', 'account', 'account-number'
])

// autocomplete 中明示敏感语义的值。
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password', 'new-password', 'one-time-code', 'cc-number', 'cc-csc',
  'cc-exp', 'cc-exp-month', 'cc-exp-year', 'username', 'email'
])

// 字段名/标签/选择器中命中即视为敏感（覆盖中英文常见表达）。
const SENSITIVE_NAME_RE = /(password|passwd|pwd|口令|密码|card|卡号|cvv|cvc|security\s*code|安全码|otp|验证码|动态码|verif|token|api[_-]?key|secret|密钥|私钥|cookie|authorization|bearer|银行|bank|payment|payee|支付|付款|account|acct|user(?:name|[_-]?id)|login|e-?mail|账号|帐号|账户|用户名|邮箱)/i
const SENSITIVE_VALUE_RE = /(?:\b(?:account|acct|username|user[_-]?id|login|e-?mail)\s*[:=]|账号\s*[:：]|帐号\s*[:：]|账户\s*[:：]|用户名\s*[:：]|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/

function gateError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function boundedInt(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isInteger(number)) return fallback
  return Math.max(minimum, Math.min(maximum, number))
}

function safeTextPlain(value, maximum = 500) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maximum)
}

/**
 * 将调用方传入的字段描述规整为可判定的结构。
 * 所有字段都按字符串处理，任何非字符串输入都会被安全地折叠，绝不外溢。
 */
function normalizeField(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return null
  const single = value => (value == null ? '' : String(value))
  return {
    tag: single(field.tag).toLowerCase(),
    type: single(field.type).toLowerCase(),
    name: single(field.name),
    id: single(field.id),
    role: single(field.role).toLowerCase(),
    autocomplete: single(field.autocomplete).toLowerCase().split(/\s+/).filter(Boolean),
    ariaLabel: single(field.ariaLabel),
    label: single(field.label),
    selector: single(field.selector),
    backendNodeId: single(field.backendNodeId),
    baseUrl: field.baseUrl == null ? null : single(field.baseUrl)
  }
}

/** 判断一个表单字段是否为敏感字段（密码/银行卡/验证码/令牌/密钥/Cookie 等）。 */
function isSensitiveField(field) {
  const f = normalizeField(field)
  if (!f) return false
  if (f.type && SENSITIVE_INPUT_TYPES.has(f.type)) return true
  if (f.autocomplete.some(value => SENSITIVE_AUTOCOMPLETE.has(value))) return true
  const haystack = [f.name, f.id, f.role, f.ariaLabel, f.label, f.selector].filter(Boolean).join(' \u0001 ')
  return SENSITIVE_NAME_RE.test(haystack)
}

/** 文本中出现密码/token/Cookie/卡号等敏感内容即为真。 */
function isSensitiveText(text) {
  const value = String(text == null ? '' : text)
  return SENSITIVE_VALUE_RE.test(value) || detectHighRisk(value).length > 0
}

/** 返回文本命中的敏感类型列表。 */
function sensitiveTypesIn(text) {
  return detectHighRisk(String(text == null ? '' : text))
}

function isValidBase64(value) {
  return typeof value === 'string' && value.length % 4 === 0 && BASE64_RE.test(value)
}

function tryCanonicalOrigin(value) {
  try { return canonicalOrigin(value) } catch { return null }
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots)) return []
  return [...new Set(roots.filter(root => typeof root === 'string' && root.length > 0).map(root => path.resolve(root)))]
}

function pathWithinRoots(candidate, roots) {
  if (typeof candidate !== 'string' || !candidate || candidate.length > MAX_FILE_PATH_LENGTH || candidate.includes('\0')) return false
  if (!path.isAbsolute(candidate)) return false
  let resolved
  try {
    const absolute = path.resolve(candidate)
    resolved = fs.existsSync(absolute)
      ? fs.realpathSync.native(absolute)
      : path.join(fs.realpathSync.native(path.dirname(absolute)), path.basename(absolute))
  } catch {
    return false // 父目录不存在、不可访问或无法解析符号链接时默认拒绝
  }
  return roots.some(root => {
    let canonicalRoot
    try { canonicalRoot = fs.realpathSync.native(root) } catch { return false }
    const relative = path.relative(canonicalRoot, resolved)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  })
}

function operationDigest(action, field, payload) {
  const normalizedField = normalizeField(field)
  const stable = JSON.stringify({ action, field: normalizedField, payload: payload && typeof payload === 'object' ? payload : {} })
  return createHash('sha256').update(stable).digest('hex')
}

// 关键动作的固定摘要文案（不含任何页面内容，天然可进审计）。
const CRITICAL_SUMMARY = Object.freeze({
  upload: '上传文件',
  download: '下载文件',
  submit: '提交表单',
  publish: '发布内容',
  delete: '删除内容'
})

class ActionGate {
  /**
   * @param {{ now?: () => number, idFactory?: () => string,
   *           confirmationTtlMs?: number }} options
   */
  constructor({ now = () => Date.now(), idFactory = () => randomUUID(), confirmationTtlMs = DEFAULT_CONFIRMATION_TTL_MS, uploadRoots = [], downloadRoots = [] } = {}) {
    this.now = now
    this.idFactory = idFactory
    this.confirmationTtlMs = boundedInt(confirmationTtlMs, 5000, 10 * 60 * 1000, DEFAULT_CONFIRMATION_TTL_MS)
    this.uploadRoots = normalizeRoots(uploadRoots)
    this.downloadRoots = normalizeRoots(downloadRoots)
    this.confirmations = new Map() // id -> 确认请求
    this.activeTab = null // { id, origin, visible, available }
  }

  /** 上报当前可控制的活动标签；visible 仅表示是否展示给用户，不再是模型控制前提。 */
  setActiveTab(tab) {
    const id = safeTextPlain(tab?.id, 64)
    if (!id) throw gateError('no-tab-id', '活动标签缺少 id。')
    const origin = tryCanonicalOrigin(tab?.origin)
    if (!origin) throw gateError('tab-origin-invalid', '活动标签必须具有 http/https origin。')
    const visible = tab?.visible !== false
    const available = tab?.available !== false
    this.activeTab = { id, origin, visible, available }
    return { id, origin, visible, available }
  }

  clearActiveTab() {
    this.activeTab = null
  }

  get activeTabInfo() {
    return this.activeTab ? { ...this.activeTab } : null
  }

  /** 判定并校验一次模型动作。返回决策对象或抛出带 code 的拒绝错误。 */
  gate({ action, tabId, declaredOrigin, field, payload, confirmationId, authorizations }) {
    if (!MODEL_ACTIONS.includes(action)) throw gateError('unknown-action', `未知的模型动作：${action}`)
    const tab = this.activeTab
    if (!tab) throw gateError('no-active-tab', '当前没有可操作的浏览器活动标签。')
    if (!tab.available) throw gateError('tab-unavailable', '当前浏览器活动标签已不可用。')
    if (String(tabId) !== tab.id) throw gateError('tab-mismatch', '模型仅可操作当前浏览器活动标签，标签不一致。')

    // 来源校验：以活动标签的真实 origin 为准。
    if (declaredOrigin != null) {
      const declared = tryCanonicalOrigin(declaredOrigin)
      if (!declared || declared !== tab.origin) throw gateError('origin-mismatch', '动作声明的 origin 与活动标签不一致。')
    }
    const payloadObject = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    if (field != null) {
      const f = normalizeField(field)
      if (f?.baseUrl != null) {
        const base = tryCanonicalOrigin(f.baseUrl)
        if (!base || base !== tab.origin) throw gateError('origin-mismatch', '字段来源与活动标签不一致。')
      }
    }

    const origin = tab.origin

    // 分权授权。
    const permission = ACTION_PERMISSION[action]
    if (permission != null) {
      const got = authorizations && typeof authorizations.authorized === 'function' ? authorizations.authorized(origin, permission) : false
      if (!got) throw gateError('permission-denied', `模型缺少对 ${origin} 的 ${permission} 授权。`)
    } else if (action === 'navigate') {
      const granted = authorizations && typeof authorizations.origins === 'function' ? authorizations.origins() : []
      if (!granted.includes(origin)) throw gateError('origin-not-authorized', '模型未获准访问该 origin。')
    }

    // 页面内容永远视为不可信：字段或动作描述一旦表现为账号、登录、金融、
    // 凭据等敏感语义，无论页面怎样诱导或用户是否授予普通站点权限都永久拒绝。
    if (field != null && isSensitiveField(field)) {
      throw gateError('sensitive-field', '密码、验证码、支付、银行、账号、Cookie、Authorization、API key 等敏感目标禁止模型读写。')
    }
    const actionDescriptor = [payloadObject.actionText, payloadObject.accessibleName, payloadObject.label, payloadObject.name]
      .filter(value => value != null).join(' ')
    if (actionDescriptor && SENSITIVE_NAME_RE.test(actionDescriptor)) {
      throw gateError('sensitive-action', '登录、支付、银行、账号或凭据相关动作永久禁止模型执行。')
    }

    // 敏感字段/敏感值 / 大小限制。
    if (action === 'type') {
      if (field == null) throw gateError('missing-field', 'type 动作必须指明目标字段。')
      if (isSensitiveField(field)) throw gateError('sensitive-field', '密码、银行卡、验证码、令牌、API key、Cookie 等敏感字段禁止模型输入。')
      const text = String(payloadObject.text == null ? '' : payloadObject.text)
      if (!text) throw gateError('empty-input', 'type 动作需要非空文本。')
      if (text.length > MAX_TYPE_LENGTH) throw gateError('size-limit', `type 输入超过 ${MAX_TYPE_LENGTH} 字符上限。`)
      if (isSensitiveText(text)) throw gateError('sensitive-value', '输入内容包含密码、token、Cookie 等敏感信息，禁止模型输入。')
    } else if (action === 'read') {
      if (field != null && isSensitiveField(field)) throw gateError('sensitive-field', '敏感字段禁止模型读取。')
      if (payloadObject.text != null) {
        const text = String(payloadObject.text)
        if (text.length > MAX_READ_TEXT_LENGTH) throw gateError('size-limit', `读取结果超过 ${MAX_READ_TEXT_LENGTH} 字节上限。`)
        if (isSensitiveText(text)) throw gateError('sensitive-value', '读取结果包含密码、token、Cookie 等敏感信息，禁止模型读取。')
      }
    } else if (action === 'click' || action === 'submit') {
      if (payloadObject.navigatesTo != null && String(payloadObject.navigatesTo) !== '') {
        this.#checkClickDestination(String(payloadObject.navigatesTo), origin, authorizations)
      }
    } else if (action === 'upload') {
      const hasInteractivePicker = Object.prototype.hasOwnProperty.call(payloadObject, 'interactivePicker')
      const hasFilePath = Object.prototype.hasOwnProperty.call(payloadObject, 'filePath')
      const hasBase64 = Object.prototype.hasOwnProperty.call(payloadObject, 'base64')
      if (hasInteractivePicker && payloadObject.interactivePicker !== true) {
        throw gateError('invalid-upload-mode', 'interactivePicker 仅接受布尔值 true。')
      }
      if (payloadObject.interactivePicker === true) {
        if (hasFilePath || hasBase64) {
          throw gateError('upload-mode-conflict', '交互式文件选择不得同时携带 filePath 或 base64。')
        }
        // 只批准打开原生文件选择器；文件由用户亲自选择，路径和内容不得返回模型。
        // 后续一次性确认仍由下方统一逻辑绑定 tab/origin/action/完整 payload。
      } else {
        if (payloadObject.filePath != null && !pathWithinRoots(payloadObject.filePath, this.uploadRoots)) {
          throw gateError('file-path-denied', '上传文件必须位于用户配置的允许目录内，且必须使用绝对路径。')
        }
        const base64 = String(payloadObject.base64 == null ? '' : payloadObject.base64)
        if (!base64) throw gateError('empty-input', 'upload 动作需要 base64 内容，或使用 interactivePicker:true 由用户亲自选文件。')
        if (!isValidBase64(base64)) throw gateError('invalid-base64', 'upload 内容不是合法 base64。')
        if (base64.length > MAX_UPLOAD_BASE64_LENGTH) {
          throw gateError('size-limit', `upload 内容超过 ${MAX_UPLOAD_BYTES} 字节上限。`)
        }
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
        const decodedBytes = Math.floor(base64.length / 4) * 3 - padding
        if (decodedBytes > MAX_UPLOAD_BYTES) {
          throw gateError('size-limit', `upload 内容超过 ${MAX_UPLOAD_BYTES} 字节上限。`)
        }
      }
    } else if (action === 'download') {
      if (!pathWithinRoots(payloadObject.destinationPath, this.downloadRoots)) {
        throw gateError('file-path-denied', '下载目标必须位于用户配置的允许目录内，且必须使用绝对路径。')
      }
      const maxBytes = Number(payloadObject.maxBytes)
      if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
        throw gateError('size-required', 'download 必须声明正数 maxBytes。')
      }
      if (maxBytes > MAX_DOWNLOAD_BYTES) {
        throw gateError('size-limit', `download 超过 ${MAX_DOWNLOAD_BYTES} 字节上限。`)
      }
    } else if (action === 'submit' || action === 'publish' || action === 'delete') {
      // 无附加载荷校验；由人工确认兜底。
    }

    // 关键动作人工确认（一次性、带 TTL、绑定动作+origin+标签）。
    if (CRITICAL_ACTIONS.has(action)) {
      const fingerprint = `${action}|${origin}|${tab.id}|${operationDigest(action, field, payloadObject)}`
      if (confirmationId != null) {
        this.#consumeConfirmation(String(confirmationId), fingerprint)
      } else {
        const request = this.#requestConfirmation(action, origin, tab.id, fingerprint)
        return { verdict: 'confirm-required', confirmationId: request.id, action, origin, tabId: tab.id, summary: request.summary }
      }
    }

    return { verdict: 'allow', action, origin, tabId: tab.id }
  }

  #checkClickDestination(destination, origin, authorizations) {
    const nav = classifyNavigation(destination)
    if (!nav.allowed) throw gateError('navigate-denied', '点击跳转目标地址不合法。')
    if (nav.origin === origin) return // 同 origin 跳转无需新增授权
    const grantedOrigins = authorizations && typeof authorizations.origins === 'function' ? authorizations.origins() : []
    const grantedPrivateOrigins = authorizations && typeof authorizations.privateOrigins === 'function' ? authorizations.privateOrigins() : []
    try {
      checkModelNavigation(destination, { authorizedOrigins: grantedOrigins, authorizedPrivateOrigins: grantedPrivateOrigins })
    } catch {
      throw gateError('navigate-denied', '点击跳转目标未获得授权或不在公网。')
    }
  }

  #requestConfirmation(action, origin, tabId, fingerprint) {
    this.#pruneConfirmations()
    if (this.confirmations.size >= MAX_CONFIRMATIONS_PENDING) {
      throw gateError('too-many-confirmations', '待确认请求过多，请先处理或等待过期。')
    }
    const id = this.idFactory()
    const request = {
      id,
      action,
      origin,
      tabId,
      fingerprint,
      summary: CRITICAL_SUMMARY[action] || '待确认操作',
      confirmed: false,
      consumed: false,
      createdAt: this.now(),
      expiresAt: this.now() + this.confirmationTtlMs,
      confirmedAt: null
    }
    this.confirmations.set(id, request)
    return request
  }

  #consumeConfirmation(id, fingerprint) {
    const request = this.confirmations.get(id)
    if (!request) throw gateError('confirmation-unknown', '未知的确认请求。')
    if (request.fingerprint !== fingerprint) throw gateError('confirmation-mismatch', '确认请求与当前动作不匹配。')
    if (request.consumed) throw gateError('confirmation-used', '该确认请求已被使用。')
    if (this.now() > request.expiresAt) {
      throw gateError('confirmation-expired', '确认请求已过期，请重新发起。')
    }
    if (!request.confirmed) throw gateError('confirmation-unconfirmed', '该动作尚未获得用户确认。')
    request.consumed = true
    return request
  }

  /**
   * 用户确认一次待确认请求（只有真实用户能确认，模型无法自我确认）。
   * @param {string} id 确认请求 id。
   * @param {{ by?: string }} options by 必须为 'user'。
   */
  confirm(id, { by = 'user' } = {}) {
    if (by !== 'user') throw gateError('confirmation-actor', '确认动作只能由真实用户发起。')
    const request = this.confirmations.get(String(id))
    if (!request) throw gateError('confirmation-unknown', '未知的确认请求。')
    if (request.consumed) throw gateError('confirmation-used', '该确认请求已被使用。')
    if (request.confirmed) throw gateError('confirmation-double', '该确认请求已确认过。')
    if (this.now() > request.expiresAt) {
      throw gateError('confirmation-expired', '确认请求已过期，请重新发起。') // 过期条目交由 prune 清理
    }
    request.confirmed = true
    request.confirmedAt = this.now()
    return request
  }

  rejectConfirmation(id) {
    return this.confirmations.delete(String(id))
  }

  /** 待确认/已确认请求的只读视图（不含任何敏感内容）。 */
  pendingConfirmations() {
    this.#pruneConfirmations()
    return [...this.confirmations.values()].map(request => ({
      id: request.id,
      action: request.action,
      origin: request.origin,
      tabId: request.tabId,
      summary: request.summary,
      confirmed: request.confirmed,
      consumed: request.consumed,
      expiresAt: request.expiresAt
    }))
  }

  clearConfirmations() {
    const count = this.confirmations.size
    this.confirmations.clear()
    return count
  }

  #pruneConfirmations() {
    const now = this.now()
    for (const [id, request] of this.confirmations) {
      if (now > request.expiresAt) this.confirmations.delete(id)
    }
  }
}

module.exports = {
  ACTION_PERMISSION,
  CRITICAL_ACTIONS,
  CRITICAL_SUMMARY,
  DEFAULT_CONFIRMATION_TTL_MS,
  MAX_CONFIRMATIONS_PENDING,
  MAX_DOWNLOAD_BYTES,
  MAX_FILE_PATH_LENGTH,
  MAX_READ_TEXT_LENGTH,
  MAX_TYPE_LENGTH,
  MAX_UPLOAD_BASE64_LENGTH,
  MAX_UPLOAD_BYTES,
  MODEL_ACTIONS,
  SENSITIVE_AUTOCOMPLETE,
  SENSITIVE_INPUT_TYPES,
  SENSITIVE_NAME_RE,
  ActionGate,
  isSensitiveField,
  isSensitiveText,
  isValidBase64,
  normalizeField,
  normalizeRoots,
  operationDigest,
  pathWithinRoots,
  sensitiveTypesIn
}
