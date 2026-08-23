// 本地跨会话记忆服务（memory-service）。
//
// 底层核心：基于 Electron 43 内置 Node 24 的 node:sqlite（DatabaseSync），
// 数据库完全本地文件；搜索优先 FTS5（外部内容表 + 触发器维护索引），
// FTS5 不可用或查询语法不合法时安全回退到 LIKE 扫描，并补充覆盖中文子串。
//
// 安全边界：
//  - 显式 opt-in：默认禁用；未 enable 前任何数据操作都拒绝且不落盘。
//  - 先检测 DatabaseSync 与 FTS5 可用性，不可用时给出明确错误。
//  - 高风险内容（密码/API key/token/Cookie/Authorization/银行卡/验证码等）
//    默认拒绝保存，或按配置脱敏；审计记录只保留元数据，绝不写入原文。
//  - 全部 SQL 参数化；单条大小、总条数、查询长度、返回条数均有上限。
//  - search() 只返回命中条目及“为何匹配”，不会把整库塞入上下文；
//    recall() 额外遵守“永不自动召回”与敏感级别上限。
//  - 导出为显式操作：JSON 原子写入（临时文件 + rename），不包含审计记录，
//    并限定在配置的导出目录内。

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const censor = require('./memory-censor.cjs')

const SENSITIVITY_LEVELS = Object.freeze({
  normal: 0,
  internal: 1,
  sensitive: 2,
  restricted: 3
})
const SENSITIVITY_MAX = 3
const RECALL_POLICIES = Object.freeze(['auto', 'never'])
const MEMORY_STATUSES = Object.freeze(['candidate', 'active', 'stale', 'superseded', 'conflict', 'archived'])
const MEMORY_SCOPE_TYPES = Object.freeze(['personal', 'project', 'team', 'task'])
const MEMORY_SOURCE_TYPES = Object.freeze(['manual', 'session', 'goal', 'task', 'file', 'import'])
const MAX_TAGS = 20
const MAX_TAG_CHARS = 40
const MAX_SOURCE_CHARS = 128
const MAX_SCOPE_REF_CHARS = 1024
const MAX_SOURCE_REF_CHARS = 1024
const MAX_QUERY_CEILING = 500

const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  dbPath: undefined,
  maxEntries: 1000,
  maxEntryChars: 20000,
  maxQueryLength: 200,
  maxResults: 20,
  recallMaxResults: 8,
  sensitivityMode: 'reject',
  recallMaxSensitivity: 0,
  auditLimit: 200,
  exportsDir: undefined,
  forceFts5: true
})

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const KIND_RE = /^[A-Za-z0-9_-]{1,40}$/

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function sanitizeConfig(input = {}) {
  const merged = { ...DEFAULT_CONFIG, ...input }
  const dbPath = typeof merged.dbPath === 'string' && merged.dbPath.trim()
    ? path.resolve(merged.dbPath.trim())
    : undefined
  const exportsDir = typeof merged.exportsDir === 'string' && merged.exportsDir.trim()
    ? path.resolve(merged.exportsDir.trim())
    : undefined
  return {
    enabled: merged.enabled === true,
    dbPath,
    maxEntries: clampInt(merged.maxEntries, DEFAULT_CONFIG.maxEntries, 1, 100000),
    maxEntryChars: clampInt(merged.maxEntryChars, DEFAULT_CONFIG.maxEntryChars, 1, 1000000),
    maxQueryLength: clampInt(merged.maxQueryLength, DEFAULT_CONFIG.maxQueryLength, 1, 2000),
    maxResults: clampInt(merged.maxResults, DEFAULT_CONFIG.maxResults, 1, MAX_QUERY_CEILING),
    recallMaxResults: clampInt(merged.recallMaxResults, DEFAULT_CONFIG.recallMaxResults, 1, 100),
    sensitivityMode: merged.sensitivityMode === 'redact' ? 'redact' : 'reject',
    recallMaxSensitivity: clampInt(merged.recallMaxSensitivity, 0, 0, SENSITIVITY_MAX),
    auditLimit: clampInt(merged.auditLimit, 0, 0, 10000),
    exportsDir,
    forceFts5: merged.forceFts5 !== false
  }
}

function defaultSqliteFactory() {
  try {
    return require('node:sqlite')
  } catch {
    return null
  }
}

const ENTRY_COLUMNS = [
  'id', 'kind', 'title', 'content', 'tags', 'sourceSessionId',
  'scopeType', 'scopeRef', 'sourceType', 'sourceRef', 'status', 'revision',
  'verifiedAt', 'expiresAt', 'pinned', 'supersedesId',
  'createdAt', 'updatedAt', 'lastUsedAt', 'sensitivity', 'recallPolicy'
].join(', ')

function createMemoryPack(hits, { teamId, taskId, now = Date.now(), maxItems = 5, maxCharacters = 1200, ttlMs = 30 * 60 * 1000 } = {}) {
  const itemLimit = clampInt(maxItems, 5, 1, 5)
  const characterLimit = clampInt(maxCharacters, 1200, 1, 1200)
  const safeTtl = clampInt(ttlMs, 30 * 60 * 1000, 60 * 1000, 30 * 60 * 1000)
  const items = []
  const lines = []
  let used = 0
  for (const hit of (Array.isArray(hits) ? hits : []).slice(0, itemLimit)) {
    const prefix = `${lines.length + 1}. `
    const separator = lines.length ? 1 : 0
    const available = characterLimit - used - separator - prefix.length
    if (available <= 0) break
    const title = String(hit?.title || '').trim()
    const body = String(hit?.content || '').trim()
    const text = `${title ? `${title}: ` : ''}${body}`.slice(0, available)
    if (!text) continue
    const line = `${prefix}${text}`
    lines.push(line)
    used += separator + line.length
    items.push({
      id: String(hit.id || ''),
      revision: Math.max(1, Number(hit.revision) || 1),
      text,
      sourceType: hit.sourceType || 'manual',
      sourceRef: hit.sourceRef ?? null
    })
  }
  return {
    schemaVersion: 1,
    teamId: String(teamId || ''),
    taskId: String(taskId || ''),
    ephemeral: true,
    expiresAt: new Date(Number(now) + safeTtl).toISOString(),
    maxCharacters: characterLimit,
    content: lines.join('\n'),
    items
  }
}

class MemoryService {
  constructor(options = {}) {
    this.now = typeof options.now === 'function' ? options.now : () => Date.now()
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : () => randomUUID()
    this.sqliteFactory = typeof options.sqliteFactory === 'function' ? options.sqliteFactory : defaultSqliteFactory
    const module = this.sqliteFactory()
    this.sqliteModule = module && typeof module.DatabaseSync === 'function' ? module : null
    this.databaseAvailable = !!this.sqliteModule
    this.cfg = sanitizeConfig(options)
    this.db = null
    this.fts5 = false
    this.auditLog = []
    this.secureDelete = false
    this.enabled = false
    // 显式 opt-in：仅当构造参数 enabled: true 且提供了 dbPath 时才立即打开数据库。
    if (this.cfg.enabled) {
      if (!this.cfg.dbPath) throw new Error('启用记忆服务需要提供本地 dbPath。')
      if (!this.databaseAvailable) throw new Error('内置 SQLite（node:sqlite）不可用，无法启用本地记忆服务。')
      this.#openDb(this.cfg.dbPath)
      this.enabled = true
      this.#audit('enable', true, { dbPath: this.cfg.dbPath })
    }
  }

  // ---- 生命周期 ----

  /** 显式启用。幂等：同一 dbPath 重复启用直接返回当前状态。 */
  async enable(input = {}) {
    const merged = sanitizeConfig({ ...this.cfg, ...input, enabled: true })
    if (!merged.dbPath) throw new Error('启用记忆服务需要提供本地 dbPath。')
    if (this.enabled && this.db && this.db.isOpen && this.cfg.dbPath === merged.dbPath) {
      this.cfg = merged
      return this.status()
    }
    if (!this.databaseAvailable) throw new Error('内置 SQLite（node:sqlite）不可用，无法启用本地记忆服务。')
    if (this.db && this.db.isOpen) this.db.close()
    this.cfg = merged
    this.#openDb(merged.dbPath)
    this.enabled = true
    this.#audit('enable', true, { dbPath: this.cfg.dbPath })
    return this.status()
  }

  /** 停用：关闭数据库但不删除文件；之后所有数据操作都会被拒绝。 */
  disable() {
    if (this.db && this.db.isOpen) this.db.close()
    this.db = null
    this.enabled = false
    this.fts5 = false
    this.secureDelete = false
    this.#audit('disable', true)
    return this.status()
  }

  close() {
    return this.disable()
  }

  status() {
    let counts = { entries: 0 }
    let dbPath = null
    let sqliteVersion = null
    let schemaVersion = null
    if (this.db && this.db.isOpen) {
      dbPath = this.cfg.dbPath
      const entries = Number(this.db.prepare('SELECT count(*) AS c FROM entries').get().c)
      const grouped = Object.fromEntries(this.db.prepare('SELECT status, count(*) AS c FROM entries GROUP BY status').all().map(row => [row.status, Number(row.c)]))
      counts = {
        entries,
        active: grouped.active || 0,
        candidates: grouped.candidate || 0,
        stale: grouped.stale || 0,
        superseded: grouped.superseded || 0,
        conflict: grouped.conflict || 0,
        archived: grouped.archived || 0
      }
      try {
        sqliteVersion = String(this.db.prepare('SELECT sqlite_version() AS v').get().v)
        schemaVersion = Number(this.db.prepare('PRAGMA user_version').get().user_version)
      } catch {}
    }
    return {
      service: 'memory',
      enabled: this.enabled,
      databaseAvailable: this.databaseAvailable,
      fts5: this.fts5,
      secureDelete: this.secureDelete,
      dbPath,
      sqliteVersion,
      schemaVersion,
      counts,
      limits: {
        maxEntries: this.cfg.maxEntries,
        maxEntryChars: this.cfg.maxEntryChars,
        maxQueryLength: this.cfg.maxQueryLength,
        maxResults: this.cfg.maxResults,
        recallMaxResults: this.cfg.recallMaxResults,
        sensitivityMode: this.cfg.sensitivityMode,
        recallMaxSensitivity: this.cfg.recallMaxSensitivity
      },
      auditCount: this.auditLog.length
    }
  }

  /** 审计记录副本（仅元数据，绝不包含内容或秘密原文）。 */
  audit() {
    return this.auditLog.map(entry => ({ ...entry }))
  }

  // ---- 写入操作 ----

  async add(input = {}) {
    this.#requireEnabled()
    const entry = this.#buildEntry(input, { existing: null })
    const { entry: safe, types } = this.#applySensitivityPolicy(entry, 'add')
    if (this.#entryCount() >= this.cfg.maxEntries) {
      this.#audit('add', false, { id: entry.id, detail: '条目数量已达上限' })
      throw new Error(`记忆条目数量已达上限（${this.cfg.maxEntries} 条）。`)
    }
    try {
      this.db.prepare(
        `INSERT INTO entries (${ENTRY_COLUMNS}) VALUES (${ENTRY_COLUMNS.split(', ').map(() => '?').join(', ')})`
      ).run(
        safe.id, safe.kind, safe.title, safe.content, JSON.stringify(safe.tags), safe.sourceSessionId,
        safe.scopeType, safe.scopeRef, safe.sourceType, safe.sourceRef, safe.status, safe.revision,
        safe.verifiedAt, safe.expiresAt, safe.pinned ? 1 : 0, safe.supersedesId,
        safe.createdAt, safe.updatedAt, safe.lastUsedAt, safe.sensitivity, safe.recallPolicy
      )
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) {
        this.#audit('add', false, { id: entry.id, detail: 'id 冲突' })
        throw new Error('记忆条目 id 已存在。')
      }
      throw error
    }
    this.#audit('add', true, { id: safe.id, types: types.length ? types : undefined, redacted: types.length > 0 })
    return this.#rowToEntry(this.db.prepare('SELECT * FROM entries WHERE id = ?').get(safe.id))
  }

  async update(id, patch = {}) {
    this.#requireEnabled()
    const key = this.#validateId(id)
    const row = this.db.prepare('SELECT * FROM entries WHERE id = ?').get(key)
    if (!row) throw new Error('记忆条目不存在。')
    const merged = this.#buildEntry(patch, { existing: this.#rowToEntry(row) })
    const { entry: safe, types } = this.#applySensitivityPolicy(merged, 'update')
    this.db.prepare(
      `UPDATE entries SET kind = ?, title = ?, content = ?, tags = ?, sourceSessionId = ?,
        scopeType = ?, scopeRef = ?, sourceType = ?, sourceRef = ?, status = ?, revision = ?,
        verifiedAt = ?, expiresAt = ?, pinned = ?, supersedesId = ?, updatedAt = ?,
        sensitivity = ?, recallPolicy = ? WHERE id = ?`
    ).run(
      safe.kind, safe.title, safe.content, JSON.stringify(safe.tags), safe.sourceSessionId,
      safe.scopeType, safe.scopeRef, safe.sourceType, safe.sourceRef, safe.status, safe.revision,
      safe.verifiedAt, safe.expiresAt, safe.pinned ? 1 : 0, safe.supersedesId, safe.updatedAt,
      safe.sensitivity, safe.recallPolicy, safe.id
    )
    this.#audit('update', true, { id: safe.id, types: types.length ? types : undefined, redacted: types.length > 0 })
    return this.#rowToEntry(this.db.prepare('SELECT * FROM entries WHERE id = ?').get(safe.id))
  }

  async delete(id) {
    this.#requireEnabled()
    const key = this.#validateId(id)
    const result = this.db.prepare('DELETE FROM entries WHERE id = ?').run(key)
    this.#audit('delete', result.changes > 0, { id: key })
    return { deleted: result.changes > 0 }
  }

  async deleteAll() {
    this.#requireEnabled()
    this.db.exec('BEGIN IMMEDIATE')
    let deleted = 0
    try {
      const result = this.db.prepare('DELETE FROM entries').run()
      deleted = Number(result.changes)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    this.db.exec('VACUUM')
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)') } catch {}
    const auditCleared = this.auditLog.length
    this.auditLog = []
    return { deleted, auditCleared, storageCompacted: true, secureDelete: this.secureDelete }
  }

  async deleteExports() {
    this.#requireEnabled()
    const directory = this.cfg.exportsDir
    if (!directory) return { deletedExports: 0 }
    let info
    try { info = fs.lstatSync(directory) } catch (error) {
      if (error?.code === 'ENOENT') return { deletedExports: 0 }
      throw error
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('记忆导出目录必须是常规目录。')
    const managed = /^memory-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/
    let deletedExports = 0
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !managed.test(entry.name)) continue
      fs.unlinkSync(path.join(directory, entry.name))
      deletedExports += 1
    }
    return { deletedExports }
  }

  // ---- 读取操作 ----

  async get(id) {
    this.#requireEnabled()
    const key = this.#validateId(id)
    return this.#rowToEntry(this.db.prepare('SELECT * FROM entries WHERE id = ?').get(key))
  }

  async list({ page = 1, pageSize = 50, ...selectionOptions } = {}) {
    this.#requireEnabled()
    const size = clampInt(pageSize, 50, 1, 200)
    const pageNum = clampInt(page, 1, 1, 1000000)
    const selection = this.#selectionSql(selectionOptions)
    const where = selection.clause ? ` WHERE ${selection.clause}` : ''
    const total = Number(this.db.prepare(`SELECT count(*) AS c FROM entries${where}`).get(...selection.params).c)
    const rows = this.db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM entries${where} ORDER BY pinned DESC, updatedAt DESC LIMIT ? OFFSET ?`
    ).all(...selection.params, size, (pageNum - 1) * size)
    return {
      entries: rows.map(row => this.#rowToEntry(row)),
      page: pageNum,
      pageSize: size,
      total,
      pages: Math.max(1, Math.ceil(total / size))
    }
  }

  /**
   * 搜索记忆条目。优先 FTS5，不可用或语法不合法时回退 LIKE；
   * 中文等子串场景下 FTS 命中不足时自动用 LIKE 补充。
   * 返回每条命中的来源（source）与命中字段（matched）/ 片段（snippet）。
   */
  async search(query, { maxResults, ...selectionOptions } = {}) {
    this.#requireEnabled()
    const q = this.#validateQuery(query)
    const limit = clampInt(maxResults, this.cfg.maxResults, 1, MAX_QUERY_CEILING)
    const selection = this.#selectionSql(selectionOptions, 'e')
    const fts = this.fts5 ? this.#searchFts(q, limit, selection) : { used: false, error: 'fts-unavailable', hits: [] }
    const seen = new Set()
    let hits = []
    let source = 'like'
    if (fts.used && !fts.error) {
      hits = fts.hits.slice()
      for (const hit of hits) seen.add(hit.id)
      if (hits.length) source = 'fts5'
    }
    if (hits.length < limit) {
      const extra = this.#searchLike(q, limit - hits.length, seen, selection)
      if (extra.length) {
        hits = hits.concat(extra)
        source = fts.used && !fts.error ? 'fts5+like' : 'like'
      }
    }
    return {
      query: q,
      source,
      fts5: this.fts5,
      total: hits.length,
      hits,
      fallbackReason: fts.error || (!fts.used ? 'fts-unavailable' : null)
    }
  }

  /**
   * 自动召回候选：仅返回允许自动召回（recallPolicy 非 never 且敏感级别
   * 不超过配置上限）的命中，并更新每条命中 lastUsedAt。
   * 显式 search() 不受该策略限制——用户主动查询仍然可用。
   */
  async recall(query, { maxResults, ...selectionOptions } = {}) {
    this.#requireEnabled()
    const limit = clampInt(maxResults, this.cfg.recallMaxResults, 1, 100)
    const probe = await this.search(query, {
      ...selectionOptions,
      statuses: ['active'],
      includeExpired: false,
      maxResults: Math.min(MAX_QUERY_CEILING, limit * 4)
    })
    const allowed = probe.hits.filter(hit =>
      hit.recallPolicy !== 'never' && Number(hit.sensitivity) <= this.cfg.recallMaxSensitivity
    ).slice(0, limit)
    if (allowed.length) {
      const nowIso = new Date(this.now()).toISOString()
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const stmt = this.db.prepare('UPDATE entries SET lastUsedAt = ? WHERE id = ?')
        for (const hit of allowed) stmt.run(nowIso, hit.id)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      for (const hit of allowed) hit.lastUsedAt = nowIso
    }
    this.#audit('recall', true, {
      queryLength: query == null ? 0 : String(query).length,
      hits: allowed.length,
      filtered: probe.hits.length - allowed.length
    })
    return {
      query: probe.query,
      source: probe.source,
      fts5: probe.fts5,
      total: allowed.length,
      hits: allowed,
      policy: {
        recallMaxSensitivity: this.cfg.recallMaxSensitivity,
        neverRecalled: probe.hits.length - allowed.length
      }
    }
  }

  // ---- 导出 ----

  /** 导出条目为 JSON（原子写入），不含审计记录；原文已按策略脱敏或从未入库。 */
  async export({ to } = {}) {
    this.#requireEnabled()
    if (typeof to !== 'string' || !to.trim()) throw new Error('导出需要目标文件路径。')
    const target = path.resolve(to.trim())
    if (/\.(?:db|sqlite|sqlite3)$/i.test(target) || target === this.cfg.dbPath) {
      throw new Error('导出目标不能是数据库文件。')
    }
    if (this.cfg.exportsDir && !this.#isInside(this.cfg.exportsDir, target)) {
      throw new Error('导出目标必须在配置的导出目录内。')
    }
    const dir = path.dirname(target)
    fs.mkdirSync(dir, { recursive: true })
    const rows = this.db.prepare(`SELECT ${ENTRY_COLUMNS} FROM entries ORDER BY updatedAt DESC`).all()
    const payload = {
      format: 'dsh-memory-export',
      version: 2,
      exportedAt: new Date(this.now()).toISOString(),
      counts: { entries: rows.length },
      entries: rows.map(row => this.#rowToEntry(row))
    }
    const json = JSON.stringify(payload, null, 2)
    const tmp = `${target}.tmp-${process.pid}-${randomUUID()}`
    try {
      fs.writeFileSync(tmp, json, { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(tmp, target)
    } catch (error) {
      try { fs.unlinkSync(tmp) } catch {}
      throw error
    }
    this.#audit('export', true, { file: path.basename(target) })
    return { file: target, format: payload.format, exportedAt: payload.exportedAt, count: rows.length }
  }

  // ---- 内部实现 ----

  #requireEnabled() {
    if (!this.enabled || !this.db || !this.db.isOpen) {
      throw new Error('本地记忆服务未启用，请在设置中开启。')
    }
  }

  #openDb(dbPath) {
    const dir = path.dirname(dbPath)
    fs.mkdirSync(dir, { recursive: true })
    this.db = new this.sqliteModule.DatabaseSync(dbPath)
    this.db.exec('PRAGMA secure_delete = ON')
    this.secureDelete = Number(this.db.prepare('PRAGMA secure_delete').get().secure_delete) === 1
    if (!this.secureDelete) {
      this.db.close()
      this.db = null
      throw new Error('SQLite secure_delete 无法启用，拒绝打开本地记忆数据库。')
    }
    this.fts5 = this.#detectFts5()
    this.#migrate()
  }

  #detectFts5() {
    if (this.cfg.forceFts5 === false) return false
    try {
      const row = this.db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS c").get()
      return Number(row.c) === 1
    } catch {
      return false
    }
  }

  // 幂等迁移：可重复执行；FTS5 可用时维护外部内容索引与触发器。
  #migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'note',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        sourceSessionId TEXT,
        scopeType TEXT NOT NULL DEFAULT 'personal',
        scopeRef TEXT,
        sourceType TEXT NOT NULL DEFAULT 'manual',
        sourceRef TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        revision INTEGER NOT NULL DEFAULT 1,
        verifiedAt TEXT,
        expiresAt TEXT,
        pinned INTEGER NOT NULL DEFAULT 0,
        supersedesId TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        lastUsedAt TEXT,
        sensitivity INTEGER NOT NULL DEFAULT 0,
        recallPolicy TEXT NOT NULL DEFAULT 'auto'
      );
      CREATE INDEX IF NOT EXISTS idx_entries_updatedAt ON entries(updatedAt);
      CREATE INDEX IF NOT EXISTS idx_entries_kind ON entries(kind);
      CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(sourceSessionId);
    `)
    const columns = new Set(this.db.prepare('PRAGMA table_info(entries)').all().map(row => row.name))
    const additions = {
      scopeType: "TEXT NOT NULL DEFAULT 'personal'",
      scopeRef: 'TEXT',
      sourceType: "TEXT NOT NULL DEFAULT 'manual'",
      sourceRef: 'TEXT',
      status: "TEXT NOT NULL DEFAULT 'active'",
      revision: 'INTEGER NOT NULL DEFAULT 1',
      verifiedAt: 'TEXT',
      expiresAt: 'TEXT',
      pinned: 'INTEGER NOT NULL DEFAULT 0',
      supersedesId: 'TEXT'
    }
    for (const [column, declaration] of Object.entries(additions)) {
      if (!columns.has(column)) this.db.exec(`ALTER TABLE entries ADD COLUMN ${column} ${declaration}`)
    }
    this.db.exec(`
      UPDATE entries SET sourceType = 'session', sourceRef = sourceSessionId
        WHERE sourceSessionId IS NOT NULL AND (sourceRef IS NULL OR sourceRef = '');
      UPDATE entries SET verifiedAt = updatedAt WHERE status = 'active' AND verifiedAt IS NULL;
      CREATE INDEX IF NOT EXISTS idx_entries_scope ON entries(scopeType, scopeRef);
      CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status, expiresAt);
      CREATE INDEX IF NOT EXISTS idx_entries_pinned ON entries(pinned, updatedAt);
      PRAGMA user_version = 2;
    `)
    if (!this.fts5) return
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
        title, content, tags,
        content='entries', content_rowid='rowid',
        tokenize='unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
        INSERT INTO entries_fts(rowid, title, content, tags)
        VALUES (new.rowid, new.title, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, content, tags)
        VALUES ('delete', old.rowid, old.title, old.content, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
        INSERT INTO entries_fts(entries_fts, rowid, title, content, tags)
        VALUES ('delete', old.rowid, old.title, old.content, old.tags);
        INSERT INTO entries_fts(rowid, title, content, tags)
        VALUES (new.rowid, new.title, new.content, new.tags);
      END;
    `)
    // 回填：已存在 entries 但索引为空（例如先前以无 FTS 模式运行）时重建。
    const ftsCount = Number(this.db.prepare('SELECT count(*) AS c FROM entries_fts').get().c)
    if (ftsCount === 0) {
      this.db.exec('INSERT INTO entries_fts(rowid, title, content, tags) SELECT rowid, title, content, tags FROM entries')
    }
  }

  #entryCount() {
    return Number(this.db.prepare('SELECT count(*) AS c FROM entries').get().c)
  }

  #buildEntry(input, { existing = null } = {}) {
    const nowIso = new Date(this.now()).toISOString()
    const id = existing ? existing.id : String(input.id || this.idFactory())
    if (!ID_RE.test(id)) throw new Error('无效的记忆条目 id。')
    const kind = input.kind === undefined ? (existing ? existing.kind : 'note') : String(input.kind)
    if (!KIND_RE.test(kind)) throw new Error('无效的条目类型 kind。')
    const title = (input.title === undefined ? (existing ? existing.title : '') : String(input.title)).trim()
    const content = (input.content === undefined ? (existing ? existing.content : '') : String(input.content)).trim()
    if (content.length === 0) throw new Error('记忆内容不能为空。')
    if (title.length > this.cfg.maxEntryChars) throw new Error(`条目标题过长（上限 ${this.cfg.maxEntryChars} 字符）。`)
    if (content.length > this.cfg.maxEntryChars) throw new Error(`条目内容过长（上限 ${this.cfg.maxEntryChars} 字符）。`)
    const tags = input.tags === undefined ? (existing ? existing.tags : []) : this.#normalizeTags(input.tags)
    let sourceSessionId
    if (input.sourceSessionId === undefined) {
      sourceSessionId = existing ? existing.sourceSessionId : null
    } else {
      sourceSessionId = input.sourceSessionId == null ? null : String(input.sourceSessionId).trim()
      if (sourceSessionId !== null && (sourceSessionId.length === 0 || sourceSessionId.length > MAX_SOURCE_CHARS)) {
        throw new Error('无效的 sourceSessionId。')
      }
    }
    const scopeType = input.scopeType === undefined ? (existing ? existing.scopeType : 'personal') : String(input.scopeType)
    if (!MEMORY_SCOPE_TYPES.includes(scopeType)) throw new Error('无效的记忆作用域 scopeType。')
    const rawScopeRef = input.scopeRef === undefined ? (existing ? existing.scopeRef : null) : input.scopeRef
    const scopeRef = scopeType === 'personal' ? null : this.#boundedReference(rawScopeRef, 'scopeRef', MAX_SCOPE_REF_CHARS, true)
    const sourceType = input.sourceType === undefined
      ? (existing ? existing.sourceType : (sourceSessionId ? 'session' : 'manual'))
      : String(input.sourceType)
    if (!MEMORY_SOURCE_TYPES.includes(sourceType)) throw new Error('无效的记忆来源 sourceType。')
    const rawSourceRef = input.sourceRef === undefined
      ? (existing ? existing.sourceRef : (sourceSessionId || null))
      : input.sourceRef
    const sourceRef = this.#boundedReference(rawSourceRef, 'sourceRef', MAX_SOURCE_REF_CHARS, false)
    const status = input.status === undefined ? (existing ? existing.status : 'active') : String(input.status)
    if (!MEMORY_STATUSES.includes(status)) throw new Error('无效的记忆状态 status。')
    const expiresAt = input.expiresAt === undefined ? (existing ? existing.expiresAt : null) : this.#timestamp(input.expiresAt, 'expiresAt')
    let verifiedAt = input.verifiedAt === undefined ? (existing ? existing.verifiedAt : null) : this.#timestamp(input.verifiedAt, 'verifiedAt')
    if (status === 'active' && (!existing || existing.status !== 'active') && input.verifiedAt === undefined) verifiedAt = nowIso
    const pinned = input.pinned === undefined ? (existing ? existing.pinned : false) : input.pinned === true
    const rawSupersedesId = input.supersedesId === undefined ? (existing ? existing.supersedesId : null) : input.supersedesId
    const supersedesId = rawSupersedesId == null || rawSupersedesId === '' ? null : this.#validateId(rawSupersedesId)
    if (supersedesId === id) throw new Error('记忆不能替代自身。')
    const sensitivity = input.sensitivity === undefined
      ? (existing ? existing.sensitivity : 0)
      : (() => {
        const value = Number(input.sensitivity)
        if (!Number.isInteger(value) || value < 0 || value > SENSITIVITY_MAX) {
          throw new Error(`无效的敏感级别（取值范围 0..${SENSITIVITY_MAX}）。`)
        }
        return value
      })()
    const recallPolicy = input.recallPolicy === undefined
      ? (existing ? existing.recallPolicy : 'auto')
      : (() => {
        if (!RECALL_POLICIES.includes(input.recallPolicy)) throw new Error('无效的召回策略（auto 或 never）。')
        return input.recallPolicy
      })()
    return {
      id, kind, title, content, tags, sourceSessionId,
      scopeType, scopeRef, sourceType, sourceRef, status,
      revision: existing ? Number(existing.revision || 1) + 1 : 1,
      verifiedAt, expiresAt, pinned, supersedesId,
      sensitivity, recallPolicy,
      createdAt: existing ? existing.createdAt : nowIso,
      updatedAt: nowIso,
      lastUsedAt: existing ? existing.lastUsedAt : null
    }
  }

  #normalizeTags(value) {
    let arr
    if (value === undefined || value === null || value === '') return []
    if (Array.isArray(value)) arr = value
    else if (typeof value === 'string') {
      try { arr = JSON.parse(value) } catch { throw new Error('tags 应为字符串数组。') }
    } else {
      throw new Error('tags 应为字符串数组。')
    }
    if (!Array.isArray(arr) || arr.some(tag => typeof tag !== 'string')) throw new Error('tags 应为字符串数组。')
    const seen = new Set()
    const out = []
    for (const raw of arr) {
      const tag = String(raw).trim()
      if (!tag) continue
      if (tag.length > MAX_TAG_CHARS) throw new Error(`单个标签过长（上限 ${MAX_TAG_CHARS} 字符）。`)
      if (seen.has(tag)) continue
      seen.add(tag)
      out.push(tag)
      if (out.length > MAX_TAGS) throw new Error(`标签数量过多（上限 ${MAX_TAGS} 个）。`)
    }
    return out
  }

  #boundedReference(value, field, maxChars, required) {
    if (value === undefined || value === null || value === '') {
      if (required) throw new Error(`${field} 不能为空。`)
      return null
    }
    const text = String(value).trim()
    if ((!text && required) || text.length > maxChars || /[\u0000-\u001f\u007f]/u.test(text)) throw new Error(`无效的 ${field}。`)
    return text || null
  }

  #timestamp(value, field) {
    if (value === undefined || value === null || value === '') return null
    const date = new Date(String(value))
    if (!Number.isFinite(date.getTime())) throw new Error(`无效的 ${field}。`)
    return date.toISOString()
  }

  // 敏感度策略：reject（默认）拒绝保存；redact 先脱敏再保存。
  // 返回 { entry, types }；types 为空表示无风险。
  #applySensitivityPolicy(entry, op = 'add') {
    const referenceTypes = censor.detectHighRisk([entry.sourceSessionId, entry.scopeRef, entry.sourceRef].filter(Boolean).join('\n'))
    if (referenceTypes.length) {
      this.#audit(op, false, { id: entry.id, types: referenceTypes, detail: 'high-risk-reference-rejected' })
      const error = new Error(`记忆来源或作用域引用包含高风险内容（${referenceTypes.join('、')}），已拒绝保存。`)
      error.code = 'HIGH_RISK_REJECTED'
      throw error
    }
    const text = [entry.title, entry.content, ...entry.tags].join('\n')
    const types = censor.detectHighRisk(text)
    if (!types.length) return { entry, types }
    if (this.cfg.sensitivityMode === 'reject') {
      this.#audit(op, false, { id: entry.id, types, detail: 'high-risk-rejected' })
      const error = new Error(`检测到高风险内容（${types.join('、')}），已拒绝保存。`)
      error.code = 'HIGH_RISK_REJECTED'
      throw error
    }
    const safe = { ...entry }
    safe.title = censor.redact(safe.title).text
    safe.content = censor.redact(safe.content).text
    safe.tags = safe.tags.map(tag => censor.redact(tag).text)
    return { entry: safe, types }
  }

  #selectionSql(options = {}, alias = '') {
    const prefix = alias ? `${alias}.` : ''
    const clauses = []
    const params = []
    const rawStatuses = options.statuses ?? (options.status === undefined ? [] : [options.status])
    if (rawStatuses !== undefined && !Array.isArray(rawStatuses)) throw new Error('statuses 必须是数组。')
    const statuses = [...new Set((rawStatuses || []).map(String))]
    if (statuses.some(status => !MEMORY_STATUSES.includes(status))) throw new Error('无效的记忆状态筛选。')
    if (statuses.length) {
      clauses.push(`${prefix}status IN (${statuses.map(() => '?').join(', ')})`)
      params.push(...statuses)
    }
    let scopes = options.scopes
    if (scopes === undefined && options.scopeType !== undefined) {
      const type = String(options.scopeType)
      if (!MEMORY_SCOPE_TYPES.includes(type)) throw new Error('无效的记忆作用域筛选。')
      if (options.scopeRef === undefined) {
        clauses.push(`${prefix}scopeType = ?`)
        params.push(type)
        scopes = []
      } else {
        scopes = [{ type, ref: options.scopeRef }]
      }
    }
    if (scopes !== undefined) {
      if (!Array.isArray(scopes) || scopes.length > 16) throw new Error('scopes 必须是最多 16 项的数组。')
      const scopeClauses = []
      for (const item of scopes) {
        const type = String(item?.type || item?.scopeType || '')
        if (!MEMORY_SCOPE_TYPES.includes(type)) throw new Error('无效的记忆作用域筛选。')
        if (type === 'personal') {
          scopeClauses.push(`(${prefix}scopeType = ? AND ${prefix}scopeRef IS NULL)`)
          params.push(type)
        } else {
          const ref = this.#boundedReference(item?.ref ?? item?.scopeRef, 'scopeRef', MAX_SCOPE_REF_CHARS, true)
          scopeClauses.push(`(${prefix}scopeType = ? AND ${prefix}scopeRef = ?)`)
          params.push(type, ref)
        }
      }
      if (scopeClauses.length) clauses.push(`(${scopeClauses.join(' OR ')})`)
    }
    if (options.includeExpired === false) {
      clauses.push(`(${prefix}expiresAt IS NULL OR ${prefix}expiresAt > ?)`)
      params.push(new Date(this.now()).toISOString())
    }
    return { clause: clauses.join(' AND '), params }
  }

  #searchFts(query, limit, selection = { clause: '', params: [] }) {
    try {
      const selectionSql = selection.clause ? ` AND ${selection.clause}` : ''
      const rows = this.db.prepare(
        `SELECT ${ENTRY_COLUMNS.split(', ').map(col => `e.${col}`).join(', ')},
                snippet(entries_fts, 0, '[', ']', '…', 12) AS snipTitle,
                snippet(entries_fts, 1, '[', ']', '…', 12) AS snipContent,
                snippet(entries_fts, 2, '[', ']', '…', 12) AS snipTags
         FROM entries_fts JOIN entries e ON e.rowid = entries_fts.rowid
         WHERE entries_fts MATCH ?${selectionSql}
         ORDER BY e.pinned DESC, bm25(entries_fts), e.updatedAt DESC
         LIMIT ?`
      ).all(query, ...selection.params, limit)
      return {
        used: true,
        error: null,
        hits: rows.map(row => this.#hitFromRow(row, 'fts5', {
          snipTitle: row.snipTitle, snipContent: row.snipContent, snipTags: row.snipTags
        }))
      }
    } catch (error) {
      return { used: true, error: 'fts-query-failed', hits: [] }
    }
  }

  #searchLike(query, limit, exclude, selection = { clause: '', params: [] }) {
    const escape = value => value.replace(/[\\%_]/g, char => '\\' + char)
    const pattern = `%${escape(query)}%`
    const selectionSql = selection.clause ? ` AND ${selection.clause}` : ''
    const rows = this.db.prepare(
      `SELECT ${ENTRY_COLUMNS.split(', ').map(col => `e.${col}`).join(', ')} FROM entries e
       WHERE (e.title LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\')${selectionSql}
       ORDER BY e.pinned DESC, e.updatedAt DESC LIMIT ?`
    ).all(pattern, pattern, pattern, ...selection.params, limit + exclude.size + 16)
    const lower = query.toLowerCase()
    const hits = []
    for (const row of rows) {
      if (exclude.has(row.id)) continue
      const hit = this.#hitFromRow(row, 'like', {})
      const title = hit.title.toLowerCase()
      const content = hit.content.toLowerCase()
      const tagsText = (hit.tags || []).join(' ')
      if (title.includes(lower)) { hit.matched.push('title'); hit.snippet.title = this.#snippetAround(hit.title, query) }
      if (content.includes(lower)) { hit.matched.push('content'); hit.snippet.content = this.#snippetAround(hit.content, query) }
      if (tagsText.includes(lower) || JSON.stringify(hit.tags).toLowerCase().includes(lower)) hit.matched.push('tags')
      if (!hit.matched.length) continue
      hits.push(hit)
      if (hits.length >= limit) break
    }
    return hits
  }

  #hitFromRow(row, source, snippets) {
    const entry = this.#rowToEntry(row)
    const hit = { ...entry, source, matched: [], snippet: {} }
    if (snippets.snipTitle) { hit.matched.push('title'); hit.snippet.title = snippets.snipTitle }
    if (snippets.snipContent) { hit.matched.push('content'); hit.snippet.content = snippets.snipContent }
    if (snippets.snipTags) { hit.matched.push('tags'); hit.snippet.tags = snippets.snipTags }
    return hit
  }

  #snippetAround(text, term) {
    const lowerText = text.toLowerCase()
    const index = lowerText.indexOf(term.toLowerCase())
    if (index < 0) return ''
    const start = Math.max(0, index - 20)
    const end = Math.min(text.length, index + term.length + 20)
    const before = start > 0 ? '…' : ''
    const after = end < text.length ? '…' : ''
    const match = text.slice(index, index + term.length)
    return `${before}${text.slice(start, index)}[${match}]${text.slice(index + term.length, end)}${after}`
  }

  #rowToEntry(row) {
    if (!row) return null
    let tags = []
    try {
      tags = JSON.parse(row.tags || '[]')
      if (!Array.isArray(tags)) tags = []
    } catch {
      tags = []
    }
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      content: row.content,
      tags,
      sourceSessionId: row.sourceSessionId ?? null,
      scopeType: row.scopeType || 'personal',
      scopeRef: row.scopeRef ?? null,
      sourceType: row.sourceType || (row.sourceSessionId ? 'session' : 'manual'),
      sourceRef: row.sourceRef ?? row.sourceSessionId ?? null,
      status: row.status || 'active',
      revision: Math.max(1, Number(row.revision) || 1),
      verifiedAt: row.verifiedAt ?? null,
      expiresAt: row.expiresAt ?? null,
      pinned: Number(row.pinned) === 1,
      supersedesId: row.supersedesId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      lastUsedAt: row.lastUsedAt ?? null,
      sensitivity: Number(row.sensitivity),
      recallPolicy: row.recallPolicy
    }
  }

  #validateId(id) {
    const key = String(id || '')
    if (!ID_RE.test(key)) throw new Error('无效的记忆条目 id。')
    return key
  }

  #validateQuery(query) {
    const value = String(query ?? '').trim()
    if (!value) throw new Error('搜索查询不能为空。')
    if (value.length > this.cfg.maxQueryLength) throw new Error(`搜索查询过长（上限 ${this.cfg.maxQueryLength} 字符）。`)
    return value
  }

  #isInside(base, target) {
    return target === base || target.startsWith(base + path.sep)
  }

  #audit(op, ok, metadata = {}) {
    if (!this.cfg.auditLimit) return
    this.auditLog.push({ at: new Date(this.now()).toISOString(), op, ok, ...metadata })
    if (this.auditLog.length > this.cfg.auditLimit) {
      this.auditLog.splice(0, this.auditLog.length - this.cfg.auditLimit)
    }
  }
}

module.exports = {
  DEFAULT_CONFIG,
  ENTRY_COLUMNS,
  MAX_QUERY_CEILING,
  MAX_SOURCE_CHARS,
  MAX_TAG_CHARS,
  MAX_TAGS,
  MemoryService,
  createMemoryPack,
  MEMORY_SCOPE_TYPES,
  MEMORY_SOURCE_TYPES,
  MEMORY_STATUSES,
  RECALL_POLICIES,
  SENSITIVITY_LEVELS,
  SENSITIVITY_MAX,
  sanitizeConfig
}
