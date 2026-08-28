const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('Android device view stays inside the native right workspace without a close/reopen handoff', async () => {
  const [main, preload, integration, workspace] = await Promise.all([
    source('electron/main.cjs'),
    source('electron/preload.cjs'),
    source('renderer/right-workspace-integration.js'),
    source('renderer/device-workspace.js')
  ])
  assert.match(main, /ipcMain\.handle\('desktopAndroid:action'/u)
  assert.match(main, /DESKTOP_ANDROID_ROUTES/u)
  assert.match(preload, /desktopAndroidAction/u)
  assert.doesNotMatch(preload, /openAndroidDevicePanel/u)
  assert.doesNotMatch(integration, /openAndroidDevicePanel|android-device/u)
  assert.match(workspace, /activeSource = source/u)
  assert.match(workspace, /desktopAndroidAction/u)
  assert.match(workspace, /switchDevice/u)
  assert.match(workspace, /right-workspace-android-frame/u)
})

test('Android shell bridge validates bounded controls and only local plugin routes', async () => {
  const main = await source('electron/main.cjs')
  for (const route of ['/devices', '/status', '/switch-device', '/capture', '/control', '/device-action']) {
    assert.match(main, new RegExp(`/_dsh/dsh-android${route.replace('/', '\\/')}`))
  }
  assert.match(main, /x < 0 \|\| x > 1 \|\| y < 0 \|\| y > 1/u)
  assert.match(main, /text\.length > 4_000/u)
  assert.match(main, /isLocalRuntimeUrl\(runtimeState\.url\)/u)
  assert.match(main, /http\.request\(url/u)
  assert.match(main, /'sec-fetch-site': 'same-origin'/u)
  assert.match(main, /action === 'capture'[\s\S]{0,800}body\.data/u)
})
