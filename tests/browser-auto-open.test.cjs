const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')
const {
  BROWSER_INTENT_VERSION,
  BROWSER_INTENT_ACTIONS,
  safeHttpUrl,
  normalizeBrowserOpenIntent
} = require('../electron/bridge/browser-open-intent.cjs')
const {
  normalizeBrowserOpenIntent: normalizeShellIntent,
  browserIntentTabAction
} = require('../renderer/right-workspace.js')

async function loadClientPlugin(reactOverrides = {}) {
  const clientSource = await source('plugins/dsh-session-experience/lib/client.js')
  let registration
  const browser = { __ModuleLoader__: { load(value) { registration = value } } }
  new Function('window', clientSource)(browser)
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) { return { type, props: props || {}, children } },
    useState(initial) { return [initial, () => {}] },
    useEffect() {},
    useRef(initial) { return { current: initial } },
    ...reactOverrides
  }
  const plugin = registration.factory(name => {
    if (name !== 'react') throw new Error(`unexpected client dependency: ${name}`)
    return React
  })
  return { browser, plugin, React }
}

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null
  if (predicate(node)) return node
  for (const child of node.children || []) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}

async function mountIntentBridge({ draft, imageIds = [] }) {
  const effects = []
  const { browser, plugin } = await loadClientPlugin({ useEffect(effect) { effects.push(effect) } })
  const published = []
  const draftWrites = []
  const listeners = {}
  const textarea = { tagName: 'TEXTAREA' }
  const card = {
    contains: target => target === textarea || target?.kind === 'send',
    addEventListener(type, listener) { listeners[type] = listener },
    removeEventListener(type, listener) { if (listeners[type] === listener) delete listeners[type] }
  }
  const anchor = { closest: selector => selector === '[data-composer-card="true"]' ? card : null }
  browser.harnessDesktopGuest = {
    publishRightWorkspaceContext: () => true,
    onRightWorkspaceCommand: () => () => {},
    publishRightWorkspaceIntent(value) { published.push(value); return true }
  }
  const tree = plugin.__browserIntentTest.PaperclipButton({
    sessionId: 'session-1',
    input: { sessionId: 'session-1', draft, imageIds },
    inputActions: { setDraft(value) { draftWrites.push(value) } }
  })
  const marker = findNode(tree, node => node.props?.['data-dsh-browser-intent-bridge'] === 'ready')
  assert.ok(marker, 'browser intent marker must render inside the composer card')
  marker.props.ref.current = anchor
  const cleanups = effects.map(effect => effect()).filter(value => typeof value === 'function')
  return { browser, plugin, published, draftWrites, listeners, textarea, card, cleanups }
}

function fakeEvent(target, extra = {}) {
  return {
    target,
    key: '',
    defaultPrevented: false,
    propagationStopped: false,
    immediateStopped: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagationStopped = true },
    stopImmediatePropagation() { this.immediateStopped = true },
    ...extra
  }
}

test('browser intent protocol accepts only an exact bounded enum and credential-free HTTP(S) URL', () => {
  assert.deepEqual(normalizeBrowserOpenIntent({ action: BROWSER_INTENT_ACTIONS.READY, version: BROWSER_INTENT_VERSION }), { action: 'bridge-ready', version: 1 })
  assert.deepEqual(normalizeBrowserOpenIntent({ action: BROWSER_INTENT_ACTIONS.SHOW }), { action: 'show-browser' })
  assert.deepEqual(normalizeBrowserOpenIntent({ action: BROWSER_INTENT_ACTIONS.OPEN_URL, url: 'https://example.com/path?q=1' }), { action: 'open-browser-url', url: 'https://example.com/path?q=1' })
  for (const value of [
    { action: 'show-browser', text: 'raw prompt' },
    { action: 'open-browser-url', url: 'javascript:alert(1)' },
    { action: 'open-browser-url', url: 'file:///C:/secret.txt' },
    { action: 'open-browser-url', url: 'https://user:pass@example.com/' },
    { action: 'bridge-ready', version: 2 },
    { action: 'unknown' }
  ]) assert.equal(normalizeBrowserOpenIntent(value), null)
  assert.equal(safeHttpUrl(' https://example.com'), '')
  assert.equal(safeHttpUrl(`https://example.com/${'a'.repeat(2100)}`), '')
})

test('client parser recognizes only explicit browser commands and explicit HTTP(S) URL commands', async () => {
  const { plugin } = await loadClientPlugin()
  const parse = plugin.__browserIntentTest.parseBrowserOpenIntent
  for (const command of ['打开右侧浏览器', '显示浏览器。', '切换到右侧浏览器', 'open the right browser', 'Show browser panel!']) {
    assert.deepEqual(parse(command), { action: 'show-browser' }, command)
  }
  assert.deepEqual(parse('在右侧打开 https://example.com/docs'), { action: 'open-browser-url', url: 'https://example.com/docs' })
  assert.deepEqual(parse('打开网址：https://example.com'), { action: 'open-browser-url', url: 'https://example.com/' })
  assert.deepEqual(parse('open https://example.com/a in the right browser'), { action: 'open-browser-url', url: 'https://example.com/a' })
  for (const text of ['帮我查一下天气', '这个网址安全吗 https://example.com', '打开这个链接', '总结 https://example.com', '打开 file:///C:/secret.txt', 'open javascript:alert(1)']) {
    assert.equal(parse(text), null, text)
  }
})

test('Enter on an exact local browser command is consumed before model submission', async t => {
  const mounted = await mountIntentBridge({ draft: '打开右侧浏览器' })
  t.after(() => mounted.cleanups.forEach(cleanup => cleanup()))
  assert.deepEqual(mounted.published[0], { action: 'bridge-ready', version: 1 })
  const event = fakeEvent(mounted.textarea, { key: 'Enter', shiftKey: false, altKey: false, repeat: false, isComposing: false })
  mounted.listeners.keydown(event)
  assert.equal(event.defaultPrevented, true)
  assert.equal(event.immediateStopped, true)
  assert.deepEqual(mounted.draftWrites, [''])
  assert.deepEqual(mounted.published.at(-1), { action: 'show-browser' })
  assert.doesNotMatch(JSON.stringify(mounted.published), /打开右侧浏览器/u, 'raw prompt must never cross the guest bridge')
})

test('send-button URL command opens locally, while attachments prevent command consumption', async t => {
  const mounted = await mountIntentBridge({ draft: '打开 https://example.com/' })
  t.after(() => mounted.cleanups.forEach(cleanup => cleanup()))
  const button = { kind: 'send', disabled: false, getAttribute: name => name === 'aria-label' ? '发送消息' : '', closest: selector => selector === 'button' ? button : null }
  const child = { closest: selector => selector === 'button' ? button : null }
  const event = fakeEvent(child)
  mounted.listeners.click(event)
  assert.equal(event.defaultPrevented, true)
  assert.deepEqual(mounted.published.at(-1), { action: 'open-browser-url', url: 'https://example.com/' })

  const withAttachment = await mountIntentBridge({ draft: '打开右侧浏览器', imageIds: ['image-1'] })
  t.after(() => withAttachment.cleanups.forEach(cleanup => cleanup()))
  const attachmentEvent = fakeEvent(withAttachment.textarea, { key: 'Enter', shiftKey: false, altKey: false, repeat: false, isComposing: false })
  withAttachment.listeners.keydown(attachmentEvent)
  assert.equal(attachmentEvent.defaultPrevented, false)
  assert.deepEqual(withAttachment.draftWrites, [])
  assert.deepEqual(withAttachment.published, [{ action: 'bridge-ready', version: 1 }])
})

test('shell intent normalization and tab choice are deterministic and do not replace a busy tab', () => {
  assert.deepEqual(normalizeShellIntent({ action: 'bridge-ready', version: 1 }), { action: 'bridge-ready', version: 1 })
  assert.deepEqual(normalizeShellIntent({ action: 'show-browser' }), { action: 'show-browser' })
  assert.deepEqual(normalizeShellIntent({ action: 'open-browser-url', url: 'https://example.com' }), { action: 'open-browser-url', url: 'https://example.com/' })
  assert.equal(normalizeShellIntent({ action: 'open-browser-url', url: 'data:text/plain,no' }), null)
  assert.equal(browserIntentTabAction({ currentUrl: '', targetUrl: 'https://example.com/' }), 'navigate-current')
  assert.equal(browserIntentTabAction({ currentUrl: 'about:blank', targetUrl: 'https://example.com/' }), 'navigate-current')
  assert.equal(browserIntentTabAction({ currentUrl: 'https://example.com/', targetUrl: 'https://example.com/' }), 'keep-current')
  assert.equal(browserIntentTabAction({ currentUrl: 'https://logged-in.example/', targetUrl: 'https://example.com/' }), 'open-new-tab')
})

test('auto-open stays in owned plugin/preload layers and reports update drift instead of patching official bundles', async () => {
  const [guest, integration, sidebar, client, patcher, main, pkg] = await Promise.all([
    source('electron/guest-preload.cjs'), source('renderer/right-workspace-integration.js'),
    source('renderer/browser-sidebar.js'), source('plugins/dsh-session-experience/lib/client.js'),
    source('scripts/patch-official-runtime.mjs'), source('electron/main.cjs'),
    source('package.json').then(JSON.parse)
  ])
  assert.match(guest, /normalizeBrowserOpenIntent/u)
  assert.match(guest, /sendToHost\('right-workspace:intent', intent\)/u)
  assert.match(client, /data-dsh-browser-intent-bridge/u)
  assert.match(client, /publishRightWorkspaceIntent\(\{ action: "bridge-ready", version: BROWSER_INTENT_VERSION \}\)/u)
  assert.match(client, /event\.stopImmediatePropagation/u)
  assert.match(integration, /event\.channel === 'right-workspace:intent'/u)
  assert.match(integration, /factory\.browserIntentTabAction/u)
  assert.match(integration, /api\.navigateBrowser\(intent\.url\)/u)
  assert.match(integration, /api\.newBrowserTab\(intent\.url\)/u)
  assert.match(integration, /browser intent bridge unavailable/u)
  assert.match(sidebar, /setStatus: setBrowserStatus/u)
  assert.match(main, /markBrowserUserNavigation\(activeBrowserTabId, 'address-bar'\)/u)
  assert.match(main, /markBrowserUserNavigation\(tabId, 'new-tab'\)/u)
  assert.doesNotMatch(patcher, /right-workspace:intent|browser-open-intent/u, 'official runtime patcher must not own browser intent recognition')
  assert.ok(pkg.build.files.includes('plugins/dsh-session-experience/**/*'))
  assert.ok(pkg.build.asarUnpack.includes('plugins/dsh-session-experience/**/*'))
})
