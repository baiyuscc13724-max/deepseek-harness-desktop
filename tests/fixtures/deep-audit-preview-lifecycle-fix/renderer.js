'use strict';
// Synthetic IPC/file replies only. Actual DOM renderers are loaded unchanged after this guard.
window.portAttempts=[]; window.replies=[]; window.pending=[]; window.htmlMessages=[]; window.modelReplies=[];window.events=[];
const denied=name=>(...args)=>{portAttempts.push(name);throw Error('DENIED:'+name)};
document.execCommand=denied('execCommand');
Object.defineProperty(navigator,'clipboard',{value:Object.freeze({read:denied('clipboard.read'),readText:denied('clipboard.readText'),write:denied('clipboard.write'),writeText:denied('clipboard.writeText')})});
window.fetch=denied('fetch');window.WebSocket=class{constructor(){denied('WebSocket')()}};window.EventSource=class{constructor(){denied('EventSource')()}};window.XMLHttpRequest=class{constructor(){denied('XHR')()}};
navigator.sendBeacon=denied('sendBeacon');window.open=denied('window.open');
window.callbacks={};
window.desktopHarness=Object.freeze({
 setBrowserVisible:async v=>{events.push({type:'visibility',v,t:performance.now()})},
 setBrowserContentVisible:async v=>{events.push({type:'contentVisibility',v,t:performance.now()})},
 getRightWorkspaceResource:(kind,payload)=>new Promise((resolve,reject)=>{pending.push({kind,payload:structuredClone(payload),resolve,reject});events.push({type:'request',kind,payload:structuredClone(payload),t:performance.now()})}),
 previewRightWorkspaceLocal:payload=>new Promise((resolve,reject)=>{pending.push({kind:'local',payload:structuredClone(payload),resolve,reject});events.push({type:'request',kind:'local',payload:structuredClone(payload),t:performance.now()})}),
 onPreviewRightWorkspaceLocal:fn=>{callbacks.local=fn},onModelWorkspacePreview:fn=>{callbacks.model=fn},onModelWorkspacePreviewCancel:fn=>{callbacks.cancel=fn},
 replyModelWorkspacePreview:async r=>{modelReplies.push(r)},
 openLocal:denied('openLocal'),openRightWorkspaceFile:denied('openRightWorkspaceFile'),getBrowserState:denied('getBrowserState'),navigateBrowser:denied('navigateBrowser'),newBrowserTab:denied('newBrowserTab')
});
document.querySelector('#runtimeView').send=denied('runtimeView.send');
window.delay=ms=>new Promise(resolve=>setTimeout(resolve,ms||60));
window.reply=(index,file,error)=>{const p=pending[index];if(!p)throw Error('missing pending '+index);events.push({type:'reply',index,error:error||null,t:performance.now()});error?p.reject(Error(error)):p.resolve(file);};
window.doc=()=>document.querySelector('#rightWorkspaceDocumentPane');
window.text=()=>doc()?.querySelector('pre')?.textContent;
addEventListener('message',e=>{if(e.data?.audit==='preview-fixture'){htmlMessages.push({data:e.data,origin:e.origin,sourceMatches:e.source===doc()?.querySelector('iframe')?.contentWindow,t:performance.now()})}});
window.dispatchContext=id=>{const event=new Event('ipc-message');Object.defineProperties(event,{channel:{value:'right-workspace:context'},args:{value:[{sessionId:id}]}});document.querySelector('#runtimeView').dispatchEvent(event)};
window.clickText=label=>{const btn=[...doc().querySelectorAll('button')].find(b=>b.textContent===label);if(!btn)throw Error('button missing '+label);btn.click()};
