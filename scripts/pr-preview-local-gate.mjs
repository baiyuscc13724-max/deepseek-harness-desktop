import path from 'node:path'
import os from 'node:os'
import process from 'node:process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { ComponentUpdateService } = require('../electron/bridge/component-update-service.cjs')
const { ComponentUpdateStore } = require('../electron/bridge/component-update-store.cjs')
const { launchComponentUpdateHelper } = require('../electron/bridge/component-update-launcher.cjs')
const { desktopEnvironment } = require('../electron/bridge/component-update-helper.cjs')
const { prepareComponentActivation } = require('../electron/bridge/component-update-health.cjs')
const { PrPreviewActivationStore } = require('../electron/bridge/pr-preview-activation-store.cjs')
const {
  assertIndexMatchesManifest,
  OFFICIAL_PREVIEW_REPOSITORY,
  validateAndVerifyPreviewIndex,
  validateAndVerifyPreviewManifest
} = require('../electron/bridge/pr-preview-update-contract.cjs')
const {
  normalizeOfficialManifestUrls,
  normalizePrPreviewUpdateConfig
} = require('../electron/bridge/pr-preview-update-config.cjs')
const { normalizeVersion } = require('../electron/bridge/component-update-contract.cjs')

const EVIDENCE_KIND = 'harness-pr-preview-local-gate-evidence'
const MAX_JSON_BYTES = 1024 * 1024
const MAX_CONFIG_BYTES = 128 * 1024
const MAX_COMPONENT_BYTES = 512 * 1024 * 1024
const SAFE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{1,180}$/
const SHA256 = /^[a-f0-9]{64}$/
const ALLOWED_CLI = new Set(['candidate-bundle', 'public-config', 'app-exe', 'evidence'])

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} 字段集合无效。`)
}

function localPath(value, label) {
  const text = String(value || '').trim()
  if (!text || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) || text.includes('\0')) throw new Error(`${label} 必须是本机文件路径。`)
  return path.resolve(text)
}

export function parseGateArguments(argv) {
  if (!Array.isArray(argv)) throw new Error('本机 gate 参数无效。')
  const values = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    if (!/^--[a-z-]+$/.test(flag || '')) throw new Error(`本机 gate 参数无效：${flag || ''}`)
    const name = flag.slice(2)
    if (!ALLOWED_CLI.has(name) || Object.hasOwn(values, name)) throw new Error(`本机 gate 拒绝参数：${flag}`)
    const value = argv[index + 1]
    if (!value || String(value).startsWith('--')) throw new Error(`${flag} 缺少值。`)
    values[name] = value
  }
  for (const name of ALLOWED_CLI) if (!values[name]) throw new Error(`--${name} 是必需参数。`)
  return {
    candidateBundle: localPath(values['candidate-bundle'], '候选 bundle'),
    publicConfig: localPath(values['public-config'], '生产公开 config'),
    appExe: localPath(values['app-exe'], '打包应用'),
    evidenceFile: localPath(values.evidence, '证据输出')
  }
}

async function boundedFile(file, maxBytes, label) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) throw new Error(`${label}大小或类型无效。`)
  return readFile(file)
}

async function boundedJson(file, maxBytes, label) {
  const bytes = await boundedFile(file, maxBytes, label)
  try { return { bytes, value: JSON.parse(bytes.toString('utf8')) } }
  catch (error) { throw new Error(`${label}不是有效 JSON：${error.message}`) }
}

async function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function githubReleaseIdentity(urlValue) {
  const url = new URL(String(urlValue || ''))
  const prefix = `/${OFFICIAL_PREVIEW_REPOSITORY}/releases/download/`
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || url.port || !url.pathname.startsWith(prefix)) {
    throw new Error('候选组件 GitHub release URL 无效。')
  }
  const parts = url.pathname.slice(prefix.length).split('/').map(value => decodeURIComponent(value))
  if (parts.length !== 2 || !SAFE_ASSET.test(parts[1])) throw new Error('候选组件 release 身份无效。')
  return { immutableTag: parts[0], assetName: parts[1] }
}

function validateAudit(audit) {
  exactKeys(audit, [
    'schemaVersion', 'kind', 'repository', 'prNumber', 'headSha', 'buildRunId', 'runAttempt',
    'immutableTag', 'artifactName', 'officialStableVersion', 'previewVersion',
    'manifestReleaseAsset', 'indexReleaseAsset', 'feedReleaseAssets'
  ], '签名审计')
  if (audit.schemaVersion !== 1 || audit.kind !== 'harness-pr-preview-signing-audit' || audit.repository !== OFFICIAL_PREVIEW_REPOSITORY) {
    throw new Error('签名审计身份无效。')
  }
  for (const key of ['prNumber', 'buildRunId', 'runAttempt']) {
    if (!Number.isSafeInteger(audit[key]) || audit[key] <= 0) throw new Error(`签名审计 ${key} 无效。`)
  }
  if (!/^[a-f0-9]{40}$/.test(audit.headSha) || !SAFE_ASSET.test(audit.manifestReleaseAsset) || !SAFE_ASSET.test(audit.indexReleaseAsset)) {
    throw new Error('签名审计候选字段无效。')
  }
  if (!Array.isArray(audit.feedReleaseAssets) || audit.feedReleaseAssets.length !== 2) throw new Error('签名审计 feed 资产无效。')
  const feed = new Map()
  for (const item of audit.feedReleaseAssets) {
    exactKeys(item, ['name', 'size', 'sha256'], '签名审计 feed 资产')
    if (!SAFE_ASSET.test(item.name) || !Number.isSafeInteger(item.size) || item.size <= 0 || !SHA256.test(item.sha256) || feed.has(item.name)) {
      throw new Error('签名审计 feed 资产字段无效。')
    }
    feed.set(item.name, item)
  }
  if (!feed.has(audit.manifestReleaseAsset) || !feed.has(audit.indexReleaseAsset)) throw new Error('签名审计 feed 资产缺失。')
  return feed
}

async function exactBundleFiles(root, expected) {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.some(entry => !entry.isFile())) throw new Error('候选 bundle 只能包含根级普通文件。')
  const actual = entries.map(entry => entry.name).sort()
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error('候选 bundle 资产集合不精确。')
}

function archivePublicConfig(zipFile, expectedBytes) {
  const archive = new AdmZip(zipFile)
  const entries = archive.getEntries().filter(entry => entry.entryName === 'pr-preview-update-sources.json' && !entry.isDirectory)
  if (entries.length !== 1) throw new Error('候选 ZIP 未精确包含生产公开 config。')
  const bytes = entries[0].getData()
  if (!bytes.equals(expectedBytes)) throw new Error('候选 ZIP 内公开 config 与生产文件不一致。')
}

export async function verifyLocalCandidateBundle({ candidateBundle, publicConfig, now = Date.now() }) {
  const bundleRoot = localPath(candidateBundle, '候选 bundle')
  const configFile = localPath(publicConfig, '生产公开 config')
  if (path.basename(configFile) !== 'pr-preview-update-sources.json') throw new Error('生产公开 config 文件名无效。')
  const rootInfo = await stat(bundleRoot)
  if (!rootInfo.isDirectory()) throw new Error('候选 bundle 不是目录。')
  const configRead = await boundedJson(configFile, MAX_CONFIG_BYTES, '生产公开 config')
  if (/PRIVATE KEY|BEGIN [A-Z ]*PRIVATE/i.test(configRead.bytes.toString('utf8'))) throw new Error('生产公开 config 不得包含私钥。')
  const config = normalizePrPreviewUpdateConfig(configRead.value)
  if (!config.enabled || config.repository !== OFFICIAL_PREVIEW_REPOSITORY || Object.keys(config.trustedKeys).length === 0) {
    throw new Error('生产公开 config 尚未启用独立预览公钥。')
  }

  const auditFile = path.join(bundleRoot, 'pr-preview-signing-audit.json')
  const audit = (await boundedJson(auditFile, MAX_JSON_BYTES, '签名审计')).value
  const feed = validateAudit(audit)
  const indexFile = path.join(bundleRoot, audit.indexReleaseAsset)
  const manifestFile = path.join(bundleRoot, audit.manifestReleaseAsset)
  const [indexRead, manifestRead] = await Promise.all([
    boundedJson(indexFile, MAX_JSON_BYTES, '签名 index'),
    boundedJson(manifestFile, MAX_JSON_BYTES, '签名 manifest')
  ])
  const index = validateAndVerifyPreviewIndex(indexRead.value, config.trustedKeys, { now, normalizeManifestUrls: normalizeOfficialManifestUrls })
  const wrapper = validateAndVerifyPreviewManifest(manifestRead.value, config.trustedKeys, { now })
  assertIndexMatchesManifest(index, wrapper)
  if (index.prNumber !== audit.prNumber || index.headSha !== audit.headSha || index.sequence <= 0 || wrapper.componentManifest.releaseVersion !== audit.previewVersion) {
    throw new Error('签名候选与审计身份不一致。')
  }
  if (normalizeVersion(wrapper.componentManifest.bootstrap.minVersion) !== normalizeVersion(audit.officialStableVersion)) {
    throw new Error('候选稳定基线与签名 manifest 不一致。')
  }
  if (!new RegExp(`^pr-preview-${index.prNumber}-${index.headSha.slice(0, 12)}-run-${audit.buildRunId}-${audit.runAttempt}$`).test(audit.immutableTag)) {
    throw new Error('候选 immutableTag 未精确绑定 PR/head/run。')
  }
  const components = wrapper.componentManifest.components
  if (!Array.isArray(components) || components.length !== 1 || components[0].id !== 'desktop-shell' || components[0].target !== 'shell') {
    throw new Error('本机 gate 只接受一个 desktop-shell 候选。')
  }
  const component = components[0]
  const identity = githubReleaseIdentity(component.urls[1])
  if (identity.immutableTag !== audit.immutableTag || component.platform !== process.platform || component.arch !== process.arch) {
    throw new Error('候选 tag 或本机目标不匹配。')
  }
  const componentFile = path.join(bundleRoot, identity.assetName)
  await exactBundleFiles(bundleRoot, [identity.assetName, audit.manifestReleaseAsset, audit.indexReleaseAsset, 'pr-preview-signing-audit.json'])
  const componentInfo = await stat(componentFile)
  if (!componentInfo.isFile() || componentInfo.size !== component.size || componentInfo.size <= 0 || componentInfo.size > MAX_COMPONENT_BYTES) {
    throw new Error('候选组件大小不匹配。')
  }
  const [componentSha256, indexSha256, manifestSha256] = await Promise.all([
    fileSha256(componentFile), fileSha256(indexFile), fileSha256(manifestFile)
  ])
  if (componentSha256 !== component.sha256) throw new Error('候选组件 SHA-256 不匹配。')
  for (const [name, digest] of [[audit.indexReleaseAsset, indexSha256], [audit.manifestReleaseAsset, manifestSha256]]) {
    const item = feed.get(name)
    if (item.sha256 !== digest || item.size !== (await stat(path.join(bundleRoot, name))).size) throw new Error(`候选 feed SHA-256 不匹配：${name}`)
  }
  archivePublicConfig(componentFile, configRead.bytes)
  return {
    bundleRoot,
    config,
    configBytes: configRead.bytes,
    audit,
    index,
    wrapper,
    componentManifestPayload: manifestRead.value.componentManifest,
    component,
    componentFile,
    immutableTag: identity.immutableTag,
    componentSha256
  }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function waitForState(store, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  let state
  while (Date.now() < deadline) {
    state = await store.get()
    if (predicate(state)) return state
    await delay(250)
  }
  throw new Error(`等待组件状态超时：${state?.phase || 'unknown'}`)
}

async function waitForReport(file, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const report = await readFile(file, 'utf8').then(JSON.parse).catch(() => null)
    if (report && typeof report.ok === 'boolean') return report
    await delay(250)
  }
  throw new Error('等待打包自检报告超时。')
}

async function waitForExit(child, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('打包自检进程退出超时。'))
    }, timeoutMs)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); resolve(code) })
  })
}

async function runPackagedSelfTest(executable, profile, output) {
  const child = spawn(executable, [
    `--user-data-dir=${profile}`,
    `--harness-user-data-dir=${profile}`,
    '--self-test',
    `--self-test-output=${output}`
  ], { cwd: path.dirname(executable), stdio: 'ignore', windowsHide: true, env: desktopEnvironment(process.env) })
  const exit = waitForExit(child)
  const report = await waitForReport(output)
  const code = await exit
  if (!report.ok || code !== 0) throw new Error('打包应用自检失败。')
  return report
}

async function activateWithPackagedHelper({ executable, profile, workspace, store }) {
  const output = path.join(workspace, 'activated-self-test.json')
  const dummyParent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 900)'], { stdio: 'ignore', windowsHide: true })
  const helperScript = path.join(path.dirname(executable), 'resources', 'app.asar', 'scripts', 'component-update-helper.cjs')
  await launchComponentUpdateHelper({
    store,
    execPath: executable,
    helperScript,
    componentRoot: store.root,
    parentPid: dummyParent.pid,
    restartExecutable: executable,
    restartCwd: path.dirname(executable),
    accessImpl: async target => {
      if (path.resolve(target) === path.resolve(helperScript)) return
      const info = await stat(target)
      if (!info) throw new Error('组件 helper 路径缺失。')
    },
    restartArgs: [
      `--user-data-dir=${profile}`,
      `--harness-user-data-dir=${profile}`,
      '--component-health-check',
      '--self-test',
      `--self-test-output=${output}`
    ]
  })
  const state = await waitForState(store, value => value.phase === 'idle' || value.phase === 'failed' || value.phase === 'rollback-required')
  const selfTest = await waitForReport(output)
  await delay(1_000)
  if (state.phase !== 'idle' || !selfTest.ok) throw new Error('候选激活或健康确认失败。')
  return { state, selfTest }
}

async function stageVerifiedCandidate(verified, store, bootstrapVersion) {
  const service = new ComponentUpdateService({
    store,
    manifestUrls: [verified.index.manifestUrls[0]],
    trustedKeys: verified.config.trustedKeys,
    bootstrapVersion,
    platform: verified.component.platform,
    arch: verified.component.arch,
    AdmZipImpl: AdmZip,
    fetchJson: async () => verified.componentManifestPayload,
    downloadImpl: async ({ destination, expectedSize, expectedHash }) => {
      await copyFile(verified.componentFile, destination)
      const info = await stat(destination)
      const digest = await fileSha256(destination)
      if (info.size !== expectedSize || digest !== expectedHash) throw new Error('本机候选复制后校验失败。')
    }
  })
  const checked = await service.check()
  if (checked.plan.mode !== 'components' || checked.plan.releaseVersion !== verified.wrapper.componentManifest.releaseVersion) {
    throw new Error('真实候选未形成唯一组件更新计划。')
  }
  await service.stage(checked)
  if ((await store.get()).phase !== 'ready') throw new Error('真实候选未完成 stage。')
  return checked
}

async function verifyRollbackPath(store, activePointer) {
  const brokenRelease = `${activePointer.releaseVersion}.gate-failure`
  await store.beginStaging({
    mode: 'components',
    releaseVersion: brokenRelease,
    components: activePointer.components,
    desiredComponents: activePointer.components
  })
  await store.markReady()
  await store.markApplying()
  await store.activatePending()
  const result = await prepareComponentActivation({
    store,
    accessImpl: async () => { throw Object.assign(new Error('controlled local gate health failure'), { code: 'LOCAL_GATE_HEALTH_FAILURE' }) }
  })
  const state = await store.get()
  const pointer = await store.pointer()
  if (result.action !== 'rolled-back' || state.phase !== 'failed' || pointer?.releaseVersion !== activePointer.releaseVersion) {
    throw new Error('last-known-good 自动回滚验证失败。')
  }
  return state
}

async function restoreBaseline(store, baseline) {
  const state = await store.get()
  if (baseline) await store.atomicWrite(store.pointerFile, baseline)
  else await rm(store.pointerFile, { force: true })
  return store.writeState({
    ...state,
    phase: 'idle',
    active: baseline,
    lastKnownGood: baseline,
    pending: null,
    failure: null
  }, state.revision)
}

function evidencePayload({ verified, baselineRelease, activatedRelease, restoredRelease, createdAt }) {
  const evidence = {
    schemaVersion: 1,
    kind: EVIDENCE_KIND,
    result: 'passed',
    candidate: {
      immutableTag: verified.immutableTag,
      headSha: verified.index.headSha,
      sequence: verified.index.sequence,
      componentSha256: verified.componentSha256
    },
    baselineRelease,
    activatedRelease,
    restoredRelease,
    checks: { healthy: 'passed', rollback: 'passed' },
    createdAt: new Date(createdAt).toISOString()
  }
  exactKeys(evidence, ['schemaVersion', 'kind', 'result', 'candidate', 'baselineRelease', 'activatedRelease', 'restoredRelease', 'checks', 'createdAt'], '本机 gate 证据')
  exactKeys(evidence.candidate, ['immutableTag', 'headSha', 'sequence', 'componentSha256'], '本机 gate 候选')
  exactKeys(evidence.checks, ['healthy', 'rollback'], '本机 gate 检查')
  return evidence
}

export async function runPrPreviewLocalGate(options, dependencies = {}) {
  const now = Number(dependencies.now?.() ?? Date.now())
  if (!Number.isFinite(now)) throw new Error('本机 gate 时钟无效。')
  const verified = await verifyLocalCandidateBundle({
    candidateBundle: options.candidateBundle,
    publicConfig: options.publicConfig,
    now
  })
  const executable = localPath(options.appExe, '打包应用')
  const executableInfo = await lstat(executable)
  if (!executableInfo.isFile() || executableInfo.isSymbolicLink()) throw new Error('打包应用不存在或类型无效。')
  const configFile = localPath(options.publicConfig, '生产公开 config')
  const evidenceFile = localPath(options.evidenceFile, '证据输出')
  if (
    evidenceFile === executable || evidenceFile === configFile || evidenceFile === verified.bundleRoot ||
    evidenceFile.startsWith(`${verified.bundleRoot}${path.sep}`)
  ) throw new Error('证据输出不得覆盖候选、配置或应用文件。')
  const profile = dependencies.profileRoot || await mkdtemp(path.join(os.tmpdir(), 'harness-pr-preview-gate-'))
  const ownsProfile = !dependencies.profileRoot
  const workspace = path.join(profile, 'gate-workspace')
  const selfTest = dependencies.runPackagedSelfTestImpl || runPackagedSelfTest
  const activate = dependencies.activateCandidateImpl || activateWithPackagedHelper
  try {
    await rm(profile, { recursive: true, force: true })
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    const baselineReport = await selfTest(executable, profile, path.join(workspace, 'baseline-self-test.json'), 'baseline')
    if (!baselineReport?.ok) throw new Error('稳定基线打包自检失败。')
    const baselineRelease = normalizeVersion(baselineReport.product?.version, '打包稳定基线版本')
    if (baselineRelease !== normalizeVersion(verified.audit.officialStableVersion)) throw new Error('打包应用不是候选绑定的官方稳定基线。')

    const store = new ComponentUpdateStore(path.join(profile, 'component-updates'))
    const activation = new PrPreviewActivationStore(store.root)
    const baseline = await store.pointer()
    await activation.capture({
      baseline,
      prNumber: verified.index.prNumber,
      title: verified.index.title,
      author: verified.index.author,
      baseRef: verified.index.baseRef,
      sequence: verified.index.sequence,
      headSha: verified.index.headSha,
      releaseVersion: verified.wrapper.componentManifest.releaseVersion,
      provider: 'cnb'
    }, new Date(now))
    await stageVerifiedCandidate(verified, store, baselineRelease)
    await activate({ executable, profile, workspace, store, verified })
    const activeState = await store.get()
    const activePointer = await store.pointer()
    const activatedRelease = verified.wrapper.componentManifest.releaseVersion
    if (activeState.phase !== 'idle' || activeState.active?.releaseVersion !== activatedRelease || activePointer?.releaseVersion !== activatedRelease) {
      throw new Error('候选未确认 active。')
    }

    await verifyRollbackPath(store, activePointer)
    await restoreBaseline(store, baseline)
    await activation.clear()
    const restoredReport = await selfTest(executable, profile, path.join(workspace, 'restored-self-test.json'), 'restored')
    const restoredRelease = normalizeVersion(restoredReport?.product?.version, '恢复稳定版本')
    if (!restoredReport?.ok || restoredRelease !== baselineRelease || (await store.pointer()) !== null) {
      throw new Error('退出预览后稳定基线恢复或健康检查失败。')
    }

    const evidence = evidencePayload({ verified, baselineRelease, activatedRelease, restoredRelease, createdAt: now })
    const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    const evidenceSha256 = createHash('sha256').update(bytes).digest('hex')
    await mkdir(path.dirname(evidenceFile), { recursive: true, mode: 0o700 })
    await writeFile(evidenceFile, bytes, { mode: 0o600 })
    return { evidence, evidenceSha256 }
  } finally {
    if (ownsProfile) await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

async function main() {
  const options = parseGateArguments(process.argv.slice(2))
  const result = await runPrPreviewLocalGate(options)
  process.stdout.write(`${JSON.stringify({ ok: true, evidenceSha256: result.evidenceSha256 })}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`PR_PREVIEW_LOCAL_GATE_FAILED: ${error.message}\n`)
    process.exitCode = 1
  })
}
