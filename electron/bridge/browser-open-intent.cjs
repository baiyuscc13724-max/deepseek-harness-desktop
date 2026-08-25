'use strict'

const MAX_BROWSER_INTENT_URL_LENGTH = 2048
const BROWSER_INTENT_VERSION = 1
const BROWSER_INTENT_ACTIONS = Object.freeze({
  READY: 'bridge-ready',
  SHOW: 'show-browser',
  OPEN_URL: 'open-browser-url'
})

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}

function safeHttpUrl(value) {
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
  if (action === BROWSER_INTENT_ACTIONS.READY) {
    if (!hasExactKeys(value, ['action', 'version']) || value.version !== BROWSER_INTENT_VERSION) return null
    return Object.freeze({ action, version: BROWSER_INTENT_VERSION })
  }
  if (action === BROWSER_INTENT_ACTIONS.SHOW) {
    if (!hasExactKeys(value, ['action'])) return null
    return Object.freeze({ action })
  }
  if (action === BROWSER_INTENT_ACTIONS.OPEN_URL) {
    if (!hasExactKeys(value, ['action', 'url'])) return null
    const url = safeHttpUrl(value.url)
    return url ? Object.freeze({ action, url }) : null
  }
  return null
}

module.exports = Object.freeze({
  MAX_BROWSER_INTENT_URL_LENGTH,
  BROWSER_INTENT_VERSION,
  BROWSER_INTENT_ACTIONS,
  safeHttpUrl,
  normalizeBrowserOpenIntent
})
