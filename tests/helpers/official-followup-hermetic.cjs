'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const https = require('node:https')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ALPHA2 = '0.1.2-alpha.2'
const TAG = 'dsh-v0.1.2-alpha.2'
const COMMIT = '0a53fb55bea101816fa226bb964ae2bed71c343b'
const EXCLUDED_COMPONENTS = new Set(['.git', 'node_modules', 'dist', 'temp', 'evidence', '.release-state', '.cache', 'cache', 'npm-cache'])
const DISPOSABLE_COMPONENT = /^(?:\.alpha2-|\.official-(?:followup|alpha2|runtime)|\.release-(?:cache|evidence|candidate|artifacts))/u
const REMOTE_ORIGINS = new Set(['https://registry.npmjs.org', 'https://registry.npmmirror.com', 'https://codeload.github.com'])
const MAINTENANCE_BASELINE = Object.freeze({ digest: '4DCDD25127B2024AEB9074826FF2D9EF0F53E5AFE350F337C462C58BA8E0FCB3', fileCount: 37064, totalBytes: 713655865 })
const FRESH_INSTALL_BASELINE = Object.freeze({ digest: 'B3D892DCB6CD2CC8D5BA062F544C66EBE1336BFD9AD9961408D80D6DA6104991', fileCount: 42855, totalBytes: 359947652, status: 'plain-windows-hypothesis-requires-two-new-installs' })
const ACCEPTED_HISTORICAL_BASELINE = Object.freeze({ digest: '17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0', fileCount: 42879, totalBytes: 369552648 })
const REJECTED_RUN_ROOT_TOKENS = Object.freeze(['160456', '162000', '164000', '165000', '170000'])
const ACCEPTED = Object.freeze({
  'package.json': 'c2246e173680bf03897f0d87fc6a66b0d252cc1a6c85714f835e9de4c6994014',
  'package-lock.json': 'ab011b915c803ea215874bd688a90a110eb5ddd6dbfabcd3a0d85811dbf39904',
  'scripts/patch-official-runtime.mjs': 'b7b2cb0f4cff2857425d75de8580ebf4155e3657bd3477fc4f92fb43a925e153',
  'scripts/verify-static.mjs': '66585d57d28ce767798d3a4b828f5d04dde4ef3675fbec7bb67c9756bd872e72',
  'plugins/dsh-agent-teams/lib/index.js': '2fa992584f0509a23be0c3f24c2827507a4ef39ba0c21dcac18982f3550d5878',
  'tests/agent-teams-store-performance.test.cjs': '68323e2eecd9e410d75547301275859d681dfac54527fbc36729228596d3a887',
  'tests/official-alpha2-static-release-contract.test.cjs': '9babbbd8f5cc901befba380595cd0bfc8fb37793ee016b872c9fcd55c409e2cb',
  'tests/official-alpha2-runtime-migration.test.cjs': 'd002a0d0b19674d07beda48c892b181cedb58bcc1cf7cdfeeaa84c4c34298472',
  'docs/OFFICIAL-ALPHA2-RUNTIME-INTEGRATION.zh-CN.md': '7040aec30923a7cb06eb6e27e3515f842caa49360758a966532b301a99f3f03b',
  'README.md': '964e1ec2866f00ad73f2fe7dcdba7e1835ca131065a975635767e38e3e2d9058',
  'CHANGELOG.md': '6c62aa1a1e9e3290fc06dc0239aee2956e77f51bbe2f87c5363ba09dc441ae34',
  'release-notes.md': 'e2795a871dd81b6ee96695d720006909ed9d5471b266ece8c3a6c8b5ace0c7b5'
})
const ACCEPTED_MIGRATION_FILES = Object.freeze({
  'candidate-summary.json': '76cce10f2aeb698528f61ddb54fcd94bc274409a89554c45cdc2643eefe2ae15',
  'canonical-install-first-hardened.json': '5a1d0e7972931093f34b1a7fec8511424b0584b970ab87bc923fcb43e28e12be',
  'canonical-install-second-hardened.json': '7832fe8003253c747b06f52709da9764747e858ea9ee3b677ac9de1719398380',
  'canonical-install-manifest.txt': 'ad7ddcf969f02b7121ba83229fb374f6fecfaf9ead7e8aa5a5b508c18d3a0e96',
  'npm-ls-first.json': '2f74fcc84afa226c859bd7df97f7f4950976f53026d32557afde5343a780046c',
  'npm-ls-second.json': '23d20622a6b6c4518402771fedf5c276f657708a101472677fe959bef30f6d73'
})
const GROUPS = Object.freeze({
  submission: ['agent-teams-task-submission-protocol.test.cjs', 'agent-teams-lifecycle-hardening.test.cjs', 'agent-teams-domain.test.cjs', 'agent-teams-planning-contract.test.cjs'],
  routing: ['agent-teams-multi-team-routing-policy.test.cjs', 'agent-teams-concurrency.test.cjs', 'agent-teams-cross-goal-parallelism.test.cjs', 'agent-teams-runtime.test.cjs'],
  canonical: ['agent-teams-cross-session-board.test.cjs', 'agent-teams-cross-session-multi-project-qa.test.cjs', 'agent-teams-tools.test.cjs', 'project-multi-project-isolation.test.cjs', 'official-core-isolated-acceptance.test.cjs'],
  official: ['official-alpha2-static-release-contract.test.cjs', 'official-alpha2-runtime-contract.test.cjs', 'official-alpha2-runtime-migration.test.cjs', 'official-alpha2-core-compat.test.cjs', 'official-core-rpc-endpoints.test.cjs', 'official-runtime-patch.test.cjs', 'official-runtime-patch-composition.test.cjs', 'official-alpha2-ui-seam-contract.test.cjs', 'official-alpha2-remote-session-seam.test.cjs'],
  surfaces: ['mobile-runtime.test.cjs', 'mobile-sync-service.test.cjs', 'mobile-session-cache.test.cjs', 'pet-event-adapter.test.cjs', 'pet-domain-service.test.cjs', 'pet-companion-engine.test.cjs', 'agent-teams-session-launch-service.test.cjs', 'agent-teams-session-launch-caller-root.test.cjs'],
  ui: ['agent-teams-ui.test.cjs', 'agent-teams-workbench-ui.test.cjs', 'right-workspace-ui.test.cjs', 'settings-layout-ui.test.cjs', 'mobile-web-accessibility.test.cjs', 'mobile-navigation.test.cjs', 'modal-focus.test.cjs'],
  resilience: ['agent-teams-cross-session-continuous-work.test.cjs', 'agent-teams-cross-session-security-qa.test.cjs', 'agent-teams-top-level-session-launch.test.cjs', 'agent-teams-authorization-service.test.cjs', 'agent-teams-secret-service.test.cjs'],
  performance: ['agent-teams-cross-session-board-performance.test.cjs', 'agent-teams-performance.test.cjs', 'agent-teams-store-performance.test.cjs', 'session-list-metadata-performance.test.cjs', 'session-persistence-performance.test.cjs', 'plugin-client-lifecycle-performance.test.cjs', 'renderer-observer-performance.test.cjs']
})

function normalizeRelative(value) { return value.split(path.sep).join('/') }
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function canonicalLfText(value) { return String(value).replace(/\r\n?/gu, '\n') }
function sha256CanonicalTextFile(file) { return sha256Buffer(canonicalLfText(fs.readFileSync(file, 'utf8'))) }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)) }
function utf8Compare(left, right) { return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')) }
function inside(parent, candidate) { const relative = path.relative(path.resolve(parent), path.resolve(candidate)); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) }
function excluded(relative) { return Boolean(relative) && normalizeRelative(relative).split('/').some(component => EXCLUDED_COMPONENTS.has(component) || DISPOSABLE_COMPONENT.test(component)) }
function assertCanonicalRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.includes('\0') || value.includes('\r') || value.includes('\n')) throw new Error(`HERMETIC_PATH_MALFORMED:${String(value)}`)
  if (Buffer.from(value, 'utf8').toString('utf8') !== value) throw new Error(`HERMETIC_PATH_UTF8:${value}`)
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`HERMETIC_PATH_UNSAFE:${value}`)
  return value
}
function assertOrdinaryEntry(trustedRoot, absolute, relative) {
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) throw new Error(`HERMETIC_LINK_OR_REPARSE_FORBIDDEN:${normalizeRelative(relative)}`)
  const real = fs.realpathSync.native(absolute)
  if (!inside(trustedRoot, real)) throw new Error(`HERMETIC_ESCAPE_FORBIDDEN:${normalizeRelative(relative)}`)
  if (!stat.isDirectory() && !stat.isFile()) throw new Error(`HERMETIC_SPECIAL_ENTRY_FORBIDDEN:${normalizeRelative(relative)}`)
  return stat
}
function walkFiles(root, options = {}) {
  const rows = []
  const trustedRoot = fs.existsSync(root) ? fs.realpathSync.native(path.resolve(root)) : path.resolve(root)
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      if (options.excludeSource && excluded(relative)) continue
      assertCanonicalRelativePath(relative)
      const absolute = path.join(directory, entry.name)
      const stat = assertOrdinaryEntry(trustedRoot, absolute, relative)
      if (stat.isDirectory()) visit(absolute, relative)
      else rows.push({ path: relative, size: stat.size, sha256: sha256File(absolute) })
    }
  }
  if (fs.existsSync(root)) visit(path.resolve(root))
  rows.sort((a, b) => utf8Compare(a.path, b.path))
  return rows
}
function manifest(root, options = {}) {
  const files = walkFiles(root, options)
  const hash = crypto.createHash('sha256')
  for (const row of files) hash.update(Buffer.concat([Buffer.from(row.path, 'utf8'), Buffer.from([0]), Buffer.from(String(row.size)), Buffer.from([0]), Buffer.from(row.sha256), Buffer.from('\n')]))
  return { algorithm: 'sha256(utf8(path)\\0decimal-size\\0lowercase-file-sha256\\n), rows sorted by unsigned UTF-8 Buffer.compare', root: path.resolve(root), fileCount: files.length, totalBytes: files.reduce((sum, row) => sum + row.size, 0), digest: hash.digest('hex').toUpperCase(), files }
}
function compareManifests(before, after) {
  const differences = [], left = new Map(before.files.map(row => [row.path, row])), right = new Map(after.files.map(row => [row.path, row]))
  for (const key of [...new Set([...left.keys(), ...right.keys()])].sort(utf8Compare)) {
    const a = left.get(key), b = right.get(key)
    if (!a) differences.push({ path: key, kind: 'added', after: b.sha256 })
    else if (!b) differences.push({ path: key, kind: 'removed', before: a.sha256 })
    else if (a.size !== b.size || a.sha256 !== b.sha256) differences.push({ path: key, kind: 'changed', before: a.sha256, after: b.sha256 })
  }
  return { equal: differences.length === 0, differenceCount: differences.length, differences }
}
async function copyDetachedSource(sourceRoot, snapshotRoot, options = {}) {
  const source = path.resolve(sourceRoot), destination = path.resolve(snapshotRoot), attempts = [], maxAttempts = Number(options.maxAttempts || 3)
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('HERMETIC_SOURCE_COPY_ATTEMPTS_INVALID')
  if (inside(source, destination) || inside(destination, source)) throw new Error('HERMETIC_SNAPSHOT_MUST_BE_DETACHED')
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await fsp.rm(destination, { recursive: true, force: true }); await fsp.mkdir(destination, { recursive: true })
    const before = manifest(source, { excludeSource: true })
    for (const row of before.files) { const to = path.join(destination, ...row.path.split('/')); await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.copyFile(path.join(source, ...row.path.split('/')), to, fs.constants.COPYFILE_EXCL) }
    const after = manifest(source, { excludeSource: true }), copied = manifest(destination)
    const sourceStable = compareManifests(before, after).equal, snapshotEqual = compareManifests(after, copied).equal
    attempts.push({ attempt, beforeDigest: before.digest, afterDigest: after.digest, snapshotDigest: copied.digest, sourceStable, snapshotEqual })
    if (sourceStable && snapshotEqual) return { sourcePreManifest: before, sourceManifest: after, snapshotManifest: copied, attempts }
  }
  await fsp.rm(destination, { recursive: true, force: true }); throw Object.assign(new Error('HERMETIC_SOURCE_COPY_CONCURRENT_DRIFT'), { attempts })
}
function packageNameFromLockKey(key) { const marker = 'node_modules/'; const tail = key.slice(key.lastIndexOf(marker) + marker.length); return tail.startsWith('@') ? tail.split('/').slice(0, 2).join('/') : tail.split('/')[0] }
function isDsh(name) { return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-') }
function auditLock(snapshotRoot) {
  const packageBytes = fs.readFileSync(path.join(snapshotRoot, 'package.json')), lockBytes = fs.readFileSync(path.join(snapshotRoot, 'package-lock.json')), pkg = JSON.parse(packageBytes), lock = JSON.parse(lockBytes)
  if (lock.lockfileVersion !== 3) throw new Error(`HERMETIC_LOCKFILE_VERSION:${lock.lockfileVersion}`)
  const root = lock.packages?.['']; if (!root) throw new Error('HERMETIC_LOCK_ROOT_MISSING')
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) for (const [name, value] of Object.entries(pkg[section] || {})) if (root[section]?.[name] !== value) throw new Error(`HERMETIC_ROOT_LOCK_DRIFT:${section}:${name}`)
  const roots = Object.entries(pkg.dependencies || {}).filter(([name]) => isDsh(name)); if (roots.length !== 20 || roots.some(([, value]) => value !== ALPHA2)) throw new Error('HERMETIC_ALPHA2_ROOT_SET')
  const remote = [], badOrigins = [], missingIntegrity = []
  for (const [key, entry] of Object.entries(lock.packages || {})) if (entry?.resolved) {
    let url; try { url = new URL(entry.resolved) } catch { throw new Error(`HERMETIC_LOCK_RESOLVED_MALFORMED:${key}`) }
    if (url.protocol !== 'https:' || !REMOTE_ORIGINS.has(url.origin)) badOrigins.push({ key, resolved: entry.resolved })
    if (!entry.integrity || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity)) missingIntegrity.push(key)
    remote.push({ key, version: entry.version, resolved: entry.resolved, integrity: entry.integrity || null })
  }
  if (badOrigins.length) throw new Error(`HERMETIC_LOCK_REMOTE_ORIGIN:${badOrigins[0].key}`)
  if (missingIntegrity.length) throw new Error(`HERMETIC_LOCK_INTEGRITY:${missingIntegrity[0]}`)
  const dsh = Object.entries(lock.packages || {}).filter(([key]) => key && isDsh(packageNameFromLockKey(key)))
  const unique = new Set(dsh.map(([key]) => packageNameFromLockKey(key)))
  const wrong = dsh.filter(([, entry]) => entry.version !== ALPHA2), nonCanonical = dsh.filter(([, entry]) => !entry.resolved?.startsWith('https://registry.npmjs.org/')), mixed = dsh.filter(([, entry]) => /(?:rc|alpha\.(?!2(?:$|\D)))/u.test(entry.version || ''))
  const removed = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-host-apiproxy'].filter(name => lock.packages[`node_modules/${name}`])
  if (Object.keys(lock.packages).length !== 861 || dsh.length !== 216 || unique.size !== 215 || wrong.length || nonCanonical.length || mixed.length || removed.length) throw new Error('HERMETIC_ALPHA2_CLOSURE')
  return { packageSha256: sha256Buffer(packageBytes), lockSha256: sha256Buffer(lockBytes), lockfileVersion: 3, packageEntries: 861, remoteEntries: remote.length, remoteOriginCounts: remote.reduce((out, row) => { const key = new URL(row.resolved).origin; out[key] = (out[key] || 0) + 1; return out }, {}), integrityAlgorithmCounts: remote.reduce((out, row) => { const key = row.integrity.split('-')[0]; out[key] = (out[key] || 0) + 1; return out }, {}), graph: { roots: 20, locations: 216, uniqueNames: 215, wrongVersion: 0, nonCanonicalResolved: 0, badIntegrity: 0, removedPackages: 0, mixedRcAlpha: 0 }, remote }
}
function auditInstalled(snapshotRoot, lockAudit) {
  const lock = JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'package-lock.json'), 'utf8')), checked = []
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || !isDsh(packageNameFromLockKey(key))) continue
    const manifestFile = path.join(snapshotRoot, ...key.split('/'), 'package.json')
    if (!fs.existsSync(manifestFile)) { if (entry.optional) continue; throw new Error(`HERMETIC_INSTALLED_DSH_MISSING:${key}`) }
    const installed = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    if (installed.version !== ALPHA2 || installed.name !== packageNameFromLockKey(key)) throw new Error(`HERMETIC_INSTALLED_VERSION_DRIFT:${key}`)
    checked.push({ key, name: installed.name, version: installed.version })
  }
  if (checked.length !== 216) throw new Error(`HERMETIC_INSTALLED_DSH_COUNT:${checked.length}`)
  return { lockSha256: lockAudit.lockSha256, dshLocations: checked.length, dshUniqueNames: new Set(checked.map(row => row.name)).size, installedManifest: manifest(path.join(snapshotRoot, 'node_modules')) }
}
function validatePatchDeltas(first, second) { if (first.differenceCount !== 25) throw new Error(`HERMETIC_PATCH_FIRST_DELTA:${first.differenceCount}`); if (!second.equal || second.differenceCount !== 0) throw new Error(`HERMETIC_PATCH_NOT_IDEMPOTENT:${second.differenceCount}`); return true }
function parseFrozenManifest(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true }); let source
  try { source = decoder.decode(bytes) } catch { throw new Error('HERMETIC_FROZEN_MANIFEST_UTF8') }
  if (!source.endsWith('\n') || source.includes('\r')) throw new Error('HERMETIC_FROZEN_MANIFEST_LINES')
  const seen = new Set(), rows = []
  for (const line of source.slice(0, -1).split('\n')) {
    const split = line.lastIndexOf('|'); if (split <= 0 || !/^[0-9A-F]{64}$/u.test(line.slice(split + 1))) throw new Error('HERMETIC_FROZEN_MANIFEST_ROW')
    const relative = assertCanonicalRelativePath(line.slice(0, split))
    if (seen.has(relative)) throw new Error('HERMETIC_FROZEN_MANIFEST_DUPLICATE')
    seen.add(relative); rows.push({ path: relative, sha256: line.slice(split + 1) })
  }
  for (let index = 1; index < rows.length; index += 1) if (utf8Compare(rows[index - 1].path, rows[index].path) >= 0) throw new Error('HERMETIC_FROZEN_MANIFEST_ORDER')
  return rows
}
function assertRowsMatch(frozenRows, observed, label = 'tree') {
  if (frozenRows.length !== observed.fileCount) throw new Error(`HERMETIC_FROZEN_MANIFEST_COUNT:${label}`)
  for (let index = 0; index < frozenRows.length; index += 1) {
    const expected = frozenRows[index], actual = observed.files[index]
    if (expected.path !== actual.path || expected.sha256 !== actual.sha256.toUpperCase()) throw new Error(`HERMETIC_FROZEN_MANIFEST_MISMATCH:${label}:${index}:${expected.path}`)
  }
  return true
}
function assertFrozenMatchesManifest(frozenRows, observed) {
  if (frozenRows.length !== FRESH_INSTALL_BASELINE.fileCount || observed.fileCount !== FRESH_INSTALL_BASELINE.fileCount || observed.totalBytes !== FRESH_INSTALL_BASELINE.totalBytes || observed.digest !== FRESH_INSTALL_BASELINE.digest) throw new Error('HERMETIC_FRESH_INSTALL_BASELINE')
  return assertRowsMatch(frozenRows, observed, 'fresh')
}
function parseNpmLsReceipt(receipt, label) {
  if (receipt.exitCode !== 0) throw new Error(`HERMETIC_NPM_LS_EXIT:${label}:${receipt.exitCode}`)
  let body; try { body = JSON.parse(receipt.stdout || '{}') } catch { throw new Error(`HERMETIC_NPM_LS_JSON:${label}`) }
  const problems = Array.isArray(body?.problems) ? body.problems : []
  if (problems.some(problem => /@deepseek-ai\/dsh|peer dep|invalid:/iu.test(problem))) throw new Error(`HERMETIC_NPM_LS_DSH_OR_PEER_DRIFT:${label}`)
  return { body, problems }
}
function assertFreshNpmLsClean(receipt) {
  const { body, problems } = parseNpmLsReceipt(receipt, 'fresh-plain-windows')
  if (problems.length !== 0) throw new Error(`HERMETIC_FRESH_NPM_LS_PROBLEMS:${problems.length}`)
  return Object.assign(body, { _hermeticClassification: { classification: 'plain-windows-clean-hypothesis', problemCount: 0 } })
}
function assertAcceptedHistoricalNpmLs(receipt) {
  const { body, problems } = parseNpmLsReceipt(receipt, 'accepted-historical')
  const ordered = [/^extraneous: @emnapi\/runtime@1\.11\.3 /u, /^extraneous: @img\/sharp-wasm32@0\.35\.4 /u]
  if (problems.length !== 2 || !ordered.every((pattern, index) => pattern.test(problems[index]))) throw new Error(`HERMETIC_ACCEPTED_HISTORICAL_NPM_LS_PROBLEMS:${problems.length}`)
  return Object.assign(body, { _hermeticClassification: { classification: 'accepted-historical-integrity-locked-platform-orphans', problemCount: 2, ordered: true } })
}
function assertExternalAuditBoundary(sourceRoot, runRoot, acceptedAuditRoot) {
  const source = path.resolve(sourceRoot), run = path.resolve(runRoot), accepted = path.resolve(acceptedAuditRoot)
  for (const [label, value] of [['source', source], ['run', run]]) if (value === accepted || inside(value, accepted) || inside(accepted, value)) throw new Error(`HERMETIC_ACCEPTED_AUDIT_BOUNDARY:${label}`)
  return true
}
function assertPathPlan(sourceRoot, runRoot, paths) {
  const source = path.resolve(sourceRoot), run = path.resolve(runRoot)
  if (inside(source, run) || inside(run, source)) throw new Error('HERMETIC_RUN_ROOT_NOT_DETACHED')
  const rows = Object.entries(paths).map(([label, value]) => [label, path.resolve(value)])
  for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
    if (rows[left][1] === rows[right][1] || inside(rows[left][1], rows[right][1]) || inside(rows[right][1], rows[left][1])) throw new Error(`HERMETIC_PATHS_NOT_DISTINCT:${rows[left][0]}:${rows[right][0]}`)
  }
  for (const [label, value] of rows) if (!inside(run, value)) throw new Error(`HERMETIC_PATH_OUTSIDE_RUN:${label}`)
  return true
}
function run(command, args, options = {}) {
  const started = process.hrtime.bigint(), result = spawnSync(command, args, { cwd: options.cwd, env: { ...process.env, ...(options.env || {}) }, encoding: 'utf8', maxBuffer: options.maxBuffer || 256 * 1024 * 1024, windowsHide: true, shell: false })
  const receipt = { command: [command, ...args], cwd: options.cwd, exitCode: result.status, signal: result.signal, durationMs: Number(process.hrtime.bigint() - started) / 1e6, stdout: result.stdout || '', stderr: result.stderr || '' }
  receipt.stdoutSha256 = sha256Buffer(receipt.stdout); receipt.stderrSha256 = sha256Buffer(receipt.stderr)
  if (result.error) throw Object.assign(new Error(`HERMETIC_COMMAND_ERROR:${result.error.message}`), { receipt })
  if (!options.allowFailure && result.status !== 0) throw Object.assign(new Error(`HERMETIC_COMMAND_FAILED:${command}:${result.status}`), { receipt })
  return receipt
}
function parseNodeTest(receipt) { const text = `${receipt.stdout}\n${receipt.stderr}`; const read = key => Number(text.match(new RegExp(`^(?:#|ℹ) ${key} (\\d+)$`, 'mu'))?.[1] || 0); return { tests: read('tests'), suites: read('suites'), pass: read('pass'), fail: read('fail'), cancelled: read('cancelled'), skipped: read('skipped'), todo: read('todo') } }
function createMetricsPreload(evidenceRoot) { const file = path.join(evidenceRoot, 'node-test-process-metrics.cjs'); fs.writeFileSync(file, `'use strict'\nconst fs=require('node:fs');process.on('exit',()=>{const f=process.env.DSH_NODE_METRICS_FILE;if(f)fs.writeFileSync(f,JSON.stringify({pid:process.pid,resourceUsage:process.resourceUsage(),memoryUsage:process.memoryUsage()})+'\\n')})\n`); return file }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`) }
function runGroups(snapshotRoot, environment, evidenceRoot) {
  const receipts = [], preload = createMetricsPreload(evidenceRoot)
  for (const [group, files] of Object.entries(GROUPS)) {
    for (const file of files) if (!fs.existsSync(path.join(snapshotRoot, 'tests', file))) throw new Error(`HERMETIC_MATRIX_FILE_MISSING:${group}:${file}`)
    const metricsFile = path.join(evidenceRoot, `node-metrics-${group}.json`), explicit = { ...environment, NODE_PATH: path.join(snapshotRoot, 'node_modules'), DSH_NODE_METRICS_FILE: metricsFile }
    let receipt, failure
    try { receipt = run(process.execPath, ['--require', preload, '--test', '--test-concurrency=1', ...files.map(file => path.join('tests', file))], { cwd: snapshotRoot, env: explicit, maxBuffer: 512 * 1024 * 1024 }) } catch (error) { receipt = error.receipt; failure = error }
    const summary = parseNodeTest(receipt), metrics = fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, 'utf8')) : null
    const row = { group, sourceTestFileCount: files.length, files, environment: explicit, ...receipt, summary, metrics }; receipts.push(row); writeJson(path.join(evidenceRoot, 'matrix-receipts.partial.json'), receipts)
    if (failure || !metrics || summary.tests <= 0 || summary.tests !== summary.pass || summary.fail || summary.cancelled || summary.skipped || summary.todo) throw Object.assign(failure || new Error(`HERMETIC_MATRIX_NOT_ALL_PASS:${group}`), { matrixReceipts: receipts })
  }
  return receipts
}
function npmInvocation(args) { const cli = process.env.npm_execpath && fs.existsSync(process.env.npm_execpath) ? process.env.npm_execpath : path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'); if (!fs.existsSync(cli)) throw new Error(`HERMETIC_NPM_CLI_MISSING:${cli}`); return { command: process.execPath, args: [cli, ...args] } }
function requestJson(url, headers = {}) { return new Promise((resolve, reject) => { const request = https.get(url, { headers: { 'user-agent': 'dsh-hermetic-acceptance', accept: 'application/json', ...headers } }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => { const bytes = Buffer.concat(chunks); if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`HERMETIC_REQUERY_HTTP:${response.statusCode}:${url}`)); try { resolve({ url, statusCode: response.statusCode, headers: { etag: response.headers.etag || null, date: response.headers.date || null }, sha256: sha256Buffer(bytes), body: JSON.parse(bytes) }) } catch (error) { reject(error) } }) }); request.on('error', reject) }) }
async function officialRequery() {
  const queriedAt = new Date().toISOString(), release = await requestJson(`https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/${TAG}`), tag = await requestJson(`https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/${TAG}`), registry = await requestJson('https://registry.npmjs.org/@deepseek-ai%2fdsh')
  const commit = tag.body.object.sha
  if (release.body.tag_name !== TAG || commit !== COMMIT || registry.body['dist-tags']?.alpha !== ALPHA2 || !registry.body.versions?.[ALPHA2]) throw new Error('HERMETIC_OFFICIAL_REQUERY_DRIFT')
  return { queriedAt, expected: { release: TAG, tag: TAG, commit: COMMIT, npmAlpha: ALPHA2 }, observed: { release: release.body.tag_name, releasePublishedAt: release.body.published_at, tag: TAG, commit, npmAlpha: registry.body['dist-tags'].alpha, npmVersion: registry.body.versions[ALPHA2].version, npmIntegrity: registry.body.versions[ALPHA2].dist.integrity }, receipts: { release: { ...release, body: undefined }, tag: { ...tag, body: undefined }, registry: { ...registry, body: undefined } } }
}
function scanPublicationDocs(root) {
  const rows = []
  for (const file of ['README.md', 'CHANGELOG.md', 'release-notes.md']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8'), headings = [...source.matchAll(/^##\s+/gmu)].map(match => match.index), currentEnd = headings[1] || source.length, current = source.slice(0, currentEnd)
    if (!/0\.1\.2-alpha\.5/u.test(current)) throw new Error(`HERMETIC_PUBLICATION_ALPHA5_CURRENT_MISSING:${file}`)
    const stale = [...source.matchAll(/0\.1\.2-alpha\.[234]|0\.1\.1-rc\.2|NO-GO|runtimeEquivalent=false|40(?:\s+个|\s+files)|41(?:\s+个|\s+files)/gu)].map(match => ({ token: match[0], index: match.index, classification: match.index >= currentEnd || /历史|旧|superseded|曾经|此前/u.test(source.slice(Math.max(0, match.index - 120), match.index + 180)) ? 'superseded-history' : 'unclassified' }))
    if (/0\.1\.2-alpha\.[234]|0\.1\.1-rc\.2|NO-GO|runtimeEquivalent=false/u.test(current) && !/superseded|历史|此前/u.test(current)) throw new Error(`HERMETIC_PUBLICATION_CURRENT_STALE:${file}`)
    if (stale.some(item => item.classification !== 'superseded-history')) throw new Error(`HERMETIC_PUBLICATION_STALE_UNCLASSIFIED:${file}`)
    rows.push({ file, sha256: sha256Buffer(canonicalLfText(source)), stale })
  }
  return rows
}
async function copyTree(source, target) { await fsp.rm(target, { recursive: true, force: true }); await fsp.cp(source, target, { recursive: true, verbatimSymlinks: true }) }
async function materializeFreshReproduction(snapshotRoot, runRoot, environment, evidenceRoot, firstInstallReceipt, firstNpmLsReceipt) {
  const firstRoot = snapshotRoot, secondRoot = path.join(runRoot, 'install-second'), cacheOne = environment.npm_config_cache, cacheTwo = path.join(runRoot, 'cache-install-second-empty')
  const firstNpmLs = assertFreshNpmLsClean(firstNpmLsReceipt)
  await fsp.rm(secondRoot, { recursive: true, force: true }); await fsp.mkdir(secondRoot, { recursive: true })
  for (const file of ['package.json', 'package-lock.json']) await fsp.copyFile(path.join(snapshotRoot, file), path.join(secondRoot, file))
  await fsp.rm(cacheTwo, { recursive: true, force: true }); await fsp.mkdir(cacheTwo, { recursive: true })
  const invocation = npmInvocation(['ci', '--ignore-scripts', '--no-audit', '--no-fund']), secondInstall = run(invocation.command, invocation.args, { cwd: secondRoot, env: { ...environment, npm_config_cache: cacheTwo }, maxBuffer: 512 * 1024 * 1024 })
  const npmLs = npmInvocation(['ls', '--all', '--json']), secondNpmLsReceipt = run(npmLs.command, npmLs.args, { cwd: secondRoot, env: { ...environment, npm_config_cache: cacheTwo }, maxBuffer: 512 * 1024 * 1024 }), secondNpmLs = assertFreshNpmLsClean(secondNpmLsReceipt)
  const first = manifest(path.join(firstRoot, 'node_modules')), second = manifest(path.join(secondRoot, 'node_modules')), comparison = compareManifests(first, second)
  if (!comparison.equal) throw new Error('HERMETIC_FRESH_INSTALLS_DIFFER')
  const canonicalBytes = Buffer.from(first.files.map(row => `${row.path}|${row.sha256.toUpperCase()}\n`).join('')), canonicalFile = path.join(evidenceRoot, 'fresh-canonical-install-manifest.txt')
  fs.writeFileSync(canonicalFile, canonicalBytes); const frozen = parseFrozenManifest(canonicalBytes); assertFrozenMatchesManifest(frozen, first); assertFrozenMatchesManifest(frozen, second)
  writeJson(path.join(evidenceRoot, 'npm-ls-main.json'), firstNpmLs); writeJson(path.join(evidenceRoot, 'npm-ls-second.json'), secondNpmLs)
  writeJson(path.join(evidenceRoot, 'fresh-migration-installs.json'), { hypothesis: FRESH_INSTALL_BASELINE, roots: { firstRoot, secondRoot }, caches: { cacheOne, cacheTwo, initiallyEmpty: true, distinct: true }, frozen: { path: canonicalFile, sha256: sha256Buffer(canonicalBytes), rowCount: frozen.length, firstExact: true, secondExact: true }, installReceipts: [firstInstallReceipt, secondInstall], npmLsReceipts: [{ ...firstNpmLsReceipt, stdout: undefined, stderr: undefined }, { ...secondNpmLsReceipt, stdout: undefined, stderr: undefined }], first: { fileCount: first.fileCount, totalBytes: first.totalBytes, digest: first.digest }, second: { fileCount: second.fileCount, totalBytes: second.totalBytes, digest: second.digest }, comparison })
  return { firstRoot, secondRoot, first, second, comparison, npmLs: secondNpmLsReceipt, npmLsClassification: secondNpmLs._hermeticClassification, canonicalFile, canonicalSha256: sha256Buffer(canonicalBytes) }
}
async function materializeAcceptedMigrationAudit(acceptedRoot, evidenceRoot) {
  const container = path.resolve(acceptedRoot), auditRoot = path.join(container, 'project')
  const acceptedFile = file => file === 'candidate-summary.json' || file === 'canonical-install-first-hardened.json' || file === 'canonical-install-second-hardened.json' || file === 'npm-ls-second.json' ? path.join(auditRoot, file) : path.join(container, file)
  for (const [file, expected] of Object.entries(ACCEPTED_MIGRATION_FILES)) if (sha256File(acceptedFile(file)) !== expected) throw new Error(`HERMETIC_ACCEPTED_MIGRATION_DRIFT:${file}`)
  const frozen = parseFrozenManifest(fs.readFileSync(path.join(container, 'canonical-install-manifest.txt'))), first = manifest(path.join(container, 'install-first', 'node_modules')), second = manifest(path.join(container, 'install-second', 'node_modules'))
  assertRowsMatch(frozen, first, 'accepted-first'); assertRowsMatch(frozen, second, 'accepted-second')
  const summary = JSON.parse(fs.readFileSync(path.join(auditRoot, 'candidate-summary.json'), 'utf8'))
  for (const [label, observed] of [['first', first], ['second', second]]) if (observed.digest !== ACCEPTED_HISTORICAL_BASELINE.digest || observed.fileCount !== ACCEPTED_HISTORICAL_BASELINE.fileCount || observed.totalBytes !== ACCEPTED_HISTORICAL_BASELINE.totalBytes) throw new Error(`HERMETIC_ACCEPTED_HISTORICAL_BASELINE:${label}`)
  const firstNpmLs = assertAcceptedHistoricalNpmLs({ exitCode: summary.npmLsFirstExit, stdout: fs.readFileSync(path.join(container, 'npm-ls-first.json'), 'utf8') }), secondNpmLs = assertAcceptedHistoricalNpmLs({ exitCode: summary.npmLsSecondExit, stdout: fs.readFileSync(path.join(auditRoot, 'npm-ls-second.json'), 'utf8') })
  const receipt = { container, auditRoot, classification: 'read-only-accepted-historical-migration-overlay', copiedIntoRun: false, snapshotMutated: false, baseline: ACCEPTED_HISTORICAL_BASELINE, frozenSha256: ACCEPTED_MIGRATION_FILES['canonical-install-manifest.txt'], rowCount: frozen.length, firstDigest: first.digest, secondDigest: second.digest, npmLs: { first: firstNpmLs._hermeticClassification, second: secondNpmLs._hermeticClassification }, exact: true }
  writeJson(path.join(evidenceRoot, 'accepted-migration-audit.json'), receipt); return receipt
}
function assertUnusedRunRoot(runRoot) {
  const resolved = path.resolve(runRoot), normalized = normalizeRelative(resolved)
  if (REJECTED_RUN_ROOT_TOKENS.some(token => normalized.includes(token))) throw new Error(`HERMETIC_REJECTED_RUN_ROOT:${resolved}`)
  if (fs.existsSync(resolved)) throw new Error(`HERMETIC_RUN_ROOT_MUST_BE_UNUSED:${resolved}`)
  return true
}
async function execute(options) {
  const sourceRoot = path.resolve(options.sourceRoot), snapshotRoot = path.resolve(options.snapshotRoot), evidenceRoot = path.resolve(options.evidenceRoot), cacheRoot = path.resolve(options.cacheRoot), runRoot = path.dirname(snapshotRoot), acceptedAuditRoot = path.resolve(options.acceptedAuditRoot)
  assertUnusedRunRoot(runRoot)
  assertPathPlan(sourceRoot, runRoot, { snapshotRoot, evidenceRoot, cacheRoot, installSecond: path.join(runRoot, 'install-second'), cacheSecond: path.join(runRoot, 'cache-install-second-empty') })
  assertExternalAuditBoundary(sourceRoot, runRoot, acceptedAuditRoot)
  await fsp.mkdir(evidenceRoot, { recursive: true }); await fsp.mkdir(cacheRoot, { recursive: true })
  const environment = { npm_config_cache: cacheRoot, npm_config_registry: 'https://registry.npmjs.org/', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' }
  const maintainedBefore = manifest(path.join(sourceRoot, 'node_modules'))
  if (maintainedBefore.digest !== MAINTENANCE_BASELINE.digest || maintainedBefore.fileCount !== MAINTENANCE_BASELINE.fileCount || maintainedBefore.totalBytes !== MAINTENANCE_BASELINE.totalBytes) throw new Error('HERMETIC_MAINTENANCE_BASELINE_DRIFT')
  writeJson(path.join(evidenceRoot, 'maintenance-node-modules-before.json'), { ...maintainedBefore, root: '<maintained-node_modules>' })
  let result, operationError
  try {
    for (const [relative, expected] of Object.entries(ACCEPTED)) if (sha256CanonicalTextFile(path.join(sourceRoot, ...relative.split('/'))) !== expected) throw new Error(`HERMETIC_ACCEPTED_SOURCE_DRIFT:${relative}`)
    const copied = await copyDetachedSource(sourceRoot, snapshotRoot); writeJson(path.join(evidenceRoot, 'source-copy.json'), copied)
    const lock = auditLock(snapshotRoot); writeJson(path.join(evidenceRoot, 'lock-audit.json'), lock)
    const publication = scanPublicationDocs(snapshotRoot); writeJson(path.join(evidenceRoot, 'publication-stale-classification.json'), publication)
    const requery = await officialRequery(); writeJson(path.join(evidenceRoot, 'official-requery.json'), requery)
    const registryInvocation = npmInvocation(['config', 'get', 'registry']), registry = run(registryInvocation.command, registryInvocation.args, { cwd: snapshotRoot, env: environment })
    if (registry.stdout.trim() !== 'https://registry.npmjs.org/') throw new Error(`HERMETIC_NPM_REGISTRY:${registry.stdout.trim()}`)
    const ci = npmInvocation(['ci', '--ignore-scripts', '--no-audit', '--no-fund']), install = run(ci.command, ci.args, { cwd: snapshotRoot, env: environment, maxBuffer: 512 * 1024 * 1024 })
    const npmLsInvocation = npmInvocation(['ls', '--all', '--json']), npmLs = run(npmLsInvocation.command, npmLsInvocation.args, { cwd: snapshotRoot, env: environment, maxBuffer: 512 * 1024 * 1024 }), npmLsBody = assertFreshNpmLsClean(npmLs)
    const installed = auditInstalled(snapshotRoot, lock)
    if (installed.installedManifest.digest !== FRESH_INSTALL_BASELINE.digest || installed.installedManifest.fileCount !== FRESH_INSTALL_BASELINE.fileCount || installed.installedManifest.totalBytes !== FRESH_INSTALL_BASELINE.totalBytes) throw new Error('HERMETIC_FRESH_INSTALL_HYPOTHESIS')
    writeJson(path.join(evidenceRoot, 'installed-before-patch.json'), installed)
    const migration = await materializeFreshReproduction(snapshotRoot, runRoot, environment, evidenceRoot, install, npmLs)
    const acceptedMigration = await materializeAcceptedMigrationAudit(acceptedAuditRoot, evidenceRoot)
    const beforePatch = installed.installedManifest, patchOne = run(process.execPath, [path.join('scripts', 'patch-official-runtime.mjs')], { cwd: snapshotRoot, env: environment, maxBuffer: 512 * 1024 * 1024 }), afterOne = manifest(path.join(snapshotRoot, 'node_modules')), deltaOne = compareManifests(beforePatch, afterOne)
    const patchTwo = run(process.execPath, [path.join('scripts', 'patch-official-runtime.mjs')], { cwd: snapshotRoot, env: environment, maxBuffer: 512 * 1024 * 1024 }), afterTwo = manifest(path.join(snapshotRoot, 'node_modules')), deltaTwo = compareManifests(afterOne, afterTwo); validatePatchDeltas(deltaOne, deltaTwo)
    writeJson(path.join(evidenceRoot, 'patch-one-delta.json'), deltaOne); writeJson(path.join(evidenceRoot, 'patch-two-delta.json'), deltaTwo)
    const matrixEnvironment = { ...environment, DSH_ALPHA2_AUDIT_ROOT: acceptedMigration.auditRoot, DSH_ALPHA2_CANDIDATE_ROOT: snapshotRoot }, matrix = runGroups(snapshotRoot, matrixEnvironment, evidenceRoot); writeJson(path.join(evidenceRoot, 'matrix-receipts.json'), matrix)
    const totals = matrix.reduce((out, row) => { for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) out[key] += row.summary[key]; out.durationMs += row.durationMs; out.maxRSS = Math.max(out.maxRSS, row.metrics.resourceUsage.maxRSS); return out }, { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: 0, maxRSS: 0 })
    result = { schemaVersion: 3, generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, release: os.release(), arch: process.arch, cpus: os.cpus().length }, paths: { sourceRoot, runRoot, snapshotRoot, evidenceRoot, cacheRoot, acceptedMigrationAuditRoot: acceptedMigration.auditRoot, installFirst: migration.firstRoot, installSecond: migration.secondRoot }, source: { fileCount: copied.sourceManifest.fileCount, totalBytes: copied.sourceManifest.totalBytes, digest: copied.sourceManifest.digest, attempts: copied.attempts }, lock: { ...lock, remote: undefined }, officialRequery: requery, network: { registry: registry.stdout.trim(), cacheStartedEmpty: true, installMode: 'npm ci --ignore-scripts --no-audit --no-fund' }, install: { exitCode: install.exitCode, durationMs: install.durationMs, npmLsExitCode: npmLs.exitCode, npmLsProblems: npmLsBody._hermeticClassification.problemCount, npmLsClassification: npmLsBody._hermeticClassification.classification, fileCount: beforePatch.fileCount, totalBytes: beforePatch.totalBytes, digest: beforePatch.digest, frozenExact: true }, freshMigrationInstalls: { first: migration.first.digest, second: migration.second.digest, equal: migration.comparison.equal, frozenExact: true, frozenSha256: migration.canonicalSha256, npmLsExitCode: migration.npmLs.exitCode, npmLsProblems: migration.npmLsClassification.problemCount, npmLsClassification: migration.npmLsClassification.classification }, acceptedMigrationAudit: { classification: acceptedMigration.classification, root: acceptedMigration.auditRoot, frozenSha256: acceptedMigration.frozenSha256, rowCount: acceptedMigration.rowCount, npmLs: acceptedMigration.npmLs, exact: acceptedMigration.exact }, patch: { first: { changedFiles: deltaOne.differenceCount, beforeDigest: beforePatch.digest, afterDigest: afterOne.digest, durationMs: patchOne.durationMs }, second: { changedFiles: deltaTwo.differenceCount, beforeDigest: afterOne.digest, afterDigest: afterTwo.digest, durationMs: patchTwo.durationMs } }, publication, matrix: matrix.map(row => ({ group: row.group, files: row.files, sourceTestFileCount: row.sourceTestFileCount, command: row.command, cwd: row.cwd, environment: row.environment, exitCode: row.exitCode, durationMs: row.durationMs, stdoutSha256: row.stdoutSha256, stderrSha256: row.stderrSha256, summary: row.summary, maxRSS: row.metrics.resourceUsage.maxRSS })), totals }
  } catch (error) { operationError = error }
  const maintainedAfter = manifest(path.join(sourceRoot, 'node_modules')), maintenanceComparison = compareManifests(maintainedBefore, maintainedAfter)
  writeJson(path.join(evidenceRoot, 'maintenance-node-modules-after.json'), { ...maintainedAfter, root: '<maintained-node_modules>' }); writeJson(path.join(evidenceRoot, 'maintenance-node-modules-comparison.json'), { algorithm: maintainedBefore.algorithm, beforeDigest: maintainedBefore.digest, afterDigest: maintainedAfter.digest, beforeFileCount: maintainedBefore.fileCount, afterFileCount: maintainedAfter.fileCount, beforeBytes: maintainedBefore.totalBytes, afterBytes: maintainedAfter.totalBytes, ...maintenanceComparison })
  if (maintainedAfter.digest !== MAINTENANCE_BASELINE.digest || maintainedAfter.fileCount !== MAINTENANCE_BASELINE.fileCount || maintainedAfter.totalBytes !== MAINTENANCE_BASELINE.totalBytes || !maintenanceComparison.equal) throw new Error('HERMETIC_MAINTAINED_NODE_MODULES_DRIFT')
  if (operationError) throw operationError
  result.maintenanceNodeModules = { algorithm: maintainedBefore.algorithm, beforeDigest: maintainedBefore.digest, afterDigest: maintainedAfter.digest, fileCount: maintainedAfter.fileCount, totalBytes: maintainedAfter.totalBytes, equal: true }
  writeJson(path.join(evidenceRoot, 'acceptance-result.json'), result); return result
}
function parseCli(argv) { const options = {}; for (let index = 0; index < argv.length; index += 2) { const key = argv[index], value = argv[index + 1]; if (!key?.startsWith('--') || value === undefined) throw new Error(`HERMETIC_CLI_ARGUMENT:${key || '<missing>'}`); options[key.slice(2)] = value } for (const key of ['sourceRoot', 'snapshotRoot', 'evidenceRoot', 'cacheRoot', 'acceptedAuditRoot']) if (!options[key]) throw new Error(`HERMETIC_CLI_REQUIRED:${key}`); return options }
if (require.main === module) execute(parseCli(process.argv.slice(2))).then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(error => { if (error.receipt) process.stderr.write(`${JSON.stringify(error.receipt, null, 2)}\n`); process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1 })
module.exports = { ACCEPTED, ACCEPTED_HISTORICAL_BASELINE, ACCEPTED_MIGRATION_FILES, ALPHA2, COMMIT, EXCLUDED_COMPONENTS, FRESH_INSTALL_BASELINE, GROUPS, MAINTENANCE_BASELINE, REJECTED_RUN_ROOT_TOKENS, REMOTE_ORIGINS, TAG, assertAcceptedHistoricalNpmLs, assertCanonicalRelativePath, assertExternalAuditBoundary, assertFreshNpmLsClean, assertFrozenMatchesManifest, assertPathPlan, assertUnusedRunRoot, auditInstalled, auditLock, compareManifests, copyDetachedSource, execute, excluded, inside, manifest, officialRequery, parseCli, parseFrozenManifest, parseNodeTest, runGroups, scanPublicationDocs, sha256Buffer, sha256CanonicalTextFile, sha256File, utf8Compare, validatePatchDeltas, walkFiles }
