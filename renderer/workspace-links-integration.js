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
      // Explicit href/code/file-button tokens may contain filename spaces.
      // Multiline/control input and non-file prose still fail the path classifier.
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

    const keepsRuntimeNavigation = anchor => {
      const href = String(anchor.getAttribute('href') || '').trim()
      return !href || anchor.hasAttribute('download') || /^(?:\/(?!\/)|[?#])/u.test(href)
    }

    const anchorPath = anchor => {
      const href = String(anchor.getAttribute('href') || '').trim()
      // Root-relative, protocol-relative, query-only, fragment-only, and explicit
      // download links are web targets. Reinterpreting `/api/...` as a POSIX path
      // makes Windows resolve it as (for example) `D:\\api\\...`.
      // Explicit POSIX files remain available through inline code or file:// URLs.
      if (keepsRuntimeNavigation(anchor) || /^\/\//u.test(href)) return ''
      // Href syntax is encoded once; code/file-button text is a literal path.
      // Decode before transport encoding, never in the workspace API (a literal
      // filename such as report%20draft.md must keep its percent characters).
      if (/^file:\/\//iu.test(href)) return localPath(href, { allowWhitespace: true })
      let target
      try { target = decodeURIComponent(href.split(/[?#]/u, 1)[0]) } catch { return '' }
      if (/^(?:[\\/]|[a-z][a-z0-9+.-]*:)/iu.test(target) && !/^[a-z]:[\\/]/iu.test(target)) return ''
      return localPath(target, { allowWhitespace: true })
    }

    const route = (host, params = {}) => {
      const query = new URLSearchParams(params)
      window.location.href = `harness-desktop://${host}?${query}`
    }

    // Only product code holding the session-scoped composer binding registers a
    // source. DOM data attributes and the currently selected session are not proof
    // of a message's origin. WeakMaps keep this metadata out of authored markup.
    const sourceRoots = new WeakMap()
    const linkSources = new WeakMap()
    const sourceFor = node => {
      for (let current = node; current; current = current.parentElement) {
        const source = sourceRoots.get(current)
        if (source) return source
      }
      return null
    }
    const previewLink = local => {
      const source = linkSources.get(local)
      const current = sourceFor(local)
      const sessionId = source && source === current ? source.sessionId : ''
      route('preview-local', { path: local.dataset.hdLocalTarget, sessionId, sourceKind: 'workspace-link' })
    }

    const mark = (node, target) => {
      node.dataset.hdLocalTarget = target
      const source = sourceFor(node)
      if (source) linkSources.set(node, source)
      else linkSources.delete(node)
      if (!['A', 'BUTTON'].includes(node.tagName)) {
        node.tabIndex = 0
        node.setAttribute('role', 'link')
      }
      node.setAttribute('aria-label', `在右侧工作区安全预览 ${target}`)
      node.title = `${target}\n单击在右侧安全预览；仅从此消息来源会话的工作区读取，不会切换工作区或搜索其他项目；工作区 HTML 可隔离试玩，程序和安装包不会执行；右键可打开所在文件夹或复制路径`
    }

    const decorate = root => {
      const anchors = root?.matches?.('a[href]') ? [root] : root?.querySelectorAll?.('a[href]') || []
      for (const anchor of anchors) {
        const target = anchorPath(anchor)
        if (target) mark(anchor, target)
        else delete anchor.dataset.hdLocalTarget
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
        const target = localPath(code.textContent, { allowWhitespace: true })
        if (target) mark(code, target)
        else delete code.dataset.hdLocalTarget
      }
    }

    window.HarnessDesktopWorkspaceLinkSources = Object.freeze({
      bind(root, sessionId) {
        if (!root || root.nodeType !== Node.ELEMENT_NODE || typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId || /[\u0000\r\n]/u.test(sessionId)) return () => {}
        const source = Object.freeze({ sessionId })
        sourceRoots.set(root, source)
        decorate(root)
        return () => {
          if (sourceRoots.get(root) === source) sourceRoots.delete(root)
        }
      }
    })
    window.dispatchEvent(new Event('harness-workspace-link-sources-ready'))

    document.addEventListener('contextmenu', event => {
      const local = event.target.closest?.('[data-hd-local-target]')
      const source = local && linkSources.get(local)
      window.__HARNESS_DESKTOP_CONTEXT_LOCAL_TARGET__ = {
        value: local?.dataset?.hdLocalTarget || '',
        sessionId: source && source === sourceFor(local) ? source.sessionId : '',
        sourceKind: 'workspace-link',
        at: Date.now()
      }
    }, true)

    document.addEventListener('click', event => {
      // Only replace an ordinary primary-button activation. Modified clicks keep
      // the runtime's native new-window behavior, which the desktop host still
      // routes through its browser policy instead of executing inside the chat.
      if (event.button !== 0 || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
      const local = event.target.closest?.('[data-hd-local-target]')
      if (local) {
        event.preventDefault()
        event.stopPropagation()
        previewLink(local)
        return
      }
      const anchor = event.target.closest?.('a[href]')
      if (anchor) {
        const rawHref = String(anchor.getAttribute('href') || '').trim()
        // Keep runtime navigation and authenticated download endpoints inside the
        // current document; anchor.href would otherwise expand them to http(s)
        // and incorrectly send them to the system browser.
        if (keepsRuntimeNavigation(anchor)) return
        const href = anchor.href || rawHref
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
      previewLink(local)
    }, true)

    const decorateNode = node => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
      if (!element) return
      decorate(element)
      const inlineCode = element.closest?.('code')
      if (inlineCode && inlineCode !== element) decorate(inlineCode)
    }
    const redecorateContainingCode = node => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement
      const inlineCode = element?.matches?.('code') ? element : element?.closest?.('code')
      if (inlineCode) decorate(inlineCode)
    }

    decorate(document)
    const observer = new MutationObserver(records => {
      for (const record of records) {
        redecorateContainingCode(record.target)
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
