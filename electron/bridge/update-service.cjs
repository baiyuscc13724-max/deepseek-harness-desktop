const http = require('node:http')
const https = require('node:https')

const DEFAULT_UPSTREAM_MANIFEST = 'https://registry.npmmirror.com/@deepseek-ai%2Fdsh/latest'
const DEFAULT_UPSTREAM_MANIFESTS = [
  DEFAULT_UPSTREAM_MANIFEST,
  'https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest',
  'https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/apps/cli/package.json'
]
const DEFAULT_APP_FEED = 'https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/release-manifest.json'
const DEFAULT_APP_FEEDS = [DEFAULT_APP_FEED]

function normalizeUrlList(value, fallback = []) {
  const values = Array.isArray(value) ? value : value ? [value] : fallback
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))]
}

async function fetchFirstJson(urls, fetchJsonImpl, parsePayload = payload => payload) {
  const failures = []
  for (const url of normalizeUrlList(urls)) {
    try {
      return { payload: parsePayload(await fetchJsonImpl(url)), source: url }
    } catch (error) {
      failures.push(`${url}: ${error.message}`)
    }
  }
  throw new Error(failures.length ? `所有更新源均不可用：${failures.join('；')}` : '没有配置可用的更新源。')
}

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '')
}

function versionParts(value) {
  const match = normalizeVersion(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([^+]+))?/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] || '' }
}

function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  if (!left || !right) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre.localeCompare(right.pre, undefined, { numeric: true })
}

function fetchJson(url, { timeoutMs = 6000, maxBytes = 1024 * 1024, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    if (!['https:', 'http:'].includes(target.protocol)) return reject(new Error('更新地址只允许 http/https。'))
    const transport = target.protocol === 'https:' ? https : http
    const request = transport.get(target, { headers: { 'User-Agent': 'Harness-Desktop-Update-Checker', Accept: 'application/json', ...headers } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        try {
          const redirect = new URL(response.headers.location, target).toString()
          resolve(fetchJson(redirect, { timeoutMs, maxBytes, headers }))
        } catch (error) { reject(error) }
        return
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume()
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }
      let size = 0
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        size += Buffer.byteLength(chunk)
        if (size > maxBytes) {
          request.destroy(new Error('更新响应过大。'))
          return
        }
        body += chunk
      })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (error) { reject(new Error(`更新响应不是有效 JSON：${error.message}`)) }
      })
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`更新检查超时（${timeoutMs}ms）`)))
    request.on('error', reject)
  })
}

async function checkHarnessUpstream({ currentVersion, manifestUrl, manifestUrls, fetchJsonImpl = fetchJson } = {}) {
  const configuredSources = manifestUrls !== undefined ? manifestUrls : manifestUrl !== undefined ? manifestUrl : DEFAULT_UPSTREAM_MANIFESTS
  const sources = normalizeUrlList(configuredSources)
  const { payload: latestVersion, source } = await fetchFirstJson(sources, fetchJsonImpl, manifest => {
    const version = normalizeVersion(manifest?.version)
    if (!version) throw new Error('官方 Harness manifest 没有有效 version。')
    return version
  })
  const comparison = compareVersions(latestVersion, currentVersion)
  return {
    kind: 'harness',
    currentVersion: normalizeVersion(currentVersion),
    latestVersion,
    updateAvailable: comparison > 0,
    aheadOfUpstream: comparison < 0,
    actionable: false,
    updatePolicy: 'desktop-bundled',
    source,
    releaseUrl: 'https://github.com/deepseek-ai/deepseek-harness/releases',
    checkedAt: new Date().toISOString()
  }
}

function parseReleasePayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('应用更新源返回空数据。')
  const version = normalizeVersion(payload.version || payload.tag_name || payload.name)
  if (!version) throw new Error('应用更新源缺少 version/tag_name。')
  const url = payload.html_url || payload.releaseUrl || payload.url || ''
  const assets = Array.isArray(payload.assets)
    ? payload.assets.map(asset => {
        const urls = normalizeUrlList([
          ...(Array.isArray(asset?.mirror_urls) ? asset.mirror_urls : []),
          ...(Array.isArray(asset?.urls) ? asset.urls : []),
          asset?.browser_download_url,
          asset?.url
        ])
        return {
          name: String(asset?.name || ''),
          url: urls[0] || '',
          urls,
          size: Number(asset?.size || 0)
        }
      }).filter(asset => asset.name && asset.url)
    : []
  return { version, url, notes: payload.notes || payload.body || '', assets }
}

function selectWindowsInstallerAsset(assets = []) {
  return assets.find(asset => /^Harness[ ._-]Desktop-.+-win-x64\.exe$/i.test(asset.name)) || null
}

function selectChecksumAsset(assets = []) {
  return assets.find(asset => /^SHA256SUMS\.txt$/i.test(asset.name)) || null
}

function parseChecksumFile(text, fileName) {
  const line = String(text || '').split(/\r?\n/).find(value => value.trim().endsWith(fileName))
  const match = line?.match(/^([a-f0-9]{64})\s+\*?(.+)$/i)
  if (!match || match[2].trim() !== fileName) throw new Error('发布页缺少安装包的 SHA-256 校验值。')
  return match[1].toLowerCase()
}

function selectReleasePayload(payload, channel = 'stable') {
  if (!Array.isArray(payload)) return payload
  const candidates = payload
    .filter(release => release && release.draft !== true && (channel === 'prerelease' || release.prerelease !== true))
    .sort((left, right) => compareVersions(right.tag_name || right.name, left.tag_name || left.name))
  if (!candidates.length) throw new Error('更新源没有可用的发布版本。')
  return candidates[0]
}

async function checkAppUpdate({ currentVersion, feedUrl, feedUrls, channel = 'stable', fetchJsonImpl = fetchJson } = {}) {
  const configuredSources = feedUrls !== undefined ? feedUrls : feedUrl !== undefined ? feedUrl : DEFAULT_APP_FEEDS
  const sources = normalizeUrlList(configuredSources)
  if (!sources.length) return { kind: 'app', configured: false, currentVersion: normalizeVersion(currentVersion), updateAvailable: false }
  const { payload: release, source } = await fetchFirstJson(sources, fetchJsonImpl, payload => parseReleasePayload(selectReleasePayload(payload, channel)))
  const installer = selectWindowsInstallerAsset(release.assets)
  const checksums = selectChecksumAsset(release.assets)
  return {
    kind: 'app',
    configured: true,
    currentVersion: normalizeVersion(currentVersion),
    latestVersion: release.version,
    updateAvailable: compareVersions(release.version, currentVersion) > 0,
    url: release.url,
    notes: release.notes,
    installer,
    checksums,
    source,
    sources,
    channel,
    checkedAt: new Date().toISOString()
  }
}

module.exports = {
  DEFAULT_APP_FEED,
  DEFAULT_APP_FEEDS,
  DEFAULT_UPSTREAM_MANIFEST,
  DEFAULT_UPSTREAM_MANIFESTS,
  checkAppUpdate,
  checkHarnessUpstream,
  compareVersions,
  fetchJson,
  normalizeVersion,
  normalizeUrlList,
  parseReleasePayload,
  parseChecksumFile,
  selectReleasePayload,
  selectWindowsInstallerAsset,
  selectChecksumAsset,
  versionParts
}
