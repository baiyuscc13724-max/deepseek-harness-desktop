const { lstat, readdir, rm } = require('node:fs/promises')
const path = require('node:path')

const SCREENSHOT_NAME = /^window-(\d+)\.png$/
const DEFAULT_MAX_FILES = 40
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function safeLimit(value, fallback, minimum, maximum) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

async function pruneComputerUseScreenshots(directory, options = {}) {
  const maxFiles = safeLimit(options.maxFiles, DEFAULT_MAX_FILES, 1, 200)
  const maxAgeMs = safeLimit(options.maxAgeMs, DEFAULT_MAX_AGE_MS, 60_000, 30 * 24 * 60 * 60 * 1000)
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  let names
  try { names = await readdir(directory) } catch (error) {
    if (error?.code === 'ENOENT') return { kept: 0, removed: 0 }
    throw error
  }

  const candidates = []
  for (const name of names) {
    if (!SCREENSHOT_NAME.test(name)) continue
    const file = path.join(directory, name)
    let stats
    try { stats = await lstat(file) } catch { continue }
    if (!stats.isFile() || stats.isSymbolicLink()) continue
    candidates.push({ file, timestamp: Math.max(stats.mtimeMs, Number(SCREENSHOT_NAME.exec(name)?.[1]) || 0) })
  }
  candidates.sort((left, right) => right.timestamp - left.timestamp)

  let kept = 0
  let removed = 0
  for (const entry of candidates) {
    const expired = now - entry.timestamp > maxAgeMs
    if (!expired && kept < maxFiles) {
      kept += 1
      continue
    }
    await rm(entry.file, { force: true })
    removed += 1
  }
  return { kept, removed }
}

module.exports = { DEFAULT_MAX_AGE_MS, DEFAULT_MAX_FILES, pruneComputerUseScreenshots }
