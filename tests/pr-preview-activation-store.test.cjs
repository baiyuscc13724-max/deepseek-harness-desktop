const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PR_PREVIEW_ACTIVATION_SCHEMA_VERSION,
  PrPreviewActivationStore,
  normalizeActivationRecord
} = require('../electron/bridge/pr-preview-activation-store.cjs')

const HEAD_A = 'a'.repeat(40)
const HEAD_B = 'b'.repeat(40)
const HEAD_C = 'd'.repeat(40)

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

  assert.equal(first.schemaVersion, PR_PREVIEW_ACTIVATION_SCHEMA_VERSION)
  assert.deepEqual(first.history, [])
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
    ...candidate({ title: 'Metadata can be refreshed' })
  })
  assert.deepEqual(repeated, first)
  assert.deepEqual(memory.value(), first)
})

test('advances only to a higher sequence while preserving the first stable baseline and history', async () => {
  const memory = memoryStore()
  const first = await memory.store.capture({ baseline: baseline(), ...candidate() }, new Date('2026-08-25T09:00:00.000Z'))
  const advanced = await memory.store.capture({
    baseline: baseline('1.0.45-pr.27'),
    ...candidate({ sequence: 28, headSha: HEAD_B, releaseVersion: '1.0.46-pr.28' })
  }, new Date('2026-08-26T09:00:00.000Z'))

  assert.equal(advanced.capturedAt, first.capturedAt)
  assert.equal(advanced.baseline.releaseVersion, '1.0.44')
  assert.deepEqual(advanced.history, [first.candidate])
  assert.equal(advanced.candidate.sequence, 28)
  assert.equal(advanced.candidate.headSha, HEAD_B)

  await assert.rejects(() => memory.store.capture({
    baseline: baseline(),
    ...candidate({ sequence: 26, headSha: HEAD_C, releaseVersion: '1.0.46-pr.26' })
  }), /sequence 回退/)
  await assert.rejects(() => memory.store.capture({
    baseline: baseline(),
    ...candidate({ sequence: 28, headSha: HEAD_C, releaseVersion: '1.0.46-pr.28' })
  }), /相同 sequence 对应不同 head SHA/)
})

test('restores the exact previous activation after a failed forward stage or acceptance', async () => {
  const memory = memoryStore()
  const previous = await memory.store.capture({ baseline: baseline(), ...candidate() })
  await memory.store.capture({
    baseline: baseline('1.0.45-pr.27'),
    ...candidate({ sequence: 28, headSha: HEAD_B, releaseVersion: '1.0.46-pr.28' })
  })

  const restored = await memory.store.restore(previous)
  assert.deepEqual(restored, previous)
  assert.deepEqual(memory.value(), previous)

  await memory.store.restore(null)
  assert.equal(await memory.store.get(), null)
})

test('reconciles an unhealthy forward activation to the previous PR while retaining stable exit', async () => {
  const memory = memoryStore()
  await memory.store.capture({ baseline: baseline(), ...candidate() })
  await memory.store.capture({
    baseline: baseline('1.0.45-pr.27'),
    ...candidate({ sequence: 28, headSha: HEAD_B, releaseVersion: '1.0.46-pr.28' })
  })

  const previousPr = await memory.store.reconcileActive(baseline('1.0.45-pr.27'))
  assert.equal(previousPr.candidate.sequence, 27)
  assert.deepEqual(previousPr.history, [])
  assert.equal(previousPr.baseline.releaseVersion, '1.0.44')

  assert.equal(await memory.store.reconcileActive(baseline('1.0.44')), null)
  assert.equal(await memory.store.get(), null)
})

test('fails closed on an unknown active pointer without losing the stable rollback record', async () => {
  const memory = memoryStore()
  await memory.store.capture({ baseline: baseline(), ...candidate() })
  const before = memory.value()

  await assert.rejects(
    () => memory.store.reconcileActive(baseline('9.9.9')),
    /不属于当前 PR 预览、激活历史或稳定回滚点/
  )
  assert.deepEqual(memory.value(), before)

  const sameVersionUnknownPointer = baseline()
  sameVersionUnknownPointer.components[0].sha256 = 'e'.repeat(64)
  sameVersionUnknownPointer.components[0].directory = `desktop-shell-1.0.44-${'e'.repeat(16)}`
  await assert.rejects(
    () => memory.store.reconcileActive(sameVersionUnknownPointer),
    /不属于当前 PR 预览、激活历史或稳定回滚点/
  )
  assert.deepEqual(memory.value(), before)
})

test('migrates schema v1 records and validates preview identity', async () => {
  const migrated = normalizeActivationRecord({
    schemaVersion: 1,
    capturedAt: '2026-08-25T09:00:00.000Z',
    baseline: baseline(),
    candidate: candidate()
  })
  assert.equal(migrated.schemaVersion, PR_PREVIEW_ACTIVATION_SCHEMA_VERSION)
  assert.deepEqual(migrated.history, [])

  assert.throws(() => normalizeActivationRecord({
    schemaVersion: 1,
    capturedAt: '2026-08-25T09:00:00.000Z',
    baseline: null,
    candidate: { ...candidate(), releaseVersion: '1.0.45' }
  }), /prerelease/)
})
