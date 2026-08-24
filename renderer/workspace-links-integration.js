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
      let text = String(value || '').trim()
      const pairs = [['`', '`'], ['"', '"'], ["'", "'"], ['<', '>'], ['（', '）'], ['(', ')']]
      for (const [left, right] of pairs) {
        if (text.startsWith(left) && text.endsWith(right) && text.length > left.length + right.length) {
          text = text.slice(left.length, -right.length).trim()
          break
        }
      }
      if (text.startsWith('@')) text = text.slice(1)
      if (!text || text.length > 4096 || /[\u0000\r\n]/u.test(text) || /\s/u.test(text)) return ''
      if (/^(?:https?|data|javascript|mailto):/i.test(text)) return ''
      if (/^file:\/\//i.test(text)) return text
      if (/^[a-z]:[\\/]/i.test(text)) return text
      if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return text
      if (/^\/(?!\/)/.test(text)) return text

      const withoutLocation = text.replace(/(?:#L\d+(?:C\d+)?|:\d+(?::\d+)?)$/i, '')
      if (/^(?:\.\.?[\\/])/.test(withoutLocation)) return text
      if (!/[\\/]/.test(withoutLocation) && !/^(?:Dockerfile|Makefile|CMakeLists\.txt|README|LICENSE)$/i.test(withoutLocation) && !/\.[a-z0-9][a-z0-9._-]{0,15}$/i.test(withoutLocation)) return ''
      if (/^(?:[a-z][a-z0-9+.-]*:|[?#])/i.test(withoutLocation)) return ''
      return text
    }

    const route = (host, params = {}) => {
      const query = new URLSearchParams(params)
      window.location.href = `harness-desktop://${host}?${query}`
    }

    const mark = (node, target) => {
      node.dataset.hdLocalTarget = target
      if (node.tagName !== 'A') {
        node.tabIndex = 0
        node.setAttribute('role', 'link')
      }
      node.setAttribute('aria-label', `在右侧工作区安全预览 ${target}`)
      node.title = `${target}\n单击在右侧预览；内容只会从当前工作区读取，HTML 和程序源码不会执行；右键可复制`
    }

    const decorate = root => {
      const anchors = root?.matches?.('a[href]') ? [root] : root?.querySelectorAll?.('a[href]') || []
      for (const anchor of anchors) {
        const target = localPath(anchor.getAttribute('href'))
        if (target) mark(anchor, target)
      }

      const codes = root?.matches?.('code') ? [root] : root?.querySelectorAll?.('code') || []
      for (const code of codes) {
        if (code.querySelector('a,button')) continue
        const target = localPath(code.textContent)
        if (target) mark(code, target)
        else delete code.dataset.hdLocalTarget
      }
    }

    document.addEventListener('click', event => {
      const local = event.target.closest?.('[data-hd-local-target]')
      if (local) {
        event.preventDefault()
        event.stopPropagation()
        route('preview-local', { path: local.dataset.hdLocalTarget })
        return
      }
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
        }
      }
    }, true)

    document.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return
      const local = event.target.closest?.('[data-hd-local-target]')
      if (!local) return
      event.preventDefault()
      route('preview-local', { path: local.dataset.hdLocalTarget })
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
