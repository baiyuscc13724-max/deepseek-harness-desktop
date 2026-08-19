const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync } = require('node:fs')
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

function createStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'harness-mobile-service-'))
  return new MobileSyncStore(path.join(directory, 'mobile-sync.json'))
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
    id: 'wss-relay', origin: 'http://10.252.77.254:3081', relayUrl: 'wss://relay.example.test/',
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
  assert.equal(forbidden.status, 403)

  const submitted = await fetch(`${origin}/__harness_mobile__/control/desktop-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Harness-Mobile-Control': '1' },
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
