const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, ipcMain, session } = require('electron')

const { createAgentTeamsAuthorizationService, validateAutopilotIssue } = require('../../electron/bridge/agent-teams-authorization-service.cjs')

const profileRoot = mkdtempSync(path.join(os.tmpdir(), 'hd-agent-teams-host-electron-'))
app.setPath('userData', path.join(profileRoot, 'user-data'))
app.commandLine.appendSwitch('disable-gpu')

const AUTHORIZATION_HEADER = 'X-Harness-Agent-Teams-Authorization'
const CAPABILITY_FIELD = 'hostAuthorizationCapability'
const ACTION_PATH = '/api/agent-teams/action'
const bodyTemplate = Object.freeze({
  action: 'settings',
  sessionId: 'settings',
  enabled: true,
  maxMembers: 4,
  maxActiveTurns: 3,
  autopilotEnabled: true,
  autopilotMaxAdditionalRounds: 200
})

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}
function close(server) { return new Promise(resolve => server.close(() => resolve())) }
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > 256 * 1024) reject(new Error('body too large'))
      else chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}
function header(headers, name) {
  const key = Object.keys(headers || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : headers[key]
}
function removeHeader(headers, name) {
  for (const key of Object.keys(headers || {})) if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
}
function uploadBody(details) {
  const chunks = []
  let size = 0
  for (const part of details.uploadData || []) {
    if (!part || part.bytes === undefined || part.file !== undefined || part.blobUUID !== undefined) return null
    const bytes = Buffer.from(part.bytes)
    size += bytes.length
    if (size > 256 * 1024) return null
    chunks.push(bytes)
  }
  if (chunks.length === 0) return null
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { return null }
}
function bindingHash(value) {
  return createHash('sha256').update(JSON.stringify(['senderWebContentsId', 'ownerWindowWebContentsId', 'runtimeOrigin'].map(key => value[key]))).digest('hex')
}
function page() {
  return `<!doctype html><meta charset="utf-8"><button id="save" style="position:absolute;left:40px;top:40px;width:220px;height:70px">Save settings</button><script>
    window.__result = null;
    window.__authorization = null;
    document.querySelector('#save').addEventListener('click', async () => {
      try {
        const body = ${JSON.stringify(bodyTemplate)};
        const authorization = await window.harnessDesktopGuest.authorizeAgentTeamsAutopilotSettings(body);
        window.__authorization = authorization;
        body.${CAPABILITY_FIELD} = authorization.authorizationId;
        const response = await fetch('${ACTION_PATH}', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-harness-agent-teams': '1' }, body: JSON.stringify(body) });
        window.__result = { ok: response.ok, status: response.status, body: await response.json() };
      } catch (error) {
        window.__result = { ok: false, code: error && error.code || '', error: error && error.message || String(error) };
      }
    });
  </script>`
}
async function waitFor(contents, expression, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await contents.executeJavaScript(expression, true)
    if (value) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${expression}`)
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}
async function trustedClick(window) {
  window.show()
  window.focus()
  window.webContents.focus()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(window.isFocused(), true, 'the Host owner window must be focused before a trusted click')
  assert.equal(window.webContents.isFocused(), true, 'the Runtime webContents must be focused before a trusted click')
  const point = await window.webContents.executeJavaScript(`(() => { const r = document.querySelector('#save').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, true)
  window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}

async function run() {
  let origin = ''
  let epochSequence = 0
  let nativeConfirmations = 0
  const requests = []
  const owners = new Map()
  const candidates = new Map()
  const stateFile = path.join(profileRoot, 'agent-teams-authorizations.json')
  const authorizationService = createAgentTeamsAuthorizationService({
    stateFile,
    showMessageBox: async () => ({ response: 0 }),
    createAutopilotEpoch: () => `electron_epoch_${String(++epochSequence).padStart(16, '0')}`
  })
  await authorizationService.start()
  const capabilityModuleUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'plugins', 'dsh-agent-teams', 'lib', 'desktop-authorization-capability.js')).href
  const { consumeDesktopAuthorizationCapability } = await import(`${capabilityModuleUrl}?electron=${Date.now()}`)
  const provider = consumeDesktopAuthorizationCapability({ env: authorizationService.runtimeEnvironment({}), timeoutMs: 3_000 })

  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(page())
      return
    }
    if (request.method === 'POST' && request.url === ACTION_PATH) {
      const body = await readBody(request)
      const authorizationId = request.headers[AUTHORIZATION_HEADER.toLowerCase()]
      requests.push({ authorizationId: authorizationId || '', origin: request.headers.origin || '', body })
      if (!authorizationId || body[CAPABILITY_FIELD] !== authorizationId || request.headers.origin !== origin) {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false, code: 'FORBIDDEN' }))
        return
      }
      const settings = Object.fromEntries(['enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds'].map(key => [key, body[key]]))
      try {
        const receipt = await provider.consumeAutopilotAuthorization({ authorizationId, sessionId: body.sessionId, settings, hostAuthorization: null })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, receipt }))
      } catch (error) {
        response.writeHead(403, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: false, code: error?.code || 'FAILED' }))
      }
      return
    }
    response.writeHead(404).end()
  })
  const port = await listen(server)
  origin = `http://127.0.0.1:${port}`
  const runtimeSession = session.fromPartition('persist:harness', { cache: true })

  const desktopBinding = contents => {
    const owner = owners.get(contents.id)
    assert.ok(owner && !owner.isDestroyed(), 'only a managed Host window can issue')
    assert.equal(contents.session, runtimeSession)
    assert.equal(owner.isVisible(), true)
    assert.equal(owner.isFocused(), true)
    assert.equal(contents.isFocused(), true)
    return { senderWebContentsId: contents.id, ownerWindowWebContentsId: owner.webContents.id, runtimeOrigin: origin }
  }
  ipcMain.handle('agentTeams:authorizeAutopilotSettings', async (event, value) => {
    assert.equal(event.senderFrame, event.sender.mainFrame, 'the exact Runtime main frame must issue')
    const before = desktopBinding(event.sender)
    const normalized = validateAutopilotIssue(value)
    assert.equal(normalized.settings.autopilotMaxAdditionalRounds, 200)
    // The production main process presents a parent-window native dialog. This
    // fixture records the same exact confirmation boundary without blocking CI.
    nativeConfirmations += 1
    const after = desktopBinding(event.sender)
    assert.deepEqual(after, before, 'sender/window/origin binding must survive confirmation')
    return authorizationService.issueAutopilotAuthorization(value, after)
  })

  const filter = { urls: [`${origin}/*`] }
  runtimeSession.webRequest.onBeforeRequest(filter, (details, callback) => {
    const owner = owners.get(details.webContentsId)
    const body = owner && owner.isFocused() && owner.webContents.isFocused() ? uploadBody(details) : null
    const capability = typeof body?.[CAPABILITY_FIELD] === 'string' ? body[CAPABILITY_FIELD] : ''
    if (capability) {
      const claimBody = { ...body }
      delete claimBody[CAPABILITY_FIELD]
      candidates.set(details.id, { capability, claimBody, binding: desktopBinding(owner.webContents) })
    }
    callback({})
  })
  runtimeSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    const headers = { ...(details.requestHeaders || {}) }
    removeHeader(headers, AUTHORIZATION_HEADER)
    const candidate = candidates.get(details.id)
    candidates.delete(details.id)
    if (candidate) {
      const requestOrigin = header(headers, 'Origin')
      try {
        authorizationService.claimAutopilotWebRequest(candidate.capability, candidate.claimBody, candidate.binding, requestOrigin)
        headers[AUTHORIZATION_HEADER] = candidate.capability
      } catch {}
    }
    callback({ requestHeaders: headers })
  })

  const windows = []
  async function exercise(preload, kind) {
    const window = new BrowserWindow({
      show: true,
      width: 520,
      height: 300,
      webPreferences: { partition: 'persist:harness', preload, contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    windows.push(window)
    owners.set(window.webContents.id, window)
    await window.loadURL(`${origin}/`)

    await window.webContents.executeJavaScript(`document.querySelector('#save').click()`, true)
    const synthetic = await waitFor(window.webContents, 'window.__result')
    assert.equal(synthetic.ok, false, `${kind}: a synthetic click must not carry user activation`)
    assert.match(synthetic.error, /点击|click|保存/u)
    assert.equal(nativeConfirmations, windows.length - 1, `${kind}: synthetic activation must not reach Host confirmation`)

    await window.webContents.executeJavaScript(`window.__result = null; window.__authorization = null`, true)
    await trustedClick(window)
    const success = await waitFor(window.webContents, 'window.__result')
    assert.equal(success.ok, true, `${kind}: trusted click must complete exact Host settings flow`)
    assert.equal(success.status, 200)
    assert.equal(success.body.receipt.tool, 'team_autopilot')
    assert.equal(success.body.receipt.desktopBindingHash, bindingHash(desktopBinding(window.webContents)))

    const replay = await window.webContents.executeJavaScript(`fetch('${ACTION_PATH}', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-harness-agent-teams': '1' }, body: JSON.stringify(Object.assign(${JSON.stringify(bodyTemplate)}, { ${CAPABILITY_FIELD}: window.__authorization.authorizationId })) }).then(async response => ({ status: response.status, body: await response.json() }))`, true)
    assert.equal(replay.status, 403, `${kind}: the same capability cannot authorize a second request`)
    assert.equal(replay.body.ok, false)
    window.hide()
  }

  try {
    await runtimeSession.clearStorageData()
    await exercise(path.resolve(__dirname, '..', '..', 'electron', 'guest-preload.cjs'), 'embedded-runtime')
    await exercise(path.resolve(__dirname, '..', '..', 'electron', 'session-menu-preload.cjs'), 'detached-session')
    assert.equal(nativeConfirmations, 2, 'each real trusted click requires one exact Host confirmation')
    assert.equal(requests.filter(request => request.authorizationId).length, 2, 'only one authorized POST per managed window reaches Runtime')
    assert.equal(requests.every(request => request.origin === origin), true)
    process.stdout.write(`AGENT_TEAMS_HOST_ELECTRON_QA ${JSON.stringify({
      ok: true,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      nativeConfirmations,
      windows: ['embedded-runtime', 'detached-session'],
      authorizedRequests: requests.filter(request => request.authorizationId).length,
      replayRequests: requests.filter(request => !request.authorizationId).length
    })}\n`)
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    ipcMain.removeHandler('agentTeams:authorizeAutopilotSettings')
    provider.dispose()
    await authorizationService.close()
    await runtimeSession.clearStorageData().catch(() => {})
    await close(server)
  }
}

app.whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch(error => {
    process.stderr.write(`AGENT_TEAMS_HOST_ELECTRON_QA_FAILED ${error?.stack || error}\n`)
    app.exit(1)
  })
  .finally(() => {
    try { rmSync(profileRoot, { recursive: true, force: true }) } catch {}
  })
