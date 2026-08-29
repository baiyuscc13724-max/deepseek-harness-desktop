'use strict'

const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const runtimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')

async function patcher() {
  return import('../scripts/session-list-metadata-performance-patch.mjs')
}

function compiledSummarize(source) {
  const start = source.indexOf('function summarize(session, running, projectedMetadata) {')
  const end = source.indexOf('\n}\n/**', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const functionSource = source.slice(start, end + 2)
  let folds = 0
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
    `return (${functionSource})`
  )(
    sessionListMetadata,
    (header, metadata) => Math.max(header.createdAt, metadata?.lastPromptAt ?? 0),
    (header, events) => ({ cwd: header.cwd, eventCount: events.length })
  )
  return { summarize, folds: () => folds }
}

test('host session-list metadata patch is pinned, idempotent, and drift-safe', async () => {
  const source = await readFile(runtimeFile, 'utf8')
  const { patchHostSessionListingSource } = await patcher()
  const first = patchHostSessionListingSource(source)
  assert.equal(first.changed, !source.includes('DSH_DESKTOP_PROJECTED_SESSION_LIST_METADATA'))
  assert.match(first.source, /projectedMetadata \?\? sessionListMetadata\(session\.events\)/u)
  assert.match(first.source, /projections\?\.values\.sessionListMetadata/u)
  const second = patchHostSessionListingSource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)

  const drifted = source.includes('DSH_DESKTOP_PROJECTED_SESSION_LIST_METADATA')
    ? source.replace('projectedMetadata ?? sessionListMetadata(session.events)', 'projectedMetadata || sessionListMetadata(session.events)')
    : source.replace('function summarize(session, running) {', 'function summarize(session, running, drift) {')
  assert.throws(() => patchHostSessionListingSource(drifted), /path changed/u)
})

test('attached summaries reuse the exact projection fold and retain the fallback', async () => {
  const source = await readFile(runtimeFile, 'utf8')
  const { patchHostSessionListingSource } = await patcher()
  const patched = patchHostSessionListingSource(source).source
  const { summarize, folds } = compiledSummarize(patched)
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
