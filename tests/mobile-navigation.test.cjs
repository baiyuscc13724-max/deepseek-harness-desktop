const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const runtime = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')
const compat = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'), 'utf8')
const iosRuntime = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-runtime.js'), 'utf8')
const iosCompat = fs.readFileSync(path.join(root, 'mobile', 'ios', 'HarnessMobile', 'Resources', 'mobile-compat.css'), 'utf8')
const officialTeams = fs.readFileSync(path.join(root, 'plugins', 'dsh-agent-teams', 'lib', 'client.js'), 'utf8')
const officialSchedules = fs.readFileSync(path.join(root, 'plugins', 'dsh-desktop-schedules', 'lib', 'client.js'), 'utf8')
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

test('Android and iOS mobile navigation resources remain byte-identical', () => {
  assert.equal(iosRuntime, runtime)
  assert.equal(iosCompat, compat)
})

test('mobile navigation only delegates to the versioned bridge or official semantic controls', () => {
  assert.match(runtime, /const bridge = window\.HarnessMobileNavigation/u)
  assert.match(runtime, /bridge && bridge\.version != null && typeof bridge\.navigate === 'function'/u)
  assert.match(runtime, /bridge\.navigate\(domain\.route\)/u)
  assert.match(runtime, /bridge\.getNavigationState/u)
  assert.match(runtime, /bridge\.subscribe\(sync\)/u)
  assert.match(runtime, /harness-mobile-navigation-change/u)
  const bottomTabStart = runtime.indexOf('    for (const domain of mobileDomains) {', runtime.indexOf('const installMobileAppShell'))
  const bottomTabEnd = runtime.indexOf('    presentationRoot.appendChild(shell)', bottomTabStart)
  assert.ok(bottomTabStart >= 0 && bottomTabEnd > bottomTabStart)
  const bottomTabBinding = runtime.slice(bottomTabStart, bottomTabEnd)
  assert.match(bottomTabBinding, /addEventListener\('click', \(\) => \{[^]*navigateMobileDomain\(domain, shell\)/u)
  assert.doesNotMatch(bottomTabBinding, /harnessMobileChatDetail|preventDefault|stopPropagation/u, 'a visible domain tab must navigate even while conversation detail is open')
  assert.match(runtime, /root\.dataset\.harnessMobileChatDetail === 'open'/u, 'back navigation still recognizes an open conversation detail')
  assert.match(runtime, /const mobileSlotNames = domain => \[domain\.slot, \.\.\.\(mobileSlotAliases\[domain\.id\] \|\| \[\]\)\]/u)
  assert.match(runtime, /for \(const slot of mobileSlotNames\(domain\)\)/u, 'the primary slot must be queried before DOM-ordered aliases')
  assert.match(runtime, /agents: Object\.freeze\(\['navigation\.agents'\]\)/u)
  assert.match(runtime, /tasks: Object\.freeze\(\['navigation\.tasks'\]\)/u)
  assert.match(runtime, /\[data-slot="agent-teams\.trigger"\] button, button\[data-slot="agent-teams\.trigger"\]/u)
  assert.match(runtime, /\[data-slot="settings\.trigger"\] button, button\[data-slot="settings\.trigger"\]/u)
  assert.match(runtime, /const scheduledTaskLabel[^]*已安排的任务\|Scheduled tasks\|定时任务/u)
  assert.match(runtime, /const officialScheduledTaskTarget[^]*\.hd-conversation-more-action/u)
  assert.match(runtime, /\[data-conversation-view="desktop-schedules"\]/u)
  assert.doesNotMatch(runtime, /(?:空间|任务|我的)(?:首页|页面).*createElement|data-harness-mobile-domain-placeholder/u)
})

function exerciseBottomTabFromStaleConversationDetail(domainId) {
  const start = runtime.indexOf('    for (const domain of mobileDomains) {', runtime.indexOf('const installMobileAppShell'))
  const end = runtime.indexOf('    presentationRoot.appendChild(shell)', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  let click = null
  const tab = { addEventListener: (type, listener) => { if (type === 'click') click = listener } }
  const shell = { querySelector: selector => selector === `[data-harness-mobile-domain="${domainId}"]` ? tab : null }
  const mobileMenu = { hidden: false }
  const domain = { id: domainId, slot: domainId === 'agents' ? 'agent-teams.view.canvas' : 'agent-teams.view.automation' }
  const navigations = []
  const root = { dataset: { harnessMobileChatDetail: 'open' } }
  const composer = {}
  const visibleConversation = { querySelector: selector => selector === '[data-composer-card]' ? composer : null }
  const document = { querySelector: selector => selector === '[data-harness-mobile-conversation="true"]' ? visibleConversation : null }
  const suppressions = { preventDefault: 0, stopPropagation: 0 }
  new Function('mobileDomains', 'shell', 'mobileMenu', 'navigateMobileDomain', 'root', 'document', 'visible', source) ( // eslint-disable-line no-new-func
    [domain], shell, mobileMenu, selected => navigations.push(selected.id), root, document, candidate => candidate === visibleConversation
  )
  assert.equal(typeof click, 'function')
  click({
    preventDefault: () => { suppressions.preventDefault += 1 },
    stopPropagation: () => { suppressions.stopPropagation += 1 }
  })
  return { mobileMenu, navigations, root, suppressions }
}

for (const fixture of [
  { id: 'agents', label: 'Agent Teams' },
  { id: 'tasks', label: 'scheduled tasks' }
]) {
  test(`${fixture.label} bottom tab navigates through a stale open detail marker without suppressing the event`, () => {
    const result = exerciseBottomTabFromStaleConversationDetail(fixture.id)
    assert.equal(result.mobileMenu.hidden, true)
    assert.deepEqual(result.navigations, [fixture.id])
    assert.deepEqual(result.suppressions, { preventDefault: 0, stopPropagation: 0 })
    assert.equal(result.root.dataset.harnessMobileChatDetail, 'open', 'domain activation owns the eventual state transition')
  })
}

test('back derives an existing conversation detail from visible composer when state marker lags', () => {
  assert.match(runtime, /const isMobileConversationDetailOpen = \(\) => \{/u)
  assert.match(runtime, /if \(root\.dataset\.harnessMobileChatDetail === 'open'\) return true/u)
  assert.match(runtime, /mobileNavigationState\.activeDomain !== 'conversations' \|\| sidebarExpanded\(\)/u)
  assert.match(runtime, /conversation\?\.querySelector\?\.\('\[data-composer-card\]'\) && visible\(conversation\)/u)
  assert.match(runtime, /if \(isMobileConversationDetailOpen\(\)\) \{/u)
  assert.equal(iosRuntime, runtime, 'Android and iOS must apply the same stale-state back fallback')
})

test('expanding a project never closes the sidebar or focuses the conversation composer', () => {
  const start = runtime.indexOf('  const installSidebarAutoClose = () => {')
  const end = runtime.indexOf('  const appIcon = name => {', start)
  assert.ok(start >= 0 && end > start)
  const listeners = {}
  const timers = []
  const closed = []
  const chatClicks = []
  let released = 0
  const window = { __harnessMobileSidebarAutoClose: false, matchMedia: () => ({ matches: true }) }
  const document = { addEventListener: (name, listener) => { listeners[name] = listener } }
  const install = new Function('window', 'document', 'setTimeout', 'sidebarExpanded', 'setSidebarExpanded', 'officialChatTarget', 'releaseComposerFocus', `${runtime.slice(start, end)}\nreturn installSidebarAutoClose`) // eslint-disable-line no-new-func
    (window, document, callback => { timers.push(callback) }, () => true, value => closed.push(value), () => ({ disabled: false, getAttribute: () => null, click: () => chatClicks.push('chat') }), () => { released += 1 })
  install()
  const sidebar = {}
  const projectRow = { dataset: { harnessMobileProjectRow: 'true' }, hasAttribute: name => name === 'aria-expanded', closest: selector => selector === '[data-slot="sidebar"]' ? sidebar : null }
  const projectTarget = {
    closest(selector) {
      if (selector.includes('harness-mobile-session-row')) return projectRow
      if (selector.includes('button,a,input')) return null
      if (selector.includes('harness-mobile-project-row')) return projectRow
      return null
    }
  }
  listeners.click({ target: projectTarget })
  assert.equal(released, 1)
  assert.deepEqual(timers, [])
  assert.deepEqual(closed, [])
  assert.deepEqual(chatClicks, [])
})

test('mobile domains bind the official Agent Teams canvas and desktop scheduled-tasks view', () => {
  assert.match(officialTeams, /"data-mobile-slot": item\.id === "projectTasks" \? "navigation\.tasks" : item\.id === "board" \? "navigation\.agents" : "agent-teams\.view\." \+ item\.id/u)
  assert.match(officialSchedules, /id: "desktop-schedules"/u)
  assert.match(officialSchedules, /className: "dds-view", "aria-labelledby": "dds-title"/u)
  assert.match(runtime, /id: 'agents'[^\n]*slot: 'agent-teams\.view\.canvas'/u)
  assert.match(runtime, /const officialScheduledTasksContent = \(\) =>/u)
})

test('Agent Teams prefers the canvas slot over earlier DOM-ordered legacy tabs', async () => {
  const selectorStart = runtime.indexOf('  const mobileSlotAliases = Object.freeze({')
  const selectorEnd = runtime.indexOf('  const bridgeNavigationState = bridge => {', selectorStart)
  const workspaceStart = runtime.indexOf('  const officialWorkspaceContent = (workbench, domain) => {')
  const workspaceEnd = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', workspaceStart)
  assert.ok(selectorStart >= 0 && selectorEnd > selectorStart && workspaceStart >= 0 && workspaceEnd > workspaceStart)
  const source = `${runtime.slice(selectorStart, selectorEnd)}\n${runtime.slice(workspaceStart, workspaceEnd)}`
  const clicks = []
  let canvasSelected = false
  const primaryCanvas = { disabled: false, textContent: '团队画布', matches: () => true, getAttribute: name => name === 'aria-current' && canvasSelected ? 'page' : null, click: () => { canvasSelected = true; clicks.push('canvas') } }
  const legacyBoard = { disabled: false, textContent: '任务板', matches: () => true, getAttribute: () => 'page', click: () => clicks.push('board') }
  const content = { childElementCount: 1, textContent: '权威画布内容' }
  const workbench = {
    textContent: 'Agent Teams 权威工作区',
    querySelector(selector) {
      if (selector === '[data-mobile-slot="agent-teams.view.canvas"]') return primaryCanvas
      if (selector === '[data-mobile-slot="navigation.agents"]') return legacyBoard
      if (selector.includes('agent-teams.canvas')) return content
      return null
    },
    querySelectorAll: () => [],
    scrollTo() {}
  }
  const document = {
    querySelector: selector => selector.includes('agent-teams.workspace') ? workbench : null,
    querySelectorAll: () => []
  }
  const root = { dataset: {} }
  const mobileDomains = [{ id: 'agents', slot: 'agent-teams.view.canvas' }]
  const open = new Function('document', 'root', 'setTimeout', 'Promise', 'mobileDomains', 'decorateAgentTeamsWorkbench', 'clearNavigationNotice', 'announceNavigationUnavailable', 'accessibleButtonText', `${source}\nreturn openOfficialAgentCanvas`) // eslint-disable-line no-new-func
    (document, root, callback => callback(), Promise, mobileDomains, () => {}, () => {}, () => {}, node => node.textContent || '')
  assert.equal(await open({}), true)
  assert.deepEqual(clicks, ['canvas'])
  assert.equal(root.dataset.harnessMobileAgentDetailOpen, 'true')
})

test('scheduled tasks opens the official secondary view and waits for real content', async () => {
  const selectorStart = runtime.indexOf('  const mobileSlotAliases = Object.freeze({')
  const selectorEnd = runtime.indexOf('  const bridgeNavigationState = bridge => {', selectorStart)
  const workspaceStart = runtime.indexOf('  const officialWorkspaceContent = (workbench, domain) => {')
  const workspaceEnd = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', workspaceStart)
  const source = `${runtime.slice(selectorStart, selectorEnd)}\n${runtime.slice(workspaceStart, workspaceEnd)}`
  const clicks = []
  let menuOpen = false
  let viewOpen = false
  const more = { disabled: false, textContent: '•••', getAttribute: name => name === 'aria-label' ? '更多视图' : null, click: () => { clicks.push('more'); menuOpen = true } }
  const scheduled = { disabled: false, textContent: '已安排的任务', getAttribute: () => null, click: () => { clicks.push('tasks'); viewOpen = true } }
  const content = { textContent: '已安排的任务 暂无定时任务' }
  const view = { querySelector: () => content }
  const document = {
    querySelector(selector) {
      if (selector.includes('data-conversation-view="desktop-schedules"')) return viewOpen ? view : null
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes('hd-conversation-more-action')) return menuOpen ? [scheduled] : []
      if (selector.includes('header button')) return [more]
      return []
    }
  }
  const mobileDomains = [{ id: 'tasks', slot: 'agent-teams.view.automation' }]
  const open = new Function('document', 'root', 'setTimeout', 'Promise', 'mobileDomains', 'decorateAgentTeamsWorkbench', 'clearNavigationNotice', 'announceNavigationUnavailable', 'accessibleButtonText', `${source}\nreturn openOfficialScheduledTasks`) // eslint-disable-line no-new-func
    (document, { dataset: {} }, callback => callback(), Promise, mobileDomains, () => {}, () => {}, () => {}, node => node.textContent || '')
  assert.equal(await open({}), true)
  assert.deepEqual(clicks, ['more', 'tasks'])
})

test('Agent Teams navigation waits for a delayed official opener instead of failing immediately', async () => {
  const selectorStart = runtime.indexOf('  const mobileSlotAliases = Object.freeze({')
  const selectorEnd = runtime.indexOf('  const bridgeNavigationState = bridge => {', selectorStart)
  const workspaceStart = runtime.indexOf('  const officialWorkspaceContent = (workbench, domain) => {')
  const workspaceEnd = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', workspaceStart)
  const source = `${runtime.slice(selectorStart, selectorEnd)}\n${runtime.slice(workspaceStart, workspaceEnd)}`
  let triggerChecks = 0
  let opened = false
  let selected = 0
  const opener = { disabled: false, getAttribute: () => null, click: () => { opened = true } }
  const control = { disabled: false, textContent: '代理团队', matches: () => true, getAttribute: name => name === 'aria-current' && selected > 0 ? 'page' : null, click: () => { selected += 1 } }
  const content = { childElementCount: 1, textContent: '真实代理团队内容' }
  const workbench = {
    textContent: 'Agent Teams 权威工作区',
    querySelector(selector) {
      if (selector.includes('navigation.agents')) return control
      if (selector.includes('agent-teams.canvas')) return content
      return null
    },
    querySelectorAll: () => [],
    scrollTo() {}
  }
  const document = {
    querySelector(selector) {
      if (selector.includes('agent-teams.workspace')) return opened ? workbench : null
      if (selector.includes('agent-teams.trigger')) return ++triggerChecks >= 3 ? opener : null
      return null
    },
    querySelectorAll: () => []
  }
  const root = { dataset: {} }
  const mobileDomains = [{ id: 'agents', slot: 'agent-teams.view.canvas' }]
  const open = new Function('document', 'root', 'setTimeout', 'Promise', 'mobileDomains', 'decorateAgentTeamsWorkbench', 'clearNavigationNotice', 'announceNavigationUnavailable', 'accessibleButtonText', `${source}\nreturn openOfficialAgentCanvas`) // eslint-disable-line no-new-func
    (document, root, callback => callback(), Promise, mobileDomains, () => {}, () => {}, () => {}, node => node.textContent || '')
  assert.equal(await open({}), true)
  assert.equal(triggerChecks, 3)
  assert.equal(selected, 1)
})

test('Agent Teams accepts an authoritative mounted loading or reconnecting workspace', async () => {
  const selectorStart = runtime.indexOf('  const mobileSlotAliases = Object.freeze({')
  const selectorEnd = runtime.indexOf('  const bridgeNavigationState = bridge => {', selectorStart)
  const workspaceStart = runtime.indexOf('  const officialWorkspaceContent = (workbench, domain) => {')
  const workspaceEnd = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', workspaceStart)
  const source = `${runtime.slice(selectorStart, selectorEnd)}\n${runtime.slice(workspaceStart, workspaceEnd)}`
  const control = { disabled: false, textContent: '团队画布', matches: () => true, getAttribute: name => name === 'aria-current' ? 'page' : null }
  const workspace = { childElementCount: 0, textContent: '' }
  const heading = { textContent: '代理团队 正在重新连接' }
  const workbench = {
    textContent: '代理团队 正在重新连接',
    querySelector(selector) {
      if (selector === '[data-mobile-slot="agent-teams.view.canvas"]') return control
      if (selector === '.dat-workspace-main') return workspace
      if (selector === '.dat-head, #dat-view-title') return heading
      return null
    },
    querySelectorAll: () => [],
    scrollTo() {}
  }
  const document = { querySelector: selector => selector.includes('agent-teams.workspace') ? workbench : null, querySelectorAll: () => [] }
  const root = { dataset: {} }
  const unavailable = []
  const mobileDomains = [{ id: 'agents', slot: 'agent-teams.view.canvas' }]
  const open = new Function('document', 'root', 'setTimeout', 'Promise', 'mobileDomains', 'decorateAgentTeamsWorkbench', 'clearNavigationNotice', 'announceNavigationUnavailable', 'accessibleButtonText', `${source}\nreturn openOfficialAgentCanvas`) // eslint-disable-line no-new-func
    (document, root, callback => callback(), Promise, mobileDomains, () => {}, () => {}, (_shell, domain) => unavailable.push(domain.id), node => node.textContent || '')
  assert.equal(await open({}), true)
  assert.deepEqual(unavailable, [])
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
  const settle = new Function('mobileNavigationState', 'Promise', 'clearNavigationNotice', 'announceNavigationLoading', 'announceNavigationUnavailable', 'syncMobileAppShell', 'guardedMobileDomain', `${source}\nreturn settleMobileDomain`) // eslint-disable-line no-new-func
    (state, Promise, () => {}, (_shell, domain) => notices.push(`loading:${domain.id}`), (_shell, domain) => errors.push(domain.id), () => {}, domain => ['agents', 'tasks', 'me'].includes(domain.id))
  settle({ id: 'tasks' }, {}, false)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(state.activeDomain, 'conversations')
  assert.deepEqual(notices, ['loading:tasks'])
  assert.deepEqual(errors, ['tasks'])
  assert.match(compat, /\[data-harness-mobile-navigation-status\]\[data-visible="true"\][^{]*\{[^}]*z-index:\s*960 !important/su)
})

test('我的 resolves the semantic settings slot before generic sidebar dialogs', () => {
  const start = runtime.indexOf('  const mobileSlotAliases = Object.freeze({')
  const end = runtime.indexOf('  const bridgeNavigationState = bridge => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  const trigger = { getAttribute: name => name === 'aria-haspopup' ? 'dialog' : null }
  const slot = { matches: () => false, querySelector: () => trigger, closest: () => null }
  const generic = { getAttribute: name => name === 'aria-haspopup' ? 'dialog' : null }
  let genericQueries = 0
  const sidebar = { querySelectorAll: () => [generic] }
  const document = {
    querySelector: selector => selector === '[data-slot="settings.trigger"] button, button[data-slot="settings.trigger"]' ? trigger : selector.includes('settings.trigger') ? slot : null,
    querySelectorAll: () => []
  }
  const target = new Function('document', 'sidebarNode', 'accessibleButtonText', `${source}\nreturn officialMobileTarget`)
    (document, () => { genericQueries += 1; return sidebar }, () => '')
  assert.equal(target({ id: 'me', slot: 'navigation.me' }), trigger)
  assert.equal(genericQueries, 0, 'My must resolve the semantic settings slot before generic sidebar dialogs')
})

test('我的 opens only the authoritative full settings surface', () => {
  const start = runtime.indexOf('  const navigateMobileDomain = (domain, shell) => {')
  const end = runtime.indexOf('  const syncMobileNavigation = shell => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  assert.doesNotMatch(source, /mobileNavigationState\.activeDomain = 'me'/u, 'do not expose a second mobile-owned settings page while official settings loads')
  assert.match(source, /if \(domain\.id !== 'me' && root\.dataset\.harnessMobileSettingsOpen === 'true'\)/u)
  assert.match(runtime, /if \(domain\.id === 'me'\) \{[\s\S]*return waitForOfficialSettings\(shell\)/u)
  assert.match(runtime, /shell\.querySelector\('\[data-harness-mobile-my-surface\]'\)\?\.remove\(\)/u)
  assert.match(runtime, /surface\.dataset\.harnessMobileSettingsDialog = 'true'\s+root\.dataset\.harnessMobileSettingsOpen = 'true'/u)
  assert.match(runtime, /if \(!settingsOpen\) \{[\s\S]*const page = officialSettingsSurface\(\)[\s\S]*visibleOfficialSettingsDialog\(page\)[\s\S]*settingsOpen = true/u)
  assert.match(runtime, /nativeClose\.click\(\)[\s\S]*mobileNavigationState\.activeDomain = 'conversations'[\s\S]*syncMobileAppShell\(\)/u)
  assert.doesNotMatch(source, /桌面设置暂未就绪；“我的”页面仍可继续使用/u)
  assert.match(runtime, /mobileNavigationState\.activeDomain === 'conversations' && !shell\.dataset\.harnessMobileConversationHomeOpened/u)
})

test('official settings host remains interactive during mobile presentation isolation', () => {
  const start = runtime.indexOf('  const syncMobilePresentationIsolation = (domain, shell) => {')
  const end = runtime.indexOf('  const syncMobileComposerInputLayout = input => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  const settings = { contains: () => false }
  const makeSurface = containsSettings => ({
    dataset: {},
    hidden: false,
    inert: false,
    contains: node => containsSettings && node === settings,
    setAttribute(name, value) { this[name] = value }
  })
  const host = makeSurface(true)
  const unrelated = makeSurface(false)
  const document = {
    querySelector: selector => selector === '[data-harness-mobile-settings-dialog="true"]' ? settings : null,
    querySelectorAll: () => [host, unrelated]
  }
  const isolate = new Function('document', 'root', `${source}\nreturn syncMobilePresentationIsolation`) // eslint-disable-line no-new-func
    (document, { dataset: {} })
  isolate('me', { contains: () => false })
  assert.equal(host.inert, false)
  assert.equal(host.hidden, false)
  assert.equal(host['aria-hidden'], 'false')
  assert.equal(unrelated.inert, true)
  assert.equal(unrelated.hidden, true)
  assert.equal(unrelated['aria-hidden'], 'true')
  assert.match(source, /surface\.contains\?\.\(settingsSurface\)/u)
})

test('我的 waits for an unobscured official settings dialog before committing', async () => {
  const start = runtime.indexOf('  const visibleOfficialSettingsDialog = dialog => {')
  const end = runtime.indexOf('  const activateOfficialDomain = (domain, shell) => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  let clicked = 0
  let targetChecks = 0
  let hit = {}
  const target = { disabled: false, getAttribute: () => null, click: () => { clicked += 1 } }
  const nav = { nextElementSibling: {}, querySelectorAll: () => [{}, {}, {}] }
  const child = {}
  const dialog = {
    textContent: '设置 通用设置 模型路由',
    querySelector: selector => selector === ':scope > nav' ? nav : null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 360, bottom: 640, width: 360, height: 640 }),
    contains: node => node === child
  }
  const document = {
    documentElement: { clientWidth: 360, clientHeight: 640 },
    querySelector: selector => selector.includes('settings-dialog') && clicked ? dialog : null,
    elementFromPoint: () => hit
  }
  const mobileDomains = [{ id: 'me' }]
  const style = { opacity: '1', pointerEvents: 'auto' }
  const visibility = new Function('visible', 'getComputedStyle', 'window', 'document', `${source}\nreturn visibleOfficialSettingsDialog`) // eslint-disable-line no-new-func
    (() => true, () => style, { innerWidth: 360, innerHeight: 640 }, document)
  assert.equal(visibility(dialog), false, 'covered DOM must not count as visible settings')
  hit = child
  assert.equal(visibility(dialog), true)
  const waitForSettings = new Function('document', 'decorateDialogs', 'clearNavigationNotice', 'mobileDomains', 'officialMobileTarget', 'visible', 'getComputedStyle', 'window', 'setTimeout', 'Promise', 'announceNavigationUnavailable', `${source}\nreturn waitForOfficialSettings`) // eslint-disable-line no-new-func
    (document, () => {}, () => {}, mobileDomains, () => ++targetChecks >= 3 ? target : null, () => true, () => style, { innerWidth: 360, innerHeight: 640 }, callback => callback(), Promise, () => {})
  assert.equal(await waitForSettings({}), true)
  assert.equal(targetChecks, 3)
  assert.equal(clicked, 1)
  assert.doesNotMatch(source, /setSidebarExpanded/u)
  assert.match(source, /attempts < 160/u)
  assert.match(compat, /data-harness-mobile-settings-open="true"[^}]*_sidebarCol[^}]*z-index:\s*600 !important/su)
  assert.match(compat, /data-harness-mobile-settings-open="true"\]\[data-harness-mobile-drawer\][^}]*sidebar\.settings[^}]*display:\s*block !important/su)
  assert.doesNotMatch(compat, /data-harness-mobile-settings-open="true"\]\s+#harness-mobile-app-shell\s*\{[^}]*display:\s*none/su)
})

test('settings is reachable only through 我的, never the conversation action menu', () => {
  const menuSource = runtime.slice(runtime.indexOf('const renderMobileMenu'), runtime.indexOf('const readAuthoritativeProjects'))
  assert.doesNotMatch(menuSource, /settings\.trigger|sidebar\.settings|textContent = '设置'/u)
  assert.match(runtime, /id: 'me', label: '我的', route: '\/m\/me', slot: 'navigation\.me'/u)
})

test('guarded domains stay actionable while delayed handlers mount and never report false success', () => {
  assert.match(runtime, /const guardedMobileDomain = domain => domain\.id === 'agents' \|\| domain\.id === 'tasks' \|\| domain\.id === 'me'/u)
  assert.match(runtime, /const available = guardedMobileDomain\(domain\) \|\| bridgeSupportsDomain\(bridge, state, domain\) \|\| officialDomainAvailable\(domain\)/u)
  assert.match(runtime, /button\.disabled = !available/u)
  assert.match(runtime, /button\.setAttribute\('aria-disabled', available \? 'false' : 'true'\)/u)
  assert.match(runtime, /暂时无法打开：桌面工作台尚未提供完整内容/u)
  assert.match(runtime, /role="status" aria-live="polite" aria-atomic="true"/u)
  assert.match(runtime, /const guarded = guardedMobileDomain\(domain\)/u)
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

test('drawer accessibility leaves the visible bottom navigation actionable', () => {
  const start = runtime.indexOf('  const syncDrawerAccessibility = (shell, expanded) => {')
  const end = runtime.indexOf('  const installSidebarAutoClose = () => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  assert.match(source, /if \(appbar\) \{[^]*appbar\.inert = expanded/su)
  assert.match(source, /if \(navigation\) \{[^]*navigation\.inert = false[^]*removeAttribute\('inert'\)[^]*aria-hidden', 'false'/su)
  assert.doesNotMatch(source, /for \(const region of \[appbar, navigation\]\)/u)
  assert.equal(iosRuntime, runtime)
})

test('official navigation opens the real header menu before selecting unmounted domains', () => {
  const start = runtime.indexOf('  const mobileSlotAliases = Object.freeze({')
  const end = runtime.indexOf('  const bridgeNavigationState = bridge => {', start)
  assert.ok(start >= 0 && end > start)
  const source = runtime.slice(start, end)
  let menuOpen = false
  let menuClicks = 0
  const more = {
    title: '',
    getAttribute: name => name === 'aria-haspopup' ? 'menu' : null,
    closest: () => null,
    click: () => { menuOpen = true; menuClicks += 1 }
  }
  const agent = { textContent: '代理团队', getAttribute: () => null, click: () => {} }
  const document = {
    querySelector: () => null,
    querySelectorAll: selector => {
      if (selector.includes('[role="menu"]')) return menuOpen ? [agent] : []
      if (selector.includes('header button')) return [more]
      return []
    }
  }
  const target = new Function('document', 'sidebarNode', 'accessibleButtonText', `${source}\nreturn officialMobileTarget`)
    (document, () => null, node => node.textContent || '')
  const domain = { id: 'agents', slot: 'agent-teams.view.canvas' }
  assert.equal(target(domain), more)
  more.click()
  assert.equal(target(domain), agent)
  assert.equal(menuClicks, 1)
})

test('settings activation accepts the real page surface when no dialog is mounted', () => {
  assert.match(runtime, /const officialSettingsSurface = \(\) => \{/u)
  assert.match(runtime, /\[data-slot="settings\.page"\]/u)
  assert.match(runtime, /\[data-slot="settings"\]/u)
  assert.match(runtime, /MuMu and newer desktop builds expose settings as a page/u)
  assert.match(runtime, /surface\.dataset\.harnessMobileSettingsDialog = 'true'/u)
  assert.equal(iosRuntime, runtime)
})
