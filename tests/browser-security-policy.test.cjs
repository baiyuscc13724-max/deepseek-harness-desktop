const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { BrowserSecurityPolicy } = require('../electron/bridge/browser-security-policy.cjs')
const { BROWSER_PARTITION, OFFICIAL_HARNESS_PARTITION } = require('../electron/bridge/browser-session-policy.cjs')
const { SCHEMA_VERSION } = require('../electron/bridge/browser-site-authz.cjs')

const ORIGIN = 'https://example.com'

test('端到端：用户导航 → 授权 → 模型操作 → 关键动作确认 → 撤销 → 停机', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const authzFile = path.join(root, 'policy.json')
  const policy = new BrowserSecurityPolicy({ authzFile, authzRootDir: root })

  // 固定独立分区，与官方隔离。
  assert.equal(policy.partitionName, BROWSER_PARTITION)
  assert.notEqual(policy.partitionName, OFFICIAL_HARNESS_PARTITION)
  assert.equal(BrowserSecurityPolicy.partitionName(), BROWSER_PARTITION)

  // 用户浏览：仅 http/https；用户可访问公网站点。
  const nav = policy.userNavigate('https://example.com/login')
  assert.equal(nav.origin, ORIGIN)
  assert.throws(() => policy.userNavigate('file:///C:/secret.txt'), error => error.code === 'scheme-blocked')
  assert.throws(() => policy.userNavigate('javascript:alert(1)'), error => error.code === 'scheme-blocked')

  // 集成方上报当前可见活动标签（用户已在真实页面完成登录）。
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })

  // 未授权时模型寸步难行。
  assert.throws(() => policy.modelNavigate('https://example.com/private', { tabId: 'tab-1' }), error => error.code === 'origin-not-authorized')
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'permission-denied')

  // 授权后模型可导航到该公网 origin。
  policy.grant(ORIGIN, { actions: ['read', 'click', 'type', 'submit', 'upload'] })
  const mnav = policy.modelNavigate('https://example.com/private', { tabId: 'tab-1' })
  assert.equal(mnav.origin, ORIGIN)

  // 模型读取普通内容放行。
  const read = policy.modelAction({ action: 'read', tabId: 'tab-1', payload: { text: '这是一段普通页面文本。' } })
  assert.equal(read.allowed, true)

  // 模型读取含敏感值的结果被拒。
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1', payload: { text: 'sessionid=AbCdEf123456' } }), error => error.code === 'sensitive-value')

  // 模型向密码字段输入被拒（永远禁止触碰登录凭据）。
  assert.throws(() => policy.modelAction({
    action: 'type', tabId: 'tab-1',
    field: { tag: 'input', type: 'password', name: 'password' },
    payload: { text: 'whatever' }
  }), error => error.code === 'sensitive-field')

  // 正常输入放行。
  const typed = policy.modelAction({
    action: 'type', tabId: 'tab-1',
    field: { tag: 'textarea', name: 'memo' },
    payload: { text: '记录：明天上午十点评审。' }
  })
  assert.equal(typed.allowed, true)

  // 关键动作（submit）必须人工确认。
  const first = policy.modelAction({ action: 'submit', tabId: 'tab-1' })
  assert.equal(first.requiresConfirmation, true)
  assert.ok(first.confirmationId)
  policy.confirm(first.confirmationId, { by: 'user' })
  const submitted = policy.modelAction({ action: 'submit', tabId: 'tab-1', confirmationId: first.confirmationId })
  assert.equal(submitted.allowed, true)

  // 未确认的关键动作不能执行。
  const second = policy.modelAction({ action: 'upload', tabId: 'tab-1', payload: { base64: Buffer.from('hello').toString('base64') } })
  assert.equal(second.requiresConfirmation, true)
  assert.throws(() => policy.modelAction({ action: 'upload', tabId: 'tab-1', payload: { base64: Buffer.from('hello').toString('base64') }, confirmationId: second.confirmationId }), error => error.code === 'confirmation-unconfirmed')

  // 审计只含元数据，绝不包含任何敏感内容。
  const snapshot = policy.auditSnapshot()
  const serialized = JSON.stringify(snapshot).toLowerCase()
  for (const needle of ['hunter2', 'secret123', 'sessionid', 'password=', 'cookie=', 'bearer ']) {
    assert.equal(serialized.includes(needle), false, `审计不得包含敏感内容：${needle}`)
  }

  // revokeAll：全部授权撤销，模型彻底失去访问权。
  const revoked = policy.revokeAll()
  assert.equal(revoked, 1)
  assert.throws(() => policy.modelNavigate('https://example.com/private', { tabId: 'tab-1' }), error => error.code === 'origin-not-authorized')

  // stop()：停机后一切操作拒绝，审计关闭但仍可读。
  const stopSnap = policy.stop()
  assert.equal(policy.isStopped, true)
  assert.equal(stopSnap.stopped, true)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'stopped')
  assert.throws(() => policy.grant(ORIGIN, { actions: ['read'] }), error => error.code === 'stopped')
  assert.throws(() => policy.userNavigate('https://example.com'), error => error.code === 'stopped')
  assert.throws(() => policy.confirm('whatever', { by: 'user' }), error => error.code === 'stopped')
  assert.equal(policy.auditSnapshot().stopped, true)

  // 停机后审计不再接受新记录。
  assert.throws(() => policy.auditLog.record({ actor: 'system', origin: ORIGIN, result: 'info' }), error => error.code === 'audit-stopped')

  // 策略文件只落盘权限元数据（v2）。
  const raw = JSON.parse(await readFile(authzFile, 'utf8'))
  assert.equal(raw.schemaVersion, SCHEMA_VERSION)
  assert.ok(!JSON.stringify(raw).includes('cookie') && !JSON.stringify(raw).includes('password'))
})

test('登录由用户在真实页面完成：模型结构上接触不到密码/Cookie', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-login-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })

  // 用户导航到银行登录页（用户档放行，用户亲自输入凭据）。
  policy.userNavigate('https://bank.example.com/login')
  policy.setActiveTab({ id: 'tab-bank', origin: 'https://bank.example.com', visible: true })

  // 模型连读取该标签都先要授权；即便授权，密码字段永远不可读/不可写。
  policy.grant('https://bank.example.com', { actions: ['read', 'type'] })
  assert.throws(() => policy.modelAction({
    action: 'read', tabId: 'tab-bank',
    field: { tag: 'input', type: 'password' }
  }), error => error.code === 'sensitive-field')
  assert.throws(() => policy.modelAction({
    action: 'type', tabId: 'tab-bank',
    field: { tag: 'input', type: 'password', name: 'bankPassword', autocomplete: 'current-password' },
    payload: { text: 'hunter2hunter2' }
  }), error => error.code === 'sensitive-field')

  // 模型无法伪装自己已登录：读取结果中出现 session 令牌即拒绝。
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-bank', payload: { text: 'sessionid=AbCdEf123456' } }), error => error.code === 'sensitive-value')

  // 审计中没有任何密码痕迹。
  assert.ok(!JSON.stringify(policy.auditSnapshot().entries).includes('hunter2'))
  assert.ok(!JSON.stringify(policy.auditSnapshot().entries).includes('AbCdEf123456'))
})

test('模型动作必须作用于当前可见活动标签（tabId/来源强校验）', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-tab-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.grant(ORIGIN, { actions: ['read'] })
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })

  // 标签不一致。
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-2' }), error => error.code === 'tab-mismatch')
  // 声明来源伪造。
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1', declaredOrigin: 'https://evil.com' }), error => error.code === 'origin-mismatch')
  // 无可见标签（如侧栏被隐藏）→ 模型不可操作。
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: false })
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'tab-not-visible')
})

test('未授权动作与未知动作给出可识别错误码，且审计有 denied 记录', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-deny-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })

  assert.throws(() => policy.modelAction({ action: 'delete', tabId: 'tab-1' }), error => error.code === 'permission-denied')
  assert.throws(() => policy.modelAction({ action: 'rm-rf', tabId: 'tab-1' }), error => error.code === 'unknown-action')

  const entries = policy.auditSnapshot().entries
  assert.ok(entries.some(e => e.result === 'denied' && e.code === 'permission-denied'))
  assert.ok(entries.some(e => e.result === 'denied' && e.code === 'unknown-action'))
  assert.ok(entries.every(e => !('text' in e) && !('cookie' in e) && !('token' in e)))
})