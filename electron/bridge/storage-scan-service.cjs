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

const { lstat, readdir, realpath, stat } = require('node:fs/promises')
const path = require('node:path')

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

async function lazyStat(target) {
  try { return await stat(target) } catch { return null }
}

async function lazyLstat(target) {
  try { return await lstat(target) } catch { return null }
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
async function isSymlinkEscaping(target, root) {
  const relative = path.relative(root, target)
  if (relative === '') return { escaping: false }
  const parts = relative.split(path.sep)
  let current = root
  for (const part of parts) {
    if (part === '' || part === '.') continue
    current = path.join(current, part)
    const info = await lazyLstat(current)
    if (!info) break
    if (info.isSymbolicLink()) {
      const real = await realpath(current).catch(() => null)
      if (!real || resolveContained(real, root) === null) return { escaping: true, at: real || current }
    }
  }
  return { escaping: false }
}

/**
 * 只读扫描一个目录，返回：
 * { path, size, entryCount, fileCount, dirCount, mtimeMs, createdMs }
 * 跳过权限不足、已被删除或符号链接逃逸的条目。
 */
async function scanTree(target, root, budget = { remaining: MAX_SCAN_ENTRIES }) {
  if (budget.remaining <= 0) return { size: 0, entryCount: 0, fileCount: 0, dirCount: 0 }
  const info = await lazyStat(target)
  if (!info) return { size: 0, entryCount: 0, fileCount: 0, dirCount: 0 }

  // 防止符号链接逃逸：若本目录本身是指向根之外的链接，跳过。
  const escape = await isSymlinkEscaping(target, root)
  if (escape.escaping) {
    return {
      size: 0,
      entryCount: 0,
      fileCount: 0,
      dirCount: 0,
      skipped: true,
      skipReason: 'symlink-escape'
    }
  }

  budget.remaining -= 1
  let size = 0
  let fileCount = 0
  let dirCount = 0
  let entryCount = 0
  let latestMtimeMs = info.mtimeMs

  if (info.isFile()) {
    size = info.size
    fileCount = 1
    entryCount = 1
    return { size, entryCount, fileCount, dirCount: 0, mtimeMs: info.mtimeMs, createdMs: info.ctimeMs }
  }

  // 目录（或其它）：枚举子项。
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch {
    return { size: 0, entryCount: 0, fileCount: 0, dirCount: 0, skipped: true, skipReason: 'read-failed' }
  }

  for (const entry of entries) {
    if (budget.remaining <= 0) break
    const child = path.join(target, entry.name)
    const childEscape = await isSymlinkEscaping(child, root)
    if (childEscape.escaping) continue // 跳过逃逸符号链接
    const childInfo = await lazyLstat(child)
    if (!childInfo) continue
    if (childInfo.isSymbolicLink()) {
      // 符号链接本身不计数为文件/目录体积，避免把外部内容算进来。
      continue
    }
    if (childInfo.isDirectory()) {
      const sub = await scanTree(child, root, budget)
      size += sub.size
      fileCount += sub.fileCount
      dirCount += sub.dirCount + 1
      entryCount += sub.entryCount + 1
      if (Number.isFinite(sub.mtimeMs)) latestMtimeMs = Math.max(latestMtimeMs, sub.mtimeMs)
    } else if (childInfo.isFile()) {
      size += childInfo.size
      fileCount += 1
      entryCount += 1
      latestMtimeMs = Math.max(latestMtimeMs, childInfo.mtimeMs)
    } else {
      entryCount += 1
    }
  }

  return {
    size,
    entryCount,
    fileCount,
    dirCount,
    mtimeMs: latestMtimeMs,
    createdMs: info.ctimeMs
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
  const requested = Array.isArray(options.categories) && options.categories.length
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
    categories[entry.key] = await scanCategory(entry.dir, { kind: entry.kind, now, root: rootAbs })
  }

  return { root: rootAbs, categories, scannedAt: new Date(now()).toISOString() }
}

/**
 * 扫描单个分类目录下的直接子目录，并对每个子目录给出分类和受保护标记。
 */
async function scanCategory(dir, { kind, now, root }) {
  const info = await lazyStat(dir)
  if (!info) {
    return { path: dir, kind, exists: false, size: 0, entries: [] }
  }
  const escape = await isSymlinkEscaping(dir, root)
  if (escape.escaping) {
    return { path: dir, kind, exists: true, size: 0, entries: [], skipped: true, skipReason: 'symlink-escape' }
  }

  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return { path: dir, kind, exists: true, size: 0, entries: [], skipped: true, skipReason: 'read-failed' }
  }

  const entries = []
  for (const name of names) {
    const full = path.join(dir, name)
    const childEscape = await isSymlinkEscaping(full, root)
    if (childEscape.escaping) {
      entries.push({ name, path: full, kind, size: 0, entryCount: 0, mtimeMs: null, protected: false, suspicious: 'symlink-escape' })
      continue
    }
    const childInfo = await lazyLstat(full)
    if (!childInfo) continue
    if (childInfo.isSymbolicLink()) {
      entries.push({ name, path: full, kind, size: 0, entryCount: 0, mtimeMs: null, protected: false, suspicious: 'symlink' })
      continue
    }
    const scanResult = childInfo.isDirectory() ? await scanTree(full, root) : scanTreeFile(full, childInfo)
    const protectedFlag = isProtectedName(name) || isProtectedName(full)
    entries.push({
      name,
      path: full,
      kind,
      size: scanResult.size,
      entryCount: scanResult.entryCount,
      mtimeMs: scanResult.mtimeMs,
      protected: protectedFlag,
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
  scanCategory,
  scanHarnessData,
  scanTree
}
