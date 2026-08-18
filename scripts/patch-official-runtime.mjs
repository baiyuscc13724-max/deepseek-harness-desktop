import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeClient = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js')
const directoryPickerRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js')
const markdownRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-primitives', 'lib', 'index.js')
const conversationRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
const tokenMeterRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-token-meter', 'lib', 'index.js')

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

const MARKDOWN_SANITIZE_ORIGINAL = dedentOne(`	function sanitizeUrl(url) {
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

const MARKDOWN_INLINE_ORIGINAL = dedentOne(`	function inlineCodeHttpUrl(value) {
		if (value.trim() !== value) return void 0;
		try {
			const protocol = new URL(value).protocol;
			return protocol === "http:" || protocol === "https:" ? value : void 0;
		} catch {
			return;
		}
	}`)

const MARKDOWN_INLINE_PATCHED = dedentOne(`	function inlineCodeHttpUrl(value) {
		if (value.trim() !== value) return void 0;
		const local = desktopLocalHref(value);
		if (local !== void 0) return local;
		try {
			const protocol = new URL(value).protocol;
			return protocol === "http:" || protocol === "https:" ? value : void 0;
		} catch {
			return;
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

const CONVERSATION_ATTACHMENT_COPY_REPLACEMENTS = [
  ['"image.dropTitle": "图片拖动到此处即可添加",', '"image.dropTitle": "文档或图片拖动到此处即可添加",', 'Chinese attachment drop title'],
  ['"image.dropDesc": "最多 {count} 张，每张 {size}",', '"image.dropDesc": "原生图片最多 {count} 张，每张 {size}；其他文件按本地附件添加",', 'Chinese attachment drop description'],
  ['"image.dropBlocked": "当前无法添加图片",', '"image.dropBlocked": "当前无法添加附件",', 'Chinese blocked attachment copy'],
  ['"image.dropTitle": "Drag images here to add them",', '"image.dropTitle": "Drag documents or images here to add them",', 'English attachment drop title'],
  ['"image.dropDesc": "Up to {count} images, {size} each",', '"image.dropDesc": "Up to {count} native images, {size} each; other files are added as local attachments",', 'English attachment drop description'],
  ['"image.dropBlocked": "Images cannot be added right now",', '"image.dropBlocked": "Attachments cannot be added right now",', 'English blocked attachment copy']
]

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
const CONVERSATION_CACHE_EN_PATCHED = `			"stats.cacheHit": "Cumulative cache read {percent}%",
			"stats.cacheLast": "Latest cache read {percent}%",
			"stats.cacheWarm": "Warm-request cache read {percent}%",
			"stats.cachePrefixReuse": "Prefix reuse about {percent}%",
			"stats.cacheCumulative": "Cumulative cache read {percent}% (includes cold start)",
			"stats.cacheUnreported": "Cache: not reported by provider",`

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

export function patchMarkdownSource(source) {
  let output = source
  let changed = false
  if (!output.includes(MARKDOWN_SANITIZE_PATCHED)) {
    if (!output.includes(MARKDOWN_SANITIZE_ORIGINAL)) throw new Error('Pinned DSH Markdown URL policy changed; refusing an unsafe desktop-link patch.')
    output = output.replace(MARKDOWN_SANITIZE_ORIGINAL, MARKDOWN_SANITIZE_PATCHED)
    changed = true
  }
  if (!output.includes(MARKDOWN_INLINE_PATCHED)) {
    if (!output.includes(MARKDOWN_INLINE_ORIGINAL)) throw new Error('Pinned DSH inline-code renderer changed; refusing an unsafe desktop-link patch.')
    output = output.replace(MARKDOWN_INLINE_ORIGINAL, MARKDOWN_INLINE_PATCHED)
    changed = true
  }
  return { source: output, changed }
}

export function patchConversationSource(source) {
  if (source.includes(CONVERSATION_MENTIONS_PATCHED)) return { source, changed: false }
  if (!source.includes(CONVERSATION_MENTIONS_ORIGINAL)) throw new Error('Pinned DSH chat file-mention provider changed; refusing an unsafe workspace-link patch.')
  return { source: source.replace(CONVERSATION_MENTIONS_ORIGINAL, CONVERSATION_MENTIONS_PATCHED), changed: true }
}

export function patchConversationAttachmentCopySource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of CONVERSATION_ATTACHMENT_COPY_REPLACEMENTS) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe attachment-copy patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchConversationCacheSource(source) {
  let output = source
  let changed = false
  const replacements = [
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

export async function patchInstalledMarkdownRenderer(file = markdownRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchMarkdownSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledConversation(file = conversationRuntime) {
  const source = await readFile(file, 'utf8')
  const links = patchConversationSource(source)
  const attachmentCopy = patchConversationAttachmentCopySource(links.source)
  const cache = patchConversationCacheSource(attachmentCopy.source)
  if (links.changed || attachmentCopy.changed || cache.changed) await writeFile(file, cache.source, 'utf8')
  return links.changed || attachmentCopy.changed || cache.changed
}

export async function patchInstalledTokenMeter(file = tokenMeterRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchTokenMeterSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sessionChanged = await patchInstalledRuntime()
  const pickerChanged = await patchInstalledDirectoryPicker()
  const markdownChanged = await patchInstalledMarkdownRenderer()
  const conversationChanged = await patchInstalledConversation()
  const tokenMeterChanged = await patchInstalledTokenMeter()
  process.stdout.write(sessionChanged ? 'Patched desktop New Session behavior.\n' : 'Desktop New Session patch already applied.\n')
  process.stdout.write(pickerChanged ? 'Patched stable Windows directory picker.\n' : 'Stable Windows directory picker patch already applied.\n')
  process.stdout.write(markdownChanged ? 'Patched clickable desktop workspace links.\n' : 'Desktop workspace-link patch already applied.\n')
  process.stdout.write(conversationChanged ? 'Patched workspace-relative chat links.\n' : 'Workspace-relative chat-link patch already applied.\n')
  process.stdout.write(tokenMeterChanged ? 'Patched cache telemetry detail projection.\n' : 'Cache telemetry detail projection already applied.\n')
}
