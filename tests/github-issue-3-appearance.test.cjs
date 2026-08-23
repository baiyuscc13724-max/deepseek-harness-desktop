'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const {
  DARK_TITLEBAR_SYMBOL_COLOR,
  LIGHT_TITLEBAR_SYMBOL_COLOR,
  resolveTitleBarSymbolColor
} = require('../electron/bridge/titlebar-appearance.cjs')
const { THEME_CATALOG } = require('../renderer/theme-catalog.js')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function declarationsFor(source, selector) {
  const match = source.match(new RegExp(`(?:^|\\})\\s*${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'u'))
  assert.ok(match, `Missing CSS rule for ${selector}`)
  return Object.fromEntries(match[1]
    .split(';')
    .map(declaration => declaration.trim())
    .filter(Boolean)
    .map(declaration => {
      const separator = declaration.indexOf(':')
      assert.notEqual(separator, -1, `Invalid declaration in ${selector}: ${declaration}`)
      return [declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim().toLowerCase()]
    }))
}

function assertScrollable(declarations, label) {
  assert.equal(declarations['min-height'], '0', `${label} must be allowed to shrink inside its flex parent`)
  assert.ok(
    declarations.overflow === 'auto' || declarations['overflow-y'] === 'auto',
    `${label} must own a scrollable overflow axis`
  )
}

function assertDescriptionIsNotClipped(declarations, label) {
  const forbidden = ['line-clamp', '-webkit-line-clamp', 'max-height', 'text-overflow']
  for (const property of forbidden) {
    assert.equal(Object.hasOwn(declarations, property), false, `${label} must not set ${property}`)
  }
  assert.notEqual(declarations.overflow, 'hidden', `${label} must not hide overflowing text`)
  assert.notEqual(declarations['overflow-y'], 'hidden', `${label} must not hide overflowing text vertically`)
  assert.notEqual(declarations['white-space'], 'nowrap', `${label} must allow description text to wrap`)
}

test('titlebar symbols honor explicit modes and follow Windows for system-like modes', () => {
  const matrix = [
    ['dark', false, DARK_TITLEBAR_SYMBOL_COLOR],
    ['dark', true, DARK_TITLEBAR_SYMBOL_COLOR],
    ['light', false, LIGHT_TITLEBAR_SYMBOL_COLOR],
    ['light', true, LIGHT_TITLEBAR_SYMBOL_COLOR],
    ['system', false, LIGHT_TITLEBAR_SYMBOL_COLOR],
    ['system', true, DARK_TITLEBAR_SYMBOL_COLOR],
    ['adaptive', false, LIGHT_TITLEBAR_SYMBOL_COLOR],
    ['adaptive', true, DARK_TITLEBAR_SYMBOL_COLOR],
    ['future-mode', false, LIGHT_TITLEBAR_SYMBOL_COLOR],
    ['future-mode', true, DARK_TITLEBAR_SYMBOL_COLOR],
    [undefined, false, LIGHT_TITLEBAR_SYMBOL_COLOR],
    [undefined, true, DARK_TITLEBAR_SYMBOL_COLOR],
    [null, false, LIGHT_TITLEBAR_SYMBOL_COLOR],
    [null, true, DARK_TITLEBAR_SYMBOL_COLOR],
    [' DARK ', false, DARK_TITLEBAR_SYMBOL_COLOR],
    [' LIGHT ', true, LIGHT_TITLEBAR_SYMBOL_COLOR]
  ]

  for (const [mode, systemDark, expected] of matrix) {
    assert.equal(resolveTitleBarSymbolColor(mode, systemDark), expected, `${String(mode)} / systemDark=${systemDark}`)
  }
})

test('the shipped official system theme follows Windows dark mode', () => {
  const official = THEME_CATALOG.find(theme => theme.id === 'official')
  assert.equal(official?.mode, 'system')
  assert.equal(resolveTitleBarSymbolColor(official.mode, true), DARK_TITLEBAR_SYMBOL_COLOR)
  assert.equal(resolveTitleBarSymbolColor(official.mode, false), LIGHT_TITLEBAR_SYMBOL_COLOR)
})

test('Electron titlebar overlay delegates symbol color resolution to the pure policy', () => {
  const source = read('electron/main.cjs')
  const start = source.indexOf('function syncTitleBarOverlay(')
  const end = source.indexOf('\nasync function readAppearancePayload()', start)
  assert.ok(start >= 0 && end > start, 'syncTitleBarOverlay implementation must remain discoverable')
  const implementation = source.slice(start, end)

  assert.match(source, /require\('\.\/bridge\/titlebar-appearance\.cjs'\)/u)
  assert.match(implementation, /resolveTitleBarSymbolColor\(requestedMode, nativeTheme\.shouldUseDarkColors\)/u)
  assert.match(implementation, /setTitleBarOverlay\(\{ color: '#00000000', symbolColor, height: 36 \}\)/u)
  assert.doesNotMatch(implementation, /requestedMode === 'adaptive'/u)
})

test('native skin picker gives the bounded dialog a scroll-owning pane', () => {
  const html = read('renderer/index.html')
  const css = read('renderer/styles.css')
  const appSource = read('renderer/app.js')
  assert.match(html, /id="skinThemePane" class="skin-picker-pane"/u)
  assert.match(appSource, /class="skin-picker-description"[^>]*>\$\{escapeHtml\(theme\.description\)\}<\/div>/u)

  const dialog = declarationsFor(css, '.skin-picker-dialog')
  assert.equal(dialog.display, 'flex')
  assert.equal(dialog['flex-direction'], 'column')
  assert.match(dialog['max-height'], /^calc\(/u)
  assert.equal(dialog.overflow, 'hidden')
  assertScrollable(declarationsFor(css, '.skin-picker-pane'), 'native skin picker pane')
  assertDescriptionIsNotClipped(declarationsFor(css, '.skin-picker-description'), 'native skin description')
})

test('guest skin picker panel scrolls and lets descriptions grow', () => {
  const source = read('renderer/theme-integration.js')
  assert.match(source, /panel\.className = 'hd-theme-panel'/u)
  assertScrollable(declarationsFor(source, '.hd-theme-panel'), 'guest skin picker panel')
  assertDescriptionIsNotClipped(declarationsFor(source, '.hd-theme-description'), 'guest skin description')
})
