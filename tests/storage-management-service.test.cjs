const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { access, mkdir, rm, writeFile } = require('node:fs/promises')

const {
  PREVIEW_TTL_MS,
  StorageManagementService,
  sanitizeOptions
} = require('../electron/bridge/storage-management-service.cjs')
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
    tempAgeDays: 999,
    tempEntries: ['safe', '../escape', 'safe', '', 'also-safe']
  })
  assert.deepEqual(options.tempEntries, ['safe', 'also-safe'])
  assert.equal(options.tempAgeMs, 365 * 24 * 60 * 60 * 1000)
  assert.equal(options.includeOldRuntimes, false)
  assert.equal(options.includeCaches, true)
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
