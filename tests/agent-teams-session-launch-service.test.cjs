const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { randomBytes, createHash, createHmac } = require('node:crypto')
const { CALLER_SALT_ENV, createAgentTeamsSessionLaunchService, projectKeyForWorkspace } = require('../electron/bridge/agent-teams-session-launch-service.cjs')

const rootRef = value => createHash('sha256').update(value).digest('hex')
const derivedRootRef = (salt, canonicalProjectKey, sessionId) => createHmac('sha256', Buffer.from(salt, 'base64url')).update(JSON.stringify(['agent-teams-caller-root-v1', canonicalProjectKey, sessionId])).digest('hex')
const requestOf = payload => payload?.args?.request
async function fixture(serviceOptions = {}, rpcOverride) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atsl-')), token = randomBytes(32), calls = [], sessions = new Set()
  const projects = { a: path.join(root, 'a'), b: path.join(root, 'b') }; await Promise.all(Object.values(projects).map(value => mkdir(value)))
  const rpc = rpcOverride || (async (method, payload) => { calls.push([method, structuredClone(payload)]); if (method === 'workspace/create') return { workspace: { workspaceId: `ws-${path.basename(requestOf(payload).path)}`, path: requestOf(payload).path } }; if (method === 'session/create') { sessions.add(requestOf(payload).sessionId); return { sessionId: requestOf(payload).sessionId } }; if (method === 'session/list') return { items: [...sessions].map(sessionId => ({ sessionId })) }; if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }; if (method === 'session/prompt') return { accepted: true }; throw new Error(method) })
  const stateFile = path.join(root, 'state.json')
  const service = createAgentTeamsSessionLaunchService({ stateFile, token, callRuntimeRpc: rpc, ...serviceOptions }); await service.start(); const auth = token.toString('base64url')
  const resolve = (name, caller = name) => service.handleRequest({ action: 'resolveProject', token: auth, canonicalProjectKey: projectKeyForWorkspace(projects[name]), workspacePath: projects[name], callerRootRef: rootRef(caller) })
  const launch = (binding, suffix, caller = suffix, overrides = {}) => ({ action: 'launch', token: auth, canonicalProjectKey: projectKeyForWorkspace(projects[suffix[0]]), callerRootRef: rootRef(caller), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, batchRef: `batch_${suffix}`, slotRef: `slot_${suffix}`, operationRef: `operation_${suffix}`, title: `Title ${suffix}`, role: 'role', resources: [`src/${suffix}`], task: 'task', initialization: 'init', ...overrides })
  return { root, stateFile, token, rpc, service, auth, projects, calls, resolve, launch }
}
async function cleanup(value) { await value.service.close(); await rm(value.root, { recursive: true, force: true }) }

test('internal resolve validates canonical key, issues caller-specific ticket, and never returns raw identities', async () => {
  const value = await fixture()
  try {
    const a1 = await value.resolve('a', 'root-1'), a2 = await value.resolve('a', 'root-2')
    assert.equal(a1.projectRef, a2.projectRef); assert.notEqual(a1.rootSessionRef, a2.rootSessionRef); assert.notEqual(a1.projectTicket, a2.projectTicket)
    assert.equal(a1.maxSessions, 8)
    assert.equal(JSON.stringify(a1).includes(value.projects.a), false)
    await assert.rejects(value.service.handleRequest({ action: 'resolveProject', token: value.auth, canonicalProjectKey: '0'.repeat(64), workspacePath: value.projects.a, callerRootRef: rootRef('x') }), error => error.code === 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH')
  } finally { await cleanup(value) }
})

test('ticket binding supports background multi-project launch and rejects cross-project/root replay', async () => {
  const value = await fixture()
  try {
    const a = await value.resolve('a', 'ra'), b = await value.resolve('b', 'rb')
    const malicious = 'OTHER_SLOT_SENTINEL full board history and private team internals capability caller salt raw actor path session identity'
    const aLaunch = value.launch(a, 'a1', 'ra', { role: 'UI duty', resources: ['src/ui.js'], task: 'Implement only UI', initialization: malicious })
    const reservation = await value.service.handleRequest({ action: 'reserveAdoption', token: value.auth, canonicalProjectKey: aLaunch.canonicalProjectKey, callerRootRef: aLaunch.callerRootRef, projectTicket: aLaunch.projectTicket, projectRef: aLaunch.projectRef, boardRef: aLaunch.boardRef, batchRef: aLaunch.batchRef, slotRef: aLaunch.slotRef, operationRef: aLaunch.operationRef })
    const launchResult = await value.service.handleRequest(aLaunch)
    assert.equal(launchResult.state, 'ready')
    assert.equal((await value.service.handleRequest(value.launch(b, 'b1', 'rb'))).state, 'ready')
    const prompt = requestOf(value.calls.find(row => row[0] === 'session/prompt')[1]).content[0].text
    const stored = JSON.parse(await readFile(value.stateFile, 'utf8')), rawSessionId = stored.operations.find(row => row.operationRef === aLaunch.operationRef).sessionId
    const callerSalt = value.service.runtimeEnvironment({})[CALLER_SALT_ENV]
    assert.ok(prompt.length <= 8 * 1024)
    assert.match(prompt, /UI duty/u); assert.match(prompt, /src\/ui\.js/u); assert.match(prompt, /Implement only UI/u)
    assert.match(prompt, /representing only this assigned seat/u); assert.match(prompt, /private Agent Team/u); assert.match(prompt, /must not use project board tools/u); assert.match(prompt, /explicit evidence and status/u)
    assert.match(prompt, /call project_collaboration with action "adopt_slot"/u)
    assert.match(prompt, /read the adopted assigned project task/u)
    assert.match(prompt, /project_task claim_next/u)
    assert.match(prompt, /create one durable collaboration request/u)
    assert.match(prompt, /adoption and every project-task boundary/u)
    assert.match(prompt, /dependency_unblock, release, handoff, and takeover/u)
    assert.match(prompt, /accept, reject, or release/u)
    assert.match(prompt, /respondByAt/u)
    assert.match(prompt, /explicit direct-user authorization/u)
    assert.match(prompt, /durable and no-wake/u)
    assert.match(prompt, /current claimed project task/u)
    assert.match(prompt, /bounded task context/u)
    assert.match(prompt, /not project evidence/u)
    assert.match(prompt, /do not poll or wake stopped roots/u)
    assert.match(prompt, /all_terminal/u)
    assert.match(prompt, /every remaining blocker has a recorded durable request/u)
    assert.equal(prompt.includes(`payload ${JSON.stringify({ slot_ref: aLaunch.slotRef })}`), true)
    assert.doesNotMatch(prompt, /OTHER_SLOT_SENTINEL|full board history|private team internals|capability|caller salt|raw actor|session identity/iu)
    assert.equal(prompt.includes(reservation.adoptionCapability), false)
    assert.equal(prompt.includes(callerSalt), false)
    assert.equal(prompt.includes(rawSessionId), false)
    assert.equal(JSON.stringify(launchResult).includes(reservation.adoptionCapability), false)
    assert.equal(JSON.stringify(launchResult).includes(callerSalt), false)
    assert.equal(JSON.stringify(launchResult).includes(rawSessionId), false)
    await assert.rejects(value.service.handleRequest({ ...value.launch(a, 'a2', 'ra'), projectTicket: b.projectTicket }), error => error.code === 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH')
    await assert.rejects(value.service.handleRequest({ ...value.launch(a, 'a3', 'ra'), callerRootRef: rootRef('other') }), error => error.code === 'HOST_SESSION_LAUNCH_PROJECT_MISMATCH')
    assert.deepEqual(value.calls.filter(row => row[0] === 'workspace/create').map(row => path.basename(requestOf(row[1]).path)), ['a', 'b'])
  } finally { await cleanup(value) }
})

test('idempotency, session.list reconciliation shape, and queued cancellation remain bounded', async () => {
  let value, attempts = 0
  value = await fixture({}, async (method, payload) => { if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }; if (method === 'session/create') { attempts += 1; if (attempts === 1) throw new Error('timeout'); return { sessionId: requestOf(payload).sessionId } }; if (method === 'session/list') return { items: [] }; if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }; if (method === 'session/prompt') return { accepted: true } })
  try {
    const binding = await value.resolve('a', 'ra'), input = value.launch(binding, 'a1', 'ra')
    assert.equal((await value.service.handleRequest(input)).state, 'outcome_unknown')
    const envelope={ token: value.auth, canonicalProjectKey: projectKeyForWorkspace(value.projects.a), callerRootRef: rootRef('ra'), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, operationRef: input.operationRef }
    assert.equal((await value.service.handleRequest({ action: 'reconcile', ...envelope })).state, 'outcome_unknown'); assert.equal(attempts,1,'observer-only reconcile cannot enqueue or wake')
    assert.equal((await value.service.handleRequest({ action: 'retry', ...envelope })).state, 'ready')
    assert.equal(attempts, 2)
    assert.equal((await value.service.handleRequest(input)).state, 'ready')
  } finally { await cleanup(value) }
})

test('cold-start queued launch resumes after exact project rebind and reconciliation without duplicating the session or prompt', async () => {
  let value = await fixture()
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a)
    const binding = await value.resolve('a', 'queued-root')
    const input = value.launch(binding, 'a1', 'queued-root')
    assert.equal((await value.service.handleRequest(input)).state, 'ready')
    const stored = JSON.parse(await readFile(value.stateFile, 'utf8'))
    const expectedSessionId = stored.operations[0].sessionId
    await value.service.close()
    Object.assign(stored.operations[0], { state: 'queued', phase: 'reserved', revision: 1, updatedAt: Date.now() })
    for (const field of ['workspaceId', 'renameSeq', 'promptRequestId', 'reconciliation', 'errorCode']) delete stored.operations[0][field]
    await writeFile(value.stateFile, `${JSON.stringify(stored)}\n`, 'utf8')

    const sessions = new Set(), created = [], prompted = []
    const rpc = async (method, payload) => {
      const request = requestOf(payload)
      if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
      if (method === 'session/list') return { items: [...sessions].map(sessionId => ({ sessionId })) }
      if (method === 'session/create') { created.push(request.sessionId); sessions.add(request.sessionId); return { sessionId: request.sessionId } }
      if (method === 'session/rename') return { title: request.title, seq: 1 }
      if (method === 'session/prompt') { prompted.push({ requestId: request.requestId, sessionId: request.sessionId }); return { accepted: true } }
      throw new Error(method)
    }
    value.service = createAgentTeamsSessionLaunchService({ stateFile: value.stateFile, token: value.token, callRuntimeRpc: rpc })
    await value.service.start()
    assert.deepEqual({ queued: value.service.diagnostics().queued, running: value.service.diagnostics().running, records: value.service.diagnostics().records }, { queued: 0, running: 0, records: 1 }, 'redacted persisted bindings wait for an authenticated exact-path rebind')
    const rebound = await value.service.handleRequest({ action: 'resolveProject', token: value.auth, canonicalProjectKey, workspacePath: value.projects.a, callerRootRef: rootRef('queued-root') })
    assert.deepEqual({ queued: value.service.diagnostics().queued, running: value.service.diagnostics().running }, { queued: 0, running: 0 }, 'binding alone has no launch side effect, so a stop path can still cancel the queued operation')
    const envelope = { token: value.auth, canonicalProjectKey, callerRootRef: rootRef('queued-root'), projectTicket: rebound.projectTicket, projectRef: rebound.projectRef, boardRef: rebound.boardRef, operationRef: input.operationRef }
    const recovered = await value.service.handleRequest({ action: 'reconcile', ...envelope })
    assert.equal(recovered.state, 'ready')
    assert.deepEqual(created, [expectedSessionId])
    assert.deepEqual(prompted.map(row => row.sessionId), [expectedSessionId])
    assert.equal((await value.service.handleRequest({ action: 'retry', ...envelope })).state, 'ready')
    assert.equal((await value.service.handleRequest(input)).state, 'ready')
    assert.deepEqual(created, [expectedSessionId], 'retry and launch replay reuse the exact recovered session')
    assert.equal(prompted.length, 1, 'retry and launch replay never redeliver the initialization prompt')
    const recoveredState = JSON.parse(await readFile(value.stateFile, 'utf8'))
    assert.equal(recoveredState.operations[0].sessionId, expectedSessionId)
    assert.equal(recoveredState.operations[0].state, 'ready')
  } finally { await cleanup(value) }
})

test('terminal compaction never evicts active records and drained fair lanes are removed', async () => {
  const gates = []
  const value = await fixture({ maxTerminalRecords: 1, maxConcurrent: 2, maxConcurrentPerProject: 1 }, async (method, payload) => {
    if (method === 'workspace/create') {
      await new Promise(resolve => gates.push(resolve))
      return { workspace: { workspaceId: `w-${path.basename(requestOf(payload).path)}`, path: requestOf(payload).path } }
    }
    if (method === 'session/create') return { sessionId: requestOf(payload).sessionId }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    if (method === 'session/list') return { items: [] }
    throw new Error(method)
  })
  try {
    const a = await value.resolve('a', 'ra'), b = await value.resolve('b', 'rb')
    assert.deepEqual({ bindings: value.service.diagnostics().bindingIndexSize, tickets: value.service.diagnostics().ticketIndexSize }, { bindings: 2, tickets: 2 })
    const pa = value.service.handleRequest(value.launch(a, 'a1', 'ra')), pb = value.service.handleRequest(value.launch(b, 'b1', 'rb'))
    while (gates.length < 2) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(value.service.diagnostics().activeProjectLanes, 2)
    gates.splice(0).forEach(resolve => resolve()); await Promise.all([pa, pb])
    assert.equal(value.service.diagnostics().activeProjectLanes, 0)
    assert.equal(value.service.diagnostics().operationIndexSize, 1, 'terminal compaction rebuilds the O(1) operation index')
    assert.equal(value.service.diagnostics().operationSlotIndexSize, 1, 'terminal compaction rebuilds the O(1) slot index')
    const stored = JSON.parse(await readFile(path.join(value.root, 'state.json'), 'utf8'))
    assert.equal(stored.operations.length, 1); assert.equal(stored.operations[0].state, 'ready')
  } finally { await cleanup(value) }
})

test('private adoption capability is stable across restart and redeemable only by the exact ready child root', async () => {
  const value = await fixture()
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a)
    const parent = await value.resolve('a', 'parent')
    const launch = value.launch(parent, 'a1', 'parent')
    const parentEnvelope = { token: value.auth, canonicalProjectKey, callerRootRef: rootRef('parent'), projectTicket: parent.projectTicket, projectRef: parent.projectRef, boardRef: parent.boardRef, batchRef: launch.batchRef, slotRef: launch.slotRef, operationRef: launch.operationRef }
    const reserved = await value.service.handleRequest({ action: 'reserveAdoption', ...parentEnvelope })
    assert.match(reserved.adoptionCapability, /^adoption_[A-Za-z0-9_-]+$/u)
    assert.equal((await value.service.handleRequest(launch)).state, 'ready')
    const stored = JSON.parse(await readFile(value.stateFile, 'utf8'))
    const sessionId = stored.operations[0].sessionId
    const callerSalt = value.service.runtimeEnvironment({})[CALLER_SALT_ENV]
    const childCallerRootRef = derivedRootRef(callerSalt, canonicalProjectKey, sessionId)
    const child = await value.service.handleRequest({ action: 'resolveProject', token: value.auth, canonicalProjectKey, workspacePath: value.projects.a, callerRootRef: childCallerRootRef })
    const childEnvelope = { token: value.auth, canonicalProjectKey, callerRootRef: childCallerRootRef, projectTicket: child.projectTicket, projectRef: child.projectRef, boardRef: child.boardRef, batchRef: launch.batchRef, slotRef: launch.slotRef, operationRef: launch.operationRef }
    await assert.rejects(value.service.handleRequest({ action: 'reserveAdoption', ...childEnvelope }), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
    const redeemed = await value.service.handleRequest({ action: 'redeemAdoption', ...childEnvelope })
    assert.equal(redeemed.adoptionCapability, reserved.adoptionCapability)
    await assert.rejects(value.service.handleRequest({ action: 'redeemAdoption', ...parentEnvelope }), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
    await assert.rejects(value.service.handleRequest({ action: 'redeemAdoption', ...childEnvelope, slotRef: 'slot_wrong' }), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
    assert.equal(JSON.stringify(stored).includes(reserved.adoptionCapability), false)
    assert.equal(JSON.stringify(value.service.diagnostics()).includes(reserved.adoptionCapability), false)
    assert.equal(value.calls.filter(row => row[0] === 'session/prompt').some(row => JSON.stringify(row[1]).includes(reserved.adoptionCapability)), false)
    await value.service.close()
    const restarted = createAgentTeamsSessionLaunchService({ stateFile: value.stateFile, token: value.token, callRuntimeRpc: value.rpc })
    await restarted.start(); value.service = restarted
    assert.equal(restarted.runtimeEnvironment({})[CALLER_SALT_ENV], callerSalt)
    const childAfterRestart = await restarted.handleRequest({ action: 'resolveProject', token: value.auth, canonicalProjectKey, workspacePath: value.projects.a, callerRootRef: childCallerRootRef })
    const replay = await restarted.handleRequest({ action: 'redeemAdoption', ...childEnvelope, projectTicket: childAfterRestart.projectTicket, projectRef: childAfterRestart.projectRef, boardRef: childAfterRestart.boardRef })
    assert.equal(replay.adoptionCapability, reserved.adoptionCapability)
  } finally { await cleanup(value) }
})

test('adoption redemption rejects outcome-unknown and cancelled operations', async () => {
  let value
  const rpc = async (method, payload) => {
    if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
    if (method === 'session/create') throw new Error('unknown create outcome')
    if (method === 'session/list') return { items: [] }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    throw new Error(method)
  }
  value = await fixture({}, rpc)
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a)
    const parent = await value.resolve('a', 'parent-unknown')
    const launch = value.launch(parent, 'a1', 'parent-unknown')
    assert.equal((await value.service.handleRequest(launch)).state, 'outcome_unknown')
    let stored = JSON.parse(await readFile(value.stateFile, 'utf8'))
    const childCallerRootRef = derivedRootRef(value.service.runtimeEnvironment({})[CALLER_SALT_ENV], canonicalProjectKey, stored.operations[0].sessionId)
    let child = await value.service.handleRequest({ action: 'resolveProject', token: value.auth, canonicalProjectKey, workspacePath: value.projects.a, callerRootRef: childCallerRootRef })
    const redeem = () => value.service.handleRequest({ action: 'redeemAdoption', token: value.auth, canonicalProjectKey, callerRootRef: childCallerRootRef, projectTicket: child.projectTicket, projectRef: child.projectRef, boardRef: child.boardRef, batchRef: launch.batchRef, slotRef: launch.slotRef, operationRef: launch.operationRef })
    await assert.rejects(redeem(), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
    await value.service.close()
    stored.operations[0].state = 'cancelled'
    await writeFile(value.stateFile, `${JSON.stringify(stored)}\n`, 'utf8')
    const restarted = createAgentTeamsSessionLaunchService({ stateFile: value.stateFile, token: value.token, callRuntimeRpc: rpc })
    await restarted.start(); value.service = restarted
    child = await restarted.handleRequest({ action: 'resolveProject', token: value.auth, canonicalProjectKey, workspacePath: value.projects.a, callerRootRef: childCallerRootRef })
    await assert.rejects(redeem(), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
  } finally { await cleanup(value) }
})

test('explicit retry reuses the exact failed top-level session operation and unknown outcomes stay fenced', async () => {
  let value, creates=0, unknown=false
  value=await fixture({},async(method,payload)=>{ if(method==='workspace/create') return {workspace:{workspaceId:'wa',path:value.projects.a}}; if(method==='session/create'){ creates+=1; if(creates===1){ const error=new Error('definitive create rejection'); error.definitive=true; error.code='HOST_SESSION_CREATE_FAILED'; throw error } return {sessionId:requestOf(payload).sessionId} } if(method==='session/rename') return {title:requestOf(payload).title,seq:1}; if(method==='session/prompt') return {accepted:true}; if(method==='session/list') return {items:[]}; throw new Error(method) })
  try {
    const canonicalProjectKey=projectKeyForWorkspace(value.projects.a), binding=await value.resolve('a','retry-root'), input=value.launch(binding,'a1','retry-root')
    const failed=await value.service.handleRequest(input); assert.equal(failed.state,'failed')
    const envelope={action:'retry',token:value.auth,canonicalProjectKey,callerRootRef:rootRef('retry-root'),projectTicket:binding.projectTicket,projectRef:binding.projectRef,boardRef:binding.boardRef,operationRef:input.operationRef}
    const ready=await value.service.handleRequest(envelope); assert.equal(ready.state,'ready'); assert.equal(creates,2)
    assert.equal((await value.service.handleRequest(envelope)).state,'ready'); assert.equal(creates,2,'double click cannot create or charge another root')
    const stored=JSON.parse(await readFile(value.stateFile,'utf8')); stored.operations[0].state='outcome_unknown'; stored.operations[0].phase='prompt_dispatched'; await value.service.close(); await writeFile(value.stateFile,`${JSON.stringify(stored)}\n`,'utf8')
    const restarted=createAgentTeamsSessionLaunchService({stateFile:value.stateFile,token:value.token,callRuntimeRpc:value.rpc}); await restarted.start(); value.service=restarted
    const rebound=await restarted.handleRequest({action:'resolveProject',token:value.auth,canonicalProjectKey,workspacePath:value.projects.a,callerRootRef:rootRef('retry-root')})
    await assert.rejects(restarted.handleRequest({...envelope,projectTicket:rebound.projectTicket,projectRef:rebound.projectRef,boardRef:rebound.boardRef}),error=>error.code==='HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN'); assert.equal(creates,2)
  } finally { await cleanup(value) }
})

test('rename failure resumes the exact persisted session phase across Host restart without recreating or reprompting', async () => {
  let value,workspaces=0,creates=0,renames=0,prompts=0; const sessions=new Set()
  const rpc=async(method,payload)=>{if(method==='workspace/create'){workspaces+=1;return {workspace:{workspaceId:'wa',path:value.projects.a}}}if(method==='session/list')return {items:[...sessions].map(sessionId=>({sessionId}))};if(method==='session/create'){creates+=1;sessions.add(requestOf(payload).sessionId);return {sessionId:requestOf(payload).sessionId}}if(method==='session/rename'){renames+=1;if(renames===1){const error=new Error('rename rejected');error.definitive=true;error.code='HOST_SESSION_RENAME_FAILED';throw error}return {title:requestOf(payload).title,seq:1}}if(method==='session/prompt'){prompts+=1;return {accepted:true}};throw new Error(method)}
  value=await fixture({},rpc)
  try{const key=projectKeyForWorkspace(value.projects.a),binding=await value.resolve('a','rename-root'),input=value.launch(binding,'a2','rename-root'),failed=await value.service.handleRequest(input);assert.equal(failed.state,'failed');assert.deepEqual([workspaces,creates,renames,prompts],[1,1,1,0]);await value.service.close();const restarted=createAgentTeamsSessionLaunchService({stateFile:value.stateFile,token:value.token,callRuntimeRpc:rpc});await restarted.start();value.service=restarted;const rebound=await restarted.handleRequest({action:'resolveProject',token:value.auth,canonicalProjectKey:key,workspacePath:value.projects.a,callerRootRef:rootRef('rename-root')});const envelope={action:'retry',token:value.auth,canonicalProjectKey:key,callerRootRef:rootRef('rename-root'),projectTicket:rebound.projectTicket,projectRef:rebound.projectRef,boardRef:rebound.boardRef,operationRef:input.operationRef};assert.equal((await restarted.handleRequest(envelope)).state,'ready');assert.deepEqual([workspaces,creates,renames,prompts],[1,1,2,1]);assert.equal((await restarted.handleRequest(envelope)).state,'ready');assert.deepEqual([workspaces,creates,renames,prompts],[1,1,2,1])}finally{await cleanup(value)}
})

test('prompt uncertainty requires exact OCC reconciliation and remains observer-only until direct decision', async () => {
  let value,prompts=0,lists=0; const sessions=new Set()
  const rpc=async(method,payload)=>{if(method==='workspace/create')return {workspace:{workspaceId:'wa',path:value.projects.a}};if(method==='session/list'){lists+=1;return {items:[...sessions].map(sessionId=>({sessionId}))}}if(method==='session/create'){sessions.add(requestOf(payload).sessionId);return {sessionId:requestOf(payload).sessionId}}if(method==='session/rename')return {title:requestOf(payload).title,seq:1};if(method==='session/prompt'){prompts+=1;const error=new Error('prompt transport uncertain');error.definitive=true;error.code='HOST_PROMPT_FAILED';throw error};throw new Error(method)}
  const inspectRuntimePrompt=async({requestId,decision})=>decision===undefined?null:{delivered:decision==='delivered',source:'session/follow',rpcId:requestId}
  value=await fixture({ inspectRuntimePrompt },rpc)
  try {
    const key=projectKeyForWorkspace(value.projects.a),binding=await value.resolve('a','prompt-root'),input=value.launch(binding,'a3','prompt-root'),unknown=await value.service.handleRequest(input);assert.equal(unknown.state,'outcome_unknown');assert.equal(unknown.revision,1);assert.equal(prompts,1)
    const envelope={token:value.auth,canonicalProjectKey:key,callerRootRef:rootRef('prompt-root'),projectTicket:binding.projectTicket,projectRef:binding.projectRef,boardRef:binding.boardRef,operationRef:input.operationRef}
    assert.equal((await value.service.handleRequest({...envelope,action:'reconcile'})).state,'outcome_unknown');assert.equal(prompts,1)
    await assert.rejects(value.service.handleRequest({...envelope,action:'retry'}),error=>error.code==='HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN')
    const resolved=await value.service.handleRequest({...envelope,action:'resolveUnknown',requestId:'resolve-delivered',decision:'delivered',expectedRevision:1});assert.equal(resolved.state,'ready');assert.equal(resolved.revision,2);assert.equal(prompts,1)
    assert.deepEqual(await value.service.handleRequest({...envelope,action:'resolveUnknown',requestId:'resolve-delivered',decision:'delivered',expectedRevision:1}),resolved)
    await value.service.close();value.service=createAgentTeamsSessionLaunchService({stateFile:value.stateFile,token:value.token,callRuntimeRpc:rpc,inspectRuntimePrompt});await value.service.start();await value.service.handleRequest({action:'resolveProject',token:value.auth,canonicalProjectKey:key,workspacePath:value.projects.a,callerRootRef:rootRef('prompt-root')});assert.deepEqual(await value.service.handleRequest({...envelope,action:'resolveUnknown',requestId:'resolve-delivered',decision:'delivered',expectedRevision:1}),resolved)
    await assert.rejects(value.service.handleRequest({...envelope,action:'resolveUnknown',requestId:'resolve-delivered',decision:'not_delivered',expectedRevision:1}),error=>error.code==='HOST_SESSION_LAUNCH_IDEMPOTENCY_CONFLICT')
    await assert.rejects(value.service.handleRequest({...envelope,action:'resolveUnknown',requestId:'resolve-stale',decision:'delivered',expectedRevision:1}),error=>error.code==='HOST_SESSION_LAUNCH_CONFLICT')
    await assert.rejects(value.service.handleRequest({...envelope,action:'resolveUnknown',requestId:'resolve-terminal',decision:'delivered',expectedRevision:2}),error=>error.code==='HOST_SESSION_LAUNCH_RECONCILIATION_FORBIDDEN')
    const foreign=await value.service.handleRequest({action:'resolveProject',token:value.auth,canonicalProjectKey:key,workspacePath:value.projects.a,callerRootRef:rootRef('foreign-root')});await assert.rejects(value.service.handleRequest({...envelope,action:'resolveUnknown',callerRootRef:rootRef('foreign-root'),projectTicket:foreign.projectTicket,projectRef:foreign.projectRef,boardRef:foreign.boardRef,requestId:'foreign',decision:'delivered',expectedRevision:1}),error=>error.code==='HOST_SESSION_LAUNCH_PROJECT_MISMATCH')
    const second=value.launch(binding,'a4','prompt-root'),unknown2=await value.service.handleRequest(second);assert.equal(unknown2.state,'outcome_unknown');const notDelivered=await value.service.handleRequest({...envelope,operationRef:second.operationRef,action:'resolveUnknown',requestId:'resolve-not-delivered',decision:'not_delivered',expectedRevision:1});assert.equal(notDelivered.state,'failed');assert.equal(notDelivered.errorCode,'HOST_SESSION_PROMPT_NOT_DELIVERED');assert.equal(prompts,2);assert.ok(lists>=3)
  } finally { await cleanup(value) }
})

test('observer reconciliation derives delivered, not-delivered, and unavailable prompt evidence without blind retry', async () => {
  let value, prompts = 0, automaticEvidence = null
  const sessions = new Set()
  const rpc = async (method, payload) => {
    if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
    if (method === 'session/list') return { items: [...sessions].map(sessionId => ({ sessionId })) }
    if (method === 'session/create') { sessions.add(requestOf(payload).sessionId); return { sessionId: requestOf(payload).sessionId } }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') { prompts += 1; const error = new Error('prompt transport uncertain'); error.code = 'HOST_PROMPT_FAILED'; error.definitive = true; throw error }
    throw new Error(method)
  }
  const inspectRuntimePrompt = async ({ requestId, decision }) => {
    if (decision !== undefined || automaticEvidence === null) return null
    return { delivered: automaticEvidence, source: automaticEvidence ? 'session/control' : 'session/follow', rpcId: requestId }
  }
  value = await fixture({ inspectRuntimePrompt }, rpc)
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a), binding = await value.resolve('a', 'automatic-evidence-root')
    const envelope = operationRef => ({ token: value.auth, canonicalProjectKey, callerRootRef: rootRef('automatic-evidence-root'), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, operationRef })

    const deliveredInput = value.launch(binding, 'a7', 'automatic-evidence-root')
    assert.equal((await value.service.handleRequest(deliveredInput)).state, 'outcome_unknown')
    automaticEvidence = true
    const delivered = await value.service.handleRequest({ action: 'reconcile', ...envelope(deliveredInput.operationRef) })
    assert.deepEqual({ state: delivered.state, revision: delivered.revision }, { state: 'ready', revision: 2 })

    const notDeliveredInput = value.launch(binding, 'a8', 'automatic-evidence-root')
    automaticEvidence = null
    assert.equal((await value.service.handleRequest(notDeliveredInput)).state, 'outcome_unknown')
    automaticEvidence = false
    const notDelivered = await value.service.handleRequest({ action: 'reconcile', ...envelope(notDeliveredInput.operationRef) })
    assert.deepEqual({ state: notDelivered.state, revision: notDelivered.revision, errorCode: notDelivered.errorCode }, { state: 'failed', revision: 2, errorCode: 'HOST_SESSION_PROMPT_NOT_DELIVERED' })

    const unavailableInput = value.launch(binding, 'a9', 'automatic-evidence-root')
    automaticEvidence = null
    assert.equal((await value.service.handleRequest(unavailableInput)).state, 'outcome_unknown')
    const unavailable = await value.service.handleRequest({ action: 'reconcile', ...envelope(unavailableInput.operationRef) })
    assert.deepEqual({ state: unavailable.state, revision: unavailable.revision }, { state: 'outcome_unknown', revision: 1 })
    await assert.rejects(value.service.handleRequest({ action: 'retry', ...envelope(unavailableInput.operationRef) }), error => error.code === 'HOST_SESSION_LAUNCH_OUTCOME_UNKNOWN')
    automaticEvidence = true
    assert.equal((await value.service.handleRequest({ action: 'reconcile', ...envelope(unavailableInput.operationRef) })).state, 'ready')
    assert.equal(prompts, 3, 'observer reconciliation never dispatches or retries a prompt effect')
  } finally { await cleanup(value) }
})

test('opposite reconciliation decisions with one expected revision are serialized and only one may commit', async () => {
  let value, releaseInspection, inspections = 0
  const inspectionGate = new Promise(resolve => { releaseInspection = resolve })
  const rpc = async (method, payload) => {
    if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
    if (method === 'session/list') return { items: [] }
    if (method === 'session/create') return { sessionId: requestOf(payload).sessionId }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') { const error = new Error('prompt transport uncertain'); error.code = 'HOST_PROMPT_FAILED'; error.definitive = true; throw error }
    throw new Error(method)
  }
  const inspectRuntimePrompt = async ({ requestId, decision }) => { inspections += 1; await inspectionGate; return { delivered: decision === 'delivered', source: 'session/follow', rpcId: requestId } }
  value = await fixture({ inspectRuntimePrompt }, rpc)
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a), binding = await value.resolve('a', 'occ-root'), input = value.launch(binding, 'a5', 'occ-root')
    assert.equal((await value.service.handleRequest(input)).state, 'outcome_unknown')
    const envelope = { action: 'resolveUnknown', token: value.auth, canonicalProjectKey, callerRootRef: rootRef('occ-root'), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, operationRef: input.operationRef, expectedRevision: 1 }
    const delivered = value.service.handleRequest({ ...envelope, requestId: 'occ-delivered', decision: 'delivered' })
    const notDelivered = value.service.handleRequest({ ...envelope, requestId: 'occ-not-delivered', decision: 'not_delivered' })
    await new Promise(resolve => setImmediate(resolve))
    releaseInspection()
    const [winner, loser] = await Promise.allSettled([delivered, notDelivered])
    assert.equal(winner.status, 'fulfilled')
    assert.equal(winner.value.state, 'ready')
    assert.equal(winner.value.revision, 2)
    assert.equal(loser.status, 'rejected')
    assert.equal(loser.reason.code, 'HOST_SESSION_LAUNCH_CONFLICT')
    assert.equal(inspections, 1, 'the losing stale decision never performs or commits a second evidence inspection')
    assert.deepEqual(await value.service.handleRequest({ ...envelope, requestId: 'occ-delivered', decision: 'delivered' }), winner.value, 'the winning exact request remains an idempotent replay')
    assert.equal(inspections, 1)
    const stored = JSON.parse(await readFile(value.stateFile, 'utf8'))
    assert.equal(stored.operations[0].revision, 2)
    assert.equal(stored.operations[0].reconciliation.requestId, 'occ-delivered')
    assert.equal(stored.operations[0].reconciliation.decision, 'delivered')
  } finally { releaseInspection(); await cleanup(value) }
})

test('a delayed failing reconcile cannot roll back a serialized delivered prompt decision', async () => {
  let value, blockSessionList = false, releaseList, noteListStarted, inspections = 0
  const listGate = new Promise(resolve => { releaseList = resolve })
  const listStarted = new Promise(resolve => { noteListStarted = resolve })
  const rpc = async (method, payload) => {
    if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
    if (method === 'session/list') { if (blockSessionList) { noteListStarted(); await listGate; throw new Error('late session/list failure') } return { items: [] } }
    if (method === 'session/create') return { sessionId: requestOf(payload).sessionId }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') { const error = new Error('prompt transport uncertain'); error.code = 'HOST_PROMPT_FAILED'; error.definitive = true; throw error }
    throw new Error(method)
  }
  const inspectRuntimePrompt = async ({ requestId, decision }) => { inspections += 1; return decision === undefined ? null : { delivered: true, source: 'session/follow', rpcId: requestId } }
  value = await fixture({ inspectRuntimePrompt }, rpc)
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a), binding = await value.resolve('a', 'reconcile-race-root'), input = value.launch(binding, 'a6', 'reconcile-race-root')
    assert.equal((await value.service.handleRequest(input)).state, 'outcome_unknown')
    const envelope = { token: value.auth, canonicalProjectKey, callerRootRef: rootRef('reconcile-race-root'), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, operationRef: input.operationRef }
    blockSessionList = true
    const observing = value.service.handleRequest({ action: 'reconcile', ...envelope })
    await listStarted
    const resolving = value.service.handleRequest({ action: 'resolveUnknown', ...envelope, requestId: 'race-delivered', decision: 'delivered', expectedRevision: 1 })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(inspections, 1, 'the prompt decision waits behind the exact in-flight observer')
    releaseList()
    assert.equal((await observing).state, 'outcome_unknown')
    const resolved = await resolving
    assert.equal(resolved.state, 'ready')
    assert.equal(resolved.revision, 2)
    assert.equal(inspections, 2)
    const stored = JSON.parse(await readFile(value.stateFile, 'utf8'))
    assert.equal(stored.operations[0].state, 'ready')
    assert.equal(stored.operations[0].revision, 2)
    assert.equal(stored.operations[0].reconciliation.requestId, 'race-delivered')
  } finally { releaseList(); await cleanup(value) }
})

test('close drains accepted launch and retry requests across the persist-to-enqueue boundary', async () => {
  let value, creates = 0
  value = await fixture({}, async (method, payload) => {
    const request = requestOf(payload)
    if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
    if (method === 'session/list') return { items: [] }
    if (method === 'session/create') { creates += 1; const error = new Error('definitive create rejection'); error.code = 'HOST_SESSION_CREATE_FAILED'; error.definitive = true; throw error }
    if (method === 'session/rename') return { title: request.title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    throw new Error(method)
  })
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a), caller = 'close-persist-root'
    const binding = await value.resolve('a', caller), failedInput = value.launch(binding, 'a1', caller)
    assert.equal((await value.service.handleRequest(failedInput)).state, 'failed')
    const envelope = { token: value.auth, canonicalProjectKey, callerRootRef: rootRef(caller), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef }
    const retry = value.service.handleRequest({ action: 'retry', ...envelope, operationRef: failedInput.operationRef })
    const freshInput = value.launch(binding, 'a2', caller), fresh = value.service.handleRequest(freshInput)
    const closing = value.service.close()
    let timer
    const settled = await Promise.race([
      Promise.all([retry, fresh, closing]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('accepted launch/retry did not settle during close')), 10_000) })
    ]).finally(() => clearTimeout(timer))
    assert.deepEqual(settled.slice(0, 2).map(result => result.state), ['cancelled', 'cancelled'])
    assert.deepEqual({ queued: value.service.diagnostics().queued, running: value.service.diagnostics().running, lanes: value.service.diagnostics().activeProjectLanes }, { queued: 0, running: 0, lanes: 0 })
    assert.equal(creates, 1, 'close-fenced retry and launch never reach a new Host effect')
    const stored = JSON.parse(await readFile(value.stateFile, 'utf8'))
    for (const operationRef of [failedInput.operationRef, freshInput.operationRef]) {
      const operation = stored.operations.find(row => row.operationRef === operationRef)
      assert.deepEqual({ state: operation.state, phase: operation.phase }, { state: 'cancelled', phase: 'cancelled' })
    }
  } finally { await cleanup(value) }
})

test('every concurrent close caller receives and waits for the same drain promise', async () => {
  let value, releaseWorkspace, noteWorkspaceStarted
  const workspaceStarted = new Promise(resolve => { noteWorkspaceStarted = resolve })
  value = await fixture({}, async (method, payload) => {
    const request = requestOf(payload)
    if (method === 'workspace/create') { noteWorkspaceStarted(); await new Promise(resolve => { releaseWorkspace = resolve }); return { workspace: { workspaceId: 'wa', path: value.projects.a } } }
    if (method === 'session/list') return { items: [] }
    if (method === 'session/create') return { sessionId: request.sessionId }
    if (method === 'session/rename') return { title: request.title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    throw new Error(method)
  })
  try {
    const binding = await value.resolve('a', 'shared-close-root')
    const launching = value.service.handleRequest(value.launch(binding, 'a1', 'shared-close-root'))
    await workspaceStarted
    const first = value.service.close(), second = value.service.close()
    assert.equal(first, second)
    let secondDone = false
    void second.then(() => { secondDone = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(secondDone, false, 'no concurrent close caller may return before the accepted launch drains')
    releaseWorkspace(); releaseWorkspace = undefined
    assert.equal((await launching).state, 'ready')
    await Promise.all([first, second])
    assert.equal(secondDone, true)
  } finally { releaseWorkspace?.(); await cleanup(value) }
})

test('close destroys an accepted half-frame socket instead of waiting forever for a newline', async () => {
  const value = await fixture({ socketIdleTimeoutMs: 60_000 })
  let socket
  try {
    socket = net.createConnection(value.service.endpoint)
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    const disconnected = new Promise(resolve => socket.once('close', resolve))
    socket.write('{')
    for (let attempt = 0; attempt < 100 && value.service.diagnostics().acceptedSockets !== 1; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(value.service.diagnostics().acceptedSockets, 1, 'the real named-pipe connection reached the Host frame reader')
    const closing = value.service.close()
    let timer
    await Promise.race([
      closing,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('half-frame socket blocked Host close')), 1_000) })
    ]).finally(() => clearTimeout(timer))
    await disconnected
    assert.equal(value.service.diagnostics().acceptedSockets, 0)
  } finally { socket?.destroy(); await cleanup(value) }
})

test('an accepted incomplete frame is evicted by the bounded socket idle timeout', async () => {
  const value = await fixture({ socketIdleTimeoutMs: 25 })
  let socket
  try {
    socket = net.createConnection(value.service.endpoint)
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    const disconnected = new Promise(resolve => socket.once('close', resolve))
    socket.write('{')
    let timer
    await Promise.race([
      disconnected,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('incomplete frame outlived the idle timeout')), 1_000) })
    ]).finally(() => clearTimeout(timer))
    for (let attempt = 0; attempt < 100 && value.service.diagnostics().acceptedSockets !== 0; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(value.service.diagnostics().acceptedSockets, 0)
  } finally { socket?.destroy(); await cleanup(value) }
})

test('the live operation slot index rejects a foreign-root reservation before terminal compaction', async () => {
  let value, releaseWorkspace, noteWorkspaceStarted
  const workspaceStarted = new Promise(resolve => { noteWorkspaceStarted = resolve })
  value = await fixture({}, async (method, payload) => {
    const request = requestOf(payload)
    if (method === 'workspace/create') { noteWorkspaceStarted(); await new Promise(resolve => { releaseWorkspace = resolve }); return { workspace: { workspaceId: 'wa', path: value.projects.a } } }
    if (method === 'session/list') return { items: [] }
    if (method === 'session/create') return { sessionId: request.sessionId }
    if (method === 'session/rename') return { title: request.title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    throw new Error(method)
  })
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a)
    const parent = await value.resolve('a', 'slot-parent'), foreign = await value.resolve('a', 'slot-foreign')
    const input = value.launch(parent, 'a1', 'slot-parent'), launching = value.service.handleRequest(input)
    await workspaceStarted
    await assert.rejects(value.service.handleRequest({ action: 'reserveAdoption', token: value.auth, canonicalProjectKey, callerRootRef: rootRef('slot-foreign'), projectTicket: foreign.projectTicket, projectRef: foreign.projectRef, boardRef: foreign.boardRef, batchRef: input.batchRef, slotRef: input.slotRef, operationRef: input.operationRef }), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
    releaseWorkspace(); releaseWorkspace = undefined
    assert.equal((await launching).state, 'ready')
  } finally { releaseWorkspace?.(); await cleanup(value) }
})

test('close waits for a gated prompt reconciliation and no closed instance persists afterward', async () => {
  let value, releaseInspection, noteInspectionStarted
  const inspectionGate = new Promise(resolve => { releaseInspection = resolve })
  const inspectionStarted = new Promise(resolve => { noteInspectionStarted = resolve })
  const rpc = async (method, payload) => {
    if (method === 'workspace/create') return { workspace: { workspaceId: 'wa', path: value.projects.a } }
    if (method === 'session/list') return { items: [] }
    if (method === 'session/create') return { sessionId: requestOf(payload).sessionId }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') { const error = new Error('prompt transport uncertain'); error.code = 'HOST_PROMPT_FAILED'; error.definitive = true; throw error }
    throw new Error(method)
  }
  const inspectRuntimePrompt = async ({ requestId }) => { noteInspectionStarted(); await inspectionGate; return { delivered: true, source: 'session/control', rpcId: requestId } }
  value = await fixture({ inspectRuntimePrompt }, rpc)
  let closePromise
  try {
    const canonicalProjectKey = projectKeyForWorkspace(value.projects.a), binding = await value.resolve('a', 'close-race-root'), input = value.launch(binding, 'a7', 'close-race-root')
    assert.equal((await value.service.handleRequest(input)).state, 'outcome_unknown')
    const resolving = value.service.handleRequest({ action: 'resolveUnknown', token: value.auth, canonicalProjectKey, callerRootRef: rootRef('close-race-root'), projectTicket: binding.projectTicket, projectRef: binding.projectRef, boardRef: binding.boardRef, operationRef: input.operationRef, requestId: 'close-delivered', decision: 'delivered', expectedRevision: 1 })
    await inspectionStarted
    let closeFinished = false
    closePromise = value.service.close().then(() => { closeFinished = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(closeFinished, false, 'close must not return while an accepted reconciliation can still persist')
    releaseInspection()
    assert.equal((await resolving).state, 'ready')
    await closePromise
    const afterClose = await readFile(value.stateFile, 'utf8')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await readFile(value.stateFile, 'utf8'), afterClose, 'the closed instance has no late persistence tail')
    const stored = JSON.parse(afterClose)
    assert.equal(stored.operations[0].state, 'ready')
    assert.equal(stored.operations[0].reconciliation.requestId, 'close-delivered')
  } finally { releaseInspection(); await closePromise?.catch(() => undefined); await cleanup(value) }
})

test('close drains service and invalid token fails closed', async () => {
  const value = await fixture()
  try { await assert.rejects(value.service.handleRequest({ action: 'resolveProject', token: randomBytes(32).toString('base64url'), canonicalProjectKey: projectKeyForWorkspace(value.projects.a), workspacePath: value.projects.a, callerRootRef: rootRef('x') }), error => error.code === 'HOST_SESSION_LAUNCH_UNAVAILABLE'); await value.service.close(); await assert.rejects(value.resolve('a'), error => error.code === 'HOST_SESSION_LAUNCH_UNAVAILABLE') } finally { await rm(value.root, { recursive: true, force: true }) }
})
