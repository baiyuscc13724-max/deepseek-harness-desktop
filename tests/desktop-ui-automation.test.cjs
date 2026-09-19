const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { WindowsDesktopUi, browserLike, safeBounds } = require('../electron/bridge/windows-desktop-ui.cjs')

function fixture(options = {}) {
  const calls = { selected: [], captures: 0, pointers: [], keyboards: [], inputOrder: [], stopped: 0, authorized: 0 }
  let selected = 'window:7'
  const control = { authorized: options.authorized !== false, generation: 1 }
  const provider = {
    status: () => ({ provider: 'windows-desktop', ready: control.authorized, generation: control.generation }),
    assertAuthorized() { if (!control.authorized) throw Object.assign(new Error('fixture shared control stopped'), { code: 'computer-use-stopped' }); return { generation: control.generation } },
    targets: async () => [
      { id: 'desktop', kind: 'desktop', label: 'Desktop', bounds: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'window:7', kind: 'window', label: 'Editor', bounds: { x: 10, y: 10, width: 100, height: 80 } }
    ],
    selectTarget: async id => { selected = id; calls.selected.push(id); return { id, kind: id === 'desktop' ? 'desktop' : 'window', label: id } },
    captureFrame: async () => { calls.captures += 1; return { target: { id: selected }, width: 100, height: 80 } },
    pointer: async (action, payload) => { calls.pointers.push({ action, payload }); return { completed: true, action } },
    keyboard: async text => { calls.inputOrder.push('keyboard'); calls.keyboards.push(text); return { completed: true, action: 'type' } },
    stop: async () => { calls.stopped += 1; control.authorized = false; control.generation += 1; return { ready: false } },
    authorize: async () => { calls.authorized += 1; return { requested: true } }
  }
  const controlSource = options.controlSource || {
    perform: async (action, raw) => {
      if (action !== 'type') return { handled: false }
      calls.inputOrder.push(`focus:${raw.name}`)
      return options.omitFocusReceipt ? { handled: false } : { handled: false, focused: true }
    },
    observe: async target => ({
      role: 'window', name: target.label, targetId: target.id, bounds: { x: 0, y: 0, width: 100, height: 80 },
      children: [
        { role: 'button', name: 'Save', targetId: target.id, bounds: { x: 10, y: 12, width: 20, height: 10 }, enabled: true, clickable: true },
        { role: 'textbox', name: 'Title', targetId: target.id, bounds: { x: 5, y: 30, width: 80, height: 20 }, editable: true }
      ]
    })
  }
  const ui = new WindowsDesktopUi({ provider, controlSource, browserControlAvailable: () => options.browserControlAvailable === true })
  return { ui, provider, calls, control }
}

test('observe 生成有界、代际失效的 opaque ref 控件树', async () => {
  const { ui } = fixture()
  await ui.selectTarget('window:7')
  const first = await ui.observe()
  assert.equal(first.nodeCount, 3)
  assert.match(first.root.ref, /^desktop-ui:1:/)
  assert.equal(first.root.children[0].name, 'Save')
  assert.equal(ui.inspect(first.root.children[0].ref).clickable, true)
  await ui.observe()
  assert.throws(() => ui.inspect(first.root.children[0].ref), error => error.code === 'desktop-ui-ref-stale')
})

test('ref click/type/scroll 优先结构化定位并路由到 provider', async () => {
  const { ui, calls } = fixture()
  await ui.selectTarget('window:7')
  const tree = await ui.observe()
  const save = tree.root.children[0]
  const title = tree.root.children[1]
  await ui.click(save.ref)
  assert.equal(calls.captures, 1)
  assert.deepEqual(calls.pointers[0], { action: 'click', payload: { x: 20, y: 17 } })
  await ui.type(title.ref, 'Draft')
  assert.deepEqual(calls.keyboards, ['Draft'])
  assert.deepEqual(calls.inputOrder, ['focus:Title', 'keyboard'], 'native focus receipt precedes provider input on the exact observed title field')
  await ui.scroll(tree.root.ref, -120)
  assert.deepEqual(calls.pointers[1], { action: 'scroll', payload: { x: 50, y: 40, deltaY: -120 } })
})

test('missing native focus receipt rejects input rather than typing into unknown focus', async () => {
  const { ui, calls } = fixture({ omitFocusReceipt: true })
  await ui.selectTarget('window:7')
  const tree = await ui.observe()
  await assert.rejects(ui.type(tree.root.children[1].ref, 'synthetic'), error => error.code === 'desktop-ui-focus-unverified')
  assert.deepEqual(calls.inputOrder, ['focus:Title'])
  assert.deepEqual(calls.keyboards, [])
  assert.deepEqual(calls.pointers, [], 'no coordinate fallback is allowed for failed focus')
})

test('controlSource 可直接处理结构化动作而不回退视觉坐标', async () => {
  const performed = []
  const controlSource = {
    observe: async () => ({ role: 'button', name: 'Run', targetId: 'window:7', bounds: { x: 0, y: 0, width: 20, height: 20 }, clickable: true }),
    perform: async (action, raw) => { performed.push({ action, name: raw.name }); return { handled: true, completed: true, via: 'uia' } }
  }
  const { ui, calls } = fixture({ controlSource })
  await ui.selectTarget('window:7')
  const tree = await ui.observe()
  assert.deepEqual(await ui.click(tree.root.ref), { handled: true, completed: true, via: 'uia' })
  assert.deepEqual(performed, [{ action: 'click', name: 'Run' }])
  assert.equal(calls.pointers.length, 0)
})

test('结构化 ref 拒绝向密码控件输入内容', async () => {
  const controlSource = {
    observe: async () => ({ role: 'edit', name: '', sensitive: true, targetId: 'window:7', bounds: { x: 0, y: 0, width: 100, height: 30 }, editable: true })
  }
  const { ui, calls } = fixture({ controlSource })
  await ui.selectTarget('window:7')
  const tree = await ui.observe()
  await assert.rejects(ui.type(tree.root.ref, 'secret'), error => error.code === 'desktop-ui-sensitive-input')
  assert.equal(calls.keyboards.length, 0)
})

test('浏览器控件在 browser_control 可用时拒绝桌面结构化旁路', async () => {
  const controlSource = {
    observe: async () => ({ role: 'browser', name: 'Web page', executable: 'chrome.exe', targetId: 'window:7', bounds: { x: 0, y: 0, width: 100, height: 80 }, clickable: true })
  }
  const { ui } = fixture({ controlSource, browserControlAvailable: true })
  await ui.selectTarget('window:7')
  const tree = await ui.observe()
  await assert.rejects(ui.click(tree.root.ref), error => error.code === 'browser-control-preferred' && error.preferredTool === 'browser_control')
  assert.equal(browserLike({ exeName: 'msedge.exe' }), true)
  assert.equal(browserLike({ role: 'button' }), false)
})

test('统一 action 接口覆盖目标、视觉兜底、授权和安全停止', async () => {
  const { ui, calls } = fixture()
  assert.equal((await ui.action({ action: 'targets' })).targets.length, 2)
  await ui.action({ action: 'selectTarget', target_id: 'window:7' })
  await ui.action({ action: 'screenshot' })
  await ui.action({ action: 'requestAuthorization' })
  const stopped = await ui.action({ action: 'stop' })
  assert.equal(stopped.ready, false)
  assert.equal(calls.authorized, 1)
  assert.equal(calls.stopped, 1)
  await assert.rejects(ui.action({ action: 'shell' }), error => error.code === 'desktop-action-unsupported')
})

test('safeBounds 只接受有限正尺寸', () => {
  assert.deepEqual(safeBounds({ left: 1, top: 2, right: 11, bottom: 22 }), { x: 1, y: 2, width: 10, height: 20 })
  assert.equal(safeBounds({ x: 0, y: 0, width: 0, height: 20 }), null)
})

test('内置插件公开独立 desktop scope 且保持 browser_control 优先', async () => {
  const plugin = await readFile(path.join(__dirname, '..', 'plugins', 'dsh-desktop-computer-use', 'lib', 'desktop-control.js'), 'utf8')
  assert.match(plugin, /name: 'desktop_control'/u)
  assert.match(plugin, /scope: 'desktop'/u)
  assert.match(plugin, /opaque ref actions/u)
  assert.match(plugin, /Web pages must use browser_control/u)
  assert.match(plugin, /exposes no shell or scripts/u)
})

test('共享授权拒绝inspect/perform；Stop后status不复活，恢复与目标更换使旧ref失效', async () => {
  const { ui, control, calls } = fixture()
  await ui.selectTarget('window:7')
  let tree = await ui.observe()
  const old = tree.root.children[0].ref
  await ui.action({ action: 'stop' })
  assert.equal((await ui.status()).ready, false)
  assert.throws(() => ui.inspect(old), error => error.code === 'computer-use-stopped')
  await assert.rejects(ui.click(old), error => error.code === 'computer-use-stopped')
  assert.equal(calls.pointers.length, 0)
  control.authorized = true; control.generation += 1
  assert.throws(() => ui.inspect(old), error => error.code === 'desktop-ui-ref-stale')
  tree = await ui.observe()
  await ui.selectTarget('desktop')
  await assert.rejects(ui.click(tree.root.children[0].ref), error => error.code === 'desktop-ui-ref-stale')
  assert.equal(calls.pointers.length, 0)
})

test('observe等待中共享generation或目标变化拒绝整棵旧树', async t => {
  for (const drift of ['stop', 'generation', 'target']) await t.test(drift, async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers()
    const fx = fixture({ controlSource: { observe: async () => { entered.resolve(); await release.promise; return { name: 'Stale tree', role: 'button', targetId: 'window:7' } } } })
    await fx.ui.selectTarget('window:7')
    const pending = fx.ui.observe()
    await entered.promise
    if (drift === 'stop') await fx.ui.action({ action: 'stop' })
    if (drift === 'generation') fx.control.generation += 1
    if (drift === 'target') await fx.ui.selectTarget('desktop')
    release.resolve()
    await assert.rejects(pending, error => ['computer-use-stopped', 'desktop-ui-ref-stale'].includes(error.code))
    assert.equal(fx.ui.refs.size, 0)
  })
})

test('UIA报告stale不回退旧坐标；预取消也不调用原生动作', async () => {
  let performed = 0
  const fx = fixture({ controlSource: {
    observe: async () => ({ role: 'button', name: 'Old', targetId: 'window:7', bounds: { x: 0, y: 0, width: 10, height: 10 } }),
    perform: async () => { performed += 1; return { handled: false, reason: 'stale' } }
  } })
  await fx.ui.selectTarget('window:7')
  const tree = await fx.ui.observe()
  const abort = new AbortController(); abort.abort()
  await assert.rejects(fx.ui.action({ action: 'click', ref: tree.root.ref }, { signal: abort.signal }), error => error.code === 'browser-action-cancelled')
  assert.equal(performed, 0)
  await assert.rejects(fx.ui.click(tree.root.ref), error => error.code === 'desktop-ui-ref-stale')
  assert.equal(performed, 1); assert.equal(fx.calls.pointers.length, 0); assert.equal(fx.calls.captures, 0)
})

test('perform/capture等待中Stop、generation、目标或observation变化禁止后续旧坐标输入', async t => {
  for (const stage of ['perform', 'capture']) for (const drift of ['stop', 'generation', 'target', 'observation']) await t.test(`${stage}/${drift}`, async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers()
    const fx = fixture()
    await fx.ui.selectTarget('window:7')
    const tree = await fx.ui.observe()
    const hold = async () => { entered.resolve(); await release.promise; return { handled: false } }
    if (stage === 'perform') fx.ui.controlSource.perform = hold
    else fx.provider.captureFrame = hold
    const pending = fx.ui.click(tree.root.children[0].ref)
    await entered.promise
    if (drift === 'stop') await fx.ui.action({ action: 'stop' })
    if (drift === 'generation') fx.control.generation += 1
    if (drift === 'target') await fx.ui.selectTarget('desktop')
    if (drift === 'observation') await fx.ui.observe()
    release.resolve()
    const settled = await pending.then(value => ({ value }), error => ({ error }))
    assert.equal(fx.calls.pointers.length, 0, 'stale coordinates must never reach provider.pointer')
    assert.ok(['computer-use-stopped', 'desktop-ui-ref-stale'].includes(settled.error?.code), settled.error?.stack || 'stale action unexpectedly succeeded')
  })
})
