import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { hostname } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { validateAndVerifyDesktopReleaseManifest } = require('../electron/bridge/desktop-release-contract.cjs')
const {
  assertCandidateRebindAllowed,
  assertExistingTagRecoveryAllowed,
  canReattachPreferredDraft,
  classifyCnbAssetStatuses,
  isExactDetachedDraft,
  matchesWorkflowRunIdentity,
  normalizePublisherPackagingState,
  normalizeReleaseBody,
  selectReleaseForTag,
  selectUniqueWorkflowRunByDisplayTitle,
  validateCnbMirrorObservations,
  validateCompletedPhaseEvidence,
  validateGithubReleaseAgainstManifest
} = require('./release-publish-selection.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const command = process.argv[2] || 'status'
const version = String(argument('version', pkg.version)).replace(/^v/u, '')
const tag = `v${version}`
const repo = argument('repo', repositorySlug(pkg.repository?.url) || 'baiyuscc13724-max/deepseek-harness-desktop')
const pollSeconds = positiveInteger(argument('poll-seconds', '15'), 'poll-seconds')
const stateDir = path.join(root, '.release-state')
const stateFile = path.join(stateDir, `${tag}-publish.json`)
const lockFile = path.join(stateDir, `${tag}-publish.lock`)
const bundledGit = path.join(root, 'third_party', 'mingit', 'cmd', 'git.exe')
const legacyPortableGit = path.resolve(root, '..', '.tools', 'MinGit', 'cmd', 'git.exe')
const git = String(process.env.HARNESS_RELEASE_GIT || (existsSync(bundledGit) ? bundledGit : existsSync(legacyPortableGit) ? legacyPortableGit : 'git')).trim()
const npmCli = String(process.env.npm_execpath || '').trim()
const PACKAGING_MODE = 'github-actions-only'
const LOCAL_GATE_PHASE = 'local-source-gates'
const PHASES = [
  LOCAL_GATE_PHASE,
  'desktop-cloud-builds',
  'immutable-tag',
  'desktop-publication',
  'signed-android',
  'signed-components',
  'release-manifest',
  'cnb-assets',
  'stable-components',
  'cnb-stable',
  'complete'
]
const BUILD_JOBS = [
  'Build windows-latest',
  'Build macos-latest',
  'Build ubuntu-latest',
  'Validate iPhone and iPad simulators',
  'Verify Windows candidate upgrade and installation'
]
const WORKFLOWS = Object.freeze({
  desktop: Object.freeze({ workflowName: 'Cloud Build & Release Desktop', workflowPath: '.github/workflows/release.yml', events: ['workflow_dispatch'] }),
  recovery: Object.freeze({ workflowName: 'Recover Release From Verified Actions Artifacts', workflowPath: '.github/workflows/recover-release-from-actions.yml', events: ['workflow_dispatch'] }),
  android: Object.freeze({ workflowName: 'Publish Signed Android Mobile', workflowPath: '.github/workflows/android-mobile-release.yml', events: ['push', 'workflow_dispatch'] }),
  components: Object.freeze({ workflowName: 'Publish Verified Production Components', workflowPath: '.github/workflows/publish-production-components.yml', events: ['workflow_dispatch'] })
})
const POST_TAG_PUBLISHER_FIX_FILES = new Set([
  '.cnb.yml',
  '.github/workflows/recover-release-from-actions.yml',
  'scripts/publish-cnb-cloud-mirror.ps1',
  'scripts/release-publish.mjs',
  'scripts/release-publish-selection.cjs',
  'tests/release-publisher.test.cjs'
])

function argument(name, fallback = '') {
  const exact = process.argv.indexOf(`--${name}`)
  if (exact >= 0) return process.argv[exact + 1] ?? fallback
  const prefix = `--${name}=`
  const joined = process.argv.find(value => value.startsWith(prefix))
  return joined ? joined.slice(prefix.length) : fallback
}

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`--${name} must be a positive integer.`)
  return number
}

function repositorySlug(value) {
  const match = String(value || '').match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/u)
  return match?.[1] || ''
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function fetchWithTimeout(url, options = {}) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    throw new Error(`Timed bounded fetch failed for ${url}: ${error?.message || error}`)
  }
}

function execute(program, args, options = {}) {
  let stdoutFile = ''
  let stderrFile = ''
  let stdoutHandle = null
  let stderrHandle = null
  if (options.capture) {
    mkdirSync(stateDir, { recursive: true })
    const identity = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
    stdoutFile = path.join(stateDir, `.publish-stdout-${identity}.log`)
    stderrFile = path.join(stateDir, `.publish-stderr-${identity}.log`)
    stdoutHandle = openSync(stdoutFile, 'w')
    stderrHandle = openSync(stderrFile, 'w')
  }
  let result
  try {
    result = spawnSync(program, args, {
      cwd: root,
      env: options.env || process.env,
      stdio: options.capture ? ['ignore', stdoutHandle, stderrHandle] : 'inherit',
      shell: false,
      timeout: options.timeout || 45 * 60 * 1000
    })
  } finally {
    if (stdoutHandle !== null) closeSync(stdoutHandle)
    if (stderrHandle !== null) closeSync(stderrHandle)
  }
  const stdout = options.capture ? readFileSync(stdoutFile, 'utf8') : ''
  const stderr = options.capture ? readFileSync(stderrFile, 'utf8') : ''
  if (stdoutFile) rmSync(stdoutFile, { force: true })
  if (stderrFile) rmSync(stderrFile, { force: true })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = options.capture ? `\n${String(stderr || stdout).trim()}` : ''
    throw new Error(`${program} ${args.join(' ')} exited with code ${result.status}.${detail}`)
  }
  return options.capture ? (options.trim === false ? stdout : stdout.trim()) : ''
}

function capture(program, args, options = {}) {
  return execute(program, args, { ...options, capture: true })
}

function gitEnvironment() {
  const env = { ...process.env }
  if (!path.isAbsolute(git)) return env
  const commandDirectory = path.dirname(git)
  const gitRoot = ['cmd', 'bin'].includes(path.basename(commandDirectory).toLowerCase()) ? path.dirname(commandDirectory) : commandDirectory
  const additions = [commandDirectory, path.join(gitRoot, 'bin'), path.join(gitRoot, 'mingw64', 'bin'), path.join(gitRoot, 'usr', 'bin')]
  if (process.platform === 'win32') {
    additions.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0'))
  }
  const inheritedPathKey = Object.keys(env).find(key => key.toLowerCase() === 'path')
  const inheritedPath = inheritedPathKey ? String(env[inheritedPathKey] || '') : ''
  if (inheritedPathKey && inheritedPathKey !== 'PATH') delete env[inheritedPathKey]
  env.PATH = `${additions.join(path.delimiter)}${path.delimiter}${inheritedPath}`
  return env
}

function gitCapture(args) {
  return capture(git, args, { env: gitEnvironment() })
}

function gitCaptureRaw(args) {
  return capture(git, args, { env: gitEnvironment(), trim: false })
}

function gitRun(args) {
  return execute(git, args, { env: gitEnvironment() })
}

function ghCapture(args) {
  return capture(process.platform === 'win32' ? 'gh.exe' : 'gh', args, { timeout: 2 * 60 * 1000 })
}

function ghRun(args) {
  return execute(process.platform === 'win32' ? 'gh.exe' : 'gh', args, { timeout: 2 * 60 * 1000 })
}

function npmRun(args, options = {}) {
  if (npmCli) return execute(process.execPath, [npmCli, ...args], options)
  return execute(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options)
}

function releaseEnvironment() {
  return { ...gitEnvironment(), HARNESS_RELEASE_GIT: git }
}

function ghJson(args) {
  const text = ghCapture(args)
  return text ? JSON.parse(text) : null
}

async function readState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')) }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return {
      schemaVersion: 3,
      packagingMode: PACKAGING_MODE,
      releaseOrder: 'cloud-build-before-tag',
      version,
      tag,
      repo,
      sourceRevision: '',
      productRevision: '',
      candidateAttempts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: {}
    }
  }
}

async function normalizePackagingState(state) {
  const changed = normalizePublisherPackagingState(state, { packagingMode: PACKAGING_MODE, localGatePhase: LOCAL_GATE_PHASE })
  if (changed) await saveState(state)
}

async function saveState(state) {
  await mkdir(stateDir, { recursive: true })
  state.updatedAt = new Date().toISOString()
  const temporary = `${stateFile}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, stateFile)
}

async function checkpoint(state, id, data) {
  state.phases[id] = { ...state.phases[id], ...data }
  await saveState(state)
}

async function phase(state, id, work, { validateCompleted } = {}) {
  if (state.phases[id]?.status === 'completed') {
    if (validateCompleted) await validateCompletedPhaseEvidence(state.phases[id], validateCompleted)
    console.log(`Skipping completed publication phase: ${id}`)
    return state.phases[id]
  }
  state.phases[id] = { ...state.phases[id], status: 'running', startedAt: state.phases[id]?.startedAt || new Date().toISOString() }
  delete state.phases[id].failedAt
  delete state.phases[id].error
  await saveState(state)
  console.log(`\n=== Publication phase: ${id} ===`)
  try {
    const result = await work()
    state.phases[id] = { ...state.phases[id], status: 'completed', completedAt: new Date().toISOString(), ...(result || {}) }
    await saveState(state)
    return state.phases[id]
  } catch (error) {
    state.phases[id] = { ...state.phases[id], status: 'failed', failedAt: new Date().toISOString(), error: String(error?.message || error).slice(0, 2000) }
    await saveState(state)
    throw error
  }
}

function assertVersion() {
  if (!/^\d+\.\d+\.\d+$/u.test(version) || version !== pkg.version) {
    throw new Error(`Release version must exactly match package.json (${pkg.version}).`)
  }
}

function assertClean(pathsAllowed = []) {
  const lines = gitCaptureRaw(['status', '--porcelain=v1', '--untracked-files=normal']).split(/\r?\n/u).filter(Boolean)
  const unexpected = lines.filter(line => !pathsAllowed.includes(line.slice(3).replaceAll('\\', '/')))
  if (unexpected.length > 0) throw new Error(`Publication requires a clean tree. Commit or remove:\n${unexpected.join('\n')}`)
  return lines
}

function assertMainFastForward() {
  gitRun(['fetch', 'origin', 'main', '--tags'])
  const head = gitCapture(['rev-parse', 'HEAD']).toLowerCase()
  const remoteMain = gitCapture(['rev-parse', 'origin/main']).toLowerCase()
  const result = spawnSync(git, ['merge-base', '--is-ancestor', remoteMain, head], { cwd: root, stdio: 'ignore', shell: false })
  if (result.status !== 0) throw new Error('origin/main is not an ancestor of HEAD; refusing a non-fast-forward release.')
  return { head, remoteMain }
}

function publishPostTagRecoveryFix() {
  const current = gitCapture(['rev-parse', 'HEAD']).toLowerCase()
  if (current === stateProductRevision) return { ref: tag, fields: [], headSha: stateProductRevision, headBranch: tag }
  assertClean()
  gitRun(['fetch', 'origin', 'main'])
  const remoteMain = gitCapture(['rev-parse', 'origin/main']).toLowerCase()
  const productAncestor = spawnSync(git, ['merge-base', '--is-ancestor', stateProductRevision, current], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false })
  const remoteAncestor = spawnSync(git, ['merge-base', '--is-ancestor', remoteMain, current], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false })
  const changes = gitCapture(['diff', '--name-only', `${stateProductRevision}..${current}`]).split(/\r?\n/u).filter(Boolean)
  if (
    productAncestor.status !== 0 ||
    remoteAncestor.status !== 0 ||
    changes.length === 0 ||
    changes.some(file => !POST_TAG_PUBLISHER_FIX_FILES.has(file))
  ) {
    throw new Error('Post-tag recovery revision contains changes outside the bounded publisher fix.')
  }
  if (remoteMain !== current) gitRun(['push', 'origin', 'HEAD:main'])
  return { ref: 'main', fields: [['publisher_revision', current]], headSha: current, headBranch: 'main' }
}

function recoveryCheckpointWorkflowIdentity(phaseState) {
  const headSha = String(phaseState?.recoveryHeadSha || '').toLowerCase()
  const headBranch = String(phaseState?.recoveryHeadBranch || '')
  if (!/^[0-9a-f]{40}$/u.test(headSha)) throw new Error('Recovery workflow checkpoint lacks an exact source revision.')
  if (headBranch === tag) {
    if (headSha !== stateProductRevision) throw new Error('Tag-based recovery checkpoint does not match the immutable product revision.')
    return { ...WORKFLOWS.recovery, headSha, headBranch }
  }
  if (headBranch !== 'main') throw new Error('Recovery workflow checkpoint has an unsupported source ref.')
  gitRun(['fetch', 'origin', 'main'])
  const remoteMain = gitCapture(['rev-parse', 'origin/main']).toLowerCase()
  const productAncestor = spawnSync(git, ['merge-base', '--is-ancestor', stateProductRevision, headSha], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false })
  const publishedAncestor = spawnSync(git, ['merge-base', '--is-ancestor', headSha, remoteMain], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false })
  const changes = gitCapture(['diff', '--name-only', `${stateProductRevision}..${headSha}`]).split(/\r?\n/u).filter(Boolean)
  if (productAncestor.status !== 0 || publishedAncestor.status !== 0 || changes.length === 0 || changes.some(file => !POST_TAG_PUBLISHER_FIX_FILES.has(file))) {
    throw new Error('Recovery workflow checkpoint is not a published bounded publisher-fix revision.')
  }
  return { ...WORKFLOWS.recovery, headSha, headBranch }
}

function localTagRevision() {
  const exists = spawnSync(git, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, stdio: 'ignore', shell: false })
  return exists.status === 0 ? gitCapture(['rev-list', '-n', '1', `refs/tags/${tag}`]).toLowerCase() : ''
}

function remoteTagRevision() {
  const result = spawnSync(git, ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`], {
    cwd: root,
    env: gitEnvironment(),
    encoding: 'utf8',
    shell: false
  })
  if (result.error) throw result.error
  const stdout = String(result.stdout || '')
  const stderr = String(result.stderr || '')
  if (result.status === 2 && stdout.trim() === '' && stderr.trim() === '') return ''
  if (result.status !== 0) throw new Error(`Unable to determine exact remote Tag state (git ls-remote status ${result.status}).`)
  const rows = stdout.split(/\r?\n/u).filter(Boolean)
  const peeled = rows.find(row => row.endsWith(`refs/tags/${tag}^{}`))
  const direct = rows.find(row => row.endsWith(`refs/tags/${tag}`))
  if (!peeled && !direct) throw new Error('Remote Tag lookup succeeded without the exact requested ref.')
  if (peeled) return peeled.split(/\s+/u)[0].toLowerCase()
  const object = direct.split(/\s+/u)[0]
  return gitCapture(['rev-list', '-n', '1', object]).toLowerCase()
}

function expectedDesktopNames() {
  return [
    `Harness-Desktop-${version}-linux-amd64.deb`,
    `Harness-Desktop-${version}-linux-x86_64.AppImage`,
    `Harness-Desktop-${version}-mac-arm64.dmg`,
    `Harness-Desktop-${version}-mac-arm64.zip`,
    `Harness-Desktop-${version}-mac-x64.dmg`,
    `Harness-Desktop-${version}-mac-x64.zip`,
    `Harness-Desktop-${version}-portable-x64.exe`,
    `Harness-Desktop-${version}-win-x64.exe`,
    'SHA256SUMS.txt'
  ].sort()
}

function expectedAndroidNames() {
  return [
    `Harness-Mobile-${version}-android-universal.apk`,
    `Harness-Mobile-${version}-android-universal.apk.sha256`
  ]
}

function expectedComponentNames() {
  return [
    'COMPONENT-SHA256SUMS.txt',
    `components-${version}-darwin-arm64.json`,
    `components-${version}-darwin-x64.json`,
    `components-${version}-win32-x64.json`,
    `desktop-shell-${version}-darwin-arm64.zip`,
    `desktop-shell-${version}-darwin-x64.zip`,
    `desktop-shell-${version}-win32-x64.zip`
  ]
}

function expectedAllNames() {
  return [...expectedDesktopNames(), ...expectedAndroidNames(), ...expectedComponentNames()].sort()
}

function releaseList() {
  return ghJson(['api', '--method', 'GET', `repos/${repo}/releases?per_page=100`]) || []
}

function releaseById(id) {
  return ghJson(['api', '--method', 'GET', `repos/${repo}/releases/${id}`])
}

function releaseNotesBody() {
  return normalizeReleaseBody(readFileSync(path.join(root, 'release-notes.md'), 'utf8'))
}

function releaseForTag() {
  return selectReleaseForTag(releaseList(), {
    tag,
    productRevision: stateProductRevision,
    name: `Harness Desktop ${tag}`,
    body: releaseNotesBody()
  })
}

function assertReleaseAssets(release, expectedNames, { draft, allowAdditional = false } = {}) {
  if (!release || release.tag_name !== tag || release.target_commitish !== stateProductRevision) throw new Error(`Release ${tag} identity mismatch.`)
  if (typeof draft === 'boolean' && Boolean(release.draft) !== draft) throw new Error(`Release ${tag} draft state mismatch.`)
  const names = (release.assets || []).map(asset => asset.name).sort()
  const expected = [...expectedNames].sort()
  const valid = allowAdditional
    ? expected.every(name => names.includes(name)) && names.every(name => expectedAllNames().includes(name))
    : JSON.stringify(names) === JSON.stringify(expected)
  if (!valid) throw new Error(`Unexpected ${tag} asset set:\n${names.join('\n')}`)
  for (const asset of release.assets || []) {
    if (!Number.isSafeInteger(asset.id) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || !/^sha256:[0-9a-f]{64}$/u.test(String(asset.digest || ''))) {
      throw new Error(`Incomplete immutable asset metadata: ${asset.name}`)
    }
  }
}

function workflowRuns(workflow) {
  return ghJson(['run', 'list', '--repo', repo, '--workflow', workflow, '--limit', '50', '--json', 'databaseId,displayTitle,workflowName,status,conclusion,event,headBranch,headSha,createdAt,url']) || []
}

async function waitForRunDiscovery(workflow, predicate, dispatch) {
  const discoveryStarted = Date.now()
  while (Date.now() - discoveryStarted < 60_000) {
    const existing = workflowRuns(workflow).filter(predicate).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    if (existing) return existing
    await sleep()
  }
  const dispatchedId = dispatch ? Number(await dispatch()) : 0
  if (dispatchedId) {
    return ghJson(['run', 'view', String(dispatchedId), '--repo', repo, '--json', 'databaseId,displayTitle,workflowName,status,conclusion,event,headBranch,headSha,createdAt,url'])
  }
  const dispatchedAt = Date.now()
  while (Date.now() - dispatchedAt < 5 * 60 * 1000) {
    const found = workflowRuns(workflow).filter(predicate).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    if (found) return found
    await sleep()
  }
  throw new Error(`GitHub did not create ${workflow} within five minutes.`)
}

async function waitForSuccessfulJobs(runId, names) {
  for (;;) {
    const run = ghJson(['run', 'view', String(runId), '--repo', repo, '--json', 'status,conclusion,jobs,url'])
    const jobs = new Map((run.jobs || []).map(job => [job.name, job]))
    const states = names.map(name => ({ name, job: jobs.get(name) }))
    console.log(states.map(({ name, job }) => `${name}: ${job?.status || 'pending'}${job?.conclusion ? `/${job.conclusion}` : ''}`).join(' | '))
    if (states.every(({ job }) => job?.conclusion === 'success')) return run
    const failed = states.find(({ job }) => job?.status === 'completed' && job?.conclusion !== 'success')
    if (failed) throw new Error(`${failed.name} failed in ${run.url}.`)
    if (run.status === 'completed') {
      const incomplete = states.filter(({ job }) => job?.conclusion !== 'success').map(({ name }) => name)
      throw new Error(`Workflow completed without successful required jobs (${incomplete.join(', ')}): ${run.url}`)
    }
    await sleep()
  }
}

function workflowRun(runId) {
  const view = ghJson(['run', 'view', String(runId), '--repo', repo, '--json', 'databaseId,displayTitle,workflowName,status,conclusion,event,headBranch,headSha,createdAt,url,jobs'])
  const api = ghJson(['api', `repos/${repo}/actions/runs/${runId}`])
  const workflowMetadata = ghJson(['api', `repos/${repo}/actions/workflows/${api?.workflow_id}`])
  const runWorkflowPath = String(api?.path || '').split('@')[0]
  const workflowPath = String(workflowMetadata?.path || '').split('@')[0]
  if (!Number.isSafeInteger(Number(api?.workflow_id)) || Number(api.workflow_id) !== Number(workflowMetadata?.id) || !workflowPath || runWorkflowPath !== workflowPath) {
    throw new Error(`GitHub workflow metadata disagreement for run ${runId}.`)
  }
  const apiDisplayTitle = String(api?.display_title || '')
  const viewDisplayTitle = String(view?.displayTitle || '')
  if (!apiDisplayTitle || !viewDisplayTitle || apiDisplayTitle !== viewDisplayTitle) {
    throw new Error(`GitHub workflow run identity disagreement for ${runId}: displayTitle`)
  }
  const displayTitle = apiDisplayTitle
  const run = {
    ...view,
    databaseId: Number(api?.id || view?.databaseId || 0),
    displayTitle,
    workflowName: String(workflowMetadata?.name || ''),
    workflowPath,
    event: String(api?.event || view?.event || ''),
    headBranch: String(api?.head_branch || view?.headBranch || ''),
    headSha: String(api?.head_sha || view?.headSha || '').toLowerCase(),
    url: String(api?.html_url || view?.url || '')
  }
  for (const field of ['workflowName', 'event', 'headBranch', 'headSha']) {
    if (view?.[field] && String(view[field]).toLowerCase() !== String(run[field]).toLowerCase()) {
      throw new Error(`GitHub workflow run identity disagreement for ${runId}: ${field}`)
    }
  }
  return run
}

function productWorkflowIdentity(workflow) {
  return { ...workflow, headSha: stateProductRevision, headBranch: tag }
}

function candidateDesktopWorkflowIdentity(sourceRevision, requestId) {
  if (!requestId) throw new Error('Candidate workflow identity requires its persisted request id.')
  return {
    ...WORKFLOWS.desktop,
    headSha: sourceRevision,
    headBranch: 'main',
    displayTitle: `Candidate ${tag} @ ${sourceRevision} · ${requestId}`
  }
}

function desktopBuildArtifacts(runId) {
  const response = ghJson(['api', `repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`])
  const artifacts = Array.isArray(response?.artifacts) ? response.artifacts : []
  const expected = ['desktop-macos-latest', 'desktop-ubuntu-latest', 'desktop-windows-latest']
  const exact = artifacts.filter(artifact => String(artifact?.name || '').startsWith('desktop-'))
  const names = exact.map(artifact => artifact.name).sort()
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error('Desktop build run lacks the exact three platform artifacts or contains an extra desktop artifact.')
  for (const artifact of exact) {
    if (!Number.isSafeInteger(Number(artifact.id)) || Number(artifact.size_in_bytes) <= 0 || artifact.expired === true || Number(artifact.workflow_run?.id || 0) !== Number(runId)) {
      throw new Error(`Desktop build artifact identity is invalid: ${artifact.name}`)
    }
  }
  return exact
}

function reusableWorkflowRun(runId, expected) {
  if (!runId || !expected) return null
  try {
    const run = workflowRun(runId)
    if (!matchesWorkflowRunIdentity(run, expected)) return null
    return run.status === 'completed' && run.conclusion !== 'success' ? null : run
  } catch {
    return null
  }
}

function reusableDesktopBuildRun(runId, requestId = stateDesktopRequestId) {
  if (!runId || !requestId) return null
  try {
    const run = workflowRun(runId)
    if (!matchesWorkflowRunIdentity(run, candidateDesktopWorkflowIdentity(stateProductRevision, requestId))) return null
    const jobs = new Map((run.jobs || []).map(job => [job.name, job]))
    const required = BUILD_JOBS.map(name => jobs.get(name))
    if (run.status === 'completed') return required.every(job => job?.conclusion === 'success') ? run : null
    const failedBuild = required.some(job => job?.status === 'completed' && job?.conclusion !== 'success')
    return failedBuild ? null : run
  } catch {
    return null
  }
}

function requireDesktopBuildEvidence(runId, requestId = stateDesktopRequestId) {
  const run = reusableDesktopBuildRun(Number(runId || 0), requestId)
  const jobs = new Map((run?.jobs || []).map(job => [job.name, job]))
  if (!run || run.status !== 'completed' || run.conclusion !== 'success' || !BUILD_JOBS.every(name => jobs.get(name)?.conclusion === 'success')) {
    throw new Error('Checkpointed desktop phase lacks exact successful candidate build evidence.')
  }
  desktopBuildArtifacts(run.databaseId)
  return run
}

function requireSuccessfulWorkflowEvidence(runId, expected, label) {
  const run = reusableWorkflowRun(Number(runId || 0), expected)
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(`Checkpointed ${label} phase lacks exact successful workflow evidence.`)
  }
  return run
}

function workflowRunByExactIdentity(file, expected, label) {
  const candidate = selectUniqueWorkflowRunByDisplayTitle(workflowRuns(file), expected.displayTitle, label)
  if (!candidate) return null
  const exact = workflowRun(Number(candidate.databaseId))
  if (!matchesWorkflowRunIdentity(exact, expected)) throw new Error(`${label} request id resolved to mismatched workflow metadata.`)
  return exact
}

function candidateRunByRequestId(requestId) {
  return workflowRunByExactIdentity('release.yml', candidateDesktopWorkflowIdentity(stateProductRevision, requestId), 'Candidate')
}

async function waitForExactWorkflowDiscovery(file, expected, label) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60_000) {
    const run = workflowRunByExactIdentity(file, expected, label)
    if (run) return run
    await sleep()
  }
  throw new Error(`Previously dispatched ${label.toLowerCase()} ${expected.displayTitle} is not discoverable by its exact display title; refusing duplicate dispatch.`)
}

async function waitForDesktopBuildDiscovery(state, requestId) {
  const phaseState = state.phases['desktop-cloud-builds'] || {}
  if (phaseState.dispatchAttemptedAt) {
    const discoveryStarted = Date.now()
    while (Date.now() - discoveryStarted < 5 * 60_000) {
      const resumed = candidateRunByRequestId(requestId)
      if (resumed) return resumed
      await sleep()
    }
    await checkpoint(state, 'desktop-cloud-builds', {
      dispatchAttemptedAt: new Date().toISOString(),
      redispatchCount: Number(phaseState.redispatchCount || 0) + 1
    })
  } else {
    // The request id is fresh and unique: persist the write-ahead marker and
    // dispatch immediately rather than delaying the first attempt for discovery.
    await checkpoint(state, 'desktop-cloud-builds', { dispatchAttemptedAt: new Date().toISOString() })
  }
  const runId = await dispatchWorkflow('release.yml', [['tag', tag], ['source_revision', stateProductRevision]], 'main', requestId)
  const dispatched = workflowRun(runId)
  if (!matchesWorkflowRunIdentity(dispatched, candidateDesktopWorkflowIdentity(stateProductRevision, requestId))) {
    throw new Error('Dispatched desktop workflow identity does not match its persisted candidate request id.')
  }
  return dispatched
}

async function waitForRunCompletion(runId) {
  for (;;) {
    const run = ghJson(['run', 'view', String(runId), '--repo', repo, '--json', 'status,conclusion,url'])
    console.log(`Workflow ${runId}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}`)
    if (run.status === 'completed') return run
    await sleep()
  }
}

async function waitForRun(runId) {
  const run = await waitForRunCompletion(runId)
  if (run.conclusion !== 'success') throw new Error(`Workflow failed: ${run.url}`)
  return run
}

async function sleep() {
  await new Promise(resolve => setTimeout(resolve, pollSeconds * 1000))
}

async function reattachPreferredDraft(release) {
  const expectedBody = releaseNotesBody()
  const identity = {
    tag,
    productRevision: stateProductRevision,
    name: `Harness Desktop ${tag}`,
    body: expectedBody,
    expectedAssetNames: expectedDesktopNames()
  }
  if (!isExactDetachedDraft(release, identity)) {
    throw new Error('Recorded private draft is not an exact detachable recovery candidate.')
  }
  const claimants = releaseList().filter(candidate => candidate.tag_name === tag)
  if (claimants.length > 1 || (claimants.length === 1 && !canReattachPreferredDraft(release, claimants[0], identity))) {
    throw new Error('Immutable tag is not held by one safely removable empty private draft.')
  }
  if (claimants.length === 1) {
    ghRun(['api', '--method', 'DELETE', `repos/${repo}/releases/${claimants[0].id}`])
  }
  await mkdir(stateDir, { recursive: true })
  const payloadPath = path.join(stateDir, `${tag}-reattach-draft.json`)
  await writeFile(payloadPath, JSON.stringify({ tag_name: tag, body: expectedBody }), 'utf8')
  const repaired = ghJson(['api', '--method', 'PATCH', `repos/${repo}/releases/${release.id}`, '--input', payloadPath])
  const beforeNames = (release.assets || []).map(asset => asset.name).sort()
  const afterNames = (repaired?.assets || []).map(asset => asset.name).sort()
  if (
    repaired?.id !== release.id ||
    repaired.tag_name !== tag ||
    repaired.target_commitish !== stateProductRevision ||
    repaired.name !== `Harness Desktop ${tag}` ||
    repaired.body !== expectedBody ||
    repaired.draft !== true ||
    JSON.stringify(afterNames) !== JSON.stringify(beforeNames)
  ) {
    throw new Error('Private draft reattachment did not preserve its immutable identity and assets.')
  }
  return repaired
}

async function ensureExactDraft(preferredReleaseId = 0) {
  let release = preferredReleaseId > 0 ? releaseById(preferredReleaseId) : releaseForTag()
  const expectedBody = releaseNotesBody()
  if (release?.draft === true && release.tag_name !== tag) release = await reattachPreferredDraft(release)
  const expectedPrerelease = tag.includes('-')
  if (!release) {
    await mkdir(stateDir, { recursive: true })
    const payloadPath = path.join(stateDir, `${tag}-empty-draft.json`)
    const payload = {
      tag_name: tag,
      target_commitish: stateProductRevision,
      name: `Harness Desktop ${tag}`,
      body: expectedBody,
      draft: true,
      prerelease: expectedPrerelease
    }
    await writeFile(payloadPath, JSON.stringify(payload), 'utf8')
    release = ghJson(['api', '--method', 'POST', `repos/${repo}/releases`, '--input', payloadPath])
  }
  if (!release.draft) {
    assertReleaseAssets(release, expectedDesktopNames(), { draft: false, allowAdditional: true })
    return release
  }
  if (
    release.target_commitish !== stateProductRevision ||
    release.name !== `Harness Desktop ${tag}` ||
    Boolean(release.prerelease) !== expectedPrerelease ||
    normalizeReleaseBody(release.body) !== expectedBody
  ) {
    throw new Error('Existing private draft metadata does not exactly match the immutable product tag.')
  }
  const names = (release.assets || []).map(asset => asset.name).sort()
  const expected = expectedDesktopNames()
  if (!names.every(name => expected.includes(name))) throw new Error('Existing private draft has unexpected assets; refusing mutation.')
  if (release.body !== expectedBody) {
    await mkdir(stateDir, { recursive: true })
    const payloadPath = path.join(stateDir, `${tag}-normalized-draft.json`)
    await writeFile(payloadPath, JSON.stringify({ body: expectedBody }), 'utf8')
    const normalized = ghJson(['api', '--method', 'PATCH', `repos/${repo}/releases/${release.id}`, '--input', payloadPath])
    if (normalized?.id !== release.id || normalized.body !== expectedBody || normalized.draft !== true) {
      throw new Error('Private draft line-ending normalization did not preserve its immutable identity.')
    }
    release = normalized
  }
  return release
}

async function dispatchWorkflow(file, fields = [], ref = tag, persistedRequestId = '') {
  const requestId = persistedRequestId || `${tag}-${path.basename(file, path.extname(file))}-${randomUUID()}`
  const startedAt = Date.now()
  ghRun(['workflow', 'run', file, '--repo', repo, '--ref', ref, ...[...fields, ['request_id', requestId]].flatMap(([key, value]) => ['-f', `${key}=${value}`])])
  while (Date.now() - startedAt < 5 * 60 * 1000) {
    const matches = workflowRuns(file).filter(item => item.event === 'workflow_dispatch' && item.displayTitle?.includes(requestId))
    if (matches.length > 1) throw new Error(`Dispatched workflow identity is ambiguous for ${file} (${requestId}).`)
    if (matches.length === 1) return Number(matches[0].databaseId)
    await sleep()
  }
  throw new Error(`Unable to discover uniquely dispatched workflow ${file} (${requestId}).`)
}

function commitAndPush(files, message) {
  assertClean(files)
  gitRun(['add', '--', ...files])
  const staged = spawnSync(git, ['diff', '--cached', '--quiet', '--', ...files], { cwd: root, stdio: 'ignore', shell: false })
  if (staged.status === 1) gitRun(['commit', '-m', message, '--', ...files])
  else if (staged.status !== 0) throw new Error('Unable to inspect staged publication files.')
  gitRun(['push', 'origin', 'HEAD:main'])
  assertClean()
  return gitCapture(['rev-parse', 'HEAD']).toLowerCase()
}

async function desktopReleaseTrustedKeys() {
  const [componentSources, desktopSources] = await Promise.all([
    readFile(path.join(root, 'component-update-sources.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'release-update-sources.json'), 'utf8').then(JSON.parse)
  ])
  const componentKeys = componentSources.trustedKeys
  const desktopKeys = desktopSources.trustedKeys
  if (!componentKeys || typeof componentKeys !== 'object' || !desktopKeys || typeof desktopKeys !== 'object') {
    throw new Error('Component and desktop Ed25519 trust roots are required for the desktop release manifest.')
  }
  const componentEntries = Object.entries(componentKeys).sort(([left], [right]) => left.localeCompare(right, 'en'))
  const desktopEntries = Object.entries(desktopKeys).sort(([left], [right]) => left.localeCompare(right, 'en'))
  if (JSON.stringify(componentEntries) !== JSON.stringify(desktopEntries)) {
    throw new Error('release-update-sources.json trust root drifted from component-update-sources.json.')
  }
  return desktopKeys
}

async function preflightDesktopManifestTrust() {
  const trustedKeys = await desktopReleaseTrustedKeys()
  if (!trustedKeys['harness-components-02643f81164c594a']) {
    throw new Error('The protected CI signing key is not present in the embedded desktop trust root.')
  }
}

async function verifiedDesktopRelease(document) {
  const verified = validateAndVerifyDesktopReleaseManifest(document, await desktopReleaseTrustedKeys())
  if (verified.length !== 1 || verified[0].tag_name !== tag || verified[0].assets.length !== 18) {
    throw new Error('Signed release manifest is not the exact 18-asset final release.')
  }
  return verified[0]
}

async function readVerifiedDesktopRelease(file = path.join(root, 'release-manifest.json')) {
  return verifiedDesktopRelease(JSON.parse(await readFile(file, 'utf8')))
}

async function adoptCloudSignedManifest() {
  const branch = `release-manifest/${tag}`
  const remoteRef = `refs/remotes/origin/${branch}`
  gitRun(['fetch', '--force', 'origin', 'refs/heads/main:refs/remotes/origin/main', `refs/heads/${branch}:${remoteRef}`])
  const candidate = gitCapture(['rev-parse', remoteRef]).toLowerCase()
  const parents = gitCapture(['rev-list', '--parents', '-n', '1', candidate]).toLowerCase().split(/\s+/u)
  if (parents.length !== 2 || parents[1] !== stateProductRevision) {
    throw new Error('Cloud-signed release manifest commit is not a direct child of the immutable product tag.')
  }
  const changed = gitCapture(['diff-tree', '--no-commit-id', '--name-only', '-r', candidate]).split(/\r?\n/u).filter(Boolean)
  if (changed.length !== 1 || changed[0] !== 'release-manifest.json') {
    throw new Error('Cloud-signed release manifest commit contains unexpected files.')
  }
  const current = gitCapture(['rev-parse', 'HEAD']).toLowerCase()
  if (current === stateProductRevision) gitRun(['merge', '--ff-only', candidate])
  else if (current !== candidate) {
    const contains = spawnSync(git, ['merge-base', '--is-ancestor', candidate, current], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false })
    if (contains.status !== 0) {
      const descendsFromProduct = spawnSync(git, ['merge-base', '--is-ancestor', stateProductRevision, current], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false })
      const postTagChanges = gitCapture(['diff', '--name-only', `${stateProductRevision}..${current}`]).split(/\r?\n/u).filter(Boolean)
      if (descendsFromProduct.status !== 0 || postTagChanges.length === 0 || postTagChanges.some(file => !POST_TAG_PUBLISHER_FIX_FILES.has(file))) {
        throw new Error('Local release branch cannot safely adopt the cloud-signed manifest commit.')
      }
      gitRun(['cherry-pick', candidate])
    }
  }
  const release = await readVerifiedDesktopRelease()
  const checksum = release.assets.find(asset => asset.name === 'SHA256SUMS.txt')
  const response = await fetch(checksum.browser_download_url)
  if (!response.ok) throw new Error(`Unable to download public SHA256SUMS.txt: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== checksum.sha256) throw new Error('Public SHA256SUMS.txt digest mismatch.')
  await mkdir(path.join(root, 'dist'), { recursive: true })
  await writeFile(path.join(root, 'dist', 'SHA256SUMS.txt'), bytes)
  gitRun(['push', 'origin', 'HEAD:main'])
  assertClean()
  return { release, commit: candidate, branch }
}

async function verifyCloudAssetMirrorsBeforeStable() {
  const release = releaseForTag()
  assertReleaseAssets(release, expectedAllNames(), { draft: false })
  const manifest = await readVerifiedDesktopRelease()
  validateGithubReleaseAgainstManifest(manifest.assets, release.assets)
  const observations = []
  for (const asset of manifest.assets) {
    const mirrorUrl = asset.mirror_urls.find(url => String(url).startsWith('https://cnb.cool/'))
    if (!mirrorUrl) throw new Error(`CNB mirror URL missing before stable promotion: ${asset.name}`)
    const response = await fetch(mirrorUrl, { method: 'HEAD', redirect: 'follow' })
    const rawSize = response.headers.get('content-length')
    const size = rawSize && /^\d+$/u.test(rawSize) ? Number(rawSize) : Number.NaN
    observations.push({ name: asset.name, url: mirrorUrl, status: response.status, size })
  }
  const checksum = manifest.assets.find(asset => asset.name === 'SHA256SUMS.txt')
  const checksumObservation = observations.find(observation => observation.name === 'SHA256SUMS.txt')
  if (!checksum || !checksumObservation) throw new Error('Signed checksum asset missing before stable promotion.')
  const checksumResponse = await fetch(checksumObservation.url, { redirect: 'follow' })
  if (!checksumResponse.ok) throw new Error(`CNB checksum mirror HTTP failure before stable promotion: ${checksumResponse.status}`)
  const checksumBytes = Buffer.from(await checksumResponse.arrayBuffer())
  checksumObservation.sha256 = sha256(checksumBytes)
  validateCnbMirrorObservations(manifest.assets, observations)
  console.log(`Revalidated ${observations.length} exact GitHub/CNB release assets before stable promotion.`)
  return { assetCount: observations.length, revalidatedAt: new Date().toISOString() }
}

async function promoteStableFeeds() {
  const manifest = await readVerifiedDesktopRelease()
  const sources = JSON.parse(await readFile(path.join(root, 'component-update-sources.json'), 'utf8'))
  const { validateAndVerifyManifest } = require('../electron/bridge/component-update-contract.cjs')
  const files = []
  for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
    const name = `components-${version}-${target}.json`
    const asset = manifest.assets.find(item => item.name === name)
    if (!asset) throw new Error(`Missing component manifest asset: ${name}`)
    const response = await fetch(asset.browser_download_url)
    if (!response.ok) throw new Error(`Unable to download ${name}: ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (sha256(bytes) !== asset.sha256) throw new Error(`Component manifest digest mismatch: ${name}`)
    const document = JSON.parse(bytes.toString('utf8'))
    validateAndVerifyManifest(document, sources.trustedKeys)
    if (document.releaseVersion !== version || document.channel !== 'stable') throw new Error(`Component release identity mismatch: ${name}`)
    const file = `component-feeds/stable/${target}.json`
    await writeFile(path.join(root, file), bytes)
    files.push(file)
  }
  return files
}

async function finalRemoteCheck() {
  const release = releaseForTag()
  assertReleaseAssets(release, expectedAllNames(), { draft: false })
  const manifestUrls = [
    `https://raw.githubusercontent.com/${repo}/main/release-manifest.json`,
    `https://cnb.cool/${repo}/-/git/raw/main/release-manifest.json`
  ]
  const manifestResponses = await Promise.all(manifestUrls.map(url => fetch(url)))
  if (manifestResponses.some(response => !response.ok)) throw new Error('Signed desktop release manifest HTTP failure.')
  const manifestBytes = await Promise.all(manifestResponses.map(async response => Buffer.from(await response.arrayBuffer())))
  if (!manifestBytes[0].equals(manifestBytes[1])) throw new Error('GitHub/CNB signed desktop release manifest mismatch.')
  const desktopManifest = await verifiedDesktopRelease(JSON.parse(manifestBytes[0].toString('utf8')))
  const checksumAsset = desktopManifest.assets.find(asset => asset.name === 'SHA256SUMS.txt')
  const legacyChecksumUrl = `https://cnb.cool/${repo}/-/git/raw/main/SHA256SUMS.txt`
  const legacyChecksumResponse = await fetch(legacyChecksumUrl)
  if (!legacyChecksumResponse.ok) throw new Error('Legacy desktop checksum mirror HTTP failure.')
  const legacyChecksumBytes = Buffer.from(await legacyChecksumResponse.arrayBuffer())
  if (sha256(legacyChecksumBytes) !== checksumAsset.sha256) throw new Error('Legacy desktop checksum mirror digest mismatch.')
  for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
    const github = `https://raw.githubusercontent.com/${repo}/main/component-feeds/stable/${target}.json`
    const cnb = `https://cnb.cool/${repo}/-/git/raw/main/component-feeds/stable/${target}.json`
    const [githubResponse, cnbResponse] = await Promise.all([fetchWithTimeout(github), fetchWithTimeout(cnb)])
    if (!githubResponse.ok || !cnbResponse.ok) throw new Error(`Stable feed HTTP failure: ${target}`)
    const [githubBytes, cnbBytes] = await Promise.all([githubResponse.arrayBuffer(), cnbResponse.arrayBuffer()])
    if (!Buffer.from(githubBytes).equals(Buffer.from(cnbBytes))) throw new Error(`GitHub/CNB stable feed mismatch: ${target}`)
  }
  assertClean()
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function acquirePublicationLock() {
  await mkdir(stateDir, { recursive: true })
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
      if (!stale) throw new Error(`Another publisher owns ${lockFile} (pid ${owner?.pid || 'unknown'} on ${owner?.host || 'unknown'}).`)
      await rm(lockFile, { force: true })
    }
  }
  throw new Error(`Unable to acquire publication lock: ${lockFile}`)
}

let stateProductRevision = ''
let stateDesktopRequestId = ''

function revisionHasVersion(revision) {
  try { return JSON.parse(gitCapture(['show', `${revision}:package.json`])).version === version } catch { return false }
}

function revisionFastForwards(fromRevision, toRevision) {
  return spawnSync(git, ['merge-base', '--is-ancestor', fromRevision, toRevision], { cwd: root, env: gitEnvironment(), stdio: 'ignore', shell: false }).status === 0
}

async function candidateSideEffects() {
  const githubReleaseExists = releaseList().some(release => release?.tag_name === tag || release?.name === `Harness Desktop ${tag}`)
  const cnbStatuses = await Promise.all(expectedAllNames().map(async name => {
    const encoded = encodeURIComponent(name)
    const response = await fetch(`https://cnb.cool/${repo}/-/releases/download/${tag}/${encoded}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000)
    })
    return response.status
  })).catch(error => { throw new Error(`Unable to prove CNB asset absence before candidate mutation: ${error?.message || error}`) })
  const cnbReleaseExists = classifyCnbAssetStatuses(cnbStatuses)
  let stablePromoted = false
  for (const host of [`https://raw.githubusercontent.com/${repo}/main`, `https://cnb.cool/${repo}/-/git/raw/main`]) {
    for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
      const response = await fetchWithTimeout(`${host}/component-feeds/stable/${target}.json`)
      if (!response.ok) throw new Error(`Unable to prove stable feed absence before candidate rebind: ${host}/${target}`)
      const feed = await response.json()
      if (feed?.releaseVersion === version) stablePromoted = true
    }
  }
  return { githubReleaseExists, cnbReleaseExists, stablePromoted }
}

async function rebindCandidateRevision(state, currentHead) {
  const previous = String(state.sourceRevision || '').toLowerCase()
  if (!previous || previous === currentHead) return false
  const phaseState = state.phases?.['desktop-cloud-builds'] || {}
  const oldRequestId = String(phaseState.requestId || '')
  let oldRunTerminal = false
  if (phaseState.runId && oldRequestId) {
    const oldRun = workflowRun(Number(phaseState.runId))
    oldRunTerminal = matchesWorkflowRunIdentity(oldRun, candidateDesktopWorkflowIdentity(previous, oldRequestId)) && oldRun.status === 'completed'
  } else {
    const possibleRuns = workflowRuns('release.yml').filter(run => (
      run.event === 'workflow_dispatch' && run.headBranch === 'main' && String(run.headSha || '').toLowerCase() === previous
    ))
    const expected = oldRequestId ? candidateDesktopWorkflowIdentity(previous, oldRequestId) : null
    const exactCandidate = expected ? possibleRuns.find(run => run.displayTitle === expected.displayTitle) : null
    if (exactCandidate) {
      const exact = workflowRun(Number(exactCandidate.databaseId))
      oldRunTerminal = matchesWorkflowRunIdentity(exact, expected) && exact.status === 'completed'
    } else {
      oldRunTerminal = possibleRuns.length === 0 && !phaseState.dispatchAttemptedAt
    }
  }
  const sideEffects = await candidateSideEffects()
  assertCandidateRebindAllowed(state, {
    localTagExists: Boolean(localTagRevision()),
    remoteTagExists: Boolean(remoteTagRevision()),
    ...sideEffects,
    oldRunTerminal,
    sameVersion: revisionHasVersion(previous) && revisionHasVersion(currentHead),
    fastForward: revisionFastForwards(previous, currentHead)
  })
  state.candidateAttempts ||= []
  state.candidateAttempts.push({
    sourceRevision: previous,
    invalidatedAt: new Date().toISOString(),
    desktopRunId: Number(phaseState.runId || 0) || null,
    desktopConclusion: phaseState.sourceRunConclusion || phaseState.conclusion || null,
    phases: structuredClone(state.phases || {})
  })
  state.sourceRevision = currentHead
  state.productRevision = ''
  state.phases = {}
  await saveState(state)
  console.log(`Safely rebound unpublished ${tag} candidate from ${previous} to ${currentHead}.`)
  return true
}

function requireExistingTagCandidateEvidence(state, tagRevision, evidence) {
  const desktop = state.phases?.['desktop-cloud-builds']
  if (
    state.sourceRevision !== tagRevision ||
    state.phases?.[LOCAL_GATE_PHASE]?.status !== 'completed' ||
    desktop?.status !== 'completed' ||
    !desktop.requestId ||
    !desktop.runId
  ) throw new Error(`Existing ${tag} lacks completed pre-Tag candidate evidence.`)
  assertExistingTagRecoveryAllowed(state, { ...evidence, tagRevision })
  stateProductRevision = tagRevision
  stateDesktopRequestId = String(desktop.requestId)
  requireDesktopBuildEvidence(desktop.runId, stateDesktopRequestId)
}

async function publish() {
  assertVersion()
  await preflightDesktopManifestTrust()
  const state = await readState()
  if (state.version !== version || state.tag !== tag || state.repo !== repo) throw new Error('Publication state identity mismatch.')
  await normalizePackagingState(state)
  const currentHead = gitCapture(['rev-parse', 'HEAD']).toLowerCase()
  const publishedTagRevision = remoteTagRevision()
  const unpublishedLocalTagRevision = localTagRevision()
  if (publishedTagRevision && unpublishedLocalTagRevision && publishedTagRevision !== unpublishedLocalTagRevision) {
    throw new Error(`${tag} local and remote refs disagree; refusing recovery.`)
  }
  if (state.productRevision && publishedTagRevision && state.productRevision !== publishedTagRevision) {
    throw new Error(`${tag} moved after publication state was recorded; refusing to continue.`)
  }
  const observedTagRevision = publishedTagRevision || unpublishedLocalTagRevision
  if (!state.productRevision && observedTagRevision) {
    requireExistingTagCandidateEvidence(state, observedTagRevision, {
      localTagExists: Boolean(unpublishedLocalTagRevision),
      remoteTagExists: Boolean(publishedTagRevision)
    })
    state.productRevision = observedTagRevision
    await saveState(state)
  }
  if (!observedTagRevision) {
    if (!state.sourceRevision) { state.sourceRevision = currentHead; await saveState(state) }
    await rebindCandidateRevision(state, currentHead)
  }
  stateProductRevision = state.productRevision || observedTagRevision || state.sourceRevision
  stateDesktopRequestId = String(state.phases?.['desktop-cloud-builds']?.requestId || stateDesktopRequestId)
  if (!/^[0-9a-f]{40}$/u.test(stateProductRevision)) throw new Error('Unable to resolve exact candidate source revision.')

  await phase(state, LOCAL_GATE_PHASE, async () => {
    assertClean()
    const localDist = path.join(root, 'dist')
    rmSync(localDist, { recursive: true, force: true })
    ghRun(['auth', 'status'])
    npmRun(['run', 'release:orchestrate', '--', 'run', '--version', version, '--through', 'verify'], { timeout: 30 * 60 * 1000 })
    if (existsSync(localDist)) throw new Error('Cloud-only packaging forbids local release artifacts during publisher source gates.')
    return { packagingMode: PACKAGING_MODE, completedThrough: 'verify', sourceRevision: state.sourceRevision }
  })

  const desktopPhase = await phase(state, 'desktop-cloud-builds', async () => {
    assertClean()
    if (localTagRevision() || remoteTagRevision()) throw new Error('Candidate cloud build must start before any product Tag exists.')
    const { head, remoteMain } = assertMainFastForward()
    if (head !== state.sourceRevision) throw new Error('Candidate source revision changed after local gates.')
    if (remoteMain !== head) gitRun(['push', 'origin', 'HEAD:main'])
    let requestId = String(state.phases['desktop-cloud-builds']?.requestId || '')
    if (!requestId) {
      requestId = `${tag}-desktop-${randomUUID()}`
      await checkpoint(state, 'desktop-cloud-builds', { requestId, dispatchAttemptedAt: null, sourceRevision: state.sourceRevision })
    }
    stateDesktopRequestId = requestId
    const stored = reusableDesktopBuildRun(Number(state.phases['desktop-cloud-builds']?.runId || 0), requestId)
    const run = stored || await waitForDesktopBuildDiscovery(state, requestId)
    await checkpoint(state, 'desktop-cloud-builds', { requestId, runId: Number(run.databaseId), url: run.url, sourceRevision: state.sourceRevision })
    await waitForSuccessfulJobs(run.databaseId, BUILD_JOBS)
    const completed = await waitForRun(run.databaseId)
    const artifacts = desktopBuildArtifacts(run.databaseId)
    return { requestId, runId: Number(run.databaseId), url: completed.url || run.url, conclusion: completed.conclusion, artifactIds: artifacts.map(artifact => Number(artifact.id)) }
  }, {
    validateCompleted: completed => { stateDesktopRequestId = String(completed.requestId || ''); requireDesktopBuildEvidence(completed.runId, stateDesktopRequestId) }
  })
  const desktopRunId = Number(desktopPhase.runId || state.phases['desktop-cloud-builds']?.runId)

  await phase(state, 'immutable-tag', async () => {
    assertClean()
    requireDesktopBuildEvidence(desktopRunId)
    const sideEffects = await candidateSideEffects()
    if (sideEffects.githubReleaseExists || sideEffects.cnbReleaseExists || sideEffects.stablePromoted) throw new Error('Publication side effect exists before immutable Tag creation.')
    gitRun(['fetch', 'origin', 'main', '--tags'])
    const remoteMain = gitCapture(['rev-parse', 'origin/main']).toLowerCase()
    if (!revisionFastForwards(state.sourceRevision, remoteMain)) throw new Error('Validated candidate is no longer contained in origin/main.')
    const existing = remoteTagRevision(), local = localTagRevision()
    if (existing && existing !== state.sourceRevision) throw new Error(`${tag} already points elsewhere; the immutable tag cannot move.`)
    if (local && local !== state.sourceRevision) throw new Error(`Local ${tag} points elsewhere; refusing to overwrite it.`)
    if (existing || local) {
      assertExistingTagRecoveryAllowed(state, {
        tagRevision: existing || local,
        localTagExists: Boolean(local),
        remoteTagExists: Boolean(existing)
      })
    }
    if (!local) {
      await checkpoint(state, 'immutable-tag', { tagAuthorization: {
        operation: 'create-local',
        sourceRevision: state.sourceRevision,
        requestId: stateDesktopRequestId,
        runId: desktopRunId,
        authorizedAt: new Date().toISOString()
      } })
      gitRun(['tag', '-a', tag, '-m', `Harness Desktop ${version}`, state.sourceRevision])
    }
    if (!existing) {
      await checkpoint(state, 'immutable-tag', { tagAuthorization: {
        operation: 'push-remote',
        sourceRevision: state.sourceRevision,
        requestId: stateDesktopRequestId,
        runId: desktopRunId,
        authorizedAt: new Date().toISOString()
      } })
      gitRun(['push', 'origin', `refs/tags/${tag}`])
    }
    state.productRevision = state.sourceRevision
    stateProductRevision = state.sourceRevision
    await saveState(state)
    return { productRevision: state.sourceRevision, desktopRunId }
  }, {
    validateCompleted: completed => {
      requireDesktopBuildEvidence(completed.desktopRunId || desktopRunId)
      const remote = remoteTagRevision()
      if (!remote || remote !== state.productRevision) throw new Error('Immutable Tag evidence no longer matches the validated cloud build revision.')
    }
  })

  stateProductRevision = state.productRevision || remoteTagRevision()
  if (!/^[0-9a-f]{40}$/u.test(stateProductRevision)) throw new Error('Unable to resolve immutable product revision.')

  await phase(state, 'desktop-publication', async () => {
    const sourceRun = requireDesktopBuildEvidence(desktopRunId)
    await checkpoint(state, 'desktop-publication', { sourceRunId: desktopRunId, sourceRunConclusion: sourceRun.conclusion })
    let release = await ensureExactDraft(Number(state.phases['desktop-publication']?.releaseId || 0))
    if (!release.draft) return { releaseId: release.id, sourceRunId: desktopRunId, sourceRequestId: stateDesktopRequestId, recoveryRunId: null, url: release.html_url }
    const recoveryPhase = state.phases['desktop-publication'] || {}
    const recoverySource = publishPostTagRecoveryFix()
    const expectedRecoveryHeadSha = recoverySource.headSha
    const expectedRecoveryHeadBranch = recoverySource.headBranch
    let recoveryRequestId = String(recoveryPhase.recoveryRequestId || '')
    let storedRecoveryRunId = Number(recoveryPhase.recoveryRunId || 0)
    let recoveryDispatchAttemptedAt = recoveryPhase.recoveryDispatchAttemptedAt
    const checkpointedRecoveryHeadSha = String(recoveryPhase.recoveryHeadSha || '').toLowerCase()
    const checkpointedRecoveryHeadBranch = String(recoveryPhase.recoveryHeadBranch || '')
    if (recoveryRequestId && (checkpointedRecoveryHeadSha !== expectedRecoveryHeadSha || checkpointedRecoveryHeadBranch !== expectedRecoveryHeadBranch)) {
      const previousDisplayTitle = `Recover ${tag} from run ${desktopRunId} release ${release.id} · ${recoveryRequestId}`
      const previousCandidate = storedRecoveryRunId
        ? { databaseId: storedRecoveryRunId }
        : selectUniqueWorkflowRunByDisplayTitle(workflowRuns('recover-release-from-actions.yml'), previousDisplayTitle, 'Previous recovery')
      const previousRecovery = previousCandidate ? workflowRun(Number(previousCandidate.databaseId)) : null
      const previousRecoveryIdentity = previousRecovery ? {
        ...recoveryCheckpointWorkflowIdentity({ recoveryHeadSha: previousRecovery.headSha, recoveryHeadBranch: previousRecovery.headBranch }),
        displayTitle: previousDisplayTitle
      } : null
      if (!previousRecovery || !matchesWorkflowRunIdentity(previousRecovery, previousRecoveryIdentity) || previousRecovery.status !== 'completed' || previousRecovery.conclusion === 'success') {
        throw new Error('A recovery source revision changed before its exact prior run reached a terminal non-success state; refusing ambiguous redispatch.')
      }
      const recoveryAttempts = [
        ...(Array.isArray(recoveryPhase.recoveryAttempts) ? recoveryPhase.recoveryAttempts.slice(-15) : []),
        {
          requestId: recoveryRequestId,
          runId: Number(previousRecovery.databaseId),
          headSha: previousRecovery.headSha,
          headBranch: previousRecovery.headBranch,
          conclusion: previousRecovery.conclusion,
          invalidatedAt: new Date().toISOString()
        }
      ]
      await checkpoint(state, 'desktop-publication', {
        recoveryAttempts,
        recoveryRequestId: null,
        recoveryRunId: null,
        recoveryDispatchAttemptedAt: null,
        recoveryHeadSha: null,
        recoveryHeadBranch: null
      })
      recoveryRequestId = ''
      storedRecoveryRunId = 0
      recoveryDispatchAttemptedAt = null
    }
    if (!recoveryRequestId) recoveryRequestId = `${tag}-recovery-${randomUUID()}`
    const expectedRecoveryIdentity = {
      ...WORKFLOWS.recovery,
      headSha: expectedRecoveryHeadSha,
      headBranch: expectedRecoveryHeadBranch,
      displayTitle: `Recover ${tag} from run ${desktopRunId} release ${release.id} · ${recoveryRequestId}`
    }
    const storedRecovery = reusableWorkflowRun(storedRecoveryRunId, expectedRecoveryIdentity)
    await checkpoint(state, 'desktop-publication', {
      releaseId: release.id,
      sourceRunId: desktopRunId,
      sourceRequestId: stateDesktopRequestId,
      recoveryRequestId,
      recoveryHeadSha: expectedRecoveryHeadSha,
      recoveryHeadBranch: expectedRecoveryHeadBranch
    })
    let discoveredRecovery = storedRecovery || workflowRunByExactIdentity('recover-release-from-actions.yml', expectedRecoveryIdentity, 'Recovery')
    if (!discoveredRecovery && recoveryDispatchAttemptedAt) {
      discoveredRecovery = await waitForExactWorkflowDiscovery('recover-release-from-actions.yml', expectedRecoveryIdentity, 'Recovery')
    }
    if (discoveredRecovery?.status === 'completed' && discoveredRecovery.conclusion !== 'success') {
      throw new Error(`Checkpointed recovery request ${recoveryRequestId} already failed; refusing duplicate dispatch.`)
    }
    const reusableRecovery = discoveredRecovery && reusableWorkflowRun(discoveredRecovery.databaseId, expectedRecoveryIdentity)
    let recoveryRunId = Number(reusableRecovery?.databaseId || 0)
    if (!recoveryRunId) {
      await checkpoint(state, 'desktop-publication', { recoveryDispatchAttemptedAt: new Date().toISOString() })
      recoveryRunId = await dispatchWorkflow('recover-release-from-actions.yml', [
        ['tag', tag],
        ['source_run_id', desktopRunId],
        ['source_request_id', stateDesktopRequestId],
        ['release_id', release.id],
        ...recoverySource.fields
      ], recoverySource.ref, recoveryRequestId)
    }
    const dispatchedRecovery = reusableRecovery || reusableWorkflowRun(recoveryRunId, expectedRecoveryIdentity)
    if (!dispatchedRecovery) throw new Error('Recovery workflow identity or same-run artifact binding does not match its checkpoint.')
    await checkpoint(state, 'desktop-publication', {
      releaseId: release.id,
      sourceRunId: desktopRunId,
      sourceRequestId: stateDesktopRequestId,
      recoveryRequestId,
      recoveryRunId,
      recoveryHeadSha: expectedRecoveryHeadSha,
      recoveryHeadBranch: expectedRecoveryHeadBranch
    })
    await waitForRun(recoveryRunId)
    release = releaseForTag()
    assertReleaseAssets(release, expectedDesktopNames(), { draft: false, allowAdditional: true })
    return { releaseId: release.id, sourceRunId: desktopRunId, sourceRequestId: stateDesktopRequestId, recoveryRequestId, recoveryRunId, recoveryHeadSha: expectedRecoveryHeadSha, recoveryHeadBranch: expectedRecoveryHeadBranch, url: release.html_url }
  }, {
    validateCompleted: completed => {
      stateDesktopRequestId = String(completed.sourceRequestId || state.phases['desktop-cloud-builds']?.requestId || '')
      requireDesktopBuildEvidence(completed.sourceRunId || desktopRunId, stateDesktopRequestId)
      assertReleaseAssets(releaseForTag(), expectedDesktopNames(), { draft: false, allowAdditional: true })
      if (completed.recoveryRunId) requireSuccessfulWorkflowEvidence(completed.recoveryRunId, {
        ...recoveryCheckpointWorkflowIdentity(completed),
        displayTitle: `Recover ${tag} from run ${completed.sourceRunId || desktopRunId} release ${completed.releaseId} · ${completed.recoveryRequestId}`
      }, 'desktop recovery')
    }
  })

  await phase(state, 'signed-android', async () => {
    const expectedIdentity = productWorkflowIdentity(WORKFLOWS.android)
    const stored = reusableWorkflowRun(Number(state.phases['signed-android']?.runId || 0), expectedIdentity)
    const discoverable = { workflowName: WORKFLOWS.android.workflowName, events: WORKFLOWS.android.events, headSha: stateProductRevision, headBranch: tag }
    const discovered = stored || await waitForRunDiscovery(
      'android-mobile-release.yml',
      run => matchesWorkflowRunIdentity(run, discoverable) && !(run.status === 'completed' && run.conclusion !== 'success'),
      () => dispatchWorkflow('android-mobile-release.yml', [['tag', tag]])
    )
    const run = stored || reusableWorkflowRun(Number(discovered.databaseId), expectedIdentity)
    if (!run) throw new Error('Signed Android workflow identity does not match the immutable product tag.')
    await checkpoint(state, 'signed-android', { runId: Number(run.databaseId), url: run.url })
    await waitForRun(run.databaseId)
    const release = releaseForTag()
    assertReleaseAssets(release, [...expectedDesktopNames(), ...expectedAndroidNames()], { draft: false, allowAdditional: true })
    return { runId: Number(run.databaseId), url: run.url }
  }, {
    validateCompleted: completed => {
      requireSuccessfulWorkflowEvidence(completed.runId, productWorkflowIdentity(WORKFLOWS.android), 'Android signing')
      assertReleaseAssets(releaseForTag(), [...expectedDesktopNames(), ...expectedAndroidNames()], { draft: false, allowAdditional: true })
    }
  })

  await phase(state, 'signed-components', async () => {
    const expectedIdentity = productWorkflowIdentity(WORKFLOWS.components)
    const stored = reusableWorkflowRun(Number(state.phases['signed-components']?.runId || 0), expectedIdentity)
    const runId = Number(stored?.databaseId || 0) || await dispatchWorkflow('publish-production-components.yml', [['tag', tag], ['product_revision', stateProductRevision]])
    const run = stored || reusableWorkflowRun(runId, expectedIdentity)
    if (!run) throw new Error('Signed component workflow identity does not match the immutable product tag.')
    await checkpoint(state, 'signed-components', { runId, url: run.url })
    await waitForRun(runId)
    const release = releaseForTag()
    assertReleaseAssets(release, expectedAllNames(), { draft: false })
    return { runId, url: run.url }
  }, {
    validateCompleted: completed => {
      requireSuccessfulWorkflowEvidence(completed.runId, productWorkflowIdentity(WORKFLOWS.components), 'component signing')
      assertReleaseAssets(releaseForTag(), expectedAllNames(), { draft: false })
    }
  })

  await phase(state, 'release-manifest', async () => {
    const adopted = await adoptCloudSignedManifest()
    return { commit: adopted.commit, branch: adopted.branch }
  })

  await phase(state, 'cnb-assets', async () => {
    await readVerifiedDesktopRelease()
    npmRun(['run', 'release:cnb-cloud'], { timeout: 30 * 60 * 1000, env: releaseEnvironment() })
  })

  await phase(state, 'stable-components', async () => {
    const mirror = await verifyCloudAssetMirrorsBeforeStable()
    const files = await promoteStableFeeds()
    const commit = commitAndPush(files, `release: promote ${tag} stable components`)
    return { commit, ...mirror }
  })

  await phase(state, 'cnb-stable', async () => {
    npmRun(['run', 'release:cnb-cloud', '--', '-StableOnly'], { timeout: 10 * 60 * 1000, env: releaseEnvironment() })
  })

  await phase(state, 'complete', async () => {
    await finalRemoteCheck()
    return { releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`, mirrorUrl: `https://cnb.cool/${repo}/-/releases/tag/${tag}` }
  })

  console.log(JSON.stringify({ ok: true, stateFile, tag, productRevision: stateProductRevision, packagingMode: PACKAGING_MODE, phases: PHASES, releaseUrl: state.phases.complete.releaseUrl, mirrorUrl: state.phases.complete.mirrorUrl }, null, 2))
}

if (command === 'run' || command === 'resume') {
  const releaseLock = await acquirePublicationLock()
  try { await publish() } finally { await releaseLock() }
} else if (command === 'status') {
  console.log(JSON.stringify(await readState(), null, 2))
} else if (command === 'plan') {
  console.log(JSON.stringify({
    command: `npm run release:publish -- run --version ${version}`,
    version,
    tag,
    repo,
    stateFile,
    packagingMode: PACKAGING_MODE,
    phases: PHASES,
    guarantees: [
      'clean committed source',
      'local source gates without local release packaging',
      'all release packages built and tested by GitHub Actions before tagging',
      'immutable tag only after exact successful cloud evidence',
      'cloud-only same-run release artifact transfer',
      'signed Android',
      'signed components',
      'exact 18-asset manifest',
      'GitHub-to-CNB cloud mirror',
      'stable feeds last'
    ]
  }, null, 2))
} else {
  throw new Error('Usage: node scripts/release-publish.mjs plan|status|run|resume [--version x.y.z] [--repo owner/name] [--poll-seconds 15]')
}
