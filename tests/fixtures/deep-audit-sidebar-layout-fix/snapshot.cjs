'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const repo=path.resolve(__dirname,'../../..'),base=path.join(repo,'.artifacts/deep-audit-round2-sidebar-layout-fix'),destination=path.join(base,'before-inputs');
const pins=require('../deep-audit-sidebar-layout/pins.json'),sha=b=>createHash('sha256').update(b).digest('hex');
assert.ok(!fs.existsSync(destination),'Original snapshot already exists');
const contents=Object.entries(pins).map(([name,hash])=>{const bytes=fs.readFileSync(path.join(repo,name));assert.equal(sha(bytes),hash,'Original input changed before capture: '+name);return {name,hash,bytes}});
for(const {name,bytes}of contents){const file=path.join(destination,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}
const accepted=JSON.parse(fs.readFileSync(path.join(repo,'.artifacts/deep-audit-round2-sidebar-layout/delivery-freeze.json')));const frozen={};for(const [name,meta]of Object.entries(accepted.outputs)){const bytes=fs.readFileSync(path.join(repo,name));assert.equal(sha(bytes),meta.sha256,'Accepted evidence changed: '+name);frozen[name]=meta.sha256;}
frozen['.artifacts/deep-audit-round2-sidebar-layout/delivery-freeze.json']=sha(fs.readFileSync(path.join(repo,'.artifacts/deep-audit-round2-sidebar-layout/delivery-freeze.json')));
fs.writeFileSync(path.join(base,'before-inputs.json'),JSON.stringify({sourceRoot:'before-inputs',inputs:pins,acceptedEvidence:frozen},null,2),{flag:'wx'});console.log('Original complete 13-input snapshot captured; accepted evidence hashes verified');
