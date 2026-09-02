const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHmac, randomBytes } = require('node:crypto')
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
    for (let attempt = 0; attempt < 100 && ready.state !== 'ready'; attempt += 1) { await delay(5); ready = await runtime.status({}, { batchRef: prepared.batchRef, projectBinding: parentBinding }) }
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
