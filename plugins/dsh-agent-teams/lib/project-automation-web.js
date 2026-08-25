import { createHash, createHmac } from "node:crypto";
import { ProjectAutomationStore } from "./project-automation-store.js";
import { ProjectAutomationCommandService, ProjectAutomationRunner } from "./project-automation-service.js";
import { TASK_TRANSITIONS } from "./project-task-domain.js";
import { ProjectTaskCommandService } from "./project-task-service.js";
import { ProjectTaskStore } from "./project-task-store.js";

const MAX_AUTOMATION_WEB_COMMAND_BYTES = 64 * 1024;
const MAX_AUTOMATION_WEB_DEPTH = 16;
const AUTOMATION_WEB_TYPES = Object.freeze(["definition.create", "definition.update", "manual_run", "approve", "reject", "retry", "cancel"]);
const TYPE_SET = new Set(AUTOMATION_WEB_TYPES);
const COMMAND_KEYS = new Set(["commandId", "type", "definitionRef", "runRef", "expectedRevision", "payload"]);
const PAYLOAD_KEYS = Object.freeze({
  "definition.create": new Set(["name", "taskRef", "targetStatus", "blockReason"]),
  "definition.update": new Set(["status"]), manual_run: new Set(["taskRevision"]),
  approve: new Set(), reject: new Set(), retry: new Set(), cancel: new Set(),
});
const FORBIDDEN_KEYS = new Set(["projectref", "eventref", "triggerref", "approvalref", "ledgerref", "ledgerentryref", "actorref", "sessionid", "role", "authority", "authorities"]);
const CONTEXT_ERRORS = new Set(["PROJECT_ENTRY_TASK_CONTEXT_INVALID"]);
const UNAVAILABLE_ERRORS = new Set(["PROJECT_ENTRY_NOT_CREATED", "PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN"]);
const TARGETS = new Set(["backlog", "todo", "in_progress", "blocked", "canceled"]);

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function webError(message, code = "PROJECT_AUTOMATION_WEB_INVALID_REQUEST", details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }
function keyName(value) { return value.replaceAll(/[-_]/gu, "").toLowerCase(); }
function assertSafeValue(value, field = "body", depth = 0, ancestors = new Set()) {
  if (depth > MAX_AUTOMATION_WEB_DEPTH) throw webError(`${field} exceeds maximum depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value) || Object.is(value, -0)) throw webError(`${field} contains a non-lossless number`); return; }
  if (typeof value !== "object" || ancestors.has(value)) throw webError(`${field} must be acyclic lossless JSON`);
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
  if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype && prototype !== null)) throw webError(`${field} must contain plain JSON only`);
  if (keys.some((key) => typeof key !== "string")) throw webError(`${field} contains symbol properties`);
  ancestors.add(value);
  try {
    if (array) {
      const elementKeys = keys.filter((key) => key !== "length");
      if (elementKeys.length !== value.length) throw webError(`${field} must not be sparse or custom`);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw webError(`${field}[${index}] must be an enumerable data property`);
        assertSafeValue(descriptor.value, `${field}[${index}]`, depth + 1, ancestors);
      }
    } else for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw webError(`${field}.${key} must be an enumerable data property`);
      if (FORBIDDEN_KEYS.has(keyName(key))) throw webError(`${field} contains forbidden field ${key}`);
      assertSafeValue(descriptor.value, `${field}.${key}`, depth + 1, ancestors);
    }
  } finally { ancestors.delete(value); }
}
function encodeSafeJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((_, index) => encodeSafeJson(Object.getOwnPropertyDescriptor(value, String(index)).value)).join(",")}]`;
  return `{${Object.keys(value).map((key) => `${JSON.stringify(key)}:${encodeSafeJson(Object.getOwnPropertyDescriptor(value, key).value)}`).join(",")}}`;
}
function text(value, field, max = 256) { if (typeof value !== "string" || value.trim() === "" || value.length > max) throw webError(`${field} is invalid`); return value.trim(); }
function revision(value, field, minimum = 1) { if (!Number.isSafeInteger(value) || value < minimum) throw webError(`${field} is invalid`); return value; }
function normalizeAutomationWebCommand(input) {
  assertSafeValue(input);
  if (!isRecord(input)) throw webError("body must be an object");
  const encoded = encodeSafeJson(input);
  if (Buffer.byteLength(encoded, "utf8") > MAX_AUTOMATION_WEB_COMMAND_BYTES) throw webError("body is too large", "PROJECT_AUTOMATION_WEB_BODY_TOO_LARGE");
  const extras = Object.keys(input).filter((key) => !COMMAND_KEYS.has(key));
  if (extras.length) throw webError("body contains unsupported fields");
  const type = text(input.type, "type", 64); if (!TYPE_SET.has(type)) throw webError("type is unsupported");
  const payload = input.payload ?? {}; if (!isRecord(payload)) throw webError("payload must be an object");
  if (Object.keys(payload).some((key) => !PAYLOAD_KEYS[type].has(key))) throw webError("payload contains unsupported fields");
  const result = { commandId: text(input.commandId, "commandId"), type, expectedRevision: revision(input.expectedRevision, "expectedRevision", type === "definition.create" ? 0 : 1), payload: JSON.parse(encodeSafeJson(payload)) };
  if (type === "definition.create") {
    if (input.expectedRevision !== 0 || input.definitionRef !== undefined || input.runRef !== undefined) throw webError("definition.create shape is invalid");
    result.expectedRevision = 0; text(payload.name, "payload.name", 200); text(payload.taskRef, "payload.taskRef"); if (!TARGETS.has(payload.targetStatus)) throw webError("payload.targetStatus is invalid");
    if (payload.targetStatus === "blocked") text(payload.blockReason, "payload.blockReason", 2000); else if (payload.blockReason !== undefined) throw webError("payload.blockReason is allowed only for blocked tasks");
  } else if (type === "definition.update" || type === "manual_run") {
    if (input.runRef !== undefined) throw webError(`${type} shape is invalid`); result.definitionRef = text(input.definitionRef, "definitionRef");
    if (type === "definition.update" && !["enabled", "disabled"].includes(payload.status)) throw webError("payload.status is invalid");
    if (type === "manual_run") revision(payload.taskRevision, "payload.taskRevision");
  } else { if (input.definitionRef !== undefined) throw webError(`${type} shape is invalid`); result.runRef = text(input.runRef, "runRef"); }
  return Object.freeze(result);
}
function normalizeEmptyQuery(input = {}) { assertSafeValue(input, "query"); if (!isRecord(input) || Object.keys(input).length) throw webError("query must be an empty object"); }
function hostRef(kind, commandId) { return `automation_${kind}_${createHash("sha256").update(`web/${kind}\0${commandId}`).digest("base64url")}`; }
function fixedErrorMessage() { return "The project automation request could not be completed."; }
function projectAutomationWebError(error) {
  let code = typeof error?.code === "string" ? error.code : "PROJECT_AUTOMATION_WEB_INVALID_REQUEST";
  if (error instanceof RangeError) code = "PROJECT_AUTOMATION_WEB_BODY_TOO_LARGE";
  const map = {
    PROJECT_ENTRY_NOT_CREATED: [409, "create_or_join_project", false], PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN: [403, "open_authority_desktop", false], PROJECT_ENTRY_TASK_CONTEXT_INVALID: [409, "refresh_automations", true],
    PROJECT_AUTOMATION_WEB_BODY_TOO_LARGE: [413, "fix_request", false], PROJECT_AUTOMATION_WEB_INVALID_REQUEST: [400, "fix_request", false], PROJECT_AUTOMATION_WEB_CLOSED: [503, "retry_after_runtime_restart", true],
    PROJECT_AUTOMATION_TASK_NOT_FOUND: [404, "refresh_automations", false], PROJECT_AUTOMATION_DEFINITION_NOT_FOUND: [404, "refresh_automations", false], PROJECT_AUTOMATION_RUN_NOT_FOUND: [404, "refresh_automations", false],
    PROJECT_AUTOMATION_TASK_TRANSITION_INVALID: [409, "refresh_automations", false], PROJECT_AUTOMATION_TASK_CONFLICT: [409, "refresh_and_retry", false], PROJECT_AUTOMATION_CONFLICT: [409, "refresh_and_retry", false], PROJECT_AUTOMATION_STORE_CONFLICT: [409, "refresh_and_retry", false],
    PROJECT_AUTOMATION_DEFINITION_STALE: [409, "refresh_and_retry", false], PROJECT_AUTOMATION_DEFINITION_DISABLED: [409, "enable_definition", false], PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT: [409, "start_new_action", false],
    PROJECT_AUTOMATION_APPROVAL_FORBIDDEN: [403, "ask_owner_or_maintainer", false], PROJECT_AUTOMATION_BUSY: [503, "retry_after_runtime_restart", true], PROJECT_AUTOMATION_RUNNER_CLOSED: [503, "retry_after_runtime_restart", true], PROJECT_AUTOMATION_STORE_CLOSED: [503, "retry_after_runtime_restart", true],
  };
  const [status, nextAction, retryable] = map[code] ?? [500, "retry_or_view_logs", true];
  const safeDetails = {}; if (Number.isSafeInteger(error?.currentRevision)) safeDetails.currentRevision = error.currentRevision;
  return { status, body: { ok: false, error: { code, message: fixedErrorMessage(code), nextAction, retryable, safeDetails } } };
}
function projectSafeAutomationRun(item, definitionMap = new Map()) {
  const error = item.error ?? item.steps?.[0]?.error;
  const retryable = error?.retryable === true;
  const actions = item.status === "awaiting_approval" ? ["approve", "reject", "cancel"] : ["queued", "running"].includes(item.status) ? ["cancel"] : item.status === "failed" && retryable ? ["retry"] : [];
  return { runRef: item.runRef, definitionRef: item.definitionRef, definitionName: definitionMap.get(item.definitionRef)?.name ?? "", revision: item.revision, status: item.status, createdAt: item.createdAt, startedAt: item.startedAt ?? "", finishedAt: item.finishedAt ?? "", errorCode: error?.code ?? "", retryable, allowedActions: actions };
}

class ProjectAutomationWebRuntime {
  constructor({ projectEntry, now = Date.now, schedule = setImmediate } = {}) {
    if (typeof projectEntry?.localProjectAutomationContext !== "function" || typeof projectEntry?.localProjectTaskContext !== "function") throw new TypeError("projectEntry must provide Automation and Task contexts");
    if (typeof now !== "function" || typeof schedule !== "function") throw new TypeError("now and schedule must be functions");
    this.projectEntry = projectEntry; this.now = now; this.schedule = schedule; this.binding = undefined; this.listeners = new Set(); this.tail = Promise.resolve(); this.closing = false; this.closePromise = undefined; this.pumps = new Set();
  }
  async state(query = {}) { normalizeEmptyQuery(query); return this.#enqueue(async () => { try { return await this.#withBinding((binding) => this.#safeState(binding)); } catch (error) { if (!UNAVAILABLE_ERRORS.has(error?.code)) throw error; return { capability: await this.#unavailable(error), definitions: [], taskChoices: [], runs: [], recentLedger: [] }; } }); }
  async action(input, query = {}) {
    normalizeEmptyQuery(query); const webCommand = normalizeAutomationWebCommand(input);
    return this.#enqueue(() => this.#withBinding(async (binding) => {
      const command = await this.#hostCommand(binding, webCommand);
      const result = await binding.service.executeCommand(binding.automation.execution, command);
      this.#publish({ type: "automation" });
      if (["approve", "retry"].includes(command.type) && result.run?.status === "queued") this.#schedulePump(binding);
      return { ok: true, duplicate: result.duplicate, revision: result.revision, ...(result.definition ? { definition: this.#safeDefinition(result.definition, new Map()) } : {}), ...(result.run ? { run: this.#safeRun(result.run, new Map()) } : {}) };
    }));
  }
  subscribe(listener, query = {}) { normalizeEmptyQuery(query); if (typeof listener !== "function") throw new TypeError("listener must be a function"); if (this.closing) throw webError("runtime is closed", "PROJECT_AUTOMATION_WEB_CLOSED"); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  close() { if (this.closePromise) return this.closePromise; this.closing = true; this.closePromise = this.tail.then(async () => { const binding = this.binding; this.binding = undefined; try { if (binding) await this.#closeBinding(binding); } finally { this.listeners.clear(); } }); return this.closePromise; }
  #enqueue(operation) { if (this.closing) return Promise.reject(webError("runtime is closed", "PROJECT_AUTOMATION_WEB_CLOSED")); const result = this.tail.then(operation); this.tail = result.catch(() => undefined); return result; }
  async #withBinding(operation) { let binding = await this.#bind(); try { return await operation(binding); } catch (error) { if (!CONTEXT_ERRORS.has(error?.code)) throw error; await this.#invalidate(binding); binding = await this.#bind(); return operation(binding); } }
  async #bind() {
    if (this.binding) return this.binding;
    const automation = await this.projectEntry.localProjectAutomationContext(); let task, store, taskStore;
    try {
      task = await this.projectEntry.localProjectTaskContext(); if (task.projectRef !== automation.projectRef) throw webError("contexts belong to different projects");
      const key = automation.keyProvider(automation.projectRef); let systemActorRef;
      try { systemActorRef = `system_${createHmac("sha256", key).update("dsh/project-automation-runner-actor/v1\0").update(automation.projectRef).digest("base64url")}`; store = new ProjectAutomationStore({ projectRef: automation.projectRef, filePath: automation.filePath, encryptionKey: key }); } finally { key.fill(0); }
      taskStore = new ProjectTaskStore({ filePath: task.databasePath, keyProvider: task.keyProvider });
      taskStore.initialize();
      const taskExecution = Object.freeze(Object.create(null));
      const taskService = new ProjectTaskCommandService({ store: taskStore, actorResolver: (candidate, projectRef) => { task.actorResolver(task.execution, projectRef); if (candidate !== taskExecution) throw webError("runner execution is invalid"); return { projectRef, actorRef: systemActorRef, kind: "system", authorities: [] }; } });
      const service = new ProjectAutomationCommandService({ store, projectRef: automation.projectRef, actorResolver: automation.actorResolver, refFactory: hostRef, now: this.now });
      const runner = new ProjectAutomationRunner({ store, taskService, taskExecution, projectRef: automation.projectRef, refFactory: hostRef, now: this.now });
      const binding = { automation, task, store, taskStore, service, runner }; this.binding = binding; this.#schedulePump(binding, true); return binding;
    } catch (error) {
      try { taskStore?.close(); } catch {}
      try { await store?.close(); } catch {}
      try { task?.dispose(); } catch {}
      try { automation.dispose(); } catch {}
      throw error;
    }
  }
  async #invalidate(binding) { if (this.binding === binding) this.binding = undefined; await this.#closeBinding(binding); this.#publish({ type: "capability" }); }
  async #closeBinding(binding) {
    let failure;
    try { await binding.runner.close(); } catch (error) { failure = error; }
    await Promise.allSettled([...this.pumps]);
    try { await binding.store.close(); } catch (error) { failure ??= error; }
    try { binding.taskStore.close(); } catch (error) { failure ??= error; }
    try { binding.task.dispose(); } catch (error) { failure ??= error; }
    try { binding.automation.dispose(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  }
  #schedulePump(binding, recovery = false) { let promise; this.schedule(() => { if (this.closing || this.binding !== binding) return; promise = (recovery ? binding.runner.recover() : binding.runner.pump()).then(() => this.#publish({ type: "run" }), () => this.#publish({ type: "automation" })).finally(() => this.pumps.delete(promise)); this.pumps.add(promise); }); }
  async #hostCommand(binding, webCommand) {
    binding.automation.actorResolver(binding.automation.execution, binding.automation.projectRef);
    binding.task.actorResolver(binding.task.execution, binding.task.projectRef);
    const command = { ...webCommand, payload: { ...webCommand.payload } };
    if (command.type === "definition.create" || command.type === "manual_run") {
      const loaded = await binding.store.load();
      if (loaded.document.commandReceipts.some((item) => item.commandId === command.commandId)) {
        if (command.type === "manual_run") { command.payload.expectedTaskRevision = command.payload.taskRevision; delete command.payload.taskRevision; }
        return command;
      }
      let taskRef = command.payload.taskRef;
      if (command.type === "manual_run") {
        const definition = loaded.document.definitions.find((item) => item.definitionRef === command.definitionRef);
        if (definition === undefined) { command.payload.expectedTaskRevision = command.payload.taskRevision; delete command.payload.taskRevision; return command; }
        taskRef = definition.steps[0].taskRef;
      }
      const snapshot = binding.taskStore.readTaskSnapshot({ projectRef: binding.task.projectRef, limit: 500 });
      const task = snapshot.tasks.find((item) => item.taskRef === taskRef);
      if (task === undefined) throw webError("selected task is unavailable", "PROJECT_AUTOMATION_TASK_NOT_FOUND");
      if (command.type === "definition.create" && !(TASK_TRANSITIONS[task.status] ?? []).includes(command.payload.targetStatus)) throw webError("selected task transition is unavailable", "PROJECT_AUTOMATION_TASK_TRANSITION_INVALID");
      if (command.type === "manual_run") {
        if (command.payload.taskRevision !== task.revision) throw webError("task revision is stale", "PROJECT_AUTOMATION_TASK_CONFLICT", { currentRevision: task.revision });
        command.payload.expectedTaskRevision = task.revision; delete command.payload.taskRevision;
      }
    }
    return command;
  }
  async #safeState(binding) {
    binding.automation.actorResolver(binding.automation.execution, binding.automation.projectRef); binding.task.actorResolver(binding.task.execution, binding.task.projectRef);
    const [automation, tasks] = await Promise.all([binding.store.load(), Promise.resolve(binding.taskStore.readTaskSnapshot({ projectRef: binding.task.projectRef, limit: 500 }))]);
    const taskMap = new Map(tasks.tasks.map((task) => [task.taskRef, task])), definitionMap = new Map(automation.document.definitions.map((definition) => [definition.definitionRef, definition]));
    return { capability: { available: true, writable: true, canCreate: true, kind: "authority", reason: "" }, definitions: automation.document.definitions.map((item) => this.#safeDefinition(item, taskMap)), taskChoices: tasks.tasks.map((task) => ({ taskRef: task.taskRef, title: task.title, revision: task.revision, allowedTargets: [...(TASK_TRANSITIONS[task.status] ?? [])].filter((target) => TARGETS.has(target)) })), runs: automation.document.runs.map((item) => this.#safeRun(item, definitionMap)), recentLedger: automation.document.ledger.slice(-100).reverse().map((entry) => ({ occurredAt: entry.occurredAt, type: entry.type, runRef: entry.runRef ?? "", definitionName: definitionMap.get(entry.definitionRef)?.name ?? definitionMap.get(automation.document.runs.find((run) => run.runRef === entry.runRef)?.definitionRef)?.name ?? "", status: entry.toStatus ?? entry.status ?? "", errorCode: entry.errorCode ?? "" })) };
  }
  #safeDefinition(item, taskMap) { const step = item.steps[0], task = taskMap.get(step.taskRef), canRun = task !== undefined && (TASK_TRANSITIONS[task.status] ?? []).includes(step.targetStatus); return { definitionRef: item.definitionRef, revision: item.revision, status: item.status, name: item.name, taskRef: step.taskRef, taskTitle: task?.title ?? "", targetStatus: step.targetStatus, blockReason: step.blockReason ?? "", allowedActions: item.status === "enabled" ? ["disable", ...(canRun ? ["run"] : [])] : ["enable"] }; }
  #safeRun(item, definitionMap) { return projectSafeAutomationRun(item, definitionMap); }
  async #unavailable(error) { let kind = error.code === "PROJECT_ENTRY_NOT_CREATED" ? "no-project" : "unavailable"; try { const status = await this.projectEntry.status?.(); if (status?.project?.role && status.project.role !== "owner") kind = "collaborator"; } catch {} return { available: false, writable: false, canCreate: false, kind, reason: kind === "collaborator" ? "authority_required" : "project_required" }; }
  #publish(update) { for (const listener of [...this.listeners]) { try { listener(update); } catch {} } }
}

export { AUTOMATION_WEB_TYPES, MAX_AUTOMATION_WEB_COMMAND_BYTES, ProjectAutomationWebRuntime, normalizeAutomationWebCommand, projectAutomationWebError, projectSafeAutomationRun };
