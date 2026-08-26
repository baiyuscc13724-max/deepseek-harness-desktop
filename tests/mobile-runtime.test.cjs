const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')

function installRuntime(fetchImpl, timeZone = 'UTC') {
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
  const context = {
    AbortSignal,
    Error,
    HTMLInputElement,
    Intl: { DateTimeFormat },
    MutationObserver,
    Promise,
    Request,
    Response,
    URL,
    clearTimeout: () => {},
    document,
    eval,
    fetch: fetchImpl,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout: callback => {
      queueMicrotask(callback)
      return 1
    }
  }
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
  await assert.rejects(
    runtime.window.fetch('https://mobile.test/api/session.history', { method: 'POST', signal: controller.signal }),
    /aborted/
  )
  assert.equal(historyCalls, 1)
})
