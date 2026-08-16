const path = require('node:path')
const { writeFile } = require('node:fs/promises')

async function openWindowsInstaller({ installerPath, currentInstallDir, openPath, writeInstallHint = writeFile }) {
  const resolved = path.resolve(String(installerPath || ''))
  if (!path.isAbsolute(resolved) || !/\.exe$/i.test(resolved)) throw new Error('更新安装包路径无效。')
  if (typeof openPath !== 'function') throw new Error('Windows 安装程序启动器不可用。')

  const installDir = String(currentInstallDir || '').trim()
  const hintPath = `${resolved}.install-dir`
  if (path.isAbsolute(installDir)) await writeInstallHint(hintPath, installDir, { encoding: 'utf8', mode: 0o600 })

  const error = String(await openPath(resolved) || '').trim()
  if (error) throw new Error(`无法启动更新安装程序：${error}`)
  return { installerPath: resolved, installDir: path.isAbsolute(installDir) ? installDir : '', hintPath }
}

module.exports = { openWindowsInstaller }
