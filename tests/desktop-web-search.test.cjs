const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const { ensureDesktopWebSearchPlugin } = require('../electron/bridge/desktop-web-search-plugin-service.cjs')

const bundledRoot = path.resolve(__dirname, '..', 'plugins', 'dsh-desktop-web-search')

async function plugin() {
  return import(`${pathToFileURL(path.join(bundledRoot, 'lib', 'index.js')).href}?test=${Date.now()}-${Math.random()}`)
}

function rss(items) {
  return `<?xml version="1.0"?><rss><channel>${items.map(item => `<item><title>${item.title}</title><link>${item.url}</link><description>${item.snippet}</description><pubDate>${item.date || ''}</pubDate></item>`).join('')}</channel></rss>`
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/rss+xml' }),
    text: async () => body
  }
}

test('public search parses bounded RSS sources without any account credential', async () => {
  const { PublicSearchProvider } = await plugin()
  const calls = []
  const provider = new PublicSearchProvider(() => ({
    maxResults: 2,
    timeoutMs: 5_000,
    fetchImpl: async url => {
      calls.push(url)
      return response(rss([
        { title: 'Official &amp; source', url: 'https://example.com/official', snippet: 'Primary &lt;result&gt;', date: 'Tue, 01 Sep 2026 00:00:00 GMT' },
        { title: 'Second', url: 'https://example.org/two', snippet: 'Two' },
        { title: 'Third', url: 'https://example.net/three', snippet: 'Three' }
      ]))
    }
  }))
  const result = await provider.search({ query: 'Harness search' })
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^https:\/\/www\.bing\.com\/search\?/u)
  assert.equal(result.sources.length, 2)
  assert.deepEqual(result.sources[0], {
    url: 'https://example.com/official',
    title: 'Official & source',
    snippet: 'Primary <result>',
    publishedAt: 'Tue, 01 Sep 2026 00:00:00 GMT'
  })
})

test('public search falls through engines and never invokes paid providers', async () => {
  const { PublicSearchProvider } = await plugin()
  const calls = []
  const provider = new PublicSearchProvider(() => ({
    timeoutMs: 5_000,
    engines: [
      { id: 'empty', url: () => 'https://empty.example/', parse: () => [] },
      { id: 'working', url: () => 'https://working.example/', parse: () => [{ url: 'https://source.example/', title: 'Source' }] }
    ],
    fetchImpl: async url => {
      calls.push(url)
      return response('<html></html>')
    }
  }))
  const result = await provider.search({ query: 'query' })
  assert.deepEqual(calls, ['https://empty.example/', 'https://working.example/'])
  assert.deepEqual(result.sources, [{ url: 'https://source.example/', title: 'Source' }])
})

test('public fetch reroutes known search result pages without probing blocked search hosts', async () => {
  const { DesktopPublicFetchProvider, searchPageRequest } = await plugin()
  assert.equal(searchPageRequest('https://cn.bing.com/search?format=rss&q=DeepSeek%20Harness').query, 'DeepSeek Harness')
  assert.equal(searchPageRequest('https://www.google.com/search?q=DeepSeek%20Harness').query, 'DeepSeek Harness')
  assert.equal(searchPageRequest('https://www.baidu.com/s?wd=DeepSeek%20Harness').query, 'DeepSeek Harness')
  assert.equal(searchPageRequest('https://www.sogou.com/web?query=DeepSeek%20Harness').query, 'DeepSeek Harness')
  assert.equal(searchPageRequest('https://bing.com.evil.example/search?q=blocked'), undefined)

  const searchCalls = []
  const delegateCalls = []
  const delegate = {
    available: () => true,
    async fetch(request) {
      delegateCalls.push(request)
      return { url: request.url, statusCode: 204, body: { kind: 'text', content: '' }, truncated: false }
    }
  }
  const web = {
    fetchProviders: new Map([['http', delegate]]),
    async search(request) {
      searchCalls.push(request)
      return { sources: [{ url: 'https://source.example/', title: 'Primary result', snippet: 'Verified snippet' }], truncated: false }
    }
  }
  const provider = new DesktopPublicFetchProvider(web)
  const searchResult = await provider.fetch({ url: 'https://www.google.com/search?q=DeepSeek%20Harness' })
  assert.deepEqual(searchCalls, [{ query: 'DeepSeek Harness', maxResults: 10 }])
  assert.equal(delegateCalls.length, 0)
  assert.equal(searchResult.statusCode, 200)
  assert.match(searchResult.body.content, /Primary result/u)
  assert.match(searchResult.body.content, /https:\/\/source\.example\//u)

  const delegated = await provider.fetch({ url: 'https://docs.example/page' })
  assert.equal(delegated.statusCode, 204)
  assert.deepEqual(delegateCalls, [{ url: 'https://docs.example/page' }])
})

test('public search plugin selects independent search and fetch providers over upstream defaults', async () => {
  const { apply, PUBLIC_FETCH_PROVIDER_ID, PUBLIC_SEARCH_PROVIDER_ID } = await plugin()
  const searchProviders = new Map([['deepseek-official', { id: 'deepseek-official' }]])
  const fetchProviders = new Map([['http', { id: 'http', available: () => true, fetch() {} }]])
  const web = {
    searchProviderId: 'deepseek-official',
    fetchProviderId: 'http',
    searchProviders,
    fetchProviders,
    registerSearchProvider(provider) { searchProviders.set(provider.id, provider) },
    registerFetchProvider(provider) { fetchProviders.set(provider.id, provider) }
  }
  apply({ web, effect() {} }, {})
  assert.equal(web.searchProviderId, PUBLIC_SEARCH_PROVIDER_ID)
  assert.equal(web.fetchProviderId, PUBLIC_FETCH_PROVIDER_ID)
  assert.ok(searchProviders.has(PUBLIC_SEARCH_PROVIDER_ID))
  assert.ok(fetchProviders.has(PUBLIC_FETCH_PROVIDER_ID))
})

test('desktop public search installs into the Web profile idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-web-search-'))
  try {
    const first = await ensureDesktopWebSearchPlugin({ dshHome: root, bundledRoot })
    const second = await ensureDesktopWebSearchPlugin({ dshHome: root, bundledRoot })
    assert.equal(first.version, '1.0.60')
    assert.equal(first.patchChanged, true)
    assert.equal(second.patchChanged, false)
    const patch = await readFile(path.join(root, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    assert.equal((patch.match(/dsh-desktop-web-search/g) || []).length, 1)
    assert.match(patch, /id: desktop-public-web-search/u)
    assert.match(await readFile(path.join(first.destination, 'lib', 'index.js'), 'utf8'), /PUBLIC_SEARCH_PROVIDER_ID/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
