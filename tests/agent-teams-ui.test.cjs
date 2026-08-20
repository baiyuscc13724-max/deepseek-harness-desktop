const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const clientFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'client.js')

test('Agent Teams client uses native conversation slots and same-origin APIs', async () => {
  const source = await readFile(clientFile, 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load/u)
  assert.match(source, /conversation\.session\.header\.actions/u)
  assert.match(source, /conversation\.input\.dock/u)
  assert.match(source, /\/api\/agent-teams\/state/u)
  assert.match(source, /\/api\/agent-teams\/events/u)
  assert.match(source, /x-harness-agent-teams/iu)
  assert.match(source, /title: "代理团队工作台", button: "代理团队"/u)
  assert.match(source, /settingsTitle: "代理团队"/u)
  assert.match(source, /EventSource/u)
  assert.doesNotMatch(source, /https?:\/\//u)
})

test('Agent Teams workbench is a native read-only dashboard with authenticated conversation handoff', async () => {
  const source = await readFile(clientFile, 'utf8')
  for (const marker of ['members', 'tasks', 'dependsOn', 'blockedBy', 'conflictsWith', 'manageHint', 'sessions.openSubagent']) {
    assert.ok(source.includes(marker), `missing Team Workbench marker: ${marker}`)
  }
  assert.doesNotMatch(source, /act\(["'](?:start|spawn|message|member-stop|task-create|task-update|close)["']/u)
  assert.match(source, /maxMembers/u)
  assert.match(source, /Escape/u)
  assert.match(source, /role:\s*["']dialog["']/u)
})
