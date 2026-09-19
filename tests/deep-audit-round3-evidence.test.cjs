'use strict';
// Read-only independent evidence gate. Never starts Electron/product/network/install.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const lib=require('../.artifacts/deep-audit-round3-acceptance/evidence-lib.cjs');
const side=JSON.parse(fs.readFileSync(path.join(lib.repo,'docs/deep-audit/coverage-round3.json'))),mobile=lib.load('mobile-v1/result.json'),cleanup=lib.load('mobile-v1/cleanup.json'),appframe=lib.load('appframe-v1/receipt.json');
const mutate=(value,fn)=>{const copy=structuredClone(value);fn(copy);return copy};
test('bounded claims retain exact master semantics and unverified limits',()=>lib.claims(side));
test('independently recompute mobile selections, recovery, correlation and clock',()=>lib.mobile(mobile,cleanup));
test('independently recompute actual AppFrame boxes and no-intermediate controls',()=>lib.appframe(appframe));
test('real inputs and whole module seams bind to installed and loaded bytes',()=>lib.sourceChecks());
test('all prior frozen bytes including four rejected-v1 mappings remain intact',()=>{const now=require('../.artifacts/deep-audit-round3-acceptance/integrity.cjs').gather();assert.deepEqual(now,lib.load('integrity-before.json'))});
function bindings(c){const expected={mobile:'mobile-v1/result.json',appframe:'appframe-v1/receipt.json',summary:'independent-summary-v1.json',mobileCleanup:'mobile-v1/cleanup.json',derivations:'runner-derivations.json'};assert.deepEqual(Object.keys(c.receiptBindings).sort(),Object.keys(expected).sort());for(const [key,p]of Object.entries(expected)){const b=c.receiptBindings[key];assert.equal(b.path,'.artifacts/deep-audit-round3-acceptance/'+p);assert.equal(b.sha256,lib.sha(fs.readFileSync(path.join(lib.root,p))))}}
test('receipts use exact independent run identities, not author summaries',()=>bindings(side));
test('all rows preserve five original dimensions and decline whole USER promotion',()=>{const dims=['normal','error-recovery','concurrency-switch','isolation','a11y'];assert.equal(side.rows.length,3);for(const row of side.rows){assert.deepEqual(Object.keys(row.scenarios).sort(),dims.toSorted());assert.equal(row.wholeUserAccepted,false);assert.equal(row.masterStatusUnchanged,true);for(const s of Object.values(row.scenarios))assert.ok(s.status&&Array.isArray(s.evidence)&&Array.isArray(s.unverified))}});
const mobileBad=[
 ['bad selected business receipt',r=>r.serverTrace.find(x=>x.type==='controlled-business-receipt').outcome.value.answers[0].selected=['Option 2']],
 ['stale carrier falsely accepted',r=>r.checks.find(x=>x.stale).stale.ok=true],
 ['unknown client falsely accepted',r=>r.checks.find(x=>x.unknown).unknown.ok=true],
 ['duplicate controlled settlement',r=>r.serverTrace.push(r.serverTrace.find(x=>x.type==='controlled-business-receipt'))],
 ['wrong HTTP correlation',r=>r.browserTrace.find(x=>x.type==='http-response').rpcId='invented'],
 ['erase retry draft failure',r=>r.checks.find(x=>x.state).state.checked=['true','false','false']],
 ['erase connecting trace',r=>r.browserTrace=r.browserTrace.filter(x=>!(x.type==='connection-state'&&x.state==='connecting'))],
 ['cross-clock reversal disguised as renderer time',r=>r.browserTrace.find(x=>x.type==='http-response').t=-1000],
 ['hide in-flight UI lifetime finding',r=>r.findings.pop()],
 ['untrusted input called trusted touch',r=>r.browserTrace.filter(x=>x.type==='ui-click').forEach(x=>x.trusted=false)]
];
for(const [name,fn]of mobileBad)test('reject mobile '+name,()=>assert.throws(()=>lib.mobile(mutate(mobile,fn),cleanup)));
const appBad=[
 ['fake guest source hash',r=>r.loaded['@deepseek-ai/dsh-client-ui-layout']='0'.repeat(64)],
 ['fake guest rectangle accepted as actual frame',r=>r.measurements[0].guest.frame.width=1],
 ['read-rect contamination of passive window',r=>r.measurements.find(x=>x.name==='passive-only-home-5200ms').passiveBeforeTerminalRead.trace.push({type:'explicit-rect-read'})],
 ['hide native capability attempt',r=>r.nativeAttempts.push('clipboard.readText')],
 ['inflated assertion denominator',r=>r.checks.push(r.checks[0])]
];
for(const [name,fn]of appBad)test('reject layout '+name,()=>assert.throws(()=>lib.appframe(mutate(appframe,fn))));
const claimsBad=[
 ['whole-user promotion',c=>c.wholeUserAccepted=true],
 ['global coverage promotion',c=>c.globalCoveragePromotion=true],
 ['wrong master labels',c=>c.masterPreserved.summary={automated:115,blocked:104,total:598}],
 ['old44 added to current12',c=>c.counts.mobileChecks=56],
 ['assertions called user operations',c=>c.counts.unit='USER operations'],
 ['wrong master source',c=>c.masterPreserved.sha256='0'.repeat(64)],
 ['Android full-chain claim',c=>c.unverified.android=false],
 ['WAN claim',c=>c.unverified.wan=false],
 ['full Host claim',c=>c.unverified.fullHost=false],
 ['manual result injection claimed session projection',c=>c.clock.resultDOM='actual-host-session-projection'],
 ['cross-clock subtraction',c=>c.clock.crossClockSubtraction=true],
 ['HTTP headers called accepted ACK',c=>c.clock.httpResponseMeaning='parsed-ACK'],
 ['heterogeneous scenarios called P99 samples',c=>c.clock.percentiles=true],
 ['unrun snapshot load claimed tested',c=>c.clock.largeSnapshot=true],
 ['fake rectangle guest claimed official',c=>c.chain.appframe='LAYOUT FIXTURE ONLY'],
 ['white column marked resolved',c=>c.unverified.persistentWhiteColumnResolved=false],
 ['capture declared nonintrusive',c=>c.observation.captureCanAffectLayout=false],
 ['unmeasured pre-read pixels called proven',c=>c.unverified.preReadPixelsProven=false],
 ['unrun snapshot ordering accepted',c=>c.unverified.snapshotOrdering=false],
 ['unrun nonce isolation accepted',c=>c.unverified.nonceIsolation=false],
 ['unrun expiry matrix accepted',c=>c.unverified.expiryDeadlineMatrix=false],
 ['empty ok called business-winner',c=>c.transportSemantics.rpcSuccess='business-winner'],
 ['general HTTP503 called proof of no dispatch',c=>c.transportSemantics.preDispatchProof='HTTP503-alone']
];
for(const [name,fn]of claimsBad)test('reject claims '+name,()=>assert.throws(()=>lib.claims(mutate(side,fn))));
test('reject swapped author receipt provenance',()=>assert.throws(()=>bindings(mutate(side,c=>c.receiptBindings.mobile.path='.artifacts/deep-audit-round3-mobile-ui/recovery-v6/result.json'))));
test('reject changed receipt bytes',()=>assert.throws(()=>bindings(mutate(side,c=>c.receiptBindings.mobile.sha256='f'.repeat(64)))));
