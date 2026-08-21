const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = file => readFile(path.join(root, file), 'utf8')

test('workbench links route to the embedded browser instead of always launching desktop browser', async () => {
  const [main, preload, renderer] = await Promise.all([
    source('electron/main.cjs'), source('electron/preload.cjs'), source('renderer/app.js')
  ])
  assert.ok(main.includes("require('./bridge/browser-link-router.cjs')"))
  assert.match(main, /guest\.setWindowOpenHandler\([\s\S]{0,500}openRoutedBrowserLink/u)
  assert.doesNotMatch(main, /guest\.setWindowOpenHandler\([\s\S]{0,500}shell\.openExternal/u)
  assert.ok(main.includes("ipcMain.handle('shell:openLink'"))
  assert.ok(preload.includes("openLink: (url, context) => ipcRenderer.invoke('shell:openLink'"))
  assert.ok(renderer.includes('api.openLink('))
  assert.doesNotMatch(renderer, /api\.openExternal\(/u)
})

test('link context menu exposes embedded default and explicit system-browser escape hatch', async () => {
  const main = await source('electron/main.cjs')
  assert.ok(main.includes("label: '在内置浏览器打开'"))
  assert.ok(main.includes("label: '用系统浏览器打开'"))
  assert.match(main, /userChoice: 'embedded'/u)
  assert.match(main, /userChoice: 'system'/u)
})

test('system browser IPC is explicit while default link IPC remains policy-routed', async () => {
  const main = await source('electron/main.cjs')
  assert.match(main, /shell:openLink[\s\S]{0,420}userChoice: String\(context\.userChoice \|\| 'default'\)/u)
  assert.match(main, /shell:openExternal[\s\S]{0,260}userChoice: 'system'/u)
  assert.match(main, /shell:openLink[\s\S]{0,180}assertDesktopShellSender\(event\)/u)
  assert.match(main, /shell:openExternal[\s\S]{0,180}assertDesktopShellSender\(event\)/u)
})
