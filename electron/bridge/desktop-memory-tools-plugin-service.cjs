const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')
const PLUGIN_ID = 'desktop-memory-tools'
const PLUGIN_PACKAGE = 'dsh-desktop-memory-tools'
async function text(file, fallback = '') { return readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return fallback; throw error }) }
async function ensurePatchEntry(file) {
  const document = YAML.parseDocument(await text(file, '[]\n'))
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const rows = document.toJS()
  if (rows != null && !Array.isArray(rows)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  if ((rows || []).some(row => row?.insert?.some?.(item => item?.id === PLUGIN_ID || item?.name === PLUGIN_PACKAGE))) return false
  if (rows == null) document.contents = document.createNode([])
  document.contents.flow = false
  document.add({ insert: [{ id: PLUGIN_ID, name: PLUGIN_PACKAGE }] })
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, String(document), { encoding: 'utf8', mode: 0o600 })
  return true
}
async function ensureDesktopMemoryToolsPlugin({ dshHome, bundledRoot }) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const manifest = JSON.parse(await text(path.join(source, 'package.json'), '{}'))
  if (manifest.name !== PLUGIN_PACKAGE) throw new Error('内置本地记忆工具插件包无效。')
  const profile = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', PLUGIN_PACKAGE)
  const temporary = `${destination}.desktop-${process.pid}-${Date.now()}`
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await rename(temporary, destination)
  const patchChanged = await ensurePatchEntry(path.join(profile, 'cordis.patch.yml'))
  return { destination, patchChanged, version: manifest.version }
}
module.exports = { PLUGIN_ID, PLUGIN_PACKAGE, ensureDesktopMemoryToolsPlugin, ensurePatchEntry }
