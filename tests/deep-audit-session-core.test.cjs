'use strict';
// Executes shipped production bundles in memory; never imports a host boot entry or writes node_modules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const packagePath = name => path.join(root, 'node_modules', '@deepseek-ai', name);
const sourcePath = name => path.join(packagePath(name), 'lib', 'client.js');
const ok = value => ({ ok: true, value });
const failure = code => ({ ok: false, error: { isDSHRemoteError: true, code, message: code } });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function store(initial) {
  let value = initial; const listeners = new Set();
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    set: next => { value = typeof next === 'function' ? next(value) : next; for (const fn of listeners) fn(); } };
}
function loadBundles() {
  const fakeReact = { createContext: () => ({}), memo: fn => fn, forwardRef: fn => fn, Component: class {}, PureComponent: class {}, lazy: fn => fn };
  const externals = {
    '@deepseek-ai/cordis': { Service: class { constructor(ctx) { this.ctx = ctx; } }, Context: { filter: Symbol('filter') } },
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: store, notifySubscribers: listeners => { for (const fn of listeners) fn(); } },
    '@deepseek-ai/dsh-client-ui-slots': {}, '@deepseek-ai/dsh-client-ui-primitives': {},
    'react': fakeReact, 'react-dom': {}, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  };
  let definition;
  const context = vm.createContext({ window: { __ModuleLoader__: { load: d => { definition = d; } } },
    console, queueMicrotask, setTimeout, clearTimeout, AbortController, AbortSignal, crypto: webcrypto, URL, Blob, TextEncoder, TextDecoder, atob, btoa,
  });
  const load = (name, fields) => {
    let source = fs.readFileSync(sourcePath(name), 'utf8');
    if (name === 'dsh-client-ui-conversation' && process.env.DSH_AUDIT_SESSION_CORE_BASELINE !== '1') {
      source = require('../scripts/deep-audit-session-core-patch.mjs').transformSessionCoreClientSource(source).source;
    }
    const anchor = 'return module.exports;';
    assert.equal(source.split(anchor).length, 2, 'one bundle export seam');
    source = source.replace(anchor, `exports.audit = { ${fields.join(', ')} }; ${anchor}`);
    vm.runInContext(source, context, { filename: sourcePath(name), timeout: 3000 });
    const result = definition.factory(id => { assert.ok(Object.hasOwn(externals, id), `unexpected external ${id}`); return externals[id]; });
    externals[`@deepseek-ai/${name}/client`] = result;
    return result;
  };
  const gateway = load('dsh-api-gateway', []);
  const session = load('dsh-api-session-controller', ['Session', 'SessionManager', 'ClientSessions', 'SessionQueueMirror', 'ProjectionValueStore']);
  const conversation = load('dsh-client-ui-conversation', ['SubmitMachine', 'SessionInputShell', 'InputHub', 'ConversationController']);
  const workspace = load('dsh-client-ui-workspace', ['WorkspaceBrowser']);
  return { ...session.audit, ...conversation.audit, ...workspace.audit, gateway, context, react: fakeReact };
}
const production = loadBundles();

test('shipped source provenance: executable production modules, not idealized replicas', () => {
  console.log(JSON.stringify({ inMemoryCandidateApplied: process.env.DSH_AUDIT_SESSION_CORE_BASELINE !== '1', installedPackagesModified: false }));
  for (const name of ['dsh-api-gateway', 'dsh-api-session-controller', 'dsh-client-ui-conversation', 'dsh-client-ui-workspace']) {
    const metadata = JSON.parse(fs.readFileSync(path.join(packagePath(name), 'package.json'), 'utf8'));
    assert.equal(metadata.version, '0.1.2-alpha.5');
    console.log(JSON.stringify({ source: path.relative(root, sourcePath(name)), version: metadata.version,
      sha256: createHash('sha256').update(fs.readFileSync(sourcePath(name))).digest('hex') }));
  }
  assert.equal(typeof production.Session, 'function');
  assert.equal(typeof production.SessionInputShell, 'function');
});

test('create success is immediately selectable; rejection adds no phantom session; unknown selection stays put', async () => {
  const { SessionManager } = production;
  const calls = []; let result = ok({ sessionId: 'fixture-a' });
  const manager = new SessionManager({ session: { create: async value => { calls.push(value); return result; } }, subagents: { list: async () => ok({ parentAvailable: true, entries: [] }) } });
  await manager.create({ cwd: '/fixture/a' });
  manager.select('fixture-a');
  assert.equal(manager.selected, 'fixture-a');
  assert.throws(() => manager.select('missing'), /unknown session/);
  assert.equal(manager.selected, 'fixture-a');
  result = failure('session/create-denied');
  await manager.create({ cwd: '/fixture/b' });
  assert.equal(manager.summaries.length, 1);
  assert.equal(calls.length, 2);
  await manager.dispose();
});

test('headless shipped editor creates two independent resident drafts', () => {
  const a = new production.SessionInputShell({ inputTriggers: () => undefined, popup: () => undefined });
  const b = new production.SessionInputShell({ inputTriggers: () => undefined, popup: () => undefined });
  a.setDraft('alpha draft'); b.setDraft('beta draft');
  assert.equal(a.snapshot.draft, 'alpha draft');
  assert.equal(b.snapshot.draft, 'beta draft');
  a.dispose(); b.dispose();
});

const shell = (extra = {}, types = production) => new types.SessionInputShell({ inputTriggers: () => undefined, popup: () => undefined, ...extra });
const row = (id, placement = 'queued', rpcId) => ({ id, placement, rpcId, message: { id: `message-${id}`, content: [{ type: 'text', text: id }] } });

test('create echo and added-frame race deduplicates and enriches without regressing authoritative data', async () => {
  const gate = deferred();
  const manager = new production.SessionManager({ session: { create: () => gate.promise } });
  const creating = manager.create({ cwd: '/fixture/a' });
  manager.mergeSummary({ sessionId: 'a', updatedAt: 99, running: true, blank: false });
  gate.resolve(ok({ sessionId: 'a' })); await creating;
  assert.equal(manager.summaries.length, 1);
  assert.equal(manager.summaries[0].running, true);
  assert.equal(manager.summaries[0].cwd, '/fixture/a');
  await manager.dispose();
});

test('rename rejects without replacing title; reordered accepted replies obey higher sequence', async () => {
  const calls = [deferred(), deferred(), deferred()]; let i = 0;
  const session = new production.Session('a', { session: { rename: () => calls[i++].promise } });
  session.projections.apply('title', 'original', 1);
  const older = session.rename('older'), newer = session.rename('newer');
  calls[1].resolve(ok({ title: 'newer', seq: 3 })); await newer;
  calls[0].resolve(ok({ title: 'older', seq: 2 })); await older;
  assert.equal(session.projections.faceOf('title').getSnapshot(), 'newer');
  const denied = session.rename('denied'); calls[2].resolve(failure('session/rename-denied')); await denied;
  assert.equal(session.projections.faceOf('title').getSnapshot(), 'newer');
  await session.dispose();
});

test('prompt mode, identity, abort signal and errors stay bound to original session', async () => {
  const gate = deferred(), calls = [];
  const remote = { session: { prompt: (value, signal) => { calls.push({ value, signal }); return gate.promise; } } };
  const a = new production.Session('a', remote), b = new production.Session('b', remote);
  const controller = new AbortController(); const settlements = [];
  a.handleRunning(true);
  const echo = a.beginSubmission({ mode: 'queue', text: 'private-a', images: [], onRetire: v => settlements.push(v) });
  const pending = a.prompt([{ type: 'text', text: 'private-a' }], 'queue', controller.signal, echo.requestId);
  assert.equal(a.getSnapshot().pendingSubmissions[0].placement, 'queued');
  assert.equal(b.getSnapshot().pendingSubmissions.length, 0);
  controller.abort(); gate.resolve(failure('gateway/aborted')); await pending;
  assert.equal(calls[0].value.sessionId, 'a'); assert.equal(calls[0].value.mode, 'queue');
  assert.equal(calls[0].value.requestId, echo.requestId); assert.equal(calls[0].signal, controller.signal);
  assert.equal(a.getSnapshot().pendingSubmissions.length, 0); assert.equal(settlements.length, 1);
  assert.equal(a.getSnapshot().promptError.op, 'send'); assert.equal(b.getSnapshot().promptError, null);
  await a.dispose(); await b.dispose();
});

test('Stop routes exactly once and preserves pending inbox; failure surfaces as Stop error', async () => {
  const calls = []; let result = ok({ accepted: true });
  const a = new production.Session('a', { session: { cancel: async payload => { calls.push(payload); return result; } } });
  a.replaceControl([row('one'), row('two')]); a.handleRunning(true);
  await a.cancel();
  assert.deepEqual(plain(calls), [{ sessionId: 'a' }]);
  assert.equal(a.getSnapshot().queue.length, 2); assert.equal(a.getSnapshot().running, true, 'server running frame, not optimistic cancel, owns running');
  result = failure('session/cancel-denied'); await a.cancel();
  assert.equal(a.getSnapshot().promptError.op, 'stop'); assert.equal(a.getSnapshot().queue.length, 2);
  await a.dispose();
});

test('queue cancel and steer use exact occurrence; durable steering retirement is idempotent', async () => {
  const calls = []; const a = new production.Session('a', { session: { updateQueue: async p => { calls.push(p); return ok({ accepted: true }); } } });
  a.replaceControl([row('one'), row('two', 'steering')]);
  await a.updateQueue('one', { kind: 'remove' }); await a.updateQueue('two', { kind: 'steer' });
  assert.deepEqual(plain(calls), [{ sessionId: 'a', itemId: 'one', action: { kind: 'remove' } }, { sessionId: 'a', itemId: 'two', action: { kind: 'steer' } }]);
  const durable = { type: 'user/message', data: { id: 'message-two' } };
  assert.equal(a.queueMirror.acceptDurable(durable), true); assert.equal(a.queueMirror.acceptDurable(durable), false);
  assert.deepEqual(plain(a.queueMirror.snapshot().map(r => r.id)), ['one']);
  await a.dispose();
});

test('queue observation and durable echo race retire one local submission only once', async () => {
  const a = new production.Session('a', {}); const retired = [];
  const echo = a.beginSubmission({ mode: 'queue', text: 'x', images: [], onRetire: r => retired.push(r) });
  a.replaceControl([row('one', 'queued', echo.requestId)]);
  a.observeSubmissionEvent({ type: 'user/message', data: { source: { kind: 'user', rpcId: echo.requestId }, content: [] } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(retired.length, 1); assert.equal(retired[0].reason, 'observed');
  assert.equal(a.getSnapshot().pendingSubmissions.length, 0);
  await a.dispose();
});

test('optimistic editor clears before receipt; failed send restores only its own session and images', async () => {
  const gate = deferred(), calls = [];
  const a = shell({ defaultSink: (...args) => { calls.push(args); return gate.promise; } });
  const b = shell(); a.setDraft('a draft'); b.setDraft('b draft'); a.addImages(['image-a']); b.addImages(['image-b']);
  a.submit('queue');
  assert.equal(a.snapshot.draft, ''); assert.equal(calls[0][0], 'a draft');
  assert.deepEqual(plain(calls[0][1]), ['image-a']);
  gate.resolve({ kind: 'error', text: 'rejected' }); await flush();
  assert.equal(a.snapshot.draft, 'a draft'); assert.equal(b.snapshot.draft, 'b draft');
  assert.deepEqual(plain(a.snapshot.imageIds), ['image-a']); assert.deepEqual(plain(b.snapshot.imageIds), ['image-b']);
  a.dispose(); b.dispose();
});

test('new typing survives a late failed send and successful send does not erase new draft', async () => {
  for (const outcome of [{ kind: 'error', text: 'failed' }, { kind: 'success' }]) {
    const gate = deferred(); const a = shell({ defaultSink: () => gate.promise });
    a.setDraft('sent'); a.submit('queue'); a.setDraft('typed meanwhile');
    gate.resolve(outcome); await flush();
    assert.equal(a.snapshot.draft, 'typed meanwhile'); a.dispose();
  }
});

test('two concurrent failed sends restore submission order rather than receipt order', async () => {
  const gates = [deferred(), deferred()]; let i = 0;
  const a = shell({ defaultSink: () => gates[i++].promise });
  a.setDraft('first'); a.submit('queue'); a.setDraft('second'); a.submit('queue');
  gates[1].resolve({ kind: 'error' }); await flush(); assert.equal(a.snapshot.draft, 'second');
  gates[0].resolve({ kind: 'error' }); await flush(); assert.equal(a.snapshot.draft, 'first\n\nsecond');
  a.dispose();
});

test('disposed editor aborts detached sends, returns images once, ignores late settlement', async () => {
  const gate = deferred(); let signal;
  const a = shell({ defaultSink: (_text, _images, _mode, s) => { signal = s; return gate.promise; } });
  a.setDraft('sent'); a.addImages(['image-a']); a.submit('queue');
  assert.deepEqual(plain(a.dispose()), ['image-a']); assert.equal(signal.aborted, true);
  assert.deepEqual(plain(a.dispose()), []);
  gate.resolve({ kind: 'error', text: 'late failure' }); await flush();
  assert.equal(a.snapshot.draft, ''); assert.equal(a.notices.getSnapshot(), null);
});

test('draft mirror adoption is per shell and an old unbinder cannot remove replacement mirror', () => {
  const writesA = [], writesB = []; const a = shell(), b = shell();
  a.setDraft('restored-a'); b.setDraft('restored-b');
  const old = a.bindMirror(value => writesA.push(`old:${value}`));
  a.bindMirror(value => writesA.push(value)); b.bindMirror(value => writesB.push(value)); old();
  a.setDraft('edited-a'); b.setDraft('edited-b');
  assert.deepEqual(writesA, ['edited-a']); assert.deepEqual(writesB, ['edited-b']);
  a.dispose(); b.dispose();
});

test('disposed composer must unsubscribe queue publication exactly once', () => {
  const listeners = new Set(); let disposals = 0;
  const a = shell({ queue: { getSnapshot: () => [], subscribe: fn => { listeners.add(fn); return () => { disposals++; listeners.delete(fn); }; } } });
  assert.equal(listeners.size, 1); a.dispose(); a.dispose();
  assert.equal(listeners.size, 0); assert.equal(disposals, 1);
});

test('maintained transform is exact, idempotent and rejects unknown or duplicate source shapes', () => {
  const { transformSessionCoreClientSource: transform } = require('../scripts/deep-audit-session-core-patch.mjs');
  const source = fs.readFileSync(sourcePath('dsh-client-ui-conversation'), 'utf8');
  // A clean `npm ci` installs an unpatched runtime, while a machine whose installer already
  // completed holds a composed profile. Both are exact transform inputs, so assert the
  // transform contract (exactness, idempotence, refusal) without assuming pristine bytes.
  const once = transform(source); assert.equal(transform(once.source).changed, false);
  const twice = transform(once.source); assert.equal(twice.changed, false); assert.equal(twice.source, once.source);
  assert.throws(() => transform(''), /unexpected package/);
  assert.throws(() => transform(source + source), /unsupported source shape/);
  assert.throws(() => transform(source.replace('deps.queue?.subscribe', 'deps.queueChanged?.subscribe')), /unsupported source shape/);
  assert.equal(fs.readFileSync(sourcePath('dsh-client-ui-conversation'), 'utf8'), source, 'no installed package writes');
});

// The fake boundary below is only a Gateway physical-generation carrier. Cursor validation,
// replay rejection, history repair, Session generation fencing and publication are REAL bundles.
class ControlledCarrier {
  controller = new AbortController(); items = []; waiting = []; closed = false; accepted = 0;
  get signal() { return this.controller.signal; }
  [Symbol.asyncIterator]() { return this; }
  next() { if (this.items.length) return Promise.resolve({ done: false, value: this.items.shift() }); if (this.closed) return Promise.resolve({ done: true }); const gate = deferred(); this.waiting.push(gate); return gate.promise; }
  push(value, generation = 1) {
    const item = { value, generation, signal: this.signal, accept: () => this.accepted++ };
    if (this.closed) return;
    const waiter = this.waiting.shift(); if (waiter) waiter.resolve({ done: false, value: item }); else this.items.push(item);
  }
  async dispose() { this.closed = true; this.controller.abort(Object.assign(new Error('fixture disposed'), { isDSHRemoteError: true, code: 'gateway/disposed', details: {} })); for (const gate of this.waiting.splice(0)) gate.resolve({ done: true }); }
  restart() {}
}
const entry = seq => ({ type: 'event', event: { seq, type: 'fixture/event', data: {} } });
const page = (seqs, hasMore = false) => ({ records: seqs.map(entry), hasMore });
const opening = (seqs, hasMore = false) => ({ type: 'opened', cursor: seqs.at(-1) ?? -1, page: page(seqs, hasMore) });
const sequence = session => plain(session.eventSource.getSnapshot().entries.map(e => e.event.seq));
function historySession(pageHandler) {
  const carriers = [], calls = [];
  const session = new production.Session('history-fixture', {
    $stream: () => { const carrier = new ControlledCarrier(); carriers.push(carrier); return carrier; },
    session: { page: (payload, signal) => { calls.push({ payload, signal }); return pageHandler(payload, signal); } },
  });
  return { session, carriers, calls };
}

test('real Gateway history prepends contiguously, deduplicates overlaps and gates concurrent pagination', async () => {
  const gate = deferred(); const h = historySession(() => gate.promise);
  const openingPromise = h.session.open(); h.carriers[0].push(opening([4, 5], true)); await openingPromise;
  const a = h.session.loadOlder(), b = h.session.loadOlder();
  assert.equal(h.calls.length, 1); assert.equal(h.session.getSnapshot().loadingOlder, true);
  assert.equal(h.calls[0].payload.address.sessionId, 'history-fixture');
  gate.resolve(ok(page([2, 3, 4], false))); await a; await b;
  assert.deepEqual(sequence(h.session), [2, 3, 4, 5]);
  assert.equal(h.session.getSnapshot().hasMore, false); assert.equal(h.session.getSnapshot().loadingOlder, false);
  await h.session.dispose(); assert.equal(h.carriers[0].waiting.length, 0);
});

test('real Gateway rejects discontinuous older page without poisoning visible history', async () => {
  const h = historySession(async () => ok(page([0, 1], true)));
  const pending = h.session.open(); h.carriers[0].push(opening([4, 5], true)); await pending;
  await h.session.loadOlder();
  assert.deepEqual(sequence(h.session), [4, 5]); assert.equal(h.session.getSnapshot().hasMore, false);
  assert.equal(h.session.getSnapshot().loadingOlder, false); await h.session.dispose();
});

test('real Gateway ignores duplicate live entries and accepts contiguous live tail', async () => {
  const h = historySession(async () => { throw new Error('unexpected page'); });
  const pending = h.session.open(); h.carriers[0].push(opening([0, 1])); await pending;
  h.carriers[0].push({ type: 'entry', entry: entry(1) }); h.carriers[0].push({ type: 'entry', entry: entry(2) });
  await flush(); assert.deepEqual(sequence(h.session), [0, 1, 2]); assert.equal(h.calls.length, 0); await h.session.dispose();
});

test('resync fences a late old history page and retains only replacement generation', async () => {
  const gate = deferred(); const h = historySession(() => gate.promise);
  const pending = h.session.open(); h.carriers[0].push(opening([4, 5], true)); await pending;
  const oldPage = h.session.loadOlder(); const resync = h.session.resync(); await flush();
  assert.equal(h.carriers.length, 2); h.carriers[1].push(opening([7, 8])); await resync;
  gate.resolve(ok(page([2, 3], true))); await oldPage;
  assert.deepEqual(sequence(h.session), [7, 8]); assert.equal(h.calls[0].signal.aborted, true);
  await h.session.dispose(); assert.equal(h.carriers.every(c => c.closed), true);
});

function walk(node, predicate) {
  if (node === null || typeof node !== 'object') return undefined;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) { if (typeof value === 'function') continue; const found = walk(value, predicate); if (found) return found; }
}
function workspaceHarness(extra = {}) {
  const cells = [], effects = []; let cursor = 0; let tree; const timers = new Map(); let timerId = 0;
  const unchanged = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  Object.assign(production.react, {
    useState(initial) { const i = cursor++; if (!cells[i]) cells[i] = { value: typeof initial === 'function' ? initial() : initial }; return [cells[i].value, value => { cells[i].value = typeof value === 'function' ? value(cells[i].value) : value; }]; },
    useRef(initial) { const i = cursor++; if (!cells[i]) cells[i] = { current: initial }; return cells[i]; },
    useMemo(fn) { return fn(); }, useCallback(fn) { return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || !unchanged(cells[i].deps, deps)) { const old = cells[i]; cells[i] = { deps }; effects.push(() => { old?.cleanup?.(); cells[i].cleanup = fn(); }); } },
  });
  production.context.window.setTimeout = fn => { const id = ++timerId; timers.set(id, fn); return id; };
  production.context.window.clearTimeout = id => timers.delete(id);
  production.context.document = { addEventListener() {}, removeEventListener() {} };
  const noop = () => {};
  const props = { wide: true, expandSidebar: noop, useSessions: fn => fn({ current: 'a', byId: { a: { sessionId: 'a', blank: false } } }),
    useWorkspaces: fn => fn({ items: [], phase: 'ready', archivedSessionIds: [] }),
    useStore: fn => fn({ groupBy: 'flat', orderBy: 'recent', groupExpansion: {}, sessionOrderByAccount: {}, sessionUpdatedAtByAccount: {} }),
    useHostInfo: fn => fn({ home: '/fixture' }), useDirectoryFlow: fn => fn(false),
    actions: { setSessionOrder: noop, retainAccountKeys: noop }, t: key => key,
    ...extra,
  };
  return {
    render() { cursor = 0; tree = production.WorkspaceBrowser(props); for (const effect of effects.splice(0)) effect(); return tree; },
    find(predicate) { const found = walk(tree, predicate); assert.ok(found, 'expected rendered production control'); return found; },
    runTimers() { const callbacks = [...timers.values()]; timers.clear(); for (const fn of callbacks) fn(); },
    dispose() { for (const cell of cells) cell?.cleanup?.(); timers.clear(); },
  };
}

test('real rename dialog cancels without RPC and rejects blank title; IME Enter does not submit', () => {
  const calls = []; const h = workspaceHarness({ renameSession: (...args) => { calls.push(args); return Promise.resolve(); } });
  h.render(); h.find(n => n.props?.onSessionRename).props.onSessionRename('a', 'original'); h.render();
  const input = h.find(n => n.props?.['aria-label'] === 'field.sessionName');
  input.props.onCompositionStart(); input.props.onKeyDown({ key: 'Enter', preventDefault() {} }); assert.equal(calls.length, 0);
  input.props.onCompositionEnd(); input.props.onChange({ target: { value: '   ' } }); h.render();
  const modal = h.find(n => n.props?.title === 'rename.session.title');
  assert.equal(walk(modal.props.footer, n => n.props?.children === 'rename').props.disabled, true);
  modal.props.onClose(); h.render(); assert.equal(h.find(n => n.props?.title === 'rename.session.title').props.open, false);
  assert.equal(calls.length, 0); h.dispose();
});

test('real rename dialog displays failure, keeps draft for retry, then closes on acknowledged success', async () => {
  const gates = [deferred(), deferred()], calls = [];
  const h = workspaceHarness({ renameSession: (...args) => { calls.push(args); return gates[calls.length - 1].promise; } });
  h.render(); h.find(n => n.props?.onSessionRename).props.onSessionRename('a', 'original'); h.render();
  h.find(n => n.props?.['aria-label'] === 'field.sessionName').props.onChange({ target: { value: 'new title' } }); h.render();
  const clickSave = () => walk(h.find(n => n.props?.title === 'rename.session.title').props.footer, n => n.props?.children === 'rename').props.onClick();
  clickSave(); h.render(); assert.equal(h.find(n => n.props?.['aria-label'] === 'field.sessionName').props.disabled, true);
  gates[0].reject(new Error('fixture denied')); await flush(); h.render();
  assert.match(String(h.find(n => n.props?.role === 'alert').props.children), /fixture denied/);
  assert.equal(h.find(n => n.props?.['aria-label'] === 'field.sessionName').props.value, 'new title');
  clickSave(); gates[1].resolve(); await flush(); h.render();
  assert.equal(h.find(n => n.props?.title === 'rename.session.title').props.open, false);
  assert.deepEqual(calls, [['a', 'new title'], ['a', 'new title']]); h.dispose();
});

test('real search effect aborts superseded request and ignores late success; failure and Escape clear state', async () => {
  const gates = [deferred(), deferred(), deferred()], calls = [];
  const h = workspaceHarness({ searchSessions: (query, signal) => { calls.push({ query, signal }); return gates[calls.length - 1].promise; } });
  h.render(); const input = () => h.find(n => n.props?.placeholder === 'search.placeholder');
  input().props.onChange({ target: { value: 'older' } }); h.render(); h.runTimers();
  input().props.onChange({ target: { value: 'newer' } }); h.render(); h.runTimers();
  assert.equal(calls[0].signal.aborted, true);
  gates[1].resolve({ items: [{ sessionId: 'new' }], hasMore: false }); await flush();
  gates[0].resolve({ items: [{ sessionId: 'stale' }], hasMore: true }); await flush(); h.render();
  assert.deepEqual(plain(h.find(n => n.props?.remote).props.remote.items), [{ sessionId: 'new' }]);
  input().props.onChange({ target: { value: 'failure' } }); h.render(); h.runTimers();
  gates[2].reject(new Error('fixture unavailable')); await flush(); h.render();
  assert.equal(h.find(n => n.props?.remote).props.remote.status, 'error');
  input().props.onKeyDown({ key: 'Escape' }); h.render();
  assert.equal(input().props.value, ''); assert.equal(calls[2].signal.aborted, true); h.dispose();
});

test('reopened selection survives absent list and concurrent list refresh replays new creations', async () => {
  const gates = [deferred(), deferred()]; let calls = 0;
  const m = new production.SessionManager({ session: { list: () => gates[calls++].promise, create: async () => ok({ sessionId: 'created' }) } }, 'restored');
  assert.equal(m.getListSnapshot().current, undefined);
  const first = m.refreshList(); assert.equal(m.refreshList(), first); assert.equal(calls, 1);
  gates[0].resolve(ok({ items: [] })); await first;
  assert.equal(m.selected, 'restored'); assert.equal(m.getListSnapshot().current, undefined);
  const second = m.refreshList(); await m.create({ cwd: '/fixture/new' });
  gates[1].resolve(ok({ items: [{ sessionId: 'restored', running: false, blank: false, updatedAt: 1 }] })); await second;
  assert.equal(m.getListSnapshot().current, 'restored');
  assert.deepEqual(plain(m.summaries.map(s => s.sessionId).sort()), ['created', 'restored']);
  await m.dispose();
});

test('real Gateway repairs an out-of-order live gap through authoritative page before publication', async () => {
  const h = historySession(async () => ok(page([0, 1, 2, 3, 4])));
  const pending = h.session.open(); h.carriers[0].push(opening([0, 1])); await pending;
  h.carriers[0].push({ type: 'entry', entry: entry(4) });
  await flush(); await flush();
  assert.deepEqual(sequence(h.session), [0, 1, 2, 3, 4]); assert.equal(h.calls.length, 1);
  h.carriers[0].push({ type: 'entry', entry: entry(2) }); h.carriers[0].push({ type: 'entry', entry: entry(3) });
  await flush(); assert.deepEqual(sequence(h.session), [0, 1, 2, 3, 4]); await h.session.dispose();
});

test('reconnect baseline cannot rewind behind the last published cursor', async () => {
  const h = historySession(async () => { throw new Error('unexpected page'); });
  const pending = h.session.open(); h.carriers[0].push(opening([0, 1, 2])); await pending;
  h.carriers[0].push(opening([0, 1]), 2); await flush();
  assert.equal(h.session.getSnapshot().openState, 'error'); assert.deepEqual(sequence(h.session), [0, 1, 2]);
  assert.equal(h.carriers[0].closed, true); await h.session.dispose();
});

test('actual InputHub and ConversationController route a detached send to its original scoped Session', async () => {
  const services = new Map(), bindings = new Map(); const reached = deferred(); const calls = [];
  const ctx = id => ({ id, get: name => services.get(name), cleanups: [],
    on() { return () => {}; }, effect(fn) { this.cleanups.push(fn()); } });
  const rootCtx = ctx(); const actx = ctx('a'), bctx = ctx('b');
  const remote = { session: { prompt: async payload => { calls.push(payload); reached.resolve(); return ok({ accepted: true }); } } };
  const a = new production.Session('a', remote), b = new production.Session('b', remote);
  bindings.set('a', { sessionId: 'a', session: a, ctx: actx }); bindings.set('b', { sessionId: 'b', session: b, ctx: bctx });
  services.set('sessions', { scopeOf: c => c.id, binding: id => bindings.get(id) });
  const hub = new production.InputHub(rootCtx, key => key);
  const conversation = new production.ConversationController(rootCtx, { input: hub, blocks: {} }); services.set('conversation', conversation);
  const inputA = hub.for(actx), inputB = hub.for(bctx);
  assert.equal(hub.for(actx), inputA); assert.throws(() => hub.for(rootCtx), /requires a session scope/);
  await assert.rejects(conversation.send('unscoped'), /requires a session scope/);
  inputA.setDraft('a scoped send'); inputA.submit('queue'); inputB.setDraft('b meanwhile');
  await reached.promise; await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0].sessionId, 'a'); assert.equal(calls[0].content[0].text, 'a scoped send');
  assert.equal(inputB.snapshot.draft, 'b meanwhile');
  for (const cleanup of actx.cleanups) cleanup();
  assert.equal(a.notifier.listeners.size, 0); assert.equal(hub.for(bctx), inputB);
  for (const cleanup of bctx.cleanups) cleanup(); for (const cleanup of rootCtx.cleanups) cleanup();
  await a.dispose(); await b.dispose();
});

test('100 composer lifetimes leave no queue listeners or late publication', () => {
  const session = new production.Session('lifetime-fixture', {}); let late = 0;
  for (let i = 0; i < 100; i++) {
    const editor = shell({ queue: { getSnapshot: () => session.getSnapshot().queue, subscribe: fn => session.subscribe(fn) } });
    let disposalReturned = false;
    editor.state.subscribe(() => { if (disposalReturned) late++; }); editor.dispose(); disposalReturned = true;
  }
  session.replaceControl([row('late')]); session.notifier.notifyNow();
  assert.equal(session.notifier.listeners.size, 0); assert.equal(late, 0);
});
