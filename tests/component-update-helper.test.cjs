const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { ComponentUpdateStore } = require('../electron/bridge/component-update-store.cjs')
const { applyReadyComponentUpdate, desktopEnvironment } = require('../electron/bridge/component-update-helper.cjs')
const { helperEnvironment, launchComponentUpdateHelper, physicalAsarPath } = require('../electron/bridge/component-update-launcher.cjs')
const { confirmComponentActivation, prepareComponentActivation } = require('../electron/bridge/component-update-health.cjs')

function component(version, digit) {
  return { id: 'desktop-shell', version, sha256: digit.repeat(64) }
}

async function prepareReady(store, releaseVersion, value) {
  await store.beginStaging({ mode: 'components', releaseVersion, components: [value] })
  const pending = (await store.get()).pending.components[0]
  await mkdir(store.componentPath(pending), { recursive: true })
  await store.markReady()
}

async function activateBaseline(store) {
  await prepareReady(store, '1.0.23', component('1.0.23', '1'))
  await store.markApplying()
  await store.activatePending(new Date('2026-08-19T00:00:00.000Z'))
  await store.beginHealthCheck()
  await store.confirmHealthy()
}

test('helper applies a ready pointer only after the parent exits and restarts desktop', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-helper-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new ComponentUpdateStore(root)
  await prepareReady(store, '1.0.24', component('1.0.24', '2'))
  const calls = []
  const result = await applyReadyComponentUpdate({
    store,
    parentPid: 1234,
    waitImpl: async pid => calls.push(['wait', pid]),
    spawnImpl: (file, args, options) => {
      calls.push(['spawn', file, args, options])
      return { pid: 4321, unref() { calls.push(['unref']) } }
    },
    restart: { executable: path.join(root, 'Harness Desktop.exe'), cwd: root, args: [] }
  })

  assert.deepEqual(calls[0], ['wait', 1234])
  assert.equal(calls[1][0], 'spawn')
  assert.equal(result.state.phase, 'awaiting-health')
  assert.equal(result.restartPid, 4321)
  assert.equal((await store.pointer()).releaseVersion, '1.0.24')
})

test('desktop restart clears Electron-as-Node helper flags', () => {
  const env = desktopEnvironment({ ELECTRON_RUN_AS_NODE: '1', HARNESS_COMPONENT_UPDATE_HELPER: '1', PATH: 'test-path' })
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.HARNESS_COMPONENT_UPDATE_HELPER, undefined)
  assert.equal(env.PATH, 'test-path')
})

test('first startup requests health check and confirmation makes version last-known-good', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-health-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new ComponentUpdateStore(root)
  await prepareReady(store, '1.0.24', component('1.0.24', '2'))
  await store.markApplying()
  await store.activatePending()

  const prepared = await prepareComponentActivation({ store })
  assert.equal(prepared.action, 'health-check-required')
  const confirmed = await confirmComponentActivation(store)
  assert.equal(confirmed.confirmed, true)
  assert.equal(confirmed.state.phase, 'idle')
  assert.equal(confirmed.state.lastKnownGood.releaseVersion, '1.0.24')
})

test('a second startup without health confirmation rolls back to last-known-good', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-crash-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new ComponentUpdateStore(root)
  await activateBaseline(store)
  await prepareReady(store, '1.0.24', component('1.0.24', '2'))
  await store.markApplying()
  await store.activatePending()

  assert.equal((await prepareComponentActivation({ store })).action, 'health-check-required')
  const recovered = await prepareComponentActivation({ store })
  assert.equal(recovered.action, 'rolled-back')
  assert.equal(recovered.pointer.releaseVersion, '1.0.23')
  assert.equal((await store.get()).phase, 'failed')
})

test('launcher resolves the helper to its physical app.asar.unpacked path', () => {
  const logical = path.join('D:\\Apps\\Harness Desktop\\resources', 'app.asar', 'scripts', 'component-update-helper.cjs')
  assert.match(physicalAsarPath(logical), /app\.asar\.unpacked[\\/]scripts[\\/]component-update-helper\.cjs$/)
})

test('launcher strips application secrets from helper environment', () => {
  const env = helperEnvironment({
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Windows\\System32',
    OPENAI_API_KEY: 'secret',
    HARNESS_COMPONENT_SIGNING_KEY_FILE: 'private.pem'
  })
  assert.equal(env.SystemRoot, 'C:\\Windows')
  assert.equal(env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.HARNESS_COMPONENT_SIGNING_KEY_FILE, undefined)
})

test('launcher starts a detached helper only for ready state', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-component-launcher-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new ComponentUpdateStore(root)
  await assert.rejects(() => launchComponentUpdateHelper({ store }), /尚未准备/)
  await prepareReady(store, '1.0.24', component('1.0.24', '2'))
  const executable = path.join(root, 'Harness Desktop.exe')
  const helperScript = path.join(root, 'component-update-helper.cjs')
  await writeFile(executable, '')
  await writeFile(helperScript, '')
  let launch
  const result = await launchComponentUpdateHelper({
    store,
    execPath: executable,
    helperScript,
    componentRoot: root,
    parentPid: 1234,
    spawnImpl: (file, args, options) => {
      launch = { file, args, options }
      return { pid: 5678, unref() {} }
    }
  })
  assert.equal(result.pid, 5678)
  assert.equal(launch.options.detached, true)
  assert.equal(launch.options.stdio, 'ignore')
  assert.ok(launch.args.includes('--parent-pid'))
  assert.equal(launch.options.env.ELECTRON_RUN_AS_NODE, '1')
})
