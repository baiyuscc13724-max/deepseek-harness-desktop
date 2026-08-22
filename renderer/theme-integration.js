(function exposeThemeIntegration(root) {
  function guestThemeBootstrap() {
    if (window.__HARNESS_DESKTOP_THEME_INSTALLED__) return
    window.__HARNESS_DESKTOP_THEME_INSTALLED__ = true

    const request = (action, values = {}) => {
      if (document.documentElement.dataset.harnessMobile === 'true') {
        if (action === 'choose-theme-background' || action === 'choose-wallpaper-engine') {
          window.alert('自定义图片或视频壁纸请先在电脑端选择；主题配色可以直接在手机端保存。')
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
    const uiModes = Object.freeze([
      { id: 'official', name: '官方经典', description: '保持官方材质与层级，作为随时可恢复的稳定基线。' },
      { id: 'aurora', name: '极光玻璃', description: '低透明玻璃、柔和渐变光影与清晰细边框。' },
      { id: 'spatial', name: '空间专注', description: '突出当前会话，辅助区域仅做轻度视觉降噪。' },
      { id: 'tactile', name: '触感实体', description: '在主要按钮和输入区增加克制的高光与按压反馈。' }
    ])
    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character])
    const hexWithAlpha = (value, alpha) => /^#[0-9a-f]{6}$/i.test(value || '') ? `${value}${alpha}` : value
    const boundedNumber = (value, minimum, maximum, fallback) => {
      const number = Number(value)
      return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback
    }
    const alphaHex = opacity => Math.round(Math.min(1, Math.max(0, opacity)) * 255).toString(16).padStart(2, '0')
    const hexWithOpacity = (value, opacity) => hexWithAlpha(value, alphaHex(opacity))
    const readableTextShadow = (text, strength) => {
      const match = /^#([0-9a-f]{6})$/i.exec(text || '')
      const rgb = match ? [0, 2, 4].map(offset => Number.parseInt(match[1].slice(offset, offset + 2), 16)) : [255, 255, 255]
      const brightText = rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 >= 150
      const shadow = brightText ? '0,0,0' : '255,255,255'
      const amount = Math.min(1, Math.max(0, strength / 100))
      return `0 1px 2px rgba(${shadow},${(.18 + amount * .58).toFixed(2)}),0 0 12px rgba(${shadow},${(.06 + amount * .24).toFixed(2)})`
    }
    const customThemeValues = state => {
      const custom = state?.customTheme || {}
      return {
        mode: custom.mode === 'light' ? 'light' : 'dark',
        accent: custom.accent || '#6f8cff',
        surface: custom.surface || '#171b29',
        text: custom.text || '#f4f7ff',
        wallpaperBrightness: boundedNumber(custom.wallpaperBrightness, 40, 140, 82),
        wallpaperBlur: boundedNumber(custom.wallpaperBlur, 0, 24, 2),
        glassTransparency: boundedNumber(custom.glassTransparency, 0, 92, 32),
        borderStrength: boundedNumber(custom.borderStrength, 0, 100, 48),
        readabilityStrength: boundedNumber(custom.readabilityStrength, 0, 100, 72)
      }
    }
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
      html body *::selection { color:inherit !important; background:rgba(49,94,251,.30) !important; background:color-mix(in srgb,var(--dsw-alias-brand-primary,#315efb) 32%,transparent) !important; }
      .hd-theme-panel { box-sizing:border-box; flex:1; min-height:0; overflow:auto; padding:4px 24px 28px; color:var(--dsw-alias-label-primary); }
      .hd-theme-panel[hidden], .hd-theme-native-hidden { display:none !important; }
      .hd-theme-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding:4px 0 18px; }
      .hd-theme-heading h2 { margin:0; font-size:18px; line-height:28px; }
      .hd-theme-heading p { max-width:620px; margin:3px 0 0; color:var(--dsw-alias-label-secondary); font-size:12px; line-height:18px; }
      .hd-theme-button { min-height:34px; border:1px solid var(--dsw-alias-border-l2); border-radius:9px; padding:6px 13px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); font:inherit; font-size:12px; white-space:nowrap; cursor:pointer; }
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
      .hd-custom-editor { container-type:inline-size; margin-top:18px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; padding:16px; background:var(--dsw-alias-bg-layer-1); }
      .hd-custom-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
      .hd-custom-heading h3 { margin:0 0 4px; font-size:14px; }
      .hd-custom-heading p { margin:0; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:18px; }
      .hd-custom-status { flex:none; color:var(--dsw-alias-label-tertiary); font-size:10px; }
      .hd-custom-layout { display:grid; grid-template-columns:minmax(250px,.8fr) minmax(360px,1.2fr); gap:12px; margin-top:14px; }
      .hd-custom-group { min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:11px; padding:12px; background:var(--dsw-alias-bg-layer-2); }
      .hd-custom-group h4 { margin:0 0 10px; font-size:11px; line-height:18px; }
      .hd-custom-fields { display:grid; grid-template-columns:repeat(2,minmax(100px,1fr)); gap:10px; }
      .hd-custom-fields label,.hd-custom-range-grid label { display:grid; gap:6px; color:var(--dsw-alias-label-secondary); font-size:10px; }
      .hd-custom-fields input[type="color"] { width:100%; height:36px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:3px; background:var(--dsw-alias-bg-layer-1); }
      .hd-custom-fields select { height:36px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:0 9px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); }
      .hd-custom-range-grid { display:grid; grid-template-columns:repeat(2,minmax(140px,1fr)); gap:10px 16px; }
      .hd-custom-range-grid label > span { display:flex; justify-content:space-between; gap:8px; }
      .hd-custom-range-grid output { color:var(--dsw-alias-label-primary); font-variant-numeric:tabular-nums; }
      .hd-custom-range-grid input[type="range"] { width:100%; margin:0; accent-color:var(--dsw-alias-brand-primary); }
      .hd-custom-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:8px; margin-top:14px; }
      .hd-custom-actions .hd-theme-primary { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-brand-primary); }
      .hd-custom-actions button:disabled { cursor:not-allowed; opacity:.45; }
      .hd-appearance-tabs { display:flex; gap:4px; margin:0 0 16px; border-bottom:1px solid var(--dsw-alias-border-l2); }
      .hd-appearance-tab { min-width:104px; min-height:36px; border:0; border-bottom:2px solid transparent; padding:0 13px; color:var(--dsw-alias-label-secondary); background:transparent; font:inherit; font-size:12px; cursor:pointer; }
      .hd-appearance-tab[aria-selected="true"] { border-bottom-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-label-primary); font-weight:650; }
      .hd-appearance-pane[hidden] { display:none!important; }
      .hd-ui-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
      .hd-ui-heading h3 { margin:0; font-size:16px; }
      .hd-ui-heading p { max-width:620px; margin:4px 0 0; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:18px; }
      .hd-ui-current { flex:none; border-radius:999px; padding:5px 10px; color:var(--dsw-alias-brand-text); background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent); font-size:10px; }
      .hd-ui-grid { display:grid; grid-template-columns:repeat(2,minmax(230px,1fr)); gap:12px; margin-top:16px; }
      .hd-ui-card { display:grid; grid-template-columns:118px 1fr; min-height:118px; overflow:hidden; border:1px solid var(--dsw-alias-border-l2); border-radius:13px; padding:0; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); text-align:left; font:inherit; cursor:pointer; transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease; }
      .hd-ui-card:hover { transform:translateY(-1px); border-color:var(--dsw-alias-brand-primary); }
      .hd-ui-card[data-selected="true"] { border-color:var(--dsw-alias-brand-primary); box-shadow:0 0 0 1px var(--dsw-alias-brand-primary); }
      .hd-ui-preview { position:relative; overflow:hidden; border-right:1px solid var(--dsw-alias-border-l2); background:#dfe8e6; }
      .hd-ui-preview::before,.hd-ui-preview::after { content:""; position:absolute; border-radius:9px; }
      .hd-ui-preview::before { inset:17px 13px; border:1px solid rgba(72,90,100,.24); background:rgba(242,247,246,.72); }
      .hd-ui-preview::after { left:26px; right:6px; bottom:22px; height:22px; border:1px solid rgba(72,90,100,.18); background:rgba(255,255,255,.7); }
      .hd-ui-preview[data-preview="aurora"] { background:radial-gradient(circle at 10% 5%,#6ed7c4,transparent 48%),linear-gradient(145deg,#26384a,#5968d9); }
      .hd-ui-preview[data-preview="aurora"]::before,.hd-ui-preview[data-preview="aurora"]::after { border-color:rgba(235,244,255,.26); background:rgba(24,34,54,.62); box-shadow:inset 0 1px rgba(255,255,255,.12); backdrop-filter:blur(6px); }
      .hd-ui-preview[data-preview="spatial"] { background:linear-gradient(145deg,#c8d6d4,#e4e9e7); }
      .hd-ui-preview[data-preview="spatial"]::before { inset:13px 7px 18px 28px; box-shadow:-17px 7px 18px rgba(53,73,77,.18); }
      .hd-ui-preview[data-preview="tactile"]::before,.hd-ui-preview[data-preview="tactile"]::after { box-shadow:inset 0 1px #fff,0 6px 11px rgba(52,72,74,.2); }
      .hd-ui-body { align-self:center; padding:14px; }
      .hd-ui-body strong,.hd-ui-body span { display:block; }
      .hd-ui-body strong { font-size:13px; }
      .hd-ui-body span { margin-top:5px; color:var(--dsw-alias-label-secondary); font-size:11px; line-height:1.55; }
      .hd-ui-options { display:grid; grid-template-columns:repeat(2,minmax(260px,1fr)); gap:10px; margin-top:16px; }
      .hd-ui-options label { display:flex; align-items:center; justify-content:space-between; gap:16px; border-top:1px solid var(--dsw-alias-border-l2); padding:13px 2px 4px; }
      .hd-ui-options span,.hd-ui-options strong,.hd-ui-options small { display:block; }
      .hd-ui-options strong { font-size:12px; }
      .hd-ui-options small { margin-top:2px; color:var(--dsw-alias-label-secondary); font-size:10px; font-weight:400; }
      .hd-ui-options input { width:17px; height:17px; accent-color:var(--dsw-alias-brand-primary); }
      .hd-ui-note { margin:16px 0 0; color:var(--dsw-alias-label-tertiary); font-size:11px; }
      html[data-hd-ui-mode]:not([data-hd-ui-mode="official"]) [data-composer-card="true"] { transition:border-color .2s ease,box-shadow .2s ease,background .2s ease; }
      [data-composer-seat] { overflow-anchor:none; }
      html[data-hd-ui-mode="aurora"] body { box-shadow:inset 0 0 180px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)!important; }
      html[data-hd-ui-mode="aurora"] [data-hd-surface="sidebar"],html[data-hd-ui-mode="aurora"] [data-hd-surface="details"],html[data-hd-ui-mode="aurora"] [data-composer-card="true"],html[data-hd-ui-mode="aurora"] [role="dialog"] { border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l2))!important; background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 78%,transparent)!important; box-shadow:inset 0 1px rgba(255,255,255,.14),0 22px 58px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,rgba(7,15,30,.18)); backdrop-filter:blur(20px) saturate(1.16); }
      html[data-hd-ui-mode="aurora"] [data-hd-surface="sidebar"]:has([role="dialog"][aria-modal="true"]) { backdrop-filter:none!important; }
      html[data-hd-ui-mode="aurora"] [data-hd-surface="conversation"] { background:radial-gradient(circle at 50% 100%,color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent),transparent 48%)!important; }
      html[data-hd-ui-mode="aurora"] [data-composer-card="true"] { border-radius:22px!important; outline:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent); }
      html[data-hd-ui-mode="spatial"] [data-hd-surface="sidebar"],html[data-hd-ui-mode="spatial"] [data-hd-surface="details"] { opacity:.68; filter:saturate(.72); transition:opacity .2s ease,filter .2s ease; }
      html[data-hd-ui-mode="spatial"] [data-hd-surface="sidebar"]:hover,html[data-hd-ui-mode="spatial"] [data-hd-surface="sidebar"]:focus-within,html[data-hd-ui-mode="spatial"] [data-hd-surface="details"]:hover { opacity:1; filter:none; }
      html[data-hd-ui-mode="spatial"] [data-hd-surface="conversation"] { box-shadow:0 0 70px color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent); }
      html[data-hd-ui-mode="spatial"] [data-composer-card="true"] { border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l2))!important; border-radius:20px!important; background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,var(--dsw-alias-brand-primary) 6%)!important; box-shadow:0 18px 54px rgba(7,15,30,.22),0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent); }
      html[data-hd-ui-mode="spatial"] [data-hd-surface="conversation"] p,html[data-hd-ui-mode="spatial"] [data-hd-surface="conversation"] li { line-height:1.72; }
      html[data-hd-ui-mode="tactile"] [data-hd-surface="sidebar"],html[data-hd-ui-mode="tactile"] [data-composer-card="true"],html[data-hd-ui-mode="tactile"] [role="dialog"] { border:2px solid color-mix(in srgb,var(--dsw-alias-label-primary) 22%,var(--dsw-alias-border-l2))!important; border-radius:14px!important; box-shadow:inset 0 2px rgba(255,255,255,.18),inset 0 -3px rgba(0,0,0,.11),0 15px 32px rgba(7,15,30,.18); }
      html[data-hd-ui-mode="tactile"] [data-composer-card="true"] button,html[data-hd-ui-mode="tactile"] [role="dialog"] button { box-shadow:inset 0 1px rgba(255,255,255,.12),0 4px 10px rgba(7,15,30,.10); transition:transform .14s ease,box-shadow .14s ease; }
      html[data-hd-ui-mode="tactile"] [data-composer-card="true"] button:active,html[data-hd-ui-mode="tactile"] [role="dialog"] button:active { transform:translateY(1px); box-shadow:inset 0 2px 4px rgba(0,0,0,.16); }
      html[data-hd-low-performance="true"] [data-hd-surface],html[data-hd-low-performance="true"] [data-composer-card="true"],html[data-hd-low-performance="true"] [role="dialog"] { backdrop-filter:none!important; box-shadow:none!important; }
      html[data-hd-reduced-motion="true"] .hd-ui-card,html[data-hd-reduced-motion="true"] [data-hd-surface],html[data-hd-reduced-motion="true"] [data-composer-card="true"] button,html[data-hd-reduced-motion="true"] [role="dialog"] button { transition:none!important; }
      @media (prefers-reduced-motion:reduce) { .hd-ui-card,[data-slot="sidebar"] > *,[data-composer-card="true"] button,[role="dialog"] button { transition:none!important; } }
      @container (max-width:660px) { .hd-custom-layout { grid-template-columns:1fr; } .hd-ui-grid,.hd-ui-options { grid-template-columns:1fr; } }
      @container (max-width:380px) { .hd-custom-heading { flex-direction:column; gap:6px; } .hd-custom-status { align-self:flex-start; } .hd-custom-fields,.hd-custom-range-grid { grid-template-columns:1fr; } .hd-ui-card { grid-template-columns:96px 1fr; } }
      @container (max-width:660px) { .hd-custom-layout { grid-template-columns:1fr; } }
      @container (max-width:380px) { .hd-custom-heading { flex-direction:column; gap:6px; } .hd-custom-status { align-self:flex-start; } .hd-custom-fields,.hd-custom-range-grid { grid-template-columns:1fr; } }
      html[data-hd-theme]:not([data-hd-theme="official"]) body { background-position:center !important; background-size:cover !important; background-attachment:fixed !important; }
      html[data-hd-theme]:not([data-hd-theme="official"]) #root { position:relative; z-index:1; background:transparent !important; }
      html[data-hd-theme]:not([data-hd-theme="official"]):not([data-harness-mobile="true"]),
      html[data-hd-theme]:not([data-hd-theme="official"]):not([data-harness-mobile="true"]) body,
      html[data-hd-theme]:not([data-hd-theme="official"]):not([data-harness-mobile="true"]) #root { width:100%; height:100%; min-height:0 !important; overflow:hidden !important; }
      html[data-hd-theme]:not([data-hd-theme="official"])[data-harness-mobile="true"] body,
      html[data-hd-theme]:not([data-hd-theme="official"])[data-harness-mobile="true"] #root { min-height:100vh; }
      html[data-hd-theme="custom"] body { background:var(--dsw-alias-bg-base) !important; }
      html[data-hd-theme="custom"] body::before { content:""; position:fixed; z-index:0; inset:calc(-32px - var(--hd-wallpaper-blur,0px)); background:var(--hd-wallpaper) center/cover no-repeat; filter:brightness(var(--hd-wallpaper-brightness,.82)) blur(calc(var(--hd-wallpaper-blur,2px) + 22px)) saturate(.88); pointer-events:none; }
      html[data-hd-theme="custom"] body::after { content:""; position:fixed; z-index:0; inset:0; background-image:linear-gradient(var(--hd-wallpaper-overlay),var(--hd-wallpaper-overlay)),var(--hd-wallpaper-contain,none); background-position:center,center; background-size:cover,contain; background-repeat:no-repeat,no-repeat; filter:brightness(var(--hd-wallpaper-brightness,.82)); pointer-events:none; }
      html[data-hd-wallpaper-kind="video"] body::before,html[data-hd-wallpaper-kind="video"] body::after { display:none!important; }
      .hd-wallpaper-video { position:fixed; z-index:0; inset:0; width:100%; height:100%; object-fit:cover; filter:brightness(var(--hd-wallpaper-brightness,.82)); pointer-events:none; }
      .hd-wallpaper-video-overlay { position:fixed; z-index:0; inset:0; background:var(--hd-wallpaper-overlay); pointer-events:none; }
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
      html[data-hd-theme="custom"] [data-composer-card="true"],
      html[data-hd-theme="custom"] [role="dialog"] {
        backdrop-filter:blur(var(--hd-theme-glass-blur,18px)) saturate(1.08);
      }
      html[data-hd-theme="custom"] [data-composer-card="true"],
      html[data-hd-theme="custom"] [role="dialog"] {
        border-color:var(--dsw-alias-border-l2) !important;
        box-shadow:0 12px 38px var(--hd-theme-panel-shadow,rgba(0,0,0,.18));
      }
      html[data-hd-theme="custom"] #root { text-shadow:var(--hd-theme-text-shadow,none); }
      html[data-hd-theme="custom"] input::placeholder,
      html[data-hd-theme="custom"] textarea::placeholder { color:var(--dsw-alias-label-secondary) !important; opacity:1; text-shadow:var(--hd-theme-text-shadow,none); }
      html[data-hd-theme="maid-atelier"] body::before, html[data-hd-theme="maid-atelier"] body::after { content:""; position:fixed; z-index:0; bottom:0; width:min(29vw,430px); height:78vh; background-repeat:no-repeat; background-position:center bottom; background-size:contain; pointer-events:none; filter:drop-shadow(0 12px 28px rgba(0,24,54,.2)); }
      html[data-hd-theme="maid-atelier"] body::before { left:clamp(210px,20vw,300px); background-image:var(--hd-maid-left); }
      html[data-hd-theme="maid-atelier"] body::after { right:2vw; background-image:var(--hd-maid-right); }
    `
    document.head.appendChild(style)

    const clearPageSelection = () => {
      const selection = window.getSelection?.()
      if (selection && !selection.isCollapsed) selection.removeAllRanges()
    }
    document.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input,textarea,[contenteditable="true"],[role="textbox"]')) return
      clearPageSelection()
    }, true)
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') clearPageSelection()
    }, true)

    const themeById = id => (window.__HARNESS_DESKTOP_THEMES__ || []).find(theme => theme.id === id)
    const customThemeFromState = state => {
      const custom = customThemeValues(state)
      const { accent, surface, text } = custom
      const surfaceOpacity = Math.max(.08, 1 - custom.glassTransparency / 100)
      const borderOpacity = custom.borderStrength / 100
      const readability = custom.readabilityStrength / 100
      return {
        id: 'custom', mode: custom.mode,
        preview: `radial-gradient(circle at 18% 14%, ${accent} 0%, transparent 34%), linear-gradient(145deg, ${surface}, ${accent})`,
        customBackgroundDataUrl: state?.customBackgroundDataUrl || '',
        customBackgroundVideoDataUrl: state?.customBackgroundVideoDataUrl || '',
        wallpaperBrightness: custom.wallpaperBrightness,
        wallpaperBlur: custom.wallpaperBlur,
        wallpaperOverlay: hexWithOpacity(surface, .06 + readability * (custom.mode === 'dark' ? .34 : .27)),
        vars: {
          '--dsw-alias-bg-base': hexWithOpacity(surface, surfaceOpacity),
          '--dsw-alias-bg-layer-1': hexWithOpacity(surface, Math.min(1, surfaceOpacity + .08)),
          '--dsw-alias-bg-layer-2': hexWithOpacity(surface, Math.min(1, surfaceOpacity + .16)),
          '--dsw-alias-bg-layer-3': hexWithOpacity(surface, Math.min(1, surfaceOpacity + .24)),
          '--dsw-alias-bg-module-platform': hexWithOpacity(surface, Math.min(1, surfaceOpacity + .05)),
          '--dsw-alias-label-primary': text,
          '--dsw-alias-label-secondary': hexWithAlpha(text, 'c7'),
          '--dsw-alias-label-tertiary': hexWithAlpha(text, '91'),
          '--dsw-alias-brand-primary': accent,
          '--dsw-alias-brand-text': accent,
          '--dsw-alias-border-l1': hexWithOpacity(text, borderOpacity * .16),
          '--dsw-alias-border-l2': hexWithOpacity(text, borderOpacity * .34),
          '--dsw-alias-border-l3': hexWithOpacity(text, borderOpacity * .52),
          '--dsw-alias-interactive-bg-hover': hexWithAlpha(accent, '24'),
          '--dsw-specific-sidebar-fill': hexWithOpacity(surface, Math.max(.08, surfaceOpacity * .48)),
          '--dsw-specific-input-major': hexWithOpacity(surface, Math.max(.18, surfaceOpacity * .7)),
          '--dsw-specific-menu': hexWithOpacity(surface, Math.min(1, surfaceOpacity + .24)),
          '--dsw-alias-markdown-code-block': hexWithOpacity(surface, Math.min(1, surfaceOpacity + .08)),
          '--hd-theme-glass-blur': `${Math.round(10 + custom.glassTransparency * .22)}px`,
          '--hd-theme-text-shadow': readableTextShadow(text, custom.readabilityStrength),
          '--hd-theme-panel-shadow': `rgba(0,0,0,${(.06 + readability * .18).toFixed(2)})`
        }
      }
    }

    const tagLayoutSurfaces = () => {
      const overlay = document.querySelector('[data-shell-overlay="true"]')
      const frame = overlay?.parentElement
      if (!frame) return
      const columns = [...frame.children].filter(element => element !== overlay && !element.hasAttribute('data-side'))
      const names = ['sidebar', 'conversation', 'details']
      columns.slice(0, 3).forEach((element, index) => { element.dataset.hdSurface = names[index] })
    }

    const syncWallpaperVideo = theme => {
      const root = document.documentElement
      const source = theme?.id === 'custom' ? theme.customBackgroundVideoDataUrl : ''
      let video = document.querySelector('.hd-wallpaper-video')
      let overlay = document.querySelector('.hd-wallpaper-video-overlay')
      if (!source) {
        if (video) {
          video.pause()
          video.removeAttribute('src')
          video.load()
          video.remove()
        }
        overlay?.remove(); root.removeAttribute('data-hd-wallpaper-kind')
        return
      }
      if (!video) {
        video = document.createElement('video')
        video.className = 'hd-wallpaper-video'
        video.muted = true; video.loop = true; video.autoplay = true; video.playsInline = true
        document.body.prepend(video)
      }
      const sourceChanged = video.src !== source
      if (sourceChanged) video.src = source
      if (!overlay) {
        overlay = document.createElement('div')
        overlay.className = 'hd-wallpaper-video-overlay'
        video.after(overlay)
      }
      root.dataset.hdWallpaperKind = 'video'
      const shouldPause = root.dataset.hdLowPerformance === 'true' || root.dataset.hdReducedMotion === 'true' || document.hidden
      if (shouldPause) {
        if (!video.paused) video.pause()
      } else if (video.paused || sourceChanged) video.play().catch(() => {})
    }

    document.addEventListener('visibilitychange', () => syncWallpaperVideo(customThemeFromState(window.__HARNESS_DESKTOP_THEME_STATE__ || {})))

    const applyTheme = requestedId => {
      const state = window.__HARNESS_DESKTOP_THEME_STATE__ || { themeId: 'official' }
      const id = requestedId || state.themeId || 'official'
      const old = document.querySelector('#harness-desktop-active-theme')
      if (id === 'official') {
        old?.remove()
        document.documentElement.removeAttribute('data-hd-theme')
        document.documentElement.removeAttribute('data-hd-skin-tone')
        syncWallpaperVideo(null)
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
          ? `url("${theme.customBackgroundDataUrl}")`
          : theme.preview
      const active = document.createElement('style')
      active.id = 'harness-desktop-active-theme'
      const isolatedSurfaces = {
        '--hd-theme-sidebar': vars['--dsw-specific-sidebar-fill'] || vars['--dsw-alias-bg-layer-1'] || 'transparent',
        '--hd-theme-input': vars['--dsw-specific-input-major'] || vars['--dsw-alias-bg-layer-1'] || 'transparent',
        '--hd-theme-dialog': vars['--dsw-alias-bg-layer-1'] || vars['--dsw-alias-bg-base'] || 'transparent'
      }
      const wallpaperVars = theme.id === 'custom' ? {
        '--hd-wallpaper': wallpaper,
        '--hd-wallpaper-contain': theme.customBackgroundDataUrl ? wallpaper : 'none',
        '--hd-wallpaper-overlay': theme.wallpaperOverlay,
        '--hd-wallpaper-brightness': String(theme.wallpaperBrightness / 100),
        '--hd-wallpaper-blur': `${theme.wallpaperBlur}px`
      } : {}
      const themeValues = { ...vars, ...isolatedSurfaces, ...wallpaperVars }
      const signature = JSON.stringify([theme.id, tone, wallpaper, theme.customBackgroundVideoDataUrl || '', themeValues])
      if (old && window.__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__ === signature && document.documentElement.dataset.hdTheme === theme.id) return
      old?.remove()
      active.textContent = `
        html[data-hd-theme="${theme.id}"],
        html[data-hd-theme="${theme.id}"] body,
        html[data-hd-theme="${theme.id}"] #root,
        html[data-hd-theme="${theme.id}"] [data-theme],
        html[data-hd-theme="${theme.id}"] [data-color-scheme],
        html[data-hd-theme="${theme.id}"] [data-slot="root"] { color-scheme:${tone}; ${Object.entries(themeValues).map(([name, value]) => `${name}:${value} !important;`).join('')} ${theme.id === 'maid-atelier' ? `--hd-maid-left:url("${theme.assets?.left}");--hd-maid-right:url("${theme.assets?.right}");` : ''} }
        html[data-hd-theme="${theme.id}"] body { background:${theme.id === 'custom' ? vars['--dsw-alias-bg-base'] : `${wallpaper} center/cover fixed`} !important; }
      `
      document.head.appendChild(active)
      document.documentElement.dataset.hdTheme = theme.id
      document.documentElement.dataset.hdSkinTone = tone
      syncWallpaperVideo(theme)
      window.__HARNESS_DESKTOP_ACTIVE_THEME_SIGNATURE__ = signature
    }

    const applyUiMode = (syncVideo = true) => {
      const state = window.__HARNESS_DESKTOP_THEME_STATE__ || {}
      const mobile = document.documentElement.dataset.harnessMobile === 'true'
      const mode = !mobile && uiModes.some(entry => entry.id === state.uiMode) ? state.uiMode : 'official'
      document.documentElement.dataset.hdUiMode = mode
      document.documentElement.dataset.hdReducedMotion = String(state.reducedMotion === true)
      document.documentElement.dataset.hdLowPerformance = String(state.lowPerformance === true)
      if (!mobile && syncVideo) syncWallpaperVideo(customThemeFromState(state))
    }

    const publishUiPreferences = panel => {
      const state = window.__HARNESS_DESKTOP_THEME_STATE__ || {}
      request('set-ui-preferences', {
        uiMode: state.uiMode || 'official',
        reducedMotion: state.reducedMotion === true ? '1' : '0',
        lowPerformance: state.lowPerformance === true ? '1' : '0'
      })
      applyUiMode()
      renderUiModes(panel)
    }

    const closeSettingsDialog = panel => {
      const dialog = panel.closest('[role="dialog"]')
      const close = [...(dialog?.querySelectorAll('button') || [])].find(button => {
        const label = `${button.getAttribute('aria-label') || ''} ${button.title || ''} ${button.textContent || ''}`
        return /关闭|close/i.test(label) || button.textContent?.trim() === '×'
      })
      close?.click()
    }

    const renderUiModes = panel => {
      const state = window.__HARNESS_DESKTOP_THEME_STATE__ || {}
      const selected = uiModes.find(entry => entry.id === state.uiMode) || uiModes[0]
      const grid = panel.querySelector('[data-hd-ui-grid]')
      if (!grid.dataset.ready) {
        grid.dataset.ready = 'true'
        grid.innerHTML = uiModes.map(mode => `
          <button type="button" class="hd-ui-card" data-hd-ui-mode-card="${mode.id}">
            <span class="hd-ui-preview" data-preview="${mode.id}" aria-hidden="true"></span>
            <span class="hd-ui-body"><strong>${mode.name}</strong><span>${mode.description}</span></span>
          </button>`).join('')
        grid.querySelectorAll('[data-hd-ui-mode-card]').forEach(button => {
          let lastAppliedAt = 0
          const choose = () => {
            const now = Date.now()
            if (now - lastAppliedAt < 600) return
            lastAppliedAt = now
            const uiMode = button.dataset.hdUiModeCard || 'official'
            window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), uiMode }
            publishUiPreferences(panel)
            closeSettingsDialog(panel)
          }
          button.addEventListener('click', event => {
            button.focus()
            if (document.documentElement.dataset.harnessMobile === 'true' || event.detail >= 2) choose()
          })
          button.addEventListener('dblclick', choose)
          button.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose() } })
        })
      }
      grid.querySelectorAll('[data-hd-ui-mode-card]').forEach(button => { button.dataset.selected = String(button.dataset.hdUiModeCard === selected.id) })
      panel.querySelector('[data-hd-ui-current]').textContent = selected.name
      panel.querySelector('[data-hd-reduced-motion]').checked = state.reducedMotion === true
      panel.querySelector('[data-hd-low-performance]').checked = state.lowPerformance === true
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
            closeSettingsDialog(panel)
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
          preview.style.background = custom.customBackgroundDataUrl
            ? `linear-gradient(${custom.wallpaperOverlay},${custom.wallpaperOverlay}),url("${custom.customBackgroundDataUrl}") center/contain no-repeat,url("${custom.customBackgroundDataUrl}") center/cover no-repeat`
            : custom.preview
        }
      })
      const custom = customThemeValues(state)
      for (const [name, value] of Object.entries(custom)) {
        const input = panel.querySelector(`[data-hd-custom="${name}"]`)
        if (input && document.activeElement !== input) input.value = String(value)
        const output = panel.querySelector(`[data-hd-custom-output="${name}"]`)
        if (output) output.textContent = `${value}${name === 'wallpaperBlur' ? 'px' : name === 'wallpaperBrightness' || name === 'glassTransparency' || name === 'borderStrength' || name === 'readabilityStrength' ? '%' : ''}`
      }
      const backgroundFile = state?.customTheme?.backgroundFile || ''
      const animated = /\.(?:gif|apng)$/i.test(backgroundFile)
      panel.querySelector('[data-hd-custom-background-state]').textContent = state.customBackgroundVideoDataUrl
        ? '本地视频壁纸已启用'
        : state.customBackgroundDataUrl
          ? animated ? '动态壁纸已启用' : '本地图片壁纸已启用'
          : '当前使用渐变背景'
      panel.querySelector('[data-hd-clear-background]').disabled = !state.customBackgroundDataUrl && !state.customBackgroundVideoDataUrl
      renderUiModes(panel)
    }

    const createPanel = () => {
      const panel = document.createElement('section')
      panel.className = 'hd-theme-panel'
      panel.dataset.hdThemePanel = ''
      panel.hidden = true
      panel.innerHTML = `
        <div class="hd-theme-heading"><div><h2>外观与界面模式</h2><p>皮肤控制颜色与壁纸，界面模式控制材质、层级和克制动效；不会创建第二套工作台。</p></div><button type="button" class="hd-theme-button" data-hd-restore>恢复官方外观</button></div>
        <div class="hd-appearance-tabs"><button type="button" class="hd-appearance-tab" data-hd-appearance-tab="themes" aria-selected="true">皮肤</button><button type="button" class="hd-appearance-tab" data-hd-appearance-tab="modes" aria-selected="false">界面模式</button></div>
        <div class="hd-appearance-pane" data-hd-appearance-pane="themes">
          <div class="hd-theme-grid" data-hd-theme-grid></div>
          <section class="hd-custom-editor">
            <div class="hd-custom-heading"><div><h3>自定义主题</h3><p>调整配色和壁纸质感；文件只保存在本机，支持常用图片、MP4/WebM 视频及 Wallpaper Engine 图片/视频项目；图片最大 50 MB，视频最大 2 GB。</p></div><span class="hd-custom-status" data-hd-custom-background-state></span></div>
            <div class="hd-custom-layout">
              <section class="hd-custom-group"><h4>基础配色</h4><div class="hd-custom-fields">
                <label>明暗模式<select data-hd-custom="mode"><option value="dark">深色</option><option value="light">浅色</option></select></label>
                <label>强调色<input type="color" data-hd-custom="accent" value="#6f8cff"></label>
                <label>表面色<input type="color" data-hd-custom="surface" value="#171b29"></label>
                <label>文字色<input type="color" data-hd-custom="text" value="#f4f7ff"></label>
              </div></section>
              <section class="hd-custom-group"><h4>壁纸质感</h4><div class="hd-custom-range-grid">
                <label><span>壁纸明暗 <output data-hd-custom-output="wallpaperBrightness">82%</output></span><input type="range" min="40" max="140" value="82" data-hd-custom="wallpaperBrightness"></label>
                <label><span>填充背景模糊 <output data-hd-custom-output="wallpaperBlur">2px</output></span><input type="range" min="0" max="24" value="2" data-hd-custom="wallpaperBlur"></label>
                <label><span>面板通透 <output data-hd-custom-output="glassTransparency">32%</output></span><input type="range" min="0" max="92" value="32" data-hd-custom="glassTransparency"></label>
                <label><span>边框清晰 <output data-hd-custom-output="borderStrength">48%</output></span><input type="range" min="0" max="100" value="48" data-hd-custom="borderStrength"></label>
                <label><span>文字保护 <output data-hd-custom-output="readabilityStrength">72%</output></span><input type="range" min="0" max="100" value="72" data-hd-custom="readabilityStrength"></label>
              </div></section>
            </div>
            <div class="hd-custom-actions"><button type="button" class="hd-theme-button" data-hd-choose-background>选择图片或视频</button><button type="button" class="hd-theme-button" data-hd-choose-wallpaper-engine>导入 Wallpaper Engine</button><button type="button" class="hd-theme-button" data-hd-clear-background>移除壁纸</button><button type="button" class="hd-theme-button hd-theme-primary" data-hd-save-custom>应用并保存</button></div>
          </section>
        </div>
        <section class="hd-appearance-pane" data-hd-appearance-pane="modes" hidden>
          <div class="hd-ui-heading"><div><h3>界面模式</h3><p>模式只改变材质、层级与动效；当前配色和壁纸保持不变。</p></div><strong class="hd-ui-current" data-hd-ui-current>官方经典</strong></div>
          <div class="hd-ui-grid" data-hd-ui-grid></div>
          <div class="hd-ui-options">
            <label><span><strong>减少动态效果</strong><small>关闭界面模式产生的位移与过渡。</small></span><input type="checkbox" data-hd-reduced-motion></label>
            <label><span><strong>低性能模式</strong><small>关闭模糊和复杂阴影，保留清晰层级。</small></span><input type="checkbox" data-hd-low-performance></label>
          </div>
          <p class="hd-ui-note">旧用户默认保持“官方经典”；切换不会重载或中断当前会话。</p>
        </section>`
      const showAppearancePane = name => {
        panel.querySelectorAll('[data-hd-appearance-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.hdAppearanceTab === name)))
        panel.querySelectorAll('[data-hd-appearance-pane]').forEach(pane => { pane.hidden = pane.dataset.hdAppearancePane !== name })
      }
      panel.querySelectorAll('[data-hd-appearance-tab]').forEach(button => button.addEventListener('click', () => showAppearancePane(button.dataset.hdAppearanceTab)))
      panel.querySelector('[data-hd-reduced-motion]').addEventListener('change', event => {
        window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), reducedMotion: event.currentTarget.checked }
        publishUiPreferences(panel)
      })
      panel.querySelector('[data-hd-low-performance]').addEventListener('change', event => {
        window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), lowPerformance: event.currentTarget.checked }
        publishUiPreferences(panel)
      })
      panel.querySelector('[data-hd-restore]').addEventListener('click', () => {
        const mobile = document.documentElement.dataset.harnessMobile === 'true'
        window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), themeId: 'official', ...(mobile ? {} : { uiMode: 'official', reducedMotion: false, lowPerformance: false }) }
        applyTheme('official'); applyUiMode(); renderCards(panel); request(mobile ? 'set-theme' : 'restore-appearance', mobile ? { id: 'official' } : {})
      })
      panel.querySelector('[data-hd-choose-background]').addEventListener('click', () => request('choose-theme-background'))
      panel.querySelector('[data-hd-choose-wallpaper-engine]').addEventListener('click', () => request('choose-wallpaper-engine'))
      panel.querySelector('[data-hd-clear-background]').addEventListener('click', () => request('clear-theme-background'))
      panel.querySelectorAll('.hd-custom-range-grid input').forEach(input => input.addEventListener('input', () => {
        const output = panel.querySelector(`[data-hd-custom-output="${input.dataset.hdCustom}"]`)
        if (output) output.textContent = `${input.value}${input.dataset.hdCustom === 'wallpaperBlur' ? 'px' : '%'}`
      }))
      panel.querySelector('[data-hd-save-custom]').addEventListener('click', () => {
        const names = ['mode', 'accent', 'surface', 'text', 'wallpaperBrightness', 'wallpaperBlur', 'glassTransparency', 'borderStrength', 'readabilityStrength']
        const values = Object.fromEntries(names.map(name => [name, panel.querySelector(`[data-hd-custom="${name}"]`).value]))
        window.__HARNESS_DESKTOP_THEME_STATE__ = { ...(window.__HARNESS_DESKTOP_THEME_STATE__ || {}), themeId: 'custom', customTheme: { ...(window.__HARNESS_DESKTOP_THEME_STATE__?.customTheme || {}), ...values } }
        applyTheme('custom'); renderCards(panel); request('save-custom-theme', values)
      })
      return panel
    }

    const ensureNavigation = dialog => {
      const nav = dialog.querySelector('nav')
      const content = dialog.querySelector(':scope > nav + div')
      if (!nav || !content) return
      const mobile = document.documentElement.dataset.harnessMobile === 'true'
      let skinButton = nav.querySelector('[data-hd-theme-nav]')
      if (!mobile && skinButton) return
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
      if (label) label.textContent = '外观与界面模式'
      const icon = skinButton.querySelector('svg')
      if (icon) icon.outerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.1a6.9 6.9 0 1 0 0 13.8h1.1a1.35 1.35 0 0 0 .55-2.58.72.72 0 0 1 .3-1.38h1.15A3.8 3.8 0 0 0 14.9 7.1 6 6 0 0 0 8 1.1Zm-3.05 7A1.05 1.05 0 1 1 4.95 6a1.05 1.05 0 0 1 0 2.1Zm1.7-3A1.05 1.05 0 1 1 6.65 3a1.05 1.05 0 0 1 0 2.1Zm3.1-.15a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Zm2 2.2a1.05 1.05 0 1 1 0-2.1 1.05 1.05 0 0 1 0 2.1Z" fill="currentColor"/></svg>'
      general.parentElement.appendChild(skinButton)
      if (!mobile) {
        // Desktop settings: the appearance subpage lives on the native shell,
        // so open the in-project page instead of injecting a browser page.
        skinButton.addEventListener('click', () => request('open-appearance'))
        return
      }
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

    const stabilizeWorkbenchViewport = () => {
      const root = document.documentElement
      if (root.dataset.harnessMobile === 'true' || root.dataset.hdTheme === 'official') return
      if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
    }

    const mount = (refreshTheme = true) => {
      tagLayoutSurfaces()
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (dialog) ensureNavigation(dialog)
      applySessionLogDock()
      applyUiMode(false)
      if (refreshTheme) applyTheme()
      stabilizeWorkbenchViewport()
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
