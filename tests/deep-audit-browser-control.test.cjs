'use strict'
// One owned file: Node unit fixtures + opt-in isolated Electron production DOM behavior.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const { normalizePlaywrightParameters, runBrowserPlaywrightOperation } = require('../electron/bridge/browser-codex-api.cjs')

async function sidebarMicrofeatures(BrowserWindow) {
  const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{partition:'deep-sidebar-'+Date.now(),sandbox:true,contextIsolation:true,nodeIntegration:false}})
  try {
    win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true}))
    const html=fs.readFileSync(path.join(root,'renderer/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'').replace(/<webview\b[^>]*>[\s\S]*?<\/webview>/gi,'<div id="runtimeView"></div>')
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html))
    const run=code=>win.webContents.executeJavaScript(code)
    const act=async code=>{try{await run('(()=>{'+code+';})()');await run('new Promise(r=>setTimeout(r,0))')}catch(error){throw new Error('Sidebar fixture action failed: '+code,{cause:error})}}
    await run(`window.calls=[];window.errors=[];window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));window.historyRows=[{id:'h1',url:'https://history-fixture.invalid',title:''}];window.historyDeferred=[];
      window.state={visible:true,url:'https://audit-fixture.invalid/',activeTabId:'one',tabs:[{id:'one',title:'One',url:'https://audit-fixture.invalid/'}],canGoBack:true,canGoForward:true,hasSiteData:true,origin:'https://audit-fixture.invalid',downloads:[]};window.push=patch=>{state={...state,...patch};onState(state)};
      window.record=(name,value)=>{calls.push([name,value]);return state};window.desktopHarness={getComputerUseState:async()=>({}),getBrowserState:async()=>state,onBrowserState:cb=>window.onState=cb,onComputerUseAuthorization:cb=>window.onAuth=cb,
        navigateBrowser:async value=>record('navigate',value),browserBack:async()=>record('back'),browserForward:async()=>record('forward'),reloadBrowser:async()=>record('reload'),stopBrowser:async()=>record('stop'),
        setBrowserContentVisible:async visible=>record('content',visible),setBrowserVisible:async visible=>{record('visible',visible);return {...state,visible}},setBrowserWideMode:async wide=>({wideMode:wide}),setBrowserPanelWidth:async width=>{record('width',width);return {panelWidth:width}},
        searchBrowserHistory:async query=>{record('historySearch',query);if(window.deferHistory)return new Promise(resolve=>historyDeferred.push({query,resolve}));return {entries:historyRows}},removeBrowserHistory:async id=>{record('historyRemove',id);historyRows=[]},openBrowserHistory:async id=>record('historyOpen',id),clearBrowserHistory:async p=>{record('historyClear',p);historyRows=[];return state},
        clearBrowserSiteData:async p=>record('clearSite',p),clearAllBrowserData:async p=>record('clearAll',p),authorizeComputerUse:async scope=>{record('authorize',scope);return {authorization:{pending:null}}},declineComputerUseAuthorization:async()=>{record('decline');return {authorization:{pending:null}}},
        confirmBrowserModelAction:async id=>{record('confirm',id);if(window.confirmFailure)throw new Error('confirmation expired')},rejectBrowserModelAction:async id=>record('reject',id)};void 0;`)
    await run(fs.readFileSync(path.join(root,'renderer/browser-sidebar.js'),'utf8'));await act('void 0')
    await act(`document.querySelector('#browserAddress').value='';document.querySelector('#browserGo').click()`)
    assert.equal(await run(`calls.filter(c=>c[0]==='navigate').length`),0)
    for(const id of ['browserBack','browserForward','browserReload']) await act(`document.querySelector('#${id}').click()`)
    assert.deepEqual(await run(`calls.filter(c=>['back','forward','reload'].includes(c[0])).map(c=>c[0])`),['back','forward','reload'])
    await act(`document.querySelector('#browserResizeHandle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}))`)
    assert.equal(await run(`calls.find(c=>c[0]==='width')[1]`),664)
    await act(`document.querySelector('#browserHistoryButton').click()`)
    assert.equal(await run(`document.activeElement.id`),'browserHistorySearch')
    await act(`document.querySelector('#browserHistoryResults button').click()`)
    assert.equal(await run(`calls.find(c=>c[0]==='historyOpen')[1]`),'h1')
    await act(`document.querySelector('#browserHistoryButton').click()`)
    await act(`window.deferHistory=true;document.querySelector('#browserHistorySearch').value='older';document.querySelector('#browserHistorySearchForm').requestSubmit();document.querySelector('#browserHistorySearch').value='newer';document.querySelector('#browserHistorySearchForm').requestSubmit()`)
    await act(`historyDeferred.find(x=>x.query==='newer').resolve({entries:[{id:'new',url:'https://newer.invalid'}]});historyDeferred.find(x=>x.query==='older').resolve({entries:[{id:'old',url:'https://older.invalid'}]});window.deferHistory=false`)
    assert.match(await run(`document.querySelector('#browserHistoryResults').textContent`),/newer/);assert.doesNotMatch(await run(`document.querySelector('#browserHistoryResults').textContent`),/older/)
    await act(`document.querySelector('#browserHistoryClear').click()`)
    assert.equal(await run(`calls.filter(c=>c[0]==='historyClear').length`),0)
    await act(`const c=document.querySelector('#browserHistoryClearConfirm');c.checked=true;c.dispatchEvent(new Event('change'));document.querySelector('#browserHistoryClear').click()`)
    assert.equal(await run(`calls.find(c=>c[0]==='historyClear')[1].confirmed`),true)
    await act(`push({downloads:[{filename:'<img src=x onerror=alert(1)>',state:'progressing',receivedBytes:3,totalBytes:10},{filename:'done',state:'completed'},{filename:'stop',state:'cancelled'},{filename:'fail',state:'interrupted'}]});document.querySelector('#browserDownloadsButton').click()`)
    assert.equal(await run(`document.querySelector('#browserDownloadResults progress').value`),3)
    assert.equal(await run(`document.querySelectorAll('#browserDownloadResults img').length`),0)
    assert.match(await run(`document.querySelector('#browserDownloadResults').textContent`),/已完成[\s\S]*下载中|下载中[\s\S]*已完成/)
    await act(`document.querySelector('#browserProfileButton').click();document.querySelector('#browserClearSite').click();document.querySelector('#browserClearAll').click()`)
    assert.equal(await run(`calls.filter(c=>['clearSite','clearAll'].includes(c[0])).length`),0)
    for(const type of ['Site','All'])await act(`const c=document.querySelector('#browserClear${type}Confirm');c.checked=true;c.dispatchEvent(new Event('change'));document.querySelector('#browserClear${type}').click()`)
    assert.deepEqual(await run(`calls.filter(c=>['clearSite','clearAll'].includes(c[0])).map(c=>[c[0],c[1].confirmed])`),[['clearSite',true],['clearAll',true]])
    for(const scope of ['Session','Forever']) {await act(`onAuth({authorization:{pending:{id:'synthetic'}}});document.querySelector('#computerUseAuthorization${scope}').click()`)}
    await act(`onAuth({authorization:{pending:{id:'synthetic'}}});document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    assert.deepEqual(await run(`calls.filter(c=>c[0]==='authorize').map(c=>c[1])`),['session','forever']);assert.equal(await run(`calls.filter(c=>c[0]==='decline').length`),1)
    await act(`window.confirmFailure=true;push({pendingConfirmations:[{id:'p1',action:'download',summary:'synthetic'}]});const button=document.querySelector('#browserPendingActions button');button.click();button.click()`)
    assert.equal(await run(`calls.filter(c=>c[0]==='confirm').length`),1,'double click should send one confirmation')
    assert.deepEqual(await run('errors'),[],'all confirmation failures surfaced in UI, not unhandled rejections')
    assert.equal(await run(`document.querySelector('#browserStatusText').getAttribute('role')`),'alert')
  }finally{win.destroy()}
}

if (process.versions.electron && process.argv.includes('--isolated-browser-audit')) {
  const { app, BrowserWindow, session } = require('electron')
  app.setPath('userData', process.argv.at(-1))
  app.on('window-all-closed', () => {})
  const cases = []
  ;(async () => {
    await app.whenReady()
    const partition = session.fromPartition('deep-audit-' + Date.now())
    partition.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    partition.setPermissionCheckHandler(() => false)
    partition.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => callback({ cancel: new URL(details.url).origin !== 'https://audit-fixture.invalid' }))
    await partition.protocol.handle('https', () => new Response(`<!doctype html><style>body{margin:20px}button,input,select,div{margin:4px}#editor{border:1px solid;width:200px;height:30px}</style>
      <h1>Fixture</h1><button id="plain" type="button">Run</button><button id="nested" type="button"><span>Nested</span></button>
      <input id="draft" value="initial"><textarea id="notes">old</textarea><div id="editor" contenteditable="true" aria-label="Notes">old</div>
      <input id="range" type="range" aria-label="Volume"><input id="check" type="checkbox"><input id="disabled" disabled>
      <select id="choice"><option value="">Choose</option><option value="one">One</option><option disabled value="two">Two</option></select>
      <p id="read" style="pointer-events:none">Readable text</p><a id="link" href="/safe?token=synthetic#fragment">Docs</a><p id="hidden" hidden>Hidden text</p>
      <script>window.events=[];for(const type of ['click','dblclick','input','change'])document.addEventListener(type,e=>events.push({type,id:e.target.closest('button')?.id||e.target.id,trusted:e.isTrusted}));</script>`, { headers: { 'content-type': 'text/html' } }))
    const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      const wc = win.webContents
      await wc.loadURL('https://audit-fixture.invalid/')
      wc.debugger.attach('1.3')
      const run = parameters => runBrowserPlaywrightOperation({ webContents: wc, parameters, origin: 'https://audit-fixture.invalid', tabId: 'synthetic', securityPolicy: { modelAction: () => ({ allowed: true }) } })
      async function check(name, body) { try { await body(); cases.push({ name, pass: true }) } catch (error) { cases.push({ name, pass: false, error: error.code || error.message, cause: error.cause?.code || error.cause?.message }); console.error(name, error.stack, error.cause); console.error(await wc.executeJavaScript('({draft:document.querySelector("#draft").value,editor:document.querySelector("#editor").textContent})')) } }
      await check('count, text, attribute, visibility and enabled reads', async () => {
        assert.equal((await run({ operation: 'count', selector: 'button' })).count, 2)
        assert.equal((await run({ operation: 'innerText', selector: '#read' })).value, 'Readable text')
        assert.equal((await run({ operation: 'textContent', selector: '#read' })).value, 'Readable text')
        assert.equal((await run({ operation: 'isVisible', selector: '#hidden' })).visible, false)
        assert.equal((await run({ operation: 'isEnabled', selector: '#disabled' })).enabled, false)
        assert.equal((await run({ operation: 'getAttribute', selector: '#link', attribute: 'href' })).value, 'https://audit-fixture.invalid/safe')
      })
      await check('clear editable field with explicit empty fill', async () => {
        await run({ operation: 'fill', selector: '#draft', text: '' })
        assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'), '')
      })
      await check('trusted fill, append, keyboard press and checkbox toggle', async () => {
        await run({ operation: 'fill', selector: '#draft', text: 'Draft' })
        await run({ operation: 'press', selector: '#draft', key: 'End' })
        await run({ operation: 'pressSequentially', selector: '#draft', text: ' plus' })
        assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'), 'Draft plus')
        await run({ operation: 'setChecked', selector: '#check', checked: true })
        assert.equal(await wc.executeJavaScript('document.querySelector("#check").checked'), true)
        await run({ operation: 'setChecked', selector: '#check', checked: false })
        assert.equal(await wc.executeJavaScript('document.querySelector("#check").checked'), false)
      })
      await check('pressSequentially replaces selected text in the middle, not only suffix',async()=>{
        await wc.executeJavaScript('document.querySelector("#draft").focus();document.querySelector("#draft").setSelectionRange(2,4);events=[]')
        await run({operation:'pressSequentially',selector:'#draft',text:'X'})
        assert.equal(await wc.executeJavaScript('document.querySelector("#draft").value'),'DrXt plus')
        assert.deepEqual(await wc.executeJavaScript('events.filter(e=>e.type==="input")'),[{type:'input',id:'draft',trusted:true}])
      })
      await check('contenteditable fill produces verified successful receipt', async () => {
        await run({ operation: 'fill', selector: '#editor', text: 'New notes' })
        assert.equal(await wc.executeJavaScript('document.querySelector("#editor").textContent'), 'New notes')
      })
      await check('text locator resolves nested text to one target', async () => {
        await wc.executeJavaScript('events=[]')
        await run({ operation: 'click', selector_kind: 'text', selector: 'Nested' })
        assert.deepEqual(await wc.executeJavaScript('events'), [{ type:'click', id:'nested', trusted:true }])
      })
      await check('implicit slider accessible role', async () => {
        assert.equal((await run({ operation: 'count', selector_kind: 'role', selector: 'slider', name: 'Volume' })).count, 1)
      })
      await check('read-only role locator ignores pointer-events:none', async () => {
        await wc.executeJavaScript('document.querySelector("#read").setAttribute("role","heading");document.querySelector("#read").setAttribute("aria-label","Read-only heading")')
        assert.equal((await run({ operation: 'innerText', selector_kind: 'role', selector: 'heading', name: 'Read-only heading' })).value, 'Readable text')
      })
      await check('select ordinary option and reset to empty option', async () => {
        await run({ operation: 'selectOption', selector: '#choice', value: 'one' })
        assert.equal(await wc.executeJavaScript('document.querySelector("#choice").value'), 'one')
        await run({ operation: 'selectOption', selector: '#choice', value: '' })
        assert.equal(await wc.executeJavaScript('document.querySelector("#choice").value'), '')
      })
      await check('disabled option rejects before trusted input', async () => {
        await wc.executeJavaScript('events=[]')
        const before = await wc.executeJavaScript('document.querySelector("#choice").value')
        await assert.rejects(run({ operation: 'selectOption', selector: '#choice', value: 'two' }), error => error.code === 'browser-playwright-element-disabled')
        assert.equal(await wc.executeJavaScript('document.querySelector("#choice").value'), before)
        assert.deepEqual(await wc.executeJavaScript('events'), [])
      })
      await check('doubleclick and snapshot', async () => {
        await wc.executeJavaScript('events=[]')
        await run({ operation: 'dblclick', selector: '#plain' })
        assert.deepEqual(await wc.executeJavaScript('events'), [{type:'click',id:'plain',trusted:true},{type:'click',id:'plain',trusted:true},{type:'dblclick',id:'plain',trusted:true}])
        const snapshot = (await run({ operation: 'domSnapshot' })).snapshot
        assert.ok(snapshot.nodes.some(node => node.name === 'Run')); assert.ok(snapshot.count <= 200)
      })
      await check('missing, ambiguous, hidden reads, disabled and forbidden actions fail closed', async () => {
        for (const [parameters, code] of [
          [{operation:'click',selector:'#missing',timeout_ms:0},'browser-playwright-element-not-found'],
          [{operation:'click',selector:'button'},'browser-playwright-strict-mode'],
          [{operation:'innerText',selector:'#hidden'},'browser-playwright-element-not-actionable'],
          [{operation:'click',selector:'#disabled'},'browser-playwright-element-disabled'],
          [{operation:'getAttribute',selector:'#draft',attribute:'value'},'browser-playwright-attribute-forbidden']]) await assert.rejects(run(parameters), error => error.code === code)
      })
      await check('sidebar history/download/profile/authorization/confirmation microfeatures',()=>sidebarMicrofeatures(BrowserWindow))
      await check('existing sidebar real DOM navigation/IME/tab/late-reply/responsive behaviors',async()=>{
        const source=fs.readFileSync(path.join(root,'tests/fixtures/browser-desktop-product-electron.cjs'),'utf8')
        const start=source.indexOf('async function sidebarTests()'),end=source.indexOf('\nasync function main()',start)
        assert.ok(start>=0&&end>start)
        const results=[]
        const context={BrowserWindow,fs:fs.promises,path,repo:root,temp:process.argv.at(-1),assert,results,randomUUID:require('node:crypto').randomUUID}
        await vm.runInNewContext(source.slice(start,end)+';sidebarTests()',context)
        assert.equal(results.length,4)
      })
    } finally { win.destroy() }
    console.log(JSON.stringify({ suite: 'deep-audit-browser-production-dom', cases, electron: process.versions.electron, limitations: ['synthetic protocol only', 'authorization is a test double, not Host approval', 'no installed GUI or real account exercised'] }, null, 2))
    app.exit(cases.every(item => item.pass) ? 0 : 1)
  })().catch(error => { console.error(error); app.exit(1) })
} else {
  const test = require('node:test')
  const { WindowsDesktopUi } = require('../electron/bridge/windows-desktop-ui.cjs')
  const { rowsToTree } = require('../electron/bridge/windows-ui-automation-source.cjs')
  function desktopFixture({ desktop = false, perform, browser = false } = {}) {
    const target = desktop ? { id:'desktop', kind:'desktop', bounds:{x:-1920,y:0,width:3840,height:1080} } : { id:'window:7',kind:'window',bounds:{x:400,y:200,width:1000,height:800} }
    const calls = { pointers:[], text:[] }, control = { generation:1, enabled:true }
    const frame = { target, width:target.bounds.width / 2, height:target.bounds.height / 2, sourceWidth:target.bounds.width, sourceHeight:target.bounds.height, originX:desktop?-1920:0, originY:0 }
    const provider = { status:()=>({ready:control.enabled}), assertAuthorized(){if(!control.enabled)throw Object.assign(new Error('stopped'),{code:'computer-use-stopped'});return control}, targets:async()=>[target], selectTarget:async()=>target,captureFrame:async()=>frame,pointer:async(action,payload)=>{calls.pointers.push({action,...payload});return {completed:true}},keyboard:async text=>{calls.text.push(text);return {completed:true}},stop:async()=>{control.enabled=false;control.generation++} }
    const tree = rowsToTree([{parent:-1,role:'Window',className:browser?'Chrome_WidgetWin_1':'Editor',bounds:target.bounds},{parent:0,role:'Edit',name:'Draft',editable:true,runtimeId:'42',bounds:{x:desktop?-1820:600,y:100+(desktop?0:200),width:100,height:40}}],target)
    const ui = new WindowsDesktopUi({provider,controlSource:{observe:async()=>tree,...(perform?{perform}:{})},browserControlAvailable:()=>browser})
    return { ui, calls, control, target, frame }
  }
  for (const desktop of [false,true]) test(`UIA global bounds map to scaled ${desktop?'negative-origin desktop':'window'} frame`, async()=>{
    const fx=desktopFixture({desktop});await fx.ui.selectTarget(fx.target.id);const tree=await fx.ui.observe();await fx.ui.click(tree.root.children[0].ref)
    assert.deepEqual(fx.calls.pointers,[{action:'click',x:desktop?75:125,y:60}])
    await fx.ui.scroll(tree.root.children[0].ref,-120);assert.deepEqual(fx.calls.pointers[1],{action:'scroll',x:desktop?75:125,y:60,deltaY:-120})
  })
  test('UIA failed focus refuses typing instead of writing to unrelated current focus',async()=>{
    const fx=desktopFixture({perform:async()=>({handled:false,focused:false})});await fx.ui.selectTarget(fx.target.id);const tree=await fx.ui.observe()
    await assert.rejects(fx.ui.type(tree.root.children[0].ref,'Draft'),error=>error.code==='desktop-ui-focus-unverified');assert.deepEqual(fx.calls.text,[])
  })
  test('UIA successful live focus permits text; stale/disabled/sensitive receipts fail closed',async()=>{
    for(const reason of ['focused','stale','disabled','sensitive']){
      const fx=desktopFixture({perform:async()=>reason==='focused'?{handled:false,focused:true}:{handled:false,reason}});await fx.ui.selectTarget(fx.target.id);const tree=await fx.ui.observe()
      if(reason==='focused'){await fx.ui.type(tree.root.children[0].ref,'Draft');assert.deepEqual(fx.calls.text,['Draft'])}
      else{await assert.rejects(fx.ui.type(tree.root.children[0].ref,'Draft'));assert.deepEqual(fx.calls.text,[])}
    }
  })
  test('UIA observation binds public window target id, never silently falls back to entire desktop',async()=>{
    const {WindowsUiAutomationSource}=require('../electron/bridge/windows-ui-automation-source.cjs');const calls=[]
    const source=new WindowsUiAutomationSource({available:true,run:async(_script,input)=>{calls.push(input);return {rows:[{parent:-1,role:'Window',bounds:{x:400,y:200,width:1000,height:800}}]}}})
    const tree=await source.observe({id:'window:7',kind:'window'},{maxNodes:20});assert.equal(calls[0].hwnd,7);assert.equal(calls[0].maxNodes,20);assert.equal(tree.boundsCoordinateSpace,'global-screen-pixels')
    await assert.rejects(source.observe({id:'window:bad',kind:'window'}),error=>error.code==='desktop-ui-ref-stale');assert.equal(calls.length,1)
  })
  test('browser preference inherits from UIA ancestor before invoking child input',async()=>{
    const fx=desktopFixture({browser:true,perform:async()=>({handled:true})});await fx.ui.selectTarget(fx.target.id);const tree=await fx.ui.observe()
    await assert.rejects(fx.ui.click(tree.root.children[0].ref),error=>error.code==='browser-control-preferred')
  })
  test('UIA Stop and caller abort cancel native work without subsequent keyboard fallback',async()=>{
    for(const via of ['stop','abort']){
      let entered;const started=new Promise(resolve=>entered=resolve)
      const fx=desktopFixture({perform:async(_action,_raw,_entry,{signal})=>{entered();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled'),{code:'browser-action-cancelled'})),{once:true}))}})
      await fx.ui.selectTarget(fx.target.id);const tree=await fx.ui.observe();const controller=new AbortController()
      const pending=fx.ui.type(tree.root.children[0].ref,'Draft',controller.signal);const rejection=assert.rejects(pending,error=>error.code==='browser-action-cancelled')
      await started;if(via==='stop')await fx.ui.action({action:'stop'});else controller.abort();await rejection
      assert.deepEqual(fx.calls.text,[]);assert.equal(fx.ui.pendingNative.size,0)
    }
  })
  test('actual UIA process runner honours abort without spawning a real process',async()=>{
    const {EventEmitter}=require('node:events');let spawned=0,killed=0,child
    const sandbox={module:{exports:{}},Buffer,process:{platform:'win32',env:{}},setTimeout,clearTimeout,require(name){assert.equal(name,'node:child_process');return {spawn(){spawned++;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed++;queueMicrotask(()=>child.emit('close',1))};return child}}}}
    vm.runInNewContext(fs.readFileSync(path.join(root,'electron/bridge/windows-ui-automation-source.cjs'),'utf8'),sandbox)
    const run=sandbox.module.exports.runWindowsPowerShell
    const before=new AbortController();before.abort();await assert.rejects(run('unused',{}, {signal:before.signal}),error=>error.code==='browser-action-cancelled');assert.equal(spawned,0)
    const active=new AbortController();const pending=run('unused',{}, {signal:active.signal});active.abort();await assert.rejects(pending,error=>error.code==='browser-action-cancelled');assert.equal(spawned,1);assert.equal(killed,1)
    const good=run('unused',{});child.stdout.emit('data',Buffer.from('{"handled":true}'));child.emit('close',0);assert.equal((await good).handled,true)
    const invalid=run('unused',{});child.stdout.emit('data',Buffer.from('invalid-json'));child.emit('close',0);await assert.rejects(invalid,error=>error.code==='uia-invalid-output')
  })
  test('browser parameters distinguish explicit empty input from missing input', () => {
    assert.equal(normalizePlaywrightParameters({ operation: 'fill', selector: '#draft', text: '' }).text, '')
    assert.equal(normalizePlaywrightParameters({ operation: 'selectOption', selector: '#choice', value: '' }).value, '')
    for (const input of [{operation:'fill',selector:'#draft'}, {operation:'selectOption',selector:'#choice'}]) assert.throws(() => normalizePlaywrightParameters(input))
  })
  test('isolated cached Electron runs production browser DOM microfeatures', { skip: process.env.DSH_DEEP_BROWSER_ELECTRON !== '1', timeout: 90000 }, () => {
    const executable = path.join(root, 'node_modules/electron/dist/electron.exe')
    assert.ok(fs.existsSync(executable), 'requires already cached Electron; never downloads')
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-browser-audit-'))
    // No inherited Harness endpoints, tokens, NODE_OPTIONS or user profile.
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'COMSPEC', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
    Object.assign(env, { TEMP: temp, TMP: temp, USERPROFILE: temp, APPDATA: temp, LOCALAPPDATA: temp })
    try {
      const child = require('node:child_process').spawnSync(executable, [__filename, '--isolated-browser-audit', temp], { cwd: root, env, stdio: 'inherit', timeout: 80000 })
      assert.ifError(child.error); assert.equal(child.status, 0)
    } finally { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) }
  })
}
