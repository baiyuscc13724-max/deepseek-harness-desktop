const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const { createHash, createHmac } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { Readable } = require('node:stream')

const hostFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const clientFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'client.js')
const launchFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-session-launch.js')
const projectTaskStoreFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.ok(start >= 0, `missing start marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

async function invokeWebRoute(route,body,{header=true}={}) {
  const req=Readable.from([Buffer.from(JSON.stringify(body))]); req.method='POST'; req.url='/api/agent-teams/action'; req.headers={host:'127.0.0.1:14193',origin:'http://127.0.0.1:14193',...(header?{'x-harness-agent-teams':'1'}:{})}
  let status=0,text=''; const res={headersSent:false,writeHead(value){status=value;this.headersSent=true},end(chunk=''){text+=String(chunk)}}
  await route.handler(req,res); return {status,body:JSON.parse(text)}
}

async function registeredProjectToolsFixture(mod, label) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `agent-teams-registered-tools-${label}-`))
  const databasePath = path.join(temporary, 'tasks.sqlite')
  const projectRef = `project_registered_tools_${label}_01`
  const projectKey = Buffer.alloc(32, label.charCodeAt(0) % 255 || 1)
  const internalExecution = Object.freeze(Object.create(null))
  const root = id => ({ id, status: 'running', session: { header: { cwd: path.join(temporary, id) }, events: [{ type: 'turn/start', id: `turn-${id}`, time: 1 }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } } })
  const roots = [root('registered-root-A'), root('registered-root-B'), root('registered-root-C')]
  const agents = [...roots]
  let current = roots[0]
  const tools = new Map(), prompts = [], routes=[],listeners=new Map()
  const ctx = {
    agents: { get: id => agents.find(agent => agent.id === id), roots: () => roots, currentInitiator: () => current },
    tools: { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    systemPrompt: { section: section => { prompts.push(section); return () => {} } },
    webServer:{register:route=>{routes.push(route);return()=>{}}}, effect:operation=>operation(), logger:{warn:()=>{}}, on:(name,listener)=>{const rows=listeners.get(name)??[];rows.push(listener);listeners.set(name,rows);return()=>{}},
  }
  const projectEntry = {
    localProjectCollaborationContext: async () => {
      let disposed = false
      const context = { projectRef, databasePath }
      Object.defineProperties(context, {
        execution: { value: internalExecution },
        actorResolver: { value: (candidate, requestedProjectRef) => {
          if (disposed || candidate !== internalExecution || requestedProjectRef !== projectRef) throw Object.assign(new Error('private context mismatch'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' })
          return { projectRef, actorRef: 'private-human-actor', kind: 'human', role: 'owner' }
        } },
        keyProvider: { value: requestedProjectRef => {
          if (disposed || requestedProjectRef !== projectRef) throw new Error('private key mismatch')
          return Buffer.from(projectKey)
        } },
        dispose: { value: () => { disposed = true } },
      })
      return Object.freeze(context)
    },
  }
  const failures=new Map(),launchCalls=[],failureObserverCalls=[],adoptedFailureEvidence=new Map()
  const projectSessionLaunch={rootFailureEvidence:async(_execution,{failureRef})=>{const value=failures.get(failureRef);if(!value)throw Object.assign(new Error('missing evidence'),{code:'PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED'});return {...value,beneficiaryActorRef:value.beneficiaryActorRef??value.failedActorRef,initiatorAuthorized:true}},prepareStart:async()=>({batchRef:'batch_recovery_e2e'}),prepareAdoptions:async()=>({prepared:[{slotRef:'slot_recovery_e2e',operationRef:'operation_recovery_e2e',adoptionCapability:'capability_recovery_e2e'}]}),recoveryReservation:async()=>({slotRef:'slot_recovery_e2e',operationRef:'operation_recovery_e2e'}),activatePreparedBatch:async(_execution,input)=>{launchCalls.push(input);return {state:'ready',slots:[{slotRef:'slot_recovery_e2e',state:'ready'}]}},status:async()=>({state:'ready',slots:[{slotRef:'slot_recovery_e2e',state:'ready'}]}),slotStatus:async(_execution,{slotRef})=>({state:'ready',slots:[{slotRef,state:'ready'}]}),retryFailedSlot:async(_execution,{slotRef})=>({state:'ready',slots:[{slotRef,state:'ready'}]}),redeemAdoption:async()=>{throw new Error('unused')},recordAdoption:async()=>({recorded:true}),recordAdoptedActorFailure:async(_execution,input)=>{failureObserverCalls.push(input);const evidence=adoptedFailureEvidence.get(input.adoptedActorRef);if(evidence)failures.set(evidence.failureRef,evidence);else if(adoptedFailureEvidence.size>0)throw Object.assign(new Error('missing adopted binding'),{code:'PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED'});return {state:'failed'}}}
  mod.registerProjectCollaborationTools(ctx, projectEntry, projectSessionLaunch)
  const invoke = async (toolName, actor, args) => { current = actor; return tools.get(toolName).execute(args, { agent: actor }) }
  return { temporary, projectRef, projectKey, projectEntry, projectSessionLaunch,failures,launchCalls,failureObserverCalls,adoptedFailureEvidence,agents, roots, tools, prompts, routes, ctx, invoke, emit:async(name,payload)=>{for(const listener of listeners.get(name)??[])listener(payload);await new Promise(resolve=>setImmediate(resolve))}, cleanup: async () => { projectKey.fill(0); await rm(temporary, { recursive: true, force: true }) } }
}

test('team_task tools remain the authoritative Agent Teams mutation and listing plane', async () => {
  const source = await readFile(hostFile, 'utf8')
  const createTool = sliceBetween(source, 'name: "team_task_create"', 'name: "team_task_list"')
  const listTool = sliceBetween(source, 'name: "team_task_list"', 'name: "team_task_update"')
  const updateTool = sliceBetween(source, 'name: "team_task_update"', 'name: "team_task_checkpoint"')

  assert.match(createTool, /createTask\(store, execution\.agent/u)
  assert.match(createTool, /teamId: args\.team_id[\s\S]*title: args\.title/u)
  assert.match(listTool, /store\.read\(\(document\)/u)
  assert.match(listTool, /resolveTeamForCaller/u)
  assert.match(listTool, /deriveTaskAcrossTeams/u)
  assert.match(updateTool, /updateTask\(store, execution\.agent/u)
  assert.match(updateTool, /claimId: args\.claim_id[\s\S]*leaseEpoch: args\.lease_epoch/u)
  assert.match(updateTool, /Submission remains non-authoritative until the fixed root accepts it/u)
})

test('the sole routed project collaboration workspace is a read projection while lower-level tools remain separate', async () => {
  const [host, client] = await Promise.all([readFile(hostFile, 'utf8'), readFile(clientFile, 'utf8')])
  const pageRoute = sliceBetween(host, 'path: "/api/agent-teams/project/team-board/page"', 'path: "/api/agent-teams/task-detail"')
  const collaboration = sliceBetween(client, 'function ProjectCollaborationWorkspace(props)', 'function LegacyProjectTeamBoardWorkspace(props)')

  assert.match(pageRoute, /req\.method !== "GET"/u)
  assert.doesNotMatch(pageRoute, /createTask\(|updateTask\(|taskDelegate\.action/u)
  assert.match(collaboration, /useProjectTasksState\(props\.projectScope\)/u)
  assert.match(collaboration, /projectCollaboration/u)
  assert.doesNotMatch(collaboration, /fetch\(|method: "POST"|postAction\(|postProjectTaskAction|inputActions\.(?:submit|send)|createTask\(|updateTask\(/u)
  assert.match(client, /workspaceContent = h\(ProjectCollaborationWorkspace,/u)
  assert.doesNotMatch(client, /workspaceContent = h\(LegacyProjectTeamBoardWorkspace,|h\(LegacyProjectTeamBoardWorkspace,/u)

  // Lower-level browser APIs and model-facing collaboration tools are separate data
  // planes, not a second routed navigation workspace.
  assert.match(host, /registerProjectTaskApi\(ctx, projectTaskRuntimeForSession, projectBusiness\)/u)
  assert.match(host, /name: "project_collaboration"/u)
  assert.match(host, /name: "project_task"/u)
  assert.match(host, /"claim_next"/u)
  assert.match(host, /"read_requests"[\s\S]*"create_request"[\s\S]*"respond_request"[\s\S]*"cancel_request"[\s\S]*"audit_resolve_request"/u)
  assert.match(host, /candidate === execution && hasDirectHumanRootAuthority\(ctx, execution\)/u)
  assert.doesNotMatch(host, /authorizedEarly:\s*(?:args|input|payload)/u)
})

test('real top-level project sessions use a separate confirmed Host launch plane', async () => {
  const [host, launch] = await Promise.all([readFile(hostFile, 'utf8'), readFile(launchFile, 'utf8')])
  const tool = sliceBetween(host, 'name: "project_session_launch"', 'function registerTools(')

  assert.match(tool, /total_sessions[\s\S]*including the current root/u)
  assert.match(tool, /requireDirectHumanRoot\(ctx, execution\)/u)
  assert.match(tool, /"resolve_unknown"[\s\S]*decision:[\s\S]*"delivered"[\s\S]*"not_delivered"[\s\S]*expected_revision/u)
  assert.match(tool, /request_id[\s\S]*required for start and resolve_unknown/u)
  assert.match(tool, /args\.action === "resolve_unknown"[\s\S]*requireDirectHumanRoot\(ctx, execution\)[\s\S]*runtime\.resolveUnknownSlot/u)
  assert.match(tool, /args\.action === "resolve_unknown" \? "Reconcile" : "Inspect"/u)
  assert.match(tool, /canonicalProjectKey: projectKeyForRoot\(execution\.agent\)[\s\S]*workspacePath: projectScopeForRoot\(execution\.agent\)[\s\S]*callerRootId: execution\.agent\.id/u)
  assert.match(host, /resolveProjectSessionLaunchProvider\(ctx\)/u)
  assert.match(host, /observeUserStops\(ctx, store, ready, admission, projectSessionLaunch, officialCorePorts\)/u)
  assert.match(host, /ctx\.on\("agent\/error"[\s\S]*ctx\.agents\.get\(agent\.id\)!==agent[\s\S]*recordAdoptedActorFailure/u)
  assert.match(host, /observeProjectRootFailures\(ctx,projectEntryRegistry,projectSessionLaunch,ready\)/u)
  assert.doesNotMatch(host, /observeProjectRootFailures\(ctx,projectEntry,projectSessionLaunch,ready\)/u)
  assert.match(tool, /ensureProjectLaunchBoard\(projectEntry, exec\)[\s\S]*runtime\.prepareStart\(exec,[\s\S]*runtime\.prepareAdoptions\(exec,[\s\S]*reserveProjectLaunchSlots\(projectEntry, exec,[\s\S]*runtime\.activatePreparedBatch\(exec/u)
  assert.match(host, /collaboration\.reserveRootSeat\(execution/u)
  assert.match(launch, /reserveAdoption\(execution, \{ canonicalProjectKey:[\s\S]*batchRef: batch\.batchRef, slotRef: slot\.slotRef, operationRef: slot\.operationRef/u)
  assert.match(host, /args\.action === "adopt_slot"[\s\S]*new Set\(\["slot_ref"\]\)[\s\S]*redeemAdoption\(execution[\s\S]*collaboration\.adoptRootSeat\(execution/u)
  assert.match(host, /args\.action==="recover_root"[\s\S]*requireDirectHumanRoot\(ctx,execution\)[\s\S]*rootFailureEvidence[\s\S]*prepareRootRecovery[\s\S]*reservePreparedProjectRootRecovery[\s\S]*continueProjectRootRecovery/u)
  assert.match(host, /new ProjectCollaborationService\(\{ store, actorResolver, earlyResolutionAuthorizer, rootFailureResolver \}\)/u)
  assert.match(launch, /createHmac\("sha256", callerSalt\)[\s\S]*agent-teams-caller-root-v1/u)
  assert.doesNotMatch(host, /deriveCapability\("session-launch"|slot_actor_ref/u)
  assert.doesNotMatch(tool, /name: "team_spawn"|startContinuable\(|ctx\.subagents\./u)
})

test('registered Host agent/error observer routes exact roots through two canonical project lanes', async () => {
  const mod=await import(`${pathToFileURL(hostFile).href}?root-error-observer=${Date.now()}`),fx=await registeredProjectToolsFixture(mod,'root-error-observer')
  const lanes=new Map()
  try {
    const normalize=value=>{const normalized=value.trim().replace(/\\/gu,'/').replace(/\/+$/u,'').normalize('NFKC');return process.platform==='win32'?normalized.toLocaleLowerCase('en-US'):normalized},canonical=value=>createHash('sha256').update(JSON.stringify(['agent-teams-project-v1',normalize(value)])).digest('hex')
    const selectedKeys=[];for(const [index,root] of fx.roots.slice(0,2).entries()){const cwd=path.join(fx.temporary,`Project-${index}`),canonicalProjectKey=canonical(cwd),projectRef=`project_observer_lane_${index}`,key=Buffer.alloc(32,index+11);root.session.header.cwd=cwd;lanes.set(canonicalProjectKey,{projectRef,key,databasePath:path.join(fx.temporary,`observer-${index}.sqlite`),root})}
    const registry={requiresCanonicalProjectKey:true,localProjectCollaborationContext:async({canonicalProjectKey})=>{selectedKeys.push(canonicalProjectKey);const lane=lanes.get(canonicalProjectKey);assert.ok(lane,'canonical lane missing');const internal=Object.freeze({}),context={projectRef:lane.projectRef,databasePath:lane.databasePath};Object.defineProperties(context,{execution:{value:internal},actorResolver:{value:(candidate,requested)=>{assert.equal(candidate,internal);assert.equal(requested,lane.projectRef);return {projectRef:requested}}},keyProvider:{value:requested=>{assert.equal(requested,lane.projectRef);return Buffer.from(lane.key)}},dispose:{value:()=>{}}});return Object.freeze(context)}}
    mod.observeProjectRootFailures(fx.ctx,registry,fx.projectSessionLaunch,Promise.resolve())
    const member={id:'member-not-root',status:'running',session:{header:{cwd:fx.temporary},events:[]}};fx.agents.push(member);await fx.emit('agent/error',{agent:member,error:new Error('private member failure')});await fx.emit('agent/error',{agent:{...fx.roots[0]},error:new Error('forged clone')});assert.equal(fx.failureObserverCalls.length,0)
    for(const root of fx.roots.slice(0,2)){await fx.emit('agent/error',{agent:root,error:new Error('private root failure')});for(let i=0;i<20&&fx.failureObserverCalls.length<selectedKeys.length;i+=1)await new Promise(resolve=>setImmediate(resolve))}
    assert.equal(fx.failureObserverCalls.length,2);assert.deepEqual(selectedKeys,[...lanes.keys()])
    for(const [index,lane] of [...lanes.values()].entries()){const call=fx.failureObserverCalls[index],expected=`actor_${createHmac('sha256',lane.key).update('dsh-agent-teams/project-root-actor/v1').update('\0').update(lane.projectRef).update('\0').update(JSON.stringify([lane.root.id])).digest('base64url')}`;assert.equal(call.adoptedActorRef,expected);assert.equal(call.projectBinding.canonicalProjectKey,[...lanes.keys()][index]);assert.equal(call.projectBinding.callerRootId,lane.root.id);assert.equal('error' in call,false);assert.equal('slotRef' in call,false)}
  } finally {for(const lane of lanes?.values?.()??[])lane.key.fill(0);await fx.cleanup()}
})

test('project collaboration tools bind the invoking execution through public core services', async () => {
  const host = await readFile(hostFile, 'utf8')
  const plane = sliceBetween(host, 'function registerProjectCollaborationTools', 'function projectSessionLaunchFailure')

  assert.match(plane, /name: "project_collaboration"/u)
  assert.match(plane, /name: "project_task"/u)
  assert.match(plane, /const execution = requireProjectRootCaller\(ctx, exec\)/u)
  assert.match(plane, /withProjectCollaborationContext\(projectEntry, execution/u)
  assert.match(host, /context\.actorResolver\(context\.execution, context\.projectRef\)/u)
  assert.match(host, /const deriveProjectHmac = \(domain, \.\.\.parts\) => \{[\s\S]*createHmac\("sha256", key\)/u)
  assert.match(host, /const actorRefForSessionId = \(sessionId\) => `actor_\$\{deriveProjectHmac\("dsh-agent-teams\/project-root-actor\/v1", sessionId\)\}`/u)
  assert.match(host, /const actorRef = actorRefForSessionId\(execution\.agent\.id\)/u)
  assert.match(host, /key\?\.fill\(0\)/u)
  assert.match(host, /candidate !== execution/u)
  assert.match(host, /new ProjectCollaborationService/u)
  assert.match(host, /new ProjectTaskCommandService/u)
  assert.match(host, /activateReservedRootRecovery[\s\S]*recoveryReservation[\s\S]*current\.replacementSlotActorRef[\s\S]*current\.replacementTaskRef/u)
  assert.match(host, /continueProjectRootRecovery[\s\S]*current\.mode==="takeover"&&current\.state==="reserved"[\s\S]*activateReservedRootRecovery/u)
  assert.match(plane, /continue_root_recovery[\s\S]*continueProjectRootRecovery/u)
  assert.match(plane, /collaboration\.upsertSeat\(execution,[\s\S]*kind: "root"/u)
  assert.match(plane, /tasks\.executeCommand\(execution/u)
  assert.equal((plane.match(/requireProjectRootCaller\(ctx, exec\)/gu) || []).length, 2)
  assert.match(plane, /projectCollaborationModelResult\(value\)/u)
  assert.match(plane, /projectTaskModelResult\(value\)/u)
  assert.doesNotMatch(plane, /publicResult\(await withProjectCollaborationContext|binding\.context\.execution|sessionId|workspaceId|projectRef: args/u)
})

test('bind_legacy is a distinct exact direct-human root action and cannot be smuggled through initialize', async () => {
  const mod = await import(`${pathToFileURL(hostFile).href}?bind-legacy=${Date.now()}`)
  const fixture = await registeredProjectToolsFixture(mod, 'bind-legacy')
  let localCalls = 0, bindCalls = 0
  const local = fixture.projectEntry.localProjectCollaborationContext
  fixture.projectEntry.requiresCanonicalProjectKey = true
  fixture.projectEntry.localProjectCollaborationContext = async options => { assert.match(options.canonicalProjectKey, /^[a-f0-9]{64}$/u); localCalls += 1; return local() }
  fixture.projectEntry.bindLegacyProjectCollaborationContext = async options => { assert.match(options.canonicalProjectKey, /^[a-f0-9]{64}$/u); bindCalls += 1; return local() }
  const automatedRoot = { id: 'registered-automated-root', status: 'running', session: { header: { cwd: path.join(fixture.temporary, 'automated') }, events: [{ type: 'turn/start', id: 'turn-automated', time: 2 }], snapshotEvents() { return this.events.slice() } } }
  const teamMember = { id: 'registered-team-member', status: 'running', session: { header: { cwd: path.join(fixture.temporary, 'member') }, events: [{ type: 'turn/start', id: 'turn-member', time: 2 }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } } }
  fixture.roots.push(automatedRoot)
  fixture.agents.push(automatedRoot, teamMember)
  try {
    const smuggled = await fixture.invoke('project_collaboration', fixture.roots[0], { action: 'initialize', payload: { title: 'must reject boolean', bind_legacy: true } })
    assert.equal(smuggled.ok, false)
    assert.equal(smuggled.error.code, 'PROJECT_COLLABORATION_INVALID')
    assert.equal(bindCalls, 0, 'ordinary initialize must never select the legacy binding path')
    assert.equal(localCalls, 1)

    const bound = await fixture.invoke('project_collaboration', fixture.roots[0], { action: 'bind_legacy', payload: { title: 'Explicit legacy board' } })
    assert.equal(bound.ok, true)
    assert.equal(bindCalls, 1)

    const automated = await fixture.invoke('project_collaboration', automatedRoot, { action: 'bind_legacy', payload: { title: 'forbidden' } })
    assert.equal(automated.ok, false)
    assert.equal(automated.error.code, 'PROJECT_COLLABORATION_FORBIDDEN')
    const member = await fixture.invoke('project_collaboration', teamMember, { action: 'bind_legacy', payload: { title: 'forbidden' } })
    assert.equal(member.ok, false)
    assert.equal(member.error.code, 'PROJECT_COLLABORATION_ROOT_REQUIRED')
    assert.equal(bindCalls, 1, 'forbidden callers must be rejected before opening the legacy lane')
  } finally { await fixture.cleanup() }
})

test('project-board representative gate fails closed for Agent Team members', async () => {
  const mod = await import(`${pathToFileURL(hostFile).href}?root-gate=${Date.now()}`)
  const member = { id: 'member-session', status: 'running', session: { events: [{ type: 'turn/start', id: 'turn-1', time: 1 }], snapshotEvents() { return this.events.slice() } } }
  const ctx = { agents: { get: id => id === member.id ? member : undefined, currentInitiator: () => member, roots: () => [] } }
  assert.throws(() => mod.requireProjectRootCaller(ctx, { agent: member }), error => error.code === 'PROJECT_COLLABORATION_ROOT_REQUIRED')
})

test('execution-bound project actors are unique per root and coordinator authority never crosses roots', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-project-root-tools-'))
  const databasePath = path.join(temporary, 'tasks.sqlite')
  const mod = await import(`${pathToFileURL(hostFile).href}?root-actors=${Date.now()}`)
  const internalExecution = Object.freeze(Object.create(null))
  const projectRef = 'project_safe_root_tools_fixture_01'
  const projectKey = Buffer.alloc(32, 19)
  const projectEntry = {
    localProjectCollaborationContext: async () => {
      let disposed = false
      const context = { projectRef, databasePath }
      Object.defineProperties(context, {
        execution: { value: internalExecution },
        actorResolver: { value: (candidate, requestedProjectRef) => {
          if (disposed || candidate !== internalExecution || requestedProjectRef !== projectRef) throw Object.assign(new Error('private context mismatch'), { code: 'PROJECT_ENTRY_TASK_CONTEXT_INVALID' })
          return { projectRef, actorRef: 'private-human-actor', kind: 'human', role: 'owner' }
        } },
        keyProvider: { value: requestedProjectRef => {
          if (disposed || requestedProjectRef !== projectRef) throw new Error('private key mismatch')
          return Buffer.from(projectKey)
        } },
        dispose: { value: () => { disposed = true } },
      })
      return Object.freeze(context)
    },
  }
  const rootA = Object.freeze({ agent: Object.freeze({ id: 'root-A' }) })
  const rootB = Object.freeze({ agent: Object.freeze({ id: 'root-B' }) })
  const rootC = Object.freeze({ agent: Object.freeze({ id: 'root-C' }) })
  const invoke = (execution, operation) => mod.withProjectCollaborationContext(projectEntry, execution, operation)
  const command = (tasks, execution, taskRef, suffix, type, expectedRevision, payload = {}) => tasks.executeCommand(execution, {
    projectRef, taskRef, commandId: `command_${suffix}`, eventRef: `event_${suffix}`, type, expectedRevision, payload,
  })
  try {
    await mod.ensureProjectLaunchBoard(projectEntry, rootA)
    const reservation = await mod.reserveProjectLaunchSlots(projectEntry, rootA, { request_id: 'launch-reserve-safe', slots: [{ title: 'Reserved root', role: 'Reserved duty', resources: ['src/reserved'], task: 'Reserved initial task' }], prepared: [{ slotRef: 'slot_launch_reserve_safe', operationRef: 'operation_launch_reserve_safe', adoptionCapability: 'adoption_launch_reserve_safe' }] })
    assert.equal(reservation.complete, true)
    assert.equal(reservation.slots[0].state, 'reserved')
    assert.doesNotMatch(JSON.stringify(reservation), /cap_/u)
    const initialized = await invoke(rootA, ({ collaboration }) => collaboration.snapshot(rootA, { projectRef }))
    assert.equal(initialized.available, true)
    assert.equal(initialized.collaboration.title, 'Project collaboration')
    assert.equal(initialized.collaboration.seats.some(seat => seat.actorRef === reservation.reservations[0].slotActorRef && seat.state === 'reserved'), true)
    const initializedTask = initialized.tasks.find(task => task.taskRef === reservation.reservations[0].taskRef)
    assert.deepEqual({ status: initializedTask.status, title: initializedTask.title, requirements: initializedTask.requirements, fileScope: initializedTask.fileScope }, { status: 'todo', title: 'Reserved duty', requirements: 'Reserved initial task', fileScope: ['src/reserved'] })
    const replay = await mod.reserveProjectLaunchSlots(projectEntry, rootA, { request_id: 'launch-reserve-safe', slots: [{ title: 'Reserved root', role: 'Reserved duty', resources: ['src/reserved'], task: 'Reserved initial task' }], prepared: [{ slotRef: 'slot_launch_reserve_safe', operationRef: 'operation_launch_reserve_safe', adoptionCapability: 'adoption_launch_reserve_safe' }] })
    assert.equal(replay.slots[0].duplicate, true)
    const redemptionRecord = { projectRef, slotActorRef: reservation.reservations[0].slotActorRef, slotCapability: 'adoption_launch_reserve_safe' }
    let redemptionCalls = 0
    const adoptionRuntime = { redeemAdoption: async () => (++redemptionCalls === 1 ? redemptionRecord : { projectRef, slotActorRef: reservation.reservations[0].slotActorRef, slotCapability: 'adoption_launch_reserve_safe' }), recordAdoption: async () => ({ recorded: true }) }
    const adopted = await invoke(rootC, ({ projectRef: currentProjectRef, collaboration }) => mod.adoptProjectLaunchSlot(adoptionRuntime, rootC, {}, currentProjectRef, collaboration, 'slot_launch_reserve_safe'))
    assert.equal(redemptionRecord.slotCapability, undefined)
    assert.equal(adopted.task.taskRef, reservation.reservations[0].taskRef)
    const adoptedSnapshot = await invoke(rootC, ({ collaboration }) => collaboration.snapshot(rootC, { projectRef }))
    const adoptedSeat = adoptedSnapshot.collaboration.seats.find(seat => seat.duty === 'Reserved duty')
    assert.ok(adoptedSeat?.actorRef && adoptedSeat.actorRef !== reservation.reservations[0].slotActorRef)
    const adoptedTask = adoptedSnapshot.tasks.find(task => task.taskRef === reservation.reservations[0].taskRef)
    assert.equal(adoptedTask.ownerActorRef, adoptedSeat.actorRef)
    assert.deepEqual({ title: adoptedTask.title, requirements: adoptedTask.requirements, fileScope: adoptedTask.fileScope, createdAt: adoptedTask.createdAt }, { title: initializedTask.title, requirements: initializedTask.requirements, fileScope: initializedTask.fileScope, createdAt: initializedTask.createdAt })
    const adoptionReplay=await invoke(rootC,({projectRef:currentProjectRef,collaboration})=>mod.adoptProjectLaunchSlot(adoptionRuntime,rootC,{},currentProjectRef,collaboration,'slot_launch_reserve_safe'))
    assert.equal(adoptionReplay.duplicate,true); assert.equal(adoptionReplay.seat.actorRef,adopted.seat.actorRef); assert.equal(redemptionCalls,2)
    const boardA = await invoke(rootA, ({ collaboration }) => collaboration.upsertSeat(rootA, { projectRef, expectedRevision: 0, kind: 'root', state: 'active', duty: 'Lead', resourceScope: ['src/a'], phase: 'work', nextStep: 'continue' }))
    const boardB = await invoke(rootB, ({ collaboration }) => collaboration.upsertSeat(rootB, { projectRef, expectedRevision: 0, kind: 'root', state: 'active', duty: 'Participant', resourceScope: ['src/b'], phase: 'work', nextStep: 'continue' }))
    const seatA = boardA.seats.find(seat => seat.duty === 'Lead')
    const seatB = boardB.seats.find(seat => seat.duty === 'Participant')
    assert.ok(seatA?.actorRef && seatB?.actorRef)
    assert.notEqual(seatA.actorRef, seatB.actorRef)
    const participant = await invoke(rootB, ({ collaboration }) => collaboration.snapshot(rootB, { projectRef }))
    assert.equal(participant.permissions.canCreate, false)
    await assert.rejects(() => invoke(rootB, ({ tasks }) => command(tasks, rootB, 'task_forbidden', 'forbidden', 'create', 0, { title: 'forbidden' })), error => error.code === 'PROJECT_TASK_FORBIDDEN')
    const conflictingTaskRef = await invoke(rootA, ({ deriveOpaque }) => deriveOpaque('task', 'session-launch', 'launch-partial-safe', 1))
    await invoke(rootA, ({ tasks }) => command(tasks, rootA, conflictingTaskRef, 'preexisting', 'create', 0, { title: 'preexisting' }))
    const partial = await mod.reserveProjectLaunchSlots(projectEntry, rootA, { request_id: 'launch-partial-safe', slots: [{ title: 'Partial A', role: 'Duty A', resources: ['src/partial-a'], task: 'Task A' }, { title: 'Partial B', role: 'Duty B', resources: ['src/partial-b'], task: 'Task B' }], prepared: [{ slotRef: 'slot_launch_partial_a', operationRef: 'operation_launch_partial_a', adoptionCapability: 'adoption_launch_partial_a' }, { slotRef: 'slot_launch_partial_b', operationRef: 'operation_launch_partial_b', adoptionCapability: 'adoption_launch_partial_b' }] })
    assert.equal(partial.complete, false)
    assert.deepEqual(partial.slots.map(slot => slot.state), ['reserved', 'reservation_failed'])
    assert.equal(partial.slots[1].errorCode, 'PROJECT_COLLABORATION_CONFLICT')

    let receipt = await invoke(rootA, ({ tasks }) => command(tasks, rootA, 'task_safe', 'create', 'create', 0, { title: 'work' }))
    receipt = await invoke(rootB, ({ tasks }) => command(tasks, rootB, 'task_safe', 'claim', 'claim', receipt.task.revision))
    receipt = await invoke(rootB, ({ tasks }) => command(tasks, rootB, 'task_safe', 'start', 'attempt.start', receipt.task.revision, { attemptRef: 'attempt_safe' }))
    receipt = await invoke(rootB, ({ tasks }) => command(tasks, rootB, 'task_safe', 'submit', 'attempt.submit', receipt.task.revision, { attemptRef: 'attempt_safe' }))
    receipt = await invoke(rootB, ({ tasks }) => command(tasks, rootB, 'task_safe', 'review-state', 'transition', receipt.task.revision, { to: 'in_review', attemptRef: 'attempt_safe' }))
    await assert.rejects(() => invoke(rootB, ({ tasks }) => command(tasks, rootB, 'task_safe', 'self-review', 'review', receipt.task.revision, { reviewRef: 'review_self', attemptRef: 'attempt_safe', verdict: 'approved', body: 'approve' })), error => error.code === 'PROJECT_TASK_SELF_APPROVAL')
  } finally {
    projectKey.fill(0)
    await rm(temporary, { recursive: true, force: true })
  }
})

test('project collaboration model projections exclude raw core sentinels and identity-bearing fields', async () => {
  const mod = await import(`${pathToFileURL(hostFile).href}?projection=${Date.now()}`)
  const sentinel = 'RAW_PRIVATE_SENTINEL'
  const output = mod.projectCollaborationModelResult({
    available: true,
    projectRevision: 9,
    collaboration: {
      projectRef: `${sentinel}_project`, revision: 3, projectRevision: 9, status: 'active', coordinatorActorRef: `${sentinel}_actor`, title: `${sentinel}_title`,
      seats: [{ actorRef: 'actor_opaque', kind: 'root', state: 'active', revision: 1, duty: sentinel, resourceScope: [`private/${sentinel}`], phase: sentinel, nextStep: sentinel }],
      locks: [{ resourceRef: `private/${sentinel}`, ownerActorRef: `${sentinel}_owner`, taskRef: 'task_opaque', state: 'active', revision: 1 }],
      handoffs: [{ handoffRef: 'handoff_opaque', taskRef: 'task_opaque', sourceActorRef: 'actor_opaque', targetActorRef: 'actor_other', state: 'prepared', revision: 1, summary: sentinel }],
      evidence: [{ evidenceRef: 'evidence_opaque', taskRef: 'task_opaque', actorRef: 'actor_opaque', path: `private/${sentinel}`, digest: `sha256:${'a'.repeat(64)}`, summary: sentinel }],
      history: [{ revision: 3, kind: 'seat.updated', actorRef: `${sentinel}_actor`, subjectRef: `${sentinel}_subject`, summary: sentinel }],
      totals: { seats: 1, locks: 1, handoffs: 1, evidence: 1, history: 1 }, page: { includedHistory: 1, hasMoreHistory: false },
    },
    tasks: [{ taskRef: 'task_opaque', status: 'todo', revision: 1, requirementsRevision: 1, ownerActorRef: `${sentinel}_owner`, assigneeActorRef: `${sentinel}_assignee`, title: 'Shared task contract', requirements: { acceptance: 'Bounded shared requirement' }, fileScope: [`private/${sentinel}`] }],
    totals: { tasks: 1, unclaimed: 0, claimed: 1 }, taskPage: { hasMore: false, nextBoundary: { taskRef: sentinel, updatedAt: 1 } }, permissions: { canCreate: true },
  })
  const receipt = mod.projectTaskModelResult({ duplicate: false, projectRevision: 10, commandId: sentinel, eventRef: sentinel, actorRef: sentinel, task: { taskRef: 'task_opaque', status: 'todo', revision: 2, requirementsRevision: 1, ownerActorRef: sentinel, assigneeActorRef: sentinel, title: 'Shared receipt task', requirements: { acceptance: 'Shared receipt requirement' }, fileScope: [sentinel] } })
  const requestOutput = mod.projectRequestModelResult({ projectRevision: 11, totals: { total: 1, open: 1, unknown: 99 }, requests: [{ requestRef: 'request_opaque', taskRef: 'task_opaque', dependencyTaskRef: 'task_dependency_opaque', requesterActorRef: sentinel, targetActorRef: sentinel, kind: 'dependency_unblock', state: 'open', revision: 1, reason: 'bounded reason', respondByAt: 99 }], hasMore: true, nextBoundary: { updatedAt: 88, requestRef: 'request_boundary_opaque', actorRef: sentinel } })
  const encoded = JSON.stringify({ output, receipt, requestOutput })
  assert.doesNotMatch(encoded, new RegExp(sentinel, 'u'))
  const keys = []
  const collectKeys = value => {
    if (Array.isArray(value)) return value.forEach(collectKeys)
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) { keys.push(key); collectKeys(child) }
  }
  collectKeys({ output, receipt, requestOutput })
  for (const forbidden of ['projectRef', 'actorRef', 'sessionId', 'workspaceId', 'resourceRef', 'path', 'digest', 'summary', 'nextStep', 'credentials', 'fileScope']) assert.equal(keys.includes(forbidden), false, `forbidden model key ${forbidden}`)
  assert.equal(output.projectRevision, 9)
  assert.equal(output.tasks[0].title, 'Shared task contract')
  assert.deepEqual(output.tasks[0].requirements, { acceptance: 'Bounded shared requirement' })
  assert.ok(Buffer.byteLength(JSON.stringify(output), 'utf8') <= 128 * 1024)
  assert.equal(output.totals.tasks, 1)
  assert.equal(output.tasks[0].taskRef, 'task_opaque')
  assert.equal(output.board.seats[0].seatRef, 'actor_opaque')
  assert.deepEqual(requestOutput.totals, { total: 1, open: 1 })
  assert.equal(requestOutput.requests[0].requestRef, 'request_opaque')
  assert.equal(requestOutput.requests[0].reason, 'bounded reason')
  assert.deepEqual({ mine: requestOutput.requests[0].mine, targetedToMe: requestOutput.requests[0].targetedToMe, escalationEligible: requestOutput.requests[0].escalationEligible }, { mine: false, targetedToMe: false, escalationEligible: false })
  assert.deepEqual(requestOutput.nextBoundary, { updatedAt: 88, requestRef: 'request_boundary_opaque' })
  assert.equal(requestOutput.hasMore, true)
  const bounded = mod.projectCollaborationModelResult({ available: true, tasks: Array.from({ length: 120 }, (_, index) => ({ taskRef: `task_${String(index).padStart(20, '0')}`, status: 'todo', revision: 1, requirementsRevision: 1, title: '界'.repeat(2_000), requirements: { body: '界'.repeat(10_000) } })), totals: { tasks: 120 }, taskPage: { hasMore: false } })
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= 128 * 1024)
  assert.equal(bounded.taskPage.hasMore, true)
  assert.ok(bounded.tasks.every(task => [...task.title].length <= 500 && Buffer.byteLength(task.title, 'utf8') <= 2 * 1024 && Buffer.byteLength(JSON.stringify(task.requirements), 'utf8') <= 8 * 1024))
})

test('prepared takeover recovery advances from an exact Web projection capability through POST to ready', async () => {
  const mod=await import(`${pathToFileURL(hostFile).href}?recovery-route=${Date.now()}`),fx=await registeredProjectToolsFixture(mod,'recovery-route')
  const derive=(domain,...parts)=>createHmac('sha256',fx.projectKey).update(domain).update('\0').update(fx.projectRef).update('\0').update(JSON.stringify(parts)).digest('base64url')
  let projectTaskRuntimeForSession,ProjectTaskStore,originalReserve
  try {
    const [lead,target,requester]=fx.roots
    assert.equal((await fx.invoke('project_collaboration',lead,{action:'initialize',payload:{title:'Recovery'}})).ok,true)
    for(const [root,duty] of [[lead,'Lead'],[target,'Failed'],[requester,'Requester']]) assert.equal((await fx.invoke('project_collaboration',root,{action:'update_own_seat',payload:{expected_revision:0,state:'active',duty,resource_scope:['src/recovery'],phase:'work',next_step:'continue'}})).ok,true)
    const blocked=await fx.invoke('project_task',lead,{action:'create',request_id:'blocked',payload:{title:'Blocked'}})
    const claimedBlocked=await fx.invoke('project_task',requester,{action:'claim',request_id:'claim-blocked',task_ref:blocked.task.taskRef,expected_revision:blocked.task.revision,payload:{}})
    const blockedState=await fx.invoke('project_task',requester,{action:'transition',request_id:'block-owned',task_ref:blocked.task.taskRef,expected_revision:claimedBlocked.task.revision,payload:{to:'blocked',blockReason:'waiting for dependency'}})
    const dependency=await fx.invoke('project_task',lead,{action:'create',request_id:'dependency',payload:{title:'Dependency'}})
    await fx.invoke('project_task',target,{action:'claim',request_id:'claim-dependency',task_ref:dependency.task.taskRef,expected_revision:dependency.task.revision,payload:{}})
    await fx.invoke('project_task',lead,{action:'add_dependency',request_id:'relation',task_ref:blocked.task.taskRef,expected_revision:blockedState.task.revision,payload:{blockerTaskRef:dependency.task.taskRef}})
    const opened=await fx.invoke('project_collaboration',requester,{action:'create_request',request_id:'takeover',payload:{kind:'takeover',task_ref:blocked.task.taskRef,dependency_task_ref:dependency.task.taskRef,reason:'failed root',respond_by_at:Date.now()+60000}})
    const row=(await fx.invoke('project_collaboration',target,{action:'read_requests',payload:{limit:20}})).requests.find(value=>value.requestRef===opened.requests[0].requestRef)
    const released=await fx.invoke('project_collaboration',target,{action:'respond_request',payload:{request_ref:row.requestRef,expected_revision:row.revision,response:'release',resolution:'owner release'}})
    assert.equal(released.requests[0].state,'resolved')
    fx.failures.set('failure-route',{failedActorRef:`actor_${derive('dsh-agent-teams/project-root-actor/v1',target.id)}`,taskRef:dependency.task.taskRef,operationRef:'operation_failed',batchRef:'batch_failed',failureCode:'HOST_SESSION_FAILED',failureEvidence:'durable Host failure',role:'Failed',resources:['src/recovery'],task:'Continue dependency'})
    ;({ProjectTaskStore}=await import(pathToFileURL(projectTaskStoreFile).href)); originalReserve=ProjectTaskStore.prototype.reserveRootRecovery
    let interrupted=false
    ProjectTaskStore.prototype.reserveRootRecovery=function(input){ if(!interrupted){interrupted=true;throw Object.assign(new Error('simulated restart between prepare and reserve'),{code:'SIMULATED_RESTART'})} return originalReserve.call(this,input) }
    let preparedResult
    try { preparedResult=await fx.invoke('project_collaboration',lead,{action:'recover_root',request_id:'recover-route',payload:{failure_ref:'failure-route',mode:'takeover',collaboration_request_ref:row.requestRef}}) }
    finally { ProjectTaskStore.prototype.reserveRootRecovery=originalReserve; originalReserve=undefined }
    assert.equal(interrupted,true); assert.equal(preparedResult.ok,false)
    const teamDocument={version:6,settings:{enabled:true,maxMembers:4,maxActiveTurns:4},teams:[]},teamStore={read:async operation=>operation(teamDocument),subscribe:()=>()=>{},snapshot:()=>teamDocument}
    projectTaskRuntimeForSession=mod.createProjectTaskSessionRuntimeResolver(fx.ctx,fx.projectEntry)
    mod.registerWebApi(fx.ctx,teamStore,Promise.resolve(),undefined,fx.projectEntry,fx.projectSessionLaunch,projectTaskRuntimeForSession)
    const route=fx.routes.find(value=>value.path==='/api/agent-teams/action')
    const projected=(await projectTaskRuntimeForSession(lead.id).state()).projectCollaboration.sections.recoveries.find(item=>item.state==='prepared'&&item.mode==='takeover')
    assert.equal(projected.canRequestTakeover,true); assert.match(projected.recoveryCapability,/^prc1\./u)
    const body={action:'root-recovery-continue',sessionId:lead.id,recoveryCapability:projected.recoveryCapability,recoveryAction:'takeover',expectedRevision:projected.revision,confirm:true}
    assert.equal((await invokeWebRoute(route,{...body,recoveryAction:'retry'})).status,403)
    const resumed=await invokeWebRoute(route,body); assert.equal(resumed.status,200,JSON.stringify(resumed.body)); assert.equal(fx.launchCalls.length,1)
    const ready=(await projectTaskRuntimeForSession(lead.id).state()).projectCollaboration.sections.recoveries.find(item=>item.recoveryRef===projected.recoveryRef)
    assert.equal(ready.state,'ready')
    const stale=await invokeWebRoute(route,body); assert.equal(stale.status,409); assert.equal(stale.body.code??stale.body.error?.code,'PROJECT_ROOT_RECOVERY_CONFLICT')
    const missing=await fx.invoke('project_collaboration',lead,{action:'recover_root',request_id:'missing',payload:{failure_ref:'missing',mode:'takeover',collaboration_request_ref:row.requestRef}})
    assert.equal(missing.ok,false)
  } finally {
    if(originalReserve!==undefined) ProjectTaskStore.prototype.reserveRootRecovery=originalReserve
    await projectTaskRuntimeForSession?.close?.()
    await fx.cleanup()
  }
})

test('retry recovery is initiated by the exact original launch owner rather than the unborn child slot', async () => {
  const mod=await import(`${pathToFileURL(hostFile).href}?recovery-retry-owner=${Date.now()}`),fx=await registeredProjectToolsFixture(mod,'recovery-retry-owner')
  try { const [lead]=fx.roots; assert.equal((await fx.invoke('project_collaboration',lead,{action:'initialize',payload:{title:'Retry owner'}})).ok,true); assert.equal((await fx.invoke('project_collaboration',lead,{action:'update_own_seat',payload:{expected_revision:0,state:'active',duty:'Launch owner',resource_scope:['src/retry'],phase:'work',next_step:'retry'}})).ok,true); const reserved=await mod.reserveProjectLaunchSlots(fx.projectEntry,Object.freeze({agent:lead}),{request_id:'retry-owner-slot',slots:[{title:'Retry child',role:'Child',resources:['src/retry'],task:'Retry child'}],prepared:[{slotRef:'retry-owner-failure',operationRef:'retry-operation',adoptionCapability:'retry-owner-capability'}]}); fx.failures.set('retry-owner-failure',{failedActorRef:reserved.reservations[0].slotActorRef,taskRef:reserved.reservations[0].taskRef,operationRef:'retry-operation',batchRef:'retry-batch',failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host operation definitively failed',role:'Child',resources:['src/retry'],task:'Retry child'}); const result=await fx.invoke('project_collaboration',lead,{action:'recover_root',request_id:'retry-owner-request',payload:{failure_ref:'retry-owner-failure',mode:'retry'}}); assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(result.recoveries[0].state,'ready') } finally { await fx.cleanup() }
})

test('registered authenticated Web route enforces confirmation, header, exact root, OCC, and continues recovery', async () => {
  const mod=await import(`${pathToFileURL(hostFile).href}?recovery-web=${Date.now()}`),fx=await registeredProjectToolsFixture(mod,'recovery-web')
  let projectTaskRuntimeForSession
  try {
    const [lead,foreign]=fx.roots
    await fx.invoke('project_collaboration',lead,{action:'initialize',payload:{title:'Web recovery'}})
    await fx.invoke('project_collaboration',lead,{action:'update_own_seat',payload:{expected_revision:0,state:'active',duty:'Launch owner',resource_scope:['src/web-recovery'],phase:'work',next_step:'recover'}})
    const reserved=await mod.reserveProjectLaunchSlots(fx.projectEntry,Object.freeze({agent:lead}),{request_id:'web-retry-slot',slots:[{title:'Web child',role:'Child',resources:['src/web-recovery'],task:'Recover'}],prepared:[{slotRef:'web-retry-failure',operationRef:'web-retry-operation',adoptionCapability:'web-retry-capability'}]})
    fx.failures.set('web-retry-failure',{failedActorRef:reserved.reservations[0].slotActorRef,taskRef:reserved.reservations[0].taskRef,operationRef:'web-retry-operation',batchRef:'web-retry-batch',failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host operation definitively failed',role:'Child',resources:['src/web-recovery'],task:'Recover'})
    fx.projectSessionLaunch.retryFailedSlot=async(_execution,{slotRef})=>({state:'outcome_unknown',slots:[{slotRef,state:'outcome_unknown'}]})
    fx.projectSessionLaunch.slotStatus=async(_execution,{slotRef})=>({state:'outcome_unknown',slots:[{slotRef,state:'outcome_unknown'}]})
    const prepared=await fx.invoke('project_collaboration',lead,{action:'recover_root',request_id:'web-retry-request',payload:{failure_ref:'web-retry-failure',mode:'retry'}}),recovery=prepared.recoveries[0]
    assert.equal(recovery.state,'outcome_unknown')
    fx.projectSessionLaunch.slotStatus=async(_execution,{slotRef})=>({state:'ready',slots:[{slotRef,state:'ready'}]})
    const teamDocument={version:6,settings:{enabled:true,maxMembers:4,maxActiveTurns:4},teams:[]},teamStore={read:async operation=>operation(teamDocument),subscribe:()=>()=>{},snapshot:()=>teamDocument}
    projectTaskRuntimeForSession=mod.createProjectTaskSessionRuntimeResolver(fx.ctx,fx.projectEntry)
    mod.registerWebApi(fx.ctx,teamStore,Promise.resolve(),undefined,fx.projectEntry,fx.projectSessionLaunch,projectTaskRuntimeForSession)
    const route=fx.routes.find(value=>value.path==='/api/agent-teams/action')
    const projected=(await projectTaskRuntimeForSession(lead.id).state()).projectCollaboration.sections.recoveries.find(item=>item.state==='outcome_unknown')
    assert.equal(projected.canRetry,true); assert.match(projected.recoveryCapability,/^prc1\./u)
    const body={action:'root-recovery-continue',sessionId:lead.id,recoveryCapability:projected.recoveryCapability,recoveryAction:'retry',expectedRevision:recovery.revision,confirm:true}
    assert.equal((await invokeWebRoute(route,body,{header:false})).status,403)
    assert.equal((await invokeWebRoute(route,{...body,confirm:false})).status,400)
    assert.equal((await invokeWebRoute(route,{...body,sessionId:'missing-root'})).status,403)
    assert.equal((await invokeWebRoute(route,{...body,sessionId:foreign.id})).status,403)
    assert.equal((await invokeWebRoute(route,{...body,recoveryAction:'takeover'})).status,403)
    const success=await invokeWebRoute(route,body); assert.equal(success.status,200,JSON.stringify(success.body)); assert.equal(success.body.ok,true)
    const stale=await invokeWebRoute(route,body); assert.equal(stale.status,409); assert.equal(stale.body.code??stale.body.error?.code,'PROJECT_ROOT_RECOVERY_CONFLICT')

    const secondReserved=await mod.reserveProjectLaunchSlots(fx.projectEntry,Object.freeze({agent:lead}),{request_id:'web-prepared-slot',slots:[{title:'Interrupted child',role:'Child',resources:['src/web-recovery'],task:'Recover after restart'}],prepared:[{slotRef:'web-prepared-failure',operationRef:'web-prepared-operation',adoptionCapability:'web-prepared-capability'}]})
    fx.failures.set('web-prepared-failure',{failedActorRef:secondReserved.reservations[0].slotActorRef,taskRef:secondReserved.reservations[0].taskRef,operationRef:'web-prepared-operation',batchRef:'web-prepared-batch',failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host operation definitively failed before reservation',role:'Child',resources:['src/web-recovery'],task:'Recover after restart'})
    const {ProjectTaskStore}=await import(pathToFileURL(projectTaskStoreFile).href),originalReserve=ProjectTaskStore.prototype.reserveRootRecovery
    let interrupted=false
    ProjectTaskStore.prototype.reserveRootRecovery=function(input){ if(!interrupted){interrupted=true;throw Object.assign(new Error('simulated restart between prepare and reserve'),{code:'SIMULATED_RESTART'})} return originalReserve.call(this,input) }
    let interruptedResult
    try { interruptedResult=await fx.invoke('project_collaboration',lead,{action:'recover_root',request_id:'web-prepared-request',payload:{failure_ref:'web-prepared-failure',mode:'retry'}}) }
    finally { ProjectTaskStore.prototype.reserveRootRecovery=originalReserve }
    assert.equal(interrupted,true); assert.equal(interruptedResult.ok,false)
    const preparedProjection=(await projectTaskRuntimeForSession(lead.id).state()).projectCollaboration.sections.recoveries.find(item=>item.state==='prepared')
    assert.equal(preparedProjection.canRetry,true); assert.match(preparedProjection.recoveryCapability,/^prc1\./u)
    let retriedFailureRef
    fx.projectSessionLaunch.retryFailedSlot=async(_execution,{slotRef})=>{retriedFailureRef=slotRef;return {state:'ready',slots:[{slotRef,state:'ready'}]}}
    const resumed=await invokeWebRoute(route,{action:'root-recovery-continue',sessionId:lead.id,recoveryCapability:preparedProjection.recoveryCapability,recoveryAction:'retry',expectedRevision:preparedProjection.revision,confirm:true})
    assert.equal(resumed.status,200,JSON.stringify(resumed.body)); assert.equal(retriedFailureRef,'web-prepared-failure')
    const readyProjection=(await projectTaskRuntimeForSession(lead.id).state()).projectCollaboration.sections.recoveries.find(item=>item.recoveryRef===preparedProjection.recoveryRef)
    assert.equal(readyProjection.state,'ready')
  } finally { await projectTaskRuntimeForSession?.close?.(); await fx.cleanup() }
})

test('explicit blocker contract leaves only the EP02 head claimable in an EP02 to EP05 chain', async () => {
  const mod = await import(`${pathToFileURL(hostFile).href}?dependency-direction=${Date.now()}`), fx = await registeredProjectToolsFixture(mod, 'dependency-direction')
  try {
    const [lead, firstWorker, tailWorker] = fx.roots
    assert.equal((await fx.invoke('project_collaboration', lead, { action: 'initialize', payload: { title: 'Dependency direction' } })).ok, true)
    const episodes = []
    for (const [index, name] of ['EP02', 'EP03', 'EP04', 'EP05'].entries()) episodes.push(await fx.invoke('project_task', lead, { action: 'create', request_id: `direction-${name}`, payload: { title: name, priority: 100 - index * 10 } }))
    for (let index = 1; index < episodes.length; index += 1) {
      const linked = await fx.invoke('project_task', lead, { action: 'add_dependency', request_id: `direction-link-${index}`, task_ref: episodes[index].task.taskRef, expected_revision: episodes[index].task.revision, payload: { blockerTaskRef: episodes[index - 1].task.taskRef } })
      assert.equal(linked.ok, true, JSON.stringify(linked))
      episodes[index] = linked
    }
    const listed = await fx.invoke('project_task', lead, { action: 'list', payload: { task_limit: 120 } }), byTitle = Object.fromEntries(listed.tasks.map(task => [task.title, task]))
    assert.deepEqual(byTitle.EP02.blockedBy, [])
    assert.deepEqual(byTitle.EP03.blockedBy, [episodes[0].task.taskRef])
    assert.deepEqual(byTitle.EP04.blockedBy, [episodes[1].task.taskRef])
    assert.deepEqual(byTitle.EP05.blockedBy, [episodes[2].task.taskRef])
    const head = await fx.invoke('project_task', firstWorker, { action: 'claim_next', request_id: 'direction-claim-head', payload: {} })
    assert.equal(head.status, 'claimed')
    assert.equal(head.task.taskRef, episodes[0].task.taskRef)
    const tail = await fx.invoke('project_task', tailWorker, { action: 'claim', request_id: 'direction-claim-tail', task_ref: episodes[3].task.taskRef, expected_revision: episodes[3].task.revision, payload: {} })
    assert.equal(tail.ok, false)
    assert.equal(tail.error.code, 'PROJECT_TASK_DEPENDENCY_BLOCKED')
  } finally { await fx.cleanup() }
})

test('registered project tools execute request lifecycle, per-project HMAC refs, task actions, and same-root claim races', async () => {
  const mod = await import(`${pathToFileURL(hostFile).href}?registered-tools=${Date.now()}`)
  const storeMod = await import(pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href)
  const fixtures = [await registeredProjectToolsFixture(mod, 'alpha'), await registeredProjectToolsFixture(mod, 'beta')]
  const setupRequest = async (fx, rawRequestId, verifyInvalidIds = false) => {
    const [lead, target] = fx.roots
    assert.equal((await fx.invoke('project_collaboration', lead, { action: 'initialize', payload: { title: 'Registered board' } })).ok, true)
    const blocked = await fx.invoke('project_task', lead, { action: 'create', request_id: 'create-blocked', payload: { title: 'Blocked requester' } })
    const dependency = await fx.invoke('project_task', lead, { action: 'create', request_id: 'create-dependency', payload: { title: 'Owned dependency' } })
    assert.equal(blocked.ok && dependency.ok, true)
    const claimedDependency = await fx.invoke('project_task', target, { action: 'claim', request_id: 'claim-dependency', task_ref: dependency.task.taskRef, expected_revision: dependency.task.revision, payload: {} })
    assert.equal(claimedDependency.task.status, 'in_progress')
    const related = await fx.invoke('project_task', lead, { action: 'add_dependency', request_id: 'block-requester', task_ref: blocked.task.taskRef, expected_revision: blocked.task.revision, payload: { blockerTaskRef: dependency.task.taskRef } })
    assert.equal(related.ok, true)
    const ambiguousDirection = await fx.invoke('project_task', lead, { action: 'add_dependency', request_id: 'ambiguous-reverse-rejected', task_ref: dependency.task.taskRef, expected_revision: claimedDependency.task.revision, payload: { targetTaskRef: blocked.task.taskRef, relationType: 'blocks' } })
    assert.equal(ambiguousDirection.ok, false, 'legacy source/target dependency fields must fail instead of silently reversing the chain')
    const requestPayload = { kind: 'dependency_unblock', task_ref: blocked.task.taskRef, dependency_task_ref: dependency.task.taskRef, reason: 'registered dependency wait', respond_by_at: Date.now() + 60_000 }
    if (verifyInvalidIds) {
      for (const args of [{ action: 'create_request', payload: requestPayload }, { action: 'create_request', request_id: '   ', payload: requestPayload }]) {
        const invalid = await fx.invoke('project_collaboration', lead, args)
        assert.equal(invalid.ok, false)
        assert.equal(invalid.error.code, 'PROJECT_COLLABORATION_FAILED')
      }
    }
    const opened = await fx.invoke('project_collaboration', lead, { action: 'create_request', request_id: rawRequestId, payload: requestPayload })
    assert.equal(opened.ok, true, JSON.stringify(opened))
    assert.deepEqual({ mine: opened.requests[0].mine, targetedToMe: opened.requests[0].targetedToMe, escalationEligible: opened.requests[0].escalationEligible }, { mine: true, targetedToMe: false, escalationEligible: true })
    assert.doesNotMatch(JSON.stringify(opened), /actorRef|requesterActorRef|targetActorRef/u)
    return { blocked, dependency, opened, related }
  }
  try {
    const first = await setupRequest(fixtures[0], 'same-raw-request-id', true)
    const second = await setupRequest(fixtures[1], 'same-raw-request-id')
    assert.notEqual(first.opened.requests[0].requestRef, second.opened.requests[0].requestRef, 'same raw id is domain-HMAC isolated per project')

    const fx = fixtures[0], [lead, target, worker] = fx.roots
    const priorityFirst = await fx.invoke('project_task', lead, { action: 'create', request_id: 'priority-cross-project', payload: { title: 'Priority zero', priority: 0 } })
    const prioritySecond = await fixtures[1].invoke('project_task', fixtures[1].roots[0], { action: 'create', request_id: 'priority-cross-project', payload: { title: 'Priority maximum', priority: 1_000_000 } })
    assert.equal(priorityFirst.task.priority, 0)
    assert.equal(prioritySecond.task.priority, 1_000_000)
    assert.notEqual(priorityFirst.task.taskRef, prioritySecond.task.taskRef, 'same raw request stays isolated across canonical projects')
    const prioritySetInput = { action: 'edit', request_id: 'priority-set', task_ref: priorityFirst.task.taskRef, expected_revision: priorityFirst.task.revision, payload: { priority: 42 } }
    const prioritySet = await fx.invoke('project_task', lead, prioritySetInput)
    assert.equal(prioritySet.task.priority, 42)
    assert.equal(prioritySet.task.requirementsRevision, priorityFirst.task.requirementsRevision)
    assert.equal((await fx.invoke('project_task', lead, prioritySetInput)).duplicate, true)
    const priorityDrift = await fx.invoke('project_task', lead, { ...prioritySetInput, payload: { priority: 43 } })
    assert.equal(priorityDrift.ok, false)
    assert.equal(priorityDrift.error.code, 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
    const priorityChanged = await fx.invoke('project_task', lead, { action: 'edit', request_id: 'priority-change', task_ref: priorityFirst.task.taskRef, expected_revision: prioritySet.task.revision, payload: { priority: 1_000_000 } })
    assert.equal(priorityChanged.task.priority, 1_000_000)
    const priorityCleared = await fx.invoke('project_task', lead, { action: 'edit', request_id: 'priority-clear', task_ref: priorityFirst.task.taskRef, expected_revision: priorityChanged.task.revision, payload: { priority: null } })
    assert.equal(Object.hasOwn(priorityCleared.task, 'priority'), false)
    const priorityStale = await fx.invoke('project_task', lead, { action: 'edit', request_id: 'priority-stale', task_ref: priorityFirst.task.taskRef, expected_revision: priorityChanged.task.revision, payload: { priority: 7 } })
    assert.equal(priorityStale.ok, false)
    assert.equal(priorityStale.error.code, 'PROJECT_TASK_CONFLICT')
    const priorityForbidden = await fx.invoke('project_task', worker, { action: 'edit', request_id: 'priority-forbidden', task_ref: priorityFirst.task.taskRef, expected_revision: priorityCleared.task.revision, payload: { priority: 7 } })
    assert.equal(priorityForbidden.ok, false)
    assert.equal(priorityForbidden.error.code, 'PROJECT_TASK_FORBIDDEN')
    for (const [suffix, payload] of [['negative', { title: 'negative', priority: -1 }], ['overflow', { title: 'overflow', priority: 1_000_001 }], ['fraction', { title: 'fraction', priority: 1.5 }], ['string', { title: 'string', priority: '7' }], ['forged', { title: 'forged', priority: 7, actorRef: 'forged' }]]) {
      const rejectedPriority = await fx.invoke('project_task', lead, { action: 'create', request_id: `priority-invalid-${suffix}`, payload })
      assert.equal(rejectedPriority.ok, false, suffix)
    }
    const wrongActionPriority = await fx.invoke('project_task', lead, { action: 'claim', request_id: 'priority-wrong-action', task_ref: priorityFirst.task.taskRef, expected_revision: priorityCleared.task.revision, payload: { priority: 7 } })
    assert.equal(wrongActionPriority.ok, false)
    const isolatedList = await fixtures[1].invoke('project_task', fixtures[1].roots[0], { action: 'list', payload: { task_limit: 120 } })
    assert.equal(isolatedList.tasks.find(task => task.taskRef === prioritySecond.task.taskRef).priority, 1_000_000)
    assert.equal(isolatedList.tasks.some(task => task.taskRef === priorityFirst.task.taskRef), false)

    const originalSnapshot = storeMod.ProjectTaskStore.prototype.readCollaborationSnapshot
    storeMod.ProjectTaskStore.prototype.readCollaborationSnapshot = () => { throw new Error('registered request tools must not materialize a full snapshot for actor authority or request decoration') }
    let targeted, coordinatorRequests
    try {
      targeted = await fx.invoke('project_collaboration', target, { action: 'read_requests', payload: { limit: 20 } })
      coordinatorRequests = await fx.invoke('project_collaboration', lead, { action: 'read_requests', payload: { limit: 20 } })
    } finally { storeMod.ProjectTaskStore.prototype.readCollaborationSnapshot = originalSnapshot }
    assert.equal(coordinatorRequests.ok, true)
    assert.equal(coordinatorRequests.requests.find(request => request.requestRef === first.opened.requests[0].requestRef).escalationEligible, true)
    const targetRow = targeted.requests.find(request => request.requestRef === first.opened.requests[0].requestRef)
    assert.deepEqual({ mine: targetRow.mine, targetedToMe: targetRow.targetedToMe, escalationEligible: targetRow.escalationEligible }, { mine: false, targetedToMe: true, escalationEligible: false })
    const rejected = await fx.invoke('project_collaboration', target, { action: 'respond_request', payload: { request_ref: targetRow.requestRef, expected_revision: targetRow.revision, response: 'reject', resolution: 'not available' } })
    assert.equal(rejected.requests[0].state, 'rejected')

    const cancelCandidate = await fx.invoke('project_collaboration', lead, { action: 'create_request', request_id: 'request-cancel', payload: { kind: 'dependency_unblock', task_ref: first.blocked.task.taskRef, dependency_task_ref: first.dependency.task.taskRef, reason: 'cancel cycle', respond_by_at: Date.now() + 60_000 } })
    const cancelled = await fx.invoke('project_collaboration', lead, { action: 'cancel_request', payload: { request_ref: cancelCandidate.requests[0].requestRef, expected_revision: cancelCandidate.requests[0].revision, resolution: 'no longer needed' } })
    assert.equal(cancelled.requests[0].state, 'cancelled')
    const auditCandidate = await fx.invoke('project_collaboration', lead, { action: 'create_request', request_id: 'request-audit', payload: { kind: 'takeover', task_ref: first.blocked.task.taskRef, dependency_task_ref: first.dependency.task.taskRef, reason: 'explicit early takeover', respond_by_at: Date.now() + 60_000 } })
    assert.equal(auditCandidate.requests[0].escalationEligible, true)
    const audited = await fx.invoke('project_collaboration', lead, { action: 'audit_resolve_request', payload: { request_ref: auditCandidate.requests[0].requestRef, expected_revision: auditCandidate.requests[0].revision, resolution: 'direct user authorized early' } })
    assert.equal(audited.requests[0].state, 'escalated')
    assert.equal(audited.requests[0].escalationEligible, false)
    const removedDependency = await fx.invoke('project_task', lead, { action: 'remove_dependency', request_id: 'unblock-requester', task_ref: first.blocked.task.taskRef, expected_revision: first.related.task.revision, payload: { blockerTaskRef: first.dependency.task.taskRef } })
    assert.equal(removedDependency.ok, true, JSON.stringify(removedDependency))
    const unblockedClaim = await fx.invoke('project_task', worker, { action: 'claim', request_id: 'claim-unblocked-requester', task_ref: first.blocked.task.taskRef, expected_revision: removedDependency.task.revision, payload: {} })
    assert.equal(unblockedClaim.ok, true, JSON.stringify(unblockedClaim))
    assert.equal(unblockedClaim.task.status, 'in_progress')
    const returnedUnblocked = await fx.invoke('project_task', worker, { action: 'transition', request_id: 'return-unblocked-requester', task_ref: unblockedClaim.task.taskRef, expected_revision: unblockedClaim.task.revision, payload: { to: 'todo' } })
    assert.equal(returnedUnblocked.task.status, 'todo')

    const raceTasks = await Promise.all(['a', 'b'].map(suffix => fx.invoke('project_task', lead, { action: 'create', request_id: `race-create-${suffix}`, payload: { title: `Race ${suffix}` } })))
    raceTasks[0] = await fx.invoke('project_task', lead, { action: 'edit', request_id: 'race-edit-a', task_ref: raceTasks[0].task.taskRef, expected_revision: raceTasks[0].task.revision, payload: { title: 'Edited race A' } })
    const raced = await Promise.all(raceTasks.map((task, index) => fx.invoke('project_task', worker, { action: 'claim', request_id: `race-claim-${index}`, task_ref: task.task.taskRef, expected_revision: task.task.revision, payload: {} })))
    assert.equal(raced.filter(result => result.ok === true).length, 1)
    assert.equal(raced.find(result => result.ok === false).error.code, 'PROJECT_TASK_ACTIVE_LIMIT')
    const claimed = raced.find(result => result.ok === true)
    const occupied = await fx.invoke('project_task', worker, { action: 'claim_next', request_id: 'worker-claim-next', payload: {} })
    assert.equal(occupied.status, 'temporarily_empty')
    const commented = await fx.invoke('project_task', worker, { action: 'comment', request_id: 'worker-comment', task_ref: claimed.task.taskRef, expected_revision: claimed.task.revision, payload: { commentRef: 'comment_registered', kind: 'discussion', body: 'registered tool comment' } })
    const started = await fx.invoke('project_task', worker, { action: 'start_attempt', request_id: 'worker-start', task_ref: commented.task.taskRef, expected_revision: commented.task.revision, payload: { attemptRef: 'attempt_registered' } })
    const submitted = await fx.invoke('project_task', worker, { action: 'submit_attempt', request_id: 'worker-submit', task_ref: started.task.taskRef, expected_revision: started.task.revision, payload: { attemptRef: 'attempt_registered' } })
    const reviewing = await fx.invoke('project_task', worker, { action: 'transition', request_id: 'worker-review-state', task_ref: submitted.task.taskRef, expected_revision: submitted.task.revision, payload: { to: 'in_review', attemptRef: 'attempt_registered' } })
    const reviewed = await fx.invoke('project_task', lead, { action: 'review', request_id: 'worker-review', task_ref: reviewing.task.taskRef, expected_revision: reviewing.task.revision, payload: { reviewRef: 'review_registered', attemptRef: 'attempt_registered', verdict: 'approved', body: 'approved' } })
    const done = await fx.invoke('project_task', lead, { action: 'transition', request_id: 'worker-done', task_ref: reviewed.task.taskRef, expected_revision: reviewed.task.revision, payload: { to: 'done', attemptRef: 'attempt_registered', reviewRef: 'review_registered' } })
    assert.equal(done.task.status, 'done')
    const receipt = await fx.invoke('project_task', lead, { action: 'receipt', request_id: 'worker-done' })
    assert.equal(receipt.task.status, 'done')
    const list = await fx.invoke('project_task', lead, { action: 'list', payload: { task_limit: 120 } })
    assert.equal(list.tasks.some(task => task.taskRef === done.task.taskRef), true)

    const prompt = fx.prompts.find(section => section.name === 'tool:project-collaboration').text()
    for (const phrase of ['adoption and every project-task boundary', 'dependency_unblock', 'accept, reject, or release', 'respondByAt', 'explicit direct-user authorization', 'durable and no-wake', 'bounded context', 'not project evidence']) assert.match(prompt, new RegExp(phrase, 'u'))
  } finally { await Promise.all(fixtures.map(fixture => fixture.cleanup())) }
})

test('failed-member recovery tool and trusted Host action enforce direct-human root confirmation and OCC', async () => {
  const host = await readFile(hostFile, 'utf8')
  const tool = sliceBetween(host, 'name: "team_member_recover"', 'name: "team_status"')
  assert.match(tool, /requireDirectHumanRoot\(ctx, execution\)/u)
  assert.match(tool, /request_id/u)
  assert.match(tool, /expected_revision/u)
  assert.match(tool, /recoverFailedMember/u)
  assert.match(tool, /name: "team_member_reconcile"/u)
  assert.match(tool, /reconcileMemberRecovery/u)
  assert.match(tool, /resolution/u)
  const route = sliceBetween(host, 'path: "/api/agent-teams/action"', 'function registerProjectEntryApi')
  assert.match(route, /body\.confirm !== true/u)
  assert.match(route, /ctx\.agents\.roots\(\)\.includes\(lead\)/u)
  assert.match(route, /root-recovery-continue[\s\S]*body\.confirm !== true[\s\S]*ctx\.agents\.roots\(\)\.includes\(lead\)[\s\S]*recoveryCapability[\s\S]*recoveryAction[\s\S]*resolveRootRecoveryCapability[\s\S]*continueProjectRootRecovery/u)
  assert.match(route, /current\.state==="prepared"[\s\S]*reservePreparedProjectRootRecovery/u)
  assert.match(host, /async function reservePreparedProjectRootRecovery[\s\S]*prepareStart[\s\S]*prepareAdoptions[\s\S]*reserveRootRecovery/u)
  assert.match(route, /member-retry/u)
  assert.match(route, /member-replace/u)
  assert.match(route, /member-reconcile/u)
  assert.match(route, /expectedRevision: body\.expectedRevision/u)
  assert.match(host, /a prior member recovery is unresolved; reconcile the exact receipt before another attempt/u)
  assert.match(host, /followup_dispatching/u)
  assert.match(host, /MAX_MEMBER_RECOVERY_RECEIPTS = 24/u)
  assert.match(host, /team changed before member recovery; refresh and confirm again/u)
  assert.match(host, /Replays never duplicate a model turn or member/u)
})
