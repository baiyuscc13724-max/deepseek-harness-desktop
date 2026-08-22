const path = require('node:path')

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_LOCAL_PREVIEW_BYTES = 1024 * 1024
const LOCAL_TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.conf', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json', '.jsonl',
  '.jsx', '.log', '.md', '.markdown', '.mjs', '.mts', '.ps1', '.py', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'
])
const REQUEST_TIMEOUT_MS = 10_000

const RESOURCE_PATHS = Object.freeze({
  files: '/api/desktop-files/state',
  filePreview: '/api/desktop-files/preview',
  schedules: '/api/desktop-schedules/state'
})

function sessionId(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value) {
    throw Object.assign(new TypeError('sessionId must be a non-empty string'), { code: 'RIGHT_WORKSPACE_BAD_SESSION' })
  }
  return value
}

function relativeFilePath(value) {
  const unsafe = typeof value === 'string' && (/^(?:[a-z]:[\\/]|[\\/])/iu.test(value) || /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(value))
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value || value.includes('\u0000') || unsafe) {
    throw Object.assign(new TypeError('path must be a workspace-contained relative path'), { code: 'RIGHT_WORKSPACE_BAD_PATH' })
  }
  return value
}

function runtimeOrigin(value) {
  let parsed
  try { parsed = new URL(value) } catch { throw Object.assign(new Error('Harness runtime is unavailable'), { code: 'RIGHT_WORKSPACE_RUNTIME_UNAVAILABLE' }) }
  if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    throw Object.assign(new Error('Harness runtime must use a credential-free loopback HTTP origin'), { code: 'RIGHT_WORKSPACE_RUNTIME_FORBIDDEN' })
  }
  return parsed.origin
}

function resourceUrl(runtimeUrl, kind, payload = {}) {
  const pathname = RESOURCE_PATHS[kind]
  if (!pathname) throw Object.assign(new TypeError('unknown right workspace resource'), { code: 'RIGHT_WORKSPACE_BAD_RESOURCE' })
  const target = new URL(pathname, `${runtimeOrigin(runtimeUrl)}/`)
  target.searchParams.set('sessionId', sessionId(payload.sessionId))
  if (kind === 'filePreview') target.searchParams.set('path', relativeFilePath(payload.path))
  return target
}

async function responseBytes(response, limit = MAX_RESPONSE_BYTES) {
  const advertised = Number(response.headers?.get?.('content-length') || 0)
  if (Number.isFinite(advertised) && advertised > limit) throw Object.assign(new Error('Right workspace response is too large'), { code: 'RIGHT_WORKSPACE_RESPONSE_TOO_LARGE' })
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > limit) throw Object.assign(new Error('Right workspace response is too large'), { code: 'RIGHT_WORKSPACE_RESPONSE_TOO_LARGE' })
  return bytes
}

async function previewLocalDocument(value, options = {}) {
  const target = String(value || '')
  if (!target || target.length > 4096 || !path.isAbsolute(target) || target.startsWith('\\\\') || target.includes('\u0000')) {
    throw Object.assign(new TypeError('local preview requires a non-network absolute path'), { code: 'RIGHT_WORKSPACE_BAD_LOCAL_PATH' })
  }
  if (typeof options.realpathImpl !== 'function' || typeof options.statImpl !== 'function' || typeof options.openImpl !== 'function') throw new TypeError('local preview file adapters are required')
  const resolved = await options.realpathImpl(target)
  if (resolved.startsWith('\\\\')) throw Object.assign(new Error('network paths cannot be previewed'), { code: 'RIGHT_WORKSPACE_NETWORK_PATH' })
  const info = await options.statImpl(resolved)
  if (!info.isFile()) throw Object.assign(new Error('only regular files can be previewed'), { code: 'RIGHT_WORKSPACE_NOT_FILE' })
  const extension = path.extname(resolved).toLowerCase()
  const base = { path: resolved, name: path.basename(resolved), size: info.size, extension }
  if (!LOCAL_TEXT_EXTENSIONS.has(extension)) return { ...base, previewable: false, reason: 'unsupported' }
  if (info.size > MAX_LOCAL_PREVIEW_BYTES) return { ...base, previewable: false, reason: 'too-large', maxPreviewBytes: MAX_LOCAL_PREVIEW_BYTES }
  const handle = await options.openImpl(resolved, 'r')
  let bytes
  try {
    const buffer = Buffer.alloc(MAX_LOCAL_PREVIEW_BYTES + 1)
    const read = await handle.read(buffer, 0, buffer.length, 0)
    if (read.bytesRead > MAX_LOCAL_PREVIEW_BYTES) return { ...base, size: read.bytesRead, previewable: false, reason: 'too-large', maxPreviewBytes: MAX_LOCAL_PREVIEW_BYTES }
    bytes = buffer.subarray(0, read.bytesRead)
  } finally { await handle.close() }
  if (bytes.includes(0)) return { ...base, previewable: false, reason: 'binary' }
  return { ...base, previewable: true, text: bytes.toString('utf8'), truncated: false, maxPreviewBytes: MAX_LOCAL_PREVIEW_BYTES }
}

async function loadRightWorkspaceResource(options = {}) {
  if (typeof options.fetchImpl !== 'function') throw new TypeError('fetchImpl is required')
  const target = resourceUrl(options.runtimeUrl, options.kind, options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await options.fetchImpl(target, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
    const bytes = await responseBytes(response)
    let body
    try { body = JSON.parse(bytes.toString('utf8')) } catch { throw Object.assign(new Error('Right workspace returned invalid JSON'), { code: 'RIGHT_WORKSPACE_INVALID_RESPONSE' }) }
    if (!response.ok) {
      throw Object.assign(new Error(body?.error || `Harness runtime returned HTTP ${response.status}`), {
        code: body?.code || 'RIGHT_WORKSPACE_RUNTIME_ERROR', status: response.status
      })
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  LOCAL_TEXT_EXTENSIONS, LOOPBACK_HOSTS, MAX_LOCAL_PREVIEW_BYTES, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, RESOURCE_PATHS,
  loadRightWorkspaceResource, previewLocalDocument, relativeFilePath, resourceUrl, responseBytes, runtimeOrigin, sessionId
}
