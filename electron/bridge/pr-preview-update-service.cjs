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
  if (officialPreviewProvider(new URL(from)) !== officialPreviewProvider(new URL(target))) {
    throw new Error('PR 预览请求拒绝跨来源重定向。')
  }
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

async function fetchOfficialPreviewJson({
  url,
  kind,
  headSha = '',
  fetchImpl = globalThis.fetch,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  maxBytes = DEFAULT_MAX_JSON_BYTES
}) {
  if (typeof fetchImpl !== 'function') throw new Error('PR 预览下载器不可用。')
  let current = safeOfficialPreviewUrl(url, { kind, headSha })
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(current, {
      redirect: 'manual',
      headers: { Accept: 'application/json', 'User-Agent': 'Harness-Desktop-PR-Preview' }
    })
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
      if (officialPreviewProvider(new URL(finalUrl)) !== officialPreviewProvider(new URL(current))) {
        throw new Error('PR 预览响应发生未授权跨来源重定向。')
      }
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

function normalizePreviewState(value) {
  if (value === null || value === undefined) return { sequence: 0, headSha: '' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PR 预览防重放状态无效。')
  const sequence = Number(value.sequence || 0)
  if (sequence === 0 && !value.headSha) return { sequence: 0, headSha: '' }
  return { sequence: normalizeSequence(sequence), headSha: normalizeHeadSha(value.headSha) }
}

function createMemoryPreviewState(initial = null) {
  let value = initial
  return {
    async load() { return value },
    async save(next) { value = { ...next } }
  }
}

function assertStateStore(state) {
  if (!state || typeof state.load !== 'function' || typeof state.save !== 'function') {
    throw new Error('PR 预览服务需要可注入的 load/save 状态存储。')
  }
  return state
}

function previewCandidateKey(value) {
  return `${normalizeSequence(value?.sequence)}:${normalizeHeadSha(value?.headSha)}`
}

function replayDisposition(index, previous) {
  if (index.sequence < previous.sequence) return 'older'
  if (index.sequence === previous.sequence) return index.headSha === previous.headSha ? 'same' : 'conflict'
  return 'newer'
}

class PrPreviewUpdateService {
  constructor({
    enabled = false,
    channelUrls,
    indexUrls = channelUrls || OFFICIAL_PREVIEW_INDEX_URLS,
    trustedKeys = {},
    fetchImpl = globalThis.fetch,
    clock = () => Date.now(),
    state = createMemoryPreviewState(),
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    maxBytes = DEFAULT_MAX_JSON_BYTES
  } = {}) {
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
    this.pendingCandidates = new Map()
  }

  async discover() {
    if (!this.enabled) return { available: false, reason: 'disabled', repository: OFFICIAL_PREVIEW_REPOSITORY }
    if (this.activeDiscovery) return this.activeDiscovery
    this.activeDiscovery = this.#discover().finally(() => { this.activeDiscovery = null })
    return this.activeDiscovery
  }

  async accept(candidate) {
    if (!this.enabled) return { accepted: false, reason: 'disabled' }
    if (this.activeAcceptance) return this.activeAcceptance
    this.activeAcceptance = this.#accept(candidate).finally(() => { this.activeAcceptance = null })
    return this.activeAcceptance
  }

  async #loadState() {
    return normalizePreviewState(await this.state.load())
  }

  async #discover() {
    const now = Number(this.clock())
    if (!Number.isFinite(now)) throw new Error('PR 预览时钟无效。')
    const previous = await this.#loadState()
    const failures = []
    const unchanged = []
    let indexResult = null
    for (const url of this.indexUrls) {
      try {
        const fetched = await fetchOfficialPreviewJson({
          url,
          kind: 'index',
          fetchImpl: this.fetchImpl,
          maxRedirects: this.maxRedirects,
          maxBytes: this.maxBytes
        })
        const index = validateAndVerifyPreviewIndex(fetched.payload, this.trustedKeys, {
          now,
          normalizeManifestUrls: normalizeOfficialManifestUrls
        })
        const disposition = replayDisposition(index, previous)
        if (disposition === 'older') throw new Error('PR 预览 sequence 回退，拒绝重放。')
        if (disposition === 'conflict') throw new Error('PR 预览相同 sequence 对应不同 head SHA，拒绝重放。')
        if (disposition === 'same') {
          unchanged.push({ ...fetched, value: index })
          continue
        }
        indexResult = { ...fetched, value: index }
        break
      } catch (error) {
        failures.push(`${officialPreviewProvider(new URL(url))}: ${error.message}`)
      }
    }
    if (!indexResult) {
      if (unchanged.length) {
        const accepted = unchanged.at(-1)
        return {
          available: false,
          reason: 'not-newer',
          repository: OFFICIAL_PREVIEW_REPOSITORY,
          headSha: accepted.value.headSha,
          sequence: accepted.value.sequence,
          indexSource: accepted.source
        }
      }
      throw new Error(`所有 PR 预览索引源均不可用：${failures.join('；')}`)
    }
    const index = indexResult.value
    const manifestResult = await fetchPreviewWithFallback({
      urls: index.manifestUrls,
      kind: 'manifest',
      headSha: index.headSha,
      fetchImpl: this.fetchImpl,
      maxRedirects: this.maxRedirects,
      maxBytes: this.maxBytes,
      validate: payload => validateAndVerifyPreviewManifest(payload, this.trustedKeys, { now })
    })
    const previewManifest = manifestResult.value
    assertIndexMatchesManifest(index, previewManifest)
    const result = {
      available: true,
      channel: 'pr-preview',
      repository: OFFICIAL_PREVIEW_REPOSITORY,
      prNumber: index.prNumber,
      title: index.title,
      author: index.author,
      baseRef: index.baseRef,
      headSha: index.headSha,
      sequence: index.sequence,
      publishedAt: previewManifest.publishedAt,
      expiresAt: previewManifest.expiresAt,
      notes: index.notes,
      provider: manifestResult.provider,
      indexSource: indexResult.source,
      manifestSource: manifestResult.source,
      manifest: previewManifest.componentManifest
    }
    this.pendingCandidates.set(previewCandidateKey(result), {
      headSha: result.headSha,
      sequence: result.sequence,
      expiresAt: result.expiresAt
    })
    return result
  }

  async #accept(candidate) {
    const key = previewCandidateKey(candidate)
    const pending = this.pendingCandidates.get(key)
    if (!pending) throw new Error('PR 预览候选未经本服务验证，拒绝接受。')
    const now = Number(this.clock())
    if (!Number.isFinite(now)) throw new Error('PR 预览时钟无效。')
    if (Date.parse(pending.expiresAt) <= now) {
      this.pendingCandidates.delete(key)
      throw new Error('PR 预览候选已过期，拒绝接受。')
    }
    const previous = await this.#loadState()
    const disposition = replayDisposition(pending, previous)
    if (disposition === 'older') throw new Error('PR 预览 sequence 回退，拒绝接受。')
    if (disposition === 'conflict') throw new Error('PR 预览相同 sequence 对应不同 head SHA，拒绝接受。')
    if (disposition === 'same') return { accepted: false, reason: 'already-accepted', sequence: pending.sequence, headSha: pending.headSha }
    const nextState = {
      schemaVersion: 1,
      repository: OFFICIAL_PREVIEW_REPOSITORY,
      sequence: pending.sequence,
      headSha: pending.headSha,
      acceptedAt: new Date(now).toISOString()
    }
    await this.state.save(nextState)
    for (const [candidateKey, value] of this.pendingCandidates) {
      if (value.sequence <= pending.sequence) this.pendingCandidates.delete(candidateKey)
    }
    return { accepted: true, state: nextState }
  }
}

module.exports = {
  DEFAULT_MAX_JSON_BYTES,
  DEFAULT_MAX_REDIRECTS,
  PrPreviewUpdateService,
  createMemoryPreviewState,
  fetchOfficialPreviewJson,
  fetchPreviewWithFallback,
  normalizePreviewState,
  resolveOfficialPreviewRedirect
}
