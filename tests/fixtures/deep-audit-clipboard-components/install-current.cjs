'use strict';
// Reviewed orderedInstall/fixture pattern from frozen core/question installation tests.
// Only calls named exported APIs with explicit fresh temp paths. Never invokes the CLI.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const sha=v=>createHash('sha256').update(v).digest('hex');
const FINAL='30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066';
const BASE='7ee5792b3f15ac1b691eee7d373869101f8c7d336fc22b3f66d082612e4b1bae';
const PINS={
 'scripts/patch-official-runtime.mjs':'cecd16cc8ddd9627be92170c038a7a0c6ad4b904c30a9b71cc5a86cbbf5034b4',
 'scripts/deep-audit-session-core-patch.mjs':'e86c9d2d96d850d8e0bf545e3343a793c7729cd173f6b0a9252b33458b2952bc',
 'scripts/deep-audit-question-card-patch.mjs':'251b67da1cc2c3846181200a681bb9849927758e0ace48d6eac72b0d773f2fe7',
 'tests/deep-audit-session-core-install.test.cjs':'bc04b80c2ffffcf8270ff568e4b75b69a85a8ca492be385d17bc6fd97aa638b5',
 'tests/deep-audit-question-card-install.test.cjs':'ab76113f37e680ae674156eb3e0c0553b547053823622cf3dcc309c1b4dec18e'
};
function verifyPins(repo){for(const [file,hash]of Object.entries(PINS))assert.equal(sha(fs.readFileSync(path.join(repo,file))),hash,'Frozen installer reference '+file);}
function moduleHashes(repo){
 const found={};function visit(file){const relative=path.relative(repo,file);if(found[relative])return;const text=fs.readFileSync(file,'utf8');found[relative]=sha(text);
 for(const match of text.matchAll(/(?:from\s+|import\s*)['"](\.\/[^'"]+\.mjs)['"]/g))visit(path.resolve(path.dirname(file),match[1]));}
 visit(path.join(repo,'scripts/patch-official-runtime.mjs'));return found;
}
async function install(repo,out){
 verifyPins(repo);const importedBefore=moduleHashes(repo);
 const runtime=path.join(out,'profile','installed-runtime');assert.ok(!fs.existsSync(runtime),'Fresh temp package required');
 const modules=path.join(runtime,'node_modules'),files={},metadata={},sourceHashes={},stages=[];
 const clients=['dsh-api-session-controller','dsh-client-ui-chat','dsh-client-ui-conversation','dsh-client-connection','dsh-client-ui-schedule','dsh-client-ui-attachment','dsh-client-ui-user-questions'];
 const servers=['dsh-session-turn-outline','dsh-api-gateway','dsh-api-remotes','dsh-session','dsh-session-projection-cache','dsh-storage-domain','dsh-storage-json','dsh-llm-pi-ai'];
 for(const[name,file]of[...clients.map(n=>['@deepseek-ai/'+n,'client.js']),...servers.map(n=>['@deepseek-ai/'+n,'index.js']),['dsh-plugin-marketplace','index.js']]){
  const folder=path.join(modules,name);fs.mkdirSync(path.join(folder,'lib'),{recursive:true});
  for(const relative of ['package.json','lib/'+file]){const source=path.join(repo,'node_modules',name,relative),target=path.join(folder,relative);const bytes=fs.readFileSync(source);sourceHashes[path.relative(repo,source)]=sha(bytes);fs.writeFileSync(target,bytes,{flag:'wx'});}
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'package.json'),'utf8'));
  assert.equal(manifest.name,name);assert.equal(manifest.version,name==='dsh-plugin-marketplace'?'1.5.5':'0.1.2-alpha.5');
  metadata[name]={name:manifest.name,version:manifest.version,sha256:sha(fs.readFileSync(path.join(folder,'package.json')))};
  files[name]=path.join(folder,'lib',file);
 }
 const snapshot=()=>Object.fromEntries(Object.entries(files).map(([name,file])=>[name,sha(fs.readFileSync(file))]));
 const api=await import(pathToFileURL(path.join(repo,'scripts/patch-official-runtime.mjs')).href);
 const conversation=files['@deepseek-ai/dsh-client-ui-conversation'];
 stages.push({stage:'copied-cache',files:snapshot()});
 // Exact already-accepted restore helper; write only temp input to exercise full normal install.
 const raw=api.restoreModernConversationComposerVisibilitySource(fs.readFileSync(conversation,'utf8'));assert.equal(sha(raw),BASE);fs.writeFileSync(conversation,raw);
 stages.push({stage:'official-input',files:snapshot()});
 const targets={conversation,session:files['@deepseek-ai/dsh-api-session-controller'],attachment:files['@deepseek-ai/dsh-client-ui-attachment']};
 const sequence=async(prefix)=>{
  const operations=[
   ['preflight',()=>api.assertInstalledAlpha5RuntimePreflight(runtime)],
   ['visibility',()=>api.patchInstalledModernConversationComposerVisibility(conversation)],
   ['provider',()=>api.patchInstalledProviderAuthIsolation(files['@deepseek-ai/dsh-llm-pi-ai'])],
   ['marketplace',()=>api.patchInstalledMarketplace155(files['dsh-plugin-marketplace'])],
   ['imageQueue',()=>api.patchInstalledAlpha5ImageQueuePerformance(targets)],
   ['core',()=>api.patchInstalledSessionCoreClient(conversation)],
   ['question',async()=> (await api.patchQuestionCardRuntime(runtime)).changed]
  ];const results={};for(const[name,operation]of operations){results[name]=await operation();stages.push({stage:prefix+name,result:results[name],files:snapshot()});}return results;
 };
 const first=await sequence('install:');assert.equal(sha(fs.readFileSync(conversation)),FINAL);
 const after=snapshot();const repeat=await sequence('repeat:');assert.deepEqual(snapshot(),after);for(const value of Object.values(repeat))assert.equal(value,false);
 assert.equal(after['@deepseek-ai/dsh-client-ui-user-questions'],'6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457');
 for(const[name,record]of Object.entries(metadata))assert.equal(sha(fs.readFileSync(path.join(modules,name,'package.json'))),record.sha256);
 for(const[file,hash]of Object.entries(sourceHashes))assert.equal(sha(fs.readFileSync(path.join(repo,file))),hash,'Real source unchanged');
 verifyPins(repo);assert.deepEqual(moduleHashes(repo),importedBefore);
 const receipt={runtime:path.relative(out,runtime),conversation:path.relative(out,conversation),actualInstalledSha256:FINAL,metadata,sourceHashes,installerModules:importedBefore,pinnedReferences:PINS,stages,first,repeat,drift:0};
 fs.writeFileSync(path.join(out,'installation.json'),JSON.stringify(receipt,null,2));return receipt;
}
module.exports={install,FINAL,verifyPins,moduleHashes};
