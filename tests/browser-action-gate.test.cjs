const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  CRITICAL_ACTIONS,
  MAX_DOWNLOAD_BYTES,
  MAX_TYPE_LENGTH,
  MAX_UPLOAD_BYTES,
  MODEL_ACTIONS,
  ActionGate,
  isSensitiveField,
  isSensitiveText,
  isValidBase64,
  normalizeField
} = require('../electron/bridge/browser-action-gate.cjs')

// 一组便于测试的授权桩（模拟 browser-site-authz 的鸭子类型接口）。
function authzStub(grants) {
  const map = new Map(Object.entries(grants || {}))
  return {
    authorized: (origin, action) => Boolean(map.get(origin)?.includes(action)),
    origins: () => [...map.keys()]
  }
}

function gateWith(grants, { visible = true, origin = 'https://example.com', id = 'tab-1', uploadRoots = [], downloadRoots = [] } = {}) {
  const gate = new ActionGate({ uploadRoots, downloadRoots })
  gate.setActiveTab({ id, origin, visible })
  return { gate, grants: authzStub(grants) }
}

test('敏感字段识别：密码/银行卡/验证码/令牌/API key/Cookie/Authorization 全命中', () => {
  const sensitiveCases = [
    { tag: 'input', type: 'password', name: 'pwd' },
    { tag: 'input', type: 'text', autocomplete: 'current-password' },
    { tag: 'input', type: 'text', name: 'cardNumber' },
    { tag: 'input', type: 'text', autocomplete: 'cc-number' },
    { tag: 'input', type: 'text', name: 'cvv' },
    { tag: 'input', type: 'text', ariaLabel: '验证码' },
    { tag: 'input', type: 'text', id: 'otp' },
    { tag: 'input', type: 'text', name: 'auth_token' },
    { tag: 'input', type: 'text', name: 'api_key' },
    { tag: 'textarea', name: 'secret' },
    { tag: 'input', type: 'text', label: '银行卡号' },
    { tag: 'input', type: 'text', name: 'cookie' },
    { tag: 'input', type: 'text', name: 'authorization' },
    { tag: 'input', type: 'text', name: 'bankAccount', role: 'textbox' },
    { tag: 'input', type: 'text', selector: '#login-token-input' },
    { tag: 'input', type: 'text', name: 'username' },
    { tag: 'input', type: 'email', name: 'contact' },
    { tag: 'button', role: 'button', label: '确认支付' }
  ]
  for (const field of sensitiveCases) {
    assert.equal(isSensitiveField(field), true, `应判定为敏感：${JSON.stringify(field)}`)
  }
  const safeCases = [
    { tag: 'input', type: 'text', name: 'displayName' },
    { tag: 'textarea', name: 'message' },
    { tag: 'input', type: 'checkbox', name: 'agree' },
    { tag: 'input', type: 'text', ariaLabel: '搜索' },
    { tag: 'button', role: 'button', label: '提交' },
    null
  ]
  for (const field of safeCases) {
    assert.equal(isSensitiveField(field), false, `不应判定为敏感：${JSON.stringify(field)}`)
  }
})

test('敏感值识别：密码、token、Cookie、卡号、Authorization 命中，普通文本放行', () => {
  assert.equal(isSensitiveText('password=hunter2hunter2'), true)
  assert.equal(isSensitiveText('api_key=sk-live-1234567890abcdef1234567890'), true)
  assert.equal(isSensitiveText('sessionid=AbCdEf123456'), true)
  assert.equal(isSensitiveText('Authorization: Bearer abcdefghij1234567890'), true)
  assert.equal(isSensitiveText('验证码: 123456'), true)
  assert.equal(isSensitiveText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), true)
  assert.equal(isSensitiveText('卡号 4111 1111 1111 1111'), true)
  assert.equal(isSensitiveText('今天天气不错，我们下午开会讨论发布计划。'), false)
  assert.equal(isSensitiveText(''), false)
})

test('活动标签门禁：无标签/标签隐藏/标签不一致一律拒绝', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['read'] })
  assert.throws(() => gate.gate({ action: 'read', tabId: 'tab-1' }), error => error.code === 'permission-denied') // 正常，见下方
  gate.clearActiveTab()
  assert.throws(() => gate.gate({ action: 'read', tabId: 'tab-1', authorizations: grants }), error => error.code === 'no-active-tab')

  const g1 = new ActionGate()
  g1.setActiveTab({ id: 'tab-1', origin: 'https://example.com', visible: false })
  assert.throws(() => g1.gate({ action: 'read', tabId: 'tab-1', authorizations: authzStub({ 'https://example.com': ['read'] }) }), error => error.code === 'tab-not-visible')

  const g2 = new ActionGate()
  g2.setActiveTab({ id: 'tab-1', origin: 'https://example.com', visible: true })
  assert.throws(() => g2.gate({ action: 'read', tabId: 'tab-2', authorizations: authzStub({ 'https://example.com': ['read'] }) }), error => error.code === 'tab-mismatch')
})

test('来源校验：declaredOrigin 与字段 baseUrl 必须等于活动标签 origin', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['read', 'type'] })
  // declaredOrigin 伪造 → 拒绝
  assert.throws(() => gate.gate({ action: 'read', tabId: 'tab-1', declaredOrigin: 'https://evil.com', authorizations: grants }), error => error.code === 'origin-mismatch')
  // 字段 baseUrl 伪造 → 拒绝
  assert.throws(() => gate.gate({ action: 'type', tabId: 'tab-1', field: { tag: 'input', type: 'text', baseUrl: 'https://evil.com' }, payload: { text: '你好' }, authorizations: grants }), error => error.code === 'origin-mismatch')
  // 不声明时以活动标签为准，正常通过
  const ok = gate.gate({ action: 'read', tabId: 'tab-1', authorizations: grants })
  assert.equal(ok.verdict, 'allow')
})

test('type 动作：敏感字段/敏感值/超长输入拒绝，普通输入放行', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['type'] })
  const common = { action: 'type', tabId: 'tab-1', authorizations: grants }

  // 敏感字段（密码输入框）→ sensitive-field
  assert.throws(() => gate.gate({ ...common, field: { tag: 'input', type: 'password' }, payload: { text: '123456' } }), error => error.code === 'sensitive-field')
  // 未指明字段 → missing-field
  assert.throws(() => gate.gate({ ...common, payload: { text: '你好' } }), error => error.code === 'missing-field')
  // 载荷内嵌密码/token/Cookie → sensitive-value
  assert.throws(() => gate.gate({ ...common, field: { tag: 'textarea', name: 'note' }, payload: { text: 'password=hunter2hunter2' } }), error => error.code === 'sensitive-value')
  assert.throws(() => gate.gate({ ...common, field: { tag: 'textarea', name: 'note' }, payload: { text: 'api_key=sk-live-1234567890abcdef1234567890' } }), error => error.code === 'sensitive-value')
  // 空文本 → empty-input
  assert.throws(() => gate.gate({ ...common, field: { tag: 'textarea', name: 'note' }, payload: { text: '' } }), error => error.code === 'empty-input')
  // 超长 → size-limit
  assert.throws(() => gate.gate({ ...common, field: { tag: 'textarea', name: 'note' }, payload: { text: 'a'.repeat(MAX_TYPE_LENGTH + 1) } }), error => error.code === 'size-limit')
  // 正常输入 → allow
  const ok = gate.gate({ ...common, field: { tag: 'textarea', name: 'note' }, payload: { text: '今天的会议纪要已完成。' } })
  assert.equal(ok.verdict, 'allow')
  // 缺少 type 授权 → permission-denied
  const { gate: g2 } = gateWith({ 'https://example.com': ['read'] })
  assert.throws(() => g2.gate({ action: 'type', tabId: 'tab-1', field: { tag: 'textarea', name: 'note' }, payload: { text: 'hi' }, authorizations: authzStub({ 'https://example.com': ['read'] }) }), error => error.code === 'permission-denied')
})

test('read 动作：敏感字段与含敏感值的读取结果拒绝', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['read'] })
  const common = { action: 'read', tabId: 'tab-1', authorizations: grants }
  assert.throws(() => gate.gate({ ...common, field: { tag: 'input', type: 'password' } }), error => error.code === 'sensitive-field')
  assert.throws(() => gate.gate({ ...common, payload: { text: 'Bearer abcdefghij1234567890' } }), error => error.code === 'sensitive-value')
  assert.throws(() => gate.gate({ ...common, payload: { text: 'x'.repeat(1024 * 1024 + 1) } }), error => error.code === 'size-limit')
  const ok = gate.gate({ ...common, payload: { text: '这是一段普通页面文本。' } })
  assert.equal(ok.verdict, 'allow')
})

test('click 动作：跨 origin 跳转目标必须公网且已授权', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['click'] }, { origin: 'https://example.com' })
  const common = { action: 'click', tabId: 'tab-1', authorizations: grants }

  const same = gate.gate({ ...common, payload: { navigatesTo: 'https://example.com/other' } })
  assert.equal(same.verdict, 'allow') // 同 origin ✓

  assert.throws(() => gate.gate({ ...common, payload: { navigatesTo: 'https://evil.com/x' } }), error => error.code === 'navigate-denied') // 未授权
  assert.throws(() => gate.gate({ ...common, payload: { navigatesTo: 'file:///etc/passwd' } }), error => error.code === 'navigate-denied') // 非法协议
  assert.throws(() => gate.gate({ ...common, payload: { navigatesTo: 'http://192.168.1.1/admin' } }), error => error.code === 'navigate-denied') // 内网

  const g2 = gateWith({ 'https://example.com': ['click'], 'https://docs.example.com': ['read'] }, { origin: 'https://example.com' })
  const cross = g2.gate.gate({ ...common, authorizations: g2.grants, payload: { navigatesTo: 'https://docs.example.com/guide' } })
  assert.equal(cross.verdict, 'allow') // 已授权公网目标 ✓
})

test('submit 表单目标与 click 一样必须经过跨 origin 导航授权', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['submit'] }, { origin: 'https://example.com' })
  const common = { action: 'submit', tabId: 'tab-1', authorizations: grants }

  assert.throws(
    () => gate.gate({ ...common, payload: { navigatesTo: 'https://evil.example/collect' } }),
    error => error.code === 'navigate-denied'
  )
  const request = gate.gate({ ...common, payload: { navigatesTo: 'https://example.com/feedback' } })
  assert.equal(request.verdict, 'confirm-required')
})

test('upload/download/submit/publish/delete 必须人工确认，且确认一次性有效', () => {
  const { gate, grants } = gateWith({
    'https://example.com': ['upload', 'download', 'submit']
  })
  assert.ok(CRITICAL_ACTIONS.has('upload') && CRITICAL_ACTIONS.has('download') && CRITICAL_ACTIONS.has('submit'))
  assert.ok(CRITICAL_ACTIONS.has('publish') && CRITICAL_ACTIONS.has('delete'))
  const base = { tabId: 'tab-1', authorizations: grants }

  // 首次发起：只返回待确认，不给放行。
  const first = gate.gate({ ...base, action: 'upload', payload: { base64: Buffer.from('hello').toString('base64') } })
  assert.equal(first.verdict, 'confirm-required')
  assert.ok(first.confirmationId)

  // 未确认就执行 → confirmation-unconfirmed
  assert.throws(() => gate.gate({ ...base, action: 'upload', payload: { base64: Buffer.from('hello').toString('base64') }, confirmationId: first.confirmationId }), error => error.code === 'confirmation-unconfirmed')

  // 用户确认。
  gate.confirm(first.confirmationId, { by: 'user' })
  // 再次确认 → confirmation-double
  assert.throws(() => gate.confirm(first.confirmationId, { by: 'user' }), error => error.code === 'confirmation-double')
  // 非用户确认 → confirmation-actor
  const second = gate.gate({ ...base, action: 'upload', payload: { base64: Buffer.from('hi').toString('base64') } })
  assert.throws(() => gate.confirm(second.confirmationId, { by: 'model' }), error => error.code === 'confirmation-actor')

  // 确认后执行成功，且确认一次性。
  const executed = gate.gate({ ...base, action: 'upload', payload: { base64: Buffer.from('hello').toString('base64') }, confirmationId: first.confirmationId })
  assert.equal(executed.verdict, 'allow')
  assert.throws(() => gate.gate({ ...base, action: 'upload', payload: { base64: Buffer.from('hello').toString('base64') }, confirmationId: first.confirmationId }), error => error.code === 'confirmation-used')

  // 确认请求绑定动作+origin+标签：换动作/换标签不匹配。
  const forSubmit = gate.gate({ ...base, action: 'submit' })
  assert.equal(forSubmit.verdict, 'confirm-required')
  gate.confirm(forSubmit.confirmationId, { by: 'user' })
  assert.throws(() => gate.gate({ ...base, action: 'upload', payload: { base64: Buffer.from('a').toString('base64') }, confirmationId: forSubmit.confirmationId }), error => error.code === 'confirmation-mismatch')

  // submit 同样需要确认。
  const submit2 = gate.gate({ ...base, action: 'submit' })
  assert.equal(submit2.verdict, 'confirm-required')
  gate.confirm(submit2.confirmationId, { by: 'user' })
  assert.equal(gate.gate({ ...base, action: 'submit', confirmationId: submit2.confirmationId }).verdict, 'allow')
})

test('交互式上传只批准原生选择器，禁止与路径或内容模式混用', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['upload'] })
  const base = { action: 'upload', tabId: 'tab-1', authorizations: grants }
  const payload = { interactivePicker: true }

  const request = gate.gate({ ...base, payload })
  assert.equal(request.verdict, 'confirm-required')
  assert.equal(request.action, 'upload')
  assert.deepEqual(gate.pendingConfirmations().map(item => ({ action: item.action, origin: item.origin, tabId: item.tabId })), [
    { action: 'upload', origin: 'https://example.com', tabId: 'tab-1' }
  ])
  assert.throws(() => gate.gate({ ...base, payload, confirmationId: request.confirmationId }), error => error.code === 'confirmation-unconfirmed')
  gate.confirm(request.confirmationId, { by: 'user' })
  assert.equal(gate.gate({ ...base, payload, confirmationId: request.confirmationId }).verdict, 'allow')
  assert.throws(() => gate.gate({ ...base, payload, confirmationId: request.confirmationId }), error => error.code === 'confirmation-used')

  for (const confused of [
    { interactivePicker: true, base64: Buffer.from('secret').toString('base64') },
    { interactivePicker: true, base64: '' },
    { interactivePicker: true, filePath: path.resolve('secret.txt') },
    { interactivePicker: true, filePath: undefined }
  ]) {
    assert.throws(() => gate.gate({ ...base, payload: confused }), error => error.code === 'upload-mode-conflict')
  }
  assert.throws(() => gate.gate({ ...base, payload: { interactivePicker: false } }), error => error.code === 'invalid-upload-mode')
})

test('交互式上传确认绑定完整 payload，确认后不能切换模式或换参', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['upload'] })
  const base = { action: 'upload', tabId: 'tab-1', authorizations: grants, field: { tag: 'input', type: 'file', baseUrl: 'https://example.com', backendNodeId: '41' } }
  const request = gate.gate({ ...base, payload: { interactivePicker: true } })
  gate.confirm(request.confirmationId, { by: 'user' })
  assert.throws(
    () => gate.gate({ ...base, payload: { interactivePicker: true, pickerKind: 'directory' }, confirmationId: request.confirmationId }),
    error => error.code === 'confirmation-mismatch'
  )
  assert.throws(
    () => gate.gate({ ...base, payload: { base64: Buffer.from('hello').toString('base64') }, confirmationId: request.confirmationId }),
    error => error.code === 'confirmation-mismatch'
  )
  assert.throws(
    () => gate.gate({ ...base, field: { ...base.field, backendNodeId: '42' }, payload: { interactivePicker: true }, confirmationId: request.confirmationId }),
    error => error.code === 'confirmation-mismatch'
  )
})

test('下载确认绑定规范化目标 URL，链接变化不能复用旧确认', () => {
  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-gate-download-'))
  const { gate, grants } = gateWith({ 'https://example.com': ['download'] }, { downloadRoots: [downloadRoot] })
  const basePayload = { destinationPath: path.join(downloadRoot, 'artifact.bin'), maxBytes: 1024, targetUrl: 'https://example.com/private/a' }
  const request = gate.gate({ action: 'download', tabId: 'tab-1', authorizations: grants, payload: basePayload })
  gate.confirm(request.confirmationId, { by: 'user' })
  assert.throws(
    () => gate.gate({ action: 'download', tabId: 'tab-1', authorizations: grants, payload: { ...basePayload, targetUrl: 'https://example.com/private/b' }, confirmationId: request.confirmationId }),
    error => error.code === 'confirmation-mismatch'
  )
})

test('确认请求 TTL 过期后不可用', () => {
  let time = 0
  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-gate-download-'))
  const downloadPayload = { destinationPath: path.join(downloadRoot, 'report.txt'), maxBytes: 1024 }
  const gate = new ActionGate({ now: () => time, confirmationTtlMs: 60_000, downloadRoots: [downloadRoot] })
  gate.setActiveTab({ id: 'tab-1', origin: 'https://example.com' })
  const grants = authzStub({ 'https://example.com': ['download'] })
  const req = gate.gate({ action: 'download', tabId: 'tab-1', authorizations: grants, payload: downloadPayload })
  assert.equal(req.verdict, 'confirm-required')
  time += 60_001
  assert.throws(() => gate.confirm(req.confirmationId, { by: 'user' }), error => error.code === 'confirmation-expired')
  assert.throws(() => gate.gate({ action: 'download', tabId: 'tab-1', authorizations: grants, payload: downloadPayload, confirmationId: req.confirmationId }), error => error.code === 'confirmation-expired')
})

test('大小与路径限制：upload base64 与下载目标硬上限', () => {
  const downloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-gate-download-'))
  const destinationPath = path.join(downloadRoot, 'artifact.zip')
  const { gate, grants } = gateWith({ 'https://example.com': ['upload', 'download'] }, { downloadRoots: [downloadRoot] })
  const base = { tabId: 'tab-1', authorizations: grants }

  const maxBase64 = Buffer.alloc(MAX_UPLOAD_BYTES).toString('base64')
  const req = gate.gate({ ...base, action: 'upload', payload: { base64: maxBase64 } })
  assert.equal(req.verdict, 'confirm-required')
  // 超上限但仍是合法 base64 → size-limit
  const tooBig = Buffer.alloc(MAX_UPLOAD_BYTES + 2).toString('base64')
  assert.throws(() => gate.gate({ ...base, action: 'upload', payload: { base64: tooBig } }), error => error.code === 'size-limit')
  assert.throws(() => gate.gate({ ...base, action: 'upload', payload: { base64: 'not!!base64' } }), error => error.code === 'invalid-base64')
  assert.throws(() => gate.gate({ ...base, action: 'upload', payload: {} }), error => error.code === 'empty-input')

  const dl = gate.gate({ ...base, action: 'download', payload: { destinationPath, maxBytes: MAX_DOWNLOAD_BYTES } })
  assert.equal(dl.verdict, 'confirm-required')
  assert.throws(() => gate.gate({ ...base, action: 'download', payload: { destinationPath, maxBytes: MAX_DOWNLOAD_BYTES + 1 } }), error => error.code === 'size-limit')
  assert.throws(() => gate.gate({ ...base, action: 'download', payload: { destinationPath: path.resolve('outside.zip'), maxBytes: 1 } }), error => error.code === 'file-path-denied')
  assert.throws(() => gate.gate({ ...base, action: 'download', payload: { destinationPath } }), error => error.code === 'size-required')
  assert.equal(isValidBase64(Buffer.from('x').toString('base64')), true)
  assert.equal(isValidBase64('abcde'), false)
})

test('未知动作与缺少授权拒绝', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['read'] })
  assert.throws(() => gate.gate({ action: 'rm -rf', tabId: 'tab-1', authorizations: grants }), error => error.code === 'unknown-action')
  assert.throws(() => gate.gate({ action: 'read', tabId: 'tab-1', authorizations: authzStub({}) }), error => error.code === 'permission-denied')
  // navigate 需要 origin 已授权（任意一项授权即可）。
  const { gate: gn } = gateWith({ 'https://example.com': ['read'] }, { id: 'tab-1' })
  const nav = gn.gate({ action: 'navigate', tabId: 'tab-1', authorizations: authzStub({ 'https://example.com': ['read'] }) })
  assert.equal(nav.verdict, 'allow')
  assert.throws(() => gn.gate({ action: 'navigate', tabId: 'tab-1', authorizations: authzStub({}) }), error => error.code === 'origin-not-authorized')
})

test('确认绑定具体载荷，页面描述不能把金融或账号操作伪装成普通动作', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['click', 'submit'] })
  const common = { tabId: 'tab-1', authorizations: grants }
  assert.throws(() => gate.gate({ ...common, action: 'click', field: { tag: 'button', label: '立即支付' } }), error => error.code === 'sensitive-field')
  assert.throws(() => gate.gate({ ...common, action: 'submit', payload: { accessibleName: '提交银行转账' } }), error => error.code === 'sensitive-action')

  const request = gate.gate({ ...common, action: 'submit', payload: { actionText: '提交普通反馈', itemId: 'a' } })
  gate.confirm(request.confirmationId, { by: 'user' })
  assert.throws(() => gate.gate({ ...common, action: 'submit', payload: { actionText: '提交普通反馈', itemId: 'b' }, confirmationId: request.confirmationId }), error => error.code === 'confirmation-mismatch')
})

test('账号值永久禁止读写', () => {
  const { gate, grants } = gateWith({ 'https://example.com': ['read', 'type'] })
  assert.equal(isSensitiveText('username=alice'), true)
  assert.equal(isSensitiveText('alice@example.com'), true)
  assert.throws(() => gate.gate({ action: 'type', tabId: 'tab-1', authorizations: grants, field: { tag: 'textarea', name: 'memo' }, payload: { text: 'alice@example.com' } }), error => error.code === 'sensitive-value')
})

test('normalizeField 安全折叠非字符串输入', () => {
  const f = normalizeField({ tag: 123, type: null, name: { x: 1 }, autocomplete: ['current-password'], ariaLabel: undefined })
  assert.equal(f.tag, '123')
  assert.equal(f.type, '')
  assert.equal(f.name, '[object Object]')
  assert.deepEqual(f.autocomplete, ['current-password'])
  assert.equal(isSensitiveField(f), true)
  assert.deepEqual([...MODEL_ACTIONS].sort(), ['click', 'delete', 'download', 'navigate', 'publish', 'read', 'submit', 'type', 'upload'])
})
