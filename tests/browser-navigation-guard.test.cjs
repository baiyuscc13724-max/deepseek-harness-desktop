const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const {
  BrowserNavigationLane,
  attachBrowserNavigationGuard,
  navigationTarget
} = require('../electron/bridge/browser-navigation-guard.cjs')

class FakeContents extends EventEmitter {
  constructor(url = 'https://source.example/page') {
    super()
    this.url = url
    this.loaded = []
    this.windowOpenHandler = null
  }

  getURL() { return this.url }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler }
  loadURL(url) { this.loaded.push(url); return Promise.resolve() }
}

function policyStub({ denyModel = new Set() } = {}) {
  const calls = []
  return {
    calls,
    userNavigate(url, options) {
      calls.push({ actor: 'user', url, options })
      return { normalized: String(url), origin: new URL(url).origin }
    },
    modelNavigate(url, options) {
      calls.push({ actor: 'model', url, options })
      if (denyModel.has(String(url))) throw Object.assign(new Error('denied'), { code: 'origin-not-authorized' })
      return { normalized: String(url), origin: new URL(url).origin }
    }
  }
}

function navigationEvent(url, extras = {}) {
  return {
    url,
    isMainFrame: true,
    prevented: false,
    preventDefault() { this.prevented = true },
    ...extras
  }
}

test('model lane persists across click, JavaScript navigation, redirect and passive pointer movement', () => {
  const deniedUrl = 'https://ungranted.example/private'
  const policy = policyStub({ denyModel: new Set([deniedUrl]) })
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy })

  lane.markModel('click')
  const jsNavigation = navigationEvent(deniedUrl)
  contents.emit('will-navigate', jsNavigation)
  assert.equal(jsNavigation.prevented, true)
  assert.equal(policy.calls.at(-1).actor, 'model')

  const redirect = navigationEvent(deniedUrl)
  contents.emit('will-redirect', redirect)
  assert.equal(redirect.prevented, true)
  assert.equal(policy.calls.at(-1).actor, 'model')

  contents.emit('before-mouse-event', {}, { type: 'mouseMove' })
  const delayedNavigation = navigationEvent(deniedUrl)
  contents.emit('will-navigate', delayedNavigation)
  assert.equal(delayedNavigation.prevented, true)
  assert.equal(policy.calls.at(-1).actor, 'model')

  contents.emit('before-mouse-event', {}, { type: 'mouseDown' })
  const unrelatedAfterInput = navigationEvent(deniedUrl)
  contents.emit('will-navigate', unrelatedAfterInput)
  assert.equal(unrelatedAfterInput.prevented, true)
  assert.equal(policy.calls.at(-1).actor, 'model')

  assert.equal(lane.noteTrustedNavigationIntent(deniedUrl, { base: contents.getURL() }), true)
  const userNavigation = navigationEvent(deniedUrl)
  contents.emit('will-navigate', userNavigation)
  assert.equal(userNavigation.prevented, false)
  assert.equal(policy.calls.at(-1).actor, 'user')
  contents.emit('did-navigate', {})
  assert.equal(lane.snapshot().actor, 'user')
})

test('synthetic model input cannot downgrade navigation provenance', () => {
  const deniedUrl = 'https://ungranted.example/form'
  const policy = policyStub({ denyModel: new Set([deniedUrl]) })
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy })

  const finish = lane.beginModelInput('keypress')
  contents.emit('before-input-event', {}, { type: 'keyDown' })
  finish()
  const formNavigation = navigationEvent(deniedUrl)
  contents.emit('will-navigate', formNavigation)
  assert.equal(formNavigation.prevented, true)
  assert.equal(policy.calls.at(-1).actor, 'model')
})

test('keyboard activation requires a non-repeat key and an exact trusted destination', () => {
  const deniedUrl = 'https://ungranted.example/keyboard'
  const policy = policyStub({ denyModel: new Set([deniedUrl]) })
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy })

  lane.markModel('type')
  contents.emit('before-input-event', {}, { type: 'keyUp' })
  const afterKeyUp = navigationEvent(deniedUrl)
  contents.emit('will-navigate', afterKeyUp)
  assert.equal(afterKeyUp.prevented, true)
  assert.equal(policy.calls.at(-1).actor, 'model')

  contents.emit('before-input-event', {}, { type: 'keyDown', isAutoRepeat: true })
  assert.equal(lane.noteTrustedNavigationIntent(deniedUrl, { base: contents.getURL() }), false)
  contents.emit('before-input-event', {}, { type: 'keyDown', isAutoRepeat: false })
  assert.equal(lane.noteTrustedNavigationIntent(deniedUrl, { base: contents.getURL() }), true)
  const exactDestination = navigationEvent(deniedUrl)
  contents.emit('will-navigate', exactDestination)
  assert.equal(exactDestination.prevented, false)
  assert.equal(policy.calls.at(-1).actor, 'user')
})

test('stopped model provenance survives user input and permits only the exact trusted destination', () => {
  const target = 'https://authorized.example/delayed'
  const intended = 'https://authorized.example/user-link'
  const policy = policyStub()
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  const denied = []
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy, onDenied: error => denied.push(error.code) })

  lane.markModel('delayed-click')
  assert.equal(lane.cancelModel(), true)
  contents.emit('before-mouse-event', {}, { type: 'mouseDown' })
  assert.equal(lane.noteTrustedNavigationIntent(intended, { base: contents.getURL() }), true)
  const staleNavigation = navigationEvent(target)
  contents.emit('will-navigate', staleNavigation)
  assert.equal(staleNavigation.prevented, true)
  assert.deepEqual(denied, ['browser-action-cancelled'])
  assert.equal(policy.calls.length, 0)

  lane.markModel('new-action-after-resume')
  const staleAfterNewAction = navigationEvent(target)
  contents.emit('will-navigate', staleAfterNewAction)
  assert.equal(staleAfterNewAction.prevented, true)
  assert.equal(lane.snapshot().actor, 'cancelled-model')
  assert.equal(lane.snapshot().modelCancelled, true)

  contents.emit('before-mouse-event', {}, { type: 'mouseDown' })
  assert.equal(lane.noteTrustedNavigationIntent(intended, { base: contents.getURL() }), true)
  const intendedNavigation = navigationEvent(intended)
  contents.emit('will-navigate', intendedNavigation)
  assert.equal(intendedNavigation.prevented, false)
  assert.equal(policy.calls.at(-1).actor, 'user')
  contents.emit('did-navigate', {})
  assert.equal(lane.snapshot().actor, 'user')

  lane.markModel('new-action-after-user-handoff')
  const freshNavigation = navigationEvent(target)
  contents.emit('will-navigate', freshNavigation)
  assert.equal(freshNavigation.prevented, false)
  assert.equal(policy.calls.at(-1).actor, 'model')
})

test('trusted download intent is exact and does not permanently release a cancelled document', () => {
  const now = { value: 100 }
  const lane = new BrowserNavigationLane({ now: () => now.value, userIntentTtlMs: 500 })
  lane.markModel('click')
  lane.cancelModel()
  lane.noteTrustedInput()
  assert.equal(lane.noteTrustedNavigationIntent('/file.zip', { base: 'https://files.example/page' }), true)
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/other.zip'), false)
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/file.zip'), true)
  assert.equal(lane.snapshot().actor, 'cancelled-model')

  lane.noteTrustedInput()
  assert.equal(lane.noteTrustedNavigationIntent('/expired.zip', { base: 'https://files.example/page' }), true)
  now.value += 501
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/expired.zip'), false)

  lane.markUser('trusted-page')
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/drive-by.zip'), false)
  lane.noteTrustedInput()
  assert.equal(lane.noteTrustedNavigationIntent('/manual.zip', { base: 'https://files.example/page' }), true)
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/manual.zip'), true)

  lane.markUser('address-bar')
  assert.equal(lane.noteBrowserUiNavigationIntent('/typed.zip', { base: 'https://files.example/page' }), true)
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/other-typed.zip'), false)
  assert.equal(lane.consumeTrustedDownloadIntent('https://files.example/typed.zip'), true)
})

test('trusted navigation in flight permits only its exact redirected download target', () => {
  const lane = new BrowserNavigationLane()
  const policy = policyStub()
  lane.markModel('old-model-document')
  lane.noteTrustedInput()
  assert.equal(lane.noteTrustedNavigationIntent('/download', { base: 'https://files.example/page' }), true)
  lane.validate(policy, 'https://files.example/download', { tabId: 'tab-1', base: 'https://files.example/page' })
  lane.validate(policy, 'https://cdn.example/final.zip', { tabId: 'tab-1', base: 'https://files.example/download', kind: 'redirect' })
  assert.equal(lane.consumeTrustedDownloadIntent('https://cdn.example/other.zip'), false)
  assert.equal(lane.consumeTrustedDownloadIntent('https://cdn.example/final.zip'), true)
})

test('model window.open is denied before loading an unauthorized target', () => {
  const deniedUrl = 'https://ungranted.example/popup'
  const policy = policyStub({ denyModel: new Set([deniedUrl]) })
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy })

  lane.markModel('click')
  assert.deepEqual(contents.windowOpenHandler({ url: deniedUrl }), { action: 'deny' })
  assert.deepEqual(contents.loaded, [])
  assert.equal(policy.calls.at(-1).actor, 'model')
})

test('policy getter follows a resumed or replaced BrowserSecurityPolicy instance', () => {
  const first = policyStub()
  const second = policyStub()
  let current = first
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy: () => current })

  contents.emit('will-navigate', navigationEvent('https://first.example'))
  current = second
  contents.emit('will-navigate', navigationEvent('https://second.example'))
  assert.equal(first.calls.length, 1)
  assert.equal(second.calls.length, 1)
  assert.equal(second.calls[0].url, 'https://second.example')
})

test('reset only permits about:blank and navigation target accepts Electron 43 details', () => {
  const policy = policyStub()
  const contents = new FakeContents()
  const lane = new BrowserNavigationLane()
  attachBrowserNavigationGuard({ contents, tabId: 'tab-1', lane, policy, isResetting: () => true })

  const blank = navigationEvent('about:blank')
  contents.emit('will-navigate', blank)
  assert.equal(blank.prevented, false)
  const network = navigationEvent('https://example.com')
  contents.emit('will-redirect', network)
  assert.equal(network.prevented, true)
  assert.equal(policy.calls.length, 0)
  assert.equal(navigationTarget({ url: 'https://details.example' }, 'https://legacy.example'), 'https://details.example')
})

test('production click and form paths pass their resolved destinations into the action gate', async () => {
  const [main, provenancePreload] = await Promise.all([
    readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8'),
    readFile(path.join(__dirname, '..', 'electron', 'browser-provenance-preload.cjs'), 'utf8')
  ])
  assert.match(main, /const formAction=submit&&form\?String\(element\.formAction\|\|form\.action\|\|''\):''/u)
  assert.match(main, /const navigatesTo = field\.href \|\| field\.formAction \|\| ''/u)
  assert.match(main, /payload: actionPayload/u)
  assert.match(main, /attachBrowserNavigationGuard\(\{/u)
  assert.match(main, /preload: path\.join\(__dirname, 'browser-provenance-preload\.cjs'\)/u)
  assert.match(main, /browser-page:user-navigation-intent/u)
  assert.match(main, /markBrowserModelNavigation\(tabId, action \|\| 'unknown-action'\)/u)
  assert.match(main, /element\.type==='image'/u)
  assert.match(main, /field\.download === true/u)
  assert.match(main, /consumeTrustedDownloadIntent/u)
  assert.match(main, /mouseMoved[\s\S]{0,500}Input\.dispatchMouseEvent/u)
  assert.match(main, /Page\.setInterceptFileChooserDialog', \{ enabled: true, cancel: true \}/u)
  assert.match(main, /Page\.fileChooserOpened/u)
  assert.match(main, /tab\.view\.webContents\.stop\(\)/u)
  assert.match(main, /\?\.click\(\)`, false\)/u)
  assert.doesNotMatch(main, /\?\.click\(\)`, true\)/u)
  assert.match(main, /noteBrowserUiNavigationIntent\(target/u)
  assert.doesNotMatch(main, /contents\.on\('will-(?:navigate|redirect)'[\s\S]{0,300}userNavigate/u)
  assert.match(provenancePreload, /event\.isTrusted/u)
  assert.match(provenancePreload, /ipcRenderer\.sendSync\(USER_NAVIGATION_INTENT_CHANNEL/u)
  assert.match(provenancePreload, /event\.composedPath/u)
  assert.doesNotMatch(provenancePreload, /contextBridge|exposeInMainWorld/u)
})
