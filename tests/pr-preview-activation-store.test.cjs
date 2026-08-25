const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PrPreviewActivationStore,
  normalizeActivationRecord
} = require('../electron/bridge/pr-preview-activation-store.cjs')

const HEAD_A = 'a'.repeat(40)
const HEAD_B = 'b'.repeat(40)

function baseline(version = '1.0.44') {
  const sha256 = 'c'.repeat(64)
  return {
    releaseVersion: version,
    components: [{
      id: 'desktop-shell',
      version,
      sha256,
      directory: `desktop-shell-${version}-${sha256.slice(0, 16)}`
    }]
  }
}

function candidate(overrides = {}) {
  return {
    prNumber: 27,
    title: 'Preview recovery',
    author: 'octocat',
    baseRef: 'main',
    sequence: 27,
    headSha: HEAD_A,
    releaseVersion: '1.0.45-pr.27',
    provider: 'cnb',
    ...overrides
  }
}

function memoryStore(initial = null) {
  let value = initial
  return {
    store: new PrPreviewActivationStore('C:\\component-updates', {
      readFileImpl: async () => {
        if (value === null) {
          const error = new Error('missing')
          error.code = 'ENOENT'
          throw error
        }
        return JSON.stringify(value)
      },
      atomicWriteImpl: async (_file, next) => { value = JSON.parse(JSON.stringify(next)) },
      rmImpl: async () => { value = null }
    }),
    value: () => value
  }
}

test('captures one stable rollback point for an exact preview candidate', async () => {
  const memory = memoryStore()
  const first = await memory.store.capture({
    baseline: baseline(),
    ...candidate()
  }, new Date('2026-08-25T09:00:00.000Z'))

  assert.equal(first.candidate.sequence, 27)
  assert.equal(first.candidate.headSha, HEAD_A)
  assert.equal(first.candidate.prNumber, 27)
  assert.equal(first.candidate.title, 'Preview recovery')
  assert.equal(first.candidate.provider, 'cnb')
  assert.equal(first.baseline.releaseVersion, '1.0.44')
  assert.equal(first.capturedAt, '2026-08-25T09:00:00.000Z')
  assert.deepEqual(await memory.store.get(), first)

  const repeated = await memory.store.capture({
    baseline: baseline('1.0.43'),
    ...candidate()
  })
  assert.deepEqual(repeated, first)
  assert.deepEqual(memory.value(), first)
})

test('allows bundled baseline and rejects replacing it with another candidate', async () => {
  const memory = memoryStore()
  const captured = await memory.store.capture({
    baseline: null,
    ...candidate({ sequence: 1, releaseVersion: '1.0.41-pr.1' })
  })
  assert.equal(captured.baseline, null)

  await assert.rejects(() => memory.store.capture({
    baseline: null,
    ...candidate({ sequence: 2, headSha: HEAD_B, releaseVersion: '1.0.41-pr.2' })
  }), /拒绝覆盖稳定回滚点/)
})

test('validates preview identity and clears the record', async () => {
  assert.throws(() => normalizeActivationRecord({
    schemaVersion: 1,
    capturedAt: '2026-08-25T09:00:00.000Z',
    baseline: null,
    candidate: { sequence: 1, headSha: HEAD_A, releaseVersion: '1.0.45' }
  }), /prerelease/)

  const memory = memoryStore()
  assert.equal(await memory.store.get(), null)
  await memory.store.capture({ baseline: null, ...candidate({ sequence: 1, releaseVersion: '1.0.45-pr.1' }) })
  await memory.store.clear()
  assert.equal(await memory.store.get(), null)
})
