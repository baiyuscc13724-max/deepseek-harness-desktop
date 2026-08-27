const test = require('node:test')
const assert = require('node:assert/strict')
const { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const YAML = require('yaml')
const jsYaml = require('js-yaml')
const vm = require('node:vm')
const { readFileSync } = require('node:fs')
const { ROUTING_PRESET_ID, ensureModelRouting, getModelRouting, saveModelRouting } = require('../electron/bridge/model-routing-service.cjs')

const shippedPresetRoot = path.resolve(__dirname, '..', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets')
const rendererRoutingSource = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')
const rendererRoutingSandbox = { window: {} }
vm.runInNewContext(rendererRoutingSource, rendererRoutingSandbox)
const { createModelRoutingSavePayload } = rendererRoutingSandbox.window.harnessModelRoutingIntegration

function allRows(rows) {
  const result = []
  const visit = value => {
    if (!Array.isArray(value)) return
    for (const row of value) {
      result.push(row)
      if (Array.isArray(row?.config)) visit(row.config)
    }
  }
  visit(rows)
  return result
}

test('renderer model save payload is accepted by the routing service contract', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-model-renderer-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = path.join(root, 'home')
  const presetRoot = path.join(root, 'presets')
  const standard = path.join(presetRoot, 'standard')
  await mkdir(standard, { recursive: true })
  await mkdir(dshHome, { recursive: true })
  await writeFile(path.join(standard, 'preset.yml'), 'name: Standard\n')
  await writeFile(path.join(standard, 'agent.cordis.yml'), [
    '- id: compaction',
    '  name: cordis:group',
    '  config:',
    '    - id: compaction-basic',
    '      name: "@deepseek-ai/dsh-compaction-basic"',
    '- id: delegation',
    '  name: cordis:group',
    '  config:',
    '    - id: spawn',
    '      name: "@deepseek-ai/dsh-tool-subagent"',
    '      config: { provider: spawn }',
    '    - id: fork',
    '      name: "@deepseek-ai/dsh-tool-subagent"',
    '      config: { provider: fork }',
    ''
  ].join('\n'))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: old-provider\n  model: old-model\n')

  const payload = createModelRoutingSavePayload({
    mainProvider: ' primary-provider ',
    mainModel: ' primary-model ',
    subInherit: false,
    subProvider: ' worker-provider ',
    subModel: ' worker-model ',
    basePreset: ' standard '
  })
  const result = await saveModelRouting({ dshHome, shippedPresetRoot: presetRoot }, payload)

  assert.deepEqual(result.main, { provider: 'primary-provider', model: 'primary-model' })
  assert.deepEqual(result.subagent, { inheritMain: false, provider: 'worker-provider', model: 'worker-model' })
  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.deepEqual(settings['agent-default-model'], result.main)
})

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

  const result = await saveModelRouting({ dshHome, shippedPresetRoot }, createModelRoutingSavePayload({
    mainProvider: 'primary-provider',
    mainModel: 'primary-model',
    subInherit: false,
    subProvider: 'worker-provider',
    subModel: 'worker-model'
  }))
  assert.equal(result.subagent.inheritMain, false)
  assert.equal(result.basePreset, 'cordis')

  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.equal(settings['agent-default-model'].provider, 'primary-provider')
  assert.equal(settings['agent-presets'].default, ROUTING_PRESET_ID)

  const compositionText = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(compositionText, /!!js process\.platform/)
  const { entryListSchema } = await import('@deepseek-ai/cordis-plugin-include')
  const accepted = jsYaml.load(compositionText, { schema: entryListSchema })
  assert.equal(accepted.find(row => row.id === 'tool-bash').disabled.__jsExpr, "process.platform === 'win32'")
  const nestedSkill = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'skills', 'cordis-plugin-development', 'SKILL.md'), 'utf8')
  assert.match(nestedSkill, /Cordis/i)
  const composition = YAML.parseDocument(compositionText).toJS()
  const delegation = composition.find(row => row.id === 'delegation')
  const localTools = delegation.config.filter(row => row.name === '@deepseek-ai/dsh-tool-subagent' && ['spawn', 'fork'].includes(row.config?.provider))
  assert.ok(localTools.length >= 2)
  for (const row of localTools) assert.deepEqual(row.config.agentOptions, { provider: 'worker-provider', model: 'worker-model' })
  const compactionGroup = composition.find(row => row.id === 'compaction')
  const compaction = allRows(composition).find(row => row.name === 'dsh-desktop-compaction')
  assert.deepEqual(compactionGroup.isolate, { compaction: true, toolResultPruner: true })
  assert.equal(allRows(composition).some(row => row.name === '@deepseek-ai/dsh-compaction-basic'), false)
  assert.equal(allRows(composition).filter(row => row.name === '@deepseek-ai/dsh-command-compact').length, 1)
  assert.equal(allRows(composition).filter(row => row.name === '@deepseek-ai/dsh-compaction-tool-result-pruner').length, 1)
  assert.doesNotMatch(compositionText, /(?:[A-Za-z]:\\|file:\/\/)/u)
  assert.equal(compaction.config.thresholdRatio, 0.72)
  assert.equal(compaction.config.maxOverflowRetries, 3)
  assert.deepEqual(compaction.config.modelPolicies[0], {
    provider: 'openai-codex', model: 'gpt-5.6-sol', thresholdRatio: 0.68,
    retainRatio: 0.1, compactionRetries: 2, maxOverflowRetries: 3
  })
  const marker = JSON.parse(await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, '.harness-desktop-managed.json'), 'utf8'))
  assert.equal(marker.compactionPlugin, 'dsh-desktop-compaction')
  assert.match(marker.baseFingerprint, /^[a-f0-9]{64}$/u)
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
  assert.equal(settings['agent-presets'].default, ROUTING_PRESET_ID)
  const compatibilityPreset = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(compatibilityPreset, /provider: new-provider/)
  assert.match(compatibilityPreset, /model: new-model/)
})

test('desktop model routing reads provider catalogs from the extracted DSH runtime', () => {
  const main = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /const nodeModulesRoot = bundledNodeModulesRoot\(\)/u)
  assert.match(main, /installedModelDataRoot: path\.join\(nodeModulesRoot, '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'\)/u)
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

test('packaged runtime model data restores the full catalog when ESM discovery is unavailable', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-packaged-catalog-'))
  const installedModelDataRoot = path.join(dshHome, 'runtime-model-data')
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await mkdir(installedModelDataRoot, { recursive: true })
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-default-model:\n  provider: openai-codex\n  model: configured-current\nllm-pi-ai:\n  providers:\n    openai-codex:\n      apiKeyEnv: OPENAI_CODEX_ACCESS_TOKEN\n')
  await writeFile(path.join(installedModelDataRoot, 'openai-codex.json'), JSON.stringify({
    'openai-codex-responses': {
      'catalog-first': { id: 'catalog-first', provider: 'openai-codex' },
      'catalog-second': { id: 'catalog-second', provider: 'openai-codex' },
      invalid: { id: ' spaced model ', provider: 'openai-codex' }
    }
  }))

  const result = await getModelRouting({ dshHome, shippedPresetRoot, installedModelDataRoot })
  const provider = result.providers.find(row => row.id === 'openai-codex')
  assert.deepEqual(provider.models, ['catalog-first', 'catalog-second', 'configured-current'])
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
  assert.equal(migratedState.schemaVersion, 4)
  assert.deepEqual(migratedState.main, { provider: 'settings-provider', model: 'settings-model' })
})

test('first startup stores key-free main and subagent routes for trusted hosts', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-migration-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: official-provider\n  model: official-model\n')

  const result = await ensureModelRouting({ dshHome, shippedPresetRoot })
  assert.deepEqual(result.main, { provider: 'official-provider', model: 'official-model' })
  const stored = JSON.parse(await readFile(path.join(dshHome, 'harness-desktop-model-routing.json'), 'utf8'))
  assert.equal(stored.schemaVersion, 4)
  assert.deepEqual(stored.main, { provider: 'official-provider', model: 'official-model' })
  assert.deepEqual(stored.subagent, { inheritMain: true, provider: 'official-provider', model: 'official-model' })
  assert.deepEqual(Object.keys(stored).sort(), ['basePreset', 'main', 'schemaVersion', 'subagent'])
  assert.doesNotMatch(JSON.stringify(stored), /api[_-]?key|credential|secret|token/iu)
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

test('startup repairs a stale current-schema main mirror even when subagent routing is current', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-main-mirror-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const stateFile = path.join(dshHome, 'harness-desktop-model-routing.json')
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: authoritative-provider\n  model: authoritative-model\n')
  await ensureModelRouting({ dshHome, shippedPresetRoot })
  const stale = JSON.parse(await readFile(stateFile, 'utf8'))
  stale.main = { provider: 'stale-provider', model: 'stale-model' }
  await writeFile(stateFile, `${JSON.stringify(stale, null, 2)}\n`)

  await ensureModelRouting({ dshHome, shippedPresetRoot })

  const repaired = JSON.parse(await readFile(stateFile, 'utf8'))
  assert.equal(repaired.schemaVersion, 4)
  assert.deepEqual(repaired.main, { provider: 'authoritative-provider', model: 'authoritative-model' })
  assert.deepEqual(repaired.subagent, { inheritMain: true, provider: 'authoritative-provider', model: 'authoritative-model' })
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
  assert.equal(settings['agent-presets'].default, ROUTING_PRESET_ID)
  assert.equal((await readFile(path.join(userPreset, 'preset.yml'), 'utf8')).trim(), 'name: 小说闭环协调器')
  const restored = await readFile(path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID, 'agent.cordis.yml'), 'utf8')
  assert.match(restored, /provider: opencode-go/)
  assert.match(restored, /model: deepseek-v4-flash/)
  const migrated = JSON.parse(await readFile(path.join(dshHome, 'harness-desktop-model-routing.json'), 'utf8'))
  assert.equal(migrated.schemaVersion, 4)
  assert.deepEqual(migrated.main, { provider: 'opencode-go', model: 'deepseek-v4-flash' })
  assert.deepEqual(migrated.subagent, { provider: 'opencode-go', model: 'deepseek-v4-flash', inheritMain: true })
})

test('preset projection fails loudly instead of silently losing Desktop compaction', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-model-no-compaction-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = path.join(root, 'home')
  const presetRoot = path.join(root, 'presets')
  const standard = path.join(presetRoot, 'standard')
  await mkdir(standard, { recursive: true })
  await writeFile(path.join(standard, 'preset.yml'), 'name: Standard\n')
  await writeFile(path.join(standard, 'agent.cordis.yml'), [
    '- id: delegation',
    '  name: cordis:group',
    '  config:',
    '    - id: spawn',
    '      name: "@deepseek-ai/dsh-tool-subagent"',
    '      config: { provider: spawn }',
    ''
  ].join('\n'))
  await mkdir(dshHome, { recursive: true })
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: demo\n  model: demo\n')
  await assert.rejects(ensureModelRouting({ dshHome, shippedPresetRoot: presetRoot }), /没有可替换的上下文压缩服务/u)
  const settings = YAML.parse(await readFile(path.join(dshHome, 'settings.yaml'), 'utf8'))
  assert.equal(settings['agent-presets'].default, 'standard')
})

test('managed preset rebuilds from an updated official base and reapplies the Desktop compaction plugin', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-model-upstream-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dshHome = path.join(root, 'home')
  const presetRoot = path.join(root, 'presets')
  const standard = path.join(presetRoot, 'standard')
  await mkdir(standard, { recursive: true })
  await writeFile(path.join(standard, 'preset.yml'), 'name: Standard\n')
  await writeFile(path.join(standard, 'agent.cordis.yml'), [
    '- id: compaction',
    '  name: cordis:group',
    '  config:',
    '    - id: compaction-basic',
    '      name: "@deepseek-ai/dsh-compaction-basic"',
    '- id: delegation',
    '  name: cordis:group',
    '  config:',
    '    - id: spawn',
    '      name: "@deepseek-ai/dsh-tool-subagent"',
    '      config: { provider: spawn }',
    '    - id: fork',
    '      name: "@deepseek-ai/dsh-tool-subagent"',
    '      config: { provider: fork }',
    ''
  ].join('\n'))
  await mkdir(dshHome, { recursive: true })
  await writeFile(path.join(dshHome, 'settings.yaml'), 'agent-presets:\n  default: standard\nagent-default-model:\n  provider: openai-codex\n  model: gpt-5.6-sol\n')

  await ensureModelRouting({ dshHome, shippedPresetRoot: presetRoot })
  const managed = path.join(dshHome, '.agent-presets', ROUTING_PRESET_ID)
  const firstMarker = JSON.parse(await readFile(path.join(managed, '.harness-desktop-managed.json'), 'utf8'))
  await writeFile(path.join(standard, 'upstream-version.txt'), 'official-update-2\n')
  await ensureModelRouting({ dshHome, shippedPresetRoot: presetRoot })

  const secondMarker = JSON.parse(await readFile(path.join(managed, '.harness-desktop-managed.json'), 'utf8'))
  assert.notEqual(secondMarker.baseFingerprint, firstMarker.baseFingerprint)
  assert.equal(await readFile(path.join(managed, 'upstream-version.txt'), 'utf8'), 'official-update-2\n')
  const compositionFile = path.join(managed, 'agent.cordis.yml')
  const rows = YAML.parse(await readFile(compositionFile, 'utf8'))
  assert.equal(allRows(rows).filter(row => row.name === 'dsh-desktop-compaction').length, 1)
  assert.equal(allRows(rows).some(row => row.name === '@deepseek-ai/dsh-compaction-basic'), false)

  await writeFile(compositionFile, (await readFile(compositionFile, 'utf8')).replace('dsh-desktop-compaction', '@deepseek-ai/dsh-compaction-basic'))
  await ensureModelRouting({ dshHome, shippedPresetRoot: presetRoot })
  const healed = YAML.parse(await readFile(compositionFile, 'utf8'))
  assert.equal(allRows(healed).filter(row => row.name === 'dsh-desktop-compaction').length, 1)
  assert.equal(allRows(healed).some(row => row.name === '@deepseek-ai/dsh-compaction-basic'), false)
})

test('a failed settings projection rolls back the authoritative desktop route', async t => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'harness-model-rollback-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const settingsFile = path.join(dshHome, 'settings.yaml')
  const stateFile = path.join(dshHome, 'harness-desktop-model-routing.json')
  const oldState = {
    schemaVersion: 2,
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
