'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const CANDIDATE = process.env.DSH_ALPHA2_CANDIDATE_ROOT || ROOT
const alpha = (...parts) => fs.readFileSync(path.join(CANDIDATE, 'node_modules', '@deepseek-ai', ...parts), 'utf8')
const source = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

const PRODUCTION = [
  'electron/main.cjs',
  'electron/bridge/agent-teams-session-launch-service.cjs',
  'electron/bridge/mobile-sync-service.cjs',
  'electron/pet/pet-event-adapter.cjs',
  'mobile/android/app/src/main/assets/mobile-runtime.js',
  'mobile/ios/HarnessMobile/Resources/mobile-runtime.js'
]

const LEGACY_ENDPOINTS = ['workspace.create', 'workspace.list', 'session.create', 'session.list', 'session.rename', 'session.prompt', 'session.models', 'host.describe', 'events.host', 'events.mux']

test('production clients emit only pinned alpha.2 slash endpoints', () => {
  for (const relative of PRODUCTION) {
    const value = source(relative)
    for (const legacy of LEGACY_ENDPOINTS) assert.equal(value.includes(`'${legacy}'`) || value.includes(`\"${legacy}\"`) || value.includes(`/api/${legacy}`), false, `${relative} retains ${legacy}`)
  }
  const launcher = source('electron/bridge/agent-teams-session-launch-service.cjs')
  for (const endpoint of ['workspace/create', 'session/list', 'session/create', 'session/rename', 'session/prompt']) assert.ok(launcher.includes(`callRuntimeRpc('${endpoint}'`), endpoint)
  assert.match(launcher, /workspace\/create'[\s\S]*?\{ args: \{ request: \{ path: binding\.workspacePath \} \} \}/u)
  assert.match(launcher, /session\/list', \{ args: \{ _request: \{\} \} \}/u)
  assert.match(launcher, /session\/prompt'[\s\S]*?requestId: operation\.promptRequestId/u)
})

test('official generated descriptors prove endpoint, codec, and stream mappings', () => {
  const workspace = alpha('dsh-api-workspace-controller', 'lib', 'typert.remote-client.js')
  const session = alpha('dsh-api-session-controller', 'lib', 'typert.remote-client.js')
  assert.match(workspace, /#workspace\/create'[\s\S]*?wire: 'request'/u)
  assert.match(workspace, /#workspace\/follow'[\s\S]*?mode: 'stream'[\s\S]*?parameters: \[\s*\]/u)
  assert.doesNotMatch(workspace, /#workspace\/list'/u)
  assert.match(session, /#session\/list'[\s\S]*?wire: '_request'/u)
  for (const endpoint of ['create', 'rename', 'prompt']) assert.match(session, new RegExp(`#session/${endpoint}'[\\s\\S]*?wire: 'request'`, 'u'))
  assert.match(session, /#session\/control'[\s\S]*?mode: 'stream'/u)
  assert.match(session, /#session\/follow'[\s\S]*?mode: 'stream'/u)
})

test('Desktop transport pins path to envelope method and rejects open endpoint construction', () => {
  const main = source('electron/main.cjs')
  assert.match(main, /OFFICIAL_RUNTIME_RPC_ENDPOINTS = new Set\(\[/u)
  assert.match(main, /if \(!OFFICIAL_RUNTIME_RPC_ENDPOINTS\.has\(endpoint\)\) throw/u)
  assert.match(main, /new URL\(`\/api\/\$\{endpoint\}`/u)
  assert.match(main, /method: endpoint/u)
  for (const malicious of ['../session/list', 'session%2flist', 'session//list', 'session.list']) assert.equal(main.includes(`'${malicious}'`), false)
})

test('prompt recovery binds persisted request id to exact queue or durable message evidence', () => {
  const launcher = source('electron/bridge/agent-teams-session-launch-service.cjs')
  const persisted = launcher.indexOf("if (!operation.promptRequestId)")
  const dispatchPhase = launcher.indexOf("operation.phase = 'prompt_dispatched'", persisted)
  const dispatch = launcher.indexOf("callRuntimeRpc('session/prompt'", dispatchPhase)
  assert.ok(persisted >= 0 && persisted < dispatchPhase && dispatchPhase < dispatch)
  assert.match(launcher, /evidence\.rpcId !== operation\.promptRequestId/u)
  assert.match(launcher, /\['session\/control', 'session\/follow'\]\.includes\(evidence\.source\)/u)
  assert.doesNotMatch(launcher, /exact session is not observable/u)
})

test('mobile and pet consume generation baselines and fixed event allowlist', () => {
  const android = source('mobile/android/app/src/main/assets/mobile-runtime.js')
  const ios = source('mobile/ios/HarnessMobile/Resources/mobile-runtime.js')
  const mobileSync = source('electron/bridge/mobile-sync-service.cjs')
  const pet = source('electron/pet/pet-event-adapter.cjs')
  assert.equal(android, ios)
  assert.match(android, /endpoint: 'workspace\/follow', payload: \{ args: \{\} \}/u)
  assert.match(android, /frame\.value\?\.type !== 'baseline'/u)
  assert.match(mobileSync, /endpoint: 'workspace\/follow', payload: \{ args: \{\} \}/u)
  assert.match(mobileSync, /method = 'session\/list'[\s\S]*?payload: \{ args: \{ _request: \{\} \} \}/u)
  assert.match(pet, /endpoint: '\$events', payload: \{ args: \{\} \}/u)
  assert.match(pet, /endpoint: 'session\/control', payload: \{ args: \{\} \}/u)
  assert.match(pet, /'approval\/request'[\s\S]*?'user-questions\/request'/u)
  assert.match(pet, /outcome: \{ kind: 'next' \}/u)
})
