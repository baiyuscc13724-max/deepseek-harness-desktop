function createDesktopTray({ Tray, Menu, nativeImage, iconPath, showMainWindow, hideMainWindow, quitApp, platform = process.platform }) {
  const source = nativeImage.createFromPath(iconPath)
  const icon = ['win32', 'darwin'].includes(platform) && !source.isEmpty()
    ? source.resize({ width: platform === 'darwin' ? 18 : 16, height: platform === 'darwin' ? 18 : 16 })
    : source
  if (platform === 'darwin' && typeof icon.setTemplateImage === 'function') icon.setTemplateImage(true)
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
