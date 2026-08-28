const PATCH_MARKER = 'conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1"'
const FLOW_PATCH_MARKER = 'conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2"'
const MANUAL_PATCH_MARKER = 'conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3"'
const RECOVERABLE_PATCH_MARKER = 'conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4"'

const WORK_TREE_CSS = ".hd-work-tree{min-width:0;border-radius:10px}.hd-work-tree-toggle{box-sizing:border-box;width:100%;min-height:44px;border:0;border-radius:9px;padding:0 10px;color:var(--dsw-alias-label-secondary);background:transparent;align-items:center;gap:8px;font:inherit;text-align:left;cursor:pointer;display:flex;transition:color .14s ease,background-color .14s ease}.hd-work-tree-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hd-work-tree-toggle:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 68%,transparent);outline-offset:2px}.hd-work-tree-chevron{width:16px;height:16px;flex:none;place-items:center;display:grid}.hd-work-tree-title{color:var(--dsw-alias-label-primary-dimmed);font-size:14px;font-weight:600;line-height:20px}.hd-work-tree-count{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;overflow:hidden}.hd-work-tree-status{color:var(--dsw-alias-label-tertiary);white-space:nowrap;align-items:center;gap:6px;margin-left:auto;font-size:12px;line-height:18px;display:inline-flex}.hd-work-tree-status:before{content:\"\";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}.hd-work-tree[data-state=running] .hd-work-tree-toggle{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent)}.hd-work-tree[data-state=running] .hd-work-tree-status{color:var(--dsw-alias-brand-primary)}.hd-work-tree[data-state=error] .hd-work-tree-status{color:var(--dsw-alias-state-error-primary)}.hd-work-tree[data-state=stopped] .hd-work-tree-status{color:var(--dsw-alias-state-warning-primary)}.hd-work-tree-body{position:relative;flex-direction:column;gap:8px;margin:2px 0 6px 20px;padding:0 0 4px 18px;display:flex}.hd-work-tree-body:before{content:\"\";position:absolute;top:0;bottom:8px;left:0;width:1px;background:var(--dsw-alias-border-l2)}.hd-work-tree-body[hidden]{display:none}.hd-work-tree-body>[data-chat-flow-key]{position:relative}.hd-work-tree-body>[data-chat-flow-key]:before{content:\"\";position:absolute;top:12px;left:-18px;width:10px;height:1px;background:var(--dsw-alias-border-l2)}@media(max-width:620px){.hd-work-tree-toggle{padding-inline:6px}.hd-work-tree-body{margin-left:16px;padding-left:14px}.hd-work-tree-body>[data-chat-flow-key]:before{left:-14px;width:8px}}.hd-work-tree[data-open] .hd-work-tree-toggle{position:sticky;top:8px;z-index:5;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-base) 92%,transparent);box-shadow:0 6px 18px color-mix(in srgb,#000 12%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.06);backdrop-filter:blur(14px) saturate(1.06)}.hd-work-tree[data-open] .hd-work-tree-body>[data-chat-flow-key]{scroll-margin-top:64px}@media(max-width:620px){.hd-work-tree[data-open] .hd-work-tree-toggle{top:6px}}@media(prefers-reduced-motion:reduce){.hd-work-tree-toggle{transition:none}}"

const STYLE_ANCHOR = '\t\tconst tagId$11 = "@deepseek-ai/dsh-client-ui-conversation/ChatView.module.css";'
const STYLE_PATCH = `\t\tconst conversationWorkTreeCss = ${JSON.stringify(WORK_TREE_CSS)};
\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";
\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";
\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";
\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";
\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";
\t\tif (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(conversationWorkTreeMarker) + "]") === null) {
\t\t\tconst conversationWorkTreeTag = document.createElement("style");
\t\t\tconversationWorkTreeTag.dataset.plugin = "harness-desktop";
\t\t\tconversationWorkTreeTag.dataset.pluginCss = conversationWorkTreeMarker;
\t\t\tconversationWorkTreeTag.textContent = conversationWorkTreeCss;
\t\t\tdocument.head.appendChild(conversationWorkTreeTag);
\t\t}
${STYLE_ANCHOR}`

function conversationTurnId(node) {
  const location = node?.location
  if (location?.kind !== 'turn' && location?.kind !== 'step') return null
  const turn = location.turn?.turn
  return typeof turn === 'number' && Number.isFinite(turn) ? turn : null
}

function conversationAssistantHasReply(node) {
  if (node?.kind !== 'assistant-step' || !Array.isArray(node.data?.blocks)) return false
  return node.data.blocks.some(block => block?.kind === 'image' || block?.kind === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
}

function conversationToolRootStats(root) {
  if (root === null || typeof root !== 'object') return { count: 0, active: false, failed: false, stopped: false, callIds: [] }
  const settled = 'kind' in root
  const stopped = settled && root.error?.code === 'interrupted'
  const recoverable = settled && root.call?.name === 'edit' && ['FS_EDIT_NOT_FOUND', 'FS_STALE_VERSION', 'FS_NOT_OBSERVED'].includes(root.error?.code)
  const own = {
    count: 1,
    active: !settled,
    failed: settled && root.isError === true && !stopped && !recoverable,
    stopped,
    callIds: typeof root.callId === 'string' ? [root.callId] : []
  }
  for (const child of Array.isArray(root.subCalls) ? root.subCalls : []) {
    const nested = conversationToolRootStats(child)
    own.count += nested.count
    own.active ||= nested.active
    own.failed ||= nested.failed
    own.stopped ||= nested.stopped
    own.callIds.push(...nested.callIds)
  }
  return own
}

function preRecoverableConversationToolRootStats(root) {
  if (root === null || typeof root !== 'object') return { count: 0, active: false, failed: false, stopped: false, callIds: [] }
  const settled = 'kind' in root
  const stopped = settled && root.error?.code === 'interrupted'
  const own = {
    count: 1,
    active: !settled,
    failed: settled && root.isError === true && !stopped,
    stopped,
    callIds: typeof root.callId === 'string' ? [root.callId] : []
  }
  for (const child of Array.isArray(root.subCalls) ? root.subCalls : []) {
    const nested = preRecoverableConversationToolRootStats(child)
    own.count += nested.count
    own.active ||= nested.active
    own.failed ||= nested.failed
    own.stopped ||= nested.stopped
    own.callIds.push(...nested.callIds)
  }
  return own
}

function conversationWorkNodeStats(node) {
  if (node?.kind === 'tool-call') return conversationToolRootStats(node.data?.root)
  const status = node?.kind === 'assistant-step' ? node.data?.status : null
  return {
    count: 1,
    active: status === 'running',
    failed: false,
    stopped: status === 'interrupted',
    callIds: []
  }
}

function conversationIsWorkNode(node, nodeKey, finalReplyByTurn) {
  const turn = conversationTurnId(node)
  if (node?.kind === 'tool-call') return true
  if (node?.kind === 'assistant-step') return turn !== null && finalReplyByTurn.get(turn) !== nodeKey
  return node?.kind === 'context' || node?.kind === 'compaction' || node?.kind === 'manual-compaction' || node?.kind === 'model-retry' || node?.kind === 'unknown'
}

function preFlowBuildConversationWorkTreeItems(order, nodeStore) {
  const conversationUnscopedWorkTrees = true
  const finalReplyByTurn = new Map()
  for (const nodeKey of order) {
    const node = nodeStore.get(nodeKey)
    const turn = conversationTurnId(node)
    if (turn !== null && conversationAssistantHasReply(node)) finalReplyByTurn.set(turn, nodeKey)
  }

  const workByGroup = new Map()
  const workKeyToGroup = new Map()
  let lastSeenTurn = null
  for (const nodeKey of order) {
    const node = nodeStore.get(nodeKey)
    const turn = conversationTurnId(node)
    if (turn !== null) lastSeenTurn = turn
    if (!conversationIsWorkNode(node, nodeKey, finalReplyByTurn)) continue
    const logicalTurn = turn ?? lastSeenTurn
    const groupId = logicalTurn === null ? 'session' : `turn:${logicalTurn}`
    let group = workByGroup.get(groupId)
    if (group === undefined) {
      group = {
        kind: 'work-tree',
        key: `work-tree:${groupId}:${nodeKey}`,
        turn: logicalTurn,
        nodeKeys: [],
        count: 0,
        active: false,
        failed: false,
        stopped: false,
        callIds: []
      }
      workByGroup.set(groupId, group)
    }
    group.nodeKeys.push(nodeKey)
    workKeyToGroup.set(nodeKey, groupId)
    const stats = conversationWorkNodeStats(node)
    group.count += stats.count
    group.active ||= stats.active || node?.location?.turn?.status === 'open'
    group.failed ||= stats.failed
    group.stopped ||= stats.stopped
    group.callIds.push(...stats.callIds)
  }

  const emittedGroups = new Set()
  const items = []
  for (const nodeKey of order) {
    const groupId = workKeyToGroup.get(nodeKey)
    if (groupId === undefined) {
      items.push({ kind: 'node', key: nodeKey, nodeKey })
      continue
    }
    if (emittedGroups.has(groupId)) continue
    emittedGroups.add(groupId)
    items.push(workByGroup.get(groupId))
  }
  void conversationUnscopedWorkTrees
  return items
}

export function buildConversationWorkTreeItems(order, nodeStore) {
  const conversationUnscopedWorkTrees = true
  const finalReplyByTurn = new Map()
  for (const nodeKey of order) {
    const node = nodeStore.get(nodeKey)
    const turn = conversationTurnId(node)
    if (turn !== null && conversationAssistantHasReply(node)) finalReplyByTurn.set(turn, nodeKey)
  }

  const items = []
  let group = null
  for (const nodeKey of order) {
    const node = nodeStore.get(nodeKey)
    if (!conversationIsWorkNode(node, nodeKey, finalReplyByTurn)) {
      items.push({ kind: 'node', key: nodeKey, nodeKey })
      group = null
      continue
    }
    const turn = conversationTurnId(node)
    if (group === null) {
      group = {
        kind: 'work-tree',
        key: `work-tree:flow:${nodeKey}`,
        turn,
        nodeKeys: [],
        count: 0,
        active: false,
        failed: false,
        stopped: false,
        callIds: []
      }
      items.push(group)
    } else if (group.turn === null && turn !== null) {
      group.turn = turn
    }
    group.nodeKeys.push(nodeKey)
    const stats = conversationWorkNodeStats(node)
    group.count += stats.count
    group.active ||= stats.active || node?.location?.turn?.status === 'open'
    group.failed ||= stats.failed
    group.stopped ||= stats.stopped
    group.callIds.push(...stats.callIds)
  }
  void conversationUnscopedWorkTrees
  return items
}

const legacyConversationIsWorkNode = function conversationIsWorkNode(node, nodeKey, finalReplyByTurn) {
  const turn = conversationTurnId(node)
  if (turn === null) return false
  if (node.kind === 'tool-call') return true
  if (node.kind === 'assistant-step') return finalReplyByTurn.get(turn) !== nodeKey
  return node.kind === 'context' || node.kind === 'compaction' || node.kind === 'manual-compaction' || node.kind === 'model-retry' || node.kind === 'unknown'
}

const legacyBuildConversationWorkTreeItems = function buildConversationWorkTreeItems(order, nodeStore) {
  const finalReplyByTurn = new Map()
  for (const nodeKey of order) {
    const node = nodeStore.get(nodeKey)
    const turn = conversationTurnId(node)
    if (turn !== null && conversationAssistantHasReply(node)) finalReplyByTurn.set(turn, nodeKey)
  }

  const workByTurn = new Map()
  const workKeyToTurn = new Map()
  for (const nodeKey of order) {
    const node = nodeStore.get(nodeKey)
    const turn = conversationTurnId(node)
    if (turn === null || !conversationIsWorkNode(node, nodeKey, finalReplyByTurn)) continue
    let group = workByTurn.get(turn)
    if (group === undefined) {
      group = {
        kind: 'work-tree',
        key: `work-tree:${turn}:${nodeKey}`,
        turn,
        nodeKeys: [],
        count: 0,
        active: false,
        failed: false,
        stopped: false,
        callIds: []
      }
      workByTurn.set(turn, group)
    }
    group.nodeKeys.push(nodeKey)
    workKeyToTurn.set(nodeKey, turn)
    const stats = conversationWorkNodeStats(node)
    group.count += stats.count
    group.active ||= stats.active || node?.location?.turn?.status === 'open'
    group.failed ||= stats.failed
    group.stopped ||= stats.stopped
    group.callIds.push(...stats.callIds)
  }

  const emittedTurns = new Set()
  const items = []
  for (const nodeKey of order) {
    const turn = workKeyToTurn.get(nodeKey)
    if (turn === undefined) {
      items.push({ kind: 'node', key: nodeKey, nodeKey })
      continue
    }
    if (emittedTurns.has(turn)) continue
    emittedTurns.add(turn)
    items.push(workByTurn.get(turn))
  }
  return items
}

function bundleFunctionSource(fn) {
  return fn.toString().split('\n').map(line => `\t\t${line}`).join('\n')
}

const LEGACY_WORK_NODE_SOURCE = bundleFunctionSource(legacyConversationIsWorkNode)
const LEGACY_WORK_TREE_ITEMS_SOURCE = bundleFunctionSource(legacyBuildConversationWorkTreeItems)
const PRE_FLOW_WORK_TREE_ITEMS_SOURCE = bundleFunctionSource(preFlowBuildConversationWorkTreeItems).replace('function preFlowBuildConversationWorkTreeItems', 'function buildConversationWorkTreeItems')
const WORK_NODE_SOURCE = bundleFunctionSource(conversationIsWorkNode)
const WORK_TREE_ITEMS_SOURCE = bundleFunctionSource(buildConversationWorkTreeItems)
const PRE_RECOVERABLE_TOOL_STATS_SOURCE = bundleFunctionSource(preRecoverableConversationToolRootStats).replaceAll('preRecoverableConversationToolRootStats', 'conversationToolRootStats')
const RECOVERABLE_TOOL_STATS_SOURCE = bundleFunctionSource(conversationToolRootStats)

const WORK_TREE_HELPERS = [
  conversationTurnId,
  conversationAssistantHasReply,
  conversationToolRootStats,
  conversationWorkNodeStats,
  conversationIsWorkNode,
  buildConversationWorkTreeItems
].map(bundleFunctionSource).join('\n')

const COMPONENT_ANCHOR = '\t\tfunction ChatView({ useSession, useSessions, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt, fileMentions, t }) {'
const COMPONENT_PATCH = `${WORK_TREE_HELPERS}
\t\tconst ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, useSession, selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions, renderSlot, t }) {
\t\t\tconst selected = selectedCallId !== void 0 && item.callIds.includes(selectedCallId);
\t\t\tconst [open, setOpen] = (0, react.useState)(item.active || selected);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (selected) setOpen(true);
\t\t\t}, [selected]);
\t\t\tconst state = item.active ? "running" : item.failed ? "error" : item.stopped ? "stopped" : "done";
\t\t\tconst status = t(\`workTree.status.\${state}\`);
\t\t\tconst count = t("workTree.steps", { count: item.count });
\t\t\tconst action = t(open ? "workTree.collapse" : "workTree.expand");
\t\t\treturn (0, react_jsx_runtime.jsxs)("section", {
\t\t\t\tclassName: "hd-work-tree",
\t\t\t\t"data-state": state,
\t\t\t\t"data-open": open || void 0,
\t\t\t\t"data-chat-anchor-key": item.key,
\t\t\t\t"data-chat-flow-key": item.key,
\t\t\t\t"data-chat-flow-kind": "work-tree",
\t\t\t\tchildren: [(0, react_jsx_runtime.jsxs)("button", {
\t\t\t\t\ttype: "button",
\t\t\t\t\tclassName: "hd-work-tree-toggle",
\t\t\t\t\t"aria-expanded": open,
\t\t\t\t\t"aria-label": \`\${action} · \${status} · \${count}\`,
\t\t\t\t\tonClick: () => setOpen((value) => !value),
\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: "hd-work-tree-chevron",
\t\t\t\t\t\t"aria-hidden": true,
\t\t\t\t\t\tchildren: open ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {})
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: "hd-work-tree-title",
\t\t\t\t\t\tchildren: t("workTree.title")
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: "hd-work-tree-count",
\t\t\t\t\t\tchildren: count
\t\t\t\t\t}), (0, react_jsx_runtime.jsx)("span", {
\t\t\t\t\t\tclassName: "hd-work-tree-status",
\t\t\t\t\t\t"aria-live": "polite",
\t\t\t\t\t\tchildren: status
\t\t\t\t\t})]
\t\t\t\t}), (0, react_jsx_runtime.jsx)("div", {
\t\t\t\t\tclassName: "hd-work-tree-body",
\t\t\t\t\thidden: !open,
\t\t\t\t\tchildren: item.nodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\tuseSession,
\t\t\t\t\t\tselectedCallId,
\t\t\t\t\t\tcwd,
\t\t\t\t\t\topenFile,
\t\t\t\t\t\tinspectCall,
\t\t\t\t\t\tforkAt,
\t\t\t\t\t\trenderMessageImages,
\t\t\t\t\t\tfileMentions,
\t\t\t\t\t\trenderSlot,
\t\t\t\t\t\tt
\t\t\t\t\t}, nodeKey))
\t\t\t\t})]
\t\t\t});
\t\t});
${COMPONENT_ANCHOR}`

const RENDER_ORIGINAL = `\t\t\t\t\t\t\torder.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\t\t\tuseSession,
\t\t\t\t\t\t\t\tselectedCallId,
\t\t\t\t\t\t\t\tcwd,
\t\t\t\t\t\t\t\topenFile: requestOpenFile,
\t\t\t\t\t\t\t\tinspectCall,
\t\t\t\t\t\t\t\tforkAt,
\t\t\t\t\t\t\t\trenderMessageImages,
\t\t\t\t\t\t\t\tfileMentions,
\t\t\t\t\t\t\t\trenderSlot,
\t\t\t\t\t\t\t\tt
\t\t\t\t\t\t\t}, nodeKey)),`

const RENDER_PATCHED = `\t\t\t\t\t\t\tbuildConversationWorkTreeItems(order, nodeStore).map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tuseSession,
\t\t\t\t\t\t\t\tselectedCallId,
\t\t\t\t\t\t\t\tcwd,
\t\t\t\t\t\t\t\topenFile: requestOpenFile,
\t\t\t\t\t\t\t\tinspectCall,
\t\t\t\t\t\t\t\tforkAt,
\t\t\t\t\t\t\t\trenderMessageImages,
\t\t\t\t\t\t\t\tfileMentions,
\t\t\t\t\t\t\t\trenderSlot,
\t\t\t\t\t\t\t\tt
\t\t\t\t\t\t\t}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey: item.nodeKey,
\t\t\t\t\t\t\t\tuseSession,
\t\t\t\t\t\t\t\tselectedCallId,
\t\t\t\t\t\t\t\tcwd,
\t\t\t\t\t\t\t\topenFile: requestOpenFile,
\t\t\t\t\t\t\t\tinspectCall,
\t\t\t\t\t\t\t\tforkAt,
\t\t\t\t\t\t\t\trenderMessageImages,
\t\t\t\t\t\t\t\tfileMentions,
\t\t\t\t\t\t\t\trenderSlot,
\t\t\t\t\t\t\t\tt
\t\t\t\t\t\t\t}, item.key)),`

const ZH_LOCALE_ORIGINAL = '\t\t\t"chat.toBottom": "回到底部",'
const ZH_LOCALE_PATCHED = `${ZH_LOCALE_ORIGINAL}
\t\t\t"row.retry": "未应用，需要重新定位",
\t\t\t"workTree.title": "工作过程",
\t\t\t"workTree.steps": "{count} 个步骤",
\t\t\t"workTree.status.running": "进行中",
\t\t\t"workTree.status.done": "已完成",
\t\t\t"workTree.status.error": "有步骤失败",
\t\t\t"workTree.status.stopped": "已停止",
\t\t\t"workTree.expand": "展开工作过程",
\t\t\t"workTree.collapse": "收起工作过程",`
const EN_LOCALE_ORIGINAL = '\t\t\t"chat.toBottom": "Back to bottom",'
const EN_LOCALE_PATCHED = `${EN_LOCALE_ORIGINAL}
\t\t\t"row.retry": "Not applied; target needs to be located again",
\t\t\t"workTree.title": "Work activity",
\t\t\t"workTree.steps": "{count} steps",
\t\t\t"workTree.status.running": "In progress",
\t\t\t"workTree.status.done": "Completed",
\t\t\t"workTree.status.error": "Needs attention",
\t\t\t"workTree.status.stopped": "Stopped",
\t\t\t"workTree.expand": "Expand work activity",
\t\t\t"workTree.collapse": "Collapse work activity",`
const ZH_ROW_STOPPED = '\t\t\t"row.stopped": "已停止",'
const ZH_ROW_RETRY = `${ZH_ROW_STOPPED}\n\t\t\t"row.retry": "未应用，需要重新定位",`
const EN_ROW_STOPPED = '\t\t\t"row.stopped": "Stopped",'
const EN_ROW_RETRY = `${EN_ROW_STOPPED}\n\t\t\t"row.retry": "Not applied; target needs to be located again",`

const LEGACY_STYLE_SUFFIX = '@media(prefers-reduced-motion:reduce){.hd-work-tree-toggle{transition:none}}";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const STICKY_CSS_START = '.hd-work-tree[data-open] .hd-work-tree-toggle'
const stickyCssTail = WORK_TREE_CSS.slice(WORK_TREE_CSS.indexOf(STICKY_CSS_START))
const STICKY_STYLE_SUFFIX = `${stickyCssTail}";
\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";
\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";`
const STICKY_MARKER_PAIR = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const FLOW_MARKER_TRIPLE = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const MANUAL_MARKER_QUAD = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const RECOVERABLE_MARKER_QUINT = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const AUTO_TOGGLE_STATE_BLOCK = '\t\t\tconst [open, setOpen] = (0, react.useState)(item.active || selected);\n\t\t\tconst wasActive = (0, react.useRef)(item.active);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (item.active === wasActive.current) return;\n\t\t\t\twasActive.current = item.active;\n\t\t\t\tsetOpen(item.active);\n\t\t\t}, [item.active]);'
const MANUAL_STATE_BLOCK = '\t\t\tconst [open, setOpen] = (0, react.useState)(item.active || selected);'

function replaceExactlyOnce(source, original, patched, label) {
  const first = source.indexOf(original)
  if (first < 0 || source.indexOf(original, first + original.length) >= 0) {
    throw new Error(`Pinned DSH ${label} changed; refusing an unsafe conversation work-tree patch.`)
  }
  return source.slice(0, first) + patched + source.slice(first + original.length)
}

function assertComplete(source) {
  for (const required of [
    '@harness-desktop/conversation-work-tree-v1',
    '@harness-desktop/conversation-work-tree-sticky-v1',
    '@harness-desktop/conversation-work-tree-flow-v2',
    '@harness-desktop/conversation-work-tree-manual-v3',
    '@harness-desktop/conversation-work-tree-recoverable-v4',
    'FS_EDIT_NOT_FOUND',
    'work-tree:flow:',
    'position:sticky',
    'scroll-margin-top:64px',
    'const conversationUnscopedWorkTrees = true',
    'function buildConversationWorkTreeItems',
    'const ConversationWorkTreeGroup',
    'className: "hd-work-tree-toggle"',
    '"aria-expanded": open',
    'hidden: !open',
    'data-chat-flow-kind": "work-tree"',
    'workTree.status.error',
    '"row.retry":',
    'workTree.collapse',
    'buildConversationWorkTreeItems(order, nodeStore).map'
  ]) {
    if (!source.includes(required)) throw new Error('Installed conversation work-tree patch is incomplete; refusing to continue.')
  }
  if (source.includes(AUTO_TOGGLE_STATE_BLOCK)) throw new Error('Installed conversation work-tree still overrides the user-selected disclosure state.')
}

export function patchConversationWorkTreeSource(source) {
  if (source.includes(PATCH_MARKER)) {
    let migrated = source
    let changed = false
    if (!migrated.includes('const conversationUnscopedWorkTrees = true')) {
      migrated = replaceExactlyOnce(migrated, LEGACY_WORK_NODE_SOURCE, WORK_NODE_SOURCE, 'legacy work-node classifier')
      migrated = replaceExactlyOnce(migrated, LEGACY_WORK_TREE_ITEMS_SOURCE, WORK_TREE_ITEMS_SOURCE, 'legacy work-tree grouping')
      changed = true
    }
    if (!migrated.includes('@harness-desktop/conversation-work-tree-sticky-v1')) {
      migrated = replaceExactlyOnce(migrated, LEGACY_STYLE_SUFFIX, STICKY_STYLE_SUFFIX, 'sticky work-tree header')
      changed = true
    }
    if (!migrated.includes(FLOW_PATCH_MARKER)) {
      if (migrated.includes(PRE_FLOW_WORK_TREE_ITEMS_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, PRE_FLOW_WORK_TREE_ITEMS_SOURCE, WORK_TREE_ITEMS_SOURCE, 'conversation-order work-tree grouping')
      } else if (!migrated.includes(WORK_TREE_ITEMS_SOURCE)) {
        throw new Error('Pinned DSH work-tree grouping changed; refusing an unsafe conversation-order migration.')
      }
      migrated = replaceExactlyOnce(migrated, STICKY_MARKER_PAIR, FLOW_MARKER_TRIPLE, 'conversation-order work-tree marker')
      changed = true
    }
    if (migrated.includes(AUTO_TOGGLE_STATE_BLOCK)) {
      migrated = replaceExactlyOnce(migrated, AUTO_TOGGLE_STATE_BLOCK, MANUAL_STATE_BLOCK, 'manual work-tree disclosure state')
      changed = true
    }
    if (!migrated.includes(MANUAL_PATCH_MARKER)) {
      migrated = replaceExactlyOnce(migrated, FLOW_MARKER_TRIPLE, MANUAL_MARKER_QUAD, 'manual work-tree disclosure marker')
      changed = true
    }
    if (!migrated.includes(RECOVERABLE_PATCH_MARKER)) {
      migrated = replaceExactlyOnce(migrated, PRE_RECOVERABLE_TOOL_STATS_SOURCE, RECOVERABLE_TOOL_STATS_SOURCE, 'recoverable edit-conflict work-tree state')
      migrated = replaceExactlyOnce(migrated, MANUAL_MARKER_QUAD, RECOVERABLE_MARKER_QUINT, 'recoverable edit-conflict work-tree marker')
      changed = true
    }
    if (!migrated.includes('"row.retry":')) {
      migrated = replaceExactlyOnce(migrated, ZH_ROW_STOPPED, ZH_ROW_RETRY, 'Chinese recoverable edit status')
      migrated = replaceExactlyOnce(migrated, EN_ROW_STOPPED, EN_ROW_RETRY, 'English recoverable edit status')
      changed = true
    }
    assertComplete(migrated)
    return { source: migrated, changed }
  }
  let output = replaceExactlyOnce(source, STYLE_ANCHOR, STYLE_PATCH, 'work-tree style anchor')
  output = replaceExactlyOnce(output, COMPONENT_ANCHOR, COMPONENT_PATCH, 'work-tree component anchor')
  output = replaceExactlyOnce(output, RENDER_ORIGINAL, RENDER_PATCHED, 'work-tree chat flow renderer')
  output = replaceExactlyOnce(output, ZH_LOCALE_ORIGINAL, ZH_LOCALE_PATCHED, 'Chinese work-tree labels')
  output = replaceExactlyOnce(output, EN_LOCALE_ORIGINAL, EN_LOCALE_PATCHED, 'English work-tree labels')
  assertComplete(output)
  return { source: output, changed: true }
}
