const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, readdir, rm } = require('node:fs/promises')
const { DatabaseSync } = require('node:sqlite')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const libRoot = path.join(root, 'plugins', 'dsh-agent-teams', 'lib')
const moduleFile = name => path.join(libRoot, name)
const moduleUrl = name => pathToFileURL(moduleFile(name)).href
const source = name => readFile(moduleFile(name), 'utf8')

function lexicalTokens(text, start = 0, stopAtBrace = false) {
  const tokens = []
  let index = start
  while (index < text.length) {
    const char = text[index]
    if (stopAtBrace && char === '}') return { tokens, index: index + 1 }
    if (/\s/u.test(char)) { index += 1; continue }
    if (char === '/' && text[index + 1] === '/') { index = text.indexOf('\n', index + 2); if (index < 0) return { tokens, index: text.length }; continue }
    if (char === '/' && text[index + 1] === '*') { const end = text.indexOf('*/', index + 2); index = end < 0 ? text.length : end + 2; continue }
    if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      index += 1
      while (index < text.length && text[index] !== quote) {
        if (text[index] === '\\' && index + 1 < text.length) { value += text[index + 1]; index += 2 } else { value += text[index]; index += 1 }
      }
      index += index < text.length ? 1 : 0
      tokens.push({ type: 'string', value })
      continue
    }
    if (char === '`') {
      index += 1
      while (index < text.length && text[index] !== '`') {
        if (text[index] === '\\') { index += Math.min(2, text.length - index); continue }
        if (text[index] === '$' && text[index + 1] === '{') {
          const nested = lexicalTokens(text, index + 2, true)
          tokens.push(...nested.tokens)
          index = nested.index
        } else index += 1
      }
      index += index < text.length ? 1 : 0
      continue
    }
    if (/[A-Za-z_$]/u.test(char)) {
      let end = index + 1
      while (end < text.length && /[A-Za-z0-9_$]/u.test(text[end])) end += 1
      tokens.push({ type: 'identifier', value: text.slice(index, end) })
      index = end
      continue
    }
    if (char === '{') {
      tokens.push({ type: 'punctuator', value: char })
      const nested = lexicalTokens(text, index + 1, true)
      tokens.push(...nested.tokens, { type: 'punctuator', value: '}' })
      index = nested.index
      continue
    }
    tokens.push({ type: 'punctuator', value: char })
    index += 1
  }
  return { tokens, index }
}

function dependencySpecifiers(text) {
  const tokens = lexicalTokens(text).tokens
  const specifiers = []
  const addString = token => { if (token?.type === 'string') specifiers.push(token.value) }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type !== 'identifier') continue
    if (token.value === 'require' && tokens[index + 1]?.value === '(' && tokens[index + 3]?.value === ')') { addString(tokens[index + 2]); continue }
    if (token.value === 'import') {
      if (tokens[index + 1]?.type === 'string') { addString(tokens[index + 1]); continue }
      if (tokens[index + 1]?.value === '(' && tokens[index + 3]?.value === ')') { addString(tokens[index + 2]); continue }
      if (tokens[index + 1]?.value === '.') continue
    } else if (token.value !== 'export') continue
    for (let cursor = index + 1; cursor < tokens.length && cursor < index + 64; cursor += 1) {
      if (tokens[cursor]?.value === ';') break
      if (tokens[cursor]?.type === 'identifier' && tokens[cursor].value === 'from') { addString(tokens[cursor + 1]); break }
    }
  }
  return specifiers
}

async function productionImporters(target) {
  const names = (await readdir(libRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => entry.name)
  const expected = `./${target}`
  const importers = []
  for (const name of names) if (dependencySpecifiers(await source(name)).includes(expected)) importers.push(name)
  return importers.sort()
}

function publicMethods(klass) {
  return Object.getOwnPropertyNames(klass.prototype).filter(name => name !== 'constructor' && !name.startsWith('#')).sort()
}

const projectA = `project_${'A'.repeat(24)}`
const projectB = `project_${'B'.repeat(24)}`

async function storeFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'official-core-contract-'))
  const filePath = path.join(rootDir, 'tasks.sqlite')
  const keys = new Map([[projectA, randomBytes(32)], [projectB, randomBytes(32)]])
  const mod = await import(moduleUrl('project-task-store.js'))
  const store = new mod.ProjectTaskStore({ filePath, keyProvider: projectRef => keys.get(projectRef) })
  store.initialize()
  return { rootDir, filePath, keys, mod, store }
}

function createTaskInput(projectRef = projectA, suffix = 'A') {
  return {
    projectRef,
    commandId: `command_${suffix.repeat(24)}`,
    eventRef: `event_${suffix.repeat(24)}`,
    actorRef: `actor_${suffix.repeat(24)}`,
    expectedRevision: 0,
    createdAt: 1_800_000_000_000,
    task: {
      taskRef: `task_${suffix.repeat(24)}`,
      status: 'todo',
      ownerActorRef: `owner_${suffix.repeat(24)}`,
      title: `private-${suffix}-title`,
      requirements: { acceptance: `private-${suffix}-criteria` },
      fileScope: [`src/private-${suffix}.js`],
    },
    eventPayload: { source: `private-${suffix}-source` },
  }
}

test('dependency scanner recognizes static, re-export, dynamic, and CommonJS edges without matching comments or string-like text', () => {
  const target = './project-task-store.js'
  for (const syntax of [
    `import { ProjectTaskStore } from "${target}";`,
    `import "${target}";`,
    `export { ProjectTaskStore } from '${target}';`,
    `const lazy = import('${target}');`,
    `const legacy = require("${target}");`,
    `const embedded = \`value: \${import('${target}')}\`;`,
  ]) assert.deepEqual(dependencySpecifiers(syntax), [target], syntax)
  for (const nearMiss of [
    `// import('${target}')`,
    `/* export { x } from '${target}' */`,
    `const example = "require('${target}')";`,
    `const template = \`import('${target}')\`;`,
    `const other = import('${target}?raw');`,
    `const computed = require(resolve('${target}'));`,
  ]) assert.equal(dependencySpecifiers(nearMiss).includes(target), false, nearMiss)
})

test('the production reference graph keeps every current task/collaboration consumer explicit', async () => {
  assert.deepEqual(await productionImporters('project-task-domain.js'), [
    'project-automation-web.js',
    'project-business-sync-runtime.js',
    'project-business-sync-store.js',
    'project-task-service.js',
    'project-task-store.js',
    'project-task-web.js',
  ])
  assert.deepEqual(await productionImporters('project-task-store.js'), [
    'index.js',
    'project-automation-web.js',
    'project-business-sync-runtime.js',
    'project-task-service.js',
    'project-task-web.js',
  ])
  assert.deepEqual(await productionImporters('project-task-service.js'), [
    'index.js',
    'project-automation-web.js',
    'project-business-sync-runtime.js',
    'project-task-web.js',
  ])
  assert.deepEqual(await productionImporters('project-task-web.js'), ['index.js'])
  assert.deepEqual(await productionImporters('project-task-crypto.js'), ['project-task-store.js'])
  assert.deepEqual(await productionImporters('project-collaboration.js'), ['project-authority-service.js', 'project-entry-service.js'])
  assert.deepEqual(await productionImporters('project-state-store.js'), [
    'defect-lifecycle-service.js',
    'external-defect-outbox.js',
    'project-authority-service.js',
    'project-automation-store.js',
    'project-business-sync-store.js',
    'project-entry-service.js',
    'project-foundations-runtime.js',
    'test-orchestrator-service.js',
    'workspace-authority-service.js',
  ])
})

test('Host routes, model tools, and the sole UI workspace converge on the same bounded seam', async () => {
  const [host, client] = await Promise.all([source('index.js'), source('client.js')])
  for (const route of ['state', 'page', 'events', 'stream', 'action']) {
    assert.match(host, new RegExp(`/api/agent-teams/project/tasks/${route}`, 'u'))
  }
  assert.match(host, /registerProjectTaskApi\(ctx, projectTaskRuntimeForSession, projectBusiness\)/u)
  assert.match(host, /name: "project_collaboration"/u)
  assert.match(host, /name: "project_task"/u)
  assert.match(host, /withProjectCollaborationContext\(projectEntry, execution/u)
  assert.match(host, /new ProjectTaskStore\(\{ filePath: context\.databasePath, keyProvider: context\.keyProvider \}\)/u)
  assert.match(client, /function ProjectCollaborationWorkspace\(props\)/u)
  assert.match(client, /workspaceContent = h\(ProjectCollaborationWorkspace,/u)
  assert.match(client, /fetch\("\/api\/agent-teams\/project\/tasks\/state"/u)
  assert.match(client, /new EventSource\("\/api\/agent-teams\/project\/tasks\/stream" \+ projectTaskSessionQuery\(projectScope\)\)/u)
  const start = client.indexOf('function ProjectCollaborationWorkspace(props)')
  const end = client.indexOf('function LegacyProjectTeamBoardWorkspace(props)', start)
  assert.ok(start >= 0 && end > start)
  const workspace = client.slice(start, end)
  assert.doesNotMatch(workspace, /method: "POST"|postProjectTaskAction|createTask\(|updateTask\(/u)
  assert.match(workspace, /function runRootRecovery\(item,action\)[\s\S]*rootRecoveryState\.confirm!==key[\s\S]*props\.onRootRecovery\(item,action\)/u)
  assert.match(workspace, /MemberRecoveryReconcilePanel[\s\S]*props\.onReconcile[\s\S]*MemberRecoveryPanel[\s\S]*props\.onRecover/u)
  assert.match(client, /function recoverProjectRoot\(recovery,action\)[\s\S]*postAction\(props\.sessionId,"root-recovery-continue",\{recoveryCapability:recovery\.recoveryCapability,expectedRevision:recovery\.revision,recoveryAction:action,confirm:true\}\)/u)
  assert.match(client, /h\(ProjectCollaborationWorkspace, \{ key: "project-collaboration:" \+ props\.sessionId,[\s\S]*onRecover: recoverProjectMember, onReconcile: reconcileProjectMember, onRootRecovery: recoverProjectRoot \}\)/u)
})

test('alpha.5 preserves Desktop Agent Teams, Goal, Schedule, Stop, and authorization-epoch ownership boundaries', async () => {
  const [host, authorization, main] = await Promise.all([
    source('index.js'),
    readFile(path.join(root, 'electron', 'bridge', 'agent-teams-authorization-service.cjs'), 'utf8'),
    readFile(path.join(root, 'electron', 'main.cjs'), 'utf8'),
  ])
  const coreManifest = JSON.parse(await readFile(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  for (const name of ['@deepseek-ai/dsh-goal', '@deepseek-ai/dsh-schedule']) {
    assert.equal(coreManifest.dependencies[name], '^0.1.2-alpha.5')
    const installed = JSON.parse(await readFile(path.join(root, 'node_modules', '@deepseek-ai', name.slice('@deepseek-ai/'.length), 'package.json'), 'utf8'))
    assert.equal(installed.version, '0.1.2-alpha.5')
  }
  for (const tool of ['team_start', 'team_resume', 'team_shutdown']) assert.match(host, new RegExp(`name: "${tool}"`, 'u'))
  assert.match(host, /kind: "user_stop"[\s\S]{0,220}leaseEpoch: task\.leaseEpoch/u)
  assert.match(host, /team\.autopilot\.authorizationEpoch !== hostState\.authorizationEpoch/u)
  assert.match(authorization, /pending\.authorizationEpoch !== authorizationEpoch/u)
  assert.match(authorization, /const nextAuthorizationEpoch = previous => \{[\s\S]{0,220}candidate === previous[\s\S]{0,120}HOST_AUTHORIZATION_STATE_INVALID/u)
  assert.match(authorization, /if \(!state \|\| state\.legacy\)[\s\S]{0,320}authorizationEpoch: nextAuthorizationEpoch\(\)/u)
  assert.match(authorization, /verifyAuthorizationHead\(state\)[\s\S]{0,120}applyAuthorizationState\(state\)/u)
  assert.match(authorization, /const recovered = createAuthorizationState\([\s\S]{0,260}authorizationEpoch: nextAuthorizationEpoch\(previousEpoch\)[\s\S]{0,100}autopilotSettingsProof: null/u)
  assert.match(authorization, /const AUTHORIZATION_STATE_KEYS = Object\.freeze\(\['version', 'revision', 'consumed', 'authorizationEpoch', 'autopilotSettingsProof'\]\)/u)
  assert.match(authorization, /const capabilityToken = Buffer\.from\(token\)/u)
  assert.match(authorization, /capabilityToken\.fill\(0\)/u)
  assert.match(authorization, /HOST_AUTHORIZATION_MISMATCH/u)
  assert.match(main, /revokeAgentTeamsAutopilotAuthorizations\('runtime start advanced the authorization epoch'\)/u)
  assert.match(main, /revokeAgentTeamsAutopilotAuthorizations\('runtime stop revoked automatic continuation authority'\)/u)
})

test('the current implementation satisfies the adapter-port method contract without exposing storage to UI', async () => {
  const [storeMod, serviceMod, webMod] = await Promise.all([
    import(moduleUrl('project-task-store.js')),
    import(moduleUrl('project-task-service.js')),
    import(moduleUrl('project-task-web.js')),
  ])
  const storeMethods = publicMethods(storeMod.ProjectTaskStore)
  for (const method of [
    'initialize', 'close', 'createTask', 'mutateTask', 'getTask', 'getCommandReceipt', 'getProjectRevision',
    'readTaskWindow', 'listEvents', 'readCollaborationSectionWindow', 'claimNextTask',
    'createCollaborationBoard', 'reserveRootSeat', 'adoptRootSeat', 'upsertCollaborationSeat',
    'acquireCollaborationLock', 'releaseCollaborationLock', 'prepareCollaborationHandoff',
    'commitCollaborationHandoff', 'addCollaborationEvidence', 'createCollaborationRequest',
    'respondCollaborationRequest', 'escalateCollaborationRequest', 'prepareRootRecovery',
  ]) assert.ok(storeMethods.includes(method), `missing store port ${method}`)
  for (const method of ['executeCommand', 'getCommandOutcome', 'getCommandReceipt']) assert.equal(typeof serviceMod.ProjectTaskCommandService.prototype[method], 'function')
  for (const method of ['snapshot', 'sectionWindow', 'claimNextTask', 'requestCollaboration', 'respondCollaborationRequest', 'acquireLock', 'prepareHandoff', 'addEvidence']) assert.equal(typeof serviceMod.ProjectCollaborationService.prototype[method], 'function')
  for (const method of ['state', 'page', 'events', 'action', 'subscribe', 'close']) assert.equal(typeof webMod.ProjectTaskWebRuntime.prototype[method], 'function')
})

test('schema v13 is forward-fenced, encrypted, project-scoped, and receipt-idempotent', async () => {
  const fixture = await storeFixture()
  try {
    const first = fixture.store.createTask(createTaskInput(projectA, 'A'))
    const replay = fixture.store.createTask(createTaskInput(projectA, 'A'))
    assert.equal(first.duplicate, false)
    assert.equal(replay.duplicate, true)
    assert.equal(replay.projectRevision, first.projectRevision)
    assert.throws(() => fixture.store.createTask({ ...createTaskInput(projectA, 'A'), eventPayload: { source: 'drifted' } }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
    fixture.store.createTask(createTaskInput(projectB, 'B'))
    assert.equal(fixture.store.readTaskWindow({ projectRef: projectA }).tasks.length, 1)
    assert.equal(fixture.store.readTaskWindow({ projectRef: projectB }).tasks.length, 1)

    const db = new DatabaseSync(fixture.filePath, { readOnly: true })
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13)
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
      for (const table of [
        'project_task_projects', 'project_tasks', 'project_task_events', 'project_task_actors',
        'project_task_comments', 'project_task_relations', 'project_task_attempts', 'project_task_reviews',
        'project_task_command_receipts', 'project_task_claim_next_receipts', 'project_collaboration_boards',
        'project_collaboration_seats', 'project_collaboration_locks', 'project_collaboration_handoffs',
        'project_collaboration_evidence', 'project_collaboration_history', 'project_collaboration_requests',
        'project_collaboration_root_reservations', 'project_collaboration_root_recoveries',
      ]) assert.ok(tables.has(table), `missing schema table ${table}`)
      const raw = JSON.stringify(db.prepare('SELECT * FROM project_tasks WHERE project_ref=?').get(projectA))
      for (const secret of ['private-A-title', 'private-A-criteria', 'src/private-A.js']) assert.equal(raw.includes(secret), false)
    } finally { db.close() }
  } finally {
    fixture.store.close()
    for (const key of fixture.keys.values()) key.fill(0)
    await rm(fixture.rootDir, { recursive: true, force: true })
  }

  const futureRoot = await mkdtemp(path.join(os.tmpdir(), 'official-core-future-schema-'))
  try {
    const filePath = path.join(futureRoot, 'future.sqlite')
    const db = new DatabaseSync(filePath)
    db.exec('PRAGMA user_version=14')
    db.close()
    const mod = await import(moduleUrl('project-task-store.js'))
    const store = new mod.ProjectTaskStore({ filePath, keyProvider: () => randomBytes(32) })
    assert.throws(() => store.initialize(), error => error.code === 'PROJECT_TASK_SCHEMA_UNSUPPORTED')
  } finally { await rm(futureRoot, { recursive: true, force: true }) }
})

test('identity, review, encryption, Web input, and cursor boundaries fail closed', async () => {
  const [domain, cryptoMod, webMod, actorMod] = await Promise.all([
    import(moduleUrl('project-task-domain.js')),
    import(moduleUrl('project-task-crypto.js')),
    import(moduleUrl('project-task-web.js')),
    import(moduleUrl('project-task-actor.js')),
  ])
  const baseCommand = { commandId: 'command_identity', type: 'transition', taskRef: 'task_identity', expectedRevision: 1, payload: { to: 'blocked', blockReason: 'dependency' } }
  assert.throws(() => domain.normalizeTaskCommand({ ...baseCommand, actorRef: 'forged' }), /unsupported fields/u)
  assert.throws(() => domain.normalizeTaskCommand({ ...baseCommand, payload: { ...baseCommand.payload, sessionId: 'forged' } }), /forbidden identity field/u)
  assert.throws(() => webMod.normalizeWebCommand({ ...baseCommand, payload: { ...baseCommand.payload, authority: 'owner' } }), error => error.code === 'PROJECT_TASK_WEB_INVALID_REQUEST')
  assert.throws(() => actorMod.normalizeResolvedActor({ projectRef: projectB, actorRef: 'actor_x', kind: 'agent', authorities: [] }, projectA), error => error.code === 'PROJECT_TASK_ACTOR_UNRESOLVED')

  const reviewing = { taskRef: 'task_review', status: 'in_review', revision: 4, requirementsRevision: 2, ownerActorRef: 'owner', assigneeActorRef: 'executor' }
  const attempt = { attemptRef: 'attempt_review', taskRef: reviewing.taskRef, executorActorRef: 'executor', acceptedRequirementsRevision: 2, state: 'submitted' }
  assert.throws(() => domain.createTaskReview(reviewing, attempt, { actorRef: 'executor', kind: 'agent', authorities: ['project_lead'] }, { reviewRef: 'review_self', verdict: 'approved' }), error => error.code === 'PROJECT_TASK_SELF_APPROVAL')

  const key = randomBytes(32)
  try {
    const cipher = new cryptoMod.ProjectTaskFieldCipher({ keyProvider: projectRef => projectRef === projectA || projectRef === projectB ? key : undefined })
    const sealed = cipher.seal(projectA, 'tasks/task_A/title', { title: 'secret' })
    assert.throws(() => cipher.open(projectA, 'tasks/task_A/requirements', sealed), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
    assert.throws(() => cipher.open(projectB, 'tasks/task_A/title', sealed), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')

    const cursor = webMod.encodeTaskPageCursor(projectA, 7, { statusRank: 0, priority: 9, updatedAt: 8, createdAt: 7, taskRef: 'task_A' }, key)
    assert.deepEqual(webMod.decodeTaskPageCursor(projectA, cursor, key), { projectRevision: 7, statusRank: 0, priority: 9, updatedAt: 8, createdAt: 7, taskRef: 'task_A' })
    assert.throws(() => webMod.decodeTaskPageCursor(projectB, cursor, key), error => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID')
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`
    assert.throws(() => webMod.decodeTaskPageCursor(projectA, tampered, key), error => error.code === 'PROJECT_TASK_WEB_CURSOR_INVALID')
  } finally { key.fill(0) }
})
