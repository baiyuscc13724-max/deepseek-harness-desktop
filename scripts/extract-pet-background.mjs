import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const [inputArg, outputArg] = process.argv.slice(2)

if (!inputArg || !outputArg) {
  throw new Error('Usage: node scripts/extract-pet-background.mjs <input.png> <output.png>')
}

const input = path.resolve(inputArg)
const output = path.resolve(outputArg)
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width, height, channels } = info
const pixels = width * height
const background = new Uint8Array(pixels)
const queue = new Int32Array(pixels)
let head = 0
let tail = 0

function isBackdrop(index) {
  const offset = index * channels
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  return min >= 218 && max - min <= 18
}

function enqueue(index) {
  if (background[index] || !isBackdrop(index)) return
  background[index] = 1
  queue[tail++] = index
}

for (let x = 0; x < width; x += 1) {
  enqueue(x)
  enqueue((height - 1) * width + x)
}
for (let y = 0; y < height; y += 1) {
  enqueue(y * width)
  enqueue(y * width + width - 1)
}

while (head < tail) {
  const index = queue[head++]
  const x = index % width
  const y = Math.floor(index / width)
  if (x > 0) enqueue(index - 1)
  if (x + 1 < width) enqueue(index + 1)
  if (y > 0) enqueue(index - width)
  if (y + 1 < height) enqueue(index + width)
}

const outputPixels = Buffer.from(data)
for (let index = 0; index < pixels; index += 1) {
  const alphaOffset = index * channels + 3
  outputPixels[alphaOffset] = background[index] ? 0 : 255
}

await fs.mkdir(path.dirname(output), { recursive: true })
await sharp(outputPixels, { raw: { width, height, channels } })
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(output)

console.log(JSON.stringify({ input, output, width, height, transparentPixels: tail }))
