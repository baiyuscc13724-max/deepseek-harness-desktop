const https = require('node:https')
const { validateAndVerifyDesktopReleaseManifest } = require('./desktop-release-contract.cjs')

const DEFAULT_MAX_REDIRECTS = 5
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

function safeHttpsUpdateUrl(value, label = '更新地址') {
  const target = new URL(String(value || '').trim())
  if (target.protocol !== 'https:') throw new Error(`${label}必须使用 HTTPS。`)
  if (target.username || target.password || target.hash) throw new Error(`${label}不得包含凭据或片段。`)
  if (target.port && target.port !== '443') throw new Error(`${label}不得使用非标准 HTTPS 端口。`)
  return target
}

function hostFamily(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (host === 'github.com' || host.endsWith('.github.com') || host === 'githubusercontent.com' || host.endsWith('.githubusercontent.com') || host === 'githubassets.com' || host.endsWith('.githubassets.com')) return 'github'
  if (host === 'cnb.cool' || host.endsWith('.cnb.cool')) return 'cnb'
  return ''
}

function isAllowedUpdateRedirect(fromUrl, toUrl, allowedHosts = []) {
  const from = safeHttpsUpdateUrl(fromUrl)
  const to = safeHttpsUpdateUrl(toUrl)
  const fromHost = from.hostname.toLowerCase()
  const toHost = to.hostname.toLowerCase()
  if (fromHost === toHost || toHost.endsWith(`.${fromHost}`) || fromHost.endsWith(`.${toHost}`)) return true
  const family = hostFamily(fromHost)
  if (family && family === hostFamily(toHost)) return true
  return new Set([...allowedHosts].map(value => String(value || '').toLowerCase())).has(toHost)
}

function resolveUpdateRedirect(fromUrl, location, { redirectCount = 0, maxRedirects = DEFAULT_MAX_REDIRECTS, allowedHosts = [] } = {}) {
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || redirectCount >= maxRedirects) throw new Error(`更新请求重定向超过 ${maxRedirects} 次。`)
  const from = safeHttpsUpdateUrl(fromUrl)
  const target = safeHttpsUpdateUrl(new URL(String(location || ''), from).toString())
  if (!isAllowedUpdateRedirect(from, target, allowedHosts)) throw new Error(`更新请求拒绝跨来源重定向：${from.hostname} → ${target.hostname}`)
  return target.toString()
}

async function fetchFirstJson(urls, fetchJsonImpl, parsePayload = payload => payload) {
  const failures = []
  for (const value of normalizeUrlList(urls)) {
    let url
    try { url = safeHttpsUpdateUrl(value, '更新清单地址').toString() }
    catch (error) {
      failures.push(`${value}: ${error.message}`)
      continue
    }
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

// Split a version into core + optional prerelease, dropping build metadata.
// Per semver, build metadata ("+...") never affects precedence: 1.0.28 === 1.0.28+build.5.
// Returns null for anything that is not a parseable core version.
function versionParts(value) {
  const normalized = normalizeVersion(value)
  // Strip build metadata first so it cannot be mistaken for a prerelease.
  const withoutBuild = normalized.split('+')[0]
  const match = withoutBuild.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  if (!match) return null
  const pre = match[4] || ''
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre }
}

// Split a prerelease string into typed identifiers. Numeric identifiers sort
// numerically below non-numeric ones; identifiers are compared left to right.
function preIdentifiers(pre) {
  if (!pre) return []
  return pre.split('.').map(segment => {
    if (/^\d+$/.test(segment)) return { numeric: true, value: Number(segment), raw: segment }
    return { numeric: false, value: 0, raw: segment }
  })
}

// Compare two sequences of prerelease identifiers per semver rules.
function comparePre(left, right) {
  const count = Math.max(left.length, right.length)
  for (let index = 0; index < count; index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined && b === undefined) return 0
    if (a === undefined) return -1 // a has fewer identifiers
    if (b === undefined) return 1
    if (a.numeric && b.numeric) {
      if (a.value !== b.value) return a.value > b.value ? 1 : -1
    } else if (a.numeric !== b.numeric) {
      return a.numeric ? -1 : 1 // numeric identifiers sort below non-numeric
    } else if (a.raw !== b.raw) {
      return a.raw > b.raw ? 1 : -1
    }
  }
  return 0
}

function compareVersions(a, b) {
  const left = versionParts(a)
  const right = versionParts(b)
  if (!left || !right) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  // A release (no prerelease) always outranks the same core with a prerelease.
  if (!left.pre && !right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return comparePre(preIdentifiers(left.pre), preIdentifiers(right.pre))
}

function fetchJson(url, { timeoutMs = 6000, maxBytes = 1024 * 1024, headers = {}, maxRedirects = DEFAULT_MAX_REDIRECTS, redirectCount = 0, allowedHosts = [] } = {}) {
  return new Promise((resolve, reject) => {
    let target
    try { target = safeHttpsUpdateUrl(url) } catch (error) { reject(error); return }
    const request = https.get(target, { headers: { 'User-Agent': 'Harness-Desktop-Update-Checker', Accept: 'application/json', ...headers } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        try {
          const redirect = resolveUpdateRedirect(target, response.headers.location, { redirectCount, maxRedirects, allowedHosts })
          resolve(fetchJson(redirect, { timeoutMs, maxBytes, headers, maxRedirects, redirectCount: redirectCount + 1, allowedHosts }))
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
  // Reject a stale/无效 feed whose advertised version is not valid semver.
  // Without this, a garbage `latestVersion` could never be relied upon to
  // suppress an update prompt, and an equal-but-build-annotated version would
  // be mistakenly treated as newer.
  if (!versionParts(version)) throw new Error(`应用更新源版本无效：${version}`)
  const url = payload.html_url || payload.releaseUrl || payload.url || ''
  const assets = Array.isArray(payload.assets)
    ? payload.assets.map(asset => {
        const urls = normalizeUrlList([
          ...(Array.isArray(asset?.mirror_urls) ? asset.mirror_urls : []),
          ...(Array.isArray(asset?.urls) ? asset.urls : []),
          asset?.browser_download_url,
          asset?.url
        ]).map(value => safeHttpsUpdateUrl(value, `更新资产 ${asset?.name || ''} 地址`).toString())
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

function selectDesktopInstallerAsset(assets = [], platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return assets.find(asset => /^Harness[ ._-]Desktop-.+-win-x64\.exe$/i.test(asset.name)) || null
  if (platform === 'darwin') {
    const targetArch = arch === 'arm64' ? 'arm64' : 'x64'
    return assets.find(asset => new RegExp(`^Harness[ ._-]Desktop-.+-mac-${targetArch}\\.(?:dmg|zip)$`, 'i').test(asset.name)) || null
  }
  return null
}

function selectWindowsInstallerAsset(assets = []) {
  return selectDesktopInstallerAsset(assets, 'win32', 'x64')
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

async function checkAppUpdate({ currentVersion, feedUrl, feedUrls, trustedKeys = {}, channel = 'stable', platform = process.platform, arch = process.arch, fetchJsonImpl = fetchJson } = {}) {
  const configuredSources = feedUrls !== undefined ? feedUrls : feedUrl !== undefined ? feedUrl : DEFAULT_APP_FEEDS
  const sources = normalizeUrlList(configuredSources)
  if (!sources.length) return { kind: 'app', configured: false, currentVersion: normalizeVersion(currentVersion), updateAvailable: false }
  const { payload: release, source } = await fetchFirstJson(sources, fetchJsonImpl, payload => {
    const verified = validateAndVerifyDesktopReleaseManifest(payload, trustedKeys)
    return parseReleasePayload(selectReleasePayload(verified, channel))
  })
  const installer = selectDesktopInstallerAsset(release.assets, platform, arch)
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
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_UPSTREAM_MANIFEST,
  DEFAULT_UPSTREAM_MANIFESTS,
  checkAppUpdate,
  checkHarnessUpstream,
  compareVersions,
  fetchJson,
  isAllowedUpdateRedirect,
  normalizeVersion,
  normalizeUrlList,
  parseReleasePayload,
  resolveUpdateRedirect,
  safeHttpsUpdateUrl,
  parseChecksumFile,
  selectReleasePayload,
  selectDesktopInstallerAsset,
  selectWindowsInstallerAsset,
  selectChecksumAsset,
  versionParts
}
