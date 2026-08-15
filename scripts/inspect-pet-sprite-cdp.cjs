const fs = require('node:fs')
const path = require('node:path')
const WebSocket = require('ws')

async function main() {
  const forcedAction = process.argv.find(argument => argument.startsWith('--action='))?.split('=')[1] || 'idle'
  const forcedPosition = process.argv.find(argument => argument.startsWith('--position='))?.split('=')[1] || null
  const delay = Number(process.argv.find(argument => argument.startsWith('--delay='))?.split('=')[1] || 1800)
  const timelineMs = Number(process.argv.find(argument => argument.startsWith('--timeline='))?.split('=')[1] || 0)
  const noNavigate = process.argv.includes('--no-navigate')
  const throwPet = process.argv.includes('--throw')
  const showContextMenu = process.argv.includes('--context-menu')
  const summaryOnly = process.argv.includes('--summary')
  const pages = await (await fetch('http://127.0.0.1:9227/json')).json()
  const page = pages.find(candidate => candidate.url.includes('/renderer/pet/index.html'))
  if (!page) throw new Error('pet target missing')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
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

  if (forcedPosition) {
    await call('Runtime.evaluate', {
      expression: `(async () => {
        const environment = await window.maidWhale.getEnvironment()
        const floor = environment.workArea.y + environment.workArea.height - environment.bounds.height
        if (${JSON.stringify(forcedPosition)} === 'right-edge') {
          return window.maidWhale.moveTo(environment.workArea.x + environment.workArea.width - environment.bounds.width, floor)
        }
        if (${JSON.stringify(forcedPosition)} === 'left-edge') {
          return window.maidWhale.moveTo(environment.workArea.x, floor)
        }
        if (${JSON.stringify(forcedPosition)} === 'air') {
          return window.maidWhale.moveTo(environment.bounds.x, Math.max(environment.workArea.y, floor - 240))
        }
        if (${JSON.stringify(forcedPosition)} === 'main-left' && environment.mainBounds) {
          return window.maidWhale.moveTo(environment.mainBounds.x - environment.bounds.width + 75, floor)
        }
        return environment
      })()`,
      awaitPromise: true,
      returnByValue: true
    })
  }
  if (!noNavigate) {
    const targetUrl = new URL(page.url)
    targetUrl.searchParams.set('rigAction', forcedAction)
    await call('Page.navigate', { url: targetUrl.href })
    await new Promise(resolve => setTimeout(resolve, 250))
    if (forcedPosition) {
      await call('Runtime.evaluate', {
        expression: `(async () => {
          const environment = await window.maidWhale.getEnvironment()
          const floor = environment.workArea.y + environment.workArea.height - environment.bounds.height
          if (${JSON.stringify(forcedPosition)} === 'right-edge') return window.maidWhale.moveTo(environment.workArea.x + environment.workArea.width - environment.bounds.width, floor)
          if (${JSON.stringify(forcedPosition)} === 'left-edge') return window.maidWhale.moveTo(environment.workArea.x, floor)
          if (${JSON.stringify(forcedPosition)} === 'air') return window.maidWhale.moveTo(environment.bounds.x, Math.max(environment.workArea.y, floor - 240))
          if (${JSON.stringify(forcedPosition)} === 'main-left' && environment.mainBounds) return window.maidWhale.moveTo(environment.mainBounds.x - environment.bounds.width + 75, floor)
          return environment
        })()`,
        awaitPromise: true,
        returnByValue: true
      })
    }
  }
  if (throwPet) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 135, y: 230, button: 'left', buttons: 1, clickCount: 1 })
    for (const [x, y] of [[150, 205], [165, 175], [180, 140], [195, 100], [210, 55]]) {
      await new Promise(resolve => setTimeout(resolve, 35))
      await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
    }
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 210, y: 55, button: 'left', buttons: 0, clickCount: 1 })
  }
  if (showContextMenu) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 135, y: 220, button: 'right', buttons: 2, clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 135, y: 220, button: 'right', buttons: 0, clickCount: 1 })
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const timeline = []
  if (timelineMs > 0) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timelineMs) {
      await new Promise(resolve => setTimeout(resolve, 250))
      const sample = await call('Runtime.evaluate', {
        expression: `(async () => JSON.stringify({
          at: ${Date.now()} - ${startedAt},
          action: document.querySelector('#rigHost')?.dataset.rigAction,
          frame: document.querySelector('#rigHost')?.dataset.rigFrame,
          environment: await window.maidWhale.getEnvironment()
        }))()`,
        awaitPromise: true,
        returnByValue: true
      })
      timeline.push(JSON.parse(sample.result.value))
    }
  } else {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)))
  }
  const result = await call('Runtime.evaluate', {
    expression: `(async () => JSON.stringify({
      stage: document.querySelector('#rigHost')?.dataset.rigStage,
      format: document.querySelector('#rigHost')?.dataset.rigFormat,
      action: document.querySelector('#rigHost')?.dataset.rigAction,
      frame: document.querySelector('#rigHost')?.dataset.rigFrame,
      sheetCount: document.querySelectorAll('.sprite-sheet').length,
      sprite: document.querySelector('.sprite-sheet')?.dataset.src,
      characterCursor: getComputedStyle(document.querySelector('#character')).cursor,
      centerHitTarget: document.elementFromPoint(135, 220)?.id || document.elementFromPoint(135, 220)?.className,
      viewport: document.querySelector('.sprite-viewport')?.getBoundingClientRect().toJSON(),
      petState: await window.maidWhale.getState(),
      environment: await window.maidWhale.getEnvironment(),
      contextMenu: (() => {
        const menu = document.querySelector('#contextMenu')
        return { hidden: menu.hidden, rect: menu.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight } }
      })(),
      resources: performance.getEntriesByType('resource').map(entry => entry.name)
    }))()`,
    awaitPromise: true,
    returnByValue: true
  })
  const screenshot = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
  const outputDir = path.join(__dirname, '..', '..', '.runtime-pet-test')
  fs.mkdirSync(outputDir, { recursive: true })
  const output = path.join(outputDir, `pet-${forcedAction}.png`)
  fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'))
  socket.close()
  const parsedState = JSON.parse(result.result.value)
  if (summaryOnly) {
    const transitions = []
    for (const sample of timeline) {
      if (transitions.at(-1)?.action !== sample.action) transitions.push({ at: sample.at, action: sample.action, frame: sample.frame })
    }
    console.log(JSON.stringify({ screenshot: output, state: parsedState, transitions }, null, 2))
  } else {
    console.log(JSON.stringify({ screenshot: output, state: parsedState, timeline }, null, 2))
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
