const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readdir, rm, symlink, writeFile } = require('node:fs/promises')

const { pruneComputerUseScreenshots } = require('../electron/bridge/computer-use-screenshot-store.cjs')

test('Computer Use screenshots are bounded by count and age without touching unrelated files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-computer-use-shots-'))
  try {
    const now = 2_000_000_000_000
    for (let index = 0; index < 45; index++) {
      await writeFile(path.join(root, `window-${now - index * 1000}.png`), `shot-${index}`)
    }
    await writeFile(path.join(root, 'keep.txt'), 'protected')
    await writeFile(path.join(root, `window-${now - 20 * 24 * 60 * 60 * 1000}.png`), 'expired')
    try { await symlink(path.join(root, 'keep.txt'), path.join(root, `window-${now + 1}.png`)) } catch {}

    const result = await pruneComputerUseScreenshots(root, { maxFiles: 40, maxAgeMs: 7 * 24 * 60 * 60 * 1000, now })
    const names = await readdir(root)
    const screenshots = names.filter(name => /^window-\d+\.png$/.test(name) && name !== `window-${now + 1}.png`)
    assert.equal(result.kept, 40)
    assert.equal(screenshots.length, 40)
    assert.ok(names.includes('keep.txt'))
    assert.ok(!names.includes(`window-${now - 20 * 24 * 60 * 60 * 1000}.png`))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Computer Use screenshot cleanup tolerates a missing directory', async () => {
  const result = await pruneComputerUseScreenshots(path.join(os.tmpdir(), `missing-computer-use-${Date.now()}`))
  assert.deepEqual(result, { kept: 0, removed: 0 })
})
