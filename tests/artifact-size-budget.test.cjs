const assert = require('node:assert/strict')
const test = require('node:test')
const os = require('node:os')
const path = require('node:path')
const { mkdir, mkdtemp, rm, writeFile } = require('node:fs/promises')

const budgetModule = import('../scripts/artifact-size-budget.mjs')
const productionBudget = require('../build/artifact-size-budget.json')

test('v1.0.55 keeps intentional plugin and alpha.2 runtime-peer growth under narrow physical ceilings', () => {
  assert.equal(productionBudget.windows.appAsarMiB, 121)
  assert.equal(productionBudget.windows.appAsarUnpackedMiB, 32)
  assert.equal(productionBudget.windows.localesMaxFiles, 2)
})

test('artifact size budget rejects regressions with an actionable error', async () => {
  const { assertMaximum } = await budgetModule
  assert.doesNotThrow(() => assertMaximum('sample', 1024 * 1024, 1))
  assert.throws(() => assertMaximum('sample', 1024 * 1024 + 1, 1), /sample exceeds its size budget/)
  assert.throws(() => assertMaximum('sample', 1, 0), /Invalid size budget/)
})

test('directorySize counts nested files and tolerates a missing directory', async () => {
  const { directorySize } = await budgetModule
  const root = await mkdtemp(path.join(os.tmpdir(), 'harness-size-budget-'))
  try {
    await mkdir(path.join(root, 'nested'))
    await writeFile(path.join(root, 'one.bin'), Buffer.alloc(7))
    await writeFile(path.join(root, 'nested', 'two.bin'), Buffer.alloc(11))
    assert.equal(await directorySize(root), 18)
    assert.equal(await directorySize(path.join(root, 'missing')), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows footprint gate includes locales, ASAR and unpacked limits', async () => {
  const { enforceWindowsFootprint, MIB } = await budgetModule
  const footprint = {
    unpackedBytes: 10 * MIB,
    appAsarBytes: 5 * MIB,
    appAsarUnpackedBytes: 2 * MIB,
    bundledGitBytes: 3 * MIB,
    localesBytes: MIB,
    localeFiles: 2
  }
  const budget = {
    unpackedMiB: 10,
    appAsarMiB: 5,
    appAsarUnpackedMiB: 2,
    bundledGitMiB: 3,
    localesMiB: 1,
    localesMaxFiles: 2
  }
  assert.doesNotThrow(() => enforceWindowsFootprint(footprint, budget))
  assert.throws(() => enforceWindowsFootprint({ ...footprint, bundledGitBytes: 3 * MIB + 1 }, budget), /Bundled MinGit, GCM and Git LFS exceeds/)
  assert.throws(() => enforceWindowsFootprint({ ...footprint, localeFiles: 3 }, budget), /locale file count exceeds/)
})
