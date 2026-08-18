(function exposeModelRoutingIntegration(root) {
  function guestModelRoutingBootstrap() {
    if (window.__HARNESS_DESKTOP_MODEL_ROUTING_INSTALLED__) return
    window.__HARNESS_DESKTOP_MODEL_ROUTING_INSTALLED__ = true

    const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character])
    const request = (action, values = {}) => {
      const query = new URLSearchParams(values).toString()
      location.href = `harness-desktop://${action}/${query ? `?${query}` : ''}`
    }

    const style = document.createElement('style')
    style.dataset.harnessDesktop = 'model-routing'
    style.textContent = `
      #harness-desktop-model-routing { box-sizing:border-box; max-width:720px; margin:0 0 20px; border:1px solid var(--dsw-alias-border-l2); border-radius:14px; padding:16px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); }
      #harness-desktop-model-routing .hd-route-head { display:flex; align-items:center; justify-content:space-between; gap:16px; }
      #harness-desktop-model-routing h2 { margin:0; font-size:16px; line-height:24px; font-weight:500; }
      #harness-desktop-model-routing .hd-route-intro { margin:3px 0 0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      #harness-desktop-model-routing .hd-route-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:14px; }
      #harness-desktop-model-routing .hd-route-card { border:1px solid var(--dsw-alias-border-l2); border-radius:12px; padding:13px; background:var(--dsw-alias-bg-module-platform); }
      #harness-desktop-model-routing .hd-route-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; font-size:14px; font-weight:500; }
      #harness-desktop-model-routing .hd-route-field { display:grid; gap:5px; margin-top:9px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      #harness-desktop-model-routing select { box-sizing:border-box; width:100%; height:36px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:0 10px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; font-size:13px; }
      #harness-desktop-model-routing select:focus { border-color:var(--dsw-alias-brand-primary); outline:none; }
      #harness-desktop-model-routing .hd-route-mode { display:grid; grid-template-columns:1fr 1fr; gap:4px; margin:2px 0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:3px; background:var(--dsw-alias-bg-layer-1); }
      #harness-desktop-model-routing .hd-route-mode button { min-height:30px; border-radius:7px; padding:4px 8px; color:var(--dsw-alias-label-secondary); background:transparent; }
      #harness-desktop-model-routing .hd-route-mode button[aria-pressed="true"] { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-3); box-shadow:0 1px 4px rgba(0,0,0,.08); }
      #harness-desktop-model-routing .hd-route-summary { min-height:76px; display:grid; place-content:center; border:1px dashed var(--dsw-alias-border-l2); border-radius:9px; color:var(--dsw-alias-label-secondary); text-align:center; font-size:12px; }
      #harness-desktop-model-routing .hd-route-fields[hidden], #harness-desktop-model-routing .hd-route-summary[hidden] { display:none; }
      #harness-desktop-model-routing .hd-route-footer { display:flex; align-items:center; gap:12px; margin-top:14px; }
      #harness-desktop-model-routing .hd-route-status { flex:1; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      #harness-desktop-model-routing .hd-route-status[data-error="true"] { color:var(--dsw-alias-state-error-primary); }
      #harness-desktop-model-routing button { min-height:34px; border:0; border-radius:17px; padding:6px 15px; color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-button-primary-fill); font:inherit; font-size:13px; cursor:pointer; }
      #harness-desktop-model-routing button:disabled { cursor:default; opacity:.55; }
      #harness-desktop-model-routing .hd-meter-section { margin-top:16px; border-top:1px solid var(--dsw-alias-border-l2); padding-top:14px; }
      #harness-desktop-model-routing .hd-meter-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      #harness-desktop-model-routing .hd-meter-head h3 { margin:0; font-size:14px; font-weight:500; }
      #harness-desktop-model-routing .hd-meter-head button, #harness-desktop-model-routing .hd-meter-action { min-height:28px; border-radius:14px; padding:4px 11px; font-size:12px; }
      #harness-desktop-model-routing .hd-meter-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:10px; }
      #harness-desktop-model-routing .hd-meter-provider { min-width:0; border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:11px; background:var(--dsw-alias-bg-module-platform); }
      #harness-desktop-model-routing .hd-meter-provider-head { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:13px; }
      #harness-desktop-model-routing .hd-meter-state { color:var(--dsw-alias-label-tertiary); font-size:11px; }
      #harness-desktop-model-routing .hd-meter-row { margin-top:10px; }
      #harness-desktop-model-routing .hd-meter-row-head { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      #harness-desktop-model-routing .hd-meter-value { margin-top:4px; font-size:18px; line-height:24px; font-weight:500; }
      #harness-desktop-model-routing .hd-meter-detail, #harness-desktop-model-routing .hd-meter-message { margin-top:5px; color:var(--dsw-alias-label-tertiary); font-size:11px; line-height:17px; }
      #harness-desktop-model-routing .hd-meter-bar { overflow:hidden; height:6px; margin-top:7px; border-radius:3px; background:var(--dsw-alias-bg-layer-3); }
      #harness-desktop-model-routing .hd-meter-bar span { display:block; height:100%; border-radius:inherit; background:var(--dsw-alias-brand-primary); }
      #harness-desktop-model-routing .hd-meter-action { display:inline-block; margin-top:8px; color:var(--dsw-alias-label-primary-foreground); text-decoration:none; background:var(--dsw-alias-button-primary-fill); }
      @media (max-width:760px) { #harness-desktop-model-routing .hd-route-grid { grid-template-columns:1fr; } }
      @media (max-width:760px) { #harness-desktop-model-routing .hd-meter-grid { grid-template-columns:1fr; } }
    `
    document.head.appendChild(style)

    const modelsFor = (state, provider) => state.providers?.find(row => row.id === provider)?.models || []
    const fillSelect = (select, rows, selected, placeholder) => {
      const normalized = rows.map(row => typeof row === 'string' ? { value: row, label: row } : row).filter(row => row.value)
      if (selected && !normalized.some(row => row.value === selected)) normalized.unshift({ value: selected, label: selected })
      const html = `<option value="">${escapeHtml(placeholder)}</option>${normalized.map(row => `<option value="${escapeHtml(row.value)}">${escapeHtml(row.label || row.value)}</option>`).join('')}`
      if (select.innerHTML !== html) select.innerHTML = html
      select.value = selected || ''
    }
    const setSubagentMode = (panel, inherited) => {
      panel.dataset.subInherit = inherited ? 'true' : 'false'
      panel.querySelector('[data-hd-sub-mode="inherit"]').setAttribute('aria-pressed', String(inherited))
      panel.querySelector('[data-hd-sub-mode="independent"]').setAttribute('aria-pressed', String(!inherited))
      panel.querySelector('[data-hd-sub-fields]').hidden = inherited
      panel.querySelector('[data-hd-sub-summary]').hidden = !inherited
    }

    const percent = value => `${Math.max(0, Math.min(100, Number(value) || 0)).toFixed(0)}%`
    const resetText = seconds => {
      if (!seconds) return ''
      const date = new Date(Number(seconds) * 1000)
      return Number.isNaN(date.getTime()) ? '' : `重置：${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)}`
    }
    const amount = (value, unit) => {
      if (value === null || value === undefined || value === '') return '—'
      const number = Number(value)
      if (!Number.isFinite(number)) return `${escapeHtml(value)}${unit ? ` ${escapeHtml(unit)}` : ''}`
      if (/^[A-Z]{3}$/.test(unit || '')) {
        try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: unit }).format(number) } catch {}
      }
      return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(number)}${unit ? ` ${escapeHtml(unit)}` : ''}`
    }
    const renderMeter = meter => {
      if (meter.kind === 'balance') return `
        <div class="hd-meter-row"><div class="hd-meter-row-head"><span>${escapeHtml(meter.label || '余额')}</span><span>${escapeHtml(meter.currency || '')}</span></div>
        <div class="hd-meter-value">${amount(meter.total, meter.currency)}</div>
        <div class="hd-meter-detail">赠送 ${amount(meter.granted, meter.currency)} · 充值 ${amount(meter.toppedUp, meter.currency)}</div></div>`
      if (meter.kind === 'usage-window') return `
        <div class="hd-meter-row"><div class="hd-meter-row-head"><span>${escapeHtml(meter.label || '套餐用量')}</span><span>剩余 ${percent(meter.remainingPercent)}</span></div>
        <div class="hd-meter-bar"><span style="width:${percent(meter.usedPercent)}"></span></div>
        <div class="hd-meter-detail">已用 ${percent(meter.usedPercent)}${resetText(meter.resetsAt) ? ` · ${escapeHtml(resetText(meter.resetsAt))}` : ''}</div></div>`
      if (meter.kind === 'spending-budget') return `
        <div class="hd-meter-row"><div class="hd-meter-row-head"><span>${escapeHtml(meter.label || '消费限额')}</span><span>剩余 ${percent(meter.remainingPercent)}</span></div>
        <div class="hd-meter-value">${escapeHtml(meter.used)} / ${escapeHtml(meter.limit)}</div>
        <div class="hd-meter-detail">${escapeHtml(resetText(meter.resetsAt))}</div></div>`
      if (meter.kind === 'token-counter') return `
        <div class="hd-meter-row"><div class="hd-meter-row-head"><span>${escapeHtml(meter.label || '用量')}</span></div><div class="hd-meter-value">${amount(meter.value, meter.unit)}</div></div>`
      return ''
    }
    const meterStateLabel = snapshot => ({ ready: snapshot.stale ? '上次结果' : '实时', unsupported: '暂不支持', 'auth-required': '需授权', unavailable: '不可用', error: '刷新失败' })[snapshot.status] || snapshot.status
    const renderMeters = panel => {
      const state = window.__HARNESS_DESKTOP_MODEL_ROUTING_STATE__ || {}
      const metersState = state.meters || {}
      const container = panel.querySelector('[data-hd-meter-grid]')
      const snapshots = metersState.snapshots || []
      container.innerHTML = snapshots.length ? snapshots.map(snapshot => `
        <div class="hd-meter-provider">
          <div class="hd-meter-provider-head"><strong>${escapeHtml(snapshot.provider?.name || snapshot.provider?.id || '服务商')}</strong><span class="hd-meter-state">${escapeHtml(meterStateLabel(snapshot))}</span></div>
          ${(snapshot.meters || []).map(renderMeter).join('')}
          ${snapshot.message ? `<div class="hd-meter-message">${escapeHtml(snapshot.message)}</div>` : ''}
          ${snapshot.action ? `<a href="#" class="hd-meter-action" data-hd-meter-url="${escapeHtml(snapshot.action.url)}">${escapeHtml(snapshot.action.label)}</a>` : ''}
        </div>`).join('') : `<div class="hd-meter-message">${metersState.error ? `额度读取失败：${escapeHtml(metersState.error)}` : '没有已配置的服务商。'}</div>`
      container.querySelectorAll('[data-hd-meter-url]').forEach(link => link.addEventListener('click', event => {
        event.preventDefault()
        request('open-external', { url: link.dataset.hdMeterUrl })
      }))
      const refresh = panel.querySelector('[data-hd-meter-refresh]')
      refresh.disabled = Boolean(metersState.loading)
      refresh.textContent = metersState.loading ? '刷新中…' : '刷新额度'
    }

    const paint = panel => {
      const state = window.__HARNESS_DESKTOP_MODEL_ROUTING_STATE__ || {}
      const mainProvider = panel.querySelector('[data-hd-main-provider]')
      const mainModel = panel.querySelector('[data-hd-main-model]')
      const subProvider = panel.querySelector('[data-hd-sub-provider]')
      const subModel = panel.querySelector('[data-hd-sub-model]')
      const inherited = panel.dataset.dirty ? panel.dataset.subInherit !== 'false' : state.subagent?.inheritMain !== false
      const providerRows = (state.providers || []).map(row => ({ value: row.id, label: row.name && row.name !== row.id ? `${row.name} (${row.id})` : row.id }))
      if (!panel.dataset.dirty) {
        panel.dataset.subProvider = state.subagent?.provider || state.main?.provider || ''
        panel.dataset.subModel = state.subagent?.model || state.main?.model || ''
      }
      const mainProviderValue = panel.dataset.dirty ? mainProvider.value : state.main?.provider || ''
      const mainModelValue = panel.dataset.dirty ? mainModel.value : state.main?.model || ''
      const subProviderValue = panel.dataset.dirty ? subProvider.value : panel.dataset.subProvider
      const subModelValue = panel.dataset.dirty ? subModel.value : panel.dataset.subModel
      fillSelect(mainProvider, providerRows, mainProviderValue, '选择服务商')
      fillSelect(mainModel, modelsFor(state, mainProvider.value).map(value => ({ value, label: value })), mainModelValue, '选择模型')
      fillSelect(subProvider, providerRows, subProviderValue, '选择服务商')
      fillSelect(subModel, modelsFor(state, subProvider.value).map(value => ({ value, label: value })), subModelValue, '选择模型')
      setSubagentMode(panel, inherited)
      panel.querySelector('[data-hd-sub-summary]').textContent = mainProvider.value && mainModel.value ? `${mainProvider.value} / ${mainModel.value}` : '先选择主模型'
      const status = panel.querySelector('[data-hd-route-status]')
      status.dataset.error = state.error ? 'true' : 'false'
      status.textContent = state.error
        ? `保存失败：${state.error}`
        : state.saved
          ? '已保存；主模型和子代理路由从下一次新建会话起生效。'
          : `当前基于 ${state.basePreset || 'standard'} Agent 预设；配置保存在用户目录，不受官方更新覆盖。`
      const button = panel.querySelector('[data-hd-route-save]')
      button.disabled = Boolean(state.saving)
      button.textContent = state.saving ? '正在保存…' : '保存模型路由'
      renderMeters(panel)
    }

    const createPanel = () => {
      const panel = document.createElement('section')
      panel.id = 'harness-desktop-model-routing'
      panel.innerHTML = `
        <div class="hd-route-head"><div><h2>主模型与子代理</h2><p class="hd-route-intro">自动识别每个服务商提供的全部模型，也保留手动添加的自定义模型。</p></div></div>
        <div class="hd-route-grid">
          <div class="hd-route-card">
            <div class="hd-route-title">主模型</div>
            <label class="hd-route-field">服务商<select data-hd-main-provider></select></label>
            <label class="hd-route-field">模型<select data-hd-main-model></select></label>
          </div>
          <div class="hd-route-card">
            <div class="hd-route-title">子代理</div>
            <div class="hd-route-mode"><button type="button" data-hd-sub-mode="inherit">跟随主模型</button><button type="button" data-hd-sub-mode="independent">单独指定</button></div>
            <div class="hd-route-summary" data-hd-sub-summary></div>
            <div class="hd-route-fields" data-hd-sub-fields>
              <label class="hd-route-field">服务商<select data-hd-sub-provider></select></label>
              <label class="hd-route-field">模型<select data-hd-sub-model></select></label>
            </div>
          </div>
        </div>
        <section class="hd-meter-section">
          <div class="hd-meter-head"><div><h3>账户额度</h3><p class="hd-route-intro">不同服务商会按余额、套餐用量或消费限额显示。</p></div><button type="button" data-hd-meter-refresh>刷新额度</button></div>
          <div class="hd-meter-grid" data-hd-meter-grid></div>
        </section>
        <div class="hd-route-footer"><span class="hd-route-status" data-hd-route-status></span><button type="button" data-hd-route-save>保存模型路由</button></div>
      `
      panel.querySelectorAll('select').forEach(select => select.addEventListener('change', () => {
        panel.dataset.dirty = 'true'
        if (select.matches('[data-hd-main-provider]')) panel.querySelector('[data-hd-main-model]').value = ''
        if (select.matches('[data-hd-sub-provider]')) panel.querySelector('[data-hd-sub-model]').value = ''
        paint(panel)
      }))
      panel.querySelectorAll('[data-hd-sub-mode]').forEach(button => button.addEventListener('click', () => {
        panel.dataset.dirty = 'true'
        setSubagentMode(panel, button.dataset.hdSubMode === 'inherit')
        paint(panel)
      }))
      panel.querySelector('[data-hd-route-save]').addEventListener('click', () => {
        const values = {
          mainProvider: panel.querySelector('[data-hd-main-provider]').value.trim(),
          mainModel: panel.querySelector('[data-hd-main-model]').value.trim(),
          subInherit: panel.dataset.subInherit !== 'false' ? '1' : '0',
          subProvider: panel.querySelector('[data-hd-sub-provider]').value.trim(),
          subModel: panel.querySelector('[data-hd-sub-model]').value.trim()
        }
        request('save-model-routing', values)
      })
      panel.querySelector('[data-hd-meter-refresh]').addEventListener('click', () => request('refresh-provider-meters'))
      return panel
    }

    const mount = () => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!dialog) return
      const modelsNav = [...dialog.querySelectorAll('nav button')].find(button => /模型|Models/i.test(button.textContent || ''))
      if (!modelsNav || modelsNav.getAttribute('aria-current') !== 'true') {
        dialog.querySelectorAll('#harness-desktop-model-routing').forEach(panel => panel.remove())
        return
      }
      const content = dialog.querySelector(':scope > nav + div')
      if (!content) return
      let panel = content.querySelector('#harness-desktop-model-routing')
      if (!panel) {
        panel = createPanel()
        content.prepend(panel)
        request('refresh-model-routing')
      }
      paint(panel)
    }

    window.__HARNESS_DESKTOP_RENDER_MODEL_ROUTING__ = mount
    let scheduled = false
    new MutationObserver(() => {
      if (scheduled) return
      scheduled = true
      setTimeout(() => { scheduled = false; mount() }, 80)
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] })
    setInterval(() => {
      if (document.querySelector('#harness-desktop-model-routing')) request('refresh-provider-meters')
    }, 60 * 1000)
    mount()
  }

  async function install(webview) {
    await webview.executeJavaScript(`(${guestModelRoutingBootstrap.toString()})()`, true)
  }

  async function publish(webview, state) {
    if (!webview.getURL()) return
    const serialized = JSON.stringify(state).replaceAll('<', '\\u003c')
    await webview.executeJavaScript(`window.__HARNESS_DESKTOP_MODEL_ROUTING_STATE__=${serialized};window.__HARNESS_DESKTOP_RENDER_MODEL_ROUTING__?.();`, true)
  }

  root.harnessModelRoutingIntegration = { install, publish }
})(window)
