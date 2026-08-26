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
  }

  isDestroyed() { return this.destroyed }

  async insertCSS(css) {
    this.inserted.push(css)
    return `css-${this.inserted.length}`
  }

  async removeInsertedCSS(key) {
    this.removed.push(key)
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
  assert.match(COMPUTER_USE_INDICATOR_CSS, /prefers-reduced-motion:\s*reduce/u)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'window' }), true)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'harness' }), false)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, { kind: 'browser' }), false)
  assert.equal(shouldShowComputerUseIndicator({ active: true }, null), false)
  assert.equal(shouldShowComputerUseIndicator({ active: false }, { kind: 'window' }), false)
  assert.equal(contents.inserted.length, 0)

  const active = await controller.setActive(true)
  assert.deepEqual(active, { active: true, accelerator: 'Esc', shortcutRegistered: true })
  assert.equal(contents.inserted.length, 1)
  assert.equal(registered.has('Esc'), true)

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

  const inactive = await controller.setActive(false)
  assert.deepEqual(inactive, { active: false, accelerator: 'Esc', shortcutRegistered: false })
  assert.deepEqual(unregistered, ['Esc'])
  assert.deepEqual(contents.removed, ['css-1', 'css-2'])

  await controller.dispose()
})

test('Desktop Host shows the indicator only while an external application action is executing', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /ComputerUseIndicatorController/u)
  assert.match(main, /globalShortcut/u)
  assert.match(main, /onStop:\s*\(\) => setComputerUseEnabled\(false\)/u)
  assert.match(main, /shouldShowComputerUseIndicator\(sharedComputerUseControlState\(\), target\)/u)
  assert.match(main, /await syncComputerUseIndicator\(target\)[\s\S]*finally \{\s*await syncComputerUseIndicator\(\)/u)
  assert.match(main, /if \(input\.scope === 'computer'\) return modelComputerUseAction\(input\)\s*await syncComputerUseIndicator\(\)/u)
  assert.doesNotMatch(main, /setActive\(sharedComputerUseControlState\(\)\.active\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(mainWindow\.webContents\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(guest, \{ mode: 'surface' \}\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(contents, \{ mode: 'surface' \}\)/u)
  assert.match(main, /ensureComputerUseIndicator\(\)\.track\(detached\.webContents\)/u)
  assert.match(main, /computerUseIndicator\?\.dispose\(\)/u)
})
