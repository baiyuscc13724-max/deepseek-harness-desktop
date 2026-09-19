'use strict'
const { randomUUID, createHash } = require('node:crypto')
const path = require('node:path')

function failure(state, code, message) {
  return { state, code, message, sourceBound: false, visible: false, imageUnavailable: true }
}
function validateInput(input) {
  const p = input?.payload
  if (input?.scope !== 'workspace' || input?.action !== 'preview' || !p || Array.isArray(p) || Object.keys(p).sort().join(',') !== 'path,sourceSessionId') throw new Error('WORKSPACE_PREVIEW_ARGUMENTS')
  if (typeof p.path !== 'string' || !p.path || p.path.length > 4096 || p.path.trim() !== p.path || /[\u0000-\u001f\u007f]/u.test(p.path) || /^[a-z][a-z\d+.-]*:/iu.test(p.path) || path.isAbsolute(p.path) || path.win32.isAbsolute(p.path) || p.path.split(/[\\/]/u).includes('..')) throw new Error('WORKSPACE_PREVIEW_PATH')
  if (typeof p.sourceSessionId !== 'string' || !p.sourceSessionId || p.sourceSessionId.length > 256 || p.sourceSessionId.trim() !== p.sourceSessionId || /[\u0000-\u001f\u007f]/u.test(p.sourceSessionId)) throw new Error('WORKSPACE_PREVIEW_SOURCE')
  return Object.freeze({ path: p.path, sourceSessionId: p.sourceSessionId })
}
function fileIdentity(body) {
  // Includes the actual loaded text (where applicable) and source-bound URL.
  return createHash('sha256').update(JSON.stringify(body)).digest('hex')
}
function captureRect(snapshot, zoom, contentSize) {
  const r = snapshot?.rect, v = snapshot?.viewport
  if (!r || !v || ![r.x, r.y, r.width, r.height, v.width, v.height, v.dpr, zoom, ...contentSize].every(Number.isFinite) || zoom <= 0 || zoom > 5 || v.scale !== 1 || v.offsetX !== 0 || v.offsetY !== 0 || Math.abs(v.width * zoom - contentSize[0]) > 2 || Math.abs(v.height * zoom - contentSize[1]) > 2) throw new Error('WORKSPACE_PREVIEW_GEOMETRY')
  // capturePage takes DIP, not CSS pixels or physical device pixels. Round IN
  // toward the document so the left conversation can never enter the crop.
  const x = Math.ceil(Math.max(0, r.x) * zoom), y = Math.ceil(Math.max(0, r.y) * zoom)
  const right = Math.floor(Math.min(v.width, r.x + r.width) * zoom)
  const bottom = Math.floor(Math.min(v.height, r.y + r.height) * zoom)
  if (r.width <= 0 || r.height <= 0 || right <= x || bottom <= y || x < 0 || y < 0 || right > contentSize[0] || bottom > contentSize[1]) throw new Error('WORKSPACE_PREVIEW_GEOMETRY')
  return { x, y, width: right - x, height: bottom - y }
}

class WorkspacePreviewBridge {
  constructor({ getWindow, loadFile, isObscured = () => false, timeoutMs = 25_000 }) {
    this.isObscured = isObscured
    this.getWindow = getWindow
    this.loadFile = loadFile
    this.timeoutMs = Math.min(25_000, Math.max(100, timeoutMs))
    this.pending = null
  }
  acceptReceipt(event, value) {
    const p = this.pending
    if (!p || event.sender !== p.contents || (event.senderFrame && event.senderFrame !== p.contents.mainFrame) || value?.nonce !== p.nonce || value.path !== p.source.path || value.sourceSessionId !== p.source.sourceSessionId || !Number.isSafeInteger(value.revision)) return false
    p.resolve(value)
    return true
  }
  dispose() { this.pending?.abort() }
  async preview(input, context = {}) {
    let source
    try { source = validateInput(input) } catch (error) { return failure('failed', error.message, '工作区预览只接受受信任来源与相对文件路径。') }
    if (this.pending) return failure('failed', 'WORKSPACE_PREVIEW_BUSY', '另一个预览观察正在完成，本请求未执行或入队。')
    const win = this.getWindow()
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return failure('not-visible', 'WORKSPACE_PREVIEW_NOT_VISIBLE', '桌面窗口当前不可见；未进行视觉观察。')
    const contents = win.webContents, nonce = randomUUID()
    const controller = new AbortController()
    const signal = controller.signal
    let resolve, reject
    const receipt = new Promise((yes, no) => { resolve = yes; reject = no })
    receipt.catch(() => {})
    const abort = () => { controller.abort(); reject(new Error('WORKSPACE_PREVIEW_CANCELLED')) }
    const p = { contents, nonce, source, resolve, abort }
    this.pending = p
    let geometryEpoch = 0
    const geometryChanged = () => { geometryEpoch += 1 }
    const timer = setTimeout(abort, this.timeoutMs)
    context.signal?.addEventListener('abort', abort, { once: true })
    contents.once('destroyed', abort)
    win.on('resize', geometryChanged)
    win.on('move', geometryChanged)
    contents.on('zoom-changed', geometryChanged)
    const current = () => {
      if (signal.aborted || context.signal?.aborted || this.pending !== p || this.getWindow() !== win || win.isDestroyed() || contents.isDestroyed()) throw new Error('WORKSPACE_PREVIEW_CANCELLED')
      if (!win.isVisible() || win.isMinimized()) throw new Error('WORKSPACE_PREVIEW_NOT_VISIBLE')
    }
    const inspect = async () => {
      current()
      const snapshot = await contents.executeJavaScript(`window.harnessDesktopRightWorkspace?.observeModelPreview(${JSON.stringify(nonce)}) || null`)
      current()
      if (!snapshot || snapshot.state !== 'rendered' || snapshot.nonce !== nonce || snapshot.path !== source.path || snapshot.sourceSessionId !== source.sourceSessionId) throw new Error('WORKSPACE_PREVIEW_SUPERSEDED')
      if (this.isObscured()) throw new Error('WORKSPACE_PREVIEW_NOT_VISIBLE')
      const zoom = contents.getZoomFactor(), size = win.getContentSize()
      return { snapshot, zoom, size, bounds: win.getContentBounds(), geometryEpoch, rect: captureRect(snapshot, zoom, size) }
    }
    const work = async () => {
      current()
      const body = await this.loadFile(source)
      current()
      if (body?.sessionId !== source.sourceSessionId || body?.file?.sourceSessionId !== source.sourceSessionId) throw new Error('WORKSPACE_PREVIEW_SOURCE_MISMATCH')
      if (!body.file.previewable) return failure('failed', 'WORKSPACE_PREVIEW_UNSUPPORTED', '文件不能安全内嵌预览；未执行或系统打开。')
      const identity = fileIdentity(body)
      contents.send('rightWorkspace:modelPreview', { nonce, ...source, file: body.file })
      const acknowledgment = await receipt
      current()
      if (acknowledgment.state !== 'rendered') {
        const state = ['failed', 'not-visible', 'superseded'].includes(acknowledgment.state) ? acknowledgment.state : 'failed'
        return failure(state, 'WORKSPACE_PREVIEW_NOT_RENDERED', '未取得当前请求的可见文档回执。')
      }
      const before = await inspect()
      if (before.snapshot.revision !== acknowledgment.revision) throw new Error('WORKSPACE_PREVIEW_SUPERSEDED')
      let image, imageUnavailableReason
      try { image = await contents.capturePage(before.rect) } catch { imageUnavailableReason = '当前文档区域无法截图；仅有结构观察，不表示视觉验证完成。' }
      const after = await inspect()
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('WORKSPACE_PREVIEW_SUPERSEDED')
      const checked = await this.loadFile(source)
      current()
      if (fileIdentity(checked) !== identity || JSON.stringify(after) !== JSON.stringify(await inspect())) throw new Error('WORKSPACE_PREVIEW_SUPERSEDED')
      const result = { state: 'rendered', sourceBound: true, visible: true, contentKind: before.snapshot.contentKind, observation: { textExcerpt: String(before.snapshot.textExcerpt || '').slice(0, 12_000), truncated: before.snapshot.truncated === true } }
      if (image && !image.isEmpty()) {
        if (image.getSize().width > 1600) image = image.resize({ width: 1600 })
        const bytes = image.toPNG()
        if (bytes.length <= 4 * 1024 * 1024) result.image = `data:image/png;base64,${bytes.toString('base64')}`
        else imageUnavailableReason = '文档区域截图超过大小限制。'
      }
      if (!result.image) { result.imageUnavailable = true; result.imageUnavailableReason = imageUnavailableReason || '未取得有效文档区域图像；尚未视觉验证。' }
      return result
    }
    try {
      return await Promise.race([work(), new Promise((_, no) => signal.addEventListener('abort', () => no(new Error('WORKSPACE_PREVIEW_CANCELLED')), { once: true }))])
    } catch (error) {
      const code = String(error?.code || error?.message || '')
      const state = code === 'WORKSPACE_PREVIEW_NOT_VISIBLE' ? 'not-visible' : code === 'WORKSPACE_PREVIEW_SUPERSEDED' ? 'superseded' : code === 'WORKSPACE_PREVIEW_CANCELLED' ? 'unconfirmed' : 'failed'
      return failure(state, /^(WORKSPACE_PREVIEW_|FILES_)/u.test(code) ? code : 'WORKSPACE_PREVIEW_FAILED', '没有完成本次来源绑定的预览观察；未返回旧图，不代表本机文件权限不足。')
    } finally {
      clearTimeout(timer)
      context.signal?.removeEventListener('abort', abort)
      contents.removeListener('destroyed', abort)
      contents.removeListener('zoom-changed', geometryChanged)
      win.removeListener('resize', geometryChanged)
      win.removeListener('move', geometryChanged)
      if (!contents.isDestroyed()) contents.send('rightWorkspace:modelPreviewCancel', { nonce })
      if (this.pending === p) this.pending = null
      controller.abort()
    }
  }
}
module.exports = { WorkspacePreviewBridge, captureRect, validateInput }
