const { createPublicKey } = require('node:crypto')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const {
  OFFICIAL_PREVIEW_REPOSITORY,
  normalizePreviewKeyId
} = require('./pr-preview-update-contract.cjs')

const OFFICIAL_PREVIEW_INDEX_URLS = Object.freeze([
  'https://cnb.cool/baiyuscc13724-max/deepseek-harness-desktop/-/git/raw/main/component-feeds/pr-preview/latest.json',
  'https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/component-feeds/pr-preview/latest.json'
])
const OFFICIAL_PREVIEW_HOSTS = Object.freeze(['cnb.cool', 'raw.githubusercontent.com'])
const CNB_PREFIX = '/baiyuscc13724-max/deepseek-harness-desktop/-/git/raw/main/component-feeds/pr-preview/'
const GITHUB_PREFIX = '/baiyuscc13724-max/deepseek-harness-desktop/main/component-feeds/pr-preview/'

function officialPreviewProvider(url) {
  if (url.hostname === 'cnb.cool') return 'cnb'
  if (url.hostname === 'raw.githubusercontent.com') return 'github'
  return ''
}

function safeOfficialPreviewUrl(value, { kind = 'manifest', headSha = '' } = {}) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443')) {
    throw new Error('PR 预览地址必须是无凭据、无查询、无片段的标准 HTTPS 地址。')
  }
  const provider = officialPreviewProvider(url)
  if (!provider) throw new Error(`PR 预览地址主机不受信任：${url.hostname}`)
  const expectedPath = kind === 'index'
    ? (provider === 'cnb' ? `${CNB_PREFIX}latest.json` : `${GITHUB_PREFIX}latest.json`)
    : (provider === 'cnb' ? `${CNB_PREFIX}manifests/${headSha}.json` : `${GITHUB_PREFIX}manifests/${headSha}.json`)
  if (url.pathname !== expectedPath) throw new Error('PR 预览地址不属于固定官方仓库路径。')
  return url.toString()
}

function normalizeOfficialIndexUrls(values = OFFICIAL_PREVIEW_INDEX_URLS) {
  if (!Array.isArray(values) || values.length !== 2) throw new Error('PR 预览索引必须包含 CNB 和 GitHub 两个固定来源。')
  const urls = values.map(value => safeOfficialPreviewUrl(value, { kind: 'index' }))
  if (urls[0] !== OFFICIAL_PREVIEW_INDEX_URLS[0] || urls[1] !== OFFICIAL_PREVIEW_INDEX_URLS[1]) {
    throw new Error('PR 预览索引来源必须保持 CNB 优先、GitHub 后备。')
  }
  return urls
}

function normalizeOfficialManifestUrls(values, headSha) {
  if (!Array.isArray(values) || values.length !== 2) throw new Error('PR 预览清单必须包含 CNB 和 GitHub 两个固定来源。')
  const urls = values.map(value => safeOfficialPreviewUrl(value, { kind: 'manifest', headSha }))
  if (officialPreviewProvider(new URL(urls[0])) !== 'cnb' || officialPreviewProvider(new URL(urls[1])) !== 'github') {
    throw new Error('PR 预览清单来源必须保持 CNB 优先、GitHub 后备。')
  }
  return urls
}

function normalizeTrustedPreviewKeys(input) {
  let entries = []
  if (input.trustedKeys && typeof input.trustedKeys === 'object' && !Array.isArray(input.trustedKeys)) {
    entries = Object.entries(input.trustedKeys)
  } else if (input.keyId !== undefined || input.publicKey !== undefined) {
    entries = [[input.keyId, input.publicKey]]
  }
  const trustedKeys = {}
  for (const [rawKeyId, material] of entries) {
    const keyId = normalizePreviewKeyId(rawKeyId)
    const publicKey = String(material || '').trim()
    if (!publicKey.startsWith('-----BEGIN PUBLIC KEY-----') || !publicKey.endsWith('-----END PUBLIC KEY-----')) {
      throw new Error(`PR 预览公钥格式无效：${keyId}`)
    }
    const key = createPublicKey(publicKey)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error(`PR 预览公钥必须是 Ed25519 公钥：${keyId}`)
    trustedKeys[keyId] = `${publicKey}\n`
  }
  return trustedKeys
}

function normalizePrPreviewUpdateConfig(input) {
  const payload = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const allowed = new Set(['enabled', 'repository', 'channelUrls', 'indexUrls', 'trustedKeys', 'keyId', 'publicKey'])
  for (const key of Object.keys(payload)) if (!allowed.has(key)) throw new Error(`PR 预览配置包含未知字段：${key}`)
  if (payload.repository !== undefined && payload.repository !== OFFICIAL_PREVIEW_REPOSITORY) {
    throw new Error('PR 预览配置仓库不是固定官方仓库。')
  }
  const channelUrls = normalizeOfficialIndexUrls(payload.channelUrls ?? payload.indexUrls ?? OFFICIAL_PREVIEW_INDEX_URLS)
  const trustedKeys = normalizeTrustedPreviewKeys(payload)
  const enabled = payload.enabled === true
  if (enabled && Object.keys(trustedKeys).length === 0) throw new Error('启用 PR 预览更新前必须配置独立公钥。')
  return {
    enabled,
    repository: OFFICIAL_PREVIEW_REPOSITORY,
    channelUrls: [...channelUrls],
    indexUrls: [...channelUrls],
    trustedKeys
  }
}

const PREVIEW_SOURCES_FILENAME = 'pr-preview-update-sources.json'

function previewConfigCandidateFiles({ resourcesPath, shellRoot, appRoot, packagedAppRoot } = {}) {
  const candidates = [
    resourcesPath && path.join(resourcesPath, PREVIEW_SOURCES_FILENAME),
    shellRoot && path.join(shellRoot, PREVIEW_SOURCES_FILENAME),
    appRoot && path.join(appRoot, PREVIEW_SOURCES_FILENAME),
    packagedAppRoot && path.join(packagedAppRoot, PREVIEW_SOURCES_FILENAME)
  ].filter(Boolean)
  return [...new Set(candidates.map(value => path.resolve(value)))]
}

async function readPreviewConfigIfPresent(file, readFileImpl = readFile) {
  let text
  try {
    text = await readFileImpl(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`无法读取 PR 预览更新配置 ${file}：${error.message}`)
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch (error) {
    throw new Error(`无法读取 PR 预览更新配置 ${file}：${error.message}`)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`PR 预览更新配置 ${file} 不是有效 JSON 对象。`)
  }
  return payload
}

async function resolvePrPreviewUpdateConfig({ appRoot, packagedAppRoot, resourcesPath, shellRoot, readFileImpl = readFile } = {}) {
  for (const file of previewConfigCandidateFiles({ resourcesPath, shellRoot, appRoot, packagedAppRoot })) {
    const payload = await readPreviewConfigIfPresent(file, readFileImpl)
    if (payload === null) continue
    return { ...normalizePrPreviewUpdateConfig(payload), source: file }
  }
  return { ...normalizePrPreviewUpdateConfig(), source: '' }
}

module.exports = {
  OFFICIAL_PREVIEW_HOSTS,
  OFFICIAL_PREVIEW_INDEX_URLS,
  PREVIEW_SOURCES_FILENAME,
  normalizeOfficialIndexUrls,
  normalizeOfficialManifestUrls,
  normalizePrPreviewUpdateConfig,
  officialPreviewProvider,
  previewConfigCandidateFiles,
  readPreviewConfigIfPresent,
  resolvePrPreviewUpdateConfig,
  safeOfficialPreviewUrl
}
