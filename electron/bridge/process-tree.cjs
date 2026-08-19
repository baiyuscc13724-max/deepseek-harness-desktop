const { spawn } = require('node:child_process')

function terminateProcessTree(child, {
  platform = process.platform,
  spawnImpl = spawn,
  killImpl = process.kill.bind(process),
  setTimeoutImpl = setTimeout
} = {}) {
  if (!child?.pid || child.exitCode != null) return false
  if (platform === 'win32') {
    spawnImpl('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    return true
  }
  const signalGroup = signal => {
    try { killImpl(-child.pid, signal) }
    catch { try { child.kill(signal) } catch {} }
  }
  signalGroup('SIGTERM')
  const timer = setTimeoutImpl(() => {
    if (child.exitCode == null) signalGroup('SIGKILL')
  }, 3000)
  timer?.unref?.()
  return true
}

module.exports = { terminateProcessTree }
