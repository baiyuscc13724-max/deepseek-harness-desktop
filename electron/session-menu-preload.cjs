const { contextBridge, ipcRenderer } = require('electron')

// Detached session windows do not need the full guest preload (which also owns
// main-window drag behavior). Keep this bridge deliberately limited to the
// desktop-owned session-menu state shared with the embedded runtime guest.
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
  return safeSessionMenuState(await ipcRenderer.invoke('sessionMenu:sync', safeSessionMenuState(value)))
}

async function setSessionMenuFlag(value) {
  const request = safeSessionMenuFlag(value)
  if (!request) return null
  return safeSessionMenuState(await ipcRenderer.invoke('sessionMenu:setFlag', request))
}

contextBridge.exposeInMainWorld('harnessDesktopGuest', Object.freeze({
  syncSessionMenuState,
  setSessionMenuFlag
}))
