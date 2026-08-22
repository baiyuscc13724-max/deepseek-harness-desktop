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
  const overflowHandler = handlers.get('agent/request-error')[0]
  assert.equal(typeof overflowHandler, 'function')
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

test('Desktop compaction plugin installation is profile-local and repeatable', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'desktop-compaction-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const bundledRoot = path.join(root, 'plugins', 'dsh-desktop-compaction')
  const first = await ensureDesktopCompactionPlugin({ dshHome, bundledRoot })
  assert.equal(first.version, '1.0.32')
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
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-compaction-basic'], '^0.1.1-rc.2')
  assert.equal(manifest.dsh, undefined)
})
