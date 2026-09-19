'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const { PetWindowController } = require('../electron/pet/pet-window.cjs')

// Only in-memory stand-ins. No Electron import, fs write, clipboard, network,
// process launch, real screen enumeration or user configuration dependency.
function fixture() {
  const instances = [], writes = []
  const area = { x: 0, y: 0, width: 1920, height: 1080 }
  const display = { id: 'fixture', workArea: area, scaleFactor: 1 }
  let preferences = { enabled: true, awake: true, alwaysOnTop: true }
  class Window extends EventEmitter {
    constructor(options) { super(); this.bounds = options; this.destroyed = false; this.visible = false; this.webContents = new EventEmitter(); this.webContents.send = (...args) => writes.push(args); this.webContents.isLoading = () => false; this.webContents.setWindowOpenHandler = handler => { this.openHandler = handler }; this.webContents.getURL = () => this.url; instances.push(this) }
    loadFile(file) { this.url = pathToFileURL(file).href; return Promise.resolve() }
    isDestroyed() { return this.destroyed }
    setAlwaysOnTop(value) { this.alwaysOnTop = value }
    setIgnoreMouseEvents() {}
    setShape() {}
    getBounds() { return this.bounds }
    setPosition(x, y) { this.bounds = { ...this.bounds, x, y }; writes.push(['position', x, y]) }
    hide() { this.visible = false }
    isVisible() { return this.visible }
    showInactive() { this.visible = true }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  const controller = new PetWindowController({ BrowserWindow: Window, screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], getDisplayMatching: () => display, getDisplayNearestPoint: () => display }, appRoot: path.resolve('fixture', 'app.asar'), preload: 'inert.cjs', getPreferences: () => preferences, updatePreferences: patch => { writes.push(['preferences', patch]); preferences = { ...preferences, ...patch } }, onFocusMain: () => {}, getMainBounds: () => null })
  return { controller, instances, writes, display }
}

test('dispose is terminal: environment, ensure and wake cannot recreate a pet window', () => {
  const f = fixture(); f.controller.ensure(); f.controller.dispose()
  assert.equal(f.controller.environment(), null)
  assert.equal(f.controller.ensure(), null)
  assert.doesNotThrow(() => f.controller.syncPreferences({ enabled: true, awake: true }))
  assert.equal(f.instances.length, 1)
})
test('NaN Infinity null and string move coordinates are rejected before creating or moving a window', () => {
  for (const value of [NaN, Infinity, -Infinity, null, '100', undefined]) {
    const f = fixture()
    assert.equal(f.controller.moveTo(value, 30), null)
    assert.equal(f.controller.moveTo(30, value), null)
    assert.equal(f.instances.length, 0)
    assert.deepEqual(f.writes, [])
  }
})
test('legal bounded move plus hide/wake preserve one native window', () => {
  const f = fixture(); const result = f.controller.moveTo(-200, -900)
  assert.equal(result.bounds.x, 0); assert.equal(result.bounds.y, -286)
  f.controller.syncPreferences({ enabled: true, awake: false }); assert.equal(f.instances[0].visible, false)
  f.controller.syncPreferences({ enabled: true, awake: true }); assert.equal(f.instances[0].visible, true)
  assert.equal(f.instances.length, 1)
  f.controller.dispose()
})
test('pet navigation denies external/file replacement and popups but allows its exact page query/hash', () => {
  const f = fixture(), window = f.controller.ensure()
  const allowed = `${window.url}?rigAction=wave#fixture`
  for (const target of ['https://example.invalid', 'file:///untrusted.html', allowed]) {
    let prevented = false
    window.webContents.emit('will-navigate', { preventDefault() { prevented = true } }, target)
    assert.equal(prevented, target !== allowed)
  }
  assert.deepEqual(window.openHandler({ url: allowed }), { action: 'deny' })
  f.controller.dispose()
})
test('late load/closed events from an obsolete window cannot mutate its replacement', () => {
  const f = fixture(), old = f.controller.ensure()
  old.destroyed = true
  const fresh = f.controller.ensure()
  f.controller.lastState = { status: 'idle' }
  old.webContents.emit('did-finish-load')
  assert.deepEqual(f.writes, [])
  old.emit('closed')
  assert.equal(f.controller.window, fresh)
  f.controller.dispose()
})
