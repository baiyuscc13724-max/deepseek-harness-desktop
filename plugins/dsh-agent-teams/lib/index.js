import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isProxy } from "node:util/types";
import z from "@deepseek-ai/schemastery";
import { createUserMessage, HarnessError } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { COLLABORATION_REASONS } from "./collaboration-broker.js";
import { AgentCollaborationService } from "./collaboration-service.js";
import { consumeDesktopAuthorizationCapability } from "./desktop-authorization-capability.js";
import { consumeDesktopGitCapability } from "./desktop-git-capability.js";
import { ProjectEntryService } from "./project-entry-service.js";
import { ProjectFoundationsRuntime } from "./project-foundations-runtime.js";
import { ProjectAutomationWebRuntime, projectAutomationWebError } from "./project-automation-web.js";
import { ProjectBusinessSyncRuntime } from "./project-business-sync-runtime.js";
import { ProjectTaskWebRuntime, projectTaskWebError } from "./project-task-web.js";

/** Host-only agent-team coordinator. A future client bundle is advertised by package metadata. */
const name = "agent-teams";
const inject = ["agents", "subagents", "tools", "systemPrompt", "webServer"];
const STORE_VERSION = 6;
const LEGACY_STORE_VERSIONS = new Set([1, 2, 3, 4, 5]);
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEAM_MESSAGES = 500;
const MAX_TEAM_TASKS = 1_000;
const UI_MAX_TASKS_PER_TEAM = 200;
const UI_MAX_EVENTS_PER_TEAM = 50;
const UI_MAX_TASK_WORKFLOW_EVENTS = 80;
const UI_MAX_TASK_RUNTIME_SOURCE_EVENTS = 2_000;
const UI_MAX_TASK_PLAN_ITEMS = 40;
const UI_MAX_OWNERSHIP_EVENTS = 8;
const UI_TASK_DETAIL_DESCRIPTION_CHARS = 32_768;
const UI_TASK_RESULT_CHARS = 12_000;
const SSE_COALESCE_MS = 50;
const TEAM_SSE_KEEPALIVE_MS = 15_000;
const PROJECT_TASK_SSE_KEEPALIVE_MS = 15_000;
const SUBAGENT_RECONCILE_MS = 20;
const GRACEFUL_LIFECYCLE_TIMEOUT_MS = 120_000;
const GLOBAL_TEAM_ACTIVE_ACTIVATIONS = 8;
const MAX_TEAM_ADMISSION_QUEUE = 32;
const MAX_TEAM_ADMISSION_QUEUE_PER_ROOT = 8;
const TEAM_ADMISSION_TIMEOUT_MS = 30_000;
const HARD_MAX_MEMBERS = 8;
const HARD_MAX_TEAMS_PER_ROOT = 8;
const MAX_EXPANSION_WORKSTREAMS = 4;
const MAX_EXPANSION_BOUNDARIES = 16;
const MAX_EXPANSION_REQUEST_CHARS = 24_000;
const MAX_BOOTSTRAP_ITEMS = 4;
const MAX_TASK_ATTEMPT_HISTORY = 24;
const MAX_TASK_INTERRUPTION_HISTORY = 24;
const MAX_OWNERSHIP_HISTORY = 24;
const PLAN_PHASES = Object.freeze(["draft", "committed", "active"]);
const PLAN_AUTHORIZATION_STATES = Object.freeze(["host_verified", "human_attested", "unknown"]);
const PLAN_MIGRATION_STATES = Object.freeze(["ready", "legacy_unplanned", "legacy_active_gate"]);
const CAPABILITY_STATES = Object.freeze(["verified", "unavailable", "unknown"]);
const EXTERNAL_EFFECT_POLICIES = Object.freeze(["none", "idempotent", "confirm_each", "forbidden"]);
const EXTERNAL_EFFECT_OUTCOMES = Object.freeze(["not_started", "succeeded", "failed", "outcome_unknown"]);
const DEFAULT_SETTINGS = Object.freeze({ enabled: false, maxMembers: 4, maxActiveTurns: 4 });
const MODEL_ROUTING_FILE = "harness-desktop-model-routing.json";
const MODEL_TIERS = Object.freeze(["main", "subagent"]);
const MANAGED_MEMBER_DENIED_TOOLS = Object.freeze(["subagent", "subagent_fork", "workflow", "ralph"]);
const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const MODEL_ID = /^\S{1,256}$/u;
const TASK_STATES = Object.freeze(["pending", "in_progress", "completed", "cancelled"]);
const MUTABLE_TASK_STATES = Object.freeze(["pending", "in_progress", "completed"]);
const TERMINAL_TASK_STATES = new Set(["completed", "cancelled"]);
const TASK_WORKFLOW_EVENT_TYPES = new Set(["turn/start", "turn/end", "step/start", "step/end", "tool/call", "tool/result", "todo/write", "assistant/message", "llm/retry"]);
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
const USER_PAUSE_RECONCILIATIONS = new Map();
const USER_PAUSE_EPOCHS = new Map();
const STOPPABLE_MEMBER_STATES = new Set(["provisioning", "running", "idle", "ready", "shutting_down"]);
const STORE_INSTANCES = new Map();
const TEAM_KEYS = new Set(["id", "rootLeadSessionId", "name", "objective", "revision", "state", "createdAt", "updatedAt", "members", "tasks", "messages", "bootstrap", "plan", "pauseEpoch", "resume", "handoff", "projectKey", "ownershipHistory", "closure"]);
const HANDOFF_KEYS = new Set(["tokenHash", "sourceRootSessionId", "targetRootSessionId", "projectKey", "createdAt", "expiresAt"]);
const OWNERSHIP_HISTORY_KEYS = new Set(["kind", "sourceRootSessionId", "targetRootSessionId", "projectKey", "tokenHash", "at", "pauseEpoch"]);
const PLAN_KEYS = new Set(["phase", "revision", "hash", "committedAt", "activatedAt", "authorization", "migrationState"]);
const PLAN_AUTHORIZATION_KEYS = new Set(["source", "attestedAt", "confirmedPlanHash", "permissions", "files", "cost", "externalSideEffects"]);
const RESUME_KEYS = new Set(["previewId", "requestId", "pauseEpoch", "teamRevision", "createdAt", "nodes", "status", "committedAt"]);
const RESUME_NODE_KEYS = new Set(["memberId", "status", "reason"]);
const BOOTSTRAP_KEYS = new Set(["requestId", "inputHash", "phase", "taskRefs", "memberRefs", "createdAt", "updatedAt"]);
const BOOTSTRAP_TASK_REF_KEYS = new Set(["key", "taskId"]);
const BOOTSTRAP_MEMBER_REF_KEYS = new Set(["key", "name", "status", "memberId", "sessionId", "errorCode", "errorStage"]);
const TASK_KEYS = new Set(["id", "title", "description", "state", "dependsOn", "crossTeamDependsOn", "files", "assigneeSessionId", "createdAt", "updatedAt", "claimedAt", "completedAt", "cancelledAt", "cancellationReason", "releasedAt", "releaseReason", "result", "submission", "acceptance", "attempt", "claimId", "leaseEpoch", "attemptHistory", "interruptionHistory", "checkpoint", "nextStep", "capabilities", "externalEffects"]);
const TASK_RESULT_KEYS = new Set(["text", "reportedAt", "truncated", "taskId", "claimId", "leaseEpoch", "reportedBy"]);
const TASK_SUBMISSION_KEYS = new Set(["taskId", "claimId", "leaseEpoch", "submittedAt", "submittedBy", "source"]);
const TASK_ACCEPTANCE_KEYS = new Set(["taskId", "claimId", "leaseEpoch", "acceptedAt", "acceptedBy", "ownerEpoch"]);
const RESOLVE_UNKNOWN_AUTHORIZATION_TOOL = "team_task_external_effect";
const RESOLVE_UNKNOWN_AUTHORIZATION_TTL_MS = 2 * 60 * 1_000;
const MAX_RESOLVE_UNKNOWN_AUTHORIZATIONS = 4_096;
const RESOLVE_UNKNOWN_AUTHORIZATION_KEYS = new Set(["authorizationId", "tool", "rootSessionId", "turnKey", "teamId", "taskId", "effectName", "attemptId", "outcome", "pauseEpoch", "teamRevision", "canonicalArgumentsHash", "expiresAt"]);
const RESOLVE_UNKNOWN_AUTHORIZATION_BRAND = Symbol("agent-teams.resolve-unknown-authorization");
const TEAM_CLOSURE_KEYS = new Set(["outcome", "closedAt", "attemptedAt", "reason", "forced", "cancelledTaskIds", "failures"]);
const TEAM_CLOSURE_OUTCOMES = Object.freeze(["succeeded", "cancelled", "forced", "failed"]);
const TASK_CHECKPOINT_KEYS = new Set(["text", "reportedAt", "reportedBy", "verified", "claimId", "leaseEpoch"]);
const TASK_HISTORY_KEYS = new Set(["kind", "at", "attempt", "claimId", "leaseEpoch", "reason"]);
const CAPABILITY_KEYS = new Set(["name", "status", "source", "checkedAt"]);
const EXTERNAL_EFFECT_KEYS = new Set(["name", "policy", "outcome", "idempotencyKey", "updatedAt", "attemptId", "preparedAt", "resolvedAt", "resolvedBy"]);
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
function effectiveTeamState(team) {
  return team.state === "active" && USER_PAUSED_TEAMS.has(team.id) ? "paused" : team.state;
}
function effectiveMemberState(team, member) {
  const stopPending = team.state === "active" && effectiveTeamState(team) === "paused";
  return stopPending && member.kind === "worker" && STOPPABLE_MEMBER_STATES.has(member.state) ? "shutting_down" : member.state;
}
function withEffectiveTeamStates(document) {
  return { ...document, teams: document.teams.map((team) => ({ ...team, state: effectiveTeamState(team) })) };
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
function memberHasLegacyExecutionEvidence(team, member) {
  if ((team.ownershipHistory ?? []).some((entry) => entry.sourceRootSessionId === member.sessionId)) return false;
  return team.tasks.some((task) => {
    if (task.submission?.submittedBy === member.sessionId && taskSubmissionMatches(task)) return true;
    if (task.result?.reportedBy === member.sessionId && task.result.taskId === task.id
      && (task.attemptHistory ?? []).some((entry) => entry.kind === "claimed" && entry.claimId === task.result.claimId && entry.leaseEpoch === task.result.leaseEpoch)) return true;
    const checkpoint = task.checkpoint;
    if (checkpoint?.reportedBy !== member.sessionId) return false;
    return (task.attemptHistory ?? []).some((entry) => entry.kind === "claimed" && entry.claimId === checkpoint.claimId && entry.leaseEpoch === checkpoint.leaseEpoch);
  });
}
function teamHasEstablishedWorker(team) {
  return team.members.some((member) => {
    if (member.kind !== "worker") return false;
    if (["running", "idle", "ready"].includes(member.state)) return true;
    if (member.state === "provisioning") return false;
    if (member.publishedAt !== undefined && !(member.state === "failed" && (member.shutdownUnconfirmed !== undefined || member.stopUnconfirmed !== undefined))) return true;
    return memberHasLegacyExecutionEvidence(team, member);
  });
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
function positiveInteger(value, field, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new TypeError(`${field} must be a ${allowZero ? "non-negative" : "positive"} safe integer`);
  return value;
}
function boundedPush(list, value, limit) {
  list.push(value);
  if (list.length > limit) list.splice(0, list.length - limit);
}
function validateCapability(capability, field) {
  if (!isRecord(capability)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(capability, CAPABILITY_KEYS, field);
  nonEmptyString(capability.name, `${field}.name`, 200);
  assertEnum(capability.status, CAPABILITY_STATES, `${field}.status`);
  nonEmptyString(capability.source, `${field}.source`, 500);
  if (capability.checkedAt !== undefined) assertIsoDate(capability.checkedAt, `${field}.checkedAt`);
  return capability;
}
function validateExternalEffect(effect, field) {
  if (!isRecord(effect)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(effect, EXTERNAL_EFFECT_KEYS, field);
  nonEmptyString(effect.name, `${field}.name`, 200);
  assertEnum(effect.policy, EXTERNAL_EFFECT_POLICIES, `${field}.policy`);
  assertEnum(effect.outcome, EXTERNAL_EFFECT_OUTCOMES, `${field}.outcome`);
  const effectKey = optionalString(effect.idempotencyKey, `${field}.idempotencyKey`, 500);
  if (effectKey !== undefined && !/^[a-f0-9]{64}$/u.test(effectKey)) throw new TypeError(`${field}.idempotencyKey must be a Host-derived SHA-256 key`);
  if (effect.updatedAt !== undefined) assertIsoDate(effect.updatedAt, `${field}.updatedAt`);
  optionalString(effect.attemptId, `${field}.attemptId`, 256);
  if (effect.preparedAt !== undefined) assertIsoDate(effect.preparedAt, `${field}.preparedAt`);
  if (effect.resolvedAt !== undefined) assertIsoDate(effect.resolvedAt, `${field}.resolvedAt`);
  optionalString(effect.resolvedBy, `${field}.resolvedBy`, 256);
  return effect;
}
function hostExternalEffectKey(teamId, taskId, effectName) {
  return createHash("sha256").update(JSON.stringify(["agent-teams-effect-v1", teamId, taskId, effectName])).digest("hex");
}
function teamPlanMaterial(team) {
  return {
    objective: team.objective,
    tasks: team.tasks.map((task) => ({
      id: task.id, title: task.title, description: task.description, dependsOn: task.dependsOn,
      crossTeamDependsOn: task.crossTeamDependsOn ?? [], files: task.files ?? [],
      capabilities: task.capabilities ?? [],
      externalEffects: (task.externalEffects ?? []).map((effect) => ({ name: effect.name, policy: effect.policy, idempotencyKey: effect.idempotencyKey })),
    })),
  };
}
function teamPlanHash(team) {
  return createHash("sha256").update(JSON.stringify(teamPlanMaterial(team))).digest("hex");
}
function markPlanDraft(team) {
  if (team.plan === undefined) return;
  team.plan.phase = "draft";
  team.plan.revision += 1;
  team.plan.hash = teamPlanHash(team);
  team.plan.committedAt = undefined;
  team.plan.activatedAt = undefined;
  team.plan.authorization = undefined;
}
function validatePlan(plan) {
  if (!isRecord(plan)) throw new TypeError("team.plan must be an object");
  assertAllowedKeys(plan, PLAN_KEYS, "team.plan");
  assertEnum(plan.phase, PLAN_PHASES, "team.plan.phase");
  positiveInteger(plan.revision, "team.plan.revision");
  assertEnum(plan.migrationState ?? "ready", PLAN_MIGRATION_STATES, "team.plan.migrationState");
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(plan.hash, "team.plan.hash", 64))) throw new TypeError("team.plan.hash is invalid");
  if (plan.committedAt !== undefined) assertIsoDate(plan.committedAt, "team.plan.committedAt");
  if (plan.activatedAt !== undefined) assertIsoDate(plan.activatedAt, "team.plan.activatedAt");
  if (plan.authorization !== undefined) {
    if (!isRecord(plan.authorization)) throw new TypeError("team.plan.authorization must be an object");
    assertAllowedKeys(plan.authorization, PLAN_AUTHORIZATION_KEYS, "team.plan.authorization");
    assertEnum(plan.authorization.source, PLAN_AUTHORIZATION_STATES, "team.plan.authorization.source");
    assertIsoDate(plan.authorization.attestedAt, "team.plan.authorization.attestedAt");
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(plan.authorization.confirmedPlanHash, "team.plan.authorization.confirmedPlanHash", 64))) throw new TypeError("team.plan.authorization.confirmedPlanHash is invalid");
    if (plan.authorization.confirmedPlanHash !== plan.hash) throw new TypeError("team.plan authorization must bind the exact current plan hash");
    for (const field of ["permissions", "files", "cost", "externalSideEffects"]) assertEnum(plan.authorization[field], PLAN_AUTHORIZATION_STATES, `team.plan.authorization.${field}`);
    if (plan.authorization.source !== "host_verified" && Object.values(plan.authorization).some((value) => value === "host_verified")) throw new TypeError("only a Host-verified authorization may contain host_verified facts");
  }
  return plan;
}
function normalizeCapabilityInputs(value, field = "capabilities") {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) reject(`${field} must contain at most 32 entries`, "AGENT_TEAMS_INVALID_CAPABILITY");
  return value.map((entry, index) => {
    const candidate = isRecord(entry) ? entry : { name: entry, status: "unknown", source: "not provided by Host" };
    const capability = {
      name: nonEmptyString(candidate.name, `${field}[${index}].name`, 200),
      // Model/tool input is never a Host capability attestation. It can declare an
      // unavailable requirement, but every claimed permission remains explicit unknown
      // until an individual registered Host verifier supplies durable evidence.
      status: candidate.status === "unavailable" ? "unavailable" : "unknown",
      source: candidate.status === "unavailable" ? "caller-declared unavailable (unverified)" : "not provided by Host",
    };
    validateCapability(capability, `${field}[${index}]`);
    return capability;
  });
}
function normalizeExternalEffectInputs(value, field = "externalEffects") {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) reject(`${field} must contain at most 32 entries`, "AGENT_TEAMS_INVALID_EXTERNAL_EFFECT");
  return value.map((candidate, index) => {
    if (!isRecord(candidate)) reject(`${field}[${index}] must be an object`, "AGENT_TEAMS_INVALID_EXTERNAL_EFFECT");
    const effect = {
      name: nonEmptyString(candidate.name, `${field}[${index}].name`, 200),
      policy: candidate.policy ?? "forbidden",
      outcome: candidate.outcome === "outcome_unknown" ? "outcome_unknown" : "not_started",
      // Callers may describe the effect and policy, but never supply an idempotency
      // identity. The Host derives that identity after the durable team/task ids exist.
      updatedAt: candidate.updatedAt ?? now(),
    };
    validateExternalEffect(effect, `${field}[${index}]`);
    return effect;
  });
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
  if (member.publishedAt !== undefined) assertIsoDate(member.publishedAt, "member.publishedAt");
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

function taskResultFromAssistantMessage(content, reportedAt = now(), binding) {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .trim();
  if (text.length === 0) return undefined;
  const truncated = text.length > UI_TASK_RESULT_CHARS;
  return {
    text: truncated ? `${text.slice(0, UI_TASK_RESULT_CHARS - 2).trimEnd()}\n…` : text,
    reportedAt,
    truncated,
    ...(binding === undefined ? {} : {
      taskId: binding.taskId,
      claimId: binding.claimId,
      leaseEpoch: binding.leaseEpoch,
      reportedBy: binding.reportedBy,
    }),
  };
}
function taskSubmission(task, callerId, submittedAt = now(), source = "explicit_complete") {
  return { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, submittedAt, submittedBy: callerId, source };
}
function taskSubmissionMatches(task) {
  const submission = task.submission;
  return isRecord(submission) && submission.taskId === task.id && submission.claimId === task.claimId
    && submission.leaseEpoch === (task.leaseEpoch ?? 0) && submission.submittedBy === task.assigneeSessionId;
}
function taskAcceptanceMatches(task) {
  const acceptance = task.acceptance;
  return isRecord(acceptance) && taskSubmissionMatches(task) && acceptance.taskId === task.id
    && acceptance.claimId === task.claimId && acceptance.leaseEpoch === (task.leaseEpoch ?? 0);
}
function taskSatisfiesDependency(task) {
  return task?.state === "completed" && taskAcceptanceMatches(task);
}
function teamCancelledTaskIds(team) {
  return (team.tasks ?? []).filter((task) => task.state === "cancelled").map((task) => task.id);
}
function assertClosureSemantics(team) {
  const closure = team.closure;
  if (closure === undefined) {
    if (team.state === "closed") throw new TypeError("closed team requires a closure receipt");
    return;
  }
  if (new Set(closure.cancelledTaskIds).size !== closure.cancelledTaskIds.length) throw new TypeError("team.closure.cancelledTaskIds must be unique");
  if (closure.outcome === "failed") {
    if (team.state === "closed" || closure.closedAt !== undefined) throw new TypeError("failed closure receipt must describe an open team attempt");
    if (closure.failures.length === 0) throw new TypeError("failed closure receipt requires failures");
    if (closure.cancelledTaskIds.length !== 0) throw new TypeError("failed closure attempt cannot claim terminalized tasks");
    return;
  }
  if (team.state !== "closed" || closure.closedAt === undefined) throw new TypeError("terminal closure receipt requires a closed team");
  if (closure.failures.length !== 0) throw new TypeError("terminal closure receipt cannot contain failures");
  const cancelledTaskIds = teamCancelledTaskIds(team);
  if (JSON.stringify([...closure.cancelledTaskIds].sort()) !== JSON.stringify([...cancelledTaskIds].sort())) throw new TypeError("team.closure.cancelledTaskIds must match cancelled tasks");
  if (closure.outcome === "forced") {
    if (closure.forced !== true) throw new TypeError("forced closure outcome requires forced=true");
    return;
  }
  if (closure.forced !== false) throw new TypeError("non-forced closure outcome requires forced=false");
  const reconciled = team.tasks.every((task) => task.state === "cancelled" || taskSatisfiesDependency(task));
  if (!reconciled) throw new TypeError("non-forced closure requires every completed task to be accepted");
  if (closure.outcome === "succeeded") {
    if (cancelledTaskIds.length !== 0) throw new TypeError("succeeded closure cannot contain cancelled tasks");
    if (team.tasks.length === 0 || !team.tasks.every(taskSatisfiesDependency)) throw new TypeError("succeeded closure requires at least one accepted completed task");
  }
  if (closure.outcome === "cancelled" && team.tasks.length > 0 && cancelledTaskIds.length === 0) throw new TypeError("cancelled closure requires cancelled work unless the team had no tasks");
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
  const hasCancelledAt = task.cancelledAt !== undefined;
  const hasCancellationReason = task.cancellationReason !== undefined;
  if (hasCancelledAt !== hasCancellationReason) throw new TypeError("task.cancelledAt and task.cancellationReason must be present together");
  if (task.state === "cancelled" && !hasCancelledAt) throw new TypeError("cancelled state requires cancellation markers");
  if (task.state !== "cancelled" && hasCancelledAt) throw new TypeError("task cancellation markers require cancelled state");
  if (hasCancelledAt) assertIsoDate(task.cancelledAt, "task.cancelledAt");
  optionalString(task.cancellationReason, "task.cancellationReason", 4_096);
  const hasReleasedAt = task.releasedAt !== undefined;
  const hasReleaseReason = task.releaseReason !== undefined;
  if (hasReleasedAt !== hasReleaseReason) throw new TypeError("task.releasedAt and task.releaseReason must be present together");
  if (hasReleasedAt) assertIsoDate(task.releasedAt, "task.releasedAt");
  optionalString(task.releaseReason, "task.releaseReason", 4_096);
  if (task.result !== undefined) {
    if (!isRecord(task.result)) throw new TypeError("task.result must be an object");
    assertAllowedKeys(task.result, TASK_RESULT_KEYS, "task.result");
    nonEmptyString(task.result.text, "task.result.text", UI_TASK_RESULT_CHARS);
    assertIsoDate(task.result.reportedAt, "task.result.reportedAt");
    if (typeof task.result.truncated !== "boolean") throw new TypeError("task.result.truncated must be boolean");
    nonEmptyString(task.result.taskId, "task.result.taskId", 256);
    nonEmptyString(task.result.claimId, "task.result.claimId", 256);
    positiveInteger(task.result.leaseEpoch, "task.result.leaseEpoch", { allowZero: true });
    nonEmptyString(task.result.reportedBy, "task.result.reportedBy", 256);
    if (task.state !== "completed" || !taskSubmissionMatches(task) || task.result.taskId !== task.id || task.result.claimId !== task.claimId || task.result.leaseEpoch !== (task.leaseEpoch ?? 0) || task.result.reportedBy !== task.assigneeSessionId) throw new TypeError("task.result must bind the current task claimant, claim, lease, and submission");
  }
  if (task.submission !== undefined) {
    if (!isRecord(task.submission)) throw new TypeError("task.submission must be an object");
    assertAllowedKeys(task.submission, TASK_SUBMISSION_KEYS, "task.submission");
    nonEmptyString(task.submission.taskId, "task.submission.taskId", 256);
    nonEmptyString(task.submission.claimId, "task.submission.claimId", 256);
    positiveInteger(task.submission.leaseEpoch, "task.submission.leaseEpoch", { allowZero: true });
    assertIsoDate(task.submission.submittedAt, "task.submission.submittedAt");
    nonEmptyString(task.submission.submittedBy, "task.submission.submittedBy", 256);
    assertEnum(task.submission.source, ["explicit_complete", "legacy_migration"], "task.submission.source");
    if (!taskSubmissionMatches(task) || task.state !== "completed") throw new TypeError("task.submission must bind the completed task claimant and current lease");
  }
  if (task.acceptance !== undefined) {
    if (!isRecord(task.acceptance)) throw new TypeError("task.acceptance must be an object");
    assertAllowedKeys(task.acceptance, TASK_ACCEPTANCE_KEYS, "task.acceptance");
    nonEmptyString(task.acceptance.taskId, "task.acceptance.taskId", 256);
    nonEmptyString(task.acceptance.claimId, "task.acceptance.claimId", 256);
    positiveInteger(task.acceptance.leaseEpoch, "task.acceptance.leaseEpoch", { allowZero: true });
    assertIsoDate(task.acceptance.acceptedAt, "task.acceptance.acceptedAt");
    nonEmptyString(task.acceptance.acceptedBy, "task.acceptance.acceptedBy", 256);
    positiveInteger(task.acceptance.ownerEpoch, "task.acceptance.ownerEpoch", { allowZero: true });
    if (!taskAcceptanceMatches(task) || task.state !== "completed") throw new TypeError("task.acceptance must bind the submitted task claim and current lease");
  }
  positiveInteger(task.attempt ?? 0, "task.attempt", { allowZero: true });
  optionalString(task.claimId, "task.claimId", 256);
  positiveInteger(task.leaseEpoch ?? 0, "task.leaseEpoch", { allowZero: true });
  for (const [field, limit] of [["attemptHistory", MAX_TASK_ATTEMPT_HISTORY], ["interruptionHistory", MAX_TASK_INTERRUPTION_HISTORY]]) {
    const history = task[field] ?? [];
    if (!Array.isArray(history) || history.length > limit || history.some((entry) => !isRecord(entry))) throw new TypeError(`task.${field} is invalid`);
    for (const [index, entry] of history.entries()) {
      assertAllowedKeys(entry, TASK_HISTORY_KEYS, `task.${field}[${index}]`);
      nonEmptyString(entry.kind, `task.${field}[${index}].kind`, 64);
      assertIsoDate(entry.at, `task.${field}[${index}].at`);
      optionalString(entry.claimId, `task.${field}[${index}].claimId`, 256);
      optionalString(entry.reason, `task.${field}[${index}].reason`, 1_000);
      if (entry.attempt !== undefined) positiveInteger(entry.attempt, `task.${field}[${index}].attempt`, { allowZero: true });
      if (entry.leaseEpoch !== undefined) positiveInteger(entry.leaseEpoch, `task.${field}[${index}].leaseEpoch`, { allowZero: true });
    }
  }
  for (const field of ["checkpoint", "nextStep"]) if (task[field] !== undefined) {
    const entry = task[field];
    if (!isRecord(entry)) throw new TypeError(`task.${field} must be an object`);
    assertAllowedKeys(entry, TASK_CHECKPOINT_KEYS, `task.${field}`);
    nonEmptyString(entry.text, `task.${field}.text`, 4_096);
    assertIsoDate(entry.reportedAt, `task.${field}.reportedAt`);
    nonEmptyString(entry.reportedBy, `task.${field}.reportedBy`, 256);
    if (entry.verified !== false) throw new TypeError(`task.${field}.verified must be false`);
    optionalString(entry.claimId, `task.${field}.claimId`, 256);
    if (entry.leaseEpoch !== undefined) positiveInteger(entry.leaseEpoch, `task.${field}.leaseEpoch`, { allowZero: true });
  }
  if (!Array.isArray(task.capabilities ?? []) || (task.capabilities ?? []).length > 32) throw new TypeError("task.capabilities is invalid");
  (task.capabilities ?? []).forEach((entry, index) => validateCapability(entry, `task.capabilities[${index}]`));
  if (!Array.isArray(task.externalEffects ?? []) || (task.externalEffects ?? []).length > 32) throw new TypeError("task.externalEffects is invalid");
  (task.externalEffects ?? []).forEach((entry, index) => validateExternalEffect(entry, `task.externalEffects[${index}]`));
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

function validateBootstrap(bootstrap) {
  if (!isRecord(bootstrap)) throw new TypeError("team.bootstrap must be an object");
  assertAllowedKeys(bootstrap, BOOTSTRAP_KEYS, "team.bootstrap");
  nonEmptyString(bootstrap.requestId, "team.bootstrap.requestId", 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(bootstrap.inputHash, "team.bootstrap.inputHash", 64))) throw new TypeError("team.bootstrap.inputHash is invalid");
  assertEnum(bootstrap.phase, ["prepared", "running", "partial", "complete"], "team.bootstrap.phase");
  assertIsoDate(bootstrap.createdAt, "team.bootstrap.createdAt");
  assertIsoDate(bootstrap.updatedAt, "team.bootstrap.updatedAt");
  if (!Array.isArray(bootstrap.taskRefs) || bootstrap.taskRefs.length < 1 || bootstrap.taskRefs.length > MAX_BOOTSTRAP_ITEMS) throw new TypeError("team.bootstrap.taskRefs is invalid");
  if (!Array.isArray(bootstrap.memberRefs) || bootstrap.memberRefs.length < 1 || bootstrap.memberRefs.length > MAX_BOOTSTRAP_ITEMS) throw new TypeError("team.bootstrap.memberRefs is invalid");
  for (const ref of bootstrap.taskRefs) {
    if (!isRecord(ref)) throw new TypeError("team.bootstrap task ref must be an object");
    assertAllowedKeys(ref, BOOTSTRAP_TASK_REF_KEYS, "team.bootstrap task ref");
    nonEmptyString(ref.key, "team.bootstrap task key", 64);
    nonEmptyString(ref.taskId, "team.bootstrap task id", 256);
  }
  for (const ref of bootstrap.memberRefs) {
    if (!isRecord(ref)) throw new TypeError("team.bootstrap member ref must be an object");
    assertAllowedKeys(ref, BOOTSTRAP_MEMBER_REF_KEYS, "team.bootstrap member ref");
    nonEmptyString(ref.key, "team.bootstrap member key", 64);
    nonEmptyString(ref.name, "team.bootstrap member name", 120);
    assertEnum(ref.status, ["pending", "starting", "complete", "failed"], "team.bootstrap member status");
    optionalString(ref.memberId, "team.bootstrap member id", 256);
    optionalString(ref.sessionId, "team.bootstrap member session id", 256);
    optionalString(ref.errorCode, "team.bootstrap member error code", 128);
    optionalString(ref.errorStage, "team.bootstrap member error stage", 64);
  }
  if (new Set(bootstrap.taskRefs.map((ref) => ref.key)).size !== bootstrap.taskRefs.length || new Set(bootstrap.taskRefs.map((ref) => ref.taskId)).size !== bootstrap.taskRefs.length) throw new TypeError("team.bootstrap task refs must be unique");
  if (new Set(bootstrap.memberRefs.map((ref) => ref.key)).size !== bootstrap.memberRefs.length) throw new TypeError("team.bootstrap member refs must be unique");
  return bootstrap;
}

function acceptanceOwnerMatchesTeam(team, acceptance) {
  const ownerEpoch = acceptance.ownerEpoch;
  const currentEpoch = team.pauseEpoch ?? 0;
  if (ownerEpoch > currentEpoch) return false;
  if (ownerEpoch === currentEpoch) return acceptance.acceptedBy === team.rootLeadSessionId;
  const adoption = (team.ownershipHistory ?? []).find((entry) => entry.kind === "handoff_adopted" && entry.pauseEpoch === ownerEpoch + 1);
  if (adoption !== undefined) return adoption.sourceRootSessionId === acceptance.acceptedBy;
  const retainedOwner = team.members.find((member) => member.sessionId === acceptance.acceptedBy);
  return retainedOwner?.kind === "worker" && retainedOwner.state === "retired" && retainedOwner.role === "former root lead retained for durable audit references";
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
  positiveInteger(team.pauseEpoch ?? 0, "team.pauseEpoch", { allowZero: true });
  if (team.projectKey !== undefined && !/^[a-f0-9]{64}$/u.test(nonEmptyString(team.projectKey, "team.projectKey", 64))) throw new TypeError("team.projectKey is invalid");
  const ownershipHistory = team.ownershipHistory ?? [];
  if (!Array.isArray(ownershipHistory) || ownershipHistory.length > MAX_OWNERSHIP_HISTORY) throw new TypeError("team.ownershipHistory is invalid");
  for (const [index, entry] of ownershipHistory.entries()) {
    if (!isRecord(entry)) throw new TypeError(`team.ownershipHistory[${index}] must be an object`);
    assertAllowedKeys(entry, OWNERSHIP_HISTORY_KEYS, `team.ownershipHistory[${index}]`);
    assertEnum(entry.kind, ["handoff_prepared", "handoff_adopted"], `team.ownershipHistory[${index}].kind`);
    nonEmptyString(entry.sourceRootSessionId, `team.ownershipHistory[${index}].sourceRootSessionId`, 256);
    nonEmptyString(entry.targetRootSessionId, `team.ownershipHistory[${index}].targetRootSessionId`, 256);
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(entry.projectKey, `team.ownershipHistory[${index}].projectKey`, 64))) throw new TypeError("ownership history projectKey is invalid");
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(entry.tokenHash, `team.ownershipHistory[${index}].tokenHash`, 64))) throw new TypeError("ownership history tokenHash is invalid");
    assertIsoDate(entry.at, `team.ownershipHistory[${index}].at`);
    positiveInteger(entry.pauseEpoch, `team.ownershipHistory[${index}].pauseEpoch`, { allowZero: true });
  }
  if (team.plan !== undefined) validatePlan(team.plan);
  if (team.handoff !== undefined) {
    if (!isRecord(team.handoff)) throw new TypeError("team.handoff must be an object");
    assertAllowedKeys(team.handoff, HANDOFF_KEYS, "team.handoff");
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(team.handoff.tokenHash, "team.handoff.tokenHash", 64))) throw new TypeError("team.handoff.tokenHash is invalid");
    nonEmptyString(team.handoff.sourceRootSessionId, "team.handoff.sourceRootSessionId", 256);
    nonEmptyString(team.handoff.targetRootSessionId, "team.handoff.targetRootSessionId", 256);
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(team.handoff.projectKey, "team.handoff.projectKey", 64))) throw new TypeError("team.handoff.projectKey is invalid");
    if (team.projectKey !== undefined && team.handoff.projectKey !== team.projectKey) throw new TypeError("team handoff projectKey must match its canonical team projectKey");
    assertIsoDate(team.handoff.createdAt, "team.handoff.createdAt");
    assertIsoDate(team.handoff.expiresAt, "team.handoff.expiresAt");
  }
  if (team.resume !== undefined) {
    if (!isRecord(team.resume)) throw new TypeError("team.resume must be an object");
    assertAllowedKeys(team.resume, RESUME_KEYS, "team.resume");
    nonEmptyString(team.resume.previewId, "team.resume.previewId", 256);
    nonEmptyString(team.resume.requestId, "team.resume.requestId", 256);
    positiveInteger(team.resume.pauseEpoch, "team.resume.pauseEpoch", { allowZero: true });
    positiveInteger(team.resume.teamRevision, "team.resume.teamRevision");
    assertIsoDate(team.resume.createdAt, "team.resume.createdAt");
    assertEnum(team.resume.status ?? "preview", ["preview", "committed"], "team.resume.status");
    if (team.resume.committedAt !== undefined) assertIsoDate(team.resume.committedAt, "team.resume.committedAt");
    if (!Array.isArray(team.resume.nodes)) throw new TypeError("team.resume.nodes must be an array");
    for (const node of team.resume.nodes) {
      if (!isRecord(node)) throw new TypeError("team.resume node must be an object");
      assertAllowedKeys(node, RESUME_NODE_KEYS, "team.resume node");
      nonEmptyString(node.memberId, "team.resume node memberId", 256);
      assertEnum(node.status, ["ready", "attention", "excluded"], "team.resume node status");
      optionalString(node.reason, "team.resume node reason", 1_000);
    }
  }
  assertEnum(team.state, TEAM_STATES, "team.state");
  if (team.closure !== undefined) {
    if (!isRecord(team.closure)) throw new TypeError("team.closure must be an object");
    assertAllowedKeys(team.closure, TEAM_CLOSURE_KEYS, "team.closure");
    assertEnum(team.closure.outcome, TEAM_CLOSURE_OUTCOMES, "team.closure.outcome");
    assertIsoDate(team.closure.attemptedAt, "team.closure.attemptedAt");
    if (team.closure.closedAt !== undefined) assertIsoDate(team.closure.closedAt, "team.closure.closedAt");
    nonEmptyString(team.closure.reason, "team.closure.reason", 4_096);
    if (typeof team.closure.forced !== "boolean") throw new TypeError("team.closure.forced must be boolean");
    assertStringArray(team.closure.cancelledTaskIds, "team.closure.cancelledTaskIds");
    if (!Array.isArray(team.closure.failures) || team.closure.failures.some((failure) => typeof failure !== "string" || failure.length === 0 || failure.length > 4_096)) throw new TypeError("team.closure.failures must be an array of bounded strings");
    if (team.state === "closed" && team.closure.closedAt === undefined) throw new TypeError("closed team requires a closure.closedAt receipt");
    if (team.state !== "closed" && team.closure.closedAt !== undefined) throw new TypeError("only a closed team may have closure.closedAt");
  }
  if (team.state === "closed" && team.closure === undefined) throw new TypeError("closed team requires a closure receipt");
  assertIsoDate(team.createdAt, "team.createdAt");
  assertIsoDate(team.updatedAt, "team.updatedAt");
  if (!Array.isArray(team.members) || !Array.isArray(team.tasks) || !Array.isArray(team.messages)) {
    throw new TypeError("team members, tasks, and messages must be arrays");
  }
  if (team.bootstrap !== undefined) validateBootstrap(team.bootstrap);
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
  if (team.bootstrap !== undefined && team.bootstrap.taskRefs.some((ref) => !taskIds.has(ref.taskId))) throw new TypeError("team.bootstrap references an unknown task");
  const tasksById = new Map(team.tasks.map((task) => [task.id, task]));
  for (const task of team.tasks) {
    if (task.dependsOn.some((id) => !taskIds.has(id))) throw new TypeError(`task ${task.id} references an unknown dependency`);
    if (task.assigneeSessionId !== undefined && !sessions.has(task.assigneeSessionId)) throw new TypeError(`task ${task.id} has an unknown assignee`);
    if (task.acceptance !== undefined && !acceptanceOwnerMatchesTeam(team, task.acceptance)) throw new TypeError(`task ${task.id} acceptance must bind the root owner at its owner epoch`);
  }
  assertClosureSemantics(team);
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

function migrateStoreDocument(document) {
  const legacy = LEGACY_STORE_VERSIONS.has(document.version);
  for (const team of document.teams) {
    team.pauseEpoch ??= 0;
    team.ownershipHistory ??= [];
    if (team.resume !== undefined) team.resume.requestId ??= `migrated:${team.resume.previewId}`;
    if (typeof team.handoff?.projectScope === "string") {
      const legacyScope = team.handoff.projectScope;
      team.handoff.projectKey = createHash("sha256").update(JSON.stringify(["agent-teams-project-v1", legacyScope])).digest("hex");
      delete team.handoff.projectScope;
      team.projectKey ??= team.handoff.projectKey;
    }
    if (typeof team.handoff?.projectKey === "string") team.projectKey ??= team.handoff.projectKey;
    for (const task of team.tasks ?? []) {
      task.attempt ??= task.state === "in_progress" ? 1 : 0;
      task.leaseEpoch ??= team.pauseEpoch;
      task.attemptHistory ??= [];
      task.interruptionHistory ??= [];
      task.capabilities ??= [];
      task.externalEffects ??= [];
      for (const effect of task.externalEffects) effect.idempotencyKey = hostExternalEffectKey(team.id, task.id, effect.name);
      if (task.acceptance !== undefined && task.acceptance.ownerEpoch === undefined) {
        const adoption = team.ownershipHistory.find((entry) => entry.kind === "handoff_adopted" && entry.sourceRootSessionId === task.acceptance.acceptedBy);
        task.acceptance.ownerEpoch = task.acceptance.acceptedBy === team.rootLeadSessionId ? team.pauseEpoch : adoption === undefined ? team.pauseEpoch : adoption.pauseEpoch - 1;
      }
      if (["in_progress", "completed"].includes(task.state) && task.claimId === undefined) {
        task.claimId = `migrated:${task.id}:${task.attempt}`;
        if (task.state === "in_progress") boundedPush(task.attemptHistory, { kind: "migrated_claim", at: task.claimedAt ?? task.updatedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch }, MAX_TASK_ATTEMPT_HISTORY);
      }
      if (legacy && task.state === "completed") {
        task.assigneeSessionId ??= team.rootLeadSessionId;
        const completedAt = task.completedAt ?? task.updatedAt;
        task.submission ??= taskSubmission(task, task.assigneeSessionId, completedAt, "legacy_migration");
        task.acceptance ??= { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch, acceptedAt: completedAt, acceptedBy: team.rootLeadSessionId, ownerEpoch: team.pauseEpoch };
        if (task.result !== undefined) Object.assign(task.result, { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch, reportedBy: task.result.reportedBy ?? task.assigneeSessionId });
      } else if (legacy && task.state !== "completed") {
        task.result = undefined;
        task.submission = undefined;
        task.acceptance = undefined;
      }
    }
    const timestamp = team.updatedAt ?? team.createdAt ?? now();
    if (legacy && team.state === "closed") {
      terminalizeTeamTasks(team, timestamp, "legacy closed team contained unfinished work");
      const cancelledTaskIds = teamCancelledTaskIds(team);
      team.closure = {
        outcome: cancelledTaskIds.length > 0 || team.tasks.length === 0 ? "cancelled" : "succeeded",
        closedAt: timestamp, attemptedAt: timestamp, reason: "legacy closed team migrated to a consistent closure receipt", forced: false,
        cancelledTaskIds, failures: [],
      };
    }
    if (team.plan === undefined) {
      const hasActiveWorker = (team.members ?? []).some((member) => member.kind === "worker" && member.state !== "retired");
      const hasRunningTask = (team.tasks ?? []).some((task) => task.state === "in_progress");
      const continueExistingWork = hasActiveWorker || hasRunningTask;
      const hash = teamPlanHash(team);
      team.plan = continueExistingWork ? {
        phase: "active", revision: 1, hash, committedAt: timestamp, activatedAt: timestamp, migrationState: "legacy_active_gate",
        authorization: { source: "unknown", attestedAt: timestamp, confirmedPlanHash: hash, permissions: "unknown", files: "unknown", cost: "unknown", externalSideEffects: "unknown" },
      } : { phase: "draft", revision: 1, hash, migrationState: "legacy_unplanned" };
    } else {
      team.plan.migrationState ??= "ready";
      const authorization = team.plan.authorization;
      if (authorization !== undefined) {
        const oldSource = authorization.source;
        authorization.source = oldSource === "direct_user" ? "human_attested" : PLAN_AUTHORIZATION_STATES.includes(oldSource) ? oldSource : "unknown";
        authorization.confirmedPlanHash ??= team.plan.hash;
        for (const field of ["permissions", "files", "cost", "externalSideEffects"]) {
          const value = authorization[field];
          authorization[field] = value === "verified" ? authorization.source === "host_verified" ? "host_verified" : "human_attested" : PLAN_AUTHORIZATION_STATES.includes(value) ? value : "unknown";
        }
        if (authorization.source !== "host_verified") for (const field of ["permissions", "files", "cost", "externalSideEffects"]) if (authorization[field] === "host_verified") authorization[field] = "human_attested";
      }
    }
  }
  if (legacy) document.version = STORE_VERSION;
  return document;
}
/** Validate and normalize the complete disk document with non-destructive legacy migration. */
function validateStoreDocument(document) {
  if (!isRecord(document) || !(document.version === STORE_VERSION || LEGACY_STORE_VERSIONS.has(document.version)) || !isRecord(document.settings) || !Array.isArray(document.teams)) {
    throw new TypeError("agent teams store has an unsupported shape or version");
  }
  migrateStoreDocument(document);
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

function taskIsTerminal(task) {
  return TERMINAL_TASK_STATES.has(task?.state);
}
function clearTaskTerminalMetadata(task) {
  task.completedAt = undefined;
  task.cancelledAt = undefined;
  task.cancellationReason = undefined;
  task.result = undefined;
  task.submission = undefined;
  task.acceptance = undefined;
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
    blockedBy: task.dependsOn.filter((id) => !taskSatisfiesDependency(byId.get(id))),
    failedBy: task.dependsOn.filter((id) => byId.get(id)?.state === "cancelled"),
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
    return !taskSatisfiesDependency(target);
  }).map(crossTaskReference);
  const crossFailedBy = crossTeamDependencies.filter((dependency) => {
    const target = teamsById.get(dependency.teamId)?.tasks.find((candidate) => candidate.id === dependency.taskId);
    return target?.state === "cancelled";
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
    failedBy: [...base.failedBy, ...crossFailedBy],
  };
}
function progressedDependents(document, teamId, taskId) {
  const reference = taskNodeKey(teamId, taskId);
  return document.teams.flatMap((team) => team.tasks
    .filter((task) => ["in_progress", "completed"].includes(task.state) && (
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
function deriveAttention(team, teams = [team]) {
  const failedMembers = team.members.filter((member) => member.kind === "worker" && member.state === "failed").map((member) => member.id);
  const unconfirmedMembers = team.members.filter((member) => member.kind === "worker" && (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true)).map((member) => member.id);
  const activeSessions = new Set(team.members.filter((member) => !["failed", "retired"].includes(member.state)).map((member) => member.sessionId));
  const strandedTasks = team.tasks.filter((task) => !taskIsTerminal(task) && task.assigneeSessionId !== undefined && !activeSessions.has(task.assigneeSessionId)).map((task) => task.id);
  const releasedTasks = team.tasks.filter((task) => task.state === "pending" && task.assigneeSessionId === undefined && task.releaseReason !== undefined).map((task) => task.id);
  const failedDeliveries = team.messages.filter((message) => message.status === "failed").map((message) => message.id);
  const bootstrapIncomplete = team.bootstrap !== undefined && team.bootstrap.phase !== "complete";
  const planDraft = team.plan !== undefined && (!["committed", "active"].includes(team.plan.phase) || team.plan.hash !== teamPlanHash(team));
  const capabilityUnknownTasks = team.tasks.filter((task) => (task.capabilities ?? []).some((capability) => capability.status !== "verified")).map((task) => task.id);
  const outcomeUnknownTasks = team.tasks.filter((task) => (task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown")).map((task) => task.id);
  const codes = [];
  if (failedMembers.length > 0) codes.push("failed_member");
  if (unconfirmedMembers.length > 0) codes.push("unconfirmed_shutdown");
  if (strandedTasks.length > 0) codes.push("stranded_task");
  if (releasedTasks.length > 0) codes.push("released_task");
  if (failedDeliveries.length > 0) codes.push("failed_delivery");
  if (bootstrapIncomplete) codes.push("bootstrap_incomplete");
  if (planDraft) codes.push("plan_draft");
  if (capabilityUnknownTasks.length > 0) codes.push("capability_unknown");
  if (outcomeUnknownTasks.length > 0) codes.push("outcome_unknown");
  const derivedTasks = team.tasks.map((task) => deriveTaskAcrossTeams(task, team, teams));
  const blockedTasks = derivedTasks.filter((task) => task.blockedBy.length > 0).map((task) => task.id);
  const failedDependencyTasks = derivedTasks.filter((task) => task.failedBy.length > 0).map((task) => task.id);
  if (failedDependencyTasks.length > 0) codes.push("failed_dependency");
  return { required: codes.length > 0, codes, failedMembers, unconfirmedMembers, strandedTasks, releasedTasks, failedDeliveries, blockedTasks, failedDependencyTasks, bootstrapIncomplete, planDraft, capabilityUnknownTasks, outcomeUnknownTasks };
}
function projectTeam(team, nameTeams = []) {
  const members = team.members.map((member) => {
    const lifecycleState = effectiveMemberState(team, member);
    return {
      ...clone(member),
      state: lifecycleState,
      displayName: canonicalMemberName(member.name),
      status: lifecycleState,
      lastActivityAt: memberLastActivityAt(member, team),
    };
  });
  const relatedMembers = Array.isArray(nameTeams) ? nameTeams.flatMap((candidate) => candidate.members ?? []) : [];
  const names = new Map([...relatedMembers, ...members].map((member) => [member.sessionId, canonicalMemberName(member.displayName ?? member.name)]));
  const taskTeams = Array.isArray(nameTeams) ? [...new Map([team, ...nameTeams].map((candidate) => [candidate.id, candidate])).values()] : [team];
  const tasks = team.tasks.map((task) => deriveTaskAcrossTeams(task, team, taskTeams));
  const messages = team.messages.map((message) => projectMessageEvent(message, names, team.id));
  const lifecycleState = effectiveTeamState(team);
  const projectedTeam = clone(team);
  delete projectedTeam.projectKey;
  delete projectedTeam.handoff;
  projectedTeam.ownershipHistory = (team.ownershipHistory ?? []).map((entry) => ({
    kind: entry.kind,
    sourceRootSessionId: entry.sourceRootSessionId,
    targetRootSessionId: entry.targetRootSessionId,
    at: entry.at,
    pauseEpoch: entry.pauseEpoch,
  }));
  return {
    ...projectedTeam,
    ...(team.handoff === undefined ? {} : { handoff: { targetRootSessionId: team.handoff.targetRootSessionId, createdAt: team.handoff.createdAt, expiresAt: team.handoff.expiresAt } }),
    state: lifecycleState,
    leadSessionId: team.rootLeadSessionId,
    objective: team.objective ?? team.name,
    status: lifecycleState,
    ...(team.closure === undefined ? {} : { closureOutcome: team.closure.outcome }),
    revision: team.revision ?? 1,
    lastActivityAt: latestTimestamp([
      team.updatedAt,
      ...members.map((member) => member.lastActivityAt),
      ...tasks.map((task) => task.updatedAt),
      ...messages.flatMap((message) => [message.createdAt, message.deliveredAt]),
    ]) ?? team.updatedAt,
    members,
    tasks,
    attention: deriveAttention(team, taskTeams),
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
  const active = tasks.filter((task) => !taskIsTerminal(task)).sort(newestFirst);
  const terminal = tasks.filter(taskIsTerminal).sort(newestFirst);
  return [...active, ...terminal].slice(0, UI_MAX_TASKS_PER_TEAM);
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
    const crossBlockedBy = crossTeamDependencies.filter((dependency) => !taskSatisfiesDependency(taskMapsByTeam.get(dependency.teamId)?.get(dependency.taskId))).map(crossTaskReference);
    const crossFailedBy = crossTeamDependencies.filter((dependency) => taskMapsByTeam.get(dependency.teamId)?.get(dependency.taskId)?.state === "cancelled").map(crossTaskReference);
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
        ...task.dependsOn.filter((id) => !taskSatisfiesDependency(localById.get(id))),
        ...crossBlockedBy,
      ],
      failedBy: [
        ...task.dependsOn.filter((id) => localById.get(id)?.state === "cancelled"),
        ...crossFailedBy,
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
function taskDetailMember(member) {
  if (member === undefined) return null;
  return { name: member.name, displayName: canonicalMemberName(member.name) };
}
function taskWorkflowTime(value) {
  if (!Number.isFinite(value)) return undefined;
  try { return new Date(value).toISOString(); } catch { return undefined; }
}
function taskWorkflowText(value, limit = 500) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/gu, " ").slice(0, limit);
}
function taskWorkflowStatus(reason) {
  const kind = typeof reason?.kind === "string" ? reason.kind : "unknown";
  if (kind === "completed") return { status: "completed", reason: "completed" };
  if (kind === "error") return { status: "failed", reason: "error" };
  if (kind === "aborted" || kind === "interrupted") return { status: "stopped", reason: kind };
  if (kind === "blocked") return { status: "blocked", reason: "blocked" };
  if (kind === "max-tokens") return { status: "continued", reason: "max-tokens" };
  return { status: "unknown", reason: "unknown" };
}
function redactTaskWorkflowPaths(value) {
  return value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`<>|]+/gu, "[path hidden]")
    .replace(/(^|[\s(])\/(?!\/)[^\s"'`<>|]+/gu, "$1[path hidden]")
    .replace(/(^|[\s(])(?:\.{1,2}[\\/])[^\s"'`<>|]+/gu, "$1[path hidden]")
    .replace(/(^|[\s(])(?:src|tests?|plugins?|apps?|packages?|lib|docs?|config|electron|scripts?|public|assets?)[\\/][^\s"'`<>|]+/giu, "$1[path hidden]")
    .replace(/(^|[\s(])(?:[\p{L}\p{N}_.@-]+[\\/]){2,}[\p{L}\p{N}_.@-]+(?=$|[\s),.;:])/giu, "$1[path hidden]")
    .replace(/(^|[\s(])(?:[\p{L}\p{N}_.@-]+[\\/])*[\p{L}\p{N}_@-]+\.(?:cjs|mjs|js|jsx|ts|tsx|json|css|scss|less|html?|vue|svelte|md|mdx|txt|ya?ml|toml|ini|xml|csv|sql|sh|ps1|py|go|rs|java|kt|swift|png|jpe?g|gif|webp|svg|lock)(?=$|[\s),;:])/giu, "$1[path hidden]")
    .replace(/(^|[\s(])\.env(?:\.[\p{L}\p{N}_.@-]+)?(?=$|[\s),;:])/giu, "$1[path hidden]");
}
function projectTaskPlanItems(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, UI_MAX_TASK_PLAN_ITEMS).map((item) => ({
    content: redactTaskWorkflowPaths(taskWorkflowText(item?.content, 500)),
    status: TASK_STATES.includes(item?.status) ? item.status : "pending",
  })).filter((item) => item.content.length > 0);
}
function taskRuntimeProjection(task, member, agent) {
  const claimedAt = Date.parse(task.claimedAt ?? "");
  const completedAt = Date.parse(task.completedAt ?? "");
  const allEvents = Array.isArray(agent?.session?.events) ? agent.session.events : [];
  let sourceEvents = [];
  let sourceTruncated = false;
  if (allEvents.length > 0 && Number.isFinite(claimedAt)) {
    const startTime = claimedAt - 1_000;
    const endTime = Number.isFinite(completedAt) ? completedAt + 5_000 : Number.POSITIVE_INFINITY;
    let low = 0, high = allEvents.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2), time = allEvents[middle]?.time;
      if (Number.isFinite(time) && time < startTime) low = middle + 1;
      else high = middle;
    }
    const first = low;
    low = first; high = allEvents.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2), time = allEvents[middle]?.time;
      if (Number.isFinite(time) && time <= endTime) low = middle + 1;
      else high = middle;
    }
    const after = low;
    sourceTruncated = after - first > UI_MAX_TASK_RUNTIME_SOURCE_EVENTS;
    sourceEvents = allEvents.slice(Math.max(first, after - UI_MAX_TASK_RUNTIME_SOURCE_EVENTS), after)
      .filter((event) => Number.isFinite(event?.time) && event.time >= startTime && event.time <= endTime);
  }
  const results = new Map();
  const stepEnds = new Map();
  const turnEnds = new Map();
  for (const event of sourceEvents) {
    if (event.type === "tool/result") {
      const callId = event.data?.message?.callId ?? event.data?.callId;
      if (typeof callId === "string") results.set(callId, event);
    } else if (event.type === "step/end") stepEnds.set(`${event.data?.turn ?? ""}:${event.data?.step ?? ""}`, event);
    else if (event.type === "turn/end") turnEnds.set(String(event.data?.turn ?? ""), event);
  }
  let plan = [];
  let observedModel = null;
  const workflow = [];
  for (const event of sourceEvents) {
    const at = taskWorkflowTime(event.time);
    if (!at) continue;
    const sequence = Number.isSafeInteger(event.seq) ? event.seq : workflow.length;
    if (event.type === "turn/start") {
      const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : undefined;
      const end = turnEnds.get(String(turn ?? ""));
      const outcome = end ? taskWorkflowStatus(end.data?.reason) : { status: "running", reason: "" };
      workflow.push({ id: `turn:${sequence}`, kind: "turn", sequence, at, turn, status: outcome.status, reason: outcome.reason, ...(end ? { completedAt: taskWorkflowTime(end.time) } : {}) });
    } else if (event.type === "step/start") {
      const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : undefined;
      const step = Number.isSafeInteger(event.data?.step) ? event.data.step : undefined;
      const end = stepEnds.get(`${turn ?? ""}:${step ?? ""}`);
      workflow.push({ id: `step:${sequence}`, kind: "step", sequence, at, turn, step, status: end ? "completed" : "running", ...(end ? { completedAt: taskWorkflowTime(end.time) } : {}) });
    } else if (event.type === "tool/call") {
      const callId = typeof event.data?.callId === "string" ? event.data.callId : "";
      const toolName = taskWorkflowText(event.data?.name, 128);
      if (!toolName || toolName === "todo_write") continue;
      const result = callId ? results.get(callId) : undefined;
      const failed = result?.data?.message?.isError === true || result?.data?.isError === true || result?.data?.error !== undefined;
      workflow.push({ id: `tool:${sequence}`, kind: "tool", sequence, at, toolName, status: result ? failed ? "failed" : "completed" : "running", ...(result ? { completedAt: taskWorkflowTime(result.time) } : {}) });
    } else if (event.type === "todo/write") {
      plan = projectTaskPlanItems(event.data?.todos);
      const completed = plan.filter((item) => item.status === "completed").length;
      const inProgress = plan.filter((item) => item.status === "in_progress").length;
      workflow.push({ id: `plan:${sequence}`, kind: "plan", sequence, at, status: "completed", counts: { total: plan.length, completed, inProgress, pending: Math.max(0, plan.length - completed - inProgress) } });
    } else if (event.type === "assistant/message") {
      const source = event.data?.message?.source;
      if (typeof source?.model === "string" || typeof source?.provider === "string") {
        observedModel = {
          ...(typeof source.model === "string" ? { model: source.model.slice(0, 256) } : {}),
          ...(typeof source.provider === "string" ? { provider: source.provider.slice(0, 128) } : {}),
        };
      }
      const content = Array.isArray(event.data?.message?.content) ? event.data.message.content : [];
      if (!content.some((block) => block?.type === "tool-call")) workflow.push({ id: `model:${sequence}`, kind: "model", sequence, at, status: event.data?.interrupted === true ? "stopped" : "completed" });
    } else if (event.type === "llm/retry") workflow.push({ id: `retry:${sequence}`, kind: "retry", sequence, at, status: "running" });
  }
  const counts = {
    total: plan.length,
    completed: plan.filter((item) => item.status === "completed").length,
    inProgress: plan.filter((item) => item.status === "in_progress").length,
    pending: plan.filter((item) => item.status === "pending").length,
  };
  const percent = task.state === "completed" ? 100 : task.state === "cancelled" ? null : counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : task.state === "pending" ? 0 : null;
  const executionModel = (observedModel || member && (member.model || member.provider)) ? {
    ...(observedModel ?? {}),
    ...(!observedModel && member?.model ? { model: member.model } : {}),
    ...(!observedModel && member?.provider ? { provider: member.provider } : {}),
    ...(member?.modelTier ? { modelTier: member.modelTier } : {}),
    ...(member?.inheritsMain !== undefined ? { inheritsMain: member.inheritsMain } : {}),
    observed: observedModel !== null,
  } : null;
  const visibleWorkflow = workflow.slice(-UI_MAX_TASK_WORKFLOW_EVENTS);
  return {
    progress: { percent, source: counts.total > 0 ? "plan" : "status", indeterminate: percent === null, ...counts },
    plan,
    workflow: {
      events: visibleWorkflow,
      truncated: sourceTruncated || visibleWorkflow.length < workflow.length,
      totalEvents: workflow.length,
      lastEventAt: visibleWorkflow.at(-1)?.at ?? null,
    },
    executionModel,
  };
}
function taskExecutionWindow(task) {
  const start = Date.parse(task.claimedAt ?? "");
  if (!Number.isFinite(start)) return null;
  const completed = Date.parse(task.completedAt ?? "");
  return { start, end: Number.isFinite(completed) ? completed : Number.POSITIVE_INFINITY };
}
function taskExecutionOverlap(left, right) {
  const leftWindow = taskExecutionWindow(left), rightWindow = taskExecutionWindow(right);
  return leftWindow !== null && rightWindow !== null && leftWindow.start <= rightWindow.end && rightWindow.start <= leftWindow.end;
}
function projectTaskDetailForUi(ctx, document, sessionId, selectedTeamId, selectedTaskId) {
  const team = document.teams.find((candidate) => candidate.id === selectedTeamId);
  if (team === undefined || memberOf(team, sessionId) === undefined) return null;
  const task = team.tasks.find((candidate) => candidate.id === selectedTaskId);
  if (task === undefined || sessionId !== team.rootLeadSessionId && task.assigneeSessionId !== sessionId) return null;
  const assigned = task.assigneeSessionId === undefined ? undefined : team.members.find((member) => member.sessionId === task.assigneeSessionId);
  const responsible = team.members.find((member) => member.sessionId === team.rootLeadSessionId);
  const overlapsAnotherTask = assigned !== undefined && team.tasks.some((candidate) => candidate.id !== task.id
    && candidate.assigneeSessionId === assigned.sessionId && taskExecutionOverlap(task, candidate));
  const workflowUnavailableReason = assigned?.kind === "lead" ? "shared_lead_session" : overlapsAnotherTask ? "overlapping_tasks" : null;
  let agent;
  try { agent = assigned === undefined || workflowUnavailableReason !== null ? undefined : ctx?.agents?.get?.(assigned.sessionId); } catch { agent = undefined; }
  const runtime = taskRuntimeProjection(task, assigned, agent);
  runtime.workflow.reliable = workflowUnavailableReason === null;
  runtime.workflow.unavailableReason = workflowUnavailableReason ?? (task.claimedAt !== undefined && agent === undefined ? "session_unavailable" : null);
  return {
    taskId: task.id,
    summary: task.title,
    description: typeof task.description === "string" ? task.description.slice(0, UI_TASK_DETAIL_DESCRIPTION_CHARS) : "",
    status: task.state,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    claimedAt: task.claimedAt ?? null,
    completedAt: task.completedAt ?? null,
    claimant: task.state !== "pending" || task.claimedAt !== undefined ? taskDetailMember(assigned) : null,
    responsible: taskDetailMember(responsible),
    progress: runtime.progress,
    plan: runtime.plan,
    workflow: runtime.workflow,
    executionModel: runtime.executionModel,
    result: task.result ?? null,
  };
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
  const members = team.members.map((member) => {
    const lifecycleState = effectiveMemberState(team, member);
    return {
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
      state: lifecycleState,
      status: lifecycleState,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      lastActivityAt: memberActivity.get(member.sessionId) ?? member.updatedAt,
    };
  });
  const lastActivityAt = latestTimestamp([
    team.updatedAt,
    ...memberActivity.values(),
    ...team.tasks.map((task) => task.updatedAt),
    ...team.messages.flatMap((message) => [message.createdAt, message.deliveredAt]),
  ]) ?? team.updatedAt;
  const lifecycleState = effectiveTeamState(team);
  const ownershipHistory = (team.ownershipHistory ?? []).slice(-UI_MAX_OWNERSHIP_EVENTS).map((entry) => ({
    kind: entry.kind,
    at: entry.at,
    pauseEpoch: entry.pauseEpoch,
  }));
  return {
    id: team.id,
    rootLeadSessionId: team.rootLeadSessionId,
    name: team.name,
    objective: team.objective,
    revision: team.revision ?? 1,
    state: lifecycleState,
    status: lifecycleState,
    ...(team.closure === undefined ? {} : { closureOutcome: team.closure.outcome }),
    pauseEpoch: team.pauseEpoch ?? 0,
    plan: clone(team.plan),
    ...(team.closure === undefined ? {} : { closure: clone(team.closure) }),
    ...(team.resume === undefined ? {} : { resume: clone(team.resume) }),
    ...(team.handoff === undefined ? {} : { handoff: { targetRootSessionId: team.handoff.targetRootSessionId, createdAt: team.handoff.createdAt, expiresAt: team.handoff.expiresAt } }),
    ownershipHistory,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    leadSessionId: team.rootLeadSessionId,
    lastActivityAt,
    taskCount: team.tasks.length,
    eventCount: team.messages.length + rawInbound.length,
    projection: {
      tasksTruncated: tasks.length < team.tasks.length,
      eventsTruncated: visibleMessages.length < team.messages.length || inboundEvents.length < rawInbound.length,
      ownershipHistoryTruncated: ownershipHistory.length < (team.ownershipHistory ?? []).length,
    },
    // Cross-team inbound delivery history is metadata-only; message bodies remain host-private.
    inboundEvents,
    members,
    tasks,
    messages: visibleMessages,
    attention: (() => { const value = deriveAttention(team, [team, ...peerTeams]); return { required: value.required, codes: value.codes, failedMemberCount: value.failedMembers.length, strandedTaskCount: value.strandedTasks.length, failedDeliveryCount: value.failedDeliveries.length }; })(),
  };
}
function projectTeamSummary(team) {
  return {
    id: team.id,
    name: team.name,
    status: effectiveTeamState(team),
    revision: team.revision ?? 1,
    pauseEpoch: team.pauseEpoch ?? 0,
    planPhase: team.plan?.phase ?? "active",
    memberCount: team.members.filter((member) => member.state !== "retired").length,
    activeTaskCount: team.tasks.filter((task) => task.state === "in_progress").length,
    pendingTaskCount: team.tasks.filter((task) => task.state === "pending").length,
    completedTaskCount: team.tasks.filter((task) => task.state === "completed").length,
    cancelledTaskCount: team.tasks.filter((task) => task.state === "cancelled").length,
    ...(team.closure === undefined ? {} : { closureOutcome: team.closure.outcome }),
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
function admissionFailure(message, code) {
  return new HarnessError(message, code);
}
function admissionCancellation() {
  return admissionFailure("team worker admission was cancelled before activation", "AGENT_TEAMS_ADMISSION_CANCELLED");
}
function createTeamTurnAdmission({
  limit = GLOBAL_TEAM_ACTIVE_ACTIVATIONS,
  maxQueued = MAX_TEAM_ADMISSION_QUEUE,
  maxQueuedPerRoot = MAX_TEAM_ADMISSION_QUEUE_PER_ROOT,
  waitMs = TEAM_ADMISSION_TIMEOUT_MS,
} = {}) {
  for (const [field, value] of [["limit", limit], ["maxQueued", maxQueued], ["maxQueuedPerRoot", maxQueuedPerRoot], ["waitMs", waitMs]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  }
  let active = 0;
  let queued = 0;
  let closed = false;
  const queues = new Map();
  const rootRing = [];
  const leases = new Map();

  const removeRootFromRing = (root) => {
    const index = rootRing.indexOf(root);
    if (index >= 0) rootRing.splice(index, 1);
  };
  const cleanupWaiter = (waiter) => {
    if (waiter.timer !== undefined) clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener?.("abort", waiter.onAbort);
  };
  const rejectWaiter = (waiter, error) => {
    if (waiter.settled) return;
    waiter.settled = true;
    cleanupWaiter(waiter);
    waiter.reject(error);
  };
  const releaseSlot = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      pump();
    };
  };
  const grant = (waiter) => {
    if (waiter.settled) return;
    waiter.settled = true;
    cleanupWaiter(waiter);
    active += 1;
    waiter.resolve(releaseSlot());
  };
  const detach = (waiter) => {
    if (waiter.settled) return false;
    const rootQueue = queues.get(waiter.root);
    const index = rootQueue?.indexOf(waiter) ?? -1;
    if (index < 0) return false;
    rootQueue.splice(index, 1);
    queued -= 1;
    if (rootQueue.length === 0) {
      queues.delete(waiter.root);
      removeRootFromRing(waiter.root);
    }
    return true;
  };
  function pump() {
    while (!closed && active < limit && rootRing.length > 0) {
      const root = rootRing.shift();
      const rootQueue = queues.get(root);
      if (rootQueue === undefined || rootQueue.length === 0) {
        queues.delete(root);
        continue;
      }
      const waiter = rootQueue.shift();
      queued -= 1;
      if (rootQueue.length === 0) queues.delete(root);
      else rootRing.push(root);
      grant(waiter);
    }
  }
  const acquire = (root, signal) => {
    if ((typeof root !== "object" && typeof root !== "function") || root === null) throw new TypeError("root must be the exact live root Agent object");
    if (closed) return Promise.reject(admissionFailure("team worker admission is closed", "AGENT_TEAMS_ADMISSION_CLOSED"));
    if (signal?.aborted) return Promise.reject(admissionCancellation());
    if (active < limit && rootRing.length === 0) {
      active += 1;
      return Promise.resolve(releaseSlot());
    }
    const rootQueue = queues.get(root) ?? [];
    if (queued >= maxQueued || rootQueue.length >= maxQueuedPerRoot) {
      return Promise.reject(admissionFailure("team worker admission queue is full; retry after active work settles", "AGENT_TEAMS_ADMISSION_QUEUE_FULL"));
    }
    return new Promise((resolve, rejectPromise) => {
      const waiter = { root, signal, resolve, reject: rejectPromise, settled: false, timer: undefined, onAbort: undefined };
      waiter.onAbort = () => {
        if (!detach(waiter)) return;
        rejectWaiter(waiter, admissionCancellation());
        pump();
      };
      waiter.timer = setTimeout(() => {
        if (!detach(waiter)) return;
        rejectWaiter(waiter, admissionFailure("team worker admission timed out before activation; retry later", "AGENT_TEAMS_ADMISSION_TIMEOUT"));
        pump();
      }, waitMs);
      waiter.timer.unref?.();
      signal?.addEventListener?.("abort", waiter.onAbort, { once: true });
      rootQueue.push(waiter);
      queued += 1;
      if (!queues.has(root)) {
        queues.set(root, rootQueue);
        rootRing.push(root);
      }
      pump();
    });
  };
  const abandon = (childId) => {
    const lease = leases.get(childId);
    if (lease === undefined || lease.runId !== undefined) return false;
    leases.delete(childId);
    lease.release();
    return true;
  };
  const run = async (root, childId, signal, operation) => {
    nonEmptyString(childId, "childId", 256);
    if (typeof operation !== "function") throw new TypeError("team worker admission operation must be a function");
    if (closed) throw admissionFailure("team worker admission is closed", "AGENT_TEAMS_ADMISSION_CLOSED");
    let lease = leases.get(childId);
    let created = false;
    if (lease === undefined) {
      const release = await acquire(root, signal);
      if (closed) {
        release();
        throw admissionFailure("team worker admission is closed", "AGENT_TEAMS_ADMISSION_CLOSED");
      }
      if (signal?.aborted) {
        release();
        throw admissionCancellation();
      }
      lease = leases.get(childId);
      if (lease === undefined) {
        lease = { root, runId: undefined, release };
        leases.set(childId, lease);
        created = true;
      } else release();
    }
    if (lease.root !== root) reject("team worker activation belongs to another exact root", "AGENT_TEAMS_UNAUTHORIZED");
    if (signal?.aborted) {
      if (created) abandon(childId);
      throw admissionCancellation();
    }
    try {
      return await operation();
    } catch (error) {
      if (created && leases.get(childId) === lease && lease.runId === undefined) abandon(childId);
      throw error;
    }
  };
  const noteStart = (info) => {
    const lease = leases.get(info?.id);
    if (lease === undefined || info?.runId === undefined) return false;
    const runId = String(info.runId);
    if (lease.runId !== undefined && lease.runId !== runId) return false;
    lease.runId = runId;
    return true;
  };
  const noteEnd = (info) => {
    const lease = leases.get(info?.id);
    if (lease === undefined || lease.runId === undefined || info?.runId === undefined || lease.runId !== String(info.runId)) return false;
    leases.delete(info.id);
    lease.release();
    return true;
  };
  const cancelRoot = (root, error = admissionCancellation()) => {
    const rootQueue = queues.get(root);
    if (rootQueue === undefined) return 0;
    queues.delete(root);
    removeRootFromRing(root);
    queued -= rootQueue.length;
    for (const waiter of rootQueue) rejectWaiter(waiter, error);
    pump();
    return rootQueue.length;
  };
  const close = () => {
    if (closed) return;
    closed = true;
    const error = admissionFailure("team worker admission closed before activation", "AGENT_TEAMS_ADMISSION_CLOSED");
    for (const rootQueue of queues.values()) for (const waiter of rootQueue) rejectWaiter(waiter, error);
    queues.clear();
    rootRing.length = 0;
    queued = 0;
  };
  const snapshot = () => ({ active, queued, closed, limit, maxQueued, maxQueuedPerRoot, waitMs });
  return { abandon, cancelRoot, close, noteEnd, noteStart, run, snapshot };
}
function registerGracefulLifecycleWaiter(childId) {
  const initialRunId = GRACEFUL_ACTIVE_RUNS.get(childId);
  let resolve, rejectPromise;
  const promise = new Promise((done, fail) => { resolve = done; rejectPromise = fail; });
  const waiter = { initialRunId, starts: [], ends: [], accepted: false, targetRunId: undefined, resolve, reject: rejectPromise };
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
    const matched = waiter.targetRunId === undefined ? waiter.ends.at(-1) : waiter.ends.find((event) => event.runId === waiter.targetRunId);
    remove();
    if (["error", "refusal"].includes(matched?.stopReason)) {
      rejectPromise(new HarnessError(`team member ended graceful retirement with ${matched.stopReason}`, "AGENT_TEAMS_GRACEFUL_RETIREMENT_FAILED"));
    } else resolve(matched);
  };
  waiter.accept = () => {
    waiter.accepted = true;
    if (waiter.initialRunId !== undefined) waiter.targetRunId = waiter.starts.at(-1) ?? waiter.initialRunId;
    else if (waiter.starts.length > 0) waiter.targetRunId = waiter.starts.at(-1);
    settleIfMatched();
  };
  waiter.start = (runId) => { waiter.starts.push(runId); };
  waiter.end = (runId, stopReason) => {
    waiter.ends.push({ runId, stopReason });
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
  for (const waiter of GRACEFUL_LIFECYCLE_WAITERS.get(info.id) ?? []) waiter.end(runId, info.stopReason);
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
      migrated = LEGACY_STORE_VERSIONS.has(persisted?.version);
      this.document = validateStoreDocument(persisted);
      this.fileStamp = await this.#currentFileStamp();
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      // Disabled-by-default must not create storage on mere plugin activation.
      return this.snapshot();
    }
    let changed = false;
    for (const team of this.document.teams) {
      if (team.state === "closed") {
        if (team.tasks.some((task) => !taskIsTerminal(task))) {
          team.updatedAt = now();
          terminalizeTeamTasks(team, team.updatedAt, "legacy closed team contained unfinished work");
          changed = true;
        }
        continue;
      }
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
      for (const task of team.tasks) {
        if (task.state !== "pending" || typeof task.assigneeSessionId !== "string" || !task.assigneeSessionId.startsWith("provisioning:")) continue;
        const placeholder = team.members.find((member) => member.sessionId === task.assigneeSessionId);
        if (placeholder === undefined || placeholder.state !== "failed") continue;
        task.assigneeSessionId = undefined;
        task.updatedAt = now();
        boundedPush(task.interruptionHistory, { kind: "host_restart_during_provisioning", at: task.updatedAt, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0 }, MAX_TASK_INTERRUPTION_HISTORY);
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
      teamChanged = reconcileSafePlanAuthorization(team) || teamChanged;
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
  close() {
    this.listeners.clear();
    const instances = STORE_INSTANCES.get(this.filePath);
    instances?.delete(this);
    if (instances?.size === 0) STORE_INSTANCES.delete(this.filePath);
  }
  isEnabled() {
    return this.document.settings.enabled === true;
  }
  hasManagedMember(sessionId) {
    return this.document.teams.some((team) => team.state !== "closed" && memberOf(team, sessionId) !== undefined);
  }
  memberLifecycleToken(sessionId) {
    const team = this.document.teams.find((candidate) => candidate.state !== "closed" && memberOf(candidate, sessionId) !== undefined);
    if (team === undefined) return undefined;
    return { teamId: team.id, teamState: effectiveTeamState(team), pauseEpoch: team.pauseEpoch ?? 0 };
  }
  activeTeamsForRoot(rootSessionId) {
    return this.document.teams.filter((team) => team.rootLeadSessionId === rootSessionId && effectiveTeamState(team) === "active").map((team) => ({
      teamId: team.id,
      childIds: team.members.filter((member) => member.kind === "worker" && STOPPABLE_MEMBER_STATES.has(member.state)).map((member) => member.sessionId),
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
  notify() {
    publishStoreDocument(this.filePath, this.document, this.fileStamp);
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
function currentTurnKey(agent) {
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const event = agent.session.events[index];
    if (event?.type !== "turn/start") continue;
    return createHash("sha256").update(JSON.stringify(["agent-teams-turn-v1", agent.id, index, event.id ?? null, event.time ?? null])).digest("hex");
  }
  return reject("agent-team tools require an open model turn", "AGENT_TEAMS_DRIVER_REQUIRED");
}
function toolExecution(ctx, exec) {
  const agent = exec.agent;
  if (agent === undefined) reject("agent-team tools require a calling agent", "AGENT_TEAMS_AGENT_REQUIRED");
  if (ctx.agents.get(agent.id) !== agent || agent.status !== "running" || ctx.agents.currentInitiator() !== agent) {
    reject("agent-team tools require the exact live calling agent inside its active driver", "AGENT_TEAMS_DRIVER_REQUIRED");
  }
  return { agent, events: openTurn(agent), turnKey: currentTurnKey(agent) };
}
function hasDirectHumanRootAuthority(ctx, execution) {
  return ctx.agents.roots().includes(execution.agent)
    && execution.events.some((event) => event.type === "user/message" && event.data?.source?.kind === "user");
}
function requireDirectHumanRoot(ctx, execution) {
  if (!ctx.agents.roots().includes(execution.agent)) reject("team_start requires a top-level root agent");
  if (!hasDirectHumanRootAuthority(ctx, execution)) {
    reject("team_start requires direct host-attested human input in the current root turn");
  }
}
function canonicalResolveUnknownArguments(input) {
  return {
    action: "resolve_unknown",
    team_id: input.teamId,
    task_id: input.taskId,
    effect_name: input.effectName,
    attempt_id: input.attemptId,
    outcome: input.outcome,
  };
}
function resolveUnknownArgumentsHash(input) {
  return createHash("sha256").update(JSON.stringify(canonicalResolveUnknownArguments(input))).digest("hex");
}
function createResolveUnknownAuthorizationGate(provider, options = {}) {
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const consumed = new Set();
  return Object.freeze({
    async consume(request) {
      const authorizationId = nonEmptyString(request.authorizationId, "authorizationId", 256);
      if (request.tool !== RESOLVE_UNKNOWN_AUTHORIZATION_TOOL) reject("Host authorization is bound to a different tool", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
      for (const key of ["rootSessionId", "turnKey", "teamId", "taskId", "effectName", "attemptId"]) nonEmptyString(request[key], `authorization.${key}`, 256);
      assertEnum(request.outcome, ["succeeded", "failed", "not_started"], "authorization.outcome");
      positiveInteger(request.pauseEpoch, "authorization.pauseEpoch", { allowZero: true });
      positiveInteger(request.teamRevision, "authorization.teamRevision");
      if (request.canonicalArgumentsHash !== resolveUnknownArgumentsHash(request)) reject("Host authorization canonical parameter digest is invalid", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
      if (typeof provider?.consumeResolveUnknown !== "function") reject("resolve_unknown requires a registered Host authorization provider", "AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE");
      if (consumed.has(authorizationId)) reject("Host authorization was already consumed", "AGENT_TEAMS_HOST_AUTHORIZATION_REPLAY");
      if (consumed.size >= MAX_RESOLVE_UNKNOWN_AUTHORIZATIONS) reject("Host authorization replay fence is at capacity", "AGENT_TEAMS_HOST_AUTHORIZATION_CAPACITY");
      // Burn before awaiting the Host so concurrent calls with the same id cannot both pass.
      consumed.add(authorizationId);
      const receipt = await provider.consumeResolveUnknown(Object.freeze(clone(request)));
      if (!isRecord(receipt)) reject("Host authorization receipt is missing", "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID");
      try { assertAllowedKeys(receipt, RESOLVE_UNKNOWN_AUTHORIZATION_KEYS, "resolve_unknown Host authorization"); }
      catch { return reject("Host authorization receipt has unsupported fields", "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID"); }
      for (const key of RESOLVE_UNKNOWN_AUTHORIZATION_KEYS) {
        if (key === "expiresAt") continue;
        if (receipt[key] !== request[key]) reject(`Host authorization does not bind ${key}`, "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
      }
      const current = clock();
      if (!Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= current) reject("Host authorization expired", "AGENT_TEAMS_HOST_AUTHORIZATION_EXPIRED");
      if (receipt.expiresAt > current + RESOLVE_UNKNOWN_AUTHORIZATION_TTL_MS) reject("Host authorization lifetime exceeds the short-lived limit", "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID");
      return Object.freeze({ ...receipt, [RESOLVE_UNKNOWN_AUTHORIZATION_BRAND]: true });
    },
  });
}
async function authorizeResolveUnknown(store, gate, execution, input) {
  const authorizationId = nonEmptyString(input.authorizationId, "authorizationId", 256);
  const outcome = input.outcome;
  assertEnum(outcome, ["succeeded", "failed", "not_started"], "outcome");
  const target = await store.read((document) => {
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), execution.agent.id);
    const task = team.tasks.find((candidate) => candidate.id === nonEmptyString(input.taskId, "taskId", 256));
    if (task === undefined || taskIsTerminal(task)) reject("external effect update requires an unfinished task", "AGENT_TEAMS_TASK_CONFLICT");
    const effectName = nonEmptyString(input.effectName, "effectName", 200);
    const effect = task.externalEffects.find((candidate) => candidate.name === effectName);
    if (effect === undefined) reject("unknown declared external effect", "AGENT_TEAMS_NOT_FOUND");
    if (effect.outcome !== "outcome_unknown") reject("effect outcome is not unknown", "AGENT_TEAMS_CONFLICT");
    const attemptId = nonEmptyString(input.attemptId, "attemptId", 256);
    if (attemptId !== effect.attemptId) reject("external effect attempt is missing or stale", "AGENT_TEAMS_STALE_EXTERNAL_EFFECT");
    return { teamId: team.id, taskId: task.id, effectName, attemptId, pauseEpoch: team.pauseEpoch ?? 0, teamRevision: team.revision };
  });
  const request = {
    authorizationId,
    tool: RESOLVE_UNKNOWN_AUTHORIZATION_TOOL,
    rootSessionId: execution.agent.id,
    turnKey: execution.turnKey,
    ...target,
    outcome,
    canonicalArgumentsHash: resolveUnknownArgumentsHash({ ...target, outcome }),
  };
  return gate.consume(request);
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
  if (member === undefined) reject("caller is not an active member of this team", "AGENT_TEAMS_UNAUTHORIZED");
  if (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true) {
    reject("member shutdown is unconfirmed; only the live root lead may recover or retire it", "AGENT_TEAMS_SHUTDOWN_UNCONFIRMED");
  }
  if (!["running", "idle", "ready"].includes(member.state)) reject("caller is not an active member of this team", "AGENT_TEAMS_UNAUTHORIZED");
  return member;
}
function requireAssignableMember(member) {
  if (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true || !["running", "idle", "ready"].includes(member.state)) {
    reject(`target assignee is not assignable (current state: ${member.state})`, "AGENT_TEAMS_ASSIGNEE_UNAVAILABLE");
  }
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
function terminalizeTeamTasks(team, timestamp = now(), reason = "team closed before unfinished work was completed") {
  const cancelledTaskIds = [];
  for (const task of team.tasks) {
    if (taskIsTerminal(task)) continue;
    task.state = "cancelled";
    task.assigneeSessionId = undefined;
    task.claimedAt = undefined;
    task.completedAt = undefined;
    task.result = undefined;
    task.submission = undefined;
    task.acceptance = undefined;
    task.cancelledAt = timestamp;
    task.cancellationReason = reason;
        task.updatedAt = timestamp;
    cancelledTaskIds.push(task.id);
  }
  return cancelledTaskIds;
}
function closeTeamRecord(team, reason = "team closed before delivery acknowledgement", { forced = false, failures = [] } = {}) {
  const timestamp = now();
  if (failures.length > 0) reject("a failed shutdown attempt cannot be persisted as a closed team", "AGENT_TEAMS_INVALID_CLOSURE");
  if (!forced) {
    const unacceptedTaskIds = team.tasks.filter((task) => task.state === "completed" && !taskAcceptanceMatches(task)).map((task) => task.id);
    if (unacceptedTaskIds.length > 0) reject(`non-forced closure has unaccepted completed tasks: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
  }
  for (const message of team.messages) {
    if (message.status !== "pending") continue;
    message.status = "failed";
    message.deliveryError = reason;
  }
  terminalizeTeamTasks(team, timestamp, reason);
  const cancelledTaskIds = teamCancelledTaskIds(team);
  const outcome = forced ? "forced" : cancelledTaskIds.length > 0 || team.tasks.length === 0 ? "cancelled" : "succeeded";
  team.closure = { outcome, closedAt: timestamp, attemptedAt: timestamp, reason, forced, cancelledTaskIds, failures: [] };
  team.state = "closed";
  team.updatedAt = timestamp;
  USER_PAUSED_TEAMS.delete(team.id);
  USER_PAUSE_RECONCILIATIONS.delete(team.id);
  USER_PAUSE_EPOCHS.delete(team.id);
}
function exactLiveLead(ctx, team) {
  const lead = ctx.agents.get(team.rootLeadSessionId);
  if (lead === undefined || !ctx.agents.roots().includes(lead)) reject("the exact live root lead is unavailable", "AGENT_TEAMS_LEAD_UNAVAILABLE");
  return lead;
}
function requireExactRootAgent(ctx, lead) {
  if (ctx.agents.get(lead.id) !== lead || !ctx.agents.roots().includes(lead)) {
    reject("the exact live root lead changed while team worker admission was pending", "AGENT_TEAMS_LEAD_UNAVAILABLE");
  }
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
function resolveUniqueLeadTeam(document, teamId, leadSessionId, predicate = (team) => team.state !== "closed") {
  const explicit = optionalString(teamId, "teamId", 256);
  if (explicit !== undefined) {
    const team = findTeam(document, explicit);
    requireLead(team, leadSessionId);
    if (!predicate(team)) reject("team is not in the required lifecycle state", "AGENT_TEAMS_CONFLICT");
    return team;
  }
  const candidates = document.teams.filter((team) => team.rootLeadSessionId === leadSessionId && predicate(team));
  if (candidates.length === 0) reject("root lead has no matching team", "AGENT_TEAMS_NOT_FOUND");
  if (candidates.length > 1) reject("team_id is required when more than one team matches", "AGENT_TEAMS_TEAM_REQUIRED");
  return candidates[0];
}
function requireCommonFixedLead(sourceTeam, targetTeam, sessionId) {
  if (sourceTeam.rootLeadSessionId !== targetTeam.rootLeadSessionId || sourceTeam.rootLeadSessionId !== sessionId) {
    reject("cross-team actions require the same fixed root lead to own both teams", "AGENT_TEAMS_CROSS_TEAM_FORBIDDEN");
  }
}
function registrationPrompt(teamId, memberName, role) {
  return `You are being provisioned as ${memberName} (${role}) for agent team ${teamId}. Do not begin any task in this turn. Do not infer work from prior context. Reply only that you are waiting for the coordinator registration follow-up; membership must be durably persisted before work starts.`;
}
function workPrompt(teamId, memberId, prompt, taskIds = []) {
  const taskNotice = taskIds.length === 0 ? "" : ` Durable assigned task IDs: ${taskIds.join(", ")}. Claim only an unblocked task already assigned to your session before doing its work.`;
  return `Coordinator registration complete. Team ${teamId}; member ${memberId}. You may now begin the assigned work.${taskNotice} Keep the claimId and leaseEpoch returned by claim; echo both on checkpoint, completion, or release so stale attempts cannot write. A report, message, or successful turn end does not complete a durable team task: immediately call team_task_update with action=complete after its deliverable is actually finished and before sending the final report; otherwise explicitly release it. Use agent-team tools for team tasks and coordinator relays. You cannot create or fork agents. If your in-progress task can be split into genuinely independent parallel outcomes, use team_expansion_request with explicit deliverables, acceptance criteria, and non-overlapping file/resource boundaries. This is only a proposal: the root coordinator decides whether to create persistent tasks and visible peer members without bypassing maxMembers or maxActiveTurns. Assignment:\n${prompt}`;
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
async function submitExpansionRequest(ctx, store, admission, caller, input, signal) {
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
  return sendTeamMessage(ctx, store, admission, caller, {
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
    const initialPlanHash = createHash("sha256").update(JSON.stringify({ objective, tasks: [] })).digest("hex");
    const team = {
      id: randomUUID(),
      rootLeadSessionId: lead.id,
      name: nonEmptyString(input.name ?? objective.slice(0, 500), "name", 500),
      objective,
      state: "active",
      pauseEpoch: 0,
      ...(optionalProjectKeyForRoot(lead) === undefined ? {} : { projectKey: optionalProjectKeyForRoot(lead) }),
      ownershipHistory: [],
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
      plan: { phase: "draft", revision: 1, hash: initialPlanHash, migrationState: "ready" },
    };
    document.teams.push(team);
    return projectTeam(team);
  });
}

function planFilesAreConflictFree(team) {
  const tasks = team.tasks.filter((task) => !taskIsTerminal(task));
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const dependsTransitively = (task, targetId, seen = new Set()) => (task.dependsOn ?? []).some((dependencyId) => {
    if (dependencyId === targetId) return true;
    if (seen.has(dependencyId)) return false;
    seen.add(dependencyId);
    const dependency = byId.get(dependencyId);
    return dependency !== undefined && dependsTransitively(dependency, targetId, seen);
  });
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const left = tasks[leftIndex], right = tasks[rightIndex];
      if (dependsTransitively(left, right.id) || dependsTransitively(right, left.id)) continue;
      if ((left.files ?? []).some((leftFile) => (right.files ?? []).some((rightFile) => fileBoundaryOverlap(leftFile, rightFile)))) return false;
    }
  }
  return true;
}

function planCapabilitiesAreVerified(team) {
  return team.tasks.every((task) => task.capabilities.every((capability) => capability.status === "verified"));
}
function planEffectsAreOrdinary(team) {
  return team.tasks.every((task) => task.externalEffects.every((effect) => effect.policy === "none" && effect.outcome !== "outcome_unknown"));
}
function reconcileSafePlanAuthorization(team, timestamp = now()) {
  const plan = team.plan;
  if (!["committed", "active"].includes(plan?.phase) || plan.migrationState !== "ready" || plan.hash !== teamPlanHash(team) || plan.authorization?.confirmedPlanHash !== plan.hash) return false;
  const authorization = plan.authorization;
  if (authorization.source === "host_verified") return false;
  let changed = false;
  const attestIfSafe = (field, safe) => {
    if (!safe || authorization[field] !== "unknown") return;
    authorization[field] = "human_attested";
    changed = true;
  };
  attestIfSafe("permissions", planCapabilitiesAreVerified(team));
  attestIfSafe("files", planFilesAreConflictFree(team));
  // The direct user's ordinary AI-routing grant covers the default model tier chosen
  // by the root. Unknown or separately billed capabilities remain capability facts;
  // existing members' main/subagent tiers neither prove nor expand future cost.
  attestIfSafe("cost", true);
  attestIfSafe("externalSideEffects", planEffectsAreOrdinary(team));
  if (changed || authorization.source === "unknown") {
    authorization.source = "human_attested";
    authorization.attestedAt = timestamp;
    changed = true;
  }
  return changed;
}
function assertAutomaticPlanRecommitAllowed(ctx, team, lead) {
  requireLiveRootLead(ctx, team, lead);
  requireActiveTeam(team);
  if (!teamHasEstablishedWorker(team)) reject("automatic plan recommit requires a team already established from a direct-human turn", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  const currentProjectKey = projectKeyForRoot(lead);
  if (team.projectKey === undefined || team.projectKey !== currentProjectKey) reject("automatic plan recommit requires the same canonical project scope", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
  if (team.tasks.some((task) => task.capabilities.some((capability) => capability.status === "unavailable"))) reject("automatic plan recommit cannot use an unavailable capability", "AGENT_TEAMS_CAPABILITY_UNAVAILABLE");
  if (!planCapabilitiesAreVerified(team)) reject("automatic plan recommit cannot expand unknown capabilities", "AGENT_TEAMS_CAPABILITY_UNKNOWN");
  if (!planFilesAreConflictFree(team)) reject("automatic plan recommit requires conflict-free file ownership", "AGENT_TEAMS_FILE_CONFLICT");
  if (!planEffectsAreOrdinary(team)) reject("automatic plan recommit is limited to effect-free internal work", "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
}

async function commitTeamPlan(ctx, store, lead, input) {
  return store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const team = optionalString(input.teamId, "teamId", 256) === undefined
      ? resolveUniqueLeadTeam(document, undefined, lead.id, (candidate) => candidate.state === "active")
      : findTeam(document, input.teamId);
    requireLiveRootLead(ctx, team, lead);
    requireActiveTeam(team);
    if (input.automaticContinuation === true) assertAutomaticPlanRecommitAllowed(ctx, team, lead);
    const expectedRevision = input.expectedRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) reject("expected_revision must be a positive integer", "AGENT_TEAMS_PLAN_CAS_REQUIRED");
    if (team.plan.revision !== expectedRevision) reject("team plan changed; preview it again before commit", "AGENT_TEAMS_STALE_PLAN");
    const currentHash = teamPlanHash(team);
    const confirmedPlanHash = optionalString(input.confirmedPlanHash, "confirmedPlanHash", 64);
    if (confirmedPlanHash === undefined) reject("confirmed_plan_hash is required for plan CAS", "AGENT_TEAMS_PLAN_CAS_REQUIRED");
    if (!/^[a-f0-9]{64}$/u.test(confirmedPlanHash) || confirmedPlanHash !== currentHash) reject("confirmed_plan_hash must match the exact current Host projection", "AGENT_TEAMS_STALE_PLAN");
    const targetPhase = team.plan.phase === "active"
      || teamHasEstablishedWorker(team)
      || team.tasks.some((task) => task.state === "in_progress")
      ? "active"
      : "committed";
    if (team.plan.phase === targetPhase && team.plan.hash === currentHash && team.plan.authorization?.confirmedPlanHash === currentHash && team.plan.migrationState === "ready") {
      if (reconcileSafePlanAuthorization(team)) team.updatedAt = now();
      return { teamId: team.id, plan: clone(team.plan), reused: true };
    }
    if (team.tasks.length === 0) reject("a team plan must persist at least one task before commit", "AGENT_TEAMS_EMPTY_PLAN");
    for (const task of team.tasks) {
      if (task.capabilities.some((capability) => capability.status === "unavailable")) reject(`task ${task.id} requires an unavailable capability`, "AGENT_TEAMS_CAPABILITY_UNAVAILABLE");
      if (task.externalEffects.some((effect) => effect.policy === "forbidden")) reject(`task ${task.id} declares a forbidden external side effect`, "AGENT_TEAMS_EXTERNAL_EFFECT_FORBIDDEN");
      if (task.externalEffects.some((effect) => effect.outcome === "outcome_unknown")) reject(`task ${task.id} has an unknown external side-effect outcome`, "AGENT_TEAMS_OUTCOME_UNKNOWN");
    }
    const timestamp = now();
    // Enabling Agent Teams is a continuing human attestation for ordinary,
    // project-bounded internal automation. Caller booleans remain compatible but
    // are never Host proof and cannot upgrade an unsafe or unresolved fact.
    const asserted = "human_attested";
    const capabilitiesVerified = team.tasks.every((task) => task.capabilities.every((capability) => capability.status === "verified"));
    const filesConflictFree = planFilesAreConflictFree(team);
    const ordinaryEffectsOnly = team.tasks.every((task) => task.externalEffects.every((effect) => effect.policy === "none"));
    const explicitlyAttestedEffects = input.externalSideEffectsVerified === true
      && team.tasks.every((task) => task.externalEffects.every((effect) => effect.policy !== "confirm_each"));
    const authorization = {
      source: asserted,
      attestedAt: timestamp,
      confirmedPlanHash: currentHash,
      permissions: capabilitiesVerified ? asserted : "unknown",
      files: filesConflictFree ? asserted : "unknown",
      cost: asserted,
      externalSideEffects: ordinaryEffectsOnly || explicitlyAttestedEffects ? asserted : "unknown",
    };
    if (team.tasks.some((task) => task.externalEffects.some((effect) => effect.policy === "confirm_each"))) {
      reject("confirm_each external effects require a trusted Host UI verification token", "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
    }
    // Unknown capabilities and conflicting file scopes are never bulk-upgraded by
    // booleans or model/tool input. A future Host verifier must attest them.
    team.plan = {
      phase: "committed", revision: team.plan.revision, hash: currentHash,
      committedAt: timestamp, migrationState: "ready", authorization,
    };
    if (targetPhase === "active") {
      team.plan.phase = "active";
      team.plan.activatedAt = timestamp;
    }
    team.updatedAt = timestamp;
    return { teamId: team.id, plan: clone(team.plan), reused: false };
  }));
}
function projectScopeForRoot(root) {
  const cwd = root?.session?.header?.cwd;
  if (typeof cwd !== "string" || cwd.trim().length === 0) reject("project scope is unavailable; safe handoff cannot be verified", "AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN");
  const normalized = cwd.trim().replace(/\\/gu, "/").replace(/\/+$/u, "").normalize("NFKC");
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}
function projectKeyForRoot(root) {
  return createHash("sha256").update(JSON.stringify(["agent-teams-project-v1", projectScopeForRoot(root)])).digest("hex");
}
function optionalProjectKeyForRoot(root) {
  try { return projectKeyForRoot(root); } catch { return undefined; }
}
async function prepareTeamHandoff(ctx, store, lead, input) {
  const targetId = nonEmptyString(input.targetRootSessionId, "targetRootSessionId", 256);
  const target = ctx.agents.get(targetId);
  if (target === undefined || !ctx.agents.roots().includes(target) || target === lead) reject("target must be another exact live root", "AGENT_TEAMS_HANDOFF_TARGET_INVALID");
  const sourceProjectKey = projectKeyForRoot(lead), targetProjectKey = projectKeyForRoot(target);
  if (sourceProjectKey !== targetProjectKey) reject("cross-project team handoff is forbidden", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
  const token = randomUUID();
  const tokenHash = createHash("sha256").update(token).digest("hex");
  return store.runOperation(() => store.mutate((document) => {
    const team = optionalString(input.teamId, "teamId", 256) === undefined ? resolveUniqueLeadTeam(document, undefined, lead.id) : findTeam(document, input.teamId);
    requireLiveRootLead(ctx, team, lead);
    if (team.state !== "paused") reject("team must be paused before handoff", "AGENT_TEAMS_HANDOFF_REQUIRES_PAUSE");
    if (team.projectKey !== undefined && team.projectKey !== sourceProjectKey) reject("team canonical project identity no longer matches this root", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
    const timestamp = now();
    team.projectKey = sourceProjectKey;
    team.ownershipHistory ??= [];
    team.handoff = { tokenHash, sourceRootSessionId: lead.id, targetRootSessionId: target.id, projectKey: sourceProjectKey, createdAt: timestamp, expiresAt: new Date(Date.parse(timestamp) + 10 * 60 * 1_000).toISOString() };
    boundedPush(team.ownershipHistory, { kind: "handoff_prepared", sourceRootSessionId: lead.id, targetRootSessionId: target.id, projectKey: sourceProjectKey, tokenHash, at: timestamp, pauseEpoch: team.pauseEpoch ?? 0 }, MAX_OWNERSHIP_HISTORY);
    team.updatedAt = timestamp;
    return { teamId: team.id, handoffToken: token, expiresAt: team.handoff.expiresAt, targetRootSessionId: target.id };
  }));
}
async function adoptTeamHandoff(ctx, store, target, input) {
  const token = nonEmptyString(input.handoffToken, "handoffToken", 256);
  const presentedTokenHash = createHash("sha256").update(token).digest("hex");
  return store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    const handoff = team.handoff;
    if (team.state !== "paused") reject("team must remain paused through adoption", "AGENT_TEAMS_HANDOFF_REQUIRES_PAUSE");
    if (handoff === undefined || handoff.targetRootSessionId !== target.id || Date.parse(handoff.expiresAt) <= Date.now() || handoff.tokenHash !== presentedTokenHash) reject("handoff token is missing, expired, consumed, or does not target this root", "AGENT_TEAMS_HANDOFF_INVALID");
    if (!ctx.agents.roots().includes(target) || ctx.agents.get(target.id) !== target) reject("adoption requires the exact live target root", "AGENT_TEAMS_UNAUTHORIZED");
    const targetProjectKey = projectKeyForRoot(target);
    if (targetProjectKey !== handoff.projectKey || targetProjectKey !== team.projectKey) reject("cross-project team adoption is forbidden", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
    const sourceLead = team.members.find((member) => member.kind === "lead" && member.sessionId === handoff.sourceRootSessionId);
    if (sourceLead === undefined) reject("handoff source lead changed", "AGENT_TEAMS_HANDOFF_INVALID");
    if (team.members.some((member) => member.sessionId === target.id)) reject("target root already has an audit identity in this team", "AGENT_TEAMS_HANDOFF_TARGET_INVALID");
    const targetOpenTeams = document.teams.filter((candidate) => candidate.id !== team.id && candidate.rootLeadSessionId === target.id && candidate.state !== "closed").length;
    if (targetOpenTeams >= HARD_MAX_TEAMS_PER_ROOT) reject("target root peer-team limit reached", "AGENT_TEAMS_TEAM_LIMIT");
    const timestamp = now();
    team.pauseEpoch = (team.pauseEpoch ?? 0) + 1;
    sourceLead.role = "former root lead retained for durable audit references";
    for (const member of team.members) {
      if (member.kind === "lead") {
        member.kind = "worker";
        member.role = "former root lead retained for durable audit references";
      }
      if (member.kind !== "worker") continue;
      member.state = "retired";
      member.runId = undefined;
      member.shutdownUnconfirmed = undefined;
      member.stopUnconfirmed = undefined;
      member.error = "retired at same-project ownership adoption; audit-only and never automatically woken";
      member.updatedAt = timestamp;
    }
    for (const task of team.tasks) {
      if (!taskIsTerminal(task)) {
        boundedPush(task.interruptionHistory, { kind: "ownership_adopted", at: timestamp, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, reason: `ownership moved at pause epoch ${team.pauseEpoch}` }, MAX_TASK_INTERRUPTION_HISTORY);
        task.state = "pending";
        task.assigneeSessionId = undefined;
        task.claimedAt = undefined;
        task.claimId = undefined;
        // Preserve the last bounded, explicitly unverified member checkpoint across
        // ownership transfer. Its old claimId/leaseEpoch/reportedBy remain audit data,
        // never authority for the new owner or a new attempt.
        task.leaseEpoch = team.pauseEpoch;
        clearTaskTerminalMetadata(task);
        task.releasedAt = timestamp;
        task.releaseReason = "released during same-project ownership adoption; prior parent lease revoked";
        task.updatedAt = timestamp;
      }
    }
    const selection = { modelTier: "main", inheritsMain: false, routeSource: "live-lead", ...(optionalProvider(target.options) === undefined ? {} : { provider: optionalProvider(target.options) }), ...(optionalString(target.options?.model, "target model", 256) === undefined ? {} : { model: target.options.model.trim() }) };
    team.members.push({ id: `lead:${target.id}`, sessionId: target.id, name: normalizeMemberName(input.leadName ?? "Lead", "leadName"), role: "root lead and coordinator", ...selection, kind: "lead", state: "running", createdAt: timestamp, updatedAt: timestamp });
    team.rootLeadSessionId = target.id;
    team.ownershipHistory ??= [];
    boundedPush(team.ownershipHistory, { kind: "handoff_adopted", sourceRootSessionId: handoff.sourceRootSessionId, targetRootSessionId: target.id, projectKey: handoff.projectKey, tokenHash: handoff.tokenHash, at: timestamp, pauseEpoch: team.pauseEpoch }, MAX_OWNERSHIP_HISTORY);
    team.handoff = undefined;
    team.resume = undefined;
    USER_PAUSED_TEAMS.add(team.id);
    USER_PAUSE_EPOCHS.set(team.id, team.pauseEpoch);
    team.updatedAt = timestamp;
    return { teamId: team.id, adopted: true, automaticallyWoken: false, pauseEpoch: team.pauseEpoch, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === target.id || candidate.id === team.id)) };
  }));
}

function assertTaskExecutionPreflight(team, tasks) {
  if (!["committed", "active"].includes(team.plan?.phase) || team.plan.hash !== teamPlanHash(team) || team.plan.authorization?.confirmedPlanHash !== team.plan.hash) reject("team plan is draft or materially changed; commit the current plan before claiming or spawning", "AGENT_TEAMS_PLAN_NOT_ACTIVE");
  if (team.plan.migrationState !== "ready") reject("legacy team must pass the current plan migration gate before new claim or spawn", "AGENT_TEAMS_PLAN_MIGRATION_REQUIRED");
  if (tasks.length === 0) reject("public spawn requires at least one persisted task binding", "AGENT_TEAMS_TASK_BINDING_REQUIRED");
  for (const task of tasks) {
    const unresolved = (task.capabilities ?? []).filter((capability) => capability.status !== "verified");
    if (unresolved.length > 0) reject(`task ${task.id} capability preflight is not verified: ${unresolved.map((entry) => entry.name).join(", ")}`, unresolved.some((entry) => entry.status === "unavailable") ? "AGENT_TEAMS_CAPABILITY_UNAVAILABLE" : "AGENT_TEAMS_CAPABILITY_UNKNOWN");
    if ((task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown")) reject(`task ${task.id} is blocked by outcome_unknown`, "AGENT_TEAMS_OUTCOME_UNKNOWN");
    if ((task.externalEffects ?? []).some((effect) => effect.policy === "forbidden")) reject(`task ${task.id} declares a forbidden external side effect`, "AGENT_TEAMS_EXTERNAL_EFFECT_FORBIDDEN");
    if ((task.externalEffects ?? []).some((effect) => effect.policy === "confirm_each") && team.plan.authorization?.externalSideEffects !== "host_verified") reject(`task ${task.id} external side effects lack trusted Host verification`, "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
    if ((task.externalEffects ?? []).some((effect) => effect.policy !== "none") && !["host_verified", "human_attested"].includes(team.plan.authorization?.externalSideEffects)) reject(`task ${task.id} external side effects require an explicit authorization`, "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
  }
}

function normalizeBootstrapInput(input) {
  const requestId = nonEmptyString(input.requestId, "requestId", 256);
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > MAX_BOOTSTRAP_ITEMS) reject(`bootstrap tasks must contain 1 through ${MAX_BOOTSTRAP_ITEMS} items`, "AGENT_TEAMS_INVALID_BOOTSTRAP");
  if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > MAX_BOOTSTRAP_ITEMS) reject(`bootstrap members must contain 1 through ${MAX_BOOTSTRAP_ITEMS} items`, "AGENT_TEAMS_INVALID_BOOTSTRAP");
  const members = input.members.map((member, index) => ({
    key: nonEmptyString(member.key, `members[${index}].key`, 64),
    name: normalizeWorkerName(member.name),
    role: nonEmptyString(member.role, `members[${index}].role`, 500),
    prompt: nonEmptyString(member.prompt, `members[${index}].prompt`, 65_536),
    modelTier: member.modelTier === undefined ? "subagent" : assertEnum(member.modelTier, MODEL_TIERS, `members[${index}].modelTier`) ?? member.modelTier,
    ...(optionalString(member.model, `members[${index}].model`, 256) === undefined ? {} : { model: member.model.trim() }),
  }));
  if (new Set(members.map((member) => member.key)).size !== members.length) reject("bootstrap member keys must be unique", "AGENT_TEAMS_INVALID_BOOTSTRAP");
  if (new Set(members.map((member) => memberNameKey(member.name))).size !== members.length) reject("bootstrap member names must be unique", "AGENT_TEAMS_DUPLICATE_MEMBER_NAME");
  const memberKeys = new Set(members.map((member) => member.key));
  const tasks = input.tasks.map((task, index) => {
    const dependsOn = task.dependsOn ?? [];
    const files = task.files ?? [];
    assertStringArray(dependsOn, `tasks[${index}].dependsOn`);
    assertStringArray(files, `tasks[${index}].files`);
    return {
      key: nonEmptyString(task.key, `tasks[${index}].key`, 64),
      title: nonEmptyString(task.title, `tasks[${index}].title`, 500),
      ...(optionalString(task.description, `tasks[${index}].description`, 32_768) === undefined ? {} : { description: task.description.trim() }),
      memberKey: nonEmptyString(task.memberKey, `tasks[${index}].memberKey`, 64),
      dependsOn: [...new Set(dependsOn.map((value) => nonEmptyString(value, `tasks[${index}].dependsOn item`, 64)))],
      files: [...new Set(files.map((value) => nonEmptyString(value, `tasks[${index}].files item`, 1_024)))],
    };
  });
  const taskKeys = new Set(tasks.map((task) => task.key));
  if (taskKeys.size !== tasks.length) reject("bootstrap task keys must be unique", "AGENT_TEAMS_INVALID_BOOTSTRAP");
  for (const task of tasks) {
    if (!memberKeys.has(task.memberKey)) reject(`bootstrap task ${task.key} references an unknown member key`, "AGENT_TEAMS_INVALID_BOOTSTRAP");
    if (task.dependsOn.includes(task.key) || task.dependsOn.some((key) => !taskKeys.has(key))) reject(`bootstrap task ${task.key} has an invalid dependency`, "AGENT_TEAMS_INVALID_BOOTSTRAP");
  }
  if (members.some((member) => tasks.every((task) => task.memberKey !== member.key))) reject("every bootstrap member must own at least one durable task", "AGENT_TEAMS_INVALID_BOOTSTRAP");
  for (let index = 0; index < tasks.length; index += 1) for (let candidate = 0; candidate < index; candidate += 1) {
    const left = tasks[candidate], right = tasks[index];
    if (left.memberKey === right.memberKey) continue;
    for (const leftFile of left.files) for (const rightFile of right.files) if (fileBoundaryOverlap(leftFile, rightFile)) {
      reject(`bootstrap tasks ${left.key} and ${right.key} assign overlapping file boundaries to different members`, "AGENT_TEAMS_BOOTSTRAP_SCOPE_CONFLICT");
    }
  }
  const visiting = new Set(), visited = new Set(), byKey = new Map(tasks.map((task) => [task.key, task]));
  const visit = (key) => { if (visiting.has(key)) reject("bootstrap task dependency cycle detected", "AGENT_TEAMS_INVALID_BOOTSTRAP"); if (visited.has(key)) return; visiting.add(key); for (const dependency of byKey.get(key).dependsOn) visit(dependency); visiting.delete(key); visited.add(key); };
  for (const key of taskKeys) visit(key);
  const normalized = {
    requestId,
    objective: nonEmptyString(input.objective, "objective", 16_384),
    ...(optionalString(input.name, "name", 500) === undefined ? {} : { name: input.name.trim() }),
    leadName: normalizeMemberName(input.leadName ?? "Lead", "leadName"),
    tasks,
    members,
  };
  return { ...normalized, inputHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}
function bootstrapResult(team, reused, error) {
  return {
    operation: { requestId: team.bootstrap.requestId, phase: team.bootstrap.phase, reused },
    team: projectTeam(team),
    taskRefs: clone(team.bootstrap.taskRefs),
    memberRefs: clone(team.bootstrap.memberRefs),
    ...(error === undefined ? {} : { error }),
  };
}
function annotateStage(error, stage) {
  if (error !== null && typeof error === "object" && error.stage === undefined) error.stage = stage;
  return error;
}
async function bootstrapTeam(ctx, store, admission, lead, input, signal) {
  const plan = normalizeBootstrapInput(input);
  const mainSelection = await resolveModelSelection(store, "main", undefined, lead.options);
  await Promise.all(plan.members.map((member) => resolveModelSelection(store, member.modelTier, member.model, lead.options)));
  requireExactRootAgent(ctx, lead);
  const prepared = await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const existing = document.teams.find((team) => team.rootLeadSessionId === lead.id && team.bootstrap?.requestId === plan.requestId);
    if (existing !== undefined) {
      requireLiveRootLead(ctx, existing, lead);
      if (existing.bootstrap.inputHash !== plan.inputHash) reject("bootstrap request_id was already used with different input", "AGENT_TEAMS_IDEMPOTENCY_CONFLICT");
      requireActiveTeam(existing);
      return { teamId: existing.id, reused: true };
    }
    if (document.teams.filter((team) => team.rootLeadSessionId === lead.id && team.state !== "closed").length >= HARD_MAX_TEAMS_PER_ROOT) reject(`root lead peer-team limit reached (${HARD_MAX_TEAMS_PER_ROOT})`, "AGENT_TEAMS_TEAM_LIMIT");
    if (plan.members.length > document.settings.maxMembers) reject("bootstrap exceeds the configured teammate limit", "AGENT_TEAMS_MEMBER_LIMIT");
    if (activeWorkerTurnsForLead(document, lead.id) + plan.members.length > document.settings.maxActiveTurns) reject("bootstrap exceeds the root lead active-turn limit", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
    const timestamp = now(), teamId = randomUUID();
    const taskIds = new Map(plan.tasks.map((task) => [task.key, randomUUID()]));
    const team = {
      id: teamId, rootLeadSessionId: lead.id, name: plan.name ?? plan.objective.slice(0, 500), objective: plan.objective, state: "active", pauseEpoch: 0, ...(optionalProjectKeyForRoot(lead) === undefined ? {} : { projectKey: optionalProjectKeyForRoot(lead) }), ownershipHistory: [], createdAt: timestamp, updatedAt: timestamp,
      members: [{ id: `lead:${lead.id}`, sessionId: lead.id, name: plan.leadName, role: "root lead and coordinator", ...mainSelection, kind: "lead", state: "running", createdAt: timestamp, updatedAt: timestamp }],
      tasks: plan.tasks.map((task) => ({ id: taskIds.get(task.key), title: task.title, ...(task.description === undefined ? {} : { description: task.description }), state: "pending", dependsOn: task.dependsOn.map((key) => taskIds.get(key)), files: task.files, attempt: 0, leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], capabilities: [], externalEffects: [], createdAt: timestamp, updatedAt: timestamp })),
      messages: [],
      bootstrap: { requestId: plan.requestId, inputHash: plan.inputHash, phase: "prepared", taskRefs: plan.tasks.map((task) => ({ key: task.key, taskId: taskIds.get(task.key) })), memberRefs: plan.members.map((member) => ({ key: member.key, name: member.name, status: "pending" })), createdAt: timestamp, updatedAt: timestamp },
    };
    const bootstrapPlanHash = teamPlanHash(team);
    team.plan = {
      phase: "active", revision: 1, hash: bootstrapPlanHash, committedAt: timestamp, activatedAt: timestamp, migrationState: "ready",
      authorization: { source: "human_attested", attestedAt: timestamp, confirmedPlanHash: bootstrapPlanHash, permissions: "human_attested", files: "human_attested", cost: "human_attested", externalSideEffects: "human_attested" },
    };
    document.teams.push(team);
    return { teamId, reused: false };
  }));
  for (const memberPlan of plan.members) {
    const state = await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, prepared.teamId), ref = team.bootstrap.memberRefs.find((candidate) => candidate.key === memberPlan.key);
      requireActiveTeam(team);
      if (ref.status === "complete") return { skip: true };
      if (ref.status === "starting" && ref.memberId !== undefined) {
        const member = team.members.find((candidate) => candidate.id === ref.memberId);
        if (member !== undefined) return { blocked: true, error: { code: "AGENT_TEAMS_BOOTSTRAP_UNCERTAIN", stage: "member-reconcile", retryable: false } };
      }
      if (ref.status === "failed" && ref.memberId !== undefined) return { blocked: true, error: { code: ref.errorCode ?? "AGENT_TEAMS_BOOTSTRAP_PARTIAL", stage: ref.errorStage ?? "member-start", retryable: false } };
      ref.status = "starting"; ref.errorCode = undefined; ref.errorStage = undefined; ref.memberId = undefined; ref.sessionId = undefined;
      team.bootstrap.phase = "running"; team.bootstrap.updatedAt = now(); team.updatedAt = team.bootstrap.updatedAt;
      return { skip: false };
    }));
    if (state.skip) continue;
    if (state.blocked) {
      const team = await store.read((document) => findTeam(document, prepared.teamId));
      return bootstrapResult(team, true, state.error);
    }
    try {
      const taskIds = plan.tasks.filter((task) => task.memberKey === memberPlan.key).map((task) => task.key);
      const persistedTaskIds = await store.read((document) => { const team = findTeam(document, prepared.teamId); return taskIds.map((key) => team.bootstrap.taskRefs.find((ref) => ref.key === key).taskId); });
      const spawned = await spawnMember(ctx, store, admission, lead, { teamId: prepared.teamId, name: memberPlan.name, role: memberPlan.role, prompt: memberPlan.prompt, modelTier: memberPlan.modelTier, model: memberPlan.model, taskIds: persistedTaskIds }, signal);
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, prepared.teamId), ref = team.bootstrap.memberRefs.find((candidate) => candidate.key === memberPlan.key);
        ref.status = "complete"; ref.memberId = spawned.member.id; ref.sessionId = spawned.member.sessionId; ref.errorCode = undefined; ref.errorStage = undefined;
        team.bootstrap.updatedAt = now(); team.bootstrap.phase = team.bootstrap.memberRefs.every((candidate) => candidate.status === "complete") ? "complete" : "running"; team.updatedAt = team.bootstrap.updatedAt;
      }));
    } catch (cause) {
      const stage = cause?.stage ?? (String(cause?.code ?? "").startsWith("AGENT_TEAMS_ADMISSION_") ? "admission" : "member-start");
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, prepared.teamId), ref = team.bootstrap.memberRefs.find((candidate) => candidate.key === memberPlan.key);
        const failed = [...team.members].reverse().find((candidate) => memberNameKey(candidate.name) === memberNameKey(memberPlan.name) && candidate.kind === "worker");
        ref.status = "failed"; ref.memberId = failed?.id; ref.sessionId = failed?.sessionId; ref.errorCode = cause?.code ?? "AGENT_TEAMS_BOOTSTRAP_FAILED"; ref.errorStage = stage;
        team.bootstrap.phase = "partial"; team.bootstrap.updatedAt = now(); team.updatedAt = team.bootstrap.updatedAt;
      }));
      const team = await store.read((document) => findTeam(document, prepared.teamId));
      return bootstrapResult(team, prepared.reused, { code: cause?.code ?? "AGENT_TEAMS_BOOTSTRAP_FAILED", stage, retryable: team.bootstrap.memberRefs.find((ref) => ref.key === memberPlan.key).memberId === undefined });
    }
  }
  const team = await store.read((document) => findTeam(document, prepared.teamId));
  return bootstrapResult(team, prepared.reused);
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
    record.publishedAt = undefined;
    record.updatedAt = now();
    for (const task of team.tasks) if (task.state === "pending" && (task.assigneeSessionId === cleanup.childId || task.assigneeSessionId === `provisioning:${cleanup.memberId}`)) {
      task.assigneeSessionId = undefined;
      task.updatedAt = record.updatedAt;
      boundedPush(task.interruptionHistory, { kind: "member_start_failed", at: record.updatedAt, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0, reason: cleanup.phase }, MAX_TASK_INTERRUPTION_HISTORY);
    }
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
async function spawnMember(ctx, store, admission, lead, input, signal) {
  const modelSelection = await resolveModelSelection(store, input.modelTier ?? "subagent", input.model, lead.options);
  const reservation = await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const team = optionalString(input.teamId, "teamId", 256) === undefined ? resolveUniqueLeadTeam(document, undefined, lead.id, (candidate) => candidate.state === "active") : findTeam(document, input.teamId);
    requireLiveRootLead(ctx, team, lead);
    requireActiveTeam(team);
    if (team.members.filter(workerConsumesMemberSlot).length >= document.settings.maxMembers) reject("team teammate limit reached", "AGENT_TEAMS_MEMBER_LIMIT");
    if (activeWorkerTurnsForLead(document, team.rootLeadSessionId) >= document.settings.maxActiveTurns) reject("root lead active-turn limit reached across its teams", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
    const memberName = normalizeWorkerName(input.name);
    const memberNameIdentity = memberNameKey(memberName);
    if (team.members.some((member) => memberNameKey(member.name) === memberNameIdentity)) reject("a team member already uses this normalized display name", "AGENT_TEAMS_DUPLICATE_MEMBER_NAME");
    const taskIds = input.taskIds ?? [];
    assertStringArray(taskIds, "taskIds");
    if (taskIds.length === 0) reject("public spawn requires a non-empty task_ids binding", "AGENT_TEAMS_TASK_BINDING_REQUIRED");
    const tasks = [...new Set(taskIds)].map((taskId) => {
      const task = team.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined || task.state !== "pending" || task.assigneeSessionId !== undefined) reject("spawn tasks must be persisted, pending, and unassigned", "AGENT_TEAMS_TASK_CONFLICT");
      return task;
    });
    assertTaskExecutionPreflight(team, tasks);
    if (!["host_verified", "human_attested"].includes(team.plan.authorization?.cost)) reject("member route cost is unknown; recommit the exact plan hash", "AGENT_TEAMS_COST_UNKNOWN");
    const timestamp = now();
    const memberId = randomUUID();
    const placeholderSessionId = `provisioning:${memberId}`;
    const reservation = { teamId: team.id, memberId, childId: randomUUID(), placeholderSessionId, name: memberName, role: nonEmptyString(input.role, "role", 500), prompt: nonEmptyString(input.prompt, "prompt", 65_536), taskIds: tasks.map((task) => task.id), pauseEpoch: team.pauseEpoch ?? 0, planRevision: team.plan.revision, planHash: team.plan.hash, ...modelSelection };
    team.members.push({ id: memberId, sessionId: placeholderSessionId, name: reservation.name, role: reservation.role, ...(reservation.model === undefined ? {} : { model: reservation.model }), ...(reservation.provider === undefined ? {} : { provider: reservation.provider }), modelTier: reservation.modelTier, inheritsMain: reservation.inheritsMain, routeSource: reservation.routeSource, kind: "worker", state: "provisioning", createdAt: timestamp, updatedAt: timestamp });
    for (const task of tasks) {
      task.assigneeSessionId = placeholderSessionId;
      task.leaseEpoch = team.pauseEpoch ?? 0;
      task.updatedAt = timestamp;
    }
    team.updatedAt = timestamp;
    return reservation;
  }));
  return queueTeamOperation(store.filePath, reservation.teamId, async () => {
    const admitted = await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const record = team.members.find((candidate) => candidate.id === reservation.memberId);
      if (effectiveTeamState(team) === "active" && record?.sessionId === reservation.placeholderSessionId && record.state === "provisioning") return true;
      if (record !== undefined) {
        confirmMemberRetired(record);
        for (const task of team.tasks) if (task.state === "pending" && task.assigneeSessionId === reservation.placeholderSessionId) {
          task.assigneeSessionId = undefined;
          task.updatedAt = record.updatedAt;
          boundedPush(task.interruptionHistory, { kind: "stop_before_provisioning", at: record.updatedAt, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0 }, MAX_TASK_INTERRUPTION_HISTORY);
        }
        team.updatedAt = record.updatedAt;
      }
      return false;
    }));
    if (!admitted) reject("team stopped accepting members before provisioning started", "AGENT_TEAMS_CLOSING");
    let started;
    try {
      started = await admission.run(lead, reservation.childId, signal, async () => {
        requireExactRootAgent(ctx, lead);
        return ctx.subagents.startContinuable({
          childId: reservation.childId,
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
      });
    } catch (error) {
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, reservation.teamId);
        const timestamp = now();
        team.members = team.members.filter((candidate) => candidate.id !== reservation.memberId);
        for (const task of team.tasks) if (task.assigneeSessionId === reservation.placeholderSessionId && task.state === "pending") {
          task.assigneeSessionId = undefined;
          task.updatedAt = timestamp;
          boundedPush(task.interruptionHistory, { kind: "provisioning_failed", at: timestamp, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0, reason: "member provisioning failed before publication" }, MAX_TASK_INTERRUPTION_HISTORY);
        }
        team.updatedAt = timestamp;
      }));
      if (typeof error?.code === "string" && error.code.startsWith("AGENT_TEAMS_ADMISSION_")) throw annotateStage(error, "admission");
      throw annotateStage(new HarnessError(`member provisioning failed before publication: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED"), "provisioning");
    }
    if (started.childId !== reservation.childId) {
      const cause = new HarnessError("subagent provider returned a different child id than the reserved identity", "AGENT_TEAMS_CONFLICT");
      const cleanup = await settleSpawnedChildFailure(ctx, store, lead, { phase: "publication", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause });
      // A contract-violating provider can return an identity whose lifecycle was
      // not observable under the reserved child id. Keep the generic slot fail-closed
      // until the unexpected child was conclusively drained (or was an existing child
      // that cleanup intentionally did not touch).
      if (cleanup === undefined || cleanup?.drainSkipped === true) admission.abandon(reservation.childId);
      throw cause;
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
        if (effectiveTeamState(team) !== "active" || record === undefined || record.sessionId !== reservation.placeholderSessionId || record.state !== "provisioning") reject("team changed during member provisioning", "AGENT_TEAMS_CONFLICT");
        if (!["committed", "active"].includes(team.plan?.phase) || team.plan.revision !== reservation.planRevision || team.plan.hash !== reservation.planHash || team.plan.hash !== teamPlanHash(team)) reject("team plan changed during member provisioning", "AGENT_TEAMS_STALE_PLAN");
        record.sessionId = started.childId;
        record.state = "running";
        record.updatedAt = now();
        record.publishedAt = record.updatedAt;
        if ((team.pauseEpoch ?? 0) !== reservation.pauseEpoch) reject("team lease epoch changed during member provisioning", "AGENT_TEAMS_STALE_LEASE");
        for (const taskId of reservation.taskIds) {
          const task = team.tasks.find((candidate) => candidate.id === taskId);
          if (task === undefined || task.state !== "pending" || task.assigneeSessionId !== reservation.placeholderSessionId) reject("spawn task pre-binding changed during member provisioning", "AGENT_TEAMS_TASK_CONFLICT");
          task.assigneeSessionId = started.childId;
          task.leaseEpoch = team.pauseEpoch ?? 0;
          task.updatedAt = record.updatedAt;
        }
        team.updatedAt = record.updatedAt;
        return { duplicateChildId: false, member: clone(record) };
      }));
    } catch (error) {
      const cleanup = { phase: "publication", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause: error };
      await settleSpawnedChildFailure(ctx, store, lead, cleanup);
      throw annotateStage(new HarnessError(`member publication failed after child creation: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED"), "publication");
    }
    if (publication.duplicateChildId) reject("subagent provider returned a child id already owned by another member", "AGENT_TEAMS_CONFLICT");
    const member = publication.member;
    try {
      await admission.run(lead, started.childId, signal, async () => {
        requireExactRootAgent(ctx, lead);
        return ctx.subagents.followup(lead, started.childId, textContent(workPrompt(reservation.teamId, reservation.memberId, reservation.prompt, reservation.taskIds)), { source: relaySource(lead.id), signal });
      });
    } catch (error) {
      await settleSpawnedChildFailure(ctx, store, lead, { phase: "work-followup", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause: error });
      throw annotateStage(error, "work-followup");
    }
    return store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const current = memberOf(team, started.childId);
      if (current !== undefined && current.state === "provisioning") {
        current.state = "running";
        current.updatedAt = now();
        team.updatedAt = current.updatedAt;
      }
      if (team.plan?.phase === "committed" && team.plan.revision === reservation.planRevision
        && team.plan.hash === reservation.planHash && team.plan.hash === teamPlanHash(team)) {
        const timestamp = now();
        team.plan.phase = "active";
        team.plan.activatedAt = timestamp;
        team.updatedAt = timestamp;
      }
      return { teamId: team.id, member: clone(current ?? member), plan: clone(team.plan) };
    }));
  });
}

async function sendTeamMessage(ctx, store, admission, caller, input, signal) {
  const teamIds = await store.read((document) => {
    const sourceTeam = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    const targetTeamId = optionalString(input.targetTeamId, "targetTeamId", 256);
    return [sourceTeam.id, targetTeamId ?? sourceTeam.id];
  });
  return queueTeamOperations(store.filePath, teamIds, () => sendTeamMessageUnlocked(ctx, store, admission, caller, input, signal));
}
async function sendTeamMessageUnlocked(ctx, store, admission, caller, input, signal) {
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
    const envelope = JSON.stringify({
      version: 1,
      messageId: prepared.message.id,
      sourceTeamId: prepared.teamId,
      targetTeamId: prepared.targetTeamId,
      senderMemberId: prepared.sender?.id,
      recipientMemberId: prepared.recipient.id,
    });
    const content = textContent(`[Agent team message ${prepared.message.id} from ${prepared.sender?.name ?? caller.id}]\n[Agent team envelope ${envelope}]\n${prepared.deliveryBody}`);
    if (prepared.recipient.kind === "lead") {
      relayToLead(lead, createUserMessage({ content, source: relaySource(caller.id) }));
    } else {
      await admission.run(lead, prepared.recipient.sessionId, signal, async () => {
        requireExactRootAgent(ctx, lead);
        return ctx.subagents.followup(lead, prepared.recipient.sessionId, content, { source: relaySource(caller.id), signal });
      });
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
    const assigneeMember = assigneeReference === undefined ? undefined : resolveMember(team, assigneeReference);
    const assigneeSessionId = assigneeMember?.sessionId;
    if (assigneeSessionId !== undefined && caller.id !== team.rootLeadSessionId && assigneeSessionId !== caller.id) {
      reject("only the lead can assign a new task to another member", "AGENT_TEAMS_UNAUTHORIZED");
    }
    if (assigneeMember !== undefined) requireAssignableMember(assigneeMember);
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
      attempt: 0,
      leaseEpoch: team.pauseEpoch ?? 0,
      attemptHistory: [],
      interruptionHistory: [],
      capabilities: normalizeCapabilityInputs(input.capabilities),
      externalEffects: normalizeExternalEffectInputs(input.externalEffects),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    for (const effect of task.externalEffects) effect.idempotencyKey = hostExternalEffectKey(team.id, task.id, effect.name);
    team.tasks.push(task);
    markPlanDraft(team);
    team.updatedAt = timestamp;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
  });
}

function assertCurrentTaskLease(team, task, caller, input, { leadMayOverride = true } = {}) {
  if (leadMayOverride && caller.id === team.rootLeadSessionId) return;
  if (task.assigneeSessionId !== caller.id) reject("caller does not hold this task lease", "AGENT_TEAMS_UNAUTHORIZED");
  if (typeof input.claimId !== "string" || input.claimId !== task.claimId) reject("claim_id is missing or stale", "AGENT_TEAMS_STALE_CLAIM");
  if (!Number.isSafeInteger(input.leaseEpoch) || input.leaseEpoch !== task.leaseEpoch || input.leaseEpoch !== (team.pauseEpoch ?? 0)) reject("lease_epoch is missing or stale", "AGENT_TEAMS_STALE_LEASE");
}
async function updateTaskCheckpoint(store, caller, input) {
  return store.mutate((document) => {
    assertEnabled(document);
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    requireActiveTeam(team);
    const task = team.tasks.find((candidate) => candidate.id === nonEmptyString(input.taskId, "taskId", 256));
    if (task === undefined || task.state !== "in_progress") reject("checkpoint requires an in-progress task", "AGENT_TEAMS_TASK_CONFLICT");
    assertCurrentTaskLease(team, task, caller, input, { leadMayOverride: false });
    const timestamp = now();
    const checkpoint = optionalString(input.checkpoint, "checkpoint", 4_096);
    const nextStep = optionalString(input.nextStep, "nextStep", 4_096);
    if (checkpoint === undefined && nextStep === undefined) reject("checkpoint or next_step is required", "AGENT_TEAMS_INVALID_TASK");
    if (checkpoint !== undefined) task.checkpoint = { text: checkpoint, reportedAt: timestamp, reportedBy: caller.id, verified: false, claimId: task.claimId, leaseEpoch: task.leaseEpoch };
    if (nextStep !== undefined) task.nextStep = { text: nextStep, reportedAt: timestamp, reportedBy: caller.id, verified: false, claimId: task.claimId, leaseEpoch: task.leaseEpoch };
    task.updatedAt = timestamp;
    team.updatedAt = timestamp;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
  });
}

async function updateTaskExternalEffect(store, caller, input) {
  return store.mutate((document) => {
    assertEnabled(document);
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    const action = input.action;
    assertEnum(action, ["prepare", "succeeded", "failed", "resolve_unknown"], "action");
    if (action === "resolve_unknown") requireOpenTeam(team);
    else requireActiveTeam(team);
    const task = team.tasks.find((candidate) => candidate.id === nonEmptyString(input.taskId, "taskId", 256));
    if (task === undefined || taskIsTerminal(task)) reject("external effect update requires an unfinished task", "AGENT_TEAMS_TASK_CONFLICT");
    const effect = task.externalEffects.find((candidate) => candidate.name === nonEmptyString(input.effectName, "effectName", 200));
    if (effect === undefined) reject("unknown declared external effect", "AGENT_TEAMS_NOT_FOUND");
    const isLead = caller.id === team.rootLeadSessionId;
    if (action === "resolve_unknown") {
      if (!isLead) reject("outcome_unknown resolution requires the fixed root", "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
      if (effect.outcome !== "outcome_unknown") reject("effect outcome is not unknown", "AGENT_TEAMS_CONFLICT");
      assertEnum(input.outcome, ["succeeded", "failed", "not_started"], "outcome");
      const attemptId = nonEmptyString(input.attemptId, "attemptId", 256);
      if (attemptId !== effect.attemptId) reject("external effect attempt is missing or stale", "AGENT_TEAMS_STALE_EXTERNAL_EFFECT");
      const authorization = input.authorization;
      const expected = {
        tool: RESOLVE_UNKNOWN_AUTHORIZATION_TOOL,
        rootSessionId: caller.id,
        teamId: team.id,
        taskId: task.id,
        effectName: effect.name,
        attemptId,
        outcome: input.outcome,
        pauseEpoch: team.pauseEpoch ?? 0,
        teamRevision: team.revision,
        canonicalArgumentsHash: resolveUnknownArgumentsHash({ teamId: team.id, taskId: task.id, effectName: effect.name, attemptId, outcome: input.outcome }),
      };
      if (!isRecord(authorization) || authorization[RESOLVE_UNKNOWN_AUTHORIZATION_BRAND] !== true) reject("resolve_unknown requires a consumed Host authorization", "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
      for (const [key, value] of Object.entries(expected)) if (authorization[key] !== value) reject(`Host authorization is stale for ${key}`, "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
      effect.outcome = input.outcome;
      effect.resolvedAt = now();
      effect.resolvedBy = caller.id;
    } else {
      if (task.state !== "in_progress") reject("external effect execution requires an in-progress task", "AGENT_TEAMS_TASK_CONFLICT");
      assertCurrentTaskLease(team, task, caller, input, { leadMayOverride: false });
      if (action === "prepare") {
        if (effect.policy === "forbidden") reject("external effect is forbidden", "AGENT_TEAMS_EXTERNAL_EFFECT_FORBIDDEN");
        if (effect.outcome === "outcome_unknown") reject("previous external effect outcome is unknown", "AGENT_TEAMS_OUTCOME_UNKNOWN");
        effect.idempotencyKey = hostExternalEffectKey(team.id, task.id, effect.name);
        effect.outcome = "outcome_unknown";
        effect.attemptId = randomUUID();
        effect.preparedAt = now();
      } else {
        if (effect.outcome !== "outcome_unknown" || optionalString(input.attemptId, "attemptId", 256) !== effect.attemptId) reject("external effect attempt is missing or stale", "AGENT_TEAMS_STALE_EXTERNAL_EFFECT");
        effect.outcome = action;
        effect.resolvedAt = now();
        effect.resolvedBy = caller.id;
      }
    }
    effect.updatedAt = now();
    task.updatedAt = effect.updatedAt;
    team.updatedAt = effect.updatedAt;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), effect: clone(effect), deliveryGuarantee: "host_effect_key_available_no_exactly_once_claim" };
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
    if (requestedState !== undefined) assertEnum(requestedState, MUTABLE_TASK_STATES, "state");
    if (input.action === undefined && requestedState === undefined) reject("task update requires action or state", "AGENT_TEAMS_INVALID_TASK");
    const action = input.action ?? (requestedState === "in_progress" ? "claim" : requestedState === "completed" ? "complete" : taskIsTerminal(task) ? "reopen" : "release");
    assertEnum(action, ["claim", "release", "complete", "accept", "cancel", "reopen", "assign", "unassign"], "action");
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
      assertTaskExecutionPreflight(team, [task]);
      const claimedAt = now();
      task.state = "in_progress";
      task.assigneeSessionId = caller.id;
      task.claimedAt = claimedAt;
      task.attempt = (task.attempt ?? 0) + 1;
      task.claimId = randomUUID();
      task.leaseEpoch = team.pauseEpoch ?? 0;
      boundedPush(task.attemptHistory, { kind: "claimed", at: claimedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch }, MAX_TASK_ATTEMPT_HISTORY);
      if (team.plan?.phase === "committed") {
        team.plan.phase = "active";
        team.plan.activatedAt = claimedAt;
      }
      // A prior attempt's checkpoint remains explicitly unverified recovery context
      // until this claimant replaces it; fencing metadata keeps its origin visible.
      clearTaskTerminalMetadata(task);
          } else if (action === "complete") {
      if (task.state === "completed") {
        if (task.assigneeSessionId !== caller.id) reject("only the original claimant may replay task completion; the lead must use accept", "AGENT_TEAMS_UNAUTHORIZED");
        assertCurrentTaskLease(team, task, caller, input, { leadMayOverride: false });
        if (!taskSubmissionMatches(task)) reject("completed task has no current task-scoped submission fact", "AGENT_TEAMS_DELIVERY_REQUIRED");
        return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), reused: true };
      }
      if (task.state !== "in_progress") reject(`only an in-progress task can be completed (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (task.assigneeSessionId !== caller.id) reject("only the task claimant or team lead acting as that same claimant may submit completion; the lead cannot complete a foreign claim", "AGENT_TEAMS_UNAUTHORIZED");
      assertCurrentTaskLease(team, task, caller, input, { leadMayOverride: isLead });
      if ((task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown")) reject("task is blocked by an unknown external side-effect outcome", "AGENT_TEAMS_OUTCOME_UNKNOWN");
      if (blockedBy.length > 0) reject(`task is blocked by: ${blockedBy.join(", ")}`, "AGENT_TEAMS_TASK_BLOCKED");
      const completedAt = now();
      task.state = "completed";
      task.completedAt = completedAt;
      task.submission = taskSubmission(task, caller.id, completedAt);
      task.acceptance = isLead ? { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch, acceptedAt: completedAt, acceptedBy: caller.id, ownerEpoch: team.pauseEpoch ?? 0 } : undefined;
      task.cancelledAt = undefined;
      task.cancellationReason = undefined;
          } else if (action === "accept") {
      if (!isLead) reject("only the fixed root lead may accept a submitted task", "AGENT_TEAMS_UNAUTHORIZED");
      if (task.state !== "completed" || !taskSubmissionMatches(task)) reject("acceptance requires a task-scoped completion submission from the current claimant", "AGENT_TEAMS_DELIVERY_REQUIRED");
      if (task.acceptance !== undefined) {
        if (!taskAcceptanceMatches(task)) reject("task acceptance is stale or malformed", "AGENT_TEAMS_STALE_CLAIM");
        return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), reused: true };
      }
      task.acceptance = { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch, acceptedAt: now(), acceptedBy: caller.id, ownerEpoch: team.pauseEpoch ?? 0 };
    } else if (action === "release") {
      if (task.state !== "in_progress") reject(`only an in-progress task can be released (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (!isLead && task.assigneeSessionId !== caller.id) reject("only the task claimant or team lead can release it", "AGENT_TEAMS_UNAUTHORIZED");
      assertCurrentTaskLease(team, task, caller, input);
      const releasedAt = now();
      boundedPush(task.interruptionHistory, { kind: "released", at: releasedAt, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0 }, MAX_TASK_INTERRUPTION_HISTORY);
      task.state = "pending";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      task.claimId = undefined;
      // Keep the most recent unverified checkpoint/next step as bounded recovery
      // context; a subsequent holder cannot use its stale fence to mutate the task.
      clearTaskTerminalMetadata(task);
            task.releasedAt = releasedAt;
      task.releaseReason = isLead ? "released explicitly by the team lead" : "released explicitly by the task claimant";
    } else if (action === "cancel") {
      if (!isLead) reject("only the team lead can cancel a task", "AGENT_TEAMS_UNAUTHORIZED");
      if (taskIsTerminal(task)) reject(`only a pending or in-progress task can be cancelled (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      task.state = "cancelled";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      task.completedAt = undefined;
      task.cancelledAt = now();
      task.cancellationReason = "cancelled explicitly by the team lead";
          } else if (action === "reopen") {
      if (!isLead) reject("only the team lead can reopen a task", "AGENT_TEAMS_UNAUTHORIZED");
      if (!taskIsTerminal(task)) reject(`only a completed or cancelled task can be reopened (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      const progressed = progressedDependents(document, team.id, task.id);
      if (progressed.length > 0) reject(`cannot reopen a prerequisite used by progressed tasks: ${progressed.join(", ")}`, "AGENT_TEAMS_TASK_CONFLICT");
      task.state = "pending";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      clearTaskTerminalMetadata(task);
          } else if (action === "assign") {
      if (!isLead) reject("only the team lead can assign a task", "AGENT_TEAMS_UNAUTHORIZED");
      const assignee = requireAssignableMember(resolveMember(team, input.assigneeSessionId)).sessionId;
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
function releaseRetiredMemberTasks(team, sessionId, timestamp = now(), reason = "task released because its member was force-retired") {
  const releasedTaskIds = [];
  for (const task of team.tasks) {
    if (task.assigneeSessionId !== sessionId || taskIsTerminal(task)) continue;
    task.state = "pending";
    task.assigneeSessionId = undefined;
    task.claimedAt = undefined;
    clearTaskTerminalMetadata(task);
    task.releasedAt = timestamp;
    task.releaseReason = reason;
    task.updatedAt = timestamp;
    releasedTaskIds.push(task.id);
  }
  return releasedTaskIds;
}
function resetTaskStoppedAfter(task, stoppedAt, pauseEpoch) {
  const completedAfterStop = task.state === "completed" && typeof task.completedAt === "string" && task.completedAt >= stoppedAt;
  if (task.state !== "in_progress" && !completedAfterStop) return;
  boundedPush(task.interruptionHistory, { kind: "user_stop", at: stoppedAt, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, reason: `pause epoch ${pauseEpoch}` }, MAX_TASK_INTERRUPTION_HISTORY);
  task.state = "pending";
  task.claimedAt = undefined;
  task.claimId = undefined;
  task.completedAt = undefined;
  task.result = undefined;
  task.submission = undefined;
  task.acceptance = undefined;
  // Stop advances the Host lease epoch but preserves the last explicitly unverified
  // checkpoint/next step so a human can inspect recovery context after interruption.
  task.leaseEpoch = pauseEpoch;
  task.updatedAt = stoppedAt;
}
async function pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt) {
  const selectedChildren = new Map(selections.map((entry) => [entry.teamId, new Set(entry.childIds)]));
  const teamIds = new Set(selectedChildren.keys());
  const childIds = [...new Set(selections.flatMap((entry) => entry.childIds))];
  await store.runOperation(() => store.mutate((document) => {
    for (const team of document.teams) {
      if (!teamIds.has(team.id) || team.rootLeadSessionId !== lead.id || !["active", "paused"].includes(team.state)) continue;
      team.pauseEpoch = (team.pauseEpoch ?? 0) + 1;
      team.state = "paused";
      team.resume = undefined;
      USER_PAUSE_EPOCHS.set(team.id, team.pauseEpoch);
      for (const task of team.tasks) resetTaskStoppedAfter(task, stoppedAt, team.pauseEpoch);
      const childSessions = selectedChildren.get(team.id);
      for (const member of team.members) {
        if (member.kind !== "worker" || !childSessions.has(member.sessionId) || !STOPPABLE_MEMBER_STATES.has(member.state)) continue;
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
      const childSessions = selectedChildren.get(team.id);
      for (const member of team.members) {
        if (member.kind !== "worker" || !childSessions.has(member.sessionId) || member.state !== "shutting_down") continue;
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
function buildResumePlan(team, teams) {
  const attention = deriveAttention(team, teams);
  const nodes = team.members.filter((member) => member.kind === "worker" && member.state !== "retired").map((member) => {
    if (member.state === "ready" && member.shutdownUnconfirmed !== true && member.stopUnconfirmed !== true) return { memberId: member.id, status: "ready" };
    return { memberId: member.id, status: "attention", reason: member.error ?? `member state is ${member.state}` };
  });
  return {
    nodes,
    readyMemberIds: nodes.filter((node) => node.status === "ready").map((node) => node.memberId),
    attentionMemberIds: nodes.filter((node) => node.status !== "ready").map((node) => node.memberId),
    failedMemberIds: [...attention.failedMembers],
    pendingAssignedTaskIds: team.tasks.filter((task) => task.state === "pending" && task.assigneeSessionId !== undefined).map((task) => task.id),
    blockedTaskIds: [...attention.blockedTasks],
    strandedTaskIds: [...attention.strandedTasks],
    automaticallyWoken: false,
  };
}
async function resumePausedTeam(ctx, store, lead, input) {
  const requestedTeamId = optionalString(input.teamId, "teamId", 256);
  const selectedTeamId = await store.read((document) => {
    const predicate = input.commit === true
      ? (candidate) => effectiveTeamState(candidate) === "paused" || candidate.state === "active" && candidate.resume?.status === "committed"
      : (candidate) => effectiveTeamState(candidate) === "paused";
    const team = requestedTeamId === undefined
      ? resolveUniqueLeadTeam(document, undefined, lead.id, predicate)
      : findTeam(document, requestedTeamId);
    requireLiveRootLead(ctx, team, lead);
    if (!predicate(team)) reject(input.commit === true ? "team has no matching paused preview or committed resume receipt" : "team is not paused", "AGENT_TEAMS_CONFLICT");
    return team.id;
  });
  const pendingReconciliation = USER_PAUSE_RECONCILIATIONS.get(selectedTeamId);
  if (pendingReconciliation !== undefined) await pendingReconciliation.catch(() => undefined);
  const repairSelection = await store.read((document) => {
    const team = findTeam(document, selectedTeamId);
    if (team.state === "paused" || !USER_PAUSED_TEAMS.has(team.id)) return undefined;
    return { teamId: team.id, childIds: team.members.filter((member) => member.kind === "worker" && STOPPABLE_MEMBER_STATES.has(member.state)).map((member) => member.sessionId) };
  });
  if (repairSelection !== undefined) {
    try { await pauseTeamsForUserStop(ctx, store, lead, [repairSelection], now()); }
    catch (error) { reject(`team pause reconciliation failed: ${String(error)}`, "AGENT_TEAMS_PAUSE_RECONCILIATION_FAILED"); }
  }
  if (input.commit !== true) {
    return store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, selectedTeamId);
      requireLiveRootLead(ctx, team, lead);
      if (team.state !== "paused") reject("team is not durably paused", "AGENT_TEAMS_PAUSE_RECONCILIATION_FAILED");
      const requestedRequestId = optionalString(input.requestId, "requestId", 256);
      if (team.resume?.status === "preview" && team.resume.pauseEpoch === (team.pauseEpoch ?? 0)
        && (requestedRequestId === undefined || requestedRequestId === team.resume.requestId)) {
        const peers = document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId);
        return { teamId: team.id, phase: "preview", preview: clone(team.resume), resumePlan: buildResumePlan(team, peers), reused: true };
      }
      const peers = document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId);
      const resumePlan = buildResumePlan(team, peers);
      const preview = { previewId: randomUUID(), requestId: requestedRequestId ?? randomUUID(), pauseEpoch: team.pauseEpoch ?? 0, teamRevision: (team.revision ?? 1) + 1, createdAt: now(), nodes: resumePlan.nodes, status: "preview" };
      team.resume = preview;
      team.updatedAt = preview.createdAt;
      return { teamId: team.id, phase: "preview", preview: clone(preview), resumePlan, reused: false };
    }));
  }
  return store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, selectedTeamId);
    requireLiveRootLead(ctx, team, lead);
    const requestedPreviewId = optionalString(input.previewId, "previewId", 256);
    const requestedRequestId = optionalString(input.requestId, "requestId", 256);
    if (team.state === "active" && team.resume?.status === "committed"
      && requestedPreviewId === team.resume.previewId
      && requestedRequestId === team.resume.requestId
      && input.expectedPauseEpoch === team.resume.pauseEpoch
      && input.expectedTeamRevision === team.resume.teamRevision) {
      return { teamId: team.id, phase: "active", pauseEpoch: team.pauseEpoch ?? 0, reused: true, resumePlan: buildResumePlan(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)), team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)) };
    }
    if (team.state !== "paused" || team.resume === undefined || team.resume.status === "committed") reject("resume preview is required before commit", "AGENT_TEAMS_RESUME_PREVIEW_REQUIRED");
    if (requestedPreviewId !== team.resume.previewId || requestedRequestId !== team.resume.requestId
      || input.expectedPauseEpoch !== team.pauseEpoch || input.expectedPauseEpoch !== team.resume.pauseEpoch
      || input.expectedTeamRevision !== team.revision || input.expectedTeamRevision !== team.resume.teamRevision) {
      reject("resume preview is stale; request a new preview", "AGENT_TEAMS_STALE_RESUME");
    }
    // Abnormal nodes stay visible for attention but do not freeze healthy nodes or
    // the team's durable state. Nothing is woken automatically.
    for (const node of team.resume.nodes) if (node.status !== "ready") {
      const member = team.members.find((candidate) => candidate.id === node.memberId);
      if (member !== undefined && member.state === "shutting_down") {
        member.state = "failed";
        member.shutdownUnconfirmed = true;
        member.stopUnconfirmed = true;
        member.error ??= "resume excluded a member whose stop acknowledgement is unavailable";
        member.updatedAt = now();
      }
    }
    team.state = "active";
    team.updatedAt = now();
    const resumePlan = buildResumePlan(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId));
    team.resume = { ...team.resume, status: "committed", committedAt: team.updatedAt };
    USER_PAUSED_TEAMS.delete(team.id);
    USER_PAUSE_RECONCILIATIONS.delete(team.id);
    USER_PAUSE_EPOCHS.set(team.id, team.pauseEpoch ?? 0);
    return { teamId: team.id, phase: "active", pauseEpoch: team.pauseEpoch ?? 0, resumePlan, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)) };
  }));
}

async function retireMember(ctx, store, admission, lead, input, signal) {
  const force = input.force === true;
  const prepared = await store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    requireLiveRootLead(ctx, team, lead);
    requireOpenTeam(team);
    const member = resolveMember(team, input.memberSessionId);
    if (member.kind !== "worker") reject("unknown worker member", "AGENT_TEAMS_NOT_FOUND");
    const unfinishedTaskIds = team.tasks.filter((task) => task.assigneeSessionId === member.sessionId && !taskIsTerminal(task)).map((task) => task.id);
    if (!force && unfinishedTaskIds.length > 0) reject(`member owns unfinished tasks; complete or release them before graceful retirement: ${unfinishedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
    const invalidSubmissionTaskIds = team.tasks.filter((task) => task.assigneeSessionId === member.sessionId && task.state === "completed" && !taskSubmissionMatches(task)).map((task) => task.id);
    if (!force && invalidSubmissionTaskIds.length > 0) reject(`member completed tasks without a current task-scoped submission fact: ${invalidSubmissionTaskIds.join(", ")}`, "AGENT_TEAMS_DELIVERY_REQUIRED");
    if (member.state === "retired") return { teamId: team.id, member: clone(member), releasedTaskIds: [], noop: true };
    markMemberShuttingDown(member, force);
    team.updatedAt = member.updatedAt;
    return { teamId: team.id, member: clone(member), noop: false };
  }));
  if (prepared.noop) return prepared;
  const gracefulWaiter = force ? undefined : registerGracefulLifecycleWaiter(prepared.member.sessionId);
  try {
    if (force) await ctx.subagents.drainContinuableChildren(lead, [prepared.member.sessionId]);
    else {
      await admission.run(lead, prepared.member.sessionId, signal, async () => {
        requireExactRootAgent(ctx, lead);
        return ctx.subagents.followup(lead, prepared.member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
          source: relaySource(lead.id), signal,
        });
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
    let releasedTaskIds = [];
    if (member !== undefined && team.state !== "closed") {
      const retiredSessionId = member.sessionId;
      confirmMemberRetired(member);
      releasedTaskIds = releaseRetiredMemberTasks(team, retiredSessionId, member.updatedAt, "task released because its assigned member was force-retired");
      team.updatedAt = member.updatedAt;
    }
    if (member === undefined) reject("unknown worker member", "AGENT_TEAMS_NOT_FOUND");
    return { teamId: team.id, member: clone(member), releasedTaskIds };
  }));
}

async function shutdownTeam(ctx, store, admission, lead, input, signal) {
  const teamId = await store.read((document) => optionalString(input.teamId, "teamId", 256) === undefined ? resolveUniqueLeadTeam(document, undefined, lead.id, (candidate) => candidate.state !== "closed").id : findTeam(document, input.teamId).id);
  if (input.memberSessionId !== undefined && input.memberSessionId !== "") {
    return queueTeamOperation(store.filePath, teamId, () => retireMember(ctx, store, admission, lead, { ...input, teamId }, signal));
  }
  const force = input.force === true;
  const prepared = await queueTeamOperation(store.filePath, teamId, () => store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, teamId);
    requireLiveRootLead(ctx, team, lead);
    if (team.state !== "closing") requireActiveTeam(team);
    const unfinishedTaskIds = team.tasks.filter((task) => !taskIsTerminal(task)).map((task) => task.id);
    if (!force && unfinishedTaskIds.length > 0) reject(`team has unfinished tasks; complete or cancel them before graceful shutdown: ${unfinishedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
    const unacceptedTaskIds = team.tasks.filter((task) => task.state === "completed" && !taskAcceptanceMatches(task)).map((task) => task.id);
    if (!force && unacceptedTaskIds.length > 0) reject(`team has submitted tasks awaiting independent lead acceptance: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
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
        await admission.run(lead, member.sessionId, signal, async () => {
          requireExactRootAgent(ctx, lead);
          return ctx.subagents.followup(lead, member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
            source: relaySource(lead.id), signal,
          });
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
    if (shouldClose) closeTeamRecord(team, force ? "team was force-closed before unfinished work completed" : "team closed after all tracked work was submitted, accepted, or explicitly cancelled", { forced: force });
    else {
      team.state = failures.length === 0 ? "closing" : "active";
      team.updatedAt = now();
      team.closure = failures.length === 0 ? undefined : { outcome: "failed", attemptedAt: team.updatedAt, reason: "team shutdown failed before every member retirement was confirmed", forced: force, cancelledTaskIds: [], failures: failures.map((failure) => String(failure).slice(0, 4_096)) };
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
      const unacceptedTaskIds = team.tasks.filter((task) => task.state === "completed" && !taskAcceptanceMatches(task)).map((task) => task.id);
      if (unacceptedTaskIds.length > 0) reject(`orphan recovery cannot certify unaccepted completed tasks: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
      for (const member of team.members) if (member.kind === "worker") confirmMemberRetired(member);
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
    ...ordered.map((candidate) => [candidate.id, candidate.revision ?? 1, effectiveTeamState(candidate)]),
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
    "Before substantive work on every ordinary direct-human root turn, apply the three-level gate below. When the Level 3 conditions are met, choose exactly one creation path in that same turn: use team_bootstrap when the complete bounded task/member plan is already known; otherwise use team_start and then the existing task/spawn tools. Never call both team_start and team_bootstrap for the same team, and never replace the required visible managed members with multiple hidden ordinary subagents.",
    "Keep durable team task state synchronized at every handoff: members must explicitly complete finished tasks before their final report, and the root lead must reconcile every task before retiring members or closing the team. A report or successful subagent turn is not completion evidence. Graceful retirement and shutdown require no unfinished owned work; force shutdown records unfinished work as cancelled rather than leaving permanent pending tasks.",
    "Once an Agent Team is established for the current goal, the root lead defaults to coordination only: decompose the user's objective into substantive outcomes, persist and assign durable tasks, coordinate dependencies and handoffs, monitor and reconcile task state, review and accept member deliverables, then perform final integration and user-facing synthesis. The root lead must not personally implement, research, design, test, or otherwise substitute for a core professional deliverable that is assigned or should be assigned to a member role. If substantive coverage is missing, create or restructure the relevant durable task and assign or expand the visible team instead of absorbing that work; the root may make only minimal glue changes required to integrate accepted member outputs.",
    "A team's durable tasks and member roles must collectively cover the substantive outputs required to satisfy the user's goal, each with a real deliverable and observable acceptance criteria. Never create decorative, token, or review-only members while leaving the core professional output to the root lead; if the work does not justify delegating its substantive production, do not create a team.",
    "Only the outermost top-level root lead/brain evaluates each ordinary direct-user goal using a strict three-level gate. Level 1 — main model: Complete simple, tightly coupled, or non-parallel work alone. Level 2 — ordinary subagent: when only one auxiliary executor is needed, use an official normal subagent or subagent_fork even if that single helper must be continuable or work across multiple turns. Level 3 — Agent Team: in automatic mode, proactively choose one Agent Team creation path only when the goal normally has at least two sustained, genuinely independent workstreams that need delegation to different visible managed members; the root/lead's own work or coordination does not count as the second workstream. The work must also require ongoing coordination across turns, such as shared tasks, dependencies, handoffs, or status tracking. An explicit user request for a team may still be followed, but automatic mode must not create a one-worker team. Parallelism by itself is not enough for a team; the user does not need to say ‘create a team’, design members, or know the team tools. Never create a team merely to fill seats, demonstrate the feature, or make routine work look parallel. When an active team's objective needs another delegation, it must be added as a visible managed member rather than a hidden ordinary subagent. Managed team members must never create teams or fan out through subagent, subagent_fork, workflow, or ralph; if they need more parallel work, they must report that need to the root, which decides whether to spawn another visible member under maxActiveTurns. A member may report only from its own in-progress task through team_expansion_request; the request is a proposal, never authority to spawn.",
    "When a new team already has a complete bounded plan of one through four durable tasks and one through four visible peers, call team_bootstrap directly with a stable request_id and do not call team_start first. Otherwise team_start creates a draft: persist tasks, then use team_plan_commit with the exact plan revision and confirmed_plan_hash before any team_spawn. Without durable successful worker-publication history that CAS persists phase committed; the first fully successful spawn records publication and activates it, while later recommit persists active even after every published worker gracefully retires. Provisioning or initial publication/work-followup failure never establishes this history. Upgraded retired workers without the new marker qualify only through a task submission/result or checkpoint bound to their exact historical claim; retired state alone and former-root adoption history do not qualify. Both committed and active pass new claim/spawn execution gates. A new team or bootstrap still requires the current direct-human root turn. After that direct-human establishment and one successful worker publication, the same exact live root may recommit a later draft during an automatic goal round without another user message only while the team remains active and unpaused in the same canonical project, every capability is individually verified, file scopes are conflict-free, cost stays within the direct user's ordinary default AI-routing grant, every effect policy is none, and no outcome is unknown. Public spawn always requires non-empty persisted task_ids, and the Host atomically pre-binds those tasks with the member placeholder before child creation. Bootstrap persists all tasks before starting members, and exact replay reuses its plan. Neither path may bypass capacity checks, file-scope separation, capability preflight, or explicit review of partial/uncertain starts.",
    "An ordinary internal team that the direct user explicitly requested needs no redundant confirmation for a dynamically safe automatic-round recommit. Plan authority remains explicitly host_verified, human_attested, or unknown: a continuing/default grant stays human_attested and never becomes Host proof. Tool/model booleans can create only human_attested facts, never host_verified facts, and can never bulk-upgrade unknown capability records. Any material change to task scope, file ownership, capability/permission facts, model-cost class, or external effects returns the plan to draft and requires a fresh exact-hash CAS commit. New team creation, bootstrap, Stop recovery/resume, handoff/adopt/recover, resolve_unknown, cross-project scope, unknown/unavailable or separately billed capabilities, conflicting files, and confirm_each/idempotent/forbidden effects remain behind their direct-human or Host gates. An already active main-tier worker does not itself create a new cost grant or block safe continuation.",
    "A task claim returns claimId and leaseEpoch. Members must echo both for checkpoint, completion, or release; stale attempts are rejected and only an exact completion replay is a no-op. Member checkpoints and next steps are unverified annotations separate from the four authoritative task states (pending, in_progress, completed, cancelled). External effect keys are Host-derived from stable team/task/effect identity. Only participating idempotency protocols can claim exactly-once; outcome_unknown blocks retry until an exact direct-human root resolves it.",
    "Team ownership may move only through team_handoff then team_adopt: both require direct-human root turns, the team must be durably paused, source and target must be exact live roots with the same canonical projectKey, and adoption must present the short-lived single-use token. Adoption increments pauseEpoch, revokes every old claim/lease, retires old-parent workers for bounded audit history, safely releases unfinished work to pending, and never wakes anyone automatically. Unknown scope and cross-project adoption fail closed.",
    "For every team_expansion_request, the fixed root lead approves only when the remaining outcomes are genuinely parallel and independent, inputs and acceptance criteria are explicit, file/external-resource ownership does not conflict, the handoff context is small, critical-path reduction or independent-review value materially exceeds coordination cost, and current member/turn/task budget is sufficient. The Host compares proposed file scopes with other in-progress task files and checks proposal-internal resource hierarchy, but existing external-resource ownership is not persisted and must be verified by the root. If a broad source task is split, first release/restructure it so its in-progress file scope no longer overlaps; then call team_task_create for each accepted durable outcome and only then call team_spawn for visible same-level peers. If rejected, explain the reason to the requester. Never invent a leader→group-leader→hidden-worker hierarchy.",
    "The fixed root lead/brain always uses the main model route. The AI autonomously chooses each spawned member's model_tier: default to subagent to reduce cost; use main only for high-complexity reasoning, architecture, security-critical work, or repeated failures. Users do not choose member tiers. Every new member re-reads the latest route for its chosen tier; changing the subagent route never changes main-tier members, and already-created continuable members keep their creation route.",
    "Every spawned member display name must be a plain 2–12 character duty name in the user's language. For Chinese, prefer 2–6 characters such as 界面、安全、测试、文档; for English, use labels such as UI, Test, Security, Docs. Avoid internal or abstract technical terms including 宿主、协调器、执行器、实现者、子代理 and Host, Coordinator, Executor, Implementer, Subagent.",
    "A top-level root may own at most 8 unclosed peer teams, and all peers share maxActiveTurns. Pass team_id when more than one is active. Only their same fixed root lead may relay across teams with target_team_id. Never nest teams or connect different roots. Persist tasks before work, atomically claim pending unblocked tasks, gracefully retire members before closing a team, and use direct-human team_recover only for inactive orphaned teams.",
    "Legacy teams migrate non-destructively: existing in-progress workers may complete, release, or checkpoint their old revision, while every new claim or spawn remains behind the current migration/plan gate. Empty legacy teams may remain lazy legacy_unplanned drafts.",
    "An explicit UI Stop on a root turn first persists a new pauseEpoch, then interrupts members, clears team-generated wakeups, and returns in-progress tasks to pending. Never continue a paused team implicitly. In a later direct-human turn, call team_resume without commit to persist an idempotent request preview, inspect ready and attention nodes, then CAS-commit that exact preview into a durable receipt. No member wakes automatically, stale epochs fail closed, and an abnormal node must not freeze healthy nodes.",
    "Automatic collaboration follows Observe → Avoid → Require → Resolve → Admit → Deliver. Use collaboration_discover only when another exact owner or dependency is materially necessary; never guess or expose a session ID. Submit one structured collaboration_intent only for Host-verifiable dependency blocking, unique ownership, resource conflict, formal handoff, or mandatory policy review. The Host defaults to a silent no-wake inbox, deduplicates requests, and rejects stale, looping, broad, unsupported, or paused-sender intents.",
    "Read collaboration_inbox only at a natural coordination boundary, never poll it. A paused target is never woken: deferred items are tied to its pause epoch and become stale across explicit resume, so the sender must re-evaluate necessity instead of replaying them.",
  ].join("\n");
}

const FOUNDATION_TOOL_FORBIDDEN_KEYS = new Set(["project", "projectref", "actor", "actorref", "session", "sessionid", "role", "path", "workspacepath", "device", "deviceid", "team", "teamid", "task", "taskid", "repository", "repositoryref", "grant", "grantref", "approval", "approvalref", "effect", "effectref", "execution"]);
function assertFoundationToolInput(value, field = "input", depth = 0) {
  if (depth > 16) throw new TypeError(`${field} is too deeply nested`);
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item, index) => assertFoundationToolInput(item, `${field}[${index}]`, depth + 1)); return; }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_]/gu, "").toLowerCase();
    if (FOUNDATION_TOOL_FORBIDDEN_KEYS.has(normalized)) { const error = new Error("foundation tool input contains a Host-derived field"); error.code = "PROJECT_FOUNDATIONS_FORBIDDEN"; throw error; }
    assertFoundationToolInput(child, `${field}.${key}`, depth + 1);
  }
}
function foundationFailure(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{3,80}$/u.test(error.code) ? error.code : "PROJECT_FOUNDATION_OPERATION_FAILED";
  const rules = {
    PROJECT_FOUNDATION_GIT_UNAVAILABLE: ["enable_desktop_git", false],
    PROJECT_FOUNDATION_GIT_UNTRUSTED: ["restart_with_host_git_capability", false],
    PROJECT_FOUNDATIONS_SOURCE_INVALID: ["open_the_exact_git_repository_root", false],
    PROJECT_FOUNDATIONS_SOURCE_DIRTY: ["commit_or_clean_the_source_repository", false],
    PROJECT_FOUNDATIONS_FORBIDDEN: ["refresh_team_assignment", false],
    PROJECT_FOUNDATIONS_TASK_SCOPE_UNSUPPORTED: ["assign_exact_repository_files", false],
    PROJECT_FOUNDATIONS_NOT_READY: ["retry_initialization", true],
    PROJECT_FOUNDATIONS_CLOSED: ["restart_the_plugin", true],
    PROJECT_FOUNDATIONS_INVALID_REQUEST: ["fix_request", false],
    PROJECT_FOUNDATIONS_METHOD_NOT_ALLOWED: ["use_supported_method", false],
    PROJECT_FOUNDATION_RUNNER_UNAVAILABLE: ["configure_a_trusted_desktop_runner", false],
    PROJECT_FOUNDATION_RUNNER_EVIDENCE_INVALID: ["retry_from_the_registered_runner", false],
    PROJECT_FOUNDATION_CONNECTOR_DISABLED: ["enable_a_host_connector", false],
  };
  const [action, retryable] = rules[code] ?? ["retry_or_inspect_host_logs", true];
  return { ok: false, error: { code, action, retryable } };
}
function foundationRefs(value, fields) {
  const result = {};
  for (const field of fields) if (value?.[field] !== undefined) result[field] = value[field];
  return result;
}
const FOUNDATION_BROWSER_ATTENTION = new Set(["connector_credentials_unavailable", "connector_disabled", "git_unavailable", "merge_conflict", "merge_queue_empty", "root_unavailable", "runner_unavailable", "source_dirty", "source_invalid", "status_unavailable"]);
function projectFoundationsBrowserState(mode, state = {}) {
  const sourceStatus = typeof state.sourceStatus === "string" && new Set(["authority_managed", "git_unavailable", "not_created", "not_initialized", "ready", "root_unavailable", "source_dirty", "source_invalid", "status_unavailable"]).has(state.sourceStatus) ? state.sourceStatus : "status_unavailable";
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0;
  const attention = [...new Set(Array.isArray(state.attention) ? state.attention.filter((value) => FOUNDATION_BROWSER_ATTENTION.has(value)) : [])].sort();
  return Object.freeze({
    ok: true,
    mode,
    available: mode !== "unavailable",
    ready: state.ready === true,
    sourceStatus,
    workspaceCount: count(state.workspaceCount),
    claimCount: count(state.claimCount),
    queuedChangeSetCount: count(state.queuedChangeSetCount),
    campaignCount: count(state.campaignCount),
    queuedJobCount: count(state.queuedJobCount),
    runningJobCount: count(state.runningJobCount),
    defectCount: count(state.defectCount),
    outboxPendingCount: count(state.outboxPendingCount),
    attention,
  });
}
function createProjectFoundationManager(ctx, store, projectEntry, desktopGitCapabilityPromise, { runner, connector, runnerEvidenceProvider } = {}) {
  const executionScope = new AsyncLocalStorage(), browserStatusExecution = Object.freeze(Object.create(null));
  const capabilityResult = Promise.resolve(desktopGitCapabilityPromise).then((value) => ({ value }), (error) => ({ error }));
  let runtime;
  let runtimePromise;
  let closing = false;
  const resolveTrustedAgent = async () => {
    const hostExecution = executionScope.getStore();
    if (hostExecution === undefined) reject("foundation authorization requires Host tool execution", "PROJECT_FOUNDATIONS_FORBIDDEN");
    if (hostExecution === browserStatusExecution) {
      const roots = [...new Map(ctx.agents.roots().map((root) => [root.id, root])).values()];
      const document = await store.read((current) => current);
      const teamRoots = new Set(document.teams.filter((team) => team.state !== "closed").map((team) => team.rootLeadSessionId));
      const scoped = roots.filter((root) => teamRoots.has(root.id)), candidates = scoped.length > 0 ? scoped : roots;
      if (candidates.length !== 1) reject("foundation status requires one live root lead", "PROJECT_FOUNDATIONS_FORBIDDEN");
      const [root] = candidates;
      return { projectRef: (await projectEntry.status()).project?.projectRef, kind: "root", sessionId: root.id, rootSessionHeader: { cwd: root.session?.header?.cwd } };
    }
    const execution = toolExecution(ctx, hostExecution);
    const status = await projectEntry.status();
    const projectRef = status?.project?.projectRef;
    if (typeof projectRef !== "string" || status.project.role !== "owner") reject("foundation authority requires the local project owner", "PROJECT_FOUNDATIONS_FORBIDDEN");
    const caller = execution.agent, document = await store.read((current) => current), activeTeams = document.teams.filter((team) => effectiveTeamState(team) === "active"), rootLeadIds = new Set(activeTeams.map((team) => team.rootLeadSessionId));
    if (rootLeadIds.size !== 1) reject("foundation authority requires one unambiguous active root lead", "PROJECT_FOUNDATIONS_FORBIDDEN");
    const [rootLeadSessionId] = rootLeadIds, root = ctx.agents.get(rootLeadSessionId), liveRoots = ctx.agents.roots();
    if (root === undefined || !liveRoots.includes(root)) reject("foundation root lead is unavailable", "PROJECT_FOUNDATIONS_FORBIDDEN");
    if (liveRoots.includes(caller)) {
      if (caller !== root) reject("foundation root caller does not own the active project teams", "PROJECT_FOUNDATIONS_FORBIDDEN");
      const cwd = root.session?.header?.cwd;
      return { projectRef, kind: "root", sessionId: root.id, rootSessionHeader: { cwd } };
    }
    const candidates = activeTeams.filter((team) => team.rootLeadSessionId === root.id && memberOf(team, caller.id) !== undefined);
    if (candidates.length !== 1) reject("foundation worker must belong to one active team under the project root", "PROJECT_FOUNDATIONS_FORBIDDEN");
    const [team] = candidates;
    const member = memberOf(team, caller.id);
    if (!["running", "idle", "ready"].includes(member.state) || member.shutdownUnconfirmed === true || member.stopUnconfirmed === true) reject("foundation worker membership is not live", "PROJECT_FOUNDATIONS_FORBIDDEN");
    const tasks = team.tasks.filter((task) => task.state === "in_progress" && task.assigneeSessionId === caller.id);
    if (tasks.length !== 1) reject("foundation worker requires one assigned in-progress task", "PROJECT_FOUNDATIONS_FORBIDDEN");
    return {
      projectRef,
      member: { memberId: member.id, sessionId: member.sessionId, state: member.state, kind: member.kind },
      task: { taskId: tasks[0].id, title: tasks[0].title, state: tasks[0].state, assigneeSessionId: tasks[0].assigneeSessionId, files: tasks[0].files },
      team: { teamId: team.id, rootLeadSessionId: team.rootLeadSessionId },
      rootSessionHeader: { cwd: root.session?.header?.cwd },
    };
  };
  const getRuntime = async () => {
    if (closing) { const error = new Error("foundation tools are closed"); error.code = "PROJECT_FOUNDATIONS_CLOSED"; throw error; }
    if (runtime !== undefined) return runtime;
    if (runtimePromise === undefined) runtimePromise = (async () => {
      const capability = await capabilityResult;
      if (capability.error !== undefined) throw capability.error;
      const created = new ProjectFoundationsRuntime({ projectEntry, desktopGitCapability: capability.value, trustedAgentResolver: resolveTrustedAgent, runner, connector });
      if (closing) { await created.close().catch(() => undefined); const error = new Error("foundation tools are closed"); error.code = "PROJECT_FOUNDATIONS_CLOSED"; throw error; }
      runtime = created;
      return created;
    })().finally(() => { runtimePromise = undefined; });
    return runtimePromise;
  };
  const invoke = (hostExecution, method, input = {}) => executionScope.run(hostExecution, async () => {
    const selected = await getRuntime();
    const source = await selected.probe();
    if (source.status === "source_invalid") return { unavailable: true, attention: source.attention, code: source.code };
    if (source.status === "source_dirty") { const error = new Error("source is dirty"); error.code = "PROJECT_FOUNDATIONS_SOURCE_DIRTY"; throw error; }
    if (!selected.safeState().ready) await selected.initialize();
    return selected[method](hostExecution, input);
  });
  const browserState = async () => {
    const status = await projectEntry.status();
    if (!isRecord(status?.project)) return projectFoundationsBrowserState("unavailable", { sourceStatus: "not_created" });
    if (status.project.role !== "owner") return projectFoundationsBrowserState("collaborator", { sourceStatus: "authority_managed" });
    try {
      const selected = await getRuntime();
      const probed = await executionScope.run(browserStatusExecution, () => selected.probe()), current = selected.safeState();
      const attention = [...(current.attention ?? []), ...(probed.attention ?? [])];
      if (runner === undefined) attention.push("runner_unavailable");
      if (connector === undefined) attention.push("connector_disabled");
      return projectFoundationsBrowserState("authority", { ...current, sourceStatus: probed.status ?? current.sourceStatus, attention });
    } catch (error) {
      const unavailable = new Set(["PROJECT_FOUNDATION_GIT_UNAVAILABLE", "PROJECT_FOUNDATION_GIT_UNTRUSTED"]).has(error?.code) ? "git_unavailable" : error?.code === "PROJECT_FOUNDATIONS_FORBIDDEN" ? "root_unavailable" : "status_unavailable";
      return projectFoundationsBrowserState("authority", { sourceStatus: unavailable, attention: [unavailable, ...(runner === undefined ? ["runner_unavailable"] : []), ...(connector === undefined ? ["connector_disabled"] : [])] });
    }
  };
  return {
    invoke,
    browserState,
    runnerEvidence: (hostExecution) => typeof runnerEvidenceProvider === "function" ? runnerEvidenceProvider(hostExecution) : undefined,
    safeState: () => runtime?.safeState() ?? { version: 1, ready: false, closing, sourceStatus: "not_initialized", attention: [] },
    async close() {
      if (closing) return;
      closing = true;
      let selected = runtime;
      if (selected === undefined && runtimePromise !== undefined) selected = await runtimePromise.catch(() => undefined);
      await selected?.close();
      runtime = undefined;
    },
  };
}
function registerProjectFoundationTools(ctx, manager, ready = Promise.resolve()) {
  const execute = (method, project) => async (args, exec) => {
    try { toolExecution(ctx, exec); assertFoundationToolInput(args); await ready; return publicResult(project(await manager.invoke(exec, method, args))); }
    catch (error) { return foundationFailure(error); }
  };
  const empty = {};
  ctx.tools.register(defineTool({
    name: "project_workspace_open", description: "Open the isolated workspace for this exact live worker's one assigned in-progress task. The Host derives the project, team, task, identity, fixed root, file scope, and claim.", parameters: empty, output: TOOL_OUTPUT,
    execute: execute("workspaceOpen", (value) => value.unavailable ? { opened: false, attention: value.attention, code: value.code } : { opened: true, ...foundationRefs(value, ["workspaceRef", "fencingToken", "workspacePath", "claimRef", "created"]) }), presentCall: () => present("Open assigned project workspace"),
  }));
  ctx.tools.register(defineTool({
    name: "project_workspace_close", description: "Close this exact worker's isolated workspace and preserve any already-published ChangeSet for the merge queue.", parameters: empty, output: TOOL_OUTPUT,
    execute: execute("workspaceClose", (value) => value.unavailable ? { closed: false, attention: value.attention, code: value.code } : foundationRefs(value, ["closed", "state"])), presentCall: () => present("Close assigned project workspace"),
  }));
  ctx.tools.register(defineTool({
    name: "project_resource_claim", description: "Claim this worker's assigned files, optionally narrowed to repository-relative resources. Project, identity, workspace, task, and root are always Host-derived.", parameters: { mode: { type: "string", enum: ["read", "write", "exclusive"] }, resources: { type: "array", items: { type: "string" } } }, output: TOOL_OUTPUT,
    execute: execute("resourceClaim", (value) => value.unavailable ? { claimed: false, attention: value.attention, code: value.code } : { claimed: true, ...foundationRefs(value, ["claimRef", "mode", "state"]) }), presentCall: () => present("Claim assigned project resources"),
  }));
  ctx.tools.register(defineTool({
    name: "project_changeset_publish", description: "Publish and enqueue the current assigned workspace ChangeSet. Message is optional and defaults to the trusted task title; all refs, claims, revisions, paths, and Git facts are Host-derived.", parameters: { message: { type: "string" } }, output: TOOL_OUTPUT,
    execute: execute("changeSetPublish", (value) => value.unavailable ? { published: false, attention: value.attention, code: value.code } : { published: true, ...foundationRefs(value, ["changeSetRef"]) }), presentCall: () => present("Publish assigned ChangeSet"),
  }));
  ctx.tools.register(defineTool({
    name: "project_merge_run", description: "Run the next durable merge group as the exact live project root lead or Host system. A missing trusted runner never produces a passing gate or lands code.", parameters: empty, output: TOOL_OUTPUT,
    execute: execute("mergeNext", (value) => value.unavailable ? { merged: false, attention: value.attention, code: value.code } : { ...foundationRefs(value, ["merged", "mergeGroupRef", "artifactSetRef", "recovered", "attention"]), ...(value.campaign ? { campaign: foundationRefs(value.campaign, ["campaignRef", "state"]) } : {}) }), presentCall: () => present("Run next project merge"),
  }));
  ctx.tools.register(defineTool({
    name: "project_quality_submit", description: "Submit evidence supplied by a registered Host runner. This tool accepts no model-provided evidence, lease, signature, identity, path, or approval references and never fabricates a passing result.", parameters: empty, output: TOOL_OUTPUT,
    execute: async (_args, exec) => {
      try {
        toolExecution(ctx, exec);
        await ready;
        const evidence = await manager.runnerEvidence(exec);
        if (evidence === undefined) { const error = new Error("trusted runner evidence is unavailable"); error.code = "PROJECT_FOUNDATION_RUNNER_UNAVAILABLE"; throw error; }
        const value = await manager.invoke(exec, "qualitySubmit", evidence);
        return publicResult({ submitted: true, ...foundationRefs(value, ["jobRef", "state"]), ...(value.campaign ? { campaign: foundationRefs(value.campaign, ["campaignRef", "state"]) } : {}) });
      } catch (error) { return foundationFailure(error); }
    }, presentCall: () => present("Submit trusted quality evidence"),
  }));
  ctx.tools.register(defineTool({
    name: "project_defect_action", description: "Apply one local-first defect lifecycle action. External dispatch remains disabled unless the Desktop Host explicitly configured a connector; identity, project, paths, and evidence refs are never browser/model inputs.", parameters: { method: { type: "string", required: true }, payload: { type: "object", additionalProperties: true } }, output: TOOL_OUTPUT,
    execute: execute("defectAction", (value) => value.unavailable ? { completed: false, attention: value.attention, code: value.code } : { completed: true, ...foundationRefs(value, ["signalRef", "occurrenceRef", "defectRef", "state", "status"]) }), presentCall: (args) => present("Update local project defect", args.method),
  }));
}

function registerProjectFoundationsApi(ctx, manager, ready = Promise.resolve()) {
  const fail = (res, status, code) => { const error = new Error(code); error.code = code; return json(res, status, foundationFailure(error)); };
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/foundations/state", handler: async (req, res) => {
      if (req.method !== "GET") return fail(res, 405, "PROJECT_FOUNDATIONS_METHOD_NOT_ALLOWED");
      if (!trustedRequest(req)) return fail(res, 403, "PROJECT_FOUNDATIONS_FORBIDDEN");
      try { projectTaskQuery(req, new Set()); }
      catch { return fail(res, 400, "PROJECT_FOUNDATIONS_INVALID_REQUEST"); }
      try { await ready; return json(res, 200, await manager.browserState()); }
      catch (error) { return json(res, 503, foundationFailure(error)); }
    },
  }), "agent-teams project foundations state route");
}

function registerTools(ctx, store, ready, collaboration, admission, resolveUnknownAuthorization) {
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
    description: "Start a durable peer team owned by this fixed top-level root lead. Use this manual creation path only when a complete bounded team_bootstrap plan is not ready; never call team_start before team_bootstrap for the same team. Call this in the current direct-human root turn as soon as you identify at least two sustained independent workstreams that require visible managed members and ongoing coordination; do not substitute multiple ordinary subagents. Automatic use normally requires at least two sustained independent workstreams delegated to different visible workers; the lead does not count, and one continuable helper should use ordinary subagent instead. An explicit user team request may override this automatic threshold. At most 8 teams may remain unclosed, and all peers share maxActiveTurns. Requires direct-human root authority in the current open turn.",
    parameters: {
      objective: { type: "string", required: true, description: "Concrete objective shared by the team." },
      name: { type: "string", description: "Optional short team display name." },
      lead_name: { type: "string", description: "Optional display name for the root lead." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult({ team: await createTeam(store, execution.agent, { objective: args.objective, name: args.name, leadName: args.lead_name }) }); }),
    presentCall: (args) => present("Start agent team", args.name ?? args.objective),
  }));
  ctx.tools.register(defineTool({
    name: "team_plan_commit",
    description: "CAS-commit the current durable draft plan. Without durable successful worker-publication history it persists committed; the first fully successful spawn records publication and activates it, and that history survives graceful retirement while provisioning or initial publication/work-followup failure never establishes it. Upgraded retired workers without the marker require an exact task execution receipt; retired state alone does not qualify. Initial establishment requires direct-human root authority. A later automatic goal round may recommit without a new user message only for the same exact live root and canonical project while the team is active/unpaused, every capability is verified, files are conflict-free, cost remains inside the user's ordinary default AI-routing grant, and every effect is policy none with no outcome_unknown. Any unsafe or uncertain fact fails closed. Continuing/default authority remains human_attested, never host_verified; material changes still require the exact current hash and revision.",
    parameters: {
      team_id: { type: "string" },
      expected_revision: { type: "number", required: true, description: "Exact plan.revision from the latest team projection." },
      confirmed_plan_hash: { type: "string", required: true, description: "Exact plan.hash from the latest Host projection; without a trusted Host UI token this binds only human_attested authority." },
      permissions_verified: { type: "boolean", description: "A human attestation only; it never creates host_verified capability facts or bulk-upgrades unknown capabilities." },
      files_verified: { type: "boolean" },
      cost_verified: { type: "boolean" },
      external_side_effects_verified: { type: "boolean", description: "True only for direct-user verification of the declared external effects." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await commitTeamPlan(ctx, store, execution.agent, { teamId: args.team_id, expectedRevision: args.expected_revision, confirmedPlanHash: args.confirmed_plan_hash, permissionsVerified: args.permissions_verified, filesVerified: args.files_verified, costVerified: args.cost_verified, externalSideEffectsVerified: args.external_side_effects_verified, automaticContinuation: !hasDirectHumanRootAuthority(ctx, execution) }))),
    presentCall: (args) => present("Commit agent team plan", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_bootstrap",
    description: "Create one bounded team plan, persist all tasks before work starts, and provision up to four visible peers. Use this directly instead of team_start when the complete plan is ready; never call both for the same team. Different members must have non-overlapping file scopes. Requires the exact direct-human root turn. request_id makes exact replays reuse the same durable plan; uncertain partial starts fail closed and never duplicate a visible member automatically.",
    parameters: {
      request_id: { type: "string", required: true }, objective: { type: "string", required: true }, name: { type: "string" }, lead_name: { type: "string" },
      tasks: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { key: { type: "string", required: true }, title: { type: "string", required: true }, description: { type: "string" }, member_key: { type: "string", required: true }, depends_on: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } } } } },
      members: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { key: { type: "string", required: true }, name: { type: "string", required: true }, role: { type: "string", required: true }, prompt: { type: "string", required: true }, model_tier: { type: "string", enum: MODEL_TIERS }, model: { type: "string" } } } },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => { requireDirectHumanRoot(ctx, execution); return publicResult(await bootstrapTeam(ctx, store, admission, execution.agent, { requestId: args.request_id, objective: args.objective, name: args.name, leadName: args.lead_name, tasks: (args.tasks ?? []).map((task) => ({ key: task.key, title: task.title, description: task.description, memberKey: task.member_key, dependsOn: task.depends_on, files: task.files })), members: (args.members ?? []).map((member) => ({ key: member.key, name: member.name, role: member.role, prompt: member.prompt, modelTier: member.model_tier, model: member.model })) }, signal)); }),
    presentCall: (args) => present("Bootstrap agent team", args.name ?? args.objective),
  }));
  ctx.tools.register(defineTool({
    name: "team_spawn",
    description: "Provision a continuable independent-context member from a committed or active plan. The first fully successful spawn activates a still-committed plan. Public spawn requires one or more persisted pending task_ids; member placeholder creation and task pre-binding commit atomically before child creation. The AI chooses the tier by task: subagent by default, main only for complex or security-critical work. New members read the latest selected-tier route while existing members retain their creation route.",
    parameters: {
      team_id: { type: "string", description: "Optional only when the root lead owns exactly one active team." }, name: { type: "string", required: true },
      role: { type: "string", required: true }, prompt: { type: "string", required: true },
      task_ids: { type: "array", items: { type: "string" }, description: "Required and non-empty at runtime: persisted pending tasks atomically pre-bound to this member." },
      model_tier: { type: "string", enum: MODEL_TIERS, description: "AI-selected route tier; defaults to subagent. Choose main only under the documented complexity criteria." },
      model: { type: "string", description: "Optional explicit model override; for backward compatibility its provider is inherited from the exact live lead, not from model_tier." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await spawnMember(ctx, store, admission, execution.agent, { teamId: args.team_id, name: args.name, role: args.role, prompt: args.prompt, taskIds: args.task_ids, modelTier: args.model_tier, model: args.model }, signal))),
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
    execute: run(async (args, execution, signal) => publicResult(await sendTeamMessage(ctx, store, admission, execution.agent, { teamId: args.team_id, targetTeamId: args.target_team_id, recipientSessionId: args.recipient_session_id, message: args.message }, signal))),
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
    execute: run(async (args, execution, signal) => publicResult(await submitExpansionRequest(ctx, store, admission, execution.agent, {
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
    execute: run(async (args, execution, signal) => publicResult(await sendTeamMessage(ctx, store, admission, execution.agent, {
      teamId: args.team_id,
      recipientSessionId: args.recipient_session_id,
      message: args.content,
      memoryPack: { taskId: args.task_id, expiresAt: args.expires_at },
    }, signal))),
    presentCall: (args) => present("Deliver ephemeral memory pack", args.task_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_create", description: "Create a durable pending task with local or authorized peer-team dependencies. Creating a task is a material plan change: the team returns to draft until a fresh CAS team_plan_commit. Capability claims from tool input remain unknown until direct-user verification.",
    parameters: { team_id: { type: "string" }, title: { type: "string", required: true }, description: { type: "string" }, assignee_session_id: { type: "string" }, depends_on: { type: "array", items: { type: "string" } }, cross_team_depends_on: { type: "array", items: { type: "string" }, description: "Peer dependencies as team_id:task_id; only their shared fixed root lead may create them." }, files: { type: "array", items: { type: "string" }, description: "Optional normalized file paths this task may edit; overlapping active tasks are flagged." }, capabilities: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string", required: true }, status: { type: "string", enum: ["unavailable", "unknown"], description: "Caller declarations cannot create verified capabilities." } } }, description: "Required capabilities. Model/tool input remains unknown unless it conservatively declares unavailable; only registered Host evidence may verify an individual capability." }, external_effects: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string", required: true }, policy: { type: "string", enum: EXTERNAL_EFFECT_POLICIES, required: true }, outcome: { type: "string", enum: EXTERNAL_EFFECT_OUTCOMES } } }, description: "Declare effects only. The Host derives stable effect/idempotency keys from team, task, and effect identity; caller keys are never accepted." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      if ((args.cross_team_depends_on?.length ?? 0) > 0) {
        const sourceTeam = await store.read((document) => findTeam(document, nonEmptyString(args.team_id, "team_id", 256)));
        requireLiveRootLead(ctx, sourceTeam, execution.agent);
      }
      return publicResult(await createTask(store, execution.agent, { teamId: args.team_id, title: args.title, description: args.description, assigneeSessionId: args.assignee_session_id, dependsOn: args.depends_on, crossTeamDependsOn: args.cross_team_depends_on, files: args.files, capabilities: args.capabilities, externalEffects: (args.external_effects ?? []).map((effect) => ({ name: effect.name, policy: effect.policy, outcome: effect.outcome })) }));
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
    name: "team_task_update", description: "Atomically claim, release, submit completion, independently accept, cancel, reopen, assign, or unassign a team task. Only the exact claimant may complete with its claimId/leaseEpoch; that call persists a task-scoped submission fact. The fixed root uses accept as a separate fact and cannot complete a worker's foreign claim. A report or successful member turn never completes the durable task.",
    parameters: { team_id: { type: "string" }, task_id: { type: "string", required: true }, action: { type: "string", enum: ["claim", "release", "complete", "accept", "cancel", "reopen", "assign", "unassign"], description: "requested transition; repeated claim, exact completion replay, acceptance, and lead assign of the current assignee are safe no-ops" }, state: { type: "string", enum: MUTABLE_TASK_STATES }, assignee_session_id: { type: "string", description: "target member id or unique member name for assign; must be the current assignee to be a no-op, otherwise the task must still be pending" }, claim_id: { type: "string", description: "Required for non-lead release/complete; exact claimId returned by claim." }, lease_epoch: { type: "number", description: "Required for non-lead release/complete; exact leaseEpoch returned by claim." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await updateTask(store, execution.agent, { teamId: args.team_id, taskId: args.task_id, action: args.action, state: args.state, assigneeSessionId: args.assignee_session_id, claimId: args.claim_id, leaseEpoch: args.lease_epoch }))),
    presentCall: (args) => present("Update team task", `${args.action}: ${args.task_id}`),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_checkpoint", description: "Persist a member-authored checkpoint and/or next step separately from Host task state. Both fields remain explicitly unverified and require the current claim_id plus lease_epoch; they never complete a task or prove progress.",
    parameters: { team_id: { type: "string" }, task_id: { type: "string", required: true }, claim_id: { type: "string", required: true }, lease_epoch: { type: "number", required: true }, checkpoint: { type: "string" }, next_step: { type: "string" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await updateTaskCheckpoint(store, execution.agent, { teamId: args.team_id, taskId: args.task_id, claimId: args.claim_id, leaseEpoch: args.lease_epoch, checkpoint: args.checkpoint, nextStep: args.next_step }))),
    presentCall: (args) => present("Record unverified task checkpoint", args.task_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_external_effect", description: "Fence a declared external side effect. prepare persists outcome_unknown before the action and returns an attemptId; succeeded/failed must echo it. Resolving an unknown outcome requires a short-lived, single-use Host authorization bound to this exact tool, turn, attempt, outcome, team epoch/revision, and canonical parameters. Exactly-once is available only to participating idempotent protocols, never arbitrary UI actions.",
    parameters: { team_id: { type: "string" }, task_id: { type: "string", required: true }, effect_name: { type: "string", required: true }, action: { type: "string", required: true, enum: ["prepare", "succeeded", "failed", "resolve_unknown"] }, attempt_id: { type: "string" }, claim_id: { type: "string" }, lease_epoch: { type: "number" }, outcome: { type: "string", enum: ["succeeded", "failed", "not_started"] }, authorization_id: { type: "string", description: "Opaque single-use Host confirmation id; required only for resolve_unknown." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      let authorization;
      if (args.action === "resolve_unknown") {
        requireDirectHumanRoot(ctx, execution);
        authorization = await authorizeResolveUnknown(store, resolveUnknownAuthorization, execution, { authorizationId: args.authorization_id, teamId: args.team_id, taskId: args.task_id, effectName: args.effect_name, attemptId: args.attempt_id, outcome: args.outcome });
      }
      return publicResult(await updateTaskExternalEffect(store, execution.agent, { teamId: args.team_id, taskId: args.task_id, effectName: args.effect_name, action: args.action, attemptId: args.attempt_id, claimId: args.claim_id, leaseEpoch: args.lease_epoch, outcome: args.outcome, authorization }));
    }),
    presentCall: (args) => present("Fence external task effect", `${args.action}: ${args.effect_name}`),
  }));
  ctx.tools.register(defineTool({
    name: "team_recover", description: "List or explicitly close inactive orphaned teams whose original root lead is unavailable. Requires a direct-human root turn; confirm must be true to mutate state.",
    parameters: { team_id: { type: "string" }, confirm: { type: "boolean" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await recoverOrphanTeams(ctx, store, execution, { teamId: args.team_id, confirm: args.confirm }))),
    presentCall: (args) => present(args.confirm === true ? "Recover orphaned team" : "Inspect orphaned teams", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_handoff", description: "Prepare a short-lived, direct-user-authorized handoff of one durably paused team to another exact live root in the same verified project scope. Cross-project handoff and unknown project scope fail closed.",
    parameters: { team_id: { type: "string" }, target_root_session_id: { type: "string", required: true }, lead_name: { type: "string" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await prepareTeamHandoff(ctx, store, execution.agent, { teamId: args.team_id, targetRootSessionId: args.target_root_session_id, leadName: args.lead_name })); }),
    presentCall: (args) => present("Prepare same-project team handoff", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_adopt", description: "Adopt a paused team from a direct-user-authorized same-project handoff. Requires the exact target live root and the short-lived handoff token; historical identities remain retained for audit.",
    parameters: { team_id: { type: "string", required: true }, handoff_token: { type: "string", required: true }, lead_name: { type: "string" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await adoptTeamHandoff(ctx, store, execution.agent, { teamId: args.team_id, handoffToken: args.handoff_token, leadName: args.lead_name })); }),
    presentCall: (args) => present("Adopt same-project agent team", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_resume", description: "Two-phase resume for a team paused by explicit Stop. First call without commit to persist a preview. Then CAS-commit with preview_id, expected_pause_epoch, and expected_team_revision. Abnormal nodes remain attention items and never freeze healthy nodes; no member is woken automatically.",
    parameters: { team_id: { type: "string", description: "Optional only when the root lead owns exactly one paused team." }, request_id: { type: "string", description: "Optional request id. Replaying it returns the same durable preview/receipt." }, commit: { type: "boolean", description: "False/omitted creates a preview; true CAS-commits it." }, preview_id: { type: "string" }, expected_pause_epoch: { type: "number" }, expected_team_revision: { type: "number" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await resumePausedTeam(ctx, store, execution.agent, { teamId: args.team_id, requestId: args.request_id, commit: args.commit, previewId: args.preview_id, expectedPauseEpoch: args.expected_pause_epoch, expectedTeamRevision: args.expected_team_revision })); }),
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
    name: "team_shutdown", description: "Gracefully retire one member or close the whole team only after its durable tasks are reconciled. Graceful member retirement rejects unfinished owned tasks; graceful team shutdown rejects any unfinished task. Force member retirement releases owned tasks with an attention marker, while force team shutdown records unfinished tasks as cancelled before closing.",
    parameters: { team_id: { type: "string", description: "Optional only when the root lead owns exactly one unclosed team." }, member_session_id: { type: "string" }, force: { type: "boolean" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await shutdownTeam(ctx, store, admission, execution.agent, { teamId: args.team_id, memberSessionId: args.member_session_id, force: args.force }, signal))),
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
function blockSseClientUntilDrain(client) {
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
  if (writable === false) blockSseClientUntilDrain(client);
}
function writeSseKeepalive(client) {
  if (client.closed || client.blocked) return;
  try { if (client.response.write(": keepalive\n\n") === false) blockSseClientUntilDrain(client); }
  catch { client.closed = true; }
}
function createSseBroadcaster({ delayMs = SSE_COALESCE_MS, keepaliveMs = TEAM_SSE_KEEPALIVE_MS, snapshot = teamSnapshot } = {}) {
  const clients = new Map();
  let timer;
  let keepaliveTimer;
  let pendingDocument;
  const stopKeepalive = () => {
    if (keepaliveTimer !== undefined) clearInterval(keepaliveTimer);
    keepaliveTimer = undefined;
  };
  const ensureKeepalive = () => {
    if (keepaliveTimer !== undefined || !Number.isFinite(keepaliveMs) || keepaliveMs <= 0) return;
    keepaliveTimer = setInterval(() => {
      for (const entries of clients.values()) for (const client of [...entries]) {
        if (client.closed) continue;
        writeSseKeepalive(client);
      }
    }, keepaliveMs);
    keepaliveTimer.unref?.();
  };
  const remove = (client) => {
    client.closed = true;
    const entries = clients.get(client.sessionId);
    entries?.delete(client);
    if (entries?.size === 0) clients.delete(client.sessionId);
    if (clients.size === 0) stopKeepalive();
  };
  const add = (sessionId, selectedTeamId, response, selectedTaskId) => {
    const client = { sessionId, selectedTeamId, selectedTaskId, response, blocked: false, closed: false, lastPayload: undefined, pendingPayload: undefined };
    const entries = clients.get(sessionId) ?? new Set();
    entries.add(client);
    clients.set(sessionId, entries);
    ensureKeepalive();
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
        const key = `${sessionId}\u0000${client.selectedTeamId ?? ""}\u0000${client.selectedTaskId ?? ""}`;
        let payload = payloads.get(key);
        if (payload === undefined) {
          payload = encodedSseSnapshot(snapshot(document, sessionId, client.selectedTeamId, client.selectedTaskId));
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
    stopKeepalive();
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
  const detailSnapshot = (document, sessionId, selectedTeamId, selectedTaskId) => projectTaskDetailForUi(ctx, document, sessionId, selectedTeamId, selectedTaskId)
    ?? { unavailable: true, taskId: selectedTaskId ?? null };
  const detailBroadcaster = createSseBroadcaster({ snapshot: detailSnapshot });
  const unsubscribe = store.subscribe((document) => { broadcaster.schedule(document); detailBroadcaster.schedule(document); });
  ctx.on("session/event", (_session, event) => {
    if (detailBroadcaster.clients.size === 0 || !TASK_WORKFLOW_EVENT_TYPES.has(event?.type)) return;
    detailBroadcaster.schedule(store.snapshot());
  });
  ctx.effect(() => () => { unsubscribe(); broadcaster.close(); detailBroadcaster.close(); }, "agent-teams store subscription");
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
    kind: "exact", path: "/api/agent-teams/task-detail", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      try {
        await ready;
        const requestUrl = new URL(req.url, "http://x");
        const sessionId = nonEmptyString(requestUrl.searchParams.get("sessionId"), "sessionId", 256);
        const selectedTeamId = nonEmptyString(requestUrl.searchParams.get("teamId"), "teamId", 256);
        const selectedTaskId = nonEmptyString(requestUrl.searchParams.get("taskId"), "taskId", 256);
        const detail = await store.read((document) => projectTaskDetailForUi(ctx, document, sessionId, selectedTeamId, selectedTaskId));
        return detail === null
          ? json(res, 404, { error: "task detail is unavailable", code: "AGENT_TEAMS_NOT_FOUND" })
          : json(res, 200, detail);
      } catch (error) { return json(res, error?.code === "AGENT_TEAMS_NOT_FOUND" ? 404 : 400, errorPayload(error)); }
    },
  }), "agent-teams task detail route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/task-detail/events", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      try {
        await ready;
        const requestUrl = new URL(req.url, "http://x");
        const sessionId = nonEmptyString(requestUrl.searchParams.get("sessionId"), "sessionId", 256);
        const selectedTeamId = nonEmptyString(requestUrl.searchParams.get("teamId"), "teamId", 256);
        const selectedTaskId = nonEmptyString(requestUrl.searchParams.get("taskId"), "taskId", 256);
        const detail = await store.read((document) => projectTaskDetailForUi(ctx, document, sessionId, selectedTeamId, selectedTaskId));
        if (detail === null) return json(res, 404, { error: "task detail is unavailable", code: "AGENT_TEAMS_NOT_FOUND" });
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
        res.flushHeaders?.();
        const client = detailBroadcaster.add(sessionId, selectedTeamId, res, selectedTaskId);
        detailBroadcaster.send(client, detail);
        req.once("close", () => detailBroadcaster.remove(client));
      } catch (error) { if (!res.headersSent) return json(res, error?.code === "AGENT_TEAMS_NOT_FOUND" ? 404 : 400, errorPayload(error)); }
    },
  }), "agent-teams task detail events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/events", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      try {
        await ready;
        const requestUrl = new URL(req.url, "http://x");
        const sessionId = nonEmptyString(requestUrl.searchParams.get("sessionId"), "sessionId", 256);
        const selectedTeamId = optionalString(requestUrl.searchParams.get("teamId"), "teamId", 256);
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
        res.flushHeaders?.();
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

function projectTaskApiFailure(res, status, code, message, nextAction, retryable = false) {
  return json(res, status, { ok: false, error: { code, message, nextAction, retryable, safeDetails: {} } });
}
function mappedProjectTaskFailure(res, error) {
  const mapped = projectTaskWebError(error);
  return json(res, mapped.status, mapped.body);
}
function projectBusinessApiError(error, resource) {
  const code = typeof error?.code === "string" && error.code.startsWith("PROJECT_BUSINESS_SYNC_") ? error.code : undefined;
  if (code === undefined) return undefined;
  const rules = {
    PROJECT_BUSINESS_SYNC_RUNTIME_INVALID: [400, "fix_request", false],
    PROJECT_BUSINESS_SYNC_FORBIDDEN: [403, `refresh_project_${resource}`, false],
    PROJECT_BUSINESS_SYNC_CONFLICT: [409, "refresh_and_retry", false],
    PROJECT_BUSINESS_SYNC_REPLAY_CONFLICT: [409, "start_new_action", false],
    PROJECT_BUSINESS_SYNC_CONTEXT_CHANGED: [409, `refresh_project_${resource}`, true],
    PROJECT_BUSINESS_SYNC_RUNTIME_UNAVAILABLE: [409, "reconnect_project", true],
    PROJECT_BUSINESS_SYNC_STORE_CONFLICT: [409, "retry_after_refresh", true],
    PROJECT_BUSINESS_SYNC_TRANSPORT_UNAVAILABLE: [503, "reconnect_project", true],
    PROJECT_BUSINESS_SYNC_RUNTIME_CLOSED: [503, "retry_after_runtime_restart", true],
  };
  const [status, nextAction, retryable] = rules[code] ?? [500, "retry_or_view_logs", true];
  return { status, body: { ok: false, error: { code, action: nextAction, retryable } } };
}
function mappedProjectBusinessFailure(res, error, resource, fallback) {
  const mapped = projectBusinessApiError(error, resource) ?? fallback(error);
  return json(res, mapped.status, mapped.body);
}
function projectTaskQuery(req, allowedKeys) {
  const requestUrl = new URL(req.url, "http://x");
  for (const key of requestUrl.searchParams.keys()) {
    if (!allowedKeys.has(key) || requestUrl.searchParams.getAll(key).length !== 1) throw new TypeError("unsupported or repeated project task query field");
  }
  return requestUrl.searchParams;
}
function projectTaskQueryInteger(parameters, key, fallback, minimum, maximum) {
  const raw = parameters.get(key);
  if (raw === null) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) throw new TypeError(`${key} must be a decimal safe integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${key} is outside the allowed range`);
  return value;
}
function encodedProjectTaskSse(event, data, id) {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
function createProjectTaskSseBridge(runtime, { keepaliveMs = PROJECT_TASK_SSE_KEEPALIVE_MS } = {}) {
  if (!(runtime instanceof ProjectTaskWebRuntime)) throw new TypeError("runtime must be a ProjectTaskWebRuntime");
  if (!Number.isSafeInteger(keepaliveMs) || keepaliveMs < 1) throw new TypeError("keepaliveMs must be a positive safe integer");
  const clients = new Set();
  let closed = false;
  const remove = (client, end = false) => {
    if (client.closed) return;
    client.closed = true;
    clients.delete(client);
    clearInterval(client.keepalive);
    client.request.off?.("close", client.onClose);
    client.request.off?.("aborted", client.onClose);
    client.response.off?.("close", client.onClose);
    client.response.off?.("error", client.onClose);
    if (end) {
      try { client.response.end(); } catch {}
    }
  };
  const write = (client, payload) => {
    if (client.closed) return false;
    try {
      if (client.response.write(payload) !== false) return true;
    } catch {}
    remove(client, true);
    return false;
  };
  const broadcast = (update) => {
    if (closed || update?.type !== "project-task" || !isRecord(update.event)) return;
    const payload = encodedProjectTaskSse("task", update.event, update.event.projectRevision);
    for (const client of [...clients]) write(client, payload);
  };
  const unsubscribe = runtime.subscribe(broadcast);
  const add = (request, response) => {
    if (closed) throw new Error("project task SSE bridge is closed");
    const client = { request, response, closed: false, keepalive: undefined, onClose: undefined };
    client.onClose = () => remove(client);
    request.once?.("close", client.onClose);
    request.once?.("aborted", client.onClose);
    response.once?.("close", client.onClose);
    response.once?.("error", client.onClose);
    client.keepalive = setInterval(() => write(client, ": keepalive\n\n"), keepaliveMs);
    client.keepalive.unref?.();
    clients.add(client);
    write(client, encodedProjectTaskSse("reset", { nextAction: "refetch_project_tasks" }));
    return client;
  };
  const reset = () => {
    if (closed) return;
    const payload = encodedProjectTaskSse("reset", { nextAction: "refetch_project_tasks" });
    for (const client of [...clients]) write(client, payload);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    for (const client of [...clients]) remove(client, true);
  };
  return { add, clients, close, remove, reset };
}
function registerProjectTaskApi(ctx, runtime, businessRuntime) {
  const bridge = createProjectTaskSseBridge(runtime);
  const unsubscribeBusiness = businessRuntime === undefined ? undefined : businessRuntime.subscribe(() => bridge.reset());
  ctx.effect(() => () => { unsubscribeBusiness?.(); bridge.close(); }, "agent-teams project task SSE subscription");
  const checkGet = (req, res) => {
    if (req.method !== "GET") {
      projectTaskApiFailure(res, 405, "PROJECT_TASK_WEB_METHOD_NOT_ALLOWED", "Method not allowed.", "use_supported_method");
      return false;
    }
    if (!trustedRequest(req)) {
      projectTaskApiFailure(res, 403, "PROJECT_TASK_WEB_FORBIDDEN", "Request origin is not trusted.", "open_local_task_board");
      return false;
    }
    return true;
  };
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/state", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try {
        projectTaskQuery(req, new Set());
        if (businessRuntime === undefined) return json(res, 200, await runtime.state());
        try { return json(res, 200, await businessRuntime.taskState()); }
        catch (error) { if (error?.code === "PROJECT_ENTRY_NOT_CREATED") return json(res, 200, await runtime.state()); throw error; }
      } catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
    },
  }), "agent-teams project task state route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/events", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try {
        const parameters = projectTaskQuery(req, new Set(["afterRevision", "limit"]));
        const afterRevision = projectTaskQueryInteger(parameters, "afterRevision", 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = projectTaskQueryInteger(parameters, "limit", 100, 1, 100);
        if (businessRuntime !== undefined && (await businessRuntime.initialize()).mode === "collaborator") {
          return json(res, 200, { ok: true, fromRevision: afterRevision, currentRevision: afterRevision, events: [], hasMore: false, reset: true, nextAfterRevision: afterRevision });
        }
        return json(res, 200, await runtime.events({ afterRevision, limit }));
      } catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
    },
  }), "agent-teams project task events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/stream", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try { projectTaskQuery(req, new Set()); }
      catch (error) { return mappedProjectTaskFailure(res, error); }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      });
      res.flushHeaders?.();
      try { bridge.add(req, res); }
      catch { try { res.end(); } catch {} }
    },
  }), "agent-teams project task stream route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/action", handler: async (req, res) => {
      if (req.method !== "POST") return projectTaskApiFailure(res, 405, "PROJECT_TASK_WEB_METHOD_NOT_ALLOWED", "Method not allowed.", "use_supported_method");
      if (!trustedRequest(req) || req.headers["x-harness-agent-teams"] !== "1") return projectTaskApiFailure(res, 403, "PROJECT_TASK_WEB_FORBIDDEN", "Request origin is not trusted.", "open_local_task_board");
      try { projectTaskQuery(req, new Set()); }
      catch (error) { return mappedProjectTaskFailure(res, error); }
      let body;
      try { body = await readJsonBody(req); }
      catch (error) {
        if (error?.status === 413) error.code = "PROJECT_TASK_WEB_BODY_TOO_LARGE";
        return mappedProjectTaskFailure(res, error);
      }
      try { return json(res, 200, await (businessRuntime === undefined ? runtime.action(body) : businessRuntime.taskAction(body))); }
      catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
    },
  }), "agent-teams project task action route");
  return bridge;
}

function projectAutomationApiFailure(res, status, code, message, nextAction, retryable = false) {
  return json(res, status, { ok: false, error: { code, message, nextAction, retryable, safeDetails: {} } });
}
function mappedProjectAutomationFailure(res, error) {
  const mapped = projectAutomationWebError(error);
  return json(res, mapped.status, mapped.body);
}
function createProjectAutomationSseBridge(runtime, { keepaliveMs = PROJECT_TASK_SSE_KEEPALIVE_MS } = {}) {
  if (!(runtime instanceof ProjectAutomationWebRuntime)) throw new TypeError("runtime must be a ProjectAutomationWebRuntime");
  if (!Number.isSafeInteger(keepaliveMs) || keepaliveMs < 1) throw new TypeError("keepaliveMs must be a positive safe integer");
  const clients = new Set();
  let closed = false;
  const remove = (client, end = false) => {
    if (client.closed) return;
    client.closed = true; clients.delete(client); clearInterval(client.keepalive);
    client.request.off?.("close", client.onClose); client.request.off?.("aborted", client.onClose);
    client.response.off?.("close", client.onClose); client.response.off?.("error", client.onClose);
    if (end) { try { client.response.end(); } catch {} }
  };
  const write = (client, payload) => {
    if (client.closed) return false;
    try { if (client.response.write(payload) !== false) return true; } catch {}
    remove(client, true); return false;
  };
  const broadcast = (update) => {
    if (closed || !["automation", "run", "capability"].includes(update?.type)) return;
    const payload = encodedProjectTaskSse("automation", { nextAction: "refetch_project_automations" });
    for (const client of [...clients]) write(client, payload);
  };
  const unsubscribe = runtime.subscribe(broadcast);
  const add = (request, response) => {
    if (closed) throw new Error("project automation SSE bridge is closed");
    const client = { request, response, closed: false, keepalive: undefined, onClose: undefined };
    client.onClose = () => remove(client);
    request.once?.("close", client.onClose); request.once?.("aborted", client.onClose);
    response.once?.("close", client.onClose); response.once?.("error", client.onClose);
    client.keepalive = setInterval(() => write(client, ": keepalive\n\n"), keepaliveMs); client.keepalive.unref?.();
    clients.add(client); write(client, encodedProjectTaskSse("reset", { nextAction: "refetch_project_automations" })); return client;
  };
  const reset = () => { if (closed) return; const payload = encodedProjectTaskSse("reset", { nextAction: "refetch_project_automations" }); for (const client of [...clients]) write(client, payload); };
  const close = () => { if (closed) return; closed = true; unsubscribe(); for (const client of [...clients]) remove(client, true); };
  return { add, clients, close, remove, reset };
}
function registerProjectAutomationApi(ctx, runtime, businessRuntime) {
  const bridge = createProjectAutomationSseBridge(runtime);
  const unsubscribeBusiness = businessRuntime === undefined ? undefined : businessRuntime.subscribe(() => bridge.reset());
  ctx.effect(() => () => { unsubscribeBusiness?.(); bridge.close(); }, "agent-teams project automation SSE subscription");
  const checkGet = (req, res) => {
    if (req.method !== "GET") { projectAutomationApiFailure(res, 405, "PROJECT_AUTOMATION_WEB_METHOD_NOT_ALLOWED", "Method not allowed.", "use_supported_method"); return false; }
    if (!trustedRequest(req)) { projectAutomationApiFailure(res, 403, "PROJECT_AUTOMATION_WEB_FORBIDDEN", "Request origin is not trusted.", "open_local_automation_board"); return false; }
    return true;
  };
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/automations/state", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try {
        projectTaskQuery(req, new Set());
        if (businessRuntime === undefined) return json(res, 200, await runtime.state());
        try { return json(res, 200, await businessRuntime.automationState()); }
        catch (error) { if (error?.code === "PROJECT_ENTRY_NOT_CREATED") return json(res, 200, await runtime.state()); throw error; }
      } catch (error) { return mappedProjectBusinessFailure(res, error, "automations", projectAutomationWebError); }
    },
  }), "agent-teams project automation state route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/automations/stream", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try { projectTaskQuery(req, new Set()); } catch (error) { return mappedProjectAutomationFailure(res, error); }
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
      res.flushHeaders?.(); try { bridge.add(req, res); } catch { try { res.end(); } catch {} }
    },
  }), "agent-teams project automation stream route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/automations/action", handler: async (req, res) => {
      if (req.method !== "POST") return projectAutomationApiFailure(res, 405, "PROJECT_AUTOMATION_WEB_METHOD_NOT_ALLOWED", "Method not allowed.", "use_supported_method");
      if (!trustedRequest(req) || req.headers["x-harness-agent-teams"] !== "1") return projectAutomationApiFailure(res, 403, "PROJECT_AUTOMATION_WEB_FORBIDDEN", "Request origin is not trusted.", "open_local_automation_board");
      try { projectTaskQuery(req, new Set()); } catch (error) { return mappedProjectAutomationFailure(res, error); }
      let body;
      try { body = await readJsonBody(req); } catch (error) { if (error?.status === 413) error.code = "PROJECT_AUTOMATION_WEB_BODY_TOO_LARGE"; return mappedProjectAutomationFailure(res, error); }
      try { return json(res, 200, await (businessRuntime === undefined ? runtime.action(body) : businessRuntime.automationAction(body))); }
      catch (error) { return mappedProjectBusinessFailure(res, error, "automations", projectAutomationWebError); }
    },
  }), "agent-teams project automation action route");
  return bridge;
}

function attachCompletedTaskResults(team, member, info, reportedAt) {
  if (member.runId === undefined || info?.runId === undefined || member.runId !== String(info.runId) || ["error", "refusal"].includes(info.stopReason)) return 0;
  const runStartedAt = Date.parse(member.updatedAt ?? "");
  if (!Number.isFinite(runStartedAt)) return 0;
  const eligible = (team.tasks ?? []).filter((task) => {
    if (task.assigneeSessionId !== member.sessionId || task.state !== "completed" || task.result !== undefined || !taskSubmissionMatches(task)) return false;
    const completedAt = Date.parse(task.completedAt ?? "");
    return Number.isFinite(completedAt) && completedAt >= runStartedAt;
  });
  // A turn-level assistant message is not task-scoped evidence. It can only enrich
  // one unambiguous explicit submission; never clone it across several tasks.
  if (eligible.length !== 1) return 0;
  const [task] = eligible;
  const result = taskResultFromAssistantMessage(info.lastAssistantMessage, reportedAt, {
    taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, reportedBy: member.sessionId,
  });
  if (result === undefined) return 0;
  task.result = result;
  task.updatedAt = reportedAt;
  return 1;
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
          if (["closed", "paused"].includes(effectiveTeamState(team))) continue;
          for (const member of team.members) if (managedIds.has(member.sessionId) && !bySession.has(member.sessionId)) bySession.set(member.sessionId, { member, team });
        }
        for (const { type, info, lifecycleToken } of batch) {
          const target = bySession.get(info.id);
          if (target === undefined) continue;
          const { member, team } = target;
          if (lifecycleToken !== undefined && (lifecycleToken.teamId !== team.id || lifecycleToken.pauseEpoch !== (team.pauseEpoch ?? 0))) continue;
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
          attachCompletedTaskResults(team, member, info, updatedAt);
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
  const enqueue = (type, info) => {
    const lifecycleTokensSupported = typeof store.memberLifecycleToken === "function";
    const lifecycleToken = lifecycleTokensSupported ? store.memberLifecycleToken(info.id) : undefined;
    if (lifecycleTokensSupported && (lifecycleToken === undefined || lifecycleToken.teamState === "paused")) return Promise.resolve();
    return new Promise((resolve) => {
      if (closed) return resolve();
      pending.push({ type, info, lifecycleToken, resolve });
      schedule();
    });
  };
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
function observeSubagents(ctx, store, ready, admission) {
  const reconciler = createSubagentEventReconciler(ctx, store, ready);
  ctx.effect(() => () => reconciler.close(), "agent-teams lifecycle reconciliation");
  ctx.on("subagent/start", (info) => {
    noteGracefulLifecycleStart(info);
    admission.noteStart(info);
    return reconciler.enqueue("start", info);
  });
  ctx.on("subagent/end", (info) => {
    noteGracefulLifecycleEnd(info);
    admission.noteEnd(info);
    return reconciler.enqueue("end", info);
  });
}

function observeUserStops(ctx, store, ready, admission) {
  ctx.on("session/event", (session, event) => {
    if (event.type !== "turn/end" || event.data?.reason?.kind !== "aborted" || event.data.reason.reason?.kind !== "user") return;
    const lead = ctx.agents.get(session.id);
    if (lead === undefined || lead.session !== session) return;
    const selections = store.activeTeamsForRoot(lead.id);
    if (selections.length === 0) return;
    const stoppedAt = now();
    // The in-memory overlay closes the event gate immediately, but the reconciliation
    // durably increments pauseEpoch and marks every team paused before it drains or
    // interrupts any child. Late lifecycle/task writes are fenced by that epoch.
    for (const selection of selections) USER_PAUSED_TEAMS.add(selection.teamId);
    const reconciliation = ready.then(() => pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt));
    for (const selection of selections) USER_PAUSE_RECONCILIATIONS.set(selection.teamId, reconciliation);
    store.notify?.();
    admission?.cancelRoot?.(lead, admissionCancellation());
    // The stock UI cancellation preserves queued inbox work. For a team-owning root,
    // clear it at the durable turn-end boundary so member reports cannot auto-restart.
    lead.cancel({ kind: "user" });
    void reconciliation.catch((error) => ctx.logger.warn(`agent-teams user-stop reconciliation failed: ${String(error)}`))
      .finally(() => {
        for (const selection of selections) {
          if (USER_PAUSE_RECONCILIATIONS.get(selection.teamId) === reconciliation) USER_PAUSE_RECONCILIATIONS.delete(selection.teamId);
        }
      });
  });
}

function resolveConfig(config = {}) {
  return {
    enabled: config.enabled ?? DEFAULT_SETTINGS.enabled,
    maxMembers: safeLimit(config.maxMembers, "maxMembers", DEFAULT_SETTINGS.maxMembers),
    maxActiveTurns: safeLimit(config.maxActiveTurns, "maxActiveTurns", DEFAULT_SETTINGS.maxActiveTurns),
  };
}
// Cordis resolves an optional service through ctx.get(name) without requiring
// it in `inject`; direct property access on an unprovided service throws
// "cannot get property ... without inject" inside an active fiber. The bundled
// runtime never provides projectFoundations, so the Host options must read the
// service exactly once through the non-throwing lookup and default to {}.
//
// Adversarial-boundary projection: only a plain own-data record (Object.prototype
// or null prototype) is accepted. Every projected field must be an own enumerable
// data descriptor; accessors, Proxy traps, class instances, inherited fields, and
// any descriptor/prototype check that throws fail the whole projection closed to
// an empty frozen object. Nothing is ever read through a getter or a proxy get.
//
// node:util/types isProxy performs the brand check without invoking any Proxy
// trap (including revoked and getPrototypeOf-throwing Proxies), so a Proxy is
// rejected before any reflective access can run user code.
function isPlainRecord(value) {
  try {
    // Order matters: typeof/null first never touches a Proxy; then the zero-trap
    // brand check rejects every Proxy (including revoked and getPrototypeOf-
    // throwing ones) before Array.isArray/getPrototypeOf can run. Array.isArray
    // on a revoked Proxy would throw, so it must come after isProxy.
    if (typeof value !== "object" || value === null) return false;
    if (isProxy(value)) return false;
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}
function ownDataDescriptorOrAbsent(value, key) {
  try {
    if (typeof value !== "object" || value === null) return null;
    if (isProxy(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return undefined;
    if (descriptor.enumerable !== true || descriptor.get !== undefined || descriptor.set !== undefined || typeof descriptor.value === "symbol") return null;
    return descriptor.value;
  } catch {
    return null;
  }
}
function resolveProjectFoundationHostOptions(ctx) {
  let value;
  try {
    value = typeof ctx?.get === "function" ? ctx.get("projectFoundations") : undefined;
  } catch {
    return Object.freeze({});
  }
  try {
    if (!isPlainRecord(value)) return Object.freeze({});
    const runner = ownDataDescriptorOrAbsent(value, "runner");
    const connectorRecord = ownDataDescriptorOrAbsent(value, "connector");
    const runnerEvidenceProvider = ownDataDescriptorOrAbsent(value, "runnerEvidence");
    if (runner === null || connectorRecord === null || runnerEvidenceProvider === null) return Object.freeze({});
    let connector;
    if (connectorRecord !== undefined && isPlainRecord(connectorRecord)) {
      const enabled = ownDataDescriptorOrAbsent(connectorRecord, "enabled");
      // A clean own data `enabled: true` projects the connector; an accessor,
      // inherited, non-plain, or non-true own value drops the connector projection.
      if (enabled === true) connector = connectorRecord;
    }
    return Object.freeze({ runner, connector, runnerEvidenceProvider });
  } catch {
    return Object.freeze({});
  }
}
function resolveAgentTeamsAuthorizationProvider(ctx) {
  const desktop = consumeDesktopAuthorizationCapability();
  if (desktop.available === true) return desktop;
  desktop.dispose?.();
  let value;
  try { value = typeof ctx?.get === "function" ? ctx.get("agentTeamsAuthorization") : undefined; }
  catch { return desktop; }
  if (isPlainRecord(value)) {
    const consumeResolveUnknown = ownDataDescriptorOrAbsent(value, "consumeResolveUnknown");
    if (typeof consumeResolveUnknown === "function") return Object.freeze({ consumeResolveUnknown: (request) => consumeResolveUnknown.call(value, request) });
  }
  return desktop;
}

function apply(ctx, config = {}) {
  const defaults = resolveConfig(config);
  const dshHome = process.env.DSH_HOME;
  if (typeof dshHome !== "string" || dshHome.length === 0) throw new Error("dsh-agent-teams requires DSH_HOME");
  // Consume the one-time Desktop Host Git authority immediately. Missing or invalid
  // capability stays a lazy tool-level safe error and never falls back to PATH.
  const desktopGitCapability = consumeDesktopGitCapability().then((value) => value, (error) => Promise.reject(error));
  desktopGitCapability.catch(() => undefined);
  const store = new AgentTeamsStore(join(dshHome, "storages", "agent_teams.json"), defaults);
  const collaboration = new AgentCollaborationService(join(dshHome, "storages", "agent_collaboration.json"));
  // This process-local gate covers only Agent Teams-managed continuable workers.
  // Root turns, ordinary subagents, Schedule root wakeups, and provider retries remain
  // upstream runtime concerns and must not be represented as covered by this limit.
  const admission = createTeamTurnAdmission();
  const authorizationProvider = resolveAgentTeamsAuthorizationProvider(ctx);
  const resolveUnknownAuthorization = createResolveUnknownAuthorizationGate(authorizationProvider);
  ctx.effect(() => () => { admission.close(); authorizationProvider?.dispose?.(); }, "agent-teams worker admission");
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
  const projectTasks = new ProjectTaskWebRuntime({
    projectEntry,
    legacySummaryProvider: async () => {
      await ready;
      return store.read((document) => ({ detected: document.teams.some((team) => team.tasks.length > 0) }));
    },
  });
  const projectAutomations = new ProjectAutomationWebRuntime({ projectEntry });
  const projectBusiness = new ProjectBusinessSyncRuntime({
    projectEntry,
    taskDelegate: { state: () => projectTasks.state(), action: (input) => projectTasks.action(input) },
    automationDelegate: { state: () => projectAutomations.state(), action: (input) => projectAutomations.action(input) },
  });
  const projectFoundations = createProjectFoundationManager(ctx, store, projectEntry, desktopGitCapability, resolveProjectFoundationHostOptions(ctx));
  ready.catch((error) => ctx.logger.error(`agent-teams store initialization failed: ${String(error)}`));
  void ready.then(() => projectBusiness.initialize()).catch((error) => ctx.logger.warn(`agent-teams project sync initialization deferred: ${String(error?.code ?? "unavailable")}`));
  void ready.then((document) => document.teams.length > 0 ? collaboration.syncTeams(withEffectiveTeamStates(document)) : undefined)
    .catch((error) => ctx.logger.warn(`agent-teams collaboration initialization failed: ${String(error)}`));
  ctx.effect(() => {
    const unsubscribe = store.subscribe((document) => {
      if (document.teams.length === 0) return;
      void collaboration.syncTeams(withEffectiveTeamStates(document)).catch((error) => ctx.logger.warn(`agent-teams collaboration sync failed: ${String(error)}`));
    });
    return async () => {
      unsubscribe();
      try { await projectFoundations.close(); }
      finally {
        try { await projectBusiness.close(); }
        finally {
          try { await projectAutomations.close(); }
          finally {
            try { await projectTasks.close(); }
            finally {
              try { await collaboration.close(); }
              finally {
                try { await projectEntry.close(); }
                finally { store.close(); }
              }
            }
          }
        }
      }
    };
  }, "agent-teams collaboration presence");
  registerTools(ctx, store, ready, collaboration, admission, resolveUnknownAuthorization);
  registerProjectFoundationTools(ctx, projectFoundations, ready);
  registerProjectFoundationsApi(ctx, projectFoundations, ready);
  registerWebApi(ctx, store, ready);
  registerProjectEntryApi(ctx, projectEntry);
  registerProjectTaskApi(ctx, projectTasks, projectBusiness);
  registerProjectAutomationApi(ctx, projectAutomations, projectBusiness);
  observeSubagents(ctx, store, ready, admission);
  observeUserStops(ctx, store, ready, admission);
}

export {
  AgentCollaborationService,
  AgentTeamsStore,
  COLLABORATION_REASONS,
  Config,
  GLOBAL_TEAM_ACTIVE_ACTIVATIONS,
  HARD_MAX_MEMBERS,
  HARD_MAX_TEAMS_PER_ROOT,
  GRACEFUL_LIFECYCLE_TIMEOUT_MS,
  MAX_TEAM_ADMISSION_QUEUE,
  MAX_TEAM_ADMISSION_QUEUE_PER_ROOT,
  PROJECT_TASK_SSE_KEEPALIVE_MS,
  SSE_COALESCE_MS,
  SUBAGENT_RECONCILE_MS,
  TEAM_ADMISSION_TIMEOUT_MS,
  UI_MAX_EVENTS_PER_TEAM,
  UI_MAX_TASKS_PER_TEAM,
  UI_MAX_TASK_WORKFLOW_EVENTS,
  createProjectAutomationSseBridge,
  createProjectFoundationManager,
  createProjectTaskSseBridge,
  createResolveUnknownAuthorizationGate,
  createSseBroadcaster,
  createSubagentEventReconciler,
  createTeamTurnAdmission,
  fileBoundaryOverlap,
  normalizeExpansionRequest,
  resourceBoundaryOverlap,
  pauseTeamsForUserStop,
  resumePausedTeam,
  observeUserStops,
  MEMBER_STATES,
  TASK_STATES,
  apply,
  authorizeResolveUnknown,
  bootstrapTeam,
  buildResumePlan,
  commitTeamPlan,
  createTask,
  createTeam,
  adoptTeamHandoff,
  prepareTeamHandoff,
  deriveAttention,
  deriveTask,
  inject,
  name,
  readModelRouting,
  registerProjectAutomationApi,
  registerProjectFoundationsApi,
  registerProjectFoundationTools,
  resolveProjectFoundationHostOptions,
  projectFoundationsBrowserState,
  projectTaskDetailForUi,
  registerProjectTaskApi,
  releaseRetiredMemberTasks,
  resolveAgentTeamsAuthorizationProvider,
  resolveConfig,
  resolveModelSelection,
  resolveUniqueLeadTeam,
  shutdownTeam,
  spawnMember,
  teamSnapshot,
  terminalizeTeamTasks,
  trustedRequest,
  updateTask,
  updateTaskCheckpoint,
  updateTaskExternalEffect,
  waitForGracefulLifecycle,
  validateMember,
  validateMessage,
  validateStoreDocument,
  validateTask,
  validateTeam,
};
