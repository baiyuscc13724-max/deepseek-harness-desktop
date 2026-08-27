const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const { ensureDesktopCompactionPlugin } = require('../electron/bridge/desktop-compaction-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-desktop-compaction/lib/index.js')).href)
}

function message(role, kind, content = []) {
  return { id: `${role}-${kind}-${Math.random()}`, role, source: { kind }, content }
}

function call(id) {
  return { type: 'tool-call', id, name: 'demo', arguments: '{}' }
}

function result(id) {
  return { type: 'tool-result', toolCallId: id, content: [{ type: 'text', text: 'ok' }] }
}

test('Desktop compaction policy reserves headroom and adds a Codex-specific window', async () => {
  const { DEFAULT_ENGINE_CONFIG, DEFAULT_MODEL_POLICIES, desktopEngineConfig } = await plugin()
  assert.equal(DEFAULT_ENGINE_CONFIG.thresholdRatio, 0.72)
  assert.equal(DEFAULT_ENGINE_CONFIG.retainRatio, 0.12)
  assert.equal(DEFAULT_ENGINE_CONFIG.compactionRetries, 2)
  assert.equal(DEFAULT_ENGINE_CONFIG.maxOverflowRetries, 3)
  assert.deepEqual(DEFAULT_MODEL_POLICIES[0], {
    provider: 'openai-codex', model: 'gpt-5.6-sol', thresholdRatio: 0.68,
    retainRatio: 0.1, compactionRetries: 2, maxOverflowRetries: 3
  })
  const { DESKTOP_COMPACTION_CONFIG } = require('../electron/bridge/model-routing-service.cjs')
  assert.deepEqual(desktopEngineConfig(DESKTOP_COMPACTION_CONFIG), DESKTOP_COMPACTION_CONFIG)
  const merged = desktopEngineConfig({ thresholdRatio: 0.7, modelPolicies: [{ provider: 'openai-codex', model: 'gpt-5.6-sol', retainRatio: 0.08 }] })
  assert.equal(merged.thresholdRatio, 0.7)
  assert.equal(merged.modelPolicies[0].thresholdRatio, 0.68)
  assert.equal(merged.modelPolicies[0].retainRatio, 0.08)
  const clamped = desktopEngineConfig({ thresholdRatio: 0.95, retainRatio: 0.5, retainTokens: 200000, auto: false })
  assert.equal(clamped.thresholdRatio, 0.72)
  assert.equal(clamped.retainRatio, 0.12)
  assert.equal(clamped.auto, true)
  assert.equal(Object.hasOwn(clamped, 'retainTokens'), false)
})

test('Codex overload recovery recognizes only the unclassified transient error and uses bounded backoff', async () => {
  const {
    CODEX_OVERLOAD_MAX_RETRIES,
    codexOverloadDelay,
    isCodexOverloadFailure
  } = await plugin()
  const overloaded = { message: 'Codex error: Our servers are currently overloaded. Please try again later.', code: 'PI_AI_ERROR' }
  assert.equal(isCodexOverloadFailure({ provider: 'openai-codex', failure: overloaded }), true)
  assert.equal(isCodexOverloadFailure({ provider: 'openai-codex', failure: { ...overloaded, code: 'SERVER' } }), false)
  assert.equal(isCodexOverloadFailure({ provider: 'other', failure: overloaded }), false)
  assert.equal(isCodexOverloadFailure({ provider: 'openai-codex', failure: { message: 'invalid model', code: 'PI_AI_ERROR' } }), false)
  assert.equal(CODEX_OVERLOAD_MAX_RETRIES, 5)
  assert.equal(codexOverloadDelay(1, () => 0.5), 1000)
  assert.equal(codexOverloadDelay(5, () => 0.5), 16000)
  assert.equal(codexOverloadDelay(9, () => 1), 16000)
})

test('Codex overload recovery persists visible retry state and preserves the retry chain', async () => {
  const { CODEX_OVERLOAD_POLICY_KEY, recoverCodexOverload } = await plugin()
  const events = []
  const waits = []
  const session = {
    events,
    append(type, data) { events.push({ type, data }) }
  }
  const payload = {
    agent: { session },
    turn: 4,
    step: 7,
    provider: 'openai-codex',
    failure: { message: 'Our servers are currently overloaded. Please try again later.', code: 'PI_AI_ERROR' },
    signal: { aborted: false }
  }
  let nextCalls = 0
  const internals = {
    createRetryId: () => 'desktop-retry-id',
    random: () => 0.5,
    wait: async delayMs => { waits.push(delayMs); return true }
  }
  assert.deepEqual(await recoverCodexOverload({ logger: {} }, payload, async () => { nextCalls += 1 }, internals), { kind: 'retry' })
  assert.deepEqual(await recoverCodexOverload({ logger: {} }, payload, async () => { nextCalls += 1 }, internals), { kind: 'retry' })
  assert.equal(nextCalls, 0)
  assert.deepEqual(waits, [1000, 2000])
  const scheduled = events.filter(event => event.type === 'llm/retry')
  assert.deepEqual(scheduled.map(event => event.data.retry), [1, 2])
  assert.equal(scheduled[0].data.retryId, 'desktop-retry-id')
  assert.equal(scheduled[1].data.retryId, 'desktop-retry-id')
  assert.equal(scheduled[0].data.policyKey, CODEX_OVERLOAD_POLICY_KEY)
  assert.equal(scheduled[0].data.maxRetries, 5)
  assert.equal(events.filter(event => event.type === 'llm/retry-started').length, 2)
})

test('Codex overload recovery stops after its budget and keeps the session resumable', async () => {
  const {
    CODEX_OVERLOAD_MAX_RETRIES,
    CODEX_OVERLOAD_POLICY_KEY,
    CODEX_OVERLOAD_RECOVERY_GUIDANCE,
    recoverCodexOverload
  } = await plugin()
  const events = Array.from({ length: CODEX_OVERLOAD_MAX_RETRIES }, (_, index) => ({
    type: 'llm/retry',
    data: { turn: 1, step: 2, provider: 'openai-codex', policyKey: CODEX_OVERLOAD_POLICY_KEY, retry: index + 1, retryId: 'chain' }
  }))
  const errors = []
  let nextCalls = 0
  const result = await recoverCodexOverload({ logger: { error: message => errors.push(message) } }, {
    agent: { session: { events, append() { throw new Error('must not append after exhaustion') } } },
    turn: 1,
    step: 2,
    provider: 'openai-codex',
    failure: { message: 'Our servers are currently overloaded. Please try again later.', code: 'PI_AI_ERROR' },
    signal: { aborted: false }
  }, async () => { nextCalls += 1; return { kind: 'next' } })
  assert.deepEqual(result, { kind: 'next' })
  assert.equal(nextCalls, 1)
  assert.deepEqual(errors, [CODEX_OVERLOAD_RECOVERY_GUIDANCE])
  assert.match(errors[0], /上下文仍已保留/u)
})

test('summary overflow shrinking removes only an old balanced prefix', async () => {
  const { shrinkCompactionInput, toolPairsBalanced } = await plugin()
  const messages = [
    message('user', 'user'),
    message('assistant', 'model', [call('old')]),
    message('user', 'tool', [result('old')]),
    message('user', 'user'),
    message('assistant', 'model', [call('new')]),
    message('user', 'tool', [result('new')]),
    message('user', 'user')
  ]
  const input = { system: 'keep', tools: [{ name: 'demo' }], messages }
  const shrunk = shrinkCompactionInput(input)
  assert.ok(shrunk.messages.length < messages.length)
  assert.equal(shrunk.messages[0].source.kind, 'user')
  assert.equal(toolPairsBalanced(shrunk.messages), true)
  assert.equal(shrunk.system, 'keep')
  assert.equal(shrunk.tools, input.tools)
  assert.equal(input.messages.length, 7)

  const unbalanced = [message('user', 'user'), message('user', 'tool', [result('missing')])]
  assert.equal(toolPairsBalanced(unbalanced), false)
  assert.equal(shrinkCompactionInput({ messages: unbalanced }), null)
})

test('summary overflow retry progressively shrinks input before succeeding', async () => {
  const basic = await import('@deepseek-ai/dsh-compaction-basic')
  const { DesktopCompactionEngine } = await plugin()
  const original = basic.default.prototype.summarize
  const attempts = []
  basic.default.prototype.summarize = async input => {
    attempts.push(input.messages.length)
    if (attempts.length < 3) throw Object.assign(new Error('prompt is too long'), { code: 'CONTEXT_WINDOW_EXCEEDED' })
    return { summary: [{ type: 'text', text: 'checkpoint' }] }
  }
  try {
    const engine = Object.create(DesktopCompactionEngine.prototype)
    engine.ctx = { logger: { warn: () => {} } }
    const pair = sequence => [
      message('user', 'user'),
      message('assistant', 'model', [call(`call-${sequence}`)]),
      message('user', 'tool', [result(`call-${sequence}`)])
    ]
    const messages = [...pair(1), ...pair(2), ...pair(3), message('user', 'user')]
    const output = await engine.summarize({ messages }, {}, { aborted: false })
    assert.deepEqual(output.summary, [{ type: 'text', text: 'checkpoint' }])
    assert.equal(attempts.length, 3)
    assert.ok(attempts[0] > attempts[1] && attempts[1] > attempts[2])
  } finally {
    basic.default.prototype.summarize = original
  }
})

test('provider-confirmed context overflow compacts durable surface and retries the request', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { DesktopCompactionEngine } = await plugin()
  const ctx = new Context()
  const handlers = new Map()
  const originalOn = ctx.on.bind(ctx)
  ctx.on = (name, handler, ...rest) => {
    if (!handlers.has(name)) handlers.set(name, [])
    handlers.get(name).push(handler)
    return originalOn(name, handler, ...rest)
  }
  const engine = new DesktopCompactionEngine(ctx)
  const requestErrorHandlers = handlers.get('agent/request-error')
  const overflowHandler = requestErrorHandlers[0]
  assert.equal(typeof overflowHandler, 'function')
  assert.equal(typeof requestErrorHandlers[1], 'function', 'Desktop transient recovery must follow the base overflow handler')
  const session = {
    requestHeader: () => ({ config: { provider: 'openai-codex', model: 'gpt-5.6-sol' } }),
    surface: { replaceGeneration: 0 }
  }
  const agent = { session }
  let nextCalls = 0
  engine.compactIfNeeded = async (_agent, trigger) => {
    assert.equal(trigger, 'context-overflow')
    session.surface.replaceGeneration += 1
    return { shadowedSeqs: [1], shadowedRange: { start: 1, end: 1 }, shadowedTokenCount: 2000 }
  }
  const result = await overflowHandler({ agent, failure: { code: 'CONTEXT_WINDOW_EXCEEDED' }, signal: { aborted: false } }, async () => { nextCalls += 1; return { kind: 'next' } })
  assert.deepEqual(result, { kind: 'retry' })
  assert.equal(nextCalls, 0)
})

test('Codex overload recovery writes official durable retry events with five bounded exponential waits', async () => {
  const {
    CODEX_OVERLOAD_GUIDANCE,
    CODEX_OVERLOAD_MAX_RETRIES,
    CODEX_OVERLOAD_POLICY_KEY,
    recoverCodexOverload
  } = await plugin()
  const events = [
    { type: 'turn/start', data: { turn: 7 } },
    { type: 'request/header', data: { header: { config: { provider: 'openai-codex', model: 'gpt-5.6-sol' } } } },
    { type: 'step/start', data: { turn: 7, step: 3 } }
  ]
  const session = {
    events,
    append(type, data) {
      const event = { seq: events.length, type, data }
      events.push(event)
      return event
    }
  }
  const failure = { code: 'PI_AI_ERROR', message: 'The model is overloaded; please try again later.', status: 503 }
  const delays = []
  const errors = []
  let nextCalls = 0
  const payload = {
    agent: { session }, turn: 7, step: 3, provider: 'openai-codex', failure,
    signal: new AbortController().signal
  }
  const internals = {
    createRetryId: () => 'retry-chain-1',
    delay: async delayMs => { delays.push(delayMs); return true }
  }
  for (let retry = 1; retry <= CODEX_OVERLOAD_MAX_RETRIES; retry += 1) {
    assert.deepEqual(await recoverCodexOverload(payload, async () => { nextCalls += 1 }, { logger: { error: value => errors.push(value) } }, internals), { kind: 'retry' })
  }
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000])
  const scheduled = events.filter(event => event.type === 'llm/retry')
  const started = events.filter(event => event.type === 'llm/retry-started')
  assert.equal(scheduled.length, 5)
  assert.equal(started.length, 5)
  assert.deepEqual(scheduled.map(event => event.data.retry), [1, 2, 3, 4, 5])
  assert.ok(scheduled.every(event => event.data.retryId === 'retry-chain-1'))
  assert.ok(scheduled.every(event => event.data.mode === 'normal' && event.data.maxRetries === 5))
  assert.ok(scheduled.every(event => event.data.policyKey === CODEX_OVERLOAD_POLICY_KEY))
  assert.ok(scheduled.every(event => event.data.failure === failure))
  assert.deepEqual(started.map(event => event.data.retry), [1, 2, 3, 4, 5])

  assert.equal(await recoverCodexOverload(payload, async () => { nextCalls += 1; return 'terminal' }, { logger: { error: value => errors.push(value) } }, internals), 'terminal')
  assert.equal(nextCalls, 1)
  assert.deepEqual(errors, [CODEX_OVERLOAD_GUIDANCE])
  assert.equal(events.filter(event => event.type === 'llm/retry').length, 5)
})

test('Codex overload recovery excludes auth, credits, other providers, and broad PI failures', async () => {
  const { isCodexOverloadFailure, recoverCodexOverload } = await plugin()
  assert.equal(isCodexOverloadFailure({
    provider: 'openai-codex',
    failure: { code: 'PI_AI_ERROR', message: 'NotCreditsErrorBut overloaded' }
  }), true, 'credential markers must use bounded matching')
  assert.equal(isCodexOverloadFailure({
    provider: 'openai-codex',
    failure: { code: 'PI_AI_ERROR', message: 'PREAUTHPOST says try again later' }
  }), true, 'auth marker must use bounded matching')
  const events = []
  const session = { events, append: (type, data) => events.push({ type, data }) }
  const cases = [
    { provider: 'openai-codex', failure: { code: 'AUTH', message: 'overloaded' } },
    { provider: 'openai-codex', failure: { code: 'CreditsError', message: 'try again later' } },
    { provider: 'openai-codex', failure: { code: 'PI_AI_ERROR', message: 'AUTH: service overloaded' } },
    { provider: 'openai-codex', failure: { code: 'PI_AI_ERROR', message: 'CreditsError: try again later' } },
    { provider: 'openai', failure: { code: 'PI_AI_ERROR', message: 'overloaded' } },
    { provider: 'openai-codex', failure: { code: 'PI_AI_ERROR', message: 'rate limit exceeded' } },
    { provider: 'openai-codex', failure: { code: 'PI_AI_ERROR', message: 'overload protection is active' } }
  ]
  let nextCalls = 0
  let waits = 0
  for (const item of cases) {
    const result = await recoverCodexOverload({
      agent: { session }, turn: 1, step: 1, signal: new AbortController().signal, ...item
    }, async () => { nextCalls += 1; return 'next' }, { logger: { error: () => {} } }, {
      delay: async () => { waits += 1; return true }
    })
    assert.equal(result, 'next')
  }
  assert.equal(nextCalls, cases.length)
  assert.equal(waits, 0)
  assert.deepEqual(events, [])
})

test('Codex overload backoff is cancellable after scheduling and before retry starts', async () => {
  const { cancellableDelay, recoverCodexOverload } = await plugin()
  const controller = new AbortController()
  const events = []
  const session = {
    events,
    append(type, data) { events.push({ type, data }) }
  }
  const pending = recoverCodexOverload({
    agent: { session }, turn: 2, step: 4, provider: 'openai-codex',
    failure: { code: 'PI_AI_ERROR', message: 'try again later' }, signal: controller.signal
  }, async () => assert.fail('cancelled recovery must not delegate or retry'), { logger: { error: () => {} } }, {
    createRetryId: () => 'cancelled-retry',
    delay: cancellableDelay
  })
  controller.abort(new Error('stop'))
  assert.equal(await pending, undefined)
  assert.deepEqual(events.map(event => event.type), ['llm/retry'])
})

test('Desktop compaction plugin installation is profile-local and repeatable', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'desktop-compaction-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const bundledRoot = path.join(root, 'plugins', 'dsh-desktop-compaction')
  const first = await ensureDesktopCompactionPlugin({ dshHome, bundledRoot })
  assert.equal(first.version, '1.0.49')
  const installed = path.join(first.destination, 'lib', 'index.js')
  assert.match(await readFile(installed, 'utf8'), /class DesktopCompactionEngine extends BasicCompactionEngine/u)
  await writeFile(installed, 'stale')
  const second = await ensureDesktopCompactionPlugin({ dshHome, bundledRoot })
  assert.equal(second.destination, first.destination)
  assert.doesNotMatch(await readFile(installed, 'utf8'), /^stale$/u)
  await assert.rejects(readFile(path.join(dshHome, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'), error => error.code === 'ENOENT')
})

test('Desktop installs compaction before rebuilding the managed model preset', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const install = main.indexOf('await ensureDesktopCompactionPlugin(desktopCompactionPluginOptions())')
  const routing = main.indexOf('await ensureModelRouting(modelRoutingOptions())')
  assert.ok(install >= 0 && routing > install)
  assert.doesNotMatch(main, /ensureModelRouting\(modelRoutingOptions\(\)\)\.catch/u, 'runtime must not silently start without the managed compaction preset')
})

test('plugin declares one official compaction-engine module graph and inherits its ABI', async () => {
  const basic = await import('@deepseek-ai/dsh-compaction-basic')
  const { DesktopCompactionEngine } = await plugin()
  const engine = Object.create(DesktopCompactionEngine.prototype)
  assert.equal(engine instanceof basic.default, true)
  assert.deepEqual(DesktopCompactionEngine.inject, basic.default.inject)
  assert.equal(DesktopCompactionEngine.Config, basic.default.Config)
  const manifest = JSON.parse(await readFile(path.join(root, 'plugins/dsh-desktop-compaction/package.json'), 'utf8'))
  assert.equal(manifest.main, 'lib/index.js')
  assert.match(manifest.description, /Codex overload recovery/u)
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-compaction-basic'], '^0.1.1-rc.2')
  assert.equal(manifest.dsh, undefined)
})
