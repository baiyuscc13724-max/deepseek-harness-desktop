(() => {
  const root = document.documentElement
  if (!root) return
  root.dataset.harnessMobile = 'true'

  const serverAcceptsTimeZone = value => value === 'UTC' || /^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)+$/.test(String(value || ''))
  const installTimeZoneCompatibility = () => {
    const prototype = window.Intl?.DateTimeFormat?.prototype
    if (!prototype || prototype.__harnessMobileResolvedOptions) return
    const nativeResolvedOptions = prototype.resolvedOptions
    Object.defineProperty(prototype, '__harnessMobileResolvedOptions', { value: nativeResolvedOptions })
    prototype.resolvedOptions = function (...args) {
      const options = nativeResolvedOptions.apply(this, args)
      return serverAcceptsTimeZone(options?.timeZone) ? options : { ...options, timeZone: 'UTC' }
    }
  }
  installTimeZoneCompatibility()

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
      ['Into the Unknown', '今天想做什么？'],
      ['Describe what you want to build', '给智能体发消息'],
      ['DSH Plugins', 'DSH 插件'],
      ['General Skills', '通用 Skills'],
      ['DSH Plugin Marketplace', 'DSH 插件市场'],
      ['Fetches all plugins on startup, sorted by stars (10-min cache)', '启动时获取全部插件，按 Star 数排序（缓存 10 分钟）'],
      ['Refresh', '刷新'],
      ['Loading from GitHub ...', '正在从 GitHub 加载…'],
      ['Search plugins (e.g. pdf, image, ppt)...', '搜索插件（如 PDF、图片、PPT）…'],
      ['Disclaimer: all plugins come from third-party GitHub repositories and are not affiliated with DSH Plugin Marketplace — please evaluate their reliability and security yourself.', '说明：插件来自第三方 GitHub 仓库，与 DSH 插件市场无隶属关系，请自行评估可靠性和安全性。']
    ])
    for (const element of document.querySelectorAll('button,span,p,h1,h2,h3,input,textarea')) {
      if (element instanceof HTMLInputElement || element.tagName === 'TEXTAREA') {
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

  const sidebarNode = () => typeof document.querySelector === 'function'
    ? document.querySelector('[data-slot="sidebar"]')
    : null

  const sidebarToggle = mode => {
    const sidebar = sidebarNode()
    if (!sidebar) return null
    const pattern = mode === 'collapse'
      ? /收起侧边栏|Collapse sidebar/i
      : mode === 'open'
        ? /打开侧边栏|Open sidebar/i
        : /(?:打开|收起)侧边栏|(?:Open|Collapse) sidebar/i
    return [...sidebar.querySelectorAll('button')].find(button => pattern.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`)) || null
  }

  const sidebarExpanded = () => {
    const panel = sidebarNode()?.firstElementChild
    return Boolean(panel && !String(panel.className || '').includes('_collapsed'))
  }

  const setSidebarExpanded = expanded => {
    if (expanded === sidebarExpanded()) return true
    const toggle = sidebarToggle(expanded ? 'open' : 'collapse') || sidebarToggle('any')
    if (!toggle) return false
    toggle.click()
    return true
  }

  const installSidebarAutoClose = () => {
    if (window.__harnessMobileSidebarAutoClose || typeof document.addEventListener !== 'function') return
    window.__harnessMobileSidebarAutoClose = true
    let lastClose = 0
    const releaseComposerFocus = () => {
      const active = document.activeElement
      if (active?.matches?.('input,textarea,[contenteditable="true"]')) active.blur()
      document.querySelector('[data-composer-card] textarea')?.blur()
    }
    const scheduleClose = target => {
      const row = target?.closest?.('[data-harness-mobile-session-row="true"], [role="treeitem"][class*="_sessionRow"]')
      if (!row || !row.closest('[data-slot="sidebar"]')) return
      const nested = target.closest?.('button,a,input,textarea,select,[role="menuitem"]')
      if (nested && nested !== row) return
      const now = Date.now()
      if (now - lastClose < 300) return
      lastClose = now
      setTimeout(() => {
        if (typeof window.matchMedia === 'function' && !window.matchMedia('(max-width: 700px)').matches) return
        if (sidebarExpanded()) setSidebarExpanded(false)
        releaseComposerFocus()
        setTimeout(releaseComposerFocus, 180)
      }, 80)
    }
    document.addEventListener('click', event => scheduleClose(event.target), true)
    document.addEventListener('keyup', event => {
      if (event.key === 'Enter' || event.key === ' ') scheduleClose(event.target)
    }, true)
  }

  const appIcon = name => {
    if (name === 'menu') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
    if (name === 'new') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>'
  }

  const renderMobileMenu = shell => {
    const panel = shell?.querySelector?.('[data-harness-mobile-app-menu]')
    if (!panel) return
    panel.textContent = ''
    const sources = [...document.querySelectorAll('header [role="tab"], [data-harness-mobile-session-log="true"]')]
      .filter(source => visible(source))
    const labels = new Set()
    for (const source of sources) {
      const label = (source.textContent || source.getAttribute('aria-label') || '').trim()
      if (!label || labels.has(label)) continue
      labels.add(label)
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.sourceLabel = label
      button.textContent = label
      if (source.getAttribute('aria-selected') === 'true') button.setAttribute('aria-current', 'page')
      button.addEventListener('click', () => {
        source.click()
        panel.hidden = true
      })
      panel.appendChild(button)
    }
    const settings = document.querySelector('[data-slot="settings.trigger"] button, button[data-slot="settings.trigger"]')
    if (settings) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = '设置'
      button.addEventListener('click', () => {
        settings.click()
        panel.hidden = true
      })
      panel.appendChild(button)
    }
  }

  const installMobileAppShell = () => {
    if (typeof document.createElement !== 'function' || !document.body) return null
    let shell = document.getElementById('harness-mobile-app-shell')
    if (shell) return shell
    shell = document.createElement('div')
    shell.id = 'harness-mobile-app-shell'
    shell.innerHTML = `<header data-harness-mobile-appbar="true"><button type="button" data-harness-mobile-action="menu" aria-label="打开会话历史">${appIcon('menu')}</button><div data-harness-mobile-heading><strong>新对话</strong><span>Harness Mobile</span></div><button type="button" data-harness-mobile-action="new" aria-label="新建会话">${appIcon('new')}</button></header><button type="button" data-harness-mobile-drawer-scrim aria-label="关闭会话历史"></button>`
    shell.querySelector('[data-harness-mobile-action="menu"]').addEventListener('click', () => setSidebarExpanded(!sidebarExpanded()))
    shell.querySelector('[data-harness-mobile-action="new"]').addEventListener('click', () => {
      const button = sidebarNode()?.querySelector('button[aria-label="新建会话"],button[aria-label="New session"]')
      button?.click()
      if (sidebarExpanded()) setSidebarExpanded(false)
    })
    shell.querySelector('[data-harness-mobile-drawer-scrim]').addEventListener('click', () => setSidebarExpanded(false))
    document.body.appendChild(shell)
    return shell
  }

  const syncMobileAppShell = () => {
    const shell = installMobileAppShell()
    if (!shell) return
    const heading = shell.querySelector('[data-harness-mobile-heading]')
    const current = [...document.querySelectorAll('[data-harness-mobile-title-cluster="true"] nav button, header nav button')]
      .filter(button => button.disabled || button.getAttribute('aria-current') === 'page')
      .at(-1)
    const workspace = [...document.querySelectorAll('button')]
      .find(button => /选择工作区|Choose workspace/i.test(button.getAttribute('aria-label') || ''))
    const title = (current?.textContent || '').trim() || (document.querySelector('[data-phase="hero"]') ? '新对话' : 'Harness')
    const subtitle = (workspace?.textContent || '').trim() || 'Harness Mobile'
    if (heading?.firstElementChild && heading.firstElementChild.textContent !== title) heading.firstElementChild.textContent = title
    if (heading?.lastElementChild && heading.lastElementChild.textContent !== subtitle) heading.lastElementChild.textContent = subtitle
    root.dataset.harnessMobileDrawer = sidebarExpanded() ? 'open' : 'closed'
  }

  const mobileSettingsCategories = [
    { match: /^(?:General|通用设置?)$/i, zh: ['通用设置', '语言、外观与会话默认项', '基础'], en: ['General', 'Language, appearance and session defaults', 'Basics'] },
    { match: /^(?:Models?|模型)$/i, zh: ['模型', '供应商、默认模型与连接状态', 'AI 与自动化'], en: ['Models', 'Providers, defaults and connection status', 'AI & automation'] },
    { match: /^(?:Plugins?|插件)$/i, zh: ['插件', '管理已安装插件与配置', '扩展与连接'], en: ['Plugins', 'Manage installed plugins and settings', 'Extensions & connections'] },
    { match: /^(?:Agent presets?|Agent 预设)$/i, zh: ['Agent 预设', '默认能力、工具与权限范围', ''], en: ['Agent presets', 'Default capabilities, tools and permissions', ''] },
    { match: /^(?:DSH Plugin Marketplace|DSH 插件市场)$/i, zh: ['DSH 插件市场', '发现、安装和更新扩展', ''], en: ['DSH Plugin Marketplace', 'Discover, install and update extensions', ''] },
    { match: /^MCP$/i, zh: ['MCP', '服务器、连接状态与工具授权', ''], en: ['MCP', 'Servers, connection status and tool access', ''] },
    { match: /^(?:Agent Teams?|Agent 团队)$/i, zh: ['Agent 团队', '成员、并发与协作策略', '协作与开发'], en: ['Agent Teams', 'Members, concurrency and collaboration', 'Collaboration & development'] },
    { match: /^(?:Godot Preview Settings|Godot 预览(?:设置)?)$/i, zh: ['Godot 预览', '连接、设备与画面参数', ''], en: ['Godot Preview', 'Connection, device and display settings', ''] }
  ]

  const settingsButtonRawLabel = button => {
    const label = button?.querySelector?.('[class*="_navLabel"],span')
    return (button?.dataset?.harnessMobileSettingsOriginalLabel || label?.textContent || button?.textContent || '').trim()
  }

  const settingsCategoryMeta = (button, index = 0) => {
    const raw = settingsButtonRawLabel(button)
    if (button && !button.dataset.harnessMobileSettingsOriginalLabel) button.dataset.harnessMobileSettingsOriginalLabel = raw
    const definition = mobileSettingsCategories.find(item => item.match.test(raw)) || mobileSettingsCategories[index]
    const chinese = /[\u3400-\u9fff]/.test(raw)
    const copy = definition?.[chinese ? 'zh' : 'en'] || [raw || (chinese ? '设置' : 'Settings'), '', '']
    return { raw, title: copy[0], summary: copy[1], group: copy[2], chinese }
  }

  const findNativeSettingsClose = content => [...(content?.querySelectorAll?.('button') || [])]
    .find(button => !button.dataset.harnessMobileSettingsClose && /^(?:关闭|Close|×)$|(?:关闭|Close).*(?:设置|Settings|窗口|window|对话框|dialog)/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''} ${(button.textContent || '').trim()}`.trim())) || null

  const setSettingsView = (dialog, view, focus = false) => {
    const nav = dialog?.querySelector?.(':scope > nav[data-harness-mobile-settings-nav="true"]')
    const content = dialog?.querySelector?.(':scope > [data-harness-mobile-settings-content="true"]')
    const toolbar = dialog?.querySelector?.(':scope > [data-harness-mobile-settings-toolbar="true"]')
    if (!nav || !content || !toolbar) return
    const list = view !== 'detail'
    dialog.dataset.harnessMobileSettingsView = list ? 'list' : 'detail'
    nav.inert = !list
    nav.setAttribute('aria-hidden', list ? 'false' : 'true')
    content.inert = list
    content.setAttribute('aria-hidden', list ? 'true' : 'false')
    const back = toolbar.querySelector('[data-harness-mobile-settings-back="true"]')
    if (back) {
      back.hidden = list
      back.style.setProperty('visibility', list ? 'hidden' : 'visible', 'important')
      back.style.setProperty('pointer-events', list ? 'none' : 'auto', 'important')
    }
    const active = nav.querySelector('button[aria-current="true"]') || nav.querySelector('[data-harness-mobile-settings-category="true"]')
    const title = toolbar.querySelector('[data-harness-mobile-settings-title="true"]')
    if (title) {
      const firstMeta = settingsCategoryMeta(nav.querySelector('[data-harness-mobile-settings-category="true"]'), 0)
      title.textContent = list ? (firstMeta.chinese ? '设置' : 'Settings') : settingsCategoryMeta(active).title
    }
    if (!focus) return
    setTimeout(() => {
      if (list) {
        active?.focus?.({ preventScroll: true })
        active?.scrollIntoView?.({ block: 'nearest' })
        return
      }
      content.tabIndex = -1
      content.focus?.({ preventScroll: true })
      content.scrollTop = 0
    }, 40)
  }

  const decorateSettingsDialog = (dialog, nav, content) => {
    dialog.dataset.harnessMobileSettingsDialog = 'true'
    delete dialog.dataset.harnessMobileSheet
    nav.dataset.harnessMobileSettingsNav = 'true'
    content.dataset.harnessMobileSettingsContent = 'true'

    const buttons = [...nav.querySelectorAll('button')]
    buttons.forEach((button, index) => {
      const meta = settingsCategoryMeta(button, index)
      button.dataset.harnessMobileSettingsCategory = 'true'
      button.dataset.harnessMobileSettingsSummary = meta.summary
      if (meta.group) button.dataset.harnessMobileSettingsGroup = meta.group
      else delete button.dataset.harnessMobileSettingsGroup
      button.setAttribute('aria-label', meta.summary ? `${meta.title}，${meta.summary}` : meta.title)
      const label = button.querySelector('[class*="_navLabel"],span')
      if (label && label.textContent !== meta.title) label.textContent = meta.title
      let summary = button.querySelector(':scope > [data-harness-mobile-settings-summary="true"]')
      if (!summary) {
        summary = document.createElement('span')
        summary.dataset.harnessMobileSettingsSummary = 'true'
        button.appendChild(summary)
      }
      if (summary.textContent !== meta.summary) summary.textContent = meta.summary
    })

    let toolbar = dialog.querySelector(':scope > [data-harness-mobile-settings-toolbar="true"]')
    if (!toolbar) {
      toolbar = document.createElement('header')
      toolbar.dataset.harnessMobileSettingsToolbar = 'true'
      toolbar.innerHTML = `<button type="button" data-harness-mobile-settings-back="true" aria-label="返回设置分类"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button><h2 data-harness-mobile-settings-title="true">设置</h2><button type="button" data-harness-mobile-settings-close="true" aria-label="关闭设置"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
      toolbar.querySelector('[data-harness-mobile-settings-back="true"]').addEventListener('click', () => setSettingsView(dialog, 'list', true))
      toolbar.querySelector('[data-harness-mobile-settings-close="true"]').addEventListener('click', () => findNativeSettingsClose(content)?.click())
      dialog.insertBefore(toolbar, nav)
    }

    const nativeClose = findNativeSettingsClose(content)
    if (nativeClose) nativeClose.dataset.harnessMobileSettingsNativeClose = 'true'
    const nativeHeader = content.firstElementChild
    if (nativeHeader) {
      const actions = [...nativeHeader.querySelectorAll('button')].filter(button => button !== nativeClose)
      nativeHeader.dataset.harnessMobileSettingsNativeHeader = actions.length ? 'actions' : 'empty'
    }

    if (!nav.dataset.harnessMobileSettingsNavigationInstalled) {
      nav.dataset.harnessMobileSettingsNavigationInstalled = 'true'
      nav.addEventListener('click', event => {
        const button = event.target?.closest?.('button[data-harness-mobile-settings-category="true"]')
        if (!button || !nav.contains(button)) return
        setTimeout(() => setSettingsView(dialog, 'detail', true), 0)
      })
    }

    if (!dialog.dataset.harnessMobileSettingsView) dialog.dataset.harnessMobileSettingsView = 'list'
    setSettingsView(dialog, dialog.dataset.harnessMobileSettingsView)
  }

  const decorateDialogs = () => {
    for (const dialog of document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog')) {
      const nav = dialog.querySelector(':scope > nav')
      const content = nav?.nextElementSibling
      const buttons = [...(nav?.querySelectorAll?.('button') || [])]
      const settings = dialog.dataset.harnessMobileSettingsDialog === 'true' || Boolean(
        content && buttons.length >= 3 && buttons.some(button => button.getAttribute('aria-current') === 'true')
      )
      if (settings) decorateSettingsDialog(dialog, nav, content)
      else {
        dialog.dataset.harnessMobileSheet = 'true'
        delete dialog.dataset.harnessMobileSettingsDialog
      }
    }
  }

  const decorateConversation = () => {
    if (typeof document.querySelector !== 'function') return
    const conversation = document.querySelector('[data-phase][data-harness-mobile-conversation], [data-phase]')
    if (!conversation) return
    conversation.dataset.harnessMobileConversation = 'true'
    const header = conversation.querySelector(':scope > header')
    if (header) header.dataset.harnessMobileConversationHeader = 'true'
    const view = conversation.querySelector('[data-conversation-view]')
    if (view) view.dataset.harnessMobileConversationView = 'true'
    const composer = conversation.querySelector('[data-composer-card]')
    const input = composer?.querySelector('textarea[data-phase]')
    const inputScroll = composer?.querySelector('[data-input-scroll]')
    if (composer) composer.dataset.harnessMobileComposer = 'qianwen'
    if (inputScroll) inputScroll.dataset.harnessMobileComposerInput = 'true'
    if (input) {
      input.dataset.harnessMobileComposerTextarea = 'true'
      const language = typeof navigator === 'object' ? navigator.language || '' : ''
      input.placeholder = /^zh\b/i.test(language) ? '发消息…' : 'Message…'
    }
  }

  let composerStyleRestorations = []
  const containComposerContext = () => {
    for (const restore of composerStyleRestorations.splice(0)) restore()
    if (typeof document.querySelector !== 'function') return
    const card = document.querySelector('[data-composer-card]')
    if (!card) return
    const setTemporary = (element, property, value) => {
      const previous = element.style.getPropertyValue(property)
      const priority = element.style.getPropertyPriority(property)
      element.style.setProperty(property, value, 'important')
      composerStyleRestorations.push(() => {
        if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') return
        if (previous) element.style.setProperty(property, previous, priority)
        else element.style.removeProperty(property)
      })
    }
    // Only constrain the model/preset listbox that lives inside the composer.
    // Never mutate conversation rows, to-bottom controls or dialog content.
    const button = card.querySelector('button[aria-haspopup="listbox"]')
    if (!button || !button.parentElement || button.closest('[data-conversation-scroll]') && !button.closest('[data-composer-card]')) return
    setTemporary(button.parentElement, 'min-width', '0px')
    setTemporary(button.parentElement, 'max-width', '100%')
    setTemporary(button.parentElement, 'overflow', 'hidden')
    setTemporary(button, 'min-width', '0px')
    setTemporary(button, 'max-width', '100%')
  }

  const installHistoryRecovery = () => {
    if (window.__harnessMobileFetchInstalled || typeof window.fetch !== 'function') return
    const nativeFetch = window.fetch.bind(window)
    const cache = new Map()
    const inFlight = new Map()
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

    const normalizePromptTimeZone = async (input, init) => {
      let body = typeof init?.body === 'string' ? init.body : null
      let clonedRequest = null
      if (body === null && typeof Request !== 'undefined' && input instanceof Request) {
        try {
          clonedRequest = input.clone()
          body = await clonedRequest.clone().text()
        } catch {
          return { input, init }
        }
      }
      if (!body) return { input, init }
      try {
        const requestPayload = JSON.parse(body)
        const timeZone = requestPayload?.payload?.clientTimeZone
        if (serverAcceptsTimeZone(timeZone)) return { input, init }
        requestPayload.payload.clientTimeZone = 'UTC'
        const normalizedBody = JSON.stringify(requestPayload)
        if (typeof init?.body === 'string') return { input, init: { ...init, body: normalizedBody } }
        if (clonedRequest) return { input: new Request(clonedRequest, { body: normalizedBody }), init: undefined }
      } catch {}
      return { input, init }
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
      const isPrompt = /\/api\/session\.prompt(?:[/?#]|$)/i.test(url)
      if (isPrompt) {
        const normalized = await normalizePromptTimeZone(input, init)
        return nativeFetch(normalized.input, normalized.init)
      }
      const isHistory = /\/api\/(?:session|subagent)\.history(?:[/?#]|$)/i.test(url)
      if (!isHistory) return nativeFetch(input, init)

      const key = await historyKey(input, init)
      // Never replay a successful history snapshot merely because it is fresh.
      // Android's system picker backgrounds the WebView; a cached blank baseline
      // can otherwise hide the just-sent user turn while the session is running.
      if (inFlight.has(key)) return (await inFlight.get(key)).clone()

      const callerSignal = requestSignal(input, init)
      const replayInput = typeof Request !== 'undefined' && input instanceof Request ? input.clone() : input
      const request = (async () => {
        let lastError = null
        let lastResponse = null
        let staleFallbackAllowed = false
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
            staleFallbackAllowed = response.status >= 500 && response.status <= 504
            if (callerSignal?.aborted || document.visibilityState === 'hidden' || attempt === 2) break
          } catch (error) {
            lastError = error
            const retryable = /abort|failed|network|timeout/i.test(String(error?.message || error))
            staleFallbackAllowed = retryable && !callerSignal?.aborted && document.visibilityState !== 'hidden'
            if (!retryable || callerSignal?.aborted || document.visibilityState === 'hidden' || attempt === 2) break
          }
          const backoff = 300 * (2 ** attempt) + Math.round(Math.random() * 120)
          await new Promise(resolve => setTimeout(resolve, backoff))
        }
        const stale = staleFallbackAllowed ? cachedResponse(key, STALE_CACHE_MS) : null
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
    decorateDialogs()
    decorateConversation()
    containComposerContext()
    installSidebarAutoClose()
    syncMobileAppShell()
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
