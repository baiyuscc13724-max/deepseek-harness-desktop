const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { createHash, createHmac, randomBytes } = require('node:crypto')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const connectorUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'external-defect-connectors.js')).href
const outboxUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'external-defect-outbox.js')).href
const storeUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'project-state-store.js')).href
const PROJECT = `project_${'E'.repeat(26)}`
const REPOSITORY = 'repo_external01'
const TOKEN = 'transient-external-token'
const WEBHOOK = 'persistent-webhook-secret'
function digest(value) { return `sha256:${createHash('sha256').update(String(value)).digest('hex')}` }
function defect(overrides = {}) { return { defectRef: 'defect_persisted01', title: 'Persist external defect safely', severity: 'major', state: 'open', ...overrides } }
async function fixture() {
  const connectorMod = await import(connectorUrl)
  const outboxMod = await import(outboxUrl)
  const storeMod = await import(storeUrl)
  const root = await mkdtemp(path.join(os.tmpdir(), 'external-defect-outbox-'))
  const remote = { issue: undefined, createCount: 0, updateCount: 0, comments: [], calls: [] }
  const request = async input => {
    remote.calls.push(input)
    const url = new URL(input.url)
    if (input.method === 'GET' && url.pathname.endsWith('/comments')) return { status: 200, body: remote.comments.map(body => ({ body })) }
    if (input.method === 'GET') return { status: 200, body: { items: remote.issue === undefined ? [] : [remote.issue] } }
    if (input.method === 'POST' && url.pathname.endsWith('/comments')) { remote.comments.push(input.body.body); return { status: 201, body: { id: remote.comments.length } } }
    if (input.method === 'POST') { remote.createCount += 1; remote.issue = { number: 71, body: input.body.body }; return { status: 201, body: remote.issue } }
    if (input.method === 'PATCH') { remote.updateCount += 1; remote.issue = { ...remote.issue, body: input.body.body }; return { status: 200, body: remote.issue } }
    throw new Error('unexpected fake request')
  }
  const credentialProvider = async () => ({ authorization: `Bearer ${TOKEN}` })
  const webhookSecretProvider = async () => WEBHOOK
  const connector = new connectorMod.ExternalDefectConnector({
    provider: 'github', baseUrl: 'https://api.github.com/', projectLocator: 'private-owner/private-repository',
    projectRef: PROJECT, repositoryRef: REPOSITORY, secret: 'persistent-external-secret-with-twenty-four-characters',
    credentialProvider, webhookSecretProvider, request
  })
  const key = randomBytes(32)
  const filePath = path.join(root, 'external-outbox.enc')
  const store = new storeMod.EncryptedAuthorityStateStore(filePath, { projectRef: PROJECT, encryptionKey: key })
  const outbox = await outboxMod.PersistedExternalDefectOutbox.create({ store, connector, credentialProvider, webhookSecretProvider, request, now: () => 170_000_000 })
  return { connectorMod, outboxMod, storeMod, root, remote, request, credentialProvider, webhookSecretProvider, connector, key, filePath, store, outbox }
}
async function usingFixture(run) { const state = await fixture(); try { await run(state) } finally { await rm(state.root, { recursive: true, force: true }) } }
function openOutbox(state) {
  const store = new state.storeMod.EncryptedAuthorityStateStore(state.filePath, { projectRef: PROJECT, encryptionKey: state.key })
  return state.outboxMod.PersistedExternalDefectOutbox.open({ store, credentialProvider: state.credentialProvider, webhookSecretProvider: state.webhookSecretProvider, request: state.request, now: () => 170_000_000 })
}

test('encrypted outbox persists before delivery and restores only opaque public projections', async () => usingFixture(async state => {
  const queued = await state.outbox.enqueueDefect(defect())
  assert.equal(queued.duplicate, false)
  assert.equal(state.outbox.toJSON().pendingCount, 1)
  const ciphertext = await readFile(state.filePath, 'utf8')
  for (const forbidden of [TOKEN, WEBHOOK, 'private-owner/private-repository', 'persistent-external-secret', 'Persist external defect safely']) assert.equal(ciphertext.includes(forbidden), false)
  const delivered = await state.outbox.deliverNext()
  assert.equal(delivered.result.synchronizedState, 'open')
  assert.equal(state.remote.createCount, 1)
  assert.equal(state.outbox.toJSON().pendingCount, 0)
  const reopened = await openOutbox(state)
  assert.equal(reopened.toJSON().connector.mappingCount, 1)
  assert.equal((await reopened.enqueueDefect(defect())).duplicate, true)
  const projection = JSON.stringify(reopened)
  for (const forbidden of [TOKEN, 'private-owner', '71']) assert.equal(projection.includes(forbidden), false)
}))

test('crash after remote issue creation retries by marker without creating a duplicate', async () => usingFixture(async state => {
  await state.outbox.enqueueDefect(defect())
  const originalSave = state.store.save.bind(state.store)
  let fail = true
  state.store.save = async (...args) => { if (fail) { fail = false; throw new Error('simulated crash after remote create') } return originalSave(...args) }
  await assert.rejects(state.outbox.deliverNext(), /simulated crash/u)
  assert.equal(state.remote.createCount, 1)
  assert.equal(state.outbox.toJSON().pendingCount, 1)
  state.store.save = originalSave
  const retried = await state.outbox.deliverNext()
  assert.equal(retried.result.synchronizedState, 'open')
  assert.equal(state.remote.createCount, 1)
  assert.equal(state.remote.updateCount, 1)
  assert.equal(state.outbox.toJSON().pendingCount, 0)
}))

test('ReleaseObservation comments are marker-idempotent across final state-save failure', async () => usingFixture(async state => {
  await state.outbox.enqueueDefect(defect())
  await state.outbox.deliverNext()
  const observation = { defectRef: 'defect_persisted01', releaseObservationRef: 'releaseobservation_persisted01', outcome: 'clean' }
  await state.outbox.enqueueReleaseObservation({ defectRef: observation.defectRef, releaseObservation: observation })
  const originalSave = state.store.save.bind(state.store)
  let fail = true
  state.store.save = async (...args) => { if (fail) { fail = false; throw new Error('simulated crash after comment') } return originalSave(...args) }
  await assert.rejects(state.outbox.deliverNext(), /simulated crash/u)
  assert.equal(state.remote.comments.length, 1)
  state.store.save = originalSave
  await state.outbox.deliverNext()
  assert.equal(state.remote.comments.length, 1)
  assert.equal(state.outbox.toJSON().pendingCount, 0)
}))

test('webhook replay memory survives encrypted restart and competing revisions fail closed', async () => usingFixture(async state => {
  const body = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 71 } }))
  const headers = { 'x-github-delivery': 'persistent-delivery', 'x-github-event': 'issues', 'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK).update(body).digest('hex')}` }
  assert.equal((await state.outbox.acceptWebhook({ headers, body, receivedAt: 170_000_000 })).result.duplicate, false)
  const reopened = await openOutbox(state)
  assert.equal((await reopened.acceptWebhook({ headers, body, receivedAt: 170_000_001 })).result.duplicate, true)
  const competing = await openOutbox(state)
  await reopened.enqueueDefect(defect({ defectRef: 'defect_competing01' }))
  await assert.rejects(competing.enqueueDefect(defect({ defectRef: 'defect_stale001' })), /compare-and-swap revision changed/u)
  assert.equal(competing.toJSON().pendingCount, 0)
}))

test('project stop persists a no-delivery epoch until explicit resume', async () => usingFixture(async state => {
  await state.outbox.enqueueDefect(defect())
  const paused = await state.outbox.pause()
  assert.equal(paused.paused, true)
  assert.equal(paused.pauseEpoch, 1)
  assert.equal(await state.outbox.deliverNext(), undefined)
  assert.equal(state.remote.calls.length, 0)
  const body = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 71 } }))
  const headers = { 'x-github-delivery': 'paused-delivery', 'x-github-event': 'issues', 'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK).update(body).digest('hex')}` }
  assert.equal((await state.outbox.acceptWebhook({ headers, body })).result.deferred, true)
  const reopened = await openOutbox(state)
  assert.equal(reopened.toJSON().paused, true)
  assert.equal(await reopened.deliverNext(), undefined)
  await reopened.resume()
  await reopened.deliverNext()
  assert.equal(state.remote.createCount, 1)
  assert.equal(reopened.toJSON().paused, false)
}))

test('connector Host snapshot authenticates private mapping and replay state', async () => usingFixture(async state => {
  await state.outbox.enqueueDefect(defect())
  await state.outbox.deliverNext()
  const hostState = state.outbox.connector.exportHostState()
  const restored = state.connectorMod.ExternalDefectConnector.restore(JSON.parse(JSON.stringify(hostState)), { credentialProvider: state.credentialProvider, webhookSecretProvider: state.webhookSecretProvider, request: state.request })
  assert.deepEqual(restored.toJSON(), state.outbox.connector.toJSON())
  assert.throws(() => state.connectorMod.ExternalDefectConnector.restore({ ...hostState, projectLocator: 'attacker/repository' }, { credentialProvider: state.credentialProvider, webhookSecretProvider: state.webhookSecretProvider, request: state.request }), /authentication failed/u)
}))
