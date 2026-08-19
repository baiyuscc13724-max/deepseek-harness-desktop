const assert = require('node:assert/strict')
const test = require('node:test')

const {
  AUDIT_ENTRY_KEYS,
  BrowserAudit,
  safeText
} = require('../electron/bridge/browser-audit.cjs')

function makeAudit(maxEntries) {
  let time = 1_000
  return {
    audit: new BrowserAudit({ maxEntries, now: () => time }),
    tick: () => (time += 1_000)
  }
}

test('白名单投影：正文/Cookie/token/密码/输入值等字段从结构上不可能入库', () => {
  const { audit } = makeAudit()
  const entry = audit.record({
    actor: 'model',
    action: 'read',
    origin: 'https://example.com',
    tabId: 'tab-1',
    result: 'allowed',
    code: 'ok',
    message: '读取页面成功',
    // 以下字段无论怎么塞都不可能进入审计：
    text: '<html>页面正文 secret</html>',
    body: 'request-body',
    content: 'attachment-content',
    value: 'input-value',
    input: 'typed-text',
    selection: 'selected-text',
    cookie: 'session=cookie-value',
    token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.secret-sig',
    password: 'hunter2hunter2',
    authorization: 'Bearer abcdefghij1234567890',
    headers: { authorization: 'Bearer xyz' },
    data: { card: '4111 1111 1111 1111' },
    url: 'https://example.com/private?token=abc123'
  })
  for (const key of Object.keys(entry)) {
    assert.ok(AUDIT_ENTRY_KEYS.has(key) || key === 'ts' || key === 'result' || key === 'actor', `意外字段进入审计：${key}`)
    assert.ok(!['text', 'body', 'content', 'value', 'input', 'selection', 'cookie', 'token', 'password', 'authorization', 'headers', 'data', 'url'].includes(key))
  }
  // 字符串字段已脱敏、长度受限。
  assert.equal(entry.message, '读取页面成功')
  assert.equal(entry.origin, 'https://example.com')
  assert.equal(entry.tabId, 'tab-1')
  assert.equal(entry.result, 'allowed')
  // 恶意 message 中的敏感值会被脱敏为占位符。
  const bad = audit.record({ actor: 'model', action: 'type', origin: 'https://example.com', result: 'denied', code: 'sensitive-value', message: '输入包含 password=hunter2hunter2 敏感内容' })
  assert.ok(!JSON.stringify(bad).includes('hunter2'))
  assert.ok(JSON.stringify(bad).includes('[REDACTED:'))
})

test('有界队列：超出上限丢弃最旧记录', () => {
  const { audit, tick } = makeAudit(4)
  const times = []
  for (let i = 0; i < 10; i++) {
    times.push(audit.record({ actor: 'model', action: 'read', origin: 'https://example.com', result: 'allowed' }).ts)
    tick()
  }
  const snap = audit.snapshot()
  assert.equal(snap.count, 4)
  assert.equal(snap.total, 10)
  assert.equal(snap.dropped, 6)
  // 保留最新 4 条：第 7..10 次记录，最旧的 6 条被丢弃。
  assert.deepEqual(snap.entries.map(entry => entry.ts), times.slice(6))
  for (const entry of snap.entries) {
    assert.equal(entry.action, 'read')
    assert.equal(entry.origin, 'https://example.com')
  }
})

test('actor 校验与 fallback：未知 actor 折叠为 system', () => {
  const { audit } = makeAudit()
  const entry = audit.record({ actor: 'hacker', action: 'navigate', origin: 'https://example.com', result: 'denied' })
  assert.equal(entry.actor, 'system')
  audit.record({ actor: 'user', origin: 'https://example.com', result: 'info' })
  audit.record({ actor: 'model', origin: 'https://example.com', result: 'blocked' })
  const actors = new Set(audit.entriesCopy().map(e => e.actor))
  assert.deepEqual(actors, new Set(['system', 'user', 'model']))
})

test('origin 只记录 canonical origin，URL 上的 query/hash 令牌进不来', () => {
  const { audit } = makeAudit()
  audit.record({ actor: 'user', action: 'navigate', origin: 'https://example.com/path?token=secret123#frag', result: 'allowed' })
  const [entry] = audit.entriesCopy()
  assert.equal(entry.origin, 'https://example.com')
  assert.ok(!JSON.stringify(entry).includes('secret123'))
  // 非法 origin 不会进入审计（origin 键被安全丢弃）。
  audit.record({ actor: 'model', action: 'navigate', origin: 'file:///etc/passwd', result: 'denied' })
  const last = audit.entriesCopy().at(-1)
  assert.equal(last.origin, undefined)
  assert.ok(!JSON.stringify(last).includes('/etc/passwd'))
})

test('stop() 后不再接受记录，已有记录仍可读取；clear() 清空', () => {
  const { audit } = makeAudit()
  audit.record({ actor: 'user', origin: 'https://example.com', result: 'allowed' })
  const snap = audit.stop()
  assert.equal(snap.stopped, true)
  assert.throws(() => audit.record({ actor: 'user', origin: 'https://example.com', result: 'allowed' }), error => error.code === 'audit-stopped')
  assert.equal(audit.snapshot().count, 1) // 历史可读
  assert.equal(audit.clear(), 1)
  assert.equal(audit.snapshot().count, 0)
  assert.equal(audit.snapshot().total, 0)
  assert.equal(audit.snapshot().dropped, 0)
  assert.equal(audit.stop().stopped, true) // 幂等
})

test('safeText 长度受限且去除控制字符', () => {
  const text = safeText(`normal\u0000\u001f\u007fx内容`.repeat(200))
  assert.ok(text.length <= 500)
  assert.ok(!/[\u0000-\u001f\u007f]/.test(text))
  assert.equal(safeText(null), '')
})