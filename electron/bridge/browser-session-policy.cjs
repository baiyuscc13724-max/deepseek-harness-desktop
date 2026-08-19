// 右栏内置浏览器会话分区策略（browser-session-policy）。
//
// 职责：为右栏内置浏览器固定一个独立、持久化的 Chromium 分区名，保证其
// Cookie、存储与缓存与官方 Harness 会话（persist:harness）完全隔离，互不
// 串档；同时为接入方提供分区名校验与策略 JSON 文件路径校验（路径安全）。
// 纯 Node 实现，无 Electron 依赖，可独立用 node:test 测试。

const path = require('node:path')

// 官方 Harness 主界面使用的持久化分区（不可共用、不可覆盖）。
const OFFICIAL_HARNESS_PARTITION = 'persist:harness'
// 官方分区的内存化别名（同样禁止）。
const OFFICIAL_HARNESS_PARTITION_ALIASES = new Set(['harness'])

// 右栏内置浏览器的固定独立分区：与官方 persist:harness 不同名、前缀 persist: 保证落盘。
const BROWSER_PARTITION = 'persist:harness-side-browser'

// Chromium 分区名长度上限（Electron 文档约束为 128 字符，留余量取 120）。
const MAX_PARTITION_LENGTH = 120
// 策略 JSON 文件路径长度上限。
const MAX_POLICY_PATH_LENGTH = 1024

const CONTROL_CHAR = /[\u0000-\u001f\u007f]/

/** 返回右栏浏览器固定分区名。 */
function resolveBrowserPartition() {
  return BROWSER_PARTITION
}

/** 是否为持久化分区（以 persist: 开头且非空名）。 */
function isPersistentPartition(name) {
  return typeof name === 'string' && name.startsWith('persist:') && name.length > 'persist:'.length
}

/** 是否属于官方 Harness 分区（严禁与模型浏览器共用）。 */
function isOfficialPartition(name) {
  return name === OFFICIAL_HARNESS_PARTITION || OFFICIAL_HARNESS_PARTITION_ALIASES.has(name)
}

/**
 * 校验接入方提供的分区名是否满足隔离要求。
 * @param {string} name 候选分区名。
 * @returns {string} 规范化后的分区名。
 * @throws 带 code 的策略错误（invalid-partition 或 official-partition）。
 */
function assertIndependentPartition(name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw policyError('invalid-partition', '分区名必须是字符串。')
  }
  if (CONTROL_CHAR.test(name)) throw policyError('invalid-partition', '分区名包含控制字符。')
  if (name.length > MAX_PARTITION_LENGTH) {
    throw policyError('invalid-partition', `分区名超过 ${MAX_PARTITION_LENGTH} 字符上限。`)
  }
  if (name.includes('/') || name.includes('\\')) {
    throw policyError('invalid-partition', '分区名不能包含路径分隔符。')
  }
  if (isOfficialPartition(name)) {
    throw policyError('official-partition', '禁止与官方 Harness 分区（persist:harness）共用。')
  }
  if (!isPersistentPartition(name)) {
    throw policyError('invalid-partition', '必须使用 persist: 前缀的持久化分区，禁止内存态分区。')
  }
  return name
}

/**
 * 校验策略 JSON 保存路径（路径安全）：普通文件路径、无控制字符、非 URL、
 * 若给定根目录则必须位于根目录之内。
 * @param {string} file 候选路径。
 * @param {{ rootDir?: string }} options
 * @returns {string} 解析后的绝对路径。
 * @throws 带 code 的策略错误（invalid-path 或 path-escape）。
 */
function assertSafePolicyPath(file, { rootDir } = {}) {
  if (typeof file !== 'string' || !file.trim()) {
    throw policyError('invalid-path', '策略文件路径必须是字符串。')
  }
  if (CONTROL_CHAR.test(file)) throw policyError('invalid-path', '策略文件路径包含控制字符。')
  if (file.length > MAX_POLICY_PATH_LENGTH) {
    throw policyError('invalid-path', `策略文件路径超过 ${MAX_POLICY_PATH_LENGTH} 字符上限。`)
  }
  if (file.includes('://') || /^(?:https?|file|data):/i.test(file)) {
    throw policyError('invalid-path', '策略文件路径不能是 URL。')
  }
  if (file.trim().startsWith('~')) throw policyError('invalid-path', '策略文件路径不支持 ~ 展开。')
  const resolved = path.resolve(file)
  if (rootDir != null) {
    const root = path.resolve(String(rootDir))
    if (resolved === root || !resolved.startsWith(root + path.sep)) {
      throw policyError('path-escape', '策略文件必须位于指定根目录之内。')
    }
  }
  return resolved
}

function policyError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

module.exports = {
  BROWSER_PARTITION,
  MAX_PARTITION_LENGTH,
  MAX_POLICY_PATH_LENGTH,
  OFFICIAL_HARNESS_PARTITION,
  OFFICIAL_HARNESS_PARTITION_ALIASES,
  assertIndependentPartition,
  assertSafePolicyPath,
  isOfficialPartition,
  isPersistentPartition,
  resolveBrowserPartition
}