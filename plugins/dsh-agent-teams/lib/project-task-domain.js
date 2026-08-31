const TASK_STATES = Object.freeze(["backlog", "todo", "in_progress", "in_review", "blocked", "done", "canceled"]);
const TASK_TRANSITIONS = Object.freeze({
  backlog: Object.freeze(["todo", "canceled"]),
  todo: Object.freeze(["backlog", "in_progress", "blocked", "canceled"]),
  in_progress: Object.freeze(["todo", "in_review", "blocked", "canceled"]),
  in_review: Object.freeze(["in_progress", "blocked", "done", "canceled"]),
  blocked: Object.freeze(["todo", "in_progress", "canceled"]),
  done: Object.freeze(["todo"]),
  canceled: Object.freeze(["backlog"]),
});
const ACTOR_KINDS = Object.freeze(["human", "agent", "team", "system"]);
const HUMAN_ROLES = Object.freeze(["owner", "maintainer", "contributor", "reviewer", "observer"]);
const TASK_ACTIONS = Object.freeze([
  "read", "create", "edit_requirements", "assign", "claim", "transition", "comment", "attach", "submit_review", "approve_review", "cancel",
]);
const HUMAN_PERMISSIONS = Object.freeze({
  owner: new Set(TASK_ACTIONS),
  maintainer: new Set(TASK_ACTIONS),
  contributor: new Set(["read", "create", "claim", "transition", "comment", "attach", "submit_review"]),
  reviewer: new Set(["read", "comment", "attach", "submit_review", "approve_review"]),
  observer: new Set(["read"]),
});
const EXECUTOR_PERMISSIONS = new Set(["read", "claim", "transition", "comment", "attach", "submit_review"]);
const PROJECT_LEAD_PERMISSIONS = new Set(TASK_ACTIONS);
const NON_HUMAN_REVIEW_AUTHORITIES = new Set(["project_lead", "reviewer"]);
const SYSTEM_PERMISSIONS = new Set(["read", "create", "assign", "transition", "comment", "attach", "submit_review", "cancel"]);
const RELATION_TYPES = Object.freeze(["parent", "blocks", "related", "duplicates"]);
const ORDERING_RELATIONS = new Set(["parent", "blocks"]);
const REVIEW_VERDICTS = Object.freeze(["approved", "changes_requested", "comment"]);
const ATTEMPT_STATES = Object.freeze(["running", "submitted", "failed", "canceled"]);
const COMMAND_TYPES = Object.freeze(["create", "edit_requirements", "assign", "claim", "transition", "comment", "relation.add", "dependency.add", "dependency.remove", "attempt.start", "attempt.submit", "review"]);
const COMMAND_KEYS = new Set(["commandId", "type", "taskRef", "expectedRevision", "payload"]);
const FORBIDDEN_IDENTITY_KEYS = new Set(["sessionid", "userid", "deviceid", "accountid", "email", "actorref", "role", "authority", "authorities"]);
const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_COMMAND_DEPTH = 16;

function domainError(message, code, details = {}) {
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
function positiveRevision(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}
function assertStatus(value, field = "status") {
  if (!TASK_STATES.includes(value)) throw new TypeError(`${field} has unsupported task status ${String(value)}`);
  return value;
}
function assertTaskShape(task) {
  if (!isRecord(task)) throw new TypeError("task must be an object");
  nonEmptyString(task.taskRef, "task.taskRef", 256);
  assertStatus(task.status, "task.status");
  positiveRevision(task.revision, "task.revision");
  positiveRevision(task.requirementsRevision, "task.requirementsRevision");
  return task;
}
function assertActorShape(actor) {
  if (!isRecord(actor)) throw new TypeError("actor must be an object");
  nonEmptyString(actor.actorRef, "actor.actorRef", 256);
  if (!ACTOR_KINDS.includes(actor.kind)) throw new TypeError(`actor.kind must be one of ${ACTOR_KINDS.join(", ")}`);
  if (actor.kind === "human" && !HUMAN_ROLES.includes(actor.role)) throw new TypeError(`human actor.role must be one of ${HUMAN_ROLES.join(", ")}`);
  if (actor.authorities !== undefined) {
    if (!Array.isArray(actor.authorities) || actor.authorities.some((authority) => !NON_HUMAN_REVIEW_AUTHORITIES.has(authority)) || new Set(actor.authorities).size !== actor.authorities.length) {
      throw new TypeError(`actor.authorities may contain only ${[...NON_HUMAN_REVIEW_AUTHORITIES].join(", ")}`);
    }
    if (actor.kind === "human") throw new TypeError("human authority is derived from role, not actor.authorities");
  }
  return actor;
}
function assertAction(action) {
  if (!TASK_ACTIONS.includes(action)) throw new TypeError(`unsupported task action ${String(action)}`);
  return action;
}
function sameRef(left, right) {
  return typeof left === "string" && left !== "" && left === right;
}

function canTransition(from, to) {
  assertStatus(from, "from");
  assertStatus(to, "to");
  return TASK_TRANSITIONS[from].includes(to);
}

function assertAttemptCurrent(task, attempt, { requireSubmitted = false } = {}) {
  assertTaskShape(task);
  if (!isRecord(attempt) || attempt.taskRef !== task.taskRef || !ATTEMPT_STATES.includes(attempt.state)) {
    throw domainError("transition requires an execution attempt for this task", "PROJECT_TASK_ATTEMPT_INVALID");
  }
  if (attempt.acceptedRequirementsRevision !== task.requirementsRevision) {
    throw domainError("execution attempt has not accepted the current requirements revision", "PROJECT_TASK_REQUIREMENTS_STALE", { currentRequirementsRevision: task.requirementsRevision });
  }
  if (requireSubmitted && attempt.state !== "submitted") throw domainError("transition requires a current submitted attempt", "PROJECT_TASK_ATTEMPT_NOT_SUBMITTED");
  return attempt;
}

function assertTaskTransition(task, to, context = {}) {
  assertTaskShape(task);
  assertStatus(to, "to");
  if (!canTransition(task.status, to)) throw domainError(`task transition ${task.status} -> ${to} is not allowed`, "PROJECT_TASK_INVALID_TRANSITION");
  if (to === "blocked" && (typeof context.blockReason !== "string" || context.blockReason.trim() === "")) {
    throw domainError("blocked transition requires a block reason", "PROJECT_TASK_BLOCK_REASON_REQUIRED");
  }
  if (to === "in_progress" && Array.isArray(context.blockedBy) && context.blockedBy.length > 0) {
    throw domainError("task has unresolved dependencies", "PROJECT_TASK_DEPENDENCY_BLOCKED", { blockedBy: [...context.blockedBy] });
  }
  if (to === "in_review") assertAttemptCurrent(task, context.attempt, { requireSubmitted: true });
  if (to === "done") {
    const attempt = assertAttemptCurrent(task, context.attempt, { requireSubmitted: true });
    const review = context.review;
    if (!isRecord(review) || review.verdict !== "approved" || review.attemptRef !== attempt.attemptRef || review.requirementsRevision !== task.requirementsRevision) {
      throw domainError("done transition requires a current approved review", "PROJECT_TASK_REVIEW_REQUIRED");
    }
  }
  return true;
}

function canActorPerform(actor, action, task) {
  try { assertActorShape(actor); assertAction(action); if (task !== undefined) assertTaskShape(task); } catch { return false; }
  if (actor.kind === "human") return HUMAN_PERMISSIONS[actor.role].has(action);
  if (actor.kind === "system") return SYSTEM_PERMISSIONS.has(action);
  if (actor.kind === "agent" && (actor.authorities ?? []).includes("project_lead")) return PROJECT_LEAD_PERMISSIONS.has(action);
  if (["read", "approve_review"].includes(action) && (actor.authorities ?? []).includes("reviewer")) return true;
  if (!EXECUTOR_PERMISSIONS.has(action)) return false;
  if (task === undefined) return action === "read";
  if (action === "claim") return task.assigneeActorRef === undefined || sameRef(task.assigneeActorRef, actor.actorRef);
  return sameRef(task.assigneeActorRef, actor.actorRef);
}

function assertActorCan(actor, action, task) {
  assertActorShape(actor);
  assertAction(action);
  if (task !== undefined) assertTaskShape(task);
  if (!canActorPerform(actor, action, task)) throw domainError(`actor cannot perform task action ${action}`, "PROJECT_TASK_FORBIDDEN");
  return true;
}

function assertExpectedRevision(task, expectedRevision) {
  assertTaskShape(task);
  positiveRevision(expectedRevision, "expectedRevision");
  if (task.revision !== expectedRevision) {
    throw domainError("project task compare-and-swap revision changed", "PROJECT_TASK_CONFLICT", { currentRevision: task.revision });
  }
  return true;
}

function advanceTaskRevision(task, { requirementsChanged = false } = {}) {
  assertTaskShape(task);
  if (typeof requirementsChanged !== "boolean") throw new TypeError("requirementsChanged must be boolean");
  return {
    ...task,
    revision: task.revision + 1,
    ...(requirementsChanged ? { requirementsRevision: task.requirementsRevision + 1 } : {}),
  };
}

function createExecutionAttempt(task, { attemptRef, executorActorRef } = {}) {
  assertTaskShape(task);
  if (task.status !== "in_progress") throw domainError("execution attempts can start only for in-progress tasks", "PROJECT_TASK_INVALID_TRANSITION");
  return Object.freeze({
    attemptRef: nonEmptyString(attemptRef, "attemptRef", 256),
    taskRef: task.taskRef,
    executorActorRef: nonEmptyString(executorActorRef, "executorActorRef", 256),
    acceptedRequirementsRevision: task.requirementsRevision,
    state: "running",
  });
}

function acknowledgeAttemptRequirements(task, attempt, actorRef) {
  assertTaskShape(task);
  if (!isRecord(attempt) || attempt.taskRef !== task.taskRef || attempt.state !== "running") throw domainError("requirements can be acknowledged only for a running attempt on this task", "PROJECT_TASK_ATTEMPT_INVALID");
  const actor = nonEmptyString(actorRef, "actorRef", 256);
  if (attempt.executorActorRef !== actor) throw domainError("only the attempt executor can acknowledge requirements", "PROJECT_TASK_FORBIDDEN");
  return Object.freeze({ ...attempt, acceptedRequirementsRevision: task.requirementsRevision });
}

function submitExecutionAttempt(task, attempt) {
  assertTaskShape(task);
  if (task.status !== "in_progress") throw domainError("only an in-progress task attempt can be submitted", "PROJECT_TASK_INVALID_TRANSITION");
  assertAttemptCurrent(task, attempt);
  if (attempt.state !== "running") throw domainError("only a running attempt can be submitted", "PROJECT_TASK_ATTEMPT_INVALID");
  return Object.freeze({ ...attempt, state: "submitted" });
}

function createTaskReview(task, attempt, reviewer, { reviewRef, verdict } = {}) {
  assertTaskShape(task);
  assertActorShape(reviewer);
  if (task.status !== "in_review") throw domainError("reviews require a task in review", "PROJECT_TASK_INVALID_TRANSITION");
  assertAttemptCurrent(task, attempt, { requireSubmitted: true });
  if (!REVIEW_VERDICTS.includes(verdict)) throw new TypeError(`verdict must be one of ${REVIEW_VERDICTS.join(", ")}`);
  const permission = verdict === "approved" ? "approve_review" : "submit_review";
  if (verdict === "approved" && reviewer.actorRef === attempt.executorActorRef) {
    throw domainError("an executor cannot approve its own attempt", "PROJECT_TASK_SELF_APPROVAL");
  }
  assertActorCan(reviewer, permission, task);
  return Object.freeze({
    reviewRef: nonEmptyString(reviewRef, "reviewRef", 256),
    taskRef: task.taskRef,
    attemptRef: attempt.attemptRef,
    reviewerActorRef: reviewer.actorRef,
    verdict,
    requirementsRevision: task.requirementsRevision,
  });
}

function normalizeRelation(relation, index) {
  if (!isRecord(relation)) throw new TypeError(`relations[${index}] must be an object`);
  const sourceTaskRef = nonEmptyString(relation.sourceTaskRef, `relations[${index}].sourceTaskRef`, 256);
  const targetTaskRef = nonEmptyString(relation.targetTaskRef, `relations[${index}].targetTaskRef`, 256);
  if (!RELATION_TYPES.includes(relation.type)) throw new TypeError(`relations[${index}].type is unsupported`);
  if (sourceTaskRef === targetTaskRef) throw domainError("a task cannot relate a task to itself", "PROJECT_TASK_RELATION_CYCLE");
  return { sourceTaskRef, targetTaskRef, type: relation.type };
}

function findTaskRelationCycle(relations) {
  if (!Array.isArray(relations)) throw new TypeError("relations must be an array");
  const normalized = relations.map(normalizeRelation);
  const graph = new Map();
  for (const relation of normalized) {
    if (!ORDERING_RELATIONS.has(relation.type)) continue;
    const targets = graph.get(relation.sourceTaskRef) ?? [];
    targets.push(relation.targetTaskRef);
    graph.set(relation.sourceTaskRef, targets);
    if (!graph.has(relation.targetTaskRef)) graph.set(relation.targetTaskRef, []);
  }
  const active = new Set();
  const visited = new Set();
  const path = [];
  const visit = (node) => {
    if (active.has(node)) {
      const start = path.indexOf(node);
      return [...path.slice(start), node];
    }
    if (visited.has(node)) return undefined;
    active.add(node);
    path.push(node);
    for (const target of graph.get(node) ?? []) {
      const cycle = visit(target);
      if (cycle !== undefined) return cycle;
    }
    path.pop();
    active.delete(node);
    visited.add(node);
    return undefined;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

function assertAcyclicTaskRelations(relations) {
  const cycle = findTaskRelationCycle(relations);
  if (cycle !== undefined) throw domainError(`task relation cycle detected: ${cycle.join(" -> ")}`, "PROJECT_TASK_RELATION_CYCLE", { cycle });
  return true;
}

function assertLosslessPayload(value, field = "payload", seen = new Set(), depth = 0) {
  if (depth > MAX_COMMAND_DEPTH) throw new TypeError(`payload exceeds maximum depth ${MAX_COMMAND_DEPTH}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError(`${field} contains a non-finite number`); return; }
  if (typeof value !== "object") throw new TypeError(`${field} must be lossless JSON`);
  if (seen.has(value)) throw new TypeError(`${field} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertLosslessPayload(value[index], `${field}[${index}]`, seen, depth + 1);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must contain plain objects only`);
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.replaceAll(/[-_]/gu, "").toLowerCase();
      if (FORBIDDEN_IDENTITY_KEYS.has(normalized)) throw new TypeError(`${field} contains forbidden identity field ${key}`);
      assertLosslessPayload(nested, `${field}.${key}`, seen, depth + 1);
    }
  }
  seen.delete(value);
}

function normalizeTaskCommand(input) {
  if (!isRecord(input)) throw new TypeError("task command must be an object");
  const extras = Object.keys(input).filter((key) => !COMMAND_KEYS.has(key));
  if (extras.length > 0) throw new TypeError(`task command contains unsupported fields: ${extras.join(", ")}`);
  const type = nonEmptyString(input.type, "type", 64);
  if (!COMMAND_TYPES.includes(type)) throw new TypeError(`unsupported task command type ${type}`);
  const payload = input.payload === undefined ? {} : input.payload;
  if (!isRecord(payload)) throw new TypeError("payload must be an object");
  assertLosslessPayload(payload);
  let expectedRevision;
  if (type === "create") {
    if (input.expectedRevision !== 0) throw new TypeError("create expectedRevision must be 0");
    expectedRevision = 0;
  } else expectedRevision = positiveRevision(input.expectedRevision, "expectedRevision");
  const command = {
    commandId: nonEmptyString(input.commandId, "commandId", 256),
    type,
    taskRef: nonEmptyString(input.taskRef, "taskRef", 256),
    expectedRevision,
    payload: JSON.parse(JSON.stringify(payload)),
  };
  if (Buffer.byteLength(JSON.stringify(command), "utf8") > MAX_COMMAND_BYTES) throw new RangeError(`task command exceeds ${MAX_COMMAND_BYTES} bytes`);
  return Object.freeze(command);
}

export {
  ACTOR_KINDS,
  ATTEMPT_STATES,
  COMMAND_TYPES,
  HUMAN_ROLES,
  RELATION_TYPES,
  REVIEW_VERDICTS,
  TASK_ACTIONS,
  TASK_STATES,
  TASK_TRANSITIONS,
  acknowledgeAttemptRequirements,
  advanceTaskRevision,
  assertAcyclicTaskRelations,
  assertActorCan,
  assertExpectedRevision,
  assertTaskTransition,
  canActorPerform,
  canTransition,
  createExecutionAttempt,
  createTaskReview,
  findTaskRelationCycle,
  normalizeTaskCommand,
  submitExecutionAttempt,
};
