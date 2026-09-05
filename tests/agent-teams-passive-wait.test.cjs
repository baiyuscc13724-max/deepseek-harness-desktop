const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const plugin = path.resolve(__dirname, '../plugins/dsh-agent-teams/lib/index.js')
async function fixture() {
  const { createTeamChangeWaiter, rootCanAutonomouslyWait } = await import(pathToFileURL(plugin).href)
  const root = { id: 'wait-root', session: { header: { cwd: process.cwd() } } }
  let liveRoot = root
  let document = { teams: [{ id: 'wait-team', rootLeadSessionId: root.id, state: 'active', pauseEpoch: 0,
    members: [{ kind: 'lead', sessionId: root.id, state: 'running' }, { kind: 'worker', id: 'worker', sessionId: 'worker', state: 'running' }],
    messages: [], tasks: [{ id: 'task', title: 'Work', state: 'in_progress', assigneeSessionId: 'worker', claimId: 'claim', leaseEpoch: 0, dependsOn: [], capabilities: [], externalEffects: [], lifecycleLedger: [] }] }] }
  const listeners = new Set()
  const ctx = { agents: { get: id => id === root.id ? liveRoot : undefined, roots: () => [liveRoot] }, goals: new Proxy({}, { get() { throw new Error('passive wait must never access Goals') } }), subagents: new Proxy({}, { get() { throw new Error('passive wait must never wake a worker') } }) }
  const store = { view: () => document, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const waiter = createTeamChangeWaiter(ctx, store)
  return { root, store, waiter, listeners, authority: () => rootCanAutonomouslyWait(document, root), replaceRoot: () => { liveRoot = { ...root } }, publish(change = () => {}) { document = structuredClone(document); change(document.teams[0]); for (const fn of [...listeners]) fn(document) } }
}
test('subscription setup failure frees the root slot and leaks no raw diagnostic', async () => {
  const f = await fixture(), controller = new AbortController(), subscribe = f.store.subscribe
  f.store.subscribe = () => { throw new Error('private diagnostic must not escape') }
  assert.deepEqual(await f.waiter.wait(f.root, 'wait-team', controller.signal), { reason: 'unavailable', teamId: 'wait-team' })
  assert.equal(f.listeners.size, 0)
  f.store.subscribe = subscribe
  const pending = f.waiter.wait(f.root, 'wait-team', controller.signal)
  controller.abort()
  assert.equal((await pending).reason, 'cancelled')
  assert.equal(f.listeners.size, 0)
  f.waiter.dispose()
})

test('one passive wait stays silent through duplicate/checkpoint updates, then returns a submission without a grant', async () => {
  const f = await fixture(), controller = new AbortController()
  assert.equal(f.authority(), false)
  let settled = false
  const pending = f.waiter.wait(f.root, 'wait-team', controller.signal).then(result => { settled = true; return result })
  assert.throws(() => f.waiter.wait(f.root, 'wait-team', controller.signal), error => error.code === 'AGENT_TEAMS_WAIT_PENDING')
  for (let index = 0; index < 30; index++) f.publish(team => { team.revision = index; team.tasks[0].checkpoint = { text: 'Still working ' + index } })
  await Promise.resolve()
  assert.equal(settled, false)
  assert.equal(f.listeners.size, 1)
  f.publish(team => { team.tasks[0].state = 'submitted'; team.tasks[0].submission = { submittedBy: 'worker', claimId: 'claim', leaseEpoch: 0, submittedAt: '2026-09-01T00:00:00.000Z' } })
  assert.equal((await pending).reason, 'changed')
  assert.equal(f.listeners.size, 0)
  assert.equal(f.authority(), false)
  f.waiter.dispose()
})
test('Stop, cancellation, root replacement, and disposal detach every subscription without waking anyone', async () => {
  for (const mode of ['stop', 'abort', 'replace', 'dispose', 'preabort']) {
    const f = await fixture(), controller = new AbortController()
    if (mode === 'preabort') controller.abort()
    const pending = f.waiter.wait(f.root, 'wait-team', controller.signal)
    if (mode === 'stop') f.publish(team => { team.state = 'paused'; team.pauseEpoch++ })
    if (mode === 'abort') controller.abort()
    if (mode === 'replace') { f.replaceRoot(); f.publish() }
    if (mode === 'dispose') f.waiter.dispose()
    assert.equal((await pending).reason, mode === 'stop' ? 'stopped' : mode === 'replace' ? 'scope_changed' : 'cancelled')
    assert.equal(f.listeners.size, 0)
    f.waiter.dispose()
  }
})
test('missing producer returns attention in the same turn instead of hanging or allocating a Goal round', async () => {
  const f = await fixture(), controller = new AbortController()
  const pending = f.waiter.wait(f.root, 'wait-team', controller.signal)
  f.publish(team => { team.members[1].state = 'idle' })
  assert.equal((await pending).reason, 'attention')
  assert.equal(f.listeners.size, 0)
  f.waiter.dispose()
})
test('a worker cannot use root waiting and an uncancellable call is refused', async () => {
  const f = await fixture()
  assert.throws(() => f.waiter.wait(f.root, 'wait-team'), error => error.code === 'AGENT_TEAMS_DRIVER_REQUIRED')
  assert.throws(() => f.waiter.wait({ id: 'worker' }, 'wait-team', new AbortController().signal), error => error.code === 'AGENT_TEAMS_UNAUTHORIZED')
  assert.equal(f.listeners.size, 0)
  f.waiter.dispose()
})
