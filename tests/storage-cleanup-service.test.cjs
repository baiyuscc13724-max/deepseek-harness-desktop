const test = require('node:test')
const assert = require('node:assert/strict')
const { access, mkdir, utimes, writeFile } = require('node:fs/promises')
const path = require('node:path')

const { StorageCleanupService, isCurrentRuntime, parseRuntimeDirName } = require('../electron/bridge/storage-cleanup-service.cjs')
const { buildHarnessData, destroyHarnessData } = require('./harness-data-fixture.cjs')

// 使用真实时钟，便于结合 utimes 控制文件年龄。
function makeService(version = '1.0.23') {
  return { service: new StorageCleanupService({ now: Date.now, version, platform: 'win32', arch: 'x64' }) }
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

// 把目录及其内容的 mtime 回拨到很久以前，模拟「过期」条目。
async function backdate(p) {
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  await utimes(p, old, old)
}

test('parseRuntimeDirName extracts version/platform/arch', () => {
  assert.deepEqual(parseRuntimeDirName('1.0.23-win32-x64'), { version: '1.0.23', platform: 'win32', arch: 'x64' })
  assert.equal(parseRuntimeDirName('not-a-runtime'), null)
  assert.equal(parseRuntimeDirName('1.0.23-win32'), null)
  assert.equal(isCurrentRuntime('1.0.23-win32-x64', { version: '1.0.23', platform: 'win32', arch: 'x64' }), true)
  assert.equal(isCurrentRuntime('1.0.20-win32-x64', { version: '1.0.23', platform: 'win32', arch: 'x64' }), false)
})

test('cleanup is dry-run by default and never deletes anything', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    const plan = await service.plan(fixture.root)
    assert.equal(plan.preview, true)
    // 应识别出旧 runtime 和 marketplace 会被清理。
    const kinds = plan.deletions.map(d => d.kind)
    assert.ok(kinds.includes('runtime-old'))
    assert.ok(kinds.includes('cache'))
    // 当前 runtime 不能出现在清理计划中。
    assert.ok(!plan.deletions.some(d => d.name === '1.0.23-win32-x64'))
    // 什么都不删。
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64', 'marker.txt')), true)
    assert.equal(await exists(path.join(fixture.homeDir, 'marketplace', 'cache', 'cache.db')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cleanup removes only old runtime and marketplace, keeps protected data', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    const plan = await service.plan(fixture.root, { preview: false })
    assert.equal(plan.preview, false)
    assert.ok(plan.applied.length >= 2)

    // 旧 runtime 被删，当前 runtime 保留。
    assert.equal(await exists(fixture.runDir + ''), true)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), false)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.23-win32-x64', 'marker.txt')), true)

    // 只删除 marketplace/cache，保留 Marketplace 设置和根目录。
    assert.equal(await exists(path.join(fixture.homeDir, 'marketplace', 'cache')), false)
    assert.equal(await exists(path.join(fixture.homeDir, 'marketplace', 'settings.json')), true)

    // 受保护的用户数据被保留。
    assert.equal(await exists(path.join(fixture.homeDir, 'sessions', 's1.json')), true)
    assert.equal(await exists(path.join(fixture.homeDir, 'attachments', 'a1.bin')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('temp entries are only cleaned when explicitly requested and past age threshold', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    // 没有显式传入 -> 即使预览关闭也不清 temp。
    const planNoTemp = await service.plan(fixture.root, { preview: false })
    assert.ok(!planNoTemp.deletions.some(d => d.kind === 'temp'))
    assert.equal(await exists(path.join(fixture.tempDir, 'dsh-spill-OLD1')), true)

    // 显式传入、条目是新鲜的（低于年龄阈值）-> 不清。
    const planTooNew = await service.plan(fixture.root, {
      preview: false,
      tempEntries: ['dsh-spill-OLD1'],
      tempAgeMs: 10 * 24 * 60 * 60 * 1000 // 10 天
    })
    assert.equal(planTooNew.deletions.filter(d => d.kind === 'temp').length, 0)
    assert.equal(await exists(path.join(fixture.tempDir, 'dsh-spill-OLD1')), true)

    // 目录本身很旧但内部文件仍活跃时不得清理。
    const oldTempDir = path.join(fixture.tempDir, 'dsh-spill-OLD1')
    await backdate(oldTempDir)
    const planActive = await service.plan(fixture.root, {
      preview: false,
      tempEntries: ['dsh-spill-OLD1'],
      tempAgeMs: 1 * 24 * 60 * 60 * 1000
    })
    assert.ok(!planActive.deletions.some(d => d.kind === 'temp'))

    // 目录和内部最新文件都超过阈值后才允许清除。
    await backdate(path.join(oldTempDir, 'x'))
    await backdate(oldTempDir)
    const planOld = await service.plan(fixture.root, {
      preview: false,
      tempEntries: ['dsh-spill-OLD1'],
      tempAgeMs: 1 * 24 * 60 * 60 * 1000 // 1 天；条目已回拨 30 天，远超阈值
    })
    assert.ok(planOld.deletions.some(d => d.kind === 'temp' && d.name === 'dsh-spill-OLD1'))
    assert.equal(await exists(path.join(fixture.tempDir, 'dsh-spill-OLD1')), false)
    // 未列出的 temp 条目保留。
    assert.equal(await exists(path.join(fixture.tempDir, 'fresh')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cleanup plans never include protected sessions/attachments', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    const plan = await service.plan(fixture.root, { preview: false })
    for (const d of plan.deletions) {
      const base = path.basename(d.path).toLowerCase()
      assert.ok(!['sessions', 'attachments', 'memories'].includes(base), `should not delete ${d.path}`)
    }
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('symlink-escape sibling dirs are never deleted', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    // 构造一个指向根外部的符号链接条目（在 temp 下，避免影响其它测试）。
    const outside = path.join(fixture.root, '..', 'harness-link-target-escape')
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(outside, 'x'), 'outside')
    const linkTarget = path.join(fixture.tempDir, 'escape-link')
    try {
      const { symlink } = require('node:fs/promises')
      await symlink(outside, linkTarget, 'junction')
    } catch {
      return // 无法建链接的环境跳过此断言
    }
    const plan = await service.plan(fixture.root, {
      preview: false,
      tempEntries: ['escape-link'],
      tempAgeMs: 0
    })
    // 符号链接条目本身不应被删除。
    assert.equal(await exists(linkTarget), true)
    void plan
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cleanup refuses to delete the HarnessData root itself', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    // 模拟 root 被当成 temp 条目传入：不应把根目录删掉。
    const plan = await service.plan(fixture.root, {
      preview: false,
      tempEntries: [path.basename(fixture.root)],
      tempAgeMs: 1
    })
    assert.equal(await exists(fixture.root), true)
    assert.ok(!plan.deletions.some(d => d.path === fixture.root))
  } finally {
    await destroyHarnessData(fixture.root)
  }
})
