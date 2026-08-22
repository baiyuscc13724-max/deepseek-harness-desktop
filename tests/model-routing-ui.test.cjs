const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')
const sandbox = { window: {} }
vm.runInNewContext(source, sandbox)
const { selectInitialRoute } = sandbox.window.harnessModelRoutingIntegration
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

test('desktop model settings route to the native shell page while the injected browser panel stays mobile-only', () => {
  const integration = readFileSync(path.resolve(__dirname, '..', 'renderer', 'model-routing-integration.js'), 'utf8')
  const shell = readFileSync(path.resolve(__dirname, '..', 'renderer', 'app.js'), 'utf8')
  const html = readFileSync(path.resolve(__dirname, '..', 'renderer', 'index.html'), 'utf8')
  assert.match(integration, /const mobile = document\.documentElement\.dataset\.harnessMobile === 'true'/)
  assert.match(integration, /if \(!mobile && modelsNav\) \{/)
  assert.match(integration, /request\('open-model-routing'\)/)
  assert.match(integration, /dialog\.dataset\.hdModelNativeWired/)
  assert.match(integration, /panel = createPanel\(\)/)
  assert.match(shell, /\} else if \(target\.hostname === 'open-model-routing'\) \{\s*openModelRouting\(\)/u)
  assert.match(shell, /function openModelRouting\(\) \{/)
  assert.match(shell, /function closeModelRouting\(\) \{/)
  assert.match(shell, /api\.saveModelRouting\(/)
  assert.match(shell, /api\.getProviderMeters\(true\)/)
  assert.match(html, /id="modelRoutingOverlay"/)
  assert.match(html, /id="modelRoutingMainProvider"/)
  assert.match(html, /id="modelRoutingSubInherit"/)
  assert.match(html, /id="modelRoutingMeters"/)
  assert.match(html, /id="modelRoutingRefreshMeters"/)
})

test('native model routing page provides shell-styled balance, usage and budget meters', () => {
  const styles = readFileSync(path.resolve(__dirname, '..', 'renderer', 'styles.css'), 'utf8')
  assert.match(styles, /\.model-routing-overlay \{/)
  assert.match(styles, /\.model-routing-meter-bar span \{/)
  assert.match(styles, /\.model-routing-status\[data-error="true"\]/)
  assert.match(styles, /@media \(max-width:760px\) \{ \.model-routing-cards, \.model-routing-meter-grid \{ grid-template-columns:1fr; \} \}/)
})
