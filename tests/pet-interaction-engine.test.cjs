const assert = require('node:assert/strict')
const test = require('node:test')

const { PetInteractionEngine } = require('../renderer/pet/pet-interaction-engine.js')

function point(pointerId, x, y, at, hotspot = 'body') {
  return { pointerId, x, y, at, hotspot }
}

test('a short stationary press is a tap and never becomes a drag', () => {
  const events = []
  const engine = new PetInteractionEngine({ onEvent: event => events.push(event.type) })
  engine.begin(point(1, 100, 100, 0, 'head'))
  const result = engine.end(point(1, 103, 102, 160, 'head'))
  assert.equal(result.type, 'tap')
  assert.deepEqual(events, ['press', 'tap'])
})

test('head hold enters petting with a wider movement grace', () => {
  const events = []
  const engine = new PetInteractionEngine({ onEvent: event => events.push(event.type) })
  engine.begin(point(1, 100, 100, 0, 'head'))
  assert.equal(engine.hold(point(1, 104, 103, 300, 'head')), true)
  engine.move(point(1, 125, 102, 360, 'head'))
  const result = engine.end(point(1, 125, 102, 420, 'head'))
  assert.equal(result.type, 'pet-end')
  assert.deepEqual(events, ['press', 'pet-start', 'pet-move', 'pet-end'])
})

test('movement beyond the threshold becomes a drag and can follow petting', () => {
  const events = []
  const engine = new PetInteractionEngine({ onEvent: event => events.push(event.type) })
  engine.begin(point(1, 100, 100, 0, 'body'))
  engine.move(point(1, 110, 100, 40, 'body'))
  engine.move(point(1, 130, 110, 80, 'body'))
  const result = engine.end(point(1, 140, 120, 120, 'body'))
  assert.equal(result.type, 'drag-end')
  assert.deepEqual(events, ['press', 'drag-start', 'drag-move', 'drag-end'])
})

test('leaving the head petting region promotes the gesture to dragging', () => {
  const events = []
  const engine = new PetInteractionEngine({ onEvent: event => events.push(event.type) })
  engine.begin(point(1, 100, 100, 0, 'head'))
  engine.hold(point(1, 100, 100, 300, 'head'))
  engine.move(point(1, 145, 140, 340, 'body'))
  assert.equal(engine.gesture.mode, 'dragging')
  assert.deepEqual(events, ['press', 'pet-start', 'drag-start'])
})
