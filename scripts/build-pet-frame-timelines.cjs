const { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const sprites = path.join(root, 'renderer', 'pets', 'maid-whale', 'sprites')
const inbetweensRoot = path.join(sprites, 'inbetweens')
const secondaryRoot = path.join(sprites, 'inbetweens-secondary')

const actions = [
  { name: 'idle', expected: 48, useSecondary: false },
  { name: 'walk-left', expected: 24 },
  { name: 'celebrate', expected: 48 },
  { name: 'feeding', expected: 40 },
  { name: 'sleeping', expected: 32 },
  { name: 'working', expected: 24 },
  { name: 'climb-left', expected: 32 },
  { name: 'physics', expected: 32 }
]

function numberedPngs(directory) {
  return readdirSync(directory)
    .filter(name => /^\d+\.png$/u.test(name))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10))
}

function buildTimeline(action) {
  const primaryNames = numberedPngs(path.join(inbetweensRoot, action.name))
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
      poses.push(path.join(inbetweensRoot, action.name, primaryNames[index]))
      poses.push(path.join(secondaryDirectory, secondaryNames[index]))
    }
    for (const name of primaryNames.slice(pairedCount)) poses.push(path.join(inbetweensRoot, action.name, name))
  } else {
    for (const name of primaryNames) poses.push(path.join(inbetweensRoot, action.name, name))
  }
  const timeline = Array.from({ length: action.expected }, (_, index) => poses[Math.floor(index * poses.length / action.expected)])

  const output = path.resolve(sprites, action.name)
  const safeRoot = `${path.resolve(sprites)}${path.sep}`
  if (!output.startsWith(safeRoot) || output.includes(`${path.sep}keyframes${path.sep}`) || output.includes(`${path.sep}inbetweens${path.sep}`)) {
    throw new Error(`unsafe output path: ${output}`)
  }
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  timeline.forEach((source, index) => copyFileSync(source, path.join(output, `${index}.png`)))
  return { action: action.name, logicalFrames: timeline.length, uniqueDrawnPoses: new Set(timeline).size }
}

for (const action of actions) {
  if (!existsSync(path.join(inbetweensRoot, action.name))) {
    throw new Error(`missing source poses for ${action.name}`)
  }
}

console.log(JSON.stringify(actions.map(buildTimeline), null, 2))
