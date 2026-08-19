const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  PROTECTED_BASENAMES,
  isProtectedName,
  resolveContained,
  runtimePaths,
  scanHarnessData
} = require('../electron/bridge/storage-scan-service.cjs')
const { addSymlinkEscape, buildHarnessData, destroyHarnessData } = require('./harness-data-fixture.cjs')

test('resolveContained allows inside and rejects escapes', () => {
  const root = 'C:\\HarnessData'
  assert.equal(resolveContained('C:\\HarnessData\\runtime', root), 'C:\\HarnessData\\runtime')
  assert.equal(resolveContained('C:\\HarnessData', root), root)
  // 穿越根目录。
  assert.equal(resolveContained('C:\\HarnessData\\..\\outside', root), null)
  // 绝对路径逃逸。
  assert.equal(resolveContained('C:\\Windows\\system32', root), null)
  // 相对路径指向根之外。
  assert.equal(resolveContained('..\\x', root), null)
})

test('runtimePaths build the expected HarnessData layout', () => {
  const paths = runtimePaths('C:\\HarnessData')
  assert.equal(paths.runtime, 'C:\\HarnessData\\runtime')
  assert.equal(paths.dshHome, 'C:\\HarnessData\\dsh-home')
  assert.equal(paths.temp, 'C:\\HarnessData\\temp')
  assert.equal(paths.workspace, 'C:\\HarnessData\\workspace')
})

test('protected basenames include user data subtrees', () => {
  assert.equal(isProtectedName('sessions'), true)
  assert.equal(isProtectedName('attachments'), true)
  assert.equal(isProtectedName('memories'), true)
  assert.equal(isProtectedName('runtime'), true)
  assert.equal(isProtectedName('marketplace'), false)
  assert.ok(PROTECTED_BASENAMES.has('sessions'))
  assert.ok(PROTECTED_BASENAMES.has('runtime'))
})

test('scanHarnessData classifies runtime/dsh-home/temp/workspace read-only', async () => {
  const fixture = await buildHarnessData()
  try {
    const report = await scanHarnessData(fixture.root)
    assert.equal(report.root, path.resolve(fixture.root))
    assert.equal(report.categories['runtime'].exists, true)
    assert.equal(report.categories['dsh-home'].exists, true)
    assert.equal(report.categories['temp'].exists, true)
    assert.equal(report.categories['workspace'].exists, true)

    // runtime 下有 2 个版本目录。
    const runtimeNames = report.categories['runtime'].entries.map(e => e.name).sort()
    assert.deepEqual(runtimeNames, ['1.0.20-win32-x64', '1.0.23-win32-x64'])
    assert.ok(report.categories['runtime'].size >= 2)

    // dsh-home 里 sessions/attachments 被标记受保护。
    const homeEntries = report.categories['dsh-home'].entries
    const sessions = homeEntries.find(e => e.name === 'sessions')
    const marketplace = homeEntries.find(e => e.name === 'marketplace')
    assert.equal(sessions.protected, true)
    assert.equal(marketplace.protected, false)
    assert.equal(sessions.size, '{"keep":true}'.length)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('scanHarnessData can limit to a single category', async () => {
  const fixture = await buildHarnessData()
  try {
    const report = await scanHarnessData(fixture.root, { categories: ['temp'] })
    assert.equal(report.categories['temp'].exists, true)
    assert.equal(report.categories['runtime'], undefined)
    assert.equal(report.categories['dsh-home'], undefined)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('symlink escape directories are flagged and their content not counted', async () => {
  const fixture = await buildHarnessData()
  const sym = await addSymlinkEscape(fixture.root, fixture.homeDir)
  try {
    const report = await scanHarnessData(fixture.root)
    const sneaky = report.categories['dsh-home'].entries.find(e => e.name === 'sneaky-link')
    if (sym) {
      assert.ok(sneaky, 'sneaky symlink should appear in scan')
      assert.equal(sneaky.suspicious, 'symlink-escape')
      assert.equal(sneaky.size, 0)
    } else {
      // 无法创建符号链接的平台：确保扫描仍能正常完成。
      assert.ok(report.categories['dsh-home'].exists)
    }
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('scanning a missing root reports not-exists, does not throw', async () => {
  const missing = path.join(process.cwd(), 'definitely-missing-dir-xyz')
  const report = await scanHarnessData(missing)
  assert.equal(report.categories['runtime'].exists, false)
  assert.equal(report.categories['runtime'].size, 0)
})
