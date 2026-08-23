const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { constants, createReadStream } = require('node:fs')
const { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink } = require('node:fs/promises')
const { Readable } = require('node:stream')

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])
const MAX_WALLPAPER_LIBRARY_BYTES = 8 * 1024 * 1024 * 1024
const WALLPAPER_LIBRARY_QUOTA_MESSAGE = '壁纸库的受控本地副本总量最多为 8 GB，请先移除不再使用的壁纸。'
const MANAGED_WALLPAPER_FILE_PATTERN = /^(?:custom-background|wallpaper-[a-z0-9-]{1,80})\.(?:png|jpe?g|webp|gif|apng|mp4|webm)$/i
const TEMPORARY_WALLPAPER_FILE_PATTERN = /^\.(?:custom-background|wallpaper-[a-z0-9-]{1,80})\.(?:png|jpe?g|webp|gif|apng|mp4|webm)\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i
const WALLPAPER_LIBRARY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/

function wallpaperKind(file) {
  const extension = path.extname(String(file || '')).toLowerCase()
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  return null
}

function wallpaperMime(file) {
  const extension = path.extname(String(file || '')).toLowerCase()
  return {
    '.png': 'image/png', '.apng': 'image/apng', '.gif': 'image/gif',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.webm': 'video/webm'
  }[extension] || 'application/octet-stream'
}

// Library cards use the same managed protocol for both images and videos.
// Keeping URL construction here makes the renderer contract independent of
// the original source path and prevents arbitrary path material from entering
// a privileged custom-scheme URL.
function wallpaperMediaRevision(info = {}) {
  const mtimeMs = Number(info.mtimeMs)
  const size = Number(info.size)
  if (!Number.isFinite(mtimeMs) || mtimeMs < 0 || !Number.isSafeInteger(size) || size < 0) return null
  return `${Math.round(mtimeMs)}-${size}`
}

function wallpaperLibraryMediaUrl(id, info = {}) {
  const normalizedId = String(id || '').toLowerCase()
  const revision = wallpaperMediaRevision(info)
  if (!WALLPAPER_LIBRARY_ID_PATTERN.test(normalizedId) || !revision) return null
  return `harness-wallpaper://library/${encodeURIComponent(normalizedId)}/media?v=${revision}`
}

function safeManagedWallpaperPath(root, cachedFile) {
  const fileName = String(cachedFile || '')
  if (!MANAGED_WALLPAPER_FILE_PATTERN.test(fileName) || path.basename(fileName) !== fileName) return null
  const resolvedRoot = path.resolve(root)
  const resolvedFile = path.resolve(resolvedRoot, fileName)
  return path.dirname(resolvedFile) === resolvedRoot ? resolvedFile : null
}

function isManagedWallpaperFileName(fileName) {
  const value = String(fileName || '')
  return path.basename(value) === value && MANAGED_WALLPAPER_FILE_PATTERN.test(value)
}

function isTemporaryWallpaperFileName(fileName) {
  const value = String(fileName || '')
  return path.basename(value) === value && TEMPORARY_WALLPAPER_FILE_PATTERN.test(value)
}

function wallpaperStorageNameKey(value, platform = process.platform) {
  const name = path.basename(String(value || ''))
  return platform === 'win32' ? name.toLowerCase() : name
}

async function wallpaperStorageUsageBytes(directory, options = {}, injected = {}) {
  const directoryValue = String(directory || '').trim()
  if (!directoryValue) throw new TypeError('Wallpaper storage directory is required.')
  const root = path.resolve(directoryValue)
  const excluded = new Set((Array.isArray(options.excludeFileNames) ? options.excludeFileNames : [])
    .map(value => wallpaperStorageNameKey(value, options.platform)))
  const readDirectory = injected.readdir || readdir
  const inspect = injected.lstat || lstat
  const entries = await readDirectory(root, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const sizes = await Promise.all(entries.map(async entry => {
    const name = String(entry?.name || '')
    if (excluded.has(wallpaperStorageNameKey(name, options.platform)) || (!isManagedWallpaperFileName(name) && !isTemporaryWallpaperFileName(name))) return 0
    const info = await inspect(path.join(root, name)).catch(error => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    return info?.isFile() ? info.size : 0
  }))
  return sizes.reduce((sum, size) => sum + size, 0)
}

async function cleanupOrphanedWallpaperStorage(directory, referencedFileNames = [], injected = {}) {
  const directoryValue = String(directory || '').trim()
  if (!directoryValue) throw new TypeError('Wallpaper storage directory is required.')
  const root = path.resolve(directoryValue)
  const referenced = new Set((Array.isArray(referencedFileNames) ? referencedFileNames : [])
    .filter(isManagedWallpaperFileName)
    .map(value => wallpaperStorageNameKey(value, injected.platform)))
  const readDirectory = injected.readdir || readdir
  const remove = injected.unlink || unlink
  const entries = await readDirectory(root, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const deleted = []
  const failed = []
  for (const entry of entries) {
    const name = String(entry?.name || '')
    const removable = isTemporaryWallpaperFileName(name) || (isManagedWallpaperFileName(name) && !referenced.has(wallpaperStorageNameKey(name, injected.platform)))
    if (!removable || entry?.isDirectory?.()) continue
    try {
      await remove(path.join(root, name))
      deleted.push(name)
    } catch {
      failed.push(name)
    }
  }
  return { deleted, failed }
}

function pathEscapesRoot(root, candidate) {
  const relative = path.relative(root, candidate)
  return path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)
}

function safeProjectMediaPath(projectFile, relative) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error('Wallpaper Engine 项目没有可用的媒体文件。')
  const root = path.dirname(path.resolve(projectFile))
  const media = path.resolve(root, relative)
  if (pathEscapesRoot(root, media)) throw new Error('Wallpaper Engine 媒体路径越过了项目目录。')
  return media
}

async function revalidateProjectMediaPath(projectRoot, mediaFile) {
  const [realRoot, realMedia] = await Promise.all([realpath(projectRoot), realpath(mediaFile)])
  if (pathEscapesRoot(realRoot, realMedia)) throw new Error('Wallpaper Engine 媒体真实路径越过了项目目录。')
  return { projectRoot: realRoot, file: realMedia }
}

async function assertWallpaperLibraryCapacity(items, options = {}) {
  const replacingId = options.replacingId == null ? null : String(options.replacingId)
  const incomingBytes = Number(options.incomingBytes)
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0 || typeof options.sizeOf !== 'function') {
    throw new TypeError('Wallpaper library capacity inputs are invalid.')
  }
  const storedBytes = (await Promise.all((Array.isArray(items) ? items : [])
    .filter(item => replacingId === null || String(item?.id || '') !== replacingId)
    .map(async item => {
      const size = Number(await options.sizeOf(item))
      if (!Number.isSafeInteger(size) || size < 0) throw new TypeError('Wallpaper library item size is invalid.')
      return size
    }))).reduce((sum, size) => sum + size, 0)
  const finalBytes = storedBytes + incomingBytes
  if (finalBytes > MAX_WALLPAPER_LIBRARY_BYTES) throw new Error(WALLPAPER_LIBRARY_QUOTA_MESSAGE)
  return finalBytes
}

function createWallpaperMutationQueue() {
  let tail = Promise.resolve()
  return {
    run(operation) {
      if (typeof operation !== 'function') return Promise.reject(new TypeError('Wallpaper mutation must be a function.'))
      const invoke = () => operation()
      const result = tail.then(invoke, invoke)
      tail = result.then(() => undefined, () => undefined)
      return result
    }
  }
}

async function installManagedWallpaperCopy(options = {}, injected = {}) {
  const sourceValue = String(options.source || '').trim()
  const directoryValue = String(options.directory || '').trim()
  const source = path.resolve(sourceValue || '.')
  const directory = path.resolve(directoryValue || '.')
  const fileName = String(options.fileName || '')
  const finalFile = safeManagedWallpaperPath(directory, fileName)
  const expectedKind = String(options.expectedKind || '')
  const maximumBytes = Number(options.maximumBytes)
  if (!sourceValue || !directoryValue || !finalFile || !['image', 'video'].includes(expectedKind) || wallpaperKind(finalFile) !== expectedKind || !Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError('Managed wallpaper copy inputs are invalid.')
  }
  const operations = {
    copyFile: injected.copyFile || copyFile,
    lstat: injected.lstat || lstat,
    mkdir: injected.mkdir || mkdir,
    rename: injected.rename || rename,
    unlink: injected.unlink || unlink
  }
  const temporaryFile = path.join(directory, `.${fileName}.${randomUUID().toLowerCase()}.tmp`)
  const existingFinal = await operations.lstat(finalFile).catch(error => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (existingFinal) throw new Error('Managed wallpaper destination already exists.')
  try {
    await operations.mkdir(directory, { recursive: true })
    await operations.copyFile(source, temporaryFile, constants.COPYFILE_EXCL)
    const copiedInfo = await operations.lstat(temporaryFile)
    if (!copiedInfo.isFile() || copiedInfo.size > maximumBytes) {
      throw new Error(expectedKind === 'video' ? '视频壁纸必须小于 2 GB。' : '图片壁纸必须小于 50 MB。')
    }
    const copyContext = { temporaryFile, finalFile }
    if (typeof options.afterCopyValidate === 'function') await options.afterCopyValidate(copiedInfo, copyContext)
    if (typeof options.beforeFinalize === 'function') await options.beforeFinalize(copiedInfo, copyContext)
    await operations.rename(temporaryFile, finalFile)
    return { fileName, file: finalFile, info: copiedInfo }
  } catch (error) {
    await operations.unlink(temporaryFile).catch(() => {})
    await operations.unlink(finalFile).catch(() => {})
    throw error
  }
}

function parseByteRange(value, size) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim())
  if (!match || (!match[1] && !match[2]) || size <= 0) throw new RangeError('Invalid byte range.')
  let start
  let end
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new RangeError('Invalid byte range.')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new RangeError('Invalid byte range.')
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

async function createWallpaperVideoResponse(file, request = {}) {
  if (wallpaperKind(file) !== 'video') return new Response('Unsupported media type', { status: 415 })
  const info = await stat(file)
  if (!info.isFile()) return new Response('Not found', { status: 404 })
  const rangeHeader = request.headers?.get?.('range') || request.headers?.range || request.headers?.Range || ''
  let range
  try {
    range = parseByteRange(rangeHeader, info.size)
  } catch {
    return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${info.size}` } })
  }
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'Content-Type': wallpaperMime(file),
    'Content-Length': String(range ? range.end - range.start + 1 : info.size)
  }
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`
  const body = String(request.method || 'GET').toUpperCase() === 'HEAD'
    ? null
    : Readable.toWeb(createReadStream(file, range || undefined))
  return new Response(body, { status: range ? 206 : 200, headers })
}

async function createWallpaperMediaResponse(file, request = {}) {
  const kind = wallpaperKind(file)
  if (kind === 'video') return createWallpaperVideoResponse(file, request)
  if (kind !== 'image') return new Response('Unsupported media type', { status: 415 })
  const info = await stat(file)
  if (!info.isFile()) return new Response('Not found', { status: 404 })
  const headers = {
    'Accept-Ranges': 'none',
    'Cache-Control': 'private, no-store',
    'Content-Type': wallpaperMime(file),
    'Content-Length': String(info.size)
  }
  const body = String(request.method || 'GET').toUpperCase() === 'HEAD'
    ? null
    : Readable.toWeb(createReadStream(file))
  return new Response(body, { status: 200, headers })
}

async function resolveWallpaperEngineInput(input) {
  const source = path.resolve(input)
  const info = await stat(source)
  const projectFile = info.isDirectory() ? path.join(source, 'project.json') : source
  if (!info.isDirectory() && path.basename(projectFile).toLowerCase() !== 'project.json') throw new Error('请选择 Wallpaper Engine 项目目录或 project.json。')
  return resolveWallpaperEngineProject(projectFile)
}

async function resolveWallpaperEngineProject(projectFile) {
  const resolvedProjectFile = path.resolve(projectFile)
  const lexicalRoot = path.dirname(resolvedProjectFile)
  const [projectRoot, realProjectFile] = await Promise.all([realpath(lexicalRoot), realpath(resolvedProjectFile)])
  if (pathEscapesRoot(projectRoot, realProjectFile)) throw new Error('Wallpaper Engine project.json 真实路径越过了项目目录。')
  const document = JSON.parse(await readFile(realProjectFile, 'utf8'))
  const type = String(document?.type || '').toLowerCase()
  if (!['image', 'video'].includes(type)) {
    throw new Error('仅支持 Wallpaper Engine 的图片和视频项目；scene、web 与 application 项目不会执行。')
  }
  const media = safeProjectMediaPath(realProjectFile, document.file)
  const kind = wallpaperKind(media)
  if (!kind || kind !== type) throw new Error(`Wallpaper Engine ${type} 项目的媒体格式不受支持。`)
  const validated = await revalidateProjectMediaPath(projectRoot, media)
  const info = await stat(validated.file)
  if (!info.isFile()) throw new Error('Wallpaper Engine 项目媒体不是普通文件。')
  return { file: validated.file, kind, title: String(document.title || path.basename(projectRoot)).slice(0, 160), projectRoot }
}

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MEDIA_EXTENSIONS,
  MAX_WALLPAPER_LIBRARY_BYTES,
  WALLPAPER_LIBRARY_QUOTA_MESSAGE,
  wallpaperKind,
  wallpaperMime,
  wallpaperMediaRevision,
  wallpaperLibraryMediaUrl,
  safeManagedWallpaperPath,
  isManagedWallpaperFileName,
  isTemporaryWallpaperFileName,
  wallpaperStorageUsageBytes,
  cleanupOrphanedWallpaperStorage,
  assertWallpaperLibraryCapacity,
  createWallpaperMutationQueue,
  installManagedWallpaperCopy,
  parseByteRange,
  createWallpaperMediaResponse,
  createWallpaperVideoResponse,
  safeProjectMediaPath,
  revalidateProjectMediaPath,
  resolveWallpaperEngineInput,
  resolveWallpaperEngineProject
}
