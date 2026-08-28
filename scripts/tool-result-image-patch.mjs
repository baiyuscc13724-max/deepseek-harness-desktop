const RESULT_TEXT_ORIGINAL = `		function resultText(node) {
			const parts = [];
			for (const block of node.content) if (block.type === "text") parts.push(block.text);
			else parts.push(JSON.stringify(block, null, 2));
			if (parts.length === 0 && node.error !== void 0) parts.push(\`${'${node.error.name}'}: ${'${node.error.code}'}\`);
			return parts.join("\\n");
		}`

const RESULT_TEXT_LEGACY = `		function resultText(node) {
			const parts = [];
			for (const block of node.content) if (block.type === "text") parts.push(block.text);
			else if (block.type !== "image") parts.push(JSON.stringify(block, null, 2));
			if (parts.length === 0 && node.error !== void 0) parts.push(\`${'${node.error.name}'}: ${'${node.error.code}'}\`);
			return parts.join("\\n");
		}
		/** Preserve durable tool-result images as user-visible chat attachments. */
		function resultImages(block) {
			if (!("kind" in block)) return [];
			return block.content.filter((item) => item.type === "image").map(({ attachment }) => ({ attachment }));
		}`

const RESULT_TEXT_PATCHED = `		function resultText(node) {
			const parts = [];
			for (const block of node.content) if (block.type === "text") parts.push(block.text);
			else if (block.type !== "image") parts.push(JSON.stringify(block, null, 2));
			if (parts.length === 0 && node.error !== void 0) parts.push(\`${'${node.error.name}'}: ${'${node.error.code}'}\`);
			return parts.join("\\n");
		}
		/** Preserve only core durable image blocks; malformed and extension blocks fail closed. */
		function resultImages(block) {
			if (!("kind" in block)) return [];
			return block.content.filter((item) => item?.type === "image" && item.attachment !== void 0).map(({ attachment }) => ({ attachment }));
		}
		const RESULT_PATH_KEYS = /* @__PURE__ */ new Set([
			"path", "paths", "file", "files", "local_path", "local_paths", "local_file", "local_files", "local_delivery",
			"local_log_paths", "local_screenshot_paths", "output_path", "output_paths", "workspace_path", "workspace_paths",
			"workspace_image_path", "workspace_video_path", "workspace_last_frame_path"
		]);
		const RESULT_IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".webp"]);
		const RESULT_AUDIO_EXTENSIONS = /* @__PURE__ */ new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav"]);
		const RESULT_VIDEO_EXTENSIONS = /* @__PURE__ */ new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);
		const RESULT_ACTIVE_EXTENSIONS = /* @__PURE__ */ new Set([
			".apk", ".app", ".appimage", ".appref-ms", ".bat", ".cmd", ".com", ".cpl", ".deb", ".dmg", ".exe", ".hta", ".inf", ".ins", ".ipa",
			".isp", ".jar", ".js", ".jse", ".lnk", ".msc", ".msi", ".msp", ".mst", ".pif", ".pkg", ".ps1", ".reg", ".rpm", ".scr", ".sct",
			".url", ".vb", ".vbe", ".vbs", ".ws", ".wsc", ".wsf", ".wsh", ".xpi"
		]);
		function normalizedResultPath(value, cwd) {
			if (typeof value !== "string") return;
			const authored = value.trim();
			if (authored === "" || authored.length > 4096 || /[\\u0000\\r\\n<>"|?*]/u.test(authored) || /^(?:[a-z][a-z0-9+.-]*:)?\\/\\//iu.test(authored) || authored.startsWith("~")) return;
			const candidate = authored.replace(/\\\\/gu, "/");
			const windowsAbsolute = /^[a-z]:\\//iu.test(candidate);
			const absolute = windowsAbsolute || candidate.startsWith("/");
			if ((windowsAbsolute ? candidate.slice(2) : candidate).includes(":")) return;
			const parts = candidate.split("/");
			if (parts.some((part) => part === "..")) return;
			if (absolute) {
				if (typeof cwd !== "string" || cwd === "") return;
				const root = cwd.replace(/\\\\/gu, "/").replace(/\\/+$/u, "");
				const windows = /^[a-z]:\\//iu.test(candidate);
				const comparedCandidate = windows ? candidate.toLowerCase() : candidate;
				const comparedRoot = windows ? root.toLowerCase() : root;
				if (comparedCandidate !== comparedRoot && !comparedCandidate.startsWith(comparedRoot + "/")) return;
			}
			const name = parts.at(-1) ?? "";
			if (name === "" || name === "." || name === "..") return;
			const lowerName = name.toLowerCase();
			const extensionAt = lowerName.lastIndexOf(".");
			let extension = "";
			if (extensionAt > 0) {
				extension = lowerName.slice(extensionAt);
				if (extension.length > 17 || !/^\\.[a-z0-9][a-z0-9_-]*$/u.test(extension)) return;
			}
			const active = RESULT_ACTIVE_EXTENSIONS.has(extension) || [...RESULT_ACTIVE_EXTENSIONS].some((suffix) => lowerName.endsWith(suffix));
			const kind = RESULT_IMAGE_EXTENSIONS.has(extension) ? "image" : RESULT_AUDIO_EXTENSIONS.has(extension) ? "audio" : RESULT_VIDEO_EXTENSIONS.has(extension) ? "video" : active ? "active" : "file";
			return { path: candidate, name, kind };
		}
		/** Extract explicit local deliverables only from a complete JSON result. */
		function resultFiles(block, cwd) {
			if (!("kind" in block)) return [];
			const files = [];
			const seen = /* @__PURE__ */ new Set();
			let visits = 0;
			const add = (value) => {
				const file = normalizedResultPath(value, cwd);
				if (file === void 0 || seen.has(file.path)) return;
				seen.add(file.path);
				files.push(file);
			};
			const visit = (value, key, depth) => {
				if (depth > 8 || ++visits > 256) return;
				if (typeof value === "string") {
					if (RESULT_PATH_KEYS.has(key)) add(value);
					return;
				}
				if (Array.isArray(value)) {
					if (key !== "" && !RESULT_PATH_KEYS.has(key)) return;
					for (const item of value) visit(item, key, depth + 1);
					return;
				}
				if (typeof value !== "object" || value === null) return;
				for (const [childKey, child] of Object.entries(value)) visit(child, childKey, depth + 1);
			};
			for (const content of block.content) {
				if (content?.type !== "text" || typeof content.text !== "string") continue;
				let encoded = content.text.trim();
				const fence = encoded.match(/^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/iu);
				if (fence !== null) encoded = fence[1];
				if (!/^[{[]/u.test(encoded)) continue;
				try { visit(JSON.parse(encoded), "", 0); } catch {}
			}
			return files;
		}
		function resultFileUrl(sessionId, file, route) {
			return \`/api/desktop-files/${'${route}'}?sessionId=${'${encodeURIComponent(sessionId)}'}&path=${'${encodeURIComponent(file.path)}'}\`;
		}
		/** Render same-origin media and attachment-only downloads; never invoke local files. */
		function ResultDeliverables({ files, sessionId }) {
			if (files.length === 0 || typeof sessionId !== "string" || sessionId === "") return null;
			return (0, react_jsx_runtime.jsx)("div", {
				"data-tool-result-deliverables": true,
				style: { display: "grid", gap: 8, marginTop: 8, maxWidth: 640 },
				children: files.map((file) => {
					const downloadUrl = resultFileUrl(sessionId, file, "download");
					const location = (0, react_jsx_runtime.jsx)("code", { style: { overflowWrap: "anywhere" }, children: file.path });
					const download = (0, react_jsx_runtime.jsx)("a", { href: downloadUrl, download: file.name, children: file.kind === "active" ? \`仅下载（不会执行）：${'${file.name}'}\` : \`下载：${'${file.name}'}\` });
					if (file.kind === "image") return (0, react_jsx_runtime.jsxs)("figure", { style: { margin: 0 }, children: [(0, react_jsx_runtime.jsx)("img", { src: resultFileUrl(sessionId, file, "content"), alt: file.name, loading: "lazy", style: { display: "block", maxWidth: "100%", maxHeight: 480, objectFit: "contain" } }), (0, react_jsx_runtime.jsxs)("figcaption", { style: { display: "grid", gap: 4 }, children: [download, location] })] }, file.path);
					if (file.kind === "audio") return (0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 4 }, children: [(0, react_jsx_runtime.jsx)("audio", { src: resultFileUrl(sessionId, file, "content"), controls: true, preload: "metadata", style: { display: "block", width: "100%" } }), download, location] }, file.path);
					if (file.kind === "video") return (0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 4 }, children: [(0, react_jsx_runtime.jsx)("video", { src: resultFileUrl(sessionId, file, "content"), controls: true, preload: "metadata", style: { display: "block", maxWidth: "100%", maxHeight: 480 } }), download, location] }, file.path);
					return (0, react_jsx_runtime.jsxs)("div", { style: { display: "grid", gap: 4 }, "data-download-only": file.kind === "active" || void 0, children: [download, location] }, file.path);
				})
			});
		}`

const TOOL_CALL_SIGNATURE_ORIGINAL = 'const ToolCall = (0, react.memo)(function ToolCall({ renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children }) {'
const TOOL_CALL_SIGNATURE_LEGACY = 'const ToolCall = (0, react.memo)(function ToolCall({ renderSlot, renderMessageImages, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children }) {'
const TOOL_CALL_SIGNATURE_PATCHED = 'const ToolCall = (0, react.memo)(function ToolCall({ renderSlot, renderMessageImages, sessionId, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children }) {'

const TOOL_CALL_IMAGES_ORIGINAL = `			return (0, react_jsx_runtime.jsxs)("div", {
				className: ToolCallTree_module_css_default.callRow,`
const TOOL_CALL_IMAGES_LEGACY = `			const images = resultImages(block);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ToolCallTree_module_css_default.callRow,`
const TOOL_CALL_IMAGES_PATCHED = `			const images = resultImages(block);
			const files = resultFiles(block, cwd);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ToolCallTree_module_css_default.callRow,`

const TOOL_CALL_CHILDREN_ORIGINAL = `				}), children]
			});`
const TOOL_CALL_CHILDREN_LEGACY = `				}), images.length > 0 ? renderMessageImages({
					images,
					align: "start"
				}) : null, children]
			});`
const TOOL_CALL_CHILDREN_PATCHED = `				}), images.length > 0 ? renderMessageImages({
					images,
					align: "start"
				}) : null, (0, react_jsx_runtime.jsx)(ResultDeliverables, { files, sessionId }), children]
			});`

const PROP_REPLACEMENTS = [
  ['const ToolCallBranch = (0, react.memo)(function ToolCallBranch({ renderSlot, block,', 'const ToolCallBranch = (0, react.memo)(function ToolCallBranch({ renderSlot, renderMessageImages, sessionId, block,', 'tool branch delivery inputs'],
  ['const ToolCallBranch = (0, react.memo)(function ToolCallBranch({ renderSlot, renderMessageImages, block,', 'const ToolCallBranch = (0, react.memo)(function ToolCallBranch({ renderSlot, renderMessageImages, sessionId, block,', 'tool branch delivery inputs'],
  ['function ToolCallTree({ renderSlot, node,', 'function ToolCallTree({ renderSlot, renderMessageImages, sessionId, node,', 'tool tree delivery inputs'],
  ['function ToolCallTree({ renderSlot, renderMessageImages, node,', 'function ToolCallTree({ renderSlot, renderMessageImages, sessionId, node,', 'tool tree delivery inputs']
]

const FORWARDING_REPLACEMENTS = [
  [`			return (0, react_jsx_runtime.jsx)(ToolCall, {
				renderSlot,
				callId: block.callId,`, `			return (0, react_jsx_runtime.jsx)(ToolCall, {
				renderSlot,
				renderMessageImages,
				sessionId,
				callId: block.callId,`, 'tool branch delivery forwarding'],
  [`			return (0, react_jsx_runtime.jsx)(ToolCall, {
				renderSlot,
				renderMessageImages,
				callId: block.callId,`, `			return (0, react_jsx_runtime.jsx)(ToolCall, {
				renderSlot,
				renderMessageImages,
				sessionId,
				callId: block.callId,`, 'tool branch delivery forwarding'],
  [`					children: block.subCalls.map((child) => (0, react_jsx_runtime.jsx)(ToolCallBranch, {
						renderSlot,
						block: child,`, `					children: block.subCalls.map((child) => (0, react_jsx_runtime.jsx)(ToolCallBranch, {
						renderSlot,
						renderMessageImages,
						sessionId,
						block: child,`, 'nested tool delivery forwarding'],
  [`					children: block.subCalls.map((child) => (0, react_jsx_runtime.jsx)(ToolCallBranch, {
						renderSlot,
						renderMessageImages,
						block: child,`, `					children: block.subCalls.map((child) => (0, react_jsx_runtime.jsx)(ToolCallBranch, {
						renderSlot,
						renderMessageImages,
						sessionId,
						block: child,`, 'nested tool delivery forwarding'],
  [`			return (0, react_jsx_runtime.jsx)(ToolCallBranch, {
				renderSlot,
				block,`, `			return (0, react_jsx_runtime.jsx)(ToolCallBranch, {
				renderSlot,
				renderMessageImages,
				sessionId,
				block,`, 'tool tree delivery forwarding'],
  [`			return (0, react_jsx_runtime.jsx)(ToolCallBranch, {
				renderSlot,
				renderMessageImages,
				block,`, `			return (0, react_jsx_runtime.jsx)(ToolCallBranch, {
				renderSlot,
				renderMessageImages,
				sessionId,
				block,`, 'tool tree delivery forwarding']
]

const FINAL_MARKERS = [RESULT_TEXT_PATCHED, TOOL_CALL_SIGNATURE_PATCHED, TOOL_CALL_IMAGES_PATCHED, TOOL_CALL_CHILDREN_PATCHED,
  'ToolCallBranch({ renderSlot, renderMessageImages, sessionId, block,', 'ToolCallTree({ renderSlot, renderMessageImages, sessionId, node,',
  '\n\t\t\t\trenderMessageImages,\n\t\t\t\tsessionId,\n\t\t\t\tcallId:', '\n\t\t\t\t\t\trenderMessageImages,\n\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\tblock: child,',
  '\n\t\t\t\trenderMessageImages,\n\t\t\t\tsessionId,\n\t\t\t\tblock,'
]

function replaceOneOf(source, originals, patched, label) {
  if (source.includes(patched)) return source
  for (const original of originals) if (source.includes(original)) return source.replace(original, patched)
  throw new Error(`Pinned DSH ${label} changed; refusing an unsafe tool-result delivery patch.`)
}

/** Patch the pinned official Tool UI with durable media and safe file delivery. */
export function patchToolResultImageSource(source) {
  const present = FINAL_MARKERS.filter(marker => source.includes(marker))
  if (present.length > 0 && present.length < FINAL_MARKERS.length) throw new Error('Pinned DSH tool-result delivery patch is incomplete; refusing an unsafe repair.')
  if (present.length === FINAL_MARKERS.length) return { source, changed: false }

  let output = replaceOneOf(source, [RESULT_TEXT_LEGACY, RESULT_TEXT_ORIGINAL], RESULT_TEXT_PATCHED, 'result content projection')
  output = replaceOneOf(output, [TOOL_CALL_SIGNATURE_LEGACY, TOOL_CALL_SIGNATURE_ORIGINAL], TOOL_CALL_SIGNATURE_PATCHED, 'tool call delivery inputs')
  output = replaceOneOf(output, [TOOL_CALL_IMAGES_LEGACY, TOOL_CALL_IMAGES_ORIGINAL], TOOL_CALL_IMAGES_PATCHED, 'tool result delivery collection')
  output = replaceOneOf(output, [TOOL_CALL_CHILDREN_LEGACY, TOOL_CALL_CHILDREN_ORIGINAL], TOOL_CALL_CHILDREN_PATCHED, 'tool result delivery rendering')
  for (let index = 0; index < PROP_REPLACEMENTS.length; index += 2) {
    const [original, patched, label] = PROP_REPLACEMENTS[index]
    const [legacy] = PROP_REPLACEMENTS[index + 1]
    output = replaceOneOf(output, [legacy, original], patched, label)
  }
  for (let index = 0; index < FORWARDING_REPLACEMENTS.length; index += 2) {
    const [original, patched, label] = FORWARDING_REPLACEMENTS[index]
    const [legacy] = FORWARDING_REPLACEMENTS[index + 1]
    output = replaceOneOf(output, [legacy, original], patched, label)
  }
  return { source: output, changed: true }
}

const COMMON_OWNER_REPLACEMENTS = [
  ['const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, selectedCallId,', 'const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, sessionId, selectedCallId,', 'chat node session input'],
  [`			const owner = (0, react.useMemo)(() => node === void 0 ? null : {
				selectedCallId,`, `			const owner = (0, react.useMemo)(() => node === void 0 ? null : {
				sessionId,
				selectedCallId,`, 'chat node session owner'],
  [`			}, [
				node,
				selectedCallId,`, `			}, [
				node,
				sessionId,
				selectedCallId,`, 'chat node session dependency']
]

const GROUPED_OWNER_REPLACEMENTS = [
  ['const ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, useSession,', 'const ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, sessionId, useSession,', 'work tree session input'],
  [`					children: item.nodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
						nodeKey,
						useSession,`, `					children: item.nodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
						nodeKey,
						sessionId,
						useSession,`, 'nested chat node session forwarding'],
  [`							buildConversationWorkTreeItems(order, nodeStore).map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
								item,
								useSession,`, `							buildConversationWorkTreeItems(order, nodeStore).map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
								item,
								sessionId,
								useSession,`, 'work tree session forwarding'],
  [`							}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
								nodeKey: item.nodeKey,
								useSession,`, `							}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
								nodeKey: item.nodeKey,
								sessionId,
								useSession,`, 'root chat node session forwarding']
]

const FLAT_OWNER_REPLACEMENTS = [
  [`							order.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
								nodeKey,
								useSession,`, `							order.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
								nodeKey,
								sessionId,
								useSession,`, 'flat chat node session forwarding']
]

const COMMON_OWNER_MARKERS = COMMON_OWNER_REPLACEMENTS.map(([, patched]) => patched)
const GROUPED_OWNER_MARKERS = GROUPED_OWNER_REPLACEMENTS.map(([, patched]) => patched)
const FLAT_OWNER_MARKERS = FLAT_OWNER_REPLACEMENTS.map(([, patched]) => patched)

/** Thread the authenticated session id through either official chat-tree shape. */
export function patchToolResultOwnerSource(source) {
  const countPresent = markers => markers.filter(marker => source.includes(marker)).length
  const commonPresent = countPresent(COMMON_OWNER_MARKERS)
  const groupedPresent = countPresent(GROUPED_OWNER_MARKERS)
  const flatPresent = countPresent(FLAT_OWNER_MARKERS)
  const commonComplete = commonPresent === COMMON_OWNER_MARKERS.length
  const groupedComplete = groupedPresent === GROUPED_OWNER_MARKERS.length
  const flatComplete = flatPresent === FLAT_OWNER_MARKERS.length
  if (commonComplete && (groupedComplete || flatComplete)) return { source, changed: false }
  if (commonPresent + groupedPresent + flatPresent > 0) throw new Error('Pinned DSH tool-result owner patch is incomplete; refusing an unsafe repair.')

  let output = source
  for (const [original, patched, label] of COMMON_OWNER_REPLACEMENTS) output = replaceOneOf(output, [original], patched, label)
  const groupedSource = GROUPED_OWNER_REPLACEMENTS.some(([original, patched]) => source.includes(original) || source.includes(patched))
  const variant = groupedSource ? GROUPED_OWNER_REPLACEMENTS : FLAT_OWNER_REPLACEMENTS
  for (const [original, patched, label] of variant) output = replaceOneOf(output, [original], patched, label)
  return { source: output, changed: true }
}
