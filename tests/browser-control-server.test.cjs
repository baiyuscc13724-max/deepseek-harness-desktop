const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises')
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
    await server.stop()
    await assert.rejects(() => access(stateFile), error => error?.code === 'ENOENT')
    await assert.rejects(() => fetch(`${secretState.origin}/action`, { method: 'POST', headers: { Authorization: `Bearer ${secretState.token}` }, body: '{}' }))
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent starts share one endpoint and stale token files are removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-restart-'))
  const stateDirectory = path.join(root, 'state')
  const stateFile = path.join(stateDirectory, 'browser.json')
  await mkdir(stateDirectory, { recursive: true })
  await writeFile(`${stateFile}.123.456.tmp`, JSON.stringify({ token: 'stale-secret' }))
  await writeFile(path.join(stateDirectory, 'browser.json.keep.tmp'), 'keep')
  const server = new BrowserControlServer({ stateFile, handler: async () => ({ ok: true }) })
  try {
    const [left, right] = await Promise.all([server.start(), server.start()])
    assert.equal(left.origin, right.origin)
    assert.equal((await readdir(stateDirectory)).includes('browser.json.123.456.tmp'), false)
    assert.equal((await readdir(stateDirectory)).includes('browser.json.keep.tmp'), true)
    const firstSecret = JSON.parse(await readFile(stateFile, 'utf8'))
    await server.stop()
    await server.start()
    const secondSecret = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.notEqual(secondSecret.token, firstSecret.token)
    const denied = await fetch(`${secondSecret.origin}/action`, { method: 'POST', headers: { Authorization: `Bearer ${firstSecret.token}` }, body: '{}' })
    assert.equal(denied.status, 401)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('startup failure closes its listener and removes token artifacts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-failure-'))
  const stateFile = path.join(root, 'browser.json')
  await mkdir(stateFile, { recursive: true })
  const server = new BrowserControlServer({ stateFile, handler: async () => ({ ok: true }) })
  try {
    await assert.rejects(() => server.start())
    assert.equal(server.state().running, false)
    assert.equal(server.state().origin, '')
    assert.equal((await readdir(root)).some(name => /^browser\.json\.\d+\.\d+\.tmp$/.test(name)), false)
  } finally {
    await server.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('stop destroys active authorized connections before their handler can finish', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-control-active-'))
  const stateFile = path.join(root, 'browser.json')
  let enterHandler
  let releaseHandler
  const entered = new Promise(resolve => { enterHandler = resolve })
  const release = new Promise(resolve => { releaseHandler = resolve })
  const server = new BrowserControlServer({ stateFile, handler: async () => { enterHandler(); await release; return { completed: true } } })
  try {
    await server.start()
    const secret = JSON.parse(await readFile(stateFile, 'utf8'))
    const request = fetch(`${secret.origin}/action`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' })
    }).then(response => response.status).catch(() => 'closed')
    await entered
    await server.stop()
    releaseHandler()
    assert.equal(await request, 'closed')
    assert.equal(server.state().running, false)
  } finally {
    releaseHandler?.()
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
