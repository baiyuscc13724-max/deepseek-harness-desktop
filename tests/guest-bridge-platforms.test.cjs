'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { detectUiBackend, GuestBridge, PROTOCOL_NAME, PROTOCOL_VERSION } = require('../guest-bridge/index.cjs')

function request(id, action, params = {}) {
  return { protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, type: 'request', id, action, params }
}

test('Windows UI Automation stays unavailable until adapter and system authorization are established', () => {
  const missing = detectUiBackend({ platform: 'win32' })
  assert.equal(missing.available, false)
  assert.equal(missing.code, 'adapter-missing')
  assert.match(missing.authority, /Windows/u)

  const denied = detectUiBackend({ platform: 'win32', adapterAvailable: true, accessibilityAuthorized: false })
  assert.equal(denied.code, 'permission-required')
  const ready = detectUiBackend({ platform: 'win32', adapterAvailable: true, accessibilityAuthorized: true })
  assert.equal(ready.available, true)
  assert.equal(ready.backend, 'Windows UI Automation')
})

test('Linux AT-SPI refuses unauthorized Wayland fallback and reports explicit degradation', () => {
  const wayland = detectUiBackend({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland', AT_SPI_BUS_ADDRESS: 'unix:path=/run/at-spi' }, adapterAvailable: true })
  assert.equal(wayland.available, false)
  assert.equal(wayland.code, 'portal-required')
  assert.match(wayland.reason, /fallback is forbidden/u)

  const noBus = detectUiBackend({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11' }, adapterAvailable: true })
  assert.equal(noBus.code, 'permission-required')
  const x11 = detectUiBackend({ platform: 'linux', env: { XDG_SESSION_TYPE: 'x11', AT_SPI_BUS_ADDRESS: 'unix:path=/run/at-spi' }, adapterAvailable: true })
  assert.equal(x11.available, true)
  assert.equal(x11.backend, 'AT-SPI')
  const portal = detectUiBackend({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' }, adapterAvailable: true, portalAuthorized: true, accessibilityAuthorized: true })
  assert.equal(portal.available, true)
})

test('macOS Accessibility never treats adapter presence as TCC consent', () => {
  assert.equal(detectUiBackend({ platform: 'darwin', adapterAvailable: true }).code, 'permission-required')
  const ready = detectUiBackend({ platform: 'darwin', adapterAvailable: true, accessibilityAuthorized: true })
  assert.equal(ready.available, true)
  assert.match(ready.authority, /TCC/u)
})

test('unknown platforms and missing UI permission degrade safely while non-UI capability description remains available', async () => {
  const unknown = detectUiBackend({ platform: 'freebsd', adapterAvailable: true, accessibilityAuthorized: true })
  assert.equal(unknown.available, false)
  assert.equal(unknown.code, 'platform-unsupported')

  const bridge = new GuestBridge({ platform: 'darwin', uiProbe: { adapterAvailable: true, accessibilityAuthorized: false }, adapters: { ui: { snapshot: async () => ({}) } } })
  const token = bridge.authority.grant({ peerFingerprint: 'peer', actions: ['capabilities.describe', 'ui.snapshot'] })
  const context = { token, peerFingerprint: 'peer' }
  const description = await bridge.handle(request('d', 'capabilities.describe'), context)
  assert.equal(description.ok, true)
  assert.equal(description.result.capabilities.ui.available, false)
  assert.deepEqual(description.result.packaging, {
    bundledGuestRuntime: false, bundledVm: false, bundledSystemImage: false, bundledSdk: false
  })
  const ui = await bridge.handle(request('u', 'ui.snapshot'), context)
  assert.equal(ui.ok, false)
  assert.equal(ui.error.code, 'permission-required')
})

test('Windows path confinement is drive-aware and rejects traversal and alternate-drive access', async () => {
  const bridge = new GuestBridge({ platform: 'win32', fileRoots: ['C:\\Guests\\Shared'], adapters: { file: { stat: async path => path } } })
  const token = bridge.authority.grant({ peerFingerprint: 'peer', actions: ['file.stat'] })
  const context = { token, peerFingerprint: 'peer' }
  assert.equal((await bridge.handle(request('ok', 'file.stat', { path: 'C:\\Guests\\Shared\\note.txt' }), context)).ok, true)
  assert.equal((await bridge.handle(request('escape', 'file.stat', { path: 'C:\\Guests\\Shared\\..\\secret.txt' }), context)).error.code, 'path-denied')
  assert.equal((await bridge.handle(request('drive', 'file.stat', { path: 'D:\\secret.txt' }), context)).error.code, 'path-denied')
  assert.equal((await bridge.handle(request('relative', 'file.stat', { path: 'note.txt' }), context)).error.code, 'invalid-path')
})
