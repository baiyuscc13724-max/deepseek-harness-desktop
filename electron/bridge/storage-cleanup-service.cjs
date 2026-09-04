// storage-cleanup-service.cjs
//
// HarnessData 存储清理服务（批次3的底层模块）。
//
// 清理安全约束（严格遵守）：
//   * dry-run 预览优先：默认 preview=true，只计算候选；preview=false 仍须绑定
//     已确认预览并复核身份。当前 JS 运行时没有安全的递归 delete-by-handle，
//     因此 apply 会明确拒绝且不执行路径 mutation。
//   * 只有未来具备可证明 exact-object 删除原语时，才可清理这几类内容：
//       1) runtime 下「非当前」的旧版本 runtime 目录；
//       2) dsh-home 下的 marketplace 与 cache 类缓存目录；
//       3) temp 下由用户显式传入、且超过年龄阈值的条目。
//   * 绝不能删除 sessions / attachments / memories / 当前 runtime /
//     根目录本身 / 任何受保护子树。
//   * 防路径穿越、符号链接和根目录逃逸：所有目标必须受控在 HarnessData 之内，
//     且不得是符号链接或经符号链接逃逸的路径。
//
// 本服务配合 storage-scan-service 读取目录；apply 白名单与身份门禁仍完整保留，
// 但在缺少安全删除原语时只返回可审计的拒绝结果。

const { lstat, realpath } = require('node:fs/promises')
const path = require('node:path')
const {
  MAX_SCAN_ENTRIES,
  PROTECTED_BASENAMES,
  ROOT_ENTRY_NAMES,
  isSymlinkEscaping,
  resolveContained,
  scanCacheOnly,
  scanHarnessData,
  scanTree
} = require('./storage-scan-service.cjs')

const FILE_IDENTITY_KEYS = Object.freeze([
  'dev',
  'ino',
  'mode',
  'size',
  'mtimeMs',
  'birthtimeMs'
])

const ROOT_IDENTITY_KEYS = Object.freeze([
  'canonicalRootPath',
  'rootDev',
  'rootIno',
  'rootMode',
  'rootSize',
  'rootMtimeMs',
  'rootBirthtimeMs'
])

const CACHE_IDENTITY_KEYS = Object.freeze([
  'canonicalPath',
  ...FILE_IDENTITY_KEYS,
  ...ROOT_IDENTITY_KEYS,
  'observedMtimeMs'
])

// Older builds may have retained these after a rename failure or outcome-unknown.
// They are recovery-only forever: no planner may turn them back into delete candidates.
const ISOLATION_DIRECTORY_PREFIX = '.dsh-cleanup-quarantine-'
const SAFE_RECURSIVE_DELETE_UNAVAILABLE =
  '当前 Node/Electron 文件系统 API 不提供可绑定 exact object 的跨平台递归删除原语；为保护 sessions、attachments、memories 与当前 runtime，已拒绝 apply，候选保持原位且未释放空间。'

// 从 runtime 目录名解析出版本-平台-架构三元组。
// 例：1.0.23-win32-x64 -> { version: '1.0.23', platform: 'win32', arch: 'x64' }
// 版本部分必须以数字开头（避免把任意 X-Y-Z 目录误判为 runtime）。
function parseRuntimeDirName(name) {
  if (typeof name !== 'string') return null
  const match = name.match(/^(.+)-([A-Za-z0-9]+)-([A-Za-z0-9]+)$/)
  if (!match) return null
  if (!/^\d/.test(match[1])) return null // 版本须以数字开头
  return { version: match[1], platform: match[2], arch: match[3] }
}

// 判定一个 runtime 目录名是否就是当前正在使用的 runtime。
function isCurrentRuntime(name, { version, platform = process.platform, arch = process.arch } = {}) {
  const parsed = parseRuntimeDirName(name)
  if (!parsed) return false
  return parsed.version === String(version) &&
    parsed.platform === String(platform) &&
    parsed.arch === String(arch)
}

/**
 * 判断某个路径是否为当前 runtime 目录（或其父目录）。
 */
async function isCurrentRuntimePath(target, { version, platform, arch, root }) {
  const base = path.basename(target)
  if (base === ROOT_ENTRY_NAMES.runtime) return { current: false, reason: null }
  if (isCurrentRuntime(base, { version, platform, arch })) {
    return { current: true, reason: '当前 runtime 目录不可清理。' }
  }
  return { current: false, reason: null }
}

function isMarketplaceOrCache(name, kind) {
  const lower = String(name).toLowerCase()
  if (kind !== 'dsh-home') return false
  return lower === 'cache' || lower === 'caches'
}

function isMarketplaceRoot(name) {
  const lower = String(name).toLowerCase()
  return lower === 'marketplace' || lower.startsWith('marketplace-')
}

function normalizeCanonicalPath(value) {
  const resolved = path.resolve(String(value || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function snapshotFileIdentity(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    mode: Number(info.mode),
    size: Number(info.size),
    mtimeMs: Number(info.mtimeMs),
    birthtimeMs: Number(info.birthtimeMs)
  }
}

function snapshotRootIdentity(info, canonicalRootPath) {
  const identity = snapshotFileIdentity(info)
  return {
    canonicalRootPath,
    rootDev: identity.dev,
    rootIno: identity.ino,
    rootMode: identity.mode,
    rootSize: identity.size,
    rootMtimeMs: identity.mtimeMs,
    rootBirthtimeMs: identity.birthtimeMs
  }
}

function sameIdentityKeys(keys, left, right) {
  return Boolean(left && right && keys.every(key => left[key] === right[key]))
}

function sameFileIdentity(left, right) {
  return sameIdentityKeys(FILE_IDENTITY_KEYS, left, right)
}

function isCleanupIsolationName(name) {
  return String(name || '').toLowerCase().startsWith(ISOLATION_DIRECTORY_PREFIX)
}

function resolveCanonicalContained(candidate, root) {
  const normalizedRoot = normalizeCanonicalPath(root)
  const normalizedCandidate = normalizeCanonicalPath(candidate)
  return resolveContained(normalizedCandidate, normalizedRoot)
}

function cacheCandidateSignature(candidate) {
  const identity = candidate?.identity || {}
  return JSON.stringify([
    normalizeCanonicalPath(identity.canonicalPath || candidate?.path),
    candidate?.kind,
    candidate?.name,
    Number(candidate?.size),
    Number(candidate?.ageMs),
    ...CACHE_IDENTITY_KEYS.map(key => identity[key] ?? null)
  ])
}

function areCachePlansEquivalent(left, right) {
  const signatures = plan => (plan?.deletions || [])
    .filter(candidate => candidate?.kind === 'cache')
    .map(cacheCandidateSignature)
    .sort()
  const leftSignatures = signatures(left)
  const rightSignatures = signatures(right)
  return leftSignatures.length === rightSignatures.length &&
    leftSignatures.every((signature, index) => signature === rightSignatures[index])
}

class StorageCleanupService {
  /**
   * @param {object} [options]
   *   now: () => number
   *   version/ platform/ arch:  用于识别当前 runtime（默认取 process）。
   *   scanFs?: { lstat, readdir, realpath } 只读扫描注入（测试可选）。
   *
   * Node/Electron 当前没有 cross-platform delete-by-handle/openat/unlinkat。
   * 因而 apply 只复核授权并明确拒绝，不执行任何可重绑定路径上的 mutation。
   */
  constructor(options = {}) {
    this.now = options.now || (() => Date.now())
    this.version = options.version || '0.0.0'
    this.platform = options.platform || process.platform
    this.arch = options.arch || process.arch
    this.scanFs = options.scanFs || null
  }

  /**
   * 生成清理计划（永远不会真正删除，除非 preview=false 且传入 apply）。
   * @param {string} root HarnessData 根目录。
   * @param {object} [options]
   *   preview?: boolean        默认 true（只计算不删除）。
   *   tempEntries?: string[]   temp 下显式指定、且须超过 ageMs 的条目名。
   *   tempAgeMs?: number       应对 temp 条目生效的年龄阈值。
   *   now?                     （交给 this.now）。
   */
  async plan(root, options = {}) {
    const preview = options.preview !== false
    const rootAbs = typeof root === 'string' ? path.resolve(root) : root
    const snapshotNow = Number.isFinite(Number(options.referenceNowMs)) ? Number(options.referenceNowMs) : this.now()
    const tempAgeMs = Number.isFinite(Number(options.tempAgeMs)) ? Number(options.tempAgeMs) : null
    const cacheMinAgeMs = Number.isFinite(Number(options.cacheMinAgeMs)) ? Math.max(0, Number(options.cacheMinAgeMs)) : null
    const requestedTemp = Array.isArray(options.tempEntries)
      ? new Set(options.tempEntries.map(String))
      : new Set()
    const includeOldRuntimes = options.includeOldRuntimes !== false
    const includeCaches = options.includeCaches !== false
    const categories = []
    if (includeOldRuntimes) categories.push('runtime')
    if (includeCaches) categories.push('dsh-home')
    if (requestedTemp.size > 0) categories.push('temp')
    const report = await scanHarnessData(rootAbs, {
      now: () => snapshotNow,
      categories,
      pruneProtected: true,
      shouldPruneEntry: ({ name, kind }) => kind === 'runtime' && isCurrentRuntime(name, {
        version: this.version,
        platform: this.platform,
        arch: this.arch
      }),
      fs: this.scanFs
    })

    const deletions = []

    // 1) runtime 下的旧版本目录（排除当前 runtime）。
    const runtimeCategory = report.categories['runtime']
    if (includeOldRuntimes && runtimeCategory?.exists) {
      for (const entry of runtimeCategory.entries || []) {
        if (entry.suspicious || entry.protectedDescendant || entry.suspiciousDescendant || entry.truncated) continue
        const parsed = parseRuntimeDirName(entry.name)
        if (!parsed) continue
        if (isCurrentRuntime(entry.name, { version: this.version, platform: this.platform, arch: this.arch })) continue
        deletions.push(this.#buildCandidate('runtime-old', entry, rootAbs, preview))
      }
    }

    // 2) dsh-home 下的 marketplace / cache 缓存目录。
    const homeCategory = report.categories['dsh-home']
    if (includeCaches && homeCategory?.exists) {
      for (const entry of homeCategory.entries || []) {
        if (entry.suspicious || entry.protected) continue
        if (isMarketplaceOrCache(entry.name, 'dsh-home')) {
          if (entry.protectedDescendant || entry.suspiciousDescendant || entry.truncated) continue
          const candidate = this.#buildCandidate('cache', entry, rootAbs, preview)
          if (cacheMinAgeMs == null || Number(candidate.ageMs) >= cacheMinAgeMs) deletions.push(candidate)
          continue
        }
        if (isMarketplaceRoot(entry.name)) {
          const cachePath = path.join(entry.path, 'cache')
          const contained = resolveContained(cachePath, rootAbs)
          if (!contained) continue
          const escape = await isSymlinkEscaping(contained, rootAbs, { fs: this.scanFs })
          if (escape.escaping || escape.symlink) continue
          const info = await this.#lstat(contained)
          if (!info?.isDirectory() || info.isSymbolicLink()) continue
          const scanned = await scanTree(
            contained,
            rootAbs,
            { remaining: MAX_SCAN_ENTRIES },
            { fs: this.scanFs, pruneProtected: true }
          )
          if (scanned.skipped || scanned.protectedDescendant || scanned.suspiciousDescendant || scanned.truncated) continue
          const observedMtimeMs = scanned.mtimeMs ?? info.mtimeMs
          const candidate = this.#buildCandidate('cache', {
            name: `${entry.name}/cache`,
            path: contained,
            size: scanned.size || 0,
            mtimeMs: observedMtimeMs,
            ageMs: Math.max(0, snapshotNow - observedMtimeMs),
            protected: false
          }, rootAbs, preview)
          if (cacheMinAgeMs == null || Number(candidate.ageMs) >= cacheMinAgeMs) deletions.push(candidate)
        }
      }
    }

    // 3) temp 下由用户显式指定、且超过年龄阈值的条目。
    if (requestedTemp.size > 0) {
      const tempCategory = report.categories['temp']
      if (tempCategory?.exists) {
        for (const entry of tempCategory.entries || []) {
          if (entry.suspicious || entry.protected || entry.protectedDescendant || entry.suspiciousDescendant || entry.truncated) continue
          // Failed/partial isolation is recovery-only state. Never make its unpredictable
          // container eligible for a later broad or explicitly named cleanup pass.
          if (isCleanupIsolationName(entry.name)) continue
          if (!requestedTemp.has(entry.name)) continue
          if (tempAgeMs == null) continue // 未给出年龄阈值则不清理 temp
          if (entry.ageMs == null || entry.ageMs < tempAgeMs) continue
          deletions.push(this.#buildCandidate('temp', entry, rootAbs, preview))
        }
      }
    }

    return this.#finalizePlan(rootAbs, preview, deletions, options.approvedCandidates)
  }

  /**
   * 自动维护 shadow/rollback 使用的 legacy-candidate oracle。
   * 候选规则独立按 legacy 路径形状重建，但扫描面同样只限明确 cache 目标。
   */
  async planCacheOnlyLegacy(root, options = {}) {
    const preview = options.preview !== false
    const rootAbs = typeof root === 'string' ? path.resolve(root) : root
    const homeAbs = path.join(rootAbs, ROOT_ENTRY_NAMES.dshHome)
    const snapshotNow = Number.isFinite(Number(options.referenceNowMs)) ? Number(options.referenceNowMs) : this.now()
    const cacheMinAgeMs = Number.isFinite(Number(options.cacheMinAgeMs)) ? Math.max(0, Number(options.cacheMinAgeMs)) : null
    const deletions = []

    if (options.includeCaches !== false) {
      const report = await scanCacheOnly(rootAbs, { now: () => snapshotNow, fs: this.scanFs })
      const homeCategory = report.categories['dsh-home']
      if (homeCategory?.exists) {
        for (const entry of homeCategory.entries || []) {
          if (entry.suspicious || entry.protected || entry.protectedDescendant || entry.suspiciousDescendant || entry.truncated) continue
          const contained = resolveContained(entry.path, homeAbs)
          if (!contained || contained === homeAbs) continue
          const parts = path.relative(homeAbs, contained).split(path.sep).filter(Boolean)
          let legacyName = null
          if (parts.length === 1 && isMarketplaceOrCache(parts[0], 'dsh-home')) {
            legacyName = parts[0]
          } else if (parts.length === 2 && isMarketplaceRoot(parts[0]) && parts[1].toLowerCase() === 'cache') {
            legacyName = `${parts[0]}/cache`
          }
          if (!legacyName) continue
          const candidate = this.#buildCandidate('cache', { ...entry, name: legacyName, path: contained }, rootAbs, preview)
          if (cacheMinAgeMs == null || Number(candidate.ageMs) >= cacheMinAgeMs) deletions.push(candidate)
        }
      }
    }

    return this.#finalizePlan(rootAbs, preview, deletions, options.approvedCandidates)
  }

  /** 自动维护专用 planner：只扫描明确允许的 cache 目录。 */
  async planCacheOnly(root, options = {}) {
    const preview = options.preview !== false
    const rootAbs = typeof root === 'string' ? path.resolve(root) : root
    const snapshotNow = Number.isFinite(Number(options.referenceNowMs)) ? Number(options.referenceNowMs) : this.now()
    const cacheMinAgeMs = Number.isFinite(Number(options.cacheMinAgeMs)) ? Math.max(0, Number(options.cacheMinAgeMs)) : null
    const deletions = []

    if (options.includeCaches !== false) {
      const report = await scanCacheOnly(rootAbs, { now: () => snapshotNow, fs: this.scanFs })
      const homeCategory = report.categories['dsh-home']
      if (homeCategory?.exists) {
        for (const entry of homeCategory.entries || []) {
          if (entry.suspicious || entry.protected || entry.protectedDescendant || entry.suspiciousDescendant || entry.truncated) continue
          const candidate = this.#buildCandidate('cache', entry, rootAbs, preview)
          if (cacheMinAgeMs == null || Number(candidate.ageMs) >= cacheMinAgeMs) deletions.push(candidate)
        }
      }
    }

    return this.#finalizePlan(rootAbs, preview, deletions, options.approvedCandidates)
  }

  async #finalizePlan(rootAbs, preview, candidates, approvedCandidates) {
    let deletions = []
    for (const candidate of candidates) {
      const identity = await this.#captureIdentity(candidate.path, rootAbs, candidate.observedMtimeMs)
      if (identity) deletions.push({ ...candidate, identity })
    }

    let applied = []
    if (!preview) {
      if (!Array.isArray(approvedCandidates)) throw new Error('执行存储清理必须绑定已确认的预览快照。')
      const approved = new Map(approvedCandidates.map(candidate => [String(candidate?.path || ''), candidate]))
      deletions = deletions.filter(candidate => this.#matchesApproved(candidate, approved.get(candidate.path)))
      for (const candidate of deletions) {
        const expected = approved.get(candidate.path)
        // 即使最终身份仍匹配，也不能把路径核验冒充成 delete-by-handle。
        // Node/Electron 没有 cross-platform openat/unlinkat 或递归句柄删除；
        // rm/rename/rmdir 均可在调用入口被重绑定。因此 fail closed，完全不触发 mutation。
        if (!(await this.#verifyDeletable(candidate.path, rootAbs))) continue
        const finalIdentity = await this.#captureIdentity(candidate.path, rootAbs, candidate.observedMtimeMs)
        if (!finalIdentity || !this.#sameIdentity(expected.identity, finalIdentity)) continue
        applied.push({
          ...candidate,
          action: 'refused',
          applied: false,
          freedBytes: 0,
          error: SAFE_RECURSIVE_DELETE_UNAVAILABLE,
          mutation: {
            rename: 'not-attempted',
            recursiveDelete: 'unsupported'
          },
          recovery: {
            required: false,
            state: 'original-retained',
            path: candidate.path
          }
        })
      }
    }

    const candidateBytes = deletions.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
    const retained = applied.filter(item => !item.applied && item.recovery?.state === 'original-retained')
    return {
      root: rootAbs,
      preview,
      deletions,
      applied: preview ? null : applied,
      applyCapability: {
        supported: false,
        mode: 'preview-only',
        reason: SAFE_RECURSIVE_DELETE_UNAVAILABLE
      },
      summary: {
        candidates: deletions.length,
        candidateBytes,
        freedBytes: 0,
        retainedEntries: preview ? 0 : retained.length,
        retainedBytes: preview ? 0 : retained.reduce((sum, item) => sum + (Number(item.size) || 0), 0)
      }
    }
  }

  // -- 内部 ---------------------------------------------------------------

  #buildCandidate(reason, entry, rootAbs, preview) {
    return {
      kind: reason,
      name: entry.name,
      path: entry.path,
      size: entry.size || 0,
      ageMs: entry.ageMs ?? null,
      observedMtimeMs: Number.isFinite(Number(entry.mtimeMs)) ? Number(entry.mtimeMs) : null,
      protected: entry.protected || false,
      preview,
      action: preview ? 'preview' : 'verify-only'
    }
  }

  async #lstat(target) {
    const operation = this.scanFs?.lstat || lstat
    try { return await operation(target) } catch { return null }
  }

  async #realpath(target) {
    const operation = this.scanFs?.realpath || realpath
    try { return await operation(target) } catch { return null }
  }

  async #captureIdentity(target, rootAbs, observedMtimeMs) {
    // lexical gate stays authoritative for caller-controlled paths. Canonical paths are
    // a second, independent gate and must be compared against the canonical root from
    // the same capture (Windows may spell TEMP through short/long-name or case aliases).
    const contained = resolveContained(target, rootAbs)
    if (!contained || contained === rootAbs) return null

    const rootInfoBefore = await this.#lstat(rootAbs)
    if (!rootInfoBefore || rootInfoBefore.isSymbolicLink() || !rootInfoBefore.isDirectory()) return null
    const canonicalRootBeforeRaw = await this.#realpath(rootAbs)
    if (!canonicalRootBeforeRaw) return null
    const canonicalRootBefore = normalizeCanonicalPath(canonicalRootBeforeRaw)
    const rootIdentityBefore = snapshotFileIdentity(rootInfoBefore)

    const escapeBefore = await isSymlinkEscaping(contained, rootAbs, { fs: this.scanFs })
    if (escapeBefore.escaping || escapeBefore.symlink) return null
    const infoBefore = await this.#lstat(contained)
    if (!infoBefore || infoBefore.isSymbolicLink() || !infoBefore.isDirectory()) return null
    const canonicalPathBeforeRaw = await this.#realpath(contained)
    if (!canonicalPathBeforeRaw) return null
    const canonicalPathBefore = normalizeCanonicalPath(canonicalPathBeforeRaw)
    const canonicalContainedBefore = resolveCanonicalContained(canonicalPathBefore, canonicalRootBefore)
    if (!canonicalContainedBefore || canonicalContainedBefore === canonicalRootBefore) return null
    const identityBefore = snapshotFileIdentity(infoBefore)

    // Re-read both target and root so alias drift, replacement, and reparse races fail
    // closed before an identity can enter a preview or authorize an apply.
    const canonicalPathAfterRaw = await this.#realpath(contained)
    const infoAfter = await this.#lstat(contained)
    if (!canonicalPathAfterRaw || !infoAfter || infoAfter.isSymbolicLink() || !infoAfter.isDirectory()) return null
    const canonicalPathAfter = normalizeCanonicalPath(canonicalPathAfterRaw)
    const identityAfter = snapshotFileIdentity(infoAfter)
    const escapeAfter = await isSymlinkEscaping(contained, rootAbs, { fs: this.scanFs })
    if (escapeAfter.escaping || escapeAfter.symlink) return null

    const canonicalRootAfterRaw = await this.#realpath(rootAbs)
    const rootInfoAfter = await this.#lstat(rootAbs)
    if (!canonicalRootAfterRaw || !rootInfoAfter || rootInfoAfter.isSymbolicLink() || !rootInfoAfter.isDirectory()) return null
    const canonicalRootAfter = normalizeCanonicalPath(canonicalRootAfterRaw)
    const rootIdentityAfter = snapshotFileIdentity(rootInfoAfter)
    const canonicalContainedAfter = resolveCanonicalContained(canonicalPathAfter, canonicalRootAfter)

    if (canonicalRootBefore !== canonicalRootAfter || !sameFileIdentity(rootIdentityBefore, rootIdentityAfter)) return null
    if (canonicalPathBefore !== canonicalPathAfter || !sameFileIdentity(identityBefore, identityAfter)) return null
    if (!canonicalContainedAfter || canonicalContainedAfter === canonicalRootAfter) return null

    return {
      canonicalPath: canonicalPathAfter,
      ...identityAfter,
      ...snapshotRootIdentity(rootInfoAfter, canonicalRootAfter),
      observedMtimeMs: Number.isFinite(Number(observedMtimeMs)) ? Number(observedMtimeMs) : null
    }
  }

  #sameIdentity(left, right) {
    return sameIdentityKeys(CACHE_IDENTITY_KEYS, left, right)
  }

  #matchesApproved(candidate, approved) {
    return Boolean(approved &&
      approved.path === candidate.path &&
      approved.kind === candidate.kind &&
      approved.name === candidate.name &&
      Number(approved.size) === Number(candidate.size) &&
      this.#sameIdentity(approved.identity, candidate.identity))
  }

  /**
   * 二次安全校验：路径必须在根内、不是符号链接（或未逃逸）、
   * 不是受保护子树、不是当前 runtime。
   */
  async #verifyDeletable(target, rootAbs) {
    const contained = resolveContained(target, rootAbs)
    if (contained === null) return false
    const base = path.basename(contained)
    if (contained === rootAbs) return false
    if (PROTECTED_BASENAMES.has(base.toLowerCase())) return false
    if (base === ROOT_ENTRY_NAMES.runtime || isCleanupIsolationName(base)) return false
    const escape = await isSymlinkEscaping(contained, rootAbs, { fs: this.scanFs })
    if (escape.escaping || escape.symlink) return false
    // 若目标本身是符号链接/重解析点直接拒绝（不清链接后的悬挂目标）。
    const info = await this.#lstat(contained)
    if (!info || info.isSymbolicLink()) return false
    // 当前 runtime 目录也拒绝。
    if (contained !== path.join(rootAbs, ROOT_ENTRY_NAMES.runtime) &&
        isCurrentRuntime(base, { version: this.version, platform: this.platform, arch: this.arch })) {
      return false
    }
    return true
  }
}

module.exports = {
  StorageCleanupService,
  areCachePlansEquivalent,
  isCurrentRuntime,
  isMarketplaceOrCache,
  parseRuntimeDirName
}
