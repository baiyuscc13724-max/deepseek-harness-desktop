const path = require('node:path')

function quotePowerShellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function buildWindowsInstallerHandoff({ installerPath, parentPid }) {
  const resolved = path.resolve(String(installerPath || ''))
  if (!path.isAbsolute(resolved) || !/\.exe$/i.test(resolved)) throw new Error('更新安装包路径无效。')
  if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error('桌面进程编号无效。')
  const installer = quotePowerShellLiteral(resolved)
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `Wait-Process -Id ${parentPid} -ErrorAction SilentlyContinue`,
    `Start-Sleep -Milliseconds 700`,
    `Start-Process -FilePath ${installer} -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/CLOSEAPPLICATIONS')`
  ].join('; ')
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script],
    options: { detached: true, stdio: 'ignore', windowsHide: true }
  }
}

module.exports = { buildWindowsInstallerHandoff, quotePowerShellLiteral }
