const { access, mkdir, readFile, readdir, rename, rm, writeFile } = require('node:fs/promises')
const path = require('node:path')

const SOURCE_FILE_RE = /(?:\.map|\.(?:ts|tsx|cts|mts))$/i

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

async function ensureRuntimeNodeModules({ appRoot, userData, appVersion }) {
  const source = path.join(appRoot, 'node_modules')
  if (!String(appRoot).includes('app.asar')) return source

  const markerValue = JSON.stringify({ appVersion, platform: process.platform, arch: process.arch })
  const cacheRoot = path.join(userData, 'runtime', `${appVersion}-${process.platform}-${process.arch}`)
  const destination = path.join(cacheRoot, 'node_modules')
  if (await runtimeReady(destination, markerValue)) return destination

  const stagingRoot = `${cacheRoot}.staging-${process.pid}`
  const stagingModules = path.join(stagingRoot, 'node_modules')
  await rm(stagingRoot, { recursive: true, force: true })
  const files = []
  await collectFiles(source, stagingModules, files)
  await copyFiles(files)
  await writeFile(path.join(stagingModules, '.harness-desktop-runtime.json'), markerValue, 'utf8')
  await rm(cacheRoot, { recursive: true, force: true })
  await mkdir(path.dirname(cacheRoot), { recursive: true })
  await rename(stagingRoot, cacheRoot)
  if (!await runtimeReady(destination, markerValue)) throw new Error('本地 Harness 运行环境展开后校验失败。')
  return destination
}

module.exports = { collectFiles, ensureRuntimeNodeModules, runtimeReady }
