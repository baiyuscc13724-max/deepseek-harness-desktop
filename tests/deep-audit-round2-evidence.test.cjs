'use strict';
// This suite validates red evidence, not product acceptance. It never launches Electron or uses native ports.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{isDeepStrictEqual:eq}=require('node:util');
require('./fixtures/deep-audit-preview-components/deny-network.cjs');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'.artifacts/deep-audit-round2-acceptance');
const sha=b=>createHash('sha256').update(b).digest('hex'),json=p=>JSON.parse(fs.readFileSync(path.join(root,p))),copy=x=>JSON.parse(JSON.stringify(x));
const baseline=json('baseline.json'),sidecar=JSON.parse(fs.readFileSync(path.join(repo,'docs/deep-audit/coverage-round2.json'))),p=json('preview-independent-v1/receipt.json'),s=json('settings-independent-v1/receipt.json');
const pRed=['HTML-LIFECYCLE close stops active HTML execution'];
const sRed=['cancel preview restores persisted settings rather than silently retaining draft','pending save supplies disabled or busy feedback','custom save failure has visible inline error','same pending save is deduplicated','theme rejection remains open and visible feedback','old theme receipt after close reopen does not mutate reopened appearance','A then B reversed replies keep latest chosen theme','different range fields reversed replies retain newest blur'];
const sourceMap=Object.fromEntries(baseline.sources.map(x=>[x.path,x.sha256]));
function validate(kind,r){
 assert.equal(r.engine.electron,'43.2.0');assert.equal(r.engine.chrome,'150.0.7871.129');
 assert.deepEqual(r.nativeAttempts,[]);assert.deepEqual(r.nodeNetworkAttempts,[]);assert.deepEqual(r.blockedRequests,[]);
 const inputs=kind==='preview'?r.inputHashes:r.inputs;assert.ok(Object.keys(inputs).length>=8);
 for(const [name,hash]of Object.entries(inputs))assert.equal(hash,sourceMap[name],'source binding '+name);
 const names=r.checks.map(x=>x.name);assert.equal(new Set(names).size,names.length);assert.equal(names.length,kind==='preview'?35:47);
 const author=JSON.parse(fs.readFileSync(path.join(repo,kind==='preview'?'.artifacts/deep-audit-round2-preview/final-v4/receipt.json':'.artifacts/deep-audit-round2-settings/author-final-v2/receipt.json')));
 assert.deepEqual(names,author.checks.map(x=>x.name),'scenario inventory must match unchanged author suite');
 const failed=r.checks.filter(c=>!eq(c.observed,c.expected)).map(c=>c.name);assert.deepEqual(failed,kind==='preview'?pRed:sRed,'do not erase red observations');
 if(kind==='preview'){
  assert.equal(r.status,'findings');for(const c of r.checks)assert.equal(c.pass,eq(c.observed,c.expected),'dishonest pass bit');
  assert.deepEqual(r.navigation,[]);assert.equal(r.protocolCalls.length,4);assert.ok(r.protocolCalls.every(u=>u==='http://127.0.0.1:9/preview-fixture'));assert.deepEqual(r.frozenDrift,[]);
  const t=r.closeTimeline;assert.equal(t.length,4);assert.ok(t[2].t-t[1].t>=90);assert.ok(t[3].t-t[2].t>=200);assert.ok(t[3].beats>t[2].beats);assert.ok(t.slice(1).every(x=>!x.open&&x.iframeConnected));
  assert.ok(r.htmlMessages.some(m=>m.data.type==='selfNavigateAttempt'));assert.ok(r.consoleMessages.some(m=>m.message.includes('self-navigation.invalid')&&m.message.includes('Content Security Policy')));
  assert.ok(r.htmlMessages.filter(m=>m.data.type==='heartbeat'&&m.t>=t[2].t&&m.t<=t[3].t).every(m=>m.sourceMatches===true&&m.origin==='null'));
 }else{
  assert.equal(r.status,'product-findings');assert.deepEqual(r.failed,sRed);assert.equal(r.reversible,true);assert.deepEqual(r.ports.attempts,[]);assert.ok(r.ports.calls.every(c=>c.settled));
  assert.ok(r.ports.trace.filter(x=>['click','keydown','dblclick'].includes(x.type)).every(x=>x.trusted===false));
  const allowed=['fixture.html','styles.css','right-workspace.css','xterm.css','deepseek-icon.svg'];assert.ok(r.allowedRequests.every(x=>x.startsWith('file:///')&&x.includes('/deep-audit-round2-acceptance/settings-independent-v1/profile/electron/')&&allowed.includes(x.split('/').at(-1))));
 }
}
function validateSidecar(c){assert.equal(c.productPass,false);assert.equal(c.rows.length,6);assert.deepEqual(c.basis.historicalTests,{total:2929,pass:2889,fail:7,skip:33});assert.equal(c.basis.newRunsNotAddedToHistoricalTotals,true);assert.deepEqual(c.componentResults,{preview:{checks:35,pass:34,fail:1},settings:{checks:47,pass:39,fail:8}});for(const r of c.rows){assert.equal(r.wholeUserAccepted,false);assert.equal(r.masterStatusUnchanged,true);assert.equal(r.status,'limited-evidence-with-findings-or-unverified');assert.deepEqual(Object.keys(r.scenarios).sort(),['a11y','concurrency-switch','error-recovery','isolation','normal']);assert.ok(r.unverified.length>=3);for(const e of r.actualSourceHashes)assert.equal(e.sha256,sourceMap[e.path])}}

test('01 all 362 prior frozen files, 14 inputs, 23 author files remain byte-identical',()=>{
 assert.equal(baseline.frozen.length,362);assert.equal(baseline.sources.length,14);assert.equal(baseline.authors.length,23);
 for(const e of [...baseline.frozen,...baseline.sources,...baseline.authors]){const b=fs.readFileSync(path.join(repo,e.path));assert.equal(sha(b),e.sha256,e.path);assert.equal(b.length,e.bytes,e.path)}
 assert.equal(sha(fs.readFileSync(path.join(repo,'docs/deep-audit/coverage-master.json'))),'8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794');
 const master=JSON.parse(fs.readFileSync(path.join(repo,'docs/deep-audit/coverage-master.json')));assert.equal(master.summary.domainFindingRows,598);assert.equal(master.summary.userOperations,115);assert.equal(master.summary.independentlyAccepted,104);
});
test('02 exact reviewer derivation and product loading seams reverse to original bytes',()=>{
 for(const d of json('derivation.json')){let b=fs.readFileSync(path.join(repo,d.derivedPath),'utf8');assert.equal(sha(b),d.derivedHash);for(const c of [...d.changes].reverse()){assert.equal(b.split(c.after).length,2);b=b.replace(c.after,c.before)}assert.equal(sha(b),d.originalHash);assert.equal(b,fs.readFileSync(path.join(repo,d.originalPath),'utf8'))}
 const bindings=json('preview-independent-v1/binding.json');for(const e of [...bindings.unchangedCopies,bindings.service])assert.equal(sha(fs.readFileSync(path.join(root,'preview-independent-v1',e.copy))),sourceMap[e.source]);
 const html=fs.readFileSync(path.join(repo,'renderer/index.html'),'utf8');assert.equal(sha(html.slice(bindings.skeleton.start,bindings.skeleton.end)),bindings.skeleton.sha256);
 for(const [target,file,source]of [['html','fixture.html','renderer/index.html'],['app','app.instrumented.js','renderer/app.js']]){let b=fs.readFileSync(path.join(root,'settings-independent-v1/profile/electron',file),'utf8');assert.equal(sha(b),s.outputs[target]);for(const c of s.seams.filter(x=>x.target===target).reverse()){assert.equal(b.split(c.after).length,2);b=b.replace(c.after,c.before)}assert.equal(sha(b),sourceMap[source]);}
});
test('03 independent preview receipts prove limited isolation and retain lifecycle red',()=>validate('preview',p));
test('04 independent settings receipts retain eight raw red expectations without whole-product pass',()=>validate('settings',s));
test('05 independent broader feedback and fixed-latest-store delayed-delivery probes',()=>{
 const o=json('settings-independent-v1/independent-observations.json');assert.equal(o.length,5);
 assert.deepEqual(o[0].pending,{disabled:false,busy:null,label:'应用并保存主题'});assert.equal(o[0].visibleFailure,false);assert.deepEqual(o[0].rejections,['synthetic settings write failure']);assert.equal(o[1].visibleFailure,false);assert.equal(o[1].open,true);
 assert.equal(o[2].shownAfterB,'porcelain-mist');assert.equal(o[2].shownAfterLateA,'deep-ocean');assert.equal(o[2].persisted,'porcelain-mist');assert.deepEqual(o[2].delivered,[1,0]);
 assert.equal(o[3].blurAfterB,8);assert.equal(o[3].blurAfterLateA,2);assert.equal(o[3].persistedBlur,8);assert.equal(o[3].payloads[0].wallpaperBlur,2);assert.equal(o[3].payloads[1].wallpaperBlur,8);assert.deepEqual(o[4],{id:'supplement-clean-boundary',unsettled:0,ports:[]});
});
test('06 fresh minimal environment and actual completion distinct from retained product failure',()=>{
 const allowed=new Set(['SYSTEMROOT','WINDIR','PATH','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME','PREVIEW_AUDIT_RUN','SETTINGS_AUDIT_RUN','NODE_TEST_CONTEXT','NODE_TEST_WORKER_ID']);
 for(const kind of ['preview','settings']){const dir=kind+'-independent-v1';assert.equal(fs.existsSync(path.join(root,dir,'failure.json')),false);const process=json(dir+'/runner-process.json');assert.equal(process.exitCode,1);assert.ok(process.environmentKeys.every(k=>allowed.has(k.toUpperCase())));const manifest=json(dir+(kind==='preview'?'/input-manifest.json':'/inputs.json'));assert.ok(manifest.environmentKeys.every(k=>allowed.has(k.toUpperCase())));const tap=fs.readFileSync(path.join(root,dir,'node.tap'),'utf8');assert.match(tap,/# tests 1/);assert.match(tap,/# fail 1/);assert.match(tap,/# skipped 0/);assert.match(tap,kind==='preview'?/Red product assertions retained/:/Product findings:/);}
 assert.equal(json('preview-independent-v1/process.json').status,0);assert.equal(json('settings-independent-v1/result.json').drift,0);
});
test('07 reject 11 poisoned evidence shapes instead of making raw USER rows green',()=>{
 const probes=[
 ['preview',x=>{x.inputHashes['renderer/right-workspace.js']='0'.repeat(64)}],
 ['preview',x=>{x.checks.find(c=>!c.pass).pass=true}],
 ['preview',x=>{x.checks=x.checks.filter(c=>c.pass)}],
 ['preview',x=>{x.closeTimeline[3].beats=x.closeTimeline[2].beats}],
 ['preview',x=>{x.protocolCalls.push('http://127.0.0.1:60131/')}],
 ['preview',x=>{x.nativeAttempts.push('clipboard.readText')}],
 ['preview',x=>{x.engine.electron='synthetic-engine'}],
 ['settings',x=>{x.failed=[]}],
 ['settings',x=>{x.blockedRequests.push('https://not-allowed.invalid/')}],
 ['settings',x=>{x.inputs['renderer/app.js']='f'.repeat(64)}],
 ['settings',x=>{x.checks[0].name=x.checks[1].name}]
 ];for(const [kind,mutate]of probes){const r=copy(kind==='preview'?p:s);mutate(r);assert.throws(()=>validate(kind,r),undefined,kind+' poisoned receipt not refused')}
 const bad=copy(sidecar);bad.rows[0].wholeUserAccepted=true;assert.throws(()=>validateSidecar(bad));
 const badCount=copy(sidecar);badCount.basis.historicalTests.total+=82;assert.throws(()=>validateSidecar(badCount));
});
test('08 sidecar binds six existing IDs, five dimensions and exact independent evidence hashes',()=>{
 validateSidecar(sidecar);const master=JSON.parse(fs.readFileSync(path.join(repo,'docs/deep-audit/coverage-master.json')));const ids=new Set();function visit(x){if(!x||typeof x!=='object')return;if(typeof x.id==='string')ids.add(x.id);for(const v of Object.values(x))visit(v)}visit(master);
 for(const r of sidecar.rows){assert.ok(ids.has(r.id),r.id);for(const id of r.relatedIds)assert.ok(ids.has(id),id)}
 for(const e of Object.values(sidecar.evidence))assert.equal(sha(fs.readFileSync(path.join(repo,e.path))),e.sha256,e.path);
 assert.equal(sidecar.reviewClassification.contractReview.length,2);assert.equal(sidecar.reviewClassification.conditionalRisks.length,1);
});
