const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { safeManifestUrl } = require('./component-update-service.cjs')

function normalizeComponentUpdateConfig(input, { platform = process.platform, arch = process.arch } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { enabled: false, manifestUrls: [], trustedKeys: {}, target: `${platform}-${arch}` }
  const enabled = input.enabled === true
  const target = `${platform}-${arch}`
  const targetUrls = input.targets && typeof input.targets === 'object' && !Array.isArray(input.targets)
    ? input.targets[target]
    : null
  const selectedUrls = Array.isArray(targetUrls) ? targetUrls : input.manifestUrls
  const manifestUrls = [...new Set((Array.isArray(selectedUrls) ? selectedUrls : []).map(safeManifestUrl))]
  const trustedKeys = {}
  if (input.trustedKeys && typeof input.trustedKeys === 'object' && !Array.isArray(input.trustedKeys)) {
    for (const [keyId, material] of Object.entries(input.trustedKeys)) {
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId)) throw new Error(`组件更新 keyId 无效：${keyId}`)
      const pem = String(material || '').trim()
      if (!pem.startsWith('-----BEGIN PUBLIC KEY-----') || !pem.endsWith('-----END PUBLIC KEY-----')) throw new Error(`组件更新公钥格式无效：${keyId}`)
      trustedKeys[keyId] = `${pem}\n`
    }
  }
  if (enabled && (!manifestUrls.length || !Object.keys(trustedKeys).length)) throw new Error('启用组件更新前必须配置签名清单地址和可信公钥。')
  return { enabled, manifestUrls, trustedKeys, target }
}

async function readJsonIfPresent(file, readFileImpl = readFile) {
  try { return JSON.parse(await readFileImpl(file, 'utf8')) }
  catch (error) {
    if (error?.code === 'ENOENT') return null
    throw new Error(`无法读取组件更新配置 ${file}：${error.message}`)
  }
}

async function resolveComponentUpdateConfig({ appRoot, resourcesPath, platform = process.platform, arch = process.arch, readFileImpl = readFile }) {
  const candidates = [
    resourcesPath && path.join(resourcesPath, 'component-update-sources.json'),
    appRoot && path.join(appRoot, 'component-update-sources.json')
  ].filter(Boolean)
  for (const file of [...new Set(candidates.map(value => path.resolve(value)))]) {
    const payload = await readJsonIfPresent(file, readFileImpl)
    if (payload) return { ...normalizeComponentUpdateConfig(payload, { platform, arch }), source: file }
  }
  return { enabled: false, manifestUrls: [], trustedKeys: {}, target: `${platform}-${arch}`, source: '' }
}

module.exports = { normalizeComponentUpdateConfig, readJsonIfPresent, resolveComponentUpdateConfig }
