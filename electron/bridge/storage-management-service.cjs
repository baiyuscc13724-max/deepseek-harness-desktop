const path = require('node:path')
const { randomUUID } = require('node:crypto')

const { CapabilityBroker } = require('./capability-broker.cjs')
const { StorageCleanupService } = require('./storage-cleanup-service.cjs')
const { scanHarnessData } = require('./storage-scan-service.cjs')

const PREVIEW_TTL_MS = 10 * 60_000
const MAX_PENDING_PREVIEWS = 8
const MAX_TEMP_ENTRIES = 100
const AUTO_CACHE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000

function sanitizeOptions(input = {}) {
  const tempEntries = Array.isArray(input.tempEntries)
    ? [...new Set(input.tempEntries
      .map(value => String(value || '').trim())
      .filter(name => name && name === path.basename(name) && name !== '.' && name !== '..'))]
      .slice(0, MAX_TEMP_ENTRIES)
    : []
  const days = Number(input.tempAgeDays)
  const tempAgeDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.floor(days))) : 7
  return Object.freeze({
    includeOldRuntimes: input.includeOldRuntimes !== false,
    includeCaches: input.includeCaches !== false,
    tempEntries,
    tempAgeMs: tempAgeDays * 24 * 60 * 60 * 1000
  })
}

function publicPlan(plan) {
  const sanitize = item => {
    const { identity, ...safe } = item || {}
    return safe
  }
  return {
    ...plan,
    deletions: (plan.deletions || []).map(sanitize),
    applied: Array.isArray(plan.applied) ? plan.applied.map(sanitize) : plan.applied
  }
}

class StorageManagementService {
  constructor(options = {}) {
    if (!options.root) throw new Error('HarnessData root is required.')
    this.root = path.resolve(options.root)
    this.now = options.now || (() => Date.now())
    this.idFactory = options.idFactory || (() => randomUUID())
    this.broker = options.broker || new CapabilityBroker({ now: this.now })
    this.cleanup = options.cleanup || new StorageCleanupService({
      now: this.now,
      version: options.version,
      platform: options.platform,
      arch: options.arch
    })
    this.previews = new Map()
    this.maintenancePromise = null
    this.lastMaintenance = null
  }

  async scan() {
    const request = this.#dispatch('storageScan', undefined, false)
    if (!request) throw new Error('存储扫描请求未能派发。')
    return scanHarnessData(this.root, { now: this.now })
  }

  async preview(input = {}) {
    const options = sanitizeOptions(input)
    const request = this.#dispatch('storageCleanupPreview', options, false)
    if (!request) throw new Error('存储清理预览请求未能派发。')
    const plan = await this.cleanup.plan(this.root, { ...request.payload, preview: true })
    this.#expirePreviews()
    while (this.previews.size >= MAX_PENDING_PREVIEWS) this.previews.delete(this.previews.keys().next().value)
    const previewId = this.idFactory()
    this.previews.set(previewId, {
      options,
      approvedCandidates: plan.deletions.map(candidate => ({ ...candidate, identity: { ...candidate.identity } })),
      createdAt: this.now(),
      expiresAt: this.now() + PREVIEW_TTL_MS
    })
    return { ...publicPlan(plan), previewId, expiresAt: new Date(this.now() + PREVIEW_TTL_MS).toISOString() }
  }

  async apply(previewId, { confirmed = false } = {}) {
    this.#expirePreviews()
    const key = String(previewId || '')
    const preview = this.previews.get(key)
    if (!preview) throw new Error('清理预览不存在或已过期，请重新预览。')
    if (!confirmed) throw new Error('执行存储清理需要用户明确确认。')
    this.previews.delete(key)
    const request = this.#dispatch('storageCleanupApply', preview.options, true)
    if (!request) throw new Error('存储清理请求未获确认。')
    const plan = await this.cleanup.plan(this.root, { ...request.payload, preview: false, approvedCandidates: preview.approvedCandidates })
    return publicPlan(plan)
  }

  async maintainCaches({ minAgeMs = AUTO_CACHE_MIN_AGE_MS } = {}) {
    if (this.maintenancePromise) return this.maintenancePromise
    const threshold = Math.max(AUTO_CACHE_MIN_AGE_MS, Number.isFinite(Number(minAgeMs)) ? Number(minAgeMs) : AUTO_CACHE_MIN_AGE_MS)
    this.maintenancePromise = (async () => {
      const startedAt = new Date(this.now()).toISOString()
      try {
        const preview = await this.cleanup.plan(this.root, {
          preview: true,
          includeOldRuntimes: false,
          includeCaches: true,
          tempEntries: []
        })
        const approvedCandidates = preview.deletions.filter(candidate => candidate.kind === 'cache' && Number(candidate.ageMs) >= threshold)
        const applied = approvedCandidates.length
          ? await this.cleanup.plan(this.root, {
              preview: false,
              includeOldRuntimes: false,
              includeCaches: true,
              tempEntries: [],
              approvedCandidates
            })
          : { applied: [], summary: { candidates: 0, freedBytes: 0 } }
        const deleted = (applied.applied || []).filter(item => item.applied)
        this.lastMaintenance = {
          ok: true,
          startedAt,
          completedAt: new Date(this.now()).toISOString(),
          deletedEntries: deleted.length,
          freedBytes: deleted.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
        }
        return { ...this.lastMaintenance }
      } catch (error) {
        this.lastMaintenance = {
          ok: false,
          startedAt,
          completedAt: new Date(this.now()).toISOString(),
          deletedEntries: 0,
          freedBytes: 0,
          error: String(error?.message || error).slice(0, 300)
        }
        throw error
      } finally {
        this.maintenancePromise = null
      }
    })()
    return this.maintenancePromise
  }

  status() {
    this.#expirePreviews()
    return {
      broker: this.broker.snapshot(),
      pendingPreviews: this.previews.size,
      automaticCache: {
        enabled: true,
        minimumAgeMs: AUTO_CACHE_MIN_AGE_MS,
        protectedKinds: ['sessions', 'attachments', 'memories', 'workspace', 'current-runtime'],
        lastRun: this.lastMaintenance ? { ...this.lastMaintenance } : null
      }
    }
  }

  stop() {
    this.previews.clear()
    return this.broker.stop(null, 'DESKTOP_STOP')
  }

  #dispatch(action, payload, confirm) {
    const accepted = this.broker.accept({
      action,
      token: this.broker.currentToken(),
      source: '127.0.0.1',
      payload,
      confirmation: { message: '仅在用户检查清理预览并明确确认后执行。' }
    })
    return this.broker.next(accepted.capability, { confirm })
  }

  #expirePreviews() {
    const now = this.now()
    for (const [id, preview] of this.previews) {
      if (preview.expiresAt <= now) this.previews.delete(id)
    }
  }
}

module.exports = {
  AUTO_CACHE_MIN_AGE_MS,
  MAX_PENDING_PREVIEWS,
  MAX_TEMP_ENTRIES,
  PREVIEW_TTL_MS,
  StorageManagementService,
  sanitizeOptions
}
