const V1_MARKER = '@harness-desktop/provider-auth-isolation-v1'
const V2_MARKER = '@harness-desktop/provider-auth-isolation-v2'
const MARKER = '@harness-desktop/provider-auth-isolation-v3'

export function providerAuthContract(provider, profile = {}) {
  const protocol = profile.api ?? (provider === 'openai-codex' ? 'openai-codex-responses' : undefined)
  const credentialRef = profile.apiKeyEnv
  if (protocol !== 'openai-codex-responses') {
    if (credentialRef !== 'OPENAI_CODEX_ACCESS_TOKEN') {
      return { kind: credentialRef === undefined ? 'provider-native' : 'api-key', credentialRef }
    }
    return {
      kind: 'mismatch',
      credentialRef,
      code: 'AUTH_KIND_MISMATCH',
      message: `llm-pi-ai: provider route "${provider}" uses an API-key protocol but names the reserved OpenAI Codex OAuth access-token reference; choose a provider-owned API-key reference`
    }
  }
  if (credentialRef === undefined) return { kind: 'oauth-record', credentialRef }
  if (credentialRef === 'OPENAI_CODEX_ACCESS_TOKEN') return { kind: 'oauth-access-token', credentialRef }
  return {
    kind: 'mismatch',
    credentialRef,
    code: 'AUTH_KIND_MISMATCH',
    message: `llm-pi-ai: provider route "${provider}" uses the Codex OAuth protocol but names an API-key credential reference; use OPENAI_CODEX_ACCESS_TOKEN for an OAuth access-token reference, remove apiKeyEnv to use the scoped OAuth login record, or choose an API-key wire protocol for a custom endpoint`
  }
}

export function codexAccessTokenState(token, nowMs = Date.now()) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return { ok: false, code: 'CODEX_AUTH_TOKEN_FORMAT', message: 'OpenAI Codex OAuth access token format is invalid; sign in again.' }
  }
  let claims
  try {
    claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch {
    return { ok: false, code: 'CODEX_AUTH_TOKEN_FORMAT', message: 'OpenAI Codex OAuth access token format is invalid; sign in again.' }
  }
  const accountId = claims?.['https://api.openai.com/auth']?.chatgpt_account_id ?? claims?.chatgpt_account_id
  if (typeof accountId !== 'string' || accountId.length === 0) {
    return { ok: false, code: 'CODEX_AUTH_ACCOUNT_MISSING', message: 'OpenAI Codex OAuth credential has no account binding; sign in again.' }
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    return { ok: false, code: 'CODEX_AUTH_TOKEN_FORMAT', message: 'OpenAI Codex OAuth access token has no valid expiry; sign in again.' }
  }
  if (claims.exp * 1000 <= nowMs) {
    return { ok: false, code: 'CODEX_AUTH_TOKEN_EXPIRED', message: 'OpenAI Codex OAuth access token has expired; sign in again.' }
  }
  return { ok: true }
}

/** Normalize authentication failures and redact both the exact request credential and common unknown token renderings. */
export function providerAuthFailure(provider, message, authKind, credential) {
  const text = typeof message === 'string' && message.length > 0 ? message : 'provider authentication failed'
  let safe = typeof credential === 'string' && credential.length >= 4
    ? text.split(credential).join('[REDACTED_CREDENTIAL]')
    : text
  safe = safe
    .replace(/(\bBearer\s+)[^\s,;]+/gi, '$1[REDACTED_CREDENTIAL]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/((?:api[_-]?key|access[_-]?token|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED_CREDENTIAL]')
  const codexAuth = authKind === 'oauth-record' || authKind === 'oauth-access-token' || (authKind === undefined && provider === 'openai-codex')
  if (!codexAuth) return { message: safe }
  if (/Failed to extract accountId|account(?:\s|-)?id.*(?:missing|invalid)/i.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential has no valid account binding; sign in again.', code: 'CODEX_AUTH_ACCOUNT_MISSING' }
  }
  if (/token.*expired|expired.*token|jwt expired/i.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential has expired; sign in again.', code: 'CODEX_AUTH_TOKEN_EXPIRED' }
  }
  if (/not configured|login required|sign in required|no credential/i.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential is missing; sign in to OpenAI Codex.', code: 'CODEX_AUTH_REQUIRED' }
  }
  if (/\b(?:401|403)\b/.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential was rejected; sign in again.', code: 'CODEX_AUTH_REJECTED' }
  }
  if (authKind === 'oauth-record') {
    return { message: 'OpenAI Codex OAuth request failed; retry or sign in again.', code: 'CODEX_AUTH_FAILED' }
  }
  return { message: safe }
}

function v1ProviderAuthFailure(provider, message) {
  const text = typeof message === 'string' && message.length > 0 ? message : 'provider authentication failed'
  if (provider !== 'openai-codex') return { message: text }
  if (/Failed to extract accountId|account(?:\s|-)?id.*(?:missing|invalid)/i.test(text)) {
    return { message: 'OpenAI Codex OAuth credential has no valid account binding; sign in again.', code: 'CODEX_AUTH_ACCOUNT_MISSING' }
  }
  if (/token.*expired|expired.*token|jwt expired/i.test(text)) {
    return { message: 'OpenAI Codex OAuth credential has expired; sign in again.', code: 'CODEX_AUTH_TOKEN_EXPIRED' }
  }
  if (/not configured|login required|sign in required|no credential/i.test(text)) {
    return { message: 'OpenAI Codex OAuth credential is missing; sign in to OpenAI Codex.', code: 'CODEX_AUTH_REQUIRED' }
  }
  if (/\b(?:401|403)\b/.test(text)) {
    return { message: 'OpenAI Codex OAuth credential was rejected; sign in again.', code: 'CODEX_AUTH_REJECTED' }
  }
  return { message: text }
}

function v2ProviderAuthFailure(provider, message, authKind, credential) {
  const text = typeof message === 'string' && message.length > 0 ? message : 'provider authentication failed'
  let safe = typeof credential === 'string' && credential.length >= 4
    ? text.split(credential).join('[REDACTED_CREDENTIAL]')
    : text
  safe = safe
    .replace(/(\bBearer\s+)[^\s,;]+/gi, '$1[REDACTED_CREDENTIAL]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/((?:api[_-]?key|access[_-]?token|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED_CREDENTIAL]')
  const codexAuth = authKind === 'oauth-record' || authKind === 'oauth-access-token' || (authKind === undefined && provider === 'openai-codex')
  if (!codexAuth) return { message: safe }
  if (/Failed to extract accountId|account(?:\s|-)?id.*(?:missing|invalid)/i.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential has no valid account binding; sign in again.', code: 'CODEX_AUTH_ACCOUNT_MISSING' }
  }
  if (/token.*expired|expired.*token|jwt expired/i.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential has expired; sign in again.', code: 'CODEX_AUTH_TOKEN_EXPIRED' }
  }
  if (/not configured|login required|sign in required|no credential/i.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential is missing; sign in to OpenAI Codex.', code: 'CODEX_AUTH_REQUIRED' }
  }
  if (/\b(?:401|403)\b/.test(safe)) {
    return { message: 'OpenAI Codex OAuth credential was rejected; sign in again.', code: 'CODEX_AUTH_REJECTED' }
  }
  return { message: safe }
}

const runtimeAuthContract = providerAuthContract.toString().replace('providerAuthContract', 'modelProviderAuthContract')
const runtimeTokenState = codexAccessTokenState.toString().replace('codexAccessTokenState', 'modelCodexAccessTokenState')
const runtimeV1AuthFailure = v1ProviderAuthFailure.toString().replace('v1ProviderAuthFailure', 'modelProviderAuthFailure')
const runtimeV2AuthFailure = v2ProviderAuthFailure.toString().replace('v2ProviderAuthFailure', 'modelProviderAuthFailure')
const runtimeAuthFailure = providerAuthFailure.toString().replace('providerAuthFailure', 'modelProviderAuthFailure')

function replaceExact(source, original, patched, label) {
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH ${label} changed; refusing an unsafe provider-auth isolation patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

function patchProviderAuthIsolationV1Source(source) {
  if (source.includes(V1_MARKER)) return { source, changed: false }
  let output = source
  const classifyAnchor = `function classifyPiAiError(message) {\n\tif (/\\b(?:401|403)\\b/.test(message)) return "AUTH";`
  const classifyPatch = `const modelProviderAuthIsolationMarker = "${V1_MARKER}";\n${runtimeAuthContract}\n${runtimeTokenState}\n${runtimeV1AuthFailure}\nfunction classifyPiAiError(message) {\n\tif (/\\b(?:401|403)\\b/.test(message)) return "AUTH";`
  output = replaceExact(output, classifyAnchor, classifyPatch, 'provider error helpers')
  output = replaceExact(output, `function mapStopReason(message, contextWindow) {`, `function mapStopReason(message, contextWindow, provider) {`, 'stop reason signature')
  output = replaceExact(output,
    `\t\tcase "error": {\n\t\t\tconst text = message.errorMessage ?? "pi-ai stream error";\n\t\t\treturn {\n\t\t\t\tkind: "error",\n\t\t\t\tfailure: {\n\t\t\t\t\tmessage: text,\n\t\t\t\t\tcode: classifyPiAiError(text)\n\t\t\t\t}\n\t\t\t};\n\t\t}`,
    `\t\tcase "error": {\n\t\t\tconst text = message.errorMessage ?? "pi-ai stream error";\n\t\t\tconst normalized = modelProviderAuthFailure(provider, text);\n\t\t\treturn {\n\t\t\t\tkind: "error",\n\t\t\t\tfailure: {\n\t\t\t\t\tmessage: normalized.message,\n\t\t\t\t\tcode: normalized.code ?? classifyPiAiError(text)\n\t\t\t\t}\n\t\t\t};\n\t\t}`,
    'provider error normalization')
  output = replaceExact(output, `async function* toStreamChunks(events, contextWindow, callerSignal) {`, `async function* toStreamChunks(events, contextWindow, callerSignal, provider) {`, 'stream translator signature')
  output = replaceExact(output, `mapStopReason(event.message, contextWindow)`, `mapStopReason(event.message, contextWindow, provider)`, 'completed stop-reason call')
  output = replaceExact(output,
    `mapStopReason(callerSignal?.aborted ? {\n\t\t\t\t\t...event.error,\n\t\t\t\t\tstopReason: "aborted"\n\t\t\t\t} : event.error, contextWindow)`,
    `mapStopReason(callerSignal?.aborted ? {\n\t\t\t\t\t...event.error,\n\t\t\t\t\tstopReason: "aborted"\n\t\t\t\t} : event.error, contextWindow, provider)`,
    'failed stop-reason call')
  output = replaceExact(output,
    `\tprepareCall(provider, model, _signal) {\n\t\tconst snapshot = this.current();\n\t\treturn Promise.resolve({\n\t\t\tmodel: this.modelInfo(snapshot, provider, model),\n\t\t\tstream: (options) => this.streamWithSnapshot(options, snapshot)\n\t\t});\n\t}\n\tstream(options) {\n\t\treturn this.streamWithSnapshot(options, this.current());\n\t}\n\tasync *streamWithSnapshot(options, snapshot) {`,
    `\tasync prepareCall(provider, model, _signal) {\n\t\tconst snapshot = this.current();\n\t\tconst profile = this.profileOf(snapshot, provider);\n\t\tconst preparedCredential = {\n\t\t\tprovider,\n\t\t\tcredentialRef: profile.apiKeyEnv,\n\t\t\tvalue: await this.config.resolveApiKey(provider, profile)\n\t\t};\n\t\treturn {\n\t\t\tmodel: this.modelInfo(snapshot, provider, model),\n\t\t\tstream: (options) => this.streamWithSnapshot(options, snapshot, preparedCredential)\n\t\t};\n\t}\n\tstream(options) {\n\t\treturn this.streamWithSnapshot(options, this.current());\n\t}\n\tasync *streamWithSnapshot(options, snapshot, preparedCredential) {`,
    'prepared credential snapshot')
  output = replaceExact(output,
    `\t\t\tconst reasoning = resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning);\n\t\t\tconst apiKey = await this.config.resolveApiKey(options.provider, profile);`,
    `\t\t\tconst reasoning = resolveReasoningLevel(model, options.reasoningEffort ?? profile.reasoning);\n\t\t\tif (preparedCredential !== void 0 && (preparedCredential.provider !== options.provider || preparedCredential.credentialRef !== profile.apiKeyEnv)) {\n\t\t\t\tthrow new LlmError(\`llm-pi-ai: prepared request authentication no longer matches provider route "\${options.provider}"\`, "REQUEST_AUTH_SNAPSHOT_MISMATCH");\n\t\t\t}\n\t\t\tconst apiKey = preparedCredential === void 0 ? await this.config.resolveApiKey(options.provider, profile) : preparedCredential.value;`,
    'prepared credential use')
  output = replaceExact(output,
    `\t\t\t\t\tsignal: watchdog.signal,\n\t\t\t\t\theaders: requestHeaders(profile.headers)\n\t\t\t\t}), model.contextWindow, options.signal)[Symbol.asyncIterator]();`,
    `\t\t\t\t\tsignal: watchdog.signal,\n\t\t\t\t\theaders: requestHeaders(profile.headers)\n\t\t\t\t}), model.contextWindow, options.signal, options.provider)[Symbol.asyncIterator]();`,
    'provider-bound stream translation')
  output = replaceExact(output,
    `\tconst resolveApiKey = async (provider, profile) => {\n\t\tconst ref = profile.apiKeyEnv;\n\t\tif (ref === void 0) return void 0;\n\t\tconst credentials = ctx.get("credentials");\n\t\tconst hit = credentials !== void 0 ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value;\n\t\tif (hit !== void 0 && hit.length > 0) return assertUsableApiKey(hit, "llm-pi-ai", ref);\n\t\tthrow new LlmError(\`llm-pi-ai: no credential for provider route "\${provider}"; its profile resolves \${ref}, which is not set — store \${ref} through the credentials service (the web Models page writes it) or export it, and remove apiKeyEnv only if this provider should authenticate from pi-ai's own environment discovery\`, "MISSING_CREDENTIAL");\n\t};`,
    `\tconst resolveApiKey = async (provider, profile) => {\n\t\tconst contract = modelProviderAuthContract(provider, profile);\n\t\tif (contract.kind === "mismatch") throw new LlmError(contract.message, contract.code);\n\t\tconst ref = contract.credentialRef;\n\t\tif (ref === void 0) return void 0;\n\t\tconst credentials = ctx.get("credentials");\n\t\tconst hit = credentials !== void 0 ? (await credentials.resolve(ref))?.value : launchEnvironmentOf(ctx).get(ref)?.value;\n\t\tif (hit !== void 0 && hit.length > 0) {\n\t\t\tconst apiKey = assertUsableApiKey(hit, "llm-pi-ai", ref);\n\t\t\tif (contract.kind === "oauth-access-token") {\n\t\t\t\tconst state = modelCodexAccessTokenState(apiKey);\n\t\t\t\tif (!state.ok) throw new LlmError(state.message, state.code);\n\t\t\t}\n\t\t\treturn apiKey;\n\t\t}\n\t\tthrow new LlmError(\`llm-pi-ai: no credential for provider route "\${provider}"; its profile resolves \${ref}, which is not set — store \${ref} through the credentials service (the web Models page writes it) or export it, and remove apiKeyEnv only if this provider should authenticate from pi-ai's own environment discovery\`, "MISSING_CREDENTIAL");\n\t};`,
    'authentication contract resolution')
  return { source: output, changed: true }
}

function patchProviderAuthIsolationV2Source(source) {
  if (source.includes(V2_MARKER)) return { source, changed: false }
  let output = source
  output = replaceExact(output, V1_MARKER, V2_MARKER, 'v1 marker migration')
  output = replaceExact(output, runtimeV1AuthFailure, runtimeV2AuthFailure, 'credential redaction helper migration')
  output = replaceExact(output, `function mapStopReason(message, contextWindow, provider) {`, `function mapStopReason(message, contextWindow, auth) {`, 'effective-auth stop reason signature')
  output = replaceExact(output,
    `const normalized = modelProviderAuthFailure(provider, text);`,
    `const normalized = modelProviderAuthFailure(auth?.provider, text, auth?.kind, auth?.credential);`,
    'effective-auth error normalization')
  output = replaceExact(output, `async function* toStreamChunks(events, contextWindow, callerSignal, provider) {`, `async function* toStreamChunks(events, contextWindow, callerSignal, auth) {`, 'effective-auth stream translator signature')
  output = replaceExact(output, `mapStopReason(event.message, contextWindow, provider)`, `mapStopReason(event.message, contextWindow, auth)`, 'effective-auth completed stop reason')
  output = replaceExact(output,
    `} : event.error, contextWindow, provider)`,
    `} : event.error, contextWindow, auth)`,
    'effective-auth failed stop reason')
  output = replaceExact(output,
    `\t\t\t\t}), model.contextWindow, options.signal, options.provider)[Symbol.asyncIterator]();`,
    `\t\t\t\t}), model.contextWindow, options.signal, {\n\t\t\t\t\tprovider: options.provider,\n\t\t\t\t\tkind: modelProviderAuthContract(options.provider, profile).kind,\n\t\t\t\t\tcredential: apiKey\n\t\t\t\t})[Symbol.asyncIterator]();`,
    'request credential redaction binding')
  output = replaceExact(output,
    `\t\tthrow new LlmError(\`llm-pi-ai: no credential for provider route "\${provider}"; its profile resolves \${ref}, which is not set — store \${ref} through the credentials service (the web Models page writes it) or export it, and remove apiKeyEnv only if this provider should authenticate from pi-ai's own environment discovery\`, "MISSING_CREDENTIAL");`,
    `\t\tif (contract.kind === "oauth-access-token") throw new LlmError("OpenAI Codex OAuth credential is missing; sign in to OpenAI Codex.", "CODEX_AUTH_REQUIRED");\n\t\tthrow new LlmError(\`llm-pi-ai: no credential for provider route "\${provider}"; its profile resolves \${ref}, which is not set — store \${ref} through the credentials service (the web Models page writes it) or export it, and remove apiKeyEnv only if this provider should authenticate from pi-ai's own environment discovery\`, "MISSING_CREDENTIAL");`,
    'explicit Codex credential missing error')
  output = replaceExact(output,
    `\t\t\t\tif (options.signal?.aborted) throw new LlmError("pi-ai request aborted by caller", "ABORTED", { cause: error });\n\t\t\t\tthrow error;`,
    `\t\t\t\tif (options.signal?.aborted) throw new LlmError("pi-ai request aborted by caller", "ABORTED", { cause: error });\n\t\t\t\tconst text = error instanceof Error ? error.message : String(error);\n\t\t\t\tconst contract = modelProviderAuthContract(options.provider, profile);\n\t\t\t\tconst normalized = modelProviderAuthFailure(options.provider, text, contract.kind, apiKey);\n\t\t\t\tif (normalized.message !== text || normalized.code !== void 0) {\n\t\t\t\t\tthrow new LlmError(normalized.message, normalized.code ?? (error instanceof LlmError ? error.code : "PI_AI_ERROR"), { cause: error });\n\t\t\t\t}\n\t\t\t\tthrow error;`,
    'thrown provider error redaction')
  for (const marker of [V2_MARKER, 'CODEX_AUTH_REQUIRED', '[REDACTED_CREDENTIAL]', 'auth?.kind', 'credential: apiKey', 'normalized.message !== text']) {
    if (!output.includes(marker)) throw new Error(`Provider-auth isolation v2 output is missing ${marker}.`)
  }
  return { source: output, changed: true }
}

function patchProviderAuthIsolationV3Source(source) {
  if (source.includes(MARKER)) return { source, changed: false }
  let output = source
  output = replaceExact(output, V2_MARKER, MARKER, 'v2 marker migration')
  output = replaceExact(output, runtimeV2AuthFailure, runtimeAuthFailure, 'native Codex unknown-failure hardening')
  output = replaceExact(output,
    `\t\t\tcredentialRef: profile.apiKeyEnv,\n\t\t\tvalue: await this.config.resolveApiKey(provider, profile)`,
    `\t\t\tcredentialRef: profile.apiKeyEnv,\n\t\t\tvalue: await this.config.resolveApiKey(provider, profile),\n\t\t\tredactionValue: await this.config.resolveAuthRedaction?.(provider, profile)`,
    'prepared native OAuth redaction snapshot')
  output = replaceExact(output,
    `\t\t\tconst apiKey = preparedCredential === void 0 ? await this.config.resolveApiKey(options.provider, profile) : preparedCredential.value;\n\t\t\tconst consumer = new AbortController();`,
    `\t\t\tconst apiKey = preparedCredential === void 0 ? await this.config.resolveApiKey(options.provider, profile) : preparedCredential.value;\n\t\t\tconst redactionCredential = apiKey ?? preparedCredential?.redactionValue ?? await this.config.resolveAuthRedaction?.(options.provider, profile);\n\t\t\tconst consumer = new AbortController();`,
    'native OAuth request redaction credential')
  output = replaceExact(output,
    `\t\t\t\t\tcredential: apiKey\n\t\t\t\t})[Symbol.asyncIterator]();`,
    `\t\t\t\t\tcredential: redactionCredential\n\t\t\t\t})[Symbol.asyncIterator]();`,
    'native OAuth finish-event redaction')
  output = replaceExact(output,
    `\t\t\t\tif (timeoutOf(watchdog.signal, "LLM_STREAM_IDLE_TIMEOUT") !== void 0) throw new LlmError(\`pi-ai stream idle timeout after \${streamIdleTimeoutMs}ms\`, "TIMEOUT", { cause: error });\n\t\t\t\tif (options.signal?.aborted) throw new LlmError("pi-ai request aborted by caller", "ABORTED", { cause: error });\n\t\t\t\tconst text = error instanceof Error ? error.message : String(error);\n\t\t\t\tconst contract = modelProviderAuthContract(options.provider, profile);\n\t\t\t\tconst normalized = modelProviderAuthFailure(options.provider, text, contract.kind, apiKey);\n\t\t\t\tif (normalized.message !== text || normalized.code !== void 0) {\n\t\t\t\t\tthrow new LlmError(normalized.message, normalized.code ?? (error instanceof LlmError ? error.code : "PI_AI_ERROR"), { cause: error });\n\t\t\t\t}\n\t\t\t\tthrow error;`,
    `\t\t\t\tif (timeoutOf(watchdog.signal, "LLM_STREAM_IDLE_TIMEOUT") !== void 0) throw new LlmError(\`pi-ai stream idle timeout after \${streamIdleTimeoutMs}ms\`, "TIMEOUT");\n\t\t\t\tif (options.signal?.aborted) throw new LlmError("pi-ai request aborted by caller", "ABORTED");\n\t\t\t\tconst text = error instanceof Error ? error.message : String(error);\n\t\t\t\tconst contract = modelProviderAuthContract(options.provider, profile);\n\t\t\t\tconst normalized = modelProviderAuthFailure(options.provider, text, contract.kind, redactionCredential);\n\t\t\t\tif (redactionCredential !== void 0 || normalized.message !== text || normalized.code !== void 0) {\n\t\t\t\t\tthrow new LlmError(normalized.message, normalized.code ?? (error instanceof LlmError ? error.code : "PI_AI_ERROR"));\n\t\t\t\t}\n\t\t\t\tthrow error;`,
    'native OAuth thrown-error redaction')
  output = replaceExact(output,
    `\tconst auth = {\n\t\tcredentials: credentialStoreFrom(ctx),`,
    `\t/** Read only the current native OAuth access member for exact error redaction; pi-ai still owns validation and refresh. */\n\tconst resolveAuthRedaction = async (provider, profile) => {\n\t\tif (modelProviderAuthContract(provider, profile).kind !== "oauth-record") return void 0;\n\t\tconst record = await ctx.get("credentials")?.readRecord(recordKeyFor(provider));\n\t\tconst payload = record?.kind === "grant" && typeof record.payload === "object" && record.payload !== null ? record.payload : void 0;\n\t\treturn typeof payload?.access === "string" && payload.access.length > 0 ? payload.access : void 0;\n\t};\n\tconst auth = {\n\t\tcredentials: credentialStoreFrom(ctx),`,
    'native OAuth redaction reader')
  output = replaceExact(output,
    `\t\tresolveApiKey,\n\t\tauth,`,
    `\t\tresolveApiKey,\n\t\tresolveAuthRedaction,\n\t\tauth,`,
    'native OAuth redaction resolver binding')
  for (const marker of [MARKER, 'redactionValue:', 'const redactionCredential =', 'credential: redactionCredential', 'resolveAuthRedaction', 'pi-ai still owns validation and refresh']) {
    if (!output.includes(marker)) throw new Error(`Provider-auth isolation v3 output is missing ${marker}.`)
  }
  return { source: output, changed: true }
}

function patchProviderAuthIsolationThroughV3Source(source) {
  if (source.includes(MARKER)) return { source, changed: false }
  const v1 = source.includes(V1_MARKER) || source.includes(V2_MARKER) ? { source, changed: false } : patchProviderAuthIsolationV1Source(source)
  const v2 = v1.source.includes(V2_MARKER) ? { source: v1.source, changed: false } : patchProviderAuthIsolationV2Source(v1.source)
  const v3 = patchProviderAuthIsolationV3Source(v2.source)
  return { source: v3.source, changed: v1.changed || v2.changed || v3.changed }
}

/**
 * Every canonical stage artifact this chain produces from one pristine official source.
 * The installer pins these bytes so an unreviewed transform change fails closed; callers
 * that must bind or verify those pins derive them here instead of restating the chain,
 * which is exactly how the pinned hashes drifted from the transform once already.
 * @param source - pristine official `@deepseek-ai/dsh-llm-pi-ai` runtime source.
 * @returns the v1, v2, v3 and v4 artifacts of the chain.
 */
export function providerAuthIsolationCanonicalStages(source) {
  const v1 = patchProviderAuthIsolationV1Source(source)
  const v2 = patchProviderAuthIsolationV2Source(v1.source)
  const v3 = patchProviderAuthIsolationV3Source(v2.source)
  return { v1: v1.source, v2: v2.source, v3: v3.source, v4: patchProviderAuthIsolationSource(source).source }
}

const V4_MARKER = '@harness-desktop/provider-auth-isolation-v4'

/** A provider id alone never authorizes forwarding its stored secrets to an edited destination. */
export function providerDiscoveryRouteMatches(request, profile) {
  if (typeof request.baseURL !== 'string' || typeof profile?.baseURL !== 'string') return false
  if ((request.api ?? 'openai-completions') !== (profile.api ?? 'openai-completions')) return false
  try {
    const endpoint = value => {
      const url = new URL(`${value.replace(/\/+$/, '')}/models`)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined
      return url.href
    }
    const requested = endpoint(request.baseURL)
    return requested !== undefined && requested === endpoint(profile.baseURL)
  } catch {
    return false
  }
}

const runtimeDiscoveryRouteMatches = providerDiscoveryRouteMatches.toString().replace('providerDiscoveryRouteMatches', 'modelProviderDiscoveryRouteMatches')
const V4_REQUIRED = [
  V4_MARKER, runtimeDiscoveryRouteMatches,
  'preparedCredential.model !== options.model',
  'const stored = request.apiKey === void 0 && modelProviderDiscoveryRouteMatches(request, candidate) ? candidate : void 0;',
  'baseURL: profile.baseURL,\n\t\t\tapi: profile.api,',
  'redirect: "error",',
  'throw new LlmError(`could not reach ${url}`, "DISCOVERY_FAILED");',
  'throw new LlmError(`could not read model listing from ${url}`, "DISCOVERY_FAILED");'
]

export function patchProviderAuthIsolationSource(source) {
  if (source.includes(V4_MARKER)) {
    if (V4_REQUIRED.some(marker => !source.includes(marker))) throw new Error('Provider-auth isolation v4 patch is incomplete; refusing an unsafe repair.')
    return { source, changed: false }
  }
  let output = patchProviderAuthIsolationThroughV3Source(source).source
  output = replaceExact(output, MARKER, V4_MARKER, 'v3 marker migration')
  output = replaceExact(output,
    '\t\tconst preparedCredential = {\n\t\t\tprovider,\n\t\t\tcredentialRef:',
    '\t\tconst preparedCredential = {\n\t\t\tprovider,\n\t\t\tmodel,\n\t\t\tcredentialRef:',
    'prepared model identity')
  output = replaceExact(output,
    'preparedCredential.provider !== options.provider || preparedCredential.credentialRef !== profile.apiKeyEnv',
    'preparedCredential.provider !== options.provider || preparedCredential.model !== options.model || preparedCredential.credentialRef !== profile.apiKeyEnv',
    'prepared model identity guard')
  output = replaceExact(output,
    'async function discoverModels(request, storedProfile) {',
    `${runtimeDiscoveryRouteMatches}\nasync function discoverModels(request, storedProfile) {`,
    'discovery route binding helper')
  output = replaceExact(output,
    '\tconst stored = storedProfile?.();',
    '\tconst candidate = storedProfile?.();\n\tconst stored = request.apiKey === void 0 && modelProviderDiscoveryRouteMatches(request, candidate) ? candidate : void 0;',
    'discovery credential and headers destination guard')
  output = replaceExact(output,
    '\t\treturn {\n\t\t\theaders: profile.headers,\n\t\t\tresolveApiKey: () => resolveApiKey(provider, profile)',
    '\t\treturn {\n\t\t\tbaseURL: profile.baseURL,\n\t\t\tapi: profile.api,\n\t\t\theaders: profile.headers,\n\t\t\tresolveApiKey: () => resolveApiKey(provider, profile)',
    'stored discovery route facts')
  output = replaceExact(output,
    '\t\tresponse = await fetch(url, {\n\t\t\tmethod: "GET",\n\t\t\theaders,',
    '\t\tresponse = await fetch(url, {\n\t\t\tmethod: "GET",\n\t\t\tredirect: "error",\n\t\t\theaders,',
    'discovery redirect credential boundary')
  output = replaceExact(output,
    '\t\tif (request.signal?.aborted) throw new LlmError("model discovery aborted by caller", "ABORTED", { cause: error });\n\t\tthrow new LlmError(`could not reach ${url}`, "DISCOVERY_FAILED", { cause: error });',
    '\t\tif (request.signal?.aborted) throw new LlmError("model discovery aborted by caller", "ABORTED");\n\t\tthrow new LlmError(`could not reach ${url}`, "DISCOVERY_FAILED");',
    'discovery transport cause redaction')
  output = replaceExact(output,
    '\t\tif (request.signal?.aborted) throw new LlmError("model discovery aborted by caller", "ABORTED", { cause: error });\n\t\tthrow error;',
    '\t\tif (request.signal?.aborted) throw new LlmError("model discovery aborted by caller", "ABORTED");\n\t\tthrow new LlmError(`could not read model listing from ${url}`, "DISCOVERY_FAILED");',
    'discovery response-read cause redaction')
  output = replaceExact(output,
    '\t\tthrow new LlmError(`${url} did not answer with JSON`, "DISCOVERY_FAILED", { cause: error });',
    '\t\tthrow new LlmError(`${url} did not answer with JSON`, "DISCOVERY_FAILED");',
    'discovery response-parse cause redaction')
  if (V4_REQUIRED.some(marker => !output.includes(marker))) throw new Error('Provider-auth isolation v4 output is incomplete.')
  return { source: output, changed: true }
}
