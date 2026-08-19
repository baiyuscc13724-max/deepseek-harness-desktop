const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { desktopRuntimeEnvironment, hasUserDataOverride, resolveDesktopDshHome, resolveDesktopRuntimePaths } = require('../electron/bridge/dsh-home.cjs')

test('packaged Windows launches keep official Harness data beside the installed executable', { skip: process.platform !== 'win32' }, () => {
  const result = resolveDesktopRuntimePaths({
    env: {},
    argv: ['Harness Desktop.exe'],
    appPath: 'D:\\Apps\\Harness Desktop\\resources\\app.asar',
    executablePath: 'D:\\Apps\\Harness Desktop\\Harness Desktop.exe',
    isPackaged: true,
    platform: 'win32',
    userData: 'C:\\Users\\Example\\AppData\\Roaming\\deepseek-harness-desktop'
  })
  assert.deepEqual(result, {
    root: path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData'),
    dshHome: path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData', 'dsh-home'),
    workspace: path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData', 'workspace'),
    temp: path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData', 'temp')
  })
})

test('portable builds use the original executable directory instead of the extraction directory', { skip: process.platform !== 'win32' }, () => {
  const result = resolveDesktopDshHome({
    env: { PORTABLE_EXECUTABLE_DIR: 'E:\\Portable Apps\\Harness' },
    argv: ['Harness Desktop.exe'],
    appPath: 'C:\\Users\\Example\\AppData\\Local\\Temp\\portable\\resources\\app.asar',
    executablePath: 'C:\\Users\\Example\\AppData\\Local\\Temp\\portable\\Harness Desktop.exe',
    isPackaged: true,
    platform: 'win32',
    userData: 'C:\\Users\\Example\\AppData\\Roaming\\deepseek-harness-desktop'
  })
  assert.equal(result, path.resolve('E:\\Portable Apps\\Harness', 'HarnessData', 'dsh-home'))
})

test('packaged macOS builds keep writable Harness data in Application Support', () => {
  const userData = path.resolve('/Users/example/Library/Application Support/Harness Desktop')
  const paths = resolveDesktopRuntimePaths({
    argv: ['/Applications/Harness Desktop.app/Contents/MacOS/Harness Desktop'],
    appPath: '/Applications/Harness Desktop.app/Contents/Resources/app.asar',
    executablePath: '/Applications/Harness Desktop.app/Contents/MacOS/Harness Desktop',
    isPackaged: true,
    platform: 'darwin',
    store: false,
    userData
  })
  assert.equal(paths.root, path.join(userData, 'HarnessData'))
  assert.equal(paths.dshHome, path.join(userData, 'HarnessData', 'dsh-home'))
})

test('custom Electron profiles isolate their Harness sessions by default', { skip: process.platform !== 'win32' }, () => {
  const userData = 'D:\\Harness\\.runtime-pet-test'
  const result = resolveDesktopDshHome({
    env: {},
    argv: ['electron.exe', `--user-data-dir=${userData}`, '.'],
    appPath: 'D:\\Harness\\source',
    executablePath: 'D:\\Harness\\electron.exe',
    isPackaged: true,
    platform: 'win32',
    userData
  })
  assert.equal(result, path.resolve(userData, 'HarnessData', 'dsh-home'))
  assert.equal(hasUserDataOverride(['electron.exe', '--user-data-dir', userData, '.']), true)
  assert.equal(resolveDesktopDshHome({
    env: {}, argv: ['Harness Desktop.exe'], appPath: 'D:\\Harness\\source',
    executablePath: 'D:\\Harness\\Harness Desktop.exe', isPackaged: true, platform: 'win32',
    userData, userDataOverride: true
  }), path.resolve(userData, 'HarnessData', 'dsh-home'))
})

test('ambient DSH_HOME cannot redirect a normal packaged desktop launch back to C', { skip: process.platform !== 'win32' }, () => {
  const result = resolveDesktopDshHome({
    env: { DSH_HOME: 'C:\\Users\\Example\\.dsh' },
    argv: ['Harness Desktop.exe'],
    appPath: 'D:\\Apps\\Harness Desktop\\resources\\app.asar',
    executablePath: 'D:\\Apps\\Harness Desktop\\Harness Desktop.exe',
    isPackaged: true,
    platform: 'win32',
    userData: 'C:\\Users\\Example\\AppData\\Roaming\\deepseek-harness-desktop'
  })
  assert.equal(result, path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData', 'dsh-home'))
})

test('desktop runtime environment forces Harness and sandbox temporary data onto the install drive', { skip: process.platform !== 'win32' }, () => {
  const runtimePaths = resolveDesktopRuntimePaths({
    env: {},
    argv: ['Harness Desktop.exe'],
    appPath: 'D:\\Apps\\Harness Desktop\\resources\\app.asar',
    executablePath: 'D:\\Apps\\Harness Desktop\\Harness Desktop.exe',
    isPackaged: true,
    platform: 'win32',
    userData: 'C:\\Users\\Example\\AppData\\Roaming\\deepseek-harness-desktop'
  })
  const result = desktopRuntimeEnvironment({
    TEMP: 'C:\\Users\\Example\\AppData\\Local\\Temp',
    TMP: 'C:\\Windows\\Temp',
    DSH_HOME: 'C:\\Users\\Example\\.dsh',
    PRESERVED_VALUE: 'yes'
  }, runtimePaths)

  assert.equal(result.DSH_HOME, path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData', 'dsh-home'))
  assert.equal(result.TEMP, path.resolve('D:\\Apps\\Harness Desktop', 'HarnessData', 'temp'))
  assert.equal(result.TMP, result.TEMP)
  assert.equal(result.TMPDIR, result.TEMP)
  assert.equal(result.PRESERVED_VALUE, 'yes')
})

test('Store builds retain their writable application data boundary', { skip: process.platform !== 'win32' }, () => {
  const result = resolveDesktopRuntimePaths({
    env: {},
    argv: ['Harness Desktop.exe'],
    appPath: 'C:\\Program Files\\WindowsApps\\Harness\\app.asar',
    executablePath: 'C:\\Program Files\\WindowsApps\\Harness\\Harness Desktop.exe',
    isPackaged: true,
    platform: 'win32',
    store: true,
    userData: 'C:\\Users\\Example\\AppData\\Local\\Packages\\Harness\\LocalState'
  })
  assert.equal(result.root, path.resolve('C:\\Users\\Example\\AppData\\Local\\Packages\\Harness\\LocalState', 'HarnessData'))
})
