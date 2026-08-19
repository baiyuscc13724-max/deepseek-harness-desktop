// 右栏内置浏览器 URL 规范化与导航策略（browser-url-policy）。
//
// 职责：对任意候选地址做 WHATWG 解析、规范化与出处（origin）提取，并区分
// 「用户浏览」与「模型访问」两档导航策略：
//   - 用户浏览：只允许 http/https，拒绝 file/data/javascript/chrome/devtools/
//     about/blob/ws/ftp/mailto/harness-desktop 等一切其它协议，拒绝内嵌凭据
//     （user:pass@）、拒绝畸形或过长的地址；本机/内网地址对用户开放（登录
//     局域网服务是用户的合法需求）。
//   - 模型访问：在用户档之上更严 —— 目标必须是公网可达的 http/https 地址
//     （拒绝本机回环、内网、链路本地、CGNAT、文档网段、单标签主机名等），
//     且目标 origin 必须已经进入按 origin 的站点授权（browser-site-authz）。
// 本模块为纯 Node 实现，无任何 IO，可独立用 node:test 测试。审计只记录
// origin（永远不含 query/hash），因此即便页面 URL 携带 token 也不会泄漏。

const { URL } = require('node:url')

const MAX_URL_LENGTH = 8192

const HTTP_SCHEMES = new Set(['http:', 'https:'])

// 用户档一律拒绝的协议（含 Chromium 内部协议与自定义协议）。
const BLOCKED_SCHEMES = new Set([
  'about:', 'blob:', 'chrome:', 'chrome-extension:', 'data:', 'devtools:',
  'file:', 'ftp:', 'gopher:', 'harness-desktop:', 'javascript:', 'mailto:',
  'moz-extension:', 'tel:', 'ws:', 'wss:'
])

// 常见内网标识后缀（模型档拒绝）。
const PRIVATE_HOST_SUFFIXES = [
  '.localhost', '.local', '.internal', '.home.arpa', '.localdomain',
  '.corp', '.lan', '.test', '.invalid', '.example'
]

// 未转义的百分号（% 后必须跟两位十六进制）视为畸形地址。
const BAD_PERCENT = /%(?![0-9a-fA-F]{2})/

// 内网/保留 IPv4 网段（模型档拒绝）。
const PRIVATE_IPV4_RANGES = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 本网络
  [0x0a000000, 0x0affffff], // 10.0.0.0/8
  [0x64400000, 0x647fffff], // 100.64.0.0/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 回环
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 链路本地
  [0xac100000, 0xac1fffff], // 172.16.0.0/12
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 协议保留
  [0xc0000200, 0xc00002ff], // 192.0.2.0/24 TEST-NET
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
  [0xc6120000, 0xc633ffff], // 198.18.0.0/15 压力测试网段
  [0xc6336400, 0xc63364ff], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 TEST-NET-3
  [0xe0000000, 0xefffffff], // 224.0.0.0/4 组播
  [0xf0000000, 0xffffffff]  // 240.0.0.0/4 保留
]

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

function policyError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function ipv4ToInt(ip) {
  const parts = String(ip).split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8) + octet
  }
  return value >>> 0
}

function isIpv4Literal(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && ipv4ToInt(host) !== null
}

function isPrivateIpv4(ip) {
  const value = ipv4ToInt(ip)
  if (value === null) return false
  return PRIVATE_IPV4_RANGES.some(([min, max]) => value >= min && value <= max)
}

function isPrivateIpv6(host) {
  const lower = String(host).toLowerCase()
  if (lower === '::' || lower === '::1') return true // 未指定 / 回环
  if (lower.startsWith('2001:db8:')) return true // 文档地址
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7 ULA
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10 链路本地
  if (lower.startsWith('ff')) return true // 组播
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower) // IPv4 映射
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}

function isPrivateHostname(host) {
  const lower = String(host).toLowerCase()
  if (lower === 'localhost') return true
  if (!lower.includes('.')) return true // 单标签主机名视为内网
  return PRIVATE_HOST_SUFFIXES.some(suffix => lower.endsWith(suffix))
}

/**
 * 判断主机名/ IP 是否为公网可达（模型档使用）。
 * @param {string} host 来自 URL 的 hostname（IPv6 带方括号）。
 * @returns {{ public: boolean, reason: string|null }} reason 仅在非公网时给出。
 */
function hostPublicInfo(host) {
  const value = String(host || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!value) return { public: false, reason: 'empty-host' }
  if (CONTROL_CHAR.test(value)) return { public: false, reason: 'control-char' }
  if (/^\d+$/.test(value)) return { public: false, reason: 'numeric-host' } // 127.0.0.1 的整数形态
  if (isIpv4Literal(value)) {
    return isPrivateIpv4(value)
      ? { public: false, reason: 'private-ipv4' }
      : { public: true, reason: null }
  }
  if (value.includes(':')) {
    return isPrivateIpv6(value)
      ? { public: false, reason: 'private-ipv6' }
      : { public: true, reason: null }
  }
  if (isPrivateHostname(value)) return { public: false, reason: 'private-host' }
  return { public: true, reason: null }
}

/**
 * 提取地址的规范化 origin（scheme://host[:非默认端口]），仅接受 http/https。
 * @param {string|URL} value
 * @returns {string} 例如 'https://example.com' / 'https://example.com:8443'。
 * @throws 带 code 的策略错误（scheme-blocked/credentials/parse-error）。
 */
function canonicalOrigin(value) {
  let url
  try {
    url = value instanceof URL ? value : new URL(String(value))
  } catch {
    throw policyError('parse-error', '地址无法解析。')
  }
  if (!HTTP_SCHEMES.has(url.protocol)) {
    throw policyError('scheme-blocked', `只接受 http/https 地址，拒绝 ${url.protocol || '<空协议>'}`)
  }
  if (url.username || url.password) {
    throw policyError('credentials', '地址禁止携带用户名或密码。')
  }
  if (!url.hostname) throw policyError('empty-host', '地址缺少主机名。')
  return url.origin.toLowerCase()
}

/** 不抛错的 origin 提取；失败返回 null。 */
function originOf(value) {
  try { return canonicalOrigin(value) } catch { return null }
}

function sameOrigin(left, right) {
  const a = typeof left === 'string' ? originOf(left) : null
  const b = typeof right === 'string' ? originOf(right) : null
  return Boolean(a && b && a === b)
}

/**
 * 规范化任意地址为不带多余默认端口的 http/https href。
 * 不支持 base 时相对地址即拒绝（可显式传 base 完成相对解析）。
 * @param {string|URL} value
 * @param {{ base?: string }} options
 * @returns {string} 规范化后的完整 URL（如 'https://example.com/b?q=1#f'）。
 * @throws 带 code 的策略错误。
 */
function normalizeUrl(value, { base } = {}) {
  const nav = classifyNavigation(value, { base })
  if (!nav.allowed) throw policyError(nav.reason, nav.message)
  return nav.normalized
}

/**
 * 对候选地址做分类（不抛错，供 UI 预览与门禁复用）。
 * @returns {{ allowed: boolean, reason: string, message: string,
 *             scheme: string|null, normalized: string|null, origin: string|null }}
 */
function classifyNavigation(value, { base } = {}) {
  try {
    const raw = String(value == null ? '' : value)
    if (CONTROL_CHAR.test(raw)) {
      return { allowed: false, reason: 'parse-error', message: '地址包含控制字符。', scheme: null, normalized: null, origin: null }
    }
    if (BAD_PERCENT.test(raw)) {
      return { allowed: false, reason: 'parse-error', message: '地址包含未转义的百分号编码。', scheme: null, normalized: null, origin: null }
    }
    if (!raw.trim()) {
      return { allowed: false, reason: 'empty', message: '地址为空。', scheme: null, normalized: null, origin: null }
    }
    if (raw.length > MAX_URL_LENGTH) {
      return { allowed: false, reason: 'too-long', message: `地址超过 ${MAX_URL_LENGTH} 字符上限。`, scheme: null, normalized: null, origin: null }
    }
    const url = base != null ? new URL(raw, base) : new URL(raw)
    const scheme = url.protocol
    if (!HTTP_SCHEMES.has(scheme)) {
      return { allowed: false, reason: 'scheme-blocked', message: `协议 ${scheme || '<空>'} 不在白名单（仅 http/https）。`, scheme, normalized: null, origin: null }
    }
    if (url.username || url.password) {
      return { allowed: false, reason: 'credentials', message: '地址禁止携带用户名或密码。', scheme, normalized: null, origin: null }
    }
    if (!url.hostname) {
      return { allowed: false, reason: 'empty-host', message: '地址缺少主机名。', scheme, normalized: null, origin: null }
    }
    const normalized = url.href
    if (normalized.length > MAX_URL_LENGTH) {
      return { allowed: false, reason: 'too-long', message: `地址超过 ${MAX_URL_LENGTH} 字符上限。`, scheme, normalized: null, origin: null }
    }
    return { allowed: true, reason: 'ok', message: '允许。', scheme, normalized, origin: url.origin.toLowerCase() }
  } catch {
    return { allowed: false, reason: 'parse-error', message: '地址无法按 WHATWG 规则解析。', scheme: null, normalized: null, origin: null }
  }
}

/**
 * 用户浏览档导航校验：仅 http/https，拒绝其它协议与内嵌凭据。
 * @throws 带 code 的策略错误。
 */
function checkUserNavigation(value, { base } = {}) {
  const nav = classifyNavigation(value, { base })
  if (!nav.allowed) throw policyError(nav.reason, nav.message)
  return nav
}

/**
 * 模型访问档导航校验：http/https + 公网可达 + origin 已授权，三重叠加。
 * @param {string} value 候选地址。
 * @param {{ authorizedOrigins?: string[]|Set<string>, base?: string }} options
 * @returns {{ normalized: string, origin: string }} 通过后返回规范化结果。
 * @throws 带 code 的策略错误。
 */
function checkModelNavigation(value, { authorizedOrigins = [], base } = {}) {
  const nav = classifyNavigation(value, { base })
  if (!nav.allowed) throw policyError(nav.reason, nav.message)
  const hostInfo = hostPublicInfo(new URL(nav.normalized).hostname)
  if (!hostInfo.public) {
    throw policyError('non-public-network', '模型不可访问本机、内网或链路本地地址。')
  }
  const accepted = authorizedOrigins instanceof Set ? authorizedOrigins : new Set(authorizedOrigins)
  if (!accepted.has(nav.origin)) {
    throw policyError('origin-not-authorized', '模型访问的目标站点未获得授权。')
  }
  return { normalized: nav.normalized, origin: nav.origin }
}

module.exports = {
  BLOCKED_SCHEMES,
  HTTP_SCHEMES,
  MAX_URL_LENGTH,
  canonicalOrigin,
  checkModelNavigation,
  checkUserNavigation,
  classifyNavigation,
  hostPublicInfo,
  isIpv4Literal,
  isPrivateHostname,
  isPrivateIpv4,
  isPrivateIpv6,
  normalizeUrl,
  originOf,
  sameOrigin
}