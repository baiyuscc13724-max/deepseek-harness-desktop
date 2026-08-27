const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8')
const runtime = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-runtime.js')
const compat = read('mobile', 'android', 'app', 'src', 'main', 'assets', 'mobile-compat.css')
const official = read('node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js')

function section(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`)
  return source.slice(from, to)
}

function assertContainsAll(source, contracts, label) {
  for (const contract of contracts) {
    assert.ok(source.includes(contract), `${label} missing contract: ${contract}`)
  }
}

test('mobile decorates the existing official TodoDock and QueueDock without creating state or actions', () => {
  const decorate = section(runtime, '  const decorateConversation = () => {', '  let composerStyleRestorations = []')
  assertContainsAll(decorate, [
    "conversation.querySelectorAll('[data-testid=\"todo-panel\"]')",
    "panel.dataset.harnessMobileSessionTaskPanel = 'true'",
    "conversation.querySelectorAll('[data-queue-dock]')",
    "queue.dataset.harnessMobileQueueDock = 'true'"
  ], 'mobile dock decoration')
  assert.doesNotMatch(decorate, /createElement|appendChild|insertBefore|updateQueue|addEventListener/u)
  assert.match(runtime, /const structuralSelector = '[^']*\[data-testid="todo-panel"\][^']*\[data-queue-dock\][^']*'/u)
})

test('official QueueDock remains authoritative for count, edit, delete and immediate send', () => {
  const queueDock = section(official, 'function QueueDock({ useSession, updateQueue, notify, t })', 'const queueDockEntry = {')
  assertContainsAll(queueDock, [
    'const inbox = useSession((s) => s.queue)',
    'row.placement === "queued"',
    '"data-queue-dock": ""',
    'children: t("queue.count", { n: queue.length })',
    'kind: "edit"',
    'label: t("queue.edit")',
    'applyAction(row.id, { kind: "remove" }',
    'label: t("queue.remove")',
    'applyAction(row.id, { kind: "steer" }',
    'label: t("queue.steer")'
  ], 'official QueueDock actions')
  assert.match(official, /updateQueue: \(itemId, action\) => conversation\.updateQueue\(itemId, action\)/u)
})

test('official TodoDock remains authoritative for counts, statuses and folding', () => {
  const todoDock = section(official, 'function progressLabel(todos, t)', 'const todoDockEntry = {')
  assertContainsAll(todoDock, [
    'todos.filter((item) => item.status === "completed").length',
    'todos.filter((item) => item.status === "in_progress").length',
    '"data-testid": "todo-panel"',
    '"aria-expanded": !collapsed',
    'setCollapsed((v) => !v)',
    'useProjection("todos") ?? []'
  ], 'official TodoDock projection')
})

test('mobile TodoDock and QueueDock are touch-safe and cannot overflow a narrow composer', () => {
  assert.match(compat, /\[data-harness-mobile-conversation="true"\] \[data-slot="conversation\.input\.dock"\]\s*\{[^}]*width:\s*100%\s*!important[^}]*min-width:\s*0\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-session-task-panel="true"\]\s*\{[^}]*width:\s*100%\s*!important[^}]*max-width:\s*760px\s*!important[^}]*min-width:\s*0\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-session-task-panel="true"\] button\[aria-expanded\]\s*\{[^}]*min-height:\s*44px\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-session-task-panel="true"\] ul\s*\{[^}]*max-height:\s*min\(240px, 34dvh\)\s*!important[^}]*overflow-x:\s*hidden\s*!important/su)
  assert.doesNotMatch(compat, /\[data-harness-mobile-session-task-panel="true"\][^{}]*\{[^}]*display:\s*none/su)

  assert.match(compat, /\[data-harness-mobile-queue-dock="true"\]\s*\{[^}]*width:\s*100%\s*!important[^}]*max-width:\s*760px\s*!important[^}]*min-width:\s*0\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-queue-dock="true"\] > div > button\s*\{[^}]*min-height:\s*44px\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-queue-dock="true"\] ul\s*\{[^}]*min-width:\s*0\s*!important[^}]*overflow-x:\s*hidden\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-queue-dock="true"\] li\s*\{[^}]*width:\s*100%\s*!important[^}]*min-width:\s*0\s*!important[^}]*overflow:\s*hidden\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-queue-dock="true"\] li input\s*\{[^}]*min-width:\s*0\s*!important[^}]*height:\s*44px\s*!important/su)
  assert.match(compat, /\[data-harness-mobile-queue-dock="true"\] li button\s*\{[^}]*width:\s*44px\s*!important[^}]*min-height:\s*44px\s*!important/su)
  assert.doesNotMatch(compat, /\[data-harness-mobile-queue-dock="true"\][^{}]*\{[^}]*display:\s*none/su)
})

test('TodoDock and QueueDock controls stay outside the Stop-as-Send interception boundary', () => {
  const bridge = section(runtime, '  const installImeSendBridge = () => {', '  const installComposerLift = () => {')
  assertContainsAll(bridge, [
    "event.target?.closest?.('[data-composer-card] button')",
    'const dispatchOfficialEnter = textarea =>',
    "const keydown = new KeyboardEvent('keydown'"
  ], 'Stop-as-Send boundary')
  assert.doesNotMatch(bridge, /todo-panel|harnessMobileSessionTaskPanel|data-queue-dock|harnessMobileQueueDock/u)

  const dockIndex = official.indexOf('zone !== void 0 && renderSlot("conversation.input.dock", zone)')
  const inputIndex = official.indexOf('inputBar', dockIndex)
  assert.ok(dockIndex >= 0 && inputIndex > dockIndex, 'official QueueDock must remain above and outside the composer card')
})
