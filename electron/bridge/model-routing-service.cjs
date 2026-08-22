const { createHash } = require('node:crypto')
const { mkdir, readFile, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const ROUTING_PRESET_ID = 'harness-desktop-routing'
const ROUTING_STATE_FILE = 'harness-desktop-model-routing.json'
const ROUTING_SCHEMA_VERSION = 4
const MANAGED_PRESET_MARKER = '.harness-desktop-managed.json'
const DESKTOP_COMPACTION_PLUGIN = 'dsh-desktop-compaction'
const DESKTOP_COMPACTION_POLICY_VERSION = 1
const DESKTOP_COMPACTION_CONFIG = Object.freeze({
  thresholdRatio: 0.72,
  retainRatio: 0.12,
  maxTokens: 8192,
  compactionRetries: 2,
  maxOverflowRetries: 3,
  auto: true,
  modelPolicies: [{
    provider: 'openai-codex',
    model: 'gpt-5.6-sol',
    thresholdRatio: 0.68,
    retainRatio: 0.1,
    compactionRetries: 2,
    maxOverflowRetries: 3
  }]
})
const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/
const MODEL_ID = /^\S{1,256}$/
const PRESET_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
let installedCatalogPromise = null

function validRoute(route, label) {
  const provider = String(route?.provider || '').trim()
  const model = String(route?.model || '').trim()
  if (!PROVIDER_ID.test(provider)) throw new Error(`${label}服务商标识无效。`)
  if (!MODEL_ID.test(model)) throw new Error(`${label}模型标识无效。`)
  return { provider, model }
}

function optionalRoute(route) {
  const provider = String(route?.provider || '').trim()
  const model = String(route?.model || '').trim()
  return PROVIDER_ID.test(provider) && MODEL_ID.test(model) ? { provider, model } : null
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

async function writeFileAtomic(file, contents, options) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    await writeFile(temporary, contents, options)
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
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

async function installedCatalog() {
  if (!installedCatalogPromise) {
    installedCatalogPromise = import('@earendil-works/pi-ai/providers/all')
      .then(module => ({ getBuiltinModels: module.getBuiltinModels }))
      .catch(() => ({ getBuiltinModels: () => [] }))
  }
  return installedCatalogPromise
}

async function installedModelsFor(provider) {
  const catalog = await installedCatalog()
  try {
    return catalog.getBuiltinModels(provider).map(normalizeModel).filter(Boolean)
  } catch {
    return []
  }
}

async function providerCatalog(settings, routes) {
  const configured = settings?.['llm-pi-ai']?.providers || {}
  const rows = new Map()
  for (const [id, profile] of Object.entries(configured)) {
    if (!PROVIDER_ID.test(id)) continue
    const configuredModels = Array.isArray(profile?.models) ? profile.models.map(normalizeModel).filter(Boolean) : []
    const catalogModels = await installedModelsFor(id)
    rows.set(id, { id, name: String(profile?.displayName || profile?.name || id), models: [...new Set([...configuredModels, ...catalogModels])] })
  }
  for (const route of routes) {
    if (!route?.provider || !PROVIDER_ID.test(route.provider)) continue
    const row = rows.get(route.provider) || { id: route.provider, name: route.provider, models: await installedModelsFor(route.provider) }
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
  const settingsMain = optionalRoute(settings?.['agent-default-model']) || { provider: '', model: '' }
  // The official Harness model picker remains authoritative. Schema v4 mirrors
  // only the key-free provider/model pair and selects a Desktop-regenerated
  // preset so compaction policy survives official runtime preset updates.
  // A v2 document has no main field; older documents may still supply the
  // migration fallback when the official setting is absent.
  const storedMain = optionalRoute(stored?.main)
  const main = settingsMain.provider ? settingsMain : (storedMain || settingsMain)
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
    providers: await providerCatalog(settings, [main, subagent]),
    configured: Boolean(settingsMain.provider || storedMain)
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

async function copyPresetDirectory(source, destination) {
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourceEntry = path.join(source, entry.name)
    const destinationEntry = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyPresetDirectory(sourceEntry, destinationEntry)
      continue
    }
    if (!entry.isFile()) throw new Error(`Unsupported entry in Agent preset: ${entry.name}`)
    await writeFile(destinationEntry, await readFile(sourceEntry), { mode: 0o600 })
  }
}

async function presetFingerprint(root) {
  const hash = createHash('sha256')
  const visit = async (directory, relative = '') => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        hash.update(`d\0${childRelative}\0`)
        await visit(child, childRelative)
      } else if (entry.isFile()) {
        hash.update(`f\0${childRelative}\0`)
        hash.update(await readFile(child))
        hash.update('\0')
      } else {
        throw new Error(`Unsupported entry in Agent preset: ${childRelative}`)
      }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

function compactionConfig(existing) {
  const source = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const configuredPolicies = Array.isArray(source.modelPolicies) ? source.modelPolicies : []
  const policies = new Map(configuredPolicies.map(policy => [`${String(policy?.provider || '')}\u0000${String(policy?.model || '')}`, { ...policy }]))
  for (const policy of DESKTOP_COMPACTION_CONFIG.modelPolicies) {
    const key = `${policy.provider}\u0000${policy.model}`
    const configured = policies.get(key) || {}
    policies.set(key, {
      ...configured,
      ...policy,
      thresholdRatio: Math.min(Number(configured.thresholdRatio) || policy.thresholdRatio, policy.thresholdRatio),
      retainRatio: Math.min(Number(configured.retainRatio) || policy.retainRatio, policy.retainRatio)
    })
  }
  const result = { ...source, ...DESKTOP_COMPACTION_CONFIG, modelPolicies: [...policies.values()] }
  delete result.retainTokens
  return result
}

function patchCompactionRows(rows, pathParts, document) {
  let changed = 0
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const rowPath = [...pathParts, index]
    if (['@deepseek-ai/dsh-compaction-basic', DESKTOP_COMPACTION_PLUGIN].includes(row?.name)) {
      document.setIn([...rowPath, 'name'], DESKTOP_COMPACTION_PLUGIN)
      document.setIn([...rowPath, 'config'], compactionConfig(row?.config))
      changed += 1
    }
    if (Array.isArray(row?.config)) changed += patchCompactionRows(row.config, [...rowPath, 'config'], document)
  }
  return changed
}

async function buildManagedPreset(paths, basePreset, subagentRoute) {
  const source = await resolvePresetSource(paths, basePreset)
  const baseFingerprint = await presetFingerprint(source)
  const temporary = path.join(paths.userPresetRoot, `.${ROUTING_PRESET_ID}.tmp-${process.pid}-${Date.now()}`)
  await mkdir(paths.userPresetRoot, { recursive: true, mode: 0o700 })
  try {
    // Node's fs.cp does not understand Electron's ASAR virtual directories.
    // Electron patches readdir/readFile, so copying each file keeps packaged
    // presets (including nested skills) usable without unpacking the archive.
    await copyPresetDirectory(source, temporary)
    const compositionFile = path.join(temporary, 'agent.cordis.yml')
    const composition = YAML.parseDocument(await readText(compositionFile))
    if (composition.errors.length) throw new Error(`基础 Agent 预设无法解析：${composition.errors[0].message}`)
    const rows = composition.toJS()
    const delegationChanged = Array.isArray(rows) ? visitRows(rows, [], composition, subagentRoute) : 0
    const compactionChanged = Array.isArray(rows) ? patchCompactionRows(rows, [], composition) : 0
    if (!delegationChanged) throw new Error(`基础 Agent 预设 ${basePreset} 没有可配置的内置子代理。`)
    if (!compactionChanged) throw new Error(`基础 Agent 预设 ${basePreset} 没有可替换的上下文压缩服务。`)
    await writeFile(compositionFile, String(composition), { encoding: 'utf8', mode: 0o600 })

    const metadataFile = path.join(temporary, 'preset.yml')
    const metadata = YAML.parseDocument(await readText(metadataFile, '{}'))
    metadata.set('name', `桌面增强预设（${basePreset}）`)
    metadata.set('description', '由 Harness Desktop 从最新官方预设重建：保留上游能力，加入独立子代理路由与可恢复上下文压缩。')
    metadata.delete('order')
    await writeFile(metadataFile, String(metadata), { encoding: 'utf8', mode: 0o600 })
    await writeFile(path.join(temporary, MANAGED_PRESET_MARKER), `${JSON.stringify({
      schemaVersion: 1,
      basePreset,
      baseFingerprint,
      compactionPlugin: DESKTOP_COMPACTION_PLUGIN,
      compactionPolicyVersion: DESKTOP_COMPACTION_POLICY_VERSION
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })

    await rm(paths.managedPreset, { recursive: true, force: true })
    await rename(temporary, paths.managedPreset)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function routesEqual(left, right) {
  return left?.provider === right?.provider && left?.model === right?.model
}

function managedRowsMatch(rows, route) {
  let found = 0
  let matched = 0
  let compaction = 0
  const visit = value => {
    if (!Array.isArray(value)) return
    for (const row of value) {
      if (row?.name === '@deepseek-ai/dsh-tool-subagent' && ['spawn', 'fork'].includes(row?.config?.provider)) {
        found += 1
        if (routesEqual(optionalRoute(row?.config?.agentOptions), route)) matched += 1
      }
      if (row?.name === DESKTOP_COMPACTION_PLUGIN) {
        const config = row.config || {}
        const gpt = config.modelPolicies?.find?.(policy => policy?.provider === 'openai-codex' && policy?.model === 'gpt-5.6-sol')
        if (config.thresholdRatio === 0.72 && config.maxOverflowRetries === 3 && gpt?.thresholdRatio === 0.68) compaction += 1
      }
      if (Array.isArray(row?.config)) visit(row.config)
    }
  }
  visit(rows)
  return found > 0 && matched === found && compaction === 1
}

async function managedPresetMatches(paths, route, basePreset) {
  const source = await readText(path.join(paths.managedPreset, 'agent.cordis.yml'))
  if (!source) return false
  try {
    const document = YAML.parseDocument(source)
    const marker = await readJson(path.join(paths.managedPreset, MANAGED_PRESET_MARKER))
    if (document.errors.length || !managedRowsMatch(document.toJS(), route)) return false
    if (marker?.schemaVersion !== 1 || marker?.basePreset !== basePreset || marker?.compactionPlugin !== DESKTOP_COMPACTION_PLUGIN || marker?.compactionPolicyVersion !== DESKTOP_COMPACTION_POLICY_VERSION) return false
    const baseSource = await resolvePresetSource(paths, basePreset)
    return marker.baseFingerprint === await presetFingerprint(baseSource)
  } catch {
    return false
  }
}

async function routingAlreadyCurrent(paths, stored, current, subagent, inheritMain) {
  if (stored?.schemaVersion !== ROUTING_SCHEMA_VERSION || stored?.basePreset !== current.basePreset) return false
  if (!routesEqual(optionalRoute(stored?.main), current.main)) return false
  if (stored?.subagent?.inheritMain !== inheritMain || !routesEqual(optionalRoute(stored?.subagent), subagent)) return false
  const settings = settingsDocument(await readText(paths.settingsFile)).toJS() || {}
  if (!routesEqual(optionalRoute(settings?.['agent-default-model']), current.main)) return false
  if (String(settings?.['agent-presets']?.default || '').trim() !== ROUTING_PRESET_ID) return false
  return managedPresetMatches(paths, subagent, current.basePreset)
}

async function saveModelRouting(options, next) {
  const paths = pathsFor(options)
  const main = validRoute(next?.main, '主模型')
  const inheritMain = next?.subagent?.inheritMain !== false
  const subagent = inheritMain ? { ...main } : validRoute(next?.subagent, '子代理')
  const currentText = await readText(paths.settingsFile)
  const document = settingsDocument(currentText)
  const settings = document.toJS() || {}
  const previousStateText = await readText(paths.stateFile, null)
  const stored = previousStateText ? await readJson(paths.stateFile) : null
  const requestedBase = String(next?.basePreset || '').trim()
  const basePreset = PRESET_ID.test(requestedBase) && requestedBase !== ROUTING_PRESET_ID
    ? requestedBase
    : selectedBasePreset(settings, stored)

  await buildManagedPreset(paths, basePreset, subagent)
  document.setIn(['agent-default-model', 'provider'], main.provider)
  document.setIn(['agent-default-model', 'model'], main.model)
  document.setIn(['agent-presets', 'default'], ROUTING_PRESET_ID)
  await mkdir(paths.home, { recursive: true, mode: 0o700 })
  const atomicWrite = options.writeFileAtomic || writeFileAtomic
  const stateText = `${JSON.stringify({ schemaVersion: ROUTING_SCHEMA_VERSION, main, subagent: { ...subagent, inheritMain }, basePreset }, null, 2)}\n`
  await atomicWrite(paths.stateFile, stateText, { encoding: 'utf8', mode: 0o600 })
  try {
    await atomicWrite(paths.settingsFile, String(document), { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    try {
      if (previousStateText === null) await rm(paths.stateFile, { force: true })
      else await atomicWrite(paths.stateFile, previousStateText, { encoding: 'utf8', mode: 0o600 })
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], '模型路由保存失败，且权威状态回滚失败。')
    }
    throw error
  }
  return getModelRouting(options)
}

async function ensureModelRouting(options) {
  const paths = pathsFor(options)
  const stored = await readJson(paths.stateFile)
  const current = await getModelRouting(options)
  if (!optionalRoute(current.main)) return current
  const storedSubagent = optionalRoute(stored?.subagent)
  const inheritMain = stored?.subagent?.inheritMain !== false || !storedSubagent
  const subagent = inheritMain ? current.main : storedSubagent
  if (await routingAlreadyCurrent(paths, stored, current, subagent, inheritMain)) return current
  return saveModelRouting(options, {
    main: current.main,
    subagent: { ...subagent, inheritMain },
    basePreset: current.basePreset
  })
}

module.exports = {
  DESKTOP_COMPACTION_CONFIG,
  DESKTOP_COMPACTION_PLUGIN,
  DESKTOP_COMPACTION_POLICY_VERSION,
  ROUTING_PRESET_ID,
  ROUTING_SCHEMA_VERSION,
  ensureModelRouting,
  getModelRouting,
  presetFingerprint,
  saveModelRouting
}
