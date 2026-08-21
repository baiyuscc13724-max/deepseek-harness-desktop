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
    const cache = new Map()
    const inFlight = new Map()
    const FRESH_CACHE_MS = 15_000
    const STALE_CACHE_MS = 5 * 60_000
    const MAX_CACHE_ENTRIES = 8
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

    const requestSignal = (input, init) => init?.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null)
    const attemptSignal = (callerSignal, timeoutMs) => {
      if (typeof AbortSignal?.timeout !== 'function') return callerSignal || undefined
      const timeout = AbortSignal.timeout(timeoutMs)
      if (!callerSignal || typeof AbortSignal.any !== 'function') return callerSignal || timeout
      return AbortSignal.any([callerSignal, timeout])
    }
    const historyKey = async (input, init) => {
      try {
        const request = typeof Request !== 'undefined' && input instanceof Request
          ? input.clone()
          : new Request(input, init)
        const method = request.method.toUpperCase()
        const body = method === 'GET' || method === 'HEAD' ? '' : await request.clone().text()
        return `${method}:${request.url}:${body}`
      } catch {
        return `${init?.method || 'GET'}:${typeof input === 'string' ? input : input?.url || ''}`
      }
    }
    const cachedResponse = (key, maxAge) => {
      const entry = cache.get(key)
      if (!entry) return null
      const age = Date.now() - entry.savedAt
      if (age > maxAge) {
        if (age > STALE_CACHE_MS) cache.delete(key)
        return null
      }
      cache.delete(key)
      cache.set(key, entry)
      return entry.response.clone()
    }
    const remember = (key, response) => {
      cache.delete(key)
      cache.set(key, { savedAt: Date.now(), response: response.clone() })
      while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
    }

    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || ''
      const isHistory = /\/api\/(?:session|subagent)\.history(?:[/?#]|$)/i.test(url)
      if (!isHistory) return nativeFetch(input, init)

      const key = await historyKey(input, init)
      const fresh = cachedResponse(key, FRESH_CACHE_MS)
      if (fresh) return fresh
      if (inFlight.has(key)) return (await inFlight.get(key)).clone()

      const callerSignal = requestSignal(input, init)
      const replayInput = typeof Request !== 'undefined' && input instanceof Request ? input.clone() : input
      const request = (async () => {
        let lastError = null
        let lastResponse = null
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const attemptInit = { ...(init || {}), signal: attemptSignal(callerSignal, attempt === 0 ? 8_000 : 12_000) }
            if (attemptInit.signal === undefined) delete attemptInit.signal
            const requestInput = attempt === 0
              ? input
              : typeof Request !== 'undefined' && replayInput instanceof Request
                ? replayInput.clone()
                : replayInput
            const response = await nativeFetch(requestInput, attemptInit)
            lastResponse = response
            if (!await isHistoryFailure(response)) {
              remember(key, response)
              return response
            }
            if (callerSignal?.aborted || document.visibilityState === 'hidden' || attempt === 2) break
          } catch (error) {
            lastError = error
            const retryable = /abort|failed|network|timeout/i.test(String(error?.message || error))
            if (!retryable || callerSignal?.aborted || document.visibilityState === 'hidden' || attempt === 2) break
          }
          const backoff = 300 * (2 ** attempt) + Math.round(Math.random() * 120)
          await new Promise(resolve => setTimeout(resolve, backoff))
        }
        const stale = cachedResponse(key, STALE_CACHE_MS)
        if (stale) return stale
        if (lastError) throw lastError
        if (lastResponse) return lastResponse
        throw new Error('历史记录重试未能完成')
      })()
      inFlight.set(key, request)
      try { return (await request).clone() }
      finally { if (inFlight.get(key) === request) inFlight.delete(key) }
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

  const installControlSettingsEntry = () => {
    if (typeof document.querySelector !== 'function') return
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
    if (!dialog) return
    const general = [...dialog.querySelectorAll('nav button')].find(button => /通用设置|General/i.test(button.textContent || ''))
    if (!general || general.getAttribute('aria-current') !== 'true') return
    const slot = dialog.querySelector('[data-slot="settings.general.item"]')
    const content = dialog.querySelector(':scope > nav + div')
    const options = content?.lastElementChild
    const section = slot?.parentElement || options?.firstElementChild || options
    if (!section || section.querySelector('#harness-mobile-control-row')) return
    const row = document.createElement('div')
    row.id = 'harness-mobile-control-row'
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;color:var(--dsw-alias-label-primary)'
    const state = window.HarnessMobileControl?.status?.() || 'disabled'
    row.innerHTML = `<div style="min-width:0"><div style="font-size:14px;line-height:22px">手机控制</div><div style="margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px">${state === 'ready' ? '已授权并开启，可随时立即停止' : '权限向导、总开关与安全确认'}</div></div><button type="button" style="flex:none;min-height:34px;border:0;border-radius:17px;padding:6px 14px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:13px">管理</button>`
    row.querySelector('button').addEventListener('click', () => window.HarnessMobileControl?.openSettings?.())
    section.appendChild(row)
  }

  const mount = () => {
    dismissOfficialNotice()
    decorateHeader()
    decorateSessions()
    translateStableLabels()
    installHistoryRecovery()
    installThemeBridge()
    installControlSettingsEntry()
  }

  mount()
  if (!window.__harnessMobileUiObserver) {
    let scheduled = false
    const scheduleMount = () => {
      if (scheduled || document.visibilityState === 'hidden') return
      scheduled = true
      setTimeout(() => {
        scheduled = false
        mount()
      }, 160)
    }
    // Throttle instead of restarting a debounce for every streamed token. This
    // keeps page switches responsive and caps expensive full-DOM decoration.
    window.__harnessMobileUiObserver = new MutationObserver(scheduleMount)
    window.__harnessMobileUiObserver.observe(root, { childList: true, subtree: true })
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleMount()
    })
  }
})()
