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

const PR_PREVIEW_ACTIVATION_SCHEMA_VERSION = 1

function normalizeActivationRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.schemaVersion !== PR_PREVIEW_ACTIVATION_SCHEMA_VERSION) return null
  const capturedAt = new Date(value.capturedAt)
  if (!Number.isFinite(capturedAt.getTime())) throw new Error('PR 预览稳定回滚点时间无效。')
  const baseline = normalizeReleasePointer(value.baseline ?? null)
  const candidate = value.candidate
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('PR 预览候选记录无效。')
  const releaseVersion = normalizeVersion(candidate.releaseVersion, 'PR 预览组件版本')
  if (!/-pr\./.test(releaseVersion)) throw new Error('PR 预览组件版本必须是 prerelease。')
  return {
    schemaVersion: PR_PREVIEW_ACTIVATION_SCHEMA_VERSION,
    capturedAt: capturedAt.toISOString(),
    baseline,
    candidate: {
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
    const next = normalizeActivationRecord({
      schemaVersion: PR_PREVIEW_ACTIVATION_SCHEMA_VERSION,
      capturedAt: now.toISOString(),
      baseline,
      candidate: { prNumber, title, author, baseRef, sequence, headSha, releaseVersion, provider }
    })
    const current = await this.get()
    if (current) {
      if (JSON.stringify(current.candidate) !== JSON.stringify(next.candidate)) {
        throw new Error('已有另一项 PR 预览等待应用或退出，拒绝覆盖稳定回滚点。')
      }
      return current
    }
    await this.atomicWrite(this.file, next)
    return next
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
