const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
const { BrowserControlServer, MAX_RECENT_REQUESTS, isLoopback, requestFingerprint } = require('../electron/bridge/browser-control-server.cjs')

async function waitFor(predicate, message, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setImmediate(resolve))
  }
}

test('browser tool bridge uses a random bearer token and loopback-only endpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-server-'))
  const stateFile = path.join(root, 'state', 'browser.json')
  const received = []
  const server = new BrowserControlServer({ stateFile, handler: async body => { received.push(body); return { action: body.action } } })
  try {
    const publicState = await server.start()
    assert.equal(publicState.origin.startsWith('http://127.0.0.1:'), true)
    assert.equal('token' in publicState, false)
    const secretState = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.ok(secretState.token.length >= 40)
    const denied = await fetch(`${secretState.origin}/action`, { method: 'POST', body: '{}' })
    assert.equal(denied.status, 401)
    const accepted = await fetch(`${secretState.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    })
    assert.equal(accepted.status, 200)
    assert.deepEqual((await accepted.json()).result, { action: 'status' })
    assert.deepEqual(received, [{ action: 'status' }])
    await server.stop()
    await assert.rejects(() => access(stateFile), error => error?.code === 'ENOENT')
    await assert.rejects(() => fetch(`${secretState.origin}/action`, { method: 'POST', headers: { Authorization: `Bearer ${secretState.token}` }, body: '{}' }))
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent starts share one endpoint and stale token files are removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-restart-'))
  const stateDirectory = path.join(root, 'state')
  const stateFile = path.join(stateDirectory, 'browser.json')
  await mkdir(stateDirectory, { recursive: true })
  await writeFile(`${stateFile}.123.456.tmp`, JSON.stringify({ token: 'stale-secret' }))
  await writeFile(path.join(stateDirectory, 'browser.json.keep.tmp'), 'keep')
  const server = new BrowserControlServer({ stateFile, handler: async () => ({ ok: true }) })
  try {
    const [left, right] = await Promise.all([server.start(), server.start()])
    assert.equal(left.origin, right.origin)
    assert.equal((await readdir(stateDirectory)).includes('browser.json.123.456.tmp'), false)
    assert.equal((await readdir(stateDirectory)).includes('browser.json.keep.tmp'), true)
    const firstSecret = JSON.parse(await readFile(stateFile, 'utf8'))
    await server.stop()
    await server.start()
    const secondSecret = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.notEqual(secondSecret.token, firstSecret.token)
    const denied = await fetch(`${secondSecret.origin}/action`, { method: 'POST', headers: { Authorization: `Bearer ${firstSecret.token}` }, body: '{}' })
    assert.equal(denied.status, 401)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('startup failure closes its listener and removes token artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-failure-'))
  const stateFile = path.join(root, 'browser.json')
  await mkdir(stateFile, { recursive: true })
  const server = new BrowserControlServer({ stateFile, handler: async () => ({ ok: true }) })
  try {
    await assert.rejects(() => server.start())
    assert.equal(server.state().running, false)
    assert.equal(server.state().origin, '')
    assert.equal((await readdir(root)).some(name => /^browser\.json\.\d+\.\d+\.tmp$/.test(name)), false)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('stop destroys active authorized connections before their handler can finish', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-active-'))
  const stateFile = path.join(root, 'browser.json')
  let enterHandler
  let releaseHandler
  const entered = new Promise(resolve => { enterHandler = resolve })
  const release = new Promise(resolve => { releaseHandler = resolve })
  const server = new BrowserControlServer({ stateFile, handler: async () => { enterHandler(); await release; return { completed: true } } })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const request = fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    }).then(response => response.status).catch(() => 'closed')
    await entered
    await server.stop()
    releaseHandler()
    assert.equal(await request, 'closed')
    assert.equal(server.state().running, false)
  } finally {
    releaseHandler?.()
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('restart clears stale queue tails even when an old handler ignores cancellation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-stale-tail-'))
  const stateFile = path.join(root, 'state.json')
  let oldEntered
  const entered = new Promise(resolve => { oldEntered = resolve })
  const never = new Promise(() => {})
  const calls = []
  const server = new BrowserControlServer({
    stateFile,
    handler: async body => {
      calls.push(body.action)
      if (body.action === 'wait') {
        oldEntered()
        await never
      }
      return { action: body.action }
    }
  })
  try {
    await server.start()
    let secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const oldRequest = fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'wait', request_id: 'stale_tail_wait_001' })
    }).catch(() => null)
    await entered
    await server.stop()
    await oldRequest

    await server.start()
    secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const response = await fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', request_id: 'fresh_click_after_restart' }),
      signal: AbortSignal.timeout(1_000)
    })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, ['wait', 'click'])
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('state-changing browser actions are serialized and carry stable request ids', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-queue-'))
  const stateFile = path.join(root, 'browser.json')
  const order = []
  let releaseFirst
  let firstEntered
  const entered = new Promise(resolve => { firstEntered = resolve })
  const firstRelease = new Promise(resolve => { releaseFirst = resolve })
  const contexts = []
  const server = new BrowserControlServer({
    stateFile,
    handler: async (body, context) => {
      contexts.push(context.requestId)
      order.push(`start:${body.action}`)
      if (body.action === 'navigate') {
        firstEntered()
        await firstRelease
      }
      order.push(`end:${body.action}`)
      return { action: body.action }
    }
  })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const headers = { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' }
    const first = fetch(`${secret.origin}/action`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'navigate', request_id: 'request_nav_001' })
    })
    await entered
    const second = fetch(`${secret.origin}/action`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'click', request_id: 'request_click_001' })
    })
    await waitFor(() => server.activeRequests.size === 2, 'second browser action did not reach the server')
    assert.deepEqual(order, ['start:navigate'])
    releaseFirst()
    const [firstResponse, secondResponse] = await Promise.all([first, second])
    assert.equal(firstResponse.status, 200)
    assert.equal(secondResponse.status, 200)
    assert.deepEqual(order, ['start:navigate', 'end:navigate', 'start:click', 'end:click'])
    assert.deepEqual(contexts, ['request_nav_001', 'request_click_001'])
    assert.equal((await firstResponse.json()).requestId, 'request_nav_001')
    assert.equal((await secondResponse.json()).requestId, 'request_click_001')
  } finally {
    releaseFirst?.()
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('model stop bypasses the queue and aborts an in-flight action', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-stop-'))
  const stateFile = path.join(root, 'browser.json')
  let slowEntered
  const entered = new Promise(resolve => { slowEntered = resolve })
  const enteredActions = []
  const server = new BrowserControlServer({
    stateFile,
    handler: async (body, context) => {
      if (body.action === 'stop') return { stopped: true }
      enteredActions.push(body.action)
      if (body.action === 'wait') {
        slowEntered()
        await new Promise((resolve, reject) => {
          const cancelled = () => reject(Object.assign(new Error('cancelled'), { code: 'browser-action-cancelled' }))
          if (context.signal.aborted) cancelled()
          else context.signal.addEventListener('abort', cancelled, { once: true })
        })
      }
      return { completed: true }
    }
  })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const headers = { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' }
    const slow = fetch(`${secret.origin}/action`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'wait', request_id: 'request_wait_001' })
    })
    await entered
    const queued = fetch(`${secret.origin}/action`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'click', request_id: 'request_queued_click' })
    })
    await waitFor(() => server.activeRequests.size === 2, 'queued browser action did not reach the server')
    assert.deepEqual(enteredActions, ['wait'])
    const stopped = await fetch(`${secret.origin}/action`, {
      method: 'POST', headers,
      body: JSON.stringify({ action: 'stop', request_id: 'request_stop_001' })
    })
    assert.equal(stopped.status, 200)
    assert.equal((await stopped.json()).result.stopped, true)
    const cancelled = await slow
    assert.equal(cancelled.status, 499)
    assert.equal((await cancelled.json()).code, 'browser-action-cancelled')
    assert.equal((await queued).status, 499)
    assert.deepEqual(enteredActions, ['wait'])
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('browser, computer and memory queues stay isolated and stop cancels only its own scope', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-scopes-'))
  const stateFile = path.join(root, 'browser.json')
  let browserEntered
  let browserAborted = false
  const entered = new Promise(resolve => { browserEntered = resolve })
  const server = new BrowserControlServer({
    stateFile,
    handler: async (body, context) => {
      if (context.scope === 'browser' && body.action === 'wait') {
        browserEntered()
        await new Promise((resolve, reject) => {
          context.signal.addEventListener('abort', () => {
            browserAborted = true
            reject(Object.assign(new Error('cancelled'), { code: 'browser-action-cancelled' }))
          }, { once: true })
        })
      }
      return { scope: context.scope, action: body.action }
    }
  })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const headers = { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' }
    const post = body => fetch(`${secret.origin}/action`, { method: 'POST', headers, body: JSON.stringify(body) })
    const browserWait = post({ action: 'wait', request_id: 'scope_browser_wait' })
    await entered

    const computerAction = await post({ scope: 'computer', action: 'click', request_id: 'scope_computer_click' })
    assert.equal(computerAction.status, 200)
    assert.deepEqual((await computerAction.json()).result, { scope: 'computer', action: 'click' })

    const memoryAction = await post({ scope: 'memory', action: 'remember', request_id: 'scope_memory_remember' })
    assert.equal(memoryAction.status, 200)
    assert.deepEqual((await memoryAction.json()).result, { scope: 'memory', action: 'remember' })

    const computerStop = await post({ scope: 'computer', action: 'stop', request_id: 'scope_computer_stop' })
    assert.equal(computerStop.status, 200)
    assert.equal(browserAborted, false)

    const browserStop = await post({ action: 'stop', request_id: 'scope_browser_stop' })
    assert.equal(browserStop.status, 200)
    assert.equal(browserAborted, true)
    assert.equal((await browserWait).status, 499)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('scope stop epochs reject slow pre-stop browser bodies without cancelling computer bodies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-stop-epoch-'))
  const stateFile = path.join(root, 'state.json')
  const calls = []
  const server = new BrowserControlServer({
    stateFile,
    handler: async (body, context) => {
      calls.push(`${context.scope}:${body.action}`)
      return { scope: context.scope, action: body.action, stopped: body.action === 'stop' }
    }
  })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const target = new URL('/action', secret.origin)
    const headersFor = body => ({
      Authorization: `Bearer ${secret.token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    })
    const beginPartial = body => {
      let request
      const completed = new Promise((resolve, reject) => {
        request = http.request({
          hostname: target.hostname,
          port: target.port,
          path: target.pathname,
          method: 'POST',
          headers: headersFor(body)
        }, response => {
          const chunks = []
          response.on('data', chunk => chunks.push(chunk))
          response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
        })
        request.on('error', reject)
      })
      const split = Math.max(1, Math.floor(body.length / 2))
      request.write(body.slice(0, split))
      return { request, remainder: body.slice(split), completed }
    }

    const slowBrowser = beginPartial(JSON.stringify({ action: 'click', request_id: 'slow_browser_before_stop' }))
    const slowComputer = beginPartial(JSON.stringify({ scope: 'computer', action: 'click', request_id: 'slow_computer_before_stop' }))
    await waitFor(() => server.activeRequests.size === 2, 'slow request bodies did not reach the server')

    const stopped = await fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', request_id: 'scope_epoch_browser_stop' })
    })
    assert.equal(stopped.status, 200)

    slowBrowser.request.end(slowBrowser.remainder)
    slowComputer.request.end(slowComputer.remainder)
    const [browserResult, computerResult] = await Promise.all([slowBrowser.completed, slowComputer.completed])
    assert.equal(browserResult.status, 499)
    assert.equal(browserResult.body.code, 'browser-action-cancelled')
    assert.equal(computerResult.status, 200)
    assert.deepEqual(calls, ['browser:stop', 'computer:click'])

    const blocked = await fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', request_id: 'browser_while_stopped' })
    })
    assert.equal(blocked.status, 409)
    assert.equal((await blocked.json()).code, 'stopped')

    server.resumeScope('browser')
    const resumed = await fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', request_id: 'browser_after_resume' })
    })
    assert.equal(resumed.status, 200)
    assert.deepEqual(calls, ['browser:stop', 'computer:click', 'browser:click'])
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid browser request ids are rejected before dispatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-request-id-'))
  const stateFile = path.join(root, 'browser.json')
  let calls = 0
  const server = new BrowserControlServer({ stateFile, handler: async () => { calls += 1; return {} } })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const response = await fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'click', request_id: '../bad' })
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'browser-request-id-invalid')
    assert.equal(calls, 0)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('emergency stop bypasses a saturated replay cache', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-stop-capacity-'))
  const stateFile = path.join(root, 'state.json')
  let stopCalls = 0
  const server = new BrowserControlServer({
    stateFile,
    handler: async body => {
      if (body.action === 'stop') stopCalls += 1
      return { stopped: body.action === 'stop' }
    }
  })
  try {
    await server.start()
    const pending = new Promise(() => {})
    for (let index = 0; index < MAX_RECENT_REQUESTS; index += 1) {
      server.recentRequests.set(`occupied_${index}`, { fingerprint: `digest_${index}`, promise: pending, settled: false })
    }
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const response = await fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', request_id: 'emergency_stop_capacity' })
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).result.stopped, true)
    assert.equal(stopCalls, 1)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('client disconnect aborts the handler signal before a side effect can run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-disconnect-'))
  const stateFile = path.join(root, 'browser.json')
  let enterHandler
  let observeAbort
  let sideEffects = 0
  const entered = new Promise(resolve => { enterHandler = resolve })
  const aborted = new Promise(resolve => { observeAbort = resolve })
  const server = new BrowserControlServer({
    stateFile,
    handler: async (_body, context) => {
      enterHandler()
      await new Promise(resolve => {
        const cancel = () => { observeAbort(); resolve() }
        if (context.signal.aborted) cancel()
        else context.signal.addEventListener('abort', cancel, { once: true })
      })
      if (!context.signal.aborted) sideEffects += 1
      return { completed: true }
    }
  })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const target = new URL('/action', secret.origin)
    const body = JSON.stringify({ action: 'wait', request_id: 'request_disconnect_001' })
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret.token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    })
    request.on('error', () => {})
    request.end(body)
    await entered
    request.destroy()
    await aborted
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(sideEffects, 0)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('replayed request ids reuse one result and conflicting payloads are rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-idempotency-'))
  const stateFile = path.join(root, 'browser.json')
  let calls = 0
  const server = new BrowserControlServer({
    stateFile,
    handler: async body => ({ call: ++calls, value: body.payload?.value })
  })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const headers = { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' }
    const post = body => fetch(`${secret.origin}/action`, { method: 'POST', headers, body: JSON.stringify(body) })
    const request = { action: 'click', payload: { value: 7, ref: 'b1' }, request_id: 'request_replay_001' }
    const first = await post(request)
    const replay = await post({ request_id: 'request_replay_001', payload: { ref: 'b1', value: 7 }, action: 'click', scope: 'browser' })
    assert.equal(first.status, 200)
    assert.equal(replay.status, 200)
    assert.deepEqual((await first.json()).result, { call: 1, value: 7 })
    assert.deepEqual((await replay.json()).result, { call: 1, value: 7 })
    assert.equal(calls, 1)

    const conflict = await post({ action: 'click', payload: { value: 8, ref: 'b1' }, request_id: 'request_replay_001' })
    assert.equal(conflict.status, 409)
    assert.equal((await conflict.json()).code, 'browser-request-id-conflict')
    assert.equal(calls, 1)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('request replay metadata stores only a digest and read-only responses are never retained', async () => {
  const fingerprint = requestFingerprint({ action: 'type', payload: { text: 'private form value' } }, 'browser')
  assert.match(fingerprint, /^[A-Za-z0-9_-]{43}$/u)
  assert.doesNotMatch(fingerprint, /private|form|value/u)

  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-read-replay-'))
  const stateFile = path.join(root, 'browser.json')
  let calls = 0
  const server = new BrowserControlServer({ stateFile, handler: async () => ({ call: ++calls }) })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const request = () => fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'screenshot', request_id: 'request_read_only_001' })
    })
    assert.equal((await (await request()).json()).result.call, 1)
    assert.equal((await (await request()).json()).result.call, 2)
    assert.equal(server.recentRequests.size, 0)

    const memoryRequest = () => fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'memory', action: 'remember', request_id: 'request_memory_write_001' })
    })
    assert.equal((await (await memoryRequest()).json()).result.call, 3)
    assert.equal((await (await memoryRequest()).json()).result.call, 4)
    assert.equal(server.recentRequests.size, 0)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('loopback address policy is exact', () => {
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('::ffff:127.0.0.1'), true)
  assert.equal(isLoopback('192.168.1.5'), false)
})
