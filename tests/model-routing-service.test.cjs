const test = require('node:test')
const assert = require('node:assert/strict')
const { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')
const { ROUTING_PRESET_ID, ensureModelRouting, getModelRouting, saveModelRouting } = require('../electron/bridge/model-routing-service.cjs')

const shippedPresetRoot = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')

test('model routing stores main selection and creates an update-safe subagent preset', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-routing-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), [
    'agent-presets:',
    '  default: cordis',
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
  assert.equal(result.basePreset, 'cordis')

  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.equal(settings['agent-default-model'].provider, 'primary-provider')
  assert.equal(settings['agent-presets'].default, ROUTING_PRESET_ID)

  const compositionText = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(compositionText, /!!js process\.platform/)
  const nestedSkill = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'skills', 'cordis-plugin-development', 'SKILL.md'), 'utf8')
  assert.match(nestedSkill, /Cordis/i)
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
  const compatibilityPreset = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(compatibilityPreset, /provider: new-provider/)
  assert.match(compatibilityPreset, /model: new-model/)
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

test('the official Harness default model is authoritative over legacy duplicated desktop state', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-drift-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: settings-provider\n  model: settings-model\n')
  await writeFile(path.join(dshHome, 'harness-desktop-model-routing.json'), JSON.stringify({
    schemaVersion: 1,
    main: { provider: 'desktop-provider', model: 'desktop-model' },
    subagent: { inheritMain: true, provider: 'desktop-provider', model: 'desktop-model' },
    basePreset: 'standard'
  }))

  const before = await getModelRouting({ dshHome, shippedPresetRoot })
  assert.deepEqual(before.main, { provider: 'settings-provider', model: 'settings-model' })
  await ensureModelRouting({ dshHome, shippedPresetRoot })
  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.deepEqual(settings['agent-default-model'], { provider: 'settings-provider', model: 'settings-model' })
  const migratedState = JSON.parse(await readFile(path.join(dshHome, 'harness-desktop-model-routing.json'), 'utf8'))
  assert.equal(migratedState.schemaVersion, 2)
  assert.equal(migratedState.main, undefined)
})

test('first startup establishes subagent routing without duplicating the official main model', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-migration-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: official-provider\n  model: official-model\n')

  const result = await ensureModelRouting({ dshHome, shippedPresetRoot })
  assert.deepEqual(result.main, { provider: 'official-provider', model: 'official-model' })
  const stored = JSON.parse(await readFile(path.join(dshHome, 'harness-desktop-model-routing.json'), 'utf8'))
  assert.equal(stored.schemaVersion, 2)
  assert.equal(stored.main, undefined)
  assert.deepEqual(stored.subagent, { inheritMain: true, provider: 'official-provider', model: 'official-model' })
})

test('startup leaves an unchanged routing configuration untouched', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-noop-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const settingsFile = path.join(dshHome, 'settings.yaml')
  const stateFile = path.join(dshHome, 'harness-desktop-model-routing.json')
  await writeFile(settingsFile, 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: stable-provider\n  model: stable-model\n')

  await ensureModelRouting({ dshHome, shippedPresetRoot })
  const beforeSettings = await stat(settingsFile)
  const beforeState = await stat(stateFile)
  await new Promise(resolve => setTimeout(resolve, 25))
  const result = await ensureModelRouting({ dshHome, shippedPresetRoot })

  assert.deepEqual(result.main, { provider: 'stable-provider', model: 'stable-model' })
  assert.equal((await stat(settingsFile)).mtimeMs, beforeSettings.mtimeMs)
  assert.equal((await stat(stateFile)).mtimeMs, beforeState.mtimeMs)
})

test('startup restores a missing desktop preset for existing sessions without changing user presets', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-session-compat-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const userPreset = path.join(dshHome, '.agent-presets', 'novel-closed-loop')
  await mkdir(userPreset, { recursive: true })
  await writeFile(path.join(userPreset, 'preset.yml'), 'name: 小说闭环协调器\n')
  await writeFile(path.join(userPreset, 'agent.cordis.yml'), '[]\n')
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: opencode-go\n  model: deepseek-v4-flash\n')
  await writeFile(path.join(dshHome, 'harness-desktop-model-routing.json'), `${JSON.stringify({
    schemaVersion: 2,
    subagent: { provider: 'opencode-go', model: 'deepseek-v4-flash', inheritMain: true },
    basePreset: 'standard'
  }, null, 2)}\n`)

  await ensureModelRouting({ dshHome, shippedPresetRoot })

  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.equal(settings['agent-presets'].default, 'standard')
  assert.equal((await readFile(path.join(userPreset, 'preset.yml'), 'utf8')).trim(), 'name: 小说闭环协调器')
  const restored = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(restored, /provider: opencode-go/)
  assert.match(restored, /model: deepseek-v4-flash/)
})

test('a failed settings projection rolls back the authoritative desktop route', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-rollback-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const settingsFile = path.join(dshHome, 'settings.yaml')
  const stateFile = path.join(dshHome, 'harness-desktop-model-routing.json')
  const oldState = {
    schemaVersion: 1,
    main: { provider: 'old-provider', model: 'old-model' },
    subagent: { inheritMain: true, provider: 'old-provider', model: 'old-model' },
    basePreset: 'standard'
  }
  await writeFile(settingsFile, 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: old-provider\n  model: old-model\n')
  await writeFile(stateFile, `${JSON.stringify(oldState, null, 2)}\n`)
  const writeFileAtomic = async (file, contents, options) => {
    if (file === settingsFile) throw new Error('simulated settings projection failure')
    await writeFile(file, contents, options)
  }

  await assert.rejects(saveModelRouting({ dshHome, shippedPresetRoot, writeFileAtomic }, {
    main: { provider: 'new-provider', model: 'new-model' }
  }), /simulated settings projection failure/)
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), oldState)
})
