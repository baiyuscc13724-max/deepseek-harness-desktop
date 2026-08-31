'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const candidateRoot = process.env.DSH_ALPHA2_CANDIDATE_ROOT || root
const runtimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
const alpha2RuntimeFile = path.join(candidateRoot, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js')
const ALPHA2_HOST_SHA256 = 'A28FA9A5FFAD5D2E7AF427C0410E973A5E14A36BC070EECF8735B77B95A17CEA'

async function patcher() {
  return import('../scripts/session-list-metadata-performance-patch.mjs')
}

function compiledSummarize(source) {
  const start = source.indexOf('const sessionListFieldsCache = /* @__PURE__ */ new WeakMap();')
  const end = source.indexOf('\n}\n/**', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const functionSource = source.slice(start, end + 2)
  let folds = 0
  let fieldFolds = 0
  const sessionListMetadata = events => {
    folds += 1
    let state = { blank: true, lastPromptAt: null }
    for (const event of events) {
      state = {
        blank: state.blank && event.type !== 'turn/start',
        lastPromptAt: event.type === 'user/message' && event.data.source.kind === 'user' ? event.time : state.lastPromptAt
      }
    }
    return state
  }
  const summarize = new Function(
    'sessionListMetadata',
    'sessionListUpdatedAt',
    'sessionListFields',
    `${functionSource}\nreturn summarize;`
  )(
    sessionListMetadata,
    (header, metadata) => Math.max(header.createdAt, metadata?.lastPromptAt ?? 0),
    (header, events) => {
      fieldFolds += 1
      return { cwd: header.cwd, eventCount: events.length }
    }
  )
  return { summarize, folds: () => folds, fieldFolds: () => fieldFolds }
}

test('host session-list metadata patch is pinned, idempotent, and drift-safe', async () => {
  const source = await readFile(runtimeFile, 'utf8')
  const { patchHostSessionListingSource } = await patcher()
  const first = patchHostSessionListingSource(source)
  assert.equal(first.changed, !source.includes('DSH_DESKTOP_MEMOIZED_SESSION_LIST_FIELDS'))
  assert.match(first.source, /projectedMetadata \?\? sessionListMetadata\(session\.events\)/u)
  assert.match(first.source, /DSH_DESKTOP_MEMOIZED_SESSION_LIST_FIELDS/u)
  assert.match(first.source, /new WeakMap\(\)/u)
  assert.match(first.source, /projections\?\.values\.sessionListMetadata/u)
  const second = patchHostSessionListingSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)

  const drifted = source.includes('DSH_DESKTOP_PROJECTED_SESSION_LIST_METADATA')
    ? source.replace('projectedMetadata ?? sessionListMetadata(session.events)', 'projectedMetadata || sessionListMetadata(session.events)')
    : source.replace('function summarize(session, running) {', 'function summarize(session, running, drift) {')
  assert.throws(() => patchHostSessionListingSource(drifted), /path changed/u)
})

test('attached rc.2 summaries reuse the exact projection fold and retain the fallback', async () => {
  const source = await readFile(runtimeFile, 'utf8')
  const { patchHostSessionListingSource } = await patcher()
  const patched = patchHostSessionListingSource(source).source
  const { summarize, folds, fieldFolds } = compiledSummarize(patched)
  const session = {
    id: 'session-a',
    header: { createdAt: 2, cwd: 'C:\\workspace' },
    events: [
      { type: 'turn/start', time: 3, data: {} },
      { type: 'user/message', time: 7, data: { source: { kind: 'user' } } },
      { type: 'assistant/message', time: 9, data: {} }
    ]
  }
  const fallback = summarize(session, true)
  assert.equal(folds(), 1)
  const projected = summarize(session, true, { blank: false, lastPromptAt: 7 })
  assert.equal(folds(), 1, 'an exact live projection must avoid a redundant full metadata fold')
  assert.equal(fieldFolds(), 1, 'unchanged event storage must reuse list fields instead of rescanning the transcript')
  assert.deepEqual(projected, fallback)
  assert.deepEqual(projected, {
    sessionId: 'session-a',
    updatedAt: 7,
    running: true,
    blank: false,
    cwd: 'C:\\workspace',
    eventCount: 3
  })
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

test('alpha.2 executes native sessionListMetadata/header-only summary semantics and proves bounded batching', async () => {
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
