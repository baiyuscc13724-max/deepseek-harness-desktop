const path = require('node:path')
const { readFile, rm } = require('node:fs/promises')
const { atomicWriteJson, normalizeReleasePointer } = require('./component-update-store.cjs')
const { normalizeVersion } = require('./component-update-contract.cjs')
const {
  normalizeBaseRef,
  normalizeGithubAuthor,
  normalizeHeadSha,
  normalizePrNumber,
  normalizePreviewTitle,
  normalizeSequence
} = require('./pr-preview-update-contract.cjs')

const PR_PREVIEW_ACTIVATION_SCHEMA_VERSION = 2
const MAX_ACTIVATION_HISTORY = 32

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('PR 预览候选记录无效。')
  const releaseVersion = normalizeVersion(candidate.releaseVersion, 'PR 预览组件版本')
  if (!/-pr\./.test(releaseVersion)) throw new Error('PR 预览组件版本必须是 prerelease。')
  return {
    prNumber: normalizePrNumber(candidate.prNumber),
    title: normalizePreviewTitle(candidate.title),
    author: normalizeGithubAuthor(candidate.author),
    baseRef: normalizeBaseRef(candidate.baseRef),
    sequence: normalizeSequence(candidate.sequence),
    headSha: normalizeHeadSha(candidate.headSha),
    releaseVersion,
    provider: candidate.provider === 'github' ? 'github' : 'cnb'
  }
}

function sameReleasePointer(left, right) {
  if (!left || !right) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function normalizeActivationRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (![1, PR_PREVIEW_ACTIVATION_SCHEMA_VERSION].includes(value.schemaVersion)) return null
  const capturedAt = new Date(value.capturedAt)
  if (!Number.isFinite(capturedAt.getTime())) throw new Error('PR 预览稳定回滚点时间无效。')
  const baseline = normalizeReleasePointer(value.baseline ?? null)
  const history = value.schemaVersion === 1
    ? []
    : (Array.isArray(value.history) ? value.history : []).slice(-MAX_ACTIVATION_HISTORY).map(normalizeCandidate)
  const candidate = normalizeCandidate(value.candidate)
  let previousSequence = 0
  for (const entry of [...history, candidate]) {
    if (entry.sequence <= previousSequence) throw new Error('PR 预览激活历史 sequence 必须严格递增。')
    previousSequence = entry.sequence
  }
  return {
    schemaVersion: PR_PREVIEW_ACTIVATION_SCHEMA_VERSION,
    capturedAt: capturedAt.toISOString(),
    baseline,
    history,
    candidate
  }
}

class PrPreviewActivationStore {
  constructor(componentRoot, options = {}) {
    this.file = path.join(path.resolve(componentRoot), 'pr-preview-activation.json')
    this.readFile = options.readFileImpl || readFile
    this.atomicWrite = options.atomicWriteImpl || atomicWriteJson
    this.rm = options.rmImpl || rm
  }

  async get() {
    try { return normalizeActivationRecord(JSON.parse(await this.readFile(this.file, 'utf8'))) }
    catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  async capture({ baseline = null, prNumber, title, author, baseRef, sequence, headSha, releaseVersion, provider }, now = new Date()) {
    const proposed = normalizeCandidate({ prNumber, title, author, baseRef, sequence, headSha, releaseVersion, provider })
    const current = await this.get()
    if (current) {
      if (proposed.sequence < current.candidate.sequence) throw new Error('PR 预览 sequence 回退，拒绝覆盖稳定回滚点并激活。')
      if (proposed.sequence === current.candidate.sequence) {
        if (proposed.headSha !== current.candidate.headSha) throw new Error('PR 预览相同 sequence 对应不同 head SHA，拒绝覆盖稳定回滚点并激活。')
        return current
      }
      const next = normalizeActivationRecord({
        ...current,
        history: [...current.history, current.candidate].slice(-MAX_ACTIVATION_HISTORY),
        candidate: proposed
      })
      await this.atomicWrite(this.file, next)
      return next
    }
    const next = normalizeActivationRecord({
      schemaVersion: PR_PREVIEW_ACTIVATION_SCHEMA_VERSION,
      capturedAt: now.toISOString(),
      baseline,
      history: [],
      candidate: proposed
    })
    await this.atomicWrite(this.file, next)
    return next
  }

  async restore(previous) {
    const restored = normalizeActivationRecord(previous)
    if (!restored) return this.clear()
    await this.atomicWrite(this.file, restored)
    return restored
  }

  async reconcileActive(active) {
    const current = await this.get()
    if (!current) return null
    const pointer = normalizeReleasePointer(active ?? null)
    const releaseVersion = pointer?.releaseVersion || ''
    if (current.candidate.releaseVersion === releaseVersion) return current
    const historyIndex = current.history.findIndex(candidate => candidate.releaseVersion === releaseVersion)
    if (historyIndex >= 0) {
      const reconciled = normalizeActivationRecord({
        ...current,
        history: current.history.slice(0, historyIndex),
        candidate: current.history[historyIndex]
      })
      await this.atomicWrite(this.file, reconciled)
      return reconciled
    }
    if (sameReleasePointer(current.baseline, pointer)) return this.clear()
    throw new Error('活动组件指针不属于当前 PR 预览、激活历史或稳定回滚点，拒绝协调。')
  }

  async clear() {
    await this.rm(this.file, { force: true })
    return null
  }
}

module.exports = {
  PR_PREVIEW_ACTIVATION_SCHEMA_VERSION,
  PrPreviewActivationStore,
  normalizeActivationRecord
}
