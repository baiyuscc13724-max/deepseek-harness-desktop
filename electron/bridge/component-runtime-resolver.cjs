const path = require('node:path')
const Module = require('node:module')
const { existsSync } = require('node:fs')

const COMPONENT_IDS = Object.freeze({
  shell: 'desktop-shell',
  runtime: 'harness-runtime',
  plugins: 'desktop-plugins'
})

function componentById(pointer, id) {
  return pointer?.components?.find(component => component.id === id) || null
}

function resolveComponentLayout({ store, pointer, bundledRoot, exists = existsSync }) {
  const root = path.resolve(bundledRoot)
  const shell = componentById(pointer, COMPONENT_IDS.shell)
  const runtime = componentById(pointer, COMPONENT_IDS.runtime)
  const plugins = componentById(pointer, COMPONENT_IDS.plugins)
  const shellRoot = shell ? store.componentPath(shell) : root
  const shellEntry = path.join(shellRoot, 'electron', 'main.cjs')
  if (!exists(shellEntry)) throw new Error(`桌面壳入口不存在：${shellEntry}`)
  const runtimeRoot = runtime ? store.componentPath(runtime) : root
  const runtimeNodeModules = path.join(runtimeRoot, 'node_modules')
  if (runtime && !exists(path.join(runtimeNodeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) throw new Error('Harness 运行时组件缺少官方 DSH 入口。')
  const pluginsRoot = plugins ? store.componentPath(plugins) : path.join(root, 'plugins')
  if (plugins && !exists(pluginsRoot)) throw new Error('桌面插件组件目录不存在。')
  return { shellRoot, shellEntry, runtimeRoot, runtimeNodeModules, pluginsRoot }
}

function installComponentModulePaths(layout, bundledRoot, { delimiter = path.delimiter, initPaths = Module._initPaths } = {}) {
  const additions = [layout.runtimeNodeModules, path.join(path.resolve(bundledRoot), 'node_modules')]
  const existing = String(process.env.NODE_PATH || '').split(delimiter).filter(Boolean)
  process.env.NODE_PATH = [...new Set([...additions, ...existing])].join(delimiter)
  initPaths()
  return process.env.NODE_PATH
}

module.exports = { COMPONENT_IDS, componentById, installComponentModulePaths, resolveComponentLayout }
