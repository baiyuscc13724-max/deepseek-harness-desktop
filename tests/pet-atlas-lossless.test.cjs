const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { readFile, readdir, stat } = require('node:fs/promises')
const sharp = require('sharp')
const { ACTIONS: TIMELINE_ACTIONS, timelineSources } = require('../scripts/build-pet-frame-timelines.cjs')

const root = path.join(__dirname, '..')
const atlasRoot = path.join(root, 'renderer', 'pets', 'maid-whale', 'atlas')
const sourceRoot = path.join(root, 'pet-sprite-source', 'maid-whale')
const sourceNames = Object.freeze({
  idle: 'idle',
  walk: 'walk-left',
  celebrate: 'celebrate',
  feeding: 'feeding',
  sleeping: 'sleeping',
  working: 'working',
  climb: 'climb-left',
  physics: 'physics'
})

async function directoryBytes(rootDirectory) {
  const entries = await readdir(rootDirectory, { recursive: true, withFileTypes: true })
  let bytes = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    bytes += (await stat(path.join(entry.parentPath || entry.path, entry.name))).size
  }
  return bytes
}

function canonicalPixelHash(buffer) {
  const canonical = Buffer.from(buffer)
  for (let offset = 0; offset < canonical.length; offset += 4) {
    // RGB under alpha=0 is not observable when Chromium draws the frame, and
    // WebP is allowed to canonicalize those hidden values.
    if (canonical[offset + 3] === 0) canonical.fill(0, offset, offset + 3)
  }
  return createHash('sha256').update(canonical).digest('hex')
}

function hashRows(buffer, width, rect) {
  const pixels = Buffer.alloc(rect.width * rect.height * 4)
  const stride = width * 4
  const rowBytes = rect.width * 4
  for (let row = 0; row < rect.height; row += 1) {
    const offset = (rect.y + row) * stride + rect.x * 4
    buffer.copy(pixels, row * rowBytes, offset, offset + rowBytes)
  }
  return canonicalPixelHash(pixels)
}

test('maid-whale lossless atlases preserve every source-frame RGBA pixel', { timeout: 120_000 }, async () => {
  const manifest = JSON.parse(await readFile(path.join(atlasRoot, 'maid-whale.atlas.json'), 'utf8'))
  assert.equal(manifest.format, 'webp-lossless-grid')
  assert.deepEqual(Object.keys(manifest.actions), Object.keys(sourceNames))

  for (const [action, sourceName] of Object.entries(sourceNames)) {
    const atlas = manifest.actions[action]
    const timeline = timelineSources(sourceRoot, TIMELINE_ACTIONS.find(candidate => candidate.name === sourceName))
    assert.equal(timeline.length, atlas.frameRects.length)
    const { data: atlasPixels, info: atlasInfo } = await sharp(path.join(atlasRoot, atlas.fileName))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    assert.equal(atlasInfo.width, atlas.width)
    assert.equal(atlasInfo.height, atlas.height)

    for (let frame = 0; frame < atlas.frameRects.length; frame += 1) {
      const rect = atlas.frameRects[frame]
      const { data: sourcePixels, info: sourceInfo } = await sharp(timeline[frame])
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      assert.equal(sourceInfo.width, rect.width, `${action} frame ${frame} width`)
      assert.equal(sourceInfo.height, rect.height, `${action} frame ${frame} height`)
      const sourceHash = canonicalPixelHash(sourcePixels)
      assert.equal(hashRows(atlasPixels, atlasInfo.width, rect), sourceHash, `${action} frame ${frame} visible RGBA pixels`)
    }
  }
})

test('runtime atlases and compact development poses stay inside their budgets', async () => {
  const budget = JSON.parse(await readFile(path.join(root, 'build', 'artifact-size-budget.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(path.join(atlasRoot, 'maid-whale.atlas.json'), 'utf8'))
  let runtimeBytes = (await stat(path.join(atlasRoot, 'maid-whale.atlas.json'))).size
  for (const atlas of Object.values(manifest.actions)) runtimeBytes += (await stat(path.join(atlasRoot, atlas.fileName))).size
  const sourceBytes = await directoryBytes(sourceRoot)
  assert.ok(runtimeBytes <= budget.windows.petRuntimeAssetsMiB * 1024 * 1024, `pet runtime atlases use ${(runtimeBytes / 1024 / 1024).toFixed(2)} MiB`)
  assert.ok(sourceBytes <= budget.repository.petSourceAssetsMiB * 1024 * 1024, `pet source poses use ${(sourceBytes / 1024 / 1024).toFixed(2)} MiB`)
})
