const path = require('node:path')

async function openWindowsInstaller({ installerPath, openPath }) {
  const resolved = path.resolve(String(installerPath || ''))
  if (!path.isAbsolute(resolved) || !/\.exe$/i.test(resolved)) throw new Error('更新安装包路径无效。')
  if (typeof openPath !== 'function') throw new Error('Windows 安装程序启动器不可用。')

  const error = String(await openPath(resolved) || '').trim()
  if (error) throw new Error(`无法启动更新安装程序：${error}`)
  return { installerPath: resolved }
}

module.exports = { openWindowsInstaller }
