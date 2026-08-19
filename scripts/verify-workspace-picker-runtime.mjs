const port = Number(process.argv[2] || 9334)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

async function targetList() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`)
  return response.json()
}

async function waitForGuest() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const guest = (await targetList()).find(target => target.type === 'webview' && /^http:\/\/127\.0\.0\.1:/u.test(target.url))
      if (guest) return guest
    } catch {}
    await wait(500)
  }
  throw new Error('Official Harness guest target was not ready.')
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result)
  })
  return {
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const requestId = ++id
        pending.set(requestId, { resolve, reject })
        socket.send(JSON.stringify({ id: requestId, method, params }))
      })
    }
  }
}

const guest = await waitForGuest()
const cdp = await connect(guest.webSocketDebuggerUrl)
try {
  await cdp.send('Runtime.enable')
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await cdp.send('Runtime.evaluate', {
      expression: `Boolean(document.querySelector('button[aria-label="选择工作区"],button[aria-label="Choose workspace"]'))`,
      returnByValue: true
    })
    if (ready.result.value) break
    if (attempt === 79) {
      const debug = await cdp.send('Runtime.evaluate', { expression: `({ text: document.body?.innerText?.slice(0, 4000), buttons: [...document.querySelectorAll('button')].map(node => ({ text: node.textContent, aria: node.getAttribute('aria-label') })).slice(0, 80) })`, returnByValue: true })
      throw new Error(`Choose workspace button was not rendered: ${JSON.stringify(debug.result.value)}`)
    }
    await wait(500)
  }
  await cdp.send('Runtime.evaluate', {
    expression: `(() => { const next = [...document.querySelectorAll('button')].find(node => /^(继续|Continue|稍后配置|Skip for now)$/i.test((node.textContent || '').trim())); if (next) next.click(); return Boolean(next) })()`, 
    returnByValue: true
  })
  await wait(500)
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('button[aria-label="选择工作区"],button[aria-label="Choose workspace"]').click()`,
    returnByValue: true
  })
  await wait(450)
  const bridgeState = () => cdp.send('Runtime.evaluate', {
    expression: `(() => ({
      available: Boolean(window.__HARNESS_DESKTOP_DIRECTORY_PICKER__),
      pending: window.__HARNESS_DESKTOP_DIRECTORY_PICKER__?.pending?.size || 0,
      location: location.href
    }))()`,
    returnByValue: true
  })
  let bridge = await bridgeState()
  let trigger = 'direct'
  if (!bridge.result.value.available || bridge.result.value.pending !== 1) {
    const menu = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const nodes = [...document.querySelectorAll('button,[role="menuitem"]')]
        const add = nodes.find(node => /添加工作区|Add workspace/i.test(node.textContent || ''))
        if (!add) return { clicked: false, visible: nodes.map(node => (node.textContent || '').trim()).filter(Boolean).slice(-30) }
        add.click()
        return { clicked: true, text: (add.textContent || '').trim() }
      })()`,
      returnByValue: true
    })
    if (!menu.result.value.clicked) {
      const debug = await cdp.send('Runtime.evaluate', { expression: `document.body.innerText.slice(0, 4000)`, returnByValue: true })
      throw new Error(`Workspace flow did not open: ${JSON.stringify({ buttons: menu.result.value.visible, body: debug.result.value, bridge: bridge.result.value })}`)
    }
    trigger = menu.result.value.text
    await wait(900)
    bridge = await bridgeState()
  }
  const value = bridge.result.value
  if (!value.available || value.pending !== 1) throw new Error(`Desktop directory picker bridge did not own the flow: ${JSON.stringify(value)}`)
  console.log(JSON.stringify({ passed: true, guest: guest.url, trigger, bridge: value }, null, 2))
} finally {
  cdp.socket.close()
}
