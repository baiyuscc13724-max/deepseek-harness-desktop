// Real Chromium + real React/ReactDOM. Local self-authored fixture only: no
// installed profile, replacement HTTP server, model call, or live browser tab.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const repo = path.resolve(__dirname, '../..')

async function main() {
  const externalTemp = process.argv[2]
  const temp = externalTemp || await fs.mkdtemp(path.join(os.tmpdir(), 'team-product-dom-'))
  app.setPath('userData', temp)
  let window
  const results = []
  try {
    await app.whenReady()
    window = new BrowserWindow({ show: false, useContentSize: true, width: 1000, height: 900, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, partition: `team-dom-${Date.now()}` } })
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
    const html = path.join(temp, 'index.html')
    await fs.writeFile(html, '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="root"></div></body></html>')
    await window.loadFile(html)
    const run = source => window.webContents.executeJavaScript(source)
    const client = await fs.readFile(path.join(repo, 'plugins/dsh-agent-teams/lib/client.js'), 'utf8')
    const marker = '    exports.apply = apply;'
    assert.equal(client.split(marker).length, 2)
    const seam = `exports.productTest = { TeamView, LeadSummary, TaskBoardWorkspace, ParticipantsWorkspace, ProfessionalSkills, DeliveryEvidence, zh, en, injectStyles };
      exports.setTestLive = function(live) { useTeamState = function() { return live; }; };
      exports.setTestLocale = function(t) { useLocale = function() { return t; }; };\n`
    await run(`{
      const localRequire = require('node:module').createRequire(${JSON.stringify(path.join(repo, 'node_modules/@deepseek-ai/dsh-client-ui-trajectory/node_modules/react-dom/package.json'))});
      window.React = localRequire('react'); window.ReactDOM = localRequire('react-dom'); window.Renderer = localRequire('react-dom/client');
      window.__ModuleLoader__ = { load(definition) { window.productModule = definition.factory(name => { if(name !== 'react') throw new Error('unexpected dependency '+name); return React; }); } };
      window.network = []; window.fetch = async (...args) => { network.push(args); return { ok:true, json:async()=>({unavailable:true}) }; }; void 0;
    }`)
    await run(client.replace(marker, seam + marker))
    await run(`window.api = productModule.productTest; api.injectStyles(); window.domRoot = Renderer.createRoot(document.getElementById('root'));
      window.t = key => api.en[key] || key;
      window.baseTeam = {id:'dom-team',objective:'Ship useful results',name:'DOM team',state:'active',revision:2,pauseEpoch:0,leadSessionId:'lead-dom',members:[],events:[],tasks:[]};
      window.mount = (name, props) => ReactDOM.flushSync(()=>domRoot.render(React.createElement(api[name], props)));
      window.visible = selector => [...document.querySelectorAll(selector)].filter(el=>el.checkVisibility());
      window.delay = () => new Promise(resolve=>setTimeout(resolve,35));
      window.calls = []; window.openLead = () => calls.push('lead'); void 0;
    `)
    for (const locale of ['zh','en']) {
      for (const mode of ['absent','partial','unknown','allowed','denied','draft','attention','plan-draft']) {
        const data = await run(`(() => {
          window.t=(key,values={})=>String(api[${JSON.stringify(locale)}][key]||key).replace(/\\{([^}]+)\\}/g,(_,name)=>String(values[name]??'{'+name+'}'));
          const authorization={permissions:'human_attested',files:'host_verified',cost:'human_attested',externalSideEffects:'human_attested'};
          const team={...baseTeam}; const mode=${JSON.stringify(mode)};
          if(mode!=='absent') team.plan={phase:'active',authorization:{...authorization}};
          if(mode==='partial') delete team.plan.authorization.cost;
          if(mode==='unknown') team.plan.authorization.files='unknown';
          if(mode==='denied') team.plan.authorization.files='denied';
          if(mode==='draft') team.plan.phase='draft';
          if(mode==='attention') team.attention={required:true};
          if(mode==='plan-draft') team.attention={codes:['plan_draft']};
          mount('LeadSummary',{t,team,canOpenLead:true,onOpenLead:openLead,onWorkDetails(){},onDiagnostics(){}});
          const notice=document.querySelector('[data-authorization-state]');
          return {state:notice?.dataset.authorizationState||null,text:document.body.innerText,role:notice?.getAttribute('role'),noDecision:t('leadNoDecision'),draft:t('leadPlanDraft')};
        })()`)
        if (['absent','partial','unknown'].includes(mode)) { assert.equal(data.state,'unknown'); assert.equal(data.role,'note'); assert.ok(!data.text.includes(data.noDecision)) }
        else if (mode==='allowed') { assert.equal(data.state,null); assert.ok(data.text.includes(data.noDecision)) }
        else { assert.ok(data.state); assert.ok(!data.text.includes(data.noDecision)); if(['draft','plan-draft'].includes(mode)) assert.ok(data.text.includes(data.draft)); if(mode==='denied') assert.equal(data.role,'alert') }
      }
    }
    results.push('16 bilingual authorization/phase/attention states')
    const skills = await run(`(() => {
      mount('ProfessionalSkills',{t,task:{professional:{mode:'specialized',skills:[
        {name:'bound',status:'bound'}, {name:'missing',status:'missing'}, {name:'forged-loaded',status:'loaded'},
        {name:'loaded',status:'loaded',evidence:{source:'skill_tool',contentHash:'a'.repeat(64),loadedAt:'2026-09-05T10:00:00Z'}}],limitations:['Not certification']}}});
      return [...document.querySelectorAll('[data-skill-status]')].map(el=>el.dataset.skillStatus);
    })()`)
    assert.deepEqual(skills,['bound','missing','unknown','loaded'])
    results.push('skill bound/missing/loaded evidence remains distinct')
    const delivery = await run(`(() => {
      mount('DeliveryEvidence',{t,task:{submission:{deliveryMode:'inline_bound',delivery:{summary:'Conclusion',content:'<img src=x onerror=alert(1)>',criteria:[{criterion:'Truth',evidence:'read'}],limitations:['lead-only']}},acceptance:{quality:'lead_reviewed',review:{summary:'reviewed text',criteria:[]}}}});
      return {text:document.body.innerText,images:document.querySelectorAll('img').length,details:[...document.querySelectorAll('details')].map(el=>el.open)};
    })()`)
    assert.ok(delivery.text.includes('<img src=x onerror=alert(1)>')); assert.equal(delivery.images,0); assert.deepEqual(delivery.details,[false,false])
    results.push('inline result is inert text; review/criteria closed initially')
    await run(`window.boardTeam={...baseTeam,tasks:[{id:'active',title:'CURRENT WORK',state:'in_progress'},{id:'cancelled',title:'CANCELLED HISTORY',state:'cancelled'},{id:'submitted',title:'AWAIT REVIEW',state:'submitted'}]};
      mount('TaskBoardWorkspace',{t,team:boardTeam,teams:[boardTeam],sessionId:'lead-dom',connection:'live',canOpenLead:true,onOpenLead:openLead,setWorkspaceView(){}}); delay()`)
    const initial = await run(`({history:document.querySelector('.dat-board-history').open,work:document.querySelector('.dat-work-details').open,diagnostics:document.querySelector('.dat-diagnostics').open,visibleCards:visible('.dat-board-card').length})`)
    assert.deepEqual(initial,{history:false,work:false,diagnostics:false,visibleCards:0})
    await run(`visible('button').find(el=>el.textContent===t('leadWorkDetails')).click()`)
    assert.equal(await run(`document.querySelector('.dat-work-details').open`),true)
    const focused = await run(`document.activeElement === document.querySelector('.dat-work-details>summary')`)
    assert.equal(focused,true)
    await run(`document.querySelector('.dat-board-card').focus()`)
    assert.equal(await run(`document.activeElement.tagName`),'BUTTON')
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    window.webContents.debugger.detach()
    await run('delay()')
    assert.ok(await run(`!!document.querySelector('.dat-task-focus')`),'Enter opens task detail in actual DOM')
    assert.equal(await run(`document.activeElement.classList.contains('dat-task-focus')`),true)
    await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); delay()`)
    assert.equal(await run(`document.activeElement.classList.contains('dat-board-card')`),true)
    assert.equal(await run(`!!document.querySelector('.dat-task-focus')`),false)
    results.push('native disclosure, Chromium Enter, detail focus and Escape restores original card focus')
    const snapshots = []
    for (const width of [360,1000]) {
      window.setContentSize(width,900)
      await run(`mount('LeadSummary',{t,team:{...baseTeam,objective:'很长的团队目标 Long objective '.repeat(8)},canOpenLead:true,onOpenLead:openLead,onWorkDetails(){},onDiagnostics(){}}); delay()`)
      const layout = await run(`({width:innerWidth,scroll:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(el=>({height:el.getBoundingClientRect().height,right:el.getBoundingClientRect().right}))})`)
      assert.ok(layout.scroll<=layout.width+1,JSON.stringify(layout)); assert.ok(layout.buttons.every(b=>b.height>=44&&b.right<=width+1),JSON.stringify(layout)); snapshots.push(layout)
    }
    results.push('360/1000 CSS layout: no horizontal overflow; button targets >=44px')
    await run(`productModule.setTestLocale(t); window.nav=[]; productModule.setTestLive({state:{enabled:true,teams:[baseTeam],activeTeamId:baseTeam.id},connection:'live',loading:false,reload(){}});
      mount('TeamView',{sessionId:'worker-dom',setView:view=>nav.push(['view',view]),sessions:{open:id=>{nav.push(['open',id]);return Promise.resolve()},send(){throw Error('no send')},resume(){throw Error('no resume')},fork(){throw Error('no fork')}}});`)
    await run(`visible('button').find(el=>el.textContent===t('leadChat')).click(); delay()`)
    assert.deepEqual(await run('nav'),[['open','lead-dom'],['view','chat']])
    results.push('TeamView navigates exact lead via sessions.open then chat; never sends/forks/resumes')
    console.log(JSON.stringify({ok:true,checks:results.length,results,layout:snapshots,engine:{electron:process.versions.electron,chrome:process.versions.chrome},limitations:['isolated source fixture, not installed 11353 GUI','local snapshot/fetch data doubles; real React lifecycle and Chromium DOM/CSS/input']},null,2))
    await run('ReactDOM.flushSync(()=>domRoot.unmount())')
  } finally { window?.destroy(); if (!externalTemp) await fs.rm(temp,{recursive:true,force:true}).catch(error=>{ if(error.code !== 'EBUSY' && error.code !== 'EPERM') throw error; console.warn('Temporary Chromium profile remains locked until process exit:',temp) }) }
}
app.on('window-all-closed',()=>{})
main().then(()=>app.exit(0)).catch(error=>{console.error(error.stack||error);app.exit(1)})
