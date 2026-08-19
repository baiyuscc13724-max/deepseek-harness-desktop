const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createDesktopTray } = require('../electron/desktop-tray.cjs')

test('desktop tray exposes low-profile data controls and explicit exit actions', () => {
  let template = null
  const calls = []
  class FakeTray extends EventEmitter {
    setToolTip(value) { this.tooltip = value }
    setContextMenu(value) { this.menu = value }
  }
  const source = { isEmpty: () => false, resize: size => ({ size }) }
  const tray = createDesktopTray({
    Tray: FakeTray,
    Menu: { buildFromTemplate: value => { template = value; return value } },
    nativeImage: { createFromPath: value => { calls.push(['icon', value]); return source } },
    iconPath: 'icon.png',
    showMainWindow: () => calls.push(['show']),
    hideMainWindow: () => calls.push(['hide']),
    openMemoryManager: () => calls.push(['memory']),
    openStorageManager: () => calls.push(['storage']),
    quitApp: () => calls.push(['quit'])
  })

  assert.equal(tray.tooltip, 'Harness Desktop')
  assert.deepEqual(template.map(item => item.label || item.type), ['打开 Harness Desktop', '隐藏主窗口', '数据与隐私', 'separator', '退出'])
  assert.deepEqual(template[2].submenu.map(item => item.label), ['本地记忆…', '存储与缓存…'])
  tray.emit('click')
  template[1].click()
  template[2].submenu[0].click()
  template[2].submenu[1].click()
  template[4].click()
  assert.deepEqual(calls, [['icon', 'icon.png'], ['show'], ['hide'], ['memory'], ['storage'], ['quit']])
})

test('closing the main window hides it while tray exit performs the real quit', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

  assert.match(source, /mainWindow\.on\('close',[\s\S]*if \(isQuitting\) return[\s\S]*event\.preventDefault\(\)[\s\S]*mainWindow\.hide\(\)/)
  assert.match(source, /quitApp:\s*\(\) => app\.quit\(\)/)
  assert.match(source, /app\.on\('before-quit',[\s\S]*isQuitting = true/)
})
