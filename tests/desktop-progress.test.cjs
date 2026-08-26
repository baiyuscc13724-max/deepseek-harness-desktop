const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const service = require('../electron/bridge/desktop-progress-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-desktop-progress/lib/index.js')).href)
}

test('adaptive progress policy is semantic rather than step-count driven', async () => {
  const { PROGRESS_POLICY } = await plugin()
  for (const signal of ['changes phase', 'milestone completes', 'blocker', 'failure', 'user decision', 'semantic change']) assert.match(PROGRESS_POLICY, new RegExp(signal, 'i'))
  assert.match(PROGRESS_POLICY, /Say what finished, what is happening now, and what comes next/)
  assert.match(PROGRESS_POLICY, /Never use a fixed number of steps, tool calls, or elapsed intervals/)
  assert.match(PROGRESS_POLICY, /Stay quiet for trivial tasks/)
  assert.match(PROGRESS_POLICY, /synchronize it at the same semantic boundary before reporting progress or starting the next task/i)
  assert.match(PROGRESS_POLICY, /mark each finished item completed immediately/i)
  assert.match(PROGRESS_POLICY, /never leave a completed step shown as pending or in_progress/i)
})

test('progress plugin only adds model guidance without a polling UI or state API', async () => {
  const { apply, inject, PROGRESS_POLICY } = await plugin()
  const sections = []
  apply({ systemPrompt: { section: value => sections.push(value) } })
  assert.deepEqual(inject, ['systemPrompt'])
  assert.deepEqual(sections, [{ name: 'agent:adaptive-progress', order: 116, text: PROGRESS_POLICY }])

  const manifest = JSON.parse(await readFile(path.join(root, 'plugins/dsh-desktop-progress/package.json'), 'utf8'))
  const hostSource = await readFile(path.join(root, 'plugins/dsh-desktop-progress/lib/index.js'), 'utf8')
  assert.equal(manifest.dsh?.client, undefined)
  assert.equal(manifest.exports?.['./client'], undefined)
  assert.doesNotMatch(hostSource, /desktop-progress\/state|webServer|setInterval|conversation\.input\.dock/)
})

test('progress plugin installation is additive and idempotent', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-progress-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'cordis.patch.yml')
  assert.equal(await service.ensurePatchEntry(file), true)
  assert.equal(await service.ensurePatchEntry(file), false)
  const entries = YAML.parse(await readFile(file, 'utf8')).flatMap(row => row.insert || [])
  assert.equal(entries.filter(item => item.id === 'desktop-progress' && item.name === 'dsh-desktop-progress').length, 1)
})
