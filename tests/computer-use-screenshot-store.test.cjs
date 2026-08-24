const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { access, mkdtemp, readdir, readFile, rm, writeFile } = require('node:fs/promises')
const { ComputerUseScreenshotStore, SCREENSHOT_FILE } = require('../electron/bridge/computer-use-screenshot-store.cjs')

async function files(directory) {
  return (await readdir(directory)).sort()
}

test('clearing an unused Computer Use session does not create a screenshot directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'computer-use-empty-'))
  const directory = path.join(root, 'screenshots')
  try {
    const store = new ComputerUseScreenshotStore({ directory })
    assert.deepEqual(await store.clear(), { deletedFiles: 0, deletedBytes: 0, retainedFiles: 0, retainedBytes: 0 })
    await assert.rejects(() => access(directory), error => error?.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Computer Use screenshots are session-scoped and count bounded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'computer-use-shots-'))
  const directory = path.join(root, 'screenshots')
  try {
    const store = new ComputerUseScreenshotStore({ directory, maxFiles: 2, maxBytes: 100, maxFileBytes: 50, maxAgeMs: 1000 })
    const base = 1700000000000
    await store.save(Buffer.from('one'), { now: base })
    await store.save(Buffer.from('two'), { now: base + 1 })
    const newest = await store.save(Buffer.from('three'), { now: base + 2 })
    const managed = (await files(directory)).filter(file => SCREENSHOT_FILE.test(file))
    assert.equal(managed.length, 2)
    assert.ok(managed.some(file => newest.endsWith(file)))
    await writeFile(path.join(directory, 'unrelated.txt'), 'keep')
    await writeFile(path.join(directory, 'window-invalid.png'), 'keep')
    const future = `window-${base + 61_000}-abcdef12.png`
    await writeFile(path.join(directory, future), 'remove')
    await store.prune({ now: base })
    assert.equal((await files(directory)).includes(future), false)
    const cleared = await store.clear()
    assert.equal(cleared.deletedFiles, 2)
    assert.deepEqual(await files(directory), ['unrelated.txt', 'window-invalid.png'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Computer Use screenshots enforce age, byte and single-file limits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'computer-use-budget-'))
  const directory = path.join(root, 'screenshots')
  try {
    const base = 1700000000000
    const store = new ComputerUseScreenshotStore({ directory, maxFiles: 8, maxBytes: 10, maxFileBytes: 8, maxAgeMs: 100 })
    await store.save(Buffer.alloc(6, 1), { now: base })
    const second = await store.save(Buffer.alloc(6, 2), { now: base + 1 })
    let managed = (await files(directory)).filter(file => SCREENSHOT_FILE.test(file))
    assert.equal(managed.length, 1)
    assert.equal(await readFile(second).then(buffer => buffer[0]), 2)
    await store.prune({ now: base + 102 })
    managed = (await files(directory)).filter(file => SCREENSHOT_FILE.test(file))
    assert.equal(managed.length, 0)
    await assert.rejects(() => store.save(Buffer.alloc(9), { now: base + 103 }), /超过单文件限制/)
    await assert.rejects(() => store.save(Buffer.alloc(0), { now: base + 104 }), /截图为空/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('main process clears Computer Use screenshots on startup, disable, stop and quit', async () => {
  const main = await readFile(path.resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const store = await readFile(path.resolve(__dirname, '..', 'electron', 'bridge', 'computer-use-screenshot-store.cjs'), 'utf8')
  assert.match(main, /ensureComputerUseScreenshotStore\(\)\.save\(scaled\.toPNG\(\)\)/)
  assert.match(main, /if \(action === 'stop'\) return setComputerUseEnabled\(false\)/)
  assert.match(main, /let computerUseEnabled = false/)
  assert.doesNotMatch(main, /let computerUseEnabled = true/)
  assert.match(main, /activationRequired:\s*computerUseAuthorizedScope === 'none' && !computerUseEnabled/)
  assert.match(main, /activationMode:\s*computerUseAuthorizedScope === 'forever'/)
  assert.match(main, /if \(next === computerUseEnabled\) return computerUseState\(\)/)
  assert.match(main, /computerUseSessionGeneration \+= 1/)
  assert.equal((main.match(/sessionGeneration !== computerUseSessionGeneration/g) || []).length, 1)
  assert.match(main, /await clearComputerUseScreenshots\(\)[\s\S]*Computer Use 会话已停止/u)
  assert.match(main, /target\.lastCaptureHash = createHash\('sha256'\)/u)
  assert.match(main, /if \(!computerUseEnabled\)[\s\S]*await clearComputerUseScreenshots\(\)/)
  assert.match(main, /Unable to clear stale Computer Use screenshots/)
  assert.match(main, /app\.on\('before-quit', event =>[\s\S]*event\.preventDefault\(\)[\s\S]*computerUseQuitCleanupComplete = true; app\.quit\(\)/)
  assert.match(main, /sessionOnly: true/)
  assert.match(store, /lstat\(this\.directory\)/)
  assert.match(store, /!info\.isDirectory\(\) \|\| info\.isSymbolicLink\(\)/)
})
