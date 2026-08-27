const path = require('node:path')

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_OPEN_BYTES = 100 * 1024 * 1024
const MAX_LOCAL_PREVIEW_BYTES = 1024 * 1024
const MAX_LOCAL_IMAGE_PREVIEW_BYTES = 16 * 1024 * 1024
const LOCAL_TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cjs', '.conf', '.cpp', '.css', '.csv', '.go', '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json', '.jsonl',
  '.jsx', '.log', '.md', '.markdown', '.mjs', '.mts', '.ps1', '.py', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml'
])
const LOCAL_IMAGE_MIME_TYPES = new Map([
  ['.avif', 'image/avif'], ['.bmp', 'image/bmp'], ['.gif', 'image/gif'], ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'], ['.jpg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp']
])
const REQUEST_TIMEOUT_MS = 10_000
const FILE_OPEN_TIMEOUT_MS = 60_000

const RESOURCE_PATHS = Object.freeze({
  files: '/api/desktop-files/state',
  filePreview: '/api/desktop-files/preview',
  fileContent: '/api/desktop-files/content',
  schedules: '/api/desktop-schedules/state'
})

function sessionId(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value) {
    throw Object.assign(new TypeError('sessionId must be a non-empty string'), { code: 'RIGHT_WORKSPACE_BAD_SESSION' })
  }
  return value
}

function relativeFilePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value || value.includes('\u0000') || /[\r\n]/u.test(value)) {
    throw Object.assign(new TypeError('path must be a bounded workspace file target'), { code: 'RIGHT_WORKSPACE_BAD_PATH' })
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
  if (kind === 'filePreview' || kind === 'fileContent') target.searchParams.set('path', relativeFilePath(payload.path))
  return target
}

function fileContentUrl(runtimeUrl, payload = {}) {
  return resourceUrl(runtimeUrl, 'fileContent', payload)
}

function safeOpenFileName(value) {
  let name = path.basename(String(value || '')).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/gu, '_').trim().replace(/[. ]+$/u, '').slice(0, 240)
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = `_${name}`
  if (!name || name === '.' || name === '..') throw Object.assign(new TypeError('workspace file name is invalid'), { code: 'RIGHT_WORKSPACE_BAD_FILE_NAME' })
  return name
}

async function responseBytes(response, limit = MAX_RESPONSE_BYTES) {
  const advertised = Number(response.headers?.get?.('content-length') || 0)
  const tooLarge = () => Object.assign(new Error('Right workspace response is too large'), { code: 'RIGHT_WORKSPACE_RESPONSE_TOO_LARGE' })
  if (Number.isFinite(advertised) && advertised > limit) throw tooLarge()
  const reader = response.body?.getReader?.()
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > limit) throw tooLarge()
    return bytes
  }
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      size += chunk.length
      if (size > limit) {
        await reader.cancel().catch(() => {})
        throw tooLarge()
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock?.()
  }
  return Buffer.concat(chunks, size)
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
  const base = { path: resolved, name: path.basename(resolved), size: info.size, extension, openable: true }
  const imageMimeType = LOCAL_IMAGE_MIME_TYPES.get(extension)
  const limit = imageMimeType ? MAX_LOCAL_IMAGE_PREVIEW_BYTES : MAX_LOCAL_PREVIEW_BYTES
  if (!imageMimeType && !LOCAL_TEXT_EXTENSIONS.has(extension)) return { ...base, previewable: false, reason: 'external' }
  if (info.size > limit) return { ...base, previewable: false, reason: 'too-large', maxPreviewBytes: limit }
  const handle = await options.openImpl(resolved, 'r')
  let bytes
  try {
    const buffer = Buffer.alloc(limit + 1)
    const read = await handle.read(buffer, 0, buffer.length, 0)
    if (read.bytesRead > limit) return { ...base, size: read.bytesRead, previewable: false, reason: 'too-large', maxPreviewBytes: limit }
    bytes = buffer.subarray(0, read.bytesRead)
  } finally { await handle.close() }
  if (imageMimeType) return { ...base, previewable: true, previewKind: 'image', mimeType: imageMimeType, dataUrl: `data:${imageMimeType};base64,${bytes.toString('base64')}` }
  if (bytes.includes(0)) return { ...base, previewable: false, reason: 'binary' }
  return { ...base, previewable: true, previewKind: 'text', mimeType: 'text/plain; charset=utf-8', text: bytes.toString('utf8'), truncated: false, maxPreviewBytes: MAX_LOCAL_PREVIEW_BYTES }
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
    if (options.kind === 'filePreview' && body?.file && typeof body.file === 'object') {
      body.file.contentUrl = fileContentUrl(options.runtimeUrl, options).toString()
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRightWorkspaceFile(options = {}) {
  if (typeof options.fetchImpl !== 'function') throw new TypeError('fetchImpl is required')
  const target = fileContentUrl(options.runtimeUrl, options)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FILE_OPEN_TIMEOUT_MS)
  timer.unref?.()
  try {
    const response = await options.fetchImpl(target, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { accept: '*/*' }
    })
    if (!response.ok) {
      let message = `Harness runtime returned HTTP ${response.status}`
      try {
        const body = JSON.parse((await responseBytes(response)).toString('utf8'))
        if (body?.error) message = body.error
      } catch {}
      throw Object.assign(new Error(message), { code: 'RIGHT_WORKSPACE_FILE_OPEN_FAILED', status: response.status })
    }
    return { name: safeOpenFileName(options.name), bytes: await responseBytes(response, MAX_WORKSPACE_OPEN_BYTES) }
  } finally {
    clearTimeout(timer)
  }
}

function inside(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function materializeRightWorkspaceFile(options = {}) {
  const required = ['mkdirImpl', 'mkdtempImpl', 'openImpl', 'realpathImpl', 'lstatImpl', 'rmImpl']
  for (const key of required) if (typeof options[key] !== 'function') throw new TypeError(`${key} is required`)
  const authoredTempBase = String(options.tempBase || '')
  if (!authoredTempBase || !path.isAbsolute(authoredTempBase)) throw Object.assign(new TypeError('tempBase must be absolute'), { code: 'RIGHT_WORKSPACE_BAD_TEMP_ROOT' })
  const tempBase = path.resolve(authoredTempBase)
  const file = await fetchRightWorkspaceFile(options)
  await options.mkdirImpl(tempBase, { recursive: true, mode: 0o700 })
  const baseInfo = await options.lstatImpl(tempBase)
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink()) throw Object.assign(new Error('workspace temp base failed validation'), { code: 'RIGHT_WORKSPACE_UNSAFE_TEMP_PATH' })
  const root = await options.realpathImpl(tempBase)
  let directory = ''
  try {
    directory = await options.mkdtempImpl(path.join(root, 'harness-workspace-open-'))
    const directoryInfo = await options.lstatImpl(directory)
    const resolvedDirectory = await options.realpathImpl(directory)
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !inside(root, resolvedDirectory)) {
      throw Object.assign(new Error('workspace open directory failed validation'), { code: 'RIGHT_WORKSPACE_UNSAFE_TEMP_PATH' })
    }
    const destination = path.join(resolvedDirectory, file.name)
    const handle = await options.openImpl(destination, 'wx', 0o600)
    try {
      await handle.writeFile(file.bytes)
      await handle.sync()
    } finally { await handle.close() }
    const destinationInfo = await options.lstatImpl(destination)
    const resolvedDestination = await options.realpathImpl(destination)
    if (!destinationInfo.isFile() || destinationInfo.isSymbolicLink() || !inside(resolvedDirectory, resolvedDestination)) {
      throw Object.assign(new Error('workspace open file failed validation'), { code: 'RIGHT_WORKSPACE_UNSAFE_TEMP_PATH' })
    }
    return { directory: resolvedDirectory, destination: resolvedDestination, name: file.name }
  } catch (error) {
    if (directory) await options.rmImpl(directory, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

module.exports = {
  FILE_OPEN_TIMEOUT_MS, LOCAL_IMAGE_MIME_TYPES, LOCAL_TEXT_EXTENSIONS, LOOPBACK_HOSTS, MAX_LOCAL_IMAGE_PREVIEW_BYTES,
  MAX_LOCAL_PREVIEW_BYTES, MAX_RESPONSE_BYTES, MAX_WORKSPACE_OPEN_BYTES, REQUEST_TIMEOUT_MS, RESOURCE_PATHS,
  fetchRightWorkspaceFile, fileContentUrl, loadRightWorkspaceResource, materializeRightWorkspaceFile, previewLocalDocument,
  relativeFilePath, resourceUrl, responseBytes, runtimeOrigin, safeOpenFileName, sessionId
}
