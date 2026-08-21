const { createHash } = require('node:crypto')
const { open, unlink } = require('node:fs/promises')
const { DEFAULT_MAX_REDIRECTS, resolveUpdateRedirect, safeHttpsUpdateUrl } = require('./update-service.cjs')

const DEFAULT_MAX_BYTES = 600 * 1024 * 1024
const DEFAULT_IDLE_TIMEOUT_MS = 20 * 1000
const DEFAULT_CHECKSUM_TIMEOUT_MS = 10 * 1000

function assetUrls(asset) {
  const values = Array.isArray(asset?.urls) ? asset.urls : [asset?.url || asset]
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

function safeHttpsUrl(value) {
  return safeHttpsUpdateUrl(value).toString()
}

function assetHosts(values) {
  const hosts = []
  for (const value of values) {
    try { hosts.push(safeHttpsUpdateUrl(value).hostname.toLowerCase()) } catch {}
  }
  return [...new Set(hosts)]
}

async function fetchWithSafeRedirects(url, { fetchImpl, signal, headers, maxRedirects = DEFAULT_MAX_REDIRECTS, allowedHosts = [] }) {
  let current = safeHttpsUrl(url)
  for (let redirectCount = 0; ; redirectCount += 1) {
    const response = await fetchImpl(current, { redirect: 'manual', signal, headers })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers?.get?.('location')
    if (!location) return response
    current = resolveUpdateRedirect(current, location, { redirectCount, maxRedirects, allowedHosts })
  }
}

function sourceLabel(value) {
  try { return new URL(value).hostname }
  catch { return '无效地址' }
}

function resetIdleTimer(state, timeoutMs, controller) {
  clearTimeout(state.timer)
  state.timer = setTimeout(() => controller.abort(), timeoutMs)
}

function rejectedInstallerType(response) {
  const value = String(response.headers?.get?.('content-type') || '').toLowerCase()
  return value.includes('text/html') || value.includes('application/json') || value.includes('text/xml')
}

async function downloadFromUrl({
  url,
  destination,
  expectedSize = 0,
  fetchImpl,
  openImpl = open,
  onProgress,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  allowedHosts = [],
  userAgent = 'Harness-Desktop'
}) {
  const controller = new AbortController()
  const idle = { timer: null }
  resetIdleTimer(idle, idleTimeoutMs, controller)
  let response
  try {
    response = await fetchWithSafeRedirects(url, {
      fetchImpl,
      signal: controller.signal,
      maxRedirects,
      allowedHosts,
      headers: { 'User-Agent': userAgent, Accept: 'application/octet-stream' }
    })
    resetIdleTimer(idle, idleTimeoutMs, controller)
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    if (rejectedInstallerType(response)) throw new Error('镜像返回了网页或接口数据，不是安装包直链')
    const advertised = Number(response.headers?.get?.('content-length') || expectedSize || 0)
    if (advertised > maxBytes) throw new Error('文件超过安全大小限制')

    const file = await openImpl(destination, 'w', 0o600)
    const hash = createHash('sha256')
    let received = 0
    try {
      for await (const value of response.body) {
        resetIdleTimer(idle, idleTimeoutMs, controller)
        const chunk = Buffer.from(value)
        received += chunk.length
        if (received > maxBytes) throw new Error('文件超过安全大小限制')
        await file.write(chunk)
        hash.update(chunk)
        onProgress?.({ received, total: advertised || 0 })
      }
    } finally {
      await file.close()
    }
    if (expectedSize && received !== expectedSize) throw new Error('文件大小校验失败')
    return { size: received, sha256: hash.digest('hex') }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`连续 ${Math.ceil(idleTimeoutMs / 1000)} 秒无下载数据`)
    throw error
  } finally {
    clearTimeout(idle.timer)
  }
}

async function downloadWithFallback({
  asset,
  destination,
  expectedSize = 0,
  expectedHash = '',
  fetchImpl,
  openImpl = open,
  unlinkImpl = unlink,
  onProgress,
  idleTimeoutMs,
  maxBytes,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  userAgent
}) {
  const urls = assetUrls(asset)
  const allowedHosts = assetHosts(urls)
  const failures = []
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index]
    try {
      onProgress?.({ phase: 'source', source: sourceLabel(url), attempt: index + 1, totalSources: urls.length, received: 0, total: expectedSize || 0 })
      const downloaded = await downloadFromUrl({ url, destination, expectedSize, fetchImpl, openImpl, onProgress, idleTimeoutMs, maxBytes, maxRedirects, allowedHosts, userAgent })
      if (expectedHash && downloaded.sha256 !== expectedHash) throw new Error('SHA-256 校验失败')
      return { ...downloaded, source: url, attempt: index + 1 }
    } catch (error) {
      failures.push(`${sourceLabel(url)}: ${error.message}`)
      await unlinkImpl(destination).catch(() => {})
    }
  }
  throw new Error(`所有安装包下载源均不可用：${failures.join('；')}`)
}

async function checksumFromUrl({ url, fileName, fetchImpl, parseChecksum, timeoutMs = DEFAULT_CHECKSUM_TIMEOUT_MS, maxRedirects = DEFAULT_MAX_REDIRECTS, allowedHosts = [], userAgent = 'Harness-Desktop' }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchWithSafeRedirects(url, {
      fetchImpl,
      signal: controller.signal,
      maxRedirects,
      allowedHosts,
      headers: { 'User-Agent': userAgent, Accept: 'text/plain' }
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const type = String(response.headers?.get?.('content-type') || '').toLowerCase()
    if (type.includes('text/html')) throw new Error('镜像返回了网页，不是校验文件直链')
    const text = await response.text()
    if (text.length > 2 * 1024 * 1024) throw new Error('校验文件过大')
    return parseChecksum(text, fileName)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`校验文件请求超时（${timeoutMs}ms）`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function checksumWithFallback({ asset, fileName, fetchImpl, parseChecksum, timeoutMs, maxRedirects = DEFAULT_MAX_REDIRECTS, userAgent }) {
  const urls = assetUrls(asset)
  const allowedHosts = assetHosts(urls)
  const failures = []
  for (const url of urls) {
    try {
      const hash = await checksumFromUrl({ url, fileName, fetchImpl, parseChecksum, timeoutMs, maxRedirects, allowedHosts, userAgent })
      if (!/^[a-f0-9]{64}$/i.test(String(hash || ''))) throw new Error('校验文件中没有匹配安装包的 SHA-256')
      return { hash, source: url }
    } catch (error) {
      failures.push(`${sourceLabel(url)}: ${error.message}`)
    }
  }
  throw new Error(`所有更新校验源均不可用：${failures.join('；')}`)
}

module.exports = {
  DEFAULT_CHECKSUM_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  assetHosts,
  assetUrls,
  checksumFromUrl,
  checksumWithFallback,
  downloadFromUrl,
  downloadWithFallback,
  fetchWithSafeRedirects,
  rejectedInstallerType,
  safeHttpsUrl,
  sourceLabel
}
