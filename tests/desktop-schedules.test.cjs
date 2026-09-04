const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')
const YAML = require('yaml')

const root = path.resolve(__dirname, '..')
const service = require('../electron/bridge/desktop-schedules-plugin-service.cjs')

async function plugin() {
  return import(pathToFileURL(path.join(root, 'plugins/dsh-desktop-schedules/lib/index.js')).href)
}

function scheduleEvent(seq, data, type = 'schedule/change') {
  return { type, seq, time: Date.parse('2026-08-21T08:00:00.000Z') + seq, data }
}

function createChange(schedule) {
  return { version: 1, operation: 'create', schedule }
}

function afterRecord(id, scheduledAt, prompt = `Reminder ${id}`) {
  return { id, kind: 'after', prompt, afterSeconds: 60, scheduledAt }
}

function everyRecord(id, scheduledAt, prompt = `Recurring ${id}`) {
  return { id, kind: 'every', prompt, everySeconds: 300, scheduledAt }
}

function liveFixture(sessionId, events, options = {}) {
  const session = {
    inheritedEventCount: options.inheritedEventCount || 0,
    generation: options.generation || 1,
    header: { version: 0, id: sessionId, createdAt: 1_700_000_000_000, isSeeded: Boolean(options.inheritedEventCount) },
    ownEvents: () => {
      session.ownEventReads += 1
      return events.slice()
    },
    eventAt: seq => events[seq - session.inheritedEventCount],
    ownEventReads: 0,
    get seq() { return session.inheritedEventCount + events.length }
  }
  const agent = { id: sessionId, session }
  const ctx = { agents: { get: id => id === sessionId ? agent : undefined, roots: () => [agent] } }
  return { agent, ctx, session }
}

function validator(result) {
  return { etag: result.headers.etag, cursor: Number(result.headers['x-schedule-cursor']), generation: result.headers['x-schedule-generation'] }
}

function semanticHash(value) {
  const semantic = {
    schedules: value.schedules,
    seenIds: value.seenIds,
    history: value.history,
    limitation: value.limitation,
    minimumEverySeconds: value.minimumEverySeconds
  }
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex')
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

async function clientModule(overrides = {}) {
  const source = await readFile(path.join(root, 'plugins/dsh-desktop-schedules/lib/client.js'), 'utf8')
  let registration
  const sandbox = {
    console,
    encodeURIComponent,
    fetch: overrides.fetch,
    navigator: { language: 'en' },
    window: { __ModuleLoader__: { load: value => { registration = value } }, ...overrides.window }
  }
  vm.runInNewContext(source, sandbox)
  const React = { createElement: () => null, useEffect: () => {}, useRef: value => ({ current: value }), useState: value => [value, () => {}] }
  return { exports: registration.factory(name => name === 'react' ? React : {}), sandbox }
}

test('schedule profile restores the Desktop view beside the official scheduler idempotently', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-schedules-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'cordis.patch.yml')
  await writeFile(file, '- insert:\n    - id: existing\n      name: existing-plugin\n    - id: schedule\n      name: "@deepseek-ai/dsh-schedule"\n')
  assert.equal(await service.ensurePatchEntries(file), true)
  assert.equal(await service.ensurePatchEntries(file), false)
  const rows = YAML.parse(await readFile(file, 'utf8'))
  const entries = rows.flatMap(row => row.insert || [])
  assert.equal(entries.filter(item => item.id === 'schedule' && item.name === '@deepseek-ai/dsh-schedule').length, 1)
  assert.equal(entries.filter(item => item.id === 'desktop-schedules' && item.name === 'dsh-desktop-schedules').length, 1)
  assert.ok(entries.some(item => item.id === 'existing'))
})

test('schedule service deploys the Desktop view without changing durable session logs', async t => {
  const dshHome = await mkdtemp(path.join(tmpdir(), 'dsh-schedules-home-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const bundledRoot = path.join(root, 'plugins', 'dsh-desktop-schedules')
  const destination = path.join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-desktop-schedules')
  const sessionLog = path.join(dshHome, 'sessions', '--workspace--', 'session-with-schedule', 'session.jsonl.zstd')
  const durableBytes = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01, 0x02, 0x03])
  await mkdir(destination, { recursive: true })
  await mkdir(path.dirname(sessionLog), { recursive: true })
  await writeFile(path.join(destination, 'stale.js'), 'retired')
  await writeFile(sessionLog, durableBytes)
  const manifest = JSON.parse(await readFile(path.join(bundledRoot, 'package.json'), 'utf8'))

  const result = await service.ensureDesktopSchedulesPlugin({ dshHome, bundledRoot })

  assert.deepEqual(result, { destination, patchChanged: true, version: manifest.version })
  await assert.rejects(readFile(path.join(destination, 'stale.js')), { code: 'ENOENT' })
  assert.equal(JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8')).name, 'dsh-desktop-schedules')
  assert.deepEqual(await readFile(sessionLog), durableBytes)
})

test('observable schedule snapshot folds the official schedule event log', async () => {
  const { snapshot } = await plugin()
  const sessionId = 'session-a'
  const events = [{
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
  const agent = { id: sessionId, session: { ownEvents: () => events } }
  const ctx = { agents: { get: id => id === sessionId ? agent : undefined, roots: () => [agent] } }
  const result = snapshot(ctx, sessionId, Date.parse('2026-08-21T08:00:00.000Z'))
  assert.equal(result.schemaVersion, 2)
  assert.equal(result.available, true)
  assert.equal(result.minimumEverySeconds, 300)
  assert.deepEqual(result.schedules, [{
    id: 'schedule-1', kind: 'after', prompt: 'Review the build', afterSeconds: 60,
    scheduledAt: '2026-08-21T08:01:00.000Z', state: 'scheduled', deliveryMode: 'session-local'
  }])
  assert.deepEqual(result.history, [{
    id: 'schedule-1', operation: 'created', prompt: 'Review the build', kind: 'after',
    schedule: { id: 'schedule-1', kind: 'after', prompt: 'Review the build', afterSeconds: 60, scheduledAt: '2026-08-21T08:01:00.000Z' },
    scheduledAt: '2026-08-21T08:01:00.000Z', occurredAt: '2026-08-21T08:01:00.000Z'
  }])
})

test('schedule history is bounded, newest-first, and preserves recreate rules', async () => {
  const { scheduleHistory } = await plugin()
  const schedule = { id: 'repeat-1', kind: 'every', prompt: 'Check builds', everySeconds: 300, scheduledAt: '2026-08-21T08:00:00.000Z' }
  const events = [
    { type: 'schedule/change', data: { version: 1, operation: 'create', schedule } },
    { type: 'schedule/change', data: { version: 1, operation: 'dispatch', id: schedule.id, acceptedAt: '2026-08-21T08:05:00.000Z' } },
    { type: 'schedule/change', data: { version: 1, operation: 'delete', id: schedule.id } }
  ]
  const history = scheduleHistory(events, 0, 2)
  assert.deepEqual(history.map(item => item.operation), ['deleted', 'dispatched'])
  assert.equal(history[0].schedule.everySeconds, 300)
  assert.equal(history[1].occurredAt, '2026-08-21T08:05:00.000Z')
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
  assert.match(source, /已安排的任务/u)
  assert.match(source, /搜索已安排任务/u)
  assert.match(source, /className: "dds-visually-hidden"/u)
  assert.match(source, /\.dds-visually-hidden\{[^}]*clip-path:inset\(50%\)/u)
  assert.doesNotMatch(source, /className: "visually-hidden"/u)
  assert.match(source, /suggestionDaily/u)
  assert.match(source, /activeFilter/u)
  assert.match(source, /disabledFilter/u)
  assert.match(source, /dds-filters/u)
  assert.match(source, /visibleSchedules/u)
  assert.match(source, /visibleHistory/u)
  assert.match(source, /function recreate\(item\)/u)
  assert.match(source, /every_seconds/u)
  assert.match(source, /Number\.isSafeInteger\(record\.everySeconds\)/u)
  assert.match(source, /record\.everySeconds < 300/u)
  assert.doesNotMatch(source, /record\.interval/u)
  assert.match(source, /setInterval\(guarded, 15000\)/u)
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

test('incremental projection is canonically identical across fixed-rate, overdue, recreate, and history transitions', async () => {
  const { createScheduleProjectionStore, snapshot } = await plugin()
  const sessionId = 'incremental-semantics'
  const events = [
    scheduleEvent(0, createChange(everyRecord('schedule-1', '2026-08-21T08:00:00.000Z', 'Fixed-rate check'))),
    scheduleEvent(1, createChange(afterRecord('schedule-2', '2026-08-21T08:20:00.000Z', 'One shot')))
  ]
  const { ctx, session } = liveFixture(sessionId, events)
  const store = createScheduleProjectionStore()
  const now = Date.parse('2026-08-21T08:12:00.000Z')

  const cold = store.project(ctx, sessionId, { now })
  assert.equal(cold.body.projection.mode, 'full')
  assert.equal(cold.body.schedules.find(item => item.id === 'schedule-1').state, 'overdue')
  assert.equal(cold.body.schedules.every(item => item.deliveryMode === 'session-local'), true)
  const coldReads = session.ownEventReads
  let currentValidator = validator(cold)
  const unchanged = store.project(ctx, sessionId, { now, ...currentValidator, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
  assert.equal(unchanged.status, 304)
  assert.equal(unchanged.body, null)
  assert.equal(session.ownEventReads, coldReads, '304 fast path must not materialize ownEvents again')

  const rolledBack = store.project(ctx, sessionId, { now: Date.parse('2026-08-21T07:59:00.000Z'), ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
  assert.equal(rolledBack.status, 200)
  assert.equal(rolledBack.body.projection.viewChanged, true)
  assert.equal(rolledBack.body.schedules.find(item => item.id === 'schedule-1').state, 'scheduled')
  currentValidator = validator(rolledBack)
  const rolledForward = store.project(ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
  assert.equal(rolledForward.body.schedules.find(item => item.id === 'schedule-1').state, 'overdue')
  currentValidator = validator(rolledForward)

  events.push(scheduleEvent(2, { version: 1, operation: 'dispatch', id: 'schedule-1', acceptedAt: '2026-08-21T08:12:00.000Z' }))
  let updated = store.project(ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
  assert.equal(updated.body.projection.mode, 'delta')
  assert.equal(updated.body.projection.deltaCount, 1)
  assert.equal(updated.body.schedules.find(item => item.id === 'schedule-1').scheduledAt, '2026-08-21T08:15:00.000Z')
  assert.equal(updated.body.schedules.find(item => item.id === 'schedule-1').state, 'scheduled')
  assert.equal(semanticHash(updated.body), semanticHash(snapshot(ctx, sessionId, now)))

  currentValidator = validator(updated)
  events.push(
    scheduleEvent(3, { version: 1, operation: 'delete', id: 'schedule-2' }),
    scheduleEvent(4, createChange(afterRecord('schedule-3', '2026-08-21T08:30:00.000Z', 'One shot')))
  )
  updated = store.project(ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
  assert.equal(updated.body.projection.mode, 'delta')
  assert.equal(updated.body.projection.deltaCount, 2)
  assert.deepEqual(updated.body.seenIds, ['schedule-1', 'schedule-2', 'schedule-3'])
  assert.deepEqual(updated.body.history.slice(0, 3).map(item => item.operation), ['created', 'deleted', 'dispatched'])
  assert.equal(semanticHash(updated.body), semanticHash(snapshot(ctx, sessionId, now)))
  const independentlyFolded = createScheduleProjectionStore({ epoch: 'independent-full-replay' }).project(ctx, sessionId, { now })
  assert.equal(updated.body.projection.checksum, independentlyFolded.body.projection.checksum)
  assert.equal(semanticHash(updated.body), semanticHash(independentlyFolded.body))

  currentValidator = validator(updated)
  session.generation = 2
  const regenerated = store.project(ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
  assert.equal(regenerated.body.projection.mode, 'full')
  assert.equal(regenerated.body.projection.fallbackReason, 'generation_changed')
  assert.equal(semanticHash(regenerated.body), semanticHash(snapshot(ctx, sessionId, now)))
})

test('sequence gaps, inherited-prefix changes, and invalid since cursors fail closed to full replay', async () => {
  const { createScheduleProjectionStore } = await plugin()
  const now = Date.parse('2026-08-21T08:00:00.000Z')

  const gapEvents = [scheduleEvent(0, createChange(afterRecord('schedule-1', '2026-08-21T09:00:00.000Z')))]
  const gapFixture = liveFixture('gap-session', gapEvents)
  const gapStore = createScheduleProjectionStore()
  let result = gapStore.project(gapFixture.ctx, 'gap-session', { now })
  const gapValidator = validator(result)
  gapEvents.push(scheduleEvent(2, createChange(afterRecord('schedule-2', '2026-08-21T10:00:00.000Z'))))
  result = gapStore.project(gapFixture.ctx, 'gap-session', { now, ifNoneMatch: gapValidator.etag, since: gapValidator.cursor, generation: gapValidator.generation })
  assert.equal(result.body.projection.mode, 'full')
  assert.equal(result.body.projection.cacheable, false)
  assert.equal(result.body.projection.fallbackReason, 'sequence_gap')
  assert.equal(result.headers.etag, undefined)

  const forkEvents = [scheduleEvent(2, createChange(afterRecord('schedule-1', '2026-08-21T09:00:00.000Z')))]
  const forkFixture = liveFixture('fork-session', forkEvents, { inheritedEventCount: 2 })
  const forkStore = createScheduleProjectionStore()
  result = forkStore.project(forkFixture.ctx, 'fork-session', { now })
  const forkValidator = validator(result)
  forkFixture.session.inheritedEventCount = 3
  result = forkStore.project(forkFixture.ctx, 'fork-session', { now, ifNoneMatch: forkValidator.etag, since: forkValidator.cursor, generation: forkValidator.generation })
  assert.equal(result.body.projection.mode, 'full')
  assert.equal(result.body.projection.cacheable, false)

  const normalEvents = [scheduleEvent(0, createChange(afterRecord('schedule-1', '2026-08-21T09:00:00.000Z')))]
  const normalFixture = liveFixture('since-session', normalEvents)
  const normalStore = createScheduleProjectionStore()
  result = normalStore.project(normalFixture.ctx, 'since-session', { now })
  const normalValidator = validator(result)
  result = normalStore.project(normalFixture.ctx, 'since-session', {
    now,
    ifNoneMatch: normalValidator.etag,
    since: normalValidator.cursor + 1,
    generation: normalValidator.generation
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.projection.mode, 'full')
  assert.equal(result.body.projection.fallbackReason, 'since_ahead')
})

test('HTTP state route returns bodyless 304 and server rollback restores repeated full reads', async () => {
  const { apply } = await plugin()
  const events = [scheduleEvent(0, createChange(afterRecord('schedule-1', '2099-01-01T00:00:00.000Z')))]
  const fixture = liveFixture('route-session', events)
  let route
  const ctx = {
    ...fixture.ctx,
    effect: callback => callback(),
    webServer: { register: value => { route = value; return () => {} } }
  }
  apply(ctx)

  async function invoke(url, headers = {}) {
    const response = { status: 0, headers: {}, chunks: [], writeHead(status, nextHeaders) { this.status = status; this.headers = nextHeaders }, end(body) { if (body) this.chunks.push(Buffer.from(body)) } }
    await route.handler({ method: 'GET', url, headers: { host: '127.0.0.1:12275', ...headers } }, response)
    return { ...response, body: Buffer.concat(response.chunks) }
  }

  const first = await invoke('/api/desktop-schedules/state?sessionId=route-session')
  assert.equal(first.status, 200)
  const firstBody = JSON.parse(first.body)
  const reads = fixture.session.ownEventReads
  const second = await invoke(`/api/desktop-schedules/state?sessionId=route-session&since=${firstBody.projection.cursor}&generation=${encodeURIComponent(firstBody.projection.generation)}`, { 'if-none-match': first.headers.etag })
  assert.equal(second.status, 304)
  assert.equal(second.body.length, 0)
  assert.equal(second.headers['content-length'], undefined)
  assert.equal(fixture.session.ownEventReads, reads)

  let legacyRoute
  const legacyFixture = liveFixture('legacy-route', events)
  apply({
    ...legacyFixture.ctx,
    effect: callback => callback(),
    webServer: { register: value => { legacyRoute = value; return () => {} } }
  }, { incremental: false })
  const legacyResponse = () => ({ writeHead() {}, end() {} })
  await legacyRoute.handler({ method: 'GET', url: '/api/desktop-schedules/state?sessionId=legacy-route', headers: { host: 'localhost:12275', 'if-none-match': first.headers.etag } }, legacyResponse())
  await legacyRoute.handler({ method: 'GET', url: '/api/desktop-schedules/state?sessionId=legacy-route', headers: { host: 'localhost:12275', 'if-none-match': first.headers.etag } }, legacyResponse())
  assert.equal(legacyFixture.session.ownEventReads, 2, 'disabled server flag must restore the old full replay path')
})

test('client 304 path reads no JSON, performs zero state commit, and invalid validators retry full', async () => {
  const etag = '"dds-client"'
  let jsonReads = 0
  const headers = values => ({ get: name => values[String(name).toLowerCase()] ?? null })
  const firstClient = await clientModule({
    fetch: async () => ({
      ok: false,
      status: 304,
      headers: headers({ etag, 'x-schedule-cursor': '7', 'x-schedule-generation': 'generation-1' }),
      json: async () => { jsonReads += 1; throw new Error('304 JSON must not be read') }
    })
  })
  const previous = { etag, cursor: 6, generation: 'generation-1' }
  const unchanged = await firstClient.exports.fetchState('client-session', previous)
  let renders = 0
  const validatorRef = { current: previous }
  assert.equal(firstClient.exports.commitFetchResult(unchanged, validatorRef, () => { renders += 1 }), false)
  assert.equal(renders, 0)
  assert.equal(jsonReads, 0)
  assert.equal(validatorRef.current.cursor, 7)

  const requests = []
  const responses = [
    { ok: false, status: 304, headers: headers({ etag, 'x-schedule-cursor': '7', 'x-schedule-generation': 'wrong-generation' }), json: async () => { throw new Error('must not parse') } },
    { ok: true, status: 200, headers: headers({ etag: '"dds-full"', 'x-schedule-cursor': '7', 'x-schedule-generation': 'generation-2' }), json: async () => ({ schemaVersion: 2, schedules: [], history: [], projection: { mode: 'full', cacheable: true, cursor: 7, generation: 'generation-2' } }) }
  ]
  const fallbackClient = await clientModule({ fetch: async (url, options) => { requests.push({ url, options }); return responses.shift() } })
  const recovered = await fallbackClient.exports.fetchStateWithFallback('client-session', previous)
  assert.equal(requests.length, 2)
  assert.match(requests[0].url, /since=6/u)
  assert.doesNotMatch(requests[1].url, /since=/u)
  assert.equal(requests[1].options.headers['if-none-match'], undefined)
  assert.equal(recovered.state.projection.mode, 'full')

  let legacyRequest
  const legacyClient = await clientModule({
    window: { __DSH_DESKTOP_SCHEDULES_VALIDATORS__: false },
    fetch: async (url, options) => {
      legacyRequest = { url, options }
      return { ok: true, status: 200, headers: headers({}), json: async () => ({ schemaVersion: 2, schedules: [], history: [] }) }
    }
  })
  await legacyClient.exports.fetchState('client-session', previous)
  assert.doesNotMatch(legacyRequest.url, /since=/u)
  assert.equal(legacyRequest.options.headers['if-none-match'], undefined)
})

test('n>=30 incremental projection samples satisfy canonical-hash and p95 budgets', async t => {
  const { createScheduleProjectionStore, snapshot } = await plugin()
  const sessionId = 'performance-session'
  const base = Date.parse('2099-01-01T00:00:00.000Z')
  const now = Date.parse('2026-08-21T08:00:00.000Z')
  const events = Array.from({ length: 300 }, (_, index) => scheduleEvent(index, createChange(afterRecord(`schedule-${index + 1}`, new Date(base + index * 60_000).toISOString()))))
  let fixture = liveFixture(sessionId, events)
  const store = createScheduleProjectionStore()
  let projected = store.project(fixture.ctx, sessionId, { now })
  let currentValidator = validator(projected)
  const unchangedSamples = []
  const updateSamples = []
  const fallbackSamples = []

  for (let sample = 0; sample < 40; sample += 1) {
    const started = performance.now()
    const result = store.project(fixture.ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
    unchangedSamples.push(performance.now() - started)
    assert.equal(result.status, 304)
    currentValidator = validator(result)
  }

  for (let sample = 0; sample < 40; sample += 1) {
    const startIndex = events.length
    for (let offset = 0; offset < 10; offset += 1) {
      const index = startIndex + offset
      events.push(scheduleEvent(index, createChange(afterRecord(`schedule-${index + 1}`, new Date(base + index * 60_000).toISOString()))))
    }
    const started = performance.now()
    projected = store.project(fixture.ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
    updateSamples.push(performance.now() - started)
    assert.equal(projected.body.projection.mode, 'delta')
    assert.equal(projected.body.projection.deltaCount, 10)
    assert.equal(semanticHash(projected.body), semanticHash(snapshot(fixture.ctx, sessionId, now)))
    currentValidator = validator(projected)
  }

  const expectedHash = semanticHash(snapshot(fixture.ctx, sessionId, now))
  for (let sample = 0; sample < 40; sample += 1) {
    fixture = liveFixture(sessionId, events, { generation: sample + 10 })
    const started = performance.now()
    projected = store.project(fixture.ctx, sessionId, { now, ifNoneMatch: currentValidator.etag, since: currentValidator.cursor, generation: currentValidator.generation })
    fallbackSamples.push(performance.now() - started)
    assert.equal(projected.body.projection.mode, 'full')
    assert.equal(semanticHash(projected.body), expectedHash)
    currentValidator = validator(projected)
  }

  const evidence = {
    samples: 40,
    unchangedP95Ms: p95(unchangedSamples),
    updateTenEventsP95Ms: p95(updateSamples),
    fullFallbackP95Ms: p95(fallbackSamples)
  }
  t.diagnostic(`schedule-performance ${JSON.stringify(evidence)}`)
  assert.ok(evidence.unchangedP95Ms < 5, JSON.stringify(evidence))
  assert.ok(evidence.updateTenEventsP95Ms < 10, JSON.stringify(evidence))
  assert.ok(evidence.fullFallbackP95Ms < 40, JSON.stringify(evidence))
})
