const WebSocket = require('ws')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.once('open', resolve)
  })
  let nextId = 0
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    const onMessage = raw => {
      const message = JSON.parse(raw)
      if (message.id !== id) return
      socket.off('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    socket.on('message', onMessage)
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  return { socket, evaluate }
}

async function main() {
  const port = Number(process.argv[2] || 9231)
  const androidSerial = process.argv[3] || ''
  let target = null
  for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
    const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()).catch(() => [])
    target = pages.find(candidate => candidate.url.endsWith('/renderer/index.html'))
    if (!target) await wait(500)
  }
  if (!target) throw new Error('Harness Desktop renderer target was not found.')
  const desktop = await connect(target)
  const result = await desktop.evaluate(`(async () => {
    for (let attempt = 0; attempt < 160; attempt += 1) {
      if (window.desktopHarness?.getMobileSyncState) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    let state = await window.desktopHarness.getMobileSyncState()
    if (!state.enabled || !state.running) state = await window.desktopHarness.setMobileSyncEnabled(true)
    state = await window.desktopHarness.setMobileSyncRemoteEnabled(true)
    for (let attempt = 0; attempt < 600; attempt += 1) {
      state = await window.desktopHarness.getMobileSyncState()
      if (state.remote?.status === 'connected') {
        const paired = await window.desktopHarness.beginMobilePairing()
        return { state: paired, appUrl: paired.pairing?.appUrl || '' }
      }
      if (state.remote?.status === 'unavailable' && state.remote?.error) {
        const downloading = state.remote.adapters?.some(adapter => /下载|准备/.test(adapter.detail || ''))
        if (!downloading) throw new Error(state.remote.error)
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('EasyTier remote transport did not connect within five minutes')
  })()`)
  if (androidSerial) {
    const adb = process.env.ADB || path.join(process.env.ANDROID_HOME || 'D:\\Android\\Sdk', 'platform-tools', 'adb.exe')
    const launched = spawnSync(adb, [
      '-s', androidSerial,
      'shell', 'am', 'start', '-W',
      '-a', 'android.intent.action.VIEW',
      '-d', result.appUrl,
      'io.harnessdesktop.mobile'
    ], { encoding: 'utf8' })
    if (launched.status !== 0) throw new Error(launched.stderr || launched.stdout || 'Unable to open pairing link on Android')
    result.android = { serial: androidSerial, output: launched.stdout.trim() }
  }
  desktop.socket.close()
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
