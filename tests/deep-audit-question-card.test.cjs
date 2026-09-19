// Isolated Chromium, actual shipped QuestionComposer/draft reducers. No live tab,
// Android bridge, network, accounts, credentials, remote user-question or install writes.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const repo = path.resolve(__dirname, '..')
const bundlePath = path.join(repo, 'node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js')
const sha = value => createHash('sha256').update(value).digest('hex')
const patchedMode = process.argv.includes('--patched')
const patchModule = () => import(require('node:url').pathToFileURL(path.join(repo,'scripts/deep-audit-question-card-patch.mjs')).href)
function mobileInjection(css,runtime) {
  const source=fs.readFileSync(path.join(repo,'mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileUiAdapter.java'),'utf8').replace(/\r\n/g,'\n')
  const strings=/"(?:[^"\\]|\\.)*"/g
  const entry=source.split('private static final String FILE_ENTRY_JS = ')[1].split('\n\n    private final Handler')[0].replace(/^\s*\/\/.*$/gm,'').trim().replace(/;$/,'')
  assert.match(entry.replace(strings,''),/^[\s+]*$/,'Only Java literal concatenation is accepted')
  const FILE_ENTRY_JS=[...entry.matchAll(strings)].map(match=>JSON.parse(match[0])).join('')
  const expression=source.split('static String buildInjectionScript(String css, String runtime) {')[1].split('\n    }')[0].trim().replace(/^return /,'').replace(/;$/,'')
  const remainder=expression.replace(strings,'').replace(/JSONObject\.quote\((?:css|STYLE_ID|RUNTIME_MARKER|RUNTIME_READY)\)/g,'').replace(/\b(?:runtime|FILE_ENTRY_JS)\b/g,'')
  assert.match(remainder,/^[\s+]*$/,'Only the inspected Java injection concatenation is accepted')
  return Function('css','runtime','FILE_ENTRY_JS','STYLE_ID','RUNTIME_MARKER','RUNTIME_READY','JSONObject',`return ${expression}`)(css,runtime,FILE_ENTRY_JS,'harness-mobile-compat','__harnessMobileRuntimeInstalled','ready',{quote:JSON.stringify})
}

async function electronMain() {
  const { app, BrowserWindow } = require('electron')
  const temp = process.argv[process.argv.indexOf('--question-electron') + 1]
  app.setPath('userData', temp)
  app.on('window-all-closed', () => {})
  let win
  try {
    await app.whenReady()
    win = new BrowserWindow({ show: false, width: 390, height: 844, useContentSize: true, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false, partition: 'question-test' } })
    win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, cb) => cb({ cancel: true }))
    const html = path.join(temp, 'fixture.html')
    fs.writeFileSync(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div data-slot="conversation" data-harness-mobile-conversation="true" class="wSkVaW_root" data-phase="active"><div class="wSkVaW_body"><div data-conversation-scroll class="wSkVaW_scrollBody"><div data-conversation-view="chat" style="height:80px">Synthetic conversation; no user data</div><div data-composer-seat class="wSkVaW_composerSeat"><div id="fixture-root"></div></div></div></div></div></body></html>')
    await win.loadFile(html)
    win.webContents.on('console-message', (_event, _level, message) => console.log('RENDERER', message))
    const run = source => win.webContents.executeJavaScript(source)
    const originalBundle = fs.readFileSync(bundlePath, 'utf8')
    const patch = await patchModule()
    assert.equal(sha(originalBundle),patch.QUESTION_BASE_SHA256,'Exact read-only source bundle')
    const bundle = patchedMode ? patch.patchQuestionCardSource(originalBundle) : originalBundle
    const marker = '\t\texports.apply = apply;'
    assert.equal(bundle.split(marker).length, 2)
    const shellDir=path.join(repo,'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets')
    const shell=fs.readFileSync(path.join(shellDir,'index-Df-65__b.js'),'utf8')
    const boot='const lc=document.getElementById("root");if(lc===null)throw new Error("web app: missing #root");new Bp(lc).run();'
    assert.equal(shell.split(boot).length,2,'Exact shipped shell bootstrap seam')
    fs.writeFileSync(path.join(temp,'shipped-core.mjs'),shell.replace(boot,'window.shippedModules=zp();'))
    fs.copyFileSync(path.join(shellDir,'vendor-CCJJTK99.js'),path.join(temp,'vendor-CCJJTK99.js'))
    await run(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.type='module';script.src='./shipped-core.mjs';script.onload=resolve;script.onerror=()=>reject(Error('Local shell module failed'));document.head.appendChild(script)})`)
    await run(`{
      window.React=shippedModules.react;window.ReactDOM=shippedModules['react-dom'];window.Renderer=shippedModules['react-dom/client'];
      window.__ModuleLoader__={load(def){window.product=def.factory(name=>{if(!(name in shippedModules))throw Error('Unexpected bundle dependency '+name);return shippedModules[name]});}};
      window.fetch = () => Promise.reject(Error('Network disabled in fixture')); window.WebSocket = class {constructor(){throw Error('Network disabled in fixture')}};
      window.errors=[]; addEventListener('error',e=>errors.push(e.message)); window.events=[];
      document.addEventListener('click', e=>events.push({type:'click',role:e.target.closest('button')?.getAttribute('role'),trusted:e.isTrusted}),true);
      window.addStyle = (id,text) => {const el=document.getElementById(id)||document.head.appendChild(Object.assign(document.createElement('style'),{id}));el.textContent=text};
      addStyle('fixture-theme',':root{--dsh-composer-side-clearance:0px;--dsh-chat-content-width:760px;--dsw-specific-input-major:white;--dsw-alias-label-primary:#222;--dsw-alias-border-l2:#aaa;--dsw-alias-interactive-bg-hover:#eef;--dsw-alias-state-info-primary:#25f;--dsw-alias-border-l3:#555;--harness-mobile-page-gutter:12px}body{height:844px;font-family:Arial}.wSkVaW_root{height:100vh}button{font:inherit}'); void 0;
    }`)
    await run(`addStyle('shipped-shell-css',${JSON.stringify(fs.readFileSync(path.join(shellDir,'index-b24khbeK.css'),'utf8'))});addStyle('shipped-vendor-css',${JSON.stringify(fs.readFileSync(path.join(shellDir,'vendor-BNsW4eBh.css'),'utf8'))});void 0`)
    const renderer=fs.readFileSync(path.join(repo,'node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js'),'utf8')
    assert.equal(renderer.split(marker).length,2)
    await run(renderer.replace(marker,'\t\texports.fixture = { bindSnapshotSelector, renderChainResult };\n'+marker))
    await run('window.rendererFixture=product.fixture;void 0')
    await run(bundle.replace(marker, '\t\texports.fixture = { QuestionComposer, QuestionFlow, PendingQuestion, createQuestionDraftStore, answerQuestion, zh };\n' + marker))
    const conversation = fs.readFileSync(path.join(repo, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js'), 'utf8')
    const css = /const css\$4 = ("(?:[^"\\]|\\.)*");/.exec(conversation)
    assert.ok(css)
    await run(`addStyle('conversation-css',${css[1]}); window.api=product.fixture; window.domRoot=Renderer.createRoot(document.getElementById('fixture-root'));
      window.config=api.createQuestionDraftStore();window.store=config.create('synthetic-session');window.transitions=[];window.storeState=store.getSnapshot();store.subscribe(()=>{storeState=store.getSnapshot();transitions.push(structuredClone(storeState));});store.use=rendererFixture.bindSnapshotSelector(store);
      window.calls=[];window.deferred=[];window.pending=null;
      window.renderPending = () => {
        const elected=React.createElement(api.QuestionComposer,{matched:pending,useStore:store.use,actions:store.actions,t:key=>api.zh[key]||({submit:'提交',submitting:'提交中…'}[key])||key});
        const fallback=React.createElement('div',{'data-composer-card':true},React.createElement('div',{'data-input-scroll':true},React.createElement('div',{'data-composer-input':true,'data-phase':'ready',contentEditable:true})),React.createElement('button',{'aria-label':'发送消息'},'发送'));
        ReactDOM.flushSync(()=>domRoot.render(rendererFixture.renderChainResult('conversation.composer',elected,{overlay:true,fallback})));
      };
      window.mount = (key='card-1',multi=true,count=3,mode='success',questionCount=1) => {
        pending={key,questions:Array.from({length:questionCount},(_,questionIndex)=>({id:questionIndex===0?'one':'question-'+questionIndex,question:'Synthetic fixture question '+(questionIndex+1),multiSelect:multi,options:Array.from({length:count},(_,i)=>({label:'Option '+i,description:'Description '+i}))})),answer(value){calls.push(structuredClone(value));if(mode==='throw')throw Error('Synthetic synchronous failure');return mode==='defer'?new Promise((resolve,reject)=>deferred.push({resolve,reject})):Promise.resolve()},cancel(){return Promise.resolve()}};renderPending();
      };
      window.remount=()=>{ReactDOM.flushSync(()=>domRoot.render(null));renderPending()};
      window.options=()=>[...document.querySelectorAll('button[role=checkbox],button[role=radio]')];
      window.submit=()=>document.querySelector('.Mbwy4a_footerActions').lastElementChild;
      window.skip=()=>document.querySelector('.Mbwy4a_footerActions').firstElementChild;
      window.prev=()=>document.querySelector('.Mbwy4a_pager button:first-child');
      window.next=()=>document.querySelector('.Mbwy4a_pager button:last-child');
      window.pageState=()=>({index:storeState.progress.index,selected:storeState.progress.drafts.map(draft=>draft.selected),skipped:storeState.progress.drafts.map(draft=>draft.skipped)});
      window.delay = () => new Promise(resolve=>setTimeout(resolve,35));
      window.checked=()=>[...document.querySelectorAll('button[role=checkbox],button[role=radio]')].map(el=>el.getAttribute('aria-checked'));
      window.geometry=()=>[...document.querySelectorAll('button[role=checkbox],button[role=radio]')].map(el=>{const r=el.getBoundingClientRect();return{label:el.textContent,rect:{x:r.x,y:r.y,w:r.width,h:r.height},pe:getComputedStyle(el).pointerEvents,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,180)}});
      mount(); void 0;`)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await win.webContents.debugger.sendCommand('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Synthetic fixture) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36'})
    const tap = async selector => {
      const p = await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing target');const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
      await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 1 }] })
      await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await run('delay()')
    }
    const checks=[]
    const check=async (name,expression,expected)=>{const observed=await run(expression);assert.deepEqual(observed,expected,name);checks.push({name,observed})}
    await tap('button[role=checkbox]')
    await check('trusted native touch selects exactly once','({checked:checked(),count:events.length,trusted:events[0].trusted})',{checked:['true','false','false'],count:1,trusted:true})
    const mobileCss=fs.readFileSync(path.join(repo,'mobile/android/app/src/main/assets/mobile-compat.css'),'utf8')
    const mobileRuntime=fs.readFileSync(path.join(repo,'mobile/android/app/src/main/assets/mobile-runtime.js'),'utf8')
    await run(`window.nativeCalls=[];window.listenerRegistrations=[];
      const nativeAdd=EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener=function(type,listener,options){if(/click|touch|pointer|scroll/.test(type))listenerRegistrations.push({type,capture:options===true||!!options?.capture});return nativeAdd.call(this,type,listener,options)};
      window.HarnessMobilePlatform='android';window.HarnessMobileCacheIdentity='synthetic-fixture';
      window.HarnessMobileNavigation={version:1,navigate:()=>{nativeCalls.push('navigate');return false},getNavigationState:()=>({domain:'conversations',route:'/m/conversations'}),subscribe:()=>{nativeCalls.push('navigation.subscribe')}};
      window.HarnessMobileControl={status:()=>{nativeCalls.push('control.status');return 'disabled'},cacheIdentity:()=>{nativeCalls.push('cacheIdentity');return 'synthetic-fixture'},openSettings:()=>{nativeCalls.push('openSettings')},inputAction:action=>{nativeCalls.push('inputAction:'+action)}};
      document.documentElement.dataset.harnessMobileDrawer='closed';document.documentElement.dataset.harnessMobileDomain='conversations';void 0;`)
    const injection=mobileInjection(mobileCss,mobileRuntime)
    assert.equal(await run(injection),true,'actual MobileUiAdapter concatenated injection returns ready')
    const initialListeners=await run('listenerRegistrations.length')
    assert.equal(await run(injection),true,'repeat native injection remains ready')
    assert.equal(await run('listenerRegistrations.length'),initialListeners,'repeat injection adds no extra listener')
    const activation=await run('({visible:document.visibilityState,platform:document.documentElement.dataset.harnessMobilePlatform,capabilities:__harnessMobileCapabilities,marker:__harnessMobileRuntimeInstalled,shell:!!document.getElementById("harness-mobile-app-shell"),observer:!!__harnessMobileUiObserver,inputEntry:__harnessMobileInputEntryInstalled,ime:__harnessMobileImeSendBridge,coarse:matchMedia("(pointer:coarse)").matches,nativeCalls,listeners:listenerRegistrations})')
    assert.equal(activation.visible,'visible');assert.equal(activation.platform,'android');assert.equal(activation.marker,'ready');assert.equal(activation.ime,true);assert.equal(activation.inputEntry,true);assert.equal(activation.coarse,true)
    await run('mount("card-runtime");delay()')
    await tap('button[role=checkbox] > span')
    await check('native adapter + decoration target toggles once','checked()',['true','false','false'])
    await check('multiselect receives visible selected-row state','options()[0].classList.contains("Mbwy4a_optionSelected")',patchedMode)
    await tap('button[role=checkbox] .Mbwy4a_optionLabel')
    await check('row text toggles same option once','checked()',['false','false','false'])
    await check('overlay fallback stays hidden','getComputedStyle(document.querySelector("[data-chain-overlay-fallback]")).display','none')
    await check('question remains inside original React delegated root','document.getElementById("fixture-root").contains(document.querySelector("[data-question-key]"))',true)
    await check('adapter did not synthesize extra question activations','events.filter(event=>event.role==="checkbox").every(event=>event.trusted)',true)
    await tap('button[role=checkbox]')
    await run('for(let i=0;i<20;i++){document.querySelector("[data-conversation-view]").append(document.createTextNode(" synthetic stream"));renderPending()} remount();delay()')
    await check('stream rerender and strict slot remount retain drafts','checked()',['true','false','false'])
    await tap('button[role=checkbox]:nth-child(2)')
    await check('separate touches preserve multiple selections','checked()',['true','true','false'])
    if(patchedMode) assert.ok((await run('geometry()')).every(row=>row.rect.h>=48),'coarse touch rows are at least 48px')
    const footerTargets=await run('[...document.querySelectorAll(".Mbwy4a_footerActions button")].map(el=>({text:el.textContent,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))')
    assert.ok(footerTargets.every(target=>target.width>=44 && target.height===(patchedMode?44:36)),'actual Skip/Submit touch targets')
    checks.push({name:'actual coarse Skip/Submit touch targets',observed:footerTargets})
    await run('mount("multi-page",true);pending.questions=[...pending.questions,{...pending.questions[0],id:"two"}];renderPending();delay()')
    const continueTarget=await run('(()=>{const el=submit();return{text:el.textContent,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}})()')
    assert.equal(continueTarget.text,'下一题');assert.ok(continueTarget.width>=44);assert.equal(continueTarget.height,patchedMode?44:36)
    checks.push({name:'actual coarse Continue touch target',observed:continueTarget})
    await run('mount("single",false);delay()')
    await tap('button[role=radio]');await tap('button[role=radio]:nth-child(2)')
    await check('single choice replaces previous option','checked()',['false','true','false'])
    await run('mount("custom",true,3,"defer");calls=[];options()[0].click();delay()')
    await run(`{const input=document.querySelector('[data-question-key] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'  Synthetic custom  ');input.dispatchEvent(new Event('input',{bubbles:true}));}delay()`)
    await run(`{const input=document.querySelector('[data-question-key] textarea');input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));}delay()`)
    await check('IME composition Enter does not submit','calls.length',0)
    await run(`document.querySelector('[data-question-key] textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));delay()`)
    await check('custom Enter retains multi selection and trims text','calls[0]',{answers:[{id:'one',selected:['Option 0'],custom:'Synthetic custom'}]})
    await run('mount("scroll",true,24);delay()')
    const start=await run('(()=>{const r=document.querySelector("[data-question-scroll]").getBoundingClientRect();return{x:r.x+r.width/2,y:r.bottom-24}})()')
    const countBefore=await run('events.length')
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:2}]})
    for(let offset=25;offset<=150;offset+=25) await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x,y:start.y-offset,id:2}]})
    await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
    await run('delay()')
    await check('native pan scrolls without choosing','({selected:checked().includes("true"),scrolled:document.querySelector("[data-question-scroll]").scrollTop>0,clicks:events.length})',{selected:false,scrolled:true,clicks:countBefore})
    await run('mount("batch",true,3,"defer");calls=[];deferred=[];options()[0].click();options()[1].click();delay()')
    await check('same-dispatch activations preserve latest snapshot','checked()',patchedMode?['true','true','false']:['false','true','false'])
    await run('submit().click();submit().click();delay()')
    await check('same-dispatch submit is fenced synchronously','calls.length',patchedMode?1:2)
    await run('remount();delay()')
    await check('in-flight card remains disabled after slot remount','submit().disabled',patchedMode)
    await run('mount("toggle-batch");options()[0].click();options()[0].click();delay()')
    await check('two activations toggle twice without stale closure','checked()',patchedMode?['false','false','false']:['true','false','false'])
    await run('mount("latest-submit",true,3,"defer");calls=[];deferred=[];options()[0].click();delay()')
    await run('options()[1].click();submit().click();delay()')
    await check('immediate submit captures latest selected values','calls[0].answers[0].selected',patchedMode?['Option 0','Option 1']:['Option 0'])
    await run('mount("retry",true,3,"defer");calls=[];deferred=[];options()[0].click();delay()')
    await run('submit().click();delay()');await run('deferred[0].reject(Error("synthetic delivery failure"));delay()')
    await check('failure retains selection and allows retry','({checked:checked(),disabled:submit().disabled,text:document.querySelector("[role=status]").textContent})',{checked:['true','false','false'],disabled:false,text:'synthetic delivery failure'})
    await run('submit().click();delay()')
    await check('retry resends the same selected snapshot','calls.map(x=>x.answers[0].selected)',[['Option 0'],['Option 0']])
    await run('mount("new-card");options()[1].click();delay()');await run('deferred[1].resolve();delay()')
    await check('old successful settlement cannot clear new-card state','({checked:checked(),key:storeState.requestKey})',{checked:['false','true','false'],key:'new-card'})
    await run('mount("old-failure",true,3,"defer");deferred=[];options()[0].click();delay()');await run('submit().click();delay()')
    await run('mount("new-failure");options()[1].click();delay()');await run('deferred[0].reject(Error("stale failure"));delay()')
    await check('old failed settlement cannot show new-card error','({checked:checked(),error:document.querySelector("[role=status]").textContent})',{checked:['false','true','false'],error:''})
    if(patchedMode){
      await run('mount("sync-failure",true,3,"throw");options()[0].click();delay()');await run('submit().click();delay()')
      await check('synchronous provider throw recovers without losing draft','({disabled:submit().disabled,checked:checked(),text:document.querySelector("[role=status]").textContent})',{disabled:false,checked:['true','false','false'],text:'Synthetic synchronous failure'})
    }
    await run('mount("trusted-pages",true,3,"defer",3);delay()')
    await tap('button[role=checkbox]');await tap('.Mbwy4a_pager button:last-child')
    await tap('button[role=checkbox]:nth-child(2)');await tap('.Mbwy4a_pager button:first-child')
    await check('trusted touches preserve drafts through Next and Previous','pageState()',{index:0,selected:[["Option 0"],["Option 1"],[]],skipped:[false,false,false]})
    // Same-dispatch real DOM pager regressions (all requests now have 3 questions).
    const pagerRepaired=patchedMode
    await run('mount("pager-next",true,3,"defer",3);options()[0].click();next().click();delay()')
    await check('same-dispatch select then Next retains current draft','pageState()',{index:1,selected:pagerRepaired?[["Option 0"],[],[]]:[[],[],[]],skipped:[false,false,false]})
    await run('mount("pager-prev",true,3,"defer",3);next().click();delay()')
    await run('options()[1].click();prev().click();delay()')
    await check('same-dispatch select then Previous retains current draft','pageState()',{index:0,selected:pagerRepaired?[[],["Option 1"],[]]:[[],[],[]],skipped:[false,false,false]})
    await run('mount("pager-stale-index",true,3,"defer",3);next().click();delay()')
    await run('next().click();prev().click();delay()')
    await check('stale opposite pager cannot jump across two questions','storeState.progress.index',pagerRepaired?2:0)
    await run('mount("pager-busy",true,3,"defer",3);calls=[];deferred=[];options()[0].click();delay()')
    await run('next().click();delay()');await run('options()[1].click();delay()')
    await run('next().click();delay()');await run('options()[2].click();delay()')
    await run('submit().click();prev().click();delay()')
    await check('same-dispatch submit fences old Previous pager','({index:storeState.progress.index,calls:calls.length,selected:storeState.progress.drafts.map(d=>d.selected)})',{index:pagerRepaired?2:1,calls:1,selected:[["Option 0"],["Option 1"],["Option 2"]]})
    await run('mount("stale-skip",true,3,"defer",3);options()[0].click();delay()')
    await run('next().click();skip().click();delay()')
    await check('old Skip cannot clear the page that just lost focus','pageState()',{index:1,selected:patchedMode?[["Option 0"],[],[]]:[[],[],[]],skipped:[!patchedMode,false,false]})
    await run('mount("continue-latest",true,3,"defer",3);options()[0].click();delay()')
    await run('options()[1].click();submit().click();delay()')
    await check('Continue preserves all same-dispatch selections','pageState()',{index:1,selected:patchedMode?[["Option 0","Option 1"],[],[]]:[["Option 0"],[],[]],skipped:[false,false,false]})
    await run('mount("stale-continue",true,3,"defer",3);options()[0].click();delay()');await run('next().click();delay()');await run('options()[0].click();delay()')
    await run('options()[1].click();prev().click();submit().click();delay()')
    await check('old Continue cannot leave the newly chosen earlier page','pageState()',{index:patchedMode?0:2,selected:[["Option 0"],pagerRepaired?["Option 0","Option 1"]:["Option 0"],[]],skipped:[false,false,false]})
    await run('mount("auto-next-stale-choice",false,3,"defer",3);options()[0].click();options()[1].click();delay()')
    await check('auto-advance rejects old-page selection callback','pageState()',{index:1,selected:[[patchedMode?"Option 0":"Option 1"],[],[]],skipped:[false,false,false]})
    // Actual tool Consumer -> actual validation/waterfall method -> actual client
    // answerQuestion/PendingQuestion -> native touch -> selected echo. The transport
    // seam is local serialization only, never a real tool invocation or API call.
    const moduleUrl=relative=>require('node:url').pathToFileURL(path.join(repo,relative)).href
    const askConsumer=await import(moduleUrl('node_modules/@deepseek-ai/dsh-tool-ask-user/lib/index.js'))
    const {UserQuestionService}=await import(moduleUrl('node_modules/@deepseek-ai/dsh-user-questions/lib/index.js'))
    let declaredTool
    let ready
    const mounted=new Promise(resolve=>{ready=resolve})
    const forward=async (event,request)=>{
      assert.equal(event,'user-questions/request')
      assert.deepEqual(request.questions.map(question=>question.multiSelect),[true,false,true])
      assert.ok(request.questions.every(question=>!('multi_select' in question)))
      await run(`window.remoteRemoved=0;window.remoteAbort=new AbortController();window.remoteCompletion=api.answerQuestion({sessions:{scopeOf:()=>"synthetic-session"}}, {}, {questions:${JSON.stringify(request.questions)},signal:remoteAbort.signal},()=>Promise.reject(Error('Unexpected fallback')),carrier=>{window.pending=carrier;renderPending();return()=>{remoteRemoved++}});void 0`)
      ready()
      return run('remoteCompletion')
    }
    askConsumer.apply({tools:{register:tool=>{declaredTool=tool}},userQuestions:{ask:request=>UserQuestionService.prototype.ask.call({ctx:{waterfall:forward}},request)}})
    assert.equal(declaredTool.name,'ask_user_question')
    const toolArgs={questions:[
      {id:'synthetic-question',question:'Synthetic exact tool schema',multi_select:true,options:[{label:'Option 0'},{label:'Option 1'}]},
      {id:'second-question',question:'Synthetic single choice',multi_select:false,options:[{label:'Option 0'},{label:'Option 1'}]},
      {id:'third-question',question:'Synthetic skipped question',multi_select:true,options:[{label:'Option 0'},{label:'Option 1'}]}
    ]}
    const toolResult=declaredTool.execute(toolArgs,{signal:new AbortController().signal})
    await mounted
    await tap('button[role=checkbox]')
    await check('real tool request local feedback precedes receipt','({checked:checked(),removed:remoteRemoved})',{checked:['true','false'],removed:0})
    await tap('button[role=checkbox]:nth-child(2)')
    await tap('.Mbwy4a_footerActions > :last-child')
    await tap('button[role=radio]:nth-child(2)')
    await check('real mixed-question tool advances without early receipt','({page:storeState.progress.index,removed:remoteRemoved})',{page:2,removed:0})
    await tap('.Mbwy4a_footerActions > :first-child')
    const result=await toolResult
    assert.deepEqual(result,{answers:[{id:'synthetic-question',selected:['Option 0','Option 1']},{id:'second-question',selected:['Option 1']},{id:'third-question',selected:[]}]})
    checks.push({name:'actual ask_user_question multi_select conversion and selected echo',observed:result})
    await check('completed pending presentation removed exactly once','remoteRemoved',1)
    const resultsBundle=fs.readFileSync(path.join(repo,'node_modules/@deepseek-ai/dsh-client-ui-tool/lib/client.js'),'utf8')
    assert.equal(sha(resultsBundle),'2371e34f802d8f39ae52389f6d92c45610cd17f5c3273dfbd35b7ce67b7f6fde')
    assert.equal(resultsBundle.split(marker).length,2)
    await run(resultsBundle.replace(marker,'\t\texports.fixture={AskQuestionRow,AskQuestionCard};\n'+marker))
    await run(`window.resultFixture=product.fixture;window.wireResult=${JSON.stringify(result)};
      window.wireArgs=${JSON.stringify(toolArgs)};
      window.resultRow=resultFixture.AskQuestionRow({toolName:'ask_user_question',block:{kind:'tool_result',callId:'synthetic-call',call:{argsRaw:JSON.stringify(wireArgs)},content:[{type:'text',text:JSON.stringify(wireResult)}],isError:false},t:(key,values)=>key==='ask.answered'?values.answered+'/'+values.total:key,inspect:()=>{}});
      ReactDOM.flushSync(()=>domRoot.render(React.createElement(resultFixture.AskQuestionCard,{card:resultRow.props.askQuestion})));void 0`)
    await check('actual result row preserves selected echo','resultRow.props.askQuestion',{kind:'answered',questions:[{id:'synthetic-question',question:'Synthetic exact tool schema',answers:['Option 0','Option 1']},{id:'second-question',question:'Synthetic single choice',answers:['Option 1']},{id:'third-question',question:'Synthetic skipped question',answers:[]}],skippedLabel:'ask.skipped'})
    await check('actual answered card displays chosen label','document.getElementById("fixture-root").textContent.includes("Option 0")',true)
    await check('actual cancel rejects, never synthesizes selected empty','(async()=>{const p=new api.PendingQuestion("synthetic",[{id:"q",question:"Synthetic"}]);const result=p.result.then(()=>"resolved",e=>e.code);await p.cancel();return result})()','ASK_CANCELLED')
    await check('actual abort rejects, never synthesizes selected empty','(async()=>{const controller=new AbortController();const p=new api.PendingQuestion("synthetic",[{id:"q",question:"Synthetic"}],controller.signal);const result=p.result.then(()=>"resolved",e=>e.code);controller.abort();return result})()','ASK_ABORTED')
    await run('mount("explicit-skip");calls=[];document.querySelector(".Mbwy4a_footerActions").firstElementChild.click();delay()')
    await check('explicit skip is one legitimate empty selected receipt','calls',[{answers:[{id:'one',selected:[]}]}])
    await check('no unexpected JavaScript error','errors',[])
    console.log(JSON.stringify({mode:patchedMode?'patched':'baseline-known-red',bundleSha256:sha(bundle),engine:{electron:process.versions.electron,chrome:process.versions.chrome},checks,activation,limitations:['Synthetic local file origin and native bridge stubs; Android Java/View/connection overlay and real WebProxy socket not exercised','Batched programmatic DOM activations reproduce races, NOT proof of native lost-touch report','No API/user data or installed runtime changed']},null,2))
    await run('ReactDOM.flushSync(()=>domRoot.unmount())')
  } finally { win?.destroy() }
}

if (process.versions.electron && process.argv.includes('--question-electron')) {
  electronMain().then(()=>require('electron').app.exit(0),error=>{console.error(error);require('electron').app.exit(1)})
} else {
  const { test } = require('node:test')
  test('exact repair hash, identity, idempotence, unknown input refusal and isolated publication',async()=>{
    const patch=await patchModule()
    const original=fs.readFileSync(bundlePath,'utf8')
    const result=patch.patchQuestionCardSource(original)
    assert.equal(sha(result),patch.QUESTION_PATCHED_SHA256)
    assert.equal(patch.patchQuestionCardSource(result),result)
    assert.throws(()=>patch.patchQuestionCardSource(original+'\n'),/Unsupported/)
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'question-patch-'))
    try{
      const dir=path.join(temp,'node_modules',patch.QUESTION_PACKAGE)
      fs.mkdirSync(path.join(dir,'lib'),{recursive:true})
      fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:patch.QUESTION_PACKAGE,version:patch.QUESTION_VERSION}))
      const file=path.join(dir,'lib/client.js');fs.writeFileSync(file,original)
      assert.equal((await patch.patchQuestionCardRuntime(temp)).changed,true)
      assert.equal((await patch.patchQuestionCardRuntime(temp)).changed,false)
      assert.equal(fs.readFileSync(file,'utf8'),result)
      fs.appendFileSync(file,'\n');await assert.rejects(patch.patchQuestionCardRuntime(temp),/Unsupported/)
      assert.equal(fs.readFileSync(file,'utf8'),result+'\n')
      fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:patch.QUESTION_PACKAGE,version:'unknown'}))
      await assert.rejects(patch.patchQuestionCardRuntime(temp),/identity/)
      assert.equal(fs.readFileSync(bundlePath,'utf8'),original,'real installed dependency untouched')
    }finally{fs.rmSync(temp,{recursive:true,force:true})}
  })
  for(const mode of ['baseline','patched']) test(`real question bundle in isolated Electron: ${mode}`, { timeout: 90000 }, () => {
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'question-card-'))
    const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,TEMP:temp,TMP:temp,HOME:temp,USERPROFILE:temp,APPDATA:temp,LOCALAPPDATA:temp}
    try {
      const executable=path.join(repo,'node_modules/electron/dist/electron.exe')
      assert.ok(fs.existsSync(executable),'Cached Electron required; never download')
      const result=require('node:child_process').spawnSync(executable,[__filename,'--question-electron',temp,`--${mode}`],{cwd:repo,env,stdio:'inherit',timeout:75000})
      assert.ifError(result.error);assert.equal(result.status,0)
    } finally {fs.rmSync(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100})}
  })
}
