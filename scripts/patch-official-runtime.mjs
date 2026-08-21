import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeClient = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js')
const directoryPickerRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js')
const conversationRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
const tokenMeterRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-token-meter', 'lib', 'index.js')
const subagentRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js')
const agentLoopRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js')
const subagentContinuationRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'index.js')

function dedentOne(source) {
  return source.split('\n').map(line => line.slice(1)).join('\n')
}

const ORIGINAL = dedentOne(`\t\t\t\tstartSession(workspaceId) {
\t\t\t\t\tconst workspace = this.list.getSnapshot();
\t\t\t\t\tconst current = this.sessions.list.getSnapshot().current;
\t\t\t\t\tconst currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
\t\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId;
\t\t\t\t\tif (target === void 0) {
\t\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tthis.connectWorkspace(target).then((sessionId) => {
\t\t\t\t\t\tthis.sessions.open(sessionId);
\t\t\t\t\t}, (reason) => {
\t\t\t\t\t\tconsole.warn("new session failed:", reason);
\t\t\t\t\t});
\t\t\t\t}`)

const PATCHED_V1 = dedentOne(`\t\t\t\tstartSession(workspaceId) {
\t\t\t\t\tconst workspace = this.list.getSnapshot();
\t\t\t\t\tconst current = this.sessions.list.getSnapshot().current;
\t\t\t\t\tconst currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
\t\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId;
\t\t\t\t\tif (target === void 0) {
\t\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tconst openSession = workspaceId === void 0
\t\t\t\t\t\t? this.connectWorkspace(target)
\t\t\t\t\t\t: this.sessions.create({ workspaceId: target });
\t\t\t\t\topenSession.then((sessionId) => {
\t\t\t\t\t\tthis.sessions.open(sessionId);
\t\t\t\t\t}, (reason) => {
\t\t\t\t\t\tconsole.warn("new session failed:", reason);
\t\t\t\t\t});
\t\t\t\t}`)

const PATCHED_V2 = dedentOne(`\t\t\t\tstartSession(workspaceId) {
\t\t\t\t\tconst workspace = this.list.getSnapshot();
\t\t\t\t\tconst current = this.sessions.list.getSnapshot().current;
\t\t\t\t\tconst currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
\t\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId;
\t\t\t\t\tif (target === void 0) {
\t\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\tthis.sessions.create({ workspaceId: target }).then((sessionId) => {
\t\t\t\t\t\tthis.sessions.open(sessionId);
\t\t\t\t\t}, (reason) => {
\t\t\t\t\t\tif (current !== void 0) this.sessions.open(current);
\t\t\t\t\t\tconsole.warn("new session failed:", reason);
\t\t\t\t\t});
\t\t\t\t}`)

const PATCHED = dedentOne(`\t\t\t\tstartSession(workspaceId) {
\t\t\t\t\tconst workspace = this.list.getSnapshot();
\t\t\t\t\tconst sessionState = this.sessions.list.getSnapshot();
\t\t\t\t\tconst current = sessionState.current;
\t\t\t\t\tthis.sessionWorkspaceHints ??= new Map();
\t\t\t\t\tconst currentSummary = current === void 0 ? void 0 : sessionState.byId[current];
\t\t\t\t\tconst currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current) || currentSummary?.cwd !== void 0 && item.path === currentSummary.cwd)?.workspaceId ?? this.sessionWorkspaceHints.get(current);
\t\t\t\t\tconst target = workspaceId ?? currentWorkspaceId ?? workspace.recentWorkspaceId;
\t\t\t\t\tif (target === void 0) {
\t\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\t\treturn;
\t\t\t\t\t}
\t\t\t\t\tthis.sessions.clear();
\t\t\t\t\tthis.sessions.create({ workspaceId: target }).then((sessionId) => {
\t\t\t\t\t\tthis.sessionWorkspaceHints.set(sessionId, target);
\t\t\t\t\t\tthis.sessions.open(sessionId);
\t\t\t\t\t}, (reason) => {
\t\t\t\t\t\tif (current !== void 0) this.sessions.open(current);
\t\t\t\t\t\tconsole.warn("new session failed:", reason);
\t\t\t\t\t});
\t\t\t\t}`)

const DIRECTORY_PICKER_ORIGINAL = 'if (platform === "win32") return await (internals.pickWin32Dialog ?? pickWin32Directory)(signal);'
const DIRECTORY_PICKER_PATCHED = `if (platform === "win32") {
		const script = [
			"$ErrorActionPreference = 'Stop'",
			"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
			"Add-Type -AssemblyName System.Windows.Forms",
			"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
			"$dialog.Description = 'Select Workspace Directory'",
			"$dialog.ShowNewFolderButton = $true",
			"if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }"
		].join("; ");
		const encoded = Buffer.from(script, "utf16le").toString("base64");
		return outputPath((await run("powershell.exe", [
			"-NoProfile",
			"-NonInteractive",
			"-STA",
			"-EncodedCommand",
			encoded
		], signal)).stdout);
	}`

const MARKDOWN_SANITIZE_PATCHED = dedentOne(`	function desktopLocalHref(url) {
		let decoded = String(url ?? "");
		try {
			decoded = decodeURIComponent(decoded);
		} catch {}
		if (!/^file:/i.test(decoded) && !/^[a-z]:[\\\\/]/i.test(decoded) && !/^\\\\\\\\[^\\\\]+\\\\[^\\\\]+/.test(decoded) && !/^\\/(?!\\/)/.test(decoded)) return;
		return \`harness-desktop://open-local?path=\${encodeURIComponent(decoded)}\`;
	}
	function sanitizeUrl(url) {
		const local = desktopLocalHref(url);
		if (local !== void 0) return local;
		try {
			switch (new URL(url).protocol) {
				case "http:":
				case "https:":
				case "mailto:": return url;
				default: return "";
			}
		} catch {
			return "";
		}
	}`)

const CONVERSATION_MENTIONS_ORIGINAL = 'fileMentions: (owner) => ctx.get("chatFileMentions")?.forClosing(owner),'
const CONVERSATION_MENTIONS_PATCHED = dedentOne(`						fileMentions: (owner) => ctx.get("chatFileMentions")?.forClosing(owner) ?? { resolve(value) {
							const target = value.trim();
							const looksLikePath = /[/\\\\]/.test(target) || /^\\.{1,2}$/.test(target) || /^[^<>:"|?*]+\\.[a-z0-9]{1,12}(?::\\d+(?::\\d+)?)?$/i.test(target);
							const launchable = /\\.(?:appref-ms|bat|cmd|com|cpl|exe|hta|inf|ins|isp|js|jse|lnk|msc|msi|msp|mst|pif|ps1|reg|scr|sct|url|vb|vbe|vbs|ws|wsc|wsf|wsh)(?::\\d+(?::\\d+)?)?$/i.test(target);
							if (target === "" || !looksLikePath || launchable || /^https?:/i.test(target)) return;
							return {
								open: () => owner.openFile(target),
								label: \`Open workspace path \${target}\`,
								title: target
							};
						} },`)

const TOKEN_USAGE_DETAIL_MARKER = 'key: "tokenUsageDetail"'
const TOKEN_USAGE_DETAIL_ANCHOR = 'const contextPressureProjectionDefinition = {'
const TOKEN_USAGE_DETAIL_PATCH = dedentOne(`	const tokenUsageDetailSchema = z$1.object({
		totals: projectionSchema,
		last: projectionSchema.nullable(),
		warmTotals: projectionSchema,
		sampleCount: z$1.number().int().nonnegative(),
		cacheTelemetryObserved: z$1.boolean(),
		lastCacheReadReported: z$1.boolean(),
		routeKey: z$1.string().nullable(),
		previousPromptTokens: z$1.number().int().nonnegative().nullable()
	}).strict();
	const tokenUsageDetailProjectionDefinition = {
		key: "tokenUsageDetail",
		schema: tokenUsageDetailSchema,
		init: () => ({
			totals: zeroBuckets(),
			last: null,
			activeRouteKey: null,
			routes: {}
		}),
		apply: (state, event) => {
			if (event.type === "request/header") {
				const provider = event.data.header?.config?.provider;
				const model = event.data.header?.config?.model;
				const routeKey = typeof provider === "string" && typeof model === "string" ? \`\${provider}/\${model}\` : null;
				return routeKey === state.activeRouteKey ? state : { ...state, activeRouteKey: routeKey };
			}
			let turn;
			let step;
			let usage;
			if (event.type === "assistant/chunk" && event.data.chunk.type === "usage") {
				({turn, step} = event.data);
				usage = event.data.chunk.usage;
			} else if (event.type === "assistant/message" && event.data.usage !== void 0) ({turn, step, usage} = event.data);
			else return state;
			const routeKey = state.activeRouteKey ?? "unknown";
			const route = state.routes[routeKey] ?? {
				sampleCount: 0,
				promptTokens: 0,
				warmTotals: zeroBuckets(),
				cacheTelemetryObserved: false
			};
			const buckets = bucketsFrom(usage);
			const previous = state.last !== null && state.last.turn === turn && state.last.step === step && state.last.routeKey === routeKey ? state.last : void 0;
			const cacheReadReported = Object.prototype.hasOwnProperty.call(usage, "cacheReadTokens");
			if (previous !== void 0 && bucketsEqual(previous.buckets, buckets) && previous.cacheReadReported === cacheReadReported) return state;
			const isWarm = previous?.isWarm ?? route.sampleCount > 0;
			const previousPromptTokens = previous?.previousPromptTokens ?? route.promptTokens;
			const warmTotals = isWarm ? addReplacing(route.warmTotals, previous?.isWarm ? previous.buckets : void 0, buckets) : route.warmTotals;
			const nextRoute = {
				sampleCount: route.sampleCount + (previous === void 0 ? 1 : 0),
				promptTokens: buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens,
				warmTotals,
				cacheTelemetryObserved: route.cacheTelemetryObserved || cacheReadReported
			};
			return {
				...state,
				totals: addReplacing(state.totals, previous?.buckets, buckets),
				routes: { ...state.routes, [routeKey]: nextRoute },
				last: { turn, step, routeKey, buckets, isWarm, previousPromptTokens, cacheReadReported }
			};
		},
		view: (state) => {
			const routeKey = state.last?.routeKey ?? state.activeRouteKey;
			const route = routeKey === null ? void 0 : state.routes[routeKey];
			return {
				totals: state.totals,
				last: state.last?.buckets ?? null,
				warmTotals: route?.warmTotals ?? zeroBuckets(),
				sampleCount: route?.sampleCount ?? 0,
				cacheTelemetryObserved: route?.cacheTelemetryObserved ?? false,
				lastCacheReadReported: state.last?.cacheReadReported ?? false,
				routeKey,
				previousPromptTokens: state.last?.previousPromptTokens ?? null
			};
		},
		stateVersion: 1
	};
	`)

const TOKEN_USAGE_REGISTER_ORIGINAL = 'projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition);\n\t\t\tprojectionCtx.sessionProjections.register(contextPressureProjectionDefinition);'
const TOKEN_USAGE_REGISTER_PATCHED = 'projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition);\n\t\t\tprojectionCtx.sessionProjections.register(tokenUsageDetailProjectionDefinition);\n\t\t\tprojectionCtx.sessionProjections.register(contextPressureProjectionDefinition);'

const CONVERSATION_USAGE_ORIGINAL = 'const usage = useProjection("tokenUsage");\n\t\t\tconst projected = useProjection("sessionStats");'
const CONVERSATION_USAGE_PATCHED = 'const usage = useProjection("tokenUsage");\n\t\t\tconst cacheDetail = useProjection("tokenUsageDetail");\n\t\t\tconst projected = useProjection("sessionStats");'

const CONVERSATION_CACHE_ORIGINAL = `			if (usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
				const cacheHit = cacheHitPercent(usage);
				if (cacheHit !== null) groups.push(t("stats.cacheHit", { percent: cacheHit }));
				groups.push(t("stats.tokens", {
					input: formatTokens(billedInputTokens(usage)),
					output: formatTokens(usage.outputTokens)
				}));
			}
			const line = groups.join(" | ");`

const CONVERSATION_CACHE_PATCHED = `			const cacheDetails = [];
			if (usage !== void 0 && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
				const cumulative = cacheHitPercent(usage);
				if (cacheDetail?.last !== null && cacheDetail?.last !== void 0) {
					if (cacheDetail.lastCacheReadReported) {
						const recent = cacheHitPercent(cacheDetail.last);
						if (recent !== null) groups.push(t("stats.cacheLast", { percent: recent }));
					} else groups.push(t("stats.cacheUnreported"));
					const warm = cacheHitPercent(cacheDetail.warmTotals);
					if (cacheDetail.cacheTelemetryObserved && warm !== null) cacheDetails.push(t("stats.cacheWarm", { percent: warm }));
					if (cacheDetail.previousPromptTokens > 0 && cacheDetail.lastCacheReadReported) {
						const reused = Math.round(Math.min(cacheDetail.last.cacheReadTokens, cacheDetail.previousPromptTokens) / cacheDetail.previousPromptTokens * 100);
						cacheDetails.push(t("stats.cachePrefixReuse", { percent: reused }));
					}
				} else if (cumulative !== null) groups.push(t("stats.cacheHit", { percent: cumulative }));
				if (cumulative !== null) cacheDetails.push(t("stats.cacheCumulative", { percent: cumulative }));
				groups.push(t("stats.tokens", {
					input: formatTokens(billedInputTokens(usage)),
					output: formatTokens(usage.outputTokens)
				}));
			}
			const line = groups.join(" | ");
			const tooltipLine = [...groups, ...cacheDetails.filter((item) => !groups.includes(item))].join(" | ");`

const CONVERSATION_TOOLTIP_ORIGINAL = 'label: line,\n\t\t\t\tside: "top",\n\t\t\t\tdelayMs: 500,\n\t\t\t\tdisabled: !truncated,'
const CONVERSATION_TOOLTIP_PATCHED = 'label: tooltipLine,\n\t\t\t\tside: "top",\n\t\t\t\tdelayMs: 500,\n\t\t\t\tdisabled: !truncated && tooltipLine === line,'
const CONVERSATION_CACHE_ZH_ORIGINAL = '"stats.cacheHit": "缓存命中 {percent}%",'
const CONVERSATION_CACHE_ZH_PATCHED = `			"stats.cacheHit": "累计缓存读取 {percent}%",
			"stats.cacheLast": "最近一步缓存读取 {percent}%",
			"stats.cacheWarm": "热请求缓存读取 {percent}%",
			"stats.cachePrefixReuse": "前缀复用约 {percent}%",
			"stats.cacheCumulative": "累计缓存读取 {percent}%（含首次冷启动）",
			"stats.cacheUnreported": "缓存：提供方未报告",`
const CONVERSATION_CACHE_EN_ORIGINAL = '"stats.cacheHit": "Cache hit {percent}%",'
const CONVERSATION_VIEW_OWNER_ORIGINAL = `				children: active !== void 0 && renderSlot("conversation.view", {
					inspect,
					onInspectDone: () => {`
const CONVERSATION_VIEW_OWNER_PATCHED = `				children: active !== void 0 && renderSlot("conversation.view", {
					inspect,
					setView: actions.setView,
					onInspectDone: () => {`
const CONVERSATION_CACHE_EN_PATCHED = `			"stats.cacheHit": "Cumulative cache read {percent}%",
			"stats.cacheLast": "Latest cache read {percent}%",
			"stats.cacheWarm": "Warm-request cache read {percent}%",
			"stats.cachePrefixReuse": "Prefix reuse about {percent}%",
			"stats.cacheCumulative": "Cumulative cache read {percent}% (includes cold start)",
			"stats.cacheUnreported": "Cache: not reported by provider",`

const SUBAGENT_LIFECYCLE_HELPERS_ANCHOR = '\t\t/** Render one catalog level and recurse only through explicitly expanded rows. */'
const SUBAGENT_LIFECYCLE_HELPERS_MARKER = 'function subagentLifecycleBucket(entry) {'
const SUBAGENT_LIFECYCLE_HELPERS_PATCH = String(`\t\tfunction subagentLifecycleBucket(entry) {
\t\t\tif (entry.kind !== "child") return "history";
\t\t\tif (entry.activity === "running") return "running";
\t\t\treturn entry.mode === "continuable" ? "resumable" : "history";
\t\t}
\t\tfunction summaryLifecycleBucket(summary) {
\t\t\tif (summary.running) return "running";
\t\t\treturn summary.projectionValues?.subagent?.mode === "continuable" ? "resumable" : "history";
\t\t}
\t\tfunction belongsToSubagentTree(summary, rootSessionId, summaries) {
\t\t\tconst seen = /* @__PURE__ */ new Set();
\t\t\tlet current = summary;
\t\t\twhile (current?.origin === "subagent" && current.parentId !== void 0 && !seen.has(current.id)) {
\t\t\t\tif (current.parentId === rootSessionId) return true;
\t\t\t\tseen.add(current.id);
\t\t\t\tcurrent = summaries[current.parentId];
\t\t\t}
\t\t\treturn false;
\t\t}
\t\tfunction subagentLifecycleCounts(summaries, rootSessionId, descendantCount) {
\t\t\tlet running = 0;
\t\t\tlet resumable = 0;
\t\t\tfor (const summary of Object.values(summaries)) {
\t\t\t\tif (summary.origin !== "subagent" || !belongsToSubagentTree(summary, rootSessionId, summaries)) continue;
\t\t\t\tconst bucket = summaryLifecycleBucket(summary);
\t\t\t\tif (bucket === "running") running += 1;
\t\t\t\telse if (bucket === "resumable") resumable += 1;
\t\t\t}
\t\t\treturn {
\t\t\t\trunning,
\t\t\t\tresumable,
\t\t\t\thistory: Math.max(0, descendantCount - running - resumable)
\t\t\t};
\t\t}
\t\tfunction lifecycleFilterMatches(bucket, filter) {
\t\t\tif (filter === "all") return true;
\t\t\tif (filter === "active") return bucket === "running" || bucket === "resumable";
\t\t\treturn bucket === "history";
\t\t}
\t\tfunction subagentBranchMatches(entry, filter, summaries) {
\t\t\tif (entry.kind !== "child") return filter !== "active";
\t\t\tif (lifecycleFilterMatches(subagentLifecycleBucket(entry), filter)) return true;
\t\t\tfor (const summary of Object.values(summaries)) {
\t\t\t\tif (summary.origin === "subagent" && belongsToSubagentTree(summary, entry.id, summaries) && lifecycleFilterMatches(summaryLifecycleBucket(summary), filter)) return true;
\t\t\t}
\t\t\treturn false;
\t\t}
\t`)

const SUBAGENT_CATALOG_ROWS_ORIGINAL = String(`\t\tfunction CatalogRows({ parentSessionId, catalog, catalogs, summaries, expanded, level, now, openChild, refresh, toggleBranch, closeCatalog, t }) {
\t\t\tconst emptyLoading = catalog.state === "loading" && catalog.entries.length === 0;
\t\t\tconst reserveDisclosure = catalog.entries.some((entry) => entry.kind === "child" && entry.hasChildren);`)
const SUBAGENT_CATALOG_ROWS_PATCHED = String(`\t\tfunction CatalogRows({ parentSessionId, catalog, catalogs, summaries, expanded, level, now, openChild, refresh, toggleBranch, closeCatalog, filter, t }) {
\t\t\tconst emptyLoading = catalog.state === "loading" && catalog.entries.length === 0;
\t\t\tconst filteredEntries = catalog.entries.filter((entry) => subagentBranchMatches(entry, filter, summaries));
\t\t\tconst reserveDisclosure = filteredEntries.some((entry) => entry.kind === "child" && entry.hasChildren);`)
const SUBAGENT_CATALOG_MAP_ORIGINAL = '\t\t\t\tcatalog.entries.map((entry) => {'
const SUBAGENT_CATALOG_MAP_PATCHED = '\t\t\t\tfilteredEntries.map((entry) => {'
const SUBAGENT_ACTIVITY_ORIGINAL = 'const activity = entry.activity === "running" ? t("activity.running") : t("activity.inactive");'
const SUBAGENT_ACTIVITY_PATCHED = 'const activity = entry.activity === "running" ? t("activity.running") : entry.mode === "continuable" ? t("activity.resumable") : t("activity.history");'
const SUBAGENT_RECURSIVE_PROPS_ORIGINAL = '\t\t\t\t\t\t\t\tcloseCatalog,\n\t\t\t\t\t\t\t\tt'
const SUBAGENT_RECURSIVE_PROPS_PATCHED = '\t\t\t\t\t\t\t\tcloseCatalog,\n\t\t\t\t\t\t\t\tfilter,\n\t\t\t\t\t\t\t\tt'
const SUBAGENT_FILTER_STATE_ORIGINAL = '\t\t\tconst [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());'
const SUBAGENT_FILTER_STATE_PATCHED = `${SUBAGENT_FILTER_STATE_ORIGINAL}\n\t\t\tconst [lifecycleFilter, setLifecycleFilter] = (0, react.useState)("active");`
const SUBAGENT_COUNTS_ORIGINAL = String(`\t\t\tconst descendantCount = Math.max(healthy.length, descendants.count);
\t\t\tconst totalCountKey = descendantCount === 1 ? "count.total.one" : "count.total.other";
\t\t\tconst runningCountKey = descendants.runningCount === 1 ? "count.running.one" : "count.running.other";`)
const SUBAGENT_COUNTS_PATCHED = String(`\t\t\tconst descendantCount = Math.max(healthy.length, descendants.count);
\t\t\tconst totalCountKey = descendantCount === 1 ? "count.total.one" : "count.total.other";
\t\t\tconst lifecycle = (0, react.useMemo)(() => subagentLifecycleCounts(summaries, sessionId, descendantCount), [summaries, sessionId, descendantCount]);
\t\t\tconst currentCount = lifecycle.running + lifecycle.resumable;
\t\t\tconst effectiveLifecycleFilter = lifecycleFilter === "active" && currentCount === 0 ? "history" : lifecycleFilter;`)
const SUBAGENT_TRIGGER_ARIA_ORIGINAL = `"aria-label": t(descendants.runningCount > 0 ? runningCountKey : totalCountKey, { count: descendants.runningCount > 0 ? descendants.runningCount : descendantCount }),`
const SUBAGENT_TRIGGER_ARIA_PATCHED = `"aria-label": t(currentCount > 0 ? "count.lifecycle" : "count.historyOnly", { running: lifecycle.running, resumable: lifecycle.resumable, history: lifecycle.history }),`
const SUBAGENT_TRIGGER_POPUP_ORIGINAL = '"aria-haspopup": "tree",'
const SUBAGENT_TRIGGER_POPUP_PATCHED = '"aria-haspopup": "dialog",'
const SUBAGENT_TRIGGER_COUNT_ORIGINAL = 'children: t(totalCountKey, { count: descendantCount })'
const SUBAGENT_TRIGGER_COUNT_PATCHED = 'children: t(currentCount > 0 ? "count.lifecycle" : "count.historyOnly", { running: lifecycle.running, resumable: lifecycle.resumable, history: lifecycle.history })'
const SUBAGENT_TRIGGER_COUNT_COMPAT = 'children: t("count.compact", { count: descendantCount })'
const SUBAGENT_MENU_ORIGINAL = String(`\t\t\t\t}), open && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\tclassName: SubagentCatalogAction_module_css_default.menu,
\t\t\t\t\trole: "tree",
\t\t\t\t\t"aria-label": t("tree.aria"),
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(CatalogRows, {`)
const SUBAGENT_MENU_PATCHED = String(`\t\t\t\t}), open && (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\tclassName: SubagentCatalogAction_module_css_default.menu,
\t\t\t\t\trole: "dialog",
\t\t\t\t\t"aria-label": t("tree.aria"),
\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\tclassName: "hd-subagent-lifecycle",
\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle-status",
\t\t\t\t\t\t\trole: "status",
\t\t\t\t\t\t\tchildren: [
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: "hd-subagent-status-running", children: t("status.running", { count: lifecycle.running }) }),
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { children: t("status.resumable", { count: lifecycle.resumable }) }),
\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { children: t("status.history", { count: lifecycle.history }) })
\t\t\t\t\t\t\t]
\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle-tabs",
\t\t\t\t\t\t\trole: "tablist",
\t\t\t\t\t\t\t"aria-label": t("filter.aria"),
\t\t\t\t\t\t\tchildren: [["active", t("filter.active", { count: currentCount })], ["history", t("filter.history", { count: lifecycle.history })], ["all", t("filter.all", { count: descendantCount })]].map(([value, label]) => (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\t\t\trole: "tab",
\t\t\t\t\t\t\t\t"aria-selected": effectiveLifecycleFilter === value,
\t\t\t\t\t\t\t\tdisabled: value === "active" ? currentCount === 0 : value === "history" ? lifecycle.history === 0 : descendantCount === 0,
\t\t\t\t\t\t\t\tclassName: effectiveLifecycleFilter === value ? "hd-subagent-lifecycle-tab hd-subagent-lifecycle-tab-active" : "hd-subagent-lifecycle-tab",
\t\t\t\t\t\t\t\tonClick: (event) => {
\t\t\t\t\t\t\t\t\tevent.preventDefault();
\t\t\t\t\t\t\t\t\tevent.stopPropagation();
\t\t\t\t\t\t\t\t\tsetLifecycleFilter(value);
\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\tchildren: label
\t\t\t\t\t\t\t}, value))
\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("p", {
\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle-note",
\t\t\t\t\t\t\tchildren: t("lifecycle.note")
\t\t\t\t\t\t})]
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\trole: "tree",
\t\t\t\t\t\t"aria-label": t("tree.aria"),
\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(CatalogRows, {`)
const SUBAGENT_ROOT_FILTER_PROPS_ORIGINAL = '\t\t\t\t\t\tcloseCatalog: () => {\n\t\t\t\t\t\t\tchangeOpen(false);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tt\n\t\t\t\t\t})\n\t\t\t\t})]'
const SUBAGENT_ROOT_FILTER_PROPS_PATCHED = '\t\t\t\t\t\tcloseCatalog: () => {\n\t\t\t\t\t\t\tchangeOpen(false);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tfilter: effectiveLifecycleFilter,\n\t\t\t\t\t\tt\n\t\t\t\t\t})\n\t\t\t\t\t})]\n\t\t\t\t})]'
const SUBAGENT_STYLE_ANCHOR = '\t\tconst tagId$1 = "@deepseek-ai/dsh-client-ui-subagent/SubagentCatalogAction.module.css";'
const SUBAGENT_STYLE_MARKER = 'dataPluginCss = "@harness-desktop/subagent-lifecycle"'
const SUBAGENT_STYLE_PATCH = String(`\t\tconst lifecycleCss = ".h8S2Va_menu{width:560px!important;max-width:min(680px,100vw - 32px)!important}.hd-subagent-lifecycle{position:sticky;z-index:2;top:-4px;background:var(--dsw-specific-menu);border-bottom:1px solid var(--dsw-alias-border-l2);padding:10px 10px 9px}.hd-subagent-lifecycle-status{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;gap:6px 12px;font-size:12px;line-height:18px;display:flex}.hd-subagent-status-running{color:var(--dsw-alias-state-success-primary,#22a06b)}.hd-subagent-lifecycle-tabs{background:var(--dsw-alias-bg-layer-2);border-radius:8px;gap:3px;margin-top:8px;padding:3px;display:flex}.hd-subagent-lifecycle-tab{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:0;border-radius:6px;flex:1;padding:5px 8px;font-size:12px}.hd-subagent-lifecycle-tab:hover{color:var(--dsw-alias-label-primary)}.hd-subagent-lifecycle-tab:disabled{cursor:not-allowed;opacity:.45}.hd-subagent-lifecycle-tab-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.hd-subagent-lifecycle-note{color:var(--dsw-alias-label-tertiary);margin:7px 2px 0;font-size:11px;line-height:16px}";
\t\tconst dataPluginCss = "@harness-desktop/subagent-lifecycle";
\t\tif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(dataPluginCss) + "]") === null) {
\t\t\tconst lifecycleTag = document.createElement("style");
\t\t\tlifecycleTag.dataset.plugin = "harness-desktop";
\t\t\tlifecycleTag.dataset.pluginCss = dataPluginCss;
\t\t\tlifecycleTag.textContent = lifecycleCss;
\t\t\tdocument.head.appendChild(lifecycleTag);
\t\t}
\t`)
const SUBAGENT_ZH_ACTIVITY_ORIGINAL = '\t\t\t"activity.inactive": "当前未运行",'
const SUBAGENT_ZH_ACTIVITY_PATCHED = String(`\t\t\t"activity.inactive": "当前未运行",
\t\t\t"activity.resumable": "待命（可恢复）",
\t\t\t"activity.history": "已结束（仅记录）",
\t\t\t"status.running": "运行中 {count}",
\t\t\t"status.resumable": "可继续 {count}",
\t\t\t"status.history": "历史 {count}",
\t\t\t"filter.aria": "筛选子代理会话",
\t\t\t"filter.active": "当前 {count}",
\t\t\t"filter.history": "历史 {count}",
\t\t\t"filter.all": "全部 {count}",
\t\t\t"lifecycle.note": "一次性任务结束后仅保留记录；可继续任务待命时不发起模型请求，可随时恢复。",
\t\t\t"count.lifecycle": "运行 {running} · 可继续 {resumable}",
\t\t\t"count.historyOnly": "历史 {history}",`)
const SUBAGENT_EN_ACTIVITY_ORIGINAL = '\t\t\t"activity.inactive": "not running",'
const SUBAGENT_EN_ACTIVITY_PATCHED = String(`\t\t\t"activity.inactive": "not running",
\t\t\t"activity.resumable": "ready to resume",
\t\t\t"activity.history": "ended (record only)",
\t\t\t"status.running": "Running {count}",
\t\t\t"status.resumable": "Resumable {count}",
\t\t\t"status.history": "History {count}",
\t\t\t"filter.aria": "Filter subagent sessions",
\t\t\t"filter.active": "Current {count}",
\t\t\t"filter.history": "History {count}",
\t\t\t"filter.all": "All {count}",
\t\t\t"lifecycle.note": "One-shot tasks keep only their record after ending; resumable tasks make no model request while waiting and can be resumed later.",
\t\t\t"count.lifecycle": "Running {running} · Resumable {resumable}",
\t\t\t"count.historyOnly": "History {history}",`)

const AGENT_LOOP_STREAM_ORIGINAL = String(`\t\t\t\tconst stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);
\t\t\t\tsignal.throwIfAborted();
\t\t\t\tfor await (const chunk of stream) {
\t\t\t\t\tsignal.throwIfAborted();
\t\t\t\t\tchunkSeqs.push(this.session.append("assistant/chunk", {
\t\t\t\t\t\tturn,
\t\t\t\t\t\tstep,
\t\t\t\t\t\tchunk
\t\t\t\t\t}).seq);
\t\t\t\t\tassembler.push(chunk);
\t\t\t\t}
\t\t\t\tsignal.throwIfAborted();`)
const AGENT_LOOP_STREAM_PATCHED = String(`\t\t\t\tconst stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request);
\t\t\t\tconst iterator = stream[Symbol.asyncIterator]();
\t\t\t\ttry {
\t\t\t\t\twhile (true) {
\t\t\t\t\t\tconst next = await new Promise((resolve, reject) => {
\t\t\t\t\t\t\tconst onAbort = () => reject(signal.reason ?? new Error("agent request cancelled"));
\t\t\t\t\t\t\tif (signal.aborted) return onAbort();
\t\t\t\t\t\t\tsignal.addEventListener("abort", onAbort, { once: true });
\t\t\t\t\t\t\tPromise.resolve(iterator.next()).then((value) => {
\t\t\t\t\t\t\t\tsignal.removeEventListener("abort", onAbort);
\t\t\t\t\t\t\t\tresolve(value);
\t\t\t\t\t\t\t}, (error) => {
\t\t\t\t\t\t\t\tsignal.removeEventListener("abort", onAbort);
\t\t\t\t\t\t\t\treject(error);
\t\t\t\t\t\t\t});
\t\t\t\t\t\t});
\t\t\t\t\t\tif (next.done) break;
\t\t\t\t\t\tconst chunk = next.value;
\t\t\t\t\t\tsignal.throwIfAborted();
\t\t\t\t\t\tchunkSeqs.push(this.session.append("assistant/chunk", {
\t\t\t\t\t\t\tturn,
\t\t\t\t\t\t\tstep,
\t\t\t\t\t\t\tchunk
\t\t\t\t\t\t}).seq);
\t\t\t\t\t\tassembler.push(chunk);
\t\t\t\t\t}
\t\t\t\t} finally {
\t\t\t\t\tif (signal.aborted && typeof iterator.return === "function") {
\t\t\t\t\t\ttry { void Promise.resolve(iterator.return()).catch(() => void 0); } catch {}
\t\t\t\t\t}
\t\t\t\t}
\t\t\t\tsignal.throwIfAborted();`)
const AGENT_LOOP_KICK_ORIGINAL = String(`\t\t\t\tconst { turn, wakeRequested } = this.phase;
\t\t\t\tthis.setPhase({
\t\t\t\t\tkind: "idle",
\t\t\t\t\tlastTurn: turn
\t\t\t\t});
\t\t\t\tif (wakeRequested && this.inbox.hasPending) this.wakeDriver();`)
const AGENT_LOOP_KICK_PATCHED = String(`\t\t\t\tconst { turn } = this.phase;
\t\t\t\tthis.setPhase({
\t\t\t\t\tkind: "idle",
\t\t\t\t\tlastTurn: turn
\t\t\t\t});
\t\t\t\tif (this.inbox.hasPending) this.wakeDriver();`)
const SUBAGENT_SETTLEMENT_ORIGINAL = String(`\t\t\t\tif (!settling.settling) {
\t\t\t\t\tif (activation.handle.agent.status !== "running") await poked;
\t\t\t\t\tcontinue;
\t\t\t\t}`)
const SUBAGENT_SETTLEMENT_PATCHED = String(`\t\t\t\tif (!settling.settling) {
\t\t\t\t\tconst agent = activation.handle.agent;
\t\t\t\t\tif (agent.status !== "running" && activation.accepted.size > 0 && agent.inbox.hasPending) {
\t\t\t\t\t\tagent.wakeDriver();
\t\t\t\t\t\tcontinue;
\t\t\t\t\t}
\t\t\t\t\tif (agent.status !== "running") await poked;
\t\t\t\t\tcontinue;
\t\t\t\t}`)

export function patchRuntimeSource(source) {
  if (source.includes(PATCHED)) return { source, changed: false }
  const previous = source.includes(PATCHED_V2) ? PATCHED_V2 : source.includes(PATCHED_V1) ? PATCHED_V1 : ORIGINAL
  if (!source.includes(previous)) {
    throw new Error('Pinned DSH startSession implementation changed; refusing an unsafe runtime patch.')
  }
  return { source: source.replace(previous, PATCHED), changed: true }
}

export function patchDirectoryPickerSource(source) {
  if (source.includes(DIRECTORY_PICKER_PATCHED)) return { source, changed: false }
  if (!source.includes(DIRECTORY_PICKER_ORIGINAL)) {
    throw new Error('Pinned DSH Windows directory picker implementation changed; refusing an unsafe runtime patch.')
  }
  return { source: source.replace(DIRECTORY_PICKER_ORIGINAL, DIRECTORY_PICKER_PATCHED), changed: true }
}

export function patchConversationCacheSource(source) {
  let output = source
  let changed = false
  const replacements = [
    [CONVERSATION_VIEW_OWNER_ORIGINAL, CONVERSATION_VIEW_OWNER_PATCHED, 'conversation view navigation action'],
    [CONVERSATION_USAGE_ORIGINAL, CONVERSATION_USAGE_PATCHED, 'token projection consumer'],
    [CONVERSATION_CACHE_ORIGINAL, CONVERSATION_CACHE_PATCHED, 'cache summary'],
    [CONVERSATION_TOOLTIP_ORIGINAL, CONVERSATION_TOOLTIP_PATCHED, 'cache detail tooltip'],
    [CONVERSATION_CACHE_ZH_ORIGINAL, CONVERSATION_CACHE_ZH_PATCHED, 'Chinese cache labels'],
    [CONVERSATION_CACHE_EN_ORIGINAL, CONVERSATION_CACHE_EN_PATCHED, 'English cache labels']
  ]
  for (const [original, patched, label] of replacements) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe desktop runtime patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchTokenMeterSource(source) {
  let output = source
  let changed = false
  if (!output.includes(TOKEN_USAGE_DETAIL_MARKER)) {
    if (!output.includes(TOKEN_USAGE_DETAIL_ANCHOR)) throw new Error('Pinned DSH token usage projection changed; refusing an unsafe cache-metrics patch.')
    output = output.replace(TOKEN_USAGE_DETAIL_ANCHOR, `${TOKEN_USAGE_DETAIL_PATCH}${TOKEN_USAGE_DETAIL_ANCHOR}`)
    changed = true
  }
  if (!output.includes(TOKEN_USAGE_REGISTER_PATCHED)) {
    if (!output.includes(TOKEN_USAGE_REGISTER_ORIGINAL)) throw new Error('Pinned DSH token projection registration changed; refusing an unsafe cache-metrics patch.')
    output = output.replace(TOKEN_USAGE_REGISTER_ORIGINAL, TOKEN_USAGE_REGISTER_PATCHED)
    changed = true
  }
  return { source: output, changed }
}

export function patchSubagentSource(source) {
  const compatibleUnifiedDrawer = ['@harness-desktop/subagent-drawer', 'subagentLifecycleCounts', 'filteredEntries.map', 'children: t("count.compact"']
  if (compatibleUnifiedDrawer.every(marker => source.includes(marker))) return { source, changed: false }
  let output = source
  let changed = false
  const replacements = [
    [SUBAGENT_CATALOG_ROWS_ORIGINAL, SUBAGENT_CATALOG_ROWS_PATCHED, 'catalog lifecycle filter'],
    [SUBAGENT_CATALOG_MAP_ORIGINAL, SUBAGENT_CATALOG_MAP_PATCHED, 'filtered catalog rows'],
    [SUBAGENT_ACTIVITY_ORIGINAL, SUBAGENT_ACTIVITY_PATCHED, 'lifecycle activity labels'],
    [SUBAGENT_RECURSIVE_PROPS_ORIGINAL, SUBAGENT_RECURSIVE_PROPS_PATCHED, 'nested lifecycle filter'],
    [SUBAGENT_FILTER_STATE_ORIGINAL, SUBAGENT_FILTER_STATE_PATCHED, 'lifecycle filter state'],
    [SUBAGENT_COUNTS_ORIGINAL, SUBAGENT_COUNTS_PATCHED, 'lifecycle descendant counts'],
    [SUBAGENT_TRIGGER_POPUP_ORIGINAL, SUBAGENT_TRIGGER_POPUP_PATCHED, 'lifecycle popup semantics'],
    [SUBAGENT_TRIGGER_ARIA_ORIGINAL, SUBAGENT_TRIGGER_ARIA_PATCHED, 'lifecycle trigger label'],
    [SUBAGENT_TRIGGER_COUNT_ORIGINAL, SUBAGENT_TRIGGER_COUNT_PATCHED, 'lifecycle trigger summary', [SUBAGENT_TRIGGER_COUNT_COMPAT]],
    [SUBAGENT_MENU_ORIGINAL, SUBAGENT_MENU_PATCHED, 'lifecycle menu header'],
    [SUBAGENT_ROOT_FILTER_PROPS_ORIGINAL, SUBAGENT_ROOT_FILTER_PROPS_PATCHED, 'root lifecycle filter'],
    [SUBAGENT_ZH_ACTIVITY_ORIGINAL, SUBAGENT_ZH_ACTIVITY_PATCHED, 'Chinese lifecycle labels'],
    [SUBAGENT_EN_ACTIVITY_ORIGINAL, SUBAGENT_EN_ACTIVITY_PATCHED, 'English lifecycle labels']
  ]
  if (!output.includes(SUBAGENT_LIFECYCLE_HELPERS_MARKER)) {
    if (!output.includes(SUBAGENT_LIFECYCLE_HELPERS_ANCHOR)) throw new Error('Pinned DSH subagent catalog helpers changed; refusing an unsafe lifecycle patch.')
    output = output.replace(SUBAGENT_LIFECYCLE_HELPERS_ANCHOR, `${SUBAGENT_LIFECYCLE_HELPERS_PATCH}${SUBAGENT_LIFECYCLE_HELPERS_ANCHOR}`)
    changed = true
  }
  if (!output.includes(SUBAGENT_STYLE_MARKER)) {
    if (!output.includes(SUBAGENT_STYLE_ANCHOR)) throw new Error('Pinned DSH subagent catalog styles changed; refusing an unsafe lifecycle patch.')
    output = output.replace(SUBAGENT_STYLE_ANCHOR, `${SUBAGENT_STYLE_PATCH}${SUBAGENT_STYLE_ANCHOR}`)
    changed = true
  }
  for (const [original, patched, label, compatible = []] of replacements) {
    if (output.includes(patched) || compatible.some(marker => output.includes(marker))) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe desktop lifecycle patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchAgentLoopCancellationSource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of [
    [AGENT_LOOP_STREAM_ORIGINAL, AGENT_LOOP_STREAM_PATCHED, 'streaming implementation'],
    [AGENT_LOOP_KICK_ORIGINAL, AGENT_LOOP_KICK_PATCHED, 'queued-turn recovery implementation']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH agent-loop ${label} changed; refusing an unsafe cancellation patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchSubagentContinuationSource(source) {
  if (source.includes(SUBAGENT_SETTLEMENT_PATCHED)) return { source, changed: false }
  if (!source.includes(SUBAGENT_SETTLEMENT_ORIGINAL)) {
    throw new Error('Pinned DSH subagent settlement implementation changed; refusing an unsafe continuation recovery patch.')
  }
  return { source: source.replace(SUBAGENT_SETTLEMENT_ORIGINAL, SUBAGENT_SETTLEMENT_PATCHED), changed: true }
}

export async function patchInstalledRuntime(file = runtimeClient) {
  const source = await readFile(file, 'utf8')
  const patched = patchRuntimeSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledDirectoryPicker(file = directoryPickerRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchDirectoryPickerSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledConversation(file = conversationRuntime) {
  const source = await readFile(file, 'utf8')
  const cache = patchConversationCacheSource(source)
  if (cache.changed) await writeFile(file, cache.source, 'utf8')
  return cache.changed
}

export async function patchInstalledTokenMeter(file = tokenMeterRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchTokenMeterSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledSubagent(file = subagentRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchSubagentSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledAgentLoop(file = agentLoopRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchAgentLoopCancellationSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledSubagentContinuation(file = subagentContinuationRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchSubagentContinuationSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sessionChanged = await patchInstalledRuntime()
  const pickerChanged = await patchInstalledDirectoryPicker()
  const conversationChanged = await patchInstalledConversation()
  const tokenMeterChanged = await patchInstalledTokenMeter()
  const subagentChanged = await patchInstalledSubagent()
  const agentLoopChanged = await patchInstalledAgentLoop()
  const subagentContinuationChanged = await patchInstalledSubagentContinuation()
  process.stdout.write(sessionChanged ? 'Patched desktop New Session behavior.\n' : 'Desktop New Session patch already applied.\n')
  process.stdout.write(pickerChanged ? 'Patched stable Windows directory picker.\n' : 'Stable Windows directory picker patch already applied.\n')
  process.stdout.write(conversationChanged ? 'Patched conversation telemetry and view navigation.\n' : 'Conversation telemetry and view navigation already patched.\n')
  process.stdout.write(tokenMeterChanged ? 'Patched cache telemetry detail projection.\n' : 'Cache telemetry detail projection already applied.\n')
  process.stdout.write(subagentChanged ? 'Patched subagent lifecycle and history views.\n' : 'Subagent lifecycle and history views already applied.\n')
  process.stdout.write(agentLoopChanged ? 'Patched abortable streams and queued-turn recovery.\n' : 'Abortable streams and queued-turn recovery already patched.\n')
  process.stdout.write(subagentContinuationChanged ? 'Patched continuable subagent idle-inbox recovery.\n' : 'Continuable subagent idle-inbox recovery already patched.\n')
}
