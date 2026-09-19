'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { once } = require('node:events')
const { createAgentTeamsAuthorizationService, TOKEN_ENV } = require('../electron/bridge/agent-teams-authorization-service.cjs')
const { createAgentTeamsSecretService } = require('../electron/bridge/agent-teams-secret-service.cjs')
const { ComponentUpdateStore, atomicWriteJson } = require('../electron/bridge/component-update-store.cjs')
const { prepareComponentActivation } = require('../electron/bridge/component-update-health.cjs')
const { ensureRuntimeNodeModules } = require('../electron/bridge/runtime-bundle-service.cjs')
const vm = require('node:vm')
const { createRequire } = require('node:module')

test('runtime cache commit never deletes a competing published cache', async () => {
  const filename = require.resolve('../electron/bridge/runtime-bundle-service.cjs')
  const source = await readFile(filename, 'utf8')
  const localRequire = createRequire(filename)
  let deletedWinner = false, ready = false
  const fakeFs = {
    ...require('node:fs/promises'),
    access: async () => {},
    readFile: async () => ready ? 'fixture-marker' : 'not-ready',
    mkdir: async () => { ready = true },
    rm: async target => { if (target === 'fixture-cache') deletedWinner = true },
    rename: async () => { throw Object.assign(new Error('winner exists'), { code: 'EEXIST' }) }
  }
  const context = { module: { exports: {} }, require: id => id === 'node:fs/promises' ? fakeFs : localRequire(id), process, setTimeout, Buffer }
  vm.runInNewContext(source + '\nmodule.exports.auditCommit = commitRuntimeCache', context, { filename })
  await context.module.exports.auditCommit({ stagingRoot: 'fixture-staging', cacheRoot: 'fixture-cache', destination: 'fixture-destination', markerValue: 'fixture-marker' })
  assert.equal(deletedWinner, false)
})

test('proxy IPv6 and CONNECT destination validation rejects invalid ports and header injection before network', async () => {
  const filename = require.resolve('../electron/bridge/tcp-connect-bridge.cjs'), localRequire = createRequire(filename)
  const context = { module: { exports: {} }, require: id => id === 'node:net' ? { isIP: net.isIP, createServer: () => { throw new Error('unexpected network access') } } : localRequire(id), Buffer, setTimeout, clearTimeout }
  vm.runInNewContext(await readFile(filename, 'utf8'), context, { filename })
  const api = context.module.exports
  assert.equal(api.parseHostPort('[::1]:0'), null)
  assert.equal(api.parseHostPort('[::1]:65536'), null)
  assert.equal(api.parseHostPort('[not-ip]:80'), null)
  for (const target of [{ targetHost: 'relay.test\r\nX-Injected: yes', targetPort: 443 }, { targetHost: 'relay.test', targetPort: 0 }, { targetHost: 'relay.test', targetPort: 65536 }]) {
    assert.throws(() => api.createConnectBridge({ proxy: { host: '127.0.0.1', port: 8080 }, ...target }), /Relay target/)
  }
})

test('EasyTier cached executable corruption is never returned as verified', async t => {
  const root = await fixture(t), AdmZip = require('adm-zip')
  const { createEasyTierComponentInstaller, hashBuffer } = require('../electron/bridge/network-component-service.cjs')
  const zip = new AdmZip(); zip.addFile('fixture/easytier-core.exe', Buffer.from('verified fixture'))
  const archive = zip.toBuffer(); let requests = 0
  const installer = createEasyTierComponentInstaller({ componentRoot: root, platform: 'win32', release: { version: 'fixture', url: 'https://example.invalid/fixture.zip', sha256: hashBuffer(archive), executable: 'easytier-core.exe' }, fetchImpl: async () => { requests++; return { ok: true, body: (async function* () { yield archive })() } } })
  const file = await installer()
  await writeFile(file, 'corrupt fixture')
  assert.equal(await installer(), file)
  assert.equal(await readFile(file, 'utf8'), 'verified fixture')
  assert.equal(requests, 2)
})

function deferred() { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function bounded(promise, ms = 500) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('bounded operation did not settle')), ms) })]).finally(() => clearTimeout(timer)) }
async function fixture(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-deep-base-')); t.after(() => rm(root, { recursive: true, force: true })); return root }
function request() {
  const value = { authorizationId: 'fixture-close-race', tool: 'team_task_external_effect', rootSessionId: 'fixture-root', turnKey: 'fixture-turn', teamId: 'fixture-team', taskId: 'fixture-task', effectName: 'fixture-noop', attemptId: 'fixture-attempt', outcome: 'not_started', pauseEpoch: 0, teamRevision: 1 }
  value.canonicalArgumentsHash = createHash('sha256').update(JSON.stringify({ action: 'resolve_unknown', team_id: value.teamId, task_id: value.taskId, effect_name: value.effectName, attempt_id: value.attemptId, outcome: value.outcome })).digest('hex')
  return value
}
for (const kind of ['authorization', 'secret']) test(`${kind} close terminates an idle half-frame socket`, async t => {
  const root = await fixture(t)
  const service = kind === 'authorization'
    ? createAgentTeamsAuthorizationService({ stateFile: path.join(root, 'state.json'), showMessageBox: async () => ({ response: 1 }) })
    : createAgentTeamsSecretService({ protector: { protect: async b => Buffer.from(b), unprotect: async b => Buffer.from(b) } })
  await service.start()
  const socket = net.connect(service.endpoint); socket.on('error', () => {})
  t.after(async () => { socket.destroy(); await service.close() })
  await once(socket, 'connect'); socket.write('{')
  // A second fully served request proves the server accepted the earlier socket.
  const fence = net.connect(service.endpoint); fence.on('error', () => {})
  await once(fence, 'connect'); fence.write('{}\n'); fence.resume()
  await once(fence, 'end'); fence.destroy()
  await bounded(service.close())
})

test('authorization close cancels a pending dialog and never persists its late acceptance', async t => {
  const root = await fixture(t), entered = deferred(), decision = deferred()
  const stateFile = path.join(root, 'state.json')
  const service = createAgentTeamsAuthorizationService({ stateFile, showMessageBox: () => { entered.resolve(); return decision.promise } })
  await service.start()
  const token = service.runtimeEnvironment()[TOKEN_ENV]
  const before = await readFile(stateFile, 'utf8')
  const socket = net.connect(service.endpoint); socket.on('error', () => {})
  t.after(async () => { decision.resolve({ response: 1 }); socket.destroy(); await service.close() })
  await once(socket, 'connect')
  socket.write(JSON.stringify({ token, action: 'consumeResolveUnknown', request: request() }) + '\n')
  await bounded(entered.promise)
  const closing = service.close()
  decision.resolve({ response: 0 })
  await bounded(closing)
  assert.equal(await readFile(stateFile, 'utf8'), before)
})

test('runtime patch publication preserves original bytes on rename failure and rejects stale writers', async t => {
  const root = await fixture(t), file = path.join(root, '空 格-runtime.js')
  const { writePatchedRuntimeFile } = await import('../scripts/deep-audit-runtime-patch.mjs')
  const fs = require('node:fs/promises')
  await writeFile(file, 'official')
  await assert.rejects(writePatchedRuntimeFile(file, 'official', 'patched', { ...fs, rename: async () => { throw Object.assign(new Error('fixture disk error'), { code: 'EACCES' }) } }), /fixture disk error/)
  assert.equal(await readFile(file, 'utf8'), 'official')
  assert.equal(await writePatchedRuntimeFile(file, 'official', 'patched'), true)
  await assert.rejects(writePatchedRuntimeFile(file, 'official', 'stale'), /source changed/)
  assert.equal(await readFile(file, 'utf8'), 'patched')
  assert.deepEqual(await fs.readdir(root), [path.basename(file)])
})

test('production provider installer migrates exact v3 fixture to v4, is idempotent and rejects drift', async t => {
  const root = await fixture(t), lib = path.join(root, 'lib'), target = path.join(lib, 'index.js')
  const sourceFile = require.resolve('../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js')
  const source = await readFile(sourceFile, 'utf8')
  const digest = value => createHash('sha256').update(value).digest('hex').toUpperCase()
  assert.equal(digest(source), '2171F31250C0970D1CC9A9733A241364306D99146E5BAEC8D0775066D7AE3388')
  await mkdir(lib)
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-llm-pi-ai', version: '0.1.2-alpha.5' }))
  await writeFile(target, source)
  const { patchInstalledProviderAuthIsolation } = await import('../scripts/patch-official-runtime.mjs')
  assert.equal(await patchInstalledProviderAuthIsolation(target), true)
  const output = await readFile(target, 'utf8')
  assert.equal(digest(output), '28A7850E44BC24CDD0E5E7222EB0FE655877D1433DB59F8FF435934528BA0207')
  assert.equal(await patchInstalledProviderAuthIsolation(target), false)
  await writeFile(target, output + '\n// drift')
  await assert.rejects(patchInstalledProviderAuthIsolation(target), /neither exact official nor an exact complete/)
  assert.equal(await readFile(target, 'utf8'), output + '\n// drift')
  assert.equal(await readFile(sourceFile, 'utf8'), source, 'original installed runtime is read-only')
})

test('runtime patch collision never removes the other writer lock', async t => {
  const root = await fixture(t), file = path.join(root, 'runtime.js')
  const { writePatchedRuntimeFile } = await import('../scripts/deep-audit-runtime-patch.mjs')
  await writeFile(file, 'official'); await writeFile(`${file}.dsh-patch.lock`, 'other-writer')
  await assert.rejects(writePatchedRuntimeFile(file, 'official', 'patched'), { code: 'EEXIST' })
  assert.equal(await readFile(file, 'utf8'), 'official')
  assert.equal(await readFile(`${file}.dsh-patch.lock`, 'utf8'), 'other-writer')
})

function plan(version = '1.0.2') { return { mode: 'components', releaseVersion: version, components: [{ id: 'desktop-shell', version, sha256: 'a'.repeat(64) }] } }
test('component state CAS serializes competing store instances', async t => {
  const root = await fixture(t)
  const entered = deferred(), release = deferred()
  const first = new ComponentUpdateStore(root, { atomicWriteImpl: async (...args) => { entered.resolve(); await release.promise; return atomicWriteJson(...args) } })
  const second = new ComponentUpdateStore(root)
  const a = first.beginStaging(plan())
  await bounded(entered.promise)
  const b = second.beginStaging(plan('1.0.3')).then(value => ({ ok: true, value }), error => ({ ok: false, error }))
  // In the broken implementation B commits while A is inside its atomic write.
  // A real lock makes B wait; release A after a bounded observation interval.
  const observed = await Promise.race([b, new Promise(resolve => setTimeout(() => resolve(null), 75))])
  release.resolve()
  await a
  const result = observed || await b
  assert.equal(result.ok, false)
  assert.equal(result.error?.message, '当前更新阶段不允许开始暂存：staging')
  const finalState = await first.get()
  assert.equal(finalState.revision, 1)
  assert.equal(finalState.pending.releaseVersion, '1.0.2')
  assert.equal(finalState.phase, 'staging')
})

test('component unreadable or malformed state never silently resets to idle', async t => {
  const root = await fixture(t)
  const denied = new ComponentUpdateStore(root, { readFileImpl: async () => { throw Object.assign(new Error('fixture denied'), { code: 'EACCES' }) } })
  await assert.rejects(denied.get(), { code: 'EACCES' })
  const store = new ComponentUpdateStore(root)
  for (const bytes of ['{', 'null', '{"schemaVersion":999}']) {
    await writeFile(store.stateFile, bytes)
    await assert.rejects(store.get())
    assert.equal(await readFile(store.stateFile, 'utf8'), bytes)
  }
})

test('real bootstrap falls back to bundled shell on corrupt component state and preserves diagnosis access', async t => {
  const root = await fixture(t), componentRoot = path.join(root, 'component-updates')
  await mkdir(componentRoot)
  const badState = '{broken fixture', badPointer = '{also broken fixture'
  await writeFile(path.join(componentRoot, 'state.json'), badState)
  await writeFile(path.join(componentRoot, 'current.json'), badPointer)
  const filename = require.resolve('../electron/bootstrap.cjs'), localRequire = createRequire(filename)
  let loaded = 0, exits = 0, warnings = 0
  const fakeApp = { commandLine: { getSwitchValue: () => '' }, getPath: () => root, getVersion: () => '1.0.60', exit: () => { exits++ }, whenReady: async () => {}, relaunch: () => assert.fail('no relaunch') }
  const sharedGlobal = {}
  const context = {
    require: id => {
      if (id === 'electron') return { app: fakeApp, protocol: { registerSchemesAsPrivileged: () => {} }, dialog: { showErrorBox: () => { warnings++ } } }
      if (id === './bridge/component-runtime-resolver.cjs') return { installComponentModulePaths: () => {}, resolveComponentLayout: ({ pointer, bundledRoot }) => { assert.equal(pointer, null); return { shellEntry: 'fixture-bundled-entry', shellRoot: bundledRoot, runtimeRoot: bundledRoot, pluginsRoot: bundledRoot } } }
      if (id === 'fixture-bundled-entry') { loaded++; return {} }
      return localRequire(id)
    },
    __dirname: path.dirname(filename), process: { argv: [], env: {} }, global: sharedGlobal,
    console: { error: () => {} }, module: { exports: {} }
  }
  vm.runInNewContext((await readFile(filename, 'utf8')).replace('boot().catch(error => {', 'global.auditBootPromise = boot().catch(error => {'), context, { filename })
  await sharedGlobal.auditBootPromise
  assert.equal(exits, 0)
  assert.equal(loaded, 1)
  assert.equal(warnings, 1)
  assert.equal(sharedGlobal.__HARNESS_COMPONENT_UPDATE__.prepared.action, 'bundled-fallback')
  assert.equal(sharedGlobal.__HARNESS_COMPONENT_UPDATE__.healthCheckRequired, false)
  assert.equal(await readFile(path.join(componentRoot, 'state.json'), 'utf8'), badState)
  assert.equal(await readFile(path.join(componentRoot, 'current.json'), 'utf8'), badPointer)
})

test('script entry inventory classifies every current file exactly once', async () => {
  const fs = require('node:fs/promises')
  const root = path.resolve(__dirname, '..')
  const coverage = JSON.parse(await readFile(path.join(root, 'docs/deep-audit/coverage-runtime-storage.json'), 'utf8'))
  const actual = (await fs.readdir(path.join(root, 'scripts'), { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort()
  const hash = value => require('node:crypto').createHash('sha256').update(value).digest('hex').toUpperCase()
  const historical = coverage.scriptInventory, prior102 = coverage.scriptInventory102, current = coverage.currentScriptInventory
  assert.equal(prior102.totalFiles, 102)
  assert.equal(hash(JSON.stringify(prior102)), '81B601B4983DB7975C534F56A6F41E34487DEC2C590197ACAFC2E34932074347')
  assert.equal(current.historical102Pointer, '/scriptInventory102')
  assert.equal(current.historical102Sha256, hash(JSON.stringify(prior102)))
  assert.equal(historical.totalFiles, 100, 'accepted historical snapshot is never rewritten as current')
  assert.equal(hash(JSON.stringify(historical)), '787B735932F1C0511B309D287DC216E256A3EF9EB83B733251F50B398FC8AA63')
  assert.equal(hash(JSON.stringify(coverage.baseline)), 'F5E1E62A30C7FB2BA05C3F42EEACFA2074101F4DA0568E7D46EC63CBCE38C54C')
  assert.equal(current.historicalInventoryPointer, '/scriptInventory')
  assert.equal(current.historicalInventorySha256, hash(JSON.stringify(historical)))
  assert.equal(current.historicalBaselineSha256, hash(JSON.stringify(coverage.baseline)))
  const previous = historical.groups.flatMap(group => group.files)
  const priorAdded = prior102.additionalGroups.flatMap(group => group.files)
  const added = current.additionalGroups.flatMap(group => group.files)
  assert.equal(previous.length, 100)
  assert.deepEqual(priorAdded.slice().sort(), ['deep-audit-marketplace-patch.mjs', 'deep-audit-session-core-patch.mjs'])
  assert.deepEqual(added, ['deep-audit-question-card-patch.mjs'])
  const classified = previous.concat(priorAdded, added).sort()
  assert.equal(new Set(classified).size, classified.length)
  assert.equal(current.totalFiles, 103)
  assert.equal(current.totalFiles, actual.length)
  assert.deepEqual(classified, actual)
  assert.equal(current.runtimePatch.currentSha256, hash(await readFile(path.join(root, 'scripts/patch-official-runtime.mjs'))))
  assert.equal(prior102.runtimePatch.priorAcceptedSha256, '710E8BCD47A604F481121EA8D336A815527A3373BD2374CAF8E2E585DDDDAEB8')
  assert.equal(prior102.runtimePatch.currentSha256, '034CFD41CC9E78C46ED6ABA1D1971236F496EDF3D587F2342FF039450BB239DF')
  assert.equal(current.runtimePatch.priorAcceptedSha256, prior102.runtimePatch.currentSha256)
})

test('interrupted component pointer publication cannot run an unchecked candidate', async t => {
  const root = await fixture(t), store = new ComponentUpdateStore(root)
  await store.beginStaging(plan()); await store.markReady(); await store.markApplying()
  const state = await store.get()
  await writeFile(store.pointerFile, JSON.stringify({ releaseVersion: state.pending.releaseVersion, components: state.pending.components }))
  const prepared = await prepareComponentActivation({ store, accessImpl: async () => {} })
  assert.notEqual(prepared.action, 'use-current')
  assert.equal(prepared.pointer, null)
  assert.equal((await store.get()).phase, 'failed')
})

test('failed first component health check rolls back to the bundled baseline', async t => {
  const root = await fixture(t), store = new ComponentUpdateStore(root)
  await store.beginStaging(plan()); await store.markReady(); await store.markApplying(); await store.activatePending()
  const prepared = await prepareComponentActivation({ store, accessImpl: async () => { throw new Error('fixture missing component') } })
  assert.equal(prepared.action, 'rolled-back')
  assert.equal(prepared.pointer, null)
  assert.equal((await store.get()).phase, 'failed')
})

test('packaged runtime rejects path-like version without touching sibling directories', async t => {
  const root = await fixture(t), appRoot = path.join(root, 'app.asar')
  await mkdir(path.join(appRoot, 'node_modules'), { recursive: true })
  await assert.rejects(ensureRuntimeNodeModules({ appRoot, userData: root, appVersion: '../escape' }), /version|版本/i)
})
