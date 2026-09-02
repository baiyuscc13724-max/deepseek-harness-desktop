const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const goalToolFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tool-goal', 'lib', 'index.js')
const sessionFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')
const patchedHash = '742551EB41DDF0FC96D736A888454FCA5801EEA5C5A89800EA774DF12EB7EB23'

async function loadPatchedGoalTool() {
  const runtimePatch = await import('../scripts/patch-official-runtime.mjs')
  await runtimePatch.patchInstalledGoalTool(goalToolFile)
  assert.equal(await runtimePatch.patchInstalledGoalTool(goalToolFile), false)
  const source = readFileSync(goalToolFile, 'utf8')
  assert.equal(createHash('sha256').update(source).digest('hex').toUpperCase(), patchedHash)
  return {
    runtimePatch,
    source,
    module: await import(`${pathToFileURL(goalToolFile).href}?goal-recovery=${Date.now()}`),
    sessionModule: await import(`${pathToFileURL(sessionFile).href}?session-seq=${Date.now()}`)
  }
}

function createHarness(goalState, SessionSeq) {
  const registrations = []
  const sections = []
  const inheritedEventCount = 1
  const events = Object.freeze([
    Object.freeze({ seq: SessionSeq(0), time: 1, type: 'turn/start', data: { turn: 1 } }),
    Object.freeze({ seq: SessionSeq(1), time: 2, type: 'user/message', data: { source: { kind: 'user' } } })
  ])
  const session = {
    inheritedEventCount,
    snapshotEvents: () => events,
    ownEvents: () => events.slice(inheritedEventCount),
    eventAt: seq => events[seq],
    get seq() { return events.length }
  }
  const agent = { id: 'root', status: 'running', session }
  const ctx = {
    systemPrompt: {
      getSectionOrder: () => 1,
      section: section => sections.push(section)
    },
    tools: { register: tool => registrations.push(tool) },
    agents: {
      get: id => id === agent.id ? agent : undefined,
      currentInitiator: () => agent,
      roots: () => [agent]
    },
    sessionProjections: {
      stateOf: (_session, name) => name === 'turnBoundary' ? { openTurnStartSeq: SessionSeq(0) } : undefined
    },
    goals: {
      get: () => ({ ...goalState }),
      edit: (_agent, ref, replacements) => {
        assert.deepEqual(ref, { id: goalState.id, revision: goalState.revision })
        goalState.revision += 1
        if (replacements.maxGoalRounds !== undefined) goalState.maxGoalRounds = replacements.maxGoalRounds
        if (replacements.objective !== undefined) goalState.objective = replacements.objective
        return { ...goalState }
      },
      pause: () => ({ ...goalState, phase: 'paused', activation: 'disarmed' }),
      resume: (_agent, ref) => {
        assert.deepEqual(ref, { id: goalState.id, revision: goalState.revision })
        if (goalState.roundsStarted >= goalState.maxGoalRounds) {
          const error = new Error(`goal "${goalState.id}" exhausted ${goalState.maxGoalRounds} goal rounds; increase maxGoalRounds before resuming`)
          error.code = 'GOAL_INVALID_TRANSITION'
          throw error
        }
        goalState.revision += 1
        goalState.phase = 'active'
        goalState.activation = 'armed'
        return { ...goalState }
      }
    }
  }
  return { agent, ctx, events, registrations, sections }
}

function initialGoal() {
  return {
    id: 'goal-recovery-test',
    revision: 4,
    objective: 'Finish the durable objective',
    phase: 'blocked',
    roundsStarted: 8,
    maxGoalRounds: 8,
    blockedReason: { code: 'round-limit', message: 'Goal reached its configured limit of 8 rounds.' },
    activation: 'disarmed'
  }
}

test('alpha.4 goal runtime patch is exact, idempotent, and preserves snapshot-event authority', async () => {
  const { runtimePatch, source } = await loadPatchedGoalTool()
  assert.equal(runtimePatch.patchGoalToolRecoverySource(source).changed, false)
  assert.match(source, /const events = agent\.session\.snapshotEvents\(\);/u)
  assert.doesNotMatch(source, /const events = agent\.session\.events;/u)
  const incomplete = source.replace('const UPDATE_DESCRIPTION =', 'const BROKEN_UPDATE_DESCRIPTION =')
  assert.throws(() => runtimePatch.patchGoalToolRecoverySource(incomplete), /patch is incomplete/u)
})

test('goal tool tells the model to edit an exhausted cap before resume', async () => {
  const { module, sessionModule } = await loadPatchedGoalTool()
  const goalState = initialGoal()
  const harness = createHarness(goalState, sessionModule.SessionSeq)
  assert.equal(harness.agent.session.inheritedEventCount, 1)
  assert.equal(harness.agent.session.snapshotEvents().length, 2)
  assert.equal(harness.agent.session.ownEvents()[0].seq, sessionModule.SessionSeq(1))
  module.apply(harness.ctx, { blockedAfterConsecutiveRounds: 3 })
  const update = harness.registrations.find(tool => tool.name === 'update_goal')
  assert.ok(update)
  assert.match(harness.sections[0].text, /do not try resume: first call update_goal action edit/u)
  assert.match(update.description, /never call resume first/u)
  assert.match(update.parameters.properties.action.description, /pause, resume, and complete accept no optional fields/u)
  assert.match(update.parameters.properties.max_goal_rounds.description, /total lifetime cap/u)

  await assert.rejects(
    update.execute({
      goal_id: goalState.id,
      revision: goalState.revision,
      action: 'resume',
      max_goal_rounds: 8
    }, { agent: harness.agent }),
    error => {
      assert.equal(error.code, 'GOAL_TOOL_INVALID_UPDATE')
      assert.match(error.message, /8\/8 round limit/u)
      assert.match(error.message, /First call update_goal with action "edit"/u)
      assert.match(error.message, /returned revision/u)
      return true
    }
  )

  await assert.rejects(
    update.execute({
      goal_id: goalState.id,
      revision: goalState.revision,
      action: 'resume'
    }, { agent: harness.agent }),
    error => {
      assert.equal(error.code, 'GOAL_TOOL_ROUND_CAP_EXHAUSTED')
      assert.match(error.message, /Do not retry action "resume"/u)
      assert.match(error.message, /max_goal_rounds greater than 8/u)
      return true
    }
  )
})

test('documented edit then resume recovery succeeds with the returned revision', async () => {
  const { module, sessionModule } = await loadPatchedGoalTool()
  const goalState = initialGoal()
  const harness = createHarness(goalState, sessionModule.SessionSeq)
  module.apply(harness.ctx, { blockedAfterConsecutiveRounds: 3 })
  const update = harness.registrations.find(tool => tool.name === 'update_goal')

  const edited = await update.execute({
    goal_id: goalState.id,
    revision: goalState.revision,
    action: 'edit',
    max_goal_rounds: 12
  }, { agent: harness.agent })
  assert.equal(edited.goal.revision, 5)
  assert.equal(edited.goal.maxGoalRounds, 12)
  assert.equal(edited.goal.phase, 'blocked')

  const resumed = await update.execute({
    goal_id: goalState.id,
    revision: edited.goal.revision,
    action: 'resume'
  }, { agent: harness.agent })
  assert.equal(resumed.goal.revision, 6)
  assert.equal(resumed.goal.phase, 'active')
  assert.equal(resumed.goal.maxGoalRounds, 12)
  assert.equal(resumed.activation, 'armed')
})
