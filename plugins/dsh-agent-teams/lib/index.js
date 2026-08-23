import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { createUserMessage, HarnessError } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { COLLABORATION_REASONS } from "./collaboration-broker.js";
import { AgentCollaborationService } from "./collaboration-service.js";
import { ProjectEntryService } from "./project-entry-service.js";

/** Host-only agent-team coordinator. A future client bundle is advertised by package metadata. */
const name = "agent-teams";
const inject = ["agents", "subagents", "tools", "systemPrompt", "webServer"];
const STORE_VERSION = 2;
const LEGACY_STORE_VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEAM_MESSAGES = 500;
const MAX_TEAM_TASKS = 1_000;
const UI_MAX_TASKS_PER_TEAM = 200;
const UI_MAX_EVENTS_PER_TEAM = 50;
const SSE_COALESCE_MS = 50;
const SUBAGENT_RECONCILE_MS = 20;
const GRACEFUL_LIFECYCLE_TIMEOUT_MS = 120_000;
const HARD_MAX_MEMBERS = 8;
const HARD_MAX_TEAMS_PER_ROOT = 8;
const MAX_EXPANSION_WORKSTREAMS = 4;
const MAX_EXPANSION_BOUNDARIES = 16;
const MAX_EXPANSION_REQUEST_CHARS = 24_000;
const DEFAULT_SETTINGS = Object.freeze({ enabled: false, maxMembers: 4, maxActiveTurns: 4 });
const MODEL_ROUTING_FILE = "harness-desktop-model-routing.json";
const MODEL_TIERS = Object.freeze(["main", "subagent"]);
const MANAGED_MEMBER_DENIED_TOOLS = Object.freeze(["subagent", "subagent_fork", "workflow", "ralph"]);
const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const MODEL_ID = /^\S{1,256}$/u;
const TASK_STATES = Object.freeze(["pending", "in_progress", "completed"]);
const MEMBER_STATES = Object.freeze([
  "provisioning", "running", "idle", "ready", "failed", "shutting_down", "retired",
]);
const TEAM_STATES = Object.freeze(["active", "paused", "closing", "closed"]);
const TRANSIENT_MEMBER_STATES = new Set(["provisioning", "running", "idle", "shutting_down"]);
const STORE_MUTATION_CHAINS = new Map();
const STORE_OPERATION_CHAINS = new Map();
const TEAM_OPERATION_CHAINS = new Map();
const GRACEFUL_ACTIVE_RUNS = new Map();
const GRACEFUL_LIFECYCLE_WAITERS = new Map();
const USER_PAUSED_TEAMS = new Set();
const STORE_INSTANCES = new Map();
const TEAM_KEYS = new Set(["id", "rootLeadSessionId", "name", "objective", "revision", "state", "createdAt", "updatedAt", "members", "tasks", "messages"]);
const TASK_KEYS = new Set(["id", "title", "description", "state", "dependsOn", "crossTeamDependsOn", "files", "assigneeSessionId", "createdAt", "updatedAt", "claimedAt", "completedAt"]);
const CROSS_DEPENDENCY_KEYS = new Set(["teamId", "taskId"]);
const EXPANSION_WORKSTREAM_KEYS = new Set(["title", "deliverable", "acceptance_criteria", "files", "resources"]);
const Config = z.object({
  enabled: z.boolean().default(false),
  maxMembers: z.number().step(1).min(1).max(HARD_MAX_MEMBERS).default(4),
  maxActiveTurns: z.number().step(1).min(1).max(HARD_MAX_MEMBERS).default(4),
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertAllowedKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new TypeError(`${field} contains unsupported fields: ${unknown.join(", ")}`);
}
function nonEmptyString(value, field, max = 16_384) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}
function optionalString(value, field, max = 16_384) {
  return value === undefined || value === null || value === "" ? undefined : nonEmptyString(value, field, max);
}
function optionalProvider(value) {
  const provider = typeof value?.provider === "string" ? value.provider.trim() : "";
  return PROVIDER_ID.test(provider) ? provider : undefined;
}
function optionalModelRoute(value) {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  return PROVIDER_ID.test(provider) && MODEL_ID.test(model) ? { provider, model } : undefined;
}
async function readModelRouting(store) {
  const file = join(dirname(dirname(store.filePath)), MODEL_ROUTING_FILE);
  try {
    const document = JSON.parse(await readFile(file, "utf8"));
    if (!isRecord(document)) return {};
    const main = optionalModelRoute(document.main);
    const subagent = optionalModelRoute(document.subagent);
    const sameRoute = main !== undefined && subagent !== undefined && main.provider === subagent.provider && main.model === subagent.model;
    return {
      main,
      subagent,
      subagentInheritsMain: document.subagent?.inheritMain === true || document.subagent?.inheritMain !== false && sameRoute,
    };
  } catch {
    // Routing is optional and key-free. Any missing, unreadable, or malformed state
    // safely falls back to Harness' inherited runtime defaults.
    return {};
  }
}
async function resolveModelSelection(store, tier, explicitModel, fallbackRoute) {
  assertEnum(tier, MODEL_TIERS, "modelTier");
  const routing = await readModelRouting(store);
  const fallback = optionalModelRoute(fallbackRoute);
  const fallbackProvider = optionalProvider(fallbackRoute);
  const model = optionalString(explicitModel, "model", 256);
  if (model !== undefined && !MODEL_ID.test(model)) throw new TypeError("model must be a non-whitespace model identifier");
  if (model !== undefined) {
    // Backward compatibility: explicit model inherits the exact live lead's
    // provider first. Routing is only a safe fallback when that provider is absent.
    const provider = fallbackProvider ?? routing.main?.provider ?? routing[tier]?.provider;
    const providerSource = fallbackProvider !== undefined ? "live-lead" : routing.main?.provider !== undefined ? "routing-main" : routing[tier]?.provider !== undefined ? `routing-${tier}` : "runtime-default";
    return {
      modelTier: tier,
      inheritsMain: false,
      routeSource: `${providerSource}-explicit-model`,
      ...(provider === undefined ? {} : { provider }),
      model,
    };
  }
  let selected = routing[tier];
  let routeSource = selected === undefined ? undefined : `routing-${tier}`;
  let inheritsMain = false;
  if (tier === "subagent") {
    if (selected !== undefined) inheritsMain = routing.subagentInheritsMain === true;
    else if (routing.main !== undefined) {
      selected = routing.main;
      routeSource = "routing-main";
      inheritsMain = true;
    } else {
      selected = fallback;
      routeSource = selected === undefined ? "runtime-default" : "live-lead";
      inheritsMain = true;
    }
  } else if (selected === undefined) {
    selected = fallback;
    routeSource = selected === undefined ? "runtime-default" : "live-lead";
  }
  return {
    modelTier: tier,
    inheritsMain,
    routeSource,
    ...(selected?.provider === undefined ? {} : { provider: selected.provider }),
    ...(selected?.model === undefined ? {} : { model: selected.model }),
  };
}
function canonicalMemberName(value, field = "member name") {
  return nonEmptyString(value, field, 120).normalize("NFKC").replace(/\s+/gu, " ").trim();
}
function normalizeMemberName(value, field = "member name") {
  const normalized = canonicalMemberName(value, field);
  if (normalized.length === 0 || normalized.length > 120 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) {
    throw new TypeError(`${field} must be a visible display name of at most 120 characters`);
  }
  return normalized;
}
function normalizeWorkerName(value) {
  const normalized = normalizeMemberName(value, "name");
  const length = [...normalized].length;
  const forbidden = ["宿主", "协调器", "执行器", "实现者", "子代理", "host", "coordinator", "executor", "implementer", "subagent"];
  if (length < 2 || length > 24 || !/^[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?: [\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*$/u.test(normalized) || forbidden.some((term) => normalized.toLowerCase().includes(term))) {
    reject("worker name must be a plain 2–24 code-point duty name in the user's language and must not use internal agent terminology", "AGENT_TEAMS_INVALID_MEMBER_NAME");
  }
  return normalized;
}
function memberNameKey(value) {
  // Persisted v1.0.27 names were only trimmed. Keep their NFKC identity usable on
  // upgrade (including ZWJ emoji), while normalizeMemberName stays strict for new input.
  return canonicalMemberName(value).toLowerCase();
}
function workerConsumesMemberSlot(member) {
  if (member.kind !== "worker" || member.state === "retired") return false;
  // A failed initial publication whose child was synchronously and conclusively
  // drained remains visible for audit, but must not block a replacement. A
  // naturally failed continuable child (undefined flags) still owns its slot.
  return !(member.state === "failed" && member.shutdownUnconfirmed === false && member.stopUnconfirmed === false);
}
function safeLimit(value, field, fallback, maximum = HARD_MAX_MEMBERS) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`${field} must be an integer from 1 through ${maximum}`);
  }
  return resolved;
}
function now() {
  return new Date().toISOString();
}
function clone(value) {
  return structuredClone(value);
}
function assertIsoDate(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new TypeError(`${field} must be an ISO date string`);
}
function assertEnum(value, values, field) {
  if (!values.includes(value)) throw new TypeError(`${field} must be one of ${values.join(", ")}`);
}
function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
}

function normalizeExpansionBoundary(value, field, { file = false } = {}) {
  let normalized = nonEmptyString(value, field, 1_024).normalize("NFKC");
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) reject(`${field} contains unsupported control characters`, "AGENT_TEAMS_INVALID_EXPANSION");
  if (!file) return normalized;
  normalized = normalized.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/");
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(/(^|\/)\.(?:\/|$)/gu, "$1").replace(/\/{2,}/gu, "/");
  } while (normalized !== previous);
  if (normalized.length === 0) reject(`${field} must identify a file or directory boundary`, "AGENT_TEAMS_INVALID_EXPANSION");
  if (normalized.split("/").includes("..")) reject(`${field} must not contain parent-directory traversal`, "AGENT_TEAMS_INVALID_EXPANSION");
  return normalized;
}
function caseInsensitiveExpansionFiles({ platform = process.platform, caseInsensitive } = {}) {
  return caseInsensitive ?? platform === "win32";
}
function comparableExpansionFileBoundary(value, options = {}) {
  let normalized = normalizeExpansionBoundary(value, "file boundary", { file: true });
  if (normalized.length > 1 && !/^[A-Za-z]:\/$/u.test(normalized)) normalized = normalized.replace(/\/+$/u, "");
  return caseInsensitiveExpansionFiles(options) ? normalized.toLocaleLowerCase("en-US") : normalized;
}
function literalExpansionPathOverlap(left, right) {
  const leftDescendants = left.endsWith("/") ? left : `${left}/`;
  const rightDescendants = right.endsWith("/") ? right : `${right}/`;
  return left === right || left.startsWith(rightDescendants) || right.startsWith(leftDescendants);
}
function expansionGlobPrefix(boundary) {
  const index = boundary.search(/[*?[\]{}]/u);
  return index < 0 ? { glob: false, prefix: boundary } : { glob: true, prefix: boundary.slice(0, index) };
}
/** Conservative file-ownership overlap: exact, directory descendants, and glob literal prefixes. */
function fileBoundaryOverlap(left, right, options = {}) {
  const leftBoundary = comparableExpansionFileBoundary(left, options);
  const rightBoundary = comparableExpansionFileBoundary(right, options);
  const leftPattern = expansionGlobPrefix(leftBoundary);
  const rightPattern = expansionGlobPrefix(rightBoundary);
  if (!leftPattern.glob && !rightPattern.glob) return literalExpansionPathOverlap(leftBoundary, rightBoundary);
  if (leftPattern.glob && rightPattern.glob) {
    if (leftPattern.prefix.length === 0 || rightPattern.prefix.length === 0) return true;
    return leftPattern.prefix.startsWith(rightPattern.prefix) || rightPattern.prefix.startsWith(leftPattern.prefix);
  }
  const pattern = leftPattern.glob ? leftPattern : rightPattern;
  const literal = leftPattern.glob ? rightBoundary : leftBoundary;
  if (pattern.prefix.length === 0 || literal.startsWith(pattern.prefix)) return true;
  const directoryPrefix = pattern.prefix.endsWith("/") ? pattern.prefix.slice(0, -1) : pattern.prefix;
  return directoryPrefix.length > 0 && literalExpansionPathOverlap(directoryPrefix, literal);
}
function comparableExpansionResourceBoundary(value) {
  const normalized = normalizeExpansionBoundary(value, "resource boundary");
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}
/** Resource claims are proposal-local and use exact or slash-delimited hierarchy only. */
function resourceBoundaryOverlap(left, right) {
  return literalExpansionPathOverlap(comparableExpansionResourceBoundary(left), comparableExpansionResourceBoundary(right));
}
function normalizeExpansionBoundaryList(value, field, { file = false, platform = process.platform } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_EXPANSION_BOUNDARIES) {
    reject(`${field} must be an array of at most ${MAX_EXPANSION_BOUNDARIES} boundaries`, "AGENT_TEAMS_INVALID_EXPANSION");
  }
  const normalized = value.map((item, index) => normalizeExpansionBoundary(item, `${field}[${index}]`, { file }));
  const overlap = file ? (left, right) => fileBoundaryOverlap(left, right, { platform }) : resourceBoundaryOverlap;
  for (let index = 0; index < normalized.length; index += 1) for (let candidate = 0; candidate < index; candidate += 1) {
    if (overlap(normalized[index], normalized[candidate])) {
      reject(`${field} contains overlapping boundaries ${JSON.stringify(normalized[candidate])} and ${JSON.stringify(normalized[index])}`, "AGENT_TEAMS_EXPANSION_CONFLICT");
    }
  }
  return normalized;
}
function normalizeExpansionRequest(input, { platform = process.platform } = {}) {
  const sourceTaskId = nonEmptyString(input.sourceTaskId, "sourceTaskId", 256);
  const parallelBenefit = nonEmptyString(input.parallelBenefit, "parallelBenefit", 2_000);
  if (!Array.isArray(input.workstreams) || input.workstreams.length < 1 || input.workstreams.length > MAX_EXPANSION_WORKSTREAMS) {
    reject(`workstreams must contain 1 through ${MAX_EXPANSION_WORKSTREAMS} independent outcomes`, "AGENT_TEAMS_INVALID_EXPANSION");
  }
  const workstreams = input.workstreams.map((candidate, index) => {
    if (!isRecord(candidate)) reject(`workstreams[${index}] must be an object`, "AGENT_TEAMS_INVALID_EXPANSION");
    const unknown = Object.keys(candidate).filter((key) => !EXPANSION_WORKSTREAM_KEYS.has(key));
    if (unknown.length > 0) reject(`workstreams[${index}] contains unsupported fields: ${unknown.join(", ")}`, "AGENT_TEAMS_INVALID_EXPANSION");
    const files = normalizeExpansionBoundaryList(candidate.files, `workstreams[${index}].files`, { file: true, platform });
    const resources = normalizeExpansionBoundaryList(candidate.resources, `workstreams[${index}].resources`);
    if (files.length + resources.length === 0) {
      reject(`workstreams[${index}] must declare at least one file or external-resource boundary`, "AGENT_TEAMS_INVALID_EXPANSION");
    }
    return {
      title: nonEmptyString(candidate.title, `workstreams[${index}].title`, 200),
      deliverable: nonEmptyString(candidate.deliverable, `workstreams[${index}].deliverable`, 2_000),
      acceptanceCriteria: nonEmptyString(candidate.acceptance_criteria, `workstreams[${index}].acceptance_criteria`, 2_000),
      files,
      resources,
    };
  });
  const titleKeys = workstreams.map((workstream) => workstream.title.normalize("NFKC").toLocaleLowerCase("en-US"));
  if (new Set(titleKeys).size !== titleKeys.length) reject("workstream titles must be unique", "AGENT_TEAMS_INVALID_EXPANSION");
  for (const kind of ["files", "resources"]) {
    const owners = [];
    const overlap = kind === "files" ? (left, right) => fileBoundaryOverlap(left, right, { platform }) : resourceBoundaryOverlap;
    for (const workstream of workstreams) for (const boundary of workstream[kind]) {
      const conflict = owners.find((owner) => overlap(owner.boundary, boundary));
      if (conflict !== undefined) reject(`proposed workstreams ${JSON.stringify(conflict.title)} and ${JSON.stringify(workstream.title)} overlap on ${kind} boundaries ${JSON.stringify(conflict.boundary)} and ${JSON.stringify(boundary)}`, "AGENT_TEAMS_EXPANSION_CONFLICT");
      owners.push({ boundary, title: workstream.title });
    }
  }
  const normalized = { sourceTaskId, parallelBenefit, workstreams };
  if (JSON.stringify(normalized).length > MAX_EXPANSION_REQUEST_CHARS) {
    reject(`expansion request must serialize to at most ${MAX_EXPANSION_REQUEST_CHARS} characters`, "AGENT_TEAMS_INVALID_EXPANSION");
  }
  return normalized;
}

/** Validate one persisted member record. Exported for focused host tests. */
function validateMember(member) {
  if (!isRecord(member)) throw new TypeError("member must be an object");
  nonEmptyString(member.id, "member.id", 256);
  nonEmptyString(member.sessionId, "member.sessionId", 256);
  nonEmptyString(member.name, "member.name", 120);
  nonEmptyString(member.role, "member.role", 500);
  assertEnum(member.kind, ["lead", "worker"], "member.kind");
  assertEnum(member.state, MEMBER_STATES, "member.state");
  assertIsoDate(member.createdAt, "member.createdAt");
  assertIsoDate(member.updatedAt, "member.updatedAt");
  optionalString(member.runId, "member.runId", 256);
  optionalString(member.model, "member.model", 256);
  const provider = optionalString(member.provider, "member.provider", 128);
  if (provider !== undefined && !PROVIDER_ID.test(provider)) throw new TypeError("member.provider is invalid");
  if (member.modelTier !== undefined) assertEnum(member.modelTier, MODEL_TIERS, "member.modelTier");
  if (member.inheritsMain !== undefined && typeof member.inheritsMain !== "boolean") throw new TypeError("member.inheritsMain must be boolean");
  optionalString(member.routeSource, "member.routeSource", 64);
  if (member.shutdownUnconfirmed !== undefined && typeof member.shutdownUnconfirmed !== "boolean") throw new TypeError("member.shutdownUnconfirmed must be boolean");
  if (member.stopUnconfirmed !== undefined && typeof member.stopUnconfirmed !== "boolean") throw new TypeError("member.stopUnconfirmed must be boolean");
  optionalString(member.error, "member.error", 4_096);
  return member;
}

/** Validate one persisted task and its dependency shape. */
function validateTask(task) {
  if (!isRecord(task)) throw new TypeError("task must be an object");
  assertAllowedKeys(task, TASK_KEYS, "task");
  nonEmptyString(task.id, "task.id", 256);
  nonEmptyString(task.title, "task.title", 500);
  optionalString(task.description, "task.description", 32_768);
  assertEnum(task.state, TASK_STATES, "task.state");
  assertStringArray(task.dependsOn, "task.dependsOn");
  if (task.crossTeamDependsOn !== undefined) {
    if (!Array.isArray(task.crossTeamDependsOn)) throw new TypeError("task.crossTeamDependsOn must be an array");
    for (const dependency of task.crossTeamDependsOn) {
      if (!isRecord(dependency)) throw new TypeError("cross-team task dependencies must be objects");
      assertAllowedKeys(dependency, CROSS_DEPENDENCY_KEYS, "cross-team task dependency");
      nonEmptyString(dependency.teamId, "cross-team dependency teamId", 256);
      nonEmptyString(dependency.taskId, "cross-team dependency taskId", 256);
    }
    const keys = task.crossTeamDependsOn.map((dependency) => `${dependency.teamId}:${dependency.taskId}`);
    if (new Set(keys).size !== keys.length) throw new TypeError("cross-team task dependencies must be unique");
  }
  if (task.files !== undefined) assertStringArray(task.files, "task.files");
  if (new Set(task.dependsOn).size !== task.dependsOn.length || task.dependsOn.includes(task.id)) {
    throw new TypeError("task dependencies must be unique and cannot include the task itself");
  }
  optionalString(task.assigneeSessionId, "task.assigneeSessionId", 256);
  assertIsoDate(task.createdAt, "task.createdAt");
  assertIsoDate(task.updatedAt, "task.updatedAt");
  if (task.claimedAt !== undefined) assertIsoDate(task.claimedAt, "task.claimedAt");
  if (task.completedAt !== undefined) assertIsoDate(task.completedAt, "task.completedAt");
  return task;
}

/** Validate one durable coordinator message. */
function validateMessage(message) {
  if (!isRecord(message)) throw new TypeError("message must be an object");
  nonEmptyString(message.id, "message.id", 256);
  nonEmptyString(message.fromSessionId, "message.fromSessionId", 256);
  nonEmptyString(message.toSessionId, "message.toSessionId", 256);
  optionalString(message.toTeamId, "message.toTeamId", 256);
  nonEmptyString(message.body, "message.body", 65_536);
  assertIsoDate(message.createdAt, "message.createdAt");
  if (message.status !== undefined) assertEnum(message.status, ["pending", "delivered", "failed"], "message.status");
  optionalString(message.deliveryError, "message.deliveryError", 4_096);
  if (message.deliveredAt !== undefined) assertIsoDate(message.deliveredAt, "message.deliveredAt");
  return message;
}

/** Validate one team and all cross-record references. */
function validateTeam(team) {
  if (!isRecord(team)) throw new TypeError("team must be an object");
  assertAllowedKeys(team, TEAM_KEYS, "team");
  nonEmptyString(team.id, "team.id", 256);
  nonEmptyString(team.rootLeadSessionId, "team.rootLeadSessionId", 256);
  nonEmptyString(team.name, "team.name", 500);
  optionalString(team.objective, "team.objective", 16_384);
  if (team.revision !== undefined && (!Number.isSafeInteger(team.revision) || team.revision < 1)) throw new TypeError("team.revision must be a positive integer");
  assertEnum(team.state, TEAM_STATES, "team.state");
  assertIsoDate(team.createdAt, "team.createdAt");
  assertIsoDate(team.updatedAt, "team.updatedAt");
  if (!Array.isArray(team.members) || !Array.isArray(team.tasks) || !Array.isArray(team.messages)) {
    throw new TypeError("team members, tasks, and messages must be arrays");
  }
  team.members.forEach(validateMember);
  team.tasks.forEach(validateTask);
  team.messages.forEach(validateMessage);
  const sessions = new Set(team.members.map((member) => member.sessionId));
  const ids = new Set(team.members.map((member) => member.id));
  if (sessions.size !== team.members.length || ids.size !== team.members.length) throw new TypeError("team member ids and sessions must be unique");
  const lead = team.members.filter((member) => member.kind === "lead");
  if (lead.length !== 1 || lead[0].sessionId !== team.rootLeadSessionId) throw new TypeError("team must contain its one root lead member");
  if (team.members.filter(workerConsumesMemberSlot).length > HARD_MAX_MEMBERS) throw new TypeError(`team exceeds the hard limit of ${HARD_MAX_MEMBERS} active teammates`);
  const taskIds = new Set(team.tasks.map((task) => task.id));
  if (taskIds.size !== team.tasks.length) throw new TypeError("team task ids must be unique");
  const tasksById = new Map(team.tasks.map((task) => [task.id, task]));
  for (const task of team.tasks) {
    if (task.dependsOn.some((id) => !taskIds.has(id))) throw new TypeError(`task ${task.id} references an unknown dependency`);
    if (task.assigneeSessionId !== undefined && !sessions.has(task.assigneeSessionId)) throw new TypeError(`task ${task.id} has an unknown assignee`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (taskId) => {
    if (visiting.has(taskId)) throw new TypeError(`task dependency cycle includes ${taskId}`);
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    for (const dependency of tasksById.get(taskId).dependsOn) visit(dependency);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const taskId of taskIds) visit(taskId);
  const messageIds = new Set();
  for (const message of team.messages) {
    if (messageIds.has(message.id)) throw new TypeError("team message ids must be unique");
    messageIds.add(message.id);
    if (!sessions.has(message.fromSessionId)) throw new TypeError(`message ${message.id} sender must belong to its source team`);
    if ((message.toTeamId === undefined || message.toTeamId === team.id) && !sessions.has(message.toSessionId)) {
      throw new TypeError(`message ${message.id} recipient must belong to its team`);
    }
  }
  return team;
}

function taskNodeKey(teamId, taskId) {
  return JSON.stringify([teamId, taskId]);
}
function crossTaskReference(dependency) {
  return `${dependency.teamId}:${dependency.taskId}`;
}
function parseCrossTaskReference(reference) {
  const value = nonEmptyString(reference, "cross-team task dependency", 513);
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) throw new TypeError("cross-team task dependencies must use team_id:task_id");
  return {
    teamId: nonEmptyString(value.slice(0, separator), "dependency teamId", 256),
    taskId: nonEmptyString(value.slice(separator + 1), "dependency taskId", 256),
  };
}

/** Validate and normalize the complete disk document. Version 1 migrates in place without reshaping records. */
function validateStoreDocument(document) {
  if (!isRecord(document) || ![LEGACY_STORE_VERSION, STORE_VERSION].includes(document.version) || !isRecord(document.settings) || !Array.isArray(document.teams)) {
    throw new TypeError("agent teams store has an unsupported shape or version");
  }
  if (document.version === LEGACY_STORE_VERSION) document.version = STORE_VERSION;
  document.settings.enabled = Boolean(document.settings.enabled);
  document.settings.maxMembers = safeLimit(document.settings.maxMembers, "settings.maxMembers", 4);
  document.settings.maxActiveTurns = safeLimit(document.settings.maxActiveTurns, "settings.maxActiveTurns", 4);
  document.teams.forEach(validateTeam);
  const teamsById = new Map(document.teams.map((team) => [team.id, team]));
  if (teamsById.size !== document.teams.length) throw new TypeError("team ids must be unique");
  const rootLeadSessions = new Set(document.teams.map((team) => team.rootLeadSessionId));
  const openTeamCounts = new Map();
  for (const team of document.teams) {
    if (team.state === "closed") continue;
    const count = (openTeamCounts.get(team.rootLeadSessionId) ?? 0) + 1;
    if (count > HARD_MAX_TEAMS_PER_ROOT) throw new TypeError(`a root lead cannot own more than ${HARD_MAX_TEAMS_PER_ROOT} unclosed peer teams`);
    openTeamCounts.set(team.rootLeadSessionId, count);
  }
  const activeWorkers = new Set();
  for (const team of document.teams) {
    if (team.state !== "closed") {
      for (const member of team.members) {
        if (member.kind !== "worker" || member.state === "retired") continue;
        if (rootLeadSessions.has(member.sessionId)) throw new TypeError("a root lead session cannot also be an active worker; nested teams are forbidden");
        if (activeWorkers.has(member.sessionId)) throw new TypeError("an active worker session cannot belong to multiple teams");
        activeWorkers.add(member.sessionId);
      }
    }
    for (const task of team.tasks) {
      for (const dependency of task.crossTeamDependsOn ?? []) {
        const target = teamsById.get(dependency.teamId);
        if (target === undefined) throw new TypeError(`task ${task.id} references an unknown dependency team`);
        if (target.rootLeadSessionId !== team.rootLeadSessionId) throw new TypeError(`task ${task.id} crosses fixed root leads`);
        if (target.tasks.every((candidate) => candidate.id !== dependency.taskId)) throw new TypeError(`task ${task.id} references an unknown cross-team task`);
        if (dependency.teamId === team.id && dependency.taskId === task.id) throw new TypeError("a task cannot depend on itself across teams");
      }
    }
    for (const message of team.messages) {
      if (message.toTeamId === undefined || message.toTeamId === team.id) continue;
      const target = teamsById.get(message.toTeamId);
      if (target === undefined) throw new TypeError(`message ${message.id} references an unknown target team`);
      if (target.rootLeadSessionId !== team.rootLeadSessionId || message.fromSessionId !== team.rootLeadSessionId) {
        throw new TypeError(`message ${message.id} crosses teams without their common fixed root lead`);
      }
      if (memberOf(target, message.toSessionId) === undefined) throw new TypeError(`message ${message.id} has an unknown target-team recipient`);
    }
  }
  const taskNodes = new Map(document.teams.flatMap((team) => team.tasks.map((task) => [taskNodeKey(team.id, task.id), { team, task }])));
  const visiting = new Set();
  const visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) throw new TypeError("cross-team task dependency cycle detected");
    if (visited.has(key)) return;
    visiting.add(key);
    const node = taskNodes.get(key);
    for (const taskId of node.task.dependsOn) visit(taskNodeKey(node.team.id, taskId));
    for (const dependency of node.task.crossTeamDependsOn ?? []) visit(taskNodeKey(dependency.teamId, dependency.taskId));
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of taskNodes.keys()) visit(key);
  return document;
}

/** Return the public task projection with blockedBy derived from dependencies. */
function deriveTask(task, tasks) {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  const files = task.files ?? [];
  const conflictsWith = task.state !== "in_progress" || files.length === 0 ? [] : tasks
    .filter((candidate) => candidate.id !== task.id && candidate.state === "in_progress" && candidate.assigneeSessionId !== task.assigneeSessionId)
    .filter((candidate) => (candidate.files ?? []).some((file) => files.includes(file)))
    .map((candidate) => candidate.id);
  return {
    ...clone(task),
    files: [...files],
    status: task.state,
    dependencies: [...task.dependsOn],
    assignee: task.assigneeSessionId ?? null,
    blockedBy: task.dependsOn.filter((id) => byId.get(id)?.state !== "completed"),
    conflictsWith,
  };
}
function deriveTaskAcrossTeams(task, team, teams) {
  const base = deriveTask(task, team.tasks);
  const teamsById = new Map(teams.map((candidate) => [candidate.id, candidate]));
  const crossTeamDependencies = clone(task.crossTeamDependsOn ?? []);
  const crossReferences = crossTeamDependencies.map(crossTaskReference);
  const crossBlockedBy = crossTeamDependencies.filter((dependency) => {
    const target = teamsById.get(dependency.teamId)?.tasks.find((candidate) => candidate.id === dependency.taskId);
    return target?.state !== "completed";
  }).map(crossTaskReference);
  const dependencySources = [...new Map(crossTeamDependencies.map((dependency) => {
    const source = teamsById.get(dependency.teamId);
    return [dependency.teamId, {
      teamId: dependency.teamId,
      teamName: source?.name ?? dependency.teamId,
      teamStatus: source?.state ?? "unavailable",
    }];
  })).values()];
  return {
    ...base,
    crossTeamDependencies,
    dependencySources,
    dependencies: [...base.dependencies, ...crossReferences],
    blockedBy: [...base.blockedBy, ...crossBlockedBy],
  };
}
function progressedDependents(document, teamId, taskId) {
  const reference = taskNodeKey(teamId, taskId);
  return document.teams.flatMap((team) => team.tasks
    .filter((task) => task.state !== "pending" && (
      team.id === teamId && task.dependsOn.includes(taskId)
      || (task.crossTeamDependsOn ?? []).some((dependency) => taskNodeKey(dependency.teamId, dependency.taskId) === reference)
    ))
    .map((task) => `${team.id}:${task.id}`));
}
function latestTimestamp(values) {
  return values.filter((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}
function memberLastActivityAt(member, team) {
  return latestTimestamp([
    member.updatedAt,
    ...team.tasks.filter((task) => task.assigneeSessionId === member.sessionId).map((task) => task.updatedAt),
    ...team.messages.filter((message) => message.fromSessionId === member.sessionId || message.toSessionId === member.sessionId)
      .flatMap((message) => [message.createdAt, message.deliveredAt]),
  ]) ?? member.updatedAt;
}
function projectMessageEvent(message, names, sourceTeamId) {
  return {
    id: message.id,
    eventType: "delivery",
    ...(sourceTeamId === undefined ? {} : { fromTeamId: sourceTeamId }),
    ...(message.toTeamId === undefined ? {} : { toTeamId: message.toTeamId }),
    fromSessionId: message.fromSessionId,
    toSessionId: message.toSessionId,
    fromName: names.get(message.fromSessionId) ?? message.fromSessionId,
    toName: names.get(message.toSessionId) ?? message.toSessionId,
    status: message.status ?? "pending",
    createdAt: message.createdAt,
    ...(message.deliveredAt === undefined ? {} : { deliveredAt: message.deliveredAt }),
  };
}
function projectTeam(team, nameTeams = []) {
  const members = team.members.map((member) => ({
    ...clone(member),
    displayName: canonicalMemberName(member.name),
    status: member.state,
    lastActivityAt: memberLastActivityAt(member, team),
  }));
  const relatedMembers = Array.isArray(nameTeams) ? nameTeams.flatMap((candidate) => candidate.members ?? []) : [];
  const names = new Map([...relatedMembers, ...members].map((member) => [member.sessionId, canonicalMemberName(member.displayName ?? member.name)]));
  const taskTeams = Array.isArray(nameTeams) ? [...new Map([team, ...nameTeams].map((candidate) => [candidate.id, candidate])).values()] : [team];
  const tasks = team.tasks.map((task) => deriveTaskAcrossTeams(task, team, taskTeams));
  const messages = team.messages.map((message) => projectMessageEvent(message, names, team.id));
  return {
    ...clone(team),
    leadSessionId: team.rootLeadSessionId,
    objective: team.objective ?? team.name,
    status: team.state,
    revision: team.revision ?? 1,
    lastActivityAt: latestTimestamp([
      team.updatedAt,
      ...members.map((member) => member.lastActivityAt),
      ...tasks.map((task) => task.updatedAt),
      ...messages.flatMap((message) => [message.createdAt, message.deliveredAt]),
    ]) ?? team.updatedAt,
    members,
    tasks,
    // Public projections intentionally expose delivery metadata only. Durable message
    // bodies remain host-private and are used solely for the authenticated relay.
    messages,
  };
}
function boundedTeamDisplayName(value) {
  return [...nonEmptyString(value, "team display name", 200).normalize("NFKC")].slice(0, 80).join("");
}
function projectInboundEvents(team, nameTeams = []) {
  const peers = Array.isArray(nameTeams) ? nameTeams : [];
  const names = new Map([team, ...peers].flatMap((candidate) => candidate.members ?? [])
    .map((member) => [member.sessionId, canonicalMemberName(member.name)]));
  const inbound = new Map();
  for (const source of peers) {
    if (source.id === team.id) continue;
    for (const message of source.messages ?? []) {
      if (message.toTeamId !== team.id) continue;
      const event = {
        ...projectMessageEvent(message, names, source.id),
        fromTeamName: boundedTeamDisplayName(source.name),
        toTeamName: boundedTeamDisplayName(team.name),
      };
      inbound.set(`${source.id}:${message.id}`, event);
    }
  }
  return [...inbound.values()];
}
function newestFirst(left, right) {
  return Date.parse(right.updatedAt ?? right.deliveredAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.deliveredAt ?? left.createdAt ?? 0);
}
function selectUiTasks(tasks) {
  if (tasks.length <= UI_MAX_TASKS_PER_TEAM) return tasks;
  const active = tasks.filter((task) => task.state !== "completed").sort(newestFirst);
  const completed = tasks.filter((task) => task.state === "completed").sort(newestFirst);
  return [...active, ...completed].slice(0, UI_MAX_TASKS_PER_TEAM);
}
function selectUiEvents(events) {
  if (events.length <= UI_MAX_EVENTS_PER_TEAM) return events;
  return [...events].sort(newestFirst).slice(0, UI_MAX_EVENTS_PER_TEAM);
}
function projectUiTasks(team, peerTeams) {
  const visible = selectUiTasks(team.tasks);
  const localById = new Map(team.tasks.map((task) => [task.id, task]));
  const teamsById = new Map(peerTeams.map((candidate) => [candidate.id, candidate]));
  const taskMapsByTeam = new Map(peerTeams.map((candidate) => [candidate.id, new Map(candidate.tasks.map((task) => [task.id, task]))]));
  const activeByFile = new Map();
  for (const candidate of team.tasks) {
    if (candidate.state !== "in_progress") continue;
    for (const file of candidate.files ?? []) {
      const entries = activeByFile.get(file) ?? [];
      entries.push(candidate);
      activeByFile.set(file, entries);
    }
  }
  return visible.map((task) => {
    const files = task.files ?? [];
    const conflicts = new Set();
    if (task.state === "in_progress") {
      for (const file of files) for (const candidate of activeByFile.get(file) ?? []) {
        if (candidate.id !== task.id && candidate.assigneeSessionId !== task.assigneeSessionId) conflicts.add(candidate.id);
      }
    }
    const crossTeamDependencies = clone(task.crossTeamDependsOn ?? []);
    const crossReferences = crossTeamDependencies.map(crossTaskReference);
    const crossBlockedBy = crossTeamDependencies.filter((dependency) => taskMapsByTeam.get(dependency.teamId)?.get(dependency.taskId)?.state !== "completed").map(crossTaskReference);
    const dependencySources = [...new Map(crossTeamDependencies.map((dependency) => {
      const source = teamsById.get(dependency.teamId);
      return [dependency.teamId, { teamId: dependency.teamId, teamName: source?.name ?? dependency.teamId, teamStatus: source?.state ?? "unavailable" }];
    })).values()];
    const { description, files: _files, ...safeTask } = clone(task);
    return {
      ...safeTask,
      status: task.state,
      dependencies: [...task.dependsOn, ...crossReferences],
      assignee: task.assigneeSessionId ?? null,
      blockedBy: [
        ...task.dependsOn.filter((id) => localById.get(id)?.state !== "completed"),
        ...crossBlockedBy,
      ],
      conflictsWith: [...conflicts],
      crossTeamDependencies,
      dependencySources,
      // Titles are already bounded and are the only task text safe enough for a brief.
      summary: task.title,
      ...(files.length === 0 ? { fileScope: [] } : {}),
      fileScopeProjection: files.length === 0
        ? { projected: true }
        : { projected: false, reasonCode: "AGENT_TEAMS_FILE_SCOPE_NOT_SAFE_TO_PROJECT" },
    };
  });
}
function projectTeamForUi(team, nameTeams = []) {
  const peerTeams = Array.isArray(nameTeams) ? nameTeams : [];
  const names = new Map([team, ...peerTeams].flatMap((candidate) => candidate.members ?? []).map((member) => [member.sessionId, canonicalMemberName(member.name)]));
  const memberActivity = new Map(team.members.map((member) => [member.sessionId, member.updatedAt]));
  const touchMember = (sessionId, timestamp) => {
    if (!memberActivity.has(sessionId) || Date.parse(timestamp ?? 0) > Date.parse(memberActivity.get(sessionId) ?? 0)) memberActivity.set(sessionId, timestamp);
  };
  for (const task of team.tasks) if (task.assigneeSessionId !== undefined) touchMember(task.assigneeSessionId, task.updatedAt);
  for (const message of team.messages) {
    const timestamp = latestTimestamp([message.createdAt, message.deliveredAt]);
    touchMember(message.fromSessionId, timestamp);
    touchMember(message.toSessionId, timestamp);
  }
  const visibleMessages = selectUiEvents(team.messages).map((message) => projectMessageEvent(message, names, team.id));
  const rawInbound = projectInboundEvents(team, peerTeams);
  const inboundEvents = selectUiEvents(rawInbound);
  const tasks = projectUiTasks(team, peerTeams);
  const members = team.members.map((member) => ({
    id: member.id,
    sessionId: member.sessionId,
    name: member.name,
    displayName: canonicalMemberName(member.name),
    role: member.role,
    model: member.model,
    provider: member.provider,
    modelTier: member.modelTier,
    inheritsMain: member.inheritsMain,
    routeSource: member.routeSource,
    kind: member.kind,
    state: member.state,
    status: member.state,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
    lastActivityAt: memberActivity.get(member.sessionId) ?? member.updatedAt,
  }));
  const lastActivityAt = latestTimestamp([
    team.updatedAt,
    ...memberActivity.values(),
    ...team.tasks.map((task) => task.updatedAt),
    ...team.messages.flatMap((message) => [message.createdAt, message.deliveredAt]),
  ]) ?? team.updatedAt;
  return {
    id: team.id,
    rootLeadSessionId: team.rootLeadSessionId,
    name: team.name,
    objective: team.objective,
    revision: team.revision ?? 1,
    state: team.state,
    status: team.state,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    leadSessionId: team.rootLeadSessionId,
    lastActivityAt,
    taskCount: team.tasks.length,
    eventCount: team.messages.length + rawInbound.length,
    projection: {
      tasksTruncated: tasks.length < team.tasks.length,
      eventsTruncated: visibleMessages.length < team.messages.length || inboundEvents.length < rawInbound.length,
    },
    // Cross-team inbound delivery history is metadata-only; message bodies remain host-private.
    inboundEvents,
    members,
    tasks,
    messages: visibleMessages,
  };
}
function projectTeamSummary(team) {
  return {
    id: team.id,
    name: team.name,
    status: team.state,
    revision: team.revision ?? 1,
    memberCount: team.members.filter((member) => member.state !== "retired").length,
    activeTaskCount: team.tasks.filter((task) => task.state === "in_progress").length,
    pendingTaskCount: team.tasks.filter((task) => task.state === "pending").length,
    completedTaskCount: team.tasks.filter((task) => task.state === "completed").length,
    updatedAt: team.updatedAt,
  };
}
function projectTeamUiSummary(team) {
  return {
    ...projectTeamSummary(team),
    objective: team.objective.slice(0, 1_000),
    taskCount: team.tasks.length,
    eventCount: team.messages.length,
    lastActivityAt: team.updatedAt,
  };
}
function projectCrossTeamEvents(teams) {
  const names = new Map(teams.flatMap((team) => team.members).map((member) => [member.sessionId, canonicalMemberName(member.name)]));
  const teamNames = new Map(teams.map((team) => [team.id, boundedTeamDisplayName(team.name)]));
  const events = [];
  for (const team of teams) {
    for (const message of team.messages) {
      if (message.toTeamId === undefined || message.toTeamId === team.id || !teamNames.has(message.toTeamId)) continue;
      events.push({
        ...projectMessageEvent(message, names, team.id),
        fromTeamName: teamNames.get(team.id),
        toTeamName: teamNames.get(message.toTeamId),
      });
    }
  }
  return selectUiEvents(events);
}
function defaultDocument(settings = {}) {
  return {
    version: STORE_VERSION,
    settings: {
      enabled: settings.enabled ?? DEFAULT_SETTINGS.enabled,
      maxMembers: safeLimit(settings.maxMembers, "maxMembers", DEFAULT_SETTINGS.maxMembers),
      maxActiveTurns: safeLimit(settings.maxActiveTurns, "maxActiveTurns", DEFAULT_SETTINGS.maxActiveTurns),
    },
    teams: [],
  };
}

function queueStoreMutation(filePath, operation) {
  const previous = STORE_MUTATION_CHAINS.get(filePath) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  STORE_MUTATION_CHAINS.set(filePath, result.then(() => undefined, () => undefined));
  return result;
}
function queueStoreOperation(filePath, operation) {
  const previous = STORE_OPERATION_CHAINS.get(filePath) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  STORE_OPERATION_CHAINS.set(filePath, result.then(() => undefined, () => undefined));
  return result;
}
function queueTeamOperation(filePath, teamId, operation) {
  const key = `${filePath}\u0000${teamId}`;
  const previous = TEAM_OPERATION_CHAINS.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  TEAM_OPERATION_CHAINS.set(key, settled);
  void settled.then(() => {
    if (TEAM_OPERATION_CHAINS.get(key) === settled) TEAM_OPERATION_CHAINS.delete(key);
  });
  return result;
}
function queueTeamOperations(filePath, teamIds, operation) {
  let queued = operation;
  for (const teamId of [...new Set(teamIds)].sort().reverse()) {
    const next = queued;
    queued = () => queueTeamOperation(filePath, teamId, next);
  }
  return queued();
}
function registerGracefulLifecycleWaiter(childId) {
  const initialRunId = GRACEFUL_ACTIVE_RUNS.get(childId);
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  const waiter = { initialRunId, starts: [], ends: [], accepted: false, targetRunId: undefined, resolve };
  const waiters = GRACEFUL_LIFECYCLE_WAITERS.get(childId) ?? new Set();
  waiters.add(waiter);
  GRACEFUL_LIFECYCLE_WAITERS.set(childId, waiters);
  const remove = () => {
    waiters.delete(waiter);
    if (waiters.size === 0) GRACEFUL_LIFECYCLE_WAITERS.delete(childId);
  };
  const settleIfMatched = () => {
    if (!waiter.accepted) return;
    if (waiter.targetRunId !== undefined) {
      if (!waiter.ends.some((event) => event.runId === waiter.targetRunId)) return;
    } else if (waiter.ends.length === 0) return;
    remove();
    resolve();
  };
  waiter.accept = () => {
    waiter.accepted = true;
    if (waiter.initialRunId !== undefined) waiter.targetRunId = waiter.starts.at(-1) ?? waiter.initialRunId;
    else if (waiter.starts.length > 0) waiter.targetRunId = waiter.starts.at(-1);
    settleIfMatched();
  };
  waiter.start = (runId) => { waiter.starts.push(runId); };
  waiter.end = (runId) => {
    waiter.ends.push({ runId });
    if (waiter.targetRunId === runId || waiter.targetRunId === undefined) settleIfMatched();
  };
  return { promise, accept: waiter.accept, cancel: remove };
}
function waitForGracefulLifecycle(waiter, signal, timeoutMs = GRACEFUL_LIFECYCLE_TIMEOUT_MS) {
  return new Promise((resolve, rejectPromise) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      waiter.cancel();
      callback(value);
    };
    const onAbort = () => finish(rejectPromise, signal.reason ?? new HarnessError("team lifecycle wait was cancelled", "AGENT_TEAMS_CANCELLED"));
    const timer = setTimeout(() => finish(rejectPromise, new HarnessError("team member did not finish graceful retirement before the lifecycle deadline", "AGENT_TEAMS_LIFECYCLE_TIMEOUT")), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    waiter.promise.then((value) => finish(resolve, value), (error) => finish(rejectPromise, error));
  });
}
function noteGracefulLifecycleStart(info) {
  const runId = String(info.runId);
  GRACEFUL_ACTIVE_RUNS.set(info.id, runId);
  for (const waiter of GRACEFUL_LIFECYCLE_WAITERS.get(info.id) ?? []) waiter.start(runId);
}
function noteGracefulLifecycleEnd(info) {
  const runId = String(info.runId);
  if (GRACEFUL_ACTIVE_RUNS.get(info.id) === runId) GRACEFUL_ACTIVE_RUNS.delete(info.id);
  for (const waiter of GRACEFUL_LIFECYCLE_WAITERS.get(info.id) ?? []) waiter.end(runId);
}
function publishStoreDocument(filePath, document, stamp) {
  for (const instance of STORE_INSTANCES.get(filePath) ?? []) {
    // Mutations always clone before editing, so every instance can share this committed,
    // immutable-by-convention document without multiplying full-store clones.
    instance.document = document;
    if (stamp !== undefined) instance.fileStamp = stamp;
    if (instance.listeners.size === 0) continue;
    const snapshot = clone(document);
    for (const listener of instance.listeners) {
      try { listener(snapshot); } catch { /* observers never veto committed state */ }
    }
  }
}

/**
 * Durable JSON store with a single mutation chain and same-directory temp+rename commits.
 * No state escapes until its complete document has reached the atomic rename boundary.
 */
class AgentTeamsStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.document = defaultDocument(defaults);
    this.fileStamp = undefined;
    this.chain = Promise.resolve();
    this.listeners = new Set();
    const instances = STORE_INSTANCES.get(filePath) ?? new Set();
    instances.add(this);
    STORE_INSTANCES.set(filePath, instances);
  }
  async init() {
    return queueStoreOperation(this.filePath, () => queueStoreMutation(this.filePath, async () => {
    let migrated = false;
    try {
      const persisted = JSON.parse(await readFile(this.filePath, "utf8"));
      migrated = persisted?.version === LEGACY_STORE_VERSION;
      this.document = validateStoreDocument(persisted);
      this.fileStamp = await this.#currentFileStamp();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // Disabled-by-default must not create storage on mere plugin activation.
      return this.snapshot();
    }
    let changed = false;
    for (const team of this.document.teams) {
      if (team.state === "closed") continue;
      let teamChanged = false;
      for (const member of team.members) {
        if (!TRANSIENT_MEMBER_STATES.has(member.state)) continue;
        if (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true) {
          member.state = "failed";
          member.error = "host restarted before shutdown acknowledgement";
        } else {
          member.state = member.state === "provisioning" ? "failed" : "ready";
          if (member.state === "failed") member.error = "host restarted before provisioning completed";
        }
        member.runId = undefined;
        member.updatedAt = now();
        teamChanged = true;
      }
      for (const message of team.messages) {
        if (message.status !== "pending") continue;
        // Delivery has no stable inbox-id injection in the upstream API. Mark the
        // crash window uncertain instead of risking a duplicate replay.
        message.status = "failed";
        message.deliveryError = "host restarted before delivery acknowledgement; retry manually";
        teamChanged = true;
      }
      if (teamChanged) team.updatedAt = now();
      changed ||= teamChanged;
    }
    if (changed || migrated) await this.#write(this.document);
    publishStoreDocument(this.filePath, this.document, this.fileStamp);
    return this.snapshot();
    }));
  }
  snapshot() {
    return clone(this.document);
  }
  isEnabled() {
    return this.document.settings.enabled === true;
  }
  hasManagedMember(sessionId) {
    return this.document.teams.some((team) => team.state !== "closed" && memberOf(team, sessionId) !== undefined);
  }
  activeTeamsForRoot(rootSessionId) {
    return this.document.teams.filter((team) => team.rootLeadSessionId === rootSessionId && team.state === "active").map((team) => ({
      teamId: team.id,
      childIds: team.members.filter((member) => member.kind === "worker" && member.state !== "retired").map((member) => member.sessionId),
    }));
  }
  async read(reader = (document) => document) {
    await this.chain;
    return queueStoreMutation(this.filePath, () => clone(reader(this.document)));
  }
  mutate(mutator) {
    const operation = this.chain.then(() => queueStoreMutation(this.filePath, async () => {
      // Same-process instances synchronize at publication. A cheap metadata check keeps
      // explicit external recovery/test edits visible without reparsing on every event.
      await this.#refreshFromDiskIfChanged();
      const draft = clone(this.document);
      const previousTeams = new Map(this.document.teams.map((team) => [team.id, team]));
      const value = await mutator(draft);
      if (JSON.stringify(draft) === JSON.stringify(this.document)) return clone(value);
      for (const team of draft.teams) {
        const previous = previousTeams.get(team.id);
        if (previous === undefined) {
          team.revision = 1;
          continue;
        }
        const before = clone(previous);
        const after = clone(team);
        delete before.revision;
        delete after.revision;
        team.revision = JSON.stringify(before) === JSON.stringify(after) ? previous.revision ?? 1 : (previous.revision ?? 1) + 1;
      }
      validateStoreDocument(draft);
      await this.#write(draft);
      publishStoreDocument(this.filePath, draft, this.fileStamp);
      return clone(value);
    }));
    this.chain = operation.catch(() => undefined);
    return operation;
  }
  runOperation(operation) {
    return queueStoreOperation(this.filePath, operation);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async #currentFileStamp() {
    const info = await stat(this.filePath);
    return `${info.size}:${info.mtimeMs}`;
  }
  async #refreshFromDiskIfChanged() {
    let stamp;
    try { stamp = await this.#currentFileStamp(); }
    catch (error) { if (error?.code === "ENOENT") return; throw error; }
    if (stamp === this.fileStamp) return;
    const persisted = validateStoreDocument(JSON.parse(await readFile(this.filePath, "utf8")));
    this.document = persisted;
    this.fileStamp = stamp;
  }
  async #write(document) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, this.filePath);
      // Persist the directory entry where the platform permits directory fsync.
      let directory;
      try {
        directory = await open(dirname(this.filePath), "r");
        await directory.sync();
      } catch {
        // Windows commonly rejects directory handles; the file itself was fsynced.
      } finally {
        await directory?.close().catch(() => undefined);
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
    }
    this.fileStamp = await this.#currentFileStamp();
  }
}

function reject(message, code = "AGENT_TEAMS_POLICY") {
  throw new HarnessError(message, code);
}
function openTurn(agent) {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index];
    if (event?.type === "turn/end") reject("agent-team tools require an open model turn", "AGENT_TEAMS_DRIVER_REQUIRED");
    if (event?.type === "turn/start") return agent.session.events.slice(index + 1);
  }
  return reject("agent-team tools require an open model turn", "AGENT_TEAMS_DRIVER_REQUIRED");
}
function toolExecution(ctx, exec) {
  const agent = exec.agent;
  if (agent === undefined) reject("agent-team tools require a calling agent", "AGENT_TEAMS_AGENT_REQUIRED");
  if (ctx.agents.get(agent.id) !== agent || agent.status !== "running" || ctx.agents.currentInitiator() !== agent) {
    reject("agent-team tools require the exact live calling agent inside its active driver", "AGENT_TEAMS_DRIVER_REQUIRED");
  }
  return { agent, events: openTurn(agent) };
}
function requireDirectHumanRoot(ctx, execution) {
  if (!ctx.agents.roots().includes(execution.agent)) reject("team_start requires a top-level root agent");
  if (!execution.events.some((event) => event.type === "user/message" && event.data.source.kind === "user")) {
    reject("team_start requires direct host-attested human input in the current root turn");
  }
}
function relaySource(senderSessionId) {
  return {
    kind: "coordinator",
    form: "notice",
    senderSessionId,
    summary: "Agent Teams",
  };
}
function relayToLead(lead, message) {
  // followup always creates a separate ordinary turn. While the lead is already
  // running that parks every progress relay behind the current turn, so a burst
  // appears only after the lead has finished (and can even outlive team close).
  // Steering is the official in-turn coordination boundary: pending relays are
  // claimed together at the next model step without interrupting the active call.
  if (lead.status === "idle") lead.followup(message);
  else lead.steer(message);
}
function queuedTeamRelayId(message) {
  if (message?.source?.kind !== "coordinator" || message.source.summary !== "Agent Teams") return undefined;
  const text = message.content?.[0]?.type === "text" ? message.content[0].text : "";
  return /^\[Agent team message ([0-9a-f-]{36}) from /u.exec(text)?.[1];
}
function clearQueuedLeadRelays(lead, team) {
  if (!lead?.inbox || typeof lead.inbox.remove !== "function") return 0;
  const ids = new Set(team.messages.filter((message) => message.toSessionId === lead.id).map((message) => message.id));
  if (ids.size === 0) return 0;
  const pending = [...(lead.inbox.nextTurn ?? []), ...(lead.inbox.nextStep ?? [])];
  let removed = 0;
  for (const message of pending) {
    if (!ids.has(queuedTeamRelayId(message))) continue;
    if (lead.inbox.remove(message.id)) removed += 1;
  }
  return removed;
}
function textContent(text) {
  return [{ type: "text", text }];
}
function publicResult(value) {
  // Tool outputs cross a strict lossless-JSON boundary: optional projection
  // fields must be omitted rather than returned as own properties set to
  // undefined. The persisted/domain objects are already bounded plain data.
  const encoded = JSON.stringify({ ok: true, ...value });
  if (encoded === undefined) throw new TypeError("agent-team tool result is not JSON serializable");
  return JSON.parse(encoded);
}
const TOOL_OUTPUT = {
  schema: { type: "json" },
  render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
};
function present(title, rawInput) {
  return { card: "generic", title, kind: "other", ...(rawInput === undefined ? {} : { rawInput }) };
}

function findTeam(document, teamId) {
  const team = document.teams.find((candidate) => candidate.id === teamId);
  if (team === undefined) reject(`unknown team ${JSON.stringify(teamId)}`, "AGENT_TEAMS_NOT_FOUND");
  return team;
}
function memberOf(team, sessionId) {
  return team.members.find((member) => member.sessionId === sessionId);
}
function resolveMember(team, reference) {
  const value = nonEmptyString(reference, "member reference", 256);
  const direct = team.members.find((member) => member.sessionId === value || member.id === value);
  if (direct !== undefined) return direct;
  let displayNameKey;
  try { displayNameKey = memberNameKey(value); } catch { /* ids may contain non-display control characters */ }
  const matches = displayNameKey === undefined ? [] : team.members.filter((member) => memberNameKey(member.name) === displayNameKey);
  const activeMatches = matches.filter((member) => member.state !== "retired");
  if (activeMatches.length === 1) return activeMatches[0];
  if (activeMatches.length === 0 && matches.length === 1) return matches[0];
  reject(matches.length === 0 ? "unknown team member" : "team member reference is ambiguous", "AGENT_TEAMS_NOT_FOUND");
}
function authenticateParticipant(team, sessionId) {
  const member = memberOf(team, sessionId);
  if (member === undefined || ["shutting_down", "retired"].includes(member.state)) reject("caller is not an active member of this team", "AGENT_TEAMS_UNAUTHORIZED");
  return member;
}
function requireLead(team, sessionId) {
  if (team.rootLeadSessionId !== sessionId) reject("operation requires the team root lead", "AGENT_TEAMS_UNAUTHORIZED");
}
function requireLiveRootLead(ctx, team, agent) {
  requireLead(team, agent.id);
  if (ctx.agents.get(team.rootLeadSessionId) !== agent || !ctx.agents.roots().includes(agent)) {
    reject("operation requires the exact live top-level root lead", "AGENT_TEAMS_UNAUTHORIZED");
  }
}
function requireActiveTeam(team) {
  if (team.state === "paused" || USER_PAUSED_TEAMS.has(team.id)) reject("team is paused after an explicit user stop; resume it from a new direct-human turn before continuing", "AGENT_TEAMS_PAUSED");
  if (team.state !== "active") reject("team is not active", "AGENT_TEAMS_CLOSING");
}
function requireOpenTeam(team) {
  if (team.state === "closed") reject("team is closed", "AGENT_TEAMS_CLOSING");
}
function closeTeamRecord(team, reason = "team closed before delivery acknowledgement") {
  for (const message of team.messages) {
    if (message.status !== "pending") continue;
    message.status = "failed";
    message.deliveryError = reason;
  }
  team.state = "closed";
  team.updatedAt = now();
}
function exactLiveLead(ctx, team) {
  const lead = ctx.agents.get(team.rootLeadSessionId);
  if (lead === undefined || !ctx.agents.roots().includes(lead)) reject("the exact live root lead is unavailable", "AGENT_TEAMS_LEAD_UNAVAILABLE");
  return lead;
}
function activeWorkerTurns(team) {
  return team.members.filter((member) => member.kind === "worker" && ["provisioning", "running", "shutting_down"].includes(member.state)).length;
}
function activeWorkerTurnsForLead(document, rootLeadSessionId) {
  return document.teams.filter((team) => team.rootLeadSessionId === rootLeadSessionId && team.state !== "closed")
    .reduce((total, team) => total + activeWorkerTurns(team), 0);
}
function assertEnabled(document) {
  if (!document.settings.enabled) reject("agent teams are disabled; enable them in settings first", "AGENT_TEAMS_DISABLED");
}
function resolveTeamForCaller(document, teamId, sessionId) {
  let team;
  if (teamId === undefined) {
    const candidates = document.teams.filter((candidate) => candidate.state !== "closed" && memberOf(candidate, sessionId));
    if (candidates.length > 1) reject("team_id is required when the caller participates in multiple active teams", "AGENT_TEAMS_TEAM_REQUIRED");
    [team] = candidates;
  } else team = findTeam(document, teamId);
  if (team === undefined) reject("caller has no active team", "AGENT_TEAMS_NOT_FOUND");
  authenticateParticipant(team, sessionId);
  return team;
}
function requireCommonFixedLead(sourceTeam, targetTeam, sessionId) {
  if (sourceTeam.rootLeadSessionId !== targetTeam.rootLeadSessionId || sourceTeam.rootLeadSessionId !== sessionId) {
    reject("cross-team actions require the same fixed root lead to own both teams", "AGENT_TEAMS_CROSS_TEAM_FORBIDDEN");
  }
}
function registrationPrompt(teamId, memberName, role) {
  return `You are being provisioned as ${memberName} (${role}) for agent team ${teamId}. Do not begin any task in this turn. Do not infer work from prior context. Reply only that you are waiting for the coordinator registration follow-up; membership must be durably persisted before work starts.`;
}
function workPrompt(teamId, memberId, prompt) {
  return `Coordinator registration complete. Team ${teamId}; member ${memberId}. You may now begin the assigned work. Use agent-team tools for team tasks and coordinator relays. You cannot create or fork agents. If your in-progress task can be split into genuinely independent parallel outcomes, use team_expansion_request with explicit deliverables, acceptance criteria, and non-overlapping file/resource boundaries. This is only a proposal: the root coordinator decides whether to create persistent tasks and visible peer members without bypassing maxMembers or maxActiveTurns. Assignment:\n${prompt}`;
}

function validateExpansionRequestForDelivery(document, team, caller, request, { platform = process.platform } = {}) {
  const requester = authenticateParticipant(team, caller.id);
  if (requester.kind !== "worker" || !["running", "idle", "ready"].includes(requester.state)) {
    reject("team expansion requests require a current active worker", "AGENT_TEAMS_EXPANSION_WORKER_REQUIRED");
  }
  const sourceTask = team.tasks.find((task) => task.id === request.sourceTaskId);
  if (sourceTask === undefined) reject("expansion source task does not exist", "AGENT_TEAMS_NOT_FOUND");
  if (sourceTask.state !== "in_progress" || sourceTask.assigneeSessionId !== caller.id) {
    reject("expansion source task must be in progress and assigned to the requesting worker", "AGENT_TEAMS_EXPANSION_TASK_REQUIRED");
  }
  const memberSlots = Math.max(0, document.settings.maxMembers - team.members.filter(workerConsumesMemberSlot).length);
  const recordedActiveTurns = activeWorkerTurnsForLead(document, team.rootLeadSessionId);
  // Exact live tool execution attests that the requester consumes a turn even when
  // the batched subagent/start reconciler has not moved its durable state to running yet.
  const attestedActiveTurns = ["provisioning", "running", "shutting_down"].includes(requester.state) ? recordedActiveTurns : recordedActiveTurns + 1;
  const activeTurnSlots = Math.max(0, document.settings.maxActiveTurns - attestedActiveTurns);
  const taskSlots = Math.max(0, MAX_TEAM_TASKS - team.tasks.length);
  const availableWorkstreams = Math.min(memberSlots, activeTurnSlots, taskSlots, MAX_EXPANSION_WORKSTREAMS);
  if (request.workstreams.length > availableWorkstreams) {
    reject(`expansion request needs ${request.workstreams.length} slots but only ${availableWorkstreams} are currently available`, "AGENT_TEAMS_EXPANSION_CAPACITY");
  }
  const activeFileOwners = [];
  for (const task of team.tasks) {
    // The request explicitly splits this parent task. Comparing the proposed child
    // scopes against it would make every useful split of a broad parent impossible.
    // The root must release/restructure that parent scope before peers start.
    if (task.state !== "in_progress" || task.id === sourceTask.id) continue;
    for (const file of task.files ?? []) activeFileOwners.push({ file, taskId: task.id });
  }
  for (const workstream of request.workstreams) for (const file of workstream.files) {
    const owner = activeFileOwners.find((candidate) => fileBoundaryOverlap(candidate.file, file, { platform }));
    if (owner !== undefined) {
      reject(`proposed file boundary ${JSON.stringify(file)} overlaps boundary ${JSON.stringify(owner.file)} of in-progress task ${owner.taskId}`, "AGENT_TEAMS_EXPANSION_CONFLICT");
    }
  }
  return {
    sourceTask,
    requester,
    capacity: { memberSlots, activeTurnSlots, taskSlots, availableWorkstreams },
  };
}
function expansionRequestRelayBody(request) {
  return [
    `[Structured agent-team expansion request ${request.id}]`,
    JSON.stringify({
      requestId: request.id,
      sourceTaskId: request.sourceTaskId,
      sourceTaskTitle: request.sourceTaskTitle,
      requestedBy: request.requestedBy,
      parallelBenefit: request.parallelBenefit,
      workstreams: request.workstreams,
      capacity: request.capacity,
      requestedAt: request.requestedAt,
    }, null, 2),
    "This is a proposal, never an automatic spawn instruction. Approve only genuinely independent work with clear acceptance and non-conflicting ownership when critical-path or independent-review benefit exceeds coordination cost. The Host checks proposed file scopes against other in-progress task files, but it does not persist or verify existing external-resource ownership; the root must verify that state. If approving a split from a broad parent task, first release/restructure that parent so its in-progress file scope no longer overlaps, then create one durable task for every accepted workstream, and only then spawn visible same-level peer members. Never create a nested or hidden worker. If rejecting, tell the requester why.",
  ].join("\n");
}
async function submitExpansionRequest(ctx, store, caller, input, signal) {
  const teamId = optionalString(input.teamId, "teamId", 256);
  const normalized = normalizeExpansionRequest(input);
  const identity = await store.read((document) => {
    const team = resolveTeamForCaller(document, teamId, caller.id);
    const requester = authenticateParticipant(team, caller.id);
    if (requester.kind !== "worker" || !["running", "idle", "ready"].includes(requester.state)) {
      reject("team expansion requests require a current active worker", "AGENT_TEAMS_EXPANSION_WORKER_REQUIRED");
    }
    return { teamId: team.id, rootLeadSessionId: team.rootLeadSessionId };
  });
  const requestId = randomUUID();
  const requestedAt = now();
  return sendTeamMessage(ctx, store, caller, {
    teamId: identity.teamId,
    recipientSessionId: identity.rootLeadSessionId,
    prepareMessage(document, sourceTeam, targetTeam, recipient) {
      if (targetTeam !== sourceTeam || recipient.sessionId !== sourceTeam.rootLeadSessionId || recipient.kind !== "lead") {
        reject("expansion request must target the fixed root lead", "AGENT_TEAMS_UNAUTHORIZED");
      }
      const checked = validateExpansionRequestForDelivery(document, sourceTeam, caller, normalized);
      const request = {
        id: requestId,
        teamId: sourceTeam.id,
        sourceTaskId: checked.sourceTask.id,
        sourceTaskTitle: checked.sourceTask.title,
        requestedBy: { memberId: checked.requester.id, name: checked.requester.name },
        parallelBenefit: normalized.parallelBenefit,
        workstreams: normalized.workstreams,
        capacity: checked.capacity,
        requestedAt,
      };
      return { message: expansionRequestRelayBody(request), result: { expansionRequest: request } };
    },
  }, signal);
}

async function createTeam(store, lead, input) {
  const mainSelection = await resolveModelSelection(store, "main", undefined, lead.options);
  return store.mutate((document) => {
    assertEnabled(document);
    const openTeams = document.teams.filter((team) => team.rootLeadSessionId === lead.id && team.state !== "closed").length;
    if (openTeams >= HARD_MAX_TEAMS_PER_ROOT) reject(`root lead peer-team limit reached (${HARD_MAX_TEAMS_PER_ROOT})`, "AGENT_TEAMS_TEAM_LIMIT");
    const timestamp = now();
    const objective = nonEmptyString(input.objective ?? input.name ?? "Agent team", "objective", 16_384);
    const team = {
      id: randomUUID(),
      rootLeadSessionId: lead.id,
      name: nonEmptyString(input.name ?? objective.slice(0, 500), "name", 500),
      objective,
      state: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      members: [{
        id: `lead:${lead.id}`,
        sessionId: lead.id,
        name: normalizeMemberName(input.leadName ?? "Lead", "leadName"),
        role: "root lead and coordinator",
        ...mainSelection,
        kind: "lead",
        state: "running",
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      tasks: [],
      messages: [],
    };
    document.teams.push(team);
    return projectTeam(team);
  });
}

async function settleSpawnedChildFailure(ctx, store, lead, cleanup) {
  const childIdUsedElsewhere = await store.read((document) => document.teams.some((team) => team.members.some((member) => member.id !== cleanup.memberId && member.sessionId === cleanup.childId)));
  if (childIdUsedElsewhere) {
    await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, cleanup.teamId);
      const record = team.members.find((candidate) => candidate.id === cleanup.memberId);
      if (record !== undefined) {
        confirmMemberRetired(record);
        record.error = "publication rejected because the returned child id already belongs to another member; existing child was not drained";
        team.updatedAt = record.updatedAt;
      }
    }));
    return { drainSkipped: true };
  }
  let drainError;
  try {
    await ctx.subagents.drainContinuableChildren(lead, [cleanup.childId]);
  } catch (error) {
    drainError = error;
  }
  await store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, cleanup.teamId);
    const record = team.members.find((candidate) => candidate.id === cleanup.memberId);
    if (record === undefined) return;
    const childIdUsedElsewhere = document.teams.some((candidate) => candidate.members.some((member) => member.id !== record.id && member.sessionId === cleanup.childId));
    if (!childIdUsedElsewhere) record.sessionId = cleanup.childId;
    record.state = "failed";
    record.runId = undefined;
    record.updatedAt = now();
    const failure = cleanup.phase === "publication" ? "publication failed after child creation" : "initial work followup failed after child became live";
    if (drainError === undefined) {
      record.shutdownUnconfirmed = false;
      record.stopUnconfirmed = false;
      record.error = `${failure} after confirmed drain: ${String(cleanup.cause)}`;
    } else {
      record.shutdownUnconfirmed = true;
      record.stopUnconfirmed = true;
      record.error = `${failure}: ${String(cleanup.cause)}; cleanup drain failed: ${String(drainError)}`;
    }
    team.updatedAt = record.updatedAt;
  }));
  return drainError;
}
async function spawnMember(ctx, store, lead, input, signal) {
  const modelSelection = await resolveModelSelection(store, input.modelTier ?? "subagent", input.model, lead.options);
  const reservation = await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    requireLiveRootLead(ctx, team, lead);
    if (team.state !== "active") reject("team is not accepting new members", "AGENT_TEAMS_CLOSING");
    if (team.members.filter(workerConsumesMemberSlot).length >= document.settings.maxMembers) reject("team teammate limit reached", "AGENT_TEAMS_MEMBER_LIMIT");
    if (activeWorkerTurnsForLead(document, team.rootLeadSessionId) >= document.settings.maxActiveTurns) reject("root lead active-turn limit reached across its teams", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
    const memberName = normalizeWorkerName(input.name);
    const memberNameIdentity = memberNameKey(memberName);
    if (team.members.some((member) => memberNameKey(member.name) === memberNameIdentity)) reject("a team member already uses this normalized display name", "AGENT_TEAMS_DUPLICATE_MEMBER_NAME");
    const timestamp = now();
    const memberId = randomUUID();
    const reservation = { teamId: team.id, memberId, placeholderSessionId: `provisioning:${memberId}`, name: memberName, role: nonEmptyString(input.role, "role", 500), prompt: nonEmptyString(input.prompt, "prompt", 65_536), ...modelSelection };
    team.members.push({ id: memberId, sessionId: reservation.placeholderSessionId, name: reservation.name, role: reservation.role, ...(reservation.model === undefined ? {} : { model: reservation.model }), ...(reservation.provider === undefined ? {} : { provider: reservation.provider }), modelTier: reservation.modelTier, inheritsMain: reservation.inheritsMain, routeSource: reservation.routeSource, kind: "worker", state: "provisioning", createdAt: timestamp, updatedAt: timestamp });
    team.updatedAt = timestamp;
    return reservation;
  }));
  return queueTeamOperation(store.filePath, reservation.teamId, async () => {
    const admitted = await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const record = team.members.find((candidate) => candidate.id === reservation.memberId);
      if (team.state === "active" && record?.sessionId === reservation.placeholderSessionId && record.state === "provisioning") return true;
      if (record !== undefined) {
        confirmMemberRetired(record);
        team.updatedAt = record.updatedAt;
      }
      return false;
    }));
    if (!admitted) reject("team stopped accepting members before provisioning started", "AGENT_TEAMS_CLOSING");
    let started;
    try {
      started = await ctx.subagents.startContinuable({
        provider: "spawn",
        label: reservation.name,
        request: {
          parent: lead,
          prompt: textContent(registrationPrompt(reservation.teamId, reservation.name, reservation.role)),
          toolFilter: { deny: [...MANAGED_MEMBER_DENIED_TOOLS] },
          ...(reservation.provider === undefined && reservation.model === undefined ? {} : { agentOptions: { ...(reservation.provider === undefined ? {} : { provider: reservation.provider }), ...(reservation.model === undefined ? {} : { model: reservation.model }) } }),
        },
        signal,
      });
    } catch (error) {
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, reservation.teamId);
        team.members = team.members.filter((candidate) => candidate.id !== reservation.memberId);
        team.updatedAt = now();
      }));
      throw new HarnessError(`member provisioning failed before publication: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED");
    }
    let publication;
    try {
      publication = await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, reservation.teamId);
        const record = team.members.find((candidate) => candidate.id === reservation.memberId);
        const sessionAlreadyRegistered = document.teams.some((candidate) => candidate.members.some((candidateMember) => candidateMember.id !== reservation.memberId && candidateMember.sessionId === started.childId));
        if (record !== undefined && record.sessionId === reservation.placeholderSessionId && sessionAlreadyRegistered) {
          confirmMemberRetired(record);
          record.error = "publication rejected because the returned child id already belongs to another member; existing child was not drained";
          team.updatedAt = record.updatedAt;
          return { duplicateChildId: true };
        }
        if (team.state !== "active" || record === undefined || record.sessionId !== reservation.placeholderSessionId || record.state !== "provisioning") reject("team changed during member provisioning", "AGENT_TEAMS_CONFLICT");
        record.sessionId = started.childId;
        record.updatedAt = now();
        team.updatedAt = record.updatedAt;
        return { duplicateChildId: false, member: clone(record) };
      }));
    } catch (error) {
      const cleanup = { phase: "publication", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause: error };
      await settleSpawnedChildFailure(ctx, store, lead, cleanup);
      throw new HarnessError(`member publication failed after child creation: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED");
    }
    if (publication.duplicateChildId) reject("subagent provider returned a child id already owned by another member", "AGENT_TEAMS_CONFLICT");
    const member = publication.member;
    try {
      await ctx.subagents.followup(lead, started.childId, textContent(workPrompt(reservation.teamId, reservation.memberId, reservation.prompt)), { source: relaySource(lead.id), signal });
    } catch (error) {
      await settleSpawnedChildFailure(ctx, store, lead, { phase: "work-followup", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause: error });
      throw error;
    }
    return store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const current = memberOf(team, started.childId);
      if (current !== undefined && current.state === "provisioning") {
        current.state = "running";
        current.updatedAt = now();
        team.updatedAt = current.updatedAt;
      }
      return { teamId: team.id, member: clone(current ?? member) };
    }));
  });
}

async function sendTeamMessage(ctx, store, caller, input, signal) {
  const teamIds = await store.read((document) => {
    const sourceTeam = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    const targetTeamId = optionalString(input.targetTeamId, "targetTeamId", 256);
    return [sourceTeam.id, targetTeamId ?? sourceTeam.id];
  });
  return queueTeamOperations(store.filePath, teamIds, () => sendTeamMessageUnlocked(ctx, store, caller, input, signal));
}
async function sendTeamMessageUnlocked(ctx, store, caller, input, signal) {
  const prepared = await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const sourceTeam = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    requireActiveTeam(sourceTeam);
    const targetTeamId = optionalString(input.targetTeamId, "targetTeamId", 256);
    let targetTeam = sourceTeam;
    if (targetTeamId !== undefined && targetTeamId !== sourceTeam.id) {
      const candidate = document.teams.find((team) => team.id === targetTeamId);
      if (candidate === undefined) reject("cross-team target is unavailable to this fixed root lead", "AGENT_TEAMS_CROSS_TEAM_FORBIDDEN");
      requireCommonFixedLead(sourceTeam, candidate, caller.id);
      requireLiveRootLead(ctx, sourceTeam, caller);
      targetTeam = candidate;
    }
    requireActiveTeam(targetTeam);
    const recipient = resolveMember(targetTeam, input.recipientSessionId ?? input.recipient);
    authenticateParticipant(targetTeam, recipient.sessionId);
    const recipientId = recipient.sessionId;
    if (recipient.sessionId === caller.id) reject("cannot relay a team message to self", "AGENT_TEAMS_INVALID_MESSAGE");
    let deliveryBody;
    let persistedBody;
    let result;
    if (typeof input.prepareMessage === "function") {
      if (input.memoryPack !== undefined || input.message !== undefined) throw new TypeError("prepared team messages cannot include a raw message or memory pack");
      const preparedMessage = input.prepareMessage(document, sourceTeam, targetTeam, recipient);
      if (!isRecord(preparedMessage)) throw new TypeError("prepared team message must be an object");
      deliveryBody = nonEmptyString(preparedMessage.message, "prepared message", 65_536);
      persistedBody = deliveryBody;
      if (preparedMessage.result !== undefined) {
        if (!isRecord(preparedMessage.result)) throw new TypeError("prepared team message result must be an object");
        result = clone(preparedMessage.result);
      }
    } else {
      deliveryBody = nonEmptyString(input.message, "message", 65_536);
      persistedBody = deliveryBody;
    }
    if (input.memoryPack !== undefined) {
      if (targetTeam !== sourceTeam) reject("memory packs cannot cross team boundaries", "AGENT_TEAMS_CROSS_TEAM_FORBIDDEN");
      requireLiveRootLead(ctx, sourceTeam, caller);
      const taskId = nonEmptyString(input.memoryPack.taskId, "memoryPack.taskId", 256);
      const task = sourceTeam.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined || !["pending", "in_progress"].includes(task.state)) reject("memory pack task is unavailable", "AGENT_TEAMS_INVALID_TASK");
      if (task.assigneeSessionId !== recipient.sessionId) reject("memory pack recipient must be the task assignee", "AGENT_TEAMS_FORBIDDEN");
      deliveryBody = nonEmptyString(input.message, "memory pack content", 1_200);
      const expiresAt = nonEmptyString(input.memoryPack.expiresAt, "memoryPack.expiresAt", 64);
      const expiresMs = Date.parse(expiresAt);
      const currentMs = Date.parse(now());
      if (!Number.isFinite(expiresMs) || expiresMs <= currentMs || expiresMs > currentMs + 30 * 60 * 1_000) reject("memory pack expiry must be within the next 30 minutes", "AGENT_TEAMS_INVALID_MESSAGE");
      persistedBody = `[ephemeral memory pack omitted: task=${task.id}; expires=${new Date(expiresMs).toISOString()}]`;
      deliveryBody = `[Ephemeral Memory Pack for task ${task.id}; expires ${new Date(expiresMs).toISOString()}]\n${deliveryBody}`;
    }
    if (recipient.kind === "worker" && ["ready", "idle"].includes(recipient.state)) {
      if (activeWorkerTurnsForLead(document, targetTeam.rootLeadSessionId) >= document.settings.maxActiveTurns) reject("root lead active-turn limit reached across its teams", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
      recipient.state = "running";
      recipient.updatedAt = now();
      targetTeam.updatedAt = recipient.updatedAt;
    }
    const message = {
      id: randomUUID(),
      fromSessionId: caller.id,
      toSessionId: recipientId,
      ...(targetTeam === sourceTeam ? {} : { toTeamId: targetTeam.id }),
      body: persistedBody,
      status: "pending",
      createdAt: now(),
    };
    sourceTeam.messages.push(message);
    if (sourceTeam.messages.length > MAX_TEAM_MESSAGES) {
      const removable = sourceTeam.messages.findIndex((candidate) => candidate.status !== "pending");
      sourceTeam.messages.splice(removable < 0 ? 0 : removable, 1);
    }
    sourceTeam.updatedAt = message.createdAt;
    return {
      teamId: sourceTeam.id,
      targetTeamId: targetTeam.id,
      leadId: sourceTeam.rootLeadSessionId,
      sender: clone(memberOf(sourceTeam, caller.id)),
      recipient: clone(recipient),
      message,
      deliveryBody,
      ...(result === undefined ? {} : { result }),
    };
  }));
  try {
    const targetTeam = await store.read((document) => findTeam(document, prepared.targetTeamId));
    const lead = exactLiveLead(ctx, targetTeam);
    const content = textContent(`[Agent team message ${prepared.message.id} from ${prepared.sender?.name ?? caller.id}]\n${prepared.deliveryBody}`);
    if (prepared.recipient.kind === "lead") {
      relayToLead(lead, createUserMessage({ content, source: relaySource(caller.id) }));
    } else {
      await ctx.subagents.followup(lead, prepared.recipient.sessionId, content, { source: relaySource(caller.id), signal });
    }
    return store.runOperation(() => store.mutate((document) => {
      const currentTeam = findTeam(document, prepared.teamId);
      const currentTarget = findTeam(document, prepared.targetTeamId);
      const message = currentTeam.messages.find((candidate) => candidate.id === prepared.message.id);
      const names = new Map([...currentTeam.members, ...currentTarget.members].map((member) => [member.sessionId, canonicalMemberName(member.name)]));
      const event = () => message === undefined ? undefined : projectMessageEvent(message, names, currentTeam.id);
      if (currentTeam.state === "closed") return { teamId: currentTeam.id, targetTeamId: currentTarget.id, message: event(), ...(prepared.result ?? {}) };
      if (message !== undefined) {
        message.status = "delivered";
        message.deliveredAt = now();
        message.deliveryError = undefined;
      }
      currentTeam.updatedAt = now();
      return { teamId: currentTeam.id, targetTeamId: currentTarget.id, message: event(), ...(prepared.result ?? {}) };
    }));
  } catch (error) {
    await store.runOperation(() => store.mutate((document) => {
      const currentTeam = findTeam(document, prepared.teamId);
      const message = currentTeam.messages.find((candidate) => candidate.id === prepared.message.id);
      if (currentTeam.state === "closed") return { teamId: currentTeam.id, message };
      if (message !== undefined) {
        message.status = "failed";
        message.deliveryError = String(error).slice(0, 4_096);
      }
      const currentTarget = findTeam(document, prepared.targetTeamId);
      const recipient = memberOf(currentTarget, prepared.recipient.sessionId);
      if (recipient?.state === "running" && recipient.runId === undefined) recipient.state = "ready";
      currentTarget.updatedAt = now();
      currentTeam.updatedAt = currentTarget.updatedAt;
    }));
    throw error;
  }
}

async function createTask(store, caller, input) {
  return store.mutate((document) => {
    assertEnabled(document);
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    requireActiveTeam(team);
    if (team.tasks.length >= MAX_TEAM_TASKS) reject("team task limit reached", "AGENT_TEAMS_TASK_LIMIT");
    const dependsOn = input.dependsOn ?? [];
    const crossTeamDependsOnInput = input.crossTeamDependsOn ?? [];
    const files = input.files ?? [];
    assertStringArray(dependsOn, "dependsOn");
    assertStringArray(crossTeamDependsOnInput, "crossTeamDependsOn");
    assertStringArray(files, "files");
    const known = new Set(team.tasks.map((task) => task.id));
    if (dependsOn.some((id) => !known.has(id))) reject("task dependency does not exist in this team", "AGENT_TEAMS_INVALID_TASK");
    const crossTeamDependsOn = [...new Map(crossTeamDependsOnInput.map((reference) => {
      const dependency = parseCrossTaskReference(reference);
      return [taskNodeKey(dependency.teamId, dependency.taskId), dependency];
    })).values()];
    for (const dependency of crossTeamDependsOn) {
      const target = document.teams.find((candidate) => candidate.id === dependency.teamId);
      if (target === undefined || target.id === team.id) reject("cross-team dependency must identify a peer team", "AGENT_TEAMS_INVALID_TASK");
      requireCommonFixedLead(team, target, caller.id);
      if (target.tasks.every((candidate) => candidate.id !== dependency.taskId)) reject("cross-team task dependency does not exist", "AGENT_TEAMS_INVALID_TASK");
    }
    const assigneeReference = optionalString(input.assigneeSessionId, "assigneeSessionId", 256);
    const assigneeSessionId = assigneeReference === undefined ? undefined : resolveMember(team, assigneeReference).sessionId;
    if (assigneeSessionId !== undefined) {
      authenticateParticipant(team, assigneeSessionId);
      if (caller.id !== team.rootLeadSessionId && assigneeSessionId !== caller.id) reject("only the lead can assign a new task to another member", "AGENT_TEAMS_UNAUTHORIZED");
    }
    const timestamp = now();
    const task = {
      id: randomUUID(),
      title: nonEmptyString(input.title, "title", 500),
      ...(optionalString(input.description, "description", 32_768) === undefined ? {} : { description: input.description.trim() }),
      state: "pending",
      dependsOn: [...new Set(dependsOn)],
      ...(crossTeamDependsOn.length === 0 ? {} : { crossTeamDependsOn }),
      files: [...new Set(files.map((file) => nonEmptyString(file, "files item", 1_024)))],
      ...(assigneeSessionId === undefined ? {} : { assigneeSessionId }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    team.tasks.push(task);
    team.updatedAt = timestamp;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
  });
}

async function updateTask(store, caller, input) {
  return store.mutate((document) => {
    assertEnabled(document);
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    requireActiveTeam(team);
    const task = team.tasks.find((candidate) => candidate.id === nonEmptyString(input.taskId, "taskId", 256));
    if (task === undefined) reject("unknown team task", "AGENT_TEAMS_NOT_FOUND");
    const requestedState = optionalString(input.state, "state", 32);
    if (requestedState !== undefined) assertEnum(requestedState, TASK_STATES, "state");
    if (input.action === undefined && requestedState === undefined) reject("task update requires action or state", "AGENT_TEAMS_INVALID_TASK");
    const action = input.action ?? (requestedState === "in_progress" ? "claim" : requestedState === "completed" ? "complete" : task.state === "completed" ? "reopen" : "release");
    assertEnum(action, ["claim", "release", "complete", "reopen", "assign", "unassign"], "action");
    const blockedBy = deriveTaskAcrossTeams(task, team, document.teams).blockedBy;
    const isLead = caller.id === team.rootLeadSessionId;
    if (action === "claim") {
      if (task.state === "in_progress" && task.assigneeSessionId === caller.id) {
        // A retried claim by the same claimant is a safe idempotent no-op: the caller
        // already holds this task, so neither blocks nor timestamps are re-evaluated.
        return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
      }
      if (task.state !== "pending") reject(`only a pending task can be claimed (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (task.assigneeSessionId !== undefined && task.assigneeSessionId !== caller.id) reject("task is assigned to another team member", "AGENT_TEAMS_UNAUTHORIZED");
      if (blockedBy.length > 0) reject(`task is blocked by: ${blockedBy.join(", ")}`, "AGENT_TEAMS_TASK_BLOCKED");
      task.state = "in_progress";
      task.assigneeSessionId = caller.id;
      task.claimedAt = now();
      task.completedAt = undefined;
    } else if (action === "complete") {
      if (task.state !== "in_progress") reject(`only an in-progress task can be completed (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (!isLead && task.assigneeSessionId !== caller.id) reject("only the task claimant or team lead can complete it", "AGENT_TEAMS_UNAUTHORIZED");
      if (blockedBy.length > 0) reject(`task is blocked by: ${blockedBy.join(", ")}`, "AGENT_TEAMS_TASK_BLOCKED");
      task.state = "completed";
      task.completedAt = now();
    } else if (action === "release") {
      if (task.state !== "in_progress") reject(`only an in-progress task can be released (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (!isLead && task.assigneeSessionId !== caller.id) reject("only the task claimant or team lead can release it", "AGENT_TEAMS_UNAUTHORIZED");
      task.state = "pending";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      task.completedAt = undefined;
    } else if (action === "reopen") {
      if (!isLead) reject("only the team lead can reopen a task", "AGENT_TEAMS_UNAUTHORIZED");
      if (task.state !== "completed") reject(`only a completed task can be reopened (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      const progressed = progressedDependents(document, team.id, task.id);
      if (progressed.length > 0) reject(`cannot reopen a prerequisite used by progressed tasks: ${progressed.join(", ")}`, "AGENT_TEAMS_TASK_CONFLICT");
      task.state = "pending";
      task.completedAt = undefined;
      task.claimedAt = undefined;
    } else if (action === "assign") {
      if (!isLead) reject("only the team lead can assign a task", "AGENT_TEAMS_UNAUTHORIZED");
      const assignee = resolveMember(team, input.assigneeSessionId).sessionId;
      authenticateParticipant(team, assignee);
      if (task.assigneeSessionId === assignee && (task.state === "pending" || task.state === "in_progress")) {
        // Re-assigning the current holder (a pending pre-assignment or an in-progress
        // claimant) is a safe idempotent no-op; a retried assign never switches holders.
        return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
      }
      if (task.state !== "pending") reject(`only a pending task can be assigned (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      task.assigneeSessionId = assignee;
    } else {
      if (!isLead) reject("only the team lead can unassign a task", "AGENT_TEAMS_UNAUTHORIZED");
      if (task.state !== "pending") reject(`only a pending task can be unassigned (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      task.assigneeSessionId = undefined;
    }
    task.updatedAt = now();
    team.updatedAt = task.updatedAt;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
  });
}

function markMemberShuttingDown(member, force) {
  member.state = "shutting_down";
  if (force) {
    member.shutdownUnconfirmed = true;
    member.stopUnconfirmed = true;
  }
  member.updatedAt = now();
}
function confirmMemberRetired(member) {
  member.state = "retired";
  member.shutdownUnconfirmed = undefined;
  member.stopUnconfirmed = undefined;
  member.runId = undefined;
  member.error = undefined;
  member.updatedAt = now();
}
function resetTaskStoppedAfter(task, stoppedAt) {
  const completedAfterStop = task.state === "completed" && typeof task.completedAt === "string" && task.completedAt >= stoppedAt;
  if (task.state !== "in_progress" && !completedAfterStop) return;
  task.state = "pending";
  task.claimedAt = undefined;
  task.completedAt = undefined;
  task.updatedAt = stoppedAt;
}
async function pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt) {
  const teamIds = new Set(selections.map((entry) => entry.teamId));
  const childIds = [...new Set(selections.flatMap((entry) => entry.childIds))];
  await store.runOperation(() => store.mutate((document) => {
    for (const team of document.teams) {
      if (!teamIds.has(team.id) || team.rootLeadSessionId !== lead.id || team.state === "closed") continue;
      team.state = "paused";
      for (const task of team.tasks) resetTaskStoppedAfter(task, stoppedAt);
      for (const member of team.members) {
        if (member.kind !== "worker" || member.state === "retired") continue;
        member.state = "shutting_down";
        member.updatedAt = stoppedAt;
      }
      team.updatedAt = stoppedAt;
    }
  }));
  let drainError;
  try { await ctx.subagents.drainContinuableChildren(lead, childIds); }
  catch (error) { drainError = error; }
  await store.runOperation(() => store.mutate((document) => {
    for (const team of document.teams) {
      if (!teamIds.has(team.id) || team.state !== "paused") continue;
      for (const member of team.members) {
        if (member.kind !== "worker" || member.state === "retired") continue;
        member.state = drainError === undefined ? "ready" : "failed";
        member.runId = undefined;
        member.shutdownUnconfirmed = drainError === undefined ? undefined : true;
        member.stopUnconfirmed = drainError === undefined ? undefined : true;
        member.error = drainError === undefined ? undefined : `user stop could not confirm member quiescence: ${String(drainError)}`;
        member.updatedAt = now();
      }
      team.updatedAt = now();
    }
  }));
}
async function resumePausedTeam(ctx, store, lead, input) {
  const teamId = nonEmptyString(input.teamId, "teamId", 256);
  const result = await store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, teamId);
    requireLiveRootLead(ctx, team, lead);
    if (team.state !== "paused") reject("team is not paused", "AGENT_TEAMS_CONFLICT");
    if (team.members.some((member) => member.kind === "worker" && member.state === "shutting_down")) reject("team members are still stopping; retry resume after they become ready", "AGENT_TEAMS_CONFLICT");
    team.state = "active";
    team.updatedAt = now();
    return { teamId: team.id, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)) };
  }));
  USER_PAUSED_TEAMS.delete(teamId);
  return result;
}

async function retireMember(ctx, store, lead, input, signal) {
  const force = input.force === true;
  const prepared = await store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    requireLiveRootLead(ctx, team, lead);
    requireOpenTeam(team);
    const member = resolveMember(team, input.memberSessionId);
    if (member.kind !== "worker") reject("unknown worker member", "AGENT_TEAMS_NOT_FOUND");
    if (member.state === "retired") return { teamId: team.id, member: clone(member), noop: true };
    markMemberShuttingDown(member, force);
    team.updatedAt = member.updatedAt;
    return { teamId: team.id, member: clone(member), noop: false };
  }));
  if (prepared.noop) return prepared;
  const gracefulWaiter = force ? undefined : registerGracefulLifecycleWaiter(prepared.member.sessionId);
  try {
    if (force) await ctx.subagents.drainContinuableChildren(lead, [prepared.member.sessionId]);
    else {
      await ctx.subagents.followup(lead, prepared.member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
        source: relaySource(lead.id), signal,
      });
      gracefulWaiter.accept();
      await waitForGracefulLifecycle(gracefulWaiter, signal);
    }
  } catch (error) {
    gracefulWaiter?.cancel();
    await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, prepared.teamId);
      if (team.state === "closed") return;
      const member = memberOf(team, prepared.member.sessionId);
      if (member !== undefined && member.state !== "retired") {
        member.state = "failed";
        member.shutdownUnconfirmed = true;
        member.stopUnconfirmed = true;
        member.error = `retirement request failed: ${String(error)}`;
        member.updatedAt = now();
        team.updatedAt = member.updatedAt;
      }
    })).catch(() => {});
    throw error;
  }
  return store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, prepared.teamId);
    const member = memberOf(team, prepared.member.sessionId);
    if (member !== undefined && team.state !== "closed") {
      confirmMemberRetired(member);
      team.updatedAt = member.updatedAt;
    }
    if (member === undefined) reject("unknown worker member", "AGENT_TEAMS_NOT_FOUND");
    return { teamId: team.id, member: clone(member) };
  }));
}

async function shutdownTeam(ctx, store, lead, input, signal) {
  const teamId = nonEmptyString(input.teamId, "teamId", 256);
  if (input.memberSessionId !== undefined && input.memberSessionId !== "") {
    return queueTeamOperation(store.filePath, teamId, () => retireMember(ctx, store, lead, input, signal));
  }
  const force = input.force === true;
  const prepared = await queueTeamOperation(store.filePath, teamId, () => store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, teamId);
    requireLiveRootLead(ctx, team, lead);
    requireActiveTeam(team);
    team.state = "closing";
    const workers = team.members.filter((member) => member.kind === "worker" && member.state !== "retired");
    for (const member of workers) markMemberShuttingDown(member, force);
    team.updatedAt = now();
    return { teamId: team.id, workers: workers.map((member) => clone(member)) };
  })));

  let drainError;
  let outcomes = [];
  if (force) {
    try {
      await ctx.subagents.drainContinuableChildren(lead, prepared.workers.map((member) => member.sessionId));
    } catch (error) {
      drainError = error;
    }
  } else {
    const gracefulRequests = prepared.workers.map((member) => ({ member, waiter: registerGracefulLifecycleWaiter(member.sessionId) }));
    outcomes = await Promise.allSettled(gracefulRequests.map(async ({ member, waiter }) => {
      try {
        await ctx.subagents.followup(lead, member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
          source: relaySource(lead.id), signal,
        });
        waiter.accept();
        await waitForGracefulLifecycle(waiter, signal);
      } catch (error) {
        waiter.cancel();
        throw error;
      }
    }));
  }

  const result = await queueTeamOperation(store.filePath, prepared.teamId, () => store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, prepared.teamId);
    if (team.state === "closed") return { team: projectTeam(team), failures: [] };
    const failures = [];
    if (force) {
      for (const preparedMember of prepared.workers) {
        const member = memberOf(team, preparedMember.sessionId);
        if (member === undefined) continue;
        if (drainError === undefined) {
          confirmMemberRetired(member);
          continue;
        }
        if (member.state !== "retired") {
          member.state = "failed";
          member.error = `retirement drain failed: ${String(drainError)}`;
          member.updatedAt = now();
        }
      }
      if (drainError !== undefined) failures.push(String(drainError));
    } else {
      outcomes.forEach((outcome, index) => {
        const member = memberOf(team, prepared.workers[index].sessionId);
        if (outcome.status === "fulfilled") {
          if (member !== undefined) confirmMemberRetired(member);
          return;
        }
        failures.push(String(outcome.reason));
        if (member !== undefined && member.state !== "retired") {
          member.state = "failed";
          member.shutdownUnconfirmed = true;
          member.stopUnconfirmed = true;
          member.error = `retirement request failed: ${String(outcome.reason)}`;
          member.updatedAt = now();
        }
      });
    }
    const shouldClose = failures.length === 0 && team.members.filter((member) => member.kind === "worker").every((member) => member.state === "retired");
    if (shouldClose) closeTeamRecord(team);
    else {
      team.state = failures.length === 0 ? "closing" : "active";
      team.updatedAt = now();
    }
    return { team: projectTeam(team), failures };
  })));
  if (result.team.state === "closed") clearQueuedLeadRelays(lead, result.team);
  return result;
}

async function recoverOrphanTeams(ctx, store, caller, input) {
  requireDirectHumanRoot(ctx, caller);
  return store.runOperation(() => store.mutate((document) => {
    const requestedId = optionalString(input.teamId, "teamId", 256);
    const candidates = document.teams.filter((team) => {
      if (team.state === "closed" || requestedId !== undefined && team.id !== requestedId) return false;
      const agent = ctx.agents.get(team.rootLeadSessionId);
      return agent === undefined || !ctx.agents.roots().includes(agent);
    });
    if (requestedId !== undefined && candidates.length === 0) reject("the requested team is not orphaned or does not exist", "AGENT_TEAMS_NOT_FOUND");
    if (input.confirm !== true) return { candidates: candidates.map(projectTeam), recovered: [] };
    const recovered = [];
    for (const team of candidates) {
      const shutdownUnconfirmed = team.members.some((member) => member.kind === "worker" && (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true));
      const unsafe = shutdownUnconfirmed || team.members.some((member) => member.kind === "worker" && ["provisioning", "running", "shutting_down"].includes(member.state));
      if (unsafe) {
        if (requestedId !== undefined) reject(shutdownUnconfirmed ? "orphan recovery is blocked by an unconfirmed shutdown" : "orphan recovery requires all workers to be inactive", shutdownUnconfirmed ? "AGENT_TEAMS_SHUTDOWN_UNCONFIRMED" : "AGENT_TEAMS_CONFLICT");
        continue;
      }
      for (const member of team.members) if (member.kind === "worker") member.state = "retired";
      closeTeamRecord(team, "orphaned team closed by an explicit direct-human recovery");
      recovered.push(projectTeam(team));
    }
    return { candidates: candidates.map(projectTeam), recovered };
  }));
}

function teamSnapshot(document, sessionId, selectedTeamId) {
  const related = sessionId === "settings" ? [] : document.teams.filter((candidate) => memberOf(candidate, sessionId));
  const ordered = [...related].sort((left, right) => {
    const leftClosed = left.state === "closed";
    const rightClosed = right.state === "closed";
    if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
  const selected = ordered.find((team) => team.id === selectedTeamId) ?? ordered[0];
  const peerTeams = selected === undefined ? [] : document.teams.filter((candidate) => candidate.rootLeadSessionId === selected.rootLeadSessionId);
  const config = clone(document.settings);
  const teams = ordered.map(projectTeamUiSummary);
  const team = selected === undefined ? null : projectTeamForUi(selected, peerTeams);
  const cursor = JSON.stringify([
    config.enabled,
    config.maxMembers,
    config.maxActiveTurns,
    selected?.id ?? null,
    ...ordered.map((candidate) => [candidate.id, candidate.revision ?? 1]),
  ]);
  return {
    enabled: config.enabled,
    config,
    settings: config,
    cursor,
    activeTeamId: selected?.id ?? null,
    teams,
    team,
    crossTeamEvents: projectCrossTeamEvents(peerTeams),
  };
}

function teamSystemPrompt(store) {
  if (!store.isEnabled()) {
    return "Agent Teams automatic-team mode is DISABLED. Do not proactively call any team tool. Work normally without creating, spawning, messaging, or managing teams unless the direct user first enables the feature through its settings. Team members must never create teams.";
  }
  return [
    "Agent Teams automatic-team mode is ENABLED.",
    "Only the outermost top-level root lead/brain evaluates each ordinary direct-user goal using a strict three-level gate. Level 1 — main model: Complete simple, tightly coupled, or non-parallel work alone. Level 2 — ordinary subagent: when only one auxiliary executor is needed, use an official normal subagent or subagent_fork even if that single helper must be continuable or work across multiple turns. Level 3 — Agent Team: in automatic mode, proactively call team_start only when the goal normally has at least two sustained, genuinely independent workstreams that need delegation to different visible managed members; the root/lead's own work or coordination does not count as the second workstream. The work must also require ongoing coordination across turns, such as shared tasks, dependencies, handoffs, or status tracking. An explicit user request for a team may still be followed, but automatic mode must not create a one-worker team. Parallelism by itself is not enough for a team; the user does not need to say ‘create a team’, design members, or know the team tools. Never create a team merely to fill seats, demonstrate the feature, or make routine work look parallel. When an active team's objective needs another delegation, it must be added as a visible managed member rather than a hidden ordinary subagent. Managed team members must never create teams or fan out through subagent, subagent_fork, workflow, or ralph; if they need more parallel work, they must report that need to the root, which decides whether to spawn another visible member under maxActiveTurns. A member may report only from its own in-progress task through team_expansion_request; the request is a proposal, never authority to spawn.",
    "For every team_expansion_request, the fixed root lead approves only when the remaining outcomes are genuinely parallel and independent, inputs and acceptance criteria are explicit, file/external-resource ownership does not conflict, the handoff context is small, critical-path reduction or independent-review value materially exceeds coordination cost, and current member/turn/task budget is sufficient. The Host compares proposed file scopes with other in-progress task files and checks proposal-internal resource hierarchy, but existing external-resource ownership is not persisted and must be verified by the root. If a broad source task is split, first release/restructure it so its in-progress file scope no longer overlaps; then call team_task_create for each accepted durable outcome and only then call team_spawn for visible same-level peers. If rejected, explain the reason to the requester. Never invent a leader→group-leader→hidden-worker hierarchy.",
    "The fixed root lead/brain always uses the main model route. The AI autonomously chooses each spawned member's model_tier: default to subagent to reduce cost; use main only for high-complexity reasoning, architecture, security-critical work, or repeated failures. Users do not choose member tiers. Every new member re-reads the latest route for its chosen tier; changing the subagent route never changes main-tier members, and already-created continuable members keep their creation route.",
    "Every spawned member display name must be a plain 2–12 character duty name in the user's language. For Chinese, prefer 2–6 characters such as 界面、安全、测试、文档; for English, use labels such as UI, Test, Security, Docs. Avoid internal or abstract technical terms including 宿主、协调器、执行器、实现者、子代理 and Host, Coordinator, Executor, Implementer, Subagent.",
    "A top-level root may own at most 8 unclosed peer teams, and all peers share maxActiveTurns. Pass team_id when more than one is active. Only their same fixed root lead may relay across teams with target_team_id. Never nest teams or connect different roots. Persist tasks before work, atomically claim pending unblocked tasks, gracefully retire members before closing a team, and use direct-human team_recover only for inactive orphaned teams.",
    "An explicit UI Stop on a root turn pauses every active team owned by that root, interrupts its members, clears team-generated wakeups, and returns in-progress tasks to pending. Never continue a paused team implicitly. In a later direct-human turn, call team_resume only when the user explicitly asks to continue or resume that team.",
    "Automatic collaboration follows Observe → Avoid → Require → Resolve → Admit → Deliver. Use collaboration_discover only when another exact owner or dependency is materially necessary; never guess or expose a session ID. Submit one structured collaboration_intent only for Host-verifiable dependency blocking, unique ownership, resource conflict, formal handoff, or mandatory policy review. The Host defaults to a silent no-wake inbox, deduplicates requests, and rejects stale, looping, broad, unsupported, or paused-sender intents.",
    "Read collaboration_inbox only at a natural coordination boundary, never poll it. A paused target is never woken: deferred items are tied to its pause epoch and become stale across explicit resume, so the sender must re-evaluate necessity instead of replaying them.",
  ].join("\n");
}

function registerTools(ctx, store, ready, collaboration) {
  ctx.systemPrompt.section({
    name: "tool:agent-teams",
    order: 116,
    text: () => teamSystemPrompt(store),
  });
  const run = (handler) => async (args, exec) => { await ready; return handler(args, toolExecution(ctx, exec), exec.signal); };
  const collaborationContext = async (args, execution) => {
    const document = await store.read((current) => current);
    const team = resolveTeamForCaller(document, optionalString(args.team_id, "team_id", 256), execution.agent.id);
    await collaboration.syncTeams(document);
    return { document, team };
  };
  ctx.tools.register(defineTool({
    name: "team_start",
    description: "Start a durable peer team owned by this fixed top-level root lead. Automatic use normally requires at least two sustained independent workstreams delegated to different visible workers; the lead does not count, and one continuable helper should use ordinary subagent instead. An explicit user team request may override this automatic threshold. At most 8 teams may remain unclosed, and all peers share maxActiveTurns. Requires direct-human root authority in the current open turn.",
    parameters: {
      objective: { type: "string", required: true, description: "Concrete objective shared by the team." },
      name: { type: "string", description: "Optional short team display name." },
      lead_name: { type: "string", description: "Optional display name for the root lead." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult({ team: await createTeam(store, execution.agent, { objective: args.objective, name: args.name, leadName: args.lead_name }) }); }),
    presentCall: (args) => present("Start agent team", args.name ?? args.objective),
  }));
  ctx.tools.register(defineTool({
    name: "team_spawn",
    description: "Provision a continuable independent-context member. The AI chooses the tier by task: subagent by default for cost, main only for complex reasoning, architecture, security, or repeated failures; this is not a user choice. New members read the latest selected-tier route, while existing members retain their creation route and main-tier members ignore subagent-route changes.",
    parameters: {
      team_id: { type: "string", required: true }, name: { type: "string", required: true },
      role: { type: "string", required: true }, prompt: { type: "string", required: true },
      model_tier: { type: "string", enum: MODEL_TIERS, description: "AI-selected route tier; defaults to subagent. Choose main only under the documented complexity criteria." },
      model: { type: "string", description: "Optional explicit model override; for backward compatibility its provider is inherited from the exact live lead, not from model_tier." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await spawnMember(ctx, store, execution.agent, { teamId: args.team_id, name: args.name, role: args.role, prompt: args.prompt, modelTier: args.model_tier, model: args.model }, signal))),
    presentCall: (args) => present("Spawn team member", args.name),
  }));
  ctx.tools.register(defineTool({
    name: "team_status", description: "Read one authenticated team in detail. If team_id is omitted while several are active, return only safe team summaries so the caller can choose explicitly.",
    parameters: { team_id: { type: "string" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => store.read((document) => {
      const teamId = optionalString(args.team_id, "team_id", 256);
      if (teamId !== undefined) {
        const team = resolveTeamForCaller(document, teamId, execution.agent.id);
        return publicResult({ settings: document.settings, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)), teams: [projectTeamSummary(team)], selectionRequired: false });
      }
      const candidates = document.teams.filter((team) => team.state !== "closed" && memberOf(team, execution.agent.id) !== undefined)
        .filter((team) => !["shutting_down", "retired"].includes(memberOf(team, execution.agent.id).state));
      if (candidates.length === 0) reject("caller has no active team", "AGENT_TEAMS_NOT_FOUND");
      if (candidates.length > 1) return publicResult({ settings: document.settings, team: null, teams: candidates.map(projectTeamSummary), selectionRequired: true });
      const [team] = candidates;
      return publicResult({ settings: document.settings, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)), teams: [projectTeamSummary(team)], selectionRequired: false });
    })), presentCall: () => present("Read team status"),
  }));
  ctx.tools.register(defineTool({
    name: "team_message", description: "Send an authenticated coordinator relay. Cross-team delivery requires target_team_id and is allowed only when the caller is the same fixed root lead of both peer teams.",
    parameters: { team_id: { type: "string" }, target_team_id: { type: "string", description: "Optional peer team owned by the same fixed root lead." }, recipient_session_id: { type: "string", required: true, description: "Recipient session id, member id, or unique member name in the target team." }, message: { type: "string", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await sendTeamMessage(ctx, store, execution.agent, { teamId: args.team_id, targetTeamId: args.target_team_id, recipientSessionId: args.recipient_session_id, message: args.message }, signal))),
    presentCall: (args) => present("Relay team message", args.recipient_session_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_expansion_request",
    description: "Submit a structured, durable expansion proposal from the exact active worker that owns the cited in-progress task to its fixed root lead. This never spawns, creates tasks, or grants delegation authority. The Host enforces current capacity, proposal-internal file/resource separation, and proposed-file conflicts with other in-progress task files; existing external-resource ownership remains a root approval check. The root must reject or first release/restructure a broad source scope, persist accepted tasks, and then spawn visible same-level peers.",
    parameters: {
      team_id: { type: "string", description: "Required only if the caller could participate in more than one unclosed team." },
      source_task_id: { type: "string", required: true, description: "The requesting worker's own in-progress durable task." },
      parallel_benefit: { type: "string", required: true, description: "Concrete critical-path or independent-review benefit that exceeds coordination cost." },
      workstreams: {
        type: "array", required: true, description: `One through ${MAX_EXPANSION_WORKSTREAMS} independent outcomes, each intended for one visible peer member.`,
        items: {
          type: "object", additionalProperties: false,
          properties: {
            title: { type: "string", required: true, description: "Short unique outcome title." },
            deliverable: { type: "string", required: true, description: "Self-contained result the peer must return." },
            acceptance_criteria: { type: "string", required: true, description: "Observable checks the root/requester can verify." },
            files: { type: "array", items: { type: "string" }, description: "Exclusive writable file boundaries; may be empty for read-only work." },
            resources: { type: "array", items: { type: "string" }, description: "Exclusive external/read-only resource boundaries. At least one file or resource is required." },
          },
        },
      },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await submitExpansionRequest(ctx, store, execution.agent, {
      teamId: args.team_id,
      sourceTaskId: args.source_task_id,
      parallelBenefit: args.parallel_benefit,
      workstreams: args.workstreams,
    }, signal))),
    presentCall: (args) => present("Request visible team expansion", args.source_task_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_memory_pack", description: "Deliver one root-created ephemeral Memory Pack to the exact assignee of an active local task. The pack is limited to 1200 characters, expires within 30 minutes, cannot cross teams, and its content is never persisted in the team store.",
    parameters: {
      team_id: { type: "string", required: true },
      task_id: { type: "string", required: true },
      recipient_session_id: { type: "string", required: true, description: "Exact task assignee session id, member id, or unique member name." },
      content: { type: "string", required: true, description: "Content returned by local_memory pack; at most 1200 characters." },
      expires_at: { type: "string", required: true, description: "Pack expiry returned by local_memory; must be within the next 30 minutes." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await sendTeamMessage(ctx, store, execution.agent, {
      teamId: args.team_id,
      recipientSessionId: args.recipient_session_id,
      message: args.content,
      memoryPack: { taskId: args.task_id, expiresAt: args.expires_at },
    }, signal))),
    presentCall: (args) => present("Deliver ephemeral memory pack", args.task_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_create", description: "Create a durable pending task with local dependencies or fixed-root-lead-authorized peer-team dependencies.",
    parameters: { team_id: { type: "string" }, title: { type: "string", required: true }, description: { type: "string" }, assignee_session_id: { type: "string" }, depends_on: { type: "array", items: { type: "string" } }, cross_team_depends_on: { type: "array", items: { type: "string" }, description: "Peer dependencies as team_id:task_id; only their shared fixed root lead may create them." }, files: { type: "array", items: { type: "string" }, description: "Optional normalized file paths this task may edit; overlapping active tasks are flagged." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      if ((args.cross_team_depends_on?.length ?? 0) > 0) {
        const sourceTeam = await store.read((document) => findTeam(document, nonEmptyString(args.team_id, "team_id", 256)));
        requireLiveRootLead(ctx, sourceTeam, execution.agent);
      }
      return publicResult(await createTask(store, execution.agent, { teamId: args.team_id, title: args.title, description: args.description, assigneeSessionId: args.assignee_session_id, dependsOn: args.depends_on, crossTeamDependsOn: args.cross_team_depends_on, files: args.files }));
    }),
    presentCall: (args) => present("Create team task", args.title),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_list", description: "List team tasks with dependency-derived blockedBy arrays.",
    parameters: { team_id: { type: "string" }, state: { type: "string", enum: TASK_STATES } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => store.read((document) => {
      const team = resolveTeamForCaller(document, optionalString(args.team_id, "team_id", 256), execution.agent.id);
      const tasks = team.tasks.map((task) => deriveTaskAcrossTeams(task, team, document.teams)).filter((task) => args.state === undefined || task.state === args.state);
      return publicResult({ teamId: team.id, tasks });
    })), presentCall: () => present("List team tasks"),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_update", description: "Atomically claim, release, complete, reopen, assign, or unassign a team task. Claim rejects unmet dependencies; competing claims and reassignments to a different member while a task is in progress stay rejected. Repeating a claim by the same claimant, or the lead re-assigning the current assignee, is a safe idempotent no-op.",
    parameters: { team_id: { type: "string" }, task_id: { type: "string", required: true }, action: { type: "string", enum: ["claim", "release", "complete", "reopen", "assign", "unassign"], description: "requested transition; repeated claim by the same claimant and lead assign of the current assignee are safe no-ops" }, state: { type: "string", enum: TASK_STATES }, assignee_session_id: { type: "string", description: "target member id or unique member name for assign; must be the current assignee to be a no-op, otherwise the task must still be pending" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await updateTask(store, execution.agent, { teamId: args.team_id, taskId: args.task_id, action: args.action, state: args.state, assigneeSessionId: args.assignee_session_id }))),
    presentCall: (args) => present("Update team task", `${args.action}: ${args.task_id}`),
  }));
  ctx.tools.register(defineTool({
    name: "team_recover", description: "List or explicitly close inactive orphaned teams whose original root lead is unavailable. Requires a direct-human root turn; confirm must be true to mutate state.",
    parameters: { team_id: { type: "string" }, confirm: { type: "boolean" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await recoverOrphanTeams(ctx, store, execution, { teamId: args.team_id, confirm: args.confirm }))),
    presentCall: (args) => present(args.confirm === true ? "Recover orphaned team" : "Inspect orphaned teams", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_resume", description: "Resume one team paused by the direct user's explicit Stop action. Requires the same live root lead in a later direct-human turn and never resumes members automatically.",
    parameters: { team_id: { type: "string", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await resumePausedTeam(ctx, store, execution.agent, { teamId: args.team_id })); }),
    presentCall: (args) => present("Resume paused team", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "collaboration_discover",
    description: "Discover a small ACL-filtered set of collaborators in the caller's current fixed-root project scope. Use only when an exact owner, dependency, or conflicting resource is materially necessary. Returns opaque routeRef values and never raw session IDs.",
    parameters: {
      team_id: { type: "string", description: "Required when the caller belongs to several active peer teams." },
      resource_ref: { type: "string", description: "Optional exact canonical resource/file claim." },
      task_ref: { type: "string", description: "Optional exact team_id:task_id reference." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      const { team } = await collaborationContext(args, execution);
      const candidates = collaboration.discover({ callerSessionId: execution.agent.id, rootLeadSessionId: team.rootLeadSessionId, resourceRef: args.resource_ref, taskRef: args.task_ref });
      return publicResult({ candidates });
    }),
    presentCall: (args) => present("Discover necessary collaborator", args.resource_ref ?? args.task_ref),
  }));
  ctx.tools.register(defineTool({
    name: "collaboration_intent",
    description: "Submit one Host-verified automatic collaboration intent to one opaque routeRef. Raw session IDs and fanout are forbidden. Delivery defaults to a durable silent inbox; wake level 2 is downgraded unless an explicit standing grant exists.",
    parameters: {
      team_id: { type: "string", description: "Required when the caller belongs to several active peer teams." },
      route_ref: { type: "string", required: true },
      reason: { type: "string", required: true, enum: COLLABORATION_REASONS },
      dependency_task_ref: { type: "string", description: "Required evidence for DEPENDENCY_BLOCKED." },
      resource_ref: { type: "string", description: "Required evidence for UNIQUE_OWNER or RESOURCE_CONFLICT." },
      handoff_ref: { type: "string", description: "Target team_id:task_id for FORMAL_HANDOFF." },
      source_task_ref: { type: "string", description: "Completed source team_id:task_id for FORMAL_HANDOFF." },
      policy_ref: { type: "string", description: "Required evidence for policy-bound MANDATORY_REVIEW." },
      message: { type: "string", required: true, description: "Concise action request; never include secrets or raw account/session identifiers." },
      wake_level: { type: "number", enum: [0, 1, 2], description: "0 suggestion only, 1 silent inbox (default), 2 explicit-grant wake request." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      const { team } = await collaborationContext(args, execution);
      const evidence = {};
      for (const [source, target] of [["dependency_task_ref", "dependencyTaskRef"], ["resource_ref", "resourceRef"], ["handoff_ref", "handoffRef"], ["source_task_ref", "sourceTaskRef"], ["policy_ref", "policyRef"]]) {
        if (args[source] !== undefined) evidence[target] = args[source];
      }
      return publicResult(await collaboration.submitIntent({ callerSessionId: execution.agent.id, rootLeadSessionId: team.rootLeadSessionId, routeRef: args.route_ref, reason: args.reason, evidence, message: args.message, wakeLevel: args.wake_level }));
    }),
    presentCall: (args) => present("Submit collaboration intent", `${args.reason}: ${args.route_ref}`),
  }));
  ctx.tools.register(defineTool({
    name: "collaboration_inbox",
    description: "Read or acknowledge this exact caller's durable no-wake collaboration inbox. Check only at a natural coordination boundary; never poll. Paused or stale-epoch items are not returned.",
    parameters: {
      team_id: { type: "string", description: "Required when the caller belongs to several active peer teams." },
      action: { type: "string", enum: ["list", "acknowledge"], description: "Defaults to list." },
      item_ref: { type: "string", description: "Required only for acknowledge." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      const { team } = await collaborationContext(args, execution);
      const action = args.action ?? "list";
      if (action === "acknowledge") {
        return publicResult(await collaboration.acknowledgeInbox({ callerSessionId: execution.agent.id, rootLeadSessionId: team.rootLeadSessionId, itemRef: nonEmptyString(args.item_ref, "item_ref", 128) }));
      }
      return publicResult({ items: await collaboration.listInbox({ callerSessionId: execution.agent.id, rootLeadSessionId: team.rootLeadSessionId }) });
    }),
    presentCall: (args) => present(args.action === "acknowledge" ? "Acknowledge collaboration item" : "Read collaboration inbox", args.item_ref),
  }));
  ctx.tools.register(defineTool({
    name: "team_shutdown", description: "Gracefully retire one member or close the whole team. Force mode drains selected continuable children to quiescence using the exact live parent.",
    parameters: { team_id: { type: "string", required: true }, member_session_id: { type: "string" }, force: { type: "boolean" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await shutdownTeam(ctx, store, execution.agent, { teamId: args.team_id, memberSessionId: args.member_session_id, force: args.force }, signal))),
    presentCall: (args) => present("Shut down team", args.team_id),
  }));
}

function json(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(encoded), "cache-control": "no-store" });
  res.end(encoded);
}
function errorPayload(error, fallbackCode = "AGENT_TEAMS_INVALID_REQUEST") {
  return {
    error: String(error?.message ?? error),
    code: typeof error?.code === "string" ? error.code : fallbackCode,
  };
}
function trustedRequest(req) {
  const rawHost = req.headers.host;
  if (typeof rawHost !== "string") return false;
  let host;
  try { host = new URL(`http://${rawHost}`).hostname.toLowerCase(); } catch { return false; }
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === rawHost.toLowerCase() && ["127.0.0.1", "localhost"].includes(parsed.hostname.toLowerCase());
  } catch { return false; }
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body exceeds 256KB");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!isRecord(parsed)) throw new TypeError("JSON body must be an object");
  return parsed;
}
function encodedSseSnapshot(snapshot) {
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}
function writeSseClient(client, payload) {
  if (client.closed || payload === client.lastPayload || payload === client.pendingPayload) return;
  if (client.blocked) {
    // Keep only the newest complete snapshot while the socket applies backpressure.
    client.pendingPayload = payload;
    return;
  }
  let writable;
  try { writable = client.response.write(payload); } catch {
    client.closed = true;
    return;
  }
  client.lastPayload = payload;
  if (writable !== false) return;
  client.blocked = true;
  if (typeof client.response.once !== "function") return;
  client.response.once("drain", () => {
    if (client.closed) return;
    client.blocked = false;
    const pending = client.pendingPayload;
    client.pendingPayload = undefined;
    if (pending !== undefined) writeSseClient(client, pending);
  });
}
function createSseBroadcaster({ delayMs = SSE_COALESCE_MS } = {}) {
  const clients = new Map();
  let timer;
  let pendingDocument;
  const remove = (client) => {
    client.closed = true;
    const entries = clients.get(client.sessionId);
    entries?.delete(client);
    if (entries?.size === 0) clients.delete(client.sessionId);
  };
  const add = (sessionId, selectedTeamId, response) => {
    const client = { sessionId, selectedTeamId, response, blocked: false, closed: false, lastPayload: undefined, pendingPayload: undefined };
    const entries = clients.get(sessionId) ?? new Set();
    entries.add(client);
    clients.set(sessionId, entries);
    return client;
  };
  const send = (client, snapshot) => writeSseClient(client, encodedSseSnapshot(snapshot));
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const document = pendingDocument;
    pendingDocument = undefined;
    if (document === undefined) return;
    const payloads = new Map();
    for (const [sessionId, entries] of clients) {
      for (const client of [...entries]) {
        if (client.closed) { remove(client); continue; }
        const key = `${sessionId}\u0000${client.selectedTeamId ?? ""}`;
        let payload = payloads.get(key);
        if (payload === undefined) {
          payload = encodedSseSnapshot(teamSnapshot(document, sessionId, client.selectedTeamId));
          payloads.set(key, payload);
        }
        writeSseClient(client, payload);
      }
    }
  };
  const schedule = (document) => {
    pendingDocument = document;
    if (timer !== undefined || clients.size === 0) return;
    timer = setTimeout(flush, delayMs);
    timer.unref?.();
  };
  const close = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pendingDocument = undefined;
    for (const entries of clients.values()) for (const client of entries) {
      client.closed = true;
      client.response.end();
    }
    clients.clear();
  };
  return { add, clients, close, flush, remove, schedule, send };
}

function registerWebApi(ctx, store, ready) {
  const broadcaster = createSseBroadcaster();
  const unsubscribe = store.subscribe((document) => broadcaster.schedule(document));
  ctx.effect(() => () => { unsubscribe(); broadcaster.close(); }, "agent-teams store subscription");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/state", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      try {
        await ready;
        const requestUrl = new URL(req.url, "http://x");
        const sessionId = nonEmptyString(requestUrl.searchParams.get("sessionId"), "sessionId", 256);
        const selectedTeamId = optionalString(requestUrl.searchParams.get("teamId"), "teamId", 256);
        return json(res, 200, await store.read((document) => teamSnapshot(document, sessionId, selectedTeamId)));
      } catch (error) { return json(res, 400, errorPayload(error)); }
    },
  }), "agent-teams state route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/events", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      try {
        await ready;
        const requestUrl = new URL(req.url, "http://x");
        const sessionId = nonEmptyString(requestUrl.searchParams.get("sessionId"), "sessionId", 256);
        const selectedTeamId = optionalString(requestUrl.searchParams.get("teamId"), "teamId", 256);
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-content-type-options": "nosniff" });
        const client = broadcaster.add(sessionId, selectedTeamId, res);
        broadcaster.send(client, await store.read((document) => teamSnapshot(document, sessionId, selectedTeamId)));
        req.once("close", () => broadcaster.remove(client));
      } catch (error) { if (!res.headersSent) return json(res, 400, errorPayload(error)); }
    },
  }), "agent-teams events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/action", handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req) || req.headers["x-harness-agent-teams"] !== "1") return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      let body;
      try { body = await readJsonBody(req); } catch (error) { return json(res, error?.status === 413 ? 413 : 400, errorPayload(error, error?.status === 413 ? "AGENT_TEAMS_BODY_TOO_LARGE" : "AGENT_TEAMS_INVALID_REQUEST")); }
      try {
        await ready;
        const action = nonEmptyString(body.action, "action", 64);
        const sessionId = nonEmptyString(body.sessionId, "sessionId", 256);
        if (action !== "settings") reject("team mutations are available only through authenticated model tools; use the lead conversation or open a member conversation", "AGENT_TEAMS_UNAUTHORIZED");
        const result = await store.mutate((document) => {
          if (body.enabled === false && document.teams.some((team) => team.state !== "closed")) reject("close the active team before disabling Agent Teams", "AGENT_TEAMS_CONFLICT");
          document.settings = {
            enabled: body.enabled === undefined ? document.settings.enabled : Boolean(body.enabled),
            maxMembers: safeLimit(body.maxMembers, "maxMembers", document.settings.maxMembers),
            maxActiveTurns: safeLimit(body.maxActiveTurns, "maxActiveTurns", document.settings.maxActiveTurns),
          };
          return { settings: document.settings };
        });
        const state = await store.read((document) => teamSnapshot(document, sessionId));
        return json(res, 200, publicResult({ result, state }));
      } catch (error) {
        const status = error?.code === "AGENT_TEAMS_NOT_FOUND" ? 404 : error?.code === "AGENT_TEAMS_UNAUTHORIZED" ? 403 : error?.code?.includes("CONFLICT") || error?.code?.includes("LIMIT") ? 409 : 400;
        return json(res, status, errorPayload(error));
      }
    },
  }), "agent-teams action route");
}

function registerProjectEntryApi(ctx, projectEntry) {
  const statusRoute = async (req, res) => {
    if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
    if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
    try { return json(res, 200, publicResult({ status: await projectEntry.status() })); }
    catch (error) { return json(res, 400, errorPayload(error)); }
  };
  const actionRoute = async (req, res) => {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
    if (!trustedRequest(req) || req.headers["x-harness-agent-teams"] !== "1") return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
    let body;
    try { body = await readJsonBody(req); } catch (error) { return json(res, error?.status === 413 ? 413 : 400, errorPayload(error, error?.status === 413 ? "AGENT_TEAMS_BODY_TOO_LARGE" : "AGENT_TEAMS_INVALID_REQUEST")); }
    try {
      const action = nonEmptyString(body.action, "action", 64);
      const payload = isRecord(body.payload) ? body.payload : {};
      let result;
      switch (action) {
        case "create-project": result = await projectEntry.createProject(payload); break;
        case "create-invite": result = await projectEntry.createInvite(payload); break;
        case "redeem-invite": result = await projectEntry.redeemInvite(payload); break;
        case "prepare-join": result = await projectEntry.createJoinRequest(payload); break;
        case "approve-join": result = await projectEntry.approveJoinRequest(payload); break;
        case "complete-join": result = await projectEntry.completeJoinRequest(payload); break;
        case "set-relay": result = await projectEntry.setRelay(payload); break;
        case "connect-remote": result = await projectEntry.connectRemote(payload); break;
        case "disconnect-remote": result = await projectEntry.disconnectRemote(); break;
        case "lan-status": result = projectEntry.lanStatus(); break;
        case "start-lan": result = await projectEntry.startLan(payload); break;
        case "connect-lan": result = await projectEntry.connectLan(payload); break;
        case "stop-lan": result = await projectEntry.stopLan(); break;
        default: throw new TypeError(`unsupported project entry action ${action}`);
      }
      return json(res, 200, publicResult({ result, status: await projectEntry.status() }));
    } catch (error) {
      return json(res, 400, errorPayload(error));
    }
  };
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/api/agent-teams/project/status", handler: statusRoute }), "agent-teams project status route");
  ctx.effect(() => ctx.webServer.register({ kind: "exact", path: "/api/agent-teams/project/action", handler: actionRoute }), "agent-teams project action route");
}

function createSubagentEventReconciler(ctx, store, ready, delayMs = SUBAGENT_RECONCILE_MS) {
  let pending = [];
  let timer;
  let closed = false;
  const schedule = () => {
    if (closed || timer !== undefined) return;
    timer = setTimeout(flush, delayMs);
    timer.unref?.();
  };
  const flush = async () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const batch = pending;
    pending = [];
    if (batch.length === 0) return;
    try {
      await ready;
      const managedIds = new Set(batch.map((entry) => entry.info.id).filter((id) => store.hasManagedMember(id)));
      if (managedIds.size > 0) await store.mutate((document) => {
        const bySession = new Map();
        for (const team of document.teams) {
          if (team.state === "closed") continue;
          for (const member of team.members) if (managedIds.has(member.sessionId) && !bySession.has(member.sessionId)) bySession.set(member.sessionId, { member, team });
        }
        for (const { type, info } of batch) {
          const target = bySession.get(info.id);
          if (target === undefined) continue;
          const { member, team } = target;
          const updatedAt = now();
          if (type === "start") {
            if (member.state === "retired") continue;
            if (member.state !== "shutting_down") {
              member.state = "running";
              member.error = undefined;
            }
            member.runId = String(info.runId);
            member.updatedAt = updatedAt;
            team.updatedAt = updatedAt;
            continue;
          }
          if (member.state === "shutting_down") {
            if (member.runId !== undefined && info.runId !== undefined && member.runId === String(info.runId)) member.runId = undefined;
            member.updatedAt = updatedAt;
            team.updatedAt = updatedAt;
            continue;
          }
          if (member.state !== "retired") {
            if (["error", "refusal"].includes(info.stopReason)) {
              member.state = "failed";
              member.error = `subagent ended with ${info.stopReason}`;
            } else member.state = "ready";
            member.runId = undefined;
            member.updatedAt = updatedAt;
            team.updatedAt = updatedAt;
          }
          member.shutdownUnconfirmed = undefined;
          member.stopUnconfirmed = undefined;
        }
      });
    } catch (error) {
      ctx.logger.warn(`agent-teams lifecycle reconciliation failed: ${String(error)}`);
    } finally {
      for (const entry of batch) entry.resolve();
      if (pending.length > 0) schedule();
    }
  };
  const enqueue = (type, info) => new Promise((resolve) => {
    if (closed) return resolve();
    pending.push({ type, info, resolve });
    schedule();
  });
  const close = () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const abandoned = pending;
    pending = [];
    for (const entry of abandoned) entry.resolve();
  };
  return { close, enqueue, flush };
}
function observeSubagents(ctx, store, ready) {
  const reconciler = createSubagentEventReconciler(ctx, store, ready);
  ctx.effect(() => () => reconciler.close(), "agent-teams lifecycle reconciliation");
  ctx.on("subagent/start", (info) => {
    noteGracefulLifecycleStart(info);
    return reconciler.enqueue("start", info);
  });
  ctx.on("subagent/end", (info) => {
    noteGracefulLifecycleEnd(info);
    return reconciler.enqueue("end", info);
  });
}

function observeUserStops(ctx, store, ready) {
  ctx.on("session/event", (session, event) => {
    if (event.type !== "turn/end" || event.data?.reason?.kind !== "aborted" || event.data.reason.reason?.kind !== "user") return;
    const lead = ctx.agents.get(session.id);
    if (lead === undefined || lead.session !== session) return;
    const selections = store.activeTeamsForRoot(lead.id);
    if (selections.length === 0) return;
    const stoppedAt = now();
    for (const selection of selections) USER_PAUSED_TEAMS.add(selection.teamId);
    // The stock UI cancellation preserves queued inbox work. For a team-owning root,
    // clear it at the durable turn-end boundary so member reports cannot auto-restart.
    lead.cancel({ kind: "user" });
    for (const childId of new Set(selections.flatMap((entry) => entry.childIds))) {
      try { ctx.subagents.interrupt(childId, { kind: "ancestor", agent: lead }); }
      catch (error) { ctx.logger.warn(`agent-teams could not interrupt member "${childId}" after user stop: ${String(error)}`); }
    }
    void ready.then(() => pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt))
      .catch((error) => ctx.logger.warn(`agent-teams user-stop reconciliation failed: ${String(error)}`));
  });
}

function resolveConfig(config = {}) {
  return {
    enabled: config.enabled ?? DEFAULT_SETTINGS.enabled,
    maxMembers: safeLimit(config.maxMembers, "maxMembers", DEFAULT_SETTINGS.maxMembers),
    maxActiveTurns: safeLimit(config.maxActiveTurns, "maxActiveTurns", DEFAULT_SETTINGS.maxActiveTurns),
  };
}
function apply(ctx, config = {}) {
  const defaults = resolveConfig(config);
  const dshHome = process.env.DSH_HOME;
  if (typeof dshHome !== "string" || dshHome.length === 0) throw new Error("dsh-agent-teams requires DSH_HOME");
  const store = new AgentTeamsStore(join(dshHome, "storages", "agent_teams.json"), defaults);
  const collaboration = new AgentCollaborationService(join(dshHome, "storages", "agent_collaboration.json"));
  // Product wiring for the already-implemented project collaboration domain: create
  // the project authority, issue/ redeem remote invites, and manage the real WSS
  // relay transport. The service never fakes LAN auto-discovery or an unconfigured
  // relay; every entry reports its true capability state.
  const projectEntry = new ProjectEntryService({
    dshHome,
    resolveWebSocket: async () => {
      try {
        const loaded = await import("ws");
        return loaded?.default ?? loaded?.WebSocket;
      } catch {
        // The relay transport stays honestly disabled when no WebSocket
        // implementation is resolvable from the plugin runtime.
        return undefined;
      }
    },
  });
  const ready = store.init();
  ready.catch((error) => ctx.logger.error(`agent-teams store initialization failed: ${String(error)}`));
  void ready.then((document) => document.teams.length > 0 ? collaboration.syncTeams(document) : undefined)
    .catch((error) => ctx.logger.warn(`agent-teams collaboration initialization failed: ${String(error)}`));
  ctx.effect(() => {
    const unsubscribe = store.subscribe((document) => {
      if (document.teams.length === 0) return;
      void collaboration.syncTeams(document).catch((error) => ctx.logger.warn(`agent-teams collaboration sync failed: ${String(error)}`));
    });
    return async () => {
      unsubscribe();
      await collaboration.close();
      await projectEntry.close();
    };
  }, "agent-teams collaboration presence");
  registerTools(ctx, store, ready, collaboration);
  registerWebApi(ctx, store, ready);
  registerProjectEntryApi(ctx, projectEntry);
  observeSubagents(ctx, store, ready);
  observeUserStops(ctx, store, ready);
}

export {
  AgentCollaborationService,
  AgentTeamsStore,
  COLLABORATION_REASONS,
  Config,
  HARD_MAX_MEMBERS,
  HARD_MAX_TEAMS_PER_ROOT,
  GRACEFUL_LIFECYCLE_TIMEOUT_MS,
  SSE_COALESCE_MS,
  SUBAGENT_RECONCILE_MS,
  UI_MAX_EVENTS_PER_TEAM,
  UI_MAX_TASKS_PER_TEAM,
  createSseBroadcaster,
  createSubagentEventReconciler,
  fileBoundaryOverlap,
  normalizeExpansionRequest,
  resourceBoundaryOverlap,
  pauseTeamsForUserStop,
  resumePausedTeam,
  observeUserStops,
  MEMBER_STATES,
  TASK_STATES,
  apply,
  createTask,
  createTeam,
  deriveTask,
  inject,
  name,
  readModelRouting,
  resolveConfig,
  resolveModelSelection,
  teamSnapshot,
  trustedRequest,
  updateTask,
  waitForGracefulLifecycle,
  validateMember,
  validateMessage,
  validateStoreDocument,
  validateTask,
  validateTeam,
};
