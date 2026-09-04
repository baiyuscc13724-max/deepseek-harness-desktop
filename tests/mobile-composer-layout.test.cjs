'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8')
const android = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css')
const ios = read('mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-compat.css')
const runtime = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
const official = read('node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')

test('mobile composer CSS stays byte-identical across Android and iOS', () => {
  assert.equal(android, ios)
})

test('history loading keeps the composer stack at the viewport bottom through the official body wrapper', () => {
  assert.match(official, /className: ConversationRoot_module_css_default\.body,[\s\S]*?className: ConversationRoot_module_css_default\.scrollBody,[\s\S]*?"data-conversation-scroll": ""[\s\S]*?children: \[sessionId === void 0 \? null : renderSlot\("conversation\.session", \{\}\), composerSeat\]/u)
  const scrollRule = android.match(/\[data-harness-mobile-conversation="true"\] \[data-conversation-scroll\] \{([^}]*)\}/u)?.[1] || ''
  assert.match(scrollRule, /display:\s*flex !important;/u)
  assert.match(scrollRule, /flex-direction:\s*column !important;/u)
  assert.match(scrollRule, /height:\s*100% !important;/u)
  const seatRule = android.match(/\[data-harness-mobile-conversation="true"\] \[data-conversation-scroll\] > \[data-composer-seat\] \{([^}]*)\}/u)?.[1] || ''
  assert.match(seatRule, /position:\s*sticky !important;/u)
  assert.match(seatRule, /bottom:\s*0 !important;/u)
  assert.match(seatRule, /margin-top:\s*auto !important;/u)
  assert.doesNotMatch(android, /\[data-harness-mobile-conversation="true"\] > \[data-conversation-scroll\]/u, 'the official body wrapper must not break mobile scroll and composer anchoring')
})

test('official composer editor remains the sole visible text layer in Android WebView', () => {
  const visibleLayer = android.match(/\[data-harness-mobile-composer-editor="true"\]\s*\{[^}]*-webkit-text-fill-color:\s*var\(--hm-color-text, #172133\) !important;[^}]*\}/u)?.[0] || ''
  assert.match(visibleLayer, /z-index:\s*2 !important;/u)
  assert.match(visibleLayer, /visibility:\s*visible !important;/u)
  assert.match(visibleLayer, /opacity:\s*1 !important;/u)
  assert.match(visibleLayer, /color:\s*var\(--hm-color-text, #172133\) !important;/u)
  assert.match(visibleLayer, /-webkit-text-fill-color:\s*var\(--hm-color-text, #172133\) !important;/u)
  assert.match(visibleLayer, /caret-color:\s*var\(--hm-color-primary, #4968e8\) !important;/u)
  assert.match(android, /\[data-harness-mobile-composer-decoration="true"\]\s*\{[^}]*z-index:\s*0 !important;[^}]*visibility:\s*hidden !important;[^}]*opacity:\s*0 !important;/u)
})

test('composer layer normalization overrides the official transparent input inline', () => {
  const start = runtime.indexOf('  const normalizeMobileComposerLayers = composer => {')
  const end = runtime.indexOf('  const decorateConversation = () => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  const makeStyle = () => ({
    values: new Map(),
    priorities: new Map(),
    setProperty (name, value, priority = '') {
      this.values.set(name, value)
      this.priorities.set(name, priority)
    }
  })
  const makeNode = () => ({
    dataset: {},
    style: makeStyle(),
    inert: false,
    attributes: new Map(),
    setAttribute (name, value) { this.attributes.set(name, value) },
    removeAttribute (name) { this.attributes.delete(name) }
  })
  const inputScroll = makeNode()
  const backdrop = makeNode()
  const mirror = makeNode()
  const editor = makeNode()
  editor.tagName = 'DIV'
  editor.inert = true
  editor.addEventListener = () => {}
  const composer = {
    querySelector (selector) {
      if (selector === '[data-input-scroll]') return inputScroll
      if (selector === '[data-composer-input][data-phase], textarea[data-phase]') return editor
      return null
    },
    querySelectorAll: selector => selector === '[data-input-backdrop], [data-input-mirror]' ? [backdrop, mirror] : []
  }
  let layoutCalls = 0
  const composerInput = scope => scope?.querySelector?.('[data-composer-input][data-phase], textarea[data-phase]') || null
  const legacyComposerTextarea = input => String(input?.tagName || '').toLowerCase() === 'textarea'
  const normalize = new Function('composerInput', 'legacyComposerTextarea', 'syncMobileComposerInputLayout', `${source}\nreturn normalizeMobileComposerLayers`) // eslint-disable-line no-new-func
    (composerInput, legacyComposerTextarea, () => { layoutCalls += 1 })
  normalize(composer)
  assert.equal(layoutCalls, 1)
  assert.equal(inputScroll.style.values.get('isolation'), 'isolate')
  for (const layer of [backdrop, mirror]) {
    assert.equal(layer.style.values.get('visibility'), 'hidden')
    assert.equal(layer.style.values.get('opacity'), '0')
    assert.equal(layer.style.values.get('z-index'), '0')
    assert.equal(layer.style.priorities.get('visibility'), 'important')
  }
  assert.equal(editor.dataset.harnessMobileComposerEditor, 'true')
  assert.equal(editor.style.values.get('z-index'), '2')
  assert.equal(editor.style.values.get('visibility'), 'visible')
  assert.equal(editor.style.values.get('color'), 'var(--hm-color-text, #172133)')
  assert.equal(editor.style.values.get('-webkit-text-fill-color'), 'var(--hm-color-text, #172133)')
  assert.equal(editor.style.priorities.get('-webkit-text-fill-color'), 'important')
  assert.equal(editor.style.values.get('text-shadow'), 'none')
})

test('long text uses one bounded scroll owner for official and legacy editors', () => {
  assert.match(android, /\[data-harness-mobile-composer-input="true"\][\s\S]*?max-height:\s*min\(168px, 30dvh\)/u)
  assert.match(android, /\[data-harness-mobile-composer-editor="true"\][\s\S]*?white-space:\s*pre-wrap !important;/u)
  assert.match(android, /textarea\[data-harness-mobile-composer-textarea="true"\][\s\S]*?overflow-y:\s*auto !important;/u)
  assert.match(android, /\[data-phase="hero"\] \[class\*="_composerHero"\] \{[^}]*overflow:\s*visible !important;/u)
  assert.match(android, /overflow-anchor:\s*none !important;/u)
})

test('IME lift reserves overlay space and keeps toolbar in its own grid row', () => {
  assert.match(android, /data-harness-mobile-composer-toolbar="true"[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto !important;/u)
  assert.match(android, /data-harness-mobile-composer-lifted="true"[\s\S]*?max-height:\s*min\(120px, 26dvh\)/u)
  assert.match(android, /html\[data-harness-mobile-composer-lifted="true"\] \[data-harness-mobile-composer-seat="true"\] \{[\s\S]*?position:\s*fixed !important;/u)
  assert.match(runtime, /const composerFrame = composer\.closest\?\.\('\[data-composer-seat\]'\) \|\| composer\.parentElement/u)
  assert.match(runtime, /composerFrame\.dataset\.harnessMobileComposerSeat = 'true'/u)
  assert.match(runtime, /root\.dataset\.harnessMobileIme === 'open' && nativeImeHeight >= 80/u)
  assert.match(android, /scroll-padding-bottom:\s*calc\(196px \+ var\(--harness-mobile-ime-overlay, 0px\)\) !important;/u)
})
