const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const toolUiFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-tool', 'lib', 'client.js')

test('durable tool-result images render in chat instead of flattening to JSON', async () => {
  const { patchToolResultImageSource } = await import('../scripts/tool-result-image-patch.mjs')
  const fixture = readFileSync(toolUiFile, 'utf8')
  const first = patchToolResultImageSource(fixture)
  const patched = first.source

  assert.match(patched, /function resultImages\(block\)/u)
  assert.match(patched, /block\.content\.filter\(\(item\) => item\??\.type === "image"/u)
  assert.match(patched, /images\.length > 0 \? renderMessageImages\(\{\s*images,\s*align: "start"/u)
  assert.match(patched, /function ToolCallTree\(\{ renderSlot, renderMessageImages,/u)
  assert.match(patched, /ToolCallBranch, \{\s*renderSlot,\s*renderMessageImages,\s*(?:sessionId,\s*)?block/u)
  assert.match(patched, /ToolCall, \{\s*renderSlot,\s*renderMessageImages,\s*(?:sessionId,\s*)?callId/u)
  assert.match(patched, /else if \(block\.type !== "image"\) parts\.push\(JSON\.stringify/u)
  assert.doesNotMatch(patched, /else parts\.push\(JSON\.stringify\(block, null, 2\)\)/u)
  assert.doesNotThrow(() => new Function(patched))
  assert.equal(patchToolResultImageSource(patched).changed, false)

  const start = patched.indexOf('function resultImages(block)')
  const end = patched.indexOf('\n\t\tfunction parseArgs', start)
  assert.ok(start >= 0 && end > start)
  const resultImages = Function(`${patched.slice(start, end)}; return resultImages`)()
  const attachment = { attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 12, width: 2, height: 3 }
  assert.deepEqual(resultImages({ kind: 'tool-result', content: [
    { type: 'text', text: 'created' },
    { type: 'image', attachment },
    { type: 'json', value: true }
  ] }), [{ attachment }])
  assert.deepEqual(resultImages({ name: 'image_gen', content: [{ type: 'image', attachment }] }), [])
})

test('image generation already persists one attachment before chat delivery', () => {
  const bridge = readFileSync(path.join(root, 'plugins', 'dsh-codex-image-bridge', 'src', 'core.js'), 'utf8')
  const registration = readFileSync(path.join(root, 'plugins', 'dsh-codex-image-bridge', 'src', 'index.js'), 'utf8')

  assert.match(bridge, /ref = await services\.attachments\.saveImage\(output\)/u)
  assert.match(bridge, /image:\s*\{\s*attachmentId: ref\.attachmentId/u)
  assert.match(registration, /\{ type: "image", attachment: imageRef\(value\.image\) \}/u)
})

test('runtime installer applies the image delivery patch and fails closed on drift', async () => {
  const { patchToolResultImageSource } = await import('../scripts/tool-result-image-patch.mjs')
  const installer = readFileSync(path.join(root, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  const fixture = readFileSync(toolUiFile, 'utf8')
  const patched = patchToolResultImageSource(fixture).source

  assert.match(installer, /dsh-client-ui-tool', 'lib', 'client\.js'/u)
  assert.match(installer, /const toolResultImagesChanged = await patchInstalledToolResultImages\(\)/u)
  assert.match(installer, /Patched durable tool results and recoverable edit-conflict presentation/u)

  const incomplete = patched.replace('images.length > 0 ? renderMessageImages({', 'images.length > 0 ? missingImageRenderer({')
  assert.throws(() => patchToolResultImageSource(incomplete), /patch is incomplete/u)
  const missingTreeForward = patched.replace('function ToolCallTree({ renderSlot, renderMessageImages,', 'function ToolCallTree({ renderSlot, missingImageRenderer,')
  assert.throws(() => patchToolResultImageSource(missingTreeForward), /patch is incomplete/u)

  const original = fixture.includes('function resultImages(block)')
    ? fixture.replace('function resultImages(block)', 'function upstreamResultImages(block)')
    : fixture.replace('const ToolCall = (0, react.memo)(function ToolCall({', 'const ToolCall = /* upstream drift */ (0, react.memo)(function ToolCall({')
  assert.throws(() => patchToolResultImageSource(original), /refusing an unsafe/u)
})
