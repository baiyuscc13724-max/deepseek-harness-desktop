const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const toolUiFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-tool', 'lib', 'client.js')
const conversationFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')
const deliverablesFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-deliverables', 'lib', 'client.js')

function projectedResultImages(source) {
  const start = source.indexOf('function resultImages(block)')
  const end = source.indexOf('\n\t\tfunction parseArgs', start)
  assert.ok(start >= 0 && end > start)
  return Function(`${source.slice(start, end)}; return resultImages`)()
}

test('durable tool-result images render through the alpha.2 Chat image seat without flattening metadata', async () => {
  const { patchAlpha2ToolResultImageSource } = await import('../scripts/tool-result-image-patch.mjs')
  const fixture = readFileSync(toolUiFile, 'utf8')
  const first = patchAlpha2ToolResultImageSource(fixture)
  const patched = first.source

  assert.match(patched, /function resultImages\(block\)/u)
  assert.match(patched, /item\?\.type === "image" && item\.attachment !== void 0/u)
  assert.match(patched, /else if \(block\.type !== "image"\) parts\.push\(JSON\.stringify/u)
  assert.match(patched, /renderMessageImages\(\{\s*images,\s*align: "start"/u)
  assert.doesNotThrow(() => new Function(patched))
  assert.equal(patchAlpha2ToolResultImageSource(patched).changed, false)

  const resultImages = projectedResultImages(patched)
  const attachment = { attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 12, width: 2, height: 3 }
  assert.deepEqual(resultImages({ kind: 'tool-result', content: [
    { type: 'text', text: 'created' },
    { type: 'image', attachment },
    { type: 'image' },
    { type: 'json', value: true }
  ] }), [{ attachment }])
  assert.deepEqual(resultImages({ name: 'image_gen', content: [{ type: 'image', attachment }] }), [])
})

test('native alpha.2 produced-file projection is tool-led and ignores closing prose', () => {
  const source = readFileSync(deliverablesFile, 'utf8')
  assert.match(source, /function mutationPath\(name, argsRaw\)/u)
  assert.match(source, /case "write": return typeof args\.content === "string" \? pathValue\(args\.file_path\) : null/u)
  assert.match(source, /case "edit": return validEditArgs\(args\) \? pathValue\(args\.file_path\) : null/u)
  assert.match(source, /function producedForClosing\(data, seq = Number\.POSITIVE_INFINITY\)/u)
  assert.match(source, /for \(const produced of data\.produced\)/u)
  assert.match(source, /if \(produced\.seq > seq \|\| seen\.has\(produced\.path\)\) continue/u)
  assert.match(source, /function producedFileMentions\(paths, openFile, label\)/u)
  assert.match(source, /const matches = paths\.filter\(\(path\) => basename\(path\) === value\)/u)
  assert.doesNotMatch(source, /JSON\.parse\(.*closing|workspace_image_path|local_log_paths/u)
  assert.doesNotThrow(() => new Function(source))
})

test('image generation already persists one attachment before chat delivery', () => {
  const bridge = readFileSync(path.join(root, 'plugins', 'dsh-codex-image-bridge', 'src', 'core.js'), 'utf8')
  const registration = readFileSync(path.join(root, 'plugins', 'dsh-codex-image-bridge', 'src', 'index.js'), 'utf8')

  assert.match(bridge, /ref = await services\.attachments\.saveImage\(output\)/u)
  assert.match(bridge, /image:\s*\{\s*attachmentId: ref\.attachmentId/u)
  assert.match(registration, /\{ type: "image", attachment: imageRef\(value\.image\) \}/u)
})

test('session owner patch supports the pinned flat conversation tree and remains idempotent', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const fixture = `const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, selectedCallId,
\t\t\tconst owner = (0, react.useMemo)(() => node === void 0 ? null : {
\t\t\t\tselectedCallId,
\t\t\t}, [
\t\t\t\tnode,
\t\t\t\tselectedCallId,
\t\t\t\t\t\t\torder.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\t\t\tuseSession,`
  const first = patchToolResultOwnerSource(fixture)
  assert.equal(first.changed, true)
  assert.match(first.source, /ChatNodeSeat\(\{ nodeKey, sessionId, selectedCallId,/u)
  assert.match(first.source, /node === void 0 \? null : \{\s*sessionId,\s*selectedCallId,/u)
  assert.match(first.source, /order\.map\(\(nodeKey\)[\s\S]*nodeKey,\s*sessionId,\s*useSession,/u)
  assert.doesNotMatch(first.source, /ConversationWorkTreeGroup/u)
  assert.equal(patchToolResultOwnerSource(first.source).changed, false)
})

test('session owner patch supports exact raw and rendered grouped trees while partial variants fail closed', async () => {
  const { patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const groupedFixture = (nodeKeys, listItems) => `const ChatNodeSeat = (0, react.memo)(function ChatNodeSeat({ nodeKey, selectedCallId,
\t\t\tconst owner = (0, react.useMemo)(() => node === void 0 ? null : {
\t\t\t\tselectedCallId,
\t\t\t}, [
\t\t\t\tnode,
\t\t\t\tselectedCallId,
const ConversationWorkTreeGroup = (0, react.memo)(function ConversationWorkTreeGroup({ item, useSession,
\t\t\t\t\tchildren: ${nodeKeys}.map((nodeKey) => (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\tnodeKey,
\t\t\t\t\t\tuseSession,
\t\t\t\t\t\t\t${listItems}.map((item) => item.kind === "work-tree" ? (0, react_jsx_runtime.jsx)(ConversationWorkTreeGroup, {
\t\t\t\t\t\t\t\titem,
\t\t\t\t\t\t\t\tuseSession,
\t\t\t\t\t\t\t}, item.key) : (0, react_jsx_runtime.jsx)(ChatNodeSeat, {
\t\t\t\t\t\t\t\tnodeKey: item.nodeKey,
\t\t\t\t\t\t\t\tuseSession,`

  for (const [nodeKeys, listItems] of [['item.nodeKeys', 'buildConversationWorkTreeItems(order, nodeStore)'], ['renderedNodeKeys', 'workTreeItems']]) {
    const first = patchToolResultOwnerSource(groupedFixture(nodeKeys, listItems))
    assert.equal(first.changed, true)
    assert.match(first.source, /ConversationWorkTreeGroup\(\{ item, sessionId, useSession,/u)
    assert.match(first.source, new RegExp(`${nodeKeys.replace('.', '\\.')}\\.map\\(\\(nodeKey\\)[\\s\\S]*nodeKey,\\s*sessionId,\\s*useSession,`, 'u'))
    assert.match(first.source, new RegExp(`${listItems.replace(/[().]/gu, '\\$&')}\\.map\\(\\(item\\)[\\s\\S]*item,\\s*sessionId,\\s*useSession,`, 'u'))
    assert.match(first.source, /nodeKey: item\.nodeKey,\s*sessionId,\s*useSession,/u)
    assert.equal(patchToolResultOwnerSource(first.source).changed, false)

    const partial = first.source.replace(new RegExp(`(${nodeKeys.replace('.', '\\.')}\\.map\\(\\(nodeKey\\)[\\s\\S]*?nodeKey,)\\s*sessionId,`, 'u'), '$1')
    assert.throws(() => patchToolResultOwnerSource(partial), /patch is incomplete/u)
  }
})

test('runtime installer applies the exact alpha.2 image patch and fails closed on drift', async () => {
  const { patchAlpha2ToolResultImageSource } = await import('../scripts/tool-result-image-patch.mjs')
  const installer = readFileSync(path.join(root, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  const toolFixture = readFileSync(toolUiFile, 'utf8')
  const patched = patchAlpha2ToolResultImageSource(toolFixture).source

  assert.match(installer, /assertOfficialAlpha2Artifact\(source, '@deepseek-ai\/dsh-client-ui-tool'/u)
  assert.match(installer, /patchAlpha2ToolResultImageSource\(source\)/u)
  assert.match(installer, /const toolResultImagesChanged = await patchInstalledToolResultImages\(\)/u)
  assert.match(installer, /Patched durable tool-result image delivery/u)
  assert.equal(patchAlpha2ToolResultImageSource(patched).changed, false)

  const incomplete = patched.replace('function resultImages(block)', 'function missingResultImages(block)')
  assert.throws(() => patchAlpha2ToolResultImageSource(incomplete), /patch is incomplete/u)
  const original = toolFixture.includes('function resultImages(block)')
    ? toolFixture.replace('function resultImages(block)', 'function upstreamResultImages(block)')
    : toolFixture.replace('const ToolCall = (0, react.memo)(function ToolCall({', 'const ToolCall = /* upstream drift */ (0, react.memo)(function ToolCall({')
  assert.throws(() => patchAlpha2ToolResultImageSource(original), /refusing an unsafe/u)
})
