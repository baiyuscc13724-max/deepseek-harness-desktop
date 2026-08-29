const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const renderer = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')

function extractConst(name, nextName) {
  const start = renderer.indexOf(`  const ${name} =`)
  const end = renderer.indexOf(`\n  const ${nextName} =`, start)
  assert.ok(start >= 0 && end > start, `${name} source boundary is present`)
  const source = renderer.slice(start, end)
  return new Function('request', `${source}; return ${name}`)(() => {}) // eslint-disable-line no-new-func
}

test('mobile sync is mounted beside the official settings trigger', () => {
  assert.match(renderer, /const mountMobileEntry = \(\) => \{/u)
  assert.match(renderer, /\[data-slot="settings\.trigger"\] button/u)
  assert.match(renderer, /host\.insertBefore\(entry, settingsTrigger\)/u)
  assert.match(renderer, /watchMobileEntryLayout\(host, settingsTrigger\)/u)
  assert.match(renderer, /new ResizeObserver/u)
  assert.doesNotMatch(renderer, /triggerRect && triggerRect\.width/u)
  assert.match(renderer, /data-hd-mobile-compact="false"\] \{ display:grid!important; grid-template-columns:minmax\(0,1fr\) 42px; justify-content:stretch!important; \}/u)
  assert.match(renderer, /data-hd-mobile-compact="false"\] > #harness-desktop-mobile-sync-entry \{ grid-column:2; grid-row:1; \}/u)
  assert.match(renderer, /data-hd-mobile-compact="true"\] \{ display:flex!important; flex-direction:column!important; gap:0; \}/u)
  assert.doesNotMatch(renderer, /row\.id = 'harness-desktop-mobile-sync-row'/u)
  assert.doesNotMatch(renderer, /mountMobile\(section\)/u)
})

test('visible settings text keeps the mobile entry beside Settings even when its immediate host is transiently narrow', () => {
  const compactForWidth = extractConst('mobileEntryCompactForWidth', 'syncMobileEntryLayout')
  assert.equal(compactForWidth(176), false)
  assert.equal(compactForWidth(72), true)
  assert.equal(compactForWidth(36), true)
  assert.equal(compactForWidth(36, true), false)
  assert.equal(compactForWidth(0, true), false)
  assert.equal(compactForWidth(0), false)
  assert.match(renderer, /settingsTrigger\?\.textContent\?\.trim\(\)/u)
  assert.match(renderer, /mobileEntryResizeObserver\?\.observe\(settingsTrigger\)/u)
})

test('mobile entry click is isolated from the settings host and opens the existing dialog route', () => {
  const activate = extractConst('activateMobileEntry', 'mountMobileEntry')
  let prevented = false
  let stopped = false
  let action = ''
  activate({ preventDefault() { prevented = true }, stopPropagation() { stopped = true } }, value => { action = value })
  assert.equal(prevented, true)
  assert.equal(stopped, true)
  assert.equal(action, 'open-mobile-sync')
  assert.match(renderer, /entry\.addEventListener\('pointerdown', event => event\.stopPropagation\(\)\)/u)
  assert.match(renderer, /entry\.addEventListener\('click', activateMobileEntry\)/u)
})

test('mobile sync quick entry preserves status and accessible dialog semantics', () => {
  assert.match(renderer, /entry\.setAttribute\('aria-haspopup', 'dialog'\)/u)
  assert.match(renderer, /id = 'harness-desktop-mobile-sync-tooltip'/u)
  assert.match(renderer, /entry\.dataset\.state = connected \? 'connected' : enabled \? 'waiting' : 'off'/u)
  assert.match(renderer, /等待手机连接/u)
})
