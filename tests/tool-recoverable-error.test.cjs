const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const patchModule = path.join(root, 'scripts', 'tool-recoverable-error-patch.mjs')
const toolRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-tool', 'lib', 'client.js')

test('recoverable literal-edit misses render as retry warnings without hiding genuine failures', async () => {
  const { patchRecoverableToolErrorSource } = await import(pathToFileURL(patchModule).href)
  const source = await readFile(toolRuntime, 'utf8')
  const once = patchRecoverableToolErrorSource(source)
  const twice = patchRecoverableToolErrorSource(once.source)

  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
  for (const contract of [
    '@harness-desktop/recoverable-tool-error-v2',
    'new Set(["FS_EDIT_NOT_FOUND", "FS_STALE_VERSION", "FS_NOT_OBSERVED"])',
    'isRecoverableEditError(toolName, block) ? "retry" : block.isError ? "error"',
    'case "retry": return t("row.retry")',
    'state === "error" && failureLine !== null && ToolRow_module_css_default.errorSummary'
  ]) assert.match(once.source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))

  assert.match(once.source, /case "retry":\n\s*case "stopped": return .*StateDot, \{ state: "warning" \}/u)
  assert.match(once.source, /const errorSummary = \(state === "error" \|\| state === "retry"\)/u)
  assert.match(once.source, /block\.isError \? "error" : "ok"/u)
})
