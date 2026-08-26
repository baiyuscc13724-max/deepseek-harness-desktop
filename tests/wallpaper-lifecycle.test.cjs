const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const main = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
const guestPreload = readFileSync(path.resolve(__dirname, '..', 'electron', 'guest-preload.cjs'), 'utf8')

function sourceBlock(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `missing source block: ${start}`)
  return source.slice(from, to)
}

function loadGuestLifecycleApi(currentStatePromise) {
  const exposed = Object.create(null)
  const listeners = new Map()
  const ipcRenderer = {
    invoke: channel => {
      assert.equal(channel, 'appearance:wallpaper-lifecycle:get')
      return currentStatePromise
    },
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
    send: () => {},
    sendToHost: () => {}
  }
  const contextBridge = {
    exposeInMainWorld: (name, value) => { exposed[name] = value }
  }
  vm.runInNewContext(guestPreload, {
    require: id => {
      assert.equal(id, 'electron', 'sandboxed guest preload must not require local modules')
      return { contextBridge, ipcRenderer }
    },
    window: { addEventListener: () => {} },
    process: { platform: 'win32' },
    console
  }, { filename: 'guest-preload.cjs' })
  return {
    api: exposed.harnessDesktopGuest,
    exposed,
    emit: value => listeners.get('appearance:wallpaper-lifecycle')?.({}, value),
    hasListener: () => listeners.has('appearance:wallpaper-lifecycle')
  }
}

test('wallpaper lifecycle broadcasts deterministic park/resume over every host signal', () => {
  assert.match(main, /const WALLPAPER_LIFECYCLE_CHANNEL = 'appearance:wallpaper-lifecycle'/)
  assert.match(main, /let wallpaperScreenLocked = false/)
  assert.match(main, /let wallpaperSystemSuspended = false/)
  assert.match(main, /return windowVisible && !wallpaperScreenLocked && !wallpaperSystemSuspended \? 'resumed' : 'parked'/)
  assert.doesNotMatch(main, /wallpaperHostSessionInteractive/)
  assert.match(main, /function syncWallpaperLifecycle\(reason, options = \{\}\)/)
  assert.match(main, /function refitWallpaperLifecycle\(reason\)/)

  assert.match(main, /mainWindow\.on\('hide'[\s\S]*?syncWallpaperLifecycle\('window-hidden'\)/)
  assert.match(main, /mainWindow\.on\('show', \(\) => syncWallpaperLifecycle\('window-shown'\)/)
  assert.match(main, /mainWindow\.on\('restore', \(\) => syncWallpaperLifecycle\('window-restored'\)/)

  const lock = sourceBlock(main, "powerMonitor.on('lock-screen'", "powerMonitor.on('unlock-screen'")
  const unlock = sourceBlock(main, "powerMonitor.on('unlock-screen'", "powerMonitor.on('suspend'")
  const suspend = sourceBlock(main, "powerMonitor.on('suspend'", "powerMonitor.on('resume'")
  const resume = sourceBlock(main, "powerMonitor.on('resume'", "screen.on('display-metrics-changed'")
  assert.match(lock, /wallpaperScreenLocked = true/)
  assert.doesNotMatch(lock, /wallpaperSystemSuspended =/)
  assert.match(unlock, /wallpaperScreenLocked = false/)
  assert.doesNotMatch(unlock, /wallpaperSystemSuspended =/)
  assert.match(suspend, /wallpaperSystemSuspended = true/)
  assert.doesNotMatch(suspend, /wallpaperScreenLocked =/)
  assert.match(resume, /wallpaperSystemSuspended = false/)
  assert.doesNotMatch(resume, /wallpaperScreenLocked =/)

  assert.match(main, /screen\.on\('display-metrics-changed', \(\) => refitWallpaperLifecycle\('display-metrics-changed'\)\)/)
  assert.match(main, /screen\.on\('display-added', \(\) => refitWallpaperLifecycle\('display-added'\)\)/)
  assert.match(main, /screen\.on\('display-removed', \(\) => refitWallpaperLifecycle\('display-removed'\)\)/)
  assert.match(main, /syncWallpaperLifecycle\('boot'\)/)
  assert.match(main, /runtimeGuest\.send\(WALLPAPER_LIFECYCLE_CHANNEL, payload\)/)
})

test('wallpaper lifecycle is event-driven and never adds a watchdog or reload', () => {
  const lifecycleBlock = sourceBlock(main, '// Deterministic wallpaper park/resume broadcast.', 'function themeAssetMime')
  assert.doesNotMatch(lifecycleBlock, /setTimeout|setInterval|\.reload\(/u)
  assert.match(lifecycleBlock, /Object\.freeze\(/)

  const wiring = sourceBlock(main, "powerMonitor.on('lock-screen'", "screen.on('display-removed'")
  assert.doesNotMatch(wiring, /\.reload\(|webContents\.reload/u)
})

test('guest preload exposes only the ordered park/resume action interface', () => {
  assert.match(guestPreload, /onWallpaperLifecycle: subscribeWallpaperLifecycle/)
  assert.doesNotMatch(guestPreload, /__HARNESS_DESKTOP_WALLPAPER_LIFECYCLE__/)
  assert.match(guestPreload, /ipcRenderer\.invoke\('appearance:wallpaper-lifecycle:get'\)/)
  assert.match(guestPreload, /let latestSeq = -1/)
  assert.match(guestPreload, /const deliverIfNewer = value => \{[\s\S]*?state\.seq <= latestSeq[\s\S]*?latestSeq = state\.seq[\s\S]*?'park' : 'resume'/)
  assert.match(guestPreload, /ipcRenderer\.on\('appearance:wallpaper-lifecycle', wrapped\)\s*currentWallpaperLifecycle\(\)\.then\(deliverIfNewer\)/)
  assert.match(guestPreload, /return \(\) => \{\s*disposed = true\s*ipcRenderer\.removeListener\('appearance:wallpaper-lifecycle', wrapped\)/)
  assert.match(guestPreload, /value\.phase === 'parked' \|\| value\.phase === 'resumed'/)
  assert.match(guestPreload, /Number\.isSafeInteger\(value\?\.seq\) && value\.seq >= 0/)
})

test('late state replay cannot reverse a newer lifecycle broadcast', async () => {
  let resolveCurrent
  const currentState = new Promise(resolve => { resolveCurrent = resolve })
  const harness = loadGuestLifecycleApi(currentState)
  const actions = []
  const unsubscribe = harness.api.onWallpaperLifecycle(action => actions.push(action))

  harness.emit({ phase: 'resumed', reason: 'system-resumed', seq: 2, at: 2 })
  resolveCurrent({ phase: 'parked', reason: 'system-suspend', seq: 1, at: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(actions, ['resume'])

  unsubscribe()
  assert.equal(harness.hasListener(), false)
  harness.emit({ phase: 'parked', reason: 'window-hidden', seq: 3, at: 3 })
  assert.deepEqual(actions, ['resume'])
})

test('initial sequence zero is delivered to a late subscriber', async () => {
  const harness = loadGuestLifecycleApi(Promise.resolve({ phase: 'parked', reason: 'boot', seq: 0, at: 0 }))
  const actions = []
  harness.api.onWallpaperLifecycle(action => actions.push(action))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(actions, ['park'])
})

test('wallpaper lifecycle state query accepts only the local runtime sender', () => {
  assert.match(main, /ipcMain\.handle\('appearance:wallpaper-lifecycle:get'/)
  assert.match(main, /isLocalRuntimeUrl\(event\.sender\.getURL\(\)\)/)
  assert.match(main, /return wallpaperLifecycleCurrent/)
})
