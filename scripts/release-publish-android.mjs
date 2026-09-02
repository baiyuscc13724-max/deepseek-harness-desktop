import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { hostname } from 'node:os'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { readAndroidMobileVersion } = require('./mobile-release-version.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const bundledGit = path.join(root, 'third_party', 'mingit', 'cmd', 'git.exe')
const git = String(process.env.HARNESS_RELEASE_GIT || (existsSync(bundledGit) ? bundledGit : 'git')).trim()
const npmCli = String(process.env.npm_execpath || '').trim()
const stateDir = path.join(root, '.release-state')
const PHASES = Object.freeze([
  'local-mobile-gates',
  'immutable-mobile-tag',
  'github-signed-android',
  'cnb-mobile-assets',
  'complete'
])
const PROTECTED_METADATA_PATHS = Object.freeze([
  'release-manifest.json',
  'component-feeds/stable/win32-x64.json',
  'component-feeds/stable/darwin-x64.json',
  'component-feeds/stable/darwin-arm64.json'
])
const POST_TAG_CONTROLLER_PATHS = Object.freeze([
  '.github/workflows/android-mobile-release.yml',
  'package-lock.json',
  'scripts/release-publish-android.mjs',
  'scripts/release-audit.mjs',
  'tests/release-publisher.test.cjs'
])
const POST_TAG_LOCK_REPAIRS = Object.freeze({
  'node_modules/fast-uri': Object.freeze({
    from: '3.1.5',
    to: '3.1.6',
    resolved: 'https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.6.tgz',
    integrity: 'sha512-7Ical1vFEMr0onbVzEDIreM22I4khW+fzyQPwvAFWBp1iwdshSZRsL4jjRvPG9JP1uiqMHRto+YU6R2/CzDz5Q=='
  }),
  'node_modules/qs': Object.freeze({
    from: '6.15.3',
    to: '6.16.0',
    resolved: 'https://registry.npmjs.org/qs/-/qs-6.16.0.tgz',
    integrity: 'sha512-h6fhOIaRrID2CbEY2fqs+7t+UXZo+MLAnU5gRIq85uFtdiUPCdsApMlHhXogKVM4HM2DVbIjGNTTYH2OcmP1vA=='
  })
})
const STANDALONE_RELEASE_BODY = version => `Standalone signed Android mobile release ${version}. Desktop packages, components, stable feeds, and prior immutable assets are unchanged.`

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function gitEnvironment() {
  const env = { ...process.env }
  if (!path.isAbsolute(git)) return env
  const commandDirectory = path.dirname(git)
  const gitRoot = ['cmd', 'bin'].includes(path.basename(commandDirectory).toLowerCase()) ? path.dirname(commandDirectory) : commandDirectory
  const additions = [commandDirectory, path.join(gitRoot, 'bin'), path.join(gitRoot, 'mingw64', 'bin'), path.join(gitRoot, 'usr', 'bin')]
  if (process.platform === 'win32') additions.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'))
  const inheritedPathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  const inheritedPath = inheritedPathKey ? String(env[inheritedPathKey] || '') : ''
  if (inheritedPathKey && inheritedPathKey !== 'PATH') delete env[inheritedPathKey]
  env.PATH = `${additions.join(path.delimiter)}${path.delimiter}${inheritedPath}`
  return env
}

function captureResult(program, args, { timeout = 10 * 60 * 1000, env = process.env } = {}) {
  mkdirSync(stateDir, { recursive: true })
  const identity = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const stdoutFile = path.join(stateDir, `.android-publish-stdout-${identity}.log`)
  const stderrFile = path.join(stateDir, `.android-publish-stderr-${identity}.log`)
  const stdoutHandle = openSync(stdoutFile, 'w')
  const stderrHandle = openSync(stderrFile, 'w')
  let result
  try {
    result = spawnSync(program, args, { cwd: root, env, stdio: ['ignore', stdoutHandle, stderrHandle], shell: false, timeout })
  } finally {
    closeSync(stdoutHandle)
    closeSync(stderrHandle)
  }
  const stdout = readFileSync(stdoutFile, 'utf8')
  const stderr = readFileSync(stderrFile, 'utf8')
  rmSync(stdoutFile, { force: true })
  rmSync(stderrFile, { force: true })
  return { status: result.status, error: result.error, stdout, stderr }
}

function execute(program, args, options = {}) {
  const result = captureResult(program, args, options)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} ${args.join(' ')} exited with code ${result.status}.\n${String(result.stderr || result.stdout).trim()}`)
  return options.trim === false ? result.stdout : result.stdout.trim()
}

function gitCapture(args) {
  return execute(git, args, { env: gitEnvironment() })
}

function gitCaptureRaw(args) {
  return execute(git, args, { env: gitEnvironment(), trim: false })
}

function gitRun(args) {
  execute(git, args, { env: gitEnvironment() })
}

const GIT_FETCH_RETRY_ATTEMPTS = 6
const TRANSIENT_GIT_FETCH_ERROR = /(?:RPC failed[\s\S]*?(?:curl 28|Connection was reset)|Recv failure:\s*Connection was reset|TLS handshake timeout|Failed to connect to github\.com|Could not resolve host|expected flush after ref listing)/iu
const gitFetchRetryWait = new Int32Array(new SharedArrayBuffer(4))

function gitFetchRemoteMainWithRetry() {
  const args = ['fetch', 'origin', 'main', '--tags']
  for (let attempt = 1; attempt <= GIT_FETCH_RETRY_ATTEMPTS; attempt += 1) {
    const result = captureResult(git, args, { env: gitEnvironment() })
    if (!result.error && result.status === 0) return
    const detail = String(result.stderr || result.stdout || result.error?.message || '').trim()
    const retryable = !result.error && TRANSIENT_GIT_FETCH_ERROR.test(detail)
    if (!retryable || attempt === GIT_FETCH_RETRY_ATTEMPTS) {
      if (result.error) throw result.error
      throw new Error(`${git} ${args.join(' ')} exited with code ${result.status}.\n${detail}`)
    }
    console.warn(`Transient GitHub fetch failure (${attempt}/${GIT_FETCH_RETRY_ATTEMPTS}); retrying read-only fetch.`)
    Atomics.wait(gitFetchRetryWait, 0, 0, attempt * 1_000)
  }
}

function ghCapture(args) {
  return execute(process.platform === 'win32' ? 'gh.exe' : 'gh', args, { timeout: 2 * 60 * 1000 })
}

function ghRun(args) {
  execute(process.platform === 'win32' ? 'gh.exe' : 'gh', args, { timeout: 2 * 60 * 1000 })
}

function npmRun(args, options = {}) {
  const env = { ...gitEnvironment(), HARNESS_RELEASE_GIT: git }
  if (npmCli) return execute(process.execPath, [npmCli, ...args], { ...options, env })
  return execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { ...options, env })
}

function assertClean() {
  const lines = gitCapture(['status', '--porcelain=v1', '--untracked-files=normal']).split(/\r?\n/u).filter(Boolean)
  if (lines.length > 0) throw new Error(`Android publication requires a clean committed tree:\n${lines.join('\n')}`)
}

function assertMobileIdentity(integrationVersion, mobile) {
  if (!/^\d+\.\d+\.\d+$/u.test(integrationVersion) || integrationVersion !== pkg.version) {
    throw new Error(`Integration version must exactly match package.json (${pkg.version}).`)
  }
  if (mobile.integrationVersion !== integrationVersion) throw new Error('Android mobile integrationVersion does not match package.json.')
  if (!/^android-v\d+\.\d+\.\d+(?:\.\d+)?$/u.test(mobile.tag)) throw new Error('Standalone Android tag identity is invalid.')
}

function localTagRevision(tag) {
  const result = captureResult(git, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { env: gitEnvironment() })
  if (result.error) throw result.error
  if (result.status === 1) return ''
  if (result.status !== 0) throw new Error(`Unable to inspect local ${tag}.`)
  return gitCapture(['rev-list', '-n', '1', `refs/tags/${tag}`]).toLowerCase()
}

function remoteTagRevision(tag) {
  const output = gitCapture(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
  if (!output) return ''
  const rows = output.split(/\r?\n/u).filter(Boolean)
  const peeled = rows.find(row => row.endsWith(`refs/tags/${tag}^{}`))
  const direct = rows.find(row => row.endsWith(`refs/tags/${tag}`))
  const selected = peeled || direct
  if (!selected) return ''
  return selected.split(/\s+/u)[0].toLowerCase()
}

function assertExactRemoteMain() {
  gitFetchRemoteMainWithRetry()
  const branch = gitCapture(['branch', '--show-current'])
  const head = gitCapture(['rev-parse', 'HEAD']).toLowerCase()
  const remoteMain = gitCapture(['rev-parse', 'origin/main']).toLowerCase()
  if (branch !== 'main') throw new Error('Standalone Android publication must run from the maintained main branch.')
  if (head !== remoteMain) throw new Error('Standalone Android publication requires HEAD to equal origin/main exactly.')
  return head
}

function assertExactPostTagLockRepair(sourceRevision, currentHead) {
  const baseline = JSON.parse(gitCapture(['show', `${sourceRevision}:package-lock.json`]))
  const current = JSON.parse(gitCapture(['show', `${currentHead}:package-lock.json`]))
  if (!baseline.packages || !current.packages) throw new Error('Post-Tag dependency repair requires package-lock v3 package entries.')
  const baselineRemainder = { ...baseline, packages: { ...baseline.packages } }
  const currentRemainder = { ...current, packages: { ...current.packages } }
  for (const [location, repair] of Object.entries(POST_TAG_LOCK_REPAIRS)) {
    const before = baseline.packages[location]
    const after = current.packages[location]
    if (!before || !after || before.version !== repair.from) throw new Error(`Post-Tag dependency repair baseline is not exact for ${location}.`)
    const expected = { ...before, version: repair.to, resolved: repair.resolved, integrity: repair.integrity }
    if (JSON.stringify(after) !== JSON.stringify(expected)) throw new Error(`Post-Tag dependency repair is not exact for ${location}.`)
    delete baselineRemainder.packages[location]
    delete currentRemainder.packages[location]
  }
  if (JSON.stringify(currentRemainder) !== JSON.stringify(baselineRemainder)) {
    throw new Error('Post-Tag dependency repair changed package-lock content outside the reviewed advisory entries.')
  }
}

function assertPostTagControllerAdvance(state, currentHead, mobile) {
  if (state.phases['immutable-mobile-tag']?.status !== 'completed') throw new Error('Android controller cannot advance before the immutable Tag phase completes.')
  if (localTagRevision(mobile.tag) !== state.sourceRevision || remoteTagRevision(mobile.tag) !== state.sourceRevision) {
    throw new Error('Android controller advance requires the local and remote immutable Tag to remain exact.')
  }
  const ancestor = captureResult(git, ['merge-base', '--is-ancestor', state.sourceRevision, currentHead], { env: gitEnvironment() })
  if (ancestor.error) throw ancestor.error
  if (ancestor.status !== 0) throw new Error('Android controller revision must descend from the immutable source revision.')
  const changed = gitCapture(['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${state.sourceRevision}..${currentHead}`]).split(/\r?\n/u).filter(Boolean)
  const unexpected = changed.filter(file => !POST_TAG_CONTROLLER_PATHS.includes(file))
  if (changed.length === 0 || unexpected.length > 0) {
    throw new Error(`Post-Tag Android recovery may change only controller files: ${unexpected.join(', ') || 'no reviewed controller change'}.`)
  }
  if (changed.includes('package-lock.json')) assertExactPostTagLockRepair(state.sourceRevision, currentHead)
  return changed
}

function readGithubRelease(repo, tag) {
  const program = process.platform === 'win32' ? 'gh.exe' : 'gh'
  const result = captureResult(program, ['api', `repos/${repo}/releases/tags/${tag}`], { timeout: 2 * 60 * 1000 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`
    if (/HTTP 404|release not found|Not Found/iu.test(detail)) return null
    throw new Error(`Unable to read GitHub release ${tag}: ${detail.trim()}`)
  }
  return JSON.parse(result.stdout)
}

function readLatestGithubReleaseTag(repo) {
  const release = JSON.parse(ghCapture(['api', `repos/${repo}/releases/latest`]))
  return String(release.tag_name || '')
}

function assertStandaloneReleaseShell(repo, sourceRevision, mobile, { requireEmpty = false } = {}) {
  const release = readGithubRelease(repo, mobile.tag)
  if (!release) throw new Error(`Standalone GitHub release ${mobile.tag} is unavailable.`)
  const expectedNames = new Set([mobile.assetName, mobile.checksumName])
  const names = (release.assets || []).map(asset => String(asset.name || ''))
  const unexpected = names.filter(name => !expectedNames.has(name))
  if (release.tag_name !== mobile.tag || String(release.target_commitish || '').toLowerCase() !== sourceRevision || String(release.name || '') !== `Harness Mobile ${mobile.versionName}` || String(release.body || '') !== STANDALONE_RELEASE_BODY(mobile.versionName) || Boolean(release.draft) || Boolean(release.prerelease)) {
    throw new Error('Standalone Android recovery release metadata is not exact.')
  }
  if (unexpected.length > 0 || new Set(names).size !== names.length || (requireEmpty && names.length !== 0)) {
    throw new Error(`Standalone Android recovery release asset set is unsafe: ${names.join(', ') || '(empty)'}.`)
  }
  if (readLatestGithubReleaseTag(repo) !== `v${mobile.integrationVersion}`) throw new Error('Standalone Android recovery must not replace the desktop latest release.')
  return release
}

async function assertStandaloneCnbAssetsAbsent(repo, mobile) {
  for (const name of [mobile.assetName, mobile.checksumName]) {
    const url = `https://cnb.cool/${repo}/-/releases/download/${mobile.tag}/${name}`
    const response = await fetchRemoteRead(url, { method: 'HEAD', redirect: 'manual', timeout: 15_000 })
    if (response.status !== 404) throw new Error(`Standalone Android recovery requires absent CNB asset ${name} (HTTP ${response.status}).`)
  }
}

function createEmptyStandaloneRelease(repo, sourceRevision, mobile) {
  const existing = readGithubRelease(repo, mobile.tag)
  if (existing) return assertStandaloneReleaseShell(repo, sourceRevision, mobile, { requireEmpty: true })
  try {
    ghRun([
      'api', '--method', 'POST', `repos/${repo}/releases`,
      '-f', `tag_name=${mobile.tag}`,
      '-f', `target_commitish=${sourceRevision}`,
      '-f', `name=Harness Mobile ${mobile.versionName}`,
      '-f', `body=${STANDALONE_RELEASE_BODY(mobile.versionName)}`,
      '-F', 'draft=false',
      '-F', 'prerelease=false',
      '-f', 'make_latest=false'
    ])
  } catch (error) {
    if (!readGithubRelease(repo, mobile.tag)) throw error
  }
  return assertStandaloneReleaseShell(repo, sourceRevision, mobile, { requireEmpty: true })
}

function normalizeRelease(release) {
  if (!release) return null
  return {
    id: Number(release.id),
    tagName: release.tag_name,
    targetCommitish: String(release.target_commitish || ''),
    name: String(release.name || ''),
    htmlUrl: String(release.html_url || ''),
    body: String(release.body || ''),
    draft: Boolean(release.draft),
    prerelease: Boolean(release.prerelease),
    immutable: Boolean(release.immutable),
    createdAt: release.created_at,
    updatedAt: release.updated_at,
    publishedAt: release.published_at,
    assets: [...(release.assets || [])].map(asset => ({
      name: asset.name,
      size: Number(asset.size),
      digest: asset.digest || '',
      url: asset.browser_download_url || '',
      state: asset.state || '',
      createdAt: asset.created_at || '',
      updatedAt: asset.updated_at || ''
    })).sort((left, right) => left.name.localeCompare(right.name))
  }
}

function assertProtectedReleaseMatchesManifest(release, repo, protectedTag) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'release-manifest.json'), 'utf8'))
  if (!Array.isArray(manifest) || manifest.length !== 1 || manifest[0].tag_name !== protectedTag || manifest[0].assets.length !== 18) {
    throw new Error(`Local protected release manifest must remain the exact 18-asset ${protectedTag} identity.`)
  }
  const expectedRelease = manifest[0]
  if (release.tag_name !== expectedRelease.tag_name || String(release.name || '') !== String(expectedRelease.name || '') || String(release.html_url || '') !== String(expectedRelease.html_url || '') || String(release.body || '') !== String(expectedRelease.body || '') || Boolean(release.draft) !== Boolean(expectedRelease.draft) || Boolean(release.prerelease) !== Boolean(expectedRelease.prerelease)) {
    throw new Error(`Protected ${protectedTag} GitHub release metadata differs from the reviewed manifest.`)
  }
  const assets = [...(release?.assets || [])].sort((left, right) => left.name.localeCompare(right.name))
  const expected = [...expectedRelease.assets].sort((left, right) => left.name.localeCompare(right.name))
  if (assets.length !== expected.length || JSON.stringify(assets.map(asset => asset.name)) !== JSON.stringify(expected.map(asset => asset.name))) {
    throw new Error(`Protected ${protectedTag} GitHub asset names differ from the reviewed manifest.`)
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actualAsset = assets[index]
    const expectedAsset = expected[index]
    const expectedUrl = `https://github.com/${repo}/releases/download/${protectedTag}/${expectedAsset.name}`
    if (Number(actualAsset.size) !== Number(expectedAsset.size) || actualAsset.digest !== `sha256:${expectedAsset.sha256}` || actualAsset.browser_download_url !== expectedUrl || expectedAsset.browser_download_url !== expectedUrl) {
      throw new Error(`Protected ${protectedTag} GitHub asset evidence changed: ${expectedAsset.name}.`)
    }
  }
  return true
}

const REMOTE_READ_RETRY_ATTEMPTS = 4
const TRANSIENT_REMOTE_READ_ERROR = /(?:TimeoutError|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|Connect Timeout Error|socket disconnected|other side closed)/iu

function remoteReadErrorDetail(error) {
  const detail = []
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth += 1) {
    detail.push(current.name, current.code, current.message)
  }
  return detail.filter(Boolean).join(' ')
}

async function withRemoteReadRetry(operation) {
  for (let attempt = 1; attempt <= REMOTE_READ_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!TRANSIENT_REMOTE_READ_ERROR.test(remoteReadErrorDetail(error)) || attempt === REMOTE_READ_RETRY_ATTEMPTS) throw error
      console.warn(`Transient remote read failure (${attempt}/${REMOTE_READ_RETRY_ATTEMPTS}); retrying read-only request.`)
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000))
    }
  }
}

async function fetchRemoteRead(url, { timeout, ...options }) {
  return withRemoteReadRetry(() => fetch(url, { ...options, signal: AbortSignal.timeout(timeout) }))
}

async function fetchBytes(url, timeout = 5 * 60 * 1000) {
  return withRemoteReadRetry(async () => {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout) })
    if (!response.ok) throw new Error(`Remote download failed (${response.status}): ${url}`)
    return Buffer.from(await response.arrayBuffer())
  })
}

async function remoteSha256(url) {
  return sha256(await fetchBytes(url, 2 * 60 * 1000))
}

async function remoteStreamEvidence(url, timeout = 30 * 60 * 1000) {
  return withRemoteReadRetry(async () => {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout) })
    if (!response.ok || !response.body) throw new Error(`Remote byte verification failed (${response.status}): ${url}`)
    const digest = createHash('sha256')
    let size = 0
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk)
      size += bytes.length
      digest.update(bytes)
    }
    return { size, sha256: digest.digest('hex') }
  })
}

async function protectedMetadataHashes(repo) {
  const providers = {
    github: `https://raw.githubusercontent.com/${repo}/main/`,
    cnb: `https://cnb.cool/${repo}/-/git/raw/main/`
  }
  const result = {}
  for (const [provider, base] of Object.entries(providers)) {
    result[provider] = {}
    for (const file of PROTECTED_METADATA_PATHS) result[provider][file] = await remoteSha256(`${base}${file}`)
  }
  return result
}

function assertProtectedMetadataMatchesLocal(metadataHashes) {
  for (const file of PROTECTED_METADATA_PATHS) {
    const expected = sha256(gitCaptureRaw(['cat-file', 'blob', `HEAD:${file}`]))
    if (metadataHashes.github?.[file] !== expected || metadataHashes.cnb?.[file] !== expected) {
      throw new Error(`Protected GitHub/CNB metadata differs from the committed source: ${file}.`)
    }
  }
  return true
}

async function protectedCnbAssetHeads(repo, protectedTag) {
  const manifest = JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8'))
  if (!Array.isArray(manifest) || manifest.length !== 1 || manifest[0].tag_name !== protectedTag || manifest[0].assets.length !== 18) {
    throw new Error(`release-manifest.json must retain the exact 18-asset ${protectedTag} release.`)
  }
  const observations = []
  for (const asset of manifest[0].assets) {
    const url = (asset.mirror_urls || []).find(value => value.startsWith(`https://cnb.cool/${repo}/-/releases/download/${protectedTag}/`))
    if (!url) throw new Error(`Protected CNB mirror URL is missing for ${asset.name}.`)
    const response = await fetchRemoteRead(url, { method: 'HEAD', redirect: 'follow', timeout: 30_000 })
    const size = Number(response.headers.get('content-length') || 0)
    if (!response.ok || size !== Number(asset.size)) throw new Error(`Protected CNB asset observation failed for ${asset.name}.`)
    observations.push({ name: asset.name, size, url })
  }
  return observations.sort((left, right) => left.name.localeCompare(right.name))
}

async function verifyProtectedCnbAssetBytes(repo, protectedTag) {
  const manifest = JSON.parse(await readFile(path.join(root, 'release-manifest.json'), 'utf8'))
  if (!Array.isArray(manifest) || manifest.length !== 1 || manifest[0].tag_name !== protectedTag || manifest[0].assets.length !== 18) {
    throw new Error(`Cannot byte-verify protected CNB assets without the exact ${protectedTag} manifest.`)
  }
  for (const asset of manifest[0].assets) {
    if (!/^[0-9a-f]{64}$/u.test(String(asset.sha256 || ''))) throw new Error(`Protected manifest SHA-256 missing for ${asset.name}.`)
    const url = (asset.mirror_urls || []).find(value => value.startsWith(`https://cnb.cool/${repo}/-/releases/download/${protectedTag}/`))
    if (!url) throw new Error(`Protected CNB byte URL is missing for ${asset.name}.`)
    const evidence = await remoteStreamEvidence(url)
    if (evidence.size !== Number(asset.size) || evidence.sha256 !== asset.sha256) throw new Error(`Protected CNB asset bytes changed: ${asset.name}.`)
  }
  return true
}

async function captureProtectedState(repo, integrationVersion) {
  const protectedTag = `v${integrationVersion}`
  const release = readGithubRelease(repo, protectedTag)
  const normalized = normalizeRelease(release)
  if (!normalized || normalized.draft || normalized.prerelease || normalized.assets.length !== 18) throw new Error(`Protected ${protectedTag} GitHub release must remain public with exactly 18 assets.`)
  assertProtectedReleaseMatchesManifest(release, repo, protectedTag)
  const tagRevision = remoteTagRevision(protectedTag)
  if (!/^[0-9a-f]{40}$/u.test(tagRevision)) throw new Error(`Protected ${protectedTag} tag revision is unavailable.`)
  if (normalized.targetCommitish.toLowerCase() !== tagRevision) throw new Error(`Protected ${protectedTag} release target differs from its immutable tag.`)
  const latestTag = readLatestGithubReleaseTag(repo)
  if (latestTag !== protectedTag) throw new Error(`Protected desktop latest release must remain ${protectedTag}.`)
  const metadataHashes = await protectedMetadataHashes(repo)
  assertProtectedMetadataMatchesLocal(metadataHashes)
  return {
    tag: protectedTag,
    tagRevision,
    latestTag,
    githubRelease: normalized,
    metadataHashes,
    cnbAssetHeads: await protectedCnbAssetHeads(repo, protectedTag)
  }
}

async function verifyProtectedState(repo, baseline, { verifyCnbBytes = false } = {}) {
  const current = {
    tag: baseline.tag,
    tagRevision: remoteTagRevision(baseline.tag),
    latestTag: readLatestGithubReleaseTag(repo),
    githubRelease: normalizeRelease(readGithubRelease(repo, baseline.tag)),
    metadataHashes: await protectedMetadataHashes(repo),
    cnbAssetHeads: await protectedCnbAssetHeads(repo, baseline.tag)
  }
  if (JSON.stringify(current) !== JSON.stringify(baseline)) {
    throw new Error(`${baseline.tag} desktop/components/stable or mirror state changed during Android-only publication.`)
  }
  if (verifyCnbBytes) await verifyProtectedCnbAssetBytes(repo, baseline.tag)
  return true
}

function exactWorkflowRuns(repo, title, sourceRevision, headBranch) {
  const runs = JSON.parse(ghCapture([
    'run', 'list', '--repo', repo, '--workflow', 'android-mobile-release.yml', '--limit', '100',
    '--json', 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,workflowName'
  ]) || '[]')
  return runs.filter(run => run.displayTitle === title && run.event === 'workflow_dispatch' && run.headBranch === headBranch && String(run.headSha).toLowerCase() === sourceRevision)
}

async function discoverWorkflowRun(repo, title, sourceRevision, headBranch, pollSeconds, timeoutMs = 2 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  do {
    const matches = exactWorkflowRuns(repo, title, sourceRevision, headBranch)
    if (matches.length > 1) throw new Error(`Android workflow identity is ambiguous (${matches.length} exact runs).`)
    if (matches.length === 1) return matches[0]
    if (Date.now() >= deadline) return null
    await delay(pollSeconds * 1000)
  } while (true)
}

async function waitForWorkflow(repo, runId, title, sourceRevision, headBranch, pollSeconds) {
  const deadline = Date.now() + 2 * 60 * 60 * 1000
  do {
    const run = JSON.parse(ghCapture([
      'run', 'view', String(runId), '--repo', repo,
      '--json', 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,workflowName'
    ]))
    if (run.displayTitle !== title || run.event !== 'workflow_dispatch' || run.headBranch !== headBranch || String(run.headSha).toLowerCase() !== sourceRevision) {
      throw new Error('Stored Android workflow run no longer matches its exact request identity.')
    }
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Signed Android workflow failed: ${run.url}`)
      return run
    }
    if (Date.now() >= deadline) throw new Error(`Signed Android workflow timed out: ${run.url}`)
    await delay(pollSeconds * 1000)
  } while (true)
}

function readCiWorkflowIdentity(repo) {
  const workflow = JSON.parse(ghCapture(['api', `repos/${repo}/actions/workflows/ci.yml`]))
  if (!Number.isSafeInteger(Number(workflow.id)) || workflow.name !== 'CI' || workflow.path !== '.github/workflows/ci.yml' || workflow.state !== 'active') {
    throw new Error('Android pre-Tag evidence requires the exact active CI workflow identity.')
  }
  return { id: Number(workflow.id), name: workflow.name, path: workflow.path }
}

function exactAndroidCiRuns(repo, sourceRevision, workflowIdentity) {
  const runs = JSON.parse(ghCapture([
    'run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--commit', sourceRevision, '--event', 'push', '--limit', '100',
    '--json', 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,workflowName,workflowDatabaseId'
  ]) || '[]')
  return runs.filter(run => run.event === 'push' && run.headBranch === 'main' && String(run.headSha).toLowerCase() === sourceRevision && run.workflowName === workflowIdentity.name && Number(run.workflowDatabaseId) === workflowIdentity.id)
}

async function validateAndroidCiRun(repo, runId, sourceRevision, workflowIdentity) {
  const run = JSON.parse(ghCapture([
    'run', 'view', String(runId), '--repo', repo,
    '--json', 'databaseId,event,headBranch,headSha,status,conclusion,url,workflowName,workflowDatabaseId,jobs'
  ]))
  if (Number(run.databaseId) !== Number(runId) || run.event !== 'push' || run.headBranch !== 'main' || String(run.headSha).toLowerCase() !== sourceRevision || run.workflowName !== workflowIdentity.name || Number(run.workflowDatabaseId) !== workflowIdentity.id) {
    throw new Error('Stored Android pre-Tag CI run no longer matches its exact source/workflow identity.')
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error(`Android pre-Tag CI run is not successful: ${run.url}`)
  const jobs = Array.isArray(run.jobs) ? run.jobs : []
  const androidJobs = jobs.filter(job => job.name === 'Android mobile compile/test')
  if (androidJobs.length !== 1 || androidJobs[0].status !== 'completed' || androidJobs[0].conclusion !== 'success') {
    throw new Error('Exact Android mobile compile/test CI job is not successful.')
  }
  return { runId: Number(run.databaseId), url: run.url, workflowId: workflowIdentity.id, jobId: Number(androidJobs[0].databaseId) }
}

function assertRecoverableAndroidPreflightFailure(repo, runId, title, sourceRevision, headBranch) {
  const run = JSON.parse(ghCapture([
    'run', 'view', String(runId), '--repo', repo,
    '--json', 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,workflowName,jobs'
  ]))
  if (Number(run.databaseId) !== Number(runId) || run.workflowName !== 'Publish Signed Android Mobile' || run.displayTitle !== title || run.event !== 'workflow_dispatch' || run.headBranch !== headBranch || String(run.headSha).toLowerCase() !== sourceRevision || run.status !== 'completed' || run.conclusion !== 'failure') {
    throw new Error('Android recovery requires one exact terminal failed signed workflow run.')
  }
  const jobs = (run.jobs || []).filter(job => job.name === 'Build, verify and publish signed APK')
  if (jobs.length !== 1 || jobs[0].conclusion !== 'failure') throw new Error('Android recovery signed workflow job evidence is not exact.')
  const steps = new Map((jobs[0].steps || []).map(step => [step.name, step.conclusion]))
  if (steps.get('Verify release tag and signing inputs') !== 'failure') throw new Error('Android recovery is allowed only for the known preflight failure.')
  for (const name of ['Restore private release keystore', 'Build signed Android APK', 'Verify package, version and signing identity', 'Create immutable standalone Android release when requested', 'Add immutable signed APK to the existing release', 'Verify public signed APK bytes and identity']) {
    if (steps.get(name) !== 'skipped') throw new Error(`Android recovery requires skipped side-effect step: ${name}.`)
  }
  return run
}

async function waitForAndroidCiEvidence(repo, sourceRevision, pollSeconds) {
  const workflowIdentity = readCiWorkflowIdentity(repo)
  const deadline = Date.now() + 60 * 60 * 1000
  do {
    const matches = exactAndroidCiRuns(repo, sourceRevision, workflowIdentity)
    if (matches.length > 1) throw new Error(`Android pre-Tag CI identity is ambiguous (${matches.length} exact runs).`)
    if (matches.length === 1) {
      const run = matches[0]
      if (run.status === 'completed') {
        if (run.conclusion !== 'success') throw new Error(`Android pre-Tag CI failed: ${run.url}`)
        return validateAndroidCiRun(repo, Number(run.databaseId), sourceRevision, workflowIdentity)
      }
    }
    if (Date.now() >= deadline) throw new Error('Timed out waiting for exact main-branch Android pre-Tag CI evidence.')
    await delay(pollSeconds * 1000)
  } while (true)
}

function readAppleWorkflowIdentity(repo) {
  const workflow = JSON.parse(ghCapture(['api', `repos/${repo}/actions/workflows/apple-virtual-tests.yml`]))
  if (!Number.isSafeInteger(Number(workflow.id)) || workflow.name !== 'Apple Virtual Device Tests' || workflow.path !== '.github/workflows/apple-virtual-tests.yml' || workflow.state !== 'active') {
    throw new Error('Apple mobile evidence requires the exact active virtual-device workflow identity.')
  }
  return { id: Number(workflow.id), name: workflow.name, path: workflow.path }
}

function exactAppleMobileRuns(repo, sourceRevision, requestId, workflowIdentity) {
  const title = `Apple mobile @ ${sourceRevision} · ${requestId}`
  const runs = JSON.parse(ghCapture([
    'run', 'list', '--repo', repo, '--workflow', 'apple-virtual-tests.yml', '--commit', sourceRevision, '--event', 'workflow_dispatch', '--limit', '100',
    '--json', 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,workflowName,workflowDatabaseId'
  ]) || '[]')
  return runs.filter(run => run.displayTitle === title && run.event === 'workflow_dispatch' && run.headBranch === 'main' && String(run.headSha).toLowerCase() === sourceRevision && run.workflowName === workflowIdentity.name && Number(run.workflowDatabaseId) === workflowIdentity.id)
}

async function validateAppleMobileRun(repo, runId, sourceRevision, requestId, workflowIdentity) {
  const title = `Apple mobile @ ${sourceRevision} · ${requestId}`
  const run = JSON.parse(ghCapture([
    'run', 'view', String(runId), '--repo', repo,
    '--json', 'databaseId,displayTitle,event,headBranch,headSha,status,conclusion,url,workflowName,workflowDatabaseId,jobs'
  ]))
  if (Number(run.databaseId) !== Number(runId) || run.displayTitle !== title || run.event !== 'workflow_dispatch' || run.headBranch !== 'main' || String(run.headSha).toLowerCase() !== sourceRevision || run.workflowName !== workflowIdentity.name || Number(run.workflowDatabaseId) !== workflowIdentity.id) {
    throw new Error('Stored Apple mobile workflow run no longer matches its exact request/source identity.')
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error(`Apple mobile simulator workflow is not successful: ${run.url}`)
  const jobs = Array.isArray(run.jobs) ? run.jobs : []
  const iosJobs = jobs.filter(job => job.name === 'iPhone and iPad simulators')
  const desktopJobs = jobs.filter(job => job.name === 'macOS Desktop package contracts')
  if (iosJobs.length !== 1 || iosJobs[0].status !== 'completed' || iosJobs[0].conclusion !== 'success') throw new Error('Exact iPhone/iPad simulator job is not successful.')
  if (desktopJobs.length > 1 || (desktopJobs.length === 1 && (desktopJobs[0].status !== 'completed' || desktopJobs[0].conclusion !== 'skipped'))) throw new Error('Mobile-only Apple validation must skip macOS desktop packaging.')
  return { runId: Number(run.databaseId), url: run.url, workflowId: workflowIdentity.id, iosJobId: Number(iosJobs[0].databaseId) }
}

async function ensureAppleMobileEvidence(stateFile, state, repo, sourceRevision, pollSeconds) {
  const phaseId = 'local-mobile-gates'
  const workflowIdentity = readAppleWorkflowIdentity(repo)
  let requestId = String(state.phases[phaseId]?.appleRequestId || '')
  if (!requestId) {
    requestId = `apple-mobile-${randomUUID()}`
    await checkpoint(stateFile, state, phaseId, { appleRequestId: requestId, appleDispatchAttemptedAt: null })
  }
  let matches = exactAppleMobileRuns(repo, sourceRevision, requestId, workflowIdentity)
  if (matches.length > 1) throw new Error(`Apple mobile workflow identity is ambiguous (${matches.length} exact runs).`)
  if (matches.length === 0 && !state.phases[phaseId]?.appleDispatchAttemptedAt) {
    await checkpoint(stateFile, state, phaseId, { appleDispatchAttemptedAt: new Date().toISOString() })
    ghRun(['workflow', 'run', 'apple-virtual-tests.yml', '--repo', repo, '--ref', 'main', '-f', `source_revision=${sourceRevision}`, '-f', `request_id=${requestId}`, '-f', 'mobile_only=true'])
  }
  const discoveryDeadline = Date.now() + 2 * 60 * 1000
  while (matches.length === 0 && Date.now() < discoveryDeadline) {
    await delay(pollSeconds * 1000)
    matches = exactAppleMobileRuns(repo, sourceRevision, requestId, workflowIdentity)
    if (matches.length > 1) throw new Error(`Apple mobile workflow identity is ambiguous (${matches.length} exact runs).`)
  }
  if (matches.length !== 1) throw new Error('Apple mobile workflow dispatch is not discoverable; refusing an ambiguous redispatch.')
  const runId = Number(matches[0].databaseId)
  await checkpoint(stateFile, state, phaseId, { appleRunId: runId, appleUrl: matches[0].url, appleWorkflowId: workflowIdentity.id })
  const deadline = Date.now() + 60 * 60 * 1000
  do {
    const current = exactAppleMobileRuns(repo, sourceRevision, requestId, workflowIdentity)
    if (current.length !== 1 || Number(current[0].databaseId) !== runId) throw new Error('Apple mobile workflow identity changed while waiting.')
    if (current[0].status === 'completed') return validateAppleMobileRun(repo, runId, sourceRevision, requestId, workflowIdentity)
    if (Date.now() >= deadline) throw new Error(`Apple mobile simulator workflow timed out: ${current[0].url}`)
    await delay(pollSeconds * 1000)
  } while (true)
}

async function verifyGithubMobileRelease(repo, sourceRevision, mobile) {
  const release = readGithubRelease(repo, mobile.tag)
  if (!release || release.draft || release.prerelease || release.tag_name !== mobile.tag) throw new Error('Standalone Android GitHub release is missing or has the wrong publication state.')
  if (String(release.target_commitish || '').toLowerCase() !== sourceRevision) throw new Error('Standalone Android release target does not match the immutable source revision.')
  const assets = [...(release.assets || [])].sort((left, right) => left.name.localeCompare(right.name))
  const expectedNames = [mobile.assetName, mobile.checksumName].sort()
  if (assets.length !== 2 || JSON.stringify(assets.map(asset => asset.name)) !== JSON.stringify(expectedNames)) {
    throw new Error('Standalone Android release must contain exactly the signed APK and its checksum.')
  }
  const apk = assets.find(asset => asset.name === mobile.assetName)
  const checksum = assets.find(asset => asset.name === mobile.checksumName)
  for (const asset of assets) {
    if (!Number.isSafeInteger(Number(asset.size)) || Number(asset.size) < 1) throw new Error(`Invalid GitHub Android asset size: ${asset.name}`)
    if (!String(asset.browser_download_url || '').startsWith(`https://github.com/${repo}/releases/download/${mobile.tag}/`)) throw new Error(`Untrusted GitHub Android asset URL: ${asset.name}`)
    if (!/^sha256:[0-9a-f]{64}$/u.test(String(asset.digest || ''))) throw new Error(`GitHub Android asset digest is missing: ${asset.name}`)
  }
  const checksumBytes = await fetchBytes(checksum.browser_download_url)
  if (sha256(checksumBytes) !== checksum.digest.slice('sha256:'.length)) throw new Error('GitHub checksum asset digest mismatch.')
  const match = checksumBytes.toString('utf8').trim().match(/^([0-9a-f]{64})\s+\*?([^\s]+)$/u)
  if (!match || match[2] !== mobile.assetName || match[1] !== apk.digest.slice('sha256:'.length)) throw new Error('GitHub Android checksum content does not bind the APK digest.')
  return {
    releaseId: Number(release.id),
    url: release.html_url,
    apk: { name: apk.name, size: Number(apk.size), sha256: match[1], sourceUrl: apk.browser_download_url },
    checksum: { name: checksum.name, size: Number(checksum.size), sha256: checksum.digest.slice('sha256:'.length), sourceUrl: checksum.browser_download_url }
  }
}

async function writeMobileMirrorManifest(stateFile, repo, sourceRevision, mobile, evidence) {
  const mirrorBase = `https://cnb.cool/${repo}/-/releases/download/${mobile.tag}`
  const manifest = [{
    schemaVersion: 1,
    kind: 'harness-android-standalone-release',
    tag_name: mobile.tag,
    name: `Harness Mobile ${mobile.versionName}`,
    target_commitish: sourceRevision,
    integrationVersion: mobile.integrationVersion,
    mobileVersion: mobile.versionName,
    assets: [evidence.apk, evidence.checksum].map(asset => ({
      name: asset.name,
      size: asset.size,
      sha256: asset.sha256,
      browser_download_url: asset.sourceUrl,
      mirror_urls: [`${mirrorBase}/${asset.name}`]
    }))
  }]
  const manifestFile = path.join(path.dirname(stateFile), `${mobile.tag}-mobile-release-manifest.json`)
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return { manifest, manifestFile, sha256: sha256(Buffer.from(JSON.stringify(manifest))) }
}

async function verifyRemoteMobileAssets(repo, mobile, evidence) {
  const cnbBase = `https://cnb.cool/${repo}/-/releases/download/${mobile.tag}`
  const githubApkHash = sha256(await fetchBytes(evidence.apk.sourceUrl))
  const cnbApkHash = sha256(await fetchBytes(`${cnbBase}/${mobile.assetName}`))
  if (githubApkHash !== evidence.apk.sha256 || cnbApkHash !== evidence.apk.sha256) throw new Error('GitHub/CNB Android APK bytes do not match the signed checksum.')
  const githubChecksum = await fetchBytes(evidence.checksum.sourceUrl)
  const cnbChecksum = await fetchBytes(`${cnbBase}/${mobile.checksumName}`)
  if (sha256(githubChecksum) !== evidence.checksum.sha256 || sha256(cnbChecksum) !== evidence.checksum.sha256 || !githubChecksum.equals(cnbChecksum)) {
    throw new Error('GitHub/CNB Android checksum bytes differ.')
  }
  return { apkSha256: evidence.apk.sha256, checksumSha256: evidence.checksum.sha256, githubUrl: evidence.apk.sourceUrl, cnbUrl: `${cnbBase}/${mobile.assetName}` }
}

async function readState(stateFile, identity) {
  try { return JSON.parse(await readFile(stateFile, 'utf8')) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return { schemaVersion: 1, kind: 'android-only', ...identity, sourceRevision: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), phases: {} }
  }
}

async function saveState(stateFile, state) {
  await mkdir(path.dirname(stateFile), { recursive: true })
  state.updatedAt = new Date().toISOString()
  const temporary = `${stateFile}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, stateFile)
}

async function checkpoint(stateFile, state, id, data) {
  state.phases[id] = { ...state.phases[id], ...data }
  await saveState(stateFile, state)
}

async function phase(stateFile, state, id, work, validateCompleted) {
  if (state.phases[id]?.status === 'completed') {
    if (validateCompleted) await validateCompleted(state.phases[id])
    console.log(`Skipping completed Android publication phase: ${id}`)
    return state.phases[id]
  }
  state.phases[id] = { ...state.phases[id], status: 'running', startedAt: state.phases[id]?.startedAt || new Date().toISOString() }
  delete state.phases[id].failedAt
  delete state.phases[id].error
  await saveState(stateFile, state)
  console.log(`\n=== Android publication phase: ${id} ===`)
  try {
    const result = await work()
    state.phases[id] = { ...state.phases[id], status: 'completed', completedAt: new Date().toISOString(), ...(result || {}) }
    await saveState(stateFile, state)
    return state.phases[id]
  } catch (error) {
    state.phases[id] = { ...state.phases[id], status: 'failed', failedAt: new Date().toISOString(), error: String(error?.message || error).slice(0, 2000) }
    await saveState(stateFile, state)
    throw error
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function acquireLock(lockFile) {
  await mkdir(path.dirname(lockFile), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockFile, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() })}\n`, 'utf8')
      await handle.close()
      return async () => { await rm(lockFile, { force: true }) }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let owner = null
      try { owner = JSON.parse(await readFile(lockFile, 'utf8')) } catch {}
      const sameLiveProcess = owner?.host === hostname() && processIsAlive(Number(owner.pid))
      const age = Date.now() - Date.parse(String(owner?.startedAt || ''))
      const stale = !sameLiveProcess && (!Number.isFinite(age) || age > 24 * 60 * 60 * 1000 || owner?.host === hostname())
      if (!stale) throw new Error(`Another Android publisher owns ${lockFile} (pid ${owner?.pid || 'unknown'} on ${owner?.host || 'unknown'}).`)
      await rm(lockFile, { force: true })
    }
  }
  throw new Error(`Unable to acquire Android publication lock: ${lockFile}`)
}

async function assertStandaloneRemoteAbsence(repo, mobile) {
  if (localTagRevision(mobile.tag) || remoteTagRevision(mobile.tag)) throw new Error('Cannot rebind Android candidate after its immutable tag exists.')
  if (readGithubRelease(repo, mobile.tag)) throw new Error('Cannot rebind Android candidate after its GitHub release exists.')
  for (const name of [mobile.assetName, mobile.checksumName]) {
    const url = `https://cnb.cool/${repo}/-/releases/download/${mobile.tag}/${name}`
    const response = await fetchRemoteRead(url, { method: 'HEAD', redirect: 'manual', timeout: 15_000 })
    if (response.status !== 404) throw new Error(`Cannot prove CNB Android side-effect absence for ${name} (HTTP ${response.status}).`)
  }
}

async function maybeRebindPreTagCandidate(stateFile, state, currentHead, repo, mobile) {
  if (!state.sourceRevision || state.sourceRevision === currentHead) return false
  for (const phaseId of ['immutable-mobile-tag', 'github-signed-android', 'cnb-mobile-assets', 'complete']) {
    if (state.phases[phaseId]) throw new Error(`Android publication source changed after phase ${phaseId} started; immutable candidate cannot be rebound.`)
  }
  const localGate = state.phases['local-mobile-gates']
  if (localGate?.appleRunId) {
    const run = JSON.parse(ghCapture(['run', 'view', String(localGate.appleRunId), '--repo', repo, '--json', 'databaseId,status,conclusion,url']))
    if (Number(run.databaseId) !== Number(localGate.appleRunId) || run.status !== 'completed') throw new Error('Old Apple mobile validation must be terminal before candidate rebind.')
  }
  await assertStandaloneRemoteAbsence(repo, mobile)
  const attempt = {
    sourceRevision: state.sourceRevision,
    archivedAt: new Date().toISOString(),
    reason: 'safe-pre-tag-main-fast-forward',
    phases: state.phases
  }
  state.candidateAttempts = [...(Array.isArray(state.candidateAttempts) ? state.candidateAttempts : []), attempt].slice(-20)
  state.sourceRevision = currentHead
  state.phases = {}
  await saveState(stateFile, state)
  return true
}

async function publishAndroid({ integrationVersion, repo, pollSeconds, mobile, stateFile }) {
  assertMobileIdentity(integrationVersion, mobile)
  const identity = { integrationVersion, mobileVersion: mobile.versionName, tag: mobile.tag, repo }
  const state = await readState(stateFile, identity)
  for (const [key, value] of Object.entries(identity)) if (state[key] !== value) throw new Error(`Android publication state identity mismatch: ${key}`)
  assertClean()
  const currentHead = assertExactRemoteMain()
  if (state.sourceRevision && state.sourceRevision !== currentHead && state.phases['immutable-mobile-tag']) {
    const controllerPaths = assertPostTagControllerAdvance(state, currentHead, mobile)
    const controllerCi = await waitForAndroidCiEvidence(repo, currentHead, pollSeconds)
    state.controllerRevision = currentHead
    state.controllerPaths = controllerPaths
    state.controllerCiRunId = controllerCi.runId
    state.controllerCiUrl = controllerCi.url
    await saveState(stateFile, state)
  } else {
    await maybeRebindPreTagCandidate(stateFile, state, currentHead, repo, mobile)
  }
  if (!state.sourceRevision) {
    state.sourceRevision = currentHead
    await saveState(stateFile, state)
  }
  if (state.sourceRevision !== currentHead && state.controllerRevision !== currentHead) throw new Error('Android publication source revision changed after an immutable phase started.')

  await phase(stateFile, state, 'local-mobile-gates', async () => {
    assertClean()
    const exactHead = assertExactRemoteMain()
    if (exactHead !== state.sourceRevision) throw new Error('Android candidate changed before local gates.')
    if (localTagRevision(mobile.tag) || remoteTagRevision(mobile.tag) || readGithubRelease(repo, mobile.tag)) throw new Error('Standalone Android tag or release already exists before publisher authorization.')
    ghRun(['auth', 'status'])
    rmSync(path.join(root, 'dist'), { recursive: true, force: true })
    npmRun(['run', 'verify'], { timeout: 30 * 60 * 1000 })
    if (existsSync(path.join(root, 'dist'))) throw new Error('Android-only publisher must not create desktop release artifacts.')
    assertClean()
    const [ciEvidence, appleEvidence] = await Promise.all([
      waitForAndroidCiEvidence(repo, state.sourceRevision, pollSeconds),
      ensureAppleMobileEvidence(stateFile, state, repo, state.sourceRevision, pollSeconds)
    ])
    return {
      sourceRevision: state.sourceRevision,
      protectedState: await captureProtectedState(repo, integrationVersion),
      packagingMode: 'github-actions-signed-android-only',
      ciRunId: ciEvidence.runId,
      ciUrl: ciEvidence.url,
      ciWorkflowId: ciEvidence.workflowId,
      ciJobId: ciEvidence.jobId,
      appleRequestId: state.phases['local-mobile-gates'].appleRequestId,
      appleRunId: appleEvidence.runId,
      appleUrl: appleEvidence.url,
      appleWorkflowId: appleEvidence.workflowId,
      appleIosJobId: appleEvidence.iosJobId
    }
  }, async completed => {
    assertClean()
    const exactHead = assertExactRemoteMain()
    if (exactHead !== state.sourceRevision) assertPostTagControllerAdvance(state, exactHead, mobile)
    const workflowIdentity = readCiWorkflowIdentity(repo)
    if (Number(completed.ciWorkflowId) !== workflowIdentity.id) throw new Error('Stored Android CI workflow identity changed.')
    await validateAndroidCiRun(repo, Number(completed.ciRunId), state.sourceRevision, workflowIdentity)
    const appleWorkflowIdentity = readAppleWorkflowIdentity(repo)
    if (Number(completed.appleWorkflowId) !== appleWorkflowIdentity.id) throw new Error('Stored Apple workflow identity changed.')
    await validateAppleMobileRun(repo, Number(completed.appleRunId), state.sourceRevision, String(completed.appleRequestId), appleWorkflowIdentity)
    await verifyProtectedState(repo, completed.protectedState)
  })

  await phase(stateFile, state, 'immutable-mobile-tag', async () => {
    assertClean()
    if (assertExactRemoteMain() !== state.sourceRevision) throw new Error('Android source changed before immutable tag creation.')
    let local = localTagRevision(mobile.tag)
    let remote = remoteTagRevision(mobile.tag)
    const authorization = state.phases['immutable-mobile-tag']?.tagAuthorization
    if (local && (!authorization || authorization.sourceRevision !== state.sourceRevision || !['create-local', 'push-remote'].includes(authorization.operation))) {
      throw new Error('Pre-existing local Android tag lacks publisher authorization.')
    }
    if (remote && (!authorization || authorization.sourceRevision !== state.sourceRevision || authorization.operation !== 'push-remote')) {
      throw new Error('Pre-existing remote Android tag lacks publisher authorization.')
    }
    if ((local && local !== state.sourceRevision) || (remote && remote !== state.sourceRevision)) throw new Error('Immutable Android tag points to a different source revision.')
    if (!local) {
      await checkpoint(stateFile, state, 'immutable-mobile-tag', { tagAuthorization: { operation: 'create-local', sourceRevision: state.sourceRevision, authorizedAt: new Date().toISOString() } })
      gitRun(['tag', '-a', mobile.tag, '-m', `Harness Mobile ${mobile.versionName}`, state.sourceRevision])
      local = state.sourceRevision
    }
    if (!remote) {
      await checkpoint(stateFile, state, 'immutable-mobile-tag', { tagAuthorization: { operation: 'push-remote', sourceRevision: state.sourceRevision, authorizedAt: new Date().toISOString() } })
      gitRun(['push', 'origin', `refs/tags/${mobile.tag}`])
      remote = remoteTagRevision(mobile.tag)
    }
    if (local !== state.sourceRevision || remote !== state.sourceRevision) throw new Error('Immutable Android tag publication could not be verified.')
    return { sourceRevision: state.sourceRevision }
  }, () => {
    if (localTagRevision(mobile.tag) !== state.sourceRevision || remoteTagRevision(mobile.tag) !== state.sourceRevision) throw new Error('Completed Android tag evidence no longer matches.')
  })

  await phase(stateFile, state, 'github-signed-android', async () => {
    let requestId = String(state.phases['github-signed-android']?.requestId || '')
    if (!requestId) {
      requestId = `${mobile.tag}-signed-${randomUUID()}`
      await checkpoint(stateFile, state, 'github-signed-android', { requestId, dispatchAttemptedAt: null })
    }
    const workflowRef = mobile.tag
    let title = `Android ${mobile.tag} · ${requestId}`
    let run = await discoverWorkflowRun(repo, title, state.sourceRevision, workflowRef, pollSeconds, 5_000)
    if (run?.status === 'completed' && run.conclusion !== 'success') {
      const failedRequests = [...(Array.isArray(state.phases['github-signed-android']?.failedRequests) ? state.phases['github-signed-android'].failedRequests : [])]
      if (failedRequests.length >= 5) throw new Error('Android signed workflow recovery exceeded its bounded request limit.')
      await verifyProtectedState(repo, state.phases['local-mobile-gates'].protectedState)
      await assertStandaloneCnbAssetsAbsent(repo, mobile)
      const existingRelease = readGithubRelease(repo, mobile.tag)
      if (!existingRelease) {
        assertRecoverableAndroidPreflightFailure(repo, Number(run.databaseId), title, state.sourceRevision, workflowRef)
        const taggedWorkflow = gitCaptureRaw(['show', `${state.sourceRevision}:.github/workflows/android-mobile-release.yml`])
        if (!taggedWorkflow.includes('existing="$(gh api "repos/$GITHUB_REPOSITORY/releases/tags/$RELEASE_TAG" 2>/dev/null || true)"')) {
          throw new Error('Android preflight recovery does not match the reviewed Tag workflow defect.')
        }
        await checkpoint(stateFile, state, 'github-signed-android', {
          releaseRecoveryAuthorization: {
            sourceRevision: state.sourceRevision,
            failedRunId: Number(run.databaseId),
            authorizedAt: new Date().toISOString()
          }
        })
        createEmptyStandaloneRelease(repo, state.sourceRevision, mobile)
      } else {
        const authorization = state.phases['github-signed-android']?.releaseRecoveryAuthorization
        if (authorization?.sourceRevision !== state.sourceRevision) throw new Error('Existing Android recovery release lacks exact publisher authorization.')
        assertStandaloneReleaseShell(repo, state.sourceRevision, mobile)
      }
      failedRequests.push({ requestId, runId: Number(run.databaseId), url: run.url, conclusion: run.conclusion, archivedAt: new Date().toISOString() })
      requestId = `${mobile.tag}-signed-${randomUUID()}`
      await checkpoint(stateFile, state, 'github-signed-android', {
        requestId,
        dispatchAttemptedAt: null,
        runId: null,
        url: null,
        failedRequests
      })
      title = `Android ${mobile.tag} · ${requestId}`
      run = null
    }
    if (!run && !state.phases['github-signed-android']?.dispatchAttemptedAt) {
      await checkpoint(stateFile, state, 'github-signed-android', { dispatchAttemptedAt: new Date().toISOString() })
      ghRun(['workflow', 'run', 'android-mobile-release.yml', '--repo', repo, '--ref', workflowRef, '-f', `tag=${mobile.tag}`, '-f', `request_id=${requestId}`])
      run = await discoverWorkflowRun(repo, title, state.sourceRevision, workflowRef, pollSeconds)
    } else if (!run) {
      run = await discoverWorkflowRun(repo, title, state.sourceRevision, workflowRef, pollSeconds)
    }
    if (!run) throw new Error('Signed Android workflow dispatch is not discoverable; refusing an ambiguous redispatch.')
    await checkpoint(stateFile, state, 'github-signed-android', { runId: Number(run.databaseId), url: run.url })
    await waitForWorkflow(repo, Number(run.databaseId), title, state.sourceRevision, workflowRef, pollSeconds)
    const evidence = await verifyGithubMobileRelease(repo, state.sourceRevision, mobile)
    return { requestId, runId: Number(run.databaseId), workflowUrl: run.url, ...evidence }
  }, async completed => {
    const title = `Android ${mobile.tag} · ${completed.requestId}`
    await waitForWorkflow(repo, Number(completed.runId), title, state.sourceRevision, mobile.tag, pollSeconds)
    await verifyGithubMobileRelease(repo, state.sourceRevision, mobile)
  })

  await phase(stateFile, state, 'cnb-mobile-assets', async () => {
    const evidence = await verifyGithubMobileRelease(repo, state.sourceRevision, mobile)
    const mirror = await writeMobileMirrorManifest(stateFile, repo, state.sourceRevision, mobile, evidence)
    npmRun(['run', 'release:cnb-mobile-cloud', '--', '-Manifest', mirror.manifestFile], { timeout: 30 * 60 * 1000 })
    return { manifestFile: mirror.manifestFile, manifestSha256: mirror.sha256 }
  })

  await phase(stateFile, state, 'complete', async () => {
    const evidence = await verifyGithubMobileRelease(repo, state.sourceRevision, mobile)
    const remotes = await verifyRemoteMobileAssets(repo, mobile, evidence)
    await verifyProtectedState(repo, state.phases['local-mobile-gates'].protectedState, { verifyCnbBytes: true })
    return { ...remotes, releaseUrl: evidence.url, mirrorUrl: `https://cnb.cool/${repo}/-/releases/tag/${mobile.tag}` }
  }, async completed => {
    const evidence = await verifyGithubMobileRelease(repo, state.sourceRevision, mobile)
    await verifyRemoteMobileAssets(repo, mobile, evidence)
    await verifyProtectedState(repo, state.phases['local-mobile-gates'].protectedState, { verifyCnbBytes: true })
    if (completed.apkSha256 !== evidence.apk.sha256) throw new Error('Completed Android publication digest evidence changed.')
  })

  console.log(JSON.stringify({ ok: true, scope: 'android', stateFile, integrationVersion, mobileVersion: mobile.versionName, tag: mobile.tag, sourceRevision: state.sourceRevision, phases: PHASES, ...state.phases.complete }, null, 2))
}

export async function runAndroidPublisher({ command, integrationVersion, repo, pollSeconds }) {
  const mobile = readAndroidMobileVersion(root)
  assertMobileIdentity(integrationVersion, mobile)
  const stateFile = path.join(stateDir, `${mobile.tag}-publish.json`)
  const lockFile = path.join(stateDir, `${mobile.tag}-publish.lock`)
  if (command === 'plan') {
    console.log(JSON.stringify({
      command: `npm run release:publish -- run --version ${integrationVersion} --scope android`,
      scope: 'android',
      integrationVersion,
      mobileVersion: mobile.versionName,
      versionCode: mobile.versionCode,
      tag: mobile.tag,
      repo,
      stateFile,
      phases: PHASES,
      guarantees: [
        'clean committed source at exact origin/main',
        'exact successful main-branch CI Android compile/test evidence before tag creation',
        'exact iPhone/iPad simulator evidence with macOS desktop packaging skipped',
        'no desktop workflow, desktop package, component publication, or stable-feed promotion',
        'immutable standalone Android tag',
        'GitHub Actions release build with pinned long-term signing certificate',
        'exact APK and checksum assets only',
        'GitHub-to-CNB cloud mirror only',
        `fresh proof that v${integrationVersion} desktop/component/stable assets were unchanged`
      ]
    }, null, 2))
    return
  }
  if (command === 'status') {
    console.log(JSON.stringify(await readState(stateFile, { integrationVersion, mobileVersion: mobile.versionName, tag: mobile.tag, repo }), null, 2))
    return
  }
  if (!['run', 'resume'].includes(command)) throw new Error('Android scope usage: release:publish plan|status|run|resume --version x.y.z --scope android')
  const releaseLock = await acquireLock(lockFile)
  try { await publishAndroid({ integrationVersion, repo, pollSeconds, mobile, stateFile }) }
  finally { await releaseLock() }
}

export { PHASES as ANDROID_PUBLICATION_PHASES }
