const path = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const { app, dialog, protocol } = require('electron')
const { ComponentUpdateStore } = require('./bridge/component-update-store.cjs')
const { bundledReleaseSupersedesPointer } = require('./bridge/component-update-service.cjs')
const { confirmComponentActivation, prepareComponentActivation, rollbackUnhealthyActivation } = require('./bridge/component-update-health.cjs')
const { installComponentModulePaths, resolveComponentLayout } = require('./bridge/component-runtime-resolver.cjs')
const { applyUserDataOverride } = require('./bridge/user-data-override.cjs')

// Custom schemes must be privileged before any asynchronous bootstrap work can let Electron become ready.
protocol.registerSchemesAsPrivileged([{
  scheme: 'harness-wallpaper',
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true }
}])

function reportSelfTestBootstrapFailure(error) {
  const prefix = '--self-test-output='
  const output = process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
  if (!output) return
  try {
    mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
    writeFileSync(path.resolve(output), `${JSON.stringify({
      ok: false,
      phase: 'bootstrap-failed',
      error: { name: String(error?.name || 'Error'), message: String(error?.message || error || 'Unknown bootstrap failure') }
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch {}
}

async function boot() {
  applyUserDataOverride(app)
  const bundledRoot = path.resolve(__dirname, '..')
  const componentRoot = path.join(app.getPath('userData'), 'component-updates')
  const store = new ComponentUpdateStore(componentRoot)
  let prepared = { action: 'use-current', pointer: null, state: null }
  let layout
  try {
    const [persistedState, persistedPointer] = await Promise.all([store.get(), store.pointer()])
    if (bundledReleaseSupersedesPointer(app.getVersion(), persistedPointer, persistedState)) {
      await store.adoptBundledBaseline()
    }
    prepared = await prepareComponentActivation({ store })
    layout = resolveComponentLayout({ store, pointer: prepared.pointer, bundledRoot })
  } catch (error) {
    console.error(`Unable to activate desktop components; using bundled baseline: ${error.message}`)
    // A corrupt/unreadable update store is not authority to execute an unknown
    // pointer or to erase history. Keep those bytes, but keep diagnostics usable.
    prepared = { action: 'bundled-fallback', pointer: null, state: null, error: error.message, recoveryRequired: true }
    layout = resolveComponentLayout({ store, pointer: null, bundledRoot })
    void app.whenReady().then(() => {
      dialog.showErrorBox('组件更新需要恢复', '组件更新状态无法安全读取或激活，已使用随应用安装的内置版本启动。原更新记录保持不变。你仍可打开设置和诊断；在修复更新记录前，增量更新操作会被拒绝。')
    }).catch(diagnosticError => console.error(`Unable to show component recovery notice: ${diagnosticError.message}`))
  }

  installComponentModulePaths(layout, bundledRoot)
  process.env.HARNESS_DESKTOP_BUNDLED_ROOT = bundledRoot
  process.env.HARNESS_COMPONENT_SHELL_ROOT = layout.shellRoot
  process.env.HARNESS_COMPONENT_RUNTIME_ROOT = layout.runtimeRoot === bundledRoot ? '' : layout.runtimeRoot
  process.env.HARNESS_COMPONENT_PLUGINS_ROOT = layout.pluginsRoot
  global.__HARNESS_COMPONENT_UPDATE__ = Object.freeze({
    bundledRoot,
    componentRoot,
    store,
    prepared,
    layout,
    healthCheckRequired: prepared.action === 'health-check-required',
    confirmHealthy: () => confirmComponentActivation(store),
    rollback: error => rollbackUnhealthyActivation(store, error)
  })
  try {
    require(layout.shellEntry)
  } catch (error) {
    if (prepared.action === 'health-check-required') {
      console.error(`New component shell failed before health confirmation; rolling back: ${error.message}`)
      const recovered = await rollbackUnhealthyActivation(store, error)
      global.__HARNESS_COMPONENT_UPDATE__ = Object.freeze({
        ...global.__HARNESS_COMPONENT_UPDATE__,
        prepared: recovered,
        healthCheckRequired: false
      })
      const args = process.argv.slice(1).filter(value => value !== '--component-health-check')
      app.relaunch({ args })
      app.exit(1)
      return
    }
    throw error
  }
}

boot().catch(error => {
  console.error(error?.stack || error)
  reportSelfTestBootstrapFailure(error)
  app.exit(1)
})
