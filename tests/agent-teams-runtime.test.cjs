const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { Readable } = require('node:stream')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const queueSubagentPrompt = Symbol.for('dsh.subagent.queuePrompt')

function request(method, url, body) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(payload)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:9945', origin: 'http://127.0.0.1:9945', ...(method === 'POST' ? { 'x-harness-agent-teams': '1' } : {}) }
  return req
}

function hostAuthorizedSettingsRequest(body, authorizationId) {
  const req = request('POST', '/api/agent-teams/action', { ...body, hostAuthorizationCapability: authorizationId })
  req.headers['x-harness-agent-teams-authorization'] = authorizationId
  return req
}
const AUTOPILOT_SETTINGS_KEYS = ['enabled', 'maxMembers', 'maxActiveTurns', 'autopilotEnabled', 'autopilotMaxAdditionalRounds']
function autopilotSettingsProof(settings, authorizationEpoch, authorizedAt = Date.now()) {
  return {
    version: 1,
    settingsHash: createHash('sha256').update(JSON.stringify(['agent-teams-autopilot-settings-v1', AUTOPILOT_SETTINGS_KEYS.map(key => settings[key])])).digest('hex'),
    enabled: settings.enabled,
    autopilotEnabled: settings.autopilotEnabled,
    authorizationEpoch,
    authorizedAt
  }
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

function openDirectHumanTurn(agent) {
  const session = agent?.session
  const events = session?.events
  if (!Array.isArray(events)) throw new Error('test fixture agent must expose session events')
  if (typeof session.snapshotEvents !== 'function') session.snapshotEvents = () => events.slice()
  events.push(
    { type: 'turn/end', data: {} },
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } }
  )
}

let teamStartSequence = 0
async function startTeam(tools, args, execution) {
  openDirectHumanTurn(execution.agent)
  teamStartSequence += 1
  return tools.get('team_start').execute({ candidate_workstreams: 2, request_id: `runtime-team-start-${teamStartSequence}`, ...args }, execution)
}

let taskCommandSequence = 0
async function fixedRootTaskUpdate(tools, teamId, taskId, action, execution, extra = {}) {
  const [{ tasks }, status] = await Promise.all([
    tools.get('team_task_list').execute({ team_id: teamId }, execution),
    tools.get('team_status').execute({ team_id: teamId }, execution)
  ])
  const task = tasks.find(candidate => candidate.id === taskId)
  assert.ok(task, `missing task ${taskId}`)
  taskCommandSequence += 1
  return tools.get('team_task_update').execute({
    team_id: teamId,
    task_id: taskId,
    action,
    request_id: `runtime-${action}-${taskCommandSequence}`,
    expected_task_revision: task.revision,
    expected_pause_epoch: status.team.pauseEpoch,
    ...extra
  }, execution)
}

function assertLosslessJson(value) {
  assert.deepEqual(value, JSON.parse(JSON.stringify(value)))
}

async function crossRealDshJsonOutputBoundary(value) {
  const [{ Context }, { SystemPrompt }, { ToolRuntime, defineTool }] = await Promise.all([
    import('@deepseek-ai/cordis'),
    import('@deepseek-ai/dsh-system-prompt'),
    import('@deepseek-ai/dsh-tools')
  ])
  const runtime = new Context()
  runtime.plugin(SystemPrompt)
  runtime.plugin(ToolRuntime)
  await new Promise(resolve => setImmediate(resolve))
  runtime.tools.register(defineTool({
    name: 'agent_teams_output_boundary',
    description: 'Exercise the installed DSH tool output boundary.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
    execute: async () => value
  }))
  return runtime.tools.execute({
    callId: `agent-teams-boundary-${Date.now()}-${Math.random()}`,
    name: 'agent_teams_output_boundary',
    arguments: {},
    signal: new AbortController().signal
  })
}

test('per-team operation tails are deleted only after their current settled promise completes', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /TEAM_OPERATION_CHAINS\.set\(key, settled\);[\s\S]*?void settled\.then\(\(\) => \{[\s\S]*?TEAM_OPERATION_CHAINS\.get\(key\) === settled[\s\S]*?TEAM_OPERATION_CHAINS\.delete\(key\)/u)
})

test('busy lead relays steer inside the active turn instead of queuing delayed ordinary turns', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /if \(lead\.status === "idle"\) lead\.followup\(message\);\s*else lead\.steer\(message\);/u)
  assert.match(source, /relayToLead\(lead, createUserMessage\(\{ content, source: relaySource\(caller\.id\) \}\)\)/u)
  assert.doesNotMatch(source, /await lead\.followup\(createUserMessage/u)
})

test('apply injects one Host wake scheduler into every project task mutation producer', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /task: \{ bind: \(\{ store, actorResolver, now: clock, wakeScheduler \}\)[\s\S]*?wakeScheduler === undefined/u)
  assert.match(source, /task: \{ bind: \(\{ store: taskStore, actorResolver, now: clock \}\)[\s\S]*?wakeScheduler: \(signal\) => projectTaskWakeScheduler\(signal\)/u)
  assert.match(source, /projectTaskWakeScheduler = createProjectTaskWakeScheduler\(ctx, officialCorePorts, ready\)/u)
  assert.match(source, /createProjectTaskSessionRuntimeResolver\(ctx, projectEntryRegistry, projectTaskWakeScheduler\)/u)
  assert.match(source, /new ProjectAutomationWebRuntime\(\{ projectEntry, wakeScheduler: projectTaskWakeScheduler \}\)/u)
  assert.match(source, /new ProjectBusinessSyncRuntime\(\{[\s\S]*?wakeScheduler: projectTaskWakeScheduler/u)
  assert.match(source, /do \{[\s\S]*?state\.pending = false;[\s\S]*?\} while \(state\.pending\)[\s\S]*?if \(state\.pending\) startDrain\(projectRef, state\)/u)
  assert.match(source, /state\.timer = setTimer\([\s\S]*?state\.timer\?\.unref\?\.\(\)/u)
  assert.equal(source.match(/wakeScheduler: projectTaskWakeScheduler/gu)?.length, 3)
})

test('project task wake scheduler fails closed once when Host readiness rejects', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-ready-failure=${Date.now()}-${Math.random()}`)
  const warnings = []
  const ready = Promise.reject(Object.assign(new Error('store unavailable'), { code: 'STORE_UNAVAILABLE' }))
  const scheduler = mod.createProjectTaskWakeScheduler({ logger: { warn(message) { warnings.push(message) } }, agents: { roots() { throw new Error('must not scan roots') } } }, undefined, ready)
  scheduler({ projectRef: 'project-ready-failure' })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /STORE_UNAVAILABLE/u)
})

test('durable project task wakes deliver only to the exact live same-project root and ack every lease', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake=${Date.now()}-${Math.random()}`)
  const projectKey = cwd => {
    let normalized = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
    if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
    return createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  }
  const accepted = []
  const target = { id: 'wake-target', status: 'idle', session: { header: { cwd: 'C:/project-a' } }, async followup(message) { accepted.push(message) } }
  const failed = { id: 'wake-failed', status: 'running', session: { header: { cwd: 'C:/project-a' } }, async steer() { throw new Error('inbox refused') } }
  const foreign = { id: 'wake-foreign', status: 'idle', session: { header: { cwd: 'C:/project-b' } }, async followup() { throw new Error('cross-project wake') } }
  const acknowledgements = []
  const wake = {
    claim() {
      return [
        { wakeRef: 'wake-target-ref', actorRef: 'actor:wake-target' },
        { wakeRef: 'wake-missing-ref', actorRef: 'actor:missing' },
        { wakeRef: 'wake-failed-ref', actorRef: 'actor:wake-failed' }
      ]
    },
    ack(input) { acknowledgements.push(input) }
  }
  const result = await mod.dispatchProjectTaskWakeSignals({ agents: { roots: () => [target, failed, foreign] } }, {
    wake, projectRef: 'project-ref', dispatcherRef: 'dispatcher-ref', canonicalProjectKey: projectKey('C:/project-a'), actorRefForSessionId: id => `actor:${id}`
  })
  assert.deepEqual(result, { claimed: 3, delivered: 1, retryable: 1 })
  assert.match(accepted[0].content[0].text, /wake-target-ref/u)
  assert.equal(accepted[0].source.kind, 'plugin')
  assert.equal(accepted[0].source.plugin, 'dsh-agent-teams')
  assert.equal(accepted[0].source.summary, 'Project tasks')
  assert.deepEqual(acknowledgements.map(entry => [entry.wakeRef, entry.outcome]), [
    ['wake-target-ref', 'delivered'], ['wake-missing-ref', 'not_delivered'], ['wake-failed-ref', 'outcome_unknown']
  ])
})

test('durable project task wake delivery deduplicates inbox and session evidence and fences uncertain enqueue', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-dedup=${Date.now()}-${Math.random()}`)
  const wakeMessage = wakeRef => ({ source: { kind: 'coordinator', summary: 'Project tasks' }, content: [{ type: 'text', text: `[Project task wake ${wakeRef}] already queued` }] })
  const cwd = 'C:/wake-dedup'
  let normalized = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
  if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
  const canonicalProjectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  const wakeSession = events => ({ header: { cwd }, events, snapshotEvents() { return this.events.slice() } })
  const inbox = { id: 'wake-inbox', status: 'idle', session: wakeSession([]), inbox: { nextTurn: [wakeMessage('wake-inbox-ref')], nextStep: [] }, async followup() { throw new Error('duplicate inbox enqueue') } }
  const history = { id: 'wake-history', status: 'running', session: wakeSession([{ type: 'user/message', data: { message: wakeMessage('wake-history-ref') } }]), inbox: { nextTurn: [], nextStep: [] }, async steer() { throw new Error('duplicate history enqueue') } }
  const raced = { id: 'wake-raced', status: 'idle', session: wakeSession([]), inbox: { nextTurn: [], nextStep: [] }, async followup(message) { this.inbox.nextTurn.push(message); throw new Error('accepted before error') } }
  const uncertain = { id: 'wake-uncertain', status: 'idle', session: wakeSession([]), inbox: { nextTurn: [], nextStep: [] }, async followup() { throw new Error('unknown enqueue outcome') } }
  const acknowledgements = []
  const wake = {
    claim() { return [{ wakeRef: 'wake-inbox-ref', actorRef: 'actor:wake-inbox' }, { wakeRef: 'wake-history-ref', actorRef: 'actor:wake-history' }, { wakeRef: 'wake-raced-ref', actorRef: 'actor:wake-raced' }, { wakeRef: 'wake-uncertain-ref', actorRef: 'actor:wake-uncertain' }] },
    ack(input) { acknowledgements.push(input) }
  }
  const result = await mod.dispatchProjectTaskWakeSignals({ agents: { roots: () => [inbox, history, raced, uncertain] } }, { wake, dispatcherRef: 'dedup-dispatcher', canonicalProjectKey, actorRefForSessionId: id => `actor:${id}` })
  assert.deepEqual(result, { claimed: 4, delivered: 3, retryable: 0 })
  assert.deepEqual(acknowledgements.map(entry => [entry.wakeRef, entry.outcome]), [
    ['wake-inbox-ref', 'delivered'], ['wake-history-ref', 'delivered'], ['wake-raced-ref', 'delivered'], ['wake-uncertain-ref', 'outcome_unknown']
  ])
})

test('unknown project wake reconciliation distinguishes exact delivery, complete absence, and truncated history', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-evidence=${Date.now()}-${Math.random()}`)
  const wakeRef = 'wake-reconcile-exact'
  const message = { source: { kind: 'coordinator', summary: 'Project tasks' }, content: [{ type: 'text', text: `[Project task wake ${wakeRef}] exact` }] }
  const completeEvents = []
  const complete = { session: { snapshotEvents: () => completeEvents }, inbox: { nextTurn: [], nextStep: [] } }
  assert.equal(mod.rootProjectTaskWakeEvidence(complete, wakeRef), 'complete_history_absence')
  const missingSnapshot = { session: { events: [{ type: 'user/message', data: { message } }] }, inbox: { nextTurn: [], nextStep: [] } }
  assert.equal(mod.rootProjectTaskWakeEvidence(missingSnapshot, wakeRef), 'unknown', 'legacy Session.events data is never executed as evidence')
  complete.inbox.nextStep.push(message)
  assert.equal(mod.rootProjectTaskWakeEvidence(complete, wakeRef), 'exact_message')
  const truncatedEvents = Array.from({ length: 257 }, () => ({ type: 'turn/end', data: {} }))
  const truncated = { session: { snapshotEvents: () => truncatedEvents }, inbox: { nextTurn: [], nextStep: [] } }
  assert.equal(mod.rootProjectTaskWakeEvidence(truncated, wakeRef), 'unknown', 'a bounded scan never turns incomplete history into negative evidence')
  truncatedEvents.push({ type: 'user/message', data: { message } })
  assert.equal(mod.rootProjectTaskWakeEvidence(truncated, wakeRef), 'exact_message')
})

test('restart reconciles every same-project root waiter before dispatching that project once', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-multi-root-restart=${Date.now()}-${Math.random()}`)
  const cwd = 'C:/wake-shared-project'
  const roots = [
    { id: 'wake-root-a', status: 'idle', session: { header: { cwd } } },
    { id: 'wake-root-b', status: 'running', session: { header: { cwd } } }
  ]
  const calls = []
  const ctx = {
    agents: { roots: () => roots },
    logger: { warn(message) { assert.fail(message) } }
  }
  mod.observeProjectTaskWakeLifecycle(ctx, {}, Promise.resolve(), {
    reconcile: async (_ctx, _entry, root, options) => { calls.push({ rootId: root.id, ...options }) }
  })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(calls, [
    { rootId: 'wake-root-a', dispatch: false },
    { rootId: 'wake-root-b', dispatch: false },
    { rootId: 'wake-root-a', dispatch: true, reconcile: false }
  ])
})

test('project task wake pumps are singleflight per canonical project lane', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-singleflight=${Date.now()}-${Math.random()}`)
  let release
  const gate = new Promise(resolve => { release = resolve })
  let claims = 0
  const target = { id: 'singleflight-target', status: 'idle', session: { header: { cwd: 'C:/singleflight' } }, async followup() { await gate } }
  let normalized = target.session.header.cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
  if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
  const canonicalProjectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  const binding = {
    canonicalProjectKey, dispatcherRef: 'singleflight-dispatcher', actorRefForSessionId: id => `actor:${id}`,
    wake: {
      claim() { claims += 1; return claims === 1 ? [{ wakeRef: 'singleflight-wake', actorRef: 'actor:singleflight-target' }] : [] },
      ack() {}
    }
  }
  const ctx = { agents: { roots: () => [target] } }
  const first = mod.dispatchProjectTaskWakeSignals(ctx, binding)
  await new Promise(resolve => setImmediate(resolve))
  const second = mod.dispatchProjectTaskWakeSignals(ctx, binding)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(claims, 1)
  release()
  await Promise.all([first, second])
  assert.equal(claims, 2)
})

test('direct-human activity unpauses and immediately dispatches durable project task wakes', async () => {
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /scheduleProjectTaskWake\(lead, \{ paused: false, dispatch: true \}\)/u)
})

test('project task wake scheduler retries not-delivered leases on bounded unref timers without losing trailing mutations', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-retry=${Date.now()}-${Math.random()}`)
  const timers = []
  const cleared = []
  let releaseFirst
  const firstGate = new Promise(resolve => { releaseFirst = resolve })
  let pumps = 0
  const scheduler = mod.createProjectTaskWakeScheduler(
    { logger: { warn() {} }, agents: { roots() { return [] } } },
    undefined,
    Promise.resolve(),
    {
      retryBaseMs: 25,
      retryMaxMs: 100,
      pump: async () => {
        pumps += 1
        if (pumps === 1) await firstGate
        return { retryable: pumps < 3 ? 1 : 0 }
      },
      setTimer(callback, delay) {
        const timer = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true } }
        timers.push(timer)
        return timer
      },
      clearTimer(timer) { cleared.push(timer) }
    }
  )
  scheduler({ projectRef: 'project-retry' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pumps, 1)
  scheduler({ projectRef: 'project-retry' })
  releaseFirst()
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pumps, 2, 'mutation arriving during a running pump must drain on the trailing edge')
  assert.equal(timers.length, 1)
  assert.equal(timers[0].delay, 25)
  assert.equal(timers[0].unrefCalled, true)
  assert.equal(cleared.length, 0)
  timers[0].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pumps, 3, 'definitive not-delivered work must retry without another mutation')
  assert.equal(timers.length, 1, 'successful retry must not retain a polling loop')
})

test('project task wake scheduler close cancels delayed retries and apply disposes the scheduler', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-close=${Date.now()}-${Math.random()}`)
  const timers = []
  const cleared = []
  let pumps = 0
  const scheduler = mod.createProjectTaskWakeScheduler(
    { logger: { warn() {} }, agents: { roots() { return [] } } },
    undefined,
    Promise.resolve(),
    {
      pump: async () => { pumps += 1; return { retryable: 1 } },
      setTimer(callback, delay) {
        const timer = { callback, delay, unref() {} }
        timers.push(timer)
        return timer
      },
      clearTimer(timer) { cleared.push(timer) }
    }
  )
  scheduler({ projectRef: 'project-close' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pumps, 1)
  assert.equal(timers.length, 1)
  scheduler.close()
  assert.deepEqual(cleared, [timers[0]])
  timers[0].callback()
  scheduler({ projectRef: 'project-close' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pumps, 1, 'closed scheduler must never pump from stale timers or new mutations')
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /ctx\.effect\(\(\) => \(\) => projectTaskWakeScheduler\.close\(\)\)/u)
})

test('project root recovery scheduler uses bounded backoff, drains exact targets, and cancels stale timers on close', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-root-recovery-scheduler=${Date.now()}-${Math.random()}`)
  const timers = []
  const cleared = []
  const calls = new Map()
  let releaseCancelledPump, markCancelledPumpStarted
  const cancelledPumpGate = new Promise(resolve => { releaseCancelledPump = resolve })
  const cancelledPumpStarted = new Promise(resolve => { markCancelledPumpStarted = resolve })
  const scheduler = mod.createProjectRootRecoveryScheduler(
    { logger: { warn() {} }, agents: { roots() { return [] } } },
    undefined,
    undefined,
    Promise.resolve(),
    {
      retryBaseMs: 25,
      retryMaxMs: 100,
      pump: async target => {
        const count = (calls.get(target.recoveryRef) ?? 0) + 1
        calls.set(target.recoveryRef, count)
        if (target.recoveryRef === 'recovery-cancel-running') { markCancelledPumpStarted(); await cancelledPumpGate }
        return { retryable: target.recoveryRef === 'recovery-close' || count < 3 }
      },
      setTimer(callback, delay) {
        const timer = { callback, delay, unrefCalled: false, unref() { this.unrefCalled = true } }
        timers.push(timer)
        return timer
      },
      clearTimer(timer) { cleared.push(timer) }
    }
  )
  const target = { rootId: 'root-recovery', canonicalProjectKey: 'project-key', recoveryRef: 'recovery-retry' }
  scheduler(target)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.get(target.recoveryRef), 1)
  assert.equal(timers[0].delay, 25)
  assert.equal(timers[0].unrefCalled, true)
  timers[0].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.get(target.recoveryRef), 2)
  assert.equal(timers[1].delay, 50)
  timers[1].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.get(target.recoveryRef), 3)
  assert.equal(scheduler.size(), 0, 'a terminal exact recovery must leave no polling state')

  const cancelledTarget = { ...target, recoveryRef: 'recovery-cancel-running' }
  scheduler(cancelledTarget)
  await cancelledPumpStarted
  scheduler.cancelRoot(cancelledTarget.rootId)
  releaseCancelledPump()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(scheduler.size(), 0)
  assert.equal(timers.length, 2, 'Stop cancellation must fence a late retryable pump result')

  const closeTarget = { ...target, recoveryRef: 'recovery-close' }
  scheduler(closeTarget)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(timers[2].delay, 25)
  await scheduler.close()
  assert.deepEqual(cleared, [timers[2]])
  timers[2].callback()
  scheduler({ ...target, recoveryRef: 'recovery-after-close' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.has('recovery-after-close'), false)
  assert.equal(calls.get('recovery-close'), 1, 'closed scheduler must ignore stale timer callbacks')
  const source = await readFile(pluginFile, 'utf8')
  assert.match(source, /ctx\.effect\(\(\) => \(\) => projectRootRecoveryScheduler\.close\(\)\)/u)
  assert.match(source, /current\.state==="failed"&&current\.revision>=PROJECT_ROOT_RECOVERY_AUTO_EFFECT_REVISION_LIMIT/u)
})

test('project root recovery scheduler enforces the durable effect budget while unknown results remain observer-only', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-root-recovery-budget=${Date.now()}-${Math.random()}`)
  const cwd = 'C:/project-root-recovery-budget'
  let normalized = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
  if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
  const canonicalProjectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  const root = { id: 'root-recovery-budget', status: 'running', session: { header: { cwd }, events: [] } }
  const createFixture = revision => {
    let current = { recoveryRef: `recovery-budget-${revision}`, initiatorActorRef: 'actor-budget', revision, state: 'failed', mode: 'retry', launchRef: `slot-budget-${revision}` }
    const transitions = [], timers = []
    let effects = 0, observations = 0
    const collaboration = {
      getRootRecovery: () => ({ ...current }),
      updateRootRecovery: (_execution, input) => {
        assert.equal(input.expectedRevision, current.revision)
        current = { ...current, state: input.state, revision: current.revision + 1 }
        transitions.push(input.state)
        return { recovery: { ...current } }
      },
      snapshot: () => ({ recoveries: [{ ...current }] })
    }
    const projectSessionLaunch = {
      retryFailedSlot: async (_execution, { slotRef }) => { effects += 1; return { slots: [{ slotRef, state: 'outcome_unknown' }] } },
      slotStatus: async (_execution, { slotRef }) => { observations += 1; return { slots: [{ slotRef, state: 'outcome_unknown' }] } }
    }
    const scheduler = mod.createProjectRootRecoveryScheduler(
      { logger: { warn() {} }, agents: { get: id => id === root.id ? root : undefined, roots: () => [root] } },
      undefined,
      projectSessionLaunch,
      Promise.resolve(),
      {
        retryBaseMs: 25,
        retryMaxMs: 100,
        openRecoveryContext: async (_execution, operation) => operation({ projectRef: 'project-budget', actorRef: 'actor-budget', collaboration, deriveOpaque: () => 'unused' }),
        setTimer(callback, delay) { const timer = { callback, delay, unref() {} }; timers.push(timer); return timer },
        clearTimer() {}
      }
    )
    return { scheduler, timers, transitions, get current() { return current }, get effects() { return effects }, get observations() { return observations } }
  }
  const target = revision => ({ rootId: root.id, canonicalProjectKey, recoveryRef: `recovery-budget-${revision}` })

  const exhausted = createFixture(10)
  exhausted.scheduler(target(10))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(exhausted.effects, 0, 'the persisted revision budget must fence every further retry effect')
  assert.equal(exhausted.observations, 0)
  assert.equal(exhausted.timers.length, 0, 'a permanently failed exhausted recovery must not retain a polling loop')
  assert.equal(exhausted.scheduler.size(), 0)
  await exhausted.scheduler.close()

  const available = createFixture(9)
  available.scheduler(target(9))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(available.effects, 1)
  assert.equal(available.observations, 1)
  assert.deepEqual(available.transitions, ['activated', 'outcome_unknown'])
  assert.equal(available.timers[0].delay, 25)
  available.timers[0].callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(available.effects, 1, 'an unknown outcome may be observed again but must never repeat the effect')
  assert.equal(available.observations, 2)
  assert.equal(available.timers[1].delay, 50)
  await available.scheduler.close()
})

test('explicit Stop removes queued project wakes and fences enqueue resolution before ack', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-stop-race=${Date.now()}-${Math.random()}`)
  let releaseEnqueue, enqueueStarted
  const enqueueGate = new Promise(resolve => { releaseEnqueue = resolve })
  const started = new Promise(resolve => { enqueueStarted = resolve })
  const session = { id: 'wake-stop-root', header: { cwd: 'C:/wake-stop' }, events: [] }
  const inbox = {
    nextTurn: [], nextStep: [],
    remove(id) {
      for (const queue of [this.nextTurn, this.nextStep]) {
        const index = queue.findIndex(message => message.id === id)
        if (index >= 0) { queue.splice(index, 1); return true }
      }
      return false
    }
  }
  const root = {
    id: session.id, session, status: 'idle', inbox, cancel() {},
    async followup(message) { inbox.nextTurn.push(message); enqueueStarted(); await enqueueGate }
  }
  let normalized = session.header.cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
  if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
  const canonicalProjectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  const acknowledgements = []
  const handlers = {}
  const ctx = {
    on(name, handler) { handlers[name] = handler },
    agents: { get: id => id === root.id ? root : undefined, roots: () => [root] },
    logger: { warn() {} }
  }
  mod.observeUserStops(ctx, { activeTeamsForRoot: () => [] }, Promise.resolve(), undefined, undefined)
  const dispatch = mod.dispatchProjectTaskWakeSignals(ctx, {
    canonicalProjectKey, dispatcherRef: 'stop-race-dispatcher', actorRefForSessionId: id => `actor:${id}`,
    wake: { claim: () => [{ wakeRef: 'wake-stop-race', actorRef: `actor:${root.id}` }], ack: input => acknowledgements.push(input) }
  })
  await started
  assert.equal(inbox.nextTurn.length, 1)
  handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  assert.equal(inbox.nextTurn.length, 0, 'Stop must remove queued project wake messages')
  releaseEnqueue()
  const result = await dispatch
  assert.deepEqual(result, { claimed: 1, delivered: 0, retryable: 0 })
  assert.equal(acknowledgements[0].outcome, 'paused')
})

test('Stop after wake claim but before exact-root lookup acknowledges the claimed lease as paused', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-stop-after-claim=${Date.now()}-${Math.random()}`)
  const session = { id: 'wake-stop-after-claim-root', header: { cwd: 'C:/wake-stop-after-claim' }, events: [] }
  const root = { id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [], remove() { return false } }, cancel() {}, async followup() { assert.fail('stopped root must not enqueue') } }
  let normalized = session.header.cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
  if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
  const canonicalProjectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  const handlers = {}
  const acknowledgements = []
  const ctx = {
    on(name, handler) { handlers[name] = handler },
    agents: { get: id => id === root.id ? root : undefined, roots: () => [root] },
    logger: { warn() {} }
  }
  mod.observeUserStops(ctx, { activeTeamsForRoot: () => [] }, Promise.resolve(), undefined, undefined)
  const result = await mod.dispatchProjectTaskWakeSignals(ctx, {
    canonicalProjectKey, dispatcherRef: 'stop-after-claim-dispatcher', actorRefForSessionId: id => `actor:${id}`,
    wake: {
      claim() {
        handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
        return [{ wakeRef: 'wake-stop-after-claim', actorRef: `actor:${root.id}` }]
      },
      ack(input) { acknowledgements.push(input) }
    }
  })
  assert.deepEqual(result, { claimed: 1, delivered: 0, retryable: 0 })
  assert.equal(acknowledgements[0].outcome, 'paused')
})

test('Stop cancels top-level project launch and admission even when the root owns no private Agent Team', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-stop-without-team=${Date.now()}-${Math.random()}`)
  const session = { id: 'project-only-root', header: { cwd: 'C:/project-only-stop' }, events: [] }
  const root = { id: session.id, session, cancel() { assert.fail('private-team inbox cancellation is unnecessary without a team') } }
  const handlers = {}, stopped = [], cancelled = []
  const ctx = {
    on(name, handler) { handlers[name] = handler },
    agents: { get: id => id === root.id ? root : undefined, roots: () => [root] },
    logger: { warn() {} },
  }
  mod.observeUserStops(ctx, { activeTeamsForRoot: () => [] }, Promise.resolve(), { cancelRoot(agent) { cancelled.push(agent.id) } }, { async stopForRoot(rootId, binding) { stopped.push({ rootId, binding }) } })
  handlers['session/event'](session, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(cancelled, [root.id])
  assert.equal(stopped.length, 1)
  assert.equal(stopped[0].rootId, root.id)
  assert.equal(stopped[0].binding.callerRootId, root.id)
})

test('project task wake session evidence scan is bounded to a recent tail window', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?project-task-wake-tail=${Date.now()}-${Math.random()}`)
  const wakeRef = 'wake-old-history'
  const wakeMessage = { source: { kind: 'coordinator', summary: 'Project tasks' }, content: [{ type: 'text', text: `[Project task wake ${wakeRef}] old` }] }
  const cwd = 'C:/wake-tail'
  let normalized = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '').normalize('NFKC')
  if (process.platform === 'win32') normalized = normalized.toLocaleLowerCase('en-US')
  const canonicalProjectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', normalized])).digest('hex')
  let enqueues = 0
  const root = {
    id: 'wake-tail-root', status: 'idle', inbox: { nextTurn: [], nextStep: [] },
    session: { header: { cwd }, events: [{ type: 'user/message', data: { message: wakeMessage } }, ...Array.from({ length: 512 }, () => ({ type: 'assistant/message', data: {} }))], snapshotEvents() { return this.events.slice() } },
    async followup() { enqueues += 1 }
  }
  const acknowledgements = []
  await mod.dispatchProjectTaskWakeSignals({ agents: { roots: () => [root] } }, {
    canonicalProjectKey, dispatcherRef: 'tail-dispatcher', actorRefForSessionId: id => `actor:${id}`,
    wake: { claim: () => [{ wakeRef, actorRef: `actor:${root.id}` }], ack: input => acknowledgements.push(input) }
  })
  assert.equal(enqueues, 1)
  assert.equal(acknowledgements[0].outcome, 'delivered')
})

test('team worker admission is globally bounded, exact-root fair, and run-id precise', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?worker-admission-fairness=${Date.now()}-${Math.random()}`)
  assert.equal(mod.GLOBAL_TEAM_ACTIVE_ACTIVATIONS, 8)
  assert.equal(mod.MAX_TEAM_ADMISSION_QUEUE, 32)
  assert.equal(mod.MAX_TEAM_ADMISSION_QUEUE_PER_ROOT, 8)
  assert.equal(mod.TEAM_ADMISSION_TIMEOUT_MS, 30_000)

  const admission = mod.createTeamTurnAdmission({ limit: 1, maxQueued: 8, maxQueuedPerRoot: 4, waitMs: 1_000 })
  const rootA = { id: 'fair-root-a' }
  const rootB = { id: 'fair-root-b' }
  const order = []
  const start = (root, childId, runId) => admission.run(root, childId, new AbortController().signal, async () => {
    order.push(childId)
    assert.equal(admission.noteStart({ id: childId, runId }), true)
    return childId
  })

  await start(rootA, 'a-1', 'run-a-1')
  const a2 = start(rootA, 'a-2', 'run-a-2')
  const b1 = start(rootB, 'b-1', 'run-b-1')
  const a3 = start(rootA, 'a-3', 'run-a-3')
  const b2 = start(rootB, 'b-2', 'run-b-2')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['a-1'])
  assert.equal(admission.noteEnd({ id: 'a-1', runId: 'stale-run' }), false)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, ['a-1'], 'a stale lifecycle end must not release the active slot')

  assert.equal(admission.noteEnd({ id: 'a-1', runId: 'run-a-1' }), true)
  await a2
  assert.equal(admission.noteEnd({ id: 'a-2', runId: 'run-a-2' }), true)
  await b1
  assert.equal(admission.noteEnd({ id: 'b-1', runId: 'run-b-1' }), true)
  await a3
  assert.equal(admission.noteEnd({ id: 'a-3', runId: 'run-a-3' }), true)
  await b2
  assert.equal(admission.noteEnd({ id: 'b-2', runId: 'run-b-2' }), true)
  assert.deepEqual(order, ['a-1', 'a-2', 'b-1', 'a-3', 'b-2'])
  assert.deepEqual(admission.snapshot(), { active: 0, queued: 0, closed: false, limit: 1, maxQueued: 8, maxQueuedPerRoot: 4, waitMs: 1_000 })
  admission.close()
})

test('team worker admission bounds queues and removes cancelled, timed-out, and closed waiters', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?worker-admission-bounds=${Date.now()}-${Math.random()}`)
  const admission = mod.createTeamTurnAdmission({ limit: 1, maxQueued: 2, maxQueuedPerRoot: 1, waitMs: 20 })
  const blocker = { id: 'queue-blocker' }
  const sameIdOld = { id: 'same-root-id' }
  const sameIdReplacement = { id: 'same-root-id' }
  await admission.run(blocker, 'blocker-child', new AbortController().signal, async () => {
    admission.noteStart({ id: 'blocker-child', runId: 'blocker-run' })
  })

  const abortController = new AbortController()
  const aborted = admission.run(sameIdOld, 'aborted-child', abortController.signal, async () => assert.fail('cancelled work must not start'))
  const abortedCheck = assert.rejects(aborted, error => error?.code === 'AGENT_TEAMS_ADMISSION_CANCELLED')
  abortController.abort()
  await abortedCheck

  const otherRoot = { id: 'other-root' }
  const timeout = admission.run(otherRoot, 'timeout-child', new AbortController().signal, async () => assert.fail('timed-out work must not start'))
  await assert.rejects(timeout, error => error?.code === 'AGENT_TEAMS_ADMISSION_TIMEOUT')

  const replacement = admission.run(sameIdReplacement, 'replacement-child', new AbortController().signal, async () => {
    admission.noteStart({ id: 'replacement-child', runId: 'replacement-run' })
    return 'replacement-admitted'
  })
  const sameRootOverflow = admission.run(sameIdReplacement, 'same-root-overflow', new AbortController().signal, async () => {})
  await assert.rejects(sameRootOverflow, error => error?.code === 'AGENT_TEAMS_ADMISSION_QUEUE_FULL')

  assert.equal(admission.noteEnd({ id: 'blocker-child', runId: 'blocker-run' }), true)
  assert.equal(await replacement, 'replacement-admitted')
  assert.equal(admission.noteEnd({ id: 'replacement-child', runId: 'replacement-run' }), true)

  await admission.run(blocker, 'close-blocker', new AbortController().signal, async () => admission.noteStart({ id: 'close-blocker', runId: 'close-run' }))
  const closedWaiter = admission.run(otherRoot, 'closed-child', new AbortController().signal, async () => assert.fail('closed work must not start'))
  const closedCheck = assert.rejects(closedWaiter, error => error?.code === 'AGENT_TEAMS_ADMISSION_CLOSED')
  admission.close()
  await closedCheck
  await assert.rejects(
    admission.run(blocker, 'close-blocker', new AbortController().signal, async () => assert.fail('closed admission must reject hot delivery too')),
    error => error?.code === 'AGENT_TEAMS_ADMISSION_CLOSED'
  )
  assert.equal(admission.noteEnd({ id: 'close-blocker', runId: 'close-run' }), true)
})

test('expansion boundary overlap is hierarchical, glob-aware, and platform-sensitive', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?expansion-boundaries=${Date.now()}`)
  assert.equal(mod.fileBoundaryOverlap('src', 'src/a.js', { platform: 'linux' }), true)
  assert.equal(mod.fileBoundaryOverlap('src/**', 'src/a.js', { platform: 'linux' }), true)
  assert.equal(mod.fileBoundaryOverlap('src', 'src-a', { platform: 'linux' }), false)
  assert.equal(mod.fileBoundaryOverlap('src', 'src2/a.js', { platform: 'linux' }), false)
  assert.equal(mod.fileBoundaryOverlap('Foo.js', 'foo.js', { platform: 'linux' }), false)
  assert.equal(mod.fileBoundaryOverlap('Src/**', 'src/a.js', { platform: 'linux' }), false)
  assert.equal(mod.fileBoundaryOverlap('Foo.js', 'foo.js', { platform: 'win32' }), true)
  assert.equal(mod.fileBoundaryOverlap('Src/**', 'src/a.js', { platform: 'win32' }), true)
  assert.equal(mod.fileBoundaryOverlap('Foo.js', 'foo.js', { platform: 'linux', caseInsensitive: true }), true)
  assert.equal(mod.resourceBoundaryOverlap('database/orders', 'database/orders/row-1'), true)
  assert.equal(mod.resourceBoundaryOverlap('database/order', 'database/orders'), false)
  const expansionInput = (left, right) => ({
    sourceTaskId: 'source-task',
    parallelBenefit: 'The two isolated files can be checked in parallel.',
    workstreams: [{ title: 'Left', deliverable: 'Left result', acceptance_criteria: 'Left check', files: [left], resources: [] },
      { title: 'Right', deliverable: 'Right result', acceptance_criteria: 'Right check', files: [right], resources: [] }]
  })
  assert.doesNotThrow(() => mod.normalizeExpansionRequest(expansionInput('src', 'src-a'), { platform: 'linux' }))
  assert.doesNotThrow(() => mod.normalizeExpansionRequest(expansionInput('Foo.js', 'foo.js'), { platform: 'linux' }))
  assert.throws(
    () => mod.normalizeExpansionRequest(expansionInput('Foo.js', 'foo.js'), { platform: 'win32' }),
    error => error && error.code === 'AGENT_TEAMS_EXPANSION_CONFLICT'
  )
})

test('new team members re-read the latest tier route instead of using a hard-coded provider', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-team-live-routing-'))
  try {
    const stateDirectory = path.join(root, 'teams')
    const store = { filePath: path.join(stateDirectory, 'agent-teams.json') }
    const routingFile = path.join(root, 'harness-desktop-model-routing.json')
    await writeFile(routingFile, JSON.stringify({
      main: { provider: 'old-main', model: 'main-model' },
      subagent: { inheritMain: false, provider: 'old-sub', model: 'sub-model-a' }
    }))
    const mod = await import(`${pathToFileURL(pluginFile).href}?live-routing=${Date.now()}`)
    const first = await mod.resolveModelSelection(store, 'subagent', undefined, { provider: 'live-lead', model: 'lead-model' })
    assert.equal(first.provider, 'old-sub')
    assert.equal(first.model, 'sub-model-a')
    assert.equal(first.routeSource, 'routing-subagent')

    await writeFile(routingFile, JSON.stringify({
      main: { provider: 'old-main', model: 'main-model' },
      subagent: { inheritMain: false, provider: 'new-sub', model: 'sub-model-b' }
    }))
    const second = await mod.resolveModelSelection(store, 'subagent', undefined, { provider: 'live-lead', model: 'lead-model' })
    assert.equal(second.provider, 'new-sub')
    assert.equal(second.model, 'sub-model-b')
    assert.equal(second.routeSource, 'routing-subagent')
    assert.equal(first.provider, 'old-sub', 'already-created member descriptors remain immutable')

    const main = await mod.resolveModelSelection(store, 'main', undefined, { provider: 'live-lead', model: 'lead-model' })
    assert.equal(main.provider, 'old-main', 'changing only the subagent route must not alter main-tier members')
    assert.equal(main.routeSource, 'routing-main')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model tools create a team, spawn independent members, and relay with non-user authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-runtime-'))
  const previousHome = process.env.DSH_HOME
  const effectCleanups = []
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
    const toolGuards = []
    const provisioningGuardDecisions = []
    const routes = new Map()
    const listeners = new Map()
    const promptSections = []
    const followups = []
    const leadFollowups = []
    const leadSteers = []
    const leadInboxNextTurn = []
    const leadInboxNextStep = []
    const leadInbox = {
      get nextTurn() { return leadInboxNextTurn },
      get nextStep() { return leadInboxNextStep },
      remove(messageId) {
        for (const queue of [leadInboxNextTurn, leadInboxNextStep]) {
          const index = queue.findIndex(message => message.id === messageId)
          if (index >= 0) { queue.splice(index, 1); return true }
        }
        return false
      }
    }
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
    const gracefulStopReasons = new Map()
    const failWorkFollowupIds = new Set()
    const drains = []
    let leadAvailable = true
    const rootAgent = {
      id: 'lead-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { header: { cwd: root }, events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ], snapshotEvents() { return this.events.slice() } },
      inbox: leadInbox,
      followup(message) { leadFollowups.push(message); leadInboxNextTurn.push(message) },
      steer(message) { leadSteers.push(message); leadInboxNextStep.push(message) }
    }
    const workerAgent = {
      id: 'worker-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'agent-message', form: 'relay', senderSessionId: rootAgent.id } } }
      ], snapshotEvents() { return this.events.slice() } }
    }
    const recoveryAgent = {
      id: 'recovery-session', status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      session: { header: { cwd: root }, events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ], snapshotEvents() { return this.events.slice() } }
    }
    let activeInitiator = rootAgent
    let currentGoal
    let autopilotAuthorizationEpoch = 'a'.repeat(32)
    let currentAutopilotSettingsProof = null
    let autopilotAuthorizationEpochRevision = 0
    let autopilotAuthorizationRevocations = 0
    let revocationGoalActivation
    const consumedAutopilotAuthorizations = new Set()
    const autopilotAuthorizationConsumptions = []
    const autopilotAuthorizationProvider = {
      async consumeAutopilotAuthorization(value) {
        if (!/^host-settings-[a-z0-9-]+$/u.test(value.authorizationId)) { const error = new Error('invalid Host authorization'); error.code = 'AGENT_TEAMS_HOST_AUTHORIZATION_INVALID'; throw error }
        if (consumedAutopilotAuthorizations.has(value.authorizationId)) { const error = new Error('replayed Host authorization'); error.code = 'AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY'; throw error }
        consumedAutopilotAuthorizations.add(value.authorizationId)
        autopilotAuthorizationConsumptions.push(structuredClone(value))
        autopilotAuthorizationEpochRevision += 1
        autopilotAuthorizationEpoch = String.fromCharCode(97 + autopilotAuthorizationEpochRevision).repeat(32)
        const issuedAt = Date.now()
        currentAutopilotSettingsProof = autopilotSettingsProof(value.settings, autopilotAuthorizationEpoch, issuedAt)
        return { ...value, tool: 'team_autopilot', desktopBindingHash: 'd'.repeat(64), authorizationEpoch: autopilotAuthorizationEpoch, autopilotSettingsProof: currentAutopilotSettingsProof, issuedAt, expiresAt: issuedAt + 30_000 }
      },
      async readAutopilotAuthorizationState() { return { authorizationEpoch: autopilotAuthorizationEpoch, autopilotSettingsProof: currentAutopilotSettingsProof } },
      async revokeAutopilotAuthorizations() {
        revocationGoalActivation = currentGoal?.activation
        autopilotAuthorizationRevocations += 1
        autopilotAuthorizationEpochRevision += 1
        autopilotAuthorizationEpoch = String.fromCharCode(97 + autopilotAuthorizationEpochRevision).repeat(32)
        currentAutopilotSettingsProof = null
        return { authorizationEpoch: autopilotAuthorizationEpoch, autopilotSettingsProof: currentAutopilotSettingsProof }
      }
    }
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      get: name => name === 'agentTeamsAuthorization' ? autopilotAuthorizationProvider : undefined,
      tools: {
        register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) },
        guard(guard) { toolGuards.push(guard); return () => toolGuards.splice(toolGuards.indexOf(guard), 1) }
      },
      systemPrompt: { section(section) { promptSections.push(section); return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') effectCleanups.push(cleanup) },
      on(event, handler) { listeners.set(event, handler); return () => listeners.delete(event) },
      agents: {
        get(id) { if (leadAvailable && id === rootAgent.id) return rootAgent; if (id === workerAgent.id) return workerAgent; if (id === recoveryAgent.id) return recoveryAgent },
        roots() { return [...(leadAvailable ? [rootAgent] : []), recoveryAgent] },
        currentInitiator() { return activeInitiator }
      },
      goals: {
        get(agent) { return agent === rootAgent ? currentGoal : undefined },
        disarm(agent) { assert.equal(agent, rootAgent); currentGoal = { ...currentGoal, activation: 'disarmed' }; return currentGoal }
      },
      subagents: {
        async startContinuable(spec) {
          starts.push(spec)
          provisioningGuardDecisions.push(toolGuards.map(guard => guard({ name: 'subagent', agent: { id: spec.childId } })).find(Boolean))
          const unknownRestrictedTools = [...(spec.request.toolFilter?.allow || []), ...(spec.request.toolFilter?.deny || [])]
          if (unknownRestrictedTools.length > 0) throw new Error(`tools.restrict() names unknown global tool "${unknownRestrictedTools[0]}"`)
          if (spawnGate) {
            spawnEntered()
            await spawnGate
          }
          const childId = forcedChildId || spec.childId
          if (starts.length === 1 && forcedChildId === undefined) workerAgent.id = childId
          return { childId, messageId: `initial-message-${starts.length}` }
        },
        async [queueSubagentPrompt](parent, childId, content, source, signal) {
          const options = { source, signal }
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
            const runId = `buffered-hot-reload-${++gracefulLifecycleRun}`
            await listeners.get('subagent/start')({ id: childId, runId })
            await listeners.get('subagent/end')({ id: childId, runId, stopReason: 'completed' })
            return `accepted-${childId}`
          }
          if (graceful && manualGracefulLifecycleIds.has(childId)) {
            onGracefulAccepted?.()
            return `accepted-${childId}`
          }
          if (graceful && !gatedGraceful) {
            const runId = `graceful-lifecycle-${++gracefulLifecycleRun}`
            await listeners.get('subagent/start')({ id: childId, runId })
            await listeners.get('subagent/end')({ id: childId, runId, stopReason: gracefulStopReasons.get(childId) || 'completed' })
          }
          if ((failWorkFollowupIds.has(childId) || failWorkFollowupIds.has('*')) && content?.[0]?.text?.includes('Coordinator registration complete')) {
            failWorkFollowupIds.delete('*')
            throw new Error('work followup failed')
          }
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
            if (!coldDrainIds.has(childId) && !childId.startsWith('provisioning:')) {
              const runId = `drain-lifecycle-${++gracefulLifecycleRun}`
              await listeners.get('subagent/start')?.({ id: childId, runId })
              await listeners.get('subagent/end')?.({ id: childId, runId, stopReason: 'interrupted' })
            }
          }
        }
      }
    }
    mod.apply(ctx)
    const rawSpawnTool = tools.get('team_spawn')
    tools.set('team_spawn', {
      ...rawSpawnTool,
      execute: async (args, execution) => {
        if (Array.isArray(args.task_ids) && args.task_ids.length > 0) {
          const status = await tools.get('team_status').execute({ team_id: args.team_id }, execution)
          if (status.team.plan.phase !== 'active') await tools.get('team_plan_commit').execute({ team_id: status.team.id, expected_revision: status.team.plan.revision, confirmed_plan_hash: status.team.plan.hash, permissions_verified: true, files_verified: true, cost_verified: true, external_side_effects_verified: true }, execution)
          try {
            const result = await rawSpawnTool.execute(args, execution)
            try {
              for (const taskId of args.task_ids) {
                await fixedRootTaskUpdate(tools, result.teamId, taskId, 'unassign', execution)
                const claim = await tools.get('team_task_update').execute({ team_id: result.teamId, task_id: taskId, action: 'claim' }, execution)
                await tools.get('team_task_update').execute({ team_id: result.teamId, task_id: taskId, action: 'complete', claim_id: claim.task.claimId, lease_epoch: claim.task.leaseEpoch }, execution)
                await fixedRootTaskUpdate(tools, result.teamId, taskId, 'accept', execution)
              }
            } catch {}
            return result
          } catch (error) { error.message += ` [spawn=${args.name}]`; throw error }
        }
        const created = await tools.get('team_task_create').execute({ team_id: args.team_id, title: `Spawn contract for ${args.name}` }, execution)
        const status = await tools.get('team_status').execute({ team_id: created.teamId }, execution)
        await tools.get('team_plan_commit').execute({ team_id: created.teamId, expected_revision: status.team.plan.revision, confirmed_plan_hash: status.team.plan.hash, permissions_verified: true, files_verified: true, cost_verified: true, external_side_effects_verified: true }, execution)
        try {
          const result = await rawSpawnTool.execute({ ...args, team_id: created.teamId, task_ids: [created.task.id] }, execution)
          try {
            await fixedRootTaskUpdate(tools, result.teamId, created.task.id, 'unassign', execution)
            const claim = await tools.get('team_task_update').execute({ team_id: result.teamId, task_id: created.task.id, action: 'claim' }, execution)
            await tools.get('team_task_update').execute({ team_id: result.teamId, task_id: created.task.id, action: 'complete', claim_id: claim.task.claimId, lease_epoch: claim.task.leaseEpoch }, execution)
            await fixedRootTaskUpdate(tools, result.teamId, created.task.id, 'accept', execution)
          } catch {}
          return result
        } catch (error) { error.message += ` [spawn=${args.name}]`; throw error }
      }
    })
    const teamsPrompt = promptSections.find(section => section.name === 'tool:agent-teams')
    assert.equal(typeof teamsPrompt.text, 'function')
    const disabledPrompt = teamsPrompt.text({})
    assert.match(disabledPrompt, /automatic-team mode is DISABLED/u)
    assert.match(disabledPrompt, /Do not proactively call any team tool/u)
    assert.match(disabledPrompt, /Team members must never create teams/u)

    const memberLimitOnly = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', maxMembers: 5
    }))
    assert.equal(memberLimitOnly.status, 200, memberLimitOnly.body)
    assert.equal(JSON.parse(memberLimitOnly.body).state.config.autopilotEnabled, true, 'an independent member limit Save preserves the default-on preference')
    assert.equal(JSON.parse(memberLimitOnly.body).state.config.maxMembers, 5)
    assert.equal(autopilotAuthorizationConsumptions.length, 0, 'an independent member limit Save never claims automatic-continuation authority')

    const settings = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: false, autopilotMaxAdditionalRounds: 200
    }))
    assert.equal(settings.status, 200, settings.body)
    const enabledSettings = JSON.parse(settings.body).state.config
    assert.equal(enabledSettings.autopilotEnabled, false)
    assert.equal(enabledSettings.autopilotMaxAdditionalRounds, 200)
    const beforeUnauthorizedBudgetChange = autopilotAuthorizationConsumptions.length
    const unscopedBudgetChange = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', autopilotEnabled: false, autopilotMaxAdditionalRounds: 199
    }))
    assert.equal(unscopedBudgetChange.status, 403)
    assert.equal(autopilotAuthorizationConsumptions.length, beforeUnauthorizedBudgetChange, 'budget changes without a one-time Host capability are rejected before receipt consumption')
    const stoppedAutopilot = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', autopilotEnabled: false, autopilotMaxAdditionalRounds: 200
    }))
    assert.equal(stoppedAutopilot.status, 200)
    const stoppedAutopilotSettings = JSON.parse(stoppedAutopilot.body).state.config
    assert.equal(stoppedAutopilotSettings.autopilotEnabled, false)
    assert.equal(stoppedAutopilotSettings.autopilotMaxAdditionalRounds, 200)
    assert.equal(autopilotAuthorizationConsumptions.length, beforeUnauthorizedBudgetChange, 'false remains compatible without Host scope or receipt')
    const invalidAutopilot = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', autopilotEnabled: 'true', autopilotMaxAdditionalRounds: 201
    }))
    assert.equal(invalidAutopilot.status, 400)
    const enabledPrompt = teamsPrompt.text({})
    assert.match(enabledPrompt, /automatic-team mode is ENABLED/u)
    assert.match(enabledPrompt, /Before substantive work on every ordinary direct-human root turn, and before first creating an Agent Team during an exact admitted continuation/u)
    assert.match(enabledPrompt, /When Level 3 conditions are met, choose exactly one creation path in that same authorized turn/u)
    assert.match(enabledPrompt, /Never ask the user to send “continue” merely to cross from an admitted automatic goal round into safe internal team creation/u)
    assert.match(enabledPrompt, /Never call both team_start and team_bootstrap for the same team/u)
    assert.match(enabledPrompt, /Keep durable team task state synchronized at every handoff/u)
    assert.match(enabledPrompt, /members must explicitly complete finished tasks before their final report/u)
    assert.match(enabledPrompt, /Graceful retirement and shutdown require no unfinished owned work/u)
    assert.match(enabledPrompt, /force shutdown records unfinished work as cancelled rather than leaving permanent pending tasks/u)
    assert.match(enabledPrompt, /Only the outermost top-level root lead\/brain evaluates each ordinary direct-user goal using a strict three-level gate/u)
    assert.match(enabledPrompt, /Level 1 — main model: Complete simple, tightly coupled, or non-parallel work alone/u)
    assert.match(enabledPrompt, /Level 2 — ordinary subagent: when only one auxiliary executor is needed, use an official normal subagent or subagent_fork even if that single helper must be continuable or work across multiple turns/u)
    assert.match(enabledPrompt, /Level 3 — Agent Team: in automatic mode, proactively choose one Agent Team creation path only when the goal normally has at least two sustained, genuinely independent workstreams/u)
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
    assert.match(enabledPrompt, /team_expansion_request; the request is a proposal, never authority to spawn/u)
    assert.match(enabledPrompt, /critical-path reduction or independent-review value materially exceeds coordination cost/u)
    assert.match(enabledPrompt, /existing external-resource ownership is not persisted and must be verified by the root/u)
    assert.match(enabledPrompt, /first release\/restructure it so its in-progress file scope no longer overlaps; then call team_task_create for each accepted durable outcome and only then call team_spawn/u)
    assert.match(enabledPrompt, /call team_bootstrap directly with a stable request_id and do not call team_start first/u)
    assert.match(enabledPrompt, /persists all tasks before starting members/u)
    assert.match(enabledPrompt, /first fully successful spawn records publication and activates it/u)
    assert.match(enabledPrompt, /later recommit persists active even after every published worker gracefully retires/u)
    assert.match(enabledPrompt, /Provisioning or initial publication\/work-followup failure never establishes this history/u)
    assert.match(enabledPrompt, /Upgraded retired workers without the new marker qualify only through a task submission\/result or checkpoint bound to their exact historical claim/u)
    assert.match(enabledPrompt, /retired state alone and former-root adoption history do not qualify/u)
    assert.match(enabledPrompt, /same exact live root may recommit a later draft during an automatic goal round without another user message/u)
    assert.match(enabledPrompt, /team remains active and unpaused in the same canonical project/u)
    assert.match(enabledPrompt, /every capability is individually verified, file scopes are conflict-free, cost stays within the direct user's ordinary default AI-routing grant, every effect policy is none/u)
    assert.match(enabledPrompt, /already active main-tier worker does not itself create a new cost grant or block safe continuation/u)
    assert.match(enabledPrompt, /continuing\/default grant stays human_attested and never becomes Host proof/u)
    assert.match(enabledPrompt, /New team creation and bootstrap remain behind the direct-human-or-exact-admitted-goal-round gate/u)
    assert.match(enabledPrompt, /Stop recovery\/resume, handoff\/adopt\/recover, resolve_unknown, cross-project scope/u)
    assert.match(tools.get('team_plan_commit').description, /later automatic goal round may recommit without a new user message only for the same exact live root and canonical project/u)
    assert.match(tools.get('team_plan_commit').description, /Continuing\/default authority remains human_attested, never host_verified/u)
    assert.match(enabledPrompt, /Never invent a leader→group-leader→hidden-worker hierarchy/u)
    assert.match(enabledPrompt, /Every new member re-reads the latest route for its chosen tier/u)
    assert.match(enabledPrompt, /changing the subagent route never changes main-tier members/u)
    assert.match(tools.get('team_spawn').description, /existing members retain their creation route/u)
    assert.match(tools.get('team_start').description, /never call team_start before team_bootstrap for the same team/u)
    assert.match(tools.get('team_bootstrap').description, /Use this directly instead of team_start when the complete plan is ready; never call both for the same team/u)
    assert.match(tools.get('team_route_goal').description, /direct-human goal turn or its exact admitted automatic continuation/u)
    assert.match(tools.get('team_start').description, /Call this in the current authorized root turn as soon as you identify at least two sustained independent workstreams that require visible managed members and ongoing coordination/u)
    assert.match(tools.get('team_start').description, /exact admitted automatic continuation of the root's active, armed goal carries creation authority without another user message/u)
    assert.match(tools.get('team_bootstrap').description, /exact admitted automatic continuation of that root's active, armed goal/u)
    assert.match(tools.get('team_start').description, /do not substitute multiple ordinary subagents/u)
    assert.match(tools.get('team_start').description, /Automatic use normally requires at least two sustained independent workstreams delegated to different visible workers; the lead does not count/u)
    assert.match(tools.get('team_start').description, /one continuable helper should use ordinary subagent instead/u)
    assert.match(tools.get('team_start').description, /explicit user team request may override this automatic threshold/u)
    assert.match(tools.get('team_expansion_request').description, /never spawns, creates tasks, or grants delegation authority/u)
    assert.match(tools.get('team_expansion_request').description, /existing external-resource ownership remains a root approval check/u)
    assert.match(tools.get('team_task_update').description, /Submission remains non-authoritative until the fixed root accepts it/u)
    assert.match(tools.get('team_shutdown').description, /Graceful member retirement rejects unfinished owned tasks/u)
    assert.match(tools.get('team_shutdown').description, /force team shutdown records unfinished tasks as cancelled/u)

    const started = await startTeam(tools, { objective: 'Implement and verify collaboration' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(started.ok, true)
    assert.equal(started.team.objective, 'Implement and verify collaboration')
    assert.equal(started.team.members[0].modelTier, 'main')
    assert.equal(started.team.members[0].inheritsMain, false)
    assert.equal(started.team.members[0].routeSource, 'routing-main')
    assert.equal(started.team.members[0].provider, 'main-provider')
    assert.equal(started.team.members[0].model, 'main-model')

    currentGoal = {
      id: 'goal-host-authorized-autopilot', revision: 1, objective: 'Keep the exact first team moving safely',
      phase: 'active', activation: 'armed', roundsStarted: 1, maxGoalRounds: 3
    }
    const authorizationState = await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${encodeURIComponent(rootAgent.id)}&teamId=${encodeURIComponent(started.team.id)}`))
    assert.equal(authorizationState.status, 200)
    const hostScope = JSON.parse(authorizationState.body).autopilotAuthorization
    assert.equal(hostScope.rootSessionId, rootAgent.id)
    assert.match(hostScope.projectKey, /^[a-f0-9]{64}$/u)
    assert.equal(hostScope.goalId, currentGoal.id)
    assert.equal(hostScope.teamId, started.team.id)
    assert.equal(hostScope.pauseEpoch, 0)
    assert.match(hostScope.teamScopeHash, /^[a-f0-9]{64}$/u)

    const beforePreferenceSave = autopilotAuthorizationConsumptions.length
    const preferenceOnly = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 200
    }, 'host-settings-preference-only'))
    assert.equal(preferenceOnly.status, 200, preferenceOnly.body)
    assert.equal(autopilotAuthorizationConsumptions.length, beforePreferenceSave + 1, 'trusted Save consumes one Host capability even before an exact team scope exists')
    assert.equal(autopilotAuthorizationConsumptions.at(-1).hostAuthorization, null)
    assert.equal(JSON.parse(preferenceOnly.body).state.config.autopilotEnabled, true)
    assert.equal((await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })).team.autopilot, undefined, 'an unscoped preference Save does not retrofit Goal authority')

    const forgedAuthorizationRequest = hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 200, hostAuthorization: hostScope
    }, 'forged-static')
    const forgedAuthorization = await invoke(routes.get('/api/agent-teams/action'), forgedAuthorizationRequest)
    assert.equal(forgedAuthorization.status, 403)
    assert.equal((await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })).team.autopilot, undefined)

    const beforeWrongBinding = autopilotAuthorizationConsumptions.length
    const wrongBinding = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: recoveryAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 200, hostAuthorization: hostScope
    }, 'host-settings-once'))
    assert.equal(wrongBinding.status, 403)
    assert.equal(autopilotAuthorizationConsumptions.length, beforeWrongBinding, 'outer session binding is checked before the one-time receipt is consumed')

    const authorizedSettings = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 200, hostAuthorization: hostScope
    }, 'host-settings-once'))
    assert.equal(authorizedSettings.status, 200)
    const authorizedTeam = (await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })).team
    assert.equal(authorizedTeam.autopilot.status, 'pending_plan')
    assert.equal(authorizedTeam.autopilot.maxAdditionalRounds, 200)
    const stateFile = path.join(root, 'storages', 'agent_teams.json')
    const authorizedStore = JSON.parse(await readFile(stateFile, 'utf8'))
    const persistedAuthorization = authorizedStore.teams.find(team => team.id === started.team.id).autopilot
    const persistedAuthorizationEpoch = persistedAuthorization.authorizationEpoch
    assert.equal(persistedAuthorizationEpoch, autopilotAuthorizationEpoch)
    assert.equal(persistedAuthorization.goalId, currentGoal.id)
    const store = new mod.AgentTeamsStore(stateFile)
    await store.init()
    currentGoal.maxGoalRounds += 1
    await store.mutate(document => {
      const grant = document.teams.find(team => team.id === started.team.id).autopilot
      grant.additionalRoundsGranted = 1
      grant.expectedMaxGoalRounds = currentGoal.maxGoalRounds
    })

    const unscopedMaintenance = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 200
    }, 'host-settings-maintain-unscoped'))
    assert.equal(unscopedMaintenance.status, 403)
    const maintainedSettings = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 199, hostAuthorization: hostScope
    }, 'host-settings-maintain'))
    assert.equal(maintainedSettings.status, 200)
    const maintainedTeam = (await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })).team
    assert.equal(maintainedTeam.autopilot.maxAdditionalRounds, 199)
    assert.equal(maintainedTeam.autopilot.additionalRoundsGranted, 1, 'reauthorizing true preserves already consumed finite budget')
    assert.equal(maintainedTeam.autopilot.expectedMaxGoalRounds, undefined, 'private Goal-cap authority never enters the public projection')
    assert.equal(maintainedTeam.autopilot.authorizationEpoch, undefined, 'private Host epochs never enter the public projection')
    const maintainedStore = JSON.parse(await readFile(stateFile, 'utf8'))
    const maintainedGrant = maintainedStore.teams.find(team => team.id === started.team.id).autopilot
    assert.equal(maintainedGrant.expectedMaxGoalRounds, currentGoal.maxGoalRounds)
    assert.equal(maintainedGrant.authorizationEpoch, autopilotAuthorizationEpoch)

    const replayRequest = hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 199, hostAuthorization: hostScope
    }, 'host-settings-maintain')
    assert.equal((await invoke(routes.get('/api/agent-teams/action'), replayRequest)).status, 403)

    const revocationsBeforeDisable = autopilotAuthorizationRevocations
    revocationGoalActivation = 'not-called'
    const revokeAuthorizedSettings = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', autopilotEnabled: false, autopilotMaxAdditionalRounds: 199
    }, 'host-settings-revoke'))
    assert.equal(revokeAuthorizedSettings.status, 200, revokeAuthorizedSettings.body)
    assert.equal(currentGoal.activation, 'disarmed', 'settings revocation disarms the exact bound Goal first')
    assert.equal(revocationGoalActivation, 'not-called', 'the consumed false receipt rotates the Host epoch once without a second revoke call')
    assert.equal(autopilotAuthorizationRevocations, revocationsBeforeDisable, 'settings revocation never rotates the Host epoch twice')
    assert.notEqual(autopilotAuthorizationEpoch, persistedAuthorizationEpoch, 'unscoped false rotates the Host authorization epoch while remaining receipt-compatible')
    assert.equal((await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })).team.autopilot.status, 'revoked')

    const unsafeDisable = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: false
    }))
    assert.equal(unsafeDisable.status, 409)

    const durableTask = await tools.get('team_task_create').execute({ team_id: started.team.id, title: 'Collect evidence' }, { agent: rootAgent, signal: new AbortController().signal })
    const planned = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })
    const committedPlan = await tools.get('team_plan_commit').execute({ team_id: started.team.id, expected_revision: planned.team.plan.revision, confirmed_plan_hash: planned.team.plan.hash, cost_verified: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(committedPlan.plan.phase, 'committed', 'no worker exists before publication')
    const spawned = await tools.get('team_spawn').execute({
      team_id: started.team.id, task_ids: [durableTask.task.id], name: 'Researcher', role: 'research', prompt: 'Collect evidence', model: 'special-model'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(spawned.ok, true)
    assert.equal(spawned.plan.phase, 'active', 'successful child publication activates the exact committed plan')
    assert.equal(starts.length, 1)
    assert.equal(starts[0].request.parent, rootAgent)
    assert.equal(starts[0].request.agentOptions.provider, 'test-provider')
    assert.equal(starts[0].request.agentOptions.model, 'special-model')
    assert.equal(starts[0].request.toolFilter, undefined, 'managed members use the Host execution guard instead of an SDK-local child filter')
    assert.match(provisioningGuardDecisions[0], /managed Agent Team members cannot call subagent/u)
    for (const name of ['subagent', 'subagent_fork', 'workflow', 'ralph']) assert.match(toolGuards[0]({ name, agent: workerAgent }), new RegExp(`cannot call ${name}`))
    assert.equal(toolGuards[0]({ name: 'team_task_update', agent: workerAgent }), undefined)
    assert.equal(toolGuards[0]({ name: 'subagent', agent: rootAgent }), undefined)
    assert.equal(spawned.member.modelTier, 'subagent')
    assert.equal(spawned.member.inheritsMain, false)
    assert.equal(spawned.member.routeSource, 'live-lead-explicit-model')
    assert.equal(spawned.member.provider, 'test-provider')
    assert.equal(spawned.member.model, 'special-model')
    assert.match(spawned.member.publishedAt, /^\d{4}-\d{2}-\d{2}T/u)
    assert.match(starts[0].request.prompt[0].text, /Do not begin any task/u)
    assert.match(followups[0].content[0].text, /use team_expansion_request with explicit deliverables, acceptance criteria, and non-overlapping file\/resource boundaries/u)
    assert.match(followups[0].content[0].text, /root coordinator decides whether to create persistent tasks and visible peer members without bypassing maxMembers or maxActiveTurns/u)
    assert.equal(followups[0].options.source.kind, 'agent-message')
    assert.equal(followups[0].options.source.form, 'relay')
    assert.equal(followups[0].options.source.senderSessionId, rootAgent.id)
    assert.equal(starts[0].childId, spawned.member.sessionId)
    assert.equal(followups[0].childId, spawned.member.sessionId)

    currentGoal = { ...currentGoal, revision: 2, roundsStarted: 2, activation: 'armed' }
    rootAgent.session.events.push(
      { type: 'turn/end', data: {} },
      { type: 'turn/start', data: { continuation: 'goal' } },
      { type: 'user/message', data: { source: { kind: 'goal', goalId: currentGoal.id, revision: currentGoal.revision, round: currentGoal.roundsStarted } } }
    )
    const automaticTask = await tools.get('team_task_create').execute({
      team_id: started.team.id, title: 'Safe automatic-round regression', files: ['src/automatic-round.js']
    }, { agent: rootAgent, signal: new AbortController().signal })
    const automaticDraft = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })
    const automaticCommit = await tools.get('team_plan_commit').execute({
      team_id: started.team.id,
      expected_revision: automaticDraft.team.plan.revision,
      confirmed_plan_hash: automaticDraft.team.plan.hash
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(automaticCommit.plan.phase, 'active', 'a safe established team recommits across a real turn without a new user/message')
    assert.equal(automaticCommit.plan.authorization.source, 'human_attested')
    assert.equal(JSON.stringify(automaticCommit).includes('host_verified'), false)
    assert.equal(automaticTask.task.status, 'pending')

    const crossProjectTask = await tools.get('team_task_create').execute({
      team_id: started.team.id, title: 'Cross-project negative control', files: ['src/cross-project-negative.js']
    }, { agent: rootAgent, signal: new AbortController().signal })
    const crossProjectDraft = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })
    rootAgent.session.header.cwd = path.join(root, 'different-project')
    await assert.rejects(
      tools.get('team_plan_commit').execute({ team_id: started.team.id, expected_revision: crossProjectDraft.team.plan.revision, confirmed_plan_hash: crossProjectDraft.team.plan.hash }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN'
    )
    rootAgent.session.header.cwd = root
    await tools.get('team_plan_commit').execute({ team_id: started.team.id, expected_revision: crossProjectDraft.team.plan.revision, confirmed_plan_hash: crossProjectDraft.team.plan.hash }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(crossProjectTask.task.status, 'pending')

    rootAgent.session.events.push(
      { type: 'turn/end', data: {} },
      { type: 'turn/start', data: { continuation: 'goal' } }
    )

    for (const [toolName, args] of [
      ['team_start', { request_id: 'automatic-team-start-denied', objective: 'Must still require a direct user', candidate_workstreams: 2 }],
      ['team_bootstrap', { request_id: 'automatic-bootstrap-denied', objective: 'Denied', candidate_workstreams: 2, tasks: [], members: [] }],
      ['team_resume', { team_id: started.team.id }],
      ['team_handoff', { team_id: started.team.id, target_root_session_id: recoveryAgent.id }],
      ['team_adopt', { team_id: started.team.id, handoff_token: 'not-authorized' }],
      ['team_recover', { team_id: started.team.id, confirm: true }],
      ['team_task_external_effect', { team_id: started.team.id, task_id: automaticTask.task.id, effect_name: 'none', action: 'resolve_unknown', attempt_id: 'none', outcome: 'not_started', authorization_id: 'none' }]
    ]) {
     await assert.rejects(
        tools.get(toolName).execute(args, { agent: rootAgent, signal: new AbortController().signal }),
        /direct host-attested human input/u,
        `${toolName} must not inherit the automatic plan recommit allowance`
      )
    }
    rootAgent.session.events.push(
      { type: 'turn/end', data: {} },
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'user' } } }
    )

    const forbiddenWorkerControl = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: spawned.member.sessionId, action: 'member-stop', memberId: spawned.member.sessionId, mode: 'retire'
    }))
    assert.equal(forbiddenWorkerControl.status, 403)
    const forbiddenSpoofedLeadControl = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: rootAgent.id, action: 'close', teamId: started.team.id, force: true
    }))
    assert.equal(forbiddenSpoofedLeadControl.status, 403)

    const sameTeamRelay = await tools.get('team_message').execute({ team_id: started.team.id, recipient_session_id: 'Researcher', message: 'Verify source B' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(followups[1].options.source.kind, 'agent-message')
    assert.equal(followups[1].options.source.form, 'relay')
    assert.equal(followups[1].options.source.summary, undefined)
    assert.equal(followups[1].options.source.senderSessionId, rootAgent.id)
    assert.match(followups[1].content[0].text, /from Lead/u)
    const sameTeamEnvelopeLine = followups[1].content[0].text.split('\n')[1]
    assert.match(sameTeamEnvelopeLine, /^\[Agent team envelope \{.*\}\]$/u)
    const sameTeamEnvelope = JSON.parse(sameTeamEnvelopeLine.slice('[Agent team envelope '.length, -1))
    assert.deepEqual(sameTeamEnvelope, {
      version: 1,
      messageId: sameTeamRelay.message.id,
      sourceTeamId: started.team.id,
      targetTeamId: started.team.id,
      senderMemberId: `lead:${rootAgent.id}`,
      recipientMemberId: spawned.member.id
    })
    assert.ok(followups.every(item => item.options.source.kind === 'agent-message' && item.options.source.form === 'relay'))

    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: started.team.id, task_ids: [durableTask.task.id], name: '  ＲＥＳＥＡＲＣＨＥＲ  ', role: 'duplicate', prompt: 'Must not start' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_DUPLICATE_MEMBER_NAME'
    )
    for (const invalidName of ['A', 'ThisWorkerDutyNameIsFarTooLong', 'Subagent', 'Ｓｕｂａｇｅｎｔ', '协调器', 'UI/Docs']) {
     await assert.rejects(
        tools.get('team_spawn').execute({ team_id: started.team.id, task_ids: [durableTask.task.id], name: invalidName, role: 'invalid name', prompt: 'Must not start' }, { agent: rootAgent, signal: new AbortController().signal }),
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
    assert.deepEqual(uiState.team.ownershipHistory, [])
    assert.equal(uiState.team.projection.ownershipHistoryTruncated, false)
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
    assert.ok(routes.has('/api/agent-teams/task-detail/events'))
    const taskDetailResponse = await invoke(routes.get('/api/agent-teams/task-detail'), request('GET', `/api/agent-teams/task-detail?sessionId=${rootAgent.id}&teamId=${started.team.id}&taskId=${projectedTask.task.id}`))
    assert.equal(taskDetailResponse.status, 200)
    const taskDetail = JSON.parse(taskDetailResponse.body)
    assert.equal(taskDetail.description, 'Host-private task detail')
    assert.equal(taskDetail.summary, 'Audit projection')
    assert.equal('files' in taskDetail, false)
    assert.equal('sessionId' in (taskDetail.responsible || {}), false)
    const missingTaskDetail = await invoke(routes.get('/api/agent-teams/task-detail'), request('GET', `/api/agent-teams/task-detail?sessionId=unrelated-session&teamId=${started.team.id}&taskId=${projectedTask.task.id}`))
    assert.equal(missingTaskDetail.status, 404)
    const otherMemberTaskDetail = await invoke(routes.get('/api/agent-teams/task-detail'), request('GET', `/api/agent-teams/task-detail?sessionId=${spawned.member.sessionId}&teamId=${started.team.id}&taskId=${projectedTask.task.id}`))
    assert.equal(otherMemberTaskDetail.status, 404)
    const uiResearcher = uiState.team.members.find(member => member.name === 'Researcher')
    assert.equal(typeof uiResearcher.lastActivityAt, 'string')
    assert.equal(uiResearcher.model, 'special-model')
    assert.equal(uiResearcher.provider, 'test-provider')
    assert.equal(uiResearcher.modelTier, 'subagent')
    assert.equal(uiResearcher.inheritsMain, false)
    assert.equal(uiResearcher.routeSource, 'live-lead-explicit-model')

    const memoryTask = await tools.get('team_task_create').execute({
      team_id: started.team.id,
      title: 'Use bounded memory pack',
      assignee_session_id: spawned.member.sessionId
    }, { agent: rootAgent, signal: new AbortController().signal })
    const packContent = 'project constraint only for this task'
    const packExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const packDelivery = await tools.get('team_memory_pack').execute({
      team_id: started.team.id,
      task_id: memoryTask.task.id,
      recipient_session_id: spawned.member.sessionId,
      content: packContent,
      expires_at: packExpiry
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(packDelivery.ok, true)
    assert.match(followups.at(-1).content[0].text, /Ephemeral Memory Pack/u)
    assert.match(followups.at(-1).content[0].text, new RegExp(packContent, 'u'))
    const persistedAfterPack = await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')
    assert.doesNotMatch(persistedAfterPack, new RegExp(packContent, 'u'))
    assert.match(persistedAfterPack, /ephemeral memory pack omitted/u)
    activeInitiator = workerAgent
    await assert.rejects(
      tools.get('team_memory_pack').execute({
        team_id: started.team.id,
        task_id: memoryTask.task.id,
        recipient_session_id: rootAgent.id,
        content: packContent,
        expires_at: packExpiry
      }, { agent: workerAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_UNAUTHORIZED'
    )
    activeInitiator = rootAgent
    await assert.rejects(
      tools.get('team_memory_pack').execute({
        team_id: started.team.id,
        task_id: memoryTask.task.id,
        recipient_session_id: spawned.member.sessionId,
        content: 'x'.repeat(1201),
        expires_at: packExpiry
      }, { agent: rootAgent, signal: new AbortController().signal }),
      /at most 1200|must be at most 1200|memory pack content/u
    )

    activeInitiator = workerAgent
    const busyLeadRelay = await tools.get('team_message').execute({
      team_id: started.team.id, recipient_session_id: rootAgent.id, message: 'Intermediate progress while lead is working'
    }, { agent: workerAgent, signal: new AbortController().signal })
    activeInitiator = rootAgent
    assert.equal(busyLeadRelay.ok, true)
    assert.equal(leadSteers.length, 1)
    assert.equal(leadFollowups.length, 0)
    assert.match(leadSteers[0].content[0].text, /Intermediate progress while lead is working/u)
    assert.equal(leadSteers[0].source.kind, 'agent-message')
    assert.equal(leadSteers[0].source.form, 'relay')
    assert.equal(leadSteers[0].source.senderSessionId, workerAgent.id)

    rootAgent.status = 'idle'
    activeInitiator = workerAgent
    const idleLeadRelay = await tools.get('team_message').execute({
      team_id: started.team.id, recipient_session_id: rootAgent.id, message: 'Progress while lead is idle'
    }, { agent: workerAgent, signal: new AbortController().signal })
    activeInitiator = rootAgent
    rootAgent.status = 'running'
    assert.equal(idleLeadRelay.ok, true)
    assert.equal(leadSteers.length, 1)
    assert.equal(leadFollowups.length, 1)
    assert.equal(leadInboxNextStep.length, 1)
    assert.equal(leadInboxNextTurn.length, 1)
    assert.match(leadFollowups[0].content[0].text, /Progress while lead is idle/u)

    const expansionSource = (await tools.get('team_task_create').execute({
      team_id: started.team.id,
      title: 'Own integration stream',
      assignee_session_id: spawned.member.sessionId,
      files: ['src']
    }, { agent: rootAgent, signal: new AbortController().signal })).task
    const otherActiveFileTask = (await tools.get('team_task_create').execute({
      team_id: started.team.id,
      title: 'Other active file owner',
      files: ['packages/app']
    }, { agent: rootAgent, signal: new AbortController().signal })).task
    const expansionPlan = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: rootAgent, signal: new AbortController().signal })
    await tools.get('team_plan_commit').execute({ team_id: started.team.id, expected_revision: expansionPlan.team.plan.revision, confirmed_plan_hash: expansionPlan.team.plan.hash, permissions_verified: true, files_verified: true, cost_verified: true, external_side_effects_verified: true }, { agent: rootAgent, signal: new AbortController().signal })
    await tools.get('team_task_update').execute({
      team_id: started.team.id, task_id: otherActiveFileTask.id, action: 'claim'
    }, { agent: rootAgent, signal: new AbortController().signal })
    const validExpansionWorkstreams = [{
      title: 'Read-only evidence',
      deliverable: 'Return a concise evidence table.',
      acceptance_criteria: 'Every claim cites one checked source.',
      files: [],
      resources: ['upstream-docs:read-only']
    }, {
      title: 'Regression fixture',
      deliverable: 'Add a focused independent regression fixture.',
      acceptance_criteria: 'The new fixture fails before the fix and passes after it.',
      files: ['src/peer.js'],
      resources: []
    }]
    await assert.rejects(
      tools.get('team_expansion_request').execute({
        team_id: started.team.id,
        source_task_id: expansionSource.id,
        parallel_benefit: 'Run independent evidence and regression work in parallel.',
        workstreams: validExpansionWorkstreams
      }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_EXPANSION_WORKER_REQUIRED'
    )
    activeInitiator = workerAgent
    await assert.rejects(
      tools.get('team_expansion_request').execute({
        team_id: started.team.id,
        source_task_id: expansionSource.id,
        parallel_benefit: 'Run independent evidence and regression work in parallel.',
        workstreams: validExpansionWorkstreams
      }, { agent: workerAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_EXPANSION_TASK_REQUIRED'
    )
    await tools.get('team_task_update').execute({
      team_id: started.team.id, task_id: expansionSource.id, action: 'claim'
    }, { agent: workerAgent, signal: new AbortController().signal })
    await assert.rejects(
      tools.get('team_expansion_request').execute({
        team_id: started.team.id,
        source_task_id: expansionSource.id,
        parallel_benefit: 'Two proposals must not claim the same resource hierarchy.',
        workstreams: [{
          title: 'Resource parent', deliverable: 'Inspect the resource.', acceptance_criteria: 'Report the result.',
          files: [], resources: ['database/orders']
        }, {
          title: 'Resource child', deliverable: 'Inspect the child resource.', acceptance_criteria: 'Report the result.',
          files: [], resources: ['database/orders/row-1']
        }]
      }, { agent: workerAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_EXPANSION_CONFLICT'
    )
    await assert.rejects(
      tools.get('team_expansion_request').execute({
        team_id: started.team.id,
        source_task_id: expansionSource.id,
        parallel_benefit: 'A glob that covers another active task would not be safe.',
        workstreams: [{
          title: 'Conflicting edit', deliverable: 'Edit another owner scope.', acceptance_criteria: 'The edit passes.',
          files: ['packages/**'], resources: []
        }]
      }, { agent: workerAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_EXPANSION_CONFLICT'
    )
    await assert.rejects(
      tools.get('team_expansion_request').execute({
        team_id: started.team.id,
        source_task_id: expansionSource.id,
        parallel_benefit: 'Four branches exceed the three currently free member/turn slots.',
        workstreams: Array.from({ length: 4 }, (_, index) => ({
          title: `Capacity ${index}`, deliverable: `Outcome ${index}`, acceptance_criteria: `Check ${index}`,
          files: [], resources: [`capacity-resource-${index}`]
        }))
      }, { agent: workerAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_EXPANSION_CAPACITY'
    )
    const expansion = await tools.get('team_expansion_request').execute({
      team_id: started.team.id,
      source_task_id: expansionSource.id,
      parallel_benefit: 'Evidence collection and an isolated fixture shorten the critical path and add independent verification.',
      workstreams: validExpansionWorkstreams
    }, { agent: workerAgent, signal: new AbortController().signal })
    activeInitiator = rootAgent
    assertLosslessJson(expansion)
    assert.equal(expansion.ok, true)
    assert.equal(expansion.expansionRequest.sourceTaskId, expansionSource.id)
    assert.equal(expansion.expansionRequest.requestedBy.name, 'Researcher')
    assert.equal(expansion.expansionRequest.workstreams.length, 2)
    assert.equal(expansion.expansionRequest.workstreams[1].files[0], 'src/peer.js', 'the broad source parent is excluded at proposal time')
    assert.equal(expansion.expansionRequest.capacity.availableWorkstreams, 3)
    assert.equal(expansion.message.status, 'delivered')
    assert.equal(starts.length, 1, 'an expansion request must never spawn a member automatically')
    assert.equal(leadSteers.length, 2)
    assert.match(leadSteers.at(-1).content[0].text, /Structured agent-team expansion request/u)
    assert.match(leadSteers.at(-1).content[0].text, /does not persist or verify existing external-resource ownership/u)
    assert.match(leadSteers.at(-1).content[0].text, /first release\/restructure that parent so its in-progress file scope no longer overlaps/u)
    const expansionPersisted = await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')
    assert.match(expansionPersisted, new RegExp(expansion.expansionRequest.id, 'u'))
    assert.match(expansionPersisted, /Structured agent-team expansion request/u)

    const sibling = (await startTeam(tools, { objective: 'Coordinate peer team' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    const costBoundTeam = (await startTeam(tools, { objective: 'Shared turn ceiling' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    assertLosslessJson(multiTeamStatus)
    const rejectedUndefined = await crossRealDshJsonOutputBoundary({ optional: undefined })
    assert.equal(rejectedUndefined.isError, true)
    assert.match(rejectedUndefined.error.message, /not lossless JSON/u)
    const acceptedStatus = await crossRealDshJsonOutputBoundary(multiTeamStatus)
    assert.equal(acceptedStatus.isError, false)
    assert.deepEqual(acceptedStatus.value, multiTeamStatus)
    assert.equal(multiTeamStatus.selectionRequired, true)
    assert.equal(multiTeamStatus.team, null)
    assert.deepEqual(new Set(multiTeamStatus.teams.map(team => team.id)), new Set([started.team.id, sibling.id]))
    for (const summary of multiTeamStatus.teams) {
      assert.deepEqual(Object.keys(summary).filter(key => key !== 'closureOutcome').sort(), ['activeTaskCount', 'cancelledTaskCount', 'completedTaskCount', 'id', 'memberCount', 'name', 'pauseEpoch', 'pendingTaskCount', 'planPhase', 'revision', 'status', 'updatedAt'])
      if ('closureOutcome' in summary) assert.equal(summary.closureOutcome, null)
      assert.equal('objective' in summary, false)
      assert.equal('members' in summary, false)
      assert.equal('tasks' in summary, false)
      assert.equal('messages' in summary, false)
    }
    const explicitTeamStatus = await tools.get('team_status').execute({ team_id: sibling.id }, { agent: rootAgent, signal: new AbortController().signal })
    assertLosslessJson(explicitTeamStatus)
    assert.equal(explicitTeamStatus.selectionRequired, false)
    assert.equal(explicitTeamStatus.team.id, sibling.id)
    assert.equal(explicitTeamStatus.teams.length, 1)
    const peerTask = (await tools.get('team_task_create').execute({
      team_id: sibling.id, title: 'Cross-team integration', cross_team_depends_on: [`${started.team.id}:${projectedTask.task.id}`]
    }, { agent: rootAgent, signal: new AbortController().signal })).task
    assert.deepEqual(peerTask.blockedBy, [`${started.team.id}:${projectedTask.task.id}`])
    assert.deepEqual(peerTask.dependencySources, [{ teamId: started.team.id, teamName: started.team.name, teamStatus: 'active' }])
    for (const teamId of [started.team.id, sibling.id]) {
      const pendingPlan = await tools.get('team_status').execute({ team_id: teamId }, { agent: rootAgent, signal: new AbortController().signal })
      await tools.get('team_plan_commit').execute({ team_id: teamId, expected_revision: pendingPlan.team.plan.revision, confirmed_plan_hash: pendingPlan.team.plan.hash, permissions_verified: true, files_verified: true, cost_verified: true, external_side_effects_verified: true }, { agent: rootAgent, signal: new AbortController().signal })
    }
    const listedPeerTasks = await tools.get('team_task_list').execute({ team_id: sibling.id }, { agent: rootAgent, signal: new AbortController().signal })
    assertLosslessJson(listedPeerTasks)
    assert.equal('files' in peerTask.dependencySources[0], false)
    await assert.rejects(
      tools.get('team_task_update').execute({ team_id: sibling.id, task_id: peerTask.id, action: 'claim' }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_TASK_BLOCKED'
    )
    const projectedClaim = await tools.get('team_task_update').execute({ team_id: started.team.id, task_id: projectedTask.task.id, action: 'claim' }, { agent: rootAgent, signal: new AbortController().signal })
    const projectedCompletion = await tools.get('team_task_update').execute({ team_id: started.team.id, task_id: projectedTask.task.id, action: 'complete', claim_id: projectedClaim.task.claimId, lease_epoch: projectedClaim.task.leaseEpoch }, { agent: rootAgent, signal: new AbortController().signal })
    assert.deepEqual(projectedCompletion.task.submission, {
      taskId: projectedTask.task.id,
      claimId: projectedClaim.task.claimId,
      leaseEpoch: projectedClaim.task.leaseEpoch,
      submittedAt: projectedCompletion.task.submission.submittedAt,
      submittedBy: rootAgent.id,
      source: 'explicit_complete'
    })
    const projectedAcceptance = await fixedRootTaskUpdate(tools, started.team.id, projectedTask.task.id, 'accept', { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(projectedAcceptance.task.acceptance.acceptedBy, rootAgent.id)
    const unblockedPeer = await tools.get('team_task_update').execute({ team_id: sibling.id, task_id: peerTask.id, action: 'claim' }, { agent: rootAgent, signal: new AbortController().signal })
    assertLosslessJson(unblockedPeer)
    const acceptedTaskUpdate = await crossRealDshJsonOutputBoundary(unblockedPeer)
    assert.equal(acceptedTaskUpdate.isError, false)
    assert.deepEqual(acceptedTaskUpdate.value, unblockedPeer)
    assert.deepEqual(unblockedPeer.task.blockedBy, [])
    const crossTeam = await tools.get('team_message').execute({
      team_id: started.team.id, target_team_id: sibling.id, recipient_session_id: 'PeerWorker', message: 'Coordinate across peer teams'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(crossTeam.message.eventType, 'delivery')
    assert.equal(crossTeam.message.fromTeamId, started.team.id)
    assert.equal(crossTeam.message.toTeamId, sibling.id)
    assert.equal(crossTeam.message.toName, 'PeerWorker')
    assert.equal(followups.at(-1).options.source.kind, 'agent-message')
    assert.equal(followups.at(-1).options.source.form, 'relay')
    assert.equal(followups.at(-1).options.source.senderSessionId, rootAgent.id)
    const crossTeamEnvelopeLine = followups.at(-1).content[0].text.split('\n')[1]
    const crossTeamEnvelope = JSON.parse(crossTeamEnvelopeLine.slice('[Agent team envelope '.length, -1))
    assert.deepEqual(crossTeamEnvelope, {
      version: 1,
      messageId: crossTeam.message.id,
      sourceTeamId: started.team.id,
      targetTeamId: sibling.id,
      senderMemberId: `lead:${rootAgent.id}`,
      recipientMemberId: peerSpawn.member.id
    })
    const sourceState = JSON.parse((await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${rootAgent.id}&teamId=${started.team.id}`))).body)
    assert.equal(sourceState.teams.filter(team => team.status !== 'closed').length, 2)
    const sourceProjection = sourceState.team
    const targetState = JSON.parse((await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${rootAgent.id}&teamId=${sibling.id}`))).body)
    const targetProjection = targetState.team
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
    const foreign = (await startTeam(tools, { objective: 'Different root isolation' }, { agent: recoveryAgent, signal: new AbortController().signal })).team
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
    const unrelatedRelayTeam = (await startTeam(tools, { objective: 'Unrelated relay concurrency' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    assert.equal(leadSteers.length, 2)
    assert.equal(leadFollowups.length, 1)
    assert.equal(leadInboxNextStep.length, 0)
    assert.equal(leadInboxNextTurn.length, 0)
    const closedStateResponse = await invoke(routes.get('/api/agent-teams/state'), request('GET', `/api/agent-teams/state?sessionId=${rootAgent.id}`))
    assert.equal(closedStateResponse.status, 200)
    assert.equal(JSON.parse(closedStateResponse.body).teams.find(team => team.id === started.team.id).status, 'closed')
    await assert.rejects(
      tools.get('team_shutdown').execute({ team_id: started.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error && error.code === 'AGENT_TEAMS_CLOSING'
    )

    const readQueueRaceTeam = (await startTeam(tools, { objective: 'Read queue close race' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const memberRetireOrderTeam = (await startTeam(tools, { objective: 'Member retirement queue ordering' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const secondTeam = (await startTeam(tools, { objective: 'Spawn shutdown race' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const duplicateChildTeam = (await startTeam(tools, { objective: 'Duplicate child id safety' }, { agent: rootAgent, signal: new AbortController().signal })).team
    forcedChildId = spawned.member.sessionId
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

    const publicationFailureTeam = (await startTeam(tools, { objective: 'Publication rollback drain' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    assert.equal(unpublishedMember.shutdownUnconfirmed, false)
    assert.equal(unpublishedMember.stopUnconfirmed, false)
    assert.match(unpublishedMember.error, /after confirmed drain/u)
    assert.equal(followups.some(followup => followup.content?.[0]?.text?.includes('Never publish this work')), false)
    const publicationRetry = await tools.get('team_spawn').execute({ team_id: publicationFailureTeam.id, name: 'PublishRetry', role: 'replacement after confirmed drain', prompt: 'Replacement starts without a leaked member slot' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(publicationRetry.member.state, 'running')
    await tools.get('team_shutdown').execute({ team_id: publicationFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const unconfirmedPublicationTeam = (await startTeam(tools, { objective: 'Unconfirmed publication rollback' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const workFailureTeam = (await startTeam(tools, { objective: 'Work followup cleanup' }, { agent: rootAgent, signal: new AbortController().signal })).team
    failWorkFollowupIds.add('*')
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: workFailureTeam.id, name: 'WorkAudit', role: 'work failure audit', prompt: 'Fail the first work followup' }, { agent: rootAgent, signal: new AbortController().signal }),
      /work followup failed/u
    )
    const expectedWorkFailureChild = starts.at(-1).childId
    failWorkFollowupIds.delete(expectedWorkFailureChild)
    let workFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === workFailureTeam.id)
    let workFailureMember = workFailureRecord.members.find(member => member.name === 'WorkAudit')
    assert.equal(workFailureMember.sessionId, expectedWorkFailureChild)
    assert.equal(workFailureMember.state, 'failed')
    assert.equal(workFailureMember.shutdownUnconfirmed, false)
    assert.equal(workFailureMember.stopUnconfirmed, false)
    assert.equal(workFailureMember.publishedAt, undefined, 'initial work-followup failure must not establish standing continuation authority')
    assert.match(workFailureMember.error, /initial work followup failed after child became live after confirmed drain/u)
    await tools.get('team_shutdown').execute({ team_id: workFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const unconfirmedWorkFailureTeam = (await startTeam(tools, { objective: 'Unconfirmed work followup cleanup' }, { agent: rootAgent, signal: new AbortController().signal })).team
    failWorkFollowupIds.add('*')
    failDrain = true
    await assert.rejects(
      tools.get('team_spawn').execute({ team_id: unconfirmedWorkFailureTeam.id, name: 'WorkDrain', role: 'work drain audit', prompt: 'Fail work and cleanup drain' }, { agent: rootAgent, signal: new AbortController().signal }),
      /work followup failed/u
    )
    const expectedUnconfirmedWorkChild = starts.at(-1).childId
    failDrain = false
    failWorkFollowupIds.delete(expectedUnconfirmedWorkChild)
    workFailureRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === unconfirmedWorkFailureTeam.id)
    workFailureMember = workFailureRecord.members.find(member => member.name === 'WorkDrain')
    assert.equal(workFailureMember.state, 'failed')
    assert.equal(workFailureMember.shutdownUnconfirmed, true)
    assert.equal(workFailureMember.stopUnconfirmed, true)
    assert.equal(workFailureMember.publishedAt, undefined, 'uncertain cleanup after initial failure still must not establish standing continuation authority')
    assert.match(workFailureMember.error, /initial work followup failed after child became live/u)
    assert.match(workFailureMember.error, /cleanup drain failed: Error: drain failed/u)
    await tools.get('team_shutdown').execute({ team_id: unconfirmedWorkFailureTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const recoverableTeam = (await startTeam(tools, { objective: 'Recover failed shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    await tools.get('team_shutdown').execute({ team_id: sibling.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const coldTeam = (await startTeam(tools, { objective: 'Cold child shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const coldMember = (await tools.get('team_spawn').execute({ team_id: coldTeam.id, name: 'ColdTester', role: 'cold shutdown test', prompt: 'Become cold before shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).member
    await listeners.get('subagent/start')({ id: coldMember.sessionId, runId: 'cold-member-run' })
    await listeners.get('subagent/end')({ id: coldMember.sessionId, runId: 'cold-member-run', stopReason: 'completed' })
    const coldReady = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === coldTeam.id).members.find(member => member.sessionId === coldMember.sessionId)
    assert.equal(coldReady.state, 'ready')
    coldDrainIds.add(coldMember.sessionId)
    const coldShutdown = await tools.get('team_shutdown').execute({ team_id: coldTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(coldShutdown.team.state, 'closed')
    assert.equal(coldShutdown.team.members.find(member => member.sessionId === coldMember.sessionId).state, 'retired')
    assert.deepEqual(drains.at(-1), { parent: rootAgent, childIds: [coldMember.sessionId] })

    const refusalTeam = (await startTeam(tools, { objective: 'Refusal retirement must fail closed' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const refusalWorker = (await tools.get('team_spawn').execute({ team_id: refusalTeam.id, name: 'RefusalAudit', role: 'refusal retirement audit', prompt: 'Exercise refusal handling' }, { agent: rootAgent, signal: new AbortController().signal })).member
    gracefulStopReasons.set(refusalWorker.sessionId, 'refusal')
    await assert.rejects(
      tools.get('team_shutdown').execute({ team_id: refusalTeam.id, member_session_id: refusalWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_GRACEFUL_RETIREMENT_FAILED' && /refusal/u.test(error.message)
    )
    const refusalRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === refusalTeam.id)
    const refusedMember = refusalRecord.members.find(member => member.sessionId === refusalWorker.sessionId)
    assert.equal(refusedMember.state, 'failed')
    assert.notEqual(refusedMember.state, 'retired')
    assert.equal(refusedMember.shutdownUnconfirmed, true)
    assert.match(refusedMember.error, /refusal/u)
    gracefulStopReasons.delete(refusalWorker.sessionId)
    await tools.get('team_shutdown').execute({ team_id: refusalTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const fullRefusalTeam = (await startTeam(tools, { objective: 'Whole-team refusal must persist a failed open closure attempt' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const fullRefusalWorker = (await tools.get('team_spawn').execute({ team_id: fullRefusalTeam.id, name: 'FullRefusal', role: 'whole-team refusal audit', prompt: 'Refuse graceful retirement for the full-team path' }, { agent: rootAgent, signal: new AbortController().signal })).member
    gracefulStopReasons.set(fullRefusalWorker.sessionId, 'refusal')
    const fullRefusal = await tools.get('team_shutdown').execute({ team_id: fullRefusalTeam.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(fullRefusal.team.state, 'active')
    assert.equal(fullRefusal.failures.length, 1)
    assert.equal(fullRefusal.team.closure.outcome, 'failed')
    assert.equal(fullRefusal.team.closure.closedAt, undefined)
    const fullRefusalRecord = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === fullRefusalTeam.id)
    assert.equal(fullRefusalRecord.state, 'active')
    assert.equal(fullRefusalRecord.closure.outcome, 'failed')
    assert.equal(fullRefusalRecord.closure.closedAt, undefined)
    assert.match(fullRefusalRecord.closure.failures[0], /refusal/u)
    gracefulStopReasons.delete(fullRefusalWorker.sessionId)
    await tools.get('team_shutdown').execute({ team_id: fullRefusalTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const memberGracefulFailureTeam = (await startTeam(tools, { objective: 'Member graceful send failure' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    const failedAssigneeTask = (await tools.get('team_task_create').execute({
      team_id: memberGracefulFailureTeam.id,
      title: 'Reject unavailable assignee precisely'
    }, { agent: rootAgent, signal: new AbortController().signal })).task
    for (const operation of [
      tools.get('team_task_create').execute({
        team_id: memberGracefulFailureTeam.id,
        title: 'Must not bind failed assignee',
        assignee_session_id: memberGracefulFailureWorker.sessionId
      }, { agent: rootAgent, signal: new AbortController().signal }),
      fixedRootTaskUpdate(tools, memberGracefulFailureTeam.id, failedAssigneeTask.id, 'assign', { agent: rootAgent, signal: new AbortController().signal }, {
        assignee_session_id: memberGracefulFailureWorker.sessionId
      })
    ]) {
     await assert.rejects(operation, error => {
        assert.equal(error?.code, 'AGENT_TEAMS_ASSIGNEE_UNAVAILABLE')
        assert.equal(error?.message, 'target assignee is not assignable (current state: failed)')
        assert.doesNotMatch(error.message, /caller|lead-session|SendAudit|shutdownUnconfirmed|stopUnconfirmed/u)
        return true
      })
    }
    const statusAfterFailedAssignee = await tools.get('team_status').execute({ team_id: memberGracefulFailureTeam.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(statusAfterFailedAssignee.ok, true)
    assert.equal(statusAfterFailedAssignee.team.id, memberGracefulFailureTeam.id)
    assert.equal(statusAfterFailedAssignee.team.members.find(member => member.sessionId === rootAgent.id).state, 'running')
    assert.equal(statusAfterFailedAssignee.team.members.find(member => member.sessionId === memberGracefulFailureWorker.sessionId).state, 'failed')
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

    const coldResumeGracefulTeam = (await startTeam(tools, { objective: 'Cold resume graceful lifecycle wait' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const hotReloadGracefulTeam = (await startTeam(tools, { objective: 'Hot reload graceful lifecycle wait' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    await listeners.get('subagent/start')({ id: hotReloadGracefulWorker.sessionId, runId: 'hot-reload-first-end' })
    await listeners.get('subagent/end')({ id: hotReloadGracefulWorker.sessionId, runId: 'hot-reload-first-end', stopReason: 'completed' })
    const hotReloadRetirementResult = await hotReloadRetirement
    assert.equal(hotReloadRetirementResult.member.state, 'retired')
    manualGracefulLifecycleIds.delete(hotReloadGracefulWorker.sessionId)
    onGracefulAccepted = undefined
    await tools.get('team_shutdown').execute({ team_id: hotReloadGracefulTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const bufferedHotReloadTeam = (await startTeam(tools, { objective: 'Buffered hot reload end' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const bufferedHotReloadWorker = (await tools.get('team_spawn').execute({ team_id: bufferedHotReloadTeam.id, name: 'FastEndAudit', role: 'fast end audit', prompt: 'End immediately after acceptance' }, { agent: rootAgent, signal: new AbortController().signal })).member
    bufferedGracefulEndIds.add(bufferedHotReloadWorker.sessionId)
    const bufferedHotReloadRetirement = await tools.get('team_shutdown').execute({ team_id: bufferedHotReloadTeam.id, member_session_id: bufferedHotReloadWorker.sessionId }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(bufferedHotReloadRetirement.member.state, 'retired')
    bufferedGracefulEndIds.delete(bufferedHotReloadWorker.sessionId)
    await tools.get('team_shutdown').execute({ team_id: bufferedHotReloadTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    const unknownColdResumeTeam = (await startTeam(tools, { objective: 'Unknown active cold resume distinction' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const multiGracefulTeam = (await startTeam(tools, { objective: 'Multi-worker graceful lifecycle wait' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    await listeners.get('subagent/start')({ id: multiGracefulA.sessionId, runId: 'multi-graceful-a' })
    await listeners.get('subagent/start')({ id: multiGracefulB.sessionId, runId: 'multi-graceful-b' })
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

    const wholeGracefulFailureTeam = (await startTeam(tools, { objective: 'Whole graceful send failure' }, { agent: rootAgent, signal: new AbortController().signal })).team
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

    const gracefulTeam = (await startTeam(tools, { objective: 'Graceful shutdown' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    const inheritedTeam = (await startTeam(tools, { objective: 'Inherited subagent route' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const inheritedSpawn = await tools.get('team_spawn').execute({ team_id: inheritedTeam.id, name: '继承测试', role: 'test inherited route', prompt: 'Verify inherited main projection' }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(inheritedSpawn.member.modelTier, 'subagent')
    assert.equal(inheritedSpawn.member.inheritsMain, true)
    assert.equal(inheritedSpawn.member.routeSource, 'routing-subagent')
    assert.equal(inheritedSpawn.member.provider, 'main-provider')
    assert.equal(inheritedSpawn.member.model, 'main-model')
    await tools.get('team_shutdown').execute({ team_id: inheritedTeam.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    await rm(path.join(root, 'harness-desktop-model-routing.json'), { force: true })
    const fallbackTeam = (await startTeam(tools, { objective: 'Missing route fallback' }, { agent: rootAgent, signal: new AbortController().signal })).team
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
    for (const start of starts) assert.equal(start.request.toolFilter, undefined)
    assert.equal(provisioningGuardDecisions.length, starts.length)
    for (const decision of provisioningGuardDecisions) assert.match(decision, /managed Agent Team members cannot call subagent/u)

    const emptyShutdownTeam = (await startTeam(tools, { objective: 'Empty shutdown must not certify success' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const emptyShutdown = await tools.get('team_shutdown').execute({ team_id: emptyShutdownTeam.id }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(emptyShutdown.team.state, 'closed')
    assert.equal(emptyShutdown.team.closure.outcome, 'cancelled')
    assert.notEqual(emptyShutdown.team.closure.outcome, 'succeeded')

    const emptyOrphan = (await startTeam(tools, { objective: 'Empty orphan must not certify success' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const orphan = (await startTeam(tools, { objective: 'Recover orphan' }, { agent: rootAgent, signal: new AbortController().signal })).team
    const orphanStoreFile = path.join(root, 'storages', 'agent_teams.json')
    const orphanDocument = JSON.parse(await readFile(orphanStoreFile, 'utf8'))
    const orphanRecord = orphanDocument.teams.find(team => team.id === orphan.id)
    const orphanTimestamp = new Date().toISOString()
    orphanRecord.members.push({
      id: 'orphan-worker-id', sessionId: 'orphan-worker', name: 'OrphanWorker', role: 'orphan recovery audit',
      kind: 'worker', state: 'ready', createdAt: orphanTimestamp, updatedAt: orphanTimestamp
    })
    orphanRecord.tasks.push({
      id: 'orphan-unaccepted', title: 'Unaccepted orphan delivery', state: 'submitted', dependsOn: [], crossTeamDependsOn: [], files: [],
      assigneeSessionId: 'orphan-worker', createdAt: orphanTimestamp, updatedAt: orphanTimestamp, claimedAt: orphanTimestamp,
      attempt: 1, claimId: 'orphan-claim', leaseEpoch: 0,
      attemptHistory: [], interruptionHistory: [], capabilities: [], externalEffects: [],
      submission: { taskId: 'orphan-unaccepted', claimId: 'orphan-claim', leaseEpoch: 0, submittedAt: orphanTimestamp, submittedBy: 'orphan-worker', source: 'explicit_complete' }
    })
    orphanRecord.updatedAt = orphanTimestamp
    await writeFile(orphanStoreFile, `${JSON.stringify(orphanDocument, null, 2)}\n`, 'utf8')
    leadAvailable = false
    activeInitiator = recoveryAgent
    const emptyOrphanRecovery = await tools.get('team_recover').execute({ team_id: emptyOrphan.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(emptyOrphanRecovery.recovered[0].state, 'closed')
    assert.equal(emptyOrphanRecovery.recovered[0].closure.outcome, 'cancelled')
    assert.notEqual(emptyOrphanRecovery.recovered[0].closure.outcome, 'succeeded')
    const orphanPreview = await tools.get('team_recover').execute({ team_id: orphan.id }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(orphanPreview.candidates.length, 1)
    assert.equal(orphanPreview.recovered.length, 0)
    await assert.rejects(
      tools.get('team_recover').execute({ team_id: orphan.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_ACCEPTANCE_REQUIRED'
    )
    const stillOpen = JSON.parse(await readFile(orphanStoreFile, 'utf8')).teams.find(team => team.id === orphan.id)
    assert.notEqual(stillOpen.state, 'closed')
    assert.equal(stillOpen.closure, undefined, 'failed orphan recovery cannot persist a succeeded receipt')
    const acceptedDocument = JSON.parse(await readFile(orphanStoreFile, 'utf8'))
    const acceptedTask = acceptedDocument.teams.find(team => team.id === orphan.id).tasks.find(task => task.id === 'orphan-unaccepted')
    const acceptedAt = new Date().toISOString()
    acceptedTask.state = 'completed'
    acceptedTask.completedAt = acceptedAt
    acceptedTask.acceptance = { taskId: acceptedTask.id, claimId: acceptedTask.claimId, leaseEpoch: acceptedTask.leaseEpoch, acceptedAt, acceptedBy: orphan.rootLeadSessionId, ownerEpoch: orphan.pauseEpoch ?? 0 }
    await writeFile(orphanStoreFile, `${JSON.stringify(acceptedDocument, null, 2)}\n`, 'utf8')
    const orphanRecovery = await tools.get('team_recover').execute({ team_id: orphan.id, confirm: true }, { agent: recoveryAgent, signal: new AbortController().signal })
    assert.equal(orphanRecovery.recovered[0].state, 'closed')
    assert.equal(orphanRecovery.recovered[0].closure.outcome, 'succeeded')
    leadAvailable = true
    activeInitiator = rootAgent

    const beforeEmptyRootAuthorization = autopilotAuthorizationConsumptions.length
    const enableEmptyRootAutopilot = await invoke(routes.get('/api/agent-teams/action'), hostAuthorizedSettingsRequest({
      sessionId: rootAgent.id, action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: true, autopilotMaxAdditionalRounds: 200
    }, 'host-settings-empty-root-autopilot'))
    assert.equal(enableEmptyRootAutopilot.status, 200, enableEmptyRootAutopilot.body)
    assert.equal(autopilotAuthorizationConsumptions.length, beforeEmptyRootAuthorization + 1, 'trusted Save records the default-on preference before a team exists')
    assert.equal(autopilotAuthorizationConsumptions.at(-1).hostAuthorization, null)
    const persistedPreference = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
    assert.equal(persistedPreference.settings.autopilotEnabled, true)
    assert.equal(persistedPreference.settings.autopilotMaxAdditionalRounds, 200)
    currentGoal = {
      id: 'goal-autopilot-team', revision: 4, objective: 'Finish automatic implementation and verification without asking for continue',
      phase: 'active', activation: 'armed', roundsStarted: 2, maxGoalRounds: 4
    }
    rootAgent.session.events.push(
      { type: 'turn/end', data: {} },
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'goal', goalId: currentGoal.id, revision: currentGoal.revision, round: currentGoal.roundsStarted } } }
    )
    const automaticRoute = await tools.get('team_route_goal').execute({
      level: 'level3', reason_category: 'independent_sustained_workstreams', candidate_workstreams: 2, creation_path: 'team_start'
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(automaticRoute.receipt.outcome, 'recorded')
    assert.equal(automaticRoute.receipt.goalId, currentGoal.id)
    assert.equal(automaticRoute.receipt.goalRevision, currentGoal.revision)
    assert.equal(automaticRoute.receipt.goalRound, currentGoal.roundsStarted)
    const automaticStarted = await tools.get('team_start').execute({
      request_id: 'goal-round-team-start', objective: 'Create a safe team without asking the user to continue', candidate_workstreams: 2
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(automaticStarted.routing.receipt.outcome, 'created')
    assert.equal(automaticStarted.team.rootLeadSessionId, rootAgent.id)
    assert.equal(automaticStarted.team.autopilot.status, 'pending_plan', 'the trusted preference Save supplies the Host proof for the first exact Goal-round team')
    const hostProvedPersisted = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8')).teams.find(team => team.id === automaticStarted.team.id)
    assert.equal(hostProvedPersisted.autopilot.goalId, currentGoal.id)
    assert.equal(hostProvedPersisted.autopilot.authorizationEpoch, autopilotAuthorizationEpoch)
    await tools.get('team_shutdown').execute({ team_id: automaticStarted.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })

    currentGoal = { ...currentGoal, roundsStarted: 4, phase: 'active', activation: 'armed' }
    rootAgent.session.events.push(
      { type: 'turn/end', data: {} },
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'goal', goalId: currentGoal.id, revision: currentGoal.revision, round: currentGoal.roundsStarted } } }
    )
    const automaticBootstrap = await tools.get('team_bootstrap').execute({
      request_id: 'goal-autopilot-bootstrap', objective: 'Bootstrap isolated implementation and test work automatically', candidate_workstreams: 2,
      tasks: [
        { key: 'code', title: 'Implement isolated change', member_key: 'code', files: ['src/autopilot-code.js'] },
        { key: 'test', title: 'Verify isolated behavior', member_key: 'test', files: ['tests/autopilot-test.js'] }
      ],
      members: [
        { key: 'code', name: 'Code', role: 'implementation', prompt: 'Implement the isolated automatic continuation change.' },
        { key: 'test', name: 'Test', role: 'verification', prompt: 'Verify the isolated automatic continuation behavior.' }
      ]
    }, { agent: rootAgent, signal: new AbortController().signal })
    assert.equal(automaticBootstrap.routing.receipt.outcome, 'created')
    assert.equal(automaticBootstrap.operation.phase, 'complete')
    assert.equal(automaticBootstrap.team.autopilot, undefined, 'shutdown revocation clears the Host proof before a later automatic team')
    assert.equal(automaticBootstrap.team.members.filter(member => member.kind === 'worker').length, 2)
    await tools.get('team_shutdown').execute({ team_id: automaticBootstrap.team.id, force: true }, { agent: rootAgent, signal: new AbortController().signal })
    currentGoal = undefined
  } finally {
    for (const cleanup of effectCleanups.reverse()) await cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

test('external store edits are refreshed and preserved by the next serialized mutation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-external-store-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?external-store=${Date.now()}-${Math.random()}`)
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    await store.mutate(document => { document.settings.enabled = true })
    const team = await mod.createTeam(store, { id: 'external-root' }, { objective: 'Original objective' })
    const external = JSON.parse(await readFile(file, 'utf8'))
    external.teams.find(candidate => candidate.id === team.id).objective = 'Objective replaced by an external recovery editor with a different byte length'
    await writeFile(file, `${JSON.stringify(external)}\n`, 'utf8')

    let publishedObjective
    const unsubscribe = store.subscribe(document => { publishedObjective = document.teams.find(candidate => candidate.id === team.id)?.objective })
    await mod.createTask(store, { id: 'external-root' }, { teamId: team.id, title: 'Mutation after external edit' })
    unsubscribe()

    const merged = await store.read(document => document.teams.find(candidate => candidate.id === team.id))
    assert.equal(merged.objective, external.teams[0].objective)
    assert.equal(merged.tasks.at(-1).title, 'Mutation after external edit')
    assert.equal(publishedObjective, external.teams[0].objective)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('explicit user stop cancels queued wakeups and leaves paused work dormant', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-user-stop-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?user-stop=${Date.now()}-${Math.random()}`)
    const store = new mod.AgentTeamsStore(file)
    await store.init()
    await store.mutate(document => { document.settings.enabled = true })
    const leadSession = { id: 'stopped-root', header: { cwd: root } }
    const lead = { id: leadSession.id, session: leadSession, cancelCalls: [], cancel(reason) { this.cancelCalls.push(reason) } }
    const team = await mod.createTeam(store, lead, { objective: 'Remain stopped after explicit cancellation' })
    const timestamp = new Date().toISOString()
    await store.mutate(document => {
      const current = document.teams.find(candidate => candidate.id === team.id)
      current.members.push({ id: 'stop-worker', sessionId: 'stop-child', name: 'StopWorker', role: 'stop regression', kind: 'worker', state: 'running', createdAt: timestamp, updatedAt: timestamp })
      current.tasks.push({ id: 'stop-task', title: 'Queued work', state: 'in_progress', dependsOn: [], files: [], assigneeSessionId: 'stop-child', createdAt: timestamp, updatedAt: timestamp, claimedAt: timestamp })
    })

    const handlers = {}
    const interrupts = []
    const starts = []
    const ctx = {
      on(name, handler) { handlers[name] = handler },
      agents: { get: id => id === lead.id ? lead : undefined },
      subagents: {
        interrupt(id, authority) { interrupts.push({ id, authority }) },
        async drainContinuableChildren(_parent, ids) { assert.deepEqual(ids, ['stop-child']) },
        async startContinuable(spec) { starts.push(spec) }
      },
      logger: { warn() {} }
    }
    let resolvePaused
    const paused = new Promise(resolve => { resolvePaused = resolve })
    const unsubscribe = store.subscribe(document => {
      const current = document.teams.find(candidate => candidate.id === team.id)
      if (current?.state === 'paused' && current.members.find(member => member.sessionId === 'stop-child')?.state === 'ready') resolvePaused()
    })
    const admission = mod.createTeamTurnAdmission({ limit: 1, waitMs: 1_000 })
    const blocker = { id: 'stop-admission-blocker' }
    await admission.run(blocker, 'stop-blocker-child', new AbortController().signal, async () => admission.noteStart({ id: 'stop-blocker-child', runId: 'stop-blocker-run' }))
    const queuedWorker = admission.run(lead, 'stop-queued-child', new AbortController().signal, async () => assert.fail('explicit Stop must cancel queued worker admission'))
    const queuedCancelled = assert.rejects(queuedWorker, error => error?.code === 'AGENT_TEAMS_ADMISSION_CANCELLED')
    mod.observeUserStops(ctx, store, Promise.resolve(), admission)
    handlers['session/event'](leadSession, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } })
    await queuedCancelled
    await paused
    unsubscribe()
    await new Promise(resolve => setImmediate(resolve))

    const stopped = await store.read(document => document.teams.find(candidate => candidate.id === team.id))
    assert.deepEqual(lead.cancelCalls, [{ kind: 'user' }])
    assert.deepEqual(interrupts, [], 'child shutdown happens through the post-persistence drain path')
    assert.equal(stopped.state, 'paused')
    assert.equal(stopped.tasks[0].state, 'pending')
    assert.equal(stopped.tasks[0].assigneeSessionId, 'stop-child')
    assert.equal(starts.length, 0)
    assert.equal(admission.noteEnd({ id: 'stop-blocker-child', runId: 'stop-blocker-run' }), true)
    admission.close()
    await assert.rejects(
      mod.updateTask(store, { id: 'stop-child' }, { teamId: team.id, taskId: 'stop-task', action: 'claim' }),
      error => error?.code === 'AGENT_TEAMS_PAUSED'
    )
    assert.equal((await store.read(document => document.teams.find(candidate => candidate.id === team.id).state)), 'paused')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tool lifecycle stays consistently paused from explicit Stop through status, claim, and resume', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-tool-stop-'))
  const previousHome = process.env.DSH_HOME
  const cleanups = []
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?tool-stop=${Date.now()}-${Math.random()}`)
    const tools = new Map(), routes = new Map(), handlers = new Map()
    const session = {
      id: 'tool-stop-lead',
      header: { cwd: root },
      events: [
        { type: 'turn/start', data: {} },
        { type: 'user/message', data: { source: { kind: 'user' } } }
      ]
    }
    const lead = {
      id: session.id, session, status: 'running', options: { provider: 'test-provider', model: 'test-model' },
      inbox: { nextTurn: [], nextStep: [], remove() { return false } },
      cancel() {}, followup() {}, steer() {}
    }
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      get: () => undefined,
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard() { return () => {} } },
      systemPrompt: { section() { return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) },
      agents: { get(id) { return id === lead.id ? lead : undefined }, roots() { return [lead] }, currentInitiator() { return lead } },
      subagents: { interrupt() {}, async drainContinuableChildren(_parent, ids) { assert.deepEqual(ids, []) } }
    }
    mod.apply(ctx)
    const enabled = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: false, autopilotMaxAdditionalRounds: 200
    }))
    assert.equal(enabled.status, 200)
    const started = await startTeam(tools, { objective: 'Keep Stop lifecycle consistent' }, { agent: lead, signal: new AbortController().signal })
    const task = (await tools.get('team_task_create').execute({ team_id: started.team.id, title: 'Resume only after explicit confirmation' }, { agent: lead, signal: new AbortController().signal })).task
    const planned = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: lead, signal: new AbortController().signal })
    await tools.get('team_plan_commit').execute({ team_id: started.team.id, expected_revision: planned.team.plan.revision, confirmed_plan_hash: planned.team.plan.hash }, { agent: lead, signal: new AbortController().signal })

    const stopEvent = { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }
    session.events.push(stopEvent)
    handlers.get('session/event')(session, stopEvent)
    session.events.push(
      { type: 'turn/start', data: {} },
      { type: 'user/message', data: { source: { kind: 'user' } } }
    )

    const stoppedStatus = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: lead, signal: new AbortController().signal })
    assert.equal(stoppedStatus.team.status, 'paused')
    assert.equal(stoppedStatus.teams[0].status, 'paused')
    await assert.rejects(
      tools.get('team_task_update').execute({ team_id: started.team.id, task_id: task.id, action: 'claim' }, { agent: lead, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_PAUSED'
    )

    const resumePreview = await tools.get('team_resume').execute({ team_id: started.team.id }, { agent: lead, signal: new AbortController().signal })
    assert.equal(resumePreview.phase, 'preview')
    const resumeCommitArgs = { team_id: started.team.id, request_id: resumePreview.preview.requestId, commit: true, preview_id: resumePreview.preview.previewId, expected_pause_epoch: resumePreview.preview.pauseEpoch, expected_team_revision: resumePreview.preview.teamRevision }
    const resumed = await tools.get('team_resume').execute(resumeCommitArgs, { agent: lead, signal: new AbortController().signal })
    assert.equal(resumed.team.status, 'active')
    assert.equal(resumed.resumePlan.automaticallyWoken, false)
    const activeStatus = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: lead, signal: new AbortController().signal })
    assert.equal(activeStatus.team.status, 'active')
    const claimed = await tools.get('team_task_update').execute({ team_id: started.team.id, task_id: task.id, action: 'claim' }, { agent: lead, signal: new AbortController().signal })
    assert.equal(claimed.task.state, 'in_progress')
    const duplicateResume = await tools.get('team_resume').execute(resumeCommitArgs, { agent: lead, signal: new AbortController().signal })
    assert.equal(duplicateResume.reused, true)
    const statusAfterDuplicateResume = await tools.get('team_status').execute({ team_id: started.team.id }, { agent: lead, signal: new AbortController().signal })
    assert.equal(statusAfterDuplicateResume.team.status, 'active')
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(root, { recursive: true, force: true })
  }
})

test('bounded bootstrap is durable, replay-safe, task-first, and fail-closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-bootstrap-'))
  const previousHome = process.env.DSH_HOME
  const cleanups = []
  process.env.DSH_HOME = root
  try {
    const mod = await import(`${pathToFileURL(pluginFile).href}?bootstrap=${Date.now()}-${Math.random()}`)
    const tools = new Map(), routes = new Map(), starts = [], followups = [], drains = []
    let failWork = false
    const lead = {
      id: 'bootstrap-lead', status: 'running', options: { provider: 'main-provider', model: 'main-model' },
      session: { header: { cwd: root }, events: [{ type: 'turn/start', data: {} }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } },
      inbox: { nextTurn: [], nextStep: [], remove() { return false } }, followup() {}, steer() {}
    }
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      get: () => undefined,
      tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, guard() { return () => {} } },
      systemPrompt: { section() { return () => {} } },
      webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
      effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
      on() { return () => {} },
      agents: { get(id) { return id === lead.id ? lead : undefined }, roots() { return [lead] }, currentInitiator() { return lead } },
      subagents: {
        async startContinuable(spec) {
          const persisted = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
          const team = persisted.teams.find(candidate => candidate.bootstrap?.requestId === 'bootstrap-once')
          assert.equal(team.tasks.length, 3, 'all tasks must be durable before any child starts')
          starts.push(spec)
          return { childId: spec.childId, messageId: `start-${starts.length}` }
        },
        async [queueSubagentPrompt](parent, childId, content) {
          const persisted = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
          if (followups.length < 2 || failWork) assert.ok(persisted.teams.some(team => team.tasks.some(task => task.assigneeSessionId === childId)), 'bootstrap task binding must publish before work followup')
          followups.push({ parent, childId, content })
          if (failWork) throw new Error('bootstrap work followup failed')
          return `followup-${followups.length}`
        },
        async drainContinuableChildren(parent, childIds) { drains.push({ parent, childIds: [...childIds] }) }
      }
    }
    mod.apply(ctx)
    const enabled = await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', {
      sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4,
      autopilotEnabled: false, autopilotMaxAdditionalRounds: 200
    }))
    assert.equal(enabled.status, 200, enabled.body)
    openDirectHumanTurn(lead)
    const conflictingScopes = {
      request_id: 'bootstrap-overlap', objective: 'Reject unsafe parallel writes', candidate_workstreams: 2,
      tasks: [
        { key: 'left-task', title: 'Left', member_key: 'left', files: ['src/shared'] },
        { key: 'right-task', title: 'Right', member_key: 'right', files: ['src/shared/nested.js'] }
      ],
      members: [
        { key: 'left', name: 'Left', role: 'left writer', prompt: 'Write only the left scope.' },
        { key: 'right', name: 'Right', role: 'right writer', prompt: 'Write only the right scope.' }
      ]
    }
    await assert.rejects(
      tools.get('team_bootstrap').execute(conflictingScopes, { agent: lead, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_BOOTSTRAP_SCOPE_CONFLICT'
    )
    assert.equal(starts.length, 0, 'scope conflict must fail before team members start')
    openDirectHumanTurn(lead)
    const args = {
      request_id: 'bootstrap-once', objective: 'Build and review safely', candidate_workstreams: 2,
      tasks: [
        { key: 'build-task', title: 'Build', member_key: 'build', files: ['src/build'] },
        { key: 'build-detail', title: 'Build detail', member_key: 'build', files: ['src/build/generated.js'] },
        { key: 'review-task', title: 'Review', member_key: 'review', depends_on: ['build-task'], files: ['tests/build.test.js'] }
      ],
      members: [
        { key: 'build', name: 'Build', role: 'build safely', prompt: 'Claim and complete the build task.' },
        { key: 'review', name: 'Review', role: 'review safely', prompt: 'Review after the dependency completes.' }
      ]
    }
    const first = await tools.get('team_bootstrap').execute(args, { agent: lead, signal: new AbortController().signal })
    assert.equal(first.operation.phase, 'complete', JSON.stringify(first.error))
    assert.equal(first.operation.reused, false)
    assert.equal(starts.length, 2)
    assert.equal(first.team.tasks.length, 3)
    assert.ok(first.team.tasks.every(task => task.assignee !== null))
    assert.match(followups[0].content[0].text, new RegExp(first.taskRefs[0].taskId))
    assert.match(followups[0].content[0].text, new RegExp(first.taskRefs[1].taskId))
    assert.match(followups[1].content[0].text, new RegExp(first.taskRefs[2].taskId))
    assert.equal(first.team.attention.required, false)
    assertLosslessJson(first)

    openDirectHumanTurn(lead)
    const replay = await tools.get('team_bootstrap').execute(args, { agent: lead, signal: new AbortController().signal })
    openDirectHumanTurn(lead)
    await assert.rejects(
      tools.get('team_bootstrap').execute({ ...args, objective: 'Different input' }, { agent: lead, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_IDEMPOTENCY_CONFLICT'
    )
    assert.equal(replay.operation.reused, true)
    assert.equal(starts.length, 2, 'exact replay must not provision duplicate members')

    await assert.rejects(
      tools.get('team_bootstrap').execute({ ...args, request_id: 'not-a-worker-call' }, { agent: { ...lead, id: 'worker' }, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_DRIVER_REQUIRED'
    )

    const pausedFile = JSON.parse(await readFile(path.join(root, 'storages', 'agent_teams.json'), 'utf8'))
    pausedFile.teams.find(team => team.id === first.team.id).state = 'paused'
    await writeFile(path.join(root, 'storages', 'agent_teams.json'), `${JSON.stringify(pausedFile)}\n`, 'utf8')
    await invoke(routes.get('/api/agent-teams/action'), request('POST', '/api/agent-teams/action', { sessionId: 'settings', action: 'settings', enabled: true, maxMembers: 4, maxActiveTurns: 4 }))
    const startsBeforeResume = starts.length
    const preview = await tools.get('team_resume').execute({ team_id: first.team.id }, { agent: lead, signal: new AbortController().signal })
    const resumed = await tools.get('team_resume').execute({ team_id: first.team.id, request_id: preview.preview.requestId, commit: true, preview_id: preview.preview.previewId, expected_pause_epoch: preview.preview.pauseEpoch, expected_team_revision: preview.preview.teamRevision }, { agent: lead, signal: new AbortController().signal })
    assert.equal(resumed.resumePlan.automaticallyWoken, false)
    assert.equal(starts.length, startsBeforeResume)
    assert.equal(resumed.resumePlan.pendingAssignedTaskIds.length, 3)

    const retired = await tools.get('team_shutdown').execute({ member_session_id: first.memberRefs[0].sessionId, force: true }, { agent: lead, signal: new AbortController().signal })
    assert.equal(retired.member.state, 'retired')
    assert.deepEqual(retired.releasedTaskIds, [first.taskRefs[0].taskId, first.taskRefs[1].taskId])
    const status = await tools.get('team_status').execute({}, { agent: lead, signal: new AbortController().signal })
    assert.equal(status.team.tasks.find(task => task.id === first.taskRefs[0].taskId).assignee, null)
    const inferredSpawn = await tools.get('team_spawn').execute({ task_ids: [first.taskRefs[0].taskId], name: 'Ops', role: 'single-team inference', prompt: 'Work only in the uniquely active team.' }, { agent: lead, signal: new AbortController().signal })
    assert.equal(inferredSpawn.teamId, first.team.id)

    failWork = true
    openDirectHumanTurn(lead)
    const failed = await tools.get('team_bootstrap').execute({ request_id: 'bootstrap-failure', objective: 'Fail safely', candidate_workstreams: 2, tasks: [{ key: 'one', title: 'One', member_key: 'worker' }], members: [{ key: 'worker', name: 'Test', role: 'test failure', prompt: 'Fail the work followup.' }] }, { agent: lead, signal: new AbortController().signal })
    assert.equal(failed.operation.phase, 'partial')
    assert.equal(failed.error.stage, 'work-followup')
    assert.equal(failed.error.retryable, false)
    assert.ok(failed.team.attention.codes.includes('failed_member'))
    const failedStartCount = starts.length
    openDirectHumanTurn(lead)
    const failedReplay = await tools.get('team_bootstrap').execute({ request_id: 'bootstrap-failure', objective: 'Fail safely', candidate_workstreams: 2, tasks: [{ key: 'one', title: 'One', member_key: 'worker' }], members: [{ key: 'worker', name: 'Test', role: 'test failure', prompt: 'Fail the work followup.' }] }, { agent: lead, signal: new AbortController().signal })
    assert.equal(failedReplay.error.retryable, false)
    assert.equal(starts.length, failedStartCount, 'uncertain partial replay must fail closed')
    await assert.rejects(
      tools.get('team_spawn').execute({ task_ids: [failed.taskRefs[0].taskId], name: 'Ambiguous', role: 'must not start', prompt: 'Do not infer between peer teams.' }, { agent: lead, signal: new AbortController().signal }),
      error => error?.code === 'AGENT_TEAMS_TEAM_REQUIRED'
    )
    assert.ok(drains.length >= 2)
  } finally {
    process.env.DSH_HOME = previousHome
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('resolveProjectFoundationHostOptions reads the optional service through the Cordis lookup only', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const mod = await import(`${pathToFileURL(pluginFile).href}?foundation-host-options=${Date.now()}-${Math.random()}`)
  const source = await readFile(pluginFile, 'utf8')
  assert.doesNotMatch(source, /ctx\.projectFoundations\?\./u, 'apply must never touch the optional service by direct property access')
  assert.match(source, /, resolveProjectFoundationHostOptions\(ctx\)\)/u, 'apply must call the Host options resolver exactly once')
  assert.ok(source.match(/, resolveProjectFoundationHostOptions\(ctx\)\)/gu).length === 1, 'apply must call the resolver once')
  assert.deepEqual(mod.inject.includes('projectFoundations'), false, 'the optional service must never join the required inject list')

  // Missing or non-record provider resolves to an empty object without throwing.
  const missing = new Context()
  assert.deepEqual(mod.resolveProjectFoundationHostOptions(missing), {})
  const withGet = new Context()
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => undefined }), {})
  const weird = new Context()
  weird.provide('projectFoundations', 'not-a-record')
  assert.deepEqual(mod.resolveProjectFoundationHostOptions(weird), {})

  // An active record provider is projected onto exactly the fixed Host fields.
  const provided = new Context()
  const record = {
    runner: { handle: 'desktop-runner' },
    connector: { enabled: true, name: 'desktop-connector' },
    runnerEvidence: { evidence: true },
    extra: 'never projected'
  }
  provided.provide('projectFoundations', record)
  assert.deepEqual(mod.resolveProjectFoundationHostOptions(provided), {
    runner: record.runner,
    connector: record.connector,
    runnerEvidenceProvider: record.runnerEvidence
  })

  // A disabled connector is dropped while runner and evidence stay projected.
  const disabled = new Context()
  disabled.provide('projectFoundations', { runner: record.runner, connector: { enabled: false }, runnerEvidence: record.runnerEvidence })
  assert.deepEqual(mod.resolveProjectFoundationHostOptions(disabled), {
    runner: record.runner,
    connector: undefined,
    runnerEvidenceProvider: record.runnerEvidence
  })

  // The old direct property access is the captured regression: it throws inside
  // a real Cordis fiber while ctx.get stays the non-throwing optional boundary.
  const runtime = new Context()
  const attempts = []
  runtime.plugin({
    name: 'foundation-host-options-probe',
    inject: {},
    apply(fiberCtx) {
      let directError
      try { fiberCtx.projectFoundations } catch (error) { directError = error?.message }
      attempts.push({ directError, viaGet: fiberCtx.get('projectFoundations'), options: mod.resolveProjectFoundationHostOptions(fiberCtx) })
    }
  })
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts.length, 1)
  assert.match(attempts[0].directError, /cannot get property "projectFoundations" without inject/u)
  assert.equal(attempts[0].viaGet, undefined, 'the lookup is the supported non-throwing optional boundary')
  assert.deepEqual(attempts[0].options, {})
})

test('resolveProjectFoundationHostOptions never reads accessors, proxies, classes, or inherited fields', async () => {
  const mod = await import(`${pathToFileURL(pluginFile).href}?foundation-boundary=${Date.now()}-${Math.random()}`)

  // Accessor descriptors must fail closed without running the getter.
  let runnerGetterRuns = 0
  let connectorGetterRuns = 0
  let evidenceGetterRuns = 0
  const engineered = {}
  Object.defineProperty(engineered, 'runner', { enumerable: true, get() { runnerGetterRuns += 1; return { handle: 'trapped-runner' } } })
  Object.defineProperty(engineered, 'connector', { enumerable: true, get() { connectorGetterRuns += 1; return { enabled: true } } })
  Object.defineProperty(engineered, 'runnerEvidence', { enumerable: true, get() { evidenceGetterRuns += 1; return { evidence: true } } })
  const accessorResult = mod.resolveProjectFoundationHostOptions({ get: () => engineered })
  assert.deepEqual(accessorResult, {}, 'accessor-erected fields must fail closed to an empty object')
  assert.equal(runnerGetterRuns, 0)
  assert.equal(connectorGetterRuns, 0)
  assert.equal(evidenceGetterRuns, 0)

  // Proxy traps must never be permitted to produce projections. Node's
  // util/types brand check rejects any Proxy without invoking a trap, so a
  // normal, getPrototypeOf-throwing, or revoked Proxy all fail closed with
  // zero trap invocations.
  let proxyGetRuns = 0
  let proxyGetPrototypeOfRuns = 0
  const proxied = new Proxy({ runner: { handle: 'p' }, connector: { enabled: true }, runnerEvidence: { e: 1 } }, {
    get(target, prop, receiver) { proxyGetRuns += 1; return Reflect.get(target, prop, receiver) },
    getPrototypeOf() { proxyGetPrototypeOfRuns += 1; return Object.prototype }
  })
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => proxied }), {}, 'proxy-wrapped providers must fail closed without reading through the trap')
  assert.equal(proxyGetRuns, 0)
  assert.equal(proxyGetPrototypeOfRuns, 0)

  // A getPrototypeOf-throwing Proxy must also fail closed with zero trap runs.
  const throwingProxyRuns = { get: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 }
  const throwingProxy = new Proxy({ runner: { handle: 't' }, connector: { enabled: true }, runnerEvidence: { e: 1 } }, {
    get(target, prop, receiver) { throwingProxyRuns.get += 1; return Reflect.get(target, prop, receiver) },
    getPrototypeOf() { throwingProxyRuns.getPrototypeOf += 1; throw new Error('getPrototypeOf trap must not run') },
    getOwnPropertyDescriptor() { throwingProxyRuns.getOwnPropertyDescriptor += 1; throw new Error('descriptor trap must not run') }
  })
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => throwingProxy }), {}, 'getPrototypeOf-throwing proxies must fail closed')
  assert.deepEqual(throwingProxyRuns, { get: 0, getPrototypeOf: 0, getOwnPropertyDescriptor: 0 })

  // A revoked Proxy must fail closed without any trap or reflective error.
  const { proxy: revokedProxy, revoke } = Proxy.revocable({ runner: { handle: 'r2' }, connector: { enabled: true }, runnerEvidence: { e: 1 } }, {})
  revoke()
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => revokedProxy }), {}, 'revoked proxies must fail closed')

  // A Proxy hiding inside the connector must also fail closed without traps.
  let connectorProxyRuns = 0
  let connectorProxyPrototypeOfRuns = 0
  const connectorProxy = new Proxy({ enabled: true }, {
    get(target, prop, receiver) { connectorProxyRuns += 1; return Reflect.get(target, prop, receiver) },
    getPrototypeOf() { connectorProxyPrototypeOfRuns += 1; return Object.prototype }
  })
  const connectorWrapped = { runner: { handle: 'cw' }, connector: connectorProxy, runnerEvidence: { e: 1 } }
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => connectorWrapped }), {
    runner: connectorWrapped.runner,
    connector: undefined,
    runnerEvidenceProvider: connectorWrapped.runnerEvidence
  }, 'a Proxy connector must be dropped without triggering its traps')
  assert.equal(connectorProxyRuns, 0)
  assert.equal(connectorProxyPrototypeOfRuns, 0)

  // A getPrototypeOf-throwing Proxy inside the connector must fail closed with
  // zero trap invocations; runner and evidence stay projected.
  const throwingConnectorRuns = { getPrototypeOf: 0 }
  const throwingConnector = new Proxy({ enabled: true }, {
    getPrototypeOf() { throwingConnectorRuns.getPrototypeOf += 1; throw new Error('connector getPrototypeOf trap must not run') }
  })
  const throwingConnectorWrapped = { runner: { handle: 'tc' }, connector: throwingConnector, runnerEvidence: { e: 1 } }
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => throwingConnectorWrapped }), {
    runner: throwingConnectorWrapped.runner,
    connector: undefined,
    runnerEvidenceProvider: throwingConnectorWrapped.runnerEvidence
  }, 'a getPrototypeOf-throwing Proxy connector must be dropped fail-closed')
  assert.deepEqual(throwingConnectorRuns, { getPrototypeOf: 0 })

  // A revoked Proxy inside the connector must also fail closed without error.
  const { proxy: revokedConnector, revoke: revokeConnector } = Proxy.revocable({ enabled: true }, {})
  revokeConnector()
  const revokedConnectorWrapped = { runner: { handle: 'rc' }, connector: revokedConnector, runnerEvidence: { e: 1 } }
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => revokedConnectorWrapped }), {
    runner: revokedConnectorWrapped.runner,
    connector: undefined,
    runnerEvidenceProvider: revokedConnectorWrapped.runnerEvidence
  }, 'a revoked Proxy connector must be dropped without reflective error')

  // Class instances (non-plain prototype) must fail closed.
  class FakeRunner { constructor() { this.handle = 'class-runner' } }
  const classRecord = Object.create(Object.getPrototypeOf(new FakeRunner()))
  Object.defineProperty(classRecord, 'runner', { value: { handle: 'class-runner' }, enumerable: true })
  Object.defineProperty(classRecord, 'connector', { value: { enabled: true }, enumerable: true })
  Object.defineProperty(classRecord, 'runnerEvidence', { value: { e: 1 }, enumerable: true })
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => classRecord }), {}, 'class-backed providers must fail closed')

  // Inherited own-data fields: a provider with a non-plain prototype (inheriting
  // from another record) must fail closed entirely; nothing inherited can leak.
  const parentRecord = { runner: { handle: 'inherited-runner' } }
  const inherited = Object.create(parentRecord)
  Object.defineProperty(inherited, 'connector', { value: { enabled: true }, enumerable: true })
  Object.defineProperty(inherited, 'runnerEvidence', { value: { e: 1 }, enumerable: true })
  const inheritedResult = mod.resolveProjectFoundationHostOptions({ get: () => inherited })
  assert.deepEqual(inheritedResult, {}, 'a provider whose prototype is another record must fail closed without projecting inherited fields')

  // Null-prototype plain records are accepted and project fully.
  const nullProto = Object.create(null)
  nullProto.runner = { handle: 'null-runner' }
  nullProto.connector = { enabled: true }
  nullProto.runnerEvidence = { e: 1 }
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => nullProto }), {
    runner: nullProto.runner,
    connector: nullProto.connector,
    runnerEvidenceProvider: nullProto.runnerEvidence
  }, 'null-prototype plain records remain a supported provider shape')

  // Connector must itself be a plain own-data record with own enabled === true.
  const getterConnector = {}
  let enabledGetterRuns = 0
  Object.defineProperty(getterConnector, 'enabled', { enumerable: true, get() { enabledGetterRuns += 1; return true } })
  const getterConnectorRecord = { runner: { handle: 'r' }, connector: getterConnector, runnerEvidence: { e: 1 } }
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => getterConnectorRecord }), {
    runner: getterConnectorRecord.runner,
    connector: undefined,
    runnerEvidenceProvider: getterConnectorRecord.runnerEvidence
  }, 'connector.enabled must be an own data value, never a triggered accessor')
  assert.equal(enabledGetterRuns, 0)
  const inheritedEnabled = Object.create({ enabled: true })
  const inheritedEnabledRecord = { runner: { handle: 'r' }, connector: inheritedEnabled, runnerEvidence: { e: 1 } }
  assert.deepEqual(mod.resolveProjectFoundationHostOptions({ get: () => inheritedEnabledRecord }), {
    runner: inheritedEnabledRecord.runner,
    connector: undefined,
    runnerEvidenceProvider: inheritedEnabledRecord.runnerEvidence
  }, 'connector.enabled must be an own descriptor, never inherited')
})
