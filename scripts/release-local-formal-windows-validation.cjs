'use strict'

const { createHash, randomUUID } = require('node:crypto')
const {
  createReadStream,
  createWriteStream,
} = require('node:fs')
const { lstat, mkdir, readFile, rename, rm } = require('node:fs/promises')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const { spawnSync } = require('node:child_process')

const FORMAL_WINDOWS_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const MAX_SELF_TEST_REPORT_BYTES = 1024 * 1024
const SELF_TEST_TIMEOUT_MS = 5 * 60 * 1000
const SELF_TEST_CHECKS = Object.freeze([
  'bundledGit',
  'bundledHarness',
  'desktopMarketplace',
  'nodeRuntime',
  'rendererEntry',
  'runtimeWebBoot',
  'userData',
  'webCompatibility',
])

function assertWindowsHost(platform = process.platform, arch = process.arch) {
  if (platform !== 'win32' || arch !== 'x64') {
    throw new Error(
      `local-formal-windows-validation requires a Windows x64 host; received ${platform}/${arch}`,
    )
  }
}

function assertVersion(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error(`Invalid product version for formal Windows validation: ${value}`)
  }
}

function assertProductRevision(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`Invalid product revision for formal Windows validation: ${value}`)
  }
}

function assertValidationId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error(`Invalid formal Windows validation id: ${value}`)
  }
}

function expectedPortableAssetName(version) {
  assertVersion(version)
  return `Harness-Desktop-${version}-portable-x64.exe`
}

function expectedAssetUrl({ repo, tag, name }) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error(`Invalid GitHub repository for formal Windows validation: ${repo}`)
  }
  if (typeof tag !== 'string' || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Invalid release tag for formal Windows validation: ${tag}`)
  }
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(name)}`
}

function normalizeFormalWindowsAsset(asset, { version, repo, tag }) {
  const name = expectedPortableAssetName(version)
  if (!asset || typeof asset !== 'object') {
    throw new Error(`Public GitHub Release is missing ${name}`)
  }
  if (asset.name !== name) {
    throw new Error(`Unexpected formal Windows asset name: ${asset.name}`)
  }
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0) {
    throw new Error(`Formal Windows asset ${name} has an invalid id`)
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Formal Windows asset ${name} has an invalid size`)
  }
  if (typeof asset.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(asset.digest)) {
    throw new Error(`Formal Windows asset ${name} has an invalid sha256 digest`)
  }
  const browserDownloadUrl = expectedAssetUrl({ repo, tag, name })
  if (asset.browser_download_url !== browserDownloadUrl) {
    throw new Error(`Formal Windows asset ${name} has an unexpected browser_download_url`)
  }
  return {
    id: asset.id,
    name,
    size: asset.size,
    digest: asset.digest,
    browserDownloadUrl,
  }
}

function validationLayout({ stateDir, version, productRevision, validationId }) {
  assertVersion(version)
  assertProductRevision(productRevision)
  assertValidationId(validationId)
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    throw new Error('A release state directory is required for formal Windows validation')
  }
  const validationRoot = path.resolve(
    stateDir,
    'local-formal-windows-validation',
    `v${version}`,
    productRevision,
    validationId,
  )
  const executablePath = path.join(validationRoot, expectedPortableAssetName(version))
  const userDataDir = path.join(validationRoot, 'electron-user-data')
  const harnessUserDataDir = path.join(validationRoot, 'harness-user-data')
  const reportPath = path.join(validationRoot, 'self-test-report.json')
  return { validationRoot, executablePath, userDataDir, harnessUserDataDir, reportPath }
}

function selfTestArguments(layout) {
  return [
    '--self-test',
    `--self-test-output=${layout.reportPath}`,
    `--user-data-dir=${layout.userDataDir}`,
    `--harness-user-data-dir=${layout.harnessUserDataDir}`,
  ]
}

function hashBuffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function hashFile(filePath) {
  const digest = createHash('sha256')
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath)
    input.on('data', (chunk) => digest.update(chunk))
    input.on('error', reject)
    input.on('end', resolve)
  })
  return digest.digest('hex')
}

async function assertRegularFile(filePath, label) {
  let stats
  try {
    stats = await lstat(filePath)
  } catch (error) {
    throw new Error(`${label} is missing: ${filePath}`, { cause: error })
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-symlink file: ${filePath}`)
  }
  return stats
}

async function validateDownloadedAsset(filePath, asset) {
  const stats = await assertRegularFile(filePath, 'Downloaded formal Windows asset')
  if (stats.size !== asset.size) {
    throw new Error(
      `Downloaded formal Windows asset size mismatch: expected ${asset.size}, received ${stats.size}`,
    )
  }
  const actualDigest = `sha256:${await hashFile(filePath)}`
  if (actualDigest !== asset.digest) {
    throw new Error(
      `Downloaded formal Windows asset digest mismatch: expected ${asset.digest}, received ${actualDigest}`,
    )
  }
  return actualDigest
}

async function readBoundedJson(filePath, label) {
  const stats = await assertRegularFile(filePath, label)
  if (stats.size <= 0 || stats.size > MAX_SELF_TEST_REPORT_BYTES) {
    throw new Error(`${label} has an invalid size: ${stats.size}`)
  }
  const bytes = await readFile(filePath)
  try {
    return { value: JSON.parse(bytes.toString('utf8')), bytes }
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error })
  }
}

function validateSelfTestReport(report, { version }) {
  assertVersion(version)
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('Formal Windows self-test report must be an object')
  }
  if (report.ok !== true) {
    throw new Error('Formal Windows self-test report did not return ok=true')
  }
  if (!report.product || report.product.version !== version) {
    throw new Error(
      `Formal Windows self-test product version mismatch: expected ${version}, received ${report.product?.version}`,
    )
  }
  if (!report.checks || typeof report.checks !== 'object' || Array.isArray(report.checks)) {
    throw new Error('Formal Windows self-test report is missing checks')
  }
  const actualChecks = Object.keys(report.checks).sort()
  if (JSON.stringify(actualChecks) !== JSON.stringify(SELF_TEST_CHECKS)) {
    throw new Error(
      `Formal Windows self-test checks mismatch: expected ${SELF_TEST_CHECKS.join(', ')}, received ${actualChecks.join(', ')}`,
    )
  }
  for (const check of SELF_TEST_CHECKS) {
    if (report.checks[check] !== true) {
      throw new Error(`Formal Windows self-test check did not pass: ${check}`)
    }
  }
  return report
}

async function downloadFormalWindowsAsset(asset, destination, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable for formal Windows asset download')
  }
  await mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.download-${randomUUID()}.tmp`
  try {
    const response = await fetchImpl(asset.browserDownloadUrl, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'Harness-Desktop-Release-Validator',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(FORMAL_WINDOWS_DOWNLOAD_TIMEOUT_MS),
    })
    if (!response || response.ok !== true || !response.body) {
      throw new Error(
        `Formal Windows asset download failed with HTTP status ${response?.status ?? 'unknown'}`,
      )
    }
    const contentLength = response.headers?.get?.('content-length')
    if (contentLength !== null && contentLength !== undefined && contentLength !== '') {
      const parsedLength = Number(contentLength)
      if (!Number.isSafeInteger(parsedLength) || parsedLength !== asset.size) {
        throw new Error(
          `Formal Windows asset Content-Length mismatch: expected ${asset.size}, received ${contentLength}`,
        )
      }
    }
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }),
    )
    await validateDownloadedAsset(temporaryPath, asset)
    await rename(temporaryPath, destination)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

async function executeSelfTest(
  layout,
  { version, spawnSyncImpl = spawnSync, timeoutMs = SELF_TEST_TIMEOUT_MS } = {},
) {
  await mkdir(layout.userDataDir, { recursive: true })
  await mkdir(layout.harnessUserDataDir, { recursive: true })
  await rm(layout.reportPath, { force: true })
  const args = selfTestArguments(layout)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSyncImpl(layout.executablePath, args, {
    cwd: layout.validationRoot,
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: timeoutMs,
  })
  if (result?.error) {
    throw new Error(`Formal Windows self-test failed to start: ${result.error.message}`, {
      cause: result.error,
    })
  }
  if (result?.status !== 0) {
    throw new Error(
      `Formal Windows self-test exited unsuccessfully (status=${result?.status}, signal=${result?.signal ?? 'none'})`,
    )
  }
  const { value: report, bytes } = await readBoundedJson(
    layout.reportPath,
    'Formal Windows self-test report',
  )
  validateSelfTestReport(report, { version })
  return { args, reportSha256: hashBuffer(bytes) }
}

function assertEvidenceMatchesLayout(evidence, layout) {
  const expected = {
    executablePath: layout.executablePath,
    userDataDir: layout.userDataDir,
    harnessUserDataDir: layout.harnessUserDataDir,
    reportPath: layout.reportPath,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (evidence[key] !== value) {
      throw new Error(`Formal Windows validation evidence ${key} does not match its isolated layout`)
    }
  }
  const expectedArgs = selfTestArguments(layout)
  if (JSON.stringify(evidence.selfTestArguments) !== JSON.stringify(expectedArgs)) {
    throw new Error('Formal Windows validation evidence has unexpected self-test arguments')
  }
}

function assertSameAsset(left, right) {
  for (const key of ['id', 'name', 'size', 'digest', 'browserDownloadUrl']) {
    if (left?.[key] !== right[key]) {
      throw new Error(`Formal Windows validation asset metadata changed: ${key}`)
    }
  }
}

async function performFormalWindowsValidation({
  stateDir,
  version,
  productRevision,
  releaseId,
  asset,
  repo,
  tag,
  platform = process.platform,
  arch = process.arch,
  validationId = randomUUID(),
  fetchImpl = globalThis.fetch,
  spawnSyncImpl = spawnSync,
}) {
  assertWindowsHost(platform, arch)
  assertProductRevision(productRevision)
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) {
    throw new Error('Formal Windows validation requires a valid public GitHub Release id')
  }
  const normalizedAsset = normalizeFormalWindowsAsset(asset, { version, repo, tag })
  const layout = validationLayout({ stateDir, version, productRevision, validationId })
  await mkdir(layout.validationRoot, { recursive: true })
  await downloadFormalWindowsAsset(normalizedAsset, layout.executablePath, { fetchImpl })
  const selfTest = await executeSelfTest(layout, { version, spawnSyncImpl })
  return {
    productRevision,
    releaseId,
    asset: normalizedAsset,
    validationId,
    executablePath: layout.executablePath,
    userDataDir: layout.userDataDir,
    harnessUserDataDir: layout.harnessUserDataDir,
    reportPath: layout.reportPath,
    selfTestArguments: selfTest.args,
    reportSha256: selfTest.reportSha256,
    validatedAt: new Date().toISOString(),
  }
}

async function revalidateFormalWindowsValidation({
  evidence,
  stateDir,
  version,
  productRevision,
  releaseId,
  asset,
  repo,
  tag,
  platform = process.platform,
  arch = process.arch,
}) {
  assertWindowsHost(platform, arch)
  assertProductRevision(productRevision)
  if (!evidence || typeof evidence !== 'object') {
    throw new Error('Formal Windows validation checkpoint is missing evidence')
  }
  if (evidence.productRevision !== productRevision) {
    throw new Error('Formal Windows validation checkpoint productRevision changed')
  }
  if (evidence.releaseId !== releaseId) {
    throw new Error('Formal Windows validation checkpoint GitHub Release id changed')
  }
  const normalizedAsset = normalizeFormalWindowsAsset(asset, { version, repo, tag })
  assertSameAsset(evidence.asset, normalizedAsset)
  const layout = validationLayout({
    stateDir,
    version,
    productRevision,
    validationId: evidence.validationId,
  })
  assertEvidenceMatchesLayout(evidence, layout)
  await validateDownloadedAsset(layout.executablePath, normalizedAsset)
  const { value: report, bytes } = await readBoundedJson(
    layout.reportPath,
    'Formal Windows self-test report',
  )
  validateSelfTestReport(report, { version })
  const reportSha256 = hashBuffer(bytes)
  if (evidence.reportSha256 !== reportSha256) {
    throw new Error('Formal Windows self-test report digest no longer matches its checkpoint')
  }
  return true
}

module.exports = {
  FORMAL_WINDOWS_DOWNLOAD_TIMEOUT_MS,
  SELF_TEST_CHECKS,
  assertWindowsHost,
  downloadFormalWindowsAsset,
  expectedPortableAssetName,
  executeSelfTest,
  normalizeFormalWindowsAsset,
  performFormalWindowsValidation,
  revalidateFormalWindowsValidation,
  selfTestArguments,
  validateDownloadedAsset,
  validateSelfTestReport,
  validationLayout,
}
