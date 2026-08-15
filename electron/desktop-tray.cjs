function createDesktopTray({ Tray, Menu, nativeImage, iconPath, showMainWindow, hideMainWindow, quitApp }) {
  const source = nativeImage.createFromPath(iconPath)
  const icon = process.platform === 'win32' && !source.isEmpty()
    ? source.resize({ width: 16, height: 16 })
    : source
  const tray = new Tray(icon)

  tray.setToolTip('Harness Desktop')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 Harness Desktop', click: showMainWindow },
    { label: '隐藏主窗口', click: hideMainWindow },
    { type: 'separator' },
    { label: '退出', click: quitApp }
  ]))
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  return tray
}

module.exports = { createDesktopTray }
