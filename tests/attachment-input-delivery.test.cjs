const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const alpha2Audit = process.env.DSH_HISTORICAL_ALPHA2_AUDIT === '1' ? test : test.skip

const root = path.resolve(__dirname, '..')
const attachmentFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-attachment', 'lib', 'client.js')
const conversationFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')

alpha2Audit('draft image drag overlay always has bounded recovery exits', async () => {
  const { patchAttachmentInputSource } = await import('../scripts/attachment-input-patch.mjs')
  const first = patchAttachmentInputSource(readFileSync(attachmentFile, 'utf8'))
  const patched = first.source

  assert.match(patched, /window\.setTimeout\(reset, 1200\)/u)
  assert.match(patched, /document\.addEventListener\("pointerdown", reset, true\)/u)
  assert.match(patched, /document\.addEventListener\("keydown", onKeyDown\)/u)
  assert.match(patched, /event\.key === "Escape"/u)
  assert.match(patched, /window\.addEventListener\("blur", reset\)/u)
  assert.match(patched, /window\.addEventListener\("pagehide", reset\)/u)
  assert.match(patched, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/u)
  assert.match(patched, /const dataTransfer = fileTransfer\(event\);\s*reset\(\);\s*if \(dataTransfer === null\) return;/u)
  assert.match(patched, /window\.clearTimeout\(watchdog\)/u)
  assert.doesNotThrow(() => new Function(patched))
  assert.equal(patchAttachmentInputSource(patched).changed, false)
})

alpha2Audit('draft images expose copy and cut controls with cross-conversation paste fallback', async () => {
  const { patchAttachmentInputConversationSource, patchAttachmentInputSource } = await import('../scripts/attachment-input-patch.mjs')
  const patched = patchAttachmentInputSource(readFileSync(attachmentFile, 'utf8')).source
  const labels = patchAttachmentInputConversationSource(readFileSync(conversationFile, 'utf8')).source

  assert.match(patched, /aria-keyshortcuts": "Control\+C Meta\+C Control\+X Meta\+X"/u)
  assert.match(patched, /if \(key === "x"\) onCut\(item\);\s*else onCopy\(item\);/u)
  assert.match(patched, /className: "hd-draft-image-actions"/u)
  assert.match(patched, /IconCopyOutline16/u)
  assert.match(patched, /DraftCutIcon/u)
  assert.match(patched, /rememberDraftImage\(attachment\.file\)/u)
  assert.match(patched, /if \(cut\) onRemoveImage\(attachment\.id\)/u)
  assert.match(patched, /navigator\.clipboard\?\.write/u)
  assert.match(patched, /new ClipboardItem\(\{ \[type\]: blob \}\)/u)
  assert.match(patched, /target\.matches\("textarea\[data-phase\]"\)/u)
  assert.match(patched, /const nativeFile = Array\.from\(event\.clipboardData\?\.items \?\? \[\]\)\.some/u)
  assert.match(patched, /if \(nativeFile\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*onAddImages\(\[cloneDraftImageFile\(draftImageClipboard\)\]\)/u)
  assert.match(patched, /document\.addEventListener\("copy", clearClipboard\)/u)
  assert.match(patched, /window\.addEventListener\("blur", clearClipboard\)/u)
  assert.match(labels, /"image\.copy": "复制图片 \{name\}"/u)
  assert.match(labels, /"image\.cut": "Cut image \{name\}"/u)
  assert.equal(patchAttachmentInputConversationSource(labels).changed, false)
})

alpha2Audit('runtime installer applies attachment input patches and fails closed on partial state', async () => {
  const { patchAttachmentInputSource } = await import('../scripts/attachment-input-patch.mjs')
  const installer = readFileSync(path.join(root, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  const patched = patchAttachmentInputSource(readFileSync(attachmentFile, 'utf8')).source

  assert.match(installer, /patchInstalledAttachmentInput\(file = attachmentUiRuntime\)/u)
  assert.match(installer, /const attachmentInputChanged = await patchInstalledAttachmentInput\(\)/u)
  assert.match(installer, /Patched recoverable image dragging and draft image transfer/u)
  const partial = patched.replace('window.addEventListener("blur", reset)', 'window.addEventListener("blur", missingReset)')
  assert.throws(() => patchAttachmentInputSource(partial), /patch is incomplete/u)
  assert.throws(
    () => patchAttachmentInputSource('window.__ModuleLoader__.load({ id: "upstream-drift" });'),
    /refusing an unsafe/u
  )
})
