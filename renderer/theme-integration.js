(function exposeThemeIntegration(root) {
  function guestThemeBootstrap() {
    if (window.__HARNESS_DESKTOP_THEME_INSTALLED__) return
    window.__HARNESS_DESKTOP_THEME_INSTALLED__ = true

    const request = (action, values = {}) => {
      if (document.documentElement.dataset.harnessMobile === 'true') {
        if (action === 'choose-theme-background') {
          window.alert('自定义背景图请先在电脑端选择；主题配色可以直接在手机端保存。')
          return Promise.resolve(null)
        }
        if (action === 'open-external') {
          if (values.url) window.location.href = values.url
          return Promise.resolve(null)
        }
        return fetch('/__harness_mobile__/appearance', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, values })
        }).then(response => {
          if (!response.ok) throw new Error(`appearance ${response.status}`)
          return response.json()
        }).then(payload => {
          window.__HARNESS_DESKTOP_THEME_STATE__ = payload.state
          window.__HARNESS_DESKTOP_THEMES__ = payload.catalog
          window.__HARNESS_DESKTOP_RENDER_THEMES__?.()
          return payload
        }).catch(error => {
          console.warn('Unable to save mobile appearance:', error)
          return null
        })
      }
      const query = new URLSearchParams(values).toString()
      location.href = `harness-desktop://${action}/${query ? `?${query}` : ''}`
    }
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character])
    const hexWithAlpha = (value, alpha) => /^#[0-9a-f]{6}$/i.test(value || '') ? `${value}${alpha}` : value
    const completeThemeVars = (vars, tone) => {
      const base = vars['--dsw-alias-bg-base'] || (tone === 'dark' ? '#151517' : '#ffffff')
      const layer1 = vars['--dsw-alias-bg-layer-1'] || base
      const layer2 = vars['--dsw-alias-bg-layer-2'] || layer1
      const layer3 = vars['--dsw-alias-bg-layer-3'] || layer2
      const module = vars['--dsw-alias-bg-module-platform'] || layer2
      const brand = vars['--dsw-alias-brand-primary'] || (tone === 'dark' ? '#f1f3f5' : '#202124')
      const brandText = vars['--dsw-alias-brand-text'] || brand
      const primary = vars['--dsw-alias-label-primary'] || (tone === 'dark' ? '#f5f6f7' : '#17191c')
      const secondary = vars['--dsw-alias-label-secondary'] || primary
      const tertiary = vars['--dsw-alias-label-tertiary'] || secondary
      const hover = vars['--dsw-alias-interactive-bg-hover'] || (tone === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(23,59,58,.08)')
      const active = vars['--dsw-alias-interactive-bg-active'] || (tone === 'dark' ? 'rgba(255,255,255,.14)' : 'rgba(23,59,58,.12)')
      const border2 = vars['--dsw-alias-border-l2'] || (tone === 'dark' ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)')
      const border3 = vars['--dsw-alias-border-l3'] || border2
      const foreground = tone === 'dark' ? '#0f1115' : '#ffffff'
      return {
        '--dsw-alias-bg-mask-1': tone === 'dark' ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.24)',
        '--dsw-alias-bg-mask-2': tone === 'dark' ? 'rgba(0,0,0,.2)' : 'rgba(0,0,0,.12)',
        '--dsw-alias-bg-mask-3': 'rgba(0,0,0,.48)',
        '--dsw-alias-bg-mask-drop': tone === 'dark' ? 'rgba(15,17,21,.72)' : 'rgba(255,255,255,.72)',
        '--dsw-alias-bg-module-platform': module,
        '--dsw-alias-bg-multi-select': module,
        '--dsw-alias-bg-overlay': layer3,
        '--dsw-alias-bg-skeleton': tone === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.04)',
        '--dsw-alias-border-inverted': tone === 'dark' ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,0)',
        '--dsw-alias-border-inverted2': tone === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,0)',
        '--dsw-alias-border-l2-darkmode-thin': border2,
        '--dsw-alias-border-l4': border3,
        '--dsw-alias-brand-primary-invert': foreground,
        '--dsw-alias-button-contrast-fill': brand,
        '--dsw-alias-button-elevated-fill': layer1,
        '--dsw-alias-button-floating-fill': layer2,
        '--dsw-alias-button-floating-hover': layer3,
        '--dsw-alias-button-ghost-active-border': border3,
        '--dsw-alias-button-ghost-active-fill': active,
        '--dsw-alias-button-ghost-active-hover': hover,
        '--dsw-alias-button-info-fill': brand,
        '--dsw-alias-button-info-hover': brandText,
        '--dsw-alias-button-primary-dimmed': module,
        '--dsw-alias-button-primary-fill': brand,
        '--dsw-alias-button-primary-hover': brandText,
        '--dsw-alias-interactive-bg-active': active,
        '--dsw-alias-interactive-bg-hover-accent': active,
        '--dsw-alias-interactive-bg-hover-solid': module,
        '--dsw-alias-label-caption': tertiary,
        '--dsw-alias-label-dimmed': tertiary,
        '--dsw-alias-label-primary-bluish': primary,
        '--dsw-alias-label-primary-dimmed': secondary,
        '--dsw-alias-label-primary-foreground': foreground,
        '--dsw-alias-label-primary-inverted': foreground,
        '--dsw-alias-scrollbar-bg-l1': border2,
        '--dsw-alias-scrollbar-bg-l2': border2,
        '--dsw-alias-scrollbar-hover-l1': border3,
        '--dsw-alias-scrollbar-hover-l2': border3,
        '--dsw-alias-toast-bg': layer3,
        '--dsw-alias-tooltip-bg': layer3,
        '--dsw-specific-bubble': module,
        '--dsw-specific-bubble-highlight': layer3,
        '--dsw-specific-selector': module,
        '--dsw-specific-sidebar-nav-item-active': active,
        '--dsw-specific-sidebar-nav-item-active-accent': active,
        '--dsw-specific-sidebar-nav-item-hover': hover,
        '--dsw-specific-tip': module,
        ...vars
      }
    }

    const style = document.createElement('style')
    style.dataset.harnessDesktop = 'themes'
    style.textContent = `
      .hd-theme-panel { box-sizing:border-box; flex:1; min-height:0; overflow:auto; padding:4px 24px 28px; color:var(--dsw-alias-label-primary); }
      .hd-theme-panel[hidden], .hd-theme-native-hidden { display:none !important; }
      .hd-theme-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:4px 0 18px; }
      .hd-theme-heading h2 { margin:0; font-size:18px; line-height:28px; }
      .hd-theme-heading p { max-width:620px; margin:3px 0 0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .hd-theme-button { min-height:34px; border:1px solid var(--dsw-alias-border-l2); border-radius:9px; padding:6px 13px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); font:inherit; font-size:12px; cursor:pointer; }
      .hd-theme-button:hover { background:var(--dsw-alias-interactive-bg-hover); }
      .hd-theme-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:14px; }
      .hd-theme-card { overflow:hidden; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); box-shadow:0 8px 24px rgba(0,0,0,.07); cursor:pointer; transition:transform .16s ease,border-color .16s ease; }
      .hd-theme-card:hover { transform:translateY(-2px); border-color:var(--dsw-alias-brand-primary); }
      .hd-theme-card[data-selected="true"] { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:1px; }
      .hd-theme-preview { position:relative; height:112px; background-position:center; background-size:cover; }
      .hd-theme-preview::after { content:""; position:absolute; inset:16px 17px; border:1px solid rgba(255,255,255,.38); border-radius:8px; background:rgba(255,255,255,.12); box-shadow:-32px 0 0 -22px rgba(255,255,255,.22); backdrop-filter:blur(4px); }
      .hd-theme-body { padding:12px 13px 13px; }
      .hd-theme-titleline { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .hd-theme-titleline strong { font-size:13px; }
      .hd-theme-license { border-radius:5px; padding:2px 5px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-module-platform); font-size:10px; }
      .hd-theme-license[data-nc="true"] { color:#b45309; background:rgba(245,158,11,.14); }
      .hd-theme-description { min-height:36px; margin:7px 0 9px; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:18px; }
      .hd-theme-meta { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--dsw-alias-label-tertiary); font-size:10px; }
      .hd-theme-author { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .hd-theme-gesture { flex:none; color:var(--dsw-alias-label-tertiary); }
      .hd-theme-card[data-selected="true"] .hd-theme-gesture { color:var(--dsw-alias-brand-text); }
      .hd-theme-source { border:0; padding:0; color:var(--dsw-alias-brand-text); background:none; font:inherit; cursor:pointer; }
      .hd-custom-editor { margin-top:18px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; padding:16px; background:var(--dsw-alias-bg-layer-1); }
      .hd-custom-editor h3 { margin:0 0 4px; font-size:14px; }
      .hd-custom-editor p { margin:0 0 14px; color:var(--dsw-alias-label-secondary); font-size:11px; }
      .hd-custom-fields { display:grid; grid-template-columns:repeat(4,minmax(120px,1fr)); gap:12px; }
      .hd-custom-fields label { display:grid; gap:6px; color:var(--dsw-alias-label-secondary); font-size:11px; }
      .hd-custom-fields input[type="color"] { width:100%; height:38px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:3px; background:var(--dsw-alias-bg-layer-2); }
      .hd-custom-fields select { height:38px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:0 9px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }
      .hd-custom-actions { display:flex; align-items:center; gap:8px; margin-top:14px; }
      .hd-custom-hint { margin-left:auto; color:var(--dsw-alias-label-tertiary); font-size:10px; }
      @media (max-width:900px) { .hd-custom-fields { grid-template-columns:repeat(2,minmax(120px,1fr)); } }
      html[data-hd-theme]:not([data-hd-theme="official"]) body { min-height:100vh; background-position:center !important; background-size:cover !important; background-attachment:fixed !important; }
      html[data-hd-theme]:not([data-hd-theme="official"]) #root { position:relative; z-index:1; min-height:100vh; background:transparent !important; }
      html[data-hd-theme]:not([data-hd-theme="official"]) #root > [data-slot="root"] > *,
      html[data-hd-theme]:not([data-hd-theme="official"]) [data-slot="conversation"] > * { background:transparent !important; }
      html[data-hd-theme]:not([data-hd-theme="official"]) [data-slot="sidebar"] > * {
        background:var(--hd-theme-sidebar) !important;
      }
      html[data-hd-theme]:not([data-hd-theme="official"]) [data-composer-card="true"] {
        background:var(--hd-theme-input) !important;
        backdrop-filter:blur(18px) saturate(1.08);
      }
      html[data-hd-theme]:not([data-hd-theme="official"]) [role="dialog"] {
        background:var(--hd-theme-dialog) !important;
        backdrop-filter:blur(22px) saturate(1.08);
      }
      html[data-hd-theme="maid-atelier"] body::before, html[data-hd-theme="maid-atelier"] body::after { content:""; position:fixed; z-index:0; bottom:0; width:min(29vw,430px); height:78vh; background-repeat:no-repeat; background-position:center bottom; background-size:contain; pointer-events:none; filter:drop-shadow(0 12px 28px rgba(0,24,54,.2)); }
      html[data-hd-theme="maid-atelier"] body::before { left:clamp(210px,20vw,300px); background-image:var(--hd-maid-left); }
      html[data-hd-theme="maid-atelier"] body::after { right:2vw; background-image:var(--hd-maid-right); }
    `
    document.head.appendChild(style)

    const themeById = id => (window.__HARNESS_DESKTOP_THEMES__ || []).find(theme => theme.id === id)
    const customThemeFromState = state => {
      const custom = state?.customTheme || {}
      const accent = custom.accent || '#6f8cff'
      const surface = custom.surface || '#171b29'
      const text = custom.text || '#f4f7ff'
      return {
        id: 'custom', mode: custom.mode === 'light' ? 'light' : 'dark',
        preview: `radial-gradient(circle at 18% 14%, ${accent} 0%, transparent 34%), linear-gradient(145deg, ${surface}, ${accent})`,
        customBackgroundDataUrl: state?.customBackgroundDataUrl || '',
        vars: {
          '--dsw-alias-bg-base': hexWithAlpha(surface, 'e8'),
          '--dsw-alias-bg-layer-1': hexWithAlpha(surface, 'dc'),
          '--dsw-alias-bg-layer-2': hexWithAlpha(surface, 'ee'),
          '--dsw-alias-bg-layer-3': hexWithAlpha(surface, 'f5'),
          '--dsw-alias-bg-module-platform': hexWithAlpha(surface, 'd8'),
          '--dsw-alias-label-primary': text,
          '--dsw-alias-label-secondary': hexWithAlpha(text, 'c7'),
          '--dsw-alias-label-tertiary': hexWithAlpha(text, '91'),
          '--dsw-alias-brand-primary': accent,
          '--dsw-alias-brand-text': accent,
          '--dsw-alias-border-l1': hexWithAlpha(text, '14'),
          '--dsw-alias-border-l2': hexWithAlpha(text, '2b'),
          '--dsw-alias-border-l3': hexWithAlpha(text, '42'),
          '--dsw-alias-interactive-bg-hover': hexWithAlpha(accent, '24'),
          '--dsw-specific-sidebar-fill': hexWithAlpha(surface, 'e6'),
          '--dsw-specific-input-major': hexWithAlpha(surface, 'f2'),
          '--dsw-specific-menu': hexWithAlpha(surface, 'fa'),
          '--dsw-alias-markdown-code-block': hexWithAlpha(surface, 'd9')
        }
      }
    }

    const applyTheme = requestedId => {
      const state = window.__HARNESS_DESKTOP_THEME_STATE__ || { themeId: 'official' }
      const id = requestedId || state.themeId || 'official'
      const old = document.querySelector('#harness-desktop-active-theme')
      if (id === 'official') {
        old?.remove()
        document.documentElement.removeAttribute('data-hd-theme')
        document.documentElement.removeAttribute('data-hd-skin-tone')
        window.__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__ = ''
        return
      }

      let theme = id === 'custom' ? customThemeFromState(state) : themeById(id)
      if (!theme) return
      const officialTone = getComputedStyle(document.documentElement).colorScheme.includes('dark') ? 'dark' : 'light'
      const tone = theme.mode === 'adaptive' ? officialTone : theme.mode
      const vars = completeThemeVars({ ...theme.vars, ...(theme.mode === 'adaptive' && tone === 'dark' ? theme.darkVars : {}) }, tone)
      const wallpaper = theme.id === 'maid-atelier'
        ? `linear-gradient(${tone === 'dark' ? 'rgba(1,14,29,.18),rgba(1,14,29,.42)' : 'rgba(238,250,255,.12),rgba(209,236,248,.35)'}),url("${tone === 'dark' ? theme.assets?.night : theme.assets?.day}")`
        : theme.customBackgroundDataUrl
          ? `linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.18)),url("${theme.customBackgroundDataUrl}")`
          : theme.preview
      const active = document.createElement('style')
      active.id = 'harness-desktop-active-theme'
      const isolatedSurfaces = {
        '--hd-theme-sidebar': vars['--dsw-specific-sidebar-fill'] || vars['--dsw-alias-bg-layer-1'] || 'transparent',
        '--hd-theme-input': vars['--dsw-specific-input-major'] || vars['--dsw-alias-bg-layer-1'] || 'transparent',
        '--hd-theme-dialog': vars['--dsw-alias-bg-layer-1'] || vars['--dsw-alias-bg-base'] || 'transparent'
      }
      const themeValues = { ...vars, ...isolatedSurfaces }
      const signature = JSON.stringify([theme.id, tone, wallpaper, themeValues])
      if (old && window.__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__ === signature && document.documentElement.dataset.hdTheme === theme.id) return
      old?.remove()
      active.textContent = `
        html[data-hd-theme="${theme.id}"],
        html[data-hd-theme="${theme.id}"] body,
        html[data-hd-theme="${theme.id}"] #root,
        html[data-hd-theme="${theme.id}"] [data-theme],
        html[data-hd-theme="${theme.id}"] [data-color-scheme],
        html[data-hd-theme="${theme.id}"] [data-slot="root"] { color-scheme:${tone}; ${Object.entries(themeValues).map(([name, value]) => `${name}:${value} !important;`).join('')} ${theme.id === 'maid-atelier' ? `--hd-maid-left:url("${theme.assets?.left}");--hd-maid-right:url("${theme.assets?.right}");` : ''} }
        html[data-hd-theme="${theme.id}"] body { background:${wallpaper} center/cover fixed !important; }
      `
      document.head.appendChild(active)
      document.documentElement.dataset.hdTheme = theme.id
      document.documentElement.dataset.hdSkinTone = tone
      window.__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__ = signature
    }

    const renderCards = panel => {
      const catalog = window.__HARNESS_DESKTOP_THEMES__ || []
      const state = window.__HARNESS_DESKTOP_THEME_STATE__ || { themeId: 'official', customTheme: {} }
      const grid = panel.querySelector('[data-hd-theme-grid]')
      if (!grid || grid.dataset.count !== String(catalog.length)) {
        grid.dataset.count = String(catalog.length)
        grid.innerHTML = catalog.map(theme => `
          <article class="hd-theme-card" data-hd-theme-card="${escapeHtml(theme.id)}" tabindex="0">
            <div class="hd-theme-preview" style="background:${escapeHtml(theme.preview)}"></div>
            <div class="hd-theme-body">
              <div class="hd-theme-titleline"><strong>${escapeHtml(theme.name)}</strong><span class="hd-theme-license" data-nc="${theme.nonCommercial ? 'true' : 'false'}">${escapeHtml(theme.license)}</span></div>
              <div class="hd-theme-description">${escapeHtml(theme.description)}</div>
              <div class="hd-theme-meta"><span class="hd-theme-author">${escapeHtml(theme.author)}</span><span class="hd-theme-gesture" data-hd-gesture>双击使用</span>${theme.source ? `<button type="button" class="hd-theme-source" data-hd-source="${escapeHtml(theme.source)}">来源</button>` : ''}</div>
            </div>
          </article>`).join('')
        grid.querySelectorAll('[data-hd-theme-card]').forEach(card => {
          let lastAppliedAt = 0
          const choose = () => {
            const now = Date.now()
            if (now - lastAppliedAt < 600) return
            lastAppliedAt = now
            const themeId = card.dataset.hdThemeCard
            window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), themeId }
            applyTheme(themeId)
            renderCards(panel)
            request('set-theme', { id: themeId })
            const dialog = panel.closest('[role="dialog"]')
            const close = [...(dialog?.querySelectorAll('button') || [])].find(button => {
              const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.textContent || ''}`
              return /关闭|close/i.test(label) || button.textContent?.trim() === '×'
            })
            close?.click()
          }
          card.addEventListener('click', event => {
            if (event.target.closest('[data-hd-source]')) return
            card.focus()
            if (document.documentElement.dataset.harnessMobile === 'true' || event.detail >= 2) choose()
          })
          card.addEventListener('dblclick', event => { if (!event.target.closest('[data-hd-source]')) choose() })
          card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose() } })
        })
        grid.querySelectorAll('[data-hd-source]').forEach(button => button.addEventListener('click', event => {
          event.stopPropagation()
          request('open-external', { url: event.currentTarget.dataset.hdSource || '' })
        }))
      }
      grid.querySelectorAll('[data-hd-theme-card]').forEach(card => {
        card.dataset.selected = String(card.dataset.hdThemeCard === state.themeId)
        const selected = card.dataset.hdThemeCard === state.themeId
        card.querySelector('[data-hd-gesture]').textContent = selected
          ? '当前使用'
          : document.documentElement.dataset.harnessMobile === 'true' ? '点击使用' : '双击使用'
        const theme = themeById(card.dataset.hdThemeCard)
        const preview = card.querySelector('.hd-theme-preview')
        if (theme?.id === 'maid-atelier' && theme.assets?.day) preview.style.background = `linear-gradient(rgba(5,31,59,.08),rgba(5,31,59,.28)),url("${theme.assets.day}") center/cover`
        if (theme?.id === 'custom') {
          const custom = customThemeFromState(state)
          preview.style.background = custom.customBackgroundDataUrl ? `url("${custom.customBackgroundDataUrl}") center/cover` : custom.preview
        }
      })
      const custom = state.customTheme || {}
      for (const [name, fallback] of Object.entries({ mode: 'dark', accent: '#6f8cff', surface: '#171b29', text: '#f4f7ff' })) {
        const input = panel.querySelector(`[data-hd-custom="${name}"]`)
        if (input && document.activeElement !== input) input.value = custom[name] || fallback
      }
      panel.querySelector('[data-hd-custom-background-state]').textContent = state.customBackgroundDataUrl ? '已选择本地背景图' : '未选择背景图，将使用渐变背景'
    }

    const createPanel = () => {
      const panel = document.createElement('section')
      panel.className = 'hd-theme-panel'
      panel.dataset.hdThemePanel = ''
      panel.hidden = true
      panel.innerHTML = `
        <div class="hd-theme-heading"><div><h2>外观皮肤</h2><p>直接装饰官方 DeepSeek Harness 工作台，不创建第二套界面。选择即刻预览，随桌面版保存；可随时恢复官方外观。</p></div><button type="button" class="hd-theme-button" data-hd-restore>恢复官方外观</button></div>
        <div class="hd-theme-grid" data-hd-theme-grid></div>
        <section class="hd-custom-editor"><h3>自定义主题</h3><p>背景图只保存在本机，不会上传；支持 PNG、JPG、WebP，最大 20 MB。</p>
          <div class="hd-custom-fields">
            <label>明暗模式<select data-hd-custom="mode"><option value="dark">深色</option><option value="light">浅色</option></select></label>
            <label>强调色<input type="color" data-hd-custom="accent" value="#6f8cff"></label>
            <label>表面色<input type="color" data-hd-custom="surface" value="#171b29"></label>
            <label>文字色<input type="color" data-hd-custom="text" value="#f4f7ff"></label>
          </div>
          <div class="hd-custom-actions"><button type="button" class="hd-theme-button" data-hd-choose-background>选择本地背景图</button><button type="button" class="hd-theme-button" data-hd-save-custom>应用自定义主题</button><span class="hd-custom-hint" data-hd-custom-background-state></span></div>
        </section>`
      panel.querySelector('[data-hd-restore]').addEventListener('click', () => {
        window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), themeId: 'official' }
        applyTheme('official'); renderCards(panel); request('set-theme', { id: 'official' })
      })
      panel.querySelector('[data-hd-choose-background]').addEventListener('click', () => request('choose-theme-background'))
      panel.querySelector('[data-hd-save-custom]').addEventListener('click', () => {
        const values = Object.fromEntries(['mode', 'accent', 'surface', 'text'].map(name => [name, panel.querySelector(`[data-hd-custom="${name}"]`).value]))
        window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), themeId: 'custom', customTheme: { ...(window.__HARNESS_DESKTOP_THEME_STATE__?.customTheme || {}), ...values } }
        applyTheme('custom'); renderCards(panel); request('save-custom-theme', values)
      })
      return panel
    }

    const ensureNavigation = dialog => {
      const nav = dialog.querySelector('nav')
      const content = dialog.querySelector(':scope > nav + div')
      if (!nav || !content) return
      let skinButton = nav.querySelector('[data-hd-theme-nav]')
      let panel = content.querySelector('[data-hd-theme-panel]')
      if (skinButton && panel) {
        const themesVisible = skinButton.getAttribute('aria-current') === 'true'
        for (const section of [...content.children].filter(child => child !== panel)) section.classList.toggle('hd-theme-native-hidden', themesVisible)
        panel.hidden = !themesVisible
        renderCards(panel)
        return
      }
      const buttons = [...nav.querySelectorAll('button')]
      const general = buttons.find(button => /通用设置|General/i.test(button.textContent || ''))
      if (!general) return
      const inactive = buttons.find(button => button !== general)
      const activeOnly = [...general.classList].filter(name => !inactive?.classList.contains(name))
      skinButton = general.cloneNode(true)
      skinButton.dataset.hdThemeNav = ''
      skinButton.className = inactive?.className || general.className
      skinButton.removeAttribute('aria-current')
      const label = skinButton.querySelector('span:last-child')
      if (label) label.textContent = '外观皮肤'
      const icon = skinButton.querySelector('svg')
      if (icon) icon.outerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.1a6.9 6.9 0 1 0 0 13.8h1.1a1.35 1.35 0 0 0 .55-2.58.72.72 0 0 1 .3-1.38h1.15A3.8 3.8 0 0 0 14.9 7.1 6 6 0 0 0 8 1.1Zm-3.05 7A1.05 1.05 0 1 1 4.95 6a1.05 1.05 0 0 1 0 2.1Zm1.7-3A1.05 1.05 0 1 1 6.65 3a1.05 1.05 0 0 1 0 2.1Zm3.1-.15a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Zm2 2.2a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Z" fill="currentColor"/></svg>'
      general.parentElement.appendChild(skinButton)
      panel = createPanel()
      content.appendChild(panel)
      const nativeSections = () => [...content.children].filter(child => child !== panel)
      const showThemes = () => {
        [...nav.querySelectorAll('button')].forEach(button => { button.removeAttribute('aria-current'); activeOnly.forEach(name => button.classList.remove(name)) })
        activeOnly.forEach(name => skinButton.classList.add(name))
        skinButton.setAttribute('aria-current', 'true')
        for (const section of nativeSections()) section.classList.add('hd-theme-native-hidden')
        panel.hidden = false
        renderCards(panel)
      }
      skinButton.addEventListener('click', showThemes)
      nav.addEventListener('click', event => {
        if (event.target.closest('[data-hd-theme-nav]')) return
        panel.hidden = true
        for (const section of nativeSections()) section.classList.remove('hd-theme-native-hidden')
        activeOnly.forEach(name => skinButton.classList.remove(name))
        skinButton.removeAttribute('aria-current')
      })
      renderCards(panel)
    }

    const applySessionLogDock = () => {
      if (document.documentElement.dataset.harnessMobile === 'true') {
        for (const element of document.querySelectorAll('[data-hd-session-log-docked="true"]')) {
          for (const property of ['position', 'top', 'right', 'left', 'translate', 'z-index']) element.style.removeProperty(property)
          delete element.dataset.hdSessionLogDocked
        }
        return
      }
      const candidates = [...document.querySelectorAll('button,a')].filter(element => /Session log|会话日志|会话记录/i.test(element.textContent || ''))
      const active = new Set()
      for (const element of candidates) {
        const rect = element.getBoundingClientRect()
        if (rect.top > 54 && element.dataset.hdSessionLogDocked !== 'true') continue
        element.dataset.hdSessionLogDocked = 'true'
        element.style.setProperty('position', 'fixed', 'important')
        element.style.setProperty('top', '40px', 'important')
        element.style.setProperty('right', '12px', 'important')
        element.style.setProperty('left', 'auto', 'important')
        element.style.setProperty('translate', 'none', 'important')
        element.style.setProperty('z-index', '2147483000', 'important')
        active.add(element)
      }
      for (const element of document.querySelectorAll('[data-hd-session-log-docked="true"]')) {
        if (active.has(element)) continue
        for (const property of ['position', 'top', 'right', 'left', 'translate', 'z-index']) element.style.removeProperty(property)
        delete element.dataset.hdSessionLogDocked
      }
    }

    const mount = (refreshTheme = true) => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (dialog) ensureNavigation(dialog)
      applySessionLogDock()
      if (refreshTheme) applyTheme()
    }
    window.__HARNESS_DESKTOP_RENDER_THEMES__ = mount
    let mutationTimer = null
    let resizeFrame = null
    new MutationObserver(() => {
      clearTimeout(mutationTimer)
      mutationTimer = setTimeout(() => {
        mutationTimer = null
        mount(false)
      }, 120)
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] })
    window.addEventListener('resize', () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        applySessionLogDock()
      })
    })
    mount()
  }

  function prepareCatalog(catalog, assetDataUrls) {
    return catalog.map(theme => ({
      ...theme,
      assets: Object.fromEntries(Object.entries(theme.assets || {}).map(([name, relative]) => {
        const key = relative.replace(/^\.\/themes\//, '')
        return [name, assetDataUrls[key] || '']
      }))
    }))
  }

  async function install(webview) {
    await webview.executeJavaScript(`(${guestThemeBootstrap.toString()})()`, true)
  }

  async function publish(webview, state, catalog) {
    if (!webview.getURL()) return
    const serializedState = JSON.stringify(state).replaceAll('<', '\\u003c')
    const serializedCatalog = JSON.stringify(catalog).replaceAll('<', '\\u003c')
    await webview.executeJavaScript(`window.__HARNESS_DESKTOP_THEME_STATE__=${serializedState};window.__HARNESS_DESKTOP_THEMES__=${serializedCatalog};window.__HARNESS_DESKTOP_RENDER_THEMES__?.();`, true)
  }

  const api = {
    install,
    prepareCatalog,
    publish,
    mobileBootstrapSource: `(${guestThemeBootstrap.toString()})()`
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.harnessThemeIntegration = api
})(typeof window !== 'undefined' ? window : null)
