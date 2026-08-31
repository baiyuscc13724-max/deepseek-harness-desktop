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
  assert.equal(group.callNodeKeys.get('root-call'), 'tool:2')
  assert.equal(group.callNodeKeys.get('child-call'), 'tool:2', 'nested calls belong to their top-level ChatNodeSeat')
})

test('completed work trees collapse only when they were opened automatically', async () => {
  const { reduceConversationWorkTreeDisclosure } = await import(pathToFileURL(patchModule).href)
  let automatic = { open: true, automatic: true, userControlled: false, active: true }
  automatic = reduceConversationWorkTreeDisclosure(automatic, { type: 'activity', active: false, selected: false })
  assert.deepEqual(automatic, { open: false, automatic: false, userControlled: false, active: false })

  let manual = reduceConversationWorkTreeDisclosure(automatic, { type: 'toggle' })
  assert.equal(manual.open, true)
  assert.equal(manual.userControlled, true)
  manual = reduceConversationWorkTreeDisclosure(manual, { type: 'activity', active: true, selected: false })
  manual = reduceConversationWorkTreeDisclosure(manual, { type: 'activity', active: false, selected: false })
  assert.equal(manual.open, true, 'a panel opened by the user stays open after later activity completes')

  let closedByUser = { open: true, automatic: true, userControlled: false, active: true }
  closedByUser = reduceConversationWorkTreeDisclosure(closedByUser, { type: 'toggle' })
  closedByUser = reduceConversationWorkTreeDisclosure(closedByUser, { type: 'activity', active: false, selected: false })
  assert.equal(closedByUser.open, false, 'a panel closed by the user is not reopened by completion')
})

test('work-tree disclosure persists independently across session switches and remounts', async () => {
  const {
    createConversationWorkTreeDisclosureState,
    readConversationWorkTreeDisclosure,
    writeConversationWorkTreeDisclosure
  } = await import(pathToFileURL(patchModule).href)
  const values = new Map()
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) }
  }

  assert.equal(writeConversationWorkTreeDisclosure(storage, 'session-a', 'work-tree:flow:1', false), true)
  assert.equal(writeConversationWorkTreeDisclosure(storage, 'session-b', 'work-tree:flow:1', true), true)
  assert.equal(readConversationWorkTreeDisclosure(storage, 'session-a', 'work-tree:flow:1'), false)
  assert.equal(readConversationWorkTreeDisclosure(storage, 'session-b', 'work-tree:flow:1'), true)

  const closedAfterReturn = createConversationWorkTreeDisclosureState(
    readConversationWorkTreeDisclosure(storage, 'session-a', 'work-tree:flow:1'),
    true,
    false
  )
  const openAfterReturn = createConversationWorkTreeDisclosureState(
    readConversationWorkTreeDisclosure(storage, 'session-b', 'work-tree:flow:1'),
    false,
    false
  )
  assert.deepEqual(closedAfterReturn, { open: false, automatic: false, userControlled: true, active: true })
  assert.deepEqual(openAfterReturn, { open: true, automatic: false, userControlled: true, active: false })
  assert.equal(createConversationWorkTreeDisclosureState(false, false, true).open, true, 'a selected call remains discoverable without overwriting the stored preference')

  storage.setItem('harness.desktop.work-tree-disclosure.v1:broken', '{bad json')
  assert.equal(readConversationWorkTreeDisclosure(storage, 'broken', 'work-tree:flow:1'), undefined)
})

test('work-tree bodies render in bounded cancelable batches', async () => {
  const { reduceConversationWorkTreeRenderCount } = await import(pathToFileURL(patchModule).href)
  let rendered = reduceConversationWorkTreeRenderCount(0, { type: 'sync', open: false, total: 4096 })
  assert.equal(rendered, 0, 'a collapsed group must not create hidden step elements')
  rendered = reduceConversationWorkTreeRenderCount(rendered, { type: 'sync', open: true, total: 4096 })
  assert.equal(rendered, 64)
  rendered = reduceConversationWorkTreeRenderCount(rendered, { type: 'sync', open: true, total: 4096 })
  assert.equal(rendered, 64, 'ordinary parent renders must not advance background work')
  rendered = reduceConversationWorkTreeRenderCount(rendered, { type: 'advance', open: true, total: 4096 })
  assert.equal(rendered, 128)
  rendered = reduceConversationWorkTreeRenderCount(rendered, { type: 'advance', open: true, total: 130 })
  assert.equal(rendered, 130)
  rendered = reduceConversationWorkTreeRenderCount(rendered, { type: 'sync', open: false, total: 4096 })
  assert.equal(rendered, 0, 'closing cancels and releases the progressive render window')
})

test('a deeply selected nested call is immediately rendered in one bounded priority window', async () => {
  const { buildConversationWorkTreeItems, conversationWorkTreeRenderKeys } = await import(pathToFileURL(patchModule).href)
  const entries = []
  for (let step = 0; step < 4000; step += 1) {
    entries.push(tool(`tool:deep:${step}`, 9, {
      kind: 'result',
      callId: `root:${step}`,
      isError: false,
      subCalls: [{ kind: 'result', callId: `nested:${step}`, isError: false, subCalls: [] }]
    }))
  }
  const group = buildConversationWorkTreeItems(entries.map(([key]) => key), new Map(entries))[0]
  const selectedNodeKey = group.callNodeKeys.get('nested:3999')
  const immediate = conversationWorkTreeRenderKeys(group.nodeKeys, 0, selectedNodeKey)
  const withPrefix = conversationWorkTreeRenderKeys(group.nodeKeys, 64, selectedNodeKey)

  assert.equal(selectedNodeKey, 'tool:deep:3999')
  assert.equal(immediate.length, 64)
  assert.ok(immediate.includes(selectedNodeKey), 'the selected node must exist on the first open render')
  assert.ok(!immediate.includes('tool:deep:0'), 'priority rendering must not materialize the whole prefix')
  assert.ok(withPrefix.length <= 128)
  assert.ok(withPrefix.includes('tool:deep:0'))
  assert.ok(withPrefix.includes(selectedNodeKey))
  assert.equal(new Set(withPrefix).size, withPrefix.length)
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

test('thousand-turn transcripts and large tool groups keep collapsed render work bounded', async () => {
  const { buildConversationWorkTreeItems, reduceConversationWorkTreeRenderCount } = await import(pathToFileURL(patchModule).href)
  const entries = []
  for (let turn = 0; turn < 1000; turn += 1) {
    entries.push([`user:${turn}`, { kind: 'user', location: location(turn), data: {} }])
    for (let step = 0; step < 4; step += 1) {
      entries.push(tool(`tool:${turn}:${step}`, turn, { kind: 'result', callId: `call:${turn}:${step}`, isError: false, subCalls: [] }))
    }
    entries.push(assistant(`assistant:${turn}`, turn, 'done'))
  }
  const items = buildConversationWorkTreeItems(entries.map(([key]) => key), new Map(entries))
  assert.equal(items.length, 3000)
  assert.equal(items.filter(item => item.kind === 'work-tree').reduce((total, item) => total + item.nodeKeys.length, 0), 4000)
  assert.equal(reduceConversationWorkTreeRenderCount(0, { type: 'sync', open: false, total: 4000 }), 0)
  assert.equal(reduceConversationWorkTreeRenderCount(0, { type: 'sync', open: true, total: 4000 }), 64)
})

test('memo dependency follows the upstream mutable node-store content snapshot contract', async () => {
  const { patchConversationWorkTreeSource } = await import(pathToFileURL(patchModule).href)
  const source = await readFile(conversationRuntime, 'utf8')
  assert.match(source, /var MutableChatNodeStore = class \{[\s\S]*values\(\) \{[\s\S]*if \(this\.valuesDirty\)[\s\S]*this\.valuesCache = \[\.\.\.this\.byKey\.values\(\)\]/u)
  assert.match(source, /upsert\(nodes\) \{[\s\S]*this\.byKey\.set\(node\.key, node\)[\s\S]*if \(changed\) this\.valuesDirty = true/u)
  assert.match(source, /store = new MutableChatNodeStore\(\)/u)
  assert.match(source, /this\.store\.upsert\(upserts\)[\s\S]*this\.order = sameReferences\$1\(this\.order, next\) \? this\.order : next/u)
  assert.match(source, /nodes: this\.store/u)

  const classStart = source.indexOf('var MutableChatNodeStore = class {')
  const classEnd = source.indexOf('\n\t\tvar MutableChatLocationIndex = class {', classStart)
  assert.ok(classStart >= 0 && classEnd > classStart)
  const MutableChatNodeStore = new Function('EMPTY_LIST', `${source.slice(classStart, classEnd)}\nreturn MutableChatNodeStore;`)([])
  const store = new MutableChatNodeStore()
  const order = ['node:1']
  store.upsert([{ key: 'node:1', data: { status: 'running' } }])
  const firstSnapshot = store.values()
  store.upsert([{ key: 'node:1', data: { status: 'settled' } }])
  const secondSnapshot = store.values()
  assert.deepEqual(order, ['node:1'], 'content-only upserts keep the structural order reference valid')
  assert.notEqual(secondSnapshot, firstSnapshot, 'values() publishes a new cached content snapshot after an in-place upsert')
  assert.equal(secondSnapshot[0].data.status, 'settled')

  const patched = patchConversationWorkTreeSource(source).source
  assert.match(patched, /const nodeSnapshot = useSession\(\(s\) => s\.chat\.nodes\.values\(\)\)/u)
  assert.match(patched, /buildConversationWorkTreeItems\(order, nodeStore\), \[order, nodeSnapshot\]/u)
  assert.doesNotMatch(patched, /buildConversationWorkTreeItems\(order, nodeStore\), \[order, nodeStore\]/u)
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
    '@harness-desktop/conversation-work-tree-auto-complete-v5',
    '@harness-desktop/conversation-work-tree-performance-v6',
    '@harness-desktop/conversation-work-tree-snapshot-priority-v7',
    '@harness-desktop/conversation-work-tree-persistence-v8',
    'reduceConversationWorkTreeDisclosure',
    'readConversationWorkTreeDisclosure',
    'writeConversationWorkTreeDisclosure',
    'createConversationWorkTreeDisclosureState',
    'harness.desktop.work-tree-disclosure.v1:',
    'sessionId, item.key',
    'reduceConversationWorkTreeRenderCount',
    'conversationWorkTreeRenderKeys',
    'userControlled: false',
    'type: "toggle"',
    'FS_EDIT_NOT_FOUND',
    '"row.retry": "未应用，需要重新定位"',
    '"row.retry": "Not applied; target needs to be located again"',
    'work-tree:flow:',
    'position:sticky',
    'scroll-margin-top:64px',
    'DSH_DESKTOP_MEMOIZED_WORK_TREE',
    'const nodeSnapshot = useSession((s) => s.chat.nodes.values())',
    '[order, nodeSnapshot]',
    'workTreeItems.map',
    'item.callNodeKeys.get(selectedCallId)',
    'conversationWorkTreeRenderKeys(item.nodeKeys, renderedCount, selectedNodeKey)',
    'requestIdleCallback',
    '"aria-expanded": open',
    'hidden: !open',
    '"data-chat-anchor-key": item.key',
    '"aria-live": "polite"',
    '"workTree.title": "工作过程"',
    '"workTree.title": "Work activity"',
    '@media(prefers-reduced-motion:reduce)'
  ]) assert.match(once.source, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  assert.doesNotMatch(once.source, /wasActive\.current|setOpen\(item\.active\)|children: item\.nodeKeys\.map|item\.nodeKeys\.slice\(0, renderedCount\)|buildConversationWorkTreeItems\(order, nodeStore\)\.map|\[order, nodeStore\]/u)
})
