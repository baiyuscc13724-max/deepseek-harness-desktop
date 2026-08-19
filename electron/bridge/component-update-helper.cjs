const path = require('node:path')
const { access } = require('node:fs/promises')
const { spawn } = require('node:child_process')
const { setTimeout: delay } = require('node:timers/promises')

function processIsRunning(pid) {
  try { process.kill(pid, 0); return true }
  catch (error) { return error?.code === 'EPERM' }
}

async function waitForProcessExit(pid, { timeoutMs = 60_000, intervalMs = 200, isRunning = processIsRunning } = {}) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('父进程 PID 无效。')
  const deadline = Date.now() + timeoutMs
  while (isRunning(pid)) {
    if (Date.now() >= deadline) throw new Error('等待主程序退出超时，组件更新尚未应用。')
    await delay(intervalMs)
  }
}

async function ensurePendingComponentsPresent(store, state, accessImpl = access) {
  if (!state.pending?.components?.length) throw new Error('没有待应用组件。')
  for (const component of state.pending.components) await accessImpl(store.componentPath(component))
}

function desktopEnvironment(source = process.env) {
  const env = { ...source }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.HARNESS_COMPONENT_UPDATE_HELPER
  return env
}

function restartDesktop({ executable, cwd, args = [], spawnImpl = spawn, env = process.env }) {
  const file = path.resolve(String(executable || ''))
  const workingDirectory = path.resolve(String(cwd || path.dirname(file)))
  if (!path.isAbsolute(file) || !path.isAbsolute(workingDirectory) || !Array.isArray(args)) throw new Error('桌面程序重启参数无效。')
  const child = spawnImpl(file, args.map(value => String(value)), {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    env: desktopEnvironment(env)
  })
  child.unref?.()
  return child.pid || 0
}

async function applyReadyComponentUpdate({ store, parentPid, restart, waitImpl = waitForProcessExit, accessImpl = access, spawnImpl = spawn }) {
  await waitImpl(parentPid)
  const ready = await store.get()
  if (ready.phase !== 'ready' || !ready.pending) throw new Error(`组件更新不在可应用阶段：${ready.phase}`)
  await ensurePendingComponentsPresent(store, ready, accessImpl)
  await store.markApplying()
  const activated = await store.activatePending()
  let restartPid = 0
  if (restart) restartPid = restartDesktop({ ...restart, spawnImpl })
  return { state: activated, restartPid }
}

module.exports = {
  applyReadyComponentUpdate,
  desktopEnvironment,
  ensurePendingComponentsPresent,
  processIsRunning,
  restartDesktop,
  waitForProcessExit
}
