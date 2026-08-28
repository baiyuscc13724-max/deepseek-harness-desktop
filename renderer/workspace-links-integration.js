(() => {
  function guestWorkspaceLinksBootstrap() {
    if (window.__HARNESS_DESKTOP_WORKSPACE_LINKS__) return
    window.__HARNESS_DESKTOP_WORKSPACE_LINKS__ = true

    const style = document.createElement('style')
    style.dataset.harnessDesktopWorkspaceLinks = 'true'
    style.textContent = `
      code[data-hd-local-target],
      code > button[data-hd-local-target] {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 3px;
      }
      code[data-hd-local-target]:hover,
      code > button[data-hd-local-target]:hover {
        color: var(--dsw-alias-brand-primary, #315efb);
      }
    `
    document.head.appendChild(style)

    const localPath = (value, { allowWhitespace = false } = {}) => {
      let text = String(value || '').trim()
      const pairs = [['`', '`'], ['"', '"'], ["'", "'"], ['<', '>'], ['（', '）'], ['(', ')']]
      for (const [left, right] of pairs) {
        if (text.startsWith(left) && text.endsWith(right) && text.length > left.length + right.length) {
          text = text.slice(left.length, -right.length).trim()
          break
        }
      }
      if (text.startsWith('@')) text = text.slice(1)
      if (!text || text.length > 4096 || /[\u0000\r\n]/u.test(text)) return ''
      // 普通代码文本仍拒绝含空白的路径，避免把聊天文本误判为本地路径；
      // 原生产品改动允许原生文件按钮的 token 含空格，故仅对按钮场景放宽。
      if (!allowWhitespace && /\s/u.test(text)) return ''
      if (/^(?:https?|data|javascript|mailto):/i.test(text)) return ''
      if (/^file:\/\//i.test(text)) return text
      if (/^[a-z]:[\\/]/i.test(text)) return text
      if (/^\\\\[^\\]+\\[^\\]+/.test(text)) return text
      if (/^\/(?!\/)/.test(text)) return text
      if (!allowWhitespace && /\s/u.test(text)) return ''

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
      if (!['A', 'BUTTON'].includes(node.tagName)) {
        node.tabIndex = 0
        node.setAttribute('role', 'link')
      }
      node.setAttribute('aria-label', `在右侧工作区安全预览 ${target}`)
      node.title = `${target}\n单击在右侧安全预览；相对路径只从当前工作区读取，明确绝对路径可只读预览本机文件；HTML 和程序源码不会执行；右键可打开所在文件夹或复制路径`
    }

    const decorate = root => {
      const anchors = root?.matches?.('a[href]') ? [root] : root?.querySelectorAll?.('a[href]') || []
      for (const anchor of anchors) {
        const target = localPath(anchor.getAttribute('href'))
        if (target) mark(anchor, target)
      }

      const codes = root?.matches?.('code') ? [root] : root?.querySelectorAll?.('code') || []
      for (const code of codes) {
        const nativeFileButton = code.querySelector(':scope > button')
        if (nativeFileButton) {
          delete code.dataset.hdLocalTarget
          const target = localPath(code.textContent, { allowWhitespace: true })
          if (target) mark(nativeFileButton, target)
          else delete nativeFileButton.dataset.hdLocalTarget
          continue
        }
        if (code.querySelector('a')) continue
        const target = localPath(code.textContent)
        if (target) mark(code, target)
        else delete code.dataset.hdLocalTarget
      }
    }

    document.addEventListener('contextmenu', event => {
      const local = event.target.closest?.('[data-hd-local-target]')
      window.__HARNESS_DESKTOP_CONTEXT_LOCAL_TARGET__ = {
        value: local?.dataset?.hdLocalTarget || '',
        at: Date.now()
      }
    }, true)

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

    const decorateNode = node => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
      if (!element) return
      decorate(element)
      const inlineCode = element.closest?.('code')
      if (inlineCode && inlineCode !== element) decorate(inlineCode)
    }

    decorate(document)
    const observer = new MutationObserver(records => {
      for (const record of records) {
        decorateNode(record.target)
        for (const node of record.addedNodes) decorateNode(node)
      }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
  }

  window.HarnessDesktopWorkspaceLinks = {
    install(webview) {
      return webview.executeJavaScript(`(${guestWorkspaceLinksBootstrap.toString()})()`, true)
    }
  }
})()
