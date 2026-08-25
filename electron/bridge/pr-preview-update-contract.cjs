const { createPublicKey, verify } = require('node:crypto')
const {
  canonicalJson,
  validateAndVerifyManifest,
  withoutSignature
} = require('./component-update-contract.cjs')

const PR_PREVIEW_SCHEMA_VERSION = 1
const PR_PREVIEW_CHANNEL = 'pr-preview'
const PR_PREVIEW_KEY_ID_PATTERN = /^harness-(?:pr-)?preview-[A-Za-z0-9._-]{2,48}$/
const OFFICIAL_PREVIEW_REPOSITORY = 'baiyuscc13724-max/deepseek-harness-desktop'
const MAX_PREVIEW_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const CLOCK_SKEW_MS = 5 * 60 * 1000
const INDEX_KEYS = new Set([
  'schemaVersion', 'kind', 'repository', 'channel', 'prNumber', 'title', 'author', 'baseRef',
  'headSha', 'sequence', 'publishedAt', 'expiresAt', 'keyId', 'manifestUrls', 'notes', 'signature'
])
const MANIFEST_KEYS = new Set([
  'schemaVersion', 'kind', 'repository', 'channel', 'prNumber', 'title', 'author', 'baseRef',
  'headSha', 'sequence', 'publishedAt', 'expiresAt', 'keyId', 'componentManifest', 'signature'
])

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} 必须是普通 JSON 对象。`)
  }
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 包含未知字段：${key}`)
  }
}

function normalizeHeadSha(value) {
  const sha = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('PR 预览 head SHA 必须是完整 40 位十六进制值。')
  return sha
}

function normalizeSequence(value) {
  const sequence = Number(value)
  if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new Error('PR 预览 sequence 必须是正安全整数。')
  return sequence
}

function normalizePrNumber(value) {
  const prNumber = Number(value)
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error('PR 预览 prNumber 必须是正安全整数。')
  return prNumber
}

function normalizePreviewTitle(value) {
  const title = String(value || '').trim()
  if (!title || Array.from(title).length > 200 || Buffer.byteLength(title, 'utf8') > 512 || /[\u0000-\u001f\u007f]/.test(title)) {
    throw new Error('PR 预览 title 无效或过长。')
  }
  return title
}

function normalizeGithubAuthor(value) {
  const author = String(value || '').trim().toLowerCase()
  if (!/^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(author)) throw new Error('PR 预览 author 不是有效 GitHub login。')
  return author
}

function normalizeBaseRef(value) {
  if (value !== 'main') throw new Error('PR 预览 baseRef 必须是 main。')
  return 'main'
}

function normalizePreviewKeyId(value) {
  const keyId = String(value || '').trim()
  if (!PR_PREVIEW_KEY_ID_PATTERN.test(keyId)) throw new Error('PR 预览必须使用独立的 harness-preview-* 或 harness-pr-preview-* keyId。')
  return keyId
}

function normalizeSignature(value) {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9+/]{80,100}={0,2}$/.test(text) || Buffer.from(text, 'base64').length !== 64) {
    throw new Error('PR 预览签名必须是 Ed25519 64 字节签名。')
  }
  return text
}

function trustedPreviewKey(trustedKeys, keyId) {
  const material = trustedKeys instanceof Map ? trustedKeys.get(keyId) : trustedKeys?.[keyId]
  if (!material) throw new Error(`PR 预览签名密钥不受信任：${keyId}`)
  const key = createPublicKey(material)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`PR 预览签名密钥 ${keyId} 不是 Ed25519 公钥。`)
  return key
}

function verifyPreviewSignature(value, key, label) {
  const signature = Buffer.from(normalizeSignature(value.signature), 'base64')
  const payload = Buffer.from(canonicalJson(withoutSignature(value)), 'utf8')
  if (!verify(null, payload, key, signature)) throw new Error(`${label}签名校验失败。`)
}

function normalizePreviewWindow(input, now) {
  const publishedAt = new Date(input.publishedAt)
  const expiresAt = new Date(input.expiresAt)
  const publishedMs = publishedAt.getTime()
  const expiresMs = expiresAt.getTime()
  if (!Number.isFinite(publishedMs) || publishedMs > now + CLOCK_SKEW_MS) throw new Error('PR 预览发布时间无效。')
  if (!Number.isFinite(expiresMs) || expiresMs <= now) throw new Error('PR 预览已过期。')
  if (expiresMs <= publishedMs || expiresMs - publishedMs > MAX_PREVIEW_LIFETIME_MS) throw new Error('PR 预览有效期无效。')
  return { publishedAt: publishedAt.toISOString(), expiresAt: expiresAt.toISOString() }
}

function officialPreviewAssetIdentity(value, provider, { prNumber, headSha }) {
  const url = new URL(String(value || '').trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new Error('PR 预览组件地址必须是无凭据、无查询、无片段的标准 HTTPS 地址。')
  }
  const prefix = provider === 'cnb'
    ? '/baiyuscc13724-max/deepseek-harness-desktop/-/releases/download/'
    : '/baiyuscc13724-max/deepseek-harness-desktop/releases/download/'
  const expectedHost = provider === 'cnb' ? 'cnb.cool' : 'github.com'
  if (url.hostname !== expectedHost || !url.pathname.startsWith(prefix)) throw new Error('PR 预览组件地址不属于固定官方仓库。')
  const parts = url.pathname.slice(prefix.length).split('/')
  if (parts.length !== 2) throw new Error('PR 预览组件地址路径无效。')
  let tag
  let filename
  try {
    tag = decodeURIComponent(parts[0])
    filename = decodeURIComponent(parts[1])
  } catch {
    throw new Error('PR 预览组件地址编码无效。')
  }
  const expectedTag = new RegExp(`^pr-preview-${prNumber}-${headSha.slice(0, 12)}-run-[1-9]\\d*-[1-9]\\d*$`)
  if (!expectedTag.test(tag)) throw new Error('PR 预览组件地址未绑定 PR/head SHA。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,180}\.zip$/.test(filename)) throw new Error('PR 预览组件资产名无效。')
  return `${tag}/${filename}`
}

function validateOfficialPreviewComponentUrls(manifest, metadata) {
  for (const component of manifest.components) {
    if (!Array.isArray(component.urls) || component.urls.length !== 2) throw new Error(`PR 预览组件 ${component.id} 必须恰好包含 CNB 和 GitHub 两个官方地址。`)
    const cnb = officialPreviewAssetIdentity(component.urls[0], 'cnb', metadata)
    const github = officialPreviewAssetIdentity(component.urls[1], 'github', metadata)
    if (cnb !== github) throw new Error(`PR 预览组件 ${component.id} 的 CNB/GitHub 资产不一致。`)
  }
  return manifest
}

function validateCommon(input, allowedKeys, expectedKind, trustedKeys, now, label) {
  assertPlainObject(input, label)
  assertOnlyKeys(input, allowedKeys, label)
  if (input.schemaVersion !== PR_PREVIEW_SCHEMA_VERSION || input.kind !== expectedKind) throw new Error(`${label}协议版本或类型不受支持。`)
  if (input.repository !== OFFICIAL_PREVIEW_REPOSITORY) throw new Error(`${label}仓库不是固定官方仓库。`)
  if (input.channel !== PR_PREVIEW_CHANNEL) throw new Error(`${label}通道无效。`)
  const keyId = normalizePreviewKeyId(input.keyId)
  const key = trustedPreviewKey(trustedKeys, keyId)
  verifyPreviewSignature(input, key, label)
  const window = normalizePreviewWindow(input, now)
  return {
    schemaVersion: PR_PREVIEW_SCHEMA_VERSION,
    kind: expectedKind,
    repository: OFFICIAL_PREVIEW_REPOSITORY,
    channel: PR_PREVIEW_CHANNEL,
    prNumber: normalizePrNumber(input.prNumber),
    title: normalizePreviewTitle(input.title),
    author: normalizeGithubAuthor(input.author),
    baseRef: normalizeBaseRef(input.baseRef),
    headSha: normalizeHeadSha(input.headSha),
    sequence: normalizeSequence(input.sequence),
    ...window,
    keyId,
    signature: normalizeSignature(input.signature)
  }
}

function validateAndVerifyPreviewIndex(input, trustedKeys, { now = Date.now(), normalizeManifestUrls } = {}) {
  if (typeof normalizeManifestUrls !== 'function') throw new Error('PR 预览清单地址验证器不可用。')
  const common = validateCommon(input, INDEX_KEYS, 'pr-preview-index', trustedKeys, now, 'PR 预览索引')
  const manifestUrls = normalizeManifestUrls(input.manifestUrls, common.headSha)
  const notes = String(input.notes || '')
  if (Buffer.byteLength(notes, 'utf8') > 64 * 1024) throw new Error('PR 预览说明过长。')
  return { ...common, manifestUrls, notes }
}

function validateAndVerifyPreviewManifest(input, trustedKeys, { now = Date.now() } = {}) {
  const common = validateCommon(input, MANIFEST_KEYS, 'pr-preview-manifest', trustedKeys, now, 'PR 预览清单')
  const manifest = validateAndVerifyManifest(input.componentManifest, trustedKeys, { now })
  if (manifest.keyId !== common.keyId) throw new Error('PR 预览清单与组件清单 keyId 不一致。')
  if (manifest.channel !== 'prerelease') throw new Error('PR 预览组件清单必须使用 prerelease 通道。')
  validateOfficialPreviewComponentUrls(manifest, common)
  return { ...common, componentManifest: manifest }
}

function assertIndexMatchesManifest(index, manifest) {
  for (const field of ['repository', 'channel', 'prNumber', 'title', 'author', 'baseRef', 'headSha', 'sequence', 'keyId', 'expiresAt']) {
    if (index?.[field] !== manifest?.[field]) throw new Error(`PR 预览索引与清单的 ${field} 不一致。`)
  }
  if (Date.parse(manifest.publishedAt) < Date.parse(index.publishedAt)) throw new Error('PR 预览清单发布时间早于索引。')
  return true
}

module.exports = {
  CLOCK_SKEW_MS,
  MAX_PREVIEW_LIFETIME_MS,
  OFFICIAL_PREVIEW_REPOSITORY,
  PR_PREVIEW_CHANNEL,
  PR_PREVIEW_KEY_ID_PATTERN,
  PR_PREVIEW_SCHEMA_VERSION,
  assertIndexMatchesManifest,
  normalizeBaseRef,
  normalizeGithubAuthor,
  normalizeHeadSha,
  normalizePrNumber,
  normalizePreviewKeyId,
  normalizePreviewTitle,
  normalizeSequence,
  validateAndVerifyPreviewIndex,
  validateAndVerifyPreviewManifest,
  validateOfficialPreviewComponentUrls
}
