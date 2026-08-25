const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('Codex-style background browser uses an isolated login profile with an optional right-sidebar preview', async () => {
  const [html, renderer, preload, main] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'preload.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  ])

  assert.match(html, /id="browserQuickButton"/u)
  assert.match(html, /id="browserSidebar"/u)
  assert.match(html, /id="browserAddress"/u)
  for (const id of ['browserTabs', 'browserNewTab', 'browserResizeHandle', 'browserWideMode', 'browserHistoryPanel', 'browserDownloadsPanel']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing browser sidebar control ${id}`)
  }
  assert.match(html, /请直接在下方真实网页中亲自登录/u)
  assert.match(html, /模型无法读取密码、Cookie、验证码或令牌/u)
  assert.match(html, /内置浏览器可在后台运行，普通结构化动作无需保持右栏打开/u)
  assert.match(html, /关键动作会自动打开右栏请求逐次确认/u)
  assert.match(html, /结构化 CDP\/DOM 引用/u)
  assert.match(html, /截图仅作视觉后备/u)
  assert.match(html, /browser-sidebar\.js/u)

  assert.match(main, /new WebContentsView/u)
  assert.match(main, /BrowserSecurityPolicy/u)
  assert.match(main, /partition: browserSecurityPolicy\.partitionName/u)
  assert.match(main, /nodeIntegration: false/u)
  assert.match(main, /sandbox: true/u)
  assert.match(main, /backgroundThrottling: false/u)
  assert.match(main, /backgroundEnabled: true/u)
  assert.match(main, /dataPlane: \{ primary: 'cdp-dom', structuredRefs: true, loopbackApi: true, screenshotRequired: false/u)
  assert.match(main, /session: \{[\s\S]{0,500}dataPlane: \{ primary: 'cdp-dom'/u)
  assert.match(main, /transport: 'authenticated-loopback-json'/u)
  assert.match(main, /screenshotRequired: false/u)
  assert.match(main, /setPermissionRequestHandler/u)
  assert.match(main, /clearStorageData/u)
  assert.match(main, /clearAuthCache/u)
  assert.match(main, /clearCodeCaches/u)
  assert.match(main, /navigationHistory\?\.clear\(\)/u)
  assert.match(main, /browserSecurityPolicy\.clearAudit\(\)/u)
  assert.match(main, /browserOperations\.beginReset\(\)/u)
  assert.match(main, /clearPendingControl\(\)/u)
  assert.match(main, /loadURL\('about:blank'\)/u)
  assert.match(renderer, /state\.profileResetting === true/u)
  assert.match(renderer, /正在安全重置独立 Profile/u)
  assert.match(html, /清除登录数据、缓存、浏览历史、站点授权与审计元数据/u)
  assert.match(renderer, /privacySummary\.textContent/u)
  assert.match(renderer, /newBrowserTab/u)
  assert.match(renderer, /switchBrowserTab/u)
  assert.match(renderer, /closeBrowserTab/u)
  assert.match(renderer, /setBrowserPanelWidth/u)
  assert.match(renderer, /setBrowserWideMode/u)
  assert.match(renderer, /searchBrowserHistory/u)
  assert.match(renderer, /openBrowserHistory/u)
  assert.match(renderer, /removeBrowserHistory/u)
  assert.match(renderer, /clearBrowserHistory\(\{ confirmed: true \}\)/u)
  assert.match(renderer, /event\.ctrlKey && event\.shiftKey/u)
  assert.match(main, /request\?\.confirmed === true/u)
  assert.doesNotMatch(renderer, /document\.cookie|executeJavaScript|password/u)

  for (const channel of ['browser:state', 'browser:setVisible', 'browser:navigate', 'browser:clearSiteData', 'browser:clearAllData']) {
    assert.ok(preload.includes(channel), `preload missing ${channel}`)
    assert.ok(main.includes(channel), `main missing ${channel}`)
  }
})

test('Codex-style browser pane starts below and matches the global workbench header', async () => {
  const [workspaceStyles, shellStyles, controller, renderer, main, app] = await Promise.all([
    readFile(path.join(root, 'renderer', 'right-workspace.css'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8'),
    readFile(path.join(root, 'renderer', 'right-workspace.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8'),
    readFile(path.join(root, 'renderer', 'app.js'), 'utf8')
  ])

  assert.match(workspaceStyles, /--dsh-workbench-header-height:\s*76px/u)
  assert.match(workspaceStyles, /top:\s*var\(--dsh-workbench-header-height\)/u)
  assert.match(workspaceStyles, /--dsh-right-workspace-width:\s*640px/u)
  assert.match(shellStyles, /--browser-panel-width:640px/u)
  assert.match(shellStyles, /:root\[data-shell-theme\] \.official-shell \{ background:var\(--shell-layer,#fff\); background:rgb\(from var\(--shell-layer\) r g b \/ 1\); \}/u)
  assert.match(controller, /defaultWidth:\s*640/u)
  assert.match(renderer, /Number\(state\.panelWidth\) \|\| 640/u)
  assert.match(main, /BROWSER_PANEL_DEFAULT_WIDTH = 640/u)
  assert.match(main, /WORKBENCH_HEADER_HEIGHT = 76/u)
  assert.match(main, /BROWSER_VIEW_TOP = WORKBENCH_HEADER_HEIGHT \+ 30 \+ 24 \+ 28/u)
  assert.doesNotMatch(app, /--shell-window-background[^\n]*themePreview\(theme\)/u)
})

test('native browser content visibility never rebroadcasts sidebar visibility', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const body = main.match(/async function setBrowserContentVisible\(visible\) \{[\s\S]*?\n\}/u)?.[0] || ''
  assert.match(body, /browserContentVisible = Boolean\(visible\)/u)
  assert.match(body, /return browserStatePayload\(\)/u)
  assert.doesNotMatch(body, /publishBrowserState/u)
})

test('closing the right sidebar changes presentation only and keeps the browser session controllable', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const body = main.match(/async function setBrowserSidebarVisible\(visible\) \{[\s\S]*?\n\}/u)?.[0] || ''
  assert.match(body, /ensureBrowserSession\(\)/u)
  assert.match(body, /browserSidebarVisible = Boolean\(visible\)/u)
  assert.match(body, /updateBrowserActiveTab\(contents\.getURL\(\)\)/u)
  assert.match(body, /layoutBrowserView\(\)/u)
  assert.doesNotMatch(body, /closeBrowserViewContents|webContents\.close|pauseModelControl|cancelModelActions/u)
  assert.doesNotMatch(main, /function requireBrowserForModel[\s\S]{0,700}tab-not-visible/u)
})

test('critical background actions surface their user confirmation and crashed tabs become unavailable', async () => {
  const [main, renderer] = await Promise.all([
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8')
  ])
  const helper = main.match(/async function surfacePendingBrowserConfirmation\(decision\) \{[\s\S]*?\n\}/u)?.[0] || ''
  assert.match(helper, /decision\?\.requiresConfirmation/u)
  assert.match(helper, /setBrowserSidebarVisible\(true\)/u)
  assert.match(helper, /userAttention/u)
  assert.match(renderer, /!hadAttention && state\.attentionRequired === true/u)
  assert.match(renderer, /workspace\.openMode\('browser', \{ nativeAlreadyVisible: true \}\)/u)
  assert.match(main, /contents\.on\('render-process-gone'/u)
  assert.match(main, /browserTab\.available = false/u)
  assert.match(main, /markActiveTabUnavailable\(tabId\)/u)
  assert.match(main, /tab\.available = false[\s\S]{0,120}markActiveTabUnavailable\(id\)/u)
})

test('browser control reuses the Computer Use session/permanent authorization card', async () => {
  const [html, renderer, styles] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8')
  ])

  for (const id of ['browserControlTitle', 'computerUseToggle', 'computerUseRevokePermanent', 'computerUseSessionState', 'computerUsePending', 'browserPendingActions', 'computerUseAuthorizationOverlay', 'computerUseAuthorizationSession', 'computerUseAuthorizationForever', 'computerUseAuthorizationDecline', 'computerUsePolicyTitle', 'computerUsePolicyControls', 'computerUseDefaultAccess', 'computerUseCurrentTarget', 'computerUseAppList', 'computerUsePolicyMessage']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing shared browser/computer use control ${id}`)
  }
  assert.match(html, /浏览器控制 · Computer Use/u)
  assert.match(html, /共用同一份授权和启停状态/u)
  assert.match(html, /无需保持右栏打开/u)
  assert.match(html, /选择一次“本次授权”或“永久授权”即可/u)
  assert.match(html, /允许 AI 控制/u)
  assert.match(html, /本次授权/u)
  assert.match(html, /永久授权/u)
  assert.match(html, /右栏浏览器仍保留密码、账号、验证码、支付和银行信息等硬限制/u)
  assert.doesNotMatch(html, /id="browserGrantCurrent"|id="browserRevokeCurrent"|id="browserResumeModel"/u)
  assert.match(html, /跨应用访问策略（受限模式）/u)
  for (const value of ['ask', 'allow', 'deny']) {
    assert.match(html, new RegExp(`<option value="${value}">`), `missing default access option ${value}`)
  }
  assert.doesNotMatch(html, /技能卡/u)
  assert.doesNotMatch(html, /computerUseInstall/u)

  assert.match(renderer, /getComputerUseState/u)
  assert.match(renderer, /requestComputerUseAuthorization/u)
  assert.match(renderer, /authorizeComputerUse\(scope\)/u)
  assert.match(renderer, /declineComputerUseAuthorization/u)
  assert.match(renderer, /revokeComputerUsePermanentGrant/u)
  assert.match(renderer, /computerUseToggle\.dataset\.activation = 'approval-card'/u)
  assert.match(renderer, /api\.onComputerUseAuthorization/u)
  assert.match(renderer, /浏览器控制与无限制 Computer Use 已开启/u)
  assert.match(renderer, /浏览器控制与 Computer Use 已同时停止/u)
  assert.doesNotMatch(renderer, /grantCurrentBrowserOrigin|revokeCurrentBrowserOrigin|resumeBrowserModelControl/u)
  assert.match(renderer, /api\.setComputerUseDefaultAccess\(/u)
  assert.match(renderer, /api\.setComputerUseAppOverride\(/u)
  assert.match(renderer, /api\.revokeComputerUseAppOverride\(/u)
  assert.match(renderer, /受限模式禁止/u)

  for (const selector of ['.computer-use-session-state', '.computer-use-permanent-notice', '.computer-use-authorization-overlay', '.computer-use-authorization-card', '.computer-use-authorization-actions', '.computer-use-policy-controls', '.computer-use-app-row', '.computer-use-policy-message']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.')), `missing style ${selector}`)
  }
})

test('browser error states announce via role=alert while normal states keep status', async () => {
  const [renderer, html] = await Promise.all([
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8')
  ])
  assert.match(html, /id="browserStatusText" role="status"/u)
  assert.match(renderer, /function setBrowserStatus\(text, \{ error = false \} = \{\}\)/u)
  assert.match(renderer, /statusText\.setAttribute\('role', error \? 'alert' : 'status'\)/u)
  assert.match(renderer, /setBrowserStatus\(error\.message \|\| String\(error\), \{ error: true \}\)/u)
  assert.match(renderer, /Boolean\(state\.error\)/u)
  assert.equal((renderer.match(/statusText\.textContent\s*=/gu) || []).length, 1, 'all browser status writes must use setBrowserStatus')
})

test('Computer Use authorization card separates scrollable body from a fixed action footer', async () => {
  const [html, styles] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8')
  ])
  assert.match(html, /class="computer-use-authorization-body"/u)
  assert.match(html, /class="computer-use-authorization-actions"/u)
  assert.match(html, /id="computerUseAuthorizationRefocus" role="status" hidden/u)
  assert.match(styles, /\.computer-use-authorization-card \{ display:flex; flex-direction:column;/u)
  assert.match(styles, /\.computer-use-authorization-body \{ flex:1 1 auto; min-height:0; overflow:auto;/u)
  assert.match(styles, /\.computer-use-authorization-actions \{ display:flex; flex-wrap:wrap; gap:8px; flex:none;/u)
})

test('the first window-refocus mouse grant click never authorizes', async () => {
  const renderer = await readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8')
  assert.match(renderer, /window\.addEventListener\('blur'[\s\S]*?armAuthorizationRefocusGuard\(\)/u)
  assert.match(renderer, /authorizationRefocusDisarmTimer[\s\S]*?clearTimeout/u)
  assert.match(renderer, /#computerUseAuthorizationSession,#computerUseAuthorizationForever/u)
  assert.match(renderer, /event\.detail > 0/u)
  assert.match(renderer, /event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/u)
  assert.match(renderer, /if \(!refocusTargetIsGrantButton\(event\.target\)\) return/u)
  assert.doesNotMatch(renderer, /pointerdown[\s\S]{0,160}authorizeComputerUse\(/u, 'refocus pointerdown must not authorize')
})
