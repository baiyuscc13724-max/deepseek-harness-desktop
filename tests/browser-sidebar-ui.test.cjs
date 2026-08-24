const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const root = path.join(__dirname, '..')

test('Codex-style right sidebar browser uses an isolated visible login profile', async () => {
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
  assert.match(html, /browser-sidebar\.js/u)

  assert.match(main, /new WebContentsView/u)
  assert.match(main, /BrowserSecurityPolicy/u)
  assert.match(main, /partition: browserSecurityPolicy\.partitionName/u)
  assert.match(main, /nodeIntegration: false/u)
  assert.match(main, /sandbox: true/u)
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

test('Codex-style browser pane starts below the global workbench header', async () => {
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
  assert.match(shellStyles, /background:var\(--shell-window-background,#fff\)/u)
  assert.match(controller, /defaultWidth:\s*640/u)
  assert.match(renderer, /Number\(state\.panelWidth\) \|\| 640/u)
  assert.match(main, /BROWSER_PANEL_DEFAULT_WIDTH = 640/u)
  assert.match(main, /WORKBENCH_HEADER_HEIGHT = 76/u)
  assert.match(main, /BROWSER_VIEW_TOP = WORKBENCH_HEADER_HEIGHT \+ 30 \+ 24 \+ 28/u)
  assert.match(app, /--shell-window-background[^\n]*themePreview\(theme\)/u)
})

test('native browser content visibility never rebroadcasts sidebar visibility', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const body = main.match(/async function setBrowserContentVisible\(visible\) \{[\s\S]*?\n\}/u)?.[0] || ''
  assert.match(body, /browserContentVisible = Boolean\(visible\)/u)
  assert.match(body, /return browserStatePayload\(\)/u)
  assert.doesNotMatch(body, /publishBrowserState/u)
})

test('Computer Use pushes session/permanent unlimited authorization above the dialog', async () => {
  const [html, renderer, styles] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8')
  ])

  for (const id of ['computerUseToggle', 'computerUseRevokePermanent', 'computerUseSessionState', 'computerUsePending', 'computerUseAuthorizationOverlay', 'computerUseAuthorizationSession', 'computerUseAuthorizationForever', 'computerUseAuthorizationDecline', 'computerUsePolicyTitle', 'computerUsePolicyControls', 'computerUseDefaultAccess', 'computerUseCurrentTarget', 'computerUseAppList', 'computerUsePolicyMessage']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing computer use control ${id}`)
  }
  assert.match(html, /内置 Computer Use/u)
  assert.match(html, /对话框上方推送授权卡片/u)
  assert.match(html, /请求无限制桌面控制/u)
  assert.match(html, /本次授权/u)
  assert.match(html, /永久授权/u)
  assert.match(html, /取消 UAC、系统\/提权窗口、敏感窗口和敏感输入/u)
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
  assert.match(renderer, /无限制桌面控制已开启/u)
  assert.match(renderer, /api\.setComputerUseDefaultAccess\(/u)
  assert.match(renderer, /api\.setComputerUseAppOverride\(/u)
  assert.match(renderer, /api\.revokeComputerUseAppOverride\(/u)
  assert.match(renderer, /受限模式禁止/u)

  for (const selector of ['.computer-use-session-state', '.computer-use-permanent-notice', '.computer-use-authorization-overlay', '.computer-use-authorization-card', '.computer-use-authorization-actions', '.computer-use-policy-controls', '.computer-use-app-row', '.computer-use-policy-message']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.')), `missing style ${selector}`)
  }
})
