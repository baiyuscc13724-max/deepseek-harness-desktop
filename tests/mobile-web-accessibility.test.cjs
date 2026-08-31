'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const androidRuntime = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-runtime.js'), 'utf8')
const iosRuntime = fs.readFileSync(path.join(root, 'mobile/ios/HarnessMobile/Resources/mobile-runtime.js'), 'utf8')
const androidCss = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/assets/mobile-compat.css'), 'utf8')
const iosCss = fs.readFileSync(path.join(root, 'mobile/ios/HarnessMobile/Resources/mobile-compat.css'), 'utf8')
const adapter = fs.readFileSync(path.join(root, 'mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileUiAdapter.java'), 'utf8')

test('Android WebView bootstrap cannot mark an incomplete document ready', () => {
  assert.match(adapter, /setImportantForAccessibility\(View\.IMPORTANT_FOR_ACCESSIBILITY_YES\)/u)
  assert.match(adapter, /setFocusable\(true\)/u)
  assert.match(adapter, /setFocusableInTouchMode\(true\)/u)
  assert.match(adapter, /if\(!root\|\|!body\)\{delete window\[runtimeMarker\];return false;\}/u)
  assert.match(adapter, /window\.__harnessMobileUiObserver&&document\.getElementById\('harness-mobile-app-shell'\)/u)
  assert.match(adapter, /else delete window\[runtimeMarker\]/u)
  assert.match(adapter, /INJECTION_DELAYS_MS = \{ 0L, 250L, 900L \}/u)
})

test('mobile DOM exposes real ARIA landmarks for navigation, messages and composer', () => {
  assert.match(androidRuntime, /const decorateAccessibilitySemantics = \(\) =>/u)
  assert.match(androidRuntime, /setAttribute\('role', 'banner'\)/u)
  assert.match(androidRuntime, /setAttribute\('role', 'heading'\)/u)
  assert.match(androidRuntime, /setAttribute\('aria-label', '主要导航'\)/u)
  assert.match(androidRuntime, /setAttribute\('aria-label', '项目与对话列表'\)/u)
  assert.match(androidRuntime, /setAttribute\('role', 'log'\)/u)
  assert.match(androidRuntime, /setAttribute\('aria-label', '消息'\)/u)
  assert.match(androidRuntime, /setAttribute\('role', 'region'\)/u)
  assert.match(androidRuntime, /setAttribute\('aria-label', '消息编辑器'\)/u)
  assert.match(androidRuntime, /setAttribute\('aria-label', '发送消息'\)/u)
  assert.match(androidRuntime, /setAttribute\('aria-label', '停止生成'\)/u)
  assert.doesNotMatch(androidRuntime, /OCR|optical character recognition|伪节点/u)
})

test('drawers and modal dialogs constrain focus and return it to their trigger', () => {
  assert.match(androidRuntime, /conversation\.inert = expanded/u)
  assert.match(androidRuntime, /for \(let node = sidebar; node && node !== document\.body; node = node\.parentElement\)/u)
  assert.match(androidRuntime, /node\.setAttribute\('aria-hidden', 'false'\)/u)
  assert.match(androidRuntime, /node\.inert = true[^]*node\.setAttribute\('aria-hidden', 'true'\)/u)
  assert.match(androidRuntime, /for \(let node = row; node && node !== sidebar; node = node\.parentElement\)/u)
  assert.match(androidRuntime, /row\.setAttribute\('aria-label', label\)/u)
  assert.match(androidRuntime, /appbar\.inert = expanded/u)
  assert.match(androidRuntime, /navigation\.inert = false[^]*navigation\.removeAttribute\('inert'\)/u)
  assert.match(androidCss, /:root\[data-harness-mobile-drawer="open"\] \[class\*="_sidebarCol"\][^]*width: 100vw !important;[^]*height: auto !important;/u)
  assert.match(androidRuntime, /mobileDrawerTrigger\?\.isConnected/u)
  assert.match(androidRuntime, /const syncDialogFocus = dialogs =>/u)
  assert.match(androidRuntime, /event\.key !== 'Tab'/u)
  assert.match(androidRuntime, /activeMobileDialogTrigger/u)
  assert.match(androidRuntime, /trigger\.focus\?\.\(\{ preventScroll: true \}\)/u)
})

test('core mobile controls use 48px hit boxes without enlarging the compact brand glyph', () => {
  const contract = androidCss.slice(androidCss.indexOf('/* Accessibility hit-target contract.'))
  assert.ok(contract.length > 0, 'the final accessibility hit-target layer must exist')
  for (const selector of [
    '[data-harness-mobile-appbar="true"] > button',
    '[data-harness-mobile-navigation] > button',
    '[data-harness-mobile-session-row="true"]',
    '[data-harness-mobile-settings-toolbar="true"] > button',
    '[data-harness-mobile-composer-action="true"]',
    '#harness-mobile-input-button',
    '#harness-mobile-model-button'
  ]) assert.ok(contract.includes(selector), `missing 48px contract for ${selector}`)
  assert.match(contract, /min-width: 48px !important;[^]*min-height: 48px !important;/u)
  assert.match(contract, /html\[data-harness-mobile="true"\]:root \[data-harness-mobile-composer-action="true"\][^]*width: 48px !important;[^]*min-height: 48px !important;/u)
  assert.match(contract, /button\[data-harness-mobile-icon="brand"\][^]*width: 48px !important;[^]*height: 48px !important;/u)
  assert.match(contract, /button\[data-harness-mobile-icon="brand"\] svg[^]*width: 34px !important;[^]*height: 34px !important;/u)
  assert.ok(androidCss.lastIndexOf('/* Accessibility hit-target contract.') > androidCss.lastIndexOf('min-height: 34px'), '48px contract must win the cascade over legacy compact rules')
})

test('pressed, disabled and focus-visible states do not change hit-box geometry', () => {
  const selectors = [
    'button:not(:disabled):active',
    'button:disabled',
    '[data-harness-mobile-document-reference="true"]:focus-visible'
  ]
  for (const selector of selectors) {
    const start = androidCss.lastIndexOf(selector)
    assert.ok(start >= 0, `missing ${selector} state`)
    const open = androidCss.indexOf('{', start)
    const close = androidCss.indexOf('}', open)
    const body = androidCss.slice(open + 1, close)
    assert.doesNotMatch(body, /(?:^|;)\s*(?:min-|max-)?(?:width|height)|(?:^|;)\s*(?:margin|padding)(?:-|:)/u)
  }
})

test('long composer text remains contained while Android and iOS assets stay byte-identical', () => {
  assert.match(androidCss, /max-height: min\(168px, 30dvh\) !important;/u)
  assert.match(androidCss, /overflow-wrap: anywhere !important;/u)
  assert.match(androidCss, /white-space: pre-wrap !important;/u)
  assert.match(androidCss, /overflow-y: auto !important;/u)
  assert.equal(androidRuntime, iosRuntime)
  assert.equal(androidCss, iosCss)
})
