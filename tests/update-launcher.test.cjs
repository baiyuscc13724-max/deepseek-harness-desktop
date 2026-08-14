const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildWindowsInstallerHandoff } = require('../electron/bridge/update-launcher.cjs')

test('installer handoff waits for the desktop process before starting Inno Setup', () => {
  const installerPath = path.resolve('C:\\Temp\\Harness Desktop updater.exe')
  const launch = buildWindowsInstallerHandoff({ installerPath, parentPid: 4321 })
  assert.equal(launch.command, 'powershell.exe')
  const script = launch.args.at(-1)
  assert.ok(script.indexOf('Wait-Process -Id 4321') < script.indexOf('Start-Process'))
  assert.match(script, /Harness Desktop updater\.exe/)
  assert.match(script, /\/CLOSEAPPLICATIONS/)
  assert.equal(launch.options.detached, true)
  assert.equal(launch.options.windowsHide, true)
})

test('installer handoff safely quotes apostrophes in file names', () => {
  const launch = buildWindowsInstallerHandoff({ installerPath: "C:\\Temp\\user's update.exe", parentPid: 1 })
  assert.match(launch.args.at(-1), /user''s update\.exe/)
})
