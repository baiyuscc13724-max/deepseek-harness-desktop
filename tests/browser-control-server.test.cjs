const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { BrowserControlServer, isLoopback } = require('../electron/bridge/browser-control-server.cjs')

test('browser tool bridge uses a random bearer token and loopback-only endpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-server-'))
  const stateFile = path.join(root, 'state', 'browser.json')
  const received = []
  const server = new BrowserControlServer({ stateFile, handler: async body => { received.push(body); return { action: body.action } } })
  try {
    const publicState = await server.start()
    assert.equal(publicState.origin.startsWith('http://127.0.0.1:'), true)
    assert.equal('token' in publicState, false)
    const secretState = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.ok(secretState.token.length >= 40)
    const denied = await fetch(`${secretState.origin}/action`, { method: 'POST', body: '{}' })
    assert.equal(denied.status, 401)
    const accepted = await fetch(`${secretState.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secretState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    })
    assert.equal(accepted.status, 200)
    assert.deepEqual((await accepted.json()).result, { action: 'status' })
    assert.deepEqual(received, [{ action: 'status' }])
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('loopback address policy is exact', () => {
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('::ffff:127.0.0.1'), true)
  assert.equal(isLoopback('192.168.1.5'), false)
})
