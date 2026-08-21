const { createPrivateKey, createPublicKey, sign } = require('node:crypto')
const { canonicalJson, verifySignedObject } = require('./component-update-contract.cjs')

const DESKTOP_RELEASE_MANIFEST_SCHEMA_VERSION = 1
const DESKTOP_RELEASE_MANIFEST_KIND = 'harness-desktop-release-manifest'
const SIGNATURE_KEYS = new Set(['schemaVersion', 'kind', 'keyId', 'signature'])
const ALLOWED_RELEASE_KEYS = new Set(['schemaVersion', 'kind', 'keyId', 'signature', 'tag_name', 'name', 'html_url', 'prerelease', 'draft', 'body', 'assets'])
const ALLOWED_ASSET_KEYS = new Set(['name', 'browser_download_url', 'size', 'sha256', 'mirror_urls'])

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label}必须是普通 JSON 对象。`)
  }
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}包含未知字段：${key}`)
  }
}

function trustedDesktopReleaseKey(trustedKeys, keyId) {
  const material = trustedKeys instanceof Map ? trustedKeys.get(keyId) : trustedKeys?.[keyId]
  if (!material) throw new Error(`桌面更新签名密钥不受信任：${keyId || 'missing'}`)
  const key = createPublicKey(material)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error(`桌面更新签名密钥 ${keyId} 不是 Ed25519 公钥。`)
  return key
}

function validatePublicHttpsUrl(value, label) {
  let target
  try { target = new URL(String(value || '')) } catch { throw new Error(`${label}无效。`) }
  if (target.protocol !== 'https:' || target.username || target.password || target.hash || (target.port && target.port !== '443')) {
    throw new Error(`${label}必须是无凭据、无片段、标准端口的 HTTPS 地址。`)
  }
  return target.toString()
}

function validateReleaseShape(release, index) {
  const label = `桌面发布记录 ${index + 1}`
  assertPlainObject(release, label)
  assertOnlyKeys(release, ALLOWED_RELEASE_KEYS, label)
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(release.tag_name || ''))) throw new Error(`${label} tag_name 无效。`)
  if (typeof release.name !== 'string' || release.name.length > 512) throw new Error(`${label} name 无效。`)
  if (typeof release.html_url !== 'string' || release.html_url.length > 4096) throw new Error(`${label} html_url 无效。`)
  validatePublicHttpsUrl(release.html_url, `${label} html_url`)
  if (typeof release.prerelease !== 'boolean' || typeof release.draft !== 'boolean') throw new Error(`${label}发布状态无效。`)
  if (typeof release.body !== 'string' || Buffer.byteLength(release.body) > 256 * 1024) throw new Error(`${label}发布说明过大。`)
  if (!Array.isArray(release.assets) || release.assets.length > 64) throw new Error(`${label}资产列表无效。`)
  for (const [assetIndex, asset] of release.assets.entries()) {
    const assetLabel = `${label}资产 ${assetIndex + 1}`
    assertPlainObject(asset, assetLabel)
    assertOnlyKeys(asset, ALLOWED_ASSET_KEYS, assetLabel)
    if (!String(asset.name || '').trim() || String(asset.name).length > 512) throw new Error(`${assetLabel}名称无效。`)
    validatePublicHttpsUrl(asset.browser_download_url, `${assetLabel}下载地址`)
    if (!Array.isArray(asset.mirror_urls) || asset.mirror_urls.length > 8) throw new Error(`${assetLabel}镜像列表无效。`)
    for (const mirror of asset.mirror_urls) validatePublicHttpsUrl(mirror, `${assetLabel}镜像地址`)
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error(`${assetLabel}大小无效。`)
    if (!/^[a-f0-9]{64}$/.test(String(asset.sha256 || ''))) throw new Error(`${assetLabel} SHA-256 无效。`)
  }
}

function validateAndVerifyDesktopReleaseManifest(input, trustedKeys) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) throw new Error('桌面更新清单必须包含 1-20 条签名发布记录。')
  for (const [index, release] of input.entries()) {
    assertPlainObject(release, `桌面发布记录 ${index + 1}`)
    if (release.schemaVersion !== DESKTOP_RELEASE_MANIFEST_SCHEMA_VERSION) throw new Error('桌面更新清单协议版本不受支持。')
    if (release.kind !== DESKTOP_RELEASE_MANIFEST_KIND) throw new Error('桌面更新清单类型无效。')
    const keyId = String(release.keyId || '').trim()
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId)) throw new Error('桌面更新清单 keyId 无效。')
    const key = trustedDesktopReleaseKey(trustedKeys, keyId)
    verifySignedObject(release, key, `桌面发布记录 ${index + 1}`)
    validateReleaseShape(release, index)
  }
  return input
}

function createSignedDesktopReleaseManifest(releases, { keyId, privateKey }) {
  const normalizedKeyId = String(keyId || '').trim()
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(normalizedKeyId)) throw new Error('桌面更新清单 keyId 无效。')
  if (!Array.isArray(releases) || releases.length === 0 || releases.length > 20) throw new Error('桌面更新清单必须包含 1-20 条发布记录。')
  const key = privateKey?.type === 'private' ? privateKey : createPrivateKey(privateKey)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('桌面更新清单签名私钥必须是 Ed25519。')
  return releases.map((release, index) => {
    assertPlainObject(release, `桌面发布记录 ${index + 1}`)
    for (const reserved of SIGNATURE_KEYS) {
      if (Object.hasOwn(release, reserved)) throw new Error(`桌面发布记录不得预置签名字段：${reserved}`)
    }
    const unsigned = {
      schemaVersion: DESKTOP_RELEASE_MANIFEST_SCHEMA_VERSION,
      kind: DESKTOP_RELEASE_MANIFEST_KIND,
      keyId: normalizedKeyId,
      ...release
    }
    validateReleaseShape(unsigned, index)
    const signature = sign(null, Buffer.from(canonicalJson(unsigned), 'utf8'), key).toString('base64')
    return { ...unsigned, signature }
  })
}

module.exports = {
  DESKTOP_RELEASE_MANIFEST_KIND,
  DESKTOP_RELEASE_MANIFEST_SCHEMA_VERSION,
  createSignedDesktopReleaseManifest,
  trustedDesktopReleaseKey,
  validateAndVerifyDesktopReleaseManifest
}
