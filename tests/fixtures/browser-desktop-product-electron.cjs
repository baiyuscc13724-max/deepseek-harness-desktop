// Isolated real Electron DOM + actual main/renderer functions. Host control,
// native file picker, IPC replies are explicit doubles; never an installed GUI.
const { app, BrowserWindow, session } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const repo = path.resolve(__dirname, '../..')
const { BrowserOperationCoordinator, runBrowserOperation } = require(path.join(repo, 'electron/bridge/browser-operation-coordinator.cjs'))
const temp = process.argv[2]
if (!temp) throw new Error('Use the Node parent runner for isolated profile lifecycle')
app.setPath('userData', temp)
app.on('window-all-closed', () => {})
const results = []
function extract(source, name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'))
  assert.ok(start >= 0, name)
  const tail = source.slice(start), next = tail.slice(1).search(/^(?:(?:async )?function |class )/m)
  return next < 0 ? tail : tail.slice(0, next + 1)
}

async function uploadTests(main) {
  const file = path.join(temp, 'chosen.txt')
  await fs.writeFile(file, 'isolated chosen bytes')
  const ownSession = session.fromPartition('upload-' + randomUUID())
  await ownSession.protocol.handle('https', () => new Response('<!doctype html><input id="original" type="file"><script>window.events=[];document.addEventListener("change",e=>events.push(e.target.id));</script>', { headers: { 'content-type': 'text/html' } }))
  const win = new BrowserWindow({ show: false, webPreferences: { session: ownSession, contextIsolation: true, nodeIntegration: false, sandbox: true } })
  try {
    const wc = win.webContents
    await wc.loadURL('https://upload-fixture.invalid/')
    const view = { webContents: wc }, tab = { view, available: true, navigationGeneration: 0 }
    wc.debugger.attach('1.3')
    let hook = '', mutated = false, stopped = false, confirmed = true, pickers = 0
    async function replace() {
      if (mutated) return
      mutated = true
      await wc.executeJavaScript(`{const old=document.querySelector('input');const next=old.cloneNode(true);next.id='replacement';old.replaceWith(next);}`)
    }
    const ctx = vm.createContext({ console, Buffer, Set, Map, URL, randomUUID, path, mainWindow: win, MAX_UPLOAD_BYTES: 32 * 1024 * 1024,
      browserView: view, browserState: { origin: 'https://upload-fixture.invalid' }, activeBrowserTabId: 'fixture', browserTabs: new Map([['fixture', tab]]),
      browserTransferTail: Promise.resolve(), browserSidebarVisible: false, browserContentVisible: false, browserOperations: new BrowserOperationCoordinator(),
      browserSecurityPolicy: { isModelStopped: false, modelAction() { return { allowed: confirmed, requiresConfirmation: !confirmed } }, effectiveAuthorizations: () => ({ authorized: () => !stopped }) },
      requireSharedComputerUseForBrowser() { if (stopped) throw Object.assign(new Error('shared stopped'), { code: 'stopped' }) },
      requireBrowserForModel() { if (stopped) throw new Error('stopped'); return { view, origin: 'https://upload-fixture.invalid', tabId: 'fixture', ticket: ctx.browserOperations.modelTicket(), url: wc.getURL() } },
      markBrowserModelNavigation() {}, runBrowserOperation, safeBrowserText: value => value, surfacePendingBrowserConfirmation: async decision => decision,
      dialog: { async showOpenDialog() { pickers += 1; await Promise.resolve(); if (hook === 'picker') await replace(); if (hook === 'stop') { stopped = true; ctx.browserOperations.cancelModelActions() } if (hook === 'navigation') tab.navigationGeneration += 1; if (hook === 'tab') ctx.activeBrowserTabId = 'other'; return { canceled: hook === 'cancel', filePaths: [file] } } },
      open: async (...args) => { const handle = await fs.open(...args); return {
        stat: async () => { const stat = await handle.stat(); if (hook === 'stat') await replace(); return stat },
        readFile: async () => { const bytes = await handle.readFile(); if (hook === 'read') await replace(); return bytes },
        close: () => handle.close()
      } }
    })
    const names = ['runBrowserRefScript', 'observeBrowserForModel', 'assertBrowserReference', 'browserElementMetadata', 'assertBrowserTransferBinding', 'withBrowserTransferLock', 'uploadBrowserFileInteractively', 'modelBrowserAction']
    vm.runInContext(names.map(name => extract(main, name)).join('\n'), ctx)
    const actualRun = ctx.runBrowserRefScript
    ctx.runBrowserRefScript = async (view, code) => { if (hook === 'dispatch' && code.includes('new DataTransfer')) await replace(); return actualRun(view, code) }
    for (const mode of ['positive', 'picker', 'stat', 'read', 'dispatch', 'stop', 'navigation', 'tab', 'cancel', 'confirmation']) {
      hook = ''; mutated = false; stopped = false; confirmed = true; ctx.activeBrowserTabId = 'fixture'; ctx.browserOperations = new BrowserOperationCoordinator()
      await wc.executeJavaScript(`document.body.innerHTML='<input id="original" type="file">';window.events=[];`)
      tab.modelObservation = null
      const first = await ctx.observeBrowserForModel(), ref = first.interactive[0].ref
      const metadata = await ctx.browserElementMetadata(view, ref)
      assert.equal(metadata.type, 'file'); assert.equal(metadata.selector, 'opaque-ref:' + ref); assert.equal('backendNodeId' in metadata, false)
      hook = mode; confirmed = mode !== 'confirmation'; const beforePicker = pickers
      if (['picker', 'stat', 'read', 'dispatch', 'stop', 'navigation', 'tab'].includes(mode)) {
        await assert.rejects(ctx.modelBrowserAction({ action: 'upload', ref }), error => mode === 'navigation' ? error.message === '操作期间页面已导航，传输已取消。' : mode === 'tab' ? error.message === '操作期间活动标签已变化，传输已取消。' : ['browser-reference-stale', 'stopped', 'browser-action-cancelled'].includes(error.code))
      } else {
        const result = await ctx.modelBrowserAction({ action: 'upload', ref })
        if (mode === 'positive') assert.equal(result.uploaded, true)
        if (mode === 'cancel') assert.equal(result.cancelled, true)
        if (mode === 'confirmation') { assert.equal(result.requiresConfirmation, true); assert.equal(pickers, beforePicker) }
      }
      const actual = await wc.executeJavaScript(`(async()=>({id:document.querySelector('input').id,count:document.querySelector('input').files.length,text:document.querySelector('input').files[0]?await document.querySelector('input').files[0].text():'',events:window.events}))()`)
      if (mode === 'positive') { assert.equal(actual.count, 1); assert.equal(actual.text, 'isolated chosen bytes'); assert.deepEqual(actual.events, ['original']) }
      else { assert.equal(actual.count, 0); assert.deepEqual(actual.events, []) }
      if (['picker', 'stat', 'read', 'dispatch'].includes(mode)) { assert.equal(mutated, true); assert.equal(actual.id, 'replacement') }
      results.push('actual upload: ' + mode)
    }
    hook = ''; confirmed = true; stopped = false; ctx.activeBrowserTabId = 'fixture'
    const observation = await ctx.observeBrowserForModel(); await ctx.observeBrowserForModel()
    await assert.rejects(ctx.modelBrowserAction({ action: 'upload', ref: observation.interactive[0].ref }), error => error.code === 'browser-reference-stale')
    results.push('actual upload: old observation rejected')
  } finally { win.destroy() }
}

async function sidebarTests() {
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, useContentSize: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'sidebar-' + randomUUID() } })
  try {
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
    let html = await fs.readFile(path.join(repo, 'renderer/index.html'), 'utf8')
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*>/gi, '').replace(/<webview\b[^>]*>[\s\S]*?<\/webview>/gi, '<div id="runtimeView"></div>')
    const styles = await fs.readFile(path.join(repo, 'renderer/styles.css'), 'utf8') + '\n' + await fs.readFile(path.join(repo, 'renderer/right-workspace.css'), 'utf8')
    html = html.replace('</head>', '<style>' + styles + '</style></head>')
    const documentPath = path.join(temp, 'sidebar.html'); await fs.writeFile(documentPath, html); await win.loadFile(documentPath)
    const run = code => win.webContents.executeJavaScript(code)
    win.webContents.debugger.attach('1.3')
    const enter = async () => { await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' }); await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
    await run(`window.calls=[];window.pending=[];window.state={visible:true,url:'',activeTabId:'',tabs:[],control:{active:true,granted:true},recovery:{state:'not-started',canBootstrap:true},downloads:[]};
      window.delay=()=>new Promise(r=>setTimeout(r,20));window.push=value=>{state={...state,...value};window.onState(state)};
      window.desktopHarness={getComputerUseState:async()=>({}),getBrowserState:async()=>state,onBrowserState:cb=>window.onState=cb,
        navigateBrowser:url=>{calls.push(['navigate',url]);return new Promise((resolve,reject)=>pending.push({resolve,reject}));},
        stopBrowser:async()=>{calls.push(['stop']);return {...state,loading:false}},
        switchBrowserTab:async id=>{calls.push(['switch',id]);return {...state,activeTabId:id}},
        closeBrowserTab:async id=>{calls.push(['close',id]);const tabs=state.tabs.filter(t=>t.id!==id);return {...state,tabs,activeTabId:tabs[0]?.id||''}},
        newBrowserTab:async()=>{calls.push(['new']);return {...state,tabs:[],activeTabId:''}},
        setBrowserWideMode:async wide=>{calls.push(['wide',wide]);return {wideMode:wide,url:'https://stale.invalid/',activeTabId:'stale'}},
        setBrowserPanelWidth:async width=>({panelWidth:width}),setBrowserContentVisible:async()=>({}),setBrowserVisible:async visible=>({...state,visible}),searchBrowserHistory:async()=>({items:[]})};
      document.querySelector('#browserSidebar').classList.add('is-open');void 0;`)
    await run(await fs.readFile(path.join(repo, 'renderer/browser-sidebar.js'), 'utf8'))
    await run('delay()')
    assert.equal(await run(`document.querySelector('#browserAddress').value`), '')
    await run(`window.address=document.querySelector('#browserAddress');address.focus();address.value='https://first.invalid/';address.dispatchEvent(new Event('input',{bubbles:true}));address.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));address.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));`)
    await enter()
    assert.equal(await run('calls.length'), 0)
    await run(`address.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));`)
    await enter(); await enter()
    assert.equal(await run(`calls.filter(c=>c[0]==='navigate').length`), 1)
    await run(`address.value='https://new-draft.invalid/';address.dispatchEvent(new Event('input',{bubbles:true}));push({activeTabId:'one',tabs:[{id:'one',url:'https://first.invalid/',title:'One',loading:true}]});document.querySelector('#browserWideMode').click();`)
    await run('delay()')
    assert.equal(await run('address.value'), 'https://new-draft.invalid/')
    await run(`document.querySelector('#browserAddressForm').requestSubmit();`)
    assert.equal(await run(`calls.filter(c=>c[0]==='navigate').length`), 1, 'width replies do not unlock pending navigate')
    await run(`pending.shift().resolve({...state,loading:false,tabs:[{id:'one',url:'https://first.invalid/',title:'One',loading:false}]});`)
    await run('delay()')
    assert.equal(await run('address.value'), 'https://new-draft.invalid/')
    results.push('sidebar: composition, duplicate Enter, draft preservation and width reply fencing')
    await run(`address.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`)
    assert.equal(await run('address.value'), 'https://first.invalid/')
    await run(`push({tabs:[{id:'one',url:'https://first.invalid/',title:'One'},{id:'two',url:'https://second.invalid/',title:'Two'}],activeTabId:'one'});document.querySelector('#browserTabs [role=tab]').focus();`)
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`)
    assert.equal(await run(`document.activeElement.getAttribute('data-tab-id')`), 'two')
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`); await run('delay()')
    assert.equal(await run(`calls.filter(c=>c[0]==='switch').at(-1)[1]`), 'two')
    await run(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));`); await run('delay()')
    assert.equal(await run(`calls.filter(c=>c[0]==='close').at(-1)[1]`), 'two')
    results.push('sidebar: Escape address restoration and real DOM tab keyboard switch/close')
    await run(`address.focus();address.value='https://failure.invalid/';address.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#browserAddressForm').requestSubmit();pending.shift().reject(new Error('private internal failure https://user:secret@private.invalid/'));`); await run('delay()')
    const error = await run(`({role:document.querySelector('#browserStatusText').getAttribute('role'),text:document.querySelector('#browserStatusText').textContent})`)
    assert.equal(error.role, 'alert'); assert.doesNotMatch(error.text, /secret|private\.invalid|internal failure/)
    await run(`document.querySelector('#browserReload').click();`)
    assert.equal(await run(`calls.filter(c=>c[0]==='navigate').at(-1)[1]`), 'https://failure.invalid/')
    await run(`document.querySelector('#browserStop').click();`); await run('delay()')
    await run(`pending.shift().resolve({...state,url:'https://stale-completion.invalid/',activeTabId:'stale',tabs:[{id:'stale',url:'https://stale-completion.invalid/',title:'Stale'}]});`); await run('delay()')
    assert.doesNotMatch(await run('address.value'), /stale-completion/)
    results.push('sidebar: redacted failure, explicit retry and Stop invalidates pending navigation receipt')
    for (const width of [360, 1000]) {
      win.setContentSize(width, 800); await run('delay()')
      const box = await run(`(()=>{const p=document.querySelector('#browserSidebar'),a=address.getBoundingClientRect();return {width:innerWidth,scroll:document.documentElement.scrollWidth,addressLeft:a.left,addressRight:a.right,panel:p.getBoundingClientRect().width}})()`)
      assert.ok(box.scroll <= width, JSON.stringify(box)); assert.ok(box.addressLeft >= 0 && box.addressRight <= width, JSON.stringify(box))
    }
    results.push('sidebar: 360/1000 real CSS address within viewport')
  } finally { win.destroy() }
}

async function main() {
  await app.whenReady()
  const source = await fs.readFile(path.join(repo, 'electron/main.cjs'), 'utf8')
  const hash = text => createHash('sha256').update(text).digest('hex')
  const captureFunctions = ['browserReadonlyAssertion', 'captureBrowserSurfaceForModel', 'captureBrowserForModel', 'inspectBrowserMediaForModel', 'captureBrowserMediaFrameForModel']
  console.log(JSON.stringify({ sourceEvidence: { mainSha256: hash(source), captureFunctions: Object.fromEntries(captureFunctions.map(name => [name, hash(extract(source, name))])) } }))
  await uploadTests(source)
  await require('./browser-readable-product.cjs')(results)
  await require('./browser-capture-product.cjs')(source, extract, results, { probeCompositor: process.argv.includes('--media-compositor') })
  await sidebarTests()
  console.log(JSON.stringify({ ok: true, cases: results.length, results, engine: { electron: process.versions.electron, chrome: process.versions.chrome }, limitations: ['not installed 11353 GUI', 'Host picker/authorization and sidebar IPC are doubles', 'UIA native Windows adapter is covered separately by Node fixtures', 'controlled image replies verify safety fences, not compositor pixels', 'DPR/scroll compositor probe is optional --media-compositor; offscreen integration belongs to later acceptance'] }, null, 2))
}
main().then(() => app.exit(0)).catch(error => { console.error(JSON.stringify({ ok: false, completedCases: results }, null, 2)); console.error(error.stack); app.exit(1) })
