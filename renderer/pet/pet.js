import { MaidWhaleSpriteRig } from './pet-sprite-rig.js'

'use strict'

const api = window.maidWhale
const { PetBehaviorEngine } = window.MaidWhaleBehavior
const { PetInteractionEngine } = window.MaidWhaleInteraction
const pet = document.querySelector('#pet')
const speech = document.querySelector('#speech')
const character = document.querySelector('#character')
const rigHost = document.querySelector('#rigHost')
const focusButton = document.querySelector('#focusButton')
const feedButton = document.querySelector('#feedButton')
const tuckButton = document.querySelector('#tuckButton')
const contextMenu = document.querySelector('#contextMenu')
const tokBubble = document.querySelector('#tokBubble')

let rig = null
let state = null
let environment = null
let action = 'idle'
let direction = 1
let lastAwardAt = null
let lastAutoFeedAt = null
let lastCompanionCueId = null
let speechTimer = null
let moveInFlight = false
let queuedMove = null
let lastFrameAt = performance.now()
let velocity = { x: 0, y: 0 }
let dragging = null
let climbing = null
let perching = null
let perchTimer = null
let ceiling = null
let ceilingTimer = null
let petHoldTimer = null
const previewAction = new URLSearchParams(window.location.search).get('rigAction')

function elementRegion(element, padding = 0) {
  const bounds = element.getBoundingClientRect()
  return {
    x: Math.floor(bounds.left - padding),
    y: Math.floor(bounds.top - padding),
    width: Math.ceil(bounds.width + padding * 2),
    height: Math.ceil(bounds.height + padding * 2)
  }
}

function syncWindowShape() {
  const regions = []
  if (speech.classList.contains('show')) regions.push(elementRegion(speech, 1))
  if (!contextMenu.hidden) regions.push(elementRegion(contextMenu, 2))
  api.setInteractive({ interactive: !contextMenu.hidden, regions })
}

const messages = {
  working: '正在努力工作…',
  'needs-input': '有任务在等你决定',
  blocked: '任务遇到问题了',
  ready: '任务完成啦！',
  celebrating: '完成！一起庆祝吧',
  sleeping: '需要休息一下…',
  hungry: '有点饿了',
  wave: '我在呢～',
  feeding: '好吃！谢谢主人',
  drag: '要带我去哪里？'
}

function resolvedMotion(preference = 'system') {
  if (preference === 'still' || preference === 'full' || preference === 'reduced') return preference
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
}

function showSpeech(message, duration = 2600) {
  clearTimeout(speechTimer)
  speech.textContent = message
  speech.classList.add('show')
  requestAnimationFrame(syncWindowShape)
  if (duration > 0) {
    speechTimer = setTimeout(() => {
      speech.classList.remove('show')
      syncWindowShape()
    }, duration)
  }
}

function applyAction(next, meta = {}) {
  action = next
  if (meta.direction) direction = meta.direction
  pet.dataset.action = next
  rig?.setAction(next, { direction })
  if (rig) api.setHitProfile(rig.hitProfile(next))
  if (messages[next]) showSpeech(messages[next])
  if (next === 'walk') velocity.x = 20 * direction
  if (next === 'climb') velocity = { x: 0, y: -240 }
  if (!['walk', 'fall', 'climb'].includes(next)) velocity.x = 0
}

const behavior = new PetBehaviorEngine({ onAction: applyAction })

async function loadRig() {
  rig = new MaidWhaleSpriteRig({
    host: rigHost,
    manifestUrl: '../pets/maid-whale/atlas/maid-whale.atlas.json'
  })
  await rig.load()
  rig.setAction(action, { direction })
  api.setHitProfile(rig.hitProfile(action))
}

async function refreshEnvironment() {
  environment = await api.getEnvironment()
  return environment
}

async function flushMove(x, y) {
  if (moveInFlight) {
    queuedMove = { x, y }
    return null
  }
  moveInFlight = true
  try {
    environment = await api.moveTo(x, y)
    return environment
  } finally {
    moveInFlight = false
    const next = queuedMove
    queuedMove = null
    if (next) flushMove(next.x, next.y)
  }
}

function startFall(vx = 0, vy = 0) {
  climbing = null
  perching = null
  ceiling = null
  clearTimeout(perchTimer)
  clearTimeout(ceilingTimer)
  velocity = { x: Math.max(-720, Math.min(720, vx)), y: Math.max(-760, Math.min(760, vy)) }
  behavior.perform('fall', 0, { force: true, direction: velocity.x < 0 ? -1 : 1 })
}

function startClimb(kind, side, targetTop = null) {
  direction = side === 'left' ? -1 : 1
  climbing = { kind, side, targetTop, startedAt: performance.now() }
  behavior.perform('climb', 0, { force: true, direction })
}

function startCeiling(side) {
  climbing = null
  clearTimeout(ceilingTimer)
  direction = side === 'left' ? 1 : -1
  ceiling = { side, startedAt: performance.now() }
  velocity = { x: 26 * direction, y: 0 }
  behavior.perform('ceiling', 0, { force: true, direction })
  ceilingTimer = setTimeout(() => {
    if (action === 'ceiling') startFall(direction * 75, 35)
  }, 4500 + Math.floor(Math.random() * 5000))
}

function startPerch(surface, side) {
  climbing = null
  clearTimeout(perchTimer)
  const surfaceBounds = surface?.bounds || environment?.mainBounds
  const currentBounds = environment?.bounds
  perching = surfaceBounds && currentBounds ? {
    surfaceId: surface?.id || 'workbench',
    side,
    offsetX: currentBounds.x - surfaceBounds.x
  } : null
  behavior.perform('perch', 0, { force: true, direction: side === 'left' ? -1 : 1 })
  perchTimer = setTimeout(() => {
    if (action === 'perch') startFall(side === 'left' ? -90 : 90, -40)
  }, 6500 + Math.floor(Math.random() * 6500))
}

function mainWindowObstacle(bounds, mainBounds, movementDirection) {
  if (!mainBounds || mainBounds.width <= 0 || mainBounds.height <= 0) return null
  const characterLeft = bounds.x + 75
  const characterRight = bounds.x + bounds.width - 75
  const characterTop = bounds.y + 30
  const characterBottom = bounds.y + bounds.height - 14
  if (characterBottom < mainBounds.y + 28 || characterTop > mainBounds.y + mainBounds.height) return null
  if (movementDirection > 0 && characterRight >= mainBounds.x && characterLeft < mainBounds.x) {
    return { side: 'left', x: mainBounds.x - bounds.width + 75, top: mainBounds.y - bounds.height + 18 }
  }
  if (movementDirection < 0 && characterLeft <= mainBounds.x + mainBounds.width && characterRight > mainBounds.x + mainBounds.width) {
    return { side: 'right', x: mainBounds.x + mainBounds.width - 75, top: mainBounds.y - bounds.height + 18 }
  }
  return null
}

function surfaceObstacle(bounds, surfaces, movementDirection) {
  for (const surface of surfaces || []) {
    const obstacle = mainWindowObstacle(bounds, surface.bounds, movementDirection)
    if (obstacle) return { ...obstacle, surface }
  }
  return null
}

function land() {
  velocity = { x: 0, y: 0 }
  behavior.perform('land', 1300, { force: true })
}

function physicsFrame(now) {
  const dt = Math.min(.05, Math.max(0, (now - lastFrameAt) / 1000))
  lastFrameAt = now
  if (environment && !dragging && state?.preferences?.motion !== 'still') {
    const bounds = environment.bounds
    if (action === 'walk') {
      flushMove(bounds.x + velocity.x * dt, bounds.y).then(result => {
        if (!result || action !== 'walk') return
        const obstacle = surfaceObstacle(result.bounds, result.surfaces || (result.mainBounds ? [{ id: 'workbench', bounds: result.mainBounds }] : []), direction)
        if (obstacle) {
          flushMove(obstacle.x, result.bounds.y)
          startClimb('window', obstacle.side, obstacle.top)
          climbing.surface = obstacle.surface
        } else if (result.collisions.left) startClimb('screen', 'left')
        else if (result.collisions.right) startClimb('screen', 'right')
      })
    } else if (action === 'climb' && climbing) {
      const minimumY = environment.workArea.y - bounds.height + 34
      const targetY = climbing.kind === 'screen'
        ? minimumY
        : Math.max(minimumY, climbing.targetTop ?? environment.workArea.y)
      flushMove(bounds.x, Math.max(targetY, bounds.y + velocity.y * dt)).then(result => {
        if (!result || action !== 'climb' || !climbing) return
        const reachedTarget = result.bounds.y <= targetY + 1
        const timedOut = performance.now() - climbing.startedAt > (climbing.kind === 'window' ? 6000 : 8000)
        if (reachedTarget && climbing.kind === 'window') {
          startPerch(climbing.surface, climbing.side)
        } else if (reachedTarget && climbing.kind === 'screen') {
          startCeiling(climbing.side)
        } else if (reachedTarget || timedOut) {
          startFall(climbing.side === 'left' ? 95 : -95, -20)
        }
      })
    } else if (action === 'ceiling' && ceiling) {
      const minimumY = environment.workArea.y - bounds.height + 34
      flushMove(bounds.x + velocity.x * dt, minimumY).then(result => {
        if (!result || action !== 'ceiling') return
        if (result.collisions.left || result.collisions.right) {
          direction *= -1
          velocity.x = 26 * direction
          rig?.setAction('ceiling', { direction })
        }
      })
    } else if (action === 'fall') {
      velocity.y = Math.min(980, velocity.y + 1200 * dt)
      velocity.x *= Math.pow(.985, dt * 60)
      flushMove(bounds.x + velocity.x * dt, bounds.y + velocity.y * dt).then(result => {
        if (!result || action !== 'fall') return
        if (result.collisions.left || result.collisions.right) velocity.x *= -.42
        if (result.collisions.bottom && velocity.y >= 0) land()
        else if (result.collisions.top && velocity.y < 0) velocity.y *= -.35
      })
    } else if (action === 'perch' && perching) {
      const surface = (environment.surfaces || []).find(item => item.id === perching.surfaceId)
      if (surface?.bounds) {
        const targetX = surface.bounds.x + perching.offsetX
        const targetY = surface.bounds.y - bounds.height + 18
        if (Math.abs(bounds.x - targetX) > 1 || Math.abs(bounds.y - targetY) > 1) flushMove(targetX, targetY)
      }
    }
  }
  requestAnimationFrame(physicsFrame)
}

function render(next) {
  state = next
  pet.dataset.motion = resolvedMotion(next.preferences?.motion)
  behavior.update(next)
  feedButton.disabled = !Object.values(next.inventory || {}).some(value => value > 0) || next.fullness >= 100
  if (next.lastAward?.at && next.lastAward.at !== lastAwardAt) {
    lastAwardAt = next.lastAward.at
    tokBubble.textContent = `+${next.lastAward.quantity} TOK`
    tokBubble.classList.remove('show')
    requestAnimationFrame(() => tokBubble.classList.add('show'))
  }
  if (next.lastAutoFeed?.at && next.lastAutoFeed.at !== lastAutoFeedAt) {
    lastAutoFeedAt = next.lastAutoFeed.at
    behavior.perform('feeding', 4200, { force: true, source: 'auto-feed' })
    showSpeech(`我自己吃了 ${next.lastAutoFeed.quantity} 颗 TOK`)
  }
  const cue = next.companionCue
  if (cue?.id && cue.id !== lastCompanionCueId) {
    lastCompanionCueId = cue.id
    const oneShot = ['wave', 'wink', 'groom', 'look-around', 'tail-flick'].includes(cue.action)
    if (oneShot && ['idle', 'hungry'].includes(action)) {
      behavior.perform(cue.action, Math.min(5000, Math.max(1200, Number(cue.duration) || 2600)), { force: true, source: 'companion' })
    }
    showSpeech(cue.message, Math.min(8000, Math.max(1200, Number(cue.duration) || 3200)))
  }
}

function hideContextMenu() {
  contextMenu.hidden = true
  syncWindowShape()
}

function showContextMenu(event) {
  event.preventDefault()
  contextMenu.hidden = false
  const width = contextMenu.offsetWidth
  const height = contextMenu.offsetHeight
  contextMenu.style.left = `${Math.max(5, Math.min(event.clientX, window.innerWidth - width - 5))}px`
  contextMenu.style.top = `${Math.max(5, Math.min(event.clientY, window.innerHeight - height - 5))}px`
  syncWindowShape()
}

function dragSample(event) {
  const now = performance.now()
  dragging.samples.push({ x: event.screenX, y: event.screenY, at: now })
  dragging.samples = dragging.samples.filter(item => now - item.at <= 120).slice(-5)
}

function interactionHotspot(event) {
  const viewport = rigHost.querySelector('.sprite-viewport')
  if (!viewport) return 'body'
  const bounds = viewport.getBoundingClientRect()
  const x = (event.clientX - bounds.left) / Math.max(1, bounds.width)
  const y = (event.clientY - bounds.top) / Math.max(1, bounds.height)
  const profile = rig?.hitProfile(action) || { left: 0, top: 0, right: 1, bottom: 1 }
  if (x < profile.left || x > profile.right || y < profile.top || y > profile.bottom) return 'outside'
  if (y >= 0.16 && y <= 0.55) return 'head'
  if (x >= 0.67 && y >= 0.46) return 'tail'
  return 'body'
}

function interactionPoint(event) {
  return {
    pointerId: event.pointerId,
    x: event.screenX,
    y: event.screenY,
    at: performance.now(),
    hotspot: interactionHotspot(event)
  }
}

function finishDrag() {
  if (!dragging) return
  const samples = dragging.samples
  const first = samples[0]
  const last = samples[samples.length - 1]
  const seconds = Math.max(.016, (last.at - first.at) / 1000)
  const vx = (last.x - first.x) / seconds
  const vy = (last.y - first.y) / seconds
  dragging = null
  if (Math.hypot(vx, vy) > 180 || vy < -120) startFall(vx, vy)
  else land()
}

const interaction = new PetInteractionEngine({
  onEvent: event => {
    if (event.type === 'tap') {
      const next = event.hotspot === 'head' ? 'wink' : event.hotspot === 'tail' ? 'tail-flick' : 'wave'
      const actionable = ['needs-input', 'blocked'].includes(state?.status) && state?.focusSessionId
      if (actionable) api.focusMain(state.focusSessionId).catch(() => {})
      else api.interact(event.hotspot === 'tail' ? 'play' : 'tap').catch(() => {})
      behavior.perform(next, next === 'wink' ? 1600 : 1800, { force: true, source: 'interaction' })
    } else if (event.type === 'pet-start') {
      if (dragging) dragging.petting = true
      behavior.perform('petting', 0, { force: true, source: 'interaction' })
      showSpeech('好舒服，再摸摸我吧')
    } else if (event.type === 'pet-end') {
      api.interact('petting').catch(() => {})
      behavior.perform('petting', 1200, { force: true, source: 'interaction' })
    } else if (event.type === 'drag-start') {
      if (dragging) {
        dragging.active = true
        dragging.petting = false
      }
      behavior.perform('drag', 0, { force: true, source: 'interaction' })
    } else if (event.type === 'drag-move' && dragging) {
      flushMove(event.lastX - dragging.offsetX, event.lastY - dragging.offsetY)
    } else if (event.type === 'drag-end') {
      finishDrag()
    }
  }
})

character.addEventListener('contextmenu', showContextMenu)
character.addEventListener('pointerdown', async event => {
  if (event.button !== 0) return
  hideContextMenu()
  character.setPointerCapture(event.pointerId)
  const current = environment || await refreshEnvironment()
  if (!character.hasPointerCapture(event.pointerId)) return
  dragging = {
    pointerId: event.pointerId,
    active: false,
    offsetX: event.screenX - current.bounds.x,
    offsetY: event.screenY - current.bounds.y,
    originX: event.screenX,
    originY: event.screenY,
    samples: [],
    lastPoint: interactionPoint(event)
  }
  dragSample(event)
  interaction.begin(dragging.lastPoint)
  clearTimeout(petHoldTimer)
  petHoldTimer = setTimeout(() => {
    if (dragging?.lastPoint) interaction.hold({ ...dragging.lastPoint, at: performance.now() })
  }, 285)
})

character.addEventListener('pointermove', event => {
  const hotspot = interactionHotspot(event)
  character.dataset.hotspot = hotspot
  const viewport = rigHost.querySelector('.sprite-viewport')
  if (viewport) {
    const bounds = viewport.getBoundingClientRect()
    rig?.setGaze(((event.clientX - bounds.left) / Math.max(1, bounds.width) - .5) * 2, ((event.clientY - bounds.top) / Math.max(1, bounds.height) - .45) * 2)
  }
  if (!dragging || event.pointerId !== dragging.pointerId) return
  dragging.lastPoint = interactionPoint(event)
  dragSample(event)
  interaction.move(dragging.lastPoint)
})

character.addEventListener('pointerup', event => {
  if (!dragging || event.pointerId !== dragging.pointerId) return
  clearTimeout(petHoldTimer)
  petHoldTimer = null
  dragSample(event)
  const result = interaction.end(interactionPoint(event))
  if (result?.type !== 'drag-end') dragging = null
})

character.addEventListener('pointercancel', () => {
  clearTimeout(petHoldTimer)
  petHoldTimer = null
  const wasActive = Boolean(dragging?.active)
  const wasPetting = Boolean(dragging?.petting)
  interaction.cancel()
  dragging = null
  if (wasActive) startFall(0, 0)
  else if (wasPetting) behavior.release('petting')
})

character.addEventListener('dblclick', () => behavior.perform('celebrating', 5200, { force: true }))

focusButton.addEventListener('click', () => {
  hideContextMenu()
  api.focusMain(state?.focusSessionId || null)
})
feedButton.addEventListener('click', async () => {
  hideContextMenu()
  const inventory = state?.inventory || {}
  const kind = inventory.fragments > 0 ? 'fragments' : inventory.standard > 0 ? 'standard' : 'refined'
  render(await api.feed(kind))
  behavior.perform('feeding', 4200, { force: true })
})
tuckButton.addEventListener('click', () => {
  hideContextMenu()
  api.setAwake(false)
})

document.addEventListener('mousemove', event => {
  if (dragging) return
  if (!event.target.closest?.('#character')) rig?.setGaze(0, 0)
})
document.addEventListener('pointerdown', event => {
  if (!event.target.closest?.('.context-menu') && event.target !== character) hideContextMenu()
})
document.addEventListener('mouseleave', () => {
  if (!dragging && contextMenu.hidden) {
    rig?.setGaze(0, 0)
    syncWindowShape()
  }
})
window.addEventListener('blur', hideContextMenu)

Promise.all([loadRig(), refreshEnvironment(), api.getState()]).then(([, current, initialState]) => {
  environment = current
  render(initialState)
  if (previewAction) behavior.perform(previewAction, 0, { force: true, direction: 1 })
  const floor = current.workArea.y + current.workArea.height - current.bounds.height
  if (current.bounds.y < floor - 2 && resolvedMotion(initialState.preferences?.motion) !== 'still') startFall(0, 0)
  requestAnimationFrame(physicsFrame)
}).catch(error => {
  rigHost.dataset.rigStage = 'error'
  rigHost.dataset.rigError = error?.stack || error?.message || String(error)
  showSpeech(error.message, 0)
})

api.onStateChanged(render)
setInterval(() => refreshEnvironment().catch(() => {}), 700)
