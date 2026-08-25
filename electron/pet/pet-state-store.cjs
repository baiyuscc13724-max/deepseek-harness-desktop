const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const MAX_CURSOR_ENTRIES = 300
const MAX_INVENTORY = 999

const DEFAULT_PET_STATE = Object.freeze({
  schemaVersion: 3,
  fullness: 80,
  energy: 78,
  mood: 72,
  affection: 0,
  inventory: { refined: 0, standard: 0, fragments: 0 },
  lifetime: { tasksCompleted: 0, tokensObserved: 0, tokProduced: 0 },
  companion: {
    firstMetAt: null,
    lastSeenAt: null,
    activeMinutes: 0,
    daysTogether: 0,
    sessionsTogether: 0,
    taskStreak: 0,
    bestTaskStreak: 0,
    interactions: { tap: 0, petting: 0, play: 0 },
    daily: { date: null, tasks: 0, completed: 0, interrupted: 0, interactions: 0, activeMinutes: 0, tokensObserved: 0, tokProduced: 0 }
  },
  usageCursors: {},
  activeMinutesRemainder: 0,
  lastActiveAt: null
})

function clampNumber(value, minimum, maximum, fallback = minimum) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function normalizeInventory(value = {}) {
  return {
    refined: Math.floor(clampNumber(value.refined, 0, MAX_INVENTORY, 0)),
    standard: Math.floor(clampNumber(value.standard, 0, MAX_INVENTORY, 0)),
    fragments: Math.floor(clampNumber(value.fragments, 0, MAX_INVENTORY, 0))
  }
}

function normalizeUsageCursors(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value)
    .filter(([sessionId, cursor]) => typeof sessionId === 'string' && sessionId.length <= 160 && Number.isFinite(Number(cursor?.outputTokens)))
    .map(([sessionId, cursor]) => [sessionId, {
      outputTokens: Math.max(0, Math.floor(Number(cursor.outputTokens))),
      updatedAt: Number.isFinite(Number(cursor.updatedAt)) ? Number(cursor.updatedAt) : 0
    }])
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, MAX_CURSOR_ENTRIES)
  return Object.fromEntries(entries)
}

function safeIsoDate(value) {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function normalizeCompanion(value = {}) {
  const firstMetAt = safeIsoDate(value.firstMetAt)
  const dailyDate = typeof value.daily?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.daily.date)
    ? value.daily.date
    : null
  return {
    firstMetAt,
    lastSeenAt: safeIsoDate(value.lastSeenAt),
    activeMinutes: clampNumber(value.activeMinutes, 0, Number.MAX_SAFE_INTEGER, 0),
    daysTogether: Math.floor(clampNumber(value.daysTogether, 0, 100_000, firstMetAt ? 1 : 0)),
    sessionsTogether: Math.floor(clampNumber(value.sessionsTogether, 0, Number.MAX_SAFE_INTEGER, 0)),
    taskStreak: Math.floor(clampNumber(value.taskStreak, 0, 100_000, 0)),
    bestTaskStreak: Math.floor(clampNumber(value.bestTaskStreak, 0, 100_000, 0)),
    interactions: {
      tap: Math.floor(clampNumber(value.interactions?.tap, 0, Number.MAX_SAFE_INTEGER, 0)),
      petting: Math.floor(clampNumber(value.interactions?.petting, 0, Number.MAX_SAFE_INTEGER, 0)),
      play: Math.floor(clampNumber(value.interactions?.play, 0, Number.MAX_SAFE_INTEGER, 0))
    },
    daily: {
      date: dailyDate,
      tasks: Math.floor(clampNumber(value.daily?.tasks, 0, Number.MAX_SAFE_INTEGER, 0)),
      completed: Math.floor(clampNumber(value.daily?.completed, 0, Number.MAX_SAFE_INTEGER, 0)),
      interrupted: Math.floor(clampNumber(value.daily?.interrupted, 0, Number.MAX_SAFE_INTEGER, 0)),
      interactions: Math.floor(clampNumber(value.daily?.interactions, 0, Number.MAX_SAFE_INTEGER, 0)),
      activeMinutes: clampNumber(value.daily?.activeMinutes, 0, 1440, 0),
      tokensObserved: Math.floor(clampNumber(value.daily?.tokensObserved, 0, Number.MAX_SAFE_INTEGER, 0)),
      tokProduced: Math.floor(clampNumber(value.daily?.tokProduced, 0, Number.MAX_SAFE_INTEGER, 0))
    }
  }
}

function validDate(value = new Date()) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date()
}

function localDayKey(value = new Date()) {
  const date = validDate(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizePetState(input) {
  const value = input && typeof input === 'object' ? input : {}
  return {
    schemaVersion: 3,
    fullness: clampNumber(value.fullness, 0, 100, 80),
    energy: clampNumber(value.energy, 0, 100, 78),
    mood: clampNumber(value.mood, 0, 100, 72),
    affection: Math.floor(clampNumber(value.affection, 0, 9999, 0)),
    inventory: normalizeInventory(value.inventory),
    lifetime: {
      tasksCompleted: Math.floor(clampNumber(value.lifetime?.tasksCompleted, 0, Number.MAX_SAFE_INTEGER, 0)),
      tokensObserved: Math.floor(clampNumber(value.lifetime?.tokensObserved, 0, Number.MAX_SAFE_INTEGER, 0)),
      tokProduced: Math.floor(clampNumber(value.lifetime?.tokProduced, 0, Number.MAX_SAFE_INTEGER, 0))
    },
    companion: normalizeCompanion(value.companion),
    usageCursors: normalizeUsageCursors(value.usageCursors),
    activeMinutesRemainder: clampNumber(value.activeMinutesRemainder, 0, 15, 0),
    lastActiveAt: typeof value.lastActiveAt === 'string' ? value.lastActiveAt : null
  }
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_PET_STATE))
}

class PetStateStore {
  constructor(file) {
    this.file = file
    this.state = this.#load()
  }

  #load() {
    try { return normalizePetState(JSON.parse(readFileSync(this.file, 'utf8'))) }
    catch { return cloneDefaultState() }
  }

  #persist() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, this.file)
  }

  get() {
    return JSON.parse(JSON.stringify(this.state))
  }

  #touch(date = new Date()) {
    const current = validDate(date)
    const iso = current.toISOString()
    const day = localDayKey(current)
    if (this.state.companion.daily.date !== day) {
      const previousDay = this.state.companion.daily.date
      const firstDay = this.state.companion.firstMetAt ? localDayKey(new Date(this.state.companion.firstMetAt)) : null
      this.state.companion.daily = {
        date: day,
        tasks: 0,
        completed: 0,
        interrupted: 0,
        interactions: 0,
        activeMinutes: 0,
        tokensObserved: 0,
        tokProduced: 0
      }
      if (this.state.companion.daysTogether <= 0) this.state.companion.daysTogether = 1
      else if (previousDay || (firstDay && firstDay !== day)) this.state.companion.daysTogether = Math.min(100_000, this.state.companion.daysTogether + 1)
    }
    if (!this.state.companion.firstMetAt) this.state.companion.firstMetAt = iso
    this.state.companion.lastSeenAt = iso
    return current
  }

  awaken(date = new Date()) {
    const current = validDate(date)
    const previous = this.state.companion.lastSeenAt ? new Date(this.state.companion.lastSeenAt) : null
    const awayMinutes = previous && Number.isFinite(previous.getTime())
      ? Math.max(0, Math.floor((current.getTime() - previous.getTime()) / 60_000))
      : 0
    this.#touch(current)
    this.state.companion.sessionsTogether = Math.min(Number.MAX_SAFE_INTEGER, this.state.companion.sessionsTogether + 1)
    this.#persist()
    return { state: this.get(), awayMinutes }
  }

  initializeCursor(sessionId, outputTokens, date = new Date()) {
    if (this.state.usageCursors[sessionId]) return this.get()
    this.state.usageCursors[sessionId] = {
      outputTokens: Math.max(0, Math.floor(Number(outputTokens) || 0)),
      updatedAt: date.getTime()
    }
    this.state.usageCursors = normalizeUsageCursors(this.state.usageCursors)
    this.#persist()
    return this.get()
  }

  settleTask({ sessionId, outputTokens, observedTokens = 0, quality = 'standard', quantity = 0, completed = true, countTask = true }, date = new Date()) {
    const eventDate = this.#touch(date)
    const current = Math.max(0, Math.floor(Number(outputTokens) || 0))
    this.state.usageCursors[sessionId] = { outputTokens: current, updatedAt: eventDate.getTime() }
    this.state.usageCursors = normalizeUsageCursors(this.state.usageCursors)
    const safeQuantity = Math.min(12, Math.max(0, Math.floor(Number(quantity) || 0)))
    const bucket = ['refined', 'standard', 'fragments'].includes(quality) ? quality : 'standard'
    this.state.inventory[bucket] = Math.min(MAX_INVENTORY, this.state.inventory[bucket] + safeQuantity)
    this.state.lifetime.tokensObserved += Math.max(0, Math.floor(Number(observedTokens) || 0))
    this.state.lifetime.tokProduced += safeQuantity
    const countsTowardCompanionship = countTask !== false
    if (completed && countsTowardCompanionship) this.state.lifetime.tasksCompleted += 1
    this.state.companion.daily.tokensObserved += Math.max(0, Math.floor(Number(observedTokens) || 0))
    this.state.companion.daily.tokProduced += safeQuantity
    if (countsTowardCompanionship) {
      this.state.companion.daily.tasks += 1
      if (completed) {
        this.state.companion.daily.completed += 1
        this.state.companion.taskStreak = Math.min(100_000, this.state.companion.taskStreak + 1)
        this.state.companion.bestTaskStreak = Math.max(this.state.companion.bestTaskStreak, this.state.companion.taskStreak)
      } else {
        this.state.companion.daily.interrupted += 1
        this.state.companion.taskStreak = 0
      }
    }
    if (countsTowardCompanionship) {
      this.state.energy = Math.max(0, this.state.energy - 1)
      this.state.mood = clampNumber(this.state.mood + (completed ? 4 : -5), 0, 100, 50)
      if (completed) this.state.affection = Math.min(9999, this.state.affection + 1)
    }
    this.#persist()
    return this.get()
  }

  feed(kind = 'standard', date = new Date()) {
    const nutrition = { refined: 18, standard: 10, fragments: 4 }
    const bucket = Object.prototype.hasOwnProperty.call(nutrition, kind) ? kind : 'standard'
    if (this.state.inventory[bucket] < 1 || this.state.fullness >= 100) return this.get()
    this.#touch(date)
    this.state.inventory[bucket] -= 1
    this.state.fullness = Math.min(100, this.state.fullness + nutrition[bucket])
    this.state.energy = Math.min(100, this.state.energy + ({ refined: 5, standard: 3, fragments: 1 })[bucket])
    this.state.mood = Math.min(100, this.state.mood + ({ refined: 4, standard: 2, fragments: 1 })[bucket])
    this.#persist()
    return this.get()
  }

  interact(kind = 'tap', date = new Date()) {
    const interaction = ['tap', 'petting', 'play'].includes(kind) ? kind : 'tap'
    this.#touch(date)
    this.state.companion.interactions[interaction] = Math.min(Number.MAX_SAFE_INTEGER, this.state.companion.interactions[interaction] + 1)
    this.state.companion.daily.interactions += 1
    if (interaction === 'petting') {
      this.state.mood = Math.min(100, this.state.mood + 3)
      this.state.affection = Math.min(9999, this.state.affection + 1)
    } else if (interaction === 'play') {
      this.state.mood = Math.min(100, this.state.mood + 2)
      this.state.energy = Math.max(0, this.state.energy - 1)
    } else {
      this.state.mood = Math.min(100, this.state.mood + 1)
    }
    this.#persist()
    return this.get()
  }

  tickActive(minutes = 1, date = new Date()) {
    const amount = clampNumber(minutes, 0, 60, 0)
    const activeDate = this.#touch(date)
    this.state.companion.activeMinutes = Math.min(Number.MAX_SAFE_INTEGER, this.state.companion.activeMinutes + amount)
    this.state.companion.daily.activeMinutes = Math.min(1440, this.state.companion.daily.activeMinutes + amount)
    this.state.activeMinutesRemainder += amount
    const points = Math.floor(this.state.activeMinutesRemainder / 15)
    this.state.activeMinutesRemainder %= 15
    if (points > 0) {
      this.state.fullness = Math.max(0, this.state.fullness - points)
      this.state.energy = Math.max(0, this.state.energy - points)
      if (this.state.fullness < 25 || this.state.energy < 20) this.state.mood = Math.max(0, this.state.mood - points)
    }
    this.state.lastActiveAt = activeDate.toISOString()
    this.#persist()
    return this.get()
  }
}

module.exports = {
  DEFAULT_PET_STATE,
  MAX_INVENTORY,
  PetStateStore,
  localDayKey,
  normalizeCompanion,
  normalizePetState,
  normalizeUsageCursors
}
