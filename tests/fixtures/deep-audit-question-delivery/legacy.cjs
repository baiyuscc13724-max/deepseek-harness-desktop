'use strict';
// Preserve the 44 old assertions as an independent low-level oracle on the new installed Question bytes.
// This suite deliberately retains synthetic carriers/native callback stubs. It is NOT delivery-chain evidence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async({run,win,repo,checks,record})=>{
 const source=fs.readFileSync(path.join(repo,'tests/deep-audit-question-card.test.cjs'),'utf8'),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
 const slice=(start,end)=>{assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);return source.slice(source.indexOf(start),source.indexOf(end))};
 const injectionSource=slice('function mobileInjection(css,runtime) {','async function electronMain()');
 const mobileInjection=Function('fs','path','repo','assert',injectionSource+';return mobileInjection')(fs,path,repo,assert);
 const setup=slice('      window.config=api.createQuestionDraftStore();','      mount(); void 0;')+'      mount(); void 0;';
 const scenarios=slice("    await tap('button[role=checkbox]')\n    await check('trusted native touch selects exactly once'","    console.log(JSON.stringify({mode:patchedMode?");
 record({sourceSha:sha(source),setupSha:sha(setup),scenariosSha:sha(scenarios),assertionsUnchanged:true,boundary:'same original 44 assertions; synthetic carrier and native methods; local ToolConsumer execute, not Host tools'});
 await run(`window.rendererFixture=modules['@deepseek-ai/dsh-client-ui-renderer'].fixture;window.errors=[];window.events=[];document.addEventListener('click',e=>events.push({type:'click',role:e.target.closest('button')?.getAttribute('role'),trusted:e.isTrusted}),true);window.addStyle=(id,text)=>{const el=document.getElementById(id)||document.head.appendChild(Object.assign(document.createElement('style'),{id}));el.textContent=text};window.__ModuleLoader__={load(def){window.product=def.factory(name=>{if(!(name in shippedModules))throw Error('Unexpected dependency '+name);return shippedModules[name]})}};${setup}`);
 const tap=async selector=>{const p=await run(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing target');const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await run('delay()')};
 await win.webContents.debugger.sendCommand('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14; Synthetic fixture) AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36'});
 const originalCount=checks.length,check=async(name,expression,expected)=>{const observed=await run(expression);assert.deepEqual(observed,expected,name);checks.push({name,observed})};
 await Function('fs','path','repo','run','win','assert','sha','tap','check','checks','mobileInjection','patchedMode','marker','require',`return (async()=>{${scenarios}})()`)(fs,path,repo,run,win,assert,sha,tap,check,checks,mobileInjection,true,'\t\texports.apply = apply;',require);
 assert.equal(checks.length-originalCount,44,'old 44 invariant count, not user-operation coverage');
};