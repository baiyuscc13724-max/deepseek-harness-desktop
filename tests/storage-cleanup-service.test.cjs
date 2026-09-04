const test = require('node:test')
const assert = require('node:assert/strict')
const { access, lstat, mkdir, realpath, readdir, rm, symlink, utimes, writeFile } = require('node:fs/promises')
const path = require('node:path')

const {
  StorageCleanupService,
  areCachePlansEquivalent,
  isCurrentRuntime,
  parseRuntimeDirName
} = require('../electron/bridge/storage-cleanup-service.cjs')
const { buildHarnessData, destroyHarnessData } = require('./harness-data-fixture.cjs')

// 使用真实时钟，便于结合 utimes 控制文件年龄。
function makeService(version = '1.0.23') {
  return { service: new StorageCleanupService({ now: Date.now, version, platform: 'win32', arch: 'x64' }) }
}

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

function createTrackingFs(accesses) {
  const operations = { lstat, readdir, realpath }
  return Object.fromEntries(Object.entries(operations).map(([operation, implementation]) => [
    operation,
    async (target, ...args) => {
      accesses.push({ operation, target: path.resolve(String(target)) })
      return implementation(target, ...args)
    }
  ]))
}

function isWithin(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function applyPlan(service, root, options = {}) {
  const preview = await service.plan(root, { ...options, preview: true })
  return service.plan(root, { ...options, preview: false, approvedCandidates: preview.deletions })
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

test('cleanup planner prunes the current runtime before filesystem access', async () => {
  const fixture = await buildHarnessData()
  const accesses = []
  const currentRuntime = path.join(fixture.runDir, '1.0.23-win32-x64')
  const service = new StorageCleanupService({
    now: Date.now,
    version: '1.0.23',
    platform: 'win32',
    arch: 'x64',
    scanFs: createTrackingFs(accesses)
  })
  try {
    const plan = await service.plan(fixture.root, {
      preview: true,
      includeOldRuntimes: true,
      includeCaches: false,
      tempEntries: []
    })
    assert.ok(plan.deletions.some(candidate => candidate.name === '1.0.20-win32-x64'))
    assert.equal(plan.deletions.some(candidate => candidate.name === '1.0.23-win32-x64'), false)
    assert.deepEqual(accesses.filter(access => isWithin(access.target, currentRuntime)), [])
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('destructive cleanup refuses to run without a confirmed preview snapshot', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    await assert.rejects(service.plan(fixture.root, { preview: false }), /预览快照/)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cleanup removes only old runtime and marketplace, keeps protected data', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    const plan = await applyPlan(service, fixture.root)
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
    const planNoTemp = await applyPlan(service, fixture.root)
    assert.ok(!planNoTemp.deletions.some(d => d.kind === 'temp'))
    assert.equal(await exists(path.join(fixture.tempDir, 'dsh-spill-OLD1')), true)

    // 显式传入、条目是新鲜的（低于年龄阈值）-> 不清。
    const planTooNew = await applyPlan(service, fixture.root, {
      tempEntries: ['dsh-spill-OLD1'],
      tempAgeMs: 10 * 24 * 60 * 60 * 1000 // 10 天
    })
    assert.equal(planTooNew.deletions.filter(d => d.kind === 'temp').length, 0)
    assert.equal(await exists(path.join(fixture.tempDir, 'dsh-spill-OLD1')), true)

    // 目录本身很旧但内部文件仍活跃时不得清理。
    const oldTempDir = path.join(fixture.tempDir, 'dsh-spill-OLD1')
    await backdate(oldTempDir)
    const planActive = await applyPlan(service, fixture.root, {
      tempEntries: ['dsh-spill-OLD1'],
      tempAgeMs: 1 * 24 * 60 * 60 * 1000
    })
    assert.ok(!planActive.deletions.some(d => d.kind === 'temp'))

    // 目录和内部最新文件都超过阈值后才允许清除。
    await backdate(path.join(oldTempDir, 'x'))
    await backdate(oldTempDir)
    const planOld = await applyPlan(service, fixture.root, {
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
    const plan = await applyPlan(service, fixture.root)
    for (const d of plan.deletions) {
      const base = path.basename(d.path).toLowerCase()
      assert.ok(!['sessions', 'attachments', 'memories'].includes(base), `should not delete ${d.path}`)
    }
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cache read failure is fail-closed in both legacy and cache-only planners', async () => {
  const fixture = await buildHarnessData()
  const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
  const scanFs = {
    lstat,
    realpath,
    async readdir(target, ...args) {
      if (path.resolve(target) === path.resolve(cache)) throw new Error('injected EACCES')
      return readdir(target, ...args)
    }
  }
  const service = new StorageCleanupService({
    now: Date.now,
    version: '1.0.23',
    platform: 'win32',
    arch: 'x64',
    scanFs
  })
  try {
    const options = {
      preview: true,
      includeOldRuntimes: false,
      includeCaches: true,
      cacheMinAgeMs: 0,
      tempEntries: [],
      referenceNowMs: Date.now()
    }
    const legacy = await service.plan(fixture.root, options)
    const constrainedLegacy = await service.planCacheOnlyLegacy(fixture.root, options)
    const cacheOnly = await service.planCacheOnly(fixture.root, options)
    assert.equal(legacy.deletions.some(candidate => candidate.path === cache), false)
    assert.equal(constrainedLegacy.deletions.some(candidate => candidate.path === cache), false)
    assert.equal(cacheOnly.deletions.some(candidate => candidate.path === cache), false)
    assert.equal(await exists(path.join(cache, 'cache.db')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cache-only preview is canonically equivalent to the legacy safety planner', async () => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  try {
    const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
    const directCache = path.join(fixture.homeDir, 'caches')
    await mkdir(directCache, { recursive: true })
    await writeFile(path.join(directCache, 'cache.bin'), 'cache')
    await backdate(path.join(cache, 'cache.db'))
    await backdate(cache)
    await backdate(path.join(directCache, 'cache.bin'))
    await backdate(directCache)
    const options = {
      preview: true,
      includeOldRuntimes: false,
      includeCaches: true,
      cacheMinAgeMs: 7 * 24 * 60 * 60 * 1000,
      tempEntries: [],
      referenceNowMs: Date.now()
    }
    const legacy = await service.plan(fixture.root, options)
    const constrainedLegacy = await service.planCacheOnlyLegacy(fixture.root, options)
    const cacheOnly = await service.planCacheOnly(fixture.root, options)
    assert.equal(legacy.deletions.length, 2)
    assert.equal(constrainedLegacy.deletions.length, 2)
    assert.equal(cacheOnly.deletions.length, 2)
    assert.ok(cacheOnly.deletions[0].identity.canonicalPath)
    assert.equal(areCachePlansEquivalent(legacy, constrainedLegacy), true)
    assert.equal(areCachePlansEquivalent(constrainedLegacy, cacheOnly), true)

    const ageDrift = {
      ...cacheOnly,
      deletions: cacheOnly.deletions.map((candidate, index) => index === 0
        ? { ...candidate, ageMs: candidate.ageMs + 1 }
        : candidate)
    }
    assert.equal(areCachePlansEquivalent(constrainedLegacy, ageDrift), false)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cache-only planner rejects cache symlink/reparse targets inside the root', async t => {
  const fixture = await buildHarnessData()
  const { service } = makeService()
  const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
  try {
    await rm(cache, { recursive: true, force: true })
    try {
      await symlink(path.join(fixture.homeDir, 'sessions'), cache, 'junction')
    } catch {
      t.skip('当前平台无法创建 junction/symlink fixture')
      return
    }
    const options = {
      preview: true,
      includeOldRuntimes: false,
      includeCaches: true,
      cacheMinAgeMs: 0,
      tempEntries: [],
      referenceNowMs: Date.now()
    }
    const legacy = await service.plan(fixture.root, options)
    const constrainedLegacy = await service.planCacheOnlyLegacy(fixture.root, options)
    const cacheOnly = await service.planCacheOnly(fixture.root, options)
    assert.equal(legacy.deletions.some(candidate => candidate.path === cache), false)
    assert.equal(constrainedLegacy.deletions.some(candidate => candidate.path === cache), false)
    assert.equal(cacheOnly.deletions.some(candidate => candidate.path === cache), false)
    assert.equal(await exists(path.join(fixture.homeDir, 'sessions', 's1.json')), true)
    assert.equal(await exists(cache), true)
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
    const plan = await applyPlan(service, fixture.root, {
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
    const plan = await applyPlan(service, fixture.root, {
      tempEntries: [path.basename(fixture.root)],
      tempAgeMs: 1
    })
    assert.equal(await exists(fixture.root), true)
    assert.ok(!plan.deletions.some(d => d.path === fixture.root))
  } finally {
    await destroyHarnessData(fixture.root)
  }
})
