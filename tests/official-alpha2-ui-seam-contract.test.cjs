'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const ISOLATED = process.env.DSH_ALPHA2_CANDIDATE_ROOT || ROOT
const TARGET = '0.1.2-alpha.2'

const CASES = Object.freeze([
  { name: '@deepseek-ai/dsh-client-ui-conversation', main: 'lib/client.js', types: 'lib/types/client/index.d.ts', installer: 'patchInstalledConversation', runtime: 'conversationRuntime', decision: 'rebase=verified', patchFiles: ['scripts/patch-official-runtime.mjs'], anchors: ['patchAlpha2ConversationSources', 'CONVERSATION_CACHE_ALPHA2_PATCHED', 'dsh-client-ui-chat'], semantic: /data-conversation-scroll|ConversationRoot/ },
  { name: '@deepseek-ai/dsh-client-ui-tool', main: 'lib/client.js', types: 'lib/types/client/index.d.ts', installer: 'patchInstalledToolResultImages', runtime: 'toolUiRuntime', decision: 'rebase=verified', patchFiles: ['scripts/patch-official-runtime.mjs', 'scripts/tool-result-image-patch.mjs', 'scripts/tool-recoverable-error-patch.mjs'], anchors: ['patchAlpha2ToolResultImageSource', 'REQUIRE_ANCHOR_ALPHA2', 'recoverable-tool-error-v2'], semantic: /ToolCallTree|ToolCall/ },
  { name: '@deepseek-ai/dsh-token-meter', main: 'lib/index.js', types: 'lib/types/index.d.ts', installer: 'patchInstalledTokenMeter', runtime: 'tokenMeterRuntime', decision: 'rebase=verified', patchFiles: ['scripts/patch-official-runtime.mjs'], anchors: ['patchTokenMeterSource', 'TOKEN_USAGE_DETAIL_ANCHOR', 'TOKEN_USAGE_REGISTER_ALPHA2_ORIGINAL'], semantic: /tokenUsageProjectionDefinition|tokenUsage/ },
  { name: '@deepseek-ai/dsh-client-ui-model-selection', main: 'lib/client.js', types: 'lib/types/client/index.d.ts', installer: 'patchInstalledModelSelection', runtime: 'modelSelectionRuntime', decision: 'retired=verified', patchFiles: ['scripts/patch-official-runtime.mjs'], anchors: ['assertOfficialAlpha2Artifact', 'model.reasoning?.defaultEffort', 'const chooseEffort = (effort) =>'], semantic: /ModelDirectoryResolver|reasoningEffort/ },
  { name: '@deepseek-ai/dsh-client-ui-settings-models', main: 'lib/client.js', types: 'lib/types/client/index.d.ts', installer: 'patchInstalledModelSettings', runtime: 'modelSettingsRuntime', decision: 'retired=verified', patchFiles: ['scripts/patch-official-runtime.mjs'], anchors: ['assertOfficialAlpha2Artifact', 'function deriveKeyRef(provider)', 'credentials.describe'], semantic: /credential|provider/ },
  { name: '@deepseek-ai/dsh-client-ui-workspace', main: 'lib/client.js', types: 'lib/types/client/index.d.ts', installer: 'patchInstalledWorkspaceUi', runtime: 'workspaceUiRuntime', decision: 'retired=verified', patchFiles: ['scripts/patch-official-runtime.mjs'], anchors: ['assertOfficialAlpha2Artifact', 'function sessionVisible(session, current, archived)', 'insertSessionBefore'], semantic: /WorkspacePicker|SessionTree/ }
])

const HASHES = Object.freeze({
  '@deepseek-ai/dsh-client-ui-conversation': { main: '49185108A396BC5991ED15399FB622D8A00EFE634135CC28DA08EF429FCCD9A5', types: '44DA3C6405552D83753883DE2AC75A684BD2C31570CAB27B96918C1148D6BB5F' },
  '@deepseek-ai/dsh-client-ui-tool': { main: 'DCFF7D94129FD8B8AF247D480195599D9DB0189133A3A69F7F948E69F2C307B9', types: 'E383435D94DDBE6C7F3A4C7DF7C46DDC627F96A38A003D2F93B4A8DBB756D8B9' },
  '@deepseek-ai/dsh-token-meter': { main: 'A96011805EA7477551F3161FF922DF6C1DE5C5E639995E4AA9395AE6BA816A13', types: 'A6776B092F20A2F03D3551BBC10E01C4BC064EE6ADD060F8B50C7C1FCA824338' },
  '@deepseek-ai/dsh-client-ui-model-selection': { main: '68D80BC1D0C159DDC6079CCBB6E91981C524A1E2B5845986F577170B2A191978', types: 'B0F06B5F85F6E9DFE678B91A94EFD060F4CBCDCDD1E9A23236C5661BCC019EE8' },
  '@deepseek-ai/dsh-client-ui-settings-models': { main: '70DE8C4CE48D9C133005B1F95F8E9E9FE114F3BB2D08A9206C2283469831D74D', types: '8A50BEC5E05C17FC6C38817F98A7639C2949E4CC005E94E6674A97ED3364C5E4' },
  '@deepseek-ai/dsh-client-ui-workspace': { main: 'CEB9BA4061A7C6F2DE7FC18922AC3CEB430DAA4A162C211E4741BC9F6547B42A', types: '3035DE450B788EE77958E91228434C2088257148DEB5478B0ADEE886638E12EA' }
})
const PATCHED_MAIN_HASHES = Object.freeze({
  '@deepseek-ai/dsh-client-ui-conversation': '999A7648EDDF44303265C6E425363C648F19D791475415DFEBDF664023960237',
  '@deepseek-ai/dsh-client-ui-tool': 'BB8C86429964E71F590D35FBB6F112DC56111A5A008F4237CDC6D1447691AA22',
  '@deepseek-ai/dsh-token-meter': 'AC6715EA32475D605B464E97167980FDFEF6CAAA0558B0F8956FED12A482F20B',
  '@deepseek-ai/dsh-client-ui-workspace': 'B47D4AD32FF91ACDC7B27BE85AA184E4579B1973DF2DB04FB8E58A30590FDE0D'
})

function readText(file) { return fs.readFileSync(file, 'utf8') }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase() }
function isolatedPackage(name) { return path.join(ISOLATED, 'node_modules', ...name.split('/')) }
function within(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
function safeExport(value) { return typeof value === 'string' && value.startsWith('./lib/') && !path.isAbsolute(value) && !value.split(/[\\/]+/).includes('..') }

function inspect(spec, patchSource, io = {}) {
  const packageRoot = io.packageRoot || isolatedPackage(spec.name)
  const read = io.readFile || readText
  const resolve = io.resolvePath || ((p) => fs.realpathSync(p))
  const manifestPath = path.join(packageRoot, 'package.json')
  if (!io.manifest && !fs.existsSync(manifestPath)) return { name: spec.name, status: 'unproven=blocked', reason: 'isolated package.json missing' }
  const manifest = io.manifest || JSON.parse(read(manifestPath))
  if (manifest.name !== spec.name || manifest.version !== TARGET) throw new Error(`${spec.name}: manifest identity/version drift`)
  const rootExport = manifest.exports?.['.']
  const clientExport = manifest.exports?.['./client']
  if (!rootExport || rootExport.default !== './lib/index.js' || rootExport.types !== './lib/types/index.d.ts' || !clientExport || !safeExport(clientExport.default) || !safeExport(clientExport.types)) throw new Error(`${spec.name}: exports drift`)
  for (const rel of [rootExport.default, rootExport.types, clientExport.default, clientExport.types, spec.main, spec.types]) {
    if (!safeExport(`./${rel.replace(/^\.\//, '')}`)) throw new Error(`${spec.name}: unsafe export path ${rel}`)
    const absolute = path.resolve(packageRoot, rel)
    const resolved = resolve(absolute)
    if (!within(packageRoot, resolved)) throw new Error(`${spec.name}: resolved path escapes package root`)
    if (!io.readFile && !fs.existsSync(resolved)) throw new Error(`${spec.name}: missing artifact ${rel}`)
  }
  const mainPath = path.resolve(packageRoot, spec.main)
  const typesPath = path.resolve(packageRoot, spec.types)
  const bundle = read(mainPath)
  const types = read(typesPath)
  const mainHash = sha256(bundle)
  if (![HASHES[spec.name].main, PATCHED_MAIN_HASHES[spec.name]].includes(mainHash) || sha256(types) !== HASHES[spec.name].types) throw new Error(`${spec.name}: SHA256 drift`)
  if (!spec.semantic.test(bundle)) throw new Error(`${spec.name}: selected bundle semantic anchor missing`)
  const patchSources = spec.patchFiles.map(file => read(path.join(ROOT, file))).join('\n')
  for (const anchor of spec.anchors) if (!patchSources.includes(anchor)) throw new Error(`${spec.name}: patch anchor missing ${anchor}`)
  if (!patchSource.includes(`export async function ${spec.installer}`) || !patchSource.includes(`const ${spec.runtime} = path.join(root, 'node_modules', '@deepseek-ai', '${spec.name.slice('@deepseek-ai/'.length)}'`)) throw new Error(`${spec.name}: orchestrator drift`)
  return { name: spec.name, status: spec.decision }
}

test('alpha.2 UI evidence presence, hashes, and explicit rebase/retirement decisions are gating', () => {
  const patch = readText(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs'))
  const results = CASES.map(spec => inspect(spec, patch))
  assert.equal(results.length, 6)
  assert.deepEqual(results.map(r => r.status), CASES.map(spec => spec.decision))
  assert.deepEqual(results.map(r => r.status), ['rebase=verified', 'rebase=verified', 'rebase=verified', 'retired=verified', 'retired=verified', 'retired=verified'])
})

function extractFunction(bundle, name) {
  const match = bundle.match(new RegExp(`\\t\\tfunction ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\t\\t\\}`, 'u'))
  if (match === null) throw new Error(`official function missing: ${name}`)
  return match[0].trim()
}

function modelSelectHarness(bundle, state, calls) {
  const original = extractFunction(bundle, 'ModelSelect')
  const cut = original.indexOf('\n\t\t\tconst waiting =')
  assert.ok(cut > 0, 'ModelSelect render boundary drift')
  const testable = `${original.slice(0, cut)}\n\t\t\treturn { choices, effectiveEffort, effortChoices, chooseEffort };\n\t\t}`
  const react = {
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useState: initial => [initial, () => {}],
    useRef: initial => ({ current: initial }),
    useId: () => 'test-id',
    useMemo: factory => factory(),
    useEffect: () => {}
  }
  const ModelSelect = Function('react', `${testable}; return ModelSelect`)(react)
  return ModelSelect({
    locked: false,
    available: true,
    directory: { subscribe: () => () => {}, getSnapshot: () => state },
    load: () => {},
    select: selection => { calls.push(selection); return Promise.resolve(true) },
    t: key => key
  })
}

test('official model selection executes default, override, and provider-default semantics', () => {
  const bundle = readText(path.join(isolatedPackage('@deepseek-ai/dsh-client-ui-model-selection'), 'lib', 'client.js'))
  const calls = []
  const base = { groups: [{ id: 'provider-a', models: [{ id: 'model-a', name: 'Model A', reasoning: { defaultEffort: 'high', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }] }], current: { provider: 'provider-a', model: 'model-a' }, status: 'ready', error: null }
  const withDefault = modelSelectHarness(bundle, base, calls)
  assert.equal(withDefault.effectiveEffort, 'high')
  assert.equal(withDefault.choices[0].selection.reasoningEffort, 'high')
  assert.deepEqual(withDefault.effortChoices.map(choice => choice.effort), ['low', 'high'])
  withDefault.chooseEffort('low')
  assert.deepEqual(calls.pop(), { provider: 'provider-a', model: 'model-a', reasoningEffort: 'low' })

  const providerDefault = modelSelectHarness(bundle, { ...base, groups: [{ id: 'provider-a', models: [{ id: 'model-a', name: 'Model A', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }] }], current: { provider: 'provider-a', model: 'model-a', reasoningEffort: 'low' } }, calls)
  assert.equal(providerDefault.effortChoices[0].effort, undefined)
  providerDefault.chooseEffort(undefined)
  assert.deepEqual(calls.pop(), { provider: 'provider-a', model: 'model-a' })
})

test('official model settings executes credential-key and onboarding gates without reflecting secrets', () => {
  const bundle = readText(path.join(isolatedPackage('@deepseek-ai/dsh-client-ui-settings-models'), 'lib', 'client.js'))
  const deriveKeyRef = Function(`${extractFunction(bundle, 'deriveKeyRef')}; return deriveKeyRef`)()
  assert.equal(deriveKeyRef('minimax-cn'), 'MINIMAX_CN_API_KEY')
  assert.equal(deriveKeyRef('vendor///route'), 'VENDOR_ROUTE_API_KEY')

  const start = bundle.indexOf('\t\tfunction providerUsable(')
  const end = bundle.indexOf('\t\t//#endregion', start)
  assert.ok(start >= 0 && end > start, 'onboarding region drift')
  const readiness = Function(`${bundle.slice(start, end)}; return onboardingReadiness`)()
  const entry = { active: true, provider: 'deepseek-official', settingsNs: 'llm-deepseek', settingsPath: [] }
  const state = overrides => ({ status: 'ready', rows: [{ entry, apiKeyEnv: 'DEEPSEEK_API_KEY', credential: { configured: false, writable: true } }], credentialError: null, writable: true, ...overrides })
  assert.deepEqual(readiness({ status: 'loading', rows: [] }), { kind: 'loading' })
  assert.deepEqual(readiness(state({ rows: [{ entry: { ...entry, provider: 'other', active: false }, credential: { configured: false, writable: true } }] })), { kind: 'adapter-absent' })
  assert.deepEqual(readiness(state({ rows: [{ entry: { ...entry, active: false }, credential: { configured: false, writable: true } }] })), { kind: 'unavailable', reason: 'provider-inactive' })
  assert.deepEqual(readiness(state({ credentialError: 'offline' })), { kind: 'unavailable', reason: 'credentials-unavailable' })
  assert.deepEqual(readiness(state({ writable: false })), { kind: 'unavailable', reason: 'settings-read-only' })
  assert.deepEqual(readiness(state({ rows: [{ entry, apiKeyEnv: 'DEEPSEEK_API_KEY', credential: { configured: false, writable: false } }] })), { kind: 'unavailable', reason: 'credential-read-only' })
  assert.deepEqual(readiness(state({})), { kind: 'credential-missing' })
  assert.deepEqual(readiness(state({ rows: [{ entry: { ...entry, provider: 'other', active: true }, apiKeyEnv: undefined }] })), { kind: 'provider-ready' })

  const applyStart = bundle.indexOf('\t\t\tconst applyOnce = async () => {')
  const applyEnd = bundle.indexOf('\t\t\tconst apply = async () => {', applyStart)
  const apply = bundle.slice(applyStart, applyEnd)
  assert.ok(apply.indexOf('operations.writeSettings') < apply.indexOf('operations.storeCredential'), 'settings must commit before credential storage')
  assert.match(apply, /setKeyDraft\(""\)/u)
  assert.doesNotMatch(apply, /setKeyDraft\(keyValue\)/u)
})

test('official workspace and token folds execute visibility, ordering, replacement, and retry semantics', () => {
  const workspaceBundle = readText(path.join(isolatedPackage('@deepseek-ai/dsh-client-ui-workspace'), 'lib', 'client.js'))
  const workspaceStart = workspaceBundle.indexOf('\t\tfunction byRecency(')
  const workspaceEnd = workspaceBundle.indexOf('\t\t/** Keep navigation', workspaceStart)
  const workspace = Function(`${workspaceBundle.slice(workspaceStart, workspaceEnd)}; return { sessionVisible, orderedUngrouped, groupByWorkspace }`)()
  const session = (id, updatedAt, extra = {}) => ({ id, updatedAt, origin: 'user', blank: false, ...extra })
  const archived = new Set(['archived'])
  assert.equal(workspace.sessionVisible(session('sub', 1, { origin: 'subagent' }), 'sub', archived), false)
  assert.equal(workspace.sessionVisible(session('archived', 1), 'archived', archived), false)
  assert.equal(workspace.sessionVisible(session('blank', 1, { blank: true }), 'other', archived), false)
  assert.equal(workspace.sessionVisible(session('blank', 1, { blank: true }), 'blank', archived), true)
  assert.deepEqual(workspace.orderedUngrouped([session('a', 1), session('b', 3), session('c', 2)], ['c', 'missing', 'c']).map(item => item.id), ['c', 'b', 'a'])
  const byId = { a: session('a', 1), b: session('b', 2), sub: session('sub', 4, { origin: 'subagent' }), archived: session('archived', 5), blank: session('blank', 6, { blank: true }), stray: session('stray', 7) }
  const groups = workspace.groupByWorkspace({ ids: Object.keys(byId), byId, current: 'blank' }, [{ workspaceId: 'w', path: '/w', createdAt: '2026-01-01T00:00:00Z', title: 'W', sessionIds: ['b', 'a', 'sub', 'archived', 'blank'] }], archived)
  assert.deepEqual(groups[0].sessions.map(item => item.id), ['b', 'a', 'blank'])
  assert.deepEqual(groups[1].sessions.map(item => item.id), ['stray'])

  const tokenBundle = readText(path.join(isolatedPackage('@deepseek-ai/dsh-token-meter'), 'lib', 'index.js'))
  const tokenStart = tokenBundle.indexOf('const zeroBuckets')
  const tokenEnd = tokenBundle.indexOf("/**\n* Token-meter's context-occupancy projection unit.", tokenStart)
  assert.ok(tokenStart >= 0 && tokenEnd > tokenStart, 'token usage projection region drift')
  const z = new Proxy(function zChain () {}, { get: () => () => z })
  const projection = Function('z$1', `${tokenBundle.slice(tokenStart, tokenEnd)}; return tokenUsageProjectionDefinition`)(z)
  const usage = (type, values) => type === 'chunk' ? { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: values } } } : { type: 'assistant/message', data: { turn: 1, step: 1, usage: values } }
  const first = projection.apply(projection.init(), usage('chunk', { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 }))
  assert.deepEqual(first.totals, { uncachedInputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 })
  assert.equal(projection.apply(first, usage('chunk', { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 })), first)
  const final = projection.apply(first, usage('message', { inputTokens: 12, outputTokens: 4, cacheReadTokens: 5 }))
  assert.deepEqual(final.totals, { uncachedInputTokens: 12, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 0 })
  const retry = projection.apply(final, { type: 'llm/retry-started', data: { turn: 1, step: 1 } })
  assert.equal(retry.last, null)
  const retried = projection.apply(retry, usage('message', { inputTokens: 12, outputTokens: 4, cacheReadTokens: 5 }))
  assert.deepEqual(retried.totals, { uncachedInputTokens: 24, outputTokens: 8, cacheReadTokens: 10, cacheWriteTokens: 0 })
})

test('malicious manifest paths and symlink-like resolution are rejected', () => {
  const spec = CASES[0]
  const base = { name: spec.name, version: TARGET, exports: { '.': { default: './lib/index.js', types: './lib/types/index.d.ts' }, './client': { default: './lib/client.js', types: './lib/types/client/index.d.ts' } } }
  const files = new Map([['/pkg/lib/client.js', 'ConversationRoot'], ['/pkg/lib/types/client/index.d.ts', 'type'], ['/pkg/lib/index.js', 'index'], ['/pkg/lib/types/index.d.ts', 'types']])
  const read = p => files.get(p) || ''
  assert.throws(() => inspect({ ...spec, main: '../outside.js' }, '', { packageRoot: '/pkg', manifest: base, readFile: read, resolvePath: p => p }), /unsafe export path/)
  assert.throws(() => inspect(spec, '', { packageRoot: '/pkg', manifest: { ...base, exports: { ...base.exports, './client': { default: '/outside.js', types: './lib/types/client/index.d.ts' } } }, readFile: read, resolvePath: p => p }), /exports drift/)
  assert.throws(() => inspect(spec, '', { packageRoot: '/pkg', manifest: base, readFile: read, resolvePath: p => p.includes('client.js') ? '/outside/client.js' : p }), /escapes package root/)
})

module.exports = { CASES, HASHES, inspect }
