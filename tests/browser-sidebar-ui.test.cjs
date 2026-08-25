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

test('Computer Use stays discoverable in plugin settings while Host owns unlimited authorization', async () => {
  const [html, sidebar, styles, app, client, manifestText] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8'),
    readFile(path.join(root, 'renderer', 'app.js'), 'utf8'),
    readFile(path.join(root, 'plugins', 'dsh-desktop-computer-use', 'lib', 'client.js'), 'utf8'),
    readFile(path.join(root, 'plugins', 'dsh-desktop-computer-use', 'package.json'), 'utf8')
  ])
  const manifest = JSON.parse(manifestText)

  for (const id of ['computerUseAuthorizationOverlay', 'computerUseAuthorizationSession', 'computerUseAuthorizationForever', 'computerUseAuthorizationDecline']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing trusted Host authorization control ${id}`)
  }
  for (const id of ['computerUseToggle', 'computerUseRevokePermanent', 'computerUseSessionState', 'computerUsePending', 'computerUsePolicyTitle', 'computerUsePolicyControls', 'computerUseDefaultAccess', 'computerUseCurrentTarget', 'computerUseAppList', 'computerUsePolicyMessage']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `obsolete Profile control remains: ${id}`)
  }
  assert.match(html, /本次授权/u)
  assert.match(html, /永久授权/u)
  assert.match(html, /取消 UAC、系统\/提权窗口、敏感窗口和敏感输入/u)
  assert.match(html, /设置 → 插件 → Computer Use/u)
  assert.doesNotMatch(html, /跨应用访问策略（受限模式）|请求无限制桌面控制/u)

  assert.match(sidebar, /authorizeComputerUse\(scope\)/u)
  assert.match(sidebar, /declineComputerUseAuthorization/u)
  assert.match(sidebar, /api\.onComputerUseAuthorization/u)
  assert.doesNotMatch(sidebar, /setComputerUseDefaultAccess|setComputerUseAppOverride|revokeComputerUseAppOverride|computerUseToggle/u)

  assert.match(client, /settings\.plugin\.item/u)
  assert.match(client, /computer-use-toggle/u)
  assert.match(client, /computer-use-revoke-permanent/u)
  assert.match(client, /trusted Host authorization card/u)
  assert.match(client, /cannot choose its scope/u)
  assert.match(client, /unlimited mode bypasses application policy, per-action confirmation/u)
  assert.doesNotMatch(client, /authorize-session|authorize-forever/u)
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'))

  assert.match(app, /event\.isMainFrame === false/u)
  assert.match(app, /computer-use-refresh/u)
  assert.match(app, /computer-use-status/u)
  assert.match(app, /computer-use-toggle/u)
  assert.match(app, /computer-use-revoke-permanent/u)
  assert.match(app, /api\.requestComputerUseAuthorization\(\)/u)
  assert.match(app, /api\.setComputerUseEnabled\(false\)/u)
  assert.doesNotMatch(app, /pluginMutation|computer-use-authorize-session|computer-use-authorize-forever/u)

  for (const selector of ['.computer-use-authorization-overlay', '.computer-use-authorization-card', '.computer-use-authorization-actions']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.')), `missing Host authorization style ${selector}`)
  }
  for (const selector of ['.computer-use-session-state', '.computer-use-permanent-notice', '.computer-use-policy-controls', '.computer-use-app-row', '.computer-use-policy-message', '.computer-use-host-overlay']) {
    assert.doesNotMatch(styles, new RegExp(selector.replace('.', '\\.')), `obsolete Computer Use style remains: ${selector}`)
  }
})
