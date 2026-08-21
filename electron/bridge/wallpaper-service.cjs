const path = require('node:path')
const { createReadStream } = require('node:fs')
const { readFile, stat } = require('node:fs/promises')
const { Readable } = require('node:stream')

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm'])
const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])

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

function safeProjectMediaPath(projectFile, relative) {
  if (typeof relative !== 'string' || !relative.trim()) throw new Error('Wallpaper Engine 项目没有可用的媒体文件。')
  const root = path.dirname(path.resolve(projectFile))
  const media = path.resolve(root, relative)
  const prefix = `${root}${path.sep}`
  if (media !== root && !media.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error('Wallpaper Engine 媒体路径越过了项目目录。')
  return media
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

async function resolveWallpaperEngineInput(input) {
  const source = path.resolve(input)
  const info = await stat(source)
  const projectFile = info.isDirectory() ? path.join(source, 'project.json') : source
  if (!info.isDirectory() && path.basename(projectFile).toLowerCase() !== 'project.json') throw new Error('请选择 Wallpaper Engine 项目目录或 project.json。')
  return resolveWallpaperEngineProject(projectFile)
}

async function resolveWallpaperEngineProject(projectFile) {
  const document = JSON.parse(await readFile(projectFile, 'utf8'))
  const type = String(document?.type || '').toLowerCase()
  if (!['image', 'video'].includes(type)) {
    throw new Error('仅支持 Wallpaper Engine 的图片和视频项目；scene、web 与 application 项目不会执行。')
  }
  const media = safeProjectMediaPath(projectFile, document.file)
  const kind = wallpaperKind(media)
  if (!kind || kind !== type) throw new Error(`Wallpaper Engine ${type} 项目的媒体格式不受支持。`)
  const info = await stat(media)
  if (!info.isFile()) throw new Error('Wallpaper Engine 项目媒体不是普通文件。')
  return { file: media, kind, title: String(document.title || path.basename(path.dirname(projectFile))).slice(0, 160) }
}

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MEDIA_EXTENSIONS,
  wallpaperKind,
  wallpaperMime,
  parseByteRange,
  createWallpaperVideoResponse,
  safeProjectMediaPath,
  resolveWallpaperEngineInput,
  resolveWallpaperEngineProject
}
