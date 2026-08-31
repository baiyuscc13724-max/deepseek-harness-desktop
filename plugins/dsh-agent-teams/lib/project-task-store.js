import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TASK_STATES } from "./project-task-domain.js";
import { PROJECT_REF, ProjectTaskFieldCipher } from "./project-task-crypto.js";

const PROJECT_TASK_SCHEMA_VERSION = 12;
const MAX_EVENTS_PER_QUERY = 500;
const TASK_STATUS_RANK_SQL = "CASE status WHEN 'in_progress' THEN 0 WHEN 'working' THEN 0 WHEN 'in_review' THEN 1 WHEN 'review' THEN 1 WHEN 'awaiting_review' THEN 1 WHEN 'blocked' THEN 2 WHEN 'todo' THEN 3 WHEN 'assigned' THEN 3 WHEN 'queued' THEN 3 WHEN 'pending' THEN 3 WHEN 'backlog' THEN 3 WHEN 'done' THEN 4 WHEN 'completed' THEN 4 WHEN 'canceled' THEN 5 WHEN 'cancelled' THEN 5 ELSE 3 END";
const TASK_STATUS_GROUP_SQL = "CASE status WHEN 'in_progress' THEN 'in_progress' WHEN 'working' THEN 'in_progress' WHEN 'in_review' THEN 'in_review' WHEN 'review' THEN 'in_review' WHEN 'awaiting_review' THEN 'in_review' WHEN 'blocked' THEN 'blocked' WHEN 'done' THEN 'completed' WHEN 'completed' THEN 'completed' WHEN 'canceled' THEN 'canceled' WHEN 'cancelled' THEN 'canceled' ELSE 'pending' END";
const COLLABORATION_SECTION_NAMES = new Set(["seats", "tasks", "locks", "handoffs", "recoveries", "evidence", "history", "requests"]);
const ROOT_RECOVERY_MODES = new Set(["retry", "takeover"]);
const ROOT_RECOVERY_STATES = new Set(["prepared", "reserved", "activated", "ready", "failed", "outcome_unknown", "cancelled"]);
const CLAIM_NEXT_BLOCKER_LIMIT = 120;
const CLAIM_NEXT_CANDIDATE_PAGE = 32;
const MAX_COLLABORATION_REQUESTS_PER_QUERY = 500;
const COLLABORATION_REQUEST_KINDS = new Set(["dependency_unblock", "release", "handoff", "takeover"]);
const COLLABORATION_REQUEST_ACTIONS = new Set(["accept", "reject", "release"]);
const MAX_TASKS_PER_QUERY = 500;
const MAX_COLLABORATION_HISTORY_PER_QUERY = 500;
const COLLABORATION_SNAPSHOT_SECTION_LIMIT = 120;
const DOMAIN_RECORD_KINDS = new Set(["comment", "relation", "attempt", "review"]);
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PATCH_KEYS = new Set(["status", "priority", "title", "requirements", "fileScope", "ownerActorRef", "assigneeActorRef", "requirementsChanged"]);

function storeError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function optionalString(value, field, max = 2_000) {
  return value === undefined || value === null || value === "" ? undefined : nonEmptyString(value, field, max);
}
function boundedUtf8String(value, field, maxCharacters = 2_000, maxBytes = 4 * 1024) {
  const normalized = nonEmptyString(value, field, maxCharacters);
  if (Buffer.byteLength(normalized, "utf8") > maxBytes) throw new RangeError(`${field} must not exceed ${maxBytes} UTF-8 bytes`);
  return normalized;
}
function safeInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${field} must be a safe integer from ${minimum} through ${maximum}`);
  return value;
}
function normalizeProjectRef(value) {
  const projectRef = nonEmptyString(value, "projectRef", 128);
  if (!PROJECT_REF.test(projectRef)) throw new TypeError("projectRef must be an opaque project reference");
  return projectRef;
}
function normalizeStatus(value) {
  if (!TASK_STATES.includes(value)) throw new TypeError(`unsupported project task status ${String(value)}`);
  return value;
}
function taskStatusGroup(value) {
  if (["in_progress", "working"].includes(value)) return "in_progress";
  if (["in_review", "review", "awaiting_review"].includes(value)) return "in_review";
  if (value === "blocked") return "blocked";
  if (["done", "completed"].includes(value)) return "completed";
  if (["canceled", "cancelled"].includes(value)) return "canceled";
  return "pending";
}
function normalizeJson(value, field) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch (error) { throw new TypeError(`${field} must be JSON serializable: ${String(error?.message ?? error)}`); }
  if (encoded === undefined) throw new TypeError(`${field} must be JSON serializable`);
  return JSON.parse(encoded);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function commandDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
function fieldName(taskRef, field) {
  return `tasks/${taskRef}/${field}`;
}
function eventField(eventRef) {
  return `events/${eventRef}/payload`;
}
function recordField(kind, ref, field) {
  return `${kind}/${ref}/${field}`;
}
function receiptField(commandId) {
  return `receipts/${commandId}/result`;
}
function collaborationField(kind, ref, field) {
  return `collaboration/${kind}/${ref}/${field}`;
}
function normalizeProjectRelativePath(value, field = "path") {
  const normalized = nonEmptyString(value, field, 2_048).replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || normalized.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new TypeError(`${field} must be a normalized project-relative path`);
  }
  return normalized;
}
function normalizeRequestDigest(value, fallback) {
  const digest = value === undefined ? fallback : nonEmptyString(value, "requestDigest", 80);
  if (!SHA256_DIGEST.test(digest)) throw new TypeError("requestDigest must be a sha256 digest");
  return digest;
}
function normalizeRecords(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new TypeError("records must be an array of at most 16 items");
  return value.map((record, index) => {
    if (!isRecord(record) || !DOMAIN_RECORD_KINDS.has(record.kind)) throw new TypeError(`records[${index}] has an unsupported kind`);
    return normalizeJson(record, `records[${index}]`);
  });
}

class ProjectTaskStore {
  constructor({ filePath, keyProvider, minimumRevisionProvider = () => 0 } = {}) {
    this.filePath = resolve(nonEmptyString(filePath, "filePath", 4_096));
    if (typeof keyProvider !== "function") throw new TypeError("keyProvider must be a function");
    if (typeof minimumRevisionProvider !== "function") throw new TypeError("minimumRevisionProvider must be a function");
    this.cipher = new ProjectTaskFieldCipher({ keyProvider });
    this.minimumRevisionProvider = minimumRevisionProvider;
    this.database = undefined;
    this.initialized = false;
    this.closed = false;
  }

  initialize() {
    if (this.closed) throw storeError("project task store is closed", "PROJECT_TASK_STORE_CLOSED");
    if (this.initialized) return this.toJSON();
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const database = new DatabaseSync(this.filePath);
    try {
      database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      this.#migrate(database);
      try { chmodSync(this.filePath, 0o600); } catch {}
      this.database = database;
      this.initialized = true;
      return this.toJSON();
    } catch (error) {
      database.close();
      throw error;
    }
  }

  toJSON() {
    return { version: PROJECT_TASK_SCHEMA_VERSION, ready: this.initialized && !this.closed };
  }

  createTask(input = {}) {
    this.#requireReady();
    if (!isRecord(input.task)) throw new TypeError("task must be an object");
    const projectRef = normalizeProjectRef(input.projectRef);
    const commandId = nonEmptyString(input.commandId, "commandId", 256);
    const eventRef = nonEmptyString(input.eventRef, "eventRef", 256);
    if (input.expectedRevision !== 0) throw new TypeError("create expectedRevision must be 0");
    const expectedRevision = 0;
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const createdAt = safeInteger(input.createdAt, "createdAt");
    const taskRef = nonEmptyString(input.task.taskRef, "task.taskRef", 256);
    const ownerActorRef = nonEmptyString(input.task.ownerActorRef, "task.ownerActorRef", 256);
    const assigneeActorRef = optionalString(input.task.assigneeActorRef, "task.assigneeActorRef", 256);
    const status = normalizeStatus(input.task.status);
    const priority = input.task.priority === undefined || input.task.priority === null ? null : safeInteger(input.task.priority, "task.priority", 0, 1_000_000);
    const title = nonEmptyString(input.task.title, "task.title", 500);
    const requirements = normalizeJson(input.task.requirements ?? {}, "task.requirements");
    const fileScope = normalizeJson(input.task.fileScope ?? [], "task.fileScope");
    if (!Array.isArray(fileScope) || fileScope.some((value) => typeof value !== "string")) throw new TypeError("task.fileScope must be an array of strings");
    const eventPayload = normalizeJson(input.eventPayload ?? {}, "eventPayload");
    const digest = commandDigest({ operation: "create", projectRef, commandId, eventRef, expectedRevision, actorRef, task: { taskRef, ownerActorRef, assigneeActorRef, status, ...(priority === null ? {} : { priority }), title, requirements, fileScope }, eventPayload });
    const requestDigest = normalizeRequestDigest(input.requestDigest, digest);
    return this.#transaction(() => {
      this.#ensureProject(projectRef);
      const replay = this.#idempotentResult(projectRef, commandId, eventRef, requestDigest);
      if (replay !== undefined) return replay;
      if (this.database.prepare("SELECT 1 FROM project_tasks WHERE project_ref = ? AND task_ref = ?").get(projectRef, taskRef) !== undefined) {
        throw storeError("project task already exists", "PROJECT_TASK_CONFLICT");
      }
      if (status === "in_progress" && assigneeActorRef !== undefined) this.#assertNoOtherInProgress(projectRef, assigneeActorRef, taskRef);
      this.database.prepare(`INSERT INTO project_tasks (
        project_ref, task_ref, status, priority, revision, requirements_revision, owner_actor_ref, assignee_actor_ref,
        title_cipher, requirements_cipher, file_scope_cipher, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`).run(
        projectRef, taskRef, status, priority, ownerActorRef, assigneeActorRef ?? null,
        this.cipher.seal(projectRef, fieldName(taskRef, "title"), title),
        this.cipher.seal(projectRef, fieldName(taskRef, "requirements"), requirements),
        this.cipher.seal(projectRef, fieldName(taskRef, "fileScope"), fileScope),
        createdAt, createdAt,
      );
      const projectRevision = this.#nextProjectRevision(projectRef);
      const payloadCipher = this.cipher.seal(projectRef, eventField(eventRef), eventPayload);
      this.#insertEvent({ projectRef, projectRevision, eventRef, commandId, digest, taskRef, type: "task.created", actorRef, payloadCipher, createdAt });
      const receipt = { duplicate: false, projectRevision, task: this.#readTask(projectRef, taskRef) };
      this.#insertReceipt({ projectRef, commandId, eventRef, requestDigest, actorRef, taskRef, receipt, createdAt });
      return receipt;
    });
  }

  mutateTask(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const taskRef = nonEmptyString(input.taskRef, "taskRef", 256);
    const commandId = nonEmptyString(input.commandId, "commandId", 256);
    const eventRef = nonEmptyString(input.eventRef, "eventRef", 256);
    const expectedRevision = safeInteger(input.expectedRevision, "expectedRevision", 1);
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const type = nonEmptyString(input.type, "type", 128);
    const createdAt = safeInteger(input.createdAt, "createdAt");
    const patch = input.patch ?? {};
    if (!isRecord(patch)) throw new TypeError("patch must be an object");
    const extras = Object.keys(patch).filter((key) => !PATCH_KEYS.has(key));
    if (extras.length > 0) throw new TypeError(`patch contains unsupported fields: ${extras.join(", ")}`);
    if (patch.requirementsChanged !== undefined && typeof patch.requirementsChanged !== "boolean") throw new TypeError("patch.requirementsChanged must be boolean");
    const eventPayload = normalizeJson(input.eventPayload ?? {}, "eventPayload");
    const records = normalizeRecords(input.records);
    const normalizedPatch = normalizeJson(patch, "patch");
    if (normalizedPatch.status !== undefined) normalizeStatus(normalizedPatch.status);
    if (normalizedPatch.priority !== undefined && normalizedPatch.priority !== null) safeInteger(normalizedPatch.priority, "patch.priority", 0, 1_000_000);
    if (normalizedPatch.title !== undefined) nonEmptyString(normalizedPatch.title, "patch.title", 500);
    if (normalizedPatch.fileScope !== undefined && (!Array.isArray(normalizedPatch.fileScope) || normalizedPatch.fileScope.some((value) => typeof value !== "string"))) throw new TypeError("patch.fileScope must be an array of strings");
    if (normalizedPatch.ownerActorRef !== undefined) nonEmptyString(normalizedPatch.ownerActorRef, "patch.ownerActorRef", 256);
    if (normalizedPatch.assigneeActorRef !== undefined && normalizedPatch.assigneeActorRef !== null) nonEmptyString(normalizedPatch.assigneeActorRef, "patch.assigneeActorRef", 256);
    const digest = commandDigest({ operation: "mutate", projectRef, taskRef, commandId, eventRef, expectedRevision, actorRef, type, patch: normalizedPatch, records, eventPayload });
    const requestDigest = normalizeRequestDigest(input.requestDigest, digest);
    return this.#transaction(() => {
      this.#assertProjectRevision(projectRef);
      const replay = this.#idempotentResult(projectRef, commandId, eventRef, requestDigest);
      if (replay !== undefined) return replay;
      const current = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref = ? AND task_ref = ?").get(projectRef, taskRef);
      if (current === undefined) throw storeError("unknown project task", "PROJECT_TASK_NOT_FOUND");
      if (current.revision !== expectedRevision) throw storeError("project task compare-and-swap revision changed", "PROJECT_TASK_CONFLICT", { currentRevision: current.revision });
      const inferredRequirementsChanged = (
        normalizedPatch.title !== undefined && normalizedPatch.title !== this.cipher.open(projectRef, fieldName(taskRef, "title"), current.title_cipher)
        || normalizedPatch.requirements !== undefined && canonicalJson(normalizedPatch.requirements) !== canonicalJson(this.cipher.open(projectRef, fieldName(taskRef, "requirements"), current.requirements_cipher))
        || normalizedPatch.fileScope !== undefined && canonicalJson(normalizedPatch.fileScope) !== canonicalJson(this.cipher.open(projectRef, fieldName(taskRef, "fileScope"), current.file_scope_cipher))
      );
      const requirementsChanged = normalizedPatch.requirementsChanged === true || inferredRequirementsChanged;
      const updates = {
        status: normalizedPatch.status ?? current.status,
        priority: Object.prototype.hasOwnProperty.call(normalizedPatch, "priority") ? normalizedPatch.priority : current.priority,
        ownerActorRef: normalizedPatch.ownerActorRef ?? current.owner_actor_ref,
        assigneeActorRef: Object.prototype.hasOwnProperty.call(normalizedPatch, "assigneeActorRef") ? normalizedPatch.assigneeActorRef : current.assignee_actor_ref,
        titleCipher: normalizedPatch.title === undefined ? current.title_cipher : this.cipher.seal(projectRef, fieldName(taskRef, "title"), normalizedPatch.title),
        requirementsCipher: normalizedPatch.requirements === undefined ? current.requirements_cipher : this.cipher.seal(projectRef, fieldName(taskRef, "requirements"), normalizedPatch.requirements),
        fileScopeCipher: normalizedPatch.fileScope === undefined ? current.file_scope_cipher : this.cipher.seal(projectRef, fieldName(taskRef, "fileScope"), normalizedPatch.fileScope),
        revision: current.revision + 1,
        requirementsRevision: current.requirements_revision + (requirementsChanged ? 1 : 0),
      };
      if (updates.status === "in_progress" && updates.assigneeActorRef !== null) this.#assertNoOtherInProgress(projectRef, updates.assigneeActorRef, taskRef);
      const result = this.database.prepare(`UPDATE project_tasks SET
        status = ?, priority = ?, revision = ?, requirements_revision = ?, owner_actor_ref = ?, assignee_actor_ref = ?,
        title_cipher = ?, requirements_cipher = ?, file_scope_cipher = ?, updated_at = ?
        WHERE project_ref = ? AND task_ref = ? AND revision = ?`).run(
        updates.status, updates.priority, updates.revision, updates.requirementsRevision, updates.ownerActorRef, updates.assigneeActorRef ?? null,
        updates.titleCipher, updates.requirementsCipher, updates.fileScopeCipher, createdAt,
        projectRef, taskRef, expectedRevision,
      );
      if (Number(result.changes) !== 1) throw storeError("project task compare-and-swap revision changed", "PROJECT_TASK_CONFLICT");
      if (requirementsChanged) {
        this.database.prepare("UPDATE project_task_attempts SET invalidated = 1 WHERE project_ref = ? AND task_ref = ?").run(projectRef, taskRef);
        this.database.prepare("UPDATE project_task_reviews SET superseded = 1 WHERE project_ref = ? AND task_ref = ?").run(projectRef, taskRef);
      }
      for (const record of records) this.#applyRecord(projectRef, taskRef, record, createdAt);
      const projectRevision = this.#nextProjectRevision(projectRef);
      // Keep event encryption inside the transaction: an oversized or otherwise invalid
      // event must roll back both the aggregate row and the project revision.
      const payloadCipher = this.cipher.seal(projectRef, eventField(eventRef), eventPayload);
      this.#insertEvent({ projectRef, projectRevision, eventRef, commandId, digest, taskRef, type, actorRef, payloadCipher, createdAt });
      const receipt = { duplicate: false, projectRevision, task: this.#readTask(projectRef, taskRef) };
      this.#insertReceipt({ projectRef, commandId, eventRef, requestDigest, actorRef, taskRef, receipt, createdAt });
      return receipt;
    });
  }

  saveActor({ projectRef: inputProjectRef, actor, updatedAt } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    if (!isRecord(actor)) throw new TypeError("actor must be an object");
    const actorRef = nonEmptyString(actor.actorRef, "actor.actorRef", 256);
    const kind = nonEmptyString(actor.kind, "actor.kind", 32);
    const role = optionalString(actor.role, "actor.role", 32);
    const authorities = normalizeJson(actor.authorities ?? [], "actor.authorities");
    if (!Array.isArray(authorities) || authorities.some((value) => typeof value !== "string")) throw new TypeError("actor.authorities must be an array of strings");
    const timestamp = safeInteger(updatedAt, "updatedAt");
    return this.#transaction(() => {
      this.#ensureProject(projectRef);
      this.database.prepare(`INSERT INTO project_task_actors(project_ref, actor_ref, kind, role, authorities_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_ref, actor_ref) DO UPDATE SET
        kind = excluded.kind, role = excluded.role, authorities_json = excluded.authorities_json, updated_at = excluded.updated_at`).run(projectRef, actorRef, kind, role ?? null, JSON.stringify(authorities), timestamp);
      return this.getActor({ projectRef, actorRef });
    });
  }

  getActor({ projectRef: inputProjectRef, actorRef: inputActorRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const actorRef = nonEmptyString(inputActorRef, "actorRef", 256);
    const row = this.database.prepare("SELECT * FROM project_task_actors WHERE project_ref = ? AND actor_ref = ?").get(projectRef, actorRef);
    return row === undefined ? undefined : { projectRef, actorRef, kind: row.kind, ...(row.role === null ? {} : { role: row.role }), authorities: JSON.parse(row.authorities_json) };
  }

  reserveRootSeat(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const coordinatorActorRef = nonEmptyString(input.coordinatorActorRef, "coordinatorActorRef", 256);
    const requestId = nonEmptyString(input.requestId, "requestId", 256);
    const slotActorRef = nonEmptyString(input.slotActorRef, "slotActorRef", 256);
    const slotCapability = nonEmptyString(input.slotCapability, "slotCapability", 512);
    if (!isRecord(input.task)) throw new TypeError("task must be an object");
    const taskRef = nonEmptyString(input.task.taskRef, "task.taskRef", 256);
    const title = nonEmptyString(input.task.title, "task.title", 500);
    const requirements = normalizeJson(input.task.requirements ?? {}, "task.requirements");
    if (Buffer.byteLength(canonicalJson(requirements), "utf8") > 64 * 1024) throw new RangeError("task.requirements must not exceed 65536 bytes");
    const fileScope = normalizeJson(input.task.fileScope ?? [], "task.fileScope");
    if (!Array.isArray(fileScope) || fileScope.length > 64) throw new TypeError("task.fileScope must be an array of at most 64 project-relative paths");
    const normalizedFileScope = fileScope.map((value, index) => normalizeProjectRelativePath(value, `task.fileScope[${index}]`));
    const duty = nonEmptyString(input.duty, "duty", 500);
    const resourceScope = normalizeJson(input.resourceScope ?? [], "resourceScope");
    if (!Array.isArray(resourceScope) || resourceScope.length > 64) throw new TypeError("resourceScope must be an array of at most 64 project-relative paths");
    const normalizedScope = resourceScope.map((value, index) => normalizeProjectRelativePath(value, `resourceScope[${index}]`));
    const phase = nonEmptyString(input.phase ?? "queued", "phase", 128);
    const nextStep = nonEmptyString(input.nextStep ?? "Await root session adoption", "nextStep", 2_000);
    const timestamp = safeInteger(input.createdAt, "createdAt");
    const capabilityDigest = commandDigest({ operation: "root-seat-capability", projectRef, slotActorRef, slotCapability });
    const requestDigest = commandDigest({ operation: "root-seat-reserve", projectRef, coordinatorActorRef, requestId, slotActorRef, capabilityDigest, duty, resourceScope: normalizedScope, phase, nextStep, task: { taskRef, title, requirements, fileScope: normalizedFileScope } });
    let duplicate = false;
    let resultActorRef = slotActorRef;
    this.#transaction(() => {
      const board = this.database.prepare("SELECT coordinator_actor_ref FROM project_collaboration_boards WHERE project_ref=?").get(projectRef);
      if (board === undefined) throw storeError("collaboration board must exist before reserving a root seat", "PROJECT_COLLABORATION_NOT_FOUND");
      if (board.coordinator_actor_ref !== coordinatorActorRef) throw storeError("only the board coordinator may reserve a root seat", "PROJECT_COLLABORATION_FORBIDDEN");
      const replay = this.database.prepare("SELECT * FROM project_collaboration_root_reservations WHERE project_ref=? AND request_id=?").get(projectRef, requestId);
      if (replay !== undefined) {
        if (replay.request_digest !== requestDigest) throw storeError("reservation request identifier was reused with different input", "PROJECT_TASK_IDEMPOTENCY_CONFLICT");
        duplicate = true;
        resultActorRef = replay.adopted_actor_ref ?? slotActorRef;
        return;
      }
      if (this.database.prepare("SELECT 1 FROM project_collaboration_root_reservations WHERE project_ref=? AND slot_actor_ref=?").get(projectRef, slotActorRef) !== undefined
        || this.database.prepare("SELECT 1 FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=?").get(projectRef, slotActorRef) !== undefined
        || this.database.prepare("SELECT 1 FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, taskRef) !== undefined) {
        throw storeError("reserved slot or initial task already exists", "PROJECT_COLLABORATION_CONFLICT");
      }
      this.database.prepare(`INSERT INTO project_collaboration_seats(project_ref, actor_ref, parent_actor_ref, kind, state, revision, duty_cipher, resource_scope_cipher, phase_cipher, next_step_cipher, created_at, updated_at)
        VALUES (?, ?, NULL, 'root', 'reserved', 1, ?, ?, ?, ?, ?, ?)`).run(projectRef, slotActorRef,
        this.cipher.seal(projectRef, collaborationField("seat", slotActorRef, "duty"), duty),
        this.cipher.seal(projectRef, collaborationField("seat", slotActorRef, "resourceScope"), normalizedScope),
        this.cipher.seal(projectRef, collaborationField("seat", slotActorRef, "phase"), phase),
        this.cipher.seal(projectRef, collaborationField("seat", slotActorRef, "nextStep"), nextStep), timestamp, timestamp);
      this.database.prepare(`INSERT INTO project_tasks(project_ref, task_ref, status, revision, requirements_revision, owner_actor_ref, assignee_actor_ref, title_cipher, requirements_cipher, file_scope_cipher, created_at, updated_at)
        VALUES (?, ?, 'todo', 1, 1, ?, ?, ?, ?, ?, ?, ?)`).run(projectRef, taskRef, slotActorRef, slotActorRef,
        this.cipher.seal(projectRef, fieldName(taskRef, "title"), title), this.cipher.seal(projectRef, fieldName(taskRef, "requirements"), requirements),
        this.cipher.seal(projectRef, fieldName(taskRef, "fileScope"), normalizedFileScope), timestamp, timestamp);
      this.database.prepare(`INSERT INTO project_collaboration_root_reservations(project_ref, slot_actor_ref, request_id, request_digest, capability_digest, task_ref, state, adopted_actor_ref, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'reserved', NULL, ?, ?)`).run(projectRef, slotActorRef, requestId, requestDigest, capabilityDigest, taskRef, timestamp, timestamp);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1, updated_at=? WHERE project_ref=?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "root-seat.reserved", actorRef: coordinatorActorRef, subjectRef: slotActorRef, summary: "root seat and initial task reserved", createdAt: timestamp });
    });
    const snapshot = this.readCollaborationSnapshot({ projectRef, historyLimit: 1 });
    return { duplicate, projectRevision: this.getProjectRevision(projectRef), seat: snapshot.seats.find((seat) => seat.actorRef === resultActorRef), task: this.getTask({ projectRef, taskRef }) };
  }

  adoptRootSeat(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const slotActorRef = nonEmptyString(input.slotActorRef, "slotActorRef", 256);
    const slotCapability = nonEmptyString(input.slotCapability, "slotCapability", 512);
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    if (actorRef === slotActorRef) throw new TypeError("adopting root actor must differ from reserved slot actor");
    const timestamp = safeInteger(input.adoptedAt, "adoptedAt");
    const capabilityDigest = commandDigest({ operation: "root-seat-capability", projectRef, slotActorRef, slotCapability });
    let taskRef, duplicate = false;
    this.#transaction(() => {
      const reservation = this.database.prepare("SELECT * FROM project_collaboration_root_reservations WHERE project_ref=? AND slot_actor_ref=?").get(projectRef, slotActorRef);
      if (reservation?.state === "adopted" && reservation.adopted_actor_ref === actorRef) { taskRef=reservation.task_ref; duplicate=true; return; }
      if (reservation === undefined || reservation.state !== "reserved" || reservation.capability_digest !== capabilityDigest) throw storeError("root seat capability is invalid, consumed, or foreign", "PROJECT_COLLABORATION_CAPABILITY_INVALID");
      if (this.database.prepare("SELECT 1 FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=?").get(projectRef, actorRef) !== undefined) throw storeError("adopting root already owns a project seat", "PROJECT_COLLABORATION_CONFLICT");
      const seat = this.database.prepare("SELECT * FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=? AND kind='root' AND state='reserved'").get(projectRef, slotActorRef);
      if (seat === undefined) throw storeError("reserved root seat is unavailable", "PROJECT_COLLABORATION_CONFLICT");
      this.database.prepare(`INSERT INTO project_collaboration_seats(project_ref, actor_ref, parent_actor_ref, kind, state, revision, duty_cipher, resource_scope_cipher, phase_cipher, next_step_cipher, created_at, updated_at)
        VALUES (?, ?, NULL, 'root', 'active', ?, ?, ?, ?, ?, ?, ?)`).run(projectRef, actorRef, seat.revision + 1,
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "duty"), this.cipher.open(projectRef, collaborationField("seat", slotActorRef, "duty"), seat.duty_cipher)),
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "resourceScope"), this.cipher.open(projectRef, collaborationField("seat", slotActorRef, "resourceScope"), seat.resource_scope_cipher)),
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "phase"), "active"),
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "nextStep"), this.cipher.open(projectRef, collaborationField("seat", slotActorRef, "nextStep"), seat.next_step_cipher)), seat.created_at, timestamp);
      this.database.prepare(`UPDATE project_tasks SET
        owner_actor_ref=CASE WHEN owner_actor_ref=? THEN ? ELSE owner_actor_ref END,
        assignee_actor_ref=CASE WHEN assignee_actor_ref=? THEN ? ELSE assignee_actor_ref END,
        revision=revision+1, updated_at=?
        WHERE project_ref=? AND (owner_actor_ref=? OR assignee_actor_ref=?)`).run(slotActorRef, actorRef, slotActorRef, actorRef, timestamp, projectRef, slotActorRef, slotActorRef);
      this.database.prepare("UPDATE project_collaboration_root_reservations SET state='adopted', capability_digest=NULL, adopted_actor_ref=?, updated_at=? WHERE project_ref=? AND slot_actor_ref=?").run(actorRef, timestamp, projectRef, slotActorRef);
      this.database.prepare("DELETE FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=?").run(projectRef, slotActorRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1, updated_at=? WHERE project_ref=?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "root-seat.adopted", actorRef, subjectRef: slotActorRef, summary: "reserved root seat adopted", createdAt: timestamp });
      taskRef = reservation.task_ref;
    });
    const snapshot = this.readCollaborationSnapshot({ projectRef, historyLimit: 1 });
    return { duplicate, projectRevision: this.getProjectRevision(projectRef), seat: snapshot.seats.find((seat) => seat.actorRef === actorRef), task: this.getTask({ projectRef, taskRef }) };
  }

  prepareRootRecovery(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const recoveryRef = nonEmptyString(input.recoveryRef, "recoveryRef", 256);
    const requestId = nonEmptyString(input.requestId, "requestId", 256);
    const mode = nonEmptyString(input.mode, "mode", 32);
    if (!ROOT_RECOVERY_MODES.has(mode)) throw new TypeError("root recovery mode is unsupported");
    const failedActorRef = nonEmptyString(input.failedActorRef, "failedActorRef", 256);
    const initiatorActorRef = nonEmptyString(input.initiatorActorRef ?? input.requesterActorRef, "initiatorActorRef", 256);
    let beneficiaryActorRef = nonEmptyString(input.beneficiaryActorRef ?? input.requesterActorRef ?? failedActorRef, "beneficiaryActorRef", 256);
    const failureCode = nonEmptyString(input.failureCode, "failureCode", 256);
    const failureEvidence = boundedUtf8String(input.failureEvidence, "failureEvidence");
    const collaborationRequestRef = optionalString(input.collaborationRequestRef, "collaborationRequestRef", 256);
    const recoveryTaskRef = optionalString(input.recoveryTaskRef, "recoveryTaskRef", 256);
    const timestamp = safeInteger(input.createdAt, "createdAt");
    let requestDigest, duplicate = false;
    this.#transaction(() => {
      const takeoverRequest=mode==="takeover"&&collaborationRequestRef!==undefined?this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef,collaborationRequestRef):undefined;
      if(mode==="takeover"&&takeoverRequest!==undefined) beneficiaryActorRef=takeoverRequest.requester_actor_ref;
      if (mode === "takeover") { const board=this.database.prepare("SELECT coordinator_actor_ref FROM project_collaboration_boards WHERE project_ref=?").get(projectRef); if(board?.coordinator_actor_ref!==initiatorActorRef) throw storeError("only the coordinator may authorize takeover recovery","PROJECT_ROOT_RECOVERY_FORBIDDEN"); if(beneficiaryActorRef===failedActorRef) throw storeError("takeover requires a distinct beneficiary","PROJECT_ROOT_RECOVERY_FORBIDDEN"); }
      requestDigest = commandDigest({ operation: "root-recovery-prepare", projectRef, requestId, mode, failedActorRef, initiatorActorRef, beneficiaryActorRef, failureCode, failureEvidence, collaborationRequestRef, recoveryTaskRef });
      const replay = this.database.prepare("SELECT * FROM project_collaboration_root_recoveries WHERE project_ref=? AND request_id=?").get(projectRef, requestId);
      if (replay !== undefined) { if (replay.request_digest !== requestDigest) throw storeError("root recovery request replay drifted", "PROJECT_TASK_IDEMPOTENCY_CONFLICT"); duplicate = true; return; }
      const seat = this.database.prepare("SELECT * FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=? AND kind='root'").get(projectRef, failedActorRef);
      if (seat === undefined) throw storeError("failed root seat does not exist", "PROJECT_COLLABORATION_NOT_FOUND");
      if (mode === "takeover") {
        const request = takeoverRequest;
        const targetTaskRef=request?.dependency_task_ref ?? request?.task_ref;
        const targetTask=targetTaskRef===undefined?undefined:this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND task_ref=? AND status NOT IN ('done','canceled')").get(projectRef,targetTaskRef);
        if (request === undefined || request.kind !== "takeover" || targetTaskRef !== recoveryTaskRef || request.requester_actor_ref !== beneficiaryActorRef || request.target_actor_ref !== failedActorRef || !["resolved", "escalated"].includes(request.state) || targetTask === undefined || targetTask.owner_actor_ref !== beneficiaryActorRef || targetTask.assignee_actor_ref !== beneficiaryActorRef) throw storeError("takeover requires the exact audited request and its already migrated task ownership", "PROJECT_ROOT_RECOVERY_TAKEOVER_REQUIRED");
      }
      this.database.prepare(`INSERT INTO project_collaboration_root_recoveries(project_ref,recovery_ref,request_id,request_digest,mode,failed_actor_ref,requester_actor_ref,collaboration_request_ref,state,revision,replacement_slot_actor_ref,replacement_task_ref,launch_ref,failure_code,failure_evidence_cipher,created_at,updated_at,initiator_actor_ref,beneficiary_actor_ref)
        VALUES(?,?,?,?,?,?,?,?, 'prepared',1,NULL,?,NULL,?,?,?,?,?,?)`).run(projectRef,recoveryRef,requestId,requestDigest,mode,failedActorRef,beneficiaryActorRef,collaborationRequestRef ?? null,recoveryTaskRef ?? null,failureCode,this.cipher.seal(projectRef,collaborationField("root-recovery",recoveryRef,"failureEvidence"),failureEvidence),timestamp,timestamp,initiatorActorRef,beneficiaryActorRef);
      if (seat.state !== "reserved") this.database.prepare("UPDATE project_collaboration_seats SET state='paused',revision=revision+1,phase_cipher=?,next_step_cipher=?,updated_at=? WHERE project_ref=? AND actor_ref=?").run(this.cipher.seal(projectRef,collaborationField("seat",failedActorRef,"phase"),"recovery"),this.cipher.seal(projectRef,collaborationField("seat",failedActorRef,"nextStep"),mode === "retry" ? "Retry the exact top-level session explicitly" : "Await audited replacement root adoption"),timestamp,projectRef,failedActorRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp,projectRef);
      const projectRevision=this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({projectRef,projectRevision,kind:"root-recovery.prepared",actorRef:initiatorActorRef,subjectRef:recoveryRef,summary:`${mode} recovery prepared from Host failure evidence`,createdAt:timestamp});
    });
    return { duplicate, projectRevision:this.getProjectRevision(projectRef), recovery:this.getRootRecovery({projectRef,recoveryRef}) };
  }

  reserveRootRecovery(input = {}) {
    this.#requireReady();
    const projectRef=normalizeProjectRef(input.projectRef), recoveryRef=nonEmptyString(input.recoveryRef,"recoveryRef",256), initiatorActorRef=nonEmptyString(input.initiatorActorRef ?? input.requesterActorRef,"initiatorActorRef",256), timestamp=safeInteger(input.updatedAt,"updatedAt");
    const replacementSlotActorRef=optionalString(input.replacementSlotActorRef,"replacementSlotActorRef",256), launchRef=nonEmptyString(input.launchRef,"launchRef",256), slotCapability=optionalString(input.slotCapability,"slotCapability",512);
    return this.#transaction(()=>{
      const row=this.database.prepare("SELECT * FROM project_collaboration_root_recoveries WHERE project_ref=? AND recovery_ref=?").get(projectRef,recoveryRef);
      if(row===undefined) throw storeError("root recovery does not exist","PROJECT_COLLABORATION_NOT_FOUND");
      const beneficiaryActorRef=row.beneficiary_actor_ref ?? row.requester_actor_ref;
      if((row.initiator_actor_ref ?? row.requester_actor_ref)!==initiatorActorRef) throw storeError("root recovery initiator is unauthorized","PROJECT_ROOT_RECOVERY_FORBIDDEN");
      if(row.state==="reserved") { const reservation=replacementSlotActorRef===undefined?undefined:this.database.prepare("SELECT capability_digest FROM project_collaboration_root_reservations WHERE project_ref=? AND slot_actor_ref=?").get(projectRef,replacementSlotActorRef),capabilityDigest=slotCapability===undefined?undefined:commandDigest({operation:"root-seat-capability",projectRef,slotActorRef:replacementSlotActorRef,slotCapability}); if(row.launch_ref!==launchRef || (row.replacement_slot_actor_ref ?? undefined)!==replacementSlotActorRef || reservation?.capability_digest!==capabilityDigest) throw storeError("root recovery reservation replay drifted","PROJECT_TASK_IDEMPOTENCY_CONFLICT"); return {duplicate:true,projectRevision:this.getProjectRevision(projectRef),recovery:this.#decodeRootRecovery(projectRef,row)}; }
      if(row.state!=="prepared") throw storeError("root recovery is not preparable","PROJECT_ROOT_RECOVERY_CONFLICT");
      if(row.mode==="retry" && replacementSlotActorRef!==undefined) throw storeError("exact-session retry cannot reserve a replacement seat","PROJECT_ROOT_RECOVERY_CONFLICT");
      let taskRef;
      if(row.mode==="takeover") {
        if(replacementSlotActorRef===undefined || slotCapability===undefined) throw new TypeError("takeover recovery requires replacementSlotActorRef and slotCapability");
        const takeoverRequest=this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef,row.collaboration_request_ref);
        const targetTaskRef=takeoverRequest?.dependency_task_ref ?? takeoverRequest?.task_ref;
        if(targetTaskRef!==row.replacement_task_ref) throw storeError("audited takeover task binding changed","PROJECT_ROOT_RECOVERY_CONFLICT");
        const task=targetTaskRef===undefined?undefined:this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND task_ref=? AND status NOT IN ('done','canceled')").get(projectRef,targetTaskRef);
        if(task===undefined || task.owner_actor_ref!==beneficiaryActorRef || task.assignee_actor_ref!==beneficiaryActorRef) throw storeError("audited takeover task ownership changed","PROJECT_ROOT_RECOVERY_CONFLICT");
        const activeCount=Number(this.database.prepare("SELECT COUNT(*) AS total FROM project_tasks WHERE project_ref=? AND assignee_actor_ref=? AND status='in_progress'").get(projectRef,beneficiaryActorRef).total);
        if(activeCount>1) throw storeError("replacement source owns more than one active project task","PROJECT_TASK_ACTIVE_LIMIT");
        taskRef=task.task_ref;
        if(this.database.prepare("SELECT 1 FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=?").get(projectRef,replacementSlotActorRef)!==undefined) throw storeError("replacement seat already exists","PROJECT_COLLABORATION_CONFLICT");
        const oldSeat=this.database.prepare("SELECT * FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=?").get(projectRef,row.failed_actor_ref);
        this.database.prepare(`INSERT INTO project_collaboration_seats(project_ref,actor_ref,parent_actor_ref,kind,state,revision,duty_cipher,resource_scope_cipher,phase_cipher,next_step_cipher,created_at,updated_at) VALUES(?,?,NULL,'root','reserved',1,?,?,?,?,?,?)`).run(projectRef,replacementSlotActorRef,this.cipher.seal(projectRef,collaborationField("seat",replacementSlotActorRef,"duty"),this.cipher.open(projectRef,collaborationField("seat",row.failed_actor_ref,"duty"),oldSeat.duty_cipher)),this.cipher.seal(projectRef,collaborationField("seat",replacementSlotActorRef,"resourceScope"),this.cipher.open(projectRef,collaborationField("seat",row.failed_actor_ref,"resourceScope"),oldSeat.resource_scope_cipher)),this.cipher.seal(projectRef,collaborationField("seat",replacementSlotActorRef,"phase"),"replacement_reserved"),this.cipher.seal(projectRef,collaborationField("seat",replacementSlotActorRef,"nextStep"),"Adopt replacement root seat after Host reports ready"),timestamp,timestamp);
        const capabilityDigest=commandDigest({operation:"root-seat-capability",projectRef,slotActorRef:replacementSlotActorRef,slotCapability}),reservationRequestId=`root-recovery:${recoveryRef}`,reservationDigest=commandDigest({operation:"root-recovery-seat-reserve",projectRef,recoveryRef,replacementSlotActorRef,capabilityDigest,taskRef});
        this.database.prepare(`INSERT INTO project_collaboration_root_reservations(project_ref,slot_actor_ref,request_id,request_digest,capability_digest,task_ref,state,adopted_actor_ref,created_at,updated_at) VALUES(?,?,?,?,?,?,'reserved',NULL,?,?)`).run(projectRef,replacementSlotActorRef,reservationRequestId,reservationDigest,capabilityDigest,taskRef,timestamp,timestamp);
        const oldOwner=task.owner_actor_ref, oldAssignee=task.assignee_actor_ref;
        this.database.prepare("UPDATE project_collaboration_locks SET owner_actor_ref=?,revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=? AND owner_actor_ref IN (?,?) AND state='active'").run(replacementSlotActorRef,timestamp,projectRef,taskRef,oldOwner,oldAssignee);
        this.database.prepare("UPDATE project_tasks SET owner_actor_ref=?,assignee_actor_ref=?,revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=?").run(replacementSlotActorRef,replacementSlotActorRef,timestamp,projectRef,taskRef);
      }
      this.database.prepare("UPDATE project_collaboration_root_recoveries SET state='reserved',revision=revision+1,replacement_slot_actor_ref=?,replacement_task_ref=?,launch_ref=?,updated_at=? WHERE project_ref=? AND recovery_ref=?").run(replacementSlotActorRef ?? null,taskRef ?? null,launchRef,timestamp,projectRef,recoveryRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp,projectRef);
      const projectRevision=this.#nextProjectRevision(projectRef); this.#insertCollaborationHistory({projectRef,projectRevision,kind:"root-recovery.reserved",actorRef:initiatorActorRef,subjectRef:recoveryRef,summary:"all replacement seat/task ownership reserved atomically",createdAt:timestamp});
      return {duplicate:false,projectRevision,recovery:this.getRootRecovery({projectRef,recoveryRef})};
    });
  }

  updateRootRecovery(input = {}) {
    this.#requireReady();
    const projectRef=normalizeProjectRef(input.projectRef), recoveryRef=nonEmptyString(input.recoveryRef,"recoveryRef",256), actorRef=nonEmptyString(input.actorRef,"actorRef",256), expectedRevision=safeInteger(input.expectedRevision,"expectedRevision",1), state=nonEmptyString(input.state,"state",32), timestamp=safeInteger(input.updatedAt,"updatedAt");
    if(!ROOT_RECOVERY_STATES.has(state) || state==="prepared" || state==="reserved") throw new TypeError("root recovery transition state is unsupported");
    return this.#transaction(()=>{ const row=this.database.prepare("SELECT * FROM project_collaboration_root_recoveries WHERE project_ref=? AND recovery_ref=?").get(projectRef,recoveryRef); if(row===undefined) throw storeError("root recovery does not exist","PROJECT_COLLABORATION_NOT_FOUND"); if((row.initiator_actor_ref ?? row.requester_actor_ref)!==actorRef) throw storeError("only the authorized recovery initiator may advance recovery","PROJECT_ROOT_RECOVERY_FORBIDDEN"); if(row.revision!==expectedRevision) throw storeError("root recovery revision changed","PROJECT_ROOT_RECOVERY_CONFLICT",{currentRevision:row.revision}); const allowed={reserved:new Set(["activated","failed","outcome_unknown","cancelled"]),activated:new Set(["ready","failed","outcome_unknown","cancelled"]),outcome_unknown:new Set(["ready","failed","cancelled"]),failed:new Set(["activated"])}[row.state] ?? new Set(); if(!allowed.has(state)) throw storeError("invalid root recovery transition","PROJECT_ROOT_RECOVERY_CONFLICT"); this.database.prepare("UPDATE project_collaboration_root_recoveries SET state=?,revision=revision+1,updated_at=? WHERE project_ref=? AND recovery_ref=?").run(state,timestamp,projectRef,recoveryRef); this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp,projectRef); const projectRevision=this.#nextProjectRevision(projectRef); this.#insertCollaborationHistory({projectRef,projectRevision,kind:`root-recovery.${state}`,actorRef,subjectRef:recoveryRef,summary:`root recovery ${state}`,createdAt:timestamp}); return {projectRevision,recovery:this.getRootRecovery({projectRef,recoveryRef})}; });
  }

  getRootRecovery({projectRef:inputProjectRef,recoveryRef:inputRecoveryRef}={}) { this.#requireReady(); const projectRef=normalizeProjectRef(inputProjectRef),recoveryRef=nonEmptyString(inputRecoveryRef,"recoveryRef",256),row=this.database.prepare("SELECT * FROM project_collaboration_root_recoveries WHERE project_ref=? AND recovery_ref=?").get(projectRef,recoveryRef); return row===undefined?undefined:this.#decodeRootRecovery(projectRef,row); }

  createCollaborationBoard({ projectRef: inputProjectRef, coordinatorActorRef: inputCoordinator, title: inputTitle, createdAt } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const coordinatorActorRef = nonEmptyString(inputCoordinator, "coordinatorActorRef", 256);
    const title = nonEmptyString(inputTitle, "title", 500);
    const timestamp = safeInteger(createdAt, "createdAt");
    this.#transaction(() => {
      this.#ensureProject(projectRef);
      const existing = this.database.prepare("SELECT * FROM project_collaboration_boards WHERE project_ref = ?").get(projectRef);
      if (existing !== undefined) {
        const existingTitle = this.cipher.open(projectRef, collaborationField("board", projectRef, "title"), existing.title_cipher);
        if (existing.coordinator_actor_ref !== coordinatorActorRef || existingTitle !== title) throw storeError("project collaboration board creation identity was reused with different input", "PROJECT_COLLABORATION_CONFLICT");
        return undefined;
      }
      this.database.prepare(`INSERT INTO project_collaboration_boards(project_ref, revision, status, coordinator_actor_ref, title_cipher, created_at, updated_at)
        VALUES (?, 1, 'active', ?, ?, ?, ?)`).run(projectRef, coordinatorActorRef, this.cipher.seal(projectRef, collaborationField("board", projectRef, "title"), title), timestamp, timestamp);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "board.created", actorRef: coordinatorActorRef, subjectRef: projectRef, summary: "project collaboration board created", createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  upsertCollaborationSeat(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const changedByActorRef = nonEmptyString(input.changedByActorRef, "changedByActorRef", 256);
    const expectedRevision = safeInteger(input.expectedRevision ?? 0, "expectedRevision");
    const kind = nonEmptyString(input.kind ?? "root", "kind", 32);
    if (!new Set(["root", "member"]).has(kind)) throw new TypeError("seat kind must be root or member");
    const state = nonEmptyString(input.state ?? "active", "state", 32);
    if (!new Set(["active", "paused", "retired"]).has(state)) throw new TypeError("seat state is unsupported");
    const parentActorRef = optionalString(input.parentActorRef, "parentActorRef", 256);
    if (kind === "member" && parentActorRef === undefined) throw new TypeError("member seat requires parentActorRef");
    if (kind === "root" && parentActorRef !== undefined) throw new TypeError("root seat cannot have parentActorRef");
    const duty = nonEmptyString(input.duty, "duty", 500);
    const resourceScope = normalizeJson(input.resourceScope ?? [], "resourceScope");
    if (!Array.isArray(resourceScope) || resourceScope.length > 64) throw new TypeError("resourceScope must be an array of at most 64 project-relative paths");
    const normalizedScope = resourceScope.map((value, index) => normalizeProjectRelativePath(value, `resourceScope[${index}]`));
    const phase = nonEmptyString(input.phase ?? "planning", "phase", 128);
    const nextStep = nonEmptyString(input.nextStep ?? "Await assignment", "nextStep", 2_000);
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    this.#transaction(() => {
      const board = this.database.prepare("SELECT * FROM project_collaboration_boards WHERE project_ref = ?").get(projectRef);
      if (board === undefined) throw storeError("project collaboration board does not exist", "PROJECT_COLLABORATION_NOT_FOUND");
      const current = this.database.prepare("SELECT * FROM project_collaboration_seats WHERE project_ref = ? AND actor_ref = ?").get(projectRef, actorRef);
      const revision = current?.revision ?? 0;
      if (current !== undefined && expectedRevision === revision - 1) {
        const same = current.parent_actor_ref === (parentActorRef ?? null) && current.kind === kind && current.state === state
          && this.cipher.open(projectRef, collaborationField("seat", actorRef, "duty"), current.duty_cipher) === duty
          && canonicalJson(this.cipher.open(projectRef, collaborationField("seat", actorRef, "resourceScope"), current.resource_scope_cipher)) === canonicalJson(normalizedScope)
          && this.cipher.open(projectRef, collaborationField("seat", actorRef, "phase"), current.phase_cipher) === phase
          && this.cipher.open(projectRef, collaborationField("seat", actorRef, "nextStep"), current.next_step_cipher) === nextStep;
        if (same) return undefined;
      }
      if (revision !== expectedRevision) throw storeError("collaboration seat compare-and-swap revision changed", "PROJECT_COLLABORATION_CONFLICT", { currentRevision: revision });
      const nextRevision = revision + 1;
      this.database.prepare(`INSERT INTO project_collaboration_seats(project_ref, actor_ref, parent_actor_ref, kind, state, revision, duty_cipher, resource_scope_cipher, phase_cipher, next_step_cipher, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(project_ref, actor_ref) DO UPDATE SET
        parent_actor_ref=excluded.parent_actor_ref, kind=excluded.kind, state=excluded.state, revision=excluded.revision,
        duty_cipher=excluded.duty_cipher, resource_scope_cipher=excluded.resource_scope_cipher,
        phase_cipher=excluded.phase_cipher, next_step_cipher=excluded.next_step_cipher, updated_at=excluded.updated_at`).run(
        projectRef, actorRef, parentActorRef ?? null, kind, state, nextRevision,
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "duty"), duty),
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "resourceScope"), normalizedScope),
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "phase"), phase),
        this.cipher.seal(projectRef, collaborationField("seat", actorRef, "nextStep"), nextStep),
        current?.created_at ?? timestamp, timestamp,
      );
      this.database.prepare("UPDATE project_collaboration_boards SET revision = revision + 1, updated_at = ? WHERE project_ref = ?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: current === undefined ? "seat.registered" : "seat.updated", actorRef: changedByActorRef, subjectRef: actorRef, summary: `${kind} seat ${state}`, createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  acquireCollaborationLock(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const resourceRef = normalizeProjectRelativePath(input.resourceRef, "resourceRef");
    const ownerActorRef = nonEmptyString(input.ownerActorRef, "ownerActorRef", 256);
    const taskRef = optionalString(input.taskRef, "taskRef", 256);
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    this.#transaction(() => {
      const conflict = this.database.prepare(`SELECT resource_ref FROM project_collaboration_locks
        WHERE project_ref=? AND state='active' AND owner_actor_ref<>?
          AND (resource_ref=? OR substr(resource_ref,1,length(?)+1)=?||'/' OR substr(?,1,length(resource_ref)+1)=resource_ref||'/')
        ORDER BY resource_ref ASC LIMIT 1`).get(projectRef, ownerActorRef, resourceRef, resourceRef, resourceRef, resourceRef);
      if (conflict !== undefined) throw storeError("project collaboration resource is already locked", "PROJECT_COLLABORATION_RESOURCE_CONFLICT", { resourceRef: conflict.resource_ref });
      const current = this.database.prepare("SELECT * FROM project_collaboration_locks WHERE project_ref = ? AND resource_ref = ?").get(projectRef, resourceRef);
      if (current?.state === "active" && current.owner_actor_ref === ownerActorRef && current.task_ref === (taskRef ?? null)) return undefined;
      const revision = (current?.revision ?? 0) + 1;
      this.database.prepare(`INSERT INTO project_collaboration_locks(project_ref, resource_ref, owner_actor_ref, task_ref, state, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(project_ref, resource_ref) DO UPDATE SET
        owner_actor_ref=excluded.owner_actor_ref, task_ref=excluded.task_ref, state='active', revision=excluded.revision, updated_at=excluded.updated_at`).run(projectRef, resourceRef, ownerActorRef, taskRef ?? null, revision, current?.created_at ?? timestamp, timestamp);
      this.database.prepare("UPDATE project_collaboration_boards SET revision = revision + 1, updated_at = ? WHERE project_ref = ?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "lock.acquired", actorRef: ownerActorRef, subjectRef: resourceRef, summary: "resource lock acquired", createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  releaseCollaborationLock(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const resourceRef = normalizeProjectRelativePath(input.resourceRef, "resourceRef");
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const force = input.force === true;
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    this.#transaction(() => {
      const current = this.database.prepare("SELECT * FROM project_collaboration_locks WHERE project_ref = ? AND resource_ref = ?").get(projectRef, resourceRef);
      if (current === undefined || current.state !== "active") throw storeError("project collaboration resource lock is not active", "PROJECT_COLLABORATION_NOT_FOUND");
      if (!force && current.owner_actor_ref !== actorRef) throw storeError("only the lock owner may release this resource", "PROJECT_COLLABORATION_FORBIDDEN");
      this.database.prepare("UPDATE project_collaboration_locks SET state='released', revision=revision+1, updated_at=? WHERE project_ref=? AND resource_ref=?").run(timestamp, projectRef, resourceRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision = revision + 1, updated_at = ? WHERE project_ref = ?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "lock.released", actorRef, subjectRef: resourceRef, summary: force ? "resource lock conflict resolved" : "resource lock released", createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  prepareCollaborationHandoff(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const handoffRef = nonEmptyString(input.handoffRef, "handoffRef", 256);
    const taskRef = nonEmptyString(input.taskRef, "taskRef", 256);
    const sourceActorRef = nonEmptyString(input.sourceActorRef, "sourceActorRef", 256);
    const targetActorRef = nonEmptyString(input.targetActorRef, "targetActorRef", 256);
    if (sourceActorRef === targetActorRef) throw new TypeError("handoff target must differ from source");
    const summary = nonEmptyString(input.summary, "summary", 2_000);
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    this.#transaction(() => {
      if (this.database.prepare("SELECT 1 FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, taskRef) === undefined) throw storeError("handoff task does not exist", "PROJECT_TASK_NOT_FOUND");
      const existing = this.database.prepare("SELECT * FROM project_collaboration_handoffs WHERE project_ref=? AND handoff_ref=?").get(projectRef, handoffRef);
      if (existing !== undefined) {
        const same = existing.task_ref === taskRef && existing.source_actor_ref === sourceActorRef && existing.target_actor_ref === targetActorRef
          && existing.state === "prepared" && this.cipher.open(projectRef, collaborationField("handoff", handoffRef, "summary"), existing.summary_cipher) === summary;
        if (same) return undefined;
        throw storeError("handoff identity was reused with different input or state", "PROJECT_COLLABORATION_CONFLICT");
      }
      this.database.prepare(`INSERT INTO project_collaboration_handoffs(project_ref, handoff_ref, task_ref, source_actor_ref, target_actor_ref, state, revision, summary_cipher, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'prepared', 1, ?, ?, ?)`).run(projectRef, handoffRef, taskRef, sourceActorRef, targetActorRef, this.cipher.seal(projectRef, collaborationField("handoff", handoffRef, "summary"), summary), timestamp, timestamp);
      this.database.prepare("UPDATE project_collaboration_boards SET revision = revision + 1, updated_at = ? WHERE project_ref = ?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "handoff.prepared", actorRef: sourceActorRef, subjectRef: handoffRef, summary, createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  commitCollaborationHandoff(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const handoffRef = nonEmptyString(input.handoffRef, "handoffRef", 256);
    const targetActorRef = nonEmptyString(input.targetActorRef, "targetActorRef", 256);
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    this.#transaction(() => {
      const current = this.database.prepare("SELECT * FROM project_collaboration_handoffs WHERE project_ref=? AND handoff_ref=?").get(projectRef, handoffRef);
      if (current?.state === "committed" && current.target_actor_ref === targetActorRef) return undefined;
      if (current === undefined || current.state !== "prepared") throw storeError("handoff is not prepared", "PROJECT_COLLABORATION_CONFLICT");
      if (current.target_actor_ref !== targetActorRef) throw storeError("only the prepared target may commit a handoff", "PROJECT_COLLABORATION_FORBIDDEN");
      this.database.prepare("UPDATE project_collaboration_handoffs SET state='committed', revision=revision+1, updated_at=? WHERE project_ref=? AND handoff_ref=?").run(timestamp, projectRef, handoffRef);
      this.database.prepare("UPDATE project_tasks SET assignee_actor_ref=?, revision=revision+1, updated_at=? WHERE project_ref=? AND task_ref=?").run(targetActorRef, timestamp, projectRef, current.task_ref);
      this.database.prepare("UPDATE project_collaboration_boards SET revision = revision + 1, updated_at = ? WHERE project_ref = ?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "handoff.committed", actorRef: targetActorRef, subjectRef: handoffRef, summary: "task responsibility accepted", createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  addCollaborationEvidence(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const evidenceRef = nonEmptyString(input.evidenceRef, "evidenceRef", 256);
    const taskRef = nonEmptyString(input.taskRef, "taskRef", 256);
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const path = normalizeProjectRelativePath(input.path, "path");
    const digest = nonEmptyString(input.digest, "digest", 80);
    if (!SHA256_DIGEST.test(digest)) throw new TypeError("evidence digest must be sha256");
    const summary = nonEmptyString(input.summary, "summary", 2_000);
    const timestamp = safeInteger(input.createdAt, "createdAt");
    this.#transaction(() => {
      if (this.database.prepare("SELECT 1 FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, taskRef) === undefined) throw storeError("evidence task does not exist", "PROJECT_TASK_NOT_FOUND");
      const existing = this.database.prepare("SELECT * FROM project_collaboration_evidence WHERE project_ref=? AND evidence_ref=?").get(projectRef, evidenceRef);
      if (existing !== undefined) {
        const same = existing.task_ref === taskRef && existing.actor_ref === actorRef && existing.digest === digest
          && this.cipher.open(projectRef, collaborationField("evidence", evidenceRef, "path"), existing.path_cipher) === path
          && this.cipher.open(projectRef, collaborationField("evidence", evidenceRef, "summary"), existing.summary_cipher) === summary;
        if (same) return undefined;
        throw storeError("evidence identity was reused with different input", "PROJECT_COLLABORATION_CONFLICT");
      }
      this.database.prepare(`INSERT INTO project_collaboration_evidence(project_ref, evidence_ref, task_ref, actor_ref, path_cipher, digest, summary_cipher, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(projectRef, evidenceRef, taskRef, actorRef, this.cipher.seal(projectRef, collaborationField("evidence", evidenceRef, "path"), path), digest, this.cipher.seal(projectRef, collaborationField("evidence", evidenceRef, "summary"), summary), timestamp);
      this.database.prepare("UPDATE project_collaboration_boards SET revision = revision + 1, updated_at = ? WHERE project_ref = ?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "evidence.added", actorRef, subjectRef: evidenceRef, summary, createdAt: timestamp });
      return undefined;
    });
    return this.readCollaborationSnapshot({ projectRef });
  }

  createCollaborationRequest(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const requestRef = nonEmptyString(input.requestRef, "requestRef", 256);
    const requestId = nonEmptyString(input.requestId, "requestId", 256);
    const kind = nonEmptyString(input.kind, "kind", 64);
    if (!COLLABORATION_REQUEST_KINDS.has(kind)) throw new TypeError("unsupported collaboration request kind");
    const taskRef = nonEmptyString(input.taskRef, "taskRef", 256);
    const dependencyTaskRef = optionalString(input.dependencyTaskRef, "dependencyTaskRef", 256);
    const requesterActorRef = nonEmptyString(input.requesterActorRef, "requesterActorRef", 256);
    const reason = boundedUtf8String(input.reason, "reason");
    const respondByAt = safeInteger(input.respondByAt, "respondByAt");
    const timestamp = safeInteger(input.createdAt, "createdAt");
    let duplicate = false, storedRequestRef = requestRef;
    this.#transaction(() => {
      if (this.database.prepare("SELECT 1 FROM project_collaboration_boards WHERE project_ref=?").get(projectRef) === undefined) throw storeError("collaboration board does not exist", "PROJECT_COLLABORATION_NOT_FOUND");
      const task = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, taskRef);
      if (task === undefined) throw storeError("requester task does not exist", "PROJECT_TASK_NOT_FOUND");
      if (task.owner_actor_ref !== requesterActorRef && task.assignee_actor_ref !== requesterActorRef) throw storeError("only the owner or assignee may request help for its task", "PROJECT_COLLABORATION_FORBIDDEN");
      const blockers = this.getBlockingTaskRefs({ projectRef, taskRef });
      if (task.status !== "blocked" && blockers.length === 0) throw storeError("collaboration requests require a blocked task", "PROJECT_TASK_DEPENDENCY_BLOCKED");
      let targetTask = task;
      if (dependencyTaskRef !== undefined) {
        if (!blockers.includes(dependencyTaskRef)) throw storeError("dependency is not an unresolved blocker", "PROJECT_TASK_DEPENDENCY_BLOCKED");
        targetTask = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, dependencyTaskRef);
      }
      const targetActorRef = targetTask.assignee_actor_ref ?? targetTask.owner_actor_ref;
      if (targetActorRef === requesterActorRef) throw storeError("request target must be another persisted task owner", "PROJECT_COLLABORATION_FORBIDDEN");
      const identityDigest = commandDigest({ operation: "collaboration-request-identity", projectRef, kind, taskRef, dependencyTaskRef, requesterActorRef, targetActorRef });
      const requestDigest = commandDigest({ operation: "collaboration-request", identityDigest, reason, respondByAt });
      const byId = this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_id=?").get(projectRef, requestId);
      const equivalent = this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND identity_digest=? AND state IN ('open','accepted')").get(projectRef, identityDigest);
      const replay = byId ?? equivalent;
      if (replay !== undefined) {
        if (replay.request_digest !== requestDigest) throw storeError("collaboration request replay drifted or target ownership changed", "PROJECT_TASK_IDEMPOTENCY_CONFLICT");
        duplicate = true; storedRequestRef = replay.request_ref; return;
      }
      if (respondByAt <= timestamp) throw new TypeError("respondByAt must be later than createdAt");
      if (this.database.prepare("SELECT 1 FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef, requestRef) !== undefined) throw storeError("collaboration request reference already exists", "PROJECT_COLLABORATION_CONFLICT");
      this.database.prepare(`INSERT INTO project_collaboration_requests(project_ref,request_ref,request_id,identity_digest,request_digest,kind,task_ref,dependency_task_ref,requester_actor_ref,target_actor_ref,state,revision,respond_by_at,reason_cipher,resolution_cipher,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,'open',1,?,?,NULL,?,?)`).run(projectRef, requestRef, requestId, identityDigest, requestDigest, kind, taskRef, dependencyTaskRef ?? null, requesterActorRef, targetActorRef, respondByAt, this.cipher.seal(projectRef, collaborationField("request", requestRef, "reason"), reason), timestamp, timestamp);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "request.opened", actorRef: requesterActorRef, subjectRef: requestRef, summary: "collaboration requested", createdAt: timestamp });
    });
    return { duplicate, projectRevision: this.getProjectRevision(projectRef), request: this.getCollaborationRequest({ projectRef, requestRef: storedRequestRef }) };
  }

  respondCollaborationRequest(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const requestRef = nonEmptyString(input.requestRef, "requestRef", 256);
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const expectedRevision = safeInteger(input.expectedRevision, "expectedRevision", 1);
    const action = nonEmptyString(input.action, "action", 32);
    if (!COLLABORATION_REQUEST_ACTIONS.has(action)) throw new TypeError("unsupported collaboration request response");
    const resolution = boundedUtf8String(input.resolution, "resolution");
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    this.#transaction(() => {
      const row = this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef, requestRef);
      if (row === undefined) throw storeError("collaboration request does not exist", "PROJECT_COLLABORATION_NOT_FOUND");
      if (row.target_actor_ref !== actorRef) throw storeError("only the derived target may respond", "PROJECT_COLLABORATION_FORBIDDEN");
      if (row.state !== "open" || row.revision !== expectedRevision) throw storeError("collaboration request revision changed", "PROJECT_COLLABORATION_CONFLICT", { currentRevision: row.revision });
      const targetTaskRef = row.dependency_task_ref ?? row.task_ref;
      const targetTask = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, targetTaskRef);
      if (targetTask === undefined || (targetTask.assignee_actor_ref ?? targetTask.owner_actor_ref) !== row.target_actor_ref) throw storeError("collaboration request target ownership changed", "PROJECT_COLLABORATION_CONFLICT");
      const previousOwnerActorRef = targetTask.owner_actor_ref, previousAssigneeActorRef = targetTask.assignee_actor_ref;
      let state = action === "reject" ? "rejected" : "accepted";
      if (action === "accept" && row.kind === "dependency_unblock" && targetTask.status === "done") state = "resolved";
      if (action === "release" || (action === "accept" && ["release", "takeover"].includes(row.kind))) {
        this.database.prepare("UPDATE project_collaboration_locks SET owner_actor_ref=?,revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=? AND owner_actor_ref IN (?,?) AND state='active'").run(row.requester_actor_ref, timestamp, projectRef, targetTaskRef, previousOwnerActorRef, previousAssigneeActorRef);
        this.database.prepare("UPDATE project_tasks SET owner_actor_ref=?,assignee_actor_ref=?,revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=?").run(row.requester_actor_ref, row.requester_actor_ref, timestamp, projectRef, targetTaskRef);
        state = "resolved";
      } else if (action === "accept" && row.kind === "handoff") {
        this.database.prepare(`INSERT INTO project_collaboration_handoffs(project_ref,handoff_ref,task_ref,source_actor_ref,target_actor_ref,state,revision,summary_cipher,created_at,updated_at)
          VALUES(?,?,?,?,?,'prepared',1,?,?,?)`).run(projectRef, requestRef, targetTaskRef, row.target_actor_ref, row.requester_actor_ref, this.cipher.seal(projectRef, collaborationField("handoff", requestRef, "summary"), resolution), timestamp, timestamp);
      }
      this.database.prepare("UPDATE project_collaboration_requests SET state=?,revision=revision+1,resolution_cipher=?,updated_at=? WHERE project_ref=? AND request_ref=?").run(state, this.cipher.seal(projectRef, collaborationField("request", requestRef, "resolution"), resolution), timestamp, projectRef, requestRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: `request.${state}`, actorRef, subjectRef: requestRef, summary: resolution, createdAt: timestamp });
    });
    return { projectRevision: this.getProjectRevision(projectRef), request: this.getCollaborationRequest({ projectRef, requestRef }) };
  }

  cancelCollaborationRequest(input = {}) { return this.#closeCollaborationRequest(input, "cancelled"); }

  escalateCollaborationRequest(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef), requestRef = nonEmptyString(input.requestRef, "requestRef", 256), coordinatorActorRef = nonEmptyString(input.coordinatorActorRef, "coordinatorActorRef", 256);
    const expectedRevision = safeInteger(input.expectedRevision, "expectedRevision", 1), timestamp = safeInteger(input.updatedAt, "updatedAt");
    const resolution = boundedUtf8String(input.resolution, "resolution"), authorizedEarly = input.authorizedEarly === true;
    this.#transaction(() => {
      const board = this.database.prepare("SELECT * FROM project_collaboration_boards WHERE project_ref=?").get(projectRef);
      if (board?.coordinator_actor_ref !== coordinatorActorRef) throw storeError("only project coordinator may resolve", "PROJECT_COLLABORATION_FORBIDDEN");
      const row = this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef, requestRef);
      if (row === undefined) throw storeError("collaboration request does not exist", "PROJECT_COLLABORATION_NOT_FOUND");
      const resolvableState = row.state === "open" || (row.state === "accepted" && row.kind === "dependency_unblock");
      if (!resolvableState || row.revision !== expectedRevision) throw storeError("collaboration request revision changed", "PROJECT_COLLABORATION_CONFLICT", { currentRevision: row.revision });
      if (!authorizedEarly && timestamp < row.respond_by_at) throw storeError("request deadline has not elapsed", "PROJECT_COLLABORATION_DEADLINE_PENDING", { respondByAt: row.respond_by_at });
      const targetTaskRef = row.dependency_task_ref ?? row.task_ref;
      const targetTask = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, targetTaskRef);
      if (targetTask === undefined || (targetTask.assignee_actor_ref ?? targetTask.owner_actor_ref) !== row.target_actor_ref) throw storeError("collaboration request target ownership changed", "PROJECT_COLLABORATION_CONFLICT");
      const alreadyUnblocked = row.kind === "dependency_unblock" && targetTask.status === "done";
      if (!alreadyUnblocked) {
        const previousOwnerActorRef = targetTask.owner_actor_ref, previousAssigneeActorRef = targetTask.assignee_actor_ref;
        this.database.prepare("UPDATE project_collaboration_locks SET owner_actor_ref=?,revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=? AND owner_actor_ref IN (?,?) AND state='active'").run(row.requester_actor_ref, timestamp, projectRef, targetTaskRef, previousOwnerActorRef, previousAssigneeActorRef);
        this.database.prepare("UPDATE project_tasks SET owner_actor_ref=?,assignee_actor_ref=?,revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=?").run(row.requester_actor_ref, row.requester_actor_ref, timestamp, projectRef, targetTaskRef);
      }
      const nextState = alreadyUnblocked ? "resolved" : "escalated";
      this.database.prepare("UPDATE project_collaboration_requests SET state=?,revision=revision+1,resolution_cipher=?,updated_at=? WHERE project_ref=? AND request_ref=?").run(nextState, this.cipher.seal(projectRef, collaborationField("request", requestRef, "resolution"), resolution), timestamp, projectRef, requestRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp, projectRef);
      const projectRevision = this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({ projectRef, projectRevision, kind: `request.${nextState}`, actorRef: coordinatorActorRef, subjectRef: requestRef, summary: resolution, createdAt: timestamp });
    });
    return { projectRevision: this.getProjectRevision(projectRef), request: this.getCollaborationRequest({ projectRef, requestRef }) };
  }

  getCollaborationRequest({ projectRef: inputProjectRef, requestRef: inputRequestRef } = {}) {
    this.#requireReady(); const projectRef = normalizeProjectRef(inputProjectRef), requestRef = nonEmptyString(inputRequestRef, "requestRef", 256);
    const row = this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef, requestRef);
    return row === undefined ? undefined : this.#decodeCollaborationRequest(projectRef, row);
  }

  readCollaborationRequestWindow({ projectRef: inputProjectRef, limit=100, afterUpdatedAt, afterRequestRef } = {}) {
    this.#requireReady(); const projectRef = normalizeProjectRef(inputProjectRef), boundedLimit = safeInteger(limit, "limit", 1, MAX_COLLABORATION_REQUESTS_PER_QUERY);
    const boundary = afterUpdatedAt !== undefined || afterRequestRef !== undefined;
    if (boundary && (afterUpdatedAt === undefined || afterRequestRef === undefined)) throw new TypeError("afterUpdatedAt and afterRequestRef must be provided together");
    return this.#readTransaction(() => {
      const projectRevision = this.#assertProjectRevision(projectRef, { allowMissing:true });
      const totalRequests = Number(this.database.prepare("SELECT COUNT(*) AS total FROM project_collaboration_requests WHERE project_ref=?").get(projectRef).total);
      const totals = { total: totalRequests, open:0, accepted:0, rejected:0, cancelled:0, escalated:0, resolved:0 };
      for (const row of this.database.prepare("SELECT state,COUNT(*) AS total FROM project_collaboration_requests WHERE project_ref=? GROUP BY state").all(projectRef)) if (Object.hasOwn(totals,row.state)) totals[row.state]=Number(row.total);
      const rows = boundary ? this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND (updated_at < ? OR (updated_at=? AND request_ref>?)) ORDER BY updated_at DESC,request_ref ASC LIMIT ?").all(projectRef, safeInteger(afterUpdatedAt,"afterUpdatedAt"), afterUpdatedAt, nonEmptyString(afterRequestRef,"afterRequestRef",256), boundedLimit+1) : this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? ORDER BY updated_at DESC,request_ref ASC LIMIT ?").all(projectRef,boundedLimit+1);
      const selected=rows.slice(0,boundedLimit), last=selected.at(-1), ending=this.#assertProjectRevision(projectRef,{allowMissing:true});
      if (ending!==projectRevision) throw storeError("collaboration request snapshot revision changed", "PROJECT_TASK_SNAPSHOT_INCONSISTENT");
      return { projectRevision,totalRequests,totals,requests:selected.map(row=>this.#decodeCollaborationRequest(projectRef,row)),hasMore:rows.length>boundedLimit,nextBoundary:rows.length>boundedLimit&&last?{updatedAt:last.updated_at,requestRef:last.request_ref}:null };
    });
  }

  hasCollaborationBoard(inputProjectRef) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    return this.database.prepare("SELECT 1 FROM project_collaboration_boards WHERE project_ref=?").get(projectRef) !== undefined;
  }

  readCollaborationSectionWindow({ projectRef: inputProjectRef, section: inputSection, limit = 100, boundary, expectedProjectRevision } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const section = nonEmptyString(inputSection, "section", 32);
    if (!COLLABORATION_SECTION_NAMES.has(section)) throw new TypeError("section is not a collaboration section");
    const boundedLimit = safeInteger(limit, "limit", 1, 500);
    if (boundary !== undefined && !isRecord(boundary)) throw new TypeError("boundary must be an object");
    return this.#readTransaction(() => {
      const projectRevision = this.#assertProjectRevision(projectRef, { allowMissing: true });
      if (expectedProjectRevision !== undefined && safeInteger(expectedProjectRevision, "expectedProjectRevision") !== projectRevision) {
        throw storeError("collaboration window revision changed", "PROJECT_TASK_SNAPSHOT_INCONSISTENT", { currentRevision: projectRevision });
      }
      const board = this.database.prepare("SELECT revision,status,coordinator_actor_ref,updated_at FROM project_collaboration_boards WHERE project_ref=?").get(projectRef);
      if (board === undefined) return { available: false, projectRevision, boardRevision: 0, status: "inactive", total: 0, items: [], itemBoundaries: [], hasMore: false, nextBoundary: null };
      const definitions = {
        seats: { table: "project_collaboration_seats", time: "updated_at", ref: "actor_ref" },
        locks: { table: "project_collaboration_locks", ref: "resource_ref", ascending: true },
        handoffs: { table: "project_collaboration_handoffs", time: "updated_at", ref: "handoff_ref" },
        recoveries: { table: "project_collaboration_root_recoveries", time: "updated_at", ref: "recovery_ref" },
        evidence: { table: "project_collaboration_evidence", time: "created_at", ref: "evidence_ref" },
        requests: { table: "project_collaboration_requests", time: "updated_at", ref: "request_ref" },
      };
      let rows;
      let taskGroupTotals;
      if (section === "history") {
        const before = boundary === undefined ? Number.MAX_SAFE_INTEGER : safeInteger(boundary.revision, "boundary.revision", 1);
        rows = this.database.prepare("SELECT * FROM project_collaboration_history WHERE project_ref=? AND collaboration_revision<? ORDER BY collaboration_revision DESC LIMIT ?").all(projectRef, before, boundedLimit + 1);
      } else if (section === "tasks") {
        taskGroupTotals = { in_progress: 0, in_review: 0, blocked: 0, pending: 0, completed: 0, canceled: 0 };
        for (const row of this.database.prepare(`SELECT ${TASK_STATUS_GROUP_SQL} AS status_group,COUNT(*) AS total FROM project_tasks WHERE project_ref=? GROUP BY status_group`).all(projectRef)) taskGroupTotals[row.status_group] = Number(row.total);
        const selectSql = `SELECT *,${TASK_STATUS_RANK_SQL} AS sort_rank,COALESCE(priority,-1) AS sort_priority,${TASK_STATUS_GROUP_SQL} AS status_group FROM project_tasks`;
        const orderSql = "ORDER BY sort_rank ASC,sort_priority DESC,updated_at DESC,created_at DESC,task_ref ASC LIMIT ?";
        if (boundary === undefined) rows = this.database.prepare(`${selectSql} WHERE project_ref=? ${orderSql}`).all(projectRef, boundedLimit + 1);
        else {
          const rank = safeInteger(boundary.rank, "boundary.rank", 0, 5), priority = boundary.priority;
          if (!Number.isSafeInteger(priority) || priority < -1 || priority > 1_000_000) throw new TypeError("boundary.priority must be a safe integer from -1 through 1000000");
          const updatedAt = safeInteger(boundary.updatedAt, "boundary.updatedAt"), createdAt = safeInteger(boundary.createdAt, "boundary.createdAt"), taskRef = nonEmptyString(boundary.taskRef, "boundary.taskRef", 256);
          rows = this.database.prepare(`${selectSql} WHERE project_ref=? AND (${TASK_STATUS_RANK_SQL}>? OR (${TASK_STATUS_RANK_SQL}=? AND (COALESCE(priority,-1)<? OR (COALESCE(priority,-1)=? AND (updated_at<? OR (updated_at=? AND (created_at<? OR (created_at=? AND task_ref>?)))))))) ${orderSql}`).all(projectRef, rank, rank, priority, priority, updatedAt, updatedAt, createdAt, createdAt, taskRef, boundedLimit + 1);
        }
      } else {
        const definition = definitions[section];
        if (definition.ascending) {
          const afterRef = boundary === undefined ? "" : nonEmptyString(boundary.ref, "boundary.ref", 2_048);
          rows = this.database.prepare(`SELECT * FROM ${definition.table} WHERE project_ref=? AND ${definition.ref}>? ORDER BY ${definition.ref} ASC LIMIT ?`).all(projectRef, afterRef, boundedLimit + 1);
        } else if (boundary === undefined) rows = this.database.prepare(`SELECT * FROM ${definition.table} WHERE project_ref=? ORDER BY ${definition.time} DESC,${definition.ref} ASC LIMIT ?`).all(projectRef, boundedLimit + 1);
        else {
          const time = safeInteger(boundary.time, "boundary.time"), ref = nonEmptyString(boundary.ref, "boundary.ref", 256);
          rows = this.database.prepare(`SELECT * FROM ${definition.table} WHERE project_ref=? AND (${definition.time}<? OR (${definition.time}=? AND ${definition.ref}>?)) ORDER BY ${definition.time} DESC,${definition.ref} ASC LIMIT ?`).all(projectRef, time, time, ref, boundedLimit + 1);
        }
      }
      const totalTable = section === "tasks" ? "project_tasks" : section === "history" ? "project_collaboration_history" : definitions[section].table;
      const total = Number(this.database.prepare(`SELECT COUNT(*) AS total FROM ${totalTable} WHERE project_ref=?`).get(projectRef).total);
      const selected = rows.slice(0, boundedLimit), last = selected.at(-1), hasMore = rows.length > boundedLimit;
      const decode = {
        seats: (row) => ({ actorRef: row.actor_ref, ...(row.parent_actor_ref === null ? {} : { parentActorRef: row.parent_actor_ref }), kind: row.kind, state: row.state, revision: row.revision, duty: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "duty"), row.duty_cipher), resourceScope: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "resourceScope"), row.resource_scope_cipher), phase: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "phase"), row.phase_cipher), nextStep: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "nextStep"), row.next_step_cipher), createdAt: row.created_at, updatedAt: row.updated_at }),
        tasks: (row) => this.#decodeTaskRow(projectRef, row),
        locks: (row) => ({ resourceRef: row.resource_ref, ownerActorRef: row.owner_actor_ref, ...(row.task_ref === null ? {} : { taskRef: row.task_ref }), state: row.state, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at }),
        handoffs: (row) => ({ handoffRef: row.handoff_ref, taskRef: row.task_ref, sourceActorRef: row.source_actor_ref, targetActorRef: row.target_actor_ref, state: row.state, revision: row.revision, summary: this.cipher.open(projectRef, collaborationField("handoff", row.handoff_ref, "summary"), row.summary_cipher), createdAt: row.created_at, updatedAt: row.updated_at }),
        recoveries: (row) => this.#decodeRootRecovery(projectRef, row),
        evidence: (row) => ({ evidenceRef: row.evidence_ref, taskRef: row.task_ref, actorRef: row.actor_ref, path: this.cipher.open(projectRef, collaborationField("evidence", row.evidence_ref, "path"), row.path_cipher), digest: row.digest, summary: this.cipher.open(projectRef, collaborationField("evidence", row.evidence_ref, "summary"), row.summary_cipher), createdAt: row.created_at }),
        history: (row) => ({ revision: row.collaboration_revision, kind: row.kind, actorRef: row.actor_ref, subjectRef: row.subject_ref, summary: this.cipher.open(projectRef, collaborationField("history", String(row.collaboration_revision), "summary"), row.summary_cipher), createdAt: row.created_at }),
        requests: (row) => this.#decodeCollaborationRequest(projectRef, row),
      }[section];
      const boundaryForRow = (row) => {
        if (section === "history") return { revision: row.collaboration_revision };
        if (section === "tasks") return { rank: row.sort_rank, priority: row.sort_priority, updatedAt: row.updated_at, createdAt: row.created_at, taskRef: row.task_ref };
        if (definitions[section].ascending) return { ref: row[definitions[section].ref] };
        return { time: row[definitions[section].time], ref: row[definitions[section].ref] };
      };
      const itemBoundaries = selected.map(boundaryForRow);
      const nextBoundary = hasMore && last !== undefined ? boundaryForRow(last) : null;
      const endingRevision = this.#assertProjectRevision(projectRef, { allowMissing: true });
      if (endingRevision !== projectRevision) throw storeError("collaboration window revision changed during read", "PROJECT_TASK_SNAPSHOT_INCONSISTENT", { currentRevision: endingRevision });
      return { available: true, projectRevision, boardRevision: board.revision, status: board.status, coordinatorActorRef: board.coordinator_actor_ref, updatedAt: board.updated_at, total, ...(taskGroupTotals === undefined ? {} : { taskGroupTotals }), items: selected.map(decode), itemBoundaries, hasMore, nextBoundary };
    });
  }

  readCollaborationSnapshot({ projectRef: inputProjectRef, historyLimit = 100, beforeRevision } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const limit = safeInteger(historyLimit, "historyLimit", 1, MAX_COLLABORATION_HISTORY_PER_QUERY);
    return this.#readTransaction(() => this.#readCollaborationSnapshot(projectRef, { historyLimit: limit, beforeRevision }));
  }

  listComments({ projectRef: inputProjectRef, taskRef: inputTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const taskRef = nonEmptyString(inputTaskRef, "taskRef", 256);
    return this.database.prepare("SELECT * FROM project_task_comments WHERE project_ref = ? AND task_ref = ? ORDER BY created_at, comment_ref").all(projectRef, taskRef).map((row) => ({
      projectRef, taskRef, commentRef: row.comment_ref, kind: row.kind, authorActorRef: row.author_actor_ref,
      body: this.cipher.open(projectRef, recordField("comments", row.comment_ref, "body"), row.body_cipher),
      requirementsRevision: row.requirements_revision, createdAt: row.created_at,
    }));
  }

  listRelations({ projectRef: inputProjectRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    return this.database.prepare("SELECT * FROM project_task_relations WHERE project_ref = ? ORDER BY created_at, relation_ref").all(projectRef).map((row) => ({
      projectRef, relationRef: row.relation_ref, sourceTaskRef: row.source_task_ref, targetTaskRef: row.target_task_ref, type: row.type, createdByActorRef: row.created_by_actor_ref, createdAt: row.created_at,
    }));
  }

  getAttempt({ projectRef: inputProjectRef, attemptRef: inputAttemptRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const attemptRef = nonEmptyString(inputAttemptRef, "attemptRef", 256);
    const row = this.database.prepare("SELECT * FROM project_task_attempts WHERE project_ref = ? AND attempt_ref = ?").get(projectRef, attemptRef);
    return row === undefined ? undefined : { projectRef, attemptRef, taskRef: row.task_ref, executorActorRef: row.executor_actor_ref, acceptedRequirementsRevision: row.accepted_requirements_revision, state: row.state, invalidated: row.invalidated === 1, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  getReview({ projectRef: inputProjectRef, reviewRef: inputReviewRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const reviewRef = nonEmptyString(inputReviewRef, "reviewRef", 256);
    const row = this.database.prepare("SELECT * FROM project_task_reviews WHERE project_ref = ? AND review_ref = ?").get(projectRef, reviewRef);
    return row === undefined ? undefined : { projectRef, reviewRef, taskRef: row.task_ref, attemptRef: row.attempt_ref, reviewerActorRef: row.reviewer_actor_ref, verdict: row.verdict, requirementsRevision: row.requirements_revision, body: this.cipher.open(projectRef, recordField("reviews", reviewRef, "body"), row.body_cipher), superseded: row.superseded === 1, createdAt: row.created_at };
  }

  commandExists({ projectRef: inputProjectRef, commandId: inputCommandId, eventRef: inputEventRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const commandId = nonEmptyString(inputCommandId, "commandId", 256);
    const eventRef = nonEmptyString(inputEventRef, "eventRef", 256);
    return this.database.prepare("SELECT 1 FROM project_task_command_receipts WHERE project_ref = ? AND command_id = ? AND event_ref = ?").get(projectRef, commandId, eventRef) !== undefined;
  }

  getCommandReceipt({ projectRef: inputProjectRef, commandId: inputCommandId, eventRef: inputEventRef, requestDigest: inputRequestDigest } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const commandId = nonEmptyString(inputCommandId, "commandId", 256);
    const eventRef = optionalString(inputEventRef, "eventRef", 256);
    const requestDigest = inputRequestDigest === undefined ? undefined : normalizeRequestDigest(inputRequestDigest);
    const byCommand = this.database.prepare("SELECT * FROM project_task_command_receipts WHERE project_ref = ? AND command_id = ?").get(projectRef, commandId);
    const byEvent = eventRef === undefined ? undefined : this.database.prepare("SELECT * FROM project_task_command_receipts WHERE project_ref = ? AND event_ref = ?").get(projectRef, eventRef);
    if (byCommand === undefined) {
      const legacyCollision = this.database.prepare("SELECT 1 FROM project_task_events WHERE project_ref = ? AND (command_id = ? OR event_ref = ?)").get(projectRef, commandId, eventRef ?? "");
      if (byEvent !== undefined || legacyCollision !== undefined) throw storeError("commandId or eventRef was reused for a request without a durable receipt", "PROJECT_TASK_IDEMPOTENCY_CONFLICT");
      return undefined;
    }
    if (eventRef !== undefined && (byEvent === undefined || byEvent.command_id !== commandId || byCommand.event_ref !== eventRef)) throw storeError("commandId or eventRef was reused for a different request", "PROJECT_TASK_IDEMPOTENCY_CONFLICT");
    if (requestDigest !== undefined && byCommand.request_digest !== requestDigest) throw storeError("commandId or eventRef was reused for a different request", "PROJECT_TASK_IDEMPOTENCY_CONFLICT");
    return this.cipher.open(projectRef, receiptField(commandId), byCommand.receipt_cipher);
  }

  claimNextTask(input = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(input.projectRef);
    const requestId = nonEmptyString(input.requestId, "requestId", 256);
    const actorRef = nonEmptyString(input.actorRef, "actorRef", 256);
    const timestamp = safeInteger(input.updatedAt, "updatedAt");
    const requestDigest = commandDigest({ operation: "claim-next", projectRef, requestId, actorRef });
    return this.#transaction(() => {
      this.#assertProjectRevision(projectRef);
      const replay = this.database.prepare("SELECT * FROM project_task_claim_next_receipts WHERE project_ref=? AND request_id=?").get(projectRef, requestId);
      if (replay !== undefined) {
        if (replay.request_digest !== requestDigest || replay.actor_ref !== actorRef) throw storeError("claim_next request replay drifted", "PROJECT_TASK_IDEMPOTENCY_CONFLICT");
        return { ...this.cipher.open(projectRef, collaborationField("claim-next", requestId, "receipt"), replay.receipt_cipher), duplicate: true };
      }
      const active = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref=? AND assignee_actor_ref=? AND status='in_progress' ORDER BY updated_at ASC,task_ref ASC LIMIT 1").get(projectRef, actorRef);
      let result;
      if (active !== undefined) {
        result = { duplicate: false, projectRevision: this.#assertProjectRevision(projectRef), status: "temporarily_empty", task: this.#decodeTaskRow(projectRef, active), blockers: [active.task_ref] };
      } else {
        const firstCandidatePage = this.database.prepare(`SELECT task.* FROM project_tasks task
          WHERE task.project_ref=? AND task.status IN ('backlog','todo')
            AND (task.assignee_actor_ref IS NULL OR task.assignee_actor_ref=?)
            AND NOT EXISTS (SELECT 1 FROM project_task_relations relation JOIN project_tasks blocker
              ON blocker.project_ref=relation.project_ref AND blocker.task_ref=relation.source_task_ref
              WHERE relation.project_ref=task.project_ref AND relation.target_task_ref=task.task_ref AND relation.type='blocks' AND blocker.status<>'done')
          ORDER BY task.updated_at ASC,task.task_ref ASC LIMIT ?`);
        const nextCandidatePage = this.database.prepare(`SELECT task.* FROM project_tasks task
          WHERE task.project_ref=? AND task.status IN ('backlog','todo')
            AND (task.assignee_actor_ref IS NULL OR task.assignee_actor_ref=?)
            AND (task.updated_at>? OR (task.updated_at=? AND task.task_ref>?))
            AND NOT EXISTS (SELECT 1 FROM project_task_relations relation JOIN project_tasks blocker
              ON blocker.project_ref=relation.project_ref AND blocker.task_ref=relation.source_task_ref
              WHERE relation.project_ref=task.project_ref AND relation.target_task_ref=task.task_ref AND relation.type='blocks' AND blocker.status<>'done')
          ORDER BY task.updated_at ASC,task.task_ref ASC LIMIT ?`);
        let candidate, boundary, candidatePage;
        const hierarchicalLockBlockers = new Set();
        do {
          candidatePage = boundary === undefined ? firstCandidatePage.all(projectRef, actorRef, CLAIM_NEXT_CANDIDATE_PAGE) : nextCandidatePage.all(projectRef, actorRef, boundary.updated_at, boundary.updated_at, boundary.task_ref, CLAIM_NEXT_CANDIDATE_PAGE);
          for (const row of candidatePage) {
            const decoded = this.#decodeTaskRow(projectRef, row);
            if (this.#findResourceConflict(projectRef, actorRef, row.task_ref, decoded.fileScope) !== undefined) {
              if (hierarchicalLockBlockers.size < CLAIM_NEXT_BLOCKER_LIMIT) hierarchicalLockBlockers.add(row.task_ref);
              continue;
            }
            candidate = row;
            break;
          }
          const last = candidatePage.at(-1);
          boundary = last === undefined ? boundary : { updated_at: last.updated_at, task_ref: last.task_ref };
        } while (candidate === undefined && candidatePage.length === CLAIM_NEXT_CANDIDATE_PAGE);
        if (candidate !== undefined) {
          const changed = this.database.prepare("UPDATE project_tasks SET assignee_actor_ref=?,status='in_progress',revision=revision+1,updated_at=? WHERE project_ref=? AND task_ref=? AND revision=? AND status IN ('backlog','todo') AND (assignee_actor_ref IS NULL OR assignee_actor_ref=?)").run(actorRef, timestamp, projectRef, candidate.task_ref, candidate.revision, actorRef);
          if (Number(changed.changes) !== 1) throw storeError("claim_next candidate changed", "PROJECT_TASK_CONFLICT");
          const projectRevision = this.#nextProjectRevision(projectRef);
          const eventRef = `event_claim_next_${createHash("sha256").update(requestId).digest("base64url")}`;
          const commandId = `command_claim_next_${createHash("sha256").update(requestId).digest("base64url")}`;
          this.#insertEvent({ projectRef, projectRevision, eventRef, commandId, digest: requestDigest, taskRef: candidate.task_ref, type: "task.claimed_next", actorRef, payloadCipher: this.cipher.seal(projectRef, eventField(eventRef), { source: "claim_next" }), createdAt: timestamp });
          if (this.database.prepare("SELECT 1 FROM project_collaboration_boards WHERE project_ref=?").get(projectRef) !== undefined) {
            this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp, projectRef);
            this.#insertCollaborationHistory({ projectRef, projectRevision, kind: "task.claimed_next", actorRef, subjectRef: candidate.task_ref, summary: "next eligible task claimed", createdAt: timestamp });
          }
          result = { duplicate: false, projectRevision, status: "claimed", task: this.#readTask(projectRef, candidate.task_ref), blockers: [] };
        } else {
          const remainingCount = Number(this.database.prepare("SELECT COUNT(*) AS total FROM project_tasks WHERE project_ref=? AND status NOT IN ('done','canceled')").get(projectRef).total);
          if (remainingCount === 0) result = { duplicate: false, projectRevision: this.#assertProjectRevision(projectRef), status: "all_terminal", blockers: [] };
          else {
            const blockers = this.database.prepare(`SELECT DISTINCT blocker.task_ref FROM project_task_relations relation JOIN project_tasks blocker
              ON blocker.project_ref=relation.project_ref AND blocker.task_ref=relation.source_task_ref JOIN project_tasks target
              ON target.project_ref=relation.project_ref AND target.task_ref=relation.target_task_ref
              WHERE relation.project_ref=? AND relation.type='blocks' AND blocker.status<>'done' AND target.status NOT IN ('done','canceled')
              ORDER BY blocker.task_ref LIMIT ?`).all(projectRef, CLAIM_NEXT_BLOCKER_LIMIT).map((row) => row.task_ref);
            const blockedTasks = this.database.prepare("SELECT task_ref FROM project_tasks WHERE project_ref=? AND status='blocked' ORDER BY updated_at ASC,task_ref ASC LIMIT ?").all(projectRef, CLAIM_NEXT_BLOCKER_LIMIT).map((row) => row.task_ref);
            const bounded = [...new Set([...blockers, ...blockedTasks, ...hierarchicalLockBlockers])].sort().slice(0, CLAIM_NEXT_BLOCKER_LIMIT);
            result = { duplicate: false, projectRevision: this.#assertProjectRevision(projectRef), status: bounded.length > 0 ? "blocked" : "temporarily_empty", blockers: bounded };
          }
        }
      }
      this.database.prepare("INSERT INTO project_task_claim_next_receipts(project_ref,request_id,request_digest,actor_ref,receipt_cipher,created_at) VALUES(?,?,?,?,?,?)").run(projectRef, requestId, requestDigest, actorRef, this.cipher.seal(projectRef, collaborationField("claim-next", requestId, "receipt"), result), timestamp);
      return result;
    });
  }

  getBlockingTaskRefs({ projectRef: inputProjectRef, taskRef: inputTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const taskRef = nonEmptyString(inputTaskRef, "taskRef", 256);
    return this.database.prepare(`SELECT relation.source_task_ref AS task_ref FROM project_task_relations relation
      JOIN project_tasks blocker ON blocker.project_ref = relation.project_ref AND blocker.task_ref = relation.source_task_ref
      WHERE relation.project_ref = ? AND relation.target_task_ref = ? AND relation.type = 'blocks' AND blocker.status <> 'done'
      ORDER BY relation.source_task_ref LIMIT 501`).all(projectRef, taskRef).map((row) => row.task_ref);
  }

  getTask({ projectRef: inputProjectRef, taskRef: inputTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const taskRef = nonEmptyString(inputTaskRef, "taskRef", 256);
    this.#assertProjectRevision(projectRef, { allowMissing: true });
    return this.#readTask(projectRef, taskRef);
  }

  readTaskWindow({ projectRef: inputProjectRef, limit = 100, afterStatusRank, afterPriority, afterUpdatedAt, afterCreatedAt, afterTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const boundedLimit = safeInteger(limit, "limit", 1, MAX_TASKS_PER_QUERY);
    const boundaryValues = [afterStatusRank, afterPriority, afterUpdatedAt, afterCreatedAt, afterTaskRef];
    const hasBoundary = boundaryValues.some((value) => value !== undefined);
    let boundaryRank, boundaryPriority, boundaryUpdatedAt, boundaryCreatedAt, boundaryTaskRef;
    if (hasBoundary) {
      if (boundaryValues.some((value) => value === undefined)) throw new TypeError("all task sort boundary fields must be provided together");
      boundaryRank = safeInteger(afterStatusRank, "afterStatusRank", 0, 5);
      if (!Number.isSafeInteger(afterPriority) || afterPriority < -1 || afterPriority > 1_000_000) throw new TypeError("afterPriority must be a safe integer from -1 through 1000000");
      boundaryPriority = afterPriority;
      boundaryUpdatedAt = safeInteger(afterUpdatedAt, "afterUpdatedAt");
      boundaryCreatedAt = safeInteger(afterCreatedAt, "afterCreatedAt");
      boundaryTaskRef = nonEmptyString(afterTaskRef, "afterTaskRef", 256);
    }
    return this.#readTransaction(() => {
      const projectRevision = this.#assertProjectRevision(projectRef, { allowMissing: true });
      const totalTasks = Number(this.database.prepare("SELECT COUNT(*) AS total FROM project_tasks WHERE project_ref = ?").get(projectRef).total);
      const groupTotals = { in_progress: 0, in_review: 0, blocked: 0, pending: 0, completed: 0, canceled: 0 };
      for (const row of this.database.prepare(`SELECT ${TASK_STATUS_GROUP_SQL} AS status_group,COUNT(*) AS total FROM project_tasks WHERE project_ref=? GROUP BY status_group`).all(projectRef)) groupTotals[row.status_group] = Number(row.total);
      const selectSql = `SELECT *,${TASK_STATUS_RANK_SQL} AS sort_rank,COALESCE(priority,-1) AS sort_priority,${TASK_STATUS_GROUP_SQL} AS status_group FROM project_tasks`;
      const orderSql = "ORDER BY sort_rank ASC,sort_priority DESC,updated_at DESC,created_at DESC,task_ref ASC LIMIT ?";
      const rows = hasBoundary
        ? this.database.prepare(`${selectSql} WHERE project_ref=? AND (${TASK_STATUS_RANK_SQL}>? OR (${TASK_STATUS_RANK_SQL}=? AND (COALESCE(priority,-1)<? OR (COALESCE(priority,-1)=? AND (updated_at<? OR (updated_at=? AND (created_at<? OR (created_at=? AND task_ref>?)))))))) ${orderSql}`).all(projectRef, boundaryRank, boundaryRank, boundaryPriority, boundaryPriority, boundaryUpdatedAt, boundaryUpdatedAt, boundaryCreatedAt, boundaryCreatedAt, boundaryTaskRef, boundedLimit + 1)
        : this.database.prepare(`${selectSql} WHERE project_ref=? ${orderSql}`).all(projectRef, boundedLimit + 1);
      const hasMore = rows.length > boundedLimit;
      const selected = rows.slice(0, boundedLimit);
      const tasks = selected.map((row) => this.#decodeTaskRow(projectRef, row));
      const itemBoundaries = selected.map((row) => ({ statusRank: row.sort_rank, priority: row.sort_priority, updatedAt: row.updated_at, createdAt: row.created_at, taskRef: row.task_ref }));
      const last = selected.at(-1);
      const endingRevision = this.#assertProjectRevision(projectRef, { allowMissing: true });
      if (endingRevision !== projectRevision) throw storeError("project task snapshot revision changed during read", "PROJECT_TASK_SNAPSHOT_INCONSISTENT");
      return {
        projectRevision,
        totalTasks,
        groupTotals,
        tasks,
        itemBoundaries,
        hasMore,
        nextBoundary: hasMore && last !== undefined ? { statusRank: last.sort_rank, priority: last.sort_priority, updatedAt: last.updated_at, createdAt: last.created_at, taskRef: last.task_ref } : null,
      };
    });
  }

  readTaskSnapshot(input = {}) {
    const window = this.readTaskWindow(input);
    return { projectRevision: window.projectRevision, tasks: window.tasks, hasMore: window.hasMore };
  }

  listTasks(input = {}) {
    return this.readTaskSnapshot(input).tasks;
  }

  getProjectRevision(inputProjectRef) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    return this.#assertProjectRevision(projectRef, { allowMissing: true });
  }

  getCollaborationCoordinatorActorRef(inputProjectRef) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const row = this.database.prepare("SELECT coordinator_actor_ref FROM project_collaboration_boards WHERE project_ref=?").get(projectRef);
    return row?.coordinator_actor_ref;
  }

  getEffectiveTaskActorRef({ projectRef: inputProjectRef, taskRef: inputTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const taskRef = nonEmptyString(inputTaskRef, "taskRef", 256);
    const row = this.database.prepare("SELECT owner_actor_ref,assignee_actor_ref FROM project_tasks WHERE project_ref=? AND task_ref=?").get(projectRef, taskRef);
    return row === undefined ? undefined : row.assignee_actor_ref ?? row.owner_actor_ref;
  }

  getCollaborationSeatActor({ projectRef: inputProjectRef, actorRef: inputActorRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const actorRef = nonEmptyString(inputActorRef, "actorRef", 256);
    const row = this.database.prepare("SELECT kind,parent_actor_ref FROM project_collaboration_seats WHERE project_ref=? AND actor_ref=?").get(projectRef, actorRef);
    return row === undefined ? undefined : { kind: row.kind, ...(row.parent_actor_ref === null ? {} : { parentActorRef: row.parent_actor_ref }) };
  }

  listEvents({ projectRef: inputProjectRef, afterRevision = 0, limit = 100 } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const after = safeInteger(afterRevision, "afterRevision");
    const boundedLimit = safeInteger(limit, "limit", 1, MAX_EVENTS_PER_QUERY);
    this.#assertProjectRevision(projectRef, { allowMissing: true });
    const rows = this.database.prepare(`SELECT project_revision, event_ref, command_id, task_ref, type, actor_ref, payload_cipher, created_at
      FROM project_task_events WHERE project_ref = ? AND project_revision > ? ORDER BY project_revision ASC LIMIT ?`).all(projectRef, after, boundedLimit);
    return rows.map((row) => ({
      projectRevision: row.project_revision,
      eventRef: row.event_ref,
      commandId: row.command_id,
      taskRef: row.task_ref,
      type: row.type,
      actorRef: row.actor_ref,
      payload: this.cipher.open(projectRef, eventField(row.event_ref), row.payload_cipher),
      createdAt: row.created_at,
    }));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.initialized = false;
    if (this.database !== undefined) {
      try { this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
      this.database.close();
      this.database = undefined;
    }
  }

  #migrate(database) {
    let current = database.prepare("PRAGMA user_version").get().user_version;
    if (current > PROJECT_TASK_SCHEMA_VERSION) throw storeError("project task database schema is newer than this runtime", "PROJECT_TASK_SCHEMA_UNSUPPORTED");
    if (current === 0) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_task_projects (
          project_ref TEXT PRIMARY KEY,
          project_revision INTEGER NOT NULL CHECK(project_revision >= 0)
        ) STRICT;
        CREATE TABLE project_tasks (
          project_ref TEXT NOT NULL,
          task_ref TEXT NOT NULL,
          status TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision >= 1),
          requirements_revision INTEGER NOT NULL CHECK(requirements_revision >= 1),
          owner_actor_ref TEXT NOT NULL,
          assignee_actor_ref TEXT,
          title_cipher TEXT NOT NULL,
          requirements_cipher TEXT NOT NULL,
          file_scope_cipher TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, task_ref),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_task_events (
          project_ref TEXT NOT NULL,
          project_revision INTEGER NOT NULL CHECK(project_revision >= 1),
          event_ref TEXT NOT NULL,
          command_id TEXT NOT NULL,
          command_digest TEXT NOT NULL,
          task_ref TEXT NOT NULL,
          type TEXT NOT NULL,
          actor_ref TEXT NOT NULL,
          payload_cipher TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, project_revision),
          UNIQUE(project_ref, event_ref),
          UNIQUE(project_ref, command_id),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX project_task_events_cursor ON project_task_events(project_ref, project_revision);
        PRAGMA user_version = 1;
        COMMIT;`);
      current = 1;
    }
    if (current === 1) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_task_actors (
          project_ref TEXT NOT NULL, actor_ref TEXT NOT NULL, kind TEXT NOT NULL, role TEXT,
          authorities_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, actor_ref),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_task_comments (
          project_ref TEXT NOT NULL, task_ref TEXT NOT NULL, comment_ref TEXT NOT NULL, kind TEXT NOT NULL,
          author_actor_ref TEXT NOT NULL, body_cipher TEXT NOT NULL, requirements_revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, comment_ref),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_task_relations (
          project_ref TEXT NOT NULL, relation_ref TEXT NOT NULL, source_task_ref TEXT NOT NULL, target_task_ref TEXT NOT NULL,
          type TEXT NOT NULL, created_by_actor_ref TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, relation_ref),
          UNIQUE(project_ref, source_task_ref, target_task_ref, type),
          FOREIGN KEY(project_ref, source_task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE,
          FOREIGN KEY(project_ref, target_task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_task_attempts (
          project_ref TEXT NOT NULL, attempt_ref TEXT NOT NULL, task_ref TEXT NOT NULL, executor_actor_ref TEXT NOT NULL,
          accepted_requirements_revision INTEGER NOT NULL, state TEXT NOT NULL, invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, attempt_ref),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_task_reviews (
          project_ref TEXT NOT NULL, review_ref TEXT NOT NULL, task_ref TEXT NOT NULL, attempt_ref TEXT NOT NULL,
          reviewer_actor_ref TEXT NOT NULL, verdict TEXT NOT NULL, requirements_revision INTEGER NOT NULL,
          body_cipher TEXT NOT NULL, superseded INTEGER NOT NULL DEFAULT 0 CHECK(superseded IN (0,1)), created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, review_ref),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE,
          FOREIGN KEY(project_ref, attempt_ref) REFERENCES project_task_attempts(project_ref, attempt_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX project_task_comments_task ON project_task_comments(project_ref, task_ref, created_at);
        CREATE INDEX project_task_relations_source ON project_task_relations(project_ref, source_task_ref);
        CREATE INDEX project_task_attempts_task ON project_task_attempts(project_ref, task_ref, created_at);
        CREATE INDEX project_task_reviews_task ON project_task_reviews(project_ref, task_ref, created_at);
        PRAGMA user_version = 2;
        COMMIT;`);
      current = 2;
    }
    if (current === 2) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_task_command_receipts (
          project_ref TEXT NOT NULL, command_id TEXT NOT NULL, event_ref TEXT NOT NULL,
          request_digest TEXT NOT NULL, actor_ref TEXT NOT NULL, task_ref TEXT NOT NULL,
          receipt_cipher TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, command_id),
          UNIQUE(project_ref, event_ref),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX project_task_receipts_task ON project_task_command_receipts(project_ref, task_ref, created_at);
        PRAGMA user_version = 3;
        COMMIT;`);
      current = 3;
    }
    if (current === 3) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_collaboration_boards (
          project_ref TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 1), status TEXT NOT NULL,
          coordinator_actor_ref TEXT NOT NULL, title_cipher TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_collaboration_seats (
          project_ref TEXT NOT NULL, actor_ref TEXT NOT NULL, parent_actor_ref TEXT, kind TEXT NOT NULL, state TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK(revision >= 1), duty_cipher TEXT NOT NULL, resource_scope_cipher TEXT NOT NULL,
          phase_cipher TEXT NOT NULL, next_step_cipher TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, actor_ref),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_collaboration_locks (
          project_ref TEXT NOT NULL, resource_ref TEXT NOT NULL, owner_actor_ref TEXT NOT NULL, task_ref TEXT,
          state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, resource_ref),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_collaboration_handoffs (
          project_ref TEXT NOT NULL, handoff_ref TEXT NOT NULL, task_ref TEXT NOT NULL, source_actor_ref TEXT NOT NULL,
          target_actor_ref TEXT NOT NULL, state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1),
          summary_cipher TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, handoff_ref),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_collaboration_evidence (
          project_ref TEXT NOT NULL, evidence_ref TEXT NOT NULL, task_ref TEXT NOT NULL, actor_ref TEXT NOT NULL,
          path_cipher TEXT NOT NULL, digest TEXT NOT NULL, summary_cipher TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, evidence_ref),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE TABLE project_collaboration_history (
          project_ref TEXT NOT NULL, collaboration_revision INTEGER NOT NULL CHECK(collaboration_revision >= 1),
          kind TEXT NOT NULL, actor_ref TEXT NOT NULL, subject_ref TEXT NOT NULL, summary_cipher TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, collaboration_revision),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX project_collaboration_seats_window ON project_collaboration_seats(project_ref, updated_at DESC, actor_ref ASC);
        CREATE INDEX project_collaboration_locks_state ON project_collaboration_locks(project_ref, state, resource_ref);
        CREATE INDEX project_collaboration_handoffs_state ON project_collaboration_handoffs(project_ref, state, updated_at DESC);
        CREATE INDEX project_collaboration_evidence_task ON project_collaboration_evidence(project_ref, task_ref, created_at DESC);
        CREATE INDEX project_collaboration_history_window ON project_collaboration_history(project_ref, collaboration_revision DESC);
        PRAGMA user_version = 4;
        COMMIT;`);
      current = 4;
    }
    if (current === 4) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_collaboration_root_reservations (
          project_ref TEXT NOT NULL, slot_actor_ref TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
          capability_digest TEXT, task_ref TEXT NOT NULL, state TEXT NOT NULL, adopted_actor_ref TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, slot_actor_ref),
          UNIQUE(project_ref, request_id),
          UNIQUE(project_ref, capability_digest),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX project_collaboration_reservations_state ON project_collaboration_root_reservations(project_ref, state, updated_at DESC);
        PRAGMA user_version = 5;
        COMMIT;`);
      current = 5;
    }
    if (current === 5) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_collaboration_requests (
          project_ref TEXT NOT NULL, request_ref TEXT NOT NULL, request_id TEXT NOT NULL, identity_digest TEXT NOT NULL, request_digest TEXT NOT NULL,
          kind TEXT NOT NULL, task_ref TEXT NOT NULL, dependency_task_ref TEXT, requester_actor_ref TEXT NOT NULL, target_actor_ref TEXT NOT NULL,
          state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), respond_by_at INTEGER NOT NULL,
          reason_cipher TEXT NOT NULL, resolution_cipher TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, request_ref), UNIQUE(project_ref, request_id),
          FOREIGN KEY(project_ref, task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE,
          FOREIGN KEY(project_ref, dependency_task_ref) REFERENCES project_tasks(project_ref, task_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE UNIQUE INDEX project_collaboration_requests_identity ON project_collaboration_requests(project_ref, identity_digest);
        CREATE INDEX project_collaboration_requests_window ON project_collaboration_requests(project_ref, updated_at DESC, request_ref ASC);
        CREATE INDEX project_collaboration_requests_target ON project_collaboration_requests(project_ref, target_actor_ref, state, updated_at DESC);
        PRAGMA user_version = 6;
        COMMIT;`);
      current = 6;
    }
    if (current === 6) {
      database.exec(`BEGIN IMMEDIATE;
        DROP INDEX project_collaboration_requests_identity;
        CREATE UNIQUE INDEX project_collaboration_requests_active_identity ON project_collaboration_requests(project_ref, identity_digest) WHERE state IN ('open','accepted');
        PRAGMA user_version = 7;
        COMMIT;`);
      current = 7;
    }
    if (current === 7) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_task_claim_next_receipts (
          project_ref TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL, actor_ref TEXT NOT NULL,
          receipt_cipher TEXT NOT NULL, created_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref, request_id),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE
        ) STRICT;
        CREATE INDEX project_task_claim_next_actor ON project_task_claim_next_receipts(project_ref,actor_ref,created_at DESC);
        PRAGMA user_version = 8;
        COMMIT;`);
      current = 8;
    }
    if (current === 8) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE TABLE project_collaboration_root_recoveries (
          project_ref TEXT NOT NULL, recovery_ref TEXT NOT NULL, request_id TEXT NOT NULL, request_digest TEXT NOT NULL,
          mode TEXT NOT NULL, failed_actor_ref TEXT NOT NULL, requester_actor_ref TEXT NOT NULL, collaboration_request_ref TEXT,
          state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), replacement_slot_actor_ref TEXT,
          replacement_task_ref TEXT, launch_ref TEXT, failure_code TEXT NOT NULL, failure_evidence_cipher TEXT NOT NULL,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY(project_ref,recovery_ref), UNIQUE(project_ref,request_id), UNIQUE(project_ref,launch_ref),
          FOREIGN KEY(project_ref) REFERENCES project_task_projects(project_ref) ON DELETE CASCADE,
          FOREIGN KEY(project_ref,replacement_task_ref) REFERENCES project_tasks(project_ref,task_ref) ON DELETE SET NULL
        ) STRICT;
        CREATE INDEX project_collaboration_root_recoveries_state ON project_collaboration_root_recoveries(project_ref,state,updated_at DESC);
        PRAGMA user_version = 9;
        COMMIT;`);
      current = 9;
    }
    if (current === 9) {
      database.exec(`BEGIN IMMEDIATE;
        ALTER TABLE project_collaboration_root_recoveries ADD COLUMN initiator_actor_ref TEXT;
        ALTER TABLE project_collaboration_root_recoveries ADD COLUMN beneficiary_actor_ref TEXT;
        UPDATE project_collaboration_root_recoveries SET initiator_actor_ref=requester_actor_ref,beneficiary_actor_ref=requester_actor_ref;
        PRAGMA user_version = 10;
        COMMIT;`);
      current = 10;
    }
    if (current === 10) {
      database.exec(`BEGIN IMMEDIATE;
        CREATE INDEX project_collaboration_locks_window ON project_collaboration_locks(project_ref,resource_ref ASC);
        CREATE INDEX project_collaboration_handoffs_window ON project_collaboration_handoffs(project_ref,updated_at DESC,handoff_ref ASC);
        CREATE INDEX project_collaboration_evidence_window ON project_collaboration_evidence(project_ref,created_at DESC,evidence_ref ASC);
        CREATE INDEX project_collaboration_recoveries_window ON project_collaboration_root_recoveries(project_ref,updated_at DESC,recovery_ref ASC);
        PRAGMA user_version = 11;
        COMMIT;`);
      current = 11;
    }
    if (current === 11) {
      database.exec(`BEGIN IMMEDIATE;
        ALTER TABLE project_tasks ADD COLUMN priority INTEGER CHECK(priority IS NULL OR (priority >= 0 AND priority <= 1000000));
        DROP INDEX IF EXISTS project_tasks_collaboration_window;
        PRAGMA user_version = 12;
        COMMIT;`);
      current = 12;
    }
    database.exec(`CREATE INDEX IF NOT EXISTS project_tasks_project_window ON project_tasks(project_ref, updated_at DESC, task_ref ASC);
      CREATE INDEX IF NOT EXISTS project_tasks_collaboration_window ON project_tasks(project_ref,
        (${TASK_STATUS_RANK_SQL}), COALESCE(priority,-1) DESC, updated_at DESC, created_at DESC, task_ref ASC);`);
  }

  #closeCollaborationRequest(input, state) {
    this.#requireReady();
    const projectRef=normalizeProjectRef(input.projectRef),requestRef=nonEmptyString(input.requestRef,"requestRef",256),actorRef=nonEmptyString(input.actorRef,"actorRef",256),expectedRevision=safeInteger(input.expectedRevision,"expectedRevision",1),timestamp=safeInteger(input.updatedAt,"updatedAt");
    const resolution=boundedUtf8String(input.resolution,"resolution");
    this.#transaction(()=>{
      const row=this.database.prepare("SELECT * FROM project_collaboration_requests WHERE project_ref=? AND request_ref=?").get(projectRef,requestRef);
      if(row===undefined) throw storeError("collaboration request does not exist","PROJECT_COLLABORATION_NOT_FOUND");
      if(row.requester_actor_ref!==actorRef) throw storeError("only requester may cancel","PROJECT_COLLABORATION_FORBIDDEN");
      if(row.state!=="open"||row.revision!==expectedRevision) throw storeError("collaboration request revision changed","PROJECT_COLLABORATION_CONFLICT",{currentRevision:row.revision});
      this.database.prepare("UPDATE project_collaboration_requests SET state=?,revision=revision+1,resolution_cipher=?,updated_at=? WHERE project_ref=? AND request_ref=?").run(state,this.cipher.seal(projectRef,collaborationField("request",requestRef,"resolution"),resolution),timestamp,projectRef,requestRef);
      this.database.prepare("UPDATE project_collaboration_boards SET revision=revision+1,updated_at=? WHERE project_ref=?").run(timestamp,projectRef);
      const projectRevision=this.#nextProjectRevision(projectRef);
      this.#insertCollaborationHistory({projectRef,projectRevision,kind:`request.${state}`,actorRef,subjectRef:requestRef,summary:resolution,createdAt:timestamp});
    });
    return {projectRevision:this.getProjectRevision(projectRef),request:this.getCollaborationRequest({projectRef,requestRef})};
  }

  #decodeCollaborationRequest(projectRef,row) {
    return { requestRef:row.request_ref,kind:row.kind,taskRef:row.task_ref,...(row.dependency_task_ref===null?{}:{dependencyTaskRef:row.dependency_task_ref}),requesterActorRef:row.requester_actor_ref,targetActorRef:row.target_actor_ref,state:row.state,revision:row.revision,respondByAt:row.respond_by_at,reason:this.cipher.open(projectRef,collaborationField("request",row.request_ref,"reason"),row.reason_cipher),...(row.resolution_cipher===null?{}:{resolution:this.cipher.open(projectRef,collaborationField("request",row.request_ref,"resolution"),row.resolution_cipher)}),createdAt:row.created_at,updatedAt:row.updated_at };
  }

  #decodeRootRecovery(projectRef,row) {
    return { recoveryRef:row.recovery_ref,mode:row.mode,failedActorRef:row.failed_actor_ref,initiatorActorRef:row.initiator_actor_ref ?? row.requester_actor_ref,beneficiaryActorRef:row.beneficiary_actor_ref ?? row.requester_actor_ref,requesterActorRef:row.beneficiary_actor_ref ?? row.requester_actor_ref,...(row.collaboration_request_ref===null?{}:{collaborationRequestRef:row.collaboration_request_ref}),state:row.state,revision:row.revision,...(row.replacement_slot_actor_ref===null?{}:{replacementSlotActorRef:row.replacement_slot_actor_ref}),...(row.replacement_task_ref===null?{}:{replacementTaskRef:row.replacement_task_ref}),...(row.launch_ref===null?{}:{launchRef:row.launch_ref}),failureCode:row.failure_code,failureEvidence:this.cipher.open(projectRef,collaborationField("root-recovery",row.recovery_ref,"failureEvidence"),row.failure_evidence_cipher),createdAt:row.created_at,updatedAt:row.updated_at };
  }

  #transaction(operation) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  #readTransaction(operation) {
    this.database.exec("BEGIN");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }

  #ensureProject(projectRef) {
    this.database.prepare("INSERT OR IGNORE INTO project_task_projects(project_ref, project_revision) VALUES (?, 0)").run(projectRef);
    return this.#assertProjectRevision(projectRef);
  }

  #assertProjectRevision(projectRef, { allowMissing = false } = {}) {
    const row = this.database.prepare("SELECT project_revision FROM project_task_projects WHERE project_ref = ?").get(projectRef);
    const revision = row?.project_revision ?? 0;
    const minimum = safeInteger(this.minimumRevisionProvider(projectRef) ?? 0, "minimum project revision");
    if (revision < minimum) throw storeError("project task database rollback was detected", "PROJECT_TASK_ROLLBACK", { currentRevision: revision, minimumRevision: minimum });
    if (row === undefined && !allowMissing) throw storeError("unknown project task project", "PROJECT_TASK_NOT_FOUND");
    return revision;
  }

  #nextProjectRevision(projectRef) {
    const result = this.database.prepare("UPDATE project_task_projects SET project_revision = project_revision + 1 WHERE project_ref = ?").run(projectRef);
    if (Number(result.changes) !== 1) throw storeError("unknown project task project", "PROJECT_TASK_NOT_FOUND");
    return this.#assertProjectRevision(projectRef);
  }

  #insertEvent({ projectRef, projectRevision, eventRef, commandId, digest, taskRef, type, actorRef, payloadCipher, createdAt }) {
    this.database.prepare(`INSERT INTO project_task_events (
      project_ref, project_revision, event_ref, command_id, command_digest, task_ref, type, actor_ref, payload_cipher, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(projectRef, projectRevision, eventRef, commandId, digest, taskRef, type, actorRef, payloadCipher, createdAt);
  }

  #insertCollaborationHistory({ projectRef, projectRevision, kind, actorRef, subjectRef, summary, createdAt }) {
    this.database.prepare(`INSERT INTO project_collaboration_history(project_ref, collaboration_revision, kind, actor_ref, subject_ref, summary_cipher, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(projectRef, projectRevision, kind, actorRef, subjectRef, this.cipher.seal(projectRef, collaborationField("history", String(projectRevision), "summary"), summary), createdAt);
  }

  #resourceOverlap(left, right) {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
  }

  #assertNoOtherInProgress(projectRef, actorRef, taskRef) {
    const active = this.database.prepare("SELECT task_ref FROM project_tasks WHERE project_ref=? AND assignee_actor_ref=? AND status='in_progress' AND task_ref<>? ORDER BY updated_at ASC,task_ref ASC LIMIT 1").get(projectRef, actorRef, taskRef);
    if (active !== undefined) throw storeError("a project root may have only one in-progress task", "PROJECT_TASK_ACTIVE_LIMIT", { activeTaskRef: active.task_ref });
  }

  #findResourceConflict(projectRef, actorRef, taskRef, fileScope) {
    const direct = this.database.prepare("SELECT resource_ref,task_ref FROM project_collaboration_locks WHERE project_ref=? AND task_ref=? AND state='active' AND owner_actor_ref<>? ORDER BY resource_ref ASC LIMIT 1").get(projectRef, taskRef, actorRef);
    if (direct !== undefined) return direct;
    const findConflict = this.database.prepare(`SELECT resource_ref,task_ref FROM project_collaboration_locks
      WHERE project_ref=? AND state='active' AND owner_actor_ref<>?
        AND (resource_ref=? OR substr(resource_ref,1,length(?)+1)=?||'/' OR substr(?,1,length(resource_ref)+1)=resource_ref||'/')
      ORDER BY resource_ref ASC LIMIT 1`);
    for (const resourceRef of fileScope) {
      const conflict = findConflict.get(projectRef, actorRef, resourceRef, resourceRef, resourceRef, resourceRef);
      if (conflict !== undefined && this.#resourceOverlap(resourceRef, conflict.resource_ref)) return conflict;
    }
    return undefined;
  }

  #readCollaborationSnapshot(projectRef, { historyLimit = 100, beforeRevision } = {}) {
    const board = this.database.prepare("SELECT * FROM project_collaboration_boards WHERE project_ref = ?").get(projectRef);
    if (board === undefined) return undefined;
    const seats = this.database.prepare("SELECT * FROM project_collaboration_seats WHERE project_ref = ? ORDER BY updated_at DESC, actor_ref ASC LIMIT ?").all(projectRef, COLLABORATION_SNAPSHOT_SECTION_LIMIT).map((row) => ({
      actorRef: row.actor_ref, ...(row.parent_actor_ref === null ? {} : { parentActorRef: row.parent_actor_ref }), kind: row.kind, state: row.state,
      revision: row.revision, duty: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "duty"), row.duty_cipher),
      resourceScope: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "resourceScope"), row.resource_scope_cipher),
      phase: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "phase"), row.phase_cipher),
      nextStep: this.cipher.open(projectRef, collaborationField("seat", row.actor_ref, "nextStep"), row.next_step_cipher), updatedAt: row.updated_at,
    }));
    const locks = this.database.prepare("SELECT * FROM project_collaboration_locks WHERE project_ref = ? ORDER BY resource_ref ASC LIMIT ?").all(projectRef, COLLABORATION_SNAPSHOT_SECTION_LIMIT).map((row) => ({
      resourceRef: row.resource_ref, ownerActorRef: row.owner_actor_ref, ...(row.task_ref === null ? {} : { taskRef: row.task_ref }), state: row.state, revision: row.revision, updatedAt: row.updated_at,
    }));
    const handoffs = this.database.prepare("SELECT * FROM project_collaboration_handoffs WHERE project_ref = ? ORDER BY updated_at DESC, handoff_ref ASC LIMIT ?").all(projectRef, COLLABORATION_SNAPSHOT_SECTION_LIMIT).map((row) => ({
      handoffRef: row.handoff_ref, taskRef: row.task_ref, sourceActorRef: row.source_actor_ref, targetActorRef: row.target_actor_ref,
      state: row.state, revision: row.revision, summary: this.cipher.open(projectRef, collaborationField("handoff", row.handoff_ref, "summary"), row.summary_cipher), updatedAt: row.updated_at,
    }));
    const evidence = this.database.prepare("SELECT * FROM project_collaboration_evidence WHERE project_ref = ? ORDER BY created_at DESC, evidence_ref ASC LIMIT ?").all(projectRef, COLLABORATION_SNAPSHOT_SECTION_LIMIT).map((row) => ({
      evidenceRef: row.evidence_ref, taskRef: row.task_ref, actorRef: row.actor_ref,
      path: this.cipher.open(projectRef, collaborationField("evidence", row.evidence_ref, "path"), row.path_cipher), digest: row.digest,
      summary: this.cipher.open(projectRef, collaborationField("evidence", row.evidence_ref, "summary"), row.summary_cipher), createdAt: row.created_at,
    }));
    const recoveries = this.database.prepare("SELECT * FROM project_collaboration_root_recoveries WHERE project_ref=? ORDER BY updated_at DESC,recovery_ref ASC LIMIT ?").all(projectRef, COLLABORATION_SNAPSHOT_SECTION_LIMIT).map((row)=>this.#decodeRootRecovery(projectRef,row));
    const boundary = beforeRevision === undefined ? Number.MAX_SAFE_INTEGER : safeInteger(beforeRevision, "beforeRevision", 1);
    const historyRows = this.database.prepare(`SELECT * FROM project_collaboration_history WHERE project_ref = ? AND collaboration_revision < ?
      ORDER BY collaboration_revision DESC LIMIT ?`).all(projectRef, boundary, historyLimit + 1);
    const history = historyRows.slice(0, historyLimit).map((row) => ({
      revision: row.collaboration_revision, kind: row.kind, actorRef: row.actor_ref, subjectRef: row.subject_ref,
      summary: this.cipher.open(projectRef, collaborationField("history", String(row.collaboration_revision), "summary"), row.summary_cipher), createdAt: row.created_at,
    }));
    return {
      projectRef, revision: board.revision, projectRevision: this.#assertProjectRevision(projectRef), status: board.status,
      coordinatorActorRef: board.coordinator_actor_ref, title: this.cipher.open(projectRef, collaborationField("board", projectRef, "title"), board.title_cipher),
      updatedAt: board.updated_at, seats, locks, handoffs, evidence, recoveries, history,
      totals: {
        seats: Number(this.database.prepare("SELECT COUNT(*) AS count FROM project_collaboration_seats WHERE project_ref = ?").get(projectRef).count),
        locks: Number(this.database.prepare("SELECT COUNT(*) AS count FROM project_collaboration_locks WHERE project_ref = ?").get(projectRef).count),
        handoffs: Number(this.database.prepare("SELECT COUNT(*) AS count FROM project_collaboration_handoffs WHERE project_ref = ?").get(projectRef).count),
        evidence: Number(this.database.prepare("SELECT COUNT(*) AS count FROM project_collaboration_evidence WHERE project_ref = ?").get(projectRef).count),
        recoveries: Number(this.database.prepare("SELECT COUNT(*) AS count FROM project_collaboration_root_recoveries WHERE project_ref = ?").get(projectRef).count),
        history: Number(this.database.prepare("SELECT COUNT(*) AS count FROM project_collaboration_history WHERE project_ref = ?").get(projectRef).count),
      },
      page: { includedHistory: history.length, hasMoreHistory: historyRows.length > historyLimit, nextBeforeRevision: history.at(-1)?.revision },
    };
  }

  #applyRecord(projectRef, taskRef, record, createdAt) {
    if (record.kind === "comment") {
      const commentRef = nonEmptyString(record.commentRef, "commentRef", 256);
      const commentKind = nonEmptyString(record.commentKind ?? "discussion", "commentKind", 64);
      const authorActorRef = nonEmptyString(record.authorActorRef, "authorActorRef", 256);
      const requirementsRevision = record.requirementsRevision === undefined
        ? this.database.prepare("SELECT requirements_revision FROM project_tasks WHERE project_ref = ? AND task_ref = ?").get(projectRef, taskRef)?.requirements_revision
        : safeInteger(record.requirementsRevision, "requirementsRevision", 1);
      safeInteger(requirementsRevision, "requirementsRevision", 1);
      const bodyCipher = this.cipher.seal(projectRef, recordField("comments", commentRef, "body"), nonEmptyString(record.body, "comment body", 32_768));
      this.database.prepare(`INSERT INTO project_task_comments(project_ref, task_ref, comment_ref, kind, author_actor_ref, body_cipher, requirements_revision, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(projectRef, taskRef, commentRef, commentKind, authorActorRef, bodyCipher, requirementsRevision, createdAt);
      return;
    }
    if (record.kind === "relation") {
      this.database.prepare(`INSERT INTO project_task_relations(project_ref, relation_ref, source_task_ref, target_task_ref, type, created_by_actor_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(projectRef, nonEmptyString(record.relationRef, "relationRef", 256), taskRef, nonEmptyString(record.targetTaskRef, "targetTaskRef", 256), nonEmptyString(record.relationType, "relationType", 64), nonEmptyString(record.createdByActorRef, "createdByActorRef", 256), createdAt);
      return;
    }
    if (record.kind === "attempt") {
      const attemptRef = nonEmptyString(record.attemptRef, "attemptRef", 256);
      if (record.operation === "start") {
        this.database.prepare(`INSERT INTO project_task_attempts(project_ref, attempt_ref, task_ref, executor_actor_ref, accepted_requirements_revision, state, invalidated, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(projectRef, attemptRef, taskRef, nonEmptyString(record.executorActorRef, "executorActorRef", 256), safeInteger(record.acceptedRequirementsRevision, "acceptedRequirementsRevision", 1), nonEmptyString(record.state, "attempt state", 32), createdAt, createdAt);
      } else if (record.operation === "update") {
        const result = this.database.prepare(`UPDATE project_task_attempts SET state = ?, accepted_requirements_revision = ?, updated_at = ?
          WHERE project_ref = ? AND attempt_ref = ? AND task_ref = ? AND invalidated = 0`).run(nonEmptyString(record.state, "attempt state", 32), safeInteger(record.acceptedRequirementsRevision, "acceptedRequirementsRevision", 1), createdAt, projectRef, attemptRef, taskRef);
        if (Number(result.changes) !== 1) throw storeError("execution attempt is missing or invalidated", "PROJECT_TASK_REQUIREMENTS_STALE");
      } else throw new TypeError("attempt record operation must be start or update");
      return;
    }
    if (record.kind === "review") {
      const reviewRef = nonEmptyString(record.reviewRef, "reviewRef", 256);
      const body = record.body ?? "";
      if (typeof body !== "string" || body.length > 32_768) throw new TypeError("review body must be a string of at most 32768 characters");
      this.database.prepare(`INSERT INTO project_task_reviews(project_ref, review_ref, task_ref, attempt_ref, reviewer_actor_ref, verdict, requirements_revision, body_cipher, superseded, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(projectRef, reviewRef, taskRef, nonEmptyString(record.attemptRef, "attemptRef", 256), nonEmptyString(record.reviewerActorRef, "reviewerActorRef", 256), nonEmptyString(record.verdict, "verdict", 32), safeInteger(record.requirementsRevision, "requirementsRevision", 1), this.cipher.seal(projectRef, recordField("reviews", reviewRef, "body"), body), createdAt);
      return;
    }
    throw new TypeError(`unsupported domain record kind ${String(record.kind)}`);
  }

  #insertReceipt({ projectRef, commandId, eventRef, requestDigest, actorRef, taskRef, receipt, createdAt }) {
    const receiptCipher = this.cipher.seal(projectRef, receiptField(commandId), receipt);
    this.database.prepare(`INSERT INTO project_task_command_receipts(project_ref, command_id, event_ref, request_digest, actor_ref, task_ref, receipt_cipher, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(projectRef, commandId, eventRef, requestDigest, actorRef, taskRef, receiptCipher, createdAt);
  }

  #idempotentResult(projectRef, commandId, eventRef, requestDigest) {
    const receipt = this.getCommandReceipt({ projectRef, commandId, eventRef, requestDigest });
    return receipt === undefined ? undefined : { ...receipt, duplicate: true };
  }

  #readTask(projectRef, taskRef) {
    const row = this.database.prepare("SELECT * FROM project_tasks WHERE project_ref = ? AND task_ref = ?").get(projectRef, taskRef);
    return row === undefined ? undefined : this.#decodeTaskRow(projectRef, row);
  }

  #decodeTaskRow(projectRef, row) {
    const taskRef = row.task_ref;
    return {
      projectRef,
      taskRef,
      status: row.status,
      statusGroup: row.status_group ?? taskStatusGroup(row.status),
      ...(row.priority === null || row.priority === undefined ? {} : { priority: row.priority }),
      revision: row.revision,
      requirementsRevision: row.requirements_revision,
      ownerActorRef: row.owner_actor_ref,
      ...(row.assignee_actor_ref === null ? {} : { assigneeActorRef: row.assignee_actor_ref }),
      title: this.cipher.open(projectRef, fieldName(taskRef, "title"), row.title_cipher),
      requirements: this.cipher.open(projectRef, fieldName(taskRef, "requirements"), row.requirements_cipher),
      fileScope: this.cipher.open(projectRef, fieldName(taskRef, "fileScope"), row.file_scope_cipher),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  #requireReady() {
    if (!this.initialized || this.closed || this.database === undefined) throw storeError("project task store is not initialized or is closed", "PROJECT_TASK_STORE_CLOSED");
  }
}

export {
  MAX_EVENTS_PER_QUERY,
  MAX_TASKS_PER_QUERY,
  PROJECT_TASK_SCHEMA_VERSION,
  ProjectTaskStore,
};
