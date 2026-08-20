const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

function request(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:9945', origin: 'http://127.0.0.1:9945', ...(method === 'POST' ? { 'x-harness-agent-teams': '1' } : {}) }
  return req
}

function response() {
  let resolve
  const done = new Promise(value => { resolve = value })
  return {
    status: 0,
    headers: {},
    headersSent: false,
    chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers || {}; this.headersSent = true },
    write(chunk) { this.chunks.push(String(chunk)); return true },
    end(chunk = '') { if (chunk) this.chunks.push(String(chunk)); resolve({ status: this.status, body: this.chunks.join(''), headers: this.headers }) },
    done
  }
}

async function invoke(route, req) {
  const res = response()
  await route.handler(req, res)
  return res.done
}

test('per-team operation tails are deleted only after their current settled promise completes', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /TEAM_OPERATION_CHAINS\.set\(key, settled\);[\s\S]*?void settled\.then\(\(\) => \{[\s\S]*?TEAM_OPERATION_CHAINS\.get\(key\) === settled[\s\S]*?TEAM_OPERATION_CHAINS\.delete\(key\)/u)
})

test('model tools create a team, spawn independent members, and relay with non-user authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-runtime-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  try {
    await writeFile(path.join(root, 'harness-desktop-model-routing.json'), `${JSON.stringify({
      schemaVersion: 3,
      main: { provider: 'main-provider', model: 'main-model' },
      subagent: { inheritMain: false, provider: 'sub-provider', model: 'sub-model' },
      basePreset: 'standard'
    }, null, 2)}\n`, 'utf8')
    const mod = await import(`${pathToFileURL(pluginFile).href}?runtime=${Date.now()}`)
    const tools = new Map()
    const routes = new Map()
    const listeners = new Map()
    const promptSections = []
    const followups = []
    const starts = []
    let relayGate
    let relayEntered
    let gracefulGate
    let gracefulEntered
    let gracefulLifecycleRun = 0
    let onGracefulAccepted
    const manualGracefulLifecycleIds = new Set()
    const bufferedGracefulEndIds = new Set()
    const bufferedColdResumeIds = new Set()
    const bufferedColdResumeRuns = new Map()
    let spawnGate
    let spawnEntered
    let forcedChildId
    let failDrain = false
    let deferDrain = false
    let releaseDrain
    let onDrain
    const coldDrainIds = new Set()
    const failGracefulFollowupIds = new Set()
    const failWorkFollowupIds = new Set()
    const drains = []
    let leadAvailable = true
    const rootAgent = {
      id: 'lead-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ] }
    }
    const recoveryAgent = {
      id: 'recovery-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ] }
    }
    let activeInitiator = rootAgent
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
      systemPrompt: { section(section) { promptSections.push(section); return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { setup() },
      on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
      agents: {
        get(id) { if (leadAvailable && id === rootAgent.id) return rootAgent; if (id === recoveryAgent.id) return recoveryAgent },
        roots() { return [...(leadAvailable ? [rootAgent] : []), recoveryAgent] },
        currentInitiator() { return activeInitiator }
      },
      subagents: {
        async startContinuable(spec) {
          starts.push(spec)
          if (spawnGate) {
            spawnEntered()
            await spawnGate
          }
          return { childId: forcedChildId || (starts.length === 1 ? 'worker-session' : `worker-session-${starts.length}`), messageId: `initial-message-${starts.length}` }
        },
        async followup(parent, childId, content, options) {
          followups.push({ parent, childId, content, options })
          const graceful = content?.[0]?.text?.includes('graceful retirement') === true
          if (failGracefulFollowupIds.has(childId) && graceful) throw new Error('graceful followup failed')
          const gatedGraceful = gracefulGate !== undefined && graceful
          if (gatedGraceful) {
            gracefulEntered?.()
            await gracefulGate
          }
          if (graceful && bufferedColdResumeIds.has(childId)) {
            await listeners.get('subagent/end')({ id: childId, runId: `unknown-old-${++gracefulLifecycleRun}`, stopReason: 'completed' })
            const runId = `buffered-cold-resume-${++gracefulLifecycleRun}`
            bufferedColdResumeRuns.set(childId, runId)
            await listeners.get('subagent/start')({ id: childId, runId })
            onGracefulAccepted?.()
            return `accepted-${childId}`
          }
          if (graceful && bufferedGracefulEndIds.has(childId)) {
            await listeners.get('subagent/end')({ id: childId, runId: `buffered-hot-reload-${++gracefulLifecycleRun}`, stopReason: 'completed' })
            return `accepted-${childId}`
          }
          if (graceful && manualGracefulLifecycleIds.has(childId)) {
            onGracefulAccepted?.()
            return `accepted-${childId}`
          }
          if (graceful && !gatedGraceful) {
            const runId = `graceful-lifecycle-${++gracefulLifecycleRun}`
            await listeners.get('subagent/start')({ id: childId, runId })
            await listeners.get('subagent/end')({ id: childId, runId, stopReason: 'completed' })
          }
          if (failWorkFollowupIds.has(childId) && content?.[0]?.text?.includes('Coordinator registration complete')) throw new Error('work followup failed')
          if (relayGate && content?.[0]?.text?.includes('Race with shutdown')) {
            relayEntered()
            await relayGate
          }
          return `message-${followups.length}`
        },
        async drainContinuableChildren(parent, childIds) {
          drains.push({ parent, childIds: [...childIds] })
          if (failDrain) throw new Error('drain failed')
          onDrain?.([...childIds])
          if (deferDrain) await new Promise(resolve => { releaseDrain = resolve })
          for (const childId of childIds) {
            if (!coldDrainIds.has(childId) && !childId.startsWith('provisioning:')) await listeners.get('subagent/end')?.({ id: childId, stopReason: 'interrupted' })
          }
        }
      }
    }
    mod.apply(ctx)
    const teamsPrompt = promptSections.find(section => section.name === 'tool:agent-teams')
    assert.equal(typeof teamsPrompt.text, 'function')
    const disabledPrompt = teamsPrompt.text({})
    assert.match(disabledPrompt, /automatic-team mode is DISABLED/u)
    assert.match(disabledPrompt, /Do not proactively call any team tool/u)
    assert.match(disabledPrompt, /Team members must never create teams/u)

    const settings = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4
    }))
    assert.equal(settings.status, 200)
    const enabledPrompt = teamsPrompt.text({})
    assert.match(enabledPrompt, /automatic-team mode is ENABLED/u)
    assert.match(enabledPrompt, /Only the outermost top-level root lead\/brain evaluates each ordinary direct-user goal using a strict three-level gate/u)
    assert.match(enabledPrompt, /Level 1 — main model: Complete simple, tightly coupled, or non-parallel work alone/u)
    assert.match(enabledPrompt, /Level 2 — ordinary subagent: when only one auxiliary executor is needed, use an official normal subagent or subagent_fork even if that single helper must be continuable or work across multiple turns/u)
    assert.match(enabledPrompt, /Level 3 — Agent Team: in automatic mode, proactively call team_start only when the goal normally has at least two sustained, genuinely independent workstreams that need delegation to different visible managed members/u)
    assert.match(enabledPrompt, /root\/lead's own work or coordination does not count as the second workstream/u)
    assert.match(enabledPrompt, /explicit user request for a team may still be followed, but automatic mode must not create a one-worker team/u)
    assert.match(enabledPrompt, /Parallelism by itself is not enough for a team/u)
    assert.match(enabledPrompt, /user does not need to say ‘create a team’/u)
    assert.match(enabledPrompt, /Never create a team merely to fill seats, demonstrate the feature/u)
    assert.match(enabledPrompt, /plain 2–12 character duty name in the user's language/u)
    assert.match(enabledPrompt, /For Chinese, prefer 2–6 characters/u)
    for (const name of ['界面', '安全', '测试', '文档', 'UI', 'Test', 'Security', 'Docs', '宿主', '协调器', '执行器', '实现者', '子代理', 'Host', 'Coordinator', 'Executor', 'Implementer', 'Subagent']) assert.match(enabledPrompt, new RegExp(name, 'u'))
    assert.match(enabledPrompt, /active team's objective needs another delegation, it must be added as a visible managed member rather than a hidden ordinary subagent/u)
    assert.match(enabledPrompt, /Managed team members must never create teams or fan out through subagent, subagent_fork, workflow, or ralph/u)
    assert.match(enabledPrompt, /report that need to the root, which decides whether to spawn another visible member under maxActiveTurns/u)
    assert.match(tools.get('team_start').description, /Automatic use normally requires at least two sustained independent workstreams delegated to different visible workers; the lead does not count/u)
    assert.match(tools.get('team_start').description, /one continuable helper should use ordinary subagent instead/u)
    assert.match(tools.get('team_start').description, /explicit user team request may override this automatic threshold/u)

    const started = await tools.get('team_start').execute({ objective: 'Implement and verify collaboration' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(started.ok, true)
    assert.equal(started.team.objective, 'Implement and verify collaboration')
    assert.equal(started.team.members[0].modelTier, 'main')
    assert.equal(started.team.members[0].inheritsMain, false)
    assert.equal(started.team.members[0].routeSource, 'routing-main')
    assert.equal(started.team.members[0].provider, 'main-provider')
    assert.equal(started.team.members[0].model, 'main-model')

    const unsafeDisable = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: false
    }))
    assert.equal(unsafeDisable.status, 409)

    const spawned = await tools.get('team_spawn').execute({
      team_id: started.team.id, name: 'Researcher', role: 'research', prompt: 'Collect evidence', model: 'special-model'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(spawned.ok, true)
    assert.equal(starts.length, 1)
    assert.equal(starts[0].request.parent, rootAgent)
    assert.equal(starts[0].request.agentOptions.provider, 'test-provider')
    assert.equal(starts[0].request.agentOptions.model, 'special-model')
    assert.deepEqual(starts[0].request.toolFilter, { deny: ['subagent', 'subagent_fork', 'workflow', 'ralph'] })
    assert.equal(spawned.member.modelTier, 'subagent')
    assert.equal(spawned.member.inheritsMain, false)
    assert.equal(spawned.member.routeSource, 'live-lead-explicit-model')
    assert.equal(spawned.member.provider, 'test-provider')
    assert.equal(spawned.member.model, 'special-model')
    assert.match(starts[0].request.prompt[0].text, /Do not begin any task/u)
    assert.match(followups[0].content[0].text, /If the assignment needs more parallel work, report that need to the root coordinator/u)
    assert.match(followups[0].content[0].text, /without bypassing maxActiveTurns/u)
    assert.equal(followups[0].options.source.kind, 'coordinator')
    assert.equal(followups[0].childId, 'worker-session')

    const forbiddenWorkerControl = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'worker-session', action: 'member-stop', memberId: 'worker-session', mode: 'retire'
    }))
    assert.equal(forbiddenWorkerControl.status, 403)
    const forbiddenSpoofedLeadControl = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: rootAgent.id, action: 'close', teamId: started.team.id, force: true
    }))
    assert.equal(forbiddenSpoofedLeadControl.status, 403)

    await tools.get('team_message').execute({ team_id: started.team.id, recipient_session_id: 'Researcher', message: 'Verify source B' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(followups[1].options.source.kind, 'coordinator')
    assert.equal(followups[1].options.source.form, 'notice')
    assert.equal(followups[1].options.source.summary, 'Agent Teams')
    assert.equal(followups[1].options.source.senderSessionId, rootAgent.id)
    assert.match(followups[1].content[0].text, /from Lead/u)
    assert.ok(followups.every(item => item.options.source.kind === 'coordinator'))

    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: started.team.id, name: '  ＲＥＳＥＡＲＣＨＥＲ  ', role: 'duplicate', prompt: 'Must not start' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_DUPLICATE_MEMBER_NAME'
    )
    for (const invalidName of ['A', 'ThisWorkerDutyNameIsFarTooLong', 'Subagent', 'Ｓｕｂａｇｅｎｔ', '协调器', 'UI/Docs']) {
      await assert.rejects(
        tools.get('team_spawn').execute({ team_id: started.team.id, name: invalidName, role: 'invalid name', prompt: 'Must not start' }, { agent: rootAgent, signal: new AbortController().signal }),
        error => error && error.code === 'AGENT_TEAMS_INVALID_MEMBER_NAME'
      )
    }
    const projectedTask = await tools.get('team_task_create').execute({
      team_id: started.team.id, title: 'Audit projection', description: 'Host-private task detail', files: ['private/project-plan.md']
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(projectedTask.ok, true)
    const uiStateResponse = await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${rootAgent.id}`))
    assert.equal(uiStateResponse.status, 200)
    const uiState = JSON.parse(uiStateResponse.body)
    const uiEvent = uiState.team.messages.at(-1)
    assert.equal(uiEvent.eventType, 'delivery')
    assert.equal(uiEvent.fromName, 'Lead')
    assert.equal(uiEvent.toName, 'Researcher')
    assert.equal('body' in uiEvent, false)
    assert.equal('text' in uiEvent, false)
    assert.equal('deliveryError' in uiEvent, false)
    const uiTask = uiState.team.tasks.find(task => task.title === 'Audit projection')
    assert.equal(uiTask.summary, 'Audit projection')
    assert.equal(uiTask.fileScopeProjection.projected, false)
    assert.equal('description' in uiTask, false)
    assert.equal('files' in uiTask, false)
    const uiResearcher = uiState.team.members.find(member => member.name === 'Researcher')
    assert.equal(typeof uiResearcher.lastActivityAt, 'string')
    assert.equal(uiResearcher.model, 'special-model')
    assert.equal(uiResearcher.provider, 'test-provider')
    assert.equal(uiResearcher.modelTier, 'subagent')
    assert.equal(uiResearcher.inheritsMain, false)
    assert.equal(uiResearcher.routeSource, 'live-lead-explicit-model')

    const sibling = (await tools.get('team_start').execute({ objective: 'Coordinate peer team' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const peerSpawn = await tools.get('team_spawn').execute({
      team_id: sibling.id, name: 'PeerWorker', role: 'peer collaboration', prompt: 'High-complexity architecture and security review', model_tier: 'main'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(peerSpawn.member.modelTier, 'main')
    assert.equal(peerSpawn.member.inheritsMain, false)
    assert.equal(peerSpawn.member.routeSource, 'routing-main')
    assert.equal(peerSpawn.member.provider, 'main-provider')
    assert.equal(peerSpawn.member.model, 'main-model')
    assert.deepEqual(starts[1].request.agentOptions, { provider: 'main-provider', model: 'main-model' })
    const lowerSharedTurnLimit = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 2
    }))
    assert.equal(lowerSharedTurnLimit.status, 200)
    const costBoundTeam = (await tools.get('team_start').execute({ objective: 'Shared turn ceiling' }, { agent: rootAgent, signal: new AbortController().signal })).team
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: costBoundTeam.id, name: 'CostBound', role: 'cost guard', prompt: 'Must not exceed shared turns' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_ACTIVE_TURN_LIMIT'
    )
    await tools.get('team_shutdown').execute({ team_id: costBoundTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    const restoreSharedTurnLimit = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4
    }))
    assert.equal(restoreSharedTurnLimit.status, 200)
    const multiTeamStatus = await tools.get('team_status').execute({}, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(multiTeamStatus.selectionRequired, true)
    assert.equal(multiTeamStatus.team, null)
    assert.deepEqual(new Set(multiTeamStatus.teams.map(team => team.id)), new Set([started.team.id, sibling.id]))
    for (const summary of multiTeamStatus.teams) {
      assert.deepEqual(Object.keys(summary).sort(), ['activeTaskCount', 'completedTaskCount', 'id', 'memberCount', 'name', 'pendingTaskCount', 'revision', 'status', 'updatedAt'])
      assert.equal('objective' in summary, false)
      assert.equal('members' in summary, false)
      assert.equal('tasks' in summary, false)
      assert.equal('messages' in summary, false)
    }
    const explicitTeamStatus = await tools.get('team_status').execute({ team_id: sibling.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(explicitTeamStatus.selectionRequired, false)
    assert.equal(explicitTeamStatus.team.id, sibling.id)
    assert.equal(explicitTeamStatus.teams.length, 1)
    const peerTask = (await tools.get('team_task_create').execute({
      team_id: sibling.id, title: 'Cross-team integration', cross_team_depends_on: [`${started.team.id}:${projectedTask.task.id}`]
    }, { agent: rootAgent, signal: new AbortController().signal })).task
    assert.deepEqual(peerTask.blockedBy, [`${started.team.id}:${projectedTask.task.id}`])
    assert.deepEqual(peerTask.dependencySources, [{ teamId: started.team.id, teamName: started.team.name, teamStatus: 'active' }])
    assert.equal('files' in peerTask.dependencySources[0], false)
    await assert.rejects(
      tools.get('team_task_update').execute({ team_id: sibling.id, task_id: peerTask.id, action: 'claim' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_TASK_BLOCKED'
    )
    await tools.get('team_task_update').execute({ team_id: started.team.id, task_id: projectedTask.task.id, action: 'claim' }, { agent: rootAgent, signal: new AbortController().signal })
    await tools.get('team_task_update').execute({ team_id: started.team.id, task_id: projectedTask.task.id, action: 'complete' }, { agent: rootAgent, signal: new AbortController().signal })
    const unblockedPeer = await tools.get('team_task_update').execute({ team_id: sibling.id, task_id: peerTask.id, action: 'claim' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.deepEqual(unblockedPeer.task.blockedBy, [])
    const crossTeam = await tools.get('team_message').execute({
      team_id: started.team.id, target_team_id: sibling.id, recipient_session_id: 'PeerWorker', message: 'Coordinate across peer teams'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(crossTeam.message.eventType, 'delivery')
    assert.equal(crossTeam.message.fromTeamId, started.team.id)
    assert.equal(crossTeam.message.toTeamId, sibling.id)
    assert.equal(crossTeam.message.toName, 'PeerWorker')
    assert.equal(followups.at(-1).options.source.kind, 'coordinator')
    const multiState = JSON.parse((await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${rootAgent.id}`))).body)
    assert.equal(multiState.teams.filter(team => team.status !== 'closed').length, 2)
    const sourceProjection = multiState.teams.find(team => team.id === started.team.id)
    const targetProjection = multiState.teams.find(team => team.id === sibling.id)
    assert.equal(sourceProjection.messages.at(-1).toName, 'PeerWorker')
    assert.equal('body' in sourceProjection.messages.at(-1), false)
    assert.equal(targetProjection.inboundEvents.length, 1)
    const inboundEvent = targetProjection.inboundEvents[0]
    assert.equal(inboundEvent.id, crossTeam.message.id)
    assert.equal(inboundEvent.fromTeamId, started.team.id)
    assert.equal(inboundEvent.toTeamId, sibling.id)
    assert.equal(inboundEvent.fromName, 'Lead')
    assert.equal(inboundEvent.toName, 'PeerWorker')
    assert.equal(inboundEvent.fromTeamName, started.team.name)
    assert.equal(inboundEvent.toTeamName, sibling.name)
    assert.ok([...inboundEvent.fromTeamName].length <= 80)
    assert.ok([...inboundEvent.toTeamName].length <= 80)
    assert.deepEqual(Object.keys(inboundEvent).sort(), ['createdAt', 'deliveredAt', 'eventType', 'fromName', 'fromSessionId', 'fromTeamId', 'fromTeamName', 'id', 'status', 'toName', 'toSessionId', 'toTeamId', 'toTeamName'])
    for (const secretField of ['body', 'text', 'message', 'content', 'deliveryError', 'objective', 'tasks', 'members']) assert.equal(secretField in inboundEvent, false)
    const targetWorkerState = JSON.parse((await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${peerSpawn.member.sessionId}`))).body)
    assert.equal(targetWorkerState.team.id, sibling.id)
    assert.equal(targetWorkerState.team.inboundEvents.length, 1)
    assert.deepEqual(targetWorkerState.team.inboundEvents[0], inboundEvent)

    activeInitiator = recoveryAgent
    const foreign = (await tools.get('team_start').execute({ objective: 'Different root isolation' }, { agent: recoveryAgent, signal: new AbortController().signal })).team
    const foreignTask = (await tools.get('team_task_create').execute({ team_id: foreign.id, title: 'Foreign root task' }, { agent: recoveryAgent, signal: new AbortController().signal })).task
    activeInitiator = rootAgent
    await assert.rejects(
      tools.get('team_task_create').execute({
        team_id: sibling.id, title: 'Forbidden cross-root dependency', cross_team_depends_on: [`${foreign.id}:${foreignTask.id}`]
      }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CROSS_TEAM_FORBIDDEN'
    )
    await assert.rejects(
      tools.get('team_message').execute({
        team_id: started.team.id, target_team_id: foreign.id, recipient_session_id: recoveryAgent.id, message: 'Must stay isolated'
      }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CROSS_TEAM_FORBIDDEN'
    )

    let releaseRelay
    relayGate = new Promise(resolve => { releaseRelay = resolve })
    const enteredRelay = new Promise(resolve => { relayEntered = resolve })
    let racingMessageSettled = false
    const racingMessage = tools.get('team_message').execute({ team_id: started.team.id, target_team_id: sibling.id, recipient_session_id: peerSpawn.member.sessionId, message: 'Race with shutdown' }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { racingMessageSettled = true; return value })
    await enteredRelay
    const unrelatedRelayTeam = (await tools.get('team_start').execute({ objective: 'Unrelated relay concurrency' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const unrelatedRelayWorker = await tools.get('team_spawn').execute({ team_id: unrelatedRelayTeam.id, name: 'FreeWorker', role: 'unrelated concurrency', prompt: 'Complete outside relay locks' }, { agent: rootAgent, signal: new AbortController().signal })
    const unrelatedRelayShutdown = await tools.get('team_shutdown').execute({ team_id: unrelatedRelayTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(unrelatedRelayWorker.member.state, 'running')
    assert.equal(unrelatedRelayShutdown.team.state, 'closed')
    assert.equal(racingMessageSettled, false)
    let racingShutdownSettled = false
    const racingShutdown = tools.get('team_shutdown').execute({ team_id: started.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { racingShutdownSettled = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(racingShutdownSettled, false)
    releaseRelay()
    await Promise.all([racingMessage, racingShutdown])
    const persisted = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
    const persistedTeam = persisted.teams.find(team => team.id === started.team.id)
    assert.equal(persistedTeam.state, 'closed')
    assert.equal(persistedTeam.messages.find(message => message.body === 'Race with shutdown').status, 'delivered')
    const closedStateResponse = await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${rootAgent.id}`))
    assert.equal(closedStateResponse.status, 200)
    assert.equal(JSON.parse(closedStateResponse.body).teams.find(team => team.id === started.team.id).status, 'closed')
    await assert.rejects(
      tools.get('team_shutdown').execute({ team_id: started.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CLOSING'
    )

    const readQueueRaceTeam = (await tools.get('team_start').execute({ objective: 'Read queue close race' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const readQueueRaceWorker = (await tools.get('team_spawn').execute({ team_id: readQueueRaceTeam.id, name: 'QueueAudit', role: 'queue race audit', prompt: 'Wait for relay race' }, { agent: rootAgent, signal: new AbortController().signal })).member
    let releaseQueueRelay
    relayGate = new Promise(resolve => { releaseQueueRelay = resolve })
    const enteredQueueRelay = new Promise(resolve => { relayEntered = resolve })
    const blockingQueueMessage = tools.get('team_message').execute({ team_id: readQueueRaceTeam.id, recipient_session_id: readQueueRaceWorker.sessionId, message: 'Race with shutdown while holding queue' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredQueueRelay
    const queuedClose = tools.get('team_shutdown').execute({ team_id: readQueueRaceTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    await new Promise(resolve => setImmediate(resolve))
    const postReadLateMessage = tools.get('team_message').execute({ team_id: readQueueRaceTeam.id, recipient_session_id: readQueueRaceWorker.sessionId, message: 'Must not deliver after queued close' }, { agent: rootAgent, signal: new AbortController().signal })
    const postReadLateOutcome = postReadLateMessage.then(value => ({ value }), error => ({ error }))
    await new Promise(resolve => setImmediate(resolve))
    releaseQueueRelay()
    await blockingQueueMessage
    await queuedClose
    const lateOutcome = await postReadLateOutcome
    assert.equal(lateOutcome.error?.code, 'AGENT_TEAMS_CLOSING')
    relayGate = undefined
    relayEntered = undefined
    assert.equal(followups.some(followup => followup.content?.[0]?.text?.includes('Must not deliver after queued close')), false)

    const memberRetireOrderTeam = (await tools.get('team_start').execute({ objective: 'Member retirement queue ordering' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const memberRetireOrderWorker = (await tools.get('team_spawn').execute({ team_id: memberRetireOrderTeam.id, name: 'OrderAudit', role: 'retirement ordering', prompt: 'Wait for ordered retirement' }, { agent: rootAgent, signal: new AbortController().signal })).member
    let releaseMemberOrderRelay
    relayGate = new Promise(resolve => { releaseMemberOrderRelay = resolve })
    const enteredMemberOrderRelay = new Promise(resolve => { relayEntered = resolve })
    const memberOrderRelay = tools.get('team_message').execute({ team_id: memberRetireOrderTeam.id, recipient_session_id: memberRetireOrderWorker.sessionId, message: 'Race with shutdown before member retirement' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredMemberOrderRelay
    let memberRetirementSettled = false
    const orderedMemberRetirement = tools.get('team_shutdown').execute({ team_id: memberRetireOrderTeam.id, member_session_id: memberRetireOrderWorker.sessionId, force: true }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { memberRetirementSettled = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(memberRetirementSettled, false)
    releaseMemberOrderRelay()
    await memberOrderRelay
    const orderedRetirementResult = await orderedMemberRetirement
    assert.equal(orderedRetirementResult.member.state, 'retired')
    relayGate = undefined
    relayEntered = undefined
    await tools.get('team_shutdown').execute({ team_id: memberRetireOrderTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const secondTeam = (await tools.get('team_start').execute({ objective: 'Spawn shutdown race' }, { agent: rootAgent, signal: new AbortController().signal })).team
    let releaseSpawn
    spawnGate = new Promise(resolve => { releaseSpawn = resolve })
    const enteredSpawn = new Promise(resolve => { spawnEntered = resolve })
    const racingSpawn = tools.get('team_spawn').execute({ team_id: secondTeam.id, name: 'Builder', role: 'Build', prompt: 'Wait for publication' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredSpawn
    let shutdownDuringSpawnSettled = false
    const shutdownDuringSpawn = tools.get('team_shutdown').execute({ team_id: secondTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { shutdownDuringSpawnSettled = true; return value })
    const peerRelayDuringStart = tools.get('team_message').execute({ team_id: sibling.id, recipient_session_id: peerSpawn.member.sessionId, message: 'Other team remains responsive during start' }, { agent: rootAgent, signal: new AbortController().signal })
    let startRelayTimeout
    const peerRelaySettledBeforeStartRelease = await Promise.race([
      peerRelayDuringStart.then(() => true),
      new Promise(resolve => { startRelayTimeout = setTimeout(() => resolve(false), 1_000) })
    ])
    clearTimeout(startRelayTimeout)
    assert.equal(peerRelaySettledBeforeStartRelease, true)
    assert.equal(shutdownDuringSpawnSettled, false)
    releaseSpawn()
    const [spawnRaceOutcome, shutdownRaceOutcome] = await Promise.allSettled([racingSpawn, shutdownDuringSpawn])
    await peerRelayDuringStart
    assert.equal(spawnRaceOutcome.status, 'fulfilled')
    assert.equal(shutdownRaceOutcome.status, 'fulfilled')
    const afterSpawnRace = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === secondTeam.id)
    const racedBuilder = afterSpawnRace.members.find(member => member.name === 'Builder')
    assert.equal(afterSpawnRace.state, 'closed')
    assert.equal(racedBuilder.state, 'retired')
    assert.ok(!racedBuilder.sessionId.startsWith('provisioning:'))
    assert.ok(drains.some(drain => drain.childIds.includes(racedBuilder.sessionId)))
    assert.equal(drains.some(drain => drain.childIds.some(childId => childId.startsWith('provisioning:'))), false)
    assert.equal(followups.some(followup => followup.content?.[0]?.text?.includes('Wait for publication')), true)

    spawnGate = undefined

    const duplicateChildTeam = (await tools.get('team_start').execute({ objective: 'Duplicate child id safety' }, { agent: rootAgent, signal: new AbortController().signal })).team
    forcedChildId = 'worker-session'
    const drainsBeforeDuplicate = drains.length
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: duplicateChildTeam.id, name: 'IdSafety', role: 'id safety test', prompt: 'Never drain the existing child' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CONFLICT'
    )
    forcedChildId = undefined
    assert.equal(drains.length, drainsBeforeDuplicate)
    const duplicateChildRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === duplicateChildTeam.id)
    assert.equal(duplicateChildRecord.members.find(member => member.name === 'IdSafety').state, 'retired')
    assert.match(duplicateChildRecord.members.find(member => member.name === 'IdSafety').error, /existing child was not drained/u)
    await tools.get('team_shutdown').execute({ team_id: duplicateChildTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const publicationFailureTeam = (await tools.get('team_start').execute({ objective: 'Publication rollback drain' }, { agent: rootAgent, signal: new AbortController().signal })).team
    let releasePublicationStart
    spawnGate = new Promise(resolve => { releasePublicationStart = resolve })
    const enteredPublicationStart = new Promise(resolve => { spawnEntered = resolve })
    deferDrain = true
    let publicationDrainRequestedResolve
    const publicationDrainRequested = new Promise(resolve => { publicationDrainRequestedResolve = resolve })
    onDrain = publicationDrainRequestedResolve
    const publicationFailureSpawn = tools.get('team_spawn').execute({ team_id: publicationFailureTeam.id, name: 'PublishTest', role: 'publication test', prompt: 'Never publish this work' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredPublicationStart
    const publicationConflictDocument = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
    publicationConflictDocument.teams.find(team => team.id === publicationFailureTeam.id).members.find(member => member.name === 'PublishTest').state = 'failed'
    await writeFile(path.join(root, 'storages', 'agent_teams.json'), `${JSON.stringify(publicationConflictDocument, null, 2)}\n`, 'utf8')
    releasePublicationStart()
    await publicationDrainRequested
    onDrain = undefined
    const peerRelayDuringPublicationDrain = tools.get('team_message').execute({ team_id: sibling.id, recipient_session_id: peerSpawn.member.sessionId, message: 'Other team remains responsive during publication rollback' }, { agent: rootAgent, signal: new AbortController().signal })
    let publicationRelayTimeout
    const publicationRelaySettledBeforeDrain = await Promise.race([
      peerRelayDuringPublicationDrain.then(() => true),
      new Promise(resolve => { publicationRelayTimeout = setTimeout(() => resolve(false), 1_000) })
    ])
    clearTimeout(publicationRelayTimeout)
    releaseDrain()
    await assert.rejects(publicationFailureSpawn, error => error && error.code === 'AGENT_TEAMS_SPAWN_FAILED')
    await peerRelayDuringPublicationDrain
    assert.equal(publicationRelaySettledBeforeDrain, true)
    spawnGate = undefined
    deferDrain = false
    releaseDrain = undefined
    const publicationFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === publicationFailureTeam.id)
    const unpublishedMember = publicationFailureRecord.members.find(member => member.name === 'PublishTest')
    assert.equal(unpublishedMember.state, 'failed')
    assert.equal(unpublishedMember.shutdownUnconfirmed, undefined)
    assert.equal(unpublishedMember.stopUnconfirmed, undefined)
    assert.match(unpublishedMember.error, /after confirmed drain/u)
    assert.equal(followups.some(followup => followup.content?.[0]?.text?.includes('Never publish this work')), false)
    await tools.get('team_shutdown').execute({ team_id: publicationFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const unconfirmedPublicationTeam = (await tools.get('team_start').execute({ objective: 'Unconfirmed publication rollback' }, { agent: rootAgent, signal: new AbortController().signal })).team
    let releaseUnconfirmedPublicationStart
    spawnGate = new Promise(resolve => { releaseUnconfirmedPublicationStart = resolve })
    const enteredUnconfirmedPublicationStart = new Promise(resolve => { spawnEntered = resolve })
    failDrain = true
    const unconfirmedPublicationSpawn = tools.get('team_spawn').execute({ team_id: unconfirmedPublicationTeam.id, name: 'DrainAudit', role: 'drain audit', prompt: 'Never publish after failed cleanup' }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredUnconfirmedPublicationStart
    const unconfirmedConflictDocument = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
    unconfirmedConflictDocument.teams.find(team => team.id === unconfirmedPublicationTeam.id).members.find(member => member.name === 'DrainAudit').state = 'failed'
    await writeFile(path.join(root, 'storages', 'agent_teams.json'), `${JSON.stringify(unconfirmedConflictDocument, null, 2)}\n`, 'utf8')
    releaseUnconfirmedPublicationStart()
    await assert.rejects(unconfirmedPublicationSpawn, error => error && error.code === 'AGENT_TEAMS_SPAWN_FAILED')
    failDrain = false
    spawnGate = undefined
    const unconfirmedPublicationRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === unconfirmedPublicationTeam.id)
    const unconfirmedPublicationMember = unconfirmedPublicationRecord.members.find(member => member.name === 'DrainAudit')
    assert.equal(unconfirmedPublicationMember.state, 'failed')
    assert.equal(unconfirmedPublicationMember.shutdownUnconfirmed, true)
    assert.equal(unconfirmedPublicationMember.stopUnconfirmed, true)
    assert.match(unconfirmedPublicationMember.error, /publication failed after child creation/u)
    assert.match(unconfirmedPublicationMember.error, /cleanup drain failed: Error: drain failed/u)
    assert.equal(followups.some(followup => followup.content?.[0]?.text?.includes('Never publish after failed cleanup')), false)
    leadAvailable = false
    activeInitiator = recoveryAgent
    await assert.rejects(
      tools.get('team_recover').execute({ team_id: unconfirmedPublicationTeam.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_SHUTDOWN_UNCONFIRMED'
    )
    leadAvailable = true
    activeInitiator = rootAgent
    await tools.get('team_shutdown').execute({ team_id: unconfirmedPublicationTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const workFailureTeam = (await tools.get('team_start').execute({ objective: 'Work followup cleanup' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const expectedWorkFailureChild = starts.length === 0 ? 'worker-session' : `worker-session-${starts.length + 1}`
    failWorkFollowupIds.add(expectedWorkFailureChild)
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: workFailureTeam.id, name: 'WorkAudit', role: 'work failure audit', prompt: 'Fail the first work followup' }, { agent: rootAgent, signal: new AbortController().signal }),
      /work followup failed/u
    )
    failWorkFollowupIds.delete(expectedWorkFailureChild)
    let workFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === workFailureTeam.id)
    let workFailureMember = workFailureRecord.members.find(member => member.name === 'WorkAudit')
    assert.equal(workFailureMember.sessionId, expectedWorkFailureChild)
    assert.equal(workFailureMember.state, 'failed')
    assert.equal(workFailureMember.shutdownUnconfirmed, undefined)
    assert.equal(workFailureMember.stopUnconfirmed, undefined)
    assert.match(workFailureMember.error, /initial work followup failed after child became live after confirmed drain/u)
    await tools.get('team_shutdown').execute({ team_id: workFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const unconfirmedWorkFailureTeam = (await tools.get('team_start').execute({ objective: 'Unconfirmed work followup cleanup' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const expectedUnconfirmedWorkChild = starts.length === 0 ? 'worker-session' : `worker-session-${starts.length + 1}`
    failWorkFollowupIds.add(expectedUnconfirmedWorkChild)
    failDrain = true
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: unconfirmedWorkFailureTeam.id, name: 'WorkDrain', role: 'work drain audit', prompt: 'Fail work and cleanup drain' }, { agent: rootAgent, signal: new AbortController().signal }),
      /work followup failed/u
    )
    failDrain = false
    failWorkFollowupIds.delete(expectedUnconfirmedWorkChild)
    workFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === unconfirmedWorkFailureTeam.id)
    workFailureMember = workFailureRecord.members.find(member => member.name === 'WorkDrain')
    assert.equal(workFailureMember.state, 'failed')
    assert.equal(workFailureMember.shutdownUnconfirmed, true)
    assert.equal(workFailureMember.stopUnconfirmed, true)
    assert.match(workFailureMember.error, /initial work followup failed after child became live/u)
    assert.match(workFailureMember.error, /cleanup drain failed: Error: drain failed/u)
    await tools.get('team_shutdown').execute({ team_id: unconfirmedWorkFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const recoverableTeam = (await tools.get('team_start').execute({ objective: 'Recover failed shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const operatorSpawn = await tools.get('team_spawn').execute({ team_id: recoverableTeam.id, name: 'Operator', role: 'Operate', prompt: 'Stay controllable' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(operatorSpawn.member.modelTier, 'subagent')
    assert.equal(operatorSpawn.member.inheritsMain, false)
    assert.equal(operatorSpawn.member.routeSource, 'routing-subagent')
    assert.equal(operatorSpawn.member.provider, 'sub-provider')
    assert.equal(operatorSpawn.member.model, 'sub-model')
    assert.deepEqual(starts.at(-1).request.agentOptions, { provider: 'sub-provider', model: 'sub-model' })
    failDrain = true
    const failedShutdown = await tools.get('team_shutdown').execute({ team_id: recoverableTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(failedShutdown.team.state, 'active')
    assert.equal(failedShutdown.failures.length, 1)
    const failedMember = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === recoverableTeam.id).members.find(member => member.sessionId === operatorSpawn.member.sessionId)
    assert.equal(failedMember.shutdownUnconfirmed, true)
    assert.equal(failedMember.stopUnconfirmed, true)
    assert.match(failedMember.error, /retirement drain failed/u)
    leadAvailable = false
    activeInitiator = recoveryAgent
    await assert.rejects(
      tools.get('team_recover').execute({ team_id: recoverableTeam.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_SHUTDOWN_UNCONFIRMED'
    )
    leadAvailable = true
    activeInitiator = rootAgent
    failDrain = false
    deferDrain = true
    let retrySettled = false
    let drainRequestedResolve
    const drainRequested = new Promise(resolve => { drainRequestedResolve = resolve })
    onDrain = drainRequestedResolve
    const retryPromise = tools.get('team_shutdown').execute({ team_id: recoverableTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { retrySettled = true; return value })
    await drainRequested
    onDrain = undefined
    assert.equal(retrySettled, false)
    const awaitingEnd = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === recoverableTeam.id).members.find(member => member.sessionId === operatorSpawn.member.sessionId)
    assert.equal(awaitingEnd.state, 'shutting_down')
    assert.equal(awaitingEnd.shutdownUnconfirmed, true)
    const startsBeforeLateSpawn = starts.length
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: recoverableTeam.id, name: 'LateTester', role: 'late spawn test', prompt: 'Must be rejected before reservation' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CLOSING'
    )
    assert.equal(starts.length, startsBeforeLateSpawn)
    const peerRelayDuringDrain = tools.get('team_message').execute({ team_id: sibling.id, recipient_session_id: peerSpawn.member.sessionId, message: 'Other team remains responsive during drain' }, { agent: rootAgent, signal: new AbortController().signal })
    let peerRelayTimeout
    const peerRelaySettledBeforeDrain = await Promise.race([
      peerRelayDuringDrain.then(() => true),
      new Promise(resolve => { peerRelayTimeout = setTimeout(() => resolve(false), 1_000) })
    ])
    clearTimeout(peerRelayTimeout)
    releaseDrain()
    const retriedShutdown = await retryPromise
    await peerRelayDuringDrain
    deferDrain = false
    releaseDrain = undefined
    assert.equal(peerRelaySettledBeforeDrain, true)
    assert.equal(retriedShutdown.team.state, 'closed')
    const retriedMember = retriedShutdown.team.members.find(member => member.sessionId === operatorSpawn.member.sessionId)
    assert.equal(retriedMember.state, 'retired')
    assert.equal(retriedMember.error, undefined)
    assert.deepEqual(drains.at(-1), { parent: rootAgent, childIds: [operatorSpawn.member.sessionId] })

    const coldTeam = (await tools.get('team_start').execute({ objective: 'Cold child shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const coldMember = (await tools.get('team_spawn').execute({ team_id: coldTeam.id, name: 'ColdTester', role: 'cold shutdown test', prompt: 'Become cold before shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).member
    await listeners.get('subagent/end')({ id: coldMember.sessionId, stopReason: 'completed' })
    const coldReady = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === coldTeam.id).members.find(member => member.sessionId === coldMember.sessionId)
    assert.equal(coldReady.state, 'ready')
    coldDrainIds.add(coldMember.sessionId)
    const coldShutdown = await tools.get('team_shutdown').execute({ team_id: coldTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(coldShutdown.team.state, 'closed')
    assert.equal(coldShutdown.team.members.find(member => member.sessionId === coldMember.sessionId).state, 'retired')
    assert.deepEqual(drains.at(-1), { parent: rootAgent, childIds: [coldMember.sessionId] })

    const memberGracefulFailureTeam = (await tools.get('team_start').execute({ objective: 'Member graceful send failure' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const memberGracefulFailureWorker = (await tools.get('team_spawn').execute({ team_id: memberGracefulFailureTeam.id, name: 'SendAudit', role: 'send failure audit', prompt: 'Remain available for retirement test' }, { agent: rootAgent, signal: new AbortController().signal })).member
    failGracefulFollowupIds.add(memberGracefulFailureWorker.sessionId)
    await assert.rejects(
      tools.get('team_shutdown').execute({ team_id: memberGracefulFailureTeam.id, member_session_id: memberGracefulFailureWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal }),
      /graceful followup failed/u
    )
    let gracefulFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === memberGracefulFailureTeam.id)
    let gracefulFailureMember = gracefulFailureRecord.members.find(member => member.sessionId === memberGracefulFailureWorker.sessionId)
    assert.equal(gracefulFailureMember.state, 'failed')
    assert.equal(gracefulFailureMember.shutdownUnconfirmed, true)
    assert.equal(gracefulFailureMember.stopUnconfirmed, true)
    leadAvailable = false
    activeInitiator = recoveryAgent
    await assert.rejects(
      tools.get('team_recover').execute({ team_id: memberGracefulFailureTeam.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_SHUTDOWN_UNCONFIRMED'
    )
    leadAvailable = true
    activeInitiator = rootAgent
    failGracefulFollowupIds.delete(memberGracefulFailureWorker.sessionId)
    let releaseGraceful
    gracefulGate = new Promise(resolve => { releaseGraceful = resolve })
    const enteredGraceful = new Promise(resolve => { gracefulEntered = resolve })
    const gracefulRetry = tools.get('team_shutdown').execute({ team_id: memberGracefulFailureTeam.id, member_session_id: memberGracefulFailureWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal })
    await enteredGraceful
    await listeners.get('subagent/start')({ id: memberGracefulFailureWorker.sessionId, runId: 'retirement-followup-run' })
    gracefulFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === memberGracefulFailureTeam.id)
    gracefulFailureMember = gracefulFailureRecord.members.find(member => member.sessionId === memberGracefulFailureWorker.sessionId)
    assert.equal(gracefulFailureMember.state, 'shutting_down')
    assert.equal(gracefulFailureMember.runId, 'retirement-followup-run')
    assert.match(gracefulFailureMember.error, /graceful followup failed/u)
    assert.equal(gracefulFailureMember.shutdownUnconfirmed, true)
    assert.equal(gracefulFailureMember.stopUnconfirmed, true)
    await listeners.get('subagent/end')({ id: memberGracefulFailureWorker.sessionId, runId: 'retirement-followup-run', stopReason: 'completed' })
    gracefulFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === memberGracefulFailureTeam.id)
    gracefulFailureMember = gracefulFailureRecord.members.find(member => member.sessionId === memberGracefulFailureWorker.sessionId)
    assert.equal(gracefulFailureMember.state, 'shutting_down')
    assert.equal(gracefulFailureMember.runId, undefined)
    assert.match(gracefulFailureMember.error, /graceful followup failed/u)
    assert.equal(gracefulFailureMember.shutdownUnconfirmed, true)
    assert.equal(gracefulFailureMember.stopUnconfirmed, true)
    releaseGraceful()
    await gracefulRetry
    gracefulGate = undefined
    gracefulEntered = undefined
    gracefulFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === memberGracefulFailureTeam.id)
    gracefulFailureMember = gracefulFailureRecord.members.find(member => member.sessionId === memberGracefulFailureWorker.sessionId)
    assert.equal(gracefulFailureMember.state, 'retired')
    assert.equal(gracefulFailureMember.error, undefined)
    assert.equal(gracefulFailureMember.shutdownUnconfirmed, undefined)
    assert.equal(gracefulFailureMember.stopUnconfirmed, undefined)
    await tools.get('team_shutdown').execute({ team_id: memberGracefulFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const coldResumeGracefulTeam = (await tools.get('team_start').execute({ objective: 'Cold resume graceful lifecycle wait' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const coldResumeGracefulWorker = (await tools.get('team_spawn').execute({ team_id: coldResumeGracefulTeam.id, name: 'ColdResumeAudit', role: 'cold resume audit', prompt: 'Wait for disposal race test' }, { agent: rootAgent, signal: new AbortController().signal })).member
    await listeners.get('subagent/start')({ id: coldResumeGracefulWorker.sessionId, runId: 'old-resident-run' })
    let releaseColdResumeGraceful
    gracefulGate = new Promise(resolve => { releaseColdResumeGraceful = resolve })
    const enteredColdResumeGraceful = new Promise(resolve => { gracefulEntered = resolve })
    let coldResumeRetirementSettled = false
    const coldResumeRetirement = tools.get('team_shutdown').execute({ team_id: coldResumeGracefulTeam.id, member_session_id: coldResumeGracefulWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { coldResumeRetirementSettled = true; return value })
    await enteredColdResumeGraceful
    await listeners.get('subagent/end')({ id: coldResumeGracefulWorker.sessionId, runId: 'old-resident-run', stopReason: 'completed' })
    await listeners.get('subagent/start')({ id: coldResumeGracefulWorker.sessionId, runId: 'cold-resume-run' })
    releaseColdResumeGraceful()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(coldResumeRetirementSettled, false)
    const awaitingColdResumeEnd = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === coldResumeGracefulTeam.id).members.find(member => member.sessionId === coldResumeGracefulWorker.sessionId)
    assert.equal(awaitingColdResumeEnd.state, 'shutting_down')
    await listeners.get('subagent/end')({ id: coldResumeGracefulWorker.sessionId, runId: 'cold-resume-run', stopReason: 'completed' })
    const coldResumeRetirementResult = await coldResumeRetirement
    assert.equal(coldResumeRetirementResult.member.state, 'retired')
    gracefulGate = undefined
    gracefulEntered = undefined
    await tools.get('team_shutdown').execute({ team_id: coldResumeGracefulTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const hotReloadGracefulTeam = (await tools.get('team_start').execute({ objective: 'Hot reload graceful lifecycle wait' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const hotReloadGracefulWorker = (await tools.get('team_spawn').execute({ team_id: hotReloadGracefulTeam.id, name: 'LifecycleAudit', role: 'lifecycle wait audit', prompt: 'Wait for graceful lifecycle test' }, { agent: rootAgent, signal: new AbortController().signal })).member
    manualGracefulLifecycleIds.add(hotReloadGracefulWorker.sessionId)
    let gracefulAcceptedResolve
    const gracefulAccepted = new Promise(resolve => { gracefulAcceptedResolve = resolve })
    onGracefulAccepted = gracefulAcceptedResolve
    let hotReloadRetirementSettled = false
    const hotReloadRetirement = tools.get('team_shutdown').execute({ team_id: hotReloadGracefulTeam.id, member_session_id: hotReloadGracefulWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { hotReloadRetirementSettled = true; return value })
    await gracefulAccepted
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(hotReloadRetirementSettled, false)
    const acceptedButActive = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === hotReloadGracefulTeam.id).members.find(member => member.sessionId === hotReloadGracefulWorker.sessionId)
    assert.equal(acceptedButActive.state, 'shutting_down')
    await listeners.get('subagent/end')({ id: hotReloadGracefulWorker.sessionId, runId: 'hot-reload-first-end', stopReason: 'completed' })
    const hotReloadRetirementResult = await hotReloadRetirement
    assert.equal(hotReloadRetirementResult.member.state, 'retired')
    manualGracefulLifecycleIds.delete(hotReloadGracefulWorker.sessionId)
    onGracefulAccepted = undefined
    await tools.get('team_shutdown').execute({ team_id: hotReloadGracefulTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const bufferedHotReloadTeam = (await tools.get('team_start').execute({ objective: 'Buffered hot reload end' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const bufferedHotReloadWorker = (await tools.get('team_spawn').execute({ team_id: bufferedHotReloadTeam.id, name: 'FastEndAudit', role: 'fast end audit', prompt: 'End immediately after acceptance' }, { agent: rootAgent, signal: new AbortController().signal })).member
    bufferedGracefulEndIds.add(bufferedHotReloadWorker.sessionId)
    const bufferedHotReloadRetirement = await tools.get('team_shutdown').execute({ team_id: bufferedHotReloadTeam.id, member_session_id: bufferedHotReloadWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(bufferedHotReloadRetirement.member.state, 'retired')
    bufferedGracefulEndIds.delete(bufferedHotReloadWorker.sessionId)
    await tools.get('team_shutdown').execute({ team_id: bufferedHotReloadTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const unknownColdResumeTeam = (await tools.get('team_start').execute({ objective: 'Unknown active cold resume distinction' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const unknownColdResumeWorker = (await tools.get('team_spawn').execute({ team_id: unknownColdResumeTeam.id, name: 'UnknownRunAudit', role: 'unknown run audit', prompt: 'Distinguish old end from cold resume' }, { agent: rootAgent, signal: new AbortController().signal })).member
    bufferedColdResumeIds.add(unknownColdResumeWorker.sessionId)
    let unknownColdAcceptedResolve
    const unknownColdAccepted = new Promise(resolve => { unknownColdAcceptedResolve = resolve })
    onGracefulAccepted = unknownColdAcceptedResolve
    let unknownColdRetirementSettled = false
    const unknownColdRetirement = tools.get('team_shutdown').execute({ team_id: unknownColdResumeTeam.id, member_session_id: unknownColdResumeWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { unknownColdRetirementSettled = true; return value })
    await unknownColdAccepted
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(unknownColdRetirementSettled, false)
    await listeners.get('subagent/end')({ id: unknownColdResumeWorker.sessionId, runId: bufferedColdResumeRuns.get(unknownColdResumeWorker.sessionId), stopReason: 'completed' })
    const unknownColdRetirementResult = await unknownColdRetirement
    assert.equal(unknownColdRetirementResult.member.state, 'retired')
    bufferedColdResumeIds.delete(unknownColdResumeWorker.sessionId)
    bufferedColdResumeRuns.delete(unknownColdResumeWorker.sessionId)
    onGracefulAccepted = undefined
    await tools.get('team_shutdown').execute({ team_id: unknownColdResumeTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const multiGracefulTeam = (await tools.get('team_start').execute({ objective: 'Multi-worker graceful lifecycle wait' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const multiGracefulA = (await tools.get('team_spawn').execute({ team_id: multiGracefulTeam.id, name: 'GracefulA', role: 'first graceful worker', prompt: 'Wait for first lifecycle end' }, { agent: rootAgent, signal: new AbortController().signal })).member
    const multiGracefulB = (await tools.get('team_spawn').execute({ team_id: multiGracefulTeam.id, name: 'GracefulB', role: 'second graceful worker', prompt: 'Wait for second lifecycle end' }, { agent: rootAgent, signal: new AbortController().signal })).member
    manualGracefulLifecycleIds.add(multiGracefulA.sessionId)
    manualGracefulLifecycleIds.add(multiGracefulB.sessionId)
    let multiAcceptedCount = 0
    let multiAcceptedResolve
    const multiAccepted = new Promise(resolve => { multiAcceptedResolve = resolve })
    onGracefulAccepted = () => { if (++multiAcceptedCount === 2) multiAcceptedResolve() }
    let multiGracefulSettled = false
    const multiGracefulShutdown = tools.get('team_shutdown').execute({ team_id: multiGracefulTeam.id }, { agent: rootAgent, signal: new AbortController().signal }).then(value => { multiGracefulSettled = true; return value })
    await multiAccepted
    await listeners.get('subagent/end')({ id: multiGracefulA.sessionId, runId: 'multi-graceful-a', stopReason: 'completed' })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(multiGracefulSettled, false)
    await listeners.get('subagent/end')({ id: multiGracefulB.sessionId, runId: 'multi-graceful-b', stopReason: 'completed' })
    const multiGracefulResult = await multiGracefulShutdown
    assert.equal(multiGracefulResult.team.state, 'closed')
    assert.equal(multiGracefulResult.team.members.filter(member => member.kind === 'worker').every(member => member.state === 'retired'), true)
    manualGracefulLifecycleIds.delete(multiGracefulA.sessionId)
    manualGracefulLifecycleIds.delete(multiGracefulB.sessionId)
    onGracefulAccepted = undefined

    const wholeGracefulFailureTeam = (await tools.get('team_start').execute({ objective: 'Whole graceful send failure' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const wholeGracefulFailureWorker = (await tools.get('team_spawn').execute({ team_id: wholeGracefulFailureTeam.id, name: 'StopAudit', role: 'stop failure audit', prompt: 'Remain available for whole-team test' }, { agent: rootAgent, signal: new AbortController().signal })).member
    failGracefulFollowupIds.add(wholeGracefulFailureWorker.sessionId)
    const wholeGracefulFailure = await tools.get('team_shutdown').execute({ team_id: wholeGracefulFailureTeam.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(wholeGracefulFailure.team.state, 'active')
    assert.equal(wholeGracefulFailure.failures.length, 1)
    gracefulFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === wholeGracefulFailureTeam.id)
    gracefulFailureMember = gracefulFailureRecord.members.find(member => member.sessionId === wholeGracefulFailureWorker.sessionId)
    assert.equal(gracefulFailureMember.state, 'failed')
    assert.equal(gracefulFailureMember.shutdownUnconfirmed, true)
    assert.equal(gracefulFailureMember.stopUnconfirmed, true)
    failGracefulFollowupIds.delete(wholeGracefulFailureWorker.sessionId)
    await tools.get('team_shutdown').execute({ team_id: wholeGracefulFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const gracefulTeam = (await tools.get('team_start').execute({ objective: 'Graceful shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const gracefulMember = (await tools.get('team_spawn').execute({ team_id: gracefulTeam.id, name: 'Closer', role: 'Close', prompt: 'Finish cleanly' }, { agent: rootAgent, signal: new AbortController().signal })).member
    const gracefulShutdown = await tools.get('team_shutdown').execute({ team_id: gracefulTeam.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(gracefulShutdown.team.state, 'closed')
    assert.equal(gracefulShutdown.team.members.find(member => member.sessionId === gracefulMember.sessionId).state, 'retired')

    await writeFile(path.join(root, 'harness-desktop-model-routing.json'), `${JSON.stringify({
      schemaVersion: 3,
      main: { provider: 'main-provider', model: 'main-model' },
      subagent: { inheritMain: true, provider: 'main-provider', model: 'main-model' },
      basePreset: 'standard'
    }, null, 2)}\n`, 'utf8')
    const inheritedTeam = (await tools.get('team_start').execute({ objective: 'Inherited subagent route' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const inheritedSpawn = await tools.get('team_spawn').execute({ team_id: inheritedTeam.id, name: '继承测试', role: 'test inherited route', prompt: 'Verify inherited main projection' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(inheritedSpawn.member.modelTier, 'subagent')
    assert.equal(inheritedSpawn.member.inheritsMain, true)
    assert.equal(inheritedSpawn.member.routeSource, 'routing-subagent')
    assert.equal(inheritedSpawn.member.provider, 'main-provider')
    assert.equal(inheritedSpawn.member.model, 'main-model')
    await tools.get('team_shutdown').execute({ team_id: inheritedTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    await rm(path.join(root, 'harness-desktop-model-routing.json'), { force: true })
    const fallbackTeam = (await tools.get('team_start').execute({ objective: 'Missing route fallback' }, { agent: rootAgent, signal: new AbortController().signal })).team
    assert.equal(fallbackTeam.members[0].modelTier, 'main')
    assert.equal(fallbackTeam.members[0].inheritsMain, false)
    assert.equal(fallbackTeam.members[0].routeSource, 'live-lead')
    assert.equal(fallbackTeam.members[0].provider, 'test-provider')
    assert.equal(fallbackTeam.members[0].model, 'test-model')
    const fallbackSpawn = await tools.get('team_spawn').execute({
      team_id: fallbackTeam.id, name: 'Docs', role: 'fallback', prompt: 'Safely inherit the runtime default'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(fallbackSpawn.member.modelTier, 'subagent')
    assert.equal(fallbackSpawn.member.inheritsMain, true)
    assert.equal(fallbackSpawn.member.routeSource, 'live-lead')
    assert.equal(fallbackSpawn.member.provider, 'test-provider')
    assert.equal(fallbackSpawn.member.model, 'test-model')
    assert.deepEqual(starts.at(-1).request.agentOptions, { provider: 'test-provider', model: 'test-model' })
    const longButValidName = await tools.get('team_spawn').execute({ team_id: fallbackTeam.id, name: 'IntegrationTesting', role: 'integration testing', prompt: 'Verify Unicode code-point name boundary' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(longButValidName.member.name, 'IntegrationTesting')
    await tools.get('team_shutdown').execute({ team_id: fallbackTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(drains.at(-1).parent, rootAgent)
    assert.deepEqual(new Set(drains.at(-1).childIds), new Set([fallbackSpawn.member.sessionId, longButValidName.member.sessionId]))
    for (const start of starts) assert.deepEqual(start.request.toolFilter, { deny: ['subagent', 'subagent_fork', 'workflow', 'ralph'] })

    const orphan = (await tools.get('team_start').execute({ objective: 'Recover orphan' }, { agent: rootAgent, signal: new AbortController().signal })).team
    leadAvailable = false
    activeInitiator = recoveryAgent
    const orphanPreview = await tools.get('team_recover').execute({ team_id: orphan.id }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(orphanPreview.candidates.length, 1)
    assert.equal(orphanPreview.recovered.length, 0)
    const orphanRecovery = await tools.get('team_recover').execute({ team_id: orphan.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(orphanRecovery.recovered[0].state, 'closed')
    leadAvailable = true
    activeInitiator = rootAgent
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})
