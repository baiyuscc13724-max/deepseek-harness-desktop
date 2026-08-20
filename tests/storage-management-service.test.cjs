const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFileSync } = require('node:fs')
const { access, mkdir, rm, utimes, writeFile } = require('node:fs/promises')

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

test('automatic maintenance aborts when an approved cache becomes active before deletion', async () => {
  const fixture = await buildHarnessData()
  try {
    const cache = path.join(fixture.homeDir, 'marketplace', 'cache')
    const blob = path.join(cache, 'cache.db')
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    await utimes(blob, old, old)
    await utimes(cache, old, old)
    const cleanup = new StorageCleanupService({ version: '1.0.24', platform: 'win32', arch: 'x64' })
    let calls = 0
    const cleanupService = {
      async plan(root, options) {
        const result = await cleanup.plan(root, options)
        calls += 1
        if (calls === 1) await writeFile(blob, 'active-cache')
        return result
      }
    }
    const service = serviceFor(fixture, { cleanup: cleanupService })
    const result = await service.maintainCaches()
    assert.equal(result.deletedEntries, 0)
    assert.equal(await exists(cache), true)
    assert.equal(calls, 2)
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
