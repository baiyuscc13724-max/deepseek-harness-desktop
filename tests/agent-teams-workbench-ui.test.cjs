const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { readFile } = require('node:fs/promises')

const clientFile = path.resolve(__dirname, '..', 'plugins', 'dsh-agent-teams', 'lib', 'client.js')

async function clientSource() {
  return readFile(clientFile, 'utf8')
}

function componentSource(source, names) {
  for (const name of names) {
    const start = source.indexOf(`    function ${name}(`)
    if (start < 0) continue
    const next = source.indexOf('\n    function ', start + 1)
    return source.slice(start, next < 0 ? source.length : next)
  }
  assert.fail(`missing component: ${names.join(' / ')}`)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

function createLifecycleHarness(hookSource, options = {}) {
  let nextTimerId = 1
  const timeouts = new Map()
  const frames = new Map()
  const stateSlots = []
  const effects = []
  const fetchCalls = []
  const eventSources = []
  const listeners = new Map()
  const document = {
    visibilityState: options.visibilityState || 'visible',
    addEventListener(name, listener) {
      const entries = listeners.get(name) || new Set()
      entries.add(listener)
      listeners.set(name, entries)
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener)
    }
  }

  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this.namedListeners = new Map()
      eventSources.push(this)
    }

    addEventListener(name, listener) {
      const entries = this.namedListeners.get(name) || new Set()
      entries.add(listener)
      this.namedListeners.set(name, entries)
    }

    emit(name, snapshot) {
      const event = { data: JSON.stringify(snapshot) }
      if (name === 'message') this.onmessage?.(event)
      for (const listener of this.namedListeners.get(name) || []) listener(event)
    }

    close() {
      this.closed = true
    }
  }

  function setTimeoutFake(callback, delay) {
    const id = nextTimerId++
    timeouts.set(id, { callback, delay })
    return id
  }

  function clearTimeoutFake(id) {
    timeouts.delete(id)
  }

  function requestAnimationFrameFake(callback) {
    const id = nextTimerId++
    frames.set(id, callback)
    return id
  }

  function cancelAnimationFrameFake(id) {
    frames.delete(id)
  }

  function useState(initial) {
    const slot = { value: typeof initial === 'function' ? initial() : initial }
    stateSlots.push(slot)
    return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
  }

  function useRef(initial) {
    return { current: initial }
  }

  function useEffect(effect) {
    effects.push(effect)
  }

  const fetchState = options.fetchState || (() => {
    const operation = deferred()
    fetchCalls.push(operation)
    return operation.promise
  })
  const useTeamState = Function(
    'useState', 'useRef', 'useEffect', 'startTransition', 'fetchState', 'eventsUrl',
    'teamSnapshotVersion', 'errorText', 'document', 'EventSource', 'setTimeout',
    'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame',
    `${hookSource}\nreturn useTeamState`
  )(
    useState,
    useRef,
    useEffect,
    (work) => work(),
    (...args) => {
      const result = fetchState(...args)
      if (options.fetchState) fetchCalls.push(result)
      return result && result.promise ? result.promise : result
    },
    (sessionId, teamId) => `/events?sessionId=${sessionId}&teamId=${teamId}`,
    (snapshot) => String(snapshot?.revision || ''),
    (error) => String(error?.message || error),
    document,
    FakeEventSource,
    setTimeoutFake,
    clearTimeoutFake,
    requestAnimationFrameFake,
    cancelAnimationFrameFake
  )
  useTeamState('session-1', 'team-1')
  assert.equal(effects.length, 1, 'useTeamState must register one lifecycle effect')
  const cleanup = effects[0]()

  return {
    cleanup,
    document,
    eventSources,
    fetchCalls,
    frames,
    stateSlots,
    timeouts,
    dispatchVisibility(value) {
      document.visibilityState = value
      for (const listener of [...(listeners.get('visibilitychange') || [])]) listener()
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0
    },
    runFrames() {
      while (frames.size) {
        const pending = [...frames.entries()]
        frames.clear()
        for (const [, callback] of pending) callback()
      }
    },
    runTimeout(delay) {
      const entry = [...timeouts.entries()].find(([, timer]) => timer.delay === delay)
      assert.ok(entry, `missing timeout with delay ${delay}`)
      timeouts.delete(entry[0])
      entry[1].callback()
    }
  }
}

async function drainPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

test('the collaboration workbench remains inside the original Agent Teams conversation view', async () => {
  const source = await clientSource()

  assert.match(source, /ctx\.slots\.inject\("conversation\.view"/u)
  assert.match(source, /name: "conversation\.view", id: "agent-teams"/u)
  assert.equal((source.match(/name: "conversation\.view", id: "agent-teams"/gu) || []).length, 1)
  assert.doesNotMatch(source, /id: "(?:collaboration-workbench|task-board)", order:/u)

  for (const id of ['board', 'canvas', 'automation', 'participants', 'inbox']) {
    assert.match(source, new RegExp(`\\{ id: "${id}"`, 'u'), `missing workbench navigation id: ${id}`)
  }
  for (const label of ['任务板', '团队画布', '自动化', '参与者', '协调收件箱']) {
    assert.ok(source.includes(label), `missing localized workbench destination: ${label}`)
  }

  assert.match(source, /useState\("board"\)/u)
  assert.match(source, /className: "dat-workspace-nav"/u)
  assert.match(source, /aria-current/u)
})

test('participants owns project collaboration while the proven Team runtime views stay available', async () => {
  const source = await clientSource()
  const participants = componentSource(source, ['ParticipantsWorkspace', 'ParticipantsView'])

  assert.equal((source.match(/h\(ProjectTeamEntry, \{/gu) || []).length, 1, 'ProjectTeamEntry must have one presentation route')
  assert.match(participants, /h\(ProjectTeamEntry, \{[^}]*t: (?:props\.)?t/u)
  assert.match(participants, /t\("collaborationPreview"\)/u)
  assert.match(participants, /dat-collaboration-boundary/u)
  assert.ok(source.includes('团队任务、消息、离线恢复与冲突合并尚未接通'), 'remote participants must not be presented as fully synchronized executors')
  assert.ok(source.includes('远端成员不会被标为可分配执行者'), 'presence-only devices must stay outside the assignable local executor list')
  assert.ok(source.includes('Team-task sync, messages, offline recovery, and conflict merging are not wired yet'), 'the English boundary must remain as explicit as the Chinese boundary')
  assert.ok(source.includes('多人安全接入') && source.includes('连接预览'), 'the collaboration entry must present itself as a connectivity preview')
  assert.ok(source.includes('Secure multi-person access') && source.includes('Connectivity preview'), 'the English entry must avoid implying synchronized task collaboration')

  for (const marker of [
    'function ActiveTeam(props)',
    'function TeamCanvas(props)',
    'workMode === "canvas" ? h(TeamCanvas'
  ]) {
    assert.ok(source.includes(marker), `legacy Agent Teams capability disappeared: ${marker}`)
  }
  assert.match(source, /h\(ActiveTeam, \{/u)
  assert.match(source, /setWorkMode\("canvas"\)/u)
  assert.match(source, /setWorkMode\("list"\)/u)
})

test('an enabled workspace with no team keeps three distinct core-view empty states', async () => {
  const source = await clientSource()
  const teamView = componentSource(source, ['TeamView'])
  const emptyBoard = componentSource(source, ['EmptyTaskBoardWorkspace'])
  const emptyCanvas = componentSource(source, ['EmptyTeamCanvasWorkspace'])

  assert.match(emptyBoard, /data-empty-workspace": "board"/u)
  assert.match(emptyBoard, /h\(FirstTeamWizard/u)
  assert.match(emptyBoard, /dat-task-board/u)
  assert.match(emptyCanvas, /data-empty-workspace": "canvas"/u)
  assert.match(emptyCanvas, /emptyCanvasCoordination/u)
  assert.match(teamView, /teams\.length === 0/u)
  assert.match(teamView, /workspaceView === "canvas"[\s\S]*EmptyTeamCanvasWorkspace/u)
  assert.match(teamView, /workspaceView === "inbox"[\s\S]*CoordinationInboxWorkspace[^\n]*team: null/u)
  assert.match(teamView, /EmptyTaskBoardWorkspace/u)
  assert.equal((source.match(/h\(FirstTeamWizard, \{/gu) || []).length, 1, 'the old wizard must be onboarding inside the empty board only')

  const disabledGate = teamView.indexOf('snapshot && !snapshot.enabled')
  const participantsRoute = teamView.indexOf('workspaceView === "participants"')
  assert.ok(disabledGate >= 0 && participantsRoute > disabledGate, 'disabled state must gate every workbench destination')
})

test('the task board is a read-only projection of only the selected team', async () => {
  const source = await clientSource()
  const board = componentSource(source, ['TaskBoardWorkspace', 'TaskBoardView'])
  const column = componentSource(source, ['taskBoardColumn', 'boardColumnForTask'])

  assert.match(source, /h\((?:TaskBoardWorkspace|TaskBoardView), \{[^\n}]*team: team/u)
  assert.match(board, /props\.team/u)
  assert.match(board, /aria-readonly": "true"|"aria-readonly": true/u)
  assert.match(source, /boardScope: "当前(?:所选)?团队(?:的)?安全投影"/u)
  assert.match(source, /boardReadOnly: "只读任务板"/u)

  assert.match(column, /relationIds\(task\.blockedBy\)\.length/u)
  assert.match(column, /return "blocked"/u)
  assert.ok(
    column.indexOf('relationIds(task.blockedBy).length') < column.indexOf('task.status'),
    'blocked must be derived from dependency metadata before persisted task status is mapped'
  )

  assert.doesNotMatch(board, /postAction\(|method: "POST"|\/api\/agent-teams\/action/u)
  assert.doesNotMatch(board, /onDrop|draggable: true|task-(?:create|update)|"task-(?:create|update)"/u)
  assert.doesNotMatch(source, /postAction\([^\n]+"task-(?:create|update)"|fetch\([^\n]+\/tasks?[^\n]+method: "POST"/u)
  assert.match(board, /Number\.isFinite\(team && team\.taskCount\) \? team\.taskCount : tasks\.length/u)
  assert.match(board, /team && team\.projection && team\.projection\.tasksTruncated/u)
  assert.match(board, /boardProjectionLimited/u)
  assert.match(board, /events\.filter\(function \(event\) \{ return eventRelatesToTask\(event, selectedTask\); \}\)/u)
})

test('task columns queue without stretching the page or crushing cards beside the inspector', async () => {
  const source = await clientSource()
  const board = componentSource(source, ['TaskBoardWorkspace'])
  const sort = componentSource(source, ['sortBoardColumnTasks'])

  assert.match(source, /\.dat-board-main\{[^}]*container-type:inline-size;container-name:dat-board-main/u)
  assert.match(source, /@container dat-board-main \(min-width:680px\)\{\.dat-task-board\{grid-template-columns:repeat\(2/u)
  assert.match(source, /@container dat-board-main \(min-width:900px\)\{\.dat-task-board\{grid-template-columns:repeat\(4/u)
  assert.doesNotMatch(source, /@container dat-workspace \(min-width:900px\)\{\.dat-task-board/u)
  assert.match(source, /\.dat-board-column\{[^}]*height:clamp\([^}]*overflow:hidden/u)
  assert.match(source, /\.dat-board-column-list\{[^}]*grid-auto-rows:max-content[^}]*overflow-y:auto[^}]*overscroll-behavior:contain[^}]*scrollbar-gutter:stable/u)
  assert.match(source, /\.dat-board-card-title\{[^}]*-webkit-line-clamp:3/u)
  assert.match(source, /\.dat-board-card-owner\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/u)

  assert.match(sort, /pendingQueue = columnId === "pending"/u)
  assert.match(sort, /"completedAt", "updatedAt", "createdAt"/u)
  assert.match(sort, /pendingQueue \? leftTime - rightTime : rightTime - leftTime/u)
  assert.match(sort, /localeCompare\(String\(taskId\(right\)\)\)/u)
  assert.ok(board.indexOf('sortBoardColumnTasks(') < board.indexOf('.slice(0, column.limit)'), 'stable queue order must be applied before any projection cap')
  assert.equal((board.match(/limit: 200/gu) || []).length, 4)

  const helperStart = source.indexOf('function taskBoardTime(task, fields)')
  const helperEnd = source.indexOf('function eventRelatesToTask(event, task)', helperStart)
  const helpers = Function(`function taskId(task) { return task.id; }\n${source.slice(helperStart, helperEnd)}\nreturn { taskBoardTime, sortBoardColumnTasks };`)()
  assert.equal(helpers.taskBoardTime({ updatedAt: '2026-08-23T12:00:00Z' }, ['completedAt', 'updatedAt']), Date.parse('2026-08-23T12:00:00Z'))
  assert.deepEqual(helpers.sortBoardColumnTasks([
    { id: 'older', status: 'completed', updatedAt: '2026-08-22T12:00:00Z' },
    { id: 'newer', status: 'completed', updatedAt: '2026-08-23T12:00:00Z' }
  ], 'completed').map((task) => task.id), ['newer', 'older'])
})

test('automation embeds the existing session-local reminder projection without creating a second scheduler', async () => {
  const source = await clientSource()
  const automation = componentSource(source, ['AutomationWorkspace', 'AutomationView'])

  assert.equal((source.match(/\/api\/desktop-schedules\/state/gu) || []).length, 1)
  assert.match(automation, /\/api\/desktop-schedules\/state\?sessionId=/u)
  assert.match(automation, /encodeURIComponent\(props\.sessionId\)/u)
  assert.match(automation, /method: "GET"/u)
  assert.doesNotMatch(automation, /method: "POST"|postAction\(|\/api\/desktop-schedules\/(?:action|create|update|delete)/u)

  assert.match(source, /会话(?:本地|级)/u)
  assert.match(source, /session[- ]local/iu)
  assert.match(source, /原会话.*(?:在线|恢复)|恢复.*overdue|original session.*live/iu)
})

test('workbench navigation adapts to its conversation container instead of only the window', async () => {
  const source = await clientSource()

  assert.match(source, /\.dat-workspace\{[^}]*container-type:inline-size/u)
  assert.match(source, /@container(?:\s+[\w-]+)?\s*\(max-width:/u)
  assert.match(source, /@container(?:\s+[\w-]+)?\s*\(max-width:[^)]+\)\{[^}]*\.dat-workspace-nav/u)
  assert.match(source, /\.dat-workspace-nav\{[^}]*overflow-x:auto/u)
  assert.match(source, /@media\(max-width:[^)]+\)\{[^}]*\.dat-workspace-nav/u)
})

test('adapted task-board UI keeps its upstream provenance visible in source', async () => {
  const source = await clientSource()

  assert.match(source, /chuspeeism\/dashi-taskboard/iu)
  assert.match(source, /Apache(?: License)?[- ]2\.0/iu)
  assert.match(source, /adapted|改编|二次开发/iu)
})

test('team-state lifecycle does not let an older HTTP fallback overwrite a newer SSE snapshot', async () => {
  const source = await clientSource()
  const hook = componentSource(source, ['useTeamState'])
  const harness = createLifecycleHarness(hook)

  assert.equal(harness.eventSources.length, 1)
  assert.equal(harness.fetchCalls.length, 0, 'SSE is the primary source while it is available')
  harness.runTimeout(3000)
  assert.equal(harness.fetchCalls.length, 1, 'HTTP starts only after the initial SSE snapshot timeout')

  harness.eventSources[0].emit('snapshot', { enabled: true, team: { id: 'team-1' }, revision: 2 })
  harness.runFrames()
  assert.equal(harness.stateSlots[0].value.revision, 2)

  harness.fetchCalls[0].resolve({ enabled: true, team: { id: 'team-1' }, revision: 1 })
  await drainPromises()
  harness.runFrames()
  assert.equal(harness.stateSlots[0].value.revision, 2, 'the stream epoch must invalidate an older in-flight GET')

  harness.cleanup()
})

test('team-state lifecycle keeps at most one EventSource through repeated hide and resume cycles', async () => {
  const source = await clientSource()
  const hook = componentSource(source, ['useTeamState'])
  const harness = createLifecycleHarness(hook)

  assert.equal(harness.listenerCount('visibilitychange'), 1)
  for (let index = 0; index < 20; index += 1) {
    const previous = harness.eventSources.at(-1)
    harness.dispatchVisibility('hidden')
    assert.equal(previous.closed, true)
    assert.equal(harness.eventSources.filter((source) => !source.closed).length, 0)
    assert.equal(harness.timeouts.size, 0, 'hiding must clear fallback and polling timers')

    previous.emit('snapshot', { enabled: true, team: { id: 'team-1' }, revision: 100 + index })
    assert.equal(harness.frames.size, 0, 'a closed source must not publish queued events')

    harness.dispatchVisibility('visible')
    assert.equal(harness.eventSources.filter((source) => !source.closed).length, 1)
  }

  assert.equal(harness.eventSources.length, 21)
  assert.equal(harness.fetchCalls.length, 0, 'rapid resume must not duplicate HTTP snapshots before the SSE timeout')
  harness.cleanup()
  assert.equal(harness.eventSources.filter((source) => !source.closed).length, 0)
  assert.equal(harness.listenerCount('visibilitychange'), 0)
  assert.equal(harness.timeouts.size, 0)
})

test('team-state lifecycle cleanup closes the stream and cancels every queued callback', async () => {
  const source = await clientSource()
  const hook = componentSource(source, ['useTeamState'])
  const harness = createLifecycleHarness(hook)
  const stream = harness.eventSources[0]

  stream.emit('snapshot', { enabled: true, team: { id: 'team-1' }, revision: 1 })
  stream.onerror()
  assert.equal(harness.frames.size, 1)
  assert.equal(harness.timeouts.size, 1, 'SSE failure should have one sparse polling safety-net timer')

  harness.cleanup()
  assert.equal(stream.closed, true)
  assert.equal(harness.frames.size, 0)
  assert.equal(harness.timeouts.size, 0)
  assert.equal(harness.listenerCount('visibilitychange'), 0)

  stream.emit('snapshot', { enabled: true, team: { id: 'team-1' }, revision: 2 })
  harness.runFrames()
  await drainPromises()
  assert.equal(harness.stateSlots[0].value, null, 'callbacks from a disposed hook must not mutate React state')
  assert.equal(harness.fetchCalls.length, 0)
})
