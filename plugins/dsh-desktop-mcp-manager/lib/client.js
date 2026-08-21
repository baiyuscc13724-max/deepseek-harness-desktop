window.__ModuleLoader__.load({
  id: 'dsh-desktop-mcp-manager',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const { useCallback, useEffect, useState } = React
    const h = React.createElement
    const API = '/api/desktop-mcp/servers'
    const headers = { 'x-dsh-mcp-manager': '1' }
    const zh = {
      title: 'MCP 服务器', eyebrow: '工具连接', intro: '集中管理 Harness 使用的远程 HTTP 与本地 stdio 工具服务。',
      securityTitle: '凭据只保存引用，不读取秘密值', security: '秘密只填写凭据引用名，而不是令牌或密码。远程 HTTP 默认必须使用 HTTPS；只有本机回环地址可使用 HTTP。',
      addTitle: '添加服务器', addHint: '为工具配置稳定身份、传输方式与安全凭据引用。', identity: '服务身份', connection: '连接配置',
      id: '稳定 ID', idHint: '创建后用于管理此配置', namespace: '工具命名空间', namespaceHint: '仅字母、数字、下划线和短横线', label: '显示名称',
      transport: '传输方式', http: 'Streamable HTTP', stdio: '本地 stdio', endpoint: '服务地址', httpEndpoint: 'https://example.com/mcp', stdioEndpoint: '可执行文件绝对路径',
      refs: '凭据引用', httpRefs: 'Authorization=MCP_AUTH_TOKEN', stdioRefs: 'ENV_NAME=CREDENTIAL_REF', refsHint: '每行一项 NAME=CREDENTIAL_REF；这里只保存引用名。',
      enableAfterCreate: '创建后立即启用', enableHint: '启用 stdio 会在本机启动所列程序，因此仍需二次确认。', create: '添加 MCP 服务器', creating: '正在保存…',
      configured: '已配置服务器', count: '{count} 个', empty: '尚未配置 MCP 服务器', emptyHint: '添加后可在这里查看连接状态、重新连接或停用。',
      enable: '启用', disable: '停用', reconnect: '重新连接', delete: '删除', refresh: '刷新', noRefs: '未配置凭据引用',
      enabled: '已启用', disabled: '已停用', confirm: '确认执行此 MCP 配置变更？启用 stdio 会在本机启动所列程序。',
      saved: 'MCP 配置已更新。', failed: '操作失败：{error}', loading: '正在读取 MCP 配置…'
    }
    const en = {
      title: 'MCP servers', eyebrow: 'Tool connections', intro: 'Manage remote HTTP and local stdio tool services used by Harness.',
      securityTitle: 'Credentials stay reference-only', security: 'Enter credential reference names, never raw credential values. Remote HTTP requires HTTPS by default; only loopback hosts may use HTTP.',
      addTitle: 'Add server', addHint: 'Give the tool service a stable identity, transport, and safe credential references.', identity: 'Server identity', connection: 'Connection',
      id: 'Stable ID', idHint: 'Used to manage this configuration', namespace: 'Tool namespace', namespaceHint: 'Letters, numbers, underscore, and dash only', label: 'Display name',
      transport: 'Transport', http: 'Streamable HTTP', stdio: 'Local stdio', endpoint: 'Endpoint', httpEndpoint: 'https://example.com/mcp', stdioEndpoint: 'Absolute executable path',
      refs: 'Credential references', httpRefs: 'Authorization=MCP_AUTH_TOKEN', stdioRefs: 'ENV_NAME=CREDENTIAL_REF', refsHint: 'One NAME=CREDENTIAL_REF per line. Only reference names are stored.',
      enableAfterCreate: 'Enable after creation', enableHint: 'Enabling stdio starts the listed local program and still requires confirmation.', create: 'Add MCP server', creating: 'Saving…',
      configured: 'Configured servers', count: '{count}', empty: 'No MCP servers configured', emptyHint: 'Added servers appear here with connection state and lifecycle controls.',
      enable: 'Enable', disable: 'Disable', reconnect: 'Reconnect', delete: 'Delete', refresh: 'Refresh', noRefs: 'No credential references',
      enabled: 'Enabled', disabled: 'Disabled', confirm: 'Confirm this MCP configuration change? Enabling stdio starts the listed program on this computer.',
      saved: 'MCP configuration updated.', failed: 'Action failed: {error}', loading: 'Loading MCP configuration…'
    }
    const lang = ((navigator.language || 'en').toLowerCase().indexOf('zh') === 0) ? 'zh' : 'en'
    function t(key, values) {
      let text = (lang === 'zh' ? zh : en)[key] || key
      for (const [name, value] of Object.entries(values || {})) text = text.replace(`{${name}}`, String(value))
      return text
    }
    function injectStyles() {
      let style = document.querySelector("style[data-plugin='dsh-desktop-mcp-manager']")
      if (!style) {
        style = document.createElement('style')
        style.dataset.plugin = 'dsh-desktop-mcp-manager'
      }
      style.textContent = `
        .dmm-root{box-sizing:border-box;width:min(100%,920px);padding:8px 0 64px;color:var(--dsw-alias-label-primary)}
        .dmm-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:18px}
        .dmm-heading{display:flex;align-items:center;gap:14px;min-width:0}
        .dmm-heading-icon{width:42px;height:42px;display:grid;place-items:center;flex:none;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,var(--dsw-alias-border-l1));border-radius:13px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,var(--dsw-alias-bg-layer-1));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}
        .dmm-eyebrow{margin:0 0 2px;color:var(--dsw-alias-brand-primary);font-size:12px;font-weight:600;letter-spacing:.02em}
        .dmm-title{margin:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-.01em}
        .dmm-sub{max-width:660px;margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:21px}
        .dmm-icon{width:19px;height:19px;display:block;flex:none}
        .dmm-button{box-sizing:border-box;min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:0 13px;color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-specific-button-secondary) 88%,transparent);font:inherit;font-size:13px;cursor:pointer;transition:border-color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease}
        .dmm-button:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-specific-button-secondary-hover)}
        .dmm-button:active:not(:disabled){transform:translateY(1px)}
        .dmm-button:focus-visible,.dmm-input:focus-visible,.dmm-textarea:focus-visible,.dmm-select:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent)}
        .dmm-button:disabled{cursor:default;opacity:.55}
        .dmm-refresh{flex:none;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent);box-shadow:0 5px 16px color-mix(in srgb,#000 5%,transparent)}
        .dmm-notice{display:flex;align-items:flex-start;gap:12px;margin-bottom:18px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,var(--dsw-alias-border-l1));border-radius:12px;padding:12px 14px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1));font-size:13px;line-height:20px}
        .dmm-notice-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:9px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}
        .dmm-notice-icon .dmm-icon{width:17px;height:17px}
        .dmm-notice strong{display:block;margin-bottom:1px;color:var(--dsw-alias-label-primary);font-weight:600}
        .dmm-notice p{margin:0}
        .dmm-stack{display:grid;gap:18px}
        .dmm-panel{overflow:hidden;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 88%,transparent);border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,transparent);box-shadow:0 10px 34px color-mix(in srgb,#000 5%,transparent)}
        .dmm-panel-head{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:15px 17px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 75%,transparent)}
        .dmm-panel-title{display:flex;align-items:center;gap:10px;min-width:0}
        .dmm-panel-icon{width:30px;height:30px;display:grid;place-items:center;flex:none;border-radius:9px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent)}
        .dmm-panel-icon .dmm-icon{width:16px;height:16px}
        .dmm-panel h3{margin:0;font-size:14px;line-height:21px;font-weight:600}
        .dmm-panel-head p{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dmm-count{flex:none;border-radius:999px;padding:3px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px}
        .dmm-form{padding:18px}
        .dmm-group+.dmm-group{margin-top:18px;padding-top:18px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 72%,transparent)}
        .dmm-group-title{margin:0 0 11px;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px}
        .dmm-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
        .dmm-connection-grid{display:grid;grid-template-columns:minmax(180px,.72fr) minmax(280px,1.5fr);gap:13px}
        .dmm-field{display:grid;align-content:start;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .dmm-field small{min-height:18px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
        .dmm-input,.dmm-select,.dmm-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 11px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-input-major);font:inherit;font-size:14px;transition:border-color .16s ease,box-shadow .16s ease,background .16s ease}
        .dmm-input,.dmm-select{height:40px}
        .dmm-textarea{min-height:88px;resize:vertical;line-height:20px}
        .dmm-input:hover,.dmm-select:hover,.dmm-textarea:hover{border-color:var(--dsw-alias-border-l2)}
        .dmm-input::placeholder,.dmm-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}
        .dmm-refs{margin-top:13px}
        .dmm-form-foot{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding-top:16px;border-top:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 72%,transparent)}
        .dmm-toggle{display:flex;align-items:flex-start;gap:10px;cursor:pointer}
        .dmm-toggle input{width:16px;height:16px;margin:2px 0 0;accent-color:var(--dsw-alias-brand-primary)}
        .dmm-toggle strong{display:block;font-size:13px;line-height:19px;font-weight:550}
        .dmm-toggle small{display:block;margin-top:1px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
        .dmm-primary{min-height:40px;border-color:transparent;padding:0 17px;color:var(--dsw-specific-button-primary-label);background:var(--dsw-specific-button-primary);box-shadow:0 7px 18px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);font-weight:600}
        .dmm-primary:hover:not(:disabled){border-color:transparent;background:var(--dsw-specific-button-primary-hover,var(--dsw-specific-button-primary));box-shadow:0 9px 22px color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent)}
        .dmm-status{min-height:20px;margin:12px 2px 0;color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px}
        .dmm-error{color:var(--dsw-alias-state-error-primary)}
        .dmm-feedback{padding:14px 16px;color:var(--dsw-alias-label-secondary);font-size:13px}
        .dmm-empty{min-height:150px;box-sizing:border-box;display:grid;place-items:center;padding:22px;text-align:center}
        .dmm-empty-inner{max-width:420px;display:grid;justify-items:center}
        .dmm-empty-icon{width:44px;height:44px;display:grid;place-items:center;margin-bottom:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-border-l1));border-radius:14px;color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-2))}
        .dmm-empty h4{margin:0;font-size:14px;line-height:22px;font-weight:600}
        .dmm-empty p{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dmm-server-list{display:grid;gap:10px}
        .dmm-server{padding:15px 16px}
        .dmm-server-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
        .dmm-server-name{min-width:0}
        .dmm-server-name strong{display:block;font-size:14px;line-height:21px;font-weight:600}
        .dmm-server-name span{display:block;margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
        .dmm-badge{display:inline-flex;align-items:center;gap:6px;flex:none;border-radius:999px;padding:4px 9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font-size:12px}
        .dmm-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
        .dmm-badge-on{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,var(--dsw-alias-bg-layer-2))}
        .dmm-badge-on::before{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
        .dmm-server-meta{display:grid;gap:5px;margin:12px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
        .dmm-server-meta code{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:7px;padding:5px 8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);font:12px/18px var(--ds-font-family-code)}
        .dmm-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
        .dmm-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 24%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
        @media(max-width:760px){.dmm-grid{grid-template-columns:1fr}.dmm-connection-grid{grid-template-columns:1fr}.dmm-field small{min-height:0}.dmm-form-foot{align-items:flex-start;flex-direction:column}.dmm-primary{width:100%}.dmm-server-top{align-items:flex-start}}
        @media(max-width:520px){.dmm-root{padding-top:0}.dmm-heading-icon{display:none}.dmm-refresh span{display:none}.dmm-refresh{width:38px;padding:0}.dmm-form{padding:15px}.dmm-panel-head{align-items:flex-start}.dmm-server{padding:14px}}
        @media(prefers-reduced-motion:reduce){.dmm-button,.dmm-input,.dmm-select,.dmm-textarea{transition:none}.dmm-button:active:not(:disabled){transform:none}}
      `
      if (!style.isConnected) document.head.appendChild(style)
    }
    function Icon({ name }) {
      let paths
      if (name === 'refresh') paths = [h('path', { key: 'p', d: 'M19.2 8A7.8 7.8 0 1 0 20 13M19.2 8V3.8M19.2 8H15' })]
      else if (name === 'shield') paths = [h('path', { key: 'p', d: 'M12 3.5 19 6v5c0 4.2-2.5 7.3-7 9.5C7.5 18.3 5 15.2 5 11V6l7-2.5Z' }), h('path', { key: 'i', d: 'M9.5 12.2 11.2 14l3.5-4' })]
      else if (name === 'plus') paths = [h('path', { key: 'p', d: 'M12 5v14M5 12h14' })]
      else if (name === 'server') paths = [h('rect', { key: 'r1', x: 4, y: 4, width: 16, height: 6, rx: 2 }), h('rect', { key: 'r2', x: 4, y: 14, width: 16, height: 6, rx: 2 }), h('path', { key: 'p', d: 'M8 7h.01M8 17h.01M12 7h5M12 17h5' })]
      else paths = [h('path', { key: 'p', d: 'M8 4.5h8v4H8zM6 9.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2ZM9 14h6M12 9.5v4.5' })]
      return h('svg', { className: 'dmm-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, paths)
    }
    async function request(payload) {
      const options = payload === undefined
        ? { headers }
        : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, confirm: true }) }
      const response = await fetch(API, { cache: 'no-store', credentials: 'same-origin', ...options })
      const value = await response.json()
      if (!response.ok) throw new Error(value?.error?.message || 'MCP request failed')
      return value
    }
    function refsText(refs) { return Object.entries(refs || {}).map(([key, value]) => `${key}=${value.ref || value}`).join('\n') }
    function parseRefs(value) {
      const output = {}
      for (const line of String(value || '').split(/\r?\n/)) {
        if (!line.trim()) continue
        const at = line.indexOf('=')
        if (at < 1) throw new Error(lang === 'zh' ? '引用必须按 NAME=CREDENTIAL_REF 每行一项' : 'Use one NAME=CREDENTIAL_REF per line')
        output[line.slice(0, at).trim()] = line.slice(at + 1).trim()
      }
      return output
    }
    function emptyDraft() { return { id: '', serverName: '', label: '', kind: 'streamable-http', endpoint: '', refs: '', enabled: false } }
    function Field({ label, hint, children, className = '' }) {
      return h('label', { className: `dmm-field ${className}`.trim() }, h('span', null, label), children, hint ? h('small', null, hint) : null)
    }
    function McpManagerSection() {
      const [servers, setServers] = useState([])
      const [draft, setDraft] = useState(emptyDraft)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const refresh = useCallback(async (silent = false) => {
        if (!silent) setLoading(true)
        try { setServers((await request()).servers || []); setError('') } catch (reason) { setError(String(reason.message || reason)) } finally { if (!silent) setLoading(false) }
      }, [])
      useEffect(() => { refresh() }, [refresh])
      const act = async payload => {
        if (!window.confirm(t('confirm'))) return false
        setBusy(true)
        setError('')
        setNotice('')
        try {
          await request(payload)
          await refresh(true)
          setNotice(t('saved'))
          return true
        } catch (reason) {
          setError(String(reason.message || reason))
          return false
        } finally {
          setBusy(false)
        }
      }
      const create = async event => {
        event.preventDefault()
        let transport
        try {
          transport = draft.kind === 'stdio'
            ? { kind: 'stdio', command: draft.endpoint, args: [], cwd: '', envRefs: parseRefs(draft.refs) }
            : { kind: 'streamable-http', url: draft.endpoint, headerRefs: parseRefs(draft.refs) }
        } catch (reason) { setError(reason.message); return }
        const created = await act({ action: 'create', server: { id: draft.id, serverName: draft.serverName, label: draft.label, enabled: draft.enabled, transport } })
        if (created) setDraft(emptyDraft())
      }
      const input = (key, props = {}) => h('input', { ...props, className: `dmm-input ${props.className || ''}`.trim(), value: draft[key], onChange: event => setDraft({ ...draft, [key]: event.target.value }) })
      return h('section', { className: 'dmm-root', 'data-mcp-manager': true, 'aria-labelledby': 'dmm-title' },
        h('header', { className: 'dmm-head' },
          h('div', { className: 'dmm-heading' },
            h('span', { className: 'dmm-heading-icon' }, h(Icon, { name: 'mcp' })),
            h('div', null, h('div', { className: 'dmm-eyebrow' }, t('eyebrow')), h('h2', { id: 'dmm-title', className: 'dmm-title' }, t('title')), h('p', { className: 'dmm-sub' }, t('intro')))
          ),
          h('button', { className: 'dmm-button dmm-refresh', type: 'button', disabled: loading || busy, onClick: () => refresh() }, h(Icon, { name: 'refresh' }), h('span', null, t('refresh')))
        ),
        h('aside', { className: 'dmm-notice', role: 'note' },
          h('span', { className: 'dmm-notice-icon' }, h(Icon, { name: 'shield' })),
          h('div', null, h('strong', null, t('securityTitle')), h('p', null, t('security')))
        ),
        h('div', { className: 'dmm-stack' },
          h('section', { className: 'dmm-panel', 'aria-labelledby': 'dmm-add-title' },
            h('div', { className: 'dmm-panel-head' },
              h('div', { className: 'dmm-panel-title' }, h('span', { className: 'dmm-panel-icon' }, h(Icon, { name: 'plus' })), h('div', null, h('h3', { id: 'dmm-add-title' }, t('addTitle')), h('p', null, t('addHint'))))
            ),
            h('form', { className: 'dmm-form', onSubmit: create },
              h('div', { className: 'dmm-group' },
                h('h4', { className: 'dmm-group-title' }, t('identity')),
                h('div', { className: 'dmm-grid' },
                  h(Field, { label: t('id'), hint: t('idHint') }, input('id', { required: true, placeholder: 'docs-server', autoComplete: 'off' })),
                  h(Field, { label: t('namespace'), hint: t('namespaceHint') }, input('serverName', { required: true, placeholder: 'docs_tools', autoComplete: 'off' })),
                  h(Field, { label: t('label') }, input('label', { required: true, placeholder: lang === 'zh' ? '文档工具' : 'Documentation tools', autoComplete: 'off' }))
                )
              ),
              h('div', { className: 'dmm-group' },
                h('h4', { className: 'dmm-group-title' }, t('connection')),
                h('div', { className: 'dmm-connection-grid' },
                  h(Field, { label: t('transport') }, h('select', { className: 'dmm-select', value: draft.kind, onChange: event => setDraft({ ...draft, kind: event.target.value, endpoint: '', refs: '' }) }, h('option', { value: 'streamable-http' }, t('http')), h('option', { value: 'stdio' }, t('stdio')))),
                  h(Field, { label: t('endpoint') }, input('endpoint', { required: true, placeholder: draft.kind === 'stdio' ? t('stdioEndpoint') : t('httpEndpoint'), autoComplete: 'off' }))
                ),
                h(Field, { label: t('refs'), hint: t('refsHint'), className: 'dmm-refs' }, h('textarea', { className: 'dmm-textarea', value: draft.refs, onChange: event => setDraft({ ...draft, refs: event.target.value }), rows: 3, spellCheck: false, autoComplete: 'off', placeholder: draft.kind === 'stdio' ? t('stdioRefs') : t('httpRefs') }))
              ),
              h('div', { className: 'dmm-form-foot' },
                h('label', { className: 'dmm-toggle' }, h('input', { type: 'checkbox', role: 'switch', checked: draft.enabled, onChange: event => setDraft({ ...draft, enabled: event.target.checked }) }), h('span', null, h('strong', null, t('enableAfterCreate')), h('small', null, t('enableHint')))),
                h('button', { className: 'dmm-button dmm-primary', type: 'submit', disabled: busy }, h(Icon, { name: 'plus' }), busy ? t('creating') : t('create'))
              )
            )
          ),
          error || notice ? h('div', { className: `dmm-status${error ? ' dmm-error' : ''}`, role: error ? 'alert' : 'status', 'aria-live': 'polite' }, error ? t('failed', { error }) : notice) : null,
          h('section', { 'aria-labelledby': 'dmm-configured-title' },
            h('div', { className: 'dmm-panel-head', style: { paddingLeft: 2, paddingRight: 2, borderBottom: 0 } },
              h('div', { className: 'dmm-panel-title' }, h('span', { className: 'dmm-panel-icon' }, h(Icon, { name: 'server' })), h('div', null, h('h3', { id: 'dmm-configured-title' }, t('configured')))),
              !loading ? h('span', { className: 'dmm-count' }, t('count', { count: servers.length })) : null
            ),
            loading ? h('div', { className: 'dmm-panel dmm-feedback', role: 'status' }, t('loading')) : null,
            !loading && servers.length === 0 ? h('div', { className: 'dmm-panel dmm-empty' }, h('div', { className: 'dmm-empty-inner' }, h('span', { className: 'dmm-empty-icon' }, h(Icon, { name: 'server' })), h('h4', null, t('empty')), h('p', null, t('emptyHint')))) : null,
            !loading && servers.length ? h('div', { className: 'dmm-server-list' }, ...servers.map(server => {
              const refs = refsText(server.transport.envRefs || server.transport.headerRefs)
              const endpoint = server.transport.kind === 'stdio' ? server.transport.command : server.transport.url
              const phase = server.status?.phase || (server.enabled ? t('enabled') : t('disabled'))
              return h('article', { key: server.id, className: 'dmm-panel dmm-server' },
                h('div', { className: 'dmm-server-top' },
                  h('div', { className: 'dmm-server-name' }, h('strong', null, server.label), h('span', null, `${server.serverName} · ${server.transport.kind}`)),
                  h('span', { className: `dmm-badge${server.enabled ? ' dmm-badge-on' : ''}` }, phase)
                ),
                h('div', { className: 'dmm-server-meta' }, h('code', { title: endpoint }, endpoint), h('code', null, refs || t('noRefs'))),
                h('div', { className: 'dmm-actions' },
                  h('button', { className: 'dmm-button', type: 'button', disabled: busy, onClick: () => act({ action: 'set-enabled', id: server.id, revision: server.revision, enabled: !server.enabled }) }, server.enabled ? t('disable') : t('enable')),
                  h('button', { className: 'dmm-button', type: 'button', disabled: busy || !server.enabled, onClick: () => act({ action: 'reconnect', id: server.id, revision: server.revision }) }, t('reconnect')),
                  h('button', { className: 'dmm-button dmm-danger', type: 'button', disabled: busy, onClick: () => act({ action: 'delete', id: server.id, revision: server.revision }) }, t('delete'))
                )
              )
            })) : null
          )
        )
      )
    }
    function apply(ctx) {
      injectStyles()
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'desktop-mcp-manager', order: 35, label: () => 'MCP'
      }, McpManagerSection))
    }
    module.exports = { apply, inject: ['slots'] }
    return module.exports
  }
})
