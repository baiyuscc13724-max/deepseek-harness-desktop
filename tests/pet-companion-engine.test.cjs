const assert = require('node:assert/strict')
const test = require('node:test')

const { PetCompanionEngine, relationshipFor, safeMessage } = require('../electron/pet/pet-companion-engine.cjs')

function state(overrides = {}) {
  return {
    affection: 14,
    lifetime: { tasksCompleted: 9, tokensObserved: 4096, tokProduced: 12 },
    companion: {
      activeMinutes: 360,
      daysTogether: 4,
      sessionsTogether: 6,
      taskStreak: 3,
      bestTaskStreak: 5,
      interactions: { tap: 2, petting: 8, play: 3 },
      daily: { tasks: 3, completed: 2, interrupted: 1 }
    },
    ...overrides
  }
}

test('relationship is derived from bounded local outcomes and exposes a favorite interaction', () => {
  const relationship = relationshipFor(state())
  assert.equal(relationship.level, 3)
  assert.equal(relationship.title, '默契')
  assert.equal(relationship.taskStreak, 3)
  assert.equal(relationship.favoriteInteraction, 'petting')
  assert.ok(relationship.progress >= 0 && relationship.progress <= 100)
})

test('task cues adapt to style, daily progress and streak without task content', () => {
  const date = new Date('2026-08-24T10:00:00+08:00')
  const engine = new PetCompanionEngine({ now: () => date, random: () => 0 })
  const cue = engine.taskStarted({ state: state(), preferences: { proactive: true, companionStyle: 'warm' }, running: 1 })
  assert.equal(cue.kind, 'task-started')
  assert.match(cue.message, /连续完成 3 项/u)
  assert.equal(/prompt|文件|session/i.test(cue.message), false)
})

test('an interrupted task prevents the next start from being called the first task of the day', () => {
  const engine = new PetCompanionEngine({ now: () => new Date('2026-08-24T10:00:00Z'), random: () => 0 })
  const cue = engine.taskStarted({
    state: state({
      companion: {
        ...state().companion,
        taskStreak: 0,
        daily: { tasks: 1, completed: 0, interrupted: 1 }
      }
    }),
    preferences: { proactive: true, companionStyle: 'warm' },
    running: 1
  })
  assert.equal(cue.message.includes('今天第一项'), false)
})

test('critical task cues remain visible while optional proactive cues respect the user switch', () => {
  const engine = new PetCompanionEngine({ now: () => new Date('2026-08-24T10:00:00Z') })
  assert.equal(engine.taskStarted({ state: state(), preferences: { proactive: false } }), null)
  assert.equal(engine.longRunning({ preferences: { proactive: false, companionStyle: 'warm' }, elapsedMinutes: 25 }), null)
  assert.equal(engine.needsInput({ preferences: { proactive: false, companionStyle: 'calm' } }).critical, true)
})

test('completion cue combines today count, streak and the bounded TOK award', () => {
  const engine = new PetCompanionEngine({ now: () => new Date('2026-08-24T10:00:00Z') })
  const cue = engine.taskCompleted({ state: state(), preferences: { companionStyle: 'playful' }, quantity: 4, quality: 'refined' })
  assert.match(cue.message, /第 2 项/u)
  assert.match(cue.message, /连续完成 3 项/u)
  assert.match(cue.message, /\+4 精炼 TOK/u)
})

test('cue copy is length bounded and strips control characters', () => {
  const message = safeMessage(`hello\u0000\n${'x'.repeat(200)}`)
  assert.equal(message.includes('\u0000'), false)
  assert.equal(message.includes('\n'), false)
  assert.equal(message.length, 96)
})
