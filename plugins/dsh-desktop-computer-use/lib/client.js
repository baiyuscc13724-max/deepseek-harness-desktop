window.__ModuleLoader__.load({
  id: 'dsh-desktop-computer-use',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { useEffect, useState } = React
    const h = React.createElement
    const EVENT = 'harness-desktop:computer-use-state'
    const EMPTY = {
      loading: true,
      notice: '',
      error: '',
      session: {
        available: true,
        ready: true,
        enabled: false,
        unlimited: false,
        activationRequired: true,
        activationMode: 'approval-card',
        authorization: { scope: 'none', unlimited: false, pending: null },
        generation: 0,
        currentTarget: null
      }
    }
    const zh = {
      title: 'Computer Use', description: '一键开启窗口读取、点击、输入和滚动。', installed: '已安装', bundled: '随桌面安装，无需额外下载',
      expand: '展开', collapse: '收起', loading: '正在读取 Computer Use 状态…', pluginStatus: '插件状态', session: 'Computer Use',
      sessionOn: '已开启', sessionOff: '未开启', sessionOnHint: '正在直接控制桌面；按 Esc 可随时停止。', sessionOffHint: '开启后即可使用，无需设置应用策略或逐次确认。',
      request: '开启 Computer Use', resume: '开启 Computer Use', stop: '停止 Computer Use', revoke: '撤销永久授权', generation: '会话 #{value}',
      scope: '授权范围', none: '首次开启时选择', current: '仅本次应用运行', forever: '永久授权（跨重启自动开启）', pending: '授权卡已推送，请选择本次授权、永久授权或拒绝。',
      securityTitle: '首次开启由 Harness Desktop 确认',
      security: '选择本次授权或永久授权后即可直接使用；永久授权会在以后启动时自动开启。浏览器中的密码、验证码、支付和银行信息仍保留硬限制。',
      currentTarget: '当前目标', noTarget: '无', refreshed: '状态已刷新。', requested: '已请求授权，请在宿主授权卡中选择。', resumed: 'Computer Use 已恢复。', stopped: 'Computer Use 已停止；已有授权范围保持不变。', revoked: '永久授权已撤销，控制会话已停止。', unavailable: '能力不可用：{value}'
    }
    const en = {
      title: 'Computer Use', description: 'Window access and unlimited desktop-control authorization.', installed: 'Installed', bundled: 'Bundled with Desktop; no separate download',
      expand: 'Expand', collapse: 'Collapse', loading: 'Loading Computer Use status…', pluginStatus: 'Plugin status', session: 'Current control session',
      sessionOn: 'Enabled', sessionOff: 'Disabled', sessionOnHint: 'The current grant lets the model click, type, and scroll without per-action confirmation.', sessionOffHint: 'The model cannot currently operate desktop windows.',
      request: 'Request authorization', resume: 'Resume control', stop: 'Stop and return control', revoke: 'Revoke permanent grant', generation: 'Session #{value}',
      scope: 'Authorization scope', none: 'Not authorized', current: 'This app session only', forever: 'Permanent grant (survives restart)', pending: 'The trusted Host authorization card is open. Choose session, permanent, or decline there.',
      securityTitle: 'Only the trusted Harness Desktop Host card can grant access',
      security: 'This plugin card can request authorization but cannot choose its scope. Once granted, unlimited mode bypasses application policy, per-action confirmation, and the previous UAC, system/elevated-window, sensitive-window, and sensitive-input blocks. Grant only when you fully trust the current model and task.',
      currentTarget: 'Current target', noTarget: 'None', refreshed: 'Status refreshed.', requested: 'Authorization requested; choose on the trusted Host card.', resumed: 'Computer Use resumed.', stopped: 'Computer Use stopped; the existing grant scope is retained.', revoked: 'The permanent grant was revoked and control stopped.', unavailable: 'Capability unavailable: {value}'
    }
    const copy = ((navigator.language || 'en').toLowerCase().startsWith('zh')) ? zh : en
    const t = (key, values) => {
      let text = copy[key] || key
      for (const [name, value] of Object.entries(values || {})) text = text.replace(`{${name}}`, String(value))
      return text
    }
    const request = (action, values = {}) => {
      const query = new URLSearchParams(values).toString()
      window.location.href = `harness-desktop://${action}/${query ? `?${query}` : ''}`
    }
    const currentSnapshot = () => {
      const value = window.__HARNESS_DESKTOP_COMPUTER_USE_STATE__
      return value && typeof value === 'object' ? value : EMPTY
    }
    function injectStyles() {
      if (document.querySelector('style[data-plugin-css="dsh-desktop-computer-use"]')) return
      const style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-desktop-computer-use'
      style.textContent = `
        .dcu-card{box-sizing:border-box;overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);list-style:none}
        .dcu-header{box-sizing:border-box;width:100%;min-height:74px;display:flex;align-items:center;justify-content:space-between;gap:14px;border:0;padding:16px 18px;color:inherit;background:transparent;text-align:left;cursor:pointer;font:inherit}.dcu-header:hover{background:var(--dsw-alias-interactive-bg-hover)}
        .dcu-head-copy{min-width:0;display:grid;gap:4px}.dcu-title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dcu-name{font-size:14px;font-weight:600}.dcu-description,.dcu-hint,.dcu-meta{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dcu-badge{display:inline-flex;align-items:center;border-radius:999px;padding:2px 8px;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 13%,transparent);font-size:11px;font-weight:600}.dcu-chevron{flex:none;color:var(--dsw-alias-label-tertiary);font-size:18px;transition:transform .16s ease}.dcu-card-open .dcu-chevron{transform:rotate(180deg)}
        .dcu-body{display:grid;gap:14px;border-top:1px solid var(--dsw-alias-border-l2);padding:16px 18px 18px}.dcu-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.dcu-copy{min-width:0;display:grid;gap:3px}.dcu-copy strong{font-size:13px}.dcu-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}.dcu-button{box-sizing:border-box;min-height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:12px;cursor:pointer}.dcu-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dcu-button:disabled{cursor:wait;opacity:.55}.dcu-primary{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,var(--dsw-alias-border-l2));color:var(--dsw-alias-state-business-primary)}
        .dcu-security{display:grid;gap:4px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,var(--dsw-alias-border-l2));border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 6%,transparent);font-size:12px;line-height:18px}.dcu-security strong{color:var(--dsw-alias-state-business-primary)}.dcu-message{margin:0;color:var(--dsw-alias-state-success-primary);font-size:12px}.dcu-error{margin:0;color:#d92d20;font-size:12px}.dcu-loading{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}
        @media (max-width:720px){.dcu-row{align-items:flex-start;flex-direction:column}.dcu-actions,.dcu-actions .dcu-button{width:100%}.dcu-actions .dcu-button{flex:1}}
      `
      document.head.appendChild(style)
    }
    function noticeText(code) {
      return code ? t({ refreshed: 'refreshed', requested: 'requested', resumed: 'resumed', stopped: 'stopped', revoked: 'revoked' }[code] || code) : ''
    }
    function ComputerUseCard() {
      const [open, setOpen] = useState(false)
      const [snapshot, setSnapshot] = useState(currentSnapshot)
      useEffect(() => {
        const listener = event => setSnapshot(event.detail && typeof event.detail === 'object' ? event.detail : currentSnapshot())
        window.addEventListener(EVENT, listener)
        return () => window.removeEventListener(EVENT, listener)
      }, [])
      useEffect(() => {
        if (!open) return undefined
        request('computer-use-refresh')
        const timer = window.setInterval(() => request('computer-use-status'), 1500)
        return () => window.clearInterval(timer)
      }, [open])
      const session = snapshot.session || EMPTY.session
      const authorization = session.authorization || EMPTY.session.authorization
      const scope = ['session', 'forever'].includes(authorization.scope) ? authorization.scope : 'none'
      const busy = snapshot.loading === true
      const pending = Boolean(authorization.pending)
      const primaryLabel = session.enabled ? 'stop' : (scope === 'none' ? 'request' : 'resume')
      const notice = noticeText(snapshot.notice)
      return h('li', { className: `dcu-card${open ? ' dcu-card-open' : ''}` },
        h('button', { type: 'button', className: 'dcu-header', 'aria-expanded': open, 'aria-label': `${t(open ? 'collapse' : 'expand')}: ${t('title')}`, onClick: () => setOpen(value => !value) },
          h('span', { className: 'dcu-head-copy' }, h('span', { className: 'dcu-title-row' }, h('span', { className: 'dcu-name' }, t('title')), h('span', { className: 'dcu-badge' }, t(session.enabled ? 'sessionOn' : 'installed'))), h('span', { className: 'dcu-description' }, t('description'))),
          h('span', { className: 'dcu-chevron', 'aria-hidden': 'true' }, '⌄')),
        open ? h('div', { className: 'dcu-body' },
          h('div', { className: 'dcu-row' },
            h('div', { className: 'dcu-copy' }, h('strong', null, `${t('session')} · ${t(session.enabled ? 'sessionOn' : 'sessionOff')}`), h('span', { className: 'dcu-hint' }, t(session.enabled ? 'sessionOnHint' : 'sessionOffHint')), session.generation ? h('span', { className: 'dcu-meta' }, t('generation', { value: session.generation })) : null),
            h('div', { className: 'dcu-actions' },
              h('button', { type: 'button', className: `dcu-button${session.enabled ? '' : ' dcu-primary'}`, disabled: busy || session.ready === false, onClick: () => request('computer-use-toggle', { enabled: session.enabled ? '0' : '1' }) }, t(primaryLabel)),
              scope === 'forever' ? h('button', { type: 'button', className: 'dcu-button', disabled: busy, onClick: () => request('computer-use-revoke-permanent') }, t('revoke')) : null)),
          h('div', { className: 'dcu-row' }, h('div', { className: 'dcu-copy' }, h('strong', null, t('scope')), h('span', { className: 'dcu-hint' }, t(scope === 'session' ? 'current' : scope))), pending ? h('span', { className: 'dcu-badge' }, t('pending')) : null),
          h('div', { className: 'dcu-security' }, h('strong', null, t('securityTitle')), h('span', null, t('security'))),
          busy ? h('p', { className: 'dcu-loading', role: 'status' }, t('loading')) : null,
          session.ready === false ? h('p', { className: 'dcu-error', role: 'status' }, t('unavailable', { value: 'screen-locked' })) : null,
          snapshot.error ? h('p', { className: 'dcu-error', role: 'alert' }, snapshot.error) : null,
          notice ? h('p', { className: 'dcu-message', role: 'status' }, notice) : null
        ) : null)
    }
    function apply(ctx) {
      injectStyles()
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({ name: 'settings.plugin.item', key: 'desktop-computer-use', priority: 100 }, ComputerUseCard))
    }
    module.exports = { apply, inject: ['slots'] }
    return module.exports
  }
})
