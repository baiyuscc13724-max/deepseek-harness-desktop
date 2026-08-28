const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const patchModule = path.join(root, 'scripts', 'conversation-work-tree-patch.mjs')
const conversationRuntime = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')

function location(turn, status = 'closed', step = 1) {
  return { kind: 'step', turn: { turn, status }, step: { step } }
}

function assistant(key, turn, text, status = 'settled') {
  return [key, {
    key,
    kind: 'assistant-step',
    location: location(turn, status === 'running' ? 'open' : 'closed'),
    data: { status, blocks: text === null ? [{ kind: 'reasoning', text: 'thinking' }] : [{ kind: 'text', text }] }
  }]
}

function tool(key, turn, root, turnStatus = 'closed') {
  return [key, { key, kind: 'tool-call', location: location(turn, turnStatus), data: { root } }]
}

test('conversation flow keeps the user and final assistant reply while grouping work by turn', async () => {
  const { buildConversationWorkTreeItems } = await import(pathToFileURL(patchModule).href)
  const entries = [
    ['user:1', { key: 'user:1', kind: 'user', location: location(1), data: {} }],
    assistant('assistant:1:1', 1, 'I will inspect it.'),
    tool('tool:1', 1, { kind: 'result', callId: 'call-1', isError: false, subCalls: [] }),
    assistant('assistant:1:2', 1, 'The change is complete.')
  ]
  const store = new Map(entries)
  const items = buildConversationWorkTreeItems(entries.map(([key]) => key), store)

  assert.deepEqual(items.map(item => item.kind), ['node', 'work-tree', 'node'])
  assert.equal(items[0].nodeKey, 'user:1')
  assert.deepEqual(items[1].nodeKeys, ['assistant:1:1', 'tool:1'])
  assert.equal(items[1].count, 2)
  assert.equal(items[1].active, false)
  assert.equal(items[2].nodeKey, 'assistant:1:2')
})

test('work trees never pull later work above a new user message', async () => {
  const { buildConversationWorkTreeItems } = await import(pathToFileURL(patchModule).href)
  const entries = [
    ['user:1', { key: 'user:1', kind: 'user', location: location(1), data: {} }],
    tool('tool:1', 1, { kind: 'result', callId: 'call-1', isError: false, subCalls: [] }),
    assistant('assistant:1', 1, 'First task finished.'),
    ['user:2', { key: 'user:2', kind: 'user', location: location(2, 'open'), data: {} }],
    ['context:2', { key: 'context:2', kind: 'context', location: { kind: 'session' }, data: {} }],
    tool('tool:2', 2, { callId: 'call-2', subCalls: [] }, 'open')
  ]
  const items = buildConversationWorkTreeItems(entries.map(([key]) => key), new Map(entries))

  assert.deepEqual(items.map(item => item.kind), ['node', 'work-tree', 'node', 'node', 'work-tree'])
  assert.equal(items[2].nodeKey, 'assistant:1')
  assert.equal(items[3].nodeKey, 'user:2')
  assert.deepEqual(items[4].nodeKeys, ['context:2', 'tool:2'])
  assert.match(items[4].key, /^work-tree:flow:/)
})

test('work tree counts nested calls and exposes running, failed, stopped, and selected-call state', async () => {
  const { buildConversationWorkTreeItems } = await import(pathToFileURL(patchModule).href)
  const runningRoot = {
    callId: 'root-call',
    subCalls: [{ kind: 'result', callId: 'child-call', isError: true, subCalls: [] }]
  }
  const entries = [
    ['user:2', { key: 'user:2', kind: 'user', location: location(2, 'open'), data: {} }],
    assistant('assistant:2:reasoning', 2, null, 'running'),
    tool('tool:2', 2, runningRoot, 'open')
  ]
  const group = buildConversationWorkTreeItems(entries.map(([key]) => key), new Map(entries)).find(item => item.kind === 'work-tree')

  assert.ok(group)
  assert.equal(group.count, 3)
  assert.equal(group.active, true)
  assert.equal(group.failed, true)
  assert.deepEqual(group.callIds, ['root-call', 'child-call'])
})

test('recoverable edit no-ops do not leave the completed work tree in a permanent failure state', async () => {
  const { buildConversationWorkTreeItems } = await import(pathToFileURL(patchModule).href)
  const entries = [
    ['user:3', { key: 'user:3', kind: 'user', location: location(3), data: {} }],
    tool('tool:3', 3, {
      kind: 'result',
      callId: 'edit-miss',
      call: { name: 'edit' },
      isError: true,
      error: { code: 'FS_EDIT_NOT_FOUND' },
      subCalls: []
    }),
    assistant('assistant:3', 3, 'Recovered after re-reading the target file.')
  ]
  const group = buildConversationWorkTreeItems(entries.map(([key]) => key), new Map(entries)).find(item => item.kind === 'work-tree')

  assert.ok(group)
  assert.equal(group.failed, false)
  assert.equal(group.active, false)
})

test('session-level context rows collapse instead of leaking system activity into the conversation', async () => {
  const { buildConversationWorkTreeItems } = await import(pathToFileURL(patchModule).href)
  const entries = [
    ['context:1', { key: 'context:1', kind: 'context', location: { kind: 'session' }, data: {} }],
    ['context:2', { key: 'context:2', kind: 'context', location: { kind: 'session' }, data: {} }]
  ]
  const items = buildConversationWorkTreeItems(entries.map(([key]) => key), new Map(entries))

  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'work-tree')
  assert.deepEqual(items[0].nodeKeys, ['context:1', 'context:2'])
  assert.equal(items[0].count, 2)
  assert.equal(items[0].active, false)
})

test('guarded runtime patch is idempotent and includes disclosure, locale, and scroll-anchor contracts', async () => {
  const { patchConversationWorkTreeSource } = await import(pathToFileURL(patchModule).href)
  const source = await readFile(conversationRuntime, 'utf8')
  const once = patchConversationWorkTreeSource(source)
  const twice = patchConversationWorkTreeSource(once.source)

  assert.equal(twice.changed, false)
  assert.equal(twice.source, once.source)
  for (const contract of [
    '@harness-desktop/conversation-work-tree-v1',
    '@harness-desktop/conversation-work-tree-sticky-v1',
    '@harness-desktop/conversation-work-tree-flow-v2',
    '@harness-desktop/conversation-work-tree-manual-v3',
    '@harness-desktop/conversation-work-tree-recoverable-v4',
    'FS_EDIT_NOT_FOUND',
    '"row.retry": "未应用，需要重新定位"',
    '"row.retry": "Not applied; target needs to be located again"',
    'work-tree:flow:',
    'position:sticky',
    'scroll-margin-top:64px',
    'buildConversationWorkTreeItems(order, nodeStore).map',
    '"aria-expanded": open',
    'hidden: !open',
    '"data-chat-anchor-key": item.key',
    '"aria-live": "polite"',
    '"workTree.title": "工作过程"',
    '"workTree.title": "Work activity"',
    '@media(prefers-reduced-motion:reduce)'
  ]) assert.match(once.source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(once.source, /wasActive\.current|setOpen\(item\.active\)/u)
})
