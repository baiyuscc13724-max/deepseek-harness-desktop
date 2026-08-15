const WebSocket = require('ws')

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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'renderer evaluation failed')
    return result.result.value
  }
  return { socket, call, evaluate }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function mouseClick(call, { x = 135, y = 230, button = 'left', clickCount = 1 } = {}) {
  const buttons = button === 'left' ? 1 : button === 'right' ? 2 : 4
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount })
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount })
}

async function main() {
  const pages = await (await fetch('http://127.0.0.1:9227/json')).json()
  const mainTarget = pages.find(candidate => candidate.url.endsWith('/renderer/index.html'))
  const petTarget = pages.find(candidate => candidate.url.includes('/renderer/pet/index.html'))
  if (!mainTarget || !petTarget) throw new Error('desktop or pet target missing')
  const desktop = await connect(mainTarget)
  const pet = await connect(petTarget)

  const result = { desktop: {}, interactions: {} }
  result.desktop.initial = await desktop.evaluate('window.desktopHarness.getPetState()')
  result.desktop.panelOpened = await desktop.evaluate(`(() => {
    document.querySelector('#petQuickButton').click()
    const panel = document.querySelector('#petPanel')
    return !panel.classList.contains('hidden') && panel.getAttribute('aria-hidden') === 'false'
  })()`)
  await desktop.evaluate("document.querySelector('#petAwakeToggle').click()")
  await wait(250)
  result.desktop.afterTuck = await desktop.evaluate('window.desktopHarness.getPetState()')
  await desktop.evaluate("document.querySelector('#petAwakeToggle').click()")
  await wait(250)
  result.desktop.afterWake = await desktop.evaluate('window.desktopHarness.getPetState()')
  result.desktop.panelClosed = await desktop.evaluate(`(() => {
    document.querySelector('#closePetPanel').click()
    return document.querySelector('#petPanel').classList.contains('hidden')
  })()`)

  await pet.evaluate(`(async () => {
    const environment = await window.maidWhale.getEnvironment()
    const floor = environment.workArea.y + environment.workArea.height - environment.bounds.height
    return window.maidWhale.moveTo(environment.workArea.x, floor)
  })()`)
  await pet.evaluate(`(() => {
    window.__petActionTimeline = [document.querySelector('#rigHost').dataset.rigAction]
    window.__petActionObserver?.disconnect()
    window.__petActionObserver = new MutationObserver(() => {
      const action = document.querySelector('#rigHost').dataset.rigAction
      if (window.__petActionTimeline.at(-1) !== action) window.__petActionTimeline.push(action)
    })
    window.__petActionObserver.observe(document.querySelector('#rigHost'), { attributes: true, attributeFilter: ['data-rig-action'] })
  })()`)
  await mouseClick(pet.call)
  await wait(300)
  result.interactions.singleClick = await pet.evaluate("document.querySelector('#rigHost').dataset.rigAction")
  result.interactions.singleClickTimeline = await pet.evaluate(`(() => {
    window.__petActionObserver?.disconnect()
    return window.__petActionTimeline
  })()`)

  const pettingBefore = await pet.evaluate('window.maidWhale.getState()')
  await pet.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 135, y: 105, button: 'left', buttons: 1, clickCount: 1 })
  await wait(340)
  await pet.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 140, y: 108, button: 'left', buttons: 1 })
  await wait(90)
  result.interactions.pettingAction = await pet.evaluate("document.querySelector('#rigHost').dataset.rigAction")
  result.interactions.gazeTransform = await pet.evaluate("document.querySelector('.sprite-viewport').style.transform")
  await pet.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 140, y: 108, button: 'left', buttons: 0, clickCount: 1 })
  await wait(300)
  const pettingAfter = await pet.evaluate('window.maidWhale.getState()')
  result.interactions.pettingState = {
    moodBefore: pettingBefore.mood,
    moodAfter: pettingAfter.mood,
    affectionBefore: pettingBefore.affection,
    affectionAfter: pettingAfter.affection
  }

  await mouseClick(pet.call, { clickCount: 1 })
  await wait(60)
  await mouseClick(pet.call, { clickCount: 2 })
  await wait(300)
  result.interactions.doubleClick = await pet.evaluate("document.querySelector('#rigHost').dataset.rigAction")

  await mouseClick(pet.call, { button: 'right' })
  await wait(200)
  result.interactions.contextMenu = await pet.evaluate(`(() => {
    const menu = document.querySelector('#contextMenu')
    return {
      visible: !menu.hidden,
      labels: [...menu.querySelectorAll('button')].map(button => button.textContent.trim()),
      feedDisabled: document.querySelector('#feedButton').disabled
    }
  })()`)
  if (!result.interactions.contextMenu.feedDisabled) {
    result.interactions.feedBefore = await pet.evaluate('window.maidWhale.getState()')
    await pet.evaluate("document.querySelector('#feedButton').click()")
    await wait(350)
    result.interactions.feedAfter = await pet.evaluate('window.maidWhale.getState()')
    result.interactions.feedAction = await pet.evaluate("document.querySelector('#rigHost').dataset.rigAction")
  } else {
    await pet.evaluate("document.querySelector('#contextMenu').hidden = true")
  }
  result.interactions.final = await pet.evaluate(`(async () => ({
    action: document.querySelector('#rigHost').dataset.rigAction,
    sheetCount: document.querySelectorAll('.sprite-sheet').length,
    environment: await window.maidWhale.getEnvironment()
  }))()`)

  desktop.socket.close()
  pet.socket.close()
  console.log(JSON.stringify(result, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
