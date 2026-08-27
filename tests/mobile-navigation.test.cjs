const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const runtime = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js'), 'utf8')
const compat = fs.readFileSync(path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css'), 'utf8')

function sourceIndex(fragment) {
  const index = runtime.indexOf(fragment)
  assert.notEqual(index, -1, `mobile runtime missing contract: ${fragment}`)
  return index
}

test('mobile navigation exposes the stable four-domain order and routes', () => {
  const domains = [
    ["id: 'conversations'", "label: '对话'", "route: '/m/conversations'", "slot: 'navigation.conversations'"],
    ["id: 'agents'", "label: '代理团队'", "route: '/m/agents'", "slot: 'navigation.agents'"],
    ["id: 'tasks'", "label: '定时任务'", "route: '/m/tasks'", "slot: 'navigation.tasks'"],
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
  assert.match(runtime, /\[data-mobile-slot="\$\{domain\.slot\}"\]/u)
  assert.match(runtime, /\[data-slot="agent-teams\.trigger"\] button, button\[data-slot="agent-teams\.trigger"\]/u)
  assert.match(runtime, /\[data-slot="settings\.trigger"\] button, button\[data-slot="settings\.trigger"\]/u)
  assert.doesNotMatch(runtime, /(?:空间|任务|我的)(?:首页|页面).*createElement|createElement\(['"](?:main|article)['"]\)/u)
})

test('missing domain handlers are disabled and explained instead of opening placeholders', () => {
  assert.match(runtime, /button\.disabled = !available/u)
  assert.match(runtime, /button\.setAttribute\('aria-disabled', available \? 'false' : 'true'\)/u)
  assert.match(runtime, /当前工作台未提供此入口/u)
  assert.match(runtime, /入口暂不可用。请在已配对电脑上使用/u)
  assert.match(runtime, /role="status" aria-live="polite" aria-atomic="true"/u)
  assert.match(runtime, /if \(!target \|\| target\.disabled \|\| target\.getAttribute\?\.\('aria-disabled'\) === 'true'\)/u)
})

test('mobile settings keeps real desktop categories and adds mobile summaries without placeholder pages', () => {
  for (const category of ['通用设置', '模型路由', '代理团队', '插件', 'Skills', '电脑与移动端', '浏览器', '定时任务']) {
    assert.match(runtime, new RegExp(category), `missing desktop setting mapping: ${category}`)
  }
  assert.match(runtime, /const buttons = \[\.\.\.nav\.querySelectorAll\('button'\)\]/u)
  assert.match(runtime, /button\.dataset\.harnessMobileSettingsCategory = 'true'/u)
  assert.match(runtime, /button\.dataset\.harnessMobileSettingsSummary = meta\.summary/u)
  assert.doesNotMatch(runtime, /mobileSettingsCategories[^]*createElement\(['"](?:main|article)['"]\)/u)
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
