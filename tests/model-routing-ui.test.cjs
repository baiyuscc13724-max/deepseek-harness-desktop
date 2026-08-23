const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')
const sandbox = { window: {} }
vm.runInNewContext(source, sandbox)
const { selectInitialRoute, resolveSubagentDisplay, createModelRoutingSavePayload } = sandbox.window.harnessModelRoutingIntegration
const plain = value => JSON.parse(JSON.stringify(value))

test('an unconfigured route selects the newly available DeepSeek provider and model', () => {
  const selected = selectInitialRoute({
    configured: false,
    main: { provider: '', model: '' },
    providers: [
      { id: 'empty', name: 'Empty', models: [] },
      { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] }
    ]
  })

  assert.deepEqual(plain(selected), { provider: 'deepseek', model: 'deepseek-chat' })
})

test('model settings are split into routing, credentials and account views', () => {
  assert.match(source, /id = 'harness-desktop-model-tabs'/)
  assert.match(source, /data-hd-model-view="routing"/)
  assert.match(source, /服务商与 API 密钥/)
  assert.match(source, /data-hd-model-view="meters"/)
  assert.match(source, /hdModelNativeHidden/)
  assert.match(source, /content\.dataset\.hdModelSettingsContent = 'true'/)
  assert.match(source, /\[data-hd-model-settings-content="true"\][^}]*max-height:calc\(100dvh - 128px\)[^}]*overflow-y:auto!important/)
  assert.match(source, /#harness-desktop-model-tabs \{ position:sticky;/)
  assert.match(source, /panel\.hidden = view === 'credentials'/)
  assert.match(source, /element\.dataset\.hdModelNativeHidden = String\(view !== 'credentials'\)/)
  assert.match(source, /content\.scrollTop = 0/)
})

test('a refreshed provider catalog never overwrites an explicit route', () => {
  const selected = selectInitialRoute({
    configured: true,
    main: { provider: 'explicit-provider', model: 'explicit-model' },
    providers: [{ id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat'] }]
  })

  assert.deepEqual(plain(selected), { provider: 'explicit-provider', model: 'explicit-model' })
})

test('subagent route stays visible and mirrors the main route only while inheritance is active', () => {
  const inherited = resolveSubagentDisplay({
    inherited: true,
    mainProvider: 'deepseek',
    mainModel: 'deepseek-chat',
    independentProvider: 'worker-provider',
    independentModel: 'worker-model'
  })
  assert.deepEqual(plain(inherited), {
    provider: 'deepseek',
    model: 'deepseek-chat',
    disabled: true,
    message: '跟随主模型：当前同步为 deepseek / deepseek-chat；切换到“单独指定”即可编辑。'
  })

  const independent = resolveSubagentDisplay({
    inherited: false,
    mainProvider: 'deepseek',
    mainModel: 'deepseek-chat',
    independentProvider: 'worker-provider',
    independentModel: 'worker-model'
  })
  assert.deepEqual(plain(independent), {
    provider: 'worker-provider',
    model: 'worker-model',
    disabled: false,
    message: '单独指定：当前为 worker-provider / worker-model；下方服务商和模型可直接编辑。'
  })
})

test('native model routing serializes the exact nested service contract', () => {
  assert.deepEqual(plain(createModelRoutingSavePayload({
    mainProvider: '  primary-provider ',
    mainModel: ' primary-model  ',
    subInherit: false,
    subProvider: ' worker-provider ',
    subModel: ' worker-model ',
    basePreset: ' standard '
  })), {
    main: { provider: 'primary-provider', model: 'primary-model' },
    subagent: { inheritMain: false, provider: 'worker-provider', model: 'worker-model' },
    basePreset: 'standard'
  })
})

test('desktop model settings keep routing, subagent and quota controls visible in the Models section', () => {
  const integration = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')
  const app = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')
  const html = readFileSync(path.resolve(__dirname, '..', 'renderer', 'index.html'), 'utf8')
  assert.match(integration, /panel = createPanel\(\)/)
  assert.match(integration, /data-hd-sub-mode="independent"/)
  assert.match(integration, /data-hd-sub-provider/)
  assert.match(integration, /data-hd-sub-model/)
  assert.match(integration, /querySelectorAll\('\[data-hd-sub-fields\] select'\)/)
  assert.match(integration, /select\.disabled = inherited/)
  assert.match(integration, /resolveSubagentDisplay\(\{/)
  assert.doesNotMatch(integration, /querySelector\('\[data-hd-sub-fields\]'\)\.hidden = inherited/)
  assert.match(app, /const subProviderValue = inherited \? modelRoutingMainProvider\.value : modelRoutingSubDraft\.provider/)
  assert.match(app, /select\.disabled = inherited/)
  assert.doesNotMatch(app, /modelRoutingSubFields\.hidden = inherited/)
  assert.match(html, /id="modelRoutingSubSummary"[^>]*role="status"[^>]*aria-live="polite"/)
  assert.doesNotMatch(html, /id="modelRoutingSubSummary"[^>]*\shidden(?:\s|>)/)
  assert.match(integration, /data-hd-model-view="meters"/)
  assert.match(integration, /data-hd-meter-refresh/)
  assert.match(integration, /meter\.kind === 'balance'/)
  assert.match(app, /meter\.kind === 'balance'/)
  assert.doesNotMatch(integration, /hdModelNativeWired/)
})

test('native model routing page provides shell-styled balance, usage and budget meters', () => {
  const styles = readFileSync(path.resolve(__dirname, '..', 'renderer', 'styles.css'), 'utf8')
  assert.match(styles, /\.model-routing-overlay \{/)
  assert.match(styles, /\.model-routing-meter-bar span \{/)
  assert.match(styles, /\.model-routing-status\[data-error="true"\]/)
  assert.match(styles, /\.model-routing-field select:disabled \{/)
  assert.match(styles, /@media \(max-width:760px\) \{ \.model-routing-cards, \.model-routing-meter-grid \{ grid-template-columns:1fr; \} \}/)
})
