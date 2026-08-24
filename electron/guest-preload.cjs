const { contextBridge, ipcRenderer } = require('electron')
let activeDrag = null
let pendingPoint = null
let pendingFrame = 0

function safeSessionContext(value) {
  const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : ''
  if (!sessionId || sessionId.length > 256 || sessionId.trim() !== sessionId) return null
  return Object.freeze({ sessionId })
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
  style.textContent = '@media (min-width:980px){header:has(.nL4_yW_sessionLogButton){padding-right:260px!important}}'
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
