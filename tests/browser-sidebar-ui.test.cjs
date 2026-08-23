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

test('native browser content visibility never rebroadcasts sidebar visibility', async () => {
  const main = await readFile(path.join(root, 'electron', 'main.cjs'), 'utf8')
  const body = main.match(/async function setBrowserContentVisible\(visible\) \{[\s\S]*?\n\}/u)?.[0] || ''
  assert.match(body, /browserContentVisible = Boolean\(visible\)/u)
  assert.match(body, /return browserStatePayload\(\)/u)
  assert.doesNotMatch(body, /publishBrowserState/u)
})

test('Computer Use keeps per-action confirmation and adds a persistent app policy editor', async () => {
  const [html, renderer, styles] = await Promise.all([
    readFile(path.join(root, 'renderer', 'index.html'), 'utf8'),
    readFile(path.join(root, 'renderer', 'browser-sidebar.js'), 'utf8'),
    readFile(path.join(root, 'renderer', 'styles.css'), 'utf8')
  ])

  for (const id of ['computerUseToggle', 'computerUseSessionState', 'computerUsePending', 'computerUsePolicyTitle', 'computerUsePolicyControls', 'computerUseDefaultAccess', 'computerUseCurrentTarget', 'computerUseAppList', 'computerUsePolicyMessage']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing computer use control ${id}`)
  }
  assert.match(html, /内置 Computer Use/u)
  assert.match(html, /跨应用访问策略（持久）/u)
  assert.match(html, /默认应用访问/u)
  assert.match(html, /受限动作仍逐次确认/u)
  for (const value of ['ask', 'allow', 'deny']) {
    assert.match(html, new RegExp(`<option value="${value}">`), `missing default access option ${value}`)
  }
  assert.match(html, /每次询问（推荐）/u)
  assert.match(html, /永久禁止：<\/strong>敏感、系统、UAC 与提权窗口任何策略都不可放行，也不可撤销该限制。/u)
  assert.doesNotMatch(html, /技能卡/u)
  assert.doesNotMatch(html, /computerUseInstall/u)

  assert.match(renderer, /getComputerUseState/u)
  assert.match(renderer, /setComputerUseEnabled/u)
  assert.match(renderer, /api\.confirmComputerUseAction\(item\.id\)/u)
  assert.match(renderer, /api\.rejectComputerUseAction\(item\.id\)/u)
  assert.match(renderer, /本次允许/u)
  assert.match(renderer, /renderComputerUsePending\(/u)
  assert.match(renderer, /typeof api\.getComputerUsePolicy !== 'function'/u)
  assert.match(renderer, /策略后端未接通/u)
  assert.match(renderer, /能力不可用原因：/u)
  assert.match(renderer, /api\.setComputerUseDefaultAccess\(/u)
  assert.match(renderer, /api\.setComputerUseAppOverride\(/u)
  assert.match(renderer, /api\.revokeComputerUseAppOverride\(/u)
  assert.match(renderer, /撤销持久授权/u)
  assert.match(renderer, /永久禁止/u)

  for (const selector of ['.computer-use-session-state', '.computer-use-permanent-notice', '.computer-use-policy-controls', '.computer-use-app-row', '.computer-use-policy-message', '.computer-use-current-target', '.computer-use-app-list']) {
    assert.match(styles, new RegExp(selector.replace('.', '\\.')), `missing style ${selector}`)
  }
})
