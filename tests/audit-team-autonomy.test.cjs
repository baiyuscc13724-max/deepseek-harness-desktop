'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const vm = require('node:vm')
const { readFile } = require('node:fs/promises')
const clientFile = path.resolve(__dirname, '../plugins/dsh-agent-teams/lib/client.js')
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const state = n => ({ enabled: true, config: { maxMembers: n, maxActiveTurns: n, autopilotEnabled: false, autopilotMaxAdditionalRounds: 200 } })
const response = value => ({ ok: true, status: 200, json: async () => value })
function walk(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...(node.children || []).flatMap(child => walk(child, predicate))] }
function text(node) { return node && typeof node === 'object' ? (node.children || []).map(text).join(' ') : String(node ?? '') }

// Whole production module, persistent hook slots, explicit render/effect boundary.
// No React DOM/layout claim: this tests actual handlers and stale async closures.
// Every HTTP request terminates in the supplied fake; no real fetch/Host bridge.
async function uiFixture(fetcher) {
  const source = await readFile(clientFile, 'utf8')
  const marker = '    exports.apply = apply;'
  assert.equal(source.split(marker).length, 2)
  const injected = source.replace(marker, '    exports.auditTest = { AgentTeamsSettings, MemberRecoveryPanel, MemberRecoveryReconcilePanel, WorkspaceNav, ActiveTeam, zh, en };\n' + marker)
  let cursor = 0, module
  const slots = [], pending = [], calls = []
  const React = {
    createElement(type, props, ...children) {
      const p = { ...(props || {}), children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) }
      return typeof type === 'function' ? type(p) : { type, props: p, children: p.children }
    },
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i] },
    useEffect(effect, deps) { const i = cursor++, before = slots[i]; if (!before || !deps || deps.some((value, j) => value !== before.deps[j])) { before?.cleanup?.(); const record = { deps }; slots[i] = record; pending.push(() => { record.cleanup = effect() }) } },
    startTransition(work) { work() }
  }
  const window = { __ModuleLoader__: { load(definition) { module = definition.factory(name => { assert.equal(name, 'react'); return React }) } } }
  const document = { addEventListener() {}, removeEventListener() {} }
  vm.runInNewContext(injected, { window, document, console, URL, URLSearchParams, setTimeout, clearTimeout, AbortController, fetch(url, options) { calls.push({ url, options }); if (!fetcher) throw new Error('Unexpected fixture HTTP'); return fetcher(url, options) } }, { filename: clientFile })
  const api = module.auditTest
  return { api, calls, render(name, props) { cursor = 0; const tree = api[name](props); while (pending.length) pending.shift()(); return tree }, dispose() { for (const slot of slots) slot?.cleanup?.() }, t(key, values = {}) { return String(api.en[key] || key).replace(/\{([^}]+)\}/g, (_, name) => String(values[name] ?? '')) } }
}
function settingsProps(id) { return { sessions: { list: { getSnapshot: () => ({ current: id }) } } } }
function form(tree) { const value = walk(tree, node => node.type === 'form')[0]; assert.ok(value, 'settings form is available'); return value }
const submit = node => node.props.onSubmit({ preventDefault() {} })

test('team settings submits once before render and retries after a rejected save', async () => {
  const gate = deferred(); let posts = 0
  const fx = await uiFixture(async (_url, options) => { if (options?.method === 'POST') { posts++; return gate.promise } return response(state(4)) })
  try {
    fx.render('AgentTeamsSettings', settingsProps('A')); await flush()
    const node = form(fx.render('AgentTeamsSettings', settingsProps('A')))
    submit(node); submit(node)
    assert.equal(posts, 1, 'same-frame double submit must not send two setting writes')
    gate.reject(new Error('fixture save failed')); await flush()
    const retry = fx.render('AgentTeamsSettings', settingsProps('A'))
    assert.match(text(retry), /fixture save failed/)
    submit(form(retry)); await flush()
    assert.equal(posts, 2, 'explicit retry becomes available after settlement')
  } finally { gate.resolve(response({ state: state(4) })); await flush(); fx.dispose() }
})

test('a late settings save cannot overwrite a newly selected session', async () => {
  const gate = deferred()
  const fx = await uiFixture(async (url, options) => options?.method === 'POST' ? gate.promise : response(state(String(url).includes('sessionId=B') ? 8 : 4)))
  try {
    fx.render('AgentTeamsSettings', settingsProps('A')); await flush()
    submit(form(fx.render('AgentTeamsSettings', settingsProps('A'))))
    fx.render('AgentTeamsSettings', settingsProps('B')); await flush()
    gate.resolve(response({ state: state(2) })); await flush()
    const tree = fx.render('AgentTeamsSettings', settingsProps('B'))
    assert.equal(walk(tree, node => node.props?.id === 'dat-max-members')[0].props.value, 8)
    assert.equal(walk(tree, node => node.props?.role === 'status' && text(node) === fx.t('settingsSaved')).length, 0)
  } finally { gate.resolve(response({ state: state(2) })); await flush(); fx.dispose() }
})

test('failed settings load cannot save fabricated defaults and exposes a reload control', async () => {
  let fail = true, posts = 0
  const fx = await uiFixture(async (_url, options) => { if (options?.method === 'POST') { posts++; return response({ state: state(4) }) } if (fail) throw new Error('fixture read unavailable'); return response(state(6)) })
  try {
    fx.render('AgentTeamsSettings', settingsProps('A')); await flush()
    let tree = fx.render('AgentTeamsSettings', settingsProps('A'))
    assert.match(text(tree), /fixture read unavailable/)
    const existingForm = walk(tree, node => node.type === 'form')[0]
    if (existingForm) submit(existingForm)
    assert.equal(posts, 0, 'unknown authoritative settings are not editable defaults')
    const retry = walk(tree, node => node.type === 'button' && text(node) === fx.t('retry'))[0]
    assert.ok(retry, 'failed initial load has a usable retry button')
    fail = false; retry.props.onClick()
    fx.render('AgentTeamsSettings', settingsProps('A')); await flush()
    tree = fx.render('AgentTeamsSettings', settingsProps('A'))
    assert.equal(walk(tree, node => node.props?.id === 'dat-max-members')[0].props.value, 6)
  } finally { await flush(); fx.dispose() }
})

test('recovery reconciliation double click confirms once, propagates failure, and remains retryable', async () => {
  const gate = deferred(); let calls = 0
  const fx = await uiFixture()
  const props = { t: fx.t, receipts: [{ requestId: 'r1', phase: 'dispatch', member: { name: 'Test' } }], onReconcile() { calls++; return gate.promise } }
  try {
    let tree = fx.render('MemberRecoveryReconcilePanel', props)
    walk(tree, node => node.type === 'button' && text(node) === fx.t('recoveryMarkDelivered'))[0].props.onClick()
    tree = fx.render('MemberRecoveryReconcilePanel', props)
    const button = walk(tree, node => node.type === 'button' && text(node) === fx.t('recoveryConfirm'))[0]
    button.props.onClick(); button.props.onClick()
    assert.equal(calls, 1)
    gate.reject(new Error('fixture reconcile failed')); await flush()
    tree = fx.render('MemberRecoveryReconcilePanel', props)
    assert.match(text(tree), /fixture reconcile failed/)
    walk(tree, node => node.type === 'button' && text(node) === fx.t('recoveryConfirm'))[0].props.onClick(); await flush()
    assert.equal(calls, 2)
  } finally { gate.resolve(); await flush(); fx.dispose() }
})

test('recovery retry and replace already share a synchronous one-request fence', async () => {
  const gate = deferred(); const calls = []
  const fx = await uiFixture()
  try {
    const tree = fx.render('MemberRecoveryPanel', { t: fx.t, members: [{ id: 'm1', name: 'Test' }], onRecover(...args) { calls.push(args); return gate.promise } })
    const buttons = walk(tree, node => node.type === 'button')
    buttons[0].props.onClick(); buttons[1].props.onClick()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][1], 'retry')
  } finally { gate.resolve(); await flush(); fx.dispose() }
})

test('every workspace navigation button is local, named and has a stable destination', async () => {
  const fx = await uiFixture(), visited = []
  try {
    const tree = fx.render('WorkspaceNav', { t: fx.t, value: 'board', counts: {}, onChange(id) { visited.push(id) } })
    const buttons = walk(tree, node => node.type === 'button')
    assert.ok(buttons.length >= 5)
    for (const button of buttons) { assert.ok(text(button).trim()); button.props.onClick() }
    assert.equal(new Set(visited).size, buttons.length)
    assert.ok(visited.includes('board')); assert.ok(visited.includes('canvas')); assert.ok(visited.includes('participants')); assert.ok(visited.includes('inbox')); assert.ok(visited.includes('automation'))
    assert.equal(fx.calls.length, 0, 'navigation never starts work or grants authorization')
  } finally { fx.dispose() }
})
