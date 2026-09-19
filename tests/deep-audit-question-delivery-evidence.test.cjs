'use strict';
// Metadata-only integration gate. Never runs installers, Electron, product code or network.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../.artifacts/deep-audit-question-delivery-acceptance/integration');
const h=require(path.join(root,'integrity.cjs')),s=require(path.join(root,'semantic.cjs'));
const b=s.bundle(),summary=s.summarize(b),copy=x=>structuredClone(x);
test('source closure: old mappings, author failures, accepted two streams and unchanged master',()=>{const current=h.gather(),before=h.load('.artifacts/deep-audit-question-delivery-acceptance/integration/integrity-before.json');assert.deepEqual(current,before);});
test('strict raw receipt and semantics baseline; no product execution',()=>s.validate(b,summary));
test('installation receipts resolve actual files; three path-only edits and exact chain extraction',()=>s.verifyInstallBytes(b));
test('pre-recovery eight files remain exact originals and exact preserved copies',()=>{const m=JSON.parse(fs.readFileSync(path.join(root,'pre-recovery-v3/manifest.json')));assert.equal(m.files.length,8);for(const e of m.files)for(const p of [e.file,'pre-recovery-v3/'+e.file])assert.equal(h.sha(fs.readFileSync(path.join(root,p))),e.sha256);});
test('published integration summary is exactly independently rederived',()=>{const actual=h.load('.artifacts/deep-audit-question-delivery-acceptance/integration/summary.json');s.validate(b,actual);});
const summaryChanges=[
 ['bad-question-pair',x=>x.pair.question='0'.repeat(64)],['mixed-gateway-pair',x=>x.pair.gateway='55dbd591222b28e557e7d47368f7770114a88d97206e910fae940768c83950cd'],
 ['wrong-companion',x=>x.pair.conversation='0'.repeat(64)],['matrix-count-upgrade',x=>x.counts.ui[0].checks=202],['all-34-pure-network',x=>x.counts.ui[0].pureNetworkScenarios=34],
 ['receipt-count-upgrade',x=>x.counts.ui[0].controlledReceipts=14],['same-denominator-80-plus-44',x=>x.counts.legacyLocalOracle=124],['122-probes-not-subchecks',x=>x.counts.supplement.probes=122],
 ['unknown-cap-includes-editing',x=>x.counts.supplement.totalViews=32],['all-old-records-invalid',x=>x.counts.supplement.independentTrue=0],
 ['43-receipts-not-tests',x=>x.counts.installation.matrixReceipts=43],['installer-cross-file-atomic',x=>x.counts.installation.crossFileAtomic=true],['real-CLI-execution',x=>x.counts.installation.cliExecuted=true],
 ['promote-global-coverage',x=>x.globalCoveragePromotion=true],['whole-user-complete',x=>x.wholeUserAccepted=true],['wrong-master-meaning',x=>x.master.summary.independentlyAccepted=115],['wrong-master-hash',x=>x.master.sha256='0'.repeat(64)],
 ...Object.keys(s.semantics).map(key=>['semantic-ceiling-'+key,x=>x.semantics[key]=typeof x.semantics[key]==='boolean'?!x.semantics[key]:'UNBOUNDED CLAIM']),
 ...s.unknown.map(key=>['remove-unverified-'+key,x=>x.unverified=x.unverified.filter(t=>t!==key)])
];
for(const [name,change]of summaryChanges)test('reject metadata mutation: '+name,()=>{const x=copy(summary);change(x);assert.throws(()=>s.validate(b,x));});
const rawChanges=[
 ['bad-controlled-receipt',x=>x.matrices[0].result.serverTrace.find(e=>e.type==='controlled-business-receipt').outcome.value.answers[0].selected=['BAD']],
 ['wrong-dispatch-event',x=>x.matrices[0].result.serverTrace.find(e=>e.type==='gateway-dispatch').payload.args.eventId='unknown-event'],
 ['bad-rpc-correlation',x=>x.matrices[0].result.browserTrace.find(e=>e.type==='rpc-json-decoded').rpcId='wrong-rpc'],
 ['duplicate-business-replay',x=>x.matrices[0].result.browserTrace.push(copy(x.matrices[0].result.browserTrace.find(e=>e.type==='rpc-submit')))],
 ['headers-removal-before-json',x=>{const t=s.check(x.matrices[0].result,'renderer-only full-body timing').timing;t.removed=t.headers;}],
 ['invented-result-projection',x=>x.matrices[0].result.results.push({completeHost:true})],
 ['fake-same-tick-selection',x=>s.check(x.matrices[0].result,'same-tick extra selection + double-submit retains both, one RPC').receipt.value.answers[0].selected.pop()],
 ['wrong-source',x=>x.matrices[0].result.sources[0].sha256='0'.repeat(64)],
 ['fake-source-path',x=>x.matrices[0].result.sources[0].file='no-such-source-file'],
 ['fake-bootstrap-derivation',x=>x.matrices[0].result.derivations[0].replacement+='/* pretend source */'],
 ['missing-original-check',x=>x.matrices[0].result.checks.pop()],
 ['unknown-is-success',x=>s.check(x.matrices[0].result,'wrong rpcId is unknown, never success').observed=false],
 ['wrong-cap-33',x=>s.check(x.probe,'A: owner pressure transition 40').details.visibleUnknown=33],
 ['editing-sentinel-evicted',x=>s.check(x.probe,'A: owner pressure transition 40').details.editingRemoves=1],
 ['retired-save-allowed',x=>x.probe.checks.find(e=>e.name.endsWith('strict old save result')&&e.details.expected===false).details.actual=true],
 ['new-record-corrupted',x=>x.probe.checks.find(e=>e.name.endsWith('new record unchanged')).details.after='changed'],
 ['wrong-install-pair',x=>x.install[0].files['node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js']='0'.repeat(64)],
 ['native-gate-zero-write-false',x=>x.install.find(e=>e.title.startsWith('native ')).zeroWrites=false],
 ['CAS-claims-overwrite-safe',x=>x.supplement.find(e=>e.title.startsWith('CAS ')).externalEditPreserved=false],
 ['final-pair-race-success',x=>x.supplement.find(e=>e.title==='final-pair-race').returnedSuccess=true],
 ['installer-log-missing-check',x=>x.logs.matrix=x.logs.matrix.replace(/^✔ .*\r?\n/,'')],
 ['cleanup-leak',x=>x.matrices[0].cleanup.pending=1],
 ['wrong-clock-shortened-deadline',x=>s.check(x.matrices[0].result,'actual 30s timeout recovers generation; no frame means no retry; local hide sends nothing').rendererWaitMs=30],
 ['false-touch-size',x=>s.check(x.matrices[0].result,'narrow unknown notice local-dismiss geometry').dismissBox.height=22]
];
for(const[name,change]of rawChanges)test('reject raw mutation: '+name,()=>{const x=copy(b);change(x);assert.throws(()=>s.validate(x,summary));});
test('sidecar links old five dimensions without changing any master status',()=>{const c=h.load('docs/deep-audit/coverage-question-delivery.json');assert.equal(c.globalCoveragePromotion,false);assert.equal(c.wholeUserAccepted,false);assert.deepEqual(c.masterPreserved,summary.master);assert.deepEqual(c.counts,{uiMatrixPerRun:80,uiRuns:2,originalChainGeometry:34,directComponent:46,beforeCharacterization:7,legacyLocalOracle:44,supplementProbes:2,supplementSubchecks:122,installTests:43,installSupplementTests:17});assert.deepEqual(c.unverified,summary.unverified);const old=h.load('docs/deep-audit/coverage-round3.json');for(const row of c.rows){assert.equal(row.wholeUserAccepted,false);assert.equal(row.masterStatusUnchanged,true);assert.deepEqual(Object.keys(row.scenarios),['normal','error-recovery','concurrency-switch','isolation','a11y']);for(const scenario of Object.values(row.scenarios)){assert.ok(['bounded-pass','unverified','retained-failure'].includes(scenario.status));assert.equal(scenario.promotesMaster,false)}assert.ok(row.relatedIds.every(id=>old.rows.some(x=>x.id===id||x.relatedIds?.includes(id))||old.findings.includes(id)));}});
