const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const vm = require('node:vm')
const { readFile } = require('node:fs/promises')

const clientFile = path.resolve(__dirname, '..', 'plugins/dsh-agent-teams/lib/client.js')

// Execute the complete client module, not extracted regex assertions. This small
// initial-render adapter preserves native tag/props/children and event callbacks.
// It is NOT React DOM, browser layout, focus, or an installed-GUI validation.
async function clientFixture(language = 'en') {
  const source = await readFile(clientFile, 'utf8')
  const marker = '    exports.apply = apply;'
  assert.equal(source.split(marker).length, 2, 'one explicit test-only export seam')
  const instrumented = source.replace(marker, '    exports.productTest = { BoardTaskCard, TaskBoardWorkspace, ParticipantsWorkspace, taskBoardColumn, zh, en };\n' + marker)
  const effects = [], updates = [], fetches = []
  const React = {
    createElement(type, props, ...children) {
      const resolved = { ...(props || {}), children: children.flat(Infinity).filter(child => child !== null && child !== undefined && child !== false) }
      return typeof type === 'function' ? type(resolved) : { type, props: resolved, children: resolved.children }
    },
    useState(initial) { return [typeof initial === 'function' ? initial() : initial, value => updates.push(value)] },
    useRef(value) { return { current: value } },
    useEffect(effect) { effects.push(effect) },
    startTransition(work) { work() }
  }
  let result
  const window = { __ModuleLoader__: { load(definition) { result = definition.factory(name => { assert.equal(name, 'react'); return React }) } } }
  const document = { addEventListener() {}, removeEventListener() {} }
  vm.runInNewContext(instrumented, { window, document, console, URL, URLSearchParams, setTimeout, clearTimeout, fetch(...args) { fetches.push(args); throw new Error('unexpected initial-render network') } }, { filename: clientFile })
  const api = result.productTest
  const t = (key, values = {}) => String(api[language][key] || key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? `{${name}}`))
  return { api, t, effects, updates, fetches }
}

function walk(node, predicate, options = {}) {
  if (node == null || typeof node !== 'object') return []
  if (options.visible && (node.props?.hidden || node.props?.['aria-hidden'] === true || node.props?.['aria-hidden'] === 'true')) return []
  const children = options.visible && node.type === 'details' && !node.props.open ? (node.children || []).filter(child => child?.type === 'summary') : node.children || []
  return [...(predicate(node) ? [node] : []), ...children.flatMap(child => walk(child, predicate, options))]
}
function text(node, visible = false) {
  if (node == null || node === false) return ''
  if (typeof node !== 'object') return String(node)
  if (visible && (node.props?.hidden || node.props?.['aria-hidden'] === true || node.props?.['aria-hidden'] === 'true')) return ''
  const children = visible && node.type === 'details' && !node.props.open ? (node.children || []).filter(child => child?.type === 'summary') : node.children || []
  return children.map(child => text(child, visible)).join(' ')
}
function teamFixture(tasks = []) {
  return { id: 'team-fixture', name: 'Product work', objective: 'Deliver useful results', state: 'active', revision: 7, pauseEpoch: 0, leadSessionId: 'lead-fixture', tasks, events: [], members: [{ id: 'lead-member', sessionId: 'lead-fixture', name: '负责人', kind: 'lead', state: 'running' }, { id: 'worker-member', sessionId: 'worker-fixture', name: '测试', role: 'ui-ux-pro-max', kind: 'worker', state: 'running' }] }
}
function renderBoard(fx, tasks, extra = {}) {
  const team = teamFixture(tasks)
  return fx.api.TaskBoardWorkspace({ t: fx.t, team, teams: [team], sessionId: 'lead-fixture', setWorkspaceView() {}, connection: 'live', ...extra })
}

test('initial component render keeps cancelled work inside closed history', async () => {
  const fx = await clientFixture()
  const tree = renderBoard(fx, [{ id: 'cancelled-item', title: 'CANCELLED PRIVATE HISTORY TITLE', state: 'cancelled' }, { id: 'active-item', title: 'CURRENT WORK TITLE', state: 'in_progress', assigneeSessionId: 'worker-fixture' }])
  assert.ok(text(tree).includes('CANCELLED PRIVATE HISTORY TITLE'), 'history stays discoverable')
  assert.ok(!text(tree, true).includes('CANCELLED PRIVATE HISTORY TITLE'), 'closed history is not initially visible')
  assert.ok(text(tree).includes('CURRENT WORK TITLE'), 'current work remains available in work details')
  assert.equal(fx.fetches.length, 0)
})

test('task card is a named native button and click opens only the exact fixture task', async () => {
  const fx = await clientFixture('zh')
  const task = { id: 'safe-task', title: '<img src=x onerror=attack()>', state: 'in_progress' }
  let opened
  const card = fx.api.BoardTaskCard({ task, t: fx.t, members: [], onOpen(event, selected) { opened = { event, selected } } })
  assert.equal(card.type, 'button')
  assert.equal(card.props.type, 'button')
  assert.ok(card.props['aria-label'].includes(task.title))
  assert.equal(walk(card, node => node.type === 'img').length, 0, 'label remains text, not injected markup')
  const event = { currentTarget: card }
  card.props.onClick(event)
  assert.equal(opened.selected, task)
  assert.equal(opened.event, event)
  assert.equal(task.state, 'in_progress', 'UI callback never mutates authoritative task state')
  assert.equal(fx.fetches.length, 0)
})

test('unknown external result is shown in Attention rather than a ready success', async () => {
  const fx = await clientFixture()
  const task = { id: 'uncertain', title: 'Check uncertain outcome', state: 'in_progress', externalEffects: [{ name: 'upload', policy: 'idempotent', outcome: 'outcome_unknown' }] }
  assert.equal(fx.api.taskBoardColumn(task), 'attention')
  const tree = renderBoard(fx, [task])
  const attention = walk(tree, node => node.props?.['data-column'] === 'attention')[0]
  assert.ok(attention)
  assert.ok(text(attention, true).includes(task.title))
  assert.match(text(attention, true), /unknown|uncertain|review|confirm/i)
})

test('submitted card says review rather than waiting to be claimed in both locales', async () => {
  for (const language of ['zh', 'en']) {
    const fx = await clientFixture(language)
    const task = { id: 'submitted', title: 'Submitted result', state: 'submitted', assigneeSessionId: 'worker-fixture' }
    assert.notEqual(fx.api.taskBoardColumn(task), 'ready')
    const tree = fx.api.BoardTaskCard({ task, members: [], t: fx.t, onOpen() {} })
    assert.match(text(tree), /验收|review|acceptance/i)
    assert.doesNotMatch(text(tree), /等待成员认领|\bwaiting for (?:a member to )?claim/i)
  }
})

test('participants choose current work, never an earlier completed or cancelled assignment', async () => {
  const fx = await clientFixture()
  const tasks = [
    { id: 'done-first', title: 'OLD COMPLETED TITLE', state: 'completed', assigneeSessionId: 'worker-fixture' },
    { id: 'cancelled-second', title: 'OLD CANCELLED TITLE', state: 'cancelled', assigneeSessionId: 'worker-fixture' },
    { id: 'current-third', title: 'REAL CURRENT TITLE', state: 'in_progress', assigneeSessionId: 'worker-fixture' }
  ]
  const tree = fx.api.ParticipantsWorkspace({ t: fx.t, team: teamFixture(tasks) })
  assert.ok(text(tree).includes('REAL CURRENT TITLE'))
  assert.ok(!text(tree).includes('OLD COMPLETED TITLE'))
  assert.ok(!text(tree).includes('OLD CANCELLED TITLE'))
  const terminalOnly = fx.api.ParticipantsWorkspace({ t: fx.t, team: teamFixture(tasks.slice(0, 2)) })
  assert.ok(!text(terminalOnly).includes('OLD COMPLETED TITLE'))
  assert.ok(!text(terminalOnly).includes('OLD CANCELLED TITLE'))
})

test('normal board hides diagnostic metadata but retains a discoverable closed disclosure', async () => {
  const fx = await clientFixture()
  const tree = renderBoard(fx, [{ id: 'normal', title: 'Work', state: 'in_progress', leaseEpoch: 89, checkpoint: { text: 'LONG PRIVATE CHECKPOINT', verified: false } }])
  const diagnostics = walk(tree, node => node.type === 'details' && String(node.props.className).includes('dat-diagnostics'))
  assert.equal(diagnostics.length, 1)
  assert.ok(!diagnostics[0].props.open)
  assert.doesNotMatch(text(tree, true), /LONG PRIVATE CHECKPOINT|revision 7|Lease epoch.*89/i)
})
