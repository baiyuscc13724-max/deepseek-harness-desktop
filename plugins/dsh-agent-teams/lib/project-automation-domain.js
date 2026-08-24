import { createHash } from "node:crypto";

const AUTOMATION_SCHEMA_VERSION = 1;
const DEFINITION_STATUSES = Object.freeze(["enabled", "disabled"]);
const TRIGGER_KINDS = Object.freeze(["manual"]);
const STEP_KINDS = Object.freeze(["project_task.transition"]);
const RUN_STATUSES = Object.freeze(["awaiting_approval", "queued", "running", "succeeded", "failed", "cancel_requested", "canceled"]);
const STEP_STATUSES = Object.freeze(["awaiting_approval", "queued", "running", "succeeded", "failed", "canceled"]);
const APPROVAL_DECISIONS = Object.freeze(["approved", "rejected"]);
const TASK_STATUSES = Object.freeze(["backlog", "todo", "in_progress", "in_review", "blocked", "done", "canceled"]);
const RUN_TRANSITIONS = Object.freeze({
  awaiting_approval: Object.freeze(["queued", "canceled"]), queued: Object.freeze(["running", "canceled"]),
  running: Object.freeze(["succeeded", "failed", "cancel_requested"]), cancel_requested: Object.freeze(["succeeded", "failed", "canceled"]),
  succeeded: Object.freeze([]), failed: Object.freeze(["queued"]), canceled: Object.freeze([]),
});
const STEP_TRANSITIONS = Object.freeze({
  awaiting_approval: Object.freeze(["queued", "canceled"]), queued: Object.freeze(["running", "canceled"]),
  running: Object.freeze(["succeeded", "failed", "canceled"]), failed: Object.freeze(["queued"]), succeeded: Object.freeze([]), canceled: Object.freeze([]),
});
const AUTOMATION_COMMAND_TYPES = Object.freeze(["manual_run", "approve", "reject", "retry", "cancel"]);
const AUTOMATION_COMMAND_RECEIPT_TYPES = Object.freeze(["definition.create", "definition.update", ...AUTOMATION_COMMAND_TYPES]);
const LEDGER_EVENT_TYPES = Object.freeze([
  "definition.created", "definition.updated", "run.triggered", "run.created", "approval.recorded", "approval.approved", "approval.rejected",
  "retry.requested", "cancel.requested", "run.queued", "run.started", "run.cancel_requested", "run.succeeded", "run.failed", "run.canceled", "run.recovered",
  "step.queued", "step.started", "step.effect_committed", "step.succeeded", "step.failed", "step.retried", "step.canceled",
]);
const NON_RETRYABLE_EFFECT_ERROR_CODES = new Set([
  "PROJECT_TASK_CONFLICT", "PROJECT_TASK_INVALID_TRANSITION", "PROJECT_TASK_FORBIDDEN", "PROJECT_TASK_REQUIREMENTS_STALE",
  "PROJECT_TASK_DEPENDENCY_BLOCKED", "PROJECT_TASK_REVIEW_REQUIRED", "PROJECT_TASK_ATTEMPT_INVALID", "PROJECT_TASK_ATTEMPT_NOT_SUBMITTED",
  "PROJECT_AUTOMATION_INPUT_INVALID", "PROJECT_AUTOMATION_DEFINITION_STALE", "PROJECT_AUTOMATION_APPROVAL_FORBIDDEN",
]);
const DEFINITION_KEYS = new Set(["schemaVersion", "definitionRef", "revision", "status", "name", "trigger", "steps"]);
const DEFINITION_TRIGGER_KEYS = new Set(["kind"]);
const DEFINITION_STEP_KEYS = new Set(["stepRef", "order", "kind", "taskRef", "targetStatus", "blockReason", "approvalPolicy"]);
const APPROVAL_POLICY_KEYS = new Set(["kind", "roles"]);
const MANUAL_TRIGGER_KEYS = new Set(["triggerRef", "commandId", "requestedAt", "input"]);
const MANUAL_TRIGGER_FACT_KEYS = new Set(["triggerRef", "kind", "commandId", "definitionRef", "definitionRevision", "requestedAt", "input", "inputHash"]);
const TRIGGER_INPUT_KEYS = new Set(["taskRef", "expectedTaskRevision"]);
const RUN_INPUT_KEYS = new Set(["runRef", "createdAt"]);
const APPROVAL_INPUT_KEYS = new Set(["approvalRef", "commandId", "expectedRunRevision", "decidedAt"]);
const RETRY_INPUT_KEYS = new Set(["commandId", "expectedRunRevision", "requestedAt"]);
const EFFECT_IDENTITY_KEYS = new Set(["runRef", "stepRef"]);
const CANCEL_INPUT_KEYS = new Set(["commandId", "expectedRunRevision", "requestedAt"]);
const RECEIPT_KEYS = new Set(["effectKey", "taskCommandId", "status", "resultReceiptRef", "errorCode", "retryable", "finishedAt"]);
const COMMAND_KEYS = new Set(["commandId", "type", "expectedRunRevision", "payload"]);
const COMMAND_SPECS = Object.freeze({
  manual_run: Object.freeze({ allowed: new Set(["definitionRef", "definitionRevision", "triggerRef", "runRef", "taskRef", "expectedTaskRevision"]), required: Object.freeze(["definitionRef", "definitionRevision", "triggerRef", "runRef", "taskRef", "expectedTaskRevision"]), expectedRunRevision: "forbidden" }),
  approve: Object.freeze({ allowed: new Set(["runRef", "approvalRef"]), required: Object.freeze(["runRef", "approvalRef"]), expectedRunRevision: "required" }),
  reject: Object.freeze({ allowed: new Set(["runRef", "approvalRef", "reasonCode"]), required: Object.freeze(["runRef", "approvalRef"]), expectedRunRevision: "required" }),
  retry: Object.freeze({ allowed: new Set(["runRef", "reasonCode"]), required: Object.freeze(["runRef"]), expectedRunRevision: "required" }),
  cancel: Object.freeze({ allowed: new Set(["runRef", "reasonCode"]), required: Object.freeze(["runRef"]), expectedRunRevision: "required" }),
});
const LEDGER_KEYS = new Set(["entryRef", "ledgerRef", "runRef", "stepRunRef", "type", "commandId", "effectKey", "inputHash", "fromStatus", "toStatus", "errorCode", "occurredAt", "definitionRef", "definitionRevision", "triggerRef", "approvalRef", "actorRef", "actorRole", "taskCommandId", "resultReceiptRef", "attempt", "reasonCode"]);
const LEDGER_AUDIT_KEYS = Object.freeze(["definitionRef", "definitionRevision", "triggerRef", "approvalRef", "actorRef", "actorRole", "taskCommandId", "resultReceiptRef", "attempt", "reasonCode"]);
const PERSISTED_LEDGER_KEYS = new Set(["sequence", "previousHash", "entryHash", ...LEDGER_KEYS]);
const PERSISTED_RUN_KEYS = new Set(["runRef", "definitionRef", "definitionRevision", "definitionSnapshot", "triggerRef", "triggerSnapshot", "revision", "status", "createdAt", "startedAt", "finishedAt", "cancelRequestedAt", "approvalRefs", "steps", "error"]);
const PERSISTED_STEP_KEYS = new Set(["stepRunRef", "stepRef", "attempt", "effectKey", "status", "taskRef", "expectedTaskRevision", "targetStatus", "blockReason", "taskCommandId", "startedAt", "finishedAt", "resultReceiptRef", "error"]);
const PERSISTED_ERROR_KEYS = new Set(["code", "retryable"]);
const PERSISTED_APPROVAL_KEYS = new Set(["approvalRef", "runRef", "stepRunRef", "decision", "actorRef", "actorRole", "expectedRunRevision", "decidedAt", "commandId"]);
const COMMAND_RECEIPT_KEYS = new Set(["commandId", "inputHash", "type", "outcome", "definitionRef", "runRef", "approvalRef", "resultRevision", "completedAt", "errorCode"]);
const FORBIDDEN_INPUT_KEYS = new Set([
  "actor", "actorid", "actorref", "session", "sessionid", "sessionref", "userid", "deviceid", "accountid", "email",
  "role", "authority", "authorities", "projectref", "prompt", "url", "script", "path", "env",
]);
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_INPUT_DEPTH = 32;

function domainError(message, code, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isPlainJsonObject(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function normalizedInputKey(key) { return key.replace(/[-_]/gu, "").toLocaleLowerCase("en-US"); }
function assertPlainJsonContainer(value, field) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new TypeError(`${field} must not contain symbol keys`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) throw new TypeError(`${field} must not contain sparse array holes`);
    if (keys.some((key) => key !== "length" && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length))) throw new TypeError(`${field} array must not contain custom properties`);
  }
  for (const key of keys) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) throw new TypeError(`${field}.${key} must be an enumerable JSON data property`);
  }
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function positiveInteger(value, field) { if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`); return value; }
function isoTimestamp(value, field) {
  const result = nonEmptyString(value, field, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) || !Number.isFinite(Date.parse(result))) throw new TypeError(`${field} must be an offset ISO timestamp`);
  return result;
}
function assertAllowedKeys(value, allowed, field) {
  if (!isPlainJsonObject(value)) throw new TypeError(`${field} must be a plain JSON object`);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) throw new TypeError(`${field} contains unsupported fields: ${unsupported.join(", ")}`);
}
function assertNoForbiddenInput(value, field = "input", seen = new Set(), depth = 0) {
  if (depth > MAX_INPUT_DEPTH) throw domainError(`${field} exceeds the maximum JSON depth`, "PROJECT_AUTOMATION_INPUT_DEPTH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${field} must be a lossless JSON number`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${field} must contain only lossless JSON values`);
  if (seen.has(value)) throw new TypeError(`${field} must not contain cycles`);
  if (!Array.isArray(value) && !isPlainJsonObject(value)) throw new TypeError(`${field} must contain only plain JSON objects`);
  assertPlainJsonContainer(value, field);
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item, index) => assertNoForbiddenInput(item, `${field}[${index}]`, seen, depth + 1));
  else for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(normalizedInputKey(key))) throw domainError(`${field} contains forbidden self-reported or executable field ${key}`, "PROJECT_AUTOMATION_FORBIDDEN_INPUT", { field: key });
    assertNoForbiddenInput(child, `${field}.${key}`, seen, depth + 1);
  }
  seen.delete(value);
}
function assertBounded(value, field) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > MAX_INPUT_BYTES) throw new TypeError(`${field} exceeds the ${MAX_INPUT_BYTES} byte limit`);
}
function canonicalize(value, field = "value", seen = new Set(), depth = 0) {
  if (depth > MAX_INPUT_DEPTH) throw domainError(`${field} exceeds the maximum JSON depth`, "PROJECT_AUTOMATION_INPUT_DEPTH");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError(`${field} contains a non-lossless number`); return value; }
  if (typeof value !== "object") throw new TypeError(`${field} contains an unsupported value`);
  if (seen.has(value)) throw new TypeError(`${field} must not contain cycles`);
  if (!Array.isArray(value) && !isPlainJsonObject(value)) throw new TypeError(`${field} must contain only plain JSON objects`);
  assertPlainJsonContainer(value, field);
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item, index) => canonicalize(item, `${field}[${index}]`, seen, depth + 1));
  else { result = {}; for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key], `${field}.${key}`, seen, depth + 1); }
  seen.delete(value);
  return result;
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
function sha256Hex(value) { return createHash("sha256").update(value).digest("hex"); }
function sha256Base64Url(value) { return createHash("sha256").update(value).digest("base64url"); }
function deepFreeze(value) { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }
function hashAutomationInput(value) { assertNoForbiddenInput(value); assertBounded(value, "automation input"); return sha256Hex(canonicalJson(value)); }
function assertTrustedApprover(actor) {
  if (!isRecord(actor) || actor.kind !== "human" || !["owner", "maintainer"].includes(actor.role)) throw domainError("action requires a Host-resolved owner or maintainer human", "PROJECT_AUTOMATION_APPROVAL_FORBIDDEN");
  return { actorRef: nonEmptyString(actor.actorRef, "trustedActor.actorRef", 256), actorRole: actor.role };
}
function assertTrustedAutomationApprover(actor) {
  return deepFreeze(assertTrustedApprover(actor));
}
function assertExpectedRunRevision(run, revision) {
  if (!isRecord(run)) throw new TypeError("run must be an object");
  positiveInteger(revision, "expectedRunRevision");
  if (run.revision !== revision) throw domainError("automation run revision changed", "PROJECT_AUTOMATION_CONFLICT", { currentRevision: run.revision });
}
function assertDefinitionPinned(definition, runOrTrigger) {
  const normalized = normalizeAutomationDefinition(definition);
  if (!isRecord(runOrTrigger) || normalized.definitionRef !== runOrTrigger.definitionRef || normalized.revision !== runOrTrigger.definitionRevision) {
    throw domainError("automation execution is pinned to a different definition revision", "PROJECT_AUTOMATION_DEFINITION_STALE");
  }
  return normalized;
}
function automationEffectKey(input) {
  assertNoForbiddenInput(input, "effectIdentity"); assertAllowedKeys(input, EFFECT_IDENTITY_KEYS, "effectIdentity");
  const identity = { v: AUTOMATION_SCHEMA_VERSION, runRef: nonEmptyString(input.runRef, "runRef", 256), stepRef: nonEmptyString(input.stepRef, "stepRef", 256) };
  return `autoeff_${sha256Hex(canonicalJson(identity))}`;
}

function normalizeAutomationDefinition(input) {
  assertNoForbiddenInput(input, "definition"); assertBounded(input, "definition"); assertAllowedKeys(input, DEFINITION_KEYS, "definition");
  if (input.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw domainError(`definition schemaVersion must be ${AUTOMATION_SCHEMA_VERSION}`, "PROJECT_AUTOMATION_VERSION_UNSUPPORTED");
  if (!DEFINITION_STATUSES.includes(input.status)) throw new TypeError("definition.status must be enabled or disabled");
  assertAllowedKeys(input.trigger, DEFINITION_TRIGGER_KEYS, "definition.trigger");
  if (input.trigger.kind !== "manual") throw domainError("v1 supports only a manual trigger", "PROJECT_AUTOMATION_TRIGGER_UNSUPPORTED");
  if (!Array.isArray(input.steps) || input.steps.length !== 1) throw domainError("v1 requires exactly one automation step", "PROJECT_AUTOMATION_STEP_COUNT");
  const step = input.steps[0]; assertAllowedKeys(step, DEFINITION_STEP_KEYS, "definition.steps[0]");
  if (step.kind !== "project_task.transition") throw domainError("v1 supports only project_task.transition", "PROJECT_AUTOMATION_STEP_UNSUPPORTED");
  if (step.order !== 0) throw new TypeError("definition.steps[0].order must be 0");
  if (!TASK_STATUSES.includes(step.targetStatus)) throw new TypeError("definition.steps[0].targetStatus is unsupported");
  if (["in_review", "done"].includes(step.targetStatus)) throw domainError("v1 automation cannot target a review-gated task status without pinned attempt and review references", "PROJECT_AUTOMATION_TARGET_UNSUPPORTED");
  const blockReason = step.blockReason === undefined ? undefined : nonEmptyString(step.blockReason, "definition.steps[0].blockReason", 4_000);
  if (step.targetStatus === "blocked" && blockReason === undefined) throw domainError("blocked transition requires blockReason", "PROJECT_AUTOMATION_BLOCK_REASON_REQUIRED");
  if (step.targetStatus !== "blocked" && blockReason !== undefined) throw new TypeError("blockReason is allowed only for blocked transitions");
  assertAllowedKeys(step.approvalPolicy, APPROVAL_POLICY_KEYS, "definition.steps[0].approvalPolicy");
  if (step.approvalPolicy.kind !== "one_of_roles" || !Array.isArray(step.approvalPolicy.roles) || step.approvalPolicy.roles.length !== 2 || !["owner", "maintainer"].every((role) => step.approvalPolicy.roles.includes(role))) {
    throw domainError("v1 approvalPolicy must require one of owner or maintainer", "PROJECT_AUTOMATION_APPROVAL_REQUIRED");
  }
  return deepFreeze({
    schemaVersion: AUTOMATION_SCHEMA_VERSION, definitionRef: nonEmptyString(input.definitionRef, "definition.definitionRef", 256), revision: positiveInteger(input.revision, "definition.revision"),
    status: input.status, name: nonEmptyString(input.name, "definition.name", 500), trigger: { kind: "manual" },
    steps: [{ stepRef: nonEmptyString(step.stepRef, "definition.steps[0].stepRef", 256), order: 0, kind: "project_task.transition", taskRef: nonEmptyString(step.taskRef, "definition.steps[0].taskRef", 256), targetStatus: step.targetStatus, ...(blockReason === undefined ? {} : { blockReason }), approvalPolicy: { kind: "one_of_roles", roles: ["owner", "maintainer"] } }],
  });
}
function normalizeManualTrigger(definition, input) {
  const normalized = normalizeAutomationDefinition(definition);
  if (normalized.status !== "enabled") throw domainError("manual trigger requires an enabled definition", "PROJECT_AUTOMATION_DEFINITION_DISABLED");
  assertNoForbiddenInput(input, "manualTriggerFact"); assertAllowedKeys(input, MANUAL_TRIGGER_FACT_KEYS, "manualTriggerFact"); assertAllowedKeys(input.input, TRIGGER_INPUT_KEYS, "manualTriggerFact.input");
  if (input.kind !== "manual") throw domainError("persisted trigger kind must be manual", "PROJECT_AUTOMATION_TRIGGER_INVALID");
  if (input.definitionRef !== normalized.definitionRef || input.definitionRevision !== normalized.revision) throw domainError("manual trigger is pinned to a different definition revision", "PROJECT_AUTOMATION_DEFINITION_STALE");
  const taskInput = { taskRef: nonEmptyString(input.input.taskRef, "manualTriggerFact.input.taskRef", 256), expectedTaskRevision: positiveInteger(input.input.expectedTaskRevision, "manualTriggerFact.input.expectedTaskRevision") };
  if (taskInput.taskRef !== normalized.steps[0].taskRef) throw domainError("manual trigger task does not match the pinned definition step", "PROJECT_AUTOMATION_INPUT_INVALID");
  const base = { triggerRef: nonEmptyString(input.triggerRef, "manualTriggerFact.triggerRef", 256), kind: "manual", commandId: nonEmptyString(input.commandId, "manualTriggerFact.commandId", 256), definitionRef: normalized.definitionRef, definitionRevision: normalized.revision, requestedAt: isoTimestamp(input.requestedAt, "manualTriggerFact.requestedAt"), input: taskInput };
  const expectedHash = hashAutomationInput({ definitionRef: base.definitionRef, definitionRevision: base.definitionRevision, input: taskInput });
  if (input.inputHash !== expectedHash) throw domainError("manual trigger inputHash does not match its pinned input", "PROJECT_AUTOMATION_TRIGGER_INVALID");
  return deepFreeze({ ...base, inputHash: expectedHash });
}
function createManualTrigger(definition, input) {
  const normalized = normalizeAutomationDefinition(definition);
  if (normalized.status !== "enabled") throw domainError("manual trigger requires an enabled definition", "PROJECT_AUTOMATION_DEFINITION_DISABLED");
  assertNoForbiddenInput(input, "manualTrigger"); assertAllowedKeys(input, MANUAL_TRIGGER_KEYS, "manualTrigger"); assertAllowedKeys(input.input, TRIGGER_INPUT_KEYS, "manualTrigger.input");
  const taskInput = { taskRef: nonEmptyString(input.input.taskRef, "manualTrigger.input.taskRef", 256), expectedTaskRevision: positiveInteger(input.input.expectedTaskRevision, "manualTrigger.input.expectedTaskRevision") };
  const base = { triggerRef: nonEmptyString(input.triggerRef, "manualTrigger.triggerRef", 256), kind: "manual", commandId: nonEmptyString(input.commandId, "manualTrigger.commandId", 256), definitionRef: normalized.definitionRef, definitionRevision: normalized.revision, requestedAt: isoTimestamp(input.requestedAt, "manualTrigger.requestedAt"), input: taskInput };
  return normalizeManualTrigger(normalized, { ...base, inputHash: hashAutomationInput({ definitionRef: base.definitionRef, definitionRevision: base.definitionRevision, input: taskInput }) });
}
function createManualRun(definition, trigger, input) {
  const normalizedTrigger = normalizeManualTrigger(definition, trigger);
  const normalized = assertDefinitionPinned(definition, normalizedTrigger);
  assertNoForbiddenInput(input, "runInput"); assertAllowedKeys(input, RUN_INPUT_KEYS, "runInput");
  const runRef = nonEmptyString(input.runRef, "runInput.runRef", 256), createdAt = isoTimestamp(input.createdAt, "runInput.createdAt"), definitionStep = normalized.steps[0];
  const effectKey = automationEffectKey({ runRef, stepRef: definitionStep.stepRef });
  return deepFreeze({
    runRef, definitionRef: normalized.definitionRef, definitionRevision: normalized.revision, definitionSnapshot: normalized, triggerRef: normalizedTrigger.triggerRef, triggerSnapshot: normalizedTrigger,
    revision: 1, status: "awaiting_approval", createdAt, approvalRefs: [],
    steps: [{ stepRunRef: `${runRef}:${definitionStep.stepRef}`, stepRef: definitionStep.stepRef, attempt: 1, effectKey, status: "awaiting_approval", taskRef: normalizedTrigger.input.taskRef, expectedTaskRevision: normalizedTrigger.input.expectedTaskRevision, targetStatus: definitionStep.targetStatus, ...(definitionStep.blockReason === undefined ? {} : { blockReason: definitionStep.blockReason }), taskCommandId: effectKey }],
  });
}
function approvalDecision(run, input, trustedActor, decision) {
  const actor = assertTrustedApprover(trustedActor);
  if (!isRecord(run) || run.status !== "awaiting_approval" || run.steps?.[0]?.status !== "awaiting_approval") throw domainError("run is not awaiting approval", "PROJECT_AUTOMATION_APPROVAL_INVALID");
  assertNoForbiddenInput(input, "approvalInput"); assertAllowedKeys(input, APPROVAL_INPUT_KEYS, "approvalInput"); assertExpectedRunRevision(run, input.expectedRunRevision);
  const approvalRef = nonEmptyString(input.approvalRef, "approvalInput.approvalRef", 256), decidedAt = isoTimestamp(input.decidedAt, "approvalInput.decidedAt");
  const approval = deepFreeze({ approvalRef, runRef: run.runRef, stepRunRef: run.steps[0].stepRunRef, decision, actorRef: actor.actorRef, actorRole: actor.actorRole, expectedRunRevision: input.expectedRunRevision, decidedAt, commandId: nonEmptyString(input.commandId, "approvalInput.commandId", 256) });
  const status = decision === "approved" ? "queued" : "canceled";
  return deepFreeze({ approval, run: { ...run, revision: run.revision + 1, status, approvalRefs: [...run.approvalRefs, approvalRef], ...(status === "canceled" ? { finishedAt: decidedAt } : {}), steps: [{ ...run.steps[0], status, ...(status === "canceled" ? { finishedAt: decidedAt } : {}) }] } });
}
function approveRun(run, input, actor) { return approvalDecision(run, input, actor, "approved"); }
function rejectRun(run, input, actor) { return approvalDecision(run, input, actor, "rejected"); }
function markStepRunning(run, { startedAt } = {}) {
  if (!isRecord(run) || run.status !== "queued" || run.steps?.[0]?.status !== "queued") throw domainError("only a queued run can start", "PROJECT_AUTOMATION_RUN_TRANSITION");
  const timestamp = isoTimestamp(startedAt, "startedAt");
  return deepFreeze({ ...run, revision: run.revision + 1, status: "running", startedAt: run.startedAt ?? timestamp, steps: [{ ...run.steps[0], status: "running", startedAt: timestamp }] });
}
function isNonRetryableEffectError(errorCode) {
  if (typeof errorCode !== "string" || errorCode === "") return true;
  const normalized = errorCode.toLocaleUpperCase("en-US");
  return NON_RETRYABLE_EFFECT_ERROR_CODES.has(normalized) || /(?:^|_)(?:NOT_FOUND|CONFLICT|STALE|INVALID|FORBIDDEN|REQUIRED|UNSUPPORTED|REVOKED|UNAUTHORIZED|PERMISSION|DENIED|CANCELED|CANCELLED)(?:_|$)/u.test(normalized);
}
function effectError(errorCode, requestedRetryable) {
  const code = nonEmptyString(errorCode, "errorCode", 256);
  return deepFreeze({ code, retryable: requestedRetryable === true && !isNonRetryableEffectError(code) });
}
function failStep(run, { errorCode, retryable, finishedAt } = {}) {
  if (!isRecord(run) || !["running", "cancel_requested"].includes(run.status) || run.steps?.[0]?.status !== "running") throw domainError("only a running step can fail", "PROJECT_AUTOMATION_STEP_TRANSITION");
  const timestamp = isoTimestamp(finishedAt, "finishedAt"), error = effectError(errorCode, retryable);
  return deepFreeze({ ...run, revision: run.revision + 1, status: "failed", finishedAt: timestamp, error, steps: [{ ...run.steps[0], status: "failed", finishedAt: timestamp, error }] });
}
function retryFailedStep(definition, run, input, trustedActor) {
  assertTrustedApprover(trustedActor); assertDefinitionPinned(definition, run); assertNoForbiddenInput(input, "retryInput"); assertAllowedKeys(input, RETRY_INPUT_KEYS, "retryInput"); assertExpectedRunRevision(run, input.expectedRunRevision);
  if (run.status !== "failed" || run.steps?.[0]?.status !== "failed" || run.steps[0].error?.retryable !== true || isNonRetryableEffectError(run.steps[0].error?.code)) throw domainError("only an explicitly retryable failed step can be retried", "PROJECT_AUTOMATION_RETRY_FORBIDDEN");
  nonEmptyString(input.commandId, "retryInput.commandId", 256); isoTimestamp(input.requestedAt, "retryInput.requestedAt");
  const { startedAt: ignoredRunStartedAt, finishedAt: ignoredRunFinishedAt, cancelRequestedAt: ignoredCancelRequestedAt, error: ignoredRunError, ...runBase } = run;
  const { startedAt: ignoredStepStartedAt, finishedAt: ignoredStepFinishedAt, error: ignoredStepError, ...stepBase } = run.steps[0];
  void ignoredRunStartedAt; void ignoredRunFinishedAt; void ignoredCancelRequestedAt; void ignoredRunError; void ignoredStepStartedAt; void ignoredStepFinishedAt; void ignoredStepError;
  return deepFreeze({ ...runBase, revision: run.revision + 1, status: "queued", steps: [{ ...stepBase, status: "queued", attempt: positiveInteger(stepBase.attempt, "step.attempt") + 1 }] });
}
function requestRunCancel(run, input, trustedActor) {
  assertNoForbiddenInput(input, "cancelInput"); assertAllowedKeys(input, CANCEL_INPUT_KEYS, "cancelInput"); assertTrustedApprover(trustedActor); assertExpectedRunRevision(run, input.expectedRunRevision);
  nonEmptyString(input.commandId, "cancelInput.commandId", 256);
  const requestedAt = isoTimestamp(input.requestedAt, "cancelInput.requestedAt");
  if (["awaiting_approval", "queued"].includes(run.status)) return deepFreeze({ ...run, revision: run.revision + 1, status: "canceled", finishedAt: requestedAt, steps: [{ ...run.steps[0], status: "canceled", finishedAt: requestedAt }] });
  if (run.status === "running") return deepFreeze({ ...run, revision: run.revision + 1, status: "cancel_requested", cancelRequestedAt: requestedAt });
  throw domainError("run cannot be canceled from its current status", "PROJECT_AUTOMATION_CANCEL_FORBIDDEN");
}
function reconcileRunFromEffectReceipt(run, input) {
  const receipt = normalizeEffectReceipt(input);
  if (!isRecord(run) || !["running", "cancel_requested"].includes(run.status) || run.steps?.[0]?.status !== "running") throw domainError("effect receipt requires a running or cancel-requested run", "PROJECT_AUTOMATION_RECEIPT_INVALID");
  if (receipt.effectKey !== run.steps[0].effectKey || receipt.taskCommandId !== run.steps[0].taskCommandId) throw domainError("effect receipt does not match the pinned step effect", "PROJECT_AUTOMATION_RECEIPT_CONFLICT");
  if (!["unknown", "succeeded", "failed", "not_committed"].includes(receipt.status)) throw new TypeError("effectReceipt.status is unsupported");
  if (receipt.status === "unknown") return run;
  const timestamp = isoTimestamp(receipt.finishedAt, "effectReceipt.finishedAt"), step = run.steps[0];
  if (receipt.status === "succeeded") {
    const resultReceiptRef = nonEmptyString(receipt.resultReceiptRef, "effectReceipt.resultReceiptRef", 256);
    return deepFreeze({ ...run, revision: run.revision + 1, status: "succeeded", finishedAt: timestamp, steps: [{ ...step, status: "succeeded", finishedAt: timestamp, resultReceiptRef }] });
  }
  if (receipt.status === "not_committed") {
    if (run.status !== "cancel_requested") throw domainError("not_committed can cancel only a cancel-requested run", "PROJECT_AUTOMATION_RECEIPT_INVALID");
    return deepFreeze({ ...run, revision: run.revision + 1, status: "canceled", finishedAt: timestamp, steps: [{ ...step, status: "canceled", finishedAt: timestamp }] });
  }
  return failStep(run, { errorCode: receipt.errorCode, retryable: receipt.retryable, finishedAt: timestamp });
}
function normalizeAutomationCommand(input) {
  assertNoForbiddenInput(input, "command"); assertBounded(input, "command"); assertAllowedKeys(input, COMMAND_KEYS, "command");
  if (!AUTOMATION_COMMAND_TYPES.includes(input.type)) throw new TypeError("command.type is unsupported");
  const spec = COMMAND_SPECS[input.type], payload = input.payload ?? {};
  assertAllowedKeys(payload, spec.allowed, "command.payload");
  const missing = spec.required.filter((key) => !Object.hasOwn(payload, key));
  if (missing.length > 0) throw domainError(`command.payload is missing required fields: ${missing.join(", ")}`, "PROJECT_AUTOMATION_COMMAND_INVALID");
  if (spec.expectedRunRevision === "forbidden" && input.expectedRunRevision !== undefined) throw domainError("manual_run must not include expectedRunRevision", "PROJECT_AUTOMATION_COMMAND_INVALID");
  if (spec.expectedRunRevision === "required" && input.expectedRunRevision === undefined) throw domainError(`${input.type} requires expectedRunRevision`, "PROJECT_AUTOMATION_COMMAND_INVALID");
  const normalizedPayload = canonicalize(payload, "command.payload");
  for (const key of ["definitionRef", "triggerRef", "runRef", "approvalRef", "taskRef", "reasonCode"]) if (normalizedPayload[key] !== undefined) normalizedPayload[key] = nonEmptyString(normalizedPayload[key], `command.payload.${key}`, key === "reasonCode" ? 500 : 256);
  for (const key of ["definitionRevision", "expectedTaskRevision"]) if (normalizedPayload[key] !== undefined) normalizedPayload[key] = positiveInteger(normalizedPayload[key], `command.payload.${key}`);
  const normalized = { commandId: nonEmptyString(input.commandId, "command.commandId", 256), type: input.type, ...(input.expectedRunRevision === undefined ? {} : { expectedRunRevision: positiveInteger(input.expectedRunRevision, "command.expectedRunRevision") }), payload: normalizedPayload };
  return deepFreeze({ ...normalized, inputHash: hashAutomationInput({ type: normalized.type, expectedRunRevision: normalized.expectedRunRevision ?? null, payload: normalized.payload }) });
}
function assertCommandReplay(existing, candidate) {
  if (!isRecord(existing) || !isRecord(candidate) || existing.commandId !== candidate.commandId || existing.inputHash !== candidate.inputHash) throw domainError("automation command replay input changed", "PROJECT_AUTOMATION_IDEMPOTENCY_CONFLICT");
  return true;
}
function persistedCopy(input, field) {
  const copy = canonicalize(input, field);
  assertBounded(copy, field);
  return copy;
}
function normalizePersistedError(input, field) {
  const copy = persistedCopy(input, field); assertAllowedKeys(copy, PERSISTED_ERROR_KEYS, field);
  const code = nonEmptyString(copy.code, `${field}.code`, 256);
  if (typeof copy.retryable !== "boolean") throw new TypeError(`${field}.retryable must be boolean`);
  if (copy.retryable && isNonRetryableEffectError(code)) throw domainError(`${field} marks a deterministic error retryable`, "PROJECT_AUTOMATION_PERSISTED_INVALID");
  return deepFreeze({ code, retryable: copy.retryable });
}
function assertAbsent(record, keys, field) {
  const present = keys.filter((key) => Object.hasOwn(record, key));
  if (present.length > 0) throw domainError(`${field} contains fields invalid for its status: ${present.join(", ")}`, "PROJECT_AUTOMATION_PERSISTED_INVALID");
}
function normalizePersistedRun(input) {
  const run = persistedCopy(input, "persistedRun"); assertAllowedKeys(run, PERSISTED_RUN_KEYS, "persistedRun");
  const definition = normalizeAutomationDefinition(run.definitionSnapshot), trigger = normalizeManualTrigger(definition, run.triggerSnapshot);
  const runRef = nonEmptyString(run.runRef, "persistedRun.runRef", 256);
  if (run.definitionRef !== definition.definitionRef || run.definitionRevision !== definition.revision || run.triggerRef !== trigger.triggerRef) throw domainError("persisted run snapshot bindings do not match", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  positiveInteger(run.revision, "persistedRun.revision"); isoTimestamp(run.createdAt, "persistedRun.createdAt");
  if (!RUN_STATUSES.includes(run.status)) throw new TypeError("persistedRun.status is unsupported");
  if (!Array.isArray(run.approvalRefs) || new Set(run.approvalRefs).size !== run.approvalRefs.length) throw new TypeError("persistedRun.approvalRefs must be a unique array");
  for (const [index, ref] of run.approvalRefs.entries()) nonEmptyString(ref, `persistedRun.approvalRefs[${index}]`, 256);
  if (!Array.isArray(run.steps) || run.steps.length !== 1) throw domainError("persisted run must contain exactly one step", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  const step = run.steps[0]; assertAllowedKeys(step, PERSISTED_STEP_KEYS, "persistedRun.steps[0]");
  const definitionStep = definition.steps[0], effectKey = automationEffectKey({ runRef, stepRef: definitionStep.stepRef });
  if (step.stepRunRef !== `${runRef}:${definitionStep.stepRef}` || step.stepRef !== definitionStep.stepRef || step.effectKey !== effectKey || step.taskCommandId !== effectKey || step.taskRef !== trigger.input.taskRef || step.expectedTaskRevision !== trigger.input.expectedTaskRevision || step.targetStatus !== definitionStep.targetStatus || step.blockReason !== definitionStep.blockReason) throw domainError("persisted step bindings do not match its snapshots", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  positiveInteger(step.attempt, "persistedRun.steps[0].attempt");
  const expectedStepStatus = { awaiting_approval: "awaiting_approval", queued: "queued", running: "running", cancel_requested: "running", succeeded: "succeeded", failed: "failed", canceled: "canceled" }[run.status];
  if (step.status !== expectedStepStatus) throw domainError("persisted run and step statuses are inconsistent", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  const hasRunStarted = Object.hasOwn(run, "startedAt"), hasStepStarted = Object.hasOwn(step, "startedAt");
  if (hasRunStarted) isoTimestamp(run.startedAt, "persistedRun.startedAt");
  if (hasStepStarted) isoTimestamp(step.startedAt, "persistedRun.steps[0].startedAt");
  if (hasRunStarted !== hasStepStarted) throw domainError("persisted run and step startedAt must appear together", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  if (["running", "cancel_requested", "succeeded", "failed"].includes(run.status) && (!hasRunStarted || !hasStepStarted)) throw domainError("started timestamps are required after execution begins", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  if (run.status === "awaiting_approval") { if (run.approvalRefs.length !== 0) throw domainError("awaiting run cannot already reference approval", "PROJECT_AUTOMATION_PERSISTED_INVALID"); assertAbsent(run, ["startedAt", "finishedAt", "cancelRequestedAt", "error"], "persistedRun"); assertAbsent(step, ["startedAt", "finishedAt", "resultReceiptRef", "error"], "persistedRun.steps[0]"); }
  if (run.status === "queued") { if (run.approvalRefs.length === 0) throw domainError("queued run requires approval history", "PROJECT_AUTOMATION_PERSISTED_INVALID"); assertAbsent(run, ["finishedAt", "cancelRequestedAt", "error"], "persistedRun"); assertAbsent(step, ["startedAt", "finishedAt", "resultReceiptRef", "error"], "persistedRun.steps[0]"); }
  if (["running", "cancel_requested", "succeeded", "failed"].includes(run.status) && run.approvalRefs.length === 0) throw domainError("executed run requires approval history", "PROJECT_AUTOMATION_PERSISTED_INVALID");
  if (run.status === "running") { assertAbsent(run, ["finishedAt", "cancelRequestedAt", "error"], "persistedRun"); assertAbsent(step, ["finishedAt", "resultReceiptRef", "error"], "persistedRun.steps[0]"); }
  if (run.status === "cancel_requested") { isoTimestamp(run.cancelRequestedAt, "persistedRun.cancelRequestedAt"); assertAbsent(run, ["finishedAt", "error"], "persistedRun"); assertAbsent(step, ["finishedAt", "resultReceiptRef", "error"], "persistedRun.steps[0]"); }
  if (["succeeded", "failed", "canceled"].includes(run.status)) { isoTimestamp(run.finishedAt, "persistedRun.finishedAt"); isoTimestamp(step.finishedAt, "persistedRun.steps[0].finishedAt"); }
  if (["succeeded", "failed"].includes(run.status) && Object.hasOwn(run, "cancelRequestedAt")) isoTimestamp(run.cancelRequestedAt, "persistedRun.cancelRequestedAt");
  if (run.status === "succeeded") { nonEmptyString(step.resultReceiptRef, "persistedRun.steps[0].resultReceiptRef", 256); assertAbsent(run, ["error"], "persistedRun"); assertAbsent(step, ["error"], "persistedRun.steps[0]"); }
  if (run.status === "failed") { const runError = normalizePersistedError(run.error, "persistedRun.error"), stepError = normalizePersistedError(step.error, "persistedRun.steps[0].error"); if (canonicalJson(runError) !== canonicalJson(stepError)) throw domainError("persisted run and step errors differ", "PROJECT_AUTOMATION_PERSISTED_INVALID"); assertAbsent(step, ["resultReceiptRef"], "persistedRun.steps[0]"); }
  if (run.status === "canceled") {
    assertAbsent(run, ["error"], "persistedRun"); assertAbsent(step, ["resultReceiptRef", "error"], "persistedRun.steps[0]");
    if (hasRunStarted) isoTimestamp(run.cancelRequestedAt, "persistedRun.cancelRequestedAt");
    else assertAbsent(run, ["cancelRequestedAt"], "persistedRun");
  }
  return deepFreeze({ ...run, definitionSnapshot: definition, triggerSnapshot: trigger });
}
function normalizePersistedApproval(input) {
  const approval = persistedCopy(input, "persistedApproval"); assertAllowedKeys(approval, PERSISTED_APPROVAL_KEYS, "persistedApproval");
  if (!APPROVAL_DECISIONS.includes(approval.decision)) throw new TypeError("persistedApproval.decision is unsupported");
  if (!["owner", "maintainer"].includes(approval.actorRole)) throw new TypeError("persistedApproval.actorRole is unsupported");
  for (const key of ["approvalRef", "runRef", "stepRunRef", "actorRef", "commandId"]) nonEmptyString(approval[key], `persistedApproval.${key}`, 512);
  positiveInteger(approval.expectedRunRevision, "persistedApproval.expectedRunRevision"); isoTimestamp(approval.decidedAt, "persistedApproval.decidedAt");
  return deepFreeze(approval);
}
function normalizeEffectReceipt(input) {
  const receipt = persistedCopy(input, "effectReceipt"); assertAllowedKeys(receipt, RECEIPT_KEYS, "effectReceipt");
  nonEmptyString(receipt.effectKey, "effectReceipt.effectKey", 256); nonEmptyString(receipt.taskCommandId, "effectReceipt.taskCommandId", 256);
  if (!['unknown', 'succeeded', 'failed', 'not_committed'].includes(receipt.status)) throw new TypeError("effectReceipt.status is unsupported");
  if (receipt.status === "unknown") assertAbsent(receipt, ["resultReceiptRef", "errorCode", "retryable", "finishedAt"], "effectReceipt");
  if (receipt.status === "succeeded") { nonEmptyString(receipt.resultReceiptRef, "effectReceipt.resultReceiptRef", 256); isoTimestamp(receipt.finishedAt, "effectReceipt.finishedAt"); assertAbsent(receipt, ["errorCode", "retryable"], "effectReceipt"); }
  if (receipt.status === "failed") {
    const errorCode = nonEmptyString(receipt.errorCode, "effectReceipt.errorCode", 256); isoTimestamp(receipt.finishedAt, "effectReceipt.finishedAt");
    if (typeof receipt.retryable !== "boolean") throw new TypeError("effectReceipt.retryable must be boolean");
    if (receipt.retryable && isNonRetryableEffectError(errorCode)) throw domainError("deterministic effect failure cannot be retryable", "PROJECT_AUTOMATION_RECEIPT_INVALID");
    assertAbsent(receipt, ["resultReceiptRef"], "effectReceipt");
  }
  if (receipt.status === "not_committed") { isoTimestamp(receipt.finishedAt, "effectReceipt.finishedAt"); assertAbsent(receipt, ["resultReceiptRef", "errorCode", "retryable"], "effectReceipt"); }
  return deepFreeze(receipt);
}
function normalizeAutomationCommandReceipt(input) {
  const receipt = persistedCopy(input, "commandReceipt"); assertAllowedKeys(receipt, COMMAND_RECEIPT_KEYS, "commandReceipt");
  nonEmptyString(receipt.commandId, "commandReceipt.commandId", 256); if (!/^[a-f0-9]{64}$/u.test(receipt.inputHash)) throw new TypeError("commandReceipt.inputHash must be a SHA-256 hex digest");
  if (!AUTOMATION_COMMAND_RECEIPT_TYPES.includes(receipt.type) || !["accepted", "rejected"].includes(receipt.outcome)) throw new TypeError("commandReceipt type or outcome is unsupported");
  isoTimestamp(receipt.completedAt, "commandReceipt.completedAt");
  const definitionCommand = receipt.type === "definition.create" || receipt.type === "definition.update", manual = receipt.type === "manual_run", approval = receipt.type === "approve" || receipt.type === "reject";
  if (receipt.outcome === "accepted") {
    positiveInteger(receipt.resultRevision, "commandReceipt.resultRevision"); assertAbsent(receipt, ["errorCode"], "commandReceipt");
    if (definitionCommand) { nonEmptyString(receipt.definitionRef, "commandReceipt.definitionRef", 256); assertAbsent(receipt, ["runRef", "approvalRef"], "commandReceipt"); }
    else {
      nonEmptyString(receipt.runRef, "commandReceipt.runRef", 256);
      if (manual) { nonEmptyString(receipt.definitionRef, "commandReceipt.definitionRef", 256); assertAbsent(receipt, ["approvalRef"], "commandReceipt"); }
      else if (approval) { nonEmptyString(receipt.approvalRef, "commandReceipt.approvalRef", 256); assertAbsent(receipt, ["definitionRef"], "commandReceipt"); }
      else assertAbsent(receipt, ["definitionRef", "approvalRef"], "commandReceipt");
    }
  } else {
    nonEmptyString(receipt.errorCode, "commandReceipt.errorCode", 256); assertAbsent(receipt, ["resultRevision", "approvalRef"], "commandReceipt");
    if (definitionCommand || manual) { nonEmptyString(receipt.definitionRef, "commandReceipt.definitionRef", 256); assertAbsent(receipt, ["runRef"], "commandReceipt"); }
    else { nonEmptyString(receipt.runRef, "commandReceipt.runRef", 256); assertAbsent(receipt, ["definitionRef"], "commandReceipt"); }
  }
  return deepFreeze(receipt);
}
function assertLedgerEventAuditShape(entry, field) {
  const definitionEvent = entry.type === "definition.created" || entry.type === "definition.updated";
  const runCreationEvent = entry.type === "run.triggered" || entry.type === "run.created";
  const approvalEvent = entry.type.startsWith("approval.");
  const retryEvent = entry.type === "retry.requested" || entry.type === "step.retried";
  const cancelEvent = entry.type === "cancel.requested";
  const stepEvent = entry.type.startsWith("step.");
  const allowed = new Set();
  if (definitionEvent || runCreationEvent) { allowed.add("definitionRef"); allowed.add("definitionRevision"); }
  if (runCreationEvent) allowed.add("triggerRef");
  if (approvalEvent) { allowed.add("approvalRef"); allowed.add("actorRef"); allowed.add("actorRole"); }
  if (stepEvent || entry.type === "retry.requested") { allowed.add("taskCommandId"); allowed.add("attempt"); }
  if (entry.type === "step.effect_committed" || entry.type === "step.succeeded") allowed.add("resultReceiptRef");
  if (retryEvent || cancelEvent || entry.type === "approval.rejected") allowed.add("reasonCode");
  assertAbsent(entry, LEDGER_AUDIT_KEYS.filter((key) => !allowed.has(key)), field);
  const required = [];
  if (definitionEvent || runCreationEvent) required.push("definitionRef", "definitionRevision");
  if (runCreationEvent) required.push("triggerRef");
  if (approvalEvent) required.push("approvalRef", "actorRef", "actorRole");
  if (stepEvent || entry.type === "retry.requested") required.push("taskCommandId", "attempt");
  if (entry.type === "step.effect_committed" || entry.type === "step.succeeded") required.push("resultReceiptRef");
  const missing = required.filter((key) => !Object.hasOwn(entry, key));
  if (missing.length > 0) throw domainError(`${field} is missing audit references: ${missing.join(", ")}`, "PROJECT_AUTOMATION_LEDGER_INVALID");
  for (const key of ["definitionRef", "triggerRef", "approvalRef", "actorRef", "taskCommandId", "resultReceiptRef", "reasonCode"]) if (entry[key] !== undefined) nonEmptyString(entry[key], `${field}.${key}`, key === "reasonCode" ? 500 : 256);
  if (entry.definitionRevision !== undefined) positiveInteger(entry.definitionRevision, `${field}.definitionRevision`);
  if (entry.attempt !== undefined) positiveInteger(entry.attempt, `${field}.attempt`);
  if (entry.actorRole !== undefined && !["owner", "maintainer"].includes(entry.actorRole)) throw domainError(`${field}.actorRole is invalid`, "PROJECT_AUTOMATION_LEDGER_INVALID");
}
function normalizeLedgerEntries(input) {
  const entries = persistedCopy(input, "ledger"); if (!Array.isArray(entries)) throw new TypeError("ledger must be an array");
  const entryRefs = new Set(), ledgerRef = entries[0]?.ledgerRef;
  const persistedStatuses = new Set(["none", ...RUN_STATUSES, ...STEP_STATUSES]);
  for (const [index, entry] of entries.entries()) {
    assertAllowedKeys(entry, PERSISTED_LEDGER_KEYS, `ledger[${index}]`);
    if (entry.sequence !== index + 1 || !LEDGER_EVENT_TYPES.includes(entry.type)) throw domainError("ledger sequence or event type is invalid", "PROJECT_AUTOMATION_LEDGER_INVALID");
    nonEmptyString(entry.entryRef, `ledger[${index}].entryRef`, 256); nonEmptyString(entry.ledgerRef, `ledger[${index}].ledgerRef`, 256); isoTimestamp(entry.occurredAt, `ledger[${index}].occurredAt`);
    if (entryRefs.has(entry.entryRef) || entry.ledgerRef !== ledgerRef) throw domainError("ledger entryRef must be unique and ledgerRef must remain fixed", "PROJECT_AUTOMATION_LEDGER_INVALID");
    entryRefs.add(entry.entryRef);
    if (index === 0 ? entry.previousHash !== null : entry.previousHash !== entries[index - 1].entryHash) throw domainError("ledger previousHash chain is invalid", "PROJECT_AUTOMATION_LEDGER_INVALID");
    if (!/^[A-Za-z0-9_-]{43}$/u.test(entry.entryHash)) throw domainError("ledger entryHash encoding is invalid", "PROJECT_AUTOMATION_LEDGER_INVALID");
    const definitionEvent = entry.type === "definition.created" || entry.type === "definition.updated", stepEvent = entry.type.startsWith("step."), stepScopedEvent = stepEvent || entry.type.startsWith("approval.") || entry.type === "retry.requested" || entry.type === "cancel.requested";
    if (!definitionEvent) nonEmptyString(entry.runRef, `ledger[${index}].runRef`, 256); else assertAbsent(entry, ["runRef", "stepRunRef", "effectKey"], `ledger[${index}]`);
    if (stepScopedEvent && entry.type !== "cancel.requested") nonEmptyString(entry.stepRunRef, `ledger[${index}].stepRunRef`, 512); else if (!definitionEvent && !stepScopedEvent) assertAbsent(entry, ["stepRunRef"], `ledger[${index}]`); else if (entry.stepRunRef !== undefined) nonEmptyString(entry.stepRunRef, `ledger[${index}].stepRunRef`, 512);
    if (stepEvent) nonEmptyString(entry.effectKey, `ledger[${index}].effectKey`, 256);
    for (const key of ["commandId", "effectKey", "fromStatus", "toStatus", "errorCode"]) if (entry[key] !== undefined) nonEmptyString(entry[key], `ledger[${index}].${key}`, 256);
    for (const key of ["fromStatus", "toStatus"]) if (entry[key] !== undefined && !persistedStatuses.has(entry[key])) throw domainError(`ledger ${key} is invalid`, "PROJECT_AUTOMATION_LEDGER_INVALID");
    if (entry.inputHash !== undefined && !/^[a-f0-9]{64}$/u.test(entry.inputHash)) throw domainError("ledger inputHash encoding is invalid", "PROJECT_AUTOMATION_LEDGER_INVALID");
    if (entry.errorCode !== undefined && !["run.failed", "step.failed"].includes(entry.type)) throw domainError("ledger errorCode is invalid for this event", "PROJECT_AUTOMATION_LEDGER_INVALID");
    if (["run.failed", "step.failed"].includes(entry.type) && entry.errorCode === undefined) throw domainError("failed ledger event requires errorCode", "PROJECT_AUTOMATION_LEDGER_INVALID");
    assertLedgerEventAuditShape(entry, `ledger[${index}]`);
  }
  if (!verifyLedgerChain(entries)) throw domainError("ledger entry hash chain is invalid", "PROJECT_AUTOMATION_LEDGER_INVALID");
  return deepFreeze(entries);
}
function appendLedgerEntry(ledger, input) {
  if (!Array.isArray(ledger)) throw new TypeError("ledger must be an array");
  if (ledger.length > 0) normalizeLedgerEntries(ledger);
  input = persistedCopy(input, "ledgerEntry"); assertAllowedKeys(input, LEDGER_KEYS, "ledgerEntry");
  if (!LEDGER_EVENT_TYPES.includes(input.type)) throw new TypeError("ledgerEntry.type is unsupported");
  const entryRef = nonEmptyString(input.entryRef, "ledgerEntry.entryRef", 256);
  if (ledger.some((entry) => entry.entryRef === entryRef)) throw domainError("automation ledger entryRef already exists", "PROJECT_AUTOMATION_LEDGER_CONFLICT");
  const ledgerRef = nonEmptyString(input.ledgerRef, "ledgerEntry.ledgerRef", 256);
  if (ledger.length > 0 && ledger[0].ledgerRef !== ledgerRef) throw domainError("automation ledger identity cannot change", "PROJECT_AUTOMATION_LEDGER_CONFLICT");
  const definitionEvent = input.type === "definition.created" || input.type === "definition.updated";
  const runRef = input.runRef === undefined ? undefined : nonEmptyString(input.runRef, "ledgerEntry.runRef", 256);
  if (!definitionEvent && runRef === undefined) throw new TypeError("ledgerEntry.runRef is required for run, step, approval, retry, and cancel events");
  const body = {
    sequence: ledger.length + 1, previousHash: ledger.length === 0 ? null : ledger[ledger.length - 1].entryHash,
    entryRef, ledgerRef, ...(runRef === undefined ? {} : { runRef }),
    ...(input.stepRunRef === undefined ? {} : { stepRunRef: nonEmptyString(input.stepRunRef, "ledgerEntry.stepRunRef", 512) }), type: input.type,
    ...(input.commandId === undefined ? {} : { commandId: nonEmptyString(input.commandId, "ledgerEntry.commandId", 256) }),
    ...(input.effectKey === undefined ? {} : { effectKey: nonEmptyString(input.effectKey, "ledgerEntry.effectKey", 256) }),
    ...(input.inputHash === undefined ? {} : { inputHash: nonEmptyString(input.inputHash, "ledgerEntry.inputHash", 64) }),
    ...(input.fromStatus === undefined ? {} : { fromStatus: nonEmptyString(input.fromStatus, "ledgerEntry.fromStatus", 64) }),
    ...(input.toStatus === undefined ? {} : { toStatus: nonEmptyString(input.toStatus, "ledgerEntry.toStatus", 64) }),
    ...(input.errorCode === undefined ? {} : { errorCode: nonEmptyString(input.errorCode, "ledgerEntry.errorCode", 256) }),
    ...(input.definitionRef === undefined ? {} : { definitionRef: nonEmptyString(input.definitionRef, "ledgerEntry.definitionRef", 256) }),
    ...(input.definitionRevision === undefined ? {} : { definitionRevision: positiveInteger(input.definitionRevision, "ledgerEntry.definitionRevision") }),
    ...(input.triggerRef === undefined ? {} : { triggerRef: nonEmptyString(input.triggerRef, "ledgerEntry.triggerRef", 256) }),
    ...(input.approvalRef === undefined ? {} : { approvalRef: nonEmptyString(input.approvalRef, "ledgerEntry.approvalRef", 256) }),
    ...(input.actorRef === undefined ? {} : { actorRef: nonEmptyString(input.actorRef, "ledgerEntry.actorRef", 256) }),
    ...(input.actorRole === undefined ? {} : { actorRole: nonEmptyString(input.actorRole, "ledgerEntry.actorRole", 64) }),
    ...(input.taskCommandId === undefined ? {} : { taskCommandId: nonEmptyString(input.taskCommandId, "ledgerEntry.taskCommandId", 256) }),
    ...(input.resultReceiptRef === undefined ? {} : { resultReceiptRef: nonEmptyString(input.resultReceiptRef, "ledgerEntry.resultReceiptRef", 256) }),
    ...(input.attempt === undefined ? {} : { attempt: positiveInteger(input.attempt, "ledgerEntry.attempt") }),
    ...(input.reasonCode === undefined ? {} : { reasonCode: nonEmptyString(input.reasonCode, "ledgerEntry.reasonCode", 500) }), occurredAt: isoTimestamp(input.occurredAt, "ledgerEntry.occurredAt"),
  };
  assertBounded(body, "ledgerEntry");
  const result = deepFreeze([...ledger, { ...body, entryHash: sha256Base64Url(canonicalJson(body)) }]);
  normalizeLedgerEntries(result);
  return result;
}
function verifyLedgerChain(entries) {
  if (!Array.isArray(entries)) return false;
  try {
    let previousHash = null;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]; if (!isRecord(entry) || entry.sequence !== index + 1 || entry.previousHash !== previousHash) return false;
      const { entryHash, ...body } = entry; if (!/^[A-Za-z0-9_-]{43}$/u.test(entryHash) || sha256Base64Url(canonicalJson(body)) !== entryHash) return false; previousHash = entryHash;
    }
    return true;
  } catch { return false; }
}

export {
  APPROVAL_DECISIONS, AUTOMATION_COMMAND_RECEIPT_TYPES, AUTOMATION_COMMAND_TYPES, AUTOMATION_SCHEMA_VERSION, DEFINITION_STATUSES, LEDGER_EVENT_TYPES,
  RUN_STATUSES, RUN_TRANSITIONS, STEP_KINDS, STEP_STATUSES, STEP_TRANSITIONS, TRIGGER_KINDS, appendLedgerEntry, approveRun, assertCommandReplay,
  assertDefinitionPinned, assertExpectedRunRevision, assertTrustedAutomationApprover, automationEffectKey, canonicalJson, createManualRun, createManualTrigger, failStep,
  hashAutomationInput, markStepRunning, normalizeAutomationCommand, normalizeAutomationCommandReceipt, normalizeAutomationDefinition, normalizeEffectReceipt,
  normalizeEffectReceipt as normalizePersistedAutomationEffectReceipt, normalizeLedgerEntries, normalizeLedgerEntries as normalizePersistedAutomationLedger,
  normalizeManualTrigger, normalizePersistedApproval, normalizePersistedApproval as normalizePersistedAutomationApproval,
  normalizePersistedRun, normalizePersistedRun as normalizePersistedAutomationRun, reconcileRunFromEffectReceipt, rejectRun,
  requestRunCancel, retryFailedStep, verifyLedgerChain, verifyLedgerChain as verifyPersistedLedger,
};
