const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const { normalizeState } = require('../electron/store/app-state-store.cjs')

const root = path.join(__dirname, '..')
const read = file => readFileSync(path.join(root, file), 'utf8')

test('native appearance page is reachable from the official settings with one-click Wallpaper Engine import', () => {
  const html = read('renderer/index.html')
  const renderer = read('renderer/app.js')
  const guest = read('renderer/theme-integration.js')
  assert.match(html, /id="skinChooseWallpaperEngine"[^>]*>一键导入 Wallpaper Engine</)
  assert.match(html, /id="skinWallpaperEnginePicker"/)
  assert.match(html, /id="skinWallpaperEngineStatus"/)
  assert.match(html, /id="skinWallpaperEngineItems"/)
  assert.match(html, /id="skinWallpaperEngineSync"[^>]*disabled>一键同步已绑定项目/)
  assert.match(html, /id="skinWallpaperEngineRescan"/)
  assert.match(html, /id="skinWallpaperEngineManual"/)
  // The settings entry on the desktop routes to the in-project native page.
  assert.match(renderer, /\} else if \(target\.hostname === 'open-appearance'\) \{\s*openSkinPicker\(\)/u)
  assert.match(renderer, /api\.listWallpaperEngineProjects\(\)/)
  assert.match(renderer, /api\.applyWallpaperEngineProject\(directory\)/)
  assert.match(renderer, /api\.syncWallpaperEngine\(\)/)
  assert.match(renderer, /skinWallpaperEngineSync\.disabled = !wallpaperEngineBound/)
  assert.match(renderer, /wallpaperEngineProject/)
  assert.match(guest, /request\('open-appearance'\)/)
  // The injected browser panel is kept only for the mobile runtime.
  assert.match(guest, /const mobile = document\.documentElement\.dataset\.harnessMobile === 'true'/)
  assert.match(guest, /if \(!mobile && skinButton\) return/)
  assert.match(guest, /panel = createPanel\(\)/)
  assert.match(guest, /外观与界面模式/)
  assert.match(guest, /restore-appearance/)
})

test('desktop shell exposes the one-click Wallpaper Engine IPC bridge only', () => {
  const preload = read('electron/preload.cjs')
  const main = read('electron/main.cjs')
  assert.match(preload, /listWallpaperEngineProjects: \(\) => ipcRenderer\.invoke\('appearance:listWallpaperEngineProjects'\)/)
  assert.match(preload, /applyWallpaperEngineProject: value => ipcRenderer\.invoke\('appearance:applyWallpaperEngineProject', value\)/)
  assert.match(preload, /syncWallpaperEngine: \(\) => ipcRenderer\.invoke\('appearance:syncWallpaperEngine'\)/)
  assert.match(main, /ipcMain\.handle\('appearance:listWallpaperEngineProjects'/)
  assert.match(main, /ipcMain\.handle\('appearance:applyWallpaperEngineProject'/)
  assert.match(main, /ipcMain\.handle\('appearance:syncWallpaperEngine'/)
  assert.match(main, /require\('\.\/bridge\/wallpaper-library\.cjs'\)/)
  assert.match(main, /function syncBoundWallpaperEngine\(\)/)
  assert.match(main, /const wallpaperEngineSync = process\.platform === 'win32'/)
  assert.match(main, /customTheme: \{ backgroundFile: fileName, wallpaperEngineSignature: signature \}/u)
  assert.doesNotMatch(main, /wallpaperEngineLibraryScan\(\) *return appearancePayload/u)
})

test('Wallpaper Engine binding is validated and discarded when unsafe', () => {
  const windows = process.platform === 'win32'
  const dir = windows
    ? 'C:\\Steam\\steamapps\\workshop\\content\\431960\\1234'
    : '/Steam/steamapps/workshop/content/431960/1234'
  const bound = normalizeState({ appearance: { customTheme: { wallpaperEngineProject: dir, wallpaperEngineSignature: '1:2:3:4' } } })
  assert.equal(bound.appearance.customTheme.wallpaperEngineProject, dir)
  assert.equal(bound.appearance.customTheme.wallpaperEngineSignature, '1:2:3:4')
  const unsafe = normalizeState({ appearance: { customTheme: { wallpaperEngineProject: '../../escape', wallpaperEngineSignature: 'abc;rm' } } })
  assert.equal(unsafe.appearance.customTheme.wallpaperEngineProject, null)
  assert.equal(unsafe.appearance.customTheme.wallpaperEngineSignature, null)
})