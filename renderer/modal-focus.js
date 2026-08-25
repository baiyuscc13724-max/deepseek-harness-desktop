/*!
 * modal-focus.js — 壳层 aria-modal 对话框的 Tab 边界约束与焦点恢复。
 *
 * 只在焦点将逃出模态框时接管 Tab；模态内部仍交给浏览器处理，从而保留
 * radio、select 与 tabindex 的原生键盘语义。同一 document 只安装一次。
 */
(() => {
  'use strict'

  const MODAL_SELECTOR = '[aria-modal="true"]'
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',')

  function isRenderedVisible(element) {
    if (!element || typeof element.getClientRects !== 'function') return false
    try { return element.getClientRects().length > 0 } catch { return false }
  }

  function collectFocusable(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return []
    const nodes = []
    root.querySelectorAll(FOCUSABLE_SELECTOR).forEach(node => {
      if (!node.disabled && isRenderedVisible(node)) nodes.push(node)
    })
    return nodes
  }

  function shouldTrapTab(currentIndex, length, shiftKey) {
    if (length <= 0 || currentIndex < 0) return true
    return shiftKey ? currentIndex === 0 : currentIndex === length - 1
  }

  function boundaryNextIndex(currentIndex, length, shiftKey) {
    if (length <= 0) return -1
    if (currentIndex < 0) return shiftKey ? length - 1 : 0
    return shiftKey ? length - 1 : 0
  }

  function isInsideAnyActiveModal(element, isActive) {
    if (!element || typeof element.closest !== 'function') return false
    const modal = element.closest(MODAL_SELECTOR)
    return Boolean(modal && isActive(modal))
  }

  function createInstaller({ window, document }) {
    const doc = document
    const rootNode = doc.documentElement || doc
    const Observer = window.MutationObserver || globalThis.MutationObserver
    const restoreTargets = new WeakMap()
    let observer = null
    let installed = false
    let steward = null
    let focusables = []
    let lastFocused = doc.activeElement?.nodeType === 1 ? doc.activeElement : null
    let keydownAttached = false
    let focusinAttached = false
    let temporaryTabIndexOwner = null

    function isModalActive(element) {
      if (!element || !element.isConnected) return false
      let node = element
      while (node) {
        if (node.classList?.contains('hidden')) return false
        if (node.getAttribute?.('aria-hidden') === 'true') return false
        if (node === rootNode) break
        node = node.parentElement
      }
      return isRenderedVisible(element)
    }

    function resolveTopModal() {
      if (typeof rootNode.querySelectorAll !== 'function') return null
      const candidates = []
      rootNode.querySelectorAll(MODAL_SELECTOR).forEach(element => {
        if (isModalActive(element)) candidates.push(element)
      })
      return candidates.at(-1) || null
    }

    function isSafeRestoreTarget(element) {
      return Boolean(element && element.nodeType === 1 && element.isConnected && !element.disabled)
    }

    function onFocusIn(event) {
      const target = event.target?.nodeType === 1 ? event.target : null
      if (!target) return
      const top = resolveTopModal()
      // Opening code may focus inside synchronously before MutationObserver runs.
      // Preserve the element focused immediately before that transition.
      if (top && top !== steward && top.contains?.(target) && !restoreTargets.has(top)) {
        if (isSafeRestoreTarget(lastFocused) && !top.contains(lastFocused)) restoreTargets.set(top, lastFocused)
      }
      lastFocused = target
    }

    function ensureContainerFocusTarget(modal) {
      if (!modal.hasAttribute?.('tabindex')) {
        modal.setAttribute?.('tabindex', '-1')
        temporaryTabIndexOwner = modal
      }
      modal.focus?.({ preventScroll: true })
    }

    function clearTemporaryTabIndex(modal) {
      if (temporaryTabIndexOwner !== modal) return
      modal.removeAttribute?.('tabindex')
      temporaryTabIndexOwner = null
    }

    function onKeyDown(event) {
      if (event.key !== 'Tab') return
      const top = steward
      if (!top || !isModalActive(top)) return
      focusables = collectFocusable(top)
      const currentIndex = focusables.indexOf(doc.activeElement)
      if (!shouldTrapTab(currentIndex, focusables.length, event.shiftKey === true)) return
      event.preventDefault()
      if (!focusables.length) return ensureContainerFocusTarget(top)
      const nextIndex = boundaryNextIndex(currentIndex, focusables.length, event.shiftKey === true)
      focusables[nextIndex]?.focus?.({ preventScroll: true })
    }

    function attachKeydown() {
      if (keydownAttached) return
      keydownAttached = true
      window.addEventListener('keydown', onKeyDown, true)
    }

    function detachKeydown() {
      if (!keydownAttached) return
      keydownAttached = false
      window.removeEventListener('keydown', onKeyDown, true)
    }

    function attachFocusTracking() {
      if (focusinAttached) return
      focusinAttached = true
      window.addEventListener('focusin', onFocusIn, true)
    }

    function detachFocusTracking() {
      if (!focusinAttached) return
      focusinAttached = false
      window.removeEventListener('focusin', onFocusIn, true)
    }

    function rememberRestoreTarget(modal) {
      if (restoreTargets.has(modal)) return
      const active = doc.activeElement?.nodeType === 1 ? doc.activeElement : null
      if (isSafeRestoreTarget(active) && !modal.contains?.(active)) {
        restoreTargets.set(modal, active)
        return
      }
      if (isSafeRestoreTarget(lastFocused) && !modal.contains?.(lastFocused)) restoreTargets.set(modal, lastFocused)
    }

    function restoreFocus(modal) {
      const target = restoreTargets.get(modal)
      restoreTargets.delete(modal)
      if (!isSafeRestoreTarget(target)) return
      try { target.focus({ preventScroll: true }) } catch { /* target stopped being focusable */ }
    }

    function focusInto(modal) {
      focusables = collectFocusable(modal)
      const active = doc.activeElement?.nodeType === 1 ? doc.activeElement : null
      if (active && modal.contains?.(active)) return
      if (focusables.length) focusables[0].focus?.({ preventScroll: true })
      else ensureContainerFocusTarget(modal)
    }

    function sync() {
      const top = resolveTopModal()
      const previous = steward
      if (previous && previous !== top) {
        clearTemporaryTabIndex(previous)
        detachKeydown()
        // A newly opened top modal must not restore the still-visible parent.
        if (!isModalActive(previous)) restoreFocus(previous)
        steward = null
        focusables = []
      }
      if (!top) {
        detachKeydown()
        return
      }
      if (top !== steward) {
        rememberRestoreTarget(top)
        steward = top
        attachKeydown()
        focusInto(top)
        return
      }
      focusables = collectFocusable(top)
      if (!focusables.length && doc.activeElement !== top) ensureContainerFocusTarget(top)
    }

    function install() {
      if (installed) return api
      installed = true
      // Focus tracking starts before observing/opening modals so synchronous
      // open-and-focus handlers cannot overwrite the restore target.
      attachFocusTracking()
      try {
        if (typeof Observer !== 'function') throw new Error('MutationObserver is unavailable')
        observer = new Observer(sync)
        observer.observe(rootNode, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'aria-hidden', 'hidden', 'disabled']
        })
        sync()
        return api
      } catch (error) {
        installed = false
        detachKeydown()
        detachFocusTracking()
        observer?.disconnect?.()
        observer = null
        throw error
      }
    }

    function dispose() {
      if (!installed) return
      installed = false
      clearTemporaryTabIndex(steward)
      detachKeydown()
      detachFocusTracking()
      observer?.disconnect?.()
      observer = null
      steward = null
      focusables = []
    }

    const api = {
      install,
      dispose,
      sync,
      isActive: isModalActive,
      resolveTopModal,
      collectFocusable,
      shouldTrapTab,
      boundaryNextIndex,
      currentSteward: () => steward
    }
    return api
  }

  const exportsApi = Object.freeze({
    FOCUSABLE_SELECTOR,
    MODAL_SELECTOR,
    isRenderedVisible,
    collectFocusable,
    shouldTrapTab,
    boundaryNextIndex,
    isInsideAnyActiveModal,
    createInstaller
  })

  if (typeof module !== 'undefined' && module.exports) module.exports = exportsApi

  if (typeof window !== 'undefined') {
    const installers = new WeakMap()
    window.HarnessModalFocus = {
      ...exportsApi,
      install(root) {
        const doc = root?.ownerDocument || document
        let installer = installers.get(doc)
        if (installer) return installer.install()
        installer = createInstaller({ window, document: doc })
        const installed = installer.install()
        installers.set(doc, installer)
        return installed
      }
    }
    // Progressive enhancement: focus management must never block shell startup.
    try { window.HarnessModalFocus.install() } catch (error) {
      window.console?.warn?.('modal-focus install failed', error)
    }
  }
})()
