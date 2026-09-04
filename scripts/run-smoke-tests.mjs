import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const TIMING_SENSITIVE_TEST_BASENAMES = Object.freeze([
  'desktop-schedules.test.cjs',
  'mobile-sync-store.test.cjs',
  'project-multi-project-isolation.test.cjs'
])

const TIMING_SENSITIVE_TEST_SET = new Set(TIMING_SENSITIVE_TEST_BASENAMES)
const ROOT_TEST_FILE = /^tests\/[^/\\\0\r\n]+\.test\.cjs$/u

export function utf8ByteCompare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function basenameOf(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || value.includes('\r') || value.includes('\n')) {
    throw new Error(`SMOKE_TEST_PATH_INVALID:${String(value)}`)
  }
  const normalized = value.replace(/\\/gu, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function assertRootTestFile(value) {
  if (typeof value !== 'string' || !ROOT_TEST_FILE.test(value)) throw new Error(`SMOKE_ROOT_TEST_PATH_INVALID:${String(value)}`)
  return value
}

export function sortRootTestFiles(files) {
  if (!Array.isArray(files)) throw new Error('SMOKE_TEST_FILES_MUST_BE_ARRAY')
  const ordered = files.map(assertRootTestFile).sort(utf8ByteCompare)
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index - 1] === ordered[index]) throw new Error(`SMOKE_ROOT_TEST_DUPLICATE:${ordered[index]}`)
  }
  return ordered
}

export function isTimingSensitiveTestFile(file) {
  const basename = basenameOf(file)
  return basename.includes('performance') || TIMING_SENSITIVE_TEST_SET.has(basename)
}

export function partitionSmokeTestFiles(files) {
  const all = sortRootTestFiles(files)
  const basenames = new Set(all.map(basenameOf))
  for (const required of TIMING_SENSITIVE_TEST_BASENAMES) {
    if (!basenames.has(required)) throw new Error(`SMOKE_TIMING_SENSITIVE_TEST_MISSING:${required}`)
  }

  const ordinary = []
  const performance = []
  for (const file of all) (isTimingSensitiveTestFile(file) ? performance : ordinary).push(file)

  if (ordinary.length === 0) throw new Error('SMOKE_ORDINARY_PHASE_EMPTY')
  if (performance.length === 0) throw new Error('SMOKE_PERFORMANCE_PHASE_EMPTY')
  if (ordinary.length + performance.length !== all.length) throw new Error('SMOKE_PARTITION_COVERAGE_INVALID')
  if (new Set([...ordinary, ...performance]).size !== all.length) throw new Error('SMOKE_PARTITION_OVERLAP_INVALID')
  for (const required of TIMING_SENSITIVE_TEST_BASENAMES) {
    if (!performance.some(file => basenameOf(file) === required)) throw new Error(`SMOKE_TIMING_SENSITIVE_TEST_MISPARTITIONED:${required}`)
  }
  return { all, ordinary, performance }
}

export async function enumerateRootTestFiles(repoRoot = REPO_ROOT) {
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new Error('SMOKE_REPO_ROOT_INVALID')
  const testsRoot = path.join(path.resolve(repoRoot), 'tests')
  const entries = await readdir(testsRoot, { withFileTypes: true })
  const candidates = entries.filter(entry => entry.name.endsWith('.test.cjs'))
  for (const entry of candidates) {
    if (!entry.isFile()) throw new Error(`SMOKE_ROOT_TEST_NOT_REGULAR:${entry.name}`)
  }
  const files = candidates.map(entry => `tests/${entry.name}`)
  if (files.length === 0) throw new Error('SMOKE_ROOT_TESTS_EMPTY')
  return sortRootTestFiles(files)
}

export function buildNodeTestArguments(files, { serial = false } = {}) {
  const ordered = sortRootTestFiles(files)
  if (ordered.length === 0) throw new Error('SMOKE_PHASE_FILES_EMPTY')
  return serial ? ['--test', '--test-concurrency=1', ...ordered] : ['--test', ...ordered]
}

export function createSmokeTestPhase({ name, files, repoRoot, nodeExecutable = process.execPath }) {
  if (name !== 'ordinary' && name !== 'performance') throw new Error(`SMOKE_PHASE_NAME_INVALID:${String(name)}`)
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) throw new Error('SMOKE_REPO_ROOT_INVALID')
  if (typeof nodeExecutable !== 'string' || nodeExecutable.length === 0) throw new Error('SMOKE_NODE_EXECUTABLE_INVALID')
  const ordered = sortRootTestFiles(files)
  if (name === 'ordinary' && ordered.some(isTimingSensitiveTestFile)) throw new Error('SMOKE_ORDINARY_PHASE_CONTAINS_TIMING_TEST')
  if (name === 'performance' && ordered.some(file => !isTimingSensitiveTestFile(file))) throw new Error('SMOKE_PERFORMANCE_PHASE_CONTAINS_ORDINARY_TEST')
  return Object.freeze({
    name,
    files: Object.freeze(ordered),
    command: nodeExecutable,
    args: Object.freeze(buildNodeTestArguments(ordered, { serial: name === 'performance' })),
    options: Object.freeze({ cwd: path.resolve(repoRoot), shell: false, stdio: 'inherit' })
  })
}

export function createSmokeTestPlan({ repoRoot = REPO_ROOT, files, nodeExecutable = process.execPath }) {
  const partition = partitionSmokeTestFiles(files)
  const phases = Object.freeze([
    createSmokeTestPhase({ name: 'ordinary', files: partition.ordinary, repoRoot, nodeExecutable }),
    createSmokeTestPhase({ name: 'performance', files: partition.performance, repoRoot, nodeExecutable })
  ])
  return { partition, phases }
}

export function assertSmokeTestPhases(phases) {
  if (!Array.isArray(phases) || phases.length !== 2 || phases[0]?.name !== 'ordinary' || phases[1]?.name !== 'performance') {
    throw new Error('SMOKE_PHASE_ORDER_INVALID')
  }
  if (phases[0].command !== phases[1].command || phases[0].options?.cwd !== phases[1].options?.cwd) throw new Error('SMOKE_PHASE_PROCESS_IDENTITY_INVALID')
  const files = phases.flatMap(phase => phase.files)
  const expected = partitionSmokeTestFiles(files)
  if (JSON.stringify(phases[0].files) !== JSON.stringify(expected.ordinary) || JSON.stringify(phases[1].files) !== JSON.stringify(expected.performance)) {
    throw new Error('SMOKE_PHASE_PARTITION_INVALID')
  }
  for (const phase of phases) {
    if (phase.options?.cwd !== path.resolve(phase.options.cwd) || phase.options?.shell !== false || phase.options?.stdio !== 'inherit') throw new Error(`SMOKE_PHASE_SPAWN_OPTIONS_INVALID:${phase.name}`)
    const expectedArgs = buildNodeTestArguments(phase.files, { serial: phase.name === 'performance' })
    if (JSON.stringify(phase.args) !== JSON.stringify(expectedArgs)) throw new Error(`SMOKE_PHASE_ARGUMENTS_INVALID:${phase.name}`)
    if (phase.args.some(argument => /^--test-(?:name-pattern|only|skip)/u.test(argument))) throw new Error(`SMOKE_PHASE_FILTER_FORBIDDEN:${phase.name}`)
  }
  return true
}

function phaseError(message, phase, details = {}) {
  return Object.assign(new Error(`${message}:${phase.name}`), { phase: phase.name, exitCode: 1, ...details })
}

export function runSmokeTestPhases(phases, { spawnSyncImpl = spawnSync, onPhaseStart } = {}) {
  assertSmokeTestPhases(phases)
  if (typeof spawnSyncImpl !== 'function') throw new Error('SMOKE_SPAWN_IMPLEMENTATION_INVALID')
  if (onPhaseStart !== undefined && typeof onPhaseStart !== 'function') throw new Error('SMOKE_PHASE_CALLBACK_INVALID')
  const results = []
  for (const phase of phases) {
    onPhaseStart?.(phase)
    const result = spawnSyncImpl(phase.command, [...phase.args], { ...phase.options })
    if (!result || typeof result !== 'object') throw phaseError('SMOKE_PHASE_RESULT_INVALID', phase)
    if (result.error) throw phaseError(`SMOKE_PHASE_SPAWN_ERROR:${result.error.message || result.error}`, phase, { cause: result.error })
    if (result.signal) throw phaseError(`SMOKE_PHASE_TERMINATED:${result.signal}`, phase, { signal: result.signal })
    if (!Number.isInteger(result.status)) throw phaseError('SMOKE_PHASE_STATUS_INVALID', phase)
    if (result.status !== 0) throw phaseError(`SMOKE_PHASE_FAILED:${result.status}`, phase, { exitCode: result.status })
    results.push({ phase: phase.name, status: result.status, signal: result.signal ?? null })
  }
  return results
}

export async function runSmokeTests({ repoRoot = REPO_ROOT, nodeExecutable = process.execPath, spawnSyncImpl = spawnSync, onPhaseStart } = {}) {
  const files = await enumerateRootTestFiles(repoRoot)
  const plan = createSmokeTestPlan({ repoRoot, files, nodeExecutable })
  const results = runSmokeTestPhases(plan.phases, { spawnSyncImpl, onPhaseStart })
  return { ...plan, results }
}

export function isDirectExecution(argv = process.argv, moduleUrl = import.meta.url) {
  return Boolean(argv[1]) && path.resolve(argv[1]) === path.resolve(fileURLToPath(moduleUrl))
}

if (isDirectExecution()) {
  runSmokeTests({
    onPhaseStart(phase) {
      process.stdout.write(`[smoke] ${phase.name} phase: ${phase.files.length} root test files\n`)
    }
  }).then(result => {
    process.stdout.write(`[smoke] passed ${result.partition.all.length} root test files exactly once across two fresh Node invocations\n`)
  }).catch(error => {
    process.stderr.write(`${error?.stack || error}\n`)
    process.exitCode = Number.isInteger(error?.exitCode) && error.exitCode > 0 ? error.exitCode : 1
  })
}
