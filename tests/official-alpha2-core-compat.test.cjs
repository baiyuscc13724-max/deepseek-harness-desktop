'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

// Alpha.2 bundle bytes remain auditable on demand; current smoke is guarded by alpha.3 contracts.
const alpha2Audit = process.env.DSH_HISTORICAL_ALPHA2_AUDIT === '1' ? test : test.skip
const ROOT = path.resolve(__dirname, '..')
const ALPHA_ROOT = process.env.DSH_ALPHA2_CANDIDATE_ROOT || ROOT
const SCOPE = path.join(ALPHA_ROOT, 'node_modules', '@deepseek-ai')

function alpha(name, relative) {
  return path.join(SCOPE, name, relative)
}

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

test('alpha.2 Connection/Gateway and Desktop launcher pin slash endpoints with descriptor-shaped payloads', () => {
  const connection = fs.readFileSync(alpha('dsh-client-connection', 'lib/index.js'), 'utf8')
  const sessionRemote = fs.readFileSync(alpha('dsh-api-session-controller', 'lib/typert.remote-client.d.ts'), 'utf8')
  const main = source('electron/main.cjs')
  const launcher = source('electron/bridge/agent-teams-session-launch-service.cjs')

  assert.match(connection, /const API_PATH = "\/api"/u)
  assert.match(connection, /endpointFromPath\(channel, new URL\(request\.url\)\.pathname\)/u)
  assert.match(connection, /message\.method !== endpoint/u)
  assert.match(sessionRemote, /['"]session\/create['"]/u)
  assert.match(sessionRemote, /['"]session\/list['"]/u)
  assert.doesNotMatch(sessionRemote, /['"]session\.create['"]/u)
  assert.doesNotMatch(sessionRemote, /['"]session\.list['"]/u)

  assert.match(main, /const OFFICIAL_RUNTIME_RPC_ENDPOINTS = new Set\(\[[\s\S]*?'session\/prompt'[\s\S]*?'workspace\/create'/u)
  assert.match(main, /new URL\(`\/api\/\$\{endpoint\}`/u)
  assert.match(main, /method: endpoint, payload/u)
  assert.match(launcher, /callRuntimeRpc\('workspace\/create', \{ args: \{ request: \{ path: binding\.workspacePath \} \} \}\)/u)
  assert.match(launcher, /callRuntimeRpc\('session\/list', \{ args: \{ _request: \{\} \} \}\)/u)
  assert.match(launcher, /callRuntimeRpc\('session\/create', \{ args: \{ request: \{ workspaceId: operation\.workspaceId, sessionId: operation\.sessionId \} \} \}\)/u)
  assert.match(launcher, /callRuntimeRpc\('session\/rename', \{ args: \{ request: \{ sessionId: operation\.sessionId, title: operation\.title \} \} \}\)/u)
  assert.match(launcher, /callRuntimeRpc\('session\/prompt', \{ args: \{ request: \{ requestId: operation\.promptRequestId, sessionId: operation\.sessionId, mode: 'queue'/u)
  assert.ok(launcher.indexOf('operation.promptRequestId = opaque(') < launcher.indexOf("operation.phase = 'prompt_dispatched'"), 'prompt request identity must persist before dispatch')
  assert.doesNotMatch(launcher, /callRuntimeRpc\(['"](?:workspace|session)\./u)
})

test('alpha.2 public operation map fixes exact descriptors, codecs, streams, and removed legacy faces', () => {
  const workspaceRemote = fs.readFileSync(alpha('dsh-api-workspace-controller', 'lib/typert.remote-client.js'), 'utf8')
  const workspaceTypes = fs.readFileSync(alpha('dsh-api-workspace-controller', 'lib/types/types.d.ts'), 'utf8')
  const sessionRemote = fs.readFileSync(alpha('dsh-api-session-controller', 'lib/typert.remote-client.js'), 'utf8')
  const sessionTypes = fs.readFileSync(alpha('dsh-api-session-controller', 'lib/types/types.d.ts'), 'utf8')
  const settingsRemote = fs.readFileSync(alpha('dsh-api-settings-controller', 'lib/typert.remote-client.js'), 'utf8')
  const inventoryRemote = fs.readFileSync(alpha('dsh-host-plugin-inventory', 'lib/typert.remote-client.js'), 'utf8')
  const forwardedEvents = fs.readFileSync(alpha('dsh-api-remotes', 'lib/types/remote-events.js'), 'utf8')
  const main = source('electron/main.cjs')
  const pet = source('electron/pet/pet-event-adapter.cjs')
  const mobileSync = source('electron/bridge/mobile-sync-service.cjs')
  const mobileRuntime = source('mobile/ios/HarnessMobile/Resources/mobile-runtime.js')
  const androidRuntime = source('mobile/android/app/src/main/assets/mobile-runtime.js')

  assert.match(workspaceRemote, /id: '@deepseek-ai\/dsh-api-workspace-controller#workspace\/create'[\s\S]*?wire: 'request'/u)
  assert.match(workspaceRemote, /id: '@deepseek-ai\/dsh-api-workspace-controller#workspace\/follow'[\s\S]*?mode: 'stream'[\s\S]*?parameters: \[\s*\]/u)
  assert.match(workspaceTypes, /type WorkspaceFollowFrame = \{[\s\S]*?type: 'baseline';[\s\S]*?value: WorkspaceBaseline/u)
  assert.doesNotMatch(workspaceRemote, /#workspace\/list'/u)

  assert.match(sessionRemote, /id: '@deepseek-ai\/dsh-api-session-controller#session\/list'[\s\S]*?wire: '_request'/u)
  for (const method of ['create', 'prompt', 'rename']) {
    assert.match(sessionRemote, new RegExp(`#session/${method}'[\\s\\S]*?wire: 'request'`, 'u'))
  }
  assert.match(sessionTypes, /interface SessionPromptRequest \{[\s\S]*?readonly requestId: SessionRequestId;[\s\S]*?readonly mode: 'queue' \| 'steer';/u)
  assert.match(sessionTypes, /interface SessionRenameValue \{[\s\S]*?readonly title: string;[\s\S]*?readonly seq: number;/u)
  assert.match(sessionTypes, /interface ModelCatalog \{[\s\S]*?readonly default: ModelSelection;/u)
  assert.match(sessionTypes, /type SessionFollowFrame = \{[\s\S]*?type: 'snapshot';[\s\S]*?cursor: number;[\s\S]*?projections: SessionProjectionBaseline;/u)
  assert.match(sessionTypes, /readonly rpcId\?: SessionRequestId;/u)

  assert.match(settingsRemote, /#settings\/describe'[\s\S]*?parameters: \[\s*\]/u)
  assert.match(inventoryRemote, /#pluginInventory\/list'[\s\S]*?parameters: \[\s*\]/u)
  assert.match(forwardedEvents, /\{ event: 'approval\/request', mode: 'waterfall' \}/u)
  assert.match(forwardedEvents, /\{ event: 'user-questions\/request', mode: 'waterfall' \}/u)
  assert.doesNotMatch(forwardedEvents, /approval\/requested|question\/requested/u)

  assert.match(main, /callRuntimeRpc\('pluginInventory\/list', \{ args: \{\} \}\)/u)
  assert.match(main, /callRuntimeRpc\('settings\/describe', \{ args: \{\} \}\)/u)
  assert.match(pet, /const PET_UNARY_ENDPOINTS = new Set\(\['\$events\/result', 'session\/list', 'session\/modelCatalog'\]\)/u)
  assert.match(pet, /this\.call\('session\/modelCatalog', \{ args: \{\} \}\)/u)
  assert.match(pet, /this\.call\('session\/list', \{ args: \{ _request: \{\} \} \}\)/u)
  assert.match(pet, /endpoint: '\$events', payload: \{ args: \{\} \}/u)
  assert.match(pet, /endpoint: 'session\/control', payload: \{ args: \{\} \}/u)
  assert.doesNotMatch(pet, /host\.describe|session\.list|session\.models|events\.host|events\.mux/u)

  assert.match(mobileSync, /const method = 'session\/list'[\s\S]*?payload: \{ args: \{ _request: \{\} \} \}/u)
  assert.match(mobileSync, /endpoint: 'workspace\/follow', payload: \{ args: \{\} \}/u)
  assert.match(mobileSync, /frame\.value\?\.type !== 'baseline'/u)
  assert.doesNotMatch(mobileSync, /workspace\.list|session\.list/u)

  assert.equal(androidRuntime, mobileRuntime, 'Android and iOS mobile runtime contracts must remain byte-identical')
  assert.match(mobileRuntime, /endpoint: 'workspace\/follow', payload: \{ args: \{\} \}/u)
  assert.match(mobileRuntime, /method === 'session\/list' && url\.pathname === '\/api\/session\/list'[\s\S]*?payload\?\.args\?\._request/u)
  assert.doesNotMatch(mobileRuntime, /workspace\.list|session\.list|\/api\/workspace\.list|\/api\/session\.list/u)
})

test('removed rc.2 compatibility packages have no alpha.2 artifact', () => {
  for (const name of ['dsh-client-runtime', 'dsh-host-apiproxy']) {
    assert.equal(fs.existsSync(path.join(SCOPE, name)), false, `${name} must not be silently retained in the alpha.2 graph`)
  }
})

async function createDigestFixture(t, files = new Map([['a.txt', Buffer.from('alpha')]])) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-hermetic-tree-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  for (const [relative, bytes] of files) {
    await fsp.mkdir(path.dirname(path.join(root, ...relative.split('/'))), { recursive: true })
    await fsp.writeFile(path.join(root, ...relative.split('/')), bytes)
  }
  return { root, files }
}

function frozenRow(relative, bytes) {
  return `${relative}|${createHash('sha256').update(bytes).digest('hex').toUpperCase()}`
}

async function writeFixtureManifest(root, name, rowsOrBytes) {
  const target = path.join(root, name)
  await fsp.writeFile(target, Buffer.isBuffer(rowsOrBytes) ? rowsOrBytes : Buffer.from(`${rowsOrBytes.join('\r\n')}\r\n`))
  return target
}

test('canonical hermetic tree digest binds normalized path, byte count, and file digest', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-hermetic-tree-'))
  t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.mkdir(path.join(root, 'sub'))
  const files = new Map([
    ['a.txt', Buffer.from('alpha')],
    ['sub/z.bin', Buffer.from([0, 255, 10])]
  ])
  for (const [relative, bytes] of files) await fsp.writeFile(path.join(root, ...relative.split('/')), bytes)
  const expected = createHash('sha256')
  for (const relative of [...files.keys()].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
    const bytes = files.get(relative)
    const fileSha256 = createHash('sha256').update(bytes).digest('hex')
    expected.update(Buffer.concat([
      Buffer.from(relative), Buffer.from([0]), Buffer.from(String(bytes.length)), Buffer.from([0]), Buffer.from(fileSha256), Buffer.from('\n')
    ]))
  }
  const { digestFileTree } = await import('../scripts/hermetic-tree-digest.mjs')
  const evidence = await digestFileTree(root)
  assert.equal(evidence.fileCount, 2)
  assert.equal(evidence.totalBytes, '8')
  assert.equal(evidence.treeSha256, expected.digest('hex').toUpperCase())
})

test('frozen manifests reject duplicate and slash-normalization-colliding canonical paths', async t => {
  const files = new Map([['sub/z.bin', Buffer.from([1, 2, 3])]])
  const { root } = await createDigestFixture(t, files)
  const shaRow = frozenRow('sub\\z.bin', files.get('sub/z.bin'))
  const { digestFileTree } = await import('../scripts/hermetic-tree-digest.mjs')
  const duplicate = await writeFixtureManifest(root, 'duplicate.manifest', [shaRow, shaRow])
  await assert.rejects(digestFileTree(root, { frozenManifestPath: duplicate }), /duplicate canonical path/u)
  const collision = await writeFixtureManifest(root, 'collision.manifest', [shaRow, frozenRow('sub/z.bin', files.get('sub/z.bin'))])
  await assert.rejects(digestFileTree(root, { frozenManifestPath: collision }), /duplicate canonical path/u)
})

test('frozen manifests and observed paths reject malformed UTF-8 and malformed canonical paths', async t => {
  const { root, files } = await createDigestFixture(t)
  const { assertCanonicalRelativePath, digestFileTree } = await import('../scripts/hermetic-tree-digest.mjs')
  const malformedUtf8 = await writeFixtureManifest(root, 'malformed-utf8.manifest', Buffer.from([0xff, 0x0a]))
  await assert.rejects(digestFileTree(root, { frozenManifestPath: malformedUtf8 }), /not valid UTF-8/u)
  const blank = await writeFixtureManifest(root, 'blank.manifest', [frozenRow('a.txt', files.get('a.txt')), '', frozenRow('other.txt', Buffer.from('x'))])
  await assert.rejects(digestFileTree(root, { frozenManifestPath: blank }), /blank or missing row/u)
  const traversal = await writeFixtureManifest(root, 'traversal.manifest', [frozenRow('..\\a.txt', files.get('a.txt'))])
  await assert.rejects(digestFileTree(root, { frozenManifestPath: traversal }), /unsafe or empty segment/u)
  assert.throws(() => assertCanonicalRelativePath(`bad-${String.fromCharCode(0xd800)}.txt`), /does not round-trip through UTF-8/u)
})

test('frozen manifest content mismatch fails closed instead of returning weak evidence', async t => {
  const { root } = await createDigestFixture(t)
  const mismatch = await writeFixtureManifest(root, 'mismatch.manifest', [`a.txt|${'0'.repeat(64)}`])
  const { digestFileTree } = await import('../scripts/hermetic-tree-digest.mjs')
  await assert.rejects(digestFileTree(root, { frozenManifestPath: mismatch }), /does not exactly match the observed tree/u)
})

test('hermetic tree digest rejects symlink or reparse entries when the platform supports them', async t => {
  const { root } = await createDigestFixture(t)
  try {
    await fsp.symlink(path.join(root, 'a.txt'), path.join(root, 'alias.txt'), 'file')
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'UNKNOWN'].includes(error?.code)) { t.skip(`symlink creation unavailable: ${error.code}`); return }
    throw error
  }
  const { digestFileTree } = await import('../scripts/hermetic-tree-digest.mjs')
  await assert.rejects(digestFileTree(root), /Symbolic links are not accepted|changed type before hashing/u)
})

const UI_CASES = Object.freeze([
  ['conversation', 'dsh-client-ui-conversation', 'lib/client.js', 'patchInstalledConversation', true],
  ['tool', 'dsh-client-ui-tool', 'lib/client.js', 'patchInstalledToolResultImages', true],
  ['token', 'dsh-token-meter', 'lib/index.js', 'patchInstalledTokenMeter', true],
  ['model-selection', 'dsh-client-ui-model-selection', 'lib/client.js', 'patchInstalledModelSelection', false],
  ['model-settings', 'dsh-client-ui-settings-models', 'lib/client.js', 'patchInstalledModelSettings', false],
  ['workspace', 'dsh-client-ui-workspace', 'lib/client.js', 'patchInstalledWorkspaceUi', true],
])
const UI_PACKAGES = [...new Set([...UI_CASES.map(([, pkg]) => pkg), 'dsh-client-ui-chat'])]

async function stageUiPackages(t) {
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'official-alpha2-core-compat-'))
  t.after(() => fsp.rm(temp, { recursive: true, force: true }))
  const scope = path.join(temp, 'node_modules', '@deepseek-ai')
  await fsp.mkdir(scope, { recursive: true })
  for (const pkg of UI_PACKAGES) await fsp.cp(path.join(SCOPE, pkg), path.join(scope, pkg), { recursive: true })
  return scope
}

alpha2Audit('all six alpha.2 UI decisions are positive, idempotent, and compose in one package graph', async t => {
  const patch = await import('../scripts/patch-official-runtime.mjs')
  const scope = await stageUiPackages(t)
  for (const [label, pkg, relative, installer, expectedChanged] of UI_CASES) {
    const target = path.join(scope, pkg, relative)
    const before = await fsp.readFile(target)
    const changed = await patch[installer](target)
    const after = await fsp.readFile(target)
    assert.equal(await patch[installer](target), false, `${label} complete artifact must be idempotent`)
    assert.deepEqual(await fsp.readFile(target), after, `${label} idempotent bytes`)
    if (expectedChanged) {
      assert.ok(changed || Buffer.compare(after, before) === 0, `${label} must be patched from the exact official artifact or already be the exact complete patch`)
      if (changed) assert.notDeepEqual(after, before, `${label} patch must change its owner artifact`)
      else assert.deepEqual(after, before, `${label} already-patched artifact must remain byte-identical`)
    } else assert.deepEqual(after, before, `${label} official retirement must preserve bytes`)
    const text = after.toString('utf8')
    if (label !== 'token') assert.doesNotThrow(() => new Function(text), `${label} patched/retired browser bundle must remain parseable`)
    if (label === 'conversation') {
      const chat = await fsp.readFile(path.join(scope, 'dsh-client-ui-chat', 'lib', 'client.js'), 'utf8')
      assert.doesNotThrow(() => new Function(chat), 'conversation chat companion must remain parseable')
      assert.match(chat, /cacheDetail = useProjection\("tokenUsageDetail"\)/u)
      assert.match(chat, /followSigRef/u)
      assert.match(chat, /const TurnProcessNodeView/u)
      assert.match(text, /Agent team message /u)
    } else if (label === 'tool') {
      assert.match(text, /function resultImages\(block\)/u)
      assert.match(text, /recoverable-tool-error-v2/u)
      assert.doesNotMatch(text, /function ResultDeliverables/u)
      assert.doesNotMatch(text, /sessionId, callId, toolName/u)
      const resultStart = text.indexOf('\t\tfunction resultText(')
      const resultEnd = text.indexOf('\t\tfunction parseArgs(', resultStart)
      assert.ok(resultStart >= 0 && resultEnd > resultStart, 'tool result projection region drift')
      const result = Function(`${text.slice(resultStart, resultEnd)}; return { resultText, resultImages }`)()
      const settled = { kind: 'tool-result', content: [{ type: 'text', text: 'ok' }, { type: 'image' }, { type: 'image', attachment: 'durable-ref' }, { type: 'extension', value: 1 }] }
      assert.deepEqual(result.resultImages(settled), [{ attachment: 'durable-ref' }])
      assert.deepEqual(result.resultImages({ name: 'streaming', content: settled.content }), [])
      assert.match(result.resultText(settled), /^ok\n\{/u)
      assert.doesNotMatch(result.resultText(settled), /durable-ref/u)
    } else if (label === 'token') {
      assert.match(text, /register\(tokenUsageProjectionDefinition\);[\s\S]*register\(tokenUsageDetailProjectionDefinition\);[\s\S]*register\(contextPressureProjectionDefinition\);[\s\S]*register\(contextBreakdownProjectionDefinition\);/u)
    }
  }
})

alpha2Audit('alpha.2 UI source drift and forged partial evidence fail closed', async t => {
  const patch = await import('../scripts/patch-official-runtime.mjs')
  const scope = await stageUiPackages(t)
  for (const [pkg, installer] of [
    ['dsh-client-ui-model-selection', 'patchInstalledModelSelection'],
    ['dsh-client-ui-settings-models', 'patchInstalledModelSettings']
  ]) {
    const retired = path.join(scope, pkg, 'lib', 'client.js')
    const drifted = Buffer.concat([await fsp.readFile(retired), Buffer.from('\n// drift')])
    await fsp.writeFile(retired, drifted)
    await assert.rejects(patch[installer](retired), /source hash changed/u)
    assert.deepEqual(await fsp.readFile(retired), drifted)
  }

  const workspace = path.join(scope, 'dsh-client-ui-workspace', 'lib', 'client.js')
  const workspaceOriginal = await fsp.readFile(workspace, 'utf8')
  const workspaceDrift = workspaceOriginal.replace('this.connectWorkspace(target).then', 'this.connectWorkspace(target, drift).then')
  await fsp.writeFile(workspace, workspaceDrift)
  await assert.rejects(patch.patchInstalledWorkspaceUi(workspace), /neither exact official nor exact complete patched artifact/u)
  assert.equal(await fsp.readFile(workspace, 'utf8'), workspaceDrift)
  await fsp.writeFile(workspace, workspaceOriginal)
  await patch.patchInstalledWorkspaceUi(workspace)
  assert.equal(await patch.patchInstalledWorkspaceUi(workspace), false, 'workspace must resolve to an exact complete patch')
  const workspacePatched = await fsp.readFile(workspace, 'utf8')
  const workspacePartial = workspacePatched.replace('this.pendingSessionWorkspaceTarget = target;', 'this.pendingSessionWorkspaceTarget = drift;')
  assert.notEqual(workspacePartial, workspacePatched)
  await fsp.writeFile(workspace, workspacePartial)
  await assert.rejects(patch.patchInstalledWorkspaceUi(workspace), /neither exact official nor exact complete patched artifact/u)
  assert.equal(await fsp.readFile(workspace, 'utf8'), workspacePartial)

  const conversation = path.join(scope, 'dsh-client-ui-conversation', 'lib', 'client.js')
  const conversationOriginal = await fsp.readFile(conversation, 'utf8')
  const queueOriginal = 'const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued"), [inbox]);'
  const queuePartial = 'const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued" && !String(row.text ?? row.preview ?? "").startsWith("[Agent team message ")), [inbox]);'
  const conversationPatchState = conversationOriginal.includes(queuePartial) ? queuePartial : queueOriginal
  const conversationPartial = conversationOriginal.replace(conversationPatchState, conversationPatchState === queuePartial ? queueOriginal : queuePartial)
  assert.notEqual(conversationPartial, conversationOriginal, 'conversation partial fixture must alter an exact patch marker')
  await fsp.writeFile(conversation, conversationPartial)
  await assert.rejects(patch.patchInstalledConversation(conversation), /patch is incomplete/u)
  assert.equal(await fsp.readFile(conversation, 'utf8'), conversationPartial)

  const token = path.join(scope, 'dsh-token-meter', 'lib', 'index.js')
  const tokenOriginal = await fsp.readFile(token, 'utf8')
  const partialToken = tokenOriginal.includes('const tokenUsageDetailProjectionDefinition = {')
    ? tokenOriginal.replaceAll('lastCacheReadReported:', 'lastCacheReadDrift:')
    : `${tokenOriginal}\nkey: "tokenUsageDetail"`
  assert.notEqual(partialToken, tokenOriginal, 'token partial fixture must alter an exact patch marker')
  await fsp.writeFile(token, partialToken)
  await assert.rejects(patch.patchInstalledTokenMeter(token), /patch is incomplete/u)
  assert.equal(await fsp.readFile(token, 'utf8'), partialToken)

  const tool = path.join(scope, 'dsh-client-ui-tool', 'lib', 'client.js')
  const toolOriginal = await fsp.readFile(tool, 'utf8')
  const forged = Buffer.from(toolOriginal.includes('@harness-desktop/recoverable-tool-error-v2')
    ? toolOriginal.replaceAll('@harness-desktop/recoverable-tool-error-v2', '@harness-desktop/recoverable-tool-error-drift')
    : `${toolOriginal}\nfunction resultImages(block) {}`)
  assert.notDeepEqual(forged, Buffer.from(toolOriginal), 'tool partial fixture must alter an exact patch marker')
  await fsp.writeFile(tool, forged)
  await assert.rejects(patch.patchInstalledToolResultImages(tool), /patch is incomplete/u)
  assert.deepEqual(await fsp.readFile(tool), forged)
})
