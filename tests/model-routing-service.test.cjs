const test = require('node:test')
const assert = require('node:assert/strict')
const { access, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')
const { ROUTING_PRESET_ID, getModelRouting, saveModelRouting } = require('../electron/bridge/model-routing-service.cjs')

const shippedPresetRoot = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')

test('model routing stores main selection and creates an update-safe subagent preset', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-routing-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), [
    'agent-presets:',
    '  default: standard',
    'agent-default-model:',
    '  provider: primary-provider',
    '  model: primary-model',
    'llm-pi-ai:',
    '  providers:',
    '    primary-provider:',
    '      models: [primary-model]',
    '    worker-provider:',
    '      models: [worker-model]',
    ''
  ].join('\n'))

  const result = await saveModelRouting({ dshHome, shippedPresetRoot }, {
    main: { provider: 'primary-provider', model: 'primary-model' },
    subagent: { inheritMain: false, provider: 'worker-provider', model: 'worker-model' }
  })
  assert.equal(result.subagent.inheritMain, false)
  assert.equal(result.basePreset, 'standard')

  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.equal(settings['agent-default-model'].provider, 'primary-provider')
  assert.equal(settings['agent-presets'].default, ROUTING_PRESET_ID)

  const compositionText = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(compositionText, /!!js process\.platform/)
  const composition = YAML.parseDocument(compositionText).toJS()
  const delegation = composition.find(row => row.id === 'delegation')
  const localTools = delegation.config.filter(row => row.name === '@deepseek-ai/dsh-tool-subagent' && ['spawn', 'fork'].includes(row.config?.provider))
  assert.ok(localTools.length >= 2)
  for (const row of localTools) assert.deepEqual(row.config.agentOptions, { provider: 'worker-provider', model: 'worker-model' })
})

test('subagents follow the main model unless the user explicitly configures a separate route', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-default-route-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: original-provider\n  model: original-model\n')

  const initial = await getModelRouting({ dshHome, shippedPresetRoot })
  assert.equal(initial.subagent.inheritMain, true)
  assert.deepEqual(initial.subagent.provider, 'original-provider')
  assert.deepEqual(initial.subagent.model, 'original-model')

  const result = await saveModelRouting({ dshHome, shippedPresetRoot }, {
    main: { provider: 'new-provider', model: 'new-model' }
  })
  assert.deepEqual(result.subagent, { inheritMain: true, provider: 'new-provider', model: 'new-model' })
  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.equal(settings['agent-presets'].default, 'standard')
  await assert.rejects(access(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID)), { code: 'ENOENT' })
})

test('model routing catalog merges configured and installed provider models without reading credentials', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-catalog-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-default-model:\n  provider: opencode-go\n  model: deepseek-v4-flash\nllm-pi-ai:\n  providers:\n    opencode-go:\n      models:\n        - id: deepseek-v4-flash\n')
  const result = await getModelRouting({ dshHome, shippedPresetRoot })
  assert.equal(result.providers[0].id, 'opencode-go')
  assert.equal(result.providers[0].name, 'opencode-go')
  assert.ok(result.providers[0].models.includes('deepseek-v4-flash'))
  assert.ok(result.providers[0].models.includes('mimo-v2.5'))
  assert.ok(result.providers[0].models.includes('qwen3.7-max'))
  assert.ok(result.providers[0].models.length > 1)
  assert.equal(result.subagent.inheritMain, true)
})

test('a catalog provider with only a credential reference still exposes its full installed model list', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-installed-catalog-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-default-model:\n  provider: opencode-go\n  model: deepseek-v4-flash\nllm-pi-ai:\n  providers:\n    opencode-go:\n      apiKeyEnv: OPENCODE_GO_API_KEY\n')
  const result = await getModelRouting({ dshHome, shippedPresetRoot })
  const provider = result.providers.find(row => row.id === 'opencode-go')
  assert.ok(provider.models.length >= 10)
  assert.ok(provider.models.includes('deepseek-v4-pro'))
  assert.ok(provider.models.includes('kimi-k2.7-code'))
})
