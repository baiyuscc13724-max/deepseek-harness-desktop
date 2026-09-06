'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const rootDir = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(rootDir, 'mobile/android/app/src/main/assets/mobile-runtime.js'), 'utf8')
const block = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))

function recoveryFixture() {
  let calls = 0
  let succeed = false
  let release
  const events = []
  const root = { dataset: {} }
  const storage = new Map([['draft', 'unsent draft']])
  const document = { visibilityState: 'visible', addEventListener() {} }
  const window = { navigator: { onLine: true }, location: { href: 'https://mobile.test/session/kept' },
    HarnessMobileCacheIdentity: 'a'.repeat(64), localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    addEventListener() {}, dispatchEvent: e => events.push(e.detail),
    fetch: async request => {
      calls++
      if (!succeed) return new Response('', { status: 503 })
      await new Promise(resolve => { release = resolve })
      const envelope = JSON.parse(await request.text())
      return new Response(JSON.stringify({ rpcId: envelope.rpcId, result: { ok: true, value: { items: [{ sessionId: 'fresh' }] } } }), { headers: { 'content-type': 'application/json' } })
    }
  }
  const ctx = { window, root, document, Request, Response, URL, CustomEvent: class { constructor(type, init) { this.detail = init.detail } }, setTimeout: fn => queueMicrotask(fn) }
  vm.runInNewContext(block('  const installHistoryRecovery = () => {', '    const isHistoryFailure =') + '\n window.testRecovery = { refreshIndex, cachedIndexEntry, cacheIndexPayload, indexPending }; }; installHistoryRecovery();', ctx)
  const envelope = { rpcId: 'first', method: 'session/list', payload: { args: { _request: {} } } }
  const descriptor = { key: 'session:test', kind: 'session', envelope, request: new Request('https://mobile.test/api/session/list', { method: 'POST', body: JSON.stringify(envelope) }) }
  window.testRecovery.cacheIndexPayload(descriptor, { rpcId: 'old', result: { ok: true, value: { items: [{ sessionId: 'cached' }] } } })
  return { root, window, descriptor, events, storage, calls: () => calls, succeed: () => { succeed = true }, release: () => release() }
}

test('four failures become recoverable failure; manual retry coalesces and preserves draft/route/cache', async () => {
  const f = recoveryFixture()
  await f.window.testRecovery.refreshIndex(f.descriptor)
  assert.equal(f.calls(), 4)
  assert.equal(f.root.dataset.harnessMobileIndexRecoveryState, 'failed')
  assert.equal(f.events.at(-1).state, 'failed')
  assert.equal(f.window.testRecovery.cachedIndexEntry(f.descriptor.key).payload.result.value.items[0].sessionId, 'cached')
  assert.equal(typeof f.window.__harnessMobileRetryIndexes, 'function')
  f.succeed()
  const a = f.window.__harnessMobileRetryIndexes()
  const b = f.window.__harnessMobileRetryIndexes()
  while (f.calls() < 5) await new Promise(resolve => setImmediate(resolve))
  f.release()
  await Promise.all([a, b])
  assert.equal(f.calls(), 5)
  assert.equal(f.window.testRecovery.indexPending.size, 0)
  assert.equal(f.root.dataset.harnessMobileIndexRecoveryState, undefined)
  assert.equal(f.storage.get('draft'), 'unsent draft')
  assert.equal(f.window.location.href, 'https://mobile.test/session/kept')
})

function modalFixture() {
  const timers = []
  const document = { activeElement: null, dialogs: [], querySelectorAll() { return this.dialogs }, querySelector() { return null }, getElementById() { return { querySelector: () => null } }, listeners: {}, addEventListener(k, fn) { this.listeners[k] = fn } }
  class Node {
    constructor(parent = null, z = 'auto') { this.parentElement = parent; this.style = { display: 'block', visibility: 'visible', zIndex: z }; this.hidden = false; this.isConnected = true; this.dataset = {}; this.attrs = {}; this.children = []; this.listeners = {}; this.closed = 0; parent?.children.push(this) }
    getBoundingClientRect() { return { width: 100, height: 100 } }
    getAttribute(k) { return this.attrs[k] ?? null }
    setAttribute(k,v) { this.attrs[k] = v }
    hasAttribute(k) { return k in this.attrs }
    matches(s) { return s === 'dialog' ? false : s.includes('role="dialog"') ? document.dialogs.includes(this) : false }
    closest(s) { for (let p = this; p; p = p.parentElement) if ((s.includes('inert') && p.inert) || (s.includes('hidden') && p.hidden)) return p; return null }
    contains(n) { for (; n; n = n.parentElement) if (n === this) return true; return false }
    querySelectorAll() { return this.children }
    querySelector() { return null }
    addEventListener(k, f) { this.listeners[k] = f }
    focus() { document.activeElement = this }
    click() { this.closed++; this.parentElement.hidden = true }
  }
  const trigger = new Node(); trigger.focus()
  const oldParent = new Node(); oldParent.hidden = true
  const old = new Node(oldParent)
  const low = new Node(null, '100'); const lowClose = new Node(low); lowClose.textContent = '关闭'
  const high = new Node(null, '200'); const highClose = new Node(high); highClose.textContent = '关闭'
  const hiddenArea = new Node(high); hiddenArea.hidden = true; const hiddenButton = new Node(hiddenArea)
  // Flat query results mimic DOM descendant queries, including a hidden ancestor.
  high.querySelectorAll = () => [highClose, hiddenButton]
  document.dialogs = [old, low, high]
  const root = { dataset: {} }; const window = {}
  const ctx = { document, root, window, getComputedStyle: n => n.style, setTimeout: fn => timers.push(fn), visible: n => !n.hidden && n.style.display !== 'none', mobileNavigationState: { activeDomain: 'conversations' }, sidebarExpanded: () => true, isMobileConversationDetailOpen: () => false }
  vm.runInNewContext(block('  const mobileImageLightboxParts =', '  const syncMobileAppShell =') + block('  let activeMobileDialog =', '  const decorateDialogs =') + '\n window.sync = () => syncDialogFocus(document.dialogs); window.focusable = dialogFocusable; installMobileBackHandler();', ctx)
  return { document, window, trigger, low, lowClose, high, highClose, old, timers, flush() { while (timers.length) timers.shift()() } }
}

test('Back closes only the top visible modal, never an old hidden dialog', () => {
  const f = modalFixture()
  assert.equal(f.window.__harnessMobileHandleBack(), true)
  assert.equal(f.highClose.closed, 1)
  assert.equal(f.lowClose.closed, 0)
})

test('focus belongs to visible top layer; hidden descendants excluded; closes restore trigger', () => {
  const f = modalFixture()
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.highClose)
  assert.deepEqual([...f.window.focusable(f.high)], [f.highClose])
  let prevented = false
  f.high.listeners.keydown({ key: 'Tab', preventDefault() { prevented = true } })
  assert.equal(prevented, true)
  f.high.hidden = true; f.low.hidden = true
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.trigger)
})

test('Escape consumes the event and dismisses exactly one visible top layer', () => {
  const f = modalFixture()
  let prevented = 0, stopped = 0
  f.document.listeners.keydown({ key: 'Escape', preventDefault() { prevented++ }, stopImmediatePropagation() { stopped++ } })
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  assert.equal(f.highClose.closed, 1)
  assert.equal(f.lowClose.closed, 0)
})

test('nested dialog close restores each trigger without stealing focus from the remaining layer', () => {
  const f = modalFixture()
  f.high.hidden = true
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.lowClose)
  f.high.hidden = false
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.highClose)
  f.high.hidden = true
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.lowClose)
  f.low.hidden = true
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.trigger)
})

test('inert/aria-hidden/display-none ancestors are excluded and z-index overrides DOM order', () => {
  for (const hide of [node => { node.inert = true }, node => { node.attrs['aria-hidden'] = 'true' }, node => { node.style.display = 'none' }]) {
    const f = modalFixture()
    hide(f.high)
    f.window.sync(); f.flush()
    assert.equal(f.document.activeElement, f.lowClose)
  }
  const f = modalFixture()
  f.document.dialogs = [f.high, f.low, f.old]
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.highClose)
})

test('stale scheduled focus never targets a closed dialog; reverse Tab stays in the top layer', () => {
  const f = modalFixture()
  f.window.sync()
  f.high.hidden = true
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.lowClose)
  let prevented = 0
  f.low.listeners.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++ } })
  assert.equal(prevented, 1)
  assert.equal(f.document.activeElement, f.lowClose)
})

test('recovery UI has a labeled manual button and renders failure/loading/success states', async () => {
  const f = recoveryFixture()
  let button
  const count = { setAttribute() {}, parentElement: { appendChild(node) { button = node } } }
  const document = { querySelectorAll: () => [], querySelector: selector => selector.includes('conversation-count') ? count : button,
    createElement: () => ({ setAttribute() {}, addEventListener(k, fn) { this[k] = fn } }) }
  const ctx = { document, root: f.root, window: f.window }
  vm.runInNewContext(block('  const decorateSessions =', '  let mobileConversationFilter') + '\n window.renderRecovery = decorateSessions', ctx)
  await f.window.testRecovery.refreshIndex(f.descriptor)
  f.window.renderRecovery()
  assert.match(count.textContent, /恢复失败.*缓存/)
  assert.equal(button.textContent, '重试最新列表')
  f.succeed()
  const a = button.click(), b = button.click()
  f.window.renderRecovery()
  assert.equal(button.disabled, true)
  assert.equal(button.textContent, '正在重试…')
  while (f.calls() < 5) await new Promise(resolve => setImmediate(resolve))
  f.release(); await Promise.all([a, b])
  f.window.renderRecovery()
  assert.equal(button.hidden, true)
  assert.equal(f.calls(), 5)
})

test('native snapshot placeholders cannot leave successful HTTP retry spinning or invent requests', async () => {
  const f = recoveryFixture()
  assert.equal(f.window.__harnessMobileApplyNativeSnapshot({ schemaVersion: 1, snapshotEpoch: 1, revision: 1, cursor: 'cursor', workspaces: [], sessions: [] }), true)
  await f.window.testRecovery.refreshIndex(f.descriptor)
  f.succeed()
  const retry = f.window.__harnessMobileRetryIndexes()
  while (f.calls() < 5) await new Promise(resolve => setImmediate(resolve))
  f.release(); await retry
  assert.equal(f.calls(), 5)
  assert.equal(f.root.dataset.harnessMobileIndexRecoveryState, undefined)
  assert.equal(f.root.dataset.harnessMobileIndexRecovery, undefined)
})

test('Tab from outside recaptures focus; a modal without close consumes Back', () => {
  const f = modalFixture()
  let prevented = 0
  f.document.listeners.keydown({ key: 'Tab', preventDefault() { prevented++ }, stopImmediatePropagation() {} })
  assert.equal(prevented, 1)
  assert.equal(f.document.activeElement, f.highClose)
  f.high.querySelectorAll = () => []
  assert.equal(f.window.__harnessMobileHandleBack(), true)
  assert.equal(f.lowClose.closed, 0)
})

test('transformed parent stacking context bounds child z-index', () => {
  const f = modalFixture()
  f.high.parentElement = { parentElement: null, hidden: false, inert: false, style: { transform: 'translateX(0)', zIndex: 'auto' }, hasAttribute: () => false, getAttribute: () => null, matches: () => false }
  f.window.sync(); f.flush()
  assert.equal(f.document.activeElement, f.lowClose)
})

test('filter parent bounds fixed child z-index for focus and Back; none does not create a context', () => {
  for (const filter of ['blur(0px)', 'none']) {
    const f = modalFixture()
    f.high.style.position = 'fixed'
    f.low.style.position = 'fixed'
    f.high.parentElement = { parentElement: null, hidden: false, inert: false, style: { filter, zIndex: 'auto' }, hasAttribute: () => false, getAttribute: () => null, matches: () => false }
    f.window.sync(); f.flush()
    const expected = filter === 'none' ? f.highClose : f.lowClose
    const untouched = filter === 'none' ? f.lowClose : f.highClose
    assert.equal(f.document.activeElement, expected, `focus with filter=${filter}`)
    assert.equal(f.window.__harnessMobileHandleBack(), true)
    assert.equal(expected.closed, 1)
    assert.equal(untouched.closed, 0)
  }
})

test('Android/iOS runtime and styles are byte-identical', () => {
  for (const file of ['mobile-runtime.js', 'mobile-compat.css']) assert.deepEqual(fs.readFileSync(path.join(rootDir, 'mobile/android/app/src/main/assets', file)), fs.readFileSync(path.join(rootDir, 'mobile/ios/HarnessMobile/Resources', file)))
})
