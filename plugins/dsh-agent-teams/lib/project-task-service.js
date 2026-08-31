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
  create: new Set(["title", "requirements", "fileScope", "priority"]),
  edit_requirements: new Set(["title", "requirements", "fileScope", "priority"]),
  assign: new Set(),
  claim: new Set(),
  transition: new Set(["to", "blockReason", "attemptRef", "reviewRef"]),
  comment: new Set(["commentRef", "kind", "body"]),
  "relation.add": new Set(["relationRef", "targetTaskRef", "relationType"]),
  "dependency.add": new Set(["relationRef", "blockerTaskRef"]),
  "dependency.remove": new Set(["blockerTaskRef"]),
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
function assertPriority(value, field) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000)) throw new TypeError(`${field} must be null or a safe integer from 0 through 1000000`);
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
  if (Object.prototype.hasOwnProperty.call(domain.payload, "priority")) assertPriority(domain.payload.priority, `${domain.type} payload.priority`);
  const command = Object.freeze({ projectRef, eventRef, ...domain });
  if (Buffer.byteLength(JSON.stringify(command), "utf8") > MAX_COMMAND_BYTES) throw new RangeError(`task command exceeds ${MAX_COMMAND_BYTES} bytes`);
  return command;
}

class ProjectTaskCommandService {
  constructor({ store, actorResolver, now = Date.now, wakeScheduler = () => undefined } = {}) {
    if (!(store instanceof ProjectTaskStore)) throw new TypeError("store must be a ProjectTaskStore");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof wakeScheduler !== "function") throw new TypeError("wakeScheduler must be a function");
    this.store = store;
    this.actors = new TrustedProjectActorResolver(actorResolver);
    this.now = now;
    this.wakeScheduler = wakeScheduler;
  }

  execute(execution, input, context = {}) { return this.executeCommand(execution, input, context); }

  listTaskWakeProjects(execution, input = {}) {
    const actor = this.actors.resolve(execution, input.projectRef);
    return this.store.listTaskWakeProjects({
      updatedAt: this.now(),
      ...(input.afterProjectRef === undefined ? {} : { afterProjectRef: input.afterProjectRef }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    }).filter((projectRef) => projectRef === actor.projectRef);
  }

  claimTaskWakeSignals(execution, input = {}) {
    const actor = this.actors.resolve(execution, input.projectRef);
    return this.store.claimTaskWakeSignals({
      projectRef: actor.projectRef,
      dispatcherRef: input.dispatcherRef,
      updatedAt: this.now(),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
      ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
    });
  }

  ackTaskWakeSignal(execution, input = {}) {
    const actor = this.actors.resolve(execution, input.projectRef);
    return this.store.ackTaskWakeSignal({
      projectRef: actor.projectRef,
      wakeRef: input.wakeRef,
      dispatcherRef: input.dispatcherRef,
      outcome: input.outcome,
      updatedAt: this.now(),
    });
  }

  setTaskWakePaused(execution, input = {}) {
    const actor = this.actors.resolve(execution, input.projectRef);
    return this.store.setTaskWakePaused({ projectRef: actor.projectRef, actorRef: actor.actorRef, paused: input.paused, updatedAt: this.now() });
  }

  executeCommand(execution, input, context = {}) {
    const command = normalizeCommand(input);
    const result = this.#executeNormalizedCommand(execution, command, context);
    if (result.duplicate !== true) {
      try { this.wakeScheduler(Object.freeze({ projectRef: command.projectRef })); } catch { /* restart discovery remains the durable fallback */ }
    }
    return result;
  }

  #executeNormalizedCommand(execution, command, context = {}) {
    const actor = projectToolActor(this.actors.resolve(execution, command.projectRef), this.store);
    const target = command.type === "assign" ? projectToolActor(this.actors.resolve(context.targetExecution, command.projectRef), this.store) : undefined;
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
      const changedFields = Object.keys(command.payload);
      const priorityOnly = changedFields.length === 1 && changedFields[0] === "priority";
      return this.store.mutateTask({ ...base, type: priorityOnly ? "task.priority_changed" : "task.requirements_changed", patch: command.payload, eventPayload: { changedFields } });
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
      assertAcyclicTaskRelations([relation]);
      const relationRef = nonEmptyString(command.payload.relationRef, "relationRef", 256);
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.relation_added", patch: { requirementsChanged: ["parent", "blocks"].includes(relation.type) }, records: [{ kind: "relation", relationRef, targetTaskRef, relationType: relation.type, createdByActorRef: actor.actorRef }], eventPayload: { relationRef, targetTaskRef, relationType: relation.type } });
    }
    if (command.type === "dependency.add" || command.type === "dependency.remove") {
      assertActorCan(actor, "edit_requirements", task);
      const blockerTaskRef = nonEmptyString(command.payload.blockerTaskRef, "blockerTaskRef", 256);
      if (this.store.getTask({ projectRef: command.projectRef, taskRef: blockerTaskRef }) === undefined) throw serviceError("dependency blocker task does not exist", "PROJECT_TASK_NOT_FOUND");
      const relation = { sourceTaskRef: blockerTaskRef, targetTaskRef: task.taskRef, type: "blocks" };
      const existing = this.store.hasTaskRelation({ projectRef: command.projectRef, ...relation });
      if (command.type === "dependency.add") {
        if (existing) throw serviceError("blocking dependency already exists", "PROJECT_TASK_RELATION_EXISTS");
        const relationRef = nonEmptyString(command.payload.relationRef, "relationRef", 256);
        this.#saveActor(command.projectRef, actor, timestamp);
        return this.store.mutateTask({ ...base, type: "task.dependency_added", patch: { requirementsChanged: true }, records: [{ kind: "relation", relationRef, sourceTaskRef: blockerTaskRef, targetTaskRef: task.taskRef, relationType: "blocks", createdByActorRef: actor.actorRef }], eventPayload: { relationRef, blockerTaskRef, blockedTaskRef: task.taskRef } });
      }
      if (!existing) throw serviceError("blocking dependency does not exist", "PROJECT_TASK_RELATION_NOT_FOUND");
      this.#saveActor(command.projectRef, actor, timestamp);
      return this.store.mutateTask({ ...base, type: "task.dependency_removed", patch: { requirementsChanged: true }, records: [{ kind: "relation.remove", sourceTaskRef: blockerTaskRef, targetTaskRef: task.taskRef, relationType: "blocks" }], eventPayload: { blockerTaskRef, blockedTaskRef: task.taskRef } });
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
    const actor = projectToolActor(this.actors.resolve(execution, command.projectRef), this.store);
    const digest = requestDigest(command, actor);
    const receipt = this.store.getCommandReceipt({ projectRef: command.projectRef, commandId: command.commandId, eventRef: command.eventRef, requestDigest: digest });
    return receipt === undefined ? undefined : { ...receipt, duplicate: true };
  }

  getCommandReceipt(execution, input = {}) {
    if (!isRecord(input)) throw new TypeError("receipt request must be an object");
    const extras = Object.keys(input).filter((key) => !new Set(["projectRef", "commandId"]).has(key));
    if (extras.length > 0) throw new TypeError(`receipt request contains unsupported fields: ${extras.join(", ")}`);
    const projectRef = nonEmptyString(input.projectRef, "projectRef", 128);
    const actor = projectToolActor(this.actors.resolve(execution, projectRef), this.store);
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
    return this.store.createTask({ projectRef: command.projectRef, commandId: command.commandId, eventRef: command.eventRef, expectedRevision: 0, requestDigest: digest, actorRef: actor.actorRef, createdAt: timestamp, task: { taskRef: command.taskRef, status: "todo", ownerActorRef: actor.actorRef, title, requirements: command.payload.requirements ?? {}, fileScope: command.payload.fileScope ?? [], ...(Object.prototype.hasOwnProperty.call(command.payload, "priority") ? { priority: command.payload.priority } : {}) }, eventPayload: { source: "command-service" } });
  }

  #saveActor(projectRef, actor, updatedAt) { this.store.saveActor({ projectRef, actor, updatedAt }); }
}

function collaborationTaskStatus(task) {
  if (task.status === "blocked") return "blocked";
  if (task.status === "in_progress") return "in_progress";
  if (task.status === "in_review") return "in_review";
  if (task.status === "done") return "done";
  if (task.assigneeActorRef !== undefined) return "claimed";
  return "unclaimed";
}
function collaborationError(message, code = "PROJECT_COLLABORATION_FORBIDDEN") {
  const error = new Error(message); error.code = code; return error;
}
function projectToolActor(actor, store) {
  const memberSeat = store.getCollaborationSeatActor({ projectRef: actor.projectRef, actorRef: actor.actorRef })?.kind === "member";
  if (actor.kind === "team" || memberSeat) throw collaborationError("Agent Team members cannot enter project collaboration tools");
  return actor;
}
function coordinator(actor) {
  return (actor.kind === "human" && ["owner", "maintainer"].includes(actor.role))
    || (actor.kind === "agent" && (actor.authorities ?? []).includes("project_lead"));
}

class ProjectCollaborationService {
  constructor({ store, actorResolver, now = Date.now, earlyResolutionAuthorizer = () => false, rootFailureResolver = () => undefined } = {}) {
    if (!(store instanceof ProjectTaskStore)) throw new TypeError("store must be a ProjectTaskStore");
    this.store = store;
    this.actors = actorResolver instanceof TrustedProjectActorResolver ? actorResolver : new TrustedProjectActorResolver(actorResolver);
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (typeof earlyResolutionAuthorizer !== "function") throw new TypeError("earlyResolutionAuthorizer must be a function");
    if (typeof rootFailureResolver !== "function") throw new TypeError("rootFailureResolver must be a function");
    this.now = now;
    this.earlyResolutionAuthorizer = earlyResolutionAuthorizer;
    this.rootFailureResolver = rootFailureResolver;
  }

  snapshot(execution, { projectRef, historyLimit, beforeRevision, taskLimit = 120, taskBoundary } = {}) {
    const actor = projectToolActor(this.actors.resolve(execution, nonEmptyString(projectRef, "projectRef", 128)), this.store);
    const collaboration = this.store.readCollaborationSnapshot({ projectRef, ...(historyLimit === undefined ? {} : { historyLimit }), ...(beforeRevision === undefined ? {} : { beforeRevision }) });
    if (collaboration === undefined) return { available: false, writable: coordinator(actor), projectRevision: this.store.getProjectRevision(projectRef) };
    const taskPage = this.store.readTaskWindow({ projectRef, limit: taskLimit, ...(taskBoundary ?? {}) });
    const tasks = taskPage.tasks.map((task) => ({ ...task, collaborationStatus: collaborationTaskStatus(task), blockedBy: this.store.getBlockingTaskRefs({ projectRef, taskRef: task.taskRef }) }));
    const totals = { ...collaboration.totals, tasks: taskPage.totalTasks, unclaimed: 0, claimed: 0, inProgress: 0, inReview: 0, done: 0, blocked: 0 };
    for (const task of tasks) {
      const key = { unclaimed: "unclaimed", claimed: "claimed", in_progress: "inProgress", in_review: "inReview", done: "done", blocked: "blocked" }[task.collaborationStatus];
      totals[key] += 1;
    }
    return { available: true, collaboration, tasks, totals, taskPage: { hasMore: taskPage.hasMore, nextBoundary: taskPage.nextBoundary }, permissions: this.#permissions(actor) };
  }

  sectionWindow(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    const window = this.store.readCollaborationSectionWindow({ ...input, projectRef: actor.projectRef });
    let items = window.items;
    if (input.section === "tasks") items = items.map((task) => ({ ...task, collaborationStatus: collaborationTaskStatus(task), blockedBy: this.store.getBlockingTaskRefs({ projectRef: actor.projectRef, taskRef: task.taskRef }) }));
    if (input.section === "requests") items = items.map((request) => ({
      ...request,
      mine: request.requesterActorRef === actor.actorRef,
      targetedToMe: request.targetActorRef === actor.actorRef,
      escalationEligible: this.#escalationEligible(execution, actor, request),
    }));
    return { ...window, items, permissions: this.#permissions(actor) };
  }

  createBoard(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (!coordinator(actor)) throw collaborationError("only a project coordinator may create the collaboration board");
    return this.store.createCollaborationBoard({ projectRef: actor.projectRef, coordinatorActorRef: actor.actorRef, title: input.title, createdAt: this.now() });
  }

  reserveRootSeat(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (actor.kind !== "agent" || !(actor.authorities ?? []).includes("project_lead")) throw collaborationError("only the project_lead root may reserve a root seat");
    return this.store.reserveRootSeat({ ...input, projectRef: actor.projectRef, coordinatorActorRef: actor.actorRef, createdAt: this.now() });
  }

  adoptRootSeat(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (actor.kind !== "agent" || (actor.authorities ?? []).length !== 0) throw collaborationError("only an ordinary exact top-level root may adopt a reserved seat");
    return this.store.adoptRootSeat({ ...input, projectRef: actor.projectRef, actorRef: actor.actorRef, adoptedAt: this.now() });
  }

  prepareRootRecovery(execution, input = {}) {
    const actor=this.#actor(execution,input.projectRef);
    if(input.failedActorRef!==undefined || input.failureCode!==undefined || input.failureEvidence!==undefined || input.requesterActorRef!==undefined || input.initiatorActorRef!==undefined || input.beneficiaryActorRef!==undefined) throw collaborationError("root failure identity and evidence are Host-derived");
    const evidence=this.rootFailureResolver({execution,actor,failureRef:input.failureRef,mode:input.mode});
    if(!isRecord(evidence) || typeof evidence.failedActorRef!=="string" || typeof evidence.failureCode!=="string" || typeof evidence.failureEvidence!=="string" || evidence.initiatorAuthorized!==true || input.mode==="takeover" && typeof evidence.taskRef!=="string") throw collaborationError("Host has no definitive failed top-level root evidence","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED");
    if(input.mode==="takeover" && !coordinator(actor)) throw collaborationError("takeover recovery requires the project coordinator","PROJECT_ROOT_RECOVERY_FORBIDDEN");
    return this.store.prepareRootRecovery({projectRef:actor.projectRef,recoveryRef:input.recoveryRef,requestId:input.requestId,mode:input.mode,failedActorRef:evidence.failedActorRef,initiatorActorRef:actor.actorRef,beneficiaryActorRef:evidence.beneficiaryActorRef ?? evidence.failedActorRef,failureCode:evidence.failureCode,failureEvidence:evidence.failureEvidence,collaborationRequestRef:input.collaborationRequestRef,recoveryTaskRef:evidence.taskRef,createdAt:this.now()});
  }

  getRootRecovery(execution,input={}) { const actor=this.#actor(execution,input.projectRef),recovery=this.store.getRootRecovery({projectRef:actor.projectRef,recoveryRef:input.recoveryRef}); if(recovery===undefined) throw collaborationError("root recovery not found","PROJECT_COLLABORATION_NOT_FOUND"); if(recovery.requesterActorRef!==actor.actorRef&&!coordinator(actor)) throw collaborationError("root recovery belongs to another root","PROJECT_ROOT_RECOVERY_FORBIDDEN"); return recovery; }
  reserveRootRecovery(execution,input={}) { const actor=this.#actor(execution,input.projectRef); return this.store.reserveRootRecovery({...input,projectRef:actor.projectRef,initiatorActorRef:actor.actorRef,updatedAt:this.now()}); }
  updateRootRecovery(execution,input={}) { const actor=this.#actor(execution,input.projectRef); return this.store.updateRootRecovery({...input,projectRef:actor.projectRef,actorRef:actor.actorRef,updatedAt:this.now()}); }

  upsertSeat(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    const targetActorRef = input.actorRef ?? actor.actorRef;
    const current = this.store.readCollaborationSnapshot({ projectRef: actor.projectRef })?.seats.find((seat) => seat.actorRef === targetActorRef);
    const own = targetActorRef === actor.actorRef;
    if (!own && !coordinator(actor)) throw collaborationError("an actor cannot modify another project seat");
    if (current?.state === "paused" && input.state === "active" && !coordinator(actor)) throw collaborationError("paused collaboration seats require coordinator resume");
    if (current?.kind === "member" && !coordinator(actor)) throw collaborationError("Agent Team member seats are coordinator-managed and have no project tool authority");
    if (input.kind === "member" && !coordinator(actor)) throw collaborationError("a root agent cannot impersonate an Agent Team member seat");
    return this.store.upsertCollaborationSeat({ ...input, projectRef: actor.projectRef, actorRef: targetActorRef, changedByActorRef: actor.actorRef, updatedAt: this.now() });
  }

  requestCollaboration(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (actor.kind !== "agent") throw collaborationError("only an exact project root may request blocked-task collaboration");
    if (input.targetActorRef !== undefined || input.requesterActorRef !== undefined) throw collaborationError("collaboration request actors are derived from persisted ownership");
    return this.#decorateRequestResult(execution, actor, this.store.createCollaborationRequest({ ...input, projectRef: actor.projectRef, requesterActorRef: actor.actorRef, createdAt: this.now() }));
  }

  respondCollaborationRequest(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (input.actorRef !== undefined) throw collaborationError("collaboration response actor is execution-derived");
    return this.#decorateRequestResult(execution, actor, this.store.respondCollaborationRequest({ ...input, projectRef: actor.projectRef, actorRef: actor.actorRef, updatedAt: this.now() }));
  }

  cancelCollaborationRequest(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    return this.#decorateRequestResult(execution, actor, this.store.cancelCollaborationRequest({ ...input, projectRef: actor.projectRef, actorRef: actor.actorRef, updatedAt: this.now() }));
  }

  resolveCollaborationRequest(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (actor.kind !== "agent" || !(actor.authorities ?? []).includes("project_lead")) throw collaborationError("only project_lead may audit-resolve a collaboration request");
    if (input.authorizedEarly !== undefined || input.directUserAuthorized !== undefined) throw collaborationError("early resolution authorization is Host-derived, never request input");
    const authorizedEarly = this.earlyResolutionAuthorizer({ execution, actor, request: Object.freeze({ ...input, projectRef: actor.projectRef }) }) === true;
    return this.#decorateRequestResult(execution, actor, this.store.escalateCollaborationRequest({ ...input, projectRef: actor.projectRef, coordinatorActorRef: actor.actorRef, authorizedEarly, updatedAt: this.now() }));
  }

  collaborationRequestWindow(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    return this.#decorateRequestResult(execution, actor, this.store.readCollaborationRequestWindow({ ...input, projectRef: actor.projectRef }));
  }

  claimNextTask(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    if (actor.kind !== "agent") throw collaborationError("only an exact project root may claim the next project task");
    return this.store.claimNextTask({ projectRef: actor.projectRef, requestId: input.requestId, actorRef: actor.actorRef, updatedAt: this.now() });
  }

  acquireLock(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    this.#assertSeatAuthority(actor, input.taskRef);
    return this.store.acquireCollaborationLock({ ...input, projectRef: actor.projectRef, ownerActorRef: actor.actorRef, updatedAt: this.now() });
  }

  releaseLock(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    return this.store.releaseCollaborationLock({ ...input, projectRef: actor.projectRef, actorRef: actor.actorRef, force: coordinator(actor) && input.force === true, updatedAt: this.now() });
  }

  prepareHandoff(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    this.#assertSeatAuthority(actor, input.taskRef);
    return this.store.prepareCollaborationHandoff({ ...input, projectRef: actor.projectRef, sourceActorRef: actor.actorRef, updatedAt: this.now() });
  }

  commitHandoff(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    return this.store.commitCollaborationHandoff({ ...input, projectRef: actor.projectRef, targetActorRef: actor.actorRef, updatedAt: this.now() });
  }

  addEvidence(execution, input = {}) {
    const actor = this.#actor(execution, input.projectRef);
    this.#assertSeatAuthority(actor, input.taskRef);
    return this.store.addCollaborationEvidence({ ...input, projectRef: actor.projectRef, actorRef: actor.actorRef, createdAt: this.now() });
  }

  #actor(execution, projectRef) { return projectToolActor(this.actors.resolve(execution, nonEmptyString(projectRef, "projectRef", 128)), this.store); }
  #decorateRequestResult(execution, actor, result) {
    const decorate = (request) => ({
      ...request,
      mine: request.requesterActorRef === actor.actorRef,
      targetedToMe: request.targetActorRef === actor.actorRef,
      escalationEligible: this.#escalationEligible(execution, actor, request),
    });
    return {
      ...result,
      ...(Array.isArray(result.requests) ? { requests: result.requests.map(decorate) } : {}),
      ...(result.request === undefined ? {} : { request: decorate(result.request) }),
    };
  }
  #escalationEligible(execution, actor, request) {
    if (this.store.getCollaborationCoordinatorActorRef(actor.projectRef) !== actor.actorRef) return false;
    if (!(request.state === "open" || (request.state === "accepted" && request.kind === "dependency_unblock"))) return false;
    const effectiveTargetActorRef = this.store.getEffectiveTaskActorRef({ projectRef: actor.projectRef, taskRef: request.dependencyTaskRef ?? request.taskRef });
    if (effectiveTargetActorRef === undefined || effectiveTargetActorRef !== request.targetActorRef) return false;
    return this.now() >= request.respondByAt || this.earlyResolutionAuthorizer({ execution, actor, request: Object.freeze({ ...request, projectRef: actor.projectRef }) }) === true;
  }
  #permissions(actor) {
    return { canCreate: coordinator(actor), canAssign: coordinator(actor), canReview: coordinator(actor) || (actor.kind === "human" && ["owner", "maintainer", "reviewer"].includes(actor.role)), canResolveConflict: coordinator(actor), canUpdateOwnSeat: true, canClaim: actor.kind !== "system", canSubmit: actor.kind !== "system" };
  }
  #assertSeatAuthority(actor, taskRef) {
    const task = taskRef === undefined ? undefined : this.store.getTask({ projectRef: actor.projectRef, taskRef });
    if (taskRef !== undefined && task === undefined) throw collaborationError("unknown project task", "PROJECT_TASK_NOT_FOUND");
    if (coordinator(actor) || task === undefined || [task.assigneeActorRef, task.ownerActorRef].includes(actor.actorRef)) return;
    if (actor.kind !== "human") {
      const seat = this.store.getCollaborationSeatActor({ projectRef: actor.projectRef, actorRef: actor.actorRef });
      if (seat?.kind === "member" && [task.assigneeActorRef, task.ownerActorRef].includes(seat.parentActorRef)) return;
    }
    throw collaborationError("actor is outside the owning root task scope");
  }
}

export { ProjectCollaborationService, ProjectTaskCommandService, collaborationTaskStatus, normalizeCommand, requestDigest };
