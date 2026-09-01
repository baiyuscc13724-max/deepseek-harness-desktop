import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { canActorPerform, TASK_TRANSITIONS } from "./project-task-domain.js";
import { ProjectCollaborationService, ProjectTaskCommandService } from "./project-task-service.js";
import { ProjectTaskStore } from "./project-task-store.js";

const MAX_WEB_COMMAND_BYTES = 64 * 1024;
const MAX_WEB_VALUE_DEPTH = 16;
const MAX_WEB_EVENTS = 100;
const MAX_WEB_EVENT_WINDOW = 500;
const MAX_WEB_TASKS = 120;
const MAX_WEB_TASK_PAGE_BYTES = 128 * 1024;
const MAX_WEB_COLLABORATION_ITEMS = 120;
const MAX_WEB_COLLABORATION_SECTION_ITEMS = 24;
const MAX_WEB_COLLABORATION_PAGE_BYTES = 128 * 1024;
const WEB_PAGE_CURSOR_MAX_CHARS = 16_384;
const WEB_TASK_CURSOR_PREFIX = "ptw4";
const WEB_COLLABORATION_CURSOR_PREFIX = "pcw3";
const WEB_ROOT_RECOVERY_CAPABILITY_PREFIX = "prc1";
const COLLABORATION_SECTIONS = Object.freeze(["seats", "tasks", "locks", "handoffs", "recoveries", "evidence", "history", "requests"]);
const COLLABORATION_SECTION_SET = new Set(COLLABORATION_SECTIONS);
const COLLABORATION_SSE_DEBOUNCE_MS = 40;
const WEB_ACTIONS = Object.freeze([
  "create", "edit_requirements", "claim", "transition", "comment", "relation.add", "attempt.start", "attempt.submit", "review",
]);
const WEB_ACTION_SET = new Set(WEB_ACTIONS);
const WEB_COMMAND_KEYS = new Set(["commandId", "type", "taskRef", "expectedRevision", "payload"]);
const FORBIDDEN_WEB_KEYS = new Set([
  "project", "projectref", "eventref", "session", "sessionid", "userid", "device", "deviceid", "accountid", "email", "actor", "actorref", "role", "authority", "authorities", "path", "filepath", "execution", "targetexecution",
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
function sealPageCursor(prefix, domain, projectRef, value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify([domain, projectRef]), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${prefix}.${Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}
function openPageCursor(prefix, domain, projectRef, cursor, key, message) {
  if (typeof cursor !== "string" || cursor.length < 48 || cursor.length > WEB_PAGE_CURSOR_MAX_CHARS) throw webError(message, "PROJECT_TASK_WEB_CURSOR_INVALID");
  const parts = cursor.split(".");
  if (parts.length !== 2 || parts[0] !== prefix || !/^[A-Za-z0-9_-]+$/u.test(parts[1])) throw webError(message, "PROJECT_TASK_WEB_CURSOR_INVALID");
  try {
    const sealed = Buffer.from(parts[1], "base64url");
    if (sealed.length < 29) throw new Error("short cursor");
    const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify([domain, projectRef]), "utf8"));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString("utf8"));
  } catch { throw webError(message, "PROJECT_TASK_WEB_CURSOR_INVALID"); }
}
function encodeTaskPageCursor(projectRef, projectRevision, boundary, key) {
  return sealPageCursor(WEB_TASK_CURSOR_PREFIX, "project-task-web-page-v4", projectRef, { v: 4, r: projectRevision, l: boundary.statusRank, p: boundary.priority, u: boundary.updatedAt, c: boundary.createdAt, t: boundary.taskRef }, key);
}
function decodeTaskPageCursor(projectRef, cursor, key) {
  const payload = openPageCursor(WEB_TASK_CURSOR_PREFIX, "project-task-web-page-v4", projectRef, cursor, key, "task page cursor is invalid");
  if (!isRecord(payload) || Object.keys(payload).sort().join(",") !== "c,l,p,r,t,u,v" || payload.v !== 4 || !Number.isSafeInteger(payload.r) || payload.r < 0 || !Number.isSafeInteger(payload.l) || payload.l < 0 || payload.l > 5 || !Number.isSafeInteger(payload.p) || payload.p < -1 || payload.p > 1_000_000 || !Number.isSafeInteger(payload.u) || payload.u < 0 || !Number.isSafeInteger(payload.c) || payload.c < 0 || typeof payload.t !== "string" || payload.t.length < 1 || payload.t.length > 256) throw webError("task page cursor is invalid", "PROJECT_TASK_WEB_CURSOR_INVALID");
  return { projectRevision: payload.r, statusRank: payload.l, priority: payload.p, updatedAt: payload.u, createdAt: payload.c, taskRef: payload.t };
}
function encodeCollaborationPageCursor(projectRef, revision, section, boundary, key) {
  if (!COLLABORATION_SECTION_SET.has(section) || !isRecord(boundary) || Object.keys(boundary).length === 0) throw webError("collaboration page cursor is invalid", "PROJECT_TASK_WEB_CURSOR_INVALID");
  return sealPageCursor(WEB_COLLABORATION_CURSOR_PREFIX, "project-collaboration-web-page-v3", projectRef, { v: 3, r: revision, s: section, b: boundary }, key);
}
function decodeCollaborationPageCursor(projectRef, cursor, key) {
  const payload = openPageCursor(WEB_COLLABORATION_CURSOR_PREFIX, "project-collaboration-web-page-v3", projectRef, cursor, key, "collaboration page cursor is invalid");
  if (!isRecord(payload) || Object.keys(payload).sort().join(",") !== "b,r,s,v" || payload.v !== 3 || !Number.isSafeInteger(payload.r) || payload.r < 0 || !COLLABORATION_SECTION_SET.has(payload.s) || !isRecord(payload.b) || Object.keys(payload.b).length === 0) throw webError("collaboration page cursor is invalid", "PROJECT_TASK_WEB_CURSOR_INVALID");
  return { revision: payload.r, section: payload.s, boundary: payload.b };
}
function encodeRootRecoveryCapability(projectRef, recoveryRef, revision, action, actorRef, key) {
  return sealPageCursor(WEB_ROOT_RECOVERY_CAPABILITY_PREFIX, "project-root-recovery-capability-v1", projectRef, { v: 1, r: recoveryRef, n: revision, a: action, i: actorRef }, key);
}
function decodeRootRecoveryCapability(projectRef, capability, key) {
  let payload;
  try { payload = openPageCursor(WEB_ROOT_RECOVERY_CAPABILITY_PREFIX, "project-root-recovery-capability-v1", projectRef, capability, key, "root recovery capability is invalid"); }
  catch { throw webError("root recovery capability is invalid", "PROJECT_TASK_WEB_FORBIDDEN"); }
  if (!isRecord(payload) || Object.keys(payload).sort().join(",") !== "a,i,n,r,v" || payload.v !== 1 || typeof payload.r !== "string" || payload.r.length < 1 || payload.r.length > 256 || !Number.isSafeInteger(payload.n) || payload.n < 1 || !new Set(["retry", "takeover"]).has(payload.a) || typeof payload.i !== "string" || payload.i.length < 1 || payload.i.length > 256) throw webError("root recovery capability is invalid", "PROJECT_TASK_WEB_FORBIDDEN");
  return Object.freeze({ recoveryRef: payload.r, revision: payload.n, action: payload.a, actorRef: payload.i });
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
function safeProjectionToken(value, fallback = "unknown") {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{0,63}$/u.test(value) ? value : fallback;
}
function safeProjectionLabel(value, maximum = 160) {
  if (typeof value !== "string") return "";
  return value.replaceAll(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, maximum);
}
function safeProjectionTime(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function opaqueProjectionRef(projectRef, kind, value, key) {
  if (typeof value !== "string" || value === "") return undefined;
  return `${kind}_${createHmac("sha256", key).update(JSON.stringify(["project-collaboration-safe-ref-v1", projectRef, kind, value])).digest("base64url").slice(0, 32)}`;
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
    PROJECT_TASK_WEB_FORBIDDEN: "The requested top-level project session is not available.",
    PROJECT_TASK_WEB_BODY_TOO_LARGE: "The project task request is too large.",
    PROJECT_TASK_WEB_ACTION_UNAVAILABLE: "That action is not available on the Web task board.",
    PROJECT_TASK_WEB_CURSOR_INVALID: "The project task page cursor is invalid.",
    PROJECT_TASK_WEB_CURSOR_STALE: "The project task page changed and must be refreshed.",
    PROJECT_TASK_WEB_PAGE_TOO_LARGE: "The project task page cannot fit the transfer budget.",
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
    PROJECT_TASK_WEB_FORBIDDEN: [403, "open_exact_project_session", false],
    PROJECT_TASK_WEB_BODY_TOO_LARGE: [413, "fix_request", false],
    PROJECT_TASK_WEB_ACTION_UNAVAILABLE: [400, "fix_request", false],
    PROJECT_TASK_WEB_CURSOR_INVALID: [400, "refresh_first_page", false],
    PROJECT_TASK_WEB_CURSOR_STALE: [409, "refresh_first_page", false],
    PROJECT_TASK_WEB_PAGE_TOO_LARGE: [413, "reduce_task_metadata", false],
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
  constructor({ projectEntry, legacySummaryProvider = () => false, now = Date.now, randomBytesImpl = randomBytes, wakeScheduler = () => undefined, rootRecoveryAuthorityProvider } = {}) {
    if (typeof projectEntry?.localProjectTaskContext !== "function") throw new TypeError("projectEntry must provide localProjectTaskContext");
    if (typeof legacySummaryProvider !== "function") throw new TypeError("legacySummaryProvider must be a function");
    if (typeof now !== "function" || typeof randomBytesImpl !== "function" || typeof wakeScheduler !== "function" || (rootRecoveryAuthorityProvider !== undefined && typeof rootRecoveryAuthorityProvider !== "function")) throw new TypeError("runtime functions are invalid");
    const cursorKey = randomBytesImpl(32);
    if ((!Buffer.isBuffer(cursorKey) && !(cursorKey instanceof Uint8Array)) || cursorKey.byteLength !== 32) throw new TypeError("randomBytesImpl must return 32 bytes");
    this.projectEntry = projectEntry;
    this.legacySummaryProvider = legacySummaryProvider;
    this.now = now;
    this.wakeScheduler = wakeScheduler;
    this.rootRecoveryAuthorityProvider = rootRecoveryAuthorityProvider;
    this.cursorKey = Buffer.from(cursorKey);
    this.binding = undefined;
    this.collaborationCache = new Map();
    this.collaborationPublishTimers = new Map();
    this.pendingCollaborationUpdates = new Map();
    this.listeners = new Set();
    this.tail = Promise.resolve();
    this.closing = false;
    this.closePromise = undefined;
  }

  async state() {
    return this.#enqueue(async () => {
      const legacyTeamTasks = await this.#legacySummary();
      try {
        return await this.#withBinding((binding) => this.#combinedState(binding, legacyTeamTasks));
      } catch (error) {
        if (!UNAVAILABLE_ERRORS.has(error?.code)) throw error;
        return { ok: true, capability: { ...(await this.#unavailableCapability(error)), legacyTeamTasks } };
      }
    });
  }

  async page(cursor) {
    const normalized = nonEmptyString(cursor, "cursor", WEB_PAGE_CURSOR_MAX_CHARS);
    return this.#enqueue(async () => {
      const legacyTeamTasks = await this.#legacySummary();
      return this.#withBinding((binding) => normalized.startsWith(`${WEB_COLLABORATION_CURSOR_PREFIX}.`)
        ? { ok: true, projectCollaboration: this.#collaborationPage(binding, normalized) }
        : this.#authorityPage(binding, normalized, legacyTeamTasks));
    });
  }

  async collaborationPage(cursor) {
    const normalized = cursor === undefined ? undefined : nonEmptyString(cursor, "cursor", WEB_PAGE_CURSOR_MAX_CHARS);
    return this.#enqueue(() => this.#withBinding((binding) => this.#collaborationPage(binding, normalized)));
  }

  async refreshCollaboration() {
    return this.#enqueue(() => this.#withBinding((binding) => {
      const previous = this.collaborationCache.get(binding.context.projectRef)?.revision;
      const page = this.#collaborationPage(binding, undefined, true);
      if (previous !== undefined && page.revision !== previous) this.#queueCollaborationUpdate(binding.context.projectRef, page.revision);
      return page;
    }));
  }

  async resolveRootRecoveryCapability(input = {}) {
    if (!isRecord(input) || Object.keys(input).some((key) => !new Set(["capability", "action", "expectedRevision"]).has(key))) throw webError("root recovery capability request is invalid", "PROJECT_TASK_WEB_FORBIDDEN");
    const capability = nonEmptyString(input.capability, "capability", WEB_PAGE_CURSOR_MAX_CHARS);
    const action = nonEmptyString(input.action, "action", 32);
    if (!new Set(["retry", "takeover"]).has(action)) throw webError("root recovery action is invalid", "PROJECT_TASK_WEB_FORBIDDEN");
    const expectedRevision = safeInteger(input.expectedRevision, "expectedRevision", 1);
    return this.#enqueue(() => this.#withBinding((binding) => {
      const authority = this.#rootRecoveryAuthority(binding);
      const decoded = decodeRootRecoveryCapability(binding.context.projectRef, capability, this.cursorKey);
      if (decoded.actorRef !== authority.actorRef || decoded.action !== action || decoded.revision !== expectedRevision) throw webError("root recovery capability does not match this root action", "PROJECT_TASK_WEB_FORBIDDEN");
      return Object.freeze({ recoveryRef: decoded.recoveryRef, action, expectedRevision });
    }));
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
      for (const timer of this.collaborationPublishTimers.values()) clearTimeout(timer);
      this.collaborationPublishTimers.clear();
      this.pendingCollaborationUpdates.clear();
      this.listeners.clear();
      this.#releaseBinding();
      this.collaborationCache.clear();
      this.cursorKey.fill(0);
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
    const contextFactory = this.projectEntry.localProjectCollaborationContext ?? this.projectEntry.localProjectTaskContext;
    const context = await contextFactory.call(this.projectEntry);
    const store = new ProjectTaskStore({ filePath: context.databasePath, keyProvider: context.keyProvider });
    try {
      store.initialize();
      const service = new ProjectTaskCommandService({ store, actorResolver: context.actorResolver, now: this.now, wakeScheduler: this.wakeScheduler });
      const collaborationService = new ProjectCollaborationService({ store, actorResolver: context.actorResolver, now: this.now });
      context.actorResolver(context.execution, context.projectRef);
      this.binding = { context, store, service, collaborationService };
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
    const projectRef = binding.context.projectRef;
    this.collaborationCache.delete(projectRef);
    const timer = this.collaborationPublishTimers.get(projectRef);
    if (timer !== undefined) clearTimeout(timer);
    this.collaborationPublishTimers.delete(projectRef);
    this.pendingCollaborationUpdates.delete(projectRef);
    try { binding.store.close(); }
    finally { this.#disposeContext(binding.context); }
  }

  #disposeContext(context) {
    try { context?.dispose?.(); } catch {}
  }

  #rootRecoveryAuthority(binding) {
    const actor = binding.context.actorResolver(binding.context.execution, binding.context.projectRef);
    const supplied = this.rootRecoveryAuthorityProvider?.(Object.freeze({ context: binding.context, store: binding.store, actor }));
    if (supplied === undefined) {
      const authorities = Array.isArray(actor?.authorities) ? actor.authorities : [];
      return Object.freeze({ actorRef: actor.actorRef, isCoordinator: actor.kind === "human" && ["owner", "maintainer"].includes(actor.role) || authorities.includes("project_lead") || authorities.includes("coordinator") });
    }
    if (!isRecord(supplied) || typeof supplied.actorRef !== "string" || supplied.actorRef.length < 1 || supplied.actorRef.length > 256 || typeof supplied.isCoordinator !== "boolean") throw webError("root recovery authority is invalid", "PROJECT_TASK_WEB_FORBIDDEN");
    return Object.freeze({ actorRef: supplied.actorRef, isCoordinator: supplied.isCoordinator });
  }

  #safeCollaborationItems(binding, section, items) {
    const projectRef = binding.context.projectRef;
    const actor = binding.context.actorResolver(binding.context.execution, projectRef);
    const opaque = (kind, value) => opaqueProjectionRef(projectRef, kind, value, this.cursorKey);
    if (section === "seats") return items.map((seat) => Object.freeze({ slotRef: opaque("slot", seat.actorRef), actorRef: opaque("actor", seat.actorRef), ...(typeof seat.parentActorRef === "string" ? { parentActorRef: opaque("actor", seat.parentActorRef) } : {}), kind: safeProjectionToken(seat.kind), state: safeProjectionToken(seat.state), revision: safeProjectionTime(seat.revision), duty: safeProjectionLabel(seat.duty), phase: safeProjectionToken(seat.phase, "idle"), hasResourceScope: Array.isArray(seat.resourceScope) && seat.resourceScope.length > 0, hasNextStep: typeof seat.nextStep === "string" && seat.nextStep.trim() !== "", updatedAt: safeProjectionTime(seat.updatedAt) }));
    if (section === "tasks") return items.map((task) => this.#safeTask(binding, task));
    if (section === "locks") return items.map((lock) => Object.freeze({ lockRef: opaque("lock", lock.resourceRef), ownerActorRef: opaque("actor", lock.ownerActorRef), ...(typeof lock.taskRef === "string" ? { taskRef: lock.taskRef } : {}), state: safeProjectionToken(lock.state), revision: safeProjectionTime(lock.revision), createdAt: safeProjectionTime(lock.createdAt), updatedAt: safeProjectionTime(lock.updatedAt) }));
    if (section === "handoffs") return items.map((handoff) => Object.freeze({ handoffRef: opaque("handoff", handoff.handoffRef), taskRef: handoff.taskRef, sourceActorRef: opaque("actor", handoff.sourceActorRef), targetActorRef: opaque("actor", handoff.targetActorRef), state: safeProjectionToken(handoff.state), revision: safeProjectionTime(handoff.revision), hasSummary: typeof handoff.summary === "string" && handoff.summary.trim() !== "", createdAt: safeProjectionTime(handoff.createdAt), updatedAt: safeProjectionTime(handoff.updatedAt) }));
    if (section === "recoveries") {
      const authority = this.#rootRecoveryAuthority(binding);
      return items.map((item) => {
        const mine = item.initiatorActorRef === authority.actorRef;
        const resumable = ["prepared", "reserved", "activated", "failed", "outcome_unknown"].includes(item.state);
        const hasDurableLaunch = typeof item.launchRef === "string";
        const canRetry = mine && item.mode === "retry" && resumable && hasDurableLaunch;
        const canRequestTakeover = mine && authority.isCoordinator && item.mode === "takeover" && resumable && (item.state === "prepared" || hasDurableLaunch);
        const action = canRetry ? "retry" : canRequestTakeover ? "takeover" : undefined;
        return Object.freeze({ recoveryRef: opaque("recovery", item.recoveryRef), mode: safeProjectionToken(item.mode), state: safeProjectionToken(item.state), revision: safeProjectionTime(item.revision), failureCode: safeProjectionToken(item.failureCode, "failed"), mine, failedSeatMine: item.failedActorRef === authority.actorRef, canRetry, canRequestTakeover, ...(action === undefined ? {} : { recoveryCapability: encodeRootRecoveryCapability(projectRef, item.recoveryRef, item.revision, action, authority.actorRef, this.cursorKey) }), requiresConfirmation: true, updatedAt: safeProjectionTime(item.updatedAt) });
      });
    }
    if (section === "evidence") return items.map((item) => Object.freeze({ evidenceRef: opaque("evidence", item.evidenceRef), taskRef: item.taskRef, ...(typeof item.actorRef === "string" ? { actorRef: opaque("actor", item.actorRef) } : {}), kind: safeProjectionToken(item.kind), state: safeProjectionToken(item.state, "recorded"), createdAt: safeProjectionTime(item.createdAt) }));
    if (section === "history") return items.map((item) => Object.freeze({ historyRef: opaque("history", String(item.revision)), revision: safeProjectionTime(item.revision), kind: safeProjectionToken(item.kind), ...(typeof item.actorRef === "string" ? { actorRef: opaque("actor", item.actorRef) } : {}), ...(typeof item.subjectRef === "string" ? { subjectRef: opaque("ref", item.subjectRef) } : {}), createdAt: safeProjectionTime(item.createdAt) }));
    if (section === "requests") return items.map((request) => Object.freeze({ requestRef: opaque("request", request.requestRef), kind: safeProjectionToken(request.kind), taskRef: opaque("task", request.taskRef), ...(typeof request.dependencyTaskRef === "string" ? { dependencyTaskRef: opaque("task", request.dependencyTaskRef) } : {}), requesterActorRef: opaque("actor", request.requesterActorRef), targetActorRef: opaque("actor", request.targetActorRef), state: safeProjectionToken(request.state, "open"), revision: safeProjectionTime(request.revision), respondByAt: safeProjectionTime(request.respondByAt), mine: request.mine === true, targetedToMe: request.targetedToMe === true, escalationEligible: request.escalationEligible === true, ...(typeof request.reason === "string" ? { reason: request.reason.slice(0, 4_000) } : {}), ...(typeof request.resolution === "string" ? { resolution: request.resolution.slice(0, 4_000) } : {}), createdAt: safeProjectionTime(request.createdAt), updatedAt: safeProjectionTime(request.updatedAt) }));
    return [];
  }

  #combinedState(binding, legacyTeamTasks) {
    let authority = this.#authorityPage(binding, undefined, legacyTeamTasks);
    let collaboration = this.#collaborationPage(binding);
    let authorityLimit = authority.page.includedTasks;
    const collaborationLimits = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, collaboration.sectionPages[section].includedItems]));
    const minimumAuthority = authority.totalTasks > 0 ? 1 : 0;
    const minimumCollaboration = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, collaboration.totals[section] > 0 ? 1 : 0]));
    const compose = () => ({ ...authority, projectCollaboration: collaboration });
    let combined = compose();
    while (Buffer.byteLength(JSON.stringify(combined), "utf8") > MAX_WEB_TASK_PAGE_BYTES) {
      const candidates = [];
      if (authorityLimit > minimumAuthority) candidates.push({ surface: "authority", bytes: Buffer.byteLength(JSON.stringify(authority.tasks.at(-1)), "utf8") });
      for (const section of COLLABORATION_SECTIONS) {
        if (collaborationLimits[section] > minimumCollaboration[section]) candidates.push({ surface: section, bytes: Buffer.byteLength(JSON.stringify(collaboration.sections[section].at(-1)), "utf8") });
      }
      candidates.sort((left, right) => right.bytes - left.bytes || (left.surface === "authority" ? -1 : right.surface === "authority" ? 1 : COLLABORATION_SECTIONS.indexOf(right.surface) - COLLABORATION_SECTIONS.indexOf(left.surface)));
      const selected = candidates[0];
      if (selected === undefined) throw webError("combined task state cannot fit the transfer budget", "PROJECT_TASK_WEB_PAGE_TOO_LARGE");
      if (selected.surface === "authority") {
        authorityLimit -= 1;
        authority = this.#authorityPage(binding, undefined, legacyTeamTasks, authorityLimit);
      } else {
        collaborationLimits[selected.surface] -= 1;
        collaboration = this.#collaborationPage(binding, undefined, false, collaborationLimits);
      }
      combined = compose();
    }
    return combined;
  }

  #collaborationSnapshot(binding, force = false) {
    const projectRef = binding.context.projectRef;
    const revision = binding.store.getProjectRevision(projectRef);
    const cached = this.collaborationCache.get(projectRef);
    if (!force && cached?.revision === revision) return cached;
    const sections = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, []]));
    const totals = {};
    const sectionPages = {};
    const itemBoundaries = {};
    const windowHasMore = {};
    let taskGroupTotals = Object.freeze({ in_progress: 0, in_review: 0, blocked: 0, pending: 0, completed: 0, canceled: 0 });
    let available = false, status = "inactive", permissions = {};
    const initialLimit = Math.min(8, Math.floor(MAX_WEB_COLLABORATION_ITEMS / COLLABORATION_SECTIONS.length));
    for (const section of COLLABORATION_SECTIONS) {
      const window = binding.collaborationService.sectionWindow(binding.context.execution, { projectRef, section, limit: initialLimit, expectedProjectRevision: revision });
      available ||= window.available === true;
      status = safeProjectionToken(window.status, status);
      permissions = window.permissions ?? permissions;
      sections[section] = this.#safeCollaborationItems(binding, section, window.items ?? []);
      itemBoundaries[section] = Array.isArray(window.itemBoundaries) ? window.itemBoundaries : [];
      if (section === "tasks" && isRecord(window.taskGroupTotals)) taskGroupTotals = Object.freeze(Object.fromEntries(["in_progress", "in_review", "blocked", "pending", "completed", "canceled"].map((group) => [group, Number.isSafeInteger(window.taskGroupTotals[group]) && window.taskGroupTotals[group] >= 0 ? window.taskGroupTotals[group] : 0])));
      windowHasMore[section] = window.hasMore === true;
      totals[section] = Number.isSafeInteger(window.total) ? window.total : sections[section].length;
      sectionPages[section] = Object.freeze({ includedItems: sections[section].length, hasMore: window.hasMore === true, nextCursor: window.hasMore === true && window.nextBoundary !== null ? encodeCollaborationPageCursor(projectRef, revision, section, window.nextBoundary, this.cursorKey) : null });
    }
    const safePermissions = Object.freeze({ canCreate: permissions.canCreate === true, canAssign: permissions.canAssign === true, canReview: permissions.canReview === true, canResolveConflict: permissions.canResolveConflict === true, canUpdateOwnSeat: permissions.canUpdateOwnSeat === true, canClaim: permissions.canClaim === true, canSubmit: permissions.canSubmit === true });
    const snapshot = Object.freeze({ available, revision, status, permissions: safePermissions, sections: Object.freeze(sections), totals: Object.freeze(totals), taskGroupTotals, sectionPages: Object.freeze(sectionPages), itemBoundaries: Object.freeze(itemBoundaries), windowHasMore: Object.freeze(windowHasMore) });
    this.collaborationCache.set(projectRef, snapshot);
    return snapshot;
  }

  #collaborationPage(binding, cursor, force = false, initialCountLimits) {
    const projectRef = binding.context.projectRef;
    const snapshot = this.#collaborationSnapshot(binding, force);
    if (cursor === undefined) {
      const counts = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, Math.min(snapshot.sections[section].length, Number.isSafeInteger(initialCountLimits?.[section]) && initialCountLimits[section] >= 0 ? initialCountLimits[section] : snapshot.sections[section].length)]));
      const minimumCounts = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, snapshot.totals[section] > 0 ? 1 : 0]));
      if (COLLABORATION_SECTIONS.some((section) => counts[section] < minimumCounts[section])) throw webError("collaboration initial window is inconsistent", "PROJECT_TASK_WEB_PAGE_TOO_LARGE");
      const composeInitial = () => {
        const sections = {}, sectionPages = {};
        for (const section of COLLABORATION_SECTIONS) {
          const count = counts[section], items = snapshot.sections[section].slice(0, count);
          const hasMore = count < snapshot.sections[section].length || snapshot.windowHasMore[section] === true;
          const boundary = count === 0 ? null : snapshot.itemBoundaries[section][count - 1];
          const nextCursor = hasMore && isRecord(boundary) ? encodeCollaborationPageCursor(projectRef, snapshot.revision, section, boundary, this.cursorKey) : null;
          sections[section] = items;
          sectionPages[section] = Object.freeze({ includedItems: items.length, hasMore: nextCursor !== null, nextCursor });
        }
        const nextCursor = COLLABORATION_SECTIONS.map((section) => sectionPages[section].nextCursor).find(Boolean) ?? null;
        return { available: snapshot.available, mode: "current-project", revision: snapshot.revision, status: snapshot.status, permissions: snapshot.permissions, totals: snapshot.totals, taskGroupTotals: snapshot.taskGroupTotals, totalExact: true, sections, sectionPages, page: { includedItems: COLLABORATION_SECTIONS.reduce((sum, section) => sum + sections[section].length, 0), hasMore: nextCursor !== null, nextCursor } };
      };
      let page = composeInitial();
      while (Buffer.byteLength(JSON.stringify(page), "utf8") > MAX_WEB_COLLABORATION_PAGE_BYTES && COLLABORATION_SECTIONS.some((section) => counts[section] > minimumCounts[section])) {
        const section = COLLABORATION_SECTIONS.filter((name) => counts[name] > minimumCounts[name]).sort((left, right) => {
          const leftBytes = Buffer.byteLength(JSON.stringify(snapshot.sections[left][counts[left] - 1]), "utf8");
          const rightBytes = Buffer.byteLength(JSON.stringify(snapshot.sections[right][counts[right] - 1]), "utf8");
          return rightBytes - leftBytes || COLLABORATION_SECTIONS.indexOf(right) - COLLABORATION_SECTIONS.indexOf(left);
        })[0];
        counts[section] -= 1;
        page = composeInitial();
      }
      if (Buffer.byteLength(JSON.stringify(page), "utf8") > MAX_WEB_COLLABORATION_PAGE_BYTES) throw webError("collaboration page cannot fit the transfer budget", "PROJECT_TASK_WEB_PAGE_TOO_LARGE");
      return page;
    }
    const decoded = decodeCollaborationPageCursor(projectRef, cursor, this.cursorKey);
    if (decoded.revision !== snapshot.revision) throw webError("collaboration page cursor is stale", "PROJECT_TASK_WEB_CURSOR_STALE", { currentRevision: snapshot.revision });
    let window;
    try {
      window = binding.collaborationService.sectionWindow(binding.context.execution, { projectRef, section: decoded.section, limit: MAX_WEB_COLLABORATION_SECTION_ITEMS, boundary: decoded.boundary, expectedProjectRevision: decoded.revision });
    } catch (error) {
      if (error?.code === "PROJECT_TASK_SNAPSHOT_INCONSISTENT") throw webError("collaboration page cursor is stale", "PROJECT_TASK_WEB_CURSOR_STALE", { currentRevision: error.currentRevision });
      throw error;
    }
    const allItems = this.#safeCollaborationItems(binding, decoded.section, window.items ?? []);
    const compose = (count) => {
      const items = allItems.slice(0, count);
      const hasMore = count < allItems.length || window.hasMore === true;
      const boundary = count === 0 ? null : count < allItems.length ? window.itemBoundaries[count - 1] : window.nextBoundary ?? window.itemBoundaries[count - 1];
      const nextCursor = hasMore && boundary !== null ? encodeCollaborationPageCursor(projectRef, snapshot.revision, decoded.section, boundary, this.cursorKey) : null;
      const sections = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, section === decoded.section ? items : []]));
      const sectionPages = Object.fromEntries(COLLABORATION_SECTIONS.map((section) => [section, Object.freeze({ includedItems: section === decoded.section ? items.length : 0, hasMore: section === decoded.section && nextCursor !== null, nextCursor: section === decoded.section ? nextCursor : null })]));
      return { available: snapshot.available, mode: "current-project", revision: snapshot.revision, status: snapshot.status, permissions: snapshot.permissions, totals: snapshot.totals, taskGroupTotals: snapshot.taskGroupTotals, totalExact: true, sections, sectionPages, page: { section: decoded.section, includedItems: items.length, hasMore: nextCursor !== null, nextCursor } };
    };
    let count = allItems.length, page = compose(count);
    if (Buffer.byteLength(JSON.stringify(page), "utf8") > MAX_WEB_COLLABORATION_PAGE_BYTES) {
      let low = 0, high = count;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (Buffer.byteLength(JSON.stringify(compose(middle)), "utf8") <= MAX_WEB_COLLABORATION_PAGE_BYTES) low = middle;
        else high = middle - 1;
      }
      count = low;
      page = compose(count);
    }
    if ((count === 0 && (allItems.length > 0 || window.hasMore === true)) || Buffer.byteLength(JSON.stringify(page), "utf8") > MAX_WEB_COLLABORATION_PAGE_BYTES) throw webError("collaboration page cannot progress within the transfer budget", "PROJECT_TASK_WEB_PAGE_TOO_LARGE");
    return page;
  }

  #queueCollaborationUpdate(projectRef, revision) {
    this.pendingCollaborationUpdates.set(projectRef, { type: "project-task", event: { projectRevision: revision, eventRef: `collaboration_${revision}`, taskRef: "collaboration", type: "collaboration.changed", createdAt: this.now() } });
    if (this.collaborationPublishTimers.has(projectRef)) return;
    const timer = setTimeout(() => {
      this.collaborationPublishTimers.delete(projectRef);
      const update = this.pendingCollaborationUpdates.get(projectRef);
      this.pendingCollaborationUpdates.delete(projectRef);
      if (update !== undefined && !this.closing) this.#publish(update);
    }, COLLABORATION_SSE_DEBOUNCE_MS);
    this.collaborationPublishTimers.set(projectRef, timer);
    timer.unref?.();
  }

  #authorityPage(binding, cursor, legacyTeamTasks, initialCountLimit = MAX_WEB_TASKS) {
    const projectRef = binding.context.projectRef;
    const decoded = cursor === undefined ? undefined : decodeTaskPageCursor(projectRef, cursor, this.cursorKey);
    const window = binding.store.readTaskWindow({
      projectRef,
      limit: MAX_WEB_TASKS,
      ...(decoded === undefined ? {} : { afterStatusRank: decoded.statusRank, afterPriority: decoded.priority, afterUpdatedAt: decoded.updatedAt, afterCreatedAt: decoded.createdAt, afterTaskRef: decoded.taskRef }),
    });
    if (decoded !== undefined && decoded.projectRevision !== window.projectRevision) throw webError("task page cursor is stale", "PROJECT_TASK_WEB_CURSOR_STALE", { currentRevision: window.projectRevision });
    const safeTasks = window.tasks.map((task) => this.#safeTask(binding, task));
    const capability = { available: true, writable: true, canCreate: true, kind: "authority", mode: "authority", actions: [...WEB_ACTIONS], legacyTeamTasks };
    const compose = (count) => {
      const tasks = safeTasks.slice(0, count);
      const hasMore = count < safeTasks.length || window.hasMore;
      const boundary = count > 0 ? window.itemBoundaries[count - 1] : undefined;
      return {
        ok: true,
        capability,
        projectRevision: window.projectRevision,
        totalTasks: window.totalTasks,
        groupTotals: window.groupTotals,
        totalExact: true,
        tasks,
        hasMore,
        page: { includedTasks: tasks.length, hasMore, nextCursor: hasMore && boundary !== undefined ? encodeTaskPageCursor(projectRef, window.projectRevision, boundary, this.cursorKey) : null },
      };
    };
    const initialCount = Math.min(safeTasks.length, Math.max(0, initialCountLimit));
    let page = compose(initialCount);
    if (Buffer.byteLength(JSON.stringify(page), "utf8") <= MAX_WEB_TASK_PAGE_BYTES) return page;
    let low = 0, high = initialCount;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2), candidate = compose(middle);
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") <= MAX_WEB_TASK_PAGE_BYTES) low = middle;
      else high = middle - 1;
    }
    page = compose(low);
    if ((low === 0 && (safeTasks.length > 0 || window.hasMore)) || Buffer.byteLength(JSON.stringify(page), "utf8") > MAX_WEB_TASK_PAGE_BYTES) throw webError("task page cannot progress within the transfer budget", "PROJECT_TASK_WEB_PAGE_TOO_LARGE");
    return page;
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
      status: safeProjectionToken(task.status, "backlog"),
      statusGroup: safeProjectionToken(task.statusGroup, "pending"),
      ...(Number.isSafeInteger(task.priority) && task.priority >= 0 && task.priority <= 1_000_000 ? { priority: task.priority } : {}),
      ...(typeof task.collaborationStatus === "string" ? { collaborationStatus: safeProjectionToken(task.collaborationStatus) } : {}),
      revision: task.revision,
      requirementsRevision: task.requirementsRevision,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      hasAssignee: typeof task.assigneeActorRef === "string",
      hasFileScope: Array.isArray(task.fileScope) && task.fileScope.length > 0,
      blockedByCount: blockedBy.length,
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
  MAX_WEB_COLLABORATION_ITEMS,
  MAX_WEB_COLLABORATION_SECTION_ITEMS,
  MAX_WEB_COLLABORATION_PAGE_BYTES,
  WEB_PAGE_CURSOR_MAX_CHARS,
  MAX_WEB_TASK_PAGE_BYTES,
  MAX_WEB_TASKS,
  ProjectTaskWebRuntime,
  decodeCollaborationPageCursor,
  decodeTaskPageCursor,
  encodeCollaborationPageCursor,
  encodeTaskPageCursor,
  WEB_ACTIONS,
  normalizeWebCommand,
  projectTaskWebError,
  safeEvent,
};
