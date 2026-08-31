'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const EXPLICIT_AUDIT_ROOT = process.env.DSH_ALPHA2_AUDIT_ROOT || process.env.DSH_ALPHA2_CANDIDATE_ROOT || null
const AUDIT_ROOT = EXPLICIT_AUDIT_ROOT || ROOT
const RC2 = '0.1.1-rc.2'
const ALPHA2 = '0.1.2-alpha.2'

const ACCEPTED = Object.freeze({
  'docs/OFFICIAL-ALPHA2-RUNTIME-MIGRATION-PLAN.zh-CN.md': '6A173AC8A7CC0E0190A28A58AD72358650DC77A912EC276FDFD5AE4F59AA6892',
  'tests/official-alpha2-runtime-contract.test.cjs': 'C344D02855E7E5CC5888B51EB8A9C52A8AF3DCCFC576D80C4259A22308E49E45',
  'docs/OFFICIAL-ALPHA2-UI-PATCH-REBASE.zh-CN.md': '289093B896AB8FA3CA869B70FF634B9B400391DC605078CD15DB008CF646A16C',
  'tests/official-alpha2-ui-seam-contract.test.cjs': 'C3BB384EBC78AB01D7413D692717E23EC83706BEF2DAC6EEDF4E79A493BE7515',
  'docs/OFFICIAL-ALPHA2-REMOTE-SESSION-SEAM.zh-CN.md': '6BE8D38F4510733357BD7E7C008B573CD5D887815923371E330BAB76D7A3E8A0',
  'tests/official-alpha2-remote-session-seam.test.cjs': '8F7F19F26BC148B25FEFA7AD1D99C933D7B1FB3BA420A0B6B0B4C13381D3AD8A'
})
const CLOSURE_RECORDS_SHA256 = '0ed92cc8ae3fafec77ca54559a7719adf09c5c657200dc2791dc1d06cb2b0b3a'
const PACKAGE_MANIFEST_SHA256 = 'dd62b0f8e9f5d068cb6a6246d9dbb7f920b8e159a2d14b9d3a5e3435a69f48bd'
const NOTICE_SHA256 = '1E85F0FFC37B90B06515B57F6C900F1541123B2A53735CEE8D87349C5B39503E'
const ISOLATED_LOCK_SHA256 = 'e61a561bacaeb2c6caa52df8132fd53962cff407913a1a3c1c850d88af928821'
const INSTALL_SUMMARY_SHA256 = '76CCE10F2AEB698528F61DDB54FCD94BC274409A89554C45CDC2643EEFE2AE15'
const INSTALL_FIRST_SHA256 = '5A1D0E7972931093F34B1A7FEC8511424B0584B970AB87BC923FCB43E28E12BE'
const INSTALL_SECOND_SHA256 = '7832FE8003253C747B06F52709DA9764747E858EA9EE3B677AC9DE1719398380'
const INSTALL_MANIFEST_SHA256 = 'AD7DDCF969F02B7121BA83229FB374F6FECFAF9EAD7E8AA5A5B508C18D3A0E96'
const CURRENT_RELEASE_SECURITY_REVIEW_SHA256 = 'C04D5F5A6B358548000860182DA7F2678E06FF048A9EAB5117F89E7464D63153'
const UI_BLOCKED_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-tool',
  '@deepseek-ai/dsh-token-meter',
  '@deepseek-ai/dsh-client-ui-model-selection',
  '@deepseek-ai/dsh-client-ui-settings-models',
  '@deepseek-ai/dsh-client-ui-workspace'
])

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function json(relative) {
  return JSON.parse(read(relative))
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase()
}

function parseCanonicalInstallManifest(source) {
  assert.equal(sha256(source), INSTALL_MANIFEST_SHA256, 'canonical manifest bytes must remain hash-bound')
  assert.equal(source.includes('\r'), false, 'canonical manifest must use LF only')
  assert.equal(source.endsWith('\n'), true, 'canonical manifest must end with one complete row')
  const lines = source.slice(0, -1).split('\n')
  assert.equal(lines.length, 42879)
  const paths = new Set()
  const rows = lines.map((line, index) => {
    const separator = line.lastIndexOf('|')
    assert.ok(separator > 0, `malformed canonical manifest row ${index}`)
    const relativePath = line.slice(0, separator)
    const fileSha256 = line.slice(separator + 1)
    assert.match(fileSha256, /^[0-9A-F]{64}$/u, `bad file hash in canonical manifest row ${index}`)
    assert.equal(relativePath.includes('\\'), false, `backslash in canonical manifest row ${index}`)
    assert.equal(relativePath.includes('|'), false, `separator in canonical manifest path ${index}`)
    assert.equal(relativePath.includes('\0'), false, `NUL in canonical manifest path ${index}`)
    assert.equal(path.posix.isAbsolute(relativePath), false, `absolute canonical manifest path ${index}`)
    assert.equal(path.posix.normalize(relativePath), relativePath, `non-canonical manifest path ${index}`)
    assert.equal(Buffer.from(relativePath, 'utf8').toString('utf8'), relativePath, `invalid UTF-8 manifest path ${index}`)
    assert.equal(paths.has(relativePath), false, `duplicate canonical manifest path ${relativePath}`)
    paths.add(relativePath)
    if (index > 0) {
      assert.ok(Buffer.compare(Buffer.from(lines[index - 1].slice(0, lines[index - 1].lastIndexOf('|')), 'utf8'), Buffer.from(relativePath, 'utf8')) < 0, `unsigned UTF-8 manifest order inversion at row ${index}`)
    }
    return { relativePath, fileSha256 }
  })
  assert.equal(paths.size, 42879)
  return rows
}

function collectInstallManifestRows(root) {
  const rows = []
  function walk(directory, relativeDirectory = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const absolutePath = path.join(directory, entry.name)
      const stat = fs.lstatSync(absolutePath)
      assert.equal(stat.isSymbolicLink(), false, `install manifest encountered symlink: ${relativePath}`)
      if (stat.isDirectory()) walk(absolutePath, relativePath)
      else {
        assert.equal(stat.isFile(), true, `install manifest encountered unsupported entry: ${relativePath}`)
        rows.push({ relativePath, fileSha256: sha256(fs.readFileSync(absolutePath)) })
      }
    }
  }
  walk(root)
  rows.sort((left, right) => Buffer.compare(Buffer.from(left.relativePath, 'utf8'), Buffer.from(right.relativePath, 'utf8')))
  return rows
}

function assertInstallMatchesManifest(root, expectedRows) {
  const actualRows = collectInstallManifestRows(root)
  assert.equal(actualRows.length, expectedRows.length, `install path count drift: ${root}`)
  for (let index = 0; index < expectedRows.length; index += 1) {
    assert.equal(actualRows[index].relativePath, expectedRows[index].relativePath, `install path drift at row ${index}: ${root}`)
    assert.equal(actualRows[index].fileSha256, expectedRows[index].fileSha256, `install file hash drift at row ${index}: ${root}`)
  }
}

function isDsh(name) {
  return name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
}

function installedPackageName(key) {
  const marker = 'node_modules/'
  const tail = key.slice(key.lastIndexOf(marker) + marker.length)
  return tail.startsWith('@') ? tail.split('/').slice(0, 2).join('/') : tail.split('/')[0]
}

function dependencyParents(lock, target) {
  const parents = []
  for (const [key, entry] of Object.entries(lock.packages)) {
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const range = entry?.[section]?.[target]
      if (range !== undefined) parents.push({ key, section, range })
    }
  }
  return parents.sort((left, right) => `${left.key}|${left.section}`.localeCompare(`${right.key}|${right.section}`))
}

function assertAcceptedAlpha2Graph(pkg, lock, uiReport, remoteReport) {
  const direct = Object.entries(pkg.dependencies).filter(([name]) => isDsh(name))
  assert.equal(direct.length, 20, 'the accepted alpha.2 root set must remain atomic')
  for (const [name, version] of direct) assert.equal(version, ALPHA2, `accepted direct pin drift: ${name}`)

  const lockRoot = lock.packages[''].dependencies
  for (const [name] of direct) assert.equal(lockRoot[name], ALPHA2, `accepted lock root drift: ${name}`)
  for (const removed of ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-host-apiproxy']) {
    assert.equal(lock.packages[`node_modules/${removed}`], undefined, `removed alpha.2 package returned: ${removed}`)
  }
  const lockedDsh = Object.entries(lock.packages).filter(([key]) => isDsh(installedPackageName(key)))
  assert.equal(lockedDsh.length, 216, 'the maintained selected alpha.2 lock locations must remain exact')
  assert.equal(new Set(lockedDsh.map(([key]) => installedPackageName(key))).size, 215, 'the maintained alpha.2 package-name closure must remain exact')
  for (const [key, entry] of lockedDsh) {
    assert.equal(entry.version, ALPHA2, `accepted selected lock version drift: ${key}`)
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//u, `accepted selected lock resolved drift: ${key}`)
    assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, `accepted selected lock integrity drift: ${key}`)
  }

  assert.equal((uiReport.match(/\*\*rebase=verified\*\*/gu) || []).length, 3, 'three alpha.2 UI seams must remain fail-closed rebases')
  assert.equal((uiReport.match(/\*\*retired=verified\*\*/gu) || []).length, 2, 'two alpha.2 UI seams must remain complete artifact-proven retirements')
  assert.equal((uiReport.match(/\*\*split verified\*\*/gu) || []).length, 1, 'workspace must retain native menu retirement plus force-new rebase')
  assert.match(uiReport, /session-menu 部分 `retired=verified`；force-new `rebase=verified`/u)
  assert.match(remoteReport, /canonical project[^\n]*Workspace\/Session[^\n]*归属证明/)
  assert.match(remoteReport, /语义伪造的 event\/baseline/)
}

test('accepted audit outputs and deterministic 20-root/215-package evidence are hash-bound', () => {
  for (const [relative, expected] of Object.entries(ACCEPTED)) assert.equal(sha256(read(relative)), expected, `accepted audit drift: ${relative}`)
  const report = read('docs/OFFICIAL-ALPHA2-RUNTIME-MIGRATION-PLAN.zh-CN.md')
  for (const fact of [
    '20 个根精确 pin',
    '215 个精确包',
    '1,115 条父依赖边',
    '1,135 条记录',
    CLOSURE_RECORDS_SHA256,
    PACKAGE_MANIFEST_SHA256,
    'runtimeEquivalent=false'
  ]) assert.ok(report.includes(fact), `missing accepted closure fact: ${fact}`)
  const securityReview = read('docs/SECURITY-REVIEW-v1.0.55.zh-CN.md')
  assert.equal(sha256(securityReview), CURRENT_RELEASE_SECURITY_REVIEW_SHA256, 'current version security review must remain hash-bound')
  assert.match(securityReview, /v1\.0\.55 发布声明与静态门禁已绑定当前源码版本/u)
  assert.match(securityReview, /不是动态发布门禁的通过声明/u)
})

test('maintained package and lock are the accepted complete canonical alpha.2 runtime', () => {
  const packageSource = read('package.json')
  const lockSource = read('package-lock.json')
  const pkg = JSON.parse(packageSource)
  const lock = JSON.parse(lockSource)
  assert.equal(sha256(packageSource), '204414F269F57382BE80D05D4E05E11A4C38B00D4DBD9DA16229DC7E671F5799')
  assert.equal(sha256(lockSource), '3DCD39D8A07C2EA394722B7059B01C89531DB97486E67818E349C991CB552875')
  assert.equal(Object.keys(lock.packages).length, 861)
  assertAcceptedAlpha2Graph(pkg, lock, read('docs/OFFICIAL-ALPHA2-UI-PATCH-REBASE.zh-CN.md'), read('docs/OFFICIAL-ALPHA2-REMOTE-SESSION-SEAM.zh-CN.md'))
  assert.equal(pkg.dependencies['@deepseek-ai/cordis-plugin-group'], '1.0.1')
  assert.equal(pkg.devDependencies.electron, '43.2.0')
  assert.equal(lock.packages['node_modules/@deepseek-ai/cordis-plugin-group'].version, '1.0.1')
  assert.equal(lock.packages['node_modules/electron'].version, '43.2.0')
})

test('detached exact-lock alpha.2 graph and two isolated installs are byte-identical', { skip: EXPLICIT_AUDIT_ROOT === null ? 'requires explicit detached audit root' : false }, async () => {
  const candidatePackage = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'package.json'), 'utf8'))
  const candidateLockSource = fs.readFileSync(path.join(AUDIT_ROOT, 'package-lock.json'), 'utf8')
  const candidateLock = JSON.parse(candidateLockSource)
  const installedCore = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  const { classifyOfficialRuntimeGraph } = await import('../scripts/patch-official-runtime.mjs')
  assert.deepEqual(classifyOfficialRuntimeGraph(candidatePackage, candidateLock, installedCore), {
    mode: 'alpha2', version: ALPHA2, directRootCount: 20, selectedPackageCount: 216
  })
  assert.equal(sha256(candidateLockSource), ISOLATED_LOCK_SHA256.toUpperCase())

  const manifestSource = fs.readFileSync(path.resolve(AUDIT_ROOT, '..', 'canonical-install-manifest.txt'), 'utf8')
  assert.equal(Buffer.byteLength(manifestSource, 'utf8'), 5271544)
  const manifestRows = parseCanonicalInstallManifest(manifestSource)
  const candidateContainer = path.resolve(AUDIT_ROOT, '..')
  assertInstallMatchesManifest(path.join(candidateContainer, 'install-first', 'node_modules'), manifestRows)
  assertInstallMatchesManifest(path.join(candidateContainer, 'install-second', 'node_modules'), manifestRows)

  const summaryBytes = fs.readFileSync(path.join(AUDIT_ROOT, 'candidate-summary.json'))
  const firstBytes = fs.readFileSync(path.join(AUDIT_ROOT, 'canonical-install-first-hardened.json'))
  const secondBytes = fs.readFileSync(path.join(AUDIT_ROOT, 'canonical-install-second-hardened.json'))
  assert.equal(sha256(summaryBytes), INSTALL_SUMMARY_SHA256)
  assert.equal(sha256(firstBytes), INSTALL_FIRST_SHA256)
  assert.equal(sha256(secondBytes), INSTALL_SECOND_SHA256)
  const summary = JSON.parse(summaryBytes)
  const first = JSON.parse(firstBytes)
  const second = JSON.parse(secondBytes)
  assert.deepEqual({ lockEqual: summary.lockEqual, npmLsFirstExit: summary.npmLsFirstExit, npmLsSecondExit: summary.npmLsSecondExit, nodeModulesEqual: summary.nodeModulesEqual }, {
    lockEqual: true, npmLsFirstExit: 0, npmLsSecondExit: 0, nodeModulesEqual: true
  })
  assert.equal(summary.lockSha256First, ISOLATED_LOCK_SHA256.toUpperCase())
  assert.equal(summary.lockSha256Second, ISOLATED_LOCK_SHA256.toUpperCase())
  assert.equal(summary.fileCountFirst, 42879)
  assert.equal(summary.fileCountSecond, 42879)
  assert.deepEqual(summary.canonicalManifest, {
    algorithm: 'whole-path unsigned UTF-8 Buffer.compare ordering; path|uppercase-file-sha256 rows',
    sha256: INSTALL_MANIFEST_SHA256,
    rowCount: 42879,
    uniquePathCount: 42879,
    badPathCount: 0,
    firstInstallExact: true,
    secondInstallExact: true
  })
  for (const receipt of [first, second]) {
    assert.equal(receipt.algorithm, 'sha256(utf8(relative-path-with-forward-slashes)\\0decimal-byte-count\\0lowercase-file-sha256\\n), rows sorted by unsigned UTF-8 bytes')
    assert.equal(receipt.fileCount, 42879)
    assert.equal(receipt.totalBytes, '369552648')
    assert.equal(receipt.treeSha256, '17D85E217EC8FA2B73B5879C618BA4760A8233E6893252E3F88AF3A6C51A44E0')
    assert.equal(receipt.frozenManifestComparison.manifestFileSha256, INSTALL_MANIFEST_SHA256)
    assert.equal(receipt.frozenManifestComparison.rowCount, 42879)
    assert.equal(receipt.frozenManifestComparison.exactPathAndFileSha256Match, true)
    assert.equal(receipt.frozenManifestComparison.mismatchCount, 0)
  }
  assert.equal(first.treeSha256, second.treeSha256)
  assert.equal(first.frozenManifestComparison.manifestFileSha256, second.frozenManifestComparison.manifestFileSha256)
})

test('malicious or accidental maintained alpha.2 graph drift fails closed', () => {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  const ui = read('docs/OFFICIAL-ALPHA2-UI-PATCH-REBASE.zh-CN.md')
  const remote = read('docs/OFFICIAL-ALPHA2-REMOTE-SESSION-SEAM.zh-CN.md')

  const packageDrift = structuredClone(pkg)
  packageDrift.dependencies['@deepseek-ai/dsh'] = RC2
  assert.throws(() => assertAcceptedAlpha2Graph(packageDrift, lock, ui, remote), /accepted direct pin drift/)

  const lockDrift = structuredClone(lock)
  lockDrift.packages[''].dependencies['@deepseek-ai/dsh'] = RC2
  assert.throws(() => assertAcceptedAlpha2Graph(pkg, lockDrift, ui, remote), /accepted lock root drift/)

  const selectedDrift = structuredClone(lock)
  selectedDrift.packages['node_modules/@deepseek-ai/dsh'].version = RC2
  assert.throws(() => assertAcceptedAlpha2Graph(pkg, selectedDrift, ui, remote), /accepted selected lock version drift/)

  const resolvedDrift = structuredClone(lock)
  resolvedDrift.packages['node_modules/@deepseek-ai/dsh'].resolved = 'https://example.invalid/dsh.tgz'
  assert.throws(() => assertAcceptedAlpha2Graph(pkg, resolvedDrift, ui, remote), /accepted selected lock resolved drift/)

  const integrityDrift = structuredClone(lock)
  delete integrityDrift.packages['node_modules/@deepseek-ai/dsh'].integrity
  assert.throws(() => assertAcceptedAlpha2Graph(pkg, integrityDrift, ui, remote), /accepted selected lock integrity drift/)

  const removedPackageDrift = structuredClone(lock)
  removedPackageDrift.packages['node_modules/@deepseek-ai/dsh-client-runtime'] = { version: ALPHA2 }
  assert.throws(() => assertAcceptedAlpha2Graph(pkg, removedPackageDrift, ui, remote), /removed alpha\.2 package returned/)

  assert.throws(() => assertAcceptedAlpha2Graph(pkg, lock, ui.replace('**rebase=verified**', '**rebase=drifted**'), remote), /three alpha\.2 UI seams/)
  assert.throws(() => assertAcceptedAlpha2Graph(pkg, lock, ui, remote.replace('canonical project', 'canonical-project')), /canonical project/)
})

test('accepted alpha.2 patch dispatch uses native replacements while retaining fail-closed legacy helpers', () => {
  const pkg = json('package.json')
  const lock = json('package-lock.json')
  const source = read('scripts/patch-official-runtime.mjs')
  const notice = read('THIRD_PARTY_NOTICES.md')
  assert.equal(pkg.scripts.postinstall, 'node scripts/patch-official-runtime.mjs && electron-builder install-app-deps')
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-client-runtime'], undefined)
  assert.equal(lock.packages['node_modules/@deepseek-ai/dsh-host-apiproxy'], undefined)
  for (const fragment of [
    "const targetsAlpha2 = officialGraph.mode === 'alpha2'",
    'targetsAlpha2 ? await patchInstalledAlpha2SessionController() : await patchInstalledRuntime()',
    'targetsAlpha2 ? await assertInstalledAlpha2NativeSessionList() : await patchInstalledHostApiProxy()'
  ]) assert.ok(source.includes(fragment), `accepted alpha.2 dispatch drift: ${fragment}`)
  assert.equal(sha256(notice), NOTICE_SHA256)
  assert.match(notice, /0\.1\.2-alpha\.2/u)
  assert.match(notice, /dsh-v0\.1\.2-alpha\.2/u)
  assert.match(notice, /0a53fb55bea101816fa226bb964ae2bed71c343b/u)
  assert.match(notice, /MIT License/u)
})

test('two npm-ls extraneous optionals are a reproducible integrity-locked platform orphan, not a DSH or peer drift', () => {
  const lockPath = path.join(AUDIT_ROOT, 'package-lock.json')
  const lockSource = fs.readFileSync(lockPath, 'utf8')
  const lock = JSON.parse(lockSource)
  assert.equal(crypto.createHash('sha256').update(lockSource).digest('hex'), '3dcd39d8a07c2ea394722b7059b01c89531db97486e67818e349c991cb552875')

  const wasm = lock.packages['node_modules/@img/sharp-wasm32']
  const emnapi = lock.packages['node_modules/@emnapi/runtime']
  const freebsd = lock.packages['node_modules/@img/sharp-freebsd-wasm32']
  const webcontainers = lock.packages['node_modules/@img/sharp-webcontainers-wasm32']
  assert.deepEqual({ version: wasm.version, optional: wasm.optional, integrity: wasm.integrity }, {
    version: '0.35.4', optional: true, integrity: 'sha512-zQnl4Kwp7Q6NHsENtU2T/00Zi+w3AQNwz3+UaTyVBy2FpXrzXzGjndpK61onhZjRtRpQXxCTeqw19bVyXOh7jA=='
  })
  assert.deepEqual({ version: emnapi.version, optional: emnapi.optional, integrity: emnapi.integrity }, {
    version: '1.11.3', optional: true, integrity: 'sha512-Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA=='
  })
  assert.equal(wasm.dependencies['@emnapi/runtime'], '^1.11.3')
  assert.equal(freebsd.os[0], 'freebsd')
  assert.equal(freebsd.dependencies['@img/sharp-wasm32'], '0.35.4')
  assert.equal(webcontainers.cpu[0], 'wasm32')
  assert.equal(webcontainers.dependencies['@img/sharp-wasm32'], '0.35.4')
  assert.deepEqual(dependencyParents(lock, '@img/sharp-wasm32'), [
    { key: 'node_modules/@img/sharp-freebsd-wasm32', section: 'dependencies', range: '0.35.4' },
    { key: 'node_modules/@img/sharp-webcontainers-wasm32', section: 'dependencies', range: '0.35.4' }
  ])
  assert.deepEqual(dependencyParents(lock, '@emnapi/runtime'), [
    { key: 'node_modules/@img/sharp-wasm32', section: 'dependencies', range: '^1.11.3' }
  ])
  assert.equal(lock.packages['node_modules/@img/sharp-win32-x64'].os[0], 'win32')
  assert.equal(lock.packages['node_modules/@img/sharp-win32-x64'].cpu[0], 'x64')

  if (EXPLICIT_AUDIT_ROOT !== null) {
    const reproduction = JSON.parse(fs.readFileSync(path.join(AUDIT_ROOT, 'npm-ls-second.json'), 'utf8'))
    assert.equal(reproduction.problems.length, 2)
    assert.match(reproduction.problems[0], /extraneous: @emnapi\/runtime@1\.11\.3/)
    assert.match(reproduction.problems[1], /extraneous: @img\/sharp-wasm32@0\.35\.4/)
    assert.equal(reproduction.problems.some(problem => /@deepseek-ai\/dsh/.test(problem)), false)
  }
})

module.exports = { ACCEPTED, assertAcceptedAlpha2Graph }
