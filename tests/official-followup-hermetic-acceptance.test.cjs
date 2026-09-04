'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const helper = require('./helpers/official-followup-hermetic.cjs')
const alpha2Audit = process.env.DSH_HISTORICAL_ALPHA2_AUDIT === '1' ? test : test.skip

const ROOT = path.resolve(__dirname, '..')
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`) }
async function lockFixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'official-alpha2-lock-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.copyFile(path.join(ROOT, 'package.json'), path.join(root, 'package.json')); await fsp.copyFile(path.join(ROOT, 'package-lock.json'), path.join(root, 'package-lock.json')); return root
}
function frozenRow(relative, hash = 'A'.repeat(64)) { return `${relative}|${hash}` }

alpha2Audit('accepted alpha.2 source, static gate, migration and publication inputs are exact hash-bound', () => {
  for (const [relative, expected] of Object.entries(helper.ACCEPTED)) assert.equal(helper.sha256CanonicalTextFile(path.join(ROOT, ...relative.split('/'))), expected, `accepted input drift: ${relative}`)
  assert.equal(helper.ALPHA2, '0.1.2-alpha.2'); assert.equal(helper.TAG, 'dsh-v0.1.2-alpha.2'); assert.equal(helper.COMMIT, '0a53fb55bea101816fa226bb964ae2bed71c343b')
})

test('v1.0.59 hot/cold safety acceptance binds the reviewed product and proof sources without moving history', () => {
  const accepted = Object.freeze({
    'plugins/dsh-agent-teams/lib/index.js': 'a279f058702cc8b5ce14a2f469fedede8a13ad4bc1b40ec8771528ad484e460b',
    'tests/agent-teams-store-performance.test.cjs': '68323e2eecd9e410d75547301275859d681dfac54527fbc36729228596d3a887'
  })
  assert.equal(Object.keys(helper.ACCEPTED).length, 12)
  for (const [relative, expected] of Object.entries(accepted)) {
    assert.equal(helper.ACCEPTED[relative], expected, `reviewed acceptance drift: ${relative}`)
    assert.equal(helper.sha256CanonicalTextFile(path.join(ROOT, ...relative.split('/'))), expected, `reviewed source drift: ${relative}`)
  }
  assert.equal(helper.ALPHA2, '0.1.2-alpha.2'); assert.equal(helper.TAG, 'dsh-v0.1.2-alpha.2'); assert.equal(helper.COMMIT, '0a53fb55bea101816fa226bb964ae2bed71c343b')
  const review = fs.readFileSync(path.join(ROOT, 'docs', 'SECURITY-REVIEW-v1.0.59.zh-CN.md'), 'utf8')
  const evidence = [...Object.values(accepted), 'Promise.allSettled', '删除前的 `fullValidation`', '74/74', '22.67 ms', '12/12', '30.416 ms', '169/169', '29/29', '3.54%']
  for (const contract of evidence) assert.ok(review.includes(contract), `v1.0.59 hot/cold review evidence missing: ${contract}`)
})

test('v1.0.59 cloud performance recovery binds exact optimized sources and unchanged safety gates', () => {
  const accepted = Object.freeze({
    'plugins/dsh-agent-teams/lib/index.js': 'a279f058702cc8b5ce14a2f469fedede8a13ad4bc1b40ec8771528ad484e460b',
    'electron/store/mobile-sync-store.cjs': 'da403e440f5d6c5a8f066e1af8773e32c1b662ef23968f31d84d8679ab33a1ba'
  })
  for (const [relative, expected] of Object.entries(accepted)) {
    assert.equal(helper.sha256CanonicalTextFile(path.join(ROOT, ...relative.split('/'))), expected, `optimized source drift: ${relative}`)
  }
  const review = fs.readFileSync(path.join(ROOT, 'docs', 'SECURITY-REVIEW-v1.0.59.zh-CN.md'), 'utf8')
  for (const contract of [...Object.values(accepted), '40.422 ms', '9.952 ms', '6.277 ms', 'manifest descriptor chain', '同一 canonical text', '`WeakMap` identity', '没有提高阈值', '文件 `fsync` 与原子 rename', 'runtime.fiber.dispose()', '--test-force-exit']) {
    assert.ok(review.includes(contract), `v1.0.59 performance recovery evidence missing: ${contract}`)
  }
  const runtimeTest = fs.readFileSync(path.join(ROOT, 'tests', 'agent-teams-runtime.test.cjs'), 'utf8')
  assert.match(runtimeTest, /finally \{\s*await runtime\.fiber\.dispose\(\)\s*\}/u)
  assert.match(runtimeTest, /t\.after\(async \(\) => \{ await Promise\.all\(contexts\.map\(value => value\.fiber\.dispose\(\)\)\) \}\)/u)
})

test('source exclusions are exact components and cannot hide similarly named product paths', () => {
  for (const value of ['.git/config', 'nested/node_modules/a.js', 'dist/a', 'nested/temp/a', 'evidence/a', '.release-state/v1/state.json', '.cache/a', 'npm-cache/a', '.alpha2-disposable/a', '.official-alpha2-candidate/a', '.release-cache/a']) assert.equal(helper.excluded(value), true, value)
  for (const value of ['attempt/a', 'docs/evidence-report.md', 'tests/temporary.test.cjs', 'distribution/a']) assert.equal(helper.excluded(value), false, value)
})

test('detached copy is byte deterministic, source-stable and inherits neither git nor dependencies', async t => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'official-alpha2-copy-')); t.after(() => fsp.rm(parent, { recursive: true, force: true }))
  const source = path.join(parent, 'source'), detached = path.join(parent, 'detached'); await fsp.mkdir(path.join(source, 'src'), { recursive: true }); await fsp.writeFile(path.join(source, 'src', 'a.txt'), 'alpha\n')
  for (const directory of ['.git', 'node_modules', 'dist', 'temp', 'evidence']) { await fsp.mkdir(path.join(source, directory), { recursive: true }); await fsp.writeFile(path.join(source, directory, 'excluded.txt'), directory) }
  const copied = await helper.copyDetachedSource(source, detached)
  assert.equal(copied.sourceManifest.digest, copied.snapshotManifest.digest); assert.equal(copied.attempts.length, 1); assert.equal(copied.attempts[0].sourceStable, true); assert.equal(copied.attempts[0].snapshotEqual, true)
  assert.deepEqual(copied.snapshotManifest.files.map(row => row.path), ['src/a.txt']); assert.equal(fs.existsSync(path.join(detached, '.git')), false); assert.equal(fs.existsSync(path.join(detached, 'node_modules')), false)
  await assert.rejects(helper.copyDetachedSource(source, path.join(source, 'nested')), /HERMETIC_SNAPSHOT_MUST_BE_DETACHED/u)
})

test('walk accepts a trusted root platform alias but rejects a junction/reparse child escape', async t => {
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'official-alpha2-reparse-')); t.after(() => fsp.rm(parent, { recursive: true, force: true }))
  const root = path.join(parent, 'root'), rootAlias = path.join(parent, 'root-alias'), outside = path.join(parent, 'outside'); await fsp.mkdir(root); await fsp.mkdir(outside); await fsp.writeFile(path.join(root, 'ordinary'), 'ordinary'); await fsp.writeFile(path.join(outside, 'secret'), 'secret')
  await fsp.symlink(root, rootAlias, process.platform === 'win32' ? 'junction' : 'dir')
  assert.deepEqual(helper.manifest(rootAlias).files.map(row => row.path), ['ordinary'])
  await fsp.symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => helper.manifest(rootAlias), /HERMETIC_LINK_OR_REPARSE_FORBIDDEN/u)
})

test('canonical digest uses unsigned UTF-8 bytes, decimal size, lowercase file hash and detects all row drift', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'official-alpha2-digest-')); t.after(() => fsp.rm(root, { recursive: true, force: true }))
  await fsp.writeFile(path.join(root, 'z'), Buffer.from([0, 255])); await fsp.writeFile(path.join(root, 'é'), 'e')
  const rows = ['z', 'é'].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))), hash = crypto.createHash('sha256')
  for (const relative of rows) { const bytes = fs.readFileSync(path.join(root, relative)), fileHash = crypto.createHash('sha256').update(bytes).digest('hex'); hash.update(Buffer.concat([Buffer.from(relative), Buffer.from([0]), Buffer.from(String(bytes.length)), Buffer.from([0]), Buffer.from(fileHash), Buffer.from('\n')])) }
  const first = helper.manifest(root); assert.equal(first.digest, hash.digest('hex').toUpperCase()); assert.deepEqual(first.files.map(row => row.path), rows)
  await fsp.writeFile(path.join(root, 'z'), 'changed'); await fsp.writeFile(path.join(root, 'added'), 'a'); await fsp.rm(path.join(root, 'é'))
  assert.deepEqual(helper.compareManifests(first, helper.manifest(root)).differences.map(row => [row.path, row.kind]), [['added', 'added'], ['z', 'changed'], ['é', 'removed']].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]))))
})

test('Unicode code points stay distinct while malformed UTF-8, unsafe paths, exact duplicates and order inversion fail closed', () => {
  assert.throws(() => helper.parseFrozenManifest(Buffer.from([0xff, 0x0a])), /UTF8/u)
  for (const relative of ['../x', './x', 'a//b', 'a/./b', 'a/../b', 'a/']) {
    assert.throws(() => helper.parseFrozenManifest(Buffer.from(`${frozenRow(relative)}\n`)), /PATH_UNSAFE/u)
  }
  assert.throws(() => helper.parseFrozenManifest(Buffer.from(`${frozenRow('a')}\n${frozenRow('a')}\n`)), /DUPLICATE/u)
  const distinctUnicodePaths = ['é', 'é'].sort(helper.utf8Compare)
  const unicodeRows = helper.parseFrozenManifest(Buffer.from(`${distinctUnicodePaths.map(relative => frozenRow(relative)).join('\n')}\n`))
  assert.deepEqual(unicodeRows.map(row => row.path), distinctUnicodePaths)
  assert.throws(() => helper.parseFrozenManifest(Buffer.from(`${frozenRow('z')}\n${frozenRow('a')}\n`)), /ORDER/u)
  assert.throws(() => helper.assertCanonicalRelativePath(`bad-${String.fromCharCode(0xd800)}`), /PATH_UTF8/u)
})

test('fresh hypothesis and accepted historical npm evidence remain separate and path topology fails closed', async t => {
  assert.deepEqual(helper.MAINTENANCE_BASELINE, { digest: '4DCDD25127B2024AEB9074826FF2D9EF0F53E5AFE350F337C462C58BA8E0FCB3', fileCount: 37064, totalBytes: 713655865 })
  assert.deepEqual(helper.FRESH_INSTALL_BASELINE, { digest: 'B3D892DCB6CD2CC8D5BA062F544C66EBE1336BFD9AD9961408D80D6DA6104991', fileCount: 42855, totalBytes: 359947652, status: 'plain-windows-hypothesis-requires-two-new-installs' })
  assert.deepEqual(helper.ACCEPTED_HISTORICAL_BASELINE, { digest: '17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0', fileCount: 42879, totalBytes: 369552648 })
  assert.throws(() => helper.assertFrozenMatchesManifest([{ path: 'a', sha256: 'A'.repeat(64) }], { fileCount: 1, totalBytes: 1, digest: 'x', files: [{ path: 'b', sha256: 'a'.repeat(64) }] }), /FRESH_INSTALL_BASELINE/u)
  const frozen = Array.from({ length: helper.FRESH_INSTALL_BASELINE.fileCount }, (_, index) => ({ path: `p/${String(index).padStart(5, '0')}`, sha256: 'A'.repeat(64) })), observed = { ...helper.FRESH_INSTALL_BASELINE, files: frozen.map(row => ({ path: row.path, sha256: row.sha256.toLowerCase() })) }
  observed.files.at(-1).path = 'p/path-mismatch'; assert.throws(() => helper.assertFrozenMatchesManifest(frozen, observed), /FROZEN_MANIFEST_MISMATCH/u)
  const historical = ['extraneous: @emnapi/runtime@1.11.3 C:/x', 'extraneous: @img/sharp-wasm32@0.35.4 C:/y']
  assert.deepEqual(helper.assertFreshNpmLsClean({ exitCode: 0, stdout: '{"name":"ok"}' })._hermeticClassification, { classification: 'plain-windows-clean-hypothesis', problemCount: 0 })
  assert.throws(() => helper.assertFreshNpmLsClean({ exitCode: 0, stdout: JSON.stringify({ problems: historical }) }), /FRESH_NPM_LS_PROBLEMS/u)
  assert.deepEqual(helper.assertAcceptedHistoricalNpmLs({ exitCode: 0, stdout: JSON.stringify({ problems: historical }) })._hermeticClassification, { classification: 'accepted-historical-integrity-locked-platform-orphans', problemCount: 2, ordered: true })
  for (const problems of [[], [...historical].reverse(), [...historical, 'extraneous: extra@1 C:/z'], ['extraneous: @emnapi/runtime@1.11.2 C:/x', historical[1]]]) assert.throws(() => helper.assertAcceptedHistoricalNpmLs({ exitCode: 0, stdout: JSON.stringify({ problems }) }), /ACCEPTED_HISTORICAL_NPM_LS_PROBLEMS/u)
  assert.throws(() => helper.assertFreshNpmLsClean({ exitCode: 1, stdout: '{}' }), /NPM_LS_EXIT/u)
  assert.throws(() => helper.assertAcceptedHistoricalNpmLs({ exitCode: 1, stdout: JSON.stringify({ problems: historical }) }), /NPM_LS_EXIT/u)
  for (const problem of ['invalid: @deepseek-ai/dsh@0.1.1-rc.2', 'peer dep missing: x']) assert.throws(() => helper.assertAcceptedHistoricalNpmLs({ exitCode: 0, stdout: JSON.stringify({ problems: [problem] }) }), /DSH_OR_PEER_DRIFT/u)
  const parent = await fsp.mkdtemp(path.join(os.tmpdir(), 'official-alpha2-paths-')); t.after(() => fsp.rm(parent, { recursive: true, force: true }))
  const source = path.join(parent, 'source'), run = path.join(parent, 'run'); await fsp.mkdir(source); await fsp.mkdir(run)
  assert.equal(helper.assertPathPlan(source, run, { snapshot: path.join(run, 'snapshot'), evidence: path.join(run, 'evidence'), audit: path.join(run, 'audit') }), true)
  assert.throws(() => helper.assertPathPlan(source, run, { snapshot: path.join(run, 'same'), evidence: path.join(run, 'same') }), /PATHS_NOT_DISTINCT/u)
  assert.throws(() => helper.assertPathPlan(source, run, { snapshot: path.join(run, 'snapshot'), evidence: path.join(run, 'snapshot', 'nested') }), /PATHS_NOT_DISTINCT/u)
  assert.throws(() => helper.assertPathPlan(source, run, { snapshot: path.join(parent, 'outside') }), /PATH_OUTSIDE_RUN/u)
  assert.equal(helper.assertUnusedRunRoot(path.join(parent, '20260831-181500')), true)
  assert.throws(() => helper.assertUnusedRunRoot(run), /RUN_ROOT_MUST_BE_UNUSED/u)
  for (const token of helper.REJECTED_RUN_ROOT_TOKENS) assert.throws(() => helper.assertUnusedRunRoot(path.join(parent, token)), /REJECTED_RUN_ROOT/u)
  const accepted = path.join(parent, 'accepted-overlay'); await fsp.mkdir(accepted)
  assert.equal(helper.assertExternalAuditBoundary(source, run, accepted), true)
  assert.throws(() => helper.assertExternalAuditBoundary(source, run, path.join(source, 'accepted')), /ACCEPTED_AUDIT_BOUNDARY/u)
  assert.throws(() => helper.assertExternalAuditBoundary(source, run, path.join(run, 'accepted')), /ACCEPTED_AUDIT_BOUNDARY/u)
})

alpha2Audit('lock audit proves exact 20 roots, 861 locations, 216 DSH locations, 215 names and strict remote integrity', async t => {
  const root = await lockFixture(t), accepted = helper.auditLock(root)
  assert.deepEqual(accepted.graph, { roots: 20, locations: 216, uniqueNames: 215, wrongVersion: 0, nonCanonicalResolved: 0, badIntegrity: 0, removedPackages: 0, mixedRcAlpha: 0 }); assert.equal(accepted.packageEntries, 861)
  assert.deepEqual(Object.keys(accepted.remoteOriginCounts).sort(), [...helper.REMOTE_ORIGINS].sort())
  const lockFile = path.join(root, 'package-lock.json'), original = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
  const cases = [
    ['version', lock => { lock.packages['node_modules/@deepseek-ai/dsh'].version = '0.1.1-rc.2' }, /ALPHA2_CLOSURE/u],
    ['resolved', lock => { lock.packages['node_modules/@deepseek-ai/dsh'].resolved = 'https://evil.invalid/dsh.tgz' }, /REMOTE_ORIGIN/u],
    ['integrity', lock => { delete lock.packages['node_modules/@deepseek-ai/dsh'].integrity }, /LOCK_INTEGRITY/u],
    ['removed', lock => { lock.packages['node_modules/@deepseek-ai/dsh-client-runtime'] = { version: helper.ALPHA2, resolved: 'https://registry.npmjs.org/x', integrity: 'sha512-YWJj' } }, /ALPHA2_CLOSURE/u],
    ['root', lock => { lock.packages[''].dependencies['@deepseek-ai/dsh'] = '0.1.1-rc.2' }, /ROOT_LOCK_DRIFT/u]
  ]
  for (const [, mutate, pattern] of cases) { const drift = structuredClone(original); mutate(drift); writeJson(lockFile, drift); assert.throws(() => helper.auditLock(root), pattern) }
})

test('partial first patch and any second-pass drift fail closed', () => {
  assert.equal(helper.validatePatchDeltas({ differenceCount: 25 }, { equal: true, differenceCount: 0 }), true)
  assert.throws(() => helper.validatePatchDeltas({ differenceCount: 24 }, { equal: true, differenceCount: 0 }), /PATCH_FIRST_DELTA/u)
  assert.throws(() => helper.validatePatchDeltas({ differenceCount: 25 }, { equal: false, differenceCount: 1 }), /PATCH_NOT_IDEMPOTENT/u)
})

test('matrix is eight independent processes, includes pet/mobile/New Session/performance and binds threats without hard-coded source count', () => {
  assert.deepEqual(Object.keys(helper.GROUPS), ['submission', 'routing', 'canonical', 'official', 'surfaces', 'ui', 'resilience', 'performance'])
  const files = Object.values(helper.GROUPS).flat(); assert.equal(new Set(files).size, files.length)
  for (const required of ['official-alpha2-core-compat.test.cjs', 'official-core-rpc-endpoints.test.cjs', 'official-alpha2-runtime-migration.test.cjs', 'pet-event-adapter.test.cjs', 'mobile-runtime.test.cjs', 'session-list-metadata-performance.test.cjs']) assert.ok(files.includes(required), required)
  const sources = Object.fromEntries(Object.entries(helper.GROUPS).map(([group, names]) => [group, names.map(name => fs.readFileSync(path.join(ROOT, 'tests', name), 'utf8')).join('\n')]))
  const combined = Object.values(sources).join('\n')
  for (const pattern of [/submission/iu, /acceptance/iu, /canonical project/iu, /recovery/iu, /cursor/iu, /lock/iu, /New Session/iu, /SessionManager/iu, /pet/iu, /integrity/iu, /anchor/iu, /stale/iu, /replay/iu, /accessib|aria/iu, /performance/iu]) assert.match(combined, pattern)
})

test('publication scan binds accepted hashes and classifies every stale historical token', () => {
  const rows = helper.scanPublicationDocs(ROOT); assert.equal(rows.length, 3)
  for (const row of rows) { assert.equal(row.sha256, helper.ACCEPTED[row.file]); assert.ok(row.stale.every(item => item.classification === 'superseded-history')) }
})

test('CLI and executor require fresh roots, exact npm commands, full audit env, receipts and zero-skip enforcement', () => {
  assert.throws(() => helper.parseCli([]), /HERMETIC_CLI_REQUIRED/u)
  const source = fs.readFileSync(path.join(__dirname, 'helpers', 'official-followup-hermetic.cjs'), 'utf8')
  assert.match(source, /\['ci', '--ignore-scripts', '--no-audit', '--no-fund'\]/u); assert.match(source, /\['ls', '--all', '--json'\]/u); assert.match(source, /npm_config_registry: 'https:\/\/registry\.npmjs\.org\/'/u)
  assert.match(source, /DSH_ALPHA2_AUDIT_ROOT: acceptedMigration\.auditRoot/u); assert.match(source, /DSH_ALPHA2_CANDIDATE_ROOT: snapshotRoot/u); assert.match(source, /assertFreshNpmLsClean\(npmLs\)/u); assert.match(source, /assertAcceptedHistoricalNpmLs/u); assert.doesNotMatch(source, /assertNpmLsClean/u); assert.match(source, /assertFrozenMatchesManifest/u); assert.match(source, /read-only-accepted-historical-migration-overlay/u)
  assert.match(source, /const firstRoot = snapshotRoot/u); assert.match(source, /firstInstallReceipt, firstNpmLsReceipt/u); assert.match(source, /summary\.tests !== summary\.pass/u); assert.match(source, /summary\.skipped/u); assert.match(source, /resourceUsage\.maxRSS/u); assert.match(source, /stdoutSha256/u)
  assert.equal([...source.matchAll(/run\(process\.execPath, \[path\.join\('scripts', 'patch-official-runtime\.mjs'\)\]/gu)].length, 2)
  assert.doesNotMatch(source, /npm[^\n]*(?:run\s+(?:pack|dist|release)|start|dev)/iu); assert.doesNotMatch(source, /electron(?:\.exe)?/iu)
})
