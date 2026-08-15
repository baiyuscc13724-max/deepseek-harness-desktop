'use strict'

const assert = require('node:assert/strict')
const { readFile, stat } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('maid whale rig ships high-density, non-overlapping active layers', async () => {
  const rigRoot = path.join(root, 'renderer', 'pets', 'maid-whale', 'rig')
  const manifest = JSON.parse(await readFile(path.join(rigRoot, 'parts-manifest.json'), 'utf8'))
  const rigSource = await readFile(path.join(root, 'renderer', 'pet', 'pet-rig.js'), 'utf8')

  assert.equal(manifest.scale, 3)
  assert.ok(manifest.parts.torso.height / manifest.parts.torso.width < 0.6, 'torso must end at the waist instead of duplicating the skirt')

  const activeParts = [
    'torso', 'head', 'headdress',
    'arm-left-upper', 'arm-left-lower', 'arm-right-upper', 'arm-right-lower',
    'skirt-front', 'leg-left', 'leg-right', 'tail-base', 'tail-tip'
  ]
  for (const name of activeParts) {
    const occurrences = rigSource.match(new RegExp(`attach\\('${name}'`, 'g')) || []
    assert.equal(occurrences.length, 1, `${name} must be attached exactly once`)
    const file = path.join(rigRoot, manifest.parts[name].file)
    assert.ok((await stat(file)).size > 1_000, `${name} must have a real high-density asset`)
  }

  assert.doesNotMatch(rigSource, /attach\('back-hair'/, 'head already contains its rear hair layer')
  assert.doesNotMatch(rigSource, /attach\('skirt-back'/, 'front skirt already supplies the complete visible skirt')
})
