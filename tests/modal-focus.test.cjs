const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { readFileSync } = require('node:fs')
const { readFile } = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')
const modalSource = readFileSync(path.join(root, 'renderer', 'modal-focus.js'), 'utf8')
const {
  shouldTrapTab,
  boundaryNextIndex,
  isRenderedVisible,
  collectFocusable,
  isInsideAnyActiveModal,
  createInstaller,
  FOCUSABLE_SELECTOR,
  MODAL_SELECTOR
} = require('../renderer/modal-focus.js')

function createHarness() {
  const listeners = new Map()
  const observers = []
  const modals = []
  const document = { activeElement: null }

  function dispatch(type, event) {
    for (const listener of [...(listeners.get(type) || [])]) listener(event)
  }

  function makeElement({ modal = false, hidden = false, disabled = false } = {}) {
    const attrs = new Map()
    if (modal) attrs.set('aria-modal', 'true')
    if (hidden) attrs.set('aria-hidden', 'true')
    const element = {
      nodeType: 1,
      isConnected: true,
      disabled,
      className: hidden ? 'hidden' : '',
      parentElement: null,
      children: [],
      focusableChildren: [],
      focusCalls: 0,
      classList: { contains: name => element.className.split(/\s+/).includes(name) },
      getAttribute: name => attrs.get(name) ?? null,
      hasAttribute: name => attrs.has(name),
      setAttribute(name, value) { attrs.set(name, String(value)) },
      removeAttribute(name) { attrs.delete(name) },
      getClientRects: () => element.classList.contains('hidden') || attrs.get('aria-hidden') === 'true' ? [] : [{ width: 1, height: 1 }],
      querySelectorAll: selector => selector === FOCUSABLE_SELECTOR ? element.focusableChildren : [],
      append(...nodes) {
        for (const node of nodes) {
          node.parentElement = element
          element.children.push(node)
        }
      },
      contains(node) {
        return node === element || element.children.some(child => child.contains?.(node))
      },
      closest(selector) {
        if (selector !== MODAL_SELECTOR) return null
        let node = element
        while (node) {
          if (node.getAttribute?.('aria-modal') === 'true') return node
          node = node.parentElement
        }
        return null
      },
      focus() {
        element.focusCalls += 1
        document.activeElement = element
        dispatch('focusin', { target: element })
      }
    }
    return element
  }

  const documentElement = makeElement()
  documentElement.querySelectorAll = selector => selector === MODAL_SELECTOR ? modals : []
  document.documentElement = documentElement

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.observeCalls = 0
      this.disconnected = false
      observers.push(this)
    }
    observe() { this.observeCalls += 1 }
    disconnect() { this.disconnected = true }
  }

  const window = {
    MutationObserver: FakeMutationObserver,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) }
  }

  function createModal(focusableCount = 1) {
    const modal = makeElement({ modal: true, hidden: true })
    const focusables = Array.from({ length: focusableCount }, () => makeElement())
    modal.focusableChildren = focusables
    modal.append(...focusables)
    modal.parentElement = documentElement
    modals.push(modal)
    return { modal, focusables }
  }

  function show(modal) {
    modal.className = ''
    modal.removeAttribute('aria-hidden')
  }

  function hide(modal) {
    modal.className = 'hidden'
    modal.setAttribute('aria-hidden', 'true')
  }

  function keydown({ shiftKey = false } = {}) {
    const event = {
      key: 'Tab',
      shiftKey,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true }
    }
    dispatch('keydown', event)
    return event
  }

  return {
    window,
    document,
    documentElement,
    observers,
    listeners,
    makeElement,
    createModal,
    show,
    hide,
    keydown,
    dispatch
  }
}

test('Tab traps only at modal boundaries and keeps internal browser navigation native', () => {
  assert.equal(shouldTrapTab(-1, 4, false), true)
  assert.equal(shouldTrapTab(-1, 4, true), true)
  assert.equal(shouldTrapTab(0, 4, true), true)
  assert.equal(shouldTrapTab(3, 4, false), true)
  assert.equal(shouldTrapTab(1, 4, false), false)
  assert.equal(shouldTrapTab(2, 4, true), false)
  assert.equal(shouldTrapTab(-1, 0, false), true)
  assert.equal(boundaryNextIndex(-1, 4, false), 0)
  assert.equal(boundaryNextIndex(-1, 4, true), 3)
  assert.equal(boundaryNextIndex(0, 4, true), 3)
  assert.equal(boundaryNextIndex(3, 4, false), 0)
  assert.equal(boundaryNextIndex(0, 0, false), -1)
})

test('visibility, focusable collection and active-modal checks stay bounded', () => {
  assert.equal(isRenderedVisible(null), false)
  assert.equal(isRenderedVisible({ getClientRects: () => [{ width: 1 }] }), true)
  assert.equal(isRenderedVisible({ getClientRects: () => [] }), false)
  const visible = { disabled: false, getClientRects: () => [{ width: 1 }] }
  const rootNode = { querySelectorAll: () => [visible, { disabled: true, getClientRects: () => [{ width: 1 }] }, { disabled: false, getClientRects: () => [] }] }
  assert.deepEqual(collectFocusable(rootNode), [visible])
  const modal = { active: true }
  assert.equal(isInsideAnyActiveModal({ closest: () => modal }, value => value.active), true)
  assert.equal(isInsideAnyActiveModal({ closest: () => null }, () => true), false)
})

test('public browser install caches exactly one installer per document', () => {
  const harness = createHarness()
  const context = {
    window: { ...harness.window, console: { warn() {} } },
    document: harness.document,
    console: { warn() {} },
    module: undefined
  }
  context.globalThis = context
  vm.runInNewContext(modalSource, context)
  const first = context.window.HarnessModalFocus.install()
  const second = context.window.HarnessModalFocus.install()
  assert.equal(first, second)
  assert.equal(harness.observers.length, 1, 'auto-install plus repeated public install must create one observer')
  assert.equal(harness.observers[0].observeCalls, 1)
  assert.equal(harness.listeners.get('focusin')?.size, 1)
})

test('installer wraps only first/last boundaries and redirects outside focus', () => {
  const harness = createHarness()
  const trigger = harness.makeElement()
  trigger.focus()
  const { modal, focusables } = harness.createModal(3)
  const installer = createInstaller({ window: harness.window, document: harness.document }).install()
  harness.show(modal)
  installer.sync()
  assert.equal(harness.document.activeElement, focusables[0])

  focusables[1].focus()
  assert.equal(harness.keydown().defaultPrevented, false, 'internal Tab remains native')
  focusables[2].focus()
  assert.equal(harness.keydown().defaultPrevented, true)
  assert.equal(harness.document.activeElement, focusables[0])
  assert.equal(harness.keydown({ shiftKey: true }).defaultPrevented, true)
  assert.equal(harness.document.activeElement, focusables[2])

  trigger.focus()
  assert.equal(harness.keydown({ shiftKey: true }).defaultPrevented, true)
  assert.equal(harness.document.activeElement, focusables[2], 'outside Shift+Tab enters at the last control')
})

test('a modal without focusable children traps Tab on its container and restores the trigger', () => {
  const harness = createHarness()
  const trigger = harness.makeElement()
  trigger.focus()
  const { modal } = harness.createModal(0)
  const installer = createInstaller({ window: harness.window, document: harness.document }).install()
  harness.show(modal)
  installer.sync()
  assert.equal(harness.document.activeElement, modal)
  assert.equal(modal.getAttribute('tabindex'), '-1')
  assert.equal(harness.keydown().defaultPrevented, true)
  harness.hide(modal)
  installer.sync()
  assert.equal(harness.document.activeElement, trigger)
  assert.equal(modal.hasAttribute('tabindex'), false, 'temporary tabindex is removed on close')
})

test('synchronous focus inside an opening modal still restores the outside trigger', () => {
  const harness = createHarness()
  const trigger = harness.makeElement()
  trigger.focus()
  const { modal, focusables } = harness.createModal(1)
  const installer = createInstaller({ window: harness.window, document: harness.document }).install()
  harness.show(modal)
  focusables[0].focus() // opening controller focuses before MutationObserver callback
  installer.sync()
  harness.hide(modal)
  installer.sync()
  assert.equal(harness.document.activeElement, trigger)
})

test('nested modal transitions restore each opening control in order', () => {
  const harness = createHarness()
  const pageTrigger = harness.makeElement()
  pageTrigger.focus()
  const outer = harness.createModal(2)
  const inner = harness.createModal(1)
  inner.modal.parentElement = harness.documentElement
  const installer = createInstaller({ window: harness.window, document: harness.document }).install()

  harness.show(outer.modal)
  installer.sync()
  const innerTrigger = outer.focusables[1]
  innerTrigger.focus()
  harness.show(inner.modal)
  inner.focusables[0].focus()
  installer.sync()

  harness.hide(inner.modal)
  installer.sync()
  assert.equal(harness.document.activeElement, innerTrigger)
  harness.hide(outer.modal)
  installer.sync()
  assert.equal(harness.document.activeElement, pageTrigger)
})

test('modal focus self-installs before modal-opening shell scripts without inline JavaScript', async () => {
  const html = await source('renderer/index.html')
  const modalIndex = html.indexOf('<script src="./modal-focus.js"></script>')
  assert.ok(modalIndex > 0)
  for (const script of ['theme-catalog.js', 'theme-integration.js', 'model-routing-integration.js', 'workspace-links-integration.js', 'storage-manager.js', 'memory-manager.js', 'browser-sidebar.js', 'app.js']) {
    assert.ok(modalIndex < html.indexOf(`<script src="./${script}"></script>`), `modal focus must load before ${script}`)
  }
  assert.doesNotMatch(html, /<script>(?:.|\s)*?<\/script>/u)
  assert.match(modalSource, /const installers = new WeakMap\(\)/u)
  assert.match(modalSource, /try \{ window\.HarnessModalFocus\.install\(\) \}/u)
})

test('authorization refocus guard blocks one mouse grant but leaves keyboard and rejection paths alone', async () => {
  const renderer = await source('renderer/browser-sidebar.js')
  assert.match(renderer, /window\.addEventListener\('blur'[\s\S]*?armAuthorizationRefocusGuard\(\)/u)
  assert.match(renderer, /authorizationRefocusDisarmTimer[\s\S]*?clearTimeout/u)
  assert.match(renderer, /#computerUseAuthorizationSession,#computerUseAuthorizationForever/u)
  assert.match(renderer, /event\.detail > 0/u)
  assert.match(renderer, /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/u)
  assert.match(renderer, /if \(!refocusTargetIsGrantButton\(event\.target\)\) return/u)
  assert.match(renderer, /键盘（Enter\/Space）触发的 click 放行/u)
})

test('browser status uses alert for errors, status otherwise, and has no bypass writes', async () => {
  const [renderer, html] = await Promise.all([source('renderer/browser-sidebar.js'), source('renderer/index.html')])
  assert.match(html, /id="browserStatusText" role="status"/u)
  assert.match(renderer, /statusText\.setAttribute\('role', error \? 'alert' : 'status'\)/u)
  assert.match(renderer, /setBrowserStatus\(error\.message \|\| String\(error\), \{ error: true \}\)/u)
  assert.equal((renderer.match(/statusText\.textContent\s*=/gu) || []).length, 1, 'only setBrowserStatus may write the browser status text')
})

test('authorization card keeps a scrollable body inside a bounded card and fixed action footer', async () => {
  const [html, styles] = await Promise.all([source('renderer/index.html'), source('renderer/styles.css')])
  assert.match(html, /class="computer-use-authorization-body"/u)
  assert.match(html, /class="computer-use-authorization-actions"/u)
  assert.match(html, /id="computerUseAuthorizationRefocus" role="status" hidden/u)
  assert.match(styles, /\.computer-use-authorization-card \{[^\n]*max-height:100%;/u)
  assert.match(styles, /\.computer-use-authorization-body \{ flex:1 1 auto; min-height:0; overflow:auto;/u)
  assert.match(styles, /\.computer-use-authorization-actions \{ display:flex; flex-wrap:wrap; gap:8px; flex:none;/u)
  assert.doesNotMatch(styles, /\.computer-use-authorization-card \{[^\n]*max-height:calc\(100vh - 72px\)/u)
})
