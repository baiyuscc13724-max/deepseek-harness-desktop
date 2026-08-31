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

test('Project Tasks is an independent safe workspace with direct state, action, and refetch-only stream contracts', async () => {
  const source = await clientSource()
  const projection = `${componentSource(source, ['normalizeProjectCollaboration'])}\n${componentSource(source, ['normalizeProjectTasksState'])}`
  const webError = componentSource(source, ['projectTaskResponseError'])
  const errorSummary = componentSource(source, ['projectTaskErrorSummary'])
  const hook = componentSource(source, ['useProjectTasksState'])
  const workspace = componentSource(source, ['ProjectTasksWorkspace'])
  const action = componentSource(source, ['postProjectTaskAction'])
  const remoteTargetsSource = componentSource(source, ['collaboratorTaskTargets'])
  const normalize = Function(`${projection}\nreturn normalizeProjectTasksState`)()
  const remoteTargets = Function(`${remoteTargetsSource}\nreturn collaboratorTaskTargets`)()
  const extractError = Function(`${webError}\nreturn projectTaskResponseError`)()
  const summarizeError = Function(`${errorSummary}\nreturn projectTaskErrorSummary`)()

  const authorityState = normalize({ capability: { available: true, canCreate: true, kind: 'authority', reason: '' }, projectRevision: 601, totalExact: true, totalTasks: 601, page: { includedTasks: 120, hasMore: true, nextCursor: 'opaque-page' }, tasks: [] })
  assert.deepEqual(authorityState.capability, { available: true, writable: true, canCreate: true, kind: 'authority', reason: '', taskCommands: [] })
  assert.equal(authorityState.totalExact, true)
  assert.equal(authorityState.totalTasks, 601)
  assert.deepEqual(authorityState.page, { includedTasks: 120, hasMore: true, nextCursor: 'opaque-page' })
  const collaboratorState = normalize({ capability: { mode: 'collaborator', available: true, writable: true, taskCommands: ['claim', 'transition', 'forged'], deviceRef: 'hidden-device' }, tasks: [{ taskRef: 'task_safe', title: '<img src=x onerror=hidden()>', status: 'todo', revision: 2, hasAssignee: false, blockedByCount: 1, allowedActions: ['claim', 'transition', 'forged'], actorRef: 'hidden-actor', fileScope: ['hidden/path'] }] })
  assert.deepEqual(collaboratorState.capability, { available: true, writable: true, canCreate: false, kind: 'collaborator', reason: '', taskCommands: ['claim', 'transition'] })
  assert.deepEqual(collaboratorState.tasks[0], { taskRef: 'task_safe', title: '<img src=x onerror=hidden()>', status: 'todo', statusGroup: 'pending', revision: 2, createdAt: 0, updatedAt: 0, hasAssignee: false, blockedByCount: 1, allowedActions: ['claim', 'transition'], allowedTransitions: [] })
  const collaboratorTaskTextContent = collaboratorState.tasks.map((task) => `${task.title} ${task.status} ${task.revision}`).join(' ')
  assert.ok(collaboratorTaskTextContent.includes('<img src=x onerror=hidden()>'), 'malicious labels remain inert text rather than HTML')
  assert.equal(collaboratorTaskTextContent.includes('hidden-device'), false)
  assert.equal(JSON.stringify(collaboratorState).includes('hidden-device'), false)
  assert.equal(JSON.stringify(collaboratorState).includes('hidden-actor'), false)
  assert.equal(JSON.stringify(collaboratorState).includes('hidden/path'), false)
  const offlineState = normalize({ capability: { mode: 'collaborator', available: false, writable: true, taskCommands: ['claim'] }, tasks: [{ taskRef: 'cached', title: 'Cached safely', status: 'todo', revision: 1, allowedActions: ['claim'] }] })
  assert.equal(offlineState.capability.writable, false)
  assert.equal(offlineState.tasks[0].title, 'Cached safely')
  for (const status of ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled']) assert.ok(remoteTargets(status).every((target) => !['blocked', 'in_review', 'done'].includes(target)))
  assert.equal(normalize({ capability: { kind: 'collaborator', reason: 'collaborator' } }).capability.kind, 'collaborator')
  assert.equal(normalize({ capability: { kind: 'no-project', reason: 'not-created' } }).capability.kind, 'no-project')
  const nested = extractError({ status: 409 }, { ok: false, error: { code: 'PROJECT_TASK_REVISION_CONFLICT', message: 'machine conflict', nextAction: 'refresh', retryable: false, safeDetails: { ignored: true } } })
  assert.equal(nested.code, 'PROJECT_TASK_REVISION_CONFLICT')
  assert.equal(nested.message, 'machine conflict')
  assert.equal(nested.nextAction, 'refresh')
  assert.equal(nested.retryable, false)
  assert.equal(String(nested).includes('[object Object]'), false)
  assert.equal(summarizeError(nested, (key) => key), 'projectTasksChangedError')
  assert.equal(summarizeError({ code: 'PROJECT_TASK_IDEMPOTENCY_CONFLICT' }, (key) => key), 'projectTasksIntentConflictError')
  assert.equal(summarizeError({ code: 'PROJECT_TASK_FORBIDDEN' }, (key) => key), 'projectTasksPermissionError')
  assert.equal(summarizeError({ code: 'PROJECT_TASK_DEPENDENCY_BLOCKED' }, (key) => key), 'projectTasksDependencyError')
  assert.equal(summarizeError({ code: 'PROJECT_ENTRY_NOT_CREATED' }, (key) => key), 'projectTasksProjectError')

  // The Project Tasks transport/API may continue to exist, but its former workspace
  // is not a second Agent Teams destination. The existing aggregate board stays on flow.
  const navigation = componentSource(source, ['WorkspaceNav'])
  const teamView = componentSource(source, ['TeamView'])
  assert.equal((navigation.match(/label: t\("workspaceFlow"\)/gu) || []).length, 1)
  assert.doesNotMatch(navigation, /id: "projectTasks"|workspaceProjectTasks/u)
  assert.ok(source.includes('workspaceFlow: "跨会话任务"'))
  assert.ok(source.includes('workspaceFlow: "Cross-session tasks"'))
  assert.doesNotMatch(source, /workspaceProjectTasks: "同项目·跨会话任务"|workspaceProjectTasks: "Same-project · cross-session tasks"/u)
  assert.match(teamView, /workspaceView === "flow"[\s\S]*h\(ProjectCollaborationWorkspace/u)
  assert.match(teamView, /workspaceView === "projectTasks"[\s\S]*h\(ProjectCollaborationWorkspace/u)
  assert.doesNotMatch(teamView, /h\(ProjectTasksWorkspace/u)
  assert.match(projection, /taskRef:[^\n]*title:[^\n]*status:[^\n]*statusGroup:[^\n]*priority:[^\n]*revision:[^\n]*createdAt:[^\n]*updatedAt:[^\n]*hasAssignee:[^\n]*blockedByCount:[^\n]*allowedActions:[^\n]*allowedTransitions:/u)
  assert.deepEqual(authorityState.groupTotals, { in_progress: 0, in_review: 0, blocked: 0, pending: 0, completed: 0, canceled: 0 })
  assert.match(projection, /Object\.freeze\(tasks\)/u)
  assert.match(projection, /totalExact: source\.totalExact === true/u)
  assert.match(projection, /page: page/u)
  assert.match(projection, /\["authority", "collaborator", "no-project", "unavailable"\]/u)
  assert.doesNotMatch(projection, /projectRef|eventRef|sessionId|actorRef|ownerActorRef|assigneeActorRef|fileScope|commentBody/u)
  assert.match(webError, /body\.error && typeof body\.error === "object"/u)
  assert.match(webError, /details\.message[\s\S]*details\.code[\s\S]*details\.nextAction/u)
  assert.doesNotMatch(webError, /new Error\(body\.error/u)
  assert.match(errorSummary, /REVISION|OCC/u)
  assert.match(errorSummary, /IDEMPOTENCY/u)
  assert.match(errorSummary, /FORBIDDEN|PERMISSION/u)
  assert.match(errorSummary, /BLOCKED|DEPENDENCY/u)
  assert.match(errorSummary, /UNAVAILABLE|NOT_CREATED/u)
  assert.match(hook, /fetch\("\/api\/agent-teams\/project\/tasks\/state"/u)
  assert.match(hook, /new EventSource\("\/api\/agent-teams\/project\/tasks\/stream"\)/u)
  for (const eventName of ['reset', 'capability', 'task']) assert.match(hook, new RegExp(`addEventListener\\("${eventName}", refetch\\)`, 'u'))
  assert.match(hook, /reloadRef\.current\(true\)/u)
  assert.doesNotMatch(hook, /JSON\.parse\(event\.data\)|setState\([^\n]*event/u)
  assert.match(hook, /return function \(\) \{[\s\S]*source\.close\(\)/u)

  assert.match(action, /fetch\("\/api\/agent-teams\/project\/tasks\/action"/u)
  assert.match(action, /var encoded = JSON\.stringify\(body\)/u)
  assert.doesNotMatch(action, /return request\(\)\.catch|return request\(\)[\s\S]*return request\(\)/u)
  const originalTaskFetch = global.fetch
  const originalTaskParser = global.projectTaskResponseError
  let actionRequests = 0
  global.fetch = async () => { actionRequests += 1; throw new TypeError('offline') }
  global.projectTaskResponseError = (response, input) => Object.assign(new Error(input.error.message), input.error, { status: response.status })
  try {
    const post = Function(`${action}\nreturn postProjectTaskAction`)()
    await assert.rejects(() => post({ commandId: 'same-command', type: 'claim', taskRef: 'task_safe', expectedRevision: 2, payload: {} }), /offline/u)
    assert.equal(actionRequests, 1, 'transport failures require an explicit user retry')
    actionRequests = 0
    global.fetch = async () => { actionRequests += 1; return { ok: false, status: 403, json: async () => ({ error: { code: 'PROJECT_BUSINESS_SYNC_FORBIDDEN', message: 'revoked', nextAction: 'refresh', retryable: false } }) } }
    await assert.rejects(() => post({ commandId: 'revoked-command', type: 'claim', taskRef: 'task_safe', expectedRevision: 2, payload: {} }), (error) => error.code === 'PROJECT_BUSINESS_SYNC_FORBIDDEN')
    assert.equal(actionRequests, 1)
  } finally { global.fetch = originalTaskFetch; global.projectTaskResponseError = originalTaskParser }
  assert.match(workspace, /type: "create"[\s\S]*expectedRevision: 0[\s\S]*payload: \{ title: title\.trim\(\) \}/u)
  assert.match(workspace, /safeTask\.allowedTransitions/u)
  assert.match(workspace, /capability\.taskCommands\.indexOf\("claim"\)[\s\S]*safeTask\.allowedActions\.indexOf\("claim"\)/u)
  assert.match(workspace, /type: "claim"[\s\S]*taskRef: safeTask\.taskRef[\s\S]*expectedRevision: safeTask\.revision[\s\S]*payload: \{\}/u)
  assert.match(workspace, /capability\.taskCommands\.indexOf\("transition"\)[\s\S]*safeTask\.allowedActions\.indexOf\("transition"\)[\s\S]*collaboratorTaskTargets/u)
  assert.match(workspace, /type: "transition"[\s\S]*taskRef: safeTask\.taskRef[\s\S]*expectedRevision: safeTask\.revision[\s\S]*payload: \{ to: nextStatus \}/u)
  assert.match(workspace, /setBusyKey\(actionKey\)/u)
  assert.match(workspace, /tasks\.reload\(\)/u)
  assert.doesNotMatch(workspace, /setState\([^\n]*(?:status|revision)|expectedRevision\s*\+\s*1/u)

  const sensitive = /projectRef|eventRef|sessionId|actorRef|ownerActorRef|assigneeActorRef|authorities|fileScope|commentBody/u
  assert.doesNotMatch(hook, sensitive)
  assert.doesNotMatch(action, sensitive)
  assert.doesNotMatch(workspace, sensitive)
  assert.doesNotMatch(workspace, /postAction\(|inputActions\.(?:setDraft|submit|send)|autoApprove|approveRun|reviewTask/u)
  assert.match(workspace, /projectTasksNoProject[\s\S]*setWorkspaceView\("participants"\)/u)
  assert.match(workspace, /projectTasksCollaboratorUnavailable/u)
  assert.match(workspace, /projectTasksPendingReceipt/u)
  assert.match(workspace, /var canCreate = capability && capability\.canCreate === true, canWrite = collaborator && capability\.available === true && capability\.writable === true/u)
  assert.match(workspace, /if \(!canCreate \|\| !title\.trim\(\)/u)
  assert.match(workspace, /canCreate \? h\("form"[\s\S]*projectTasksCreateUnavailable/u)
  assert.match(workspace, /fetch\("\/api\/agent-teams\/project\/tasks\/page\?cursor=" \+ encodeURIComponent\(requestedCursor\), \{ method: "GET"/u)
  assert.match(workspace, /onClick: loadMoreProjectTasks/u)
  assert.match(workspace, /loaded: loadedTasks, total: totalTasks, remaining: remainingTasks/u)
  assert.match(workspace, /collaborator \? t\("projectTasksPreviewCount"/u)
  assert.doesNotMatch(workspace, /projectTasksHasMore|setInterval|prefetch|retry\(/iu)
  assert.doesNotMatch(workspace, /\(state && state\.tasks \|\| \[\]\)[\s\S]*projectTasksUnavailable/u)
})

test('paged clients preserve stable ids, replace bounded collaboration windows, reset on revisions, and stay user driven', async () => {
  const source = await clientSource()
  const mergeTasksSource = componentSource(source, ['mergeProjectTasks'])
  const mergeTeamsSource = componentSource(source, ['mergeProjectTeamBoardTeams'])
  const countsSource = componentSource(source, ['projectTeamBoardLoadedCounts'])
  const taskWorkspace = componentSource(source, ['ProjectTasksWorkspace'])
  const teamWorkspace = componentSource(source, ['ProjectCollaborationWorkspace'])
  const collaborationPageSource = componentSource(source, ['projectCollaborationPageItems'])
  const mergeTasks = Function(`${mergeTasksSource}\nreturn mergeProjectTasks`)()
  const mergeTeams = Function(`${mergeTeamsSource}\nreturn mergeProjectTeamBoardTeams`)()
  const collaborationPageItems = Function(`${collaborationPageSource}\nreturn projectCollaborationPageItems`)()
  const loadedCounts = Function(`${countsSource}\nreturn projectTeamBoardLoadedCounts`)()

  assert.deepEqual(mergeTasks([{ taskRef: 'a', revision: 1 }, { taskRef: 'b', revision: 1 }], [{ taskRef: 'b', revision: 2 }, { taskRef: 'c', revision: 1 }]), [{ taskRef: 'a', revision: 1 }, { taskRef: 'b', revision: 2 }, { taskRef: 'c', revision: 1 }])
  const mergedTeams = mergeTeams([{ id: 'team-a', name: 'old', tasks: [{ id: 'one', title: 'old' }, { id: 'two' }] }], [{ id: 'team-a', name: 'new', tasks: [{ id: 'one', title: 'new' }, { id: 'three' }] }, { id: 'team-b', tasks: [] }])
  assert.deepEqual(mergedTeams.map((team) => team.id), ['team-a', 'team-b'])
  assert.deepEqual(mergedTeams[0].tasks.map((task) => task.id), ['one', 'two', 'three'])
  assert.equal(mergedTeams[0].tasks[0].title, 'new')
  assert.deepEqual(loadedCounts(mergedTeams), { teams: 2, tasks: 3 })

  assert.match(taskWorkspace, /useEffect\(function \(\) \{[\s\S]*pageRequestEpoch\.current \+= 1;[\s\S]*setPageState\(basePageState\)[\s\S]*\}, \[resetKey\]\)/u)
  assert.match(teamWorkspace, /useProjectTasksState\(\)/u)
  assert.match(teamWorkspace, /projectCollaboration/u)
  assert.match(teamWorkspace, /requests\.slice\(0, 120\)/u)
  assert.match(teamWorkspace, /sectionPage\(name\)[\s\S]*nextCursor/u)
  assert.deepEqual(collaborationPageItems('tasks', [{ taskRef: 'a' }, { taskRef: 'a', revision: 2 }, { taskRef: 'b' }]), [{ taskRef: 'a' }, { taskRef: 'b' }])
  const allPageRefs = Array.from({ length: 157 }, (_, index) => `page-${String(index).padStart(3, '0')}`), observedPageRefs = []
  for (let offset = 0; offset < allPageRefs.length; offset += 24) {
    const expectedPage = allPageRefs.slice(offset, offset + 24), visiblePage = collaborationPageItems('tasks', expectedPage.map((taskRef) => ({ taskRef })).concat(expectedPage.length ? [{ taskRef: expectedPage[0] }] : []))
    assert.ok(visiblePage.length <= 120, 'every rendered continuation page remains DOM-bounded')
    assert.deepEqual(visiblePage.map((item) => item.taskRef), expectedPage, 'the current cursor page is visible before advancing again')
    observedPageRefs.push(...visiblePage.map((item) => item.taskRef))
  }
  assert.deepEqual(observedPageRefs, allPageRefs, 'more than 120 records remain fully traversable across page replacement')
  assert.equal(new Set(observedPageRefs).size, allPageRefs.length, 'multi-page traversal never duplicates a stable ref')
  assert.match(teamWorkspace, /incoming = projectCollaborationPageItems\(name, next\[name\]\)[\s\S]*values\[name\] = incoming; pages\[name\] = next\.sectionPages\[name\]/u)
  assert.doesNotMatch(teamWorkspace, /mergeCollaborationSectionItems|current\.push|\.concat\(incoming/u)
  assert.equal((teamWorkspace.match(/role: "status", "aria-live": "polite", "aria-atomic": "true"/gu) || []).length, 1, 'pagination uses one atomic polite status region')
  assert.match(teamWorkspace, /notice: name/u)
  assert.match(teamWorkspace, /activeSectionTitle \+ " · " \+ t\("projectTeamBoardLoadingMore"\) \+ " · " \+ activeSectionCount/u)
  assert.match(teamWorkspace, /activeSectionTitle \+ " · " \+ t\("projectTeamBoardLoadError"\) \+ " · " \+ activeSectionCount/u)
  assert.match(teamWorkspace, /activeSectionTitle \+ " · " \+ t\("collaborationShowing", \{ shown: activeSectionLoaded, total: activeSectionTotal \}\)/u)
  assert.match(teamWorkspace, /ariaLabel: label/u)
  assert.match(teamWorkspace, /label = t\("projectTeamBoardLoadMore"\) \+ " · " \+ title/u)
  assert.equal((teamWorkspace.match(/"aria-busy": sectionCurrent\.loading ===/gu) || []).length >= 3, true, 'section-specific panels expose busy state')
  assert.match(teamWorkspace, /collaborationRequestHint/u)
  assert.doesNotMatch(taskWorkspace + teamWorkspace, /setInterval|prefetch|autoRetry|retry\(/iu)
  assert.match(teamWorkspace, /collaborationShowing/u)
  assert.match(teamWorkspace, /collaborationMore/u)
  assert.match(teamWorkspace, /taskGroups = \[\["in_progress"[\s\S]*\["in_review"[\s\S]*\["blocked"[\s\S]*\["pending"[\s\S]*\["completed"[\s\S]*\["canceled"/u)
  assert.match(teamWorkspace, /task\.statusGroup \|\| projectTaskGroup/u)
  assert.match(teamWorkspace, /"aria-labelledby": headingId/u)
  assert.match(teamWorkspace, /groupTasks\.length \+ "\/" \+ total/u)
  assert.match(teamWorkspace, /Number\.isSafeInteger\(task\.priority\)[\s\S]*task\.updatedAt/u)
  assert.match(source, /\.dat-collaboration-task-item\{[^}]*min-height:44px[^}]*content-visibility:auto/u)
  assert.match(source, /\.dat-collaboration-task-group\[data-group=completed\]\{border-style:dashed;background:/u)
  assert.match(source, /\.dat-collaboration-task-group\[data-group=canceled\]\{border-style:dashed;background:[^}]*margin-top/u)
  assert.doesNotMatch(source, /\.dat-collaboration-task-group\[data-group=(?:completed|canceled)\]\{opacity:/u)
  assert.match(source, /@media\(max-width:620px\)/u)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/u)
})

test('WorkspaceNav renders a dense single flow destination and legacy projectTasks routes to the same board', async () => {
  const source = await clientSource()
  const navigation = componentSource(source, ['WorkspaceNav'])
  const teamView = componentSource(source, ['TeamView'])
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) })
  const WorkspaceNav = Function('h', `${navigation}\nreturn WorkspaceNav`)(h)
  const tree = WorkspaceNav({ t: key => key, counts: { tasks: 2, projectTeamTasks: 5, members: 3, schedules: 1, events: 4 }, value: 'flow', onChange() {} })
  const buttons = tree.children.filter(node => node && node.type === 'button')

  assert.equal(tree.type, 'nav')
  assert.ok(tree.children.every(node => node !== undefined && node !== null), 'navigation children must be dense')
  assert.ok(buttons.every(button => button.props && typeof button.props.key === 'string' && button.children[0]?.children?.[0]), 'every navigation slot must render a keyed, labelled button')
  assert.equal(buttons.filter(button => button.props['data-harness-mobile-workspace-view'] === 'flow').length, 1)
  assert.equal(buttons.filter(button => button.props['data-harness-mobile-workspace-view'] === 'projectTasks').length, 0)
  assert.equal(buttons.filter(button => button.children[0]?.children?.[0] === 'workspaceFlow').length, 1)
  assert.doesNotMatch(navigation, /\[\s*,|,\s*,|,\s*\]/u, 'WorkspaceNav items must not contain array holes')

  assert.match(teamView, /workspaceView === "projectTasks" \|\| workspaceView === "flow"\) \{[\s\S]*?workspaceContent = h\(ProjectCollaborationWorkspace/u)
  assert.equal((teamView.match(/h\(ProjectCollaborationWorkspace/gu) || []).length, 1, 'flow and its legacy alias must share one board render branch')
  assert.doesNotMatch(teamView, /workspaceView === "projectTasks"[\s\S]*h\(ProjectTasksWorkspace/u)
})

test('cross-session pagination retains bilingual, touch, ARIA, reduced-motion, visibility, and composer safety boundaries', async () => {
  const source = await clientSource()
  const teamWorkspace = componentSource(source, ['ProjectCollaborationWorkspace'])
  for (const text of ['加载更多', 'Load more', '剩余 {remaining}', '{remaining} remaining', '跨会话任务', 'Cross-session tasks']) assert.ok(source.includes(text), text)
  assert.match(source, /\.dat-project-team-board \.dat-btn\{min-height:44px\}/u)
  assert.match(source, /\.dat-project-tasks-page \.dat-btn\{min-height:44px\}/u)
  assert.match(source, /\.dat-project-team-group\{[^}]*content-visibility:auto;contain-intrinsic-size:auto 220px/u)
  assert.match(source, /\.dat-project-task-card\{[^}]*content-visibility:auto;contain-intrinsic-size:auto 132px/u)
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/u)
  assert.match(teamWorkspace, /"aria-labelledby": "dat-project-collaboration-title"/u)
  assert.match(teamWorkspace, /"aria-labelledby": "dat-collaboration-requests-title"/u)
  assert.match(teamWorkspace, /collaborationRequestState/u)
  assert.match(teamWorkspace, /collaborationRequestDeadline/u)
  assert.doesNotMatch(teamWorkspace, /inputActions\.(?:submit|send)|postProjectTaskAction|method: "POST"/u)
})

test('the collaboration workbench remains inside the original Agent Teams conversation view', async () => {
  const source = await clientSource()

  assert.match(source, /ctx\.slots\.inject\("conversation\.view"/u)
  assert.match(source, /name: "conversation\.view", id: "agent-teams"/u)
  assert.equal((source.match(/name: "conversation\.view", id: "agent-teams"/gu) || []).length, 1)
  assert.doesNotMatch(source, /id: "(?:collaboration-workbench|task-board)", order:/u)

  for (const id of ['board', 'canvas', 'automation', 'participants', 'inbox']) {
    assert.match(source, new RegExp(`\\{ id: "${id}"`, 'u'), `missing workbench navigation id: ${id}`)
  }
  for (const label of ['任务板', '团队画布', '自动化', '参与者', '协调记录']) {
    assert.ok(source.includes(label), `missing localized workbench destination: ${label}`)
  }

  assert.match(source, /useState\("board"\)/u)
  assert.match(source, /className: "dat-workspace-nav"/u)
  assert.match(source, /aria-current/u)
  const viewRender = source.indexOf('return h("main", { className: "dat-view"')
  const navRender = source.indexOf('h(WorkspaceNav, {', viewRender)
  const headingRender = source.indexOf('h("div", { className: "dat-head" }', viewRender)
  assert.ok(viewRender >= 0 && navRender > viewRender && headingRender > navRender, 'the horizontal team panel must render above the workbench heading')
})

test('participants owns project collaboration while the proven Team runtime views stay available', async () => {
  const source = await clientSource()
  const participants = componentSource(source, ['ParticipantsWorkspace', 'ParticipantsView'])

  assert.equal((source.match(/h\(ProjectTeamEntry, \{/gu) || []).length, 1, 'ProjectTeamEntry must have one presentation route')
  assert.match(participants, /h\(ProjectTeamEntry, \{[^}]*t: (?:props\.)?t/u)
  assert.match(participants, /t\("collaborationPreview"\)/u)
  assert.match(participants, /dat-collaboration-boundary/u)
  assert.ok(source.includes('同步项目任务与项目自动化的安全摘要'), 'remote participants must disclose the bounded M4 safe sync')
  assert.ok(source.includes('旧团队任务、团队消息和远端成员分配仍只在负责人团队中处理'), 'remote devices must stay outside the assignable local executor list')
  assert.ok(source.includes('sync safe Project Task and Project Automation summaries'), 'the English M4 boundary must remain as explicit as the Chinese boundary')
  assert.ok(source.includes('多人连接（预览）') && source.includes('仅连接预览'), 'the collaboration entry must present itself as a connectivity preview')
  assert.ok(source.includes('Connect other people (preview)') && source.includes('Connection preview only'), 'the English entry must avoid implying synchronized task collaboration')

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
  assert.match(source, /boardScope: "当前团队任务（仅查看）"/u)
  assert.match(source, /boardReadOnly: "仅查看"/u)
  assert.match(source, /系统仍会校验你的权限和任务状态是否为最新/u)
  assert.match(source, /permission and current-state checks still apply/u)
  assert.doesNotMatch(source, /boardBlockedDerived: "[^"]*blockedBy/u)

  assert.match(column, /relationIds\(task\.blockedBy\)\.length/u)
  assert.match(column, /return "attention"/u)
  assert.ok(
    column.indexOf('status === "cancelled"') < column.indexOf('relationIds(task.blockedBy).length'),
    'terminal cancellation must remain visible instead of being remapped to a derived blocked column'
  )

  assert.doesNotMatch(board, /postAction\(|method: "POST"|\/api\/agent-teams\/action/u)
  assert.doesNotMatch(board, /onDrop|draggable: true|task-(?:create|update)|"task-(?:create|update)"/u)
  assert.doesNotMatch(board, /postAction\([^\n]+"task-(?:create|update)"|fetch\([^\n]+\/tasks?[^\n]+method: "POST"/u)
  assert.match(board, /Number\.isFinite\(team && team\.taskCount\) \? team\.taskCount : tasks\.length/u)
  assert.match(board, /team && team\.projection && team\.projection\.tasksTruncated/u)
  assert.match(board, /boardProjectionLimited/u)
  assert.match(board, /events\.filter\(function \(event\) \{ return eventRelatesToTask\(event, selectedTask\); \}\)/u)
})

test('board and live canvas close stale task details locally while valid blocked tasks keep guidance', async () => {
  const source = await clientSource()
  const board = componentSource(source, ['TaskBoardWorkspace'])
  const active = componentSource(source, ['ActiveTeam'])
  for (const component of [board, active]) {
    assert.match(component, /selectedTaskId && !selectedTask/u)
    assert.match(component, /setSelectedTaskId\(""\)/u)
    assert.match(component, /taskSelectionExpired/u)
    assert.match(component, /role: "status"/u)
  }
  assert.match(board, /function openTaskDetail\(event, task\) \{ if \(!task \|\| !taskId\(task\)\) return;[\s\S]*setSelectionNotice\(""\); setSelectedTaskId\(taskId\(task\)\); \}/u)
  assert.match(active, /setTaskSelectionNotice\(""\);[\s\S]*setSelectedTaskId\(taskId\(task\)\)/u)
  const detail = componentSource(source, ['TaskDetailSidebar'])
  assert.match(detail, /safeTaskDetail\(props\.task\)/u)
  assert.match(detail, /detail\.blockedBy\.length/u)
  assert.match(detail, /blockedTaskUnknown/u)
  assert.match(detail, /blockedTaskNext/u)
  assert.doesNotMatch(detail, /task\.dependencies\.map/u)
})

test('selected board task becomes the visual focus with a truthful live workflow', async () => {
  const source = await clientSource()
  const board = componentSource(source, ['TaskBoardWorkspace'])
  const focus = componentSource(source, ['TaskDetailFocus'])
  const workflow = componentSource(source, ['TaskWorkflow'])
  const detailHook = componentSource(source, ['useTaskDetailState'])
  assert.match(board, /className: "dat-board-main", hidden: !!selectedTaskId/u)
  assert.match(board, /selectedTaskId \? h\(TaskDetailFocus/u)
  assert.doesNotMatch(board, /TaskDetailSidebar|dat-scrim|detailModal/u)
  assert.match(focus, /className: "dat-panel dat-task-focus", role: "region"/u)
  assert.match(focus, /props\.detailConnection \|\| props\.connection/u)
  assert.match(focus, /events\.slice\(0, eventLimit\)/u)
  assert.match(focus, /t\("taskNextStep"\)/u)
  for (const field of ['taskBrief', 'taskDescription', 'taskClaimant', 'taskResponsible', 'taskClaimedAt', 'taskCompletedAt', 'taskModelUsed']) assert.match(focus, new RegExp(`t\\("${field}"\\)`, 'u'))
  assert.doesNotMatch(focus, /t\("files"\)|filesHidden/u)
  assert.match(workflow, /workflow\.stages\.forEach/u)
  assert.match(workflow, /runtimeWorkflow\.events/u)
  assert.match(workflow, /runtimeEvents\.slice\(\)\.reverse\(\)/u)
  assert.match(workflow, /className: "dat-task-block-branch", "data-active": "true"/u)
  assert.match(board, /useTaskDetailState\(props\.sessionId, team && teamId\(team\), selectedTaskId\)/u)
  assert.match(detailHook, /new EventSource\(taskDetailEventsUrl/u)
  assert.match(detailHook, /source\.addEventListener\("snapshot", update\)/u)
  assert.match(detailHook, /String\(next\.taskId \|\| ""\) !== String\(selectedTaskId\)/u)
  assert.match(detailHook, /fetchTaskDetail\(sessionId, selectedTeamId, selectedTaskId\)/u)
  assert.match(detailHook, /source && typeof source\.close === "function"/u)
  assert.match(detailHook, /\[sessionId, selectedTeamId, selectedTaskId\]/u)
  assert.match(source, /\/api\/agent-teams\/task-detail\/events/u)
  assert.match(source, /\.dat-task-focus\{min-height:clamp\(460px,62vh,760px\)/u)
  assert.match(source, /\.dat-task-focus-grid\{grid-template-columns:minmax\(0,1\.55fr\) minmax\(280px,\.72fr\)/u)
  assert.match(source, /\.dat-task-stage-track\{display:grid;grid-template-columns:minmax\(0,1fr\) 28px minmax\(0,1fr\) 28px minmax\(0,1fr\)/u)
  assert.match(source, /\.dat-task-workflow-runtime\{display:grid/u)
  assert.match(source, /\.dat-task-runtime-list\{[^}]*overflow:auto/u)
  for (const copy of ['任务简介', '详细任务', '领取人', '责任人', '领取时间', '完成时间', '使用的模型', '实时执行记录', 'Host 里程碑', '成员 checkpoint（未验证）', 'Task brief', 'Detailed task', 'Claimed by', 'Responsible lead', 'Live execution log', 'Host milestones', 'Member checkpoint (unverified)']) assert.ok(source.includes(copy), `missing focused-detail copy: ${copy}`)
})

test('runtime task workflow never invents indeterminate or numeric completion progress', async () => {
  const source = await clientSource()
  const workflow = componentSource(source, ['TaskWorkflow'])
  const focus = componentSource(source, ['TaskDetailFocus'])

  assert.doesNotMatch(`${workflow}\n${focus}`, /randomTaskProgressPulse|progressPercent|\.percent\b|aria-valuenow|role: "progressbar"|\+ "%"/u)
  assert.match(source, /boardMilestones: "成员计划里程碑（未验证） \{completed\}\/\{total\}"/u)
  assert.match(source, /boardFactLegend: "事实来源：任务状态、依赖、尝试次数、权限\/副作用结论与时间来自 Host 权威投影；成员 Todo 里程碑、checkpoint 和提交结果均明确标为未验证。"/u)
  assert.match(source, /prefers-reduced-motion:reduce/u)
})

test('task columns queue without stretching the page before entering task focus', async () => {
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

  assert.match(sort, /pendingQueue = columnId === "ready"/u)
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
  ], 'done').map((task) => task.id), ['newer', 'older'])
})

test('runtime task board exposes four truthful columns and keeps cancellation in history without model percentages', async () => {
  const source = await clientSource()
  const card = componentSource(source, ['BoardTaskCard'])
  const board = componentSource(source, ['TaskBoardWorkspace'])
  assert.match(board, /\{ id: "ready", label: t\("boardPending"\)/u)
  assert.match(board, /\{ id: "running", label: t\("boardProgress"\)/u)
  assert.match(board, /\{ id: "attention", label: t\("boardBlocked"\)/u)
  assert.match(board, /\{ id: "done", label: t\("boardCompleted"\)/u)
  assert.match(board, /cancelledTasks[\s\S]*?h\("details", \{ className: "dat-board-history" \}/u)
  assert.match(card, /boardAttempt/u)
  assert.match(card, /boardMilestones/u)
  assert.match(card, /boardCheckpoint/u)
  assert.match(card, /lastActivity/u)
  assert.doesNotMatch(`${card}\n${board}`, /progressPercent|\.percent\b|aria-valuenow|role: "progressbar"|\+ "%"/u)
})

test('task board surfaces the durable plan lifecycle, authorization preflight, and safe handoff state', async () => {
  const source = await clientSource()
  const lifecycle = componentSource(source, ['PlanLifecyclePanel'])
  const authorizationLabel = componentSource(source, ['planAuthorizationLabel'])
  const board = componentSource(source, ['TaskBoardWorkspace'])

  assert.match(board, /h\(PlanLifecyclePanel, \{ t: t, team: team \}\)/u)
  assert.match(lifecycle, /phaseOrder = \["draft", "committed", "active"\]/u)
  assert.match(lifecycle, /plan\.committedAt[\s\S]*?plan\.activatedAt/u)
  assert.match(lifecycle, /authorization\.permissions[\s\S]*?authorization\.files[\s\S]*?authorization\.cost[\s\S]*?authorization\.externalSideEffects/u)
  assert.match(authorizationLabel, /planAuthHostVerified[\s\S]*?planAuthHumanAttested[\s\S]*?planAuthUnknown/u)
  assert.match(lifecycle, /team\.handoff[\s\S]*?team\.ownershipHistory[\s\S]*?ownershipHistoryTruncated/u)
  assert.match(lifecycle, /plan\.migrationState === "legacy_unplanned"[\s\S]*?plan\.migrationState === "legacy_active_gate"/u)
  assert.doesNotMatch(lifecycle, /targetRootSessionId|sourceRootSessionId|tokenHash|confirmedPlanHash|plan\.hash/u)

  assert.match(source, /planLifecycleTitle: "计划生命周期"[\s\S]*?planLifecycleTitle: "Plan lifecycle"/u)
  assert.match(source, /\.dat-plan-steps\{[^}]*grid-template-columns:repeat\(3/u)
  assert.match(source, /@media\(max-width:620px\)\{[\s\S]*?\.dat-plan-lifecycle-head\{display:block\}[\s\S]*?\.dat-plan-steps,\.dat-preflight-grid\{grid-template-columns:1fr\}/u)
  assert.match(source, /\.dat-handoff-history>summary\{[^}]*min-height:44px[^}]*\}[\s\S]*?\.dat-handoff-history>summary:focus-visible/u)
  assert.match(source, /planAuthorizationHumanAttestedHint: "启用自动团队后[^\n]*不是 Host 验证证明。"/u)
  assert.ok(source.includes('planAuthHumanAttested: "自动驾驶默认授权"'))
  assert.ok(source.includes('planAuthHumanAttested: "Autopilot default authorization"'))
  assert.ok(!source.includes('用户已确认（未获 Host 证明）'))
})

test('runtime CSS gives keyboard buttons a visible ring and mobile controls full touch targets', async () => {
  const source = await clientSource()
  assert.match(source, /\.dat-btn:focus,\.dat-btn:focus-visible\{outline:3px solid #2f7cf6;outline-offset:2px;box-shadow:0 0 0 4px rgba\(47,124,246,\.28\)\}/u)
  assert.match(source, /@media\(max-width:620px\)\{\.dat-workspace-nav\{[^}]*\}\.dat-btn\{[^}]*min-height:44px[^}]*max-width:100%[^}]*overflow-wrap:anywhere[^}]*\}\.dat-workspace-nav button\{[^}]*min-height:44px[^}]*max-width:calc\(100vw - 28px\)/u)

  const injectStylesSource = componentSource(source, ['injectStyles'])
  const elements = new Map()
  const document = {
    getElementById(id) { return elements.get(id) || null },
    createElement() { return { id: '', textContent: '' } },
    head: { appendChild(node) { elements.set(node.id, node) } }
  }
  const css = Function('document', `${injectStylesSource}\ninjectStyles(); return document.getElementById("dsh-agent-teams-client-style").textContent;`)(document)
  const focusRule = css.match(/\.dat-btn:focus,\.dat-btn:focus-visible\{([^}]*)\}/u)
  assert.ok(focusRule, 'runtime stylesheet must include the activeElement focus fallback and focus-visible selector')
  assert.match(focusRule[1], /outline:3px solid #[0-9a-f]{6}/iu)
  assert.match(focusRule[1], /box-shadow:0 0 0 4px rgba\([^)]*,\.28\)/u)
  assert.doesNotMatch(focusRule[1], /transparent|outline:none|outline:0/u)
  const buttonRules = [...css.matchAll(/\.dat-btn\{([^}]*)\}/gu)].map(match => match[1])
  assert.ok(buttonRules.some(rule => /min-height:44px/u.test(rule)), 'runtime mobile button rule must guarantee 44px height')
  const navRules = [...css.matchAll(/\.dat-workspace-nav button\{([^}]*)\}/gu)].map(match => match[1])
  assert.ok(navRules.some(rule => /min-height:44px/u.test(rule) && /max-width:calc\(100vw - 28px\)/u.test(rule)), 'runtime mobile navigation must stay tappable without escaping the viewport')
})

test('plan preflight renders safe defaults without warning styling and keeps mixed risk in Attention', async () => {
  const source = await clientSource()
  const label = componentSource(source, ['planAuthorizationLabel'])
  const tone = componentSource(source, ['planAuthorizationTone'])
  const lifecycle = componentSource(source, ['PlanLifecyclePanel'])
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(value => value !== null && value !== undefined && value !== false) })
  const runtime = Function('h', 'formatTime', `${label}\n${tone}\n${lifecycle}\nreturn { PlanLifecyclePanel, planAuthorizationTone };`)(h, value => String(value))
  const copy = {
    planLifecycleTitle: 'Plan lifecycle', planLifecycleHint: 'Durable facts', planDraft: 'Draft', planCommitted: 'Committed', planActive: 'Active', planRevision: 'Revision {value}', planPauseEpoch: 'Pause {value}',
    planAuthorization: 'Plan preflight', planAuthorizationSource: 'Authorization basis: {value}', planAuthorizationHumanAttestedHint: 'Default authorization is not Host-verified proof.',
    planAuthHostVerified: 'Host verified', planAuthHumanAttested: 'Autopilot default authorization', planAuthUnknown: 'Attention · not verified',
    planPreflightPermissions: 'Permissions', planPreflightFiles: 'File boundaries', planPreflightCost: 'Model cost', planPreflightEffects: 'External side effects', handoffTitle: 'Lead handoff', handoffNone: 'No handoff'
  }
  const t = (key, values = {}) => String(copy[key] || key).replace(/\{(\w+)\}/gu, (_, name) => String(values[name]))
  const walk = (node, visit) => {
    if (!node || typeof node !== 'object') return
    visit(node)
    for (const child of node.children || []) walk(child, visit)
  }
  const chips = tree => {
    const found = []
    walk(tree, node => { if (node.props?.className === 'dat-status-chip') found.push(node) })
    return found
  }
  const text = node => (node.children || []).filter(value => typeof value === 'string').join(' ')
  const safeAuthorization = { source: 'human_attested', permissions: 'human_attested', files: 'human_attested', cost: 'human_attested', externalSideEffects: 'human_attested' }
  const safeTree = runtime.PlanLifecyclePanel({ t, team: { pauseEpoch: 0, plan: { phase: 'active', authorization: safeAuthorization } } })
  const safeChips = chips(safeTree)
  assert.equal(safeChips.length, 4)
  assert.deepEqual(safeChips.map(node => node.props['data-status']), ['autopilot', 'autopilot', 'autopilot', 'autopilot'])
  assert.ok(safeChips.every(node => text(node) === 'Autopilot default authorization'))
  assert.ok(safeChips.every(node => node.props.role === 'status' && /: Autopilot default authorization$/u.test(node.props['aria-label'])))

  const mixedAuthorization = { source: 'human_attested', permissions: 'unknown', files: 'forbidden', cost: 'host_verified', externalSideEffects: 'confirm_each' }
  const mixedTree = runtime.PlanLifecyclePanel({ t, team: { pauseEpoch: 0, plan: { phase: 'draft', authorization: mixedAuthorization } } })
  const mixedChips = chips(mixedTree)
  assert.deepEqual(mixedChips.map(node => node.props['data-status']), ['attention', 'attention', 'host_verified', 'attention'])
  assert.equal(text(mixedChips[2]), 'Host verified')
  assert.ok([mixedChips[0], mixedChips[1], mixedChips[3]].every(node => text(node) === 'Attention · not verified'))
  assert.ok([mixedChips[0], mixedChips[1], mixedChips[3]].every(node => !/Host verified/u.test(node.props['aria-label'])))
  assert.deepEqual(['unknown', 'unavailable', 'forbidden', 'confirm_each', 'outcome_unknown'].map(runtime.planAuthorizationTone), ['attention', 'attention', 'attention', 'attention', 'attention'])
})

test('task details expose lease attempts, bounded interruption history, capability checks, and effect fences without claim credentials', async () => {
  const source = await clientSource()
  const card = componentSource(source, ['BoardTaskCard'])
  const assurance = componentSource(source, ['TaskAssurancePanel'])
  const focus = componentSource(source, ['TaskDetailFocus'])
  const sidebar = componentSource(source, ['TaskDetailSidebar'])

  assert.match(card, /taskBoardLeaseEpoch[\s\S]*?boardLeaseEpoch/u)
  assert.match(card, /taskBoardCapabilitySummary[\s\S]*?boardCapabilities/u)
  assert.match(focus, /h\(TaskAssurancePanel, \{ t: t, task: task \}\)/u)
  assert.match(sidebar, /h\(TaskAssurancePanel, \{ t: t, task: task \}\)/u)
  assert.match(assurance, /task\.attemptHistory[\s\S]*?task\.interruptionHistory/u)
  assert.match(assurance, /history\.slice\(0, 12\)/u)
  assert.match(assurance, /task\.capabilities[\s\S]*?task\.externalEffects/u)
  assert.match(assurance, /task\.checkpoint[\s\S]*?task\.nextStep[\s\S]*?taskMemberReports/u)
  assert.match(assurance, /data-status[\s\S]*?taskCapabilityLabel[\s\S]*?taskEffectOutcomeLabel/u)
  assert.doesNotMatch(assurance, /claimId|assigneeSessionId|sourceRootSessionId|targetRootSessionId|entry\.reason/u)

  assert.match(source, /boardLeaseEpoch: "租约代次 \{value\}"[\s\S]*?boardLeaseEpoch: "Lease epoch \{value\}"/u)
  assert.match(source, /\.dat-assurance-grid\{[^}]*grid-template-columns:repeat\(2/u)
  assert.match(source, /@media\(max-width:760px\)\{\.dat-plan-grid,\.dat-assurance-grid\{grid-template-columns:1fr\}/u)
})

test('runtime task board derives Attention from permission unknown and uncertain external effects', async () => {
  const source = await clientSource()
  const start = source.indexOf('    function taskBoardColumn(')
  const end = source.indexOf('    function taskBoardNextKey(', start)
  assert.ok(start >= 0 && end > start)
  const helpers = Function(
    'normalizeState',
    'relationIds',
    `${source.slice(start, end)}\nreturn { taskBoardColumn, taskBoardAttentionFacts };`
  )(
    value => String(value || '').toLowerCase(),
    value => Array.isArray(value) ? value : []
  )
  const permissionUnknown = { state: 'pending', capabilities: [{ name: 'desktop-control', status: 'unknown', source: 'not provable' }] }
  const uncertainEffect = { state: 'pending', externalEffects: [{ name: 'external-ui', policy: 'confirm_each', outcome: 'outcome_unknown' }] }
  assert.equal(helpers.taskBoardColumn(permissionUnknown), 'attention')
  assert.equal(helpers.taskBoardColumn(uncertainEffect), 'attention')
  const t = key => key
  assert.ok(helpers.taskBoardAttentionFacts(t, permissionUnknown).some(value => /permission/i.test(value)))
  assert.ok(helpers.taskBoardAttentionFacts(t, uncertainEffect).some(value => /effect/i.test(value)))
})

test('Project Automation uses redacted state, explicit allowed actions, and refetch-only SSE', async () => {
  const source = await clientSource()
  const projection = componentSource(source, ['normalizeProjectAutomationsState'])
  const action = componentSource(source, ['postProjectAutomationAction'])
  const command = componentSource(source, ['projectAutomationActionBody'])
  const hook = componentSource(source, ['useProjectAutomationsState'])
  const panel = componentSource(source, ['ProjectAutomationPanel'])
  const normalize = Function(`${projection}\nreturn normalizeProjectAutomationsState`)()
  const build = Function(`${command}\nreturn projectAutomationActionBody`)()

  const state = normalize({ capability: { available: true, writable: true, canCreate: true, kind: 'authority', reason: '' }, definitions: [{ definitionRef: 'definition_safe', revision: 2, status: 'enabled', name: 'Ship', taskRef: 'task_safe', taskTitle: 'Release', targetStatus: 'in_progress', allowedActions: ['disable', 'run', 'forged'] }], taskChoices: [{ taskRef: 'task_safe', title: 'Release', revision: 7, allowedTargets: ['in_progress', 'done'] }], runs: [{ runRef: 'run_safe', definitionRef: 'definition_safe', definitionName: 'Ship', revision: 3, status: 'awaiting_approval', createdAt: '2026-01-01T00:00:00Z', allowedActions: ['approve', 'reject'], actorRef: 'hidden' }], recentLedger: [{ occurredAt: '2026-01-01T00:00:00Z', type: 'run.triggered', runRef: 'run_safe', definitionName: 'Ship', status: 'awaiting_approval', actorRef: 'hidden', commandId: 'hidden' }] })
  assert.deepEqual(state.definitions[0].allowedActions, ['disable', 'run'])
  assert.deepEqual(state.taskChoices[0].allowedTargets, ['in_progress'])
  const collaboratorAutomation = normalize({ capability: { mode: 'collaborator', available: true, writable: true, automationCommands: ['approve', 'reject', 'forged'], deviceRef: 'hidden-device' }, definitions: [{ definitionRef: 'definition_remote', revision: 1, status: 'enabled', name: '<svg onload=hidden()>', taskRef: 'task_remote', taskTitle: 'Safe title', allowedActions: ['run'] }], runs: [{ runRef: 'run_remote', definitionRef: 'definition_remote', definitionName: '<b>Review</b>', revision: 4, status: 'awaiting_approval', createdAt: '2026-01-01T00:00:00Z', allowedActions: ['approve', 'reject', 'cancel'], actorRef: 'hidden-actor' }, { runRef: 'run_running', definitionRef: 'definition_remote', definitionName: 'Running', revision: 2, status: 'running', createdAt: '2026-01-01T00:00:00Z', allowedActions: ['approve'] }], recentLedger: [{ type: 'raw.secret', actorRef: 'hidden-ledger' }] })
  assert.deepEqual(collaboratorAutomation.capability, { available: true, writable: true, canCreate: false, kind: 'collaborator', reason: '', automationCommands: ['approve', 'reject'] })
  assert.deepEqual(collaboratorAutomation.definitions[0].allowedActions, [])
  assert.deepEqual(collaboratorAutomation.runs[0].allowedActions, ['approve', 'reject'])
  assert.deepEqual(collaboratorAutomation.runs[1].allowedActions, [])
  const collaboratorAutomationTextContent = [...collaboratorAutomation.definitions.map((item) => item.name), ...collaboratorAutomation.runs.map((item) => item.definitionName)].join(' ')
  assert.ok(collaboratorAutomationTextContent.includes('<svg onload=hidden()>') && collaboratorAutomationTextContent.includes('<b>Review</b>'), 'labels are rendered as inert text content')
  assert.equal(collaboratorAutomationTextContent.includes('hidden-device'), false)
  assert.equal(JSON.stringify(collaboratorAutomation).includes('hidden-device'), false)
  assert.equal(JSON.stringify(collaboratorAutomation).includes('hidden-actor'), false)
  assert.equal(JSON.stringify(collaboratorAutomation).includes('hidden-ledger'), false)
  const offlineAutomation = normalize({ capability: { mode: 'collaborator', available: false, writable: true, automationCommands: ['approve'] }, runs: [{ runRef: 'cached_run', definitionRef: 'cached_definition', definitionName: 'Cached safely', revision: 1, status: 'awaiting_approval', allowedActions: ['approve'] }] })
  assert.equal(offlineAutomation.capability.writable, false)
  assert.equal(offlineAutomation.runs[0].definitionName, 'Cached safely')
  assert.deepEqual(offlineAutomation.runs[0].allowedActions, [])
  assert.deepEqual(normalize({ capability: { available: false, writable: true, canCreate: true, kind: 'no-project', reason: 'create project' } }).capability, { available: false, writable: false, canCreate: false, kind: 'no-project', reason: 'create project', automationCommands: [] })
  assert.deepEqual(state.runs[0].allowedActions, ['approve', 'reject'])
  assert.equal(JSON.stringify(state).includes('actorRef'), false)
  assert.equal(JSON.stringify(state).includes('commandId'), false)
  assert.equal(JSON.stringify(state).includes('effectKey'), false)

  assert.deepEqual(build('cmd_create', 'definition.create', undefined, undefined, 0, { name: 'Ship' }), { commandId: 'cmd_create', type: 'definition.create', expectedRevision: 0, payload: { name: 'Ship' } })
  assert.deepEqual(build('cmd_run', 'manual_run', 'definition_safe', undefined, 2, { taskRevision: 7 }), { commandId: 'cmd_run', type: 'manual_run', definitionRef: 'definition_safe', expectedRevision: 2, payload: { taskRevision: 7 } })
  assert.deepEqual(build('cmd_disable', 'definition.update', 'definition_safe', undefined, 2, { status: 'disabled' }), { commandId: 'cmd_disable', type: 'definition.update', definitionRef: 'definition_safe', expectedRevision: 2, payload: { status: 'disabled' } })
  assert.deepEqual(build('cmd_approve', 'approve', undefined, 'run_safe', 3, {}), { commandId: 'cmd_approve', type: 'approve', runRef: 'run_safe', expectedRevision: 3, payload: {} })
  assert.deepEqual(build('cmd_retry_action', 'retry', undefined, 'run_safe', 3, {}), { commandId: 'cmd_retry_action', type: 'retry', runRef: 'run_safe', expectedRevision: 3, payload: {} })
  assert.deepEqual(build('cmd_cancel_action', 'cancel', undefined, 'run_safe', 3, {}), { commandId: 'cmd_cancel_action', type: 'cancel', runRef: 'run_safe', expectedRevision: 3, payload: {} })

  assert.match(hook, /fetch\("\/api\/agent-teams\/project\/automations\/state"/u)
  assert.match(hook, /new EventSource\("\/api\/agent-teams\/project\/automations\/stream"\)/u)
  for (const name of ['reset', 'capability', 'automation', 'definition', 'run', 'ledger']) assert.match(hook, new RegExp(`addEventListener\\("${name}", refetch\\)`, 'u'))
  assert.match(hook, /source\.close\(\)/u)
  assert.doesNotMatch(hook, /JSON\.parse\(event\.data\)/u)
  assert.match(action, /fetch\("\/api\/agent-teams\/project\/automations\/action"/u)
  assert.match(action, /var encoded = JSON\.stringify\(body\)/u)
  assert.match(action, /if \(error && error\.status\) throw error;[\s\S]*return request\(\)/u)
  assert.match(panel, /allowedActions/u)
  assert.match(panel, /type = action === "run" \? "manual_run" : "definition\.update"/u)
  assert.match(panel, /payload = action === "run" \? \{ taskRevision: choice\.revision \} : \{ status: action === "enable" \? "enabled" : "disabled" \}/u)
  assert.match(panel, /"definition\.create"/u)
  assert.match(panel, /canWrite = capability && capability\.writable === true && \(kind === "authority" \|\| collaborator\) && capability\.available === true/u)
  assert.match(panel, /collaborator && \(item\.status !== "awaiting_approval" \|\| capability\.automationCommands\.indexOf\(action\) < 0 \|\| \["approve", "reject"\]\.indexOf\(action\) < 0\)/u)
  assert.match(panel, /projectAutomationPendingReceipt/u)
  assert.match(panel, /collaborator \? null : h\(React\.Fragment[\s\S]*projectAutomationLedger/u)
  const originalFetch = global.fetch
  const originalParser = global.projectTaskResponseError
  const bodies = []
  let requests = 0
  global.fetch = async (_url, init) => { bodies.push(init.body); requests += 1; if (requests === 1) throw new TypeError('network'); return { ok: true, json: async () => ({ ok: true }) } }
  global.projectTaskResponseError = (response, input) => Object.assign(new Error(input.error.message), input.error, { status: response.status })
  try {
    const post = Function(`${action}\nreturn postProjectAutomationAction`)()
    await post(build('cmd_retry', 'cancel', undefined, 'run_safe', 3, {}))
    assert.equal(requests, 2)
    assert.equal(bodies[0], bodies[1])
    requests = 0
    global.fetch = async () => { requests += 1; return { ok: false, status: 409, json: async () => ({ ok: false, error: { code: 'AUTOMATION_REVISION_CONFLICT', message: 'stale', nextAction: 'refresh', retryable: false } }) } }
    await assert.rejects(() => post(build('cmd_occ', 'approve', undefined, 'run_safe', 3, {})), (error) => error.code === 'AUTOMATION_REVISION_CONFLICT' && error.nextAction === 'refresh')
    assert.equal(requests, 1)
  } finally { global.fetch = originalFetch; global.projectTaskResponseError = originalParser }
  assert.match(panel, /projectAutomationApprovalBoundary/u)
  assert.match(panel, /projectAutomationNoProject[\s\S]*setWorkspaceView\("participants"\)/u)
  assert.doesNotMatch(panel, /inputActions|setDraft|submit\(\)|send\(|desktop-schedules|projectRef|actorRef|commandId|effectKey|taskCommandId|prompt/u)
})

test('automation embeds the existing session-local reminder projection without creating a second scheduler', async () => {
  const source = await clientSource()
  const automation = componentSource(source, ['AutomationWorkspace', 'AutomationView'])

  assert.equal((source.match(/\/api\/desktop-schedules\/state/gu) || []).length, 1)
  assert.match(automation, /\/api\/desktop-schedules\/state\?sessionId=/u)
  assert.match(automation, /encodeURIComponent\(props\.sessionId\)/u)
  assert.match(automation, /method: "GET"/u)
  assert.doesNotMatch(automation, /method: "POST"|postAction\(|\/api\/desktop-schedules\/(?:action|create|update|delete)/u)

  assert.match(source, /sessionScheduleScope: "仅当前会话"/u)
  assert.match(source, /sessionScheduleScope: "This session only"/u)
  assert.match(source, /原会话在线时触发；错过的提醒会在恢复会话后补发/u)
  assert.match(source, /Runs only while the original session is live\. Missed reminders are delivered after it resumes/u)
  assert.match(source, /projectAutomationSeparate: "项目自动化使用独立项目存储/u)
  assert.match(automation, /h\(ProjectAutomationPanel, \{ t: t, setWorkspaceView: props\.setWorkspaceView \}\)/u)
  assert.doesNotMatch(automation, /t\("notAvailableYet"\)|t\("projectAutomationPending"\)/u)
  assert.doesNotMatch(source, /"planned"/u)
})

test('M5 foundation card consumes only the fixed safe state and gives authority or collaborator next steps', async () => {
  const source = await clientSource()
  const projection = componentSource(source, ['normalizeProjectFoundationsState'])
  const statusSource = componentSource(source, ['projectFoundationStatus'])
  const hook = componentSource(source, ['useProjectFoundationsState'])
  const card = componentSource(source, ['ProjectFoundationStatusCard'])
  const normalize = Function(`${projection}\nreturn normalizeProjectFoundationsState`)()
  const status = Function(`${statusSource}\nreturn projectFoundationStatus`)()
  const safe = normalize({ ok: true, mode: 'authority', available: true, ready: true, sourceStatus: 'ready', workspaceCount: 2, claimCount: 3, queuedChangeSetCount: 4, campaignCount: 5, queuedJobCount: 6, runningJobCount: 7, defectCount: 8, outboxPendingCount: 9, attention: ['runner_unavailable', 'forged-secret', 'runner_unavailable'], commit: 'hidden', digest: 'hidden', path: 'hidden', runnerKey: 'hidden', evidence: 'hidden', credential: 'hidden' })
  assert.deepEqual(Object.keys(safe), ['ok', 'mode', 'available', 'ready', 'sourceStatus', 'workspaceCount', 'claimCount', 'queuedChangeSetCount', 'campaignCount', 'queuedJobCount', 'runningJobCount', 'defectCount', 'outboxPendingCount', 'attention'])
  assert.deepEqual(safe.attention, ['runner_unavailable'])
  assert.equal(JSON.stringify(safe).includes('hidden'), false)
  assert.equal(status(normalize({ mode: 'collaborator', available: true, sourceStatus: 'authority_managed' })), 'collaborator')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'source_invalid' })), 'invalid')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'source_dirty' })), 'dirty')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', attention: ['merge_conflict', 'connector_disabled'] })), 'conflict')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', queuedChangeSetCount: 1 })), 'merge')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', attention: ['runner_unavailable'] })), 'quality-waiting')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', queuedJobCount: 1 })), 'quality-running')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', defectCount: 1 })), 'defect')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', outboxPendingCount: 1 })), 'outbox')
  assert.equal(status(normalize({ mode: 'authority', available: true, sourceStatus: 'ready', attention: ['connector_disabled'] })), 'connector')
  assert.equal(status(normalize({ mode: 'authority', available: true, ready: true, sourceStatus: 'ready' })), 'ready')
  assert.match(hook, /fetch\("\/api\/agent-teams\/project\/foundations\/state", \{ method: "GET", cache: "no-store", credentials: "same-origin"/u)
  assert.doesNotMatch(hook, /\?projectRef|URLSearchParams|method: "POST"/u)
  assert.match(card, /state && state\.mode === "authority" \? h\(Button/u)
  assert.match(card, /foundationCollaboratorBody/u)
  assert.doesNotMatch(card, /state\.(?:commit|digest|ref|path|actor|runnerKey|evidence|credential)/u)
})

test('failed root recovery UI is permission-projected, confirm-first, bounded, and accessible', async () => {
  const source=await clientSource(),normalize=componentSource(source,['normalizeProjectCollaboration']),workspace=componentSource(source,['ProjectCollaborationWorkspace'])
  assert.match(normalize,/recoveries: lists\.recoveries/u)
  assert.match(normalize,/sectionPages: Object\.freeze\(sectionPages\)/u)
  assert.match(workspace,/item\.canRetry===true/u); assert.match(workspace,/item\.canRequestTakeover===true/u)
  assert.match(workspace,/rootRecoveryState\.confirm!==key/u); assert.match(workspace,/aria-busy/u); assert.match(workspace,/role:"alert","aria-live":"assertive"/u)
  assert.match(workspace,/success:key[\s\S]*setTimeout/u); assert.match(workspace,/role:"status","aria-live":"polite"/u)
  assert.match(source,/root-recovery-continue[\s\S]*recoveryRef:recovery\.recoveryRef[\s\S]*expectedRevision:recovery\.revision[\s\S]*confirm:true/u)
  assert.doesNotMatch(source,/function recoverProjectRoot[\s\S]{0,500}setDraft/u)
  assert.match(workspace,/minHeight:44,minWidth:44/u); assert.match(workspace,/"aria-describedby":"dat-collaboration-recovery-help"/u)
  assert.match(source,/未知结果不会自动重试、唤醒或接管/u); assert.match(source,/unknown outcomes never retry, wake, or take over automatically/u)
  assert.match(source,/再次点击将直接提交已确认的精确恢复操作/u); assert.match(source,/directly submit the confirmed exact recovery action/u)
})

test('the one cross-session task surface and coordination pages explain capability boundaries without duplicate labels', async () => {
  const source = await clientSource()
  const navigation = componentSource(source, ['WorkspaceNav'])
  assert.match(source, /workspaceFlow: "跨会话任务"/u)
  assert.match(source, /workspaceFlow: "Cross-session tasks"/u)
  assert.equal((navigation.match(/label: t\("workspaceFlow"\)/gu) || []).length, 1)
  assert.doesNotMatch(navigation, /id: "projectTasks"|workspaceProjectTasks/u)
  assert.doesNotMatch(source, /workspaceProjectTasks: "同项目·跨会话任务"|workspaceProjectTasks: "Same-project · cross-session tasks"/u)
  assert.match(source, /projectTeamBoardReadOnly: "项目聚合 · 常规只读"/u)
  assert.match(source, /projectTeamBoardBoundary: "看板常规只读；唯一窄写入口/u)
  assert.match(source, /workspaceInbox: "协调记录"/u)
  assert.match(source, /消息正文请到对应成员对话查看/u)
  assert.match(source, /open the corresponding member conversation to read it/u)
  assert.doesNotMatch(source, /flowReadOnly|flowGoalBody|flowTasks/u)
  assert.doesNotMatch(source, /inboxIntro: "[^"]*(?:安全投影|safe projection|元数据|metadata)/iu)
})

test('workbench navigation stays as a sticky horizontal bar at every width', async () => {
  const source = await clientSource()

  assert.match(source, /\.dat-workspace\{[^}]*container-type:inline-size/u)
  assert.match(source, /@container(?:\s+[\w-]+)?\s*\(max-width:/u)
  assert.match(source, /\.dat-workspace-nav\{[^}]*position:sticky;top:0;[^}]*display:flex;[^}]*width:100%;[^}]*overflow-x:auto/u)
  assert.match(source, /\.dat-workspace-nav button\{[^}]*flex:1 0 auto;[^}]*white-space:nowrap/u)
  assert.match(source, /@media\(max-width:[^)]+\)\{[^}]*\.dat-workspace-nav/u)
  assert.doesNotMatch(source, /\.dat-workbench\{[^}]*grid-template-columns:172px/u)
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
