const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const runtime = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')
const compat = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'), 'utf8')
const officialTeams = fs.readFileSync(path.join(root, 'plugins', 'dsh-agent-teams', 'lib', 'client.js'), 'utf8')
const officialSessionExperience = fs.readFileSync(path.join(root, 'plugins', 'dsh-session-experience', 'lib', 'client.js'), 'utf8')

function sourceIndex(fragment) {
  const index = runtime.indexOf(fragment)
  assert.notEqual(index, -1, `mobile runtime missing contract: ${fragment}`)
  return index
}

test('mobile navigation exposes the stable four-domain order and routes', () => {
  const domains = [
    ["id: 'conversations'", "label: '对话'", "route: '/m/conversations'", "slot: 'navigation.conversations'"],
    ["id: 'agents'", "label: '代理团队'", "route: '/m/agents'", "slot: 'agent-teams.view.canvas'"],
    ["id: 'tasks'", "label: '定时任务'", "route: '/m/tasks'", "slot: 'agent-teams.view.automation'"],
    ["id: 'me'", "label: '我的'", "route: '/m/me'", "slot: 'navigation.me'"]
  ]
  let previous = -1
  for (const domain of domains) {
    const index = sourceIndex(`{ ${domain.join(', ')} }`)
    assert.ok(index > previous, 'domains must stay ordered 对话 / 代理团队 / 定时任务 / 我的')
    previous = index
  }
  assert.match(runtime, /data-harness-mobile-navigation role="tablist" aria-label="主要导航"/u)
  assert.match(runtime, /role="tab" data-harness-mobile-domain=/u)
  assert.match(runtime, /button\.setAttribute\('aria-selected', selected \? 'true' : 'false'\)/u)
  assert.match(runtime, /button\.setAttribute\('aria-current', 'page'\)/u)
})

test('mobile navigation only delegates to the versioned bridge or official semantic controls', () => {
  assert.match(runtime, /const bridge = window\.HarnessMobileNavigation/u)
  assert.match(runtime, /bridge && bridge\.version != null && typeof bridge\.navigate === 'function'/u)
  assert.match(runtime, /bridge\.navigate\(domain\.route\)/u)
  assert.match(runtime, /bridge\.getNavigationState/u)
  assert.match(runtime, /bridge\.subscribe\(sync\)/u)
  assert.match(runtime, /harness-mobile-navigation-change/u)
  assert.match(runtime, /const detailComposer = visibleConversation\?\.querySelector\?\.\('\[data-composer-card\]'\)[^]*domain\.id !== 'conversations' && root\.dataset\.harnessMobileChatDetail === 'open' && detailComposer && visible\(visibleConversation\)[^]*event\.preventDefault\(\)[^]*event\.stopPropagation\(\)/u, 'a transient hidden footer must never steal touches from an open conversation detail')
  assert.match(runtime, /root\.dataset\.harnessMobileChatDetail === 'open'/u, 'a mounted composer behind the home drawer must not block the other three domains')
  assert.match(runtime, /\[data-mobile-slot="\$\{domain\.slot\}"\]/u)
  assert.match(runtime, /\[data-slot="agent-teams\.trigger"\] button, button\[data-slot="agent-teams\.trigger"\]/u)
  assert.match(runtime, /\[data-slot="settings\.trigger"\] button, button\[data-slot="settings\.trigger"\]/u)
  assert.doesNotMatch(runtime, /(?:空间|任务|我的)(?:首页|页面).*createElement|data-harness-mobile-domain-placeholder/u)
})

test('mobile domains bind the official Agent Teams canvas and automation slots', () => {
  assert.match(officialTeams, /"data-mobile-slot": item\.id === "projectTasks" \? "navigation\.tasks" : item\.id === "board" \? "navigation\.agents" : "agent-teams\.view\." \+ item\.id/u)
  assert.match(runtime, /id: 'agents'[^\n]*slot: 'agent-teams\.view\.canvas'/u)
  assert.match(runtime, /id: 'tasks'[^\n]*slot: 'agent-teams\.view\.automation'/u)
})

test('mobile helpers wait for non-empty official canvas and automation content', async () => {
  const start = runtime.indexOf('  const officialWorkspaceContent = (workbench, domain) => {')
  const end = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  const clicks = []
  const controls = Object.fromEntries(['canvas', 'automation'].map(id => [id, {
    disabled: false,
    textContent: id,
    getAttribute: () => null,
    click: () => clicks.push(id)
  }]))
  const content = { childElementCount: 1, textContent: '权威内容' }
  const workbench = {
    textContent: 'Agent Teams 权威工作区',
    querySelector(selector) {
      if (selector.includes('agent-teams.view.canvas')) return controls.canvas
      if (selector.includes('agent-teams.view.automation')) return controls.automation
      if (selector.includes('dat-automation-title') || selector.includes('agent-teams.canvas')) return content
      return null
    },
    querySelectorAll: () => [],
    scrollTo() {}
  }
  const document = { querySelector: selector => selector.includes('agent-teams.workspace') ? workbench : null }
  const root = { dataset: {} }
  const mobileDomains = [
    { id: 'agents', slot: 'agent-teams.view.canvas' },
    { id: 'tasks', slot: 'agent-teams.view.automation' }
  ]
  const api = new Function('document', 'root', 'setTimeout', 'Promise', 'mobileDomains', 'decorateAgentTeamsWorkbench', 'clearNavigationNotice', 'announceNavigationUnavailable', 'accessibleButtonText', `${source}\nreturn { openOfficialAgentCanvas, openOfficialScheduledTasks }`) // eslint-disable-line no-new-func
    (document, root, callback => callback(), Promise, mobileDomains, () => {}, () => {}, () => {}, node => node.textContent || '')
  assert.equal(await api.openOfficialAgentCanvas({}), true)
  assert.equal(await api.openOfficialScheduledTasks({}), true)
  assert.deepEqual(clicks, ['canvas', 'automation'])
  assert.equal(root.dataset.harnessMobileAgentDetailOpen, 'true')
})

test('failed guarded activation keeps the previous domain and exposes a visible error', async () => {
  const start = runtime.indexOf('  const settleMobileDomain = (domain, shell, activation) => {')
  const end = runtime.indexOf('  const navigateMobileDomain = (domain, shell) => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  const state = { activeDomain: 'conversations', pendingDomain: '' }
  const notices = []
  const errors = []
  const settle = new Function('mobileNavigationState', 'Promise', 'clearNavigationNotice', 'announceNavigationLoading', 'announceNavigationUnavailable', 'syncMobileAppShell', `${source}\nreturn settleMobileDomain`) // eslint-disable-line no-new-func
    (state, Promise, () => {}, (_shell, domain) => notices.push(`loading:${domain.id}`), (_shell, domain) => errors.push(domain.id), () => {})
  settle({ id: 'tasks' }, {}, false)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(state.activeDomain, 'conversations')
  assert.deepEqual(notices, ['loading:tasks'])
  assert.deepEqual(errors, ['tasks'])
  assert.match(compat, /\[data-harness-mobile-navigation-status\]\[data-visible="true"\][^{]*\{[^}]*z-index:\s*960 !important/su)
})

test('我的 waits for the non-empty official settings dialog before committing', async () => {
  const start = runtime.indexOf('  const officialSettingsDialog = () => {')
  const end = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  let clicked = 0
  let drawerOpened = false
  const target = { disabled: false, getAttribute: () => null, click: () => { clicked += 1 } }
  const nav = { nextElementSibling: {}, querySelectorAll: () => [{}, {}, {}] }
  const dialog = { textContent: '设置 通用设置 模型路由', querySelector: selector => selector === ':scope > nav' ? nav : null }
  const document = { querySelector: selector => selector.includes('settings-dialog') && clicked ? dialog : null }
  const mobileDomains = [{ id: 'me' }]
  const waitForSettings = new Function('document', 'decorateDialogs', 'clearNavigationNotice', 'mobileDomains', 'officialMobileTarget', 'setSidebarExpanded', 'setTimeout', 'Promise', 'announceNavigationUnavailable', `${source}\nreturn waitForOfficialSettings`) // eslint-disable-line no-new-func
    (document, () => {}, () => {}, mobileDomains, () => target, value => { drawerOpened = value }, callback => callback(), Promise, () => {})
  assert.equal(await waitForSettings({}), true)
  assert.equal(clicked, 1)
  assert.equal(drawerOpened, true)
  assert.match(source, /attempts < 160/u)
})

test('settings is reachable only through 我的, never the conversation action menu', () => {
  const menuSource = runtime.slice(runtime.indexOf('const renderMobileMenu'), runtime.indexOf('const readAuthoritativeProjects'))
  assert.doesNotMatch(menuSource, /settings\.trigger|sidebar\.settings|textContent = '设置'/u)
  assert.match(runtime, /id: 'me', label: '我的', route: '\/m\/me', slot: 'navigation\.me'/u)
})

test('missing domain handlers are disabled and explained instead of opening placeholders', () => {
  assert.match(runtime, /button\.disabled = !available/u)
  assert.match(runtime, /button\.setAttribute\('aria-disabled', available \? 'false' : 'true'\)/u)
  assert.match(runtime, /当前工作台未提供此入口/u)
  assert.match(runtime, /暂时无法打开：桌面工作台尚未提供完整内容/u)
  assert.match(runtime, /role="status" aria-live="polite" aria-atomic="true"/u)
  assert.match(runtime, /const guarded = domain\.id === 'agents' \|\| domain\.id === 'tasks' \|\| domain\.id === 'me'/u)
  assert.match(runtime, /mobileNavigationState\.pendingDomain = domain\.id[^]*announceNavigationLoading\(shell, domain\)/u)
  assert.match(runtime, /if \(success\) \{[^]*mobileNavigationState\.activeDomain = domain\.id/u)
  assert.match(runtime, /attempts < 160/u)
})

test('mobile settings keeps real desktop categories and adds mobile summaries without placeholder pages', () => {
  for (const category of ['通用设置', '模型路由', '代理团队', '插件', 'Skills', '电脑与移动端', '浏览器', '定时任务']) {
    assert.match(runtime, new RegExp(category), `missing desktop setting mapping: ${category}`)
  }
  assert.match(runtime, /const buttons = \[\.\.\.nav\.querySelectorAll\('button'\)\]/u)
  assert.match(runtime, /button\.dataset\.harnessMobileSettingsCategory = 'true'/u)
  assert.match(runtime, /button\.dataset\.harnessMobileSettingsSummary = meta\.summary/u)
  assert.doesNotMatch(runtime, /mobileSettingsCategories[^]*data-harness-mobile-settings-placeholder/u)
})

test('official session timeline remains functional and becomes a touch-safe mobile rail', () => {
  assert.match(officialSessionExperience, /function installInlineTimelineRail/u)
  assert.match(officialSessionExperience, /button\.className = "dse-inline-timeline-marker"/u)
  assert.match(officialSessionExperience, /inputActions\.insertReference\(timelineReferenceInsert\(currentItem\)\)/u)
  assert.match(compat, /data-harness-mobile="true"\]:not\(\[data-harness-mobile-chat-detail="open"\]\)\s+\.dse-inline-timeline\s*\{[^}]*display:\s*none !important;/su, 'a stale official rail must never leak onto the home or other domains')
  assert.match(compat, /data-harness-mobile-chat-detail="open"\]\s+\.dse-inline-timeline\s*\{[^}]*display:\s*block !important;[^}]*left:\s*max\(4px, env\(safe-area-inset-left\)\) !important;/su)
  assert.match(compat, /\.dse-inline-timeline-list\s*\{[^}]*width:\s*44px !important;[^}]*border-radius:\s*15px !important;/su)
  assert.match(compat, /\.dse-inline-timeline-marker\s*\{[^}]*width:\s*42px !important;[^}]*height:\s*44px !important;[^}]*touch-action:\s*manipulation !important;/su)
  assert.match(compat, /\.dse-inline-timeline-popover\s*\{[^}]*width:\s*min\(320px, calc\(100vw - 64px\)\) !important;[^}]*overflow:\s*auto !important;/su)
  assert.match(compat, /\.dse-inline-timeline-reference\s*\{[^}]*min-height:\s*44px !important;/su)
  assert.match(compat, /data-harness-mobile-chat-detail="open"\][^{]*data-conversation-view="chat"\][^{]*\[class\*="_scroll"\]\s*\{[^}]*padding-left:\s*calc\(var\(--harness-mobile-page-gutter\) \+ 52px\) !important;/su, 'the rail must own a real gutter instead of covering conversation content')
  assert.match(compat, /@media \(max-width:\s*460px\)[^{]*\{[^]*?\.dse-inline-timeline\s*\{[^}]*display:\s*none !important;/su, 'the rail must disappear when a touch-safe gutter would leave too little reading width')
})

test('Orbit navigation is thumb-safe, selected without color alone, and IME-aware', () => {
  assert.match(compat, /--harness-mobile-nav-height:\s*calc\(58px \+ env\(safe-area-inset-bottom\)\)/u)
  assert.match(compat, /\[data-harness-mobile-navigation\]\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/su)
  assert.match(compat, /\[data-harness-mobile-navigation\] > button\s*\{[^}]*min-height:\s*48px/su)
  assert.match(compat, /button\[aria-selected="true"\] \[data-harness-mobile-domain-icon\]/u)
  assert.match(compat, /button:disabled\s*\{[^}]*opacity:\s*\.48/su)
  assert.match(compat, /padding-bottom:\s*var\(--harness-mobile-nav-height\)\s*!important/u)
  assert.match(compat, /data-harness-mobile-composer-lifted="true"\] \[data-harness-mobile-navigation\][^{]*\{[^}]*visibility:\s*hidden\s*!important/su)
  assert.match(compat, /prefers-reduced-motion:\s*reduce/u)
})
