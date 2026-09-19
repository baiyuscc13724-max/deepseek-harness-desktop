'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const digest = source => createHash('sha256').update(source).digest('hex').toUpperCase();
const fullName = name => '@deepseek-ai/' + name;
const sourceFile = (name, file = 'client.js') => path.join(root, 'node_modules', fullName(name), 'lib', file);
const finalHash = '30F413CC27BE08F0B57A472440495B033EA8B708E281D465CD5BBE3E45CD0066';
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'core-install-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const modules = path.join(directory, 'node_modules');
  const files = {};
  const clients = ['dsh-api-session-controller','dsh-client-ui-chat','dsh-client-ui-conversation','dsh-client-connection','dsh-client-ui-schedule','dsh-client-ui-attachment'];
  const servers = ['dsh-session-turn-outline','dsh-api-gateway','dsh-api-remotes','dsh-session','dsh-session-projection-cache','dsh-storage-domain','dsh-storage-json','dsh-llm-pi-ai'];
  for (const [name, file] of [...clients.map(name => [name, 'client.js']), ...servers.map(name => [name, 'index.js']), ['dsh-api-gateway', 'client.js']]) {
    const folder = path.join(modules, fullName(name));
    await fs.mkdir(path.join(folder, 'lib'), { recursive: true });
    await fs.copyFile(path.join(root, 'node_modules', fullName(name), 'package.json'), path.join(folder, 'package.json'));
    const target = path.join(folder, 'lib', file);
    await fs.copyFile(sourceFile(name, file), target);
    files[name + '/' + file] = target;
  }
  const market = path.join(modules, 'dsh-plugin-marketplace');
  await fs.mkdir(path.join(market, 'lib'), { recursive: true });
  for (const relative of ['package.json', 'lib/index.js']) await fs.copyFile(path.join(root, 'node_modules/dsh-plugin-marketplace', relative), path.join(market, relative));
  const tools = await import('../scripts/patch-official-runtime.mjs');
  const proof = await import('../scripts/deep-audit-session-core-patch.mjs');
  const conversation = files['dsh-client-ui-conversation/client.js'];
  const raw = tools.restoreModernConversationComposerVisibilitySource(await fs.readFile(conversation, 'utf8'));
  assert.equal(digest(raw), proof.SESSION_CORE_PROOFS[0].input);
  await fs.writeFile(conversation, raw);
  const targets = { conversation, session: files['dsh-api-session-controller/client.js'], attachment: files['dsh-client-ui-attachment/client.js'] };
  return { directory, modules, files, tools, proof, targets, conversation, raw, market: path.join(market, 'lib/index.js') };
}
async function orderedInstall(f) {
  await f.tools.assertInstalledAlpha5NativeCapabilities(f.modules);
  const visibility = await f.tools.patchInstalledModernConversationComposerVisibility(f.conversation);
  const provider = await f.tools.patchInstalledProviderAuthIsolation(f.files['dsh-llm-pi-ai/index.js']);
  const marketplace = await f.tools.patchInstalledMarketplace155(f.market);
  const imageQueue = await f.tools.patchInstalledAlpha5ImageQueuePerformance(f.targets);
  const core = await f.tools.patchInstalledSessionCoreClient(f.conversation);
  return { visibility, provider, marketplace, imageQueue, core };
}

// Execute complete installed bundles, not a copy of the editor algorithm. The
// only export seam and external snapshot/React/Cordis ports mirror the frozen
// core audit harness; no apply(), DOM, network or runtime startup is called.
async function installedShell(f) {
  const store = initial => { let value = initial; const listeners = new Set(); return {
    getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    set: next => { value = typeof next === 'function' ? next(value) : next; for (const fn of listeners) fn(); }
  }; };
  const react = { createContext: () => ({}), memo: fn => fn, forwardRef: fn => fn, Component: class {}, PureComponent: class {}, lazy: fn => fn };
  const external = {
    '@deepseek-ai/cordis': { Service: class { constructor(ctx) { this.ctx = ctx; } }, Context: { filter: Symbol('filter') } },
    '@deepseek-ai/dsh-client-store': { createSnapshotStore: store, notifySubscribers: listeners => { for (const fn of listeners) fn(); } },
    '@deepseek-ai/dsh-client-ui-slots': {}, '@deepseek-ai/dsh-client-ui-primitives': {},
    react, 'react-dom': {}, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  };
  let definition, shell;
  const context = vm.createContext({ window: { __ModuleLoader__: { load: value => { definition = value; } } }, console, queueMicrotask, setTimeout, clearTimeout, AbortController, AbortSignal, crypto: webcrypto, URL, Blob, TextEncoder, TextDecoder, atob, btoa });
  for (const name of ['dsh-api-gateway', 'dsh-api-session-controller', 'dsh-client-ui-conversation']) {
    const file = f.files[name + '/client.js'];
    let source = await fs.readFile(file, 'utf8');
    if (name === 'dsh-client-ui-conversation') {
      assert.equal(digest(source), finalHash, 'behavior comes from the final on-disk temp installer output');
      assert.equal(source.split('return module.exports;').length, 2);
      source = source.replace('return module.exports;', 'exports.auditShell = SessionInputShell; return module.exports;');
    }
    vm.runInContext(source, context, { filename: file, timeout: 3000 });
    const result = definition.factory(id => { assert.ok(Object.hasOwn(external, id), 'unknown external: ' + id); return external[id]; });
    external[fullName(name) + '/client'] = result;
    if (name === 'dsh-client-ui-conversation') shell = result.auditShell;
  }
  return shell;
}

test('core installer follows production composition with provider v4 and marketplace BBA unchanged on replay', async t => {
  const f = await fixture(t);
  assert.deepEqual(await orderedInstall(f), { visibility: true, provider: true, marketplace: true, imageQueue: true, core: true });
  assert.equal(digest(await fs.readFile(f.conversation)), finalHash);
  assert.equal(digest(await fs.readFile(f.files['dsh-llm-pi-ai/index.js'])), '28A7850E44BC24CDD0E5E7222EB0FE655877D1433DB59F8FF435934528BA0207');
  assert.equal(digest(await fs.readFile(f.market)), 'BBA2417FC236501BADF532C76A85673410C5579A5E54D420565C02E963836BDE');
  const before = await fs.readFile(f.conversation);
  assert.deepEqual(await orderedInstall(f), { visibility: false, provider: false, marketplace: false, imageQueue: false, core: false });
  assert.deepEqual(await fs.readFile(f.conversation), before);
  const installer = await fs.readFile(path.join(root, 'scripts/patch-official-runtime.mjs'), 'utf8');
  const queueCall = installer.lastIndexOf('const imageQueuePerformanceChanged = targetsAlpha5 ? await patchInstalledAlpha5ImageQueuePerformance() : false');
  const coreCall = installer.lastIndexOf('const sessionCoreChanged = targetsAlpha5 ? await patchInstalledSessionCoreClient() : false');
  assert.ok(queueCall >= 0 && coreCall > queueCall, 'normal CLI hook follows the tested production order; CLI itself is never executed');
});

test('all four exact core source pairs are idempotent and alternate install order converges', async t => {
  const f = await fixture(t);
  const image = await import('../scripts/image-preview-performance-patch.mjs');
  const queue = await import('../scripts/composer-queue-performance-patch.mjs');
  const withQueue = source => queue.patchComposerQueueConversationSource(image.patchImagePreviewConversationSource(source).source).source.replace(/\r\n?/g, '\n');
  const visible = f.tools.patchModernConversationComposerVisibilitySource(f.raw).source;
  const inputs = [f.raw, visible, withQueue(f.raw), withQueue(visible)];
  for (const [index, source] of inputs.entries()) {
    const proof = f.proof.SESSION_CORE_PROOFS[index];
    assert.equal(digest(source), proof.input);
    await fs.writeFile(f.conversation, source);
    assert.equal(await f.tools.patchInstalledSessionCoreClient(f.conversation), true);
    const output = await fs.readFile(f.conversation, 'utf8');
    assert.equal(digest(output), proof.output);
    assert.equal(await f.tools.patchInstalledSessionCoreClient(f.conversation), false);
    assert.equal(f.proof.restoreSessionCoreClientSource(output), source);
  }
  await fs.writeFile(f.conversation, f.raw);
  await f.tools.patchInstalledSessionCoreClient(f.conversation);
  await f.tools.patchInstalledModernConversationComposerVisibility(f.conversation);
  await f.tools.patchInstalledAlpha5ImageQueuePerformance(f.targets);
  assert.equal(digest(await fs.readFile(f.conversation)), finalHash);
  await f.tools.assertInstalledAlpha5NativeCapabilities(f.modules);
});

test('core installer rejects same-shape foreign hashes, identity/version changes and final drift without writing', async t => {
  const f = await fixture(t);
  const manifest = path.join(path.dirname(f.conversation), '../package.json');
  const beforeManifest = await fs.readFile(manifest, 'utf8');
  for (const replacement of [{ name: 'other-package', version: '0.1.2-alpha.5' }, { name: f.proof.SESSION_CORE_PACKAGE, version: '0.1.2-alpha.6' }]) {
    await fs.writeFile(manifest, JSON.stringify(replacement));
    await assert.rejects(f.tools.patchInstalledSessionCoreClient(f.conversation), /identity\/version changed/);
    assert.equal(await fs.readFile(f.conversation, 'utf8'), f.raw);
  }
  await fs.writeFile(manifest, beforeManifest);
  for (const source of [f.raw + '\n// same-shape foreign source', f.raw.replace(/\n/g, '\r\n')]) {
    await fs.writeFile(f.conversation, source);
    await assert.rejects(f.tools.patchInstalledSessionCoreClient(f.conversation), /hash changed|unsupported source shape/);
    assert.equal(await fs.readFile(f.conversation, 'utf8'), source);
  }
  await fs.writeFile(f.conversation, f.raw);
  await orderedInstall(f);
  const drift = await fs.readFile(f.conversation, 'utf8') + '\n// final drift';
  await fs.writeFile(f.conversation, drift);
  await assert.rejects(f.tools.patchInstalledSessionCoreClient(f.conversation), /hash changed/);
  await assert.rejects(f.tools.patchInstalledAlpha5ImageQueuePerformance(f.targets), /hash changed/);
  await assert.rejects(f.tools.assertInstalledAlpha5NativeCapabilities(f.modules), /hash changed/);
  assert.equal(await fs.readFile(f.conversation, 'utf8'), drift);
});

test('core atomic installer rename failure preserves original bytes and retry succeeds', async t => {
  const f = await fixture(t);
  let renames = 0;
  await assert.rejects(f.tools.patchInstalledSessionCoreClient(f.conversation, { ...fs, rename: async (from, to) => {
    assert.ok(from.startsWith(f.directory + path.sep)); assert.equal(to, f.conversation); renames++;
    throw Object.assign(new Error('fixture rename blocked'), { code: 'EPERM' });
  } }), /fixture rename blocked/);
  assert.equal(renames, 1);
  assert.equal(await fs.readFile(f.conversation, 'utf8'), f.raw);
  assert.deepEqual(await fs.readdir(path.dirname(f.conversation)), ['client.js']);
  assert.equal(await f.tools.patchInstalledSessionCoreClient(f.conversation), true);
});

test('installed composed editor disposes 100 real Lexical queue subscriptions without late publication', async t => {
  const f = await fixture(t); await orderedInstall(f);
  const Shell = await installedShell(f);
  const listeners = new Set(); let releases = 0, late = 0;
  const queue = { getSnapshot: () => [], subscribe: callback => { listeners.add(callback); return () => { releases++; listeners.delete(callback); }; } };
  for (let i = 0; i < 100; i++) {
    const editor = new Shell({ inputTriggers: () => undefined, popup: () => undefined, queue });
    let disposed = false;
    editor.state.subscribe(() => { if (disposed) late++; });
    editor.dispose(); disposed = true; editor.dispose();
  }
  for (const callback of listeners) callback();
  assert.equal(listeners.size, 0); assert.equal(releases, 100); assert.equal(late, 0);
  const noQueue = new Shell({ inputTriggers: () => undefined, popup: () => undefined }); noQueue.dispose(); noQueue.dispose();
  assert.equal(digest(await fs.readFile(sourceFile('dsh-client-ui-conversation'))), f.proof.SESSION_CORE_PROOFS[1].input, 'installed node_modules remains untouched');
});
