import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readStoreIdentity, renderStoreManifest } from './store-msix-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requireIdentity = process.argv.includes('--require-identity')
const requiredFiles = [
  'store/Package.appxmanifest.template',
  'store/store-identity.example.json',
  'store/branding/harness-desktop-store.svg',
  'store/Assets/app.ico',
  'store/Assets/AppList.targetsize-256.png',
  'build/electron-builder.store.yml',
  'docs/PRIVACY.md',
  'docs/AI_CONTENT_POLICY.md',
  'docs/PLUGIN_CONTENT_POLICY.md',
  'store/listing/zh-CN.md',
  'store/listing/en-US.md',
  'store/listing/certification-notes.md',
  'store/SUBMISSION_CHECKLIST.md'
]

for (const relative of requiredFiles) await access(path.join(root, relative))

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const main = await readFile(path.join(root, 'electron/main.cjs'), 'utf8')
const preload = await readFile(path.join(root, 'electron/preload.cjs'), 'utf8')
const renderer = await readFile(path.join(root, 'renderer/app.js'), 'utf8')
const storeConfig = await readFile(path.join(root, 'build/electron-builder.store.yml'), 'utf8')
const privacy = await readFile(path.join(root, 'docs/PRIVACY.md'), 'utf8')
const template = await readFile(path.join(root, 'store/Package.appxmanifest.template'), 'utf8')

for (const contract of ['STORE_BUILD', 'storeManaged: true', 'Microsoft Store 管理桌面应用更新']) {
  if (!main.includes(contract)) throw new Error(`Store update policy is missing: ${contract}`)
}
if (!preload.includes('getDistribution') || !renderer.includes('nonCommercialContentAvailable')) {
  throw new Error('The renderer does not receive the Store distribution policy.')
}
for (const excluded of ['!renderer/themes/maid-atelier/**/*', '!renderer/pets/maid-whale/**/*']) {
  if (!storeConfig.includes(excluded)) throw new Error(`Store build does not exclude noncommercial content: ${excluded}`)
}
for (const disclosure of ['generative AI', '第三方 AI', '本地文件', '删除']) {
  if (!privacy.toLowerCase().includes(disclosure.toLowerCase())) throw new Error(`Privacy policy disclosure is missing: ${disclosure}`)
}

const digest = value => createHash('sha256').update(value).digest('hex')
const directIcon = await readFile(path.join(root, 'build/icon.png'))
const storeIcon = await readFile(path.join(root, 'store/Assets/AppList.targetsize-256.png'))
if (digest(directIcon) === digest(storeIcon)) throw new Error('The Store icon must be original and distinct from the direct-build DeepSeek mark.')

const { identityPath, identity, warning } = await readStoreIdentity(root, { required: requireIdentity })
if (identity) {
  renderStoreManifest(template, identity, pkg.version)
  console.log(`READY: Partner Center identity validated from ${identityPath}`)
} else {
  console.log(`WAITING_FOR_PARTNER_CENTER_IDENTITY: ${identityPath}`)
  console.log(`Copy store/store-identity.example.json to that path and replace all four values. (${warning})`)
}
console.log(`Store/MSIX readiness checks passed for Harness Desktop ${pkg.version}.`)
