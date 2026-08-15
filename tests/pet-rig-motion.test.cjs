const assert = require('node:assert/strict')
const test = require('node:test')

const { neutralPose, rigPose } = require('../renderer/pet/pet-rig-motion.js')

test('neutral rig exposes independently animated limbs and tail segments', () => {
  const pose = neutralPose()
  for (const key of ['armLeftUpper', 'armLeftLower', 'armRightUpper', 'armRightLower', 'legLeft', 'legRight', 'tailBase', 'tailTip']) {
    assert.equal(typeof pose[key], 'number')
  }
})

test('walking drives legs and arms in opposing phases', () => {
  const pose = rigPose('walk', 0.125)
  assert.notEqual(pose.legLeft, 0)
  assert.equal(Math.sign(pose.legLeft), -Math.sign(pose.legRight))
  assert.equal(Math.sign(pose.armLeftUpper), -Math.sign(pose.armRightUpper))
})

test('drag pose raises both arms and leaves the tail reactive', () => {
  const pose = rigPose('drag', 0.3)
  assert.ok(Math.abs(pose.armLeftUpper) > 2)
  assert.ok(Math.abs(pose.armRightUpper) > 2)
  assert.notEqual(pose.tailBase, pose.tailTip)
})
