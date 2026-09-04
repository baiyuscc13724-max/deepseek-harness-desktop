const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, createHmac, randomBytes } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { createAgentTeamsSessionLaunchService, projectKeyForWorkspace, CALLER_SALT_ENV } = require('../electron/bridge/agent-teams-session-launch-service.cjs')

const launchUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-session-launch.js')).href
const indexUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href
const clientFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'client.js')
const indexFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const requestOf = payload => payload?.args?.request

test('real Host prepare-reserve-all-activate-ready-child-adopt keeps the adoption capability out of state, diagnostics, prompts and public projections', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'host-adoption-security-'))
  const workspacePath = path.join(root, 'workspace'); await mkdir(workspacePath)
  const stateFile = path.join(root, 'host.json'), ledgerFile = path.join(root, 'launch.json'), token = randomBytes(32), auth = token.toString('base64url')
  const sessions = new Set(), calls = []
  const rpc = async (method, payload) => {
    calls.push([method, structuredClone(payload)])
    if (method === 'workspace/create') return { workspace: { workspaceId: 'workspace-id', path: workspacePath } }
    if (method === 'session/list') return { items: [...sessions].map(sessionId => ({ sessionId })) }
    if (method === 'session/create') { sessions.add(requestOf(payload).sessionId); return { sessionId: requestOf(payload).sessionId } }
    if (method === 'session/rename') return { title: requestOf(payload).title, seq: 1 }
    if (method === 'session/prompt') return { accepted: true }
    throw new Error(method)
  }
  const host = createAgentTeamsSessionLaunchService({ stateFile, token, callRuntimeRpc: rpc, maxConcurrent: 2, maxConcurrentPerProject: 1 })
  await host.start()
  const canonicalProjectKey = projectKeyForWorkspace(workspacePath)
  const callerSalt = host.runtimeEnvironment({})[CALLER_SALT_ENV]
  const callerRootRef = (_canonical, rootId) => createHmac('sha256', Buffer.from(callerSalt, 'base64url')).update(JSON.stringify(['agent-teams-caller-root-v1', canonicalProjectKey, rootId])).digest('hex')
  const request = (action, payload) => host.handleRequest({ action, token: auth, ...payload })
  const provider = {
    callerRootRef,
    resolveProject: (_execution, payload) => request('resolveProject', payload),
    reserveAdoption: (_execution, payload) => request('reserveAdoption', payload),
    launch: (_execution, payload) => request('launch', payload),
    retry: (_execution, payload) => request('retry', payload),
    resolveUnknown: (_execution, payload) => request('resolveUnknown', payload),
    reconcile: (_execution, payload) => request('reconcile', payload),
    cancel: (_execution, payload) => request('cancel', payload),
    redeemAdoption: (_execution, payload) => request('redeemAdoption', payload),
    recordAdoption: (_execution, payload) => request('recordAdoption', payload),
    recordFailure: (_execution, payload) => request('recordFailure', payload),
  }
  const { ProjectSessionLaunchRuntime } = await import(`${launchUrl}?security=${Date.now()}-${Math.random()}`)
  const runtime = new ProjectSessionLaunchRuntime({ filePath: ledgerFile, provider, disposeProvider: false })
  const parentBinding = { canonicalProjectKey, workspacePath, callerRootId: 'parent-root' }
  try {
    const prepared = await runtime.prepareStart({}, { requestId: 'secure-batch', totalSessions: 3, slots: [
      { title: 'Child A', role: 'Security A', resources: ['src/a'], task: 'Task A' },
      { title: 'Child B', role: 'Security B', resources: ['src/b'], task: 'Task B' },
    ], projectBinding: parentBinding })
    assert.equal(prepared.noHostEffects, true)
    const adoptions = await runtime.prepareAdoptions({}, { batchRef: prepared.batchRef, projectBinding: parentBinding })
    assert.equal(adoptions.prepared.length, 2, 'all Host capabilities are prepared before any launch activation')
    const capabilities = adoptions.prepared.map(value => value.adoptionCapability)
    assert.equal(new Set(capabilities).size, 2)
    const reservations = adoptions.prepared.map((value, index) => ({ slotActorRef: `actor_reserved_${index}`, taskRef: `task_reserved_${index}`, slotRef: value.slotRef, operationRef: value.operationRef }))
    const activated = await runtime.activatePreparedBatch({}, { batchRef: prepared.batchRef, reservations, projectBinding: parentBinding })
    assert.equal(activated.noHostEffects, false)
    let ready = activated
    const readyDeadline = Date.now() + 10_000
    while (ready.state !== 'ready' && Date.now() < readyDeadline) { await delay(25); ready = await runtime.status({}, { batchRef: prepared.batchRef, projectBinding: parentBinding }) }
    assert.equal(ready.state, 'ready')
    assert.equal(ready.createdSessionCount, 2)

    const hostDocument = JSON.parse(await readFile(stateFile, 'utf8'))
    const bySlot = new Map(hostDocument.operations.map(operation => [operation.slotRef, operation]))
    for (let index = 0; index < adoptions.prepared.length; index += 1) {
      const slot = adoptions.prepared[index], operation = bySlot.get(slot.slotRef)
      assert.ok(operation?.sessionId)
      const childBinding = { canonicalProjectKey, workspacePath, callerRootId: operation.sessionId }
      const redeemed = await runtime.redeemAdoption({}, { slotRef: slot.slotRef, projectBinding: childBinding })
      assert.equal(redeemed.slotActorRef, reservations[index].slotActorRef)
      assert.equal(redeemed.slotCapability, capabilities[index])
      const other = adoptions.prepared[(index + 1) % adoptions.prepared.length]
      await assert.rejects(runtime.redeemAdoption({}, { slotRef: other.slotRef, projectBinding: childBinding }), error => error.code === 'HOST_SESSION_ADOPTION_FORBIDDEN')
      assert.deepEqual(await runtime.recordAdoption({}, { slotRef: slot.slotRef, adoptedActorRef: `actor_child_${index}`, projectBinding: childBinding }), { recorded: true })
      redeemed.slotCapability = undefined
    }

    const publicMaterial = JSON.stringify({ ready: await runtime.status({}, { batchRef: prepared.batchRef, projectBinding: parentBinding }), diagnostics: host.diagnostics(), host: JSON.parse(await readFile(stateFile, 'utf8')), ledger: JSON.parse(await readFile(ledgerFile, 'utf8')), calls })
    for (const capability of capabilities) assert.equal(publicMaterial.includes(capability), false)
    assert.equal(publicMaterial.includes(callerSalt), false)
    assert.equal(calls.filter(row => row[0] === 'session/prompt').every(row => !/adoption_[A-Za-z0-9_-]+/u.test(JSON.stringify(row[1]))), true)
  } finally { await runtime.close(); await host.close(); token.fill(0); await rm(root, { recursive: true, force: true }) }
})

test('the unique cross-session board entry exposes requests accessibly and project tools reject a Team member before opening private facts', async () => {
  const [client, host, mod] = await Promise.all([readFile(clientFile, 'utf8'), readFile(indexFile, 'utf8'), import(`${indexUrl}?member-gate=${Date.now()}-${Math.random()}`)])
  assert.match(client, /workspaceContent = h\(ProjectCollaborationWorkspace,/u)
  assert.doesNotMatch(client, /workspaceContent = h\(LegacyProjectTeamBoardWorkspace,|h\(LegacyProjectTeamBoardWorkspace,/u)
  assert.match(client, /dat-collaboration-requests/u)
  assert.match(client, /aria-labelledby/u)
  assert.match(client, /aria-busy/u)
  assert.match(client, /\.dat-board-card\{min-height:44px/u)
  assert.match(client, /\.dat-member-recovery-actions \.dat-btn\{min-height:44px/u)
  assert.match(client, /@media\(prefers-reduced-motion:reduce\)/u)
  assert.match(client, /@media\(max-width:760px\)/u)
  assert.match(host, /path: "\/api\/agent-teams\/project\/team-board\/page"/u)
  assert.match(host, /name: "project_collaboration"[\s\S]*?"read_requests"/u)

  const member = { id: 'private-team-member', status: 'running', session: { header: { cwd: os.tmpdir() }, events: [{ type: 'turn/start', id: 'member-turn', time: 1 }, { type: 'user/message', data: { source: { kind: 'user' } } }], snapshotEvents() { return this.events.slice() } } }
  const ctx = { agents: { roots: () => [], get: id => id === member.id ? member : undefined, currentInitiator: () => member } }
  assert.throws(() => mod.requireProjectRootCaller(ctx, { agent: member }), error => error.code === 'PROJECT_COLLABORATION_ROOT_REQUIRED')
  assert.equal(JSON.stringify(member).includes('projectRef'), false)
})

test('projection cache never crosses ACL, owner, epoch, settings, session, selection, or live Goal authorization boundaries', async () => {
  const mod = await import(`${indexUrl}?projection-security=${Date.now()}-${Math.random()}`)
  const cwd = path.resolve(os.tmpdir(), 'projection-security-root')
  const pathIdentity = process.platform === 'win32' ? cwd.replace(/\\/gu, '/').toLocaleLowerCase('en-US') : cwd.replace(/\\/gu, '/')
  const projectKey = createHash('sha256').update(JSON.stringify(['agent-teams-project-v1', pathIdentity])).digest('hex')
  const timestamp = '2026-01-01T00:00:00.000Z'
  const team = {
    id: 'secure-team', projectKey, rootLeadSessionId: 'secure-root', name: 'Secure', objective: 'Exact projection security', revision: 1, state: 'active', pauseEpoch: 0, createdAt: timestamp, updatedAt: timestamp,
    members: [{ id: 'lead:secure-root', sessionId: 'secure-root', name: 'Lead', role: 'lead', kind: 'lead', state: 'running', createdAt: timestamp, updatedAt: timestamp }],
    tasks: [], messages: [], plan: { phase: 'active', hash: 'a'.repeat(64) },
    autopilot: { status: 'active', goalId: 'goal-one', rootSessionId: 'secure-root', authorizationEpoch: 1, pauseEpochAtGrant: 0 },
    ownershipHistory: [],
  }
  const document = { version: 8, settings: { enabled: true, maxMembers: 8, maxActiveTurns: 8, autopilotEnabled: true, autopilotMaxAdditionalRounds: 200 }, teams: [team], routingReceipts: [], routingReceiptArchive: { version: 1, count: 0, chainHash: '0'.repeat(64) } }
  const cache = mod.createTeamProjectionCache({ mode: 'enabled' })
  let goal = { id: 'goal-one', phase: 'active', activation: 'armed' }
  const root = { id: 'secure-root', session: { header: { cwd } } }
  let roots = [root]
  const ctx = { agents: { get: id => id === root.id ? root : undefined, roots: () => roots }, goals: { get: candidate => candidate === root ? goal : undefined } }

  const pure = cache.project(document, 'secure-root', 'secure-team', 'task-one')
  const pureHit = cache.project(document, 'secure-root', 'secure-team', 'task-one')
  assert.strictEqual(pureHit, pure)
  const liveOne = mod.teamSnapshotWithAutopilotAuthorization(ctx, document, 'secure-root', 'secure-team', cache.project)
  assert.equal(liveOne.autopilotAuthorization.goalId, 'goal-one')
  goal = { id: 'goal-two', phase: 'active', activation: 'armed' }
  const liveTwo = mod.teamSnapshotWithAutopilotAuthorization(ctx, document, 'secure-root', 'secure-team', cache.project)
  assert.equal(liveTwo.autopilotAuthorization.goalId, 'goal-two', 'Goal authorization is freshly overlaid and never frozen in the store cache')
  assert.notEqual(liveTwo.cursor, liveOne.cursor)
  roots = []
  assert.equal(mod.teamSnapshotWithAutopilotAuthorization(ctx, document, 'secure-root', 'secure-team', cache.project).autopilotAuthorization, null)

  const wrongSession = cache.project(document, 'other-session', 'secure-team', 'task-one')
  const wrongSelection = cache.project(document, 'secure-root', 'not-owned', 'task-one')
  const wrongTask = cache.project(document, 'secure-root', 'secure-team', 'task-two')
  assert.equal(wrongSession.activeTeamId, null)
  assert.equal(wrongSelection.activeTeamId, 'secure-team')
  assert.notStrictEqual(wrongTask, pure)

  team.autopilot.authorizationEpoch = 2
  team.pauseEpoch = 1
  team.revision += 1
  team.rootLeadSessionId = 'new-owner'
  team.members[0].id = 'lead:new-owner'
  team.members[0].sessionId = 'new-owner'
  document.settings.maxMembers = 7
  const staleOwner = cache.project(document, 'secure-root', 'secure-team', 'task-one')
  const newOwner = cache.project(document, 'new-owner', 'secure-team', 'task-one')
  assert.equal(staleOwner.activeTeamId, null)
  assert.equal(newOwner.team.rootLeadSessionId, 'new-owner')
  assert.equal(newOwner.config.maxMembers, 7)
  assert.notStrictEqual(newOwner, pure)
  assert.ok(cache.stats().misses >= 6)
  cache.close()
})
