'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '..')
const CONVERSATION_FILE = path.join(ROOT, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')

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

function replaceOnce(source, original, replacement, label) {
  const first = source.indexOf(original)
  assert.ok(first >= 0, `missing fixture anchor: ${label}`)
  assert.equal(source.indexOf(original, first + original.length), -1, `duplicate fixture anchor: ${label}`)
  return source.slice(0, first) + replacement + source.slice(first + original.length)
}

function rawOwnerFixture() {
  return [
    OWNER_PAIRS.seat[0],
    OWNER_PAIRS.owner[0],
    OWNER_PAIRS.dependency[0],
    OWNER_PAIRS.group[0],
    OWNER_PAIRS.rootNode[0],
    OWNER_PAIRS.rawList[0],
    OWNER_PAIRS.rawNested[0]
  ].join('\n/* exact pinned separator */\n')
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

function preCompositionFixture(installed) {
  let source = installed
  for (const key of ['seat', 'owner', 'dependency', 'rootNode', 'renderedNested']) {
    const [original, patched] = OWNER_PAIRS[key]
    source = replaceOnce(source, patched, original, `owner ${key}`)
  }
  for (const [original, patched] of LABEL_PAIRS) source = replaceOnce(source, patched, original, `locale ${original}`)
  return source
}

async function withTempConversation(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-conversation-composition-'))
  const file = path.join(directory, 'client.js')
  fs.writeFileSync(file, source, 'utf8')
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return file
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

test('all three conversation transforms compose before one write and the second pass is idempotent', async t => {
  const { patchConversationSource, patchInstalledConversation } = await import('../scripts/patch-official-runtime.mjs')
  const installed = fs.readFileSync(CONVERSATION_FILE, 'utf8')
  const before = preCompositionFixture(installed)
  const composed = patchConversationSource(before)
  assert.equal(composed.changed, true)
  assert.equal(composed.source, installed)
  assert.equal(patchConversationSource(composed.source).changed, false)

  const file = await withTempConversation(t, before)
  assert.equal(await patchInstalledConversation(file), true)
  assert.equal(fs.readFileSync(file, 'utf8'), installed)
  assert.equal(await patchInstalledConversation(file), false)
  assert.equal(fs.readFileSync(file, 'utf8'), installed)
})

for (const [label, drift] of [
  ['cache anchor', source => replaceOnce(source, 'const cacheDetail = useProjection("tokenUsageDetail");', 'const cacheDetail = useProjection("tokenUsageDetail-drift");', 'cache detail')],
  ['owner anchor', source => replaceOnce(source, OWNER_PAIRS.seat[0], OWNER_PAIRS.seat[0].replace('selectedCallId,', 'selectedCallId /* drift */,'), 'owner seat')],
  ['attachment-label anchor', source => replaceOnce(source, LABEL_PAIRS[0][0], LABEL_PAIRS[0][0].replace('移除图片', '恶意漂移'), 'Chinese attachment label')]
]) {
  test(`${label} drift fails closed without writing conversation`, async t => {
    const { patchInstalledConversation } = await import('../scripts/patch-official-runtime.mjs')
    const installed = fs.readFileSync(CONVERSATION_FILE, 'utf8')
    const malicious = drift(preCompositionFixture(installed))
    const file = await withTempConversation(t, malicious)
    await assert.rejects(patchInstalledConversation(file), /Pinned DSH|incomplete/u)
    assert.equal(fs.readFileSync(file, 'utf8'), malicious)
  })
}

test('unrecognized partial owner markers still fail closed', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const malicious = replaceOnce(rawOwnerFixture(), OWNER_PAIRS.seat[0], OWNER_PAIRS.seat[1], 'partial owner seat')
  assert.throws(() => patchToolResultOwnerSource(malicious), /owner patch is incomplete/u)
})
