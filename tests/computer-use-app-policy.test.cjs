const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const {
  ComputerUseAppPolicy,
  identityFingerprintFor,
  parseAppRule,
  normalizeDefaultAccess,
  DEFAULT_ACCESS_VALUES
} = require('../electron/bridge/computer-use-app-policy.cjs')

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

function identity(overrides = {}) {
  return {
    exePath: 'C:\\Program Files\\Demo\\demo.exe',
    exeName: 'demo.exe',
    program: '演示程序',
    product: '演示产品',
    publisher: '演示公司',
    aumid: null,
    fileHash: A,
    signature: { verified: false },
    ...overrides
  }
}

test('default_app_access 语义对齐 Codex：支持 allow/deny，并保留 ask 安全默认', () => {
  assert.equal(normalizeDefaultAccess('garbage'), 'untrusted')
  assert.equal(normalizeDefaultAccess('allow'), 'trusted')
  assert.equal(normalizeDefaultAccess('deny'), 'never')
  assert.equal(normalizeDefaultAccess('ask'), 'untrusted')
  assert.deepEqual(DEFAULT_ACCESS_VALUES, ['trusted', 'untrusted', 'never'])
  const untrusted = new ComputerUseAppPolicy()
  assert.equal(untrusted.decide(identity()).status, 'untrusted')
  assert.equal(untrusted.decide(identity()).reason, 'default-untrusted')

  const trusted = new ComputerUseAppPolicy({ config: { default_app_access: 'trusted' } })
  assert.equal(trusted.decide(identity()).status, 'allowed')
  assert.equal(trusted.decide(identity()).reason, 'default-trusted')

  const never = new ComputerUseAppPolicy({ config: { default_app_access: 'never' } })
  assert.equal(never.decide(identity()).status, 'denied')
  assert.equal(never.decide(identity()).reason, 'default-deny')
})

test('config allowlist 按 AUMID/EXE 规则静态匹配（aumids/exes/allowlist 三种写法）', () => {
  const policy = new ComputerUseAppPolicy({
    config: {
      aumids: ['Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'],
      exes: ['C:\\Program Files\\Node\\node.exe'],
      allowlist: [{ exe: 'notepad.exe' }]
    }
  })
  assert.equal(policy.decide(identity({ aumid: 'microsoft.windowscalculator_8wekyb3d8bbwe!app' })).status, 'allowed')
  assert.equal(policy.decide(identity({ exePath: 'c:\\program files\\node\\node.exe' })).status, 'allowed')
  assert.equal(policy.decide(identity({ exePath: 'C:\\Windows\\System32\\notepad.exe', exeName: 'notepad.exe' })).status, 'allowed')
  assert.equal(policy.decide(identity()).status, 'untrusted')
})

test('Codex Windows AUMID 与 publisher/product/binary allow/deny 规则', () => {
  const policy = new ComputerUseAppPolicy({
    config: {
      default_app_access: 'deny',
      windows: {
        aumids: {
          'Microsoft.Paint_8wekyb3d8bbwe!App': 'deny',
          'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App': 'allow'
        },
        exes: [
          { publisher_name: 'CN=Google LLC', product_name: 'Google Chrome', binary_name: 'chrome.exe', access: 'allow' },
          { publisher_name: 'Contoso', product_name: 'Admin Tool', access: 'deny' }
        ]
      }
    }
  })
  assert.equal(policy.decide(identity({ aumid: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' })).status, 'allowed')
  assert.equal(policy.decide(identity({ aumid: 'Microsoft.Paint_8wekyb3d8bbwe!App' })).status, 'denied')
  assert.equal(policy.decide(identity({ publisher: 'CN=Google LLC', product: 'Google Chrome', exeName: 'chrome.exe' })).status, 'allowed')
  assert.equal(policy.decide(identity({ publisher: 'CN=Google LLC', product: 'Google Chrome', exeName: 'other.exe' })).status, 'denied')
  assert.equal(policy.decide(identity({ publisher: 'Contoso', product: 'Admin Tool', exeName: 'admin.exe' })).status, 'denied')
  const chrome = policy.snapshot().allowlist.find(rule => rule.kind === 'windows-exe')
  assert.deepEqual({ publisher_name: chrome.publisher_name, product_name: chrome.product_name, binary_name: chrome.binary_name }, { publisher_name: 'CN=Google LLC', product_name: 'Google Chrome', binary_name: 'chrome.exe' })
})

test('denylist 优先于 allowlist 且持久（应用更新后依然拒绝）', () => {
  const policy = new ComputerUseAppPolicy()
  policy.deny(identity())
  policy.allow(identity())
  const decision = policy.decide(identity())
  assert.equal(decision.status, 'denied')
  assert.equal(decision.reason, 'denylist')
  // 身份变化（文件哈希改变）后 denylist 依然生效
  const changed = policy.decide(identity({ fileHash: B }))
  assert.equal(changed.status, 'denied')
  assert.equal(changed.identityChanged, true)
  assert.equal(changed.reason, 'denylist')
})

test('allow 授权绑定身份指纹：应用更新后旧允许自动失效（identity-change invalidation）', () => {
  const policy = new ComputerUseAppPolicy()
  policy.allow(identity())
  assert.equal(policy.decide(identity()).status, 'allowed')
  assert.equal(policy.decide(identity()).matchedBy.kind, 'windows-exe')
  const updated = policy.decide(identity({ fileHash: B }))
  assert.equal(updated.status, 'untrusted') // 回落默认档位
  assert.equal(updated.invalidated, true)
  assert.equal(updated.invalidatedRule, 'windows-exe:演示公司\n演示产品\ndemo.exe')
  // 再次以新指纹允许后才恢复
  policy.allow(identity({ fileHash: B }))
  assert.equal(policy.decide(identity({ fileHash: B })).status, 'allowed')
  assert.equal(policy.decide(identity()).status, 'untrusted')
})

test('已签名身份绑定 发布者+产品+证书指纹；指纹缺失时拒绝持久授权', () => {
  const signed = identity({
    signature: { verified: true, thumbprint: 'a'.repeat(40), thumbprintAvailable: true },
    publisher: 'Contoso',
    product: 'Contoso App'
  })
  const fp = identityFingerprintFor(signed)
  assert.equal(fp.kind, 'signed')
  assert.match(fp.fingerprint, /^[a-f0-9]{64}$/)

  const unsigned = identity()
  const ufp = identityFingerprintFor(unsigned)
  assert.equal(ufp.kind, 'unsigned')
  assert.match(ufp.fingerprint, /^[a-f0-9]{64}$/)
  // 大小写不敏感：路径大小写不同 → 同一指纹
  assert.equal(
    identityFingerprintFor(identity()).fingerprint,
    identityFingerprintFor(identity({ exePath: 'c:\\program files\\demo\\DEMO.EXE' })).fingerprint
  )

  const missingHash = identity({ fileHash: null })
  assert.equal(identityFingerprintFor(missingHash), null)
  const policy = new ComputerUseAppPolicy()
  assert.throws(() => policy.allow(missingHash), error => error.code === 'identity-unresolved')
})

test('allow/deny/setDefaultAccess/revoke 只接受真实用户操作', () => {
  const policy = new ComputerUseAppPolicy()
  const target = identity()
  assert.throws(() => policy.allow(target, { by: 'model' }), error => error.code === 'user-consent-required')
  assert.throws(() => policy.deny(target, { by: 'model' }), error => error.code === 'user-consent-required')
  assert.throws(() => policy.setDefaultAccess('trusted', { by: 'model' }), error => error.code === 'user-consent-required')
  assert.throws(() => policy.revoke({ exe: target.exePath }, { by: 'model' }), error => error.code === 'user-consent-required')
  policy.allow(target)
  const rule = { publisher_name: target.publisher, product_name: target.product, binary_name: target.exeName }
  assert.equal(policy.revoke(rule), true)
  assert.equal(policy.revoke(rule), false)
})

test('持久化：授权跨实例保留，且只落盘权限元数据', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'policy-'))
  const file = path.join(root, 'policy.json')
  try {
    let now = 1000
    const first = new ComputerUseAppPolicy({ file, now: () => now })
    const evil = identity({ exePath: 'C:\\Tools\\evil.exe', exeName: 'evil.exe', publisher: 'Bad Corp', product: 'Evil Tool', fileHash: B })
    first.setDefaultAccess('deny')
    first.allow(identity())
    first.deny(evil)
    now = 2000
    const second = new ComputerUseAppPolicy({ file, now: () => now })
    assert.equal(second.decide(identity()).status, 'allowed')
    assert.equal(second.decide(evil).status, 'denied')
    assert.equal(second.defaultAppAccess, 'never')
    // 不允许把任何普通文本/会话数据落盘（指纹是哈希，允许）
    const raw = await readFile(file, 'utf8')
    const persisted = JSON.parse(raw)
    assert.equal(persisted.default_app_access, 'deny')
    assert.equal(Object.hasOwn(persisted, 'defaultAppAccess'), false)
    assert.ok(persisted.windows.exes.some(rule => rule.publisher_name === '演示公司' && rule.product_name === '演示产品' && rule.binary_name === 'demo.exe' && rule.access === 'allow'))
    assert.ok(persisted.windows.exes.some(rule => rule.publisher_name === 'Bad Corp' && rule.product_name === 'Evil Tool' && rule.binary_name === 'evil.exe' && rule.access === 'deny'))
    const secret = '演示公司secret-value'
    assert.equal(raw.includes(secret), false)
    const snapshot = second.snapshot()
    assert.equal(snapshot.default_app_access, 'deny')
    assert.equal(typeof snapshot.defaultAppAccess, 'string')
    assert.ok(snapshot.allowlist.every(entry => /^[a-f0-9]{64}$/.test(entry.fingerprint)))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('损坏策略文件安全降级为空策略，不崩溃', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'policy-'))
  const file = path.join(root, 'policy.json')
  try {
    const { writeFile } = require('node:fs/promises')
    await writeFile(file, '{not json', 'utf8')
    const policy = new ComputerUseAppPolicy({ file })
    assert.equal(policy.decide(identity()).status, 'untrusted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('parseAppRule 形态判定：含分隔符/.exe → exe，否则 aumid', () => {
  assert.deepEqual(parseAppRule('notepad.exe'), { kind: 'exe', value: 'notepad.exe' })
  assert.deepEqual(parseAppRule('C:/Apps/x.exe'), { kind: 'exe', value: 'C:\\Apps\\x.exe' })
  assert.deepEqual(parseAppRule('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'), { kind: 'aumid', value: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' })
  assert.deepEqual(parseAppRule({ aumid: 'X!App' }), { kind: 'aumid', value: 'X!App' })
  assert.deepEqual(parseAppRule({ publisher_name: 'CN=Google LLC', product_name: 'Google Chrome', binary_name: 'chrome.exe' }), {
    kind: 'windows-exe', value: 'CN=Google LLC · Google Chrome · chrome.exe', publisherName: 'CN=Google LLC', productName: 'Google Chrome', binaryName: 'chrome.exe'
  })
  assert.equal(parseAppRule(null), null)
  assert.equal(parseAppRule('   '), null)
})