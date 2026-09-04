const test = require('node:test')
const assert = require('node:assert/strict')
const { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  MAX_LOCAL_PREVIEW_BYTES, MAX_RESPONSE_BYTES, fetchRightWorkspaceFile, fileContentUrl,
  loadRightWorkspaceResource, materializeRightWorkspaceFile, previewLocalDocument, resourceUrl, responseBytes, runtimeOrigin, safeOpenFileName
} = require('../electron/bridge/right-workspace-service.cjs')
const { blocksDirectOpen } = require('../electron/bridge/local-target-service.cjs')

function response(body, options = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  const headers = new Map(Object.entries(options.headers || {}).map(([name, value]) => [name.toLowerCase(), String(value)]))
  if (!headers.has('content-length') && options.status !== 304) headers.set('content-length', String(options.contentLength ?? bytes.length))
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    headers: { get: name => headers.get(String(name).toLowerCase()) ?? null },
    arrayBuffer: options.arrayBuffer || (async () => bytes)
  }
}

test('right workspace proxy accepts only the credential-free Harness loopback runtime', () => {
  assert.equal(runtimeOrigin('http://127.0.0.1:8906/chat'), 'http://127.0.0.1:8906')
  assert.equal(runtimeOrigin('http://localhost:3000/'), 'http://localhost:3000')
  assert.equal(runtimeOrigin('http://[::1]:3080/'), 'http://[::1]:3080')
  assert.throws(() => runtimeOrigin('https://example.com'), error => error.code === 'RIGHT_WORKSPACE_RUNTIME_FORBIDDEN')
  assert.throws(() => runtimeOrigin('http://user:pass@127.0.0.1:8906'), error => error.code === 'RIGHT_WORKSPACE_RUNTIME_FORBIDDEN')
})

test('right workspace resource URLs are fixed and session-bound', () => {
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'files', { sessionId: 'session-1' }).toString(), 'http://127.0.0.1:8906/api/desktop-files/state?sessionId=session-1')
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: 'uploads/a b.md' }).searchParams.get('path'), 'uploads/a b.md')
  assert.equal(fileContentUrl('http://127.0.0.1:8906', { sessionId: 'session-1', path: 'images/a b.png' }).toString(), 'http://127.0.0.1:8906/api/desktop-files/content?sessionId=session-1&path=images%2Fa+b.png')
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'unknown', { sessionId: 'session-1' }), error => error.code === 'RIGHT_WORKSPACE_BAD_RESOURCE')
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'files', { sessionId: ' bad ' }), error => error.code === 'RIGHT_WORKSPACE_BAD_SESSION')
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: '../secret.txt' }).searchParams.get('path'), '../secret.txt')
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: 'C:\\workspace\\file.ts:4' }).searchParams.get('path'), 'C:\\workspace\\file.ts:4')
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: 'bad\npath' }), error => error.code === 'RIGHT_WORKSPACE_BAD_PATH')
  assert.equal(safeOpenFileName('payload.exe:stream.txt'), 'payload.exe_stream.txt')
  assert.equal(safeOpenFileName('payload.exe.   '), 'payload.exe')
  assert.equal(blocksDirectOpen(safeOpenFileName('payload.exe.')), true)
  assert.equal(blocksDirectOpen(safeOpenFileName('shortcut.lnk . ')), true)
  assert.equal(safeOpenFileName('CON.txt'), '_CON.txt')
})

test('explicit local-document previews render safe images, bound text, and leave every other file system-openable', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'right-workspace-local-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const markdown = path.join(directory, 'notes.md')
  const commonJs = path.join(directory, 'config.cjs')
  const image = path.join(directory, 'image.png')
  const binary = path.join(directory, 'archive.bin')
  await writeFile(markdown, '# Notes')
  await writeFile(commonJs, 'module.exports = true')
  await writeFile(image, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  await writeFile(binary, Buffer.from([0, 1, 2]))
  const adapters = { realpathImpl: realpath, statImpl: stat, openImpl: open }
  const preview = await previewLocalDocument(markdown, adapters)
  assert.equal(preview.previewable, true)
  assert.equal(preview.text, '# Notes')
  assert.equal(preview.previewKind, 'text')
  assert.equal((await previewLocalDocument(commonJs, adapters)).text, 'module.exports = true')
  const imagePreview = await previewLocalDocument(image, adapters)
  assert.equal(imagePreview.previewKind, 'image')
  assert.equal(imagePreview.dataUrl, 'data:image/png;base64,iVBORw==')
  assert.equal((await previewLocalDocument(binary, adapters)).reason, 'external')
  assert.equal((await previewLocalDocument(binary, adapters)).openable, true)
  const growing = await previewLocalDocument(markdown, {
    realpathImpl: async value => value,
    statImpl: async () => ({ isFile: () => true, size: 1 }),
    openImpl: async () => ({ read: async () => ({ bytesRead: MAX_LOCAL_PREVIEW_BYTES + 1 }), close: async () => {} })
  })
  assert.equal(growing.reason, 'too-large')
  await assert.rejects(previewLocalDocument('\\\\server\\share\\notes.md', adapters), error => error.code === 'RIGHT_WORKSPACE_BAD_LOCAL_PATH')
})

test('right workspace proxy performs bounded GET-only JSON requests', async () => {
  let request
  const result = await loadRightWorkspaceResource({
    runtimeUrl: 'http://127.0.0.1:8906', kind: 'schedules', sessionId: 'root-session',
    fetchImpl: async (url, options) => { request = { url: url.toString(), options }; return response({ schedules: [] }) }
  })
  assert.deepEqual(result, { status: 200, notModified: false, body: { schedules: [] } })
  assert.match(request.url, /\/api\/desktop-schedules\/state\?sessionId=root-session$/u)
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.headers.accept, 'application/json')
  await assert.rejects(loadRightWorkspaceResource({
    runtimeUrl: 'http://127.0.0.1:8906', kind: 'files', sessionId: 'root-session',
    fetchImpl: async () => response('{}', { contentLength: MAX_RESPONSE_BYTES + 1 })
  }), error => error.code === 'RIGHT_WORKSPACE_RESPONSE_TOO_LARGE')
})

test('schedule proxy forwards validators and preserves a bodyless 304 without parsing JSON', async () => {
  let request
  let bodyReads = 0
  const etag = '"dds-abc123"'
  const result = await loadRightWorkspaceResource({
    runtimeUrl: 'http://127.0.0.1:8906',
    kind: 'schedules',
    sessionId: 'root-session',
    etag,
    since: 41,
    generation: 'generation-1',
    fetchImpl: async (url, options) => {
      request = { url: new URL(url), options }
      return response('', {
        status: 304,
        headers: {
          etag,
          'x-schedule-cursor': '43',
          'x-schedule-generation': 'generation-1',
          'x-schedule-checksum': 'a'.repeat(64)
        },
        arrayBuffer: async () => { bodyReads += 1; throw new Error('304 body must not be read') }
      })
    }
  })
  assert.equal(request.url.searchParams.get('since'), '41')
  assert.equal(request.url.searchParams.get('generation'), 'generation-1')
  assert.equal(request.options.headers['if-none-match'], etag)
  assert.deepEqual(result, {
    status: 304,
    notModified: true,
    etag,
    cursor: 43,
    generation: 'generation-1',
    checksum: 'a'.repeat(64),
    body: null
  })
  assert.equal(bodyReads, 0)

  const legacy = resourceUrl('http://127.0.0.1:8906', 'schedules', {
    sessionId: 'root-session', validator: false, since: 41, generation: 'generation-1'
  })
  assert.equal(legacy.searchParams.has('since'), false)
  assert.equal(legacy.searchParams.has('generation'), false)
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'schedules', { sessionId: 'root-session', since: 1.5 }), error => error.code === 'RIGHT_WORKSPACE_BAD_SCHEDULE_CURSOR')
})

test('workspace file previews receive a loopback content URL and can be materialized for a system application', async () => {
  const preview = await loadRightWorkspaceResource({
    runtimeUrl: 'http://127.0.0.1:8906', kind: 'filePreview', sessionId: 'root-session', path: 'docs/image.png',
    fetchImpl: async () => response({ file: { path: 'docs/image.png', name: 'image.png', previewKind: 'image', previewable: true } })
  })
  assert.equal(preview.file.contentUrl, 'http://127.0.0.1:8906/api/desktop-files/content?sessionId=root-session&path=docs%2Fimage.png')
  let requested
  const opened = await fetchRightWorkspaceFile({
    runtimeUrl: 'http://localhost:3000', sessionId: 'root-session', path: 'docs/image.png', name: 'image.png',
    fetchImpl: async (url, options) => { requested = { url: url.toString(), options }; return response(Buffer.from([1, 2, 3])) }
  })
  assert.equal(requested.url, 'http://localhost:3000/api/desktop-files/content?sessionId=root-session&path=docs%2Fimage.png')
  assert.equal(requested.options.redirect, 'error')
  assert.equal(requested.options.signal instanceof AbortSignal, true)
  assert.equal(opened.name, 'image.png')
  assert.deepEqual(opened.bytes, Buffer.from([1, 2, 3]))
})

test('unknown-length responses are bounded while streaming', async () => {
  let cancelled = false
  const chunks = [Buffer.alloc(3), Buffer.alloc(3)]
  const response = {
    headers: { get: () => null },
    body: { getReader: () => ({
      read: async () => chunks.length ? { done: false, value: chunks.shift() } : { done: true },
      cancel: async () => { cancelled = true },
      releaseLock: () => {}
    }) }
  }
  await assert.rejects(responseBytes(response, 5), error => error.code === 'RIGHT_WORKSPACE_RESPONSE_TOO_LARGE')
  assert.equal(cancelled, true)
})

test('workspace files materialize into unique private directories with exclusive file creation', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'right-workspace-open-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const openFlags = []
  const adapters = {
    runtimeUrl: 'http://127.0.0.1:8906', sessionId: 'root-session', path: 'payload.exe', name: 'payload.exe',
    tempBase: path.join(root, 'cache'),
    fetchImpl: async () => response(Buffer.from([1, 2, 3])),
    mkdirImpl: mkdir,
    mkdtempImpl: mkdtemp,
    openImpl: async (...args) => { openFlags.push(args.slice(1)); return open(...args) },
    realpathImpl: realpath,
    lstatImpl: lstat,
    rmImpl: rm
  }
  const first = await materializeRightWorkspaceFile(adapters)
  const second = await materializeRightWorkspaceFile(adapters)
  assert.notEqual(first.directory, second.directory)
  assert.equal(first.destination.startsWith(first.directory + path.sep), true)
  assert.deepEqual(openFlags, [['wx', 0o600], ['wx', 0o600]])
  assert.deepEqual(await readFile(first.destination), Buffer.from([1, 2, 3]))
  assert.equal((await lstat(first.destination)).isSymbolicLink(), false)
})

test('workspace materialization rejects reparse points at both the trusted base and random directory', async () => {
  const root = path.resolve(os.tmpdir(), 'right-workspace-unsafe-root')
  const baseOptions = {
    runtimeUrl: 'http://127.0.0.1:8906', sessionId: 'root-session', path: 'payload.exe', name: 'payload.exe', tempBase: root,
    fetchImpl: async () => response(Buffer.from([1])),
    mkdirImpl: async () => {},
    mkdtempImpl: async () => path.join(root, 'harness-workspace-open-attacker'),
    openImpl: async () => { throw new Error('must not create a file') },
    realpathImpl: async value => value,
    rmImpl: async () => {}
  }
  let madeDirectory = false
  await assert.rejects(materializeRightWorkspaceFile({
    ...baseOptions,
    mkdtempImpl: async () => { madeDirectory = true; return path.join(root, 'harness-workspace-open-attacker') },
    lstatImpl: async () => ({ isDirectory: () => true, isFile: () => false, isSymbolicLink: () => true })
  }), error => error.code === 'RIGHT_WORKSPACE_UNSAFE_TEMP_PATH')
  assert.equal(madeDirectory, false)

  let lstatCalls = 0
  let removed = false
  await assert.rejects(materializeRightWorkspaceFile({
    ...baseOptions,
    lstatImpl: async () => ({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => ++lstatCalls > 1
    }),
    rmImpl: async () => { removed = true }
  }), error => error.code === 'RIGHT_WORKSPACE_UNSAFE_TEMP_PATH')
  assert.equal(removed, true)
})

test('right workspace proxy preserves safe runtime errors and rejects invalid JSON', async () => {
  await assert.rejects(loadRightWorkspaceResource({
    runtimeUrl: 'http://localhost:3000', kind: 'files', sessionId: 'root-session',
    fetchImpl: async () => response({ error: 'session is not live', code: 'FILES_SESSION_NOT_LIVE' }, { ok: false, status: 409 })
  }), error => error.code === 'FILES_SESSION_NOT_LIVE' && error.status === 409)
  await assert.rejects(loadRightWorkspaceResource({
    runtimeUrl: 'http://localhost:3000', kind: 'files', sessionId: 'root-session', fetchImpl: async () => response('not-json')
  }), error => error.code === 'RIGHT_WORKSPACE_INVALID_RESPONSE')
})
