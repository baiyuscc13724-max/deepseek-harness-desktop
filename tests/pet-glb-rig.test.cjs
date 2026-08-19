const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { ACTIONS: TIMELINE_ACTIONS, timelineSources } = require('../scripts/build-pet-frame-timelines.cjs')

const root = path.join(__dirname, '..')

function readPngHeader(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG')
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25]
  }
}

test('desktop pet uses isolated high-resolution transparent complete-frame sprites', async () => {
  const spriteDir = path.join(root, 'pet-sprite-source', 'maid-whale')
  const animations = {
    idle: 48,
    'walk-left': 24,
    celebrate: 48,
    feeding: 40,
    sleeping: 32,
    working: 24,
    'climb-left': 32,
    physics: 32
  }
  const uniquePoseMinimums = {
    idle: 8,
    'walk-left': 17,
    celebrate: 16,
    feeding: 16,
    sleeping: 16,
    working: 16,
    'climb-left': 16,
    physics: 16
  }
  for (const [animation, frameCount] of Object.entries(animations)) {
    const hashes = new Set()
    const action = TIMELINE_ACTIONS.find(candidate => candidate.name === animation)
    const sources = timelineSources(spriteDir, action)
    assert.equal(sources.length, frameCount)
    for (let frame = 0; frame < frameCount; frame += 1) {
      const name = `${animation}/${frame}.png`
      const bytes = await readFile(sources[frame])
      const header = readPngHeader(bytes)
      assert.ok(header.width >= 250, `${name} should remain high resolution`)
      assert.ok(header.height >= 700, `${name} should remain high resolution`)
      assert.equal(header.bitDepth, 8)
      assert.equal(header.colorType, 6, `${name} must contain real alpha transparency`)
      hashes.add(createHash('sha256').update(bytes).digest('hex'))
    }
    assert.ok(hashes.size >= uniquePoseMinimums[animation], `${animation} must retain its minimum consistent pose count`)
  }
})

test('pet window loads the atlas-based complete-frame sprite renderer instead of the deforming GLB rig', async () => {
  const html = await readFile(path.join(root, 'renderer', 'pet', 'index.html'), 'utf8')
  const petSource = await readFile(path.join(root, 'renderer', 'pet', 'pet.js'), 'utf8')
  const rigSource = await readFile(path.join(root, 'renderer', 'pet', 'pet-sprite-rig.js'), 'utf8')

  assert.match(html, /type="module" src="\.\/pet\.js"/u)
  assert.doesNotMatch(html, /pixi\.min\.js|pet-rig\.js|pet-rig-motion\.js/u)
  assert.match(petSource, /MaidWhaleSpriteRig/u)
  assert.match(petSource, /atlas\/maid-whale\.atlas\.json/u)
  // The runtime must reference the packed atlas manifest, never the 280 loose
  // dev PNG frames (which live outside renderer/ and are excluded at package time).
  assert.doesNotMatch(petSource, /sprites\/(idle|walk-left|celebrate|feeding|sleeping|working|climb-left|physics)\/\$\{index\}\.png/u)
  assert.doesNotMatch(petSource, /maid-whale-rig\.glb|MaidWhaleGLBRig/u)
  assert.match(rigSource, /complete-frame-2d-sprites/u)
  assert.match(rigSource, /#showFrame/u)
  assert.match(rigSource, /drawImage\(/u)
  assert.match(rigSource, /this\.sheet\.className = 'sprite-sheet'/u)
  assert.doesNotMatch(rigSource, /activeSheetIndex|is-active/u)
  assert.match(rigSource, /scaleX\(-1\)/u)
  assert.doesNotMatch(rigSource, /ATLAS_FRAMES = 8/u)
  assert.match(rigSource, /LRU_LIMIT = 3/u)
})

test('desktop pet can detect a restored workbench for window-edge climbing', async () => {
  const mainSource = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  assert.match(mainSource, /getMainBounds: \(\) => mainWindow && !mainWindow\.isDestroyed\(\) && !mainWindow\.isMinimized\(\)/u)
  assert.doesNotMatch(mainSource, /getMainBounds:[^\n]+isVisible\(\)/u)
})

test('desktop pet is immediately clickable without blocking the whole transparent window', async () => {
  const windowSource = await readFile(path.join(root, 'electron', 'pet', 'pet-window.cjs'), 'utf8')
  const styles = await readFile(path.join(root, 'renderer', 'pet', 'pet.css'), 'utf8')
  const petSource = await readFile(path.join(root, 'renderer', 'pet', 'pet.js'), 'utf8')
  const html = await readFile(path.join(root, 'renderer', 'pet', 'index.html'), 'utf8')

  assert.match(windowSource, /setIgnoreMouseEvents\(false\)/u)
  assert.match(windowSource, /setShape\(\[this\.profileRectangle\(\), \.\.\.this\.transientRegions\]\)/u)
  assert.match(windowSource, /profileRectangle\(\)/u)
  assert.match(windowSource, /setHitProfile\(profile/u)
  assert.doesNotMatch(windowSource, /\{ x: 0, y: 0, width: 270, height: 320 \}/u)
  assert.match(windowSource, /sanitizeRegion\(region/u)
  assert.match(windowSource, /area\.y - current\.height \+ 34/u)
  assert.match(petSource, /startCeiling/u)
  assert.match(petSource, /action === 'ceiling'/u)
  assert.doesNotMatch(windowSource, /\{ x: 220, y: 284, width: 30, height: 30 \}/u)
  assert.match(styles, /\.character[^}]+cursor: pointer/u)
  assert.doesNotMatch(styles, /\.status-dot/u)
  assert.doesNotMatch(html, /status-dot/u)
  assert.match(petSource, /new PetInteractionEngine/u)
  assert.match(petSource, /interaction\.hold/u)
  assert.match(petSource, /setHitProfile/u)
  assert.match(petSource, /syncWindowShape/u)
  assert.match(petSource, /elementRegion\(speech, 1\)/u)
  assert.doesNotMatch(styles, /\.speech[^}]+background:/u)
  assert.doesNotMatch(styles, /\.speech[^}]+border:/u)
  assert.doesNotMatch(styles, /\.speech[^}]+box-shadow:/u)
  assert.match(styles, /\.speech[^}]+text-shadow:/u)
})
