/**
 * Deep-audit diagnostic: pixel-level vertical white-column scan over real Electron captures.
 *
 * Why: the user's persistent white column cannot be seen by DOM geometry checks (round 3 ran 148 geometry
 * checks green while the symptom persisted). This scans the *pixels* instead, looking for the signature of a
 * white column: a run of adjacent columns that are near-white AND nearly uniform down their whole height.
 *
 * Scope: read-only, absolute-path arguments only, no product instance, no network.
 * Usage: node scripts/deep-audit-white-column-scan.mjs <png> [<png> ...]
 *        node scripts/deep-audit-white-column-scan.mjs --dir <directory>   (recurses for *.png)
 */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const WHITE_MIN = 235 // a column must average at least this bright to count as white
const UNIFORM_MAX = 6 // and vary less than this across its full height to count as uniform

async function scan(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const columns = []
  for (let x = 0; x < width; x += 1) {
    let sum = 0
    let min = 255
    let max = 0
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + x) * channels
      const luminance = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000
      sum += luminance
      if (luminance < min) min = luminance
      if (luminance > max) max = luminance
    }
    columns.push({ mean: sum / height, spread: max - min })
  }
  const white = columns.map(c => c.mean >= WHITE_MIN && c.spread <= UNIFORM_MAX)
  let best = { length: 0, start: -1 }
  for (let x = 0; x < width; x += 1) {
    if (!white[x]) continue
    let end = x
    while (end + 1 < width && white[end + 1]) end += 1
    if (end - x + 1 > best.length) best = { length: end - x + 1, start: x }
    x = end
  }
  return {
    file: path.relative(process.cwd(), file),
    width,
    height,
    whiteUniformColumns: white.filter(Boolean).length,
    longestWhiteRun: best.length,
    longestWhiteRunStart: best.start,
    longestWhiteRunEnd: best.start < 0 ? -1 : best.start + best.length - 1,
    rightmostWhiteColumn: white.lastIndexOf(true)
  }
}

const args = process.argv.slice(2)
let files = []
if (args[0] === '--dir') {
  const root = args[1]
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.toLowerCase().endsWith('.png')) files.push(full)
    }
  }
  walk(root)
} else {
  files = args
}
if (files.length === 0) {
  process.stdout.write('no PNG inputs\n')
  process.exit(2)
}

const rows = []
for (const file of files) {
  try {
    rows.push(await scan(file))
  } catch (error) {
    rows.push({ file, error: String(error?.message || error) })
  }
}
rows.sort((a, b) => (b.longestWhiteRun || 0) - (a.longestWhiteRun || 0))
for (const row of rows) {
  if (row.error) { process.stdout.write(`${row.file}  ERROR ${row.error}\n`); continue }
  process.stdout.write(
    `${String(row.longestWhiteRun).padStart(5)}px-run @x=${String(row.longestWhiteRunStart).padStart(5)}  ` +
    `${row.width}x${row.height}  whiteCols=${String(row.whiteUniformColumns).padStart(5)}  rightmost=${String(row.rightmostWhiteColumn).padStart(5)}  ${row.file}\n`
  )
}
