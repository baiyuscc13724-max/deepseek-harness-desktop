const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

const { nodeRuntimeSupported, runPackagedSelfTest, runtimeWebBootable } = require('../electron/bridge/self-test-service.cjs')

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
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
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
