const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const MAX_CURSOR_ENTRIES = 300
const MAX_INVENTORY = 999

const DEFAULT_PET_STATE = Object.freeze({
  schemaVersion: 2,
  fullness: 80,
  energy: 78,
  mood: 72,
  affection: 0,
  inventory: { refined: 0, standard: 0, fragments: 0 },
  lifetime: { tasksCompleted: 0, tokensObserved: 0, tokProduced: 0 },
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

function normalizePetState(input) {
  const value = input && typeof input === 'object' ? input : {}
  return {
    schemaVersion: 2,
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

  settleTask({ sessionId, outputTokens, observedTokens = 0, quality = 'standard', quantity = 0, completed = true }, date = new Date()) {
    const current = Math.max(0, Math.floor(Number(outputTokens) || 0))
    this.state.usageCursors[sessionId] = { outputTokens: current, updatedAt: date.getTime() }
    this.state.usageCursors = normalizeUsageCursors(this.state.usageCursors)
    const safeQuantity = Math.min(12, Math.max(0, Math.floor(Number(quantity) || 0)))
    const bucket = ['refined', 'standard', 'fragments'].includes(quality) ? quality : 'standard'
    this.state.inventory[bucket] = Math.min(MAX_INVENTORY, this.state.inventory[bucket] + safeQuantity)
    this.state.lifetime.tokensObserved += Math.max(0, Math.floor(Number(observedTokens) || 0))
    this.state.lifetime.tokProduced += safeQuantity
    if (completed) this.state.lifetime.tasksCompleted += 1
    this.state.energy = Math.max(0, this.state.energy - 1)
    this.state.mood = clampNumber(this.state.mood + (completed ? 4 : -5), 0, 100, 50)
    if (completed) this.state.affection = Math.min(9999, this.state.affection + 1)
    this.#persist()
    return this.get()
  }

  feed(kind = 'standard') {
    const nutrition = { refined: 18, standard: 10, fragments: 4 }
    const bucket = Object.prototype.hasOwnProperty.call(nutrition, kind) ? kind : 'standard'
    if (this.state.inventory[bucket] < 1 || this.state.fullness >= 100) return this.get()
    this.state.inventory[bucket] -= 1
    this.state.fullness = Math.min(100, this.state.fullness + nutrition[bucket])
    this.state.energy = Math.min(100, this.state.energy + ({ refined: 5, standard: 3, fragments: 1 })[bucket])
    this.state.mood = Math.min(100, this.state.mood + ({ refined: 4, standard: 2, fragments: 1 })[bucket])
    this.#persist()
    return this.get()
  }

  interact(kind = 'tap') {
    if (kind === 'petting') {
      this.state.mood = Math.min(100, this.state.mood + 3)
      this.state.affection = Math.min(9999, this.state.affection + 1)
    } else if (kind === 'play') {
      this.state.mood = Math.min(100, this.state.mood + 2)
      this.state.energy = Math.max(0, this.state.energy - 1)
    } else {
      this.state.mood = Math.min(100, this.state.mood + 1)
    }
    this.#persist()
    return this.get()
  }

  tickActive(minutes = 1) {
    const amount = clampNumber(minutes, 0, 60, 0)
    this.state.activeMinutesRemainder += amount
    const points = Math.floor(this.state.activeMinutesRemainder / 15)
    this.state.activeMinutesRemainder %= 15
    if (points > 0) {
      this.state.fullness = Math.max(0, this.state.fullness - points)
      this.state.energy = Math.max(0, this.state.energy - points)
      if (this.state.fullness < 25 || this.state.energy < 20) this.state.mood = Math.max(0, this.state.mood - points)
    }
    this.state.lastActiveAt = new Date().toISOString()
    this.#persist()
    return this.get()
  }
}

module.exports = {
  DEFAULT_PET_STATE,
  MAX_INVENTORY,
  PetStateStore,
  normalizePetState,
  normalizeUsageCursors
}
