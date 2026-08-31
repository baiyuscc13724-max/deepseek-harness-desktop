const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')

const cryptoUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-crypto.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js')).href
const projectRef = `project_${'A'.repeat(24)}`
const secondProjectRef = `project_${'B'.repeat(24)}`

async function fixture(options = {}) {
  const cryptoMod = await import(cryptoUrl)
  const storeMod = await import(storeUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-store-'))
  const filePath = path.join(root, 'project-tasks.sqlite')
  const keys = new Map([[projectRef, randomBytes(32)], [secondProjectRef, randomBytes(32)]])
  const keyProvider = ref => keys.get(ref)
  const store = new storeMod.ProjectTaskStore({ filePath, keyProvider, ...options })
  store.initialize()
  return { cryptoMod, storeMod, root, filePath, keys, keyProvider, store }
}
async function usingFixture(run, options) {
  const state = await fixture(options)
  try { await run(state) } finally { state.store.close(); await rm(state.root, { recursive: true, force: true }) }
}
function createInput(overrides = {}) {
  return {
    projectRef,
    commandId: `command_${'A'.repeat(24)}`,
    eventRef: `event_${'A'.repeat(24)}`,
    actorRef: `actor_${'A'.repeat(24)}`,
    expectedRevision: 0,
    createdAt: 1_700_000_000_000,
    task: {
      taskRef: `task_${'A'.repeat(24)}`,
      status: 'todo',
      ownerActorRef: `actor_${'O'.repeat(24)}`,
      title: 'secret launch title',
      requirements: { acceptance: 'private acceptance criteria' },
      fileScope: ['private/source/file.js'],
    },
    eventPayload: { summary: 'private task created' },
    ...overrides,
  }
}

test('field cipher uses an external 32-byte key, binds AAD, and fails closed on tamper or wrong key', async () => {
  const mod = await import(cryptoUrl)
  const key = randomBytes(32)
  const cipher = new mod.ProjectTaskFieldCipher({ keyProvider: ref => ref === projectRef ? key : undefined })
  const sealed = cipher.seal(projectRef, 'tasks/task_A/title', { title: 'classified' })
  assert.equal(sealed.includes('classified'), false)
  assert.deepEqual(cipher.open(projectRef, 'tasks/task_A/title', sealed), { title: 'classified' })
  assert.throws(() => cipher.open(projectRef, 'tasks/task_A/requirements', sealed), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
  const envelope = JSON.parse(sealed)
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`
  assert.throws(() => cipher.open(projectRef, 'tasks/task_A/title', JSON.stringify(envelope)), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
  const wrong = new mod.ProjectTaskFieldCipher({ keyProvider: () => randomBytes(32) })
  assert.throws(() => wrong.open(projectRef, 'tasks/task_A/title', sealed), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
  assert.throws(() => new mod.ProjectTaskFieldCipher({ keyProvider: () => Buffer.alloc(31) }).seal(projectRef, 'x', {}), /32 bytes/u)
})

test('SQLite store enables WAL and persists only encrypted sensitive task and event fields', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  assert.equal(created.duplicate, false)
  assert.equal(created.projectRevision, 1)
  assert.equal(created.task.revision, 1)
  assert.equal(created.task.requirementsRevision, 1)
  assert.equal(created.task.title, 'secret launch title')

  const database = new DatabaseSync(state.filePath, { readOnly: true })
  try {
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 12)
    const rawTask = database.prepare('SELECT title_cipher, requirements_cipher, file_scope_cipher FROM project_tasks').get()
    const rawEvent = database.prepare('SELECT payload_cipher FROM project_task_events').get()
    const raw = JSON.stringify({ rawTask, rawEvent })
    for (const secret of ['secret launch title', 'private acceptance criteria', 'private/source/file.js', 'private task created']) assert.equal(raw.includes(secret), false)
  } finally { database.close() }

  const fileBytes = await readFile(state.filePath)
  assert.equal(fileBytes.includes(Buffer.from('secret launch title')), false)
  assert.deepEqual(state.store.listEvents({ projectRef, afterRevision: 0 }), [{
    projectRevision: 1,
    eventRef: `event_${'A'.repeat(24)}`,
    commandId: `command_${'A'.repeat(24)}`,
    taskRef: `task_${'A'.repeat(24)}`,
    type: 'task.created',
    actorRef: `actor_${'A'.repeat(24)}`,
    payload: { summary: 'private task created' },
    createdAt: 1_700_000_000_000,
  }])
}))

test('create requires expectedRevision zero and rejects missing or nonzero preconditions', async () => usingFixture(async state => {
  const input = createInput()
  assert.throws(() => state.store.createTask({ ...input, expectedRevision: 1 }), /expectedRevision.*0/u)
  const { expectedRevision, ...missing } = input
  assert.throws(() => state.store.createTask(missing), /expectedRevision.*0/u)
  assert.equal(state.store.getProjectRevision(projectRef), 0)
  assert.equal(state.store.createTask(input).task.revision, 1)
}))

test('commandId and eventRef retries are idempotent but conflicting reuse is rejected', async () => usingFixture(async state => {
  const input = createInput()
  const first = state.store.createTask(input)
  const replay = state.store.createTask(input)
  assert.equal(replay.duplicate, true)
  assert.equal(replay.projectRevision, first.projectRevision)
  assert.deepEqual(replay.task, first.task)
  assert.equal(state.store.getProjectRevision(projectRef), 1)
  assert.deepEqual(state.store.getCommandReceipt({ projectRef, commandId: input.commandId }), first)
  const reopened = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider })
  reopened.initialize()
  try { assert.deepEqual(reopened.getCommandReceipt({ projectRef, commandId: input.commandId }), first) } finally { reopened.close() }
  assert.throws(() => state.store.createTask({ ...input, eventPayload: { summary: 'changed' } }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
  assert.throws(() => state.store.createTask({ ...input, commandId: `command_${'B'.repeat(24)}` }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
}))

test('task mutation is transactional, increments project/task revisions, and enforces expectedRevision CAS across stores', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  const competing = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider })
  competing.initialize()
  try {
    const changed = state.store.mutateTask({
      projectRef,
      taskRef: created.task.taskRef,
      commandId: `command_${'C'.repeat(24)}`,
      eventRef: `event_${'C'.repeat(24)}`,
      expectedRevision: 1,
      actorRef: `actor_${'O'.repeat(24)}`,
      type: 'task.requirements_changed',
      patch: { title: 'new secret title', requirements: { acceptance: 'new private criteria' }, requirementsChanged: true },
      eventPayload: { changedFields: ['title', 'requirements'] },
      createdAt: 1_700_000_000_100,
    })
    assert.equal(changed.projectRevision, 2)
    assert.equal(changed.task.revision, 2)
    assert.equal(changed.task.requirementsRevision, 2)
    assert.equal(competing.getTask({ projectRef, taskRef: created.task.taskRef }).title, 'new secret title')
    assert.throws(() => competing.mutateTask({
      projectRef,
      taskRef: created.task.taskRef,
      commandId: `command_${'D'.repeat(24)}`,
      eventRef: `event_${'D'.repeat(24)}`,
      expectedRevision: 1,
      actorRef: `actor_${'O'.repeat(24)}`,
      type: 'task.transitioned',
      patch: { status: 'in_progress' },
      eventPayload: {},
      createdAt: 1_700_000_000_200,
    }), error => error.code === 'PROJECT_TASK_CONFLICT' && error.currentRevision === 2)
    assert.equal(state.store.getProjectRevision(projectRef), 2)
  } finally { competing.close() }
}))

test('store infers requirement-affecting fields and false cannot suppress requirementsRevision', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  const base = {
    projectRef,
    taskRef: created.task.taskRef,
    actorRef: `actor_${'O'.repeat(24)}`,
    eventPayload: {},
  }
  const title = state.store.mutateTask({ ...base, commandId: 'command_req_title', eventRef: 'event_req_title', expectedRevision: 1, type: 'task.edited', patch: { title: 'changed title', requirementsChanged: false }, createdAt: 1_700_000_000_401 })
  assert.equal(title.task.requirementsRevision, 2)
  const requirements = state.store.mutateTask({ ...base, commandId: 'command_req_body', eventRef: 'event_req_body', expectedRevision: 2, type: 'task.edited', patch: { requirements: { acceptance: 'changed' }, requirementsChanged: false }, createdAt: 1_700_000_000_402 })
  assert.equal(requirements.task.requirementsRevision, 3)
  const files = state.store.mutateTask({ ...base, commandId: 'command_req_files', eventRef: 'event_req_files', expectedRevision: 3, type: 'task.edited', patch: { fileScope: ['another/file.js'], requirementsChanged: false }, createdAt: 1_700_000_000_403 })
  assert.equal(files.task.requirementsRevision, 4)
  const status = state.store.mutateTask({ ...base, commandId: 'command_status_only', eventRef: 'event_status_only', expectedRevision: 4, type: 'task.transitioned', patch: { status: 'in_progress', requirementsChanged: false }, createdAt: 1_700_000_000_404 })
  assert.equal(status.task.requirementsRevision, 4)
  const sameTitle = state.store.mutateTask({ ...base, commandId: 'command_same_title', eventRef: 'event_same_title', expectedRevision: 5, type: 'task.edited', patch: { title: 'changed title', requirementsChanged: false }, createdAt: 1_700_000_000_405 })
  assert.equal(sameTitle.task.requirementsRevision, 4, 'writing the same requirement value is not a change')
  const explicit = state.store.mutateTask({ ...base, commandId: 'command_explicit_requirement', eventRef: 'event_explicit_requirement', expectedRevision: 6, type: 'task.requirement_change', patch: { requirementsChanged: true }, createdAt: 1_700_000_000_406 })
  assert.equal(explicit.task.requirementsRevision, 5)
}))

test('a failure after task UPDATE rolls the whole transaction back', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  assert.throws(() => state.store.mutateTask({
    projectRef,
    taskRef: created.task.taskRef,
    commandId: `command_${'E'.repeat(24)}`,
    eventRef: `event_${'E'.repeat(24)}`,
    expectedRevision: 1,
    actorRef: `actor_${'O'.repeat(24)}`,
    type: 'task.transitioned',
    patch: { status: 'in_progress' },
    eventPayload: { oversized: 'x'.repeat(70 * 1024) },
    createdAt: 1_700_000_000_300,
  }), /exceeds 65536 bytes/u)
  assert.equal(state.store.getTask({ projectRef, taskRef: created.task.taskRef }).status, 'todo')
  assert.equal(state.store.getTask({ projectRef, taskRef: created.task.taskRef }).revision, 1)
  assert.equal(state.store.getProjectRevision(projectRef), 1)
  assert.equal(state.store.listEvents({ projectRef, afterRevision: 0 }).length, 1)
}))

test('wrong keys, ciphertext tampering, and revision rollback floors fail closed', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  state.store.close()

  const wrongKeyStore = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: () => randomBytes(32) })
  wrongKeyStore.initialize()
  assert.throws(() => wrongKeyStore.getTask({ projectRef, taskRef: created.task.taskRef }), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
  wrongKeyStore.close()

  const database = new DatabaseSync(state.filePath)
  try { database.prepare("UPDATE project_tasks SET title_cipher = replace(title_cipher, 'A', 'B') WHERE project_ref = ? AND task_ref = ?").run(projectRef, created.task.taskRef) }
  finally { database.close() }
  const tampered = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider })
  tampered.initialize()
  assert.throws(() => tampered.getTask({ projectRef, taskRef: created.task.taskRef }), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
  tampered.close()

  const rollback = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider, minimumRevisionProvider: ref => ref === projectRef ? 2 : 0 })
  rollback.initialize()
  assert.throws(() => rollback.getProjectRevision(projectRef), error => error.code === 'PROJECT_TASK_ROLLBACK')
  rollback.close()
}))

test('schema v1 migrates additively to v12 without losing encrypted task data', async () => {
  const storeMod = await import(storeUrl)
  const cryptoMod = await import(cryptoUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-task-v1-'))
  const filePath = path.join(root, 'legacy.sqlite')
  const key = randomBytes(32)
  const cipher = new cryptoMod.ProjectTaskFieldCipher({ keyProvider: () => key })
  const taskRef = `task_${'L'.repeat(24)}`
  const database = new DatabaseSync(filePath)
  try {
    database.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE project_task_projects (project_ref TEXT PRIMARY KEY, project_revision INTEGER NOT NULL) STRICT;
      CREATE TABLE project_tasks (project_ref TEXT NOT NULL, task_ref TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL, requirements_revision INTEGER NOT NULL, owner_actor_ref TEXT NOT NULL, assignee_actor_ref TEXT, title_cipher TEXT NOT NULL, requirements_cipher TEXT NOT NULL, file_scope_cipher TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(project_ref, task_ref)) STRICT;
      CREATE TABLE project_task_events (project_ref TEXT NOT NULL, project_revision INTEGER NOT NULL, event_ref TEXT NOT NULL, command_id TEXT NOT NULL, command_digest TEXT NOT NULL, task_ref TEXT NOT NULL, type TEXT NOT NULL, actor_ref TEXT NOT NULL, payload_cipher TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(project_ref, project_revision), UNIQUE(project_ref, event_ref), UNIQUE(project_ref, command_id)) STRICT;
      CREATE INDEX project_task_events_cursor ON project_task_events(project_ref, project_revision);
      PRAGMA user_version = 1;`)
    database.prepare('INSERT INTO project_task_projects VALUES (?, 1)').run(projectRef)
    database.prepare('INSERT INTO project_tasks VALUES (?, ?, ?, 1, 1, ?, NULL, ?, ?, ?, 1, 1)').run(projectRef, taskRef, 'todo', `actor_${'O'.repeat(24)}`, cipher.seal(projectRef, `tasks/${taskRef}/title`, 'legacy secret'), cipher.seal(projectRef, `tasks/${taskRef}/requirements`, {}), cipher.seal(projectRef, `tasks/${taskRef}/fileScope`, []))
    database.prepare('INSERT INTO project_task_events VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 1)').run(projectRef, 'event_legacy', 'command_legacy', `sha256:${'a'.repeat(64)}`, taskRef, 'task.created', `actor_${'O'.repeat(24)}`, cipher.seal(projectRef, 'events/event_legacy/payload', {}))
  } finally { database.close() }
  const store = new storeMod.ProjectTaskStore({ filePath, keyProvider: () => key })
  try {
    assert.equal(store.initialize().version, 12)
    assert.equal(store.getTask({ projectRef, taskRef }).title, 'legacy secret')
    assert.throws(() => store.getCommandReceipt({ projectRef, commandId: 'command_legacy' }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
    const migrated = new DatabaseSync(filePath, { readOnly: true })
    try {
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 12)
      assert.equal(migrated.prepare("SELECT 1 FROM pragma_table_info('project_tasks') WHERE name='priority'").get()[1], 1)
      for (const table of ['project_task_actors', 'project_task_comments', 'project_task_relations', 'project_task_attempts', 'project_task_reviews', 'project_task_command_receipts', 'project_collaboration_boards', 'project_collaboration_seats', 'project_collaboration_locks', 'project_collaboration_handoffs', 'project_collaboration_evidence', 'project_collaboration_history', 'project_collaboration_root_reservations', 'project_collaboration_requests', 'project_task_claim_next_receipts', 'project_collaboration_root_recoveries']) {
        assert.equal(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)[1], 1)
      }
    } finally { migrated.close() }
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('task snapshots are bounded and deterministically ordered with hasMore', async () => usingFixture(async state => {
  const baseTask = createInput().task
  for (const [suffix, createdAt] of [['Z', 10], ['B', 20], ['A', 20]]) {
    const ref = `task_${suffix.repeat(24)}`
    state.store.createTask(createInput({ commandId: `command_${suffix.repeat(24)}`, eventRef: `event_${suffix.repeat(24)}`, createdAt, task: { ...baseTask, taskRef: ref, title: `title ${suffix}` } }))
  }
  const snapshot = state.store.readTaskSnapshot({ projectRef, limit: 2 })
  assert.equal(snapshot.projectRevision, 3)
  assert.equal(snapshot.tasks.length, 2)
  assert.equal(snapshot.hasMore, true)
  assert.deepEqual(snapshot.tasks.map(task => task.taskRef), [`task_${'A'.repeat(24)}`, `task_${'B'.repeat(24)}`])
  assert.deepEqual(state.store.listTasks({ projectRef, limit: 2 }), snapshot.tasks)
  assert.throws(() => state.store.readTaskSnapshot({ projectRef, limit: 0 }), /limit/u)
  assert.throws(() => state.store.readTaskSnapshot({ projectRef, limit: 501 }), /limit/u)
  assert.deepEqual(state.store.readTaskSnapshot({ projectRef: secondProjectRef, limit: 1 }), { projectRevision: 0, tasks: [], hasMore: false })
}))

test('task snapshot queries 501 rows to bound a 500 item page and survives restart', async () => usingFixture(async state => {
  const cipher = new state.cryptoMod.ProjectTaskFieldCipher({ keyProvider: state.keyProvider })
  const database = state.store.database
  database.exec('BEGIN IMMEDIATE')
  try {
    database.prepare('INSERT INTO project_task_projects(project_ref, project_revision) VALUES (?, 501)').run(projectRef)
    const insert = database.prepare(`INSERT INTO project_tasks(project_ref, task_ref, status, revision, requirements_revision, owner_actor_ref, assignee_actor_ref, title_cipher, requirements_cipher, file_scope_cipher, created_at, updated_at)
      VALUES (?, ?, 'todo', 1, 1, ?, NULL, ?, ?, ?, ?, ?)`)
    for (let index = 0; index < 501; index += 1) {
      const taskRef = `task_page_${String(index).padStart(4, '0')}`
      insert.run(projectRef, taskRef, 'actor_owner', cipher.seal(projectRef, `tasks/${taskRef}/title`, `title ${index}`), cipher.seal(projectRef, `tasks/${taskRef}/requirements`, {}), cipher.seal(projectRef, `tasks/${taskRef}/fileScope`, []), index, index)
    }
    database.exec('COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
  const first = state.store.readTaskSnapshot({ projectRef, limit: 500 })
  assert.equal(first.tasks.length, 500)
  assert.equal(first.hasMore, true)
  assert.equal(first.tasks[0].taskRef, 'task_page_0500')
  state.store.close()
  const restarted = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider })
  restarted.initialize()
  try { assert.deepEqual(restarted.readTaskSnapshot({ projectRef, limit: 500 }), first) } finally { restarted.close() }
}))

test('snapshot revision and rows share one WAL read transaction under a competing writer', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  const writer = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider })
  writer.initialize()
  let armed = true
  const reader = new state.storeMod.ProjectTaskStore({
    filePath: state.filePath,
    keyProvider: state.keyProvider,
    minimumRevisionProvider: () => {
      if (armed) {
        armed = false
        writer.mutateTask({ projectRef, taskRef: created.task.taskRef, commandId: 'command_concurrent', eventRef: 'event_concurrent', expectedRevision: 1, actorRef: 'actor_owner', type: 'task.requirements_changed', patch: { title: 'new snapshot title' }, eventPayload: {}, createdAt: 1_700_000_000_500 })
      }
      return 0
    },
  })
  reader.initialize()
  try {
    const oldSnapshot = reader.readTaskSnapshot({ projectRef, limit: 10 })
    assert.equal(oldSnapshot.projectRevision, 1)
    assert.equal(oldSnapshot.tasks[0].title, 'secret launch title')
    const newSnapshot = reader.readTaskSnapshot({ projectRef, limit: 10 })
    assert.equal(newSnapshot.projectRevision, 2)
    assert.equal(newSnapshot.tasks[0].title, 'new snapshot title')
  } finally { reader.close(); writer.close() }
}))

test('snapshot failures always roll back the read transaction', async () => usingFixture(async state => {
  const created = state.store.createTask(createInput())
  const row = state.store.database.prepare('SELECT title_cipher FROM project_tasks WHERE project_ref = ? AND task_ref = ?').get(projectRef, created.task.taskRef)
  state.store.database.prepare("UPDATE project_tasks SET title_cipher = 'tampered' WHERE project_ref = ? AND task_ref = ?").run(projectRef, created.task.taskRef)
  assert.throws(() => state.store.readTaskSnapshot({ projectRef, limit: 10 }), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID')
  state.store.database.prepare('UPDATE project_tasks SET title_cipher = ? WHERE project_ref = ? AND task_ref = ?').run(row.title_cipher, projectRef, created.task.taskRef)
  assert.equal(state.store.readTaskSnapshot({ projectRef, limit: 10 }).tasks[0].title, 'secret launch title')

  const wrong = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: () => randomBytes(32) })
  wrong.initialize()
  try { assert.throws(() => wrong.readTaskSnapshot({ projectRef, limit: 10 }), error => error.code === 'PROJECT_TASK_CIPHERTEXT_INVALID') } finally { wrong.close() }

  let floorChecks = 0
  let raiseFloorAfterRead = true
  const floorReader = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider, minimumRevisionProvider: () => raiseFloorAfterRead && ++floorChecks === 2 ? 2 : 0 })
  floorReader.initialize()
  try {
    assert.throws(() => floorReader.readTaskSnapshot({ projectRef, limit: 10 }), error => error.code === 'PROJECT_TASK_ROLLBACK')
    raiseFloorAfterRead = false
    assert.equal(floorReader.readTaskSnapshot({ projectRef, limit: 10 }).projectRevision, 1)
  } finally { floorReader.close() }
}))

test('project partitions use independent revisions and keys', async () => usingFixture(async state => {
  state.store.createTask(createInput())
  const second = createInput({
    projectRef: secondProjectRef,
    commandId: `command_${'Z'.repeat(24)}`,
    eventRef: `event_${'Z'.repeat(24)}`,
    task: { ...createInput().task, taskRef: `task_${'Z'.repeat(24)}`, title: 'second project secret' },
  })
  state.store.createTask(second)
  assert.equal(state.store.getProjectRevision(projectRef), 1)
  assert.equal(state.store.getProjectRevision(secondProjectRef), 1)
  assert.equal(state.store.getTask({ projectRef: secondProjectRef, taskRef: second.task.taskRef }).title, 'second project secret')
  assert.equal(state.store.getTask({ projectRef, taskRef: second.task.taskRef }), undefined)
}))

test('keyset task windows traverse 601 identical timestamps exactly once and retain project totals', async () => usingFixture(async state => {
  const timestamp = 1_900_000_000_000
  const expected = []
  for (let index = 0; index < 601; index += 1) {
    const suffix = String(index).padStart(4, '0')
    const taskRef = `task_keyset_${suffix}`
    expected.push(taskRef)
    state.store.createTask(createInput({
      commandId: `command_keyset_${suffix}`,
      eventRef: `event_keyset_${suffix}`,
      createdAt: timestamp,
      task: { ...createInput().task, taskRef, title: `Keyset ${suffix}` },
    }))
  }
  state.store.createTask(createInput({
    projectRef: secondProjectRef,
    commandId: 'command_other_project',
    eventRef: 'event_other_project',
    createdAt: timestamp,
    task: { ...createInput().task, taskRef: 'task_other_project', title: 'isolated' },
  }))

  const seen = []
  let boundary
  do {
    const page = state.store.readTaskWindow({ projectRef, limit: 120, ...(boundary ? { afterStatusRank: boundary.statusRank, afterPriority: boundary.priority, afterUpdatedAt: boundary.updatedAt, afterCreatedAt: boundary.createdAt, afterTaskRef: boundary.taskRef } : {}) })
    assert.equal(page.projectRevision, 601)
    assert.equal(page.totalTasks, 601)
    assert.ok(page.tasks.length <= 120)
    seen.push(...page.tasks.map((task) => task.taskRef))
    boundary = page.nextBoundary
  } while (boundary)

  assert.deepEqual(seen, expected)
  assert.equal(new Set(seen).size, 601)
  assert.deepEqual(state.store.readTaskWindow({ projectRef: secondProjectRef, limit: 120 }).tasks.map((task) => task.taskRef), ['task_other_project'])
  assert.throws(() => state.store.readTaskWindow({ projectRef, limit: 120, afterUpdatedAt: timestamp }), /boundary fields.*together/u)
}))

test('task keysets preserve global status, explicit priority, time, and task-ref order across page boundaries', async () => usingFixture(async state => {
  const groups = [['in_progress', 0], ['in_review', 1], ['blocked', 2], ['todo', 3], ['done', 4], ['canceled', 5]], expected = []
  for (const [status, rank] of groups) {
    for (let index = 0; index < 31; index += 1) {
      const taskRef = `task_rank_${rank}_${String(index).padStart(3, '0')}`, priority = index % 4, createdAt = 10_000 + (index % 7)
      state.store.createTask(createInput({ commandId: `command_rank_${rank}_${index}`, eventRef: `event_rank_${rank}_${index}`, createdAt, task: { ...createInput().task, taskRef, status, priority, title: `全局排序 ${status} ${index}` } }))
      expected.push({ taskRef, rank, priority, createdAt })
    }
  }
  for (const [rank, alias] of [[0, 'working'], [1, 'review'], [3, 'queued'], [4, 'completed'], [5, 'cancelled']]) state.store.database.prepare('UPDATE project_tasks SET status=? WHERE project_ref=? AND task_ref=?').run(alias, projectRef, `task_rank_${rank}_000`)
  state.store.createTask(createInput({ projectRef: secondProjectRef, commandId: 'command_rank_foreign', eventRef: 'event_rank_foreign', createdAt: 99_999, task: { ...createInput().task, taskRef: 'task_rank_foreign', status: 'in_progress', priority: 1_000_000, title: 'foreign project' } }))
  expected.sort((left, right) => left.rank - right.rank || right.priority - left.priority || right.createdAt - left.createdAt || left.taskRef.localeCompare(right.taskRef))
  const seen = []
  let boundary
  do {
    const page = state.store.readTaskWindow({ projectRef, limit: 17, ...(boundary ? { afterStatusRank: boundary.statusRank, afterPriority: boundary.priority, afterUpdatedAt: boundary.updatedAt, afterCreatedAt: boundary.createdAt, afterTaskRef: boundary.taskRef } : {}) })
    assert.deepEqual(page.groupTotals, { in_progress: 31, in_review: 31, blocked: 31, pending: 31, completed: 31, canceled: 31 })
    seen.push(...page.tasks.map(task => task.taskRef))
    boundary = page.nextBoundary
  } while (boundary)
  assert.deepEqual(seen, expected.map(item => item.taskRef))
  assert.equal(new Set(seen).size, expected.length)
  assert.equal(seen.includes('task_rank_foreign'), false)
}))

test('section keysets stay project-sharded and bounded across 16 projects and thousands of rows with indexed plans', async () => usingFixture(async state => {
  const projects = Array.from({ length: 16 }, (_, index) => `project_${index.toString(36).padStart(24, '0')}`)
  for (const [index, ref] of projects.entries()) {
    state.keys.set(ref, randomBytes(32))
    state.store.createCollaborationBoard({ projectRef: ref, coordinatorActorRef: `actor_lead_${index}`, title: `Board ${index}`, createdAt: index + 1 })
  }
  const insertSeat = state.store.database.prepare(`INSERT INTO project_collaboration_seats(project_ref,actor_ref,parent_actor_ref,kind,state,revision,duty_cipher,resource_scope_cipher,phase_cipher,next_step_cipher,created_at,updated_at) VALUES(?,?,NULL,'member','active',1,?,?,?,?,?,?)`)
  const insertTask = state.store.database.prepare(`INSERT INTO project_tasks(project_ref,task_ref,status,revision,requirements_revision,owner_actor_ref,assignee_actor_ref,title_cipher,requirements_cipher,file_scope_cipher,created_at,updated_at) VALUES(?,?,?,1,1,?,NULL,?,?,?,?,?)`)
  state.store.database.exec('BEGIN IMMEDIATE')
  try {
    for (const [projectIndex, ref] of projects.entries()) {
      const seatCount = projectIndex === 0 ? 2000 : 8
      for (let index = 0; index < seatCount; index += 1) {
        const actorRef = `actor_${projectIndex}_${String(index).padStart(5, '0')}`
        const field = name => `collaboration/seat/${actorRef}/${name}`
        insertSeat.run(ref, actorRef, state.store.cipher.seal(ref, field('duty'), `Duty ${index}`), state.store.cipher.seal(ref, field('resourceScope'), []), state.store.cipher.seal(ref, field('phase'), 'running'), state.store.cipher.seal(ref, field('nextStep'), ''), index, index)
      }
    }
    const statuses = ['done', 'todo', 'in_progress', 'blocked']
    for (let index = 0; index < 1000; index += 1) {
      const taskRef = `task_scale_${String(index).padStart(5, '0')}`, status = statuses[index % statuses.length], field = name => `tasks/${taskRef}/${name}`
      insertTask.run(projects[0], taskRef, status, 'actor_owner', state.store.cipher.seal(projects[0], field('title'), `Task ${index}`), state.store.cipher.seal(projects[0], field('requirements'), {}), state.store.cipher.seal(projects[0], field('fileScope'), []), index, index)
    }
    state.store.database.exec('COMMIT')
  } catch (error) { state.store.database.exec('ROLLBACK'); throw error }

  for (const [projectIndex, ref] of projects.entries()) {
    const first = state.store.readCollaborationSectionWindow({ projectRef: ref, section: 'seats', limit: 24 })
    assert.equal(first.total, projectIndex === 0 ? 2000 : 8)
    assert.ok(first.items.length <= 24)
    assert.equal(first.items.every(item => item.actorRef.startsWith(`actor_${projectIndex}_`)), true)
  }
  let decryptions = 0
  const originalOpen = state.store.cipher.open.bind(state.store.cipher)
  state.store.cipher.open = function (...args) { decryptions += 1; return originalOpen(...args) }
  const measured = state.store.readCollaborationSectionWindow({ projectRef: projects[0], section: 'seats', limit: 24 })
  assert.equal(measured.items.length, 24)
  assert.equal(decryptions, 24 * 4, 'only the bounded row window is decrypted')
  state.store.cipher.open = originalOpen

  const seen = []
  let boundary
  do {
    const page = state.store.readCollaborationSectionWindow({ projectRef: projects[0], section: 'seats', limit: 24, ...(boundary ? { boundary } : {}) })
    seen.push(...page.items.map(item => item.actorRef))
    assert.ok(page.items.length <= 24)
    boundary = page.nextBoundary
  } while (boundary)
  assert.equal(seen.length, 2000)
  assert.equal(new Set(seen).size, 2000)

  const taskPage = state.store.readCollaborationSectionWindow({ projectRef: projects[0], section: 'tasks', limit: 24 })
  assert.equal(taskPage.total, 1000)
  assert.equal(taskPage.items.every(task => task.status === 'in_progress'), true, 'active work is globally first before review, blocked, pending, completed, and canceled groups')
  const rankSql = "CASE status WHEN 'in_progress' THEN 0 WHEN 'working' THEN 0 WHEN 'in_review' THEN 1 WHEN 'review' THEN 1 WHEN 'awaiting_review' THEN 1 WHEN 'blocked' THEN 2 WHEN 'todo' THEN 3 WHEN 'assigned' THEN 3 WHEN 'queued' THEN 3 WHEN 'pending' THEN 3 WHEN 'backlog' THEN 3 WHEN 'done' THEN 4 WHEN 'completed' THEN 4 WHEN 'canceled' THEN 5 WHEN 'cancelled' THEN 5 ELSE 3 END"
  const plan = state.store.database.prepare(`EXPLAIN QUERY PLAN SELECT *,${rankSql} AS sort_rank,COALESCE(priority,-1) AS sort_priority FROM project_tasks WHERE project_ref=? ORDER BY sort_rank ASC,sort_priority DESC,updated_at DESC,created_at DESC,task_ref ASC LIMIT ?`).all(projects[0], 25).map(row => row.detail).join(' ')
  assert.match(plan, /project_tasks_collaboration_window/u)
  assert.doesNotMatch(plan, /TEMP B-TREE|SCAN project_tasks\b/u, 'task priority keyset must not full-scan or sort into a temporary B-tree')

  const fenced = state.store.readCollaborationSectionWindow({ projectRef: projects[0], section: 'seats', limit: 2 })
  state.store.upsertCollaborationSeat({ projectRef: projects[0], actorRef: 'actor_new_boundary', changedByActorRef: 'actor_lead_0', duty: 'new', resourceScope: [], phase: 'running', nextStep: 'continue', updatedAt: 3000 })
  assert.throws(() => state.store.readCollaborationSectionWindow({ projectRef: projects[0], section: 'seats', limit: 2, boundary: fenced.nextBoundary, expectedProjectRevision: fenced.projectRevision }), error => error.code === 'PROJECT_TASK_SNAPSHOT_INCONSISTENT')
}))

test('collaboration store source never exposes an unbounded section materialization query', async () => {
  const source = await readFile(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-task-store.js'), 'utf8')
  for (const table of ['project_collaboration_seats', 'project_collaboration_locks', 'project_collaboration_handoffs', 'project_collaboration_evidence', 'project_collaboration_root_recoveries']) {
    const materializers = [...source.matchAll(new RegExp(`prepare\\(\"([^\"]*SELECT \\* FROM ${table}[^\"]*)\"\\)\\.all`, 'gu'))]
    assert.equal(materializers.every(match => match[1].includes('LIMIT')), true, table)
  }
  assert.match(source, /COLLABORATION_SNAPSHOT_SECTION_LIMIT/u)
  assert.match(source, /owner_actor_ref<>\?[\s\S]*ORDER BY resource_ref ASC LIMIT 1`\)\.get/u)
  assert.equal(source.includes("SELECT * FROM project_collaboration_locks WHERE project_ref = ? AND state = 'active'\").all(projectRef)"), false)
})

test('lock acquisition stays SQL-bounded across unrelated rows and enforces exact hierarchy and project isolation', async () => usingFixture(async state => {
  const owner = `actor_${'L'.repeat(24)}`, other = `actor_${'R'.repeat(24)}`
  state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: owner, title: 'primary', createdAt: 1 })
  state.store.createCollaborationBoard({ projectRef: secondProjectRef, coordinatorActorRef: other, title: 'secondary', createdAt: 1 })
  const insert = state.store.database.prepare("INSERT INTO project_collaboration_locks(project_ref,resource_ref,owner_actor_ref,task_ref,state,revision,created_at,updated_at) VALUES(?,?,?,NULL,'active',1,1,1)")
  state.store.database.exec('BEGIN IMMEDIATE')
  try {
    for (let index = 0; index < 2500; index += 1) {
      insert.run(projectRef, `bulk/${String(index).padStart(5, '0')}`, other)
      insert.run(secondProjectRef, `bulk/${String(index).padStart(5, '0')}`, owner)
    }
    insert.run(secondProjectRef, 'isolated/path', other)
    state.store.database.exec('COMMIT')
  } catch (error) { state.store.database.exec('ROLLBACK'); throw error }
  let decryptions = 0
  const originalOpen = state.store.cipher.open.bind(state.store.cipher)
  state.store.cipher.open = function (...args) { decryptions += 1; return originalOpen(...args) }
  const acquired = state.store.acquireCollaborationLock({ projectRef, resourceRef: 'target/new', ownerActorRef: owner, updatedAt: 2 })
  assert.equal(acquired.totals.locks, 2501)
  assert.equal(acquired.locks.length <= 120, true)
  assert.equal(decryptions < 600, true, 'snapshot decode work remains page-bounded despite thousands of unrelated locks')
  const revision = state.store.getProjectRevision(projectRef)
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'target/new', ownerActorRef: owner, updatedAt: 3 })
  assert.equal(state.store.getProjectRevision(projectRef), revision, 'same-owner exact replay preserves the existing current.get semantics')
  assert.throws(() => state.store.acquireCollaborationLock({ projectRef, resourceRef: 'target/new', ownerActorRef: other, updatedAt: 4 }), error => error.code === 'PROJECT_COLLABORATION_RESOURCE_CONFLICT')
  insert.run(projectRef, 'tree', other)
  assert.throws(() => state.store.acquireCollaborationLock({ projectRef, resourceRef: 'tree/leaf', ownerActorRef: owner, updatedAt: 5 }), error => error.code === 'PROJECT_COLLABORATION_RESOURCE_CONFLICT' && error.resourceRef === 'tree')
  insert.run(projectRef, 'branch/leaf', other)
  assert.throws(() => state.store.acquireCollaborationLock({ projectRef, resourceRef: 'branch', ownerActorRef: owner, updatedAt: 6 }), error => error.code === 'PROJECT_COLLABORATION_RESOURCE_CONFLICT' && error.resourceRef === 'branch/leaf')
  insert.run(projectRef, 'mine', owner)
  assert.doesNotThrow(() => state.store.acquireCollaborationLock({ projectRef, resourceRef: 'mine/child', ownerActorRef: owner, updatedAt: 7 }))
  assert.doesNotThrow(() => state.store.acquireCollaborationLock({ projectRef, resourceRef: 'isolated/path', ownerActorRef: owner, updatedAt: 8 }), 'another project never conflicts')
  const plan = state.store.database.prepare(`EXPLAIN QUERY PLAN SELECT resource_ref FROM project_collaboration_locks WHERE project_ref=? AND state='active' AND owner_actor_ref<>? AND (resource_ref=? OR substr(resource_ref,1,length(?)+1)=?||'/' OR substr(?,1,length(resource_ref)+1)=resource_ref||'/') ORDER BY resource_ref ASC LIMIT 1`).all(projectRef, owner, 'probe', 'probe', 'probe', 'probe').map(row => row.detail).join(' ')
  assert.match(plan, /project_collaboration_locks_(?:state|window)/u)
  assert.doesNotMatch(plan, /TEMP B-TREE/u)
  state.store.cipher.open = originalOpen
}))

test('project collaboration state is project-sharded, encrypted, OCC fenced, and resource conflicts fail closed', async () => usingFixture(async state => {
  const owner = `actor_${'O'.repeat(24)}`
  const participant = `actor_${'P'.repeat(24)}`
  const created = state.store.createTask(createInput())
  assert.equal(created.task.taskRef, createInput().task.taskRef)
  state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: owner, title: 'Private launch board', createdAt: 10 })
  assert.equal(state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: owner, title: 'Private launch board', createdAt: 99 }).revision, 1, 'exact board replay is idempotent')
  assert.throws(() => state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: owner, title: 'changed', createdAt: 99 }), error => error.code === 'PROJECT_COLLABORATION_CONFLICT')
  state.store.upsertCollaborationSeat({ projectRef, actorRef: owner, changedByActorRef: owner, expectedRevision: 0, kind: 'root', duty: 'Coordinate delivery', resourceScope: ['src/core'], phase: 'implementation', nextStep: 'Review evidence', updatedAt: 11 })
  assert.equal(state.store.upsertCollaborationSeat({ projectRef, actorRef: owner, changedByActorRef: owner, expectedRevision: 0, kind: 'root', duty: 'Coordinate delivery', resourceScope: ['src/core'], phase: 'implementation', nextStep: 'Review evidence', updatedAt: 99 }).seats[0].revision, 1, 'exact OCC replay is idempotent')
  assert.throws(() => state.store.upsertCollaborationSeat({ projectRef, actorRef: owner, changedByActorRef: owner, expectedRevision: 0, kind: 'root', duty: 'stale', resourceScope: [], updatedAt: 12 }), error => error.code === 'PROJECT_COLLABORATION_CONFLICT')
  state.store.upsertCollaborationSeat({ projectRef, actorRef: participant, changedByActorRef: owner, expectedRevision: 0, kind: 'root', duty: 'Implement core', resourceScope: ['src/core/store'], phase: 'implementation', nextStep: 'Submit evidence', updatedAt: 12 })
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/core', ownerActorRef: owner, taskRef: createInput().task.taskRef, updatedAt: 13 })
  assert.throws(() => state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/core/store', ownerActorRef: participant, updatedAt: 14 }), error => error.code === 'PROJECT_COLLABORATION_RESOURCE_CONFLICT')
  state.store.prepareCollaborationHandoff({ projectRef, handoffRef: 'handoff_core', taskRef: createInput().task.taskRef, sourceActorRef: owner, targetActorRef: participant, summary: 'Core ready for continuation', updatedAt: 15 })
  assert.equal(state.store.prepareCollaborationHandoff({ projectRef, handoffRef: 'handoff_core', taskRef: createInput().task.taskRef, sourceActorRef: owner, targetActorRef: participant, summary: 'Core ready for continuation', updatedAt: 99 }).handoffs[0].revision, 1)
  state.store.addCollaborationEvidence({ projectRef, evidenceRef: 'evidence_core', taskRef: createInput().task.taskRef, actorRef: owner, path: 'tests/core.test.cjs', digest: `sha256:${'d'.repeat(64)}`, summary: 'Core test passed', createdAt: 16 })
  assert.equal(state.store.addCollaborationEvidence({ projectRef, evidenceRef: 'evidence_core', taskRef: createInput().task.taskRef, actorRef: owner, path: 'tests/core.test.cjs', digest: `sha256:${'d'.repeat(64)}`, summary: 'Core test passed', createdAt: 99 }).totals.evidence, 1)
  assert.throws(() => state.store.addCollaborationEvidence({ projectRef, evidenceRef: 'evidence_bad', taskRef: createInput().task.taskRef, actorRef: owner, path: '../outside.txt', digest: `sha256:${'e'.repeat(64)}`, summary: 'bad', createdAt: 17 }), /project-relative/u)
  state.store.commitCollaborationHandoff({ projectRef, handoffRef: 'handoff_core', targetActorRef: participant, updatedAt: 17 })
  const snapshot = state.store.readCollaborationSnapshot({ projectRef, historyLimit: 3 })
  assert.equal(snapshot.title, 'Private launch board')
  assert.equal(snapshot.totals.seats, 2)
  assert.equal(snapshot.totals.locks, 1)
  assert.equal(snapshot.totals.handoffs, 1)
  assert.equal(snapshot.totals.evidence, 1)
  assert.equal(snapshot.handoffs[0].state, 'committed')
  assert.equal(snapshot.page.hasMoreHistory, true)
  assert.equal(state.store.getTask({ projectRef, taskRef: createInput().task.taskRef }).assigneeActorRef, participant)
  assert.equal(state.store.readCollaborationSnapshot({ projectRef: secondProjectRef }), undefined)

  const database = new DatabaseSync(state.filePath, { readOnly: true })
  try {
    const raw = JSON.stringify({ board: database.prepare('SELECT title_cipher FROM project_collaboration_boards').get(), seats: database.prepare('SELECT duty_cipher, resource_scope_cipher, phase_cipher, next_step_cipher FROM project_collaboration_seats').all(), evidence: database.prepare('SELECT path_cipher, summary_cipher FROM project_collaboration_evidence').get() })
    for (const secret of ['Private launch board', 'Coordinate delivery', 'src/core', 'tests/core.test.cjs', 'Core test passed']) assert.equal(raw.includes(secret), false)
  } finally { database.close() }
}))

test('blocked collaboration requests derive owner routes, dedupe rounds, and require response or audited deadline takeover', async () => usingFixture(async state => {
  const requester = 'actor_requester_root', target = 'actor_target_root', owner = 'actor_dependency_owner', unrelated = 'actor_unrelated_lock_owner', lead = 'actor_project_lead'
  const blockedTaskRef = 'task_blocked_requester', dependencyTaskRef = 'task_foreign_dependency'
  const makeTask = (taskRef, ownerActorRef, commandId, eventRef, status='todo') => state.store.createTask({ projectRef, commandId, eventRef, actorRef: ownerActorRef, expectedRevision: 0, createdAt: 1, task: { taskRef, status, ownerActorRef, assigneeActorRef: ownerActorRef, title: taskRef, requirements: {}, fileScope: [] }, eventPayload: {} })
  makeTask(blockedTaskRef, requester, 'command_blocked_request', 'event_blocked_request', 'blocked')
  makeTask(dependencyTaskRef, target, 'command_foreign_dependency', 'event_foreign_dependency')
  state.store.database.prepare('UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?').run(owner,projectRef,dependencyTaskRef)
  state.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_request_block',dependencyTaskRef,blockedTaskRef,'blocks',lead,2)
  state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: lead, title: 'Request board', createdAt: 3 })
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/assignee-lock', ownerActorRef: target, taskRef: dependencyTaskRef, updatedAt: 4 })
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/owner-lock', ownerActorRef: owner, taskRef: dependencyTaskRef, updatedAt: 4 })
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/unrelated-lock', ownerActorRef: unrelated, taskRef: dependencyTaskRef, updatedAt: 4 })
  const lockOwners = taskRef => Object.fromEntries(state.store.readCollaborationSnapshot({ projectRef }).locks.filter(lock => lock.taskRef === taskRef).map(lock => [lock.resourceRef, lock.ownerActorRef]))
  const input = { projectRef, requestRef: 'request_unblock_1', requestId: 'request_id_unblock_1', kind: 'takeover', taskRef: blockedTaskRef, dependencyTaskRef, requesterActorRef: requester, reason: 'SourceEnd is unavailable', respondByAt: 100, createdAt: 5 }
  const opened = state.store.createCollaborationRequest(input)
  assert.equal(opened.request.targetActorRef, target)
  assert.equal(opened.request.state, 'open')
  const replayed = state.store.createCollaborationRequest({ ...input, requestRef: 'request_unblock_2', requestId: 'request_id_unblock_2', createdAt: 6 })
  assert.equal(replayed.duplicate, true, 'same blocked request is not a new round')
  assert.equal(replayed.projectRevision, opened.projectRevision, 'exact request replay is revision-idempotent')
  assert.deepEqual(lockOwners(dependencyTaskRef), { 'src/assignee-lock': target, 'src/owner-lock': owner, 'src/unrelated-lock': unrelated }, 'exact request replay cannot migrate locks early')
  assert.throws(() => state.store.createCollaborationRequest({ ...input, requestRef: 'request_unblock_3', requestId: 'request_id_unblock_3', reason: 'drift', createdAt: 7 }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
  assert.throws(() => state.store.escalateCollaborationRequest({ projectRef, requestRef: input.requestRef, coordinatorActorRef: lead, expectedRevision: 1, resolution: 'too early', updatedAt: 99 }), error => error.code === 'PROJECT_COLLABORATION_DEADLINE_PENDING')
  assert.throws(() => state.store.respondCollaborationRequest({ projectRef, requestRef: input.requestRef, actorRef: requester, expectedRevision: 1, action: 'release', resolution: 'steal', updatedAt: 99 }), error => error.code === 'PROJECT_COLLABORATION_FORBIDDEN')
  assert.throws(() => state.store.respondCollaborationRequest({ projectRef, requestRef: input.requestRef, actorRef: target, expectedRevision: 1, action: 'reject', resolution: '界'.repeat(1500), updatedAt: 99 }), /4096 UTF-8 bytes/u)
  state.store.database.prepare('UPDATE project_tasks SET assignee_actor_ref=? WHERE project_ref=? AND task_ref=?').run('actor_new_assignee',projectRef,dependencyTaskRef)
  assert.throws(() => state.store.createCollaborationRequest({ ...input, createdAt: 99 }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT', 'replay re-derives current effective assignee before matching old route')
  assert.throws(() => state.store.respondCollaborationRequest({ projectRef, requestRef: input.requestRef, actorRef: target, expectedRevision: 1, action: 'release', resolution: 'stale assignee', updatedAt: 99 }), error => error.code === 'PROJECT_COLLABORATION_CONFLICT', 'B to C assignee change cannot transfer')
  assert.equal(state.store.getCollaborationRequest({projectRef,requestRef:input.requestRef}).state,'open')
  assert.equal(state.store.getTask({projectRef,taskRef:dependencyTaskRef}).ownerActorRef,owner)
  assert.deepEqual(lockOwners(dependencyTaskRef), { 'src/assignee-lock': target, 'src/owner-lock': owner, 'src/unrelated-lock': unrelated }, 'stale response leaves every lock unchanged')
  state.store.database.prepare('UPDATE project_tasks SET assignee_actor_ref=NULL WHERE project_ref=? AND task_ref=?').run(projectRef,dependencyTaskRef)
  assert.throws(() => state.store.respondCollaborationRequest({ projectRef, requestRef: input.requestRef, actorRef: target, expectedRevision: 1, action: 'release', resolution: 'removed assignee', updatedAt: 99 }), error => error.code === 'PROJECT_COLLABORATION_CONFLICT', 'removing B changes effective target back to owner A')
  assert.deepEqual(lockOwners(dependencyTaskRef), { 'src/assignee-lock': target, 'src/owner-lock': owner, 'src/unrelated-lock': unrelated }, 'failed effective-target CAS cannot partially migrate locks')
  state.store.database.prepare('UPDATE project_tasks SET assignee_actor_ref=? WHERE project_ref=? AND task_ref=?').run(target,projectRef,dependencyTaskRef)
  state.store.database.exec(`CREATE TRIGGER fail_takeover_task BEFORE UPDATE OF owner_actor_ref ON project_tasks WHEN OLD.task_ref='${dependencyTaskRef}' AND NEW.owner_actor_ref='${requester}' BEGIN SELECT RAISE(ABORT, 'injected takeover task failure'); END`)
  assert.throws(() => state.store.respondCollaborationRequest({ projectRef, requestRef: input.requestRef, actorRef: target, expectedRevision: 1, action: 'release', resolution: 'must roll back', updatedAt: 100 }), /injected takeover task failure/u)
  assert.equal(state.store.getCollaborationRequest({ projectRef, requestRef: input.requestRef }).state, 'open')
  assert.equal(state.store.getTask({ projectRef, taskRef: dependencyTaskRef }).ownerActorRef, owner)
  assert.equal(state.store.getTask({ projectRef, taskRef: dependencyTaskRef }).assigneeActorRef, target)
  assert.deepEqual(lockOwners(dependencyTaskRef), { 'src/assignee-lock': target, 'src/owner-lock': owner, 'src/unrelated-lock': unrelated }, 'a later task-write failure rolls back every earlier lock migration')
  state.store.database.exec('DROP TRIGGER fail_takeover_task')
  const resolved = state.store.respondCollaborationRequest({ projectRef, requestRef: input.requestRef, actorRef: target, expectedRevision: 1, action: 'release', resolution: 'assignee releases work', updatedAt: 100 })
  assert.equal(resolved.request.state, 'resolved')
  assert.equal(state.store.getTask({ projectRef, taskRef: dependencyTaskRef }).ownerActorRef, requester)
  assert.equal(state.store.getTask({ projectRef, taskRef: dependencyTaskRef }).assigneeActorRef, requester, 'release transfers both owner and assignee to requester')
  assert.deepEqual(lockOwners(dependencyTaskRef), { 'src/assignee-lock': requester, 'src/owner-lock': requester, 'src/unrelated-lock': unrelated }, 'release atomically migrates active locks from both old responsibility actors and never unrelated actors')
  assert.throws(() => state.store.escalateCollaborationRequest({ projectRef, requestRef: input.requestRef, coordinatorActorRef: lead, expectedRevision: 1, resolution: 'race', updatedAt: 101 }), error => error.code === 'PROJECT_COLLABORATION_CONFLICT')
  const deadlineTaskRef = 'task_foreign_deadline', deadlineOwner = 'actor_deadline_owner'
  makeTask('task_blocked_deadline', requester, 'command_blocked_deadline', 'event_blocked_deadline', 'blocked')
  makeTask(deadlineTaskRef, target, 'command_foreign_deadline', 'event_foreign_deadline')
  state.store.database.prepare('UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?').run(deadlineOwner,projectRef,deadlineTaskRef)
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/deadline-assignee-lock', ownerActorRef: target, taskRef: deadlineTaskRef, updatedAt: 101 })
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/deadline-owner-lock', ownerActorRef: deadlineOwner, taskRef: deadlineTaskRef, updatedAt: 101 })
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/deadline-unrelated-lock', ownerActorRef: unrelated, taskRef: deadlineTaskRef, updatedAt: 101 })
  state.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_deadline_block',deadlineTaskRef,'task_blocked_deadline','blocks',lead,102)
  state.store.createCollaborationRequest({ projectRef, requestRef:'request_deadline',requestId:'request_id_deadline',kind:'dependency_unblock',taskRef:'task_blocked_deadline',dependencyTaskRef:'task_foreign_deadline',requesterActorRef:requester,reason:'owner remains unavailable',respondByAt:200,createdAt:103 })
  const acknowledged=state.store.respondCollaborationRequest({projectRef,requestRef:'request_deadline',actorRef:target,expectedRevision:1,action:'accept',resolution:'acknowledged but still blocked',updatedAt:150})
  assert.equal(acknowledged.request.state,'accepted','owner A with assignee B permits B to respond')
  state.store.database.prepare('UPDATE project_tasks SET assignee_actor_ref=? WHERE project_ref=? AND task_ref=?').run('actor_deadline_new_assignee',projectRef,'task_foreign_deadline')
  assert.throws(()=>state.store.escalateCollaborationRequest({projectRef,requestRef:'request_deadline',coordinatorActorRef:lead,expectedRevision:2,resolution:'must not steal from C',updatedAt:200}),error=>error.code==='PROJECT_COLLABORATION_CONFLICT')
  assert.equal(state.store.getCollaborationRequest({projectRef,requestRef:'request_deadline'}).state,'accepted','stale escalation leaves request unchanged')
  assert.equal(state.store.getTask({projectRef,taskRef:deadlineTaskRef}).ownerActorRef,deadlineOwner)
  assert.equal(state.store.getTask({projectRef,taskRef:deadlineTaskRef}).assigneeActorRef,'actor_deadline_new_assignee')
  assert.deepEqual(lockOwners(deadlineTaskRef), { 'src/deadline-assignee-lock': target, 'src/deadline-owner-lock': deadlineOwner, 'src/deadline-unrelated-lock': unrelated }, 'stale deadline CAS leaves request, task, and every lock unchanged')
  state.store.database.prepare('UPDATE project_tasks SET assignee_actor_ref=? WHERE project_ref=? AND task_ref=?').run(target,projectRef,'task_foreign_deadline')
  const escalated=state.store.escalateCollaborationRequest({ projectRef,requestRef:'request_deadline',coordinatorActorRef:lead,expectedRevision:2,resolution:'audited deadline takeover',updatedAt:200 })
  assert.equal(escalated.request.state,'escalated')
  assert.equal(state.store.getTask({projectRef,taskRef:deadlineTaskRef}).ownerActorRef,requester)
  assert.equal(state.store.getTask({projectRef,taskRef:deadlineTaskRef}).assigneeActorRef,requester,'takeover transfers both owner and assignee to requester')
  assert.deepEqual(lockOwners(deadlineTaskRef), { 'src/deadline-assignee-lock': requester, 'src/deadline-owner-lock': requester, 'src/deadline-unrelated-lock': unrelated }, 'deadline takeover atomically migrates old owner and assignee locks only')
  makeTask('task_blocked_retry', requester, 'command_blocked_retry', 'event_blocked_retry', 'blocked')
  makeTask('task_foreign_retry', target, 'command_foreign_retry', 'event_foreign_retry')
  state.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_retry_block','task_foreign_retry','task_blocked_retry','blocks',lead,201)
  const retryInput={projectRef,requestRef:'request_retry_1',requestId:'request_id_retry_1',kind:'dependency_unblock',taskRef:'task_blocked_retry',dependencyTaskRef:'task_foreign_retry',requesterActorRef:requester,reason:'still blocked after rejection',respondByAt:300,createdAt:202}
  state.store.createCollaborationRequest(retryInput)
  assert.equal(state.store.respondCollaborationRequest({projectRef,requestRef:retryInput.requestRef,actorRef:target,expectedRevision:1,action:'reject',resolution:'cannot unblock',updatedAt:203}).request.state,'rejected')
  assert.equal(state.store.createCollaborationRequest({...retryInput,requestRef:'request_retry_2',requestId:'request_id_retry_2',createdAt:204}).duplicate,false,'terminal still-blocked cycle permits a legitimate new request')
  assert.throws(()=>state.store.createCollaborationRequest({...retryInput,requestRef:'request_utf8',requestId:'request_utf8',reason:'界'.repeat(1500),createdAt:205}),/4096 UTF-8 bytes/u)
  const window = state.store.readCollaborationRequestWindow({ projectRef, limit: 1 })
  assert.equal(window.totalRequests, 4)
  assert.deepEqual(window.totals,{total:4,open:1,accepted:0,rejected:1,cancelled:0,escalated:1,resolved:1})
  assert.equal(window.hasMore,true)
  const tail=state.store.readCollaborationRequestWindow({projectRef,limit:1,afterUpdatedAt:window.nextBoundary.updatedAt,afterRequestRef:window.nextBoundary.requestRef})
  assert.equal(tail.requests.length,1)
  assert.equal(new Set([...window.requests,...tail.requests].map(request=>request.requestRef)).size,2)
  assert.equal(state.store.getCollaborationRequest({projectRef,requestRef:'request_deadline'}).resolution, 'audited deadline takeover')
  assert.equal(state.store.readCollaborationRequestWindow({ projectRef: secondProjectRef }).totalRequests, 0)
  const raw = state.store.database.prepare('SELECT reason_cipher,resolution_cipher FROM project_collaboration_requests WHERE project_ref=?').get(projectRef)
  assert.equal(JSON.stringify(raw).includes(input.reason), false)
}))

test('root seat reservation persists seat and initial task atomically then one-time adoption migrates task ownership', async () => usingFixture(async state => {
  const coordinator = 'actor_project_lead'
  const slotActorRef = 'actor_reserved_slot'
  const adoptedActorRef = 'actor_new_root'
  const taskRef = 'task_reserved_root'
  const slotCapability = 'slot_capability_opaque_abcdefghijklmnopqrstuvwxyz'
  state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: coordinator, title: 'Launch board', createdAt: 1 })
  const triggerDatabase = new DatabaseSync(state.filePath)
  try { triggerDatabase.exec("CREATE TRIGGER fail_reserved_task BEFORE INSERT ON project_tasks WHEN NEW.task_ref='task_atomic_fail' BEGIN SELECT RAISE(ABORT, 'injected reservation failure'); END") } finally { triggerDatabase.close() }
  assert.throws(() => state.store.reserveRootSeat({ projectRef, coordinatorActorRef: coordinator, requestId: 'reserve_atomic_fail', slotActorRef: 'actor_atomic_fail', slotCapability: 'atomic_fail_capability_abcdefghijklmnopqrstuvwxyz', duty: 'Fail', resourceScope: ['src/fail'], createdAt: 2, task: { taskRef: 'task_atomic_fail', title: 'Fail atomically', fileScope: ['src/fail'] } }), /injected reservation failure/u)
  assert.equal(state.store.readCollaborationSnapshot({ projectRef }).seats.some(seat => seat.actorRef === 'actor_atomic_fail'), false)
  const cleanupDatabase = new DatabaseSync(state.filePath)
  try { cleanupDatabase.exec('DROP TRIGGER fail_reserved_task') } finally { cleanupDatabase.close() }
  assert.throws(() => state.store.reserveRootSeat({ projectRef, coordinatorActorRef: coordinator, requestId: 'reserve_oversized', slotActorRef: 'actor_oversized', slotCapability: 'oversized_capability_abcdefghijklmnopqrstuvwxyz', duty: 'Oversized', resourceScope: [], createdAt: 2, task: { taskRef: 'task_oversized', title: 'Oversized', requirements: { text: 'x'.repeat(64 * 1024) } } }), /65536 bytes/u)
  const input = { projectRef, coordinatorActorRef: coordinator, requestId: 'reserve_request_1', slotActorRef, slotCapability, duty: 'Build feature', resourceScope: ['src/feature'], phase: 'queued', nextStep: 'Adopt seat', createdAt: 2, task: { taskRef, title: 'Initial root task', requirements: { acceptance: 'pass' }, fileScope: ['src/feature'] } }
  const reserved = state.store.reserveRootSeat(input)
  assert.equal(reserved.duplicate, false)
  assert.equal(reserved.seat.state, 'reserved')
  assert.equal(reserved.task.ownerActorRef, slotActorRef)
  assert.equal(reserved.task.assigneeActorRef, slotActorRef)
  assert.equal(state.store.reserveRootSeat({ ...input, createdAt: 99 }).duplicate, true)
  assert.throws(() => state.store.reserveRootSeat({ ...input, duty: 'drift', createdAt: 99 }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
  assert.throws(() => state.store.adoptRootSeat({ projectRef: secondProjectRef, slotActorRef, slotCapability, actorRef: adoptedActorRef, adoptedAt: 3 }), error => error.code === 'PROJECT_COLLABORATION_CAPABILITY_INVALID')

  const adopted = state.store.adoptRootSeat({ projectRef, slotActorRef, slotCapability, actorRef: adoptedActorRef, adoptedAt: 3 })
  assert.equal(adopted.seat.actorRef, adoptedActorRef)
  assert.equal(adopted.seat.state, 'active')
  assert.equal(adopted.task.ownerActorRef, adoptedActorRef)
  assert.equal(adopted.task.assigneeActorRef, adoptedActorRef)
  assert.equal(adopted.task.title, input.task.title)
  assert.deepEqual(adopted.task.requirements, input.task.requirements)
  assert.equal(adopted.task.revision, 2)
  assert.equal(state.store.readCollaborationSnapshot({ projectRef }).seats.some(seat => seat.actorRef === slotActorRef), false)
  assert.throws(() => state.store.adoptRootSeat({ projectRef, slotActorRef, slotCapability, actorRef: 'actor_racer', adoptedAt: 4 }), error => error.code === 'PROJECT_COLLABORATION_CAPABILITY_INVALID')
  const postAdoptionReplay = state.store.reserveRootSeat({ ...input, createdAt: 100 })
  assert.equal(postAdoptionReplay.duplicate, true)
  assert.equal(postAdoptionReplay.seat.actorRef, adoptedActorRef)
  assert.equal(postAdoptionReplay.task.ownerActorRef, adoptedActorRef)

  const database = new DatabaseSync(state.filePath, { readOnly: true })
  try {
    const raw = database.prepare('SELECT capability_digest, state, adopted_actor_ref FROM project_collaboration_root_reservations WHERE project_ref=? AND slot_actor_ref=?').get(projectRef, slotActorRef)
    assert.equal(raw.capability_digest, null)
    assert.equal(raw.state, 'adopted')
    assert.equal(raw.adopted_actor_ref, adoptedActorRef)
    assert.equal(JSON.stringify(raw).includes(slotCapability), false)
  } finally { database.close() }
}))

test('pre-adoption retry preserves the exact reserved seat capability through ready and adoption replay', async () => usingFixture(async state => {
  const coordinator='actor_retry_launch_owner',slotActorRef='actor_retry_unborn_slot',taskRef='task_retry_unborn',slotCapability='retry_unborn_capability_abcdefghijklmnopqrstuvwxyz'
  state.store.createCollaborationBoard({projectRef,coordinatorActorRef:coordinator,title:'Retry board',createdAt:1})
  state.store.reserveRootSeat({projectRef,coordinatorActorRef:coordinator,requestId:'retry_unborn_reserve',slotActorRef,slotCapability,duty:'Unborn child',resourceScope:['src/unborn'],createdAt:2,task:{taskRef,title:'Retry child task',fileScope:['src/unborn']}})
  const prepared=state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_unborn',requestId:'recovery_unborn_request',mode:'retry',failedActorRef:slotActorRef,initiatorActorRef:coordinator,beneficiaryActorRef:slotActorRef,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host create failed definitively',recoveryTaskRef:taskRef,createdAt:3})
  assert.equal(prepared.recovery.initiatorActorRef,coordinator); assert.equal(prepared.recovery.beneficiaryActorRef,slotActorRef)
  assert.equal(state.store.readCollaborationSnapshot({projectRef}).seats.find(seat=>seat.actorRef===slotActorRef).state,'reserved')
  const reserved=state.store.reserveRootRecovery({projectRef,recoveryRef:'recovery_unborn',initiatorActorRef:coordinator,launchRef:'slot_retry_unborn',updatedAt:4})
  const activated=state.store.updateRootRecovery({projectRef,recoveryRef:'recovery_unborn',actorRef:coordinator,expectedRevision:reserved.recovery.revision,state:'activated',updatedAt:5})
  state.store.updateRootRecovery({projectRef,recoveryRef:'recovery_unborn',actorRef:coordinator,expectedRevision:activated.recovery.revision,state:'ready',updatedAt:6})
  const adopted=state.store.adoptRootSeat({projectRef,slotActorRef,slotCapability,actorRef:'actor_retry_real_child',adoptedAt:7})
  assert.equal(adopted.task.ownerActorRef,'actor_retry_real_child')
  const replay=state.store.adoptRootSeat({projectRef,slotActorRef,slotCapability,actorRef:'actor_retry_real_child',adoptedAt:8})
  assert.equal(replay.duplicate,true); assert.equal(replay.seat.actorRef,'actor_retry_real_child')
  assert.throws(()=>state.store.adoptRootSeat({projectRef,slotActorRef,slotCapability,actorRef:'actor_retry_foreign_child',adoptedAt:9}),error=>error.code==='PROJECT_COLLABORATION_CAPABILITY_INVALID')
}))

test('owner-accepted takeover authorizes only its exact migrated task recovery', async () => usingFixture(async state => {
  const lead='actor_accept_lead',failed='actor_accept_failed',requester='actor_accept_requester',blocked='task_accept_blocked',task='task_accept_target'
  state.store.createTask(createInput({commandId:'command_accept_blocked',eventRef:'event_accept_blocked',actorRef:requester,createdAt:1,task:{taskRef:blocked,status:'blocked',ownerActorRef:requester,assigneeActorRef:requester,title:'Blocked',requirements:{},fileScope:[]}}))
  state.store.createTask(createInput({commandId:'command_accept_target',eventRef:'event_accept_target',actorRef:failed,createdAt:2,task:{taskRef:task,status:'in_progress',ownerActorRef:failed,assigneeActorRef:failed,title:'Target',requirements:{},fileScope:['src/accept']}}))
  state.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_accept',task,blocked,'blocks',lead,3)
  state.store.createCollaborationBoard({projectRef,coordinatorActorRef:lead,title:'Accept board',createdAt:4})
  state.store.upsertCollaborationSeat({projectRef,actorRef:failed,changedByActorRef:lead,expectedRevision:0,kind:'root',state:'active',duty:'Owner',resourceScope:['src/accept'],phase:'working',nextStep:'Continue',updatedAt:5})
  const opened=state.store.createCollaborationRequest({projectRef,requestRef:'request_accept',requestId:'request_accept_id',kind:'takeover',taskRef:blocked,dependencyTaskRef:task,requesterActorRef:requester,reason:'Owner response',respondByAt:100,createdAt:6})
  assert.equal(state.store.respondCollaborationRequest({projectRef,requestRef:opened.request.requestRef,actorRef:failed,expectedRevision:1,action:'release',resolution:'owner explicitly releases',updatedAt:7}).request.state,'resolved')
  const recovery=state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_accept',requestId:'recovery_accept_id',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'HOST_SESSION_FAILED',failureEvidence:'Host failed',collaborationRequestRef:'request_accept',recoveryTaskRef:task,createdAt:8})
  assert.equal(recovery.recovery.replacementTaskRef,task);assert.equal(state.store.getTask({projectRef,taskRef:task}).ownerActorRef,requester)
}))

test('failed root recovery is explicit, idempotent, audited, and preserves third-party locks', async () => usingFixture(async state => {
  const lead='actor_recovery_lead', failed='actor_failed_root', requester='actor_replacement_requester', third='actor_third_party'
  const blocked='task_recovery_blocked', task='task_recovery_target'
  state.store.createTask(createInput({commandId:'command_recovery_blocked',eventRef:'event_recovery_blocked',actorRef:requester,createdAt:1,task:{taskRef:blocked,status:'blocked',ownerActorRef:requester,assigneeActorRef:requester,title:'Blocked',requirements:{},fileScope:[]}}))
  state.store.createTask(createInput({commandId:'command_recovery_target',eventRef:'event_recovery_target',actorRef:failed,createdAt:2,task:{taskRef:task,status:'in_progress',ownerActorRef:failed,assigneeActorRef:failed,title:'Recover me',requirements:{},fileScope:['src/recovery']}}))
  state.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef,'relation_recovery',task,blocked,'blocks',lead,3)
  state.store.createCollaborationBoard({projectRef,coordinatorActorRef:lead,title:'Recovery board',createdAt:4})
  state.store.upsertCollaborationSeat({projectRef,actorRef:failed,changedByActorRef:lead,expectedRevision:0,kind:'root',state:'active',duty:'Recover duty',resourceScope:['src/recovery'],phase:'implementation',nextStep:'Continue',updatedAt:5})
  state.store.acquireCollaborationLock({projectRef,resourceRef:'src/recovery/owned',ownerActorRef:failed,taskRef:task,updatedAt:6})
  state.store.acquireCollaborationLock({projectRef,resourceRef:'docs/third-party',ownerActorRef:third,taskRef:task,updatedAt:6})
  const opened=state.store.createCollaborationRequest({projectRef,requestRef:'request_recovery',requestId:'request_recovery_id',kind:'takeover',taskRef:blocked,dependencyTaskRef:task,requesterActorRef:requester,reason:'Host recorded failed root',respondByAt:10,createdAt:7})
  state.store.escalateCollaborationRequest({projectRef,requestRef:opened.request.requestRef,coordinatorActorRef:lead,expectedRevision:1,resolution:'audited deadline takeover',updatedAt:10})
  state.store.database.prepare("UPDATE project_collaboration_requests SET kind='release' WHERE project_ref=? AND request_ref=?").run(projectRef,'request_recovery')
  assert.throws(()=>state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_wrong_kind',requestId:'recovery_wrong_kind_request',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host failure',collaborationRequestRef:'request_recovery',recoveryTaskRef:task,createdAt:11}),error=>error.code==='PROJECT_ROOT_RECOVERY_TAKEOVER_REQUIRED')
  state.store.database.prepare("UPDATE project_collaboration_requests SET kind='takeover' WHERE project_ref=? AND request_ref=?").run(projectRef,'request_recovery')
  assert.throws(()=>state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_wrong_task',requestId:'recovery_wrong_task_request',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host failure',collaborationRequestRef:'request_recovery',recoveryTaskRef:blocked,createdAt:11}),error=>error.code==='PROJECT_ROOT_RECOVERY_TAKEOVER_REQUIRED')
  state.store.database.prepare("UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?").run(third,projectRef,task)
  assert.throws(()=>state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_owner_drift',requestId:'recovery_owner_drift_request',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host failure',collaborationRequestRef:'request_recovery',recoveryTaskRef:task,createdAt:11}),error=>error.code==='PROJECT_ROOT_RECOVERY_TAKEOVER_REQUIRED')
  state.store.database.prepare("UPDATE project_tasks SET owner_actor_ref=? WHERE project_ref=? AND task_ref=?").run(requester,projectRef,task)
  const prepared=state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_one',requestId:'recovery_request_one',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host operation op-1 definitively failed',collaborationRequestRef:'request_recovery',recoveryTaskRef:task,createdAt:11})
  assert.equal(prepared.recovery.state,'prepared'); assert.equal(prepared.recovery.initiatorActorRef,lead); assert.equal(prepared.recovery.beneficiaryActorRef,requester)
  assert.equal(state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_one',requestId:'recovery_request_one',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'HOST_SESSION_CREATE_FAILED',failureEvidence:'Host operation op-1 definitively failed',collaborationRequestRef:'request_recovery',recoveryTaskRef:task,createdAt:99}).duplicate,true)
  assert.throws(()=>state.store.prepareRootRecovery({projectRef,recoveryRef:'recovery_drift',requestId:'recovery_request_one',mode:'takeover',failedActorRef:failed,requesterActorRef:lead,failureCode:'OTHER',failureEvidence:'drift',collaborationRequestRef:'request_recovery',recoveryTaskRef:task,createdAt:12}),error=>error.code==='PROJECT_TASK_IDEMPOTENCY_CONFLICT')
  const reserved=state.store.reserveRootRecovery({projectRef,recoveryRef:'recovery_one',requesterActorRef:lead,replacementSlotActorRef:'actor_replacement_slot',slotCapability:'capability_replacement_one',launchRef:'launch_replacement_one',updatedAt:12})
  assert.equal(reserved.recovery.state,'reserved'); assert.equal(reserved.recovery.replacementTaskRef,task)
  assert.equal(state.store.reserveRootRecovery({projectRef,recoveryRef:'recovery_one',requesterActorRef:lead,replacementSlotActorRef:'actor_replacement_slot',slotCapability:'capability_replacement_one',launchRef:'launch_replacement_one',updatedAt:99}).duplicate,true)
  assert.equal(state.store.getTask({projectRef,taskRef:task}).assigneeActorRef,'actor_replacement_slot')
  const locks=Object.fromEntries(state.store.readCollaborationSnapshot({projectRef}).locks.filter(row=>row.taskRef===task).map(row=>[row.resourceRef,row.ownerActorRef]))
  assert.deepEqual(locks,{'docs/third-party':third,'src/recovery/owned':'actor_replacement_slot'})
  const activated=state.store.updateRootRecovery({projectRef,recoveryRef:'recovery_one',actorRef:lead,expectedRevision:2,state:'activated',updatedAt:13})
  assert.equal(activated.recovery.state,'activated')
  assert.throws(()=>state.store.updateRootRecovery({projectRef,recoveryRef:'recovery_one',actorRef:lead,expectedRevision:2,state:'ready',updatedAt:14}),error=>error.code==='PROJECT_ROOT_RECOVERY_CONFLICT')
  assert.equal(state.store.updateRootRecovery({projectRef,recoveryRef:'recovery_one',actorRef:lead,expectedRevision:3,state:'ready',updatedAt:14}).recovery.state,'ready')
  const adopted=state.store.adoptRootSeat({projectRef,slotActorRef:'actor_replacement_slot',slotCapability:'capability_replacement_one',actorRef:'actor_replacement_real_root',adoptedAt:15});assert.equal(adopted.task.assigneeActorRef,'actor_replacement_real_root')
  const raw=state.store.database.prepare('SELECT failure_evidence_cipher FROM project_collaboration_root_recoveries WHERE project_ref=?').get(projectRef)
  assert.equal(JSON.stringify(raw).includes('Host operation op-1 definitively failed'),false)
  assert.ok(state.store.readCollaborationSnapshot({projectRef}).history.some(row=>row.kind==='root-recovery.ready'))
}))

test('claim_next distributes ten tasks one-at-a-time across three roots with durable replay and exact terminal summary', async () => usingFixture(async state => {
  const actors = ['actor_root_A', 'actor_root_B', 'actor_root_C']
  for (let index = 0; index < 10; index += 1) state.store.createTask(createInput({
    commandId: `command_claim_next_create_${index}`, eventRef: `event_claim_next_create_${index}`,
    actorRef: 'actor_coordinator', createdAt: 1_700_100_000_000 + index,
    task: { taskRef: `task_claim_next_${String(index).padStart(2, '0')}`, status: index % 2 === 0 ? 'todo' : 'backlog', ownerActorRef: 'actor_coordinator', title: `Task ${index}`, requirements: {}, fileScope: [`src/${index}.js`] },
  }))
  const claimed = []
  let clock = 1_700_200_000_000
  for (let round = 0; round < 10; round += 1) {
    const actorRef = actors[round % actors.length], requestId = `claim-next-${round}`
    const result = state.store.claimNextTask({ projectRef, requestId, actorRef, updatedAt: ++clock })
    assert.equal(result.status, 'claimed')
    assert.equal(result.task.assigneeActorRef, actorRef)
    assert.equal(result.task.status, 'in_progress')
    assert.equal(claimed.includes(result.task.taskRef), false)
    claimed.push(result.task.taskRef)
    const replay = state.store.claimNextTask({ projectRef, requestId, actorRef, updatedAt: ++clock })
    assert.equal(replay.duplicate, true)
    assert.equal(replay.task.taskRef, result.task.taskRef)
    const cannotHoard = state.store.claimNextTask({ projectRef, requestId: `claim-next-hoard-${round}`, actorRef, updatedAt: ++clock })
    assert.equal(cannotHoard.status, 'temporarily_empty')
    assert.deepEqual(cannotHoard.blockers, [result.task.taskRef])
    state.store.mutateTask({ projectRef, taskRef: result.task.taskRef, commandId: `command_done_${round}`, eventRef: `event_done_${round}`, expectedRevision: result.task.revision, actorRef, type: 'task.done', patch: { status: 'done' }, eventPayload: {}, createdAt: ++clock })
  }
  assert.equal(new Set(claimed).size, 10)
  for (const actorRef of actors) {
    const terminal = state.store.claimNextTask({ projectRef, requestId: `claim-next-terminal-${actorRef}`, actorRef, updatedAt: ++clock })
    assert.equal(terminal.status, 'all_terminal')
    assert.deepEqual(terminal.blockers, [])
  }
  assert.throws(() => state.store.claimNextTask({ projectRef, requestId: 'claim-next-0', actorRef: actors[1], updatedAt: ++clock }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
}))

test('three independent store connections race ten tasks without duplicate claims', async () => usingFixture(async state => {
  for (let index = 0; index < 10; index += 1) state.store.createTask(createInput({ commandId: `command_race_create_${index}`, eventRef: `event_race_create_${index}`, createdAt: 1_701_000_000_000 + index, task: { taskRef: `task_race_${index}`, status: 'todo', ownerActorRef: 'actor_owner', title: `Race ${index}`, requirements: {}, fileScope: [] } }))
  const peers = [state.store, ...Array.from({ length: 2 }, () => { const peer = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider }); peer.initialize(); return peer })]
  const actors = ['actor_race_A', 'actor_race_B', 'actor_race_C'], claimed = []
  let clock = 1_702_000_000_000, request = 0
  try {
    while (claimed.length < 10) {
      const wave = await Promise.all(peers.map((store, index) => Promise.resolve().then(() => store.claimNextTask({ projectRef, requestId: `race-request-${request++}`, actorRef: actors[index], updatedAt: ++clock }))))
      for (let index = 0; index < wave.length; index += 1) if (wave[index].status === 'claimed') {
        const item = wave[index]
        assert.equal(claimed.includes(item.task.taskRef), false)
        claimed.push(item.task.taskRef)
        peers[index].mutateTask({ projectRef, taskRef: item.task.taskRef, commandId: `command_race_done_${claimed.length}`, eventRef: `event_race_done_${claimed.length}`, expectedRevision: item.task.revision, actorRef: actors[index], type: 'task.done', patch: { status: 'done' }, eventPayload: {}, createdAt: ++clock })
      }
    }
    assert.equal(new Set(claimed).size, 10)
    const terminal = await Promise.all(peers.map((store, index) => Promise.resolve().then(() => store.claimNextTask({ projectRef, requestId: `race-terminal-${index}`, actorRef: actors[index], updatedAt: ++clock }))))
    assert.deepEqual(terminal.map(item => item.status), ['all_terminal', 'all_terminal', 'all_terminal'])
  } finally { peers.slice(1).forEach(peer => peer.close()) }
}))

test('claim_next reports dependency and lock blockers and never crosses project partitions', async () => usingFixture(async state => {
  const owner = 'actor_owner', other = 'actor_other', claimant = 'actor_claimant'
  state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: owner, title: 'Blocked queue', createdAt: 1 })
  state.store.createTask(createInput({ commandId: 'command_blocker', eventRef: 'event_blocker', createdAt: 2, task: { taskRef: 'task_blocker', status: 'in_progress', ownerActorRef: other, assigneeActorRef: other, title: 'Blocker', requirements: {}, fileScope: [] } }))
  state.store.createTask(createInput({ commandId: 'command_dependent', eventRef: 'event_dependent', createdAt: 3, task: { taskRef: 'task_dependent', status: 'todo', ownerActorRef: owner, title: 'Dependent', requirements: {}, fileScope: [] } }))
  state.store.database.prepare("INSERT INTO project_task_relations(project_ref,relation_ref,source_task_ref,target_task_ref,type,created_by_actor_ref,created_at) VALUES(?,?,?,?,?,?,?)").run(projectRef, 'relation_blocked', 'task_blocker', 'task_dependent', 'blocks', owner, 4)
  state.store.createTask(createInput({ commandId: 'command_locked', eventRef: 'event_locked', createdAt: 5, task: { taskRef: 'task_locked', status: 'todo', ownerActorRef: owner, title: 'Locked', requirements: {}, fileScope: [] } }))
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/locked', ownerActorRef: other, taskRef: 'task_locked', updatedAt: 6 })
  state.store.createTask(createInput({ projectRef: secondProjectRef, commandId: 'command_other_project', eventRef: 'event_other_project', createdAt: 7, task: { taskRef: 'task_other_project', status: 'todo', ownerActorRef: owner, title: 'Other project', requirements: {}, fileScope: [] } }))
  const result = state.store.claimNextTask({ projectRef, requestId: 'blocked-claim-next', actorRef: claimant, updatedAt: 8 })
  assert.equal(result.status, 'blocked')
  assert.deepEqual(result.blockers, ['task_blocker', 'task_locked'])
  assert.equal(state.store.getTask({ projectRef: secondProjectRef, taskRef: 'task_other_project' }).assigneeActorRef, undefined)
}))

test('claim_next skips hierarchical resource conflicts held for another task', async () => usingFixture(async state => {
  const owner = 'actor_hierarchy_owner', claimant = 'actor_hierarchy_claimant', locker = 'actor_hierarchy_locker'
  state.store.createCollaborationBoard({ projectRef, coordinatorActorRef: owner, title: 'Hierarchy queue', createdAt: 1 })
  state.store.createTask(createInput({ commandId: 'command_hierarchy_locked', eventRef: 'event_hierarchy_locked', createdAt: 2, task: { taskRef: 'task_hierarchy_locked', status: 'todo', ownerActorRef: owner, title: 'Nested conflict', requirements: {}, fileScope: ['src/shared/components'] } }))
  state.store.createTask(createInput({ commandId: 'command_hierarchy_free', eventRef: 'event_hierarchy_free', createdAt: 3, task: { taskRef: 'task_hierarchy_free', status: 'todo', ownerActorRef: owner, title: 'Free candidate', requirements: {}, fileScope: ['src/independent'] } }))
  state.store.acquireCollaborationLock({ projectRef, resourceRef: 'src/shared', ownerActorRef: locker, taskRef: 'task_unrelated_lock_owner', updatedAt: 4 })
  const first = state.store.claimNextTask({ projectRef, requestId: 'hierarchy-first', actorRef: claimant, updatedAt: 5 })
  assert.equal(first.status, 'claimed')
  assert.equal(first.task.taskRef, 'task_hierarchy_free')
  assert.equal(state.store.claimNextTask({ projectRef, requestId: 'hierarchy-first', actorRef: claimant, updatedAt: 6 }).task.taskRef, 'task_hierarchy_free')
  state.store.mutateTask({ projectRef, taskRef: first.task.taskRef, commandId: 'command_hierarchy_done', eventRef: 'event_hierarchy_done', expectedRevision: first.task.revision, actorRef: claimant, type: 'task.done', patch: { status: 'done' }, eventPayload: {}, createdAt: 7 })
  const blocked = state.store.claimNextTask({ projectRef, requestId: 'hierarchy-blocked', actorRef: claimant, updatedAt: 8 })
  assert.equal(blocked.status, 'blocked')
  assert.deepEqual(blocked.blockers, ['task_hierarchy_locked'])
  assert.equal(state.store.getTask({ projectRef, taskRef: 'task_hierarchy_locked' }).assigneeActorRef, undefined)
}))

test('manual claims and every mutation entering in_progress enforce one active task per root transactionally', async () => usingFixture(async state => {
  const actorRef = 'actor_single_active_root'
  for (const [index, taskRef] of ['task_manual_race_a', 'task_manual_race_b'].entries()) state.store.createTask(createInput({
    commandId: `command_manual_race_create_${index}`, eventRef: `event_manual_race_create_${index}`, createdAt: 100 + index,
    task: { taskRef, status: 'todo', ownerActorRef: actorRef, assigneeActorRef: actorRef, title: taskRef, requirements: {}, fileScope: [] },
  }))
  const peer = new state.storeMod.ProjectTaskStore({ filePath: state.filePath, keyProvider: state.keyProvider })
  peer.initialize()
  try {
    const stores = [state.store, peer]
    const raced = await Promise.allSettled(stores.map((store, index) => Promise.resolve().then(() => store.mutateTask({
      projectRef, taskRef: `task_manual_race_${index === 0 ? 'a' : 'b'}`, commandId: `command_manual_race_claim_${index}`, eventRef: `event_manual_race_claim_${index}`,
      expectedRevision: 1, actorRef, type: 'task.claimed', patch: { status: 'in_progress', assigneeActorRef: actorRef }, eventPayload: {}, createdAt: 200 + index,
    }))))
    assert.equal(raced.filter(result => result.status === 'fulfilled').length, 1)
    const rejected = raced.find(result => result.status === 'rejected')
    assert.equal(rejected.reason.code, 'PROJECT_TASK_ACTIVE_LIMIT')
    const active = state.store.readTaskWindow({ projectRef, limit: 10 }).tasks.filter(task => task.assigneeActorRef === actorRef && task.status === 'in_progress')
    assert.equal(active.length, 1)

    state.store.createTask(createInput({ commandId: 'command_transition_guard_create', eventRef: 'event_transition_guard_create', createdAt: 300, task: { taskRef: 'task_transition_guard', status: 'blocked', ownerActorRef: actorRef, assigneeActorRef: actorRef, title: 'guard transition', requirements: {}, fileScope: [] } }))
    assert.throws(() => state.store.mutateTask({ projectRef, taskRef: 'task_transition_guard', commandId: 'command_transition_guard', eventRef: 'event_transition_guard', expectedRevision: 1, actorRef, type: 'task.transitioned', patch: { status: 'in_progress' }, eventPayload: {}, createdAt: 301 }), error => error.code === 'PROJECT_TASK_ACTIVE_LIMIT')
    assert.equal(state.store.getTask({ projectRef, taskRef: 'task_transition_guard' }).status, 'blocked')
    const indexes = state.store.database.prepare("PRAGMA index_list('project_tasks')").all()
    assert.equal(indexes.some(index => index.unique === 1 && index.origin === 'c'), false, 'enforcement does not add an unsafe legacy-data unique index')
  } finally { peer.close() }
}))
