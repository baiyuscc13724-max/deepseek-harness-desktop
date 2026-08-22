const { cp, mkdir, readFile, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { physicalUnpackedPath } = require('./dsh-resolver.cjs')

const PLUGIN_PACKAGE = 'dsh-desktop-compaction'

async function text(file, fallback = '') {
  return readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return fallback
    throw error
  })
}

async function ensureDesktopCompactionPlugin({ dshHome, bundledRoot }) {
  const source = path.resolve(physicalUnpackedPath(path.resolve(bundledRoot)))
  const manifest = JSON.parse(await text(path.join(source, 'package.json'), '{}'))
  if (manifest.name !== PLUGIN_PACKAGE || manifest.type !== 'module' || !manifest.main) throw new Error('内置上下文压缩插件包无效。')
  const profile = path.join(path.resolve(dshHome), 'profiles', 'web')
  const destination = path.join(profile, 'node_modules', PLUGIN_PACKAGE)
  const temporary = `${destination}.desktop-${process.pid}-${Date.now()}`
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await rm(temporary, { recursive: true, force: true })
  await cp(source, temporary, { recursive: true, force: true })
  await rm(destination, { recursive: true, force: true })
  await rename(temporary, destination)
  return { destination, version: manifest.version }
}

module.exports = { PLUGIN_PACKAGE, ensureDesktopCompactionPlugin }
