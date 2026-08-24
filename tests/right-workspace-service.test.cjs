const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, open, realpath, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  MAX_LOCAL_PREVIEW_BYTES, MAX_RESPONSE_BYTES, loadRightWorkspaceResource, previewLocalDocument, resourceUrl, runtimeOrigin
} = require('../electron/bridge/right-workspace-service.cjs')

function response(body, options = {}) {
  const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    headers: { get: name => name === 'content-length' ? String(options.contentLength ?? bytes.length) : null },
    arrayBuffer: async () => bytes
  }
}

test('right workspace proxy accepts only the credential-free Harness loopback runtime', () => {
  assert.equal(runtimeOrigin('http://127.0.0.1:8906/chat'), 'http://127.0.0.1:8906')
  assert.equal(runtimeOrigin('http://localhost:3000/'), 'http://localhost:3000')
  assert.throws(() => runtimeOrigin('https://example.com'), error => error.code === 'RIGHT_WORKSPACE_RUNTIME_FORBIDDEN')
  assert.throws(() => runtimeOrigin('http://user:pass@127.0.0.1:8906'), error => error.code === 'RIGHT_WORKSPACE_RUNTIME_FORBIDDEN')
})

test('right workspace resource URLs are fixed and session-bound', () => {
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'files', { sessionId: 'session-1' }).toString(), 'http://127.0.0.1:8906/api/desktop-files/state?sessionId=session-1')
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: 'uploads/a b.md' }).searchParams.get('path'), 'uploads/a b.md')
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'unknown', { sessionId: 'session-1' }), error => error.code === 'RIGHT_WORKSPACE_BAD_RESOURCE')
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'files', { sessionId: ' bad ' }), error => error.code === 'RIGHT_WORKSPACE_BAD_SESSION')
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: '../secret.txt' }).searchParams.get('path'), '../secret.txt')
  assert.equal(resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: 'C:\\workspace\\file.ts:4' }).searchParams.get('path'), 'C:\\workspace\\file.ts:4')
  assert.throws(() => resourceUrl('http://127.0.0.1:8906', 'filePreview', { sessionId: 'session-1', path: 'bad\npath' }), error => error.code === 'RIGHT_WORKSPACE_BAD_PATH')
})

test('explicit local-document previews are text-only, bounded, and reject network paths', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'right-workspace-local-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const markdown = path.join(directory, 'notes.md')
  const binary = path.join(directory, 'image.bin')
  await writeFile(markdown, '# Notes')
  await writeFile(binary, Buffer.from([0, 1, 2]))
  const adapters = { realpathImpl: realpath, statImpl: stat, openImpl: open }
  const preview = await previewLocalDocument(markdown, adapters)
  assert.equal(preview.previewable, true)
  assert.equal(preview.text, '# Notes')
  assert.equal((await previewLocalDocument(binary, adapters)).reason, 'unsupported')
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
  assert.deepEqual(result, { schedules: [] })
  assert.match(request.url, /\/api\/desktop-schedules\/state\?sessionId=root-session$/u)
  assert.equal(request.options.method, 'GET')
  assert.equal(request.options.redirect, 'error')
  assert.equal(request.options.headers.accept, 'application/json')
  await assert.rejects(loadRightWorkspaceResource({
    runtimeUrl: 'http://127.0.0.1:8906', kind: 'files', sessionId: 'root-session',
    fetchImpl: async () => response('{}', { contentLength: MAX_RESPONSE_BYTES + 1 })
  }), error => error.code === 'RIGHT_WORKSPACE_RESPONSE_TOO_LARGE')
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
