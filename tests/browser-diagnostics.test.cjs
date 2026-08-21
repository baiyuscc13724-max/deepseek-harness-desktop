const test = require('node:test')
const assert = require('node:assert/strict')

const { BrowserDiagnostics, safeUrl } = require('../electron/bridge/browser-diagnostics.cjs')

test('browser diagnostics never retain URL credentials, query strings or fragments', () => {
  assert.equal(safeUrl('https://user:pass@example.com/private/path?token=secret#otp'), 'https://example.com/private/path')
  assert.equal(safeUrl('file:///c:/secret.txt'), '')
})

test('console and network diagnostics are bounded and redact sensitive values', () => {
  let now = 1_000
  const diagnostics = new BrowserDiagnostics({ consoleLimit: 2, networkLimit: 2, now: () => ++now })
  diagnostics.recordConsole({ level: 'error', message: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz', source: 'https://example.com/app.js?token=x', line: 9 })
  diagnostics.recordConsole({ message: 'normal message' })
  diagnostics.recordConsole({ message: 'latest message' })
  diagnostics.recordNetwork({ id: '1', method: 'post', url: 'https://example.com/api?api_key=secret', status: 200, startedAt: 900 })
  diagnostics.recordNetwork({ id: '2', url: 'https://example.com/second', error: 'token=abcdefghijklmnopqrstuvwxyz', phase: 'failed' })
  diagnostics.recordNetwork({ id: '3', url: 'https://example.com/latest', status: 204 })

  const snapshot = diagnostics.snapshot('all', { limit: 20 })
  assert.equal(snapshot.console.length, 2)
  assert.deepEqual(snapshot.console.map(item => item.message), ['normal message', 'latest message'])
  assert.equal(snapshot.network.length, 2)
  assert.equal(snapshot.network[0].url, 'https://example.com/second')
  assert.doesNotMatch(JSON.stringify(snapshot), /abcdefghijklmnopqrstuvwxyz|api_key=|Bearer /i)
})

test('diagnostic snapshots return copies and support scoped clearing', () => {
  const diagnostics = new BrowserDiagnostics()
  diagnostics.recordConsole({ message: 'one' })
  diagnostics.recordNetwork({ id: 'n1', url: 'https://example.com/a' })
  const first = diagnostics.snapshot('all')
  first.console[0].message = 'mutated'
  assert.equal(diagnostics.snapshot('console').console[0].message, 'one')
  diagnostics.clear('console')
  assert.equal(diagnostics.snapshot('console').console.length, 0)
  assert.equal(diagnostics.snapshot('network').network.length, 1)
})
