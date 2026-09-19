'use strict'
// Deterministic test-only derivative. Frozen producer fixtures are never edited.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),key=process.argv[2]||'auto-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex');assert.match(key,/^[A-Za-z0-9-]{1,100}$/);process.argv[2]=key;
const base=path.join(root,'.artifacts/deep-audit-round1-reconnect-controller');fs.mkdirSync(base,{recursive:true});const prepared=path.join(base,'source-'+key);fs.mkdirSync(prepared);
const frozen=path.join(root,'tests/fixtures/deep-audit-mobile-recovery/run.cjs'),before=fs.readFileSync(frozen,'utf8'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');let source=before;const edits=[];
function change(a,b,all=false){const n=source.split(a).length-1;assert.ok(n>0,'missing exact source transform '+a);if(!all)assert.equal(n,1,a);source=source.split(a).join(b);edits.push({before:a,after:b,count:n});}
change("const root=path.resolve(__dirname,'../../..')",'const root='+JSON.stringify(root));
change(".artifacts/deep-audit-round1-mobile",".artifacts/deep-audit-round1-reconnect-controller",true);
change(" input(__filename);"," input(__filename);input('tests/fixtures/deep-audit-reconnect-controller/chain.cjs');input('tests/fixtures/deep-audit-mobile-recovery/run.cjs');");
change("'NetworkReconnectPolicy'].map","'NetworkReconnectPolicy','RemoteReconnectController'].map");
change("'DeepAuditMobileRecoveryTest'","'DeepAuditReconnectControllerTest'");
change("io.harnessdesktop.mobile.DeepAuditMobileRecoveryTest","io.harnessdesktop.mobile.DeepAuditReconnectControllerTest");
change("['normal-0','late-0']","['normal-0','late-0','recovery-0']",true);
change("assert.equal(java.automaticRecoveryExecuted,false)","assert.equal(java.automaticRecoveryExecuted,true)");
change("assert.equal(java.requests.length,2)","assert.equal(java.requests.length,3)");
change("assert.equal(java.requests.filter(r=>r.ok).length,1)","assert.equal(java.requests.filter(r=>r.ok).length,2)");
change("[['late-0',1],['normal-0',1]]","[['late-0',1],['normal-0',1],['recovery-0',1]]");
change("e.role==='mobile').length,1)","e.role==='mobile').length,2)");
change("commands:2,acks:1,expectedLoss:1,duplicateCoreExecution:0,mobileHellos:1","commands:3,acks:2,expectedLoss:1,duplicateCoreExecution:0,mobileHellos:2");
change("automaticRecoveryExecuted:false,ownerBoundary:'MainActivity Android Handler; no current production controller seam'","automaticRecoveryExecuted:true,ownerBoundary:'same production RemoteReconnectController used by Activity; real ScheduledExecutor replaces Handler only',recovery:java.recovery");
change("['This is negative owner-boundary evidence, not automatic retry passing','one explicitly initial start, zero reconnection starts','no TLS/WAN/Android lifecycle/WebView/native P2P/real RPC/LLM','manual synthetic NetworkReconnectPolicy commit is not actual Android callback dispatch']","['one explicit initialization; production controller timer creates second connection at unchanged 3000ms delay','no TLS/WAN/Android lifecycle/WebView/native P2P/real RPC/LLM','virtual scheduler logic cases separately identified; live WSS retry uses real monotonic clock']");
change("'same exact-port network fences, mapping and real components'","'same exact-port network fences, mapping and real components','same untransformed production controller drives automatic retry'");
change("'no manual reconnect or test retry controller'","'no manual reconnect or test retry controller; only Scheduler ports substituted'");
const generated=path.join(prepared,'executed-chain.cjs');fs.writeFileSync(generated,source);fs.writeFileSync(path.join(prepared,'derivation.json'),JSON.stringify({frozen:path.relative(root,frozen),frozenSha256:sha(before),executedSha256:sha(source),wrapperSha256:sha(fs.readFileSync(__filename)),edits},null,2));require(generated);
