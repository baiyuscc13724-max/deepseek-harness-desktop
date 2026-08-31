const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-model-selection', 'lib', 'client.js')

test('official alpha.2 model selection owns an accessible metadata-driven effort menu', async () => {
  const { patchInstalledModelSelection } = await import('../scripts/patch-official-runtime.mjs')
  const source = readFileSync(runtimeFile, 'utf8')

  assert.equal(await patchInstalledModelSelection(runtimeFile), false)
  assert.match(source, /const reasoning = currentChoice\?\.model\.reasoning/u)
  assert.match(source, /reasoning\.efforts\.map\(\(effort\)/u)
  assert.match(source, /key: `effort:\$\{effort\.id\}`/u)
  assert.match(source, /role: "menuitemradio"/u)
  assert.match(source, /"aria-checked": effectiveEffort === level\.effort/u)
  assert.match(source, /disabled: busy/u)
  assert.match(source, /chooseEffort\(level\.effort\)/u)
  assert.match(source, /reasoningEffort: effort/u)
  assert.match(source, /select\(selection\)\.then\(settleSelection\)/u)
  assert.doesNotMatch(source, /\[\s*["']low["']\s*,\s*["']medium["']\s*,\s*["']high["']/iu)
  assert.doesNotThrow(() => new Function(source))
})

test('native effort selection preserves the prior choice when the Host rejects an update', () => {
  const source = readFileSync(runtimeFile, 'utf8')
  assert.match(source, /const settleSelection = \(accepted\) => \{[\s\S]*if \(accepted\) \{[\s\S]*close\(true\)/u)
  assert.match(source, /const message = directory\.getSnapshot\(\)\.error/u)
  assert.match(source, /setToast\(\{\s*seq: toastSeq\.current,\s*text: t\("error\.action", \{ message \}\)/u)
  assert.match(source, /const chooseEffort = \(effort\) => \{[\s\S]*if \(effectiveEffort === effort\) \{[\s\S]*select\(selection\)\.then\(settleSelection\)/u)
  assert.doesNotMatch(source, /setEffortIndex|resetEffortPreview/u)
})

test('effort metadata maps arbitrary 1, 3, and 5 level catalogs without a client vocabulary', async () => {
  const { reasoningEffortChoices } = await import('../scripts/reasoning-effort-slider-patch.mjs')
  const t = (key, values) => values?.effort === undefined ? key : `${key}:${values.effort}`

  for (const count of [1, 3, 5]) {
    const efforts = Array.from({ length: count }, (_, index) => ({
      id: `host-level-${index + 1}`,
      name: `Host level ${index + 1}`,
      description: `Host description ${index + 1}`
    }))
    const choices = reasoningEffortChoices({
      defaultEffort: count === 1 ? undefined : efforts[Math.floor(count / 2)].id,
      efforts
    }, t)

    assert.equal(choices.length, count + 1)
    assert.deepEqual(choices.slice(1).map(choice => choice.effort), efforts.map(effort => effort.id))
    assert.equal(choices[0].key, 'provider-default')
    assert.equal(choices[0].effort, undefined)
    if (count === 1) assert.equal(choices[0].description, 'effort.providerDefaultDescription')
    else assert.equal(choices[0].description, `effort.providerDefaultLevelDescription:${efforts[Math.floor(count / 2)].name}`)
  }
})

test('reasoning effort patch fails loudly when the pinned runtime anchors drift', async () => {
  const { patchReasoningEffortSliderSource } = await import('../scripts/patch-official-runtime.mjs')
  assert.throws(
    () => patchReasoningEffortSliderSource('window.__ModuleLoader__.load({});'),
    /Pinned DSH model selection styles changed/
  )
})

test('postinstall owns the persistent official runtime patch', () => {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts.postinstall, /scripts\/patch-official-runtime\.mjs/)
  const patchSource = readFileSync(path.join(root, 'scripts', 'patch-official-runtime.mjs'), 'utf8')
  assert.match(patchSource, /patchInstalledModelSelection/)
  assert.match(patchSource, /patchReasoningEffortSliderSource/)
})
