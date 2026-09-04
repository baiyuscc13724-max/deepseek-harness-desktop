const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { access, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } = require('node:fs/promises')
const {
  ComputerUseScreenshotStore,
  SCREENSHOT_FILE,
  SCREENSHOT_GC_FLAG,
  computerUseScreenshotDirectory,
  gcFlagEnabled
} = require('../electron/bridge/computer-use-screenshot-store.cjs')

async function names(directory) {
  return readdir(directory).then(rows => rows.sort()).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))
}

async function managed(directory) {
  return (await names(directory)).filter(file => SCREENSHOT_FILE.test(file))
}

async function quarantine(directory) {
  return (await names(path.join(path.dirname(directory), 'quarantine'))).filter(file => file.endsWith('.quarantine'))
}

async function isolated(prefix, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('clearing an unused Computer Use session creates no directory', () => isolated('computer-use-empty-', async root => {
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const store = new ComputerUseScreenshotStore({ directory })
  assert.deepEqual(await store.clear(), { deletedFiles: 0, deletedBytes: 0, retainedFiles: 0, retainedBytes: 0 })
  await assert.rejects(() => access(directory), error => error?.code === 'ENOENT')
}))

test('only the normalized preview namespace is GC eligible; evidence, legacy, and unknown roots are immutable', () => isolated('computer-use-namespaces-', async root => {
  const evidenceDirectory = computerUseScreenshotDirectory(root, 'evidence')
  const previewDirectory = computerUseScreenshotDirectory(root, 'preview')
  const legacyDirectory = path.join(root, 'computer-use', 'screenshots')
  const unknownDirectory = path.join(root, 'screenshots')
  assert.throws(() => computerUseScreenshotDirectory(root, '../evidence'), /命名空间无效/)

  const evidence = new ComputerUseScreenshotStore({ directory: evidenceDirectory })
  const preview = new ComputerUseScreenshotStore({ directory: previewDirectory, tokenTtlMs: 1, gcSafetyMs: 1 })
  const legacy = new ComputerUseScreenshotStore({ directory: legacyDirectory })
  const unknown = new ComputerUseScreenshotStore({ directory: unknownDirectory })
  await evidence.save(Buffer.from('evidence'), { now: 1700000000000 })
  await preview.save(Buffer.from('preview'), { now: 1700000000001 })
  await mkdir(legacyDirectory, { recursive: true })
  await mkdir(unknownDirectory, { recursive: true })
  await writeFile(path.join(legacyDirectory, 'window-1700000000002-abcdef01.png'), 'legacy')
  await writeFile(path.join(unknownDirectory, 'window-1700000000003-abcdef02.png'), 'unknown')
  await assert.rejects(() => legacy.save(Buffer.from('blocked')), /只读/)
  await assert.rejects(() => unknown.save(Buffer.from('blocked')), /只读/)

  assert.equal((await evidence.clear()).authoritative, true)
  assert.equal((await legacy.clear()).authoritative, true)
  assert.equal((await unknown.clear()).gcDisabledReason, 'unknown-namespace')
  assert.equal((await managed(evidenceDirectory)).length, 1)
  assert.equal((await managed(legacyDirectory)).length, 1)
  assert.equal((await managed(unknownDirectory)).length, 1)
  assert.equal((await managed(previewDirectory)).length, 1)

  const external = path.join(root, 'external-preview')
  const linkedPreview = computerUseScreenshotDirectory(path.join(root, 'linked-root'), 'preview')
  await mkdir(external, { recursive: true })
  await writeFile(path.join(external, 'window-1700000000000-external.png'), 'outside')
  await mkdir(path.dirname(linkedPreview), { recursive: true })
  await symlink(external, linkedPreview, process.platform === 'win32' ? 'junction' : 'dir')
  const linked = new ComputerUseScreenshotStore({ directory: linkedPreview })
  assert.equal((await linked.prune()).namespaceInvalid, true)
  await assert.rejects(() => linked.save(Buffer.from('blocked')), /命名空间结构无效/)
  assert.equal((await readFile(path.join(external, 'window-1700000000000-external.png'), 'utf8')), 'outside')
}))

test('the exact rollback flag is default-on and disables every quarantine/delete/restore mutation', () => isolated('computer-use-flag-', async root => {
  assert.equal(SCREENSHOT_GC_FLAG, 'HARNESS_DESKTOP_PREVIEW_SAFE_GC')
  assert.equal(gcFlagEnabled({}), true)
  assert.equal(gcFlagEnabled({ [SCREENSHOT_GC_FLAG]: 'true' }), true)
  for (const value of ['0', 'false', 'off', 'OFF']) assert.equal(gcFlagEnabled({ [SCREENSHOT_GC_FLAG]: value }), false)

  let now = 1700000000000
  let enabled = true
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const store = new ComputerUseScreenshotStore({ directory, now: () => now, gcEnabled: () => enabled, maxFiles: 1, tokenTtlMs: 1, gcSafetyMs: 1, quarantineDelayMs: 2 })
  const first = await store.save(Buffer.from('first'), { now })
  now += 1
  await store.save(Buffer.from('second'), { now })
  assert.equal((await quarantine(directory)).length, 1)

  now += 3
  enabled = false
  now += 100
  const disabled = await store.prune()
  assert.equal(disabled.featureDisabled, true)
  assert.equal((await quarantine(directory)).length, 1)
  await store.recordReference(first, { kind: 'history', id: 'late-history' }, { now })
  assert.equal((await quarantine(directory)).length, 1, 'feature-off must not restore')
  assert.equal((await store.read(first)).toString(), 'first', 'feature-off quarantine stays readable without a move')
  await store.clear()
  assert.equal((await quarantine(directory)).length, 1, 'feature-off Stop must preserve quarantine')

  enabled = true
  assert.equal((await store.prune()).restoredFiles, 0, 'first post-change pass only verifies quarantine identity')
  assert.equal((await store.prune()).restoredFiles, 1)
  assert.equal((await readFile(first)).toString(), 'first')
  assert.equal((await quarantine(directory)).length, 0)
}))

test('preview GC uses shadow index, quarantine, then a later physical-delete pass', () => isolated('computer-use-lifecycle-', async root => {
  let now = 1700000000000
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const store = new ComputerUseScreenshotStore({
    directory,
    now: () => now,
    runtimeId: 'boot-a',
    maxFiles: 2,
    maxBytes: 100,
    maxFileBytes: 50,
    maxAgeMs: 10_000,
    tokenTtlMs: 10,
    gcSafetyMs: 10,
    quarantineDelayMs: 20
  })
  await store.save(Buffer.from('one'), { now })
  assert.equal((await quarantine(directory)).length, 0, 'first pass only builds the shadow view')
  now += 1
  await store.save(Buffer.from('two'), { now })
  now += 1
  const newest = await store.save(Buffer.from('three'), { now })
  assert.equal((await managed(directory)).length, 2)
  assert.equal((await quarantine(directory)).length, 1, 'a file observed by prior passes may now quarantine')
  assert.ok((await managed(directory)).some(file => newest.endsWith(file)))

  now = 1700000000021
  assert.equal((await store.prune()).deletedFiles, 0)
  now += 1
  assert.equal((await store.clear()).deletedFiles, 0, 'Stop only quarantines and remains reversible')
  assert.equal((await quarantine(directory)).length, 3)
  assert.equal((await managed(directory)).length, 0)
  assert.equal((await store.prune()).deletedFiles, 1)
  assert.equal((await quarantine(directory)).length, 2)
  now += 20
  assert.equal((await store.prune()).deletedFiles, 2)
  assert.equal((await quarantine(directory)).length, 0)
}))

test('token renewal, expiry plus safety margin, and late history restore have no dangling references', () => isolated('computer-use-references-', async root => {
  let now = 1700000000000
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const store = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'refs', maxFiles: 1, tokenTtlMs: 10, gcSafetyMs: 10, quarantineDelayMs: 100 })
  const protectedFile = await store.save(Buffer.from('protected'), { now })
  await assert.rejects(() => store.recordReference(protectedFile, { kind: 'unknown', id: 'bad' }, { now }), /引用类型无效/)
  await store.recordReference(protectedFile, { kind: 'token', id: 'capability', expiresAt: now + 20 }, { now })
  now += 1
  await store.save(Buffer.from('newer'), { now })
  await store.recordReference(protectedFile, { kind: 'token', id: 'capability', expiresAt: 1700000000100 }, { now })

  now = 1700000000109
  assert.equal((await store.prune()).quarantinedFiles, 0, 'renewed token remains protected through exp+safety')
  now = 1700000000110
  assert.equal((await store.prune()).quarantinedFiles, 1)
  assert.equal((await quarantine(directory)).length, 1)
  assert.equal((await store.read(protectedFile)).toString(), 'protected')

  await store.recordReference(protectedFile, { kind: 'history', id: 'history-1' }, { now })
  assert.equal((await store.prune()).restoredFiles, 0)
  const restored = await store.prune()
  assert.equal(restored.restoredFiles, 1)
  assert.equal((await readFile(protectedFile)).toString(), 'protected')
  const rebuilt = await store.rebuildReferenceIndex([{ path: protectedFile, kind: 'history', id: 'history-1' }], { now })
  assert.equal(rebuilt.danglingReferences, 0)
  assert.equal(rebuilt.references, 1)
  await assert.rejects(
    () => store.rebuildReferenceIndex([{ path: path.join(directory, 'window-1700000000999-deadbeef.png'), kind: 'history', id: 'missing' }], { now }),
    error => error?.code === 'screenshot-reference-dangling'
  )
  await unlink(protectedFile)
  const dangling = await store.prune()
  assert.equal(dangling.referenceViewInvalid, true)
  assert.equal(dangling.danglingReferences, 1)
}))

test('restart waits max token TTL plus safety, and clock rollback performs no mutation', () => isolated('computer-use-restart-', async root => {
  const base = 1700000000000
  let now = base
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const firstBoot = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'boot-1', maxFiles: 2, tokenTtlMs: 600_000, gcSafetyMs: 600_000 })
  const oldFile = await firstBoot.save(Buffer.from('old'), { now })
  now += 1
  await firstBoot.save(Buffer.from('new'), { now })

  now = base + 100
  const restarted = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'boot-2', maxFiles: 1, tokenTtlMs: 600_000, gcSafetyMs: 600_000 })
  const shadow = await restarted.prune()
  assert.equal(shadow.shadowReason, 'restart-revalidation')
  now = base + 100 + 1_199_999
  assert.equal((await restarted.prune()).quarantinedFiles, 0)
  now += 1
  assert.equal((await restarted.prune()).quarantinedFiles, 1)

  now += 100
  const quarantineRestart = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'boot-3', maxFiles: 1, tokenTtlMs: 600_000, gcSafetyMs: 600_000 })
  assert.equal((await quarantineRestart.prune()).shadowReason, 'restart-revalidation')
  const restartedIndex = JSON.parse(await readFile(path.join(path.dirname(directory), 'reference-index.json'), 'utf8'))
  assert.equal(Object.values(restartedIndex.quarantine)[0].safeDeleteAfter, now + 1_200_000)
  now += 1_199_999
  assert.equal((await quarantineRestart.prune()).deletedFiles, 0, 'quarantine files receive the same full restart hold')

  const before = await quarantine(directory)
  now -= 1
  const rollback = await quarantineRestart.prune()
  assert.equal(rollback.clockRollback, true)
  await assert.rejects(() => quarantineRestart.recordReference(oldFile, { kind: 'history', id: 'rollback-ref' }, { now }), /时钟回拨/)
  assert.deepEqual(await quarantine(directory), before)
}))

test('corrupt or missing index, unknown quarantine data, and scan-budget failure all fail closed', () => isolated('computer-use-fail-closed-', async root => {
  let now = 1700000000000
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const index = path.join(path.dirname(directory), 'reference-index.json')
  const quarantineDirectory = path.join(path.dirname(directory), 'quarantine')
  const store = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'guard', maxFiles: 2, tokenTtlMs: 1, gcSafetyMs: 1, scanMaxEntries: 2 })
  await store.save(Buffer.from('one'), { now })
  now += 1
  await store.save(Buffer.from('two'), { now })
  now += 10

  await writeFile(index, '{broken')
  assert.equal((await store.prune()).indexInvalid, true)
  assert.equal((await managed(directory)).length, 2)
  await rm(index)
  assert.equal((await store.prune()).shadowReason, 'index-rebuilt')
  assert.equal((await managed(directory)).length, 2)

  await mkdir(quarantineDirectory, { recursive: true })
  await writeFile(path.join(quarantineDirectory, 'unknown-user-evidence.bin'), 'preserve')
  assert.equal((await store.prune()).unknownQuarantineEntry, true)
  assert.equal((await managed(directory)).length, 2)
  await rm(path.join(quarantineDirectory, 'unknown-user-evidence.bin'))
  await writeFile(path.join(directory, 'window-1700000000002-deadbeef.png'), 'three')
  assert.equal((await store.prune()).scanBudgetExceeded, true)
  assert.equal((await managed(directory)).length, 3)
}))

test('concurrent save/read/reference operations serialize and every quarantined item restores', () => isolated('computer-use-concurrent-', async root => {
  let now = 1700000000000
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const store = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'concurrent', maxFiles: 1, tokenTtlMs: 1, gcSafetyMs: 1, quarantineDelayMs: 10_000 })
  const paths = await Promise.all(Array.from({ length: 12 }, (_, index) => store.save(Buffer.from(`frame-${index}`), { now: now + index })))
  now += 100
  const moved = await store.prune()
  assert.equal(moved.quarantinedFiles, 0)
  assert.equal((await quarantine(directory)).length, 11)

  await Promise.all(paths.slice(0, 11).map((file, index) => store.recordReference(file, { kind: 'history', id: `history-${index}` }, { now })))
  await Promise.all(paths.slice(0, 11).map((file, index) => store.read(file).then(bytes => assert.equal(bytes.toString(), `frame-${index}`))))
  assert.equal((await store.prune()).restoredFiles, 0)
  const restored = await store.prune()
  assert.equal(restored.restoredFiles, 11)
  assert.equal((await managed(directory)).length, 12)
  assert.equal((await quarantine(directory)).length, 0)
  const rebuilt = await store.rebuildReferenceIndex(paths.slice(0, 11).map((file, index) => ({ path: file, kind: 'history', id: `history-${index}` })), { now })
  assert.equal(rebuilt.danglingReferences, 0)
  assert.equal(rebuilt.references, 11)
}))

test('600 seconds of active preview reaches a bounded disk plateau with zero dangling index rows', () => isolated('computer-use-plateau-', async (root) => {
  const base = 1700000000000
  let now = base
  const directory = computerUseScreenshotDirectory(root, 'preview')
  const store = new ComputerUseScreenshotStore({ directory, now: () => now, runtimeId: 'plateau', maxFiles: 2, maxBytes: 16, maxFileBytes: 8, maxAgeMs: 1_000_000 })
  const samples = []
  for (let frame = 1; frame <= 1_200; frame += 1) {
    now = base + frame * 500
    await store.save(Buffer.from([frame % 251]), { now })
    if (frame % 20 === 0) {
      const active = await managed(directory)
      const held = await quarantine(directory)
      const bytes = (await Promise.all([
        ...active.map(file => stat(path.join(directory, file))),
        ...held.map(file => stat(path.join(path.dirname(directory), 'quarantine', file)))
      ])).reduce((sum, info) => sum + info.size, 0)
      samples.push({ files: active.length + held.length, bytes })
    }
  }
  assert.equal(samples.length, 60)
  assert.ok(samples.every(sample => sample.files <= 125), JSON.stringify(samples.slice(-5)))
  const plateau = samples.slice(8)
  assert.ok(Math.max(...plateau.map(sample => sample.files)) - Math.min(...plateau.map(sample => sample.files)) <= 1)
  assert.ok(Math.max(...plateau.map(sample => sample.bytes)) - Math.min(...plateau.map(sample => sample.bytes)) <= 1)
  const index = JSON.parse(await readFile(path.join(path.dirname(directory), 'reference-index.json'), 'utf8'))
  assert.equal(Object.values(index.references).reduce((sum, rows) => sum + rows.length, 0), 0)
  const active = await managed(directory)
  assert.ok(Object.keys(index.observed).every(name => active.includes(name)))
}))

test('main keeps accepted memory-stream rollback flags while store owns conservative cleanup', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const store = await readFile(path.resolve(__dirname, '..', 'electron', 'bridge', 'computer-use-screenshot-store.cjs'), 'utf8')
  assert.match(main, /ensureComputerUseScreenshotStore\(\)\.save\(scaled\.toPNG\(\)\)/)
  assert.match(main, /computerUseScreenshotDirectory\(desktopRuntimePaths\(\)\.root, 'evidence'\)/)
  assert.match(main, /computerUseScreenshotDirectory\(desktopRuntimePaths\(\)\.root, 'preview'\)/)
  assert.match(main, /delivery: legacyFilePoll \? 'preview-file' : 'buffer'/)
  assert.match(main, /transport: 'array-buffer'/)
  assert.match(main, /HARNESS_DESKTOP_DEVICE_LEGACY_FILE_POLL/)
  assert.doesNotMatch(main, /path\.join\(desktopRuntimePaths\(\)\.root, 'computer-use', 'screenshots'\)/)
  assert.match(store, /HARNESS_DESKTOP_PREVIEW_SAFE_GC/)
  assert.match(store, /shadowReason: loaded\.missing \? 'index-rebuilt' : 'restart-revalidation'/)
  assert.match(store, /this\.namespace === 'preview' \? this\.#safeGc/)
  assert.match(store, /authoritative: this\.namespace === 'evidence' \|\| this\.namespace === 'legacy'/)
})
