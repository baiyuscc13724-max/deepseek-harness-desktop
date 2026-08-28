const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const renderer = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')

test('mobile sync is mounted beside the official settings trigger', () => {
  assert.match(renderer, /const mountMobileEntry = \(\) => \{/u)
  assert.match(renderer, /\[data-slot="settings\.trigger"\] button/u)
  assert.match(renderer, /host\.insertBefore\(entry, settingsTrigger\)/u)
  assert.match(renderer, /host\.dataset\.hdMobileCompact/u)
  assert.match(renderer, /data-hd-mobile-compact="false"\] \{ flex-direction:row!important; justify-content:flex-start!important; \}/u)
  assert.match(renderer, /data-hd-mobile-compact="false"\] > #harness-desktop-mobile-sync-entry \{ order:2; \}/u)
  assert.match(renderer, /data-hd-mobile-compact="true"\] \{ flex-direction:column!important; gap:0; \}/u)
  assert.doesNotMatch(renderer, /row\.id = 'harness-desktop-mobile-sync-row'/u)
  assert.doesNotMatch(renderer, /mountMobile\(section\)/u)
})

test('mobile sync quick entry preserves the existing dialog route and status feedback', () => {
  assert.match(renderer, /entry\.setAttribute\('aria-haspopup', 'dialog'\)/u)
  assert.match(renderer, /entry\.addEventListener\('click', \(\) => request\('open-mobile-sync'\)\)/u)
  assert.match(renderer, /id = 'harness-desktop-mobile-sync-tooltip'/u)
  assert.match(renderer, /entry\.dataset\.state = connected \? 'connected' : enabled \? 'waiting' : 'off'/u)
  assert.match(renderer, /等待手机连接/u)
})
