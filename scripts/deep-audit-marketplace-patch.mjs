import { createHash } from 'node:crypto'

export const MARKETPLACE_155_INPUT_SHA256 = 'F9352630E7FBB6D38647FF2FCF988CEF071648F78166A9C09D65BA42E8AE7699'
export const MARKETPLACE_155_OUTPUT_SHA256 = 'BBA2417FC236501BADF532C76A85673410C5579A5E54D420565C02E963836BDE'
const digest = source => createHash('sha256').update(source).digest('hex').toUpperCase()

// These functions are embedded verbatim in the pinned production module; imports
// are supplied by that module. No filesystem/network work occurs at patch time.
async function auditReadOptional(file) {
  try { return await readFile(file, 'utf8') }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function auditWriteStage(file, text) {
  const handle = await open(file, 'wx', 0o600)
  try { await handle.writeFile(text, 'utf8'); await handle.sync() }
  finally { await handle.close() }
}
async function auditAtomicText(file, text) {
  const stage = file + '.audit-' + randomBytes(12).toString('hex')
  try { await auditWriteStage(stage, text); await rename(stage, file) }
  finally { await rm(stage, { force: true }).catch(() => {}) }
}
function auditMergeDotEnv(original, changes) {
  const lines = (original || '').match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter(Boolean)
  const newline = original?.includes('\r\n') ? '\r\n' : '\n'
  const seen = new Set(), out = []
  const render = (key, value) => {
    const cleaned = String(value)
    const parseEnv = requireFromHere('node:util').parseEnv
    // Input uses the existing trim/length/newline contract; encoding adds no lossy escapes.
    if (/\0/.test(cleaned)) throw new Error('MARKETPLACE_ENV_VALUE_UNREPRESENTABLE')
    const candidates = ['"', "'", '`'].filter(quote => !cleaned.includes(quote)).map(quote => quote + cleaned + quote)
    if (!/^["'`]/.test(cleaned)) candidates.push(cleaned)
    const encoded = candidates.find(candidate => {
      try { return parseEnv('AUDIT_VALUE=' + candidate).AUDIT_VALUE === cleaned } catch { return false }
    })
    if (encoded === undefined) throw new Error('MARKETPLACE_ENV_VALUE_UNREPRESENTABLE')
    return key + '=' + encoded + newline
  }
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)/.exec(lines[i])
    if (!match) { out.push(lines[i]); continue }
    const key = match[1], value = match[2], quote = value[0]
    let block = lines[i], suffix = value.includes('#') ? value.slice(value.indexOf('#')) : ''
    if (['"', "'", '`'].includes(quote)) {
      let text = value.slice(1), closed = false
      while (!closed) {
        for (let p = 0; p < text.length; p++) {
          // Node parseEnv terminates quotes even after a backslash.
          if (text[p] === quote) { closed = true; suffix = text.slice(p + 1); break }
        }
        if (closed || i + 1 >= lines.length) break
        text = lines[++i]; block += text
      }
      if (!closed) throw new Error('MARKETPLACE_ENV_FORMAT_INVALID')
    }
    if (!Object.hasOwn(changes, key)) { out.push(block); continue }
    if (!seen.has(key) && changes[key] !== '') out.push(render(key, changes[key]))
    const comment = /^\s*(#.*)/.exec(suffix)
    if (comment) out.push(comment[1] + newline)
    seen.add(key)
  }
  for (const [key, value] of Object.entries(changes)) {
    if (seen.has(key) || value === '') continue
    if (out.length && !/[\r\n]$/.test(out[out.length - 1])) out.push(newline)
    out.push(render(key, value))
  }
  return out.join('')
}
async function auditCommitEnv(repo, values) {
  await mkdir(MARKET_ROOT, { recursive: true })
  const lockFile = ENVS_FILE + '.lock', marker = ENVS_FILE + '.transaction'
  const lock = await open(lockFile, 'wx', 0o600)
  const nonce = randomBytes(12).toString('hex')
  const files = [ENVS_FILE, DOTENV_FILE]
  const stages = files.map(file => file + '.stage-' + nonce)
  const backups = files.map(file => file + '.backup-' + nonce)
  let originals, changed = 0, preserve = false, marked = false
  try {
    if (await auditReadOptional(marker) !== null) throw new Error('MARKETPLACE_ENV_RECOVERY_REQUIRED')
    originals = await Promise.all(files.map(auditReadOptional))
    const stored = originals[0] === null ? {} : JSON.parse(originals[0])
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('MARKETPLACE_ENV_FORMAT_INVALID')
    const record = getInstalledRecord(repo)
    const allowed = new Set(Array.isArray(record?.envKeys) ? record.envKeys : [])
    const current = { ...(stored[repo] || {}) }, changes = {}, applied = []
    for (const [key, raw] of Object.entries(values || {})) {
      if (!isValidEnvKey(key) || (allowed.size && !allowed.has(key))) continue
      if (Object.entries(stored).some(([owner, entries]) => owner !== repo && entries && Object.hasOwn(entries, key))) throw new Error('MARKETPLACE_ENV_KEY_CONFLICT')
      const value = String(raw ?? '').trim().slice(0, 4000).replace(/[\r\n]+/g, ' ')
      if (value === '') delete current[key]; else current[key] = value
      changes[key] = value; applied.push(key)
    }
    if (!applied.length) return { applied: [] }
    const next = { ...stored, [repo]: current }
    const texts = [JSON.stringify(next, null, 2), auditMergeDotEnv(originals[1], changes)]
    await mkdir(DSH_HOME, { recursive: true })
    for (let i = 0; i < files.length; i++) {
      if (originals[i] !== null) await auditWriteStage(backups[i], originals[i])
      await auditWriteStage(stages[i], texts[i])
    }
    await auditWriteStage(marker, JSON.stringify({ version: 1, nonce }))
    marked = true
    for (let i = 0; i < files.length; i++) { await rename(stages[i], files[i]); changed++ }
    envStore = next
    await rm(marker)
    marked = false
    return { applied }
  } catch (error) {
    for (let i = changed - 1; i >= 0; i--) {
      try {
        if (originals[i] === null) await rm(files[i], { force: true })
        else await rename(backups[i], files[i])
      } catch { preserve = true }
    }
    if (changed && !preserve && originals) envStore = originals[0] === null ? {} : JSON.parse(originals[0])
    if (marked && !preserve) await rm(marker, { force: true }).catch(() => { preserve = true })
    const safeCode = ['MARKETPLACE_ENV_RECOVERY_REQUIRED', 'MARKETPLACE_ENV_FORMAT_INVALID', 'MARKETPLACE_ENV_KEY_CONFLICT', 'MARKETPLACE_ENV_VALUE_UNREPRESENTABLE'].includes(error?.message) ? error.message : 'MARKETPLACE_ENV_WRITE_FAILED'
    throw new Error(preserve ? 'MARKETPLACE_ENV_RECOVERY_REQUIRED' : safeCode)
  } finally {
    if (!preserve) for (const file of [...stages, ...backups]) await rm(file, { force: true }).catch(() => {})
    await lock.close()
    await rm(lockFile, { force: true })
  }
}
async function auditApplyEnvEdit(repo, values) {
  const input = { ...(values || {}) }
  envsQueue = envsQueue.catch(() => {}).then(() => auditCommitEnv(repo, input))
  return envsQueue
}
async function auditReplaceTree(source, destination, options) {
  const nonce = randomBytes(12).toString('hex')
  const stage = destination + '.stage-' + nonce, backup = destination + '.backup-' + nonce
  const lockFile = destination + '.lock', marker = destination + '.transaction'
  const lock = await open(lockFile, 'wx', 0o600)
  let moved = false, activated = false, preserve = false, marked = false
  try {
    if (await auditReadOptional(marker) !== null) throw new Error('MARKETPLACE_TREE_RECOVERY_REQUIRED')
    await cp(source, stage, options)
    await auditWriteStage(marker, JSON.stringify({ version: 1, nonce }))
    marked = true
    try { await rename(destination, backup); moved = true }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    try { await rename(stage, destination); activated = true }
    catch (error) {
      if (moved) {
        try { await rename(backup, destination); moved = false }
        catch { preserve = true; throw new Error('MARKETPLACE_TREE_RECOVERY_REQUIRED') }
      }
      throw error
    }
    await rm(marker)
    marked = false
  } finally {
    if (marked && activated) preserve = true
    if (marked && !preserve && !activated) await rm(marker, { force: true }).catch(() => { preserve = true })
    if (!preserve) {
      await rm(stage, { recursive: true, force: true }).catch(() => {})
      if (activated) await rm(backup, { recursive: true, force: true }).catch(() => {})
    }
    await lock.close()
    await rm(lockFile, { force: true })
  }
}
function replaceFunction(source, name, replacement) {
  const start = source.indexOf('async function ' + name + '(')
  const end = source.indexOf('\n}', start) + 2
  if (start < 0 || end < start) throw new Error('Pinned marketplace function missing: ' + name)
  return source.slice(0, start) + replacement + source.slice(end)
}
export function patchMarketplace155Source(source) {
  const hash = digest(source)
  if (MARKETPLACE_155_OUTPUT_SHA256 && hash === MARKETPLACE_155_OUTPUT_SHA256) return { source, changed: false }
  if (hash !== MARKETPLACE_155_INPUT_SHA256) throw new Error('Pinned marketplace source hash changed; refusing unsafe patch.')
  let output = source.replace('import { mkdir, rm, cp, readFile, writeFile, stat, readdir, rename, mkdtemp, realpath }', 'import { open, mkdir, rm, cp, readFile, writeFile, stat, readdir, rename, mkdtemp, realpath }')
  for (const name of ['saveEnvStore', 'saveFeedback', 'saveInstalled', 'removeInstalled', 'appendPatchEntry', 'removePatchEntry']) {
    const start = output.indexOf('async function ' + name + '('), end = output.indexOf('\n}', start) + 2
    const before = output.slice(start, end)
    if (!before.includes('const task = (async () => {') || !before.includes('  })();')) throw new Error('Pinned marketplace queue shape changed: ' + name)
    const after = before.replace('const task = (async () => {', 'const task = async () => {').replace('  })();', '  };').replaceAll('.then(() => task)', '.then(task)')
    output = output.slice(0, start) + after + output.slice(end)
  }
  output = replaceFunction(output, 'applyEnvEdit', auditApplyEnvEdit.toString().replace('auditApplyEnvEdit', 'applyEnvEdit'))
  const unsafe = 'return json(res, 200, { status: "failed", error: String(error?.message ?? error), log: [t(lang, "webdavFail", { err: String(error?.message ?? error) })] });'
  if (output.split(unsafe).length !== 3) throw new Error('Pinned marketplace WebDAV handlers changed')
  output = output.replaceAll(unsafe, 'return json(res, 200, { status: "failed", error: "WebDAV operation failed", log: [t(lang, "webdavFail", { err: "WebDAV operation failed" })] });')
  const unsafeTree = '      await rm(dest, { recursive: true, force: true });\n      await cp(root, dest, { recursive: true, filter: copyFilter(root, true) });'
  if (output.split(unsafeTree).length !== 3) throw new Error('Pinned marketplace tree install shape changed')
  output = output.replaceAll(unsafeTree, '      await auditReplaceTree(root, dest, { recursive: true, filter: copyFilter(root, true) });')
  output = output.replace('async function saveEnvStore()', [auditReadOptional, auditWriteStage, auditAtomicText, auditMergeDotEnv, auditCommitEnv, auditReplaceTree].map(fn => fn.toString()).join('\n\n') + '\n\nasync function saveEnvStore()')
  output = output.replace('await writeFile(ENVS_FILE, JSON.stringify(envStore, null, 2), "utf8");', 'await auditAtomicText(ENVS_FILE, JSON.stringify(envStore, null, 2));')
    .replace('await writeFile(FEEDBACK_FILE, JSON.stringify({ pending: pendingFeedback, token: feedbackToken }, null, 2), "utf8");', 'await auditAtomicText(FEEDBACK_FILE, JSON.stringify({ pending: pendingFeedback, token: feedbackToken }, null, 2));')
    .replaceAll('await writeFile(INSTALLED_FILE, JSON.stringify(data, null, 2), "utf8");', 'await auditAtomicText(INSTALLED_FILE, JSON.stringify(data, null, 2));')
  if (MARKETPLACE_155_OUTPUT_SHA256 && digest(output) !== MARKETPLACE_155_OUTPUT_SHA256) throw new Error('Pinned marketplace patch output hash changed: ' + digest(output))
  return { source: output, changed: true }
}
