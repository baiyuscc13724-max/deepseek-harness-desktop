import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { TASK_STATES } from "./project-task-domain.js";
import { PROJECT_REF, ProjectTaskFieldCipher } from "./project-task-crypto.js";

const PROJECT_TASK_SCHEMA_VERSION = 3;
const MAX_EVENTS_PER_QUERY = 500;
const MAX_TASKS_PER_QUERY = 500;
const DOMAIN_RECORD_KINDS = new Set(["comment", "relation", "attempt", "review"]);
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PATCH_KEYS = new Set(["status", "title", "requirements", "fileScope", "ownerActorRef", "assigneeActorRef", "requirementsChanged"]);

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
    const title = nonEmptyString(input.task.title, "task.title", 500);
    const requirements = normalizeJson(input.task.requirements ?? {}, "task.requirements");
    const fileScope = normalizeJson(input.task.fileScope ?? [], "task.fileScope");
    if (!Array.isArray(fileScope) || fileScope.some((value) => typeof value !== "string")) throw new TypeError("task.fileScope must be an array of strings");
    const eventPayload = normalizeJson(input.eventPayload ?? {}, "eventPayload");
    const digest = commandDigest({ operation: "create", projectRef, commandId, eventRef, expectedRevision, actorRef, task: { taskRef, ownerActorRef, assigneeActorRef, status, title, requirements, fileScope }, eventPayload });
    const requestDigest = normalizeRequestDigest(input.requestDigest, digest);
    return this.#transaction(() => {
      this.#ensureProject(projectRef);
      const replay = this.#idempotentResult(projectRef, commandId, eventRef, requestDigest);
      if (replay !== undefined) return replay;
      if (this.database.prepare("SELECT 1 FROM project_tasks WHERE project_ref = ? AND task_ref = ?").get(projectRef, taskRef) !== undefined) {
        throw storeError("project task already exists", "PROJECT_TASK_CONFLICT");
      }
      this.database.prepare(`INSERT INTO project_tasks (
        project_ref, task_ref, status, revision, requirements_revision, owner_actor_ref, assignee_actor_ref,
        title_cipher, requirements_cipher, file_scope_cipher, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?)`).run(
        projectRef, taskRef, status, ownerActorRef, assigneeActorRef ?? null,
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
        ownerActorRef: normalizedPatch.ownerActorRef ?? current.owner_actor_ref,
        assigneeActorRef: Object.prototype.hasOwnProperty.call(normalizedPatch, "assigneeActorRef") ? normalizedPatch.assigneeActorRef : current.assignee_actor_ref,
        titleCipher: normalizedPatch.title === undefined ? current.title_cipher : this.cipher.seal(projectRef, fieldName(taskRef, "title"), normalizedPatch.title),
        requirementsCipher: normalizedPatch.requirements === undefined ? current.requirements_cipher : this.cipher.seal(projectRef, fieldName(taskRef, "requirements"), normalizedPatch.requirements),
        fileScopeCipher: normalizedPatch.fileScope === undefined ? current.file_scope_cipher : this.cipher.seal(projectRef, fieldName(taskRef, "fileScope"), normalizedPatch.fileScope),
        revision: current.revision + 1,
        requirementsRevision: current.requirements_revision + (requirementsChanged ? 1 : 0),
      };
      const result = this.database.prepare(`UPDATE project_tasks SET
        status = ?, revision = ?, requirements_revision = ?, owner_actor_ref = ?, assignee_actor_ref = ?,
        title_cipher = ?, requirements_cipher = ?, file_scope_cipher = ?, updated_at = ?
        WHERE project_ref = ? AND task_ref = ? AND revision = ?`).run(
        updates.status, updates.revision, updates.requirementsRevision, updates.ownerActorRef, updates.assigneeActorRef ?? null,
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

  getBlockingTaskRefs({ projectRef: inputProjectRef, taskRef: inputTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const taskRef = nonEmptyString(inputTaskRef, "taskRef", 256);
    return this.database.prepare(`SELECT relation.source_task_ref AS task_ref FROM project_task_relations relation
      JOIN project_tasks blocker ON blocker.project_ref = relation.project_ref AND blocker.task_ref = relation.source_task_ref
      WHERE relation.project_ref = ? AND relation.target_task_ref = ? AND relation.type = 'blocks' AND blocker.status <> 'done'
      ORDER BY relation.source_task_ref`).all(projectRef, taskRef).map((row) => row.task_ref);
  }

  getTask({ projectRef: inputProjectRef, taskRef: inputTaskRef } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const taskRef = nonEmptyString(inputTaskRef, "taskRef", 256);
    this.#assertProjectRevision(projectRef, { allowMissing: true });
    return this.#readTask(projectRef, taskRef);
  }

  readTaskSnapshot({ projectRef: inputProjectRef, limit = 100 } = {}) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    const boundedLimit = safeInteger(limit, "limit", 1, MAX_TASKS_PER_QUERY);
    return this.#readTransaction(() => {
      const projectRevision = this.#assertProjectRevision(projectRef, { allowMissing: true });
      const rows = this.database.prepare(`SELECT * FROM project_tasks WHERE project_ref = ?
        ORDER BY updated_at DESC, task_ref ASC LIMIT ?`).all(projectRef, boundedLimit + 1);
      const hasMore = rows.length > boundedLimit;
      const tasks = rows.slice(0, boundedLimit).map((row) => this.#decodeTaskRow(projectRef, row));
      const endingRevision = this.#assertProjectRevision(projectRef, { allowMissing: true });
      if (endingRevision !== projectRevision) throw storeError("project task snapshot revision changed during read", "PROJECT_TASK_SNAPSHOT_INCONSISTENT");
      return { projectRevision, tasks, hasMore };
    });
  }

  listTasks(input = {}) {
    return this.readTaskSnapshot(input).tasks;
  }

  getProjectRevision(inputProjectRef) {
    this.#requireReady();
    const projectRef = normalizeProjectRef(inputProjectRef);
    return this.#assertProjectRevision(projectRef, { allowMissing: true });
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
    }
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
