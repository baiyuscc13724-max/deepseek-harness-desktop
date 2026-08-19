// storage-cleanup-service.cjs
//
// HarnessData 存储清理服务（批次3的底层模块）。
//
// 清理安全约束（严格遵守）：
//   * dry-run 预览优先：默认 preview=true，只计算并将要删除的条目列出，
//     绝不真正删除；只有 preview=false 时才执行删除。
//   * 只能清理这几类内容：
//       1) runtime 下「非当前」的旧版本 runtime 目录；
//       2) dsh-home 下的 marketplace 与 cache 类缓存目录；
//       3) temp 下由用户显式传入、且超过年龄阈值的条目。
//   * 绝不能删除 sessions / attachments / memories / 当前 runtime /
//     根目录本身 / 任何受保护子树。
//   * 防路径穿越、符号链接和根目录逃逸：所有目标必须受控在 HarnessData 之内，
//     且不得是符号链接或经符号链接逃逸的路径。
//
// 本服务配合 storage-scan-service 读取目录，但删除动作经过严格的
// apply 白名单判断，防止误删。

const { lstat, rm, stat } = require('node:fs/promises')
const path = require('node:path')
const {
  PROTECTED_BASENAMES,
  ROOT_ENTRY_NAMES,
  isSymlinkEscaping,
  resolveContained,
  scanHarnessData,
  scanTree
} = require('./storage-scan-service.cjs')

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

class StorageCleanupService {
  /**
   * @param {object} [options]
   *   now: () => number
   *   version/ platform/ arch:  用于识别当前 runtime（默认取 process）。
   *   fs?: { rm }               注入以便测试（可选）。
   */
  constructor(options = {}) {
    this.now = options.now || (() => Date.now())
    this.version = options.version || '0.0.0'
    this.platform = options.platform || process.platform
    this.arch = options.arch || process.arch
    this.fs = options.fs || { rm }
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
    const report = await scanHarnessData(rootAbs, { now: this.now })
    const tempAgeMs = Number.isFinite(Number(options.tempAgeMs)) ? Number(options.tempAgeMs) : null
    const cacheMinAgeMs = Number.isFinite(Number(options.cacheMinAgeMs)) ? Math.max(0, Number(options.cacheMinAgeMs)) : null
    const requestedTemp = Array.isArray(options.tempEntries)
      ? new Set(options.tempEntries.map(String))
      : new Set()

    let deletions = []
    const includeOldRuntimes = options.includeOldRuntimes !== false
    const includeCaches = options.includeCaches !== false

    // 1) runtime 下的旧版本目录（排除当前 runtime）。
    const runtimeCategory = report.categories['runtime']
    if (includeOldRuntimes && runtimeCategory?.exists) {
      for (const entry of runtimeCategory.entries || []) {
        if (entry.suspicious) continue // 符号链接/逃逸一律跳过
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
        if (entry.suspicious) continue
        if (entry.protected) continue // sessions/attachments/memories 被保护。
        if (isMarketplaceOrCache(entry.name, 'dsh-home')) {
          const candidate = this.#buildCandidate('cache', entry, rootAbs, preview)
          if (cacheMinAgeMs == null || Number(candidate.ageMs) >= cacheMinAgeMs) deletions.push(candidate)
          continue
        }
        if (isMarketplaceRoot(entry.name)) {
          const cachePath = path.join(entry.path, 'cache')
          const contained = resolveContained(cachePath, rootAbs)
          if (!contained) continue
          const info = await stat(contained).catch(() => null)
          if (!info?.isDirectory()) continue
          const escape = await isSymlinkEscaping(contained, rootAbs)
          if (escape.escaping) continue
          const scanned = await scanTree(contained, rootAbs)
          const candidate = this.#buildCandidate('cache', {
            name: `${entry.name}/cache`,
            path: contained,
            size: scanned.size || 0,
            ageMs: Math.max(0, this.now() - (scanned.mtimeMs || info.mtimeMs)),
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
          if (entry.suspicious) continue
          if (!requestedTemp.has(entry.name)) continue
          if (tempAgeMs == null) continue // 未给出年龄阈值则不清理 temp
          if (entry.ageMs == null || entry.ageMs < tempAgeMs) continue
          deletions.push(this.#buildCandidate('temp', entry, rootAbs, preview))
        }
      }
    }

    const identified = []
    for (const candidate of deletions) {
      const identity = await this.#captureIdentity(candidate.path, rootAbs)
      if (identity) identified.push({ ...candidate, identity })
    }
    deletions = identified

    let applied = []
    if (!preview) {
      if (!Array.isArray(options.approvedCandidates)) throw new Error('执行存储清理必须绑定已确认的预览快照。')
      const approved = new Map(options.approvedCandidates.map(candidate => [String(candidate?.path || ''), candidate]))
      deletions = deletions.filter(candidate => this.#matchesApproved(candidate, approved.get(candidate.path)))
      applied = []
      for (const candidate of deletions) {
        const expected = approved.get(candidate.path)
        // 执行删除前再次校验受控、非符号链接、非受保护，并核对文件身份。
        if (!(await this.#verifyDeletable(candidate.path, rootAbs))) continue
        const finalIdentity = await this.#captureIdentity(candidate.path, rootAbs)
        if (!finalIdentity || !this.#sameIdentity(expected.identity, finalIdentity)) continue
        try {
          await this.fs.rm(candidate.path, { recursive: true, force: true })
          applied.push({ ...candidate, applied: true })
        } catch (error) {
          applied.push({ ...candidate, applied: false, error: safeError(error) })
        }
      }
    }

    return {
      root: rootAbs,
      preview,
      deletions,
      applied: preview ? null : applied,
      summary: {
        candidates: deletions.length,
        freedBytes: deletions.reduce((sum, item) => sum + (item.size || 0), 0)
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
      protected: entry.protected || false,
      preview,
      action: preview ? 'preview' : 'delete'
    }
  }

  async #captureIdentity(target, rootAbs) {
    const contained = resolveContained(target, rootAbs)
    if (!contained || contained === rootAbs) return null
    const escape = await isSymlinkEscaping(contained, rootAbs)
    if (escape.escaping) return null
    const info = await lstat(contained).catch(() => null)
    if (!info || info.isSymbolicLink() || !info.isDirectory()) return null
    return {
      dev: String(info.dev),
      ino: String(info.ino),
      mode: Number(info.mode),
      size: Number(info.size),
      mtimeMs: Number(info.mtimeMs),
      birthtimeMs: Number(info.birthtimeMs)
    }
  }

  #sameIdentity(left, right) {
    if (!left || !right) return false
    return ['dev', 'ino', 'mode', 'size', 'mtimeMs', 'birthtimeMs'].every(key => left[key] === right[key])
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
    if (base === ROOT_ENTRY_NAMES.runtime) return false
    const escape = await isSymlinkEscaping(contained, rootAbs)
    if (escape.escaping) return false
    // 若目标本身是符号链接直接拒绝（不清符号链接后悬挂目标）。
    const info = await lstat(contained).catch(() => null)
    if (!info || info.isSymbolicLink()) return false
    // 当前 runtime 目录也拒绝。
    if (contained !== path.join(rootAbs, ROOT_ENTRY_NAMES.runtime) &&
        isCurrentRuntime(base, { version: this.version, platform: this.platform, arch: this.arch })) {
      return false
    }
    return true
  }
}

function safeError(error) {
  return String(error && error.message ? error.message : error)
}

module.exports = {
  StorageCleanupService,
  isCurrentRuntime,
  isMarketplaceOrCache,
  parseRuntimeDirName
}
