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

  // 集成方上报当前活动标签（用户已在真实页面完成登录；之后可转入后台）。
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

test('模型可从后台空白标签打开预览，但读取与跨 origin 仍保持默认拒绝', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-bootstrap-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })

  const preview = policy.modelBootstrapNavigate('https://example.com/start?secret-query#fragment', {
    tabId: 'tab-blank', currentUrl: 'about:blank', visible: false, available: true
  })
  assert.equal(preview.origin, 'https://example.com')
  assert.equal(preview.previewOnly, true)
  assert.equal(policy.modelNavigate('https://example.com/next', { tabId: 'tab-blank' }).origin, 'https://example.com')
  assert.throws(() => policy.modelNavigate('https://other-site.com', { tabId: 'tab-blank' }), error => error.code === 'origin-not-authorized')
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-blank' }), error => error.code === 'permission-denied')
  assert.throws(() => policy.modelAction({ action: 'click', tabId: 'tab-blank' }), error => error.code === 'permission-denied')
  assert.throws(() => policy.modelBootstrapNavigate('https://example.com', { tabId: 'tab-blank', currentUrl: 'https://example.com', visible: true }), error => error.code === 'bootstrap-not-blank')
  assert.throws(() => policy.modelBootstrapNavigate('https://example.com', { tabId: 'tab-unavailable', currentUrl: 'about:blank', visible: false, available: false }), error => error.code === 'tab-unavailable')
  assert.throws(() => policy.modelBootstrapNavigate('http://127.0.0.1:4999', { tabId: 'tab-blank', currentUrl: 'about:blank', visible: true }), error => error.code === 'private-network-not-authorized')
  assert.throws(() => policy.modelNavigate('https://example.com/old-preview', { tabId: 'tab-blank' }), error => error.code === 'origin-not-authorized')

  policy.clearPendingControl()
  assert.throws(() => policy.modelBootstrapNavigate('http://127.0.0.1:4001/admin', {
    tabId: 'tab-local', currentUrl: 'about:blank', visible: true, trustedPrivateOrigins: ['http://127.0.0.1:4000']
  }), error => error.code === 'private-network-not-authorized')
  const managed = policy.modelBootstrapNavigate('http://127.0.0.1:4000/', {
    tabId: 'tab-local', currentUrl: 'about:blank', visible: true, trustedPrivateOrigins: ['http://127.0.0.1:4000']
  })
  assert.equal(managed.origin, 'http://127.0.0.1:4000')
  assert.equal(policy.modelNavigate('http://127.0.0.1:4000/chat', { tabId: 'tab-local' }).origin, managed.origin)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-local' }), error => error.code === 'permission-denied')

  const audit = JSON.stringify(policy.auditSnapshot())
  assert.equal(audit.includes('secret-query'), false)
  assert.equal(audit.includes('#fragment'), false)
  assert.match(audit, /navigate-preview/u)
  policy.pauseModelControl()
  assert.throws(() => policy.modelNavigate('http://127.0.0.1:4000/', { tabId: 'tab-local' }), error => error.code === 'stopped')
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

test('localhost 开发站点必须由用户显式授权，且授权精确绑定 origin', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-localhost-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.userNavigate('http://localhost:3000/app')
  policy.setActiveTab({ id: 'tab-local', origin: 'http://localhost:3000', visible: true })

  assert.throws(() => policy.grant('http://localhost:3000', { actions: ['read'] }), error => error.code === 'private-network-explicit-consent-required')
  assert.throws(() => policy.grant('http://localhost:3000', { actions: ['read'], allowPrivateNetwork: true, by: 'model' }), error => error.code === 'private-network-explicit-consent-required')
  policy.grant('http://localhost:3000', { actions: ['read'], allowPrivateNetwork: true, by: 'user' })
  assert.equal(policy.modelNavigate('http://localhost:3000/next', { tabId: 'tab-local' }).origin, 'http://localhost:3000')
  assert.equal(policy.modelAction({ action: 'read', tabId: 'tab-local', payload: { text: 'local dev page' } }).allowed, true)
  assert.throws(() => policy.modelNavigate('http://localhost:3001/other', { tabId: 'tab-local' }), error => error.code === 'private-network-not-authorized')
})

test('模型动作可作用于后台活动标签，同时保持 tabId/来源/可用性强校验', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-tab-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.grant(ORIGIN, { actions: ['read', 'submit'] })
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true, available: true })

  // 标签不一致。
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-2' }), error => error.code === 'tab-mismatch')
  // 声明来源伪造。
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1', declaredOrigin: 'https://evil.com' }), error => error.code === 'origin-mismatch')
  // 右栏隐藏后仍通过结构化通道操作同一后台标签。
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: false, available: true })
  assert.equal(policy.modelAction({ action: 'read', tabId: 'tab-1' }).allowed, true)
  // 宿主可在页面进程崩溃时将生产活动标签置为不可用、清空一次性确认并保留明确拒绝码。
  assert.equal(policy.modelAction({ action: 'submit', tabId: 'tab-1' }).requiresConfirmation, true)
  assert.equal(policy.pendingConfirmations().length, 1)
  assert.equal(policy.markActiveTabUnavailable('tab-2'), false)
  assert.equal(policy.markActiveTabUnavailable('tab-1'), true)
  assert.equal(policy.pendingConfirmations().length, 0)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'tab-unavailable')
  assert.ok(policy.auditSnapshot().entries.some(entry => entry.action === 'tab-unavailable' && entry.code === 'tab-unavailable'))
})

test('Profile 重置接管会清空活动标签和一次性确认但不越权改写授权', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-takeover-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.grant(ORIGIN, { actions: ['read', 'submit'] })
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })
  const pending = policy.modelAction({ action: 'submit', tabId: 'tab-1' })
  assert.equal(pending.requiresConfirmation, true)
  assert.equal(policy.pendingConfirmations().length, 1)
  assert.equal(policy.clearPendingControl(), true)
  assert.equal(policy.pendingConfirmations().length, 0)
  assert.equal(policy.authorizations().count, 1)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'no-active-tab')
})

test('完整 Profile 重置可清除全部浏览器策略审计元数据', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-clear-audit-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.userNavigate(ORIGIN)
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })
  policy.grant(ORIGIN, { actions: ['read'] })
  assert.ok(policy.auditSnapshot().count >= 3)
  const removed = policy.clearAudit()
  assert.ok(removed >= 3)
  assert.deepEqual(policy.auditSnapshot(), { maxEntries: 512, count: 0, total: 0, dropped: 0, stopped: false, entries: [] })
})

test('暂停模型控制不会停止用户浏览或审计，且只能由用户侧显式恢复', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hd-browser-model-pause-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = new BrowserSecurityPolicy({ authzRootDir: root })
  policy.grant(ORIGIN, { actions: ['read'] })
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })

  assert.deepEqual(policy.pauseModelControl(), { stopped: true, changed: true })
  assert.deepEqual(policy.pauseModelControl(), { stopped: true, changed: false })
  assert.equal(policy.isModelStopped, true)
  assert.equal(policy.isStopped, false)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'stopped')

  const userNavigation = policy.userNavigate('https://example.com/user-page')
  assert.equal(userNavigation.origin, ORIGIN)
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })
  assert.equal(policy.auditSnapshot().stopped, false)

  assert.deepEqual(policy.resumeModelControl(), { stopped: false, changed: true })
  assert.deepEqual(policy.resumeModelControl(), { stopped: false, changed: false })
  assert.equal(policy.isModelStopped, false)
  assert.equal(policy.modelAction({ action: 'read', tabId: 'tab-1' }).allowed, true)
  assert.ok(policy.auditSnapshot().entries.some(entry => entry.action === 'model-control-stop'))
  assert.ok(policy.auditSnapshot().entries.some(entry => entry.action === 'model-control-resume'))
})

test('Computer Use 共享授权只临时放行当前活动 origin（可见或后台），并保留浏览器硬门禁', () => {
  const policy = new BrowserSecurityPolicy()
  policy.setActiveTab({ id: 'tab-1', origin: ORIGIN, visible: true })

  assert.equal(policy.isUnifiedControlEnabled, false)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'permission-denied')

  assert.deepEqual(policy.setUnifiedControl(true), { enabled: true, changed: true })
  assert.equal(policy.authorizations().unifiedControl, true)
  assert.equal(policy.authorizations().count, 0, 'shared grant must not persist a second site authorization')
  assert.equal(policy.modelAction({ action: 'read', tabId: 'tab-1', payload: { text: '普通页面内容' } }).allowed, true)
  assert.equal(policy.modelNavigate(`${ORIGIN}/next`, { tabId: 'tab-1' }).origin, ORIGIN)
  assert.throws(() => policy.modelNavigate('https://other.example.net/', { tabId: 'tab-1' }), error => error.code === 'origin-not-authorized')
  assert.throws(() => policy.modelAction({
    action: 'type',
    tabId: 'tab-1',
    field: { tag: 'input', type: 'password', name: 'password' },
    payload: { text: 'still-forbidden' }
  }), error => error.code === 'sensitive-field')
  assert.equal(policy.modelAction({ action: 'submit', tabId: 'tab-1' }).requiresConfirmation, true)

  assert.deepEqual(policy.setUnifiedControl(false), { enabled: false, changed: true })
  assert.equal(policy.authorizations().count, 0)
  assert.throws(() => policy.modelAction({ action: 'read', tabId: 'tab-1' }), error => error.code === 'permission-denied')
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
