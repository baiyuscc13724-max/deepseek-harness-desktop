const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

for (const [name, relativePath, label] of [
  ['Agent Teams', ['plugins', 'dsh-agent-teams', 'lib', 'client.js'], 'agent-teams: locale subscription'],
  ['session experience', ['plugins', 'dsh-session-experience', 'lib', 'client.js'], 'session-experience: locale subscription']
]) {
  test(`${name} locale subscriptions are disposed with the client plugin`, async () => {
    const source = await readFile(path.join(root, ...relativePath), 'utf8')
    assert.match(source, new RegExp(`ctx\\.effect\\(function \\(\\) \\{ return ctx\\.locale\\.subscribe[\\s\\S]*?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    assert.doesNotMatch(source, /try \{ ctx\.locale\.subscribe/u)
  })
}

async function sessionExperienceClient() {
  const source = await readFile(path.join(root, 'plugins', 'dsh-session-experience', 'lib', 'client.js'), 'utf8')
  let registration
  const browser = { __ModuleLoader__: { load(value) { registration = value } }, innerHeight: 900 }
  new Function('window', source)(browser)
  const client = registration.factory(name => {
    if (name === 'react') return { createElement() {}, useState() {}, useEffect() {}, useRef() {} }
    if (name === '@deepseek-ai/dsh-client-runtime/client') return { isAppendSurfaceEvent: event => event?.surfaceOp === 'append' }
    throw new Error(`unexpected client dependency: ${name}`)
  })
  return { browser, client }
}

function inlineTimelineHarness(browser) {
  const counts = { bodyWideScans: 0, observers: 0, resize: 0, scroll: 0, subscribers: 0, timers: 0 }
  const bodyChildren = []
  let viewport
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase()
      this.children = []
      this.dataset = {}
      this.style = {}
      this.parentElement = null
      this.hidden = false
      this.listeners = new Map()
    }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)) }
    appendChild(node) { node.parentElement = this; this.children.push(node); return node }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set()
      listeners.add(listener)
      this.listeners.set(type, listeners)
      if (this === viewport && type === 'scroll') counts.scroll = listeners.size
    }
    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener)
      if (this === viewport && type === 'scroll') counts.scroll = this.listeners.get(type)?.size || 0
    }
    setAttribute() {}
    removeAttribute() {}
    contains(node) { return node === this || this.children.includes(node) }
    getBoundingClientRect() { return { top: 0, bottom: 700, left: 0, height: 700 } }
    querySelector(selector) { return selector === '[data-chat-flow]' ? flow : null }
    remove() {
      const index = bodyChildren.indexOf(this)
      if (index >= 0) bodyChildren.splice(index, 1)
      this.parentElement = null
    }
  }
  const flow = new Element('main')
  viewport = new Element('section')
  flow.parentElement = viewport
  const anchor = { closest(selector) { return selector === '[data-conversation-scroll]' ? viewport : null } }
  const body = new Element('body')
  body.appendChild = node => { node.parentElement = body; bodyChildren.push(node); return node }
  body.contains = node => node === flow || node === viewport || bodyChildren.includes(node)
  const document = {
    activeElement: null,
    body,
    createElement: tag => new Element(tag),
    querySelectorAll() { counts.bodyWideScans += 1; return bodyChildren.slice() }
  }
  class MutationObserver {
    constructor() { this.connected = false }
    observe() { if (!this.connected) { this.connected = true; counts.observers += 1 } }
    disconnect() { if (this.connected) { this.connected = false; counts.observers -= 1 } }
  }
  const resizeListeners = new Set()
  browser.addEventListener = (type, listener) => {
    if (type === 'resize') { resizeListeners.add(listener); counts.resize = resizeListeners.size }
  }
  browser.removeEventListener = (type, listener) => {
    if (type === 'resize') { resizeListeners.delete(listener); counts.resize = resizeListeners.size }
  }
  const subscribers = new Set()
  const session = {
    events: [],
    subscribe(listener) {
      subscribers.add(listener)
      counts.subscribers = subscribers.size
      return () => { subscribers.delete(listener); counts.subscribers = subscribers.size }
    }
  }
  let timerSequence = 0
  const timers = new Set()
  function setTimeout(callback) { const id = ++timerSequence; timers.add(id); counts.timers = timers.size; return id }
  function clearTimeout(id) { timers.delete(id); counts.timers = timers.size }
  return { anchor, bodyChildren, clearTimeout, counts, document, MutationObserver, setTimeout, sessions: { binding() { return { session } } } }
}

function withGlobals(values, operation) {
  const previous = new Map()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.prototype.hasOwnProperty.call(globalThis, name) ? globalThis[name] : undefined)
    globalThis[name] = value
  }
  try { return operation() } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
}

test('inline timeline replaces prior resources and releases all resources after 100 remounts', async () => {
  const { browser, client } = await sessionExperienceClient()
  const harness = inlineTimelineHarness(browser)
  withGlobals({
    document: harness.document,
    MutationObserver: harness.MutationObserver,
    requestAnimationFrame: callback => { callback(); return 1 },
    cancelAnimationFrame() {},
    setTimeout: harness.setTimeout,
    clearTimeout: harness.clearTimeout
  }, () => {
    let cleanup
    for (let index = 0; index < 100; index += 1) {
      cleanup = client.__timelineTest.installInlineTimelineRail({ sessionId: `session-${index}`, sessions: harness.sessions, anchor: harness.anchor })
      assert.equal(typeof cleanup, 'function')
      assert.deepEqual(
        { observers: harness.counts.observers, resize: harness.counts.resize, scroll: harness.counts.scroll, subscribers: harness.counts.subscribers },
        { observers: 1, resize: 1, scroll: 1, subscribers: 1 },
        `mount ${index + 1} must replace the prior instance`
      )
    }
    const nav = harness.bodyChildren[0]
    const focusout = [...nav.listeners.get('focusout')][0]
    focusout()
    assert.equal(harness.counts.timers, 1, 'focusout owns one deferred dismissal')
    cleanup()
    assert.equal(harness.counts.timers, 0, 'cleanup cancels the deferred dismissal')
  })
  assert.deepEqual(
    { observers: harness.counts.observers, resize: harness.counts.resize, scroll: harness.counts.scroll, subscribers: harness.counts.subscribers },
    { observers: 0, resize: 0, scroll: 0, subscribers: 0 }
  )
  assert.equal(harness.counts.bodyWideScans, 0, 'mounting must not scan the document for stale rails')
})
