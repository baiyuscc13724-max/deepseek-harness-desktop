const TOK_PER_UNIT = 512
const TASK_TOK_CAP = 12
const { PetCompanionEngine, relationshipFor } = require('./pet-companion-engine.cjs')

function safeUsage(value = {}) {
  return {
    outputTokens: Math.max(0, Math.floor(Number(value.outputTokens) || 0)),
    reasoningTokens: Math.max(0, Math.floor(Number(value.reasoningTokens) || 0))
  }
}

function modelQualityOffset(model = '') {
  const value = String(model).toLowerCase()
  if (/(gpt-5[.\w-]*|pro\b|max\b|reason|deepseek-r1|opus)/.test(value)) return 10
  if (/(flash|mini|lite|small|haiku|free)/.test(value)) return -10
  return 0
}

function qualityFor({ model, completed, blocked }) {
  const score = 50 + modelQualityOffset(model) + (completed ? 15 : 0) - (blocked ? 30 : 0)
  if (score >= 70) return 'refined'
  if (score >= 40) return 'standard'
  return 'fragments'
}

function quantityFor(outputTokens, completed) {
  const base = outputTokens > 0 ? Math.ceil(outputTokens / TOK_PER_UNIT) : 0
  return Math.min(TASK_TOK_CAP, base + (completed ? 2 : 0))
}

class PetDomainService {
  constructor({ store, getPreferences = () => ({}), onChange = () => {}, now = () => new Date(), companionEngine = null }) {
    this.store = store
    this.getPreferences = getPreferences
    this.onChange = onChange
    this.now = now
    this.companionEngine = companionEngine || new PetCompanionEngine({ now: () => this.nowDate() })
    this.sessions = new Map()
    this.groupAwards = new Map()
    this.lastAward = null
    this.lastAutoFeed = null
    this.celebrationTimer = null
    this.lastInteractionAt = new Map()
    this.companionCue = null
  }

  nowDate() {
    const value = this.now()
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date : new Date()
  }

  emitCue(cue) {
    if (cue) this.companionCue = cue
    return cue
  }

  rootOf(sessionId) {
    let current = this.sessions.get(sessionId)
    const visited = new Set()
    while (current?.parentSessionId && !visited.has(current.parentSessionId)) {
      visited.add(current.parentSessionId)
      const parent = this.sessions.get(current.parentSessionId)
      if (!parent) return current.parentSessionId
      current = parent
    }
    return current?.sessionId || sessionId
  }

  ensureSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        sessionId,
        parentSessionId: null,
        running: false,
        pendingInput: false,
        blocked: false,
        ready: false,
        celebrating: false,
        model: '',
        usage: safeUsage(),
        finishKind: null,
        updatedAt: this.nowDate().getTime(),
        startedAt: null,
        settled: true,
        nudges: new Set()
      })
    }
    return this.sessions.get(sessionId)
  }

  ingestBaseline(item = {}) {
    if (!item.sessionId) return
    const session = this.ensureSession(item.sessionId)
    session.parentSessionId = item.parentSessionId || session.parentSessionId
    session.running = Boolean(item.running)
    session.model = item.model || session.model
    session.usage = safeUsage(item.tokenUsage)
    session.updatedAt = Number(item.updatedAt) || this.nowDate().getTime()
    if (session.running) {
      session.startedAt ||= session.updatedAt
      session.settled = false
    }
    const persisted = this.store.get().usageCursors[item.sessionId]
    if (!persisted) this.store.initializeCursor(item.sessionId, session.usage.outputTokens, this.now())
    this.publish()
  }

  ingest(event = {}) {
    const sessionId = event.sessionId
    if (!sessionId) return
    const session = this.ensureSession(sessionId)
    session.updatedAt = this.nowDate().getTime()
    if (event.type === 'session-added') {
      session.parentSessionId = event.parentSessionId || null
    } else if (event.type === 'session-status') {
      const wasRunning = session.running
      session.running = Boolean(event.running)
      if (session.running && !wasRunning) {
        session.blocked = false
        session.ready = false
        session.celebrating = false
        session.finishKind = null
        session.startedAt = session.updatedAt
        session.settled = false
        session.nudges = new Set()
        const root = this.rootOf(sessionId)
        if (sessionId === root || !this.groupAwards.has(root)) this.groupAwards.set(root, 0)
        const running = [...this.sessions.values()].filter(item => item.running).length
        this.emitCue(this.companionEngine.taskStarted({ state: this.getState(), preferences: this.getPreferences(), running }))
      } else if (!session.running && wasRunning) {
        this.settleSession(session)
      }
    } else if (event.type === 'token-usage') {
      session.usage = safeUsage(event.value)
    } else if (event.type === 'needs-input') {
      const wasPending = session.pendingInput
      session.pendingInput = true
      if (!wasPending) this.emitCue(this.companionEngine.needsInput({ preferences: this.getPreferences() }))
    } else if (event.type === 'input-resolved') {
      const wasPending = session.pendingInput
      session.pendingInput = false
      if (wasPending) this.emitCue(this.companionEngine.inputResolved({ preferences: this.getPreferences() }))
    } else if (event.type === 'agent-error') {
      const alreadySettled = session.settled
      const wasBlocked = session.blocked
      session.blocked = true
      session.running = false
      if (!alreadySettled) this.settleSession(session, false)
      else if (this.rootOf(sessionId) !== sessionId) session.blocked = false
      else if (!wasBlocked) this.emitCue(this.companionEngine.taskBlocked({ preferences: this.getPreferences() }))
    } else if (event.type === 'finish') {
      session.finishKind = event.kind || null
    } else if (event.type === 'model') {
      session.model = event.model || session.model
    } else if (event.type === 'session-removed') {
      this.sessions.delete(sessionId)
    }
    this.publish()
  }

  settleSession(session, successOverride) {
    if (session.settled) return
    session.settled = true
    const settledAt = this.nowDate()
    const state = this.store.get()
    const previous = state.usageCursors[session.sessionId]?.outputTokens ?? session.usage.outputTokens
    const observedTokens = Math.max(0, session.usage.outputTokens - previous)
    const cancelled = ['cancelled', 'abort', 'aborted'].includes(session.finishKind?.kind || session.finishKind)
    const completed = successOverride ?? (!session.blocked && !cancelled && observedTokens > 0)
    const root = this.rootOf(session.sessionId)
    const countTask = root === session.sessionId
    const alreadyAwarded = this.groupAwards.get(root) || 0
    const requested = quantityFor(observedTokens, completed)
    const quantity = Math.max(0, Math.min(requested, TASK_TOK_CAP - alreadyAwarded))
    const quality = qualityFor({ model: session.model, completed, blocked: session.blocked || cancelled })
    this.groupAwards.set(root, alreadyAwarded + quantity)
    const persisted = this.store.settleTask({
      sessionId: session.sessionId,
      outputTokens: session.usage.outputTokens,
      observedTokens,
      quality,
      quantity,
      completed,
      countTask
    }, settledAt)
    session.pendingInput = false
    session.blocked = countTask ? session.blocked : false
    session.ready = completed && countTask
    session.celebrating = completed && countTask
    if (quantity > 0) this.lastAward = { sessionId: session.sessionId, quality, quantity, outputTokens: observedTokens, at: settledAt.toISOString() }
    if (completed && countTask) this.scheduleCelebrationEnd(session.sessionId)
    this.maybeAutoFeed()
    if (completed && countTask) {
      this.emitCue(this.companionEngine.taskCompleted({ state: persisted, preferences: this.getPreferences(), quantity, quality }))
    } else if (!completed && countTask) {
      this.emitCue(this.companionEngine.taskBlocked({ preferences: this.getPreferences(), cancelled }))
    }
  }

  scheduleCelebrationEnd(sessionId) {
    clearTimeout(this.celebrationTimer)
    this.celebrationTimer = setTimeout(() => {
      const session = this.sessions.get(sessionId)
      if (session) session.celebrating = false
      this.publish()
    }, 8000)
    this.celebrationTimer.unref?.()
  }

  maybeAutoFeed() {
    if (this.getPreferences().autoFeed === false) return
    let state = this.store.get()
    if (state.fullness >= 60) return
    let consumed = 0
    let lastKind = null
    for (const kind of ['fragments', 'standard', 'refined']) {
      while (state.fullness < 60 && state.inventory[kind] > 0) {
        state = this.store.feed(kind, this.nowDate())
        consumed += 1
        lastKind = kind
      }
    }
    if (consumed > 0) this.lastAutoFeed = { kind: lastKind, quantity: consumed, at: this.nowDate().toISOString() }
  }

  feed(kind) {
    const state = this.store.feed(kind, this.nowDate())
    this.publish()
    return state
  }

  interact(kind = 'tap') {
    const date = this.nowDate()
    const now = date.getTime()
    const previous = this.lastInteractionAt.get(kind) || 0
    if (now - previous < 1200) return this.getState()
    this.lastInteractionAt.set(kind, now)
    const previousLevel = relationshipFor(this.store.get()).level
    const persisted = this.store.interact(kind, date)
    this.emitCue(this.companionEngine.interaction({ state: persisted, preferences: this.getPreferences(), kind, previousLevel }))
    this.publish()
    return this.getState()
  }

  tickActive(minutes = 1) {
    const date = this.nowDate()
    this.store.tickActive(minutes, date)
    this.maybeAutoFeed()
    this.maybeLongRunningCue(date)
    this.publish()
  }

  maybeLongRunningCue(date = this.nowDate()) {
    const running = [...this.sessions.values()]
      .filter(session => session.running && Number.isFinite(session.startedAt))
      .sort((left, right) => right.startedAt - left.startedAt)
    for (const session of running) {
      const elapsedMinutes = Math.floor((date.getTime() - session.startedAt) / 60_000)
      const threshold = [50, 25].find(value => elapsedMinutes >= value && !session.nudges.has(value))
      if (!threshold) continue
      const cue = this.companionEngine.longRunning({ preferences: this.getPreferences(), elapsedMinutes })
      if (cue) {
        for (const milestone of [25, 50]) {
          if (milestone <= threshold) session.nudges.add(milestone)
        }
        this.emitCue(cue)
        return cue
      }
    }
    return null
  }

  awaken({ announce = true, publish = true } = {}) {
    const result = this.store.awaken(this.nowDate())
    if (announce) {
      this.emitCue(this.companionEngine.awakening({
        state: result.state,
        preferences: this.getPreferences(),
        awayMinutes: result.awayMinutes
      }))
    }
    if (publish) this.publish()
    return this.getState()
  }

  markRead(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.ready = false
      session.celebrating = false
      this.publish()
    }
  }

  resetTransient() {
    for (const session of this.sessions.values()) {
      session.running = false
      session.pendingInput = false
      session.celebrating = false
    }
    this.publish()
  }

  operationalState() {
    const sessions = [...this.sessions.values()]
    const byNewest = list => list.sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const needsInput = byNewest(sessions.filter(item => item.pendingInput))
    if (needsInput) return { status: 'needs-input', focusSessionId: needsInput.sessionId }
    const blocked = byNewest(sessions.filter(item => item.blocked))
    if (blocked) return { status: 'blocked', focusSessionId: blocked.sessionId }
    const celebrating = byNewest(sessions.filter(item => item.celebrating))
    if (celebrating) return { status: 'celebrating', focusSessionId: celebrating.sessionId }
    const ready = byNewest(sessions.filter(item => item.ready))
    if (ready) return { status: 'ready', focusSessionId: ready.sessionId }
    const running = byNewest(sessions.filter(item => item.running))
    if (running) return { status: 'working', focusSessionId: running.sessionId }
    const persisted = this.store.get()
    if (persisted.fullness <= 0 || persisted.energy <= 0) return { status: 'sleeping', focusSessionId: null }
    return { status: 'idle', focusSessionId: null }
  }

  getState() {
    const persisted = this.store.get()
    const operational = this.operationalState()
    return {
      ...persisted,
      ...operational,
      hungry: persisted.fullness < 25,
      tired: persisted.energy < 25,
      moodBand: persisted.mood >= 75 ? 'happy' : persisted.mood < 35 ? 'sad' : 'content',
      energyBand: persisted.energy >= 70 ? 'lively' : persisted.energy < 25 ? 'tired' : 'steady',
      relationship: relationshipFor(persisted),
      companionCue: this.companionCue,
      lastAward: this.lastAward,
      lastAutoFeed: this.lastAutoFeed,
      activity: {
        running: [...this.sessions.values()].filter(item => item.running).length,
        needsInput: [...this.sessions.values()].filter(item => item.pendingInput).length,
        blocked: [...this.sessions.values()].filter(item => item.blocked).length,
        ready: [...this.sessions.values()].filter(item => item.ready).length
      }
    }
  }

  publish() {
    this.onChange(this.getState())
  }

  dispose() {
    clearTimeout(this.celebrationTimer)
  }
}

module.exports = {
  PetDomainService,
  TASK_TOK_CAP,
  TOK_PER_UNIT,
  modelQualityOffset,
  qualityFor,
  quantityFor,
  safeUsage
}
