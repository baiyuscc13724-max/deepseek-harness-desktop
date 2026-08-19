const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { openDesktopInstaller, openWindowsInstaller } = require('../electron/bridge/update-launcher.cjs')

test('installer is opened directly through the Windows shell', async () => {
  const installerPath = path.resolve('C:\\Temp\\Harness Desktop updater.exe')
  const currentInstallDir = path.resolve('D:\\Apps\\Harness Desktop')
  const opened = []
  const hints = []
  const result = await openWindowsInstaller({
    installerPath,
    currentInstallDir,
    writeInstallHint: async (target, value) => hints.push([target, value]),
    openPath: async value => {
      opened.push(value)
      return ''
    }
  })
  assert.deepEqual(opened, [installerPath])
  assert.deepEqual(hints, [[`${installerPath}.install-dir`, currentInstallDir]])
  assert.equal(result.installerPath, installerPath)
  assert.equal(result.installDir, currentInstallDir)
})

test('macOS DMG is opened without writing a Windows install-directory hint', async () => {
  const installerPath = path.resolve('/tmp/Harness Desktop-1.0.24-mac-arm64.dmg')
  const opened = []
  const writes = []
  const result = await openDesktopInstaller({
    installerPath,
    currentInstallDir: '/Applications',
    platform: 'darwin',
    writeInstallHint: async (...args) => writes.push(args),
    openPath: async value => { opened.push(value); return '' }
  })
  assert.deepEqual(opened, [installerPath])
  assert.deepEqual(writes, [])
  assert.equal(result.installDir, '')
  assert.equal(result.hintPath, '')
})

test('installer launch failure is returned before the desktop exits', async () => {
  await assert.rejects(
    openWindowsInstaller({ installerPath: 'C:\\Temp\\update.exe', openPath: async () => 'Access denied' }),
    /Access denied/
  )
})

test('a manual installer launch without a packaged location remains supported', async () => {
  const writes = []
  const result = await openWindowsInstaller({
    installerPath: 'C:\\Temp\\update.exe',
    currentInstallDir: '',
    writeInstallHint: async (...args) => writes.push(args),
    openPath: async () => ''
  })
  assert.deepEqual(writes, [])
  assert.equal(result.installDir, '')
})
