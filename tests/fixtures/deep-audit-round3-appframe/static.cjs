'use strict';
// Read-only source excerpts for bootstrap/CSP rationale. Does not execute product modules.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');const repo=path.resolve(__dirname,'../../..');
const files=['node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-Df-65__b.js','node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html','node_modules/@deepseek-ai/dsh-web/lib/index.js','node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js','node_modules/@deepseek-ai/dsh-web-app/lib/index.js'];
const records=files.map(name=>{const bytes=fs.readFileSync(path.join(repo,name)),text=bytes.toString();const excerpts=[...text.matchAll(/new Function|Content-Security-Policy|content-security-policy|unsafe-eval|defineStore:/g)].map(m=>({index:m.index,term:m[0],excerpt:text.slice(Math.max(0,m.index-240),m.index+550)}));return{path:name,sha256:createHash('sha256').update(bytes).digest('hex'),excerpts};});
const dest=path.join(repo,'.artifacts/deep-audit-round3-appframe/static-bootstrap.json');fs.writeFileSync(dest,JSON.stringify(records,null,2),{flag:'wx'});console.log('Static rationale saved; no product code executed');
