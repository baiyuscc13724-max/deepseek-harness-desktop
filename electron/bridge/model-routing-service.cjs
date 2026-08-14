const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const ROUTING_PRESET_ID = 'harness-desktop-routing'
const ROUTING_STATE_FILE = 'harness-desktop-model-routing.json'
const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/
const MODEL_ID = /^\S{1,256}$/
const PRESET_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/

function validRoute(route, label) {
  const provider = String(route?.provider || '').trim()
  const model = String(route?.model || '').trim()
  if (!PROVIDER_ID.test(provider)) throw new Error(`${label}服务商标识无效。`)
  if (!MODEL_ID.test(model)) throw new Error(`${label}模型标识无效。`)
  return { provider, model }
}

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function readJson(file) {
  const text = await readText(file)
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function settingsDocument(text) {
  const document = YAML.parseDocument(text || '{}')
  if (document.errors.length) throw new Error(`Harness 配置文件无法解析：${document.errors[0].message}`)
  return document
}

function normalizeModel(model) {
  if (typeof model === 'string') return model.trim()
  if (!model || typeof model !== 'object') return ''
  return String(model.id || model.model || model.name || '').trim()
}

function providerCatalog(settings, routes) {
  const configured = settings?.['llm-pi-ai']?.providers || {}
  const rows = new Map()
  for (const [id, profile] of Object.entries(configured)) {
    if (!PROVIDER_ID.test(id)) continue
    const models = Array.isArray(profile?.models) ? profile.models.map(normalizeModel).filter(Boolean) : []
    rows.set(id, { id, name: String(profile?.name || id), models: [...new Set(models)] })
  }
  for (const route of routes) {
    if (!route?.provider || !PROVIDER_ID.test(route.provider)) continue
    const row = rows.get(route.provider) || { id: route.provider, name: route.provider, models: [] }
    if (route.model && !row.models.includes(route.model)) row.models.push(route.model)
    rows.set(route.provider, row)
  }
  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function pathsFor({ dshHome, shippedPresetRoot }) {
  const home = path.resolve(dshHome)
  const userPresetRoot = path.join(home, '.agent-presets')
  return {
    home,
    settingsFile: path.join(home, 'settings.yaml'),
    stateFile: path.join(home, ROUTING_STATE_FILE),
    userPresetRoot,
    managedPreset: path.join(userPresetRoot, ROUTING_PRESET_ID),
    shippedPresetRoot: path.resolve(shippedPresetRoot)
  }
}

function selectedBasePreset(settings, stored) {
  const selected = String(settings?.['agent-presets']?.default || '').trim()
  if (selected && selected !== ROUTING_PRESET_ID && PRESET_ID.test(selected)) return selected
  const storedBase = String(stored?.basePreset || '').trim()
  return PRESET_ID.test(storedBase) && storedBase !== ROUTING_PRESET_ID ? storedBase : 'standard'
}

async function getModelRouting(options) {
  const paths = pathsFor(options)
  const document = settingsDocument(await readText(paths.settingsFile))
  const settings = document.toJS() || {}
  const stored = await readJson(paths.stateFile)
  const main = {
    provider: String(settings?.['agent-default-model']?.provider || stored?.main?.provider || '').trim(),
    model: String(settings?.['agent-default-model']?.model || stored?.main?.model || '').trim()
  }
  const subagent = {
    inheritMain: stored?.subagent?.inheritMain !== false,
    provider: String(stored?.subagent?.provider || main.provider).trim(),
    model: String(stored?.subagent?.model || main.model).trim()
  }
  return {
    main,
    subagent,
    basePreset: selectedBasePreset(settings, stored),
    managedPresetId: ROUTING_PRESET_ID,
    providers: providerCatalog(settings, [main, subagent]),
    configured: Boolean(stored)
  }
}

function visitRows(rows, pathParts, document, route) {
  let changed = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const rowPath = [...pathParts, index]
    if (row?.name === '@deepseek-ai/dsh-tool-subagent' && ['spawn', 'fork'].includes(row?.config?.provider)) {
      document.setIn([...rowPath, 'config', 'agentOptions'], route)
      changed += 1
    }
    if (Array.isArray(row?.config)) changed += visitRows(row.config, [...rowPath, 'config'], document, route)
  }
  return changed
}

async function resolvePresetSource(paths, presetId) {
  const shipped = path.join(paths.shippedPresetRoot, presetId)
  const shippedComposition = await readText(path.join(shipped, 'agent.cordis.yml'))
  if (shippedComposition) return shipped
  const user = path.join(paths.userPresetRoot, presetId)
  const userComposition = await readText(path.join(user, 'agent.cordis.yml'))
  if (userComposition && path.resolve(user) !== path.resolve(paths.managedPreset)) return user
  throw new Error(`找不到基础 Agent 预设：${presetId}`)
}

async function buildManagedPreset(paths, basePreset, subagentRoute) {
  const source = await resolvePresetSource(paths, basePreset)
  const temporary = path.join(paths.userPresetRoot, `.${ROUTING_PRESET_ID}.tmp-${process.pid}-${Date.now()}`)
  await mkdir(paths.userPresetRoot, { recursive: true, mode: 0o700 })
  try {
    await cp(source, temporary, { recursive: true, force: true })
    const compositionFile = path.join(temporary, 'agent.cordis.yml')
    const composition = YAML.parseDocument(await readText(compositionFile))
    if (composition.errors.length) throw new Error(`基础 Agent 预设无法解析：${composition.errors[0].message}`)
    const rows = composition.toJS()
    const changed = Array.isArray(rows) ? visitRows(rows, [], composition, subagentRoute) : 0
    if (!changed) throw new Error(`基础 Agent 预设 ${basePreset} 没有可配置的内置子代理。`)
    await writeFile(compositionFile, String(composition), { encoding: 'utf8', mode: 0o600 })

    const metadataFile = path.join(temporary, 'preset.yml')
    const metadata = YAML.parseDocument(await readText(metadataFile, '{}'))
    metadata.set('name', `桌面模型路由（${basePreset}）`)
    metadata.set('description', '由 Harness Desktop 管理：保留官方预设能力，并为内置子代理指定独立服务商与模型。')
    metadata.delete('order')
    await writeFile(metadataFile, String(metadata), { encoding: 'utf8', mode: 0o600 })

    await rm(paths.managedPreset, { recursive: true, force: true })
    await rename(temporary, paths.managedPreset)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

async function saveModelRouting(options, next) {
  const paths = pathsFor(options)
  const main = validRoute(next?.main, '主模型')
  const inheritMain = next?.subagent?.inheritMain !== false
  const subagent = inheritMain ? { ...main } : validRoute(next?.subagent, '子代理')
  const currentText = await readText(paths.settingsFile)
  const document = settingsDocument(currentText)
  const settings = document.toJS() || {}
  const stored = await readJson(paths.stateFile)
  const requestedBase = String(next?.basePreset || '').trim()
  const basePreset = PRESET_ID.test(requestedBase) && requestedBase !== ROUTING_PRESET_ID
    ? requestedBase
    : selectedBasePreset(settings, stored)

  if (!inheritMain) await buildManagedPreset(paths, basePreset, subagent)
  else await rm(paths.managedPreset, { recursive: true, force: true })
  document.setIn(['agent-default-model', 'provider'], main.provider)
  document.setIn(['agent-default-model', 'model'], main.model)
  document.setIn(['agent-presets', 'default'], inheritMain ? basePreset : ROUTING_PRESET_ID)
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  await writeFile(paths.settingsFile, String(document), { encoding: 'utf8', mode: 0o600 })
  await writeFile(paths.stateFile, `${JSON.stringify({ schemaVersion: 1, main, subagent: { ...subagent, inheritMain }, basePreset }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return getModelRouting(options)
}

async function ensureModelRouting(options) {
  const paths = pathsFor(options)
  const stored = await readJson(paths.stateFile)
  if (!stored) return getModelRouting(options)
  const current = await getModelRouting(options)
  return saveModelRouting(options, {
    main: current.main,
    subagent: { ...stored.subagent, inheritMain: stored.subagent?.inheritMain !== false },
    basePreset: current.basePreset
  })
}

module.exports = {
  ROUTING_PRESET_ID,
  ensureModelRouting,
  getModelRouting,
  saveModelRouting
}
