'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '..')
const AUDIT_ROOT = process.env.DSH_ALPHA2_AUDIT_ROOT || ROOT
const CANDIDATE_ROOT = process.env.DSH_ALPHA2_CANDIDATE_ROOT || ROOT
const RAW_CANDIDATE_ROOT = process.env.DSH_ALPHA2_RAW_ROOT || path.resolve(AUDIT_ROOT, '..', 'install-first')
const TARGET_VERSION = '0.1.2-alpha.2'
const LOCAL_VERSION = '0.1.1-rc.2'

const DIRECT_ALPHA2 = Object.freeze([
  ['@deepseek-ai/dsh', 'apps/cli/package.json', 'sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA=='],
  ['@deepseek-ai/dsh-anonymous-user-id', 'packages/identity/anonymous-user-id/package.json', 'sha512-mwuJvUuj6CHewyGm0m6WIuADglJkAKNzJ8G4W2zQ+uC01C4zp5M4t0jnJ1FmHa4ctRTj0jo4VCV6TmhPFSSE1g=='],
  ['@deepseek-ai/dsh-atomic-write', 'packages/util/atomic-write/package.json', 'sha512-9ZWA2sDIKYN5ewKBcGDKLi4YndRAS9OAa6a/9QWpNqxUqU/VK4W69JF3F4AwfzWnRjmymW+Ntbma6IB1B3e3QQ=='],
  ['@deepseek-ai/dsh-bash-local', 'packages/shell/bash-local/package.json', 'sha512-fl7gu1vDuYCLjPOPas+71kTSSiTpvldJ8+A5fdc/rkGyRdCOEOpXP+kjb1uF8u4ZRIiFjdoMKoR060ZFmpWOgA=='],
  ['@deepseek-ai/dsh-code-runtime', 'packages/code-runtime/code-runtime/package.json', 'sha512-KGUwcm4sSHjspQYr2Kj1DycaxnPzxg25sk3ychqbFG4cLcUA8W6eqQJEpEUgmnCOkDBx/j9oXvzNxp7XGMsRoQ=='],
  ['@deepseek-ai/dsh-compaction', 'packages/compaction/compaction/package.json', 'sha512-decsWxdQgJjsFRlJxiDJ30Tq/YkBV3B0fy8P6hThBefJAeDN47l2lvMSOsCa3IgrmiNaBawWxuOlTMDp6YyREQ=='],
  ['@deepseek-ai/dsh-compaction-basic', 'packages/compaction/compaction-basic/package.json', 'sha512-8KcP5LUOScJPu7EyGSBkqmQzJew0Z0JKA7qrYpskRqqOPAElwlErXMjx3MBOrsPyuBzE+LtBixnhKkrXnKvZ6w=='],
  ['@deepseek-ai/dsh-fs', 'packages/fs/fs/package.json', 'sha512-wx5n0QS5rfZ2LPVocMNfuOUh0RYH/QuLoCEy+qI8U3nKmSZ8GSTASURLg+0pVxckHpLElo38U+S/lkLxRK1rpQ=='],
  ['@deepseek-ai/dsh-invariants', 'packages/runtime-diagnostics/invariants/package.json', 'sha512-1ewUeCzUHbaqhtW5rG1/eujIXXzy2VhwvMa16RpcTuJp5qcU1NtAf/+COkmvI7qtkyNY61vWg1Ez5qL9hKIUpQ=='],
  ['@deepseek-ai/dsh-output-retention', 'packages/util/output-retention/package.json', 'sha512-mKLCLsZKPJxwfma4AKl7KyfNUFVCmVovcbbdm3alxJqgU16PpkeK0rmJog6M34XJozQ8GAhdFf0TsDs3O6MoTA=='],
  ['@deepseek-ai/dsh-sandbox', 'packages/sandbox/sandbox/package.json', 'sha512-InfHYn5B0MxF5QLz0AjbwPS5W0G9VtIvjEFl5o/049KzH6khGKhjqOAVZtu1Z46f1+K/dbjF50VkTdnX3pgIJA=='],
  ['@deepseek-ai/dsh-scope', 'packages/core/scope/package.json', 'sha512-jeWfQnftQeZOWujxndgU6kjoFuXGWqmFrkWAxlWmyeojK/iyZqAxayWPuhVUEgweh4EWJmn6rW5HV3E4DXWuWw=='],
  ['@deepseek-ai/dsh-session-telemetry', 'packages/session/session-telemetry/package.json', 'sha512-Sfa2LeZDnXXIY4WytEcgAafbFIms3gBWVCPRXfDCeHL77baJhf7a5R0j64YDjrHqoMKqk6jkI7GwRvMpipUcBA=='],
  ['@deepseek-ai/dsh-session-title-llm', 'packages/session/session-title-llm/package.json', 'sha512-g1AKWm1XSJjVRZCzUJq9ROGSbudEipf2XPtK7N4LcdntWTWLDxHg4ZKe8/B28bISPIvxbG7Fd3B/2aKczIz6Bg=='],
  ['@deepseek-ai/dsh-shell', 'packages/shell/shell/package.json', 'sha512-i16e+OrCJ7GZ1XDnPds081NgVs/xzIVMLECzmLnXgVDKeePgWpdEgR//PgMqKPwoBoJ8z7DTzwKiOISAtOpNzA=='],
  ['@deepseek-ai/dsh-spill', 'packages/spill/spill/package.json', 'sha512-BemtJNMbbaOENMa8oKVhp55AU+6QJUHqfHdIhNPGAhZe3DFe15cXnyEg97q4fzWZk7dxUyFuJiO1ERoCHGj11g=='],
  ['@deepseek-ai/dsh-subagent-in-process-driver', 'packages/subagent/subagent-in-process-driver/package.json', 'sha512-zCNMh2KLkS9FlFLontj0VKk9KUvIZDSkRQIwV2mXWka5K123vE2K1Z70dfLfK4bVQoCTCg+TjWOERaJJZSfYQw=='],
  ['@deepseek-ai/dsh-subprocess', 'packages/subprocess/subprocess/package.json', 'sha512-MOktcCP6IeTLTGKvF6+0ooE+4++ODhgqawizXsq7w6SNcPb5SbdB2+k6+3FZypjnIMWw+FESaH19/2PmGi6XSQ=='],
  ['@deepseek-ai/dsh-timeout', 'packages/util/timeout/package.json', 'sha512-8q5cd55aMoOvrPaqSws/3xiyzHhs1bfjdtAs4YHWimQgMd+yMrDnlu8i+zFOkWoSc0A2wPkXcCYR8xogl4gerA=='],
  ['@deepseek-ai/dsh-workflow', 'packages/workflow/workflow/package.json', 'sha512-U2nGVCOZ3hGoPP6XtPWUFL++l6K8S7XRQV2hvFrSQ4WBGbwdkY6h1cyzGvJXzae1s3AbAu5tdt//AIBNHOtYaA==']
])

const PATCH_TARGETS = Object.freeze([
  '@deepseek-ai/dsh-client-runtime',
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-client-ui-subagent',
  '@deepseek-ai/dsh-sandbox',
  '@deepseek-ai/dsh-pwsh-local',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-pwsh-sandbox',
  '@deepseek-ai/dsh-bash-sandbox',
  '@deepseek-ai/dsh-sandbox-windows-acl',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-llm-deepseek',
  '@deepseek-ai/dsh-client-ui-workspace',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-subprocess-local',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-base'
])

const OFFICIAL_ALPHA2_AUDIT = Object.freeze({
  observedAt: Object.freeze({
    github: '2026-08-30T15:47:54.6073859Z',
    directPackuments: '2026-08-30T15:49:13.9146109Z',
    directTarballs: '2026-08-30T15:53:41.3996192Z',
    recursiveClosure: '2026-08-30T16:00:02.303Z',
    deterministicClosure: '2026-08-30T16:09:56.020Z',
    obsoletePatchArtifacts: '2026-08-30T16:10:13.1889507Z'
  }),
  github: Object.freeze({
    releaseUrl: 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2',
    tag: 'dsh-v0.1.2-alpha.2',
    commit: '0a53fb55bea101816fa226bb964ae2bed71c343b',
    tree: '64ccbfa8e0caa4711cd4a75717ef9e022657961b',
    publishedAt: '2026-08-30T13:52:14Z',
    prerelease: true,
    releaseAssetCount: 0,
    sourceUrl: 'https://codeload.github.com/deepseek-ai/deepseek-harness/tar.gz/0a53fb55bea101816fa226bb964ae2bed71c343b',
    sourceSha256: '935574f69c8bb10b697cf8abe8c0449dab783e9f73dc3f224629458b6f65b980',
    license: 'MIT'
  }),
  upstreamRuntime: Object.freeze({
    node: '^22.19.0 || >=24.0.0',
    packageManager: 'pnpm@11.7.0',
    electronContract: null,
    runtimeEquivalent: false,
    electronCompatibilityGate: 'isolated Electron/Node/ABI/package proof required'
  }),
  registry: Object.freeze({
    baseUrl: 'https://registry.npmjs.org',
    targetVersion: TARGET_VERSION,
    distTag: 'alpha',
    directTarballsVerified: 20,
    directTarballsAllMatch: true,
    recursiveDshClosurePublished: 215,
    recursiveDshClosureMissing: 0,
    deterministicClosure: Object.freeze({
      packageCount: 215,
      edgeCount: 1115,
      recordCount: 1135,
      recordsSha256: '0ed92cc8ae3fafec77ca54559a7719adf09c5c657200dc2791dc1d06cb2b0b3a',
      packageManifestCount: 215,
      packageManifestSha256: 'dd62b0f8e9f5d068cb6a6246d9dbb7f920b8e159a2d14b9d3a5e3435a69f48bd',
      unresolvedParentRanges: 0,
      workspaceRanges: 0,
      rc2Ranges: 0,
      recordFormat: 'name@selectedVersion|integrity|parent@selectedVersion:dependencyKind:parentRange',
      rootRecordFormat: 'name@selectedVersion|integrity|ROOT:dependencies:exactVersion',
      sortAndHash: 'Unicode code-point ascending; UTF-8 records joined by LF without trailing LF; SHA-256'
    })
  }),
  unavailablePatchArtifacts: Object.freeze([
    Object.freeze({
      name: '@deepseek-ai/dsh-client-runtime',
      alpha2SelectedVersion: null,
      alpha2ManifestPresent: false,
      localLockedVersion: LOCAL_VERSION,
      packument: 'https://registry.npmjs.org/%40deepseek-ai%2Fdsh-client-runtime',
      localIntegrity: 'sha512-o1FH7Rlns0Xaxh4SBOWZ1wpa0ViGw6DXWNm5NFpsBTGYD94RGdIrud3QxgrfzmQKLzu33gvS8JL/IjqbzWyYsg==',
      localTarball: 'https://registry.npmjs.org/@deepseek-ai/dsh-client-runtime/-/dsh-client-runtime-0.1.1-rc.2.tgz'
    }),
    Object.freeze({
      name: '@deepseek-ai/dsh-host-apiproxy',
      alpha2SelectedVersion: null,
      alpha2ManifestPresent: false,
      localLockedVersion: LOCAL_VERSION,
      packument: 'https://registry.npmjs.org/%40deepseek-ai%2Fdsh-host-apiproxy',
      localIntegrity: 'sha512-dplRnGGXXsQYFQ1KMHymAM0iaxuE9Z153JHYcGEgOwXNkS3HA20gSi3yMt6fz+zi/cMHYXvY1JQhS54BTc761A==',
      localTarball: 'https://registry.npmjs.org/@deepseek-ai/dsh-host-apiproxy/-/dsh-host-apiproxy-0.1.1-rc.2.tgz'
    })
  ])
})

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'))
}

function readText(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function readCandidateJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(CANDIDATE_ROOT, relative), 'utf8'))
}

function installedPackageName(location, entry) {
  if (typeof entry?.name === 'string') return entry.name
  const marker = 'node_modules/'
  const tail = location.slice(location.lastIndexOf(marker) + marker.length)
  const parts = tail.split('/')
  return parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
}

function selectedDsh(lock) {
  return Object.entries(lock.packages)
    .filter(([location]) => location !== '')
    .map(([location, entry]) => ({ location, entry, name: installedPackageName(location, entry) }))
    .filter(row => row.name === '@deepseek-ai/dsh' || row.name.startsWith('@deepseek-ai/dsh-'))
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function compiledAlphaStartSession(recent = () => undefined, controlledConsole = console) {
  const source = fs.readFileSync(path.join(CANDIDATE_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  const { patchAlpha2WorkspaceStartSessionSource } = await import('../scripts/patch-official-runtime.mjs')
  const patched = patchAlpha2WorkspaceStartSessionSource(source).source
  const start = patched.indexOf('startSession(workspaceId) {')
  assert.notEqual(start, -1)
  const body = patched.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let index = body; index < patched.length; index += 1) {
    if (patched[index] === '{') depth += 1
    if (patched[index] === '}' && --depth === 0) { end = index + 1; break }
  }
  assert.notEqual(end, -1)
  const method = patched.slice(start, end).replace('startSession(workspaceId)', 'function (workspaceId)')
  return vm.runInNewContext(`(${method})`, { recentWorkspace: recent, console: controlledConsole })
}

function startHarness(workspaceSnapshot, initialSessionSnapshot) {
  let sessionSnapshot = structuredClone(initialSessionSnapshot)
  const creates = []
  const opens = []
  let clears = 0
  const sessions = {
    list: { getSnapshot: () => sessionSnapshot },
    clear() { clears += 1; sessionSnapshot = { ...sessionSnapshot, current: undefined } },
    create(request) { const pending = deferred(); creates.push({ request, pending }); return pending.promise },
    open(sessionId) { opens.push(sessionId); sessionSnapshot = { ...sessionSnapshot, current: sessionId } }
  }
  return {
    service: { workspaces: { list: { getSnapshot: () => workspaceSnapshot } }, sessions },
    creates,
    opens,
    clears: () => clears
  }
}

async function flushPromises() {
  await new Promise(resolve => setImmediate(resolve))
}

function startMutationSnapshot(h) {
  return {
    opens: [...h.opens],
    clears: h.clears(),
    current: h.service.sessions.list.getSnapshot().current,
    generation: h.service.sessionStartGeneration,
    hint: h.service.sessionWorkspaceHint,
    pending: h.service.pendingSessionWorkspaceTarget,
    previous: h.service.pendingSessionOriginalSession,
    legacyHints: h.service.sessionWorkspaceHints
  }
}

test('fixed upstream evidence is internally complete and does not turn a Git tag into runtime equivalence', () => {
  assert.match(OFFICIAL_ALPHA2_AUDIT.github.commit, /^[0-9a-f]{40}$/)
  assert.match(OFFICIAL_ALPHA2_AUDIT.github.tree, /^[0-9a-f]{40}$/)
  assert.match(OFFICIAL_ALPHA2_AUDIT.github.sourceSha256, /^[0-9a-f]{64}$/)
  assert.equal(OFFICIAL_ALPHA2_AUDIT.github.prerelease, true)
  assert.equal(OFFICIAL_ALPHA2_AUDIT.github.releaseAssetCount, 0)
  assert.equal(OFFICIAL_ALPHA2_AUDIT.upstreamRuntime.electronContract, null)
  assert.equal(OFFICIAL_ALPHA2_AUDIT.upstreamRuntime.runtimeEquivalent, false)
  assert.match(OFFICIAL_ALPHA2_AUDIT.upstreamRuntime.electronCompatibilityGate, /required$/)
  assert.equal(OFFICIAL_ALPHA2_AUDIT.registry.recursiveDshClosureMissing, 0)
  const closure = OFFICIAL_ALPHA2_AUDIT.registry.deterministicClosure
  assert.equal(closure.packageCount, OFFICIAL_ALPHA2_AUDIT.registry.recursiveDshClosurePublished)
  assert.equal(closure.recordCount, closure.edgeCount + DIRECT_ALPHA2.length)
  assert.match(closure.recordsSha256, /^[0-9a-f]{64}$/)
  assert.match(closure.packageManifestSha256, /^[0-9a-f]{64}$/)
  assert.equal(closure.unresolvedParentRanges, 0)
  assert.equal(closure.workspaceRanges, 0)
  assert.equal(closure.rc2Ranges, 0)
})

test('all twenty direct dsh dependencies have unique alpha.2 workspace and integrity evidence', () => {
  assert.equal(DIRECT_ALPHA2.length, 20)
  assert.equal(new Set(DIRECT_ALPHA2.map(([name]) => name)).size, 20)
  assert.equal(new Set(DIRECT_ALPHA2.map(([, workspace]) => workspace)).size, 20)
  for (const [name, workspace, integrity] of DIRECT_ALPHA2) {
    assert.match(name, /^@deepseek-ai\/dsh(?:-|$)/)
    assert.match(workspace, /(?:^apps\/|^packages\/).+\/package\.json$/)
    assert.match(integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/)
  }
})

test('the maintained product pins and classifies the complete accepted alpha.2 graph', async () => {
  const pkg = readJson('package.json')
  const lock = readJson('package-lock.json')
  const installedCore = readCandidateJson('node_modules/@deepseek-ai/dsh/package.json')
  const { classifyOfficialRuntimeGraph } = await import('../scripts/patch-official-runtime.mjs')
  assert.deepEqual(classifyOfficialRuntimeGraph(pkg, lock, installedCore), {
    mode: 'alpha2', version: TARGET_VERSION, directRootCount: 20, selectedPackageCount: 216
  })
  const directNames = Object.keys(pkg.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')).sort()
  const expectedNames = DIRECT_ALPHA2.map(([name]) => name).sort()
  assert.deepEqual(directNames, expectedNames)
  assert.equal(pkg.dependencies['@deepseek-ai/cordis-plugin-group'], '1.0.1')
  assert.equal(pkg.devDependencies.electron, '43.2.0')
  assert.equal(pkg.scripts.postinstall, 'node scripts/patch-official-runtime.mjs && electron-builder install-app-deps')
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies)
  for (const name of expectedNames) {
    assert.equal(pkg.dependencies[name], TARGET_VERSION, name)
    assert.equal(lock.packages[`node_modules/${name}`].version, TARGET_VERSION, name)
  }
})

test('the detached candidate is one complete canonical alpha.2 graph with removed packages absent', async () => {
  const pkg = readCandidateJson('package.json')
  const lock = readCandidateJson('package-lock.json')
  const installedCore = readCandidateJson('node_modules/@deepseek-ai/dsh/package.json')
  const { classifyOfficialRuntimeGraph } = await import('../scripts/patch-official-runtime.mjs')
  assert.deepEqual(classifyOfficialRuntimeGraph(pkg, lock, installedCore), {
    mode: 'alpha2', version: TARGET_VERSION, directRootCount: 20, selectedPackageCount: 216
  })
  const direct = Object.entries(pkg.dependencies).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
  assert.deepEqual(direct.map(([name]) => name).sort(), DIRECT_ALPHA2.map(([name]) => name).sort())
  for (const [name, version] of direct) {
    assert.equal(version, TARGET_VERSION, name)
    assert.equal(lock.packages[''].dependencies[name], TARGET_VERSION, `lock root ${name}`)
  }
  const selected = selectedDsh(lock)
  assert.equal(selected.length, 216)
  assert.equal(new Set(selected.map(row => row.name)).size, 215)
  for (const { location, entry } of selected) {
    assert.equal(entry.version, TARGET_VERSION, location)
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\/@deepseek-ai\//, location)
    assert.match(entry.integrity, /^sha512-/, location)
  }
  for (const { name } of OFFICIAL_ALPHA2_AUDIT.unavailablePatchArtifacts) assert.equal(selected.some(row => row.name === name), false, `removed package remains: ${name}`)
})

test('alpha.2 rebases force-new and SessionManager performance to exact new owners with complete-marker idempotence', async () => {
  const workspaceSource = fs.readFileSync(path.join(RAW_CANDIDATE_ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  const controllerSource = fs.readFileSync(path.join(RAW_CANDIDATE_ROOT, 'node_modules/@deepseek-ai/dsh-api-session-controller/lib/client.js'), 'utf8')
  const { patchAlpha2WorkspaceStartSessionSource, patchAlpha2SessionControllerSource } = await import('../scripts/patch-official-runtime.mjs')
  const workspaceFirst = patchAlpha2WorkspaceStartSessionSource(workspaceSource)
  assert.equal(workspaceFirst.changed, true)
  assert.doesNotMatch(workspaceFirst.source, /sessionWorkspaceHints/u)
  assert.match(workspaceFirst.source, /item\.sessionIds\.includes\(current\) \|\| currentSummary\?\.cwd/u)
  assert.match(workspaceFirst.source, /this\.sessionWorkspaceHint\?\.sessionId === current \? this\.sessionWorkspaceHint\.workspaceId : void 0/u)
  assert.match(workspaceFirst.source, /this\.pendingSessionWorkspaceTarget \?\? hintedWorkspaceId \?\? recent/u)
  assert.match(workspaceFirst.source, /if \(current !== void 0 && this\.pendingSessionOriginalSession === void 0\) this\.pendingSessionOriginalSession = current/u)
  assert.match(workspaceFirst.source, /this\.sessions\.clear\(\);[\s\S]*this\.sessions\.create\(\{ workspaceId: target \}\)/u)
  assert.match(workspaceFirst.source, /if \(generation !== this\.sessionStartGeneration\) return;[\s\S]{0,160}this\.sessionWorkspaceHint = \{ sessionId, workspaceId: target \}/u)
  assert.match(workspaceFirst.source, /const previous = this\.pendingSessionOriginalSession;[\s\S]{0,180}if \(previous !== void 0\) this\.sessions\.open\(previous\)/u)
  assert.equal(patchAlpha2WorkspaceStartSessionSource(workspaceFirst.source).changed, false)
  const workspaceDrift = workspaceSource.replace('this.connectWorkspace(target).then', 'this.connectWorkspace(target, drift).then')
  assert.throws(() => patchAlpha2WorkspaceStartSessionSource(workspaceDrift), /startSession changed/)

  const controllerFirst = patchAlpha2SessionControllerSource(controllerSource)
  assert.equal(controllerFirst.changed, true)
  for (const marker of ['for (const key of ["title", "subagent"])', 'frame.key === "tokenUsage" || frame.key === "subagentTiming"', 'globalThis.setTimeout(publish, 50)', 'const retainedEntryIds = new Set(items.map((entry) => entry.sessionId))']) {
    assert.ok(controllerFirst.source.includes(marker), `missing alpha.2 SessionManager marker: ${marker}`)
  }
  assert.equal(patchAlpha2SessionControllerSource(controllerFirst.source).changed, false)
  const controllerDrift = controllerSource.replace('this.notifier.markDirty();\n\t\t\t\t\t});', 'this.notifier.markDirty(drift);\n\t\t\t\t\t});')
  assert.throws(() => patchAlpha2SessionControllerSource(controllerDrift), /projection subscription changed/)
  const controllerPartial = controllerFirst.source.replace('globalThis.setTimeout(publish, 50)', 'globalThis.requestAnimationFrame(publish)')
  assert.throws(() => patchAlpha2SessionControllerSource(controllerPartial), /markers are partial/)
})

test('pinned alpha.2 graph has one UiWorkspaceService create owner and no alternate UI bypass', () => {
  const scope = path.join(CANDIDATE_ROOT, 'node_modules/@deepseek-ai')
  const javascript = []
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(target)
      else if (entry.isFile() && entry.name.endsWith('.js')) javascript.push(target)
    }
  }
  visit(scope)
  const directCreates = []
  for (const file of javascript) {
    const source = fs.readFileSync(file, 'utf8')
    const matches = source.match(/(?:this\.)?sessions\.create\(\{\s*workspaceId\s*\}\)/gu) || []
    for (const match of matches) directCreates.push({ file: path.relative(scope, file).replaceAll('\\', '/'), match })
  }
  assert.deepEqual(directCreates, [{ file: 'dsh-client-ui-workspace/lib/client.js', match: 'this.sessions.create({ workspaceId })' }])
  const agentPreset = fs.readFileSync(path.join(scope, 'dsh-client-ui-agent-preset/lib/client.js'), 'utf8')
  const sidebar = fs.readFileSync(path.join(scope, 'dsh-client-ui-sidebar/lib/client.js'), 'utf8')
  const workspace = fs.readFileSync(path.join(scope, 'dsh-client-ui-workspace/lib/client.js'), 'utf8')
  const webApp = fs.readFileSync(path.join(scope, 'dsh-web-app/lib/index.js'), 'utf8')
  assert.match(agentPreset, /scope\.uiWorkspace\.startSession\(\)/u)
  assert.match(sidebar, /workspaceNavigation\.startSession\(workspaceId\)/u)
  assert.match(workspace, /uiWorkspace\.startSession\(workspaceId\)/u)
  assert.doesNotMatch(webApp, /sessions\.create\(|startSession\(/u)
})

test('two rapid no-arg New Session clicks retain the pending project and only the latest completion opens', async () => {
  const startSession = await compiledAlphaStartSession(() => 'workspace-b')
  const h = startHarness({ phase: 'ready', recentWorkspaceId: 'workspace-b', items: [
    { workspaceId: 'workspace-a', path: 'C:\\a', sessionIds: ['old'] },
    { workspaceId: 'workspace-b', path: 'C:\\b', sessionIds: [] }
  ] }, { phase: 'ready', current: 'old', ids: ['old'], byId: { old: { id: 'old', cwd: 'C:\\a' } } })
  startSession.call(h.service)
  startSession.call(h.service)
  assert.deepEqual(h.creates.map(row => row.request.workspaceId), ['workspace-a', 'workspace-a'])
  h.creates[0].pending.resolve('stale-a')
  await flushPromises()
  assert.deepEqual(h.opens, [])
  h.creates[1].pending.resolve('latest-a')
  await flushPromises()
  assert.deepEqual(h.opens, ['latest-a'])
})

test('rapid explicit A to B clicks fence reversed stale success before every field mutation', async () => {
  const startSession = await compiledAlphaStartSession()
  const h = startHarness({ phase: 'ready', items: [
    { workspaceId: 'workspace-a', path: 'C:\\a', sessionIds: [] },
    { workspaceId: 'workspace-b', path: 'C:\\b', sessionIds: [] }
  ] }, { phase: 'ready', current: undefined, ids: [], byId: {} })
  startSession.call(h.service, 'workspace-a')
  startSession.call(h.service, 'workspace-b')
  h.creates[1].pending.resolve('session-b')
  await flushPromises()
  const beforeStale = startMutationSnapshot(h)
  h.creates[0].pending.resolve('session-a')
  await flushPromises()
  assert.deepEqual(startMutationSnapshot(h), beforeStale)
  assert.deepEqual(h.opens, ['session-b'])
  assert.deepEqual({ ...h.service.sessionWorkspaceHint }, { sessionId: 'session-b', workspaceId: 'workspace-b' })
  assert.equal(h.service.pendingSessionWorkspaceTarget, undefined)
  assert.equal(h.service.pendingSessionOriginalSession, undefined)
})

test('a stale New Session failure performs zero state mutation and emits zero warning', async () => {
  const warnings = []
  const startSession = await compiledAlphaStartSession(undefined, { warn: (...args) => warnings.push(args) })
  const h = startHarness({ phase: 'ready', items: [
    { workspaceId: 'workspace-a', path: 'C:\\a', sessionIds: ['old'] },
    { workspaceId: 'workspace-b', path: 'C:\\b', sessionIds: [] }
  ] }, { phase: 'ready', current: 'old', ids: ['old'], byId: { old: { id: 'old', cwd: 'C:\\a' } } })
  startSession.call(h.service, 'workspace-a')
  startSession.call(h.service, 'workspace-b')
  h.creates[1].pending.resolve('session-b')
  await flushPromises()
  const beforeStale = startMutationSnapshot(h)
  h.creates[0].pending.reject(new Error('stale failure'))
  await flushPromises()
  assert.deepEqual(startMutationSnapshot(h), beforeStale)
  assert.deepEqual(h.opens, ['session-b'])
  assert.deepEqual(warnings, [])
})

test('latest rapid failure restores the original session exactly once and clears transient state', async () => {
  const warnings = []
  const startSession = await compiledAlphaStartSession(undefined, { warn: (...args) => warnings.push(args) })
  const h = startHarness({ phase: 'ready', items: [
    { workspaceId: 'workspace-a', path: 'C:\\a', sessionIds: ['old'] },
    { workspaceId: 'workspace-b', path: 'C:\\b', sessionIds: [] }
  ] }, { phase: 'ready', current: 'old', ids: ['old'], byId: { old: { id: 'old', cwd: 'C:\\a' } } })
  startSession.call(h.service, 'workspace-a')
  startSession.call(h.service, 'workspace-b')
  h.creates[1].pending.reject(new Error('latest failure'))
  await flushPromises()
  assert.deepEqual(h.opens, ['old'])
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0][0], 'new session failed:')
  assert.equal(h.service.pendingSessionWorkspaceTarget, undefined)
  assert.equal(h.service.pendingSessionOriginalSession, undefined)
  h.creates[0].pending.reject(new Error('stale failure'))
  await flushPromises()
  assert.deepEqual(h.opens, ['old'])
  assert.equal(warnings.length, 1)
})

test('New Session resolves membership lag through cwd then only a session-bound hint', async () => {
  const startSession = await compiledAlphaStartSession()
  const workspace = { phase: 'ready', items: [{ workspaceId: 'workspace-a', path: 'C:\\a', sessionIds: [] }] }
  const cwd = startHarness(workspace, { phase: 'ready', current: 'lagged', ids: ['lagged'], byId: { lagged: { id: 'lagged', cwd: 'C:\\a' } } })
  startSession.call(cwd.service)
  assert.equal(cwd.creates[0].request.workspaceId, 'workspace-a')
  const hinted = startHarness(workspace, { phase: 'ready', current: 'hinted', ids: ['hinted'], byId: { hinted: { id: 'hinted', cwd: 'C:\\unknown' } } })
  hinted.service.sessionWorkspaceHint = { sessionId: 'hinted', workspaceId: 'workspace-a' }
  startSession.call(hinted.service)
  assert.equal(hinted.creates[0].request.workspaceId, 'workspace-a')
  assert.equal(hinted.service.sessionWorkspaceHints, undefined)
})

test('a stale hint cannot route an externally selected foreign session', async () => {
  const warnings = []
  const startSession = await compiledAlphaStartSession(() => undefined, { warn: (...args) => warnings.push(args) })
  const workspace = { phase: 'loading', items: [{ workspaceId: 'workspace-a', path: 'C:\\a', sessionIds: [] }] }
  const h = startHarness(workspace, { phase: 'ready', current: undefined, ids: [], byId: {} })
  startSession.call(h.service, 'workspace-a')
  h.creates[0].pending.resolve('created-a')
  await flushPromises()
  assert.deepEqual({ ...h.service.sessionWorkspaceHint }, { sessionId: 'created-a', workspaceId: 'workspace-a' })
  h.service.sessions.open('foreign')
  const before = startMutationSnapshot(h)
  startSession.call(h.service)
  assert.equal(h.creates.length, 1, 'foreign current must not consume another session\'s hint')
  assert.equal(h.clears(), before.clears + 1)
  assert.equal(h.service.sessions.list.getSnapshot().current, undefined)
  assert.deepEqual(h.service.sessionWorkspaceHint, before.hint)
  assert.deepEqual(warnings, [])
})

test('many successful New Session creations retain exactly one bounded session/workspace hint object', async () => {
  const startSession = await compiledAlphaStartSession()
  const h = startHarness({ phase: 'ready', items: [] }, { phase: 'ready', current: undefined, ids: [], byId: {} })
  for (let index = 0; index < 256; index += 1) {
    const target = `workspace-${index}`
    const sessionId = `session-${index}`
    startSession.call(h.service, target)
    h.creates[index].pending.resolve(sessionId)
    await flushPromises()
    assert.deepEqual({ ...h.service.sessionWorkspaceHint }, { sessionId, workspaceId: target })
    assert.deepEqual(Object.keys(h.service.sessionWorkspaceHint).sort(), ['sessionId', 'workspaceId'])
    assert.equal(h.service.sessionWorkspaceHints, undefined)
    assert.equal(h.service.pendingSessionWorkspaceTarget, undefined)
    assert.equal(h.service.pendingSessionOriginalSession, undefined)
  }
  assert.equal(Object.keys(h.service).filter(key => key.includes('WorkspaceHint')).length, 1)
})

test('New Session with no explicit current pending or ready recent target only clears', async () => {
  const startSession = await compiledAlphaStartSession(() => undefined)
  const h = startHarness({ phase: 'ready', items: [] }, { phase: 'ready', current: undefined, ids: [], byId: {} })
  startSession.call(h.service)
  assert.equal(h.clears(), 1)
  assert.equal(h.creates.length, 0)
  assert.equal(h.service.pendingSessionWorkspaceTarget, undefined)
})

test('canonical alpha.2 graph rejects every root, location, owner, version and artifact substitution', async () => {
  const pkg = readCandidateJson('package.json')
  const lock = readCandidateJson('package-lock.json')
  const installedCore = readCandidateJson('node_modules/@deepseek-ai/dsh/package.json')
  const { classifyOfficialRuntimeGraph } = await import('../scripts/patch-official-runtime.mjs')
  const selected = selectedDsh(lock)

  const rootVersion = structuredClone(pkg)
  rootVersion.dependencies['@deepseek-ai/dsh'] = LOCAL_VERSION
  assert.throws(() => classifyOfficialRuntimeGraph(rootVersion, lock, installedCore), /package and lock root graphs differ/)

  const lockRootExtra = structuredClone(lock)
  lockRootExtra.packages[''].dependencies['@deepseek-ai/dsh-smuggled'] = TARGET_VERSION
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, lockRootExtra, installedCore), /package and lock root graphs differ/)

  const transitive = selected.find(row => !Object.hasOwn(pkg.dependencies, row.name)).name
  const rootSubstitutionPkg = structuredClone(pkg)
  const rootSubstitutionLock = structuredClone(lock)
  delete rootSubstitutionPkg.dependencies['@deepseek-ai/dsh']
  delete rootSubstitutionLock.packages[''].dependencies['@deepseek-ai/dsh']
  rootSubstitutionPkg.dependencies[transitive] = TARGET_VERSION
  rootSubstitutionLock.packages[''].dependencies[transitive] = TARGET_VERSION
  assert.throws(() => classifyOfficialRuntimeGraph(rootSubstitutionPkg, rootSubstitutionLock, installedCore), /exact root graph changed/)

  for (const section of ['devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const smuggledPkg = structuredClone(pkg)
    const smuggledLock = structuredClone(lock)
    smuggledPkg[section] = { ...(smuggledPkg[section] || {}), '@deepseek-ai/dsh-smuggled': TARGET_VERSION }
    smuggledLock.packages[''][section] = { ...(smuggledLock.packages[''][section] || {}), '@deepseek-ai/dsh-smuggled': TARGET_VERSION }
    assert.throws(() => classifyOfficialRuntimeGraph(smuggledPkg, smuggledLock, installedCore), /exact root graph changed/, section)
  }

  const selectedVersion = structuredClone(lock)
  selectedVersion.packages['node_modules/@deepseek-ai/dsh'].version = LOCAL_VERSION
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, selectedVersion, installedCore), /selected lock version mismatch/)

  const sameRegistryTarball = structuredClone(lock)
  sameRegistryTarball.packages['node_modules/@deepseek-ai/dsh'].resolved = 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.2-alpha.2-forged.tgz'
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, sameRegistryTarball, installedCore), /selected lock graph changed/)
  const forgedIntegrity = structuredClone(lock)
  forgedIntegrity.packages['node_modules/@deepseek-ai/dsh'].integrity = `sha512-${'A'.repeat(86)}==`
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, forgedIntegrity, installedCore), /selected lock graph changed/)

  const missing = structuredClone(lock)
  delete missing.packages[selected[0].location]
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, missing, installedCore), /selected lock graph changed/)
  const extra = structuredClone(lock)
  extra.packages['node_modules/@deepseek-ai/dsh-smuggled'] = {
    name: '@deepseek-ai/dsh-smuggled', version: TARGET_VERSION,
    resolved: 'https://registry.npmjs.org/@deepseek-ai/dsh-smuggled/-/dsh-smuggled-0.1.2-alpha.2.tgz', integrity: `sha512-${'A'.repeat(86)}==`
  }
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, extra, installedCore), /selected lock graph changed/)

  const deleteAndCopy = structuredClone(lock)
  const [victim, donor] = selected
  delete deleteAndCopy.packages[victim.location]
  deleteAndCopy.packages[`node_modules/substitution/node_modules/${donor.name}`] = { ...structuredClone(donor.entry), name: donor.name }
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, deleteAndCopy, installedCore), /selected lock graph changed/)

  const locationSubstitution = structuredClone(lock)
  locationSubstitution.packages['node_modules/@deepseek-ai/dsh'].name = '@deepseek-ai/dsh-api'
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, locationSubstitution, installedCore), /name\/location mismatch/)
  const malformedLocation = structuredClone(lock)
  malformedLocation.packages['node_modules\\@deepseek-ai\\dsh'] = structuredClone(malformedLocation.packages['node_modules/@deepseek-ai/dsh'])
  delete malformedLocation.packages['node_modules/@deepseek-ai/dsh']
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, malformedLocation, installedCore), /lock location is malformed/)

  assert.throws(() => classifyOfficialRuntimeGraph(pkg, lock, { ...installedCore, name: '@deepseek-ai/not-dsh' }), /identity\/version/)
  assert.throws(() => classifyOfficialRuntimeGraph(pkg, lock, { ...installedCore, version: LOCAL_VERSION }), /identity\/version/)
})

test('exact maintained alpha.2 graph retires removed packages and dispatches to their public owners', () => {
  const patch = readText('scripts/patch-official-runtime.mjs')
  const lock = readJson('package-lock.json')
  const patchNeedle = name => `'node_modules', '@deepseek-ai', '${name.slice('@deepseek-ai/'.length)}'`
  for (const artifact of OFFICIAL_ALPHA2_AUDIT.unavailablePatchArtifacts) {
    assert.equal(lock.packages[`node_modules/${artifact.name}`], undefined, `removed alpha.2 package returned: ${artifact.name}`)
    assert.ok(patch.includes(patchNeedle(artifact.name)), `missing fail-closed legacy target ${artifact.name}`)
  }
  for (const marker of ['classifyOfficialRuntimeGraph', "officialGraph.mode === 'alpha2'", 'assertOfficialAlpha2RemovedArtifactsAbsent', 'targetsAlpha2 ? await patchInstalledAlpha2SessionController() : await patchInstalledRuntime()', 'targetsAlpha2 ? await assertInstalledAlpha2NativeSessionList() : await patchInstalledHostApiProxy()']) {
    assert.ok(patch.includes(marker), `missing exact graph retirement marker: ${marker}`)
  }
  assert.ok(patch.includes("await patchCodexParityRuntime(path.join(root, 'node_modules'))"))
})

test('MIT attribution and the migration report retain the frozen network evidence', () => {
  const notice = readText('THIRD_PARTY_NOTICES.md')
  const report = readText('docs/OFFICIAL-ALPHA2-RUNTIME-MIGRATION-PLAN.zh-CN.md')
  assert.match(notice, /## DeepSeek Harness[\s\S]*License: MIT[\s\S]*Copyright \(c\) 2026 DeepSeek/)
  for (const value of [
    OFFICIAL_ALPHA2_AUDIT.github.tag,
    OFFICIAL_ALPHA2_AUDIT.github.commit,
    OFFICIAL_ALPHA2_AUDIT.github.sourceSha256,
    OFFICIAL_ALPHA2_AUDIT.observedAt.directTarballs,
    OFFICIAL_ALPHA2_AUDIT.observedAt.deterministicClosure,
    OFFICIAL_ALPHA2_AUDIT.observedAt.obsoletePatchArtifacts,
    OFFICIAL_ALPHA2_AUDIT.upstreamRuntime.node,
    OFFICIAL_ALPHA2_AUDIT.registry.deterministicClosure.recordsSha256,
    OFFICIAL_ALPHA2_AUDIT.registry.deterministicClosure.packageManifestSha256,
    'runtimeEquivalent=false'
  ]) assert.ok(report.includes(value), `report does not retain ${value}`)
  for (const [name, workspace, integrity] of DIRECT_ALPHA2) {
    assert.ok(report.includes(name), `report omits ${name}`)
    assert.ok(report.includes(workspace), `report omits ${workspace}`)
    assert.ok(report.includes(integrity), `report omits integrity for ${name}`)
  }
  for (const artifact of OFFICIAL_ALPHA2_AUDIT.unavailablePatchArtifacts) {
    for (const value of [artifact.name, artifact.packument, artifact.localIntegrity, artifact.localTarball]) {
      assert.ok(report.includes(value), `report omits obsolete artifact evidence ${value}`)
    }
  }
})

module.exports = { DIRECT_ALPHA2, OFFICIAL_ALPHA2_AUDIT, PATCH_TARGETS }
