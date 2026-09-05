const test = require('node:test')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const plugin = path.resolve(__dirname, '../plugins/dsh-agent-teams/lib/index.js')
const fixture = () => ({ objective: 'Repair the requested bug', name: 'Test', members: [{ kind: 'worker', publishedAt: '2026-09-01T10:00:00.000Z', state: 'retired' }], tasks: [
  { state: 'completed', createdAt: '2026-09-01T09:59:00.000Z' },
  { state: 'in_progress', createdAt: '2026-09-01T10:00:00.000Z' },
  { state: 'pending', createdAt: '2026-09-01T10:01:00.000Z' },
  { state: 'cancelled', createdAt: '2026-09-01T10:02:00.000Z' }
] })
test('scope reminder distinguishes internal work-plan growth from user requirements', async () => {
  const { projectTeamScope } = await import(pathToFileURL(plugin).href)
  const team = fixture(), before = JSON.stringify(team)
  const scope = projectTeamScope(team)
  assert.equal(scope.initialTaskCount, 2)
  assert.equal(scope.addedTaskCount, 2)
  assert.equal(scope.totalTaskCount, 4)
  assert.equal(scope.remainingTaskCount, 2)
  assert.equal(scope.reviewRecommended, true)
  assert.equal(scope.objective, team.objective)
  assert.match(scope.notice, /not proof of new user requirements/)
  assert.equal(JSON.stringify(team), before)
  assert.deepEqual(scope, JSON.parse(JSON.stringify(scope)))
  team.tasks.reverse(); team.members.push({ kind: 'worker', publishedAt: '2026-09-01T11:00:00.000Z' })
  assert.deepEqual(projectTeamScope(team), scope)
})
test('unpublished or historically undated work does not invent an original scope baseline', async () => {
  const { projectTeamScope } = await import(pathToFileURL(plugin).href)
  for (const mutate of [team => { team.members = [] }, team => { delete team.members[0].publishedAt }, team => { delete team.tasks[0].createdAt }]) {
    const team = fixture(); mutate(team)
    const scope = projectTeamScope(team)
    assert.equal(scope.baselineKnown, false)
    assert.equal(scope.reviewRecommended, false)
    assert.equal('addedTaskCount' in scope, false)
    assert.deepEqual(scope, JSON.parse(JSON.stringify(scope)))
  }
})
test('UI scope notice is non-interruptive text, not an action or competing live alert', async () => {
  const source = await readFile(path.resolve(__dirname, '../plugins/dsh-agent-teams/lib/client.js'), 'utf8')
  const line = source.split('\n').find(line => line.includes('dat-scope-notice'))
  assert.ok(line)
  assert.match(line, /role: "note"/)
  assert.match(line, /Number\.isSafeInteger/)
  assert.match(line, /任务增加不等于需求增加/)
  assert.doesNotMatch(line, /dangerouslySetInnerHTML|aria-live|onClick|setInterval|fetch\(/)
})
