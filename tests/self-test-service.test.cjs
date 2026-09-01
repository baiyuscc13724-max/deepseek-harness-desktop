const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { EventEmitter, once } = require('node:events')
const { createServer } = require('node:http')
const { PassThrough } = require('node:stream')

const { runtimeAuthCookieName } = require('../electron/bridge/runtime-session-auth.cjs')
const { nodeRuntimeSupported, probeRuntimeUrl, runPackagedSelfTest, runtimeWebBootable } = require('../electron/bridge/self-test-service.cjs')

test('node runtime check rejects obsolete runtimes', () => {
  assert.equal(nodeRuntimeSupported('24.1.0'), true)
  assert.equal(nodeRuntimeSupported('18.20.0'), false)
  assert.equal(nodeRuntimeSupported('invalid'), false)
})

test('runtime probe uses the isolated prepared DSH home', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'harness-runtime-probe-home-'))
  try {
    let spawned
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    const resultPromise = runtimeWebBootable({ command: 'electron', argsPrefix: ['cli.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }, {
      runtimeHome,
      timeoutMs: 500,
      spawnImpl: (command, args, options) => {
        spawned = { command, args, options }
        process.nextTick(() => child.stdout.write('ready at http://127.0.0.1:43123'))
        return child
      },
      probeUrl: async url => url === 'http://127.0.0.1:43123'
    })
    assert.equal(await resultPromise, true)
    assert.deepEqual(spawned.args, ['cli.js', 'web', '--port', '0', '--no-open'])
    assert.equal(spawned.options.env.DSH_HOME, runtimeHome)
    assert.equal(spawned.options.env.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(spawned.options.env.HARNESS_DESKTOP_MARKETPLACE_PATCH_OWNER, '1')
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
})

test('runtime probe retries an early process exit within one bounded deadline', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'harness-runtime-probe-retry-'))
  try {
    let spawnCount = 0
    const diagnostics = { attempts: [] }
    const result = await runtimeWebBootable({ command: 'electron', argsPrefix: ['cli.js'], env: {} }, {
      runtimeHome,
      timeoutMs: 1_000,
      maxAttempts: 3,
      diagnostics,
      spawnImpl: () => {
        spawnCount += 1
        const child = new EventEmitter()
        child.stdout = new PassThrough()
        child.stderr = new PassThrough()
        child.kill = () => {}
        process.nextTick(() => {
          if (spawnCount === 1) child.emit('exit', 1, null)
          else child.stdout.write('ready at http://127.0.0.1:43124')
        })
        return child
      },
      probeUrl: async url => url === 'http://127.0.0.1:43124'
    })
    assert.equal(result, true)
    assert.equal(spawnCount, 2)
    assert.equal(diagnostics.attempts.length, 2)
    assert.equal(diagnostics.attempts[0].exitCode, 1)
    assert.equal(diagnostics.attempts[1].candidateUrl, 'http://127.0.0.1:43124')
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
})

test('runtime probe preserves a launch token split across output chunks without persisting it in diagnostics', async () => {
  const runtimeHome = await mkdtemp(path.join(os.tmpdir(), 'harness-runtime-probe-auth-'))
  const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde'
  const authenticatedUrl = `http://127.0.0.1:43126/?token=${token}`
  try {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => {}
    const diagnostics = { attempts: [] }
    const probed = []
    const resultPromise = runtimeWebBootable({ command: 'electron', argsPrefix: ['cli.js'], env: {} }, {
      runtimeHome,
      timeoutMs: 1_000,
      diagnostics,
      spawnImpl: () => {
        process.nextTick(() => {
          child.stdout.write('dsh web: http://127.0.0.1:43126/?tok')
          child.stdout.write(`en=${token}\n`)
        })
        return child
      },
      probeUrl: async url => {
        probed.push(url)
        return url === authenticatedUrl
      }
    })
    assert.equal(await resultPromise, true)
    assert.equal(probed.at(-1), authenticatedUrl)
    assert.equal(diagnostics.attempts[0].candidateUrl, 'http://127.0.0.1:43126')
    assert.equal(JSON.stringify(diagnostics).includes(token), false)
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
})

test('default runtime probe proves the launch cookie can authenticate the clean root', async () => {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, cookie: request.headers.cookie || '' })
    const origin = `http://127.0.0.1:${server.address().port}`
    const cookie = `${runtimeAuthCookieName(origin)}=v1.c2lnbmVkLWJvZHk.c2lnbmF0dXJl`
    if (request.url === '/?token=launch-token') {
      response.writeHead(303, { location: '/', 'set-cookie': `${cookie}; Path=/; HttpOnly; SameSite=Strict` })
      response.end()
      return
    }
    if (request.url === '/?token=no-cookie') {
      response.writeHead(303, { location: '/' })
      response.end()
      return
    }
    if (request.url === '/' && request.headers.cookie === cookie) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html>')
      return
    }
    response.writeHead(401, { 'content-type': 'text/plain' })
    response.end('authentication required')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(await probeRuntimeUrl(`${origin}/?token=launch-token`), true)
    const expectedCookie = `${runtimeAuthCookieName(origin)}=v1.c2lnbmVkLWJvZHk.c2lnbmF0dXJl`
    assert.deepEqual(requests, [
      { url: '/?token=launch-token', cookie: '' },
      { url: '/', cookie: expectedCookie }
    ])
    assert.equal(await probeRuntimeUrl(`${origin}/?token=no-cookie`), false)
    assert.equal(await probeRuntimeUrl(origin), false)
    assert.deepEqual(requests.slice(2), [
      { url: '/?token=no-cookie', cookie: '' },
      { url: '/', cookie: '' }
    ])
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('packaged self-test passes with official Web UI runtime assets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harness-desktop-selftest-'))
  try {
    const rendererEntry = path.join(dir, 'index.html')
    await writeFile(rendererEntry, '<!doctype html>')
    const report = await runPackagedSelfTest({
      appVersion: '1.0.0',
      userData: path.join(dir, 'userdata'),
      rendererEntry,
      resolveDshBin: () => ({ source: 'bundled', version: '0.1.0-rc.6' }),
      runtimeProbe: async () => true,
      marketplaceProbe: async () => true,
      nodeVersion: '24.1.0'
    })
    assert.equal(report.ok, true)
    assert.deepEqual(report.checks, {
      rendererEntry: true,
      bundledHarness: true,
      runtimeWebBoot: true,
      nodeRuntime: true,
      userData: true,
      desktopMarketplace: true,
      bundledGit: true,
      webCompatibility: true
    })
    assert.equal(report.dsh.version, '0.1.0-rc.6')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('packaged self-test requires the bundled Git toolchain when the release probe is enabled', async () => {
  const report = await runPackagedSelfTest({
    userData: 'unused', rendererEntry: 'missing',
    resolveDshBin: () => ({ source: 'bundled', version: '0.1.0-rc.8' }),
    runtimeProbe: async () => true, marketplaceProbe: async () => true,
    userDataProbe: async () => true, nodeVersion: '24.1.0',
    platform: 'win32',
    gitRuntimeProbe: async () => ({
      git: { available: true, source: 'system', version: '2.53.0' },
      gcm: { available: false, source: null, version: null },
      sshAgent: { available: true, running: false }
    })
  })
  assert.equal(report.ok, false)
  assert.equal(report.checks.bundledGit, false)
  assert.equal(report.git.gcm.available, false)
})

test('packaged self-test accepts an available system Git on non-Windows platforms', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harness-desktop-selftest-darwin-'))
  try {
    const rendererEntry = path.join(dir, 'index.html')
    await writeFile(rendererEntry, '<!doctype html>')
    const report = await runPackagedSelfTest({
      userData: path.join(dir, 'userdata'), rendererEntry,
      resolveDshBin: () => ({ source: 'bundled', version: '0.1.0-rc.8' }),
      runtimeProbe: async () => true, marketplaceProbe: async () => true,
      userDataProbe: async () => true, nodeVersion: '24.1.0',
      platform: 'darwin',
      gitRuntimeProbe: async () => ({
        git: { available: true, source: 'system', version: '2.55.0' },
        gcm: { available: false, source: null, version: null },
        sshAgent: { available: false, running: false }
      })
    })
    assert.equal(report.ok, true)
    assert.equal(report.checks.bundledGit, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('packaged self-test fails when the official Harness binary is unavailable', async () => {
  const report = await runPackagedSelfTest({
    appVersion: '1.0.0',
    userData: 'unused',
    rendererEntry: 'missing',
    resolveDshBin: () => ({ source: 'npx-fallback', version: 'unresolved' }),
    runtimeProbe: async () => false,
    marketplaceProbe: async () => false,
    nodeVersion: '24.1.0',
    userDataProbe: async () => true
  })
  assert.equal(report.ok, false)
  assert.equal(report.checks.bundledHarness, false)
  assert.equal(report.checks.rendererEntry, false)
})

test('packaged self-test fails when the bundled Harness Web runtime cannot boot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'harness-desktop-selftest-import-'))
  try {
    const rendererEntry = path.join(dir, 'index.html')
    await writeFile(rendererEntry, '<!doctype html>')
    const report = await runPackagedSelfTest({
      userData: path.join(dir, 'userdata'),
      rendererEntry,
      resolveDshBin: () => ({ source: 'bundled', version: '0.1.0-rc.6' }),
      runtimeProbe: async () => false,
      marketplaceProbe: async () => true,
      nodeVersion: '24.1.0'
    })
    assert.equal(report.ok, false)
    assert.equal(report.checks.runtimeWebBoot, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
