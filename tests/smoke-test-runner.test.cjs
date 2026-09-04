'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { readdir } = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const repoRoot = path.resolve(__dirname, '..')
const runnerUrl = pathToFileURL(path.join(repoRoot, 'scripts', 'run-smoke-tests.mjs')).href
let runnerPromise
function runner() { return runnerPromise ??= import(runnerUrl) }

function fixtureFiles(timingSensitiveBasenames) {
  return [
    'tests/zeta.test.cjs',
    ...timingSensitiveBasenames.map(name => `tests/${name}`),
    'tests/agent-performance.test.cjs',
    'tests/alpha.test.cjs'
  ]
}

async function fixturePlan() {
  const api = await runner()
  return {
    api,
    plan: api.createSmokeTestPlan({ repoRoot, files: fixtureFiles(api.TIMING_SENSITIVE_TEST_BASENAMES), nodeExecutable: 'fresh-node' })
  }
}

test('root tests use stable unsigned UTF-8 byte order without Unicode normalization', async () => {
  const { sortRootTestFiles } = await runner()
  const decomposed = 'tests/e\u0301.test.cjs'
  const composed = 'tests/é.test.cjs'
  assert.deepEqual(sortRootTestFiles([
    'tests/😀.test.cjs',
    composed,
    'tests/中.test.cjs',
    decomposed,
    'tests/A.test.cjs'
  ]), [
    'tests/A.test.cjs',
    decomposed,
    composed,
    'tests/中.test.cjs',
    'tests/😀.test.cjs'
  ])
})

test('partition is exhaustive, mutually exclusive, and isolates every timing-sensitive basename', async () => {
  const { TIMING_SENSITIVE_TEST_BASENAMES, isTimingSensitiveTestFile, partitionSmokeTestFiles, sortRootTestFiles } = await runner()
  const files = fixtureFiles(TIMING_SENSITIVE_TEST_BASENAMES)
  const partition = partitionSmokeTestFiles(files)
  const expectedPerformance = sortRootTestFiles([
    ...TIMING_SENSITIVE_TEST_BASENAMES.map(name => `tests/${name}`),
    'tests/agent-performance.test.cjs'
  ])
  assert.deepEqual(partition.performance, expectedPerformance)
  assert.deepEqual(partition.ordinary, ['tests/alpha.test.cjs', 'tests/zeta.test.cjs'])
  assert.deepEqual(sortRootTestFiles([...partition.ordinary, ...partition.performance]), partition.all)
  assert.equal(new Set([...partition.ordinary, ...partition.performance]).size, partition.all.length)
  assert.equal(isTimingSensitiveTestFile('performance-directory/ordinary.test.cjs'), false)
  assert.equal(isTimingSensitiveTestFile('tests/agent-performance.test.cjs'), true)
  for (const required of TIMING_SENSITIVE_TEST_BASENAMES) {
    assert.throws(
      () => partitionSmokeTestFiles(files.filter(file => !file.endsWith(`/${required}`))),
      error => error.message === `SMOKE_TIMING_SENSITIVE_TEST_MISSING:${required}`
    )
  }
})

test('enumeration covers every regular root test exactly once and isolates all real performance files', async () => {
  const { TIMING_SENSITIVE_TEST_BASENAMES, enumerateRootTestFiles, isTimingSensitiveTestFile, partitionSmokeTestFiles } = await runner()
  const entries = await readdir(path.join(repoRoot, 'tests'), { withFileTypes: true })
  const expected = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.test.cjs'))
    .map(entry => `tests/${entry.name}`)
    .sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')))
  const files = await enumerateRootTestFiles(repoRoot)
  const partition = partitionSmokeTestFiles(files)
  assert.deepEqual(files, expected)
  assert.equal(new Set(files).size, files.length)
  assert.deepEqual([...partition.ordinary, ...partition.performance].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))), files)
  assert.equal(partition.ordinary.every(file => !isTimingSensitiveTestFile(file)), true)
  assert.equal(partition.performance.every(isTimingSensitiveTestFile), true)
  for (const file of files.filter(file => path.basename(file).includes('performance'))) assert.equal(partition.performance.includes(file), true, file)
  for (const basename of TIMING_SENSITIVE_TEST_BASENAMES) assert.equal(partition.performance.includes(`tests/${basename}`), true, basename)
})

test('plan creates two ordered fresh Node invocations with exact arguments and spawn boundaries', async () => {
  const { api, plan } = await fixturePlan()
  const calls = []
  let ordinaryExited = false
  const results = api.runSmokeTestPhases(plan.phases, {
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options })
      if (calls.length === 1) ordinaryExited = true
      else assert.equal(ordinaryExited, true, 'performance phase starts only after the ordinary process exits')
      return { status: 0, signal: null }
    }
  })
  assert.deepEqual(plan.phases.map(phase => phase.name), ['ordinary', 'performance'])
  assert.deepEqual(calls, [
    {
      command: 'fresh-node',
      args: ['--test', ...plan.partition.ordinary],
      options: { cwd: repoRoot, shell: false, stdio: 'inherit' }
    },
    {
      command: 'fresh-node',
      args: ['--test', '--test-concurrency=1', ...plan.partition.performance],
      options: { cwd: repoRoot, shell: false, stdio: 'inherit' }
    }
  ])
  assert.deepEqual(results, [
    { phase: 'ordinary', status: 0, signal: null },
    { phase: 'performance', status: 0, signal: null }
  ])
  assert.equal(calls.flatMap(call => call.args).some(argument => /^--test-(?:name-pattern|only|skip)/u.test(argument)), false)
})

test('a nonzero ordinary exit propagates and prevents the performance invocation', async () => {
  const { api, plan } = await fixturePlan()
  let calls = 0
  assert.throws(() => api.runSmokeTestPhases(plan.phases, {
    spawnSyncImpl() {
      calls += 1
      return { status: 23, signal: null }
    }
  }), error => error.exitCode === 23 && error.phase === 'ordinary' && /SMOKE_PHASE_FAILED:23/u.test(error.message))
  assert.equal(calls, 1)
})

test('a nonzero performance exit propagates after the successful ordinary invocation', async () => {
  const { api, plan } = await fixturePlan()
  let calls = 0
  assert.throws(() => api.runSmokeTestPhases(plan.phases, {
    spawnSyncImpl() {
      calls += 1
      return { status: calls === 1 ? 0 : 29, signal: null }
    }
  }), error => error.exitCode === 29 && error.phase === 'performance' && /SMOKE_PHASE_FAILED:29/u.test(error.message))
  assert.equal(calls, 2)
})

test('spawn errors, thrown exceptions, and child termination all fail closed', async () => {
  const { api, plan } = await fixturePlan()
  const spawnError = new Error('cannot spawn')
  assert.throws(() => api.runSmokeTestPhases(plan.phases, {
    spawnSyncImpl: () => ({ status: null, signal: null, error: spawnError })
  }), error => error.exitCode === 1 && error.phase === 'ordinary' && error.cause === spawnError && /SMOKE_PHASE_SPAWN_ERROR/u.test(error.message))

  const thrown = new Error('spawn implementation exploded')
  assert.throws(() => api.runSmokeTestPhases(plan.phases, { spawnSyncImpl: () => { throw thrown } }), error => error === thrown)

  assert.throws(() => api.runSmokeTestPhases(plan.phases, {
    spawnSyncImpl: () => ({ status: null, signal: 'SIGTERM' })
  }), error => error.exitCode === 1 && error.phase === 'ordinary' && error.signal === 'SIGTERM' && /SMOKE_PHASE_TERMINATED:SIGTERM/u.test(error.message))

  assert.throws(() => api.runSmokeTestPhases(plan.phases, {
    spawnSyncImpl: () => ({ status: null, signal: null })
  }), error => error.exitCode === 1 && error.phase === 'ordinary' && /SMOKE_PHASE_STATUS_INVALID/u.test(error.message))
})
