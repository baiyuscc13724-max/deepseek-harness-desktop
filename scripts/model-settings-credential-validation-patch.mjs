const MARKER = '@harness-desktop/model-settings-credential-validation-v1'

const HELPER_ANCHOR = `\t\tfunction deriveOverrideKeyRef(provider) {
\t\t\treturn \`HARNESS_DESKTOP_\${deriveKeyRef(provider)}\`;
\t\t}`

const HELPER_PATCH = `\t\tfunction deriveOverrideKeyRef(provider) {
\t\t\treturn \`HARNESS_DESKTOP_\${deriveKeyRef(provider)}\`;
\t\t}
\t\tconst modelSettingsCredentialValidationMarker = "${MARKER}";
\t\t/** Build an explicit remote probe only for provider routes whose model endpoint is known to authenticate. */
\t\tfunction modelSettingsCredentialValidationRequest(provider, probe, apiKey) {
\t\t\tif (provider !== "deepseek-official" && provider !== "opencode-go") return void 0;
\t\t\tconst baseURL = probe.baseURL ?? (provider === "opencode-go" ? "https://opencode.ai/zen/go/v1" : void 0);
\t\t\tconst api = probe.api ?? (provider === "opencode-go" ? "openai-completions" : void 0);
\t\t\treturn {
\t\t\t\tsettingsNs: probe.settingsNs,
\t\t\t\t...baseURL === void 0 ? {} : { baseURL },
\t\t\t\t...api === void 0 ? {} : { api },
\t\t\t\tapiKey
\t\t\t};
\t\t}`

const VALIDATION_INSERT_ANCHOR = `\t\t\t\tconst materializesNativeProfile = layout === "pi-ai" && fallback === void 0 && committedOriginal === void 0 && Object.keys(next).length === 0;`

const VALIDATION_INSERT_PATCH = `\t\t\t\tconst validationRequest = credentialPlan.credential.op === "set" ? modelSettingsCredentialValidationRequest(props.provider, probe, credentialPlan.credential.value) : void 0;
\t\t\t\tlet credentialValidated = false;
\t\t\t\tif (validationRequest !== void 0) {
\t\t\t\t\ttry {
\t\t\t\t\t\tconst checked = await api.llm.discoverModels(validationRequest);
\t\t\t\t\t\tif (!checked.result.ok) {
\t\t\t\t\t\t\tconst message = checked.result.error.message;
\t\t\t\t\t\t\tprops.onCredentialValidation?.(props.provider, { status: "invalid", message });
\t\t\t\t\t\t\treturn \`\${t("credentialInvalid")}: \${message}\`;
\t\t\t\t\t\t}
\t\t\t\t\t\tcredentialValidated = true;
\t\t\t\t\t} catch (error) {
\t\t\t\t\t\tconst message = messageOf(error);
\t\t\t\t\t\tprops.onCredentialValidation?.(props.provider, { status: "invalid", message });
\t\t\t\t\t\treturn \`\${t("credentialInvalid")}: \${message}\`;
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tconst materializesNativeProfile = layout === "pi-ai" && fallback === void 0 && committedOriginal === void 0 && Object.keys(next).length === 0;`

const VALIDATION_STATUS_ANCHOR = `\t\t\t\tsetKeyDraft("");`
const VALIDATION_STATUS_PATCH = `\t\t\t\tif (credentialPlan.credential.op === "set") props.onCredentialValidation?.(props.provider, credentialValidated ? { status: "valid" } : { status: "unverified" });
\t\t\t\telse if (credentialPlan.credential.op === "unset") props.onCredentialValidation?.(props.provider, { status: "unverified" });
\t\t\t\tsetKeyDraft("");`

const STATE_ANCHOR = `\t\t\tconst [declaring, setDeclaring] = (0, react.useState)(false);
\t\t\tconst [dismissedSetup, setDismissedSetup] = (0, react.useState)(() => /* @__PURE__ */ new Set());
\t\t\tconst announceSaved = (target) => {`

const STATE_PATCH = `\t\t\tconst [declaring, setDeclaring] = (0, react.useState)(false);
\t\t\tconst [dismissedSetup, setDismissedSetup] = (0, react.useState)(() => /* @__PURE__ */ new Set());
\t\t\tconst [credentialValidations, setCredentialValidations] = (0, react.useState)(() => /* @__PURE__ */ new Map());
\t\t\tconst updateCredentialValidation = (provider, validation) => {
\t\t\t\tsetCredentialValidations((previous) => {
\t\t\t\t\tconst next = new Map(previous);
\t\t\t\t\tnext.set(provider, validation);
\t\t\t\t\treturn next;
\t\t\t\t});
\t\t\t};
\t\t\tconst announceSaved = (target) => {`

const DOT_ANCHOR = `\t\t\t\t\t\t\tconst credentialConfigured = row.credential?.configured === true;
\t\t\t\t\t\t\tconst credentialMissing = !credentialConfigured && row.apiKeyEnv !== void 0 && row.credential?.configured === false;
\t\t\t\t\t\t\treturn (0, react_jsx_runtime.jsxs)("li", {`

const DOT_PATCH = `\t\t\t\t\t\t\tconst credentialConfigured = row.credential?.configured === true;
\t\t\t\t\t\t\tconst credentialMissing = !credentialConfigured && row.apiKeyEnv !== void 0 && row.credential?.configured === false;
\t\t\t\t\t\t\tconst credentialValidation = credentialValidations.get(row.entry.provider);
\t\t\t\t\t\t\tconst credentialVerified = credentialConfigured && credentialValidation?.status === "valid";
\t\t\t\t\t\t\tconst credentialInvalid = credentialConfigured && credentialValidation?.status === "invalid";
\t\t\t\t\t\t\treturn (0, react_jsx_runtime.jsxs)("li", {`

const DOT_RENDER_ANCHOR = `\t\t\t\t\t\t\t\t\t\t\tcredentialConfigured ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotConfigured"]}\`,
\t\t\t\t\t\t\t\t\t\t\t\trole: "img",
\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": t("credentialConfigured"),
\t\t\t\t\t\t\t\t\t\t\t\ttitle: t("credentialConfigured")
\t\t\t\t\t\t\t\t\t\t\t}) : credentialMissing ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotMissing"]}\`,
\t\t\t\t\t\t\t\t\t\t\t\trole: "img",
\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": t("credentialMissing"),
\t\t\t\t\t\t\t\t\t\t\t\ttitle: t("credentialMissing")
\t\t\t\t\t\t\t\t\t\t\t}) : null`

const DOT_RENDER_PATCH = `\t\t\t\t\t\t\t\t\t\t\tcredentialVerified ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotConfigured"]}\`,
\t\t\t\t\t\t\t\t\t\t\t\trole: "img",
\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": t("credentialVerified"),
\t\t\t\t\t\t\t\t\t\t\t\ttitle: t("credentialVerified")
\t\t\t\t\t\t\t\t\t\t\t}) : credentialInvalid ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotMissing"]}\`,
\t\t\t\t\t\t\t\t\t\t\t\trole: "img",
\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": \`\${t("credentialInvalid")}: \${credentialValidation.message ?? ""}\`,
\t\t\t\t\t\t\t\t\t\t\t\ttitle: \`\${t("credentialInvalid")}: \${credentialValidation.message ?? ""}\`
\t\t\t\t\t\t\t\t\t\t\t}) : credentialConfigured ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotUnverified"]}\`,
\t\t\t\t\t\t\t\t\t\t\t\trole: "img",
\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": credentialValidation?.status === "checking" ? t("credentialChecking") : t("credentialUnverified"),
\t\t\t\t\t\t\t\t\t\t\t\ttitle: credentialValidation?.status === "checking" ? t("credentialChecking") : t("credentialUnverified")
\t\t\t\t\t\t\t\t\t\t\t}) : credentialMissing ? (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\t\t\t\t\t\tclassName: \`\${ModelsSection_module_css_default["credentialDot"]} \${ModelsSection_module_css_default["credentialDotMissing"]}\`,
\t\t\t\t\t\t\t\t\t\t\t\trole: "img",
\t\t\t\t\t\t\t\t\t\t\t\t"aria-label": t("credentialMissing"),
\t\t\t\t\t\t\t\t\t\t\t\ttitle: t("credentialMissing")
\t\t\t\t\t\t\t\t\t\t\t}) : null`

const CSS_ANCHOR = '.zGbnIq_credentialDotConfigured{background:var(--dsw-alias-state-success-primary)}.zGbnIq_credentialDotMissing{background:var(--dsw-alias-state-error-primary)}'
const CSS_PATCH = '.zGbnIq_credentialDotConfigured{background:var(--dsw-alias-state-success-primary)}.zGbnIq_credentialDotUnverified{background:var(--dsw-alias-state-warn-label)}.zGbnIq_credentialDotMissing{background:var(--dsw-alias-state-error-primary)}'
const CSS_MAP_ANCHOR = `\t\t\t"credentialDotConfigured": "zGbnIq_credentialDotConfigured",
\t\t\t"credentialDotMissing": "zGbnIq_credentialDotMissing",`
const CSS_MAP_PATCH = `\t\t\t"credentialDotConfigured": "zGbnIq_credentialDotConfigured",
\t\t\t"credentialDotUnverified": "zGbnIq_credentialDotUnverified",
\t\t\t"credentialDotMissing": "zGbnIq_credentialDotMissing",`

const EN_ANCHOR = `\t\t\tcredentialConfigured: "API key configured",
\t\t\tcredentialMissing: "API key missing",`
const EN_PATCH = `\t\t\tcredentialConfigured: "API key configured",
\t\t\tcredentialVerified: "API key verified by the provider",
\t\t\tcredentialUnverified: "API key saved but not verified in this page session",
\t\t\tcredentialChecking: "Checking API key with the provider…",
\t\t\tcredentialInvalid: "The provider rejected this API key",
\t\t\tcredentialMissing: "API key missing",`
const ZH_ANCHOR = `\t\t\tcredentialConfigured: "API 密钥已配置",
\t\t\tcredentialMissing: "API 密钥缺失",`
const ZH_PATCH = `\t\t\tcredentialConfigured: "API 密钥已配置",
\t\t\tcredentialVerified: "API 密钥已通过提供方认证",
\t\t\tcredentialUnverified: "API 密钥已保存，但本次页面会话尚未验证",
\t\t\tcredentialChecking: "正在向提供方验证 API 密钥…",
\t\t\tcredentialInvalid: "提供方拒绝了此 API 密钥",
\t\t\tcredentialMissing: "API 密钥缺失",`

const READ_ONLY_PROP = `readOnly: !state.writable,`
const CALLBACK_PROP = `readOnly: !state.writable,
\t\t\t\t\t\t\t\t\tonCredentialValidation: updateCredentialValidation,`

const FINAL_MARKERS = [
  MARKER,
  'function modelSettingsCredentialValidationRequest(',
  'const [credentialValidations, setCredentialValidations]',
  'onCredentialValidation: updateCredentialValidation',
  'credentialDotUnverified',
  'credentialVerified: "API key verified by the provider"',
  'credentialVerified: "API 密钥已通过提供方认证"',
  'api.llm.discoverModels(validationRequest)'
]

function replaceExact(source, original, patched, label) {
  if (!source.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe credential-validation patch.`)
  return source.replace(original, patched)
}

export function patchModelSettingsCredentialValidationSource(source) {
  const present = FINAL_MARKERS.filter(marker => source.includes(marker))
  if (present.length === FINAL_MARKERS.length) return { source, changed: false }
  if (present.length > 0) throw new Error('Pinned DSH model-settings credential validation patch is incomplete; refusing an unsafe repair.')
  let output = source
  output = replaceExact(output, HELPER_ANCHOR, HELPER_PATCH, 'credential validation helper anchor')
  output = replaceExact(output, VALIDATION_INSERT_ANCHOR, VALIDATION_INSERT_PATCH, 'credential validation transaction')
  output = replaceExact(output, VALIDATION_STATUS_ANCHOR, VALIDATION_STATUS_PATCH, 'credential validation result')
  output = replaceExact(output, STATE_ANCHOR, STATE_PATCH, 'credential validation state')
  output = replaceExact(output, DOT_ANCHOR, DOT_PATCH, 'credential status derivation')
  output = replaceExact(output, DOT_RENDER_ANCHOR, DOT_RENDER_PATCH, 'credential status indicator')
  output = replaceExact(output, CSS_ANCHOR, CSS_PATCH, 'credential indicator styles')
  output = replaceExact(output, CSS_MAP_ANCHOR, CSS_MAP_PATCH, 'credential indicator class map')
  output = replaceExact(output, EN_ANCHOR, EN_PATCH, 'English credential copy')
  output = replaceExact(output, ZH_ANCHOR, ZH_PATCH, 'Chinese credential copy')
  const propMatches = output.split(READ_ONLY_PROP).length - 1
  if (propMatches !== 4) throw new Error(`Pinned DSH provider-editor call count changed (${propMatches}); refusing an unsafe credential-validation patch.`)
  output = output.split(READ_ONLY_PROP).join(CALLBACK_PROP)
  return { source: output, changed: true }
}
