const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createDesktopTray } = require('../electron/desktop-tray.cjs')

test('desktop tray exposes open, hide and explicit exit actions', () => {
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
    quitApp: () => calls.push(['quit'])
  })

  assert.equal(tray.tooltip, 'Harness Desktop')
  assert.deepEqual(template.map(item => item.label || item.type), ['打开 Harness Desktop', '隐藏主窗口', 'separator', '退出'])
  tray.emit('click')
  template[1].click()
  template[3].click()
  assert.deepEqual(calls, [['icon', 'icon.png'], ['show'], ['hide'], ['quit']])
})

test('closing the main window hides it while tray exit performs the real quit', () => {
  const source = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')

  assert.match(source, /mainWindow\.on\('close',[\s\S]*if \(isQuitting\) return[\s\S]*event\.preventDefault\(\)[\s\S]*mainWindow\.hide\(\)/)
  assert.match(source, /quitApp:\s*\(\) => app\.quit\(\)/)
  assert.match(source, /app\.on\('before-quit',[\s\S]*isQuitting = true/)
})
