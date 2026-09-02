'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const CONVERSATION_FILE = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
const CHAT_FILE = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js')

const OWNER_PAIRS = Object.freeze({
  seat: [
    'const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, selectedCallId,',
    'const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, sessionId, selectedCallId,'
  ],
  owner: [
    `\t\t\tconst owner = (0, react.useMemo)(() => node === void 0 ? null : {
\t\t\t\tselectedCallId,`,
    `\t\t\tconst owner = (0, react.useMemo)(() => node === void 0 ? null : {
\t\t\t\tsessionId,
\t\t\t\tselectedCallId,`
  ],
  dependency: [
    `\t\t\t}, [
\t\t\t\tnode,
\t\t\t\tselectedCallId,`,
    `\t\t\t}, [
\t\t\t\tnode,
\t\t\t\tsessionId,
\t\t\t\tselectedCallId,`
  ],
  group: [
    'const ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, useSession,',
    'const ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, sessionId, useSession,'
  ],
  rootNode: [
    `\t\t\t\t\t\t\t}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey: item.nodeKey,
\t\t\t\t\t\t\t\tuseSession,`,
    `\t\t\t\t\t\t\t}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey: item.nodeKey,
\t\t\t\t\t\t\t\tsessionId,
\t\t\t\t\t\t\t\tuseSession,`
  ],
  rawList: [
    `\t\t\t\t\t\t\tbuildConversationWorkTreeItems(order, nodeStore).map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tuseSession,`,
    `\t\t\t\t\t\t\tbuildConversationWorkTreeItems(order, nodeStore).map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tsessionId,
\t\t\t\t\t\t\t\tuseSession,`
  ],
  renderedList: [
    `\t\t\t\t\t\t\tworkTreeItems.map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tuseSession,`,
    `\t\t\t\t\t\t\tworkTreeItems.map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tsessionId,
\t\t\t\t\t\t\t\tuseSession,`
  ],
  rawNested: [
    `\t\t\t\t\tchildren: item.nodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\tuseSession,`,
    `\t\t\t\t\tchildren: item.nodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\tsessionId,
\t\t\t\t\t\tuseSession,`
  ],
  renderedNested: [
    `\t\t\t\t\tchildren: renderedNodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\tuseSession,`,
    `\t\t\t\t\tchildren: renderedNodeKeys.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\tsessionId,
\t\t\t\t\t\tuseSession,`
  ]
})

const FLAT_OWNER_PAIR = Object.freeze([
  `\t\t\t\t\t\t\torder.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\t\t\tuseSession,`,
  `\t\t\t\t\t\t\torder.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\t\t\tsessionId,
\t\t\t\t\t\t\t\tuseSession,`
])

const LABEL_PAIRS = Object.freeze([
  [
    `\t\t\t"image.remove": "移除图片 {name}",`,
    `\t\t\t"image.remove": "移除图片 {name}",
\t\t\t"image.copy": "复制图片 {name}",
\t\t\t"image.cut": "剪切图片 {name}",`
  ],
  [
    `\t\t\t"image.remove": "Remove image {name}",`,
    `\t\t\t"image.remove": "Remove image {name}",
\t\t\t"image.copy": "Copy image {name}",
\t\t\t"image.cut": "Cut image {name}",`
  ]
])

const ALPHA2_QUEUE_PAIR = Object.freeze([
  'const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued"), [inbox]);',
  'const queue = (0, react.useMemo)(() => inbox.filter((row) => row.placement === "queued" && !String(row.text ?? row.preview ?? "").startsWith("[Agent team message ")), [inbox]);'
])

const ALPHA2_USAGE_PAIR = Object.freeze([
  'const usage = useProjection("tokenUsage");\n\t\t\tconst projected = useProjection("sessionStats");',
  'const usage = useProjection("tokenUsage");\n\t\t\tconst cacheDetail = useProjection("tokenUsageDetail");\n\t\t\tconst projected = useProjection("sessionStats");'
])

function replaceOnce(source, original, replacement, label) {
  const first = source.indexOf(original)
  assert.ok(first >= 0, `missing fixture anchor: ${label}`)
  assert.equal(source.indexOf(original, first + original.length), -1, `duplicate fixture anchor: ${label}`)
  return source.slice(0, first) + replacement + source.slice(first + original.length)
}

function ownerFixture(index) {
  return [
    OWNER_PAIRS.seat[index],
    OWNER_PAIRS.owner[index],
    OWNER_PAIRS.dependency[index],
    OWNER_PAIRS.group[index],
    OWNER_PAIRS.rootNode[index],
    OWNER_PAIRS.rawList[index],
    OWNER_PAIRS.rawNested[index]
  ].join('\n/* exact pinned separator */\n')
}

function rawOwnerFixture() {
  return ownerFixture(0)
}

function flatOwnerFixture() {
  return [
    OWNER_PAIRS.seat[0],
    OWNER_PAIRS.owner[0],
    OWNER_PAIRS.dependency[0],
    FLAT_OWNER_PAIR[0]
  ].join('\n/* exact pinned separator */\n')
}

function renderedOwnerFixture() {
  let source = rawOwnerFixture()
  source = replaceOnce(source, OWNER_PAIRS.rawList[0], OWNER_PAIRS.renderedList[0], 'rendered work-tree list')
  source = replaceOnce(source, OWNER_PAIRS.rawNested[0], OWNER_PAIRS.renderedNested[0], 'rendered work-tree nodes')
  return source
}

function cacheFirstOwnerFixture() {
  let source = rawOwnerFixture()
  source = replaceOnce(source, OWNER_PAIRS.group[0], OWNER_PAIRS.group[1], 'work-tree group session input')
  source = replaceOnce(source, OWNER_PAIRS.rawList[0], OWNER_PAIRS.renderedList[1], 'work-tree rendered list session forwarding')
  source = replaceOnce(source, OWNER_PAIRS.rawNested[0], OWNER_PAIRS.renderedNested[0], 'work-tree rendered child shape')
  return source
}

function alpha2CompositionFixture() {
  const installedConversation = fs.readFileSync(CONVERSATION_FILE, 'utf8')
  const installedChat = fs.readFileSync(CHAT_FILE, 'utf8')
  let conversationSource = replaceOnce(installedConversation, ALPHA2_QUEUE_PAIR[1], ALPHA2_QUEUE_PAIR[0], 'alpha.2 queue')
  for (const [original, patched] of LABEL_PAIRS) conversationSource = replaceOnce(conversationSource, patched, original, `locale ${original}`)
  const chatSource = replaceOnce(installedChat, ALPHA2_USAGE_PAIR[1], ALPHA2_USAGE_PAIR[0], 'alpha.2 cache projection consumer')
  return { installedConversation, installedChat, conversationSource, chatSource }
}

test('owner patch accepts raw grouped source and remains idempotent', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const raw = rawOwnerFixture()
  const first = patchToolResultOwnerSource(raw)
  assert.equal(first.changed, true)
  assert.match(first.source, /ChatNodeSeat\(\{ nodeKey, sessionId, selectedCallId,/u)
  assert.match(first.source, /ConversationWorkTreeGroup\(\{ item, sessionId, useSession,/u)
  assert.match(first.source, /item\.nodeKeys\.map[\s\S]*sessionId,[\s\S]*useSession,/u)
  assert.equal(patchToolResultOwnerSource(first.source).changed, false)
})

test('owner patch accepts rendered grouped source and remains idempotent', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const first = patchToolResultOwnerSource(renderedOwnerFixture())
  assert.equal(first.changed, true)
  assert.match(first.source, /workTreeItems\.map[\s\S]*sessionId,[\s\S]*useSession,/u)
  assert.match(first.source, /renderedNodeKeys\.map[\s\S]*sessionId,[\s\S]*useSession,/u)
  assert.equal(patchToolResultOwnerSource(first.source).changed, false)
})

test('owner patch accepts flat source and remains idempotent', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const first = patchToolResultOwnerSource(flatOwnerFixture())
  assert.equal(first.changed, true)
  assert.match(first.source, /order\.map[\s\S]*nodeKey,[\s\S]*sessionId,[\s\S]*useSession,/u)
  assert.doesNotMatch(first.source, /ConversationWorkTreeGroup/u)
  assert.equal(patchToolResultOwnerSource(first.source).changed, false)
})

test('fully patched grouped and flat family union fails closed', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const groupedPatched = patchToolResultOwnerSource(rawOwnerFixture()).source
  const mixed = `${groupedPatched}\n/* forbidden patched family union */\n${FLAT_OWNER_PAIR[1]}`
  assert.throws(() => patchToolResultOwnerSource(mixed), /owner patch is incomplete/u)
})

test('mixed patched grouped variants fail closed in both directions', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const rawPatched = patchToolResultOwnerSource(rawOwnerFixture()).source
  const renderedPatched = patchToolResultOwnerSource(renderedOwnerFixture()).source
  const rawListRenderedNode = replaceOnce(rawPatched, OWNER_PAIRS.rawNested[1], OWNER_PAIRS.renderedNested[1], 'patched raw-list rendered-node mix')
  const renderedListRawNode = replaceOnce(renderedPatched, OWNER_PAIRS.renderedNested[1], OWNER_PAIRS.rawNested[1], 'patched rendered-list raw-node mix')
  assert.throws(() => patchToolResultOwnerSource(rawListRenderedNode), /owner patch is incomplete/u)
  assert.throws(() => patchToolResultOwnerSource(renderedListRawNode), /owner patch is incomplete/u)
})

test('mixed original grouped variants fail closed before patching in both directions', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const rawListRenderedNode = replaceOnce(rawOwnerFixture(), OWNER_PAIRS.rawNested[0], OWNER_PAIRS.renderedNested[0], 'original raw-list rendered-node mix')
  const renderedListRawNode = replaceOnce(renderedOwnerFixture(), OWNER_PAIRS.renderedNested[0], OWNER_PAIRS.rawNested[0], 'original rendered-list raw-node mix')
  assert.throws(() => patchToolResultOwnerSource(rawListRenderedNode), /variant pairing changed/u)
  assert.throws(() => patchToolResultOwnerSource(renderedListRawNode), /variant pairing changed/u)
})

test('marker-free raw source cannot combine grouped and flat owner shape families', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const mixed = `${rawOwnerFixture()}\n/* forbidden family union */\n${FLAT_OWNER_PAIR[0]}`
  assert.throws(() => patchToolResultOwnerSource(mixed), /owner shape families are mixed/u)
})

test('exact cache-first work-tree state reproduces the legacy partial markers and is now completed safely', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const historical = cacheFirstOwnerFixture()
  const legacyPresent = [OWNER_PAIRS.group[1], OWNER_PAIRS.renderedList[1]].filter(marker => historical.includes(marker))
  assert.equal(legacyPresent.length, 2, 'the historical strict gate saw partial owner markers before owner ran')
  assert.doesNotMatch(historical, /ChatNodeSeat\(\{ nodeKey, sessionId, selectedCallId,/u)

  const fixed = patchToolResultOwnerSource(historical)
  assert.equal(fixed.changed, true)
  assert.match(fixed.source, /ChatNodeSeat\(\{ nodeKey, sessionId, selectedCallId,/u)
  assert.match(fixed.source, /renderedNodeKeys\.map[\s\S]*sessionId,[\s\S]*useSession,/u)
  assert.equal(patchToolResultOwnerSource(fixed.source).changed, false)
})

test('raw-list session forwarding is not accepted as the cache work-tree intermediate', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  let malicious = rawOwnerFixture()
  malicious = replaceOnce(malicious, OWNER_PAIRS.group[0], OWNER_PAIRS.group[1], 'group session input without cache renderer')
  malicious = replaceOnce(malicious, OWNER_PAIRS.rawList[0], OWNER_PAIRS.rawList[1], 'raw-list session forwarding')
  assert.throws(() => patchToolResultOwnerSource(malicious), /owner patch is incomplete/u)
})

test('alpha.4 native conversation, attachment, turn-outline, reconnect, and schedule owners are hash-pinned and never repatched', async () => {
  const { assertInstalledAlpha4NativeCapabilities } = await import('../scripts/patch-official-runtime.mjs')
  const before = new Map([
    ['conversation', fs.readFileSync(CONVERSATION_FILE, 'utf8')],
    ['chat', fs.readFileSync(CHAT_FILE, 'utf8')]
  ])
  assert.equal(await assertInstalledAlpha4NativeCapabilities(), false)
  assert.equal(await assertInstalledAlpha4NativeCapabilities(), false, 'official native verification must be idempotent')
  assert.equal(fs.readFileSync(CONVERSATION_FILE, 'utf8'), before.get('conversation'))
  assert.equal(fs.readFileSync(CHAT_FILE, 'utf8'), before.get('chat'))
  const runtime = fs.readFileSync(path.join(ROOT, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  for (const installer of ['patchInstalledConversation', 'patchInstalledAttachmentInput', 'patchInstalledModelSelection', 'patchInstalledModelSettings', 'patchInstalledWorkspaceUi']) {
    assert.match(runtime, new RegExp(`targetsAlpha4 \\? false :[^;]*${installer}`, 'u'), `${installer} must not override an alpha.4 native owner`)
  }
})

test('unrecognized partial owner markers still fail closed', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const malicious = replaceOnce(rawOwnerFixture(), OWNER_PAIRS.seat[0], OWNER_PAIRS.seat[1], 'partial owner seat')
  assert.throws(() => patchToolResultOwnerSource(malicious), /owner patch is incomplete/u)
})
