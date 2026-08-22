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

contextBridge.exposeInMainWorld('harnessDesktopGuest', Object.freeze({
  chooseWorkspaceDirectory: () => ipcRenderer.invoke('workspace:chooseDirectory'),
  publishRightWorkspaceContext: value => {
    const context = safeSessionContext(value)
    if (context) ipcRenderer.sendToHost('right-workspace:context', context)
    return Boolean(context)
  },
  onRightWorkspaceCommand: subscribeRightWorkspaceCommands
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
  const sendPendingMove = () => {
    pendingFrame = 0
    if (activeDrag && pendingPoint) ipcRenderer.send('window:moveDrag', pendingPoint)
    pendingPoint = null
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
    if (pendingFrame) cancelAnimationFrame(pendingFrame)
    pendingFrame = 0
    if (pendingPoint) ipcRenderer.send('window:moveDrag', pendingPoint)
    pendingPoint = null
    try { activeDrag.target.releasePointerCapture(activeDrag.pointerId) } catch {}
    activeDrag = null
    ipcRenderer.send('window:endDrag')
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  document.addEventListener('pointerup', finishDrag, true)
  document.addEventListener('pointercancel', finishDrag, true)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    const selection = window.getSelection?.()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  }, true)
}, { once: true })
