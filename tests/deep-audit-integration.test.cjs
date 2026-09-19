'use strict'
const test=require('node:test');const assert=require('node:assert/strict');const cp=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const root=path.resolve(__dirname,'..');const guard=path.join(root,'.artifacts/deep-audit-20260912/offline-guard.cjs');
function probe(source){const temp=fs.mkdtempSync(path.join(os.tmpdir(),'dap-'));const env={};for(const k of ['SystemRoot','WINDIR','COMSPEC','PATHEXT'])if(process.env[k])env[k]=process.env[k];Object.assign(env,{HOME:temp,USERPROFILE:temp,APPDATA:temp,LOCALAPPDATA:temp,DSH_HOME:temp,TMP:temp,TEMP:temp,PATH:path.dirname(process.execPath)});try{return cp.spawnSync(process.execPath,['--require',guard,'-e',source],{env,cwd:root,encoding:'utf8',timeout:15000});}finally{fs.rmSync(temp,{recursive:true,force:true});}}
test('audit guard allows only locally registered fixture traffic, rejects remote and live GUI endpoints without network dispatch',()=>{
 const result=probe(`const assert=require('node:assert/strict'),http=require('node:http'),net=require('node:net');(async()=>{const s=http.createServer((q,r)=>r.end('synthetic-fixture'));await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;assert.equal(await(await fetch('http://127.0.0.1:'+port)).text(),'synthetic-fixture');await assert.rejects(fetch('https://example.invalid'),{code:'AUDIT_NETWORK_BLOCKED'});await assert.rejects(fetch('http://127.0.0.1:60131'),{code:'AUDIT_NETWORK_BLOCKED'});await assert.rejects(fetch('http://127.0.0.1:9'),{code:'AUDIT_NETWORK_BLOCKED'});assert.throws(()=>net.connect(443,'example.invalid'),{code:'AUDIT_NETWORK_BLOCKED'});assert.throws(()=>net.connect(60131,'127.0.0.1'),{code:'AUDIT_NETWORK_BLOCKED'});s.closeAllConnections();await new Promise(r=>s.close(r));console.log('fixture-only verified');})().catch(e=>{console.error(e);process.exitCode=1;});`);
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/fixture-only verified/);
});
test('audit guard permits only exact live fixture pipe bindings and revokes them after close',()=>{
 const pipe=process.platform==='win32'?'\\\\.\\pipe\\deep-audit-proof-'+process.pid:path.join(os.tmpdir(),'deep-audit-proof-'+process.pid+'.sock');
 const result=probe(`const assert=require('node:assert/strict'),net=require('node:net');(async()=>{const pipe=${JSON.stringify(pipe)};const s=net.createServer(c=>c.end('fixture'));await new Promise(r=>s.listen(pipe,r));assert.throws(()=>net.connect(pipe+'-other'),{code:'AUDIT_NETWORK_BLOCKED'});await new Promise((resolve,reject)=>{const c=net.connect(pipe);let text='';c.on('data',b=>text+=b);c.on('error',reject);c.on('end',()=>{assert.equal(text,'fixture');resolve();});});await new Promise(r=>s.close(r));assert.throws(()=>net.connect(pipe),{code:'AUDIT_NETWORK_BLOCKED'});console.log('pipe binding verified');})().catch(e=>{console.error(e);process.exitCode=1;});`);
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/pipe binding verified/);
});
test('audit child environment contains no inherited capability/provider credentials and all homes are synthetic',()=>{
 const result=probe(`const assert=require('node:assert/strict');const forbidden=Object.keys(process.env).filter(k=>/HARNESS|TOKEN|API_KEY|SECRET|DSH_/.test(k)&&k!=='DSH_HOME');assert.deepEqual(forbidden,[]);for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','DSH_HOME'])assert.equal(process.env[k],process.env.HOME);console.log('isolation verified');`);
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/isolation verified/);
});
test('inventory does not imply successful feature coverage from discovered module or test counts',()=>{
 const report=JSON.parse(fs.readFileSync(path.join(root,'docs/deep-audit/coverage-master.json'),'utf8'));
 assert.ok(report.features.length>0);
 const ids=new Set();
 for(const feature of [...report.features,...report.sourceIndex,...report.userOperations,...report.domainFindings,...report.priorityUserRequirements]){
  assert.ok(!ids.has(feature.id),feature.id);ids.add(feature.id);
  for(const key of ['normal','error-recovery','concurrency-switch','isolation','a11y']){
   const s=feature.scenarios[key];assert.ok(s,feature.id+':'+key);
   if(s.status==='pass'||s.status==='fixed'){assert.ok(s.evidence.length>0,feature.id+' cannot pass without evidence');assert.ok(['static-review','unit','real-adapter','synthetic-Electron','e2e'].includes(s.evidenceLevel),feature.id+' has ambiguous evidence level');}
   if(s.applicable===false){assert.equal(s.status,'not-applicable');assert.ok(s.reason);}
  }
  assert.ok(feature.entrypoints.length>0);
 }
 for(const row of report.domainFindings.filter(x=>x.independentlyAccepted)){
  const acceptance=report.independentAcceptances.find(x=>x.id===row.acceptanceId);
  assert.ok(acceptance?.independentlyAccepted,row.id+' needs an independently accepted record');
  assert.ok(acceptance.production.length>0&&acceptance.tests.length>0);
  for(const entry of [...acceptance.production,...acceptance.tests])assert.match(entry.sha256,/^[a-f0-9]{64}$/i);
  assert.ok(Object.values(row.scenarios).some(s=>s.status==='pass'),row.id+' needs a specifically accepted scenario');
 }
 assert.equal(report.summary.independentlyAccepted,report.domainFindings.filter(x=>x.independentlyAccepted).length);
});
test('audit runner binds all four exclusions and rejects caller attempts to override before dispatch',t=>{
 const expected=['installed alpha.5 MCP client and Goal tool are exact complete patched artifacts','one publisher command exposes the immutable resumable release order','publisher fails closed unless the desktop manifest is signed and verified before commit or mirroring','the real release audit accepts the checked-in publisher contract'];
 const active=process.execArgv.find(x=>x.startsWith('--test-skip-pattern='));
 if(process.env.NODE_OPTIONS?.includes('offline-guard.cjs')){
  assert.ok(active,'isolated runner must supply the mandatory exclusion policy');const matcher=new RegExp(active.slice('--test-skip-pattern='.length));
  for(const name of expected){assert.equal(matcher.test(name),true,name);assert.equal(matcher.test(name+' unrelated case'),false);}
  assert.equal(matcher.test('ordinary unrelated safe unit test'),false);
 }else t.diagnostic('mandatory argv binding is checked when this suite executes through the isolated audit runner');
 const runner=path.join(root,'.artifacts/deep-audit-20260912/run-isolated.cjs');
 const result=probe(`const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,[${JSON.stringify(runner)},'forbidden-policy-override','--test-skip-pattern=^$','tests/browser-security-policy.test.cjs'],{env:process.env,encoding:'utf8'});console.log(r.stderr);process.exitCode=r.status;`);
 assert.equal(result.status,1);assert.match(result.stdout,/audit exclusion override refused before test dispatch/);
});
