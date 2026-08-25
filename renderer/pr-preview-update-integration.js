/**
 * pr-preview-update-integration.js
 *
 * 零输入 PR 快速预览更新界面模块（renderer 侧）。
 *
 * 职责边界：
 *  - 本模块只负责「自动发现结果展示 + 人工确认」，不参与信任验证、下载或安装；
 *  - 不包含任何文本输入：没有 PR 编号输入框、没有仓库输入、没有 URL 输入、
 *    没有 Token/密钥输入，也没有 prompt()/confirm() 依赖；
 *  - 候选由信任核心自动发现后经 update(state) 推入本模块展示，
 *    来源按「CNB 优先、GitHub 后备」显示；
 *  - PR 标题与编号仅用于透明度展示；commit 摘要与变更说明完整呈现；
 *  - 人工动作只有三个按钮：立即更新 / 稍后 / 退出预览，并常驻回滚提示。
 *
 * 候选对象契约（由协调者将服务端输出映射为以下形状后推入）：
 *   candidate = {
 *     pr:        { number: 123, title: '修复预览更新回滚竞态', url: '' },
 *     source:    'cnb' | 'github',          // 来源：CNB 优先，GitHub 后备
 *     signed:    true,                      // 是否已签名候选（false 时醒目提示）
 *     commit:    { sha: '<完整 sha>', subject: '…' },  // 完整 commit 摘要
 *     description: '变更说明正文（支持多行）',
 *     version:   '1.0.31'                   // 目标版本
 *   }
 *   state = { phase: 'idle'|'checking'|'available'|'none'|'error', candidate?, message? }
 *
 * 接入方式（由根协调者在 app.js 中调用，幂等）：
 *   harnessPrPreviewUpdateIntegration.init({
 *     rootSelector: '#prPreviewUpdateRoot',        // 可选，默认挂在 body 末尾
 *     onApply:  async candidate => api.prPreviewUpdateApply(candidate),
 *     onLater:  candidate => api.prPreviewUpdateLater(candidate),
 *     onExit:   () => api.prPreviewUpdateExit()
 *   });
 *   随后推送状态：controller.update({ phase: 'checking' })
 *                 controller.update({ phase: 'available', candidate })
 *                 controller.hide() / controller.show()
 */
(function exposePrPreviewUpdateIntegration(root) {
  'use strict'

  const VERSION = '1.0.0'
  const INSTALLED_FLAG = '__HARNESS_DESKTOP_PR_PREVIEW_UPDATE_INSTALLED__'
  const PANEL_ID = 'prPreviewUpdatePanel'
  const ROOT_SELECTOR = '#prPreviewUpdateRoot'
  const ACTION_APPLY = 'apply'
  const ACTION_LATER = 'later'
  const ACTION_EXIT = 'exit'

  const active = { controller: null, exited: false }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character])
  }

  function normalizeCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') return null
    const pr = candidate.pr && typeof candidate.pr === 'object' ? candidate.pr : {}
    const commit = candidate.commit && typeof candidate.commit === 'object' ? candidate.commit : {}
    const source = candidate.source === 'github' ? 'github' : 'cnb'
    return {
      pr: {
        number: Number.isFinite(Number(pr.number)) ? Number(pr.number) : null,
        title: String(pr.title || '').trim(),
        url: String(pr.url || '').trim()
      },
      source,
      signed: candidate.signed === true,
      commit: {
        sha: String(commit.sha || '').trim(),
        subject: String(commit.subject || '').trim()
      },
      description: String(candidate.description || '').trim(),
      version: String(candidate.version || '').trim()
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function button(label, className, action, onClick) {
    const node = element('button', className, label)
    node.type = 'button'
    node.dataset.prPreviewAction = action
    if (onClick) node.addEventListener('click', onClick)
    return node
  }

  function createPrPreviewUpdate(options = {}) {
    const callbacks = {
      onApply: typeof options.onApply === 'function' ? options.onApply : null,
      onLater: typeof options.onLater === 'function' ? options.onLater : null,
      onExit: typeof options.onExit === 'function' ? options.onExit : null
    }
    const dismissOnLater = options.dismissOnLater !== false
    const panels = {
      checking: null,
      available: null,
      none: null,
      error: null,
      actions: null,
      note: null
    }
    const buttons = { apply: null, later: null, exit: null }
    const state = {
      phase: 'idle',
      candidate: null,
      message: ''
    }
    let container = null
    let mounted = false

    function sourceLabel(candidate) {
      return candidate && candidate.source === 'github' ? 'GitHub 后备来源' : 'CNB 首选来源'
    }

    function buildCheckingPane() {
      return element('div', 'pr-preview-update-pane pr-preview-update-checking',
        '正在自动发现已签名的候选预览…（无需输入 PR 编号）')
    }

    function commitShort(sha, length) {
      const clean = String(sha || '')
      return clean ? clean.slice(0, length || 12) : ''
    }

    function buildAvailablePane(candidate) {
      const pane = element('section', 'pr-preview-update-pane pr-preview-update-candidate')
      pane.setAttribute('aria-label', '已发现的候选预览')

      const head = element('div', 'pr-preview-update-candidate-head')
      const sourceBadge = element('span', `pr-preview-update-badge pr-preview-update-badge--source pr-preview-update-badge--source-${candidate.source}`,
        candidate.source === 'github' ? 'GitHub 后备' : 'CNB 优先')
      sourceBadge.setAttribute('aria-label', sourceLabel(candidate))
      const signedBadge = element('span',
        `pr-preview-update-badge pr-preview-update-badge--signed${candidate.signed ? '' : ' pr-preview-update-badge--unsigned'}`,
        candidate.signed ? '已签名' : '签名校验未确认')
      head.append(sourceBadge, signedBadge)
      pane.append(head)

      const prLine = element('div', 'pr-preview-update-pr')
      const prNumber = candidate.pr && candidate.pr.number !== null
        ? `#${candidate.pr.number}`
        : ''
      prLine.setAttribute('aria-label', 'PR 信息（仅用于透明度展示）')
      const titleText = [candidate.pr ? candidate.pr.title : '', prNumber]
        .filter(Boolean)
        .join(' · ')
      const titleNode = element('div', 'pr-preview-update-pr-title', titleText || '未命名合并请求')
      const metaNode = element('div', 'pr-preview-update-pr-meta', sourceLabel(candidate))
      prLine.append(titleNode, metaNode)
      pane.append(prLine)

      if (candidate.version) {
        pane.append(element('div', 'pr-preview-update-version',
          `目标版本 ${candidate.version}`))
      }

      if (candidate.commit && (candidate.commit.sha || candidate.commit.subject)) {
        const commitBlock = element('div', 'pr-preview-update-commit')
        commitBlock.append(element('div', 'pr-preview-update-label', '完整 commit 摘要'))
        if (candidate.commit.subject) {
          commitBlock.append(element('div', 'pr-preview-update-commit-subject', candidate.commit.subject))
        }
        if (candidate.commit.sha) {
          const shaLine = element('div', 'pr-preview-update-commit-sha',
            `${commitShort(candidate.commit.sha, 12)} ${candidate.commit.sha}`)
          commitBlock.append(shaLine)
        }
        pane.append(commitBlock)
      }

      if (candidate.description) {
        const descriptionBlock = element('div', 'pr-preview-update-description')
        descriptionBlock.append(element('div', 'pr-preview-update-label', '变更说明'))
        descriptionBlock.append(element('div', 'pr-preview-update-description-body', candidate.description))
        pane.append(descriptionBlock)
      }

      return pane
    }

    function buildNonePane() {
      return element('div', 'pr-preview-update-pane pr-preview-update-empty',
        '当前没有可用的候选预览。')
    }

    function buildErrorPane(message) {
      return element('div', 'pr-preview-update-pane pr-preview-update-error',
        `无法自动发现候选预览：${message || '未知错误'}`)
    }

    function renderBody() {
      if (!mounted) return
      const body = container.querySelector('.pr-preview-update-body')
      body.replaceChildren()
      if (state.phase === 'checking') {
        body.append(panels.checking = buildCheckingPane())
      } else if (state.phase === 'available' && state.candidate) {
        body.append(panels.available = buildAvailablePane(state.candidate))
      } else if (state.phase === 'error') {
        body.append(panels.error = buildErrorPane(state.message))
      } else if (state.phase === 'none') {
        body.append(panels.none = buildNonePane())
      }
      const actionable = ['available', 'error'].includes(state.phase) && state.candidate?.signed === true
      buttons.apply.disabled = !actionable
      buttons.apply.textContent = state.phase === 'error' && state.candidate ? '重试更新' : '立即更新'
    }

    function handleApply() {
      if (!state.candidate || !callbacks.onApply) return
      buttons.apply.disabled = true
      buttons.apply.textContent = '正在更新…'
      const settle = () => {
        const retry = state.phase === 'error' && state.candidate?.signed === true
        buttons.apply.disabled = !(['available', 'error'].includes(state.phase) && state.candidate?.signed === true)
        buttons.apply.textContent = retry ? '重试更新' : '立即更新'
      }
      try {
        const result = callbacks.onApply(state.candidate)
        if (result && typeof result.then === 'function') {
          result.then(settle, settle)
        } else {
          settle()
        }
      } catch (error) {
        settle()
      }
    }

    function handleLater() {
      const candidate = state.candidate
      if (callbacks.onLater) {
        try {
          callbacks.onLater(candidate)
        } catch (error) { /* 稍后失败不影响界面收起 */ }
      }
      if (dismissOnLater) hide()
    }

    function handleExit() {
      if (callbacks.onExit) {
        try {
          callbacks.onExit()
        } catch (error) { /* 退出预览失败仍继续收起 */ }
      }
      active.exited = true
      hide()
    }

    function mount() {
      if (mounted) return container
      container = document.createElement('div')
      container.id = PANEL_ID
      container.className = 'pr-preview-update-panel'
      container.setAttribute('role', 'region')
      container.setAttribute('aria-label', 'PR 快速预览更新')

      const head = element('header', 'pr-preview-update-head')
      head.append(element('h2', 'pr-preview-update-title', 'PR 快速预览更新'))
      head.append(element('span', 'pr-preview-update-subtitle', '已签名候选 · 零输入 · CNB 优先'))
      container.append(head)

      const body = element('div', 'pr-preview-update-body')
      container.append(body)

      const actions = element('div', 'pr-preview-update-actions')
      buttons.apply = button('立即更新', 'pr-preview-update-button pr-preview-update-button--apply', ACTION_APPLY, handleApply)
      buttons.later = button('稍后', 'pr-preview-update-button', ACTION_LATER, handleLater)
      buttons.exit = button('退出预览', 'pr-preview-update-button pr-preview-update-button--exit', ACTION_EXIT, handleExit)
      actions.append(buttons.apply, buttons.later, buttons.exit)
      container.append(actions)

      panels.note = element('div', 'pr-preview-update-note',
        '若更新后启动异常，将自动回滚至当前版本；可随时「退出预览」恢复。')
      container.append(panels.note)

      const rootNode = options.root
        ? options.root
        : document.querySelector(ROOT_SELECTOR) || document.body
      rootNode.appendChild(container)
      mounted = true
      renderBody()
      return container
    }

    function update(nextState) {
      if (!nextState || typeof nextState !== 'object') return
      if (typeof nextState.phase === 'string') state.phase = nextState.phase
      if (Object.prototype.hasOwnProperty.call(nextState, 'candidate')) {
        state.candidate = normalizeCandidate(nextState.candidate)
      }
      if (typeof nextState.message === 'string') state.message = nextState.message
      if (state.phase === 'available') active.exited = false
      if (mounted) {
        renderBody()
        show()
      }
      return state
    }

    function show() {
      if (mounted) container.hidden = false
    }

    function hide() {
      if (mounted) container.hidden = true
    }

    function destroy() {
      if (mounted && container.parentNode) {
        container.parentNode.removeChild(container)
      }
      mounted = false
      container = null
    }

    function getState() {
      return {
        phase: state.phase,
        candidate: state.candidate ? Object.assign({}, state.candidate) : null,
        message: state.message
      }
    }

    return {
      mount,
      update,
      show,
      hide,
      destroy,
      getState
    }
  }

  function init(options = {}) {
    if (root[INSTALLED_FLAG] && active.controller) return active.controller
    root[INSTALLED_FLAG] = true
    const controller = createPrPreviewUpdate(options)
    active.controller = controller
    active.exited = false
    controller.mount()
    return controller
  }

  root.harnessPrPreviewUpdateIntegration = {
    VERSION,
    init,
    create: createPrPreviewUpdate,
    normalizeCandidate,
    escapeHtml
  }
})(typeof window !== 'undefined' ? window : globalThis)