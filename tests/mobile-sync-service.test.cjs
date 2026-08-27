const test = require('node:test')
const assert = require('node:assert/strict')
const { existsSync, mkdtempSync, readFileSync, statSync } = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { WebSocket, WebSocketServer } = require('ws')

const { BROWSER_FORBIDDEN_PORTS, MOBILE_DOCUMENT_MAX_BYTES, MOBILE_DOCUMENT_UPLOAD_CONTRACT, MobileSyncService, browserSafePort, lanAddresses, mobileModelRoutingDto, mobilePluginsDto, mobileProviderMetersDto, safeDeviceName } = require('../electron/bridge/mobile-sync-service.cjs')
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

test('paired phones upload general documents through the official live-session workspace route', async t => {
  const observed = []
  const runtime = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, 'http://runtime.local')
    if (requestUrl.pathname !== '/api/desktop-files/upload' || request.method !== 'POST') {
      response.writeHead(404).end()
      return
    }
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const content = Buffer.concat(chunks)
    const sessionId = requestUrl.searchParams.get('sessionId')
    const name = requestUrl.searchParams.get('name')
    observed.push({ sessionId, name, content, headers: request.headers })
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (sessionId === 'root-session') {
      response.writeHead(201)
      response.end(JSON.stringify({ schemaVersion: 1, file: { path: `uploads/${name}`, name, size: content.length } }))
      return
    }
    if (sessionId === 'malformed-success') {
      response.writeHead(201)
      response.end(JSON.stringify({ schemaVersion: 1, file: { path: 'D:\\Secret\\stolen.pdf', name, size: content.length } }))
      return
    }
    response.writeHead(sessionId === 'too-large-upstream' ? 413 : 409)
    response.end(JSON.stringify({
      code: sessionId === 'too-large-upstream' ? 'FILES_TOO_LARGE' : 'FILES_SESSION_NOT_LIVE',
      error: 'D:\\Private\\workspace must never cross the mobile boundary'
    }))
  })
  await new Promise(resolve => runtime.listen(0, '127.0.0.1', resolve))
  const runtimeUrl = `http://127.0.0.1:${runtime.address().port}`
  const service = new MobileSyncService({
    store: createStore(), getRuntimeTarget: () => runtimeUrl, host: '127.0.0.1', port: 0,
    qrFactory: async () => 'qr'
  })
  t.after(async () => {
    await service.stop()
    await new Promise(resolve => runtime.close(resolve))
  })
  await service.start()
  const origin = service.state().origins[0]
  const endpoint = `${origin}${MOBILE_DOCUMENT_UPLOAD_CONTRACT.path}`
  const bytes = Buffer.from('quarterly report\n', 'utf8')

  assert.equal((await fetch(`${endpoint}?sessionId=root-session&name=report.pdf`, { method: 'POST', body: bytes })).status, 401)
  const paired = await pair(service)
  const cookieHeaders = { Cookie: paired.cookie }
  assert.equal((await fetch(`${endpoint}?sessionId=root-session&name=report.pdf`, { method: 'GET', headers: cookieHeaders })).status, 405)
  assert.equal((await fetch(`${endpoint}?sessionId=root-session&name=report.pdf`, { method: 'POST', headers: cookieHeaders, body: bytes })).status, 403)
  assert.equal((await fetch(`${endpoint}?sessionId=%20root-session&name=report.pdf`, {
    method: 'POST', headers: { ...cookieHeaders, 'X-Harness-Mobile-Request': 'document-upload' }, body: bytes
  })).status, 400)

  const meta = await fetch(`${origin}/__harness_mobile__/meta`, { headers: cookieHeaders })
  assert.deepEqual((await meta.json()).documents, MOBILE_DOCUMENT_UPLOAD_CONTRACT)
  assert.equal(MOBILE_DOCUMENT_UPLOAD_CONTRACT.maxBytes, MOBILE_DOCUMENT_MAX_BYTES)

  const uploaded = await fetch(`${endpoint}?sessionId=root-session&name=${encodeURIComponent('季度报告.pdf')}`, {
    method: 'POST',
    headers: { ...cookieHeaders, 'Content-Type': 'application/pdf', 'X-Harness-Mobile-Request': 'document-upload' },
    body: bytes
  })
  assert.equal(uploaded.status, 201)
  assert.deepEqual(await uploaded.json(), {
    ok: true, schemaVersion: 1, file: { path: 'uploads/季度报告.pdf', name: '季度报告.pdf', size: bytes.length }
  })
  assert.equal(observed.length, 1)
  assert.equal(observed[0].sessionId, 'root-session')
  assert.equal(observed[0].name, '季度报告.pdf')
  assert.deepEqual(observed[0].content, bytes)
  assert.equal(observed[0].headers['content-type'], 'application/octet-stream')
  assert.equal(observed[0].headers.cookie, undefined, 'mobile pairing credentials never reach the official runtime')

  const stale = await fetch(`${endpoint}?sessionId=stale-session&name=secret.pdf`, {
    method: 'POST', headers: { ...cookieHeaders, 'X-Harness-Mobile-Request': 'document-upload' }, body: bytes
  })
  assert.equal(stale.status, 409)
  const staleText = await stale.text()
  assert.match(staleText, /FILES_SESSION_NOT_LIVE/)
  assert.doesNotMatch(staleText, /Private|workspace|[A-Za-z]:\\/)

  const rejectedLarge = await fetch(`${endpoint}?sessionId=too-large-upstream&name=large.pdf`, {
    method: 'POST', headers: { ...cookieHeaders, 'X-Harness-Mobile-Request': 'document-upload' }, body: bytes
  })
  assert.equal(rejectedLarge.status, 413)
  assert.doesNotMatch(await rejectedLarge.text(), /Private|workspace|[A-Za-z]:\\/)

  const malformed = await fetch(`${endpoint}?sessionId=malformed-success&name=stolen.pdf`, {
    method: 'POST', headers: { ...cookieHeaders, 'X-Harness-Mobile-Request': 'document-upload' }, body: bytes
  })
  assert.equal(malformed.status, 502)
  const malformedText = await malformed.text()
  assert.match(malformedText, /DOCUMENT_UPLOAD_REJECTED/)
  assert.doesNotMatch(malformedText, /Secret|stolen\.pdf.*D:|[A-Za-z]:\\/)
})

test('mobile model routing projection bounds provider and model catalogs', () => {
  const dto = mobileModelRoutingDto({
    providers: Array.from({ length: 70 }, (_, provider) => ({
      id: `provider-${provider}`,
      name: `Provider ${provider}`,
      models: Array.from({ length: 300 }, (_, model) => `model-${model}`)
    }))
  })
  assert.equal(dto.providers.length, 64)
  assert.equal(dto.providers.every(provider => provider.models.length === 256), true)
})

test('paired phones receive only a bounded read-only model routing projection', async t => {
  let fail = false
  const secret = 'SECRET_PROVIDER_API_KEY'
  const routing = {
    configured: true,
    main: { provider: 'deepseek', model: 'deepseek-chat', apiKey: secret },
    subagent: { inheritMain: false, provider: 'openai-codex', model: 'gpt-5.6-sol', endpoint: 'https://private.example' },
    basePreset: 'sensitive-preset',
    schema: { hidden: true },
    user: { key: secret },
    providers: [{
      id: 'deepseek',
      name: 'DeepSeek',
      endpoint: 'https://private.example',
      credential: { configured: true },
      models: ['deepseek-chat', 'deepseek-reasoner', 'opaque-model-3']
    }]
  }
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => null,
    getModelRouting: async () => {
      if (fail) throw new Error('settings unavailable')
      return routing
    },
    host: '127.0.0.1',
    port: 0,
    qrFactory: async () => 'qr'
  })
  t.after(() => service.stop())
  await service.start()
  const origin = service.state().origins[0]
  const endpoint = `${origin}/__harness_mobile__/model-routing`
  assert.equal((await fetch(endpoint)).status, 401)

  const paired = await pair(service)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Cookie: paired.cookie } })).status, 405)
  const response = await fetch(endpoint, { headers: { Cookie: paired.cookie } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.deepEqual(Object.keys(payload.routing).sort(), ['configured', 'main', 'providers', 'subagent'])
  assert.deepEqual(Object.keys(payload.routing.main).sort(), ['model', 'provider'])
  assert.deepEqual(Object.keys(payload.routing.subagent).sort(), ['inheritMain', 'model', 'provider'])
  assert.deepEqual(Object.keys(payload.routing.providers[0]).sort(), ['id', 'models', 'name'])
  assert.equal(payload.routing.main.provider, 'deepseek')
  assert.equal(payload.routing.providers[0].models.includes('opaque-model-3'), true, 'model IDs remain opaque catalog data')
  const projected = JSON.stringify(payload)
  assert.equal(projected.includes(secret), false, 'credential values must never enter the mobile DTO')
  for (const forbidden of ['apiKey', 'credential', 'endpoint', 'schema', 'user', 'basePreset', 'private.example']) {
    assert.equal(projected.includes(forbidden), false, `projection must omit ${forbidden}`)
  }

  fail = true
  const failed = await fetch(endpoint, { headers: { Cookie: paired.cookie } })
  assert.equal(failed.status, 503)
  assert.equal(failed.headers.get('cache-control'), 'no-store')
  assert.equal((await failed.text()).includes('deepseek-chat'), false, 'failures never replay a previous ready projection')
  service.revokeDevice(service.state().devices[0].id)
  assert.equal((await fetch(endpoint, { headers: { Cookie: paired.cookie } })).status, 401)
})

test('mobile account and plugin projections are bounded and omit private source fields', () => {
  const meters = mobileProviderMetersDto({
    snapshots: Array.from({ length: 70 }, (_, provider) => ({
      provider: { id: `provider-${provider}`, name: `Provider ${provider}`, credential: 'SECRET' },
      status: provider === 0 ? 'ready' : 'auth-required',
      stale: provider === 1,
      message: 'public reason',
      configPath: 'D:\\Private\\settings.yaml',
      meters: Array.from({ length: 20 }, (_, meter) => ({ kind: 'token-counter', label: `Meter ${meter}`, value: meter, unit: 'tokens', secret: 'SECRET' }))
    }))
  })
  assert.equal(meters.providers.length, 64)
  assert.equal(meters.providers[0].meters.length, 16)
  assert.equal(meters.providers[0].status, 'ready')
  assert.equal(meters.providers[1].status, 'stale')
  assert.equal(meters.providers[2].status, 'unavailable')
  assert.deepEqual(Object.keys(meters.providers[0]).sort(), ['id', 'meters', 'name', 'status', 'unavailableReason'])

  const plugins = mobilePluginsDto({ plugins: Array.from({ length: 140 }, (_, index) => ({
    id: `plugin-${index}`,
    name: `Plugin ${index}`,
    version: '1.2.3',
    enabled: true,
    configurable: index === 0,
    unavailableReason: index === 0 ? 'D:\\Private\\plugin failed' : '',
    apiKey: 'SECRET',
    path: 'D:\\Private\\plugin',
    config: { endpoint: 'https://private.example' }
  })) })
  assert.equal(plugins.plugins.length, 128)
  assert.deepEqual(Object.keys(plugins.plugins[0]).sort(), ['configurable', 'enabled', 'id', 'name', 'unavailableReason', 'version'])
  assert.equal(plugins.plugins[0].configurable, true)
  assert.equal(plugins.plugins[0].unavailableReason, '')
  const projected = JSON.stringify({ meters, plugins })
  for (const forbidden of ['SECRET', 'Private', 'settings.yaml', 'apiKey', 'configPath', 'private.example']) {
    assert.equal(projected.includes(forbidden), false, `mobile projections must omit ${forbidden}`)
  }
})

test('paired phones receive GET-only no-store account meters and plugin inventory', async t => {
  let failMeters = false
  let failPlugins = false
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => null,
    getProviderMeters: async () => {
      if (failMeters) throw new Error('D:\\Private\\meter-source failed with SECRET')
      return { snapshots: [{
        provider: { id: 'deepseek', name: 'DeepSeek', apiKey: 'SECRET' },
        status: 'ready',
        stale: false,
        message: '',
        meters: [{ kind: 'balance', label: '余额', total: 12.5, currency: 'CNY', credential: 'SECRET' }]
      }] }
    },
    getPlugins: async () => {
      if (failPlugins) throw new Error('D:\\Private\\plugin-source failed with SECRET')
      return { plugins: [{
        id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', version: '0.1.1-rc.2', enabled: true, configurable: true,
        unavailableReason: '', path: 'D:\\Private\\plugin', config: { secret: 'SECRET' }
      }] }
    },
    host: '127.0.0.1',
    port: 0,
    qrFactory: async () => 'qr'
  })
  t.after(() => service.stop())
  await service.start()
  const origin = service.state().origins[0]
  const metersEndpoint = `${origin}/__harness_mobile__/provider-meters`
  const pluginsEndpoint = `${origin}/__harness_mobile__/plugins`
  assert.equal((await fetch(metersEndpoint)).status, 401)
  assert.equal((await fetch(pluginsEndpoint)).status, 401)

  const paired = await pair(service)
  for (const endpoint of [metersEndpoint, pluginsEndpoint]) {
    const rejected = await fetch(endpoint, { method: 'POST', headers: { Cookie: paired.cookie } })
    assert.equal(rejected.status, 405)
    assert.equal(rejected.headers.get('allow'), 'GET')
    assert.equal(rejected.headers.get('cache-control'), 'no-store')
  }

  const metersResponse = await fetch(metersEndpoint, { headers: { Cookie: paired.cookie } })
  assert.equal(metersResponse.status, 200)
  assert.equal(metersResponse.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await metersResponse.json(), {
    ok: true,
    providers: [{ id: 'deepseek', name: 'DeepSeek', status: 'ready', meters: ['余额: 12.5 CNY'], unavailableReason: '' }]
  })
  const pluginsResponse = await fetch(pluginsEndpoint, { headers: { Cookie: paired.cookie } })
  assert.equal(pluginsResponse.status, 200)
  assert.equal(pluginsResponse.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await pluginsResponse.json(), {
    ok: true,
    plugins: [{ id: 'agent-loop', name: '@deepseek-ai/dsh-agent-loop', version: '0.1.1-rc.2', enabled: true, configurable: true, unavailableReason: '' }]
  })

  failMeters = true
  failPlugins = true
  for (const endpoint of [metersEndpoint, pluginsEndpoint]) {
    const failed = await fetch(endpoint, { headers: { Cookie: paired.cookie } })
    assert.equal(failed.status, 503)
    assert.equal(failed.headers.get('cache-control'), 'no-store')
    const text = await failed.text()
    assert.equal(text.includes('SECRET'), false)
    assert.equal(text.includes('Private'), false)
  }
})

test('paired mobile devices can request the desktop-owned workspace picker without supplying a path', async t => {
  const runtime = await createRuntime('official-workspace')
  const requests = []
  let releasePicker
  const pickerPending = new Promise(resolve => { releasePicker = resolve })
  const service = new MobileSyncService({
    store: createStore(),
    getRuntimeTarget: () => runtime.url,
    host: '127.0.0.1',
    port: 0,
    qrFactory: async value => `qr:${value}`,
    chooseWorkspaceDirectory: async request => {
      requests.push(request)
      return pickerPending
    }
  })
  t.after(async () => {
    releasePicker?.(null)
    await service.stop()
    await runtime.close()
  })
  await service.start()
  const origin = service.state().origins[0]
  const paired = await pair(service)
  const endpoint = `${origin}/__harness_mobile__/workspace/choose`

  assert.equal((await fetch(endpoint, { method: 'POST' })).status, 401)
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { Cookie: paired.cookie } })).status, 403)
  const pending = fetch(endpoint, {
    method: 'POST',
    headers: {
      Cookie: paired.cookie,
      'Content-Type': 'application/json',
      'X-Harness-Mobile-Request': 'workspace-picker'
    },
    body: '{}'
  })
  await new Promise(resolve => setImmediate(resolve))
  const duplicate = await fetch(endpoint, {
    method: 'POST',
    headers: { Cookie: paired.cookie, 'X-Harness-Mobile-Request': 'workspace-picker' }
  })
  assert.equal(duplicate.status, 409)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].deviceId, service.state().devices[0].id)
  releasePicker('D:\\Projects\\Harness')
  const response = await pending
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, path: 'D:\\Projects\\Harness' })
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

test('mobile pairing never advertises a browser-forbidden port', () => {
  for (const port of [1, 21, 2049, 6000, 6667, 10080]) {
    assert.equal(BROWSER_FORBIDDEN_PORTS.has(port), true)
    assert.equal(browserSafePort(port), false)
  }
  assert.equal(browserSafePort(0), false)
  assert.equal(browserSafePort(49152), true)
  assert.equal(browserSafePort(65535), true)
})

test('a persisted forbidden mobile port is replaced with a safe ephemeral listener', async t => {
  const service = new MobileSyncService({
    store: createStore(), getRuntimeTarget: () => null, host: '127.0.0.1', port: 6000,
    qrFactory: async value => `qr:${value}`
  })
  t.after(() => service.stop())
  await service.start()
  assert.equal(browserSafePort(service.state().port), true)
  assert.notEqual(service.state().port, 6000)
})

test('LAN address selection prefers physical private IPv4 interfaces', () => {
  const result = lanAddresses({
    singbox_tun: [{ family: 'IPv4', internal: false, address: '172.18.0.1' }],
    'TAP-Windows Adapter V9': [{ family: 'IPv4', internal: false, address: '10.8.0.1' }],
    'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.0.1' }],
    WiFi: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }],
    Public: [{ family: 'IPv4', internal: false, address: '8.8.8.8' }]
  })
  assert.deepEqual(result, ['192.168.1.20', '172.18.0.1', '10.8.0.1', '172.20.0.1'])
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

test('relay address changes invalidate stale pairing and flag existing devices for an update', async () => {
  const store = createStore()
  store.addDevice({
    id: '0123456789abcdef', secretHash: 'a'.repeat(64), name: 'Existing phone', platform: 'android', deviceClass: 'phone',
    createdAt: new Date(0).toISOString(), lastSeenAt: new Date(0).toISOString()
  })
  let relayConfig = { enabled: false, relayUrl: '', source: 'disabled', checkedAt: null }
  const relayConfigStore = {
    get: () => relayConfig,
    async set() { relayConfig = { enabled: true, relayUrl: 'wss://relay.example.test/', source: 'user', checkedAt: new Date().toISOString() }; return relayConfig },
    clear() { relayConfig = { enabled: false, relayUrl: '', source: 'disabled', checkedAt: null }; return relayConfig }
  }
  const configured = []
  const transportManager = {
    state: () => ({ enabled: true, status: 'stopped', active: null, adapters: [] }),
    on() {},
    async configureWssRelay(value) { configured.push(value) }
  }
  const service = new MobileSyncService({ store, getRuntimeTarget: () => null, relayConfigStore, transportManager })
  service.pairing = { expiresAt: Date.now() + 60_000, url: 'http://127.0.0.1/old-pairing' }

  const saved = await service.setRelayConfig('relay.example.test')
  assert.equal(saved.pairing, null)
  assert.equal(saved.relay.requiresDeviceUpdate, true)
  assert.equal(saved.relay.relayUrl, 'wss://relay.example.test/')
  assert.deepEqual(configured, ['wss://relay.example.test/'])

  service.pairing = { expiresAt: Date.now() + 60_000, url: 'http://127.0.0.1/current-pairing' }
  const unchanged = await service.setRelayConfig('relay.example.test')
  assert.equal(unchanged.pairing.url, 'http://127.0.0.1/current-pairing')
  assert.deepEqual(configured, ['wss://relay.example.test/'])

  const cleared = await service.clearRelayConfig()
  assert.equal(cleared.pairing, null)
  assert.equal(cleared.relay.requiresDeviceUpdate, true)
  assert.equal(cleared.relay.relayUrl, '')
  assert.deepEqual(configured, ['wss://relay.example.test/', ''])

  service.revokeDevice('0123456789abcdef')
  assert.equal(service.state().relay.requiresDeviceUpdate, false)
})

test('relay address changes do not request a device update when no device is paired', async () => {
  const store = createStore()
  let relayConfig = { enabled: false, relayUrl: '', source: 'disabled', checkedAt: null }
  const relayConfigStore = {
    get: () => relayConfig,
    async set() { relayConfig = { enabled: true, relayUrl: 'wss://relay.example.test/', source: 'user', checkedAt: new Date().toISOString() }; return relayConfig }
  }
  const service = new MobileSyncService({ store, getRuntimeTarget: () => null, relayConfigStore })
  const state = await service.setRelayConfig('relay.example.test')
  assert.equal(state.relay.requiresDeviceUpdate, false)
  store.addDevice({
    id: 'fedcba9876543210', secretHash: 'b'.repeat(64), name: 'New phone', platform: 'android', deviceClass: 'phone',
    createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString()
  })
  assert.equal(service.state().relay.requiresDeviceUpdate, false)
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
