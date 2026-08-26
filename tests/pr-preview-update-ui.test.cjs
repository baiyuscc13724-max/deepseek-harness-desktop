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

test('PR 快速预览默认启用并复用正常更新通知，不再加载独立悬浮卡片', () => {
  assert.doesNotMatch(index, /pr-preview-update-(?:integration\.js|css)/)
  assert.doesNotMatch(app, /ensurePrPreviewController|harnessPrPreviewUpdateIntegration/)
  assert.match(appStateStore, /previewEnabled: true/)
  assert.match(app, /function showPrPreviewNotice\(candidate/)
  assert.match(app, /pendingUpdateKind = 'preview'/)
  assert.match(app, /function showComponentUpdateNotice[\s\S]{0,2000}pendingUpdateKind = 'components'/, 'the shared update notice must preserve the component staging path')
  assert.match(app, /showUpdateNotice\(\{/)
  assert.match(app, /pendingUpdateKind !== 'preview'/)
  assert.match(app, /await api\.applyPrPreviewUpdate\(\)/)
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