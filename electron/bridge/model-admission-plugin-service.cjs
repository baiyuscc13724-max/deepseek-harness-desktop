const { randomUUID } = require('node:crypto')
const { cp, mkdir, open, readFile, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_ID = 'model-admission'
const PLUGIN_PACKAGE = 'dsh-model-admission'
const PLUGIN_ENTRY = 'lib/index.js'
const STABLE_VERSION = /^\d+\.\d+\.\d+$/u

async function readOptionalText(file, fallback = '') {
  try {
    return { exists: true, text: await readFile(file, 'utf8') }
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, text: fallback }
    throw error
  }
}

async function atomicWriteText(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.desktop-${process.pid}-${Date.now()}-${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, file)
    let directory
    try {
      directory = await open(path.dirname(file), 'r')
      await directory.sync()
    } catch {
      // Windows may reject directory handles; the replacement file is already fsynced.
    } finally {
      await directory?.close().catch(() => {})
    }
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function validateManifest(manifest) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('内置模型准入插件 manifest 无效。')
  }
  if (manifest.name !== PLUGIN_PACKAGE) throw new Error(`内置模型准入插件 name 必须为 ${PLUGIN_PACKAGE}。`)
  if (typeof manifest.version !== 'string' || !STABLE_VERSION.test(manifest.version)) {
    throw new Error('内置模型准入插件 version 必须为稳定语义版本。')
  }
  if (manifest.type !== 'module') throw new Error('内置模型准入插件必须声明 type=module。')
  if (manifest.main !== PLUGIN_ENTRY || manifest.exports?.['.'] !== `./${PLUGIN_ENTRY}`) {
    throw new Error(`内置模型准入插件入口必须为 ${PLUGIN_ENTRY}。`)
  }
  if (manifest.dsh?.client !== undefined) {
    throw new Error('内置模型准入插件必须保持 Host-only，禁止声明 Web client。')
  }
  return manifest
}

async function readValidatedManifest(source) {
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'))
  } catch (error) {
    throw new Error('内置模型准入插件 package.json 无法解析。', { cause: error })
  }
  validateManifest(manifest)
  const entry = await readFile(path.join(source, PLUGIN_ENTRY), 'utf8').catch(error => {
    throw new Error(`内置模型准入插件缺少 ${PLUGIN_ENTRY}。`, { cause: error })
  })
  if (entry.trim().length === 0) throw new Error(`内置模型准入插件 ${PLUGIN_ENTRY} 不能为空。`)
  return manifest
}

async function ensurePatchEntry(file) {
  const current = await readOptionalText(file, '[]\n')
  const document = YAML.parseDocument(current.text)
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const rows = document.toJS()
  if (rows != null && !Array.isArray(rows)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  const matches = (rows || []).flatMap(row => Array.isArray(row?.insert) ? row.insert : [])
    .filter(item => item?.id === PLUGIN_ID || item?.name === PLUGIN_PACKAGE)
  if (matches.length > 1 || (matches.length === 1 && (matches[0].id !== PLUGIN_ID || matches[0].name !== PLUGIN_PACKAGE))) {
    throw new Error('DSH Web 配置补丁包含冲突的模型准入插件条目。')
  }
  if (matches.length === 1) return false
  if (rows == null) document.contents = document.createNode([])
  document.contents.flow = false
  document.add({ insert: [{ id: PLUGIN_ID, name: PLUGIN_PACKAGE }] })
  await atomicWriteText(file, String(document))
  return true
}

async function restorePatch(file, before) {
  if (before.exists) await atomicWriteText(file, before.text)
  else await rm(file, { force: true })
}

async function ensureModelAdmissionPlugin({ dshHome, bundledRoot }, internals = {}) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const manifest = await readValidatedManifest(source)
  const profile = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', PLUGIN_PACKAGE)
  const suffix = `${process.pid}-${Date.now()}-${randomUUID()}`
  const temporary = `${destination}.desktop-${suffix}`
  const backup = `${destination}.backup-${suffix}`
  const patchFile = path.join(profile, 'cordis.patch.yml')
  let patchBefore
  let patchChanged = false
  let backedUp = false
  let published = false

  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  try {
    patchBefore = await readOptionalText(patchFile, '[]\n')
    await cp(source, temporary, { recursive: true, force: true })
    try {
      await rename(destination, backup)
      backedUp = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(temporary, destination)
    published = true
    patchChanged = await ensurePatchEntry(patchFile)
    await internals.afterPatch?.({ destination, patchFile })
    if (backedUp) await rm(backup, { recursive: true, force: true })
    return { destination, patchChanged, version: manifest.version }
  } catch (error) {
    const rollbackErrors = []
    if (patchChanged && patchBefore !== undefined) {
      await restorePatch(patchFile, patchBefore).catch(failure => { rollbackErrors.push(failure) })
    }
    if (published) await rm(destination, { recursive: true, force: true }).catch(failure => { rollbackErrors.push(failure) })
    if (backedUp) await rename(backup, destination).catch(failure => { rollbackErrors.push(failure) })
    if (rollbackErrors.length > 0) {
      throw new AggregateError([error, ...rollbackErrors], '模型准入插件安装失败且回滚未能完整完成。')
    }
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = {
  PLUGIN_ID,
  PLUGIN_PACKAGE,
  ensureModelAdmissionPlugin,
  ensurePatchEntry,
  validateManifest
}
