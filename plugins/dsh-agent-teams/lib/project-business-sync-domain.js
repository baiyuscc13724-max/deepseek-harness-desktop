import { createHash } from "node:crypto";

const BUSINESS_SYNC_VERSION = 1;
const BUSINESS_SYNC_MESSAGE_TYPES = Object.freeze(["hello", "capability", "task.command", "task.receipt", "event.pull", "event.page", "ack"]);
const BUSINESS_SYNC_TASK_ACTIONS = Object.freeze(["claim", "transition"]);
const BUSINESS_SYNC_AUTOMATION_ACTIONS = Object.freeze(["approve", "reject"]);
const BUSINESS_SYNC_TRANSITION_TARGETS = Object.freeze(["backlog", "todo", "in_progress", "canceled"]);
const BUSINESS_SYNC_MAX_BYTES = 32 * 1024;
const BUSINESS_SYNC_MAX_COMMAND_BYTES = 16 * 1024;
const BUSINESS_SYNC_MAX_DEPTH = 32;
const BUSINESS_SYNC_MAX_PAGE_ITEMS = 100;
const BUSINESS_SYNC_MAX_INFLIGHT = 8;
const BUSINESS_SYNC_STREAMS = Object.freeze(["task", "automation"]);
const BUSINESS_SYNC_ERROR_CODES = Object.freeze({
  INVALID: "PROJECT_BUSINESS_SYNC_INVALID",
  TOO_LARGE: "PROJECT_BUSINESS_SYNC_TOO_LARGE",
  REPLAY_CONFLICT: "PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT",
  CURSOR_CONFLICT: "PROJECT_BUSINESS_SYNC_CURSOR_CONFLICT",
  EVENT_GAP: "PROJECT_BUSINESS_SYNC_EVENT_GAP",
  RESET_REQUIRED: "PROJECT_BUSINESS_SYNC_RESET_REQUIRED",
});
const BUSINESS_SYNC_REJECTION_CODES = Object.freeze([
  ...Object.values(BUSINESS_SYNC_ERROR_CODES),
  "PROJECT_BUSINESS_SYNC_VERSION_UNSUPPORTED", "PROJECT_BUSINESS_SYNC_TARGET_INVALID", "PROJECT_BUSINESS_SYNC_FORBIDDEN",
  "PROJECT_BUSINESS_SYNC_MEMBER_REVOKED", "PROJECT_BUSINESS_SYNC_AUTHORITY_EPOCH_STALE", "PROJECT_BUSINESS_SYNC_BACKPRESSURE",
  "PROJECT_BUSINESS_SYNC_TIMEOUT", "PROJECT_BUSINESS_SYNC_CLOSED", "PROJECT_BUSINESS_SYNC_TRANSPORT_UNAVAILABLE",
  "PROJECT_BUSINESS_SYNC_NOT_FOUND", "PROJECT_BUSINESS_SYNC_CONFLICT",
]);
const PROJECT_BUSINESS_SYNC_INVALID = BUSINESS_SYNC_ERROR_CODES.INVALID;
const PROJECT_BUSINESS_SYNC_TOO_LARGE = BUSINESS_SYNC_ERROR_CODES.TOO_LARGE;
const PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT = BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT;
const PROJECT_BUSINESS_SYNC_CURSOR_CONFLICT = BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT;
const PROJECT_BUSINESS_SYNC_EVENT_GAP = BUSINESS_SYNC_ERROR_CODES.EVENT_GAP;
const PROJECT_BUSINESS_SYNC_RESET_REQUIRED = BUSINESS_SYNC_ERROR_CODES.RESET_REQUIRED;
const COMMON_KEYS = new Set(["version", "type", "messageRef", "sentAt", "replyTo"]);
const FORBIDDEN_KEYS = new Set([
  "projectRef", "deviceRef", "senderDeviceRef", "actor", "actorRef", "actorRole", "role", "authority", "authorityRef", "session", "sessionId",
  "eventRef", "approvalRef", "requirements", "requirementsText", "fileScope", "files", "filePath", "path", "prompt", "body", "comment", "commentBody",
  "memberRef", "memberId", "userRef", "userId", "ownerRef", "maintainerRef", "collaboratorRef", "agentRef", "teamRef", "execution", "executionRef", "grant", "permissions",
  "secret", "password", "token", "accessToken", "apiKey", "authorization", "credential", "encryptionKey", "privateKey", "publicKey", "effectKey", "taskCommandId", "resultReceiptRef", "definitionSnapshot", "triggerSnapshot",
  "cwd", "url", "script", "env", "headers",
]);

function syncError(message, code = BUSINESS_SYNC_ERROR_CODES.INVALID, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); return error; }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function allowedKeys(value, allowed, field) { if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw syncError(`${field} must be a plain object`); const extras = Object.keys(value).filter((key) => !allowed.has(key)); if (extras.length > 0) throw syncError(`${field} contains unsupported fields: ${extras.join(", ")}`); }
function requiredKeys(value, required, field) { const missing = required.filter((key) => !Object.hasOwn(value, key)); if (missing.length > 0) throw syncError(`${field} is missing required fields: ${missing.join(", ")}`); }
function nonEmptyString(value, field, max = 256) { if (typeof value !== "string" || value.trim() === "" || value.length > max) throw syncError(`${field} must be a non-empty string of at most ${max} characters`); return value; }
function boolean(value, field) { if (typeof value !== "boolean") throw syncError(`${field} must be boolean`); return value; }
function integer(value, field, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) throw syncError(`${field} must be a safe integer from ${min} through ${max}`); return value; }
function timestamp(value, field) { const result = nonEmptyString(value, field, 64); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(result) || !Number.isFinite(Date.parse(result))) throw syncError(`${field} must be an offset ISO timestamp`); return result; }
function digest(value, field) { const result = nonEmptyString(value, field, 64); if (!/^[a-f0-9]{64}$/u.test(result)) throw syncError(`${field} must be a lowercase SHA-256 digest`); return result; }
function optional(object, key, normalize) { return Object.hasOwn(object, key) ? { [key]: normalize(object[key], key) } : {}; }
function deepFreeze(value) { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; }

function canonicalCopy(value, field = "value", ancestors = new Set(), depth = 0, rejectForbidden = true) {
  if (depth > BUSINESS_SYNC_MAX_DEPTH) throw syncError(`${field} exceeds maximum depth ${BUSINESS_SYNC_MAX_DEPTH}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value) || Object.is(value, -0)) throw syncError(`${field} must be a finite JSON number other than -0`); return value; }
  if (typeof value !== "object") throw syncError(`${field} must contain only lossless JSON values`);
  if (ancestors.has(value)) throw syncError(`${field} must not contain a cycle`);
  const symbols = Object.getOwnPropertySymbols(value); if (symbols.length > 0) throw syncError(`${field} must not contain symbol keys`);
  const descriptors = Object.getOwnPropertyDescriptors(value), array = Array.isArray(value);
  if (array) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw syncError(`${field} must be a plain array`);
    const names = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
    if (names.some((key) => !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)) throw syncError(`${field} must not contain custom array properties`);
    if (names.length !== value.length) throw syncError(`${field} must not be sparse`);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) throw syncError(`${field}[${index}] must be an enumerable data property`);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw syncError(`${field} must be a plain object`);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor.get !== undefined || descriptor.set !== undefined || descriptor.enumerable !== true) throw syncError(`${field}.${key} must be an enumerable data property`);
      if (rejectForbidden && FORBIDDEN_KEYS.has(key)) throw syncError(`${field}.${key} is forbidden on the business wire`);
    }
  }
  const nextAncestors = new Set(ancestors); nextAncestors.add(value);
  if (array) return value.map((item, index) => canonicalCopy(descriptors[String(index)].value, `${field}[${index}]`, nextAncestors, depth + 1, rejectForbidden));
  const output = {};
  for (const key of Object.keys(descriptors).sort()) output[key] = canonicalCopy(descriptors[key].value, `${field}.${key}`, nextAncestors, depth + 1, rejectForbidden);
  return output;
}
function canonicalJson(value) { return JSON.stringify(canonicalCopy(value)); }
function assertEncodedLimit(value, limit, field = "message") { const bytes = Buffer.byteLength(JSON.stringify(value), "utf8"); if (bytes > limit) throw syncError(`${field} exceeds ${limit} bytes`, BUSINESS_SYNC_ERROR_CODES.TOO_LARGE, { bytes, limit }); return bytes; }
function normalizedStringArray(input, allowed, field) { if (!Array.isArray(input) || input.length > allowed.length) throw syncError(`${field} must be an array`); const result = input.map((item, index) => nonEmptyString(item, `${field}[${index}]`, 64)); if (new Set(result).size !== result.length || result.some((item) => !allowed.includes(item))) throw syncError(`${field} contains duplicates or unsupported values`); return result.sort(); }
function normalizeStream(input, field) { if (!BUSINESS_SYNC_STREAMS.includes(input)) throw syncError(`${field} must be task or automation`); return input; }
function normalizeCursors(input, field) { allowedKeys(input, new Set(BUSINESS_SYNC_STREAMS), field); requiredKeys(input, BUSINESS_SYNC_STREAMS, field); return deepFreeze({ task: integer(input.task, `${field}.task`), automation: integer(input.automation, `${field}.automation`) }); }
function common(message, type) {
  if (message.version !== BUSINESS_SYNC_VERSION || message.type !== type) throw syncError(`message must use version ${BUSINESS_SYNC_VERSION} and type ${type}`);
  return { version: BUSINESS_SYNC_VERSION, type, messageRef: nonEmptyString(message.messageRef, "message.messageRef"), sentAt: timestamp(message.sentAt, "message.sentAt"), ...(message.replyTo === undefined ? {} : { replyTo: nonEmptyString(message.replyTo, "message.replyTo") }) };
}
function normalizeEnvelope(input, allowed, required, type) { const message = canonicalCopy(input, "message"); allowedKeys(message, new Set([...COMMON_KEYS, ...allowed]), "message"); requiredKeys(message, ["version", "type", "messageRef", "sentAt", ...required], "message"); return { message, base: common(message, type) }; }

function normalizeHello(input) {
  const { message, base } = normalizeEnvelope(input, ["supportedVersions", "cursors", "resetToken"], ["supportedVersions", "cursors"], "hello");
  const supportedVersions = message.supportedVersions; if (!Array.isArray(supportedVersions) || supportedVersions.length !== 1 || supportedVersions[0] !== BUSINESS_SYNC_VERSION) throw syncError("hello.supportedVersions must be exactly [1]");
  return deepFreeze({ ...base, supportedVersions: [BUSINESS_SYNC_VERSION], cursors: normalizeCursors(message.cursors, "message.cursors"), ...(message.resetToken === undefined ? {} : { resetToken: nonEmptyString(message.resetToken, "message.resetToken") }) });
}
function normalizeCapability(input) {
  const { message, base } = normalizeEnvelope(input, ["writable", "taskCommands", "automationCommands", "maxPageSize", "maxInflight", "currentCursors", "resetToken"], ["writable", "taskCommands", "automationCommands", "maxPageSize", "maxInflight", "currentCursors", "resetToken"], "capability");
  return deepFreeze({ ...base, writable: boolean(message.writable, "message.writable"), taskCommands: normalizedStringArray(message.taskCommands, BUSINESS_SYNC_TASK_ACTIONS, "message.taskCommands"), automationCommands: normalizedStringArray(message.automationCommands, BUSINESS_SYNC_AUTOMATION_ACTIONS, "message.automationCommands"), maxPageSize: integer(message.maxPageSize, "message.maxPageSize", 1, BUSINESS_SYNC_MAX_PAGE_ITEMS), maxInflight: integer(message.maxInflight, "message.maxInflight", 1, BUSINESS_SYNC_MAX_INFLIGHT), currentCursors: normalizeCursors(message.currentCursors, "message.currentCursors"), resetToken: nonEmptyString(message.resetToken, "message.resetToken") });
}
function normalizeReasonPayload(input, field) { allowedKeys(input, new Set(["reasonCode"]), field); return deepFreeze(input.reasonCode === undefined ? {} : { reasonCode: nonEmptyString(input.reasonCode, `${field}.reasonCode`, 64) }); }
function normalizeCommand(input) {
  const { message, base } = normalizeEnvelope(input, ["commandId", "resource", "action", "taskRef", "runRef", "expectedRevision", "payload"], ["commandId", "resource", "action", "expectedRevision", "payload"], "task.command");
  const commandId = nonEmptyString(message.commandId, "message.commandId"), expectedRevision = integer(message.expectedRevision, "message.expectedRevision", 1), resource = message.resource;
  if (resource === "task") {
    if (!BUSINESS_SYNC_TASK_ACTIONS.includes(message.action)) throw syncError("task command action is unsupported");
    requiredKeys(message, ["taskRef"], "message"); if (message.runRef !== undefined) throw syncError("task command must not include runRef");
    const taskRef = nonEmptyString(message.taskRef, "message.taskRef"), payload = message.payload;
    if (message.action === "claim") allowedKeys(payload, new Set(), "message.payload");
    else { allowedKeys(payload, new Set(["to"]), "message.payload"); requiredKeys(payload, ["to"], "message.payload"); if (!BUSINESS_SYNC_TRANSITION_TARGETS.includes(payload.to)) throw syncError("transition target is unsupported on the v1 wire"); }
    const result = { ...base, commandId, resource, action: message.action, taskRef, expectedRevision, payload };
    assertEncodedLimit(result, BUSINESS_SYNC_MAX_COMMAND_BYTES, "task.command"); return deepFreeze(result);
  }
  if (resource === "automation") {
    if (!BUSINESS_SYNC_AUTOMATION_ACTIONS.includes(message.action)) throw syncError("automation command action is unsupported");
    requiredKeys(message, ["runRef"], "message"); if (message.taskRef !== undefined) throw syncError("automation command must not include taskRef");
    const result = { ...base, commandId, resource, action: message.action, runRef: nonEmptyString(message.runRef, "message.runRef"), expectedRevision, payload: normalizeReasonPayload(message.payload, "message.payload") };
    assertEncodedLimit(result, BUSINESS_SYNC_MAX_COMMAND_BYTES, "task.command"); return deepFreeze(result);
  }
  throw syncError("message.resource must be task or automation");
}

const TASK_SAFE_KEYS = new Set(["taskRef", "title", "status", "revision", "requirementsRevision", "createdAt", "updatedAt", "hasAssignee", "blockedByCount"]);
const DEFINITION_SAFE_KEYS = new Set(["definitionRef", "revision", "status", "name", "taskRef", "targetStatus", "blockReason"]);
const RUN_SAFE_KEYS = new Set(["runRef", "definitionRef", "revision", "status", "createdAt", "startedAt", "finishedAt", "errorCode", "retryable"]);
const LEDGER_SAFE_KEYS = new Set(["sequence", "type", "occurredAt", "runRef", "definitionRef", "status", "errorCode"]);
function projectionSource(input, field) { return canonicalCopy(input, field, new Set(), 0, false); }
function projectTask(input) { const task = projectionSource(input, "task"), derivedAssignee = Array.isArray(task.assigneeRefs) ? task.assigneeRefs.length > 0 : typeof task.assigneeRef === "string" && task.assigneeRef !== ""; const result = { taskRef: nonEmptyString(task.taskRef, "task.taskRef"), title: nonEmptyString(task.title, "task.title", 500), status: nonEmptyString(task.status, "task.status", 64), revision: integer(task.revision, "task.revision", 1), requirementsRevision: integer(task.requirementsRevision, "task.requirementsRevision", 1), createdAt: timestamp(task.createdAt, "task.createdAt"), updatedAt: timestamp(task.updatedAt, "task.updatedAt"), hasAssignee: boolean(task.hasAssignee ?? derivedAssignee, "task.hasAssignee"), blockedByCount: integer(task.blockedByCount ?? task.blockedBy?.length ?? 0, "task.blockedByCount", 0, 10_000) }; return deepFreeze(result); }
function projectDefinition(input) { const definition = projectionSource(input, "definition"), step = Array.isArray(definition.steps) ? definition.steps[0] : undefined; const result = { definitionRef: nonEmptyString(definition.definitionRef, "definition.definitionRef"), revision: integer(definition.revision, "definition.revision", 1), status: nonEmptyString(definition.status, "definition.status", 64), name: nonEmptyString(definition.name, "definition.name", 500), taskRef: nonEmptyString(definition.taskRef ?? step?.taskRef, "definition.taskRef"), targetStatus: nonEmptyString(definition.targetStatus ?? step?.targetStatus, "definition.targetStatus", 64), ...((definition.blockReason ?? step?.blockReason) === undefined ? {} : { blockReason: nonEmptyString(definition.blockReason ?? step.blockReason, "definition.blockReason", 500) }) }; return deepFreeze(result); }
function projectRun(input) { const run = projectionSource(input, "run"); const result = { runRef: nonEmptyString(run.runRef, "run.runRef"), definitionRef: nonEmptyString(run.definitionRef, "run.definitionRef"), revision: integer(run.revision, "run.revision", 1), status: nonEmptyString(run.status, "run.status", 64), createdAt: timestamp(run.createdAt, "run.createdAt"), ...(run.startedAt === undefined ? {} : { startedAt: timestamp(run.startedAt, "run.startedAt") }), ...(run.finishedAt === undefined ? {} : { finishedAt: timestamp(run.finishedAt, "run.finishedAt") }), ...((run.errorCode ?? run.error?.code) === undefined ? {} : { errorCode: nonEmptyString(run.errorCode ?? run.error.code, "run.errorCode") }), ...((run.retryable ?? run.error?.retryable) === undefined ? {} : { retryable: boolean(run.retryable ?? run.error.retryable, "run.retryable") }) }; return deepFreeze(result); }
function projectLedgerEntry(input) { const entry = projectionSource(input, "ledgerEntry"), status = entry.status ?? entry.toStatus; const result = { sequence: integer(entry.sequence, "ledgerEntry.sequence", 1), type: nonEmptyString(entry.type, "ledgerEntry.type", 128), occurredAt: timestamp(entry.occurredAt, "ledgerEntry.occurredAt"), ...(entry.runRef === undefined ? {} : { runRef: nonEmptyString(entry.runRef, "ledgerEntry.runRef") }), ...(entry.definitionRef === undefined ? {} : { definitionRef: nonEmptyString(entry.definitionRef, "ledgerEntry.definitionRef") }), ...(status === undefined ? {} : { status: nonEmptyString(status, "ledgerEntry.status", 64) }), ...(entry.errorCode === undefined ? {} : { errorCode: nonEmptyString(entry.errorCode, "ledgerEntry.errorCode") }) }; return deepFreeze(result); }
function normalizeSafeTask(input, field) { const task = canonicalCopy(input, field); allowedKeys(task, TASK_SAFE_KEYS, field); requiredKeys(task, [...TASK_SAFE_KEYS], field); return projectTask(task); }
function normalizeSafeDefinition(input, field) { const definition = canonicalCopy(input, field); allowedKeys(definition, DEFINITION_SAFE_KEYS, field); requiredKeys(definition, ["definitionRef", "revision", "status", "name", "taskRef", "targetStatus"], field); return projectDefinition(definition); }
function normalizeSafeRun(input, field) { const run = canonicalCopy(input, field); allowedKeys(run, RUN_SAFE_KEYS, field); requiredKeys(run, ["runRef", "definitionRef", "revision", "status", "createdAt"], field); return projectRun(run); }
function normalizeSafeLedger(input, field) { const entry = canonicalCopy(input, field); allowedKeys(entry, LEDGER_SAFE_KEYS, field); requiredKeys(entry, ["sequence", "type", "occurredAt"], field); return projectLedgerEntry(entry); }
function normalizeSafeApproval(input, field) { const approval = canonicalCopy(input, field); allowedKeys(approval, new Set(["decision", "decidedAt"]), field); requiredKeys(approval, ["decision", "decidedAt"], field); if (!BUSINESS_SYNC_AUTOMATION_ACTIONS.map((item) => item === "approve" ? "approved" : "rejected").includes(approval.decision)) throw syncError(`${field}.decision is unsupported`); return deepFreeze({ decision: approval.decision, decidedAt: timestamp(approval.decidedAt, `${field}.decidedAt`) }); }

function normalizeReceipt(input) {
  const { message, base } = normalizeEnvelope(input, ["commandId", "requestDigest", "outcome", "completedAt", "task", "run", "approval", "code", "retryable"], ["commandId", "requestDigest", "outcome", "completedAt"], "task.receipt");
  const shared = { ...base, commandId: nonEmptyString(message.commandId, "message.commandId"), requestDigest: digest(message.requestDigest, "message.requestDigest"), outcome: message.outcome, completedAt: timestamp(message.completedAt, "message.completedAt") };
  if (message.outcome === "accepted") {
    const taskResult = message.task !== undefined, automationResult = message.run !== undefined || message.approval !== undefined;
    if (taskResult === automationResult || message.code !== undefined || message.retryable !== undefined) throw syncError("accepted receipt must contain either safe task or safe run plus approval");
    if (taskResult) return deepFreeze({ ...shared, task: normalizeSafeTask(message.task, "message.task") });
    requiredKeys(message, ["run", "approval"], "message"); return deepFreeze({ ...shared, run: normalizeSafeRun(message.run, "message.run"), approval: normalizeSafeApproval(message.approval, "message.approval") });
  }
  if (message.outcome === "rejected") {
    requiredKeys(message, ["code", "retryable"], "message"); if (message.task !== undefined || message.run !== undefined || message.approval !== undefined) throw syncError("rejected receipt must not contain result data");
    const code = nonEmptyString(message.code, "message.code");
    if (!BUSINESS_SYNC_REJECTION_CODES.includes(code)) throw syncError("rejected receipt code is not in the fixed public allowlist");
    return deepFreeze({ ...shared, code, retryable: boolean(message.retryable, "message.retryable") });
  }
  throw syncError("message.outcome must be accepted or rejected");
}
function normalizeEventPull(input) {
  const { message, base } = normalizeEnvelope(input, ["stream", "cursor", "limit", "resetToken", "offset"], ["stream", "cursor", "limit"], "event.pull");
  const resetting = message.resetToken !== undefined || message.offset !== undefined; if (resetting) requiredKeys(message, ["resetToken", "offset"], "message");
  return deepFreeze({ ...base, stream: normalizeStream(message.stream, "message.stream"), cursor: integer(message.cursor, "message.cursor"), limit: integer(message.limit, "message.limit", 1, BUSINESS_SYNC_MAX_PAGE_ITEMS), ...(resetting ? { resetToken: nonEmptyString(message.resetToken, "message.resetToken"), offset: integer(message.offset, "message.offset") } : {}) });
}
function normalizeProjectedItem(input, stream, field) {
  const item = canonicalCopy(input, field), variants = stream === "task" ? ["task"] : ["definition", "run", "ledger"];
  allowedKeys(item, new Set(variants), field); const present = variants.filter((key) => item[key] !== undefined); if (present.length !== 1) throw syncError(`${field} must contain exactly one ${stream} stream projection`);
  return deepFreeze({ ...(item.task === undefined ? {} : { task: normalizeSafeTask(item.task, `${field}.task`) }), ...(item.definition === undefined ? {} : { definition: normalizeSafeDefinition(item.definition, `${field}.definition`) }), ...(item.run === undefined ? {} : { run: normalizeSafeRun(item.run, `${field}.run`) }), ...(item.ledger === undefined ? {} : { ledger: normalizeSafeLedger(item.ledger, `${field}.ledger`) }) });
}
function normalizeBusinessEvent(input, stream, field) {
  const event = canonicalCopy(input, field);
  allowedKeys(event, new Set(["cursor", "type", "occurredAt", "task", "definition", "run", "ledger"]), field);
  requiredKeys(event, ["cursor", "type", "occurredAt"], field);
  const cursor = integer(event.cursor, `${field}.cursor`, 1);
  let projection;
  if (stream === "task") {
    projection = normalizeProjectedItem(Object.fromEntries(["task", "definition", "run", "ledger"].filter((key) => event[key] !== undefined).map((key) => [key, event[key]])), stream, field);
  } else {
    if (event.ledger === undefined || (event.definition !== undefined && event.run !== undefined) || event.task !== undefined) throw syncError(`${field} must contain an automation ledger projection and at most one current entity`);
    projection = deepFreeze({
      ledger: normalizeSafeLedger(event.ledger, `${field}.ledger`),
      ...(event.definition === undefined ? {} : { definition: normalizeSafeDefinition(event.definition, `${field}.definition`) }),
      ...(event.run === undefined ? {} : { run: normalizeSafeRun(event.run, `${field}.run`) }),
    });
  }
  if (projection.ledger !== undefined && projection.ledger.sequence !== cursor) throw syncError(`${field}.ledger.sequence must equal the automation cursor`, BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT);
  return deepFreeze({ cursor, type: nonEmptyString(event.type, `${field}.type`, 128), occurredAt: timestamp(event.occurredAt, `${field}.occurredAt`), ...projection });
}
function normalizeResetSnapshot(input, stream, field) {
  const snapshot = canonicalCopy(input, field); allowedKeys(snapshot, new Set(["cursor", "offset", "nextOffset", "totalItems", "items"]), field); requiredKeys(snapshot, ["cursor", "offset", "nextOffset", "totalItems", "items"], field);
  if (!Array.isArray(snapshot.items) || snapshot.items.length > BUSINESS_SYNC_MAX_PAGE_ITEMS) throw syncError(`${field}.items exceeds the ${BUSINESS_SYNC_MAX_PAGE_ITEMS} item limit`);
  const offset = integer(snapshot.offset, `${field}.offset`), nextOffset = integer(snapshot.nextOffset, `${field}.nextOffset`), totalItems = integer(snapshot.totalItems, `${field}.totalItems`); if (nextOffset !== offset + snapshot.items.length || nextOffset > totalItems || (nextOffset < totalItems && snapshot.items.length === 0)) throw syncError(`${field} offset range is inconsistent`, BUSINESS_SYNC_ERROR_CODES.EVENT_GAP);
  return deepFreeze({ cursor: integer(snapshot.cursor, `${field}.cursor`), offset, nextOffset, totalItems, items: snapshot.items.map((item, index) => normalizeProjectedItem(item, stream, `${field}.items[${index}]`)) });
}
function normalizeEventPage(input) {
  const { message, base } = normalizeEnvelope(input, ["stream", "afterCursor", "nextCursor", "hasMore", "events", "resetToken", "snapshot"], ["stream", "afterCursor", "nextCursor", "hasMore"], "event.page");
  const stream = normalizeStream(message.stream, "message.stream"), afterCursor = integer(message.afterCursor, "message.afterCursor"), nextCursor = integer(message.nextCursor, "message.nextCursor"), hasMore = boolean(message.hasMore, "message.hasMore"), reset = message.resetToken !== undefined || message.snapshot !== undefined;
  let result;
  if (reset) {
    requiredKeys(message, ["resetToken", "snapshot"], "message"); if (message.events !== undefined) throw syncError("reset page must contain snapshot items only"); const snapshot = normalizeResetSnapshot(message.snapshot, stream, "message.snapshot"); if (snapshot.cursor !== nextCursor) throw syncError("reset snapshot cursor must equal nextCursor", BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT); if (hasMore !== (snapshot.nextOffset < snapshot.totalItems)) throw syncError("reset hasMore does not match snapshot offsets", BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT); result = { ...base, stream, afterCursor, nextCursor, hasMore, resetToken: nonEmptyString(message.resetToken, "message.resetToken"), snapshot };
  } else {
    requiredKeys(message, ["events"], "message"); if (!Array.isArray(message.events) || message.events.length > BUSINESS_SYNC_MAX_PAGE_ITEMS) throw syncError("event page exceeds 100 events"); const events = message.events.map((event, index) => normalizeBusinessEvent(event, stream, `message.events[${index}]`)); let expected = afterCursor + 1; for (const event of events) { if (event.cursor !== expected) throw syncError("event page contains a cursor gap", BUSINESS_SYNC_ERROR_CODES.EVENT_GAP, { expectedCursor: expected, actualCursor: event.cursor }); expected += 1; } const expectedNext = events.length === 0 ? afterCursor : events.at(-1).cursor; if (nextCursor !== expectedNext || (hasMore && events.length === 0)) throw syncError("normal page cursor or hasMore is inconsistent", BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT); result = { ...base, stream, afterCursor, nextCursor, hasMore, events };
  }
  assertEncodedLimit(result, BUSINESS_SYNC_MAX_BYTES, "event.page"); return deepFreeze(result);
}
function normalizeAck(input) {
  const { message, base } = normalizeEnvelope(input, ["kind", "ackDigest", "stream", "cursor", "resetToken"], ["replyTo", "kind"], "ack");
  if (message.kind === "receipt") { requiredKeys(message, ["ackDigest"], "message"); if (message.stream !== undefined || message.cursor !== undefined || message.resetToken !== undefined) throw syncError("receipt ack must not contain page cursor fields"); return deepFreeze({ ...base, kind: "receipt", ackDigest: digest(message.ackDigest, "message.ackDigest") }); }
  if (message.kind === "page") { requiredKeys(message, ["stream", "cursor", "resetToken"], "message"); if (message.ackDigest !== undefined) throw syncError("page ack must not contain receipt digest"); return deepFreeze({ ...base, kind: "page", stream: normalizeStream(message.stream, "message.stream"), cursor: integer(message.cursor, "message.cursor"), resetToken: nonEmptyString(message.resetToken, "message.resetToken") }); }
  throw syncError("message.kind must be receipt or page");
}

function normalizeBusinessSyncMessage(input) {
  const preview = canonicalCopy(input, "message"); if (!isRecord(preview) || !BUSINESS_SYNC_MESSAGE_TYPES.includes(preview.type)) throw syncError("message.type is unsupported");
  const result = ({ hello: normalizeHello, capability: normalizeCapability, "task.command": normalizeCommand, "task.receipt": normalizeReceipt, "event.pull": normalizeEventPull, "event.page": normalizeEventPage, ack: normalizeAck })[preview.type](preview);
  assertEncodedLimit(result, result.type === "task.command" ? BUSINESS_SYNC_MAX_COMMAND_BYTES : BUSINESS_SYNC_MAX_BYTES); return result;
}
function businessRequestDigest(input, { senderDeviceRef, authorityEpoch } = {}) { const message = normalizeBusinessSyncMessage(input); const trusted = { authorityEpoch: integer(authorityEpoch, "trusted.authorityEpoch", 1), message, senderDeviceRef: nonEmptyString(senderDeviceRef, "trusted.senderDeviceRef") }; return createHash("sha256").update(JSON.stringify(trusted)).digest("hex"); }
function assertBusinessRequestReplay(existingInput, candidateInput) { const existing = canonicalCopy(existingInput, "existing replay"), candidate = canonicalCopy(candidateInput, "candidate replay"), existingId = existing.commandId ?? existing.messageRef, candidateId = candidate.commandId ?? candidate.messageRef, existingDigest = existing.digest ?? existing.requestDigest, candidateDigest = candidate.digest ?? candidate.requestDigest; if (!isRecord(existing) || !isRecord(candidate) || nonEmptyString(existingId, "existing.id") !== nonEmptyString(candidateId, "candidate.id") || digest(existingDigest, "existing.digest") !== digest(candidateDigest, "candidate.digest")) throw syncError("business request id was reused with different trusted input", BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT); return true; }
function normalizeCursorState(input) { if (Number.isSafeInteger(input)) return { cursor: integer(input, "cursorState.cursor"), pendingReset: null }; const state = canonicalCopy(input, "cursorState", new Set(), 0, false); allowedKeys(state, new Set(["cursor", "pendingReset"]), "cursorState"); requiredKeys(state, ["cursor"], "cursorState"); const cursor = integer(state.cursor, "cursorState.cursor"); if (state.pendingReset === undefined || state.pendingReset === null) return { cursor, pendingReset: null }; const pending = state.pendingReset; allowedKeys(pending, new Set(["stream", "resetToken", "afterCursor", "snapshotCursor", "nextOffset", "totalItems"]), "cursorState.pendingReset"); requiredKeys(pending, ["stream", "resetToken", "afterCursor", "snapshotCursor", "nextOffset", "totalItems"], "cursorState.pendingReset"); return { cursor, pendingReset: { stream: normalizeStream(pending.stream, "cursorState.pendingReset.stream"), resetToken: nonEmptyString(pending.resetToken, "cursorState.pendingReset.resetToken"), afterCursor: integer(pending.afterCursor, "cursorState.pendingReset.afterCursor"), snapshotCursor: integer(pending.snapshotCursor, "cursorState.pendingReset.snapshotCursor"), nextOffset: integer(pending.nextOffset, "cursorState.pendingReset.nextOffset"), totalItems: integer(pending.totalItems, "cursorState.pendingReset.totalItems") } }; }
function applyBusinessEventPageCursor(currentStateInput, pageInput, { resetToken } = {}) {
  const state = normalizeCursorState(currentStateInput), page = normalizeBusinessSyncMessage(pageInput); if (page.type !== "event.page") throw syncError("page must be an event.page");
  if (page.snapshot === undefined) { if (state.pendingReset !== null) throw syncError("normal events cannot replace an incomplete reset", BUSINESS_SYNC_ERROR_CODES.RESET_REQUIRED); if (page.afterCursor !== state.cursor) throw syncError("event page does not continue the local cursor", BUSINESS_SYNC_ERROR_CODES.EVENT_GAP, { expectedCursor: state.cursor, actualCursor: page.afterCursor }); return deepFreeze({ cursor: page.nextCursor, pendingReset: null }); }
  if (resetToken === undefined || page.resetToken !== resetToken) throw syncError("event reset token is not trusted", BUSINESS_SYNC_ERROR_CODES.RESET_REQUIRED);
  const pending = state.pendingReset;
  if (pending === null) { if (page.afterCursor !== state.cursor || page.snapshot.offset !== 0) throw syncError("reset must begin at offset zero from the local cursor", BUSINESS_SYNC_ERROR_CODES.EVENT_GAP); }
  else if (pending.stream !== page.stream || pending.resetToken !== page.resetToken || pending.afterCursor !== page.afterCursor || pending.snapshotCursor !== page.snapshot.cursor || pending.totalItems !== page.snapshot.totalItems || pending.nextOffset !== page.snapshot.offset) throw syncError("reset page does not continue the pending snapshot", BUSINESS_SYNC_ERROR_CODES.EVENT_GAP);
  if (!page.hasMore) return deepFreeze({ cursor: page.nextCursor, pendingReset: null });
  return deepFreeze({ cursor: state.cursor, pendingReset: { stream: page.stream, resetToken: page.resetToken, afterCursor: page.afterCursor, snapshotCursor: page.snapshot.cursor, nextOffset: page.snapshot.nextOffset, totalItems: page.snapshot.totalItems } });
}
function assertMonotonicBusinessAck(previousInput, nextInput) {
  const next = normalizeBusinessSyncMessage(nextInput); if (next.type !== "ack") throw syncError("next acknowledgement must have type ack"); if (previousInput === undefined || previousInput === null) return next; const previous = normalizeBusinessSyncMessage(previousInput); if (previous.type !== "ack") throw syncError("previous acknowledgement must have type ack");
  if (previous.kind !== next.kind) return next;
  if (next.kind === "receipt") { if (next.replyTo === previous.replyTo && next.ackDigest !== previous.ackDigest) throw syncError("receipt acknowledgement changed for the same reply", BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT); if (next.ackDigest === previous.ackDigest && next.replyTo !== previous.replyTo) throw syncError("receipt digest was reused for another reply", BUSINESS_SYNC_ERROR_CODES.REPLAY_CONFLICT); return next; }
  if (previous.stream === next.stream && previous.resetToken === next.resetToken && next.cursor < previous.cursor) throw syncError("page ack cursor moved backwards", BUSINESS_SYNC_ERROR_CODES.CURSOR_CONFLICT, { currentCursor: previous.cursor }); return next;
}

export {
  BUSINESS_SYNC_AUTOMATION_ACTIONS, BUSINESS_SYNC_ERROR_CODES, BUSINESS_SYNC_MAX_BYTES, BUSINESS_SYNC_MAX_COMMAND_BYTES, BUSINESS_SYNC_MAX_DEPTH,
  BUSINESS_SYNC_MAX_INFLIGHT, BUSINESS_SYNC_MAX_PAGE_ITEMS, BUSINESS_SYNC_MESSAGE_TYPES, BUSINESS_SYNC_REJECTION_CODES, BUSINESS_SYNC_STREAMS, BUSINESS_SYNC_TASK_ACTIONS, BUSINESS_SYNC_TRANSITION_TARGETS, BUSINESS_SYNC_VERSION,
  applyBusinessEventPageCursor, assertBusinessRequestReplay, assertMonotonicBusinessAck, businessRequestDigest, canonicalJson as canonicalBusinessJson,
  normalizeBusinessSyncMessage, projectDefinition as projectSafeBusinessDefinition, projectLedgerEntry as projectSafeBusinessLedgerEntry,
  projectRun as projectSafeBusinessRun, projectTask as projectSafeBusinessTask,
  PROJECT_BUSINESS_SYNC_CURSOR_CONFLICT, PROJECT_BUSINESS_SYNC_EVENT_GAP, PROJECT_BUSINESS_SYNC_INVALID,
  PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT, PROJECT_BUSINESS_SYNC_RESET_REQUIRED, PROJECT_BUSINESS_SYNC_TOO_LARGE,
};
