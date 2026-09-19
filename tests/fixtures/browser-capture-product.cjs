// Actual Chromium screenshots/crops; deterministic native/CDP await injection
// uses only this hidden fixture's own webContents, never an installed browser.
const { BrowserWindow, session, nativeImage } = require('electron')
const { randomUUID } = require('node:crypto')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { BrowserOperationCoordinator, runBrowserOperation } = require('../../electron/bridge/browser-operation-coordinator.cjs')
const { isSensitiveText } = require('../../electron/bridge/browser-action-gate.cjs')
const { redact } = require('../../electron/bridge/memory-censor.cjs')
const { safeUrl } = require('../../electron/bridge/browser-diagnostics.cjs')
module.exports = async function captureTests(main, extract, results, { probeCompositor = false } = {}) {
  const ownSession = session.fromPartition('capture-' + randomUUID())
  await ownSession.protocol.handle('https', () => new Response('<!doctype html><style>body{margin:0;height:2000px;background:#ff00ff}#frame{position:absolute;left:80px;top:1000px;width:240px;height:160px;background:rgb(0,170,85)}</style><video id="frame" width="240" height="160"></video>', { headers: { 'content-type': 'text/html' } }))
  const window = new BrowserWindow({ show: false, width: 800, height: 600, useContentSize: true, webPreferences: { session: ownSession, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  try {
    const wc = window.webContents
    await window.loadURL('https://capture-fixture.invalid/')
    wc.debugger.attach('1.3')
    await wc.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=240;c.height=160;const x=c.getContext('2d');x.fillStyle='rgb(0,170,85)';x.fillRect(0,0,240,160);document.querySelector('#frame').poster=c.toDataURL();const t=document.querySelector('#frame').addTextTrack('captions','English','en');t.mode='hidden';t.addCue(new VTTCue(0,10,'Controlled caption'));t.addCue(new VTTCue(11,20,'password=do-not-return'));scrollTo(0,700)})()`)
    let nativeMode = 'fail', nativeHook = null, cdpHook = null, cdpCalls = 0, nativeCalls = 0, controlledCdp = false
    const cleanImage = nativeImage.createFromBitmap(Buffer.from([85,170,0,255,85,170,0,255,85,170,0,255,85,170,0,255]), { width: 2, height: 2 })
    const view = { webContents: {
      getURL: () => wc.getURL(), isDestroyed: () => wc.isDestroyed(),
      executeJavaScript: (...args) => wc.executeJavaScript(...args),
      capturePage: async (...args) => { nativeCalls += 1; if (nativeHook) await nativeHook(); if (nativeMode === 'actual') return wc.capturePage(...args); if (nativeMode === 'clean') return cleanImage; if (nativeMode === 'empty') return nativeImage.createEmpty(); if (nativeMode === 'unknown') throw new Error('unrelated native failure'); try { if (!controlledCdp) await wc.capturePage(...args) } catch (error) { if (!/UnknownVizError|VizSentEmptyBitmap|Current display surface|Frame Gone/.test(error.message)) throw error } throw new Error('UnknownVizError') },
      debugger: { isAttached: () => wc.debugger.isAttached(), sendCommand: async (...args) => { cdpCalls += 1; const result = controlledCdp ? { data: cleanImage.toPNG().toString('base64') } : await wc.debugger.sendCommand(...args); if (cdpHook) await cdpHook(); return result } }
    } }
    const tab = { available: true, navigationGeneration: 0 }
    const ctx = vm.createContext({ Buffer, console, nativeImage, runBrowserOperation: async (...args) => { try { return await runBrowserOperation(...args) } catch (error) { console.log(JSON.stringify({ captureOperationFailure: { code: error.code, message: error.message } })); throw error } }, isSensitiveText, redactSensitiveText: redact, safeBrowserDiagnosticUrl: safeUrl,
      browserTabs: new Map([['capture', tab]]), activeBrowserTabId: 'capture', browserView: view, browserOperations: new BrowserOperationCoordinator(), browserSecurityPolicy: { isModelStopped: false },
      requireSharedComputerUseForBrowser() { if (ctx.browserSecurityPolicy.isModelStopped) throw Object.assign(new Error('stopped'), { code: 'stopped' }) }
    })
    vm.runInContext(['safeBrowserText', 'browserReadonlyAssertion', 'captureBrowserSurfaceForModel', 'captureBrowserForModel', 'inspectBrowserMediaForModel', 'captureBrowserMediaFrameForModel'].map(name => extract(main, name)).join('\n'), ctx)
    const guard = () => ctx.browserReadonlyAssertion(view, 'capture', ctx.browserOperations.modelTicket())
    const rect = () => wc.executeJavaScript(`(()=>{const r=document.querySelector('#frame').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`)
    function green(image) {
      const size = image.getSize(), bytes = image.toBitmap(), offset = ((Math.floor(size.height/2)*size.width)+Math.floor(size.width/2))*4
      assert.ok(Math.abs(bytes[offset]-85)<8 && Math.abs(bytes[offset+1]-170)<8 && bytes[offset+2]<8, JSON.stringify({size,pixel:[...bytes.subarray(offset,offset+4)]}))
    }
    const info = await ctx.inspectBrowserMediaForModel(view)
    assert.equal(info.count, 1); assert.doesNotMatch(JSON.stringify(info), /do-not-return/); assert.match(JSON.stringify(info), /Controlled caption/)
    results.push('mediaInfo: actual textTrack cues bounded and sensitive cue redacted')
    nativeMode = 'actual'
    const poster = await ctx.captureBrowserMediaFrameForModel(view, { time_seconds: 0 }, guard())
    assert.equal(poster.currentTime, 0); assert.ok(['native-surface', 'cdp-surface'].includes(poster.captureEngine)); green(nativeImage.createFromDataURL(poster.image))
    results.push(`mediaFrame currentTime0: real visible poster crop via ${poster.captureEngine}, not decoded-video seeking proof`)
    // Fence cases deliberately use controlled native/CDP replies with real DOM
    // changes. They are NOT a claim that CDP compositor recovery succeeded.
    controlledCdp = true
    nativeMode = 'clean'; let before = cdpCalls
    const nativeResult = await ctx.captureBrowserSurfaceForModel(view, null, guard())
    assert.equal(nativeResult.captureEngine, 'native-surface'); assert.equal(cdpCalls, before)
    results.push('native branch: controlled successful native image needs no CDP fallback')
    nativeMode = 'unknown'; before = cdpCalls
    await assert.rejects(ctx.captureBrowserSurfaceForModel(view, null, guard()), /unrelated native failure/)
    assert.equal(cdpCalls, before)
    results.push('unknown native error is not blindly retried')
    for (const stage of ['native', 'cdp']) for (const drift of ['stop', 'navigation', 'tab']) {
      nativeMode = stage === 'native' ? 'clean' : 'fail'; nativeHook = null; cdpHook = null
      ctx.browserOperations = new BrowserOperationCoordinator(); ctx.browserSecurityPolicy = { isModelStopped: false }; ctx.activeBrowserTabId = 'capture'
      const mutate = async () => { if (drift === 'stop') { ctx.browserSecurityPolicy.isModelStopped = true; ctx.browserOperations.cancelModelActions() } if (drift === 'navigation') tab.navigationGeneration += 1; if (drift === 'tab') ctx.activeBrowserTabId = 'other' }
      if (stage === 'native') nativeHook = mutate; else cdpHook = mutate
      before = cdpCalls
      await assert.rejects(ctx.captureBrowserSurfaceForModel(view, await rect(), guard()), error => ['stopped', 'browser-action-cancelled', 'browser-reference-stale', 'tab-unavailable'].includes(error.code))
      assert.equal(cdpCalls, before + (stage === 'cdp' ? 1 : 0))
      results.push(`${stage} await ${drift}: discard late frame and no new fallback`)
    }
    nativeMode = 'fail'; nativeHook = null; cdpHook = null; ctx.browserOperations = new BrowserOperationCoordinator(); ctx.browserSecurityPolicy = { isModelStopped: false }; ctx.activeBrowserTabId = 'capture'
    const inject = () => wc.executeJavaScript(`(()=>{const e=document.createElement('input');e.id='password';e.type='password';e.style='position:fixed;left:90px;top:310px;width:100px;height:20px';document.body.appendChild(e)})()`)
    nativeHook = inject; before = cdpCalls
    await assert.rejects(ctx.captureBrowserSurfaceForModel(view, await rect(), guard()), error => error.code === 'sensitive-screenshot-blocked')
    assert.equal(cdpCalls, before)
    results.push('sensitive input appearing during native await blocks fallback')
    await wc.executeJavaScript(`document.querySelector('#password').remove()`)
    nativeHook = null; cdpHook = inject
    await assert.rejects(ctx.captureBrowserSurfaceForModel(view, await rect(), guard()), error => error.code === 'sensitive-screenshot-blocked')
    results.push('sensitive input appearing during CDP await discards captured frame')
    await wc.executeJavaScript(`document.querySelector('#password').remove()`)
    cdpHook = () => wc.executeJavaScript('scrollBy(0,1)')
    await assert.rejects(ctx.captureBrowserSurfaceForModel(view, await rect(), guard()), error => error.code === 'browser-reference-stale')
    results.push('scroll during CDP await discards old viewport crop')
    const lateTextFailures = []
    const injectText = () => wc.executeJavaScript(`(()=>{const e=document.createElement('div');e.id='late-text';e.textContent='password=fixture-late-secret';e.style='position:fixed;left:90px;top:310px;color:black;background:white';document.body.appendChild(e)})()`)
    for (const stage of ['native-success', 'native-failure', 'cdp']) {
      nativeMode = stage === 'native-success' ? 'clean' : 'fail'; nativeHook = stage === 'cdp' ? null : injectText; cdpHook = stage === 'cdp' ? injectText : null
      try {
        await assert.rejects(ctx.captureBrowserForModel(view, {}, guard()), error => error.code === 'sensitive-screenshot-blocked')
        results.push(`${stage}: sensitive plain text appearing during await blocks full screenshot`)
      } catch (error) { lateTextFailures.push({ stage, error: error.message }) }
      finally { await wc.executeJavaScript(`document.querySelector('#late-text')?.remove()`) }
    }
    assert.deepEqual(lateTextFailures, [], 'late sensitive plain text must not be returned as an image')
    // Preserve the earlier compositor probe as an explicit optional diagnostic.
    // It is not a new scope/ship gate for the original browser-desktop task.
    if (!probeCompositor) return
    controlledCdp = false; nativeMode = 'fail'; nativeHook = null; cdpHook = null
    for (const dpr of [1, 2]) {
      await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: dpr, mobile: false })
      await wc.executeJavaScript('scrollTo(0,700)')
      const crop = await rect(), before = cdpCalls
      console.log(JSON.stringify({ captureFixture: { dpr, crop, viewport: await wc.executeJavaScript('({width:innerWidth,height:innerHeight,scrollX,scrollY,visibility:document.visibilityState})') } }))
      const result = await ctx.captureBrowserSurfaceForModel(view, crop, guard())
      assert.equal(result.captureEngine, 'cdp-surface'); assert.equal(cdpCalls, before + 1)
      green(result.image)
      const size = result.image.getSize()
      assert.equal(size.width / size.height, 240 / 160)
      assert.ok(size.width >= 240 && size.width <= 480)
      results.push(`actual CDP viewport crop: DPR${dpr} with scroll700 green center ${size.width}x${size.height}`)
    }
    await wc.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  } finally { window.destroy() }
}
