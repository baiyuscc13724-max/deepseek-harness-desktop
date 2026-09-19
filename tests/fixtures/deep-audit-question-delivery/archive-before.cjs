'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../..'),out=path.join(repo,'.artifacts/deep-audit-question-delivery/before-v2');assert.ok(!fs.existsSync(out),'immutable before archive');
const files=new Set(JSON.parse(fs.readFileSync(path.join(repo,'.artifacts/deep-audit-round3-question-delivery-design/inputs.json'))).files.map(x=>x.file));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[])}
for(const f of walk(path.join(repo,'scripts')))files.add(path.relative(repo,f));
for(const f of ['docs/deep-audit/round3-validation.md','docs/deep-audit/round3-question-delivery-design.md','docs/deep-audit/coverage-round3.json','.artifacts/deep-audit-round3-acceptance/final-freeze.json'])files.add(f);
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');fs.mkdirSync(out,{recursive:true});const mapping=[];
for(const file of new Set([...files].map(f=>f.replaceAll('\\','/')))){const bytes=fs.readFileSync(path.join(repo,file)),saved=path.join(out,'original',file);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.writeFileSync(saved,bytes,{flag:'wx'});assert.equal(sha(fs.readFileSync(saved)),sha(bytes));mapping.push({file,sha256:sha(bytes),savedPath:path.relative(repo,saved)})}
assert.equal(mapping.find(x=>x.file==='scripts/patch-official-runtime.mjs').sha256,'cecd16cc8ddd9627be92170c038a7a0c6ad4b904c30a9b71cc5a86cbbf5034b4');
fs.writeFileSync(path.join(out,'mapping.json'),JSON.stringify({purpose:'Full before bytes; only future authorized installer drift resolves to this original, never rewrite old freezes',files:mapping},null,2),{flag:'wx'});console.log(JSON.stringify({files:mapping.length,out}));
