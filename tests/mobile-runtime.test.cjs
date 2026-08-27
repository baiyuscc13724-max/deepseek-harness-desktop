const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')

function installRuntime(fetchImpl, timeZone = 'UTC', platform = '') {
  function DateTimeFormat() {
    if (!new.target) return new DateTimeFormat()
  }
  DateTimeFormat.prototype.resolvedOptions = () => ({ locale: 'en-US', timeZone })
  const documentElement = {
    dataset: {},
    firstElementChild: null,
    querySelectorAll: () => []
  }
  const document = {
    documentElement,
    visibilityState: 'visible',
    querySelectorAll: () => []
  }
  class MutationObserver {
    observe() {}
  }
  class HTMLInputElement {}
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type
      this.detail = init.detail
    }
  }
  const listeners = new Map()
  const context = {
    AbortSignal,
    CustomEvent,
    Error,
    HTMLInputElement,
    Intl: { DateTimeFormat },
    MutationObserver,
    Promise,
    Request,
    Response,
    URL,
    addEventListener: (type, listener) => {
      const entries = listeners.get(type) || []
      entries.push(listener)
      listeners.set(type, entries)
    },
    clearTimeout: () => {},
    dispatchEvent: event => {
      for (const listener of listeners.get(event.type) || []) listener(event)
      return true
    },
    document,
    eval,
    fetch: fetchImpl,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    removeEventListener: (type, listener) => {
      listeners.set(type, (listeners.get(type) || []).filter(entry => entry !== listener))
    },
    setTimeout: callback => {
      queueMicrotask(callback)
      return 1
    }
  }
  if (platform) context.HarnessMobilePlatform = platform
  context.window = context
  vm.runInNewContext(SOURCE, context, { filename: 'mobile-runtime.js' })
  return context
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

test('mobile runtime defaults to Android and gates native-only capabilities on iOS', () => {
  const fetchImpl = async () => new Response('', { status: 404 })
  const android = installRuntime(fetchImpl)
  assert.equal(android.document.documentElement.dataset.harnessMobilePlatform, 'android')
  assert.equal(android.window.__harnessMobileCapabilities.imeSendBridge, true)
  assert.equal(android.window.__harnessMobileCapabilities.nativeImeInsets, true)
  assert.equal(android.window.__harnessMobileCapabilities.screenshotSuggestion, true)
  assert.equal(android.window.__harnessMobileCapabilities.controlSettings, true)

  const ios = installRuntime(fetchImpl, 'UTC', 'ios')
  assert.equal(ios.document.documentElement.dataset.harnessMobilePlatform, 'ios')
  assert.equal(ios.window.__harnessMobileCapabilities.imeSendBridge, false)
  assert.equal(ios.window.__harnessMobileCapabilities.nativeImeInsets, false)
  assert.equal(ios.window.__harnessMobileCapabilities.screenshotSuggestion, false)
  assert.equal(ios.window.__harnessMobileCapabilities.controlSettings, false)
  assert.equal(ios.window.__harnessMobileImeSendBridge, undefined)
  assert.equal(ios.window.__harnessMobileScreenshotSuggestion, undefined)
})

test('mobile runtime normalizes Android offset-only prompt time zones without changing IANA zones', async () => {
  const bodies = []
  const runtime = installRuntime(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/session.prompt')) bodies.push(JSON.parse(init.body))
    return jsonResponse({ result: { ok: true } })
  }, '+00:00')
  assert.equal(runtime.Intl.DateTimeFormat().resolvedOptions().timeZone, 'UTC')
  const prompt = clientTimeZone => JSON.stringify({
    type: 'client-request',
    method: 'session.prompt',
    payload: { sessionId: 'one', content: [], clientTimeZone }
  })
  await runtime.window.fetch('https://mobile.test/api/session.prompt', { method: 'POST', body: prompt('+00:00') })
  await runtime.window.fetch('https://mobile.test/api/session.prompt', { method: 'POST', body: prompt('Asia/Shanghai') })
  assert.equal(bodies[0].payload.clientTimeZone, 'UTC')
  assert.equal(bodies[1].payload.clientTimeZone, 'Asia/Shanghai')
})

test('mobile runtime bounds the first history attempt even without a caller signal', async () => {
  let observedSignal = null
  const runtime = installRuntime(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/api/session.history')) return new Response('', { status: 404 })
    observedSignal = init?.signal || null
    return jsonResponse({ result: { ok: true, value: { events: [] } } })
  })
  const response = await runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST' })
  assert.equal((await response.json()).result.ok, true)
  assert.ok(observedSignal)
})

test('mobile runtime retries session history when the server reports an internal abort', async () => {
  let historyCalls = 0
  const runtime = installRuntime(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/session.history')) {
      historyCalls++
      if (historyCalls === 1) return jsonResponse({ result: { ok: false, error: { code: 'internal', message: 'The user aborted a request.' } } })
      return jsonResponse({ result: { ok: true, value: { events: [] } } })
    }
    return new Response('', { status: 404 })
  })

  const response = await runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST' })
  assert.equal(historyCalls, 2)
  assert.equal((await response.json()).result.ok, true)
})

test('mobile runtime acknowledges unread only after fresh authoritative history for the same session', async () => {
  const runtime = installRuntime(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/api/session.history')) return new Response('', { status: 404 })
    const request = JSON.parse(init.body)
    return jsonResponse({ result: { ok: true, value: { sessionId: request.sessionId, events: [] } } })
  })
  const receipts = []
  runtime.addEventListener('harness-mobile-session-history-receipt', event => receipts.push(event.detail))

  await runtime.window.fetch('https://mobile.test/api/session.history', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'session-one' })
  })

  assert.equal(receipts.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(receipts[0])), {
    sessionId: 'session-one',
    authoritative: true,
    latestLoaded: true
  })
  assert.equal(Object.isFrozen(receipts[0]), true)
})

test('mobile runtime rejects mismatched, missing, failed, and subagent history receipts', async () => {
  const runtime = installRuntime(async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/subagent.history')) {
      return jsonResponse({ result: { ok: true, value: { sessionId: 'subagent-session', events: [] } } })
    }
    if (!url.includes('/api/session.history')) return new Response('', { status: 404 })
    const request = init?.body ? JSON.parse(init.body) : {}
    if (request.sessionId === 'mismatch') return jsonResponse({ result: { ok: true, value: { sessionId: 'other', events: [] } } })
    if (request.sessionId === 'missing-response') return jsonResponse({ result: { ok: true, value: { events: [] } } })
    if (request.sessionId === 'failed') return jsonResponse({ result: { ok: false, error: { code: 'invalid', message: 'failed' } } }, 400)
    return jsonResponse({ result: { ok: true, value: { sessionId: 'response-only', events: [] } } })
  })
  const receipts = []
  runtime.addEventListener('harness-mobile-session-history-receipt', event => receipts.push(event.detail))

  await runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST', body: JSON.stringify({ sessionId: 'mismatch' }) })
  await runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST', body: JSON.stringify({ sessionId: 'missing-response' }) })
  await runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST', body: JSON.stringify({}) })
  await runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST', body: JSON.stringify({ sessionId: 'failed' }) })
  await runtime.window.fetch('https://mobile.test/api/subagent.history', { method: 'POST', body: JSON.stringify({ sessionId: 'subagent-session' }) })

  assert.deepEqual(receipts, [])
})

test('mobile runtime does not acknowledge a stale history fallback', async () => {
  let historyCalls = 0
  const runtime = installRuntime(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/api/session.history')) return new Response('', { status: 404 })
    historyCalls++
    if (historyCalls === 1) return jsonResponse({ result: { ok: true, value: { sessionId: 'stale-session', events: [] } } })
    return jsonResponse({ result: { ok: false, error: { code: 'internal', message: 'temporarily unavailable' } } }, 503)
  })
  const receipts = []
  runtime.addEventListener('harness-mobile-session-history-receipt', event => receipts.push(event.detail))
  const options = { method: 'POST', body: JSON.stringify({ sessionId: 'stale-session' }) }

  await runtime.window.fetch('https://mobile.test/api/session.history', options)
  const stale = await runtime.window.fetch('https://mobile.test/api/session.history', options)

  assert.equal((await stale.json()).result.value.sessionId, 'stale-session')
  assert.equal(historyCalls, 4)
  assert.equal(receipts.length, 1)
})

test('mobile runtime retries subagent history but leaves unrelated requests alone', async () => {
  let subagentCalls = 0
  let otherCalls = 0
  const runtime = installRuntime(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/subagent.history')) {
      subagentCalls++
      if (subagentCalls < 3) return jsonResponse({ result: { ok: false, error: { code: 'internal', message: 'request aborted' } } })
      return jsonResponse({ result: { ok: true, value: { events: [] } } })
    }
    otherCalls++
    return jsonResponse({ ok: true })
  })

  const response = await runtime.window.fetch('https://mobile.test/api/subagent.history', { method: 'POST' })
  assert.equal(subagentCalls, 3)
  assert.equal((await response.json()).result.ok, true)

  await runtime.window.fetch('https://mobile.test/api/session.list')
  assert.equal(otherCalls, 2) // initial theme bridge load plus the explicit request
})

test('mobile runtime never replays a successful history snapshot during quick page switches', async () => {
  let historyCalls = 0
  const runtime = installRuntime(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/session.history')) {
      historyCalls++
      return jsonResponse({ result: { ok: true, value: { events: [{ id: `live-${historyCalls}` }] } } })
    }
    return new Response('', { status: 404 })
  })
  const options = { method: 'POST', body: JSON.stringify({ sessionId: 'one' }) }
  const first = await runtime.window.fetch('https://mobile.test/api/session.history', options)
  const second = await runtime.window.fetch('https://mobile.test/api/session.history', options)
  assert.equal(historyCalls, 2)
  assert.equal((await first.json()).result.value.events[0].id, 'live-1')
  assert.equal((await second.json()).result.value.events[0].id, 'live-2')
})

test('mobile runtime coalesces identical history loads in flight', async () => {
  let historyCalls = 0
  let release
  const pending = new Promise(resolve => { release = resolve })
  const runtime = installRuntime(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/api/session.history')) return new Response('', { status: 404 })
    historyCalls++
    await pending
    return jsonResponse({ result: { ok: true, value: { events: [] } } })
  })
  const options = { method: 'POST', body: JSON.stringify({ sessionId: 'same' }) }
  const first = runtime.window.fetch('https://mobile.test/api/session.history', options)
  const second = runtime.window.fetch('https://mobile.test/api/session.history', options)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(historyCalls, 1)
  release()
  assert.equal((await (await first).json()).result.ok, true)
  assert.equal((await (await second).json()).result.ok, true)
})

test('mobile runtime does not replay a history request cancelled by page navigation', async () => {
  let historyCalls = 0
  const controller = new AbortController()
  controller.abort()
  const runtime = installRuntime(async input => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.includes('/api/session.history')) return new Response('', { status: 404 })
    historyCalls++
    throw new Error('request aborted')
  })
  const receipts = []
  runtime.addEventListener('harness-mobile-session-history-receipt', event => receipts.push(event.detail))
  await assert.rejects(
    runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST', body: JSON.stringify({ sessionId: 'aborted' }), signal: controller.signal }),
    /aborted/
  )
  assert.equal(historyCalls, 1)
  assert.deepEqual(receipts, [])
})

test('document upload uses the authoritative loaded session and appends returned workspace references', async () => {
  const uploads = []
  const runtime = installRuntime(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes('/api/session.history')) {
      return jsonResponse({ result: { ok: true, value: { sessionId: 'session-one', events: [] } } })
    }
    if (url.includes('/__harness_mobile__/documents/upload')) {
      uploads.push({ url, init })
      return jsonResponse({ ok: true, schemaVersion: 1, file: { path: 'uploads/brief.pdf', name: 'brief.pdf', size: 12 } }, 201)
    }
    return new Response('', { status: 404 })
  })
  await runtime.window.fetch('https://mobile.test/api/session.history', {
    method: 'POST',
    body: JSON.stringify({ sessionId: 'session-one' })
  })
  assert.equal(runtime.window.__harnessMobileCurrentSessionId, 'session-one')

  const makeNode = tagName => {
    const listeners = new Map()
    const node = {
      tagName,
      dataset: {},
      children: [],
      parentElement: null,
      textContent: '',
      setAttribute() {},
      addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, []).get(type)).push(listener) },
      dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); return true },
      append(...children) {
        for (const child of children) {
          child.parentElement = node
          node.children.push(child)
        }
      },
      appendChild(child) { node.append(child); return child },
      remove() {
        if (!node.parentElement) return
        node.parentElement.children = node.parentElement.children.filter(child => child !== node)
        node.parentElement = null
      },
      querySelector(selector) {
        const path = selector.match(/data-harness-mobile-document-path="([^"]+)"/)?.[1]
        if (path) return node.children.find(child => child.dataset?.harnessMobileDocumentPath === path) || null
        return null
      }
    }
    Object.defineProperty(node, 'childElementCount', { get: () => node.children.length })
    return node
  }
  class FakeTextarea {
    constructor() { this._value = ''; this.disabled = false; this.readOnly = false }
    get value() { return this._value }
    set value(value) { this._value = String(value) }
    setSelectionRange() {}
    dispatchEvent() { return true }
    focus() {}
  }
  class FakeEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init) }
  }
  const textarea = new FakeTextarea()
  const card = makeNode('div')
  let documentRail = null
  card.querySelector = selector => {
    if (selector === '[data-harness-mobile-document-rail="true"]') return documentRail
    return null
  }
  card.insertBefore = child => {
    child.parentElement = card
    card.children.unshift(child)
    if (child.dataset?.harnessMobileDocumentRail === 'true') documentRail = child
  }
  runtime.HTMLTextAreaElement = FakeTextarea
  runtime.Event = FakeEvent
  runtime.CSS = { escape: value => value }
  runtime.document.querySelector = selector => {
    if (selector === '[data-composer-card] textarea[data-phase]') return textarea
    if (selector === '[data-composer-card]') return card
    return null
  }
  runtime.document.createElement = makeNode

  const states = []
  const file = { name: 'brief.pdf', type: 'application/pdf', size: 12 }
  const accepted = await runtime.window.__harnessMobileReceiveDocuments([file], (...args) => states.push(args))
  assert.equal(accepted, true)
  assert.equal(uploads.length, 1)
  assert.match(uploads[0].url, /sessionId=session-one/u)
  assert.match(uploads[0].url, /name=brief\.pdf/u)
  assert.equal(uploads[0].init.method, 'POST')
  assert.equal(uploads[0].init.credentials, 'same-origin')
  assert.equal(uploads[0].init.headers['X-Harness-Mobile-Request'], 'document-upload')
  assert.equal(uploads[0].init.headers['Content-Type'], 'application/octet-stream')
  assert.equal(uploads[0].init.body, file)
  assert.equal(textarea.value, '请查看文件：@uploads/brief.pdf')
  assert.equal(documentRail?.children.length, 1)
  assert.equal(states.at(-1)?.[0], 'success')

  const removePreview = documentRail.children[0].children[1]
  removePreview.dispatchEvent(new FakeEvent('click'))
  assert.equal(textarea.value, '')
  assert.equal(card.children.length, 0)
})

test('Android WebRTC DataChannel dependency retains its license without adding audio permission', () => {
  const root = path.join(__dirname, '..', 'mobile', 'android', 'app')
  const gradle = fs.readFileSync(path.join(root, 'build.gradle.kts'), 'utf8')
  const manifest = fs.readFileSync(path.join(root, 'src', 'main', 'AndroidManifest.xml'), 'utf8')
  const license = fs.readFileSync(path.join(root, 'src', 'main', 'assets', 'licenses', 'webrtc-BSD-3-Clause-LICENSE.txt'), 'utf8')
  assert.match(gradle, /io\.github\.webrtc-sdk:android:144\.7559\.14/u)
  assert.match(license, /Redistribution and use in source and binary forms/u)
  assert.match(license, /Neither the name of Google Inc\./u)
  assert.match(manifest, /android\.permission\.CAMERA/u)
  assert.match(manifest, /HarnessCaptureActivity/u)
  assert.doesNotMatch(manifest, /android\.permission\.RECORD_AUDIO/u)
})
