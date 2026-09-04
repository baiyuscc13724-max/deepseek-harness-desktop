const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fsPromises = require('node:fs/promises')

const {
  PROTECTED_BASENAMES,
  isProtectedName,
  resolveContained,
  runtimePaths,
  scanCacheOnly,
  scanHarnessData,
  scanTree
} = require('../electron/bridge/storage-scan-service.cjs')
const { addSymlinkEscape, buildHarnessData, destroyHarnessData } = require('./harness-data-fixture.cjs')

function createTrackingFs(accesses) {
  return Object.fromEntries(['lstat', 'readdir', 'realpath', 'stat'].map(operation => [
    operation,
    async (target, ...args) => {
      accesses.push({ operation, target: path.resolve(String(target)) })
      return fsPromises[operation](target, ...args)
    }
  ]))
}

function isWithin(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

test('resolveContained allows inside and rejects escapes', () => {
  const root = path.resolve('HarnessData-fixture')
  assert.equal(resolveContained(path.join(root, 'runtime'), root), path.join(root, 'runtime'))
  assert.equal(resolveContained(root, root), root)
  // 穿越根目录。
  assert.equal(resolveContained(path.resolve(root, '..', 'outside'), root), null)
  // 绝对路径逃逸。
  assert.equal(resolveContained(path.resolve('other-root', 'system32'), root), null)
  // 相对路径指向根之外。
  assert.equal(resolveContained(path.join('..', 'x'), root), null)
})

test('runtimePaths build the expected HarnessData layout', () => {
  const root = path.resolve('HarnessData-fixture')
  const paths = runtimePaths(root)
  assert.equal(paths.runtime, path.join(root, 'runtime'))
  assert.equal(paths.dshHome, path.join(root, 'dsh-home'))
  assert.equal(paths.temp, path.join(root, 'temp'))
  assert.equal(paths.workspace, path.join(root, 'workspace'))
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

test('an explicit empty category list performs no filesystem scan', async () => {
  const fixture = await buildHarnessData()
  const accesses = []
  try {
    const report = await scanHarnessData(fixture.root, { categories: [], fs: createTrackingFs(accesses) })
    assert.deepEqual(report.categories, {})
    assert.equal(accesses.length, 0)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cache-only scan prunes protected/runtime/temp/workspace trees before access', async () => {
  const fixture = await buildHarnessData()
  const accesses = []
  const nestedProtected = path.join(fixture.homeDir, 'marketplace', 'cache', 'sessions')
  const memories = path.join(fixture.homeDir, 'memories')
  try {
    await fsPromises.mkdir(nestedProtected, { recursive: true })
    await fsPromises.writeFile(path.join(nestedProtected, 'never-read.json'), 'protected')
    await fsPromises.mkdir(memories, { recursive: true })
    await fsPromises.writeFile(path.join(memories, 'memory.json'), 'protected')

    const report = await scanCacheOnly(fixture.root, { fs: createTrackingFs(accesses) })
    assert.deepEqual(Object.keys(report.categories), ['dsh-home'])
    const cache = report.categories['dsh-home'].entries.find(entry => entry.name === 'marketplace/cache')
    assert.ok(cache)
    assert.equal(cache.protectedDescendant, true)

    const forbiddenRoots = [
      fixture.runDir,
      fixture.tempDir,
      fixture.wsDir,
      path.join(fixture.homeDir, 'sessions'),
      path.join(fixture.homeDir, 'attachments'),
      memories,
      nestedProtected
    ]
    const forbiddenAccesses = accesses.filter(access => forbiddenRoots.some(root => isWithin(access.target, root)))
    assert.deepEqual(forbiddenAccesses, [])
    assert.ok(accesses.some(access => isWithin(access.target, path.join(fixture.homeDir, 'marketplace', 'cache'))))
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('tree scan marks a budget-exhausted partial result as truncated', async () => {
  const fixture = await buildHarnessData()
  try {
    const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
    const result = await scanTree(cache, fixture.root, { remaining: 1 }, { pruneProtected: true })
    assert.equal(result.truncated, true)
    assert.equal(result.entryCount, 0)
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
