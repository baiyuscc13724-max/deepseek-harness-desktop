'use strict'
// Explicit executable evidence runner; fresh run name mandatory. No existing evidence is rewritten.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
const spawnSync=require('node:child_process').spawnSync
const repo=path.resolve(__dirname,'..'), fixtures=path.join(__dirname,'fixtures/deep-audit-question-delivery')
const sha=x=>crypto.createHash('sha256').update(x).digest('hex')
const name=process.argv[2]; assert.match(name||'',/^[a-z0-9-]+$/)
const out=path.join(repo,'.artifacts/deep-audit-question-delivery',name); assert.ok(!fs.existsSync(out),'Never overwrite a run'); fs.mkdirSync(out,{recursive:true})
const fence=require(path.join(fixtures,'fence.cjs'))(path.join(out,'home'))
const log=fs.openSync(path.join(out,'process.log'),'wx')
const inputs=new Map()
function bind(file){file=path.resolve(file); if(!inputs.has(file)) inputs.set(file,sha(fs.readFileSync(file))); return file}
function walk(dir){if(!fs.existsSync(dir))return []; return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.isFile()?[path.join(dir,e.name)]:[])}
function json(file,value){fs.writeFileSync(path.join(out,file),JSON.stringify(value,null,2))}
async function main(){
  for(const file of walk(path.join(repo,'docs/deep-audit'))) if(!path.basename(file).startsWith('round3') && !path.basename(file).includes('round3')) bind(file)
  for(const root of ['.artifacts/deep-audit-round1-clipboard','.artifacts/deep-audit-round1-reconnect-acceptance','.artifacts/deep-audit-round2-fixes-acceptance']) for(const file of walk(path.join(repo,root))) bind(file)
  for(const root of ['scripts','mobile/android/app/src/main','electron/bridge','electron/store']) for(const file of walk(path.join(repo,root))) bind(file)
  for(const file of [...walk(fixtures),__filename]){bind(file);const copy=path.join(out,'fixture-source',path.relative(repo,file));fs.mkdirSync(path.dirname(copy),{recursive:true});fs.copyFileSync(file,copy)}
  // Bind complete local package dependency closure, including non-@deepseek ESM/CJS modules.
  const seenPackages=new Set();function bindPackage(name,from=path.join(repo,'package.json')){const req=require('node:module').createRequire(from);let entry;try{entry=req.resolve(name)}catch{return}if(!path.isAbsolute(entry))return;let dir=path.dirname(entry);while(!fs.existsSync(path.join(dir,'package.json'))&&path.dirname(dir)!==dir)dir=path.dirname(dir);if(seenPackages.has(dir))return;seenPackages.add(dir);for(const file of walk(dir))if(!file.includes(path.sep+'node_modules'+path.sep+'node_modules'+path.sep))bind(file);const manifest=path.join(dir,'package.json'),pkg=JSON.parse(fs.readFileSync(manifest));for(const dependency of Object.keys(pkg.dependencies||{}))bindPackage(dependency,manifest)}
  for(const pkg of ['@deepseek-ai/dsh-api-gateway','@deepseek-ai/dsh-client-connection'])bindPackage(pkg)
  json('dependency-roots.json',[...seenPackages].map(file=>path.relative(repo,file)))
  for(const name of fs.readdirSync(path.join(repo,'node_modules/@deepseek-ai'))) {
    const dir=path.join(repo,'node_modules/@deepseek-ai',name)
    for(const file of walk(dir)) if(/\.(?:js|cjs|mjs|json|css)$/.test(file)) bind(file)
  }
  const requireModule=require('node:module'), originalLoad=requireModule._load
  requireModule._load=function(id,parent,isMain){const target=requireModule._resolveFilename(id,parent,isMain);if(path.isAbsolute(target)&&fs.existsSync(target))bind(target);return originalLoad.apply(this,arguments)}
  const beforeMode=process.argv[3]==='before';json('mode.json',{beforeMode});
  assert.equal(sha(fs.readFileSync(path.join(repo,'docs/deep-audit/coverage-master.json'))),'8d5cad11503953cb9044a96902ab92d718cb21ae17107313549c5e45fb527794')
  const runtime=path.join(out,'installed-runtime'); const files={}
  const clients=['dsh-api-session-controller','dsh-client-ui-chat','dsh-client-ui-conversation','dsh-client-connection','dsh-client-ui-schedule','dsh-client-ui-attachment','dsh-client-ui-user-questions']
  const servers=['dsh-session-turn-outline','dsh-api-gateway','dsh-api-remotes','dsh-session','dsh-session-projection-cache','dsh-storage-domain','dsh-storage-json','dsh-llm-pi-ai']
  for(const [pkg,file] of [...clients.map(n=>['@deepseek-ai/'+n,'client.js']),...servers.map(n=>['@deepseek-ai/'+n,'index.js']),['dsh-plugin-marketplace','index.js']]){
    const dir=path.join(runtime,'node_modules',pkg);fs.mkdirSync(path.join(dir,'lib'),{recursive:true})
    for(const relative of ['package.json','lib/'+file])fs.copyFileSync(bind(path.join(repo,'node_modules',pkg,relative)),path.join(dir,relative))
    files[pkg]=path.join(dir,'lib',file)
  }
  const gatewayClient=path.join(runtime,'node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js');fs.copyFileSync(bind(path.join(repo,'node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js')),gatewayClient);
  const api=await import(require('node:url').pathToFileURL(path.join(repo,beforeMode?'.artifacts/deep-audit-question-delivery/before-v2/original/scripts/patch-official-runtime.mjs':'scripts/patch-official-runtime.mjs')).href)
  const core=files['@deepseek-ai/dsh-client-ui-conversation'];fs.writeFileSync(core,api.restoreModernConversationComposerVisibilitySource(fs.readFileSync(core,'utf8')))
  await (beforeMode?api.assertInstalledAlpha5RuntimePreflight:api.assertInstalledQuestionDeliveryPreflight)(runtime)
  await api.patchInstalledModernConversationComposerVisibility(core)
  await api.patchInstalledProviderAuthIsolation(files['@deepseek-ai/dsh-llm-pi-ai'])
  await api.patchInstalledMarketplace155(files['dsh-plugin-marketplace'])
  await api.patchInstalledAlpha5ImageQueuePerformance({conversation:core,session:files['@deepseek-ai/dsh-api-session-controller'],attachment:files['@deepseek-ai/dsh-client-ui-attachment']})
  await api.patchInstalledSessionCoreClient(core);await (beforeMode?api.patchQuestionCardRuntime:api.patchQuestionDeliveryRuntime)(runtime)
  const question=files['@deepseek-ai/dsh-client-ui-user-questions']
  const helper=await import(require('node:url').pathToFileURL(path.join(repo,'scripts/deep-audit-question-delivery-patch.mjs')).href);assert.equal(sha(fs.readFileSync(question)),beforeMode?'6f382a535cb182b062365773c57b23579e8195c0096901c1864c0b1ae0079457':helper.QUESTION_DELIVERY_SHA256);json('pair.json',{beforeMode,question:sha(fs.readFileSync(question)),gateway:sha(fs.readFileSync(gatewayClient))});
  assert.equal(sha(fs.readFileSync(core)),'30f413cc27be08f0b57a472440495b033ea8b708e281d465cd5bbe3e45cd0066')
  json('installed.json',Object.fromEntries(Object.entries(files).map(([p,f])=>[p,{path:path.relative(out,f),sha256:sha(fs.readFileSync(f))}])))
  const exe=bind(path.join(repo,'node_modules/electron/dist/electron.exe'))
  const env={};for(const k of ['PATH','SystemRoot','WINDIR','COMSPEC','PATHEXT','OS','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[k])env[k]=process.env[k]
  const profile=path.join(out,'electron-home');fs.mkdirSync(profile);for(const k of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP','DSH_HOME'])env[k]=profile
  const command=[path.join(fixtures,'electron.cjs'),out,repo,beforeMode?'before':'after',process.argv[4]||'matrix']
  json('command.json',{executable:exe,args:command,envKeys:Object.keys(env),profile,timeout:120000,ports:'one exclusive ephemeral synthetic loopback listener; registered before product load'})
  json('source-before.json',[...inputs].map(([file,sha256])=>({file:path.relative(repo,file),sha256})))
  const result=spawnSync(exe,command,{cwd:repo,env,stdio:['ignore',log,log],timeout:120000})
  json('exit.json',{status:result.status,signal:result.signal,error:result.error?.message})
  assert.ifError(result.error);assert.equal(result.status,0,'isolated Electron; retain process.log on failure')
  const receipt=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));assert.equal(receipt.cleanupErrors.length,0);assert.ok(receipt.checks.length>0)
  console.log(JSON.stringify({out,checks:receipt.checks.length,findings:receipt.findings,installed:{question:sha(fs.readFileSync(question)),core:sha(fs.readFileSync(core))}}))
}
main().catch(error=>{json('failure.json',{message:error.message,stack:error.stack});console.error(error);process.exitCode=1}).finally(()=>{
  const drift=[...inputs].filter(([file,hash])=>!fs.existsSync(file)||sha(fs.readFileSync(file))!==hash).map(([file,hash])=>({file:path.relative(repo,file),before:hash,after:fs.existsSync(file)?sha(fs.readFileSync(file)):null}))
  json('source-before.json',[...inputs].map(([file,sha256])=>({file:path.relative(repo,file),sha256})))
  json('integrity.json',{checked:inputs.size,sourceDrift:drift,fenceDenials:fence.denied});if(drift.length)process.exitCode=1
  fs.closeSync(log)
  const frozen=walk(out).filter(file=>!file.includes('electron-home')&&!file.includes(path.sep+'home'+path.sep)).map(file=>({file:path.relative(out,file),sha256:sha(fs.readFileSync(file))}))
  json('freeze.json',frozen)
})
