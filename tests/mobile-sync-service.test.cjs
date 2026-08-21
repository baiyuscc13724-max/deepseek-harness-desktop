const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, statSync } = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { WebSocket, WebSocketServer } = require('ws')

const { MobileSyncService, lanAddresses, safeDeviceName } = require('../electron/bridge/mobile-sync-service.cjs')
const { MobileSyncStore } = require('../electron/store/mobile-sync-store.cjs')

async function createRuntime(label) {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    if (request.url === '/headers') {
      response.end(JSON.stringify({ origin: request.headers.origin, referer: request.headers.referer, cookie: request.headers.cookie }))
    } else response.end(`${label}:${request.url}`)
  })
  const websocket = new WebSocketServer({ noServer: true })
  websocket.on('connection', client => client.on('message', value => client.send(`${label}:${value}`)))
  server.on('upgrade', (request, socket, head) => websocket.handleUpgrade(request, socket, head, client => websocket.emit('connection', client, request)))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => websocket.close(() => server.close(resolve)))
  }
}

function secretAdapter() {
  const transform = value => Buffer.from(value).map(byte => byte ^ 0xa5)
  return {
    protect: plaintext => transform(Buffer.from(String(plaintext), 'utf8')),
    unprotect: ciphertext => transform(Buffer.from(ciphertext)).toString('utf8')
  }
}

function createStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-service-'))
  return new MobileSyncStore(path.join(directory, 'mobile-sync.json'), secretAdapter())
}

function desktopControlCredentials(service) {
  const state = JSON.parse(readFileSync(service.desktopControlStateFile, 'utf8'))
  return {
    state,
    headers: {
      Authorization: `Bearer ${state.bearer}`,
      'X-Harness-Mobile-Control': '1',
      'X-Harness-Mobile-Control-Generation': state.generation
    }
  }
}

async function pair(service) {
  const pairing = await service.beginPairing()
  const response = await fetch(pairing.pairing.url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'HarnessMobile/1 Android 16; Pixel' }
  })
  assert.equal(response.status, 302)
  const cookie = response.headers.get('set-cookie').split(';')[0]
  assert.match(cookie, /^harness_mobile_auth=/)
  return { cookie, url: pairing.pairing.url }
}

test('mobile bridge requires one-time pairing and proxies HTTP without protocol knowledge', async t => {
  const runtime = await createRuntime('official-a')
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => runtime.url,
    host: '127.0.0.1',
    port: 0,
    qrFactory: async value => `qr:${value}`
  })
  t.after(async () => {
    await service.stop()
    await runtime.close()
  })
  await service.start()
  const origin = service.state().origins[0]
  assert.equal((await fetch(`${origin}/`)).status, 401)
  const paired = await pair(service)
  assert.equal((await fetch(paired.url, { redirect: 'manual' })).status, 410)
  const proxied = await fetch(`${origin}/conversation/abc?tab=chat`, { headers: { Cookie: paired.cookie } })
  assert.equal(await proxied.text(), 'official-a:/conversation/abc?tab=chat')
  const headersResponse = await fetch(`${origin}/headers`, {
    headers: {
      Cookie: `${paired.cookie}; official_session=yes`,
      Origin: origin,
      Referer: `${origin}/conversation/abc`
    }
  })
  const upstreamHeaders = await headersResponse.json()
  assert.equal(upstreamHeaders.origin, runtime.url)
  assert.equal(upstreamHeaders.referer, `${runtime.url}/conversation/abc`)
  assert.equal(upstreamHeaders.cookie, 'official_session=yes')
  assert.equal(service.state().devices.length, 1)
})

test('one QR downloads the Android app in browsers without consuming app pairing', async t => {
  const runtime = await createRuntime('official')
  let encodedQrValue = ''
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => runtime.url,
    host: '127.0.0.1',
    port: 0,
    mobileDownloadUrl: 'https://downloads.example.test/Harness-Mobile.apk',
    qrFactory: async value => {
      encodedQrValue = value
      return `qr:${value}`
    }
  })
  t.after(async () => {
    await service.stop()
    await runtime.close()
  })
  await service.start()
  const state = await service.beginPairing()
  assert.equal(encodedQrValue, state.pairing.shareUrl)
  assert.match(state.pairing.shareUrl, /\/__harness_mobile__\/setup\?payload=/)
  assert.match(state.pairing.appUrl, /^harnessmobile:\/\/pair\?payload=/)

  const browserResponse = await fetch(state.pairing.shareUrl, { redirect: 'manual' })
  assert.equal(browserResponse.status, 302)
  assert.equal(browserResponse.headers.get('location'), 'https://downloads.example.test/Harness-Mobile.apk')
  assert.equal(service.state().devices.length, 0)
  assert.ok(service.state().pairing)

  const appResponse = await fetch(state.pairing.url, {
    redirect: 'manual',
    headers: { 'User-Agent': 'HarnessMobile/1 Android 16; Pixel' }
  })
  assert.equal(appResponse.status, 302)
  assert.equal(service.state().devices.length, 1)
  assert.equal(service.state().pairing, null)
})

test('pairing payload is OS-neutral and carries the WSS/443 fallback for iPhone and Android', async t => {
  const relay = {
    id: 'wss-relay', origin: 'http://10.253.77.254:3081', relayUrl: 'wss://relay.example.test/',
    roomId: 'r'.repeat(43), tunnelKey: 'k'.repeat(43), protocolVersion: 1, secureMode: true
  }
  const transportManager = {
    pairingTransports: () => [relay],
    state: () => ({ enabled: true, status: 'connected', active: 'wss-relay', adapters: [] }),
    async start() {}, async stop() {}, on() {}
  }
  const service = new MobileSyncService({
    store: createStore(), getRuntimeTarget: () => null, transportManager,
    host: '127.0.0.1', port: 0, qrFactory: async value => `qr:${value}`
  })
  t.after(() => service.stop())
  await service.start()
  const state = await service.beginPairing()
  const encoded = new URL(state.pairing.appUrl).searchParams.get('payload')
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  assert.deepEqual(payload.transports, [relay])
  assert.match(safeDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)'), /^iPhone iOS 18\.4/)
  assert.match(safeDeviceName('Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X)'), /^iPadOS 18\.4/)
  assert.match(safeDeviceName('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), /^Android 15/)
})

test('iPhone and iPad setup never redirect to the Android APK', async t => {
  const runtime = await createRuntime('official')
  const service = new MobileSyncService({
    store: createStore(), getRuntimeTarget: () => runtime.url, host: '127.0.0.1', port: 0,
    iosDownloadUrl: 'https://testflight.apple.com/join/HarnessTest', qrFactory: async value => `qr:${value}`
  })
  t.after(async () => { await service.stop(); await runtime.close() })
  await service.start()
  const state = await service.beginPairing()
  const response = await fetch(state.pairing.shareUrl, {
    redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)' }
  })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('location'), null)
  const page = await response.text()
  assert.match(page, /Harness Mobile for iPhone \/ iPad/)
  assert.match(page, /harnessmobile:\/\/pair\?payload=/)
  assert.match(page, /https:\/\/testflight\.apple\.com\/join\/HarnessTest/)
  assert.match(page, /直接在 Safari 使用/)
  assert.match(page, /添加到主屏幕/)
  assert.ok(page.includes(state.pairing.url))
  assert.doesNotMatch(page, /\.apk/)
  assert.equal(service.state().devices.length, 0)
  assert.ok(service.state().pairing)
})

test('iPhone and iPad offer a Safari workbench when no Apple distribution account exists', async t => {
  const runtime = await createRuntime('official')
  const service = new MobileSyncService({
    store: createStore(), getRuntimeTarget: () => runtime.url, host: '127.0.0.1', port: 0,
    qrFactory: async value => `qr:${value}`
  })
  t.after(async () => { await service.stop(); await runtime.close() })
  await service.start()
  const state = await service.beginPairing()
  const response = await fetch(state.pairing.shareUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X)' }
  })
  assert.equal(response.status, 200)
  const page = await response.text()
  assert.match(page, /直接在 Safari 使用/)
  assert.match(page, /无需 Apple Developer 会员/)
  assert.match(page, /不会提供无法公开安装的未签名 IPA/)
  assert.ok(page.includes(state.pairing.url))
  assert.doesNotMatch(page, /\.apk/)
})

test('mobile bridge proxies WebSocket and follows a replaced official runtime target', async t => {
  const runtimeA = await createRuntime('official-a')
  const runtimeB = await createRuntime('official-b')
  let current = runtimeA.url
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => current,
    host: '127.0.0.1',
    port: 0,
    qrFactory: async () => 'qr'
  })
  t.after(async () => {
    await service.stop()
    await runtimeA.close()
    await runtimeB.close()
  })
  await service.start()
  const paired = await pair(service)
  const origin = service.state().origins[0]
  const wsUrl = origin.replace(/^http/, 'ws') + '/events'
  const message = await new Promise((resolve, reject) => {
    const client = new WebSocket(wsUrl, { headers: { Cookie: paired.cookie } })
    client.once('open', () => client.send('hello'))
    client.once('message', value => {
      resolve(String(value))
      client.close()
    })
    client.once('error', reject)
  })
  assert.equal(message, 'official-a:hello')
  current = runtimeB.url
  const response = await fetch(`${origin}/next`, { headers: { Cookie: paired.cookie } })
  assert.equal(await response.text(), 'official-b:/next')
})

test('revoking a paired phone immediately closes its live connection and rejects reuse', async t => {
  const runtime = await createRuntime('official')
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => runtime.url,
    host: '127.0.0.1',
    port: 0,
    qrFactory: async () => 'qr'
  })
  t.after(async () => {
    await service.stop()
    await runtime.close()
  })
  await service.start()
  const paired = await pair(service)
  const origin = service.state().origins[0]
  const client = new WebSocket(origin.replace(/^http/, 'ws') + '/events', { headers: { Cookie: paired.cookie } })
  await new Promise((resolve, reject) => {
    client.once('open', resolve)
    client.once('error', reject)
  })
  const closed = new Promise(resolve => client.once('close', resolve))
  service.revokeDevice(service.state().devices[0].id)
  await closed
  assert.equal(service.state().devices.length, 0)
  assert.equal((await fetch(`${origin}/`, { headers: { Cookie: paired.cookie } })).status, 401)
})

test('LAN address selection prefers physical private IPv4 interfaces', () => {
  const result = lanAddresses({
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.0.1' }],
    WiFi: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
    Public: [{ family: 'IPv4', internal: false, address: '8.8.8.8' }]
  })
  assert.deepEqual(result, ['192.168.1.20', '172.20.0.1'])
})

test('versioned mobile control endpoints require pairing and desktop commands are loopback-only', async t => {
  const runtime = await createRuntime('official')
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => runtime.url,
    host: '127.0.0.1',
    port: 0,
    qrFactory: async () => 'qr'
  })
  t.after(async () => {
    await service.stop()
    await runtime.close()
  })
  await service.start()
  const paired = await pair(service)
  const origin = service.state().origins[0]
  const headers = { Cookie: paired.cookie, 'Content-Type': 'application/json' }
  const deviceId = service.state().devices[0].id

  const status = await fetch(`${origin}/__harness_mobile__/control/status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ protocolVersion: 1, enabled: true, ready: true, accessibility: true, capabilities: ['tap', 'screenshot'] })
  })
  assert.equal(status.status, 200)
  assert.equal(service.state().control.devices[0].ready, true)

  const forbidden = await fetch(`${origin}/__harness_mobile__/control/desktop-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, command: { action: 'tap', payload: { x: 1, y: 2 } } })
  })
  assert.equal(forbidden.status, 401)

  const auxiliaryHeaderOnly = await fetch(`${origin}/__harness_mobile__/control/desktop-state`, {
    headers: { 'X-Harness-Mobile-Control': '1' }
  })
  assert.equal(auxiliaryHeaderOnly.status, 401)

  const control = desktopControlCredentials(service)
  const submitted = await fetch(`${origin}/__harness_mobile__/control/desktop-command`, {
    method: 'POST',
    headers: { ...control.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, command: { action: 'tap', payload: { x: 10, y: 20 } } })
  })
  assert.equal(submitted.status, 202)
  const command = (await submitted.json()).command

  const polled = await fetch(`${origin}/__harness_mobile__/control/poll?protocolVersion=1`, { headers: { Cookie: paired.cookie } })
  assert.equal((await polled.json()).command.id, command.id)
  const receipt = await fetch(`${origin}/__harness_mobile__/control/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: command.id, ok: true, code: 'OK' })
  })
  assert.equal(receipt.status, 200)

  const secondSubmission = await fetch(`${origin}/__harness_mobile__/control/desktop-command`, {
    method: 'POST',
    headers: { ...control.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, command: { action: 'tap', payload: { x: 30, y: 40 } } })
  })
  const secondCommand = (await secondSubmission.json()).command
  const cancelled = await fetch(`${origin}/__harness_mobile__/control/desktop-cancel`, {
    method: 'POST',
    headers: { ...control.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commandId: secondCommand.id })
  })
  assert.deepEqual(await cancelled.json(), { ok: true })
  const cancelledResult = await fetch(`${origin}/__harness_mobile__/control/desktop-result?id=${encodeURIComponent(secondCommand.id)}`, { headers: control.headers })
  assert.equal(cancelledResult.status, 200)
  assert.equal((await cancelledResult.json()).result.code, 'USER_CANCELLED')

  const deliveredSubmission = await fetch(`${origin}/__harness_mobile__/control/desktop-command`, {
    method: 'POST',
    headers: { ...control.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, command: { action: 'tap', payload: { x: 50, y: 60 } } })
  })
  const deliveredCommand = (await deliveredSubmission.json()).command
  const deliveredPoll = await fetch(`${origin}/__harness_mobile__/control/poll?protocolVersion=1`, { headers: { Cookie: paired.cookie } })
  assert.equal((await deliveredPoll.json()).command.id, deliveredCommand.id)
  await fetch(`${origin}/__harness_mobile__/control/desktop-cancel`, {
    method: 'POST',
    headers: { ...control.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ commandId: deliveredCommand.id })
  })
  const stillPending = await fetch(`${origin}/__harness_mobile__/control/desktop-result?id=${encodeURIComponent(deliveredCommand.id)}`, { headers: control.headers })
  assert.equal(stillPending.status, 202)
  assert.equal((await stillPending.json()).pending, true)
  const cancelPoll = await fetch(`${origin}/__harness_mobile__/control/poll?protocolVersion=1`, { headers: { Cookie: paired.cookie } })
  assert.equal((await cancelPoll.json()).command.type, 'cancel')
  await fetch(`${origin}/__harness_mobile__/control/result`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: deliveredCommand.id, ok: false, code: 'CANCELLED_ON_PHONE' })
  })
  const confirmedCancel = await fetch(`${origin}/__harness_mobile__/control/desktop-result?id=${encodeURIComponent(deliveredCommand.id)}`, { headers: control.headers })
  const confirmedPayload = await confirmedCancel.json()
  assert.equal(confirmedPayload.result.code, 'CANCELLED_ON_PHONE')
  assert.equal(confirmedPayload.result.cancelReason, 'USER_CANCELLED')
  assert.ok(confirmedPayload.result.cancelRequestedAt)
})

test('desktop control bearer is private, rotates per service generation, and is removed on stop', async t => {
  const store = createStore()
  const service = new MobileSyncService({
    store,
    getRuntimeTarget: () => null,
    host: '127.0.0.1',
    port: 0
  })
  t.after(() => service.stop())

  await service.start()
  const first = desktopControlCredentials(service)
  assert.equal(first.state.version, 1)
  assert.equal(first.state.port, service.state().port)
  assert.match(first.state.bearer, /^[A-Za-z0-9_-]{43}$/)
  assert.match(first.state.generation, /^[a-f0-9]{32}$/)
  if (process.platform !== 'win32') assert.equal(statSync(service.desktopControlStateFile).mode & 0o077, 0)

  const firstOrigin = service.state().origins[0]
  assert.equal((await fetch(`${firstOrigin}/__harness_mobile__/control/desktop-state`, { headers: first.headers })).status, 200)
  await service.stop({ persist: false })
  assert.equal(existsSync(service.desktopControlStateFile), false)

  await service.start({ persist: false })
  const second = desktopControlCredentials(service)
  assert.notEqual(second.state.bearer, first.state.bearer)
  assert.notEqual(second.state.generation, first.state.generation)
  const secondOrigin = service.state().origins[0]
  assert.equal((await fetch(`${secondOrigin}/__harness_mobile__/control/desktop-state`, { headers: first.headers })).status, 401)
  assert.equal((await fetch(`${secondOrigin}/__harness_mobile__/control/desktop-state`, { headers: second.headers })).status, 200)
})

test('paired phones can load and update the desktop appearance bridge', async t => {
  const runtime = await createRuntime('official')
  let selected = 'porcelain-mist'
  const appearance = () => ({
    state: { themeId: selected, customTheme: {}, customBackgroundDataUrl: null },
    catalog: [{ id: 'porcelain-mist', name: '青瓷云雾' }]
  })
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => runtime.url,
    host: '127.0.0.1',
    port: 0,
    qrFactory: async () => 'qr',
    getAppearance: async () => appearance(),
    setAppearance: async payload => {
      selected = payload.values.id
      return appearance()
    },
    getThemeScript: async () => 'window.__mobileThemeLoaded=true;',
    readThemeAsset: async relative => ['preview.webp', 'custom-background'].includes(relative)
      ? { data: Buffer.from('theme-asset'), mime: 'image/webp' }
      : null
  })
  t.after(async () => {
    await service.stop()
    await runtime.close()
  })
  await service.start()
  const paired = await pair(service)
  const origin = service.state().origins[0]
  const headers = { Cookie: paired.cookie }

  const initial = await fetch(`${origin}/__harness_mobile__/appearance`, { headers })
  assert.equal(initial.status, 200)
  assert.equal((await initial.json()).state.themeId, 'porcelain-mist')

  const updated = await fetch(`${origin}/__harness_mobile__/appearance`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'set-theme', values: { id: 'official' } })
  })
  assert.equal(updated.status, 200)
  assert.equal((await updated.json()).state.themeId, 'official')

  const script = await fetch(`${origin}/__harness_mobile__/theme.js`, { headers })
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8')
  assert.match(await script.text(), /__mobileThemeLoaded/)

  const asset = await fetch(`${origin}/__harness_mobile__/theme-assets/preview.webp`, { headers })
  assert.equal(asset.headers.get('content-type'), 'image/webp')
  assert.equal(asset.headers.get('cache-control'), 'private, max-age=86400')
  assert.equal(await asset.text(), 'theme-asset')

  const customAsset = await fetch(`${origin}/__harness_mobile__/theme-assets/custom-background`, { headers })
  assert.equal(customAsset.headers.get('cache-control'), 'no-store')
  assert.equal(await customAsset.text(), 'theme-asset')
})

test('desktop mobile state projections never expose mesh or relay secrets', () => {
  const store = createStore()
  const networkSecret = 'n'.repeat(43)
  const relayRoomId = 'r'.repeat(43)
  const relayTunnelKey = 'k'.repeat(43)
  store.ensureMesh(() => ({
    networkName: 'harness-0123456789abcdef',
    networkSecret,
    desktopAddress: '10.254.77.1',
    serviceAddress: '10.253.77.254',
    relayRoomId,
    relayTunnelKey
  }))
  const service = new MobileSyncService({ store, getRuntimeTarget: () => null })
  const projected = JSON.stringify(service.state())
  assert.equal(projected.includes(networkSecret), false)
  assert.equal(projected.includes(relayRoomId), false)
  assert.equal(projected.includes(relayTunnelKey), false)
  assert.equal(projected.includes('mesh'), false)
})
