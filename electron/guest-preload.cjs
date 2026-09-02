const { contextBridge, ipcRenderer } = require('electron')

// Sandboxed Electron preload scripts can only require Electron's supported
// built-ins. Keep this validator self-contained: a relative require aborts the
// entire preload before harnessDesktopGuest (including the workspace picker)
// can be exposed.
const MAX_BROWSER_INTENT_URL_LENGTH = 2048
function hasExactBrowserIntentKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}
function safeBrowserIntentUrl(value) {
  if (typeof value !== 'string' || !value || value.length > MAX_BROWSER_INTENT_URL_LENGTH || value.trim() !== value) return ''
  let parsed
  try { parsed = new URL(value) } catch { return '' }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
  if (parsed.username || parsed.password) return ''
  const normalized = parsed.toString()
  return normalized.length <= MAX_BROWSER_INTENT_URL_LENGTH ? normalized : ''
}
function normalizeBrowserOpenIntent(value) {
  const action = typeof value?.action === 'string' ? value.action : ''
  if (action === 'bridge-ready') {
    if (!hasExactBrowserIntentKeys(value, ['action', 'version']) || value.version !== 1) return null
    return Object.freeze({ action, version: 1 })
  }
  if (action === 'show-browser') {
    if (!hasExactBrowserIntentKeys(value, ['action'])) return null
    return Object.freeze({ action })
  }
  if (action === 'open-browser-url') {
    if (!hasExactBrowserIntentKeys(value, ['action', 'url'])) return null
    const url = safeBrowserIntentUrl(value.url)
    return url ? Object.freeze({ action, url }) : null
  }
  return null
}

let activeDrag = null
let pendingPoint = null
let pendingFrame = 0

function safeSessionContext(value) {
  const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
  if (!sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId) return null
  return Object.freeze({ sessionId })
}

const AGENT_TEAMS_AUTOPILOT_SETTING_KEYS = Object.freeze(['enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds'])
const AGENT_TEAMS_AUTOPILOT_SCOPE_KEYS = Object.freeze(['rootSessionId', 'projectKey', 'goalId', 'teamId', 'pauseEpoch', 'teamScopeHash'])
function exactOwnKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function safeAgentTeamsAutopilotScope(value) {
  if (!exactOwnKeys(value, AGENT_TEAMS_AUTOPILOT_SCOPE_KEYS)) return null
  if (typeof value.rootSessionId !== 'string' || !value.rootSessionId || value.rootSessionId.length > 256 || value.rootSessionId.trim() !== value.rootSessionId) return null
  if (typeof value.goalId !== 'string' || !value.goalId || value.goalId.length > 256 || value.goalId.trim() !== value.goalId) return null
  if (typeof value.teamId !== 'string' || !value.teamId || value.teamId.length > 256 || value.teamId.trim() !== value.teamId) return null
  if (typeof value.projectKey !== 'string' || !/^[a-f0-9]{64}$/u.test(value.projectKey) || typeof value.teamScopeHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.teamScopeHash)) return null
  if (!Number.isSafeInteger(value.pauseEpoch) || value.pauseEpoch < 0) return null
  return Object.freeze(Object.fromEntries(AGENT_TEAMS_AUTOPILOT_SCOPE_KEYS.map(key => [key, value[key]])))
}
function safeAgentTeamsAutopilotSettings(value) {
  const hasScope = Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'hostAuthorization'))
  const keys = ['action', 'sessionId', ...AGENT_TEAMS_AUTOPILOT_SETTING_KEYS, ...(hasScope ? ['hostAuthorization'] : [])]
  if (!exactOwnKeys(value, keys) || value.action !== 'settings') return null
  if (typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 256 || value.sessionId.trim() !== value.sessionId) return null
  if (typeof value.enabled !== 'boolean' || typeof value.autopilotEnabled !== 'boolean') return null
  if (!Number.isSafeInteger(value.maxMembers) || value.maxMembers < 1 || value.maxMembers > 8) return null
  if (!Number.isSafeInteger(value.maxActiveTurns) || value.maxActiveTurns < 1 || value.maxActiveTurns > 8) return null
  if (!Number.isSafeInteger(value.autopilotMaxAdditionalRounds) || value.autopilotMaxAdditionalRounds < 1 || value.autopilotMaxAdditionalRounds > 200) return null
  const scope = hasScope ? safeAgentTeamsAutopilotScope(value.hostAuthorization) : null
  if (hasScope && scope === null) return null
  if (scope !== null && scope.rootSessionId !== value.sessionId) return null
  return Object.freeze({
    action: 'settings',
    sessionId: value.sessionId,
    enabled: value.enabled,
    maxMembers: value.maxMembers,
    maxActiveTurns: value.maxActiveTurns,
    autopilotEnabled: value.autopilotEnabled,
    autopilotMaxAdditionalRounds: value.autopilotMaxAdditionalRounds,
    ...(scope === null ? {} : { hostAuthorization: scope })
  })
}
async function authorizeAgentTeamsAutopilotSettings(value) {
  // navigator.userActivation is maintained by Chromium in the isolated preload
  // world; page script cannot synthesize it. Validate before the first await so
  // the transient activation belongs to the exact click that requested saving.
  if (globalThis.navigator?.userActivation?.isActive !== true) throw new Error('请直接点击“保存设置”以授权本次自动接力设置。')
  const request = safeAgentTeamsAutopilotSettings(value)
  if (!request) throw new Error('代理团队自动接力设置无效。')
  return ipcRenderer.invoke('agentTeams:authorizeAutopilotSettings', request)
}

function safeSessionMenuIds(value) {
  const ids = []
  const seen = new Set()
  for (const candidate of Array.isArray(value) ? value : []) {
    if (typeof candidate !== 'string' || !candidate || candidate.length > 256 || candidate.trim() !== candidate || seen.has(candidate)) continue
    seen.add(candidate)
    ids.push(candidate)
    if (ids.length >= 1000) break
  }
  return Object.freeze(ids)
}

function safeSessionMenuState(value) {
  return Object.freeze({
    pinned: safeSessionMenuIds(value?.pinned),
    unread: safeSessionMenuIds(value?.unread)
  })
}

function safeSessionMenuFlag(value) {
  const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
  const flag = value?.flag === 'pinned' || value?.flag === 'unread' ? value.flag : ''
  if (!sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId || !flag || typeof value?.enabled !== 'boolean') return null
  return Object.freeze({ sessionId, flag, enabled: value.enabled })
}

async function syncSessionMenuState(value) {
  const state = safeSessionMenuState(value)
  return safeSessionMenuState(await ipcRenderer.invoke('sessionMenu:sync', state))
}

async function setSessionMenuFlag(value) {
  const request = safeSessionMenuFlag(value)
  if (!request) return null
  return safeSessionMenuState(await ipcRenderer.invoke('sessionMenu:setFlag', request))
}

const DESKTOP_DEVICE_ACTIONS = new Set(['status', 'targets', 'selectTarget', 'observe', 'inspect', 'click', 'type', 'scroll', 'screenshot', 'requestAuthorization', 'stop'])
function safeDesktopDeviceAction(value) {
  const action = typeof value?.action === 'string' && DESKTOP_DEVICE_ACTIONS.has(value.action) ? value.action : ''
  if (!action) return null
  const source = value?.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) ? value.payload : value
  const payload = {}
  const targetId = typeof (source.target_id ?? source.targetId) === 'string' ? String(source.target_id ?? source.targetId).slice(0, 160) : ''
  const ref = typeof source.ref === 'string' ? source.ref.slice(0, 240) : ''
  if (targetId) payload.target_id = targetId
  if (ref) payload.ref = ref
  if (typeof source.text === 'string') payload.text = source.text.slice(0, 500)
  if (Number.isFinite(Number(source.x))) payload.x = Math.round(Number(source.x))
  if (Number.isFinite(Number(source.y))) payload.y = Math.round(Number(source.y))
  if (Number.isFinite(Number(source.delta_y ?? source.deltaY))) payload.delta_y = Math.max(-800, Math.min(800, Math.round(Number(source.delta_y ?? source.deltaY))))
  if (source.button === 'right' || source.button === 'middle' || source.button === 'left') payload.button = source.button
  if (source.force === true) payload.force = true
  if (Number.isSafeInteger(Number(source.maxNodes))) payload.maxNodes = Math.max(1, Math.min(500, Number(source.maxNodes)))
  return Object.freeze({ action, payload: Object.freeze(payload) })
}

async function desktopDeviceAction(value) {
  const request = safeDesktopDeviceAction(value)
  if (!request) throw new Error('桌面设备操作无效。')
  return ipcRenderer.invoke('desktopDevice:action', request)
}

function subscribeRightWorkspaceCommands(listener) {
  if (typeof listener !== 'function') return () => {}
  const wrapped = (_event, value) => {
    const type = typeof value?.type === 'string' ? value.type : ''
    const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
    const text = typeof value?.text === 'string' ? value.text : ''
    if (type !== 'set-draft' || !sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId || !text || text.length > 12_000) return
    listener(Object.freeze({ type, sessionId, text }))
  }
  ipcRenderer.on('right-workspace:command', wrapped)
  return () => ipcRenderer.removeListener('right-workspace:command', wrapped)
}

// Deterministic ordered wallpaper park/resume subscription. Every broadcast
// carries a frozen { phase, reason, seq, at } payload; park releases the video
// decoder and canvas, resume re-creates them from a clean state. Delivery is
// sequenced by seq: a delivered state is always newer than every previously
// delivered one (seq <= latestSeq is dropped), so a slower current-state query
// can never arrive after a newer broadcast and reverse park/resume. The
// current host state is replayed once on subscribe for pages that attach after
// a transition, and unsubscribing immediately stops all further callbacks —
// including any in-flight replay.
function wallpaperLifecyclePhaseOf(value) {
  const phase = typeof value?.phase === 'string' && (value.phase === 'parked' || value.phase === 'resumed') ? value.phase : null
  const seq = Number.isSafeInteger(value?.seq) && value.seq >= 0 ? value.seq : null
  if (!phase || seq === null) return null
  return Object.freeze({
    phase,
    reason: typeof value?.reason === 'string' && value.reason.length <= 64 ? value.reason : '',
    seq,
    at: Number.isFinite(value?.at) ? value.at : 0
  })
}

async function currentWallpaperLifecycle() {
  let value = null
  try { value = await ipcRenderer.invoke('appearance:wallpaper-lifecycle:get') } catch {}
  return wallpaperLifecyclePhaseOf(value)
}

function subscribeWallpaperLifecycle(listener) {
  if (typeof listener !== 'function') return () => {}
  let latestSeq = -1
  let disposed = false
  const deliverIfNewer = value => {
    if (disposed) return
    const state = wallpaperLifecyclePhaseOf(value)
    if (!state || state.seq <= latestSeq) return
    latestSeq = state.seq
    listener(state.phase === 'parked' ? 'park' : 'resume')
  }
  const wrapped = (_event, value) => deliverIfNewer(value)
  ipcRenderer.on('appearance:wallpaper-lifecycle', wrapped)
  currentWallpaperLifecycle().then(deliverIfNewer).catch(() => {})
  return () => {
    disposed = true
    ipcRenderer.removeListener('appearance:wallpaper-lifecycle', wrapped)
  }
}

contextBridge.exposeInMainWorld('harnessDesktopGuest', Object.freeze({
  chooseWorkspaceDirectory: () => ipcRenderer.invoke('workspace:chooseDirectory'),
  publishRightWorkspaceContext: value => {
    const context = safeSessionContext(value)
    if (context) ipcRenderer.sendToHost('right-workspace:context', context)
    return Boolean(context)
  },
  publishRightWorkspaceIntent: value => {
    const intent = normalizeBrowserOpenIntent(value)
    if (intent) ipcRenderer.sendToHost('right-workspace:intent', intent)
    return Boolean(intent)
  },
  syncSessionMenuState,
  setSessionMenuFlag,
  authorizeAgentTeamsAutopilotSettings,
  desktopDeviceAction,
  onRightWorkspaceCommand: subscribeRightWorkspaceCommands,
  onWallpaperLifecycle: subscribeWallpaperLifecycle
}))

const interactiveSelector = [
  'a', 'button', 'input', 'textarea', 'select', 'option', 'label', 'summary',
  'video', 'audio', 'canvas', 'iframe', '[contenteditable="true"]', '[draggable="true"]',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="menuitem"]',
  '[role="treeitem"]', '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
  '[role="slider"]', '[data-hd-local-target]'
].join(',')
const interactiveCursors = new Set(['pointer', 'text', 'grab', 'grabbing', 'move', 'crosshair',
  'col-resize', 'row-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize'])

function installWindowsTitlebarSafeArea() {
  if (process.platform !== 'win32' || document.querySelector('style[data-hd-titlebar-safe-area]')) return
  const style = document.createElement('style')
  style.dataset.hdTitlebarSafeArea = 'true'
  // CSS Modules keeps the local class suffix but changes the build hash between
  // official Web releases. Match that stable suffix so the conversation header
  // continues to clear the Windows caption buttons and Desktop quick tools.
  style.textContent = '@media (min-width:980px){header:has(button[class*="_sessionLogButton"]){padding-right:260px!important}}'
  document.head.appendChild(style)
}

function pointTouchesText(x, y) {
  const caret = document.caretRangeFromPoint?.(x, y)
  const node = caret?.startContainer
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false
  const offset = Math.min(caret.startOffset, Math.max(0, node.textContent.length - 1))
  const range = document.createRange()
  range.setStart(node, offset)
  range.setEnd(node, Math.min(node.textContent.length, offset + 1))
  return [...range.getClientRects()].some(rect => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2)
}

window.addEventListener('DOMContentLoaded', () => {
  installWindowsTitlebarSafeArea()
  const sendPendingMove = () => {
    pendingFrame = 0
    if (activeDrag && pendingPoint) ipcRenderer.send('window:moveDrag', pendingPoint)
    pendingPoint = null
  }

  // Exactly one window:endDrag per drag session. Every abort path lands here,
  // so pointerup/pointercancel, lost pointer capture, focus loss, page
  // visibility change and pagehide all converge on the same deterministic
  // cleanup and the main process never keeps a stale drag session.
  let endDragSent = true
  const cleanupActiveDrag = () => {
    if (!activeDrag) return false
    if (pendingFrame) cancelAnimationFrame(pendingFrame)
    pendingFrame = 0
    if (pendingPoint) ipcRenderer.send('window:moveDrag', pendingPoint)
    pendingPoint = null
    try { activeDrag.target.releasePointerCapture(activeDrag.pointerId) } catch {}
    activeDrag = null
    if (!endDragSent) {
      endDragSent = true
      ipcRenderer.send('window:endDrag')
    }
    return true
  }

  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest(interactiveSelector)) return
    if (interactiveCursors.has(getComputedStyle(target).cursor) || pointTouchesText(event.clientX, event.clientY)) return
    const selection = window.getSelection?.()
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    activeDrag = { pointerId: event.pointerId, target }
    endDragSent = false
    try { target.setPointerCapture(event.pointerId) } catch {}
    ipcRenderer.send('window:beginDrag', { x: event.screenX, y: event.screenY })
  }, true)

  document.addEventListener('pointermove', event => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return
    event.preventDefault()
    event.stopImmediatePropagation()
    pendingPoint = { x: event.screenX, y: event.screenY }
    if (!pendingFrame) pendingFrame = requestAnimationFrame(sendPendingMove)
  }, true)

  const finishDrag = event => {
    if (!activeDrag || event.pointerId !== activeDrag.pointerId) return
    cleanupActiveDrag()
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  document.addEventListener('pointerup', finishDrag, true)
  document.addEventListener('pointercancel', finishDrag, true)
  document.addEventListener('lostpointercapture', event => {
    if (event.pointerId !== activeDrag?.pointerId) return
    cleanupActiveDrag()
    event.preventDefault()
    event.stopImmediatePropagation()
  }, true)
  window.addEventListener('blur', () => {
    if (activeDrag) cleanupActiveDrag()
  }, true)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeDrag) cleanupActiveDrag()
  }, true)
  window.addEventListener('pagehide', () => {
    if (activeDrag) cleanupActiveDrag()
  }, true)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    const selection = window.getSelection?.()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  }, true)
}, { once: true })
