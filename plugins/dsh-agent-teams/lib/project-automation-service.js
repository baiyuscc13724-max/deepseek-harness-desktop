import { createHash } from "node:crypto";
import {
  assertCommandReplay,
  assertTrustedAutomationApprover,
  canonicalJson,
  hashAutomationInput,
  normalizeAutomationCommandReceipt,
  normalizeAutomationDefinition,
} from "./project-automation-domain.js";

const SERVICE_COMMAND_TYPES = Object.freeze(["definition.create", "definition.update", "manual_run", "approve", "reject", "retry", "cancel"]);
const SERVICE_COMMAND_SET = new Set(SERVICE_COMMAND_TYPES);
const SERVICE_COMMAND_KEYS = new Set(["commandId", "type", "definitionRef", "runRef", "expectedRevision", "payload"]);
const SERVICE_PAYLOAD_KEYS = Object.freeze({
  "definition.create": new Set(["name", "status", "taskRef", "targetStatus", "blockReason"]),
  "definition.update": new Set(["name", "status", "taskRef", "targetStatus", "blockReason"]),
  manual_run: new Set(["expectedTaskRevision"]),
  approve: new Set(),
  reject: new Set(["reasonCode"]),
  retry: new Set(["reasonCode"]),
  cancel: new Set(["reasonCode"]),
});
const MAX_STORE_RETRIES = 4;
const DEFAULT_RUNNER_LIMIT = 100;
const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const RUNNER_STATUSES = new Set(["queued", "running", "cancel_requested"]);
const NON_RETRYABLE_TASK_ERRORS = new Set([
  "PROJECT_TASK_CONFLICT", "PROJECT_TASK_INVALID_TRANSITION", "PROJECT_TASK_FORBIDDEN", "PROJECT_TASK_REQUIREMENTS_STALE",
  "PROJECT_TASK_DEPENDENCY_BLOCKED", "PROJECT_TASK_REVIEW_REQUIRED", "PROJECT_TASK_ATTEMPT_INVALID", "PROJECT_TASK_ATTEMPT_NOT_SUBMITTED",
  "PROJECT_TASK_BLOCK_REASON_REQUIRED", "PROJECT_TASK_SELF_APPROVAL", "PROJECT_TASK_NOT_FOUND", "PROJECT_TASK_IDEMPOTENCY_CONFLICT",
]);
const TRANSIENT_RECEIPT_QUERY_ERRORS = new Set([
  "PROJECT_TASK_STORE_CLOSED", "PROJECT_ENTRY_TASK_CONTEXT_INVALID", "PROJECT_TASK_CIPHERTEXT_INVALID", "PROJECT_TASK_SNAPSHOT_INCONSISTENT",
]);

function serviceError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}
function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalCopy(value) { return JSON.parse(canonicalJson(value)); }
function defaultRefFactory(kind, commandId) {
  return `automation_${kind}_${createHash("sha256").update(`${kind}\0${commandId}`).digest("base64url")}`;
}
function toIso(now) {
  const value = now();
  if (typeof value === "string") {
    if (!Number.isFinite(Date.parse(value))) throw new TypeError("now returned an invalid timestamp");
    return new Date(value).toISOString();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("now returned an invalid timestamp");
  return date.toISOString();
}
function assertAllowedKeys(value, allowed, field) {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function optionalReason(value) {
  return value === undefined ? undefined : nonEmptyString(value, "payload.reasonCode", 500);
}
function normalizeAutomationServiceCommand(input) {
  if (!isRecord(input)) throw new TypeError("automation service command must be an object");
  // canonicalJson is the shared strict plain/lossless JSON boundary; hashing also
  // rejects every browser-supplied identity, project, executable, and path field.
  const copy = canonicalCopy(input);
  hashAutomationInput(copy);
  assertAllowedKeys(copy, SERVICE_COMMAND_KEYS, "automation service command");
  const type = nonEmptyString(copy.type, "type", 64);
  if (!SERVICE_COMMAND_SET.has(type)) throw new TypeError("automation service command type is unsupported");
  const commandId = nonEmptyString(copy.commandId, "commandId", 256);
  const payload = copy.payload === undefined ? {} : copy.payload;
  assertAllowedKeys(payload, SERVICE_PAYLOAD_KEYS[type], "payload");
  if (type === "definition.create" || type === "definition.update") {
    if (payload.name !== undefined) nonEmptyString(payload.name, "payload.name", 200);
    if (payload.status !== undefined && !["enabled", "disabled"].includes(payload.status)) throw new TypeError("payload.status must be enabled or disabled");
    if (payload.taskRef !== undefined) nonEmptyString(payload.taskRef, "payload.taskRef", 256);
    if (payload.targetStatus !== undefined) nonEmptyString(payload.targetStatus, "payload.targetStatus", 64);
    if (payload.blockReason !== undefined && payload.blockReason !== null) nonEmptyString(payload.blockReason, "payload.blockReason", 2_000);
  }
  const extras = {};
  if (copy.definitionRef !== undefined) extras.definitionRef = nonEmptyString(copy.definitionRef, "definitionRef", 256);
  if (copy.runRef !== undefined) extras.runRef = nonEmptyString(copy.runRef, "runRef", 256);
  let expectedRevision;
  if (type === "definition.create") {
    if (copy.definitionRef !== undefined || copy.runRef !== undefined || copy.expectedRevision !== 0) throw new TypeError("definition.create requires expectedRevision 0 and Host-assigned references");
    expectedRevision = 0;
    nonEmptyString(payload.name, "payload.name", 200);
    nonEmptyString(payload.taskRef, "payload.taskRef", 256);
    nonEmptyString(payload.targetStatus, "payload.targetStatus", 64);
    if (payload.blockReason === null) throw new TypeError("definition.create blockReason cannot be null");
  } else if (type === "definition.update" || type === "manual_run") {
    if (copy.runRef !== undefined || copy.definitionRef === undefined) throw new TypeError(`${type} requires definitionRef only`);
    expectedRevision = positiveInteger(copy.expectedRevision, "expectedRevision");
    if (type === "definition.update" && Object.keys(payload).length === 0) throw new TypeError("definition.update payload must change at least one field");
    if (type === "manual_run") positiveInteger(payload.expectedTaskRevision, "payload.expectedTaskRevision");
  } else {
    if (copy.definitionRef !== undefined || copy.runRef === undefined) throw new TypeError(`${type} requires runRef only`);
    expectedRevision = positiveInteger(copy.expectedRevision, "expectedRevision");
    if (["approve"].includes(type) && Object.keys(payload).length !== 0) throw new TypeError(`${type} payload must be empty`);
    if (payload.reasonCode !== undefined) optionalReason(payload.reasonCode);
  }
  return deepFreeze({ commandId, type, ...extras, expectedRevision, payload });
}
function actorBoundInputHash(command, actor) {
  return hashAutomationInput({ intent: command, principal: [actor.actorRef, actor.actorRole] });
}
function deterministicCommandError(error) {
  const code = error?.code;
  if (typeof code !== "string") return false;
  if (["PROJECT_AUTOMATION_STORE_CONFLICT", "PROJECT_STATE_CONFLICT", "PROJECT_STATE_CLOSED", "PROJECT_AUTOMATION_PROJECT_MISMATCH", "PROJECT_AUTOMATION_DOCUMENT_INVALID", "PROJECT_AUTOMATION_LEDGER_INVALID", "PROJECT_AUTOMATION_PERSISTED_INVALID"].includes(code)) return false;
  return code.startsWith("PROJECT_AUTOMATION_");
}
function stableRejectedError(receipt, duplicate) {
  return serviceError("automation command was rejected", receipt.errorCode, { receipt, duplicate });
}
function requireStore(store) {
  for (const method of ["load", "saveDefinition", "executeCommand", "saveRejectedCommandReceipt", "startRun", "failRun", "reconcileEffectReceipt", "close"]) {
    if (typeof store?.[method] !== "function") throw new TypeError(`store must provide ${method}`);
  }
  return store;
}

class ProjectAutomationCommandService {
  constructor({ store, projectRef, actorResolver, refFactory = defaultRefFactory, now = Date.now, maxStoreRetries = MAX_STORE_RETRIES } = {}) {
    this.store = requireStore(store);
    this.projectRef = nonEmptyString(projectRef ?? store.projectRef, "projectRef", 128);
    if (typeof actorResolver !== "function") throw new TypeError("actorResolver must be a function");
    if (typeof refFactory !== "function") throw new TypeError("refFactory must be a function");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.actorResolver = actorResolver;
    this.refFactory = refFactory;
    this.now = now;
    this.maxStoreRetries = positiveInteger(maxStoreRetries, "maxStoreRetries");
  }

  async execute(execution, input) { return this.executeCommand(execution, input); }

  async getCommandReceipt(execution, input) {
    const command = normalizeAutomationServiceCommand(input);
    if (command.type !== "approve" && command.type !== "reject") throw new TypeError("automation receipt query requires an approve or reject command");
    // Resolve and authorize the current Host principal before the first store read.
    // The complete canonical intent is then bound to that principal exactly as it
    // is during executeCommand; querying can never create a run or perform an effect.
    const resolvedActor = this.actorResolver(execution, this.projectRef);
    const trustedActor = assertTrustedAutomationApprover(resolvedActor);
    const inputHash = actorBoundInputHash(command, trustedActor);
    const loaded = await this.store.load();
    const existing = loaded.document.commandReceipts.find((item) => item.commandId === command.commandId);
    if (existing === undefined) return undefined;
    return this.#replay(existing, command, inputHash, loaded);
  }

  async executeCommand(execution, input) {
    const command = normalizeAutomationServiceCommand(input);
    // Authorization intentionally precedes the first store load/receipt lookup so
    // unauthorized callers cannot distinguish absent, stale, or completed objects.
    const resolvedActor = this.actorResolver(execution, this.projectRef);
    const trustedActor = assertTrustedAutomationApprover(resolvedActor);
    const inputHash = actorBoundInputHash(command, trustedActor);
    for (let attempt = 0; attempt < this.maxStoreRetries; attempt += 1) {
      const loaded = await this.store.load();
      const existing = loaded.document.commandReceipts.find((item) => item.commandId === command.commandId);
      if (existing !== undefined) return this.#replay(existing, command, inputHash, loaded);
      try {
        return await this.#executeFresh(command, inputHash, resolvedActor, trustedActor, loaded);
      } catch (error) {
        if (error?.code === "PROJECT_AUTOMATION_STORE_CONFLICT") continue;
        if (!deterministicCommandError(error)) throw error;
        try {
          const receipt = this.#rejectedReceipt(command, inputHash, error, toIso(this.now));
          const saved = await this.store.saveRejectedCommandReceipt({ receipt, expectedRevision: loaded.revision });
          const current = await this.store.load();
          if (saved.receipt.outcome === "accepted") return this.#acceptedResult(saved.receipt, true, current);
          throw stableRejectedError(saved.receipt, saved.duplicate === true);
        } catch (saveError) {
          if (saveError?.code === "PROJECT_AUTOMATION_STORE_CONFLICT") continue;
          throw saveError;
        }
      }
    }
    throw serviceError("automation store stayed busy", "PROJECT_AUTOMATION_BUSY");
  }

  #ref(kind, commandId, scope) {
    return nonEmptyString(this.refFactory(kind, commandId, scope), `${kind} reference`, 256);
  }

  #replay(existing, command, inputHash, loaded) {
    assertCommandReplay(existing, { commandId: command.commandId, inputHash });
    if (existing.type !== command.type) throw serviceError("automation command receipt type changed", "PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT");
    if (existing.outcome === "rejected") throw stableRejectedError(existing, true);
    return this.#acceptedResult(existing, true, loaded);
  }

  #acceptedResult(receipt, duplicate, loaded) {
    const result = { ok: true, duplicate, revision: loaded.revision, receipt };
    if (receipt.definitionRef !== undefined) {
      const definition = loaded.document.definitions.find((item) => item.definitionRef === receipt.definitionRef);
      if (definition !== undefined) result.definition = definition;
    }
    if (receipt.runRef !== undefined) {
      const run = loaded.document.runs.find((item) => item.runRef === receipt.runRef);
      if (run !== undefined) result.run = run;
    }
    if (receipt.approvalRef !== undefined) {
      const approval = loaded.document.approvals.find((item) => item.approvalRef === receipt.approvalRef);
      if (approval !== undefined) result.approval = approval;
    }
    return deepFreeze(result);
  }

  async #executeFresh(command, inputHash, resolvedActor, trustedActor, loaded) {
    const timestamp = toIso(this.now);
    if (command.type === "definition.create" || command.type === "definition.update") {
      const definition = this.#definition(command, loaded.document);
      const stored = await this.store.saveDefinition({ definition, commandId: command.commandId, inputHash, expectedRevision: loaded.revision, completedAt: timestamp });
      const current = await this.store.load();
      return this.#acceptedResult(stored.receipt, stored.duplicate === true, current);
    }
    const domainCommand = this.#domainCommand(command, loaded.document);
    const stored = await this.store.executeCommand({ command: domainCommand, trustedActor: resolvedActor, inputHash, expectedRevision: loaded.revision, completedAt: timestamp });
    const current = await this.store.load();
    return this.#acceptedResult(stored.receipt, stored.duplicate === true, current);
  }

  #definition(command, document) {
    if (command.type === "definition.create") {
      const definitionRef = this.#ref("definition", command.commandId);
      const stepRef = this.#ref("step", command.commandId, definitionRef);
      return normalizeAutomationDefinition({
        schemaVersion: 1,
        definitionRef,
        revision: 1,
        status: command.payload.status ?? "enabled",
        name: command.payload.name,
        trigger: { kind: "manual" },
        steps: [{
          stepRef,
          order: 0,
          kind: "project_task.transition",
          taskRef: command.payload.taskRef,
          targetStatus: command.payload.targetStatus,
          ...(command.payload.blockReason === undefined ? {} : { blockReason: command.payload.blockReason }),
          approvalPolicy: { kind: "one_of_roles", roles: ["owner", "maintainer"] },
        }],
      });
    }
    const current = document.definitions.find((item) => item.definitionRef === command.definitionRef);
    if (current === undefined) throw serviceError("automation definition was not found", "PROJECT_AUTOMATION_DEFINITION_NOT_FOUND");
    if (current.revision !== command.expectedRevision) throw serviceError("automation definition revision changed", "PROJECT_AUTOMATION_CONFLICT", { currentRevision: current.revision });
    const step = current.steps[0];
    const blockReason = Object.hasOwn(command.payload, "blockReason") ? command.payload.blockReason : step.blockReason;
    return normalizeAutomationDefinition({
      ...current,
      revision: current.revision + 1,
      ...(command.payload.status === undefined ? {} : { status: command.payload.status }),
      ...(command.payload.name === undefined ? {} : { name: command.payload.name }),
      steps: [{
        ...step,
        ...(command.payload.taskRef === undefined ? {} : { taskRef: command.payload.taskRef }),
        ...(command.payload.targetStatus === undefined ? {} : { targetStatus: command.payload.targetStatus }),
        ...(blockReason === undefined || blockReason === null ? {} : { blockReason }),
      }],
    });
  }

  #domainCommand(command, document) {
    if (command.type === "manual_run") {
      const definition = document.definitions.find((item) => item.definitionRef === command.definitionRef);
      if (definition === undefined) throw serviceError("automation definition was not found", "PROJECT_AUTOMATION_DEFINITION_NOT_FOUND");
      if (definition.revision !== command.expectedRevision) throw serviceError("automation definition revision changed", "PROJECT_AUTOMATION_DEFINITION_STALE", { currentRevision: definition.revision });
      if (definition.status !== "enabled") throw serviceError("automation definition is disabled", "PROJECT_AUTOMATION_DEFINITION_DISABLED");
      return {
        commandId: command.commandId,
        type: command.type,
        payload: {
          definitionRef: definition.definitionRef,
          definitionRevision: definition.revision,
          triggerRef: this.#ref("trigger", command.commandId, definition.definitionRef),
          runRef: this.#ref("run", command.commandId, definition.definitionRef),
          taskRef: definition.steps[0].taskRef,
          expectedTaskRevision: command.payload.expectedTaskRevision,
        },
      };
    }
    const run = document.runs.find((item) => item.runRef === command.runRef);
    if (run === undefined) throw serviceError("automation run was not found", "PROJECT_AUTOMATION_RUN_NOT_FOUND");
    if (run.revision !== command.expectedRevision) throw serviceError("automation run revision changed", "PROJECT_AUTOMATION_CONFLICT", { currentRevision: run.revision });
    const payload = { runRef: run.runRef };
    if (command.type === "approve" || command.type === "reject") payload.approvalRef = this.#ref("approval", command.commandId, run.runRef);
    if (command.payload.reasonCode !== undefined) payload.reasonCode = command.payload.reasonCode;
    return { commandId: command.commandId, type: command.type, expectedRunRevision: command.expectedRevision, payload };
  }

  #rejectedReceipt(command, inputHash, error, completedAt) {
    const definitionCommand = command.type.startsWith("definition.") || command.type === "manual_run";
    const definitionRef = command.type === "definition.create" ? this.#ref("definition", command.commandId) : command.definitionRef;
    return normalizeAutomationCommandReceipt({
      commandId: command.commandId,
      inputHash,
      type: command.type,
      outcome: "rejected",
      ...(definitionCommand ? { definitionRef } : { runRef: command.runRef }),
      completedAt,
      errorCode: error.code,
    });
  }
}

function taskErrorRetryable(error) {
  const code = typeof error?.code === "string" ? error.code : "PROJECT_AUTOMATION_TASK_EFFECT_FAILED";
  return { code, retryable: !NON_RETRYABLE_TASK_ERRORS.has(code) };
}
function requireRunnerDependencies(store, taskService) {
  requireStore(store);
  if (typeof taskService?.getCommandReceipt !== "function" || typeof taskService?.executeCommand !== "function") throw new TypeError("taskService must provide getCommandReceipt and executeCommand");
}

class ProjectAutomationRunner {
  constructor({ store, taskService, taskExecution, projectRef, refFactory = defaultRefFactory, now = Date.now, maxRunsPerPump = DEFAULT_RUNNER_LIMIT, maxStoreRetries = MAX_STORE_RETRIES } = {}) {
    requireRunnerDependencies(store, taskService);
    this.store = store;
    this.taskService = taskService;
    this.taskExecution = taskExecution;
    if (taskExecution === undefined || taskExecution === null) throw new TypeError("taskExecution must be a Host-resolved system execution capability");
    this.projectRef = nonEmptyString(projectRef ?? store.projectRef, "projectRef", 128);
    if (typeof refFactory !== "function" || typeof now !== "function") throw new TypeError("refFactory and now must be functions");
    this.refFactory = refFactory;
    this.now = now;
    this.maxRunsPerPump = positiveInteger(maxRunsPerPump, "maxRunsPerPump");
    this.maxStoreRetries = positiveInteger(maxStoreRetries, "maxStoreRetries");
    this.tail = Promise.resolve();
    this.closing = false;
    this.closePromise = undefined;
  }

  recover(options) { return this.pump(options); }

  pump({ limit = this.maxRunsPerPump } = {}) {
    const bounded = positiveInteger(limit, "limit");
    if (bounded > this.maxRunsPerPump) throw new RangeError("limit exceeds maxRunsPerPump");
    if (this.closing) return Promise.reject(serviceError("automation runner is closed", "PROJECT_AUTOMATION_RUNNER_CLOSED"));
    const operation = this.tail.then(() => this.#pump(bounded));
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = this.tail.then(() => undefined);
    return this.closePromise;
  }

  async #pump(limit) {
    const initial = await this.store.load();
    const refs = initial.document.runs.filter((run) => RUNNER_STATUSES.has(run.status)).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.runRef.localeCompare(right.runRef)).slice(0, limit).map((run) => run.runRef);
    const results = [];
    for (const runRef of refs) results.push(await this.#process(runRef));
    return deepFreeze({ processed: results.length, results });
  }

  async #process(runRef) {
    let snapshot = await this.store.load();
    let run = snapshot.document.runs.find((item) => item.runRef === runRef);
    if (run === undefined || TERMINAL_RUN_STATUSES.has(run.status)) return { runRef, status: "terminal" };
    if (run.status === "queued") {
      const started = await this.#startRun(runRef, run.revision);
      run = started.run;
    }
    if (!RUNNER_STATUSES.has(run.status) || run.status === "queued") return { runRef, status: run.status };

    const queried = await this.#queryTaskReceipt(run.steps[0].taskCommandId);
    if (queried.kind === "deferred") return { runRef, status: "deferred", errorCode: queried.errorCode };
    if (queried.receipt !== undefined) {
      const receipt = this.#successReceipt(run, queried.receipt);
      const reconciled = await this.#reconcile(runRef, receipt);
      return { runRef, status: reconciled.run.status, recovered: true };
    }
    if (run.status === "cancel_requested") {
      const receipt = { effectKey: run.steps[0].effectKey, taskCommandId: run.steps[0].taskCommandId, status: "not_committed", finishedAt: toIso(this.now) };
      const reconciled = await this.#reconcile(runRef, receipt);
      return { runRef, status: reconciled.run.status, canceledBeforeCommit: true };
    }

    try {
      const taskResult = this.taskService.executeCommand(this.taskExecution, this.#taskCommand(run));
      const settled = taskResult && typeof taskResult.then === "function" ? await taskResult : taskResult;
      const receipt = this.#successReceipt(run, settled);
      const reconciled = await this.#reconcile(runRef, receipt);
      return { runRef, status: reconciled.run.status, executed: true };
    } catch (effectError) {
      // An execution error may occur after the Task transaction committed. Query the
      // durable Task receipt before classifying or persisting any Automation failure.
      const after = await this.#queryTaskReceipt(run.steps[0].taskCommandId);
      if (after.kind === "deferred") return { runRef, status: "deferred", errorCode: after.errorCode };
      if (after.receipt !== undefined) {
        const reconciled = await this.#reconcile(runRef, this.#successReceipt(run, after.receipt));
        return { runRef, status: reconciled.run.status, recovered: true };
      }
      const classified = taskErrorRetryable(effectError);
      const receipt = { effectKey: run.steps[0].effectKey, taskCommandId: run.steps[0].taskCommandId, status: "failed", errorCode: classified.code, retryable: classified.retryable, finishedAt: toIso(this.now) };
      const reconciled = await this.#reconcile(runRef, receipt);
      return { runRef, status: reconciled.run.status, errorCode: classified.code, retryable: classified.retryable };
    }
  }

  async #queryTaskReceipt(commandId) {
    try {
      const value = this.taskService.getCommandReceipt(this.taskExecution, { projectRef: this.projectRef, commandId });
      const receipt = value && typeof value.then === "function" ? await value : value;
      return { kind: "known", receipt };
    } catch (error) {
      return { kind: "deferred", errorCode: typeof error?.code === "string" ? error.code : "PROJECT_AUTOMATION_TASK_RECEIPT_UNKNOWN", transient: TRANSIENT_RECEIPT_QUERY_ERRORS.has(error?.code) };
    }
  }

  #taskCommand(run) {
    const step = run.steps[0];
    return {
      projectRef: this.projectRef,
      taskRef: step.taskRef,
      commandId: step.taskCommandId,
      eventRef: nonEmptyString(this.refFactory("task_event", step.taskCommandId, run.runRef), "task event reference", 256),
      type: "transition",
      expectedRevision: step.expectedTaskRevision,
      payload: { to: step.targetStatus, ...(step.blockReason === undefined ? {} : { blockReason: step.blockReason }) },
    };
  }

  #successReceipt(run, taskReceipt) {
    const step = run.steps[0];
    if (!isRecord(taskReceipt) || !Number.isSafeInteger(taskReceipt.projectRevision) || taskReceipt.projectRevision < 1 || !isRecord(taskReceipt.task) || taskReceipt.task.taskRef !== step.taskRef || taskReceipt.task.status !== step.targetStatus) {
      throw serviceError("durable Task receipt does not match the pinned Automation effect", "PROJECT_AUTOMATION_TASK_RECEIPT_INVALID");
    }
    const revision = taskReceipt.projectRevision;
    const resultReceiptRef = `taskreceipt_${createHash("sha256").update(`${step.taskCommandId}\0${revision}`).digest("base64url")}`;
    return { effectKey: step.effectKey, taskCommandId: step.taskCommandId, status: "succeeded", resultReceiptRef, finishedAt: toIso(this.now) };
  }

  async #startRun(runRef, expectedRunRevision) {
    for (let attempt = 0; attempt < this.maxStoreRetries; attempt += 1) {
      const loaded = await this.store.load();
      const run = loaded.document.runs.find((item) => item.runRef === runRef);
      if (run === undefined) throw serviceError("automation run was not found", "PROJECT_AUTOMATION_RUN_NOT_FOUND");
      if (run.status !== "queued") return { revision: loaded.revision, run };
      if (run.revision !== expectedRunRevision && attempt === 0) expectedRunRevision = run.revision;
      try { return await this.store.startRun({ runRef, expectedRunRevision: run.revision, expectedRevision: loaded.revision, startedAt: toIso(this.now) }); }
      catch (error) { if (error?.code !== "PROJECT_AUTOMATION_STORE_CONFLICT") throw error; }
    }
    throw serviceError("automation store stayed busy", "PROJECT_AUTOMATION_BUSY");
  }

  async #reconcile(runRef, receipt) {
    for (let attempt = 0; attempt < this.maxStoreRetries; attempt += 1) {
      const loaded = await this.store.load();
      try { return await this.store.reconcileEffectReceipt({ runRef, receipt, expectedRevision: loaded.revision }); }
      catch (error) { if (error?.code !== "PROJECT_AUTOMATION_STORE_CONFLICT") throw error; }
    }
    throw serviceError("automation store stayed busy", "PROJECT_AUTOMATION_BUSY");
  }
}

export {
  DEFAULT_RUNNER_LIMIT,
  MAX_STORE_RETRIES,
  ProjectAutomationCommandService,
  ProjectAutomationRunner,
  SERVICE_COMMAND_TYPES,
  actorBoundInputHash,
  normalizeAutomationServiceCommand,
  taskErrorRetryable,
};
