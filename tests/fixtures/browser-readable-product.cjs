// Real isolated DOM and fixed locator engine, plus actual ActionGate and text
// censor. This module is loaded by the opt-in Electron parent fixture only.
const { BrowserWindow, session } = require('electron')
const { randomUUID } = require('node:crypto')
const assert = require('node:assert/strict')
const { ActionGate, isSensitiveText } = require('../../electron/bridge/browser-action-gate.cjs')
const { redact } = require('../../electron/bridge/memory-censor.cjs')
const { runBrowserPlaywrightOperation } = require('../../electron/bridge/browser-codex-api.cjs')
module.exports = async function readableTests(results) {
  const ownSession = session.fromPartition('readable-' + randomUUID())
  const html = '<!doctype html><video id="lesson" width="400" height="240" controls><track id="captions" kind="subtitles" srclang="en" label="English"><source id="movie" type="video/mp4"></video><a id="resource" aria-label="Lesson resource">Resource</a><div id="concealed" style="display:none" title="hidden note"></div><input id="ordinary" value="private input"><input id="password" type="password"><script id="scriptblock">void 0</script><div id="hint" title="password=example-secret">Hint</div>'
  await ownSession.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }))
  const window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { session: ownSession, nodeIntegration: false, contextIsolation: true, sandbox: true } })
  try {
    await window.loadURL('https://readable-fixture.invalid/')
    await window.webContents.executeJavaScript(`document.querySelector('#resource').href='https://reader:secret@example.com/lesson?access_token=private#private';`)
    const origin = 'https://readable-fixture.invalid'
    const gate = new ActionGate()
    gate.setActiveTab({ id: 'readable', origin, visible: false, available: true })
    const authorizations = { authorized: (candidate, action) => candidate === origin && action === 'read', origins: () => [origin], privateOrigins: () => [], allowPublicOrigins: true }
    const common = { webContents: window.webContents, origin, tabId: 'readable', securityPolicy: { modelAction(input) { const decision = gate.gate({ ...input, authorizations }); return { ...decision, allowed: decision.verdict === 'allow', requiresConfirmation: decision.verdict !== 'allow' } } }, sanitizeText: value => isSensitiveText(String(value)) ? '[REDACTED:sensitive-browser-content]' : redact(String(value)).text }
    const read = (selector, attribute) => runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'getAttribute', selector, attribute } })
    for (const [selector, attribute, expected] of [['#captions', 'srclang', 'en'], ['#captions', 'kind', 'subtitles'], ['#captions', 'label', 'English'], ['#movie', 'type', 'video/mp4'], ['#resource', 'aria-label', 'Lesson resource'], ['#resource', 'href', 'https://example.com/lesson']]) {
      assert.equal((await read(selector, attribute)).value, expected)
      results.push(`readable DOM: ${selector}/${attribute}`)
    }
    for (const [selector, attribute, code] of [['#concealed', 'title', 'browser-playwright-element-not-actionable'], ['#ordinary', 'value', 'browser-playwright-attribute-forbidden'], ['#password', 'title', 'browser-playwright-sensitive-locator'], ['#scriptblock', 'src', 'browser-playwright-content-forbidden'], ['#captions', 'data-auth-token', 'browser-playwright-attribute-forbidden']]) {
      await assert.rejects(read(selector, attribute), error => error.code === code)
      results.push(`readable DOM rejection: ${selector}/${attribute}`)
    }
    await assert.rejects(read('#hint', 'title'), error => { assert.doesNotMatch(error.message, /example-secret/); return error.code === 'browser-playwright-sensitive-field' })
    results.push('readable DOM: sensitive attribute text refused without echo')
    await window.webContents.executeJavaScript(`document.querySelector('video').style.display='none';`)
    for (const [selector, attribute] of [['#captions', 'srclang'], ['#movie', 'type']]) {
      await assert.rejects(read(selector, attribute), error => error.code === 'browser-playwright-element-not-actionable')
      results.push(`readable DOM: hidden media parent rejects ${selector}`)
    }
  } finally { window.destroy() }
}
