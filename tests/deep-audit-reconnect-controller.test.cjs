'use strict'
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');const root=path.resolve(__dirname,'..'),base=path.join(root,'.artifacts/deep-audit-round1-reconnect-controller'),java='mobile/android/app/src/main/java/io/harnessdesktop/mobile/',hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.resolve(root,p))).digest('hex');
const frozen={
 'tests/deep-audit-mobile-recovery.test.cjs':'7d72d4eb481e66fae789e72b3aa58b5baf5f5287d3ee542312ae377e78c86105',
 'tests/fixtures/deep-audit-mobile-recovery/run.cjs':'48256fd83ad863057ad93b869e01b4997c2b62cf2e57bfc92f1323c59818d23c',
 'tests/fixtures/deep-audit-mobile-recovery/owner-probe.cjs':'46ae57ae25528e06e2b92dcfcf8d2cd9d6af17ef0220b56db8f0c181c63bfdb9',
 'mobile/android/app/src/test/java/io/harnessdesktop/mobile/DeepAuditMobileRecoveryTest.java':'74a6193db6f36a7665d4582e87db6dd8e43155e4d0caff7fc08b68753c671020',
 'docs/deep-audit/round1-mobile-recovery.md':'980b33d960588cf1b5eb42766195e4e664bcdaade4f49323d0e765277308ff47',
 '.artifacts/deep-audit-round1-reconnect-controller/before/MainActivity.java':'c465f787e0c812de1ec379b88d2b0d4c840807cc39980ce3f284204fae667ffb'
};
function guardedRun(file,args=[]){const env={};for(const k of ['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS'])if(process.env[k])env[k]=process.env[k];const r=cp.spawnSync(process.execPath,[path.join(root,'tests/fixtures/deep-audit-reconnect-controller',file),...args],{cwd:root,env,stdio:'inherit',timeout:70000});assert.ifError(r.error);assert.equal(r.status,0);}
function method(s,name){const at=s.indexOf(name);assert.ok(at>0,name);const tail=s.slice(at);const end=tail.slice(1).search(/\n    (?:private|protected|public) /);return end<0?tail:tail.slice(0,end+1);}

test('current Activity wiring: guarded owner queue, seven lifecycle invalidations, untouched auth/offline/route methods',()=>{
 const main=fs.readFileSync(path.join(root,java,'MainActivity.java'),'utf8'),controller=fs.readFileSync(path.join(root,java,'RemoteReconnectController.java'),'utf8'),old=fs.readFileSync(path.join(base,'before/MainActivity.java'),'utf8');
 assert.doesNotMatch(main,/remoteReconnectProfile|remoteReconnectAttempt|nativeReconnectAttempt|removeCallbacks\((?:native|remote)Reconnect\)/);
 assert.equal((main.match(/remoteReconnectController\.stop\(\)/g)||[]).length,7);
 assert.equal((main.match(/remoteReconnectController\.(?:ready|failed|post)\(token, \(\) -> \{\r?\n\s+if \(!canApplyRemote\(profile\)\) return;/g)||[]).length,8);
 assert.match(main,/return pairingProfile == profile && localProxy != null && !isFinishing\(\) && !isDestroyed\(\);/);
 for(const n of ['NativeP2p','WssRelay','EasyTier']){assert.match(method(main,'private void start'+n+'('),new RegExp('remoteReconnectController\\.start\\(profile, RemoteReconnectController\\.Channel\\.'+(n==='NativeP2p'?'NATIVE':'REMOTE')));assert.match(method(main,'private void connect'+n+'('),/if \(!canApplyRemote\(profile\)/);}
 const listenerSpan=main.slice(main.indexOf('private void connectNativeP2p('),main.indexOf('private void openWorkbench('));assert.doesNotMatch(listenerSpan,/runOnUiThread|postDelayed|remoteReconnectAttempt|nativeReconnectAttempt/);
 for(const signature of ['private void requestOfflineSync(','private void clearRevokedPairing(','private void openWorkbench(','private void applyReadyRoutes(','private java.util.List<PairingProfile.Route> readyRoutes('])assert.equal(method(main,signature),method(old,signature),signature+' unchanged');
 assert.match(controller,/Math\.min\(30_000L, 5_000L \+ attempt \* 5_000L\)/);assert.match(controller,/Math\.min\(15_000L, 3_000L \+ attempt \* 2_000L\)/);assert.doesNotMatch(controller,/import android\.|Thread\.sleep|OkHttp|requestId/);
 for(const [p,h]of Object.entries(frozen))assert.equal(hash(p),h,'frozen '+p);
});

test('historical exact queued callback body records old behavior, without presenting it as current Activity',()=>guardedRun('old-queue-probe.cjs'));

test('unchanged production controller executes one real 3000ms retry then new ACK, no old business replay',{timeout:70000},()=>{
 const key='checks-'+crypto.randomBytes(8).toString('hex'),before=[java+'MainActivity.java',java+'RemoteReconnectController.java'].map(p=>({path:p,sha256:hash(p)}));guardedRun('chain.cjs',[key]);const folder=path.join(base,'transport-'+key),r=JSON.parse(fs.readFileSync(path.join(folder,'result.json')));assert.equal(r.ok,true);assert.equal(r.automaticRecoveryExecuted,true);assert.equal(r.checks.length,27);assert.deepEqual(r.counts,{commands:3,acks:2,expectedLoss:1,duplicateCoreExecution:0,mobileHellos:2});assert.ok(r.recovery.scheduledToTimerMs>=2990);assert.deepEqual(r.coreExecutions,{'normal-0':1,'late-0':1,'recovery-0':1});
 const j=JSON.parse(fs.readFileSync(path.join(folder,'java-result.json')));assert.equal(j.manualInitialStarts,1);assert.equal(j.events.filter(e=>e.stage==='explicitInitialStart').length,1);assert.equal(j.events.filter(e=>e.stage==='controllerConnect').length,2);
 for(const input of before)assert.equal(hash(input.path),input.sha256,'current source changed mid-test');for(const [p,h]of Object.entries(frozen))assert.equal(hash(p),h,'frozen '+p);fs.writeFileSync(path.join(base,'suite-'+key+'.json'),JSON.stringify({ok:true,folder,before,wrapperSha256:hash(__filename),frozen,scope:'3 Node tests, 27 controller/live checks; source-wiring assertions not Android owner execution'},null,2));
});
