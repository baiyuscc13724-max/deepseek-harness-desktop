import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const rigRoot = path.join(projectRoot, 'renderer', 'pets', 'maid-whale', 'rig')
const source = path.join(rigRoot, 'rig-source-v1.png')
const outputRoot = path.join(rigRoot, 'parts')
const names = [
  'back-hair', 'torso', 'head', 'headdress',
  'ear-left', 'ear-right', 'arm-left-upper', 'arm-left-lower',
  'arm-right-upper', 'arm-right-lower', 'skirt-front', 'skirt-back',
  'leg-left', 'leg-right', 'tail-base', 'tail-tip'
]

const metadata = await sharp(source).metadata()
if (!metadata.width || !metadata.height || metadata.width !== metadata.height) {
  throw new Error('Rig source must be a square 4x4 atlas.')
}

await mkdir(outputRoot, { recursive: true })
const boundaries = Array.from({ length: 5 }, (_, index) => Math.round(metadata.width * index / 4))
const manifest = {}

function componentBounds(data, width, height) {
  const visited = new Uint8Array(width * height)
  const queue = new Int32Array(width * height)
  const components = []
  const opaque = index => data[index * 4 + 3] > 20
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || !opaque(start)) continue
    let head = 0
    let tail = 0
    let count = 0
    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0
    visited[start] = 1
    queue[tail++] = start
    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = Math.floor(index / width)
      count += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
          const next = ny * width + nx
          if (visited[next] || !opaque(next)) continue
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }
    if (count >= 40) components.push({ count, minX, minY, maxX, maxY, centerX: (minX + maxX) / 2 })
  }
  return components.sort((a, b) => b.count - a.count)
}

for (let index = 0; index < names.length; index += 1) {
  const row = Math.floor(index / 4)
  const column = index % 4
  const left = boundaries[column]
  const top = boundaries[row]
  const width = boundaries[column + 1] - left
  const height = boundaries[row + 1] - top
  const cell = await sharp(source)
    .extract({ left, top, width, height })
    .png()
    .toBuffer()
  const raw = await sharp(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const components = componentBounds(raw.data, raw.info.width, raw.info.height)
  if (!components.length) throw new Error(`No opaque rig part found for ${names[index]}`)
  let selected = components[0]
  if (names[index] === 'leg-left' || names[index] === 'leg-right') {
    const candidates = components.filter(item => item.count >= components[0].count * .4).slice(0, 4)
    selected = names[index] === 'leg-left'
      ? candidates.sort((a, b) => a.centerX - b.centerX)[0]
      : candidates.sort((a, b) => b.centerX - a.centerX)[0]
  }
  let componentWidth = selected.maxX - selected.minX + 1
  const componentHeight = selected.maxY - selected.minY + 1
  let componentLeft = selected.minX
  if (names[index] === 'leg-left') componentWidth = Math.ceil(componentWidth / 2)
  if (names[index] === 'leg-right') {
    const rightWidth = Math.floor(componentWidth / 2)
    componentLeft = selected.maxX - rightWidth + 1
    componentWidth = rightWidth
  }
  let trimmed = await sharp(cell)
    .extract({ left: componentLeft, top: selected.minY, width: componentWidth, height: componentHeight })
    .extend({ top: 8, right: 8, bottom: 8, left: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer({ resolveWithObject: true })
  if (names[index] === 'torso') {
    const waistHeight = Math.max(1, Math.round(trimmed.info.height * .46))
    trimmed = await sharp(trimmed.data)
      .extract({ left: 0, top: 0, width: trimmed.info.width, height: waistHeight })
      .png()
      .toBuffer({ resolveWithObject: true })
  }
  const outputWidth = Math.max(1, trimmed.info.width * 3)
  const outputHeight = Math.max(1, trimmed.info.height * 3)
  const fileName = `${names[index]}.png`
  await sharp(trimmed.data)
    .resize(outputWidth, outputHeight, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(outputRoot, fileName))
  manifest[names[index]] = { file: `parts/${fileName}`, width: outputWidth, height: outputHeight }
}

await writeFile(
  path.join(rigRoot, 'parts-manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, source: 'rig-source-v1.png', scale: 3, parts: manifest }, null, 2)}\n`,
  'utf8'
)

console.log(`Built ${names.length} high-density rig parts in ${outputRoot}`)
