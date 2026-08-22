(() => {
  function guestWorkspaceLinksBootstrap() {
    if (window.__HARNESS_DESKTOP_WORKSPACE_LINKS__) return
    window.__HARNESS_DESKTOP_WORKSPACE_LINKS__ = true

    const style = document.createElement('style')
    style.dataset.harnessDesktopWorkspaceLinks = 'true'
    style.textContent = `
      code[data-hd-local-target] {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 3px;
      }
      code[data-hd-local-target]:hover {
        color: var(--dsw-alias-brand-primary, #315efb);
      }
    `
    document.head.appendChild(style)

    const localPath = value => {
      const text = String(value || '').trim().replace(/^`|`$/g, '')
      if (/^file:\/\//i.test(text)) return text
      if (/^[a-z]:[\\/]/i.test(text)) return text
      if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return text
      if (/^\/(?!\/)/.test(text)) return text
      return ''
    }

    const route = (host, params = {}) => {
      const query = new URLSearchParams(params)
      window.location.href = `harness-desktop://${host}?${query}`
    }

    const decorate = root => {
      const codes = root?.matches?.('code') ? [root] : root?.querySelectorAll?.('code') || []
      for (const code of codes) {
        if (code.querySelector('a,button')) continue
        const target = localPath(code.textContent)
        if (!target) {
          delete code.dataset.hdLocalTarget
          continue
        }
        code.dataset.hdLocalTarget = target
        code.tabIndex = 0
        code.setAttribute('role', 'link')
        code.setAttribute('aria-label', `在右侧工作区预览本机文档 ${target}`)
        code.title = `${target}\n单击在右侧预览；右键可复制、在文件夹中显示或用系统应用打开`
      }
    }

    document.addEventListener('click', event => {
      const anchor = event.target.closest?.('a[href]')
      if (anchor) {
        const href = anchor.href || anchor.getAttribute('href') || ''
        if (/^https?:/i.test(href)) {
          event.preventDefault()
          event.stopPropagation()
          route('open-external', { url: href })
          return
        }
        if (/^harness-desktop:\/\/open-local/i.test(href)) {
          event.preventDefault()
          event.stopPropagation()
          window.location.href = href
          return
        }
      }
      const code = event.target.closest?.('code[data-hd-local-target]')
      if (!code) return
      event.preventDefault()
      event.stopPropagation()
      route('preview-local', { path: code.dataset.hdLocalTarget })
    }, true)

    document.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return
      const code = event.target.closest?.('code[data-hd-local-target]')
      if (!code) return
      event.preventDefault()
      route('preview-local', { path: code.dataset.hdLocalTarget })
    }, true)

    decorate(document)
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) decorate(node)
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }

  window.HarnessDesktopWorkspaceLinks = {
    install(webview) {
      return webview.executeJavaScript(`(${guestWorkspaceLinksBootstrap.toString()})()`, true)
    }
  }
})()
