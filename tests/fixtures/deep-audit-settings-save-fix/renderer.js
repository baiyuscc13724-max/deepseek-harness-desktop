'use strict';
// Synthetic bridge data only; no alternate render/save/focus algorithm.
window.portAttempts=[];window.errors=[];window.calls=[];window.subscriptions=[];window.trace=[];window.allErrors=[];window.epoch=0;
for(const type of ['click','dblclick','keydown','input','change'])document.addEventListener(type,e=>trace.push({seq:trace.length,epoch,type,target:e.target.id||e.target.dataset?.skinId||e.target.tagName,trusted:e.isTrusted}),true);
window.denyPort=name=>(...args)=>{portAttempts.push(name);throw Error('DENIED:'+name)};
document.execCommand=denyPort('execCommand');
Object.defineProperty(navigator,'clipboard',{value:Object.freeze({read:denyPort('clipboard.read'),readText:denyPort('clipboard.readText'),write:denyPort('clipboard.write'),writeText:denyPort('clipboard.writeText')})});
window.fetch=denyPort('fetch');window.XMLHttpRequest=class{constructor(){denyPort('XHR')()}};window.WebSocket=class{constructor(){denyPort('WebSocket')()}};window.EventSource=class{constructor(){denyPort('EventSource')()}};navigator.sendBeacon=denyPort('sendBeacon');window.open=denyPort('window.open');window.alert=denyPort('alert');window.confirm=denyPort('confirm');
for(const name of ['close','moveTo','moveBy','resizeTo','resizeBy','print'])window[name]=denyPort('window.'+name);
addEventListener('error',e=>{errors.push(e.message);allErrors.push({epoch,type:'error',message:e.message});e.preventDefault()});addEventListener('unhandledrejection',e=>{const message=String(e.reason?.message||e.reason);errors.push(message);allErrors.push({epoch,type:'rejection',message});e.preventDefault()});
window.clone=x=>JSON.parse(JSON.stringify(x));
window.base=()=>({themeId:'official',customTheme:{mode:'dark',accent:'#6f8cff',surface:'#171b29',text:'#f4f7ff',wallpaperBrightness:82,wallpaperBlur:2,glassTransparency:32,borderStrength:48,readabilityStrength:72},wallpaperLibrary:{activeId:null,items:[]},customBackgroundDataUrl:null,uiMode:'official',reducedMotion:false,lowPerformance:false});
window.persisted=base();
const ports={};
for(const name of ['onTerminalEvent','onTerminalToggle','onRuntimeState','onMobileSyncState','onComputerUseAuthorization','onPetState','onUpdateResult','onUpdateInstallProgress','onComponentUpdateProgress','onPrPreviewUpdateProgress'])ports[name]=fn=>{subscriptions.push(name);return ()=>{}};
for(const name of ['setTheme','saveCustomTheme','setUiPreferences','chooseThemeBackground'])ports[name]=arg=>new Promise((resolve,reject)=>{trace.push({seq:trace.length,epoch,type:'request',index:calls.length,name,arg:clone(arg??null)});calls.push({name,arg:clone(arg??null),resolve,reject,settled:false})});
window.desktopHarness=new Proxy(Object.freeze(ports),{get(target,key){return key in target?target[key]:denyPort('bridge.'+String(key))}});
const guest=document.querySelector('#runtimeView');
guest.getURL=()=>''; // Empty inert guest; publish runs production early-return, never executes a real webview.
guest.executeJavaScript=denyPort('guest.executeJavaScript');
window.$=selector=>document.querySelector(selector);
// Wait for an actual Chromium frame as well as Promise/error delivery. The old
// fixed 60ms delay raced rAF in hidden windows; no product callback is replaced.
window.tick=()=>Promise.all([new Promise(resolve=>setTimeout(resolve,60)),new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('native animation frame did not arrive within 2s')),2000);requestAnimationFrame(()=>{clearTimeout(timer);resolve()})})]);
window.click=selector=>$(selector).click();
window.key=(selector,key,props={})=>{const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...props});$(selector).dispatchEvent(event);return event.defaultPrevented};
window.input=(selector,value,type='input')=>{const el=$(selector);el.value=String(value);el.dispatchEvent(new Event(type,{bubbles:true}));};
window.reply=(index,fail=false)=>{const c=calls[index];if(!c||c.settled)throw Error('bad synthetic reply');c.settled=true;trace.push({seq:trace.length,epoch,type:'reply',index,name:c.name,fail});if(fail)return c.reject(Error('synthetic settings write failure'));let next=clone(persisted);if(c.name==='setTheme')next.themeId=c.arg;if(c.name==='saveCustomTheme'){next.themeId='custom';next.customTheme={...next.customTheme,...c.arg}}if(c.name==='setUiPreferences')Object.assign(next,c.arg);persisted=next;c.resolve(clone(next));};
window.reset=async()=>{audit.close();await tick();if(calls.some(x=>!x.settled))throw Error('unsettled synthetic call');epoch++;trace.push({seq:trace.length,epoch,type:'fixture-reset'});persisted=base();calls.length=0;errors.length=0;audit.seed(clone(persisted));$('#skinQuickButton').focus();click('#skinQuickButton');await tick();};
window.modal=()=>$('#skinPickerOverlay [aria-modal="true"]');
window.opened=()=>!$('#skinPickerOverlay').classList.contains('hidden');
window.state=()=>({theme:document.documentElement.dataset.shellTheme||null,mode:document.documentElement.dataset.shellMode||null,open:opened(),focus:document.activeElement.id});
