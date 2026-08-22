const { createPublicKey, verify } = require('node:crypto')

const COMPONENT_MANIFEST_SCHEMA_VERSION = 1
const COMPONENT_STATE_SCHEMA_VERSION = 1
const MAX_COMPONENT_BYTES = 512 * 1024 * 1024
const MAX_COMPONENT_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024
const MAX_RELEASE_BYTES = 800 * 1024 * 1024
const ALLOWED_COMPONENT_KINDS = new Set(['zip'])
const ALLOWED_COMPONENT_TARGETS = new Set(['shell', 'harness-runtime', 'plugins'])
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  'schemaVersion', 'releaseVersion', 'channel', 'publishedAt', 'keyId',
  'bootstrap', 'components', 'fallback', 'notes', 'signature'
])
const ALLOWED_COMPONENT_KEYS = new Set([
  'id', 'version', 'kind', 'target', 'platform', 'arch', 'size', 'unpackedSize', 'sha256',
  'urls', 'required', 'restart', 'signature'
])
const ALLOWED_BOOTSTRAP_KEYS = new Set(['minVersion', 'maxVersion'])
const ALLOWED_FALLBACK_KEYS = new Set(['version', 'size', 'sha256', 'urls'])

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

function normalizeVersion(value, label = '版本') {
  const text = String(value || '').trim().replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(text)) throw new Error(`${label}无效。`)
  return text
}

function versionParts(value) {
  const normalized = normalizeVersion(value)
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/)
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] || '' }
}

function compareVersions(leftValue, rightValue) {
  const left = versionParts(leftValue)
  const right = versionParts(rightValue)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1
  }
  if (left.pre === right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  return left.pre.localeCompare(right.pre, 'en', { numeric: true })
}

function normalizeHash(value, label = 'SHA-256') {
  const text = String(value || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(text)) throw new Error(`${label}无效。`)
  return text
}

function normalizeSignature(value, label = '签名') {
  const text = String(value || '').trim()
  if (!/^[A-Za-z0-9+/]{80,100}={0,2}$/.test(text)) throw new Error(`${label}无效。`)
  const bytes = Buffer.from(text, 'base64')
  if (bytes.length !== 64) throw new Error(`${label}必须是 Ed25519 64 字节签名。`)
  return text
}

function normalizeHttpsUrls(values, label = '下载地址') {
  if (!Array.isArray(values) || values.length === 0 || values.length > 8) throw new Error(`${label}不能为空或过多。`)
  const urls = []
  for (const raw of values) {
    const url = new URL(String(raw || '').trim())
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${label}必须是无凭据、无片段的 HTTPS 地址。`)
    urls.push(url.toString())
  }
  return [...new Set(urls)]
}

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('签名数据包含非有限数字。')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  assertPlainObject(value, '签名数据')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function withoutSignature(value) {
  const { signature: _signature, ...unsigned } = value
  return unsigned
}

function trustedEd25519Key(trustedKeys, keyId) {
  const material = trustedKeys instanceof Map ? trustedKeys.get(keyId) : trustedKeys?.[keyId]
  if (!material) throw new Error(`更新签名密钥不受信任：${keyId}`)
  const key = createPublicKey(material)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`更新签名密钥 ${keyId} 不是 Ed25519 公钥。`)
  return key
}

function verifySignedObject(value, key, label) {
  const signature = Buffer.from(normalizeSignature(value.signature, `${label}签名`), 'base64')
  const payload = Buffer.from(canonicalJson(withoutSignature(value)), 'utf8')
  if (!verify(null, payload, key, signature)) throw new Error(`${label}签名校验失败。`)
}

function normalizeComponent(input) {
  assertPlainObject(input, '组件')
  assertOnlyKeys(input, ALLOWED_COMPONENT_KEYS, `组件 ${input.id || ''}`.trim())
  const id = String(input.id || '').trim()
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw new Error('组件 ID 无效。')
  const kind = String(input.kind || '').trim()
  if (!ALLOWED_COMPONENT_KINDS.has(kind)) throw new Error(`组件 ${id} 的归档类型不受支持。`)
  const target = String(input.target || '').trim()
  if (!ALLOWED_COMPONENT_TARGETS.has(target)) throw new Error(`组件 ${id} 的安装目标不受支持。`)
  const size = Number(input.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_COMPONENT_BYTES) throw new Error(`组件 ${id} 的文件大小无效。`)
  const unpackedSize = Number(input.unpackedSize)
  if (!Number.isSafeInteger(unpackedSize) || unpackedSize <= 0 || unpackedSize > MAX_COMPONENT_UNPACKED_BYTES) throw new Error(`组件 ${id} 的解压大小无效。`)
  const platform = String(input.platform || '').trim()
  const arch = String(input.arch || '').trim()
  if (platform && !/^[a-z0-9-]{2,20}$/.test(platform)) throw new Error(`组件 ${id} 的平台无效。`)
  if (arch && !/^[a-z0-9-]{2,20}$/.test(arch)) throw new Error(`组件 ${id} 的架构无效。`)
  return {
    id,
    version: normalizeVersion(input.version, `组件 ${id} 版本`),
    kind,
    target,
    ...(platform ? { platform } : {}),
    ...(arch ? { arch } : {}),
    size,
    unpackedSize,
    sha256: normalizeHash(input.sha256, `组件 ${id} SHA-256`),
    urls: normalizeHttpsUrls(input.urls, `组件 ${id} 下载地址`),
    required: input.required !== false,
    restart: input.restart !== false,
    signature: normalizeSignature(input.signature, `组件 ${id} 签名`)
  }
}

function normalizeFallback(input) {
  if (input === undefined) return null
  assertPlainObject(input, '完整安装包兜底')
  assertOnlyKeys(input, ALLOWED_FALLBACK_KEYS, '完整安装包兜底')
  const size = Number(input.size)
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_COMPONENT_BYTES) throw new Error('完整安装包大小无效。')
  return {
    version: normalizeVersion(input.version, '完整安装包版本'),
    size,
    sha256: normalizeHash(input.sha256, '完整安装包 SHA-256'),
    urls: normalizeHttpsUrls(input.urls, '完整安装包下载地址')
  }
}

function validateAndVerifyManifest(input, trustedKeys, { now = Date.now() } = {}) {
  assertPlainObject(input, '组件更新清单')
  assertOnlyKeys(input, ALLOWED_TOP_LEVEL_KEYS, '组件更新清单')
  if (input.schemaVersion !== COMPONENT_MANIFEST_SCHEMA_VERSION) throw new Error('组件更新清单协议版本不受支持。')
  const keyId = String(input.keyId || '').trim()
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId)) throw new Error('组件更新清单 keyId 无效。')
  const key = trustedEd25519Key(trustedKeys, keyId)
  verifySignedObject(input, key, '组件更新清单')

  assertPlainObject(input.bootstrap, 'Bootstrap 兼容范围')
  assertOnlyKeys(input.bootstrap, ALLOWED_BOOTSTRAP_KEYS, 'Bootstrap 兼容范围')
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.length > 16) throw new Error('组件更新清单必须包含 1-16 个组件。')
  const components = input.components.map(component => {
    verifySignedObject(component, key, `组件 ${component?.id || ''}`.trim())
    return normalizeComponent(component)
  })
  if (new Set(components.map(component => component.id)).size !== components.length) throw new Error('组件更新清单包含重复组件 ID。')
  if (components.reduce((sum, component) => sum + component.size, 0) > MAX_RELEASE_BYTES) throw new Error('组件更新总大小超过安全限制。')

  const publishedAt = new Date(input.publishedAt)
  if (Number.isNaN(publishedAt.getTime()) || publishedAt.getTime() > now + 5 * 60 * 1000) throw new Error('组件更新清单发布时间无效。')
  const channel = String(input.channel || '').trim()
  if (!['stable', 'prerelease'].includes(channel)) throw new Error('组件更新通道无效。')
  return {
    schemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    releaseVersion: normalizeVersion(input.releaseVersion, '发布版本'),
    channel,
    publishedAt: publishedAt.toISOString(),
    keyId,
    bootstrap: {
      minVersion: normalizeVersion(input.bootstrap.minVersion, '最低 Bootstrap 版本'),
      ...(input.bootstrap.maxVersion ? { maxVersion: normalizeVersion(input.bootstrap.maxVersion, '最高 Bootstrap 版本') } : {})
    },
    components,
    fallback: normalizeFallback(input.fallback),
    notes: String(input.notes || '').slice(0, 64 * 1024),
    signature: normalizeSignature(input.signature, '组件更新清单签名')
  }
}

function componentApplies(component, platform, arch) {
  return (!component.platform || component.platform === platform) && (!component.arch || component.arch === arch)
}

function createComponentUpdatePlan({ manifest, current = {}, bootstrapVersion, platform = process.platform, arch = process.arch }) {
  const bootstrap = normalizeVersion(bootstrapVersion, '当前 Bootstrap 版本')
  const releaseVersion = normalizeVersion(manifest.releaseVersion, '组件发布版本')

  // A full desktop installation already contains the components shipped for its
  // own release. The user-data pointer can be absent on a fresh install or still
  // describe an older incremental activation after an installer upgrade, so it
  // must not make the current (or an older) release appear as a new component
  // update. Only a strictly newer component release is actionable.
  if (compareVersions(releaseVersion, bootstrap) <= 0) {
    const desiredComponents = Object.entries(current).map(([id, component]) => ({ id, ...component }))
    return { mode: 'none', reason: 'release-not-newer', releaseVersion, components: [], desiredComponents }
  }

  const incompatible = compareVersions(bootstrap, manifest.bootstrap.minVersion) < 0
    || (manifest.bootstrap.maxVersion && compareVersions(bootstrap, manifest.bootstrap.maxVersion) > 0)
  if (incompatible) {
    if (!manifest.fallback) throw new Error('当前 Bootstrap 不兼容，且没有完整安装包兜底。')
    return { mode: 'full', reason: 'bootstrap-incompatible', releaseVersion: manifest.releaseVersion, fallback: manifest.fallback }
  }

  const selected = []
  const desired = new Map(Object.entries(current).map(([id, component]) => [id, { id, ...component }]))
  for (const component of manifest.components.filter(value => componentApplies(value, platform, arch))) {
    const installed = current[component.id]
    if (!installed) {
      selected.push(component)
      desired.set(component.id, component)
      continue
    }
    const installedVersion = normalizeVersion(installed.version, `已安装组件 ${component.id} 版本`)
    const installedHash = normalizeHash(installed.sha256, `已安装组件 ${component.id} SHA-256`)
    const comparison = compareVersions(component.version, installedVersion)
    if (comparison < 0) continue
    if (comparison === 0) {
      if (component.sha256 !== installedHash) throw new Error(`组件 ${component.id} 同版本出现不同哈希，拒绝更新。`)
      continue
    }
    selected.push(component)
    desired.set(component.id, component)
  }
  const desiredComponents = [...desired.values()]
  if (!selected.length) return { mode: 'none', releaseVersion: manifest.releaseVersion, components: [], desiredComponents }
  return {
    mode: 'components',
    releaseVersion: manifest.releaseVersion,
    components: selected,
    desiredComponents,
    totalSize: selected.reduce((sum, component) => sum + component.size, 0),
    requiresRestart: selected.some(component => component.restart),
    fallback: manifest.fallback
  }
}

module.exports = {
  ALLOWED_COMPONENT_TARGETS,
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  COMPONENT_STATE_SCHEMA_VERSION,
  MAX_COMPONENT_BYTES,
  MAX_COMPONENT_UNPACKED_BYTES,
  MAX_RELEASE_BYTES,
  canonicalJson,
  compareVersions,
  createComponentUpdatePlan,
  normalizeHash,
  normalizeHttpsUrls,
  normalizeVersion,
  validateAndVerifyManifest,
  verifySignedObject,
  withoutSignature
}
