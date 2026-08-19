const { EventEmitter } = require('node:events')
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto')
const http = require('node:http')
const os = require('node:os')
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
const CURRENT_MOBILE_VERSION = '1.0.25'
const DEFAULT_MOBILE_DOWNLOAD_URL = `https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/v${CURRENT_MOBILE_VERSION}/Harness-Mobile-${CURRENT_MOBILE_VERSION}-android-universal.apk`
const DEFAULT_IOS_DOWNLOAD_URL = ''

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
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Docker|Hyper-V|Loopback/i.test(name)
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
    controlBroker = null
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
    this.controlBroker = controlBroker || new MobileControlBroker({ now })
    this.server = null
    this.proxy = null
    this.port = null
    this.pairing = null
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

  async start({ persist = true } = {}) {
    if (this.server?.listening) {
      if (persist && !this.store.get().enabled) this.store.setEnabled(true)
      return this.publish()
    }
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
    try {
      await listen(this.server, preferredPort, this.host)
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error
      await listen(this.server, 0, this.host)
    }
    this.port = this.server.address().port
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

  async #handleHttp(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://harness-mobile.local')
    const isDesktopControlRequest = requestUrl.pathname.startsWith('/__harness_mobile__/control/desktop-')
    if (isDesktopControlRequest) {
      if (!isLoopbackAddress(request.socket?.remoteAddress) || request.headers['x-harness-mobile-control'] !== '1') {
        writeResponse(response, 403, JSON.stringify({ ok: false, error: 'Desktop control API is loopback-only.' }), { 'Content-Type': 'application/json; charset=utf-8' })
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
      response.end(JSON.stringify({ ok: true, bridgeApiVersion: BRIDGE_API_VERSION, controlProtocolVersion: CONTROL_PROTOCOL_VERSION, protocol: MOBILE_PROTOCOL_DESCRIPTOR, deviceId: device.id, platform: device.platform, deviceClass: device.deviceClass, appVersion: device.appVersion, targetReady: Boolean(this.runtimeTarget()) }))
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
  COOKIE_NAME,
  PAIRING_TTL_MS,
  constantTimeHexEqual,
  deviceDescriptorFromUserAgent,
  isPrivateIpv4,
  isIosUserAgent,
  iosSetupPage,
  lanAddresses,
  parseCookies,
  safeDeviceName,
  safeIosDownloadUrl,
  withoutMobileCookie,
  sha256
}
