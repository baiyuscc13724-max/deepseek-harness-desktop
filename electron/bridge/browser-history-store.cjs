const { randomUUID } = require('node:crypto')
const { mkdir, readFile, rename, stat, writeFile } = require('node:fs/promises')
const path = require('node:path')
const { safeText } = require('./browser-diagnostics.cjs')

const SCHEMA_VERSION = 2
const DEFAULT_MAX_ENTRIES = 500
const MAX_FILE_BYTES = 1_048_576

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function safeHistoryUrl(value) {
  try {
    const url = new URL(String(value || ''))
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.origin
  } catch {
    return ''
  }
}

function publicEntry(entry) {
  return { id: entry.id, url: entry.url, title: entry.title, visitedAt: entry.visitedAt, visits: entry.visits }
}

class BrowserHistoryStore {
  constructor({ file = '', maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now(), idFactory = randomUUID } = {}) {
    this.file = file ? path.resolve(file) : ''
    this.maxEntries = boundedInteger(maxEntries, DEFAULT_MAX_ENTRIES, 10, 2_000)
    this.now = now
    this.idFactory = idFactory
    this.entries = []
    this.loaded = false
    this.loadPromise = null
    this.writeChain = Promise.resolve()
  }

  async load() {
    if (this.loaded) return this.list()
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = (async () => {
      let rewrite = false
      if (this.file) {
        try {
          const info = await stat(this.file)
          if (info.isFile() && info.size <= MAX_FILE_BYTES) {
            const parsed = JSON.parse(await readFile(this.file, 'utf8'))
            const sourceEntries = Array.isArray(parsed?.entries) ? parsed.entries : []
            const canonicalTopLevel = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries) && Object.keys(parsed).every(key => key === 'version' || key === 'entries')
            this.entries = sourceEntries.map(item => this.#normalize(item)).filter(Boolean).slice(0, this.maxEntries)
            rewrite = !canonicalTopLevel || parsed?.version !== SCHEMA_VERSION || JSON.stringify(sourceEntries) !== JSON.stringify(this.entries)
          } else {
            rewrite = true
          }
        } catch {
          rewrite = true
        }
      }
      this.loaded = true
      if (rewrite) await this.#save()
      return this.list()
    })()
    return this.loadPromise
  }

  async add(url, title = '') {
    await this.load()
    const normalizedUrl = safeHistoryUrl(url)
    if (!normalizedUrl) return null
    const normalizedTitle = ''
    const existing = this.entries.find(item => item.url === normalizedUrl)
    if (existing) {
      existing.title = normalizedTitle || existing.title
      existing.visitedAt = this.now()
      existing.visits = Math.min(Number.MAX_SAFE_INTEGER, existing.visits + 1)
      this.entries = [existing, ...this.entries.filter(item => item !== existing)]
    } else {
      this.entries.unshift({ id: String(this.idFactory()), url: normalizedUrl, title: normalizedTitle, visitedAt: this.now(), visits: 1 })
    }
    if (this.entries.length > this.maxEntries) this.entries.length = this.maxEntries
    await this.#save()
    return publicEntry(this.entries[0])
  }

  async updateTitle(url, title = '') {
    await this.load()
    const normalizedUrl = safeHistoryUrl(url)
    const existing = this.entries.find(item => item.url === normalizedUrl)
    if (!existing) return false
    if (existing.title) {
      existing.title = ''
      await this.#save()
    }
    return true
  }

  async search(query = '', { limit = 50 } = {}) {
    await this.load()
    const needle = String(query || '').trim().toLocaleLowerCase()
    const maximum = boundedInteger(limit, 50, 1, 200)
    return this.entries
      .filter(item => !needle || `${item.title}\n${item.url}`.toLocaleLowerCase().includes(needle))
      .slice(0, maximum)
      .map(publicEntry)
  }

  async remove(id) {
    await this.load()
    const before = this.entries.length
    this.entries = this.entries.filter(item => item.id !== String(id || ''))
    if (this.entries.length !== before) await this.#save()
    return this.entries.length !== before
  }

  async clear() {
    await this.load()
    this.entries = []
    await this.#save()
  }

  list({ limit = 100 } = {}) {
    const maximum = boundedInteger(limit, 100, 1, 500)
    return this.entries.slice(0, maximum).map(publicEntry)
  }

  #normalize(value) {
    const url = safeHistoryUrl(value?.url)
    const id = safeText(value?.id, 100)
    if (!url || !id) return null
    return {
      id,
      url,
      title: '',
      visitedAt: Math.max(0, Number(value?.visitedAt) || 0),
      visits: boundedInteger(value?.visits, 1, 1, Number.MAX_SAFE_INTEGER)
    }
  }

  async #save() {
    if (!this.file) return
    const payload = JSON.stringify({ version: SCHEMA_VERSION, entries: this.entries })
    const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    const write = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
    })
    this.writeChain = write.catch(() => {})
    return write
  }
}

module.exports = { BrowserHistoryStore, DEFAULT_MAX_ENTRIES, MAX_FILE_BYTES, SCHEMA_VERSION, safeHistoryUrl }
