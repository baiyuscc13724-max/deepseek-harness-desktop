'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { access, mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const alpha2Audit = process.env.DSH_HISTORICAL_ALPHA2_AUDIT === '1' ? test : test.skip

const root = path.resolve(__dirname, '..')
const candidateRoot = process.env.DSH_ALPHA2_CANDIDATE_ROOT || root
const retiredRuntimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
const alpha2RuntimeFile = path.join(candidateRoot, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js')
const ALPHA2_HOST_SHA256 = 'A28FA9A5FFAD5D2E7AF427C0410E973A5E14A36BC070EECF8735B77B95A17CEA'

alpha2Audit('alpha.2 session-list metadata owner is the pinned official controller artifact', async () => {
  const source = await readFile(alpha2RuntimeFile, 'utf8')
  assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(), ALPHA2_HOST_SHA256)
  await assert.rejects(access(retiredRuntimeFile), { code: 'ENOENT' })
  const { assertInstalledAlpha2NativeSessionList } = await import('../scripts/patch-official-runtime.mjs')
  assert.equal(await assertInstalledAlpha2NativeSessionList(alpha2RuntimeFile), false)
})

test('alpha.2 attached summaries consume the live projection without rescanning transcript events', async () => {
  const source = await readFile(alpha2RuntimeFile, 'utf8')
  const start = source.indexOf('\tsummaryFor(session) {')
  const end = source.indexOf('\n\t/**', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const summaryFor = source.slice(start, end)
  assert.match(summaryFor, /const metadata = projections\?\.values\.sessionListMetadata;/u)
  assert.match(summaryFor, /updatedAt\(session\.header, metadata\)/u)
  assert.match(summaryFor, /\.\.\.listFields\(session\.header\)/u)
  assert.doesNotMatch(summaryFor, /session\.events/u)
})

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `missing native function ${name}`)
  const body = source.indexOf('{', start)
  let depth = 0
  for (let index = body; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated native function ${name}`)
}

alpha2Audit('alpha.2 executes native sessionListMetadata/header-only summary semantics and proves bounded batching', async () => {
  const source = await readFile(alpha2RuntimeFile, 'utf8')
  assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(), ALPHA2_HOST_SHA256)
  const applySource = extractFunction(source, 'applySessionListMetadata')
  const updatedSource = extractFunction(source, 'updatedAt')
  const fieldsSource = extractFunction(source, 'listFields')
  const native = new Function(`${applySource}\n${updatedSource}\n${fieldsSource}\nreturn { applySessionListMetadata, updatedAt, listFields };`)()
  let metadata = { blank: true, lastPromptAt: null }
  metadata = native.applySessionListMetadata(metadata, { type: 'turn/start', time: 3, data: {} })
  metadata = native.applySessionListMetadata(metadata, { type: 'user/message', time: 7, data: { source: { kind: 'user' } } })
  assert.deepEqual(metadata, { blank: false, lastPromptAt: 7 })
  const header = { createdAt: 2, parentSession: 'parent-a', origin: 'subagent', cwd: 'C:\\workspace', events: [{ forbidden: true }] }
  assert.equal(native.updatedAt(header, metadata), 7)
  assert.deepEqual(native.listFields(header), { parentSessionId: 'parent-a', origin: 'subagent', cwd: 'C:\\workspace' })
  assert.match(source, /key: "sessionListMetadata"[\s\S]*apply: applySessionListMetadata/u)
  assert.match(source, /const metadata = projections\?\.values\.sessionListMetadata;[\s\S]*\.\.\.listFields\(session\.header\)/u)
  assert.match(source, /const COLD_SUMMARY_BATCH_SIZE = 16;/u)
  assert.match(source, /cold\.slice\(offset, offset \+ COLD_SUMMARY_BATCH_SIZE\)\.map\(\(header\) => this\.summarizeCold\(header, signal\)\)/u)
  const { assertInstalledAlpha2NativeSessionList } = await import('../scripts/patch-official-runtime.mjs')
  assert.equal(await assertInstalledAlpha2NativeSessionList(alpha2RuntimeFile), false)
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-alpha2-list-proof-'))
  try {
    await mkdir(path.join(temp, 'lib'))
    await writeFile(path.join(temp, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-api-session-controller', version: '0.1.2-alpha.2' }))
    const driftFile = path.join(temp, 'lib', 'index.js')
    await writeFile(driftFile, source.replace('const COLD_SUMMARY_BATCH_SIZE = 16;', 'const COLD_SUMMARY_BATCH_SIZE = 17;'))
    await assert.rejects(() => assertInstalledAlpha2NativeSessionList(driftFile), /source hash changed/)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
