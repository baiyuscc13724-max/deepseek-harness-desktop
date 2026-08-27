const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

class FakeContents extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.inserted = []
    this.removed = []
    this.events = []
  }

  isDestroyed() { return this.destroyed }

  async insertCSS(css) {
    this.inserted.push(css)
    const key = `css-${this.inserted.length}`
    this.events.push(`insert:${key}`)
    return key
  }

  async removeInsertedCSS(key) {
    this.removed.push(key)
    this.events.push(`remove:${key}`)
  }
}

test('Computer Use indicator owns the blue veil, control cursor and global Esc lifecycle', async () => {
  const { COMPUTER_USE_INDICATOR_CSS, ComputerUseIndicatorController, shouldShowComputerUseIndicator } = require('../electron/bridge/computer-use-indicator.cjs')
  const registered = new Map()
  const unregistered = []
  let stopped = 0
  const shortcut = {
    register(accelerator, callback) {
      registered.set(accelerator, callback)
      return true
    },
    unregister(accelerator) {
      unregistered.push(accelerator)
      registered.delete(accelerator)
    }
  }
  const controller = new ComputerUseIndicatorController({
    globalShortcut: shortcut,
    onStop: async () => { stopped += 1 }
  })
  const contents = new FakeContents()
  controller.track(contents)

  assert.match(COMPUTER_USE_INDICATOR_CSS, /rgba\(24, 132, 255/u)
  assert.match(COMPUTER_USE_INDICATOR_CSS, /data:image\/svg\+xml/u)
  assert.match(COMPUTER_USE_INDICATOR_CSS, /Esc 退出/u)
  assert.match(COMPUTER_USE_INDICATOR_CSS, /pointer-events:\s*none/u)
  assert.doesNotMatch(COMPUTER_USE_INDICATOR_CSS, /animation:|backdrop-filter/u)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'desktop' }), true)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'window' }), false)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'harness' }), false)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'browser' }), false)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, null), false)
  assert.equal(shouldShowComputerUseIndicator({ active: false }, { kind: 'desktop' }), false)
  assert.equal(contents.inserted.length, 0)

  const active = await controller.setActive(true)
  assert.deepEqual(active, { active: true, accelerator: 'Esc', shortcutRegistered: true })
  assert.equal(contents.inserted.length, 1)
  assert.equal(registered.has('Esc'), true)

  const unchanged = await controller.setActive(true)
  assert.deepEqual(unchanged, active)
  assert.equal(contents.inserted.length, 1)
  assert.deepEqual(contents.removed, [])

  await registered.get('Esc')()
  assert.equal(stopped, 1)
  let prevented = false
  contents.emit('before-input-event', { preventDefault: () => { prevented = true } }, { type: 'keyDown', key: 'Escape' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(prevented, true)
  assert.equal(stopped, 2)

  contents.emit('dom-ready')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(contents.inserted.length, 2)
  assert.deepEqual(contents.removed, ['css-1'])
  assert.deepEqual(contents.events.slice(-2), ['insert:css-2', 'remove:css-1'])

  const inactive = await controller.setActive(false)
  assert.deepEqual(inactive, { active: false, accelerator: 'Esc', shortcutRegistered: false })
  assert.deepEqual(unregistered, ['Esc'])
  assert.deepEqual(contents.removed, ['css-1', 'css-2'])

  await controller.dispose()
})

test('Computer Use desktop overlay spans every display without intercepting input or screen capture', async () => {
  const { ComputerUseDesktopOverlayController } = require('../electron/bridge/computer-use-indicator.cjs')
  const windows = []
  class FakeOverlayWindow extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
      this.visible = false
      this.destroyed = false
      windows.push(this)
    }
    loadURL(url) { this.url = url; return Promise.resolve() }
    setIgnoreMouseEvents(value, options) { this.ignore = { value, options } }
    setAlwaysOnTop(value, level) { this.top = { value, level } }
    setContentProtection(value) { this.protected = value }
    setVisibleOnAllWorkspaces(value, options) { this.workspaces = { value, options } }
    setBounds(bounds) { this.bounds = bounds }
    showInactive() { this.visible = true }
    hide() { this.visible = false }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  let displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 1024 } }
  ]
  const overlay = new ComputerUseDesktopOverlayController({ BrowserWindow: FakeOverlayWindow, screen: { getAllDisplays: () => displays } })
  assert.deepEqual(await overlay.setActive(false), { active: false, displays: 0 })
  assert.equal(windows.length, 0)
  assert.deepEqual(await overlay.setActive(true), { active: true, displays: 2 })
  assert.equal(windows.length, 2)
  assert.deepEqual(windows[1].bounds, { x: -1280, y: 0, width: 1280, height: 1024 })
  assert.deepEqual(windows[0].ignore, { value: true, options: { forward: true } })
  assert.deepEqual(windows[0].top, { value: true, level: 'screen-saver' })
  assert.equal(windows[0].protected, true)
  assert.equal(windows.every(window => window.visible), true)
  assert.match(decodeURIComponent(windows[0].url), /Computer Use 控制整个桌面/u)

  displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1600, height: 900 } }]
  await overlay.refresh()
  assert.deepEqual(windows[0].bounds, { x: 0, y: 0, width: 1600, height: 900 })
  assert.equal(windows[1].destroyed, true)
  await overlay.setActive(false)
  assert.equal(windows[0].visible, false)
  await overlay.dispose()
  assert.equal(windows[0].destroyed, true)
})

test('Desktop Host shows the indicator across the whole desktop while a global action is executing', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /ComputerUseDesktopOverlayController/u)
  assert.match(main, /ComputerUseIndicatorController/u)
  assert.match(main, /desktopOverlay:\s*new ComputerUseDesktopOverlayController\(\{ BrowserWindow, screen \}\)/u)
  assert.match(main, /globalShortcut/u)
  assert.match(main, /onStop:\s*\(\) => setComputerUseEnabled\(false\)/u)
  assert.match(main, /shouldShowComputerUseIndicator\(sharedComputerUseControlState\(\), target\)/u)
  assert.match(main, /await syncComputerUseIndicator\(COMPUTER_USE_DESKTOP_TARGET\)[\s\S]*finally \{\s*await syncComputerUseIndicator\(\)/u)
  assert.match(main, /if \(input\.scope === 'computer'\) return modelComputerUseAction\(input\)\s*await syncComputerUseIndicator\(\)/u)
  assert.doesNotMatch(main, /setActive\(sharedComputerUseControlState\(\)\.active\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(mainWindow\.webContents, \{ mode: 'cursor' \}\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(guest, \{ mode: 'cursor' \}\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(contents, \{ mode: 'cursor' \}\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(detached\.webContents, \{ mode: 'cursor' \}\)/u)
  assert.match(main, /computerUseIndicator\?\.dispose\(\)/u)
})
