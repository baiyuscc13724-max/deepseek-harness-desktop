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

  const releaseComposerFocus = () => {
    const active = document.activeElement
    if (active?.matches?.('input,textarea,[contenteditable="true"]')) active.blur()
    document.querySelector('[data-composer-card] textarea')?.blur()
  }

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
    shell.querySelector('[data-harness-mobile-action="menu"]').addEventListener('click', () => {
      releaseComposerFocus()
      setSidebarExpanded(!sidebarExpanded())
    })
    shell.querySelector('[data-harness-mobile-action="new"]').addEventListener('click', () => {
      releaseComposerFocus()
      const button = sidebarNode()?.querySelector('button[aria-label="新建会话"],button[aria-label="New session"]')
      button?.click()
      if (sidebarExpanded()) setSidebarExpanded(false)
    })
    shell.querySelector('[data-harness-mobile-drawer-scrim]').addEventListener('click', () => {
      releaseComposerFocus()
      setSidebarExpanded(false)
    })
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

  const modelSettingsButton = button => /^(?:Models?|模型)$/i.test(settingsButtonRawLabel(button))

  const modelRouteCard = (title, route, note = '') => {
    const card = document.createElement('section')
    card.className = 'harness-mobile-model-route'
    const heading = document.createElement('h3')
    heading.textContent = title
    const value = document.createElement('strong')
    value.textContent = route?.provider && route?.model ? `${route.provider} / ${route.model}` : '尚未配置'
    card.append(heading, value)
    if (note) {
      const caption = document.createElement('p')
      caption.textContent = note
      card.appendChild(caption)
    }
    return card
  }

  const renderMobileModelRouting = (panel, routing) => {
    panel.replaceChildren()
    panel.setAttribute('aria-busy', 'false')

    const intro = document.createElement('section')
    intro.className = 'harness-mobile-model-intro'
    const title = document.createElement('h2')
    title.textContent = '当前模型路由'
    const description = document.createElement('p')
    description.textContent = '只读显示，来源：已配对电脑。模型凭据和提供方设置仍只在电脑端管理。'
    const badge = document.createElement('span')
    badge.textContent = routing.configured ? '已配置' : '尚未配置'
    intro.append(title, description, badge)
    panel.appendChild(intro)

    const routes = document.createElement('div')
    routes.className = 'harness-mobile-model-routes'
    routes.appendChild(modelRouteCard('主模型', routing.main))
    const subagentNote = routing.subagent?.inheritMain ? '跟随主模型' : '独立子代理路由'
    routes.appendChild(modelRouteCard('子代理', routing.subagent, subagentNote))
    panel.appendChild(routes)

    const catalog = document.createElement('section')
    catalog.className = 'harness-mobile-model-catalog'
    const catalogTitle = document.createElement('h2')
    catalogTitle.textContent = '提供方目录'
    const catalogNote = document.createElement('p')
    catalogNote.textContent = '这里只显示电脑端可选目录，不代表凭据或连接状态。'
    catalog.append(catalogTitle, catalogNote)
    if (!routing.providers.length) {
      const empty = document.createElement('div')
      empty.className = 'harness-mobile-model-empty'
      empty.textContent = '已配对电脑暂未返回可显示的提供方。'
      catalog.appendChild(empty)
    }
    for (const provider of routing.providers) {
      const details = document.createElement('details')
      const summary = document.createElement('summary')
      const providerName = document.createElement('span')
      providerName.textContent = provider.name || provider.id
      const count = document.createElement('small')
      count.textContent = `${provider.models.length} 个模型`
      summary.append(providerName, count)
      details.appendChild(summary)
      const identity = document.createElement('p')
      identity.textContent = `Provider ID：${provider.id}`
      details.appendChild(identity)
      const list = document.createElement('ul')
      for (const model of provider.models.slice(0, 24)) {
        const item = document.createElement('li')
        item.textContent = model
        list.appendChild(item)
      }
      if (provider.models.length > 24) {
        const item = document.createElement('li')
        item.textContent = `另有 ${provider.models.length - 24} 个模型，请在电脑端查看完整目录`
        list.appendChild(item)
      }
      if (!provider.models.length) {
        const item = document.createElement('li')
        item.textContent = '没有可显示的模型条目'
        list.appendChild(item)
      }
      details.appendChild(list)
      catalog.appendChild(details)
    }
    panel.appendChild(catalog)

    const footer = document.createElement('p')
    footer.className = 'harness-mobile-model-footnote'
    footer.textContent = '选择当前对话模型请返回输入框；新增提供方、保存 API Key 或探测端点请使用已配对电脑。'
    panel.appendChild(footer)
  }

  const loadMobileModelRouting = async (panel, content) => {
    panel.setAttribute('aria-busy', 'true')
    panel.replaceChildren()
    const loading = document.createElement('div')
    loading.className = 'harness-mobile-model-loading'
    loading.setAttribute('role', 'status')
    loading.textContent = '正在从已配对电脑读取模型配置…'
    panel.appendChild(loading)
    try {
      const response = await fetch('/__harness_mobile__/model-routing', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      })
      if (!response.ok) throw new Error(`model routing ${response.status}`)
      const payload = await response.json()
      const routing = payload?.ok === true ? payload.routing : null
      if (!routing || !Array.isArray(routing.providers)) throw new Error('invalid model routing response')
      if (!panel.isConnected || content.dataset.harnessMobileModelRouting !== 'true') return
      renderMobileModelRouting(panel, routing)
    } catch {
      if (!panel.isConnected || content.dataset.harnessMobileModelRouting !== 'true') return
      panel.replaceChildren()
      panel.setAttribute('aria-busy', 'false')
      const error = document.createElement('section')
      error.className = 'harness-mobile-model-error'
      error.setAttribute('role', 'alert')
      const title = document.createElement('h2')
      title.textContent = '无法读取模型配置'
      const copy = document.createElement('p')
      copy.textContent = '无法从已配对电脑读取。请确认电脑端 Harness 正在运行，然后重试；模型设置没有被猜测或缓存。'
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.textContent = '重试'
      retry.addEventListener('click', () => loadMobileModelRouting(panel, content))
      error.append(title, copy, retry)
      panel.appendChild(error)
    }
  }

  const decorateMobileModelSettings = (nav, content) => {
    const active = nav?.querySelector?.('button[aria-current="true"]')
    const existing = content?.querySelector?.(':scope > #harness-mobile-model-routing')
    if (!modelSettingsButton(active)) {
      if (content) delete content.dataset.harnessMobileModelRouting
      existing?.remove()
      return
    }
    content.dataset.harnessMobileModelRouting = 'true'
    if (existing) return
    const panel = document.createElement('div')
    panel.id = 'harness-mobile-model-routing'
    panel.setAttribute('aria-label', '手机模型配置只读视图')
    content.appendChild(panel)
    loadMobileModelRouting(panel, content)
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
    decorateMobileModelSettings(nav, content)
  }

  const decorateDialogs = () => {
    let settingsOpen = false
    for (const dialog of document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog')) {
      const nav = dialog.querySelector(':scope > nav')
      const content = nav?.nextElementSibling
      const buttons = [...(nav?.querySelectorAll?.('button') || [])]
      const settings = dialog.dataset.harnessMobileSettingsDialog === 'true' || Boolean(
        content && buttons.length >= 3 && buttons.some(button => button.getAttribute('aria-current') === 'true')
      )
      if (settings) {
        settingsOpen = true
        decorateSettingsDialog(dialog, nav, content)
      } else {
        dialog.dataset.harnessMobileSheet = 'true'
        delete dialog.dataset.harnessMobileSettingsDialog
      }
    }
    if (settingsOpen) root.dataset.harnessMobileSettingsOpen = 'true'
    else delete root.dataset.harnessMobileSettingsOpen
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
    if (composer) {
      composer.dataset.harnessMobileComposer = 'qianwen'
      if (composer.parentElement) composer.parentElement.dataset.harnessMobileComposerFrame = 'true'
    }
    if (inputScroll) inputScroll.dataset.harnessMobileComposerInput = 'true'
    if (input) {
      input.dataset.harnessMobileComposerTextarea = 'true'
      const language = typeof navigator === 'object' ? navigator.language || '' : ''
      input.placeholder = /^zh\b/i.test(language) ? '发消息…' : 'Message…'
    }
  }

  let composerStyleRestorations = []
  let containedComposerCard = null
  let containedComposerButton = null
  const containComposerContext = () => {
    if (typeof document.querySelector !== 'function') return
    const card = document.querySelector('[data-composer-card]')
    const button = card?.querySelector('button[aria-haspopup="listbox"]') || null
    if (card === containedComposerCard && button === containedComposerButton) return
    for (const restore of composerStyleRestorations.splice(0)) restore()
    containedComposerCard = card
    containedComposerButton = button
    if (!card || !button || !button.parentElement) return
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
    if (button.closest('[data-conversation-scroll]') && !button.closest('[data-composer-card]')) return
    setTemporary(button.parentElement, 'min-width', '0px')
    setTemporary(button.parentElement, 'max-width', '100%')
    setTemporary(button.parentElement, 'overflow', 'hidden')
    setTemporary(button, 'min-width', '0px')
    setTemporary(button, 'max-width', '100%')
  }

  const installImeSendBridge = () => {
    if (window.__harnessMobileImeSendBridge || typeof document.addEventListener !== 'function') return
    window.__harnessMobileImeSendBridge = true
    let composing = false
    let pendingStop = null
    const composerTextarea = target => target?.matches?.('[data-composer-card] textarea') ? target : null
    const actionLabel = button => `${button?.getAttribute?.('aria-label') || ''} ${button?.title || ''}`.trim()
    const isStop = button => /stop generating|停止生成|停止运行/i.test(actionLabel(button))
    const isSend = button => /send message|发送消息|发送/i.test(actionLabel(button))
    const activateOfficialSend = textarea => {
      let attempts = 0
      const activate = () => {
        const card = textarea?.closest?.('[data-composer-card]') || document.querySelector('[data-composer-card]')
        const send = [...(card?.querySelectorAll?.('button') || [])].find(button => isSend(button) && !button.disabled && visible(button))
        if (send) {
          pendingStop = null
          send.click()
          textarea?.focus?.({ preventScroll: true })
          return
        }
        if (++attempts < 6) setTimeout(activate, 24)
        else pendingStop = null
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(activate)
      else setTimeout(activate, 16)
    }
    document.addEventListener('compositionstart', event => {
      if (composerTextarea(event.target)) composing = true
    }, true)
    document.addEventListener('compositionend', event => {
      const textarea = composerTextarea(event.target)
      composing = false
      if (textarea && pendingStop) activateOfficialSend(textarea)
    }, true)
    document.addEventListener('pointerdown', event => {
      const button = event.target?.closest?.('[data-composer-card] button')
      const textarea = button?.closest?.('[data-composer-card]')?.querySelector?.('textarea')
      if (!button || !textarea || !isStop(button)) return
      if (!composing && !(textarea.value || '').trim()) return
      pendingStop = button
      // Keep the first tap from stopping the active generation while Android
      // commits the IME candidate and React swaps Stop for the real Send button.
      const cancelStopClick = clickEvent => {
        if (pendingStop !== button || clickEvent.target !== button && !button.contains(clickEvent.target)) return
        clickEvent.preventDefault()
        clickEvent.stopImmediatePropagation()
        document.removeEventListener('click', cancelStopClick, true)
      }
      document.addEventListener('click', cancelStopClick, true)
      setTimeout(() => {
        document.removeEventListener('click', cancelStopClick, true)
        if (pendingStop === button) activateOfficialSend(textarea)
      }, 0)
    }, true)
  }

  const installComposerLift = () => {
    if (window.__harnessMobileComposerLift || typeof document.addEventListener !== 'function') return
    window.__harnessMobileComposerLift = true
    let largestViewportHeight = Number(window.visualViewport?.height || window.innerHeight || 0)
    let scheduled = false
    const composerTextarea = () => document.querySelector('[data-composer-card] textarea[data-phase]')
    const update = () => {
      scheduled = false
      const viewport = window.visualViewport
      const viewportHeight = Number(viewport?.height || window.innerHeight || 0)
      if (document.activeElement !== composerTextarea()) largestViewportHeight = Math.max(largestViewportHeight, viewportHeight)
      const textarea = composerTextarea()
      const focused = Boolean(textarea && document.activeElement === textarea)
      const viewportCovered = largestViewportHeight > 0 && largestViewportHeight - viewportHeight >= Math.max(120, largestViewportHeight * .18)
      const nativeImeOpen = root.dataset.harnessMobileIme === 'open'
      const lifted = focused && (nativeImeOpen || viewportCovered)
      root.dataset.harnessMobileComposerLifted = String(lifted)
      const layoutHeight = Number(window.innerHeight || viewportHeight)
      const visualOverlay = viewport ? Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop)) : 0
      const nativeImeHeight = Math.max(0, Number.parseFloat(root.style.getPropertyValue('--harness-mobile-ime-height')) || 0)
      const overlay = lifted ? (viewportCovered ? visualOverlay : nativeImeHeight) : 0
      root.style.setProperty('--harness-mobile-ime-overlay', `${overlay}px`)
      if (!lifted) return
      const reveal = () => {
        const seat = textarea.closest('[data-composer-seat]') || textarea.closest('[data-harness-mobile-composer-frame="true"]')
        seat?.scrollIntoView?.({ block: 'end', inline: 'nearest', behavior: 'smooth' })
        const scroll = textarea.closest('[data-conversation-scroll]')
        if (scroll) scroll.scrollTop = scroll.scrollHeight
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(reveal)
      else setTimeout(reveal, 16)
    }
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(update)
      else setTimeout(update, 16)
    }
    document.addEventListener('focusin', schedule, true)
    document.addEventListener('focusout', () => setTimeout(schedule, 80), true)
    window.visualViewport?.addEventListener?.('resize', schedule)
    window.visualViewport?.addEventListener?.('scroll', schedule)
    window.addEventListener?.('resize', schedule)
    window.addEventListener?.('harness-mobile-ime-change', schedule)
    schedule()
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

  const installScreenshotSuggestion = () => {
    if (window.__harnessMobileScreenshotSuggestion || typeof window.addEventListener !== 'function') return
    window.__harnessMobileScreenshotSuggestion = true
    let dismissTimer = 0
    const dismiss = () => {
      clearTimeout(dismissTimer)
      dismissTimer = 0
      const chip = document.getElementById('harness-mobile-screenshot-suggestion')
      if (!chip) return
      chip.dataset.visible = 'false'
      setTimeout(() => {
        if (chip.dataset.visible === 'false') chip.remove()
      }, 220)
    }
    const show = () => {
      let chip = document.getElementById('harness-mobile-screenshot-suggestion')
      if (!chip) {
        chip = document.createElement('aside')
        chip.id = 'harness-mobile-screenshot-suggestion'
        chip.setAttribute('role', 'status')
        chip.setAttribute('aria-live', 'polite')
        chip.setAttribute('aria-label', '刚刚截了图。应用没有自动读取图片。')
        const copy = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = '刚刚截了图'
        const note = document.createElement('span')
        note.textContent = '应用没有读取图片'
        copy.append(title, note)
        const add = document.createElement('button')
        add.type = 'button'
        add.dataset.action = 'add'
        add.textContent = '添加'
        add.setAttribute('aria-label', '从系统照片选择器添加刚刚的截图')
        add.addEventListener('click', () => {
          const photo = document.getElementById('harness-mobile-photo-button')
          if (!photo || photo.disabled) return
          dismiss()
          photo.click()
        })
        const close = document.createElement('button')
        close.type = 'button'
        close.dataset.action = 'close'
        close.textContent = '×'
        close.setAttribute('aria-label', '关闭截图提示')
        close.addEventListener('click', dismiss)
        chip.append(copy, add, close)
        document.body.appendChild(chip)
      }
      const photo = document.getElementById('harness-mobile-photo-button')
      const add = chip.querySelector('button[data-action="add"]')
      if (add) {
        add.disabled = !photo || photo.disabled
        add.setAttribute('aria-disabled', add.disabled ? 'true' : 'false')
      }
      chip.dataset.visible = 'true'
      clearTimeout(dismissTimer)
      dismissTimer = setTimeout(dismiss, 12_000)
    }
    window.addEventListener('harness-mobile-screen-captured', show)
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
    installImeSendBridge()
    installComposerLift()
    installSidebarAutoClose()
    syncMobileAppShell()
    installHistoryRecovery()
    installThemeBridge()
    installScreenshotSuggestion()
    installControlSettingsEntry()
  }

  mount()
  if (!window.__harnessMobileUiObserver) {
    let scheduled = false
    const scheduleMount = () => {
      if (scheduled || document.visibilityState === 'hidden') return
      scheduled = true
      const run = () => {
        scheduled = false
        mount()
      }
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }
    const structuralSelector = '[data-composer-card],[data-slot="sidebar"],[role="dialog"],dialog,[role="menu"],[role="listbox"],header'
    const needsMount = record => {
      const target = record.target?.nodeType === Node.ELEMENT_NODE ? record.target : record.target?.parentElement
      if (target?.closest?.(structuralSelector)) return true
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue
        if (node.matches?.(structuralSelector) || node.querySelector?.(structuralSelector)) return true
      }
      // Streaming tokens and newly appended message text live entirely inside
      // the conversation view. They already inherit CSS and must never trigger
      // a whole-document scan/layout pass for every chunk.
      return !target?.closest?.('[data-conversation-view]')
    }
    window.__harnessMobileUiObserver = new MutationObserver(records => {
      if (records.some(needsMount)) scheduleMount()
    })
    window.__harnessMobileUiObserver.observe(root, { childList: true, subtree: true })
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleMount()
    })
  }
})()
