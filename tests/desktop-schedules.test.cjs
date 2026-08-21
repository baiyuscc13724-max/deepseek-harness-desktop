const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const service = require('../electron/bridge/desktop-schedules-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-desktop-schedules/lib/index.js')).href)
}

test('schedule profile installation is additive and idempotent', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-schedules-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'cordis.patch.yml')
  await writeFile(file, '- insert:\n    - id: existing\n      name: existing-plugin\n')
  assert.equal(await service.ensurePatchEntries(file), true)
  assert.equal(await service.ensurePatchEntries(file), false)
  const rows = YAML.parse(await readFile(file, 'utf8'))
  const entries = rows.flatMap(row => row.insert || [])
  assert.equal(entries.filter(item => item.id === 'schedule' && item.name === '@deepseek-ai/dsh-schedule').length, 1)
  assert.equal(entries.filter(item => item.id === 'desktop-schedules' && item.name === 'dsh-desktop-schedules').length, 1)
  assert.ok(entries.some(item => item.id === 'existing'))
})

test('observable schedule snapshot folds the official schedule event log', async () => {
  const { snapshot } = await plugin()
  const sessionId = 'session-a'
  const agent = {
    id: sessionId,
    session: {
      header: { seedLength: 0 },
      events: [{
        type: 'schedule/change',
        data: {
          version: 1,
          operation: 'create',
          schedule: {
            id: 'schedule-1',
            kind: 'after',
            prompt: 'Review the build',
            afterSeconds: 60,
            scheduledAt: '2026-08-21T08:01:00.000Z'
          }
        }
      }]
    }
  }
  const ctx = { agents: { get: id => id === sessionId ? agent : undefined, roots: () => [agent] } }
  const result = snapshot(ctx, sessionId, Date.parse('2026-08-21T08:00:00.000Z'))
  assert.equal(result.available, true)
  assert.equal(result.minimumEverySeconds, 300)
  assert.deepEqual(result.schedules, [{
    id: 'schedule-1', kind: 'after', prompt: 'Review the build', afterSeconds: 60,
    scheduledAt: '2026-08-21T08:01:00.000Z', state: 'scheduled', deliveryMode: 'session-local'
  }])
})

test('schedule state route accepts only loopback same-origin requests', async () => {
  const { trustedRequest } = await plugin()
  assert.equal(trustedRequest({ headers: { host: '127.0.0.1:12275', origin: 'http://127.0.0.1:12275' } }), true)
  assert.equal(trustedRequest({ headers: { host: 'localhost:12275' } }), true)
  assert.equal(trustedRequest({ headers: { host: 'example.com', origin: 'http://example.com' } }), false)
  assert.equal(trustedRequest({ headers: { host: '127.0.0.1:12275', origin: 'https://evil.example' } }), false)
})

test('schedule client observes state and only prepares user-reviewed requests', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-desktop-schedules/lib/client.js'), 'utf8')
  assert.match(source, /\/api\/desktop-schedules\/state/)
  assert.match(source, /inputActions\.setDraft/)
  assert.match(source, /Review it, then send manually/)
  assert.match(source, /仅当前会话运行/)
  assert.doesNotMatch(source, /method:\s*["']POST["']/)
  assert.doesNotMatch(source, /inputActions\.(submit|send)/)
  assert.doesNotThrow(() => new Function(source))
})

test('schedule client uses the shared responsive panel design', async () => {
  const source = await readFile(path.join(root, 'plugins/dsh-desktop-schedules/lib/client.js'), 'utf8')
  assert.match(source, /dds-heading-icon/)
  assert.match(source, /dds-panel-head/)
  assert.match(source, /dds-notice-icon/)
  assert.match(source, /dds-empty-icon/)
  assert.match(source, /dds-list-head/)
  assert.match(source, /var style = document\.querySelector\("style\[data-plugin='dsh-desktop-schedules'\]"\)/)
  assert.match(source, /if \(!style\.isConnected\) document\.head\.appendChild\(style\)/)
  assert.doesNotMatch(source, /querySelector\("style\[data-plugin='dsh-desktop-schedules'\]"\)\) return/)
  assert.match(source, /\.dds-view\{[^}]*height:auto;[^}]*overflow:visible;[^}]*padding:[^}]*72px/)
  assert.doesNotMatch(source, /\.dds-view\{[^}]*height:100%;[^}]*overflow:auto/)
  assert.match(source, /color-mix\(in srgb/)
  assert.match(source, /@media\(max-width:820px\)/)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/)
  assert.doesNotMatch(source, /background:\s*#(?:ffb|ffa|f90)/i)
})
