import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const name = 'session-experience'
const inject = ['agents', 'webServer']
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_LIST_ITEMS = 100
const UPLOAD_DIRECTORY = 'uploads'

function json(res, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

function trustedRequest(req) {
  const rawHost = req.headers.host
  if (typeof rawHost !== 'string') return false
  let host
  try { host = new URL(`http://${rawHost}`).hostname.toLowerCase() } catch { return false }
  if (!['127.0.0.1', 'localhost'].includes(host)) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && parsed.host.toLowerCase() === rawHost.toLowerCase() && ['127.0.0.1', 'localhost'].includes(parsed.hostname.toLowerCase())
  } catch { return false }
}

function query(req) {
  return new URL(req.url, 'http://local').searchParams
}

function requiredQuery(params, key, max = 4096) {
  const value = params.get(key)
  if (typeof value !== 'string' || !value || value.length > max || value.trim() !== value) throw new TypeError(`${key} must be a non-empty string`)
  return value
}

function rootAgent(ctx, sessionId) {
  const agent = ctx.agents.get(sessionId)
  if (!agent || !ctx.agents.roots().includes(agent)) throw Object.assign(new Error('当前会话尚未运行。'), { status: 409, code: 'SESSION_NOT_LIVE' })
  const cwd = agent.session?.header?.cwd
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw Object.assign(new Error('当前会话没有可用的工作目录。'), { status: 409, code: 'SESSION_NO_WORKSPACE' })
  return { agent, cwd }
}

function safeFileName(value) {
  const normalized = String(value || '').normalize('NFC').replace(/[\\/\u0000-\u001f\u007f]/gu, '_').replace(/^\.+/u, '').trim().slice(0, 160)
  if (!normalized || normalized === '.' || normalized === '..') throw new TypeError('invalid file name')
  return normalized
}

function inside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function workspaceRoot(cwd) {
  const root = await realpath(cwd)
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('workspace is not a directory')
  return root
}

async function uploadRoot(cwd) {
  const root = await workspaceRoot(cwd)
  const directory = path.join(root, UPLOAD_DIRECTORY)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const resolved = await realpath(directory)
  if (!inside(root, resolved)) throw new Error('upload directory escapes workspace')
  return { root, directory: resolved }
}

async function collectBody(req, limit = MAX_UPLOAD_BYTES) {
  const advertised = Number(req.headers['content-length'] || 0)
  if (Number.isFinite(advertised) && advertised > limit) throw Object.assign(new Error('附件超过 50 MB 上传限制。'), { status: 413, code: 'ATTACH_TOO_LARGE' })
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.from(chunk)
    size += value.length
    if (size > limit) throw Object.assign(new Error('附件超过 50 MB 上传限制。'), { status: 413, code: 'ATTACH_TOO_LARGE' })
    chunks.push(value)
  }
  if (!size) throw Object.assign(new Error('不能上传空请求。'), { status: 400, code: 'ATTACH_EMPTY' })
  return Buffer.concat(chunks, size)
}

function collisionName(fileName, sequence) {
  if (sequence === 0) return fileName
  const extension = path.extname(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  return `${stem}-${sequence}${extension}`
}

async function saveUpload(cwd, fileName, content) {
  const { root, directory } = await uploadRoot(cwd)
  const safe = safeFileName(fileName)
  for (let sequence = 0; sequence < 10_000; sequence += 1) {
    const candidate = path.join(directory, collisionName(safe, sequence))
    if (!inside(directory, candidate)) throw new Error('invalid upload path')
    const temporary = `${candidate}.${process.pid}.${Date.now()}.tmp`
    let handle
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(content)
      await handle.sync()
      await handle.close()
      handle = null
      try {
        await lstat(candidate)
        await rm(temporary, { force: true })
        continue
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await rename(temporary, candidate)
      const relativePath = path.relative(root, candidate).split(path.sep).join('/')
      return { path: relativePath, name: path.basename(candidate), size: content.length }
    } catch (error) {
      await handle?.close().catch(() => {})
      await rm(temporary, { force: true }).catch(() => {})
      if (error.code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error('too many files with the same name')
}

async function listUploads(cwd) {
  let roots
  try { roots = await uploadRoot(cwd) } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const entries = await readdir(roots.directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (files.length >= MAX_LIST_ITEMS || !entry.isFile()) continue
    const candidate = path.join(roots.directory, entry.name)
    const resolved = await realpath(candidate).catch(() => null)
    if (!resolved || !inside(roots.directory, resolved)) continue
    const info = await stat(resolved).catch(() => null)
    if (!info?.isFile()) continue
    files.push({ path: path.relative(roots.root, resolved).split(path.sep).join('/'), name: entry.name, size: info.size, modifiedAt: info.mtime.toISOString() })
  }
  return files.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.name.localeCompare(right.name))
}

async function resolveDownload(cwd, requestedPath) {
  const root = await workspaceRoot(cwd)
  if (typeof requestedPath !== 'string' || !requestedPath || path.isAbsolute(requestedPath) || requestedPath.includes('\u0000')) throw Object.assign(new Error('下载路径必须是工作区内的相对路径。'), { status: 400, code: 'ATTACH_INVALID_PATH' })
  const candidate = path.resolve(root, requestedPath)
  if (!inside(root, candidate)) throw Object.assign(new Error('下载路径超出工作区。'), { status: 403, code: 'ATTACH_PATH_ESCAPE' })
  const resolved = await realpath(candidate).catch(() => null)
  if (!resolved || !inside(root, resolved)) throw Object.assign(new Error('文件不存在或超出工作区。'), { status: 404, code: 'ATTACH_NOT_FOUND' })
  const info = await stat(resolved)
  if (!info.isFile()) throw Object.assign(new Error('只能下载普通文件。'), { status: 400, code: 'ATTACH_NOT_REGULAR' })
  if (info.size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('附件超过下载限制。'), { status: 413, code: 'ATTACH_DOWNLOAD_TOO_LARGE' })
  return { resolved, info, name: path.basename(resolved) }
}

function downloadHeaders(name) {
  const ascii = name.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_') || 'download'
  return {
    'content-type': 'application/octet-stream',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
}

function errorPayload(error) {
  return { error: error?.message || String(error), code: error?.code || 'ATTACH_INTERNAL_ERROR' }
}

function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/session-experience/upload', handler: async (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed', code: 'ATTACH_METHOD_NOT_ALLOWED' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden', code: 'ATTACH_FORBIDDEN' })
      try {
        const params = query(req)
        const sessionId = requiredQuery(params, 'sessionId', 256)
        const fileName = requiredQuery(params, 'name', 512)
        const { cwd } = rootAgent(ctx, sessionId)
        const saved = await saveUpload(cwd, fileName, await collectBody(req))
        return json(res, 201, { schemaVersion: 1, file: saved })
      } catch (error) { return json(res, error.status || 400, errorPayload(error)) }
    }
  }), 'session-experience upload route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/session-experience/files', handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed', code: 'ATTACH_METHOD_NOT_ALLOWED' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden', code: 'ATTACH_FORBIDDEN' })
      try {
        const sessionId = requiredQuery(query(req), 'sessionId', 256)
        const { cwd } = rootAgent(ctx, sessionId)
        return json(res, 200, { schemaVersion: 1, sessionId, uploadDirectory: UPLOAD_DIRECTORY, maxUploadBytes: MAX_UPLOAD_BYTES, files: await listUploads(cwd) })
      } catch (error) { return json(res, error.status || 400, errorPayload(error)) }
    }
  }), 'session-experience files route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/session-experience/download', handler: async (req, res) => {
      if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed', code: 'ATTACH_METHOD_NOT_ALLOWED' })
      if (!trustedRequest(req)) return json(res, 403, { error: 'forbidden', code: 'ATTACH_FORBIDDEN' })
      try {
        const params = query(req)
        const sessionId = requiredQuery(params, 'sessionId', 256)
        const requestedPath = requiredQuery(params, 'path', 4096)
        const { cwd } = rootAgent(ctx, sessionId)
        const file = await resolveDownload(cwd, requestedPath)
        res.writeHead(200, downloadHeaders(file.name))
        createReadStream(file.resolved).on('error', () => { if (!res.destroyed) res.destroy() }).pipe(res)
      } catch (error) { return json(res, error.status || 400, errorPayload(error)) }
    }
  }), 'session-experience download route')
}

export {
  MAX_UPLOAD_BYTES, UPLOAD_DIRECTORY, apply, collectBody, downloadHeaders, inject,
  listUploads, name, resolveDownload, safeFileName, saveUpload, trustedRequest
}