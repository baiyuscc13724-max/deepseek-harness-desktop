const path = require('node:path')
const { writeFile } = require('node:fs/promises')

async function openDesktopInstaller({ installerPath, currentInstallDir, platform = process.platform, openPath, writeInstallHint = writeFile }) {
  const resolved = path.resolve(String(installerPath || ''))
  const supported = platform === 'win32' ? /\.exe$/i.test(resolved) : platform === 'darwin' ? /\.(?:dmg|zip)$/i.test(resolved) : false
  if (!path.isAbsolute(resolved) || !supported) throw new Error('更新安装包路径无效。')
  if (typeof openPath !== 'function') throw new Error('桌面安装程序启动器不可用。')

  const installDir = String(currentInstallDir || '').trim()
  const hintPath = `${resolved}.install-dir`
  if (platform === 'win32' && path.isAbsolute(installDir)) await writeInstallHint(hintPath, installDir, { encoding: 'utf8', mode: 0o600 })

  const error = String(await openPath(resolved) || '').trim()
  if (error) throw new Error(`无法启动更新安装程序：${error}`)
  return { installerPath: resolved, installDir: platform === 'win32' && path.isAbsolute(installDir) ? installDir : '', hintPath: platform === 'win32' ? hintPath : '' }
}

async function openWindowsInstaller(options) {
  return openDesktopInstaller({ ...options, platform: 'win32' })
}

module.exports = { openDesktopInstaller, openWindowsInstaller }
