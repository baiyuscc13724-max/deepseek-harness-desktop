const path = require('node:path')
const { createHash } = require('node:crypto')
const { lstat, mkdir, readFile, readdir } = require('node:fs/promises')
const { normalizeHash, normalizeVersion } = require('./component-update-contract.cjs')

const COMPONENT_INDEX_SCHEMA_VERSION = 1
const COMPONENT_INDEX_FILE = 'component.json'
const MAX_COMPONENT_FILES = 20_000
const MAX_RELATIVE_PATH_LENGTH = 240

function normalizeRelativePath(value) {
  const original = String(value || '')
  if (!original || original.includes('\0') || original.length > MAX_RELATIVE_PATH_LENGTH) throw new Error('组件文件路径无效。')
  const slash = original.replaceAll('\\', '/')
  if (slash.startsWith('/') || /^[A-Za-z]:/.test(slash)) throw new Error(`组件文件路径不能是绝对路径：${original}`)
  const parts = slash.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`组件文件路径包含不安全片段：${original}`)
  return parts.join('/')
}

function normalizeComponentIndex(input, descriptor) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('组件索引必须是 JSON 对象。')
  const allowed = new Set(['schemaVersion', 'id', 'version', 'target', 'files'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`组件索引包含未知字段：${key}`)
  if (input.schemaVersion !== COMPONENT_INDEX_SCHEMA_VERSION) throw new Error('组件索引协议版本不受支持。')
  const id = String(input.id || '').trim()
  const target = String(input.target || '').trim()
  const version = normalizeVersion(input.version, '组件索引版本')
  if (id !== descriptor.id || version !== descriptor.version || target !== descriptor.target) throw new Error('组件索引与已签名描述不一致。')
  if (!Array.isArray(input.files) || input.files.length === 0 || input.files.length > MAX_COMPONENT_FILES) throw new Error('组件索引文件数量无效。')
  const files = input.files.map(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('组件文件记录无效。')
    for (const key of Object.keys(file)) if (!['path', 'size', 'sha256'].includes(key)) throw new Error(`组件文件记录包含未知字段：${key}`)
    const relativePath = normalizeRelativePath(file.path)
    if (relativePath.toLowerCase() === COMPONENT_INDEX_FILE) throw new Error('组件索引不能把自己列为负载文件。')
    const size = Number(file.size)
    if (!Number.isSafeInteger(size) || size < 0 || size > descriptor.unpackedSize) throw new Error(`组件文件大小无效：${relativePath}`)
    return { path: relativePath, size, sha256: normalizeHash(file.sha256, `组件文件 ${relativePath} SHA-256`) }
  })
  const caseInsensitive = files.map(file => file.path.toLowerCase())
  if (new Set(caseInsensitive).size !== files.length) throw new Error('组件索引包含重复或大小写冲突的文件路径。')
  if (files.reduce((sum, file) => sum + file.size, 0) !== descriptor.unpackedSize) throw new Error('组件索引解压大小与已签名描述不一致。')
  return { schemaVersion: COMPONENT_INDEX_SCHEMA_VERSION, id, version, target, files }
}

function assertInsideRoot(root, relativePath) {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, ...normalizeRelativePath(relativePath).split('/'))
  if (target === resolvedRoot || !target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error(`组件文件逃逸目标目录：${relativePath}`)
  return target
}

async function sha256File(file, readFileImpl = readFile) {
  const content = await readFileImpl(file)
  return createHash('sha256').update(content).digest('hex')
}

async function walkFiles(root, relative = '', { readdirImpl = readdir, lstatImpl = lstat } = {}) {
  const directory = relative ? assertInsideRoot(root, relative) : path.resolve(root)
  const entries = await readdirImpl(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name
    const safe = normalizeRelativePath(next)
    const full = assertInsideRoot(root, safe)
    const info = await lstatImpl(full)
    if (info.isSymbolicLink()) throw new Error(`组件目录不允许符号链接：${safe}`)
    if (info.isDirectory()) files.push(...await walkFiles(root, safe, { readdirImpl, lstatImpl }))
    else if (info.isFile()) files.push(safe)
    else throw new Error(`组件目录包含不支持的文件类型：${safe}`)
    if (files.length > MAX_COMPONENT_FILES + 1) throw new Error('组件目录文件数量超过安全限制。')
  }
  return files
}

async function verifyExtractedComponent(root, descriptor, options = {}) {
  const readFileImpl = options.readFileImpl || readFile
  const lstatImpl = options.lstatImpl || lstat
  const indexPath = assertInsideRoot(root, COMPONENT_INDEX_FILE)
  const indexInfo = await lstatImpl(indexPath)
  if (!indexInfo.isFile() || indexInfo.isSymbolicLink()) throw new Error('组件索引不是普通文件。')
  const index = normalizeComponentIndex(JSON.parse(await readFileImpl(indexPath, 'utf8')), descriptor)
  const expected = new Map(index.files.map(file => [file.path.toLowerCase(), file]))
  const actual = await walkFiles(root, '', options)
  const payloadFiles = actual.filter(file => file.toLowerCase() !== COMPONENT_INDEX_FILE)
  if (payloadFiles.length !== expected.size) throw new Error('组件目录文件数量与索引不一致。')
  for (const relativePath of payloadFiles) {
    const record = expected.get(relativePath.toLowerCase())
    if (!record) throw new Error(`组件目录包含未声明文件：${relativePath}`)
    const full = assertInsideRoot(root, relativePath)
    const info = await lstatImpl(full)
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.size) throw new Error(`组件文件大小或类型校验失败：${relativePath}`)
    const hash = await sha256File(full, readFileImpl)
    if (hash !== record.sha256) throw new Error(`组件文件 SHA-256 校验失败：${relativePath}`)
  }
  return index
}

function zipEntryUnixType(entry) {
  const attributes = Number(entry?.header?.attr || 0) >>> 0
  return (attributes >>> 16) & 0o170000
}

function validateZipEntries(entries, maxBytes) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_COMPONENT_FILES * 2) throw new Error('组件压缩包条目数量无效。')
  let total = 0
  const seen = new Set()
  for (const entry of entries) {
    const raw = String(entry.entryName || '').replace(/\/$/, '')
    if (!raw) continue
    const safe = normalizeRelativePath(raw)
    const key = safe.toLowerCase()
    if (seen.has(key)) throw new Error(`组件压缩包包含重复路径：${safe}`)
    seen.add(key)
    if (zipEntryUnixType(entry) === 0o120000) throw new Error(`组件压缩包不允许符号链接：${safe}`)
    const size = Number(entry?.header?.size || 0)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`组件压缩包条目大小无效：${safe}`)
    total += size
    if (total > maxBytes) throw new Error('组件解压后大小超过安全限制。')
  }
}

async function extractAndVerifyZip({ archivePath, destination, descriptor, AdmZipImpl, mkdirImpl = mkdir }) {
  if (typeof AdmZipImpl !== 'function') throw new Error('ZIP 解压组件不可用。')
  const archive = new AdmZipImpl(archivePath)
  validateZipEntries(archive.getEntries(), descriptor.unpackedSize + 1024 * 1024)
  await mkdirImpl(destination, { recursive: true })
  archive.extractAllTo(destination, true)
  return verifyExtractedComponent(destination, descriptor)
}

module.exports = {
  COMPONENT_INDEX_FILE,
  COMPONENT_INDEX_SCHEMA_VERSION,
  MAX_COMPONENT_FILES,
  assertInsideRoot,
  extractAndVerifyZip,
  normalizeComponentIndex,
  normalizeRelativePath,
  sha256File,
  validateZipEntries,
  verifyExtractedComponent,
  walkFiles
}
