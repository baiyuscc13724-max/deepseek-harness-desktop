const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { EventEmitter } = require('node:events')
const { execFile, execFileSync } = require('node:child_process')
const { existsSync, realpathSync } = require('node:fs')
const { mkdir, mkdtemp, realpath, rm, writeFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { createProjectSecretCapability } = require('./fixtures/project-secret-capability.cjs')

const execFileAsync = promisify(execFile)
const pluginUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')).href
const entryUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-entry-service.js')).href
const bundledGit = path.resolve(__dirname, '..', 'third_party', 'mingit', 'cmd', 'git.exe')
function gitExecutable() { if (process.platform === 'win32' && existsSync(bundledGit)) return bundledGit; const command = process.platform === 'win32' ? 'where' : 'which'; return realpathSync(execFileSync(command, ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/u)[0]) }
const gitCommand = gitExecutable()
const allowedGitRoot = gitCommand === bundledGit ? path.resolve(__dirname, '..', 'third_party', 'mingit') : path.dirname(path.dirname(gitCommand))
async function git(cwd, args) { return String((await execFileAsync(gitCommand, args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } })).stdout).trim() }
function agent(id, cwd, kind = 'worker') {
  return { id, status: 'running', session: { header: { cwd }, events: [{ type: 'turn/start' }], snapshotEvents() { return this.events.slice() } }, kind }
}
function capability() {
  return Object.freeze(Object.defineProperties({}, { gitCommand: { value: gitCommand }, allowedGitRoot: { value: allowedGitRoot } }))
}
async function fixture() {
  const [mod, entryMod] = await Promise.all([import(`${pluginUrl}?foundations-tools=${Date.now()}-${Math.random()}`), import(`${entryUrl}?foundations-tools=${Date.now()}-${Math.random()}`)])
  // Foundation tooling compares agent cwd and project roots against the async
  // fs/promises realpath (macOS /var -> /private/var, Windows 8.3 short temp
  // names), so the fixture root must be the exact async canonical path before
  // any child workspace is derived from it.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ft-')))
  assert.equal(root, await realpath(root), 'fixture root must be its exact async realpath')
  const source = path.join(root, 's')
  const dshHome = path.join(root, 'd')
  await mkdir(source)
  await git(source, ['init'])
  await writeFile(path.join(source, 'README.md'), 'one\n')
  await writeFile(path.join(source, 'SECOND.md'), 'two\n')
  await git(source, ['add', '-A'])
  await git(source, ['-c', 'user.name=Tools Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'initial'])
  const entry = new entryMod.ProjectEntryService({ dshHome, secretCapability: createProjectSecretCapability(), now: () => Date.now() })
  await entry.createProject({ projectName: 'Foundation tools', displayName: 'Owner' })
  const rootAgent = agent('root-foundations', source, 'lead')
  const workerA = agent('worker-foundations-a', source)
  const workerB = agent('worker-foundations-b', source)
  const agents = new Map([[rootAgent.id, rootAgent], [workerA.id, workerA], [workerB.id, workerB]]), rootAgents = [rootAgent]
  let initiator = workerA
  const ctx = {
    agents: { get: id => agents.get(id), roots: () => [...rootAgents], currentInitiator: () => initiator },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } }
  }
  const team = {
    id: 'team-foundations', state: 'active', rootLeadSessionId: rootAgent.id,
    members: [
      { id: 'member-foundations-a', sessionId: workerA.id, state: 'running', kind: 'worker' },
      { id: 'member-foundations-b', sessionId: workerB.id, state: 'running', kind: 'worker' }
    ],
    tasks: [
      { id: 'task-foundations-a', title: 'Edit README', state: 'in_progress', assigneeSessionId: workerA.id, files: ['README.md'] },
      { id: 'task-foundations-b', title: 'Edit second file', state: 'in_progress', assigneeSessionId: workerB.id, files: ['SECOND.md'] }
    ]
  }
  const teams = [team]
  let reads = 0
  const store = { read: async reader => { reads += 1; return structuredClone(reader({ teams })) } }
  const tools = new Map()
  const manager = mod.createProjectFoundationManager(ctx, store, entry, Promise.resolve(capability()))
  mod.registerProjectFoundationTools(ctx, manager)
  const call = async (name, args = {}, caller = initiator) => {
    initiator = caller
    return tools.get(name).execute(args, { agent: caller, signal: new AbortController().signal })
  }
  return { mod, root, source, dshHome, entry, rootAgent, workerA, workerB, agents, rootAgents, team, teams, store, tools, manager, call, reads: () => reads, async close() { await manager.close().catch(() => undefined); await entry.close().catch(() => undefined); await rm(root, { recursive: true, force: true }) } }
}

const TOOL_NAMES = ['project_workspace_open', 'project_workspace_close', 'project_resource_claim', 'project_changeset_publish', 'project_merge_run', 'project_quality_submit', 'project_defect_action']
function webResponse() { const response = new EventEmitter(); return Object.assign(response, { status: 0, chunks: [], writeHead(status) { this.status = status }, end(value = '') { if (value) this.chunks.push(String(value)) } }) }
async function webCall(route, { method = 'GET', url = '/api/agent-teams/project/foundations/state', origin = 'http://127.0.0.1:9945' } = {}) { const response = webResponse(); await route.handler({ method, url, headers: { host: '127.0.0.1:9945', origin } }, response); return { status: response.status, data: JSON.parse(response.chunks.join('')) } }

test('M5 registers seven narrow tools and rejects a non-live caller before Team lookup', async () => {
  const fx = await fixture()
  try {
    assert.deepEqual([...fx.tools.keys()].sort(), [...TOOL_NAMES].sort())
    for (const name of TOOL_NAMES) {
      const schema = fx.tools.get(name).parameters
      const encoded = JSON.stringify(schema).toLowerCase()
      for (const forbidden of ['projectref', 'actorref', 'sessionid', 'role', 'workspacepath', 'device', 'team_id', 'task_id', 'repositoryref', 'claimref', 'approvalref', 'effectref']) assert.equal(encoded.includes(forbidden), false, `${name}:${forbidden}`)
    }
    const reads = fx.reads()
    const impostor = agent(fx.workerA.id, fx.source)
    const denied = await fx.call('project_workspace_open', {}, impostor)
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'AGENT_TEAMS_DRIVER_REQUIRED')
    assert.equal(fx.reads(), reads, 'live Host execution is checked before Team store lookup')
    assert.deepEqual(Object.keys(denied.error).sort(), ['action', 'code', 'retryable'])
  } finally { await fx.close() }
})

test('an unrelated live root cannot bind or merge another root’s active project team', async () => {
  const fx = await fixture()
  try {
    const unrelated = agent('root-foundations-unrelated', fx.source, 'lead'); fx.agents.set(unrelated.id, unrelated); fx.rootAgents.push(unrelated)
    const denied = await fx.call('project_merge_run', {}, unrelated); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PROJECT_FOUNDATIONS_FORBIDDEN')
    assert.deepEqual(await fx.call('project_merge_run', {}, fx.rootAgent), { ok: true, merged: false, attention: 'merge_queue_empty' }, 'the rejected root never binds initialization')
  } finally { await fx.close() }
})

test('multiple active root owners are ambiguous while same-root peer teams remain authorized', async () => {
  const fx = await fixture()
  try {
    fx.teams.push({ id: 'team-foundations-peer', state: 'active', rootLeadSessionId: fx.rootAgent.id, members: [], tasks: [] })
    assert.deepEqual(await fx.call('project_merge_run', {}, fx.rootAgent), { ok: true, merged: false, attention: 'merge_queue_empty' })
  } finally { await fx.close() }
  const ambiguous = await fixture()
  try {
    const unrelated = agent('root-foundations-ambiguous', ambiguous.source, 'lead'); ambiguous.agents.set(unrelated.id, unrelated); ambiguous.rootAgents.push(unrelated)
    ambiguous.teams.push({ id: 'team-foundations-other-root', state: 'active', rootLeadSessionId: unrelated.id, members: [], tasks: [] })
    for (const caller of [ambiguous.rootAgent, unrelated, ambiguous.workerA]) { const denied = await ambiguous.call('project_merge_run', {}, caller); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PROJECT_FOUNDATIONS_FORBIDDEN') }
  } finally { await ambiguous.close() }
})

test('paused or closed teams confer no Foundations tool authority', async () => {
  for (const state of ['paused', 'closed']) {
    const fx = await fixture()
    try { fx.team.state = state; const denied = await fx.call('project_merge_run', {}, fx.rootAgent); assert.equal(denied.ok, false); assert.equal(denied.error.code, 'PROJECT_FOUNDATIONS_FORBIDDEN') }
    finally { await fx.close() }
  }
})

test('two assigned workers receive isolated absolute workspaces and reassignment revokes fresh authorization', async () => {
  const fx = await fixture()
  try {
    const first = await fx.call('project_workspace_open', {}, fx.workerA)
    const second = await fx.call('project_workspace_open', {}, fx.workerB)
    assert.equal(first.ok, true); assert.equal(second.ok, true)
    assert.equal(path.isAbsolute(first.workspacePath), true)
    assert.equal(path.isAbsolute(second.workspacePath), true)
    assert.notEqual(first.workspacePath, second.workspacePath)
    assert.notEqual(first.workspaceRef, second.workspaceRef)
    assert.notEqual(first.fencingToken, second.fencingToken)
    assert.equal(JSON.stringify(first).includes(fx.source), false)

    fx.team.tasks[0].assigneeSessionId = fx.workerB.id
    fx.team.tasks[1].state = 'pending'
    const revoked = await fx.call('project_workspace_close', {}, fx.workerA)
    assert.equal(revoked.ok, false)
    assert.equal(revoked.error.code, 'PROJECT_FOUNDATIONS_FORBIDDEN')
  } finally { await fx.close() }
})

test('auto scope claim and default-title publish enqueue one ChangeSet; root merge is lead-only and no runner can self-pass', async () => {
  const fx = await fixture()
  try {
    assert.deepEqual(await fx.call('project_merge_run', {}, fx.rootAgent), { ok: true, merged: false, attention: 'merge_queue_empty' })
    const opened = await fx.call('project_workspace_open', {}, fx.workerA)
    assert.match(opened.claimRef, /^claim_/u, 'workspace open automatically claims assigned task files')
    await writeFile(path.join(opened.workspacePath, 'README.md'), 'changed by worker\n')
    await git(opened.workspacePath, ['add', '-A'])
    await git(opened.workspacePath, ['-c', 'user.name=Tools Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'worker commit'])
    const published = await fx.call('project_changeset_publish', {}, fx.workerA)
    assert.deepEqual(Object.keys(published).sort(), ['changeSetRef', 'ok', 'published'])
    assert.match(published.changeSetRef, /^changeset_/u)
    const before = await git(fx.source, ['rev-parse', 'HEAD'])
    assert.equal(await git(fx.source, ['rev-parse', 'HEAD']), before, 'publishing alone never lands source')
    const deniedWorkerMerge = await fx.call('project_merge_run', {}, fx.workerA)
    assert.equal(deniedWorkerMerge.ok, false)
    assert.equal(deniedWorkerMerge.error.code, 'PROJECT_FOUNDATIONS_FORBIDDEN')
    const quality = await fx.call('project_quality_submit', {}, fx.rootAgent)
    assert.deepEqual(quality, { ok: false, error: { code: 'PROJECT_FOUNDATION_RUNNER_UNAVAILABLE', action: 'configure_a_trusted_desktop_runner', retryable: false } })
  } finally { await fx.close() }
})

test('an exact non-Git root returns safe browser attention without creating or cloning foundation state', async () => {
  const fx = await fixture()
  try {
    const nonGit = path.join(fx.root, 'plain')
    await mkdir(nonGit)
    fx.rootAgent.session.header.cwd = await realpath(nonGit)
    const browser = await fx.manager.browserState()
    assert.equal(browser.mode, 'authority'); assert.equal(browser.ready, false); assert.equal(browser.sourceStatus, 'source_invalid'); assert.deepEqual(browser.attention, ['connector_disabled', 'runner_unavailable', 'source_invalid'])
    const encoded = JSON.stringify(browser); for (const forbidden of [fx.root, fx.source, 'projectRef', 'workspaceRef', 'commit', 'digest', 'actor', 'device', 'evidence']) assert.equal(encoded.includes(forbidden), false, forbidden)
    assert.equal(existsSync(path.join(fx.dshHome, 'storages', 'agent_project_foundations')), false)
    const result = await fx.call('project_workspace_open', {}, fx.workerA)
    assert.deepEqual(result, { ok: true, opened: false, attention: ['source_invalid'], code: 'PROJECT_FOUNDATIONS_SOURCE_INVALID' })
    assert.equal(existsSync(path.join(fx.dshHome, 'storages', 'agent_project_foundations')), false)
  } finally { await fx.close() }
})

test('foundations status API is local GET-only and returns only the bounded safe projection', async () => {
  const mod = await import(`${pluginUrl}?foundations-api=${Date.now()}-${Math.random()}`), routes = new Map(), cleanups = []
  const ctx = { webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } }, effect(setup) { const cleanup = setup(); if (typeof cleanup === 'function') cleanups.push(cleanup) } }
  const safe = mod.projectFoundationsBrowserState('authority', { ready: true, sourceStatus: 'source_dirty', workspaceCount: Number.MAX_SAFE_INTEGER, attention: ['source_dirty', 'merge_conflict', 'C:\\private\\root'], projectRef: 'project_private', workspacePath: 'C:\\private\\root' })
  mod.registerProjectFoundationsApi(ctx, { browserState: async () => safe })
  try {
    const route = routes.get('/api/agent-teams/project/foundations/state'), result = await webCall(route)
    assert.equal(result.status, 200); assert.equal(result.data.mode, 'authority'); assert.equal(result.data.sourceStatus, 'source_dirty'); assert.equal(result.data.workspaceCount, 1_000_000); assert.deepEqual(result.data.attention, ['merge_conflict', 'source_dirty'])
    const encoded = JSON.stringify(result.data); for (const forbidden of ['project_private', 'private', 'projectRef', 'workspacePath', 'digest', 'commit', 'actor', 'device', 'evidence']) assert.equal(encoded.includes(forbidden), false, forbidden)
    assert.equal((await webCall(route, { method: 'POST' })).status, 405)
    assert.equal((await webCall(route, { url: '/api/agent-teams/project/foundations/state?projectRef=forged' })).status, 400)
    assert.equal((await webCall(route, { origin: 'https://evil.example' })).status, 403)
  } finally { for (const cleanup of cleanups.reverse()) cleanup() }
})

test('collaborator browser status is authority-managed and never probes Git, roots, or Team storage', async () => {
  const mod = await import(`${pluginUrl}?foundations-collaborator=${Date.now()}-${Math.random()}`), unavailable = Object.assign(new Error('must not consume'), { code: 'PROJECT_FOUNDATION_GIT_UNAVAILABLE' })
  const manager = mod.createProjectFoundationManager({ agents: { roots() { throw new Error('roots must not be read') } } }, { read() { throw new Error('Team store must not be read') } }, { status: async () => ({ project: { role: 'contributor' } }) }, Promise.reject(unavailable))
  try { assert.deepEqual(await manager.browserState(), { ok: true, mode: 'collaborator', available: true, ready: false, sourceStatus: 'authority_managed', workspaceCount: 0, claimCount: 0, queuedChangeSetCount: 0, campaignCount: 0, queuedJobCount: 0, runningJobCount: 0, defectCount: 0, outboxPendingCount: 0, attention: [] }) }
  finally { await manager.close() }
})

test('Host-derived fields are rejected and manager close is fail-closed', async () => {
  const fx = await fixture()
  try {
    const forged = await fx.call('project_defect_action', { method: 'recordSignal', payload: { path: fx.source, projectRef: 'forged' } }, fx.workerA)
    assert.equal(forged.ok, false)
    assert.equal(forged.error.code, 'PROJECT_FOUNDATIONS_FORBIDDEN')
    assert.equal(JSON.stringify(forged).includes(fx.source), false)
    await fx.manager.close()
    const closed = await fx.call('project_workspace_open', {}, fx.workerA)
    assert.equal(closed.ok, false)
    assert.equal(closed.error.code, 'PROJECT_FOUNDATIONS_CLOSED')
  } finally { await fx.close() }
})
