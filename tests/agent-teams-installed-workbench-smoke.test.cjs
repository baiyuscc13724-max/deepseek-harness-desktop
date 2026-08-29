const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { cp, mkdtemp, rm, writeFile } = require('node:fs/promises')
const { ARTIFACT_FIXTURE_MARKER } = require('../electron/bridge/agent-teams-plugin-service.cjs')

const repositoryRoot = path.resolve(__dirname, '..')
const sourceRoot = path.join(repositoryRoot, 'plugins', 'dsh-agent-teams')
const verifier = path.join(repositoryRoot, 'scripts', 'verify-agent-teams-installed-smoke.mjs')

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: { ...process.env, ...options.env }, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => resolve({ code, stdout, stderr }))
  })
}

test('installed smoke rejects the repository plugin root instead of calling it a packaged product', async () => {
  const result = await run(process.execPath, [verifier, '--artifact-root', sourceRoot, '--skip-dom'])
  assert.notEqual(result.code, 0)
  assert.match(result.stderr, /不是正式 app\.asar\.unpacked|AGENT_TEAMS_ARTIFACT/u)
})

test('artifact-fixture smoke boots real DSH Web, proves state and SSE, and renders desktop plus 390x844 Electron viewports', { skip: process.env.HARNESS_AGENT_TEAMS_INSTALLED_SMOKE !== '1', timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-teams-artifact-fixture-'))
  try {
    const artifact = path.join(root, 'artifact', 'dsh-agent-teams')
    await cp(sourceRoot, artifact, { recursive: true })
    await writeFile(path.join(artifact, ARTIFACT_FIXTURE_MARKER), JSON.stringify({ kind: 'agent-teams-packaged-artifact-fixture', version: 1 }))
    const result = await run(process.execPath, [verifier, '--artifact-root', artifact, '--artifact-fixture'], { env: { HARNESS_AGENT_TEAMS_INSTALLED_SMOKE: '1' } })
    assert.equal(result.code, 0, result.stderr || result.stdout)
    const report = JSON.parse(result.stdout)
    assert.equal(report.ok, true)
    assert.equal(report.artifactKind, 'fixture')
    assert.equal(report.freshProfile, true)
    assert.equal(report.api.state, true)
    assert.equal(report.api.sse, true)
    assert.equal(report.api.stateChanged, true)
    assert.equal(report.api.initialEnabled, true)
    assert.equal(report.api.modelProviderInvoked, false)
    assert.equal(report.dom.desktop, true)
    assert.equal(report.dom.stopResumePreview, true)
    assert.equal(report.dom.keyboardAndAria, true)
    assert.equal(report.dom.focusStyleChanged, true)
    assert.equal(report.dom.focusedRectInViewport, true)
    assert.equal(report.dom.visibleFocusUnobscured, true)
    assert.equal(report.dom.touchTargets44, true)
    assert.equal(report.dom.mobileViewport, 'Electron Chromium 390x844 (not Android/iOS hardware)')
    assert.equal(report.hostResolveUnknown.bridgePresent, true)
    assert.equal(report.hostResolveUnknown.ciDialogClicked, false)
    assert.equal(report.hostResolveUnknown.defaultFailClosed, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
