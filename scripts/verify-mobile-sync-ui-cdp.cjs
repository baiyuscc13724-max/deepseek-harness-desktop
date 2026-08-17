const { writeFileSync } = require('node:fs')
const WebSocket = require('ws')

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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'renderer evaluation failed')
    return result.result.value
  }
  return { socket, call, evaluate }
}

async function main() {
  const port = Number(process.argv[2] || 9231)
  const screenshotFile = process.argv[3]
  const keepEnabled = process.argv.includes('--keep-enabled')
  let target = null
  for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
    const pages = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json()).catch(() => [])
    target = pages.find(candidate => candidate.url.endsWith('/renderer/index.html'))
    if (!target) await wait(500)
  }
  if (!target) throw new Error('Harness Desktop renderer target was not found.')
  const desktop = await connect(target)
  await desktop.evaluate(`(async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (window.desktopHarness && document.querySelector('#mobileSyncOverlay') && document.querySelector('#runtimeView')) return true
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('mobile sync controls were not ready')
  })()`)
  const result = {}
  result.initial = await desktop.evaluate('window.desktopHarness.getMobileSyncState()')
  result.opened = await desktop.evaluate(`(async () => {
    const view = document.querySelector('#runtimeView')
    await view.executeJavaScript(` + "`" + `(async () => {
      const findSettings = () => [...document.querySelectorAll('button,[role="button"]')].find(element => /^(设置|Settings)$/i.test((element.textContent || '').trim()))
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const button = findSettings()
        if (button) { button.click(); break }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const manage = document.querySelector('#harness-desktop-mobile-sync-row [data-hd-mobile-manage]')
        if (manage) { manage.click(); return true }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('mobile sync settings row was not mounted')
    })()` + "`" + `, true)
    await new Promise(resolve => setTimeout(resolve, 300))
    const overlay = document.querySelector('#mobileSyncOverlay')
    return !document.querySelector('#mobileSyncQuickButton') && !overlay.classList.contains('hidden') && overlay.getAttribute('aria-hidden') === 'false'
  })()`)
  result.enabled = await desktop.evaluate(`(async () => {
    const initial = await window.desktopHarness.getMobileSyncState()
    if (!initial.enabled || !initial.running) document.querySelector('#mobileSyncToggle').click()
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const state = await window.desktopHarness.getMobileSyncState()
      if (state.enabled && state.running) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('mobile sync did not start')
  })()`)
  result.pairing = await desktop.evaluate(`(async () => {
    if (!(await window.desktopHarness.getMobileSyncState()).pairing?.appUrl) {
      document.querySelector('#refreshMobilePairing').click()
    }
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const image = document.querySelector('#mobileSyncQr')
      const url = document.querySelector('#mobileSyncUrl').value
      let validUrl = false
      try {
        const parsed = new URL(url)
        validUrl = parsed.protocol === 'http:' && parsed.pathname.startsWith('/__harness_mobile__/pair/')
      } catch {}
      const state = await window.desktopHarness.getMobileSyncState()
      if (image.src.startsWith('data:image/png') && validUrl && state.pairing?.appUrl) {
        return {
          imageReady: true,
          url,
          appUrl: state.pairing?.appUrl || '',
          headline: document.querySelector('#mobileSyncHeadline').textContent,
          targetReady: state.targetReady
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('pairing QR did not render')
  })()`)
  if (screenshotFile) {
    const capture = await desktop.call('Page.captureScreenshot', { format: 'png', fromSurface: true })
    writeFileSync(screenshotFile, Buffer.from(capture.data, 'base64'))
  }
  result.closed = await desktop.evaluate(`(() => {
    document.querySelector('#closeMobileSync').click()
    return document.querySelector('#mobileSyncOverlay').classList.contains('hidden')
  })()`)
  if (!keepEnabled) await desktop.evaluate('window.desktopHarness.setMobileSyncEnabled(false)')
  desktop.socket.close()
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
