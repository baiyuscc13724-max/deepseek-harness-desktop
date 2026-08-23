const { ipcRenderer } = require('electron')

const USER_NAVIGATION_INTENT_CHANNEL = 'browser-page:user-navigation-intent'
const MAX_INTENT_URL_LENGTH = 8_192

function sendTrustedIntent(value) {
  const url = String(value || '')
  if (!url || url.length > MAX_INTENT_URL_LENGTH) return false
  try {
    return ipcRenderer.sendSync(USER_NAVIGATION_INTENT_CHANNEL, { url }) === true
  } catch {
    return false
  }
}

function anchorFromEvent(event) {
  for (const node of event.composedPath?.() || []) {
    if (String(node?.tagName || '').toLowerCase() === 'a' && typeof node.href === 'string') return node
  }
  return null
}

function noteTrustedAnchor(event) {
  if (!event.isTrusted) return
  const anchor = anchorFromEvent(event)
  if (anchor?.href) sendTrustedIntent(anchor.href)
}

window.addEventListener('click', noteTrustedAnchor, true)
window.addEventListener('auxclick', noteTrustedAnchor, true)
window.addEventListener('submit', event => {
  if (!event.isTrusted) return
  const form = event.target
  if (String(form?.tagName || '').toLowerCase() !== 'form') return
  const submitterAction = typeof event.submitter?.formAction === 'string' ? event.submitter.formAction : ''
  sendTrustedIntent(submitterAction || form.action)
}, true)
