import * as fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Publication only; identity/whole-file input and output hash gates remain in
// each caller. This helper never accepts unknown inputs or changes those gates.
// Only cooperating writers are serialized. External editor races are detected
// by a final read, not claimed as a filesystem-wide atomic compare-and-swap.
export async function writePatchedRuntimeFile(file, expectedSource, patchedSource, io = fs) {
  if (!path.isAbsolute(file) || typeof expectedSource !== 'string' || typeof patchedSource !== 'string' || !patchedSource.length) throw new TypeError('Invalid runtime patch publication')
  const lockFile = `${file}.dsh-patch.lock`
  const temporary = `${file}.dsh-patch-${randomUUID()}.tmp`
  let lock
  let output
  try {
    lock = await io.open(lockFile, 'wx', 0o600)
    const current = await io.lstat(file)
    if (!current.isFile() || current.isSymbolicLink()) throw new Error('Runtime patch target must be a regular file')
    if (await io.readFile(file, 'utf8') !== expectedSource) throw new Error('Runtime patch source changed; refusing to overwrite concurrent edits')
    if (expectedSource === patchedSource) return false
    output = await io.open(temporary, 'wx', current.mode & 0o777)
    await output.writeFile(patchedSource, 'utf8')
    await output.sync()
    await output.close()
    output = undefined
    if (await io.readFile(file, 'utf8') !== expectedSource) throw new Error('Runtime patch source changed during staging; refusing to overwrite concurrent edits')
    await io.rename(temporary, file)
    return true
  } finally {
    if (output) await output.close().catch(() => {})
    // Never delete a competing lock when exclusive acquisition failed.
    if (lock) {
      await io.rm(temporary, { force: true }).catch(() => {})
      await lock.close()
      await io.rm(lockFile, { force: true })
    }
  }
}
