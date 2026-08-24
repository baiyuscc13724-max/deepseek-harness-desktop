import { createHash } from "node:crypto";
import {
  assertAcyclicTaskRelations,
  assertActorCan,
  assertExpectedRevision,
  assertTaskTransition,
  createExecutionAttempt,
  createTaskReview,
  normalizeTaskCommand,
  submitExecutionAttempt,
} from "./project-task-domain.js";
import { TrustedProjectActorResolver } from "./project-task-actor.js";
import { ProjectTaskStore } from "./project-task-store.js";

const SERVICE_COMMAND_KEYS = new Set(["projectRef", "taskRef", "commandId", "eventRef", "type", "expectedRevision", "payload"]);
const MAX_COMMAND_BYTES = 64 * 1024;
const PAYLOAD_KEYS = Object.freeze({
  create: new Set(["title", "requirements", "fileScope"]),
  edit_requirements: new Set(["title", "requirements", "fileScope"]),
  assign: new Set(),
  claim: new Set(),
  transition: new Set(["to", "blockReason", "attemptRef", "reviewRef"]),
  comment: new Set(["commentRef", "kind", "body"]),
  "relation.add": new Set(["relationRef", "targetTaskRef", "relationType"]),
  "attempt.start": new Set(["attemptRef"]),
  "attempt.submit": new Set(["attemptRef"]),
  review: new Set(["reviewRef", "attemptRef", "verdict", "body"]),
});

function serviceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function stableActor(actor) {
  return { actorRef: actor.actorRef, kind: actor.kind, ...(actor.role === undefined ? {} : { role: actor.role }), authorities: [...(actor.authorities ?? [])].sort() };
}
function requestDigest(command, actor, target) {
  const material = { command, actor: stableActor(actor), ...(target === undefined ? {} : { target: stableActor(target) }) };
  return `sha256:${createHash("sha256").update(canonicalJson(material)).digest("hex")}`;
}
function normalizeCommand(input) {
  if (!isRecord(input)) throw new TypeError("command must be an object");
  const extras = Object.keys(input).filter((key) => !SERVICE_COMMAND_KEYS.has(key));
  if (extras.length > 0) throw new TypeError(`command contains unsupported fields: ${extras.join(", ")}`);
  const projectRef = nonEmptyString(input.projectRef, "projectRef", 128);
  const eventRef = nonEmptyString(input.eventRef, "eventRef", 256);
  const domain = normalizeTaskCommand({ commandId: input.commandId, type: input.type, taskRef: input.taskRef, expectedRevision: input.expectedRevision, payload: input.payload ?? {} });
  const allowed = PAYLOAD_KEYS[domain.type];
  const payloadExtras = Object.keys(domain.payload).filter((key) => !allowed.has(key));
  if (payloadExtras.length > 0) throw new TypeError(`${domain.type} payload contains unsupported fields: ${payloadExtras.join(", ")}`);
  const command = Object.freeze({ projectRef, eventRef, ...domain });
  if (Buffer.byteLength(JSON.stringify(command), "utf8") > MAX_COMMAND_BYTES) throw new RangeError(`task command exceeds ${MAX_COMMAND_BYTES} bytes`);
  return command;
}

class ProjectTaskCommandService {
  constructor({ store, actorResolver, now = Date.now } = {}) {
    if (!(store instanceof ProjectTaskStore)) throw new TypeError("store must be a ProjectTaskStore");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.store = store;
    this.actors = new TrustedProjectActorResolver(actorResolver);
    this.now = now;
  }

  execute(execution, input, context = {}) { return this.executeCommand(execution, input, context); }

  executeCommand(execution, input, context = {}) {
    const command = normalizeCommand(input);
    const actor = this.actors.resolve(execution, command.projectRef);
    const target = command.type === "assign" ? this.actors.resolve(context.targetExecution, command.projectRef) : undefined;
    const digest = requestDigest(command, actor, target);
    const persisted = this.store.getCommandReceipt({ projectRef: command.projectRef, commandId: command.commandId, eventRef: command.eventRef, requestDigest: digest });
    if (persisted !== undefined) return { ...persisted, duplicate: true };

    if (command.type === "create") return this.#create(command, actor, digest);
    const task = this.store.getTask({ projectRef: command.projectRef, taskRef: command.taskRef });
    if (task === undefined) throw serviceError("unknown project task", "PROJECT_TASK_NOT_FOUND");
    assertExpectedRevision(task, command.expectedRevision);
    const timestamp = this.now();
    const base = { projectRef: command.projectRef, taskRef: command.taskRef, commandId: command.commandId, eventRef: command.eventRef, expectedRevision: command.expectedRevision, requestDigest: digest, actorRef: actor.actorRef, createdAt: timestamp };

    if (command.type === "edit_requirements") {
      assertActorCan(actor, "edit_requirements", task);
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.requirements_changed", patch: command.payload, eventPayload: { changedFields: Object.keys(command.payload) } });
    }
    if (command.type === "assign") {
      assertActorCan(actor, "assign", task);
      this.#saveActor(command.projectRef, actor, timestamp);
      this.#saveActor(command.projectRef, target, timestamp);
      return this.store.mutateTask({ ...base, type: "task.assigned", patch: { assigneeActorRef: target.actorRef }, eventPayload: { assigneeActorRef: target.actorRef } });
    }
    if (command.type === "claim") {
      assertActorCan(actor, "claim", task);
      const blockedBy = this.store.getBlockingTaskRefs({ projectRef: command.projectRef, taskRef: task.taskRef });
      assertTaskTransition(task, "in_progress", { blockedBy });
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.claimed", patch: { assigneeActorRef: actor.actorRef, status: "in_progress" }, eventPayload: { blockedBy: [] } });
    }
    if (command.type === "comment") {
      assertActorCan(actor, "comment", task);
      const commentKind = nonEmptyString(command.payload.kind ?? "discussion", "comment kind", 64);
      const requirementsChanged = commentKind === "requirement_change";
      const commentRef = nonEmptyString(command.payload.commentRef, "commentRef", 256);
      const body = nonEmptyString(command.payload.body, "comment body", 32_768);
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.comment_added", patch: { requirementsChanged }, records: [{ kind: "comment", commentRef, commentKind, authorActorRef: actor.actorRef, body }], eventPayload: { commentRef, kind: commentKind } });
    }
    if (command.type === "relation.add") {
      assertActorCan(actor, "edit_requirements", task);
      const targetTaskRef = nonEmptyString(command.payload.targetTaskRef, "targetTaskRef", 256);
      if (this.store.getTask({ projectRef: command.projectRef, taskRef: targetTaskRef }) === undefined) throw serviceError("relation target task does not exist", "PROJECT_TASK_NOT_FOUND");
      const relation = { sourceTaskRef: task.taskRef, targetTaskRef, type: nonEmptyString(command.payload.relationType, "relationType", 64) };
      assertAcyclicTaskRelations([...this.store.listRelations({ projectRef: command.projectRef }), relation]);
      const relationRef = nonEmptyString(command.payload.relationRef, "relationRef", 256);
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.relation_added", patch: { requirementsChanged: ["parent", "blocks"].includes(relation.type) }, records: [{ kind: "relation", relationRef, targetTaskRef, relationType: relation.type, createdByActorRef: actor.actorRef }], eventPayload: { relationRef, targetTaskRef, relationType: relation.type } });
    }
    if (command.type === "attempt.start") {
      assertActorCan(actor, "submit_review", task);
      const attempt = createExecutionAttempt(task, { attemptRef: nonEmptyString(command.payload.attemptRef, "attemptRef", 256), executorActorRef: actor.actorRef });
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.attempt_started", patch: {}, records: [{ kind: "attempt", operation: "start", ...attempt }], eventPayload: { attemptRef: attempt.attemptRef } });
    }
    if (command.type === "attempt.submit") {
      const attempt = this.store.getAttempt({ projectRef: command.projectRef, attemptRef: nonEmptyString(command.payload.attemptRef, "attemptRef", 256) });
      if (attempt === undefined || attempt.invalidated) throw serviceError("execution attempt requirements are stale", "PROJECT_TASK_REQUIREMENTS_STALE");
      assertActorCan(actor, "submit_review", task);
      if (attempt.executorActorRef !== actor.actorRef) throw serviceError("only the attempt executor can submit it", "PROJECT_TASK_FORBIDDEN");
      const submitted = submitExecutionAttempt(task, attempt);
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.attempt_submitted", patch: {}, records: [{ kind: "attempt", operation: "update", ...submitted }], eventPayload: { attemptRef: submitted.attemptRef } });
    }
    if (command.type === "review") {
      const attempt = this.store.getAttempt({ projectRef: command.projectRef, attemptRef: nonEmptyString(command.payload.attemptRef, "attemptRef", 256) });
      if (attempt === undefined || attempt.invalidated) throw serviceError("execution attempt requirements are stale", "PROJECT_TASK_REQUIREMENTS_STALE");
      const reviewBody = command.payload.body ?? "";
      if (typeof reviewBody !== "string" || reviewBody.length > 32_768) throw new TypeError("review body must be a string of at most 32768 characters");
      const review = createTaskReview(task, attempt, actor, { reviewRef: nonEmptyString(command.payload.reviewRef, "reviewRef", 256), verdict: command.payload.verdict });
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.review_recorded", patch: {}, records: [{ kind: "review", ...review, body: reviewBody }], eventPayload: { reviewRef: review.reviewRef, attemptRef: review.attemptRef, verdict: review.verdict } });
    }
    if (command.type === "transition") {
      assertActorCan(actor, command.payload.to === "canceled" ? "cancel" : "transition", task);
      const attempt = command.payload.attemptRef === undefined ? undefined : this.store.getAttempt({ projectRef: command.projectRef, attemptRef: command.payload.attemptRef });
      const review = command.payload.reviewRef === undefined ? undefined : this.store.getReview({ projectRef: command.projectRef, reviewRef: command.payload.reviewRef });
      const blockedBy = command.payload.to === "in_progress" ? this.store.getBlockingTaskRefs({ projectRef: command.projectRef, taskRef: task.taskRef }) : [];
      assertTaskTransition(task, command.payload.to, { blockReason: command.payload.blockReason, blockedBy, attempt, review });
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.transitioned", patch: { status: command.payload.to }, eventPayload: { to: command.payload.to, blockReason: command.payload.blockReason, ...(command.payload.to === "in_progress" ? { blockedBy: [] } : {}) } });
    }
    throw new TypeError(`unsupported command type ${command.type}`);
  }

  getCommandOutcome(execution, input) {
    const command = normalizeCommand(input);
    if (command.type !== "claim" && command.type !== "transition") throw new TypeError("command outcome query requires a claim or transition command");
    // This is the M4 crash-recovery lookup: resolve the current Host actor and bind
    // the complete canonical intent before the first Store access. It never falls
    // back to commandId-only matching and never executes a Task effect.
    const actor = this.actors.resolve(execution, command.projectRef);
    const digest = requestDigest(command, actor);
    const receipt = this.store.getCommandReceipt({ projectRef: command.projectRef, commandId: command.commandId, eventRef: command.eventRef, requestDigest: digest });
    return receipt === undefined ? undefined : { ...receipt, duplicate: true };
  }

  getCommandReceipt(execution, input = {}) {
    if (!isRecord(input)) throw new TypeError("receipt request must be an object");
    const extras = Object.keys(input).filter((key) => !new Set(["projectRef", "commandId"]).has(key));
    if (extras.length > 0) throw new TypeError(`receipt request contains unsupported fields: ${extras.join(", ")}`);
    const projectRef = nonEmptyString(input.projectRef, "projectRef", 128);
    const actor = this.actors.resolve(execution, projectRef);
    const receipt = this.store.getCommandReceipt({ projectRef, commandId: nonEmptyString(input.commandId, "commandId", 256) });
    if (receipt === undefined) return undefined;
    assertActorCan(actor, "read", receipt.task);
    return receipt;
  }

  #create(command, actor, digest) {
    assertActorCan(actor, "create");
    const timestamp = this.now();
    const title = nonEmptyString(command.payload.title, "title", 500);
    this.#saveActor(command.projectRef, actor, timestamp);
    return this.store.createTask({ projectRef: command.projectRef, commandId: command.commandId, eventRef: command.eventRef, expectedRevision: 0, requestDigest: digest, actorRef: actor.actorRef, createdAt: timestamp, task: { taskRef: command.taskRef, status: "todo", ownerActorRef: actor.actorRef, title, requirements: command.payload.requirements ?? {}, fileScope: command.payload.fileScope ?? [] }, eventPayload: { source: "command-service" } });
  }

  #saveActor(projectRef, actor, updatedAt) { this.store.saveActor({ projectRef, actor, updatedAt }); }
}

export { ProjectTaskCommandService, normalizeCommand, requestDigest };
