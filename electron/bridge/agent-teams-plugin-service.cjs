const { cp, mkdir, open, readFile, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_ID = 'agent-teams'
const PLUGIN_PACKAGE = 'dsh-agent-teams'

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function atomicWriteText(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.desktop-${process.pid}-${Date.now()}.tmp`
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
      // Windows may reject directory handles; the file itself is already fsynced.
    } finally {
      await directory?.close().catch(() => {})
    }
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function ensurePatchEntry(file) {
  const document = YAML.parseDocument(await readText(file, '[]\n'))
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const rows = document.toJS()
  if (rows != null && !Array.isArray(rows)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  if ((rows || []).some(row => row?.insert?.some?.(item => item?.id === PLUGIN_ID || item?.name === PLUGIN_PACKAGE))) return false
  if (rows == null) document.contents = document.createNode([])
  document.contents.flow = false
  document.add({ insert: [{ id: PLUGIN_ID, name: PLUGIN_PACKAGE }] })
  await atomicWriteText(file, String(document))
  return true
}

async function ensureAgentTeamsPlugin({ dshHome, bundledRoot }) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const manifest = JSON.parse(await readText(path.join(source, 'package.json'), '{}'))
  if (manifest.name !== PLUGIN_PACKAGE || typeof manifest.version !== 'string') {
    throw new Error('内置协作团队插件包无效。')
  }
  if (!manifest.dsh?.client || manifest.dsh.client.platform !== 'web') {
    throw new Error('内置协作团队插件缺少 Web 客户端声明。')
  }

  const profile = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', PLUGIN_PACKAGE)
  const suffix = `${process.pid}-${Date.now()}`
  const temporary = `${destination}.desktop-${suffix}`
  const backup = `${destination}.backup-${suffix}`
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await rm(temporary, { recursive: true, force: true })
  await rm(backup, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
  const patchFile = path.join(profile, 'cordis.patch.yml')
  const patchBefore = await readText(patchFile, '[]\n')
  let patchChanged = false
  let backedUp = false
  let published = false
  try {
    try {
      await rename(destination, backup)
      backedUp = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await rename(temporary, destination)
    published = true
    patchChanged = await ensurePatchEntry(patchFile)
    if (backedUp) await rm(backup, { recursive: true, force: true })
    return { destination, patchChanged, version: manifest.version }
  } catch (error) {
    const rollbackErrors = []
    if (patchChanged) await atomicWriteText(patchFile, patchBefore).catch(failure => { rollbackErrors.push(failure) })
    if (published) await rm(destination, { recursive: true, force: true }).catch(failure => { rollbackErrors.push(failure) })
    if (backedUp) await rename(backup, destination).catch(failure => { rollbackErrors.push(failure) })
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '协作团队插件安装失败且回滚未能完整完成。')
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = {
  PLUGIN_ID,
  PLUGIN_PACKAGE,
  ensureAgentTeamsPlugin,
  ensurePatchEntry
}
