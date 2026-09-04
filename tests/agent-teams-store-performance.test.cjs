const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { performance } = require('node:perf_hooks')
const { link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } = require('node:fs/promises')
const { existsSync } = require('node:fs')
const { pathToFileURL } = require('node:url')

const pluginFile = path.join(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'index.js')

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function expectedLedgerProjectionHashes(header, entries) {
  const roots = [...new Set(entries.map(entry => entry.rootLeadSessionId))].sort()
  return roots.map(rootSessionId => {
    const directlyRelated = entries.filter(entry => entry.rootLeadSessionId === rootSessionId || entry.index.members.some(member => member.sessionId === rootSessionId))
    const projects = new Set(directlyRelated.map(entry => entry.projectKey).filter(value => value !== undefined))
    const relatedRoots = new Set(directlyRelated.map(entry => entry.rootLeadSessionId))
    const projectedEntries = entries.filter(entry => relatedRoots.has(entry.rootLeadSessionId) || entry.projectKey !== undefined && projects.has(entry.projectKey))
    return {
      rootSessionId,
      hash: hash(Buffer.from(JSON.stringify(['agent-teams-root-ledger-projection-v1', header.settings, projectedEntries])))
    }
  })
}

function canonicalBuffer(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`)
}

function legacyExpansionIdentity(teamId, workerSessionId, request) {
  const canonicalText = value => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  const workstreams = request.workstreams.map(workstream => ({
    title: canonicalText(workstream.title).toLocaleLowerCase('en-US'),
    deliverable: canonicalText(workstream.deliverable),
    acceptanceCriteria: canonicalText(workstream.acceptanceCriteria),
    files: [...workstream.files].sort(),
    resources: [...workstream.resources].sort()
  })).sort((left, right) => {
    const leftKey = JSON.stringify(left), rightKey = JSON.stringify(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  return hash(Buffer.from(JSON.stringify([
    'agent-teams-expansion-request-v1', teamId, workerSessionId, request.sourceTaskId,
    canonicalText(request.parallelBenefit), workstreams
  ])))
}

function artifactPath(root, reference) {
  return path.join(root, ...reference.split('/'))
}

async function directorySnapshot(root, current = root, snapshot = {}) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name)
    const relative = path.relative(root, absolute).replaceAll('\\', '/')
    if (entry.isDirectory()) await directorySnapshot(root, absolute, snapshot)
    else snapshot[relative] = hash(await readFile(absolute))
  }
  return snapshot
}

async function directoryUsage(root, current = root, usage = { files: 0, bytes: 0 }) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) await directoryUsage(root, absolute, usage)
    else {
      usage.files += 1
      usage.bytes += (await stat(absolute)).size
    }
  }
  return usage
}

async function waitForRetentionMaintenance(store) {
  await store._settleRetentionMaintenance()
  const maintenance = store.storageDiagnostics().retention.maintenance
  assert.deepEqual(
    [maintenance.requested, maintenance.scheduled, maintenance.running],
    [false, false, false],
    'retention maintenance settles without an unobserved background branch'
  )
}

function deferred() {
  let resolve, reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function plugin(label) {
  return import(`${pathToFileURL(pluginFile).href}?${label}=${Date.now()}-${Math.random()}`)
}

async function createBulkV8Fixture(mod, root, count = 146, { distinctProjects = false } = {}) {
  const seedFile = path.join(root, 'seed.json')
  const seedStore = new mod.AgentTeamsStore(seedFile, { enabled: true, hotColdStore: false })
  await seedStore.init()
  await mod.createTeam(seedStore, { id: 'root-seed', options: { provider: 'test', model: 'test' } }, { objective: 'bulk fixture', leadName: 'Lead' })
  const base = seedStore.snapshot()
  seedStore.close()
  const template = base.teams[0]
  const teams = Array.from({ length: count }, (_, index) => {
    const team = structuredClone(template)
    const rootSessionId = distinctProjects ? `root-${index}` : `root-${Math.floor(index / 8)}`
    team.id = `team-${index}`
    team.rootLeadSessionId = rootSessionId
    team.projectKey = distinctProjects ? hash(Buffer.from(`project-${index}`)) : 'a'.repeat(64)
    team.name = `Team ${index}`
    team.members[0].id = `lead:${rootSessionId}`
    team.members[0].sessionId = rootSessionId
    if (index < count - 1) {
      const at = team.updatedAt
      team.state = 'closed'
      team.closure = { outcome: 'forced', attemptedAt: at, closedAt: at, reason: 'bulk fixture', forced: true, cancelledTaskIds: [], failures: [] }
    } else {
      team.members[0].state = 'ready'
    }
    return team
  })
  const file = path.join(root, 'storages', 'agent_teams.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ ...base, teams })}\n`)
  return { file, document: { ...base, teams }, bytes: (await stat(file)).size }
}

function forceClose(team) {
  const at = new Date().toISOString()
  team.state = 'closed'
  team.updatedAt = at
  team.closure = { outcome: 'forced', attemptedAt: at, closedAt: at, reason: 'fault-boundary fixture', forced: true, cancelledTaskIds: [], failures: [] }
}

async function currentLedgerState(file) {
  const root = `${file}.ledger`
  const pointerBytes = await readFile(path.join(root, 'current.json'))
  const pointer = JSON.parse(pointerBytes)
  const manifestBytes = await readFile(artifactPath(root, pointer.manifest.path))
  const manifest = JSON.parse(manifestBytes)
  return { root, pointer, pointerBytes, manifest, manifestBytes }
}

async function mutateActiveName(store, index) {
  await store.mutate(document => {
    const team = document.teams.find(candidate => candidate.state !== 'closed')
    team.name = `Generation ${index}`
    team.updatedAt = new Date(Date.parse(team.updatedAt) + 1).toISOString()
  })
}

test('closed AgentTeamsStore instances stop receiving shared document publications', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-closed-store-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin('closed-store')
  const closed = new mod.AgentTeamsStore(file)
  const active = new mod.AgentTeamsStore(file)
  try {
    await closed.init()
    await active.init()
    let closedListenerCalls = 0
    closed.subscribe(() => { closedListenerCalls += 1 })
    closed.close()

    await active.mutate(document => { document.settings.enabled = true })

    assert.equal(active.snapshot().settings.enabled, true)
    assert.equal(closed.snapshot().settings.enabled, false)
    assert.equal(closedListenerCalls, 0)
  } finally {
    active.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('startup reconciliation advances each changed team revision once and repeated init is read-only', async t => {
  const mod = await plugin('startup-revision')
  for (const [label, hotColdStore] of [['legacy', false], ['hot-cold', true]]) await t.test(label, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-startup-revision-${label}-`))
    const file = path.join(root, 'storages', 'agent_teams.json')
    const options = { hotColdStore }
    const initial = new mod.AgentTeamsStore(file, options)
    let restored
    try {
      await initial.init()
      await initial.mutate(document => { document.settings.enabled = true })
      const changedTeam = await mod.createTeam(initial, { id: 'restart-lead' }, { objective: `${label} interrupted team` })
      const stableTeam = await mod.createTeam(initial, { id: 'restart-lead' }, { objective: `${label} stable control` })
      await initial.init() // Settle the one-time safe plan-authorization reconciliation.
      const timestamp = new Date().toISOString()
      await initial.mutate(document => {
        const team = document.teams.find(candidate => candidate.id === changedTeam.id)
        team.members.push({ id: 'restart-worker', sessionId: 'restart-worker', name: 'Worker', role: 'work', kind: 'worker', state: 'running', runId: 'run-before-restart', createdAt: timestamp, updatedAt: timestamp })
        team.tasks.push({ id: 'restart-task', title: 'Interrupted work', state: 'in_progress', revision: 1, dependsOn: [], files: [], assigneeSessionId: 'restart-worker', claimedAt: timestamp, attempt: 1, claimId: 'restart-claim', leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], lifecycleLedger: [], capabilities: [], externalEffects: [], createdAt: timestamp, updatedAt: timestamp })
        team.messages.push({ id: 'restart-message', fromSessionId: 'restart-lead', toSessionId: 'restart-worker', body: 'sent-time body', status: 'pending', createdAt: timestamp })
      })
      const before = initial.snapshot()
      const changedBefore = before.teams.find(team => team.id === changedTeam.id)
      const stableBefore = before.teams.find(team => team.id === stableTeam.id)
      const generationBefore = initial.storageDiagnostics().generation
      initial.close()

      restored = new mod.AgentTeamsStore(file, options)
      let reconciliationPublications = 0
      const unsubscribe = restored.subscribe(() => { reconciliationPublications += 1 })
      await restored.init()
      unsubscribe()
      const reconciled = restored.snapshot().teams.find(team => team.id === changedTeam.id)
      assert.equal(reconciled.revision, changedBefore.revision + 1)
      assert.equal(reconciled.tasks.find(task => task.id === 'restart-task').revision, 2)
      assert.equal(reconciled.tasks.find(task => task.id === 'restart-task').interruptionHistory.at(-1).kind, 'host_restart_during_active_task')
      assert.equal(reconciled.members.find(member => member.id === 'restart-worker').state, 'failed')
      assert.equal(reconciled.messages.find(message => message.id === 'restart-message').status, 'failed')
      assert.equal(restored.snapshot().teams.find(team => team.id === stableTeam.id).revision, stableBefore.revision)
      assert.equal(reconciliationPublications, 1)
      if (hotColdStore) assert.equal(restored.storageDiagnostics().generation, generationBefore + 1)

      const authorityPath = hotColdStore ? `${file}.ledger/current.json` : file
      const durableBeforeRepeat = await readFile(authorityPath)
      const infoBeforeRepeat = await stat(authorityPath, { bigint: true })
      const generationAfterReconcile = restored.storageDiagnostics().generation
      let repeatedPublications = 0
      const unsubscribeRepeated = restored.subscribe(() => { repeatedPublications += 1 })
      await restored.init()
      unsubscribeRepeated()
      const afterRepeat = restored.snapshot().teams.find(team => team.id === changedTeam.id)
      const infoAfterRepeat = await stat(authorityPath, { bigint: true })
      assert.equal(afterRepeat.revision, reconciled.revision)
      assert.equal(afterRepeat.tasks.find(task => task.id === 'restart-task').revision, 2)
      assert.equal(restored.storageDiagnostics().generation, generationAfterReconcile)
      assert.deepEqual(await readFile(authorityPath), durableBeforeRepeat)
      assert.deepEqual(
        [infoAfterRepeat.dev, infoAfterRepeat.ino, infoAfterRepeat.size, infoAfterRepeat.mtimeNs, infoAfterRepeat.ctimeNs],
        [infoBeforeRepeat.dev, infoBeforeRepeat.ino, infoBeforeRepeat.size, infoBeforeRepeat.mtimeNs, infoBeforeRepeat.ctimeNs],
        'a no-op init never replaces or rewrites the authoritative file'
      )
      assert.equal(repeatedPublications, 0)
    } finally {
      initial.close()
      restored?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('startup repair rewrites only the changed closed shard and remains idempotent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-closed-startup-cow-'))
  const mod = await plugin('closed-startup-cow')
  const fixture = await createBulkV8Fixture(mod, root, 3)
  const source = JSON.parse(await readFile(fixture.file, 'utf8'))
  const changed = source.teams[0]
  const stable = source.teams[1]
  const timestamp = changed.updatedAt
  changed.tasks.push({
    id: 'unfinished-closed-task', title: 'Unfinished closed task', state: 'pending', revision: 1,
    dependsOn: [], files: [], attempt: 0, attemptHistory: [], interruptionHistory: [], lifecycleLedger: [],
    capabilities: [], externalEffects: [], createdAt: timestamp, updatedAt: timestamp
  })
  await writeFile(fixture.file, `${JSON.stringify(source)}\n`)
  const sourceBytes = await readFile(fixture.file)
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    const initialized = await store.init()
    const current = await currentLedgerState(fixture.file)
    assert.equal(current.pointer.generation, 2)
    const previousManifest = JSON.parse(await readFile(artifactPath(current.root, current.manifest.previous.path), 'utf8'))
    const currentCatalog = JSON.parse(await readFile(artifactPath(current.root, current.manifest.closedCatalog.path), 'utf8'))
    const previousCatalog = JSON.parse(await readFile(artifactPath(current.root, previousManifest.closedCatalog.path), 'utf8'))
    const byId = entries => new Map(entries.map(entry => [entry.id, entry]))
    const currentById = byId(currentCatalog.entries)
    const previousById = byId(previousCatalog.entries)
    assert.notEqual(currentById.get(changed.id).shard.path, previousById.get(changed.id).shard.path)
    assert.equal(currentById.get(stable.id).shard.path, previousById.get(stable.id).shard.path)
    assert.equal(initialized.teams.find(team => team.id === changed.id).revision, changed.revision + 1)
    assert.equal(initialized.teams.find(team => team.id === changed.id).tasks[0].state, 'cancelled')
    assert.equal(initialized.teams.find(team => team.id === stable.id).revision, stable.revision)
    assert.deepEqual(await readFile(fixture.file), sourceBytes)

    const generation = store.storageDiagnostics().generation
    const pointerBytes = await readFile(path.join(current.root, 'current.json'))
    await store.init()
    assert.equal(store.storageDiagnostics().generation, generation)
    assert.deepEqual(await readFile(path.join(current.root, 'current.json')), pointerBytes)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('fresh startup repairs indexed unfinished closed shards after a gen1 switch crash or buggy gen2', async t => {
  for (const mode of ['after-gen1-switch', 'existing-buggy-gen2']) await t.test(mode, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-closed-indexed-repair-${mode}-`))
    const mod = await plugin(`closed-indexed-repair-${mode}`)
    const fixture = await createBulkV8Fixture(mod, root, 3)
    const source = JSON.parse(await readFile(fixture.file, 'utf8'))
    const changed = source.teams[0]
    const stable = source.teams[1]
    changed.tasks.push({
      id: `unfinished-${mode}`, title: 'Indexed unfinished closed task', state: 'pending', revision: 1,
      dependsOn: [], files: [], attempt: 0, attemptHistory: [], interruptionHistory: [], lifecycleLedger: [],
      capabilities: [], externalEffects: [], createdAt: changed.updatedAt, updatedAt: changed.updatedAt
    })
    await writeFile(fixture.file, `${JSON.stringify(source)}\n`)
    const sourceBytes = await readFile(fixture.file)
    let inject = true
    const crashed = new mod.AgentTeamsStore(fixture.file, {
      hotColdStore: true,
      hotColdFaultInjector(stage) {
        if (inject && stage === 'after-manifest-switch') {
          inject = false
          throw new Error('injected after gen1 switch')
        }
      }
    })
    let restarted
    try {
      await assert.rejects(crashed.init(), /injected after gen1 switch/u)
      crashed.close()
      let buggy = await currentLedgerState(fixture.file)
      assert.equal(buggy.pointer.generation, 1)
      if (mode === 'existing-buggy-gen2') {
        const hot = JSON.parse(await readFile(artifactPath(buggy.root, buggy.manifest.hot.path), 'utf8'))
        hot.generation = 2
        const hotBytes = canonicalBuffer(hot)
        const hotHash = hash(hotBytes)
        const hotReference = `hot/hot-2-${hotHash}.json`
        await writeFile(artifactPath(buggy.root, hotReference), hotBytes)
        const manifest = {
          ...buggy.manifest,
          generation: 2,
          hot: { path: hotReference, hash: hotHash, bytes: hotBytes.byteLength },
          previous: { ...buggy.pointer.manifest }
        }
        const manifestBytes = canonicalBuffer(manifest)
        const manifestHash = hash(manifestBytes)
        const manifestReference = `manifests/manifest-2-${manifestHash}.json`
        await writeFile(artifactPath(buggy.root, manifestReference), manifestBytes)
        const descriptor = { generation: 2, path: manifestReference, hash: manifestHash, bytes: manifestBytes.byteLength }
        await writeFile(path.join(buggy.root, 'current.json'), canonicalBuffer({ version: 1, generation: 2, manifest: descriptor }))
        const sentinelPath = `${fixture.file}.promoted.json`
        const sentinel = JSON.parse(await readFile(sentinelPath, 'utf8'))
        sentinel.phase = 'committed'
        await writeFile(sentinelPath, canonicalBuffer(sentinel))
        buggy = await currentLedgerState(fixture.file)
        assert.equal(buggy.pointer.generation, 2)
      }

      const buggyCatalog = JSON.parse(await readFile(artifactPath(buggy.root, buggy.manifest.closedCatalog.path), 'utf8'))
      restarted = new mod.AgentTeamsStore(fixture.file, { hotColdStore: false })
      const initialized = await restarted.init()
      assert.equal(restarted.storageDiagnostics().generation, buggy.pointer.generation + 1)
      assert.equal(restarted.storageDiagnostics().closedShardReadCount, 2,
        'only the affected old shard is hydrated, followed by physical validation of its new COW shard')
      const repaired = await currentLedgerState(fixture.file)
      const repairedCatalog = JSON.parse(await readFile(artifactPath(repaired.root, repaired.manifest.closedCatalog.path), 'utf8'))
      const byId = entries => new Map(entries.map(entry => [entry.id, entry]))
      const buggyById = byId(buggyCatalog.entries)
      const repairedById = byId(repairedCatalog.entries)
      assert.notEqual(repairedById.get(changed.id).shard.path, buggyById.get(changed.id).shard.path)
      assert.equal(repairedById.get(stable.id).shard.path, buggyById.get(stable.id).shard.path)
      assert.equal(initialized.teams.find(team => team.id === changed.id).revision, changed.revision + 1)
      assert.equal(initialized.teams.find(team => team.id === changed.id).tasks[0].state, 'cancelled')
      assert.equal(initialized.teams.find(team => team.id === stable.id).revision, stable.revision)
      assert.deepEqual(await readFile(fixture.file), sourceBytes)

      const pointerPath = path.join(repaired.root, 'current.json')
      const pointerBytes = await readFile(pointerPath)
      const pointerInfo = await stat(pointerPath, { bigint: true })
      const ledgerBytes = await directorySnapshot(repaired.root)
      let repeatedPublications = 0
      const unsubscribe = restarted.subscribe(() => { repeatedPublications += 1 })
      await restarted.init()
      unsubscribe()
      const repeatedInfo = await stat(pointerPath, { bigint: true })
      assert.equal(restarted.storageDiagnostics().generation, repaired.pointer.generation)
      assert.deepEqual(await readFile(pointerPath), pointerBytes)
      assert.deepEqual(await directorySnapshot(repaired.root), ledgerBytes)
      assert.deepEqual(
        [repeatedInfo.dev, repeatedInfo.ino, repeatedInfo.size, repeatedInfo.mtimeNs, repeatedInfo.ctimeNs],
        [pointerInfo.dev, pointerInfo.ino, pointerInfo.size, pointerInfo.mtimeNs, pointerInfo.ctimeNs]
      )
      assert.equal(repeatedPublications, 0)
    } finally {
      crashed.close()
      restarted?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('hot-cold semantic no-op performs zero writes, generations, and publications', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-noop-'))
  const mod = await plugin('hot-cold-noop')
  const fixture = await createBulkV8Fixture(mod, root, 18)
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    await store.init()
    const pointerPath = path.join(`${fixture.file}.ledger`, 'current.json')
    const beforeBytes = await readFile(pointerPath)
    const beforeInfo = await stat(pointerPath, { bigint: true })
    const beforeLedger = await directorySnapshot(`${fixture.file}.ledger`)
    const generation = store.storageDiagnostics().generation
    let publications = 0
    const unsubscribe = store.subscribe(() => { publications += 1 })
    await store.mutate(() => undefined)
    unsubscribe()
    const afterInfo = await stat(pointerPath, { bigint: true })
    assert.equal(store.storageDiagnostics().generation, generation)
    assert.deepEqual(await readFile(pointerPath), beforeBytes)
    assert.deepEqual(await directorySnapshot(`${fixture.file}.ledger`), beforeLedger)
    assert.deepEqual(
      [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
      [beforeInfo.dev, beforeInfo.ino, beforeInfo.size, beforeInfo.mtimeNs, beforeInfo.ctimeNs]
    )
    assert.equal(publications, 0)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('automatic promotion starts at sixteen closed teams and stays legacy below it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-threshold-'))
  const mod = await plugin('hot-cold-threshold')
  const below = await createBulkV8Fixture(mod, path.join(root, 'below'), 16)
  const threshold = await createBulkV8Fixture(mod, path.join(root, 'threshold'), 17)
  const dynamic = await createBulkV8Fixture(mod, path.join(root, 'dynamic'), 16)
  const hadPreference = Object.hasOwn(process.env, 'DSH_AGENT_TEAMS_HOT_COLD_STORE')
  const previousPreference = process.env.DSH_AGENT_TEAMS_HOT_COLD_STORE
  delete process.env.DSH_AGENT_TEAMS_HOT_COLD_STORE
  const legacy = new mod.AgentTeamsStore(below.file)
  const promoted = new mod.AgentTeamsStore(threshold.file)
  const liveLegacy = new mod.AgentTeamsStore(dynamic.file)
  let restarted
  try {
    await legacy.init()
    await promoted.init()
    await liveLegacy.init()
    assert.equal(legacy.storageDiagnostics().mode, 'legacy')
    assert.equal(promoted.storageDiagnostics().mode, 'hot-cold')

    await liveLegacy.mutate(document => { document.teams = structuredClone(threshold.document.teams) })
    const liveBytes = await readFile(dynamic.file)
    assert.equal(liveLegacy.storageDiagnostics().mode, 'legacy', 'automatic authority changes wait for a fresh startup boundary')
    assert.equal(existsSync(path.join(`${dynamic.file}.ledger`, 'current.json')), false)
    liveLegacy.close()
    restarted = new mod.AgentTeamsStore(dynamic.file)
    await restarted.init()
    assert.equal(restarted.storageDiagnostics().mode, 'hot-cold')
    assert.deepEqual(await readFile(dynamic.file), liveBytes, 'startup promotion leaves the completed live v8 source immutable')
  } finally {
    if (hadPreference) process.env.DSH_AGENT_TEAMS_HOT_COLD_STORE = previousPreference
    else delete process.env.DSH_AGENT_TEAMS_HOT_COLD_STORE
    legacy.close()
    promoted.close()
    liveLegacy.close()
    restarted?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('v8 promotion is copy-only, content addressed, lazily hydrated, restartable, and losslessly exportable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-migration-'))
  const mod = await plugin('hot-cold-migration')
  const { file, document } = await createBulkV8Fixture(mod, root, 48)
  const original = await readFile(file)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    const snapshot = await store.init()
    const diagnostics = store.storageDiagnostics()
    assert.equal(diagnostics.mode, 'hot-cold')
    assert.equal(diagnostics.hotTeamCount, 1)
    assert.equal(diagnostics.closedShardCount, 47)
    assert.equal(diagnostics.retainedClosedDetails, 0)
    assert.deepEqual(snapshot, document)
    assert.deepEqual(await readFile(file), original, 'the v8 source remains byte-identical after copy-only promotion')

    const ledgerRoot = `${file}.ledger`
    const pointer = JSON.parse(await readFile(path.join(ledgerRoot, 'current.json'), 'utf8'))
    const manifestBytes = await readFile(artifactPath(ledgerRoot, pointer.manifest.path))
    assert.equal(hash(manifestBytes), pointer.manifest.hash)
    const manifest = JSON.parse(manifestBytes)
    const sourceBytes = await readFile(artifactPath(ledgerRoot, manifest.sourceV8.path))
    assert.deepEqual(sourceBytes, original)
    assert.equal(hash(sourceBytes), manifest.sourceV8.hash)
    const catalogBytes = await readFile(artifactPath(ledgerRoot, manifest.closedCatalog.path))
    assert.equal(hash(catalogBytes), manifest.closedCatalog.hash)
    const catalog = JSON.parse(catalogBytes)
    assert.equal(catalog.entries.length, 47)
    for (const entry of catalog.entries) {
      const shard = await readFile(artifactPath(ledgerRoot, entry.shard.path))
      assert.equal(hash(shard), entry.hash)
      assert.match(entry.shard.path, /^closed\/team-[a-f0-9]{64}\.json$/u)
    }

    const exported = path.join(root, 'exported-v8.json')
    await store.exportV8(exported)
    assert.deepEqual(JSON.parse(await readFile(exported, 'utf8')), snapshot)
    await assert.rejects(store.exportV8(file), error => error.code === 'AGENT_TEAMS_V8_SOURCE_READ_ONLY')
    await assert.rejects(store.exportV8(path.join(ledgerRoot, 'bad-export.json')), error => error.code === 'AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN')

    store.close()
    const restarted = new mod.AgentTeamsStore(file)
    try {
      const initialized = await restarted.init()
      assert.deepEqual(structuredClone(initialized), snapshot)
      assert.equal(restarted.storageDiagnostics().retainedClosedDetails, 0)
    } finally {
      restarted.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('filesystem identity preserves Unicode while applying only Windows path identity rules', async () => {
  const mod = await plugin('filesystem-identity-key')
  assert.equal(
    mod.filesystemPathIdentityKey('C:\\Temp\\Ledger\\TEAM.JSON\\', 'win32'),
    mod.filesystemPathIdentityKey('c:/temp/ledger/team.json', 'win32')
  )
  assert.notEqual(
    mod.filesystemPathIdentityKey('/tmp/Ledger/TEAM.JSON', 'linux'),
    mod.filesystemPathIdentityKey('/tmp/ledger/team.json', 'linux')
  )
  const nfc = 'C:\\Temp\\Caf\u00e9\\Team'
  const nfd = 'C:\\Temp\\Cafe\u0301\\Team'
  assert.notEqual(mod.filesystemPathIdentityKey(nfc, 'win32'), mod.filesystemPathIdentityKey(nfd, 'win32'))
  assert.equal(mod.canonicalPathIsWithin('C:\\Root\\', 'c:/root/child/file.json', 'win32'), true)
  assert.equal(mod.canonicalPathIsWithin('C:\\Root', 'c:/root-evil/file.json', 'win32'), false)
  assert.equal(mod.canonicalPathIsWithin('C:\\Root\\Caf\u00e9', 'c:/root/Cafe\u0301/file.json', 'win32'), false)

  const request = (kind, left, right) => ({
    sourceTaskId: 'source-task',
    parallelBenefit: 'The two identity-distinct boundaries can proceed independently.',
    workstreams: [
      { title: 'Left', deliverable: 'Left result', acceptance_criteria: 'Left verified', files: kind === 'files' ? [left] : [], resources: kind === 'resources' ? [left] : [] },
      { title: 'Right', deliverable: 'Right result', acceptance_criteria: 'Right verified', files: kind === 'files' ? [right] : [], resources: kind === 'resources' ? [right] : [] }
    ]
  })
  const unicodeFiles = mod.normalizeExpansionRequest(request('files', 'src/Caf\u00e9.js', 'src/Cafe\u0301.js'), { platform: 'win32' })
  assert.deepEqual(unicodeFiles.workstreams.map(workstream => workstream.files[0]), ['src/Caf\u00e9.js', 'src/Cafe\u0301.js'])
  const unicodeResources = mod.normalizeExpansionRequest(request('resources', 'resource/，', 'resource/,'), { platform: 'win32' })
  assert.deepEqual(unicodeResources.workstreams.map(workstream => workstream.resources[0]), ['resource/，', 'resource/,'])
  const structuralResources = mod.normalizeExpansionRequest(request('resources', 'database\\.\\orders//', 'queue//./events/'), { platform: 'win32' })
  assert.deepEqual(structuralResources.workstreams.map(workstream => workstream.resources[0]), ['database/orders', 'queue/events'])
  assert.throws(
    () => mod.normalizeExpansionRequest(request('resources', 'database/../orders', 'queue/events'), { platform: 'win32' }),
    error => error.code === 'AGENT_TEAMS_INVALID_EXPANSION'
  )
})

test('persistent v2 expansion identity is cross-platform while transient file equivalence follows platform rules', async () => {
  const mod = await plugin('expansion-v2-platform-identity')
  const worker = { sessionId: 'worker-platform-identity' }
  const request = (file, resource = 'resource/plain') => ({
    sourceTaskId: 'source-platform-identity',
    parallelBenefit: 'Independent outcomes can proceed concurrently.',
    workstreams: [
      { title: 'Alpha', deliverable: 'Alpha result', acceptanceCriteria: 'Alpha check', files: [file], resources: [resource] },
      { title: 'Beta', deliverable: 'Beta result', acceptanceCriteria: 'Beta check', files: ['src/beta.js'], resources: ['resource/beta'] }
    ]
  })
  const upper = request('SRC\\Alpha\\.\\index.js/')
  const lower = request('src/alpha/index.js')
  const persistentByComparisonMode = ['win32', 'linux'].map(platform => {
    assert.equal(mod.expansionRequestsSemanticallyEquivalent(upper, lower, { platform }), platform === 'win32')
    return mod.expansionRequestIdentity('team-platform-identity', worker, upper)
  })
  assert.equal(new Set(persistentByComparisonMode).size, 1, 'persistent v2 identity never incorporates the transient comparison platform')
  assert.notEqual(
    mod.expansionRequestIdentity('team-platform-identity', worker, upper),
    mod.expansionRequestIdentity('team-platform-identity', worker, lower),
    'persistent v2 identity preserves file-boundary case codepoints'
  )
  const fullwidth = request('src/unicode.js', 'resource/，')
  const ascii = request('src/unicode.js', 'resource/,')
  assert.notEqual(mod.expansionRequestIdentity('team-platform-identity', worker, fullwidth), mod.expansionRequestIdentity('team-platform-identity', worker, ascii))
  assert.equal(mod.expansionRequestsSemanticallyEquivalent(fullwidth, ascii, { platform: 'win32' }), false)
  const nfc = request('src/Caf\u00e9.js')
  const nfd = request('src/Cafe\u0301.js')
  assert.notEqual(mod.expansionRequestIdentity('team-platform-identity', worker, nfc), mod.expansionRequestIdentity('team-platform-identity', worker, nfd))
  assert.equal(mod.expansionRequestsSemanticallyEquivalent(nfc, nfd, { platform: 'win32' }), false)
})

test('canonical expansion lookup reuses historical v1 and equivalent v2 synonyms with zero effects', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-expansion-v1-dedupe-'))
  const file = path.join(root, 'storages', 'agent_teams.json')
  const mod = await plugin('expansion-v1-dedupe')
  const lead = { id: 'root-expansion-v1', options: { provider: 'test', model: 'test' } }
  const worker = { id: 'worker-expansion-v1' }
  const store = new mod.AgentTeamsStore(file, { enabled: true, hotColdStore: false })
  try {
    await store.init()
    const team = await mod.createTeam(store, lead, { objective: 'Expansion v1 compatibility', leadName: 'Lead' })
    await store.mutate(document => {
      const current = document.teams.find(candidate => candidate.id === team.id)
      const at = new Date().toISOString()
      current.members.push({
        id: 'member-expansion-v1', sessionId: worker.id, name: 'Worker', role: 'resource split',
        kind: 'worker', state: 'ready', createdAt: at, updatedAt: at
      })
    })
    const createdTask = await mod.createTask(store, lead, {
      teamId: team.id, title: 'Broad source task', assigneeSessionId: worker.id,
      files: ['src'], capabilities: [], externalEffects: []
    })
    await store.mutate(document => {
      const current = document.teams.find(candidate => candidate.id === team.id)
      const task = current.tasks.find(candidate => candidate.id === createdTask.task.id)
      const at = new Date().toISOString()
      task.state = 'in_progress'
      task.revision += 1
      task.attempt = 1
      task.claimId = 'claim-expansion-v1'
      task.claimedAt = at
      task.updatedAt = at
      const historical = {
        sourceTaskId: task.id,
        parallelBenefit: 'Two independent resource streams reduce the critical path.',
        workstreams: [
          { title: 'Alpha', deliverable: 'Alpha result', acceptanceCriteria: 'Alpha check', files: ['src/alpha/'], resources: ['database//./orders/'] },
          { title: 'Beta', deliverable: 'Beta result', acceptanceCriteria: 'Beta check', files: ['src/beta/index.js'], resources: ['queue/events/'] }
        ]
      }
      const dedupeKey = legacyExpansionIdentity(current.id, worker.id, historical)
      const request = {
        id: `expansion:${dedupeKey}`, teamId: current.id, sourceTaskId: task.id, sourceTaskTitle: task.title,
        requestedBy: { memberId: 'member-expansion-v1', sessionId: worker.id, name: 'Worker' },
        parallelBenefit: historical.parallelBenefit, workstreams: historical.workstreams,
        capacity: { memberSlots: 6, activeTurnSlots: 6, taskSlots: 63, availableWorkstreams: 6 }, requestedAt: at
      }
      current.messages.push({
        id: request.id, fromSessionId: worker.id, toSessionId: lead.id,
        body: 'historical v1 expansion relay', status: 'queued', queuedAt: at, createdAt: at,
        kind: 'expansion_request', dedupeKey, expansionRequest: request
      })
      current.updatedAt = at
    })
    store.close()

    const restarted = new mod.AgentTeamsStore(file, { enabled: true, hotColdStore: false })
    try {
      await restarted.init()
      const beforeBytes = await readFile(file)
      const beforeInfo = await stat(file, { bigint: true })
      const ledgerRoot = `${file}.ledger`
      const beforeLedger = existsSync(ledgerRoot) ? await directorySnapshot(ledgerRoot) : undefined
      const before = restarted.snapshot()
      let publications = 0, relays = 0, wakes = 0
      const unsubscribe = restarted.subscribe(() => { publications += 1 })
      const result = await mod.submitExpansionRequest({
        agents: new Map([[lead.id, { status: 'running', steer() { relays += 1 }, followup() { relays += 1 } }]])
      }, restarted, { async run() { wakes += 1 } }, worker, {
        teamId: team.id,
        sourceTaskId: createdTask.task.id,
        parallelBenefit: 'Two independent resource streams reduce the critical path.',
        workstreams: [
          { title: 'Beta', deliverable: 'Beta result', acceptance_criteria: 'Beta check', files: ['src\\beta\\.\\index.js'], resources: ['queue//./events'] },
          { title: 'Alpha', deliverable: 'Alpha result', acceptance_criteria: 'Alpha check', files: ['SRC\\ALPHA\\.\\'], resources: ['database/orders/'] }
        ]
      }, undefined, { platform: 'win32' })
      unsubscribe()
      const afterInfo = await stat(file, { bigint: true })
      assert.equal(result.deduplicated, true)
      assert.equal(result.expansionRequest.id, before.teams[0].messages[0].expansionRequest.id)
      assert.deepEqual(restarted.snapshot(), before)
      assert.deepEqual(await readFile(file), beforeBytes)
      if (beforeLedger !== undefined) assert.deepEqual(await directorySnapshot(ledgerRoot), beforeLedger)
      assert.deepEqual(
        [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
        [beforeInfo.dev, beforeInfo.ino, beforeInfo.size, beforeInfo.mtimeNs, beforeInfo.ctimeNs]
      )
      assert.deepEqual([publications, relays, wakes], [0, 0, 0])

      await restarted.mutate(document => {
        const current = document.teams.find(candidate => candidate.id === team.id)
        const message = current.messages[0]
        message.expansionRequest.workstreams[0].files = ['SRC/ALPHA']
        message.expansionRequest.workstreams[0].resources = ['database/orders']
        const v2Key = mod.expansionRequestIdentity(current.id, { sessionId: worker.id }, message.expansionRequest)
        message.id = `expansion:${v2Key}`
        message.dedupeKey = v2Key
        message.expansionRequest.id = message.id
        message.body = 'persisted v2 expansion relay'
        current.updatedAt = new Date().toISOString()
      })
      const v2Before = restarted.snapshot()
      const v2Bytes = await readFile(file)
      const v2Info = await stat(file, { bigint: true })
      const v2Ledger = existsSync(ledgerRoot) ? await directorySnapshot(ledgerRoot) : undefined
      let v2Publications = 0
      const unsubscribeV2 = restarted.subscribe(() => { v2Publications += 1 })
      const v2Result = await mod.submitExpansionRequest({
        agents: new Map([[lead.id, { status: 'running', steer() { relays += 1 }, followup() { relays += 1 } }]])
      }, restarted, { async run() { wakes += 1 } }, worker, {
        teamId: team.id,
        sourceTaskId: createdTask.task.id,
        parallelBenefit: 'Two independent resource streams reduce the critical path.',
        workstreams: [
          { title: 'Beta', deliverable: 'Beta result', acceptance_criteria: 'Beta check', files: ['src/beta/index.js'], resources: ['queue/events'] },
          { title: 'Alpha', deliverable: 'Alpha result', acceptance_criteria: 'Alpha check', files: ['src/alpha/'], resources: ['database/orders'] }
        ]
      }, undefined, { platform: 'win32' })
      unsubscribeV2()
      const v2AfterInfo = await stat(file, { bigint: true })
      assert.equal(v2Result.deduplicated, true)
      assert.equal(v2Result.expansionRequest.id, v2Before.teams[0].messages[0].expansionRequest.id)
      assert.deepEqual(restarted.snapshot(), v2Before)
      assert.deepEqual(await readFile(file), v2Bytes)
      if (v2Ledger !== undefined) assert.deepEqual(await directorySnapshot(ledgerRoot), v2Ledger)
      assert.deepEqual(
        [v2AfterInfo.dev, v2AfterInfo.ino, v2AfterInfo.size, v2AfterInfo.mtimeNs, v2AfterInfo.ctimeNs],
        [v2Info.dev, v2Info.ino, v2Info.size, v2Info.mtimeNs, v2Info.ctimeNs]
      )
      assert.deepEqual([v2Publications, relays, wakes], [0, 0, 0])
    } finally {
      restarted.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('v8 export resolves filesystem identity and rejects source or ledger aliases', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-v8-export-identity-'))
  const mod = await plugin('v8-export-identity')
  const { file } = await createBulkV8Fixture(mod, root, 20)
  const original = await readFile(file)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    await store.init()
    const ledgerRoot = `${file}.ledger`
    const ledger = await currentLedgerState(file)
    const innerMarker = path.join(ledgerRoot, 'promoted.json')
    await writeFile(innerMarker, canonicalBuffer({ version: 1, sourceV8Hash: ledger.manifest.sourceV8.hash }))
    const ledgerBefore = await directorySnapshot(ledgerRoot)

    const sourceHardlink = path.join(root, 'source-hardlink.json')
    await link(file, sourceHardlink)
    await assert.rejects(store.exportV8(sourceHardlink), error => error.code === 'AGENT_TEAMS_V8_SOURCE_READ_ONLY')
    const sentinel = `${file}.promoted.json`
    const sentinelBefore = await readFile(sentinel)
    await assert.rejects(store.exportV8(sentinel), error => error.code === 'AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN')
    const sentinelHardlink = path.join(root, 'sentinel-hardlink.json')
    await link(sentinel, sentinelHardlink)
    await assert.rejects(store.exportV8(sentinelHardlink), error => error.code === 'AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN')
    assert.deepEqual(await readFile(sentinel), sentinelBefore)

    const catalog = JSON.parse(await readFile(artifactPath(ledgerRoot, ledger.manifest.closedCatalog.path), 'utf8'))
    const managedArtifacts = [
      path.join(ledgerRoot, 'current.json'),
      innerMarker,
      artifactPath(ledgerRoot, ledger.pointer.manifest.path),
      artifactPath(ledgerRoot, ledger.manifest.hot.path),
      artifactPath(ledgerRoot, ledger.manifest.closedCatalog.path),
      artifactPath(ledgerRoot, ledger.manifest.sourceV8.path),
      artifactPath(ledgerRoot, catalog.entries[0].shard.path)
    ]
    for (let index = 0; index < managedArtifacts.length; index += 1) {
      const alias = path.join(root, `managed-ledger-hardlink-${index}.json`)
      await link(managedArtifacts[index], alias)
      await assert.rejects(store.exportV8(alias), error => error.code === 'AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN')
    }
    const nonregular = path.join(root, 'nonregular-export-target')
    await mkdir(nonregular)
    await assert.rejects(store.exportV8(nonregular), error => error.code === 'AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN')
    if (process.platform === 'win32') {
      await assert.rejects(store.exportV8(file.toUpperCase()), error => error.code === 'AGENT_TEAMS_V8_SOURCE_READ_ONLY')
    }

    const ledgerAlias = path.join(root, 'ledger-parent-alias')
    let aliasSupported = true
    try {
      await symlink(ledgerRoot, ledgerAlias, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (!['EACCES', 'EPERM', 'ENOSYS'].includes(error?.code)) throw error
      aliasSupported = false
      t.diagnostic(`filesystem aliases are unavailable on this runner (${error.code})`)
    }
    if (aliasSupported) {
      await assert.rejects(
        store.exportV8(path.join(ledgerAlias, 'alias-export.json')),
        error => error.code === 'AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN'
      )
    }

    const safeDestination = path.join(root, 'external-export', 'nested', 'safe-v8.json')
    await mkdir(path.dirname(safeDestination), { recursive: true })
    await writeFile(safeDestination, 'replace this regular file\n')
    const exported = await store.exportV8(safeDestination)
    assert.deepEqual(JSON.parse(await readFile(exported.destination, 'utf8')), store.snapshot())
    assert.deepEqual(await readFile(file), original, 'every rejected and successful export leaves the read-only v8 source unchanged')
    assert.deepEqual(await directorySnapshot(ledgerRoot), ledgerBefore, 'exports never rewrite or create hot/cold ledger artifacts')
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('closed shards remain lazy for summaries and fail closed when corrupted detail is demanded', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-lazy-'))
  const mod = await plugin('hot-cold-lazy')
  const { file } = await createBulkV8Fixture(mod, root, 20)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    await store.init()
    const ledgerRoot = `${file}.ledger`
    const pointer = JSON.parse(await readFile(path.join(ledgerRoot, 'current.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(artifactPath(ledgerRoot, pointer.manifest.path), 'utf8'))
    const catalog = JSON.parse(await readFile(artifactPath(ledgerRoot, manifest.closedCatalog.path), 'utf8'))
    await writeFile(artifactPath(ledgerRoot, catalog.entries[0].shard.path), '{"corrupt":true}\n')

    let summaryPublication
    const unsubscribe = store.subscribe(document => {
      const closed = document.teams.find(team => team.id === 'team-0')
      summaryPublication = { id: closed.id, name: closed.name, state: closed.state }
    })
    await store.mutate(document => { document.teams.find(team => team.id === 'team-19').name = 'still writable' })
    unsubscribe()

    assert.deepEqual(summaryPublication, { id: 'team-0', name: 'Team 0', state: 'closed' })
    assert.equal(await store.read(document => document.teams.find(team => team.id === 'team-19').name), 'still writable')
    assert.equal(await store.read(document => document.teams.find(team => team.id === 'team-0').name), 'Team 0')
    await assert.rejects(store.read(document => document.teams.find(team => team.id === 'team-0').tasks.length), /artifact integrity mismatch/u)
    assert.equal(store.storageDiagnostics().retainedClosedDetails, 0)

    store.close()
    const restarted = new mod.AgentTeamsStore(file)
    try {
      const initialized = await restarted.init()
      const closed = initialized.teams.find(team => team.id === 'team-0')
      assert.deepEqual({ id: closed.id, name: closed.name, state: closed.state }, { id: 'team-0', name: 'Team 0', state: 'closed' })
      await assert.rejects(restarted.read(document => document.teams.find(team => team.id === 'team-0').tasks.length), /artifact integrity mismatch/u)
    } finally {
      restarted.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('a closed-team detail projection hydrates exactly its selected immutable shard', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-selected-shard-'))
  const mod = await plugin('hot-cold-selected-shard')
  const fixture = await createBulkV8Fixture(mod, root, 20, { distinctProjects: true })
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    await store.init()
    const view = store.view()
    const before = store.storageDiagnostics().closedShardReadCount
    assert.equal(mod.teamSnapshot(view, 'root-3', 'team-3').team.id, 'team-3')
    assert.equal(store.storageDiagnostics().closedShardReadCount, before + 1)
    assert.equal(mod.teamSnapshot(view, 'root-3', 'team-3').team.id, 'team-3')
    assert.equal(store.storageDiagnostics().closedShardReadCount, before + 1, 'one view memoizes its selected shard')
    assert.equal(mod.teamSnapshot(view, 'root-4', 'team-4').team.id, 'team-4')
    assert.equal(store.storageDiagnostics().closedShardReadCount, before + 2)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('generation-bound views scan active state without hydrating unrelated missing closed shards', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-generation-view-'))
  const mod = await plugin('hot-cold-generation-view')
  const fixture = await createBulkV8Fixture(mod, root, 125, { distinctProjects: true })
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    await store.init()
    assert.deepEqual(store.snapshot(), fixture.document, 'snapshot remains the full compatible document')
    const view = store.view()
    assert.equal(Object.isFrozen(view), true)
    assert.equal(Object.isFrozen(view.teams), true)
    const activeViewTeam = view.teams.find(team => team.id === 'team-124')
    assert.equal(Object.isFrozen(activeViewTeam), true)
    await store.mutate(document => { document.teams.find(team => team.id === 'team-124').name = 'next generation' })
    assert.equal(activeViewTeam.name, 'Team 124', 'a held view stays bound to its immutable generation')
    assert.equal(store.view().teams.find(team => team.id === 'team-124').name, 'next generation')
    const readsBefore = store.storageDiagnostics().closedShardReadCount
    const ledger = await currentLedgerState(fixture.file)
    const catalog = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.closedCatalog.path), 'utf8'))
    const quarantine = path.join(root, 'quarantine')
    await mkdir(quarantine, { recursive: true })
    for (const entry of catalog.entries) await rename(artifactPath(ledger.root, entry.shard.path), path.join(quarantine, path.basename(entry.shard.path)))

    assert.equal(view.teams.filter(team => team.state !== 'closed').length, 1)
    const activeProjection = mod.teamSnapshot(view, 'root-124', 'team-124')
    assert.equal(activeProjection.team.id, 'team-124')
    assert.equal(store.storageDiagnostics().closedShardReadCount, readsBefore, 'active projection uses only ledger safety indexes')
    assert.throws(() => mod.teamSnapshot(view, 'root-0', 'team-0'), /ENOENT|no such file/u)
    assert.throws(() => store.snapshot(), /ENOENT|no such file/u)
    assert.equal(store.storageDiagnostics().retainedClosedDetails, 0)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('a closed shard reopens into hot state and closes into a new immutable shard', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-reopen-'))
  const mod = await plugin('hot-cold-reopen')
  const { file } = await createBulkV8Fixture(mod, root, 20)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    await store.init()
    await store.mutate(document => {
      const team = document.teams.find(candidate => candidate.id === 'team-0')
      team.state = 'active'
      team.closure = undefined
      team.updatedAt = new Date().toISOString()
    })
    assert.equal(store.storageDiagnostics().hotTeamCount, 2)
    assert.equal(store.storageDiagnostics().closedShardCount, 18)
    assert.equal(store.snapshot().teams.find(team => team.id === 'team-0').state, 'active')

    await store.mutate(document => forceClose(document.teams.find(team => team.id === 'team-0')))
    assert.equal(store.storageDiagnostics().hotTeamCount, 1)
    assert.equal(store.storageDiagnostics().closedShardCount, 19)
    store.close()
    const restarted = new mod.AgentTeamsStore(file)
    try {
      const snapshot = await restarted.init()
      assert.equal(snapshot.teams.find(team => team.id === 'team-0').state, 'closed')
      assert.equal(restarted.storageDiagnostics().retainedClosedDetails, 0)
    } finally {
      restarted.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('rehashing a forged pause epoch still fails manifest security validation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-security-'))
  const mod = await plugin('hot-cold-security')
  const { file } = await createBulkV8Fixture(mod, root, 18)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    await store.init()
    store.close()
    const ledgerRoot = `${file}.ledger`
    const pointerPath = path.join(ledgerRoot, 'current.json')
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8'))
    const manifest = JSON.parse(await readFile(artifactPath(ledgerRoot, pointer.manifest.path), 'utf8'))
    const catalog = JSON.parse(await readFile(artifactPath(ledgerRoot, manifest.closedCatalog.path), 'utf8'))
    catalog.entries[0].pauseEpoch += 1
    const catalogBytes = Buffer.from(`${JSON.stringify(catalog)}\n`)
    const catalogHash = hash(catalogBytes)
    manifest.closedCatalog = { path: `catalog/catalog-${catalogHash}.json`, hash: catalogHash, bytes: catalogBytes.length }
    await writeFile(artifactPath(ledgerRoot, manifest.closedCatalog.path), catalogBytes)
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`)
    const manifestHash = hash(manifestBytes)
    pointer.manifest = { path: `manifests/manifest-${manifest.generation}-${manifestHash}.json`, hash: manifestHash, bytes: manifestBytes.length, generation: manifest.generation }
    await writeFile(artifactPath(ledgerRoot, pointer.manifest.path), manifestBytes)
    await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`)

    const forged = new mod.AgentTeamsStore(file)
    try {
      await assert.rejects(forged.init(), /manifest hash mismatch|root projection hash mismatch/u)
    } finally {
      forged.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('noncanonical content-addressed pointer references fail closed before artifact use', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-noncanonical-ref-'))
  const mod = await plugin('hot-cold-noncanonical-ref')
  const fixture = await createBulkV8Fixture(mod, root, 18)
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    await store.init()
    const ledger = await currentLedgerState(fixture.file)
    const fakeReference = `manifests/manifest-${ledger.pointer.generation}-${'0'.repeat(64)}.json`
    await writeFile(artifactPath(ledger.root, fakeReference), ledger.manifestBytes)
    const forged = structuredClone(ledger.pointer)
    forged.manifest.path = fakeReference
    await writeFile(path.join(ledger.root, 'current.json'), `${JSON.stringify(forged)}\n`)
    store.close()
    const rejected = new mod.AgentTeamsStore(fixture.file)
    try {
      await assert.rejects(rejected.init(), /noncanonical/u)
    } finally {
      rejected.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('projection hashing preserves Unicode roots across shared and distinct canonical scopes', async () => {
  const mod = await plugin('hot-cold-projection-scope')
  const readVerifiedProjectionHashes = async file => {
    const ledger = await currentLedgerState(file)
    const hotDocument = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.hot.path), 'utf8'))
    const catalog = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.closedCatalog.path), 'utf8'))
    const entries = [...ledger.manifest.hotTeams, ...catalog.entries].sort((left, right) => left.ordinal - right.ordinal)
    const expected = expectedLedgerProjectionHashes(hotDocument.header, entries)
    assert.deepEqual(ledger.manifest.projectionHashes, expected)
    return expected
  }

  const sharedRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-projection-shared-'))
  const sharedFixture = await createBulkV8Fixture(mod, sharedRoot, 18)
  const composedRoot = 'root-é'
  const decomposedRoot = 'root-é'
  assert.notEqual(composedRoot, decomposedRoot)
  assert.equal(composedRoot.normalize('NFC'), decomposedRoot.normalize('NFC'))
  for (let index = 0; index < sharedFixture.document.teams.length; index += 1) {
    const team = sharedFixture.document.teams[index]
    const rootSessionId = index % 2 === 0 ? composedRoot : decomposedRoot
    team.rootLeadSessionId = rootSessionId
    team.members[0].id = `lead:${rootSessionId}`
    team.members[0].sessionId = rootSessionId
  }
  await writeFile(sharedFixture.file, `${JSON.stringify(sharedFixture.document)}\n`)
  const sharedStore = new mod.AgentTeamsStore(sharedFixture.file, { hotColdStore: true })
  let sharedRestarted
  try {
    await sharedStore.init()
    const initial = await readVerifiedProjectionHashes(sharedFixture.file)
    assert.deepEqual(new Set(initial.map(item => item.rootSessionId)), new Set([composedRoot, decomposedRoot]))
    assert.equal(new Set(initial.map(item => item.hash)).size, 1, 'identical shared-project scopes retain one exact digest value')
    await mutateActiveName(sharedStore, 1)
    await readVerifiedProjectionHashes(sharedFixture.file)
    sharedStore.close()
    sharedRestarted = new mod.AgentTeamsStore(sharedFixture.file)
    await sharedRestarted.init()
    await readVerifiedProjectionHashes(sharedFixture.file)
  } finally {
    sharedStore.close()
    sharedRestarted?.close()
    await rm(sharedRoot, { recursive: true, force: true })
  }

  const distinctRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-projection-distinct-'))
  const distinctFixture = await createBulkV8Fixture(mod, distinctRoot, 18, { distinctProjects: true })
  const distinctStore = new mod.AgentTeamsStore(distinctFixture.file, { hotColdStore: true })
  let distinctRestarted
  try {
    await distinctStore.init()
    const before = await readVerifiedProjectionHashes(distinctFixture.file)
    assert.equal(before.length, 18)
    assert.equal(new Set(before.map(item => item.hash)).size, before.length, 'different canonical ordinal scopes must retain independent digest values')
    const beforeByRoot = new Map(before.map(item => [item.rootSessionId, item.hash]))
    await mutateActiveName(distinctStore, 1)
    const after = await readVerifiedProjectionHashes(distinctFixture.file)
    const afterByRoot = new Map(after.map(item => [item.rootSessionId, item.hash]))
    assert.notEqual(afterByRoot.get('root-17'), beforeByRoot.get('root-17'), 'the mutated ordinal scope advances its own digest')
    for (const [rootSessionId, digest] of beforeByRoot) {
      if (rootSessionId !== 'root-17') assert.equal(afterByRoot.get(rootSessionId), digest, `unrelated ordinal scope ${rootSessionId} keeps its digest`)
    }
    distinctStore.close()
    distinctRestarted = new mod.AgentTeamsStore(distinctFixture.file)
    await distinctRestarted.init()
    assert.deepEqual(await readVerifiedProjectionHashes(distinctFixture.file), after)
  } finally {
    distinctStore.close()
    distinctRestarted?.close()
    await rm(distinctRoot, { recursive: true, force: true })
  }
})

test('parallel hot and manifest writers fully settle, prefer hot errors, and leave the pointer unchanged', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-writer-settlement-'))
  const mod = await plugin('hot-cold-writer-settlement')
  const fixture = await createBulkV8Fixture(mod, root, 18)
  let armed = false
  let mode = 'manifest-failure'
  let hotEntered = deferred()
  let manifestEntered = deferred()
  let releaseHot = deferred()
  const store = new mod.AgentTeamsStore(fixture.file, {
    hotColdStore: true,
    async hotColdFaultInjector(stage) {
      if (!armed) return
      if (stage === 'before-hot-document-write') {
        hotEntered.resolve()
        if (mode === 'manifest-failure') await releaseHot.promise
        if (mode === 'both-fail') throw new Error('hot branch failed')
      }
      if (stage === 'before-manifest-document-write') {
        manifestEntered.resolve()
        throw new Error(mode === 'both-fail' ? 'manifest branch also failed' : 'manifest branch failed')
      }
    }
  })
  try {
    await store.init()
    const ledger = await currentLedgerState(fixture.file)
    const pointerPath = path.join(ledger.root, 'current.json')
    const pointerBytes = await readFile(pointerPath)
    const pointerInfo = await stat(pointerPath, { bigint: true })
    armed = true
    let settled = false
    const mutation = mutateActiveName(store, 1)
    const observed = mutation.then(() => { settled = true }, () => { settled = true })
    await Promise.all([hotEntered.promise, manifestEntered.promise])
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(settled, false, 'a rejected writer cannot let the mutation escape while its sibling is still running')
    releaseHot.resolve()
    await assert.rejects(mutation, /manifest branch failed/u)
    await observed
    const afterInfo = await stat(pointerPath, { bigint: true })
    assert.deepEqual(await readFile(pointerPath), pointerBytes)
    assert.deepEqual(
      [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
      [pointerInfo.dev, pointerInfo.ino, pointerInfo.size, pointerInfo.mtimeNs, pointerInfo.ctimeNs]
    )
    assert.equal(Object.keys(await directorySnapshot(ledger.root)).some(reference => reference.endsWith('.tmp')), false)
    const settledSnapshot = await directorySnapshot(ledger.root)
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(await directorySnapshot(ledger.root), settledSnapshot, 'no writer may continue after the rejected mutation settles')

    mode = 'both-fail'
    hotEntered = deferred()
    manifestEntered = deferred()
    releaseHot = deferred()
    await assert.rejects(mutateActiveName(store, 2), /hot branch failed/u, 'the hot writer error has deterministic priority')
    await Promise.all([hotEntered.promise, manifestEntered.promise])
    assert.deepEqual(await readFile(pointerPath), pointerBytes)
    assert.equal(Object.keys(await directorySnapshot(ledger.root)).some(reference => reference.endsWith('.tmp')), false)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('immutable writer collisions clean owned temps without deleting the destination', async t => {
  for (const [code, equal] of [['EEXIST', true], ['EPERM', false]]) await t.test(`${code}-${equal ? 'equal' : 'mismatch'}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-collision-${code.toLowerCase()}-`))
    const mod = await plugin(`hot-cold-collision-${code}-${equal}`)
    const fixture = await createBulkV8Fixture(mod, root, 18)
    let armed = false
    let collisionDestination
    let collisionBytes
    const store = new mod.AgentTeamsStore(fixture.file, {
      hotColdStore: true,
      async hotColdFaultInjector(stage) {
        if (!armed || !stage.startsWith('before-immutable-rename:hot/')) return
        const reference = stage.slice('before-immutable-rename:'.length)
        collisionDestination = artifactPath(`${fixture.file}.ledger`, reference)
        const directory = path.dirname(collisionDestination)
        const prefix = `${path.basename(collisionDestination)}.`
        const tempName = (await readdir(directory)).find(name => name.startsWith(prefix) && name.endsWith('.tmp'))
        assert.ok(tempName, 'the collision hook observes the still-owned wx temp')
        const intended = await readFile(path.join(directory, tempName))
        collisionBytes = equal ? intended : Buffer.from('foreign collision bytes\n')
        await writeFile(collisionDestination, collisionBytes)
        const error = new Error(`injected ${code} collision`)
        error.code = code
        throw error
      }
    })
    try {
      await store.init()
      const ledger = await currentLedgerState(fixture.file)
      const pointerBytes = await readFile(path.join(ledger.root, 'current.json'))
      armed = true
      if (equal) {
        await mutateActiveName(store, 1)
        assert.equal(store.storageDiagnostics().generation, ledger.pointer.generation + 1)
      } else {
        await assert.rejects(mutateActiveName(store, 1), /immutable Agent Teams artifact collision/u)
        assert.deepEqual(await readFile(path.join(ledger.root, 'current.json')), pointerBytes)
        assert.deepEqual(await readFile(collisionDestination), collisionBytes, 'collision cleanup must never remove or replace the destination')
      }
      assert.equal(Object.keys(await directorySnapshot(ledger.root)).some(reference => reference.endsWith('.tmp')), false)
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('after-hot remains the physical verification gate before after-manifest and pointer visibility', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-physical-gate-'))
  const mod = await plugin('hot-cold-physical-gate')
  const fixture = await createBulkV8Fixture(mod, root, 18)
  let armed = false
  const stages = []
  let targetGeneration
  const store = new mod.AgentTeamsStore(fixture.file, {
    hotColdStore: true,
    async hotColdFaultInjector(stage) {
      if (!armed) return
      if (stage === 'after-hot-document') {
        stages.push(stage)
        const hotDirectory = path.join(`${fixture.file}.ledger`, 'hot')
        const name = (await readdir(hotDirectory)).find(candidate => candidate.startsWith(`hot-${targetGeneration}-`) && candidate.endsWith('.json'))
        assert.ok(name)
        await writeFile(path.join(hotDirectory, name), '{"corrupt":true}\n')
      } else if (stage === 'after-manifest-document') stages.push(stage)
    }
  })
  try {
    await store.init()
    const ledger = await currentLedgerState(fixture.file)
    const pointerPath = path.join(ledger.root, 'current.json')
    const pointerBytes = await readFile(pointerPath)
    targetGeneration = ledger.pointer.generation + 1
    armed = true
    await assert.rejects(mutateActiveName(store, 1), /artifact integrity mismatch/u)
    assert.deepEqual(stages, ['after-hot-document'])
    assert.deepEqual(await readFile(pointerPath), pointerBytes)
    assert.equal(Object.keys(await directorySnapshot(ledger.root)).some(reference => reference.endsWith('.tmp')), false)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('the exact commit origin adopts once while peers and both listener streams advance once', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-origin-publication-'))
  const mod = await plugin('hot-cold-origin-publication')
  const fixture = await createBulkV8Fixture(mod, root, 18)
  const first = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  const second = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    await first.init()
    await second.init()
    const counts = { firstAdopt: 0, secondAdopt: 0, firstListener: 0, secondListener: 0 }
    const firstAdopt = first._adoptHotColdPublication.bind(first)
    const secondAdopt = second._adoptHotColdPublication.bind(second)
    first._adoptHotColdPublication = (...args) => { counts.firstAdopt += 1; return firstAdopt(...args) }
    second._adoptHotColdPublication = (...args) => { counts.secondAdopt += 1; return secondAdopt(...args) }
    const unsubscribeFirst = first.subscribe(() => { counts.firstListener += 1 })
    const unsubscribeSecond = second.subscribe(() => { counts.secondListener += 1 })

    await mutateActiveName(first, 1)
    assert.deepEqual(counts, { firstAdopt: 1, secondAdopt: 1, firstListener: 1, secondListener: 1 })
    assert.equal(second.snapshot().teams.find(team => team.state !== 'closed').name, 'Generation 1')

    Object.assign(counts, { firstAdopt: 0, secondAdopt: 0, firstListener: 0, secondListener: 0 })
    await mutateActiveName(second, 2)
    assert.deepEqual(counts, { firstAdopt: 1, secondAdopt: 1, firstListener: 1, secondListener: 1 })
    assert.equal(first.snapshot().teams.find(team => team.state !== 'closed').name, 'Generation 2')

    Object.assign(counts, { firstAdopt: 0, secondAdopt: 0, firstListener: 0, secondListener: 0 })
    await second.rollbackHotColdManifest()
    assert.deepEqual(counts, { firstAdopt: 1, secondAdopt: 2, firstListener: 1, secondListener: 1 }, 'rollback keeps its independent local-adopt plus publication-adopt path')
    assert.equal(first.snapshot().teams.find(team => team.state !== 'closed').name, 'Generation 1')
    unsubscribeFirst()
    unsubscribeSecond()
  } finally {
    first.close()
    second.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('two stores share one file-scoped soft-maintenance queue across origin handoffs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-soft-two-store-'))
  const mod = await plugin('hot-cold-soft-two-store')
  const file = path.join(root, 'storages', 'agent_teams.json')
  let sweeps = 0
  const options = {
    enabled: true,
    hotColdStore: true,
    hotColdRetentionSoftFiles: 1,
    hotColdRetentionHardFiles: 64,
    hotColdRetentionSoftBytes: 16 * 1024 * 1024,
    hotColdRetentionHardBytes: 32 * 1024 * 1024,
    hotColdFaultInjector(stage) { if (stage === 'before-retention-sweep') sweeps += 1 }
  }
  const first = new mod.AgentTeamsStore(file, options)
  const second = new mod.AgentTeamsStore(file, options)
  try {
    await first.init()
    await mod.createTeam(first, { id: 'root-soft-two-store', options: { provider: 'test', model: 'test' } }, { objective: 'soft two store', leadName: 'Lead' })
    await second.init()
    sweeps = 0
    for (let index = 0; index < 12; index += 1) {
      await mutateActiveName(first, index)
      const maintenance = first.storageDiagnostics().retention.maintenance
      if (maintenance.requested || maintenance.scheduled) break
    }
    await waitForRetentionMaintenance(first)
    assert.equal(sweeps, 1, 'the writer and peer cannot enqueue duplicate sweeps for one file')
    assert.equal(second.snapshot().teams.find(team => team.state !== 'closed').name, first.snapshot().teams.find(team => team.state !== 'closed').name)
    assert.deepEqual(second.storageDiagnostics().retention.maintenance, first.storageDiagnostics().retention.maintenance)

    for (let index = 20; index < 32; index += 1) {
      await mutateActiveName(second, index)
      const maintenance = second.storageDiagnostics().retention.maintenance
      if (maintenance.requested || maintenance.scheduled) break
    }
    await waitForRetentionMaintenance(second)
    assert.equal(sweeps, 2, 'the shared queue safely transfers maintenance ownership to the next exact origin')
    assert.equal(first.snapshot().teams.find(team => team.state !== 'closed').name, second.snapshot().teams.find(team => team.state !== 'closed').name)
  } finally {
    first.close()
    second.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('file-scoped soft retention yields to foreground work, converges quietly, and emits no publication', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-soft-maintenance-'))
  const mod = await plugin('hot-cold-soft-maintenance')
  const file = path.join(root, 'storages', 'agent_teams.json')
  let armGate = false
  let gated = false
  const sweepEntered = deferred()
  const releaseSweep = deferred()
  let unlinks = 0
  const store = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdRetentionSoftFiles: 1,
    hotColdRetentionHardFiles: 64,
    hotColdRetentionSoftBytes: 16 * 1024 * 1024,
    hotColdRetentionHardBytes: 32 * 1024 * 1024,
    async hotColdFaultInjector(stage) {
      if (armGate && !gated && stage === 'before-retention-sweep') {
        gated = true
        sweepEntered.resolve()
        await releaseSweep.promise
      }
      if (stage.startsWith('before-retention-unlink:')) unlinks += 1
    }
  })
  try {
    await store.init()
    await mod.createTeam(store, { id: 'root-soft-maintenance', options: { provider: 'test', model: 'test' } }, { objective: 'soft maintenance', leadName: 'Lead' })
    let publications = 0
    const unsubscribe = store.subscribe(() => { publications += 1 })
    for (let index = 0; index < 12; index += 1) {
      await mutateActiveName(store, index)
      const maintenance = store.storageDiagnostics().retention.maintenance
      if (maintenance?.requested || maintenance?.scheduled || maintenance?.running) break
    }
    const beforeMaintenance = store.storageDiagnostics()
    assert.ok(beforeMaintenance.retention.debtFiles >= beforeMaintenance.retention.policy.softFiles)
    assert.ok(beforeMaintenance.retention.maintenance.requested || beforeMaintenance.retention.maintenance.scheduled)
    const generation = beforeMaintenance.generation
    const expectedPublications = publications
    armGate = true
    await sweepEntered.promise
    assert.equal(store.storageDiagnostics().generation, generation, 'soft cleanup starts only after the pointer-visible mutation returned')

    const foreground = store.read(document => document.teams.find(team => team.state !== 'closed').name)
    releaseSweep.resolve()
    assert.equal(await foreground, `Generation ${generation - 2}`)
    assert.equal(unlinks, 0, 'foreground arrival cancels validation before the first unlink')
    await waitForRetentionMaintenance(store)
    const settled = store.storageDiagnostics().retention
    assert.ok(settled.lastSweep.deletedFiles > 0)
    assert.ok(settled.debtFiles < settled.policy.softFiles)
    assert.equal(publications, expectedPublications, 'maintenance never emits a Store publication')
    unsubscribe()
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('close cancels queued or running soft retention without post-close deletion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-soft-close-'))
  const mod = await plugin('hot-cold-soft-close')
  const file = path.join(root, 'storages', 'agent_teams.json')
  let armGate = false
  const sweepEntered = deferred()
  const releaseSweep = deferred()
  let unlinks = 0
  const store = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdRetentionSoftFiles: 1,
    hotColdRetentionHardFiles: 64,
    hotColdRetentionSoftBytes: 16 * 1024 * 1024,
    hotColdRetentionHardBytes: 32 * 1024 * 1024,
    async hotColdFaultInjector(stage) {
      if (armGate && stage === 'before-retention-sweep') {
        sweepEntered.resolve()
        await releaseSweep.promise
      }
      if (stage.startsWith('before-retention-unlink:')) unlinks += 1
    }
  })
  try {
    await store.init()
    await mod.createTeam(store, { id: 'root-soft-close', options: { provider: 'test', model: 'test' } }, { objective: 'soft close', leadName: 'Lead' })
    for (let index = 0; index < 12; index += 1) {
      await mutateActiveName(store, index)
      const maintenance = store.storageDiagnostics().retention.maintenance
      if (maintenance?.requested || maintenance?.scheduled || maintenance?.running) break
    }
    assert.ok(store.storageDiagnostics().retention.maintenance?.scheduled)
    armGate = true
    await sweepEntered.promise
    const beforeClose = await directorySnapshot(`${file}.ledger`)
    store.close()
    releaseSweep.resolve()
    await waitForRetentionMaintenance(store)
    assert.equal(unlinks, 0)
    assert.deepEqual(await directorySnapshot(`${file}.ledger`), beforeClose)
  } finally {
    store.close()
    releaseSweep.resolve()
    await rm(root, { recursive: true, force: true })
  }
})

test('146-team active mutation stays below the 75ms p95 and 30 percent write budget', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-performance-'))
  const mod = await plugin('hot-cold-performance')
  const { file, bytes: legacyBytes } = await createBulkV8Fixture(mod, root)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    await store.init()
    let publications = 0
    let observedActiveCount = 0
    const unsubscribe = store.subscribe(document => {
      publications += 1
      observedActiveCount = document.teams.filter(team => team.state !== 'closed').length
    })
    const samples = []
    for (let index = 0; index < 45; index += 1) {
      const started = performance.now()
      await store.mutate(document => {
        const team = document.teams.find(candidate => candidate.id === 'team-145')
        team.name = `Active ${index}`
        team.updatedAt = new Date(Date.parse(team.updatedAt) + 1).toISOString()
      })
      if (index >= 5) samples.push(performance.now() - started)
    }
    samples.sort((left, right) => left - right)
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]
    const diagnostics = store.storageDiagnostics()
    t.diagnostic(`full mutate p95=${p95.toFixed(2)}ms; active bytes=${diagnostics.lastMutation.artifactBytes}/${legacyBytes} (${(diagnostics.lastMutation.artifactBytes / legacyBytes * 100).toFixed(2)}%)`)
    assert.ok(p95 < 75, `full mutate p95 ${p95.toFixed(2)}ms must remain below 75ms`)
    assert.ok(diagnostics.lastMutation.artifactBytes < legacyBytes * 0.3,
      `active mutation wrote ${diagnostics.lastMutation.artifactBytes}/${legacyBytes} bytes`)
    assert.equal(diagnostics.lastMutation.changedTeamCount, 1)
    assert.equal(diagnostics.lastMutation.catalogBytes, 0, 'an active-only mutation reuses the immutable closed catalog')
    assert.equal(diagnostics.retainedClosedDetails, 0)
    assert.equal(publications, 45)
    assert.equal(observedActiveCount, 1)
    unsubscribe()
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('each hot/cold write-boundary crash restarts to a complete old or new generation', async t => {
  const boundaries = ['after-closed-shard', 'after-closed-catalog', 'after-hot-document', 'after-manifest-document', 'before-manifest-switch', 'after-manifest-switch']
  for (const boundary of boundaries) await t.test(boundary, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-${boundary}-`))
    const mod = await plugin(`hot-cold-${boundary}`)
    const file = path.join(root, 'storages', 'agent_teams.json')
    let armed = false
    const store = new mod.AgentTeamsStore(file, {
      enabled: true,
      hotColdStore: true,
      hotColdFaultInjector(stage) { if (armed && stage === boundary) throw new Error(`injected ${boundary}`) }
    })
    try {
      await store.init()
      const created = await mod.createTeam(store, { id: 'root-crash', options: { provider: 'test', model: 'test' } }, { objective: 'crash matrix', leadName: 'Lead' })
      await store.mutate(document => { document.teams[0].members[0].state = 'ready' })
      const before = store.storageDiagnostics().generation
      armed = true
      await assert.rejects(store.mutate(document => forceClose(document.teams.find(team => team.id === created.id))), new RegExp(`injected ${boundary}`))
      store.close()

      const restarted = new mod.AgentTeamsStore(file)
      try {
        const snapshot = await restarted.init()
        const switched = boundary === 'after-manifest-switch'
        assert.equal(restarted.storageDiagnostics().generation, switched ? before + 1 : before)
        assert.equal(snapshot.teams[0].state, switched ? 'closed' : 'active')
        assert.equal(JSON.parse(await readFile(file, 'utf8')).teams[0].state, 'active', 'v8 migration source remains immutable across every crash prefix')
      } finally {
        restarted.close()
      }
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('promotion-marker interruption leaves the committed pointer restartable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-marker-crash-'))
  const mod = await plugin('hot-cold-marker-crash')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const interrupted = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdFaultInjector(stage) { if (stage === 'after-promotion-marker') throw new Error('injected promotion marker') }
  })
  try {
    await interrupted.init()
    await assert.rejects(mod.createTeam(interrupted, { id: 'root-marker', options: { provider: 'test', model: 'test' } }, { objective: 'marker crash', leadName: 'Lead' }), /injected promotion marker/u)
    assert.equal(existsSync(path.join(`${file}.ledger`, 'current.json')), true)
    assert.equal(JSON.parse(await readFile(`${file}.promoted.json`, 'utf8')).phase, 'committed')
  } finally {
    interrupted.close()
  }
  const recovered = new mod.AgentTeamsStore(file)
  try {
    const snapshot = await recovered.init()
    assert.equal(snapshot.teams.length, 1)
    assert.equal(recovered.storageDiagnostics().mode, 'hot-cold')
  } finally {
    recovered.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('prepared sibling sentinel recovers copy-only after the entire partial ledger is removed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-prepared-recovery-'))
  const mod = await plugin('prepared-recovery')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const interrupted = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdFaultInjector(stage) { if (stage === 'after-promotion-prepared') throw new Error('injected prepared sentinel') }
  })
  try {
    await interrupted.init()
    await assert.rejects(mod.createTeam(interrupted, { id: 'root-prepared', options: { provider: 'test', model: 'test' } }, { objective: 'prepared recovery', leadName: 'Lead' }), /injected prepared sentinel/u)
    const sourceBytes = await readFile(file)
    const sentinelPath = `${file}.promoted.json`
    assert.equal(JSON.parse(await readFile(sentinelPath, 'utf8')).phase, 'prepared')
    assert.equal(existsSync(path.join(`${file}.ledger`, 'current.json')), false)
    await rm(`${file}.ledger`, { recursive: true, force: true })
    interrupted.close()

    const recovered = new mod.AgentTeamsStore(file, { hotColdStore: false })
    try {
      const snapshot = await recovered.init()
      assert.equal(snapshot.teams.length, 1)
      assert.equal(recovered.storageDiagnostics().mode, 'hot-cold')
      assert.equal(JSON.parse(await readFile(sentinelPath, 'utf8')).phase, 'committed')
      assert.deepEqual(await readFile(file), sourceBytes)
    } finally {
      recovered.close()
    }
  } finally {
    interrupted.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('pointer plus prepared sentinel validates every artifact before becoming committed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-prepared-pointer-'))
  const mod = await plugin('prepared-pointer')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const interrupted = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdFaultInjector(stage) { if (stage === 'after-manifest-switch') throw new Error('injected pointer before sentinel commit') }
  })
  try {
    await interrupted.init()
    await assert.rejects(mod.createTeam(interrupted, { id: 'root-prepared-pointer', options: { provider: 'test', model: 'test' } }, { objective: 'prepared pointer', leadName: 'Lead' }), /injected pointer before sentinel commit/u)
    const sentinelPath = `${file}.promoted.json`
    const sentinelBytes = await readFile(sentinelPath)
    assert.equal(JSON.parse(sentinelBytes).phase, 'prepared')
    const ledger = await currentLedgerState(file)
    await writeFile(artifactPath(ledger.root, ledger.manifest.hot.path), '{"corrupt":true}\n')
    interrupted.close()

    const rejected = new mod.AgentTeamsStore(file, { hotColdStore: false })
    try {
      await assert.rejects(rejected.init(), /artifact integrity mismatch/u)
      assert.deepEqual(await readFile(sentinelPath), sentinelBytes, 'validation failure cannot commit the sentinel')
    } finally {
      rejected.close()
    }
  } finally {
    interrupted.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy inner markers and pointer-only ledgers migrate to the sibling committed sentinel', async t => {
  for (const mode of ['inner-marker', 'pointer-only']) await t.test(mode, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-legacy-${mode}-`))
    const mod = await plugin(`legacy-${mode}`)
    const fixture = await createBulkV8Fixture(mod, root, 18)
    const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
    try {
      await store.init()
      const ledger = await currentLedgerState(fixture.file)
      store.close()
      await rm(`${fixture.file}.promoted.json`)
      let innerBytes
      if (mode === 'inner-marker') {
        innerBytes = Buffer.from(`${JSON.stringify({ version: 1, sourceV8Hash: ledger.manifest.sourceV8.hash })}\n`)
        await writeFile(path.join(ledger.root, 'promoted.json'), innerBytes)
      }
      const migrated = new mod.AgentTeamsStore(fixture.file, { hotColdStore: false })
      try {
        await migrated.init()
        const sentinel = JSON.parse(await readFile(`${fixture.file}.promoted.json`, 'utf8'))
        assert.equal(sentinel.phase, 'committed')
        assert.deepEqual(sentinel.sourceV8, ledger.manifest.sourceV8)
        if (innerBytes !== undefined) assert.deepEqual(await readFile(path.join(ledger.root, 'promoted.json')), innerBytes)
      } finally {
        migrated.close()
      }
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('prepared promotion rejects changed source and noncanonical or conflicting sentinels', async t => {
  for (const mode of ['changed-source', 'noncanonical', 'conflicting']) await t.test(mode, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-prepared-${mode}-`))
    const mod = await plugin(`prepared-${mode}`)
    const file = path.join(root, 'storages', 'agent_teams.json')
    const interrupted = new mod.AgentTeamsStore(file, {
      enabled: true,
      hotColdStore: true,
      hotColdFaultInjector(stage) { if (stage === 'after-promotion-prepared') throw new Error('prepared') }
    })
    try {
      await interrupted.init()
      await assert.rejects(mod.createTeam(interrupted, { id: `root-${mode}`, options: { provider: 'test', model: 'test' } }, { objective: `prepared ${mode}`, leadName: 'Lead' }), /prepared/u)
      const sentinelPath = `${file}.promoted.json`
      const sentinel = JSON.parse(await readFile(sentinelPath, 'utf8'))
      if (mode === 'changed-source') await writeFile(file, Buffer.concat([await readFile(file), Buffer.from(' ')]))
      else if (mode === 'noncanonical') await writeFile(sentinelPath, ` ${JSON.stringify(sentinel)}\n`)
      else {
        sentinel.sourceV8 = { path: `legacy/v8-${'0'.repeat(64)}.json`, hash: '0'.repeat(64), bytes: sentinel.sourceV8.bytes }
        await writeFile(sentinelPath, `${JSON.stringify(sentinel)}\n`)
      }
      interrupted.close()
      const rejected = new mod.AgentTeamsStore(file, { hotColdStore: false })
      try {
        await assert.rejects(rejected.init(), /source|sentinel|noncanonical|integrity/u)
      } finally {
        rejected.close()
      }
    } finally {
      interrupted.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('a vanished committed pointer never falls back to the stale v8 source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-pointer-loss-'))
  const mod = await plugin('hot-cold-pointer-loss')
  const { file } = await createBulkV8Fixture(mod, root, 18)
  const store = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    await store.init()
    store.close()
    await rm(path.join(`${file}.ledger`, 'current.json'))
    const restarted = new mod.AgentTeamsStore(file, { hotColdStore: false })
    try {
      await assert.rejects(restarted.init(), /manifest pointer disappeared/u)
    } finally {
      restarted.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('a committed sibling sentinel detects deletion of the entire ledger even when hot-cold is disabled', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-ledger-loss-'))
  const mod = await plugin('hot-cold-ledger-loss')
  const fixture = await createBulkV8Fixture(mod, root, 18)
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
  try {
    await store.init()
    const sourceBytes = await readFile(fixture.file)
    const sentinelBytes = await readFile(`${fixture.file}.promoted.json`)
    store.close()
    await rm(`${fixture.file}.ledger`, { recursive: true, force: true })
    const restarted = new mod.AgentTeamsStore(fixture.file, { hotColdStore: false })
    try {
      await assert.rejects(restarted.init(), /manifest pointer disappeared/u)
      assert.deepEqual(await readFile(fixture.file), sourceBytes)
      assert.deepEqual(await readFile(`${fixture.file}.promoted.json`), sentinelBytes)
    } finally {
      restarted.close()
    }
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('source-copy interruption leaves v8 authoritative and a later promotion succeeds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-source-copy-'))
  const mod = await plugin('hot-cold-source-copy')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const interrupted = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdFaultInjector(stage) { if (stage === 'after-v8-source-copy') throw new Error('injected source copy') }
  })
  try {
    await interrupted.init()
    await assert.rejects(mod.createTeam(interrupted, { id: 'root-source', options: { provider: 'test', model: 'test' } }, { objective: 'source copy', leadName: 'Lead' }), /injected source copy/u)
    assert.equal(existsSync(`${file}.ledger${path.sep}current.json`), false)
    assert.equal(JSON.parse(await readFile(file, 'utf8')).teams.length, 1)
  } finally {
    interrupted.close()
  }
  const recovered = new mod.AgentTeamsStore(file, { hotColdStore: true })
  try {
    const snapshot = await recovered.init()
    assert.equal(recovered.storageDiagnostics().mode, 'hot-cold')
    assert.equal(snapshot.teams.length, 1)
  } finally {
    recovered.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('retention stays bounded through 500 mutations, preserves protected artifacts, and supports two rollbacks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-bounded-'))
  const mod = await plugin('retention-bounded')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const store = new mod.AgentTeamsStore(file, { enabled: true, hotColdStore: true })
  let restarted
  let verified
  try {
    await store.init()
    const created = await mod.createTeam(store, { id: 'root-retention', options: { provider: 'test', model: 'test' } }, { objective: 'retention fixture', leadName: 'Lead' })
    const ledger = await currentLedgerState(file)
    const sourceBytes = await readFile(file)
    const sentinelBytes = await readFile(`${file}.promoted.json`)
    const legacyBytes = await readFile(artifactPath(ledger.root, ledger.manifest.sourceV8.path))
    const innerMarkerPath = path.join(ledger.root, 'promoted.json')
    const innerMarkerBytes = Buffer.from(`${JSON.stringify({ version: 1, sourceV8Hash: ledger.manifest.sourceV8.hash })}\n`)
    await writeFile(innerMarkerPath, innerMarkerBytes)
    const foreignPath = path.join(ledger.root, 'hot', 'foreign.txt')
    const noncanonicalPath = path.join(ledger.root, 'hot', `hot-0-${'0'.repeat(64)}.json`)
    await writeFile(foreignPath, 'foreign\n')
    await writeFile(noncanonicalPath, 'foreign noncanonical\n')
    let publications = 0
    const unsubscribe = store.subscribe(() => { publications += 1 })
    const beforeRevision = store.snapshot().teams.find(team => team.id === created.id).revision
    for (let index = 0; index < 100; index += 1) await mutateActiveName(store, index)
    await waitForRetentionMaintenance(store)
    const after100 = await directoryUsage(ledger.root)
    for (let index = 100; index < 500; index += 1) await mutateActiveName(store, index)
    await waitForRetentionMaintenance(store)
    const after500 = await directoryUsage(ledger.root)
    unsubscribe()
    t.diagnostic(`retention usage: 100 mutations=${after100.files} files/${after100.bytes} bytes; 500 mutations=${after500.files} files/${after500.bytes} bytes`)

    assert.ok(after100.files <= 64, `100-mutation retention used ${after100.files} files`)
    assert.ok(after500.files <= 64, `500-mutation retention used ${after500.files} files`)
    assert.ok(after500.bytes <= after100.bytes + 1024 * 1024, `retention grew ${after100.bytes} -> ${after500.bytes}`)
    assert.equal(publications, 500, 'GC emits no extra store publication')
    assert.equal(store.snapshot().teams.find(team => team.id === created.id).revision, beforeRevision + 500)
    assert.ok(store.storageDiagnostics().retention.lastSweep.deletedFiles > 0)
    assert.equal(existsSync(foreignPath), true)
    assert.equal(existsSync(noncanonicalPath), true)
    assert.deepEqual(await readFile(file), sourceBytes)
    assert.deepEqual(await readFile(`${file}.promoted.json`), sentinelBytes)
    assert.deepEqual(await readFile(innerMarkerPath), innerMarkerBytes)
    assert.deepEqual(await readFile(artifactPath(ledger.root, ledger.manifest.sourceV8.path)), legacyBytes)

    await store.rollbackHotColdManifest()
    assert.equal(store.snapshot().teams[0].name, 'Generation 498')
    await store.rollbackHotColdManifest()
    assert.equal(store.snapshot().teams[0].name, 'Generation 497')
    const rolled = await currentLedgerState(file)
    const predecessor = JSON.parse(await readFile(artifactPath(rolled.root, rolled.manifest.previous.path), 'utf8'))
    assert.equal(predecessor.generation, rolled.manifest.previous.generation)

    store.close()
    restarted = new mod.AgentTeamsStore(file)
    const restartedView = await restarted.init()
    assert.equal(restartedView.teams[0].name, 'Generation 497')
    await restarted.mutate(document => { document.teams[0].name = 'mutated after two rollback restarts' })
    restarted.close()
    verified = new mod.AgentTeamsStore(file)
    const verifiedView = await verified.init()
    assert.equal(verifiedView.teams[0].name, 'mutated after two rollback restarts')
    assert.deepEqual(await readFile(file), sourceBytes)
  } finally {
    store.close()
    restarted?.close()
    verified?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('retention preserves restart-safe two-rollback depth plus the next manifest across an exact sweep', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-depth-'))
  const mod = await plugin('retention-depth')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const store = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdRetentionSoftFiles: 1,
    hotColdRetentionHardFiles: 64,
    hotColdRetentionSoftBytes: 1,
    hotColdRetentionHardBytes: 16 * 1024 * 1024
  })
  let restarted
  let verified
  try {
    await store.init()
    await mod.createTeam(store, { id: 'root-retention-depth', options: { provider: 'test', model: 'test' } }, { objective: 'retention depth', leadName: 'Lead' })
    assert.deepEqual(
      [store.storageDiagnostics().retention.debtFiles, store.storageDiagnostics().retention.debtBytes],
      [0, 0],
      'forced generation-one promotion charges no live artifacts as garbage'
    )
    for (let index = 0; index < 8; index += 1) await mutateActiveName(store, index)
    await waitForRetentionMaintenance(store)
    assert.ok(store.storageDiagnostics().retention.lastSweep.deletedFiles > 0)

    const ledger = await currentLedgerState(file)
    const chain = [ledger.manifest]
    for (let depth = 1; depth <= 5; depth += 1) {
      const descriptor = chain.at(-1).previous
      assert.ok(descriptor, `missing retained manifest descriptor at depth ${depth}`)
      chain.push(JSON.parse(await readFile(artifactPath(ledger.root, descriptor.path), 'utf8')))
    }
    for (const manifest of chain.slice(0, 5)) {
      assert.equal(existsSync(artifactPath(ledger.root, manifest.hot.path)), true, `generation ${manifest.generation} must remain complete`)
      assert.equal(existsSync(artifactPath(ledger.root, manifest.closedCatalog.path)), true)
    }
    assert.equal(existsSync(artifactPath(ledger.root, chain[5].hot.path)), false, 'normal current retains two complete rollback-reserve generations plus the next manifest')

    await store.rollbackHotColdManifest()
    await store.rollbackHotColdManifest()
    const rolled = await currentLedgerState(file)
    assert.equal(rolled.pointer.retentionFloorGeneration, rolled.pointer.generation - 2, 'two rollbacks consume the reserve but preserve two complete predecessors')
    const rolledChain = [rolled.manifest]
    for (let depth = 1; depth <= 3; depth += 1) {
      const descriptor = rolledChain.at(-1).previous
      assert.ok(descriptor, `rolled current is missing manifest depth ${depth}`)
      rolledChain.push(JSON.parse(await readFile(artifactPath(rolled.root, descriptor.path), 'utf8')))
    }
    for (const manifest of rolledChain.slice(0, 3)) {
      assert.equal(existsSync(artifactPath(rolled.root, manifest.hot.path)), true, `rolled generation ${manifest.generation} must remain complete`)
      assert.equal(existsSync(artifactPath(rolled.root, manifest.closedCatalog.path)), true)
    }
    assert.equal(existsSync(artifactPath(rolled.root, rolledChain[3].hot.path)), false, 'only the third predecessor is manifest-only after two rollbacks')
    const rolledPointerBytes = await readFile(path.join(rolled.root, 'current.json'))
    await assert.rejects(store.rollbackHotColdManifest(), error => error.code === 'AGENT_TEAMS_MANIFEST_ROLLBACK_UNAVAILABLE')
    assert.deepEqual(await readFile(path.join(rolled.root, 'current.json')), rolledPointerBytes)
    store.close()
    restarted = new mod.AgentTeamsStore(file, {
      hotColdStore: true,
      hotColdRetentionSoftFiles: 1,
      hotColdRetentionHardFiles: 64,
      hotColdRetentionSoftBytes: 1,
      hotColdRetentionHardBytes: 16 * 1024 * 1024
    })
    const restartedView = await restarted.init()
    assert.equal(restartedView.teams[0].name, 'Generation 5')
    const sweepBeforeMutation = restarted.storageDiagnostics().retention.lastSweep?.at
    for (let index = 0; index < 3; index += 1) await restarted.mutate(document => { document.teams[0].name = `post-depth-rollback mutation ${index}` })
    await waitForRetentionMaintenance(restarted)
    const sweepAfterMutation = restarted.storageDiagnostics().retention.lastSweep
    assert.ok(sweepAfterMutation.deletedFiles > 0)
    assert.notEqual(sweepAfterMutation.at, sweepBeforeMutation, 'post-rollback mutations advance far enough to run a fresh exact sweep')
    restarted.close()
    verified = new mod.AgentTeamsStore(file)
    assert.equal((await verified.init()).teams[0].name, 'post-depth-rollback mutation 2')
    const verifiedLedger = await currentLedgerState(file)
    const verifiedChain = [verifiedLedger.manifest]
    for (let depth = 1; depth <= 2; depth += 1) {
      const descriptor = verifiedChain.at(-1).previous
      assert.ok(descriptor, `post-rollback mutation is missing complete predecessor ${depth}`)
      const manifest = JSON.parse(await readFile(artifactPath(verifiedLedger.root, descriptor.path), 'utf8'))
      assert.equal(existsSync(artifactPath(verifiedLedger.root, manifest.hot.path)), true)
      assert.equal(existsSync(artifactPath(verifiedLedger.root, manifest.closedCatalog.path)), true)
      verifiedChain.push(manifest)
    }
  } finally {
    store.close()
    restarted?.close()
    verified?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('124 closed shards stay live through 500 active mutations, periodic scans, and two rollbacks', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-live-baseline-'))
  const mod = await plugin('retention-live-baseline')
  const fixture = await createBulkV8Fixture(mod, root, 125, { distinctProjects: true })
  let scans = 0
  let sweeps = 0
  let validationReads
  let lastValidationReads = new Map()
  const store = new mod.AgentTeamsStore(fixture.file, {
    hotColdStore: true,
    hotColdFaultInjector(stage) {
      if (stage === 'before-retention-scan') scans += 1
      if (stage === 'before-retention-sweep') {
        sweeps += 1
        validationReads = new Map()
      } else if (stage.startsWith('before-retention-artifact-read:') && validationReads !== undefined) {
        const reference = stage.slice('before-retention-artifact-read:'.length)
        validationReads.set(reference, (validationReads.get(reference) ?? 0) + 1)
      } else if (stage === 'after-retention-sweep' && validationReads !== undefined) {
        lastValidationReads = validationReads
        validationReads = undefined
      }
    }
  })
  let restarted
  try {
    await store.init()
    const ledgerRoot = `${fixture.file}.ledger`
    const baseline = await directoryUsage(ledgerRoot)
    const initial = store.storageDiagnostics()
    assert.equal(initial.closedShardCount, 124)
    assert.deepEqual([initial.retention.debtFiles, initial.retention.debtBytes, initial.retention.blocked], [0, 0, false])
    assert.ok(baseline.files > initial.retention.policy.softFiles, 'the legal live baseline itself exceeds the garbage-only soft file watermark')

    await assert.doesNotReject(async () => {
      for (let index = 0; index < 100; index += 1) await mutateActiveName(store, index)
    }, '100 active-only mutations cannot be hard-blocked by the 124 retained closed shards')
    await waitForRetentionMaintenance(store)
    const after100 = await directoryUsage(ledgerRoot)
    const diagnostics100 = store.storageDiagnostics()
    assert.equal(diagnostics100.retention.blocked, false)
    const boundedLiveGenerationFileOverhead = 16
    const boundedLiveGenerationByteOverhead = 1024 * 1024
    assert.ok(after100.files - baseline.files <= diagnostics100.retention.policy.softFiles + boundedLiveGenerationFileOverhead)
    assert.ok(after100.bytes - baseline.bytes <= diagnostics100.retention.policy.softBytes + boundedLiveGenerationByteOverhead)
    const scansAfter100 = scans

    await assert.doesNotReject(async () => {
      for (let index = 100; index < 500; index += 1) await mutateActiveName(store, index)
    }, '500 active-only mutations cannot be hard-blocked by retained live artifacts')
    await waitForRetentionMaintenance(store)
    const after500 = await directoryUsage(ledgerRoot)
    const diagnostics = store.storageDiagnostics()
    const fileGrowth = after500.files - baseline.files
    const byteGrowth = after500.bytes - baseline.bytes
    t.diagnostic(`124-closed baseline=${baseline.files}/${baseline.bytes}; 100=${after100.files}/${after100.bytes}; 500=${after500.files}/${after500.bytes}; growth=${fileGrowth}/${byteGrowth}; scans=${scans}; sweeps=${sweeps}; debt=${diagnostics.retention.debtFiles}/${diagnostics.retention.debtBytes}`)
    assert.equal(diagnostics.closedShardCount, 124)
    assert.equal(diagnostics.retention.blocked, false)
    assert.ok(fileGrowth >= 0 && fileGrowth <= diagnostics.retention.policy.softFiles + boundedLiveGenerationFileOverhead, `managed file growth ${fileGrowth} must stay relative to the live baseline plus bounded retained generations`)
    assert.ok(byteGrowth >= 0 && byteGrowth <= diagnostics.retention.policy.softBytes + boundedLiveGenerationByteOverhead, `managed byte growth ${byteGrowth} must stay relative to the live baseline plus bounded retained generations`)
    assert.ok(diagnostics.retention.debtFiles < diagnostics.retention.policy.softFiles)
    assert.ok(diagnostics.retention.debtBytes < diagnostics.retention.policy.softBytes)
    assert.ok(diagnostics.retention.debtFiles < diagnostics.retention.policy.hardFiles)
    assert.ok(diagnostics.retention.debtBytes < diagnostics.retention.policy.hardBytes)
    assert.ok(scansAfter100 < 10, `100 mutations performed ${scansAfter100} managed-directory scans`)
    assert.ok(sweeps >= 4 && sweeps <= 7, `expected quiet-window plus hard-gate sweeps, received ${sweeps}`)
    assert.ok(scans <= sweeps + 2, `managed-directory scans ${scans} must be bounded by exact sweeps ${sweeps}`)
    assert.ok(scans < 500 / 10, 'neither full validation nor directory scanning may run on every mutation')

    const cachedLedger = await currentLedgerState(fixture.file)
    const cachedCatalog = JSON.parse(await readFile(artifactPath(cachedLedger.root, cachedLedger.manifest.closedCatalog.path), 'utf8'))
    assert.ok([...lastValidationReads.values()].every(count => count === 1), 'the full-validation descriptor cache reads every content-addressed artifact at most once')
    assert.equal(lastValidationReads.get(cachedLedger.manifest.sourceV8.path), 1, 'one full sweep verifies the shared immutable source copy once')
    assert.equal(lastValidationReads.get(cachedLedger.manifest.closedCatalog.path), 1, 'one full sweep parses the shared closed catalog once')
    for (const entry of cachedCatalog.entries) {
      assert.equal(lastValidationReads.get(entry.shard.path), 1, `one full sweep reads shared shard ${entry.id} once across retained generations`)
    }

    const generation = diagnostics.generation
    await store.rollbackHotColdManifest()
    assert.equal(store.storageDiagnostics().generation, generation - 1)
    assert.equal(store.view().teams.find(team => team.state !== 'closed').name, 'Generation 498')
    await store.rollbackHotColdManifest()
    assert.equal(store.storageDiagnostics().generation, generation - 2)
    assert.equal(store.view().teams.find(team => team.state !== 'closed').name, 'Generation 497')
    store.close()

    restarted = new mod.AgentTeamsStore(fixture.file)
    const restartedView = await restarted.init()
    assert.equal(restartedView.teams.find(team => team.state !== 'closed').name, 'Generation 497')
    const hydrated = restarted.snapshot()
    const expectedClosed = fixture.document.teams.filter(team => team.state === 'closed')
    const actualClosed = new Map(hydrated.teams.filter(team => team.state === 'closed').map(team => [team.id, team]))
    assert.equal(actualClosed.size, 124)
    for (const expected of expectedClosed) {
      const actual = actualClosed.get(expected.id)
      assert.ok(actual, `missing retained closed shard ${expected.id}`)
      assert.deepEqual(
        [actual.id, actual.name, actual.state, actual.projectKey, actual.closure.closedAt],
        [expected.id, expected.name, expected.state, expected.projectKey, expected.closure.closedAt]
      )
    }
    assert.equal(restarted.storageDiagnostics().closedShardReadCount, 124, 'fresh hydration reads every legal closed shard exactly once')
  } finally {
    store.close()
    restarted?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('a legitimate live ledger larger than the byte hard watermark never becomes garbage debt', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-large-live-'))
  const mod = await plugin('retention-large-live')
  const fixture = await createBulkV8Fixture(mod, root, 4, { distinctProjects: true })
  const source = JSON.parse(await readFile(fixture.file, 'utf8'))
  const body = 'x'.repeat(60 * 1024)
  for (const team of source.teams.slice(0, 3)) team.messages = Array.from({ length: 100 }, (_, index) => ({
    id: `large-live-${team.id}-${index}`,
    fromSessionId: team.rootLeadSessionId,
    toSessionId: team.rootLeadSessionId,
    body,
    createdAt: team.updatedAt,
    status: 'delivered',
    deliveredAt: team.updatedAt
  }))
  await writeFile(fixture.file, `${JSON.stringify(source)}\n`)
  const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true, hotColdRetentionSoftBytes: 1 })
  try {
    await store.init()
    const initial = store.storageDiagnostics()
    const usage = await directoryUsage(`${fixture.file}.ledger`)
    t.diagnostic(`large live baseline=${usage.bytes} bytes; hard garbage watermark=${initial.retention.policy.hardBytes} bytes`)
    assert.ok(usage.bytes > initial.retention.policy.hardBytes)
    assert.equal(initial.retention.debtBytes, 0)
    assert.equal(initial.retention.debtFiles, 0)
    assert.equal(initial.retention.blocked, false)
    const ledger = await currentLedgerState(fixture.file)
    const catalog = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.closedCatalog.path), 'utf8'))
    await writeFile(artifactPath(ledger.root, catalog.entries[0].shard.path), '{"corrupt":true}\n')
    for (let index = 1; index <= 12 && store.storageDiagnostics().retention.lastSweep === undefined; index += 1) {
      await mutateActiveName(store, index)
      await waitForRetentionMaintenance(store)
    }
    const afterFailure = store.storageDiagnostics().retention
    assert.equal(afterFailure.lastSweep.validationFailed, true)
    assert.ok(afterFailure.debtBytes > 0, 'only now-unretained generation artifacts become garbage debt')
    assert.ok(afterFailure.debtBytes < afterFailure.policy.hardBytes, 'the 37 MiB retained live baseline is excluded from debt')
    assert.equal(afterFailure.blocked, false)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('failed artifact orphan refreshes before the live hard gate while semantic no-op stays scan-free', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-orphan-gate-'))
  const mod = await plugin('retention-orphan-gate')
  const file = path.join(root, 'storages', 'agent_teams.json')
  let failWrite = false, failUnlink = false, scans = 0, sweeps = 0
  const store = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdRetentionSoftFiles: 1,
    hotColdRetentionHardFiles: 1,
    hotColdRetentionSoftBytes: 16 * 1024 * 1024,
    hotColdRetentionHardBytes: 32 * 1024 * 1024,
    hotColdFaultInjector(stage) {
      if (stage === 'before-retention-scan') scans += 1
      if (stage === 'before-retention-sweep') sweeps += 1
      if (failWrite && stage === 'after-hot-document') {
        failWrite = false
        throw new Error('injected artifact write failure')
      }
      if (failUnlink && stage.startsWith('before-retention-unlink:')) throw new Error('injected orphan unlink failure')
    }
  })
  try {
    await store.init()
    await mod.createTeam(store, { id: 'root-retention-orphan', options: { provider: 'test', model: 'test' } }, { objective: 'retention orphan gate', leadName: 'Lead' })
    const generation = store.storageDiagnostics().generation
    failWrite = true
    await assert.rejects(mutateActiveName(store, 1), /injected artifact write failure/u)
    assert.equal(store.storageDiagnostics().generation, generation)

    const ledgerRoot = `${file}.ledger`
    const beforeNoop = await directorySnapshot(ledgerRoot)
    const scansBeforeNoop = scans
    await store.mutate(() => undefined)
    assert.equal(scans, scansBeforeNoop, 'a semantic no-op never refreshes stale retention reachability')
    assert.deepEqual(await directorySnapshot(ledgerRoot), beforeNoop, 'a semantic no-op writes no artifact')

    failUnlink = true
    const pointerPath = path.join(ledgerRoot, 'current.json')
    const pointerBytes = await readFile(pointerPath)
    const pointerInfo = await stat(pointerPath, { bigint: true })
    await assert.rejects(mutateActiveName(store, 2), error => error.code === 'AGENT_TEAMS_LEDGER_RETENTION_BLOCKED')
    const afterInfo = await stat(pointerPath, { bigint: true })
    assert.deepEqual(await readFile(pointerPath), pointerBytes)
    assert.deepEqual(
      [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
      [pointerInfo.dev, pointerInfo.ino, pointerInfo.size, pointerInfo.mtimeNs, pointerInfo.ctimeNs]
    )
    assert.deepEqual(await directorySnapshot(ledgerRoot), beforeNoop, 'the hard gate rejects before any new artifact')
    const blocked = store.storageDiagnostics().retention
    assert.equal(blocked.debtFiles, 2, 'the fully settled parallel hot and manifest orphans are exact garbage debt')
    assert.equal(blocked.blocked, true)
    assert.equal(store.storageDiagnostics().generation, generation)
    assert.ok(scans > scansBeforeNoop)
    assert.ok(sweeps > 0)

    failUnlink = false
    await mutateActiveName(store, 3)
    assert.equal(store.storageDiagnostics().generation, generation + 1)
    assert.equal(store.storageDiagnostics().retention.blocked, false)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('post-switch retention validation failure is fail-open for the durable mutation and marks stale', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-post-commit-'))
  const mod = await plugin('retention-post-commit-fail-open')
  const file = path.join(root, 'storages', 'agent_teams.json')
  let arm = false, failAdvanceRead = false, scans = 0
  const store = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdFaultInjector(stage) {
      if (stage === 'before-retention-scan') scans += 1
      if (arm && stage === 'after-manifest-switch') {
        failAdvanceRead = true
        return
      }
      if (failAdvanceRead && stage.startsWith('before-retention-artifact-read:')) {
        arm = false
        failAdvanceRead = false
        throw new Error('injected post-commit retention read failure')
      }
    }
  })
  try {
    await store.init()
    await mod.createTeam(store, { id: 'root-retention-post-commit', options: { provider: 'test', model: 'test' } }, { objective: 'retention post commit', leadName: 'Lead' })
    const generation = store.storageDiagnostics().generation
    let publications = 0
    const unsubscribe = store.subscribe(() => { publications += 1 })
    arm = true
    await assert.doesNotReject(mutateActiveName(store, 1), 'retention maintenance cannot reject an already durable pointer switch')
    unsubscribe()
    assert.equal(store.storageDiagnostics().generation, generation + 1)
    assert.equal(store.snapshot().teams[0].name, 'Generation 1')
    assert.equal(JSON.parse(await readFile(path.join(`${file}.ledger`, 'current.json'), 'utf8')).generation, generation + 1)
    assert.equal(publications, 1)
    assert.match(store.storageDiagnostics().retention.lastError, /post-commit retention maintenance failed: injected post-commit retention read failure/u)
    assert.deepEqual(
      [store.storageDiagnostics().retention.debtFiles, store.storageDiagnostics().retention.debtBytes, store.storageDiagnostics().retention.blocked],
      [0, 0, false],
      'the skipped second adopt still performs exact-origin retention normalization after a post-commit failure'
    )

    const scansBeforeNoop = scans
    await store.mutate(() => undefined)
    assert.equal(scans, scansBeforeNoop, 'the stale marker does not make semantic no-ops scan')
    await mutateActiveName(store, 2)
    assert.ok(scans > scansBeforeNoop, 'the next real mutation refreshes stale reachability before writing')
    assert.equal(store.storageDiagnostics().generation, generation + 2)
    assert.equal(store.snapshot().teams[0].name, 'Generation 2')
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('retention validation failure deletes nothing and unlink failure blocks before another generation', async t => {
  await t.test('validation failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-validation-'))
    const mod = await plugin('retention-validation')
    const fixture = await createBulkV8Fixture(mod, root, 4)
    const store = new mod.AgentTeamsStore(fixture.file, {
      hotColdStore: true,
      hotColdRetentionSoftFiles: 1,
      hotColdRetentionHardFiles: 64,
      hotColdRetentionSoftBytes: 1,
      hotColdRetentionHardBytes: 16 * 1024 * 1024
    })
    try {
      await store.init()
      for (let index = 0; index < 5; index += 1) await mutateActiveName(store, index)
      const ledger = await currentLedgerState(fixture.file)
      const catalog = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.closedCatalog.path), 'utf8'))
      await writeFile(artifactPath(ledger.root, catalog.entries[0].shard.path), '{"corrupt":true}\n')
      const before = await directorySnapshot(ledger.root)
      await mutateActiveName(store, 6)
      await waitForRetentionMaintenance(store)
      const after = await directorySnapshot(ledger.root)
      for (const [reference, digest] of Object.entries(before)) if (reference !== 'current.json') assert.equal(after[reference], digest, `validation failure deleted or rewrote ${reference}`)
      assert.equal(store.storageDiagnostics().retention.lastSweep.validationFailed, true)
      assert.equal(store.storageDiagnostics().retention.lastSweep.deletedFiles, 0)
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  await t.test('hard watermark', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-blocked-'))
    const mod = await plugin('retention-blocked')
    const file = path.join(root, 'storages', 'agent_teams.json')
    let failUnlink = false
    const store = new mod.AgentTeamsStore(file, {
      enabled: true,
      hotColdStore: true,
      hotColdRetentionSoftFiles: 1,
      hotColdRetentionHardFiles: 2,
      hotColdRetentionSoftBytes: 1,
      hotColdRetentionHardBytes: 1024,
      hotColdFaultInjector(stage) { if (failUnlink && stage.startsWith('before-retention-unlink:')) throw new Error('injected unlink failure') }
    })
    try {
      await store.init()
      await mod.createTeam(store, { id: 'root-retention-blocked', options: { provider: 'test', model: 'test' } }, { objective: 'retention blocked', leadName: 'Lead' })
      failUnlink = true
      for (let index = 0; index < 8 && !store.storageDiagnostics().retention.blocked; index += 1) {
        await mutateActiveName(store, index)
        await waitForRetentionMaintenance(store)
      }
      assert.equal(store.storageDiagnostics().retention.blocked, true)
      const generation = store.storageDiagnostics().generation
      await assert.rejects(mutateActiveName(store, 99), error => error.code === 'AGENT_TEAMS_LEDGER_RETENTION_BLOCKED')
      assert.equal(store.storageDiagnostics().generation, generation, 'hard watermark rejects before a new generation')
      failUnlink = false
      await mutateActiveName(store, 100)
      assert.equal(store.storageDiagnostics().retention.blocked, false)
      assert.equal(store.storageDiagnostics().generation, generation + 1)
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('retention aborts deletion when an exact same-generation manifest branch replaces the validated pointer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-retention-pointer-race-'))
  const mod = await plugin('retention-pointer-race')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const pointerPath = path.join(`${file}.ledger`, 'current.json')
  let armPointerRace = false
  let switched = false
  let originalManifestHash
  let alternateManifestHash
  let restarted
  const store = new mod.AgentTeamsStore(file, {
    enabled: true,
    hotColdStore: true,
    hotColdRetentionSoftFiles: 1,
    hotColdRetentionHardFiles: 64,
    hotColdRetentionSoftBytes: 1,
    hotColdRetentionHardBytes: 16 * 1024 * 1024,
    async hotColdFaultInjector(stage) {
      if (!armPointerRace || switched || !stage.startsWith('before-retention-unlink:')) return
      const pointer = JSON.parse(await readFile(pointerPath, 'utf8'))
      const manifest = JSON.parse(await readFile(artifactPath(`${file}.ledger`, pointer.manifest.path), 'utf8'))
      originalManifestHash = pointer.manifest.hash
      const alternateManifest = { ...manifest, createdAt: new Date(Date.parse(manifest.createdAt) + 1).toISOString() }
      const alternateBytes = canonicalBuffer(alternateManifest)
      const alternateDescriptor = {
        path: `manifests/manifest-${pointer.generation}-${hash(alternateBytes)}.json`,
        hash: hash(alternateBytes),
        bytes: alternateBytes.length,
        generation: pointer.generation
      }
      alternateManifestHash = alternateDescriptor.hash
      await writeFile(artifactPath(`${file}.ledger`, alternateDescriptor.path), alternateBytes)
      await writeFile(pointerPath, canonicalBuffer({ ...pointer, manifest: alternateDescriptor }))
      switched = true
    }
  })
  try {
    await store.init()
    await mod.createTeam(store, { id: 'root-pointer-race', options: { provider: 'test', model: 'test' } }, { objective: 'pointer race', leadName: 'Lead' })
    const sourceBytes = await readFile(file)
    const sentinelBytes = await readFile(`${file}.promoted.json`)
    armPointerRace = true
    for (let index = 0; index < 8 && !switched; index += 1) {
      await mutateActiveName(store, index)
      await waitForRetentionMaintenance(store)
    }
    assert.equal(switched, true)
    assert.equal(store.storageDiagnostics().retention.lastSweep.aborted, true)
    assert.equal(store.storageDiagnostics().retention.lastSweep.deletedFiles, 0)
    assert.deepEqual(await readFile(file), sourceBytes)
    assert.deepEqual(await readFile(`${file}.promoted.json`), sentinelBytes)
    const diskPointer = JSON.parse(await readFile(pointerPath, 'utf8'))
    assert.equal(diskPointer.generation, store.storageDiagnostics().generation)
    assert.equal(diskPointer.manifest.hash, alternateManifestHash)
    assert.notEqual(diskPointer.manifest.hash, originalManifestHash)
    assert.equal(
      await store.read(document => document.teams.find(team => team.state !== 'closed').name),
      `Generation ${diskPointer.generation - 2}`,
      'the same live instance reloads the winning branch before its next foreground view'
    )
    store.close()
    restarted = new mod.AgentTeamsStore(file)
    let firstRestartManifestHash
    const restartAdopt = restarted._adoptHotColdPublication.bind(restarted)
    restarted._adoptHotColdPublication = (...args) => {
      firstRestartManifestHash ??= args[0].pointer.manifest.hash
      return restartAdopt(...args)
    }
    const restartedView = await restarted.init()
    assert.equal(firstRestartManifestHash, alternateManifestHash, 'restart first adopts the exact alternate same-generation branch')
    assert.ok(restarted.storageDiagnostics().generation >= diskPointer.generation)
    assert.equal(restartedView.teams.find(team => team.state !== 'closed').name, `Generation ${diskPointer.generation - 2}`)
  } finally {
    store.close()
    restarted?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('rollback pointer crash boundaries restart to the selected complete generation', async t => {
  for (const boundary of ['before-manifest-rollback', 'after-manifest-rollback']) await t.test(boundary, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-rollback-${boundary}-`))
    const mod = await plugin(`hot-cold-rollback-${boundary}`)
    const file = path.join(root, 'storages', 'agent_teams.json')
    let armed = false
    const store = new mod.AgentTeamsStore(file, {
      enabled: true,
      hotColdStore: true,
      hotColdFaultInjector(stage) { if (armed && stage === boundary) throw new Error(`injected ${boundary}`) }
    })
    try {
      await store.init()
      const created = await mod.createTeam(store, { id: 'root-rollback-crash', options: { provider: 'test', model: 'test' } }, { objective: 'rollback crash', leadName: 'Lead' })
      await store.mutate(document => { document.teams.find(team => team.id === created.id).name = 'new generation name' })
      armed = true
      await assert.rejects(store.rollbackHotColdManifest(), new RegExp(`injected ${boundary}`, 'u'))
      store.close()
      const restarted = new mod.AgentTeamsStore(file)
      try {
        const snapshot = await restarted.init()
        assert.equal(snapshot.teams[0].name, boundary === 'before-manifest-rollback' ? 'new generation name' : 'rollback crash')
      } finally {
        restarted.close()
      }
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('rollback validates every target artifact before switching the current pointer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-rollback-invalid-'))
  const mod = await plugin('hot-cold-rollback-invalid')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const store = new mod.AgentTeamsStore(file, { enabled: true, hotColdStore: true })
  try {
    await store.init()
    const created = await mod.createTeam(store, { id: 'root-invalid-rollback', options: { provider: 'test', model: 'test' } }, { objective: 'invalid rollback', leadName: 'Lead' })
    await store.mutate(document => { document.teams.find(team => team.id === created.id).name = 'current generation' })
    const ledgerRoot = `${file}.ledger`
    const pointerPath = path.join(ledgerRoot, 'current.json')
    const pointerBytes = await readFile(pointerPath)
    const pointer = JSON.parse(pointerBytes)
    const currentManifest = JSON.parse(await readFile(artifactPath(ledgerRoot, pointer.manifest.path), 'utf8'))
    const previousManifest = JSON.parse(await readFile(artifactPath(ledgerRoot, currentManifest.previous.path), 'utf8'))
    await writeFile(artifactPath(ledgerRoot, previousManifest.hot.path), '{"corrupt":true}\n')
    await assert.rejects(store.rollbackHotColdManifest(), /artifact integrity mismatch/u)
    assert.deepEqual(await readFile(pointerPath), pointerBytes)
    assert.equal(store.snapshot().teams[0].name, 'current generation')
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('rollback validates the next rollback manifest before switching the pointer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-rollback-next-manifest-'))
  const mod = await plugin('hot-cold-rollback-next-manifest')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const store = new mod.AgentTeamsStore(file, { enabled: true, hotColdStore: true })
  try {
    await store.init()
    const created = await mod.createTeam(store, { id: 'root-next-manifest', options: { provider: 'test', model: 'test' } }, { objective: 'next manifest', leadName: 'Lead' })
    await store.mutate(document => { document.teams.find(team => team.id === created.id).name = 'target generation' })
    await store.mutate(document => { document.teams.find(team => team.id === created.id).name = 'current generation' })
    const ledger = await currentLedgerState(file)
    const target = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.previous.path), 'utf8'))

    const malformedBytes = canonicalBuffer({ version: 1 })
    const malformedDescriptor = {
      path: `manifests/manifest-${target.previous.generation}-${hash(malformedBytes)}.json`,
      hash: hash(malformedBytes),
      bytes: malformedBytes.length,
      generation: target.previous.generation
    }
    await writeFile(artifactPath(ledger.root, malformedDescriptor.path), malformedBytes)
    target.previous = malformedDescriptor
    const targetBytes = canonicalBuffer(target)
    const targetDescriptor = {
      path: `manifests/manifest-${target.generation}-${hash(targetBytes)}.json`,
      hash: hash(targetBytes),
      bytes: targetBytes.length,
      generation: target.generation
    }
    await writeFile(artifactPath(ledger.root, targetDescriptor.path), targetBytes)
    ledger.manifest.previous = targetDescriptor
    const currentBytes = canonicalBuffer(ledger.manifest)
    const currentDescriptor = {
      path: `manifests/manifest-${ledger.manifest.generation}-${hash(currentBytes)}.json`,
      hash: hash(currentBytes),
      bytes: currentBytes.length,
      generation: ledger.manifest.generation
    }
    await writeFile(artifactPath(ledger.root, currentDescriptor.path), currentBytes)
    const pointerPath = path.join(ledger.root, 'current.json')
    await writeFile(pointerPath, canonicalBuffer({ version: 1, generation: ledger.manifest.generation, manifest: currentDescriptor }))
    const pointerBytes = await readFile(pointerPath)
    const pointerInfo = await stat(pointerPath, { bigint: true })
    let publications = 0
    const unsubscribe = store.subscribe(() => { publications += 1 })
    await assert.rejects(store.rollbackHotColdManifest(), /hot\/cold manifest is invalid/u)
    unsubscribe()
    const afterInfo = await stat(pointerPath, { bigint: true })
    assert.deepEqual(await readFile(pointerPath), pointerBytes)
    assert.deepEqual(
      [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
      [pointerInfo.dev, pointerInfo.ino, pointerInfo.size, pointerInfo.mtimeNs, pointerInfo.ctimeNs]
    )
    assert.equal(publications, 0)
    assert.equal(store.snapshot().teams[0].name, 'current generation')
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('rollback rejects corrupt or missing target closed shards without any pointer or publication change', async t => {
  for (const failure of ['corrupt', 'missing']) await t.test(failure, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-rollback-shard-${failure}-`))
    const mod = await plugin(`hot-cold-rollback-shard-${failure}`)
    const fixture = await createBulkV8Fixture(mod, root, 4)
    const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
    try {
      await store.init()
      const changed = store.snapshot().teams.find(team => team.state === 'closed')
      await store.mutate(document => { document.teams.find(team => team.id === changed.id).name = 'current closed generation' })
      const ledger = await currentLedgerState(fixture.file)
      const targetManifest = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.previous.path), 'utf8'))
      const targetCatalog = JSON.parse(await readFile(artifactPath(ledger.root, targetManifest.closedCatalog.path), 'utf8'))
      const targetShard = artifactPath(ledger.root, targetCatalog.entries.find(entry => entry.id === changed.id).shard.path)
      if (failure === 'corrupt') await writeFile(targetShard, '{"corrupt":true}\n')
      else await rm(targetShard)

      const pointerPath = path.join(ledger.root, 'current.json')
      const pointerBytes = await readFile(pointerPath)
      const pointerInfo = await stat(pointerPath, { bigint: true })
      let publications = 0
      const unsubscribe = store.subscribe(() => { publications += 1 })
      await assert.rejects(store.rollbackHotColdManifest())
      unsubscribe()
      const afterInfo = await stat(pointerPath, { bigint: true })
      assert.deepEqual(await readFile(pointerPath), pointerBytes)
      assert.deepEqual(
        [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
        [pointerInfo.dev, pointerInfo.ino, pointerInfo.size, pointerInfo.mtimeNs, pointerInfo.ctimeNs]
      )
      assert.equal(publications, 0)
      assert.equal(store.storageDiagnostics().generation, ledger.pointer.generation)
      assert.equal(store.snapshot().teams.find(team => team.id === changed.id).name, 'current closed generation')
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('rollback rejects corrupt or missing immediate-predecessor shards without changing pointer or publications', async t => {
  for (const failure of ['corrupt', 'missing']) await t.test(failure, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `agent-teams-hot-cold-rollback-predecessor-${failure}-`))
    const mod = await plugin(`hot-cold-rollback-predecessor-${failure}`)
    const fixture = await createBulkV8Fixture(mod, root, 4)
    const store = new mod.AgentTeamsStore(fixture.file, { hotColdStore: true })
    try {
      await store.init()
      const changed = store.snapshot().teams.find(team => team.state === 'closed')
      for (const name of ['predecessor closed generation', 'target closed generation', 'current closed generation']) {
        await store.mutate(document => { document.teams.find(team => team.id === changed.id).name = name })
      }
      const ledger = await currentLedgerState(fixture.file)
      const targetManifest = JSON.parse(await readFile(artifactPath(ledger.root, ledger.manifest.previous.path), 'utf8'))
      const predecessorManifest = JSON.parse(await readFile(artifactPath(ledger.root, targetManifest.previous.path), 'utf8'))
      const predecessorCatalog = JSON.parse(await readFile(artifactPath(ledger.root, predecessorManifest.closedCatalog.path), 'utf8'))
      const predecessorShard = artifactPath(ledger.root, predecessorCatalog.entries.find(entry => entry.id === changed.id).shard.path)
      if (failure === 'corrupt') await writeFile(predecessorShard, '{"corrupt":true}\n')
      else await rm(predecessorShard)

      const pointerPath = path.join(ledger.root, 'current.json')
      const pointerBytes = await readFile(pointerPath)
      const pointerInfo = await stat(pointerPath, { bigint: true })
      let publications = 0
      const unsubscribe = store.subscribe(() => { publications += 1 })
      await assert.rejects(store.rollbackHotColdManifest())
      unsubscribe()
      const afterInfo = await stat(pointerPath, { bigint: true })
      assert.deepEqual(await readFile(pointerPath), pointerBytes)
      assert.deepEqual(
        [afterInfo.dev, afterInfo.ino, afterInfo.size, afterInfo.mtimeNs, afterInfo.ctimeNs],
        [pointerInfo.dev, pointerInfo.ino, pointerInfo.size, pointerInfo.mtimeNs, pointerInfo.ctimeNs]
      )
      assert.equal(publications, 0)
      assert.equal(store.storageDiagnostics().generation, ledger.pointer.generation)
      assert.equal(store.snapshot().teams.find(team => team.id === changed.id).name, 'current closed generation')
    } finally {
      store.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})

test('manifest rollback selects the previous complete generation without touching v8', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-hot-cold-rollback-'))
  const mod = await plugin('hot-cold-rollback')
  const file = path.join(root, 'storages', 'agent_teams.json')
  const store = new mod.AgentTeamsStore(file, { enabled: true, hotColdStore: true })
  try {
    await store.init()
    const created = await mod.createTeam(store, { id: 'root-rollback', options: { provider: 'test', model: 'test' } }, { objective: 'rollback objective', leadName: 'Lead' })
    const original = await readFile(file)
    await store.mutate(document => { document.teams.find(team => team.id === created.id).name = 'new generation name' })
    assert.equal(store.snapshot().teams[0].name, 'new generation name')
    await store.rollbackHotColdManifest()
    assert.equal(store.snapshot().teams[0].name, 'rollback objective')
    assert.deepEqual(await readFile(file), original)
  } finally {
    store.close()
    await rm(root, { recursive: true, force: true })
  }
})
