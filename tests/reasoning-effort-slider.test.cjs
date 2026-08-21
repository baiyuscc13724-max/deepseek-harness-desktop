const assert = require('node:assert/strict')
const test = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const runtimeFile = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-model-selection', 'lib', 'client.js')

test('official model selection is patched into an accessible metadata-driven effort slider', async () => {
  const { patchReasoningEffortSliderSource } = await import('../scripts/patch-official-runtime.mjs')
  const fixture = readFileSync(runtimeFile, 'utf8')
  const first = patchReasoningEffortSliderSource(fixture)
  const source = first.source

  assert.match(source, /dataPluginCss = "@harness-desktop\/reasoning-effort-slider-v2"/)
  assert.match(source, /type: "range"/)
  assert.match(source, /max: Math\.max\(0, effortChoices\.length - 1\)/)
  assert.match(source, /reasoning\.efforts\.map\(\(effort\)/)
  assert.match(source, /key: "provider-default"/)
  assert.match(source, /effort: void 0/)
  assert.match(source, /onPointerUp: \(event\) => chooseEffort/)
  assert.match(source, /\["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"\]/)
  assert.match(source, /"aria-valuetext": currentEffortChoice\?\.label/)
  assert.match(source, /"aria-describedby": id \+ "-effort-description"/)
  assert.match(source, /"aria-pressed": index === effortIndex/)
  assert.match(source, /hd-effort-slider-visually-hidden/)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/)
  assert.match(source, /select\(selection\)\.then\(settleSelection\)/)
  assert.match(source, /const resetEffortPreview = \(\) => \{\s*const selectedIndex = effortChoices\.findIndex\(\(level\) => level\.effort === effectiveEffort\);\s*setEffortIndex\(selectedIndex < 0 \? 0 : selectedIndex\);\s*\}/)
  assert.match(source, /if \(!accepted\) resetEffortPreview\(\)/)
  assert.match(source, /effort\.providerDefaultLevelDescription/)
  assert.doesNotMatch(source, /\[\s*["']low["']\s*,\s*["']medium["']\s*,\s*["']high["']/i)
  assert.doesNotThrow(() => new Function(source))
  assert.equal(patchReasoningEffortSliderSource(source).changed, false)
})

test('legacy slider marker migrates missing rejection rollback once and becomes idempotent', async () => {
  const { patchReasoningEffortSliderSource } = await import('../scripts/patch-official-runtime.mjs')
  const current = patchReasoningEffortSliderSource(readFileSync(runtimeFile, 'utf8')).source
  const syncV2 = `\t\t\tconst resetEffortPreview = () => {
\t\t\t\tconst selectedIndex = effortChoices.findIndex((level) => level.effort === effectiveEffort);
\t\t\t\tsetEffortIndex(selectedIndex < 0 ? 0 : selectedIndex);
\t\t\t};
\t\t\t(0, react.useEffect)(resetEffortPreview, [effortChoices, effectiveEffort, pane]);`
  const syncV1 = `\t\t\t(0, react.useEffect)(() => {
\t\t\t\tconst selectedIndex = effortChoices.findIndex((level) => level.effort === effectiveEffort);
\t\t\t\tsetEffortIndex(selectedIndex < 0 ? 0 : selectedIndex);
\t\t\t}, [effortChoices, effectiveEffort, pane]);`
  const settlementV2 = `\t\t\t\tselect(selection).then((accepted) => {
\t\t\t\t\tif (!accepted) resetEffortPreview();
\t\t\t\t\tsettleSelection(accepted);
\t\t\t\t});`
  const legacy = current
    .replace('dataPluginCss = "@harness-desktop/reasoning-effort-slider-v2"', 'dataPluginCss = "@harness-desktop/reasoning-effort-slider"')
    .replace(syncV2, syncV1)
    .replace(settlementV2, '\t\t\t\tselect(selection).then(settleSelection);')
  assert.notEqual(legacy, current)
  assert.doesNotMatch(legacy, /resetEffortPreview/)

  const migrated = patchReasoningEffortSliderSource(legacy)
  assert.equal(migrated.changed, true)
  assert.match(migrated.source, /reasoning-effort-slider-v2/)
  assert.match(migrated.source, /const resetEffortPreview =/)
  assert.match(migrated.source, /if \(!accepted\) resetEffortPreview\(\)/)
  assert.equal(patchReasoningEffortSliderSource(migrated.source).changed, false)
  assert.doesNotThrow(() => new Function(migrated.source))
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
