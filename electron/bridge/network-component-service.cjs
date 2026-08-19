const { createHash } = require('node:crypto')
const path = require('node:path')
const { chmod, mkdir, readFile, rename, rm, writeFile } = require('node:fs/promises')
const { existsSync } = require('node:fs')
const AdmZip = require('adm-zip')

const MAX_COMPONENT_BYTES = 90 * 1024 * 1024

const EASYTIER_RELEASES = Object.freeze({
  'win32-x64': Object.freeze({
    version: '2.6.4',
    url: 'https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-windows-x86_64-v2.6.4.zip',
    sha256: '27af91e270e554709b048bd32327fefd2dfce5062ae1e8701af7550c6f525f84',
    executable: 'easytier-core.exe',
    files: Object.freeze(['easytier-core.exe', 'Packet.dll', 'WinDivert64.sys', 'wintun.dll'])
  }),
  'darwin-x64': Object.freeze({
    version: '2.6.4',
    url: 'https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-macos-x86_64-v2.6.4.zip',
    sha256: '89fc28a6e6995259d76ce3f11775220e8a21c760e94df91a6a9db30a69b6982e',
    executable: 'easytier-core',
    files: Object.freeze(['easytier-core'])
  }),
  'darwin-arm64': Object.freeze({
    version: '2.6.4',
    url: 'https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-macos-aarch64-v2.6.4.zip',
    sha256: '4be1882d1aa36d31c1d6ba0596f2cf8a097e371f8da124212324b2e0f8df7e4b',
    executable: 'easytier-core',
    files: Object.freeze(['easytier-core'])
  })
})

function easyTierRelease(platform = process.platform, arch = process.arch) {
  return EASYTIER_RELEASES[`${platform}-${arch}`] || null
}

function hashBuffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

function safeArchiveEntryName(value) {
  const normalized = String(value || '').replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null
  const parts = normalized.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) return null
  return parts.join('/')
}

function extractComponentFiles(zipBuffer, fileNames) {
  const archive = new AdmZip(zipBuffer)
  const result = new Map()
  for (const fileName of fileNames) {
    const matches = archive.getEntries().filter(entry => {
      const safeName = safeArchiveEntryName(entry.entryName)
      return safeName && !entry.isDirectory && path.posix.basename(safeName).toLowerCase() === fileName.toLowerCase()
    })
    if (matches.length !== 1) throw new Error(`网络组件压缩包中未找到唯一的 ${fileName}。`)
    const data = matches[0].getData()
    if (!data?.length || data.length > MAX_COMPONENT_BYTES) throw new Error(`网络组件文件 ${fileName} 大小异常。`)
    result.set(fileName, data)
  }
  return result
}

function extractExecutable(zipBuffer, executableName) {
  return extractComponentFiles(zipBuffer, [executableName]).get(executableName)
}

async function fetchComponent(url, fetchImpl, onProgress) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'Harness-Desktop-Network-Component/1'
    }
  })
  if (!response?.ok || !response.body) throw new Error(`网络组件下载失败（HTTP ${response?.status || 'unknown'}）。`)
  const advertised = Number(response.headers?.get?.('content-length') || 0)
  if (advertised > MAX_COMPONENT_BYTES) throw new Error('网络组件压缩包超过安全大小限制。')
  const chunks = []
  let received = 0
  for await (const value of response.body) {
    const chunk = Buffer.from(value)
    received += chunk.length
    if (received > MAX_COMPONENT_BYTES) throw new Error('网络组件压缩包超过安全大小限制。')
    chunks.push(chunk)
    onProgress?.({ received, total: advertised || 0 })
  }
  return Buffer.concat(chunks, received)
}

function createEasyTierComponentInstaller({
  componentRoot,
  fetchImpl,
  platform = process.platform,
  arch = process.arch,
  release: releaseOverride = null
}) {
  if (!componentRoot) throw new Error('EasyTier component installer requires componentRoot.')
  if (typeof fetchImpl !== 'function') throw new Error('EasyTier component installer requires fetchImpl().')
  let installing = null

  return async function ensureEasyTierComponent(onProgress) {
    const release = releaseOverride || easyTierRelease(platform, arch)
    if (!release) throw new Error('当前系统暂不支持内置 EasyTier 网络组件。')
    const destinationDir = path.join(componentRoot, 'easytier')
    const destination = path.join(destinationDir, release.executable)
    const versionFile = path.join(destinationDir, 'version.json')
    const requiredFiles = release.files || [release.executable]
    if (requiredFiles.every(fileName => existsSync(path.join(destinationDir, fileName))) && existsSync(versionFile)) {
      try {
        const metadata = JSON.parse(await readFile(versionFile, 'utf8'))
        if (metadata.version === release.version && metadata.archiveSha256 === release.sha256) return destination
      } catch {}
    }
    if (installing) return installing

    installing = (async () => {
      await mkdir(destinationDir, { recursive: true })
      const archive = await fetchComponent(release.url, fetchImpl, onProgress)
      const archiveSha256 = hashBuffer(archive)
      if (archiveSha256 !== release.sha256) throw new Error('网络组件 SHA-256 校验失败，已拒绝安装。')
      const files = extractComponentFiles(archive, requiredFiles)
      const stagingSuffix = `.staging-${process.pid}-${Date.now()}`
      const stagedFiles = []
      try {
        for (const [fileName, data] of files) {
          const staging = path.join(destinationDir, `${fileName}${stagingSuffix}`)
          stagedFiles.push(staging)
          await writeFile(staging, data, { mode: fileName === release.executable ? 0o700 : 0o600 })
          if (platform !== 'win32' && fileName === release.executable) await chmod(staging, 0o700)
        }
        for (const [fileName] of files) {
          const target = path.join(destinationDir, fileName)
          const staging = path.join(destinationDir, `${fileName}${stagingSuffix}`)
          await rm(target, { force: true })
          await rename(staging, target)
        }
        await writeFile(versionFile, `${JSON.stringify({
          component: 'EasyTier',
          version: release.version,
          source: release.url,
          archiveSha256,
          license: 'LGPL-3.0'
        }, null, 2)}\n`, { mode: 0o600 })
      } finally {
        await Promise.all(stagedFiles.map(file => rm(file, { force: true }).catch(() => {})))
      }
      return destination
    })().finally(() => { installing = null })
    return installing
  }
}

module.exports = {
  EASYTIER_RELEASES,
  MAX_COMPONENT_BYTES,
  createEasyTierComponentInstaller,
  easyTierRelease,
  extractComponentFiles,
  extractExecutable,
  hashBuffer,
  safeArchiveEntryName
}
