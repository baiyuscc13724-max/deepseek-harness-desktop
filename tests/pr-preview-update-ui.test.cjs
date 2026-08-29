const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const integrationPath = path.join(root, 'renderer/pr-preview-update-integration.js')
const cssPath = path.join(root, 'renderer/pr-preview-update.css')
const integration = readFileSync(integrationPath, 'utf8')
const css = readFileSync(cssPath, 'utf8')
const index = readFileSync(path.join(root, 'renderer/index.html'), 'utf8')
const app = readFileSync(path.join(root, 'renderer/app.js'), 'utf8')
const appStateStore = readFileSync(path.join(root, 'electron/store/app-state-store.cjs'), 'utf8')

// 在 node 中加载模块（IIFE 挂到 globalThis），用于纯函数契约校验；
// DOM 部分保持静态断言，不引入浏览器依赖。
require(integrationPath)
const uiModule = globalThis.harnessPrPreviewUpdateIntegration

test('设置页不再挂载三版本卡，主界面只保留单一版本入口', () => {
  assert.doesNotMatch(index, /pr-preview-update-(?:integration\.js|css)/)
  assert.doesNotMatch(app, /row\.id = 'harness-desktop-update-row'/)
  assert.doesNotMatch(app, /<div class="hd-update-line"><span>Harness Desktop/)
  assert.match(app, /trigger\.id = 'harness-desktop-version-button'/)
  assert.match(app, /center\.id = 'harness-desktop-update-center'/)
  assert.match(app, /aria-haspopup', 'dialog'/)
  assert.match(app, /aria-expanded', 'false'/)
  assert.match(app, /createTextNode\('span', 'hd-version-marker', '#'\)/)
  const versionStyle = app.match(/#harness-desktop-version-button \{[^}]+\}/)?.[0] || ''
  assert.match(versionStyle, /bottom:1px/)
  assert.match(versionStyle, /border:0/)
  assert.match(versionStyle, /background:transparent/)
  assert.match(versionStyle, /box-shadow:none/)
  assert.doesNotMatch(versionStyle, /border-radius:18px|min-height:36px/)
  assert.match(appStateStore, /previewEnabled: true/)
})

test('版本入口消费 displayVersion 和 pendingCount，打开中心不会清零', () => {
  assert.match(app, /state\.displayVersion/)
  assert.match(app, /state\.pendingCount/)
  assert.match(app, /`\(\+\$\{pendingCount\}\)`/)
  assert.match(app, /`v\$\{displayVersion\.replace\(\/\^v\/iu, ''\)\}`/)
  assert.match(app, /trigger\.dataset\.pending = String\(pendingCount > 0\)/)
  const openHandler = app.match(/trigger\.addEventListener\('click',[\s\S]{0,500}?\n      \}\)/)?.[0] || ''
  assert.ok(openHandler, '必须注册版本入口打开动作')
  assert.doesNotMatch(openHandler, /pendingCount\s*=|\.pendingCount\s*=/, '打开更新中心不得清空待更新计数')
})

test('相同 items 使用稳定签名跳过 replaceChildren，避免 MutationObserver 重绘循环', () => {
  assert.match(app, /const itemsSignature = JSON\.stringify\(\{ checking: state\.checking === true, items \}\)/)
  assert.match(app, /if \(list\.dataset\.signature !== itemsSignature\)/)
  assert.match(app, /list\.dataset\.signature = itemsSignature[\s\S]{0,180}list\.replaceChildren/)
})

test('无更新版本行不显示，过滤后空列表显示当前已是最新', () => {
  assert.match(app, /const shouldDisplayUpdateItem = item => item && !\(\['desktop', 'component', 'harness'\]\.includes\(item\.kind\) && \['up-to-date', 'disabled'\]\.includes\(item\.status\)\)/)
  assert.match(app, /\.filter\(shouldDisplayUpdateItem\)/)
  assert.match(app, /state\.checking \? '正在检查可用更新…' : '当前已是最新'/)
})

test('更新中心逐条渲染 items，并只为 active 预览提供一个全局退出入口', () => {
  assert.match(app, /Array\.isArray\(state\.items\)/)
  assert.match(app, /items\.map\(buildUpdateItem\)/)
  assert.match(app, /if \(item\.details\.length\)[\s\S]*hd-update-detail-list[\s\S]*item\.details\.map\(detail => createTextNode\('li'/)
  for (const field of ['id', 'kind', 'version', 'title', 'summary', 'details', 'source', 'signed', 'actionable', 'status', 'pr', 'expiresAt']) {
    assert.match(app, new RegExp(`\\b${field}:`), `缺少更新项字段 ${field}`)
  }
  assert.match(app, /立即检查/)
  assert.match(app, /立即更新/)
  assert.match(app, /data-hd-exit-preview hidden>退出当前预览/)
  assert.match(app, /item\.status === 'active'/)
  const itemBuilder = app.match(/const buildUpdateItem = item => \{[\s\S]*?\n  \}/)?.[0] || ''
  assert.doesNotMatch(itemBuilder, /退出预览/, '每张 PR 候选卡不得重复提供退出按钮')
  assert.match(itemBuilder, /item\.status === 'ready' \? 'apply' : item\.status === 'available' \? 'install' : null/)
  assert.match(itemBuilder, /if \(action && item\.actionable && item\.signed && item\.id\)/)
  assert.doesNotMatch(itemBuilder, /item\.status === 'active'[^\n]*\? ['"](?:apply|install)/, 'active PR 卡不得出现更新或应用动作')
  const centerMarkup = app.match(/center\.innerHTML = `[\s\S]*?`/)?.[0] || ''
  assert.doesNotMatch(centerMarkup, /<input|data-hd-auto|data-hd-preview/)
  assert.match(centerMarkup, /data-hd-check>立即检查/)
  assert.match(centerMarkup, /data-hd-exit-preview hidden>退出当前预览/)
})

test('PR 预览在原卡片内显示下载、校验、安装和重启进度且不反复替换列表', () => {
  assert.match(app, /const previewProgressSteps = \['下载', '校验', '安装', '重启'\]/)
  for (const phase of ['prepare', 'download', 'verify', 'commit', 'ready', 'apply', 'restart', 'error']) {
    assert.match(app, new RegExp(`['"]${phase}['"]`), `缺少预览进度阶段 ${phase}`)
  }
  assert.match(app, /progress\.phase === 'download' && progress\.total > 0/)
  assert.match(app, /Math\.round\(progress\.received \/ progress\.total \* 100\)/)
  assert.match(app, /document\.createElement\('progress'\)/)
  assert.match(app, /region\.setAttribute\('role', 'status'\)/)
  assert.match(app, /region\.setAttribute\('aria-live', 'polite'\)/)
  assert.match(app, /card\.setAttribute\('aria-busy', String\(busy\)\)/)
  assert.match(app, /action\.disabled = busy/)
  assert.match(app, /progress\.phase === 'error' \? '重试更新' : '更新进行中…'/)
  assert.match(app, /previewProgressForItem\(item, previewProgress\)/)
  assert.match(app, /if \(updateBusy\) \{[\s\S]*list\.querySelectorAll\('\[data-hd-update-action\]'\)[\s\S]*action\.disabled = true/)
  assert.match(app, /list\.setAttribute\('aria-busy', String\(updateBusy\)\)/)
  assert.match(app, /const itemsSignature = JSON\.stringify\(\{ checking: state\.checking === true, items \}\)/)
})

test('桌面版与正式组件在原卡片内显示校验、下载、准备和安装进度', () => {
  assert.match(app, /const installProgressPhases = new Set\(\['prepare', 'checksum', 'download', 'verify', 'commit', 'ready', 'apply', 'launch', 'restart', 'current', 'error'\]\)/)
  assert.match(app, /const normalizeInstallProgress = value =>/)
  assert.match(app, /const installProgressForItem = \(item, progress\) =>/)
  assert.match(app, /const paintInstallProgress = \(card, item, progress\) =>/)
  assert.match(app, /progress\.phase === 'download' && progress\.total > 0/)
  assert.match(app, /Math\.round\(progress\.received \/ progress\.total \* 100\)/)
  assert.match(app, /region\.dataset\.hdInstallProgress = ''/)
  assert.match(app, /progress\.phase === 'error' \? '重试更新' : busy \? '更新进行中…'/)
  assert.match(app, /const updateBusy = previewBusy \|\| installBusy/)
  assert.match(app, /setText\(apply, '正在启动…'\)[\s\S]*request\('update-action', \{ id: item\.id, action \}\)/)
  assert.match(app, /setTimeout\(\(\) => \{[\s\S]*更新请求未收到响应，请重试。/)
  assert.match(app, /installProgress: previewAction[\s\S]*phase: action === 'apply' \? 'apply' : 'prepare'/)
  assert.match(app, /installProgress: previewAction[\s\S]*failedPhase: String\(previousInstall\.phase \|\| 'prepare'\), phase: 'error', message/)
  assert.match(app, /installProgress: \{ kind: 'desktop', id: 'desktop', \.\.\.progress \}/)
  assert.match(app, /installProgress: \{ kind: 'component', id: 'component', \.\.\.progress \}/)
  assert.match(app, /const busy = !\['ready', 'current', 'error'\]\.includes\(phase\)/)
})

test('自动检测保持可见且主按钮不会因主题色变成伪禁用态', () => {
  const centerMarkup = app.match(/center\.innerHTML = `[\s\S]*?`/)?.[0] || ''
  assert.match(centerMarkup, /data-hd-check-mode/)
  assert.match(centerMarkup, /自动检查已开启 · 启动后检查/)
  assert.match(app, /state\.preferences\?\.lastCheckedAt/)
  assert.match(app, /自动检查已开启 · 上次/)
  assert.match(app, /checkError: message/)
  assert.match(app, /refreshPrPreviewState\(\{ discover: !unifiedCheck \}\)/)
  const primaryStyle = app.match(/\.hd-update-item-actions \.hd-update-apply \{[^}]+\}/)?.[0] || ''
  assert.match(primaryStyle, /--dsw-alias-label-primary/)
  assert.match(primaryStyle, /color-mix/)
  assert.doesNotMatch(primaryStyle, /color:#fff/)
})

test('预览进度事件绑定 opaque 候选并在失败后保留可见重试状态', () => {
  assert.match(app, /candidateId: safeId[\s\S]*phase: action === 'apply' \? 'apply' : 'prepare'/)
  assert.match(app, /api\.onPrPreviewUpdateProgress\(progress => \{[\s\S]*progress, error: ''[\s\S]*installing: busy/)
  assert.match(app, /failedPhase: String\(previous\.phase \|\| 'prepare'\), phase: 'error', message/)
})

test('更新动作只回传 opaque id 与固定 action，不传 kind、URL 或 PR 数据', () => {
  assert.match(app, /request\('update-action', \{ id: item\.id, action \}\)/)
  assert.match(app, /new URLSearchParams\(values\)/)
  assert.match(app, /target\.searchParams\.get\('id'\)/)
  assert.match(app, /target\.searchParams\.get\('action'\)/)
  assert.match(app, /new Set\(\['check', 'install', 'apply', 'exit', 'settings'\]\)/)
  assert.doesNotMatch(app, /request\('update-action', \{[^}]*kind/)
  assert.doesNotMatch(app, /request\('update-action', \{[^}]*(?:url|pr|manifest|key)/i)
  const actionRunner = app.match(/async function runUnifiedUpdateAction\(id, action\)[\s\S]*?(?=\nasync function installUpdate)/)?.[0] || ''
  assert.match(actionRunner, /runUnifiedUpdateAction\(safeId, action\)[\s\S]*getUnifiedUpdateState\(\)/)
  const href = uiModule.installActionHref({ id: 'pr 42&x', kind: 'pr-preview', signed: true, actionable: true })
  assert.equal(href, 'harness-desktop://update-action/?id=pr+42%26x&action=install')
  assert.equal(uiModule.installActionHref({ id: 'x' }, 'delete'), '')
})

test('状态使用中文文案，发现更新只发布状态且不再自动打开旧遮罩', () => {
  for (const label of ['可更新', '已准备，等待应用', '当前使用中', '已过期', '已停用', '已是最新', '检查失败']) {
    assert.match(app, new RegExp(label))
  }
  const previewNotice = app.match(/function showPrPreviewNotice\(candidate\)[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(previewNotice)
  assert.doesNotMatch(previewNotice, /showUpdateNotice|updateNoticeOverlay/)
  const checker = app.match(/async function checkUpdates\(\)[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(checker)
  assert.match(checker, /checkUnifiedUpdates/)
  assert.doesNotMatch(checker, /showUpdateNotice|updateNoticeOverlay/)
  const previewRefresh = app.match(/async function refreshPrPreviewState\(\{ discover = false \} = \{\}\)[\s\S]*?(?=\nasync function setPrPreviewChannelEnabled)/)?.[0] || ''
  assert.match(previewRefresh, /checkPrPreviewUpdates\(\)[\s\S]*getUnifiedUpdateState\(\)/)
  const previewToggle = app.match(/async function setPrPreviewChannelEnabled\(enabled\)[\s\S]*?(?=\nasync function publishUpdateState)/)?.[0] || ''
  assert.match(previewToggle, /if \(enabled\)[\s\S]*else[\s\S]*getUnifiedUpdateState\(\)/)
  const componentNotice = app.match(/function showComponentUpdateNotice\(componentState\)[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(componentNotice)
  assert.doesNotMatch(componentNotice, /showUpdateNotice|updateNoticeOverlay/)
  const updateEvent = app.match(/api\.onUpdateResult\(async result => \{[\s\S]*?\n\}\)/)?.[0] || ''
  assert.match(updateEvent, /getUnifiedUpdateState\(\)/)
  assert.doesNotMatch(updateEvent, /showUpdateNotice|updateNoticeOverlay/)
})

test('零输入预览界面导出显式 init 入口，供根协调者接入', () => {
  assert.ok(uiModule, 'window.harnessPrPreviewUpdateIntegration 必须被导出')
  assert.equal(typeof uiModule.init, 'function')
  assert.equal(typeof uiModule.create, 'function')
  assert.equal(typeof uiModule.VERSION, 'string')
  assert.ok(uiModule.VERSION.length > 0)
  assert.match(integration, /function init\(options/)
  assert.match(integration, /root\[INSTALLED_FLAG\] && active\.controller/)
})

test('零输入约束：界面不含任何文本输入元素或 prompt 依赖', () => {
  assert.doesNotMatch(integration, /createElement\(['"](input|textarea)['"]\)/)
  assert.doesNotMatch(integration, /<input/)
  assert.doesNotMatch(integration, /type=["'](text|password|url)["']/)
  assert.doesNotMatch(integration, /window\.prompt\(/)
  assert.doesNotMatch(integration, /window\.confirm\(/)
  // 所有人工确认均为 button，且显式 type=button，杜绝隐式表单提交
  assert.match(integration, /node\.type = 'button'/)
  assert.match(integration, /ACTION_APPLY|ACTION_LATER|ACTION_EXIT/)
})

test('自动显示已签名候选，来源 CNB 优先 / GitHub 后备', () => {
  assert.match(integration, /CNB 首选来源/)
  assert.match(integration, /GitHub 后备来源/)
  assert.match(integration, /'cnb'/)
  assert.match(integration, /'github'/)
  assert.match(integration, /已签名/)
  assert.match(integration, /签名校验未确认/)
  assert.match(integration, /正在自动发现已签名的候选预览/)
  assert.match(css, /pr-preview-update-badge--source-cnb/)
  assert.match(css, /pr-preview-update-badge--source-github/)
  assert.match(css, /pr-preview-update-badge--signed/)
})

test('PR 标题与编号仅用于透明度展示，并完整呈现 commit 摘要与变更说明', () => {
  // #编号 为展示文本而非输入
  assert.match(integration, /#\$\{candidate\.pr\.number\}/)
  assert.match(integration, /PR 信息（仅用于透明度展示）/)
  assert.match(integration, /完整 commit 摘要/)
  assert.match(integration, /commit\.subject/)
  assert.match(integration, /commitShort\(candidate\.commit\.sha/)
  assert.match(integration, /变更说明/)
  assert.match(integration, /candidate\.description/)
  assert.match(integration, /目标版本/)
})

test('人工动作齐全：立即更新 / 稍后 / 退出预览，并常驻回滚提示', () => {
  assert.match(integration, /立即更新/)
  assert.match(integration, /重试更新/)
  assert.match(integration, /稍后/)
  assert.match(integration, /退出预览/)
  assert.match(integration, /自动回滚至当前版本/)
  assert.match(integration, /pr-preview-update-button--apply/)
  assert.match(integration, /pr-preview-update-button--exit/)
  assert.match(css, /\.pr-preview-update-button--apply/)
  assert.match(css, /\.pr-preview-update-button--exit/)
})

test('候选字段一律经 textContent / escapeHtml 输出，避免注入', () => {
  assert.match(integration, /function escapeHtml/)
  assert.match(integration, /node\.textContent = text/)
  const escaped = uiModule.escapeHtml('<a href="x">&' + "'")
  assert.equal(escaped, '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
})

test('候选规范化：默认 CNB 来源、签名标记失败关闭并保留编号', () => {
  const candidate = uiModule.normalizeCandidate({
    pr: { number: 42, title: '示例合并请求' },
    commit: { sha: '0123456789abcdef', subject: '修复回滚竞态' },
    description: '变更说明正文',
    version: '1.0.31'
  })
  assert.equal(candidate.source, 'cnb')
  assert.equal(candidate.signed, false)
  assert.equal(candidate.pr.number, 42)
  assert.equal(candidate.commit.sha, '0123456789abcdef')
  assert.equal(candidate.description, '变更说明正文')

  const github = uiModule.normalizeCandidate({ source: 'github', signed: false })
  assert.equal(github.source, 'github')
  assert.equal(github.signed, false)
  assert.equal(uiModule.normalizeCandidate({ signed: true }).signed, true)
  assert.match(integration, /state\.candidate\?\.signed === true/)

  assert.equal(uiModule.normalizeCandidate(null), null)
  assert.equal(uiModule.normalizeCandidate('invalid'), null)
})

test('统一更新项规范化会在完成或失效后关闭动作能力', () => {
  const future = uiModule.normalizeUpdateItem({
    id: 'desktop', kind: 'desktop', version: '2.0.0', title: '桌面更新', summary: '说明', details: ['修复更新流程'],
    source: 'cnb', signed: true, actionable: true, status: 'available', pr: null,
    expiresAt: '2099-01-01T00:00:00.000Z'
  }, Date.parse('2026-01-01T00:00:00.000Z'))
  assert.equal(future.actionable, true)
  assert.equal(future.status, 'available')
  assert.equal(future.source, 'cnb')
  assert.deepEqual(future.details, ['修复更新流程'])

  const completed = uiModule.normalizeUpdateItem({ id: 'component', kind: 'component', actionable: true, status: 'completed' })
  assert.equal(completed.actionable, false)
  const expired = uiModule.normalizeUpdateItem({ id: 'pr-7', kind: 'pr', actionable: true, expiresAt: '2020-01-01T00:00:00.000Z' })
  assert.equal(expired.status, 'expired')
  assert.equal(expired.actionable, false)
})

test('统一中心保持零文本输入、可访问焦点、窄屏和主题变量兼容', () => {
  const centerMarkup = app.match(/center\.innerHTML = `[\s\S]*?<\/div>`/)?.[0] || ''
  assert.ok(centerMarkup, '必须定义更新中心结构')
  assert.doesNotMatch(centerMarkup, /type="(?:text|search|url|password)"|<textarea/i)
  assert.match(centerMarkup, /role="dialog"/)
  assert.match(centerMarkup, /aria-modal="true"/)
  assert.match(centerMarkup, /aria-live="polite"/)
  assert.match(app, /@media \(max-width:640px\)/)
  assert.match(app, /@media \(prefers-reduced-motion:reduce\)/)
  assert.match(app, /--dsw-alias-bg-layer-1/)
  assert.match(app, /:focus-visible/)
})

test('状态机：checking / available / none / error 均有独立呈现分支', () => {
  for (const phase of ["'idle'", "'checking'", "'available'", "'none'", "'error'"]) {
    assert.ok(integration.includes(phase), `缺少阶段 ${phase}`)
  }
  assert.match(integration, /state\.phase === 'available' && state\.candidate/)
  assert.match(integration, /当前没有可用的候选预览/)
  assert.match(integration, /无法自动发现候选预览/)
})

test('独立样式文件契约：面板、动作区、按钮与隐藏状态齐全', () => {
  assert.match(css, /\.pr-preview-update-panel/)
  assert.match(css, /\.pr-preview-update-panel\[hidden\]\s*\{\s*display: none;/)
  assert.match(css, /\.pr-preview-update-actions/)
  assert.match(css, /\.pr-preview-update-button/)
  assert.match(css, /\.pr-preview-update-commit-sha/)
  assert.match(css, /\.pr-preview-update-description-body/)
  assert.match(css, /\.pr-preview-update-note/)
})