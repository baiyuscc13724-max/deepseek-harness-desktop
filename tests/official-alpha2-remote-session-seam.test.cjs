'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const repoRoot = path.resolve(__dirname, '..')
const auditRoot = process.env.DSH_ALPHA2_AUDIT_ROOT || path.resolve(repoRoot, '..', '.alpha2-audit', 'isolated-project')
const scopedRoot = path.join(auditRoot, 'node_modules', '@deepseek-ai')
const officialTag = 'dsh-v0.1.2-alpha.2'
const officialCommit = '0a53fb55bea101816fa226bb964ae2bed71c343b'

function packageRoot(name) {
  return path.join(scopedRoot, name)
}

function readPackage(name, relative) {
  return readFileSync(path.join(packageRoot(name), relative), 'utf8')
}

function manifest(name) {
  return JSON.parse(readPackage(name, 'package.json'))
}

function assertContains(source, fragments, label) {
  for (const fragment of fragments) assert.ok(source.includes(fragment), `${label} missing pinned fragment: ${fragment}`)
}

const forwardedEvents = new Set([
  'agent-preset/selected',
  'approval/request',
  'api-session/activity',
  'api-session/added',
  'api-session/error',
  'api-session/removed',
  'api-session/status',
  'commands/change',
  'credentials/reference-updated',
  'cordis/request-run',
  'cordis/request-run-resolved',
  'cordis/dynamic-package',
  'cordis/dynamic-retract',
  'cordis/inspect-query',
  'cordis/inspect-query-resolved',
  'llm/adapters-updated',
  'settings/document-updated',
  'user-questions/request'
])

function acceptDesktopForwardedEvent(frame) {
  assert.equal(frame && Object.getPrototypeOf(frame), Object.prototype, 'event frame must be a plain record')
  assert.deepEqual(Reflect.ownKeys(frame).sort(), ['args', 'event', 'type'], 'event frame keys must be exact')
  assert.equal(frame.type, 'emit')
  assert.ok(forwardedEvents.has(frame.event), 'event must be in the application allowlist')
  assert.doesNotThrow(() => JSON.stringify(frame.args))
  assert.ok(Array.isArray(frame.args))
  return frame
}

function acceptControlGeneration(frames) {
  let baselineSeen = false
  for (const frame of frames) {
    if (frame.type === 'baseline') {
      assert.equal(baselineSeen, false, 'one generation cannot carry two opening baselines')
      baselineSeen = true
      assert.ok(frame.value && typeof frame.value === 'object')
      continue
    }
    assert.equal(baselineSeen, true, 'control delta cannot precede the opening baseline')
    assert.ok(['queue', 'jobs', 'projection'].includes(frame.type), 'unknown control frame')
  }
  assert.equal(baselineSeen, true, 'control generation requires an opening baseline')
}

function classifyJournalStep(lastCursor, entry) {
  assert.ok(Number.isInteger(entry.first) && Number.isInteger(entry.last))
  assert.ok(entry.first <= entry.last, 'inverted cursor range')
  if (entry.last <= lastCursor) return { action: 'ignore', lastCursor }
  assert.ok(entry.first > lastCursor, 'partial overlap is forbidden')
  if (entry.first !== lastCursor + 1) return { action: 'repair', through: entry.last }
  return { action: 'append', lastCursor: entry.last }
}

function assertCanonicalProjectInput(input) {
  assert.ok(input && typeof input === 'object')
  assert.equal(typeof input.canonicalProjectKey, 'string', 'canonical project identity must come from an authority')
  assert.equal(typeof input.workspaceId, 'string', 'authorized Workspace identity must come from an authority')
  assert.ok(input.canonicalProjectKey.length > 0 && input.workspaceId.length > 0)
  assert.equal(Object.hasOwn(input, 'sessionSummary'), false, 'SessionSummary metadata is not an ownership credential')
  return { workspaceId: input.workspaceId }
}

test('audit is pinned to the official alpha.2 tag/commit and exact package versions', () => {
  const report = readFileSync(path.join(repoRoot, 'docs', 'OFFICIAL-ALPHA2-REMOTE-SESSION-SEAM.zh-CN.md'), 'utf8')
  assert.match(report, new RegExp(officialTag.replaceAll('.', '\\.')))
  assert.match(report, new RegExp(officialCommit))
  for (const name of [
    'dsh-api-remotes',
    'dsh-api-session-controller',
    'dsh-api-gateway',
    'dsh-client-connection',
    'dsh-session-projection',
    'dsh-session-query'
  ]) assert.equal(manifest(name).version, '0.1.2-alpha.2', `${name} drifted from the audited version`)
})

test('public exports expose the Remote/Session seam without relying on removed packages', () => {
  const expected = {
    'dsh-api-remotes': ['.', './client', './types', './invariant'],
    'dsh-api-session-controller': ['.', './client', './types', './remote-events', './remote', './typert', './invariant'],
    'dsh-api-gateway': ['.', './client', './types', './invariant'],
    'dsh-client-connection': ['.', './client', './invariant'],
    'dsh-session-projection': ['.', './types', './invariant'],
    'dsh-session-query': ['.', './invariant']
  }
  for (const [name, keys] of Object.entries(expected)) {
    const exports = manifest(name).exports
    for (const key of keys) assert.ok(Object.hasOwn(exports, key), `${name} is missing ${key}`)
  }
  const report = readFileSync(path.join(repoRoot, 'docs', 'OFFICIAL-ALPHA2-REMOTE-SESSION-SEAM.zh-CN.md'), 'utf8')
  assert.match(report, /unproven=blocked/u)
  assert.match(report, /不得.*私有/u)
})

test('generated Session namespace pins New Session and recovery methods', () => {
  const remoteTypes = readPackage('dsh-api-session-controller', 'lib/typert.remote-client.d.ts')
  for (const endpoint of [
    'session/control', 'session/create', 'session/follow', 'session/list', 'session/page',
    'session/search', 'session/prompt', 'session/cancel', 'session/updateQueue'
  ]) assert.ok(remoteTypes.includes(`'${endpoint}'`), `missing ${endpoint}`)

  const sessionsFace = readPackage('dsh-api-session-controller', 'lib/types/client/contract/sessions.d.ts')
  assertContains(sessionsFace, [
    'create(opts?: {',
    'workspaceId?: WorkspaceId;',
    'cwd?: string;',
    'sessionId?: SessionId;',
    'open(id: SessionId): void;',
    'clear(): void;',
    'refresh(): Promise<void>;'
  ], 'public ctx.sessions face')

  const serviceTypes = readPackage('dsh-api-session-controller', 'lib/types/client/sessions/service.d.ts')
  assertContains(serviceTypes, [
    'by the time the',
    'promise resolves, the created session is in the list store',
    'binding} resolves it'
  ], 'Session create resolution guarantee')
})

test('descriptor forgery is pinned to strict, conflict-free generated contributions', () => {
  const gateway = readPackage('dsh-api-gateway', 'lib/client.js')
  assertContains(gateway, [
    'contribution repeats ${kind} method',
    'is already mounted',
    'conflicts with the Remote service',
    'conflicts with an existing Remote namespace',
    'scope must select its only lookup parameter',
    'has no strict codec',
    'expected ${contract}, got',
    'rejected ${JSON.stringify(field)}'
  ], 'Gateway descriptor verifier')
  assert.match(gateway, /for \(const dispose of installed\.reverse\(\)\) await dispose\(\)/u)
})

test('application event vocabulary is exact and ordinary Session events are emit-only', () => {
  const declaration = readPackage('dsh-api-remotes', 'lib/types/remote-events.d.ts')
  const names = [...declaration.matchAll(/readonly event: "([^"]+)";/gu)].map(match => match[1])
  assert.deepEqual(new Set(names), forwardedEvents)
  for (const event of ['api-session/activity', 'api-session/added', 'api-session/error', 'api-session/removed', 'api-session/status']) {
    assert.match(declaration, new RegExp(`readonly event: "${event.replace('/', '\\/')}";\\s+readonly mode: "emit";`, 'u'))
  }
  const remotesReadme = readPackage('dsh-api-remotes', 'README.md')
  const gatewayReadme = readPackage('dsh-api-gateway', 'README.md')
  assert.match(remotesReadme, /Ordinary forwarded events are not replayed/u)
  assert.match(gatewayReadme, /Ordinary notifications are not replayed/u)
})

test('malformed and non-allowlisted forged events fail the Desktop boundary oracle', () => {
  assert.throws(() => acceptDesktopForwardedEvent({ type: 'emit', event: 'api-session/status', args: [], extra: true }), /keys must be exact/u)
  assert.throws(() => acceptDesktopForwardedEvent({ type: 'emit', event: 'host/forged', args: [] }), /allowlist/u)
  assert.throws(() => acceptDesktopForwardedEvent({ type: 'emit', event: 'api-session/status', args: {} }), /Array/u)
  assert.equal(acceptDesktopForwardedEvent({ type: 'emit', event: 'api-session/status', args: ['session-a', true] }).event, 'api-session/status')

  const gateway = readPackage('dsh-api-gateway', 'lib/client.js')
  assertContains(gateway, [
    'hasExactRemoteEventKeys(value, [',
    '!Object.hasOwn(value.request, "agent")',
    '!Object.hasOwn(value.request, "signal")',
    'invalid forwarded Remote event frame'
  ], 'Gateway event parser')
  assert.match(gateway, /validRemoteEventName\(value\.event\)/u)
  assert.doesNotMatch(gateway, /API_REMOTE_FORWARDED_EVENTS\.includes/u, 'do not falsely claim a client runtime allowlist check')
})

test('control protocol rejects missing, duplicate, or late opening baselines', () => {
  assert.throws(() => acceptControlGeneration([{ type: 'jobs', sessionId: 's', jobs: [] }]), /cannot precede/u)
  assert.throws(() => acceptControlGeneration([
    { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } },
    { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } }
  ]), /two opening baselines/u)
  assert.doesNotThrow(() => acceptControlGeneration([
    { type: 'baseline', value: { queues: {}, jobs: {}, projections: {} } },
    { type: 'queue', sessionId: 's', items: [] },
    { type: 'projection', sessionId: 's', key: 'title', value: 'T', seq: 4 }
  ]))

  const gateway = readPackage('dsh-api-gateway', 'lib/client.js')
  assertContains(gateway, [
    'emitted more than one opening snapshot',
    'emitted an update before its opening snapshot',
    'this.options.replace(item.value);',
    'item.accept();'
  ], 'RemoteSnapshotStream')
})

test('list baseline, in-flight mutations, metadata hints, and reconnect repull are pinned', () => {
  const sessionClient = readPackage('dsh-api-session-controller', 'lib/client.js')
  assertContains(sessionClient, [
    'const result = await this.remote.session.list({});',
    'mergeOrderedBaseline(established, result.value.items',
    'for (const mutation of mutations)',
    'this.listPhase = "ready";',
    'ctx.on("connection/reset", () => {',
    'sessions.handleConnected();'
  ], 'Session list recovery')

  const types = readPackage('dsh-api-session-controller', 'lib/types/types.d.ts')
  assertContains(types, [
    'partial, possibly stale Session-list hints',
    'readonly asOfSeq: number;',
    'readonly values: SessionProjectionValues;',
    "'api-session/activity'(sessionId: SessionId, updatedAt: number): void;"
  ], 'Session list metadata types')
})

test('journal stale, overlap, gap, reconnect, and malicious page paths fail closed', () => {
  assert.deepEqual(classifyJournalStep(8, { first: 7, last: 8 }), { action: 'ignore', lastCursor: 8 })
  assert.throws(() => classifyJournalStep(8, { first: 8, last: 9 }), /partial overlap/u)
  assert.deepEqual(classifyJournalStep(8, { first: 10, last: 10 }), { action: 'repair', through: 10 })
  assert.deepEqual(classifyJournalStep(8, { first: 9, last: 9 }), { action: 'append', lastCursor: 9 })
  assert.throws(() => classifyJournalStep(8, { first: 10, last: 9 }), /inverted/u)

  const gateway = readPackage('dsh-api-gateway', 'lib/client.js')
  assertContains(gateway, [
    'resumed at a cursor behind the last applied entry',
    'emitted a partially overlapping entry',
    'page contains discontinuous entries',
    'page did not end at its requested cursor',
    'page did not reach its opening cursor',
    'this.replaceThrough(request, cursor',
    'if (!(error instanceof RemoteStreamCarrierError)) throw terminalStreamFailure(error);'
  ], 'RemoteJournalStream')

  const controller = readPackage('dsh-api-session-controller', 'lib/client.js')
  assertContains(controller, [
    'follows: (left, right) => right === left + 1',
    'open: (signal) => remote.session.control(signal)',
    'isSnapshot: (frame) => frame.type === "baseline"'
  ], 'Session stream adapters')
})

test('canonical project ownership cannot be inferred from session metadata', () => {
  assert.throws(() => assertCanonicalProjectInput({ sessionSummary: { cwd: 'D:\\project' } }), /canonical project identity/u)
  assert.throws(() => assertCanonicalProjectInput({ canonicalProjectKey: 'project-a', sessionSummary: { cwd: 'D:\\project' } }), /Workspace identity/u)
  assert.deepEqual(assertCanonicalProjectInput({ canonicalProjectKey: 'project-a', workspaceId: 'workspace-a' }), { workspaceId: 'workspace-a' })

  const summaryTypes = readPackage('dsh-api-session-controller', 'lib/types/types.d.ts')
  assert.match(summaryTypes, /readonly cwd\?: string;/u)
  assert.doesNotMatch(summaryTypes, /canonicalProject/u)
  const queryTypes = readPackage('dsh-session-query', 'lib/types/types.d.ts')
  assert.match(queryTypes, /live: boolean;/u)
  assert.match(queryTypes, /persisted: boolean;/u)
  assert.doesNotMatch(queryTypes, /workspaceId/u)
})

test('projection and query seams remain whole-value/read-only evidence, not project authority', () => {
  const projectionReadme = readPackage('dsh-session-projection', 'README.md')
  assertContains(projectionReadme, [
    'whole current values',
    'Every served value is plain JSON',
    'same state reference for events that do not concern the unit'
  ], 'Session projection contract')

  const queryTypes = readPackage('dsh-session-query', 'lib/types/index.d.ts')
  assertContains(queryTypes, [
    'Unified live-preferred session query service',
    'observeSession(sessionId: SessionId',
    'listSessions(signal?: AbortSignal)'
  ], 'Session query service')
  const queryManifest = manifest('dsh-session-query')
  assert.equal(Object.hasOwn(queryManifest.exports, './client'), false, 'Session Query is not a Client Remote namespace')
})
