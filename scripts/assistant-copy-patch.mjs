const LEGACY_PATCH_MARKER = 'dataPluginCss = "@harness-desktop/assistant-copy-dock-v1"'
const PATCH_MARKER = 'dataPluginCss = "@harness-desktop/assistant-copy-dock-v2"'
const ASSISTANT_COPY_MIN_CHARACTERS = 600
const ASSISTANT_COPY_MIN_NONEMPTY_LINES = 12

const LEGACY_ASSISTANT_COPY_CSS = ".hd-assistant-copy-dock{position:sticky;z-index:6;top:10px;height:0;align-self:stretch;justify-content:flex-end;overflow:visible;pointer-events:none;display:flex}.hd-assistant-copy-button{pointer-events:auto;box-sizing:border-box;min-width:32px;height:32px;max-width:160px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);border-radius:999px;padding:0 10px;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-base) 90%,transparent);box-shadow:0 4px 16px color-mix(in srgb,#000 14%,transparent);backdrop-filter:blur(14px) saturate(1.08);cursor:pointer;transform:translate(8px,-2px);align-items:center;gap:6px;font:var(--dsw-font-xs-13);white-space:nowrap;display:inline-flex;transition:color .12s ease,background-color .12s ease,border-color .12s ease,box-shadow .12s ease}.hd-assistant-copy-button:hover,.hd-assistant-copy-button:focus-visible{outline:none;color:var(--dsw-alias-label-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,var(--dsw-alias-border-l2));background:color-mix(in srgb,var(--dsw-alias-bg-base) 96%,var(--dsw-alias-brand-primary) 4%);box-shadow:0 6px 20px color-mix(in srgb,#000 18%,transparent)}.hd-assistant-copy-button:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 66%,transparent);outline-offset:2px}.hd-assistant-copy-button[data-copied=true]{color:var(--dsw-alias-state-success-primary)}.hd-assistant-copy-button svg{flex:none}.hd-assistant-copy-label{overflow:hidden;text-overflow:ellipsis}.Sxvs8a_root[data-streaming] .hd-assistant-copy-button{background:color-mix(in srgb,var(--dsw-alias-bg-base) 94%,transparent)}@media(max-width:620px){.hd-assistant-copy-dock{top:8px}.hd-assistant-copy-button{width:32px;padding:0;justify-content:center;transform:none}.hd-assistant-copy-label{display:none}}@media(prefers-reduced-motion:reduce){.hd-assistant-copy-button{transition:none}}"
const ASSISTANT_COPY_CSS = ".hd-assistant-copy-dock{z-index:2;height:30px;margin:0 0 6px;align-self:stretch;justify-content:flex-end;display:flex}.hd-assistant-copy-dock:empty{display:none}.hd-assistant-copy-button{box-sizing:border-box;width:30px;height:30px;border:0;border-radius:8px;padding:0;color:var(--dsw-alias-label-secondary);background:transparent;cursor:pointer;align-items:center;justify-content:center;display:inline-flex;transition:color .12s ease,background-color .12s ease}.hd-assistant-copy-button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hd-assistant-copy-button:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 66%,transparent);outline-offset:2px}.hd-assistant-copy-button[data-copied=true]{color:var(--dsw-alias-state-success-primary)}.hd-assistant-copy-button svg{flex:none}@media(prefers-reduced-motion:reduce){.hd-assistant-copy-button{transition:none}}"

const STYLE_ANCHOR = '\t\tconst tagId$2 = "@deepseek-ai/dsh-client-ui-conversation/AssistantMarkdown.module.css";'
const STYLE_PATCH = `\t\tconst assistantCopyCss = "${ASSISTANT_COPY_CSS}";
\t\tconst dataPluginCss = "@harness-desktop/assistant-copy-dock-v2";
\t\tif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(dataPluginCss) + "]") === null) {
\t\t\tconst assistantCopyTag = document.createElement("style");
\t\t\tassistantCopyTag.dataset.plugin = "harness-desktop";
\t\t\tassistantCopyTag.dataset.pluginCss = dataPluginCss;
\t\t\tassistantCopyTag.textContent = assistantCopyCss;
\t\t\tdocument.head.appendChild(assistantCopyTag);
\t\t}
${STYLE_ANCHOR}`

const SHOULD_OFFER_HELPER = `\t\tfunction shouldOfferAssistantCopy(text) {
\t\t\tif (text.length >= ${ASSISTANT_COPY_MIN_CHARACTERS}) return true;
\t\t\tif (/(^|\\n)(?:\`\`\`|~~~)[^\\n]*\\n[\\s\\S]*?\\n(?:\`\`\`|~~~)(?=\\n|$)/u.test(text)) return true;
\t\t\treturn text.split(/\\r?\\n/u).filter((line) => line.trim() !== "").length >= ${ASSISTANT_COPY_MIN_NONEMPTY_LINES};
\t\t}
`
const COMPONENT_ANCHOR = '\t\tconst AssistantMarkdown = (0, react.memo)(function AssistantMarkdown({ blocks, streaming, interrupted, renderMessageImages, mentions, t }) {'
const COMPONENT_PATCH = `${SHOULD_OFFER_HELPER}\t\tfunction AssistantCopyButton({ text, t }) {
\t\t\tconst [copied, setCopied] = (0, react.useState)(false);
\t\t\tconst copyPending = (0, react.useRef)(false);
\t\t\tconst copyTimer = (0, react.useRef)(null);
\t\t\tconst copyEpoch = (0, react.useRef)(0);
\t\t\t(0, react.useEffect)(() => () => {
\t\t\t\tcopyEpoch.current += 1;
\t\t\t\tcopyPending.current = false;
\t\t\t\tif (copyTimer.current !== null) clearTimeout(copyTimer.current);
\t\t\t}, []);
\t\t\tif (!shouldOfferAssistantCopy(text)) return null;
\t\t\tconst label = copied ? t("message.copiedResponse") : t("message.copyResponse");
\t\t\tconst onCopy = () => {
\t\t\t\tif (copied || copyPending.current) return;
\t\t\t\tconst epoch = copyEpoch.current;
\t\t\t\tcopyPending.current = true;
\t\t\t\t(0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(text).then((ok) => {
\t\t\t\t\tif (epoch !== copyEpoch.current) return;
\t\t\t\t\tcopyPending.current = false;
\t\t\t\t\tif (!ok) return;
\t\t\t\t\tsetCopied(true);
\t\t\t\t\tcopyTimer.current = window.setTimeout(() => {
\t\t\t\t\t\tcopyTimer.current = null;
\t\t\t\t\t\tsetCopied(false);
\t\t\t\t\t}, 1200);
\t\t\t\t});
\t\t\t};
\t\t\treturn (0, react_jsx_runtime.jsx)("button", {
\t\t\t\ttype: "button",
\t\t\t\tclassName: "hd-assistant-copy-button",
\t\t\t\t"data-copied": copied || void 0,
\t\t\t\t"aria-label": label,
\t\t\t\ttitle: label,
\t\t\t\tonClick: onCopy,
\t\t\t\tchildren: copied ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, {})
\t\t\t});
\t\t}
\t\tconst AssistantMarkdown = (0, react.memo)(function AssistantMarkdown({ blocks, streaming, interrupted, renderMessageImages, mentions, copyText, t }) {`

const RETURN_ORIGINAL = `\t\t\treturn (0, react_jsx_runtime.jsx)("div", {
\t\t\t\tclassName: AssistantMarkdown_module_css_default.root,
\t\t\t\t"data-streaming": streaming || void 0,
\t\t\t\tchildren: (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\tclassName: AssistantMarkdown_module_css_default.body,
\t\t\t\t\tchildren: [rendered, interrupted && (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: AssistantMarkdown_module_css_default.stopped,
\t\t\t\t\t\tchildren: t("message.stopped")
\t\t\t\t\t})]
\t\t\t\t})
\t\t\t});`

const RETURN_PATCHED = `\t\t\treturn (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\tclassName: AssistantMarkdown_module_css_default.root,
\t\t\t\t"data-streaming": streaming || void 0,
\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\tclassName: "hd-assistant-copy-dock",
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(AssistantCopyButton, { text: copyText, t })
\t\t\t\t}), (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\tclassName: AssistantMarkdown_module_css_default.body,
\t\t\t\t\tchildren: [rendered, interrupted && (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: AssistantMarkdown_module_css_default.stopped,
\t\t\t\t\t\tchildren: t("message.stopped")
\t\t\t\t\t})]
\t\t\t\t})]
\t\t\t});`

const NODE_RENDER_ORIGINAL = `\t\t\treturn (0, react_jsx_runtime.jsx)(AssistantMarkdown, {
\t\t\t\tblocks: data.blocks,
\t\t\t\tstreaming: data.status === "running",
\t\t\t\tinterrupted: data.status === "interrupted",
\t\t\t\trenderMessageImages,
\t\t\t\tmentions,
\t\t\t\tt
\t\t\t});`
const NODE_RENDER_PATCHED = `\t\t\treturn (0, react_jsx_runtime.jsx)(AssistantMarkdown, {
\t\t\t\tblocks: data.blocks,
\t\t\t\tstreaming: data.status === "running",
\t\t\t\tinterrupted: data.status === "interrupted",
\t\t\t\trenderMessageImages,
\t\t\t\tmentions,
\t\t\t\tcopyText: owner === void 0 ? "" : assistantText(tail.closing.blocks),
\t\t\t\tt
\t\t\t});`

const ZH_LOCALE_ORIGINAL = '\t\t\t"message.stopped": "已停止",'
const ZH_LOCALE_PATCHED = `${ZH_LOCALE_ORIGINAL}\n\t\t\t"message.copyResponse": "复制全文",\n\t\t\t"message.copiedResponse": "全文已复制",`
const EN_LOCALE_ORIGINAL = '\t\t\t"message.stopped": "Stopped",'
const EN_LOCALE_PATCHED = `${EN_LOCALE_ORIGINAL}\n\t\t\t"message.copyResponse": "Copy full response",\n\t\t\t"message.copiedResponse": "Full response copied",`

const LEGACY_STYLE_LINE = `\t\tconst assistantCopyCss = "${LEGACY_ASSISTANT_COPY_CSS}";`
const STYLE_LINE = `\t\tconst assistantCopyCss = "${ASSISTANT_COPY_CSS}";`
const LEGACY_COMPONENT_START = '\t\tfunction AssistantCopyButton({ text, t }) {'
const LEGACY_EMPTY_GUARD = '\t\t\tif (text === "") return null;'
const COPY_GUARD = '\t\t\tif (!shouldOfferAssistantCopy(text)) return null;'
const LEGACY_BUTTON_CHILDREN = '\t\t\t\tchildren: [copied ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, {}), (0, react_jsx_runtime.jsx)("span", { className: "hd-assistant-copy-label", "aria-live": "polite", children: label })]'
const BUTTON_CHILDREN = '\t\t\t\tchildren: copied ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutline16, {})'

export function shouldOfferAssistantCopyText(text) {
  if (typeof text !== 'string' || text === '') return false
  if (text.length >= ASSISTANT_COPY_MIN_CHARACTERS) return true
  if (/(^|\n)(?:```|~~~)[^\n]*\n[\s\S]*?\n(?:```|~~~)(?=\n|$)/u.test(text)) return true
  return text.split(/\r?\n/u).filter(line => line.trim() !== '').length >= ASSISTANT_COPY_MIN_NONEMPTY_LINES
}

function replaceExactlyOnce(source, original, patched, label) {
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH ${label} changed; refusing an unsafe assistant-copy patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

function assertComplete(source) {
  for (const required of ['function shouldOfferAssistantCopy', 'function AssistantCopyButton', 'className: "hd-assistant-copy-dock"', 'hd-assistant-copy-dock:empty', 'writeClipboard)(text)', 'copyText: owner === void 0 ? "" : assistantText(tail.closing.blocks)', 't("message.copyResponse")', 'IconCopyOutline16', '"message.copiedResponse": "全文已复制"', '"message.copiedResponse": "Full response copied"']) {
    if (!source.includes(required)) throw new Error('Installed assistant-copy patch is incomplete; refusing to continue.')
  }
  if (source.includes('hd-assistant-copy-label')) throw new Error('Installed assistant-copy patch still contains the obsolete visible label; refusing to continue.')
}

function migrateLegacyPatch(source) {
  let output = replaceExactlyOnce(source, LEGACY_PATCH_MARKER, PATCH_MARKER, 'assistant copy version marker')
  output = replaceExactlyOnce(output, LEGACY_STYLE_LINE, STYLE_LINE, 'legacy Assistant copy styles')
  output = replaceExactlyOnce(output, LEGACY_COMPONENT_START, `${SHOULD_OFFER_HELPER}${LEGACY_COMPONENT_START}`, 'legacy Assistant copy component')
  output = replaceExactlyOnce(output, LEGACY_EMPTY_GUARD, COPY_GUARD, 'legacy Assistant copy visibility guard')
  output = replaceExactlyOnce(output, LEGACY_BUTTON_CHILDREN, BUTTON_CHILDREN, 'legacy Assistant copy icon content')
  assertComplete(output)
  return output
}

export function patchAssistantCopySource(source) {
  if (source.includes(PATCH_MARKER)) {
    assertComplete(source)
    return { source, changed: false }
  }
  if (source.includes(LEGACY_PATCH_MARKER)) return { source: migrateLegacyPatch(source), changed: true }
  let output = replaceExactlyOnce(source, STYLE_ANCHOR, STYLE_PATCH, 'Assistant Markdown style anchor')
  output = replaceExactlyOnce(output, COMPONENT_ANCHOR, COMPONENT_PATCH, 'Assistant Markdown component anchor')
  output = replaceExactlyOnce(output, RETURN_ORIGINAL, RETURN_PATCHED, 'Assistant Markdown render body')
  output = replaceExactlyOnce(output, NODE_RENDER_ORIGINAL, NODE_RENDER_PATCHED, 'final Assistant copy projection')
  output = replaceExactlyOnce(output, ZH_LOCALE_ORIGINAL, ZH_LOCALE_PATCHED, 'Chinese conversation labels')
  output = replaceExactlyOnce(output, EN_LOCALE_ORIGINAL, EN_LOCALE_PATCHED, 'English conversation labels')
  assertComplete(output)
  return { source: output, changed: true }
}
