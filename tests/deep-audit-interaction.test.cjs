'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')
const sha = value => crypto.createHash('sha256').update(value).digest('hex')
const owned = ['electron/main.cjs', 'electron/preload.cjs', 'electron/guest-preload.cjs', 'electron/session-menu-preload.cjs', 'electron/desktop-tray.cjs', 'renderer/app.js', 'renderer/index.html', 'renderer/styles.css', 'renderer/modal-focus.js', 'renderer/theme-catalog.js', 'renderer/theme-integration.js', 'renderer/themes', 'renderer/pet', 'renderer/pets', 'electron/bridge/titlebar-appearance.cjs', 'electron/bridge/window-drag-service.cjs', 'electron/bridge/wallpaper-library.cjs', 'electron/bridge/wallpaper-service.cjs']
function walk(file) {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) return []
  if (fs.statSync(full).isDirectory()) return fs.readdirSync(full).flatMap(name => walk(`${file}/${name}`))
  return /\.(?:js|cjs|html|css|json)$/.test(file) && !file.includes('/vendor/') ? [file] : []
}
// Explicit opt-in artifact generation. No Electron, userData, network or OS clipboard.
if (process.argv.includes('--inventory')) {
  const report = path.join(root, 'docs/deep-audit/coverage-interaction.json')
  if (fs.existsSync(report)) throw new Error('Baseline already exists; refuse to replace modification-before evidence')
  const files = owned.flatMap(walk)
  const baseline = files.map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root, file))), bytes: fs.statSync(path.join(root, file)).size }))
  const entries = []
  for (const file of files.filter(file => !file.endsWith('.json'))) {
    const lines = source(file).split('\n')
    lines.forEach((text, index) => {
      if (/addEventListener\(|ipcMain\.(?:on|handle)\(|ipcRenderer\.(?:send|invoke)\(|label:\s*['"]|<(?:button|input|select|textarea)\b|\btabindex=/.test(text)) {
        entries.push({ id: `entry-${entries.length + 1}`, file, line: index + 1, entry: text.trim().slice(0, 600), status: 'unverified', normal: [], negative: [], switchingConcurrency: [], isolation: 'Inventory only; no runtime/user data accessed' })
      }
    })
  }
  const functions = [
    ['edit-copy','主窗口/guest/独立窗口：纯文本、富文本、选中正文复制'],
    ['edit-cut','可编辑剪切；只读/密码/禁用控件负例'],
    ['edit-paste','纯文本、富文本、图片粘贴；不可编辑/空剪贴板'],
    ['edit-plain-paste','粘贴为纯文本入口'],
    ['edit-images','右键复制图片/图片地址及粘贴图片'],
    ['edit-select','鼠标文本选择、全选、取消选择、Escape'],
    ['edit-history','撤销、重做及正确guest目标'],
    ['context-menu','主窗口/guest/独立窗口菜单、局部文件与外部链接'],
    ['shortcuts','Ctrl/Cmd、终端快捷键、自动重复、输入法合成'],
    ['focus-modal','Tab/Shift+Tab、层叠弹窗、恢复焦点、空弹窗、动态禁用'],
    ['window-drag','空白拖拽、文本保护、最大化/DPI、异常结束/销毁'],
    ['window-lifecycle','显示/隐藏/最小化/恢复/关闭/托盘/独立会话'],
    ['terminal-resize','鼠标/键盘调整、取消、焦点丢失与切换'],
    ['theme-switch','全部主题、official恢复、模式、减少动画/低性能'],
    ['theme-font','字体/颜色/范围参数、预览与持久化失败恢复'],
    ['wallpaper-library','图片/视频导入、预览、应用、取消、删除'],
    ['wallpaper-engine','当前项目/选择项目/搜索/手动导入/同步/不可用源'],
    ['wallpaper-lifecycle','park/resume顺序、快速切换、资源释放'],
    ['pet-controls','开关、喂食、自动喂食、置顶、主动陪伴、风格'],
    ['pet-gesture','单击、抚摸、拖拽、cancel、多指、窗口边缘'],
    ['pet-accessibility','键盘操作、焦点、屏幕阅读器及减少动画'],
    ['a11y-shell','可访问名称、焦点环、对比度、缩放、Tab顺序']
  ].map(([id, entry]) => ({ id, entry, status: 'unverified', normal: [], negative: [], switchingConcurrency: [], isolation: 'No live instance/real clipboard/account touched' }))
  const { execFileSync } = require('node:child_process')
  const diff = execFileSync(path.join(root, 'third_party/mingit/cmd/git.exe'), ['diff', '--', ...owned], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  fs.mkdirSync(path.dirname(report), { recursive: true })
  fs.writeFileSync(report, JSON.stringify({ schemaVersion: 1, phase: 'inventory-before-edits', sourceVersion: '1.0.60', runningVersion: '1.0.62', warning: 'Source changes do not update the running application. Inventory is not passing evidence.', baseline, preExistingDiffSha256: sha(diff), preExistingDiff: diff, functions, entries }, null, 2) + '\n')
  console.log(JSON.stringify({ baselineFiles: baseline.length, entries: entries.length, functionalGroups: functions.length, report }))
} else {
  // Tests are appended below; source is evaluated only with explicit in-memory fakes.
}

function extractFunction(file, name, next) {
  const text = source(file)
  let start = text.indexOf(`function ${name}(`)
  assert.ok(start >= 0, name)
  if (text.slice(start - 6, start) === 'async ') start -= 6
  const end = text.indexOf(`\n${next}`, start)
  assert.ok(end > start, next)
  return text.slice(start, end)
}
function loadFunction(file, name, next, globals = {}) {
  const text = extractFunction(file, name, next)
  return vm.runInNewContext(`${text}\n${name}`, globals)
}

if (!process.argv.includes('--inventory')) {
  test('baseline inventory explicitly records every source entry without claiming a pass', () => {
    const report = JSON.parse(source('docs/deep-audit/coverage-interaction.json'))
    assert.ok(report.entries.length > 300)
    assert.equal(report.functions.length, 22)
    assert.ok(report.baseline.some(item => item.file === 'electron/main.cjs'))
    assert.equal(sha(report.preExistingDiff), report.preExistingDiffSha256)
  })

  function menuFixture() {
    const calls = [], popups = [], writes = []
    const owner = { isDestroyed: () => false }
    const outer = { isDestroyed: () => false }
    const guest = { hostWebContents: {}, isDestroyed: () => false, executeJavaScript: async () => null }
    for (const name of ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll', 'copyImageAt']) guest[name] = function (...args) { assert.equal(this, guest); calls.push([name, ...args]) }
    const globals = {
      contextMenuRequests: new WeakMap(), BrowserWindow: { fromWebContents: () => owner }, mainWindow: outer,
      guestLocalTargetAtPoint: async () => null, resolveGuestLocalTarget: () => null,
      externalWebUrl: value => /^https?:\/\//.test(value || '') ? value : '',
      Menu: { buildFromTemplate: items => ({ popup: options => popups.push({ items, options }) }) },
      clipboard: { writeText: text => writes.push(text) },
      dialog: { showMessageBox: async () => { throw new Error('Unexpected dialog in isolated menu fixture') } },
      openRoutedBrowserLink: async () => {}, send: () => {}, openRightWorkspaceTarget: async () => {}
    }
    const show = () => loadFunction('electron/main.cjs', 'showGuestContextMenu', 'async function chooseWorkspaceDirectory', globals)
    return { calls, popups, writes, owner, guest, globals, show }
  }
  test('menus dispatch ALL editing operations to exact originating WebContents and owner', async () => {
    const f = menuFixture()
    await f.show()(f.guest, { isEditable: true, editFlags: { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true } })
    assert.equal(f.popups[0].options.window, f.owner)
    for (const item of f.popups[0].items.filter(item => item.click)) { assert.equal(item.enabled, true); item.click() }
    assert.deepEqual(f.calls.map(item => item[0]), ['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll'])
    f.guest.isDestroyed = () => true
    f.popups[0].items.find(item => item.label === '复制').click()
    assert.equal(f.calls.length, 7)
  })
  test('disabled edit flags and empty selection do not advertise enabled commands', async () => {
    const f = menuFixture()
    await f.show()(f.guest, { isEditable: true })
    assert.ok(f.popups[0].items.filter(item => item.click).every(item => item.enabled === false))
    await f.show()(f.guest, { isEditable: false, selectionText: '' })
    assert.equal(f.popups[1].items.find(item => item.label === '复制').enabled, false)
  })
  test('out-of-order context hit tests never reopen an earlier menu', async () => {
    const f = menuFixture(), pending = []
    f.globals.guestLocalTargetAtPoint = () => new Promise(resolve => pending.push(resolve))
    const show = f.show()
    const old = show(f.guest, { selectionText: 'old' })
    const next = show(f.guest, { selectionText: 'new' })
    pending[1](null); await next; pending[0](null); await old
    assert.equal(f.popups.length, 1)
  })
  test('window closure during awaited context lookup prevents menu popup', async () => {
    const f = menuFixture()
    f.globals.guestLocalTargetAtPoint = async () => { f.owner.isDestroyed = () => true; return null }
    await f.show()(f.guest, {})
    assert.equal(f.popups.length, 0)
  })
  test('public-page menu never executes local metadata and image action uses fake clipboard only', async () => {
    const f = menuFixture()
    f.globals.guestLocalTargetAtPoint = () => { throw new Error('Public page may not resolve workspace metadata') }
    await f.show()(f.guest, { mediaType: 'image', hasImageContents: true, x: 12.4, y: 18.7, srcURL: 'https://example.invalid/image.png' }, { allowLocal: false, ownerWindow: f.owner })
    f.popups[0].items.find(item => item.label === '复制图片').click()
    f.popups[0].items.find(item => item.label === '复制图片地址').click()
    assert.deepEqual(f.calls, [['copyImageAt', 12, 19]])
    assert.deepEqual(f.writes, ['https://example.invalid/image.png'])
  })

  const drag = require('../electron/bridge/window-drag-service.cjs')
  function dragWindow(maximized = false) {
    const positions = [], bounds = []
    return { positions, bounds, isDestroyed: () => false, isMaximized: () => maximized, getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }), getNormalBounds: () => ({ x: 0, y: 0, width: 600, height: 400 }), unmaximize() {}, setBounds: value => bounds.push(value), setPosition: (...value) => positions.push(value) }
  }
  test('drag rejects non-finite/string/null points and aborts a poisoned gesture', () => {
    for (const point of [null, {}, { x: Infinity, y: 0 }, { x: NaN, y: 0 }, { x: '10', y: 0 }]) {
      const w = dragWindow(); assert.equal(drag.beginWindowDrag(w, point, 'win32'), false); assert.equal(w.positions.length, 0)
    }
    const w = dragWindow(); drag.beginWindowDrag(w, { x: 10, y: 10 }, 'win32')
    assert.equal(drag.moveWindowDrag(w, { x: 0, y: Infinity }), false)
    assert.equal(drag.moveWindowDrag(w, { x: 20, y: 20 }), false)
  })
  test('drag restore bounds, window isolation and exactly-once termination', () => {
    const a = dragWindow(true), b = dragWindow()
    drag.beginWindowDrag(a, { x: 500, y: 100 }, 'win32'); drag.beginWindowDrag(b, { x: 0, y: 0 }, 'win32')
    assert.deepEqual(a.bounds[0], { x: 200, y: 50, width: 600, height: 400 })
    drag.moveWindowDrag(a, { x: 510, y: 110 }); drag.moveWindowDrag(b, { x: -10, y: -10 })
    assert.deepEqual(a.positions[0], [210, 60, false]); assert.deepEqual(b.positions[0], [-10, -10, false])
    assert.equal(drag.endWindowDrag(a), true); assert.equal(drag.endWindowDrag(a), false)
    assert.equal(drag.moveWindowDrag(a, { x: 0, y: 0 }), false)
    assert.equal(drag.beginWindowDrag(a, { x: 0, y: 0 }, 'linux'), false)
  })

  const modal = require('../renderer/modal-focus.js')
  function focusNode(values = {}) {
    return { tabIndex: 0, disabled: false, isConnected: true, nodeType: 1, getClientRects: () => [1], matches: () => false, closest: () => null, ...values }
  }
  test('modal Tab candidates exclude negative tabindex, inert, fieldset-disabled and hidden visibility', () => {
    const valid = focusNode(), first = focusNode({ tabIndex: 1 }), second = focusNode({ tabIndex: 2 })
    const candidates = [valid, focusNode({ tabIndex: -1 }), focusNode({ closest: () => ({ inert: true }) }), focusNode({ matches: () => true }), focusNode({ ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: 'hidden' }) } } }), second, first]
    assert.deepEqual(modal.collectFocusable({ querySelectorAll: () => candidates }), [first, second, valid])
  })
  test('modal boundary algorithm tests empty/outside/interior and both directions', () => {
    assert.equal(modal.shouldTrapTab(-1, 0, false), true)
    assert.equal(modal.boundaryNextIndex(-1, 0, false), -1)
    for (const shift of [false, true]) {
      assert.equal(modal.shouldTrapTab(-1, 3, shift), true)
      assert.equal(modal.shouldTrapTab(1, 3, shift), false)
      assert.equal(modal.shouldTrapTab(shift ? 0 : 2, 3, shift), true)
      assert.equal(modal.boundaryNextIndex(-1, 3, shift), shift ? 2 : 0)
    }
  })

  function browserScript(variable, parameters) {
    const line = source('electron/main.cjs').split('\n').find(line => line.includes(`const ${variable} = await runBrowserRefScript(view,`))
    assert.ok(line)
    const template = line.slice(line.indexOf('`'), line.lastIndexOf('`') + 1)
    return vm.runInNewContext(template, { parameters, value: parameters.value })
  }
  function domFixture() {
    class Input { constructor() { this.type = 'text'; this.isConnected = true; this.events = [] } dispatchEvent(e) { this.events.push(e.type) } focus() { this.focused = true } }
    Object.defineProperty(Input.prototype, 'value', { set(value) { if (!(this instanceof Input)) throw new TypeError('Illegal receiver'); this.saved = value } })
    class Textarea extends Input {}
    Object.defineProperty(Textarea.prototype, 'value', { set(value) { this.saved = value } })
    class Select extends Input { constructor() { super(); this.options = [] } }
    class Event { constructor(type) { this.type = type } }
    const refs = new Map()
    const context = { HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select, Event, InputEvent: Event, __HARNESS_BROWSER_REFS__: refs }
    return { Input, Textarea, Select, refs, context }
  }
  test('browser type behaves correctly for contenteditable, input and textarea without illegal setters', () => {
    const f = domFixture()
    for (const element of [new f.Input(), new f.Textarea(), { isContentEditable: true, isConnected: true, events: [], dispatchEvent(e) { this.events.push(e.type) }, focus() {} }]) {
      f.refs.set('r1', element)
      assert.equal(vm.runInNewContext(browserScript('typed', { ref: 'r1', text: '隔离 ordinary text' }), f.context), true)
      assert.equal(element.isContentEditable ? element.textContent : element.saved, '隔离 ordinary text')
      assert.deepEqual(element.events, ['input', 'change'])
    }
  })
  test('browser type revalidates disconnected/readonly/fieldset-disabled/file inputs at mutation boundary', () => {
    const f = domFixture()
    for (const patch of [{ isConnected: false }, { readOnly: true }, { disabled: true }, { matches: () => true }, { type: 'file' }, { type: 'checkbox' }]) {
      const element = Object.assign(new f.Input(), patch); f.refs.set('r1', element)
      assert.equal(vm.runInNewContext(browserScript('typed', { ref: 'r1', text: 'fixture' }), f.context), false)
      assert.equal(element.saved, undefined); assert.deepEqual(element.events, [])
    }
  })
  test('select rejects disabled option/group/control and picks exact value before matching label', () => {
    const f = domFixture(), element = new f.Select(); f.refs.set('s1', element)
    const run = value => vm.runInNewContext(browserScript('changed', { ref: 's1', value }), f.context)
    element.options = [{ text: 'same', value: 'other' }, { text: 'target', value: 'same' }]
    assert.equal(run('same'), true); assert.equal(element.selectedIndex, 1)
    for (const patch of [{ disabled: true }, { closest: () => ({ disabled: true }) }]) {
      element.options = [{ text: 'target', value: 'same', ...patch }]; element.events = []; element.selectedIndex = -1
      assert.equal(run('same'), false); assert.equal(element.selectedIndex, -1); assert.deepEqual(element.events, [])
    }
    element.disabled = true; assert.equal(run('same'), false)
  })
}

function petIpcFixture() {
  const calls = [], handles = new Map(), events = new Map()
  const owner = page => {
    const url = require('node:url').pathToFileURL(path.join(root, 'renderer', page)).href
    const frame = { url }, wc = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false }
    return { isDestroyed: () => false, webContents: wc }
  }
  const mainWindow = owner('index.html'), petWindow = owner('pet/index.html')
  const controller = { window: petWindow, quitting: false, ensure() { throw new Error('Sender validation must never create a window') } }
  for (const name of ['environment', 'moveTo', 'setInteractive', 'setHitProfile', 'focusMain']) controller[name] = (...args) => calls.push([name, ...args])
  const context = {
    path, URL, __dirname: path.join(root, 'electron'), pathToFileURL: require('node:url').pathToFileURL,
    mainWindow, petWindowController: controller,
    ipcMain: { handle: (key, value) => handles.set(key, value), on: (key, value) => events.set(key, value) },
    petPayload: () => calls.push(['state']), updatePetPreferences: patch => calls.push(['preferences', patch]),
    petDomain: { feed: kind => calls.push(['feed', kind]), interact: kind => calls.push(['interact', kind]) }
  }
  const text = source('electron/main.cjs')
  const guards = text.slice(text.indexOf('function isOwnedPageSender('), text.indexOf('function desktopShellOnly('))
  const registrations = text.slice(text.indexOf("ipcMain.handle('pet:getState'"), text.indexOf("ipcMain.handle('settings:openDocument'"))
  vm.runInNewContext(`${guards}\n${registrations}`, context)
  const event = win => ({ sender: win.webContents, senderFrame: win.webContents.mainFrame })
  return { calls, handles, events, mainWindow, petWindow, controller, event }
}

test('pet IPC registration rejects forged objects, subframes and navigated pages before any effect', () => {
  const f = petIpcFixture()
  const valid = f.event(f.petWindow)
  const bad = [{}, { ...valid, sender: { ...valid.sender } }, { ...valid, senderFrame: { ...valid.senderFrame } }]
  for (const event of bad) {
    for (const handler of f.handles.values()) assert.throws(() => handler(event), /只允许/)
    for (const handler of f.events.values()) assert.doesNotThrow(() => handler(event))
  }
  for (const url of ['https://example.invalid/', 'file:///wrong/index.html', f.petWindow.webContents.getURL() + '/extra']) {
    f.petWindow.webContents.mainFrame.url = url
    for (const handler of f.handles.values()) assert.throws(() => handler(valid), /只允许/)
  }
  assert.deepEqual(f.calls, [])
})

test('pet exact hidden owner and shell shared controls work; shell cannot move/hit-test and disposed pet cannot revive', () => {
  const f = petIpcFixture(), event = f.event(f.petWindow), shell = f.event(f.mainWindow)
  f.petWindow.webContents.mainFrame.url += '?fixture=yes#hidden'
  for (const handler of f.handles.values()) handler(event)
  for (const handler of f.events.values()) handler(event)
  for (const name of ['pet:getState', 'pet:setPreferences', 'pet:feed', 'pet:focusMain']) f.handles.get(name)(shell)
  for (const name of ['pet:getEnvironment', 'pet:moveTo', 'pet:interact']) assert.throws(() => f.handles.get(name)(shell), /只允许/)
  const count = f.calls.length
  f.controller.quitting = true
  for (const handler of f.handles.values()) assert.throws(() => handler(event), /只允许/)
  for (const handler of f.events.values()) handler(event)
  assert.equal(f.calls.length, count)
})

test('theme picker async success cannot steal focus or close a newer picker; failure stays recoverable', async () => {
  const { createSkinPickerHost } = require('../renderer/theme-integration.js')
  const calls = []
  const overlay = { classList: { add: value => calls.push(['add', value]), remove: value => calls.push(['remove', value]) }, setAttribute: (...args) => calls.push(args) }
  const picker = createSkinPickerHost({ overlay, trigger: { focus: () => calls.push(['focus']) }, closeSettingsDialog: () => calls.push(['closeSettings']) })
  let resolveOld
  picker.open({ fromSettings: true })
  const old = picker.apply(() => new Promise(resolve => { resolveOld = resolve }))
  picker.close(); picker.open()
  calls.length = 0
  resolveOld(true); await old
  assert.deepEqual(calls, [])
  await assert.rejects(picker.apply(() => Promise.reject(new Error('fixture failure'))), /fixture failure/)
  assert.deepEqual(calls, [])
  await picker.apply(() => false, Boolean); assert.deepEqual(calls, [])
  await picker.apply(() => true)
  assert.deepEqual(calls, [['add', 'hidden'], ['aria-hidden', 'true'], ['focus']])
})

test('pet engine preserves first pointer, rejects nonfinite/time-regressed events and cancels exactly once', () => {
  const { PetInteractionEngine } = require('../renderer/pet/pet-interaction-engine.js')
  const events = [], engine = new PetInteractionEngine({ onEvent: e => events.push(e.type) })
  const point = { pointerId: 1, x: 0, y: 0, at: 1, hotspot: 'head' }
  assert.equal(engine.begin({ ...point, x: NaN }), false)
  assert.equal(engine.begin(point), true)
  assert.equal(engine.begin({ ...point, pointerId: 2 }), false)
  assert.equal(engine.hold({ ...point, pointerId: 2, at: 300 }), false)
  assert.equal(engine.move({ ...point, at: 0, x: 100 }), null)
  assert.equal(engine.hold({ ...point, at: 300 }), true)
  assert.equal(engine.move({ ...point, at: 301, x: 2 }), 'petting')
  assert.equal(engine.end({ ...point, at: Infinity }), null)
  assert.equal(engine.cancel().type, 'cancel'); assert.equal(engine.cancel(), null)
  assert.deepEqual(events, ['press', 'pet-start', 'pet-move', 'cancel'])
  engine.begin(point); assert.equal(engine.end({ ...point, at: 2 }).type, 'tap')
  engine.begin(point); engine.move({ ...point, x: 70, at: 2 }); engine.move({ ...point, x: 80, at: 3 })
  assert.equal(engine.end({ ...point, x: 80, at: 4 }).type, 'drag-end')
})

function deviceCaptureFixture() {
  const handlers = new Map(), calls = []
  const frame = { url: 'file:///isolated/index.html' }
  const sender = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false }
  const context = {
    mainWindow: { isDestroyed: () => false, webContents: sender },
    assertLocalRuntimeSender: () => { throw new Error('Unowned') },
    ensureWindowsDesktopUi: () => ({ action: input => calls.push(input) }),
    DESKTOP_DEVICE_LEGACY_FILE_POLL: false, computerUseSessionGeneration: 1, computerUseEnabled: true,
    desktopDeviceProvider: { captureFrame: async () => ({ bytes: Buffer.from('fake png'), file: 'synthetic-frame' }), clearFrame: () => calls.push('clearFrame') },
    ensureComputerUsePreviewScreenshotStore: () => ({ clear: () => calls.push('clearStore') }),
    Buffer, readFile: async () => Buffer.from('fake png'), ipcMain: { handle: (key, handler) => handlers.set(key, handler) }
  }
  const text = source('electron/main.cjs')
  vm.runInNewContext(text.slice(text.indexOf("ipcMain.handle('desktopDevice:action'"), text.indexOf("ipcMain.handle('desktopAndroid:action'")), context)
  return { context, calls, sender, invoke: payload => handlers.get('desktopDevice:action')({ sender, senderFrame: frame }, { action: 'screenshot', payload }) }
}

test('desktop capture stop/restart and legacy read race reject stale result without clearing newer cache', async () => {
  for (const legacy of [false, true]) {
    const f = deviceCaptureFixture()
    if (legacy) f.context.readFile = async () => { f.context.computerUseSessionGeneration++; return Buffer.from('old') }
    else f.context.desktopDeviceProvider.captureFrame = async () => { f.context.computerUseSessionGeneration++; return { bytes: Buffer.from('old') } }
    await assert.rejects(f.invoke(legacy ? { fallbackReason: 'transfer-unavailable' } : {}), { code: 'computer-use-disabled' })
    assert.deepEqual(f.calls, [])
  }
})

test('desktop capture stops before disabled capture, rejects navigated/destroyed owner and preserves exact buffer range', async () => {
  const f = deviceCaptureFixture()
  f.context.computerUseEnabled = false
  f.context.desktopDeviceProvider.captureFrame = () => { throw new Error('Must not capture') }
  await assert.rejects(f.invoke({}), { code: 'computer-use-disabled' })
  f.context.computerUseEnabled = true
  f.context.desktopDeviceProvider.captureFrame = async () => { f.sender.mainFrame.url = 'https://example.invalid/'; return { bytes: Buffer.from('fake') } }
  await assert.rejects(f.invoke({}), { code: 'desktop-frame-stale' })
  f.context.desktopDeviceProvider.captureFrame = async () => ({ bytes: Buffer.from('xxPNGyy').subarray(2, 5) })
  const result = await f.invoke({})
  assert.equal(Buffer.from(result.bytes).toString(), 'PNG'); assert.equal(result.transport, 'array-buffer')
  f.context.desktopDeviceProvider.captureFrame = async () => { f.sender.isDestroyed = () => true; return { bytes: Buffer.from('fake') } }
  await assert.rejects(f.invoke({}), { code: 'desktop-frame-stale' })
})

function petRendererFixture() {
  const { PetInteractionEngine } = require('../renderer/pet/pet-interaction-engine.js')
  const calls = [], timers = new Map(), captures = new Set()
  const emitter = () => ({ handlers: new Map(), addEventListener(name, handler) { this.handlers.set(name, handler) }, dispatch(name, event = {}) { return this.handlers.get(name)?.(event) } })
  const character = Object.assign(emitter(), {
    dataset: {}, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
    focus: () => calls.push('focusCharacter'), getBoundingClientRect: () => ({ left: 5, top: 6 })
  })
  const document = emitter(), window = emitter(), focusButton = emitter(), feedButton = emitter(), tuckButton = emitter()
  focusButton.focus = () => calls.push('focusButton')
  const contextMenu = { hidden: true }
  const context = {
    PetInteractionEngine, character, document, window, focusButton, feedButton, tuckButton, contextMenu,
    environment: { bounds: { x: 0, y: 0 } }, dragging: null, petHoldTimer: null, state: {}, rig: null,
    rigHost: { querySelector: () => null }, performance: { now: () => 1 },
    setTimeout: handler => { const id = timers.size + 1; timers.set(id, handler); return id }, clearTimeout: id => timers.delete(id),
    behavior: { perform: (...args) => calls.push(['perform', ...args]), release: (...args) => calls.push(['release', ...args]) },
    api: { interact: value => { calls.push(['interact', value]); return Promise.resolve() }, focusMain: value => { calls.push(['focusMain', value]); return Promise.resolve() } },
    refreshEnvironment: async () => ({ bounds: { x: 0, y: 0 } }),
    hideContextMenu: () => { contextMenu.hidden = true }, showContextMenu: event => { event.preventDefault(); contextMenu.hidden = false },
    showSpeech: text => calls.push(['speech', text]), startFall: (...args) => calls.push(['fall', ...args]),
    finishDrag: () => { context.dragging = null }, syncWindowShape() {}, flushMove: (...args) => calls.push(['move', ...args]),
    interactionHotspot: () => 'head', interactionPoint: e => ({ pointerId: e.pointerId, x: e.screenX, y: e.screenY, at: e.at || 1, hotspot: 'head' }),
    dragSample() {}
  }
  const text = source('renderer/pet/pet.js')
  vm.runInNewContext(text.slice(text.indexOf('const interaction = new PetInteractionEngine('), text.indexOf('Promise.all([loadRig()')), context)
  const point = { pointerId: 1, screenX: 10, screenY: 10, button: 0, isPrimary: true }
  return { context, calls, timers, captures, character, document, window, contextMenu, point }
}

test('pet renderer pointer-up and blur invalidate pending environment; wrong pointer cannot cancel current gesture', async () => {
  const f = petRendererFixture(); f.context.environment = null
  let resolve
  f.context.refreshEnvironment = () => new Promise(r => { resolve = r })
  const down = f.character.dispatch('pointerdown', f.point)
  f.character.dispatch('pointerup', f.point)
  resolve({ bounds: { x: 0, y: 0 } }); await down
  assert.equal(f.context.dragging, null); assert.equal(f.timers.size, 0); assert.equal(f.captures.size, 0)
  f.context.environment = { bounds: { x: 0, y: 0 } }
  await f.character.dispatch('pointerdown', f.point)
  f.character.dispatch('pointercancel', { pointerId: 2 })
  assert.equal(f.context.dragging.pointerId, 1)
  await f.character.dispatch('pointerdown', { ...f.point, pointerId: 2 })
  assert.equal(f.context.dragging.pointerId, 1)
  f.window.dispatch('blur')
  assert.equal(f.context.dragging, null); assert.equal(f.timers.size, 0); assert.equal(f.captures.size, 0)
})

test('pet renderer keyboard click acts once, IME/repeat do not open menus and Escape restores focus', () => {
  const f = petRendererFixture()
  f.character.dispatch('click', { detail: 1 }); assert.equal(f.calls.length, 0)
  f.character.dispatch('click', { detail: 0 })
  assert.deepEqual(f.calls.filter(c => c[0] === 'interact'), [['interact', 'tap']])
  for (const patch of [{ isComposing: true }, { repeat: true }]) f.character.dispatch('keydown', { key: 'ContextMenu', ...patch })
  assert.equal(f.contextMenu.hidden, true)
  f.character.dispatch('keydown', { key: 'F10', shiftKey: true, preventDefault() {} })
  assert.equal(f.contextMenu.hidden, false); assert.ok(f.calls.includes('focusButton'))
  f.document.dispatch('keydown', { key: 'Escape', preventDefault() {} })
  assert.equal(f.contextMenu.hidden, true); assert.ok(f.calls.includes('focusCharacter'))
})

test('wallpaper failed validation only cleans owned temp and preserves concurrently created final', async () => {
  const { installManagedWallpaperCopy } = require('../electron/bridge/wallpaper-service.cjs')
  const removed = [], finalized = []
  await assert.rejects(installManagedWallpaperCopy({
    source: path.join(root, 'synthetic.png'), directory: path.join(root, 'synthetic-library'), fileName: 'wallpaper-fixture.png', expectedKind: 'image', maximumBytes: 100,
    beforeFinalize: () => { throw new Error('Concurrent final appeared') }
  }, {
    lstat: async file => { if (!file.endsWith('.tmp')) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return { isFile: () => true, size: 4 } },
    mkdir: async () => {}, copyFile: async () => {}, rename: async (...args) => finalized.push(args), unlink: async file => removed.push(file)
  }), /Concurrent final appeared/)
  assert.equal(removed.length, 1); assert.ok(removed[0].endsWith('.tmp')); assert.deepEqual(finalized, [])
})

test('wallpaper rename failure distinguishes large NTFS identities from another writer', async () => {
  const { installManagedWallpaperCopy } = require('../electron/bridge/wallpaper-service.cjs')
  for (const sameOwner of [true, false]) {
    const removed = [], identity = 90071992547409999n; let initial = true
    await assert.rejects(installManagedWallpaperCopy({ source: path.join(root, 'fake.webp'), directory: path.join(root, 'fake-library'), fileName: 'wallpaper-identity.webp', expectedKind: 'image', maximumBytes: 10 }, {
      lstat: async (file, options) => {
        if (initial) { initial = false; throw Object.assign(new Error('absent'), { code: 'ENOENT' }) }
        return { isFile: () => true, size: options?.bigint ? 4n : 4, ino: options?.bigint ? (file.endsWith('.tmp') || sameOwner ? identity : identity + 1n) : 0, dev: options?.bigint ? 1n : 1 }
      },
      mkdir: async () => {}, copyFile: async () => {}, rename: async () => { throw new Error('late rename') }, unlink: async file => removed.push(file)
    }), /late rename/)
    assert.equal(removed.length, sameOwner ? 2 : 1)
    assert.ok(removed[0].endsWith('.tmp'))
  }
})

test('terminal resize isolates pointer, clamps keys and removes every listener on cancel/blur/close', () => {
  const emitter = () => ({ listeners: new Map(), addEventListener(key, callback) { this.listeners.set(key, callback) }, removeEventListener(key, callback) { if (this.listeners.get(key) === callback) this.listeners.delete(key) } })
  const document = emitter(), window = Object.assign(emitter(), { innerHeight: 1000 }), values = []
  document.documentElement = { style: { setProperty: (...args) => values.push(args) } }
  const context = { document, window, terminalPanel: { getBoundingClientRect: () => ({ height: 300 }) }, terminalResizeCleanup: null, fitIntegratedTerminal() {} }
  const resize = loadFunction('renderer/app.js', 'beginTerminalResize', 'function officialSettingsBootstrap', context)
  const point = { type: 'pointerdown', button: 0, clientY: 400, pointerId: 1, preventDefault() {} }
  resize({ ...point, clientY: NaN }); assert.equal(document.listeners.size, 0)
  resize(point)
  document.listeners.get('pointermove')({ pointerId: 2, clientY: 0 }); assert.equal(values.length, 0)
  document.listeners.get('pointermove')({ pointerId: 1, clientY: 100 })
  assert.deepEqual(values[0], ['--terminal-panel-height', '600px'])
  document.listeners.get('pointercancel')({ pointerId: 2 }); assert.equal(document.listeners.size, 3)
  document.listeners.get('pointercancel')({ pointerId: 1 }); assert.equal(document.listeners.size, 0); assert.equal(window.listeners.size, 0)
  resize(point); window.listeners.get('blur')({}); assert.equal(document.listeners.size, 0)
  resize(point); context.terminalResizeCleanup(); assert.equal(document.listeners.size, 0)
  values.length = 0
  resize({ type: 'keydown', key: 'ArrowUp', isComposing: true }); assert.equal(values.length, 0)
  resize({ type: 'keydown', key: 'ArrowDown', preventDefault() {} }); assert.deepEqual(values[0], ['--terminal-panel-height', '276px'])
})

test('shell Escape closes only top modal and never dismisses during composition or key repeat', () => {
  const calls = [], modal = () => ({ getClientRects: () => [1], closest: () => null, contains(other) { return other === this } })
  const names = ['skinPicker', 'modelRouting', 'mobileSync', 'updateReady', 'updateNotice']
  const globals = { petPanel: { classList: { contains: () => false } }, petQuickButton: { focus: () => calls.push('petFocus') }, closePetPanel: () => calls.push('pet') }
  for (const name of names) { globals[`${name}Overlay`] = modal(); globals[`close${name[0].toUpperCase()}${name.slice(1)}`] = () => calls.push(name) }
  let active = [globals.skinPickerOverlay, globals.updateNoticeOverlay]
  globals.document = { querySelectorAll: () => active }
  const escape = loadFunction('renderer/app.js', 'handleShellEscape', "document.addEventListener('keydown', handleShellEscape)", globals)
  for (const patch of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true }]) escape({ key: 'Escape', ...patch })
  assert.deepEqual(calls, [])
  escape({ key: 'Escape', preventDefault() {} }); assert.deepEqual(calls, ['updateNotice'])
  active = [modal()]; escape({ key: 'Escape', preventDefault() {} }); assert.equal(calls.length, 1)
  active = []; escape({ key: 'Escape', preventDefault() {} }); assert.deepEqual(calls.slice(1), ['pet', 'petFocus'])
})

test('pet menu feed deduplicates pending requests, restores eligibility and catches every menu rejection', async () => {
  const f = petRendererFixture(), c = f.context
  c.state = { inventory: { standard: 2 }, fullness: 0 }
  let finish, feeds = 0
  c.api.feed = () => { feeds++; return new Promise(resolve => { finish = resolve }) }
  c.render = next => { c.state = next }
  const pending = c.feedButton.dispatch('click')
  await c.feedButton.dispatch('click'); assert.equal(feeds, 1)
  finish({ inventory: { standard: 0 }, fullness: 100 }); await pending
  assert.equal(c.feedButton.disabled, true)
  c.state = { inventory: { standard: 1 }, fullness: 0 }; c.feedButton.disabled = false
  c.api.feed = async () => { throw new Error('fixture feed failure') }
  await c.feedButton.dispatch('click'); assert.equal(c.feedButton.disabled, false)
  c.api.focusMain = async () => { throw new Error('fixture focus failure') }
  c.api.setAwake = async () => { throw new Error('fixture awake failure') }
  await c.focusButton.dispatch('click'); await c.tuckButton.dispatch('click')
  for (const word of ['feed failure', 'focus failure', 'awake failure']) assert.ok(f.calls.some(call => call[0] === 'speech' && call[1].includes(word)))
})

test('modal dynamic hidden/inert active control cannot retain or regain focus', () => {
  const safe = loadFunction('renderer/modal-focus.js', 'isSafeRestoreTarget', '    function onFocusIn', { isRenderedVisible: e => e.visible !== false })
  const node = { nodeType: 1, isConnected: true, disabled: false, ownerDocument: { defaultView: { getComputedStyle: e => ({ visibility: e.visibility || 'visible' }) } } }
  assert.equal(safe(node), true)
  for (const patch of [{ visibility: 'hidden' }, { visibility: 'collapse' }, { closest: () => ({ inert: true }) }, { visible: false }, { disabled: true }, { isConnected: false }]) assert.equal(safe({ ...node, ...patch }), false)
  let focused = 0
  const valid = { focus: () => focused++ }, doc = { activeElement: { ...node, visibility: 'hidden' } }
  const into = loadFunction('renderer/modal-focus.js', 'focusInto', '    function sync', { doc, collectFocusable: () => [valid], isSafeRestoreTarget: safe, ensureContainerFocusTarget() {} })
  into({ contains: () => true }); assert.equal(focused, 1)
})

// Opt-in report projection: preserve the immutable pre-edit hashes and diff.
// This is NOT a test runner receipt or a claim that source inventory is a pass.
if (process.argv.includes('--write-evidence')) {
  const reportPath = path.join(root, 'docs/deep-audit/coverage-interaction.json')
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  const testTitles = [...source('tests/deep-audit-interaction.test.cjs').matchAll(/^\s*test\('([^']+)'/gm)].map(match => match[1])
  const check = prefix => { const title = testTitles.find(title => title.startsWith(prefix)); if (!title) throw new Error(`Missing test: ${prefix}`); return `tests/deep-audit-interaction.test.cjs :: ${title}` }
  const operation = (id, group, entry, file, testPrefix, status = 'fixed', limitation = 'Only isolated source/DOM/IPC fixture; no real OS UI exercised') => ({
    id, group, entry, file, status, evidenceKind: 'isolated-behavior-fixture',
    normal: [check(testPrefix)], negative: [check(testPrefix)], switchingConcurrency: [],
    isolation: 'VM fakes only; no real Electron, clipboard, account, network or capability endpoints', accessibility: 'unverified unless explicitly described by this operation', limitation
  })
  const operations = []
  for (const [method, label, group] of [['undo','撤销','edit-history'],['redo','重做','edit-history'],['cut','剪切','edit-cut'],['copy','复制','edit-copy'],['paste','粘贴','edit-paste'],['pasteAndMatchStyle','粘贴为纯文本','edit-plain-paste'],['selectAll','全选','edit-select']]) {
    const item = operation(`command-${method}`, group, `${label}：菜单绑定原始WebContents而非当前焦点窗口`, 'electron/main.cjs', 'menus dispatch ALL')
    item.negative.push(check('disabled edit flags'))
    item.switchingConcurrency.push(check('out-of-order context'), check('window closure'))
    operations.push(item)
  }
  operations.push(operation('image-copy', 'edit-images', '复制图片坐标与图片URL；公共页不解析本地工作区元数据', 'electron/main.cjs', 'public-page menu'))
  for (const [id, group, label, file, prefix] of [
    ['context-late','context-menu','迟到命中测试不重开旧菜单','electron/main.cjs','out-of-order context'],
    ['context-close','context-menu','等待命中期间关闭窗口不弹菜单','electron/main.cjs','window closure'],
    ['window-invalid','window-drag','NaN/Infinity/字符串/空坐标拒绝并终止坏手势','electron/bridge/window-drag-service.cjs','drag rejects'],
    ['window-restore','window-drag','最大化恢复位置、双窗口隔离与结束幂等','electron/bridge/window-drag-service.cjs','drag restore'],
    ['focus-candidates','focus-modal','负tabindex/inert/fieldset/visibility剔除；正tabindex排序','renderer/modal-focus.js','modal Tab candidates'],
    ['focus-boundary','focus-modal','空弹窗/弹窗外/内部/双向Tab边界','renderer/modal-focus.js','modal boundary'],
    ['focus-hidden','focus-modal','动态隐藏/inert控件不保留也不恢复焦点','renderer/modal-focus.js','modal dynamic hidden'],
    ['browser-contenteditable','context-menu','contenteditable/input/textarea普通文本输入与事件','electron/main.cjs','browser type behaves'],
    ['browser-type-invalid','context-menu','断连只读禁用文件输入拒绝','electron/main.cjs','browser type revalidates'],
    ['browser-select','context-menu','select值优先；禁用option/optgroup拒绝','electron/main.cjs','select rejects'],
    ['pet-ipc-owner','pet-controls','所有pet IPC注册按真实WebContents+mainFrame+自身fileURL验证','electron/main.cjs','pet IPC registration'],
    ['pet-ipc-hidden','pet-controls','隐藏宠物合法；shell共用四入口；disposed无法复活','electron/main.cjs','pet exact hidden'],
    ['skin-picker-race','theme-switch','旧异步保存不能关闭新picker/设置或抢焦点；失败可继续','renderer/theme-integration.js','theme picker async'],
    ['pet-engine-pointer','pet-gesture','首指独占、时钟倒退、非法坐标、抚摸拖拽与cancel','renderer/pet/pet-interaction-engine.js','pet engine preserves'],
    ['desktop-capture-generation','window-lifecycle','截图Stop/重启/legacy读取迟到拒绝且不清新缓存','electron/main.cjs','desktop capture stop/restart'],
    ['desktop-capture-owner','window-lifecycle','禁用前不截图；导航/关闭后不回传；精确buffer范围','electron/main.cjs','desktop capture stops before'],
    ['pet-pending-up','pet-gesture','环境请求待定时pointerup/blur取消；不同指针不抢占','renderer/pet/pet.js','pet renderer pointer-up'],
    ['pet-keyboard','pet-accessibility','键盘click一次、ContextMenu/Shift+F10、Escape恢复焦点、IME重复保护','renderer/pet/pet.js','pet renderer keyboard'],
    ['wallpaper-validation-owner','wallpaper-library','复制或验证失败只清自身temp','electron/bridge/wallpaper-service.cjs','wallpaper failed validation'],
    ['wallpaper-rename-owner','wallpaper-library','rename迟到失败按精确bigint dev/ino清理；保留其他写者','electron/bridge/wallpaper-service.cjs','wallpaper rename failure'],
    ['terminal-resize-cancel','terminal-resize','鼠标/键盘resize、指针隔离、cancel/blur/close清理','renderer/app.js','terminal resize isolates'],
    ['escape-modal','shortcuts','Escape只关最上层；IME/repeat/defaultPrevented不关闭','renderer/app.js','shell Escape'],
    ['pet-menu-errors','pet-controls','喂食待定去重、恢复资格、休息/聚焦/喂食拒绝显示反馈','renderer/pet/pet.js','pet menu feed']
  ]) operations.push(operation(id, group, label, file, prefix))
  for (const [id, group, entry, reason] of [
    ['native-rich-copy','edit-copy','真实纯文本/HTML/RTF跨应用复制','No real clipboard or live user content permitted'],
    ['native-cut-password','edit-cut','原生密码/只读剪切与撤销边界','Native OS field handling not exercised'],
    ['native-paste-image','edit-paste','原生图片/富文本/空剪贴板粘贴','Clipboard formats need isolated Electron OS fixture; not run'],
    ['native-plain-paste','edit-plain-paste','格式去除后的真实剪贴板往返','Only dispatch to pasteAndMatchStyle is verified'],
    ['native-selection','edit-select','鼠标跨段落选择、方向键选择、双击三击','No rendered Electron selection fixture run'],
    ['native-history','edit-history','多级编辑历史撤销重做','Dispatch target tested; Chromium editor history not exercised'],
    ['native-shortcuts','shortcuts','Cmd/macOS与Windows全部编辑快捷键','Current host Windows; no macOS instance; native dispatch unverified'],
    ['native-window-tray','window-lifecycle','实际托盘单击双击、最小化恢复、退出、独立会话','Callback fixture is not actual OS/window lifecycle'],
    ['native-dpi','window-drag','混合DPI多屏拖拽与边界','Fake coordinates only; no native desktop input'],
    ['theme-visual-all','theme-switch','所有主题/模式/official恢复/低性能与减少动画视觉','Catalog and scoped behavior tested; no full rendered skin matrix'],
    ['theme-font-persist','theme-font','字体加载、颜色/范围保存失败与并发状态','Not behavior-tested end-to-end'],
    ['wallpaper-dialog-all','wallpaper-library','导入选择对话框、取消、预览/应用/删除完整UI','Service temp-file tests only; dialogs and codec visual output not exercised'],
    ['wallpaper-engine-live','wallpaper-engine','真实Steam/Wallpaper Engine当前项目与同步','Fake metadata only; no access to private installed library'],
    ['wallpaper-video-native','wallpaper-lifecycle','真实GPU视频park/resume资源与解码恢复','Existing sequence fixture passed; no native video/GPU process run'],
    ['pet-domain-all','pet-controls','自动喂食/陪伴/风格/库存/偏好全部组合','Native IPC callers tested; domain owned elsewhere and full UI not exercised'],
    ['pet-physics-all','pet-gesture','真实多屏边缘/攀爬/投掷/栖息动力学','Gesture fixture only; native physics integration not run'],
    ['screen-reader','pet-accessibility','屏幕阅读器读序/语音、减少动画渲染','Keyboard event fixture does not validate assistive technology'],
    ['shell-a11y-full','a11y-shell','所有设置可访问名称/对比度/200%缩放/布局','No full visual/assistive technology matrix']
  ]) operations.push({ id, group, entry, status: 'unverified', normal: [], negative: [], switchingConcurrency: [], isolation: reason, accessibility: 'unverified', limitation: reason })
  for (const item of operations) {
    if (/race|generation|pointer|cancel|owner|late|restore|ipc|menu-errors/.test(item.id) && item.status === 'fixed') item.switchingConcurrency = item.normal.slice()
  }
  const existingEvidence = {
    'focus-modal': ['tests/modal-focus.test.cjs: boundary/nested/empty/restore fixtures'],
    'window-lifecycle': ['tests/desktop-tray.test.cjs: all callbacks and source lifecycle contract'],
    'theme-switch': ['tests/theme-catalog.test.cjs', 'tests/theme-layout-ui.test.cjs'],
    'wallpaper-library': ['tests/wallpaper-service.test.cjs: temp media/quota/copy/rename/queue fixtures'],
    'wallpaper-engine': ['tests/wallpaper-library.test.cjs: fake metadata scan/profile/500+ items'],
    'wallpaper-lifecycle': ['tests/wallpaper-lifecycle.test.cjs: broadcast sequence and late replay'],
    'pet-gesture': ['tests/pet-interaction-engine.test.cjs', 'tests/pet-behavior-engine.test.cjs']
  }
  for (const group of report.functions) {
    const items = operations.filter(item => item.group === group.id)
    group.verifiedFacets = items.filter(item => item.status !== 'unverified').map(item => item.id)
    group.normal = [...new Set(items.flatMap(item => item.normal)), ...(existingEvidence[group.id] || [])]
    group.negative = [...new Set(items.flatMap(item => item.negative))]
    group.switchingConcurrency = [...new Set(items.flatMap(item => item.switchingConcurrency))]
    group.remaining = items.filter(item => item.status === 'unverified').map(item => ({ id: item.id, reason: item.limitation }))
    group.status = group.remaining.length ? 'unverified' : group.verifiedFacets.length ? 'fixed' : 'unverified'
    group.statusScope = 'Group-level end-to-end coverage; fixed operations below do not promote untested facets'
  }
  for (const entry of report.entries) {
    entry.status = 'unverified'
    entry.evidence = []
    entry.reason = 'Source entry inventory, not a standalone behavior test. Consult operation-scoped verified facets; no blanket file pass.'
    const lines = source(entry.file).split('\n')
    const found = lines.findIndex(line => line.trim().slice(0, 600) === entry.entry)
    entry.currentLine = found < 0 ? null : found + 1
  }
  report.currentEntries = []
  for (const file of owned.flatMap(walk).filter(file => !file.endsWith('.json'))) {
    source(file).split('\n').forEach((text, index) => {
      if (!/addEventListener\(|ipcMain\.(?:on|handle)\(|ipcRenderer\.(?:send|invoke)\(|label:\s*['"]|<(?:button|input|select|textarea)\b|\btabindex=/.test(text)) return
      const entry = text.trim().slice(0, 600)
      const baselineEntry = report.entries.find(item => item.file === file && item.entry === entry)
      report.currentEntries.push({ id: `current-entry-${report.currentEntries.length + 1}`, baselineTextMatch: baselineEntry?.id || null, file, line: index + 1, entry, status: 'unverified', normal: [], negative: [], switchingConcurrency: [], isolation: 'Source inventory only', reason: 'See operation-scoped evidence, never infer blanket pass' })
    })
  }
  report.phase = 'audited-with-explicit-gaps'
  report.statusDefinition = { pass: 'Named bounded assertion verified', fixed: 'Named bounded defect repaired with behavior regression', unverified: 'Missing evidence; not a passing functional verdict', blocked: 'Explicit external/environment gate', fail: 'Reproduced unresolved defect' }
  report.operations = operations
  report.currentSource = report.baseline.map(item => ({ file: item.file, sha256: sha(fs.readFileSync(path.join(root, item.file))), bytes: fs.statSync(path.join(root, item.file)).size }))
  report.evidenceLimits = ['Baseline entries and preExistingDiff are preserved. Current source can also contain other accepted work; no attribution by whole-file hash.', 'All 632 inventory entries remain unverified individually unless a bounded operation explicitly covers them.', 'Only isolated local fixtures executed; source version 1.0.60 changes do not update runtime 1.0.62.', 'No native clipboard, live app, account, service token, paid API or release action used.']
  report.regressionTests = testTitles
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ report: reportPath, baselineEntries: report.entries.length, operations: operations.length, regressionTests: testTitles.length }))
}
