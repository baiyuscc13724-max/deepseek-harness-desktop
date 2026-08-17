const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')

function installRuntime(fetchImpl) {
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
