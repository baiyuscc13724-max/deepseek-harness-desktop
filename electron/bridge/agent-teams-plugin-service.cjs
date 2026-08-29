const { cp, mkdir, open, readFile, rename, rm, stat } = require('node:fs/promises')
const path = require('node:path')
const YAML = require('yaml')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_ID = 'agent-teams'
const PLUGIN_PACKAGE = 'dsh-agent-teams'
const ARTIFACT_FIXTURE_MARKER = '.agent-teams-packaged-artifact-fixture.json'

async function validateAgentTeamsArtifactRoot(bundledRoot, options = {}) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const normalized = source.split(path.sep).join('/')
  const formalSuffix = '/app.asar.unpacked/plugins/dsh-agent-teams'
  const formal = normalized.endsWith(formalSuffix)
  if (formal) {
    const resourcesRoot = source.slice(0, source.length - formalSuffix.length)
    const marker = await stat(path.join(resourcesRoot, 'app.asar')).catch(() => null)
    if (!marker?.isFile()) {
      const error = new Error('正式协作团队插件产物缺少相邻 app.asar 文件。')
      error.code = 'AGENT_TEAMS_ARTIFACT_MARKER_MISSING'
      throw error
    }
    return { source, kind: 'formal' }
  }
  if (options.allowArtifactFixture === true) {
    const marker = JSON.parse(await readText(path.join(source, ARTIFACT_FIXTURE_MARKER), '{}'))
    if (marker.kind === 'agent-teams-packaged-artifact-fixture' && marker.version === 1) return { source, kind: 'fixture' }
  }
  const error = new Error('协作团队插件根目录不是正式 app.asar.unpacked 产物；仓库源码或未标记目录不得通过安装门禁。')
  error.code = 'AGENT_TEAMS_ARTIFACT_REQUIRED'
  throw error
}

async function readText(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function renameDirectory(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await rename(source, destination) }
    catch (error) {
      if (attempt >= 7 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
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

async function installRuntimeDependencies(pluginRoot, dependencies = {}) {
  const installed = new Set()
  async function install(packageName) {
    if (installed.has(packageName)) return
    installed.add(packageName)
    let packageFile
    try {
      try { packageFile = physicalUnpackedPath(require.resolve(`${packageName}/package.json`)) } catch {
        let directory = path.dirname(physicalUnpackedPath(require.resolve(packageName)))
        for (let depth = 0; depth < 12; depth += 1) {
          const candidate = path.join(directory, 'package.json')
          const candidateManifest = JSON.parse(await readText(candidate, '{}'))
          if (candidateManifest.name === packageName) { packageFile = candidate; break }
          const parent = path.dirname(directory)
          if (parent === directory) break
          directory = parent
        }
      }
      if (!packageFile) throw new Error('package.json not found')
    } catch (error) {
      error.message = `无法解析协作团队插件运行依赖 ${packageName}：${error.message}`
      throw error
    }
    const manifest = JSON.parse(await readText(packageFile, '{}'))
    if (manifest.name !== packageName) throw new Error(`协作团队插件运行依赖身份不匹配：${packageName}`)
    const destination = path.join(pluginRoot, 'node_modules', ...packageName.split('/'))
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await rm(destination, { recursive: true, force: true })
    await cp(path.dirname(packageFile), destination, { recursive: true, force: true })
    for (const dependency of Object.keys(manifest.dependencies || {})) await install(dependency)
  }
  for (const dependency of Object.keys(dependencies || {})) await install(dependency)
  return [...installed]
}

async function ensureAgentTeamsPlugin({ dshHome, bundledRoot, allowArtifactFixture = false, requireArtifact = false }) {
  const artifact = requireArtifact
    ? await validateAgentTeamsArtifactRoot(bundledRoot, { allowArtifactFixture })
    : { source: path.resolve(physicalUnpackedPath(path.resolve(bundledRoot))), kind: 'development-or-packaged-startup' }
  const source = artifact.source
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
  const patchFile = path.join(profile, 'cordis.patch.yml')
  let patchBefore = '[]\n'
  let runtimeDependencies = []
  let patchChanged = false
  let backedUp = false
  let published = false
  try {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await rm(temporary, { recursive: true, force: true })
    await rm(backup, { recursive: true, force: true })
    await cp(source, temporary, { recursive: true, force: true })
    runtimeDependencies = await installRuntimeDependencies(temporary, manifest.dependencies)
    patchBefore = await readText(patchFile, '[]\n')
    try {
      await renameDirectory(destination, backup)
      backedUp = true
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    await renameDirectory(temporary, destination)
    published = true
    patchChanged = await ensurePatchEntry(patchFile)
    if (backedUp) await rm(backup, { recursive: true, force: true })
    return { destination, patchChanged, runtimeDependencies, version: manifest.version }
  } catch (error) {
    const rollbackErrors = []
    if (patchChanged) await atomicWriteText(patchFile, patchBefore).catch(failure => { rollbackErrors.push(failure) })
    if (published) await rm(destination, { recursive: true, force: true }).catch(failure => { rollbackErrors.push(failure) })
    if (backedUp) await renameDirectory(backup, destination).catch(failure => { rollbackErrors.push(failure) })
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '协作团队插件安装失败且回滚未能完整完成。')
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
  }
}

module.exports = {
  PLUGIN_ID,
  PLUGIN_PACKAGE,
  ARTIFACT_FIXTURE_MARKER,
  ensureAgentTeamsPlugin,
  ensurePatchEntry,
  validateAgentTeamsArtifactRoot
}
