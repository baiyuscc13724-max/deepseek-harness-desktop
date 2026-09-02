const assert = require('node:assert/strict')
const http = require('node:http')
const { app, BrowserWindow } = require('electron')

const { ActionGate } = require('../../electron/bridge/browser-action-gate.cjs')
const { normalizePlaywrightParameters, runBrowserPlaywrightOperation } = require('../../electron/bridge/browser-codex-api.cjs')

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Browser Fixture</title><style>#concealed { display:none } #cover-wrap { position:relative; width:120px; height:40px } #covered, #cover { position:absolute; inset:0 } #cover { z-index:2; background:#fff }</style></head>
<body>
  <h1>Browser fixture</h1>
  <form id="save-form" action="/saved"><button id="save" type="submit">Save</button></form>
  <form id="replace-form" action="/replace"><button id="replace-save" type="submit">Replace Save</button></form>
  <button id="concealed" type="button">Concealed</button>
  <div inert><button id="inert-target" type="button">Inert</button></div>
  <fieldset disabled><button id="fieldset-disabled" type="button">Fieldset disabled</button></fieldset>
  <div id="cover-wrap"><button id="covered" type="button">Covered</button><div id="cover">Overlay</div></div>
  <button id="swap-target" type="button">Swap target</button>
  <button id="unknown-target" type="button">Unknown target</button>
  <label for="note">Note</label><input id="note" name="note" value="old">
  <label for="choice">Choice</label><select id="choice"><option value="a">A</option><option value="b">B</option><option value="c" selected>C</option></select>
  <label for="check">Check</label><input id="check" type="checkbox">
  <iframe id="inner-frame" src="/frame"></iframe>
  <script>
    window.fixture = { submitClicks: 0, submitTrusted: false, replaceClicks: 0, inputTrusted: false, selectTrusted: false, checkTrusted: false, swapOldClicks: 0, swapNewClicks: 0, unknownClicks: 0, unknownTrusted: false };
    document.querySelector('#save-form').addEventListener('submit', event => {
      event.preventDefault(); window.fixture.submitClicks += 1; window.fixture.submitTrusted = event.isTrusted;
    });
    document.querySelector('#replace-form').addEventListener('submit', event => {
      event.preventDefault(); window.fixture.replaceClicks += 1;
    });
    document.querySelector('#note').addEventListener('input', event => { window.fixture.inputTrusted = event.isTrusted; });
    document.querySelector('#choice').addEventListener('change', event => { window.fixture.selectTrusted = event.isTrusted; });
    document.querySelector('#check').addEventListener('change', event => { window.fixture.checkTrusted = event.isTrusted; });
    document.querySelector('#swap-target').addEventListener('click', () => { window.fixture.swapOldClicks += 1; });
    document.querySelector('#unknown-target').addEventListener('click', event => {
      window.fixture.unknownClicks += 1; window.fixture.unknownTrusted = event.isTrusted;
    });
  </script>
</body>
</html>`

const frameHtml = `<!doctype html><html><body><button id="frame-button" type="button">Frame button</button><script>
window.frameState = { clicks: 0, trusted: false };
document.querySelector('#frame-button').addEventListener('click', event => { window.frameState.clicks += 1; window.frameState.trusted = event.isTrusted; });
</script></body></html>`

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(server.address())
    })
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

function policyFromGate(gate, authorizations) {
  return {
    modelAction(input) {
      const decision = gate.gate({ ...input, authorizations })
      if (decision.verdict === 'allow') return { allowed: true, ...decision }
      return { allowed: false, requiresConfirmation: true, ...decision }
    }
  }
}

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url === '/frame' ? frameHtml : html)
  })
  const address = await listen(server)
  const origin = `http://127.0.0.1:${address.port}`
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  try {
    await window.loadURL(`${origin}/`)
    if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach('1.3')
    let confirmationSequence = 0
    const gate = new ActionGate({ idFactory: () => `confirm-${++confirmationSequence}` })
    gate.setActiveTab({ id: 'tab-1', origin, visible: false, available: true })
    const authorizations = {
      authorized: (candidate, action) => candidate === origin && ['read', 'click', 'type', 'submit'].includes(action),
      origins: () => [origin],
      privateOrigins: () => [origin],
      allowPublicOrigins: true
    }
    const securityPolicy = policyFromGate(gate, authorizations)
    const common = { webContents: window.webContents, origin, tabId: 'tab-1', securityPolicy }

    const snapshot = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'domSnapshot' } })
    assert.equal(snapshot.operation, 'domSnapshot')
    assert.match(snapshot.snapshot.title, /Browser Fixture/u)
    assert.ok(snapshot.snapshot.nodes.some(node => /Browser fixture/u.test(`${node.name} ${node.text}`)))

    for (const parameters of [
      { operation: 'count', selector: 'input[value^="a"]' },
      { operation: 'count', selector: 'input[name=csrf]' },
      { operation: 'getAttribute', selector: '#note', attribute: 'data-auth-token' },
      { operation: 'getAttribute', selector: '#note', attribute: 'value' }
    ]) {
      assert.throws(() => normalizePlaywrightParameters(parameters), error => ['browser-playwright-selector-unsafe', 'browser-playwright-attribute-forbidden'].includes(error.code))
    }

    await assert.rejects(
      runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#concealed' } }),
      error => error.code === 'browser-playwright-element-not-actionable' || /不可见|不可交互/u.test(error.message)
    )
    await assert.rejects(
      runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#covered' } }),
      error => error.code === 'browser-playwright-element-not-actionable' || /遮挡/u.test(error.message)
    )
    for (const selector of ['#inert-target', '#fieldset-disabled']) {
      await assert.rejects(
        runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector } }),
        error => ['browser-playwright-element-not-actionable', 'browser-playwright-element-disabled'].includes(error.code)
      )
    }

    const pending = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#save' } })
    assert.equal(pending.requiresConfirmation, true)
    assert.equal(pending.confirmationId, 'confirm-1')
    assert.equal((await window.webContents.executeJavaScript('window.fixture.submitClicks')), 0)
    gate.confirm('confirm-1', { by: 'user' })
    const submitted = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#save', confirmation_id: 'confirm-1' } })
    assert.equal(submitted.acted, true)
    const afterSubmit = await window.webContents.executeJavaScript('window.fixture')
    assert.equal(afterSubmit.submitClicks, 1)
    assert.equal(afterSubmit.submitTrusted, true)
    await assert.rejects(
      runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#save', confirmation_id: 'confirm-1' } }),
      error => error.code === 'confirmation-used'
    )
    assert.equal((await window.webContents.executeJavaScript('window.fixture.submitClicks')), 1)

    // Confirmations are bound to Chromium's unforgeable backend node identity,
    // not only to caller-controlled selector/metadata. An identical replacement
    // must not be able to consume an earlier user's confirmation.
    const replacementPending = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#replace-save' } })
    assert.equal(replacementPending.confirmationId, 'confirm-2')
    await window.webContents.executeJavaScript(`(() => {
      const old = document.querySelector('#replace-save');
      old.replaceWith(old.cloneNode(true));
    })()`)
    gate.confirm('confirm-2', { by: 'user' })
    await assert.rejects(
      runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#replace-save', confirmation_id: 'confirm-2' } }),
      error => error.code === 'confirmation-mismatch'
    )
    assert.equal((await window.webContents.executeJavaScript('window.fixture.replaceClicks')), 0)

    const filled = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'fill', selector: '#note', text: 'hello' } })
    assert.equal(filled.acted, true)
    const inputState = await window.webContents.executeJavaScript('({ value: document.querySelector("#note").value, trusted: window.fixture.inputTrusted })')
    assert.deepEqual(inputState, { value: 'hello', trusted: true })

    const selected = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'selectOption', selector: '#choice', value: 'b' } })
    assert.equal(selected.value, 'b')
    const selectedState = await window.webContents.executeJavaScript('({ value: document.querySelector("#choice").value, trusted: window.fixture.selectTrusted })')
    assert.deepEqual(selectedState, { value: 'b', trusted: true })
    const checked = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'setChecked', selector: '#check', checked: true } })
    assert.equal(checked.checked, true)
    const checkedState = await window.webContents.executeJavaScript('({ value: document.querySelector("#check").checked, trusted: window.fixture.checkTrusted })')
    assert.deepEqual(checkedState, { value: true, trusted: true })
    const frameClicked = await runBrowserPlaywrightOperation({ ...common, parameters: { operation: 'click', selector: '#frame-button', frame_selector: '#inner-frame' } })
    assert.equal(frameClicked.acted, true)
    const frameState = await window.webContents.executeJavaScript('document.querySelector("#inner-frame").contentWindow.frameState')
    assert.deepEqual(frameState, { clicks: 1, trusted: true })

    const swappingPolicy = {
      async modelAction() {
        await window.webContents.executeJavaScript(`(() => {
          const old = document.querySelector('#swap-target');
          const replacement = old.cloneNode(true);
          replacement.addEventListener('click', () => { window.fixture.swapNewClicks += 1; });
          old.replaceWith(replacement);
        })()`)
        return { allowed: true }
      }
    }
    await assert.rejects(
      runBrowserPlaywrightOperation({ ...common, securityPolicy: swappingPolicy, parameters: { operation: 'click', selector: '#swap-target' } }),
      error => error.code === 'browser-playwright-binding-stale' || /绑定的元素已失效/u.test(error.message)
    )
    const swapState = await window.webContents.executeJavaScript('window.fixture')
    assert.equal(swapState.swapOldClicks, 0)
    assert.equal(swapState.swapNewClicks, 0)

    // A navigation/staleness error detected immediately after trusted input is
    // dispatched is never reported as an ordinary retryable error. The click
    // may already have happened, so the host must fence it as unknown outcome.
    const debuggerClient = window.webContents.debugger
    const ownSendCommand = Object.getOwnPropertyDescriptor(debuggerClient, 'sendCommand')
    const originalSendCommand = debuggerClient.sendCommand.bind(debuggerClient)
    let mouseReleased = false
    let checksAfterRelease = 0
    Object.defineProperty(debuggerClient, 'sendCommand', {
      configurable: true,
      writable: true,
      value: async (method, parameters) => {
        const result = await originalSendCommand(method, parameters)
        if (method === 'Input.dispatchMouseEvent' && parameters?.type === 'mouseReleased') mouseReleased = true
        return result
      }
    })
    try {
      await assert.rejects(
        runBrowserPlaywrightOperation({
          ...common,
          securityPolicy: { modelAction: async () => ({ allowed: true }) },
          assertCurrent: () => {
            if (mouseReleased && ++checksAfterRelease >= 2) throw Object.assign(new Error('stale after trusted input'), { code: 'browser-navigation-stale' })
          },
          parameters: { operation: 'click', selector: '#unknown-target' }
        }),
        error => error.code === 'browser-outcome-unknown' && error.originalCode === 'browser-navigation-stale'
      )
    } finally {
      if (ownSendCommand) Object.defineProperty(debuggerClient, 'sendCommand', ownSendCommand)
      else delete debuggerClient.sendCommand
    }
    const unknownState = await window.webContents.executeJavaScript('window.fixture')
    assert.equal(unknownState.unknownClicks, 1)
    assert.equal(unknownState.unknownTrusted, true)

    process.stdout.write(`${JSON.stringify({ passed: true, snapshotNodes: snapshot.snapshot.nodes.length, confirmationReplay: 'confirmation-used', replacementReplay: 'confirmation-mismatch', trustedClick: afterSubmit.submitTrusted, trustedInput: inputState.trusted, trustedSelect: selectedState.trusted, trustedCheck: checkedState.trusted, trustedFrame: frameState.trusted, exactBinding: 'browser-playwright-binding-stale', unknownOutcome: 'browser-outcome-unknown' })}\n`)
  } finally {
    try { if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach() } catch {}
    window.destroy()
    await close(server)
    app.quit()
  }
}).catch(error => {
  console.error(error)
  app.exit(1)
})
