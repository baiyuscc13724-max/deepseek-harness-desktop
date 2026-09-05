import z from '@deepseek-ai/schemastery'
import { WebError } from '@deepseek-ai/dsh-web'

const PUBLIC_SEARCH_PROVIDER_ID = 'desktop-public-search'
const PUBLIC_FETCH_PROVIDER_ID = 'desktop-public-fetch'
const DEFAULT_FETCH_PROVIDER_ID = 'http'
const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_RESULTS = 10
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 HarnessDesktop/1.0.60'

const name = 'desktop-public-web-search'
const inject = ['web']
const Config = z.object({
  timeoutMs: z.number().step(1).min(1_000).max(60_000).default(DEFAULT_TIMEOUT_MS),
  maxResults: z.number().step(1).min(1).max(20).default(DEFAULT_MAX_RESULTS)
})

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(value || '')
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/giu, (match, entity) => named[entity.toLowerCase()] ?? match)
}

function plainText(value) {
  return decodeEntities(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ').replace(/<[^>]+>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim()
}

function safeHttpUrl(value, base) {
  try {
    const url = new URL(decodeEntities(value), base)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}

function hostMatches(hostname, apex) {
  return hostname === apex || hostname.endsWith(`.${apex}`)
}

function searchPageRequest(value) {
  let url
  try { url = new URL(String(value)) } catch { return undefined }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '')
  const pathname = url.pathname.replace(/\/+$/u, '') || '/'
  let parameter
  if (hostMatches(hostname, 'bing.com') && pathname === '/search') parameter = 'q'
  else if ((hostname === 'google.com' || hostname === 'www.google.com') && pathname === '/search') parameter = 'q'
  else if (hostMatches(hostname, 'baidu.com') && pathname === '/s') parameter = 'wd'
  else if (hostMatches(hostname, 'sogou.com') && pathname === '/web') parameter = 'query'
  if (parameter === undefined) return undefined
  const query = String(url.searchParams.get(parameter) || '').trim()
  return query ? { query, url: url.href } : undefined
}

function boundedField(value, maximum) {
  const text = plainText(value)
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…`
}

function formatSearchFetchBody(query, result) {
  const rows = result.sources.map((source, index) => {
    const title = boundedField(source.title || source.url, 500)
    const snippet = boundedField(source.snippet || '', 2_000)
    return `${index + 1}. ${title}\n   ${source.url}${snippet ? `\n   ${snippet}` : ''}`
  })
  return `Search results for ${JSON.stringify(query)}:\n\n${rows.join('\n\n')}`
}

function tagValue(block, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'iu').exec(block)
  return match ? plainText(match[1]) : ''
}

function parseBingRss(xml) {
  const sources = []
  for (const match of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)) {
    const block = match[1]
    const url = safeHttpUrl(tagValue(block, 'link'))
    if (!url) continue
    const title = tagValue(block, 'title')
    const snippet = tagValue(block, 'description')
    const publishedAt = tagValue(block, 'pubDate')
    sources.push({ url, ...(title ? { title } : {}), ...(snippet ? { snippet } : {}), ...(publishedAt ? { publishedAt } : {}) })
  }
  return sources
}

function hrefFromAnchor(anchor, base) {
  const match = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu.exec(anchor)
  return safeHttpUrl(match?.[1] || match?.[2] || match?.[3], base)
}

function parseSearchHtml(html, base) {
  const sources = []
  const seen = new Set()
  const patterns = [
    /<h3\b[^>]*>[\s\S]*?<a\b[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/h3>/giu,
    /<a\b[^>]*class=(?:"[^"]*(?:result|vr-title)[^"]*"|'[^']*(?:result|vr-title)[^']*')[^>]*>[\s\S]*?<\/a>/giu
  ]
  for (const pattern of patterns) {
    for (const match of String(html || '').matchAll(pattern)) {
      const block = match[0]
      const anchor = /<a\b[^>]*>[\s\S]*?<\/a>/iu.exec(block)?.[0] || block
      const url = hrefFromAnchor(anchor, base)
      const title = plainText(anchor)
      if (!url || !title || seen.has(url)) continue
      seen.add(url)
      sources.push({ url, title })
    }
  }
  return sources
}

function boundedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout])
  return signal
}

async function boundedText(response) {
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_RESPONSE_BYTES) throw new WebError('公开搜索响应过大，已安全拒绝。', 'WEB_PROVIDER_ERROR')
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new WebError('公开搜索响应超过大小上限。', 'WEB_PROVIDER_ERROR')
  return text
}

async function requestText(url, options, signal) {
  let response
  try {
    response = await (options.fetchImpl || fetch)(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8', 'user-agent': USER_AGENT },
      signal: boundedSignal(signal, options.timeoutMs)
    })
  } catch (cause) {
    if (signal?.aborted) throw new WebError('公开搜索已取消。', 'WEB_ABORTED', { cause })
    throw new WebError(`公开搜索网络请求失败：${String(cause)}`, 'WEB_PROVIDER_ERROR', { cause })
  }
  if (!response.ok) throw new WebError(`公开搜索服务返回 HTTP ${response.status}。`, 'WEB_PROVIDER_ERROR')
  return boundedText(response)
}

const ENGINES = Object.freeze([
  {
    id: 'bing-rss',
    url: query => `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    parse: parseBingRss
  },
  {
    id: 'sogou-html',
    url: query => `https://www.sogou.com/web?query=${encodeURIComponent(query)}`,
    parse: (text, url) => parseSearchHtml(text, url)
  },
  {
    id: 'baidu-html',
    url: query => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
    parse: (text, url) => parseSearchHtml(text, url)
  }
])

class PublicSearchProvider {
  constructor(resolveOptions = () => ({})) {
    this.id = PUBLIC_SEARCH_PROVIDER_ID
    this.resolveOptions = resolveOptions
  }

  available() {
    return true
  }

  async search(request, signal) {
    const configured = this.resolveOptions() || {}
    const options = {
      timeoutMs: Number(configured.timeoutMs) || DEFAULT_TIMEOUT_MS,
      maxResults: Number(configured.maxResults) || DEFAULT_MAX_RESULTS,
      fetchImpl: configured.fetchImpl
    }
    const failures = []
    for (const engine of configured.engines || ENGINES) {
      const url = engine.url(request.query)
      try {
        const sources = engine.parse(await requestText(url, options, signal), url).slice(0, options.maxResults)
        if (sources.length > 0) return { sources, truncated: false }
        failures.push(new Error(`${engine.id}: no results`))
      } catch (error) {
        if (signal?.aborted || error?.code === 'WEB_ABORTED') throw error
        failures.push(error)
      }
    }
    throw new AggregateError(failures, '所有内置公开搜索通道均不可用；未调用 Codex 或 DeepSeek 付费搜索。')
  }
}

class DesktopPublicFetchProvider {
  constructor(web, resolveOptions = () => ({}), delegateProviderId = DEFAULT_FETCH_PROVIDER_ID) {
    this.id = PUBLIC_FETCH_PROVIDER_ID
    this.web = web
    this.resolveOptions = resolveOptions
    this.delegateProviderId = delegateProviderId
  }

  available() {
    return typeof this.web.search === 'function' || this.delegate()?.available?.() === true
  }

  delegate() {
    const provider = this.web.fetchProviders?.get?.(this.delegateProviderId)
    return provider === this ? undefined : provider
  }

  async fetch(request, signal) {
    const searchPage = searchPageRequest(request.url)
    if (searchPage !== undefined) {
      const configured = this.resolveOptions() || {}
      const maxResults = Number(configured.maxResults) || DEFAULT_MAX_RESULTS
      const result = await this.web.search({ query: searchPage.query, maxResults }, signal)
      return {
        url: searchPage.url,
        statusCode: 200,
        body: { kind: 'text', content: formatSearchFetchBody(searchPage.query, result) },
        truncated: result.truncated === true
      }
    }
    const delegate = this.delegate()
    if (delegate === undefined || delegate.available?.() !== true || typeof delegate.fetch !== 'function') {
      throw new WebError(`公开网页抓取委托 ${this.delegateProviderId} 不可用。`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return delegate.fetch(request, signal)
  }
}

function apply(ctx, config = {}) {
  const previousSearchProviderId = ctx.web.searchProviderId
  const previousFetchProviderId = ctx.web.fetchProviderId
  const delegateProviderId = previousFetchProviderId && previousFetchProviderId !== PUBLIC_FETCH_PROVIDER_ID
    ? previousFetchProviderId
    : DEFAULT_FETCH_PROVIDER_ID
  ctx.web.registerSearchProvider(new PublicSearchProvider(() => config))
  ctx.web.registerFetchProvider(new DesktopPublicFetchProvider(ctx.web, () => config, delegateProviderId))
  ctx.web.searchProviderId = PUBLIC_SEARCH_PROVIDER_ID
  ctx.web.fetchProviderId = PUBLIC_FETCH_PROVIDER_ID
  ctx.effect(function* () {
    yield () => {
      if (ctx.web.searchProviderId === PUBLIC_SEARCH_PROVIDER_ID) ctx.web.searchProviderId = previousSearchProviderId
      if (ctx.web.fetchProviderId === PUBLIC_FETCH_PROVIDER_ID) ctx.web.fetchProviderId = previousFetchProviderId
    }
  }, 'desktop-public-web-search.select-provider')
}

export {
  Config,
  DesktopPublicFetchProvider,
  ENGINES,
  PUBLIC_FETCH_PROVIDER_ID,
  PUBLIC_SEARCH_PROVIDER_ID,
  PublicSearchProvider,
  apply,
  formatSearchFetchBody,
  inject,
  name,
  parseBingRss,
  parseSearchHtml,
  plainText,
  searchPageRequest
}
