import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

export const MIB = 1024 * 1024

export function formatMiB(bytes) {
  return `${(Number(bytes) / MIB).toFixed(2)} MiB`
}

export function assertMaximum(label, bytes, maximumMiB) {
  const maximumBytes = Number(maximumMiB) * MIB
  if (!Number.isFinite(maximumBytes) || maximumBytes <= 0) throw new Error(`Invalid size budget for ${label}: ${maximumMiB}`)
  if (Number(bytes) > maximumBytes) {
    throw new Error(`${label} exceeds its size budget: ${formatMiB(bytes)} > ${Number(maximumMiB).toFixed(2)} MiB`)
  }
}

export async function directorySize(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  let total = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const parent = entry.parentPath || entry.path
    total += (await stat(path.join(parent, entry.name))).size
  }
  return total
}

export async function windowsFootprint(dist) {
  const unpackedRoot = path.join(dist, 'win-unpacked')
  const resources = path.join(unpackedRoot, 'resources')
  const localesRoot = path.join(unpackedRoot, 'locales')
  const appAsar = path.join(resources, 'app.asar')
  const appAsarUnpacked = path.join(resources, 'app.asar.unpacked')
  const localeEntries = await readdir(localesRoot, { withFileTypes: true }).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  return {
    unpackedBytes: await directorySize(unpackedRoot),
    appAsarBytes: (await stat(appAsar)).size,
    appAsarUnpackedBytes: await directorySize(appAsarUnpacked),
    localesBytes: await directorySize(localesRoot),
    localeFiles: localeEntries.filter(entry => entry.isFile()).length
  }
}

export function enforceWindowsFootprint(footprint, budget) {
  assertMaximum('Windows unpacked application', footprint.unpackedBytes, budget.unpackedMiB)
  assertMaximum('app.asar', footprint.appAsarBytes, budget.appAsarMiB)
  assertMaximum('app.asar.unpacked', footprint.appAsarUnpackedBytes, budget.appAsarUnpackedMiB)
  assertMaximum('Electron locales', footprint.localesBytes, budget.localesMiB)
  if (footprint.localeFiles > budget.localesMaxFiles) {
    throw new Error(`Electron locale file count exceeds its budget: ${footprint.localeFiles} > ${budget.localesMaxFiles}`)
  }
}
