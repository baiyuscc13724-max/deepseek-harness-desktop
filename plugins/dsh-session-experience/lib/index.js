import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const name = 'session-experience'
const inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjectionCache', 'sessionQuery', 'workspaceRegistry', 'webServer']
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_LIST_ITEMS = 100
const UPLOAD_DIRECTORY = 'uploads'
const HISTORY_DELETE_CONFIRMATION = 'permanent'
const SESSION_LOG_NAMES = new Set(['session.jsonl', 'session.jsonl.zstd'])
const historyDeleteTails = new WeakMap()

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

function historyError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status })
}

function encodeSessionSegment(raw) {
  if (typeof raw !== 'string' || !raw) throw historyError('会话 ID 无效。', 'SESSION_HISTORY_INVALID_ID', 400)
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let encoded = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index)
    const character = String.fromCharCode(code)
    encoded += character !== '~' && /^[A-Za-z0-9._-]$/u.test(character)
      ? character
      : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return encoded
}

function archivedIds(registry) {
  const ids = registry?.archivedSessionIds
  return Array.isArray(ids) ? ids : (ids instanceof Set ? [...ids] : [])
}

function sessionIsLive(ctx, sessionId) {
  return Boolean(ctx.sessions?.get?.(sessionId) || ctx.agents?.get?.(sessionId))
}

function assertSessionDirectory(root, directory, sessionId) {
  const relative = path.relative(root, directory)
  const segments = relative.split(path.sep).filter(Boolean)
  if (!inside(root, directory) || segments.length !== 2 || segments[1] !== encodeSessionSegment(sessionId) || directory === root) {
    throw historyError('会话日志路径校验失败，未执行删除。', 'SESSION_HISTORY_UNSAFE_PATH', 409)
  }
}

async function resolveSessionArtifact(persistence, header) {
  if (!persistence || typeof persistence.locate !== 'function' || typeof persistence.list !== 'function') {
    throw historyError('当前会话存储不支持安全删除。', 'SESSION_HISTORY_DELETE_UNSUPPORTED', 501)
  }
  const location = await persistence.locate(header)
  if (!location || location.kind !== 'jsonl' || typeof location.path !== 'string' || typeof persistence.root !== 'string') {
    throw historyError('当前会话存储不支持安全删除。', 'SESSION_HISTORY_DELETE_UNSUPPORTED', 501)
  }
  const configuredRoot = path.resolve(persistence.root)
  const configuredArtifact = path.resolve(location.path)
  const configuredDirectory = path.dirname(configuredArtifact)
  assertSessionDirectory(configuredRoot, configuredDirectory, header.id)
  if (!SESSION_LOG_NAMES.has(path.basename(configuredArtifact))) {
    throw historyError('会话日志路径校验失败，未执行删除。', 'SESSION_HISTORY_UNSAFE_PATH', 409)
  }
  const root = await realpath(configuredRoot)
  let artifact
  try { artifact = await realpath(configuredArtifact) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    let directory
    try { directory = await realpath(configuredDirectory) } catch (directoryError) {
      if (directoryError?.code === 'ENOENT') return null
      throw directoryError
    }
    assertSessionDirectory(root, directory, header.id)
    if (!(await lstat(directory)).isDirectory()) {
      throw historyError('会话目录不是可安全删除的普通目录。', 'SESSION_HISTORY_UNSAFE_ARTIFACT', 409)
    }
    return { artifact: null, directory }
  }
  const directory = path.dirname(artifact)
  assertSessionDirectory(root, directory, header.id)
  if (!SESSION_LOG_NAMES.has(path.basename(artifact))) {
    throw historyError('会话日志路径校验失败，未执行删除。', 'SESSION_HISTORY_UNSAFE_PATH', 409)
  }
  const artifactInfo = await lstat(artifact)
  const directoryInfo = await lstat(directory)
  if (!artifactInfo.isFile() || !directoryInfo.isDirectory()) {
    throw historyError('会话日志不是可安全删除的普通文件。', 'SESSION_HISTORY_UNSAFE_ARTIFACT', 409)
  }
  return { artifact, directory }
}

async function detachSessionMemberships(registry, sessionId) {
  const errors = []
  let workspaces
  try { workspaces = typeof registry.list === 'function' ? registry.list() : [] } catch (error) { return [error] }
  for (const workspace of workspaces) {
    if (!workspace || typeof workspace.detachSession !== 'function') continue
    if (Array.isArray(workspace.sessionIds) && !workspace.sessionIds.includes(sessionId)) continue
    try { await workspace.detachSession(sessionId) } catch (error) { errors.push(error) }
  }
  return errors
}

async function deleteProjectionCheckpoint(ctx, sessionId) {
  const cache = ctx.sessionProjectionCache || (typeof ctx.get === 'function' ? ctx.get('sessionProjectionCache') : undefined)
  if (!cache || typeof cache.requireTable !== 'function') return
  const table = cache.requireTable()
  if (table && typeof table.delete === 'function') await table.delete(sessionId)
}

async function reconcileOpenSessionQuery(ctx) {
  let sessionQuery = ctx.sessionQuery
  if (!sessionQuery && typeof ctx.get === 'function') {
    try { sessionQuery = ctx.get('sessionQuery') } catch (_) {}
  }
  if (!sessionQuery?._db || typeof sessionQuery._serialized !== 'function' || typeof sessionQuery._reconcile !== 'function') return
  await sessionQuery._serialized(undefined, () => sessionQuery._reconcile(undefined))
}

async function forgetArchivedSession(registry, sessionId) {
  const commit = async () => {
    const state = registry.requireState()
    registry.headers?.delete?.(sessionId)
    registry.sessionPaths?.delete?.(sessionId)
    registry.invalidSessionPaths?.delete?.(sessionId)
    if (typeof registry.rebuildEntities === 'function') registry.rebuildEntities()
    if (!Array.isArray(state.archivedSessionIds) || !state.archivedSessionIds.includes(sessionId)) return
    await registry.setState({ ...state, archivedSessionIds: state.archivedSessionIds.filter(id => id !== sessionId) })
  }
  return typeof registry.enqueueOperation === 'function' ? registry.enqueueOperation(commit) : commit()
}

async function deleteArchivedSessionUnlocked(ctx, sessionId) {
  const registry = ctx.workspaceRegistry
  const persistence = ctx.sessionPersistence
  if (!registry || !archivedIds(registry).includes(sessionId)) {
    throw historyError('只能删除归档历史中的会话。', 'SESSION_HISTORY_NOT_ARCHIVED', 409)
  }
  if (sessionIsLive(ctx, sessionId)) {
    throw historyError('该会话仍处于活动状态，无法删除。', 'SESSION_HISTORY_STILL_LIVE', 409)
  }
  if (!persistence || typeof persistence.list !== 'function') {
    throw historyError('当前会话存储不支持安全删除。', 'SESSION_HISTORY_DELETE_UNSUPPORTED', 501)
  }
  const listed = await persistence.list()
  if (!Array.isArray(listed)) throw historyError('会话存储返回了无效列表。', 'SESSION_HISTORY_DELETE_UNSUPPORTED', 501)
  const header = listed.find(item => item?.id === sessionId) || registry.headers?.get?.(sessionId)
  const target = header ? await resolveSessionArtifact(persistence, header) : null
  if (sessionIsLive(ctx, sessionId) || !archivedIds(registry).includes(sessionId)) {
    throw historyError('会话状态已变化，未执行删除。', 'SESSION_HISTORY_STATE_CHANGED', 409)
  }
  if (target) await rm(target.directory, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 })
  const afterDelete = await persistence.list()
  if (!Array.isArray(afterDelete)) throw historyError('删除后无法验证会话存储状态；请重试删除。', 'SESSION_HISTORY_CLEANUP_INCOMPLETE', 500)
  if (sessionIsLive(ctx, sessionId) || afterDelete.some(item => item?.id === sessionId)) {
    throw historyError('会话在删除期间重新变为活动状态；未清理索引，请稍后重试。', 'SESSION_HISTORY_DELETE_RACE', 409)
  }
  const cleanupErrors = await detachSessionMemberships(registry, sessionId)
  try { await deleteProjectionCheckpoint(ctx, sessionId) } catch (error) { cleanupErrors.push(error) }
  try { await reconcileOpenSessionQuery(ctx) } catch (error) { cleanupErrors.push(error) }
  if (cleanupErrors.length > 0) {
    ctx.logger?.warn?.(`session history deletion for ${JSON.stringify(sessionId)} needs cleanup retry: ${cleanupErrors.map(String).join('; ')}`)
    const error = historyError('会话日志已删除，但部分索引尚未清理；请重试删除。', 'SESSION_HISTORY_CLEANUP_INCOMPLETE', 500)
    error.cause = new AggregateError(cleanupErrors)
    throw error
  }
  try { await forgetArchivedSession(registry, sessionId) } catch (cause) {
    const error = historyError('会话日志已删除，但归档索引尚未清理；请重试删除。', 'SESSION_HISTORY_CLEANUP_INCOMPLETE', 500)
    error.cause = cause
    throw error
  }
  return { sessionId, artifactDeleted: Boolean(target?.artifact) }
}

function deleteArchivedSession(ctx, sessionId) {
  const prior = historyDeleteTails.get(ctx) || Promise.resolve()
  const operation = prior.catch(() => {}).then(() => deleteArchivedSessionUnlocked(ctx, sessionId))
  historyDeleteTails.set(ctx, operation)
  return operation.finally(() => { if (historyDeleteTails.get(ctx) === operation) historyDeleteTails.delete(ctx) })
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
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/api/session-experience/archive-history', handler: async (req, res) => {
      if (req.method !== 'DELETE') return json(res, 405, { error: 'method not allowed', code: 'SESSION_HISTORY_METHOD_NOT_ALLOWED' })
      if (!trustedRequest(req) || typeof req.headers.origin !== 'string') return json(res, 403, { error: 'forbidden', code: 'SESSION_HISTORY_FORBIDDEN' })
      if (req.headers['x-dsh-delete-confirmation'] !== HISTORY_DELETE_CONFIRMATION) {
        return json(res, 400, { error: '必须明确确认永久删除。', code: 'SESSION_HISTORY_CONFIRMATION_REQUIRED' })
      }
      try {
        const sessionId = requiredQuery(query(req), 'sessionId', 256)
        const result = await deleteArchivedSession(ctx, sessionId)
        return json(res, 200, { schemaVersion: 1, ...result })
      } catch (error) {
        return json(res, error.status || 500, { error: error?.message || String(error), code: error?.code || 'SESSION_HISTORY_DELETE_FAILED' })
      }
    }
  }), 'session-experience archive history delete route')
}

export {
  HISTORY_DELETE_CONFIRMATION, MAX_UPLOAD_BYTES, UPLOAD_DIRECTORY, apply, collectBody, deleteArchivedSession,
  downloadHeaders, encodeSessionSegment, inject, listUploads, name, resolveDownload, resolveSessionArtifact,
  safeFileName, saveUpload, trustedRequest
}