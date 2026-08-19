const { contextBridge, ipcRenderer, webUtils } = require('electron')
let activeDrag = null
let pendingPoint = null
let pendingFrame = 0
let attachmentQueue = Promise.resolve()

contextBridge.exposeInMainWorld('harnessDesktopGuest', Object.freeze({
  chooseWorkspaceDirectory: () => ipcRenderer.invoke('workspace:chooseDirectory')
}))

const nativeImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const nativeImageTypeByExtension = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.jfif', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
])

function fileExtension(name) {
  const match = String(name || '').toLowerCase().match(/(\.[^.\\/]+)$/)
  return match?.[1] || ''
}

function asNativeImage(file) {
  if (nativeImageTypes.has(file.type)) return file
  const inferred = nativeImageTypeByExtension.get(fileExtension(file.name))
  if (!inferred) return null
  return new File([file], file.name, { type: inferred, lastModified: file.lastModified })
}

function visibleComposer() {
  return [...document.querySelectorAll('[data-composer-card] textarea')].find(element => {
    if (!(element instanceof HTMLTextAreaElement) || element.disabled || element.readOnly) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }) || null
}

function setTextareaValue(element, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(element, value)
  else element.value = value
}

function insertAttachmentText(element, text) {
  if (!element?.isConnected || !text) return false
  const start = element.selectionStart ?? element.value.length
  const end = element.selectionEnd ?? start
  const prefix = element.value && start === element.value.length ? '\n\n' : ''
  const inserted = `${prefix}${text}`
  const next = element.value.slice(0, start) + inserted + element.value.slice(end)
  setTextareaValue(element, next)
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: inserted
  }))
  const caret = start + inserted.length
  element.focus({ preventScroll: true })
  element.setSelectionRange(caret, caret)
  return true
}

function showAttachmentToast(message, tone = 'info') {
  document.querySelector('[data-hd-attachment-toast]')?.remove()
  const toast = document.createElement('div')
  toast.dataset.hdAttachmentToast = 'true'
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status')
  toast.textContent = message
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    bottom: '88px',
    zIndex: '2147483647',
    maxWidth: 'min(560px, calc(100vw - 32px))',
    transform: 'translateX(-50%)',
    borderRadius: '12px',
    padding: '10px 14px',
    color: '#fff',
    background: tone === 'error' ? '#b42318' : '#187f78',
    boxShadow: '0 8px 24px rgba(0, 0, 0, .18)',
    font: '13px/1.5 system-ui, sans-serif'
  })
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), tone === 'error' ? 6000 : 3500)
}

function resetOfficialDropOverlay() {
  window.dispatchEvent(new DragEvent('dragend'))
}

function dispatchNativeImages(files) {
  if (files.length === 0) {
    resetOfficialDropOverlay()
    return
  }
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  document.dispatchEvent(new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer
  }))
}

async function addFileReferences(files, composer) {
  const candidates = files.map(file => ({
    path: webUtils.getPathForFile(file),
    mimeType: file.type
  })).filter(candidate => candidate.path)
  if (candidates.length === 0) {
    showAttachmentToast('无法取得本机文件路径；请从资源管理器拖入文件。', 'error')
    return
  }
  const result = await ipcRenderer.invoke('attachments:inspect', candidates)
  const target = composer?.isConnected && !composer.disabled && !composer.readOnly ? composer : visibleComposer()
  if (!target) {
    showAttachmentToast('当前会话输入框不可用，无法添加附件。', 'error')
    return
  }
  if (result.referenceText) insertAttachmentText(target, result.referenceText)
  if (result.accepted.length > 0) {
    const suffix = result.rejected.length > 0 ? `，另有 ${result.rejected.length} 个文件未添加` : ''
    showAttachmentToast(`已添加 ${result.accepted.length} 个本地附件引用${suffix}；发送后模型可按路径读取。`)
  } else {
    const reason = result.rejected[0]?.reason || '文件不可用'
    showAttachmentToast(`附件未添加：${reason}。`, 'error')
  }
}

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

  document.addEventListener('drop', event => {
    if (!event.isTrusted || !event.dataTransfer?.types.includes('Files')) return
    const files = [...event.dataTransfer.files]
    if (files.length === 0) return
    const nativeImages = []
    const references = []
    for (const file of files) {
      const native = asNativeImage(file)
      if (native) nativeImages.push(native)
      else references.push(file)
    }
    if (references.length === 0) return

    event.preventDefault()
    event.stopImmediatePropagation()
    const composer = visibleComposer()
    dispatchNativeImages(nativeImages)
    attachmentQueue = attachmentQueue
      .then(() => addFileReferences(references, composer))
      .catch(error => showAttachmentToast(`附件添加失败：${error?.message || String(error)}`, 'error'))
  }, true)
}, { once: true })
