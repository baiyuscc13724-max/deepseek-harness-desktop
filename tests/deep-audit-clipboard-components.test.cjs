'use strict';
// Actual shipped InputBar -> ComposerContentEditable -> SessionInputShell/Lexical.
// No native clipboard, editing commands, UI server, real session, account or installation writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const guard=require('./fixtures/deep-audit-clipboard-components/deny-network.cjs');
const repo=path.resolve(__dirname,'..');
const fixture=path.join(__dirname,'fixtures/deep-audit-clipboard-components');
const sha=v=>createHash('sha256').update(v).digest('hex');
const inputNames={
  conversation:'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js',
  shell:'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-Df-65__b.js',
  vendor:'node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/vendor-CCJJTK99.js',
  electron:'node_modules/electron/dist/electron.exe',
};
const expected={conversation:'6f797eb8e87c07e33b9ef35eaacc0eca9bc122e04e14d176ea81354fd53358a2',shell:'9e845cbbe80482a49831d912b9c02324c5ff1e8c35b9cc5f7009ecbe6e4537c1',vendor:'38f95ea3ff85b49dc4d8f237db208bbaedd2cb8c31611215c246dde41786ff21',electron:'8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f'};
function inputs(){return Object.fromEntries(Object.entries(inputNames).map(([key,name])=>{const bytes=fs.readFileSync(path.join(repo,name));assert.equal(sha(bytes),expected[key],key+' source drift');return[key,bytes];}));}
const frozen={
 'docs/deep-audit/interaction.md':'8114d11e4b707c8c41b4403cf152c923ba237ec38d6feb95d27741efdfad3388',
 'docs/deep-audit/coverage-interaction.json':'95abf7bcc84cbb85589a1db636f63cdbb05f94dce4dcac514243ba5cb8c8dc98',
 'docs/deep-audit/session-core-install.md':'e7069b8a371e7ddf757856970ea2d4471758e1359f5a6a267226bd75d593ee6d',
 'docs/deep-audit/question-card-install.md':'56e68e9dff9f5716777193f90a15b54254335c664dc7718f2d44141e17a51546',
 'docs/deep-audit/coverage-master.json':'8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794',
 'tests/deep-audit-question-card.test.cjs':'b42ad3d295fce400a76ed469f5b2b35783b3eeac1d221edb5b322d07c83a82b8'
};
function verifyFrozen(){for(const [name,hash] of Object.entries(frozen))assert.equal(sha(fs.readFileSync(path.join(repo,name))),hash,'Frozen evidence drift '+name);}
function harnessHashes(){return Object.fromEntries([__filename,...['renderer.js','deny-network.cjs','run.ps1','install-current.cjs'].map(name=>path.join(fixture,name))].map(file=>[path.relative(repo,file),sha(fs.readFileSync(file))]));}
function isolation(){
  const out=process.env.CLIPBOARD_AUDIT_RUN;assert.ok(out,'Use fixtures/deep-audit-clipboard-components/run.ps1');
  assert.equal(path.dirname(out),path.join(repo,'.artifacts/deep-audit-round1-clipboard'));
  const allowed=new Set(['SYSTEMROOT','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','CLIPBOARD_AUDIT_RUN','NODE_TEST_CONTEXT','NODE_TEST_WORKER_ID']);
  if(process.env.NODE_TEST_WORKER_ID!==undefined)assert.match(process.env.NODE_TEST_WORKER_ID,/^\d+$/);
  for(const key of Object.keys(process.env))assert.ok(allowed.has(key.toUpperCase()),'Unexpected inherited environment key '+key);
  for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])assert.equal(process.env[key],path.join(out,'profile'));
  assert.equal(process.env.DSH_HOME,path.join(out,'profile/dsh'));
  return out;
}
async function electronMain(){
  const rootOut=isolation(),data=inputs();
  const mode=process.argv.includes('--actual-installed')?'actual-installed':'baseline';
  const out=path.join(rootOut,mode),profile=path.join(rootOut,'profile','electron-'+mode);fs.mkdirSync(out,{recursive:true});fs.mkdirSync(profile,{recursive:true});
  let installation=null;
  if(mode==='actual-installed'){
    installation=JSON.parse(fs.readFileSync(path.join(rootOut,'installation.json'),'utf8'));
    const installedFile=path.join(rootOut,'profile/installed-runtime/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js');
    assert.equal(path.resolve(rootOut,installation.conversation),installedFile);
    data.conversation=fs.readFileSync(installedFile);
    assert.equal(sha(data.conversation),'30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066','Load actual installed file; never transform in renderer');
    const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(installedFile),'../package.json'),'utf8'));
    assert.equal(manifest.name,'@deepseek-ai/dsh-client-ui-conversation');assert.equal(manifest.version,'0.1.2-alpha.5');
  }
  const executedInputs={...expected,conversation:sha(data.conversation)};
  const electron=require('electron'),{app,BrowserWindow}=electron;
  const nativeAttempts=[],blockedRequests=[];
  const denyNative=name=>(..._args)=>{nativeAttempts.push(name);throw Error('NATIVE_EDIT_DENIED:'+name)};
  // Overwrite every exposed native clipboard function without calling any original function.
  for(const name of Object.keys(electron.clipboard))if(typeof electron.clipboard[name]==='function')electron.clipboard[name]=denyNative('clipboard.'+name);
  for(const name of ['request','fetch','resolveHost'])if(typeof electron.net[name]==='function')electron.net[name]=denyNative('net.'+name);
  app.setPath('userData',profile);app.setPath('sessionData',profile);
  app.commandLine.appendSwitch('disable-background-networking');app.commandLine.appendSwitch('disable-component-update');app.commandLine.appendSwitch('disable-sync');app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');
  app.on('window-all-closed',()=>{});
  let win;const checks=[];let receipt;
  try{
    await app.whenReady();
    win=new BrowserWindow({show:false,width:860,height:640,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'clipboard-synthetic'}});
    for(const name of ['copy','cut','paste','pasteAndMatchStyle','selectAll','undo','redo','copyImageAt','insertText','sendInputEvent'])win.webContents[name]=denyNative('webContents.'+name);
    const ses=win.webContents.session;
    ses.setPermissionRequestHandler((_wc,_permission,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);
    ses.on('will-download',event=>event.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',event=>event.preventDefault());
    const localFiles=new Set(['fixture.html','shipped-core.mjs','vendor-CCJJTK99.js'].map(name=>require('node:url').pathToFileURL(path.join(profile,name)).href));
    ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,cb)=>{const ok=localFiles.has(details.url);if(!ok)blockedRequests.push(details.url);cb({cancel:!ok});});
    const boot='const lc=document.getElementById("root");if(lc===null)throw new Error("web app: missing #root");new Bp(lc).run();';
    const shell=data.shell.toString();assert.equal(shell.split(boot).length,2);
    const localShell=shell.replace(boot,'window.shippedModules=zp();');
    fs.writeFileSync(path.join(profile,'shipped-core.mjs'),localShell);fs.writeFileSync(path.join(profile,'vendor-CCJJTK99.js'),data.vendor);
    fs.writeFileSync(path.join(profile,'fixture.html'),'<!doctype html><meta charset="utf-8"><div id="fixture-root"></div><button id="outside">Outside synthetic focus</button>');
    await win.loadFile(path.join(profile,'fixture.html'));
    const run=source=>win.webContents.executeJavaScript(source);
    // Install ALL renderer deny/fake ports before even importing shipped React/shell modules.
    await run(`window.portAttempts=[];window.rendererErrors=[];window.eventLog=[];
      window.denyPort=name=>(...args)=>{portAttempts.push(name);throw Error('DENIED:'+name)};
      document.execCommand=denyPort('execCommand');
      Object.defineProperty(navigator,'clipboard',{value:Object.freeze({read:denyPort('clipboard.read'),readText:denyPort('clipboard.readText'),write:denyPort('clipboard.write'),writeText:denyPort('clipboard.writeText')})});
      window.fetch=denyPort('fetch');window.WebSocket=class{constructor(){denyPort('WebSocket')()}};window.EventSource=class{constructor(){denyPort('EventSource')()}};window.XMLHttpRequest=class{constructor(){denyPort('XMLHttpRequest')()}};
      navigator.sendBeacon=denyPort('sendBeacon');window.open=denyPort('open');
      addEventListener('error',event=>{rendererErrors.push(event.message);event.preventDefault()});
      for(const type of ['paste','copy'])document.addEventListener(type,event=>{eventLog.push({type,trusted:event.isTrusted});event.preventDefault()},false);
      void 0;`);
    await run(`new Promise((resolve,reject)=>{const el=document.createElement('script');el.type='module';el.src='./shipped-core.mjs';el.onload=resolve;el.onerror=()=>reject(Error('shipped shell failed'));document.head.append(el)})`);
    await run(`window.React=shippedModules.react;window.ReactDOM=shippedModules['react-dom'];window.Renderer=shippedModules['react-dom/client'];window.dependencies=[];
      window.__ModuleLoader__={load(def){window.product=def.factory(name=>{dependencies.push(name);if(!(name in shippedModules))throw Error('Unexpected dependency '+name);return shippedModules[name]})}};void 0`);
    const anchor='\t\texports.apply = apply;';const source=data.conversation.toString();assert.equal(source.split(anchor).length,2);
    const seam='\t\texports.clipboardAudit = { InputBar, ComposerContentEditable, SessionInputShell, registerComposerKeymap, root:nl, selection:Kr, copy:vn$2, paste:Je$2, undo:Qe$2, redo:Ze$2, enter:cn$1 };\n';
    const instrumented=source.replace(anchor,seam+anchor);assert.equal(instrumented.replace(seam,''),source,'Export-only reversible seam');
    await run(instrumented);
    await run(fs.readFileSync(path.join(fixture,'renderer.js'),'utf8'));
    const check=async(name,expression,expectedValue)=>{const observed=await run(expression);checks.push({name,observed,expected:expectedValue});fs.writeFileSync(path.join(out,'checks.partial.json'),JSON.stringify(checks,null,2));assert.deepEqual(observed,expectedValue,name);};
    await run('mount("a");delay()');
    await check('actual shipped InputBar and Lexical mounted','({react:React.version,root:current.editor.getRootElement()===surface(),editable:current.editor.isEditable(),role:surface().getAttribute("role")})',{react:'18.3.1',root:true,editable:true,role:'textbox'});
    await run('seed("alpha beta");selectText(0,5);delay()');
    await run('window.clip=emit("copy");delay()');
    await check('selected text copy writes only event DataTransfer','({text:clip.data.getData("text/plain"),html:clip.data.getData("text/html").includes("alpha"),draft:current.snapshot.draft,trusted:clip.event.isTrusted})',{text:'alpha',html:true,draft:'alpha beta',trusted:false});
    await run('selectText(5,5);window.clip=emit("copy");delay()');
    await check('collapsed selection does not populate clipboard payload','Array.from(clip.data.types)',[]);
    await run('seed("<tag>&中文🙂");selectText(0,10);window.clip=emit("copy");delay()');
    await check('copied HTML escapes selected plain text','({text:clip.data.getData("text/plain"),escaped:clip.data.getData("text/html").includes("&lt;tag&gt;&amp;"),active:clip.data.getData("text/html").includes("<tag>")})',{text:'<tag>&中文🙂',escaped:true,active:false});
    await run('seed("alpha beta");selectText(6,10);window.clip=emit("paste",{"text/plain":"中文🙂\\nnext","text/html":"<b>WRONG</b>"});delay()');
    await check('rich clipboard uses plain payload and replaces selected range','({draft:current.snapshot.draft,html:surface().innerHTML.includes("<b>")})',{draft:'alpha 中文🙂\nnext',html:false});
    await run('seed("keep");selectText(4,4);emit("paste",{"text/plain":"<script>window.BAD=1</script>&\\n<b>literal</b>","text/html":"<img src=\\"https://invalid.example/x\\" onerror=\\"window.BAD=1\\"><script>window.BAD=1</script>"});delay()');
    await check('HTML payload cannot create active markup; plain metacharacters remain text','({draft:current.snapshot.draft,active:surface().querySelectorAll("script,img,b,iframe").length,bad:!!window.BAD})',{draft:'keep<script>window.BAD=1</script>&\n<b>literal</b>',active:0,bad:false});
    await run('seed("keep");selectText(0,4);emit("paste",{"text/html":"<b>html-only</b>"});delay()');
    await check('HTML-only clipboard preserves selection content','current.snapshot.draft','keep');
    await run('emit("paste",{});delay()');await check('empty clipboard preserves selection content','current.snapshot.draft','keep');
    await run('seed("left-right");selectText(5,5);emit("paste",{"text/plain":"X"});delay()');
    await check('plain-only paste retains surrounding text','current.snapshot.draft','left-Xright');
    await run('current.editor.dispatchCommand(api.undo);delay()');await check('one undo removes paste only','current.snapshot.draft','left-right');
    await run('current.editor.dispatchCommand(api.redo);delay()');await check('redo restores paste','current.snapshot.draft','left-Xright');
    await run('seed("readonly");selectText(0,8);mount("a",{disabled:true});delay();emit("paste",{"text/plain":"forbidden"});delay()');
    await check('disabled InputBar blocks paste and reflects editor state','({draft:current.snapshot.draft,editable:current.editor.isEditable(),ce:surface().contentEditable,disabled:surface().getAttribute("aria-disabled")})',{draft:'readonly',editable:false,ce:'false',disabled:'true'});
    await run('selectText(0,8);window.clip=emit("copy");delay()');
    await check('readonly editor retains selected copy capability','({text:clip.data.getData("text/plain"),draft:current.snapshot.draft})',{text:'readonly',draft:'readonly'});
    await run('mount("a");delay();seed("removed");mount("a",{removed:true});delay();emit("paste",{"text/plain":"forbidden"});delay()');
    await check('removed session paste cannot change retained draft','current.snapshot.draft','removed');
    await run('mount("a");delay();seed("locked");mount("a",{blocked:{reason:"synthetic"}});delay();emit("paste",{"text/plain":"forbidden"});delay()');
    await check('blocked InputBar refuses paste','current.snapshot.draft','locked');
    await run('mount("a");delay();seed("busy");mount("a",{phase:"submitting"});delay();emit("paste",{"text/plain":"forbidden"});delay()');
    await check('machine busy InputBar refuses paste','({draft:current.snapshot.draft,editable:current.editor.isEditable()})',{draft:'busy',editable:false});
    await run('mount("a");delay();seed("old-a");window.oldEditor=current.editor;window.oldRoot=surface();mount("b");delay();seed("new-b");selectText(5,5);emit("paste",{"text/plain":"!"});delay()');
    await check('session switch detaches old editor, binds actual resident surface','({a:shells.a.snapshot.draft,b:shells.b.snapshot.draft,oldDetached:oldEditor.getRootElement()===null,identity:oldRoot===surface(),focus:document.activeElement===surface()})',{a:'old-a',b:'new-b!',oldDetached:true,identity:true,focus:true});
    await run('oldEditor.dispatchCommand(api.paste,new ClipboardEvent("paste",{clipboardData:data({"text/plain":"late"}),cancelable:true}));delay()');
    await check('late old editor command cannot mutate newly selected session','shells.b.snapshot.draft','new-b!');
    await run('seed("IME");selectText(3,3);surface().dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:""}));surface().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true,cancelable:true}));delay()');
    await check('composition Enter does not submit','sends.length',0);
    await run('surface().dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:""}));delay();selectText(3,3);emit("paste",{"text/plain":"结束"});delay()');
    await check('paste after synthetic composition end retains text','current.snapshot.draft','IME结束');
    await run('seed("failure kept");selectText(0,7);window.beforeErrors=rendererErrors.length;window.failData=data({"text/plain":"ignored"});failData.getData=()=>{throw Error("synthetic getData failure")};surface().dispatchEvent(new ClipboardEvent("paste",{clipboardData:failData,bubbles:true,cancelable:true}));delay()');
    await check('clipboard read failure retains existing draft','current.snapshot.draft','failure kept');
    await check('read failure really traversed production handler','rendererErrors.slice(beforeErrors).some(x=>x.includes("synthetic getData failure"))',true);
    await run('seed("copy preserved");selectText(0,4);window.beforeErrors=rendererErrors.length;window.failData=data({});failData.setData=()=>{throw Error("synthetic setData failure")};surface().dispatchEvent(new ClipboardEvent("copy",{clipboardData:failData,bubbles:true,cancelable:true}));delay()');
    await check('clipboard write failure preserves editable content','current.snapshot.draft','copy preserved');
    await check('write failure really traversed production handler','rendererErrors.slice(beforeErrors).some(x=>x.includes("synthetic setData failure"))',true);
    await run('mount("b");delay();seed("recovered");selectText(9,9);emit("paste",{"text/plain":"!"});delay()');
    await check('normal paste recovers after clipboard port failures','current.snapshot.draft','recovered!');
    await run('seed("null clipboard");selectText(0,4);surface().dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true}));delay()');
    await check('missing ClipboardData preserves old content','current.snapshot.draft','null clipboard');
    await run('seed("outside safe");selectText(0,7);document.getElementById("outside").focus();document.getElementById("outside").dispatchEvent(new ClipboardEvent("paste",{clipboardData:data({"text/plain":"wrong target"}),bubbles:true,cancelable:true}));delay()');
    await check('paste targeted outside editor cannot change composer','({draft:current.snapshot.draft,outside:document.activeElement.id})',{draft:'outside safe',outside:'outside'});
    await run('(async()=>{window.switchResults=[];for(let i=0;i<20;i++){const id="cycle-"+i;mount(id);await delay();seed(id);selectText(id.length,id.length);emit("paste",{"text/plain":"!"});await delay();switchResults.push({draft:current.snapshot.draft,roots:Object.values(shells).filter(x=>x.editor.getRootElement()!==null).length})}})()');
    await check('twenty real component switches have one bound root and exactly one paste','switchResults',Array.from({length:20},(_,i)=>({draft:'cycle-'+i+'!',roots:1})));
    await run('window.detachedSurface=surface();window.detachedDraft=current.snapshot.draft;ReactDOM.flushSync(()=>domRoot.unmount());detachedSurface.dispatchEvent(new ClipboardEvent("paste",{clipboardData:data({"text/plain":"late detached"}),bubbles:true,cancelable:true}));delay()');
    await check('unmounted DOM events cannot edit disposed view','({unchanged:current.snapshot.draft===detachedDraft,roots:Object.values(shells).filter(x=>x.editor.getRootElement()!==null).length})',{unchanged:true,roots:0});
    await check('renderer native fallback and network ports never called','portAttempts',[]);
    await check('only explicitly injected data, never trusted clipboard events','eventLog.every(e=>e.trusted===false)',true);
    await check('unexpected renderer errors absent','rendererErrors.filter(e=>!e.includes("synthetic getData failure")&&!e.includes("synthetic setData failure"))',[]);
    await run('for(const shell of Object.values(shells))shell.dispose();delay()');
    assert.deepEqual(nativeAttempts,[]);assert.deepEqual(guard.attempts,[]);assert.deepEqual(blockedRequests,[]);
    const styles=(await run('Array.from(document.querySelectorAll("style[data-plugin-css]")).map(el=>({id:el.dataset.pluginCss,text:el.textContent}))')).map(({id,text})=>({id,sha256:sha(text),bytes:Buffer.byteLength(text)}));
    receipt={status:'passed',mode,engine:process.versions,checks,inputs:executedInputs,installation:installation===null?null:{file:installation.conversation,sha256:installation.actualInstalledSha256,receiptSha256:sha(fs.readFileSync(path.join(rootOut,'installation.json')))},styles,seams:{shell:{removed:boot,added:'window.shippedModules=zp();',sha256:sha(localShell)},conversation:{added:seam,sha256:sha(instrumented),reversible:true}},dependencies:await run('dependencies'),nativeAttempts,nodeNetworkAttempts:guard.attempts,blockedRequests,limitations:['All ClipboardEvents/DataTransfers synthetic; OS clipboard and native shortcuts forbidden',mode==='baseline'?'Cached visibility source only':'Actual temp installation read from disk; no renderer patch transform; app CLI not executed','Programmatic Lexical selection; physical drag, real IME, RTF, cross-app and platform-specific native paste not claimed']};
    fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));console.log('CLIPBOARD_COMPONENT_RECEIPT '+JSON.stringify({status:receipt.status,mode,checks:checks.length,inputs:executedInputs}));
  }catch(error){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:error.message,stack:error.stack,checks,nativeAttempts,nodeNetworkAttempts:guard.attempts,blockedRequests},null,2));throw error;}
  finally{win?.destroy();}
}
if(process.versions.electron){electronMain().then(()=>require('electron').app.exit(0),e=>{console.error(e);require('electron').app.exit(1)});}
else{
  const test=require('node:test');
  for(const mode of ['baseline','actual-installed'])test('actual clipboard components: '+mode,{timeout:120000},async()=>{
    const rootOut=isolation(),out=path.join(rootOut,mode);fs.mkdirSync(out,{recursive:true});inputs();verifyFrozen();const before=harnessHashes();
    const archive=fs.readFileSync(path.join(repo,'.artifacts/deep-audit-round1-clipboard/submission1-snapshot/deep-audit-clipboard-components.test.cjs'),'utf8');
    assert.equal(sha(archive),'2a93ecaaee4ef6782fda0ffe216ca1694eb5e387b4d86dddd23bc79f998b995e');
    const comparisonBody=text=>text.slice(text.indexOf('    const check=async'),text.indexOf("    await run('for(const shell of Object.values(shells))shell.dispose();delay()');"));
    assert.equal(comparisonBody(fs.readFileSync(__filename,'utf8')),comparisonBody(archive),'All original 32 check setup/assertion bytes remain unchanged');
    fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify({cacheInputs:expected,frozen,harness:before,comparisonBodySha256:sha(comparisonBody(archive)),environmentKeys:Object.keys(process.env).sort()},null,2));
    let installation=null;
    if(mode==='actual-installed')installation=await require('./fixtures/deep-audit-clipboard-components/install-current.cjs').install(repo,rootOut);
    const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','CLIPBOARD_AUDIT_RUN'].map(k=>[k,process.env[k]]).filter(([,v])=>v!==undefined));
    const log=fs.openSync(path.join(out,'electron.log'),'wx');let result;
    try{result=require('node:child_process').spawnSync(path.join(repo,inputNames.electron),[__filename,'--'+mode],{cwd:repo,env,stdio:['ignore',log,log],timeout:100000});}finally{fs.closeSync(log);}
    assert.ifError(result.error);assert.equal(result.status,0,'see '+mode+'/electron.log and failure.json');
    const receipt=JSON.parse(fs.readFileSync(path.join(out,'receipt.json'),'utf8'));assert.equal(receipt.status,'passed');assert.equal(receipt.checks.length,32);
    if(mode==='actual-installed'){
      assert.equal(receipt.inputs.conversation,installation.actualInstalledSha256);
      assert.equal(sha(fs.readFileSync(path.join(rootOut,installation.conversation))),installation.actualInstalledSha256);
      const base=JSON.parse(fs.readFileSync(path.join(rootOut,'baseline/receipt.json'),'utf8'));assert.deepEqual(receipt.checks,base.checks,'Exact same 32 actual results and assertions');
      for(const[file,hash]of Object.entries(installation.sourceHashes))assert.equal(sha(fs.readFileSync(path.join(repo,file))),hash,'Real input unchanged after component execution');
      for(const[name,record]of Object.entries(installation.metadata))assert.equal(sha(fs.readFileSync(path.join(rootOut,installation.runtime,'node_modules',name,'package.json'))),record.sha256);
      assert.deepEqual(require('./fixtures/deep-audit-clipboard-components/install-current.cjs').moduleHashes(repo),installation.installerModules);
      const cssIds=[...new Set([...base.styles,...receipt.styles].map(s=>s.id))];
      const cssDiff=cssIds.map(id=>({id,baseline:base.styles.find(s=>s.id===id)?.sha256??null,installed:receipt.styles.find(s=>s.id===id)?.sha256??null})).filter(x=>x.baseline!==x.installed);
      const fileDiff=Object.keys(installation.stages[0].files).map(name=>({name,cached:installation.stages[0].files[name],installed:installation.stages.at(-1).files[name]})).filter(x=>x.cached!==x.installed);
      fs.writeFileSync(path.join(rootOut,'comparison.json'),JSON.stringify({status:'passed',baselineChecks:32,installedChecks:32,assertionBodySha256:sha(comparisonBody(archive)),resultsEqual:true,cssDiff,fileDiff,baselineReceiptSha256:sha(fs.readFileSync(path.join(rootOut,'baseline/receipt.json'))),installedReceiptSha256:sha(fs.readFileSync(path.join(out,'receipt.json')))},null,2));
    }
    assert.deepEqual(guard.attempts,[]);inputs();verifyFrozen();assert.deepEqual(harnessHashes(),before);
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'passed',mode,nodeTests:1,componentChecks:receipt.checks.length,inputs:receipt.inputs,frozen,harness:before,receiptSha256:sha(fs.readFileSync(path.join(out,'receipt.json'))),drift:0},null,2));
  });
}
