(() => {
  const root = document.documentElement
  if (!root) return
  root.dataset.harnessMobile = 'true'

  const visible = node => {
    if (!node) return false
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
  }

  const dismissOfficialNotice = () => {
    const notice = [...document.querySelectorAll('[role="dialog"],dialog')]
      .find(node => /Internal Testing Notice|内部测试提示|内部测试公告/i.test(node.textContent || ''))
    if (!notice) return false
    const proceed = [...notice.querySelectorAll('button')]
      .find(button => /^(Continue|继续|我知道了)$/i.test((button.textContent || '').trim()))
    if (!proceed) return false
    proceed.click()
    return true
  }

  const decorateHeader = () => {
    const sessionLog = [...document.querySelectorAll('button')]
      .find(button => /Session log|会话日志|会话记录/i.test(button.textContent || ''))
    if (!sessionLog) return
    sessionLog.dataset.harnessMobileSessionLog = 'true'
    sessionLog.setAttribute('aria-label', '会话日志')

    const utilities = sessionLog.parentElement?.parentElement
    const titleRow = utilities?.parentElement
    if (utilities) utilities.dataset.harnessMobileHeaderUtilities = 'true'
    if (titleRow) {
      titleRow.dataset.harnessMobileTitleRow = 'true'
      if (titleRow.firstElementChild) titleRow.firstElementChild.dataset.harnessMobileTitleCluster = 'true'
    }

    for (const button of titleRow?.querySelectorAll('button') || []) {
      if (/\d+\s*(?:个)?子代理|subagents?/i.test(`${button.textContent || ''} ${button.getAttribute('aria-label') || ''}`)) {
        button.dataset.harnessMobileSubagents = 'true'
        const count = (button.textContent || '').match(/\d+/)?.[0]
        if (count) {
          const label = `${count} 个子代理`
          const countNode = button.querySelector('[class*="_count"]')
          if (countNode && countNode.textContent !== label) countNode.textContent = label
          button.setAttribute('aria-label', label)
        }
      }
    }
  }

  const decorateSessions = () => {
    for (const row of document.querySelectorAll('[role="treeitem"]')) {
      if (String(row.className || '').includes('_sessionRow')) row.dataset.harnessMobileSessionRow = 'true'
    }
  }

  const translateStableLabels = () => {
    const replacements = new Map([
      ['Session log', '会话日志'],
      ['DSH Plugins', 'DSH 插件'],
      ['General Skills', '通用 Skills'],
      ['DSH Plugin Marketplace', 'DSH 插件市场'],
      ['Fetches all plugins on startup, sorted by stars (10-min cache)', '启动时获取全部插件，按 Star 数排序（缓存 10 分钟）'],
      ['Refresh', '刷新'],
      ['Loading from GitHub ...', '正在从 GitHub 加载…'],
      ['Search plugins (e.g. pdf, image, ppt)...', '搜索插件（如 PDF、图片、PPT）…'],
      ['Disclaimer: all plugins come from third-party GitHub repositories and are not affiliated with DSH Plugin Marketplace — please evaluate their reliability and security yourself.', '说明：插件来自第三方 GitHub 仓库，与 DSH 插件市场无隶属关系，请自行评估可靠性和安全性。']
    ])
    for (const element of document.querySelectorAll('button,span,p,h1,h2,h3,input')) {
      if (element instanceof HTMLInputElement) {
        const next = replacements.get(element.placeholder || '')
        if (next) element.placeholder = next
        continue
      }
      if (element.children.length > 0) continue
      const text = (element.textContent || '').trim()
      const next = replacements.get(text)
      if (next) element.textContent = next
    }
  }

  const installHistoryRecovery = () => {
    if (window.__harnessMobileFetchInstalled || typeof window.fetch !== 'function') return
    const nativeFetch = window.fetch.bind(window)
    window.__harnessMobileFetchInstalled = true

    const isHistoryFailure = async response => {
      if (response.status >= 500 && response.status <= 504) return true
      if (!response.ok || !/json/i.test(response.headers.get('content-type') || '')) return false
      try {
        const payload = await response.clone().json()
        const error = payload?.result?.ok === false ? payload.result.error : null
        return error?.code === 'internal' && /abort|aborted|中止|取消/i.test(String(error.message || ''))
      } catch {
        return false
      }
    }

    const retrySignal = () => {
      if (typeof AbortSignal?.timeout !== 'function') return undefined
      return AbortSignal.timeout(45_000)
    }

    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      const isHistory = /\/api\/(?:session|subagent)\.history(?:[/?#]|$)/i.test(url)
      if (!isHistory) return nativeFetch(input, init)

      const replayInput = typeof Request !== 'undefined' && input instanceof Request ? input.clone() : input
      let lastError = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const attemptInit = attempt === 0 ? init : { ...(init || {}), signal: retrySignal() }
          if (attempt > 0 && attemptInit.signal === undefined) delete attemptInit.signal
          const requestInput = attempt === 0
            ? input
            : typeof Request !== 'undefined' && replayInput instanceof Request
              ? replayInput.clone()
              : replayInput
          const response = await nativeFetch(requestInput, attemptInit)
          if (!await isHistoryFailure(response) || document.visibilityState === 'hidden' || attempt === 2) return response
        } catch (error) {
          lastError = error
          const retryable = /abort|failed|network|timeout/i.test(String(error?.message || error))
          if (!retryable || document.visibilityState === 'hidden' || attempt === 2) throw error
        }
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 350 : 900))
      }
      if (lastError) throw lastError
      throw new Error('历史记录重试未能完成')
    }
  }

  const installThemeBridge = () => {
    if (window.__harnessMobileThemeBridgeLoading || window.__HARNESS_DESKTOP_THEME_INSTALLED__) return
    window.__harnessMobileThemeBridgeLoading = true
    fetch('/__harness_mobile__/theme.js', { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`theme bridge ${response.status}`)
        return response.text()
      })
      .then(source => (0, eval)(source))
      .catch(() => { window.__harnessMobileThemeBridgeLoading = false })
  }

  const mount = () => {
    dismissOfficialNotice()
    decorateHeader()
    decorateSessions()
    translateStableLabels()
    installHistoryRecovery()
    installThemeBridge()
  }

  mount()
  if (!window.__harnessMobileUiObserver) {
    let timer = 0
    window.__harnessMobileUiObserver = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(mount, 80)
    })
    window.__harnessMobileUiObserver.observe(root, { childList: true, subtree: true })
  }
})()
