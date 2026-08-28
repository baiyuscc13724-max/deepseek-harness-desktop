const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain, WebContentsView } = require('electron')

const { BrowserNavigationLane, attachBrowserNavigationGuard } = require('../../electron/bridge/browser-navigation-guard.cjs')
const { BrowserSecurityPolicy } = require('../../electron/bridge/browser-security-policy.cjs')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const exerciseRealInput = process.env.HARNESS_BROWSER_TEST_REAL_INPUT === '1'

async function waitForDomClick(contents, expectedId, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  let observed
  while (Date.now() < deadline) {
    observed = await contents.executeJavaScript('window.__lastClick', true).catch(() => undefined)
    if (observed?.id === expectedId) return observed
    await wait(25)
  }
  return observed
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

async function run() {
  const profileRoot = mkdtempSync(path.join(os.tmpdir(), 'hd-browser-navigation-electron-'))
  let targetHits = 0
  const targetServer = http.createServer((_request, response) => {
    targetHits += 1
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('unauthorized target reached')
  })
  const targetPort = await listen(targetServer)
  const targetOrigin = `http://127.0.0.1:${targetPort}`

  let sourceOrigin = ''
  const sourceServer = http.createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: `${targetOrigin}/redirect-target` })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html>
      <a id="blocked-link" href="${targetOrigin}/link-target">blocked link</a>
      <form id="blocked-form" action="${targetOrigin}/form-target" method="get">
        <button type="submit">submit</button>
      </form>
      <button id="no-navigation" type="button">stay here</button>
      <script>addEventListener('click', event => { window.__lastClick = { trusted: event.isTrusted, id: event.target.id } }, true)</script>`)
  })
  const sourcePort = await listen(sourceServer)
  sourceOrigin = `http://127.0.0.1:${sourcePort}`

  const policy = new BrowserSecurityPolicy({ authzRootDir: profileRoot })
  policy.grant(sourceOrigin, {
    actions: ['read', 'click', 'submit'],
    allowPrivateNetwork: true,
    by: 'user'
  })

  const window = new BrowserWindow({ show: false, width: 800, height: 600, skipTaskbar: true })
  const lane = new BrowserNavigationLane()
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'electron', 'browser-provenance-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  window.contentView.addChildView(view)
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
  view.webContents.debugger.attach('1.3')
  const fileChooserSetup = view.webContents.debugger.sendCommand('Page.enable')
    .then(() => view.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true }))
  const denied = []
  const handleTrustedIntent = (event, payload) => {
    event.returnValue = false
    if (event.sender !== view.webContents) return
    event.returnValue = lane.noteTrustedNavigationIntent(payload?.url, { base: view.webContents.getURL() })
  }
  ipcMain.on('browser-page:user-navigation-intent', handleTrustedIntent)
  attachBrowserNavigationGuard({
    contents: view.webContents,
    tabId: 'tab-electron',
    lane,
    policy,
    onDenied: (error, context) => denied.push({ code: error.code, ...context })
  })

  try {
    await view.webContents.loadURL(`${sourceOrigin}/page`)
    await fileChooserSetup
    if (exerciseRealInput) {
      window.show()
      window.focus()
      view.webContents.focus()
      await wait(80)
    }
    policy.setActiveTab({ id: 'tab-electron', origin: sourceOrigin, visible: true })

    const blocked = async (reason, expression) => {
      const before = targetHits
      lane.markModel(reason)
      await view.webContents.executeJavaScript(expression, true).catch(() => {})
      await wait(250)
      assert.equal(targetHits, before, `${reason} reached an unauthorized origin`)
      assert.equal(new URL(view.webContents.getURL()).origin, sourceOrigin, `${reason} committed an unauthorized URL`)
    }

    const trustedClick = async selector => {
      if (exerciseRealInput) {
        view.webContents.focus()
        await view.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))', true)
      }
      const target = await view.webContents.executeJavaScript(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); const rect=element.getBoundingClientRect(); const tag=element.tagName.toLowerCase(); const submit=element.type==='submit'||element.type==='image'; return { x:rect.left+rect.width/2, y:rect.top+rect.height/2, url:String(tag==='a'?element.href:(submit?element.formAction:'')) } })()`, true)
      if (exerciseRealInput) {
        view.webContents.sendInputEvent({ type: 'mouseMove', x: target.x, y: target.y })
        await wait(20)
        view.webContents.sendInputEvent({ type: 'mouseDown', x: target.x, y: target.y, button: 'left', clickCount: 1 })
        view.webContents.sendInputEvent({ type: 'mouseUp', x: target.x, y: target.y, button: 'left', clickCount: 1 })
      } else {
        lane.noteTrustedInput()
        if (target.url) lane.noteTrustedNavigationIntent(target.url, { base: view.webContents.getURL() })
        await view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click(); true`, true)
      }
      await wait(60)
    }

    await blocked('click', `document.querySelector('#blocked-link').click(); true`)
    await blocked('form', `document.querySelector('#blocked-form').requestSubmit(); true`)
    await blocked('javascript-location', `location.href=${JSON.stringify(`${targetOrigin}/javascript-target`)}; true`)
    await blocked('window-open', `window.open(${JSON.stringify(`${targetOrigin}/popup-target`)}); true`)
    lane.markModel('redirect')
    const redirect = policy.modelNavigate(`${sourceOrigin}/redirect`, { tabId: 'tab-electron', base: view.webContents.getURL() })
    await view.webContents.loadURL(redirect.normalized).catch(() => {})
    await wait(250)
    assert.equal(targetHits, 0, '302 redirect reached the unauthorized target server')
    assert.ok(denied.filter(item => item.actor === 'model').length >= 5, JSON.stringify(denied))

    const modelTargetHits = targetHits
    lane.markUser('fixture-reset')
    await view.webContents.loadURL(`${sourceOrigin}/page`)
    policy.setActiveTab({ id: 'tab-electron', origin: sourceOrigin, visible: true })
    policy.grant(targetOrigin, {
      actions: ['read'],
      allowPrivateNetwork: true,
      by: 'user'
    })
    lane.markModel('delayed-after-stop')
    await view.webContents.executeJavaScript(`setTimeout(() => { location.href=${JSON.stringify(`${targetOrigin}/stale-model-timer`)} }, 250); true`, true)
    lane.cancelModel()
    policy.pauseModelControl()
    policy.resumeModelControl()
    policy.setActiveTab({ id: 'tab-electron', origin: sourceOrigin, visible: true })
    await trustedClick('#no-navigation')
    assert.equal(lane.snapshot().actor, 'cancelled-model', 'trusted input must not permanently downgrade a cancelled model document')
    assert.equal(lane.snapshot().reason, 'trusted-webcontents-input', 'real Electron input did not reach the provenance guard')
    lane.markModel('observe-after-resume')
    assert.equal(lane.snapshot().actor, 'cancelled-model', 'a new model action must not revive the stopped document epoch')
    if (exerciseRealInput) {
      const observedClick = await waitForDomClick(view.webContents, 'no-navigation')
      assert.deepEqual(observedClick, { trusted: true, id: 'no-navigation' }, `unexpected DOM click provenance: ${JSON.stringify(observedClick)}`)
    }
    await wait(1_200)
    assert.equal(targetHits, modelTargetHits, 'a stopped model timer revived after model control resumed')
    assert.equal(new URL(view.webContents.getURL()).origin, sourceOrigin, 'a stopped model timer committed after control resumed')
    assert.ok(denied.some(item => item.code === 'browser-action-cancelled'), `stopped model timer did not reach the guard: ${JSON.stringify(denied)}`)

    policy.pauseModelControl()
    assert.equal(policy.isModelStopped, true)
    assert.equal(policy.isStopped, false)
    await trustedClick('#blocked-link')
    await wait(200)
    assert.equal(targetHits, 1, `pausing model control must not disable direct user navigation: ${JSON.stringify(lane.snapshot())}`)
    assert.equal(lane.snapshot().actor, 'user', 'an exact trusted link commit must hand the new document to the user lane')

    process.stdout.write(`${JSON.stringify({ passed: true, modelTargetHits, userTargetHits: targetHits, fileChooserInterception: true, denied: denied.map(item => ({ code: item.code, kind: item.kind })) })}\n`)
  } finally {
    ipcMain.removeListener('browser-page:user-navigation-intent', handleTrustedIntent)
    window.hide()
    if (view.webContents.debugger.isAttached()) view.webContents.debugger.detach()
    if (!view.webContents.isDestroyed()) view.webContents.close()
    if (!window.isDestroyed()) window.destroy()
    await Promise.all([close(sourceServer), close(targetServer)])
    rmSync(profileRoot, { recursive: true, force: true })
  }
}

app.commandLine.appendSwitch('disable-gpu')
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch(error => {
    process.stderr.write(`${error?.stack || error}\n`)
    app.exit(1)
  })
