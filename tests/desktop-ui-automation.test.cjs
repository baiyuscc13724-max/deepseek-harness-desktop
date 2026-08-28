const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const path = require('node:path')
const { WindowsDesktopUi, browserLike, safeBounds } = require('../electron/bridge/windows-desktop-ui.cjs')

function fixture(options = {}) {
  const calls = { selected: [], captures: 0, pointers: [], keyboards: [], stopped: 0, authorized: 0 }
  let selected = 'window:7'
  const provider = {
    status: () => ({ provider: 'windows-desktop', ready: true }),
    targets: async () => [
      { id: 'desktop', kind: 'desktop', label: 'Desktop', bounds: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'window:7', kind: 'window', label: 'Editor', bounds: { x: 10, y: 10, width: 100, height: 80 } }
    ],
    selectTarget: async id => { selected = id; calls.selected.push(id); return { id, kind: id === 'desktop' ? 'desktop' : 'window', label: id } },
    captureFrame: async () => { calls.captures += 1; return { target: { id: selected }, width: 100, height: 80 } },
    pointer: async (action, payload) => { calls.pointers.push({ action, payload }); return { completed: true, action } },
    keyboard: async text => { calls.keyboards.push(text); return { completed: true, action: 'type' } },
    stop: async () => { calls.stopped += 1; return { ready: false } },
    authorize: async () => { calls.authorized += 1; return { requested: true } }
  }
  const controlSource = options.controlSource || {
    observe: async target => ({
      role: 'window', name: target.label, targetId: target.id, bounds: { x: 0, y: 0, width: 100, height: 80 },
      children: [
        { role: 'button', name: 'Save', targetId: target.id, bounds: { x: 10, y: 12, width: 20, height: 10 }, enabled: true, clickable: true },
        { role: 'textbox', name: 'Title', targetId: target.id, bounds: { x: 5, y: 30, width: 80, height: 20 }, editable: true }
      ]
    })
  }
  const ui = new WindowsDesktopUi({ provider, controlSource, browserControlAvailable: () => options.browserControlAvailable === true })
  return { ui, provider, calls }
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
  await ui.scroll(tree.root.ref, -120)
  assert.deepEqual(calls.pointers[1], { action: 'scroll', payload: { x: 50, y: 40, deltaY: -120 } })
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
