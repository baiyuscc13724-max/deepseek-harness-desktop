/**
 * Deep-audit maintenance patch: classify a provider TRANSPORT failure as a retryable provider fault.
 *
 * Why this lives in its own script instead of scripts/patch-official-runtime.mjs: that installer's bytes are
 * pinned by accepted round-3 evidence (authors' final freeze = 058d1385…). Editing it in place would break
 * that pin, and the accepted-evidence rule for this audit is that an authorized change must not rewrite old
 * evidence. Keeping the rule here leaves every frozen pin untouched while still shipping the fix, at the cost
 * that it is NOT applied by the standard install chain — it must be invoked explicitly.
 *
 * Evidence and reasoning: docs/deep-audit/delegation-classifier-fix-spec.md
 * Offline verification:    tests/deep-audit-round4-classifier-proposal.test.cjs
 * Install-level tests:     tests/deep-audit-round4-subagent-transport-install.test.cjs
 *
 * Usage: node scripts/deep-audit-subagent-transport-patch.mjs [--check]
 *   (no flag)  patch the installed package in place, idempotently
 *   --check    report whether the package is unpatched, already patched, or refused, without writing
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE = '@deepseek-ai/dsh-subagent'
const VERSION = '0.1.2-alpha.5'
const DEFAULT_FILE = path.join(repoRoot, 'node_modules', PACKAGE, 'lib', 'index.js')

const ANCHOR = '\t\t\t} else code = "SUBAGENT_ERROR";'
const INSERTION = [
  '\t\t\t} else if (rawCode === "transport" || rawMessage.includes("fetch failed")) {',
  '\t\t\t\tcode = "SUBAGENT_PROVIDER_UNAVAILABLE";',
  '\t\t\t\tcategory = "provider_transient";',
  '\t\t\t\tstage = "provider_dispatch";',
  '\t\t\t\tretryable = true;',
  '\t\t\t\tnextAction = "retry_current_task";',
  ANCHOR
].join('\n')

// priorPatched is the exact artifact the existing alpha.5 subagent repairs already produce, so this rule
// chains after them. patched is this rule's exact complete output. No marker-based or partial waivers.
export const SUBAGENT_TRANSPORT_HASHES = Object.freeze({
  [VERSION]: Object.freeze({
    priorPatched: '875D76C0F97E32F7D5CE8EA2A025CCDA7DDC1E80DAF903AD4D7C090CBCB4C837',
    patched: 'AE12BDE9FBCA8C1B7ACFE2937558690222CF926C2CE99AC4ACD6B281493E5D1A',
    anchors: Object.freeze(['function boundedSubagentTerminalDiagnostic(stopReason, source, partialOutputPresent) {'])
  })
})

const sha = value => crypto.createHash('sha256').update(value).digest('hex').toUpperCase()

export function patchSubagentTransportClassificationSource(source) {
  if (source.includes(INSERTION)) return { source, changed: false }
  const occurrences = source.split(ANCHOR).length - 1
  if (occurrences !== 1) {
    throw new Error(`Subagent terminal-diagnostic fallback anchor must appear exactly once (found ${occurrences}); refusing an unsafe transport-classification patch.`)
  }
  const patched = source.replace(ANCHOR, INSERTION)
  if (!patched.includes('\t\t\t\tretryable = true;')) throw new Error('Transport-classification patch did not land; refusing to return patched source.')
  if (patched.replace(INSERTION, ANCHOR) !== source) throw new Error('Transport-classification patch is not exactly reversible; refusing to return patched source.')
  return { source: patched, changed: true }
}

/** Decide what this package's current bytes mean, without writing anything. */
export function inspectInstalledSubagent(file = DEFAULT_FILE) {
  const packageRoot = path.resolve(path.dirname(file), '..')
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  const hashes = SUBAGENT_TRANSPORT_HASHES[manifest.version]
  if (manifest.name !== PACKAGE || hashes === undefined) {
    return { state: 'refused', reason: `identity or version changed (${manifest.name || '<missing>'}@${manifest.version || '<missing>'})` }
  }
  const source = fs.readFileSync(file, 'utf8')
  const sourceHash = sha(source)
  if (sourceHash === hashes.patched) return { state: 'already-patched', file, hash: sourceHash }
  if (sourceHash !== hashes.priorPatched) {
    return { state: 'refused', reason: `source is neither the known prior patched artifact (${hashes.priorPatched}) nor the transport-classified artifact (${hashes.patched}); found ${sourceHash}` }
  }
  for (const anchor of hashes.anchors) if (!source.includes(anchor)) return { state: 'refused', reason: `classifier anchor changed (${anchor})` }
  return { state: 'patchable', file, source, hashes }
}

/** Patch the installed package in place. Returns true when bytes changed, false when already exact. */
export async function patchInstalledSubagentTransportClassification(file = DEFAULT_FILE) {
  const inspection = inspectInstalledSubagent(file)
  if (inspection.state === 'refused') throw new Error(`Pinned DSH ${VERSION} subagent transport-classification patch refused: ${inspection.reason}`)
  if (inspection.state === 'already-patched') return false
  const patched = patchSubagentTransportClassificationSource(inspection.source)
  if (sha(patched.source) !== inspection.hashes.patched) {
    throw new Error(`Pinned DSH ${VERSION} subagent transport-classification patch output hash changed; refusing an unsafe patch.`)
  }
  // Same shape as the repository's existing runtime writer: write a sibling temp file, then rename over the
  // target so a partial write can never be observed as a valid artifact.
  const temporary = `${file}.dsh-transport-${process.pid}.tmp`
  fs.writeFileSync(temporary, patched.source)
  fs.renameSync(temporary, file)
  return true
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  if (process.argv.includes('--check')) {
    const inspection = inspectInstalledSubagent()
    process.stdout.write(JSON.stringify({ state: inspection.state, reason: inspection.reason, file: inspection.file, hash: inspection.hash }, null, 2) + '\n')
    process.exitCode = inspection.state === 'refused' ? 1 : 0
  } else {
    const changed = await patchInstalledSubagentTransportClassification()
    process.stdout.write(changed
      ? 'Patched installed subagent transport-failure classification.\n'
      : 'Installed subagent transport-failure classification already patched and hash-verified.\n')
  }
}
