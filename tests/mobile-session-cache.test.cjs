'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')
const iosSource = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js'), 'utf8')
const CACHE_IDENTITY = 'a'.repeat(64)
const CACHE_STORAGE_KEY = `harness.mobile.authoritative-index.v1.${CACHE_IDENTITY}`

function storageFixture(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
    value(key) { return values.get(key) }
  }
}

function installRuntime(fetchImpl, storage, { online = true, cacheIdentity = CACHE_IDENTITY } = {}) {
  function DateTimeFormat() {
    if (!new.target) return new DateTimeFormat()
  }
  DateTimeFormat.prototype.resolvedOptions = () => ({ locale: 'en-US', timeZone: 'UTC' })
  const listeners = new Map()
  const documentListeners = new Map()
  const documentElement = { dataset: {}, style: { getPropertyValue: () => '', setProperty() {} }, querySelectorAll: () => [] }
  const document = {
    documentElement,
    visibilityState: 'visible',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, listener) {
      const entries = documentListeners.get(type) || []
      entries.push(listener)
      documentListeners.set(type, entries)
    }
  }
  class MutationObserver { observe() {} }
  class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail }
  }
  class Event {
    constructor(type) { this.type = type }
  }
  class HTMLInputElement {}
  const context = {
    AbortController,
    AbortSignal,
    CustomEvent,
    Event,
    HTMLInputElement,
    HarnessMobileCacheIdentity: cacheIdentity,
    Intl: { DateTimeFormat },
    MutationObserver,
    Promise,
    Request,
    Response,
    URL,
    clearTimeout() {},
    document,
    fetch: fetchImpl,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', getPropertyValue: () => '' }),
    localStorage: storage,
    location: { href: 'https://mobile.test/' },
    navigator: { onLine: online },
    addEventListener(type, listener) {
      const entries = listeners.get(type) || []
      entries.push(listener)
      listeners.set(type, entries)
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter(entry => entry !== listener))
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
    setTimeout(callback) { queueMicrotask(callback); return 1 }
  }
  context.window = context
  vm.runInNewContext(source, context, { filename: 'mobile-runtime.js' })
  return context
}

function responseFor(envelope, items, status = 200) {
  return new Response(JSON.stringify({
    type: 'server-response',
    rpcId: envelope.rpcId,
    result: { ok: true, value: { items } }
  }), { status, headers: { 'content-type': 'application/json' } })
}

async function envelopeFrom(input, init) {
  const request = input instanceof Request ? input.clone() : new Request(input, init)
  return JSON.parse(await request.text())
}

let rpcSequence = 0
function indexRequest(runtime, method, payload = method === 'session/list' ? { args: { _request: {} } } : {}) {
  const rpcId = `rpc-${++rpcSequence}`
  return runtime.fetch(`https://mobile.test/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload })
  })
}

async function settle() {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

test('Android and iOS share the exact project/session cache state machine', () => {
  assert.equal(iosSource, source)
  assert.match(source, /const INDEX_CACHE_VERSION = 1/u)
  assert.match(source, /const INDEX_CACHE_MAX_AGE_MS = 15 \* 60_000/u)
  assert.match(source, /state: 'cache', authoritative: false/u)
  assert.match(source, /state: 'authoritative', authoritative: true/u)
  assert.match(source, /正在恢复最新列表/u)
  assert.doesNotMatch(source, /new Event\('(?:online|focus)'\)/u)
})

test('cold start returns only a recent successful authoritative session cache while refreshing in background', async () => {
  const storage = storageFixture()
  const first = installRuntime(async (input, init) => {
    const envelope = await envelopeFrom(input, init)
    if (envelope.method === 'session/list') return responseFor(envelope, [{ sessionId: 'session-cached', title: 'Cached' }])
    return new Response('', { status: 404 })
  }, storage)
  const initial = await indexRequest(first, 'session/list')
  assert.equal(initial.headers.get('x-harness-mobile-index'), 'authoritative')
  assert.equal((await initial.json()).result.value.items[0].sessionId, 'session-cached')
  assert.match(storage.value(CACHE_STORAGE_KEY), /session-cached/u)

  let releaseRefresh
  const pendingRefresh = new Promise(resolve => { releaseRefresh = resolve })
  const events = []
  const reopened = installRuntime(async (input, init) => {
    const envelope = await envelopeFrom(input, init)
    if (envelope.method === 'session/list') {
      await pendingRefresh
      return responseFor(envelope, [{ sessionId: 'session-fresh', title: 'Fresh' }])
    }
    return new Response('', { status: 404 })
  }, storage)
  reopened.addEventListener('harness-mobile-index-refresh', event => events.push(event.detail))
  const restored = await indexRequest(reopened, 'session/list')
  assert.equal(restored.headers.get('x-harness-mobile-index'), 'recovering')
  assert.equal((await restored.json()).result.value.items[0].sessionId, 'session-cached')
  assert.equal(reopened.document.documentElement.dataset.harnessMobileIndexRecovery, 'session')
  assert.equal(events[0].authoritative, false)
  releaseRefresh()
  await settle()
})

test('background refresh converges a restored cache to the latest authoritative index', async () => {
  const storage = storageFixture()
  const warm = installRuntime(async (input, init) => responseFor(await envelopeFrom(input, init), [{ sessionId: 'session-old' }]), storage)
  await indexRequest(warm, 'session/list')

  const events = []
  const current = installRuntime(async (input, init) => responseFor(await envelopeFrom(input, init), [{ sessionId: 'session-new' }]), storage)
  current.addEventListener('harness-mobile-index-refresh', event => events.push(event.detail))
  const cached = await indexRequest(current, 'session/list')
  assert.equal((await cached.json()).result.value.items[0].sessionId, 'session-old')
  await settle()
  const converged = await indexRequest(current, 'session/list')
  assert.equal(converged.headers.get('x-harness-mobile-index'), 'authoritative')
  assert.equal((await converged.json()).result.value.items[0].sessionId, 'session-new')
  assert.ok(events.some(event => event.state === 'authoritative' && event.itemCount === 1))
  assert.equal(current.document.documentElement.dataset.harnessMobileIndexRecovery, undefined)
})

test('a transiently empty official session/list retains cache without inventing a workspace/list unary retry', async () => {
  const storage = storageFixture()
  const warm = installRuntime(async (input, init) => {
    const envelope = await envelopeFrom(input, init)
    if (envelope.method === 'workspace.list') return responseFor(envelope, [{ workspaceId: 'project-one', title: 'Project' }])
    if (envelope.method === 'session/list') return responseFor(envelope, [{ sessionId: 'session-one', workspaceId: 'project-one' }])
    return new Response('', { status: 404 })
  }, storage)
  await indexRequest(warm, 'workspace.list')
  await indexRequest(warm, 'session/list')

  let sessionCalls = 0
  const recovered = installRuntime(async (input, init) => {
    const envelope = await envelopeFrom(input, init)
    if (envelope.method === 'workspace.list') return responseFor(envelope, [{ workspaceId: 'project-one', title: 'Project' }])
    if (envelope.method === 'session/list') {
      sessionCalls++
      return responseFor(envelope, sessionCalls < 2 ? [] : [{ sessionId: 'session-one', workspaceId: 'project-one' }])
    }
    return new Response('', { status: 404 })
  }, storage)
  await indexRequest(recovered, 'workspace.list')
  const cached = await indexRequest(recovered, 'session/list')
  assert.equal((await cached.json()).result.value.items[0].sessionId, 'session-one')
  await settle()
  assert.equal(sessionCalls, 1)
  const refreshing = await indexRequest(recovered, 'session/list')
  assert.deepEqual((await refreshing.json()).result.value.items, [])
  await settle()
  const stillRecovering = await indexRequest(recovered, 'session/list')
  assert.equal(stillRecovering.headers.get('x-harness-mobile-index'), 'recovering')
  assert.deepEqual((await stillRecovering.json()).result.value.items, [])
  await settle()
  const authoritative = await indexRequest(recovered, 'session/list')
  assert.equal(authoritative.headers.get('x-harness-mobile-index'), 'authoritative')
  assert.equal((await authoritative.json()).result.value.items[0].sessionId, 'session-one')
})

test('offline cache recovery retries once connectivity returns without extending an expired or wrong-version cache', async () => {
  const storage = storageFixture()
  const warm = installRuntime(async (input, init) => responseFor(await envelopeFrom(input, init), [{ sessionId: 'session-offline' }]), storage)
  await indexRequest(warm, 'session/list')

  let online = false
  let calls = 0
  const runtime = installRuntime(async (input, init) => {
    const envelope = await envelopeFrom(input, init)
    calls++
    if (!online) throw new Error('network offline')
    return responseFor(envelope, [{ sessionId: 'session-reconnected' }])
  }, storage, { online: false })
  const cached = await indexRequest(runtime, 'session/list')
  assert.equal((await cached.json()).result.value.items[0].sessionId, 'session-offline')
  await settle()
  online = true
  runtime.navigator.onLine = true
  runtime.dispatchEvent(new runtime.Event('online'))
  await settle()
  const reconnected = await indexRequest(runtime, 'session/list')
  assert.equal((await reconnected.json()).result.value.items[0].sessionId, 'session-reconnected')
  assert.ok(calls >= 2)

  const invalidStorage = storageFixture({
    [CACHE_STORAGE_KEY]: JSON.stringify({
      version: 99,
      pairingIdentity: CACHE_IDENTITY,
      entries: [{ key: 'session:{}', kind: 'session', savedAt: Date.now(), payload: { result: { ok: true, value: { items: [{ sessionId: 'invented' }] } } } }]
    })
  })
  const bounded = installRuntime(async (input, init) => responseFor(await envelopeFrom(input, init), [{ sessionId: 'session-live' }]), invalidStorage)
  const live = await indexRequest(bounded, 'session/list')
  assert.equal(live.headers.get('x-harness-mobile-index'), 'authoritative')
  assert.equal((await live.json()).result.value.items[0].sessionId, 'session-live')
})
