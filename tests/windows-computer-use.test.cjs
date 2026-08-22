const test = require('node:test')
const assert = require('node:assert/strict')
const {
  WindowsComputerUse,
  classifySystemDeny,
  authorizeWindow,
  createKoffiWindowsAdapter,
  blankDetection,
  SYSTEM_PROCESS_NAMES
} = require('../electron/bridge/windows-computer-use.cjs')
const { ComputerUseAppPolicy } = require('../electron/bridge/computer-use-app-policy.cjs')

const A = 'a'.repeat(64)

function identity(overrides = {}) {
  return {
    pid: 4242,
    exePath: 'C:\\Program Files\\Demo\\demo.exe',
    exeName: 'demo.exe',
    program: '演示程序',
    product: '演示产品',
    publisher: '演示公司',
    aumid: null,
    fileHash: A,
    integrity: 'medium',
    elevated: false,
    signature: { verified: false },
    ...overrides
  }
}

// 假原生适配器：记录调用，绝不触碰真实用户应用。
function fakeAdapter(options = {}) {
  const calls = { clicks: [], scrolls: [], types: [], screenshots: [], binds: [] }
  const adapter = {
    calls,
    capabilities: () => ({
      platform: 'win32',
      koffi: true,
      windowEnumeration: true,
      identity: true,
      integrity: true,
      aumid: true,
      signatureVerification: true,
      signatureThumbprint: false,
      screenshot: true,
      input: true,
      ...options.capabilities
    }),
    listWindows: options.listWindows || (() => [{ hwnd: 7, pid: 4242, title: 'Demo Window', className: 'DemoClass', rect: { left: 0, top: 0, right: 640, bottom: 480 }, width: 640, height: 480 }]),
    identityFor: options.identityFor || (hwnd => ({ ...identity(), hwnd })),
    captureWindow: options.captureWindow || (() => ({ width: 2, height: 1, format: 'bgra', bgra: Buffer.alloc(8, 0xff), blank: false })),
    sendMouseClick: options.sendMouseClick || ((hwnd, params) => { calls.clicks.push({ hwnd, params }); return { delivered: true } }),
    sendScroll: options.sendScroll || ((hwnd, params) => { calls.scrolls.push({ hwnd, params }); return { delivered: true } }),
    sendText: options.sendText || ((hwnd, text) => { calls.types.push({ hwnd, text }); return { delivered: true } })
  }
  return adapter
}

test('classifySystemDeny 永久拒绝系统/UAC/提权/敏感窗口', () => {
  const cases = [
    ['consent.exe', 'uac-consent'],
    ['LogonUI.EXE', 'logon-ui'],
    ['fontdrvhost.exe', 'sensitive-input-host'],
    ['services.exe', 'system-process'],
    ['csrss.exe', 'system-process']
  ]
  for (const [exeName, code] of cases) {
    const deny = classifySystemDeny(identity({ exeName, integrity: 'medium', elevated: false }))
    assert.ok(deny, `${exeName} 应被拒绝`)
    assert.equal(deny.code, code)
    assert.equal(deny.nonBypassable, true)
  }
  assert.equal(classifySystemDeny(identity({ integrity: 'system' })).code, 'integrity-system')
  assert.equal(classifySystemDeny(identity({ integrity: 'high' })).code, 'elevated')
  assert.equal(classifySystemDeny(identity({ integrity: 'medium', elevated: true })).code, 'elevated')
  assert.equal(classifySystemDeny(identity(), { className: '#32770', title: 'User Account Control' }).code, 'uac-dialog')
  assert.equal(classifySystemDeny(identity(), { className: 'Credential Dialog Xaml Host' }).code, 'sensitive-window')
  assert.equal(classifySystemDeny(identity(), { className: 'Chrome_WidgetWin_1', title: 'Online Banking – Verification Code' }).code, 'sensitive-window')
  assert.equal(classifySystemDeny(identity(), { className: 'Chrome_WidgetWin_1', title: 'Checkout – Payment' }).code, 'sensitive-window')
  assert.equal(classifySystemDeny(identity()), null)
  assert.equal(classifySystemDeny(null).code, 'identity-unresolved')
})

test('authorizeWindow：系统禁令优先于任何持久授权（不可绕过）', () => {
  const policy = new ComputerUseAppPolicy({ config: { default_app_access: 'trusted' } })
  policy.allow(identity({ exeName: 'consent.exe' }))
  const decision = authorizeWindow(identity({ exeName: 'consent.exe' }), { policy })
  assert.equal(decision.status, 'denied')
  assert.equal(decision.nonBypassable, true)
  assert.equal(decision.code, 'uac-consent')
  // 普通应用在 trusted 默认档位下直接放行
  assert.equal(authorizeWindow(identity(), { policy }).status, 'allowed')
})

test('WindowsComputerUse 默认档位 untrusted：click 需要持久允许（无逐动作确认）', async () => {
  const adapter = fakeAdapter()
  const computer = new WindowsComputerUse({ adapter, hashFile: async () => A })
  const bound = await computer.bind(7)
  assert.equal(bound.authorization.status, 'untrusted')
  await assert.rejects(computer.click(7, { x: 1, y: 2 }), error => error.code === 'window-untrusted')
  await assert.rejects(computer.screenshot(7), error => error.code === 'window-untrusted')
  assert.equal(adapter.calls.clicks.length, 0)
  // 用户持久允许后可执行；逐动作确认属于上层门禁，本层不含
  computer.allow(bound.identity)
  await computer.click(7, { x: 10, y: 20 })
  assert.equal(adapter.calls.clicks.length, 1)
  assert.deepEqual(adapter.calls.clicks[0].params, { x: 10, y: 20, button: 'left' })
})

test('系统/提权窗口：即使已持久允许，动作仍被永久拒绝', async () => {
  const adapter = fakeAdapter()
  const computer = new WindowsComputerUse({ adapter, hashFile: async () => A })
  const elevatedIdentity = identity({ exeName: 'consent.exe', integrity: 'system' })
  computer.allow(elevatedIdentity)
  await assert.rejects(computer.click(9, { x: 1, y: 1 }, elevatedIdentity), error => {
    assert.equal(error.code, 'window-denied')
    assert.equal(error.systemCode, 'uac-consent')
    return true
  })
  assert.equal(adapter.calls.clicks.length, 0)
})

test('敏感输入永久拦截：即使应用已允许也不执行 type', async () => {
  const adapter = fakeAdapter()
  const computer = new WindowsComputerUse({ adapter, hashFile: async () => A })
  const bound = await computer.bind(7)
  computer.allow(bound.identity)
  await assert.rejects(computer.type(7, { text: 'password=p@ssw0rd123' }), error => error.code === 'sensitive-input-blocked')
  await assert.rejects(computer.type(7, { text: 'verification code: 123456' }), error => error.code === 'sensitive-input-blocked')
  assert.equal(adapter.calls.types.length, 0)
  await computer.type(7, { text: '普通文本没有风险' })
  await computer.type(7, { text: 'hello world' })
  assert.equal(adapter.calls.types.length, 2)
  assert.equal(adapter.calls.types[0].text, '普通文本没有风险')
})

test('能力缺失必须 capability-unavailable，绝不伪造', async () => {
  const noInput = fakeAdapter({ capabilities: { input: false } })
  const computer = new WindowsComputerUse({ adapter: noInput, hashFile: async () => A })
  const bound = await computer.bind(7)
  computer.allow(bound.identity)
  await assert.rejects(computer.click(7, { x: 0, y: 0 }), error => {
    assert.equal(error.code, 'capability-unavailable')
    assert.equal(error.capability, 'input')
    return true
  })
  await assert.rejects(computer.scroll(7, { deltaY: 50 }), error => error.code === 'capability-unavailable')

  const noEnum = fakeAdapter({ capabilities: { windowEnumeration: false } })
  const computer2 = new WindowsComputerUse({ adapter: noEnum, hashFile: async () => A })
  await assert.rejects(computer2.windows(), error => error.code === 'capability-unavailable')

  // 适配器为空（非 Windows 或无 koffi）时同样不可用
  const empty = new WindowsComputerUse({ adapter: null, hashFile: async () => A })
  assert.equal(empty.capabilities().native, null)
  await assert.rejects(empty.windows(), error => error.code === 'capability-unavailable')
})

test('截图与滚动委托适配器，并带身份快照', async () => {
  const adapter = fakeAdapter()
  const computer = new WindowsComputerUse({ adapter, hashFile: async () => A })
  const bound = await computer.bind(7)
  computer.allow(bound.identity)
  const shot = await computer.screenshot(7)
  assert.equal(shot.width, 2)
  assert.equal(shot.format, 'bgra')
  assert.equal(shot.identity.exePath, bound.identity.exePath)
  assert.equal(shot.identity.publisher, '演示公司')
  assert.equal('fileHash' in shot.identity, false) // 快照不含哈希，只含展示身份
  await computer.scroll(7, { deltaY: 120 })
  assert.equal(adapter.calls.scrolls.length, 1)
})

test('文件哈希缓存：同一 EXE 只哈希一次', async () => {
  let hashes = 0
  const adapter = fakeAdapter({
    identityFor: hwnd => ({ ...identity({ exePath: process.execPath, fileHash: null }), hwnd })
  })
  const computer = new WindowsComputerUse({
    adapter,
    hashFile: async () => { hashes += 1; return A },
    hashCacheSize: 8
  })
  const first = await computer.bind(1)
  const second = await computer.bind(1)
  assert.ok(first.identity.fileHash)
  assert.equal(second.identity.fileHash, first.identity.fileHash)
  assert.equal(hashes, 1)
})

test('blankDetection 识别纯色截图', () => {
  assert.equal(blankDetection(Buffer.alloc(4, 10), 1, 1), true)
  assert.equal(blankDetection(Buffer.from([10, 20, 30, 40]), 1, 1), false)
  assert.equal(blankDetection(null, 0, 0), true)
})

test('koffi 适配器工厂：非 Windows 返回 null；Windows 上能力探测可用且不触碰窗口', () => {
  const adapter = createKoffiWindowsAdapter()
  if (process.platform !== 'win32') {
    assert.equal(adapter, null)
    return
  }
  assert.ok(adapter)
  const caps = adapter.capabilities()
  assert.equal(caps.koffi, true)
  assert.equal(caps.platform, 'win32')
  // 必须能真实报告每项能力（true 或 false），且签名指纹明确标注不可用
  assert.equal(typeof caps.windowEnumeration, 'boolean')
  assert.equal(typeof caps.identity, 'boolean')
  assert.equal(typeof caps.screenshot, 'boolean')
  assert.equal(typeof caps.input, 'boolean')
  assert.equal(caps.signatureThumbprint, false)
  // 本测试不做任何窗口枚举/控制
  assert.ok(SYSTEM_PROCESS_NAMES.includes('consent.exe'))
})