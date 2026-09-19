const dragSessions = new WeakMap()

function normalizedPoint(point = {}) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const x = Math.round(point.x)
  const y = Math.round(point.y)
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x, y } : null
}

function beginWindowDrag(window, point = {}, platform = process.platform) {
  if (platform === 'linux' || !window || window.isDestroyed()) return false
  const cursor = normalizedPoint(point)
  if (!cursor) { dragSessions.delete(window); return false }
  const before = window.getBounds()
  if (window.isMaximized?.()) {
    const ratioX = Math.max(0, Math.min(1, (cursor.x - before.x) / Math.max(1, before.width)))
    const ratioY = Math.max(0, Math.min(1, (cursor.y - before.y) / Math.max(1, before.height)))
    // On some Windows/DPI combinations unmaximize() completes asynchronously.
    // Capture the real restore bounds first so the maximized size is never
    // persisted as the normal window size while the pointer starts moving.
    const normal = window.getNormalBounds?.()
    window.unmaximize()
    const restored = normal && normal.width > 0 && normal.height > 0 ? normal : window.getBounds()
    const target = {
      x: Math.round(cursor.x - restored.width * ratioX),
      y: Math.round(cursor.y - restored.height * ratioY),
      width: restored.width,
      height: restored.height
    }
    if (typeof window.setBounds === 'function') window.setBounds(target, false)
    else window.setPosition(target.x, target.y, false)
    dragSessions.set(window, { cursor, origin: { x: target.x, y: target.y } })
    return true
  }
  const origin = window.getBounds()
  dragSessions.set(window, { cursor, origin: { x: origin.x, y: origin.y } })
  return true
}

function moveWindowDrag(window, point = {}) {
  const session = window && dragSessions.get(window)
  if (!session || window.isDestroyed()) return false
  const cursor = normalizedPoint(point)
  if (!cursor) { dragSessions.delete(window); return false }
  window.setPosition(session.origin.x + cursor.x - session.cursor.x, session.origin.y + cursor.y - session.cursor.y, false)
  return true
}

function endWindowDrag(window) {
  return Boolean(window && dragSessions.delete(window))
}

module.exports = { beginWindowDrag, moveWindowDrag, endWindowDrag, normalizedPoint }
