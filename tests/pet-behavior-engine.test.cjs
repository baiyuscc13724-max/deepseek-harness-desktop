const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PetBehaviorEngine,
  baseActionFor,
  canInterrupt
} = require('../renderer/pet/pet-behavior-engine.js')

test('operational state takes precedence over hunger and idle wandering', () => {
  assert.equal(baseActionFor({ status: 'working', hungry: true }), 'working')
  assert.equal(baseActionFor({ status: 'idle', hungry: true }), 'hungry')
  assert.equal(baseActionFor({ status: 'idle', hungry: false }), 'idle')
})

test('direct manipulation has higher interrupt priority than background work', () => {
  assert.equal(canInterrupt('working', 'drag'), true)
  assert.equal(canInterrupt('drag', 'working'), false)
  assert.equal(canInterrupt('walk', 'needs-input'), true)
  assert.equal(canInterrupt('walk', 'climb'), true)
})

test('one-shot interaction returns to the current operational state', () => {
  const actions = []
  const timers = []
  const engine = new PetBehaviorEngine({
    onAction: action => actions.push(action),
    setTimer: callback => {
      timers.push(callback)
      return timers.length
    },
    clearTimer: () => {}
  })
  engine.update({ status: 'working', preferences: { motion: 'full' } })
  engine.perform('feeding', 1000, { force: true })
  timers.shift()()
  assert.deepEqual(actions.slice(0, 3), ['working', 'feeding', 'working'])
})

test('still motion does not schedule autonomous wandering', () => {
  let scheduled = 0
  const engine = new PetBehaviorEngine({
    setTimer: () => { scheduled += 1 },
    clearTimer: () => {}
  })
  engine.update({ status: 'idle', preferences: { motion: 'still' } })
  assert.equal(scheduled, 0)
})

test('idle behavior uses an anticipation, movement and settle sequence', () => {
  const actions = []
  const timers = []
  const engine = new PetBehaviorEngine({
    random: () => 0,
    onAction: action => actions.push(action),
    setTimer: callback => {
      timers.push(callback)
      return timers.length
    },
    clearTimer: () => {}
  })

  engine.update({ status: 'idle', preferences: { motion: 'full' } })
  timers.shift()()
  timers.shift()()
  timers.shift()()
  timers.shift()()

  assert.deepEqual(actions, ['prepare-walk', 'walk', 'settle', 'idle'])
})

test('idle behavior does not immediately repeat the same routine', () => {
  const engine = new PetBehaviorEngine({ random: () => 0 })
  engine.lastIdleAction = 'walk'
  assert.equal(engine.pickIdleRoutine(), 'sit')
})

test('operational work cancels an autonomous idle sequence immediately', () => {
  const actions = []
  const timers = new Map()
  let nextTimer = 0
  const engine = new PetBehaviorEngine({
    random: () => 0,
    onAction: action => actions.push(action),
    setTimer: callback => {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimer: id => timers.delete(id)
  })

  engine.update({ status: 'idle', preferences: { motion: 'full' } })
  const wander = [...timers.entries()][0]
  timers.delete(wander[0])
  wander[1]()
  engine.update({ status: 'working', preferences: { motion: 'full' } })

  assert.deepEqual(actions, ['prepare-walk', 'working'])
  assert.equal(engine.override, null)
  assert.equal(engine.sequence, null)
})

test('idle weighting reacts to energy and mood instead of using a fixed loop', () => {
  const engine = new PetBehaviorEngine()
  engine.state = { energy: 15, mood: 80 }
  const walk = engine.idleWeight({ action: 'walk', weight: 34 })
  const yawn = engine.idleWeight({ action: 'yawn', weight: 11 })
  const wink = engine.idleWeight({ action: 'wink', weight: 9 })
  const nap = engine.idleWeight({ action: 'nap', weight: 6 })
  const gaming = engine.idleWeight({ action: 'gaming', weight: 5 })
  assert.ok(yawn > walk)
  assert.ok(wink > 9)
  assert.ok(nap > gaming)
})
