const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createHmac } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'external-defect-connectors.js')).href
const SECRET = 'external-connector-secret-with-twenty-four-characters'
const WEBHOOK = 'external-webhook-secret'
function defect(overrides = {}) {
  return { defectRef: 'defect_opaque001', title: 'Regression in collaboration', severity: 'critical', state: 'open', ...overrides }
}
function fixture(mod, provider, overrides = {}) {
  const config = {
    github: { baseUrl: 'https://api.github.com/', projectLocator: 'example/project' },
    gitlab: { baseUrl: 'https://gitlab.example.com/api/v4', projectLocator: 'group/project' },
    jira: { baseUrl: 'https://jira.example.com/', projectLocator: 'DSH' }
  }[provider]
  const calls = []
  let issue
  const rawId = { github: 17, gitlab: 29, jira: 'DSH-41' }[provider]
  const request = async input => {
    calls.push(input)
    const url = new URL(input.url)
    if (input.method === 'GET') {
      if (provider === 'github') return { status: 200, body: { items: issue === undefined ? [] : [issue] } }
      if (provider === 'gitlab') return { status: 200, body: issue === undefined ? [] : [issue] }
      return { status: 200, body: { issues: issue === undefined ? [] : [issue] } }
    }
    if (issue === undefined) {
      if (provider === 'github') issue = { number: rawId, body: input.body.body }
      else if (provider === 'gitlab') issue = { iid: rawId, description: input.body.description }
      else issue = { key: rawId, fields: { description: input.body.fields.description } }
      return { status: 201, body: issue }
    }
    if (provider === 'github') return { status: 200, body: { ...issue, body: input.body.body ?? issue.body } }
    if (provider === 'gitlab') return { status: 200, body: { ...issue, description: input.body.description ?? issue.description } }
    return { status: 204, body: {} }
  }
  const connector = new mod.ExternalDefectConnector({
    provider, ...config, projectRef: 'project_opaque', repositoryRef: 'repo_opaque', secret: SECRET,
    credentialProvider: async () => provider === 'gitlab' ? { 'private-token': 'transient-token' } : { authorization: 'Bearer transient-token' },
    webhookSecretProvider: async () => WEBHOOK, request,
    jiraCloseTransitionId: provider === 'jira' ? '31' : undefined,
    jiraReopenTransitionId: provider === 'jira' ? '21' : undefined,
    ...overrides
  })
  return { connector, calls, rawId, getIssue: () => issue }
}

for (const provider of ['github', 'gitlab', 'jira']) test(`${provider} defect sync is idempotent and exposes only opaque issue references`, async () => {
  const mod = await import(moduleUrl)
  const state = fixture(mod, provider)
  const operation = state.connector.prepareDefectSync(defect())
  assert.equal(JSON.stringify(operation).includes(state.rawId), false)
  assert.equal(JSON.stringify(operation).includes('example/project'), false)
  const created = await state.connector.deliverDefect(operation)
  const updated = await state.connector.deliverDefect(operation)
  assert.equal(created.externalIssueRef, updated.externalIssueRef)
  assert.match(created.externalIssueRef, /^externalissue_/u)
  assert.ok(state.calls.some(call => call.method === 'GET'))
  assert.ok(state.calls.some(call => new Set(['POST', 'PATCH', 'PUT']).has(call.method)))
  assert.ok(state.calls.every(call => call.timeoutMs === 30_000 && call.maxResponseBytes === 2 * 1024 * 1024))
  const projection = JSON.stringify(state.connector)
  for (const forbidden of ['transient-token', String(state.rawId), provider === 'github' ? 'example/project' : 'group/project']) assert.equal(projection.includes(forbidden), false)

  const closed = state.connector.prepareDefectSync(defect({ state: 'closed' }))
  const delivered = await state.connector.deliverDefect(closed)
  assert.equal(delivered.synchronizedState, 'closed')
  await assert.rejects(state.connector.deliverDefect({ ...operation, title: 'tampered' }), /authentication failed/u)
})

test('release observations append bounded external evidence but cannot invent an issue mapping', async () => {
  const mod = await import(moduleUrl)
  const state = fixture(mod, 'github')
  const observation = { defectRef: 'defect_opaque001', releaseObservationRef: 'releaseobservation_opaque001', outcome: 'clean' }
  await assert.rejects(state.connector.publishReleaseObservation({ defectRef: observation.defectRef, releaseObservation: observation }), /no synchronized external issue/u)
  await state.connector.deliverDefect(state.connector.prepareDefectSync(defect()))
  const published = await state.connector.publishReleaseObservation({ defectRef: observation.defectRef, releaseObservation: observation })
  assert.equal(published.outcome, 'clean')
  assert.ok(state.calls.some(call => call.url.includes('/comments')))
  await assert.rejects(state.connector.publishReleaseObservation({ defectRef: observation.defectRef, releaseObservation: { ...observation, defectRef: 'defect_other001' } }), /not bound/u)
})

test('authenticated webhooks are replay-safe candidates and never become internal lifecycle authority', async () => {
  const mod = await import(moduleUrl)
  const github = fixture(mod, 'github')
  await github.connector.deliverDefect(github.connector.prepareDefectSync(defect()))
  const githubBody = Buffer.from(JSON.stringify({ action: 'closed', issue: { number: github.rawId } }))
  const githubHeaders = {
    'x-github-delivery': 'delivery-1', 'x-github-event': 'issues',
    'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK).update(githubBody).digest('hex')}`
  }
  const accepted = await github.connector.acceptWebhook({ headers: githubHeaders, body: githubBody, receivedAt: 1_000 })
  assert.equal(accepted.defectRef, 'defect_opaque001')
  assert.equal(accepted.candidateAction, 'external_state_changed')
  assert.equal(Object.hasOwn(accepted, 'newDefectState'), false)
  assert.equal((await github.connector.acceptWebhook({ headers: githubHeaders, body: githubBody, receivedAt: 1_001 })).duplicate, true)
  await assert.rejects(github.connector.acceptWebhook({ headers: { ...githubHeaders, 'x-github-delivery': 'delivery-2', 'x-hub-signature-256': 'sha256=00' }, body: githubBody }), /authentication failed/u)

  const gitlab = fixture(mod, 'gitlab')
  const gitlabBody = Buffer.from(JSON.stringify({ object_attributes: { iid: 29 } }))
  const gitlabEvent = await gitlab.connector.acceptWebhook({ headers: { 'x-gitlab-event-uuid': 'uuid-1', 'x-gitlab-event': 'Issue Hook', 'x-gitlab-token': WEBHOOK }, body: gitlabBody })
  assert.equal(gitlabEvent.candidateAction, 'external_state_changed')

  const jira = fixture(mod, 'jira')
  const jiraBody = Buffer.from(JSON.stringify({ issue: { key: 'DSH-41' } }))
  const jiraEvent = await jira.connector.acceptWebhook({ headers: { 'x-dsh-delivery': 'jira-1', 'x-dsh-event': 'jira:issue_updated', 'x-dsh-signature': `sha256=${createHmac('sha256', WEBHOOK).update(jiraBody).digest('hex')}` }, body: jiraBody })
  assert.equal(jiraEvent.candidateAction, 'external_state_changed')
})

test('connector boundaries reject private endpoints, unsafe credentials, oversized responses, and forged operations', async () => {
  const mod = await import(moduleUrl)
  assert.throws(() => new mod.ExternalDefectConnector({
    provider: 'gitlab', baseUrl: 'https://127.0.0.1/api/v4', projectLocator: 'a/b', projectRef: 'project_opaque', repositoryRef: 'repo_opaque', secret: SECRET,
    credentialProvider: async () => ({ authorization: 'x' }), webhookSecretProvider: async () => WEBHOOK
  }), /local, private, or literal/u)
  const unsafe = fixture(mod, 'github', { credentialProvider: async () => ({ cookie: 'secret-cookie' }) })
  await assert.rejects(unsafe.connector.deliverDefect(unsafe.connector.prepareDefectSync(defect())), /unsafe header/u)
  const oversized = fixture(mod, 'github', { request: async () => ({ status: 200, body: Buffer.alloc(2 * 1024 * 1024 + 1) }) })
  await assert.rejects(oversized.connector.deliverDefect(oversized.connector.prepareDefectSync(defect())), /size bound/u)
  const failed = fixture(mod, 'github', { request: async () => ({ status: 429, body: '{}' }) })
  await assert.rejects(failed.connector.deliverDefect(failed.connector.prepareDefectSync(defect())), /rejected.*429/u)
})
