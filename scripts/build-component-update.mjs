import path from 'node:path'
import process from 'node:process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createPublicKey } from 'node:crypto'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')
const {
  createComponentZip,
  createSignedComponentDescriptor,
  createSignedReleaseManifest,
  privateEd25519Key,
  writeSignedManifest
} = require('../electron/bridge/component-update-builder.cjs')

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function safeArtifactName(value) {
  const name = String(value || '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,120}\.zip$/.test(name)) throw new Error(`组件资产文件名无效：${name}`)
  return name
}

function assetUrls(component, fileName, baseUrls) {
  if (Array.isArray(component.urls) && component.urls.length) return component.urls
  if (!Array.isArray(baseUrls) || !baseUrls.length) throw new Error(`组件 ${component.id} 没有下载地址。`)
  return baseUrls.map(base => `${String(base).replace(/\/$/, '')}/${encodeURIComponent(fileName)}`)
}

const configPath = path.resolve(process.cwd(), argument('--config', 'component-release.json'))
const config = JSON.parse(await readFile(configPath, 'utf8'))
const releaseVersion = String(config.releaseVersion || '').replace(/^v/i, '')
const outputRoot = path.resolve(process.cwd(), argument('--out', path.join('.artifacts', `component-update-v${releaseVersion}`)))
const keyFile = process.env.HARNESS_COMPONENT_SIGNING_KEY_FILE
if (!keyFile) throw new Error('必须通过 HARNESS_COMPONENT_SIGNING_KEY_FILE 指定 Ed25519 私钥文件。')
const privateKey = privateEd25519Key(await readFile(path.resolve(keyFile), 'utf8'))
const keyId = String(process.env.HARNESS_COMPONENT_KEY_ID || config.keyId || '').trim()
if (!keyId) throw new Error('必须配置组件发布 keyId。')
if (!Array.isArray(config.components) || !config.components.length) throw new Error('组件发布配置没有 components。')

const descriptors = []
for (const component of config.components) {
  const fileName = safeArtifactName(component.fileName || `${component.id}-${releaseVersion}-${component.platform || process.platform}-${component.arch || process.arch}.zip`)
  const inputDir = path.resolve(path.dirname(configPath), component.inputDir)
  const outputFile = path.join(outputRoot, fileName)
  const archive = await createComponentZip({
    inputDir,
    outputFile,
    id: component.id,
    version: component.version || releaseVersion,
    target: component.target,
    AdmZipImpl: AdmZip
  })
  descriptors.push(createSignedComponentDescriptor({
    id: component.id,
    version: component.version || releaseVersion,
    target: component.target,
    platform: component.platform,
    arch: component.arch,
    archive,
    urls: assetUrls(component, fileName, config.baseUrls),
    required: component.required,
    restart: component.restart
  }, privateKey))
  console.log(`Built ${component.id}: ${archive.size} bytes, sha256=${archive.sha256}`)
}

const manifest = createSignedReleaseManifest({
  releaseVersion,
  channel: config.channel || 'stable',
  publishedAt: config.publishedAt || new Date(),
  keyId,
  bootstrap: config.bootstrap,
  components: descriptors,
  fallback: config.fallback,
  notes: config.notes || ''
}, privateKey)
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
validateAndVerifyManifest(manifest, { [keyId]: publicKey })
const manifestFile = path.join(outputRoot, config.manifestName || 'components.json')
await writeSignedManifest(manifestFile, manifest)
console.log(`Signed component manifest: ${manifestFile}`)
console.log('No files were uploaded. Publish immutable assets first and the signed manifest last.')
