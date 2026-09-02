const PATCH_MARKER = 'conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1"'
const FLOW_PATCH_MARKER = 'conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2"'
const MANUAL_PATCH_MARKER = 'conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3"'
const RECOVERABLE_PATCH_MARKER = 'conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4"'
const AUTO_COMPLETE_PATCH_MARKER = 'conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5"'
const PERFORMANCE_PATCH_MARKER = 'conversationWorkTreePerformanceMarker = "@harness-desktop/conversation-work-tree-performance-v6"'
const SNAPSHOT_PRIORITY_PATCH_MARKER = 'conversationWorkTreeSnapshotPriorityMarker = "@harness-desktop/conversation-work-tree-snapshot-priority-v7"'
const PERSISTENCE_PATCH_MARKER = 'conversationWorkTreePersistenceMarker = "@harness-desktop/conversation-work-tree-persistence-v8"'
const READER_RESTORE_PATCH_MARKER = 'conversationWorkTreeReaderRestoreMarker = "@harness-desktop/conversation-work-tree-reader-restore-v9"'

const WORK_TREE_CSS = ".hd-work-tree{min-width:0;border-radius:10px}.hd-work-tree-toggle{box-sizing:border-box;width:100%;min-height:44px;border:0;border-radius:9px;padding:0 10px;color:var(--dsw-alias-label-secondary);background:transparent;align-items:center;gap:8px;font:inherit;text-align:left;cursor:pointer;display:flex;transition:color .14s ease,background-color .14s ease}.hd-work-tree-toggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.hd-work-tree-toggle:focus-visible{outline:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 68%,transparent);outline-offset:2px}.hd-work-tree-chevron{width:16px;height:16px;flex:none;place-items:center;display:grid}.hd-work-tree-title{color:var(--dsw-alias-label-primary-dimmed);font-size:14px;font-weight:600;line-height:20px}.hd-work-tree-count{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;overflow:hidden}.hd-work-tree-status{color:var(--dsw-alias-label-tertiary);white-space:nowrap;align-items:center;gap:6px;margin-left:auto;font-size:12px;line-height:18px;display:inline-flex}.hd-work-tree-status:before{content:\"\";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}.hd-work-tree[data-state=running] .hd-work-tree-toggle{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent)}.hd-work-tree[data-state=running] .hd-work-tree-status{color:var(--dsw-alias-brand-primary)}.hd-work-tree[data-state=error] .hd-work-tree-status{color:var(--dsw-alias-state-error-primary)}.hd-work-tree[data-state=stopped] .hd-work-tree-status{color:var(--dsw-alias-state-warning-primary)}.hd-work-tree-body{position:relative;flex-direction:column;gap:8px;margin:2px 0 6px 20px;padding:0 0 4px 18px;display:flex}.hd-work-tree-body:before{content:\"\";position:absolute;top:0;bottom:8px;left:0;width:1px;background:var(--dsw-alias-border-l2)}.hd-work-tree-body[hidden]{display:none}.hd-work-tree-body>[data-chat-flow-key]{position:relative}.hd-work-tree-body>[data-chat-flow-key]:before{content:\"\";position:absolute;top:12px;left:-18px;width:10px;height:1px;background:var(--dsw-alias-border-l2)}@media(max-width:620px){.hd-work-tree-toggle{padding-inline:6px}.hd-work-tree-body{margin-left:16px;padding-left:14px}.hd-work-tree-body>[data-chat-flow-key]:before{left:-14px;width:8px}}.hd-work-tree[data-open] .hd-work-tree-toggle{position:sticky;top:8px;z-index:5;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l2) 82%,transparent);background:color-mix(in srgb,var(--dsw-alias-bg-base) 92%,transparent);box-shadow:0 6px 18px color-mix(in srgb,#000 12%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.06);backdrop-filter:blur(14px) saturate(1.06)}.hd-work-tree[data-open] .hd-work-tree-body>[data-chat-flow-key]{scroll-margin-top:64px}@media(max-width:620px){.hd-work-tree[data-open] .hd-work-tree-toggle{top:6px}}@media(prefers-reduced-motion:reduce){.hd-work-tree-toggle{transition:none}}"

const STYLE_ANCHOR = '\t\tconst tagId$11 = "@deepseek-ai/dsh-client-ui-conversation/ChatView.module.css";'
const STYLE_PATCH = `\t\tconst conversationWorkTreeCss = ${JSON.stringify(WORK_TREE_CSS)};
\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";
\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";
\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";
\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";
\t\tconst conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5";
\t\tconst conversationWorkTreePerformanceMarker = "@harness-desktop/conversation-work-tree-performance-v6";
\t\tconst conversationWorkTreeSnapshotPriorityMarker = "@harness-desktop/conversation-work-tree-snapshot-priority-v7";
\t\tconst conversationWorkTreePersistenceMarker = "@harness-desktop/conversation-work-tree-persistence-v8";
\t\tconst conversationWorkTreeReaderRestoreMarker = "@harness-desktop/conversation-work-tree-reader-restore-v9";
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

function preReaderRestoreReduceConversationWorkTreeDisclosure(state, event) {
  const current = state ?? { open: false, automatic: false, userControlled: false, active: false }
  if (event?.type === 'toggle') {
    return { ...current, open: !current.open, automatic: false, userControlled: true }
  }
  if (event?.type !== 'activity') return current
  const active = event.active === true
  const selected = event.selected === true
  let next = { ...current, active }
  if (active !== current.active && !current.userControlled) {
    if (active) next = { ...next, open: true, automatic: true }
    else if (current.automatic) next = { ...next, open: selected, automatic: false }
  }
  if (selected) next = { ...next, open: true }
  return next
}

export function reduceConversationWorkTreeDisclosure(state, event) {
  const current = state ?? { open: false, automatic: false, userControlled: false, active: false }
  if (event?.type === 'toggle') {
    return { ...current, open: !current.open, automatic: false, userControlled: true }
  }
  if (event?.type !== 'activity') return current
  const active = event.active === true
  const selected = event.selected === true
  let next = { ...current, active }
  if (active !== current.active && !current.userControlled) {
    if (active) next = { ...next, open: true, automatic: true }
    else if (current.automatic) next = { ...next, open: selected, automatic: false }
  }
  if (selected && !next.userControlled) next = { ...next, open: true }
  return next
}

export function conversationWorkTreeStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function readConversationWorkTreeDisclosure(storage, sessionId, itemKey) {
  if (!storage || typeof storage.getItem !== 'function' || typeof sessionId !== 'string' || !sessionId || typeof itemKey !== 'string' || !itemKey) return undefined
  try {
    const value = JSON.parse(storage.getItem(`harness.desktop.work-tree-disclosure.v1:${sessionId}`) || '{}')
    return typeof value?.[itemKey] === 'boolean' ? value[itemKey] : undefined
  } catch {
    return undefined
  }
}

export function writeConversationWorkTreeDisclosure(storage, sessionId, itemKey, open) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof sessionId !== 'string' || !sessionId || typeof itemKey !== 'string' || !itemKey || typeof open !== 'boolean') return false
  try {
    const parsed = JSON.parse(storage.getItem(`harness.desktop.work-tree-disclosure.v1:${sessionId}`) || '{}')
    const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.entries(parsed).filter(([key, value]) => typeof key === 'string' && typeof value === 'boolean' && key !== itemKey).slice(-255)
      : []
    const value = Object.fromEntries(entries)
    value[itemKey] = open
    storage.setItem(`harness.desktop.work-tree-disclosure.v1:${sessionId}`, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function preReaderRestoreCreateConversationWorkTreeDisclosureState(persistedOpen, active, selected) {
  if (typeof persistedOpen === 'boolean') return { open: persistedOpen || selected === true, automatic: false, userControlled: true, active: active === true }
  return { open: active === true || selected === true, automatic: active === true && selected !== true, userControlled: false, active: active === true }
}

export function createConversationWorkTreeDisclosureState(persistedOpen, active, selected) {
  if (typeof persistedOpen === 'boolean') return { open: persistedOpen, automatic: false, userControlled: true, active: active === true }
  return { open: active === true || selected === true, automatic: active === true && selected !== true, userControlled: false, active: active === true }
}

export function conversationWorkTreeRestoreNodeKey(nodeKeys, callNodeKeys, anchorKey) {
  if (!Array.isArray(nodeKeys) || typeof anchorKey !== 'string' || !anchorKey) return undefined
  if (nodeKeys.includes(anchorKey)) return anchorKey
  if (!anchorKey.startsWith('call:') || !(callNodeKeys instanceof Map)) return undefined
  const nodeKey = callNodeKeys.get(anchorKey.slice(5))
  return typeof nodeKey === 'string' && nodeKeys.includes(nodeKey) ? nodeKey : undefined
}

export function reduceConversationWorkTreeRenderCount(count, event) {
  const total = Number.isSafeInteger(event?.total) && event.total > 0 ? event.total : 0
  if (event?.open !== true || total === 0) return 0
  const current = Number.isSafeInteger(count) && count > 0 ? Math.min(count, total) : 0
  if (event?.type !== 'advance' && current > 0) return current
  return Math.min(total, current + 64)
}

function preReaderRestoreConversationWorkTreeRenderKeys(nodeKeys, renderedCount, selectedNodeKey) {
  const total = Array.isArray(nodeKeys) ? nodeKeys.length : 0
  const prefixEnd = Number.isSafeInteger(renderedCount) && renderedCount > 0 ? Math.min(renderedCount, total) : 0
  const selectedIndex = typeof selectedNodeKey === 'string' ? nodeKeys.indexOf(selectedNodeKey) : -1
  if (selectedIndex < prefixEnd || selectedIndex < 0) return nodeKeys.slice(0, prefixEnd)
  const priorityStart = Math.max(prefixEnd, Math.min(selectedIndex - 32, total - 64))
  const priorityEnd = Math.min(total, Math.max(selectedIndex + 1, priorityStart + 64))
  return nodeKeys.slice(0, prefixEnd).concat(nodeKeys.slice(priorityStart, priorityEnd))
}

export function conversationWorkTreeRenderKeys(nodeKeys, renderedCount, selectedNodeKey, restoreNodeKey) {
  const total = Array.isArray(nodeKeys) ? nodeKeys.length : 0
  const prefixEnd = Number.isSafeInteger(renderedCount) && renderedCount > 0 ? Math.min(renderedCount, total) : 0
  const indexes = new Set(Array.from({ length: prefixEnd }, (_, index) => index))
  const priorityIndexes = [...new Set([selectedNodeKey, restoreNodeKey]
    .filter(nodeKey => typeof nodeKey === 'string')
    .map(nodeKey => nodeKeys.indexOf(nodeKey))
    .filter(index => index >= prefixEnd))]
    .sort((left, right) => left - right)
  for (const priorityIndex of priorityIndexes) {
    const priorityStart = Math.max(prefixEnd, Math.min(priorityIndex - 32, total - 64))
    const priorityEnd = Math.min(total, Math.max(priorityIndex + 1, priorityStart + 64))
    for (let index = priorityStart; index < priorityEnd; index += 1) indexes.add(index)
  }
  return [...indexes].sort((left, right) => left - right).map(index => nodeKeys[index])
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
        callIds: [],
        callNodeKeys: new Map()
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
    for (const callId of stats.callIds) group.callNodeKeys.set(callId, nodeKey)
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
const PRE_PRIORITY_WORK_TREE_ITEMS_SOURCE = WORK_TREE_ITEMS_SOURCE
  .replace('\n\t\t        callIds: [],\n\t\t        callNodeKeys: new Map()', '\n\t\t        callIds: []')
  .replace('\n\t\t    for (const callId of stats.callIds) group.callNodeKeys.set(callId, nodeKey)', '')
const PRE_READER_RESTORE_DISCLOSURE_REDUCER_SOURCE = bundleFunctionSource(preReaderRestoreReduceConversationWorkTreeDisclosure).replace('function preReaderRestoreReduceConversationWorkTreeDisclosure', 'function reduceConversationWorkTreeDisclosure')
const DISCLOSURE_REDUCER_SOURCE = PRE_READER_RESTORE_DISCLOSURE_REDUCER_SOURCE
const FINAL_DISCLOSURE_REDUCER_SOURCE = bundleFunctionSource(reduceConversationWorkTreeDisclosure)
const PRE_READER_RESTORE_CREATE_STATE_SOURCE = bundleFunctionSource(preReaderRestoreCreateConversationWorkTreeDisclosureState).replace('function preReaderRestoreCreateConversationWorkTreeDisclosureState', 'function createConversationWorkTreeDisclosureState')
const CREATE_STATE_SOURCE = bundleFunctionSource(createConversationWorkTreeDisclosureState)
const DISCLOSURE_PERSISTENCE_HELPERS_SOURCE = [
  conversationWorkTreeStorage,
  readConversationWorkTreeDisclosure,
  writeConversationWorkTreeDisclosure
].map(bundleFunctionSource).concat(PRE_READER_RESTORE_CREATE_STATE_SOURCE).join('\n')
const RESTORE_NODE_KEY_SOURCE = bundleFunctionSource(conversationWorkTreeRestoreNodeKey)
const RENDER_COUNT_REDUCER_SOURCE = bundleFunctionSource(reduceConversationWorkTreeRenderCount)
const PRE_READER_RESTORE_RENDER_KEYS_SOURCE = bundleFunctionSource(preReaderRestoreConversationWorkTreeRenderKeys).replace('function preReaderRestoreConversationWorkTreeRenderKeys', 'function conversationWorkTreeRenderKeys')
const RENDER_KEYS_SOURCE = PRE_READER_RESTORE_RENDER_KEYS_SOURCE
const FINAL_RENDER_KEYS_SOURCE = bundleFunctionSource(conversationWorkTreeRenderKeys)
const PRE_RECOVERABLE_TOOL_STATS_SOURCE = bundleFunctionSource(preRecoverableConversationToolRootStats).replaceAll('preRecoverableConversationToolRootStats', 'conversationToolRootStats')
const RECOVERABLE_TOOL_STATS_SOURCE = bundleFunctionSource(conversationToolRootStats)

const WORK_TREE_HELPERS = [
  conversationTurnId,
  conversationAssistantHasReply,
  conversationToolRootStats,
  conversationWorkNodeStats,
  conversationIsWorkNode,
  reduceConversationWorkTreeDisclosure,
  conversationWorkTreeStorage,
  readConversationWorkTreeDisclosure,
  writeConversationWorkTreeDisclosure,
  createConversationWorkTreeDisclosureState,
  conversationWorkTreeRestoreNodeKey,
  reduceConversationWorkTreeRenderCount,
  conversationWorkTreeRenderKeys,
  buildConversationWorkTreeItems
].map(bundleFunctionSource).join('\n')

const COMPONENT_ANCHOR = '\t\tfunction ChatView({ useSession, useSessions, useStore, renderSlot, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt, fileMentions, t }) {'
const COMPONENT_PATCH = `${WORK_TREE_HELPERS}
\t\tconst ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, sessionId, savedScrollAnchorKey, useSession, selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions, renderSlot, t }) {
\t\t\tconst selectedNodeKey = selectedCallId === void 0 ? void 0 : item.callNodeKeys.get(selectedCallId);
\t\t\tconst selected = selectedNodeKey !== void 0;
\t\t\tconst restoreNodeKey = conversationWorkTreeRestoreNodeKey(item.nodeKeys, item.callNodeKeys, savedScrollAnchorKey);
\t\t\tconst disclosureStorage = conversationWorkTreeStorage();
\t\t\tconst readPersistedDisclosure = () => readConversationWorkTreeDisclosure(disclosureStorage, sessionId, item.key);
\t\t\tconst [disclosure, setDisclosure] = (0, react.useState)(() => createConversationWorkTreeDisclosureState(readPersistedDisclosure(), item.active, selected));
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetDisclosure(createConversationWorkTreeDisclosureState(readPersistedDisclosure(), item.active, selected));
\t\t\t}, [sessionId, item.key]);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetDisclosure((value) => reduceConversationWorkTreeDisclosure(value, { type: "activity", active: item.active, selected }));
\t\t\t}, [item.active, selected]);
\t\t\tconst open = disclosure.open;
\t\t\tconst [renderedCount, setRenderedCount] = (0, react.useState)(() => reduceConversationWorkTreeRenderCount(0, { type: "sync", open, total: item.nodeKeys.length }));
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetRenderedCount((value) => reduceConversationWorkTreeRenderCount(value, { type: "sync", open, total: item.nodeKeys.length }));
\t\t\t}, [open, item.nodeKeys.length]);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (!open || renderedCount >= item.nodeKeys.length) return;
\t\t\t\tlet cancelled = false;
\t\t\t\tconst advance = () => {
\t\t\t\t\tif (!cancelled) setRenderedCount((value) => reduceConversationWorkTreeRenderCount(value, { type: "advance", open: true, total: item.nodeKeys.length }));
\t\t\t\t};
\t\t\t\tconst idle = globalThis.requestIdleCallback;
\t\t\t\tconst handle = typeof idle === "function" ? idle(advance, { timeout: 50 }) : globalThis.setTimeout(advance, 0);
\t\t\t\treturn () => {
\t\t\t\t\tcancelled = true;
\t\t\t\t\tif (typeof idle === "function") globalThis.cancelIdleCallback?.(handle);
\t\t\t\t\telse globalThis.clearTimeout(handle);
\t\t\t\t};
\t\t\t}, [open, renderedCount, item.nodeKeys.length]);
\t\t\tconst renderedNodeKeys = open ? conversationWorkTreeRenderKeys(item.nodeKeys, renderedCount, selectedNodeKey, restoreNodeKey) : [];
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
\t\t\t\t\tonClick: () => setDisclosure((value) => {
\t\t\t\t\t\tconst next = reduceConversationWorkTreeDisclosure(value, { type: "toggle" });
\t\t\t\t\t\twriteConversationWorkTreeDisclosure(disclosureStorage, sessionId, item.key, next.open);
\t\t\t\t\t\treturn next;
\t\t\t\t\t}),
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
\t\t\t\t\t"aria-busy": open && renderedCount < item.nodeKeys.length || void 0,
\t\t\t\t\tchildren: renderedNodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
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

const NODE_STORE_SELECTOR_ANCHOR = '\t\t\tconst nodeStore = useSession((s) => s.chat.nodes);'
const NODE_STORE_SELECTOR_PATCHED = `${NODE_STORE_SELECTOR_ANCHOR}
\t\t\t/* MutableChatNodeStore is stable; values() is its cached content snapshot revision. */
\t\t\tconst nodeSnapshot = useSession((s) => s.chat.nodes.values());`
const WORK_TREE_MEMO_ANCHOR = '\t\t\tconst pendingSteering = (0, react.useMemo)(() => inbox.filter((item) => item.placement === "steering"), [inbox]);'
const WORK_TREE_MEMO_V6 = `${WORK_TREE_MEMO_ANCHOR}
\t\t\t/* DSH_DESKTOP_MEMOIZED_WORK_TREE: unrelated view state must not refold the full transcript. */
\t\t\tconst workTreeItems = (0, react.useMemo)(() => buildConversationWorkTreeItems(order, nodeStore), [order, nodeStore]);`
const WORK_TREE_MEMO_V8 = `${WORK_TREE_MEMO_ANCHOR}
\t\t\t/* DSH_DESKTOP_MEMOIZED_WORK_TREE: values() changes for content upserts; unrelated view state reuses it. */
\t\t\tconst workTreeItems = (0, react.useMemo)(() => buildConversationWorkTreeItems(order, nodeStore), [order, nodeSnapshot]);`
const WORK_TREE_MEMO_PATCHED = `${WORK_TREE_MEMO_V8}
\t\t\t/* Capture the returning reader anchor before child layout effects can normalize it. */
\t\t\tconst savedScrollAnchorKey = chatScroll.read()?.anchorKey;`

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

const RENDER_PATCHED = `\t\t\t\t\t\t\tworkTreeItems.map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tsessionId,
\t\t\t\t\t\t\t\tsavedScrollAnchorKey,
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
\t\t\t\t\t\t\t}, \`\${sessionId}:\${item.key}\`) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
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
const AUTO_COMPLETE_MARKER_SEXT = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";\n\t\tconst conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const PERFORMANCE_MARKER_SEPT = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";\n\t\tconst conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5";\n\t\tconst conversationWorkTreePerformanceMarker = "@harness-desktop/conversation-work-tree-performance-v6";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const SNAPSHOT_PRIORITY_MARKER_OCT = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";\n\t\tconst conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5";\n\t\tconst conversationWorkTreePerformanceMarker = "@harness-desktop/conversation-work-tree-performance-v6";\n\t\tconst conversationWorkTreeSnapshotPriorityMarker = "@harness-desktop/conversation-work-tree-snapshot-priority-v7";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const PERSISTENCE_MARKER_NONET = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";\n\t\tconst conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5";\n\t\tconst conversationWorkTreePerformanceMarker = "@harness-desktop/conversation-work-tree-performance-v6";\n\t\tconst conversationWorkTreeSnapshotPriorityMarker = "@harness-desktop/conversation-work-tree-snapshot-priority-v7";\n\t\tconst conversationWorkTreePersistenceMarker = "@harness-desktop/conversation-work-tree-persistence-v8";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const READER_RESTORE_MARKER_DECET = '\t\tconst conversationWorkTreeStickyMarker = "@harness-desktop/conversation-work-tree-sticky-v1";\n\t\tconst conversationWorkTreeFlowMarker = "@harness-desktop/conversation-work-tree-flow-v2";\n\t\tconst conversationWorkTreeManualMarker = "@harness-desktop/conversation-work-tree-manual-v3";\n\t\tconst conversationWorkTreeRecoverableMarker = "@harness-desktop/conversation-work-tree-recoverable-v4";\n\t\tconst conversationWorkTreeAutoCompleteMarker = "@harness-desktop/conversation-work-tree-auto-complete-v5";\n\t\tconst conversationWorkTreePerformanceMarker = "@harness-desktop/conversation-work-tree-performance-v6";\n\t\tconst conversationWorkTreeSnapshotPriorityMarker = "@harness-desktop/conversation-work-tree-snapshot-priority-v7";\n\t\tconst conversationWorkTreePersistenceMarker = "@harness-desktop/conversation-work-tree-persistence-v8";\n\t\tconst conversationWorkTreeReaderRestoreMarker = "@harness-desktop/conversation-work-tree-reader-restore-v9";\n\t\tconst conversationWorkTreeMarker = "@harness-desktop/conversation-work-tree-v1";'
const WORK_TREE_COMPONENT_PREFIX = '\t\tconst ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({'
const WORK_TREE_COMPONENT_PROPS_V7 = 'function ConversationWorkTreeGroup({ item, useSession,'
const WORK_TREE_COMPONENT_PROPS_V8 = 'function ConversationWorkTreeGroup({ item, sessionId, useSession,'
const WORK_TREE_COMPONENT_PROPS_V9 = 'function ConversationWorkTreeGroup({ item, sessionId, savedScrollAnchorKey, useSession,'
const WORK_TREE_RENDER_PROPS_V7 = '\t\t\t\t\t\t\t\titem,\n\t\t\t\t\t\t\t\tuseSession,'
const WORK_TREE_RENDER_PROPS_V8 = '\t\t\t\t\t\t\t\titem,\n\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\tuseSession,'
const WORK_TREE_RENDER_PROPS_V9 = '\t\t\t\t\t\t\t\titem,\n\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\tsavedScrollAnchorKey,\n\t\t\t\t\t\t\t\tuseSession,'
const SELECTED_CALL_V6 = '\t\t\tconst selected = selectedCallId !== void 0 && item.callIds.includes(selectedCallId);'
const SELECTED_CALL_V7 = '\t\t\tconst selectedNodeKey = selectedCallId === void 0 ? void 0 : item.callNodeKeys.get(selectedCallId);\n\t\t\tconst selected = selectedNodeKey !== void 0;'
const READER_RESTORE_NODE_LOOKUP = `${SELECTED_CALL_V7}\n\t\t\tconst restoreNodeKey = conversationWorkTreeRestoreNodeKey(item.nodeKeys, item.callNodeKeys, savedScrollAnchorKey);`
const AUTO_TOGGLE_STATE_BLOCK = '\t\t\tconst [open, setOpen] = (0, react.useState)(item.active || selected);\n\t\t\tconst wasActive = (0, react.useRef)(item.active);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (item.active === wasActive.current) return;\n\t\t\t\twasActive.current = item.active;\n\t\t\t\tsetOpen(item.active);\n\t\t\t}, [item.active]);'
const MANUAL_STATE_BLOCK = '\t\t\tconst [open, setOpen] = (0, react.useState)(item.active || selected);'
const PRE_AUTO_COMPLETE_STATE_BLOCK = `${MANUAL_STATE_BLOCK}\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tif (selected) setOpen(true);\n\t\t\t}, [selected]);`
const AUTO_COMPLETE_STATE_BLOCK = '\t\t\tconst [disclosure, setDisclosure] = (0, react.useState)(() => ({ open: item.active || selected, automatic: item.active && !selected, userControlled: false, active: item.active }));\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tsetDisclosure((value) => reduceConversationWorkTreeDisclosure(value, { type: "activity", active: item.active, selected }));\n\t\t\t}, [item.active, selected]);\n\t\t\tconst open = disclosure.open;'
const PERSISTED_STATE_BLOCK = '\t\t\tconst disclosureStorage = conversationWorkTreeStorage();\n\t\t\tconst readPersistedDisclosure = () => readConversationWorkTreeDisclosure(disclosureStorage, sessionId, item.key);\n\t\t\tconst [disclosure, setDisclosure] = (0, react.useState)(() => createConversationWorkTreeDisclosureState(readPersistedDisclosure(), item.active, selected));\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tsetDisclosure(createConversationWorkTreeDisclosureState(readPersistedDisclosure(), item.active, selected));\n\t\t\t}, [sessionId, item.key]);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tsetDisclosure((value) => reduceConversationWorkTreeDisclosure(value, { type: "activity", active: item.active, selected }));\n\t\t\t}, [item.active, selected]);\n\t\t\tconst open = disclosure.open;'
const INITIAL_RENDER_COUNT_V8 = '\t\t\tconst [renderedCount, setRenderedCount] = (0, react.useState)(0);'
const INITIAL_RENDER_COUNT_V9 = '\t\t\tconst [renderedCount, setRenderedCount] = (0, react.useState)(() => reduceConversationWorkTreeRenderCount(0, { type: "sync", open, total: item.nodeKeys.length }));'
const PERFORMANCE_STATE_BLOCK = `${AUTO_COMPLETE_STATE_BLOCK}
\t\t\tconst [renderedCount, setRenderedCount] = (0, react.useState)(0);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetRenderedCount((value) => reduceConversationWorkTreeRenderCount(value, { type: "sync", open, total: item.nodeKeys.length }));
\t\t\t}, [open, item.nodeKeys.length]);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (!open || renderedCount >= item.nodeKeys.length) return;
\t\t\t\tlet cancelled = false;
\t\t\t\tconst advance = () => {
\t\t\t\t\tif (!cancelled) setRenderedCount((value) => reduceConversationWorkTreeRenderCount(value, { type: "advance", open: true, total: item.nodeKeys.length }));
\t\t\t\t};
\t\t\t\tconst idle = globalThis.requestIdleCallback;
\t\t\t\tconst handle = typeof idle === "function" ? idle(advance, { timeout: 50 }) : globalThis.setTimeout(advance, 0);
\t\t\t\treturn () => {
\t\t\t\t\tcancelled = true;
\t\t\t\t\tif (typeof idle === "function") globalThis.cancelIdleCallback?.(handle);
\t\t\t\t\telse globalThis.clearTimeout(handle);
\t\t\t\t};
\t\t\t}, [open, renderedCount, item.nodeKeys.length]);`
const MANUAL_TOGGLE_HANDLER = '\t\t\t\t\tonClick: () => setOpen((value) => !value),'
const AUTO_COMPLETE_TOGGLE_HANDLER = '\t\t\t\t\tonClick: () => setDisclosure((value) => reduceConversationWorkTreeDisclosure(value, { type: "toggle" })),'
const PERSISTED_TOGGLE_HANDLER = '\t\t\t\t\tonClick: () => setDisclosure((value) => {\n\t\t\t\t\t\tconst next = reduceConversationWorkTreeDisclosure(value, { type: "toggle" });\n\t\t\t\t\t\twriteConversationWorkTreeDisclosure(disclosureStorage, sessionId, item.key, next.open);\n\t\t\t\t\t\treturn next;\n\t\t\t\t\t}),'
const EAGER_WORK_TREE_CHILDREN_START = '\t\t\t\t\thidden: !open,\n\t\t\t\t\tchildren: item.nodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {'
const BATCHED_WORK_TREE_CHILDREN_START = '\t\t\t\t\thidden: !open,\n\t\t\t\t\t"aria-busy": open && renderedCount < item.nodeKeys.length || void 0,\n\t\t\t\t\tchildren: open ? item.nodeKeys.slice(0, renderedCount).map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {'
const PRIORITY_WORK_TREE_CHILDREN_START = '\t\t\t\t\thidden: !open,\n\t\t\t\t\t"aria-busy": open && renderedCount < item.nodeKeys.length || void 0,\n\t\t\t\t\tchildren: renderedNodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {'
const EAGER_WORK_TREE_CHILDREN_END = '\t\t\t\t\t}, nodeKey))\n\t\t\t\t})]'
const BATCHED_WORK_TREE_CHILDREN_END = '\t\t\t\t\t}, nodeKey)) : null\n\t\t\t\t})]'
const PRIORITY_WORK_TREE_CHILDREN_END = '\t\t\t\t\t}, nodeKey))\n\t\t\t\t})]'
const RENDER_KEYS_ANCHOR = '\t\t\t}, [open, renderedCount, item.nodeKeys.length]);\n\t\t\tconst state = item.active ? "running"'
const RENDER_KEYS_PATCHED = '\t\t\t}, [open, renderedCount, item.nodeKeys.length]);\n\t\t\tconst renderedNodeKeys = open ? conversationWorkTreeRenderKeys(item.nodeKeys, renderedCount, selectedNodeKey) : [];\n\t\t\tconst state = item.active ? "running"'
const RENDER_KEYS_READER_RESTORE = '\t\t\t}, [open, renderedCount, item.nodeKeys.length]);\n\t\t\tconst renderedNodeKeys = open ? conversationWorkTreeRenderKeys(item.nodeKeys, renderedCount, selectedNodeKey, restoreNodeKey) : [];\n\t\t\tconst state = item.active ? "running"'
const WORK_TREE_REACT_KEY_V8 = '}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {'
const WORK_TREE_REACT_KEY_V9 = '}, `${sessionId}:${item.key}`) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {'
const FORCED_SESSION_REENTRY_BLOCK = `\t\t\t\t\t// Re-entering a conversation always starts at the latest message. A saved
\t\t\t\t\t// semantic anchor can point into a previously expanded work tree whose
\t\t\t\t\t// height has since changed, which otherwise restores the reader mid-flow.
\t\t\t\t\ttoBottom(el);`
const SAVED_SESSION_REENTRY_BLOCK = `\t\t\t\t\tconst saved = chatScroll.read();
\t\t\t\t\tif (saved === null) toBottom(el);
\t\t\t\t\telse {
\t\t\t\t\t\tel.scrollTop = saved.scrollTop;
\t\t\t\t\t\tconst row = anchorElement(local, saved.anchorKey);
\t\t\t\t\t\tif (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop;
\t\t\t\t\t\tobservedTopRef.current = el.scrollTop;
\t\t\t\t\t\tconst isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 25;
\t\t\t\t\t\tatBottomRef.current = isAtBottom;
\t\t\t\t\t\tsetAtBottom(isAtBottom);
\t\t\t\t\t\tconst normalized = isAtBottom ? null : scrollPosition(local, el);
\t\t\t\t\t\tif (isAtBottom) chatScroll.save(null);
\t\t\t\t\t\telse if (normalized !== null) chatScroll.save(normalized);
\t\t\t\t\t}`
const EAGER_WORK_TREE_RENDER = '\t\t\t\t\t\t\tbuildConversationWorkTreeItems(order, nodeStore).map((item) =>'
const MEMOIZED_WORK_TREE_RENDER = '\t\t\t\t\t\t\tworkTreeItems.map((item) =>'

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
    '@harness-desktop/conversation-work-tree-auto-complete-v5',
    '@harness-desktop/conversation-work-tree-performance-v6',
    '@harness-desktop/conversation-work-tree-snapshot-priority-v7',
    '@harness-desktop/conversation-work-tree-persistence-v8',
    '@harness-desktop/conversation-work-tree-reader-restore-v9',
    'FS_EDIT_NOT_FOUND',
    'work-tree:flow:',
    'position:sticky',
    'scroll-margin-top:64px',
    'const conversationUnscopedWorkTrees = true',
    'function buildConversationWorkTreeItems',
    'function reduceConversationWorkTreeDisclosure',
    'function readConversationWorkTreeDisclosure',
    'function writeConversationWorkTreeDisclosure',
    'function createConversationWorkTreeDisclosureState',
    'function conversationWorkTreeRestoreNodeKey',
    'harness.desktop.work-tree-disclosure.v1:',
    'function reduceConversationWorkTreeRenderCount',
    'function conversationWorkTreeRenderKeys',
    'const ConversationWorkTreeGroup',
    'userControlled: false',
    'type: "toggle"',
    'className: "hd-work-tree-toggle"',
    '"aria-expanded": open',
    'hidden: !open',
    'data-chat-flow-kind": "work-tree"',
    'workTree.status.error',
    '"row.retry":',
    'workTree.collapse',
    'DSH_DESKTOP_MEMOIZED_WORK_TREE',
    'const nodeSnapshot = useSession((s) => s.chat.nodes.values())',
    '[order, nodeSnapshot]',
    'workTreeItems.map',
    'item.callNodeKeys.get(selectedCallId)',
    'savedScrollAnchorKey = chatScroll.read()?.anchorKey',
    'conversationWorkTreeRestoreNodeKey(item.nodeKeys, item.callNodeKeys, savedScrollAnchorKey)',
    'conversationWorkTreeRenderKeys(item.nodeKeys, renderedCount, selectedNodeKey, restoreNodeKey)',
    '`${sessionId}:${item.key}`',
    'const saved = chatScroll.read();',
    'requestIdleCallback'
  ]) {
    if (!source.includes(required)) throw new Error('Installed conversation work-tree patch is incomplete; refusing to continue.')
  }
  if (source.includes(AUTO_TOGGLE_STATE_BLOCK) || source.includes(PRE_AUTO_COMPLETE_STATE_BLOCK) || source.includes(MANUAL_TOGGLE_HANDLER)) {
    throw new Error('Installed conversation work-tree does not preserve the automatic-versus-user disclosure state.')
  }
  if (source.includes(AUTO_COMPLETE_STATE_BLOCK) || source.includes(AUTO_COMPLETE_TOGGLE_HANDLER) || source.includes(WORK_TREE_COMPONENT_PROPS_V7) || source.includes(WORK_TREE_RENDER_PROPS_V7)) {
    throw new Error('Installed conversation work-tree does not persist disclosure independently for each session and work group.')
  }
  if (source.includes(PRE_READER_RESTORE_DISCLOSURE_REDUCER_SOURCE) || source.includes(PRE_READER_RESTORE_CREATE_STATE_SOURCE) || source.includes(PRE_READER_RESTORE_RENDER_KEYS_SOURCE) || source.includes(WORK_TREE_COMPONENT_PROPS_V8) || source.includes(WORK_TREE_RENDER_PROPS_V8) || source.includes(INITIAL_RENDER_COUNT_V8) || source.includes(WORK_TREE_REACT_KEY_V8) || source.includes(FORCED_SESSION_REENTRY_BLOCK)) {
    throw new Error('Installed conversation work-tree can still override the reader disclosure or lose the saved work anchor.')
  }
  if (source.includes(EAGER_WORK_TREE_CHILDREN_START) || source.includes(EAGER_WORK_TREE_RENDER)) {
    throw new Error('Installed conversation work-tree still performs eager long-session render work.')
  }
  if (source.includes('[order, nodeStore]') || source.includes(BATCHED_WORK_TREE_CHILDREN_START)) {
    throw new Error('Installed conversation work-tree still depends on a stable mutable store or delays selected calls behind the prefix.')
  }
}

const ALPHA4_STYLE_ANCHOR = '\t\tconst tagId$11 = "@deepseek-ai/dsh-client-ui-chat/ChatView.module.css";'
const ALPHA4_STYLE_PATCH = STYLE_PATCH.replace(STYLE_ANCHOR, ALPHA4_STYLE_ANCHOR)
const ALPHA4_NODE_STORE_ANCHOR = '\t\t\tconst nodeStore = useChat((s) => s.nodes);'
const ALPHA4_NODE_STORE_PATCH = `${ALPHA4_NODE_STORE_ANCHOR}\n\t\t\t/* DSH_DESKTOP_MEMOIZED_WORK_TREE: content snapshots invalidate grouping without structural churn. */\n\t\t\tconst nodeSnapshot = useChat((s) => s.nodes.values());`
const ALPHA4_NODE_LIST_ANCHOR = '\t\tconst ChatNodeList = (0, react.memo)(function ChatNodeList({ order, ...seatProps }) {\n\t\t\treturn order.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {\n\t\t\t\tnodeKey,\n\t\t\t\t...seatProps\n\t\t\t}, nodeKey));\n\t\t});'
const ALPHA4_NODE_LIST_PATCH = `${WORK_TREE_HELPERS}
\t\tconst ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, sessionId, savedScrollAnchorKey, ...seatProps }) {
\t\t\tconst selectedNodeKey = seatProps.selectedCallId === void 0 ? void 0 : item.callNodeKeys.get(seatProps.selectedCallId);
\t\t\tconst selected = selectedNodeKey !== void 0;
\t\t\tconst restoreNodeKey = conversationWorkTreeRestoreNodeKey(item.nodeKeys, item.callNodeKeys, savedScrollAnchorKey);
\t\t\tconst disclosureStorage = conversationWorkTreeStorage();
\t\t\tconst readPersistedDisclosure = () => readConversationWorkTreeDisclosure(disclosureStorage, sessionId, item.key);
\t\t\tconst [disclosure, setDisclosure] = (0, react.useState)(() => createConversationWorkTreeDisclosureState(readPersistedDisclosure(), item.active, selected));
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetDisclosure(createConversationWorkTreeDisclosureState(readPersistedDisclosure(), item.active, selected));
\t\t\t}, [sessionId, item.key]);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetDisclosure((value) => reduceConversationWorkTreeDisclosure(value, { type: "activity", active: item.active, selected }));
\t\t\t}, [item.active, selected]);
\t\t\tconst open = disclosure.open;
\t\t\tconst [renderedCount, setRenderedCount] = (0, react.useState)(() => reduceConversationWorkTreeRenderCount(0, { type: "sync", open, total: item.nodeKeys.length }));
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tsetRenderedCount((value) => reduceConversationWorkTreeRenderCount(value, { type: "sync", open, total: item.nodeKeys.length }));
\t\t\t}, [open, item.nodeKeys.length]);
\t\t\t(0, react.useEffect)(() => {
\t\t\t\tif (!open || renderedCount >= item.nodeKeys.length) return;
\t\t\t\tlet cancelled = false;
\t\t\t\tconst advance = () => { if (!cancelled) setRenderedCount((value) => reduceConversationWorkTreeRenderCount(value, { type: "advance", open: true, total: item.nodeKeys.length })); };
\t\t\t\tconst idle = globalThis.requestIdleCallback;
\t\t\t\tconst handle = typeof idle === "function" ? idle(advance, { timeout: 50 }) : globalThis.setTimeout(advance, 0);
\t\t\t\treturn () => { cancelled = true; if (typeof idle === "function") globalThis.cancelIdleCallback?.(handle); else globalThis.clearTimeout(handle); };
\t\t\t}, [open, renderedCount, item.nodeKeys.length]);
\t\t\tconst renderedNodeKeys = open ? conversationWorkTreeRenderKeys(item.nodeKeys, renderedCount, selectedNodeKey, restoreNodeKey) : [];
\t\t\tconst state = item.active ? "running" : item.failed ? "error" : item.stopped ? "stopped" : "done";
\t\t\tconst t = seatProps.t;
\t\t\tconst status = t(\`workTree.status.\${state}\`);
\t\t\tconst count = t("workTree.steps", { count: item.count });
\t\t\tconst action = t(open ? "workTree.collapse" : "workTree.expand");
\t\t\treturn (0, react_jsx_runtime.jsxs)("section", { className: "hd-work-tree", "data-state": state, "data-open": open || void 0, "data-chat-anchor-key": item.key, "data-chat-flow-key": item.key, "data-chat-flow-kind": "work-tree", children: [
\t\t\t\t(0, react_jsx_runtime.jsxs)("button", { type: "button", className: "hd-work-tree-toggle", "aria-expanded": open, "aria-label": \`\${action} · \${status} · \${count}\`, onClick: () => setDisclosure((value) => { const next = reduceConversationWorkTreeDisclosure(value, { type: "toggle" }); writeConversationWorkTreeDisclosure(disclosureStorage, sessionId, item.key, next.open); return next; }), children: [
\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: "hd-work-tree-chevron", "aria-hidden": true, children: open ? (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, {}) : (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {}) }),
\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: "hd-work-tree-title", children: t("workTree.title") }),
\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: "hd-work-tree-count", children: count }),
\t\t\t\t\t(0, react_jsx_runtime.jsx)("span", { className: "hd-work-tree-status", "aria-live": "polite", children: status })
\t\t\t\t] }),
\t\t\t\t(0, react_jsx_runtime.jsx)("div", { className: "hd-work-tree-body", hidden: !open, "aria-busy": open && renderedCount < item.nodeKeys.length || void 0, children: renderedNodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, { nodeKey, ...seatProps }, nodeKey)) })
\t\t\t] });
\t\t});
\t\tconst ChatNodeList = (0, react.memo)(function ChatNodeList({ order, nodeStore, nodeSnapshot, sessionId, savedScrollAnchorKey, ...seatProps }) {
\t\t\tconst workTreeItems = (0, react.useMemo)(() => buildConversationWorkTreeItems(order, nodeStore), [order, nodeSnapshot]);
\t\t\treturn workTreeItems.map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, { item, sessionId, savedScrollAnchorKey, ...seatProps }, sessionId + ":" + item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, { nodeKey: item.nodeKey, ...seatProps }, item.key));
\t\t});`
const ALPHA4_NODE_LIST_PROPS_ANCHOR = '\t\t\t\t\t\t\t\t\torder,\n\t\t\t\t\t\t\t\t\tuseChatNode,'
const ALPHA4_NODE_LIST_PROPS_PATCH = '\t\t\t\t\t\t\t\t\torder,\n\t\t\t\t\t\t\t\t\tnodeStore,\n\t\t\t\t\t\t\t\t\tnodeSnapshot,\n\t\t\t\t\t\t\t\t\tsessionId,\n\t\t\t\t\t\t\t\t\tsavedScrollAnchorKey: chatScroll.read()?.anchorKey,\n\t\t\t\t\t\t\t\t\tuseChatNode,'

function assertAlpha4Complete(source) {
  for (const required of [
    '@harness-desktop/conversation-work-tree-v1',
    '@harness-desktop/conversation-work-tree-reader-restore-v9',
    'var ChatTurnProcessProjector = class',
    'function buildConversationWorkTreeItems',
    'const nodeSnapshot = useChat((s) => s.nodes.values())',
    '[order, nodeSnapshot]',
    'function ConversationWorkTreeGroup',
    'useChatNodeProcess',
    'harness.desktop.work-tree-disclosure.v1:',
    'savedScrollAnchorKey: chatScroll.read()?.anchorKey'
  ]) if (!source.includes(required)) throw new Error('Installed alpha.4 conversation work-tree patch is incomplete; refusing to continue.')
}

function patchAlpha4ConversationWorkTreeSource(source) {
  if (!source.includes(ALPHA4_STYLE_ANCHOR)) return null
  if (source.includes(PATCH_MARKER)) {
    assertAlpha4Complete(source)
    return { source, changed: false }
  }
  let output = replaceExactlyOnce(source, ALPHA4_STYLE_ANCHOR, ALPHA4_STYLE_PATCH, 'alpha.4 work-tree style anchor')
  output = replaceExactlyOnce(output, ALPHA4_NODE_STORE_ANCHOR, ALPHA4_NODE_STORE_PATCH, 'alpha.4 mutable node snapshot selector')
  output = replaceExactlyOnce(output, ALPHA4_NODE_LIST_ANCHOR, ALPHA4_NODE_LIST_PATCH, 'alpha.4 work-tree node list')
  output = replaceExactlyOnce(output, ALPHA4_NODE_LIST_PROPS_ANCHOR, ALPHA4_NODE_LIST_PROPS_PATCH, 'alpha.4 work-tree node list props')
  assertAlpha4Complete(output)
  return { source: output, changed: true }
}

export function patchConversationWorkTreeSource(source) {
  const alpha4 = patchAlpha4ConversationWorkTreeSource(source)
  if (alpha4 !== null) return alpha4
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
    if (!migrated.includes(AUTO_COMPLETE_PATCH_MARKER)) {
      if (!migrated.includes(DISCLOSURE_REDUCER_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_COMPONENT_PREFIX, `${DISCLOSURE_REDUCER_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, 'work-tree disclosure reducer')
      }
      migrated = replaceExactlyOnce(migrated, PRE_AUTO_COMPLETE_STATE_BLOCK, AUTO_COMPLETE_STATE_BLOCK, 'automatic completed work-tree disclosure state')
      migrated = replaceExactlyOnce(migrated, MANUAL_TOGGLE_HANDLER, AUTO_COMPLETE_TOGGLE_HANDLER, 'user-controlled work-tree disclosure handler')
      migrated = replaceExactlyOnce(migrated, RECOVERABLE_MARKER_QUINT, AUTO_COMPLETE_MARKER_SEXT, 'automatic completed work-tree marker')
      changed = true
    }
    if (!migrated.includes(PERFORMANCE_PATCH_MARKER)) {
      if (!migrated.includes(RENDER_COUNT_REDUCER_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, `${DISCLOSURE_REDUCER_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, `${DISCLOSURE_REDUCER_SOURCE}\n${RENDER_COUNT_REDUCER_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, 'bounded work-tree render reducer')
      }
      migrated = replaceExactlyOnce(migrated, AUTO_COMPLETE_STATE_BLOCK, PERFORMANCE_STATE_BLOCK, 'incremental work-tree render state')
      migrated = replaceExactlyOnce(migrated, EAGER_WORK_TREE_CHILDREN_START, BATCHED_WORK_TREE_CHILDREN_START, 'collapsed work-tree child render')
      migrated = replaceExactlyOnce(migrated, EAGER_WORK_TREE_CHILDREN_END, BATCHED_WORK_TREE_CHILDREN_END, 'batched work-tree child render')
      migrated = replaceExactlyOnce(migrated, WORK_TREE_MEMO_ANCHOR, WORK_TREE_MEMO_PATCHED, 'memoized work-tree projection')
      migrated = replaceExactlyOnce(migrated, EAGER_WORK_TREE_RENDER, MEMOIZED_WORK_TREE_RENDER, 'memoized work-tree renderer')
      migrated = replaceExactlyOnce(migrated, AUTO_COMPLETE_MARKER_SEXT, PERFORMANCE_MARKER_SEPT, 'long-session work-tree performance marker')
      changed = true
    }
    if (!migrated.includes(SNAPSHOT_PRIORITY_PATCH_MARKER)) {
      if (migrated.includes(PRE_PRIORITY_WORK_TREE_ITEMS_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, PRE_PRIORITY_WORK_TREE_ITEMS_SOURCE, WORK_TREE_ITEMS_SOURCE, 'selected-call node ownership index')
      } else if (!migrated.includes(WORK_TREE_ITEMS_SOURCE)) {
        throw new Error('Pinned DSH work-tree grouping changed; refusing an unsafe selected-call priority migration.')
      }
      if (!migrated.includes(RENDER_KEYS_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, `${RENDER_COUNT_REDUCER_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, `${RENDER_COUNT_REDUCER_SOURCE}\n${RENDER_KEYS_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, 'selected-call priority window helper')
      }
      migrated = replaceExactlyOnce(migrated, SELECTED_CALL_V6, SELECTED_CALL_V7, 'selected-call node ownership lookup')
      migrated = replaceExactlyOnce(migrated, RENDER_KEYS_ANCHOR, RENDER_KEYS_PATCHED, 'selected-call priority render keys')
      migrated = replaceExactlyOnce(migrated, BATCHED_WORK_TREE_CHILDREN_START, PRIORITY_WORK_TREE_CHILDREN_START, 'selected-call priority child window')
      migrated = replaceExactlyOnce(migrated, BATCHED_WORK_TREE_CHILDREN_END, PRIORITY_WORK_TREE_CHILDREN_END, 'selected-call priority child window end')
      if (!migrated.includes('const nodeSnapshot = useSession((s) => s.chat.nodes.values());')) {
        migrated = replaceExactlyOnce(migrated, NODE_STORE_SELECTOR_ANCHOR, NODE_STORE_SELECTOR_PATCHED, 'mutable chat-node content snapshot selector')
      }
      if (migrated.includes(WORK_TREE_MEMO_V6)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_MEMO_V6, WORK_TREE_MEMO_PATCHED, 'chat-node content snapshot memo dependency')
      } else if (!migrated.includes(WORK_TREE_MEMO_PATCHED)) {
        throw new Error('Pinned DSH memoized work-tree projection changed; refusing an unsafe mutable-store migration.')
      }
      migrated = replaceExactlyOnce(migrated, PERFORMANCE_MARKER_SEPT, SNAPSHOT_PRIORITY_MARKER_OCT, 'snapshot-safe selected-call priority marker')
      changed = true
    }
    if (!migrated.includes(PERSISTENCE_PATCH_MARKER)) {
      if (!migrated.includes('function readConversationWorkTreeDisclosure')) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_COMPONENT_PREFIX, `${DISCLOSURE_PERSISTENCE_HELPERS_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, 'session disclosure persistence helpers')
      }
      if (migrated.includes(WORK_TREE_COMPONENT_PROPS_V7)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_COMPONENT_PROPS_V7, WORK_TREE_COMPONENT_PROPS_V8, 'session-aware work-tree component props')
      } else if (!migrated.includes(WORK_TREE_COMPONENT_PROPS_V8)) {
        throw new Error('Pinned DSH work-tree component props changed; refusing an unsafe session persistence migration.')
      }
      migrated = replaceExactlyOnce(migrated, AUTO_COMPLETE_STATE_BLOCK, PERSISTED_STATE_BLOCK, 'session disclosure state restoration')
      migrated = replaceExactlyOnce(migrated, AUTO_COMPLETE_TOGGLE_HANDLER, PERSISTED_TOGGLE_HANDLER, 'session disclosure state persistence')
      if (migrated.includes(WORK_TREE_RENDER_PROPS_V7)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_RENDER_PROPS_V7, WORK_TREE_RENDER_PROPS_V8, 'session id work-tree render prop')
      } else if (!migrated.includes(WORK_TREE_RENDER_PROPS_V8)) {
        throw new Error('Pinned DSH work-tree render props changed; refusing an unsafe session persistence migration.')
      }
      migrated = replaceExactlyOnce(migrated, SNAPSHOT_PRIORITY_MARKER_OCT, PERSISTENCE_MARKER_NONET, 'session disclosure persistence marker')
      changed = true
    }
    if (!migrated.includes(READER_RESTORE_PATCH_MARKER)) {
      if (migrated.includes(PRE_READER_RESTORE_DISCLOSURE_REDUCER_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, PRE_READER_RESTORE_DISCLOSURE_REDUCER_SOURCE, FINAL_DISCLOSURE_REDUCER_SOURCE, 'reader-controlled disclosure reducer')
      } else if (!migrated.includes(FINAL_DISCLOSURE_REDUCER_SOURCE)) {
        throw new Error('Pinned DSH work-tree disclosure reducer changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(PRE_READER_RESTORE_CREATE_STATE_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, PRE_READER_RESTORE_CREATE_STATE_SOURCE, CREATE_STATE_SOURCE, 'persisted disclosure precedence')
      } else if (!migrated.includes(CREATE_STATE_SOURCE)) {
        throw new Error('Pinned DSH work-tree persisted state helper changed; refusing an unsafe reader restoration migration.')
      }
      if (!migrated.includes(RESTORE_NODE_KEY_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_COMPONENT_PREFIX, `${RESTORE_NODE_KEY_SOURCE}\n${WORK_TREE_COMPONENT_PREFIX}`, 'saved reader anchor node lookup')
      }
      if (migrated.includes(PRE_READER_RESTORE_RENDER_KEYS_SOURCE)) {
        migrated = replaceExactlyOnce(migrated, PRE_READER_RESTORE_RENDER_KEYS_SOURCE, FINAL_RENDER_KEYS_SOURCE, 'saved reader anchor priority window')
      } else if (!migrated.includes(FINAL_RENDER_KEYS_SOURCE)) {
        throw new Error('Pinned DSH work-tree priority window helper changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(WORK_TREE_COMPONENT_PROPS_V8)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_COMPONENT_PROPS_V8, WORK_TREE_COMPONENT_PROPS_V9, 'saved reader anchor component prop')
      } else if (!migrated.includes(WORK_TREE_COMPONENT_PROPS_V9)) {
        throw new Error('Pinned DSH work-tree component props changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(SELECTED_CALL_V7) && !migrated.includes(READER_RESTORE_NODE_LOOKUP)) {
        migrated = replaceExactlyOnce(migrated, SELECTED_CALL_V7, READER_RESTORE_NODE_LOOKUP, 'saved reader anchor ownership lookup')
      } else if (!migrated.includes(READER_RESTORE_NODE_LOOKUP)) {
        throw new Error('Pinned DSH selected-call lookup changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(INITIAL_RENDER_COUNT_V8)) {
        migrated = replaceExactlyOnce(migrated, INITIAL_RENDER_COUNT_V8, INITIAL_RENDER_COUNT_V9, 'synchronous initial work-tree render window')
      } else if (!migrated.includes(INITIAL_RENDER_COUNT_V9)) {
        throw new Error('Pinned DSH initial work-tree render state changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(RENDER_KEYS_PATCHED)) {
        migrated = replaceExactlyOnce(migrated, RENDER_KEYS_PATCHED, RENDER_KEYS_READER_RESTORE, 'saved reader anchor render keys')
      } else if (!migrated.includes(RENDER_KEYS_READER_RESTORE)) {
        throw new Error('Pinned DSH rendered work-tree keys changed; refusing an unsafe reader restoration migration.')
      }
      if (!migrated.includes(WORK_TREE_MEMO_PATCHED)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_MEMO_V8, WORK_TREE_MEMO_PATCHED, 'saved reader anchor snapshot')
      }
      if (migrated.includes(WORK_TREE_RENDER_PROPS_V8)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_RENDER_PROPS_V8, WORK_TREE_RENDER_PROPS_V9, 'saved reader anchor render prop')
      } else if (!migrated.includes(WORK_TREE_RENDER_PROPS_V9)) {
        throw new Error('Pinned DSH work-tree render props changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(WORK_TREE_REACT_KEY_V8)) {
        migrated = replaceExactlyOnce(migrated, WORK_TREE_REACT_KEY_V8, WORK_TREE_REACT_KEY_V9, 'session-scoped work-tree React key')
      } else if (!migrated.includes(WORK_TREE_REACT_KEY_V9)) {
        throw new Error('Pinned DSH work-tree React key changed; refusing an unsafe reader restoration migration.')
      }
      if (migrated.includes(FORCED_SESSION_REENTRY_BLOCK)) {
        migrated = replaceExactlyOnce(migrated, FORCED_SESSION_REENTRY_BLOCK, SAVED_SESSION_REENTRY_BLOCK, 'semantic session reader restoration')
      } else if (!migrated.includes(SAVED_SESSION_REENTRY_BLOCK)) {
        throw new Error('Pinned DSH session reader restoration changed; refusing an unsafe work-tree migration.')
      }
      migrated = replaceExactlyOnce(migrated, PERSISTENCE_MARKER_NONET, READER_RESTORE_MARKER_DECET, 'reader restoration marker')
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
  output = replaceExactlyOnce(output, NODE_STORE_SELECTOR_ANCHOR, NODE_STORE_SELECTOR_PATCHED, 'mutable chat-node content snapshot selector')
  output = replaceExactlyOnce(output, WORK_TREE_MEMO_ANCHOR, WORK_TREE_MEMO_PATCHED, 'memoized work-tree projection')
  output = replaceExactlyOnce(output, RENDER_ORIGINAL, RENDER_PATCHED, 'work-tree chat flow renderer')
  output = replaceExactlyOnce(output, ZH_LOCALE_ORIGINAL, ZH_LOCALE_PATCHED, 'Chinese work-tree labels')
  output = replaceExactlyOnce(output, EN_LOCALE_ORIGINAL, EN_LOCALE_PATCHED, 'English work-tree labels')
  assertComplete(output)
  return { source: output, changed: true }
}
