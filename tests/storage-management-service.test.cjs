const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const fsPromises = require('node:fs/promises')
const { access, mkdir, rm, utimes, writeFile } = fsPromises
const { performance } = require('node:perf_hooks')

const {
  PREVIEW_TTL_MS,
  StorageManagementService,
  sanitizeOptions
} = require('../electron/bridge/storage-management-service.cjs')
const { StorageCleanupService } = require('../electron/bridge/storage-cleanup-service.cjs')
const { buildHarnessData, destroyHarnessData } = require('./harness-data-fixture.cjs')

async function exists(target) {
  try { await access(target); return true } catch { return false }
}

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

function durationStats(samples) {
  const sorted = [...samples].sort((left, right) => left - right)
  const at = percentile => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)]
  return {
    n: sorted.length,
    medianMs: Number(at(0.5).toFixed(3)),
    p95Ms: Number(at(0.95).toFixed(3)),
    maxMs: Number(sorted.at(-1).toFixed(3))
  }
}

async function measureRuns(iterations, run) {
  const samples = []
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now()
    await run()
    samples.push(performance.now() - started)
  }
  return durationStats(samples)
}

async function buildLargeUnrelatedTrees(homeDir) {
  const roots = []
  for (let branch = 0; branch < 16; branch += 1) {
    const root = path.join(homeDir, `unrelated-history-${String(branch).padStart(2, '0')}`)
    const leaf = path.join(root, 'year', 'month', 'day')
    roots.push(root)
    await mkdir(leaf, { recursive: true })
    await Promise.all(Array.from({ length: 64 }, (_, file) =>
      writeFile(path.join(leaf, `record-${String(file).padStart(2, '0')}.json`), 'x'.repeat(256))))
  }
  return roots
}

function serviceFor(fixture, overrides = {}) {
  let sequence = 0
  return new StorageManagementService({
    root: fixture.root,
    version: '1.0.23',
    platform: 'win32',
    arch: 'x64',
    idFactory: () => `preview-${++sequence}`,
    ...overrides
  })
}

test('sanitizeOptions constrains temp names, age and cleanup categories', () => {
  const options = sanitizeOptions({
    includeOldRuntimes: false,
    includeCaches: true,
    cacheMinAgeMs: Number.MAX_SAFE_INTEGER,
    tempAgeDays: 999,
    tempEntries: ['safe', '../escape', 'safe', '', 'also-safe']
  })
  assert.deepEqual(options.tempEntries, ['safe', 'also-safe'])
  assert.equal(options.tempAgeMs, 365 * 24 * 60 * 60 * 1000)
  assert.equal(options.cacheMinAgeMs, 365 * 24 * 60 * 60 * 1000)
  assert.equal(options.includeOldRuntimes, false)
  assert.equal(options.includeCaches, true)
})

test('desktop repeats safe cache maintenance daily during long-running sessions', () => {
  const main = readFileSync(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  assert.match(main, /CACHE_MAINTENANCE_INTERVAL_MS = 24 \* 60 \* 60 \* 1000/)
  assert.match(main, /setInterval\(runManagedCacheMaintenance, CACHE_MAINTENANCE_INTERVAL_MS\)/)
  assert.match(main, /clearInterval\(cacheMaintenanceTimer\)/)
})

test('scan and preview are read-only and broker status never exposes its token', async () => {
  const fixture = await buildHarnessData()
  try {
    const service = serviceFor(fixture)
    const scan = await service.scan()
    assert.equal(scan.categories.runtime.exists, true)
    const preview = await service.preview({ includeOldRuntimes: true, includeCaches: true })
    assert.equal(preview.preview, true)
    assert.ok(preview.deletions.some(item => item.kind === 'runtime-old'))
    assert.ok(preview.deletions.some(item => item.kind === 'cache'))
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), true)
    assert.equal(service.status().broker.token, undefined)
    assert.equal(service.status().pendingPreviews, 1)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('apply requires a live preview and explicit user confirmation', async () => {
  const fixture = await buildHarnessData()
  try {
    const service = serviceFor(fixture)
    const preview = await service.preview({ includeOldRuntimes: true, includeCaches: false })
    await assert.rejects(service.apply(preview.previewId), /明确确认/)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), true)
    const result = await service.apply(preview.previewId, { confirmed: true })
    assert.equal(result.preview, false)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), false)
    assert.equal(await exists(path.join(fixture.homeDir, 'marketplace', 'cache')), true)
    await assert.rejects(service.apply(preview.previewId, { confirmed: true }), /不存在或已过期/)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('apply never deletes cleanup candidates that appeared after the confirmed preview', async () => {
  const fixture = await buildHarnessData()
  try {
    const service = serviceFor(fixture)
    const preview = await service.preview({ includeOldRuntimes: true, includeCaches: false })
    const appearedLater = path.join(fixture.runDir, '0.9.0-win32-x64')
    await mkdir(appearedLater, { recursive: true })
    await writeFile(path.join(appearedLater, 'new.txt'), 'not in preview')
    await service.apply(preview.previewId, { confirmed: true })
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), false)
    assert.equal(await exists(path.join(appearedLater, 'new.txt')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('apply skips a same-name target replaced after preview', async () => {
  const fixture = await buildHarnessData()
  try {
    const service = serviceFor(fixture)
    const target = path.join(fixture.runDir, '1.0.20-win32-x64')
    const preview = await service.preview({ includeOldRuntimes: true, includeCaches: false })
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await writeFile(path.join(target, 'replacement.txt'), 'replacement must survive')
    const result = await service.apply(preview.previewId, { confirmed: true })
    assert.equal(await exists(path.join(target, 'replacement.txt')), true)
    assert.equal(result.applied.some(item => item.path === target), false)
    assert.equal(JSON.stringify(result).includes('identity'), false)
    assert.equal(JSON.stringify(result).includes('observedMtimeMs'), false)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('automatic maintenance removes only aged application-owned caches', async () => {
  const fixture = await buildHarnessData()
  try {
    const service = serviceFor(fixture)
    const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
    const fresh = await service.maintainCaches()
    assert.equal(fresh.deletedEntries, 0)
    assert.equal(await exists(cache), true)
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(cache, old, old)
    const active = await service.maintainCaches()
    assert.equal(active.deletedEntries, 0)
    assert.equal(await exists(cache), true)
    await utimes(path.join(cache, 'cache.db'), old, old)
    await utimes(cache, old, old)
    const result = await service.maintainCaches()
    assert.equal(result.ok, true)
    assert.equal(result.deletedEntries, 1)
    assert.equal(await exists(cache), false)
    assert.equal(await exists(path.join(fixture.homeDir, 'marketplace', 'settings.json')), true)
    assert.equal(await exists(path.join(fixture.homeDir, 'sessions', 's1.json')), true)
    assert.equal(await exists(path.join(fixture.homeDir, 'attachments', 'a1.bin')), true)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), true)
    assert.equal(service.status().automaticCache.lastRun.deletedEntries, 1)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('first automatic shadow ignores large unrelated trees and returns before 50ms sync budget', async t => {
  const fixture = await buildHarnessData()
  const accesses = []
  const memories = path.join(fixture.homeDir, 'memories')
  try {
    await mkdir(memories, { recursive: true })
    await writeFile(path.join(memories, 'memory.json'), 'protected')
    const unrelatedRoots = await buildLargeUnrelatedTrees(fixture.homeDir)
    const cleanup = new StorageCleanupService({
      version: '1.0.23',
      platform: 'win32',
      arch: 'x64',
      scanFs: createTrackingFs(accesses)
    })
    const service = serviceFor(fixture, { cleanup })
    const syncStarted = performance.now()
    const pending = service.maintainCaches()
    const syncMs = performance.now() - syncStarted
    const result = await pending

    assert.ok(syncMs < 50, `automatic maintenance synchronous segment ${syncMs}ms exceeds 50ms`)
    assert.equal(result.ok, true)
    assert.equal(result.shadowCompared, true)
    assert.equal(result.planner, 'cache-only')
    assert.equal(service.status().automaticCache.planner, 'cache-only')
    const forbiddenRoots = [
      fixture.runDir,
      fixture.tempDir,
      fixture.wsDir,
      path.join(fixture.homeDir, 'sessions'),
      path.join(fixture.homeDir, 'attachments'),
      memories
    ]
    const forbiddenAccesses = accesses.filter(access => forbiddenRoots.some(root => isWithin(access.target, root)))
    const unrelatedAccesses = accesses.filter(access => unrelatedRoots.some(root => isWithin(access.target, root)))
    const marketplaceSettingsAccesses = accesses.filter(access => isWithin(access.target, path.join(fixture.homeDir, 'marketplace', 'settings.json')))
    assert.deepEqual(forbiddenAccesses, [])
    assert.deepEqual(unrelatedAccesses, [])
    assert.deepEqual(marketplaceSettingsAccesses, [])
    t.diagnostic(`automatic-cache-sync-budget ${JSON.stringify({ syncMs: Number(syncMs.toFixed(3)), protectedAccesses: forbiddenAccesses.length, unrelatedAccesses: unrelatedAccesses.length })}`)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('first automatic shadow records n=30 before/after latency on a large unrelated fixture', { timeout: 120_000 }, async t => {
  const fixture = await buildHarnessData()
  try {
    const unrelatedRoots = await buildLargeUnrelatedTrees(fixture.homeDir)
    const legacyCleanup = new StorageCleanupService({ version: '1.0.23', platform: 'win32', arch: 'x64' })
    const legacyOptions = {
      preview: true,
      includeOldRuntimes: false,
      includeCaches: true,
      cacheMinAgeMs: 7 * 24 * 60 * 60 * 1000,
      tempEntries: [],
      referenceNowMs: Date.now()
    }
    const before = await measureRuns(30, () => legacyCleanup.plan(fixture.root, legacyOptions))
    const after = await measureRuns(30, async () => {
      const cleanup = new StorageCleanupService({ version: '1.0.23', platform: 'win32', arch: 'x64' })
      const service = serviceFor(fixture, { cleanup })
      const result = await service.maintainCaches()
      assert.equal(result.ok, true)
      assert.equal(result.shadowCompared, true)
      assert.equal(result.planner, 'cache-only')
    })

    assert.equal(before.n, 30)
    assert.equal(after.n, 30)
    assert.ok(after.p95Ms < 5_000, `first automatic cache-only shadow p95 ${after.p95Ms}ms exceeds 5s`)
    assert.ok(after.medianMs <= before.medianMs, `expected first shadow median ${after.medianMs}ms <= broad legacy ${before.medianMs}ms`)
    assert.equal(await exists(path.join(fixture.homeDir, 'marketplace', 'cache', 'cache.db')), true)
    assert.equal(await exists(path.join(unrelatedRoots[0], 'year', 'month', 'day', 'record-00.json')), true)
    t.diagnostic(`automatic-cache-first-shadow-benchmark ${JSON.stringify({ fixture: { unrelatedRoots: unrelatedRoots.length, files: unrelatedRoots.length * 64, depth: 4 }, before, after })}`)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('shadow mismatch fails closed as preview-only without applying either plan', async () => {
  const fixture = await buildHarnessData()
  let destructiveCalls = 0
  let legacyCalls = 0
  let narrowCalls = 0
  const candidate = {
    kind: 'cache',
    name: 'marketplace/cache',
    path: path.join(fixture.homeDir, 'marketplace', 'cache'),
    size: 11,
    ageMs: 8 * 24 * 60 * 60 * 1000,
    identity: { canonicalPath: path.join(fixture.homeDir, 'marketplace', 'cache') }
  }
  const cleanup = {
    async plan() {
      throw new Error('automatic shadow must not call the broad planner')
    },
    async planCacheOnlyLegacy(root, options) {
      legacyCalls += 1
      if (options.preview === false) destructiveCalls += 1
      return { root, preview: options.preview !== false, deletions: [candidate], applied: null }
    },
    async planCacheOnly(root, options) {
      narrowCalls += 1
      if (options.preview === false) destructiveCalls += 1
      return { root, preview: options.preview !== false, deletions: [], applied: null }
    }
  }
  try {
    const service = serviceFor(fixture, { cleanup })
    const result = await service.maintainCaches()
    assert.equal(result.ok, false)
    assert.equal(result.previewOnly, true)
    assert.equal(result.planner, 'shadow')
    assert.equal(destructiveCalls, 0)
    assert.equal(legacyCalls, 1)
    assert.equal(narrowCalls, 1)
    assert.equal(service.status().automaticCache.planner, 'shadow-pending')
    assert.equal(await exists(candidate.path), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('equivalent shadow preview enables cache-only planner for later runs', async () => {
  const fixture = await buildHarnessData()
  let legacyCalls = 0
  let narrowCalls = 0
  const emptyPlan = (root, options) => ({ root, preview: options.preview !== false, deletions: [], applied: null })
  const cleanup = {
    async plan() {
      throw new Error('automatic shadow must not call the broad planner')
    },
    async planCacheOnlyLegacy(root, options) {
      legacyCalls += 1
      return emptyPlan(root, options)
    },
    async planCacheOnly(root, options) {
      narrowCalls += 1
      return emptyPlan(root, options)
    }
  }
  try {
    const service = serviceFor(fixture, { cleanup })
    const first = await service.maintainCaches()
    const second = await service.maintainCaches()
    assert.equal(first.shadowCompared, true)
    assert.equal(second.shadowCompared, false)
    assert.equal(second.planner, 'cache-only')
    assert.equal(legacyCalls, 1)
    assert.equal(narrowCalls, 2)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('one rollback flag keeps automatic maintenance on the legacy planner', async () => {
  const fixture = await buildHarnessData()
  let legacyCalls = 0
  let narrowCalls = 0
  const cleanup = {
    async plan() {
      throw new Error('automatic rollback must not call the broad planner')
    },
    async planCacheOnlyLegacy(root, options) {
      legacyCalls += 1
      return { root, preview: options.preview !== false, deletions: [], applied: null }
    },
    async planCacheOnly(root, options) {
      narrowCalls += 1
      return { root, preview: options.preview !== false, deletions: [], applied: null }
    }
  }
  try {
    const service = serviceFor(fixture, { cleanup, automaticCacheNarrowScan: false })
    const result = await service.maintainCaches()
    assert.equal(result.ok, true)
    assert.equal(result.planner, 'legacy')
    assert.equal(legacyCalls, 1)
    assert.equal(narrowCalls, 0)
    assert.equal(service.status().automaticCache.rollbackFlag, 'DSH_AUTO_CACHE_NARROW_SCAN=0')
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('automatic maintenance aborts when an approved cache becomes active before deletion', async () => {
  const fixture = await buildHarnessData()
  try {
    const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
    const blob = path.join(cache, 'cache.db')
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(blob, old, old)
    await utimes(cache, old, old)
    const cleanup = new StorageCleanupService({ version: '1.0.24', platform: 'win32', arch: 'x64' })
    let legacyCalls = 0
    let narrowCalls = 0
    const cleanupService = {
      async plan() {
        throw new Error('automatic maintenance must not call the broad planner')
      },
      async planCacheOnlyLegacy(root, options) {
        legacyCalls += 1
        return cleanup.planCacheOnlyLegacy(root, options)
      },
      async planCacheOnly(root, options) {
        const result = await cleanup.planCacheOnly(root, options)
        narrowCalls += 1
        if (narrowCalls === 1) await writeFile(blob, 'active-cache')
        return result
      }
    }
    const service = serviceFor(fixture, { cleanup: cleanupService })
    const result = await service.maintainCaches()
    assert.equal(result.deletedEntries, 0)
    assert.equal(await exists(cache), true)
    assert.equal(legacyCalls, 1)
    assert.equal(narrowCalls, 2)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('automatic maintenance never falls back to a broad planner when the constrained oracle is missing', async () => {
  const fixture = await buildHarnessData()
  let broadCalls = 0
  const cleanup = {
    async plan() {
      broadCalls += 1
      return { root: fixture.root, preview: true, deletions: [], applied: null }
    },
    async planCacheOnly() {
      return { root: fixture.root, preview: true, deletions: [], applied: null }
    }
  }
  try {
    const service = serviceFor(fixture, { cleanup })
    await assert.rejects(service.maintainCaches(), /缺少 constrained legacy oracle/)
    assert.equal(broadCalls, 0)
    const lastRun = service.status().automaticCache.lastRun
    assert.equal(lastRun.ok, false)
    assert.equal(lastRun.previewOnly, true)
    assert.equal(lastRun.planner, 'shadow')
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('cache-only planner crash fails closed and records preview-only status', async () => {
  const fixture = await buildHarnessData()
  const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
  const cleanup = {
    async plan() {
      throw new Error('automatic shadow must not call the broad planner')
    },
    async planCacheOnlyLegacy(root, options) {
      return { root, preview: options.preview !== false, deletions: [], applied: null }
    },
    async planCacheOnly() {
      throw new Error('injected cache-only scan crash')
    }
  }
  try {
    const service = serviceFor(fixture, { cleanup })
    await assert.rejects(service.maintainCaches(), /injected cache-only scan crash/)
    const lastRun = service.status().automaticCache.lastRun
    assert.equal(lastRun.ok, false)
    assert.equal(lastRun.previewOnly, true)
    assert.equal(lastRun.planner, 'shadow')
    assert.equal(await exists(cache), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})

test('expired previews cannot be applied', async () => {
  const fixture = await buildHarnessData()
  let now = Date.now()
  try {
    const service = serviceFor(fixture, { now: () => now })
    const preview = await service.preview()
    now += PREVIEW_TTL_MS + 1
    await assert.rejects(service.apply(preview.previewId, { confirmed: true }), /不存在或已过期/)
    assert.equal(await exists(path.join(fixture.runDir, '1.0.20-win32-x64')), true)
  } finally {
    await destroyHarnessData(fixture.root)
  }
})
