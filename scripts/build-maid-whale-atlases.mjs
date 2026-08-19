// Builds pixel-lossless per-action WebP atlases for the maid-whale desktop pet.
//
// The desktop pet no longer loads hundreds of PNG frames at runtime. Each
// action (idle, walk, celebrate, ...) is packed into a single lossless WebP
// sprite sheet and described by a JSON manifest of per-frame source rects.
// The runtime rig (MaidWhaleSpriteRig) draws each animation frame from the
// matching source rect and lazily loads atlases on demand (bounded LRU).
//
// Source frames live OUTSIDE renderer/ (pet-sprite-source/maid-whale) so they
// stay in the repo as dev artifacts but are excluded from the packaged app
// (electron-builder only ships renderer/**/*). Only the small WebP atlases and
// the manifest ship in the app.
//
// Usage: node scripts/build-maid-whale-atlases.mjs
// Regenerate after the source frames change. Deterministic and repeatable.

import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const require = createRequire(import.meta.url)
const { ACTIONS: TIMELINE_ACTIONS, timelineSources } = require('./build-pet-frame-timelines.cjs')

// Frame geometry is homogeneous across every action (same canvas size), which
// lets the packer place frames on a clean grid and the runtime index frames by
// (row, col) without per-frame offsets.
const FRAME_WIDTH = 420
const FRAME_HEIGHT = 724

// Action -> (source dir name, frame count, grid columns, grid rows). Grids are
// chosen to avoid wasted transparent cells so decoded bitmaps stay as small as
// possible. `source` maps the atlas action name to the on-disk dev-frame
// directory (the directional frames keep their "-left" suffix).
const ACTIONS = Object.freeze({
  idle: { source: 'idle', frames: 48, cols: 8, rows: 6 },
  walk: { source: 'walk-left', frames: 24, cols: 6, rows: 4 },
  celebrate: { source: 'celebrate', frames: 48, cols: 8, rows: 6 },
  feeding: { source: 'feeding', frames: 40, cols: 8, rows: 5 },
  sleeping: { source: 'sleeping', frames: 32, cols: 8, rows: 4 },
  working: { source: 'working', frames: 24, cols: 6, rows: 4 },
  climb: { source: 'climb-left', frames: 32, cols: 8, rows: 4 },
  physics: { source: 'physics', frames: 32, cols: 8, rows: 4 }
})

const SOURCE_ROOT = path.join(projectRoot, 'pet-sprite-source', 'maid-whale')
const ATLAS_ROOT = path.join(projectRoot, 'renderer', 'pets', 'maid-whale', 'atlas')

function logicalFrameSources(name) {
  const action = TIMELINE_ACTIONS.find(candidate => candidate.name === name)
  if (!action) throw new Error(`missing timeline definition for ${name}`)
  return timelineSources(SOURCE_ROOT, action)
}

async function buildActionAtlas(name, def) {
  const sources = logicalFrameSources(def.source)
  if (sources.length !== def.frames) {
    throw new Error(`${name}: expected ${def.frames} source frames, found ${sources.length}`)
  }
  const { cols, rows } = def
  const sheetWidth = cols * FRAME_WIDTH
  const sheetHeight = rows * FRAME_HEIGHT
  if ([...sources.keys()].length !== def.frames) throw new Error(`${name}: internal frame count mismatch`)

  // Copy raw RGBA rows directly instead of compositing through a premultiplied
  // alpha pipeline. This avoids one-level RGB rounding at translucent edges.
  const sheetPixels = Buffer.alloc(sheetWidth * sheetHeight * 4)
  for (let index = 0; index < sources.length; index += 1) {
    const { data, info } = await sharp(sources[index]).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (info.width !== FRAME_WIDTH || info.height !== FRAME_HEIGHT || info.channels !== 4) {
      throw new Error(`${name}: source frame ${index} must be ${FRAME_WIDTH}x${FRAME_HEIGHT} RGBA`)
    }
    const left = (index % cols) * FRAME_WIDTH
    const top = Math.floor(index / cols) * FRAME_HEIGHT
    const sourceStride = FRAME_WIDTH * 4
    const sheetStride = sheetWidth * 4
    for (let row = 0; row < FRAME_HEIGHT; row += 1) {
      const sourceOffset = row * sourceStride
      const targetOffset = (top + row) * sheetStride + left * 4
      data.copy(sheetPixels, targetOffset, sourceOffset, sourceOffset + sourceStride)
    }
  }

  // WebP lossless preserves every visible RGBA value while remaining roughly
  // half the size of the 280 individual source PNGs.
  const buffer = await sharp(sheetPixels, { raw: { width: sheetWidth, height: sheetHeight, channels: 4 } })
    .webp({ lossless: true, quality: 100, effort: 6 })
    .toBuffer()

  const fileName = `${name}.webp`
  await writeFile(path.join(ATLAS_ROOT, fileName), buffer)

  // Explicit per-frame source rects (the "frame manifest") for tests and the
  // runtime. Rect [x, y, width, height] indexes into the sheet.
  const frameRects = []
  for (let index = 0; index < def.frames; index += 1) {
    frameRects.push({
      x: (index % cols) * FRAME_WIDTH,
      y: Math.floor(index / cols) * FRAME_HEIGHT,
      width: FRAME_WIDTH,
      height: FRAME_HEIGHT
    })
  }

  return { fileName, width: sheetWidth, height: sheetHeight, cols, rows, frameRects }
}

async function main() {
  await mkdir(ATLAS_ROOT, { recursive: true })
  const actions = {}
  for (const [name, def] of Object.entries(ACTIONS)) {
    actions[name] = await buildActionAtlas(name, def)
  }

  const manifest = {
    schemaVersion: 1,
    format: 'webp-lossless-grid',
    pet: 'maid-whale',
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    encoder: 'sharp-webp-lossless',
    actions
  }
  await writeFile(
    path.join(ATLAS_ROOT, 'maid-whale.atlas.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )

  const printable = Object.fromEntries(Object.entries(actions).map(([n, a]) => [n, { file: a.fileName, width: a.width, height: a.height, frames: a.frameRects.length }]))
  console.log(JSON.stringify({ atlases: printable, manifest: 'maid-whale.atlas.json' }, null, 2))
  console.log(`Built ${Object.keys(actions).length} lossless WebP atlases in ${ATLAS_ROOT}`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
