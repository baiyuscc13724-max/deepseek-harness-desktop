'use strict';
module.exports=async function eventCases({win,state,run,measure,observer,initialize,shellPage,nativeViews,settle,makePeer}){
 const checks=[];const record=(name,pass,details)=>checks.push({name,observed:pass,expected:true,pass,details});
 if(!state.bindEvents){record('event subscription available in source',false,{originalSource:true});return checks;}
 const contents=win.webContents;const bounds=()=>JSON.stringify(nativeViews.map(v=>({bounds:v.getBounds(),visible:v.getVisible(),boundsWrites:v.auditBoundsWrites})));
 const loaded=action=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture document load timed out')),6000);contents.once('did-finish-load',()=>{clearTimeout(timer);resolve();});Promise.resolve().then(action).catch(reject);});
 const browserReady=async()=>{await initialize();await run('harnessDesktopRightWorkspace.openMode("browser")');await measure('event-browser-setup');};
 const reload=async()=>{await loaded(()=>contents.reload());await browserReady();await settle();};
 // Restore this synthetic owner after the preceding stale-owner experiment.
 state.bindEvents(win)();const stop=state.bindEvents(win);await settle();
 const countBefore=[win.listenerCount('resize'),contents.listenerCount('did-start-navigation'),contents.listenerCount('did-finish-load')];
 const same=state.bindEvents(win);record('duplicate owner binding reuses one listener set',same===stop&&JSON.stringify(countBefore)===JSON.stringify([win.listenerCount('resize'),contents.listenerCount('did-start-navigation'),contents.listenerCount('did-finish-load')]));
 await run('harnessDesktopRightWorkspace.openMode("browser")');await measure('event-browser-ready');
 for(const zoom of [0.8,1.25,1.5,1,2,1.25])contents.setZoomFactor(zoom);
 for(const width of [901,1460,1000,1200,1460])win.setContentSize(width,930);
 await measure('edge-event-continuous-zoom-resize',false);
 state.activeBrowserTabId='1';contents.setZoomFactor(1.5);await measure('edge-event-tab-switch-zoom',false);record('event relayout retains selected native tab',nativeViews[1].getVisible()&&!nativeViews[0].getVisible());state.activeBrowserTabId='0';
 await settle();observer.audit.holdNext=true;const gapDelivery=observer.waitDelivery();contents.setZoomFactor(1.25);await gapDelivery;
 contents.setZoomFactor(0.8);contents.setZoomFactor(2);observer.audit.held.shift().resolve();await measure('edge-event-rearm-gap-final-zoom',false);
 // Hold the actual old-document response, reload, then deliver it unchanged.
 await settle();observer.audit.holdNext=true;const oldDelivery=observer.waitDelivery();contents.setZoomFactor(1.25);await oldDelivery;
 const old=observer.audit.held.shift();await reload();contents.setZoomFactor(1.5);await measure('edge-event-reload-zoom',false);const beforeLate=bounds();old.resolve();await settle();record('late old-document resolve cannot change reloaded geometry',bounds()===beforeLate);
 // Hold A's real reply while B owns a different real native view.
 for(const outcome of ['resolve','reject']){await settle();observer.audit.holdNext=true;const ownerDelivery=observer.waitDelivery();contents.setZoomFactor(contents.getZoomFactor()===1.25?1.5:1.25);await ownerDelivery;const oldOwner=observer.audit.held.shift();
 const savedTabs=state.browserTabs,peer=await makePeer(),peerContents=peer.view.webContents;
 try {
  state.mainWindow=peer.window;state.browserTabs=new Map([['0',{view:peer.view}]]);state.activeBrowserTabId='0';state.bindEvents(peer.window);
  await new Promise(r=>setTimeout(r,1300));
  const snapshot=()=>({bounds:peer.view.getBounds(),writes:peer.stats.boundsWrites,visible:peer.view.getVisible()});
  const peerBefore=snapshot(),hadGeometry=peerBefore.bounds.width>0&&peerBefore.visible&&peerBefore.writes>0;
  const actualReply=observer.audit.resolved.find(item=>item.call===oldOwner.call),releasedAtMs=performance.now();
  if(outcome==='resolve')oldOwner.resolve();else oldOwner.reject(Error('FIXTURE_LATE_OLD_OWNER_REJECT'));
  await settle();const peerAfter=snapshot();
  record('late old-window '+outcome+' cannot write new-owner native geometry',hadGeometry&&Array.isArray(actualReply?.value)&&JSON.stringify(peerAfter)===JSON.stringify(peerBefore),{transport:'actual A renderer tuple held after executeJavaScript completion; rejection injected only for reject branch',actualReply,releasedAtMs,observedAtMs:performance.now(),peerBefore,peerAfter});
  // Electron may clear view.webContents after close; retain the real contents handle.
  peerContents.close();await settle();let safe=true;try{state.layout()}catch{safe=false}
  record('destroyed peer native tab ignored after '+outcome,safe&&peerContents.isDestroyed());
 } finally {if(!peerContents.isDestroyed())peerContents.close();peer.window.destroy();state.mainWindow=win;state.browserTabs=savedTabs;}
 state.bindEvents(win)();state.bindEvents(win);await settle();await measure('event-owner-return-'+outcome+'-setup');}
 // An untrusted blank top-level page must not receive an observer or relayout.
 state.browserSidebarVisible=false;state.browserContentVisible=false;state.layout();await loaded(()=>contents.loadURL('about:blank'));await settle();const untrustedBounds=bounds(),untrustedCalls=observer.audit.calls;
 contents.setZoomFactor(0.8);win.setContentSize(1000,930);await settle();record('untrusted top-level source receives no observer or geometry writes',observer.audit.calls===untrustedCalls&&bounds()===untrustedBounds);
 await loaded(()=>contents.loadFile(shellPage));await browserReady();win.setContentSize(1460,930);contents.setZoomFactor(1.25);await measure('edge-event-trusted-return-zoom',false);
 // A rejected observer reply must settle, not spin. A real reload can recover.
 await settle();observer.audit.rejectNext=true;const rejection=observer.waitDelivery();contents.setZoomFactor(1.5);await rejection;await settle();const stoppedCalls=observer.audit.calls;
 await new Promise(resolve=>setTimeout(resolve,200));record('observer rejection converges without automatic retry loop',observer.audit.calls===stoppedCalls);
 await reload();contents.setZoomFactor(0.8);await measure('edge-event-reload-after-rejection',false);
 // Closing the pane followed by zoom must not resurrect native content.
 await run('harnessDesktopRightWorkspace.close()');await measure('event-closed-setup');contents.setZoomFactor(1.25);await measure('event-closed-zoom',false);record('closed native content stays hidden across zoom',nativeViews.every(v=>!v.getVisible()));
 const liveStop=state.bindEvents(win);liveStop();liveStop();await settle();record('explicit disposal removes renderer listener',await run('typeof window.__dshBrowserLayoutResizeWaiter === "undefined"'));
 const afterStopCalls=observer.audit.calls;contents.setZoomFactor(1.5);await settle();record('disposed binding does not rearm on zoom',observer.audit.calls===afterStopCalls);
 state.bindEvents(win);await settle();await run('harnessDesktopRightWorkspace.openMode("browser")');await measure('event-rebound-setup');contents.setZoomFactor(1);await measure('edge-event-rebound-zoom',false);
 return checks;
};
