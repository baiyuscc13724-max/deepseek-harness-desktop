'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const runtime = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
const iosRuntime = read('mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js')
const compat = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css')
const iosCompat = read('mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-compat.css')
const official = read('node_modules', '@deepseek-ai', 'dsh-client-ui-model-selection', 'lib', 'client.js')

const modelSource = (() => {
  const start = runtime.indexOf('  let mobileComposerModelSheet = null')
  const end = runtime.indexOf('  const decorateConversation = () => {', start)
  assert.ok(start >= 0 && end > start, 'mobile composer model adapter must have a bounded source section')
  return runtime.slice(start, end)
})()

test('official per-session model directory remains the only selection owner', () => {
  assert.match(official, /function ModelSelect\(\{ locked, available, directory, load, select, t \}\)/u)
  assert.match(official, /select\(selection\)\.then\(settleSelection\)/u)
  assert.match(official, /reasoningEffort: effort/u)
  assert.match(official, /"aria-label": triggerAria/u)
  assert.match(official, /"aria-haspopup": "menu"/u)
})

test('mobile composer creates its own compact trigger and bottom sheet', () => {
  assert.match(modelSource, /officialComposerModelTrigger/u)
  assert.match(modelSource, /proxy\.id = 'harness-mobile-model-button'/u)
  assert.match(modelSource, /sheet\.dataset\.harnessMobileModelSheet = 'true'/u)
  assert.match(modelSource, /模型与推理等级/u)
  assert.match(modelSource, /data-harness-mobile-model-tab="model"/u)
  assert.match(modelSource, /data-harness-mobile-model-tab="effort"/u)
  assert.match(modelSource, /source\.parentElement\.insertBefore\(proxy, source\)/u)
  assert.match(modelSource, /proxy\.__harnessMobileModelSource = source/u, 'a reused mobile trigger must rebind after an official React remount')
  assert.match(modelSource, /aria-haspopup', 'dialog'/u)
  assert.match(modelSource, /aria-expanded'/u)
  assert.match(modelSource, /sourceOption\.click\(\)/u, 'mobile choices must delegate to the official per-session action')
  assert.match(modelSource, /waitForSelection/u, 'the sheet must wait for authoritative selection state before closing')
  assert.match(modelSource, /attempt < 240/u, 'slow mobile links keep a bounded twelve-second directory refresh window')
  assert.match(modelSource, /touchstart/u, 'the sheet supports an upward/downward touch gesture')
  assert.match(modelSource, /delta >= 72/u, 'downward dismissal uses an explicit drag threshold')
  assert.match(modelSource, /delta <= -48/u, 'upward expansion uses an explicit drag threshold')
  assert.match(modelSource, /data-harness-mobile-model-handle/u, 'the sheet exposes a visual drag handle')
  assert.doesNotMatch(modelSource, /fetch\(|model-routing|appendChild\(menu\)|append\(sourceOption\)/u, 'the composer must not invent model state or mount the desktop menu')
})

test('mobile model choices preserve provider grouping and source order', () => {
  assert.match(modelSource, /option\.closest\?\.\('\[role="group"\]'\)/u)
  assert.match(modelSource, /data-harness-mobile-model-provider-group/u)
  assert.match(modelSource, /data-harness-mobile-model-provider-heading/u)
  assert.match(modelSource, /setAttribute\('role', 'group'\)/u)
  assert.match(modelSource, /其他模型/u, 'ungrouped models use a safe fallback provider heading')
  assert.match(modelSource, /for \(const group of groups\.values\(\)\)/u, 'provider groups render in first-seen order')
})

test('mobile model grouping executes provider sections and delegates source clicks', () => {
  const start = modelSource.indexOf('  const renderMobileComposerModelChoices =')
  const end = modelSource.indexOf('  const waitForMobileComposerModelPane =', start)
  const source = modelSource.slice(start, end)
  class FakeElement {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.textContent = ''; this.isConnected = true }
    appendChild(child) { this.children.push(child); return child }
    replaceChildren(...children) { this.children = children }
    setAttribute(key, value) { this.attrs[key] = String(value) }
    getAttribute(key) { return this.attrs[key] ?? null }
    closest(selector) { return selector === '[role="group"]' ? (this.group || null) : null }
  }
  const labels = new Map()
  const document = {
    createElement: tag => new FakeElement(tag),
    getElementById: id => labels.get(id) || null
  }
  const content = new FakeElement('div')
  const sheet = { hidden: false, querySelector: selector => selector === '[data-harness-mobile-model-content]' ? content : null }
  const makeGroup = (id, title) => {
    const group = new FakeElement('section')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-labelledby', id)
    labels.set(id, { textContent: title })
    return group
  }
  let delegatedClicks = 0
  const makeOption = (name, group) => {
    const option = new FakeElement('button')
    option.title = name
    option.textContent = name
    option.group = group
    option.click = () => { delegatedClicks += 1 }
    return option
  }
  const providerA = makeGroup('provider-a', 'Provider A')
  const providerB = makeGroup('provider-b', 'Provider B')
  const options = [makeOption('A1', providerA), makeOption('A2', providerA), makeOption('B1', providerB), makeOption('Other', null)]
  const mobileModelChoice = option => ({ click: () => option.click() })
  const render = new Function('document', 'mobileComposerModelSheet', 'mobileModelChoice', `${source}; return renderMobileComposerModelChoices`)(document, sheet, mobileModelChoice)
  assert.equal(render({ querySelectorAll: () => options }, 'model'), true)
  assert.equal(content.children[0].children.length, 3)
  assert.deepEqual(content.children[0].children.map(section => section.children[0].textContent), ['Provider A（2）', 'Provider B（1）', '其他模型（1）'])
  assert.deepEqual(content.children[0].children.map(section => section.children[1].children.length), [2, 1, 1])
  content.children[0].children[0].children[1].children[0].click()
  assert.equal(delegatedClicks, 1, 'rendered mobile choice delegates to the authoritative source button')
})

test('mobile model UI is touch-safe, bounded, and visually independent', () => {
  assert.match(compat, /data-harness-mobile-composer-toolbar="true"[^}]*display:\s*grid !important;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto !important;/su, 'the mobile toolbar must keep access, model, and send controls on one row')
  assert.match(compat, /data-harness-mobile-model-seat="true"[^}]*max-width:\s*88px !important;/su)
  assert.match(compat, /#harness-mobile-model-button[^{]*\{[^}]*min-height:\s*44px !important;/su)
  assert.match(compat, /\[data-harness-mobile-model-sheet\][^{]*\{[^}]*position:\s*fixed !important;[^}]*z-index:\s*1120 !important;/su)
  assert.match(compat, /\[data-harness-mobile-model-sheet\] > \[role="dialog"\][^{]*\{[^}]*height:\s*min\(76dvh, 680px\) !important;[^}]*max-height:\s*min\(76dvh, 680px\) !important;[^}]*border-radius:\s*22px !important;/su, 'the async authoritative directory must retain a usable scroll viewport after starting from one transitional row')
  assert.match(compat, /\[data-harness-mobile-model-sheet\] > \[role="dialog"\]\[data-harness-mobile-model-expanded="true"\][^{]*\{[^}]*height:\s*min\(92dvh, 900px\) !important;[^}]*max-height:\s*min\(92dvh, 900px\) !important;/su, 'an upward drag must visibly expand the model drawer')
  assert.match(compat, /\[data-harness-mobile-model-tab\][^{]*\{[^}]*min-height:\s*44px !important;/su)
  assert.match(compat, /\[data-harness-mobile-model-choice\][^{]*\{[^}]*min-height:\s*52px !important;/su)
  assert.match(compat, /data-harness-mobile-model-source-menu="true"[^}]*visibility:\s*hidden !important;/su, 'the desktop menu may provide actions but must never be displayed')
  assert.match(compat, /data-harness-mobile-model-provider-group[^}]*gap:\s*8px !important;/su)
  assert.match(compat, /data-harness-mobile-model-provider-heading[^}]*font-size:\s*12px !important;/su)
  assert.match(compat, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?data-harness-mobile-model-sheet[\s\S]*?transition:\s*none !important;/u, 'model drawer reduced-motion behavior is explicitly covered')
})

test('mobile model settings mounts the live desktop editor instead of a stale duplicate', () => {
  assert.match(runtime, /const officialPanel = content\.querySelector\('#harness-desktop-model-routing'\)/u)
  assert.match(runtime, /setTimeout\(attachOfficialPanel, 50\)/u)
  assert.match(runtime, /panel\.replaceChildren\(officialPanel\)/u)
  assert.match(runtime, /harnessMobileModelEditor/u)
  assert.doesNotMatch(runtime, /手机模型配置只读视图/u)
  assert.match(compat, /#harness-mobile-model-routing > #harness-desktop-model-routing/u)
  assert.match(compat, /#harness-mobile-model-routing > #harness-desktop-model-routing[\s\S]*?data-hd-route-save\][^{]*\{[\s\S]*?min-height:\s*44px/u)
  assert.match(compat, /data-harness-mobile-settings-open="true"\][\s\S]*?data-slot="sidebar"\][\s\S]*?visibility:\s*hidden !important/u)
  for (const chrome of ['conversation-list-title', 'conversation-search-proxy', 'conversation-search-box']) {
    assert.match(compat, new RegExp(`data-harness-mobile-domain="me"[^}]*data-harness-mobile-${chrome}`), `My must hide ${chrome}`)
  }
})

test('mobile waits for the authoritative model directory to finish refreshing', () => {
  const start = modelSource.indexOf('  const waitForMobileComposerModelPane =')
  const end = modelSource.indexOf('  const openMobileComposerModelPane =', start)
  assert.ok(start >= 0 && end > start)
  const waitSource = modelSource.slice(start, end)
  const callbacks = []
  const renderCounts = []
  const menu = {
    busy: true,
    optionCount: 1,
    getAttribute(name) { return name === 'aria-busy' && this.busy ? 'true' : 'false' },
    querySelectorAll() { return [] }
  }
  const run = new Function('menu', 'callbacks', 'renderCounts', `
    let mobileComposerModelRequest = 1
    let mobileComposerModelSheet = { hidden: false }
    let mobileComposerModelSource = {}
    const renderMobileComposerModelChoices = current => {
      renderCounts.push(current.optionCount)
      return current.optionCount > 0
    }
    const renderMobileModelMessage = () => { throw new Error('unexpected model error') }
    const officialComposerModelMenu = () => menu
    const setTimeout = callback => { callbacks.push(callback) }
    ${waitSource}
    return () => waitForMobileComposerModelPane(1, menu, 'model')
  `)(menu, callbacks, renderCounts) // eslint-disable-line no-new-func

  run()
  assert.deepEqual(renderCounts, [], 'the transitional current-model row must not be presented as the complete catalog')
  assert.equal(callbacks.length, 1)
  menu.optionCount = 3
  menu.busy = false
  callbacks.shift()()
  assert.deepEqual(renderCounts, [3], 'the completed authoritative directory must replace the transitional row')
})

test('Android and iOS share the same mobile model experience', () => {
  assert.equal(iosRuntime, runtime)
  assert.equal(iosCompat, compat)
})
