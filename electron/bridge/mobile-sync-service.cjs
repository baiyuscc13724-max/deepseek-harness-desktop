const { EventEmitter } = require('node:events')
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const { chmod, mkdir, rename, rm, writeFile } = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const httpProxy = require('http-proxy')
const QRCode = require('qrcode')
const { CONTROL_PROTOCOL_VERSION, MobileControlBroker, isLoopbackAddress } = require('./mobile-control-broker.cjs')

const BRIDGE_API_VERSION = 2
const MOBILE_PROTOCOL_DESCRIPTOR = Object.freeze({
  platformNeutral: true,
  capabilityNegotiation: true,
  protocolClientPlatforms: Object.freeze(['android', 'ios']),
  implementedClients: Object.freeze(['android'])
})
const COOKIE_NAME = 'harness_mobile_auth'
const PAIRING_TTL_MS = 10 * 60 * 1000
const DEVICE_TOUCH_INTERVAL_MS = 60 * 1000
const CURRENT_MOBILE_VERSION = '1.0.51'
const CURRENT_MOBILE_RELEASE_TAG = CURRENT_MOBILE_VERSION.split('.').length === 4
  ? `android-v${CURRENT_MOBILE_VERSION}`
  : `v${CURRENT_MOBILE_VERSION}`
const DEFAULT_MOBILE_DOWNLOAD_URL = `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/${CURRENT_MOBILE_RELEASE_TAG}/Harness-Mobile-${CURRENT_MOBILE_VERSION}-android-universal.apk`
const DEFAULT_IOS_DOWNLOAD_URL = ''
const DESKTOP_CONTROL_STATE_FILE = 'mobile-sync.desktop-control.json'
const MOBILE_MODEL_PROVIDER_LIMIT = 64
const MOBILE_MODEL_LIMIT = 256
const MOBILE_PROVIDER_METER_LIMIT = 64
const MOBILE_METER_TEXT_LIMIT = 16
const MOBILE_PLUGIN_LIMIT = 128
const MOBILE_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024
const MOBILE_DOCUMENT_RESPONSE_MAX_BYTES = 64 * 1024
const MOBILE_DOCUMENT_UPLOAD_TIMEOUT_MS = 60 * 1000
const MOBILE_DOCUMENT_UPLOAD_PATH = '/__harness_mobile__/documents/upload'
const MOBILE_DOCUMENT_UPLOAD_INTENT = 'document-upload'
const MOBILE_DOCUMENT_UPLOAD_CONTRACT = Object.freeze({
  version: 1,
  path: MOBILE_DOCUMENT_UPLOAD_PATH,
  method: 'POST',
  body: 'raw',
  sessionQuery: 'sessionId',
  nameQuery: 'name',
  intentHeader: Object.freeze({ name: 'X-Harness-Mobile-Request', value: MOBILE_DOCUMENT_UPLOAD_INTENT }),
  maxBytes: MOBILE_DOCUMENT_MAX_BYTES,
  responseSchemaVersion: 1
})

function safeMobileModelText(value, limit) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, limit)
}

function safeMobilePublicText(value, limit) {
  const text = safeMobileModelText(value, limit)
  if (/(?:[A-Za-z]:[\\/]|\\\\|file:\/\/|(?:^|\s)\/(?:Users|home|tmp|var|etc|opt)\/)/i.test(text)) return ''
  return text
}

function mobileModelRoutingDto(value) {
  const main = {
    provider: safeMobileModelText(value?.main?.provider, 128),
    model: safeMobileModelText(value?.main?.model, 256)
  }
  const subagent = {
    inheritMain: value?.subagent?.inheritMain !== false,
    provider: safeMobileModelText(value?.subagent?.provider, 128),
    model: safeMobileModelText(value?.subagent?.model, 256)
  }
  const providers = []
  for (const row of Array.isArray(value?.providers) ? value.providers.slice(0, MOBILE_MODEL_PROVIDER_LIMIT) : []) {
    const id = safeMobileModelText(row?.id, 128)
    if (!id) continue
    const models = []
    for (const candidate of Array.isArray(row?.models) ? row.models : []) {
      const model = safeMobileModelText(candidate, 256)
      if (!model || models.includes(model)) continue
      models.push(model)
      if (models.length >= MOBILE_MODEL_LIMIT) break
    }
    providers.push({
      id,
      name: safeMobileModelText(row?.name, 160) || id,
      models
    })
  }
  return {
    configured: Boolean(value?.configured),
    main,
    subagent,
    providers
  }
}

function mobileMeterText(value) {
  const label = safeMobilePublicText(value?.label, 120) || ({
    balance: '余额',
    'usage-window': '套餐用量',
    'spending-budget': '消费限额',
    'token-counter': '用量'
  })[value?.kind]
  if (!label) return ''
  if (value.kind === 'balance') {
    const total = safeMobilePublicText(value.total, 80) || '—'
    const currency = safeMobilePublicText(value.currency, 16)
    return safeMobilePublicText(`${label}: ${total}${currency ? ` ${currency}` : ''}`, 240)
  }
  if (value.kind === 'usage-window') {
    const remaining = Number(value.remainingPercent)
    return safeMobilePublicText(`${label}: 剩余 ${Number.isFinite(remaining) ? Math.max(0, Math.min(100, remaining)).toFixed(0) : '—'}%`, 240)
  }
  if (value.kind === 'spending-budget') {
    const used = safeMobilePublicText(value.used, 64) || '—'
    const limit = safeMobilePublicText(value.limit, 64) || '—'
    return safeMobilePublicText(`${label}: ${used} / ${limit}`, 240)
  }
  if (value.kind === 'token-counter') {
    const amount = safeMobilePublicText(value.value, 80) || '—'
    const unit = safeMobilePublicText(value.unit, 24)
    return safeMobilePublicText(`${label}: ${amount}${unit ? ` ${unit}` : ''}`, 240)
  }
  return ''
}

function mobileProviderMetersDto(value) {
  const providers = []
  for (const snapshot of Array.isArray(value?.snapshots) ? value.snapshots.slice(0, MOBILE_PROVIDER_METER_LIMIT) : []) {
    const id = safeMobilePublicText(snapshot?.provider?.id, 128)
    if (!id) continue
    const status = snapshot?.stale === true ? 'stale' : snapshot?.status === 'ready' ? 'ready' : 'unavailable'
    const meters = []
    for (const row of Array.isArray(snapshot?.meters) ? snapshot.meters : []) {
      const text = mobileMeterText(row)
      if (!text || meters.includes(text)) continue
      meters.push(text)
      if (meters.length >= MOBILE_METER_TEXT_LIMIT) break
    }
    providers.push({
      id,
      name: safeMobilePublicText(snapshot?.provider?.name, 160) || id,
      status,
      meters,
      unavailableReason: status === 'ready' ? '' : safeMobilePublicText(snapshot?.message, 240)
    })
  }
  return { providers }
}

function mobilePluginsDto(value) {
  const plugins = []
  for (const row of Array.isArray(value?.plugins) ? value.plugins.slice(0, MOBILE_PLUGIN_LIMIT) : []) {
    const id = safeMobilePublicText(row?.id, 160)
    if (!id) continue
    plugins.push({
      id,
      name: safeMobilePublicText(row?.name, 200) || id,
      version: safeMobilePublicText(row?.version, 80),
      enabled: row?.enabled === true,
      configurable: row?.configurable === true,
      unavailableReason: safeMobilePublicText(row?.unavailableReason, 240)
    })
  }
  return { plugins }
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function constantTimeHexEqual(left, right) {
  if (!/^[a-f0-9]{64}$/.test(left || '') || !/^[a-f0-9]{64}$/.test(right || '')) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').flatMap(part => {
    const index = part.indexOf('=')
    if (index < 1) return []
    try { return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]] }
    catch { return [] }
  }))
}

function withoutMobileCookie(header = '') {
  return String(header).split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => part.slice(0, part.indexOf('=')).trim() !== COOKIE_NAME)
    .join('; ')
}

function isPrivateIpv4(address) {
  const parts = String(address).split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
}

function lanAddresses(networkInterfaces = os.networkInterfaces()) {
  const entries = []
  for (const [name, values] of Object.entries(networkInterfaces || {})) {
    for (const value of values || []) {
      if (value.family !== 'IPv4' || value.internal || !isPrivateIpv4(value.address)) continue
      // Keep real Wi-Fi/Ethernet addresses ahead of overlay, tunnel and
      // container adapters. Pairing advertises the first origin, so treating a
      // TUN/TAP adapter as physical can produce a QR address that phones can
      // route only through a VPN which the Android LAN fast path bypasses.
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Docker|Hyper-V|Loopback|Tailscale|ZeroTier|WireGuard|Wintun|EasyTier|Hamachi|singbox|LetsTAP|(?:^|[_\s-])(?:tun|tap)(?:$|[_\s-])/i.test(name)
      entries.push({ address: value.address, name, virtual })
    }
  }
  return entries
    .sort((left, right) => Number(left.virtual) - Number(right.virtual) || left.name.localeCompare(right.name))
    .map(entry => entry.address)
    .filter((value, index, values) => values.indexOf(value) === index)
}

function deviceDescriptorFromUserAgent(userAgent = '') {
  const value = String(userAgent)
  const appVersion = value.match(/HarnessMobile\/([0-9A-Za-z._+-]+)/i)?.[1] || null
  const android = value.match(/Android\s+([^;)]+)/i)?.[1]?.trim()
  if (android) {
    return {
      name: `Android ${android}`.slice(0, 80),
      platform: 'android',
      deviceClass: /tablet|pixel c|nexus 7|nexus 9/i.test(value) ? 'tablet' : 'phone',
      appVersion
    }
  }
  const ios = value.match(/(?:iPhone|CPU) OS\s+([0-9_]+)/i)?.[1]?.replaceAll('_', '.')
  if (/iPad/i.test(value)) return { name: `iPadOS ${ios || ''}`.trim().slice(0, 80), platform: 'ios', deviceClass: 'tablet', appVersion }
  if (/iPhone|iPod/i.test(value)) return { name: `iPhone iOS ${ios || ''}`.trim().slice(0, 80), platform: 'ios', deviceClass: 'phone', appVersion }
  return { name: '移动设备', platform: 'unknown', deviceClass: 'unknown', appVersion }
}

function safeDeviceName(userAgent = '') {
  return deviceDescriptorFromUserAgent(userAgent).name
}

function pairingErrorPage(message = '请回到电脑端重新生成配对二维码。') {
  const safe = String(message).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harness Mobile</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f8f7;color:#173c3a;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}.card{max-width:420px;margin:24px;padding:28px;border:1px solid #c8ddda;border-radius:18px;background:#fff;box-shadow:0 16px 50px #173c3a18}h1{margin:0 0 10px;font-size:22px}p{margin:0;color:#55706e}</style><main class="card"><h1>需要重新配对</h1><p>${safe}</p></main></html>`
}

function runtimeUnavailablePage() {
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harness Mobile</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f8f7;color:#173c3a;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}.card{max-width:420px;margin:24px;padding:28px;border:1px solid #c8ddda;border-radius:18px;background:#fff}h1{margin:0 0 10px;font-size:22px}p{margin:0;color:#55706e}</style><main class="card"><h1>电脑工作台尚未就绪</h1><p>请保持 Harness Desktop 正在运行，稍后下拉刷新。</p></main></html>'
}

function mobileDownloadRedirect(response, downloadUrl) {
  response.writeHead(302, {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'Location': downloadUrl,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end()
}

function isIosUserAgent(value) {
  return /\b(?:iPhone|iPad|iPod)\b/i.test(String(value || ''))
}

function safeIosDownloadUrl(value) {
  try {
    const target = new URL(String(value || ''))
    if (target.protocol !== 'https:' || !['apps.apple.com', 'testflight.apple.com'].includes(target.hostname.toLowerCase())) return ''
    return target.toString()
  } catch {
    return ''
  }
}

function iosSetupPage(appUrl, downloadUrl = '', browserUrl = '') {
  const escape = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
  const browser = browserUrl
    ? `<a href="${escape(browserUrl)}" rel="noreferrer">直接在 Safari 使用</a><p class="notice">打开后可在 Safari 的分享菜单中选择“添加到主屏幕”，无需 Apple Developer 会员。</p>`
    : ''
  const install = downloadUrl
    ? `<a class="secondary" href="${escape(downloadUrl)}" rel="noreferrer">从 App Store / TestFlight 下载</a>`
    : '<p class="notice">当前未发布 App Store/TestFlight 安装包；不会提供无法公开安装的未签名 IPA。</p>'
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harness Mobile for iOS</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f8f7;color:#173c3a;font:16px/1.6 system-ui,-apple-system,sans-serif}.card{max-width:430px;margin:24px;padding:28px;border:1px solid #c8ddda;border-radius:18px;background:#fff;box-shadow:0 16px 50px #173c3a18}h1{font-size:22px;margin:0 0 10px}a{display:block;margin-top:14px;padding:12px 16px;border-radius:12px;text-align:center;text-decoration:none;background:#126f68;color:#fff}.secondary{background:#edf6f5;color:#126f68}.notice{color:#55706e}</style><main class="card"><h1>Harness Mobile for iPhone / iPad</h1><p>苹果设备不会下载 Android APK。可直接使用 Safari 版；未来有正式商店版本时也会从这里进入。</p>${browser}<a class="secondary" href="${escape(appUrl)}">打开已安装的 Harness Mobile</a>${install}</main></html>`
}

function writeResponse(response, statusCode, body, headers = {}) {
  if (response.headersSent) return
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  })
  response.end(body)
}

function readJsonBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('Request body is too large.')
        error.code = 'BODY_TOO_LARGE'
        reject(error)
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch (error) { reject(error) }
    })
    request.once('error', reject)
  })
}

function boundedDocumentIdentity(value, field, limit) {
  const text = typeof value === 'string' ? value : ''
  if (!text || text.length > limit || text.trim() !== text || text.includes('\u0000') || /[\r\n]/u.test(text)) {
    throw Object.assign(new TypeError(`${field} is invalid.`), { code: 'DOCUMENT_INVALID_IDENTITY' })
  }
  return text
}

function readBinaryBody(request, limit = MOBILE_DOCUMENT_MAX_BYTES) {
  const advertised = Number(request.headers['content-length'] || 0)
  if (Number.isFinite(advertised) && advertised > limit) {
    throw Object.assign(new Error('Document exceeds the upload limit.'), { code: 'BODY_TOO_LARGE' })
  }
  return new Promise((resolve, reject) => {
    let settled = false
    let size = 0
    const chunks = []
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value)
    }
    const onData = chunk => {
      if (settled) return
      const value = Buffer.from(chunk)
      size += value.length
      if (size > limit) {
        request.off('data', onData)
        request.on('data', () => {})
        request.resume()
        finish(Object.assign(new Error('Document exceeds the upload limit.'), { code: 'BODY_TOO_LARGE' }))
        return
      }
      chunks.push(value)
    }
    request.on('data', onData)
    request.once('end', () => finish(null, Buffer.concat(chunks, size)))
    request.once('error', error => finish(error))
  })
}

async function boundedJsonResponse(response, limit = MOBILE_DOCUMENT_RESPONSE_MAX_BYTES) {
  const advertised = Number(response.headers?.get?.('content-length') || 0)
  if (Number.isFinite(advertised) && advertised > limit) throw new Error('Official upload response is too large.')
  const reader = response.body?.getReader?.()
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > limit) throw new Error('Official upload response is too large.')
    return JSON.parse(bytes.toString('utf8') || '{}')
  }
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      size += chunk.length
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw new Error('Official upload response is too large.')
      }
      chunks.push(chunk)
    }
  } finally { reader.releaseLock?.() }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8') || '{}')
}

function safeOfficialDocument(value, expectedSize) {
  const relativePath = typeof value?.path === 'string' ? value.path : ''
  const name = typeof value?.name === 'string' ? value.name : ''
  const size = Number(value?.size)
  const segments = relativePath.split('/')
  if (relativePath.length > 4096 || segments[0] !== 'uploads' || segments.length !== 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) return null
  if (!name || name.length > 240 || name !== segments[1] || name.includes('\u0000') || /[\r\n\\/]/u.test(name)) return null
  if (!Number.isSafeInteger(size) || size !== expectedSize) return null
  return { path: relativePath, name, size }
}

function documentUploadError(status, code) {
  if (status === 409 && code === 'FILES_SESSION_NOT_LIVE') return { status: 409, code, error: '当前会话尚未运行。' }
  if (status === 409 && code === 'FILES_NO_WORKSPACE') return { status: 409, code, error: '当前会话没有可用的工作目录。' }
  if (status === 413 || code === 'FILES_TOO_LARGE') return { status: 413, code: 'FILES_TOO_LARGE', error: '文档超过 50 MB 上传限制。' }
  if (status === 400 && code === 'FILES_EMPTY_UPLOAD') return { status: 400, code, error: '不能上传空文档。' }
  return { status: status >= 400 && status < 500 ? status : 502, code: 'DOCUMENT_UPLOAD_REJECTED', error: '电脑工作区未接受该文档。' }
}

const BROWSER_FORBIDDEN_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
  6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080
])

function browserSafePort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535 && !BROWSER_FORBIDDEN_PORTS.has(value)
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve(server.address())
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function closeListener(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

async function listenBrowserSafe(server, preferredPort, host, maxAttempts = 32) {
  let candidate = browserSafePort(preferredPort) ? preferredPort : 0
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { await listen(server, candidate, host) }
    catch (error) {
      if (candidate !== 0 && error.code === 'EADDRINUSE') { candidate = 0; continue }
      throw error
    }
    const address = server.address()
    if (address && browserSafePort(address.port)) return address
    await closeListener(server)
    candidate = 0
  }
  throw Object.assign(new Error('Unable to allocate a browser-safe mobile sync port.'), { code: 'MOBILE_SYNC_NO_SAFE_PORT' })
}

class MobileSyncService extends EventEmitter {
  constructor({
    store,
    getRuntimeTarget,
    transportManager = null,
    stateDir = process.cwd(),
    host = '0.0.0.0',
    port = null,
    networkInterfaces,
    now = () => Date.now(),
    qrFactory = value => QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 280 }),
    mobileDownloadUrl = DEFAULT_MOBILE_DOWNLOAD_URL,
    iosDownloadUrl = DEFAULT_IOS_DOWNLOAD_URL,
    getAppearance = null,
    setAppearance = null,
    getThemeScript = null,
    readThemeAsset = null,
    getModelRouting = null,
    getProviderMeters = null,
    getPlugins = null,
    chooseWorkspaceDirectory = null,
    controlBroker = null,
    desktopControlStateFile = null,
    relayConfigStore = null,
    fetchImpl = globalThis.fetch
  }) {
    super()
    if (!store) throw new Error('MobileSyncService requires a store.')
    if (typeof getRuntimeTarget !== 'function') throw new Error('MobileSyncService requires getRuntimeTarget().')
    this.store = store
    this.getRuntimeTarget = getRuntimeTarget
    this.transportManager = transportManager
    this.stateDir = stateDir
    this.host = host
    this.requestedPort = Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null
    this.networkInterfaces = networkInterfaces
    this.now = now
    this.qrFactory = qrFactory
    this.mobileDownloadUrl = mobileDownloadUrl
    this.iosDownloadUrl = safeIosDownloadUrl(iosDownloadUrl)
    this.getAppearance = getAppearance
    this.setAppearance = setAppearance
    this.getThemeScript = getThemeScript
    this.readThemeAsset = readThemeAsset
    this.getModelRouting = getModelRouting
    this.getProviderMeters = getProviderMeters
    this.getPlugins = getPlugins
    this.chooseWorkspaceDirectory = chooseWorkspaceDirectory
    this.workspacePickerRequest = null
    this.controlBroker = controlBroker || new MobileControlBroker({ now })
    this.relayConfigStore = relayConfigStore
    if (typeof fetchImpl !== 'function') throw new Error('MobileSyncService requires fetchImpl for document uploads.')
    this.fetchImpl = fetchImpl
    this.desktopControlStateFile = desktopControlStateFile || path.join(path.dirname(this.store.file || this.stateDir), DESKTOP_CONTROL_STATE_FILE)
    this.desktopControlAuth = null
    this.server = null
    this.proxy = null
    this.port = null
    this.pairing = null
    this.relayOutdatedDeviceIds = new Set()
    this.sockets = new Set()
    this.deviceSockets = new Map()
    this.lastTouchByDevice = new Map()
    this.transportManager?.on('state', () => this.publish())
  }

  runtimeTarget() {
    const value = this.getRuntimeTarget()
    if (!value) return null
    try {
      const target = new URL(value)
      if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname)) return null
      return target.origin
    } catch {
      return null
    }
  }

  origins() {
    if (!this.port) return []
    const addresses = this.host === '127.0.0.1'
      ? ['127.0.0.1']
      : lanAddresses(this.networkInterfaces || os.networkInterfaces())
    return addresses.map(address => `http://${address}:${this.port}`)
  }

  state() {
    const saved = this.store.get()
    const relay = this.getRelayConfig()
    return {
      bridgeApiVersion: BRIDGE_API_VERSION,
      protocol: MOBILE_PROTOCOL_DESCRIPTOR,
      enabled: saved.enabled,
      running: Boolean(this.server?.listening),
      targetReady: Boolean(this.runtimeTarget()),
      port: this.port,
      origins: this.origins(),
      devices: saved.devices.map(({ id, name, platform, deviceClass, appVersion, createdAt, lastSeenAt }) => ({ id, name, platform, deviceClass, appVersion, createdAt, lastSeenAt })),
      control: this.controlBroker.state(saved.devices),
      relay: { ...relay, requiresDeviceUpdate: saved.devices.some(device => this.relayOutdatedDeviceIds.has(device.id)) },
      remote: this.transportManager?.state?.() || {
        enabled: saved.remoteEnabled,
        preference: saved.transportPreference,
        status: saved.remoteEnabled ? 'unavailable' : 'disabled',
        active: null,
        adapters: []
      },
      pairing: this.pairing && this.pairing.expiresAt > this.now()
        ? {
            url: this.pairing.url || null,
            appUrl: this.pairing.appUrl || null,
            shareUrl: this.pairing.shareUrl || null,
            qrDataUrl: this.pairing.qrDataUrl || null,
            expiresAt: new Date(this.pairing.expiresAt).toISOString()
          }
        : null
    }
  }

  publish() {
    const state = this.state()
    this.emit('state', state)
    return state
  }

  async #removeDesktopControlState() {
    this.desktopControlAuth = null
    await rm(this.desktopControlStateFile, { force: true }).catch(() => {})
  }

  async #writeDesktopControlState() {
    const bearer = randomBytes(32).toString('base64url')
    const generation = randomBytes(16).toString('hex')
    const state = {
      version: 1,
      origin: `http://127.0.0.1:${this.port}/__harness_mobile__/control`,
      port: this.port,
      bearer,
      generation,
      createdAt: new Date(this.now()).toISOString()
    }
    const directory = path.dirname(this.desktopControlStateFile)
    const temporary = `${this.desktopControlStateFile}.${generation}.tmp`
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await chmod(temporary, 0o600).catch(() => {})
      await rename(temporary, this.desktopControlStateFile)
      await chmod(this.desktopControlStateFile, 0o600).catch(() => {})
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      throw error
    }
    this.desktopControlAuth = { bearer, generation }
  }

  async start({ persist = true } = {}) {
    if (this.server?.listening) {
      if (persist && !this.store.get().enabled) this.store.setEnabled(true)
      return this.publish()
    }
    await this.#removeDesktopControlState()
    this.proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true, xfwd: false, secure: false })
    this.proxy.on('proxyReqWs', (proxyRequest, request) => {
      const deviceId = request.__harnessMobileDeviceId
      if (!deviceId) return
      this.#trackDeviceConnection(deviceId, proxyRequest)
      proxyRequest.once('upgrade', (_response, upstreamSocket) => this.#trackDeviceConnection(deviceId, upstreamSocket))
    })
    this.proxy.on('error', (error, request, responseOrSocket) => {
      if (responseOrSocket && typeof responseOrSocket.writeHead === 'function') {
        writeResponse(responseOrSocket, 502, runtimeUnavailablePage())
      } else if (responseOrSocket && !responseOrSocket.destroyed) {
        responseOrSocket.destroy(error)
      }
    })
    this.server = http.createServer((request, response) => {
      Promise.resolve(this.#handleHttp(request, response)).catch(error => {
        if (response.headersSent) {
          response.destroy(error)
          return
        }
        const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 500
        writeResponse(response, status, JSON.stringify({ ok: false, error: error?.message || String(error) }), {
          'Content-Type': 'application/json; charset=utf-8'
        })
      })
    })
    this.server.on('connection', socket => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
    this.server.on('upgrade', (request, socket, head) => this.#handleUpgrade(request, socket, head))
    const preferredPort = this.requestedPort ?? this.store.get().preferredPort
    const address = await listenBrowserSafe(this.server, preferredPort, this.host)
    this.port = address.port
    try {
      await this.#writeDesktopControlState()
    } catch (error) {
      await this.stop({ persist: false })
      throw error
    }
    if (this.requestedPort !== 0) this.store.setPreferredPort(this.port)
    if (persist) this.store.setEnabled(true)
    if (this.store.get().remoteEnabled) {
      await this.transportManager?.start({ port: this.port, stateDir: this.stateDir }).catch(error => {
        console.warn(`Unable to start remote mobile sync: ${error.message}`)
      })
    }
    return this.publish()
  }

  async stop({ persist = true } = {}) {
    this.pairing = null
    this.controlBroker.stop(null, 'SYNC_STOPPED')
    await this.#removeDesktopControlState()
    if (persist && this.store.get().enabled) this.store.setEnabled(false)
    if (!this.server) return this.publish()
    const server = this.server
    this.server = null
    this.port = null
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    this.deviceSockets.clear()
    await new Promise(resolve => server.close(() => resolve()))
    this.proxy?.close()
    this.proxy = null
    await this.transportManager?.stop({ persist: false }).catch(() => {})
    return this.publish()
  }

  async setEnabled(enabled) {
    return enabled ? this.start({ persist: true }) : this.stop({ persist: true })
  }

  async setRemoteEnabled(enabled) {
    if (!this.server?.listening && enabled) await this.start({ persist: true })
    await this.transportManager?.setEnabled(Boolean(enabled), { port: this.port, stateDir: this.stateDir })
    if (!this.transportManager) this.store.setRemoteEnabled(Boolean(enabled))
    return this.publish()
  }

  async setTransportPreference(preference) {
    if (this.transportManager) await this.transportManager.setPreference(preference)
    else this.store.setTransportPreference(preference)
    return this.publish()
  }

  getRelayConfig() {
    return this.relayConfigStore?.get?.() || { enabled: false, relayUrl: '', source: 'disabled', checkedAt: null }
  }

  async setRelayConfig(value) {
    if (!this.relayConfigStore) throw new Error('Personal WSS relay configuration is unavailable.')
    const previous = this.getRelayConfig()
    const config = await this.relayConfigStore.set(value)
    const changed = previous.enabled !== config.enabled || previous.relayUrl !== config.relayUrl
    if (changed) {
      this.pairing = null
      this.relayOutdatedDeviceIds = new Set(this.store.get().devices.map(device => device.id))
      await this.transportManager?.configureWssRelay(config.enabled ? config.relayUrl : '')
    }
    return this.publish()
  }

  async clearRelayConfig() {
    if (!this.relayConfigStore) throw new Error('Personal WSS relay configuration is unavailable.')
    const previous = this.getRelayConfig()
    const config = this.relayConfigStore.clear()
    const changed = previous.enabled !== config.enabled || previous.relayUrl !== config.relayUrl
    if (changed) {
      this.pairing = null
      this.relayOutdatedDeviceIds = new Set(this.store.get().devices.map(device => device.id))
      await this.transportManager?.configureWssRelay(config.enabled ? config.relayUrl : '')
    }
    return this.publish()
  }

  async beginPairing() {
    if (!this.server?.listening) await this.start({ persist: true })
    const token = randomBytes(24).toString('base64url')
    this.pairing = {
      tokenHash: sha256(token),
      expiresAt: this.now() + PAIRING_TTL_MS
    }
    const origin = this.origins()[0]
    if (!origin) throw new Error('没有检测到可用于手机连接的局域网 IPv4 地址。')
    const url = `${origin}/__harness_mobile__/pair/${encodeURIComponent(token)}`
    const payload = Buffer.from(JSON.stringify({
      version: 2,
      pairUrl: url,
      transports: this.transportManager?.pairingTransports?.() || []
    })).toString('base64url')
    const appUrl = `harnessmobile://pair?payload=${encodeURIComponent(payload)}`
    const shareUrl = `${origin}/__harness_mobile__/setup?payload=${encodeURIComponent(payload)}`
    const qrDataUrl = await this.qrFactory(shareUrl)
    this.pairing.url = url
    this.pairing.appUrl = appUrl
    this.pairing.shareUrl = shareUrl
    this.pairing.payload = payload
    this.pairing.qrDataUrl = qrDataUrl
    this.publish()
    return this.state()
  }

  revokeDevice(id) {
    this.store.revokeDevice(id)
    this.controlBroker.clearDevice(id, 'DEVICE_REVOKED')
    for (const socket of this.deviceSockets.get(id) || []) socket.destroy()
    this.deviceSockets.delete(id)
    this.lastTouchByDevice.delete(id)
    this.relayOutdatedDeviceIds.delete(id)
    this.publish()
    return this.state()
  }

  sendControlCommand(deviceId, command) {
    const result = this.controlBroker.enqueue(String(deviceId || ''), command || {})
    this.publish()
    return result
  }

  cancelControlCommand(commandId) {
    const cancelled = this.controlBroker.cancel(String(commandId || ''))
    this.publish()
    return { ok: cancelled }
  }

  stopControl(deviceId = null, reason = 'DESKTOP_STOP') {
    const count = this.controlBroker.stop(deviceId ? String(deviceId) : null, reason)
    this.publish()
    return { ok: true, stoppedDevices: count, state: this.state().control }
  }

  controlResult(commandId) {
    return this.controlBroker.result(String(commandId || ''))
  }

  #isDesktopControlAuthorized(request) {
    const auth = this.desktopControlAuth
    if (!auth || request.headers['x-harness-mobile-control'] !== '1') return false
    const authorization = String(request.headers.authorization || '')
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)
    const generation = String(request.headers['x-harness-mobile-control-generation'] || '')
    return Boolean(match && constantTimeHexEqual(sha256(match[1]), sha256(auth.bearer)) && constantTimeHexEqual(sha256(generation), sha256(auth.generation)))
  }

  #deviceFromRequest(request) {
    const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME]
    const [id, secret, extra] = String(token || '').split('.')
    if (extra || !/^[a-f0-9]{16}$/.test(id || '') || !/^[A-Za-z0-9_-]{20,}$/.test(secret || '')) return null
    const device = this.store.get().devices.find(entry => entry.id === id)
    if (!device || !constantTimeHexEqual(device.secretHash, sha256(secret))) return null
    const lastTouch = this.lastTouchByDevice.get(id) || 0
    if (this.now() - lastTouch >= DEVICE_TOUCH_INTERVAL_MS) {
      this.lastTouchByDevice.set(id, this.now())
      this.store.touchDevice(id, new Date(this.now()))
      this.publish()
    }
    return device
  }

  #claimPairing(request, response, token) {
    const current = this.pairing
    if (!current || current.expiresAt <= this.now() || !constantTimeHexEqual(current.tokenHash, sha256(token))) {
      writeResponse(response, 410, pairingErrorPage())
      return
    }
    this.pairing = null
    const id = randomBytes(8).toString('hex')
    const secret = randomBytes(32).toString('base64url')
    const createdAt = new Date(this.now()).toISOString()
    const descriptor = deviceDescriptorFromUserAgent(request.headers['user-agent'])
    this.store.addDevice({
      id,
      secretHash: sha256(secret),
      ...descriptor,
      createdAt,
      lastSeenAt: createdAt
    })
    response.writeHead(302, {
      'Cache-Control': 'no-store',
      'Location': '/',
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(`${id}.${secret}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff'
    })
    response.end()
    this.publish()
  }

  async #uploadDocument(request, response, requestUrl) {
    if (request.method !== 'POST') {
      writeResponse(response, 405, JSON.stringify({ ok: false, code: 'DOCUMENT_METHOD_NOT_ALLOWED', error: 'Document upload requires POST.' }), { 'Allow': 'POST', 'Content-Type': 'application/json; charset=utf-8' })
      return
    }
    if (request.headers['x-harness-mobile-request'] !== MOBILE_DOCUMENT_UPLOAD_INTENT) {
      writeResponse(response, 403, JSON.stringify({ ok: false, code: 'DOCUMENT_INTENT_REQUIRED', error: 'Document upload intent is missing.' }), { 'Content-Type': 'application/json; charset=utf-8' })
      return
    }
    let sessionId
    let fileName
    try {
      sessionId = boundedDocumentIdentity(requestUrl.searchParams.get('sessionId'), 'sessionId', 256)
      fileName = boundedDocumentIdentity(requestUrl.searchParams.get('name'), 'name', 512)
    } catch {
      writeResponse(response, 400, JSON.stringify({ ok: false, code: 'DOCUMENT_INVALID_IDENTITY', error: '会话或文档名称无效。' }), { 'Content-Type': 'application/json; charset=utf-8' })
      return
    }
    const target = this.runtimeTarget()
    if (!target) {
      writeResponse(response, 503, JSON.stringify({ ok: false, code: 'DOCUMENT_RUNTIME_UNAVAILABLE', error: '电脑工作台尚未就绪。' }), { 'Retry-After': '2', 'Content-Type': 'application/json; charset=utf-8' })
      return
    }
    let content
    try { content = await readBinaryBody(request) }
    catch (error) {
      if (error?.code === 'BODY_TOO_LARGE') {
        writeResponse(response, 413, JSON.stringify({ ok: false, code: 'FILES_TOO_LARGE', error: '文档超过 50 MB 上传限制。' }), { 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      throw error
    }
    if (!content.length) {
      writeResponse(response, 400, JSON.stringify({ ok: false, code: 'FILES_EMPTY_UPLOAD', error: '不能上传空文档。' }), { 'Content-Type': 'application/json; charset=utf-8' })
      return
    }
    // DSH's browser session.prompt wire accepts text and raster images only.
    // General documents therefore stay on the official desktop-files route,
    // whose live root Agent supplies the authoritative workspace cwd. The
    // mobile bridge never accepts or materializes a client-authored path.
    const upstreamUrl = new URL('/api/desktop-files/upload', `${target}/`)
    upstreamUrl.searchParams.set('sessionId', sessionId)
    upstreamUrl.searchParams.set('name', fileName)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MOBILE_DOCUMENT_UPLOAD_TIMEOUT_MS)
    timer.unref?.()
    let upstream
    let payload
    try {
      upstream = await this.fetchImpl(upstreamUrl, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: content
      })
      payload = await boundedJsonResponse(upstream)
    } catch {
      writeResponse(response, 502, JSON.stringify({ ok: false, code: 'DOCUMENT_UPLOAD_UNAVAILABLE', error: '无法把文档交给电脑工作区。' }), { 'Content-Type': 'application/json; charset=utf-8' })
      return
    } finally { clearTimeout(timer) }
    if (upstream.status === 201 && payload?.schemaVersion === 1) {
      const file = safeOfficialDocument(payload.file, content.length)
      if (file) {
        response.writeHead(201, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        response.end(JSON.stringify({ ok: true, schemaVersion: 1, file }))
        return
      }
    }
    const mapped = documentUploadError(upstream.status, typeof payload?.code === 'string' ? payload.code : '')
    writeResponse(response, mapped.status, JSON.stringify({ ok: false, code: mapped.code, error: mapped.error }), { 'Content-Type': 'application/json; charset=utf-8' })
  }

  async #handleHttp(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://harness-mobile.local')
    const isDesktopControlRequest = requestUrl.pathname.startsWith('/__harness_mobile__/control/desktop-')
    if (isDesktopControlRequest) {
      if (!isLoopbackAddress(request.socket?.remoteAddress)) {
        writeResponse(response, 403, JSON.stringify({ ok: false, error: 'Desktop control API is loopback-only.' }), { 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      if (!this.#isDesktopControlAuthorized(request)) {
        writeResponse(response, 401, JSON.stringify({ ok: false, error: 'Desktop control authorization is invalid or expired.' }), { 'Content-Type': 'application/json; charset=utf-8', 'WWW-Authenticate': 'Bearer' })
        return
      }
      if (requestUrl.pathname === '/__harness_mobile__/control/desktop-state' && request.method === 'GET') {
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: true, control: this.state().control }))
        return
      }
      if (requestUrl.pathname === '/__harness_mobile__/control/desktop-command' && request.method === 'POST') {
        const payload = await readJsonBody(request)
        const command = this.sendControlCommand(payload.deviceId, payload.command)
        response.writeHead(202, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: true, command }))
        return
      }
      if (requestUrl.pathname === '/__harness_mobile__/control/desktop-cancel' && request.method === 'POST') {
        const payload = await readJsonBody(request)
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(this.cancelControlCommand(payload.commandId)))
        return
      }
      if (requestUrl.pathname === '/__harness_mobile__/control/desktop-stop' && request.method === 'POST') {
        const payload = await readJsonBody(request)
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify(this.stopControl(payload.deviceId || null, 'DESKTOP_STOP')))
        return
      }
      if (requestUrl.pathname === '/__harness_mobile__/control/desktop-result' && request.method === 'GET') {
        const result = this.controlResult(requestUrl.searchParams.get('id'))
        response.writeHead(result ? 200 : 202, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: Boolean(result), pending: !result, result }))
        return
      }
      writeResponse(response, 404, JSON.stringify({ ok: false, error: 'Unknown desktop control endpoint.' }), { 'Content-Type': 'application/json; charset=utf-8' })
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/health') {
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, bridgeApiVersion: BRIDGE_API_VERSION, controlProtocolVersion: CONTROL_PROTOCOL_VERSION, protocol: MOBILE_PROTOCOL_DESCRIPTOR, pairingRequired: true }))
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/setup' && request.method === 'GET') {
      const payload = requestUrl.searchParams.get('payload') || ''
      const current = this.pairing
      if (!current || current.expiresAt <= this.now() || !payload || payload !== current.payload) {
        writeResponse(response, 410, pairingErrorPage('下载二维码已经失效，请回到电脑端点击“添加手机”重新生成。'))
        return
      }
      if (isIosUserAgent(request.headers['user-agent'])) {
        writeResponse(response, 200, iosSetupPage(current.appUrl, this.iosDownloadUrl, current.url))
      } else {
        mobileDownloadRedirect(response, this.mobileDownloadUrl)
      }
      return
    }
    const pairMatch = requestUrl.pathname.match(/^\/__harness_mobile__\/pair\/([A-Za-z0-9_-]+)$/)
    if (pairMatch && request.method === 'GET') {
      this.#claimPairing(request, response, pairMatch[1])
      return
    }
    const device = this.#deviceFromRequest(request)
    if (!device) {
      writeResponse(response, 401, pairingErrorPage('请在电脑端打开“手机同步”，扫描新的配对二维码。'))
      return
    }
    if (requestUrl.pathname === MOBILE_DOCUMENT_UPLOAD_PATH) {
      await this.#uploadDocument(request, response, requestUrl)
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/model-routing') {
      if (request.method !== 'GET') {
        writeResponse(response, 405, JSON.stringify({ ok: false, error: 'Model routing is read-only.' }), { 'Allow': 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      if (typeof this.getModelRouting !== 'function') {
        writeResponse(response, 503, JSON.stringify({ ok: false, error: '无法从已配对电脑读取模型配置。' }), { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      try {
        const routing = mobileModelRoutingDto(await this.getModelRouting())
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        response.end(JSON.stringify({ ok: true, routing }))
      } catch {
        writeResponse(response, 503, JSON.stringify({ ok: false, error: '无法从已配对电脑读取模型配置。' }), { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      }
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/provider-meters') {
      if (request.method !== 'GET') {
        writeResponse(response, 405, JSON.stringify({ ok: false, error: 'Provider meters are read-only.' }), { 'Allow': 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      if (typeof this.getProviderMeters !== 'function') {
        writeResponse(response, 503, JSON.stringify({ ok: false, error: '无法从已配对电脑读取账户额度。' }), { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      try {
        const meters = mobileProviderMetersDto(await this.getProviderMeters())
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        response.end(JSON.stringify({ ok: true, ...meters }))
      } catch {
        writeResponse(response, 503, JSON.stringify({ ok: false, error: '无法从已配对电脑读取账户额度。' }), { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      }
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/plugins') {
      if (request.method !== 'GET') {
        writeResponse(response, 405, JSON.stringify({ ok: false, error: 'Plugin inventory is read-only.' }), { 'Allow': 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      if (typeof this.getPlugins !== 'function') {
        writeResponse(response, 503, JSON.stringify({ ok: false, error: '无法从已配对电脑读取插件状态。' }), { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      try {
        const plugins = mobilePluginsDto(await this.getPlugins())
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' })
        response.end(JSON.stringify({ ok: true, ...plugins }))
      } catch {
        writeResponse(response, 503, JSON.stringify({ ok: false, error: '无法从已配对电脑读取插件状态。' }), { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      }
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/workspace/choose' && request.method === 'POST') {
      if (request.headers['x-harness-mobile-request'] !== 'workspace-picker') {
        writeResponse(response, 403, JSON.stringify({ ok: false, error: 'Workspace picker request intent is missing.' }), { 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      if (typeof this.chooseWorkspaceDirectory !== 'function') {
        writeResponse(response, 501, JSON.stringify({ ok: false, error: '桌面工作区选择功能当前不可用。' }), { 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      if (this.workspacePickerRequest) {
        writeResponse(response, 409, JSON.stringify({ ok: false, error: '另一台设备正在请求选择工作区，请稍后重试。' }), { 'Content-Type': 'application/json; charset=utf-8' })
        return
      }
      const pending = Promise.resolve().then(() => this.chooseWorkspaceDirectory({ deviceId: device.id }))
      this.workspacePickerRequest = pending
      try {
        const selectedPath = await pending
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ ok: true, path: selectedPath == null ? null : String(selectedPath) }))
      } catch (error) {
        writeResponse(response, 500, JSON.stringify({ ok: false, error: error?.message || '无法打开桌面工作区选择窗口。' }), { 'Content-Type': 'application/json; charset=utf-8' })
      } finally {
        if (this.workspacePickerRequest === pending) this.workspacePickerRequest = null
      }
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/control/status' && request.method === 'POST') {
      const status = this.controlBroker.reportStatus(device.id, await readJsonBody(request))
      this.publish()
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, protocolVersion: CONTROL_PROTOCOL_VERSION, status }))
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/control/poll' && request.method === 'GET') {
      const payload = this.controlBroker.poll(device.id, requestUrl.searchParams.get('protocolVersion'))
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(payload))
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/control/result' && request.method === 'POST') {
      const result = this.controlBroker.reportResult(device.id, await readJsonBody(request, 10 * 1024 * 1024))
      this.publish()
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, result: { id: result.id, ok: result.ok, code: result.code } }))
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/meta') {
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ ok: true, bridgeApiVersion: BRIDGE_API_VERSION, controlProtocolVersion: CONTROL_PROTOCOL_VERSION, protocol: MOBILE_PROTOCOL_DESCRIPTOR, documents: MOBILE_DOCUMENT_UPLOAD_CONTRACT, deviceId: device.id, platform: device.platform, deviceClass: device.deviceClass, appVersion: device.appVersion, targetReady: Boolean(this.runtimeTarget()) }))
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/theme.js' && request.method === 'GET') {
      if (typeof this.getThemeScript !== 'function') {
        writeResponse(response, 404, '')
        return
      }
      response.writeHead(200, {
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      })
      response.end(await this.getThemeScript())
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/appearance' && request.method === 'GET') {
      if (typeof this.getAppearance !== 'function') {
        writeResponse(response, 404, '')
        return
      }
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(await this.getAppearance()))
      return
    }
    if (requestUrl.pathname === '/__harness_mobile__/appearance' && request.method === 'POST') {
      if (typeof this.setAppearance !== 'function') {
        writeResponse(response, 404, '')
        return
      }
      const payload = await readJsonBody(request)
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify(await this.setAppearance(payload)))
      return
    }
    const themeAssetMatch = requestUrl.pathname.match(/^\/__harness_mobile__\/theme-assets\/(.+)$/)
    if (themeAssetMatch && request.method === 'GET') {
      const asset = typeof this.readThemeAsset === 'function'
        ? await this.readThemeAsset(decodeURIComponent(themeAssetMatch[1]))
        : null
      if (!asset?.data) {
        writeResponse(response, 404, '')
        return
      }
      const isCustomThemeAsset = decodeURIComponent(themeAssetMatch[1]) === 'custom-background'
      response.writeHead(200, {
        'Cache-Control': isCustomThemeAsset ? 'no-store' : 'private, max-age=86400',
        'Content-Type': asset.mime || 'application/octet-stream',
        'Content-Length': asset.data.length,
        'X-Content-Type-Options': 'nosniff'
      })
      response.end(asset.data)
      return
    }
    const target = this.runtimeTarget()
    if (!target) {
      writeResponse(response, 503, runtimeUnavailablePage(), { 'Retry-After': '2' })
      return
    }
    this.#prepareUpstreamHeaders(request, target)
    this.proxy.web(request, response, { target })
  }

  #handleUpgrade(request, socket, head) {
    const device = this.#deviceFromRequest(request)
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const target = this.runtimeTarget()
    if (!target) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    request.__harnessMobileDeviceId = device.id
    this.#trackDeviceConnection(device.id, socket)
    this.#prepareUpstreamHeaders(request, target)
    this.proxy.ws(request, socket, head, { target })
  }

  #trackDeviceConnection(deviceId, connection) {
    if (!connection || typeof connection.destroy !== 'function') return
    if (!this.deviceSockets.has(deviceId)) this.deviceSockets.set(deviceId, new Set())
    const deviceConnections = this.deviceSockets.get(deviceId)
    deviceConnections.add(connection)
    connection.once('close', () => {
      deviceConnections.delete(connection)
      if (!deviceConnections.size) this.deviceSockets.delete(deviceId)
    })
  }

  #prepareUpstreamHeaders(request, target) {
    const targetUrl = new URL(target)
    if (request.headers.origin) request.headers.origin = targetUrl.origin
    if (request.headers.referer) {
      try {
        const referer = new URL(request.headers.referer)
        request.headers.referer = `${targetUrl.origin}${referer.pathname}${referer.search}${referer.hash}`
      } catch {
        delete request.headers.referer
      }
    }
    const cookie = withoutMobileCookie(request.headers.cookie || '')
    if (cookie) request.headers.cookie = cookie
    else delete request.headers.cookie
  }
}

module.exports = {
  MobileSyncService,
  BRIDGE_API_VERSION,
  MOBILE_PROTOCOL_DESCRIPTOR,
  MOBILE_DOCUMENT_MAX_BYTES,
  MOBILE_DOCUMENT_UPLOAD_CONTRACT,
  COOKIE_NAME,
  PAIRING_TTL_MS,
  BROWSER_FORBIDDEN_PORTS,
  browserSafePort,
  constantTimeHexEqual,
  deviceDescriptorFromUserAgent,
  isPrivateIpv4,
  isIosUserAgent,
  iosSetupPage,
  lanAddresses,
  mobileMeterText,
  mobileModelRoutingDto,
  mobilePluginsDto,
  mobileProviderMetersDto,
  parseCookies,
  safeDeviceName,
  safeIosDownloadUrl,
  withoutMobileCookie,
  sha256
}
