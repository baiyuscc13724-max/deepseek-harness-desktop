// storage-scan-service.cjs
//
// HarnessData 存储只读扫描服务（批次3的底层模块）。
//
// 只做「读」：枚举 / 分类 / 统计 HarnessData 下各分类条目及体积、年龄，
// 绝不删除或写回。路径安全是第一优先级：
//   * 所有路径都必须落在根目录（HarnessData）之内 —— 防根目录/父目录逃逸。
//   * 拒绝穿越：规范化后仍超出根目录的路径直接判为危险。
//   * 拒绝符号链接指向根目录外的目录（防符号链接逃逸）。
//
// 分类映射到真实 HarnessData 布局：
//   runtime  -> <root>/runtime/<version>-<platform>-<arch>
//   dsh-home -> <root>/dsh-home (包含 sessions/attachments/marketplace/…)
//   temp     -> <root>/temp
//   workspace-> <root>/workspace
// 其中 runtime/sessions/attachments/memories 等受保护子树会被显式标记，
// 供清理服务引用（本扫描器自身不改动任何文件）。

const { lstat, readdir, realpath } = require('node:fs/promises')
const path = require('node:path')

const DEFAULT_SCAN_FS = Object.freeze({ lstat, readdir, realpath })

function resolveScanFs(options = {}) {
  if (!options.fs) return DEFAULT_SCAN_FS
  return {
    lstat: options.fs.lstat || lstat,
    readdir: options.fs.readdir || readdir,
    realpath: options.fs.realpath || realpath
  }
}

// HarnessData 顶层目录名。
const ROOT_ENTRY_NAMES = Object.freeze({
  runtime: 'runtime',
  dshHome: 'dsh-home',
  temp: 'temp',
  workspace: 'workspace'
})

// 受保护子树（无论位于何处都绝不允许清理）：basename 集合。
// sessions/attachments/memories 属于 DSH_HOME 下的用户数据。
const PROTECTED_BASENAMES = Object.freeze(
  new Set(['sessions', 'attachments', 'memories', 'runtime'])
)

// 单次扫描最多访问的条目数，防止意外放大（防御性上限）。
const MAX_SCAN_ENTRIES = 200_000

async function lazyLstat(target, fs = DEFAULT_SCAN_FS) {
  try { return await fs.lstat(target) } catch { return null }
}

/**
 * 规范化路径并校验其是否被根目录包含。
 * @param {string} candidate 待校验路径。
 * @param {string} root       已被 resolve 的根目录。
 * @returns {string|null} 规范化后的受控路径；危险返回 null。
 */
function resolveContained(candidate, root) {
  const normalized = path.resolve(String(candidate || ''))
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  if (normalized === root) return root
  if (!normalized.startsWith(rootWithSep)) return null
  return normalized
}

/**
 * 判断一个普通目录路径是否真的位于受控目录之内（防符号链接逃逸）。
 * 会沿 path 逐层检查是否存在指向受控根之外的符号链接。
 */
async function isSymlinkEscaping(target, root, options = {}) {
  const fs = resolveScanFs(options)
  const relative = path.relative(root, target)
  if (relative === '') return { escaping: false, symlink: false }
  const parts = relative.split(path.sep)
  let current = root
  let symlinkAt = null
  for (const part of parts) {
    if (part === '' || part === '.') continue
    current = path.join(current, part)
    const info = await lazyLstat(current, fs)
    if (!info) break
    if (info.isSymbolicLink()) {
      symlinkAt ||= current
      let real = null
      try { real = await fs.realpath(current) } catch {}
      if (!real || resolveContained(real, root) === null) {
        return { escaping: true, symlink: true, at: real || current }
      }
    }
  }
  return { escaping: false, symlink: Boolean(symlinkAt), at: symlinkAt || undefined }
}

/**
 * 只读扫描一个目录，返回：
 * { path, size, entryCount, fileCount, dirCount, mtimeMs, createdMs }
 * 跳过权限不足、已被删除或符号链接逃逸的条目。
 */
async function scanTree(target, root, budget = { remaining: MAX_SCAN_ENTRIES }, options = {}) {
  const fs = resolveScanFs(options)
  if (budget.remaining <= 0) {
    return {
      size: 0,
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      truncated: true,
      skipped: true,
      skipReason: 'budget-exhausted'
    }
  }
  if (options.pruneProtected && isProtectedName(path.basename(target))) {
    return {
      size: 0,
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      protectedDescendant: true,
      skipped: true,
      skipReason: 'protected-subtree'
    }
  }

  const info = await lazyLstat(target, fs)
  if (!info) {
    return {
      size: 0,
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      suspiciousDescendant: true,
      skipped: true,
      skipReason: 'stat-failed'
    }
  }
  if (info.isSymbolicLink()) {
    return {
      size: 0,
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      suspiciousDescendant: true,
      skipped: true,
      skipReason: 'symlink'
    }
  }

  // 任一路径分量是符号链接/重解析点时都不递归，即使其目标仍在根内。
  const escape = await isSymlinkEscaping(target, root, { fs })
  if (escape.escaping || escape.symlink) {
    return {
      size: 0,
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      suspiciousDescendant: true,
      skipped: true,
      skipReason: escape.escaping ? 'symlink-escape' : 'symlink'
    }
  }

  budget.remaining -= 1
  let size = 0
  let fileCount = 0
  let dirCount = 0
  let entryCount = 0
  let latestMtimeMs = info.mtimeMs
  let protectedDescendant = false
  let suspiciousDescendant = false
  let truncated = false

  if (info.isFile()) {
    size = info.size
    fileCount = 1
    entryCount = 1
    return { size, entryCount, fileCount, dirCount: 0, mtimeMs: info.mtimeMs, createdMs: info.ctimeMs }
  }

  // 目录（或其它）：枚举子项。
  let entries
  try {
    entries = await fs.readdir(target, { withFileTypes: true })
  } catch {
    return { size: 0, entryCount: 0, fileCount: 0, dirCount: 0, skipped: true, skipReason: 'read-failed' }
  }

  for (const entry of entries) {
    if (budget.remaining <= 0) {
      truncated = true
      break
    }
    // 在任何 lstat/realpath/readdir 前按 basename 剪掉受保护子树。
    if (options.pruneProtected && isProtectedName(entry.name)) {
      protectedDescendant = true
      continue
    }
    const child = path.join(target, entry.name)
    const childEscape = await isSymlinkEscaping(child, root, { fs })
    if (childEscape.escaping || childEscape.symlink) {
      budget.remaining -= 1
      suspiciousDescendant = true
      continue
    }
    const childInfo = await lazyLstat(child, fs)
    if (!childInfo) {
      budget.remaining -= 1
      suspiciousDescendant = true
      continue
    }
    if (childInfo.isSymbolicLink()) {
      // 符号链接/重解析点本身不计数，也令整个候选 fail closed。
      budget.remaining -= 1
      suspiciousDescendant = true
      continue
    }
    if (childInfo.isDirectory()) {
      const sub = await scanTree(child, root, budget, { ...options, fs })
      size += sub.size
      fileCount += sub.fileCount
      dirCount += sub.dirCount + 1
      entryCount += sub.entryCount + 1
      protectedDescendant ||= Boolean(sub.protectedDescendant)
      suspiciousDescendant ||= Boolean(sub.suspiciousDescendant || sub.skipped)
      truncated ||= Boolean(sub.truncated)
      if (Number.isFinite(sub.mtimeMs)) latestMtimeMs = Math.max(latestMtimeMs, sub.mtimeMs)
    } else if (childInfo.isFile()) {
      budget.remaining -= 1
      size += childInfo.size
      fileCount += 1
      entryCount += 1
      latestMtimeMs = Math.max(latestMtimeMs, childInfo.mtimeMs)
    } else {
      budget.remaining -= 1
      entryCount += 1
    }
  }

  return {
    size,
    entryCount,
    fileCount,
    dirCount,
    mtimeMs: latestMtimeMs,
    createdMs: info.ctimeMs,
    protectedDescendant,
    suspiciousDescendant,
    truncated
  }
}

/**
 * 解析 HarnessData 根目录为受控 Paths 对象。
 * @param {string} root HarnessData 根目录。
 * @returns {object} 受控的 { root, runtime, dshHome, temp, workspace }。
 */
function runtimePaths(root, { resolver = (v) => path.resolve(v) } = {}) {
  const resolvedRoot = resolver(String(root || ''))
  return Object.freeze({
    root: resolvedRoot,
    runtime: path.join(resolvedRoot, ROOT_ENTRY_NAMES.runtime),
    dshHome: path.join(resolvedRoot, ROOT_ENTRY_NAMES.dshHome),
    temp: path.join(resolvedRoot, ROOT_ENTRY_NAMES.temp),
    workspace: path.join(resolvedRoot, ROOT_ENTRY_NAMES.workspace)
  })
}

/**
 * 只读扫描 HarnessData 下指定分类（默认全部）。
 * 返回带分类、体积、年龄标记的报告。绝不写回。
 * @param {string} root HarnessData 根目录。
 * @param {object} [options] { now?: () => number, categories?: string[] }
 */
async function scanHarnessData(root, options = {}) {
  const rootAbs = typeof root === 'string' ? path.resolve(root) : root
  const paths = runtimePaths(rootAbs)
  const now = options.now || (() => Date.now())
  const requested = Array.isArray(options.categories)
    ? new Set(options.categories.map(c => String(c)))
    : new Set(['runtime', 'dsh-home', 'temp', 'workspace'])

  const categoryEntries = [
    { key: 'runtime', dir: paths.runtime, kind: 'runtime' },
    { key: 'dsh-home', dir: paths.dshHome, kind: 'dsh-home' },
    { key: 'temp', dir: paths.temp, kind: 'temp' },
    { key: 'workspace', dir: paths.workspace, kind: 'workspace' }
  ]

  const categories = {}
  for (const entry of categoryEntries) {
    if (!requested.has(entry.key)) continue
    categories[entry.key] = await scanCategory(entry.dir, {
      kind: entry.kind,
      now,
      root: rootAbs,
      fs: options.fs,
      pruneProtected: options.pruneProtected === true,
      shouldPruneEntry: options.shouldPruneEntry
    })
  }

  return { root: rootAbs, categories, scannedAt: new Date(now()).toISOString() }
}

/**
 * 扫描单个分类目录下的直接子目录，并对每个子目录给出分类和受保护标记。
 */
async function scanCategory(dir, { kind, now, root, fs: suppliedFs, pruneProtected = false, shouldPruneEntry }) {
  const fs = resolveScanFs({ fs: suppliedFs })
  const info = await lazyLstat(dir, fs)
  if (!info) {
    return { path: dir, kind, exists: false, size: 0, entries: [] }
  }
  if (info.isSymbolicLink()) {
    return { path: dir, kind, exists: true, size: 0, entries: [], skipped: true, skipReason: 'symlink' }
  }
  const escape = await isSymlinkEscaping(dir, root, { fs })
  if (escape.escaping || escape.symlink) {
    return {
      path: dir,
      kind,
      exists: true,
      size: 0,
      entries: [],
      skipped: true,
      skipReason: escape.escaping ? 'symlink-escape' : 'symlink'
    }
  }

  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return { path: dir, kind, exists: true, size: 0, entries: [], skipped: true, skipReason: 'read-failed' }
  }

  const entries = []
  for (const name of names) {
    const full = path.join(dir, name)
    const dynamicallyProtected = pruneProtected && typeof shouldPruneEntry === 'function' &&
      shouldPruneEntry({ name, path: full, kind }) === true
    const protectedFlag = isProtectedName(name) || isProtectedName(full) || dynamicallyProtected
    if (pruneProtected && protectedFlag) {
      entries.push({
        name,
        path: full,
        kind,
        size: 0,
        entryCount: 0,
        mtimeMs: null,
        ageMs: null,
        protected: true,
        protectedReason: resolveProtectedReason(name, kind),
        pruned: true
      })
      continue
    }
    const childEscape = await isSymlinkEscaping(full, root, { fs })
    if (childEscape.escaping || childEscape.symlink) {
      entries.push({
        name,
        path: full,
        kind,
        size: 0,
        entryCount: 0,
        mtimeMs: null,
        protected: protectedFlag,
        suspicious: childEscape.escaping ? 'symlink-escape' : 'symlink'
      })
      continue
    }
    const childInfo = await lazyLstat(full, fs)
    if (!childInfo) continue
    if (childInfo.isSymbolicLink()) {
      entries.push({ name, path: full, kind, size: 0, entryCount: 0, mtimeMs: null, protected: protectedFlag, suspicious: 'symlink' })
      continue
    }
    const scanResult = childInfo.isDirectory()
      ? await scanTree(full, root, { remaining: MAX_SCAN_ENTRIES }, { fs, pruneProtected })
      : scanTreeFile(full, childInfo)
    entries.push({
      name,
      path: full,
      kind,
      size: scanResult.size,
      entryCount: scanResult.entryCount,
      mtimeMs: scanResult.mtimeMs,
      protected: protectedFlag,
      protectedDescendant: Boolean(scanResult.protectedDescendant),
      suspiciousDescendant: Boolean(scanResult.suspiciousDescendant),
      truncated: Boolean(scanResult.truncated),
      suspicious: scanResult.skipped ? scanResult.skipReason : undefined,
      // 只有明确受保护子树内的条目才标记为不可清理。
      protectedReason: protectedFlag ? resolveProtectedReason(name, kind) : null,
      ageMs: scanResult.mtimeMs != null ? Math.max(0, now() - scanResult.mtimeMs) : null
    })
  }

  const totalSize = entries.reduce((sum, entry) => sum + (entry.size || 0), 0)
  return {
    path: dir,
    kind,
    exists: true,
    size: totalSize,
    entryCount: entries.length,
    entries: entries.sort((a, b) => (b.size || 0) - (a.size || 0))
  }
}

function isDirectCacheName(name) {
  const lower = String(name).toLowerCase()
  return lower === 'cache' || lower === 'caches'
}

function isMarketplaceName(name) {
  const lower = String(name).toLowerCase()
  return lower === 'marketplace' || lower.startsWith('marketplace-')
}

async function scanCacheTarget(target, displayName, { root, now, fs, budget }) {
  const contained = resolveContained(target, root)
  if (!contained || contained === root || isProtectedName(path.basename(contained))) return null
  const linkState = await isSymlinkEscaping(contained, root, { fs })
  if (linkState.escaping || linkState.symlink) {
    return {
      name: displayName,
      path: contained,
      kind: 'dsh-home',
      size: 0,
      entryCount: 0,
      mtimeMs: null,
      ageMs: null,
      protected: false,
      suspicious: linkState.escaping ? 'symlink-escape' : 'symlink'
    }
  }
  const info = await lazyLstat(contained, fs)
  if (!info?.isDirectory() || info.isSymbolicLink()) return null
  const scanned = await scanTree(contained, root, budget, { fs, pruneProtected: true })
  return {
    name: displayName,
    path: contained,
    kind: 'dsh-home',
    size: scanned.size || 0,
    entryCount: scanned.entryCount || 0,
    mtimeMs: scanned.mtimeMs ?? null,
    ageMs: scanned.mtimeMs != null ? Math.max(0, now() - scanned.mtimeMs) : null,
    protected: false,
    protectedDescendant: Boolean(scanned.protectedDescendant),
    suspiciousDescendant: Boolean(scanned.suspiciousDescendant),
    truncated: Boolean(scanned.truncated),
    suspicious: scanned.skipped ? scanned.skipReason : scanned.truncated ? 'budget-exhausted' : undefined
  }
}

/**
 * 自动维护专用 cache-only 扫描。只枚举 dsh-home 根与明确允许的 cache 目标；
 * runtime/temp/workspace 以及 sessions/attachments/memories 在任何文件系统访问前剪枝。
 */
async function scanCacheOnly(root, options = {}) {
  const rootAbs = typeof root === 'string' ? path.resolve(root) : root
  const paths = runtimePaths(rootAbs)
  const now = options.now || (() => Date.now())
  const fs = resolveScanFs(options)
  const home = paths.dshHome
  const homeInfo = await lazyLstat(home, fs)
  if (!homeInfo) {
    return {
      root: rootAbs,
      categories: { 'dsh-home': { path: home, kind: 'dsh-home', exists: false, size: 0, entries: [] } },
      scannedAt: new Date(now()).toISOString()
    }
  }
  const homeLinkState = await isSymlinkEscaping(home, rootAbs, { fs })
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink() || homeLinkState.escaping || homeLinkState.symlink) {
    return {
      root: rootAbs,
      categories: {
        'dsh-home': {
          path: home,
          kind: 'dsh-home',
          exists: true,
          size: 0,
          entries: [],
          skipped: true,
          skipReason: homeLinkState.escaping ? 'symlink-escape' : 'symlink'
        }
      },
      scannedAt: new Date(now()).toISOString()
    }
  }

  let names
  try {
    names = await fs.readdir(home)
  } catch {
    return {
      root: rootAbs,
      categories: {
        'dsh-home': { path: home, kind: 'dsh-home', exists: true, size: 0, entries: [], skipped: true, skipReason: 'read-failed' }
      },
      scannedAt: new Date(now()).toISOString()
    }
  }

  const entries = []
  const budget = { remaining: MAX_SCAN_ENTRIES }
  for (const name of names) {
    // 名称足以判定保护/无关项；不要 lstat、realpath 或 readdir 它们。
    if (isProtectedName(name)) continue
    if (isDirectCacheName(name)) {
      const entry = await scanCacheTarget(path.join(home, name), name, { root: rootAbs, now, fs, budget })
      if (entry) entries.push(entry)
      continue
    }
    if (!isMarketplaceName(name)) continue
    const cachePath = path.join(home, name, 'cache')
    const entry = await scanCacheTarget(cachePath, `${name}/cache`, { root: rootAbs, now, fs, budget })
    if (entry) entries.push(entry)
  }

  const sorted = entries.sort((a, b) => (b.size || 0) - (a.size || 0))
  return {
    root: rootAbs,
    categories: {
      'dsh-home': {
        path: home,
        kind: 'dsh-home',
        exists: true,
        size: sorted.reduce((sum, entry) => sum + (entry.size || 0), 0),
        entryCount: sorted.length,
        entries: sorted
      }
    },
    scannedAt: new Date(now()).toISOString()
  }
}

function scanTreeFile(full, childInfo) {
  return { size: childInfo.size, entryCount: 1, mtimeMs: childInfo.mtimeMs }
}

function isProtectedName(name) {
  return PROTECTED_BASENAMES.has(String(name).toLowerCase())
}

function resolveProtectedReason(name, kind) {
  const lower = String(name).toLowerCase()
  if (PROTECTED_BASENAMES.has(lower)) return `受保护子树 ${lower}（用户数据，不可清理）。`
  return '受保护子树。'
}

module.exports = {
  MAX_SCAN_ENTRIES,
  PROTECTED_BASENAMES,
  ROOT_ENTRY_NAMES,
  isProtectedName,
  isSymlinkEscaping,
  resolveContained,
  resolveProtectedReason,
  runtimePaths,
  scanCacheOnly,
  scanCategory,
  scanHarnessData,
  scanTree
}
