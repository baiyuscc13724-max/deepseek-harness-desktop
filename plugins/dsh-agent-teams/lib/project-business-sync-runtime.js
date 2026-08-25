import { createHmac, randomBytes } from "node:crypto";
import { ProjectAutomationCommandService, ProjectAutomationRunner } from "./project-automation-service.js";
import { ProjectAutomationStore } from "./project-automation-store.js";
import { businessRequestDigest, normalizeBusinessSyncMessage, projectSafeBusinessDefinition, projectSafeBusinessLedgerEntry, projectSafeBusinessRun, projectSafeBusinessTask } from "./project-business-sync-domain.js";
import { ProjectBusinessSyncService } from "./project-business-sync-service.js";
import { ProjectBusinessSyncStore } from "./project-business-sync-store.js";
import { ProjectTaskCommandService } from "./project-task-service.js";
import { ProjectTaskStore } from "./project-task-store.js";
import { TASK_TRANSITIONS } from "./project-task-domain.js";

const DEFAULT_PUMP_LIMIT = 100;
const DEFAULT_RETRY_MAX_MS = 30_000;
const DEFAULT_REFRESH_MS = 30_000;
const CONTEXT_ERRORS = new Set(["PROJECT_ENTRY_TASK_CONTEXT_INVALID"]);
const CLOSED_CODE = "PROJECT_BUSINESS_SYNC_RUNTIME_CLOSED";
const REMOTE_TASK_TARGETS = new Set(["backlog", "todo", "in_progress", "canceled"]);

function runtimeError(message, code = "PROJECT_BUSINESS_SYNC_RUNTIME_INVALID") { const error = new Error(message); error.code = code; return error; }
function record(value, field) { if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw runtimeError(`${field} must be a plain object`); return value; }
function text(value, field, max = 256) { if (typeof value !== "string" || value.trim() === "" || value !== value.trim() || value.length > max) throw runtimeError(`${field} is invalid`); return value; }
function integer(value, field, minimum = 0) { if (!Number.isSafeInteger(value) || value < minimum) throw runtimeError(`${field} is invalid`); return value; }
function exact(value, keys, field) { record(value, field); const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors); if (names.some((key) => typeof key !== "string" || !keys.includes(key) || descriptors[key].get || descriptors[key].set || !descriptors[key].enumerable)) throw runtimeError(`${field} contains unsupported fields`); const result = {}; for (const key of names) result[key] = descriptors[key].value; return result; }
function freeze(value) { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function clockMs(clock) { const value = clock(), milliseconds = typeof value === "string" ? Date.parse(value) : value instanceof Date ? value.getTime() : value; if (!Number.isFinite(milliseconds)) throw runtimeError("clock returned an invalid timestamp"); return milliseconds; }
function iso(clock) { return new Date(clockMs(clock)).toISOString(); }
function internalCanonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(internalCanonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${internalCanonical(value[key])}`).join(",")}}`; }
function wipe(value) { try { if (Buffer.isBuffer(value) || value instanceof Uint8Array) Uint8Array.prototype.fill.call(value, 0); } catch {} }
function exactBytes(value, size, field) { if ((!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) || value.byteLength !== size) { wipe(value); throw new TypeError(`${field} must contain exactly ${size} bytes`); } return value; }
function commandIntent(message) { return { commandId: message.commandId, resource: message.resource, action: message.action, ...(message.taskRef === undefined ? {} : { taskRef: message.taskRef }), ...(message.runRef === undefined ? {} : { runRef: message.runRef }), expectedRevision: message.expectedRevision, payload: message.payload }; }
function safeCommandResult(receipt) { if (receipt === undefined) return undefined; const result = { outcome: receipt.outcome, completedAt: receipt.completedAt }; if (receipt.outcome === "rejected") { result.code = receipt.code; result.retryable = receipt.retryable; } else if (receipt.task !== undefined) result.task = receipt.task; else { result.run = receipt.run; result.approval = receipt.approval; } return freeze(result); }
function sameBindingIdentity(left, right) { return left.projectRef === right.projectRef && left.mode === right.mode && left.localDeviceRef === right.localDeviceRef && left.authorityEpoch === right.authorityEpoch && left.filePath === right.filePath; }
function assertOutboundReplay(existing, intent, context) { const expectedDigest = businessRequestDigest(existing.message, { senderDeviceRef: context.localDeviceRef, authorityEpoch: context.authorityEpoch }); if (existing.message.type !== "task.command" || existing.digest !== expectedDigest || internalCanonical(commandIntent(existing.message)) !== internalCanonical(intent)) throw runtimeError("commandId was reused with a different intent", "PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT"); }
function wireTask(task) { return projectSafeBusinessTask({ ...task, createdAt: new Date(task.createdAt).toISOString(), updatedAt: new Date(task.updatedAt).toISOString(), hasAssignee: typeof task.assigneeActorRef === "string" && task.assigneeActorRef !== "", blockedByCount: Array.isArray(task.blockedBy) ? task.blockedBy.length : 0 }); }
function timerCancel(timer) { if (timer === undefined) return; if (typeof timer === "object" && typeof timer.cancel === "function") timer.cancel(); else clearTimeout(timer); }
function safeSignal(listener, signal) { try { const result = listener(signal); if (result && typeof result.then === "function") Promise.resolve(result).catch(() => undefined); } catch {} }

class ProjectBusinessSyncRuntime {
  #binding; #initializing; #rebindPromise; #closing = false; #closed = false; #closePromise; #pump; #pumpQueued = false; #pumpAgain = false; #unsubscribe; #refreshTimer; #retryTimer; #listeners = new Set(); #tracked = new Set(); #generation = 0;
  constructor({ projectEntry, clock = Date.now, scheduler = setTimeout, queueMicrotaskImpl = queueMicrotask, randomBytesImpl = randomBytes, createHmacImpl = createHmac, taskDelegate, automationDelegate, pumpLimit = DEFAULT_PUMP_LIMIT, refreshMs = DEFAULT_REFRESH_MS, retryMaxMs = DEFAULT_RETRY_MAX_MS } = {}) {
    if (typeof projectEntry?.localProjectBusinessSyncContext !== "function" || typeof projectEntry?.subscribeProjectBusinessDelivery !== "function" || typeof projectEntry?.sendProjectBusinessMessage !== "function") throw new TypeError("projectEntry must provide the Host business sync boundary");
    if (typeof clock !== "function" || typeof scheduler !== "function" || typeof queueMicrotaskImpl !== "function" || typeof randomBytesImpl !== "function" || typeof createHmacImpl !== "function") throw new TypeError("runtime clocks and schedulers must be functions");
    this.projectEntry = projectEntry; this.clock = clock; this.scheduler = scheduler; this.queueMicrotaskImpl = queueMicrotaskImpl; this.randomBytesImpl = randomBytesImpl; this.createHmacImpl = createHmacImpl; this.taskDelegate = taskDelegate; this.automationDelegate = automationDelegate;
    this.pumpLimit = integer(pumpLimit, "pumpLimit", 1); if (this.pumpLimit > 500) throw new TypeError("pumpLimit must not exceed 500"); this.refreshMs = integer(refreshMs, "refreshMs", 1); this.retryMaxMs = integer(retryMaxMs, "retryMaxMs", 1);
  }

  initialize() {
    if (this.#closing || this.#closed) return Promise.reject(runtimeError("business sync runtime is closed", CLOSED_CODE));
    if (this.#binding) return Promise.resolve(this.#safeStatus(this.#binding));
    if (this.#rebindPromise) return this.#rebindPromise.then((binding) => this.#safeStatus(binding));
    if (this.#initializing) return this.#initializing;
    this.#initializing = this.#bind().then(async (binding) => { if (this.#closing) { await this.#closeBinding(binding); throw runtimeError("business sync runtime is closed", CLOSED_CODE); } this.#binding = binding; this.#installDelivery(); this.#scheduleRefresh(binding); this.#schedulePump(); return this.#safeStatus(binding); }).catch(async (error) => { const binding = this.#binding; this.#binding = undefined; if (binding) await this.#closeBinding(binding).catch(() => undefined); throw error; }).finally(() => { this.#initializing = undefined; });
    return this.#initializing;
  }

  async recover() { return this.#withBinding(async (binding) => { const recovered = await binding.service.recover({ limit: this.pumpLimit }); if (binding.context.mode === "collaborator") await this.#bootstrapPeers(binding); else this.#queueRunner(binding.authority?.runner); binding.retries.clear(); const pumped = await this.#runPump(); return freeze({ recovered: recovered.recovered, outbound: recovered.outbound.length, sent: pumped.sent, failed: pumped.failed }); }); }
  taskState() { return this.#withBinding((binding) => binding.context.mode === "authority" ? this.#authorityDelegate("task", "state") : this.#collaboratorTaskState(binding)); }
  automationState() { return this.#withBinding((binding) => binding.context.mode === "authority" ? this.#authorityDelegate("automation", "state") : this.#collaboratorAutomationState(binding)); }
  taskAction(input) { return this.#withBinding((binding) => binding.context.mode === "authority" ? this.#authorityDelegate("task", "action", input) : this.#collaboratorAction(binding, "task", input)); }
  automationAction(input) { return this.#withBinding((binding) => binding.context.mode === "authority" ? this.#authorityDelegate("automation", "action", input) : this.#collaboratorAction(binding, "automation", input)); }
  subscribe(listener) { if (typeof listener !== "function") throw new TypeError("listener must be a function"); this.#assertOpen(); this.#listeners.add(listener); let active = true; return () => { if (!active) return false; active = false; this.#listeners.delete(listener); return true; }; }
  toJSON() { const binding = this.#binding; return binding ? this.#safeStatus(binding) : { available: false, closing: this.#closing, closed: this.#closed }; }

  close() {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true; this.#generation += 1; this.#listeners.clear(); timerCancel(this.#refreshTimer); timerCancel(this.#retryTimer); this.#refreshTimer = undefined; this.#retryTimer = undefined;
    let unsubscribeError; try { this.#unsubscribe?.(); } catch (error) { unsubscribeError = error; } this.#unsubscribe = undefined;
    this.#closePromise = (async () => {
      const failures = []; if (unsubscribeError) failures.push(unsubscribeError);
      for (const pending of [this.#rebindPromise, this.#initializing, this.#pump]) if (pending) try { await pending; } catch (error) { if (error?.code !== CLOSED_CODE) failures.push(error); }
      while (this.#tracked.size > 0) { const tracked = [...this.#tracked]; const settled = await Promise.allSettled(tracked); for (const item of settled) if (item.status === "rejected" && item.reason?.code !== CLOSED_CODE) failures.push(item.reason); }
      const binding = this.#binding; this.#binding = undefined;
      if (binding) { try { await this.#drainAccepted(binding); } catch (error) { failures.push(error); } try { await this.#closeBinding(binding); } catch (error) { failures.push(error); } }
      this.#closed = true;
      if (failures.length > 0) throw new AggregateError(failures, "business sync runtime close failed");
    })();
    return this.#closePromise;
  }

  async #bind() {
    const context = await this.projectEntry.localProjectBusinessSyncContext(); let store, service, authority, refKey, bootNonce, providedStoreKey, providedRefKey, randomNonce;
    try {
      providedStoreKey = exactBytes(context.keyProvider(context.projectRef), 32, "sync encryption key"); const storeKey = Buffer.from(providedStoreKey); wipe(providedStoreKey); providedStoreKey = undefined;
      try { store = new ProjectBusinessSyncStore({ projectRef: context.projectRef, filePath: context.filePath, encryptionKey: storeKey, mode: context.mode, authorityEpoch: context.authorityEpoch }); }
      finally { wipe(storeKey); }
      randomNonce = exactBytes(this.randomBytesImpl(16), 16, "randomBytesImpl result"); bootNonce = Buffer.from(randomNonce); wipe(randomNonce); randomNonce = undefined;
      providedRefKey = exactBytes(context.keyProvider(context.projectRef), 32, "sync reference key"); refKey = Buffer.from(providedRefKey); wipe(providedRefKey); providedRefKey = undefined;
      let helloSequence = 0;
      const refFactory = (kind, scope) => {
        const runtimeNonce = Buffer.from(bootNonce).toString("base64url"), material = kind === "reset" ? { bootNonce: runtimeNonce, scope } : kind === "hello" ? { bootNonce: runtimeNonce, sequence: helloSequence++, scope } : scope;
        return `sync_${kind}_${this.createHmacImpl("sha256", refKey).update("dsh/project-business-runtime-ref/v1\0").update(kind).update("\0").update(internalCanonical(material)).digest("base64url")}`;
      };
      if (context.mode === "authority") authority = await this.#bindAuthority(context, refFactory, refKey);
      await store.load();
      service = new ProjectBusinessSyncService({ projectRef: context.projectRef, localDeviceRef: context.localDeviceRef, authorityEpoch: context.authorityEpoch, mode: context.mode, store, peerResolver: context.peerResolver, refFactory, clock: this.clock, ...(authority === undefined ? {} : authority.serviceOptions) });
      const binding = { context, store, service, authority, refKey, bootNonce, capabilities: new Map(), persistedCapability: undefined, persistedCapabilityPeer: undefined, pendingCapabilities: new Map(), retries: new Map() };
      if (context.mode === "collaborator") { const restored = (await store.getCollaboratorCapability()).capability, peers = await context.peerDeviceRefs(), loaded = await store.load(); if (restored !== undefined && peers.length === 1 && loaded.state.peerCursors.some((peer) => peer.peerDeviceRef === peers[0] && peer.resetToken === restored.resetToken && peer.capability !== null)) { binding.persistedCapability = restored; binding.persistedCapabilityPeer = peers[0]; } for (const peerDeviceRef of peers) if (!loaded.state.outbox.some((entry) => entry.targetDeviceRef === peerDeviceRef && entry.message.type === "hello")) await binding.service.bootstrap({ peerDeviceRef }); }
      else this.#queueRunner(authority.runner);
      return binding;
    } catch (error) {
      if (service) await service.close().catch(() => undefined); else await store?.close().catch(() => undefined); await authority?.close?.().catch(() => undefined); wipe(refKey); wipe(bootNonce); try { context.dispose(); } catch {} throw error;
    } finally { wipe(providedStoreKey); wipe(providedRefKey); wipe(randomNonce); }
  }

  async #bindAuthority(syncContext, refFactory, syncRefKey) {
    const task = await this.projectEntry.localProjectTaskContext(); let automation, taskStore, automationStore, runner;
    try {
      automation = await this.projectEntry.localProjectAutomationContext();
      if (task.projectRef !== syncContext.projectRef || automation.projectRef !== syncContext.projectRef) throw runtimeError("project contexts do not match");
      taskStore = new ProjectTaskStore({ filePath: task.databasePath, keyProvider: task.keyProvider }); taskStore.initialize();
      const peerExecutions = new WeakMap();
      const actorResolver = (execution, projectRef) => { const peer = peerExecutions.get(execution); if (!peer) throw runtimeError("remote task execution is invalid", "PROJECT_TASK_ACTOR_UNRESOLVED"); return { projectRef, actorRef: peer.collaboratorRef, kind: "human", role: peer.role, authorities: [] }; };
      const taskService = new ProjectTaskCommandService({ store: taskStore, actorResolver, now: this.clock });
      const taskCommand = (stable) => ({ projectRef: syncContext.projectRef, commandId: stable.commandId, eventRef: stable.eventRef, type: stable.action, taskRef: stable.taskRef, expectedRevision: stable.expectedRevision, payload: stable.payload ?? {} });
      const taskExecution = async (stable) => { await task.actorResolver(task.execution, syncContext.projectRef); const execution = Object.freeze(Object.create(null)); peerExecutions.set(execution, stable.trustedPeer); return execution; };
      const taskExecutor = {
        getCommandReceipt: async (stable) => { const execution = await taskExecution(stable), receipt = await taskService.getCommandOutcome(execution, taskCommand(stable)); return receipt === undefined ? undefined : { task: wireTask(receipt.task), completedAt: new Date(receipt.task.updatedAt).toISOString() }; },
        execute: async (stable) => { const execution = await taskExecution(stable), receipt = taskService.executeCommand(execution, taskCommand(stable)); return { task: wireTask(receipt.task), completedAt: new Date(receipt.task.updatedAt).toISOString() }; },
      };
      const providedAutomationKey = exactBytes(automation.keyProvider(automation.projectRef), 32, "automation encryption key"), automationKey = Buffer.from(providedAutomationKey); wipe(providedAutomationKey);
      try { automationStore = new ProjectAutomationStore({ projectRef: automation.projectRef, filePath: automation.filePath, encryptionKey: automationKey }); } finally { wipe(automationKey); }
      const automationExecutions = new WeakMap();
      const automationService = new ProjectAutomationCommandService({ store: automationStore, projectRef: automation.projectRef, actorResolver: (execution, projectRef) => { const peer = automationExecutions.get(execution); if (!peer) throw runtimeError("remote automation execution is invalid", "PROJECT_AUTOMATION_APPROVAL_FORBIDDEN"); return { projectRef, actorRef: peer.collaboratorRef, kind: "human", role: peer.role }; }, refFactory: (kind, commandId) => refFactory(`automation-${kind}`, { commandId }), now: this.clock });
      const systemExecution = Object.freeze(Object.create(null)), systemActorRef = `system_${this.createHmacImpl("sha256", syncRefKey).update("dsh/project-business-runtime-system/v1\0").update(syncContext.projectRef).digest("base64url")}`;
      const systemTaskService = new ProjectTaskCommandService({ store: taskStore, actorResolver: (execution, projectRef) => { if (execution !== systemExecution) throw runtimeError("automation runner execution is invalid", "PROJECT_TASK_ACTOR_UNRESOLVED"); return { projectRef, actorRef: systemActorRef, kind: "system", authorities: [] }; }, now: this.clock });
      const runnerTaskService = { getCommandReceipt: async (execution, command) => { await task.actorResolver(task.execution, syncContext.projectRef); return systemTaskService.getCommandReceipt(execution, command); }, executeCommand: async (execution, command) => { await task.actorResolver(task.execution, syncContext.projectRef); return systemTaskService.executeCommand(execution, command); } };
      runner = new ProjectAutomationRunner({ store: automationStore, taskService: runnerTaskService, taskExecution: systemExecution, projectRef: syncContext.projectRef, refFactory: (kind, commandId) => refFactory(`runner-${kind}`, { commandId }), now: this.clock });
      const automationCommand = async (stable, execute) => { await automation.actorResolver(automation.execution, syncContext.projectRef); const execution = Object.freeze(Object.create(null)); automationExecutions.set(execution, stable.trustedPeer); const input = { commandId: stable.commandId, type: stable.action, runRef: stable.runRef, expectedRevision: stable.expectedRevision, payload: stable.payload ?? {} }; let receipt; try { receipt = await (execute ? automationService.executeCommand(execution, input) : automationService.getCommandReceipt(execution, input)); } catch (error) { if (error?.receipt?.outcome === "rejected") return { outcome: "rejected", code: error.receipt.errorCode }; throw error; } if (receipt === undefined) return undefined; if (execute && stable.action === "approve" && receipt.run?.status === "queued") this.#queueRunner(runner); return { run: receipt.run, approval: receipt.approval === undefined ? undefined : { decision: receipt.approval.decision, decidedAt: receipt.approval.decidedAt }, completedAt: receipt.approval?.decidedAt ?? receipt.run?.createdAt }; };
      const automationExecutor = {
        getCommandReceipt: (stable) => automationCommand(stable, false),
        execute: (stable) => automationCommand(stable, true),
      };
      const taskEventProvider = this.#taskProvider(syncContext.projectRef, taskStore);
      const automationLedgerProvider = this.#automationProvider(automationStore);
      return { runner, serviceOptions: { taskExecutor, automationExecutor, taskEventProvider, automationLedgerProvider }, async close() { const failures = []; for (const operation of [() => runner.close(), () => automationStore.close(), () => taskStore.close(), () => automation.dispose(), () => task.dispose()]) try { await operation(); } catch (error) { failures.push(error); } if (failures.length > 0) throw new AggregateError(failures, "authority business sync cleanup failed"); } };
    } catch (error) {
      try { await runner?.close(); } catch {} try { await automationStore?.close(); } catch {} try { taskStore?.close(); } catch {} try { automation?.dispose(); } catch {} try { task.dispose(); } catch {} throw error;
    }
  }

  #taskProvider(projectRef, store) { return {
    currentCursor: async () => store.getProjectRevision(projectRef),
    readEvents: async ({ afterCursor, limit }) => { const rows = store.listEvents({ projectRef, afterRevision: afterCursor, limit: Math.min(limit + 1, 500) }), selected = rows.slice(0, limit); return { gap: afterCursor > store.getProjectRevision(projectRef), hasMore: rows.length > limit, events: selected.map((event) => ({ cursor: event.projectRevision, type: event.type, occurredAt: new Date(event.createdAt).toISOString(), task: wireTask(store.getTask({ projectRef, taskRef: event.taskRef })) })) }; },
    readSnapshot: async ({ offset, limit }) => { const snapshot = store.readTaskSnapshot({ projectRef, limit: 500 }), tasks = [...snapshot.tasks].sort((a, b) => a.taskRef.localeCompare(b.taskRef)); return { cursor: snapshot.projectRevision, totalItems: tasks.length, items: tasks.slice(offset, offset + limit).map((task) => ({ task: wireTask(task) })) }; },
  }; }
  #automationProvider(store) { return {
    currentCursor: async () => { const loaded = await store.load(); return loaded.document.ledger.at(-1)?.sequence ?? 0; },
    readEvents: async ({ afterCursor, limit }) => { const loaded = await store.load(), rows = loaded.document.ledger.filter((entry) => entry.sequence > afterCursor), selected = rows.slice(0, limit); return { gap: afterCursor > (loaded.document.ledger.at(-1)?.sequence ?? 0), hasMore: rows.length > limit, events: selected.map((ledger) => { const run = ledger.runRef === undefined ? undefined : loaded.document.runs.find((item) => item.runRef === ledger.runRef), definition = run === undefined && ledger.definitionRef !== undefined ? loaded.document.definitions.find((item) => item.definitionRef === ledger.definitionRef) : undefined; return { cursor: ledger.sequence, type: ledger.type, occurredAt: ledger.occurredAt, ledger: projectSafeBusinessLedgerEntry(ledger), ...(run === undefined ? {} : { run: projectSafeBusinessRun(run) }), ...(definition === undefined ? {} : { definition: projectSafeBusinessDefinition(definition) }) }; }) }; },
    readSnapshot: async ({ offset, limit }) => { const loaded = await store.load(), cursor = loaded.document.ledger.at(-1)?.sequence ?? 0, items = [...loaded.document.definitions.map((definition) => ({ definition: projectSafeBusinessDefinition(definition) })), ...loaded.document.runs.map((run) => ({ run: projectSafeBusinessRun(run) })), ...loaded.document.ledger.map((ledger) => ({ ledger: projectSafeBusinessLedgerEntry(ledger) }))]; return { cursor, totalItems: items.length, items: items.slice(offset, offset + limit) }; },
  }; }

  #installDelivery() {
    if (this.#unsubscribe) return;
    this.#unsubscribe = this.projectEntry.subscribeProjectBusinessDelivery((delivery) => {
      const binding = this.#binding; if (!binding || this.#closing) return;
      try {
        const message = normalizeBusinessSyncMessage(delivery.payload);
        const queued = binding.service.enqueue({ message, opened: { senderDeviceRef: delivery.senderDeviceRef, authorityEpoch: delivery.authorityEpoch } });
        if (message.type === "capability" && binding.context.mode === "collaborator") binding.pendingCapabilities.set(queued.workRef, { senderDeviceRef: delivery.senderDeviceRef, message });
        this.#schedulePump();
      } catch {}
    });
  }
  #schedulePump() { if (this.#pumpQueued || this.#closing) return; this.#pumpQueued = true; const generation = this.#generation; try { this.queueMicrotaskImpl(() => { this.#pumpQueued = false; if (this.#closing || generation !== this.#generation) return; this.#track(this.#runPump()).catch(() => undefined); }); } catch (error) { this.#pumpQueued = false; throw error; } }
  #runPump() {
    if (this.#pump) { this.#pumpAgain = true; return this.#pump; }
    this.#pumpAgain = false;
    this.#pump = this.#pumpOnce().finally(() => { this.#pump = undefined; if (this.#pumpAgain && !this.#closing) this.#schedulePump(); });
    return this.#pump;
  }
  #pumpOnce() { return this.#withBinding(async (binding) => {
    const processed = await binding.service.process({ limit: this.pumpLimit });
    if (processed.remaining > 0) this.#pumpAgain = true;
    for (const result of processed.results) {
      const pending = binding.pendingCapabilities.get(result.workRef);
      if (pending !== undefined) { if (result.ok) { binding.capabilities.set(pending.senderDeviceRef, pending.message); binding.persistedCapability = pending.message; binding.persistedCapabilityPeer = pending.senderDeviceRef; } binding.pendingCapabilities.delete(result.workRef); }
    }
    const scanLimit = integer(binding.service.maxQueue ?? this.pumpLimit, "service.maxQueue", this.pumpLimit), outbound = await binding.service.pendingOutbound({ limit: scanLimit }), liveRefs = new Set(outbound.entries.map((entry) => entry.messageRef)), now = clockMs(this.clock);
    for (const messageRef of binding.retries.keys()) if (!liveRefs.has(messageRef)) binding.retries.delete(messageRef);
    let sent = 0, failed = 0, attempted = 0, nextDelay, deferredEligible = false;
    for (const entry of outbound.entries) {
      const retry = binding.retries.get(entry.messageRef) ?? { attempt: 0, nextAt: 0 };
      if (retry.nextAt > now) { const delay = retry.nextAt - now; nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay); continue; }
      if (attempted >= this.pumpLimit) { deferredEligible = true; continue; }
      attempted += 1;
      try {
        const active = await this.#sendEntry(binding, entry); sent += 1;
        if (entry.message.type === "ack") { await active.service.completeOutboundDelivery({ targetDeviceRef: entry.targetDeviceRef, messageRef: entry.messageRef, digest: entry.digest }); active.retries.delete(entry.messageRef); this.#pumpAgain = true; continue; }
        const attempt = retry.attempt + 1, delay = Math.min(this.retryMaxMs, 1_000 * (2 ** Math.min(attempt - 1, 10))); active.retries.set(entry.messageRef, { attempt, nextAt: now + delay }); nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
      } catch {
        failed += 1; const active = this.#binding ?? binding, attempt = retry.attempt + 1, delay = Math.min(this.retryMaxMs, 1_000 * (2 ** Math.min(attempt - 1, 10)));
        if (!this.#closing) active.retries.set(entry.messageRef, { attempt, nextAt: now + delay }); nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
      }
    }
    if (deferredEligible) this.#pumpAgain = true;
    if (nextDelay !== undefined) this.#scheduleRetry(this.#binding ?? binding, nextDelay);
    else { timerCancel(this.#retryTimer); this.#retryTimer = undefined; }
    if (processed.processed > 0 || sent > 0) this.#publish();
    return freeze({ processed: processed.processed, sent, failed, pending: outbound.entries.length });
  }); }
  async #sendEntry(binding, entry) { let active = binding; for (let attempt = 0; attempt < 2; attempt += 1) { try { const peers = await active.context.peerDeviceRefs(); if (!peers.includes(entry.targetDeviceRef)) throw runtimeError("business sync target is no longer authorized", "PROJECT_BUSINESS_SYNC_FORBIDDEN"); const result = await this.projectEntry.sendProjectBusinessMessage({ targetDeviceRef: entry.targetDeviceRef, message: entry.message }); if (result?.queued !== true || result.targetDeviceRef !== entry.targetDeviceRef) throw runtimeError("Host did not queue the exact business sync target", "PROJECT_BUSINESS_SYNC_TRANSPORT_UNAVAILABLE"); return active; } catch (error) { if (attempt !== 0 || !CONTEXT_ERRORS.has(error?.code)) throw error; active = await this.#rebindFrom(active); } } }
  #scheduleRetry(binding, delay) { if (this.#closing || binding !== this.#binding) return; timerCancel(this.#retryTimer); this.#retryTimer = this.scheduler(() => { this.#retryTimer = undefined; if (!this.#closing && binding === this.#binding) this.#schedulePump(); }, Math.max(1, Math.min(this.retryMaxMs, Math.ceil(delay)))); this.#retryTimer?.unref?.(); }
  #scheduleRefresh(binding) { if (this.#refreshTimer || this.#closing) return; this.#refreshTimer = this.scheduler(() => { this.#refreshTimer = undefined; if (this.#closing || binding !== this.#binding) return; const refresh = (async () => { try { if (binding.context.mode === "collaborator") await this.#bootstrapPeers(binding); await binding.service.recover({ limit: this.pumpLimit }); this.#schedulePump(); } finally { this.#scheduleRefresh(binding); } })(); this.#track(refresh).catch(() => undefined); }, this.refreshMs); this.#refreshTimer?.unref?.(); }
  async #bootstrapPeers(binding) { const peers = await binding.context.peerDeviceRefs(), loaded = await binding.store.load(); for (const peerDeviceRef of peers) if (!loaded.state.outbox.some((entry) => entry.targetDeviceRef === peerDeviceRef && entry.message.type === "hello")) await binding.service.bootstrap({ peerDeviceRef }); }

  async #collaboratorTaskState(binding) { if (binding.context.mode !== "collaborator") throw runtimeError("authority task state requires a local delegate", "PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE"); const loaded = await binding.store.load(), capability = await this.#capability(binding), actions = capability?.taskCommands ?? []; return freeze({ capability: this.#safeCapability(binding, capability), tasks: loaded.state.safeCache.tasks.map((task) => ({ ...task, allowedActions: this.#taskActions(task, actions) })) }); }
  async #collaboratorAutomationState(binding) { if (binding.context.mode !== "collaborator") throw runtimeError("authority automation state requires a local delegate", "PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE"); const loaded = await binding.store.load(), capability = await this.#capability(binding), actions = capability?.automationCommands ?? []; return freeze({ capability: this.#safeCapability(binding, capability), definitions: loaded.state.safeCache.definitions, runs: loaded.state.safeCache.runs.map((run) => ({ ...run, allowedActions: run.status === "awaiting_approval" ? actions.filter((action) => ["approve", "reject"].includes(action)) : [] })), recentLedger: loaded.state.safeCache.ledger.slice(-100) }); }
  async #capability(binding) { const peers = await binding.context.peerDeviceRefs(); if (peers.length !== 1) return undefined; return binding.capabilities.get(peers[0]) ?? (binding.persistedCapabilityPeer === peers[0] ? binding.persistedCapability : undefined); }
  #safeCapability(binding, capability) { return freeze({ available: capability !== undefined, mode: binding.context.mode, writable: capability?.writable === true, taskCommands: [...(capability?.taskCommands ?? [])], automationCommands: [...(capability?.automationCommands ?? [])] }); }
  #taskActions(task, serverActions) { const result = []; if (serverActions.includes("claim") && task.status === "todo" && !task.hasAssignee) result.push("claim"); if (serverActions.includes("transition") && (TASK_TRANSITIONS[task.status] ?? []).some((target) => REMOTE_TASK_TARGETS.has(target))) result.push("transition"); return freeze(result); }

  async #collaboratorAction(binding, resource, input) {
    if (binding.context.mode !== "collaborator") throw runtimeError("authority actions require a local delegate", "PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE");
    const command = exact(input, ["commandId", "type", "taskRef", "runRef", "expectedRevision", "payload"], `${resource} action`), commandId = text(command.commandId, "commandId"), action = text(command.type, "type", 64), expectedRevision = integer(command.expectedRevision, "expectedRevision", 1), payload = command.payload ?? {}; record(payload, "payload");
    const peers = await binding.context.peerDeviceRefs(); if (peers.length !== 1) throw runtimeError("authority sync peer is unavailable", "PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE"); const targetDeviceRef = peers[0], capability = binding.capabilities.get(targetDeviceRef) ?? (binding.persistedCapabilityPeer === targetDeviceRef ? binding.persistedCapability : undefined); if (!capability?.writable) throw runtimeError("remote project is not writable", "PROJECT_BUSINESS_SYNC_FORBIDDEN");
    let scope, safePayload;
    if (resource === "task") { if (Object.hasOwn(command, "runRef")) throw runtimeError("task action contains an automation reference"); if (!capability.taskCommands.includes(action) || !["claim", "transition"].includes(action)) throw runtimeError("task action is unavailable", "PROJECT_BUSINESS_SYNC_FORBIDDEN"); scope = { taskRef: text(command.taskRef, "taskRef") }; safePayload = exact(payload, action === "claim" ? [] : ["to"], "task payload"); if (action === "transition" && !REMOTE_TASK_TARGETS.has(text(safePayload.to, "payload.to", 64))) throw runtimeError("remote task transition is unavailable", "PROJECT_BUSINESS_SYNC_FORBIDDEN"); }
    else { if (Object.hasOwn(command, "taskRef")) throw runtimeError("automation action contains a task reference"); if (!capability.automationCommands.includes(action) || !["approve", "reject"].includes(action)) throw runtimeError("automation action is unavailable", "PROJECT_BUSINESS_SYNC_FORBIDDEN"); scope = { runRef: text(command.runRef, "runRef") }; safePayload = exact(payload, action === "approve" ? [] : ["reasonCode"], "automation payload"); if (safePayload.reasonCode !== undefined) text(safePayload.reasonCode, "payload.reasonCode", 500); }
    const intent = { commandId, resource, action, ...scope, expectedRevision, payload: safePayload }, existing = await binding.store.getOutboundCommand({ targetDeviceRef, commandId });
    if (existing.status !== "absent") return this.#existingActionResult(binding, existing, intent);
    const loaded = await binding.store.load();
    if (resource === "task") { const task = loaded.state.safeCache.tasks.find((item) => item.taskRef === scope.taskRef); if (!task || task.revision !== expectedRevision || !this.#taskActions(task, capability.taskCommands).includes(action)) throw runtimeError("cached task changed", "PROJECT_BUSINESS_SYNC_CONFLICT"); if (action === "transition" && !(TASK_TRANSITIONS[task.status] ?? []).includes(safePayload.to)) throw runtimeError("remote task transition is unavailable", "PROJECT_BUSINESS_SYNC_FORBIDDEN"); }
    else { const run = loaded.state.safeCache.runs.find((item) => item.runRef === scope.runRef); if (!run || run.revision !== expectedRevision || run.status !== "awaiting_approval") throw runtimeError("cached automation run changed", "PROJECT_BUSINESS_SYNC_CONFLICT"); }
    const message = normalizeBusinessSyncMessage({ version: 1, type: "task.command", messageRef: this.#bindingRef(binding, "request", { targetDeviceRef, commandId, resource }), sentAt: iso(this.clock), ...intent }), requestDigest = businessRequestDigest(message, { senderDeviceRef: binding.context.localDeviceRef, authorityEpoch: binding.context.authorityEpoch });
    for (let attempt = 0; attempt < 4; attempt += 1) { const current = await binding.store.load(); try { await binding.store.enqueueOutbox({ targetDeviceRef, message, digest: requestDigest, expectedRevision: current.revision, queuedAt: message.sentAt }); this.#schedulePump(); return freeze({ queued: true, commandId, resource }); } catch (error) { if (error?.code === "PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT") { const raced = await binding.store.getOutboundCommand({ targetDeviceRef, commandId }); if (raced.status !== "absent") return this.#existingActionResult(binding, raced, intent); } if (error?.code !== "PROJECT_BUSINESS_SYNC_STORE_CONFLICT" || attempt === 3) throw error; } }
    throw runtimeError("business command store stayed busy", "PROJECT_BUSINESS_SYNC_STORE_CONFLICT");
  }
  #existingActionResult(binding, existing, intent) { assertOutboundReplay(existing, intent, binding.context); if (existing.status === "pending") this.#schedulePump(); const result = safeCommandResult(existing.result); return freeze({ queued: existing.status === "pending", commandId: intent.commandId, resource: intent.resource, ...(result === undefined ? {} : { result }) }); }
  #bindingRef(binding, kind, scope) { return `sync_${kind}_${this.createHmacImpl("sha256", binding.refKey).update("dsh/project-business-runtime-ref/v1\0").update(kind).update("\0").update(internalCanonical(scope)).digest("base64url")}`; }

  #authorityDelegate(resource, operation, input) { const delegate = resource === "task" ? this.taskDelegate : this.automationDelegate; if (typeof delegate?.[operation] !== "function") throw runtimeError(`authority ${resource} ${operation} is unavailable`, "PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE"); return input === undefined ? delegate[operation]() : delegate[operation](input); }
  #track(promise) { const tracked = Promise.resolve(promise); this.#tracked.add(tracked); const release = () => this.#tracked.delete(tracked); tracked.then(release, release); return tracked; }
  #queueRunner(runner) { if (!runner || this.#closing) return; let resolve, reject; const queued = new Promise((accept, decline) => { resolve = accept; reject = decline; }); this.#track(queued).catch(() => undefined); try { this.queueMicrotaskImpl(() => { if (this.#closing) { resolve(); return; } Promise.resolve(runner.pump({ limit: this.pumpLimit })).then((result) => { resolve(result); if (result.processed >= this.pumpLimit) this.#queueRunner(runner); }, reject); }); } catch (error) { reject(error); } }
  #safeStatus(binding) { return freeze({ available: true, mode: binding.context.mode, closing: this.#closing, closed: this.#closed }); }
  #publish() { const signal = freeze({ type: "refetch" }); for (const listener of [...this.#listeners]) safeSignal(listener, signal); }
  async #withBinding(operation) { this.#assertOpen(); const binding = this.#binding ?? (await (this.#rebindPromise ?? this.initialize()), this.#binding); try { await binding.context.peerDeviceRefs(); return await operation(binding); } catch (error) { if (!CONTEXT_ERRORS.has(error?.code)) throw error; const rebound = await this.#rebindFrom(binding); await rebound.context.peerDeviceRefs(); return operation(rebound); } }
  #rebindFrom(stale) { if (this.#rebindPromise) return this.#rebindPromise; const identity = { projectRef: stale.context.projectRef, mode: stale.context.mode, localDeviceRef: stale.context.localDeviceRef, authorityEpoch: stale.context.authorityEpoch, filePath: stale.context.filePath }; const operation = (async () => { if (this.#binding === stale) await this.#invalidate(stale); const rebound = await this.#bind(); if (!sameBindingIdentity(identity, rebound.context)) { await this.#closeBinding(rebound); throw runtimeError("business sync identity changed during context refresh", "PROJECT_BUSINESS_SYNC_CONTEXT_CHANGED"); } if (this.#closing) { await this.#closeBinding(rebound); throw runtimeError("business sync runtime is closed", CLOSED_CODE); } this.#binding = rebound; this.#installDelivery(); this.#scheduleRefresh(rebound); this.#schedulePump(); return rebound; })(); this.#rebindPromise = operation.finally(() => { this.#rebindPromise = undefined; }); return this.#rebindPromise; }
  async #invalidate(binding) { if (this.#binding === binding) this.#binding = undefined; this.#generation += 1; timerCancel(this.#refreshTimer); timerCancel(this.#retryTimer); this.#refreshTimer = undefined; this.#retryTimer = undefined; await this.#closeBinding(binding); this.#publish(); }
  async #drainAccepted(binding) {
    const failures = [], maximum = binding.service.maxQueue ?? this.pumpLimit;
    try { await binding.service.process({ limit: maximum }); } catch (error) { failures.push(error); }
    if (binding.authority?.runner) try { const rounds = Math.ceil(maximum / this.pumpLimit) + 1; for (let round = 0; round < rounds; round += 1) { const result = await binding.authority.runner.pump({ limit: this.pumpLimit }); if (result.processed < this.pumpLimit) break; } } catch (error) { failures.push(error); }
    try { await binding.service.recover({ limit: maximum }); } catch (error) { failures.push(error); }
    try { const outbound = await binding.service.pendingOutbound({ limit: maximum }); for (const entry of outbound.entries) try { await this.projectEntry.sendProjectBusinessMessage({ targetDeviceRef: entry.targetDeviceRef, message: entry.message }); if (entry.message.type === "ack") await binding.service.completeOutboundDelivery({ targetDeviceRef: entry.targetDeviceRef, messageRef: entry.messageRef, digest: entry.digest }); } catch {} } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new AggregateError(failures, "accepted business sync work did not fully drain");
  }
  async #closeBinding(binding) { const failures = []; for (const operation of [() => binding.service.close(), () => binding.authority?.close?.(), () => binding.context.dispose()]) try { await operation(); } catch (error) { failures.push(error); } binding.capabilities.clear(); binding.persistedCapability = undefined; binding.persistedCapabilityPeer = undefined; binding.pendingCapabilities.clear(); binding.retries.clear(); wipe(binding.refKey); wipe(binding.bootNonce); if (failures.length > 0) throw new AggregateError(failures, "business sync binding cleanup failed"); }
  #assertOpen() { if (this.#closing || this.#closed) throw runtimeError("business sync runtime is closed", CLOSED_CODE); }
}

export { ProjectBusinessSyncRuntime };
