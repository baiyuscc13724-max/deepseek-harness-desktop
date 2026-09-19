const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { BrowserControlServer } = require('../electron/bridge/browser-control-server.cjs')
const { BrowserOperationCoordinator } = require('../electron/bridge/browser-operation-coordinator.cjs')
const { isModelBootstrapSourceUrl } = require('../electron/bridge/browser-security-policy.cjs')

function extractFunction(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'))
  assert.ok(start >= 0, `actual main function ${name} exists`)
  const rest = source.slice(start)
  const next = rest.slice(1).search(/^(?:(?:async )?function |class )/m)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

test('actual loopback desktop scope routes only fixed authorized requests and refuses old server token', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'desktop-route-test-'))
  const received = []
  const server = new BrowserControlServer({ stateFile: path.join(temp, 'state.json'), handler: async body => { received.push(body); return { scope: body.scope, action: body.action } } })
  try {
    await server.start()
    const state = JSON.parse(await fs.readFile(server.stateFile, 'utf8'))
    async function post(body, token = state.token, origin = state.origin) {
      const response = await fetch(origin + '/action', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: response.status, body: await response.json() }
    }
    const success = await post({ scope: 'desktop', action: 'status' })
    assert.equal(success.status, 200)
    assert.deepEqual(success.body.result, { scope: 'desktop', action: 'status' })
    for (const body of [{ scope: 'wrong', action: 'status' }, { scope: {}, action: 'status' }, { scope: 'desktop', action: 'shell' }, { scope: 'desktop', action: 123 }]) {
      assert.equal((await post(body)).status, 400)
      assert.equal(received.length, 1)
    }
    assert.equal((await post({ scope: 'desktop', action: 'status' }, 'wrong')).status, 401)
    assert.equal(received.length, 1)
    await server.stop(); await server.start()
    const next = JSON.parse(await fs.readFile(server.stateFile, 'utf8'))
    assert.notEqual(next.token, state.token)
    assert.equal((await post({ scope: 'desktop', action: 'status' }, state.token, next.origin)).status, 401)
    assert.equal(received.length, 1)
  } finally { await server.stop(); await fs.rm(temp, { recursive: true, force: true }) }
})

test('actual main recovery classifies authorization, Stop, cold, blank and crashed tabs without bootstrapping on status', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const control = { granted: true, active: true }
  let contents = null, created = 0
  const context = vm.createContext({
    mainWindow: { isDestroyed: () => false }, browserTabs: new Map(), activeBrowserTabId: '', browserView: null,
    browserState: {}, browserSecurityPolicy: { isModelStopped: false }, browserOperations: new BrowserOperationCoordinator(),
    sharedComputerUseControlState: () => control, liveBrowserContents: () => contents, isModelBootstrapSourceUrl,
    requireSharedComputerUseForBrowser() { if (!control.granted || !control.active) throw Object.assign(new Error('shared control denied'), { code: 'stopped' }) },
    ensureBrowserSession() { created += 1; contents = { getURL: () => 'about:blank' }; context.browserView = { webContents: contents }; return context.browserView },
    updateBrowserActiveTab(url) { context.browserState.origin = /^https?:/.test(url) ? new URL(url).origin : '' }
  })
  vm.runInContext(['browserRecoveryState', 'requireBrowserForModel'].map(name => extractFunction(source, name)).join('\n'), context)
  const status = () => JSON.parse(JSON.stringify(context.browserRecoveryState()))
  assert.equal(status().state, 'not-started'); assert.deepEqual(status().actions, ['navigate', 'tabOpen']); assert.equal(created, 0)
  assert.throws(() => context.requireBrowserForModel(), error => error.code === 'browser-not-started'); assert.equal(created, 0)
  control.granted = false
  assert.equal(status().state, 'authorization-required')
  assert.throws(() => context.requireBrowserForModel(null, { allowBlankNavigation: true }), error => error.code === 'stopped'); assert.equal(created, 0)
  control.granted = true; control.active = false
  assert.equal(status().state, 'stopped')
  assert.equal(status().canBootstrap, false)
  assert.throws(() => context.requireBrowserForModel(null, { allowBlankNavigation: true }), error => error.code === 'stopped'); assert.equal(created, 0)
  control.active = true
  context.requireBrowserForModel(null, { allowBlankNavigation: true })
  assert.equal(created, 1); assert.equal(status().state, 'blank')
  assert.throws(() => context.requireBrowserForModel(), error => error.code === 'browser-blank-page')
  context.activeBrowserTabId = 'page'; context.browserTabs.set('page', { available: true })
  contents.getURL = () => 'https://example.com/'
  assert.equal(status().state, 'ready'); assert.equal(context.requireBrowserForModel().origin, 'https://example.com')
  context.browserTabs.get('page').available = false
  assert.equal(status().state, 'tab-unavailable'); assert.deepEqual(status().actions, ['tabList', 'tabSwitch'])
  assert.throws(() => context.requireBrowserForModel(null, { allowBlankNavigation: true }), error => error.code === 'tab-unavailable')
  assert.equal(created, 1, 'crashed tab never creates another session')
  context.browserSecurityPolicy.isModelStopped = true
  assert.equal(status().state, 'stopped', 'Stop precedes crashed tab')
  assert.equal(created, 1, 'status is read-only and never revives Stop')
})

test('actual close-last-tab creates one blank UI tab, invalidates original refs and never clears model Stop', async () => {
  const source = await fs.readFile(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  let created = 0, closed = 0
  const loaded = [], unavailable = []
  const context = vm.createContext({
    mainWindow: { isDestroyed: () => false, contentView: { removeChildView() {} } }, browserTabs: new Map(), browserDialogs: new Map(), activeBrowserTabId: '', browserView: null,
    browserState: {}, browserOperations: new BrowserOperationCoordinator(), browserSecurityPolicy: { isModelStopped: false, markActiveTabUnavailable(id) { unavailable.push(id) } },
    isModelBootstrapSourceUrl, sharedComputerUseControlState: () => ({ granted: true, active: true }),
    layoutBrowserView() {}, publishBrowserState: async () => ({ recovery: context.browserRecoveryState() }), browserStatePayload: async () => ({ recovery: context.browserRecoveryState() }),
    ensureBrowserSession() {
      const id = 'tab-' + (++created); let url = 'about:blank', destroyed = false
      const view = { webContents: { isDestroyed: () => destroyed, close() { destroyed = true; closed += 1 }, getURL: () => url, getTitle: () => '', isLoading: () => false, async loadURL(value) { url = value; loaded.push(value) } } }
      context.browserTabs.set(id, { id, view, available: true, navigationGeneration: 0, modelObservation: null })
      context.activeBrowserTabId = id; context.browserView = view
      return view
    }
  })
  vm.runInContext(['liveBrowserContents', 'browserRecoveryState', 'createBrowserTab', 'closeBrowserTab', 'assertBrowserReference'].map(name => extractFunction(source, name)).join('\n'), context)
  const oldView = context.ensureBrowserSession(), oldId = context.activeBrowserTabId
  const ref = 'b' + 'a'.repeat(32) + '_1'
  context.browserTabs.get(oldId).modelObservation = { refs: new Set([ref]), navigationGeneration: 0, ticket: context.browserOperations.modelTicket() }
  assert.ok(context.assertBrowserReference(oldView, ref))
  const result = await context.closeBrowserTab(oldId)
  assert.equal(created, 2); assert.equal(closed, 1); assert.equal(context.browserTabs.size, 1)
  assert.deepEqual(loaded, ['about:blank']); assert.deepEqual(unavailable, [oldId]); assert.equal(result.state.recovery.state, 'blank')
  assert.throws(() => context.assertBrowserReference(oldView, ref), error => error.code === 'browser-reference-stale')
  context.browserSecurityPolicy.isModelStopped = true
  await context.closeBrowserTab(context.activeBrowserTabId)
  assert.equal(created, 3); assert.equal(closed, 2); assert.equal(context.browserTabs.size, 1)
  assert.equal(context.browserRecoveryState().state, 'stopped'); assert.equal(context.browserRecoveryState().canBootstrap, false)
  assert.equal(context.browserSecurityPolicy.isModelStopped, true, 'UI last-tab housekeeping never resumes model control')
})
