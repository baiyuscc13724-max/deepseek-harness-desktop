const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, writeFile, readFile, mkdir, symlink, rm } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const pluginFile = path.resolve(__dirname, '..', 'plugins/dsh-agent-teams/lib/index.js')

// Public registered tools and real isolated storage. Only the model runtime is
// substituted; no actual model, user profile, desktop authorization or network.
async function publicFixture(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'team-product-public-'))
  const oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const tools = new Map(), listeners = new Map(), cleanups = [], workers = []
  const lead = { id: 'product-lead', status: 'running', options: { provider: 'test', model: 'test' }, session: { header: { cwd: root }, events: [{ type: 'turn/start', id: 'human-turn' }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } } }
  lead.session.id = lead.id
  lead.cancel = () => {}
  const steers = [], queuedCalls = []
  let caller = lead
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }, get(name) { return tools.get(name) }, guard() { return () => {} } },
    systemPrompt: { section() { return () => {} } },
    webServer: { register() { return () => {} } },
    effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
    on(name, listener) { const entries = listeners.get(name) || []; entries.push(listener); listeners.set(name, entries); return () => entries.splice(entries.indexOf(listener), 1) },
    agents: { get(id) { return [lead, ...workers].find(agent => agent.id === id) }, roots() { return [lead] }, currentInitiator() { return caller } },
    subagents: {
      async startContinuable(spec) {
        workers.push({ id: spec.childId, status: 'running', options: { provider: 'test', model: 'test' }, session: { header: { cwd: root }, events: [{ type: 'turn/start', id: 'worker-turn' }, { type: 'user/message', data: { source: { kind: 'agent-message', form: 'relay', senderSessionId: lead.id } } }], snapshotEvents() { return this.events.slice() } } })
        workers.at(-1).session.header.parentSession = lead.id
        workers.at(-1).steer = message => { steers.push({ childId: spec.childId, message }) }
        for (const listener of listeners.get('subagent/start') || []) await listener({ id: spec.childId, runId: 'registration-run' })
        for (const listener of listeners.get('subagent/end') || []) await listener({ id: spec.childId, runId: 'registration-run', stopReason: 'completed' })
        return { childId: spec.childId, messageId: 'registration-only' }
      },
      async [Symbol.for('dsh.subagent.queuePrompt')](_parent, childId) {
        queuedCalls.push(childId)
        for (const listener of listeners.get('subagent/start') || []) await listener({ id: childId, runId: 'work-run' })
        if (!options.keepRunning) for (const listener of listeners.get('subagent/end') || []) await listener({ id: childId, runId: 'work-run', stopReason: 'completed' })
        return 'queued-work'
      },
      async drainContinuableChildren() {}
    }
  }
  if (options.skills) {
    const { Context } = await import('@deepseek-ai/cordis')
    const { SkillRegistry } = await import('@deepseek-ai/dsh-skill')
    const skillContext = new Context()
    new SkillRegistry(skillContext)
    ctx.skills = skillContext.skills
    const badge = await import('@deepseek-ai/dsh-skill-badge')
    badge.apply({ skills: { registerProvider(factory) { const dispose = skillContext.skills.registerProvider(factory); cleanups.push(dispose); return dispose } } })
    const loader = await import('@deepseek-ai/dsh-tool-skill')
    loader.apply(ctx)
  }
  const mod = await import(`${pathToFileURL(pluginFile).href}?product=${Date.now()}-${Math.random()}`)
  // Capture the instance used by the actual registered tools, without changing
  // its operation. Needed to compare the real hot task, not only a projection.
  let primaryStore
  const originalMutate = mod.AgentTeamsStore.prototype.mutate
  mod.AgentTeamsStore.prototype.mutate = function (...args) { primaryStore ||= this; return originalMutate.apply(this, args) }
  cleanups.push(() => { mod.AgentTeamsStore.prototype.mutate = originalMutate })
  mod.apply(ctx, { enabled: true, maxMembers: 4, maxActiveTurns: options.maxActiveTurns || 4, autopilotEnabled: false })
  const invoke = async (name, args, actor = lead) => { caller = actor; return tools.get(name).execute(args, { agent: actor }) }
  const cleanup = async () => { for (const close of cleanups.reverse()) await close(); if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; await rm(root, { recursive: true, force: true }) }
  let started
  try { started = await invoke('team_start', { request_id: 'product-public-start', objective: 'Verify professional delivery behavior', candidate_workstreams: 2 }) }
  catch (error) { await cleanup(); throw error }
  const teamId = started.teamId || started.team.id
  mod.AgentTeamsStore.prototype.mutate = originalMutate
  assert.ok(primaryStore, 'public tool store captured through its real mutation')
  const readHotTask = id => { assert.equal(primaryStore.storageMode, 'legacy'); return primaryStore.document.teams.find(team => team.id === teamId).tasks.find(task => task.id === id) }
  let skillObserver
  if (options.skills) {
    // Rebind the exact production observer, not its evidence helper, to the real
    // public-tool store. Its exported settle handle makes negative/race assertions
    // deterministic without fixed sleeps. All actual loader/events remain live.
    assert.equal(listeners.get('tools/execute').length, 1)
    assert.equal(listeners.get('tools/result').length, 1)
    listeners.set('tools/execute', []); listeners.set('tools/result', [])
    const observerStore = new mod.AgentTeamsStore(path.join(root, 'storages/agent_teams.json'))
    await observerStore.init()
    skillObserver = mod.observeTeamSkillLoads(ctx, observerStore)
    cleanups.push(async () => { await skillObserver.settle(); observerStore.close() })
  }
  const status = () => invoke('team_status', { team_id: teamId })
  const create = async (title, extra = {}) => (await invoke('team_task_create', { team_id: teamId, title, ...extra })).task
  const commit = async () => { const { team } = await status(); return invoke('team_plan_commit', { team_id: teamId, expected_revision: team.plan.revision, confirmed_plan_hash: team.plan.hash }) }
  const spawn = async task => { await commit(); const result = await invoke('team_spawn', { team_id: teamId, name: workers.length ? '复核' : '测试', role: 'ui-ux-pro-max', prompt: 'Verify this isolated fixture only.', task_ids: [task.id] }); return workers.find(worker => worker.id === (result.member?.sessionId || result.member?.id)) || workers.at(-1) }
  const claim = async (task, actor) => (await invoke('team_task_update', { team_id: teamId, task_id: task.id, action: 'claim' }, actor)).task
  const update = (task, action, actor, extra = {}) => invoke('team_task_update', { team_id: teamId, task_id: task.id, action, claim_id: task.claimId, lease_epoch: task.leaseEpoch, ...extra }, actor)
  const rootCommand = async (task, action, extra = {}) => { const { team } = await status(); const current = team.tasks.find(row => row.id === task.id); return invoke('team_task_update', { team_id: teamId, task_id: task.id, action, request_id: `product-${action}-${current.revision}`, expected_task_revision: current.revision, expected_pause_epoch: team.pauseEpoch, ...extra }) }
  const emit = async (name, ...args) => { for (const listener of listeners.get(name) || []) await listener(...args); if (name === 'tools/result') await skillObserver?.settle() }
  const stop = async () => { await emit('session/event', lead.session, { type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } }); return until(async () => { const result = await status(); return result.team.state === 'paused' ? result : false }) }
  return { root, lead, ctx, mod, tools, listeners, invoke, teamId, status, create, commit, spawn, claim, update, rootCommand, cleanup, emit, stop, steers, queuedCalls, readHotTask }
}

async function until(check, message = 'bounded event settlement') {
  const end = Date.now() + 3000
  do { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 5)) } while (Date.now() < end)
  assert.fail(message)
}

const delivery = () => ({ summary: 'Isolated behavior report', artifacts: [{ path: 'report.md' }], criteria: [{ criterion: 'Preserve claim and review gates', evidence: 'Public tools and durable state checked in this test.' }], limitations: ['Fixture model runtime; no production GUI or expert-quality claim.'] })

// Baseline gates deliberately run through public registration. The v1-specific
// artifact/skill cases are added after the implementation dependencies settle.
test('public general task works without skills; checkpoint is not delivery and stale claimant is rejected', async () => {
  const fx = await publicFixture()
  try {
    const task = await fx.create('General work without a skill requirement')
    const worker = await fx.spawn(task)
    const claimed = await fx.claim(task, worker)
    assert.equal(claimed.state, 'in_progress')
    assert.ok(claimed.claimId)
    await fx.invoke('team_task_checkpoint', { team_id: fx.teamId, task_id: task.id, claim_id: claimed.claimId, lease_epoch: claimed.leaseEpoch, checkpoint: 'A role label does not prove a skill was loaded.' }, worker)
    const current = (await fx.status()).team.tasks.find(row => row.id === task.id)
    assert.equal(current.state, 'in_progress')
    assert.equal(current.checkpoint.verified, false)
    assert.equal(current.submission, undefined)
    await assert.rejects(fx.update(claimed, 'complete', worker, { claim_id: 'obsolete-claim', delivery: delivery() }), /claim|lease/i)
    assert.equal((await fx.status()).team.tasks.find(row => row.id === task.id).state, 'in_progress')
  } finally { await fx.cleanup() }
})

test('public submission remains blocked until separate exact-root acceptance', async () => {
  const fx = await publicFixture()
  try {
    await writeFile(path.join(fx.root, 'report.md'), '# Fixture report\nPublic submission is not acceptance.\n')
    const first = await fx.create('Produce report')
    const second = await fx.create('Consume accepted report', { depends_on: [first.id] })
    const worker = await fx.spawn(first)
    const claimed = await fx.claim(first, worker)
    const submitted = (await fx.update(claimed, 'complete', worker, { delivery: delivery() })).task
    assert.equal(submitted.state, 'submitted')
    assert.equal(submitted.acceptance, undefined)
    await assert.rejects(fx.claim(second, fx.lead), /depend|block/i)
    const review = submitted.submission.id ? { submission_id: submitted.submission.id, summary: 'Read the current report and fixture assertions.', criteria: delivery().criteria, limitations: delivery().limitations } : undefined
    const accepted = (await fx.rootCommand(submitted, 'accept', review ? { review } : {})).task
    assert.equal(accepted.state, 'completed')
    assert.equal(accepted.acceptance.acceptedBy, fx.lead.id)
    assert.notEqual(accepted.acceptance.quality, 'host_verified')
    const downstream = await fx.claim(second, fx.lead)
    assert.equal(downstream.state, 'in_progress')
  } finally { await fx.cleanup() }
})

const inline = (content = 'OK') => ({ summary: content, content, criteria: [{ criterion: 'Short valid conclusion', evidence: 'Read the actual submitted text.' }] })
const reviewFor = (submission) => ({ submission_id: submission.id, summary: 'Read the bound content.', criteria: submission.delivery.criteria, limitations: ['Lead review is not a registered-runner quality pass.'] })

test('public v1 accepts short inline with write scope, rejects empty/forged input and binds exact review/replay', async () => {
  const fx = await publicFixture()
  try {
    const task = await fx.create('Short conclusion', { files: ['notes.md'], acceptance_criteria: ['Short valid conclusion'] })
    const worker = await fx.spawn(task), claim = await fx.claim(task, worker)
    for (const bad of [{ summary: 'Nothing', criteria: inline().criteria }, inline(' '), { ...inline(), contentHash: 'a'.repeat(64) }]) {
      await assert.rejects(fx.update(claim, 'submit', worker, { delivery: bad }), /delivery|content|unsupported|non-empty/i)
    }
    const submitted = (await fx.update(claim, 'submit', worker, { delivery: inline() })).task
    assert.equal(submitted.state, 'submitted')
    assert.equal(submitted.submission.deliveryMode, 'inline_bound')
    assert.equal(submitted.submission.delivery.contentHash, createHash('sha256').update('OK').digest('hex'))
    assert.equal(submitted.nextAction, 'review_submission')
    await assert.rejects(fx.rootCommand(submitted, 'accept', { review: { ...reviewFor(submitted.submission), submission_id: 'old-submission' } }), /submission/i)
    await assert.rejects(fx.update(claim, 'submit', worker, { delivery: inline('Changed') }), /replay|different|submission/i)
    const accepted = (await fx.rootCommand(submitted, 'accept', { review: reviewFor(submitted.submission) })).task
    assert.equal(accepted.acceptance.quality, 'lead_reviewed')
    assert.equal(accepted.nextAction, 'none')
    const persisted = await readFile(path.join(fx.root, 'storages/agent_teams.json'), 'utf8')
    assert.ok(!persisted.includes('host_verified'), 'ordinary review never manufactures Host proof')
    const restoredPath = path.join(fx.root, 'restored.json')
    await writeFile(restoredPath, persisted)
    const restored = new fx.mod.AgentTeamsStore(restoredPath)
    try {
      await restored.init()
      const recovered = await restored.read(document => document.teams.find(team => team.id === fx.teamId).tasks.find(row => row.id === task.id))
      assert.equal(recovered.state, 'completed')
      assert.equal(recovered.submission.id, submitted.submission.id)
      assert.equal(recovered.submission.delivery.content, 'OK')
      assert.equal(recovered.submission.delivery.contentHash, accepted.submission.delivery.contentHash)
      assert.equal(recovered.acceptance.quality, 'lead_reviewed')
      assert.equal(recovered.acceptance.review.submission_id, submitted.submission.id)
    } finally { restored.close() }
  } finally { await fx.cleanup() }
})

test('public file delivery rejects traversal/nonexistent/symlink escape and detects changed bytes before acceptance', async () => {
  const fx = await publicFixture()
  const outside = await mkdtemp(path.join(os.tmpdir(), 'team-artifact-outside-'))
  try {
    const task = await fx.create('File-bound report', { requires_file_artifact: true })
    const worker = await fx.spawn(task), claim = await fx.claim(task, worker)
    await assert.rejects(fx.update(claim, 'submit', worker, { delivery: inline() }), /file|artifact/i)
    for (const invalid of ['../outside.txt', 'C:\\outside.txt', '.git/config', 'missing.md']) {
      await assert.rejects(fx.update(claim, 'submit', worker, { delivery: { ...delivery(), artifacts: [{ path: invalid }] } }), /artifact|path|file|ENOENT/i)
    }
    await writeFile(path.join(outside, 'secret.md'), 'outside')
    await symlink(outside, path.join(fx.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(fx.update(claim, 'submit', worker, { delivery: { ...delivery(), artifacts: [{ path: 'linked/secret.md' }] } }), /symbolic|link|workspace|artifact/i)
    await writeFile(path.join(fx.root, 'report.md'), 'version one')
    const submitted = (await fx.update(claim, 'submit', worker, { delivery: delivery() })).task
    assert.equal(submitted.submission.delivery.artifacts[0].sha256, createHash('sha256').update('version one').digest('hex'))
    await writeFile(path.join(fx.root, 'report.md'), 'version two')
    await assert.rejects(fx.rootCommand(submitted, 'accept', { review: reviewFor(submitted.submission) }), error => error.code === 'AGENT_TEAMS_ARTIFACT_CHANGED')
    assert.equal((await fx.status()).team.tasks.find(row => row.id === task.id).state, 'submitted')
  } finally { await fx.cleanup(); await rm(outside, { recursive: true, force: true }) }
})

async function beginSkill(fx, worker, mutate = value => value) {
  const exec = { name: 'skill', token: {}, arguments: { name: 'dsh-badge' }, agent: worker, signal: new AbortController().signal }
  await fx.emit('tools/execute', exec, () => Promise.resolve())
  const value = mutate(await fx.tools.get('skill').execute(exec.arguments, exec))
  return { exec, result: { isError: false, value } }
}
async function currentTask(fx, id) { return (await fx.status()).team.tasks.find(row => row.id === id) }

test('real persistent SkillRegistry and skill loader produce exact current-call evidence; role and duplicate names do not certify', async () => {
  const fx = await publicFixture({ skills: true })
  try {
    await assert.rejects(fx.create('Invalid skill', { required_skills: ['../escape'] }), /skill|kebab/i)
    const task = await fx.create('Use badge instructions', { required_skills: ['dsh-badge', 'dsh-badge', 'not-installed'] })
    assert.deepEqual(task.requiredSkills, ['dsh-badge', 'not-installed'])
    const worker = await fx.spawn(task), claim = await fx.claim(task, worker)
    assert.equal(claim.professional.skills[0].status, 'bound')
    assert.equal(claim.professional.skills[1].status, 'missing')
    assert.equal(claim.professional.mode, 'missing_skills')
    const call = await beginSkill(fx, worker)
    await fx.emit('tools/result', call.exec, call.result)
    const loaded = await until(async () => { const row = await currentTask(fx, task.id); return row.professional.skills[0].status === 'loaded' ? row : false })
    const evidence = loaded.professional.skills[0].evidence
    assert.equal(evidence.provider, 'dsh-badge')
    assert.equal(evidence.origin, 'bundled')
    assert.equal(evidence.contentHash, createHash('sha256').update(call.result.value.content).digest('hex'))
    assert.equal(evidence.source, 'skill_tool')
    assert.ok(!JSON.stringify(loaded.professional).includes('resourceBase'))
    assert.ok(!JSON.stringify(loaded.professional).includes(call.result.value.content.slice(0, 80)))
    assert.match(loaded.professional.limitations.join(' '), /not professional certification/i)
    await fx.rootCommand(loaded, 'release')
    const nextClaim = await fx.claim(task, worker)
    assert.notEqual(nextClaim.claimId, claim.claimId)
    assert.equal(nextClaim.professional.skills[0].status, 'bound', 'a new claim requires a new actual load')
    await fx.emit('tools/result', call.exec, call.result)
    assert.equal((await currentTask(fx, task.id)).professional.skills[0].status, 'bound')
  } finally { await fx.cleanup() }
})

test('live tools event bus rejects forged/failed/wrong-scope/aborted results and results racing a new claim', async () => {
  const fx = await publicFixture({ skills: true })
  try {
    const task = await fx.create('Claim-bound loader', { required_skills: ['dsh-badge'] })
    const worker = await fx.spawn(task)
    await fx.claim(task, worker)
    for (const mode of ['forged', 'failed', 'scope', 'aborted', 'new-claim']) {
      const call = await beginSkill(fx, worker)
      const originalCwd = worker.session.header.cwd
      if (mode === 'forged') call.result.value.content += '\nForged model content'
      if (mode === 'failed') call.result.isError = true
      if (mode === 'scope') worker.session.header.cwd = path.dirname(originalCwd)
      if (mode === 'aborted') { const abort = new AbortController(); abort.abort(); call.exec.signal = abort.signal }
      if (mode === 'new-claim') { await fx.rootCommand(task, 'release'); await fx.claim(task, worker) }
      await fx.emit('tools/result', call.exec, call.result)
      // emit awaited the production observer's complete pending-work set.
      assert.equal((await currentTask(fx, task.id)).professional.skills[0].status, 'bound', mode)
      worker.session.header.cwd = originalCwd
    }
  } finally { await fx.cleanup() }
})

test('async loader verification races recheck Stop, new claim, current scope and exact live agent after await', async t => {
  for (const mode of ['stop', 'new-claim', 'scope', 'agent-replaced']) await t.test(mode, async () => {
    const fx = await publicFixture({ skills: true })
    const entered = Promise.withResolvers(), release = Promise.withResolvers()
    try {
      const task = await fx.create('Async evidence fence', { required_skills: ['dsh-badge'] })
      const worker = await fx.spawn(task)
      await fx.claim(task, worker)
      const call = await beginSkill(fx, worker)
      const actualRegistry = fx.ctx.skills
      fx.ctx.skills = {
        snapshot: actualRegistry.snapshot.bind(actualRegistry),
        async get(...args) { entered.resolve(); await release.promise; return actualRegistry.get(...args) }
      }
      const pending = fx.emit('tools/result', call.exec, call.result)
      await Promise.race([entered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('verification never entered')), 2000))])
      if (mode === 'stop') await fx.stop()
      if (mode === 'new-claim') { await fx.rootCommand(task, 'release'); await fx.claim(task, worker) }
      if (mode === 'scope') worker.session.header.cwd = path.dirname(fx.root)
      if (mode === 'agent-replaced') { const originalGet = fx.ctx.agents.get; fx.ctx.agents.get = id => id === worker.id ? { ...worker } : originalGet(id) }
      release.resolve()
      await pending
      const current = await currentTask(fx, task.id)
      assert.notEqual(current.professional.skills[0].status, 'loaded')
    } finally { release.resolve(); await fx.cleanup() }
  })
})

test('Stop fences a live skill result and old claimant submission before late verification commits', async () => {
  const fx = await publicFixture({ skills: true })
  try {
    const task = await fx.create('Stop-safe skill proof', { required_skills: ['dsh-badge'] })
    const worker = await fx.spawn(task), claim = await fx.claim(task, worker)
    const call = await beginSkill(fx, worker)
    await fx.stop()
    await fx.emit('tools/result', call.exec, call.result)
    await assert.rejects(fx.update(claim, 'submit', worker, { delivery: inline() }), /paused|stopp|lease|claim|not an active member/i)
    const current = await currentTask(fx, task.id)
    assert.notEqual(current.professional.skills[0].status, 'loaded')
    assert.notEqual(current.state, 'submitted')
  } finally { await fx.cleanup() }
})

test('root and peer relay to saturated running workers use existing slots and remain queued, never delivered', async () => {
  const fx = await publicFixture({ keepRunning: true, maxActiveTurns: 2 })
  try {
    const a = await fx.create('Worker A'), b = await fx.create('Worker B')
    const workerA = await fx.spawn(a), workerB = await fx.spawn(b)
    await fx.claim(a, workerA); await fx.claim(b, workerB)
    const queuedBefore = fx.queuedCalls.length
    const rootResult = await fx.invoke('team_message', { team_id: fx.teamId, recipient_session_id: workerA.id, message: 'Root review guidance' })
    const peerResult = await fx.invoke('team_message', { team_id: fx.teamId, recipient_session_id: workerA.id, message: 'Peer contract handoff' }, workerB)
    assert.equal(rootResult.message.status, 'queued')
    assert.equal(peerResult.message.status, 'queued')
    assert.equal(rootResult.message.deliveredAt, undefined)
    assert.equal(peerResult.message.deliveredAt, undefined)
    assert.equal(fx.steers.length, 2)
    assert.equal(fx.queuedCalls.length, queuedBefore, 'relay must not reserve another model activation')
    await fx.stop()
    await assert.rejects(fx.invoke('team_message', { team_id: fx.teamId, recipient_session_id: workerA.id, message: 'After Stop' }), /paused|stopp/i)
    assert.equal(fx.steers.length, 2)
  } finally { await fx.cleanup() }
})

// Independent public-tool coverage of task mutation awaits, distinct from the
// tools/result observer above. Accept caller is the root: its two label pairs
// intentionally repeat the same identities, not four independent attack types.
test('claim/submit/accept reject live source drift after actual awaits without changing any hot or cold task field', async t => {
  const fs = require('node:fs/promises')
  const { syncBuiltinESMExports } = require('node:module')
  const json = value => JSON.parse(JSON.stringify(value))
  for (const action of ['claim', 'submit', 'accept']) {
    for (const drift of ['caller-cwd', 'root-cwd', 'caller-replaced', 'root-replaced', 'stable']) {
      await t.test(`${action}: ${drift}`, async () => {
        const fx = await publicFixture({ skills: true })
        const originalOpen = fs.open
        const entered = Promise.withResolvers(), release = Promise.withResolvers()
        let inspection, cold, pending, timer
        try {
          const task = await fx.create('Fresh source required', { required_skills: ['dsh-badge'] })
          const worker = await fx.spawn(task)
          const actor = action === 'accept' ? fx.lead : worker
          let claim, submitted
          if (action !== 'claim') claim = await fx.claim(task, worker)
          const reportPath = path.join(fx.root, 'report.md')
          await writeFile(reportPath, 'Actual report bytes for source-drift regression.')
          if (action === 'accept') submitted = (await fx.update(claim, 'submit', worker, { delivery: delivery() })).task
          const storagePath = path.join(fx.root, 'storages/agent_teams.json')
          inspection = new fx.mod.AgentTeamsStore(storagePath)
          const select = document => document.teams.find(team => team.id === fx.teamId).tasks.find(row => row.id === task.id)
          const before = json(fx.readHotTask(task.id))
          assert.deepEqual(json(await inspection.read(select)), before, 'initial real hot and loaded snapshots match')
          const persistedBefore = await readFile(storagePath, 'utf8')
          const replacementDirectory = path.join(fx.root, 'other-existing-project')
          await mkdir(replacementDirectory)
          const originalRegistry = fx.ctx.skills
          let hits = 0
          if (action === 'claim') {
            fx.ctx.skills = {
              get: originalRegistry.get.bind(originalRegistry),
              async snapshot(...args) { hits += 1; entered.resolve(); await release.promise; return originalRegistry.snapshot(...args) }
            }
          } else {
            fs.open = async (...args) => {
              const handle = await originalOpen(...args)
              if (String(args[0]) === reportPath && hits === 0) { hits += 1; entered.resolve(); await release.promise }
              return handle
            }
            syncBuiltinESMExports()
          }
          const invoke = () => action === 'claim' ? fx.claim(task, worker) : action === 'submit' ? fx.update(claim, 'submit', worker, { delivery: delivery() }) : fx.rootCommand(submitted, 'accept', { review: reviewFor(submitted.submission) })
          pending = invoke().then(value => ({ value }), error => ({ error }))
          await Promise.race([
            entered.promise,
            pending.then(result => { throw result.error || new Error('operation completed without exercising the intended await') }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('intended await did not enter')), 3000) })
          ])
          clearTimeout(timer)
          assert.equal(hits, 1, 'real catalog/file observation is in progress')
          if (drift === 'caller-cwd') actor.session.header.cwd = replacementDirectory
          if (drift === 'root-cwd') fx.lead.session.header.cwd = replacementDirectory
          if (drift.endsWith('-replaced')) {
            const previous = drift === 'caller-replaced' ? actor : fx.lead
            const replacement = { ...previous }
            assert.equal(replacement.id, previous.id)
            assert.equal(replacement.session.header.cwd, previous.session.header.cwd)
            assert.notEqual(replacement, previous)
            const originalGet = fx.ctx.agents.get
            fx.ctx.agents.get = id => id === previous.id ? replacement : originalGet(id)
            if (previous === fx.lead) fx.ctx.agents.roots = () => [replacement]
          }
          release.resolve()
          const result = await pending
          fs.open = originalOpen; syncBuiltinESMExports()
          if (drift !== 'stable') {
            assert.equal(result.error?.code, 'AGENT_TEAMS_TASK_SCOPE_CHANGED', result.error?.stack || 'unexpected mutation success')
            assert.deepEqual(json(fx.readHotTask(task.id)), before, 'actual public-tool hot task unchanged, including revision/lease/ledger/submission/acceptance')
            assert.deepEqual(json(await inspection.read(select)), before, 'separate live reader sees no task change')
            assert.equal(await readFile(storagePath, 'utf8'), persistedBefore, 'rejection writes no bytes to durable storage')
            cold = new fx.mod.AgentTeamsStore(storagePath)
            // read performs a fresh disk load without invoking restart migration.
            assert.deepEqual(json(await cold.read(select)), before, 'complete freshly loaded task unchanged')
          } else {
            assert.equal(result.error, undefined, result.error?.stack)
            const after = await inspection.read(select)
            assert.equal(after.state, { claim: 'in_progress', submit: 'submitted', accept: 'completed' }[action])
            assert.ok(after.revision > before.revision)
            assert.ok(after.lifecycleLedger.length > before.lifecycleLedger.length)
            cold = new fx.mod.AgentTeamsStore(storagePath)
            assert.deepEqual(json(await cold.read(select)), json(after))
          }
        } finally {
          clearTimeout(timer); release.resolve(); await pending
          fs.open = originalOpen; syncBuiltinESMExports()
          inspection?.close(); cold?.close(); await fx.cleanup()
        }
      })
    }
  }
})
