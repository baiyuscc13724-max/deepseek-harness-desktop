import { createHash } from 'node:crypto'
import { lstat, opendir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { TextDecoder } from 'node:util'

const CANONICAL_ALGORITHM = 'sha256(utf8(relative-path-with-forward-slashes)\\0decimal-byte-count\\0lowercase-file-sha256\\n), rows sorted by unsigned UTF-8 bytes'
const FATAL_UTF8 = new TextDecoder('utf-8', { fatal: true })

export function assertCanonicalRelativePath(value, { label = 'Tree path', allowBackslash = false } = {}) {
  if (typeof value !== 'string' || value === '' || /[\0\r\n]/u.test(value)) throw new Error(`${label} is not canonically encodable.`)
  if (Buffer.from(value, 'utf8').toString('utf8') !== value) throw new Error(`${label} does not round-trip through UTF-8.`)
  if (!allowBackslash && value.includes('\\')) throw new Error(`${label} must use forward slashes.`)
  const normalized = allowBackslash ? value.replaceAll('\\', '/') : value
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) throw new Error(`${label} must be relative.`)
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) throw new Error(`${label} contains an unsafe or empty segment.`)
  return normalized
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

async function collectFiles(root, relative = '', output = []) {
  const directory = path.join(root, ...relative.split('/').filter(Boolean))
  const handle = await opendir(directory)
  for await (const entry of handle) {
    const child = assertCanonicalRelativePath(relative ? `${relative}/${entry.name}` : entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not accepted by the file-tree digest: ${child}`)
    if (entry.isDirectory()) await collectFiles(root, child, output)
    else if (entry.isFile()) output.push(child)
    else throw new Error(`Unsupported tree entry type: ${child}`)
  }
  return output
}

export async function digestFileTree(rootInput, { frozenManifestPath } = {}) {
  const root = path.resolve(rootInput)
  const rootState = await lstat(root)
  if (!rootState.isDirectory() || rootState.isSymbolicLink()) throw new Error(`Tree root must be a real directory: ${root}`)
  const paths = await collectFiles(root)
  paths.sort(compareUtf8)

  const canonical = createHash('sha256')
  const observedFileSha256 = new Map()
  let totalBytes = 0n
  for (const relativePath of paths) {
    const absolutePath = path.join(root, ...relativePath.split('/'))
    const fileState = await lstat(absolutePath)
    if (fileState.isSymbolicLink() || !fileState.isFile()) throw new Error(`Tree entry changed type before hashing: ${relativePath}`)
    const bytes = await readFile(absolutePath)
    const fileSha256 = createHash('sha256').update(bytes).digest('hex')
    canonical.update(Buffer.from(relativePath, 'utf8'))
    canonical.update(Buffer.from([0]))
    canonical.update(Buffer.from(String(bytes.length), 'ascii'))
    canonical.update(Buffer.from([0]))
    canonical.update(Buffer.from(fileSha256, 'ascii'))
    canonical.update(Buffer.from('\n', 'ascii'))
    observedFileSha256.set(relativePath, fileSha256.toUpperCase())
    totalBytes += BigInt(bytes.length)
  }

  let frozenManifestComparison
  if (frozenManifestPath) {
    const manifestPath = path.resolve(frozenManifestPath)
    const manifestBytes = await readFile(manifestPath)
    let text
    try { text = FATAL_UTF8.decode(manifestBytes) } catch { throw new Error('Frozen manifest is not valid UTF-8.') }
    const encodedRows = text.split('\n')
    if (encodedRows.at(-1) === '') encodedRows.pop()
    const rows = encodedRows.map(row => row.endsWith('\r') ? row.slice(0, -1) : row)
    if (rows.length === 0 || rows.some(row => row === '')) throw new Error('Frozen manifest contains a blank or missing row.')
    const expected = new Map()
    for (const row of rows) {
      if (row.includes('\r')) throw new Error('Frozen manifest contains a bare carriage return.')
      const separator = row.lastIndexOf('|')
      const rawPath = row.slice(0, separator)
      const sha256 = row.slice(separator + 1)
      if (separator <= 0 || rawPath.includes('|') || !/^[A-F0-9]{64}$/u.test(sha256)) throw new Error(`Frozen manifest row is invalid: ${row.slice(0, 160)}`)
      const relativePath = assertCanonicalRelativePath(rawPath, { label: 'Frozen manifest path', allowBackslash: true })
      if (expected.has(relativePath)) throw new Error(`Frozen manifest contains a duplicate canonical path: ${relativePath}`)
      expected.set(relativePath, sha256)
    }
    const mismatches = []
    for (const [relativePath, sha256] of observedFileSha256) if (expected.get(relativePath) !== sha256) mismatches.push(relativePath)
    for (const relativePath of expected.keys()) if (!observedFileSha256.has(relativePath)) mismatches.push(relativePath)
    if (mismatches.length !== 0 || expected.size !== observedFileSha256.size) {
      throw new Error(`Frozen manifest does not exactly match the observed tree (${mismatches.length} mismatched paths).`)
    }
    frozenManifestComparison = {
      path: manifestPath,
      manifestFileSha256: createHash('sha256').update(manifestBytes).digest('hex').toUpperCase(),
      rowCount: rows.length,
      exactPathAndFileSha256Match: true,
      mismatchCount: 0,
      mismatchSample: []
    }
  }

  return {
    schemaVersion: 1,
    algorithm: CANONICAL_ALGORITHM,
    relativePathFormat: 'forward-slash UTF-8, no NUL/CR/LF',
    rowOrder: 'unsigned UTF-8 byte order',
    fileSha256Format: 'lowercase hexadecimal',
    byteCountFormat: 'base-10 ASCII, no leading sign',
    fileCount: paths.length,
    totalBytes: String(totalBytes),
    treeSha256: canonical.digest('hex').toUpperCase(),
    ...(frozenManifestComparison ? { frozenManifestComparison } : {})
  }
}

async function main(argv) {
  const root = argv[0]
  if (!root) throw new Error('Usage: node scripts/hermetic-tree-digest.mjs <tree-root> [--frozen-manifest <path>] [--output <json-file>]')
  const options = new Map()
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!['--frozen-manifest', '--output'].includes(key) || !value || options.has(key)) throw new Error('Arguments must be unique --frozen-manifest/--output value pairs.')
    options.set(key, value)
  }
  const evidence = {
    ...(await digestFileTree(root, { frozenManifestPath: options.get('--frozen-manifest') })),
    root: path.resolve(root),
    generatedAt: new Date().toISOString()
  }
  const json = `${JSON.stringify(evidence, null, 2)}\n`
  if (options.has('--output')) await writeFile(path.resolve(options.get('--output')), json, { encoding: 'utf8', flag: 'wx' })
  process.stdout.write(json)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exitCode = 1
  })
}
