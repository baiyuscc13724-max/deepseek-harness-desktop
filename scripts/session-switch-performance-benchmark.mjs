#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIB = 1024 * 1024

export const DEFAULT_SCENARIO = Object.freeze({
  sessions: 8,
  messagesPerSession: 1200,
  renderedMessages: 240,
  warmupSwitches: 20,
  measuredSwitches: 180,
  scrollSamples: 120
})

export const QUICK_SCENARIO = Object.freeze({
  sessions: 4,
  messagesPerSession: 500,
  renderedMessages: 160,
  warmupSwitches: 8,
  measuredSwitches: 40,
  scrollSamples: 30
})

function round(value, digits = 2) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

export function evaluateBudgets(metrics) {
  const calibration = Math.max(metrics.calibration.p95Ms, 0.1)
  // GitHub's Windows image performs one-time Defender and DLL work during the
  // first hidden renderer paint. Keep that bounded while retaining the same
  // strict steady-state switch, scroll, leak, and long-task-rate gates.
  const windowsCloudFloor = metrics.runtime?.platform === 'win32' && metrics.runtime?.ci === true
  const limits = {
    firstOpenMs: Math.max(windowsCloudFloor ? 350 : 180, calibration * 18),
    switchP95Ms: Math.max(90, calibration * 12),
    scrollP95Ms: Math.max(50, calibration * 8),
    heapGrowthMiB: Math.max(24, metrics.memory.afterWarmupMiB * 0.35),
    listenerGrowth: 2,
    longTaskMaxMs: Math.max(windowsCloudFloor ? 350 : 200, calibration * 24),
    longTaskRate: 0.15
  }
  const observed = {
    firstOpenMs: metrics.firstOpenMs,
    switchP95Ms: metrics.switch.p95Ms,
    scrollP95Ms: metrics.scroll.p95Ms,
    heapGrowthMiB: metrics.memory.growthMiB,
    listenerGrowth: metrics.listeners.growth,
    longTaskMaxMs: metrics.longTasks.maxMs,
    longTaskRate: metrics.longTasks.count / Math.max(1, metrics.scenario.measuredSwitches)
  }
  const checks = Object.entries(limits).map(([name, limit]) => ({
    name,
    observed: round(observed[name], 3),
    limit: round(limit, 3),
    pass: observed[name] <= limit
  }))
  return { pass: checks.every(check => check.pass), limits, checks }
}

function rendererBenchmarkSource(scenario) {
  return `(${async function rendererBenchmark(config) {
    const waitFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()))
    const pctl = (values, q) => {
      if (!values.length) return 0
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)]
    }
    const rounded = value => Math.round(value * 1000) / 1000
    const heapMiB = () => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0

    document.documentElement.innerHTML = '<head><meta charset="utf-8"><style>html,body{margin:0;height:100%;font:13px system-ui}#app{height:100%;display:grid;grid-template-columns:220px 1fr}.sessions{overflow:auto;border-right:1px solid #ddd}.session{display:block;width:100%;padding:7px;border:0;text-align:left}.conversation{height:100vh;overflow:auto;contain:strict}.message{box-sizing:border-box;min-height:30px;padding:6px 10px;border-bottom:1px solid #eee}.tool{font-family:monospace;background:#f7f7f7}</style></head><body><main id="app"><nav class="sessions"></nav><section class="conversation" data-conversation-scroll><div class="flow"></div></section></main></body>'
    const nav = document.querySelector('.sessions')
    const scroller = document.querySelector('.conversation')
    const flow = document.querySelector('.flow')

    const listenerRecords = new WeakMap()
    let activeListeners = 0
    const originalAdd = EventTarget.prototype.addEventListener
    const originalRemove = EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      let records = listenerRecords.get(this)
      if (!records) listenerRecords.set(this, records = [])
      records.push({ type, listener, capture: typeof options === 'boolean' ? options : Boolean(options?.capture) })
      activeListeners += 1
      return originalAdd.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      const records = listenerRecords.get(this) || []
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture)
      const index = records.findIndex(record => record.type === type && record.listener === listener && record.capture === capture)
      if (index >= 0) {
        records.splice(index, 1)
        activeListeners -= 1
      }
      return originalRemove.call(this, type, listener, options)
    }

    const longTasks = []
    let longTaskObserver = null
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration)
      })
      longTaskObserver.observe({ type: 'longtask', buffered: true })
    }

    const calibrationSamples = []
    for (let sample = 0; sample < 24; sample += 1) {
      const started = performance.now()
      const holder = document.createDocumentFragment()
      for (let index = 0; index < 240; index += 1) {
        const node = document.createElement('span')
        node.textContent = String(index)
        holder.appendChild(node)
      }
      const scratch = document.createElement('div')
      scratch.appendChild(holder)
      void scratch.lastElementChild?.textContent
      calibrationSamples.push(performance.now() - started)
    }

    const sessions = Array.from({ length: config.sessions }, (_, sessionIndex) => ({
      id: 'session-' + sessionIndex,
      messages: Array.from({ length: config.messagesPerSession }, (_, messageIndex) => ({
        id: sessionIndex + '-' + messageIndex,
        kind: messageIndex % 3 === 1 ? 'tool' : messageIndex % 3 === 2 ? 'assistant' : 'user',
        text: 'session ' + sessionIndex + ' step ' + messageIndex + ' ' + 'payload '.repeat(5)
      }))
    }))

    for (const session of sessions) {
      const button = document.createElement('button')
      button.className = 'session'
      button.textContent = session.id
      nav.appendChild(button)
    }

    let scrollHandler = null
    const renderSession = sessionIndex => {
      if (scrollHandler) scroller.removeEventListener('scroll', scrollHandler)
      const session = sessions[sessionIndex]
      const fragment = document.createDocumentFragment()
      const start = Math.max(0, session.messages.length - config.renderedMessages)
      for (let index = start; index < session.messages.length; index += 1) {
        const message = session.messages[index]
        const row = document.createElement('article')
        row.className = 'message ' + message.kind
        row.dataset.messageId = message.id
        row.textContent = message.text
        fragment.appendChild(row)
      }
      flow.replaceChildren(fragment)
      scrollHandler = () => { scroller.dataset.scrollTop = String(Math.round(scroller.scrollTop)) }
      scroller.addEventListener('scroll', scrollHandler, { passive: true })
      scroller.scrollTop = scroller.scrollHeight
      void flow.lastElementChild?.offsetHeight
    }

    const firstOpenStarted = performance.now()
    renderSession(0)
    await waitFrame()
    const firstOpenMs = performance.now() - firstOpenStarted

    for (let index = 0; index < config.warmupSwitches; index += 1) {
      renderSession(index % sessions.length)
      if (index % 4 === 3) await waitFrame()
    }
    await waitFrame()
    if (typeof gc === 'function') gc()
    await waitFrame()
    const afterWarmupMiB = heapMiB()
    const listenersAfterWarmup = activeListeners

    const switchSamples = []
    let peakMiB = afterWarmupMiB
    for (let index = 0; index < config.measuredSwitches; index += 1) {
      const started = performance.now()
      renderSession((index + 1) % sessions.length)
      switchSamples.push(performance.now() - started)
      if (index % 10 === 9) {
        await waitFrame()
        peakMiB = Math.max(peakMiB, heapMiB())
      }
    }

    const scrollSamples = []
    for (let index = 0; index < config.scrollSamples; index += 1) {
      const started = performance.now()
      scroller.scrollTop = index % 2 === 0 ? 0 : scroller.scrollHeight
      scroller.dispatchEvent(new Event('scroll'))
      void flow.lastElementChild?.getBoundingClientRect().top
      scrollSamples.push(performance.now() - started)
    }

    await waitFrame()
    if (typeof gc === 'function') gc()
    await waitFrame()
    const finalMiB = heapMiB()
    peakMiB = Math.max(peakMiB, finalMiB)
    await new Promise(resolve => setTimeout(resolve, 0))
    longTaskObserver?.disconnect()
    const listenersAfterStress = activeListeners
    if (scrollHandler) scroller.removeEventListener('scroll', scrollHandler)
    const listenersAfterCleanup = activeListeners
    EventTarget.prototype.addEventListener = originalAdd
    EventTarget.prototype.removeEventListener = originalRemove

    return {
      scenario: config,
      calibration: { p50Ms: rounded(pctl(calibrationSamples, 0.5)), p95Ms: rounded(pctl(calibrationSamples, 0.95)) },
      firstOpenMs: rounded(firstOpenMs),
      switch: { medianMs: rounded(pctl(switchSamples, 0.5)), p95Ms: rounded(pctl(switchSamples, 0.95)), maxMs: rounded(Math.max(...switchSamples)) },
      scroll: { medianMs: rounded(pctl(scrollSamples, 0.5)), p95Ms: rounded(pctl(scrollSamples, 0.95)), maxMs: rounded(Math.max(...scrollSamples)) },
      memory: { afterWarmupMiB: rounded(afterWarmupMiB), finalMiB: rounded(finalMiB), peakMiB: rounded(peakMiB), growthMiB: rounded(finalMiB - afterWarmupMiB) },
      listeners: { afterWarmup: listenersAfterWarmup, afterStress: listenersAfterStress, afterCleanup: listenersAfterCleanup, growth: listenersAfterStress - listenersAfterWarmup },
      longTasks: { count: longTasks.length, maxMs: rounded(longTasks.length ? Math.max(...longTasks) : 0), totalMs: rounded(longTasks.reduce((sum, value) => sum + value, 0)) },
      dom: { renderedMessages: flow.childElementCount, totalMessages: sessions.reduce((sum, session) => sum + session.messages.length, 0) }
    }
  }.toString()})(${JSON.stringify(scenario)})`
}

async function runElectronWorker() {
  const { app, BrowserWindow } = await import('electron')
  const scenario = JSON.parse(process.env.HARNESS_PERF_SCENARIO || JSON.stringify(DEFAULT_SCENARIO))
  const profileRoot = process.env.HARNESS_PERF_PROFILE
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  app.commandLine.appendSwitch('enable-precise-memory-info')
  app.commandLine.appendSwitch('js-flags', '--expose-gc')
  if (profileRoot) app.setPath('userData', profileRoot)
  await app.whenReady()
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 760,
    skipTaskbar: true,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
  })
  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'))
    const metrics = await window.webContents.executeJavaScript(rendererBenchmarkSource(scenario), true)
    const result = { generatedAt: new Date().toISOString(), runtime: { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, ci: process.env.CI === 'true' }, ...metrics }
    result.budget = evaluateBudgets(result)
    const resultFile = process.env.HARNESS_PERF_RESULT_FILE
    if (!resultFile) throw new Error('HARNESS_PERF_RESULT_FILE is required')
    writeFileSync(resultFile, JSON.stringify(result), 'utf8')
    app.exit(result.budget.pass ? 0 : 2)
  } catch (error) {
    console.error(error?.stack || error)
    app.exit(1)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

export function electronExecutablePath(platform = process.platform) {
  const relative = platform === 'win32'
    ? ['electron.exe']
    : platform === 'darwin'
      ? ['Electron.app', 'Contents', 'MacOS', 'Electron']
      : ['electron']
  return path.join(root, 'node_modules', 'electron', 'dist', ...relative)
}

export function runBenchmark({ quick = false } = {}) {
  const scenario = quick ? QUICK_SCENARIO : DEFAULT_SCENARIO
  const executable = electronExecutablePath()
  const profileRoot = mkdtempSync(path.join(os.tmpdir(), 'hd-session-performance-'))
  const resultFile = path.join(profileRoot, 'result.json')
  const launcher = path.join(profileRoot, 'benchmark-launcher.cjs')
  writeFileSync(launcher, `import(${JSON.stringify(import.meta.url)}).catch(error => { console.error(error); process.exitCode = 1 })\n`, 'utf8')
  const env = { ...process.env, HARNESS_PERF_PROFILE: profileRoot, HARNESS_PERF_RESULT_FILE: resultFile, HARNESS_PERF_SCENARIO: JSON.stringify(scenario) }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const child = spawnSync(executable, [launcher, '--electron-worker'], { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * MIB })
    if (child.error) throw child.error
    let result
    try {
      result = JSON.parse(readFileSync(resultFile, 'utf8'))
    } catch (error) {
      throw new Error(`Electron benchmark did not return metrics (status ${child.status}).\n${child.stderr || child.stdout || ''}`, { cause: error })
    }
    if (child.status !== 0 && child.status !== 2) throw new Error(`Electron benchmark failed with status ${child.status}.\n${child.stderr || ''}`)
    return result
  } finally {
    rmSync(profileRoot, { recursive: true, force: true })
  }
}

function printHuman(result) {
  const lines = [
    `Session performance benchmark (${result.scenario.messagesPerSession} messages × ${result.scenario.sessions} sessions)`,
    `first open: ${result.firstOpenMs} ms`,
    `switch: median ${result.switch.medianMs} ms, p95 ${result.switch.p95Ms} ms, max ${result.switch.maxMs} ms`,
    `scroll frame: median ${result.scroll.medianMs} ms, p95 ${result.scroll.p95Ms} ms`,
    `heap: ${result.memory.afterWarmupMiB} → ${result.memory.finalMiB} MiB (growth ${result.memory.growthMiB} MiB, peak ${result.memory.peakMiB} MiB)`,
    `listeners: ${result.listeners.afterWarmup} → ${result.listeners.afterStress} (growth ${result.listeners.growth}; cleanup ${result.listeners.afterCleanup})`,
    `long tasks: ${result.longTasks.count}, max ${result.longTasks.maxMs} ms`,
    `budget: ${result.budget.pass ? 'PASS' : 'FAIL'}`
  ]
  for (const check of result.budget.checks) lines.push(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.name}: ${check.observed} <= ${check.limit}`)
  return lines.join('\n')
}

const isWorker = process.argv.includes('--electron-worker')
const isDirect = path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)
if (isWorker) {
  await runElectronWorker()
} else if (isDirect) {
  const result = runBenchmark({ quick: process.argv.includes('--quick') })
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  else process.stdout.write(printHuman(result) + '\n')
  process.exitCode = result.budget.pass ? 0 : 2
}
