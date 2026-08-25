import path from 'node:path'
import process from 'node:process'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const AdmZip = require('adm-zip')
const { createComponentZip } = require('../electron/bridge/component-update-builder.cjs')

export const PREVIEW_BUILD_WORKFLOW = '.github/workflows/pr-preview-build.yml'
export const OFFICIAL_REPOSITORY = 'baiyuscc13724-max/deepseek-harness-desktop'
const TARGETS = Object.freeze({
  'win32-x64': { platform: 'win32', arch: 'x64' },
  'darwin-x64': { platform: 'darwin', arch: 'x64' },
  'darwin-arm64': { platform: 'darwin', arch: 'arm64' }
})

function argument(argv, name, fallback = '') {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

function requireMatch(value, pattern, label) {
  const normalized = String(value || '').trim()
  if (!pattern.test(normalized)) throw new Error(`${label} 无效。`)
  return normalized
}

export function normalizeOfficialStableVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!match) throw new Error('官方稳定基线必须是 vX.Y.Z。')
  return `${match[1]}.${match[2]}.${match[3]}`
}

export function previewSequence(runNumber, attempt = 1) {
  const normalizedRunNumber = Number(runNumber)
  const normalizedAttempt = Number(attempt)
  if (!Number.isSafeInteger(normalizedRunNumber) || normalizedRunNumber <= 0 || !Number.isSafeInteger(normalizedAttempt) || normalizedAttempt <= 0 || normalizedAttempt >= 1_000_000) {
    throw new Error('预览构建 run number/attempt 必须是受支持的正安全整数。')
  }
  const sequence = normalizedRunNumber * 1_000_000 + normalizedAttempt
  if (!Number.isSafeInteger(sequence)) throw new Error('预览候选 sequence 超出安全整数范围。')
  return sequence
}

export function previewVersion(officialStableVersion, runNumber, attempt = 1) {
  const match = normalizeOfficialStableVersion(officialStableVersion).match(/^(\d+)\.(\d+)\.(\d+)$/)
  const normalizedRunNumber = Number(runNumber)
  const normalizedAttempt = Number(attempt)
  previewSequence(normalizedRunNumber, normalizedAttempt)
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}-pr.${normalizedRunNumber}.${normalizedAttempt}`
}

async function copyPreviewPayload(sourceRoot, stagingRoot) {
  for (const directory of ['electron', 'renderer', 'plugins']) {
    const source = path.join(sourceRoot, directory)
    if (!(await stat(source)).isDirectory()) throw new Error(`缺少预览组件目录：${directory}`)
    await cp(source, path.join(stagingRoot, directory), { recursive: true, force: true })
  }
  await cp(path.join(sourceRoot, 'package.json'), path.join(stagingRoot, 'package.json'))
  await cp(path.join(sourceRoot, 'pr-preview-update-sources.json'), path.join(stagingRoot, 'pr-preview-update-sources.json'))
  await mkdir(path.join(stagingRoot, 'build'), { recursive: true })
  await cp(path.join(sourceRoot, 'build', 'icon.png'), path.join(stagingRoot, 'build', 'icon.png'))
}

export async function buildUnsignedPreview(options) {
  const repository = requireMatch(options.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, '仓库')
  if (repository.toLowerCase() !== OFFICIAL_REPOSITORY) throw new Error('只允许官方仓库的同仓库 PR。')
  const headRepository = requireMatch(options.headRepository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'head 仓库')
  if (headRepository.toLowerCase() !== repository.toLowerCase() || options.isFork === true || options.isFork === 'true') {
    throw new Error('fork PR 不允许进入预览构建。')
  }
  const headSha = requireMatch(options.headSha, /^[a-f0-9]{40}$/, 'head SHA').toLowerCase()
  const pullRequest = Number(options.pullRequest)
  if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) throw new Error('PR 编号无效。')
  const target = requireMatch(options.target || 'win32-x64', /^(win32-x64|darwin-x64|darwin-arm64)$/, '目标')
  const builtAt = new Date(options.builtAt || Date.now())
  if (!Number.isFinite(builtAt.getTime())) throw new Error('构建时间无效。')

  const sourceRoot = path.resolve(options.sourceRoot)
  const outputRoot = path.resolve(options.outputRoot)
  if (outputRoot === sourceRoot || outputRoot.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error('输出目录必须位于源码检出之外，避免把构建产物打入组件。')
  }
  const pkg = JSON.parse(await readFile(path.join(sourceRoot, 'package.json'), 'utf8'))
  const officialStableVersion = normalizeOfficialStableVersion(options.officialStableVersion)
  const buildRunNumber = Number(options.sequence)
  const buildAttempt = Number(options.attempt || 1)
  const buildSequence = previewSequence(buildRunNumber, buildAttempt)
  const version = previewVersion(officialStableVersion, buildRunNumber, buildAttempt)
  const artifactName = `pr-preview-unsigned-${pullRequest}-${headSha}`
  const componentName = `desktop-shell-${version}-${target}.zip`
  const stagingRoot = path.join(outputRoot, '.staging')
  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 })
  await copyPreviewPayload(sourceRoot, stagingRoot)
  const archive = await createComponentZip({
    inputDir: stagingRoot,
    outputFile: path.join(outputRoot, componentName),
    id: 'desktop-shell',
    version,
    target: 'shell',
    AdmZipImpl: AdmZip
  })
  await rm(stagingRoot, { recursive: true, force: true })

  const report = {
    schemaVersion: 1,
    kind: 'harness-pr-preview-unsigned',
    workflow: PREVIEW_BUILD_WORKFLOW,
    artifactName,
    repository,
    headRepository,
    fork: false,
    pullRequest,
    headSha,
    builtAt: builtAt.toISOString(),
    prPackageVersion: pkg.version,
    officialStableVersion,
    buildRunNumber,
    buildSequence,
    buildAttempt,
    previewVersion: version,
    target,
    component: {
      id: 'desktop-shell',
      target: 'shell',
      platform: TARGETS[target].platform,
      arch: TARGETS[target].arch,
      name: componentName,
      size: archive.size,
      unpackedSize: archive.unpackedSize,
      sha256: archive.sha256,
      indexVersion: archive.index.version
    }
  }
  await writeFile(path.join(outputRoot, 'pr-preview-build.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return report
}

async function main() {
  const argv = process.argv.slice(2)
  const sourceRoot = path.resolve(argument(argv, 'source', process.cwd()))
  const outputRoot = path.resolve(argument(argv, 'out'))
  if (!argument(argv, 'out')) throw new Error('--out 是必需参数。')
  const report = await buildUnsignedPreview({
    sourceRoot,
    outputRoot,
    repository: argument(argv, 'repository'),
    headRepository: argument(argv, 'head-repository'),
    isFork: argument(argv, 'fork', 'false'),
    pullRequest: argument(argv, 'pull-request'),
    headSha: argument(argv, 'head-sha'),
    target: argument(argv, 'target', 'win32-x64'),
    officialStableVersion: argument(argv, 'official-stable-version'),
    sequence: argument(argv, 'sequence'),
    attempt: argument(argv, 'attempt', '1'),
    builtAt: argument(argv, 'built-at', new Date().toISOString())
  })
  console.log(JSON.stringify({ ok: true, artifactName: report.artifactName, headSha: report.headSha, component: report.component }, null, 2))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
