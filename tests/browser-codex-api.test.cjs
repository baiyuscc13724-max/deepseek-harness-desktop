const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.resolve(__dirname, '..')
const source = relative => readFile(path.join(root, relative), 'utf8')
const fixedEnvelope = value => ({ protocol: 'harness-fixed-playwright-v1', ok: true, value })

test('受限 Playwright API 仅公开固定操作与 CSS/role/text/frame 定位器参数', async () => {
  const api = await source('electron/bridge/browser-codex-api.cjs')
  const { PLAYWRIGHT_OPERATIONS, isSafeCssSelector } = require(path.join(root, 'electron/bridge/browser-codex-api.cjs'))

  assert.deepEqual(PLAYWRIGHT_OPERATIONS, [
    'domSnapshot', 'count', 'isVisible', 'isEnabled', 'innerText', 'textContent',
    'getAttribute', 'click', 'dblclick', 'fill', 'press', 'pressSequentially',
    'selectOption', 'setChecked'
  ])
  for (const kind of ['css', 'role', 'text']) assert.match(api, new RegExp(`['\"]${kind}['\"]`), `missing selector kind ${kind}`)
  for (const parameter of ['selector', 'selector_kind', 'name', 'frame_selector']) assert.match(api, new RegExp(parameter), `missing bounded locator parameter ${parameter}`)
  assert.match(api, /frame_selector[\s\S]{0,500}(?:iframe|frame)/u)
  assert.match(api, /browser-playwright-operation-unsupported/u)
  assert.equal(isSafeCssSelector('main > button.primary'), true)
  assert.equal(isSafeCssSelector('#workspace .card'), true)
  assert.equal(isSafeCssSelector('input[value^="a"]'), false)
  assert.equal(isSafeCssSelector('div:has(input)'), false)
})

test('受限 Playwright API 从参数结构上拒绝任意脚本与敏感 selector/属性探测', async () => {
  const api = await source('electron/bridge/browser-codex-api.cjs')
  const { normalizePlaywrightParameters } = require(path.join(root, 'electron/bridge/browser-codex-api.cjs'))

  assert.throws(() => normalizePlaywrightParameters({ operation: 'click', selector: 'button', script: 'alert(1)' }), error => error.code === 'browser-playwright-script-forbidden')
  assert.throws(() => normalizePlaywrightParameters({ operation: 'click', selector: 'button', evaluate: 'alert(1)' }), error => error.code === 'browser-playwright-script-forbidden')
  assert.throws(() => normalizePlaywrightParameters({ operation: 'evaluate', selector: 'button' }), error => error.code === 'browser-playwright-operation-unsupported')
  assert.throws(() => normalizePlaywrightParameters({ operation: 'click', selector: 'button', selector_kind: 'xpath' }), error => error.code === 'browser-playwright-selector-kind-invalid')
  for (const selector of ['input[value^="a"]', 'input[name=csrf]', 'div:has(input)', 'button, a', '#login-token']) {
    assert.throws(() => normalizePlaywrightParameters({ operation: 'count', selector }), error => ['browser-playwright-selector-unsafe', 'browser-playwright-sensitive-locator'].includes(error.code), selector)
  }
  for (const attribute of ['value', 'href', 'data-auth-token', 'srcdoc', 'onclick', 'aria-label', 'aria-valuetext', 'aria-description']) {
    assert.throws(() => normalizePlaywrightParameters({ operation: 'getAttribute', selector: '#safe', attribute }), error => error.code === 'browser-playwright-attribute-forbidden', attribute)
  }
  assert.equal(normalizePlaywrightParameters({ operation: 'domSnapshot' }).selector, '')
  assert.equal(normalizePlaywrightParameters({ operation: 'getAttribute', selector: '#safe', attribute: 'title' }).attribute, 'title')
  assert.equal(normalizePlaywrightParameters({ operation: 'click', selector_kind: 'role', selector: 'button', name: 'Save' }).selectorKind, 'role')
  assert.match(api, /fixedLocatorPageFunction\.toString\(\)/u)
  assert.match(api, /executeJavaScriptInIsolatedWorld/u)
  assert.match(api, /BINDINGS_KEY/u)
})

test('受限 Playwright API 复用宿主授权与安全门禁，并保持后台 CDP/DOM 数据面', async () => {
  const [api, main] = await Promise.all([
    source('electron/bridge/browser-codex-api.cjs'),
    source('electron/main.cjs')
  ])

  assert.match(api, /securityPolicy\.modelAction/u)
  assert.match(api, /confirmationId/u)
  assert.match(api, /webContents\.executeJavaScriptInIsolatedWorld/u)
  assert.match(api, /surfaceConfirmation\(decision\)/u)
  assert.match(api, /browser-playwright-binding-(?:stale|changed)/u)
  assert.match(api, /Input\.dispatchMouseEvent/u)
  assert.match(api, /Input\.insertText/u)
  assert.match(api, /beginInput/u)
  assert.doesNotMatch(api, /tab-not-visible/u)
  assert.match(main, /action === 'playwright'/u)
  assert.match(main, /browser-codex-api\.cjs/u)
  assert.match(main, /beginInput:[\s\S]{0,200}beginModelInput/u)
  assert.ok(main.indexOf("markBrowserModelNavigation(tabId, action || 'unknown-action')", main.indexOf("if (action === 'playwright')")) > main.indexOf("if (action === 'playwright')"), 'generic model-lane mark must occur after the Playwright branch so reads never enter it')
  assert.match(main, /requireSharedComputerUseForBrowser\(\{ requestAuthorization: true \}\)/u)
  assert.match(main, /dataPlane: \{ primary: 'cdp-dom', structuredRefs: true, loopbackApi: true, screenshotRequired: false/u)
})

test('宿主转发 confirmation_id 并在确认前清理精确节点绑定', async () => {
  const { PLAYWRIGHT_WORLD_ID, runBrowserPlaywrightOperation } = require(path.join(root, 'electron/bridge/browser-codex-api.cjs'))
  const phases = []
  const confirmations = []
  const confirmedBackendNodes = []
  let bindingId = ''
  const webContents = {
    executeJavaScriptInIsolatedWorld: async (worldId, scripts) => {
      assert.equal(worldId, PLAYWRIGHT_WORLD_ID)
      const code = scripts[0].code
      const phase = /"phase":"([^"]+)"/u.exec(code)?.[1]
      bindingId = /"bindingId":"([^"]+)"/u.exec(code)?.[1] || bindingId
      phases.push(phase)
      if (phase === 'preflight') return fixedEnvelope({ field: { tag: 'button', type: 'submit', name: 'save', id: 'save', role: 'button', label: 'Save', text: 'Save', selector: '#save', baseUrl: 'https://example.test', submit: true, formAction: 'https://example.test/save' }, text: '' })
      if (phase === 'bind' || phase === 'prepare' || phase === 'verify') return fixedEnvelope({ field: { tag: 'button' }, actionPoint: phase === 'verify' ? { x: 10, y: 10 } : null, bindingVerified: true })
      if (phase === 'unmark') return fixedEnvelope({ unmarked: true })
      if (phase === 'cleanup') return fixedEnvelope({ cleaned: true })
      throw new Error(`unexpected phase ${phase}`)
    },
    debugger: {
      isAttached: () => true,
      sendCommand: async method => {
        if (method === 'DOM.performSearch') return { searchId: `search-${bindingId}`, resultCount: 1 }
        if (method === 'DOM.getSearchResults') return { nodeIds: [5] }
        if (method === 'DOM.describeNode') return { node: { backendNodeId: 7 } }
        if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } }
        return {}
      }
    }
  }
  const securityPolicy = {
    modelAction(input) {
      confirmations.push(input.confirmationId)
      confirmedBackendNodes.push(input.field.backendNodeId)
      if (input.confirmationId === 'confirm-1') return { allowed: true }
      return { allowed: false, requiresConfirmation: true, confirmationId: 'confirm-1' }
    }
  }
  const first = await runBrowserPlaywrightOperation({ webContents, parameters: { operation: 'click', selector: '#save' }, origin: 'https://example.test', tabId: 'tab-1', securityPolicy })
  assert.equal(first.requiresConfirmation, true)
  assert.deepEqual(phases, ['preflight', 'bind', 'unmark', 'cleanup'])
  const second = await runBrowserPlaywrightOperation({ webContents, parameters: { operation: 'click', selector: '#save', confirmation_id: 'confirm-1' }, origin: 'https://example.test', tabId: 'tab-1', securityPolicy })
  assert.equal(second.acted, true)
  assert.deepEqual(confirmations, [undefined, 'confirm-1'])
  assert.deepEqual(confirmedBackendNodes, ['7', '7'])
  assert.deepEqual(phases, ['preflight', 'bind', 'unmark', 'cleanup', 'preflight', 'bind', 'unmark', 'prepare', 'verify', 'verify', 'verify', 'cleanup'])
})

test('Playwright 只读操作不进入 mutation fence、markAction 或可信输入通道', async () => {
  const { runBrowserPlaywrightOperation } = require(path.join(root, 'electron/bridge/browser-codex-api.cjs'))
  let marked = 0
  let inputLanes = 0
  let policyCalls = 0
  const webContents = {
    executeJavaScriptInIsolatedWorld: async (_worldId, scripts) => {
      assert.match(scripts[0].code, /"phase":"read"/u)
      return fixedEnvelope({ count: 2, text: '', field: { tag: 'document', selector: '.card', baseUrl: 'https://example.test' } })
    }
  }
  Object.defineProperty(webContents, 'debugger', { get() { throw new Error('read operation must not touch CDP mutation/input channel') } })
  const result = await runBrowserPlaywrightOperation({
    webContents,
    parameters: { operation: 'count', selector: '.card' },
    origin: 'https://example.test',
    tabId: 'tab-1',
    securityPolicy: { modelAction: async input => { policyCalls += 1; assert.equal(input.action, 'read'); return { allowed: true } } },
    markAction: () => { marked += 1 },
    beginInput: () => { inputLanes += 1; return () => {} }
  })
  assert.equal(result.count, 2)
  assert.equal(policyCalls, 1)
  assert.equal(marked, 0)
  assert.equal(inputLanes, 0)
})

test('dblclick、partial fill 与 selectOption 在可信输入开始后的任意错误都统一为 unknown outcome', async () => {
  const { runBrowserPlaywrightOperation } = require(path.join(root, 'electron/bridge/browser-codex-api.cjs'))

  async function runFaultCase({ parameters, field, plan, shouldFail, originalCode }) {
    let bindingId = ''
    const phases = []
    const webContents = {
      executeJavaScriptInIsolatedWorld: async (_worldId, scripts) => {
        const code = scripts[0].code
        const phase = /"phase":"([^"]+)"/u.exec(code)?.[1]
        bindingId = /"bindingId":"([^"]+)"/u.exec(code)?.[1] || bindingId
        phases.push(phase)
        if (phase === 'preflight') return fixedEnvelope({ field: { ...field, selector: parameters.selector, baseUrl: 'https://example.test' }, text: '' })
        if (phase === 'bind' || phase === 'prepare') return fixedEnvelope({ field, ...plan, actionPoint: null, bindingVerified: true })
        if (phase === 'verify') return fixedEnvelope({ field, ...plan, actionPoint: { x: 10, y: 10 }, bindingVerified: true })
        if (phase === 'unmark') return fixedEnvelope({ unmarked: true })
        if (phase === 'cleanup') return fixedEnvelope({ cleaned: true })
        throw new Error(`unexpected phase ${phase}`)
      },
      debugger: {
        isAttached: () => true,
        sendCommand: async (method, payload = {}) => {
          if (method === 'DOM.performSearch') return { searchId: `search-${bindingId}`, resultCount: 1 }
          if (method === 'DOM.getSearchResults') return { nodeIds: [6] }
          if (method === 'DOM.describeNode') return { node: { backendNodeId: 9 } }
          if (method === 'DOM.getBoxModel') return { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } }
          if (shouldFail(method, payload)) throw Object.assign(new Error('injected trusted-input failure'), { code: originalCode })
          return {}
        }
      }
    }
    await assert.rejects(
      runBrowserPlaywrightOperation({
        webContents,
        parameters,
        origin: 'https://example.test',
        tabId: 'tab-1',
        securityPolicy: { modelAction: async () => ({ allowed: true }) }
      }),
      error => error.code === 'browser-outcome-unknown' && error.originalCode === originalCode
    )
    assert.ok(phases.includes('cleanup'))
  }

  let mousePresses = 0
  await runFaultCase({
    parameters: { operation: 'dblclick', selector: '#double' },
    field: { tag: 'button', type: 'button', id: 'double', role: 'button', label: 'Double', text: 'Double', submit: false },
    plan: {},
    shouldFail: (method, payload) => method === 'Input.dispatchMouseEvent' && payload.type === 'mousePressed' && ++mousePresses === 2,
    originalCode: 'cdp-second-click-failed'
  })
  await runFaultCase({
    parameters: { operation: 'fill', selector: '#note', text: 'replacement' },
    field: { tag: 'input', type: 'text', id: 'note', role: 'textbox', label: 'Note', text: '', submit: false, readOnly: false },
    plan: {},
    shouldFail: method => method === 'Input.insertText',
    originalCode: 'cdp-insert-failed'
  })
  await runFaultCase({
    parameters: { operation: 'selectOption', selector: '#choice', value: 'b' },
    field: { tag: 'select', type: 'select-one', id: 'choice', role: 'combobox', label: 'Choice', text: '', submit: false },
    plan: { targetIndex: 1, selectedValue: 'b', currentSelectedValue: 'a' },
    shouldFail: (method, payload) => method === 'Input.dispatchKeyEvent' && payload.type === 'keyDown' && payload.key === 'ArrowDown',
    originalCode: 'cdp-select-arrow-failed'
  })
})

test('browser_playwright 回环协议固定 action=playwright，旧 browser_control 动作表保持兼容', async () => {
  const plugin = await source('plugins/dsh-desktop-browser-tools/lib/index.js')

  const { PLAYWRIGHT_OPERATIONS } = require(path.join(root, 'electron/bridge/browser-codex-api.cjs'))
  assert.match(plugin, /name:\s*'browser_playwright'/u)
  for (const operation of PLAYWRIGHT_OPERATIONS) assert.match(plugin, new RegExp(`['\"]${operation}['\"]`), `tool must expose host operation ${operation}`)
  assert.match(plugin, /const payload = \{ operation: args\.operation \}/u)
  assert.match(plugin, /request\(state, 'playwright', payload/u)
  assert.match(plugin, /'confirmation_id'/u)
  assert.match(plugin, /PLAYWRIGHT_READ_OPERATIONS/u)
  assert.match(plugin, /name:\s*'browser_control'/u)
  const legacyActions = /const ACTIONS = \[([\s\S]*?)\]/u.exec(plugin)?.[1] || ''
  assert.match(legacyActions, /'stop'/u)
  assert.doesNotMatch(legacyActions, /'playwright'/u)
})

test('真实 Electron fixture 覆盖 DOM 快照、节点身份确认、可信输入、隐藏元素与 unknown outcome', async () => {
  const [fixture, runner] = await Promise.all([
    source('tests/fixtures/browser-codex-api-electron.cjs'),
    source('scripts/test-browser-codex-api-electron.cjs')
  ])
  for (const contract of ['domSnapshot', 'confirmation-used', 'confirmation-mismatch', 'browser-playwright-element-not-actionable', 'browser-playwright-binding-stale', 'browser-outcome-unknown']) assert.match(fixture, new RegExp(contract), contract)
  assert.match(fixture, /webContents\.debugger\.attach/u)
  assert.match(runner, /delete environment\.ELECTRON_RUN_AS_NODE/u)
  assert.match(runner, /spawnSync\(electronBinary/u)
})
