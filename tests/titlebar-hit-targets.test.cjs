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

test('maximized drag uses normal bounds even when Windows restores asynchronously', () => {
  const calls = []
  const maximized = { x: 0, y: 0, width: 2560, height: 1440 }
  const normal = { x: 300, y: 180, width: 1100, height: 760 }
  const window = {
    isDestroyed: () => false,
    isMaximized: () => true,
    getBounds: () => ({ ...maximized }),
    getNormalBounds: () => ({ ...normal }),
    unmaximize: () => calls.push(['restore']),
    setBounds: bounds => calls.push(['bounds', bounds]),
    setPosition: (x, y) => calls.push(['move', x, y])
  }

  assert.equal(beginWindowDrag(window, { x: 1280, y: 36 }, 'win32'), true)
  assert.equal(moveWindowDrag(window, { x: 1330, y: 76 }), true)
  assert.equal(endWindowDrag(window), true)
  assert.deepEqual(calls, [
    ['restore'],
    ['bounds', { x: 730, y: 17, width: 1100, height: 760 }],
    ['move', 780, 57]
  ])
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

test('visible titlebar tools collapse hidden storage and memory slots', () => {
  const html = readFileSync(path.resolve(__dirname, '..', 'renderer', 'index.html'), 'utf8')
  const styles = readFileSync(path.resolve(__dirname, '..', 'renderer', 'styles.css'), 'utf8')

  assert.match(html, /id="storageQuickButton" class="storage-quick-button hidden"/)
  assert.match(html, /id="memoryQuickButton" class="memory-quick-button hidden"/)
  assert.match(styles, /\.skin-quick-button \{ right:140px;/)
  assert.match(styles, /\.pet-quick-button \{ right:176px;/)
  assert.match(styles, /\.browser-quick-button \{ right:212px;/)
  assert.match(styles, /\.pet-quick-button\[hidden\] ~ \.browser-quick-button \{ right:176px;/)
})

test('Windows guest header reserves the native controls and desktop quick tools', () => {
  const guestPreload = readFileSync(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')

  assert.match(guestPreload, /function installWindowsTitlebarSafeArea\(\)/)
  assert.match(guestPreload, /process\.platform !== 'win32'/)
  assert.match(guestPreload, /header:has\(button\[class\*="_sessionLogButton"\]\)\{padding-right:260px!important\}/)
  assert.doesNotMatch(guestPreload, /\.[\w-]+_sessionLogButton/u, 'safe-area selector must not pin any official Web build hash')
  assert.match(guestPreload, /installWindowsTitlebarSafeArea\(\)/)
})

test('desktop pet card closes when the user clicks outside it', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')

  assert.match(source, /document\.addEventListener\('pointerdown', event => \{/)
  assert.match(source, /petPanel\.contains\(event\.target\) \|\| petQuickButton\.contains\(event\.target\)/)
  assert.match(source, /runtimeView\.addEventListener\('focus', closePetPanel\)/)
  assert.match(source, /closePetPanel\(\)/)
})

test('guest custom drag always sends window:endDrag once when capture or lifecycle aborts', () => {
  const guestPreload = readFileSync(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')

  assert.match(guestPreload, /let endDragSent = true/)
  assert.match(guestPreload, /const cleanupActiveDrag = \(\) => \{/)
  assert.match(guestPreload, /if \(!endDragSent\) \{/)
  assert.ok(guestPreload.includes("ipcRenderer.send('window:endDrag')"), 'guest must always send window:endDrag')
  assert.match(guestPreload, /document\.addEventListener\('lostpointercapture'/)
  assert.match(guestPreload, /window\.addEventListener\('blur'/)
  assert.match(guestPreload, /document\.addEventListener\('visibilitychange'/)
  assert.match(guestPreload, /window\.addEventListener\('pagehide'/)
})

test('main process host lifecycle ends an active custom drag as a fallback', () => {
  const main = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

  assert.match(main, /function endActiveWindowDrag\(\) \{/)
  assert.match(main, /mainWindow\.on\('blur', \(\) => endActiveWindowDrag\(\)\)/)
  assert.match(main, /mainWindow\.on\('minimize'/)
  assert.match(main, /mainWindow\.on\('hide'/)
  assert.match(main, /powerMonitor\.on\('suspend'[\s\S]*?endActiveWindowDrag\(\)/)
  const fallbackSites = (main.match(/endActiveWindowDrag\(\)/g) || []).length
  assert.ok(fallbackSites >= 4, `expected several endActiveWindowDrag fallback sites, found ${fallbackSites}`)
})

test('window drag sessions end idempotently so duplicate abort paths are safe', () => {
  const calls = []
  const window = {
    isDestroyed: () => false,
    isMaximized: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    setPosition: () => calls.push(['move'])
  }

  assert.equal(beginWindowDrag(window, { x: 100, y: 100 }, 'win32'), true)
  assert.equal(moveWindowDrag(window, { x: 160, y: 120 }), true)
  assert.equal(endWindowDrag(window), true)
  assert.equal(endWindowDrag(window), false, 'second abort path must be a harmless no-op')
  assert.deepEqual(calls, [['move']])
})
