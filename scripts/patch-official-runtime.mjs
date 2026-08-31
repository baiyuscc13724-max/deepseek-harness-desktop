import { access, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { patchAssistantCopySource } from './assistant-copy-patch.mjs'
import { patchAttachmentInputConversationSource, patchAttachmentInputSource } from './attachment-input-patch.mjs'
import { createChatStopFollowState, reduceChatStopFollowState } from './chat-stop-follow.mjs'
import { patchReasoningEffortSliderSource } from './reasoning-effort-slider-patch.mjs'
import { patchWorkspaceSessionMenuSource } from './workspace-session-menu-patch.mjs'
import { patchCodexParityRuntime } from './codex-parity-runtime-patch.mjs'
import { patchAlpha2ToolResultImageSource, patchToolResultImageSource, patchToolResultOwnerSource } from './tool-result-image-patch.mjs'
import { patchRecoverableToolErrorSource } from './tool-recoverable-error-patch.mjs'
import { patchConversationWorkTreeSource } from './conversation-work-tree-patch.mjs'
import { patchSessionPersistenceListingSource } from './session-persistence-performance-patch.mjs'
import { patchHostSessionListingSource } from './session-list-metadata-performance-patch.mjs'
import { patchTimelineReferenceActionSource } from './timeline-reference-patch.mjs'
import { patchModelSettingsKeyOverrideSource } from './model-settings-key-override-patch.mjs'
import { patchModelSettingsCredentialValidationSource } from './model-settings-credential-validation-patch.mjs'
import { patchDeepSeekModelDiscoverySource } from './deepseek-model-discovery-patch.mjs'

export { patchAssistantCopySource } from './assistant-copy-patch.mjs'
export { patchAttachmentInputConversationSource, patchAttachmentInputSource } from './attachment-input-patch.mjs'
export { patchConversationWorkTreeSource } from './conversation-work-tree-patch.mjs'
export { patchSessionPersistenceListingSource } from './session-persistence-performance-patch.mjs'
export { patchHostSessionListingSource } from './session-list-metadata-performance-patch.mjs'
export { patchTimelineReferenceActionSource } from './timeline-reference-patch.mjs'
export { patchToolResultImageSource, patchToolResultOwnerSource } from './tool-result-image-patch.mjs'
export { patchRecoverableToolErrorSource } from './tool-recoverable-error-patch.mjs'
export { createChatStopFollowState, reduceChatStopFollowState } from './chat-stop-follow.mjs'
export { patchReasoningEffortSliderSource } from './reasoning-effort-slider-patch.mjs'
export { patchModelSettingsKeyOverrideSource } from './model-settings-key-override-patch.mjs'
export { patchModelSettingsCredentialValidationSource } from './model-settings-credential-validation-patch.mjs'
export { patchDeepSeekModelDiscoverySource } from './deepseek-model-discovery-patch.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeClient = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js')
const directoryPickerRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js')
const conversationRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
const attachmentUiRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-attachment', 'lib', 'client.js')
const toolUiRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-tool', 'lib', 'client.js')
const tokenMeterRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-token-meter', 'lib', 'index.js')
const subagentRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-subagent', 'lib', 'client.js')
const sandboxRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox', 'lib', 'index.js')
const pwshLocalRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-pwsh-local', 'lib', 'index.js')
const toolPwshRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tool-pwsh', 'lib', 'index.js')
const pwshSandboxRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-pwsh-sandbox', 'lib', 'index.js')
const bashSandboxRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-bash-sandbox', 'lib', 'index.js')
const windowsAclRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'types-CNjZgO4h.js')
const modelSelectionRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-model-selection', 'lib', 'client.js')
const modelSettingsRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-models', 'lib', 'client.js')
const deepSeekLlmRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js')
const workspaceUiRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
const sessionControllerClientRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'client.js')
const sessionControllerHostRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js')
const sessionPersistenceRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js')
const hostApiProxyRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
const agentLoopRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js')
const subagentContinuationRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-subagent', 'lib', 'index.js')
const fsSearchRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tool-fs-search', 'lib', 'index.js')
const toolFsRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-tool-fs', 'lib', 'index.js')
const subprocessRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-subprocess-local', 'lib', 'index.js')
const webAppRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'lib', 'index.js')
const attachmentProfileRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml')

function dedentOne(source) {
  return source.split('\n').map(line => line.slice(1)).join('\n')
}

function bundleFunctionSource(fn) {
  return fn.toString().split('\n').map(line => `\t\t${line}`).join('\n')
}

const CONVERSATION_STOP_FOLLOW_HELPERS_ANCHOR = '\t\t/** Active column host when present; otherwise the view-local scroller. */'
const CONVERSATION_STOP_FOLLOW_HELPERS_MARKERS = [
  'function createChatStopFollowState(',
  'function reduceChatStopFollowState('
]
const CONVERSATION_STOP_FOLLOW_HELPERS_PATCH = `${bundleFunctionSource(createChatStopFollowState)}\n${bundleFunctionSource(reduceChatStopFollowState)}\n`

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

const ALPHA2_WORKSPACE_START_SESSION_ORIGINAL = dedentOne(`				startSession(workspaceId) {
					const workspace = this.workspaces.list.getSnapshot();
					const sessions = this.sessions.list.getSnapshot();
					const current = sessions.current;
					const currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current))?.workspaceId;
					const recent = workspace.phase === "ready" && sessions.phase === "ready" ? recentWorkspace(workspace.items, sessions.byId) : void 0;
					const target = workspaceId ?? currentWorkspaceId ?? recent;
					if (target === void 0) {
						this.sessions.clear();
						return;
					}
					this.connectWorkspace(target).then((sessionId) => {
						this.sessions.open(sessionId);
					}, (reason) => {
						console.warn("new session failed:", reason);
					});
				}`)

const ALPHA2_WORKSPACE_START_SESSION_PATCHED = dedentOne(`				startSession(workspaceId) {
					const workspace = this.workspaces.list.getSnapshot();
					const sessions = this.sessions.list.getSnapshot();
					const current = sessions.current;
					const currentSummary = current === void 0 ? void 0 : sessions.byId[current];
					const currentWorkspaceId = current === void 0 ? void 0 : workspace.items.find((item) => item.sessionIds.includes(current) || currentSummary?.cwd !== void 0 && item.path === currentSummary.cwd)?.workspaceId;
					const hintedWorkspaceId = current !== void 0 && this.sessionWorkspaceHint?.sessionId === current ? this.sessionWorkspaceHint.workspaceId : void 0;
					const recent = workspace.phase === "ready" && sessions.phase === "ready" ? recentWorkspace(workspace.items, sessions.byId) : void 0;
					const target = workspaceId ?? currentWorkspaceId ?? this.pendingSessionWorkspaceTarget ?? hintedWorkspaceId ?? recent;
					const generation = (this.sessionStartGeneration ?? 0) + 1;
					this.sessionStartGeneration = generation;
					if (target === void 0) {
						this.pendingSessionWorkspaceTarget = void 0;
						this.pendingSessionOriginalSession = void 0;
						this.sessions.clear();
						return;
					}
					if (current !== void 0 && this.pendingSessionOriginalSession === void 0) this.pendingSessionOriginalSession = current;
					this.pendingSessionWorkspaceTarget = target;
					this.sessions.clear();
					this.sessions.create({ workspaceId: target }).then((sessionId) => {
						if (generation !== this.sessionStartGeneration) return;
						this.sessionWorkspaceHint = { sessionId, workspaceId: target };
						this.pendingSessionWorkspaceTarget = void 0;
						this.pendingSessionOriginalSession = void 0;
						this.sessions.open(sessionId);
					}, (reason) => {
						if (generation !== this.sessionStartGeneration) return;
						const previous = this.pendingSessionOriginalSession;
						this.pendingSessionWorkspaceTarget = void 0;
						this.pendingSessionOriginalSession = void 0;
						if (previous !== void 0) this.sessions.open(previous);
						console.warn("new session failed:", reason);
					});
				}`)

const SESSION_PROJECTION_SUBSCRIPTION_ORIGINAL = dedentOne(`\t\t\t\t\t\tstore = new ProjectionValueStore();
\t\t\t\t\t\tstore.subscribeAny(() => {
\t\t\t\t\t\t\tthis.notifier.markDirty();
\t\t\t\t\t\t});`)
const SESSION_PROJECTION_SUBSCRIPTION_PATCHED = dedentOne(`\t\t\t\t\t\tstore = new ProjectionValueStore();
\t\t\t\t\t\t// The global list only projects title and subagent lifecycle metadata.
\t\t\t\t\t\t// High-frequency per-session telemetry stays on its keyed face instead of
\t\t\t\t\t\t// invalidating every root sidebar and hidden session-list consumer.
\t\t\t\t\t\tfor (const key of ["title", "subagent"]) store.faceOf(key).subscribe(() => {
\t\t\t\t\t\t\tthis.notifier.markDirty();
\t\t\t\t\t\t});`)

const SESSION_PROJECTION_FRAME_ORIGINAL = dedentOne(`\t\t\t\t\tif (frame.type === "session/projection") {
\t\t\t\t\t\tthis.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq);
\t\t\t\t\t\tthis.notifier.markDirty();
\t\t\t\t\t\treturn;
\t\t\t\t\t}`)
const SESSION_PROJECTION_FRAME_PATCHED_V1 = dedentOne(`\t\t\t\t\tif (frame.type === "session/projection") {
\t\t\t\t\t\tthis.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq);
\t\t\t\t\t\t// Token totals are list-facing only while a catalog is visibly consuming them.
\t\t\t\t\t\tif (frame.key === "tokenUsage" && this.openCatalogs.size > 0) this.notifier.markDirty();
\t\t\t\t\t\treturn;
\t\t\t\t\t}`)
const SESSION_PROJECTION_FRAME_PATCHED = dedentOne(`\t\t\t\t\tif (frame.type === "session/projection") {
\t\t\t\t\t\tthis.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq);
\t\t\t\t\t\t// Catalog metrics are list-facing only while a catalog is visibly consuming them.
\t\t\t\t\t\tif ((frame.key === "tokenUsage" || frame.key === "subagentTiming") && this.openCatalogs.size > 0) this.notifier.markDirty();
\t\t\t\t\t\treturn;
\t\t\t\t\t}`)

const ALPHA2_SESSION_PROJECTION_FRAME_ORIGINAL = dedentOne(`					if (frame.type === "projection") {
						this.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq);
						this.notifier.markDirty();
						return;
					}`)
const ALPHA2_SESSION_PROJECTION_FRAME_PATCHED = dedentOne(`					if (frame.type === "projection") {
						this.projectionStore(frame.sessionId).apply(frame.key, frame.value, frame.seq);
						// Catalog metrics are list-facing only while a catalog is visibly consuming them.
						if ((frame.key === "tokenUsage" || frame.key === "subagentTiming") && this.openCatalogs.size > 0) this.notifier.markDirty();
						return;
					}`)

const SESSION_ENTRY_CACHE_ORIGINAL = '\t\t\t\tfor (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);'
const SESSION_ENTRY_CACHE_PATCHED = dedentOne(`\t\t\t\tconst retainedEntryIds = new Set(items.map((entry) => entry.sessionId));
\t\t\t\tfor (const id of this.entryCache.keys()) if (!retainedEntryIds.has(id)) this.entryCache.delete(id);`)

const NOTIFIER_FRAME_SCHEDULE_ORIGINAL = 'if (kind === "frame") globalThis.requestAnimationFrame(publish);'
const NOTIFIER_FRAME_SCHEDULE_PATCHED = 'if (kind === "frame") globalThis.setTimeout(publish, 50);'

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

const SUBPROCESS_TERMINAL_TASKKILL_ORIGINAL = String(`function taskkillTree(pid, force) {
	if (pid <= 0) return;
	spawnSync("taskkill", [
		"/PID",
		String(pid),
		"/T",
		...force ? ["/F"] : []
	], { stdio: "ignore" });
}`)
const SUBPROCESS_TERMINAL_TASKKILL_PATCHED = String(`function taskkillTree(pid, force) {
	if (pid <= 0) return;
	spawnSync("taskkill", [
		"/PID",
		String(pid),
		"/T",
		...force ? ["/F"] : []
	], { stdio: "ignore", windowsHide: true });
}`)
const SUBPROCESS_COMMAND_TASKKILL_ORIGINAL = String(`function taskkillProcessTree(pid) {
	if (pid <= 0) return;
	spawnSync("taskkill", [
		"/PID",
		String(pid),
		"/T",
		"/F"
	], { stdio: "ignore" });
}`)
const SUBPROCESS_COMMAND_TASKKILL_PATCHED = String(`function taskkillProcessTree(pid) {
	if (pid <= 0) return;
	spawnSync("taskkill", [
		"/PID",
		String(pid),
		"/T",
		"/F"
	], { stdio: "ignore", windowsHide: true });
}`)
const SUBPROCESS_COMMAND_SPAWN_ORIGINAL = String(`	const child = spawn(program, args, {
		cwd: spec.cwd,
		env,
		stdio: [
			stdinMode === "ignore" ? "ignore" : "pipe",
			outMode === "inherit" ? "inherit" : "pipe",
			errMode === "inherit" ? "inherit" : "pipe"
		],
		detached: platform !== "win32"
	});`)
const SUBPROCESS_COMMAND_SPAWN_PATCHED = String(`	const child = spawn(program, args, {
		cwd: spec.cwd,
		env,
		windowsHide: true,
		stdio: [
			stdinMode === "ignore" ? "ignore" : "pipe",
			outMode === "inherit" ? "inherit" : "pipe",
			errMode === "inherit" ? "inherit" : "pipe"
		],
		detached: platform !== "win32"
	});`)
const WEB_APP_BROWSER_LAUNCH_ORIGINAL = String(`function spawnBrowserLauncher(url) {
	return spawn(process.execPath, [
		"--input-type=module",
		"--eval",
		BROWSER_OPENER_PROGRAM,
		"--",
		url
	], {
		env: scrubbedParentEnv(),
		stdio: [
			"ignore",
			"inherit",
			"pipe"
		]
	});
}`)
const WEB_APP_BROWSER_LAUNCH_PATCHED = String(`function spawnBrowserLauncher(url) {
	return spawn(process.execPath, [
		"--input-type=module",
		"--eval",
		BROWSER_OPENER_PROGRAM,
		"--",
		url
	], {
		env: scrubbedParentEnv(),
		windowsHide: true,
		stdio: [
			"ignore",
			"inherit",
			"pipe"
		]
	});
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

const ATTACHMENT_PROFILE_ORIGINAL = `    - id: attachment-local
      name: '@deepseek-ai/dsh-attachment-local'`
const ATTACHMENT_PROFILE_PATCHED = `    - id: attachment-local
      name: '@deepseek-ai/dsh-attachment-local'
      config:
        # Do not reject or resize ordinary screenshots merely because one side
        # exceeds an arbitrary UI-oriented dimension. The decoded-pixel and
        # encoded-byte budgets remain authoritative resource-safety boundaries.
        maxImagePixels: 64000000
        maxImageDimension: 2147483647
        normalizedImageMaxDimension: 2147483647
        normalizedImageMaxBytes: 20971520`

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
const TOKEN_USAGE_DETAIL_COMPLETE_MARKERS = [
  TOKEN_USAGE_DETAIL_MARKER,
  'const tokenUsageDetailProjectionDefinition = {',
  'activeRouteKey: null',
  'previousPromptTokens:',
  'lastCacheReadReported:'
]
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

const TOKEN_USAGE_DETAIL_STATE_SCHEMA_PATCH = dedentOne(`	const tokenUsageDetailRouteSchema = z$1.object({
		sampleCount: z$1.number().int().nonnegative(),
		promptTokens: z$1.number().int().nonnegative(),
		warmTotals: projectionSchema,
		cacheTelemetryObserved: z$1.boolean()
	}).strict();
	const tokenUsageDetailStateSchema = z$1.object({
		totals: projectionSchema,
		last: z$1.object({
			turn: z$1.number().int().nonnegative(),
			step: z$1.number().int().nonnegative(),
			routeKey: z$1.string(),
			buckets: projectionSchema,
			isWarm: z$1.boolean(),
			previousPromptTokens: z$1.number().int().nonnegative(),
			cacheReadReported: z$1.boolean()
		}).strict().nullable(),
		activeRouteKey: z$1.string().nullable(),
		routes: z$1.record(z$1.string(), tokenUsageDetailRouteSchema)
	}).strict();
	`)
const TOKEN_USAGE_DETAIL_PATCH_STATE_WIRE = TOKEN_USAGE_DETAIL_PATCH
  .replace('const tokenUsageDetailProjectionDefinition = {', `${TOKEN_USAGE_DETAIL_STATE_SCHEMA_PATCH}const tokenUsageDetailProjectionDefinition = {`)
  .replace('\tschema: tokenUsageDetailSchema,', '\tstateVersion: 1,\n\tstateSchema: tokenUsageDetailStateSchema,')
  .replace('\tview: (state) => {', '\twire: {\n\t\tviewSchema: tokenUsageDetailSchema,\n\t\tview: (state) => {')
  .replace('\t},\n\tstateVersion: 1\n};', '\t\t}\n\t}\n};')

const TOKEN_USAGE_REGISTER_ORIGINAL = 'projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition);\n\t\t\tprojectionCtx.sessionProjections.register(contextPressureProjectionDefinition);'
const TOKEN_USAGE_REGISTER_PATCHED = 'projectionCtx.sessionProjections.register(tokenUsageProjectionDefinition);\n\t\t\tprojectionCtx.sessionProjections.register(tokenUsageDetailProjectionDefinition);\n\t\t\tprojectionCtx.sessionProjections.register(contextPressureProjectionDefinition);'
const TOKEN_USAGE_REGISTER_ALPHA2_ORIGINAL = 'ctx.sessionProjections.register(tokenUsageProjectionDefinition);\n\t\tctx.sessionProjections.register(contextPressureProjectionDefinition);\n\t\tctx.sessionProjections.register(contextBreakdownProjectionDefinition);'
const TOKEN_USAGE_REGISTER_ALPHA2_PATCHED = 'ctx.sessionProjections.register(tokenUsageProjectionDefinition);\n\t\tctx.sessionProjections.register(tokenUsageDetailProjectionDefinition);\n\t\tctx.sessionProjections.register(contextPressureProjectionDefinition);\n\t\tctx.sessionProjections.register(contextBreakdownProjectionDefinition);'

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

const CONVERSATION_CACHE_ALPHA2_ORIGINAL = CONVERSATION_CACHE_ORIGINAL
  .replace('formatTokens(billedInputTokens(usage))', 'formatTokens(billedInputTokens(usage), t)')
  .replace('formatTokens(usage.outputTokens)', 'formatTokens(usage.outputTokens, t)')
const CONVERSATION_CACHE_ALPHA2_PATCHED = CONVERSATION_CACHE_PATCHED
  .replace('formatTokens(billedInputTokens(usage))', 'formatTokens(billedInputTokens(usage), t)')
  .replace('formatTokens(usage.outputTokens)', 'formatTokens(usage.outputTokens, t)')
const CONVERSATION_TOOLTIP_ORIGINAL = 'label: line,\n\t\t\t\tside: "top",\n\t\t\t\tdelayMs: 500,\n\t\t\t\tdisabled: !truncated,'
const CONVERSATION_TOOLTIP_PATCHED = 'label: tooltipLine,\n\t\t\t\tside: "top",\n\t\t\t\tdelayMs: 500,\n\t\t\t\tdisabled: !truncated && tooltipLine === line,'
const CONVERSATION_STATS_CSS_ORIGINAL = 'const css$20 = ".FJxK0a_root{text-align:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;margin:0 auto;font-size:12px;line-height:20px;display:block;overflow:hidden}.FJxK0a_sep{color:var(--dsw-alias-separator-primary);margin:0 10px}";'
const CONVERSATION_STATS_CSS_PATCHED_V1 = 'const css$20 = ".FJxK0a_root{text-align:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;max-height:40px;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-secondary);margin:0 auto;font-size:12px;line-height:20px;display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:0 18px;overflow:hidden;user-select:text;cursor:text}.FJxK0a_root>span{min-width:0;max-width:100%;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}";'
const CONVERSATION_STATS_CSS_PATCHED = 'const css$20 = ".FJxK0a_root{text-align:center;max-width:var(--dsh-chat-content-width);box-sizing:border-box;width:100%;max-height:44px;padding:4px calc(var(--dsh-composer-side-clearance) + 16px) 0;color:var(--dsw-alias-label-secondary);margin:0 auto;font-size:12px;line-height:20px;display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:0 18px;overflow:hidden;user-select:text;cursor:text}.FJxK0a_root>span{min-width:0;max-width:100%;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}";'
const CONVERSATION_STATS_RENDER_ORIGINAL = dedentOne(`\t\t\t\tconst rootRef = (0, react.useRef)(null);
\t\t\t\tconst [truncated, setTruncated] = (0, react.useState)(false);
\t\t\t\t(0, react.useLayoutEffect)(() => {
\t\t\t\t\tconst el = rootRef.current;
\t\t\t\t\tif (el === null) return;
\t\t\t\t\tconst measure = () => {
\t\t\t\t\t\tsetTruncated(el.scrollWidth > el.clientWidth);
\t\t\t\t\t};
\t\t\t\t\tmeasure();
\t\t\t\t\tif (typeof ResizeObserver === "undefined") return;
\t\t\t\t\tconst observer = new ResizeObserver(measure);
\t\t\t\t\tobserver.observe(el);
\t\t\t\t\treturn () => {
\t\t\t\t\t\tobserver.disconnect();
\t\t\t\t\t};
\t\t\t\t}, [line]);
\t\t\t\tif (groups.length === 0) return null;
\t\t\t\treturn (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
\t\t\t\t\tlabel: tooltipLine,
\t\t\t\t\tside: "top",
\t\t\t\t\tdelayMs: 500,
\t\t\t\t\tdisabled: !truncated && tooltipLine === line,
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\tref: rootRef,
\t\t\t\t\t\tclassName: StatsLine_module_css_default.root,
\t\t\t\t\t\tchildren: groups.map((group, i) => (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [i > 0 && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\t\tclassName: StatsLine_module_css_default.sep,
\t\t\t\t\t\t\t"aria-hidden": true,
\t\t\t\t\t\t\tchildren: "|"
\t\t\t\t\t\t}), " "] }), (0, react_jsx_runtime.jsx)("span", { children: group })] }, group))
\t\t\t\t\t})
\t\t\t\t});`)
const CONVERSATION_STATS_RENDER_PATCHED = dedentOne(`\t\t\t\tif (groups.length === 0) return null;
\t\t\t\treturn (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\tclassName: StatsLine_module_css_default.root,
\t\t\t\t\ttitle: tooltipLine,
\t\t\t\t\t"aria-label": tooltipLine,
\t\t\t\t\tchildren: groups.map((group) => (0, react_jsx_runtime.jsx)("span", { children: group }, group))
\t\t\t\t});`)
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
const CONVERSATION_QUEUE_ORIGINAL = 'const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued"), [inbox]);'
const CONVERSATION_QUEUE_PATCHED = 'const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued" && !String(row.text ?? row.preview ?? "").startsWith("[Agent team message ")), [inbox]);'
const CONVERSATION_CACHE_EN_PATCHED = `			"stats.cacheHit": "Cumulative cache read {percent}%",
			"stats.cacheLast": "Latest cache read {percent}%",
			"stats.cacheWarm": "Warm-request cache read {percent}%",
			"stats.cachePrefixReuse": "Prefix reuse about {percent}%",
			"stats.cacheCumulative": "Cumulative cache read {percent}% (includes cold start)",
			"stats.cacheUnreported": "Cache: not reported by provider",`

const CONVERSATION_TIMELINE_ORIGINAL = 'const timeline = useSession((s) => s.chat.timeline);'
const CONVERSATION_TIMELINE_PATCHED = 'const runningTurnStart = useSession((s) => runningTurnStartTime(s.chat.timeline));'
const CONVERSATION_RUNNING_TURN_ORIGINAL = 'const runningTurnStart = (0, react.useMemo)(() => runningTurnStartTime(timeline), [timeline]);'
const CONVERSATION_RUNNING_TURN_PATCHED = '// runningTurnStart is a scalar selector so timeline identity churn does not re-render ChatView.'
const CONVERSATION_SETTLE_FOLLOW_REF_ORIGINAL = 'const atBottomRef = (0, react.useRef)(true);\n\t\t\tconst [atBottom, setAtBottom] = (0, react.useState)(true);'
const CONVERSATION_SETTLE_FOLLOW_REF_PATCHED_V1 = `${CONVERSATION_SETTLE_FOLLOW_REF_ORIGINAL}
\t\t\tconst previousRunningRef = (0, react.useRef)(running);`
const CONVERSATION_SETTLE_FOLLOW_REF_PATCHED = `${CONVERSATION_SETTLE_FOLLOW_REF_ORIGINAL}
\t\t\tconst stopFollowRef = (0, react.useRef)(createChatStopFollowState(running, atBottomRef.current));`
const CONVERSATION_SETTLE_FOLLOW_EFFECT_ORIGINAL = 'const el = scrollerOf(local);\n\t\t\t\tif (openState === "open" && !openedRef.current) {'
const CONVERSATION_SETTLE_FOLLOW_EFFECT_PATCHED_V1 = `const el = scrollerOf(local);
\t\t\t\t// Preserve the pre-commit follow intent while stopping removes transient rows.
\t\t\t\tconst settledWhileFollowing = previousRunningRef.current && !running && atBottomRef.current;
\t\t\t\tpreviousRunningRef.current = running;
\t\t\t\tif (openState === "open" && !openedRef.current) {`
const CONVERSATION_SETTLE_FOLLOW_EFFECT_PATCHED = `const el = scrollerOf(local);
\t\t\t\t// Keep the pre-stop reader intent across every delayed settlement commit.
\t\t\t\tstopFollowRef.current = reduceChatStopFollowState(stopFollowRef.current, {
\t\t\t\t\ttype: "render",
\t\t\t\t\trunning,
\t\t\t\t\tfollowing: atBottomRef.current
\t\t\t\t});
\t\t\t\tconst settledWhileFollowing = stopFollowRef.current.settling;
\t\t\t\tif (openState === "open" && !openedRef.current) {`
const CONVERSATION_SETTLE_FOLLOW_CONDITION_ORIGINAL = 'if (appendedUser || appendedSteering || tipMoved && atBottomRef.current) toBottom(el);'
const CONVERSATION_SETTLE_FOLLOW_CONDITION_PATCHED = 'if (appendedUser || appendedSteering || settledWhileFollowing || tipMoved && atBottomRef.current) toBottom(el);'
const CONVERSATION_SETTLE_FOLLOW_TO_BOTTOM_ORIGINAL = `const toBottom = (el) => {
\t\t\t\tanchorRef.current = null;`
const CONVERSATION_SETTLE_FOLLOW_TO_BOTTOM_PATCHED = `const toBottom = (el) => {
\t\t\t\tstopFollowRef.current = reduceChatStopFollowState(stopFollowRef.current, { type: "pin" });
\t\t\t\tanchorRef.current = null;`
const CONVERSATION_SETTLE_FOLLOW_SCROLL_ORIGINAL = `const isAtBottom = movedByReader ? floor - el.scrollTop <= 25 : atBottomRef.current;
\t\t\t\tif (!movedByReader && isAtBottom) {`
const CONVERSATION_SETTLE_FOLLOW_SCROLL_PATCHED = `const isAtBottom = movedByReader ? floor - el.scrollTop <= 25 : atBottomRef.current;
\t\t\t\tstopFollowRef.current = reduceChatStopFollowState(stopFollowRef.current, { type: "reader", moved: movedByReader, following: isAtBottom });
\t\t\t\tif (!movedByReader && isAtBottom) {`
const CONVERSATION_SETTLE_FOLLOW_RESIZE_ORIGINAL = `if (local !== null && atBottomRef.current) {
\t\t\t\t\tconst el = scrollerOf(local);
\t\t\t\t\tel.scrollTop = el.scrollHeight;
\t\t\t\t\tobservedTopRef.current = el.scrollTop;
\t\t\t\t\tchatScroll.save(null);
\t\t\t\t}`
const CONVERSATION_SETTLE_FOLLOW_RESIZE_PATCHED = `if (local !== null && (atBottomRef.current || stopFollowRef.current.settling)) {
\t\t\t\t\ttoBottom(scrollerOf(local));
\t\t\t\t}`
const CONVERSATION_ROOT_SLOT_MEMO_ORIGINAL = 'const composerBlock = useComposerBlock((block) => block);'
const CONVERSATION_ROOT_SLOT_MEMO_PATCHED = `${CONVERSATION_ROOT_SLOT_MEMO_ORIGINAL}
			const sessionHeader = (0, react.useMemo)(() => renderSlot("conversation.session.header", {}), [renderSlot]);
			const sessionView = (0, react.useMemo)(() => renderSlot("conversation.session", {}), [renderSlot]);`
const CONVERSATION_ROOT_HEADER_ORIGINAL = 'children: [renderSlot("conversation.session.header", {}), (0, react_jsx_runtime.jsxs)("div", {'
const CONVERSATION_ROOT_HEADER_PATCHED = 'children: [sessionHeader, (0, react_jsx_runtime.jsxs)("div", {'
const CONVERSATION_ROOT_VIEW_ORIGINAL = 'children: [renderSlot("conversation.session", {}), composerSeat]'
const CONVERSATION_ROOT_VIEW_PATCHED = 'children: [sessionView, composerSeat]'
const CONVERSATION_ACTIVE_VIEW_ATTRIBUTE_ORIGINAL = 'className: ConversationRoot_module_css_default.viewArea,\n\t\t\t\tchildren: active !== void 0 && renderSlot("conversation.view", {'
const CONVERSATION_ACTIVE_VIEW_ATTRIBUTE_PATCHED = 'className: ConversationRoot_module_css_default.viewArea,\n\t\t\t\t"data-conversation-view": active?.id,\n\t\t\t\tchildren: active !== void 0 && renderSlot("conversation.view", {'
const CONVERSATION_SECONDARY_VIEW_STATE_ORIGINAL = 'const hideChrome = useSession((s) => s.blank) && composerPhase === "blank";'
const CONVERSATION_SECONDARY_VIEW_STATE_PATCHED = `const hideChrome = useSession((s) => s.blank) && composerPhase === "blank";
			const secondaryViewIds = /* @__PURE__ */ new Set(["desktop-schedules", "session-archive"]);
			const primaryTabs = tabs.filter((view) => !secondaryViewIds.has(view.id));
			const secondaryTabs = tabs.filter((view) => secondaryViewIds.has(view.id));
			const [secondaryOpen, setSecondaryOpen] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				if (!secondaryOpen) return;
				const closeOnEscape = (event) => { if (event.key === "Escape") setSecondaryOpen(false); };
				document.addEventListener("keydown", closeOnEscape, true);
				return () => document.removeEventListener("keydown", closeOnEscape, true);
			}, [secondaryOpen]);
			(0, react.useEffect)(() => { setSecondaryOpen(false); }, [sessionId, active?.id]);`
const CONVERSATION_SECONDARY_VIEW_TABS_ORIGINAL = `tabs.length > 1 && (0, react_jsx_runtime.jsx)("div", {
					className: ConversationRoot_module_css_default.tabs,
					role: "tablist",
					children: tabs.map((viewTab) => (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						"aria-selected": viewTab.id === active?.id,
						className: clsx(ConversationRoot_module_css_default.tab, viewTab.id === active?.id && ConversationRoot_module_css_default.tabActive),
						onClick: () => {
							actions.setView(viewTab.id);
						},
						children: viewTab.label
					}, viewTab.id))
				})`
const CONVERSATION_SECONDARY_VIEW_TABS_PATCHED = `tabs.length > 1 && (0, react_jsx_runtime.jsxs)("div", {
					className: ConversationRoot_module_css_default.tabs,
					role: "tablist",
					children: [primaryTabs.map((viewTab) => (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						"aria-selected": viewTab.id === active?.id,
						className: clsx(ConversationRoot_module_css_default.tab, viewTab.id === active?.id && ConversationRoot_module_css_default.tabActive),
						onClick: () => {
							setSecondaryOpen(false);
							actions.setView(viewTab.id);
						},
						children: viewTab.label
					}, viewTab.id)), secondaryTabs.length > 0 && (0, react_jsx_runtime.jsxs)("div", { className: "hd-conversation-more", children: [(0, react_jsx_runtime.jsx)("button", {
						type: "button",
						role: "tab",
						className: clsx(ConversationRoot_module_css_default.tab, secondaryTabs.some((view) => view.id === active?.id) && ConversationRoot_module_css_default.tabActive),
						"aria-label": (document.documentElement.lang || navigator.language || "").toLowerCase().startsWith("zh") ? "更多视图" : "More views",
						"aria-haspopup": "menu",
						"aria-expanded": secondaryOpen,
						onClick: () => setSecondaryOpen((value) => !value),
						children: "•••"
					}), secondaryOpen && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [(0, react_jsx_runtime.jsx)("button", { type: "button", tabIndex: -1, className: "hd-conversation-more-dismiss", "aria-label": "Close", onClick: () => setSecondaryOpen(false) }), (0, react_jsx_runtime.jsx)("div", { className: "hd-conversation-more-panel", role: "menu", children: secondaryTabs.map((viewTab) => (0, react_jsx_runtime.jsx)("button", { type: "button", role: "menuitem", className: "hd-conversation-more-action", "aria-current": viewTab.id === active?.id ? "page" : void 0, onClick: () => { setSecondaryOpen(false); actions.setView(viewTab.id); }, children: viewTab.label }, viewTab.id)) })] })] })]
				})`
const CONVERSATION_NON_CHAT_COMPOSER_CSS_ORIGINAL = '\t\t\ttag.textContent = css$6;'
const CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED_V1 = '\t\t\ttag.textContent = css$6 + "[data-conversation-scroll]:has([data-conversation-view]:not([data-conversation-view=\\\"chat\\\"]))>[data-composer-seat]{display:none}";'
const CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED_V2 = '\t\t\ttag.textContent = css$6 + "[data-conversation-scroll]:has([data-conversation-view]:not([data-conversation-view=\\\"chat\\\"]))>[data-composer-seat]{display:none}[data-phase]:has(>[data-conversation-scroll] [data-conversation-view=\\\"desktop-files\\\"]){position:relative}[data-phase]:has(>[data-conversation-scroll] [data-conversation-view=\\\"desktop-files\\\"])::after{content:\'\';position:absolute;z-index:20;left:0;right:0;bottom:0;height:34px;pointer-events:none;background:linear-gradient(180deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 94%,transparent) 88%);backdrop-filter:blur(2px)}";'
const CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED = '\t\t\ttag.textContent = css$6 + "[data-conversation-scroll]:has([data-conversation-view]:not([data-conversation-view=\\\"chat\\\"]))>[data-composer-seat]{display:none}[data-phase]:has(>[data-conversation-scroll] [data-conversation-view=\\\"desktop-files\\\"]){position:relative}[data-phase]:has(>[data-conversation-scroll] [data-conversation-view=\\\"desktop-files\\\"])::after{content:\'\';position:absolute;z-index:20;left:0;right:0;bottom:0;height:34px;pointer-events:none;background:linear-gradient(180deg,transparent 0%,color-mix(in srgb,var(--dsw-alias-bg-base) 94%,transparent) 88%);backdrop-filter:blur(2px)}.hd-conversation-more{position:relative;display:flex}.hd-conversation-more-dismiss{position:fixed;z-index:2147482400;inset:0;width:100vw;height:100vh;border:0;padding:0;background:transparent;cursor:default}.hd-conversation-more-panel{position:absolute;z-index:2147482500;top:calc(100% + 7px);left:-8px;box-sizing:border-box;width:190px;padding:6px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 96%,var(--dsw-alias-label-primary) 4%);box-shadow:0 14px 40px rgba(0,0,0,.2);backdrop-filter:blur(20px)}.hd-conversation-more-action{display:block;width:100%;min-height:34px;border:0;border-radius:7px;padding:6px 10px;color:var(--dsw-alias-label-primary);background:transparent;font:inherit;font-size:13px;text-align:left;cursor:pointer}.hd-conversation-more-action:hover,.hd-conversation-more-action:focus-visible{outline:0;background:var(--dsw-alias-interactive-bg-hover)}.hd-conversation-more-action[aria-current=page]{font-weight:600}";'

const SUBAGENT_LIFECYCLE_HELPERS_ANCHOR = '\t\t/** Render one catalog level and recurse only through explicitly expanded rows. */'
const SUBAGENT_LIFECYCLE_HELPERS_MARKER = 'function subagentLifecycleBucket(entry) {'
const SUBAGENT_LIFECYCLE_SORT_MARKER = 'function sortSubagentCatalogEntries(entries, summaries) {'
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
const SUBAGENT_LIFECYCLE_SORT_PATCH = String(`\t\tfunction subagentBranchLifecycleBucket(entry, summaries) {
\t\t\tconst ownBucket = subagentLifecycleBucket(entry);
\t\t\tif (ownBucket === "running" || entry.kind !== "child") return ownBucket;
\t\t\tfor (const summary of Object.values(summaries)) {
\t\t\t\tif (summary.origin === "subagent" && summary.running && belongsToSubagentTree(summary, entry.id, summaries)) return "running";
\t\t\t}
\t\t\treturn ownBucket;
\t\t}
\t\tfunction subagentReliableTime(entry, summaries) {
\t\t\tconst updatedAt = summaries[entry.id]?.updatedAt;
\t\t\treturn Number.isFinite(updatedAt) ? updatedAt : void 0;
\t\t}
\t\tfunction sortSubagentCatalogEntries(entries, summaries) {
\t\t\tconst priority = { running: 0, resumable: 1, history: 2 };
\t\t\treturn entries.map((entry, index) => ({
\t\t\t\tentry,
\t\t\t\tindex,
\t\t\t\tbucket: subagentBranchLifecycleBucket(entry, summaries),
\t\t\t\ttime: subagentReliableTime(entry, summaries)
\t\t\t})).sort((left, right) => {
\t\t\t\tconst lifecycleOrder = priority[left.bucket] - priority[right.bucket];
\t\t\t\tif (lifecycleOrder !== 0) return lifecycleOrder;
\t\t\t\tconst leftTimed = left.time !== void 0;
\t\t\t\tconst rightTimed = right.time !== void 0;
\t\t\t\tif (leftTimed !== rightTimed) return leftTimed ? -1 : 1;
\t\t\t\tif (leftTimed && left.time !== right.time) return right.time - left.time;
\t\t\t\treturn left.index - right.index;
\t\t\t}).map(({ entry }) => entry);
\t\t}
\t`)

const SUBAGENT_CATALOG_ROWS_ORIGINAL = String(`\t\tfunction CatalogRows({ parentSessionId, catalog, catalogs, summaries, expanded, level, now, openChild, refresh, toggleBranch, closeCatalog, t }) {
\t\t\tconst emptyLoading = catalog.state === "loading" && catalog.entries.length === 0;
\t\t\tconst reserveDisclosure = catalog.entries.some((entry) => entry.kind === "child" && entry.hasChildren);`)
const SUBAGENT_CATALOG_ROWS_LEGACY = String(`\t\tfunction CatalogRows({ parentSessionId, catalog, catalogs, summaries, expanded, level, now, openChild, refresh, toggleBranch, closeCatalog, filter, t }) {
\t\t\tconst emptyLoading = catalog.state === "loading" && catalog.entries.length === 0;
\t\t\tconst filteredEntries = catalog.entries.filter((entry) => subagentBranchMatches(entry, filter, summaries));
\t\t\tconst reserveDisclosure = filteredEntries.some((entry) => entry.kind === "child" && entry.hasChildren);`)
const SUBAGENT_CATALOG_ROWS_PATCHED = String(`\t\tfunction CatalogRows({ parentSessionId, catalog, catalogs, summaries, expanded, level, now, openChild, refresh, toggleBranch, closeCatalog, filter, t }) {
\t\t\tconst emptyLoading = catalog.state === "loading" && catalog.entries.length === 0;
\t\t\tconst filteredEntries = sortSubagentCatalogEntries(catalog.entries.filter((entry) => subagentBranchMatches(entry, filter, summaries)), summaries);
\t\t\tconst reserveDisclosure = filteredEntries.some((entry) => entry.kind === "child" && entry.hasChildren);`)
const SUBAGENT_CATALOG_MAP_ORIGINAL = '\t\t\t\tcatalog.entries.map((entry) => {'
const SUBAGENT_CATALOG_MAP_PATCHED = '\t\t\t\tfilteredEntries.map((entry) => {'
const SUBAGENT_ACTIVITY_ORIGINAL = 'const activity = entry.activity === "running" ? t("activity.running") : t("activity.inactive");'
const SUBAGENT_ACTIVITY_PATCHED = 'const activity = entry.activity === "running" ? t("activity.running") : entry.mode === "continuable" ? t("activity.resumable") : t("activity.history");'
const SUBAGENT_RECURSIVE_PROPS_ORIGINAL = '\t\t\t\t\t\t\t\tcloseCatalog,\n\t\t\t\t\t\t\t\tt'
const SUBAGENT_RECURSIVE_PROPS_PATCHED = '\t\t\t\t\t\t\t\tcloseCatalog,\n\t\t\t\t\t\t\t\tfilter,\n\t\t\t\t\t\t\t\tt'
const SUBAGENT_FILTER_STATE_ORIGINAL = '\t\t\tconst [expanded, setExpanded] = (0, react.useState)(() => /* @__PURE__ */ new Set());'
const SUBAGENT_FILTER_STATE_PATCHED = `${SUBAGENT_FILTER_STATE_ORIGINAL}\n\t\t\tconst [lifecycleFilter, setLifecycleFilter] = (0, react.useState)("active");`
const SUBAGENT_DIALOG_REF_ORIGINAL = '\t\t\tconst triggerRef = (0, react.useRef)(null);'
const SUBAGENT_DIALOG_REF_PATCHED = `${SUBAGENT_DIALOG_REF_ORIGINAL}\n\t\t\tconst dialogRef = (0, react.useRef)(null);`
const SUBAGENT_CHANGE_OPEN_ORIGINAL = String(`\t\t\tconst changeOpen = (next, restoreFocus = false) => {
\t\t\t\tsetOpen(next);
\t\t\t\tif (next) {
\t\t\t\t\tsetNow(Date.now());
\t\t\t\t\tobserveCatalog(sessionId, true);
\t\t\t\t} else closeAllCatalogs();
\t\t\t\tif (restoreFocus) queueMicrotask(() => {
\t\t\t\t\ttriggerRef.current?.focus();
\t\t\t\t});
\t\t\t};`)
const SUBAGENT_CHANGE_OPEN_PATCHED = String(`\t\t\tconst changeOpen = (next, restoreFocus = false) => {
\t\t\t\tsetOpen(next);
\t\t\t\tif (next) {
\t\t\t\t\tsetNow(Date.now());
\t\t\t\t\tobserveCatalog(sessionId, true);
\t\t\t\t\tqueueMicrotask(() => {
\t\t\t\t\t\tdialogRef.current?.focus();
\t\t\t\t\t});
\t\t\t\t} else closeAllCatalogs();
\t\t\t\tif (!next && restoreFocus) queueMicrotask(() => {
\t\t\t\t\ttriggerRef.current?.focus();
\t\t\t\t});
\t\t\t};`)
const SUBAGENT_EXTERNAL_OPEN_EFFECT_ANCHOR = '\t\t\tconst closeBranch = (root) => {'
const SUBAGENT_EXTERNAL_OPEN_EFFECT_MARKER = 'harness-desktop:open-subagent-catalog'
const SUBAGENT_EXTERNAL_OPEN_EFFECT_PATCH = String(`\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (typeof window === "undefined") return;
\t\t\t\tconst openRequestedCatalog = (event) => {
\t\t\t\t\tif (event?.detail?.parentSessionId !== sessionId) return;
\t\t\t\t\tchangeOpen(true);
\t\t\t\t};
\t\t\t\twindow.addEventListener("harness-desktop:open-subagent-catalog", openRequestedCatalog);
\t\t\t\treturn () => {
\t\t\t\t\twindow.removeEventListener("harness-desktop:open-subagent-catalog", openRequestedCatalog);
\t\t\t\t};
\t\t\t}, [sessionId]);
`)
const SUBAGENT_COUNTS_ORIGINAL = String(`\t\t\tconst descendantCount = Math.max(healthy.length, descendants.count);
\t\t\tconst totalCountKey = descendantCount === 1 ? "count.total.one" : "count.total.other";
\t\t\tconst runningCountKey = descendants.runningCount === 1 ? "count.running.one" : "count.running.other";`)
const SUBAGENT_COUNTS_LEGACY = String(`\t\t\tconst descendantCount = Math.max(healthy.length, descendants.count);
\t\t\tconst totalCountKey = descendantCount === 1 ? "count.total.one" : "count.total.other";
\t\t\tconst lifecycle = (0, react.useMemo)(() => subagentLifecycleCounts(summaries, sessionId, descendantCount), [summaries, sessionId, descendantCount]);
\t\t\tconst currentCount = lifecycle.running + lifecycle.resumable;
\t\t\tconst effectiveLifecycleFilter = lifecycleFilter === "active" && currentCount === 0 ? "history" : lifecycleFilter;`)
const SUBAGENT_COUNTS_PATCHED = String(`\t\t\tconst descendantCount = Math.max(healthy.length, descendants.count);
\t\t\tconst totalCountKey = descendantCount === 1 ? "count.total.one" : "count.total.other";
\t\t\tconst lifecycle = (0, react.useMemo)(() => subagentLifecycleCounts(summaries, sessionId, descendantCount), [summaries, sessionId, descendantCount]);
\t\t\tconst currentCount = lifecycle.running + lifecycle.resumable;
\t\t\tconst effectiveLifecycleFilter = lifecycleFilter;`)
const SUBAGENT_FILTER_DISABLED_LEGACY = 'disabled: value === "active" ? currentCount === 0 : value === "history" ? lifecycle.history === 0 : descendantCount === 0,'
const SUBAGENT_FILTER_DISABLED_PATCHED = 'disabled: value === "history" ? lifecycle.history === 0 : value === "all" ? descendantCount === 0 : false,'
const SUBAGENT_TRIGGER_ARIA_ORIGINAL = `"aria-label": t(descendants.runningCount > 0 ? runningCountKey : totalCountKey, { count: descendants.runningCount > 0 ? descendants.runningCount : descendantCount }),`
const SUBAGENT_TRIGGER_ARIA_PATCHED = `"aria-label": t(currentCount > 0 ? "count.lifecycle" : "count.historyOnly", { running: lifecycle.running, resumable: lifecycle.resumable, history: lifecycle.history }),`
const SUBAGENT_TRIGGER_POPUP_ORIGINAL = '"aria-haspopup": "tree",'
const SUBAGENT_TRIGGER_POPUP_PATCHED = '"aria-haspopup": "dialog",'
const SUBAGENT_TRIGGER_COUNT_ORIGINAL = 'children: t(totalCountKey, { count: descendantCount })'
const SUBAGENT_TRIGGER_COUNT_LEGACY = 'children: t(currentCount > 0 ? "count.lifecycle" : "count.historyOnly", { running: lifecycle.running, resumable: lifecycle.resumable, history: lifecycle.history })'
const SUBAGENT_TRIGGER_COUNT_PATCHED = 'children: t("count.compact", { count: descendantCount })'
const SUBAGENT_DIALOG_ACCESS_LEGACY = '\t\t\t\t\t\tclassName: SubagentCatalogAction_module_css_default.menu,\n\t\t\t\t\t\trole: "dialog",\n\t\t\t\t\t\t"aria-modal": true,\n\t\t\t\t\t\t"aria-label": t("tree.aria"),'
const SUBAGENT_DIALOG_ACCESS_PATCHED = '\t\t\t\t\t\tclassName: SubagentCatalogAction_module_css_default.menu,\n\t\t\t\t\t\tref: dialogRef,\n\t\t\t\t\t\ttabIndex: -1,\n\t\t\t\t\t\trole: "dialog",\n\t\t\t\t\t\t"aria-label": t("tree.aria"),'
const SUBAGENT_MENU_ORIGINAL = String(`\t\t\t\t}), open && (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\tclassName: SubagentCatalogAction_module_css_default.menu,
\t\t\t\t\trole: "tree",
\t\t\t\t\t"aria-label": t("tree.aria"),
\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(CatalogRows, {`)
const SUBAGENT_MENU_LEGACY = String(`\t\t\t\t}), open && (0, react_jsx_runtime.jsxs)("div", {
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
const SUBAGENT_MENU_PATCHED = String(`\t\t\t\t}), open && (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, {
\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\ttabIndex: -1,
\t\t\t\t\t\tclassName: "hd-subagent-drawer-backdrop",
\t\t\t\t\t\t"aria-label": t("drawer.close"),
\t\t\t\t\t\tonClick: () => changeOpen(false, true)
\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\tclassName: SubagentCatalogAction_module_css_default.menu,
\t\t\t\t\t\tref: dialogRef,
\t\t\t\t\t\ttabIndex: -1,
\t\t\t\t\t\trole: "dialog",
\t\t\t\t\t\t"aria-label": t("tree.aria"),
\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle",
\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\tclassName: "hd-subagent-drawer-heading",
\t\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("strong", {
\t\t\t\t\t\t\t\t\tclassName: "hd-subagent-drawer-title",
\t\t\t\t\t\t\t\t\tchildren: t("drawer.title")
\t\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\t\t\t\tclassName: "hd-subagent-drawer-close",
\t\t\t\t\t\t\t\t\t"aria-label": t("drawer.close"),
\t\t\t\t\t\t\t\t\tonClick: (event) => {
\t\t\t\t\t\t\t\t\t\tevent.preventDefault();
\t\t\t\t\t\t\t\t\t\tevent.stopPropagation();
\t\t\t\t\t\t\t\t\t\tchangeOpen(false, true);
\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\tchildren: "×"
\t\t\t\t\t\t\t\t})]
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)("div", {
\t\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle-status",
\t\t\t\t\t\t\t\trole: "status",
\t\t\t\t\t\t\t\tchildren: [
\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: "hd-subagent-status-running", children: t("status.running", { count: lifecycle.running }) }),
\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { children: t("status.resumable", { count: lifecycle.resumable }) }),
\t\t\t\t\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { children: t("status.history", { count: lifecycle.history }) })
\t\t\t\t\t\t\t\t]
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle-tabs",
\t\t\t\t\t\t\t\trole: "tablist",
\t\t\t\t\t\t\t\t"aria-label": t("filter.aria"),
\t\t\t\t\t\t\t\tchildren: [["active", t("filter.active", { count: currentCount })], ["history", t("filter.history", { count: lifecycle.history })], ["all", t("filter.all", { count: descendantCount })]].map(([value, label]) => (0, react_jsx_runtime.jsx)("button", {
\t\t\t\t\t\t\t\t\ttype: "button",
\t\t\t\t\t\t\t\t\trole: "tab",
\t\t\t\t\t\t\t\t\t"aria-selected": effectiveLifecycleFilter === value,
\t\t\t\t\t\t\t\t\tdisabled: value === "history" ? lifecycle.history === 0 : value === "all" ? descendantCount === 0 : false,
\t\t\t\t\t\t\t\t\tclassName: effectiveLifecycleFilter === value ? "hd-subagent-lifecycle-tab hd-subagent-lifecycle-tab-active" : "hd-subagent-lifecycle-tab",
\t\t\t\t\t\t\t\t\tonClick: (event) => {
\t\t\t\t\t\t\t\t\t\tevent.preventDefault();
\t\t\t\t\t\t\t\t\t\tevent.stopPropagation();
\t\t\t\t\t\t\t\t\t\tsetLifecycleFilter(value);
\t\t\t\t\t\t\t\t\t},
\t\t\t\t\t\t\t\t\tchildren: label
\t\t\t\t\t\t\t\t}, value))
\t\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("p", {
\t\t\t\t\t\t\t\tclassName: "hd-subagent-lifecycle-note",
\t\t\t\t\t\t\t\tchildren: t("lifecycle.note")
\t\t\t\t\t\t\t})]
\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\t\t\trole: "tree",
\t\t\t\t\t\t\t"aria-label": t("tree.aria"),
\t\t\t\t\t\t\tchildren: (0, react_jsx_runtime.jsx)(CatalogRows, {`)
const SUBAGENT_ROOT_FILTER_PROPS_ORIGINAL = '\t\t\t\t\t\tcloseCatalog: () => {\n\t\t\t\t\t\t\tchangeOpen(false);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tt\n\t\t\t\t\t})\n\t\t\t\t})]'
const SUBAGENT_ROOT_FILTER_PROPS_LEGACY = '\t\t\t\t\t\tcloseCatalog: () => {\n\t\t\t\t\t\t\tchangeOpen(false);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tfilter: effectiveLifecycleFilter,\n\t\t\t\t\t\tt\n\t\t\t\t\t})\n\t\t\t\t\t})]\n\t\t\t\t})]'
const SUBAGENT_ROOT_FILTER_PROPS_PATCHED = '\t\t\t\t\t\t\tcloseCatalog: () => {\n\t\t\t\t\t\t\t\tchangeOpen(false);\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tfilter: effectiveLifecycleFilter,\n\t\t\t\t\t\t\tt\n\t\t\t\t\t\t})\n\t\t\t\t\t\t})]\n\t\t\t\t\t})]\n\t\t\t\t})]'
const SUBAGENT_STYLE_ANCHOR = '\t\tconst tagId$1 = "@deepseek-ai/dsh-client-ui-subagent/SubagentCatalogAction.module.css";'
const SUBAGENT_STYLE_LEGACY_MARKER = 'dataPluginCss = "@harness-desktop/subagent-lifecycle"'
const SUBAGENT_STYLE_MARKER = 'dataPluginCss = "@harness-desktop/subagent-drawer"'
const SUBAGENT_STYLE_LEGACY_PATCH = String(`\t\tconst lifecycleCss = ".h8S2Va_menu{width:560px!important;max-width:min(680px,100vw - 32px)!important}.hd-subagent-lifecycle{position:sticky;z-index:2;top:-4px;background:var(--dsw-specific-menu);border-bottom:1px solid var(--dsw-alias-border-l2);padding:10px 10px 9px}.hd-subagent-lifecycle-status{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;gap:6px 12px;font-size:12px;line-height:18px;display:flex}.hd-subagent-status-running{color:var(--dsw-alias-state-success-primary,#22a06b)}.hd-subagent-lifecycle-tabs{background:var(--dsw-alias-bg-layer-2);border-radius:8px;gap:3px;margin-top:8px;padding:3px;display:flex}.hd-subagent-lifecycle-tab{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:0;border-radius:6px;flex:1;padding:5px 8px;font-size:12px}.hd-subagent-lifecycle-tab:hover{color:var(--dsw-alias-label-primary)}.hd-subagent-lifecycle-tab:disabled{cursor:not-allowed;opacity:.45}.hd-subagent-lifecycle-tab-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.hd-subagent-lifecycle-note{color:var(--dsw-alias-label-tertiary);margin:7px 2px 0;font-size:11px;line-height:16px}";
\t\tconst dataPluginCss = "@harness-desktop/subagent-lifecycle";
\t\tif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(dataPluginCss) + "]") === null) {
\t\t\tconst lifecycleTag = document.createElement("style");
\t\t\tlifecycleTag.dataset.plugin = "harness-desktop";
\t\t\tlifecycleTag.dataset.pluginCss = dataPluginCss;
\t\t\tlifecycleTag.textContent = lifecycleCss;
\t\t\tdocument.head.appendChild(lifecycleTag);
\t\t}
\t`)
const SUBAGENT_STYLE_PATCH = String(`\t\tconst lifecycleCss = ".h8S2Va_menu{z-index:1001!important;box-sizing:border-box!important;inset:0 0 0 auto!important;width:min(440px,calc(100vw - 40px))!important;max-width:none!important;max-height:none!important;height:100dvh!important;border-radius:16px 0 0 16px!important;padding:0!important;position:fixed!important;overflow:auto!important;animation:hd-subagent-drawer-in .18s ease-out}.hd-subagent-drawer-backdrop{z-index:1000;cursor:default;background:color-mix(in srgb,#000 32%,transparent);border:0;padding:0;position:fixed;inset:0}.hd-subagent-lifecycle{position:sticky;z-index:2;top:0;background:var(--dsw-specific-menu);border-bottom:1px solid var(--dsw-alias-border-l2);padding:12px 14px 10px}.hd-subagent-drawer-heading{align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;display:flex}.hd-subagent-drawer-title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}.hd-subagent-drawer-close{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:0;border-radius:7px;padding:0;font-size:22px;line-height:24px}.hd-subagent-drawer-close:hover,.hd-subagent-drawer-close:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hd-subagent-lifecycle-status{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;gap:6px 12px;font-size:12px;line-height:18px;display:flex}.hd-subagent-status-running{color:var(--dsw-alias-state-success-primary,#22a06b)}.hd-subagent-lifecycle-tabs{background:var(--dsw-alias-bg-layer-2);border-radius:8px;gap:3px;margin-top:8px;padding:3px;display:flex}.hd-subagent-lifecycle-tab{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:transparent;border:0;border-radius:6px;flex:1;padding:5px 8px;font-size:12px}.hd-subagent-lifecycle-tab:hover{color:var(--dsw-alias-label-primary)}.hd-subagent-lifecycle-tab:disabled{cursor:not-allowed;opacity:.45}.hd-subagent-lifecycle-tab-active{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);font-weight:600}.hd-subagent-lifecycle-note{color:var(--dsw-alias-label-tertiary);margin:7px 2px 0;font-size:11px;line-height:16px}@keyframes hd-subagent-drawer-in{from{transform:translateX(24px);opacity:.75}to{transform:translateX(0);opacity:1}}@media(max-width:900px){.h8S2Va_menu{width:min(440px,calc(100vw - 16px))!important}}@media(max-width:620px){.h8S2Va_menu{width:100vw!important;border-radius:0!important}}@media(prefers-reduced-motion:reduce){.h8S2Va_menu{animation:none}}";
\t\tconst dataPluginCss = "@harness-desktop/subagent-drawer";
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
const SUBAGENT_ZH_DRAWER_ORIGINAL = '\t\t\t"count.historyOnly": "历史 {history}",'
const SUBAGENT_ZH_DRAWER_PATCHED = `${SUBAGENT_ZH_DRAWER_ORIGINAL}\n\t\t\t"count.compact": "子代理 {count}",\n\t\t\t"drawer.title": "子代理会话",\n\t\t\t"drawer.close": "关闭子代理目录",`
const SUBAGENT_EN_DRAWER_ORIGINAL = '\t\t\t"count.historyOnly": "History {history}",'
const SUBAGENT_EN_DRAWER_PATCHED = `${SUBAGENT_EN_DRAWER_ORIGINAL}\n\t\t\t"count.compact": "Subagents {count}",\n\t\t\t"drawer.title": "Subagent sessions",\n\t\t\t"drawer.close": "Close subagent catalog",`

const SEARCH_CLASSIFY_EXIT2_ORIGINAL = String(`function classifyRunFailure(toolName, exitCode, stderrText, stderrTruncated) {
\tconst stderr = stderrExcerpt(stderrText, stderrTruncated);
\tif (/regex parse error|error parsing glob/i.test(stderr)) return new SearchError(\`\${toolName} pattern rejected by ripgrep: \${stderr}\`, "SEARCH_INVALID_PATTERN");
\treturn new SearchError(\`\${toolName} search failed (exit \${exitCode})\${stderr.length > 0 ? \`: \${stderr}\` : ""}\`, "SEARCH_FAILED");
}`)
const SEARCH_CLASSIFY_EXIT2_PATCHED = String(`function classifyRunFailure(toolName, exitCode, stderrText, stderrTruncated) {
\tconst stderr = stderrExcerpt(stderrText, stderrTruncated);
\tif (/regex parse error|error parsing glob/i.test(stderr)) return new SearchError(\`\${toolName} pattern rejected by ripgrep: \${stderr}\`, "SEARCH_INVALID_PATTERN");
\tif (exitCode === 2 && /no such file|permission denied|access is denied|os error|cannot find the path|unable to read|is not a directory/i.test(stderr)) return new SearchError(\`\${toolName} search failed (exit 2): \${stderr}. Do NOT repeat this same search call and do not auto-retry it: the target path is missing or unreadable, so no partial results are returned. First use glob to discover which paths actually exist under the workspace, then narrow the \${toolName} path to the existing subtree and search again.\`, "SEARCH_FAILED");
\treturn new SearchError(\`\${toolName} search failed (exit \${exitCode})\${stderr.length > 0 ? \`: \${stderr}\` : ""}\`, "SEARCH_FAILED");
}`)
const SEARCH_GREP_PROMPT_ORIGINAL = '\t\ttext: "Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context."'
const SEARCH_GREP_PROMPT_PATCHED = '\t\ttext: "Use the grep tool — not shell grep or rg — to search file contents. Use read on a matched file when you need surrounding context. A missing or unreadable target path fails closed as a search error (ripgrep exit 2): do NOT repeat the same call and do not auto-retry — first glob to discover which paths actually exist, then narrow the grep path to that existing subtree before searching again."'
const SEARCH_GREP_DESCRIPTION_ORIGINAL = '\t\tdescription: `Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. Returns the first ${caps.maxMatches} matches inline; a capped result reports where the complete match list was saved. Use read on a matched file for surrounding context.`,'
const SEARCH_GREP_DESCRIPTION_PATCHED = '\t\tdescription: `Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. Returns the first ${caps.maxMatches} matches inline; a capped result reports where the complete match list was saved. A missing or unreadable target path fails closed as a search error (ripgrep exit 2): partial results are never returned and the same call is never auto-retried — glob first to discover existing paths, then narrow the path to the existing subtree before retrying. Use read on a matched file for surrounding context.`,'

const FS_EDIT_REMEDIES_ORIGINAL = String(`const REMEDIES = {
\tFS_STALE_VERSION: "re-read the file, then retry",
\tFS_NOT_OBSERVED: "read the file, then retry"
};`)
const FS_EDIT_REMEDIES_V1 = String(`const REMEDIES = {
\tFS_STALE_VERSION: "re-read the file, then retry",
\tFS_NOT_OBSERVED: "read the file, then retry",
\tFS_EDIT_NOT_FOUND: "do not repeat the same edit call; re-read the file, copy a short exact unique old_string from the current content, then retry once"
};`)
const FS_EDIT_REMEDIES_PATCHED = String(`const REMEDIES = {
\tFS_STALE_VERSION: "re-read the exact target file, then retry",
\tFS_NOT_OBSERVED: "read the exact target file before editing it, then retry",
\tFS_EDIT_NOT_FOUND: "the edit was not applied; do not repeat or guess—read the exact target file around the intended location, copy a short current literal old_string, then retry once"
};`)
const FS_EDIT_PROMPT_ORIGINAL = '\t\ttext: "Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. If old_string appears multiple times, provide a more specific old_string or set replace_all to true. Read the file first (the default fs-observation-policy requires it), unless you just created or edited it in this session."'
const FS_EDIT_PROMPT_V1 = '\t\ttext: "Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. Build old_string only from the latest read result or the exact after text of an edit that just succeeded, and keep it short but unique. If old_string appears multiple times, provide a more specific old_string or set replace_all to true. On FS_EDIT_NOT_FOUND, never repeat the same call: re-read the file, rebuild old_string from the current content, then retry once. Read the file first (the default fs-observation-policy requires it), unless you just created or edited it in this session."'
const FS_EDIT_PROMPT_PATCHED = '\t\ttext: "Use the edit tool for targeted changes to existing UTF-8 text files. It replaces literal old_string with new_string; by default old_string must appear exactly once. Immediately before the first edit to a target file, read that exact file around the intended location and copy a short unique old_string verbatim; a read of another file, a grep/search snippet, a remembered fragment, or an inferred function shape is not a valid basis. The only exception is an old_string copied from the exact after text of an edit that just succeeded on the same file. If old_string appears multiple times, make it more specific or set replace_all true only when every match must change. On FS_EDIT_NOT_FOUND, never repeat or guess: re-read the exact target region, rebuild old_string, then retry once."'
const FS_EDIT_DESCRIPTION_ORIGINAL = '\t\tdescription: "Edit an existing UTF-8 text file by replacing literal text.",'
const FS_EDIT_DESCRIPTION_V1 = '\t\tdescription: "Edit an existing UTF-8 text file by replacing one current literal match. A missing old_string fails closed: re-read and rebuild the edit instead of repeating it.",'
const FS_EDIT_DESCRIPTION_PATCHED = '\t\tdescription: "Edit an existing UTF-8 text file by replacing one current literal match. Before the first edit to a target, copy old_string from a fresh read of that exact file; another file, search output, memory, or inference is not a valid source. A missing match is a safe no-op and requires a fresh target-file read, never fuzzy replacement.",'
const FS_EDIT_OLD_STRING_DESCRIPTION_ORIGINAL = '\t\t\t\tdescription: "Literal text to replace. Must match exactly."'
const FS_EDIT_OLD_STRING_DESCRIPTION_V1 = '\t\t\t\tdescription: "Literal text copied from the current file content. Must match exactly; keep it short but unique."'
const FS_EDIT_OLD_STRING_DESCRIPTION_PATCHED = '\t\t\t\tdescription: "Short unique literal copied verbatim from the latest read of this exact target file (or the exact after text of its immediately preceding successful edit). Must match exactly."'

const SANDBOX_APPROVAL_REQUEST_ORIGINAL = `\tconst outcome = await approval.approver.request({`
const SANDBOX_APPROVAL_REQUEST_PATCHED = `\tif (typeof approval.approver.effectivePolicy === "function" && approval.approver.effectivePolicy(approval.agent.session) === "never") throw new Error("sandbox escalation is unavailable because approval prompts are disabled in this session");
\tconst outcome = await approval.approver.request({`

const PWSH_ENCODING_ORIGINAL = 'const ENCODING_PREAMBLE = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";'
const PWSH_ENCODING_PATCHED = `${PWSH_ENCODING_ORIGINAL}\nconst CONSTRAINED_ENCODING_PREAMBLE = "if ($IsWindows -or $env:OS -eq 'Windows_NT') { chcp.com 65001 > $null }; $OutputEncoding = [System.Text.Encoding]::UTF8; ";`
const PWSH_ARGV_ORIGINAL = '`${ENCODING_PREAMBLE}${spec.command}`'
const PWSH_ARGV_PATCHED = '`${spec.sandboxPolicy?.mode === "read-only" ? CONSTRAINED_ENCODING_PREAMBLE : ENCODING_PREAMBLE}${spec.command}`'

const TOOL_PWSH_WORKDIR_ORIGINAL = `function resolveWorkdir(modelWorkdir, exec) {
\tconst headerCwd = exec.agent?.session.header.cwd;
\tif (modelWorkdir === void 0) return headerCwd;
\tif (headerCwd !== void 0 && !isAbsolute(modelWorkdir)) return resolve(headerCwd, modelWorkdir);
\treturn modelWorkdir;
}`
const TOOL_PWSH_WORKDIR_PATCHED = `function resolveWorkdir(modelWorkdir, exec, policyWorkspaceRoot) {
\tconst headerCwd = exec.agent?.session.header.cwd;
\tconst sessionCwd = policyWorkspaceRoot ?? headerCwd;
\tif (modelWorkdir === void 0) return sessionCwd;
\tif (sessionCwd !== void 0 && !isAbsolute(modelWorkdir)) return resolve(sessionCwd, modelWorkdir);
\treturn modelWorkdir;
}`
const TOOL_PWSH_WORKDIR_CALL_ORIGINAL = 'const workdir = resolveWorkdir(args.workdir, exec);'
const TOOL_PWSH_WORKDIR_CALL_PATCHED = 'const workdir = resolveWorkdir(args.workdir, exec, standingPolicy?.workspaceRoot);'

const SANDBOX_EXECUTOR_SIGNATURE_ORIGINAL = `function matchesSignature(exitCode, stderr, signatures) {
\tif (exitCode === null || exitCode === 0) return false;
\tconst lowered = stderr.toLowerCase();
\treturn signatures.some((signature) => lowered.includes(signature.toLowerCase()));
}`
const SANDBOX_EXECUTOR_SIGNATURE_PATCHED = `function matchesSignature(exitCode, stderr, signatures) {
\tif (exitCode === null || exitCode === 0) return false;
\tif (/\\b(?:spawn(?:Sync)?|connect)\\b[^\\r\\n]*\\bEPERM\\b/iu.test(stderr)) return true;
\tconst lowered = stderr.toLowerCase();
\treturn signatures.some((signature) => lowered.includes(signature.toLowerCase()));
}`

const WINDOWS_ACL_DEFAULT_DACL_ORIGINAL = '\t\t\tsetTokenDefaultDaclGrant(api, restrictedToken, this.tempWriteSidPtr ?? this.writeSidPtr ?? worldSid);'
const WINDOWS_ACL_DEFAULT_DACL_PATCHED = `\t\t\t// A token-default ACE must name a SID present in BOTH the ordinary and restricting access-check passes.
\t\t\t// The logon SID satisfies that intersection and restores cmd FOR /F/npm wrapper capture without granting a new filesystem root.
\t\t\t// Node/libuv named-pipe client endpoints remain denied and are classified explicitly by the sandbox executors.
\t\t\tsetTokenDefaultDaclGrant(api, restrictedToken, logonSid);`
const WINDOWS_ACL_DEFAULT_DACL_COMMENT_ORIGINAL = `* Merge one full-access allow ACE for \`sidPtr\` into the token's DEFAULT DACL
* — the DACL every NEW object the token holder creates (without an explicit
* security descriptor) takes. The restricted token inherits the user's
* default DACL verbatim, which names no restricting SID: a new anonymous pipe
* (child stdio) therefore fails the write pass-2 check at creation
* (ERROR_ACCESS_DENIED; Node surfaces it as spawn EPERM), breaking every
* piped-stdio grandchild spawn. The merged ACE names a RESTRICTING SID (the
* write SID under workspace-write, Everyone under read-only), so each new
* object's own DACL passes pass-2 while object creation itself stays gated by
* the parent container's DACL (files outside the granted trees remain
* uncreatable). Fails closed: any Win32 failure throws before the spawn.`
const WINDOWS_ACL_DEFAULT_DACL_COMMENT_PATCHED = `* Merge one full-access allow ACE for \`sidPtr\` into the token's DEFAULT DACL.
* The SID must participate in both access-check passes: a capability SID exists
* only in the restricting list, while the logon SID exists in the ordinary and
* restricting lists. Granting the logon SID restores Win32 anonymous-pipe and
* temporary-object consumers such as cmd FOR /F and the npm.cmd prefix probe,
* without granting any new parent filesystem root. Node/libuv piped stdio uses
* named-pipe client endpoints instead; connecting those remains EPERM under the
* WRITE_RESTRICTED token and is deliberately classified as a sandbox denial.
* Fails closed: any Win32 failure throws before the spawn.`

export function patchSessionRenderingSource(source) {
  let output = source
  let changed = false
  if (!output.includes(SESSION_PROJECTION_FRAME_PATCHED) && output.includes(SESSION_PROJECTION_FRAME_PATCHED_V1)) {
    output = output.replace(SESSION_PROJECTION_FRAME_PATCHED_V1, SESSION_PROJECTION_FRAME_PATCHED)
    changed = true
  }
  for (const [original, patched, label] of [
    [SESSION_PROJECTION_SUBSCRIPTION_ORIGINAL, SESSION_PROJECTION_SUBSCRIPTION_PATCHED, 'session projection list subscription'],
    [SESSION_PROJECTION_FRAME_ORIGINAL, SESSION_PROJECTION_FRAME_PATCHED, 'session projection frame dispatch'],
    [SESSION_ENTRY_CACHE_ORIGINAL, SESSION_ENTRY_CACHE_PATCHED, 'session entry-cache cleanup'],
    [NOTIFIER_FRAME_SCHEDULE_ORIGINAL, NOTIFIER_FRAME_SCHEDULE_PATCHED, 'stream notification frame scheduler']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe performance patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchRuntimeSource(source) {
  let output = source
  let changed = false
  if (!output.includes(PATCHED)) {
    const previous = output.includes(PATCHED_V2) ? PATCHED_V2 : output.includes(PATCHED_V1) ? PATCHED_V1 : ORIGINAL
    if (!output.includes(previous)) {
      throw new Error('Pinned DSH startSession implementation changed; refusing an unsafe runtime patch.')
    }
    output = output.replace(previous, PATCHED)
    changed = true
  }
  if (output.includes('var SessionManager = class')) {
    const performance = patchSessionRenderingSource(output)
    output = performance.source
    changed ||= performance.changed
  }
  return { source: output, changed }
}

export function patchAlpha2WorkspaceStartSessionSource(source) {
  if (source.includes(ALPHA2_WORKSPACE_START_SESSION_PATCHED)) return { source, changed: false }
  if (!source.includes(ALPHA2_WORKSPACE_START_SESSION_ORIGINAL)) {
    throw new Error('Pinned DSH alpha.2 UiWorkspaceService.startSession changed; refusing an unsafe force-new patch.')
  }
  return { source: source.replace(ALPHA2_WORKSPACE_START_SESSION_ORIGINAL, ALPHA2_WORKSPACE_START_SESSION_PATCHED), changed: true }
}

export function patchAlpha2SessionControllerSource(source) {
  const replacements = [
    [SESSION_PROJECTION_SUBSCRIPTION_ORIGINAL, SESSION_PROJECTION_SUBSCRIPTION_PATCHED, 'projection subscription'],
    [ALPHA2_SESSION_PROJECTION_FRAME_ORIGINAL, ALPHA2_SESSION_PROJECTION_FRAME_PATCHED, 'projection frame invalidation'],
    [SESSION_ENTRY_CACHE_ORIGINAL, SESSION_ENTRY_CACHE_PATCHED, 'entry-cache cleanup'],
    [NOTIFIER_FRAME_SCHEDULE_ORIGINAL, NOTIFIER_FRAME_SCHEDULE_PATCHED, 'notifier scheduler']
  ]
  const complete = replacements.every(([, patched]) => source.includes(patched))
  if (complete) return { source, changed: false }
  if (replacements.some(([, patched]) => source.includes(patched))) {
    throw new Error('Pinned DSH alpha.2 SessionManager performance markers are partial; refusing an unsafe patch.')
  }
  let output = source
  for (const [original, patched, label] of replacements) {
    if (!output.includes(original)) throw new Error(`Pinned DSH alpha.2 SessionManager ${label} changed; refusing an unsafe patch.`)
    output = output.replace(original, patched)
  }
  return { source: output, changed: true }
}

export function patchAttachmentProfileSource(source) {
  if (source.includes(ATTACHMENT_PROFILE_PATCHED)) return { source, changed: false }
  if (!source.includes(ATTACHMENT_PROFILE_ORIGINAL)) {
    throw new Error('Pinned DSH attachment-local profile changed; refusing an unsafe image-limit patch.')
  }
  return { source: source.replace(ATTACHMENT_PROFILE_ORIGINAL, ATTACHMENT_PROFILE_PATCHED), changed: true }
}

export function patchDirectoryPickerSource(source) {
  if (source.includes(DIRECTORY_PICKER_PATCHED)) return { source, changed: false }
  if (!source.includes(DIRECTORY_PICKER_ORIGINAL)) {
    throw new Error('Pinned DSH Windows directory picker implementation changed; refusing an unsafe runtime patch.')
  }
  return { source: source.replace(DIRECTORY_PICKER_ORIGINAL, DIRECTORY_PICKER_PATCHED), changed: true }
}

export function patchSubprocessSource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of [
    [SUBPROCESS_TERMINAL_TASKKILL_ORIGINAL, SUBPROCESS_TERMINAL_TASKKILL_PATCHED, 'terminal taskkill'],
    [SUBPROCESS_COMMAND_TASKKILL_ORIGINAL, SUBPROCESS_COMMAND_TASKKILL_PATCHED, 'command taskkill'],
    [SUBPROCESS_COMMAND_SPAWN_ORIGINAL, SUBPROCESS_COMMAND_SPAWN_PATCHED, 'command spawn']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH subprocess ${label} implementation changed; refusing an unsafe console-hide patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchWebAppSource(source) {
  if (source.includes(WEB_APP_BROWSER_LAUNCH_PATCHED)) return { source, changed: false }
  if (!source.includes(WEB_APP_BROWSER_LAUNCH_ORIGINAL)) {
    throw new Error('Pinned DSH browser launcher implementation changed; refusing an unsafe console-hide patch.')
  }
  return { source: source.replace(WEB_APP_BROWSER_LAUNCH_ORIGINAL, WEB_APP_BROWSER_LAUNCH_PATCHED), changed: true }
}

export function patchAlpha2ConversationSources(conversationSource, chatSource) {
  for (const [source, anchors, label] of [
    [conversationSource, ['data-conversation-scroll', 'function ConversationRoot', 'openView: actions.openView'], 'conversation shell'],
    [chatSource, ['followSigRef', 'const TurnProcessNodeView', 'useProjection("tokenUsage")'], 'chat owner']
  ]) {
    for (const anchor of anchors) if (!source.includes(anchor) && !(label === 'conversation shell' && anchor === CONVERSATION_VIEW_OWNER_ORIGINAL && source.includes(CONVERSATION_VIEW_OWNER_PATCHED))) {
      throw new Error(`Pinned DSH alpha.2 ${label} semantic anchor changed; refusing an unsafe desktop runtime patch.`)
    }
  }
  let conversation = conversationSource
  let conversationChanged = false
  for (const [original, patched, label] of [
    [CONVERSATION_QUEUE_ORIGINAL, CONVERSATION_QUEUE_PATCHED, 'internal team queue filtering']
  ]) {
    if (conversation.includes(patched)) continue
    if (!conversation.includes(original)) throw new Error(`Pinned DSH alpha.2 ${label} changed; refusing an unsafe desktop runtime patch.`)
    conversation = conversation.replace(original, patched)
    conversationChanged = true
  }
  const labels = patchAttachmentInputConversationSource(conversation)
  conversation = labels.source
  conversationChanged ||= labels.changed

  let chat = chatSource
  let chatChanged = false
  const alphaTimelineOriginal = 'const timeline = useChat((s) => s.timeline);'
  const alphaTimelinePatched = 'const runningTurnStart = useChat((s) => runningTurnStartTime(s.timeline));'
  for (const [original, patched, label] of [
    [CONVERSATION_USAGE_ORIGINAL, CONVERSATION_USAGE_PATCHED, 'token projection consumer'],
    [CONVERSATION_CACHE_ALPHA2_ORIGINAL, CONVERSATION_CACHE_ALPHA2_PATCHED, 'cache summary'],
    [CONVERSATION_TOOLTIP_ORIGINAL, CONVERSATION_TOOLTIP_PATCHED, 'cache detail tooltip'],
    [CONVERSATION_CACHE_ZH_ORIGINAL, CONVERSATION_CACHE_ZH_PATCHED, 'Chinese cache labels'],
    [CONVERSATION_CACHE_EN_ORIGINAL, CONVERSATION_CACHE_EN_PATCHED, 'English cache labels'],
    [alphaTimelineOriginal, alphaTimelinePatched, 'chat timeline selector'],
    [CONVERSATION_RUNNING_TURN_ORIGINAL, CONVERSATION_RUNNING_TURN_PATCHED, 'chat running-turn scalar']
  ]) {
    if (chat.includes(patched)) continue
    if (!chat.includes(original)) throw new Error(`Pinned DSH alpha.2 ${label} changed; refusing an unsafe desktop runtime patch.`)
    chat = chat.replace(original, patched)
    chatChanged = true
  }
  return { conversationSource: conversation, chatSource: chat, changed: conversationChanged || chatChanged }
}

export function patchConversationCacheSource(source) {
  let output = source
  let changed = false
  const stopFollowHelperCount = CONVERSATION_STOP_FOLLOW_HELPERS_MARKERS.filter(marker => output.includes(marker)).length
  if (stopFollowHelperCount > 0 && stopFollowHelperCount !== CONVERSATION_STOP_FOLLOW_HELPERS_MARKERS.length) {
    throw new Error('Pinned DSH chat stop-follow helpers are incomplete; refusing an unsafe desktop runtime patch.')
  }
  if (stopFollowHelperCount === 0) {
    if (!output.includes(CONVERSATION_STOP_FOLLOW_HELPERS_ANCHOR)) throw new Error('Pinned DSH chat scroller helper anchor changed; refusing an unsafe desktop runtime patch.')
    output = output.replace(CONVERSATION_STOP_FOLLOW_HELPERS_ANCHOR, `${CONVERSATION_STOP_FOLLOW_HELPERS_PATCH}${CONVERSATION_STOP_FOLLOW_HELPERS_ANCHOR}`)
    changed = true
  }
  for (const [previous, current] of [
    [CONVERSATION_SETTLE_FOLLOW_REF_PATCHED_V1, CONVERSATION_SETTLE_FOLLOW_REF_PATCHED],
    [CONVERSATION_SETTLE_FOLLOW_EFFECT_PATCHED_V1, CONVERSATION_SETTLE_FOLLOW_EFFECT_PATCHED]
  ]) {
    if (output.includes(previous) && !output.includes(current)) {
      output = output.replace(previous, current)
      changed = true
    }
  }
  if (!output.includes(CONVERSATION_STATS_RENDER_PATCHED) && !output.includes(CONVERSATION_TOOLTIP_PATCHED)) {
    if (!output.includes(CONVERSATION_TOOLTIP_ORIGINAL)) throw new Error('Pinned DSH cache detail tooltip changed; refusing an unsafe desktop runtime patch.')
    output = output.replace(CONVERSATION_TOOLTIP_ORIGINAL, CONVERSATION_TOOLTIP_PATCHED)
    changed = true
  }
  if (output.includes(CONVERSATION_STATS_CSS_PATCHED_V1) && !output.includes(CONVERSATION_STATS_CSS_PATCHED)) {
    output = output.replace(CONVERSATION_STATS_CSS_PATCHED_V1, CONVERSATION_STATS_CSS_PATCHED)
    changed = true
  }
  for (const previous of [CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED_V1, CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED_V2]) {
    if (output.includes(previous) && !output.includes(CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED)) {
      output = output.replace(previous, CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED)
      changed = true
    }
  }
  const replacements = [
    [CONVERSATION_VIEW_OWNER_ORIGINAL, CONVERSATION_VIEW_OWNER_PATCHED, 'conversation view navigation action'],
    [CONVERSATION_QUEUE_ORIGINAL, CONVERSATION_QUEUE_PATCHED, 'internal team queue filtering'],
    [CONVERSATION_USAGE_ORIGINAL, CONVERSATION_USAGE_PATCHED, 'token projection consumer'],
    [CONVERSATION_CACHE_ORIGINAL, CONVERSATION_CACHE_PATCHED, 'cache summary'],
    [CONVERSATION_STATS_CSS_ORIGINAL, CONVERSATION_STATS_CSS_PATCHED, 'conversation stats layout'],
    [CONVERSATION_STATS_RENDER_ORIGINAL, CONVERSATION_STATS_RENDER_PATCHED, 'conversation stats rendering'],
    [CONVERSATION_CACHE_ZH_ORIGINAL, CONVERSATION_CACHE_ZH_PATCHED, 'Chinese cache labels'],
    [CONVERSATION_CACHE_EN_ORIGINAL, CONVERSATION_CACHE_EN_PATCHED, 'English cache labels'],
    [CONVERSATION_TIMELINE_ORIGINAL, CONVERSATION_TIMELINE_PATCHED, 'chat timeline selector'],
    [CONVERSATION_RUNNING_TURN_ORIGINAL, CONVERSATION_RUNNING_TURN_PATCHED, 'chat running-turn scalar'],
    [CONVERSATION_SETTLE_FOLLOW_REF_ORIGINAL, CONVERSATION_SETTLE_FOLLOW_REF_PATCHED, 'chat stop follow-state capture'],
    [CONVERSATION_SETTLE_FOLLOW_EFFECT_ORIGINAL, CONVERSATION_SETTLE_FOLLOW_EFFECT_PATCHED, 'chat stop follow-state transition'],
    [CONVERSATION_SETTLE_FOLLOW_CONDITION_ORIGINAL, CONVERSATION_SETTLE_FOLLOW_CONDITION_PATCHED, 'chat stop follow-state restoration'],
    [CONVERSATION_SETTLE_FOLLOW_TO_BOTTOM_ORIGINAL, CONVERSATION_SETTLE_FOLLOW_TO_BOTTOM_PATCHED, 'chat stop explicit follow intent'],
    [CONVERSATION_SETTLE_FOLLOW_SCROLL_ORIGINAL, CONVERSATION_SETTLE_FOLLOW_SCROLL_PATCHED, 'chat stop reader override'],
    [CONVERSATION_SETTLE_FOLLOW_RESIZE_ORIGINAL, CONVERSATION_SETTLE_FOLLOW_RESIZE_PATCHED, 'chat stop delayed resize follow-through'],
    [CONVERSATION_ROOT_SLOT_MEMO_ORIGINAL, CONVERSATION_ROOT_SLOT_MEMO_PATCHED, 'conversation session slot memoization'],
    [CONVERSATION_ROOT_HEADER_ORIGINAL, CONVERSATION_ROOT_HEADER_PATCHED, 'conversation header slot reuse'],
    [CONVERSATION_ROOT_VIEW_ORIGINAL, CONVERSATION_ROOT_VIEW_PATCHED, 'conversation view slot reuse'],
    [CONVERSATION_ACTIVE_VIEW_ATTRIBUTE_ORIGINAL, CONVERSATION_ACTIVE_VIEW_ATTRIBUTE_PATCHED, 'active conversation view marker'],
    [CONVERSATION_SECONDARY_VIEW_STATE_ORIGINAL, CONVERSATION_SECONDARY_VIEW_STATE_PATCHED, 'secondary conversation view state'],
    [CONVERSATION_SECONDARY_VIEW_TABS_ORIGINAL, CONVERSATION_SECONDARY_VIEW_TABS_PATCHED, 'secondary conversation view menu'],
    [CONVERSATION_NON_CHAT_COMPOSER_CSS_ORIGINAL, CONVERSATION_NON_CHAT_COMPOSER_CSS_PATCHED, 'non-chat composer visibility']
  ]
  for (const [original, patched, label] of replacements) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe desktop runtime patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  const assistantCopy = patchAssistantCopySource(output)
  output = assistantCopy.source
  changed ||= assistantCopy.changed
  const workTree = patchConversationWorkTreeSource(output)
  output = workTree.source
  changed ||= workTree.changed
  const timelineReferenceAction = patchTimelineReferenceActionSource(output)
  output = timelineReferenceAction.source
  changed ||= timelineReferenceAction.changed
  return { source: output, changed }
}

export function patchTokenMeterSource(source) {
  let output = source
  let changed = false
  const detailMarkerCount = TOKEN_USAGE_DETAIL_COMPLETE_MARKERS.filter(marker => output.includes(marker)).length
  const registrationPatched = output.includes(TOKEN_USAGE_REGISTER_PATCHED) || output.includes(TOKEN_USAGE_REGISTER_ALPHA2_PATCHED)
  if ((detailMarkerCount > 0 && detailMarkerCount < TOKEN_USAGE_DETAIL_COMPLETE_MARKERS.length) || (detailMarkerCount === TOKEN_USAGE_DETAIL_COMPLETE_MARKERS.length) !== registrationPatched) {
    throw new Error('Pinned DSH token usage detail patch is incomplete; refusing an unsafe repair.')
  }
  if (!output.includes(TOKEN_USAGE_DETAIL_MARKER)) {
    if (!output.includes(TOKEN_USAGE_DETAIL_ANCHOR)) throw new Error('Pinned DSH token usage projection changed; refusing an unsafe cache-metrics patch.')
    const detailPatch = output.includes('stateSchema: contextPressureStateSchema') ? TOKEN_USAGE_DETAIL_PATCH_STATE_WIRE : TOKEN_USAGE_DETAIL_PATCH
    output = output.replace(TOKEN_USAGE_DETAIL_ANCHOR, `${detailPatch}${TOKEN_USAGE_DETAIL_ANCHOR}`)
    changed = true
  }
  if (!output.includes(TOKEN_USAGE_REGISTER_PATCHED) && !output.includes(TOKEN_USAGE_REGISTER_ALPHA2_PATCHED)) {
    const registrations = [
      [TOKEN_USAGE_REGISTER_ORIGINAL, TOKEN_USAGE_REGISTER_PATCHED],
      [TOKEN_USAGE_REGISTER_ALPHA2_ORIGINAL, TOKEN_USAGE_REGISTER_ALPHA2_PATCHED]
    ].filter(([original]) => output.includes(original))
    if (registrations.length !== 1) throw new Error('Pinned DSH token projection registration changed; refusing an unsafe cache-metrics patch.')
    output = output.replace(registrations[0][0], registrations[0][1])
    changed = true
  }
  return { source: output, changed }
}

export function patchSandboxEscalationSource(source) {
  if (source.includes(SANDBOX_APPROVAL_REQUEST_PATCHED)) return { source, changed: false }
  if (!source.includes(SANDBOX_APPROVAL_REQUEST_ORIGINAL)) {
    throw new Error('Pinned DSH sandbox approval choreography changed; refusing an unsafe never-policy patch.')
  }
  return { source: source.replace(SANDBOX_APPROVAL_REQUEST_ORIGINAL, SANDBOX_APPROVAL_REQUEST_PATCHED), changed: true }
}

export function patchPwshLocalSource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of [
    [PWSH_ENCODING_ORIGINAL, PWSH_ENCODING_PATCHED, 'PowerShell encoding preamble'],
    [PWSH_ARGV_ORIGINAL, PWSH_ARGV_PATCHED, 'PowerShell sandbox-mode preamble selection']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe confined-command patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

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

export function patchToolPwshSource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of [
    [TOOL_PWSH_WORKDIR_ORIGINAL, TOOL_PWSH_WORKDIR_PATCHED, 'PowerShell workdir resolver'],
    [TOOL_PWSH_WORKDIR_CALL_ORIGINAL, TOOL_PWSH_WORKDIR_CALL_PATCHED, 'PowerShell workdir policy mapping']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe sandbox-root patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchSandboxExecutorSource(source) {
  if (source.includes(SANDBOX_EXECUTOR_SIGNATURE_PATCHED)) return { source, changed: false }
  if (!source.includes(SANDBOX_EXECUTOR_SIGNATURE_ORIGINAL)) {
    throw new Error('Pinned DSH sandbox executor denial classifier changed; refusing an unsafe nested-pipe patch.')
  }
  return { source: source.replace(SANDBOX_EXECUTOR_SIGNATURE_ORIGINAL, SANDBOX_EXECUTOR_SIGNATURE_PATCHED), changed: true }
}

export function patchWindowsAclSource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of [
    [WINDOWS_ACL_DEFAULT_DACL_COMMENT_ORIGINAL, WINDOWS_ACL_DEFAULT_DACL_COMMENT_PATCHED, 'default-DACL contract'],
    [WINDOWS_ACL_DEFAULT_DACL_ORIGINAL, WINDOWS_ACL_DEFAULT_DACL_PATCHED, 'default-DACL grant']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH Windows ACL ${label} changed; refusing an unsafe token-intersection patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchSubagentSource(source) {
  const officialLineage = ['function SubagentHeaderLineage(', 'conversation.session.header.lineage', 'function CatalogDropdown(']
  if (officialLineage.every(marker => source.includes(marker))) return { source, changed: false }
  let output = source
  let changed = false
  const migrations = [
    [SUBAGENT_CATALOG_ROWS_LEGACY, SUBAGENT_CATALOG_ROWS_PATCHED, 'legacy unsorted catalog rows'],
    [SUBAGENT_COUNTS_LEGACY, SUBAGENT_COUNTS_PATCHED, 'legacy automatic history fallback'],
    [SUBAGENT_FILTER_DISABLED_LEGACY, SUBAGENT_FILTER_DISABLED_PATCHED, 'legacy disabled current filter'],
    [SUBAGENT_TRIGGER_COUNT_LEGACY, SUBAGENT_TRIGGER_COUNT_PATCHED, 'legacy trigger summary'],
    [SUBAGENT_DIALOG_ACCESS_LEGACY, SUBAGENT_DIALOG_ACCESS_PATCHED, 'legacy modal declaration'],
    [SUBAGENT_MENU_LEGACY, SUBAGENT_MENU_PATCHED, 'legacy floating menu'],
    [SUBAGENT_ROOT_FILTER_PROPS_LEGACY, SUBAGENT_ROOT_FILTER_PROPS_PATCHED, 'legacy menu nesting']
  ]
  for (const [legacy, patched, label] of migrations) {
    if (output.includes(patched) || !output.includes(legacy)) continue
    output = output.replace(legacy, patched)
    changed = true
  }
  const replacements = [
    [SUBAGENT_CATALOG_ROWS_ORIGINAL, SUBAGENT_CATALOG_ROWS_PATCHED, 'catalog lifecycle filter'],
    [SUBAGENT_CATALOG_MAP_ORIGINAL, SUBAGENT_CATALOG_MAP_PATCHED, 'filtered catalog rows'],
    [SUBAGENT_ACTIVITY_ORIGINAL, SUBAGENT_ACTIVITY_PATCHED, 'lifecycle activity labels'],
    [SUBAGENT_RECURSIVE_PROPS_ORIGINAL, SUBAGENT_RECURSIVE_PROPS_PATCHED, 'nested lifecycle filter'],
    [SUBAGENT_FILTER_STATE_ORIGINAL, SUBAGENT_FILTER_STATE_PATCHED, 'lifecycle filter state'],
    [SUBAGENT_DIALOG_REF_ORIGINAL, SUBAGENT_DIALOG_REF_PATCHED, 'drawer focus ref'],
    [SUBAGENT_CHANGE_OPEN_ORIGINAL, SUBAGENT_CHANGE_OPEN_PATCHED, 'drawer focus transfer'],
    [SUBAGENT_COUNTS_ORIGINAL, SUBAGENT_COUNTS_PATCHED, 'lifecycle descendant counts'],
    [SUBAGENT_TRIGGER_POPUP_ORIGINAL, SUBAGENT_TRIGGER_POPUP_PATCHED, 'lifecycle popup semantics'],
    [SUBAGENT_TRIGGER_ARIA_ORIGINAL, SUBAGENT_TRIGGER_ARIA_PATCHED, 'lifecycle trigger label'],
    [SUBAGENT_TRIGGER_COUNT_ORIGINAL, SUBAGENT_TRIGGER_COUNT_PATCHED, 'compact trigger count'],
    [SUBAGENT_MENU_ORIGINAL, SUBAGENT_MENU_PATCHED, 'drawer dialog shell'],
    [SUBAGENT_ROOT_FILTER_PROPS_ORIGINAL, SUBAGENT_ROOT_FILTER_PROPS_PATCHED, 'root lifecycle filter'],
    [SUBAGENT_ZH_ACTIVITY_ORIGINAL, SUBAGENT_ZH_ACTIVITY_PATCHED, 'Chinese lifecycle labels'],
    [SUBAGENT_EN_ACTIVITY_ORIGINAL, SUBAGENT_EN_ACTIVITY_PATCHED, 'English lifecycle labels'],
    [SUBAGENT_ZH_DRAWER_ORIGINAL, SUBAGENT_ZH_DRAWER_PATCHED, 'Chinese drawer labels'],
    [SUBAGENT_EN_DRAWER_ORIGINAL, SUBAGENT_EN_DRAWER_PATCHED, 'English drawer labels']
  ]
  if (!output.includes(SUBAGENT_LIFECYCLE_HELPERS_MARKER)) {
    if (!output.includes(SUBAGENT_LIFECYCLE_HELPERS_ANCHOR)) throw new Error('Pinned DSH subagent catalog helpers changed; refusing an unsafe lifecycle patch.')
    output = output.replace(SUBAGENT_LIFECYCLE_HELPERS_ANCHOR, `${SUBAGENT_LIFECYCLE_HELPERS_PATCH}${SUBAGENT_LIFECYCLE_HELPERS_ANCHOR}`)
    changed = true
  }
  if (!output.includes(SUBAGENT_LIFECYCLE_SORT_MARKER)) {
    if (!output.includes(SUBAGENT_LIFECYCLE_HELPERS_ANCHOR)) throw new Error('Pinned DSH subagent catalog sorting anchor changed; refusing an unsafe lifecycle patch.')
    output = output.replace(SUBAGENT_LIFECYCLE_HELPERS_ANCHOR, `${SUBAGENT_LIFECYCLE_SORT_PATCH}${SUBAGENT_LIFECYCLE_HELPERS_ANCHOR}`)
    changed = true
  }
  if (!output.includes(SUBAGENT_EXTERNAL_OPEN_EFFECT_MARKER)) {
    if (!output.includes(SUBAGENT_EXTERNAL_OPEN_EFFECT_ANCHOR)) throw new Error('Pinned DSH subagent drawer open hook changed; refusing an unsafe unified-agent patch.')
    output = output.replace(SUBAGENT_EXTERNAL_OPEN_EFFECT_ANCHOR, `${SUBAGENT_EXTERNAL_OPEN_EFFECT_PATCH}${SUBAGENT_EXTERNAL_OPEN_EFFECT_ANCHOR}`)
    changed = true
  }
  if (!output.includes(SUBAGENT_STYLE_MARKER)) {
    if (output.includes(SUBAGENT_STYLE_LEGACY_MARKER)) {
      if (!output.includes(SUBAGENT_STYLE_LEGACY_PATCH)) throw new Error('Pinned DSH legacy subagent styles changed; refusing an unsafe drawer migration.')
      output = output.replace(SUBAGENT_STYLE_LEGACY_PATCH, SUBAGENT_STYLE_PATCH)
    } else {
      if (!output.includes(SUBAGENT_STYLE_ANCHOR)) throw new Error('Pinned DSH subagent catalog styles changed; refusing an unsafe drawer patch.')
      output = output.replace(SUBAGENT_STYLE_ANCHOR, `${SUBAGENT_STYLE_PATCH}${SUBAGENT_STYLE_ANCHOR}`)
    }
    changed = true
  }
  for (const [original, patched, label] of replacements) {
    if (output.includes(patched)) continue
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

export function patchFsSearchSource(source) {
  let output = source
  let changed = false
  for (const [original, patched, label] of [
    [SEARCH_CLASSIFY_EXIT2_ORIGINAL, SEARCH_CLASSIFY_EXIT2_PATCHED, 'search exit-2 failure classifier'],
    [SEARCH_GREP_PROMPT_ORIGINAL, SEARCH_GREP_PROMPT_PATCHED, 'grep system-prompt recovery guidance'],
    [SEARCH_GREP_DESCRIPTION_ORIGINAL, SEARCH_GREP_DESCRIPTION_PATCHED, 'grep tool description']
  ]) {
    if (output.includes(patched)) continue
    if (!output.includes(original)) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe search-recovery patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

export function patchFsEditSource(source) {
  let output = source
  let changed = false
  for (const [candidates, patched, label] of [
    [[FS_EDIT_REMEDIES_V1, FS_EDIT_REMEDIES_ORIGINAL], FS_EDIT_REMEDIES_PATCHED, 'edit not-found remediation'],
    [[FS_EDIT_PROMPT_V1, FS_EDIT_PROMPT_ORIGINAL], FS_EDIT_PROMPT_PATCHED, 'edit system-prompt recovery guidance'],
    [[FS_EDIT_DESCRIPTION_V1, FS_EDIT_DESCRIPTION_ORIGINAL], FS_EDIT_DESCRIPTION_PATCHED, 'edit tool description'],
    [[FS_EDIT_OLD_STRING_DESCRIPTION_V1, FS_EDIT_OLD_STRING_DESCRIPTION_ORIGINAL], FS_EDIT_OLD_STRING_DESCRIPTION_PATCHED, 'edit old_string description']
  ]) {
    if (output.includes(patched)) continue
    const original = candidates.find(candidate => output.includes(candidate))
    if (original === undefined) throw new Error(`Pinned DSH ${label} changed; refusing an unsafe edit-recovery patch.`)
    output = output.replace(original, patched)
    changed = true
  }
  return { source: output, changed }
}

const OFFICIAL_RC2_VERSION = '0.1.1-rc.2'
const OFFICIAL_ALPHA2_VERSION = '0.1.2-alpha.2'
const OFFICIAL_ALPHA2_SESSION_CONTROLLER_CLIENT_HASH = 'D309F8E61F958A0D751A6D4A7C2E94F5C5A54E1313B3FCB2988A988C703F239C'
const OFFICIAL_ALPHA2_SESSION_CONTROLLER_HOST_HASH = 'A28FA9A5FFAD5D2E7AF427C0410E973A5E14A36BC070EECF8735B77B95A17CEA'
const OFFICIAL_ALPHA2_WORKSPACE_PATCHED_HASH = 'B47D4AD32FF91ACDC7B27BE85AA184E4579B1973DF2DB04FB8E58A30590FDE0D'
const OFFICIAL_ALPHA2_SESSION_CONTROLLER_PATCHED_HASH = 'BADF08E05B7885EF1554E997B7FD39B5BBE6607E9FA9AFC927F135DE1DE8F5CF'
const OFFICIAL_ALPHA2_HASHES = Object.freeze({
  '@deepseek-ai/dsh-client-ui-conversation': '49185108A396BC5991ED15399FB622D8A00EFE634135CC28DA08EF429FCCD9A5',
  '@deepseek-ai/dsh-client-ui-chat': '1AF416E18DD1A4DC0AB98665129D65B860EE654310F11DC152B242153D1773DD',
  '@deepseek-ai/dsh-client-ui-tool': 'DCFF7D94129FD8B8AF247D480195599D9DB0189133A3A69F7F948E69F2C307B9',
  '@deepseek-ai/dsh-token-meter': 'A96011805EA7477551F3161FF922DF6C1DE5C5E639995E4AA9395AE6BA816A13',
  '@deepseek-ai/dsh-client-ui-model-selection': '68D80BC1D0C159DDC6079CCBB6E91981C524A1E2B5845986F577170B2A191978',
  '@deepseek-ai/dsh-client-ui-settings-models': '70DE8C4CE48D9C133005B1F95F8E9E9FE114F3BB2D08A9206C2283469831D74D',
  '@deepseek-ai/dsh-client-ui-workspace': 'CEB9BA4061A7C6F2DE7FC18922AC3CEB430DAA4A162C211E4741BC9F6547B42A'
})

function sourceSha256(source) {
  return createHash('sha256').update(source).digest('hex').toUpperCase()
}

async function officialAlpha2Package(file, expectedName) {
  const packageRoot = path.resolve(path.dirname(file), '..')
  let manifest
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  if (manifest.name !== expectedName) throw new Error(`Pinned DSH package identity changed for ${expectedName}; refusing an unsafe alpha.2 UI decision.`)
  return manifest.version === OFFICIAL_ALPHA2_VERSION ? { packageRoot, manifest } : null
}

function assertOfficialAlpha2Artifact(source, packageName, anchors) {
  const expected = OFFICIAL_ALPHA2_HASHES[packageName]
  if (sourceSha256(source) !== expected) throw new Error(`Pinned DSH ${packageName}@${OFFICIAL_ALPHA2_VERSION} source hash changed; refusing an unsafe alpha.2 UI decision.`)
  for (const anchor of anchors) if (!source.includes(anchor)) throw new Error(`Pinned DSH ${packageName}@${OFFICIAL_ALPHA2_VERSION} semantic anchor changed; refusing an unsafe alpha.2 UI decision.`)
}

export async function patchInstalledRuntime(file = runtimeClient) {
  const source = await readFile(file, 'utf8')
  const patched = patchRuntimeSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledAttachmentProfile(file = attachmentProfileRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchAttachmentProfileSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledDirectoryPicker(file = directoryPickerRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchDirectoryPickerSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export function patchConversationSource(source) {
  const cache = patchConversationCacheSource(source)
  const deliveryOwner = patchToolResultOwnerSource(cache.source)
  const inputLabels = patchAttachmentInputConversationSource(deliveryOwner.source)
  return {
    source: inputLabels.source,
    changed: cache.changed || deliveryOwner.changed || inputLabels.changed
  }
}

export async function patchInstalledConversation(file = conversationRuntime) {
  const alpha2 = await officialAlpha2Package(file, '@deepseek-ai/dsh-client-ui-conversation')
  if (alpha2 !== null) {
    const chatFile = path.join(path.dirname(alpha2.packageRoot), 'dsh-client-ui-chat', 'lib', 'client.js')
    const chatPackage = await officialAlpha2Package(chatFile, '@deepseek-ai/dsh-client-ui-chat')
    if (chatPackage === null) throw new Error('Pinned DSH alpha.2 chat companion is missing; refusing an unsafe conversation patch.')
    const source = await readFile(file, 'utf8')
    const chatSource = await readFile(chatFile, 'utf8')
    const markers = [
      source.includes(CONVERSATION_QUEUE_PATCHED),
      source.includes('"image.copy": "复制图片 {name}"'),
      source.includes('"image.cut": "Cut image {name}"'),
      chatSource.includes(CONVERSATION_USAGE_PATCHED),
      chatSource.includes(CONVERSATION_CACHE_ALPHA2_PATCHED),
      chatSource.includes(CONVERSATION_TOOLTIP_PATCHED),
      chatSource.includes(CONVERSATION_CACHE_ZH_PATCHED),
      chatSource.includes(CONVERSATION_CACHE_EN_PATCHED),
      chatSource.includes('const runningTurnStart = useChat((s) => runningTurnStartTime(s.timeline));'),
      chatSource.includes(CONVERSATION_RUNNING_TURN_PATCHED)
    ]
    const patchedCount = markers.filter(Boolean).length
    if (patchedCount !== 0 && patchedCount !== markers.length) throw new Error('Pinned DSH alpha.2 conversation patch is incomplete; refusing an unsafe repair.')
    if (patchedCount === 0) {
      assertOfficialAlpha2Artifact(source, '@deepseek-ai/dsh-client-ui-conversation', ['data-conversation-scroll', 'function ConversationRoot'])
      assertOfficialAlpha2Artifact(chatSource, '@deepseek-ai/dsh-client-ui-chat', ['followSigRef', 'const TurnProcessNodeView', 'useProjection("tokenUsage")'])
    }
    const patched = patchAlpha2ConversationSources(source, chatSource)
    if (patched.changed) {
      await writeFile(file, patched.conversationSource, 'utf8')
      await writeFile(chatFile, patched.chatSource, 'utf8')
    }
    return patched.changed
  }
  const source = await readFile(file, 'utf8')
  const patched = patchConversationSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledAttachmentInput(file = attachmentUiRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchAttachmentInputSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledToolResultImages(file = toolUiRuntime) {
  const source = await readFile(file, 'utf8')
  const alpha2 = await officialAlpha2Package(file, '@deepseek-ai/dsh-client-ui-tool')
  if (alpha2 !== null) {
    const highLevelMarkers = [source.includes('function resultImages(block)'), source.includes('@harness-desktop/recoverable-tool-error-v2')]
    const markerCount = highLevelMarkers.filter(Boolean).length
    if (markerCount !== 0 && markerCount !== highLevelMarkers.length) throw new Error('Pinned DSH alpha.2 tool UI patch is incomplete; refusing an unsafe repair.')
    if (markerCount === 0) assertOfficialAlpha2Artifact(source, '@deepseek-ai/dsh-client-ui-tool', ['function resultText(node)', 'function ToolCallTree', 'function ToolDetails'])
    const images = patchAlpha2ToolResultImageSource(source)
    const recoverable = patchRecoverableToolErrorSource(images.source)
    if (images.changed || recoverable.changed) await writeFile(file, recoverable.source, 'utf8')
    return images.changed || recoverable.changed
  }
  const images = patchToolResultImageSource(source)
  const recoverable = patchRecoverableToolErrorSource(images.source)
  if (images.changed || recoverable.changed) await writeFile(file, recoverable.source, 'utf8')
  return images.changed || recoverable.changed
}

export async function patchInstalledTokenMeter(file = tokenMeterRuntime) {
  const source = await readFile(file, 'utf8')
  const alpha2 = await officialAlpha2Package(file, '@deepseek-ai/dsh-token-meter')
  if (alpha2 !== null && !source.includes(TOKEN_USAGE_DETAIL_MARKER)) {
    assertOfficialAlpha2Artifact(source, '@deepseek-ai/dsh-token-meter', ['stateVersion: 2', 'cacheReadTokens', 'llm/retry-started', TOKEN_USAGE_REGISTER_ALPHA2_ORIGINAL])
  }
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

export async function patchInstalledSandbox(file = sandboxRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchSandboxEscalationSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledPwshLocal(file = pwshLocalRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchPwshLocalSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledToolPwsh(file = toolPwshRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchToolPwshSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledSandboxExecutor(file) {
  const source = await readFile(file, 'utf8')
  const patched = patchSandboxExecutorSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledPwshSandbox(file = pwshSandboxRuntime) {
  return patchInstalledSandboxExecutor(file)
}

export async function patchInstalledBashSandbox(file = bashSandboxRuntime) {
  return patchInstalledSandboxExecutor(file)
}

export async function patchInstalledWindowsAcl(file = windowsAclRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchWindowsAclSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledModelSelection(file = modelSelectionRuntime) {
  const source = await readFile(file, 'utf8')
  if (await officialAlpha2Package(file, '@deepseek-ai/dsh-client-ui-model-selection') !== null) {
    assertOfficialAlpha2Artifact(source, '@deepseek-ai/dsh-client-ui-model-selection', ['model.reasoning?.defaultEffort', 'state.current?.reasoningEffort ?? reasoning?.defaultEffort', 'const chooseEffort = (effort) =>', 'reasoningEffort: effort'])
    return false
  }
  const patched = patchReasoningEffortSliderSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledModelSettings(file = modelSettingsRuntime) {
  const source = await readFile(file, 'utf8')
  if (await officialAlpha2Package(file, '@deepseek-ai/dsh-client-ui-settings-models') !== null) {
    assertOfficialAlpha2Artifact(source, '@deepseek-ai/dsh-client-ui-settings-models', ['function deriveKeyRef(provider)', 'ctx.remote.credentials.describe([ref])', 'ctx.remote.credentials.set(ref, value)', 'ctx.remote.credentials.unset(ref)', 'reason: "credential-read-only"'])
    return false
  }
  const keyOverride = patchModelSettingsKeyOverrideSource(source)
  const validation = patchModelSettingsCredentialValidationSource(keyOverride.source)
  if (keyOverride.changed || validation.changed) await writeFile(file, validation.source, 'utf8')
  return keyOverride.changed || validation.changed
}

export async function patchInstalledDeepSeekModelDiscovery(file = deepSeekLlmRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchDeepSeekModelDiscoverySource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledWorkspaceUi(file = workspaceUiRuntime) {
  const source = await readFile(file, 'utf8')
  if (await officialAlpha2Package(file, '@deepseek-ai/dsh-client-ui-workspace') !== null) {
    for (const anchor of ['function sessionVisible(session, current, archived)', 'session.origin !== "subagent"', 'function deriveGroups(', 'function deriveFlat(', 'insertSessionBefore(activeDrag.accountKey']) {
      if (!source.includes(anchor)) throw new Error('Pinned DSH alpha.2 native workspace session-menu semantics changed; refusing an unsafe patch.')
    }
    const sourceHash = sourceSha256(source)
    if (![OFFICIAL_ALPHA2_HASHES['@deepseek-ai/dsh-client-ui-workspace'], OFFICIAL_ALPHA2_WORKSPACE_PATCHED_HASH].includes(sourceHash)) {
      throw new Error('Pinned DSH alpha.2 workspace source is neither exact official nor exact complete patched artifact; refusing an unsafe patch.')
    }
    const patched = patchAlpha2WorkspaceStartSessionSource(source)
    if (sourceSha256(patched.source) !== OFFICIAL_ALPHA2_WORKSPACE_PATCHED_HASH) throw new Error('Pinned DSH alpha.2 workspace patch output hash changed; refusing an unsafe patch.')
    if (patched.changed) await writeFile(file, patched.source, 'utf8')
    return patched.changed
  }
  const patched = patchWorkspaceSessionMenuSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledAlpha2SessionController(file = sessionControllerClientRuntime) {
  const source = await readFile(file, 'utf8')
  if (await officialAlpha2Package(file, '@deepseek-ai/dsh-api-session-controller') === null) {
    throw new Error('Exact alpha.2 graph selected but Session Controller client package is not alpha.2; refusing an unsafe patch.')
  }
  const sourceHash = sourceSha256(source)
  if (![OFFICIAL_ALPHA2_SESSION_CONTROLLER_CLIENT_HASH, OFFICIAL_ALPHA2_SESSION_CONTROLLER_PATCHED_HASH].includes(sourceHash)) {
    throw new Error('Pinned DSH alpha.2 Session Controller client is neither exact official nor exact complete patched artifact; refusing an unsafe patch.')
  }
  const patched = patchAlpha2SessionControllerSource(source)
  if (sourceSha256(patched.source) !== OFFICIAL_ALPHA2_SESSION_CONTROLLER_PATCHED_HASH) throw new Error('Pinned DSH alpha.2 Session Controller patch output hash changed; refusing an unsafe patch.')
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function assertInstalledAlpha2NativeSessionList(file = sessionControllerHostRuntime) {
  const source = await readFile(file, 'utf8')
  if (await officialAlpha2Package(file, '@deepseek-ai/dsh-api-session-controller') === null) {
    throw new Error('Exact alpha.2 graph selected but Session Controller host package is not alpha.2; refusing host-list retirement.')
  }
  if (sourceSha256(source) !== OFFICIAL_ALPHA2_SESSION_CONTROLLER_HOST_HASH) {
    throw new Error('Pinned DSH alpha.2 Session Controller host source hash changed; refusing host-list retirement.')
  }
  for (const anchor of ['const COLD_SUMMARY_BATCH_SIZE = 16;', 'key: "sessionListMetadata"', 'const metadata = projections?.values.sessionListMetadata;', '...listFields(session.header)', 'cold.slice(offset, offset + COLD_SUMMARY_BATCH_SIZE)', 'function listFields(header)']) {
    if (!source.includes(anchor)) throw new Error(`Pinned DSH alpha.2 native Session list proof changed (${anchor}); refusing host-list retirement.`)
  }
  return false
}

export async function patchInstalledSessionPersistence(file = sessionPersistenceRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchSessionPersistenceListingSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledHostApiProxy(file = hostApiProxyRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchHostSessionListingSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledFsSearch(file = fsSearchRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchFsSearchSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledToolFs(file = toolFsRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchFsEditSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledSubprocess(file = subprocessRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchSubprocessSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

export async function patchInstalledWebApp(file = webAppRuntime) {
  const source = await readFile(file, 'utf8')
  const patched = patchWebAppSource(source)
  if (patched.changed) await writeFile(file, patched.source, 'utf8')
  return patched.changed
}

const OFFICIAL_GRAPH_SECTIONS = Object.freeze(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])
const OFFICIAL_GRAPH_PROOFS = Object.freeze({
  alpha2: Object.freeze({ version: OFFICIAL_ALPHA2_VERSION, selectedCount: 216, selectedNames: 215, selectedBytes: 62384, selectedSha256: '2fe4b564bd064447752eac205304dd39130a717236e85e8d5aaed822530c770c', rootCount: 20, rootBytes: 1111, rootSha256: '90e7639317bff29214acb13396966ba0b8cf22a9ef7c8d2a2f5a0a2bcbeda064' }),
  rc2: Object.freeze({ version: OFFICIAL_RC2_VERSION, selectedCount: 188, selectedNames: 188, selectedBytes: 53868, selectedSha256: '86190efb1c721e2ad2318f6ecbeeab2a17ec8ca79d44efcd60e2c2af4647c7ba', rootCount: 20, rootBytes: 1051, rootSha256: '458670543f54b6293508410d98302bd6f1ba1af2dcd595b98b4fcac2ccfe48d4' })
})

function assertOfficialGraphField(value, label) {
  if (typeof value !== 'string' || value.length === 0 || /[\0\r\n\\\uD800-\uDFFF]/u.test(value)) {
    throw new Error(`Official DSH ${label} is malformed; refusing an unsafe runtime patch.`)
  }
  return value
}

function officialDshPackageName(location, entry) {
  const canonicalLocation = assertOfficialGraphField(location, 'lock location')
  if (canonicalLocation.startsWith('/') || canonicalLocation.endsWith('/') || canonicalLocation.includes('//') || canonicalLocation.split('/').includes('..') || !canonicalLocation.includes('node_modules/')) {
    throw new Error(`Official DSH lock location is not canonical: ${location}; refusing an unsafe runtime patch.`)
  }
  const tail = canonicalLocation.slice(canonicalLocation.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const parts = tail.split('/')
  const inferred = parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  if (typeof entry?.name === 'string' && entry.name !== inferred) throw new Error(`Official DSH lock name/location mismatch: ${location}; refusing an unsafe runtime patch.`)
  return entry?.name ?? inferred
}

function isOfficialDshPackage(name) {
  return typeof name === 'string' && (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
}

function officialGraphDigest(records) {
  const buffers = records.map(record => Buffer.from(record, 'utf8')).sort(Buffer.compare)
  const bytes = buffers.reduce((sum, record) => sum + record.length, 0)
  return { count: buffers.length, bytes, sha256: createHash('sha256').update(Buffer.concat(buffers, bytes)).digest('hex') }
}

function officialRootRecords(source, label) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) throw new Error(`Official DSH ${label} root graph is missing; refusing an unsafe runtime patch.`)
  const records = []
  for (const section of OFFICIAL_GRAPH_SECTIONS) {
    const dependencies = source[section]
    if (dependencies === undefined) continue
    if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw new Error(`Official DSH ${label} ${section} is malformed; refusing an unsafe runtime patch.`)
    for (const [name, version] of Object.entries(dependencies)) {
      if (!isOfficialDshPackage(name)) continue
      assertOfficialGraphField(name, `${label} root name`)
      assertOfficialGraphField(version, `${label} root version`)
      records.push(`${section}\0${name}\0${version}\n`)
    }
  }
  return records
}

export function classifyOfficialRuntimeGraph(manifest, lock, installedCoreManifest) {
  const packages = lock?.packages
  const lockManifest = packages?.['']
  if (!packages || !lockManifest) throw new Error('Official DSH package-lock graph is missing; refusing an unsafe runtime patch.')
  const manifestRootRecords = officialRootRecords(manifest, 'package')
  const lockRootRecords = officialRootRecords(lockManifest, 'lock')
  const manifestRoot = officialGraphDigest(manifestRootRecords)
  const lockRoot = officialGraphDigest(lockRootRecords)
  if (manifestRoot.count !== lockRoot.count || manifestRoot.bytes !== lockRoot.bytes || manifestRoot.sha256 !== lockRoot.sha256) {
    throw new Error('Official DSH package and lock root graphs differ; refusing an unsafe runtime patch.')
  }
  const rootVersions = new Set(manifestRootRecords.map(record => record.slice(record.lastIndexOf('\0') + 1, -1)))
  if (rootVersions.size !== 1 || ![OFFICIAL_RC2_VERSION, OFFICIAL_ALPHA2_VERSION].includes([...rootVersions][0])) throw new Error('Official DSH direct roots are mixed or unproved; refusing an unsafe runtime patch.')
  const version = [...rootVersions][0]
  const mode = version === OFFICIAL_ALPHA2_VERSION ? 'alpha2' : 'rc2'
  const proof = OFFICIAL_GRAPH_PROOFS[mode]
  if (manifestRoot.count !== proof.rootCount || manifestRoot.bytes !== proof.rootBytes || manifestRoot.sha256 !== proof.rootSha256) throw new Error('Official DSH exact root graph changed; refusing an unsafe runtime patch.')
  if (installedCoreManifest?.name !== '@deepseek-ai/dsh' || installedCoreManifest?.version !== version) throw new Error('Installed @deepseek-ai/dsh identity/version does not match the exact root graph; refusing an unsafe runtime patch.')

  const selected = Object.entries(packages)
    .filter(([location]) => location !== '')
    .map(([location, entry]) => ({ location, entry, name: officialDshPackageName(location, entry) }))
    .filter(row => isOfficialDshPackage(row.name))
  const selectedRecords = []
  for (const { location, entry, name } of selected) {
    assertOfficialGraphField(name, 'selected name')
    const selectedVersion = assertOfficialGraphField(entry?.version, 'selected version')
    const resolved = assertOfficialGraphField(entry?.resolved, 'selected resolved URL')
    const integrity = assertOfficialGraphField(entry?.integrity, 'selected integrity')
    if (selectedVersion !== version) throw new Error(`Official DSH selected lock version mismatch: ${location}; refusing an unsafe runtime patch.`)
    const knownRegistry = ['https://registry.npmjs.org/@deepseek-ai/', 'https://registry.npmmirror.com/@deepseek-ai/'].some(prefix => resolved.startsWith(prefix))
    if (!knownRegistry || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity)) throw new Error(`Official DSH selected lock artifact is not canonical: ${location}; refusing an unsafe runtime patch.`)
    selectedRecords.push(`${location}\0${name}\0${selectedVersion}\0${resolved}\0${integrity}\n`)
  }
  const selectedDigest = officialGraphDigest(selectedRecords)
  const selectedNames = new Set(selected.map(row => row.name)).size
  if (selectedDigest.count !== proof.selectedCount || selectedNames !== proof.selectedNames || selectedDigest.bytes !== proof.selectedBytes || selectedDigest.sha256 !== proof.selectedSha256) throw new Error('Official DSH selected lock graph changed; refusing an unsafe runtime patch.')
  const removed = new Set(selected.filter(row => ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-host-apiproxy'].includes(row.name)).map(row => row.name))
  if (mode === 'alpha2' && removed.size !== 0) throw new Error('Removed alpha.2 compatibility package remains in the selected graph; refusing an unsafe runtime patch.')
  if (mode === 'rc2' && removed.size !== 2) throw new Error('Required rc.2 compatibility packages are missing; refusing an unsafe runtime patch.')
  return { mode, version, directRootCount: manifestRoot.count, selectedPackageCount: selectedDigest.count }
}

async function cliOfficialRuntimeGraph() {
  const [manifest, lock, installedCoreManifest] = await Promise.all([
    readFile(path.join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8').then(JSON.parse)
  ])
  return classifyOfficialRuntimeGraph(manifest, lock, installedCoreManifest)
}

async function resolveInstalledWindowsAclRuntime() {
  try {
    await access(windowsAclRuntime)
    return windowsAclRuntime
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const indexFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-sandbox-windows-acl', 'lib', 'index.js')
  const indexSource = await readFile(indexFile, 'utf8')
  const matches = [...indexSource.matchAll(/from "\.\/(types-[A-Za-z0-9_-]+\.js)"/gu)]
  if (matches.length !== 1) throw new Error('Pinned DSH Windows ACL bundle reference changed; refusing an unsafe token-intersection patch.')
  return path.join(path.dirname(indexFile), matches[0][1])
}

async function assertOfficialAlpha2RemovedArtifactsAbsent() {
  for (const file of [runtimeClient, hostApiProxyRuntime]) {
    try {
      await access(file)
      throw new Error(`Removed alpha.2 compatibility artifact is unexpectedly installed: ${file}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const officialGraph = await cliOfficialRuntimeGraph()
  const targetsAlpha2 = officialGraph.mode === 'alpha2'
  if (targetsAlpha2) await assertOfficialAlpha2RemovedArtifactsAbsent()
  const sessionChanged = targetsAlpha2 ? await patchInstalledAlpha2SessionController() : await patchInstalledRuntime()
  const attachmentProfileChanged = await patchInstalledAttachmentProfile()
  const pickerChanged = await patchInstalledDirectoryPicker()
  const conversationChanged = await patchInstalledConversation()
  const attachmentInputChanged = await patchInstalledAttachmentInput()
  const toolResultImagesChanged = await patchInstalledToolResultImages()
  const tokenMeterChanged = await patchInstalledTokenMeter()
  const subagentChanged = await patchInstalledSubagent()
  const agentLoopChanged = await patchInstalledAgentLoop()
  const subagentContinuationChanged = await patchInstalledSubagentContinuation()
  const sandboxChanged = await patchInstalledSandbox()
  const pwshLocalChanged = await patchInstalledPwshLocal()
  const toolPwshChanged = await patchInstalledToolPwsh()
  const pwshSandboxChanged = await patchInstalledPwshSandbox()
  const bashSandboxChanged = await patchInstalledBashSandbox()
  const windowsAclChanged = await patchInstalledWindowsAcl(await resolveInstalledWindowsAclRuntime())
  const modelSelectionChanged = await patchInstalledModelSelection()
  const modelSettingsChanged = await patchInstalledModelSettings()
  const deepSeekDiscoveryChanged = await patchInstalledDeepSeekModelDiscovery()
  const workspaceUiChanged = await patchInstalledWorkspaceUi()
  const sessionPersistenceChanged = await patchInstalledSessionPersistence()
  const hostApiProxyChanged = targetsAlpha2 ? await assertInstalledAlpha2NativeSessionList() : await patchInstalledHostApiProxy()
  const fsSearchChanged = await patchInstalledFsSearch()
  const toolFsChanged = await patchInstalledToolFs()
  const subprocessChanged = await patchInstalledSubprocess()
  const webAppChanged = await patchInstalledWebApp()
  const codexParityChanged = await patchCodexParityRuntime(path.join(root, 'node_modules'))
  process.stdout.write(targetsAlpha2 ? (sessionChanged ? 'Patched alpha.2 SessionManager rendering performance.\n' : 'Alpha.2 SessionManager rendering performance patch already applied.\n') : (sessionChanged ? 'Patched desktop New Session behavior and SessionManager rendering performance.\n' : 'Desktop New Session and SessionManager rendering performance patches already applied.\n'))
  process.stdout.write(attachmentProfileChanged ? 'Removed fixed image-side and normalization dimension caps.\n' : 'Image-side and normalization dimension caps already removed.\n')
  process.stdout.write(pickerChanged ? 'Patched stable Windows directory picker.\n' : 'Stable Windows directory picker patch already applied.\n')
  process.stdout.write(conversationChanged ? 'Patched conversation telemetry, view navigation, labels, and sticky response copy.\n' : 'Conversation telemetry, view navigation, labels, and sticky response copy already patched.\n')
  process.stdout.write(attachmentInputChanged ? 'Patched recoverable image dragging and draft image transfer.\n' : 'Recoverable image dragging and draft image transfer already patched.\n')
  process.stdout.write(toolResultImagesChanged ? 'Patched durable tool-result image delivery, file delivery, and recoverable edit-conflict presentation.\n' : 'Durable tool-result image delivery, file delivery, and recoverable edit-conflict presentation already patched.\n')
  process.stdout.write(tokenMeterChanged ? 'Patched cache telemetry detail projection.\n' : 'Cache telemetry detail projection already applied.\n')
  process.stdout.write(subagentChanged ? 'Patched subagent lifecycle and history views.\n' : 'Subagent lifecycle and history views already applied.\n')
  process.stdout.write(agentLoopChanged ? 'Patched abortable streams and queued-turn recovery.\n' : 'Abortable streams and queued-turn recovery already patched.\n')
  process.stdout.write(subagentContinuationChanged ? 'Patched continuable subagent idle-inbox recovery.\n' : 'Continuable subagent idle-inbox recovery already patched.\n')
  process.stdout.write(sandboxChanged ? 'Patched never-policy sandbox escalation guard.\n' : 'Never-policy sandbox escalation guard already applied.\n')
  process.stdout.write(pwshLocalChanged ? 'Patched Read Only PowerShell startup preamble.\n' : 'Read Only PowerShell startup preamble already applied.\n')
  process.stdout.write(toolPwshChanged ? 'Patched confined PowerShell workdir mapping.\n' : 'Confined PowerShell workdir mapping already applied.\n')
  process.stdout.write(pwshSandboxChanged || bashSandboxChanged ? 'Patched confined nested-pipe denial classification.\n' : 'Confined nested-pipe denial classification already applied.\n')
  process.stdout.write(windowsAclChanged ? 'Patched Windows ACL token-default DACL intersection.\n' : 'Windows ACL token-default DACL intersection already applied.\n')
  process.stdout.write(modelSelectionChanged ? 'Patched reasoning effort slider.\n' : 'Reasoning effort slider already applied.\n')
  process.stdout.write(modelSettingsChanged ? 'Patched safe model API-key overrides and provider validation.\n' : 'Safe model API-key overrides and provider validation already applied.\n')
  process.stdout.write(deepSeekDiscoveryChanged ? 'Patched DeepSeek credential validation discovery.\n' : 'DeepSeek credential validation discovery already applied.\n')
  process.stdout.write(targetsAlpha2 ? (workspaceUiChanged ? 'Patched alpha.2 force-new workspace session behavior; native session menus retained.\n' : 'Alpha.2 force-new workspace session patch already applied; native session menus retained.\n') : (workspaceUiChanged ? 'Patched Codex-style session menus.\n' : 'Codex-style session menus already applied.\n'))
  process.stdout.write(sessionPersistenceChanged ? 'Patched bounded concurrent session metadata listing.\n' : 'Bounded concurrent session metadata listing already applied.\n')
  process.stdout.write(targetsAlpha2 ? 'Verified native alpha.2 Session list metadata and bounded cold-summary batching.\n' : (hostApiProxyChanged ? 'Patched live session-list metadata projection reuse.\n' : 'Live session-list metadata projection reuse already applied.\n'))
  process.stdout.write(fsSearchChanged ? 'Patched search exit-2 recovery guidance.\n' : 'Search exit-2 recovery guidance already applied.\n')
  process.stdout.write(toolFsChanged ? 'Patched literal edit not-found recovery guidance.\n' : 'Literal edit not-found recovery guidance already applied.\n')
  process.stdout.write(subprocessChanged ? 'Patched hidden Windows command and cleanup processes.\n' : 'Hidden Windows command and cleanup process patch already applied.\n')
  process.stdout.write(webAppChanged ? 'Patched hidden browser launcher process.\n' : 'Hidden browser launcher process patch already applied.\n')
  process.stdout.write(codexParityChanged.changed ? 'Patched Codex-style $ skill discovery and invocation.\n' : 'Codex-style $ skill discovery and invocation already applied.\n')
}
