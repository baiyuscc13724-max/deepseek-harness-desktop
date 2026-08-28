const RESULT_TEXT_ORIGINAL = `		function resultText(node) {
			const parts = [];
			for (const block of node.content) if (block.type === "text") parts.push(block.text);
			else parts.push(JSON.stringify(block, null, 2));
			if (parts.length === 0 && node.error !== void 0) parts.push(\`${'${node.error.name}'}: ${'${node.error.code}'}\`);
			return parts.join("\\n");
		}`

const RESULT_TEXT_PATCHED = `		function resultText(node) {
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

const TOOL_CALL_SIGNATURE_ORIGINAL = 'const ToolCall = (0, react.memo)(function ToolCall({ renderSlot, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children }) {'
const TOOL_CALL_SIGNATURE_PATCHED = 'const ToolCall = (0, react.memo)(function ToolCall({ renderSlot, renderMessageImages, callId, toolName, block, openFile, selected, cwd, home, inspectCall, t, children }) {'

const TOOL_CALL_IMAGES_ORIGINAL = `			return (0, react_jsx_runtime.jsxs)("div", {
				className: ToolCallTree_module_css_default.callRow,`
const TOOL_CALL_IMAGES_PATCHED = `			const images = resultImages(block);
			return (0, react_jsx_runtime.jsxs)("div", {
				className: ToolCallTree_module_css_default.callRow,`

const TOOL_CALL_CHILDREN_ORIGINAL = `				}), children]
			});`
const TOOL_CALL_CHILDREN_PATCHED = `				}), images.length > 0 ? renderMessageImages({
					images,
					align: "start"
				}) : null, children]
			});`

const BRANCH_SIGNATURE_ORIGINAL = 'const ToolCallBranch = (0, react.memo)(function ToolCallBranch({ renderSlot, block, selectedCallId, cwd, home, openFile, inspectCall, t }) {'
const BRANCH_SIGNATURE_PATCHED = 'const ToolCallBranch = (0, react.memo)(function ToolCallBranch({ renderSlot, renderMessageImages, block, selectedCallId, cwd, home, openFile, inspectCall, t }) {'

const BRANCH_ROOT_PROP_ORIGINAL = `			return (0, react_jsx_runtime.jsx)(ToolCall, {
				renderSlot,
				callId: block.callId,`
const BRANCH_ROOT_PROP_PATCHED = `			return (0, react_jsx_runtime.jsx)(ToolCall, {
				renderSlot,
				renderMessageImages,
				callId: block.callId,`

const BRANCH_CHILD_PROP_ORIGINAL = `					children: block.subCalls.map((child) => (0, react_jsx_runtime.jsx)(ToolCallBranch, {
						renderSlot,
						block: child,`
const BRANCH_CHILD_PROP_PATCHED = `					children: block.subCalls.map((child) => (0, react_jsx_runtime.jsx)(ToolCallBranch, {
						renderSlot,
						renderMessageImages,
						block: child,`

const TREE_SIGNATURE_ORIGINAL = 'function ToolCallTree({ renderSlot, node, selectedCallId, cwd, openFile, inspectCall, useHostDescription, t }) {'
const TREE_SIGNATURE_PATCHED = 'function ToolCallTree({ renderSlot, renderMessageImages, node, selectedCallId, cwd, openFile, inspectCall, useHostDescription, t }) {'

const TREE_ROOT_PROP_ORIGINAL = `			return (0, react_jsx_runtime.jsx)(ToolCallBranch, {
				renderSlot,
				block,`
const TREE_ROOT_PROP_PATCHED = `			return (0, react_jsx_runtime.jsx)(ToolCallBranch, {
				renderSlot,
				renderMessageImages,
				block,`

const REPLACEMENTS = [
  [RESULT_TEXT_ORIGINAL, RESULT_TEXT_PATCHED, 'result content projection'],
  [TOOL_CALL_SIGNATURE_ORIGINAL, TOOL_CALL_SIGNATURE_PATCHED, 'tool call image renderer input'],
  [TOOL_CALL_IMAGES_ORIGINAL, TOOL_CALL_IMAGES_PATCHED, 'tool result image collection'],
  [TOOL_CALL_CHILDREN_ORIGINAL, TOOL_CALL_CHILDREN_PATCHED, 'tool result image rendering'],
  [BRANCH_SIGNATURE_ORIGINAL, BRANCH_SIGNATURE_PATCHED, 'tool branch image renderer input'],
  [BRANCH_ROOT_PROP_ORIGINAL, BRANCH_ROOT_PROP_PATCHED, 'tool branch image renderer forwarding'],
  [BRANCH_CHILD_PROP_ORIGINAL, BRANCH_CHILD_PROP_PATCHED, 'nested tool image renderer forwarding'],
  [TREE_SIGNATURE_ORIGINAL, TREE_SIGNATURE_PATCHED, 'tool tree image renderer input'],
  [TREE_ROOT_PROP_ORIGINAL, TREE_ROOT_PROP_PATCHED, 'tool tree image renderer forwarding']
]

const COMPLETE_MARKERS = REPLACEMENTS.map(([, patched]) => patched)
const OFFICIAL_COMPLETE_MARKERS = [
  'else if (block.type !== "image") parts.push(JSON.stringify(block, null, 2));',
  'function resultImages(block) {',
  'const images = resultImages(block);',
  'images.length > 0 ? renderMessageImages({',
  'function ToolCallBranch({ renderSlot, renderMessageImages,',
  'function ToolCallTree({ renderSlot, renderMessageImages,'
]

/**
 * Patch the pinned official Tool UI so durable ImageBlocks in tool results are
 * rendered through the Conversation-owned attachment loader instead of being
 * flattened to JSON metadata inside the generic tool card.
 */
export function patchToolResultImageSource(source) {
  const officialPresent = OFFICIAL_COMPLETE_MARKERS.filter(marker => source.includes(marker))
  if (officialPresent.length === OFFICIAL_COMPLETE_MARKERS.length) return { source, changed: false }
  if (officialPresent.length > 0) {
    throw new Error('Pinned DSH official tool-result image delivery patch is incomplete; refusing an unsafe repair.')
  }
  const present = COMPLETE_MARKERS.filter(marker => source.includes(marker))
  if (present.length > 0 && present.length < COMPLETE_MARKERS.length) {
    throw new Error('Pinned DSH tool-result image delivery patch is incomplete; refusing an unsafe repair.')
  }
  if (present.length === COMPLETE_MARKERS.length) return { source, changed: false }

  let output = source
  for (const [original, patched, label] of REPLACEMENTS) {
    if (!output.includes(original)) {
      throw new Error(`Pinned DSH ${label} changed; refusing an unsafe tool-result image delivery patch.`)
    }
    output = output.replace(original, patched)
  }
  return { source: output, changed: true }
}
