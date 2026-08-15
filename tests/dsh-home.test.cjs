const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { hasUserDataOverride, resolveDesktopDshHome } = require('../electron/bridge/dsh-home.cjs')

test('normal desktop launches retain the user DSH home', () => {
  const result = resolveDesktopDshHome({
    env: {},
    argv: ['Harness Desktop.exe'],
    home: 'C:\\Users\\Example',
    userData: 'C:\\Users\\Example\\AppData\\Roaming\\deepseek-harness-desktop'
  })
  assert.equal(result, path.resolve('C:\\Users\\Example', '.dsh'))
})

test('custom Electron profiles isolate their Harness sessions by default', () => {
  const userData = 'D:\\Harness\\.runtime-pet-test'
  const result = resolveDesktopDshHome({
    env: {},
    argv: ['electron.exe', `--user-data-dir=${userData}`, '.'],
    home: 'C:\\Users\\Example',
    userData
  })
  assert.equal(result, path.resolve(userData, 'dsh-home'))
  assert.equal(hasUserDataOverride(['electron.exe', '--user-data-dir', userData, '.']), true)
})

test('an explicit DSH_HOME remains authoritative for advanced launches', () => {
  const explicit = 'E:\\isolated-dsh'
  const result = resolveDesktopDshHome({
    env: { DSH_HOME: `  ${explicit}  ` },
    argv: ['electron.exe', '--user-data-dir=D:\\profile', '.'],
    home: 'C:\\Users\\Example',
    userData: 'D:\\profile'
  })
  assert.equal(result, path.resolve(explicit))
})
