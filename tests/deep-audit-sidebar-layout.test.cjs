'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const guard=require('./fixtures/deep-audit-sidebar-layout/deny-network.cjs');
const repo=path.resolve(__dirname,'..'),fixture=path.join(__dirname,'fixtures/deep-audit-sidebar-layout'),sha=b=>createHash('sha256').update(b).digest('hex');
const pinned=require('./fixtures/deep-audit-sidebar-layout/pins.json');
const inputs=Object.keys(pinned);
const hashes=()=>{const result=Object.fromEntries(inputs.map(f=>[f,sha(fs.readFileSync(path.join(repo,f)))]));assert.deepEqual(result,pinned,'Pinned input drift; retain red evidence and explicitly review new source');return result;};
const harnessHashes=()=>Object.fromEntries([__filename,...['run.ps1','deny-network.cjs','ports.js','pins.json'].map(x=>path.join(fixture,x))].map(f=>[path.relative(repo,f),sha(fs.readFileSync(f))]));
function isolation(){const out=process.env.SIDEBAR_AUDIT_RUN;assert.ok(out);assert.equal(path.dirname(out),path.join(repo,'.artifacts/deep-audit-round2-sidebar-layout'));const allowed=new Set(['SYSTEMROOT','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','SIDEBAR_AUDIT_RUN','NODE_TEST_CONTEXT','NODE_TEST_WORKER_ID']);for(const k of Object.keys(process.env))assert.ok(allowed.has(k.toUpperCase()),'Unexpected env '+k);for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])assert.equal(process.env[k],path.join(out,'profile'));assert.equal(process.env.DSH_HOME,path.join(out,'profile/dsh'));return out;}
async function electronMain(){
 const out=isolation(),before=hashes(),profile=path.join(out,'profile/electron');fs.mkdirSync(profile,{recursive:true});
 const electron=require('electron'),{app,BrowserWindow,WebContentsView,webContents}=electron;
 const nativeAttempts=[],blockedRequests=[],allowedRequests=[],seams=[],measurements=[];const deny=name=>(...args)=>{nativeAttempts.push(name);throw Error('NATIVE_DENIED:'+name)};
 for(const domain of ['clipboard','shell','dialog','desktopCapturer','globalShortcut'])for(const name of Object.keys(electron[domain]||{}))if(typeof electron[domain][name]==='function')electron[domain][name]=deny(domain+'.'+name);
 for(const name of ['request','fetch','resolveHost'])if(typeof electron.net[name]==='function')electron.net[name]=deny('net.'+name);
 app.setPath('userData',profile);app.setPath('sessionData',profile);for(const name of ['disable-background-networking','disable-component-update','disable-sync','no-proxy-server'])app.commandLine.appendSwitch(name);app.commandLine.appendSwitch('host-resolver-rules','MAP * ~NOTFOUND');app.on('window-all-closed',()=>{});
 let win;const nativeViews=[];const files=new Set();const file=(name,text)=>{const dest=path.join(profile,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,text);files.add(pathToFileURL(dest).href);return dest};
 const copy=(source,name)=>file(name,fs.readFileSync(path.join(repo,source)));
 try{
 await app.whenReady();
 const shellPage=path.join(profile,'shell.html'),guestPage=file('guest.html','<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\'"><style>html,body{margin:0;width:100%;height:100%;background:#d5eeee}body{box-sizing:border-box;border-right:4px solid #136464}</style><main data-audit-synthetic-conversation>LAYOUT FIXTURE ONLY</main>');
 copy('renderer/styles.css','styles.css');copy('renderer/right-workspace.css','right-workspace.css');copy('renderer/assets/deepseek-icon.svg','assets/deepseek-icon.svg');copy('node_modules/@xterm/xterm/css/xterm.css','xterm.css');
 let html=fs.readFileSync(path.join(repo,'renderer/index.html'),'utf8'),original=html;
 const replace=(a,b,label)=>{assert.equal(html.split(a).length,2,label);html=html.replace(a,b);seams.push({target:'shell',label,before:a,after:b})};
 for(const [i,m]of [...html.matchAll(/  <script[^>]*>[\s\S]*?<\/script>/g)].entries())replace(m[0],`  <!-- omitted bootstrap ${i} -->`,'omit auto script '+i);
 replace(html.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0],'<meta http-equiv="Content-Security-Policy" content="default-src \'none\';img-src \'self\';style-src \'self\' \'unsafe-inline\';script-src \'none\';frame-src \'self\';connect-src \'none\';object-src \'none\';">','tighten CSP');
 replace('../node_modules/@xterm/xterm/css/xterm.css','./xterm.css','local stylesheet');replace('<webview id="runtimeView" partition="persist:harness"></webview>',`<webview id="runtimeView" partition="sidebar-synthetic" src="${pathToFileURL(guestPage).href}"></webview>`,'fresh synthetic guest; original webview element retained');
 let reversed=html;for(const s of [...seams].reverse())reversed=reversed.replace(s.after,s.before);assert.equal(reversed,original);file('shell.html',html);
 const secure=wc=>{for(const name of ['copy','cut','paste','pasteAndMatchStyle','copyImageAt','insertText','sendInputEvent'])wc[name]=deny('webContents.'+name);wc.setWindowOpenHandler(()=>({action:'deny'}));wc.on('will-navigate',e=>e.preventDefault());};
 const ses=electron.session.fromPartition('sidebar-synthetic');ses.setPermissionRequestHandler((_w,_p,cb)=>cb(false));ses.setPermissionCheckHandler(()=>false);ses.on('will-download',e=>{e.preventDefault();nativeAttempts.push('download')});ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(d,cb)=>{const ok=files.has(d.url)||d.url==='about:blank';(ok?allowedRequests:blockedRequests).push(d.url);cb({cancel:!ok})});
 win=new BrowserWindow({show:false,frame:false,width:1460,height:930,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webviewTag:true,backgroundThrottling:false,partition:'sidebar-synthetic'}});secure(win.webContents);
 for(const name of ['show','showInactive','focus','minimize','maximize','unmaximize','restore','setPosition','setAlwaysOnTop'])win[name]=deny('window.'+name);
 win.webContents.on('will-attach-webview',(event,prefs,params)=>{if(params.src!==pathToFileURL(guestPage).href||params.partition!=='sidebar-synthetic'){event.preventDefault();nativeAttempts.push('unexpected-webview');return}delete prefs.preload;prefs.nodeIntegration=false;prefs.contextIsolation=true;prefs.sandbox=true;});
 win.webContents.on('did-attach-webview',(_e,wc)=>secure(wc));
 await win.loadFile(shellPage);const run=s=>win.webContents.executeJavaScript(s);await run(fs.readFileSync(path.join(fixture,'ports.js'),'utf8')+'\n;void 0;');
 for(const name of ['right-workspace.js','right-workspace-integration.js'])await run(fs.readFileSync(path.join(repo,'renderer',name),'utf8')+'\n;void 0;');
 await run('document.querySelector("#startupSplash").remove(); document.querySelector("#runtimeStatus").classList.add("ready");void 0');
 const guestId=await run('document.querySelector("#runtimeView").getWebContentsId()'),guest=webContents.fromId(guestId);await guest.executeJavaScript('document.readyState');
 // Native layout functions are exact unmodified slices, with only their state dependencies bound to isolated views.
 const main=fs.readFileSync(path.join(repo,'electron/main.cjs'),'utf8');const fn=(name,next)=>main.slice(main.indexOf('function '+name+'('),main.indexOf('\nfunction '+next+'(',main.indexOf('function '+name+'(')));
 const source=fn('effectiveBrowserPanelWidth','liveBrowserContents')+'\n'+fn('layoutBrowserView','browserRecoveryState');assert.ok(source.includes('tab.view.setBounds(bounds)'));seams.push({target:'native',label:'exact functions with injected isolated state; full main startup not loaded',source,sha256:sha(source)});
 for(let i=0;i<2;i++){const view=new WebContentsView({webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'sidebar-synthetic'}});nativeViews.push(view);secure(view.webContents);win.contentView.addChildView(view);view.setVisible(false);await view.webContents.loadURL('about:blank');}
 const state={mainWindow:win,browserTabs:new Map(nativeViews.map((view,i)=>[String(i),{view}])),activeBrowserTabId:'0',browserSidebarVisible:false,browserContentVisible:false,browserPanelWidth:640,browserWideMode:false,BROWSER_PANEL_DEFAULT_WIDTH:640,BROWSER_PANEL_MIN_WIDTH:360,BROWSER_PANEL_MAX_WIDTH:1400,BROWSER_VIEW_TOP:158,BROWSER_VIEW_FOOTER:34};
 const vm=require('node:vm');vm.createContext(state);vm.runInContext(source+'\nthis.layout=layoutBrowserView',state);
 const settle=()=>new Promise(r=>setTimeout(r,100));
 const measure=async name=>{const events=await run('events.splice(0)');for(const e of events){if(e.type==="visibility")state.browserSidebarVisible=e.v;else if(e.type==="contentVisibility")state.browserContentVisible=e.v;}state.layout();const preflush=await run('auditGeometry()');await settle();const dom=await run('auditGeometry()');const actualGuest=await guest.executeJavaScript('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,hidden:document.hidden,body:document.body.getBoundingClientRect().toJSON()})');const native=nativeViews.map(v=>({bounds:v.getBounds(),visible:v.getVisible()}));measurements.push({name,atMs:performance.now(),window:win.getContentSize(),zoom:win.webContents.getZoomFactor(),preflush,dom,actualGuest,events,native});};
 await measure('closed-initial');await run('harnessDesktopRightWorkspace.openHome()');await measure('home-1460');
 for(const width of [1200,1000,901,900,760,1460]){win.setContentSize(width,930);await measure('home-resize-'+width);}
 await run('harnessDesktopRightWorkspace.openMode("browser")');await measure('browser-640');
 await run('harnessDesktopRightWorkspace.openHome()');await measure('screenshot-sequence-home-100ms');
 const capture=await win.webContents.capturePage();fs.writeFileSync(path.join(out,'synthetic-shell-home.png'),capture.toPNG());await measure('screenshot-sequence-after-paint');
 await new Promise(r=>setTimeout(r,1500));await measure('screenshot-sequence-home-1700ms');
 await run('harnessDesktopRightWorkspace.openMode("browser")');
 for(const width of [1000,901,900,760,1460]){win.setContentSize(width,930);await measure('browser-resize-'+width);await new Promise(r=>setTimeout(r,1200));await measure('browser-stable-'+width);}
 win.webContents.setZoomFactor(1.25);await measure('browser-125pct');await new Promise(r=>setTimeout(r,1200));await measure('browser-stable-125pct');win.webContents.setZoomFactor(1);await measure('browser-zoom-restored');
 state.activeBrowserTabId='1';await measure('browser-tab-1');state.activeBrowserTabId='0';await measure('browser-tab-0');
 await run('harnessDesktopRightWorkspace.openHome()');await measure('browser-to-home');
 await run('harnessDesktopRightWorkspace.close()');await measure('closed-after-home');
 await run('harnessDesktopRightWorkspace.openHome()');win.webContents.setZoomFactor(1.25);await measure('home-125pct');win.webContents.setZoomFactor(1);await measure('home-zoom-restored');
 await run('harnessDesktopRightWorkspace.close();harnessDesktopRightWorkspace.openHome();harnessDesktopRightWorkspace.openMode("browser");harnessDesktopRightWorkspace.openHome();void 0');await measure('rapid-home-browser-home');
 await new Promise(r=>setTimeout(r,1500));await measure('home-long-wait');
 win.setContentSize(1461,930);await measure('home-window-resize-plus-one');win.setContentSize(1460,930);await measure('home-window-resize-restore');
 await run('harnessDesktopRightWorkspace.syncBrowserState({visible:true});void 0');await measure('home-stale-native-visible');
 await run('harnessDesktopRightWorkspace.setContext({sessionId:"fixture-A"});harnessDesktopRightWorkspace.openMode("files");void 0');await measure('empty-files-A');
 await run('harnessDesktopRightWorkspace.setContext({sessionId:"fixture-B"});void 0');await measure('empty-files-B');await run('harnessDesktopRightWorkspace.openHome()');
 guest.setBackgroundThrottling(false);await measure('home-guest-no-throttle');
 await run('harnessDesktopRightWorkspace.openMode("browser")');await measure('no-throttle-browser');await run('harnessDesktopRightWorkspace.openHome()');await measure('no-throttle-home');
 for(const v of nativeViews)win.contentView.removeChildView(v);state.browserTabs.clear();await measure('native-views-detached');
 await run('harnessDesktopRightWorkspace.openMode("browser")');await measure('detached-browser');await run('harnessDesktopRightWorkspace.openHome()');await measure('detached-home');
 const ports=await run('({attempts:portAttempts,errors:auditErrors})');
 const checks=[];const check=(name,observed,expected,details)=>checks.push({name,observed,expected,pass:require('node:util').isDeepStrictEqual(observed,expected),details});
 const byName=name=>measurements.find(m=>m.name===name);
 for(const m of measurements.filter(m=>m.name.startsWith('home-resize-')||m.name==='home-1460'))check(m.name+' shell reserves exactly one home rail',Math.round(m.dom.runtime.width),m.dom.viewport>900?Math.max(560,m.dom.viewport-320):m.dom.viewport,{panelX:m.dom.panel.x,panelWidth:m.dom.panel.width});
 for(const m of measurements.filter(m=>m.name.startsWith('browser-stable-'))){const bounds=m.native.find(v=>v.visible)?.bounds;const physical={x:m.dom.panel.x*m.zoom,width:m.dom.panel.width*m.zoom};check(m.name+' native horizontal bounds match rendered panel',Boolean(bounds&&Math.abs(bounds.x-physical.x)<=1&&Math.abs(bounds.width-physical.width)<=1),true,{native:bounds,renderedDIP:physical,zoom:m.zoom});}
 for(const name of ['browser-tab-0','browser-tab-1'])check(name+' only selected native tab visible',byName(name).native.map(v=>v.visible),name.endsWith('1')?[false,true]:[true,false]);
 check('browser to home hides all native views',byName('screenshot-sequence-home-1700ms').native.every(v=>!v.visible),true);
 check('close releases host reservation',byName('closed-after-home').dom.runtime.width,1460);
 check('stale native visible does not replace home mode',byName('home-stale-native-visible').dom.mode,'home');
 for(const name of ['empty-files-A','empty-files-B'])check(name+' keeps single 640px tool reservation',[byName(name).dom.runtime.width,byName(name).dom.panel.width],[820,640]);
 check('rapid mode sequence ends in home',byName('rapid-home-browser-home').dom.mode,'home');
 // Exact official solver source, not a substitute renderer or a rewritten formula.
 const official=fs.readFileSync(path.join(repo,'node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js'),'utf8');const start=official.indexOf('\t\tfunction clampWidth('),end=official.indexOf('\n\t\t//#endregion',start);assert.ok(start>0&&end>start);const columnsSource=official.slice(start,end);const columnContext={};vm.createContext(columnContext);vm.runInContext(columnsSource+'\nthis.solve=computeColumns',columnContext);seams.push({target:'official-column-solver',label:'original computeColumns and clampWidth only; React AppFrame not mounted',sha256:sha(columnsSource),source:columnsSource});
 for(const viewport of [1140,820])check('official solver has no details reservation at '+viewport,columnContext.solve(viewport,280,320).details,0);
 const failures=checks.filter(c=>!c.pass).map(c=>c.name);fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({checks:checks.length,passed:checks.length-failures.length,failures,sourceDrift:0,screenshotReproduction:'transient guest viewport lag only; persistent user white column not established',geometry:checks.filter(c=>c.details?.renderedDIP)},null,2));
 assert.deepEqual(hashes(),before);assert.deepEqual(nativeAttempts,[]);assert.deepEqual(guard.attempts,[]);assert.deepEqual(ports.attempts,[]);assert.deepEqual(blockedRequests,[]);
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({engine:process.versions,inputs:before,sourceDrift:0,screenshotSha256:'77ba43e3b9fa171da5f426b7f0804cb4622100691265a4ad573bf2876bfa3299',seams,measurements,checks,failures,ports,nativeAttempts,nodeNetworkAttempts:guard.attempts,blockedRequests,allowedRequests,limits:['Real original shell DOM/CSS/controller + real webview; guest content synthetic, no official conversation application','Original native layout functions + real isolated WebContentsViews; state command transport synthetic','No current installed GUI/profile inspected; screenshot is visual hypothesis only']},null,2));
 }catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,measurements,seams,nativeAttempts,blockedRequests},null,2));throw e}finally{for(const v of nativeViews)v.webContents.close();win?.destroy();}
}
if(process.versions.electron)electronMain().then(()=>require('electron').app.exit(0),e=>{console.error(e);require('electron').app.exit(1)});
else require('node:test')('isolated real shell, guest and native sidebar geometry',{timeout:120000},()=>{const out=isolation(),before=hashes(),harness=harnessHashes();fs.writeFileSync(path.join(out,'inputs.json'),JSON.stringify({inputs:before,harness,environmentKeys:Object.keys(process.env).sort()},null,2));const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','SIDEBAR_AUDIT_RUN'].map(k=>[k,process.env[k]]).filter(([,v])=>v!==undefined));const log=fs.openSync(path.join(out,'electron.log'),'wx');let result;try{result=require('node:child_process').spawnSync(path.join(repo,'node_modules/electron/dist/electron.exe'),[__filename],{cwd:repo,env,stdio:['ignore',log,log],timeout:100000})}finally{fs.closeSync(log)}assert.ifError(result.error);assert.equal(result.status,0,'see failure.json/electron.log');assert.deepEqual(hashes(),before);assert.deepEqual(harnessHashes(),harness);const receipt=JSON.parse(fs.readFileSync(path.join(out,'receipt.json')));console.log(JSON.stringify({checks:receipt.checks.length,failures:receipt.failures,receiptSha256:sha(fs.readFileSync(path.join(out,'receipt.json')))}));assert.deepEqual(receipt.failures,[],'Desired geometry assertions retain confirmed red evidence');});
