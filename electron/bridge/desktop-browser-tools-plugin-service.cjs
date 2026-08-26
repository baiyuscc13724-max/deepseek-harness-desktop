const { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_ID = 'desktop-browser-tools'
const PLUGIN_PACKAGE = 'dsh-desktop-browser-tools'
const IMAGE_PLUGIN_ID = 'codex-image-bridge'
const IMAGE_PLUGIN_PACKAGE = 'dsh-codex-image-bridge'
const MANAGED_SKILL_MARKER = '.harness-desktop-managed.json'
const MANAGED_SKILL_OWNER = 'dsh-desktop-browser-tools'
const SAFE_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function replaceDirectory(source, destination, prepare) {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const temporary = `${destination}.desktop-new-${nonce}`
  const backup = `${destination}.desktop-old-${nonce}`
  await rm(temporary, { recursive: true, force: true })
  await rm(backup, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
  if (prepare) await prepare(temporary)
  let movedExisting = false
  try {
    await rename(destination, backup)
    movedExisting = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    await rename(temporary, destination)
    if (movedExisting) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (movedExisting) await rename(backup, destination).catch(() => {})
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}

async function ensureNamedPatchEntry(file, { id, name, config }) {
  const document = YAML.parseDocument(await readText(file, '[]\n'))
  if (document.errors.length) throw new Error(`DSH Web 配置补丁无法解析：${document.errors[0].message}`)
  const rows = document.toJS()
  if (rows != null && !Array.isArray(rows)) throw new Error('DSH Web 配置补丁必须是顶层数组。')
  const exists = (rows || []).some(row => Array.isArray(row?.insert) && row.insert.some(item => item?.id === id || item?.name === name))
  if (exists) return false
  if (rows == null) document.contents = document.createNode([])
  document.contents.flow = false
  document.add({ insert: [{ id, name, ...(config === undefined ? {} : { config }) }] })
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await writeFile(file, String(document), { encoding: 'utf8', mode: 0o600 })
  return true
}

async function ensurePatchEntry(file) {
  return ensureNamedPatchEntry(file, { id: PLUGIN_ID, name: PLUGIN_PACKAGE })
}

async function ensureImageBridgePatchEntry(file) {
  return ensureNamedPatchEntry(file, {
    id: IMAGE_PLUGIN_ID,
    name: IMAGE_PLUGIN_PACKAGE,
    config: { enabled: false, codexExecutable: '', codexHome: '' }
  })
}

function validateSkillMetadata(name, source) {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u)
  if (!match) throw new Error(`内置 Skill ${name} 缺少 YAML frontmatter。`)
  const metadata = YAML.parse(match[1])
  if (metadata?.name !== name) throw new Error(`内置 Skill ${name} 的 name 不匹配。`)
  if (typeof metadata?.description !== 'string' || !metadata.description.trim()) throw new Error(`内置 Skill ${name} 缺少 description。`)
}

async function pathExists(target) {
  return lstat(target).then(() => true, error => {
    if (error.code === 'ENOENT') return false
    throw error
  })
}

async function isOwnedSkill(destination) {
  const raw = await readText(path.join(destination, MANAGED_SKILL_MARKER), '')
  if (!raw) return false
  try {
    const marker = JSON.parse(raw)
    return marker?.owner === MANAGED_SKILL_OWNER && marker?.package === PLUGIN_PACKAGE
  } catch {
    return false
  }
}

async function ensureManagedSkills({ dshHome, bundledRoot, version }) {
  const sourceRoot = path.join(path.resolve(physicalUnpackedPath(path.resolve(bundledRoot))), 'skills')
  const entries = await readdir(sourceRoot, { withFileTypes: true })
  const skillsRoot = path.join(path.resolve(dshHome), 'skills')
  await mkdir(skillsRoot, { recursive: true, mode: 0o700 })
  const installed = []
  const skipped = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (!SAFE_SKILL_NAME.test(name)) throw new Error(`内置 Skill 目录名无效：${name}`)
    const source = path.join(sourceRoot, name)
    validateSkillMetadata(name, await readText(path.join(source, 'SKILL.md')))
    const destination = path.join(skillsRoot, name)
    const destinationExists = await pathExists(destination)
    if (destinationExists && !(await isOwnedSkill(destination))) {
      skipped.push({ name, reason: 'user-owned-skill-preserved', destination })
      continue
    }
    await replaceDirectory(source, destination, temporary => writeFile(
      path.join(temporary, MANAGED_SKILL_MARKER),
      `${JSON.stringify({ owner: MANAGED_SKILL_OWNER, package: PLUGIN_PACKAGE, skill: name, version }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 }
    ))
    installed.push({ name, destination })
  }
  return { installed, skipped }
}

async function ensureDesktopBrowserToolsPlugin({ dshHome, bundledRoot }) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const sourcePackage = JSON.parse(await readText(path.join(source, 'package.json'), '{}'))
  if (sourcePackage.name !== PLUGIN_PACKAGE) throw new Error('内置桌面浏览器工具插件包无效。')
  const profileRoot = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profileRoot, 'node_modules', PLUGIN_PACKAGE)
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await replaceDirectory(source, destination)
  const patchFile = path.join(profileRoot, 'cordis.patch.yml')
  const patchChanged = await ensurePatchEntry(patchFile)
  const skills = await ensureManagedSkills({ dshHome, bundledRoot: source, version: sourcePackage.version })

  const imageSource = path.join(path.dirname(source), IMAGE_PLUGIN_PACKAGE)
  const imagePackage = JSON.parse(await readText(path.join(imageSource, 'package.json'), '{}'))
  if (imagePackage.name !== IMAGE_PLUGIN_PACKAGE) throw new Error('内置 Codex 图像桥接插件包无效。')
  const imageDestination = path.join(profileRoot, 'node_modules', IMAGE_PLUGIN_PACKAGE)
  await replaceDirectory(imageSource, imageDestination)
  const imagePatchChanged = await ensureImageBridgePatchEntry(patchFile)

  return {
    destination,
    patchChanged,
    version: sourcePackage.version,
    skills,
    imageBridge: { destination: imageDestination, patchChanged: imagePatchChanged, version: imagePackage.version }
  }
}

module.exports = {
  IMAGE_PLUGIN_ID,
  IMAGE_PLUGIN_PACKAGE,
  MANAGED_SKILL_MARKER,
  MANAGED_SKILL_OWNER,
  PLUGIN_ID,
  PLUGIN_PACKAGE,
  ensureDesktopBrowserToolsPlugin,
  ensureImageBridgePatchEntry,
  ensureManagedSkills,
  ensurePatchEntry
}
