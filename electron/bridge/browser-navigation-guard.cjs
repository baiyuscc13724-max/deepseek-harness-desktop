// Browser navigation attribution for the shared right-sidebar WebContents.
//
// A page transition is not automatically a "user navigation": model clicks,
// form submissions, window.location assignments and their server redirects all
// originate inside the page. A raw input event is not enough to permanently
// reclassify a document: an old model timer could otherwise wait for the user to
// click anywhere and then inherit userNavigate. The isolated browser preload
// therefore grants one short-lived, exact link/form destination per trusted
// activation; only a committed destination or explicit browser UI command
// hands the document back to the user.

function guardError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function navigationTarget(details, legacyUrl = '') {
  if (details && typeof details.url === 'string') return details.url
  return String(legacyUrl || '')
}

const USER_ACTIVATION_MOUSE_TYPES = new Set(['mouseDown'])
const USER_ACTIVATION_KEY_TYPES = new Set(['keyDown', 'rawKeyDown'])
const USER_NAVIGATION_INTENT_TTL_MS = 2_000

function isUserHandoffInput(input, acceptedTypes) {
  return Boolean(input && acceptedTypes.has(String(input.type || '')))
}

function normalizeIntentTarget(url, base) {
  try {
    const raw = String(url || '')
    const normalizedBase = String(base || '')
    const target = normalizedBase ? new URL(raw, normalizedBase) : new URL(raw)
    return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password ? target.href : ''
  } catch {
    return ''
  }
}

class BrowserNavigationLane {
  constructor({ now = () => Date.now(), userIntentTtlMs = USER_NAVIGATION_INTENT_TTL_MS } = {}) {
    this.now = now
    this.userIntentTtlMs = Math.max(250, Math.min(5_000, Number(userIntentTtlMs) || USER_NAVIGATION_INTENT_TTL_MS))
    this.actor = 'user'
    this.reason = 'initial'
    this.modelCancelled = false
    this.modelInputDepth = 0
    this.lastTrustedInputAt = null
    this.pendingUserIntent = null
    this.userNavigationInFlight = false
    this.userNavigationTarget = ''
  }

  markModel(reason = 'model-action') {
    if (this.modelCancelled) {
      this.actor = 'cancelled-model'
      this.lastTrustedInputAt = null
      this.pendingUserIntent = null
      return this.snapshot()
    }
    this.actor = 'model'
    this.reason = String(reason || 'model-action').slice(0, 80)
    this.lastTrustedInputAt = null
    this.pendingUserIntent = null
    this.userNavigationInFlight = false
    this.userNavigationTarget = ''
    return this.snapshot()
  }

  markUser(reason = 'user-action') {
    this.actor = 'user'
    this.reason = String(reason || 'user-action').slice(0, 80)
    this.modelCancelled = false
    this.lastTrustedInputAt = null
    this.pendingUserIntent = null
    this.userNavigationInFlight = false
    this.userNavigationTarget = ''
    return this.snapshot()
  }

  cancelModel(reason = 'model-control-stop') {
    if (this.actor !== 'model' && this.actor !== 'cancelled-model') return false
    this.modelCancelled = true
    this.actor = 'cancelled-model'
    this.reason = String(reason || 'model-control-stop').slice(0, 80)
    this.modelInputDepth = 0
    this.lastTrustedInputAt = null
    this.pendingUserIntent = null
    if (!this.userNavigationInFlight) this.userNavigationTarget = ''
    return true
  }

  beginModelInput(reason = 'model-input') {
    this.markModel(reason)
    this.modelInputDepth += 1
    let finished = false
    return () => {
      if (finished) return
      finished = true
      this.modelInputDepth = Math.max(0, this.modelInputDepth - 1)
    }
  }

  noteTrustedInput() {
    if (this.modelInputDepth > 0) return false
    this.lastTrustedInputAt = this.now()
    this.reason = 'trusted-webcontents-input'
    return true
  }

  noteTrustedNavigationIntent(url, { base } = {}) {
    const now = this.now()
    if (this.modelInputDepth > 0 || this.lastTrustedInputAt == null || now - this.lastTrustedInputAt > this.userIntentTtlMs) return false
    const normalized = normalizeIntentTarget(url, base)
    if (!normalized) return false
    this.pendingUserIntent = { normalized, expiresAt: now + this.userIntentTtlMs }
    this.reason = 'trusted-navigation-intent'
    return true
  }

  noteBrowserUiNavigationIntent(url, { base } = {}) {
    const normalized = normalizeIntentTarget(url, base)
    if (!normalized) return false
    this.pendingUserIntent = { normalized, expiresAt: this.now() + this.userIntentTtlMs }
    this.reason = 'trusted-browser-ui-navigation'
    return true
  }

  consumeTrustedNavigationIntent(url, { base } = {}) {
    const pending = this.pendingUserIntent
    if (!pending) return false
    if (pending.expiresAt < this.now()) {
      this.pendingUserIntent = null
      return false
    }
    if (normalizeIntentTarget(url, base) !== pending.normalized) return false
    this.pendingUserIntent = null
    return true
  }

  consumeTrustedDownloadIntent(url, { base } = {}) {
    const normalized = normalizeIntentTarget(url, base)
    if (!normalized) return false
    if (this.userNavigationInFlight && normalized === this.userNavigationTarget) {
      this.failNavigation()
      return true
    }
    const accepted = this.consumeTrustedNavigationIntent(normalized)
    if (accepted) this.lastTrustedInputAt = null
    return accepted
  }

  completeNavigation() {
    this.pendingUserIntent = null
    this.lastTrustedInputAt = null
    if (this.userNavigationInFlight) this.markUser('trusted-navigation-committed')
  }

  failNavigation() {
    this.pendingUserIntent = null
    this.lastTrustedInputAt = null
    this.userNavigationInFlight = false
    this.userNavigationTarget = ''
  }

  validate(policy, url, { tabId, base, kind = 'navigate' } = {}) {
    if (!policy) throw guardError('policy-unavailable', '浏览器安全策略尚未准备好。')
    if (kind === 'redirect' && this.userNavigationInFlight) {
      const nav = policy.userNavigate(url, base ? { base } : {})
      this.userNavigationTarget = normalizeIntentTarget(nav.normalized || url, base)
      return nav
    }
    if (kind !== 'redirect' && this.consumeTrustedNavigationIntent(url, { base })) {
      const nav = policy.userNavigate(url, base ? { base } : {})
      this.userNavigationInFlight = true
      this.userNavigationTarget = normalizeIntentTarget(nav.normalized || url, base)
      this.reason = 'trusted-navigation-started'
      return nav
    }
    if (this.modelCancelled || this.actor === 'cancelled-model') {
      throw guardError('browser-action-cancelled', '已停止的模型操作不能继续触发页面导航。')
    }
    if (this.actor === 'model') return policy.modelNavigate(url, { tabId, base })
    return policy.userNavigate(url, base ? { base } : {})
  }

  snapshot() {
    return {
      actor: this.actor,
      reason: this.reason,
      modelCancelled: this.modelCancelled,
      modelInputDepth: this.modelInputDepth,
      hasPendingUserIntent: Boolean(this.pendingUserIntent),
      userNavigationInFlight: this.userNavigationInFlight,
      hasUserNavigationTarget: Boolean(this.userNavigationTarget)
    }
  }
}

function attachBrowserNavigationGuard({
  contents,
  tabId,
  lane,
  policy,
  isResetting = () => false,
  onDenied = () => {}
} = {}) {
  if (!contents || typeof contents.on !== 'function' || typeof contents.setWindowOpenHandler !== 'function') {
    throw guardError('contents-invalid', '浏览器导航门禁需要有效的 WebContents。')
  }
  if (!lane || typeof lane.validate !== 'function') throw guardError('lane-invalid', '浏览器导航来源通道无效。')

  const validateNavigation = (kind, event, legacyUrl) => {
    const url = navigationTarget(event, legacyUrl)
    if (event?.isMainFrame === false) return
    if (isResetting()) {
      if (url === 'about:blank') return
      event?.preventDefault?.()
      return
    }
    try {
      const currentPolicy = typeof policy === 'function' ? policy() : policy
      lane.validate(currentPolicy, url, { tabId, base: contents.getURL(), kind })
    } catch (error) {
      event?.preventDefault?.()
      onDenied(error, { actor: lane.snapshot().actor, kind, tabId, url })
    }
  }

  const handleWindowOpen = details => {
    const url = navigationTarget(details)
    if (isResetting()) return { action: 'deny' }
    try {
      const currentPolicy = typeof policy === 'function' ? policy() : policy
      const nav = lane.validate(currentPolicy, url, { tabId, base: contents.getURL(), kind: 'window-open' })
      contents.loadURL(nav.normalized).catch(error => onDenied(error, { actor: lane.snapshot().actor, kind: 'window-open-load', tabId, url }))
    } catch (error) {
      onDenied(error, { actor: lane.snapshot().actor, kind: 'window-open', tabId, url })
    }
    return { action: 'deny' }
  }

  // Input only proves a recent activation. The browser preload must separately
  // attest the exact trusted link/form target before the lane permits it.
  const noteTrustedMouseInput = (_event, input) => {
    if (isUserHandoffInput(input, USER_ACTIVATION_MOUSE_TYPES)) lane.noteTrustedInput()
  }
  const noteTrustedKeyboardInput = (_event, input) => {
    if (!input?.isAutoRepeat && isUserHandoffInput(input, USER_ACTIVATION_KEY_TYPES)) lane.noteTrustedInput()
  }
  const willNavigate = (event, legacyUrl) => validateNavigation('navigation', event, legacyUrl)
  const willRedirect = (event, legacyUrl) => validateNavigation('redirect', event, legacyUrl)
  const didNavigate = () => lane.completeNavigation()
  const didFailLoad = (event, _errorCode, _description, _url, legacyIsMainFrame) => {
    if (event?.isMainFrame === false || legacyIsMainFrame === false) return
    lane.failNavigation()
  }
  contents.on('will-navigate', willNavigate)
  contents.on('will-redirect', willRedirect)
  contents.on('did-navigate', didNavigate)
  contents.on('did-fail-load', didFailLoad)
  contents.on('before-mouse-event', noteTrustedMouseInput)
  contents.on('before-input-event', noteTrustedKeyboardInput)
  contents.setWindowOpenHandler(handleWindowOpen)

  return {
    validateNavigation,
    handleWindowOpen,
    dispose() {
      contents.removeListener?.('will-navigate', willNavigate)
      contents.removeListener?.('will-redirect', willRedirect)
      contents.removeListener?.('did-navigate', didNavigate)
      contents.removeListener?.('did-fail-load', didFailLoad)
      contents.removeListener?.('before-mouse-event', noteTrustedMouseInput)
      contents.removeListener?.('before-input-event', noteTrustedKeyboardInput)
    }
  }
}

module.exports = {
  BrowserNavigationLane,
  USER_NAVIGATION_INTENT_TTL_MS,
  attachBrowserNavigationGuard,
  navigationTarget,
  normalizeIntentTarget
}
