const { cp, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')

const MARKETPLACE_ID = 'plugin-marketplace'
const MARKETPLACE_PACKAGE = 'dsh-plugin-marketplace'
const MARKETPLACE_REPOSITORY = 'bradeGithub/DSH-Plugins-Marketplace'
const MARKETPLACE_STATE_FILE = 'harness-desktop-marketplace.json'

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

function repositoryIdentity(value) {
  const raw = typeof value === 'string' ? value : value?.url
  const match = String(raw || '').replace(/\.git$/i, '').match(/github\.com[/:]([^/]+\/[^/]+)$/i)
  return match ? match[1].toLowerCase() : ''
}

function versionParts(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] || '' }
}

function compareVersions(left, right) {
  const a = versionParts(left)
  const b = versionParts(right)
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] < b.numbers[index] ? -1 : 1
  }
  if (a.prerelease === b.prerelease) return 0
  if (!a.prerelease) return 1
  if (!b.prerelease) return -1
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true })
}

function hasMarketplaceEntry(document) {
  const rows = document.toJS() || []
  if (!Array.isArray(rows)) return false
  return rows.some(row => Array.isArray(row?.insert) && row.insert.some(item => item?.id === MARKETPLACE_ID || item?.name === MARKETPLACE_PACKAGE))
}

async function ensureProfilePatch(file) {
  const text = await readText(file, '[]\n')
  const document = YAML.parseDocument(text || '[]\n')
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  if (hasMarketplaceEntry(document)) return false
  const current = document.toJS()
  if (current == null) document.contents = document.createNode([])
  else if (!Array.isArray(current)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  document.contents.flow = false
  document.add({ insert: [{ id: MARKETPLACE_ID, name: MARKETPLACE_PACKAGE }] })
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, String(document), { encoding: 'utf8', mode: 0o600 })
  return true
}

async function replaceDirectory(source, destination) {
  const temporary = `${destination}.desktop-${process.pid}-${Date.now()}`
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await rename(temporary, destination)
}

async function ensurePluginMarketplace({ dshHome, bundledRoot }) {
  const home = path.resolve(dshHome)
  const source = path.resolve(bundledRoot)
  const profileRoot = path.join(home, 'profiles', 'web')
  const destination = path.join(profileRoot, 'node_modules', MARKETPLACE_PACKAGE)
  const stateFile = path.join(home, MARKETPLACE_STATE_FILE)
  const patchFile = path.join(profileRoot, 'cordis.patch.yml')
  const bundledPackage = await readJson(path.join(source, 'package.json'))
  if (bundledPackage?.name !== MARKETPLACE_PACKAGE) throw new Error('内置 DSH 插件市场包无效。')
  const bundledRepository = repositoryIdentity(bundledPackage.repository)
  if (bundledRepository !== MARKETPLACE_REPOSITORY.toLowerCase()) throw new Error('内置 DSH 插件市场来源不匹配。')

  const installedPackage = await readJson(path.join(destination, 'package.json'))
  const state = await readJson(stateFile)
  let action = 'preserved'
  let warning = ''

  if (!installedPackage) {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await replaceDirectory(source, destination)
    action = 'installed'
  } else {
    const installedRepository = repositoryIdentity(installedPackage.repository)
    if (installedRepository && installedRepository !== MARKETPLACE_REPOSITORY.toLowerCase()) {
      action = 'conflict'
      warning = `已存在同名插件，但来源是 ${installedRepository}；桌面版未覆盖它。`
    } else if (state?.managed === true && compareVersions(installedPackage.version, bundledPackage.version) < 0) {
      await replaceDirectory(source, destination)
      action = 'updated'
    }
  }

  const patchChanged = await ensureProfilePatch(patchFile)
  if (action !== 'conflict') {
    const currentPackage = await readJson(path.join(destination, 'package.json'))
    await mkdir(home, { recursive: true, mode: 0o700 })
    await writeFile(stateFile, `${JSON.stringify({
      schemaVersion: 1,
      managed: state?.managed === true || action === 'installed' || action === 'updated',
      installedVersion: currentPackage?.version || null,
      bundledVersion: bundledPackage.version,
      repository: MARKETPLACE_REPOSITORY,
      updatedAt: new Date().toISOString()
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  return {
    action,
    warning,
    patchChanged,
    destination,
    installedVersion: (await readJson(path.join(destination, 'package.json')))?.version || null,
    bundledVersion: bundledPackage.version
  }
}

module.exports = {
  MARKETPLACE_ID,
  MARKETPLACE_PACKAGE,
  MARKETPLACE_REPOSITORY,
  compareVersions,
  ensurePluginMarketplace,
  ensureProfilePatch,
  repositoryIdentity
}
