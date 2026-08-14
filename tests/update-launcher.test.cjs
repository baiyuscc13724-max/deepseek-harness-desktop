const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { openWindowsInstaller } = require('../electron/bridge/update-launcher.cjs')

test('installer is opened directly through the Windows shell', async () => {
  const installerPath = path.resolve('C:\\Temp\\Harness Desktop updater.exe')
  const opened = []
  const result = await openWindowsInstaller({ installerPath, openPath: async value => {
    opened.push(value)
    return ''
  } })
  assert.deepEqual(opened, [installerPath])
  assert.equal(result.installerPath, installerPath)
})

test('installer launch failure is returned before the desktop exits', async () => {
  await assert.rejects(
    openWindowsInstaller({ installerPath: 'C:\\Temp\\update.exe', openPath: async () => 'Access denied' }),
    /Access denied/
  )
})
