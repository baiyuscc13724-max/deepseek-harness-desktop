const MARKER = '@harness-desktop/deepseek-model-discovery-v1'

const INSERT_ANCHOR = `function apply(ctx, config) {
\tlet current = () => config;`

const INSERT_PATCH = `/** ${MARKER}: authenticate a draft key without storing or exposing it. */
async function discoverDeepSeekModels(request, connection, resolveStoredApiKey) {
\tconst supplied = request.apiKey ?? await resolveStoredApiKey(connection);
\tconst apiKey = assertUsableApiKey(supplied, "llm-deepseek", connection.apiKeyEnv);
\tconst baseURL = (request.baseURL ?? connection.baseURL).replace(/\\\/+$/u, "");
\tconst url = \`\${baseURL}/models\`;
\tlet response;
\ttry {
\t\tresponse = await fetch(url, {
\t\t\tmethod: "GET",
\t\t\theaders: {
\t\t\t\taccept: "application/json",
\t\t\t\tauthorization: \`Bearer \${apiKey}\`
\t\t\t},
\t\t\t...request.signal === void 0 ? {} : { signal: request.signal }
\t\t});
\t} catch (error) {
\t\tif (request.signal?.aborted) throw new LlmError("DeepSeek credential validation aborted by caller", "ABORTED", { cause: error });
\t\tthrow new LlmError(\`Could not reach \${url}\`, "DISCOVERY_FAILED", { cause: error });
\t}
\tif (!response.ok) throw new LlmError(\`\${url} answered \${response.status}\${response.status === 401 || response.status === 403 ? "; check the API key" : ""}\`, response.status === 401 || response.status === 403 ? "AUTH" : "DISCOVERY_FAILED", { status: response.status });
\tlet body;
\ttry {
\t\tbody = await response.json();
\t} catch (error) {
\t\tthrow new LlmError(\`\${url} did not answer with JSON\`, "DISCOVERY_FAILED", { cause: error });
\t}
\tconst rows = Array.isArray(body?.data) ? body.data : [];
\treturn rows.filter((row) => typeof row?.id === "string" && row.id.length > 0).map((row) => ({
\t\tid: row.id,
\t\tname: typeof row.name === "string" && row.name.length > 0 ? row.name : row.id
\t}));
}
function apply(ctx, config) {
\tlet current = () => config;`

const REGISTRATION_ANCHOR = `\tctx.llm.registerConfigurableProviders([{
\t\tprovider: PROVIDER,
\t\tdisplayName: "DeepSeek",
\t\tsettingsNs: NS,
\t\tsettingsPath: []
\t}]);
\tconst registration = ctx.llm.registerAdapter([PROVIDER], adapter);`

const REGISTRATION_PATCH = `\tctx.llm.registerConfigurableProviders([{
\t\tprovider: PROVIDER,
\t\tdisplayName: "DeepSeek",
\t\tsettingsNs: NS,
\t\tsettingsPath: []
\t}]);
\tctx.llm.registerModelDiscovery(NS, (request) => discoverDeepSeekModels(request, options(), resolveApiKey));
\tconst registration = ctx.llm.registerAdapter([PROVIDER], adapter);`

const FINAL_MARKERS = [
  MARKER,
  'async function discoverDeepSeekModels(',
  'ctx.llm.registerModelDiscovery(NS, (request) => discoverDeepSeekModels(request, options(), resolveApiKey));',
  'response.status === 401 || response.status === 403 ? "AUTH" : "DISCOVERY_FAILED"'
]

export function patchDeepSeekModelDiscoverySource(source) {
  const present = FINAL_MARKERS.filter(marker => source.includes(marker))
  if (present.length === FINAL_MARKERS.length) return { source, changed: false }
  if (present.length > 0) throw new Error('Pinned DeepSeek model-discovery patch is incomplete; refusing an unsafe repair.')
  if (!source.includes(INSERT_ANCHOR)) throw new Error('Pinned DSH DeepSeek apply anchor changed; refusing an unsafe model-discovery patch.')
  if (!source.includes(REGISTRATION_ANCHOR)) throw new Error('Pinned DSH DeepSeek provider registration changed; refusing an unsafe model-discovery patch.')
  const patched = source.replace(INSERT_ANCHOR, INSERT_PATCH).replace(REGISTRATION_ANCHOR, REGISTRATION_PATCH)
  return { source: patched, changed: true }
}
