const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {
  BROWSER_PARTITION,
  MAX_PARTITION_LENGTH,
  MAX_POLICY_PATH_LENGTH,
  OFFICIAL_HARNESS_PARTITION,
  assertIndependentPartition,
  assertSafePolicyPath,
  isOfficialPartition,
  isPersistentPartition,
  resolveBrowserPartition
} = require('../electron/bridge/browser-session-policy.cjs')

test('固定独立持久化分区名：不与官方 persist:harness 共用', () => {
  assert.equal(typeof BROWSER_PARTITION, 'string')
  assert.equal(resolveBrowserPartition(), BROWSER_PARTITION)
  // 固定值，前缀 persist:（落盘、跨重启保持），且与官方分区完全无关。
  assert.equal(BROWSER_PARTITION, 'persist:harness-side-browser')
  assert.equal(OFFICIAL_HARNESS_PARTITION, 'persist:harness')
  assert.notEqual(BROWSER_PARTITION, OFFICIAL_HARNESS_PARTITION)
  assert.equal(isOfficialPartition(BROWSER_PARTITION), false)
  assert.equal(isOfficialPartition(OFFICIAL_HARNESS_PARTITION), true)
  assert.equal(isPersistentPartition(BROWSER_PARTITION), true)
  // 命名上刻意避开官方名称路径，防止误共用。
  assert.ok(!BROWSER_PARTITION.includes('harness]'))
})

test('分区名校验：拒绝官方分区、内存态分区、非法输入', () => {
  assert.equal(assertIndependentPartition('persist:my-own-browser'), 'persist:my-own-browser')
  assert.throws(() => assertIndependentPartition(OFFICIAL_HARNESS_PARTITION), error => error.code === 'official-partition')
  assert.throws(() => assertIndependentPartition('harness'), error => error.code === 'official-partition')
  assert.throws(() => assertIndependentPartition('harness-side-browser'), error => error.code === 'invalid-partition') // 无 persist: 前缀
  assert.throws(() => assertIndependentPartition(''), error => error.code === 'invalid-partition')
  assert.throws(() => assertIndependentPartition(123), error => error.code === 'invalid-partition')
  assert.throws(() => assertIndependentPartition(`persist:${'x'.repeat(MAX_PARTITION_LENGTH)}`), error => error.code === 'invalid-partition')
  assert.throws(() => assertIndependentPartition('persist:a\\b'), error => error.code === 'invalid-partition')
  assert.throws(() => assertIndependentPartition('persist:a\u0000b'), error => error.code === 'invalid-partition')
  assert.equal(isPersistentPartition(BROWSER_PARTITION), true)
  assert.equal(isPersistentPartition('persist:'), false)
  assert.equal(isPersistentPartition('in-memory-name'), false)
})

test('策略文件路径安全：拒绝 URL、控制字符、越界路径', () => {
  const root = path.resolve('non-existent-policy-root')
  const policy = path.join(root, 'data', 'policy.json')
  assert.equal(assertSafePolicyPath(policy, { rootDir: root }), policy)
  assert.throws(() => assertSafePolicyPath('https://example.com/policy.json'), error => error.code === 'invalid-path')
  assert.throws(() => assertSafePolicyPath('file:///D:/policy.json'), error => error.code === 'invalid-path')
  assert.throws(() => assertSafePolicyPath(`${root}\u0000bad.json`), error => error.code === 'invalid-path')
  assert.throws(() => assertSafePolicyPath('~/policy.json'), error => error.code === 'invalid-path')
  assert.throws(() => assertSafePolicyPath(''), error => error.code === 'invalid-path')
  assert.throws(() => assertSafePolicyPath(path.resolve(root, '..', 'outside.json'), { rootDir: root }), error => error.code === 'path-escape')
  assert.throws(() => assertSafePolicyPath(path.join('..', 'outside.json'), { rootDir: root }), error => error.code === 'path-escape')
  assert.throws(() => assertSafePolicyPath(path.join(root, 'x', `${'y'.repeat(MAX_POLICY_PATH_LENGTH)}.json`)), error => error.code === 'invalid-path')
})