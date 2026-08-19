const port = Number(process.argv[2] || 9333)
const base = `http://127.0.0.1:${port}`

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function targets() {
  const response = await fetch(`${base}/json/list`)
  if (!response.ok) throw new Error(`CDP target list failed: ${response.status}`)
  return response.json()
}

async function waitForShell() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await targets()
      const shell = list.find(target => target.type === 'page' && /renderer(?:\\|\/)index\.html/i.test(decodeURIComponent(target.url)))
      if (shell) return shell
    } catch {}
    await wait(500)
  }
  throw new Error('Harness Desktop shell did not expose a CDP target in time.')
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed.')), { once: true })
  })
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return { socket, send }
}

const shell = await waitForShell()
const cdp = await connect(shell.webSocketDebuggerUrl)
try {
  await cdp.send('Runtime.enable')
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#browserQuickButton').click()`, returnByValue: true })
  await wait(3500)
  const ui = await cdp.send('Runtime.evaluate', {
    expression: `(() => ({
      expanded: document.querySelector('#browserQuickButton').getAttribute('aria-expanded'),
      sidebarHidden: document.querySelector('#browserSidebar').classList.contains('hidden'),
      bodyOpen: document.body.classList.contains('browser-sidebar-open'),
      address: document.querySelector('#browserAddress').value,
      profileNotice: document.querySelector('#browserProfilePanel').textContent
    }))()`,
    returnByValue: true
  })
  const value = ui.result.value
  if (value.expanded !== 'true' || value.sidebarHidden || !value.bodyOpen) throw new Error(`Sidebar did not open correctly: ${JSON.stringify(value)}`)
  if (!String(value.address).startsWith('https://')) throw new Error(`Address bar did not expose the visible URL: ${value.address}`)
  if (!String(value.profileNotice).includes('模型无法读取密码、Cookie、验证码或令牌')) throw new Error('Visible user-login privacy notice is missing.')

  const stateResult = await cdp.send('Runtime.evaluate', {
    expression: `window.desktopHarness.getBrowserState()`,
    awaitPromise: true,
    returnByValue: true
  })
  const state = stateResult.result.value
  if (!state.visible || state.profile?.partition !== 'persist:harness-side-browser' || state.profile?.isolatedFromHarness !== true) {
    throw new Error(`Browser profile isolation state is invalid: ${JSON.stringify(state)}`)
  }

  const list = await targets()
  const browserPage = list.find(target => target.type === 'page' && /^https:\/\//i.test(target.url) && !/127\.0\.0\.1/u.test(target.url))
  if (!browserPage) throw new Error('Independent WebContentsView page target was not created.')

  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#browserProfileButton').click()`, returnByValue: true })
  await wait(250)
  const profile = await cdp.send('Runtime.evaluate', {
    expression: `!document.querySelector('#browserProfilePanel').classList.contains('hidden')`,
    returnByValue: true
  })
  if (profile.result.value !== true) throw new Error('Profile management panel did not open.')
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('#closeBrowserSidebar').click()`, returnByValue: true })

  console.log(JSON.stringify({
    passed: true,
    shellTarget: shell.url,
    browserTarget: browserPage.url,
    partition: state.profile.partition,
    addressBar: value.address,
    profilePanel: true
  }, null, 2))
} finally {
  cdp.socket.close()
}
