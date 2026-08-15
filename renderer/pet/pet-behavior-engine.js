(function exposePetBehavior(globalObject) {
  'use strict'

  const OPERATIONAL_ACTIONS = new Set(['working', 'needs-input', 'blocked', 'ready', 'celebrating', 'sleeping'])
  const INTERRUPT_PRIORITY = Object.freeze({
    drag: 100,
    fall: 95,
    land: 90,
    feeding: 85,
    petting: 82,
    wave: 80,
    'tail-flick': 80,
    'needs-input': 70,
    blocked: 65,
    celebrating: 60,
    ready: 55,
    working: 50,
    hungry: 20,
    climb: 18,
    ceiling: 18,
    perch: 17,
    walk: 12,
    sit: 8,
    yawn: 7,
    wink: 7,
    stretch: 7,
    groom: 7,
    'look-around': 6,
    nap: 6,
    gaming: 6,
    'desk-work': 6,
    'prepare-walk': 6,
    settle: 5,
    idle: 0
  })

  const IDLE_ROUTINES = Object.freeze([
    { action: 'walk', weight: 34 },
    { action: 'sit', weight: 20 },
    { action: 'stretch', weight: 13 },
    { action: 'yawn', weight: 11 },
    { action: 'wink', weight: 9 },
    { action: 'groom', weight: 7 },
    { action: 'look-around', weight: 6 },
    { action: 'nap', weight: 6 },
    { action: 'gaming', weight: 5 },
    { action: 'desk-work', weight: 5 }
  ])

  function baseActionFor(state = {}) {
    if (OPERATIONAL_ACTIONS.has(state.status)) return state.status
    if (state.hungry) return 'hungry'
    return 'idle'
  }

  function canInterrupt(current, next) {
    return (INTERRUPT_PRIORITY[next] ?? 0) >= (INTERRUPT_PRIORITY[current] ?? 0)
  }

  class PetBehaviorEngine {
    constructor({ random = Math.random, setTimer = (...args) => setTimeout(...args), clearTimer = timer => clearTimeout(timer), onAction = () => {} } = {}) {
      this.random = random
      this.setTimer = setTimer
      this.clearTimer = clearTimer
      this.onAction = onAction
      this.state = {}
      this.action = 'idle'
      this.override = null
      this.overrideSource = null
      this.sequence = null
      this.timer = null
      this.wanderTimer = null
      this.motion = 'system'
      this.lastIdleAction = null
    }

    update(state = {}) {
      this.state = state
      this.motion = state.preferences?.motion || 'system'
      const base = baseActionFor(state)
      if (this.override) {
        const idleRoutineMustYield = this.overrideSource === 'idle' && base !== 'idle'
        if (idleRoutineMustYield || (OPERATIONAL_ACTIONS.has(base) && canInterrupt(this.action, base))) {
          this.cancelOverride()
          this.transition(base, { force: true })
        }
        return
      }
      this.transition(base)
      this.scheduleWander()
    }

    transition(next, meta = {}) {
      if (!next || (next === this.action && !meta.force)) return false
      this.action = next
      this.onAction(next, meta)
      return true
    }

    perform(action, duration, meta = {}) {
      if (!canInterrupt(this.action, action) && !meta.force) return false
      this.clearTimer(this.timer)
      this.sequence = null
      this.override = action
      this.overrideSource = meta.source || 'interaction'
      this.transition(action, { ...meta, force: true })
      if (duration > 0) {
        this.timer = this.setTimer(() => {
          this.override = null
          this.overrideSource = null
          this.transition(baseActionFor(this.state), { force: true })
          this.scheduleWander()
        }, duration)
      }
      return true
    }

    performSequence(steps, meta = {}) {
      const sequence = Array.isArray(steps) ? steps.filter(step => step?.action && step.duration > 0) : []
      if (!sequence.length || (!canInterrupt(this.action, sequence[0].action) && !meta.force)) return false
      this.clearTimer(this.timer)
      this.sequence = sequence
      this.override = 'sequence'
      this.overrideSource = meta.source || 'interaction'
      const advance = index => {
        if (!this.sequence || this.sequence !== sequence) return
        if (index >= sequence.length) {
          this.sequence = null
          this.override = null
          this.overrideSource = null
          this.transition(baseActionFor(this.state), { force: true })
          this.scheduleWander()
          return
        }
        const step = sequence[index]
        this.transition(step.action, { ...meta, ...step.meta, force: true })
        this.timer = this.setTimer(() => advance(index + 1), step.duration)
      }
      advance(0)
      return true
    }

    cancelOverride() {
      this.clearTimer(this.timer)
      this.timer = null
      this.sequence = null
      this.override = null
      this.overrideSource = null
    }

    release(action) {
      if (this.override !== action) return
      this.cancelOverride()
      this.transition(baseActionFor(this.state), { force: true })
      this.scheduleWander()
    }

    pickIdleRoutine() {
      const candidates = IDLE_ROUTINES.filter(routine => routine.action !== this.lastIdleAction)
      const weighted = candidates.map(routine => ({ ...routine, weight: this.idleWeight(routine) }))
      const total = weighted.reduce((sum, routine) => sum + routine.weight, 0)
      let cursor = this.random() * total
      for (const routine of weighted) {
        cursor -= routine.weight
        if (cursor <= 0) return routine.action
      }
      return weighted.at(-1)?.action || 'walk'
    }

    idleWeight(routine) {
      const energy = Number(this.state.energy ?? 70)
      const mood = Number(this.state.mood ?? 60)
      let weight = routine.weight
      if (energy < 30) {
        if (routine.action === 'walk') weight *= 0.18
        if (routine.action === 'sit' || routine.action === 'yawn') weight *= 2.8
        if (routine.action === 'nap') weight *= 4
        if (routine.action === 'gaming' || routine.action === 'desk-work') weight *= 0.15
      } else if (energy > 75 && routine.action === 'walk') weight *= 1.5
      if (energy > 70 && mood >= 65 && routine.action === 'gaming') weight *= 2.4
      if (mood >= 75 && (routine.action === 'wink' || routine.action === 'groom')) weight *= 2
      if (mood < 35 && (routine.action === 'sit' || routine.action === 'look-around')) weight *= 1.8
      return Math.max(0.1, weight)
    }

    startIdleRoutine() {
      const action = this.pickIdleRoutine()
      this.lastIdleAction = action
      if (action === 'walk') {
        const direction = this.random() < 0.5 ? -1 : 1
        const duration = 1600 + Math.floor(this.random() * 2200)
        return this.performSequence([
          { action: 'prepare-walk', duration: 420, meta: { direction } },
          { action: 'walk', duration, meta: { direction } },
          { action: 'settle', duration: 520, meta: { direction } }
        ], { source: 'idle', force: true })
      }
      if (action === 'sit') {
        return this.perform('sit', 2400 + Math.floor(this.random() * 2200), { source: 'idle', force: true })
      }
      if (action === 'yawn') {
        return this.perform('yawn', 1900, { source: 'idle', force: true })
      }
      if (action === 'stretch') {
        return this.performSequence([
          { action: 'prepare-walk', duration: 420 },
          { action: 'stretch', duration: 1500 },
          { action: 'settle', duration: 520 }
        ], { source: 'idle', force: true })
      }
      if (action === 'groom') return this.perform('groom', 2200, { source: 'idle', force: true })
      if (action === 'look-around') return this.perform('look-around', 2100, { source: 'idle', force: true })
      if (action === 'nap') return this.perform('nap', 5200 + Math.floor(this.random() * 4200), { source: 'idle', force: true })
      if (action === 'gaming') return this.perform('gaming', 3600 + Math.floor(this.random() * 3200), { source: 'idle', force: true })
      if (action === 'desk-work') return this.perform('desk-work', 3200 + Math.floor(this.random() * 2800), { source: 'idle', force: true })
      return this.perform('wink', 1600, { source: 'idle', force: true })
    }

    scheduleWander() {
      this.clearTimer(this.wanderTimer)
      if (this.override || baseActionFor(this.state) !== 'idle' || this.motion === 'still') return
      const delay = 3500 + Math.floor(this.random() * 4000)
      this.wanderTimer = this.setTimer(() => {
        if (this.override || baseActionFor(this.state) !== 'idle') return
        this.startIdleRoutine()
      }, delay)
    }

    dispose() {
      this.clearTimer(this.timer)
      this.clearTimer(this.wanderTimer)
      this.sequence = null
      this.override = null
      this.overrideSource = null
      this.timer = null
      this.wanderTimer = null
    }
  }

  const exported = { PetBehaviorEngine, INTERRUPT_PRIORITY, IDLE_ROUTINES, baseActionFor, canInterrupt }
  if (typeof module !== 'undefined' && module.exports) module.exports = exported
  globalObject.MaidWhaleBehavior = exported
})(typeof window === 'undefined' ? globalThis : window)
