const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { BrowserHistoryStore } = require('../electron/bridge/browser-history-store.cjs')

test('browser history strips credentials, queries and fragments before persistence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-history-'))
  try {
    const file = path.join(directory, 'history.json')
    let sequence = 0
    const store = new BrowserHistoryStore({ file, now: () => ++sequence, idFactory: () => `id-${sequence}` })
    await store.add('https://user:password@example.com/private/path?q=browser&token=secret#otp', 'Account token=abcdefghijklmnopqrstuvwxyz')
    const [entry] = await store.search('example')
    assert.equal(entry.url, 'https://example.com')
    assert.equal(entry.title, '')
    const disk = await readFile(file, 'utf8')
    assert.doesNotMatch(disk, /password|token=secret|#otp|abcdefghijklmnopqrstuvwxyz/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('browser history serializes concurrent atomic writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-history-'))
  try {
    const file = path.join(directory, 'history.json')
    const store = new BrowserHistoryStore({ file, maxEntries: 50 })
    await Promise.all(Array.from({ length: 20 }, (_, index) => store.add(`https://page-${index}.example.com/path?q=${index}`, `Page ${index}`)))
    const restored = new BrowserHistoryStore({ file, maxEntries: 50 })
    assert.equal((await restored.search('')).length, 20)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('browser history deduplicates visits, searches, removes and persists', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-history-'))
  try {
    const file = path.join(directory, 'history.json')
    let now = 100
    const store = new BrowserHistoryStore({ file, maxEntries: 10, now: () => ++now, idFactory: () => `visit-${now}` })
    await store.add('https://first.example.com/one', 'First')
    await store.add('https://second.example.com/two', 'Second')
    await store.add('https://first.example.com/other?q=secret', 'First updated')
    const all = await store.search('')
    assert.equal(all.length, 2)
    assert.equal(all[0].title, '')
    assert.equal(all[0].url, 'https://first.example.com')
    assert.equal(all[0].visits, 2)
    assert.equal((await store.search('second.example')).length, 1)
    assert.equal(await store.updateTitle('https://first.example.com/private', 'Renamed'), true)
    assert.equal((await store.search('renamed')).length, 0)
    assert.equal(await store.remove(all[1].id), true)
    const restored = new BrowserHistoryStore({ file })
    assert.equal((await restored.search('')).length, 1)
    await restored.clear()
    assert.equal((await restored.search('')).length, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('browser history immediately rewrites legacy sensitive disk records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-history-'))
  try {
    const file = path.join(directory, 'history.json')
    await writeFile(file, JSON.stringify({ version: 1, entries: [{ id: 'legacy', url: 'https://example.com/reset/hunter2hunter2?q=alice@example.com&code=123456', title: 'alice@example.com code 123456', visitedAt: 10, visits: 1 }] }))
    const store = new BrowserHistoryStore({ file })
    const [entry] = await store.search('example')
    assert.equal(entry.url, 'https://example.com')
    assert.equal(entry.title, '')
    const migrated = await readFile(file, 'utf8')
    assert.doesNotMatch(migrated, /hunter2|alice|123456|reset/)
    assert.equal(JSON.parse(migrated).version, 2)

    await writeFile(file, JSON.stringify({ version: 2, entries: 'not-an-array', leakedAccount: 'alice@example.com' }))
    await new BrowserHistoryStore({ file }).search('')
    const scrubbed = await readFile(file, 'utf8')
    assert.doesNotMatch(scrubbed, /alice|leakedAccount|not-an-array/)
    assert.deepEqual(Object.keys(JSON.parse(scrubbed)).sort(), ['entries', 'version'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
