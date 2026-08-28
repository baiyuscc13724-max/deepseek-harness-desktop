const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { setTimeout: delay } = require('node:timers/promises')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_ID = 'dsh-android'
const PLUGIN_PACKAGE = '@zseven-w/dsh-android'

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

const TRANSIENT_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EPERM'])

async function renameWithRetry(source, destination, attempts = 8) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination)
      return
    } catch (error) {
      if (attempt >= attempts - 1 || !TRANSIENT_RENAME_CODES.has(error?.code)) throw error
      await delay(Math.min(400, 25 * 2 ** attempt))
    }
  }
}

async function replaceDirectory(source, destination) {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const temporary = `${destination}.desktop-new-${nonce}`
  const backup = `${destination}.desktop-old-${nonce}`
  const remove = target => rm(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 50 })
  await remove(temporary)
  await remove(backup)
  await cp(source, temporary, { recursive: true, force: true })
  let movedExisting = false
  try {
    await renameWithRetry(destination, backup)
    movedExisting = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await renameWithRetry(temporary, destination)
    if (movedExisting) await remove(backup)
  } catch (error) {
    if (movedExisting) await renameWithRetry(backup, destination).catch(() => {})
    throw error
  } finally {
    await remove(temporary).catch(() => {})
  }
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

async function ensureDesktopAndroidPlugin({ dshHome, bundledRoot }) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const sourcePackage = JSON.parse(await readText(path.join(source, 'package.json'), '{}'))
  if (sourcePackage.name !== PLUGIN_PACKAGE) throw new Error('内置 Android 设备插件包无效。')
  const profileRoot = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profileRoot, 'node_modules', '@zseven-w', 'dsh-android')
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await replaceDirectory(source, destination)
  const patchChanged = await ensurePatchEntry(path.join(profileRoot, 'cordis.patch.yml'))
  return { destination, patchChanged, version: sourcePackage.version }
}

module.exports = { PLUGIN_ID, PLUGIN_PACKAGE, ensureDesktopAndroidPlugin, ensurePatchEntry }
