const { access, mkdir, readFile, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const SOURCE_FILE_RE = /(?:\.map|\.(?:ts|tsx|cts|mts))$/i
const runtimeInstalls = new Map()

async function exists(file) {
  try { await access(file); return true } catch { return false }
}

async function collectFiles(source, destination, files) {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await collectFiles(from, to, files)
    else if (entry.isFile() && !SOURCE_FILE_RE.test(entry.name)) files.push([from, to])
  }
}

async function copyFiles(files, concurrency = 24) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor++
      const [source, destination] = files[index]
      await writeFile(destination, await readFile(source))
    }
  }))
}

async function runtimeReady(root, markerValue) {
  if (!await exists(path.join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) return false
  try {
    return (await readFile(path.join(root, '.harness-desktop-runtime.json'), 'utf8')).trim() === markerValue
  } catch {
    return false
  }
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function commitRuntimeCache({ stagingRoot, cacheRoot, destination, markerValue }) {
  let lastError
  for (const wait of [0, 100, 300, 700]) {
    if (wait) await delay(wait)
    if (await runtimeReady(destination, markerValue)) {
      await rm(stagingRoot, { recursive: true, force: true })
      return
    }
    try {
      // Immutable publication: another process may have committed after our
      // readiness check. Never delete the shared destination to win a race.
      await mkdir(path.dirname(cacheRoot), { recursive: true })
      await rename(stagingRoot, cacheRoot)
      return
    } catch (error) {
      lastError = error
      if (await runtimeReady(destination, markerValue)) {
        await rm(stagingRoot, { recursive: true, force: true })
        return
      }
    }
  }
  throw lastError
}

async function installRuntimeNodeModules({ source, cacheRoot, destination, markerValue }) {
  if (await runtimeReady(destination, markerValue)) return destination

  const stagingRoot = `${cacheRoot}.staging-${process.pid}-${randomUUID()}`
  const stagingModules = path.join(stagingRoot, 'node_modules')
  try {
    const files = []
    await collectFiles(source, stagingModules, files)
    await copyFiles(files)
    await writeFile(path.join(stagingModules, '.harness-desktop-runtime.json'), markerValue, 'utf8')
    if (!await runtimeReady(stagingModules, markerValue)) throw new Error('本地 Harness 运行环境暂存校验失败。')
    await commitRuntimeCache({ stagingRoot, cacheRoot, destination, markerValue })
    if (!await runtimeReady(destination, markerValue)) throw new Error('本地 Harness 运行环境展开后校验失败。')
    return destination
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {})
  }
}

async function ensureRuntimeNodeModules({ appRoot, userData, appVersion }) {
  const source = path.join(appRoot, 'node_modules')
  if (!String(appRoot).includes('app.asar')) return source
  if (typeof appVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9][A-Za-z0-9.+-]*)?$/.test(appVersion)) throw new Error('本地 Harness runtime 版本无效。')

  const markerValue = JSON.stringify({ appVersion, platform: process.platform, arch: process.arch })
  const cacheRoot = path.join(userData, 'runtime', `${appVersion}-${process.platform}-${process.arch}`)
  const destination = path.join(cacheRoot, 'node_modules')
  if (await runtimeReady(destination, markerValue)) return destination

  if (!runtimeInstalls.has(cacheRoot)) {
    const installation = installRuntimeNodeModules({ source, cacheRoot, destination, markerValue })
    runtimeInstalls.set(cacheRoot, installation)
    installation.finally(() => {
      if (runtimeInstalls.get(cacheRoot) === installation) runtimeInstalls.delete(cacheRoot)
    }).catch(() => {})
  }
  return runtimeInstalls.get(cacheRoot)
}

module.exports = { collectFiles, ensureRuntimeNodeModules, runtimeReady }
