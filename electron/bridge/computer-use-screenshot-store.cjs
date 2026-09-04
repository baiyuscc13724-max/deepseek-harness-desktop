const { createHash, randomUUID } = require('node:crypto')
const { constants: fsConstants } = require('node:fs')
const { lstat, mkdir, open, readdir, rename, stat, unlink, writeFile } = require('node:fs/promises')
const path = require('node:path')

const SCREENSHOT_FILE = /^window-(\d{13})(?:-([a-f0-9-]{8,}))?\.png$/i
const QUARANTINE_FILE = /^(window-\d{13}(?:-[a-f0-9-]{8,})?\.png)\.(\d{13})\.quarantine$/i
const DEFAULT_MAX_FILES = 12
const DEFAULT_MAX_BYTES = 48 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 12 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000
const DEFAULT_TOKEN_TTL_MS = 10 * 60 * 1000
const DEFAULT_GC_SAFETY_MS = 10 * 60 * 1000
const DEFAULT_QUARANTINE_DELAY_MS = 60 * 1000
const DEFAULT_SCAN_MAX_ENTRIES = 10_000
const DEFAULT_SCAN_MAX_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_INDEX_MAX_BYTES = 16 * 1024 * 1024
const SCREENSHOT_GC_FLAG = 'HARNESS_DESKTOP_PREVIEW_SAFE_GC'
const REFERENCE_KINDS = new Set(['attachment', 'tool-card', 'history', 'token'])
const RUNTIME_ID = randomUUID()
const STORE_LOCKS = new Map()
const COMPUTER_USE_SCREENSHOT_NAMESPACES = Object.freeze({ evidence: 'evidence', preview: 'preview' })

function computerUseScreenshotDirectory(runtimeRoot, namespace) {
  const selected = String(namespace || '')
  if (!Object.hasOwn(COMPUTER_USE_SCREENSHOT_NAMESPACES, selected)) throw new Error('Computer Use 截图命名空间无效。')
  return path.join(path.resolve(runtimeRoot), 'computer-use', COMPUTER_USE_SCREENSHOT_NAMESPACES[selected], 'screenshots')
}

function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

function gcFlagEnabled(environment = process.env) {
  const value = String(environment?.[SCREENSHOT_GC_FLAG] ?? 'true').trim().toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

function namespaceForDirectory(directory) {
  if (path.basename(directory).toLowerCase() !== 'screenshots') return 'unknown'
  const namespace = path.basename(path.dirname(directory)).toLowerCase()
  const owner = path.basename(path.dirname(path.dirname(directory))).toLowerCase()
  if (namespace === 'computer-use') return 'legacy'
  if (owner === 'computer-use' && (namespace === 'evidence' || namespace === 'preview')) return namespace
  return 'unknown'
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeReference(value) {
  if (!isRecord(value) || !REFERENCE_KINDS.has(value.kind)) throw new Error('Computer Use 截图引用类型无效。')
  const id = String(value.id || '')
  if (!id || id.length > 256) throw new Error('Computer Use 截图引用 ID 无效。')
  if (value.kind !== 'token') return { kind: value.kind, id }
  const expiresAt = Math.trunc(Number(value.expiresAt))
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) throw new Error('Computer Use 截图 token 过期时间无效。')
  return { kind: value.kind, id, expiresAt }
}

function referenceHash(rows) {
  const canonical = [...rows]
    .map(normalizeReference)
    .sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id) || (left.expiresAt || 0) - (right.expiresAt || 0))
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function identityOf(info) {
  return { bytes: info.size, modifiedAt: Math.trunc(info.mtimeMs), ino: String(info.ino ?? 0) }
}

function sameIdentity(left, right) {
  return left?.bytes === right?.bytes && left?.modifiedAt === right?.modifiedAt && left?.ino === right?.ino
}

function blankIndex(now = 0, runtimeId = RUNTIME_ID) {
  return { version: 3, revision: 0, highWaterMs: Math.max(0, Math.trunc(now)), runtimeId, references: {}, observed: {}, quarantine: {} }
}

function invalidIndex(message) {
  return Object.assign(new Error(message), { code: 'screenshot-reference-index-invalid' })
}

function validateIndex(value) {
  if (!isRecord(value) || value.version !== 3 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Number.isSafeInteger(value.highWaterMs) || value.highWaterMs < 0 || typeof value.runtimeId !== 'string'
    || !isRecord(value.references) || !isRecord(value.observed) || !isRecord(value.quarantine)) {
    throw invalidIndex('Computer Use 截图引用索引损坏；安全 GC 已停止。')
  }
  const references = {}
  let referenceCount = 0
  for (const [name, rows] of Object.entries(value.references)) {
    if (!SCREENSHOT_FILE.test(name) || !Array.isArray(rows) || rows.length > 10_000) throw invalidIndex('Computer Use 截图索引含未知引用。')
    referenceCount += rows.length
    if (referenceCount > 10_000) throw invalidIndex('Computer Use 截图索引引用数量超出安全预算。')
    try { references[name] = rows.map(normalizeReference) } catch { throw invalidIndex('Computer Use 截图索引含未知引用。') }
  }
  const observed = {}
  for (const [name, row] of Object.entries(value.observed)) {
    if (!SCREENSHOT_FILE.test(name) || !isRecord(row) || !Number.isSafeInteger(row.firstSeenAt) || row.firstSeenAt < 0
      || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !Number.isSafeInteger(row.modifiedAt) || row.modifiedAt < 0
      || typeof row.ino !== 'string' || typeof row.owned !== 'boolean' || !/^[a-f0-9]{64}$/i.test(row.referenceHash)) throw invalidIndex('Computer Use 截图观察索引无效。')
    observed[name] = { firstSeenAt: row.firstSeenAt, bytes: row.bytes, modifiedAt: row.modifiedAt, ino: row.ino, referenceHash: row.referenceHash, owned: row.owned }
  }
  const quarantine = {}
  for (const [name, row] of Object.entries(value.quarantine)) {
    const match = typeof row?.file === 'string' ? QUARANTINE_FILE.exec(row.file) : null
    if (!SCREENSHOT_FILE.test(name) || !isRecord(row) || match?.[1] !== name
      || !Number.isSafeInteger(row.quarantinedAt) || row.quarantinedAt < 0
      || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || !Number.isSafeInteger(row.bytes) || row.bytes < 0
      || !Number.isSafeInteger(row.modifiedAt) || row.modifiedAt < 0 || typeof row.ino !== 'string' || typeof row.verifiedRuntimeId !== 'string'
      || !Number.isSafeInteger(row.safeDeleteAfter) || row.safeDeleteAfter < row.quarantinedAt) {
      throw invalidIndex('Computer Use 截图 quarantine 索引无效。')
    }
    quarantine[name] = { file: row.file, quarantinedAt: row.quarantinedAt, createdAt: row.createdAt, bytes: row.bytes, modifiedAt: row.modifiedAt, ino: row.ino, verifiedRuntimeId: row.verifiedRuntimeId, safeDeleteAfter: row.safeDeleteAfter }
  }
  return { version: 3, revision: value.revision, highWaterMs: value.highWaterMs, runtimeId: value.runtimeId, references, observed, quarantine }
}

function withStoreLock(key, operation) {
  const prior = STORE_LOCKS.get(key) || Promise.resolve()
  const running = prior.catch(() => {}).then(operation)
  STORE_LOCKS.set(key, running)
  return running.finally(() => { if (STORE_LOCKS.get(key) === running) STORE_LOCKS.delete(key) })
}

class ComputerUseScreenshotStore {
  constructor(options = {}) {
    if (!options.directory) throw new Error('Computer Use 截图目录不能为空。')
    this.directory = path.resolve(options.directory)
    this.namespace = namespaceForDirectory(this.directory)
    this.maxFiles = positiveInteger(options.maxFiles, DEFAULT_MAX_FILES)
    this.maxBytes = positiveInteger(options.maxBytes, DEFAULT_MAX_BYTES)
    this.maxFileBytes = positiveInteger(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES)
    this.maxAgeMs = positiveInteger(options.maxAgeMs, DEFAULT_MAX_AGE_MS)
    this.tokenTtlMs = positiveInteger(options.tokenTtlMs, DEFAULT_TOKEN_TTL_MS)
    this.gcSafetyMs = positiveInteger(options.gcSafetyMs, DEFAULT_GC_SAFETY_MS)
    this.quarantineDelayMs = positiveInteger(options.quarantineDelayMs, DEFAULT_QUARANTINE_DELAY_MS)
    this.scanMaxEntries = positiveInteger(options.scanMaxEntries, DEFAULT_SCAN_MAX_ENTRIES)
    this.scanMaxBytes = positiveInteger(options.scanMaxBytes, DEFAULT_SCAN_MAX_BYTES)
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.runtimeId = typeof options.runtimeId === 'string' && options.runtimeId ? options.runtimeId : RUNTIME_ID
    this.gcEnabled = typeof options.gcEnabled === 'function' ? options.gcEnabled : options.gcEnabled === undefined ? () => gcFlagEnabled() : () => options.gcEnabled === true
    const namespaceRoot = path.dirname(this.directory)
    this.quarantineDirectory = path.join(namespaceRoot, 'quarantine')
    this.referenceIndexFile = path.join(namespaceRoot, 'reference-index.json')
  }

  #time(value) {
    const number = Math.trunc(Number(value === undefined ? this.now() : value))
    if (!Number.isSafeInteger(number) || number < 0) throw new Error('Computer Use 截图 GC 时间无效。')
    return number
  }

  #nameOf(file) {
    const absolute = path.resolve(file)
    const relative = path.relative(this.directory, absolute)
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.includes(path.sep) || !SCREENSHOT_FILE.test(relative)) {
      throw new Error('Computer Use 截图引用越出当前命名空间。')
    }
    return relative
  }

  async #directoryInfo(directory) {
    return lstat(directory).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
  }

  async #readRegularFile(file) {
    const handle = await open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0))
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size <= 0 || info.size > this.maxFileBytes) throw new Error('Computer Use 截图不是可读取的常规文件。')
      return await handle.readFile()
    } finally {
      await handle.close()
    }
  }

  async #knownNamespacePathSafe() {
    if (this.namespace !== 'preview' && this.namespace !== 'evidence') return true
    const namespaceRoot = path.dirname(this.directory)
    const ownerRoot = path.dirname(namespaceRoot)
    const paths = [ownerRoot, namespaceRoot, this.directory, ...(this.namespace === 'preview' ? [this.quarantineDirectory] : [])]
    for (const directory of paths) {
      const info = await this.#directoryInfo(directory)
      if (info && (!info.isDirectory() || info.isSymbolicLink())) return false
    }
    return true
  }

  async #ensureDirectory(directory = this.directory) {
    if (this.namespace === 'preview' || this.namespace === 'evidence') {
      const namespaceRoot = path.dirname(this.directory)
      const ownerRoot = path.dirname(namespaceRoot)
      for (const target of [ownerRoot, namespaceRoot]) {
        await mkdir(target, { recursive: target === ownerRoot, mode: 0o700 }).catch(error => { if (error?.code !== 'EEXIST') throw error })
        const info = await lstat(target)
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Computer Use 截图目录必须是常规目录。')
      }
      if (directory !== namespaceRoot) {
        await mkdir(directory, { mode: 0o700 }).catch(error => { if (error?.code !== 'EEXIST') throw error })
      }
    } else {
      await mkdir(directory, { recursive: true, mode: 0o700 })
    }
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Computer Use 截图目录必须是常规目录。')
  }

  async #managedEntries() {
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))
    const managed = []
    for (const entry of entries) {
      const match = SCREENSHOT_FILE.exec(entry.name)
      if (!match || !entry.isFile()) continue
      const file = path.join(this.directory, entry.name)
      const info = await stat(file).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
      if (info?.isFile()) managed.push({ file, name: entry.name, createdAt: Number(match[1]), ...identityOf(info) })
    }
    return managed
  }

  async #quarantineEntries() {
    const entries = await readdir(this.quarantineDirectory, { withFileTypes: true }).catch(error => error?.code === 'ENOENT' ? [] : Promise.reject(error))
    const rows = []
    const names = new Set()
    let unknown = false
    for (const entry of entries) {
      const match = QUARANTINE_FILE.exec(entry.name)
      if (!match || !entry.isFile()) { unknown = true; continue }
      if (names.has(match[1])) throw invalidIndex('Computer Use quarantine 中存在重复原始路径。')
      names.add(match[1])
      const info = await stat(path.join(this.quarantineDirectory, entry.name)).catch(() => null)
      if (info?.isFile()) rows.push({ name: match[1], file: entry.name, quarantinedAt: Number(match[2]), ...identityOf(info) })
    }
    return { rows, unknown }
  }

  #withinBudget(entries, quarantine) {
    const count = entries.length + quarantine.rows.length
    const bytes = [...entries, ...quarantine.rows].reduce((sum, row) => sum + row.bytes, 0)
    return { ok: count <= this.scanMaxEntries && bytes <= this.scanMaxBytes, count, bytes }
  }

  async #loadIndex() {
    let handle
    try { handle = await open(this.referenceIndexFile, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)) } catch (error) {
      if (error?.code === 'ENOENT') return { missing: true, state: blankIndex(0, this.runtimeId) }
      throw invalidIndex(`Computer Use 截图引用索引不可读：${error.message}`)
    }
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size <= 0 || info.size > DEFAULT_INDEX_MAX_BYTES) throw invalidIndex('Computer Use 截图引用索引大小或类型无效。')
      return { missing: false, state: validateIndex(JSON.parse(await handle.readFile({ encoding: 'utf8' }))) }
    } catch (error) {
      if (error?.code === 'screenshot-reference-index-invalid') throw error
      throw invalidIndex('Computer Use 截图引用索引无法解析。')
    } finally {
      await handle.close()
    }
  }

  async #persistIndex(state) {
    const next = validateIndex({ ...state, revision: state.revision + 1 })
    await this.#ensureDirectory(path.dirname(this.referenceIndexFile))
    const temporary = `${this.referenceIndexFile}.tmp-${randomUUID()}`
    try {
      await writeFile(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.referenceIndexFile)
    } finally {
      await unlink(temporary).catch(error => { if (error?.code !== 'ENOENT') throw error })
    }
    return next
  }

  #referenceRows(state, name) {
    return state.references[name] || []
  }

  #protectedUntil(state, name) {
    let until = 0
    for (const reference of this.#referenceRows(state, name)) {
      if (reference.kind !== 'token') return Number.POSITIVE_INFINITY
      until = Math.max(until, reference.expiresAt + this.gcSafetyMs)
    }
    return until
  }

  #dropExpiredTokens(state, now) {
    for (const [name, rows] of Object.entries(state.references)) {
      const kept = rows.filter(reference => reference.kind !== 'token' || reference.expiresAt + this.gcSafetyMs > now)
      if (kept.length) state.references[name] = kept
      else delete state.references[name]
      if (state.observed[name]) state.observed[name].referenceHash = referenceHash(kept)
    }
  }

  async #reconcileQuarantine(state, scan, restart, now) {
    const quarantine = {}
    for (const row of scan.rows) {
      const saved = state.quarantine[row.name]
      const uncertain = restart || !saved || !sameIdentity(saved, row)
      quarantine[row.name] = {
        file: row.file,
        quarantinedAt: row.quarantinedAt,
        createdAt: saved?.createdAt ?? Number(SCREENSHOT_FILE.exec(row.name)?.[1] || row.quarantinedAt),
        bytes: row.bytes,
        modifiedAt: row.modifiedAt,
        ino: row.ino,
        verifiedRuntimeId: uncertain ? '' : saved.verifiedRuntimeId,
        safeDeleteAfter: uncertain ? Math.max(saved?.safeDeleteAfter || 0, row.quarantinedAt, now + Math.max(this.tokenTtlMs + this.gcSafetyMs, this.quarantineDelayMs)) : saved.safeDeleteAfter
      }
    }
    state.quarantine = quarantine
  }

  #observeEntries(state, entries, now, restart, ownedNames = new Set()) {
    const seen = new Set()
    for (const entry of entries) {
      seen.add(entry.name)
      const hash = referenceHash(this.#referenceRows(state, entry.name))
      const saved = state.observed[entry.name]
      if (restart || !saved || !sameIdentity(saved, entry) || saved.referenceHash !== hash) {
        state.observed[entry.name] = { firstSeenAt: now, bytes: entry.bytes, modifiedAt: entry.modifiedAt, ino: entry.ino, referenceHash: hash, owned: !restart && ownedNames.has(entry.name) }
      }
    }
    for (const name of Object.keys(state.observed)) if (!seen.has(name)) delete state.observed[name]
  }

  async #prevalidate(operations) {
    for (const operation of operations) {
      const info = await stat(operation.path).catch(error => error?.code === 'ENOENT' ? null : Promise.reject(error))
      if (!info?.isFile() || !sameIdentity(operation.identity, identityOf(info))) return false
    }
    return true
  }

  #baseResult(entries, enabled) {
    return {
      deletedFiles: 0,
      deletedBytes: 0,
      retainedFiles: entries.length,
      retainedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      quarantinedFiles: 0,
      quarantinedBytes: 0,
      restoredFiles: 0,
      danglingReferences: 0,
      danglingTokens: 0,
      gcEnabled: enabled
    }
  }

  async #safeGc(options = {}) {
    const now = this.#time(options.now)
    const removeAll = options.removeAll === true
    const allowDelete = options.allowDelete !== false
    const allowRestore = options.allowRestore !== false
    const enabled = this.gcEnabled() === true
    if (!enabled) return { ...this.#baseResult([], false), featureDisabled: true }
    if (!await this.#knownNamespacePathSafe()) return { ...this.#baseResult([], true), namespaceInvalid: true }
    const entries = (await this.#managedEntries()).sort((left, right) => right.createdAt - left.createdAt || right.modifiedAt - left.modifiedAt)
    const quarantineScan = await this.#quarantineEntries()
    const result = this.#baseResult(entries, true)
    const budget = this.#withinBudget(entries, quarantineScan)
    if (!budget.ok || quarantineScan.unknown) return { ...result, scanBudgetExceeded: !budget.ok, unknownQuarantineEntry: quarantineScan.unknown }
    let loaded
    try { loaded = await this.#loadIndex() } catch (error) {
      if (error?.code === 'screenshot-reference-index-invalid') return { ...result, indexInvalid: true, reason: error.message }
      throw error
    }
    let state = loaded.state
    if (now < state.highWaterMs) return { ...result, clockRollback: true }
    const restart = state.runtimeId !== this.runtimeId
    state.runtimeId = this.runtimeId
    state.highWaterMs = now
    this.#dropExpiredTokens(state, now)
    await this.#reconcileQuarantine(state, quarantineScan, restart, now)
    const ownedNames = typeof options.ownedName === 'string' ? new Set([options.ownedName]) : new Set()
    this.#observeEntries(state, entries, now, restart, ownedNames)
    const available = new Set([...entries.map(entry => entry.name), ...Object.keys(state.quarantine)])
    const dangling = Object.entries(state.references).filter(([name]) => !available.has(name)).flatMap(([, rows]) => rows)
    if (dangling.length) {
      return { ...result, danglingReferences: dangling.length, danglingTokens: dangling.filter(row => row.kind === 'token').length, referenceViewInvalid: true }
    }
    if (loaded.missing || restart) {
      for (const row of Object.values(state.quarantine)) row.verifiedRuntimeId = ''
      await this.#persistIndex(state)
      return { ...result, shadow: true, shadowReason: loaded.missing ? 'index-rebuilt' : 'restart-revalidation' }
    }

    const operations = []
    const restores = []
    for (const [name, row] of Object.entries(state.quarantine)) {
      if (row.verifiedRuntimeId !== this.runtimeId) {
        row.verifiedRuntimeId = this.runtimeId
        continue
      }
      if (this.#protectedUntil(state, name) > now) {
        if (allowRestore) restores.push({ kind: 'restore', name, row, path: path.join(this.quarantineDirectory, row.file), identity: row })
      } else if (allowDelete && now >= row.safeDeleteAfter) {
        operations.push({ kind: 'delete', name, row, path: path.join(this.quarantineDirectory, row.file), identity: row })
      }
    }

    let retainedFiles = 0
    let retainedBytes = 0
    const quarantines = []
    for (const entry of entries) {
      const expired = entry.createdAt > now + 60_000 || now - entry.createdAt > this.maxAgeMs
      const overCount = retainedFiles >= this.maxFiles
      const overBytes = retainedBytes + entry.bytes > this.maxBytes
      const candidate = removeAll || expired || overCount || overBytes
      const observed = state.observed[entry.name]
      const conservativelyOld = observed && (observed.owned || now - observed.firstSeenAt >= this.tokenTtlMs + this.gcSafetyMs)
      if (candidate && state.quarantine[entry.name] === undefined && conservativelyOld && this.#protectedUntil(state, entry.name) <= now) {
        quarantines.push({ kind: 'quarantine', name: entry.name, entry, path: entry.file, identity: entry })
      } else {
        retainedFiles += 1
        retainedBytes += entry.bytes
      }
    }
    operations.push(...restores, ...quarantines)
    if (!await this.#prevalidate(operations)) {
      await this.#persistIndex(state)
      return { ...result, identityChanged: true }
    }
    for (const operation of restores) {
      if (await this.#directoryInfo(path.join(this.directory, operation.name))) return { ...result, quarantineConflict: true }
    }

    for (const operation of restores) {
      const destination = path.join(this.directory, operation.name)
      await this.#ensureDirectory()
      await rename(operation.path, destination)
      delete state.quarantine[operation.name]
      result.restoredFiles += 1
      retainedFiles += 1
      retainedBytes += operation.row.bytes
    }
    for (const operation of quarantines) {
      await this.#ensureDirectory(this.quarantineDirectory)
      const quarantineName = `${operation.name}.${now}.quarantine`
      await rename(operation.path, path.join(this.quarantineDirectory, quarantineName))
      state.quarantine[operation.name] = {
        file: quarantineName,
        quarantinedAt: now,
        createdAt: operation.entry.createdAt,
        bytes: operation.entry.bytes,
        modifiedAt: operation.entry.modifiedAt,
        ino: operation.entry.ino,
        verifiedRuntimeId: this.runtimeId,
        safeDeleteAfter: now + this.quarantineDelayMs
      }
      delete state.observed[operation.name]
      result.quarantinedFiles += 1
      result.quarantinedBytes += operation.entry.bytes
    }
    for (const operation of operations.filter(value => value.kind === 'delete')) {
      await unlink(operation.path)
      delete state.quarantine[operation.name]
      delete state.references[operation.name]
      result.deletedFiles += 1
      result.deletedBytes += operation.row.bytes
    }
    result.retainedFiles = retainedFiles
    result.retainedBytes = retainedBytes
    await this.#persistIndex(state)
    return result
  }

  async #nonGcResult() {
    const info = await this.#directoryInfo(this.directory)
    if (info && (!info.isDirectory() || info.isSymbolicLink())) return { deletedFiles: 0, deletedBytes: 0, retainedFiles: 0, retainedBytes: 0, namespaceInvalid: true }
    const entries = await this.#managedEntries()
    return { deletedFiles: 0, deletedBytes: 0, retainedFiles: entries.length, retainedBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0), authoritative: this.namespace === 'evidence' || this.namespace === 'legacy', gcDisabledReason: `${this.namespace}-namespace` }
  }

  async prune(options = {}) {
    return withStoreLock(this.referenceIndexFile, () => this.namespace === 'preview' ? this.#safeGc(options) : this.#nonGcResult())
  }

  async save(png, options = {}) {
    if (this.namespace !== 'preview' && this.namespace !== 'evidence') throw new Error('Computer Use legacy/unknown 截图命名空间为只读。')
    const data = Buffer.isBuffer(png) ? png : Buffer.from(png || [])
    if (!data.length || data.length > this.maxFileBytes) throw new Error('Computer Use 截图为空或超过单文件限制。')
    const now = this.#time(options.now)
    return withStoreLock(this.referenceIndexFile, async () => {
      if ((this.namespace === 'preview' || this.namespace === 'evidence') && !await this.#knownNamespacePathSafe()) throw new Error('Computer Use 截图命名空间结构无效。')
      await this.#ensureDirectory()
      const file = path.join(this.directory, `window-${now}-${randomUUID()}.png`)
      await writeFile(file, data, { mode: 0o600, flag: 'wx' })
      if (this.namespace === 'preview') await this.#safeGc({ now, ownedName: path.basename(file) })
      return file
    })
  }

  async read(file) {
    const name = this.#nameOf(file)
    return withStoreLock(this.referenceIndexFile, async () => {
      if (this.namespace === 'preview' && !await this.#knownNamespacePathSafe()) throw new Error('Computer Use preview 命名空间结构无效。')
      const original = path.join(this.directory, name)
      const originalInfo = await this.#directoryInfo(original)
      if (originalInfo?.isFile() && !originalInfo.isSymbolicLink()) return this.#readRegularFile(original)
      if (this.namespace !== 'preview') return this.#readRegularFile(original)
      let state
      try { state = (await this.#loadIndex()).state } catch { return this.#readRegularFile(original) }
      const row = state.quarantine[name]
      return row ? this.#readRegularFile(path.join(this.quarantineDirectory, row.file)) : this.#readRegularFile(original)
    })
  }

  async recordReference(file, reference, options = {}) {
    if (this.namespace !== 'preview') return { authoritative: this.namespace === 'evidence' || this.namespace === 'legacy', recorded: false }
    const name = this.#nameOf(file)
    const normalized = normalizeReference(reference)
    const now = this.#time(options.now)
    return withStoreLock(this.referenceIndexFile, async () => {
      if (!await this.#knownNamespacePathSafe()) throw invalidIndex('Computer Use preview 命名空间结构无效。')
      const scans = await Promise.all([this.#managedEntries(), this.#quarantineEntries()])
      const budget = this.#withinBudget(scans[0], scans[1])
      if (!budget.ok || scans[1].unknown) throw invalidIndex('Computer Use 截图引用扫描未通过安全预算。')
      let loaded
      try { loaded = await this.#loadIndex() } catch (error) {
        if (error?.code === 'screenshot-reference-index-invalid') throw error
        throw invalidIndex('Computer Use 截图引用索引不可用。')
      }
      const state = loaded.state
      if (now < state.highWaterMs) throw Object.assign(new Error('Computer Use 截图引用时钟回拨；引用索引保持不变。'), { code: 'screenshot-reference-clock-rollback' })
      await this.#reconcileQuarantine(state, scans[1], state.runtimeId !== this.runtimeId, now)
      const exists = scans[0].some(row => row.name === name) || state.quarantine[name] !== undefined
      if (!exists) throw Object.assign(new Error(`Computer Use 截图引用悬空：${name}`), { code: 'screenshot-reference-dangling' })
      const rows = this.#referenceRows(state, name)
      const found = rows.find(row => row.kind === normalized.kind && row.id === normalized.id)
      if (found && normalized.kind === 'token') found.expiresAt = Math.max(found.expiresAt, normalized.expiresAt)
      else if (!found) rows.push(normalized)
      state.references[name] = rows
      const current = scans[0].find(row => row.name === name)
      const observed = state.observed[name]
      if (current && observed && sameIdentity(current, observed)) observed.referenceHash = referenceHash(rows)
      else if (current) state.observed[name] = { firstSeenAt: now, bytes: current.bytes, modifiedAt: current.modifiedAt, ino: current.ino, referenceHash: referenceHash(rows), owned: false }
      else delete state.observed[name]
      if (state.quarantine[name]) state.quarantine[name].verifiedRuntimeId = ''
      if (now >= state.highWaterMs) state.highWaterMs = now
      state.runtimeId = this.runtimeId
      const saved = await this.#persistIndex(state)
      return { recorded: true, revision: saved.revision, quarantined: saved.quarantine[name] !== undefined }
    })
  }

  async releaseReference(file, reference) {
    if (this.namespace !== 'preview') return { released: false }
    const name = this.#nameOf(file)
    const normalized = normalizeReference(reference)
    return withStoreLock(this.referenceIndexFile, async () => {
      if (!await this.#knownNamespacePathSafe()) throw invalidIndex('Computer Use preview 命名空间结构无效。')
      const loaded = await this.#loadIndex()
      const state = loaded.state
      const before = this.#referenceRows(state, name)
      const after = before.filter(row => row.kind !== normalized.kind || row.id !== normalized.id)
      if (after.length) state.references[name] = after
      else delete state.references[name]
      if (state.observed[name]) state.observed[name].referenceHash = referenceHash(after)
      if (state.quarantine[name]) state.quarantine[name].verifiedRuntimeId = ''
      const saved = await this.#persistIndex(state)
      return { released: after.length !== before.length, revision: saved.revision }
    })
  }

  async rebuildReferenceIndex(records = [], options = {}) {
    if (this.namespace !== 'preview') return { authoritative: this.namespace === 'evidence' || this.namespace === 'legacy', rebuilt: false }
    if (!Array.isArray(records)) throw new Error('Computer Use 截图引用快照必须是数组。')
    const now = this.#time(options.now)
    return withStoreLock(this.referenceIndexFile, async () => {
      if (!await this.#knownNamespacePathSafe()) throw invalidIndex('Computer Use preview 命名空间结构无效。')
      const entries = await this.#managedEntries()
      const quarantineScan = await this.#quarantineEntries()
      const budget = this.#withinBudget(entries, quarantineScan)
      if (!budget.ok || quarantineScan.unknown) throw invalidIndex('Computer Use 截图引用扫描未通过安全预算。')
      const state = blankIndex(now, this.runtimeId)
      await this.#reconcileQuarantine(state, quarantineScan, true, now)
      for (const row of records) {
        if (!isRecord(row)) throw new Error('Computer Use 截图引用快照记录无效。')
        const name = this.#nameOf(row.path)
        const reference = normalizeReference(row)
        const exists = entries.some(entry => entry.name === name) || state.quarantine[name] !== undefined
        if (!exists) throw Object.assign(new Error(`Computer Use 截图引用悬空：${name}`), { code: 'screenshot-reference-dangling' })
        state.references[name] ||= []
        const found = state.references[name].find(value => value.kind === reference.kind && value.id === reference.id)
        if (found && reference.kind === 'token') found.expiresAt = Math.max(found.expiresAt, reference.expiresAt)
        else if (!found) state.references[name].push(reference)
      }
      this.#observeEntries(state, entries, now, true)
      const saved = await this.#persistIndex(state)
      return { rebuilt: true, shadow: true, revision: saved.revision, references: Object.values(saved.references).reduce((sum, rows) => sum + rows.length, 0), quarantined: Object.keys(saved.quarantine).length, danglingReferences: 0 }
    })
  }

  async clear() {
    const info = await this.#directoryInfo(this.directory)
    if (!info) return { deletedFiles: 0, deletedBytes: 0, retainedFiles: 0, retainedBytes: 0 }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Computer Use 截图目录必须是常规目录。')
    return this.prune({ removeAll: true, allowDelete: false, allowRestore: false })
  }
}

module.exports = {
  COMPUTER_USE_SCREENSHOT_NAMESPACES,
  ComputerUseScreenshotStore,
  DEFAULT_GC_SAFETY_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_FILES,
  DEFAULT_QUARANTINE_DELAY_MS,
  DEFAULT_SCAN_MAX_BYTES,
  DEFAULT_SCAN_MAX_ENTRIES,
  DEFAULT_TOKEN_TTL_MS,
  SCREENSHOT_FILE,
  SCREENSHOT_GC_FLAG,
  computerUseScreenshotDirectory,
  gcFlagEnabled
}
