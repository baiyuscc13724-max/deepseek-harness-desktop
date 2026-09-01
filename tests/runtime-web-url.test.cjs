const test = require('node:test')
const assert = require('node:assert/strict')

const {
  appendRuntimeWebOutput,
  detectRuntimeWebUrl,
  isRuntimeWebReadyStatus,
  normalizeRuntimeWebUrl,
  redactRuntimeWebAuth,
  runtimeSessionWindowUrl,
  safeRuntimeWebUrl
} = require('../electron/bridge/runtime-web-url.cjs')
const { appendBoundedRuntimeDiagnostic } = require('../electron/bridge/dsh-generated-profile-recovery.cjs')

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'

test('runtime Web URL detection preserves the loopback launch token and normalizes localhost', () => {
  const authenticated = `http://127.0.0.1:43123/?token=${TOKEN}`
  assert.equal(detectRuntimeWebUrl(`dsh web: ${authenticated}\n`), authenticated)
  assert.equal(detectRuntimeWebUrl(`ready at http://localhost:43124/?token=${TOKEN}\n`), `http://127.0.0.1:43124/?token=${TOKEN}`)
  assert.equal(detectRuntimeWebUrl('legacy ready at http://localhost:43125\n'), 'http://127.0.0.1:43125')
})

test('runtime Web URL detection rejects non-loopback, non-root, ambiguous, and invalid URLs', () => {
  for (const value of [
    'http://192.168.1.5:43123/?token=abc',
    'https://127.0.0.1:43123/?token=abc',
    'http://127.0.0.1:43123/admin',
    'http://127.0.0.1:43123/?token=abc&next=unsafe',
    'http://127.0.0.1:70000/?token=abc',
    'http://user@127.0.0.1:43123/?token=abc'
  ]) assert.equal(detectRuntimeWebUrl(`ready ${value}\n`), null, value)
  assert.equal(normalizeRuntimeWebUrl('http://127.0.0.1:43123/?token='), null)
})

test('bounded runtime output recovers an authenticated URL split across chunks', () => {
  let output = ''
  output = appendRuntimeWebOutput(output, 'startup noise\ndsh web: http://127.0.0.1:43123/?tok')
  assert.equal(detectRuntimeWebUrl(output), null)
  output = appendRuntimeWebOutput(output, `en=${TOKEN}\n`)
  assert.equal(detectRuntimeWebUrl(output), `http://127.0.0.1:43123/?token=${TOKEN}`)
  assert.ok(output.length <= 4096)
})

test('runtime URL diagnostics redact bearer material and expose only the origin', () => {
  const authenticated = `http://127.0.0.1:43123/?token=${TOKEN}`
  assert.equal(safeRuntimeWebUrl(authenticated), 'http://127.0.0.1:43123')
  const redacted = redactRuntimeWebAuth(`open ${authenticated}`)
  assert.equal(redacted.includes(TOKEN), false)
  assert.match(redacted, /\?token=\[redacted\]/u)
})

test('detached session URLs preserve only the selected session and never the launch token', () => {
  const authenticated = `http://127.0.0.1:43123/?token=${TOKEN}`
  const target = new URL(runtimeSessionWindowUrl(authenticated, 'session/测试 1'))
  assert.equal(target.origin, 'http://127.0.0.1:43123')
  assert.equal(target.searchParams.get('harness-desktop-session'), 'session/测试 1')
  assert.equal(target.searchParams.has('token'), false)
  assert.equal(runtimeSessionWindowUrl(authenticated, ' padded '), null)
})

test('runtime stderr keeps a bounded raw cross-chunk buffer and redacts only the complete diagnostic', () => {
  let diagnostic = ''
  diagnostic = appendBoundedRuntimeDiagnostic(diagnostic, 'open http://127.0.0.1:43123/?tok')
  diagnostic = appendBoundedRuntimeDiagnostic(diagnostic, `en=${TOKEN}\n`)
  const lastError = redactRuntimeWebAuth(diagnostic).trim().slice(-1200)
  assert.equal(lastError.includes(TOKEN), false)
  assert.match(lastError, /\?token=\[redacted\]/u)
})

test('runtime readiness accepts only successful and redirect responses', () => {
  for (const status of [200, 204, 299, 301, 303, 399]) assert.equal(isRuntimeWebReadyStatus(status), true, String(status))
  for (const status of [100, 199, 400, 401, 404, 500, 599, undefined]) assert.equal(isRuntimeWebReadyStatus(status), false, String(status))
})
