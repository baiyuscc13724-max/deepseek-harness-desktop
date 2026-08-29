const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const toolUiFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-tool', 'lib', 'client.js')
const conversationFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')

function projectedHelpers(source) {
  const start = source.indexOf('function resultImages(block)')
  const end = source.indexOf('\n\t\tfunction resultFileUrl', start)
  assert.ok(start >= 0 && end > start)
  return Function(`${source.slice(start, end)}; return { resultImages, resultFiles }`)()
}

test('durable tool-result images and explicit local files render without flattening image metadata', async () => {
  const { patchToolResultImageSource } = await import('../scripts/tool-result-image-patch.mjs')
  const fixture = readFileSync(toolUiFile, 'utf8')
  const first = patchToolResultImageSource(fixture)
  const patched = first.source

  assert.match(patched, /function resultImages\(block\)/u)
  assert.match(patched, /item\?\.type === "image" && item\.attachment !== void 0/u)
  assert.match(patched, /function resultFiles\(block, cwd\)/u)
  assert.match(patched, /data-tool-result-deliverables/u)
  assert.match(patched, /react_jsx_runtime\.jsx\)\("audio"/u)
  assert.match(patched, /react_jsx_runtime\.jsx\)\("video"/u)
  assert.match(patched, /@harness-desktop\/tool-result-deliverables-no-download-v2/u)
  assert.match(patched, /\/api\/desktop-files\/\$\{route\}/u)
  assert.doesNotMatch(patched, /下载：|仅下载（不会执行）|download: file\.name|data-download-only|resultFileUrl\(sessionId, file, "download"\)/u)
  assert.match(patched, /function ToolCallTree\(\{ renderSlot, renderMessageImages, sessionId,/u)
  assert.match(patched, /ToolCallBranch, \{\s*renderSlot,\s*renderMessageImages,\s*sessionId,\s*block/u)
  assert.match(patched, /ToolCall, \{\s*renderSlot,\s*renderMessageImages,\s*sessionId,\s*callId/u)
  assert.match(patched, /else if \(block\.type !== "image"\) parts\.push\(JSON\.stringify/u)
  assert.doesNotThrow(() => new Function(patched))
  assert.equal(patchToolResultImageSource(patched).changed, false)

  const { resultImages, resultFiles } = projectedHelpers(patched)
  const attachment = { attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 12, width: 2, height: 3 }
  assert.deepEqual(resultImages({ kind: 'tool-result', content: [
    { type: 'text', text: 'created' },
    { type: 'image', attachment },
    { type: 'image' },
    { type: 'json', value: true }
  ] }), [{ attachment }])
  assert.deepEqual(resultImages({ name: 'image_gen', content: [{ type: 'image', attachment }] }), [])

  const content = JSON.stringify({
    workspace_image_path: 'assets/poster.final.png',
    nested: { workspace_video_path: 'assets/demo.mp4', workspace_path: 'assets/theme.mp3', local_path: 'dist/app.exe' },
    local_log_paths: ['logs/run.txt', 'assets/demo.mp4'],
    files: ['LICENSE'],
    url: 'https://example.com/not-local.png'
  })
  assert.deepEqual(resultFiles({ kind: 'tool-result', content: [{ type: 'text', text: content }] }, 'D:/work'), [
    { path: 'assets/poster.final.png', name: 'poster.final.png', kind: 'image' },
    { path: 'assets/demo.mp4', name: 'demo.mp4', kind: 'video' },
    { path: 'assets/theme.mp3', name: 'theme.mp3', kind: 'audio' },
    { path: 'dist/app.exe', name: 'app.exe', kind: 'active' },
    { path: 'logs/run.txt', name: 'run.txt', kind: 'file' },
    { path: 'LICENSE', name: 'LICENSE', kind: 'file' }
  ])
})

test('file projection fails closed on prose, malformed JSON, URLs and workspace escapes', async () => {
  const { patchToolResultImageSource } = await import('../scripts/tool-result-image-patch.mjs')
  const patched = patchToolResultImageSource(readFileSync(toolUiFile, 'utf8')).source
  const { resultFiles } = projectedHelpers(patched)
  const cwd = 'D:/work'
  const node = { kind: 'tool-result', content: [
    { type: 'text', text: 'created {"path":"assets/hidden.png"}' },
    { type: 'text', text: '{"path":"../secret.txt"}' },
    { type: 'text', text: '{"path":"https://example.com/file.mp4"}' },
    { type: 'text', text: '{"path":"D:/other/file.zip"}' },
    { type: 'text', text: '{"path":"C:drive-relative.txt"}' },
    { type: 'text', text: '{"path":"assets/report.txt:stream"}' },
    { type: 'text', text: '{"message":"assets/not-a-deliverable.png"}' },
    { type: 'text', text: '{bad json' },
    { type: 'resource', path: 'assets/extension-block.mp4' }
  ] }
  assert.deepEqual(resultFiles(node, cwd), [])
  assert.deepEqual(resultFiles({ name: 'pending', content: [{ type: 'text', text: '{"path":"assets/file.zip"}' }] }, cwd), [])
  assert.deepEqual(resultFiles({ kind: 'tool-result', content: [{ type: 'text', text: '{"path":"D:/work/out/file.zip"}' }] }, cwd), [
    { path: 'D:/work/out/file.zip', name: 'file.zip', kind: 'file' }
  ])
  assert.deepEqual(resultFiles({ kind: 'tool-result', content: [{ type: 'text', text: '[{"local_path":"assets/root-array.webp"}]' }] }, cwd), [
    { path: 'assets/root-array.webp', name: 'root-array.webp', kind: 'image' }
  ])
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

test('runtime installer threads session identity, applies delivery patches and fails closed on drift', async () => {
  const { patchToolResultImageSource, patchToolResultOwnerSource } = await import('../scripts/tool-result-image-patch.mjs')
  const installer = readFileSync(path.join(root, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  const toolFixture = readFileSync(toolUiFile, 'utf8')
  const conversationFixture = readFileSync(conversationFile, 'utf8')
  const patched = patchToolResultImageSource(toolFixture).source
  const ownerPatch = patchToolResultOwnerSource(conversationFixture)
  const ownerPatched = ownerPatch.source

  assert.match(conversationFixture, /children: renderedNodeKeys\.map\(\(nodeKey\)/u, 'current node_modules must exercise the grouped performance-patch composition')
  assert.equal(ownerPatch.changed, false, 'the current renderedNodeKeys grouped composition is already complete and must remain idempotent')
  assert.match(installer, /patchToolResultOwnerSource\(cache\.source\)/u)
  assert.match(installer, /const toolResultImagesChanged = await patchInstalledToolResultImages\(\)/u)
  assert.match(installer, /Patched durable tool-result image delivery/u)
  assert.match(ownerPatched, /ChatNodeSeat\(\{ nodeKey, sessionId, selectedCallId,/u)
  assert.match(ownerPatched, /node === void 0 \? null : \{\s*sessionId,\s*selectedCallId,/u)
  assert.ok(
    /ConversationWorkTreeGroup\(\{ item, sessionId, useSession,/u.test(ownerPatched)
      || /order\.map\(\(nodeKey\)[\s\S]*nodeKey,\s*sessionId,\s*useSession,/u.test(ownerPatched),
    'the installed grouped or flat conversation tree must forward sessionId'
  )
  assert.equal(patchToolResultOwnerSource(ownerPatched).changed, false)

  const incomplete = patched.replace('data-tool-result-deliverables', 'missing-tool-result-deliverables')
  assert.throws(() => patchToolResultImageSource(incomplete), /patch is incomplete/u)
  const missingNestedForward = patched.replace(/\n\s*sessionId,\n\s*block: child,/u, '\n\t\t\t\t\t\tblock: child,')
  assert.throws(() => patchToolResultImageSource(missingNestedForward), /patch is incomplete/u)
  const incompleteOwner = ownerPatched.replace(/\n\s*sessionId,\n\s*selectedCallId,/u, '\n\t\t\t\tselectedCallId,')
  assert.throws(() => patchToolResultOwnerSource(incompleteOwner), /patch is incomplete/u)

  const original = toolFixture.includes('function resultImages(block)')
    ? toolFixture.replace('function resultImages(block)', 'function upstreamResultImages(block)')
    : toolFixture.replace('const ToolCall = (0, react.memo)(function ToolCall({', 'const ToolCall = /* upstream drift */ (0, react.memo)(function ToolCall({')
  assert.throws(() => patchToolResultImageSource(original), /refusing an unsafe/u)
})
