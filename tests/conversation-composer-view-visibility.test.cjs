const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const root = path.resolve(__dirname, '..')
const patchFile = path.join(root, 'scripts', 'patch-official-runtime.mjs')

test('modern conversation patch exposes the active view and hides the composer outside chat', async () => {
  const patch = await import(`${pathToFileURL(patchFile).href}?composer-view=${Date.now()}-${Math.random()}`)
  const source = [
    'const before = true;',
    'className: ConversationRoot_module_css_default.viewArea,',
    '\t\t\t\tchildren: active !== void 0 && renderSlot("conversation.view", {',
    '\t\t\ttag.textContent = css$6;',
    'const after = true;'
  ].join('\n')

  const first = patch.patchModernConversationComposerVisibilitySource(source)
  assert.equal(first.changed, true)
  assert.match(first.source, /"data-conversation-view": active\?\.id/u)
  assert.ok(first.source.includes('[data-conversation-scroll]:has([data-conversation-view]:not([data-conversation-view=\\"chat\\"]))>[data-composer-seat]{display:none}'))

  const second = patch.patchModernConversationComposerVisibilitySource(first.source)
  assert.equal(second.changed, false)
  assert.equal(second.source, first.source)
})

test('modern runtime dispatch keeps broad official UI patches skipped and applies only composer visibility', async () => {
  const source = await readFile(patchFile, 'utf8')
  assert.match(source, /const modernConversationComposerChanged = targetsModernAlpha \? await patchInstalledModernConversationComposerVisibility\(\) : false/u)
  assert.match(source, /const conversationChanged = targetsAlpha3 \? false : targetsAlpha4 \? false : await patchInstalledConversation\(\)/u)
  assert.match(source, /restoreModernConversationComposerVisibilitySource\(source\)/u)
})
