import { createHash } from "node:crypto";
import { canActorPerform, TASK_TRANSITIONS } from "./project-task-domain.js";
import { ProjectTaskCommandService } from "./project-task-service.js";
import { ProjectTaskStore } from "./project-task-store.js";

const MAX_WEB_COMMAND_BYTES = 64 * 1024;
const MAX_WEB_VALUE_DEPTH = 16;
const MAX_WEB_EVENTS = 100;
const MAX_WEB_EVENT_WINDOW = 500;
const MAX_WEB_TASKS = 500;
const WEB_ACTIONS = Object.freeze([
  "create", "edit_requirements", "claim", "transition", "comment", "relation.add", "attempt.start", "attempt.submit", "review",
]);
const WEB_ACTION_SET = new Set(WEB_ACTIONS);
const WEB_COMMAND_KEYS = new Set(["commandId", "type", "taskRef", "expectedRevision", "payload"]);
const FORBIDDEN_WEB_KEYS = new Set([
  "projectref", "eventref", "sessionid", "userid", "deviceid", "accountid", "email", "actorref", "role", "authority", "authorities",
]);
const CONTEXT_ERRORS = new Set(["PROJECT_ENTRY_TASK_CONTEXT_INVALID"]);
const UNAVAILABLE_ERRORS = new Set(["PROJECT_ENTRY_NOT_CREATED", "PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function webError(message, code = "PROJECT_TASK_WEB_INVALID_REQUEST", details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw webError(`${field} is invalid`);
  return value.trim();
}
function safeInteger(value, field, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw webError(`${field} is invalid`);
  return value;
}
function normalizedKey(key) {
  return key.replaceAll(/[-_]/gu, "").toLowerCase();
}
function assertSafeWebValue(value, field = "payload", depth = 0, ancestors = new Set()) {
  if (depth > MAX_WEB_VALUE_DEPTH) throw webError(`${field} exceeds the maximum depth`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw webError(`${field} contains a non-lossless number`);
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) throw webError(`${field} must be acyclic lossless JSON`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype && prototype !== null)) {
    throw webError(`${field} must contain plain JSON objects and arrays only`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw webError(`${field} must not contain symbol properties`);
  ancestors.add(value);
  try {
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || lengthDescriptor.value !== value.length) throw webError(`${field} has an invalid array length`);
      const elementKeys = keys.filter((key) => key !== "length");
      if (elementKeys.length !== value.length) throw webError(`${field} must not be sparse or contain custom properties`);
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index);
        if (elementKeys[index] !== key) throw webError(`${field} must not be sparse or contain custom properties`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) throw webError(`${field}[${index}] must be an enumerable data property`);
        assertSafeWebValue(descriptor.value, `${field}[${index}]`, depth + 1, ancestors);
      }
    } else {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || descriptor.enumerable !== true || !("value" in descriptor)) throw webError(`${field}.${key} must be an enumerable data property`);
        if (FORBIDDEN_WEB_KEYS.has(normalizedKey(key))) throw webError(`${field} contains a forbidden field`);
        assertSafeWebValue(descriptor.value, `${field}.${key}`, depth + 1, ancestors);
      }
    }
  } finally {
    ancestors.delete(value);
  }
}
function encodeSafeWebJson(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((_, index) => encodeSafeWebJson(Object.getOwnPropertyDescriptor(value, String(index)).value)).join(",")}]`;
  return `{${Object.keys(value).map((key) => `${JSON.stringify(key)}:${encodeSafeWebJson(Object.getOwnPropertyDescriptor(value, key).value)}`).join(",")}}`;
}
function digestRef(prefix, commandId) {
  return `${prefix}_${createHash("sha256").update(commandId).digest("base64url")}`;
}
function normalizeWebCommand(input) {
  if (!isRecord(input)) throw webError("command must be an object");
  const extras = Object.keys(input).filter((key) => !WEB_COMMAND_KEYS.has(key));
  if (extras.length > 0) throw webError("command contains unsupported or forbidden fields");
  assertSafeWebValue(input);
  const encoded = encodeSafeWebJson(input);
  if (Buffer.byteLength(encoded, "utf8") > MAX_WEB_COMMAND_BYTES) throw webError("command exceeds 65536 bytes", "PROJECT_TASK_WEB_BODY_TOO_LARGE");
  const commandId = nonEmptyString(input.commandId, "commandId", 256);
  const type = nonEmptyString(input.type, "type", 64);
  if (!WEB_ACTION_SET.has(type)) throw webError("command type is not available on the Web task board", "PROJECT_TASK_WEB_ACTION_UNAVAILABLE");
  const expectedRevision = safeInteger(input.expectedRevision, "expectedRevision", 0);
  if ((type === "create" && expectedRevision !== 0) || (type !== "create" && expectedRevision < 1)) throw webError("expectedRevision is invalid");
  let taskRef;
  if (type === "create") {
    if (Object.hasOwn(input, "taskRef")) throw webError("create taskRef is assigned by the Host");
    taskRef = digestRef("task_web", commandId);
  } else taskRef = nonEmptyString(input.taskRef, "taskRef", 256);
  const payload = input.payload ?? {};
  if (!isRecord(payload)) throw webError("payload must be an object");
  return Object.freeze({ commandId, eventRef: digestRef("event_web", commandId), type, taskRef, expectedRevision, payload: JSON.parse(encodeSafeWebJson(payload)) });
}
function normalizeLegacySummary(value) {
  const detected = value === true || (isRecord(value) && value.detected === true);
  return Object.freeze({ detected, mode: "separate", importAvailable: false });
}
function safeEvent(event) {
  return Object.freeze({
    projectRevision: event.projectRevision,
    eventRef: event.eventRef,
    taskRef: event.taskRef,
    type: event.type,
    createdAt: event.createdAt,
  });
}
function fixedErrorMessage(code) {
  const messages = {
    PROJECT_ENTRY_NOT_CREATED: "No local project is available for project tasks.",
    PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN: "Project tasks are not available from this project device.",
    PROJECT_ENTRY_TASK_CONTEXT_INVALID: "The local project task authority changed.",
    PROJECT_TASK_NOT_FOUND: "The project task no longer exists.",
    PROJECT_TASK_CONFLICT: "The project task changed since it was loaded.",
    PROJECT_TASK_IDEMPOTENCY_CONFLICT: "This command identifier was already used for another request.",
    PROJECT_TASK_DEPENDENCY_BLOCKED: "The project task still has unresolved dependencies.",
    PROJECT_TASK_REQUIREMENTS_STALE: "The execution attempt no longer matches the current requirements.",
    PROJECT_TASK_RELATION_CYCLE: "That relation would create a task ordering cycle.",
    PROJECT_TASK_INVALID_TRANSITION: "That task transition is not currently available.",
    PROJECT_TASK_ATTEMPT_INVALID: "A current execution attempt is required.",
    PROJECT_TASK_ATTEMPT_NOT_SUBMITTED: "The current execution attempt has not been submitted.",
    PROJECT_TASK_BLOCK_REASON_REQUIRED: "A block reason is required.",
    PROJECT_TASK_REVIEW_REQUIRED: "An approved current review is required.",
    PROJECT_TASK_SELF_APPROVAL: "The task executor cannot approve their own work.",
    PROJECT_TASK_FORBIDDEN: "The local project actor cannot perform this action.",
    PROJECT_TASK_ACTOR_UNRESOLVED: "The local project actor could not be resolved.",
    PROJECT_TASK_SNAPSHOT_INCONSISTENT: "The project task snapshot changed while it was being read.",
    PROJECT_TASK_CIPHERTEXT_INVALID: "The project task database could not be decrypted safely.",
    PROJECT_TASK_STORE_CLOSED: "The project task runtime is closed.",
    PROJECT_TASK_SCHEMA_UNSUPPORTED: "The project task database requires a newer runtime.",
    PROJECT_TASK_ROLLBACK: "Project task database rollback protection stopped this request.",
    PROJECT_TASK_WEB_CLOSED: "The project task Web runtime is closed.",
    PROJECT_TASK_WEB_BODY_TOO_LARGE: "The project task request is too large.",
    PROJECT_TASK_WEB_ACTION_UNAVAILABLE: "That action is not available on the Web task board.",
    PROJECT_TASK_WEB_INVALID_REQUEST: "The project task request is invalid.",
  };
  return messages[code] ?? "The project task request could not be completed.";
}
function projectTaskWebError(error) {
  let code = typeof error?.code === "string" ? error.code : "PROJECT_TASK_WEB_INVALID_REQUEST";
  if (error instanceof RangeError) code = "PROJECT_TASK_WEB_BODY_TOO_LARGE";
  else if (error instanceof TypeError && typeof error?.code !== "string") code = "PROJECT_TASK_WEB_INVALID_REQUEST";
  const rules = {
    PROJECT_ENTRY_NOT_CREATED: [409, "create_or_join_project", false],
    PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN: [403, "open_authority_desktop", false],
    PROJECT_ENTRY_TASK_CONTEXT_INVALID: [409, "refresh_task_board", true],
    PROJECT_TASK_NOT_FOUND: [404, "refresh_task_board", false],
    PROJECT_TASK_CONFLICT: [409, "refresh_and_retry", false],
    PROJECT_TASK_IDEMPOTENCY_CONFLICT: [409, "start_new_action", false],
    PROJECT_TASK_DEPENDENCY_BLOCKED: [409, "resolve_dependencies", false],
    PROJECT_TASK_REQUIREMENTS_STALE: [409, "restart_after_refresh", false],
    PROJECT_TASK_RELATION_CYCLE: [409, "choose_non_cyclic_relation", false],
    PROJECT_TASK_INVALID_TRANSITION: [409, "choose_allowed_transition", false],
    PROJECT_TASK_ATTEMPT_INVALID: [409, "choose_allowed_transition", false],
    PROJECT_TASK_ATTEMPT_NOT_SUBMITTED: [409, "choose_allowed_transition", false],
    PROJECT_TASK_BLOCK_REASON_REQUIRED: [400, "enter_block_reason", false],
    PROJECT_TASK_REVIEW_REQUIRED: [409, "submit_for_review", false],
    PROJECT_TASK_SELF_APPROVAL: [403, "ask_eligible_reviewer", false],
    PROJECT_TASK_FORBIDDEN: [403, "ask_eligible_reviewer", false],
    PROJECT_TASK_ACTOR_UNRESOLVED: [403, "refresh_project_authority", false],
    PROJECT_TASK_SNAPSHOT_INCONSISTENT: [409, "refresh_task_board", true],
    PROJECT_TASK_CIPHERTEXT_INVALID: [503, "repair_project_task_store", false],
    PROJECT_TASK_STORE_CLOSED: [503, "retry_after_runtime_restart", true],
    PROJECT_TASK_SCHEMA_UNSUPPORTED: [503, "repair_project_task_store", false],
    PROJECT_TASK_ROLLBACK: [503, "repair_project_task_store", false],
    PROJECT_TASK_WEB_CLOSED: [503, "retry_after_runtime_restart", true],
    PROJECT_TASK_WEB_BODY_TOO_LARGE: [413, "fix_request", false],
    PROJECT_TASK_WEB_ACTION_UNAVAILABLE: [400, "fix_request", false],
    PROJECT_TASK_WEB_INVALID_REQUEST: [400, "fix_request", false],
  };
  const [status, nextAction, retryable] = rules[code] ?? [500, "retry_or_view_logs", true];
  const safeDetails = {};
  if (Number.isSafeInteger(error?.currentRevision)) safeDetails.currentRevision = error.currentRevision;
  if (Number.isSafeInteger(error?.currentRequirementsRevision)) safeDetails.currentRequirementsRevision = error.currentRequirementsRevision;
  if (Array.isArray(error?.blockedBy)) safeDetails.blockedBy = error.blockedBy.filter((item) => typeof item === "string").slice(0, 50);
  return {
    status,
    body: { ok: false, error: { code, message: fixedErrorMessage(code), nextAction, retryable, safeDetails } },
  };
}

class ProjectTaskWebRuntime {
  constructor({ projectEntry, legacySummaryProvider = () => false, now = Date.now } = {}) {
    if (typeof projectEntry?.localProjectTaskContext !== "function") throw new TypeError("projectEntry must provide localProjectTaskContext");
    if (typeof legacySummaryProvider !== "function") throw new TypeError("legacySummaryProvider must be a function");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.projectEntry = projectEntry;
    this.legacySummaryProvider = legacySummaryProvider;
    this.now = now;
    this.binding = undefined;
    this.listeners = new Set();
    this.tail = Promise.resolve();
    this.closing = false;
    this.closePromise = undefined;
  }

  async state() {
    return this.#enqueue(async () => {
      const legacyTeamTasks = await this.#legacySummary();
      try {
        return await this.#withBinding((binding) => {
          const snapshot = binding.store.readTaskSnapshot({ projectRef: binding.context.projectRef, limit: MAX_WEB_TASKS });
          return {
            ok: true,
            capability: { available: true, writable: true, canCreate: true, kind: "authority", mode: "authority", actions: [...WEB_ACTIONS], legacyTeamTasks },
            projectRevision: snapshot.projectRevision,
            tasks: snapshot.tasks.map((task) => this.#safeTask(binding, task)),
            hasMore: snapshot.hasMore,
          };
        });
      } catch (error) {
        if (!UNAVAILABLE_ERRORS.has(error?.code)) throw error;
        return { ok: true, capability: { ...(await this.#unavailableCapability(error)), legacyTeamTasks } };
      }
    });
  }

  async events(input = {}) {
    if (!isRecord(input)) throw webError("event query must be an object");
    const extras = Object.keys(input).filter((key) => !new Set(["afterRevision", "limit"]).has(key));
    if (extras.length > 0) throw webError("event query contains unsupported or forbidden fields");
    assertSafeWebValue(input, "query");
    const afterRevision = safeInteger(input.afterRevision ?? 0, "afterRevision", 0);
    const limit = safeInteger(input.limit ?? MAX_WEB_EVENTS, "limit", 1, MAX_WEB_EVENTS);
    return this.#enqueue(() => this.#withBinding((binding) => {
      const projectRef = binding.context.projectRef;
      const currentRevision = binding.store.getProjectRevision(projectRef);
      if (afterRevision > currentRevision || currentRevision - afterRevision > MAX_WEB_EVENT_WINDOW) {
        return { ok: true, fromRevision: afterRevision, currentRevision, events: [], hasMore: false, reset: true, nextAfterRevision: currentRevision };
      }
      const rows = binding.store.listEvents({ projectRef, afterRevision, limit: limit + 1 });
      if (rows.length > 0 && rows[0].projectRevision !== afterRevision + 1) {
        return { ok: true, fromRevision: afterRevision, currentRevision, events: [], hasMore: false, reset: true, nextAfterRevision: currentRevision };
      }
      const hasMore = rows.length > limit;
      const selected = rows.slice(0, limit).map(safeEvent);
      return {
        ok: true,
        fromRevision: afterRevision,
        currentRevision,
        events: selected,
        hasMore,
        reset: false,
        nextAfterRevision: selected.at(-1)?.projectRevision ?? afterRevision,
      };
    }));
  }

  async action(input) {
    const webCommand = normalizeWebCommand(input);
    return this.#enqueue(() => this.#withBinding((binding) => {
      const command = { projectRef: binding.context.projectRef, ...webCommand };
      const result = binding.service.executeCommand(binding.context.execution, command);
      const projected = {
        ok: true,
        receipt: {
          commandId: webCommand.commandId,
          eventRef: webCommand.eventRef,
          duplicate: result.duplicate === true,
          projectRevision: result.projectRevision,
        },
        task: this.#safeTask(binding, result.task),
      };
      const event = binding.store.listEvents({ projectRef: binding.context.projectRef, afterRevision: Math.max(0, result.projectRevision - 1), limit: 1 })[0];
      if (event !== undefined) this.#publish({ type: "project-task", event: safeEvent(event) });
      return projected;
    }));
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    if (this.closing) throw webError("runtime is closed", "PROJECT_TASK_WEB_CLOSED");
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = this.tail.then(() => {
      this.listeners.clear();
      this.#releaseBinding();
    });
    return this.closePromise;
  }

  #enqueue(operation) {
    if (this.closing) return Promise.reject(webError("runtime is closed", "PROJECT_TASK_WEB_CLOSED"));
    // Once accepted, an operation drains before close; closing rejects only new work.
    const pending = this.tail.then(() => operation());
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  async #withBinding(operation, retried = false) {
    const binding = await this.#ensureBinding();
    try { return await operation(binding); }
    catch (error) {
      if (retried || !CONTEXT_ERRORS.has(error?.code)) throw error;
      this.#releaseBinding();
      return this.#withBinding(operation, true);
    }
  }

  async #ensureBinding() {
    if (this.binding !== undefined) {
      try {
        this.binding.context.actorResolver(this.binding.context.execution, this.binding.context.projectRef);
        return this.binding;
      } catch (error) {
        if (!CONTEXT_ERRORS.has(error?.code)) throw error;
        this.#releaseBinding();
      }
    }
    const context = await this.projectEntry.localProjectTaskContext();
    const store = new ProjectTaskStore({ filePath: context.databasePath, keyProvider: context.keyProvider });
    try {
      store.initialize();
      const service = new ProjectTaskCommandService({ store, actorResolver: context.actorResolver, now: this.now });
      context.actorResolver(context.execution, context.projectRef);
      this.binding = { context, store, service };
      return this.binding;
    } catch (error) {
      try { store.close(); }
      finally { this.#disposeContext(context); }
      throw error;
    }
  }

  #releaseBinding() {
    const binding = this.binding;
    this.binding = undefined;
    if (binding === undefined) return;
    try { binding.store.close(); }
    finally { this.#disposeContext(binding.context); }
  }

  #disposeContext(context) {
    try { context?.dispose?.(); } catch {}
  }

  #safeTask(binding, task) {
    const blockedBy = binding.store.getBlockingTaskRefs({ projectRef: binding.context.projectRef, taskRef: task.taskRef });
    const actor = binding.context.actorResolver(binding.context.execution, binding.context.projectRef);
    const allowedTransitions = (TASK_TRANSITIONS[task.status] ?? []).filter((target) => {
      if (["blocked", "in_review", "done"].includes(target)) return false;
      if (target === "in_progress" && blockedBy.length > 0) return false;
      return canActorPerform(actor, target === "canceled" ? "cancel" : "transition", task);
    });
    return Object.freeze({
      taskRef: task.taskRef,
      title: task.title,
      status: task.status,
      revision: task.revision,
      requirementsRevision: task.requirementsRevision,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      hasAssignee: typeof task.assigneeActorRef === "string",
      hasFileScope: Array.isArray(task.fileScope) && task.fileScope.length > 0,
      allowedTransitions,
    });
  }

  async #legacySummary() {
    try { return normalizeLegacySummary(await this.legacySummaryProvider()); }
    catch { return normalizeLegacySummary(false); }
  }

  async #unavailableCapability(error) {
    let kind = "no-project";
    let mode = "none";
    let reason = "no_project";
    let nextAction = "create_or_join_project";
    if (error?.code === "PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN") {
      kind = "unavailable";
      mode = "unavailable";
      reason = "authority_task_store_required";
      nextAction = "open_authority_desktop";
      try {
        const status = await this.projectEntry.status?.();
        if (status?.project?.role && status.project.role !== "owner") {
          kind = "collaborator";
          mode = "collaborator";
        }
      } catch {}
    }
    return { available: false, writable: false, canCreate: false, kind, mode, reason, nextAction };
  }

  #publish(update) {
    for (const listener of [...this.listeners]) {
      try { listener(update); } catch {}
    }
  }
}

export {
  MAX_WEB_COMMAND_BYTES,
  MAX_WEB_EVENTS,
  MAX_WEB_EVENT_WINDOW,
  MAX_WEB_TASKS,
  ProjectTaskWebRuntime,
  WEB_ACTIONS,
  normalizeWebCommand,
  projectTaskWebError,
  safeEvent,
};
