'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const guard=require('./fixtures/deep-audit-settings-components/deny-network.cjs');
const repo=path.resolve(__dirname,'..'),fixture=path.join(__dirname,'fixtures/deep-audit-settings-components');
const sha=b=>createHash('sha256').update(b).digest('hex');
const pinned={
'renderer/app.js':'3086aae0818e127ee12ac4db989ab9ed0760c68efbcb67eb3943de069e2064fa',
'renderer/index.html':'1a338ec3017db59fe7f8ae6dc468cc87f77592bb1d61d390309dacad161fafe9',
'renderer/styles.css':'091929333dedea6eb0892cc32d24be327b476b1738e40490cfe778dda2fe64c8',
'renderer/right-workspace.css':'ca9cf7220f161672dd894a1bbd46eedf588ae499f9b8cb615948195720a1d60b',
'renderer/modal-focus.js':'1d85ed57f85d9d508af10edef70a5cb5ee6dfb4d92ff2413cb064e30a9f481cd',
'renderer/theme-catalog.js':'23f1ad41624790be5d4425e97923dfdff8f8454c1eef6d2d57ad0692827670ff',
'renderer/theme-integration.js':'002e541379cb6d4d0d2eec5cbde03123e860f832c5222aff5e85b830a3cad340',
'renderer/assets/deepseek-icon.svg':'8489214b4e427b511073ebfbd0b68276b3f56ee9325abc8a5c18215344506f5c',
'node_modules/@xterm/xterm/css/xterm.css':'854a7c0fb70e8b1a083c16797ab827299fb18744f5ad34f227b48337e33293c6',
'node_modules/electron/dist/electron.exe':'8593db40c0c6e5e3c4b6b0a225b1dc9a549ecdf10f6cf2010cf5b6ce869ce07f'};
const frozen={'docs/deep-audit/coverage-master.json':'8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794','docs/deep-audit/interaction.md':'8114d11e4b707c8c41b4403cf152c923ba237ec38d6feb95d27741efdfad3388','tests/deep-audit-clipboard-components.test.cjs':'5516d18bee7972be4921a86b3a84f21861eb2c4bd00958f50b496a13cfdda78c'};
function verify(){for(const [name,hash]of Object.entries({...pinned,...frozen}))assert.equal(sha(fs.readFileSync(path.join(repo,name))),hash,'Input drift '+name)}
function harnessHashes(){return Object.fromEntries([__filename,...['run.ps1','renderer.js','checks.js','deny-network.cjs'].map(x=>path.join(fixture,x))].map(f=>[path.relative(repo,f),sha(fs.readFileSync(f))]))}
function isolation(){const out=process.env.SETTINGS_AUDIT_RUN;assert.ok(out,'Use settings fixture run.ps1');assert.equal(path.dirname(out),path.join(repo,'.artifacts/deep-audit-round2-settings'));const allowed=new Set(['SYSTEMROOT','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','SETTINGS_AUDIT_RUN','NODE_TEST_CONTEXT','NODE_TEST_WORKER_ID']);for(const k of Object.keys(process.env))assert.ok(allowed.has(k.toUpperCase()),'Unexpected env '+k);for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])assert.equal(process.env[k],path.join(out,'profile'));assert.equal(process.env.DSH_HOME,path.join(out,'profile/dsh'));return out}
async function electronMain(){
 const out=isolation();verify();const profile=path.join(out,'profile/electron');fs.mkdirSync(profile,{recursive:true});
 const electron=require('electron'),{app,BrowserWindow}=electron,nativeAttempts=[],blockedRequests=[],allowedRequests=[];
 const deny=name=>(...args)=>{nativeAttempts.push(name);throw Error('NATIVE_DENIED:'+name)};
 for(const domain of ['clipboard','shell','dialog','desktopCapturer','globalShortcut'])for(const name of Object.keys(electron[domain]||{}))if(typeof electron[domain][name]==='function')electron[domain][name]=deny(domain+'.'+name);
 for(const name of ['request','fetch','resolveHost'])if(typeof electron.net[name]==='function')electron.net[name]=deny('net.'+name);
 app.setPath('userData',profile);app.setPath('sessionData',profile);for(const name of ['disable-background-networking','disable-component-update','disable-sync','no-proxy-server'])app.commandLine.appendSwitch(name);app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');app.on('window-all-closed',()=>{});
 let win;const seams=[];
 try{
 await app.whenReady();win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:false,backgroundThrottling:false,partition:'settings-synthetic'}});
 for(const name of ['copy','cut','paste','pasteAndMatchStyle','selectAll','undo','redo','copyImageAt','insertText','sendInputEvent'])win.webContents[name]=deny('webContents.'+name);
 for(const name of ['show','showInactive','focus','minimize','maximize','unmaximize','restore','setPosition','setBounds','setAlwaysOnTop'])win[name]=deny('window.'+name);
 const ses=win.webContents.session;ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);ses.on('will-download',e=>{e.preventDefault();nativeAttempts.push('download')});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.on('will-attach-webview',e=>e.preventDefault());
 const local=[];const copy=(source,target)=>{const dest=path.join(profile,target);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(repo,source),dest);local.push(dest)};
 for(const name of ['styles.css','right-workspace.css','assets/deepseek-icon.svg'])copy('renderer/'+name,name);copy('node_modules/@xterm/xterm/css/xterm.css','xterm.css');
 let html=fs.readFileSync(path.join(repo,'renderer/index.html'),'utf8');const originalHtml=html;
 // Every exact replacement is recorded and verified reversible. No theme markup is rewritten.
 const replace=(before,after,label)=>{assert.equal(html.split(before).length,2,label);html=html.replace(before,after);seams.push({target:'html',label,before,after})};
 const scripts=[...html.matchAll(/  <script[^>]*>[\s\S]*?<\/script>/g)].map(x=>x[0]);for(let i=0;i<scripts.length;i++)replace(scripts[i],`  <!-- audit-script-${i} -->`,'remove auto script '+i);
 const csp=html.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];replace(csp,`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none';">`,'tighten CSP');
 replace('../node_modules/@xterm/xterm/css/xterm.css','./xterm.css','local exact xterm css');replace('<webview id="runtimeView" partition="persist:harness"></webview>','<div id="runtimeView" data-audit-inert-guest="true"></div>','no webview');
 let reverse=html;for(const s of [...seams].reverse())reverse=reverse.replace(s.after,s.before);assert.equal(reverse,originalHtml);
 const page=path.join(profile,'fixture.html');fs.writeFileSync(page,html);local.push(page);
 const fileUrls=new Set(local.map(f=>require('node:url').pathToFileURL(f).href));ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(d,cb)=>{const ok=fileUrls.has(d.url);(ok?allowedRequests:blockedRequests).push(d.url);cb({cancel:!ok})});
 await win.loadFile(page);const run=s=>win.webContents.executeJavaScript(s);
 await run(fs.readFileSync(path.join(fixture,'renderer.js'),'utf8')+'\n;void 0;');
 for(const name of ['modal-focus.js','theme-catalog.js','theme-integration.js'])await run(fs.readFileSync(path.join(repo,'renderer',name),'utf8'));
 const source=fs.readFileSync(path.join(repo,'renderer/app.js'),'utf8');const before="playStartupAnimation()\r\nstartOfficialWorkspace().catch(error => renderRuntimeState({ status: 'error', detail: error.message }))";
 const after="window.audit={open:openSkinPicker,close:closeSkinPicker,seed(state){appearanceState=state;themeCatalog=themeIntegration.prepareCatalog(window.harnessDesktopThemes,{});applyShellTheme();applyShellUiMode();renderSkinPicker()},snapshot(){return JSON.parse(JSON.stringify(appearanceState))}}";
 assert.equal(source.split(before).length,2);const instrumented=source.replace(before,after);assert.equal(instrumented.replace(after,before),source);seams.push({target:'app',before,after});fs.writeFileSync(path.join(profile,'app.instrumented.js'),instrumented);
 await run(instrumented+'\n;void 0;');await run('audit.seed(base());void 0');
 await run(fs.readFileSync(path.join(fixture,'checks.js'),'utf8')+'\n;void 0;');
 const checks=await run('runChecks()');
 await win.webContents.setZoomFactor(2);await run('reset();tick()');
 const zoom=await run('(()=>{const r=modal().getBoundingClientRect();return {width:innerWidth,height:innerHeight,left:r.left,top:r.top,right:r.right,bottom:r.bottom,scrollWidth:modal().scrollWidth,clientWidth:modal().clientWidth,overflow:getComputedStyle(modal()).overflowY}})()');
 checks.push({name:'200% zoom dialog stays within viewport and scrollable width',expected:true,observed:zoom.left>=0&&zoom.top>=0&&zoom.right<=zoom.width+1&&zoom.bottom<=zoom.height+1&&zoom.scrollWidth<=zoom.clientWidth+1,details:zoom});
 const ports=await run('({attempts:portAttempts,errors:allErrors,trace,subscriptions,calls:calls.map(({name,arg,settled})=>({name,arg,settled}))})');
 assert.deepEqual(nativeAttempts,[]);assert.deepEqual(guard.attempts,[]);assert.deepEqual(ports.attempts,[]);assert.deepEqual(blockedRequests,[]);
 const failed=checks.filter(x=>!require('node:util').isDeepStrictEqual(x.observed,x.expected));
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({status:failed.length?'product-findings':'passed',engine:process.versions,checks,failed:failed.map(x=>x.name),inputs:pinned,seams,outputs:{html:sha(html),app:sha(instrumented)},reversible:true,ports,nativeAttempts,nodeNetworkAttempts:guard.attempts,allowedRequests,blockedRequests,limits:['Actual maintained renderer DOM/CSS/handlers; bridge/settings storage synthetic only','No official guest dialog, native events, OS settings, screen reader or real IME','No production source changes; bootstrap removed and private state seed/export only']},null,2));
 verify();return failed.length;
 }catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,seams,nativeAttempts,blockedRequests},null,2));throw e}finally{win?.destroy()}
}
if(process.versions.electron)electronMain().then(()=>require('electron').app.exit(0),e=>{console.error(e);require('electron').app.exit(1)});
else require('node:test')('actual settings DOM evidence; desired outcomes retain red findings',{timeout:120000},()=>{const out=isolation();verify();const before=harnessHashes();fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify({pinned,frozen,harness:before,environmentKeys:Object.keys(process.env).sort()},null,2));const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','SETTINGS_AUDIT_RUN'].map(k=>[k,process.env[k]]).filter(([,v])=>v!==undefined));const log=fs.openSync(path.join(out,'electron.log'),'wx');let result;try{result=require('node:child_process').spawnSync(path.join(repo,'node_modules/electron/dist/electron.exe'),[__filename],{cwd:repo,env,stdio:['ignore',log,log],timeout:100000})}finally{fs.closeSync(log)}assert.ifError(result.error);assert.equal(result.status,0,'see failure.json/electron.log');verify();assert.deepEqual(harnessHashes(),before);const receipt=JSON.parse(fs.readFileSync(path.join(out,'receipt.json'),'utf8'));fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:receipt.status,checks:receipt.checks.length,failures:receipt.failed.length,drift:0,receiptSha256:sha(fs.readFileSync(path.join(out,'receipt.json'))),harness:before},null,2));assert.deepEqual(receipt.failed,[],'Product findings: '+receipt.failed.join('; '));});
