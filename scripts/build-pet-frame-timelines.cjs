const { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const sprites = path.join(root, 'pet-sprite-source', 'maid-whale')

const ACTIONS = Object.freeze([
  Object.freeze({ name: 'idle', expected: 48, useSecondary: false }),
  Object.freeze({ name: 'walk-left', expected: 24 }),
  Object.freeze({ name: 'celebrate', expected: 48 }),
  Object.freeze({ name: 'feeding', expected: 40 }),
  Object.freeze({ name: 'sleeping', expected: 32 }),
  Object.freeze({ name: 'working', expected: 24 }),
  Object.freeze({ name: 'climb-left', expected: 32 }),
  Object.freeze({ name: 'physics', expected: 32 })
])

function numberedPngs(directory) {
  return readdirSync(directory)
    .filter(name => /^\d+\.png$/u.test(name))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
}

function timelineSources(sourceRoot, action) {
  const inbetweensRoot = path.join(sourceRoot, 'inbetweens')
  const secondaryRoot = path.join(sourceRoot, 'inbetweens-secondary')
  const primaryDirectory = path.join(inbetweensRoot, action.name)
  if (!existsSync(primaryDirectory)) throw new Error(`missing source poses for ${action.name}`)
  const primaryNames = numberedPngs(primaryDirectory)
  if (primaryNames.length < 8) {
    throw new Error(`${action.name}: expected at least 8 consistent source poses, found ${primaryNames.length}`)
  }
  const secondaryDirectory = path.join(secondaryRoot, action.name)
  const secondaryNames = action.useSecondary === false
    ? []
    : existsSync(secondaryDirectory) ? numberedPngs(secondaryDirectory) : []
  const poses = []
  const pairedCount = Math.min(primaryNames.length, secondaryNames.length)
  if (pairedCount >= 8) {
    for (let index = 0; index < pairedCount; index += 1) {
      poses.push(path.join(primaryDirectory, primaryNames[index]))
      poses.push(path.join(secondaryDirectory, secondaryNames[index]))
    }
    for (const name of primaryNames.slice(pairedCount)) poses.push(path.join(primaryDirectory, name))
  } else {
    for (const name of primaryNames) poses.push(path.join(primaryDirectory, name))
  }
  return Array.from({ length: action.expected }, (_, index) => poses[Math.floor(index * poses.length / action.expected)])
}

function buildTimeline(sourceRoot, action) {
  const timeline = timelineSources(sourceRoot, action)
  const output = path.resolve(sourceRoot, action.name)
  const safeRoot = `${path.resolve(sourceRoot)}${path.sep}`
  if (!output.startsWith(safeRoot) || output.includes(`${path.sep}keyframes${path.sep}`) || output.includes(`${path.sep}inbetweens${path.sep}`)) {
    throw new Error(`unsafe output path: ${output}`)
  }
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  timeline.forEach((source, index) => copyFileSync(source, path.join(output, `${index}.png`)))
  return { action: action.name, logicalFrames: timeline.length, uniqueDrawnPoses: new Set(timeline).size }
}

if (require.main === module) {
  console.log(JSON.stringify(ACTIONS.map(action => buildTimeline(sprites, action)), null, 2))
}

module.exports = { ACTIONS, buildTimeline, numberedPngs, timelineSources }
