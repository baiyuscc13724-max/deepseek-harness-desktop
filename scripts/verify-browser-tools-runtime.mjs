import { readFile } from 'node:fs/promises'
import path from 'node:path'

const port = Number(process.argv[2] || 9335)
const stateFile = path.resolve(process.argv[3] || '.artifacts/browser-tools-smoke-profile/browser-control.json')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`)
  return response.json()
}

async function waitForShell() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const target = (await targets()).find(item => item.type === 'page' && /renderer(?:\\|\/)index\.html/i.test(decodeURIComponent(item.url)))
      if (target) return target
    } catch {}
    await wait(400)
  }
  throw new Error('Desktop shell target was not ready.')
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    const task = pending.get(message.id)
    if (!task) return
    pending.delete(message.id)
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result)
  })
  return {
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
}

async function call(state, action, payload = {}) {
  const response = await fetch(`${state.origin}/action`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload })
  })
  return { status: response.status, body: await response.json() }
}

const shell = await waitForShell()
const cdp = await connect(shell.webSocketDebuggerUrl)
try {
  await cdp.send('Runtime.enable')
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#browserQuickButton').click()`, returnByValue: true })
  await wait(3500)
  const grant = await cdp.send('Runtime.evaluate', {
    expression: `window.desktopHarness.grantCurrentBrowserOrigin(['read','click','type','submit'])`,
    awaitPromise: true,
    returnByValue: true
  })
  if (!grant.result.value?.authorizations?.count) throw new Error(`Current site authorization failed: ${JSON.stringify(grant.result.value)}`)

  let state
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { state = JSON.parse(await readFile(stateFile, 'utf8')); break } catch {}
    await wait(250)
  }
  if (!state?.origin || !state?.token) throw new Error('Browser control state file was not created.')
  const status = await call(state, 'status')
  if (status.status !== 200 || !status.body.result?.visible || !status.body.result?.actions?.includes('read')) throw new Error(`Live status failed: ${JSON.stringify(status)}`)
  const observe = await call(state, 'observe')
  if (observe.status !== 200 || !observe.body.result?.origin || typeof observe.body.result?.text !== 'string') throw new Error(`Live observe failed: ${JSON.stringify(observe)}`)

  await cdp.send('Runtime.evaluate', {
    expression: `window.desktopHarness.revokeCurrentBrowserOrigin()`,
    awaitPromise: true,
    returnByValue: true
  })
  const denied = await call(state, 'observe')
  if (denied.status === 200 || denied.body.ok !== false) throw new Error(`Revoked observe was not denied: ${JSON.stringify(denied)}`)

  const guest = (await targets()).find(item => item.type === 'webview')
  console.log(JSON.stringify({
    passed: true,
    pluginProfile: 'desktop-browser-tools',
    origin: status.body.result.origin,
    visible: status.body.result.visible,
    observedElements: observe.body.result.interactive?.length || 0,
    deniedAfterRevoke: denied.body.code,
    officialGuest: guest?.url || null
  }, null, 2))
} finally {
  cdp.socket.close()
}
