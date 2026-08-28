const LEGACY_PATCH_MARKER = 'recoverableToolErrorMarker = "@harness-desktop/recoverable-tool-error-v1"'
const PATCH_MARKER = 'recoverableToolErrorMarker = "@harness-desktop/recoverable-tool-error-v2"'

const REQUIRE_ANCHOR = '\t\tlet _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");'
const REQUIRE_PATCHED = `${REQUIRE_ANCHOR}
\t\tconst recoverableToolErrorMarker = "@harness-desktop/recoverable-tool-error-v2";
\t\tconst recoverableEditErrorCodes = new Set(["FS_EDIT_NOT_FOUND", "FS_STALE_VERSION", "FS_NOT_OBSERVED"]);
\t\tfunction isRecoverableEditError(toolName, block) {
\t\t\treturn toolName === "edit" && "kind" in block && block.isError === true && recoverableEditErrorCodes.has(block.error?.code);
\t\t}`

const STATE_ORIGINAL = '\t\t\tconst state = !done ? "running" : block.error?.code === "interrupted" ? "stopped" : block.isError ? "error" : "ok";'
const STATE_PATCHED = '\t\t\tconst state = !done ? "running" : block.error?.code === "interrupted" ? "stopped" : isRecoverableEditError(toolName, block) ? "retry" : block.isError ? "error" : "ok";'
const SUMMARY_ORIGINAL = '\t\t\tconst errorSummary = state === "error" && output !== null ? firstLine(output) : null;'
const SUMMARY_PATCHED = '\t\t\tconst errorSummary = (state === "error" || state === "retry") && output !== null ? firstLine(output) : null;'
const LEADING_ORIGINAL = '\t\tfunction leadingFor$1(state, icon) {\n\t\t\tswitch (state) {\n\t\t\t\tcase "error": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" });\n\t\t\t\tcase "stopped": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" });\n\t\t\t\tdefault: return icon;\n\t\t\t}\n\t\t}'
const LEADING_PATCHED = '\t\tfunction leadingFor$1(state, icon) {\n\t\t\tswitch (state) {\n\t\t\t\tcase "error": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "error" });\n\t\t\t\tcase "retry":\n\t\t\t\tcase "stopped": return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: "warning" });\n\t\t\t\tdefault: return icon;\n\t\t\t}\n\t\t}'
const STATUS_ORIGINAL = '\t\t\t\tcase "error": return t("row.failed");\n\t\t\t\tcase "stopped": return t("row.stopped");'
const STATUS_V1_PATCHED = '\t\t\t\tcase "error": return t("row.failed");\n\t\t\t\tcase "retry": return t("retry");\n\t\t\t\tcase "stopped": return t("row.stopped");'
const STATUS_PATCHED = '\t\t\t\tcase "error": return t("row.failed");\n\t\t\t\tcase "retry": return t("row.retry");\n\t\t\t\tcase "stopped": return t("row.stopped");'
const FAILURE_ORIGINAL = '\t\t\tconst failureLine = state === "error" ? errorSummary ?? null : null;'
const FAILURE_PATCHED = '\t\t\tconst failureLine = state === "error" || state === "retry" ? errorSummary ?? null : null;'
const CLASS_ORIGINAL = '\t\t\t\t\t\t\tclassName: clsx(ToolRow_module_css_default.summary, failureLine !== null && ToolRow_module_css_default.errorSummary),'
const CLASS_PATCHED = '\t\t\t\t\t\t\tclassName: clsx(ToolRow_module_css_default.summary, state === "error" && failureLine !== null && ToolRow_module_css_default.errorSummary),'

function replaceExactlyOnce(source, original, patched, label) {
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH ${label} changed; refusing an unsafe recoverable-tool-error patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

function assertComplete(source) {
  for (const contract of [
    PATCH_MARKER,
    'recoverableEditErrorCodes',
    'isRecoverableEditError(toolName, block) ? "retry"',
    'case "retry": return t("row.retry")',
    'state === "error" && failureLine !== null'
  ]) {
    if (!source.includes(contract)) throw new Error(`Recoverable tool-error UI patch is incomplete: ${contract}`)
  }
}

export function patchRecoverableToolErrorSource(source) {
  if (source.includes(PATCH_MARKER)) {
    assertComplete(source)
    return { source, changed: false }
  }
  if (source.includes(LEGACY_PATCH_MARKER)) {
    let migrated = replaceExactlyOnce(source, LEGACY_PATCH_MARKER, PATCH_MARKER, 'recoverable tool-error marker')
    migrated = replaceExactlyOnce(migrated, STATUS_V1_PATCHED, STATUS_PATCHED, 'recoverable tool-error accessible status')
    assertComplete(migrated)
    return { source: migrated, changed: true }
  }
  let output = replaceExactlyOnce(source, REQUIRE_ANCHOR, REQUIRE_PATCHED, 'tool UI runtime anchor')
  output = replaceExactlyOnce(output, STATE_ORIGINAL, STATE_PATCHED, 'tool row state derivation')
  output = replaceExactlyOnce(output, SUMMARY_ORIGINAL, SUMMARY_PATCHED, 'tool row attention summary')
  output = replaceExactlyOnce(output, LEADING_ORIGINAL, LEADING_PATCHED, 'tool row leading state')
  output = replaceExactlyOnce(output, STATUS_ORIGINAL, STATUS_PATCHED, 'tool row accessible status')
  output = replaceExactlyOnce(output, FAILURE_ORIGINAL, FAILURE_PATCHED, 'tool row collapsed summary')
  output = replaceExactlyOnce(output, CLASS_ORIGINAL, CLASS_PATCHED, 'tool row attention color')
  assertComplete(output)
  return { source: output, changed: true }
}
