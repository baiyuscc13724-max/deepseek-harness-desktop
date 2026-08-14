const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')

const { nodeRuntimeSupported, runPackagedSelfTest } = require('../electron/bridge/self-test-service.cjs')

test('node runtime check rejects obsolete runtimes', () => {
  assert.equal(nodeRuntimeSupported('24.1.0'), true)
  assert.equal(nodeRuntimeSupported('18.20.0'), false)
  assert.equal(nodeRuntimeSupported('invalid'), false)
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
      nodeVersion: '24.1.0'
    })
    assert.equal(report.ok, true)
    assert.deepEqual(report.checks, {
      rendererEntry: true,
      bundledHarness: true,
      runtimeWebBoot: true,
      nodeRuntime: true,
      userData: true,
      webCompatibility: true
    })
    assert.equal(report.dsh.version, '0.1.0-rc.6')
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
      nodeVersion: '24.1.0'
    })
    assert.equal(report.ok, false)
    assert.equal(report.checks.runtimeWebBoot, false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
