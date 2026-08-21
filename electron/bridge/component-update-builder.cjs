const path = require('node:path')
const { createHash, createPrivateKey, sign } = require('node:crypto')
const { createReadStream } = require('node:fs')
const { lstat, mkdir, readFile, readdir, stat, writeFile } = require('node:fs/promises')
const {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  canonicalJson,
  normalizeHash,
  normalizeHttpsUrls,
  normalizeVersion,
  withoutSignature
} = require('./component-update-contract.cjs')
const {
  COMPONENT_INDEX_FILE,
  COMPONENT_INDEX_SCHEMA_VERSION,
  normalizeRelativePath
} = require('./component-update-archive.cjs')

async function collectComponentFiles(root, relative = '') {
  const resolvedRoot = path.resolve(root)
  const directory = relative ? path.join(resolvedRoot, ...relative.split('/')) : resolvedRoot
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const next = normalizeRelativePath(relative ? `${relative}/${entry.name}` : entry.name)
    if (next.toLowerCase() === COMPONENT_INDEX_FILE) throw new Error(`组件输入目录不能预先包含 ${COMPONENT_INDEX_FILE}。`)
    const full = path.join(resolvedRoot, ...next.split('/'))
    const info = await lstat(full)
    if (info.isSymbolicLink()) throw new Error(`组件输入不允许符号链接：${next}`)
    if (info.isDirectory()) files.push(...await collectComponentFiles(resolvedRoot, next))
    else if (info.isFile()) files.push({ path: next, fullPath: full, size: info.size })
    else throw new Error(`组件输入包含不支持的文件类型：${next}`)
  }
  return files
}

function hashStream(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function buildComponentIndex({ inputDir, id, version, target }) {
  const files = await collectComponentFiles(inputDir)
  if (!files.length) throw new Error('组件输入目录为空。')
  const records = []
  for (const file of files) records.push({ path: file.path, size: file.size, sha256: await hashStream(file.fullPath) })
  records.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  return {
    index: {
      schemaVersion: COMPONENT_INDEX_SCHEMA_VERSION,
      id: String(id || '').trim(),
      version: normalizeVersion(version, '组件版本'),
      target: String(target || '').trim(),
      files: records
    },
    files,
    unpackedSize: records.reduce((sum, file) => sum + file.size, 0)
  }
}

async function writeAdmZip(archive, outputFile) {
  await mkdir(path.dirname(outputFile), { recursive: true })
  await new Promise((resolve, reject) => archive.writeZip(outputFile, error => error ? reject(error) : resolve()))
}

async function createComponentZip({ inputDir, outputFile, id, version, target, AdmZipImpl }) {
  if (typeof AdmZipImpl !== 'function') throw new Error('ZIP 构建组件不可用。')
  const built = await buildComponentIndex({ inputDir, id, version, target })
  const archive = new AdmZipImpl()
  const deterministicTime = new Date('2000-01-01T00:00:00.000Z')
  const addDeterministicFile = (name, content) => {
    archive.addFile(name, content)
    const entry = archive.getEntry(name)
    if (!entry) throw new Error(`无法固定 ZIP 条目：${name}`)
    entry.header.time = deterministicTime
  }
  for (const file of built.files) addDeterministicFile(file.path, await readFile(file.fullPath))
  addDeterministicFile(COMPONENT_INDEX_FILE, Buffer.from(`${JSON.stringify(built.index, null, 2)}\n`, 'utf8'))
  await writeAdmZip(archive, outputFile)
  const info = await stat(outputFile)
  return {
    outputFile,
    size: info.size,
    unpackedSize: built.unpackedSize,
    sha256: await hashStream(outputFile),
    index: built.index
  }
}

function privateEd25519Key(material) {
  const key = createPrivateKey(material)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('组件发布私钥必须是 Ed25519。')
  return key
}

function signCanonicalObject(value, privateKeyMaterial) {
  const key = privateKeyMaterial?.type === 'private' ? privateKeyMaterial : privateEd25519Key(privateKeyMaterial)
  const unsigned = withoutSignature(value)
  const signature = sign(null, Buffer.from(canonicalJson(unsigned), 'utf8'), key).toString('base64')
  return { ...unsigned, signature }
}

function createSignedComponentDescriptor({ id, version, target, platform, arch, archive, urls, required = true, restart = true }, privateKey) {
  const descriptor = {
    id: String(id || '').trim(),
    version: normalizeVersion(version, '组件版本'),
    kind: 'zip',
    target: String(target || '').trim(),
    ...(platform ? { platform: String(platform) } : {}),
    ...(arch ? { arch: String(arch) } : {}),
    size: Number(archive.size),
    unpackedSize: Number(archive.unpackedSize),
    sha256: normalizeHash(archive.sha256),
    urls: normalizeHttpsUrls(urls),
    required: required !== false,
    restart: restart !== false
  }
  return signCanonicalObject(descriptor, privateKey)
}

function createSignedReleaseManifest({ releaseVersion, channel = 'stable', publishedAt = new Date(), keyId, bootstrap, components, fallback, notes = '' }, privateKey) {
  const value = {
    schemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    releaseVersion: normalizeVersion(releaseVersion, '发布版本'),
    channel,
    publishedAt: new Date(publishedAt).toISOString(),
    keyId: String(keyId || '').trim(),
    bootstrap: {
      minVersion: normalizeVersion(bootstrap?.minVersion, '最低 Bootstrap 版本'),
      ...(bootstrap?.maxVersion ? { maxVersion: normalizeVersion(bootstrap.maxVersion, '最高 Bootstrap 版本') } : {})
    },
    components,
    ...(fallback ? { fallback } : {}),
    notes: String(notes || '')
  }
  return signCanonicalObject(value, privateKey)
}

async function writeSignedManifest(file, manifest) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return file
}

module.exports = {
  buildComponentIndex,
  collectComponentFiles,
  createComponentZip,
  createSignedComponentDescriptor,
  createSignedReleaseManifest,
  hashStream,
  privateEd25519Key,
  signCanonicalObject,
  writeSignedManifest
}
