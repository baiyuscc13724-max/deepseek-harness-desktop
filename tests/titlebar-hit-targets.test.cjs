const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { beginWindowDrag, moveWindowDrag, endWindowDrag } = require('../electron/bridge/window-drag-service.cjs')

test('blank-area drag follows the pointer and restores a maximized window around its grab point', () => {
  const calls = []
  let bounds = { x: 0, y: 0, width: 1400, height: 900 }
  let maximized = true
  const window = {
    isDestroyed: () => false,
    isMaximized: () => maximized,
    unmaximize: () => { maximized = false; bounds = { x: 500, y: 200, width: 1000, height: 700 }; calls.push(['restore']) },
    getBounds: () => ({ ...bounds }),
    setPosition: (x, y) => { bounds = { ...bounds, x, y }; calls.push(['move', x, y]) }
  }

  assert.equal(beginWindowDrag(window, { x: 700, y: 180 }, 'win32'), true)
  assert.equal(moveWindowDrag(window, { x: 820, y: 260 }), true)
  assert.equal(endWindowDrag(window), true)
  assert.deepEqual(calls, [['restore'], ['move', 200, 40], ['move', 320, 120]])
  assert.equal(beginWindowDrag(window, { x: 1, y: 1 }, 'linux'), false)
})

test('blank-area window dragging dynamically excludes official controls', () => {
  const html = readFileSync(path.resolve(__dirname, '..', 'renderer', 'index.html'), 'utf8')
  const guestPreload = readFileSync(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')
  const main = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

  assert.doesNotMatch(html, /window-drag|drag-region/)
  assert.match(guestPreload, /target\.closest\(interactiveSelector\)/)
  assert.match(guestPreload, /pointTouchesText\(event\.clientX, event\.clientY\)/)
  assert.match(guestPreload, /ipcRenderer\.send\('window:beginDrag', \{ x: event\.screenX, y: event\.screenY \}\)/)
  assert.match(guestPreload, /ipcRenderer\.send\('window:moveDrag'/)
  assert.match(guestPreload, /ipcRenderer\.send\('window:endDrag'\)/)
  assert.match(main, /webPreferences\.preload = path\.join\(__dirname, 'guest-preload\.cjs'\)/)
  assert.match(main, /ipcMain\.on\('window:beginDrag'/)
  assert.match(main, /beginWindowDrag\(mainWindow, point\)/)
  assert.match(main, /moveWindowDrag\(mainWindow, point\)/)
})

test('desktop pet card closes when the user clicks outside it', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')

  assert.match(source, /document\.addEventListener\('pointerdown', event => \{/)
  assert.match(source, /petPanel\.contains\(event\.target\) \|\| petQuickButton\.contains\(event\.target\)/)
  assert.match(source, /runtimeView\.addEventListener\('focus', closePetPanel\)/)
  assert.match(source, /closePetPanel\(\)/)
})
