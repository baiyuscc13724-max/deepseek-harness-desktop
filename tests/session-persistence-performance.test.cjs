const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const runtimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')
const patchFile = path.join(root, 'scripts', 'session-persistence-performance-patch.mjs')

async function runtime() {
  return import(pathToFileURL(runtimeFile).href)
}

function fakePersistence(JsonlSessionPersistence, count, readFirstZstdLine) {
  const persistence = Object.create(JsonlSessionPersistence.prototype)
  persistence.compression = 'zstd'
  persistence.ensureRootEncoding = async () => {}
  persistence.listProjectDirs = async () => ['project']
  persistence.listSessionDirs = async () => Array.from({ length: count }, (_, index) => `dir-${index}`)
  persistence.oppositeCompression = () => 'none'
  persistence.exists = async value => value.endsWith('.jsonl.zstd')
  persistence.readFirstZstdLine = readFirstZstdLine
  persistence.assertStoredIdentity = async () => {}
  return persistence
}

function header(index) {
  return JSON.stringify({
    type: 'session',
    version: 1,
    id: `session-${index}`,
    createdAt: index,
    delegationDepth: 0
  })
}

test('installed session metadata listing patch is pinned and idempotent', async () => {
  const [{ patchSessionPersistenceListingSource }, source] = await Promise.all([
    import(pathToFileURL(patchFile).href),
    readFile(runtimeFile, 'utf8')
  ])
  const patched = patchSessionPersistenceListingSource(source)
  assert.equal(patched.changed, false)
  assert.equal(patched.source, source)
  assert.match(source, /DSH_DESKTOP_BOUNDED_SESSION_LIST/)

  const drifted = source.replace('const concurrency = Math.min(8, sessionDirs.length);', 'const concurrency = Math.min(7, sessionDirs.length);')
  assert.throws(
    () => patchSessionPersistenceListingSource(drifted),
    /differs from the pinned implementation/
  )
})

test('session metadata listing preserves input order while reading at most eight artifacts concurrently', async () => {
  const { JsonlSessionPersistence } = await runtime()
  let active = 0
  let maximum = 0
  const persistence = fakePersistence(JsonlSessionPersistence, 24, async value => {
    const index = Number(/dir-(\d+)/.exec(value)[1])
    active += 1
    maximum = Math.max(maximum, active)
    try {
      await new Promise(resolve => setTimeout(resolve, (23 - index) % 5))
      return header(index)
    } finally {
      active -= 1
    }
  })

  const listed = await persistence.list()
  assert.deepEqual(listed.map(item => item.id), Array.from({ length: 24 }, (_, index) => `session-${index}`))
  assert.ok(maximum > 1, `expected concurrent reads, observed ${maximum}`)
  assert.ok(maximum <= 8, `expected at most eight concurrent reads, observed ${maximum}`)
})

test('session metadata listing reports the earliest input failure and settles the started window', async () => {
  const { JsonlSessionPersistence } = await runtime()
  const completed = []
  const persistence = fakePersistence(JsonlSessionPersistence, 12, async value => {
    const index = Number(/dir-(\d+)/.exec(value)[1])
    try {
      if (index === 2) {
        await new Promise(resolve => setTimeout(resolve, 20))
        throw new Error('earlier-input-failure')
      }
      if (index === 5) throw new Error('later-input-failure')
      await new Promise(resolve => setTimeout(resolve, 2))
      return header(index)
    } finally {
      completed.push(index)
    }
  })

  await assert.rejects(() => persistence.list(), /earlier-input-failure/)
  assert.deepEqual([...completed].sort((a, b) => a - b), Array.from({ length: 10 }, (_, index) => index))
})
