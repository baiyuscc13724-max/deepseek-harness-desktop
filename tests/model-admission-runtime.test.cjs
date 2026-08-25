const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-model-admission', 'lib', 'index.js')

async function plugin() {
  return import(`${pathToFileURL(pluginFile).href}?test=${Date.now()}-${Math.random()}`)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function collect(iterable) {
  const values = []
  for await (const value of iterable) values.push(value)
  return values
}

function fakeContext(sessions = []) {
  const listeners = new Map()
  const cleanups = []
  const sessionMap = new Map(sessions.map(session => [session.id, session]))
  return {
    listeners,
    cleanups,
    sessions: { get: id => sessionMap.get(id) },
    effect(setup) {
      const cleanup = setup()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return cleanup
    },
    on(name, listener, options) {
      listeners.set(name, { listener, options })
      return () => listeners.delete(name)
    }
  }
}

function session(id, parentSession) {
  return { id, header: parentSession === undefined ? {} : { parentSession } }
}

test('defaults, hard maximums, and cross-queue configuration bounds are enforced', async () => {
  const mod = await plugin()
  assert.deepEqual(mod.resolveConfig(), {
    maxActive: 8,
    maxQueued: 32,
    maxQueuedPerRoot: 8,
    waitMs: 30_000
  })
  assert.deepEqual(mod.resolveConfig({ maxActive: 3, maxQueued: 9, maxQueuedPerRoot: 2, waitMs: 500 }), {
    maxActive: 3,
    maxQueued: 9,
    maxQueuedPerRoot: 2,
    waitMs: 500
  })
  assert.deepEqual(mod.resolveConfig({
    maxActive: mod.MAX_ACTIVE_LIMIT,
    maxQueued: mod.MAX_QUEUED_LIMIT,
    maxQueuedPerRoot: mod.MAX_QUEUED_PER_ROOT_LIMIT,
    waitMs: mod.MAX_WAIT_MS_LIMIT
  }), {
    maxActive: 64,
    maxQueued: 4_096,
    maxQueuedPerRoot: 512,
    waitMs: 600_000
  })
  for (const [field, value] of [
    ['maxActive', 0],
    ['maxActive', mod.MAX_ACTIVE_LIMIT + 1],
    ['maxQueued', 1.5],
    ['maxQueued', mod.MAX_QUEUED_LIMIT + 1],
    ['maxQueuedPerRoot', -1],
    ['maxQueuedPerRoot', mod.MAX_QUEUED_PER_ROOT_LIMIT + 1],
    ['waitMs', mod.MAX_WAIT_MS_LIMIT + 1]
  ]) {
    assert.throws(() => mod.resolveConfig({ [field]: value }), new RegExp(field))
  }
  assert.throws(
    () => mod.resolveConfig({ maxQueued: 10, maxQueuedPerRoot: 11 }),
    /maxQueuedPerRoot must not exceed maxQueued/u
  )
})

test('root keys have a fixed maximum length before queue metadata is allocated', async () => {
  const { createModelAdmission, MAX_ROOT_KEY_LENGTH } = await plugin()
  const admission = createModelAdmission()
  const release = await admission.acquire('r'.repeat(MAX_ROOT_KEY_LENGTH))
  release()
  assert.throws(
    () => admission.acquire('r'.repeat(MAX_ROOT_KEY_LENGTH + 1)),
    new RegExp(`rootKey.*${MAX_ROOT_KEY_LENGTH}`)
  )
  assert.equal(admission.snapshot().active, 0)
  assert.equal(admission.snapshot().queued, 0)
  admission.close()
})

test('parent-session cycles normalize to the same smallest stable key from every entry point', async () => {
  const mod = await plugin()
  const ctx = fakeContext([
    session('cycle-z', 'cycle-m'),
    session('cycle-m', 'cycle-a'),
    session('cycle-a', 'cycle-z'),
    session('cycle-tail', 'cycle-m')
  ])
  const fromZ = mod.resolveRootKey(ctx, 'cycle-z')
  const fromM = mod.resolveRootKey(ctx, 'cycle-m')
  const fromA = mod.resolveRootKey(ctx, 'cycle-a')
  const fromTail = mod.resolveRootKey(ctx, 'cycle-tail')
  assert.deepEqual([fromZ, fromM, fromA, fromTail], ['cycle-a', 'cycle-a', 'cycle-a', 'cycle-a'])

  const admission = mod.createModelAdmission({ maxActive: 1, maxQueued: 4, maxQueuedPerRoot: 1, waitMs: 1_000 })
  const activeRelease = await admission.acquire(fromZ)
  const waiting = admission.acquire(fromM)
  await assert.rejects(admission.acquire(fromA), error => error?.code === mod.ERROR_CODES.queueFull)
  activeRelease()
  const waitingRelease = await waiting
  waitingRelease()
  admission.close()

  const oversizedParent = fakeContext([session('bounded-child', 'p'.repeat(mod.MAX_ROOT_KEY_LENGTH + 1))])
  assert.throws(() => mod.resolveRootKey(oversizedParent, 'bounded-child'), /rootKey/u)
})

test('admission is globally bounded, FIFO within roots, and round-robin across roots', async () => {
  const { createModelAdmission } = await plugin()
  const admission = createModelAdmission({ maxActive: 1, maxQueued: 8, maxQueuedPerRoot: 4, waitMs: 1_000 })
  const firstRelease = await admission.acquire('root-a')
  const order = []
  const wait = (rootKey, label) => admission.acquire(rootKey).then(release => {
    order.push(label)
    return release
  })
  const a2 = wait('root-a', 'a-2')
  const b1 = wait('root-b', 'b-1')
  const a3 = wait('root-a', 'a-3')
  const b2 = wait('root-b', 'b-2')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [])
  assert.deepEqual(admission.snapshot(), {
    active: 1,
    queued: 4,
    rootCount: 2,
    closed: false,
    maxActive: 1,
    maxQueued: 8,
    maxQueuedPerRoot: 4,
    waitMs: 1_000
  })

  assert.equal(firstRelease(), true)
  assert.equal(firstRelease(), false, 'a permit must release exactly once')
  const releaseA2 = await a2
  assert.deepEqual(order, ['a-2'])
  releaseA2()
  const releaseB1 = await b1
  assert.deepEqual(order, ['a-2', 'b-1'])
  releaseB1()
  const releaseA3 = await a3
  assert.deepEqual(order, ['a-2', 'b-1', 'a-3'])
  releaseA3()
  const releaseB2 = await b2
  assert.deepEqual(order, ['a-2', 'b-1', 'a-3', 'b-2'])
  releaseB2()
  assert.equal(admission.snapshot().active, 0)
  admission.close()
})

test('queue bounds, cancellation, timeout, and close use stable LLM error codes', async () => {
  const { createModelAdmission, ERROR_CODES } = await plugin()

  const timeoutAdmission = createModelAdmission({ maxActive: 1, maxQueued: 2, maxQueuedPerRoot: 1, waitMs: 20 })
  const timeoutBlocker = await timeoutAdmission.acquire('timeout-blocker')
  await assert.rejects(timeoutAdmission.acquire('timeout-root'), error => error?.code === ERROR_CODES.timeout)
  timeoutBlocker()
  timeoutAdmission.close()

  const admission = createModelAdmission({ maxActive: 1, maxQueued: 2, maxQueuedPerRoot: 1, waitMs: 1_000 })
  const release = await admission.acquire('blocker')
  const cancelledController = new AbortController()
  const cancelled = admission.acquire('cancelled-root', cancelledController.signal)
  cancelledController.abort(new Error('caller stopped'))
  await assert.rejects(cancelled, error => error?.code === ERROR_CODES.cancelled)

  const sameRootWaiter = admission.acquire('same-root')
  await assert.rejects(
    admission.acquire('same-root'),
    error => error?.code === ERROR_CODES.queueFull
  )
  const otherRootWaiter = admission.acquire('other-root')
  await assert.rejects(
    admission.acquire('overflow-root'),
    error => error?.code === ERROR_CODES.queueFull
  )

  const sameRootClosed = assert.rejects(sameRootWaiter, error => error?.code === ERROR_CODES.closed)
  const otherRootClosed = assert.rejects(otherRootWaiter, error => error?.code === ERROR_CODES.closed)
  admission.close()
  await Promise.all([sameRootClosed, otherRootClosed])
  await assert.rejects(admission.acquire('late-root'), error => error?.code === ERROR_CODES.closed)
  assert.equal(admission.snapshot().queued, 0)
  assert.equal(admission.snapshot().active, 1, 'closing rejects queued work but does not revoke an active provider stream')
  release()
  assert.equal(admission.snapshot().active, 0)
})

test('async iterator normal, throw, construction failure, and consumer return paths release exactly once', async () => {
  const { admittedStream, createModelAdmission } = await plugin()
  const admission = createModelAdmission({ maxActive: 1, maxQueued: 8, maxQueuedPerRoot: 8, waitMs: 1_000 })

  assert.deepEqual(await collect(admittedStream(admission, 'normal', undefined, async function* () {
    yield 'one'
    yield 'two'
  })), ['one', 'two'])
  assert.equal(admission.snapshot().active, 0)

  await assert.rejects(collect(admittedStream(admission, 'throw', undefined, async function* () {
    yield 'before-error'
    throw new Error('provider iterator failed')
  })), /provider iterator failed/u)
  assert.equal(admission.snapshot().active, 0)

  const constructionFailure = admittedStream(admission, 'construction', undefined, () => {
    throw new Error('stream construction failed')
  })
  await assert.rejects(constructionFailure[Symbol.asyncIterator]().next(), /stream construction failed/u)
  assert.equal(admission.snapshot().active, 0)

  let downstreamFinalized = 0
  const returned = admittedStream(admission, 'return', undefined, async function* () {
    try {
      yield 'first'
      await new Promise(() => {})
    } finally {
      downstreamFinalized += 1
    }
  })[Symbol.asyncIterator]()
  assert.deepEqual(await returned.next(), { value: 'first', done: false })
  assert.equal(admission.snapshot().active, 1)
  assert.deepEqual(await returned.return('finished'), { value: 'finished', done: true })
  assert.equal(downstreamFinalized, 1)
  assert.equal(admission.snapshot().active, 0)
  assert.deepEqual(await returned.return('again'), { value: 'again', done: true })
  assert.equal(admission.snapshot().active, 0)

  let unstartedCalls = 0
  const unstarted = admittedStream(admission, 'unstarted', undefined, () => {
    unstartedCalls += 1
    return (async function* () {})()
  })[Symbol.asyncIterator]()
  assert.deepEqual(await unstarted.return('unused'), { value: 'unused', done: true })
  assert.equal(unstartedCalls, 0)
  assert.equal(admission.snapshot().active, 0)
  admission.close()
})

test('abort after grant but before downstream dispatch releases without calling provider', async () => {
  const { admittedStream, createModelAdmission, ERROR_CODES } = await plugin()
  const admission = createModelAdmission({ maxActive: 1, maxQueued: 2, maxQueuedPerRoot: 2, waitMs: 1_000 })
  const blockerRelease = await admission.acquire('blocker')
  const controller = new AbortController()
  let providerCalls = 0
  const iterator = admittedStream(admission, 'queued', controller.signal, async function* () {
    providerCalls += 1
    yield 'unexpected'
  })[Symbol.asyncIterator]()
  const pending = iterator.next()
  controller.abort(new Error('stopped while queued'))
  blockerRelease()
  await assert.rejects(pending, error => error?.code === ERROR_CODES.cancelled)
  assert.equal(providerCalls, 0)
  assert.equal(admission.snapshot().active, 0)
  admission.close()
})

test('plugin gates only marked loop requests, derives durable roots, and queues no request body metadata', async () => {
  const { markAgentLoopRequest } = await import('@deepseek-ai/dsh-llm')
  const mod = await plugin()
  const ctx = fakeContext([
    session('root-a'),
    session('ordinary-child', 'root-a'),
    session('nested-child', 'ordinary-child'),
    session('root-b'),
    session('team-worker', 'root-b')
  ])
  const admission = mod.createModelAdmission({ maxActive: 1, maxQueued: 4, maxQueuedPerRoot: 2, waitMs: 1_000 })
  mod.apply(ctx, {}, { admission })
  const registration = ctx.listeners.get('llm/stream')
  assert.equal(registration.options.global, true)
  assert.equal(mod.resolveRootKey(ctx, 'nested-child'), 'root-a')
  assert.equal(mod.resolveRootKey(ctx, 'team-worker'), 'root-b')
  assert.equal(mod.resolveRootKey(ctx, 'unknown-child'), 'unknown-child')

  const passThrough = { [Symbol.asyncIterator]: async function* () {} }
  assert.equal(registration.listener({ sessionId: 'root-a' }, () => passThrough), passThrough)

  const hold = deferred()
  const blockerRequest = markAgentLoopRequest(Object.freeze({
    sessionId: 'ordinary-child',
    signal: new AbortController().signal,
    messages: Object.freeze([{ role: 'user', content: 'blocker body' }])
  }))
  const blocker = registration.listener(blockerRequest, () => (async function* () {
    yield 'started'
    await hold.promise
  })())[Symbol.asyncIterator]()
  assert.deepEqual(await blocker.next(), { value: 'started', done: false })

  const secret = 'TOP-SECRET-REQUEST-BODY-MUST-NOT-BE-QUEUED'
  const queuedRequest = markAgentLoopRequest(Object.freeze({
    sessionId: 'team-worker',
    signal: new AbortController().signal,
    system: secret,
    messages: Object.freeze([{ role: 'user', content: secret }]),
    tools: Object.freeze([{ name: secret }])
  }))
  const queued = registration.listener(queuedRequest, () => (async function* () {
    yield 'admitted'
  })())[Symbol.asyncIterator]()
  const pending = queued.next()
  await new Promise(resolve => setImmediate(resolve))
  const snapshotText = JSON.stringify(admission.snapshot())
  assert.equal(snapshotText.includes(secret), false)
  assert.deepEqual(admission.snapshot(), {
    active: 1,
    queued: 1,
    rootCount: 1,
    closed: false,
    maxActive: 1,
    maxQueued: 4,
    maxQueuedPerRoot: 2,
    waitMs: 1_000
  })

  hold.resolve()
  assert.deepEqual(await blocker.next(), { value: undefined, done: true })
  assert.deepEqual(await pending, { value: 'admitted', done: false })
  await queued.return()
  assert.equal(admission.snapshot().active, 0)
  for (const cleanup of ctx.cleanups.reverse()) cleanup()
  assert.equal(admission.snapshot().closed, true)
})

test('root, ordinary subagent, team worker, schedule wake, and retry attempts share one global peak', async () => {
  const { markAgentLoopRequest } = await import('@deepseek-ai/dsh-llm')
  const mod = await plugin()
  const ctx = fakeContext([
    session('root-main'),
    session('ordinary-subagent', 'root-main'),
    session('team-root'),
    session('team-worker', 'team-root'),
    session('schedule-root')
  ])
  const admission = mod.createModelAdmission({ maxActive: 2, maxQueued: 16, maxQueuedPerRoot: 8, waitMs: 2_000 })
  mod.apply(ctx, {}, { admission })
  const listener = ctx.listeners.get('llm/stream').listener
  let providerActive = 0
  let peak = 0
  const starts = []

  const attempt = (sessionId, label, delay = 8) => {
    const request = markAgentLoopRequest(Object.freeze({
      sessionId,
      signal: new AbortController().signal,
      messages: Object.freeze([{ role: 'user', content: label }])
    }))
    return collect(listener(request, () => (async function* () {
      providerActive += 1
      peak = Math.max(peak, providerActive)
      starts.push(label)
      try {
        await new Promise(resolve => setTimeout(resolve, delay))
        yield label
      } finally {
        providerActive -= 1
      }
    })()))
  }

  const results = await Promise.all([
    attempt('root-main', 'root'),
    attempt('ordinary-subagent', 'ordinary-subagent'),
    attempt('team-worker', 'team-worker'),
    attempt('schedule-root', 'schedule-wake')
  ])
  assert.equal(peak, 2)
  assert.deepEqual(new Set(results.flat()), new Set(['root', 'ordinary-subagent', 'team-worker', 'schedule-wake']))

  await attempt('root-main', 'retry-1')
  assert.equal(admission.snapshot().active, 0, 'a failed-attempt backoff boundary must not retain a permit')
  await new Promise(resolve => setTimeout(resolve, 5))
  await attempt('root-main', 'retry-2')
  assert.equal(starts.filter(label => label.startsWith('retry-')).length, 2)
  assert.equal(peak, 2)
  assert.equal(providerActive, 0)
  for (const cleanup of ctx.cleanups.reverse()) cleanup()
})

test('twenty-four roots remain bounded and drain all queue state under burst load', async () => {
  const { admittedStream, createModelAdmission } = await plugin()
  const admission = createModelAdmission({ maxActive: 4, maxQueued: 256, maxQueuedPerRoot: 8, waitMs: 5_000 })
  let providerActive = 0
  let peak = 0
  const completed = []
  const attempts = []
  for (let root = 0; root < 24; root += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const label = `root-${root}-attempt-${attempt}`
      attempts.push(collect(admittedStream(admission, `root-${root}`, undefined, async function* () {
        providerActive += 1
        peak = Math.max(peak, providerActive)
        try {
          await new Promise(resolve => setTimeout(resolve, (root + attempt) % 4))
          completed.push(label)
          yield label
        } finally {
          providerActive -= 1
        }
      })))
    }
  }
  const results = await Promise.all(attempts)
  assert.equal(peak, 4)
  assert.equal(providerActive, 0)
  assert.equal(completed.length, 120)
  assert.equal(new Set(results.flat()).size, 120)
  assert.deepEqual(admission.snapshot(), {
    active: 0,
    queued: 0,
    rootCount: 0,
    closed: false,
    maxActive: 4,
    maxQueued: 256,
    maxQueuedPerRoot: 8,
    waitMs: 5_000
  })
  admission.close()
})
