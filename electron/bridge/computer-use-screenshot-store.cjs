const { randomUUID } = require('node:crypto')
const { lstat, mkdir, readdir, stat, unlink, writeFile } = require('node:fs/promises')
const path = require('node:path')

const SCREENSHOT_FILE = /^window-(\d{13})(?:-([a-f0-9-]{8,}))?\.png$/i
const DEFAULT_MAX_FILES = 12
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 12 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

class ComputerUseScreenshotStore {
  constructor(options = {}) {
    if (!options.directory) throw new Error('Computer Use 截图目录不能为空。')
    this.directory = path.resolve(options.directory)
    this.maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES)
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES)
    this.maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
    this.maxAgeMs = positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS)
  }

  async #ensureDirectory() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    const info = await lstat(this.directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Computer Use 截图目录必须是常规目录。')
  }

  async #managedEntries() {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(error => {
      if (error?.code === 'ENOENT') return []
      throw error
    })
    const managed = []
    for (const entry of entries) {
      const match = SCREENSHOT_FILE.exec(entry.name)
      if (!match || !entry.isFile()) continue
      const file = path.join(this.directory, entry.name)
      const info = await stat(file).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
      if (!info?.isFile()) continue
      managed.push({ file, name: entry.name, bytes: info.size, createdAt: Number(match[1]), modifiedAt: info.mtimeMs })
    }
    return managed
  }

  async prune(options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
    const removeAll = options.removeAll === true
    await this.#ensureDirectory()
    const entries = (await this.#managedEntries()).sort((left, right) => right.createdAt - left.createdAt || right.modifiedAt - left.modifiedAt)
    let retainedBytes = 0
    let retainedFiles = 0
    let deletedBytes = 0
    let deletedFiles = 0
    for (const entry of entries) {
      const expired = entry.createdAt > now + 60_000 || now - entry.createdAt > this.maxAgeMs
      const overCount = retainedFiles >= this.maxFiles
      const overBytes = retainedBytes + entry.bytes > this.maxBytes
      if (removeAll || expired || overCount || overBytes) {
        await unlink(entry.file).catch(error => { if (error?.code !== 'ENOENT') throw error })
        deletedBytes += entry.bytes
        deletedFiles += 1
        continue
      }
      retainedBytes += entry.bytes
      retainedFiles += 1
    }
    return { deletedFiles, deletedBytes, retainedFiles, retainedBytes }
  }

  async save(png, options = {}) {
    const data = Buffer.isBuffer(png) ? png : Buffer.from(png || [])
    if (!data.length || data.length > this.maxFileBytes) throw new Error('Computer Use 截图为空或超过单文件限制。')
    const now = Number.isFinite(Number(options.now)) ? Math.round(Number(options.now)) : Date.now()
    await this.prune({ now })
    const file = path.join(this.directory, `window-${now}-${randomUUID()}.png`)
    await writeFile(file, data, { mode: 0o600, flag: 'wx' })
    await this.prune({ now })
    return file
  }

  async clear() {
    const info = await lstat(this.directory).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
    if (!info) return { deletedFiles: 0, deletedBytes: 0, retainedFiles: 0, retainedBytes: 0 }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Computer Use 截图目录必须是常规目录。')
    return this.prune({ removeAll: true })
  }
}

module.exports = {
  ComputerUseScreenshotStore,
  SCREENSHOT_FILE,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_AGE_MS
}
