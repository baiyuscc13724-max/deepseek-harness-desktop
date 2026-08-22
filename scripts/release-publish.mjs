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
const { canReattachPreferredDraft, isExactDetachedDraft, normalizeReleaseBody, selectReleaseForTag } = require('./release-publish-selection.cjs')
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
const PHASES = [
  'local-windows',
  'immutable-tag',
  'desktop-cloud-builds',
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
  'Validate iPhone and iPad simulators'
]
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
      schemaVersion: 1,
      version,
      tag,
      repo,
      sourceRevision: '',
      productRevision: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      phases: {}
    }
  }
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

async function phase(state, id, work) {
  if (state.phases[id]?.status === 'completed') {
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
  if (current === stateProductRevision) return { ref: tag, fields: [] }
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
  return { ref: 'main', fields: [['publisher_revision', current]] }
}

function localTagRevision() {
  const exists = spawnSync(git, ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: root, stdio: 'ignore', shell: false })
  return exists.status === 0 ? gitCapture(['rev-list', '-n', '1', `refs/tags/${tag}`]).toLowerCase() : ''
}

function remoteTagRevision() {
  const rows = gitCapture(['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).split(/\r?\n/u).filter(Boolean)
  const peeled = rows.find(row => row.endsWith(`refs/tags/${tag}^{}`))
  const direct = rows.find(row => row.endsWith(`refs/tags/${tag}`))
  if (!peeled && !direct) return ''
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
  return ghJson(['run', 'view', String(runId), '--repo', repo, '--json', 'databaseId,displayTitle,workflowName,status,conclusion,event,headBranch,headSha,createdAt,url'])
}

function reusableWorkflowRun(runId) {
  if (!runId) return null
  try {
    const run = workflowRun(runId)
    return run.status === 'completed' && run.conclusion !== 'success' ? null : run
  } catch {
    return null
  }
}

function reusableDesktopBuildRun(runId) {
  if (!runId) return null
  try {
    const run = ghJson(['run', 'view', String(runId), '--repo', repo, '--json', 'databaseId,displayTitle,workflowName,status,conclusion,event,headBranch,headSha,createdAt,url,jobs'])
    const jobs = new Map((run.jobs || []).map(job => [job.name, job]))
    const required = BUILD_JOBS.map(name => jobs.get(name))
    if (run.status === 'completed') return required.every(job => job?.conclusion === 'success') ? run : null
    const failedBuild = required.some(job => job?.status === 'completed' && job?.conclusion !== 'success')
    return failedBuild ? null : run
  } catch {
    return null
  }
}

async function waitForDesktopBuildDiscovery() {
  const discoveryStarted = Date.now()
  while (Date.now() - discoveryStarted < 60_000) {
    const candidates = workflowRuns('release.yml')
      .filter(run => run.headSha === stateProductRevision && run.headBranch === tag)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    for (const candidate of candidates) {
      const reusable = reusableDesktopBuildRun(Number(candidate.databaseId))
      if (reusable) return reusable
    }
    await sleep()
  }
  const runId = await dispatchWorkflow('release.yml', [['tag', tag]])
  return workflowRun(runId)
}

async function waitForRun(runId) {
  for (;;) {
    const run = ghJson(['run', 'view', String(runId), '--repo', repo, '--json', 'status,conclusion,url'])
    console.log(`Workflow ${runId}: ${run.status}${run.conclusion ? `/${run.conclusion}` : ''}`)
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Workflow failed: ${run.url}`)
      return run
    }
    await sleep()
  }
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

async function dispatchWorkflow(file, fields = [], ref = tag) {
  const requestId = `${tag}-${path.basename(file, path.extname(file))}-${randomUUID()}`
  const startedAt = Date.now()
  ghRun(['workflow', 'run', file, '--repo', repo, '--ref', ref, ...[...fields, ['request_id', requestId]].flatMap(([key, value]) => ['-f', `${key}=${value}`])])
  while (Date.now() - startedAt < 3 * 60 * 1000) {
    const run = workflowRuns(file).find(item => item.event === 'workflow_dispatch' && item.displayTitle?.includes(requestId))
    if (run) return Number(run.databaseId)
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
  await verifiedDesktopRelease(JSON.parse(manifestBytes[0].toString('utf8')))
  for (const target of ['win32-x64', 'darwin-x64', 'darwin-arm64']) {
    const github = `https://raw.githubusercontent.com/${repo}/main/component-feeds/stable/${target}.json`
    const cnb = `https://cnb.cool/${repo}/-/git/raw/main/component-feeds/stable/${target}.json`
    const [githubResponse, cnbResponse] = await Promise.all([fetch(github), fetch(cnb)])
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

async function publish() {
  assertVersion()
  await preflightDesktopManifestTrust()
  const state = await readState()
  if (state.version !== version || state.tag !== tag || state.repo !== repo) throw new Error('Publication state identity mismatch.')
  const currentHead = gitCapture(['rev-parse', 'HEAD']).toLowerCase()
  const publishedTagRevision = remoteTagRevision()
  if (state.productRevision && publishedTagRevision && state.productRevision !== publishedTagRevision) {
    throw new Error(`${tag} moved after publication state was recorded; refusing to continue.`)
  }
  if (!state.productRevision && !publishedTagRevision && state.sourceRevision !== currentHead) {
    if (Object.keys(state.phases || {}).length > 0) console.log(`Source revision changed before tagging; invalidating publication phases.`)
    state.sourceRevision = currentHead
    state.phases = {}
    await saveState(state)
  }
  if (!state.productRevision && publishedTagRevision) {
    state.productRevision = publishedTagRevision
    state.sourceRevision ||= publishedTagRevision
    await saveState(state)
  }
  stateProductRevision = state.productRevision || publishedTagRevision

  await phase(state, 'local-windows', async () => {
    assertClean()
    ghRun(['auth', 'status'])
    npmRun(['run', 'release:orchestrate', '--', 'run', '--version', version, '--through', 'windows'], { timeout: 75 * 60 * 1000 })
  })

  await phase(state, 'immutable-tag', async () => {
    assertClean()
    const { head } = assertMainFastForward()
    const existing = remoteTagRevision()
    const local = localTagRevision()
    if (existing && existing !== head) throw new Error(`${tag} already points to ${existing}; bump the version instead of moving the tag.`)
    if (local && local !== head) throw new Error(`Local ${tag} points to ${local}; delete only the unpublished local tag or bump the version.`)
    gitRun(['push', 'origin', 'HEAD:main'])
    if (!local) gitRun(['tag', '-a', tag, '-m', `Harness Desktop ${version}`, head])
    if (!existing) gitRun(['push', 'origin', `refs/tags/${tag}`])
    state.productRevision = head
    stateProductRevision = head
    await saveState(state)
    return { productRevision: head }
  })

  stateProductRevision = state.productRevision || remoteTagRevision()
  if (!/^[0-9a-f]{40}$/u.test(stateProductRevision)) throw new Error('Unable to resolve immutable product revision.')

  const desktopPhase = await phase(state, 'desktop-cloud-builds', async () => {
    const stored = reusableDesktopBuildRun(Number(state.phases['desktop-cloud-builds']?.runId || 0))
    const run = stored || await waitForDesktopBuildDiscovery()
    await checkpoint(state, 'desktop-cloud-builds', { runId: Number(run.databaseId), url: run.url })
    await waitForSuccessfulJobs(run.databaseId, BUILD_JOBS)
    return { runId: Number(run.databaseId), url: run.url }
  })
  const desktopRunId = Number(desktopPhase.runId || state.phases['desktop-cloud-builds']?.runId)

  await phase(state, 'desktop-publication', async () => {
    let release = await ensureExactDraft(Number(state.phases['desktop-publication']?.releaseId || 0))
    if (!release.draft) return { releaseId: release.id, url: release.html_url }
    const storedRecovery = reusableWorkflowRun(Number(state.phases['desktop-publication']?.recoveryRunId || 0))
    const recoverySource = storedRecovery ? null : publishPostTagRecoveryFix()
    const recoveryRunId = storedRecovery?.databaseId || await dispatchWorkflow('recover-release-from-actions.yml', [
      ['tag', tag],
      ['source_run_id', desktopRunId],
      ['release_id', release.id],
      ...recoverySource.fields
    ], recoverySource.ref)
    await checkpoint(state, 'desktop-publication', { releaseId: release.id, recoveryRunId })
    await waitForRun(recoveryRunId)
    release = releaseForTag()
    assertReleaseAssets(release, expectedDesktopNames(), { draft: false, allowAdditional: true })
    return { releaseId: release.id, recoveryRunId, url: release.html_url }
  })

  await phase(state, 'signed-android', async () => {
    const stored = reusableWorkflowRun(Number(state.phases['signed-android']?.runId || 0))
    const predicate = run => run.headSha === stateProductRevision && run.headBranch === tag && !(run.status === 'completed' && run.conclusion !== 'success')
    const run = stored || await waitForRunDiscovery('android-mobile-release.yml', predicate, () => dispatchWorkflow('android-mobile-release.yml', [['tag', tag]]))
    await checkpoint(state, 'signed-android', { runId: Number(run.databaseId), url: run.url })
    await waitForRun(run.databaseId)
    const release = releaseForTag()
    assertReleaseAssets(release, [...expectedDesktopNames(), ...expectedAndroidNames()], { draft: false, allowAdditional: true })
    return { runId: Number(run.databaseId), url: run.url }
  })

  await phase(state, 'signed-components', async () => {
    const stored = reusableWorkflowRun(Number(state.phases['signed-components']?.runId || 0))
    const runId = Number(stored?.databaseId || 0) || await dispatchWorkflow('publish-production-components.yml', [['tag', tag]])
    await checkpoint(state, 'signed-components', { runId })
    await waitForRun(runId)
    const release = releaseForTag()
    assertReleaseAssets(release, expectedAllNames(), { draft: false })
    return { runId }
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
    const files = await promoteStableFeeds()
    const commit = commitAndPush(files, `release: promote ${tag} stable components`)
    return { commit }
  })

  await phase(state, 'cnb-stable', async () => {
    npmRun(['run', 'release:cnb-cloud', '--', '-StableOnly'], { timeout: 10 * 60 * 1000, env: releaseEnvironment() })
  })

  await phase(state, 'complete', async () => {
    await finalRemoteCheck()
    return { releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`, mirrorUrl: `https://cnb.cool/${repo}/-/releases/tag/${tag}` }
  })

  console.log(JSON.stringify({ ok: true, stateFile, tag, productRevision: stateProductRevision, phases: PHASES, releaseUrl: state.phases.complete.releaseUrl, mirrorUrl: state.phases.complete.mirrorUrl }, null, 2))
}

if (command === 'run' || command === 'resume') {
  const releaseLock = await acquirePublicationLock()
  try { await publish() } finally { await releaseLock() }
} else if (command === 'status') {
  console.log(JSON.stringify(await readState(), null, 2))
} else if (command === 'plan') {
  console.log(JSON.stringify({ command: `npm run release:publish -- run --version ${version}`, version, tag, repo, stateFile, phases: PHASES, guarantees: ['clean committed source', 'immutable tag', 'cloud-only release artifact transfer', 'signed Android', 'signed components', 'exact 18-asset manifest', 'GitHub-to-CNB cloud mirror', 'stable feeds last'] }, null, 2))
} else {
  throw new Error('Usage: node scripts/release-publish.mjs plan|status|run|resume [--version x.y.z] [--repo owner/name] [--poll-seconds 15]')
}
