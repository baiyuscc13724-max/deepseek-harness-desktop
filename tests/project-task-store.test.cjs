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
    assert.equal(database.prepare('PRAGMA user_version').get().user_version, 3)
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

test('schema v1 migrates additively to v3 without losing encrypted task data', async () => {
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
    assert.equal(store.initialize().version, 3)
    assert.equal(store.getTask({ projectRef, taskRef }).title, 'legacy secret')
    assert.throws(() => store.getCommandReceipt({ projectRef, commandId: 'command_legacy' }), error => error.code === 'PROJECT_TASK_IDEMPOTENCY_CONFLICT')
    const migrated = new DatabaseSync(filePath, { readOnly: true })
    try {
      assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 3)
      for (const table of ['project_task_actors', 'project_task_comments', 'project_task_relations', 'project_task_attempts', 'project_task_reviews', 'project_task_command_receipts']) {
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
