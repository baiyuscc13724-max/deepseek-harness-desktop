import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  access, cp, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile
} from 'node:fs/promises'
import { finished } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const ASSETS = Object.freeze({
  mingit: Object.freeze({
    id: 'mingit',
    name: 'MinGit-2.53.0.2-64-bit.zip',
    version: '2.53.0.2',
    url: 'https://github.com/git-for-windows/git/releases/download/v2.53.0.windows.2/MinGit-2.53.0.2-64-bit.zip',
    size: 41_299_390,
    sha256: 'd4bf83d6a860ccae9af44e508e1e00a39f09db6fa78a9ba5543b94d87ca22a29',
    maxUnpackedBytes: 180 * 1024 * 1024,
    license: 'GPL-2.0-only'
  }),
  gcm: Object.freeze({
    id: 'gcm',
    name: 'gcm-win-x64-2.7.0.zip',
    version: '2.7.0',
    url: 'https://github.com/git-ecosystem/git-credential-manager/releases/download/v2.7.0/gcm-win-x64-2.7.0.zip',
    size: 11_232_405,
    sha256: '070c7cf706fbed844757f53d2f9d46ace09745820323264761e4f0bb4f0319bc',
    maxUnpackedBytes: 64 * 1024 * 1024,
    license: 'MIT'
  }),
  lfs: Object.freeze({
    id: 'lfs',
    name: 'git-lfs-windows-amd64-v3.7.1.zip',
    version: '3.7.1',
    url: 'https://github.com/git-lfs/git-lfs/releases/download/v3.7.1/git-lfs-windows-amd64-v3.7.1.zip',
    size: 5_469_282,
    sha256: '8683cdc3d6c029b49393dcebbaa6265bd6efd9abdcf837be855b4cd42e5e80b6',
    maxUnpackedBytes: 32 * 1024 * 1024,
    license: 'MIT'
  })
})

const MAX_ZIP_ENTRIES = 20_000
const MAX_ENTRY_PATH = 240
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const METADATA_FILE = 'BUNDLED-GIT-METADATA.json'
const INSTALL_MARKER_FILE = '.bundled-git-installing'

async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

export async function getBundledGitPreparationState({ root = repositoryRoot } = {}) {
  const thirdParty = path.join(path.resolve(root), 'third_party')
  const destination = path.join(thirdParty, 'mingit')
  const ready = await Promise.all([
    pathExists(path.join(destination, 'cmd', 'git.exe')),
    pathExists(path.join(destination, 'mingw64', 'bin', 'git-credential-manager.exe')),
    pathExists(path.join(destination, 'mingw64', 'bin', 'git-lfs.exe')),
    pathExists(path.join(destination, METADATA_FILE))
  ])
  if (ready.every(Boolean)) return Object.freeze({ state: 'ready', canPrepare: false })
  const installing = await pathExists(path.join(thirdParty, INSTALL_MARKER_FILE))
  return Object.freeze({ state: installing ? 'installing' : 'missing', canPrepare: !installing })
}

export function normalizeZipPath(value) {
  const original = String(value || '')
  if (!original || original.includes('\0') || original.length > MAX_ENTRY_PATH) throw new Error('ZIP entry path is invalid.')
  const slash = original.replaceAll('\\', '/').replace(/\/$/, '')
  if (!slash || slash.startsWith('/') || /^[A-Za-z]:/u.test(slash)) throw new Error(`ZIP entry path is absolute: ${original}`)
  const parts = slash.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error(`ZIP entry path is unsafe: ${original}`)
  return parts.join('/')
}

function entryUnixType(entry) {
  return (Number(entry?.header?.attr || 0) >>> 16) & 0o170000
}

export function validateZipEntries(entries, maxUnpackedBytes) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ZIP_ENTRIES) throw new Error('ZIP entry count is invalid.')
  if (!Number.isSafeInteger(maxUnpackedBytes) || maxUnpackedBytes <= 0) throw new Error('ZIP unpacked-size limit is invalid.')
  let total = 0
  const seen = new Set()
  const validated = []
  for (const entry of entries) {
    const raw = String(entry?.entryName || '')
    const directory = Boolean(entry?.isDirectory) || raw.endsWith('/')
    const trimmed = raw.replace(/\/$/, '')
    if (!trimmed) continue
    const relativePath = normalizeZipPath(trimmed)
    const key = relativePath.toLowerCase()
    if (seen.has(key)) throw new Error(`ZIP contains a duplicate or case-conflicting path: ${relativePath}`)
    seen.add(key)
    if (entryUnixType(entry) === 0o120000) throw new Error(`ZIP symbolic links are forbidden: ${relativePath}`)
    const size = Number(entry?.header?.size || 0)
    if (!Number.isSafeInteger(size) || size < 0 || (directory && size !== 0)) throw new Error(`ZIP entry size is invalid: ${relativePath}`)
    total += size
    if (total > maxUnpackedBytes) throw new Error('ZIP unpacked size exceeds the fixed limit.')
    validated.push({ entry, relativePath, directory, size })
  }
  if (validated.length === 0) throw new Error('ZIP contains no usable entries.')
  return validated
}

function inside(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, ...normalizeZipPath(relativePath).split('/'))
  if (target === resolvedRoot || !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error('ZIP entry escapes its destination.')
  return target
}

export async function extractZipSafely(archivePath, destination, { maxUnpackedBytes, AdmZipImpl = AdmZip } = {}) {
  const archive = new AdmZipImpl(archivePath)
  const entries = validateZipEntries(archive.getEntries(), maxUnpackedBytes)
  await mkdir(destination, { recursive: true })
  for (const record of entries) {
    const target = inside(destination, record.relativePath)
    if (record.directory) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(path.dirname(target), { recursive: true })
    const data = record.entry.getData()
    if (!Buffer.isBuffer(data) || data.length !== record.size) throw new Error(`ZIP entry data size mismatch: ${record.relativePath}`)
    const handle = await open(target, 'wx', 0o600)
    try {
      await handle.writeFile(data)
    } finally {
      await handle.close()
    }
  }
}

export async function downloadAndVerifyAsset(asset, destination, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DOWNLOAD_TIMEOUT_MS
} = {}) {
  if (!asset || !/^https:\/\/github\.com\//u.test(asset.url) || !/^[0-9a-f]{64}$/u.test(asset.sha256)) throw new Error('Asset descriptor is not trusted.')
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('Asset size is invalid.')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let response
  try {
    response = await fetchImpl(asset.url, { redirect: 'follow', signal: controller.signal, headers: { 'user-agent': 'Harness-Desktop-bundled-git-preparer' } })
    if (!response?.ok || !response.body) throw new Error(`Download failed with HTTP ${response?.status || 'unknown'}.`)
    if (!String(response.url || asset.url).startsWith('https://')) throw new Error('Asset download redirected to a non-HTTPS URL.')
    const declaredLength = response.headers?.get?.('content-length')
    if (declaredLength !== null && declaredLength !== undefined && Number(declaredLength) !== asset.size) throw new Error('Asset Content-Length does not match the pinned size.')
    await mkdir(path.dirname(destination), { recursive: true })
    const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 })
    const digest = createHash('sha256')
    let bytes = 0
    try {
      for await (const chunk of response.body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > asset.size) throw new Error('Asset exceeds the pinned size.')
        digest.update(buffer)
        if (!output.write(buffer)) await new Promise(resolve => output.once('drain', resolve))
      }
      output.end()
      await finished(output)
    } catch (error) {
      output.destroy()
      await rm(destination, { force: true })
      throw error
    }
    if (bytes !== asset.size) {
      await rm(destination, { force: true })
      throw new Error('Asset size does not match the pinned size.')
    }
    if (digest.digest('hex') !== asset.sha256) {
      await rm(destination, { force: true })
      throw new Error('Asset SHA-256 does not match the pinned digest.')
    }
    return Object.freeze({ size: bytes, sha256: asset.sha256 })
  } finally {
    clearTimeout(timer)
  }
}

async function walkFiles(root, relative = '') {
  const current = relative ? inside(root, relative) : path.resolve(root)
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    const safe = normalizeZipPath(next)
    const info = await lstat(inside(root, safe))
    if (info.isSymbolicLink()) throw new Error(`Extracted tree contains a symbolic link: ${safe}`)
    if (info.isDirectory()) files.push(...await walkFiles(root, safe))
    else if (info.isFile()) files.push(safe)
    else throw new Error(`Extracted tree contains an unsupported file: ${safe}`)
    if (files.length > MAX_ZIP_ENTRIES) throw new Error('Extracted tree contains too many files.')
  }
  return files
}

function selectLicense(files, label) {
  const matches = files.filter(file => /(?:^|\/)(?:license|copying)(?:\.[a-z0-9-]+)?$/iu.test(file))
  if (matches.length === 0) throw new Error(`${label} archive does not contain license metadata.`)
  return matches.sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
}

async function installGcm(gcmRoot, mingitRoot, fallbackLicense) {
  const files = await walkFiles(gcmRoot)
  const executables = files.filter(file => path.posix.basename(file).toLowerCase() === 'git-credential-manager.exe')
  if (executables.length !== 1) throw new Error('GCM archive must contain exactly one git-credential-manager.exe.')
  const sourceRootRelative = path.posix.dirname(executables[0]) === '.' ? '' : path.posix.dirname(executables[0])
  const sourceRoot = sourceRootRelative ? inside(gcmRoot, sourceRootRelative) : path.resolve(gcmRoot)
  const sourceFiles = await walkFiles(sourceRoot)
  const bundledLicense = sourceFiles.find(file => /(?:^|\/)(?:license|copying)(?:\.[a-z0-9-]+)?$/iu.test(file)) || null
  if (!bundledLicense && !fallbackLicense) throw new Error('GCM archive does not contain license metadata and no audited fallback was provided.')
  const destination = path.join(mingitRoot, 'mingw64', 'bin')
  await mkdir(destination, { recursive: true })
  for (const relative of sourceFiles) {
    const target = inside(destination, relative)
    try {
      await access(target)
      // MinGit may already contain an older GCM payload. Both archives are pinned
      // and verified, so the separately pinned GCM release intentionally wins.
      await rm(target, { force: true })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await mkdir(path.dirname(target), { recursive: true })
    await cp(inside(sourceRoot, relative), target, { errorOnExist: true, force: false })
  }
  const license = bundledLicense || 'LICENSE.gcm.txt'
  if (!bundledLicense) await cp(path.resolve(fallbackLicense), path.join(destination, license), { errorOnExist: true, force: false })
  return path.posix.join('mingw64/bin', license)
}

async function installLfs(lfsRoot, mingitRoot, fallbackLicense) {
  const files = await walkFiles(lfsRoot)
  const executables = files.filter(file => path.posix.basename(file).toLowerCase() === 'git-lfs.exe')
  if (executables.length !== 1) throw new Error('Git LFS archive must contain exactly one git-lfs.exe.')
  const bundledLicense = files.find(file => /(?:^|\/)(?:license|copying)(?:\.[a-z0-9-]+)?$/iu.test(file)) || null
  if (!bundledLicense && !fallbackLicense) throw new Error('Git LFS archive does not contain license metadata and no audited fallback was provided.')
  const destination = path.join(mingitRoot, 'mingw64', 'bin')
  await mkdir(destination, { recursive: true })
  const executableTarget = path.join(destination, 'git-lfs.exe')
  await rm(executableTarget, { force: true })
  await cp(inside(lfsRoot, executables[0]), executableTarget, { errorOnExist: true, force: false })
  const licenseName = bundledLicense ? `git-lfs-${path.posix.basename(bundledLicense)}` : 'git-lfs-LICENSE.md'
  const licenseSource = bundledLicense ? inside(lfsRoot, bundledLicense) : path.resolve(fallbackLicense)
  await cp(licenseSource, path.join(destination, licenseName), { errorOnExist: true, force: false })
  return path.posix.join('mingw64/bin', licenseName)
}

async function renameWithWindowsRetries(source, destination) {
  let lastError
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try { return await rename(source, destination) } catch (error) {
      lastError = error
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)))
    }
  }
  throw lastError
}

async function replaceDirectoryAtomically(staged, destination) {
  const parent = path.dirname(destination)
  const backup = path.join(parent, `.${path.basename(destination)}.backup-${process.pid}-${Date.now()}`)
  let hadDestination = false
  try {
    await renameWithWindowsRetries(destination, backup)
    hadDestination = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await renameWithWindowsRetries(staged, destination)
    if (hadDestination) await rm(backup, { recursive: true, force: true })
  } catch (error) {
    if (hadDestination) await renameWithWindowsRetries(backup, destination).catch(() => {})
    throw error
  }
}

export async function prepareBundledGit({
  root = repositoryRoot,
  assets = ASSETS,
  fetchImpl = globalThis.fetch,
  AdmZipImpl = AdmZip,
  onStateChange
} = {}) {
  if (onStateChange !== undefined && typeof onStateChange !== 'function') throw new Error('Preparation state listener must be a function.')
  const notify = state => {
    try { onStateChange?.(Object.freeze(state)) } catch {}
  }
  const thirdParty = path.join(path.resolve(root), 'third_party')
  const marker = path.join(thirdParty, INSTALL_MARKER_FILE)
  await mkdir(thirdParty, { recursive: true })
  let markerHandle
  try {
    markerHandle = await open(marker, 'wx', 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('Bundled Git preparation is already in progress.')
    throw error
  }
  await markerHandle.close()
  notify({ state: 'installing', canPrepare: false })
  let temporary
  try {
    temporary = await mkdtemp(path.join(thirdParty, '.bundled-git-stage-'))
    const archives = path.join(temporary, 'archives')
    const mingitExtracted = path.join(temporary, 'mingit')
    const gcmExtracted = path.join(temporary, 'gcm')
    const lfsExtracted = path.join(temporary, 'lfs')
    for (const asset of [assets.mingit, assets.gcm, assets.lfs]) {
      await downloadAndVerifyAsset(asset, path.join(archives, asset.name), { fetchImpl })
    }
    await extractZipSafely(path.join(archives, assets.mingit.name), mingitExtracted, {
      maxUnpackedBytes: assets.mingit.maxUnpackedBytes, AdmZipImpl
    })
    await extractZipSafely(path.join(archives, assets.gcm.name), gcmExtracted, {
      maxUnpackedBytes: assets.gcm.maxUnpackedBytes, AdmZipImpl
    })
    await extractZipSafely(path.join(archives, assets.lfs.name), lfsExtracted, {
      maxUnpackedBytes: assets.lfs.maxUnpackedBytes, AdmZipImpl
    })
    const mingitFiles = await walkFiles(mingitExtracted)
    if (!mingitFiles.some(file => /(?:^|\/)cmd\/git\.exe$/iu.test(file))) throw new Error('MinGit archive is missing cmd/git.exe.')
    const mingitLicense = selectLicense(mingitFiles, 'MinGit')
    const gcmLicense = await installGcm(
      gcmExtracted,
      mingitExtracted,
      path.join(path.resolve(root), 'third_party', 'licenses', 'git-credential-manager-2.7.0-LICENSE.txt')
    )
    const lfsLicense = await installLfs(
      lfsExtracted,
      mingitExtracted,
      path.join(path.resolve(root), 'third_party', 'licenses', 'git-lfs-3.7.1-LICENSE.md')
    )
    const licenseFiles = { mingit: mingitLicense, gcm: gcmLicense, lfs: lfsLicense }
    const metadata = {
      schemaVersion: 1,
      architecture: 'x64',
      assets: [assets.mingit, assets.gcm, assets.lfs].map(asset => ({
        id: asset.id, version: asset.version, url: asset.url, size: asset.size,
        sha256: asset.sha256, license: asset.license,
        licenseFile: licenseFiles[asset.id]
      }))
    }
    await writeFile(path.join(mingitExtracted, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rm(archives, { recursive: true, force: true })
    await rm(gcmExtracted, { recursive: true, force: true })
    await rm(lfsExtracted, { recursive: true, force: true })
    const destination = path.join(thirdParty, 'mingit')
    await replaceDirectoryAtomically(mingitExtracted, destination)
    notify({ state: 'ready', canPrepare: false })
    return Object.freeze({ destination, metadata })
  } catch (error) {
    notify({ state: 'failed', canPrepare: true, reason: 'preparation-failed' })
    throw error
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
    await rm(marker, { force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareBundledGit()
  console.log('Verified bundled Git assets are ready.')
}
