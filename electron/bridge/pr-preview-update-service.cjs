const { createHash } = require('node:crypto')
const { canonicalJson } = require('./component-update-contract.cjs')
const {
  OFFICIAL_PREVIEW_REPOSITORY,
  assertIndexMatchesManifest,
  normalizeHeadSha,
  normalizeSequence,
  validateAndVerifyPreviewIndex,
  validateAndVerifyPreviewManifest
} = require('./pr-preview-update-contract.cjs')
const {
  OFFICIAL_PREVIEW_INDEX_URLS,
  normalizeOfficialIndexUrls,
  normalizeOfficialManifestUrls,
  officialPreviewProvider,
  safeOfficialPreviewUrl
} = require('./pr-preview-update-config.cjs')

const DEFAULT_MAX_REDIRECTS = 2
const DEFAULT_MAX_JSON_BYTES = 1024 * 1024
const MAX_PERSISTED_CANDIDATES = 128
const MAX_INSTALLED_PREVIEW_HEADS = 128
const CANDIDATE_ID_PATTERN = /^pr-[a-f0-9]{64}$/

function responseHeader(response, name) {
  if (typeof response?.headers?.get === 'function') return response.headers.get(name)
  const headers = response?.headers || {}
  return headers[name] || headers[name.toLowerCase()] || ''
}

function resolveOfficialPreviewRedirect(fromUrl, location, { kind, headSha = '', redirectCount = 0, maxRedirects = DEFAULT_MAX_REDIRECTS } = {}) {
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || redirectCount >= maxRedirects) {
    throw new Error(`PR 预览请求重定向超过 ${maxRedirects} 次。`)
  }
  const from = safeOfficialPreviewUrl(fromUrl, { kind, headSha })
  const target = safeOfficialPreviewUrl(new URL(String(location || ''), from).toString(), { kind, headSha })
  if (officialPreviewProvider(new URL(from)) !== officialPreviewProvider(new URL(target))) throw new Error('PR 预览请求拒绝跨来源重定向。')
  return target
}

async function responseJson(response, maxBytes) {
  const contentLength = Number(responseHeader(response, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error('PR 预览响应过大。')
  if (typeof response?.text === 'function') {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('PR 预览响应过大。')
    try { return JSON.parse(body) } catch (error) { throw new Error(`PR 预览响应不是有效 JSON：${error.message}`) }
  }
  if (typeof response?.json === 'function') {
    const payload = await response.json()
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > maxBytes) throw new Error('PR 预览响应过大。')
    return payload
  }
  throw new Error('PR 预览响应读取器不可用。')
}

async function fetchOfficialPreviewJson({ url, kind, headSha = '', fetchImpl = globalThis.fetch, maxRedirects = DEFAULT_MAX_REDIRECTS, maxBytes = DEFAULT_MAX_JSON_BYTES }) {
  if (typeof fetchImpl !== 'function') throw new Error('PR 预览下载器不可用。')
  let current = safeOfficialPreviewUrl(url, { kind, headSha })
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(current, { redirect: 'manual', headers: { Accept: 'application/json', 'User-Agent': 'Harness-Desktop-PR-Preview' } })
    const status = Number(response?.status)
    if (status >= 300 && status < 400) {
      const location = responseHeader(response, 'location')
      if (!location) throw new Error(`PR 预览重定向缺少 Location（HTTP ${status}）。`)
      current = resolveOfficialPreviewRedirect(current, location, { kind, headSha, redirectCount, maxRedirects })
      continue
    }
    if (!Number.isSafeInteger(status) || status < 200 || status >= 300) throw new Error(`PR 预览请求失败（HTTP ${status || 'unknown'}）。`)
    if (response.url) {
      const finalUrl = safeOfficialPreviewUrl(response.url, { kind, headSha })
      if (officialPreviewProvider(new URL(finalUrl)) !== officialPreviewProvider(new URL(current))) throw new Error('PR 预览响应发生未授权跨来源重定向。')
      current = finalUrl
    }
    return { payload: await responseJson(response, maxBytes), source: current, provider: officialPreviewProvider(new URL(current)) }
  }
}

async function fetchPreviewWithFallback({ urls, kind, headSha = '', fetchImpl, validate, maxRedirects, maxBytes }) {
  const failures = []
  for (const url of urls) {
    try {
      const fetched = await fetchOfficialPreviewJson({ url, kind, headSha, fetchImpl, maxRedirects, maxBytes })
      return { ...fetched, value: validate(fetched.payload) }
    } catch (error) {
      failures.push(`${officialPreviewProvider(new URL(url)) || 'unknown'}: ${error.message}`)
    }
  }
  throw new Error(`所有 PR 预览${kind === 'index' ? '索引' : '清单'}源均不可用：${failures.join('；')}`)
}

function previewCandidateId(index, previewManifest) {
  const digest = createHash('sha256').update(canonicalJson({ index, previewManifest }), 'utf8').digest('hex')
  return `pr-${digest}`
}

function normalizeStoredCandidate(value, { verifyId = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PR 预览持久候选无效。')
  const id = String(value.id || '')
  if (!CANDIDATE_ID_PATTERN.test(id)) throw new Error('PR 预览候选 id 无效。')
  if (!value.index || !value.previewManifest) throw new Error('PR 预览候选缺少签名载荷。')
  if (verifyId && id !== previewCandidateId(value.index, value.previewManifest)) throw new Error('PR 预览候选 id 与签名载荷不一致。')
  const provider = value.provider === 'github' ? 'github' : 'cnb'
  const indexProvider = value.indexProvider === 'github' ? 'github' : value.indexProvider === 'cnb' ? 'cnb' : provider
  return { id, provider, indexProvider, index: value.index, previewManifest: value.previewManifest }
}

function normalizeInstalledPreviewHeads(value) {
  const output = []
  const seen = new Set()
  for (const input of Array.isArray(value) ? value.slice(-MAX_INSTALLED_PREVIEW_HEADS * 2) : []) {
    let headSha = ''
    try { headSha = normalizeHeadSha(input) } catch { continue }
    if (seen.has(headSha)) continue
    seen.add(headSha)
    output.push(headSha)
    if (output.length > MAX_INSTALLED_PREVIEW_HEADS) output.shift()
  }
  return output
}

function normalizePreviewState(value) {
  if (value === null || value === undefined) return { sequence: 0, headSha: '', installedHeads: [], candidates: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PR 预览防重放状态无效。')
  const sequence = Number(value.sequence || 0)
  const accepted = sequence === 0 && !value.headSha
    ? { sequence: 0, headSha: '' }
    : { sequence: normalizeSequence(sequence), headSha: normalizeHeadSha(value.headSha) }
  const installedHeads = normalizeInstalledPreviewHeads([
    ...(Array.isArray(value.installedHeads) ? value.installedHeads : []),
    ...(accepted.sequence > 0 ? [accepted.headSha] : [])
  ])
  const installed = new Set(installedHeads)
  const candidates = []
  const seen = new Set()
  for (const input of Array.isArray(value.candidates) ? value.candidates.slice(-MAX_PERSISTED_CANDIDATES * 2) : []) {
    const candidate = normalizeStoredCandidate(input, { verifyId: false })
    const candidateSequence = Number(candidate.index?.sequence || 0)
    const candidateHeadSha = String(candidate.index?.headSha || '').toLowerCase()
    if (!Number.isSafeInteger(candidateSequence) || candidateSequence <= accepted.sequence || installed.has(candidateHeadSha) || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    candidates.push(candidate)
    if (candidates.length > MAX_PERSISTED_CANDIDATES) candidates.shift()
  }
  return { ...accepted, installedHeads, candidates }
}

function createMemoryPreviewState(initial = null) {
  let value = initial
  return {
    async load() { return value },
    async save(next) { value = JSON.parse(JSON.stringify(next)) }
  }
}

function assertStateStore(state) {
  if (!state || typeof state.load !== 'function' || typeof state.save !== 'function') throw new Error('PR 预览服务需要可注入的 load/save 状态存储。')
  return state
}

function replayDisposition(index, previous) {
  if (index.sequence < previous.sequence) return 'older'
  if (index.sequence === previous.sequence) return index.headSha === previous.headSha ? 'same' : 'conflict'
  return 'newer'
}

class PrPreviewUpdateService {
  constructor({ enabled = false, channelUrls, indexUrls = channelUrls || OFFICIAL_PREVIEW_INDEX_URLS, trustedKeys = {}, fetchImpl = globalThis.fetch, clock = () => Date.now(), state = createMemoryPreviewState(), maxRedirects = DEFAULT_MAX_REDIRECTS, maxBytes = DEFAULT_MAX_JSON_BYTES } = {}) {
    this.enabled = enabled === true
    this.indexUrls = normalizeOfficialIndexUrls(indexUrls)
    this.trustedKeys = trustedKeys
    this.fetchImpl = fetchImpl
    this.clock = clock
    this.state = assertStateStore(state)
    this.maxRedirects = maxRedirects
    this.maxBytes = maxBytes
    this.activeDiscovery = null
    this.activeAcceptance = null
  }

  async discover() {
    if (!this.enabled) return { available: false, reason: 'disabled', repository: OFFICIAL_PREVIEW_REPOSITORY }
    if (this.activeDiscovery) return this.activeDiscovery
    this.activeDiscovery = this.#discover().finally(() => { this.activeDiscovery = null })
    return this.activeDiscovery
  }

  async listCandidates({ includeExpired = true } = {}) {
    const now = this.#now()
    const state = await this.#loadState()
    const output = []
    for (const record of state.candidates) {
      try {
        const result = this.#verifyRecord(record, now, true)
        if (includeExpired || Date.parse(result.expiresAt) > now) output.push(result)
      } catch {}
    }
    return output
  }

  async verifyCandidate(candidateId) {
    if (!this.enabled) throw new Error('PR 快速预览通道尚未启用。')
    const id = String(candidateId || '')
    if (!CANDIDATE_ID_PATTERN.test(id)) throw new Error('PR 预览候选 id 无效。')
    const state = await this.#loadState()
    const record = state.candidates.find(value => value.id === id)
    if (!record) throw new Error('PR 预览候选不存在或未经本服务验证。')
    return this.#verifyRecord(record, this.#now(), false)
  }

  async accept(candidate) {
    if (!this.enabled) return { accepted: false, reason: 'disabled' }
    if (this.activeAcceptance) return this.activeAcceptance
    const candidateId = typeof candidate === 'string' ? candidate : candidate?.candidateId
    this.activeAcceptance = this.#accept(candidateId).finally(() => { this.activeAcceptance = null })
    return this.activeAcceptance
  }

  #now() {
    const now = Number(this.clock())
    if (!Number.isFinite(now)) throw new Error('PR 预览时钟无效。')
    return now
  }

  async #loadState() { return normalizePreviewState(await this.state.load()) }

  #verifyRecord(record, now, allowExpired) {
    const stored = normalizeStoredCandidate(record)
    const index = validateAndVerifyPreviewIndex(stored.index, this.trustedKeys, { now, allowExpired, normalizeManifestUrls: normalizeOfficialManifestUrls })
    const previewManifest = validateAndVerifyPreviewManifest(stored.previewManifest, this.trustedKeys, { now, allowExpired })
    assertIndexMatchesManifest(index, previewManifest)
    if (stored.id !== previewCandidateId(stored.index, stored.previewManifest)) throw new Error('PR 预览候选 id 复验失败。')
    return {
      candidateId: stored.id,
      available: Date.parse(previewManifest.expiresAt) > now,
      expired: Date.parse(previewManifest.expiresAt) <= now,
      channel: 'pr-preview', repository: OFFICIAL_PREVIEW_REPOSITORY,
      prNumber: index.prNumber, title: index.title, author: index.author, baseRef: index.baseRef,
      headSha: index.headSha, sequence: index.sequence, publishedAt: previewManifest.publishedAt,
      expiresAt: previewManifest.expiresAt, notes: index.notes, provider: stored.provider,
      indexSource: this.indexUrls[stored.indexProvider === 'github' ? 1 : 0],
      manifestSource: index.manifestUrls[stored.provider === 'github' ? 1 : 0],
      manifest: stored.previewManifest.componentManifest
    }
  }

  async #discover() {
    const now = this.#now()
    const previous = await this.#loadState()
    let highWater = { sequence: previous.sequence, headSha: previous.headSha }
    for (const record of previous.candidates) {
      try {
        const verified = this.#verifyRecord(record, now, true)
        if (verified.sequence > highWater.sequence) highWater = { sequence: verified.sequence, headSha: verified.headSha }
      } catch {}
    }
    const failures = []
    const unchanged = []
    const alreadyInstalled = []
    const installedHeads = new Set(previous.installedHeads)
    let indexResult = null
    for (const url of this.indexUrls) {
      try {
        const fetched = await fetchOfficialPreviewJson({ url, kind: 'index', fetchImpl: this.fetchImpl, maxRedirects: this.maxRedirects, maxBytes: this.maxBytes })
        const index = validateAndVerifyPreviewIndex(fetched.payload, this.trustedKeys, { now, normalizeManifestUrls: normalizeOfficialManifestUrls })
        const disposition = replayDisposition(index, highWater)
        if (disposition === 'older') throw new Error('PR 预览 sequence 回退，拒绝重放。')
        if (disposition === 'conflict') throw new Error('PR 预览相同 sequence 对应不同 head SHA，拒绝重放。')
        if (installedHeads.has(index.headSha)) {
          alreadyInstalled.push({ ...fetched, value: index })
          continue
        }
        if (disposition === 'same') { unchanged.push({ ...fetched, value: index }); continue }
        indexResult = { ...fetched, value: index }
        break
      } catch (error) { failures.push(`${officialPreviewProvider(new URL(url))}: ${error.message}`) }
    }
    if (!indexResult) {
      if (unchanged.length) {
        const accepted = unchanged.at(-1)
        const queued = previous.candidates.find(value => value.index?.sequence === accepted.value.sequence && value.index?.headSha === accepted.value.headSha)
        if (queued) return this.#verifyRecord(queued, now, false)
      }
      if (alreadyInstalled.length) {
        const installed = alreadyInstalled.reduce((latest, value) => value.value.sequence > latest.value.sequence ? value : latest)
        if (installed.value.sequence > previous.sequence) {
          await this.state.save({
            sequence: installed.value.sequence,
            headSha: installed.value.headSha,
            installedHeads: previous.installedHeads,
            candidates: previous.candidates.filter(value => (
              Number(value.index?.sequence || 0) > installed.value.sequence &&
              value.index?.headSha !== installed.value.headSha
            ))
          })
        }
        return { available: false, reason: 'already-installed', repository: OFFICIAL_PREVIEW_REPOSITORY, headSha: installed.value.headSha, sequence: installed.value.sequence, indexSource: installed.source }
      }
      if (unchanged.length) {
        const accepted = unchanged.at(-1)
        return { available: false, reason: 'not-newer', repository: OFFICIAL_PREVIEW_REPOSITORY, headSha: accepted.value.headSha, sequence: accepted.value.sequence, indexSource: accepted.source }
      }
      throw new Error(`所有 PR 预览索引源均不可用：${failures.join('；')}`)
    }
    const index = indexResult.value
    const manifestResult = await fetchPreviewWithFallback({
      urls: index.manifestUrls, kind: 'manifest', headSha: index.headSha, fetchImpl: this.fetchImpl,
      maxRedirects: this.maxRedirects, maxBytes: this.maxBytes,
      validate: payload => validateAndVerifyPreviewManifest(payload, this.trustedKeys, { now })
    })
    assertIndexMatchesManifest(index, manifestResult.value)
    const record = normalizeStoredCandidate({
      id: previewCandidateId(indexResult.payload, manifestResult.payload),
      provider: manifestResult.provider,
      indexProvider: indexResult.provider,
      index: indexResult.payload,
      previewManifest: manifestResult.payload
    })
    const candidates = [...previous.candidates.filter(value => value.id !== record.id), record].slice(-MAX_PERSISTED_CANDIDATES)
    await this.state.save({ sequence: previous.sequence, headSha: previous.headSha, installedHeads: previous.installedHeads, candidates })
    return this.#verifyRecord(record, now, false)
  }

  async #accept(candidateId) {
    const verified = await this.verifyCandidate(candidateId)
    const previous = await this.#loadState()
    const disposition = replayDisposition(verified, previous)
    if (disposition === 'older') throw new Error('PR 预览 sequence 回退，拒绝接受。')
    if (disposition === 'conflict') throw new Error('PR 预览相同 sequence 对应不同 head SHA，拒绝接受。')
    if (disposition === 'same') return { accepted: false, reason: 'already-accepted', sequence: verified.sequence, headSha: verified.headSha }
    const nextState = {
      schemaVersion: 3,
      repository: OFFICIAL_PREVIEW_REPOSITORY,
      sequence: verified.sequence,
      headSha: verified.headSha,
      acceptedAt: new Date(this.#now()).toISOString(),
      installedHeads: normalizeInstalledPreviewHeads([...previous.installedHeads, verified.headSha]),
      candidates: previous.candidates.filter(value => (
        Number(value.index?.sequence || 0) > verified.sequence &&
        value.index?.headSha !== verified.headSha
      ))
    }
    await this.state.save(nextState)
    return { accepted: true, state: nextState }
  }
}

module.exports = {
  CANDIDATE_ID_PATTERN,
  DEFAULT_MAX_JSON_BYTES,
  DEFAULT_MAX_REDIRECTS,
  MAX_INSTALLED_PREVIEW_HEADS,
  MAX_PERSISTED_CANDIDATES,
  PrPreviewUpdateService,
  createMemoryPreviewState,
  fetchOfficialPreviewJson,
  fetchPreviewWithFallback,
  normalizeInstalledPreviewHeads,
  normalizePreviewState,
  previewCandidateId,
  resolveOfficialPreviewRedirect
}
