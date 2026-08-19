const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  ACTIONS,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
  SCHEMA_VERSION,
  SiteAuthorizationStore,
  boundedTtl
} = require('../electron/bridge/browser-site-authz.cjs')

function clock(start = 1_000_000) {
  let time = start
  return {
    now: () => time,
    advance: ms => { time += ms; return time }
  }
}

test('默认拒绝：未授权 origin/动作一律 false', () => {
  const store = new SiteAuthorizationStore({ now: clock().now })
  assert.equal(store.authorized('https://example.com', 'read'), false)
  assert.equal(store.authorized('https://example.com', 'type'), false)
  assert.equal(store.authorized('file:///etc', 'read'), false)
  assert.equal(store.authorized(null, 'read'), false)
  assert.equal(store.originGranted('https://example.com'), false)
  assert.deepEqual(store.actionsFor('https://example.com'), [])
  assert.equal(store.snapshot().count, 0)
})

test('按 origin 分权：不同动作独立授权，默认拒绝', () => {
  const c = clock()
  const store = new SiteAuthorizationStore({ now: c.now })
  store.grant('https://example.com', { actions: ['read', 'click'] })
  assert.equal(store.authorized('https://example.com', 'read'), true)
  assert.equal(store.authorized('https://example.com', 'click'), true)
  assert.equal(store.authorized('https://example.com', 'type'), false)
  assert.equal(store.authorized('https://example.com', 'upload'), false)
  assert.equal(store.authorized('https://example.com', 'download'), false)
  assert.equal(store.authorized('https://example.com', 'submit'), false)
  // 大小写与默认端口归一
  assert.equal(store.authorized('https://EXAMPLE.com:443', 'read'), true)
  // 其它 origin 完全无授权
  assert.equal(store.authorized('https://other.com', 'read'), false)
  const entry = store.entryOf('https://example.com')
  assert.deepEqual(entry.actions, ['click', 'read'])
  assert.equal(entry.origin, 'https://example.com')
})

test('授权参数校验：非法动作、非法 origin、空动作列表拒绝', () => {
  const store = new SiteAuthorizationStore()
  assert.throws(() => store.grant('https://example.com', { actions: ['sudo'] }), /未知的授权动作/)
  assert.throws(() => store.grant('https://example.com', { actions: [] }), /不能为空/)
  assert.throws(() => store.grant('file:///etc', { actions: ['read'] }), /http\/https/)
  assert.throws(() => store.grant('javascript:alert(1)', { actions: ['read'] }), /http\/https/)
})

test('TTL：过期后自动失效并被清理', () => {
  const c = clock()
  const store = new SiteAuthorizationStore({ now: c.now, defaultTtlMs: 60_000 })
  store.grant('https://example.com', { actions: ['read'], ttlMs: 60_000 })
  assert.equal(store.authorized('https://example.com', 'read'), true)
  c.advance(60_001)
  assert.equal(store.authorized('https://example.com', 'read'), false)
  assert.equal(store.origins().includes('https://example.com'), false)
  assert.equal(store.prune(), 0) // 已在上一步惰性清理
  assert.equal(store.snapshot().count, 0)
})

test('TTL 边界钳制：低于下限/高于上限被夹到合法区间', () => {
  const c = clock()
  const store = new SiteAuthorizationStore({ now: c.now })
  assert.equal(boundedTtl(1), 60_000) // 低于 1 分钟 → 下限
  assert.equal(boundedTtl(48 * 60 * 60 * 1000), 24 * 60 * 60 * 1000) // 超过 24h → 上限
  assert.equal(boundedTtl(-5), DEFAULT_TTL_MS)
  const entry = store.grant('https://example.com', { actions: ['read'], ttlMs: 999_999_999 })
  assert.equal(entry.expiresAt - entry.grantedAt, 24 * 60 * 60 * 1000)
})

test('撤销与整体撤销 revokeAll', () => {
  const c = clock()
  const store = new SiteAuthorizationStore({ now: c.now })
  store.grant('https://a.com', { actions: ['read'] })
  store.grant('https://b.com', { actions: ['read', 'type'] })
  assert.equal(store.revoke('https://a.com'), true)
  assert.equal(store.revoke('https://a.com'), false) // 二次撤销无效果
  assert.equal(store.snapshot().count, 1)
  assert.equal(store.revokeAll(), 1)
  assert.equal(store.snapshot().count, 0)
  assert.equal(store.originGranted('https://b.com'), false)
})

test('最大条目数：超限按 LRU 淘汰最旧', () => {
  const c = clock()
  const store = new SiteAuthorizationStore({ now: c.now, maxEntries: 3 })
  store.grant('https://a.com', { actions: ['read'] })
  c.advance(1000)
  store.grant('https://b.com', { actions: ['read'] })
  c.advance(1000)
  store.grant('https://c.com', { actions: ['read'] })
  c.advance(1000)
  store.grant('https://d.com', { actions: ['read'] }) // 挤掉 a.com
  assert.equal(store.snapshot().count, 3)
  assert.equal(store.originGranted('https://a.com'), false)
  assert.equal(store.originGranted('https://d.com'), true)
  // 重新授权刷新 LRU：重新授权 a.com 挤掉 b.com
  store.grant('https://a.com', { actions: ['read'] })
  assert.equal(store.originGranted('https://b.com'), false)
  assert.equal(store.originGranted('https://a.com'), true)
})

test('JSON 持久化：只存权限元数据，绝不落盘 Cookie/密码/token', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-authz-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'policy.json')
  const store = new SiteAuthorizationStore({ file, now: clock().now, defaultTtlMs: 60_000 })
  store.grant('https://example.com', { actions: ['read', 'type'], ttlMs: 60_000 })

  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.schemaVersion, SCHEMA_VERSION)
  // 落盘文件只允许 schemaVersion/entries 两个顶层键。
  assert.deepEqual(Object.keys(raw).sort(), ['entries', 'schemaVersion'])
  const entry = raw.entries['https://example.com']
  assert.deepEqual(entry.actions, ['read', 'type'])
  // 任何敏感键不得出现（Cookie/密码/token/body/contents 等）。
  const serialized = JSON.stringify(raw).toLowerCase()
  for (const needle of ['cookie', 'password', 'token', 'secret', 'authorization', 'bearer', 'session', 'value', 'body', 'content']) {
    assert.equal(serialized.includes(`"${needle}`), false, `策略文件不得包含 ${needle}`)
  }

  // 重新加载后授权仍有效（持久化 round-trip）。
  const reloaded = new SiteAuthorizationStore({ file, now: clock().now, defaultTtlMs: 60_000 })
  assert.equal(reloaded.authorized('https://example.com', 'read'), true)
  assert.equal(reloaded.authorized('https://example.com', 'type'), true)
  assert.equal(reloaded.authorized('https://example.com', 'submit'), false)
})

test('策略持久化迁移：v1 布尔授权自动升级为 v2 完整动作集', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-migrate-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'policy.json')
  const { writeFile } = require('node:fs/promises')
  await writeFile(file, JSON.stringify({
    schemaVersion: 1,
    origins: { 'https://legacy.com': true, 'file:///etc': true }
  }))

  const store = new SiteAuthorizationStore({ file, now: clock().now, defaultTtlMs: 60_000 })
  assert.equal(store.migratedOnLoad, true)
  // 合法 origin 迁移为全量动作授权。
  const entry = store.entryOf('https://legacy.com')
  assert.deepEqual(entry.actions, [...ACTIONS].sort())
  assert.equal(entry.origin, 'https://legacy.com')
  // 非 http/https origin 在迁移时被丢弃。
  assert.equal(store.originGranted('file:///etc'), false)

  // 迁移后文件已升级为 v2。
  const raw = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(raw.schemaVersion, 2)
  assert.ok(raw.entries['https://legacy.com'])
})

test('损坏/超限/未知结构的策略文件安全降级为空授权', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-corrupt-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const { writeFile } = require('node:fs/promises')

  for (const [name, content] of [
    ['garbage.json', '{ not json'],
    ['unknown-shape.json', JSON.stringify({ foo: [1, 2, 3] })],
    ['huge.json', 'x'.repeat(2 * 1024 * 1024)] // 超过体积上限 → 视为损坏
  ]) {
    const file = path.join(root, name)
    await writeFile(file, content)
    const store = new SiteAuthorizationStore({ file, now: clock().now })
    assert.equal(store.snapshot().count, 0, `${name} 应安全降级为空`)
    assert.equal(store.authorized('https://example.com', 'read'), false)
  }
})

test('内存模式（无 file）不落盘', () => {
  const store = new SiteAuthorizationStore({ now: clock().now })
  store.grant('https://example.com', { actions: ['read'] })
  assert.equal(store.originGranted('https://example.com'), true)
  assert.doesNotThrow(() => store.revokeAll())
})