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
      #harness-desktop-model-routing .hd-route-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
      #harness-desktop-model-routing h2 { margin:0; font-size:16px; line-height:24px; font-weight:500; }
      #harness-desktop-model-routing .hd-route-intro { margin:3px 0 0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      #harness-desktop-model-routing .hd-route-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:14px; }
      #harness-desktop-model-routing .hd-route-card { border:1px solid var(--dsw-alias-border-l2); border-radius:12px; padding:13px; background:var(--dsw-alias-bg-module-platform); }
      #harness-desktop-model-routing .hd-route-title { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; font-size:14px; font-weight:500; }
      #harness-desktop-model-routing .hd-route-inherit { display:flex; align-items:center; gap:6px; color:var(--dsw-alias-label-secondary); font-size:11px; font-weight:400; }
      #harness-desktop-model-routing .hd-route-field { display:grid; gap:5px; margin-top:9px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      #harness-desktop-model-routing input[type="text"] { box-sizing:border-box; width:100%; height:34px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:0 10px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); font:inherit; font-size:13px; }
      #harness-desktop-model-routing input[type="text"]:focus { border-color:var(--dsw-alias-brand-primary); outline:none; }
      #harness-desktop-model-routing input:disabled { opacity:.55; }
      #harness-desktop-model-routing .hd-route-footer { display:flex; align-items:center; gap:12px; margin-top:14px; }
      #harness-desktop-model-routing .hd-route-status { flex:1; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
      #harness-desktop-model-routing .hd-route-status[data-error="true"] { color:var(--dsw-alias-state-error-primary); }
      #harness-desktop-model-routing button { min-height:34px; border:0; border-radius:17px; padding:6px 15px; color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-button-primary-fill); font:inherit; font-size:13px; cursor:pointer; }
      #harness-desktop-model-routing button:disabled { cursor:default; opacity:.55; }
      @media (max-width:760px) { #harness-desktop-model-routing .hd-route-grid { grid-template-columns:1fr; } }
    `
    document.head.appendChild(style)

    const modelsFor = (state, provider) => state.providers?.find(row => row.id === provider)?.models || []
    const fillList = (list, values) => {
      const html = [...new Set(values.filter(Boolean))].map(value => `<option value="${escapeHtml(value)}"></option>`).join('')
      if (list.innerHTML !== html) list.innerHTML = html
    }
    const updateDisabled = panel => {
      const inherited = panel.querySelector('[data-hd-sub-inherit]').checked
      panel.querySelector('[data-hd-sub-provider]').disabled = inherited
      panel.querySelector('[data-hd-sub-model]').disabled = inherited
    }

    const paint = panel => {
      const state = window.__HARNESS_DESKTOP_MODEL_ROUTING_STATE__ || {}
      const mainProvider = panel.querySelector('[data-hd-main-provider]')
      const mainModel = panel.querySelector('[data-hd-main-model]')
      const subProvider = panel.querySelector('[data-hd-sub-provider]')
      const subModel = panel.querySelector('[data-hd-sub-model]')
      const inherit = panel.querySelector('[data-hd-sub-inherit]')
      if (!panel.dataset.dirty) {
        mainProvider.value = state.main?.provider || ''
        mainModel.value = state.main?.model || ''
        subProvider.value = state.subagent?.provider || state.main?.provider || ''
        subModel.value = state.subagent?.model || state.main?.model || ''
        inherit.checked = state.subagent?.inheritMain !== false
      }
      fillList(panel.querySelector('[data-hd-provider-list]'), (state.providers || []).map(row => row.id))
      fillList(panel.querySelector('[data-hd-main-model-list]'), modelsFor(state, mainProvider.value))
      fillList(panel.querySelector('[data-hd-sub-model-list]'), modelsFor(state, subProvider.value))
      updateDisabled(panel)
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
    }

    const createPanel = () => {
      const panel = document.createElement('section')
      panel.id = 'harness-desktop-model-routing'
      panel.innerHTML = `
        <div class="hd-route-head"><div><h2>主模型与子代理</h2><p class="hd-route-intro">像 Hermes 一样分别指定主代理与内置子代理的服务商和模型。仅影响新会话。</p></div></div>
        <div class="hd-route-grid">
          <div class="hd-route-card">
            <div class="hd-route-title">主模型</div>
            <label class="hd-route-field">服务商<input type="text" data-hd-main-provider list="hd-route-providers" autocomplete="off" /></label>
            <label class="hd-route-field">模型<input type="text" data-hd-main-model list="hd-route-main-models" autocomplete="off" /></label>
          </div>
          <div class="hd-route-card">
            <div class="hd-route-title"><span>子代理</span><label class="hd-route-inherit"><input type="checkbox" data-hd-sub-inherit /> 跟随主模型</label></div>
            <label class="hd-route-field">服务商<input type="text" data-hd-sub-provider list="hd-route-providers" autocomplete="off" /></label>
            <label class="hd-route-field">模型<input type="text" data-hd-sub-model list="hd-route-sub-models" autocomplete="off" /></label>
          </div>
        </div>
        <datalist id="hd-route-providers" data-hd-provider-list></datalist>
        <datalist id="hd-route-main-models" data-hd-main-model-list></datalist>
        <datalist id="hd-route-sub-models" data-hd-sub-model-list></datalist>
        <div class="hd-route-footer"><span class="hd-route-status" data-hd-route-status></span><button type="button" data-hd-route-save>保存模型路由</button></div>
      `
      panel.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
        panel.dataset.dirty = 'true'
        updateDisabled(panel)
        paint(panel)
      }))
      panel.querySelector('[data-hd-route-save]').addEventListener('click', () => {
        const values = {
          mainProvider: panel.querySelector('[data-hd-main-provider]').value.trim(),
          mainModel: panel.querySelector('[data-hd-main-model]').value.trim(),
          subInherit: panel.querySelector('[data-hd-sub-inherit]').checked ? '1' : '0',
          subProvider: panel.querySelector('[data-hd-sub-provider]').value.trim(),
          subModel: panel.querySelector('[data-hd-sub-model]').value.trim()
        }
        request('save-model-routing', values)
      })
      return panel
    }

    const mount = () => {
      const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')
      if (!dialog) return
      const modelsNav = [...dialog.querySelectorAll('nav button')].find(button => /模型|Models/i.test(button.textContent || ''))
      if (!modelsNav || modelsNav.getAttribute('aria-current') !== 'true') return
      const content = dialog.querySelector(':scope > nav + div')
      if (!content) return
      let panel = content.querySelector('#harness-desktop-model-routing')
      if (!panel) {
        panel = createPanel()
        content.prepend(panel)
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
