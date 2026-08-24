const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.resolve(__dirname, '..')
const load = relative => import(pathToFileURL(path.join(ROOT, relative)).href)
const PROJECT = 'project_automation_web_fixture'
const TASK = 'task_automation_web_fixture'

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-automation-web-'))
  const [web, taskStoreMod, taskServiceMod] = await Promise.all([
    load('plugins/dsh-agent-teams/lib/project-automation-web.js'),
    load('plugins/dsh-agent-teams/lib/project-task-store.js'),
    load('plugins/dsh-agent-teams/lib/project-task-service.js'),
  ])
  const taskPath = path.join(directory, 'tasks.sqlite3'), automationPath = path.join(directory, 'automation.enc')
  const taskKey = Buffer.alloc(32, 3), automationKey = Buffer.alloc(32, 7)
  const owner = Object.freeze({ projectRef: PROJECT, actorRef: 'collaborator_owner_fixture', kind: 'human', role: 'owner' })
  const seedStore = new taskStoreMod.ProjectTaskStore({ filePath: taskPath, keyProvider: projectRef => { assert.equal(projectRef, PROJECT); return Buffer.from(taskKey) } })
  seedStore.initialize()
  const seedExecution = Object.freeze({})
  const seedService = new taskServiceMod.ProjectTaskCommandService({ store: seedStore, actorResolver: execution => { assert.equal(execution, seedExecution); return owner } })
  seedService.executeCommand(seedExecution, { projectRef: PROJECT, taskRef: TASK, commandId: 'seed-create', eventRef: 'event_seed_create', type: 'create', expectedRevision: 0, payload: { title: 'Ship safely', requirements: { acceptance: 'done' }, fileScope: ['src/a.js'] } })
  seedStore.close()
  let epoch = 1, role = 'owner', created = true
  const contexts = []
  function context(kind) {
    if (!created) { const error = new Error('not created'); error.code = 'PROJECT_ENTRY_NOT_CREATED'; throw error }
    if (role !== 'owner') { const error = new Error('forbidden'); error.code = 'PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN'; throw error }
    const captured = epoch, execution = Object.freeze({}), disposed = { value: false }
    const assertCurrent = (candidate, projectRef) => { if (disposed.value || captured !== epoch || candidate !== execution || projectRef !== PROJECT) { const error = new Error('stale'); error.code = 'PROJECT_ENTRY_TASK_CONTEXT_INVALID'; throw error } }
    const value = { projectRef: PROJECT, ...(kind === 'automation' ? { filePath: automationPath } : { databasePath: taskPath }) }
    Object.defineProperties(value, { execution: { value: execution }, actorResolver: { value: (candidate, projectRef) => { assertCurrent(candidate, projectRef); return owner } }, keyProvider: { value: projectRef => { assertCurrent(execution, projectRef); return Buffer.from(kind === 'automation' ? automationKey : taskKey) } }, dispose: { value: () => { if (disposed.value) return false; disposed.value = true; return true } } })
    contexts.push({ kind, disposed }); return Object.freeze(value)
  }
  const entry = { localProjectAutomationContext: async () => context('automation'), localProjectTaskContext: async () => context('task'), status: async () => ({ project: created ? { role } : undefined }) }
  const scheduled = [], runtime = new web.ProjectAutomationWebRuntime({ projectEntry: entry, now: () => Date.parse('2026-01-02T03:04:05Z'), schedule: callback => scheduled.push(callback) })
  return { web, runtime, scheduled, contexts, setEpoch: value => { epoch = value }, setRole: value => { role = value }, setCreated: value => { created = value }, async cleanup() { await runtime.close(); taskKey.fill(0); automationKey.fill(0); await rm(directory, { recursive: true, force: true }) } }
}

async function settlePump(fx) {
  while (fx.scheduled.length) fx.scheduled.shift()()
  for (let index = 0; index < 20; index += 1) { await new Promise(resolve => setTimeout(resolve, 5)); const state = await fx.runtime.state(); if (state.runs.every(run => !['queued', 'running'].includes(run.status))) return state }
  return fx.runtime.state()
}

test('web command boundary accepts only canonical UI commands and empty queries', async () => {
  const { normalizeAutomationWebCommand } = await load('plugins/dsh-agent-teams/lib/project-automation-web.js')
  assert.deepEqual(normalizeAutomationWebCommand({ commandId: 'c1', type: 'manual_run', definitionRef: 'definition_x', expectedRevision: 1, payload: { taskRevision: 2 } }).payload, { taskRevision: 2 })
  for (const invalid of [
    { commandId: 'c', type: 'approve', runRef: 'r', expectedRevision: 1, payload: {}, actorRef: 'spoof' },
    { commandId: 'c', type: 'manual_run', definitionRef: 'd', expectedRevision: 1, payload: { expectedTaskRevision: 1 } },
    { commandId: 'c', type: 'definition.update', definitionRef: 'd', expectedRevision: 1, payload: { name: 'not canonical' } },
  ]) assert.throws(() => normalizeAutomationWebCommand(invalid))
  let calls = 0; const accessor = {}; Object.defineProperty(accessor, 'type', { enumerable: true, get() { calls += 1; return 'approve' } })
  assert.throws(() => normalizeAutomationWebCommand(accessor)); assert.equal(calls, 0)
  let inheritedHookRuns = 0
  Object.defineProperty(Object.prototype, 'toJSON', { configurable: true, value() { inheritedHookRuns += 1; throw new Error('must not execute') } })
  try { assert.equal(normalizeAutomationWebCommand({ commandId: 'safe', type: 'approve', runRef: 'run_safe', expectedRevision: 1, payload: {} }).runRef, 'run_safe'); assert.equal(inheritedHookRuns, 0) } finally { delete Object.prototype.toJSON }
  assert.throws(() => normalizeAutomationWebCommand({ commandId: 'reason', type: 'definition.create', expectedRevision: 0, payload: { name: 'x', taskRef: TASK, targetStatus: 'todo', blockReason: 'not applicable' } }), /blockReason/u)
})

test('failed run projection reads the persisted nested error and exposes retry only when allowed', async () => {
  const { projectSafeAutomationRun } = await load('plugins/dsh-agent-teams/lib/project-automation-web.js')
  const retryable = projectSafeAutomationRun({ runRef: 'run_retry', definitionRef: 'definition_retry', revision: 4, status: 'failed', createdAt: '2026-01-02T03:04:05.000Z', error: { code: 'PROJECT_TASK_STORE_BUSY', retryable: true }, steps: [{}] }, new Map([['definition_retry', { name: 'Retry me' }]]))
  assert.equal(retryable.errorCode, 'PROJECT_TASK_STORE_BUSY'); assert.equal(retryable.retryable, true); assert.deepEqual(retryable.allowedActions, ['retry'])
  const terminal = projectSafeAutomationRun({ ...retryable, error: { code: 'PROJECT_TASK_CONFLICT', retryable: false }, steps: [{}] })
  assert.equal(terminal.retryable, false); assert.deepEqual(terminal.allowedActions, [])
})

test('runtime reports no-project and collaborator capability without opening stores', async () => {
  const fx = await fixture()
  try {
    fx.setCreated(false); assert.equal((await fx.runtime.state()).capability.kind, 'no-project')
    fx.setCreated(true); fx.setRole('contributor'); assert.equal((await fx.runtime.state()).capability.kind, 'collaborator')
  } finally { await fx.cleanup() }
})

test('real stores create, toggle, manual-run, approve queue, and independently execute with safe projections', async () => {
  const fx = await fixture()
  try {
    const updates = [], unsubscribe = fx.runtime.subscribe(update => updates.push(update))
    await assert.rejects(() => fx.runtime.state({ projectRef: PROJECT }), error => error.code === 'PROJECT_AUTOMATION_WEB_INVALID_REQUEST')
    const initial = await fx.runtime.state(); assert.equal(initial.capability.kind, 'authority'); assert.equal(initial.taskChoices[0].title, 'Ship safely'); assert.deepEqual(initial.taskChoices[0].allowedTargets, ['backlog', 'in_progress', 'blocked', 'canceled'])
    const created = await fx.runtime.action({ commandId: 'create-1', type: 'definition.create', expectedRevision: 0, payload: { name: 'Move forward', taskRef: TASK, targetStatus: 'in_progress' } })
    assert.equal(created.definition.status, 'enabled'); const definitionRef = created.definition.definitionRef
    const disabled = await fx.runtime.action({ commandId: 'disable-1', type: 'definition.update', definitionRef, expectedRevision: 1, payload: { status: 'disabled' } }); assert.equal(disabled.definition.status, 'disabled')
    const enabled = await fx.runtime.action({ commandId: 'enable-1', type: 'definition.update', definitionRef, expectedRevision: 2, payload: { status: 'enabled' } }); assert.equal(enabled.definition.status, 'enabled')
    await assert.rejects(() => fx.runtime.action({ commandId: 'run-stale', type: 'manual_run', definitionRef, expectedRevision: 3, payload: { taskRevision: 99 } }), error => error.code === 'PROJECT_AUTOMATION_TASK_CONFLICT')
    const manual = await fx.runtime.action({ commandId: 'run-1', type: 'manual_run', definitionRef, expectedRevision: 3, payload: { taskRevision: 1 } }); assert.equal(manual.run.status, 'awaiting_approval')
    const approved = await fx.runtime.action({ commandId: 'approve-1', type: 'approve', runRef: manual.run.runRef, expectedRevision: 1, payload: {} }); assert.equal(approved.run.status, 'queued', 'action must not await task effect')
    const queued = await fx.runtime.state(); assert.equal(queued.runs[0].status, 'queued')
    const finished = await settlePump(fx); assert.equal(finished.runs[0].status, 'succeeded')
    const replayedCreate = await fx.runtime.action({ commandId: 'create-1', type: 'definition.create', expectedRevision: 0, payload: { name: 'Move forward', taskRef: TASK, targetStatus: 'in_progress' } }); assert.equal(replayedCreate.duplicate, true)
    const replayedManual = await fx.runtime.action({ commandId: 'run-1', type: 'manual_run', definitionRef, expectedRevision: 3, payload: { taskRevision: 1 } }); assert.equal(replayedManual.duplicate, true)
    assert.equal(finished.taskChoices[0].revision, 2); assert.ok(finished.recentLedger.length > 0)
    const encoded = JSON.stringify(finished); for (const forbidden of ['actorRef', 'commandId', 'inputHash', 'effectKey', 'taskCommandId', 'approvalRef', 'fileScope', 'requirements']) assert.equal(encoded.includes(forbidden), false, forbidden)
    assert.ok(updates.length >= 5); unsubscribe()
  } finally { await fx.cleanup() }
})

test('stale contexts rebind once, replay idempotently, and close drains then rejects work', async () => {
  const fx = await fixture()
  try {
    await fx.runtime.state()
    const command = { commandId: 'stable-create', type: 'definition.create', expectedRevision: 0, payload: { name: 'Stable', taskRef: TASK, targetStatus: 'backlog' } }
    const first = await fx.runtime.action(command); assert.equal(first.duplicate, false)
    fx.setEpoch(2)
    const replay = await fx.runtime.action(command); assert.equal(replay.duplicate, true)
    assert.ok(fx.contexts.filter(item => item.disposed.value).length >= 2)
    await fx.runtime.close(); await fx.runtime.close()
    await assert.rejects(() => fx.runtime.state(), error => error.code === 'PROJECT_AUTOMATION_WEB_CLOSED')
  } finally { await fx.cleanup() }
})
