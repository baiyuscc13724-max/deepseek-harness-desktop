const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_ID = 'mobile-control'
const PLUGIN_PACKAGE = 'dsh-mobile-control'

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function replaceDirectory(source, destination) {
  const temporary = `${destination}.desktop-${process.pid}-${Date.now()}`
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await rename(temporary, destination)
}

async function ensurePatchEntry(file) {
  const document = YAML.parseDocument(await readText(file, '[]\n'))
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const rows = document.toJS()
  if (rows != null && !Array.isArray(rows)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  const exists = (rows || []).some(row => Array.isArray(row?.insert) && row.insert.some(item => item?.id === PLUGIN_ID || item?.name === PLUGIN_PACKAGE))
  if (exists) return false
  if (rows == null) document.contents = document.createNode([])
  document.contents.flow = false
  document.add({ insert: [{ id: PLUGIN_ID, name: PLUGIN_PACKAGE }] })
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, String(document), { encoding: 'utf8', mode: 0o600 })
  return true
}

async function ensureMobileControlPlugin({ dshHome, bundledRoot }) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const sourcePackage = JSON.parse(await readText(path.join(source, 'package.json'), '{}'))
  if (sourcePackage.name !== PLUGIN_PACKAGE) throw new Error('内置手机控制插件包无效。')
  const profileRoot = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profileRoot, 'node_modules', PLUGIN_PACKAGE)
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await replaceDirectory(source, destination)
  const patchChanged = await ensurePatchEntry(path.join(profileRoot, 'cordis.patch.yml'))
  return { destination, patchChanged, version: sourcePackage.version }
}

module.exports = { PLUGIN_ID, PLUGIN_PACKAGE, ensureMobileControlPlugin, ensurePatchEntry }
