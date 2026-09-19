'use strict'
// Offline core-version compatibility guard for the DeepSeek Harness core (@deepseek-ai/dsh*).
//
// What it does: reads the desktop shell's own version pins and every hard-coded core
// version gate, and proves they all name ONE core version. It never downloads anything,
// never touches node_modules content, never starts Electron/the CLI and never uses the
// network: it only reads text files.
//
// Why it exists: the shell pins the core in package.json (26 exact roots) AND hard-codes
// the same version in several scripts (release gate, runtime patch installer, packaged
// self-test contract, audit patch helpers). Raising the core version therefore requires
// updating every one of those sites AND re-deriving every per-version artifact hash table.
// A half-updated tree (pins moved, gates not) currently has no cheap detector.
//
// Upgrade checklist mode:
//   CORE_COMPAT_TARGET_VERSION=0.1.2-alpha.6 node --test tests/deep-audit-core-compat.test.cjs
// prints exactly which sites must change for that target and fails until they do.
// Without the variable the suite asserts the tree is internally consistent today.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')

const PKG = 'package.json'
const VERIFY = 'scripts/verify-static.mjs'
const INSTALLER = 'scripts/patch-official-runtime.mjs'
const QPATCH = 'scripts/deep-audit-question-card-patch.mjs'
const SPATCH = 'scripts/deep-audit-session-core-patch.mjs'
const SELFTEST = 'scripts/packaged-selftest-contract.mjs'

function uniqueVersionSuffix(version) {
  const match = /^0\.1\.2-alpha\.(\d+)$/u.exec(version)
  if (match) return 'ALPHA' + match[1]
  const rc = /^0\.1\.(\d+)-rc\.(\d+)$/u.exec(version)
  if (rc) return 'RC' + rc[2]
  throw new Error('Unrecognised official core version shape: ' + version)
}

// 'ALPHA5' -> 'Alpha5': the release gate names its contract functions in mixed case.
function contractName(suffix) {
  return suffix.charAt(0) + suffix.slice(1).toLowerCase()
}

function collectDshRoots(pkg) {
  const out = new Map()
  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) out.set(name, { section, version })
    }
  }
  return out
}

function constantsFor(source, pattern) {
  return [...source.matchAll(pattern)].map(m => ({ name: m[1], version: m[2] }))
}

function quotedList(body) {
  return [...body.matchAll(/'([^']+)'/gu)].map(m => m[1])
}

function frozenRootList(source, suffix) {
  const re = new RegExp(`const OFFICIAL_${suffix}_DEPENDENCY_ROOTS = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`, 'u')
  const optionalRe = new RegExp(`const OFFICIAL_${suffix}_OPTIONAL_ROOTS = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`, 'u')
  const dep = re.exec(source)
  const opt = optionalRe.exec(source)
  assert.ok(dep, `verify-static is missing OFFICIAL_${suffix}_DEPENDENCY_ROOTS`)
  assert.ok(opt, `verify-static is missing OFFICIAL_${suffix}_OPTIONAL_ROOTS`)
  return { dependency: quotedList(dep[1]), optional: quotedList(opt[1]) }
}

function inventory() {
  const pkg = JSON.parse(read(PKG))
  const roots = collectDshRoots(pkg)
  const versions = new Set([...roots.values()].map(entry => entry.version))
  const verify = read(VERIFY)
  const installer = read(INSTALLER)
  return {
    pkg,
    roots,
    versions,
    verify,
    installer,
    installerConstants: constantsFor(installer, /const OFFICIAL_([A-Z0-9]+)_VERSION = '([^']+)'/gu),
    installerHashTables: [...installer.matchAll(/const OFFICIAL_([A-Z0-9]+)_([A-Z0-9_]+) = Object\.freeze\(/gu)]
      .map(m => ({ versionSuffix: m[1], table: m[2] })),
    verifyConstants: constantsFor(verify, /const OFFICIAL_([A-Z0-9]+)_VERSION = '([^']+)'/gu),
    questionVersion: /QUESTION_VERSION = '([^']+)'/u.exec(read(QPATCH))?.[1],
    sessionCoreVersion: /SESSION_CORE_VERSION = '([^']+)'/u.exec(read(SPATCH))?.[1],
    selftestVersion: /OFFICIAL_ALPHA4_VERSION = '([^']+)'/u.exec(read(SELFTEST))?.[1]
  }
}

function changeList(target, inv) {
  const changes = []
  if (inv.versions.size !== 1) {
    changes.push(`package.json currently pins ${inv.versions.size} different core versions (${[...inv.versions].join(', ')}); collapse to exactly one before bumping.`)
  }
  for (const [name, entry] of inv.roots) {
    if (entry.version !== target) changes.push(`${PKG} ${entry.section}["${name}"] must become ${target} (currently ${entry.version}).`)
  }
  const suffix = uniqueVersionSuffix(target)
  const hasGate = inv.verifyConstants.some(entry => entry.name === suffix && entry.version === target)
  if (!hasGate) {
    changes.push(`${VERIFY}: add const OFFICIAL_${suffix}_VERSION = '${target}' plus OFFICIAL_${suffix}_DEPENDENCY_ROOTS/OFFICIAL_${suffix}_OPTIONAL_ROOTS and an assertOfficial${contractName(suffix)}ReleaseContract() that is called unconditionally.`)
  }
  if (!new RegExp(`assertOfficial${contractName(suffix)}ReleaseContract\\(pkg\\)`, 'u').test(inv.verify)) {
    changes.push(`${VERIFY}: the new contract function must be invoked on every run, not only for historical versions.`)
  }
  if (!inv.installerConstants.some(entry => entry.name === suffix && entry.version === target)) {
    changes.push(`${INSTALLER}: add const OFFICIAL_${suffix}_VERSION = '${target}'.`)
  }
  if (!inv.installerHashTables.some(entry => entry.versionSuffix === suffix)) {
    changes.push(`${INSTALLER}: every per-version artifact hash/anchor table must be re-derived for ${target} (no OFFICIAL_${suffix}_* table exists yet); the artifact hashes of ${target} cannot be copied from another version.`)
  }
  for (const [file, current] of [[QPATCH, inv.questionVersion], [SPATCH, inv.sessionCoreVersion]]) {
    if (current !== target) changes.push(`${file}: its immutable core-version constant must become ${target} (currently ${current}), after re-deriving its frozen source hashes for the new core.`)
  }
  return changes
}

const inv = inventory()
const currentVersion = inv.versions.size === 1 ? [...inv.versions][0] : null
const target = process.env.CORE_COMPAT_TARGET_VERSION

test('every @deepseek-ai/dsh* core root is pinned to exactly one identical exact version', () => {
  assert.equal(inv.versions.size, 1, `core roots disagree: ${[...inv.versions].join(', ')}`)
  assert.equal(inv.roots.size, 26, `expected 26 official core roots, found ${inv.roots.size}`)
  for (const [name, entry] of inv.roots) {
    assert.match(entry.version, /^0\.1\.2-alpha\.\d+$|^0\.1\.\d+-rc\.\d+$/u, `${name} must use an exact official version, not a range: ${entry.version}`)
  }
})

test('the vendored core actually installed in node_modules matches the declared pin', () => {
  const vendored = JSON.parse(read('node_modules/@deepseek-ai/dsh/package.json'))
  assert.equal(vendored.version, currentVersion, 'node_modules core version must equal the package.json pin; a mismatch means the tree was partially reinstalled')
})

test('the release gate carries a contract for the pinned core version, and it is always enforced', () => {
  const suffix = uniqueVersionSuffix(currentVersion)
  const named = inv.verifyConstants.filter(entry => entry.name === suffix)
  assert.equal(named.length, 1, `expected exactly one OFFICIAL_${suffix}_VERSION constant`)
  assert.equal(named[0].version, currentVersion)
  assert.ok(
    new RegExp(`assertOfficial${contractName(suffix)}ReleaseContract\\(pkg\\)`, 'u').test(inv.verify),
    `the ${currentVersion} contract must be applied unconditionally`
  )
})

test('release-gate root allowlists match package.json exactly, so a core package-set change cannot slip through', () => {
  const suffix = uniqueVersionSuffix(currentVersion)
  const lists = frozenRootList(inv.verify, suffix)
  assert.equal(lists.dependency.length, 20, 'dependency allowlist must hold exactly 20 roots')
  assert.equal(lists.optional.length, 6, 'optional allowlist must hold exactly 6 roots')
  const declared = new Set(inv.roots.keys())
  const allowed = new Set([...lists.dependency, ...lists.optional])
  assert.equal(allowed.size, 26, 'allowlist must contain 26 unique roots')
  assert.deepEqual([...declared].sort(), [...allowed].sort(), 'package.json core roots and the release-gate allowlist must be the same set; a new or removed core package requires updating both')
})

test('historical core contracts are retained as audit-only branches, never applied to the current version', () => {
  const historical = inv.verifyConstants.filter(entry => entry.version !== currentVersion)
  assert.ok(historical.length > 0, 'the historical release contracts must be retained for audit')
  for (const entry of historical) {
    assert.ok(
      inv.verify.includes(`if (pkg.version === OFFICIAL_${entry.name}_VERSION) assertOfficial${contractName(entry.name)}ReleaseContract(pkg)`),
      `historical contract ${entry.name} must stay behind an explicit version guard`
    )
  }
  assert.equal(inv.selftestVersion, '0.1.2-alpha.4', 'the packaged self-test contract still documents the historical alpha.4 baseline')
})

test('removed core roots stay rejected by the release gate', () => {
  for (const removed of ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-host-apiproxy', '@deepseek-ai/dsh-session-persistence-sqlite']) {
    assert.ok(inv.verify.includes(`'${removed}'`), `removed root ${removed} must remain listed as rejected`)
    assert.ok(!inv.roots.has(removed), `removed root ${removed} must not re-enter package.json`)
  }
})

test('the installer keeps a version constant and re-derived artifact tables for the pinned core', () => {
  const suffix = uniqueVersionSuffix(currentVersion)
  assert.ok(inv.installerConstants.some(entry => entry.name === suffix && entry.version === currentVersion), `installer is missing OFFICIAL_${suffix}_VERSION = '${currentVersion}'`)
  assert.ok(inv.installerHashTables.some(entry => entry.versionSuffix === suffix), `installer has no OFFICIAL_${suffix}_* artifact hash/anchor table; core-dependent hashes must be re-derived per version, never reused`)
  for (const historical of ['ALPHA2', 'ALPHA3', 'ALPHA4']) {
    assert.ok(inv.installerConstants.some(entry => entry.name === historical), `historical installer constant ${historical} must be retained`)
  }
})

test('audit patch helpers name the same core version as the pin', () => {
  assert.equal(inv.questionVersion, currentVersion, 'question-card patch core version must equal the pin')
  assert.equal(inv.sessionCoreVersion, currentVersion, 'session-core patch core version must equal the pin')
})

test('upgrade checklist: either the tree is already at the requested target, or the exact remaining edits are listed', () => {
  if (!target) {
    assert.equal(currentVersion, '0.1.2-alpha.5', 'baseline drift: this suite currently documents 0.1.2-alpha.5 as the supported core; a bump must come with new per-version evidence, not by editing this assertion')
    return
  }
  if (target === currentVersion) return
  const changes = changeList(target, inv)
  assert.fail(
    `Core ${target} is NOT yet a compatible target. ${changes.length} site(s) must change, and none of them may be satisfied by editing this test:\n - ` + changes.join('\n - ')
  )
})
