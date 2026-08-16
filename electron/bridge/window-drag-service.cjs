const dragSessions = new WeakMap()

function normalizedPoint(point = {}) {
  return { x: Math.round(Number(point.x) || 0), y: Math.round(Number(point.y) || 0) }
}

function beginWindowDrag(window, point = {}, platform = process.platform) {
  if (platform === 'linux' || !window || window.isDestroyed()) return false
  const cursor = normalizedPoint(point)
  const before = window.getBounds()
  if (window.isMaximized?.()) {
    const ratioX = Math.max(0, Math.min(1, (cursor.x - before.x) / Math.max(1, before.width)))
    const ratioY = Math.max(0, Math.min(1, (cursor.y - before.y) / Math.max(1, before.height)))
    window.unmaximize()
    const restored = window.getBounds()
    window.setPosition(Math.round(cursor.x - restored.width * ratioX), Math.round(cursor.y - restored.height * ratioY), false)
  }
  const origin = window.getBounds()
  dragSessions.set(window, { cursor, origin: { x: origin.x, y: origin.y } })
  return true
}

function moveWindowDrag(window, point = {}) {
  const session = window && dragSessions.get(window)
  if (!session || window.isDestroyed()) return false
  const cursor = normalizedPoint(point)
  window.setPosition(session.origin.x + cursor.x - session.cursor.x, session.origin.y + cursor.y - session.cursor.y, false)
  return true
}

function endWindowDrag(window) {
  return Boolean(window && dragSessions.delete(window))
}

module.exports = { beginWindowDrag, moveWindowDrag, endWindowDrag, normalizedPoint }
