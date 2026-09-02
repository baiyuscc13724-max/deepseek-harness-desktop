import { createHash, createHmac, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isProxy } from "node:util/types";
import z from "@deepseek-ai/schemastery";
import { createUserMessage, HarnessError } from "@deepseek-ai/dsh-llm";
import { queueHostSubagentPrompt, queueSubagentPrompt } from "@deepseek-ai/dsh-subagent/internal";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { COLLABORATION_REASONS } from "./collaboration-broker.js";
import { AgentCollaborationService } from "./collaboration-service.js";
import { consumeDesktopAuthorizationCapability } from "./desktop-authorization-capability.js";
import { consumeDesktopGitCapability } from "./desktop-git-capability.js";
import { ProjectEntryService } from "./project-entry-service.js";
import { ProjectEntryRegistry } from "./project-entry-registry.js";
import { createCustomOfficialCoreProvider, createOfficialCorePorts, isOfficialCorePorts } from "./official-core-ports.js";
import { ProjectFoundationsRuntime } from "./project-foundations-runtime.js";
import { ProjectSessionLaunchRegistry, ProjectSessionLaunchRuntime, resolveProjectSessionLaunchProvider } from "./project-session-launch.js";
import { ProjectAutomationWebRuntime, projectAutomationWebError } from "./project-automation-web.js";
import { ProjectBusinessSyncRuntime } from "./project-business-sync-runtime.js";
import { createProjectTeamBoard, createProjectTeamBoardPage, decorateProjectTeamBoardRecovery, paginatePreparedProjectTeamBoard, prepareProjectTeamBoard, UI_PROJECT_TEAM_BOARD_MAX_BYTES, UI_PROJECT_TEAM_BOARD_MAX_TASKS, UI_PROJECT_TEAM_BOARD_MAX_TEAMS } from "./project-team-board.js";
import { ProjectTaskWebRuntime, projectTaskWebError } from "./project-task-web.js";
import { ProjectCollaborationService, ProjectTaskCommandService } from "./project-task-service.js";
import { ProjectTaskStore } from "./project-task-store.js";

/** Host-only agent-team coordinator. A future client bundle is advertised by package metadata. */
const name = "agent-teams";
const inject = ["agents", "goals", "subagents", "tools", "systemPrompt", "webServer"];
const STORE_VERSION = 8;
const LEGACY_STORE_VERSIONS = new Set([1, 2, 3, 4, 5, 6, 7]);
const LEGACY_TASK_SEMANTICS_VERSIONS = new Set([1, 2, 3, 4, 5, 6]);
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
const UI_PROJECT_TEAM_BOARD_CACHE_MAX_PROJECTS = 16;
const SUBAGENT_RECONCILE_MS = 20;
const GRACEFUL_LIFECYCLE_TIMEOUT_MS = 120_000;
const GLOBAL_TEAM_ACTIVE_ACTIVATIONS = 8;
const MAX_TEAM_ADMISSION_QUEUE = 32;
const MAX_TEAM_ADMISSION_QUEUE_PER_ROOT = 8;
const TEAM_ADMISSION_TIMEOUT_MS = 30_000;
const HARD_MAX_MEMBERS = 8;
const HARD_MAX_TEAMS_PER_ROOT = 8;
const MAX_EXPANSION_WORKSTREAMS = HARD_MAX_MEMBERS;
const MAX_EXPANSION_BOUNDARIES = 16;
const MAX_EXPANSION_REQUEST_CHARS = 24_000;
const MAX_BOOTSTRAP_ITEMS = HARD_MAX_MEMBERS;
const MAX_TASK_ATTEMPT_HISTORY = 24;
const MAX_TASK_INTERRUPTION_HISTORY = 24;
const MAX_TASK_LIFECYCLE_EVENTS = 256;
const MAX_TASK_COMMAND_RECEIPTS = 2_048;
const MAX_ROUTING_RECEIPTS = 2_048;
const MAX_OWNERSHIP_HISTORY = 24;
const MAX_MEMBER_RECOVERY_RECEIPTS = 24;
const MEMBER_RECOVERY_ACTIONS = Object.freeze(["retry", "replace"]);
const MEMBER_RECOVERY_STATES = Object.freeze(["prepared", "delivered", "failed", "outcome_unknown"]);
const MEMBER_RECOVERY_PHASES = Object.freeze(["prepared", "retry_dispatching", "drain_started", "start_dispatched", "child_started", "published", "followup_dispatching", "followup_returned", "reconciled"]);
const PLAN_PHASES = Object.freeze(["draft", "committed", "active"]);
const PLAN_AUTHORIZATION_STATES = Object.freeze(["host_verified", "human_attested", "unknown"]);
const PLAN_MIGRATION_STATES = Object.freeze(["ready", "legacy_unplanned", "legacy_active_gate"]);
const CAPABILITY_STATES = Object.freeze(["verified", "unavailable", "unknown"]);
const EXTERNAL_EFFECT_POLICIES = Object.freeze(["none", "idempotent", "confirm_each", "forbidden"]);
const EXTERNAL_EFFECT_OUTCOMES = Object.freeze(["not_started", "succeeded", "failed", "outcome_unknown"]);
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  maxMembers: 4,
  maxActiveTurns: 4,
  autopilotEnabled: true,
  autopilotMaxAdditionalRounds: 200,
});
const AGENT_TEAM_AUTOPILOT_SETTINGS_KEYS = Object.freeze(["enabled", "maxMembers", "maxActiveTurns", "autopilotEnabled", "autopilotMaxAdditionalRounds"]);
const MODEL_ROUTING_FILE = "harness-desktop-model-routing.json";
const MODEL_TIERS = Object.freeze(["main", "subagent"]);
const MANAGED_MEMBER_DENIED_TOOLS = Object.freeze(["subagent", "subagent_fork", "workflow", "ralph"]);
const MANAGED_MEMBER_DENIED_TOOL_NAMES = new Set(MANAGED_MEMBER_DENIED_TOOLS);
const PROVISIONING_MEMBER_SESSION_IDS = new Set();
const PROVIDER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const MODEL_ID = /^\S{1,256}$/u;
const TASK_STATES = Object.freeze(["pending", "in_progress", "submitted", "completed", "cancelled"]);
const MUTABLE_TASK_STATES = Object.freeze(["pending", "in_progress", "submitted", "completed"]);
const TERMINAL_TASK_STATES = new Set(["completed", "cancelled"]);
const FIXED_ROOT_TASK_COMMANDS = new Set(["release", "accept", "reject", "cancel", "reopen", "assign", "unassign"]);
const TASK_LIFECYCLE_KINDS = Object.freeze(["claim", "submission", "acceptance", "reopen", "reject", "cancel", "release", "migration"]);
const ROUTING_LEVELS = Object.freeze(["level1", "level2", "level3"]);
const ROUTING_REASON_CATEGORIES = Object.freeze(["simple_or_tightly_coupled", "single_auxiliary_executor", "independent_sustained_workstreams", "explicit_user_team_request"]);
const ROUTING_CREATION_PATHS = Object.freeze(["none", "subagent", "team_start", "team_bootstrap"]);
const ROUTING_OUTCOMES = Object.freeze(["recorded", "created", "reused", "failed"]);
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
const PROJECT_TASK_STOPPED_ROOTS = new Set();
const PROJECT_TASK_WAKE_CHAINS = new Map();
const PROJECT_TASK_WAKE_EVENT_TAIL = 256;
const PROJECT_TASK_WAKE_RETRY_BASE_MS = 250;
const PROJECT_TASK_WAKE_RETRY_MAX_MS = 30_000;
const PROJECT_ROOT_RECOVERY_RETRY_BASE_MS = 1_000;
const PROJECT_ROOT_RECOVERY_RETRY_MAX_MS = 30_000;
const AGENT_TEAM_AUTOPILOT_ROUND_GRANT = 1;
const AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS = 200;
const AGENT_TEAM_AUTOPILOT_RETRY_BASE_MS = 50;
const AGENT_TEAM_AUTOPILOT_RETRY_MAX_MS = 1_000;
const AGENT_TEAM_AUTOPILOT_MAX_RETRIES = 3;
const AGENT_TEAM_AUTOPILOT_AUTHORIZATION_HEADER = "x-harness-agent-teams-authorization";
const MAX_AGENT_TEAM_AUTOPILOT_WAKES = 128;
const AGENT_TEAM_AUTOPILOT_STATUSES = Object.freeze(["pending_plan", "active", "revoked", "exhausted"]);
const AGENT_TEAM_AUTOPILOT_WAKE_STATUSES = Object.freeze(["prepared", "goal_mutated", "delivered", "cancelled"]);
const AGENT_TEAM_AUTOPILOT_WAKE_KINDS = Object.freeze(["review_submission", "dispatch_work", "member_attention", "close_team", "reconcile_work"]);
const AGENT_TEAM_AUTOPILOT_HOST_SCOPE_KEYS = new Set(["rootSessionId", "projectKey", "goalId", "teamId", "pauseEpoch", "teamScopeHash"]);
// A recovery starts at revision 1, reserves at revision 2, and every retry
// effect is fenced by a durable transition to activated.  Stop background
// effects at revision 10 so even the shortest failed cycle can perform no more
// than four total launch attempts (the user-initiated attempt plus three
// automatic attempts).  Extra evidence transitions only reduce that budget.
const PROJECT_ROOT_RECOVERY_AUTO_EFFECT_REVISION_LIMIT = 10;
const STOPPABLE_MEMBER_STATES = new Set(["provisioning", "running", "idle", "ready", "shutting_down"]);
const STORE_INSTANCES = new Map();
const TEAM_KEYS = new Set(["id", "rootLeadSessionId", "name", "objective", "revision", "state", "createdAt", "updatedAt", "members", "tasks", "messages", "start", "bootstrap", "plan", "autopilot", "pauseEpoch", "resume", "handoff", "projectKey", "ownershipHistory", "closure", "memberRecoveries", "taskCommandReceipts"]);
const TEAM_START_KEYS = new Set(["requestId", "inputHash"]);
const AUTOPILOT_KEYS = new Set(["version", "status", "authority", "grantId", "routingReceiptId", "authorizationEpoch", "rootSessionId", "projectKey", "goalId", "goalObjectiveHash", "pauseEpochAtGrant", "planHashAtGrant", "baseMaxGoalRounds", "expectedMaxGoalRounds", "maxAdditionalRounds", "additionalRoundsGranted", "lastStateHash", "parkedGoalRevision", "parkedAt", "wakes", "grantedAt", "revokedAt", "revokeReason"]);
const AUTOPILOT_WAKE_KEYS = new Set(["key", "kind", "stateHash", "roundsStarted", "status", "teamRevision", "targetMaxGoalRounds", "createdAt", "goalRevision", "deliveredAt", "cancelledAt", "reason"]);
const TASK_COMMAND_RECEIPT_KEYS = new Set(["requestId", "inputHash", "taskId", "action", "taskRevisionBefore", "taskRevisionAfter", "pauseEpoch", "createdAt"]);
const MEMBER_RECOVERY_KEYS = new Set(["requestId", "inputHash", "action", "status", "phase", "memberId", "sessionId", "taskIds", "activeTaskIds", "activeClaims", "createdAt", "updatedAt", "pauseEpoch", "teamRevision", "replacementMemberId", "replacementSessionId", "errorCode", "errorStage", "errorMessage", "reconciledAt", "reconciledBy", "resolution"]);
const HANDOFF_KEYS = new Set(["tokenHash", "sourceRootSessionId", "targetRootSessionId", "projectKey", "createdAt", "expiresAt"]);
const OWNERSHIP_HISTORY_KEYS = new Set(["kind", "sourceRootSessionId", "targetRootSessionId", "projectKey", "tokenHash", "at", "pauseEpoch", "autopilotGrantId", "autopilotRoutingReceiptId", "autopilotGoalId", "autopilotStatusAtHandoff", "autopilotRevokedAt", "autopilotRevokeReason"]);
const PLAN_KEYS = new Set(["phase", "revision", "hash", "committedAt", "activatedAt", "authorization", "migrationState"]);
const PLAN_AUTHORIZATION_KEYS = new Set(["source", "attestedAt", "confirmedPlanHash", "permissions", "files", "cost", "externalSideEffects"]);
const RESUME_KEYS = new Set(["previewId", "requestId", "pauseEpoch", "teamRevision", "createdAt", "nodes", "status", "committedAt"]);
const RESUME_NODE_KEYS = new Set(["memberId", "status", "reason"]);
const BOOTSTRAP_KEYS = new Set(["requestId", "inputHash", "phase", "taskRefs", "memberRefs", "createdAt", "updatedAt"]);
const BOOTSTRAP_TASK_REF_KEYS = new Set(["key", "taskId"]);
const BOOTSTRAP_MEMBER_REF_KEYS = new Set(["key", "name", "status", "memberId", "sessionId", "errorCode", "errorStage"]);
const TASK_KEYS = new Set(["id", "title", "description", "state", "revision", "dependsOn", "crossTeamDependsOn", "files", "assigneeSessionId", "createdAt", "updatedAt", "claimedAt", "completedAt", "cancelledAt", "cancellationReason", "releasedAt", "releaseReason", "result", "submission", "acceptance", "attempt", "claimId", "leaseEpoch", "attemptHistory", "interruptionHistory", "lifecycleLedger", "checkpoint", "nextStep", "capabilities", "externalEffects"]);
const TASK_RESULT_KEYS = new Set(["text", "reportedAt", "truncated", "taskId", "claimId", "leaseEpoch", "reportedBy"]);
const TASK_LIFECYCLE_EVENT_KEYS = new Set(["kind", "sequence", "at", "attempt", "claimId", "leaseEpoch", "actorId", "ownerEpoch", "reason"]);
const ROUTING_RECEIPT_KEYS = new Set(["id", "rootSessionId", "turnKey", "projectKey", "level", "reasonCategory", "explicitUserTeamRequest", "candidateWorkstreams", "creationPath", "outcome", "teamId", "decisionAuthority", "establishmentAuthority", "goalId", "goalRevision", "goalRound", "goalObjectiveHash", "goalMaxGoalRounds", "createdAt", "finalizedAt"]);
const ROUTING_RECEIPT_ARCHIVE_KEYS = new Set(["version", "count", "chainHash", "lastReceiptId", "lastArchivedAt"]);
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
  autopilotEnabled: z.boolean().default(false),
  autopilotMaxAdditionalRounds: z.number().step(1).min(1).max(AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS).default(DEFAULT_SETTINGS.autopilotMaxAdditionalRounds),
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
function appendTaskLifecycleEvent(task, event) {
  task.lifecycleLedger ??= [];
  // Preserve enough immutable slots for the shortest successful continuation.
  // claim -> submission -> acceptance, submission -> acceptance, and a
  // retry-producing transition -> claim -> submission -> acceptance. Terminal
  // acceptance/cancel may consume the final slot. No historical entry is
  // deleted, compacted, renumbered, or replaced.
  const requiredAfter = ({ claim: 2, submission: 1, release: 3, reopen: 3, reject: 3 })[event.kind] ?? 0;
  if (task.lifecycleLedger.length + 1 + requiredAfter > MAX_TASK_LIFECYCLE_EVENTS) {
    reject("task lifecycle ledger has no safe capacity for this transition and its terminal continuation; accept or cancel the current work instead", "AGENT_TEAMS_TASK_LEDGER_FULL");
  }
  const entry = {
    ...event,
    sequence: task.lifecycleLedger.length + 1,
    at: event.at ?? now(),
    attempt: event.attempt ?? task.attempt ?? 0,
  };
  task.lifecycleLedger.push(entry);
  return entry;
}
function validateTaskLifecycleLedger(task) {
  const ledger = task.lifecycleLedger ?? [];
  if (!Array.isArray(ledger) || ledger.length > MAX_TASK_LIFECYCLE_EVENTS) throw new TypeError("task.lifecycleLedger is invalid");
  if (ledger.length === MAX_TASK_LIFECYCLE_EVENTS && !["completed", "cancelled"].includes(task.state)) throw new TypeError("a saturated task lifecycle ledger must already have an authoritative terminal outcome");
  let previousTime = -Infinity;
  for (const [index, entry] of ledger.entries()) {
    const field = `task.lifecycleLedger[${index}]`;
    if (!isRecord(entry)) throw new TypeError(`${field} must be an object`);
    assertAllowedKeys(entry, TASK_LIFECYCLE_EVENT_KEYS, field);
    assertEnum(entry.kind, TASK_LIFECYCLE_KINDS, `${field}.kind`);
    if (entry.sequence !== index + 1) throw new TypeError("task lifecycle ledger sequence must be contiguous and append-only");
    assertIsoDate(entry.at, `${field}.at`);
    const timestamp = Date.parse(entry.at);
    if (timestamp < previousTime) throw new TypeError("task lifecycle ledger timestamps must be ordered");
    previousTime = timestamp;
    positiveInteger(entry.attempt, `${field}.attempt`, { allowZero: true });
    optionalString(entry.claimId, `${field}.claimId`, 256);
    if (entry.leaseEpoch !== undefined) positiveInteger(entry.leaseEpoch, `${field}.leaseEpoch`, { allowZero: true });
    optionalString(entry.actorId, `${field}.actorId`, 256);
    if (entry.ownerEpoch !== undefined) positiveInteger(entry.ownerEpoch, `${field}.ownerEpoch`, { allowZero: true });
    optionalString(entry.reason, `${field}.reason`, 1_000);
    if (["claim", "submission", "acceptance", "release"].includes(entry.kind) && (entry.claimId === undefined || entry.leaseEpoch === undefined || entry.actorId === undefined)) throw new TypeError(`${field} requires claim, lease, and actor identity`);
    if (["reopen", "reject", "cancel"].includes(entry.kind) && entry.actorId === undefined) throw new TypeError(`${field} requires actor identity`);
    if (entry.kind === "acceptance" && entry.ownerEpoch === undefined) throw new TypeError(`${field} requires ownerEpoch`);
    if (entry.kind === "migration" && entry.reason === undefined) throw new TypeError(`${field} requires a bounded migration reason`);
  }
}
function validateRoutingReceipt(receipt, index) {
  const field = `routingReceipts[${index}]`;
  if (!isRecord(receipt)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(receipt, ROUTING_RECEIPT_KEYS, field);
  nonEmptyString(receipt.id, `${field}.id`, 256);
  nonEmptyString(receipt.rootSessionId, `${field}.rootSessionId`, 256);
  nonEmptyString(receipt.turnKey, `${field}.turnKey`, 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(receipt.projectKey, `${field}.projectKey`, 64))) throw new TypeError(`${field}.projectKey is invalid`);
  assertEnum(receipt.level, ROUTING_LEVELS, `${field}.level`);
  assertEnum(receipt.reasonCategory, ROUTING_REASON_CATEGORIES, `${field}.reasonCategory`);
  if (typeof receipt.explicitUserTeamRequest !== "boolean") throw new TypeError(`${field}.explicitUserTeamRequest must be boolean`);
  positiveInteger(receipt.candidateWorkstreams, `${field}.candidateWorkstreams`, { allowZero: true });
  assertEnum(receipt.creationPath, ROUTING_CREATION_PATHS, `${field}.creationPath`);
  assertEnum(receipt.outcome, ROUTING_OUTCOMES, `${field}.outcome`);
  optionalString(receipt.teamId, `${field}.teamId`, 256);
  assertEnum(receipt.decisionAuthority, ["model_declared"], `${field}.decisionAuthority`);
  assertEnum(receipt.establishmentAuthority, ["direct_human", "goal_round", "legacy_unknown"], `${field}.establishmentAuthority`);
  const goalRoundFields = ["goalId", "goalRevision", "goalRound", "goalObjectiveHash", "goalMaxGoalRounds"];
  const goalRoundFieldCount = goalRoundFields.filter((key) => receipt[key] !== undefined).length;
  if (goalRoundFieldCount !== 0) {
    if (receipt.establishmentAuthority !== "goal_round" || goalRoundFieldCount !== goalRoundFields.length) throw new TypeError(`${field} exact Goal-round authority is incomplete`);
    nonEmptyString(receipt.goalId, `${field}.goalId`, 256);
    positiveInteger(receipt.goalRevision, `${field}.goalRevision`);
    positiveInteger(receipt.goalRound, `${field}.goalRound`);
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(receipt.goalObjectiveHash, `${field}.goalObjectiveHash`, 64))) throw new TypeError(`${field}.goalObjectiveHash is invalid`);
    positiveInteger(receipt.goalMaxGoalRounds, `${field}.goalMaxGoalRounds`);
    if (receipt.goalRound > receipt.goalMaxGoalRounds) throw new TypeError(`${field} Goal round exceeds its admitted cap`);
  }
  assertIsoDate(receipt.createdAt, `${field}.createdAt`);
  if (receipt.finalizedAt !== undefined) assertIsoDate(receipt.finalizedAt, `${field}.finalizedAt`);
  if (receipt.level !== "level3" && receipt.outcome !== "recorded") throw new TypeError(`${field} Level 1 and Level 2 routing decisions must remain recorded`);
  if (receipt.level !== "level3" && receipt.teamId !== undefined) throw new TypeError(`${field} may bind a team only for Level 3`);
  if (receipt.outcome === "recorded" && (receipt.teamId !== undefined || receipt.finalizedAt !== undefined)) throw new TypeError(`${field} recorded phase cannot claim a team or finalization`);
  if (["created", "reused"].includes(receipt.outcome) && (receipt.level !== "level3" || receipt.teamId === undefined || receipt.finalizedAt === undefined)) throw new TypeError(`${field} successful terminal creation requires a finalized Level 3 team binding`);
  if (receipt.outcome === "failed" && (receipt.finalizedAt === undefined || receipt.teamId !== undefined)) throw new TypeError(`${field} failed routing finalization cannot bind a team and requires finalizedAt`);
  if (receipt.level === "level3" && !receipt.explicitUserTeamRequest && receipt.candidateWorkstreams < 2) throw new TypeError(`${field} Level 3 requires at least two candidate workstreams unless explicitly user-requested`);
  if (receipt.level === "level1" && receipt.creationPath !== "none") throw new TypeError(`${field} Level 1 cannot claim a delegated creation path`);
  if (receipt.level === "level2" && receipt.creationPath !== "subagent") throw new TypeError(`${field} Level 2 requires the single-subagent path`);
  if (receipt.level === "level3" && !["team_start", "team_bootstrap"].includes(receipt.creationPath)) throw new TypeError(`${field} Level 3 requires an Agent Team creation path`);
  return receipt;
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
function taskAwaitsAcceptance(task) {
  return task?.state === "submitted" && taskSubmissionMatches(task) && task.acceptance === undefined;
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
  positiveInteger(task.revision, "task.revision");
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
    if (!["submitted", "completed"].includes(task.state) || !taskSubmissionMatches(task) || task.result.taskId !== task.id || task.result.claimId !== task.claimId || task.result.leaseEpoch !== (task.leaseEpoch ?? 0) || task.result.reportedBy !== task.assigneeSessionId) throw new TypeError("task.result must bind the current task claimant, claim, lease, and submission");
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
    if (!taskSubmissionMatches(task) || !["submitted", "completed"].includes(task.state)) throw new TypeError("task.submission must bind the submitted or accepted task claimant and current lease");
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
  if (task.state === "submitted" && !taskSubmissionMatches(task)) throw new TypeError("submitted state requires a current task-scoped submission");
  if (task.state === "completed" && !taskAcceptanceMatches(task)) throw new TypeError("completed state requires current fixed-root acceptance");
  if (!["submitted", "completed"].includes(task.state) && (task.submission !== undefined || task.acceptance !== undefined || task.result !== undefined)) throw new TypeError("non-review task states cannot retain current submission, acceptance, or result projections");
  if (task.state === "completed" && task.completedAt === undefined) throw new TypeError("completed state requires completedAt");
  if (task.state !== "completed" && task.completedAt !== undefined) throw new TypeError("completedAt requires authoritative completed state");
  validateTaskLifecycleLedger(task);
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

function validateTaskCommandReceipt(receipt, index) {
  const field = `team.taskCommandReceipts[${index}]`;
  if (!isRecord(receipt)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(receipt, TASK_COMMAND_RECEIPT_KEYS, field);
  nonEmptyString(receipt.requestId, `${field}.requestId`, 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(receipt.inputHash, `${field}.inputHash`, 64))) throw new TypeError(`${field}.inputHash is invalid`);
  nonEmptyString(receipt.taskId, `${field}.taskId`, 256);
  assertEnum(receipt.action, [...FIXED_ROOT_TASK_COMMANDS], `${field}.action`);
  positiveInteger(receipt.taskRevisionBefore, `${field}.taskRevisionBefore`);
  positiveInteger(receipt.taskRevisionAfter, `${field}.taskRevisionAfter`);
  if (![receipt.taskRevisionBefore, receipt.taskRevisionBefore + 1].includes(receipt.taskRevisionAfter)) throw new TypeError(`${field} must preserve or advance exactly one task revision`);
  positiveInteger(receipt.pauseEpoch, `${field}.pauseEpoch`, { allowZero: true });
  assertIsoDate(receipt.createdAt, `${field}.createdAt`);
  return receipt;
}

function validateMemberRecovery(receipt, index) {
  if (!isRecord(receipt)) throw new TypeError(`team.memberRecoveries[${index}] must be an object`);
  assertAllowedKeys(receipt, MEMBER_RECOVERY_KEYS, `team.memberRecoveries[${index}]`);
  nonEmptyString(receipt.requestId, `team.memberRecoveries[${index}].requestId`, 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(receipt.inputHash, `team.memberRecoveries[${index}].inputHash`, 64))) throw new TypeError("member recovery inputHash is invalid");
  assertEnum(receipt.action, MEMBER_RECOVERY_ACTIONS, `team.memberRecoveries[${index}].action`);
  assertEnum(receipt.status, MEMBER_RECOVERY_STATES, `team.memberRecoveries[${index}].status`);
  assertEnum(receipt.phase, MEMBER_RECOVERY_PHASES, `team.memberRecoveries[${index}].phase`);
  nonEmptyString(receipt.memberId, `team.memberRecoveries[${index}].memberId`, 256);
  nonEmptyString(receipt.sessionId, `team.memberRecoveries[${index}].sessionId`, 256);
  assertStringArray(receipt.taskIds, `team.memberRecoveries[${index}].taskIds`);
  assertStringArray(receipt.activeTaskIds, `team.memberRecoveries[${index}].activeTaskIds`);
  if (!Array.isArray(receipt.activeClaims) || receipt.activeClaims.length !== receipt.activeTaskIds.length) throw new TypeError(`team.memberRecoveries[${index}].activeClaims is invalid`);
  for (const claim of receipt.activeClaims) {
    if (!isRecord(claim)) throw new TypeError(`team.memberRecoveries[${index}].activeClaims must contain objects`);
    assertAllowedKeys(claim, new Set(["taskId", "claimId", "leaseEpoch"]), `team.memberRecoveries[${index}].activeClaims`);
    nonEmptyString(claim.taskId, `team.memberRecoveries[${index}].activeClaims taskId`, 256);
    nonEmptyString(claim.claimId, `team.memberRecoveries[${index}].activeClaims claimId`, 256);
    positiveInteger(claim.leaseEpoch, `team.memberRecoveries[${index}].activeClaims leaseEpoch`, { allowZero: true });
  }
  assertIsoDate(receipt.createdAt, `team.memberRecoveries[${index}].createdAt`);
  assertIsoDate(receipt.updatedAt, `team.memberRecoveries[${index}].updatedAt`);
  positiveInteger(receipt.pauseEpoch, `team.memberRecoveries[${index}].pauseEpoch`, { allowZero: true });
  positiveInteger(receipt.teamRevision, `team.memberRecoveries[${index}].teamRevision`);
  optionalString(receipt.replacementMemberId, `team.memberRecoveries[${index}].replacementMemberId`, 256);
  optionalString(receipt.replacementSessionId, `team.memberRecoveries[${index}].replacementSessionId`, 256);
  optionalString(receipt.errorCode, `team.memberRecoveries[${index}].errorCode`, 128);
  optionalString(receipt.errorStage, `team.memberRecoveries[${index}].errorStage`, 64);
  optionalString(receipt.errorMessage, `team.memberRecoveries[${index}].errorMessage`, 4_096);
  if (receipt.reconciledAt !== undefined) assertIsoDate(receipt.reconciledAt, `team.memberRecoveries[${index}].reconciledAt`);
  optionalString(receipt.reconciledBy, `team.memberRecoveries[${index}].reconciledBy`, 256);
  if (receipt.resolution !== undefined) assertEnum(receipt.resolution, ["delivered", "not_delivered"], `team.memberRecoveries[${index}].resolution`);
  return receipt;
}

function fixedRootAtOwnershipEpoch(team, ownerEpoch) {
  const currentEpoch = team.pauseEpoch ?? 0;
  if (!Number.isSafeInteger(ownerEpoch) || ownerEpoch < 0 || ownerEpoch > currentEpoch) return undefined;
  let fixedRoot = team.rootLeadSessionId;
  let upperEpoch = currentEpoch + 1;
  const adoptions = (team.ownershipHistory ?? [])
    .filter((entry) => entry.kind === "handoff_adopted")
    .sort((left, right) => right.pauseEpoch - left.pauseEpoch);
  for (const adoption of adoptions) {
    if (adoption.pauseEpoch >= upperEpoch || adoption.pauseEpoch < 1
      || team.projectKey === undefined || adoption.projectKey !== team.projectKey
      || adoption.targetRootSessionId !== fixedRoot) return undefined;
    if (ownerEpoch >= adoption.pauseEpoch) return fixedRoot;
    fixedRoot = adoption.sourceRootSessionId;
    upperEpoch = adoption.pauseEpoch;
  }
  return fixedRoot;
}

function rootAppearsInValidOwnershipChain(team, rootSessionId) {
  let fixedRoot = team.rootLeadSessionId;
  if (fixedRoot === rootSessionId) return true;
  let upperEpoch = (team.pauseEpoch ?? 0) + 1;
  const adoptions = (team.ownershipHistory ?? [])
    .filter((entry) => entry.kind === "handoff_adopted")
    .sort((left, right) => right.pauseEpoch - left.pauseEpoch);
  for (const adoption of adoptions) {
    if (adoption.pauseEpoch >= upperEpoch || adoption.pauseEpoch < 1
      || team.projectKey === undefined || adoption.projectKey !== team.projectKey
      || adoption.targetRootSessionId !== fixedRoot) return false;
    fixedRoot = adoption.sourceRootSessionId;
    if (fixedRoot === rootSessionId) return true;
    upperEpoch = adoption.pauseEpoch;
  }
  return false;
}

function acceptanceOwnerMatchesTeam(team, acceptance) {
  return fixedRootAtOwnershipEpoch(team, acceptance.ownerEpoch) === acceptance.acceptedBy;
}

function inferLegacyAcceptanceOwnerEpoch(team, task) {
  const acceptance = task.acceptance;
  const leaseEpoch = acceptance?.leaseEpoch;
  const currentEpoch = team.pauseEpoch ?? 0;
  const hasOwnershipAmbiguity = team.handoff !== undefined || (team.ownershipHistory ?? []).length > 0;
  if (acceptance === undefined || acceptance.ownerEpoch !== undefined || hasOwnershipAmbiguity
    || !/^[a-f0-9]{64}$/u.test(team.projectKey ?? "")
    || acceptance.acceptedBy !== team.rootLeadSessionId
    || acceptance.taskId !== task.id || acceptance.claimId !== task.claimId
    || leaseEpoch !== task.leaseEpoch || !Number.isSafeInteger(leaseEpoch)
    || leaseEpoch < 0 || leaseEpoch > currentEpoch) return undefined;
  return leaseEpoch;
}

function validateAgentTeamAutopilot(autopilot) {
  if (!isRecord(autopilot)) throw new TypeError("team.autopilot must be an object");
  assertAllowedKeys(autopilot, AUTOPILOT_KEYS, "team.autopilot");
  if (autopilot.version !== 1) throw new TypeError("team.autopilot.version must be 1");
  assertEnum(autopilot.status, AGENT_TEAM_AUTOPILOT_STATUSES, "team.autopilot.status");
  if (autopilot.authority !== "direct_human") throw new TypeError("team.autopilot.authority must be direct_human");
  nonEmptyString(autopilot.grantId, "team.autopilot.grantId", 256);
  nonEmptyString(autopilot.routingReceiptId, "team.autopilot.routingReceiptId", 256);
  if (autopilot.authorizationEpoch !== undefined && !/^[A-Za-z0-9_-]{16,128}$/u.test(nonEmptyString(autopilot.authorizationEpoch, "team.autopilot.authorizationEpoch", 128))) throw new TypeError("team.autopilot.authorizationEpoch is invalid");
  nonEmptyString(autopilot.rootSessionId, "team.autopilot.rootSessionId", 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(autopilot.projectKey, "team.autopilot.projectKey", 64))) throw new TypeError("team.autopilot.projectKey is invalid");
  nonEmptyString(autopilot.goalId, "team.autopilot.goalId", 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(autopilot.goalObjectiveHash, "team.autopilot.goalObjectiveHash", 64))) throw new TypeError("team.autopilot.goalObjectiveHash is invalid");
  positiveInteger(autopilot.pauseEpochAtGrant, "team.autopilot.pauseEpochAtGrant", { allowZero: true });
  if (autopilot.planHashAtGrant !== undefined && !/^[a-f0-9]{64}$/u.test(nonEmptyString(autopilot.planHashAtGrant, "team.autopilot.planHashAtGrant", 64))) throw new TypeError("team.autopilot.planHashAtGrant is invalid");
  positiveInteger(autopilot.baseMaxGoalRounds, "team.autopilot.baseMaxGoalRounds");
  positiveInteger(autopilot.expectedMaxGoalRounds, "team.autopilot.expectedMaxGoalRounds");
  positiveInteger(autopilot.maxAdditionalRounds, "team.autopilot.maxAdditionalRounds");
  positiveInteger(autopilot.additionalRoundsGranted, "team.autopilot.additionalRoundsGranted", { allowZero: true });
  if (autopilot.maxAdditionalRounds > AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS) throw new TypeError("team.autopilot.maxAdditionalRounds exceeds the Host policy limit");
  if (autopilot.additionalRoundsGranted > autopilot.maxAdditionalRounds) throw new TypeError("team.autopilot additional-round budget is inconsistent");
  if (autopilot.expectedMaxGoalRounds !== autopilot.baseMaxGoalRounds + autopilot.additionalRoundsGranted) throw new TypeError("team.autopilot expected goal cap is inconsistent");
  if (autopilot.lastStateHash !== undefined && !/^[a-f0-9]{64}$/u.test(nonEmptyString(autopilot.lastStateHash, "team.autopilot.lastStateHash", 64))) throw new TypeError("team.autopilot.lastStateHash is invalid");
  if (autopilot.parkedGoalRevision !== undefined) positiveInteger(autopilot.parkedGoalRevision, "team.autopilot.parkedGoalRevision");
  if (autopilot.parkedAt !== undefined) assertIsoDate(autopilot.parkedAt, "team.autopilot.parkedAt");
  if (!Array.isArray(autopilot.wakes) || autopilot.wakes.length > MAX_AGENT_TEAM_AUTOPILOT_WAKES) throw new TypeError("team.autopilot.wakes is invalid");
  const wakeKeys = new Set();
  let pendingWakeCount = 0;
  for (const [index, wake] of autopilot.wakes.entries()) {
    if (!isRecord(wake)) throw new TypeError(`team.autopilot.wakes[${index}] must be an object`);
    assertAllowedKeys(wake, AUTOPILOT_WAKE_KEYS, `team.autopilot.wakes[${index}]`);
    const key = nonEmptyString(wake.key, `team.autopilot.wakes[${index}].key`, 256);
    if (wakeKeys.has(key)) throw new TypeError("team.autopilot wake keys must be unique");
    wakeKeys.add(key);
    assertEnum(wake.kind, AGENT_TEAM_AUTOPILOT_WAKE_KINDS, `team.autopilot.wakes[${index}].kind`);
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(wake.stateHash, `team.autopilot.wakes[${index}].stateHash`, 64))) throw new TypeError("team.autopilot wake stateHash is invalid");
    positiveInteger(wake.roundsStarted, `team.autopilot.wakes[${index}].roundsStarted`, { allowZero: true });
    assertEnum(wake.status, AGENT_TEAM_AUTOPILOT_WAKE_STATUSES, `team.autopilot.wakes[${index}].status`);
    positiveInteger(wake.teamRevision, `team.autopilot.wakes[${index}].teamRevision`);
    positiveInteger(wake.targetMaxGoalRounds, `team.autopilot.wakes[${index}].targetMaxGoalRounds`);
    if (wake.targetMaxGoalRounds < autopilot.baseMaxGoalRounds || wake.targetMaxGoalRounds > autopilot.baseMaxGoalRounds + autopilot.maxAdditionalRounds) throw new TypeError("team.autopilot wake target exceeds the fixed grant budget");
    if (wake.roundsStarted > wake.targetMaxGoalRounds) throw new TypeError("team.autopilot wake cannot target an already surpassed goal cap");
    assertIsoDate(wake.createdAt, `team.autopilot.wakes[${index}].createdAt`);
    if (wake.goalRevision !== undefined) positiveInteger(wake.goalRevision, `team.autopilot.wakes[${index}].goalRevision`);
    if (wake.deliveredAt !== undefined) assertIsoDate(wake.deliveredAt, `team.autopilot.wakes[${index}].deliveredAt`);
    if (wake.cancelledAt !== undefined) assertIsoDate(wake.cancelledAt, `team.autopilot.wakes[${index}].cancelledAt`);
    optionalString(wake.reason, `team.autopilot.wakes[${index}].reason`, 1_000);
    if (wake.status === "prepared" && (wake.goalRevision !== undefined || wake.deliveredAt !== undefined || wake.cancelledAt !== undefined || wake.reason !== undefined)) throw new TypeError("prepared team autopilot wake cannot claim a later outcome");
    if (wake.status === "goal_mutated" && (wake.goalRevision === undefined || wake.deliveredAt !== undefined || wake.cancelledAt !== undefined || wake.reason !== undefined)) throw new TypeError("goal-mutated team autopilot wake has inconsistent outcome fields");
    if (wake.status === "delivered" && (wake.goalRevision === undefined || wake.deliveredAt === undefined || wake.cancelledAt !== undefined || wake.reason !== undefined)) throw new TypeError("delivered team autopilot wake requires exact goal evidence");
    if (wake.status === "cancelled" && (wake.cancelledAt === undefined || wake.reason === undefined || wake.deliveredAt !== undefined)) throw new TypeError("cancelled team autopilot wake requires a durable reason");
    if (["prepared", "goal_mutated"].includes(wake.status)) {
      pendingWakeCount += 1;
      if (wake.targetMaxGoalRounds !== autopilot.expectedMaxGoalRounds) throw new TypeError("pending team autopilot wake must match the reserved goal cap");
    } else if (wake.status === "delivered" && wake.targetMaxGoalRounds > autopilot.expectedMaxGoalRounds) throw new TypeError("delivered team autopilot wake exceeds the accepted goal cap");
  }
  if (pendingWakeCount > 1) throw new TypeError("team.autopilot may have at most one pending wake");
  assertIsoDate(autopilot.grantedAt, "team.autopilot.grantedAt");
  if (autopilot.revokedAt !== undefined) assertIsoDate(autopilot.revokedAt, "team.autopilot.revokedAt");
  optionalString(autopilot.revokeReason, "team.autopilot.revokeReason", 1_000);
  if (autopilot.status === "pending_plan" && autopilot.planHashAtGrant !== undefined) throw new TypeError("pending team autopilot cannot pre-claim a plan hash");
  if (autopilot.status === "active" && autopilot.planHashAtGrant === undefined) throw new TypeError("active team autopilot requires an exact plan hash");
  if (["pending_plan", "active"].includes(autopilot.status) && (autopilot.revokedAt !== undefined || autopilot.revokeReason !== undefined)) throw new TypeError("live team autopilot cannot retain revocation metadata");
  if (["revoked", "exhausted"].includes(autopilot.status) && (autopilot.revokedAt === undefined || autopilot.revokeReason === undefined)) throw new TypeError("stopped team autopilot requires a durable reason");
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
  if (team.start !== undefined) {
    if (!isRecord(team.start)) throw new TypeError("team.start must be an object");
    assertAllowedKeys(team.start, TEAM_START_KEYS, "team.start");
    nonEmptyString(team.start.requestId, "team.start.requestId", 256);
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(team.start.inputHash, "team.start.inputHash", 64))) throw new TypeError("team.start.inputHash is invalid");
  }
  if (team.autopilot !== undefined) {
    validateAgentTeamAutopilot(team.autopilot);
    if (team.autopilot.rootSessionId !== team.rootLeadSessionId) throw new TypeError("team.autopilot root must match the fixed team root");
    if (team.projectKey === undefined || team.autopilot.projectKey !== team.projectKey) throw new TypeError("team.autopilot project must match the fixed team project");
    if (team.autopilot.pauseEpochAtGrant > (team.pauseEpoch ?? 0)) throw new TypeError("team.autopilot pause epoch cannot be from the future");
  }
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
    const autopilotAuditFields = ["autopilotGrantId", "autopilotRoutingReceiptId", "autopilotGoalId", "autopilotStatusAtHandoff", "autopilotRevokedAt", "autopilotRevokeReason"];
    const autopilotAuditCount = autopilotAuditFields.filter((field) => entry[field] !== undefined).length;
    if (autopilotAuditCount !== 0) {
      if (entry.kind !== "handoff_adopted" || autopilotAuditCount !== autopilotAuditFields.length) throw new TypeError("ownership handoff autopilot revocation audit is incomplete");
      nonEmptyString(entry.autopilotGrantId, `team.ownershipHistory[${index}].autopilotGrantId`, 256);
      nonEmptyString(entry.autopilotRoutingReceiptId, `team.ownershipHistory[${index}].autopilotRoutingReceiptId`, 256);
      nonEmptyString(entry.autopilotGoalId, `team.ownershipHistory[${index}].autopilotGoalId`, 256);
      assertEnum(entry.autopilotStatusAtHandoff, AGENT_TEAM_AUTOPILOT_STATUSES, `team.ownershipHistory[${index}].autopilotStatusAtHandoff`);
      assertIsoDate(entry.autopilotRevokedAt, `team.ownershipHistory[${index}].autopilotRevokedAt`);
      nonEmptyString(entry.autopilotRevokeReason, `team.ownershipHistory[${index}].autopilotRevokeReason`, 1_000);
    }
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
  const taskCommandReceipts = team.taskCommandReceipts ?? [];
  if (!Array.isArray(taskCommandReceipts) || taskCommandReceipts.length > MAX_TASK_COMMAND_RECEIPTS) throw new TypeError("team.taskCommandReceipts is invalid");
  taskCommandReceipts.forEach(validateTaskCommandReceipt);
  if (new Set(taskCommandReceipts.map((receipt) => receipt.requestId)).size !== taskCommandReceipts.length) throw new TypeError("team.taskCommandReceipts requestIds must be unique");
  const memberRecoveries = team.memberRecoveries ?? [];
  if (!Array.isArray(memberRecoveries) || memberRecoveries.length > MAX_MEMBER_RECOVERY_RECEIPTS) throw new TypeError("team.memberRecoveries is invalid");
  memberRecoveries.forEach(validateMemberRecovery);
  if (new Set(memberRecoveries.map((receipt) => receipt.requestId)).size !== memberRecoveries.length) throw new TypeError("team.memberRecoveries requestIds must be unique");
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
  if (taskCommandReceipts.some((receipt) => !taskIds.has(receipt.taskId))) throw new TypeError("team.taskCommandReceipts references an unknown task");
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
function migrateTaskLifecycleLedger(task, team, sourceVersion) {
  if (Array.isArray(task.lifecycleLedger)) return;
  const candidates = [{ kind: "migration", at: task.createdAt ?? team.createdAt, attempt: 0, reason: `migrated task projection from store v${sourceVersion}` }];
  if (task.claimId !== undefined && task.assigneeSessionId !== undefined) candidates.push({ kind: "claim", at: task.claimedAt ?? task.updatedAt, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? team.pauseEpoch ?? 0, actorId: task.assigneeSessionId });
  if (task.submission !== undefined) candidates.push({ kind: "submission", at: task.submission.submittedAt, attempt: task.attempt ?? 0, claimId: task.submission.claimId, leaseEpoch: task.submission.leaseEpoch, actorId: task.submission.submittedBy });
  if (task.acceptance !== undefined) candidates.push({ kind: "acceptance", at: task.acceptance.acceptedAt, attempt: task.attempt ?? 0, claimId: task.acceptance.claimId, leaseEpoch: task.acceptance.leaseEpoch, actorId: task.acceptance.acceptedBy, ownerEpoch: task.acceptance.ownerEpoch ?? task.acceptance.leaseEpoch });
  candidates.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  task.lifecycleLedger = candidates.map((entry, index) => ({ ...entry, sequence: index + 1 }));
}

function migrateStoreDocument(document) {
  const sourceVersion = document.version;
  const legacy = LEGACY_STORE_VERSIONS.has(sourceVersion);
  const legacyTaskSemantics = LEGACY_TASK_SEMANTICS_VERSIONS.has(sourceVersion);
  // Automatic continuation is selected by default, but a persisted preference
  // is still not Goal authority. Preserve an explicit stored choice and use the
  // product default only when an older store has no preference field at all.
  document.settings.autopilotEnabled ??= DEFAULT_SETTINGS.autopilotEnabled;
  document.settings.autopilotMaxAdditionalRounds ??= DEFAULT_SETTINGS.autopilotMaxAdditionalRounds;
  document.routingReceipts ??= [];
  document.routingReceiptArchive ??= { version: 1, count: 0, chainHash: "0".repeat(64) };
  for (const receipt of document.routingReceipts) {
    receipt.decisionAuthority ??= "model_declared";
    receipt.establishmentAuthority ??= "legacy_unknown";
    if (receipt.outcome !== "recorded") receipt.finalizedAt ??= receipt.createdAt;
  }
  for (const team of document.teams) {
    // No pre-v8 store could contain a Desktop Host-issued autopilot capability.
    // Discard any forged/experimental legacy grant instead of upgrading it into
    // trusted continuation authority during migration.
    if (legacy) team.autopilot = undefined;
    team.pauseEpoch ??= 0;
    team.ownershipHistory ??= [];
    team.taskCommandReceipts ??= [];
    if (team.resume !== undefined) team.resume.requestId ??= `migrated:${team.resume.previewId}`;
    if (typeof team.handoff?.projectScope === "string") {
      const legacyScope = team.handoff.projectScope;
      team.handoff.projectKey = createHash("sha256").update(JSON.stringify(["agent-teams-project-v1", legacyScope])).digest("hex");
      delete team.handoff.projectScope;
      team.projectKey ??= team.handoff.projectKey;
    }
    if (typeof team.handoff?.projectKey === "string") team.projectKey ??= team.handoff.projectKey;
    for (const task of team.tasks ?? []) {
      task.revision ??= 1;
      task.attempt ??= task.state === "in_progress" ? 1 : 0;
      task.leaseEpoch ??= team.pauseEpoch;
      task.attemptHistory ??= [];
      task.interruptionHistory ??= [];
      task.capabilities ??= [];
      task.externalEffects ??= [];
      for (const effect of task.externalEffects) effect.idempotencyKey = hostExternalEffectKey(team.id, task.id, effect.name);
      if (["in_progress", "completed"].includes(task.state) && task.claimId === undefined) {
        task.claimId = `migrated:${task.id}:${task.attempt}`;
        if (task.state === "in_progress") boundedPush(task.attemptHistory, { kind: "migrated_claim", at: task.claimedAt ?? task.updatedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch }, MAX_TASK_ATTEMPT_HISTORY);
      }
      if (task.acceptance !== undefined && task.acceptance.ownerEpoch === undefined) {
        const inferredOwnerEpoch = inferLegacyAcceptanceOwnerEpoch(team, task);
        if (inferredOwnerEpoch !== undefined) task.acceptance.ownerEpoch = inferredOwnerEpoch;
      }
      if (legacyTaskSemantics && task.state === "completed") {
        task.assigneeSessionId ??= team.rootLeadSessionId;
        const completedAt = task.completedAt ?? task.updatedAt;
        task.submission ??= taskSubmission(task, task.assigneeSessionId, completedAt, "legacy_migration");
        if (task.result !== undefined) Object.assign(task.result, { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch, reportedBy: task.result.reportedBy ?? task.assigneeSessionId });
      } else if (legacyTaskSemantics && !["completed", "submitted"].includes(task.state)) {
        task.result = undefined;
        task.submission = undefined;
        task.acceptance = undefined;
      }
      migrateTaskLifecycleLedger(task, team, sourceVersion);
      if (legacyTaskSemantics && task.state === "completed" && task.submission !== undefined && task.acceptance === undefined) {
        task.state = "submitted";
        task.completedAt = undefined;
      }
    }
    const timestamp = team.updatedAt ?? team.createdAt ?? now();
    if (legacyTaskSemantics && team.state === "closed") {
      const hasUnverifiedCompletion = team.tasks.some((task) => task.state === "submitted" && task.submission !== undefined && task.acceptance === undefined);
      terminalizeTeamTasks(team, timestamp, "legacy closed team contained unfinished or unaccepted work");
      const cancelledTaskIds = teamCancelledTaskIds(team);
      team.closure = {
        outcome: hasUnverifiedCompletion ? "forced" : cancelledTaskIds.length > 0 || team.tasks.length === 0 ? "cancelled" : "succeeded",
        closedAt: timestamp, attemptedAt: timestamp,
        reason: hasUnverifiedCompletion
          ? "legacy closed team migrated with unverified legacy completion and no invented acceptance"
          : "legacy closed team migrated to a consistent closure receipt",
        forced: hasUnverifiedCompletion,
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
  document.settings.autopilotEnabled = Boolean(document.settings.autopilotEnabled);
  document.settings.autopilotMaxAdditionalRounds = safeLimit(document.settings.autopilotMaxAdditionalRounds, "settings.autopilotMaxAdditionalRounds", DEFAULT_SETTINGS.autopilotMaxAdditionalRounds, AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS);
  if (!Array.isArray(document.routingReceipts) || document.routingReceipts.length > MAX_ROUTING_RECEIPTS) throw new TypeError("routingReceipts is invalid");
  document.routingReceipts.forEach(validateRoutingReceipt);
  const archive = document.routingReceiptArchive;
  if (!isRecord(archive)) throw new TypeError("routingReceiptArchive must be an object");
  assertAllowedKeys(archive, ROUTING_RECEIPT_ARCHIVE_KEYS, "routingReceiptArchive");
  if (archive.version !== 1) throw new TypeError("routingReceiptArchive.version must be 1");
  positiveInteger(archive.count, "routingReceiptArchive.count", { allowZero: true });
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(archive.chainHash, "routingReceiptArchive.chainHash", 64))) throw new TypeError("routingReceiptArchive.chainHash is invalid");
  optionalString(archive.lastReceiptId, "routingReceiptArchive.lastReceiptId", 256);
  if (archive.lastArchivedAt !== undefined) assertIsoDate(archive.lastArchivedAt, "routingReceiptArchive.lastArchivedAt");
  if ((archive.count === 0) !== (archive.lastReceiptId === undefined || archive.lastArchivedAt === undefined)) throw new TypeError("routingReceiptArchive empty and last-entry markers are inconsistent");
  if (new Set(document.routingReceipts.map((receipt) => receipt.id)).size !== document.routingReceipts.length) throw new TypeError("routing receipt ids must be unique");
  const routingScopeKeys = document.routingReceipts.map((receipt) => `${receipt.rootSessionId}\u0000${receipt.turnKey}`);
  if (new Set(routingScopeKeys).size !== routingScopeKeys.length) throw new TypeError("only one routing receipt may exist per Host-derived root turn");
  document.teams.forEach(validateTeam);
  const teamsById = new Map(document.teams.map((team) => [team.id, team]));
  if (teamsById.size !== document.teams.length) throw new TypeError("team ids must be unique");
  for (const receipt of document.routingReceipts) if (receipt.teamId !== undefined) {
    const team = teamsById.get(receipt.teamId);
    if (team === undefined || !rootAppearsInValidOwnershipChain(team, receipt.rootSessionId) || team.projectKey !== receipt.projectKey) throw new TypeError("routing receipt team scope must be Host-derived from the same ownership chain and project");
  }
  for (const team of document.teams) if (team.autopilot !== undefined && ["pending_plan", "active"].includes(team.autopilot.status)) {
    const receipt = document.routingReceipts.find((candidate) => candidate.id === team.autopilot.routingReceiptId);
    const authorityTeam = receipt?.teamId === undefined ? undefined : teamsById.get(receipt.teamId);
    const exactGoalRoundAuthority = receipt?.establishmentAuthority === "goal_round"
      && receipt.goalId === team.autopilot.goalId
      && receipt.goalObjectiveHash === team.autopilot.goalObjectiveHash
      && receipt.goalMaxGoalRounds === team.autopilot.baseMaxGoalRounds
      && Number.isSafeInteger(receipt.goalRevision) && receipt.goalRevision > 0
      && Number.isSafeInteger(receipt.goalRound) && receipt.goalRound > 0
      && receipt.goalRound <= receipt.goalMaxGoalRounds;
    if (receipt === undefined || receipt.level !== "level3" || !["created", "reused"].includes(receipt.outcome)
      || !(receipt.establishmentAuthority === "direct_human" || exactGoalRoundAuthority) || authorityTeam === undefined
      || receipt.projectKey !== team.projectKey || authorityTeam.projectKey !== team.projectKey
      || authorityTeam.rootLeadSessionId !== team.rootLeadSessionId
      || !rootAppearsInValidOwnershipChain(authorityTeam, receipt.rootSessionId)) {
      throw new TypeError("team.autopilot must bind one finalized Host-admitted Level 3 routing receipt in the same fixed-root project and exact Goal scope");
    }
    if (document.settings.autopilotEnabled !== true || team.autopilot.maxAdditionalRounds > document.settings.autopilotMaxAdditionalRounds) throw new TypeError("live team autopilot exceeds the trusted Host policy");
  }
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
  // Delivery attempts have no persisted retry lineage yet. A later success to the
  // same recipient cannot prove that an older failed payload was superseded.
  const failedDeliveries = team.messages.filter((message) => message.status === "failed").map((message) => message.id);
  const submittedTasks = team.tasks.filter(taskAwaitsAcceptance).map((task) => task.id);
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
  if (submittedTasks.length > 0) codes.push("acceptance_required");
  if (team.state === "closing") codes.push("closure_incomplete");
  if (bootstrapIncomplete) codes.push("bootstrap_incomplete");
  if (planDraft) codes.push("plan_draft");
  if (capabilityUnknownTasks.length > 0) codes.push("capability_unknown");
  if (outcomeUnknownTasks.length > 0) codes.push("outcome_unknown");
  const derivedTasks = team.tasks.map((task) => deriveTaskAcrossTeams(task, team, teams));
  const blockedTasks = derivedTasks.filter((task) => task.blockedBy.length > 0).map((task) => task.id);
  const failedDependencyTasks = derivedTasks.filter((task) => task.failedBy.length > 0).map((task) => task.id);
  if (failedDependencyTasks.length > 0) codes.push("failed_dependency");
  return { required: codes.length > 0, codes, failedMembers, unconfirmedMembers, strandedTasks, releasedTasks, failedDeliveries, submittedTasks, blockedTasks, failedDependencyTasks, bootstrapIncomplete, planDraft, capabilityUnknownTasks, outcomeUnknownTasks };
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
  delete projectedTeam.taskCommandReceipts;
  delete projectedTeam.autopilot;
  if (team.autopilot !== undefined) projectedTeam.autopilot = {
    status: team.autopilot.status,
    maxAdditionalRounds: team.autopilot.maxAdditionalRounds,
    additionalRoundsGranted: team.autopilot.additionalRoundsGranted,
  };
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
function snapshotSessionEvents(session) {
  return typeof session?.snapshotEvents === "function" ? session.snapshotEvents() : [];
}
function taskRuntimeProjection(task, member, agent) {
  const claimedAt = Date.parse(task.claimedAt ?? "");
  const completedAt = Date.parse(task.completedAt ?? "");
  const allEvents = snapshotSessionEvents(agent?.session);
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
      // Profile/default configuration selects the preference only. A trusted
      // settings Save is still required before any exact Goal grant is created.
      autopilotEnabled: settings.autopilotEnabled ?? DEFAULT_SETTINGS.autopilotEnabled,
      autopilotMaxAdditionalRounds: safeLimit(settings.autopilotMaxAdditionalRounds, "autopilotMaxAdditionalRounds", DEFAULT_SETTINGS.autopilotMaxAdditionalRounds, AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS),
    },
    teams: [],
    routingReceipts: [],
    routingReceiptArchive: { version: 1, count: 0, chainHash: "0".repeat(64) },
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
function runWithLifecycleDeadline(operation, { signal, timeoutMs = GRACEFUL_LIFECYCLE_TIMEOUT_MS, label = "team lifecycle operation" } = {}) {
  if (typeof operation !== "function") throw new TypeError("operation must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive safe integer");
  return new Promise((resolve, rejectPromise) => {
    let settled = false;
    const controller = new AbortController();
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      const reason = signal?.reason ?? new HarnessError(`${label} was cancelled`, "AGENT_TEAMS_CANCELLED");
      controller.abort(reason);
      finish(rejectPromise, reason);
    };
    const timer = setTimeout(() => {
      const error = new HarnessError(`${label} did not finish before the lifecycle deadline`, "AGENT_TEAMS_LIFECYCLE_TIMEOUT");
      controller.abort(error);
      finish(rejectPromise, error);
    }, timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason ?? new HarnessError(`${label} was cancelled`, "AGENT_TEAMS_CANCELLED");
      return operation(controller.signal);
    }).then(
      (value) => finish(resolve, value),
      (error) => finish(rejectPromise, error),
    );
  });
}
function drainContinuableChildrenWithDeadline(ctx, lead, childIds, signal, timeoutMs = GRACEFUL_LIFECYCLE_TIMEOUT_MS) {
  if (!Array.isArray(childIds)) throw new TypeError("childIds must be an array");
  if (childIds.length === 0) return Promise.resolve();
  // The installed SubagentRuntime contract accepts only (parent, childIds). The
  // deadline bounds this caller's queue occupancy; it cannot cancel an in-flight
  // SDK drain, so every timeout path must retain shutdownUnconfirmed/stopUnconfirmed.
  return runWithLifecycleDeadline(
    () => ctx.subagents.drainContinuableChildren(lead, childIds),
    { signal, timeoutMs, label: "team member drain" },
  );
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
      migrated = LEGACY_STORE_VERSIONS.has(persisted?.version)
        || persisted?.teams?.some((team) => !Array.isArray(team?.taskCommandReceipts) || team?.tasks?.some((task) => task?.revision === undefined));
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
      const restartInterruptedWorkerSessions = new Set();
      for (const member of team.members) {
        if (!TRANSIENT_MEMBER_STATES.has(member.state)) continue;
        const persistedState = member.state;
        if (member.kind === "worker" && persistedState !== "provisioning") restartInterruptedWorkerSessions.add(member.sessionId);
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
        if (task.state !== "in_progress" || !restartInterruptedWorkerSessions.has(task.assigneeSessionId)) continue;
        const member = team.members.find((candidate) => candidate.kind === "worker" && candidate.sessionId === task.assigneeSessionId);
        if (member === undefined) continue;
        // A persisted claim proves ownership, not that the old process survived. Keep
        // the exact claim for an explicit retry/replace decision, but never project a
        // restarted worker as healthy or silently execute the work a second time.
        member.state = "failed";
        member.runId = undefined;
        member.error = "host restarted while this member owned active work; explicit retry or replacement is required";
        member.updatedAt = now();
        task.updatedAt = member.updatedAt;
        boundedPush(task.interruptionHistory, { kind: "host_restart_during_active_task", at: task.updatedAt, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, reason: "execution outcome is unknown; no automatic replay was attempted" }, MAX_TASK_INTERRUPTION_HISTORY);
        bumpTaskRevision(task);
        teamChanged = true;
      }
      for (const task of team.tasks) {
        if (task.state !== "pending" || typeof task.assigneeSessionId !== "string" || !task.assigneeSessionId.startsWith("provisioning:")) continue;
        const placeholder = team.members.find((member) => member.sessionId === task.assigneeSessionId);
        if (placeholder === undefined || placeholder.state !== "failed") continue;
        task.assigneeSessionId = undefined;
        task.updatedAt = now();
        bumpTaskRevision(task);
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
  capacityPolicy() {
    return {
      maxMembers: this.document.settings.maxMembers,
      maxActiveTurns: this.document.settings.maxActiveTurns,
    };
  }
  autopilotPolicy() {
    return {
      enabled: this.document.settings.autopilotEnabled === true,
      maxAdditionalRounds: this.document.settings.autopilotMaxAdditionalRounds,
    };
  }
  hasManagedMember(sessionId) {
    return this.document.teams.some((team) => team.state !== "closed" && memberOf(team, sessionId)?.kind === "worker");
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
    return queueStoreMutation(this.filePath, async () => {
      // A read is also an externally visible state boundary. Refresh here so a
      // Host-managed settings update is observed before callers derive a
      // one-time authorization intent from the current policy.
      await this.#refreshFromDiskIfChanged();
      return clone(reader(this.document));
    });
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
  const events = snapshotSessionEvents(agent.session);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "turn/end") reject("agent-team tools require an open model turn", "AGENT_TEAMS_DRIVER_REQUIRED");
    if (event?.type === "turn/start") return events.slice(index + 1);
  }
  return reject("agent-team tools require an open model turn", "AGENT_TEAMS_DRIVER_REQUIRED");
}
function currentTurnKey(agent) {
  const events = snapshotSessionEvents(agent.session);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
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
  const events = Array.isArray(execution.events) ? execution.events : openTurn(execution.agent);
  return ctx.agents.roots().includes(execution.agent)
    && events.some((event) => event.type === "user/message" && event.data?.source?.kind === "user");
}
function exactDirectHumanAutopilotRootAuthority(ctx, execution) {
  if (!hasDirectHumanRootAuthority(ctx, execution) || typeof ctx.goals?.get !== "function") return undefined;
  const goal = ctx.goals.get(execution.agent);
  if (goal === undefined || goal.phase !== "active" || goal.activation !== "armed"
    || typeof goal.objective !== "string" || goal.objective.length === 0
    || !Number.isSafeInteger(goal.revision) || goal.revision < 1
    || !Number.isSafeInteger(goal.roundsStarted) || goal.roundsStarted < 0
    || !Number.isSafeInteger(goal.maxGoalRounds) || goal.maxGoalRounds < Math.max(1, goal.roundsStarted)) return undefined;
  return Object.freeze({
    rootSessionId: execution.agent.id,
    turnKey: execution.turnKey ?? currentTurnKey(execution.agent),
    projectKey: projectKeyForRoot(execution.agent),
    goalId: goal.id,
    goalRevision: goal.revision,
    goalRound: goal.roundsStarted,
    goalObjectiveHash: agentTeamAutopilotObjectiveHash(goal.objective),
    goalMaxGoalRounds: goal.maxGoalRounds,
  });
}
function exactGoalRoundRootAuthority(ctx, execution) {
  if (!ctx.agents.roots().includes(execution.agent) || typeof ctx.goals?.get !== "function") return undefined;
  const goal = ctx.goals.get(execution.agent);
  if (goal === undefined || goal.phase !== "active" || goal.activation !== "armed"
    || typeof goal.objective !== "string" || goal.objective.length === 0
    || !Number.isSafeInteger(goal.revision) || goal.revision < 1
    || !Number.isSafeInteger(goal.roundsStarted) || goal.roundsStarted < 1
    || !Number.isSafeInteger(goal.maxGoalRounds) || goal.maxGoalRounds < goal.roundsStarted) return undefined;
  const events = Array.isArray(execution.events) ? execution.events : openTurn(execution.agent);
  const admitted = events.some((event) => event.type === "user/message"
    && event.data?.source?.kind === "goal"
    && event.data.source.goalId === goal.id
    && event.data.source.revision === goal.revision
    && event.data.source.round === goal.roundsStarted);
  if (!admitted) return undefined;
  return Object.freeze({
    rootSessionId: execution.agent.id,
    turnKey: execution.turnKey ?? currentTurnKey(execution.agent),
    projectKey: projectKeyForRoot(execution.agent),
    goalId: goal.id,
    goalRevision: goal.revision,
    goalRound: goal.roundsStarted,
    goalObjectiveHash: agentTeamAutopilotObjectiveHash(goal.objective),
    goalMaxGoalRounds: goal.maxGoalRounds,
  });
}
function hasExactGoalRoundRootAuthority(ctx, execution) {
  return exactGoalRoundRootAuthority(ctx, execution) !== undefined;
}
function hasTeamCreationRootAuthority(ctx, execution) {
  return hasDirectHumanRootAuthority(ctx, execution) || hasExactGoalRoundRootAuthority(ctx, execution);
}
function requireTeamCreationRoot(ctx, execution) {
  if (!ctx.agents.roots().includes(execution.agent)) reject("team creation requires a top-level root agent");
  if (!hasTeamCreationRootAuthority(ctx, execution)) {
    reject("team creation requires direct host-attested human input or the exact current admitted goal continuation on the top-level root");
  }
}
function requireDirectHumanRoot(ctx, execution) {
  if (!ctx.agents.roots().includes(execution.agent)) reject("team_start requires a top-level root agent");
  if (!hasDirectHumanRootAuthority(ctx, execution)) {
    reject("team_start requires direct host-attested human input in the current root turn");
  }
}
function routingReceiptMaterial(execution, input) {
  const level = input.level;
  assertEnum(level, ROUTING_LEVELS, "level");
  const explicitUserTeamRequest = input.explicitUserTeamRequest === true;
  const candidateWorkstreams = positiveInteger(input.candidateWorkstreams ?? 0, "candidateWorkstreams", { allowZero: true });
  const creationPath = input.creationPath;
  const reasonCategory = input.reasonCategory;
  assertEnum(reasonCategory, ROUTING_REASON_CATEGORIES, "reasonCategory");
  assertEnum(creationPath, ROUTING_CREATION_PATHS, "creationPath");
  const establishmentAuthority = input.establishmentAuthority ?? "legacy_unknown";
  const goalRoundAuthority = input.goalRoundAuthority;
  if (establishmentAuthority === "goal_round") {
    if (!isRecord(goalRoundAuthority)
      || goalRoundAuthority.rootSessionId !== execution.agent.id
      || goalRoundAuthority.turnKey !== execution.turnKey
      || goalRoundAuthority.projectKey !== projectKeyForRoot(execution.agent)) {
      reject("Goal-round routing requires the exact Host-admitted root, turn, and project fact", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
    }
  } else if (goalRoundAuthority !== undefined) {
    reject("only an exact Goal-round routing decision may carry Goal authority", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
  }
  const material = {
    rootSessionId: execution.agent.id,
    turnKey: execution.turnKey,
    projectKey: projectKeyForRoot(execution.agent),
    level,
    reasonCategory,
    explicitUserTeamRequest,
    candidateWorkstreams,
    creationPath,
    outcome: input.outcome ?? "recorded",
    ...(input.teamId === undefined ? {} : { teamId: nonEmptyString(input.teamId, "teamId", 256) }),
    decisionAuthority: "model_declared",
    establishmentAuthority,
    ...(goalRoundAuthority === undefined ? {} : {
      goalId: goalRoundAuthority.goalId,
      goalRevision: goalRoundAuthority.goalRevision,
      goalRound: goalRoundAuthority.goalRound,
      goalObjectiveHash: goalRoundAuthority.goalObjectiveHash,
      goalMaxGoalRounds: goalRoundAuthority.goalMaxGoalRounds,
    }),
  };
  const validationTime = now();
  validateRoutingReceipt({ id: "pending", ...material, createdAt: validationTime, ...(material.outcome === "recorded" ? {} : { finalizedAt: validationTime }) }, 0);
  return material;
}
function routingDecisionComparable(receipt) {
  const { id, createdAt, finalizedAt, outcome, teamId, ...decision } = receipt;
  return decision;
}
function routingReceiptIsPending(receipt) {
  return receipt.level === "level3" && receipt.outcome === "recorded";
}
function archiveRoutingReceipt(document, receipt) {
  const archive = document.routingReceiptArchive;
  archive.chainHash = createHash("sha256").update(JSON.stringify(["agent-teams-routing-archive-v1", archive.chainHash, receipt])).digest("hex");
  archive.count += 1;
  archive.lastReceiptId = receipt.id;
  archive.lastArchivedAt = now();
}
function finalizeRoutingReceiptForTeam(document, receiptId, team, outcome) {
  assertEnum(outcome, ["created", "reused"], "routing outcome");
  const receipt = document.routingReceipts.find((candidate) => candidate.id === receiptId);
  if (receipt === undefined || receipt.level !== "level3" || receipt.rootSessionId !== team.rootLeadSessionId
    || receipt.projectKey !== team.projectKey) reject("team creation routing receipt is missing or out of scope", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
  if (routingReceiptIsPending(receipt)) {
    receipt.outcome = outcome;
    receipt.teamId = team.id;
    receipt.finalizedAt = now();
    validateRoutingReceipt(receipt, 0);
    return receipt;
  }
  if (!["created", "reused"].includes(receipt.outcome) || receipt.teamId !== team.id) reject("terminal routing receipt is bound to another team", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
  return receipt;
}
async function recordRoutingReceipt(store, execution, input) {
  const material = routingReceiptMaterial(execution, input);
  return store.mutate((document) => {
    assertEnabled(document);
    const existing = document.routingReceipts.find((receipt) => receipt.rootSessionId === material.rootSessionId && receipt.turnKey === material.turnKey);
    if (existing !== undefined) {
      if (JSON.stringify(routingDecisionComparable(existing)) !== JSON.stringify(routingDecisionComparable(material))) reject("current root turn already has a different routing decision", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
      if (routingReceiptIsPending(existing)) {
        if (material.outcome === "recorded") return { receipt: clone(existing), reused: true };
        if (!["created", "reused", "failed"].includes(material.outcome)) reject("pending routing decision has an invalid terminal outcome", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
        existing.outcome = material.outcome;
        existing.teamId = material.teamId;
        existing.finalizedAt = now();
        validateRoutingReceipt(existing, 0);
        return { receipt: clone(existing), reused: false, finalized: true, capabilityBoundary: "routing receipt decisions are model-declared; only root, turn, project, and team scope are Host-derived, and the receipt does not force model routing" };
      }
      if (material.outcome === "recorded" && ["created", "reused"].includes(existing.outcome)) return { receipt: clone(existing), reused: true };
      if (existing.outcome !== material.outcome || existing.teamId !== material.teamId) reject("terminal routing receipt replay must match its exact outcome and team binding", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
      return { receipt: clone(existing), reused: true };
    }
    if (material.outcome !== "recorded") reject("terminal Level 3 routing outcome requires an existing matching recorded decision", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT");
    while (document.routingReceipts.length >= MAX_ROUTING_RECEIPTS) {
      const protectedReceiptIds = new Set(document.teams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status)).map((team) => team.autopilot.routingReceiptId));
      const archiveIndex = document.routingReceipts.findIndex((receipt) => !routingReceiptIsPending(receipt) && !protectedReceiptIds.has(receipt.id));
      if (archiveIndex < 0) reject("routing receipt capacity is occupied by unfinalized Level 3 decisions", "AGENT_TEAMS_ROUTING_RECEIPT_LIMIT");
      const [archived] = document.routingReceipts.splice(archiveIndex, 1);
      archiveRoutingReceipt(document, archived);
    }
    const timestamp = now();
    const receipt = { id: randomUUID(), ...material, createdAt: timestamp, ...(material.outcome === "recorded" ? {} : { finalizedAt: timestamp }) };
    document.routingReceipts.push(receipt);
    return { receipt: clone(receipt), reused: false, capabilityBoundary: "routing receipt decisions are model-declared; only root, turn, project, and team scope are Host-derived, and the receipt does not force model routing" };
  });
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
function queueAgentTeamPrompt(subagents, parent, childId, content, options) {
  if (typeof subagents?.[queueSubagentPrompt] !== "function") {
    return Promise.reject(new HarnessError("continuable subagent prompt queue is unavailable", "AGENT_TEAMS_SUBAGENT_UNAVAILABLE"));
  }
  return queueHostSubagentPrompt(subagents, parent, childId, content, options.source, options.signal);
}
function relaySource(senderSessionId) {
  return {
    kind: "agent-message",
    form: "relay",
    senderSessionId,
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

function memberCanStillProduceTaskProgress(member) {
  return member?.kind === "worker" && ["provisioning", "running"].includes(member.state);
}
function agentTeamAutopilotObjectiveHash(objective) {
  return createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-objective-v1", objective])).digest("hex");
}
function agentTeamAutopilotSettingsHash(settings) {
  return createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-settings-v1", AGENT_TEAM_AUTOPILOT_SETTINGS_KEYS.map((key) => settings?.[key])])).digest("hex");
}
function agentTeamAutopilotSettingsProof(state) {
  const proof = state?.autopilotSettingsProof;
  if (!isRecord(proof) || proof.version !== 1
    || typeof state?.authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(state.authorizationEpoch)
    || proof.authorizationEpoch !== state.authorizationEpoch
    || typeof proof.settingsHash !== "string" || !/^[a-f0-9]{64}$/u.test(proof.settingsHash)
    || typeof proof.enabled !== "boolean" || typeof proof.autopilotEnabled !== "boolean"
    || !Number.isSafeInteger(proof.authorizedAt) || proof.authorizedAt < 0) return undefined;
  return proof;
}
function agentTeamAutopilotSettingsProofMatches(state, settings, { requireLive = false } = {}) {
  const proof = agentTeamAutopilotSettingsProof(state);
  return proof !== undefined && proof.settingsHash === agentTeamAutopilotSettingsHash(settings)
    && proof.enabled === settings?.enabled && proof.autopilotEnabled === settings?.autopilotEnabled
    && (!requireLive || proof.enabled === true && proof.autopilotEnabled === true);
}
function createAgentTeamAutopilotGrant(root, goal, { authorizationEpoch, planHash, pauseEpoch = 0, routingReceiptId, maxAdditionalRounds } = {}) {
  const projectKey = optionalProjectKeyForRoot(root);
  if (projectKey === undefined || goal === undefined || goal.phase !== "active" || goal.activation !== "armed"
    || typeof authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(authorizationEpoch)
    || !Number.isSafeInteger(goal.roundsStarted) || goal.roundsStarted < 0
    || !Number.isSafeInteger(goal.maxGoalRounds) || goal.maxGoalRounds < 1
    || !Number.isSafeInteger(maxAdditionalRounds) || maxAdditionalRounds < 1 || maxAdditionalRounds > AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS
    || typeof routingReceiptId !== "string" || routingReceiptId.length === 0) return undefined;
  const timestamp = now();
  return {
    version: 1,
    status: planHash === undefined ? "pending_plan" : "active",
    authority: "direct_human",
    grantId: randomUUID(),
    routingReceiptId,
    authorizationEpoch,
    rootSessionId: root.id,
    projectKey,
    goalId: goal.id,
    goalObjectiveHash: agentTeamAutopilotObjectiveHash(goal.objective),
    pauseEpochAtGrant: pauseEpoch,
    ...(planHash === undefined ? {} : { planHashAtGrant: planHash }),
    baseMaxGoalRounds: goal.maxGoalRounds,
    expectedMaxGoalRounds: goal.maxGoalRounds,
    maxAdditionalRounds,
    additionalRoundsGranted: 0,
    wakes: [],
    grantedAt: timestamp,
  };
}
async function exactGoalRoundAutopilotGrantIntent(ctx, authorizationProvider, execution, authority = exactGoalRoundRootAuthority(ctx, execution)) {
  if (authority === undefined || typeof authorizationProvider?.readAutopilotAuthorizationState !== "function") return undefined;
  let state;
  try { state = await authorizationProvider.readAutopilotAuthorizationState(); }
  catch { return undefined; }
  const proof = agentTeamAutopilotSettingsProof(state);
  if (proof === undefined || proof.enabled !== true || proof.autopilotEnabled !== true) return undefined;
  return Object.freeze({ ...authority, authorizationEpoch: state.authorizationEpoch, autopilotSettingsHash: proof.settingsHash });
}
async function exactDirectHumanAutopilotGrantIntent(ctx, authorizationProvider, execution, authority = exactDirectHumanAutopilotRootAuthority(ctx, execution)) {
  if (authority === undefined || typeof authorizationProvider?.readAutopilotAuthorizationState !== "function") return undefined;
  let state;
  try { state = await authorizationProvider.readAutopilotAuthorizationState(); }
  catch { return undefined; }
  const proof = agentTeamAutopilotSettingsProof(state);
  if (proof === undefined || proof.enabled !== true || proof.autopilotEnabled !== true) return undefined;
  return Object.freeze({ ...authority, authorizationEpoch: state.authorizationEpoch, autopilotSettingsHash: proof.settingsHash });
}
function exactDirectHumanGrantIntentMatches(document, root, goal, routingReceiptId, intent) {
  if (!isRecord(intent) || typeof intent.authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(intent.authorizationEpoch)
    || typeof intent.autopilotSettingsHash !== "string" || !/^[a-f0-9]{64}$/u.test(intent.autopilotSettingsHash)
    || intent.autopilotSettingsHash !== agentTeamAutopilotSettingsHash(document.settings)
    || intent.rootSessionId !== root.id || intent.projectKey !== optionalProjectKeyForRoot(root)
    || goal === undefined || intent.goalId !== goal.id || intent.goalRevision !== goal.revision
    || intent.goalRound !== goal.roundsStarted || intent.goalObjectiveHash !== agentTeamAutopilotObjectiveHash(goal.objective)
    || intent.goalMaxGoalRounds !== goal.maxGoalRounds) return false;
  const receipt = document.routingReceipts.find((candidate) => candidate.id === routingReceiptId);
  return receipt !== undefined && receipt.level === "level3" && receipt.outcome === "recorded"
    && receipt.establishmentAuthority === "direct_human" && receipt.rootSessionId === intent.rootSessionId
    && receipt.turnKey === intent.turnKey && receipt.projectKey === intent.projectKey;
}
function exactGoalRoundGrantIntentMatches(document, root, goal, routingReceiptId, intent) {
  if (!isRecord(intent) || typeof intent.authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(intent.authorizationEpoch)
    || typeof intent.autopilotSettingsHash !== "string" || !/^[a-f0-9]{64}$/u.test(intent.autopilotSettingsHash)
    || intent.autopilotSettingsHash !== agentTeamAutopilotSettingsHash(document.settings)
    || intent.rootSessionId !== root.id || intent.projectKey !== optionalProjectKeyForRoot(root)
    || goal === undefined || intent.goalId !== goal.id || intent.goalRevision !== goal.revision
    || intent.goalRound !== goal.roundsStarted || intent.goalObjectiveHash !== agentTeamAutopilotObjectiveHash(goal.objective)
    || intent.goalMaxGoalRounds !== goal.maxGoalRounds) return false;
  const receipt = document.routingReceipts.find((candidate) => candidate.id === routingReceiptId);
  return receipt !== undefined && receipt.level === "level3" && receipt.outcome === "recorded"
    && receipt.establishmentAuthority === "goal_round" && receipt.rootSessionId === intent.rootSessionId
    && receipt.turnKey === intent.turnKey && receipt.projectKey === intent.projectKey
    && receipt.goalId === intent.goalId && receipt.goalRevision === intent.goalRevision
    && receipt.goalRound === intent.goalRound && receipt.goalObjectiveHash === intent.goalObjectiveHash
    && receipt.goalMaxGoalRounds === intent.goalMaxGoalRounds;
}
function agentTeamAutopilotGrantForCreation(document, root, goal, { directHumanGrantIntent, goalRoundGrantIntent, planHash, pauseEpoch = 0, routingReceiptId, excludeTeamId } = {}) {
  if (document.settings.autopilotEnabled !== true) return undefined;
  const configuredBudget = document.settings.autopilotMaxAdditionalRounds;
  if (!Number.isSafeInteger(configuredBudget) || configuredBudget < 1 || configuredBudget > AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS) return undefined;
  const openTeams = document.teams.filter((team) => team.rootLeadSessionId === root.id && team.state !== "closed" && team.id !== excludeTeamId);
  const liveGrantTeams = openTeams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
  if (openTeams.length > 0) {
    // An automatically created sibling may inherit only a complete, exact Host
    // grant group. A missing/revoked sibling means the root has no authority to
    // resume a turn that could act across all of its open teams.
    if (liveGrantTeams.length !== openTeams.length || goal === undefined) return undefined;
    const templateTeam = liveGrantTeams[0];
    const template = templateTeam.autopilot;
    const invalid = liveGrantTeams.some((team) => agentTeamAutopilotInvalidReason(team, root, goal, document.settings) !== undefined);
    const inconsistent = liveGrantTeams.some((team) => team.autopilot.authorizationEpoch !== template.authorizationEpoch
      || team.autopilot.goalId !== template.goalId
      || team.autopilot.goalObjectiveHash !== template.goalObjectiveHash
      || team.autopilot.baseMaxGoalRounds !== template.baseMaxGoalRounds
      || team.autopilot.expectedMaxGoalRounds !== template.expectedMaxGoalRounds
      || team.autopilot.maxAdditionalRounds !== template.maxAdditionalRounds
      || team.autopilot.additionalRoundsGranted !== template.additionalRoundsGranted);
    if (invalid || inconsistent || template.maxAdditionalRounds > configuredBudget) return undefined;
    const inherited = clone(template);
    inherited.grantId = randomUUID();
    inherited.status = planHash === undefined ? "pending_plan" : "active";
    inherited.pauseEpochAtGrant = pauseEpoch;
    inherited.grantedAt = now();
    inherited.revokedAt = undefined;
    inherited.revokeReason = undefined;
    inherited.parkedGoalRevision = undefined;
    inherited.parkedAt = undefined;
    if (planHash === undefined) inherited.planHashAtGrant = undefined;
    else inherited.planHashAtGrant = planHash;
    return inherited;
  }
  // A preference alone cannot mint Goal authority. For the first open team the
  // core also requires either the exact direct-human root turn or the exact
  // Host-admitted Goal round, plus the current unguessable Desktop settings
  // epoch. None of these facts is exposed as a model/tool argument.
  const grantIntent = exactDirectHumanGrantIntentMatches(document, root, goal, routingReceiptId, directHumanGrantIntent)
    ? directHumanGrantIntent
    : exactGoalRoundGrantIntentMatches(document, root, goal, routingReceiptId, goalRoundGrantIntent) ? goalRoundGrantIntent : undefined;
  if (grantIntent === undefined) return undefined;
  return createAgentTeamAutopilotGrant(root, goal, {
    authorizationEpoch: grantIntent.authorizationEpoch,
    planHash,
    pauseEpoch,
    routingReceiptId,
    maxAdditionalRounds: configuredBudget,
  });
}
function bindAgentTeamAutopilotPlan(team, goal) {
  const autopilot = team.autopilot;
  if (autopilot?.status !== "pending_plan" || goal === undefined || goal.phase !== "active" || goal.activation !== "armed"
    || autopilot.rootSessionId !== team.rootLeadSessionId || autopilot.projectKey !== team.projectKey
    || autopilot.goalId !== goal.id || autopilot.goalObjectiveHash !== agentTeamAutopilotObjectiveHash(goal.objective)
    || autopilot.expectedMaxGoalRounds !== goal.maxGoalRounds || autopilot.pauseEpochAtGrant !== (team.pauseEpoch ?? 0)
    || !teamHasEstablishedWorker(team) || !planAuthorizationSupportsAutopilot(team)
    || !planCapabilitiesAreVerified(team) || !planFilesAreConflictFree(team) || !planEffectsAreOrdinary(team)
    || team.closure !== undefined || team.handoff !== undefined || effectiveTeamState(team) !== "active"
    || (team.memberRecoveries ?? []).some((receipt) => receipt.status === "outcome_unknown" || receipt.status === "prepared")) return false;
  autopilot.status = "active";
  autopilot.planHashAtGrant = team.plan.hash;
  return true;
}
function revokeAgentTeamAutopilot(team, reason, status = "revoked") {
  const autopilot = team.autopilot;
  if (autopilot === undefined || ["revoked", "exhausted"].includes(autopilot.status)) return false;
  const timestamp = now();
  autopilot.status = status;
  autopilot.revokedAt = timestamp;
  autopilot.revokeReason = reason;
  autopilot.parkedGoalRevision = undefined;
  autopilot.parkedAt = undefined;
  for (const wake of autopilot.wakes) if (!["delivered", "cancelled"].includes(wake.status)) {
    wake.status = "cancelled";
    wake.cancelledAt = timestamp;
    wake.reason = reason;
  }
  team.updatedAt = timestamp;
  return true;
}
function liveAgentTeamAutopilotTeams(document, rootSessionId) {
  return document.teams.filter((team) => team.rootLeadSessionId === rootSessionId && ["pending_plan", "active"].includes(team.autopilot?.status));
}
function liveAgentTeamAutopilotGoalIds(document, rootSessionId) {
  return new Set(liveAgentTeamAutopilotTeams(document, rootSessionId).map((team) => team.autopilot.goalId));
}
function disarmBoundAgentTeamGoal(ctx, root, document, boundGoalIds = liveAgentTeamAutopilotGoalIds(document, root?.id)) {
  if (root === undefined || ctx.agents?.get?.(root.id) !== root || !ctx.agents?.roots?.().includes(root)
    || typeof ctx.goals?.get !== "function" || typeof ctx.goals?.disarm !== "function") return false;
  const goal = ctx.goals.get(root);
  if (goal === undefined || goal.phase !== "active" || goal.activation !== "armed"
    || !(boundGoalIds instanceof Set) || !boundGoalIds.has(goal.id)) return false;
  ctx.goals.disarm(root);
  const current = ctx.goals.get(root);
  if (current?.id === goal.id && current.phase === "active" && current.activation === "armed") {
    reject("bound Goal remained armed while automatic-continuation authority was being revoked", "AGENT_TEAMS_GOAL_DEACTIVATION_FAILED");
  }
  return true;
}
async function revokeDesktopAgentTeamAutopilot(ctx, authorizationProvider, document, rootSessionId, reason) {
  if (typeof authorizationProvider?.revokeAutopilotAuthorizations !== "function") return false;
  const epochs = rootSessionId === undefined ? new Set() : new Set(liveAgentTeamAutopilotTeams(document, rootSessionId).map((team) => team.autopilot.authorizationEpoch).filter(Boolean));
  if (epochs.size > 1) return false;
  let authorizationEpoch = epochs.size === 1 ? [...epochs][0] : undefined;
  try {
    if (authorizationEpoch === undefined) {
      if (typeof authorizationProvider.readAutopilotAuthorizationState !== "function") return false;
      const current = await authorizationProvider.readAutopilotAuthorizationState();
      if (typeof current?.authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(current.authorizationEpoch)) return false;
      authorizationEpoch = current.authorizationEpoch;
    }
    const state = await authorizationProvider.revokeAutopilotAuthorizations({ authorizationEpoch, reason: String(reason).slice(0, 256) });
    return typeof state?.authorizationEpoch === "string" && state.authorizationEpoch !== authorizationEpoch;
  } catch (error) {
    ctx.logger?.warn?.(`Agent Teams could not rotate the Desktop Host autopilot authorization epoch: ${error?.code ?? error?.message ?? "unknown error"}`);
    return false;
  }
}
async function revokeRootAgentTeamAutopilot(ctx, store, root, reason, status = "revoked", authorizationProvider) {
  const rootSessionId = nonEmptyString(root?.id, "rootSessionId", 256);
  const before = store.snapshot();
  const boundGoalIds = liveAgentTeamAutopilotGoalIds(before, rootSessionId);
  disarmBoundAgentTeamGoal(ctx, root, before, boundGoalIds);
  await revokeDesktopAgentTeamAutopilot(ctx, authorizationProvider, before, rootSessionId, reason);
  let changed = await store.mutate((document) => {
    let changed = false;
    for (const team of document.teams) if (team.rootLeadSessionId === rootSessionId) {
      changed = revokeAgentTeamAutopilot(team, reason, status) || changed;
    }
    return changed;
  });
  // Recheck both boundaries after the durable write. A racing Goal resume or
  // grant attach cannot survive the two-step external/durable revocation edge.
  // Disarming first makes every crash prefix fail closed: no persisted grant is
  // ever removed while its exact process-local Goal remains armed.
  disarmBoundAgentTeamGoal(ctx, root, store.snapshot(), boundGoalIds);
  if (liveAgentTeamAutopilotTeams(store.snapshot(), rootSessionId).length > 0) {
    changed = await store.mutate((document) => {
      let repeated = false;
      for (const team of document.teams) if (team.rootLeadSessionId === rootSessionId) repeated = revokeAgentTeamAutopilot(team, reason, status) || repeated;
      return repeated;
    }) || changed;
    disarmBoundAgentTeamGoal(ctx, root, store.snapshot(), boundGoalIds);
  }
  const finalDocument = store.snapshot();
  const finalGoal = typeof ctx.goals?.get === "function" ? ctx.goals.get(root) : undefined;
  if (liveAgentTeamAutopilotTeams(finalDocument, rootSessionId).length > 0
    || finalGoal?.phase === "active" && finalGoal.activation === "armed" && boundGoalIds.has(finalGoal.id)) {
    reject("automatic-continuation authority could not be revoked atomically", "AGENT_TEAMS_GOAL_DEACTIVATION_FAILED");
  }
  return changed;
}
function planAuthorizationSupportsAutopilot(team) {
  const plan = team.plan;
  const authorization = plan?.authorization;
  return plan?.phase === "active" && plan.migrationState === "ready"
    && plan.hash === teamPlanHash(team) && authorization?.confirmedPlanHash === plan.hash
    && authorization.source !== "unknown"
    && ["permissions", "files", "cost", "externalSideEffects"].every((field) => authorization[field] !== "unknown");
}
function teamHasSafeAutopilotAuthority(team, root) {
  if (effectiveTeamState(team) !== "active" || team.rootLeadSessionId !== root.id) return false;
  const projectKey = optionalProjectKeyForRoot(root);
  if (projectKey === undefined || team.projectKey !== projectKey) return false;
  return team.closure === undefined && team.handoff === undefined && teamHasEstablishedWorker(team)
    && planAuthorizationSupportsAutopilot(team) && planCapabilitiesAreVerified(team)
    && planFilesAreConflictFree(team) && planEffectsAreOrdinary(team)
    && !(team.memberRecoveries ?? []).some((receipt) => receipt.status === "outcome_unknown" || receipt.status === "prepared");
}
function rootHasSafeAutopilotAuthority(document, root) {
  const owned = document.teams.filter((team) => team.rootLeadSessionId === root.id && effectiveTeamState(team) === "active");
  return owned.length > 0 && owned.every((team) => teamHasSafeAutopilotAuthority(team, root));
}
function rootCanAutonomouslyWait(document, root) {
  const owned = document.teams.filter((team) => team.rootLeadSessionId === root.id && effectiveTeamState(team) === "active");
  if (owned.length === 0 || !owned.every((team) => teamHasSafeAutopilotAuthority(team, root))) return false;
  const teamsById = new Map(document.teams.map((team) => [team.id, team]));
  const ownedById = new Map(owned.map((team) => [team.id, team]));
  let hasLiveProducer = false;
  const settled = new Map();
  const resolvesToLiveProducer = (team, task, visiting = new Set()) => {
    const key = taskNodeKey(team.id, task.id);
    if (settled.has(key)) return settled.get(key);
    if (visiting.has(key) || task.state === "submitted" || task.state === "cancelled") return false;
    if (taskSatisfiesDependency(task)) return true;
    if (!ownedById.has(team.id) || !teamHasSafeAutopilotAuthority(team, root)) return false;
    const assignee = task.assigneeSessionId === undefined ? undefined : memberOf(team, task.assigneeSessionId);
    if (task.state === "in_progress") {
      const live = memberCanStillProduceTaskProgress(assignee);
      if (live) hasLiveProducer = true;
      settled.set(key, live);
      return live;
    }
    if (task.state !== "pending") return false;
    const dependencies = [
      ...(task.dependsOn ?? []).map((taskId) => ({ teamId: team.id, taskId })),
      ...(task.crossTeamDependsOn ?? []),
    ];
    const unresolved = dependencies.filter((dependency) => {
      const source = teamsById.get(dependency.teamId);
      const blocker = source?.tasks.find((candidate) => candidate.id === dependency.taskId);
      return !taskSatisfiesDependency(blocker);
    });
    if (unresolved.length === 0) {
      const live = memberCanStillProduceTaskProgress(assignee);
      if (live) hasLiveProducer = true;
      settled.set(key, live);
      return live;
    }
    const nextVisiting = new Set(visiting).add(key);
    const resolved = unresolved.every((dependency) => {
      const source = ownedById.get(dependency.teamId);
      const blocker = source?.tasks.find((candidate) => candidate.id === dependency.taskId);
      return source !== undefined && blocker !== undefined && resolvesToLiveProducer(source, blocker, nextVisiting);
    });
    settled.set(key, resolved);
    return resolved;
  };
  const unfinished = owned.flatMap((team) => team.tasks.filter((task) => !taskIsTerminal(task)).map((task) => ({ team, task })));
  return unfinished.length > 0 && unfinished.every(({ team, task }) => resolvesToLiveProducer(team, task)) && hasLiveProducer;
}
function taskDependenciesAreSatisfied(document, team, task) {
  const local = new Map(team.tasks.map((candidate) => [candidate.id, candidate]));
  const byTeam = new Map(document.teams.map((candidate) => [candidate.id, candidate]));
  return (task.dependsOn ?? []).every((taskId) => taskSatisfiesDependency(local.get(taskId)))
    && (task.crossTeamDependsOn ?? []).every((dependency) => taskSatisfiesDependency(byTeam.get(dependency.teamId)?.tasks.find((candidate) => candidate.id === dependency.taskId)));
}
function rootAgentTeamAutopilotAction(document, root) {
  const teams = document.teams.filter((team) => team.rootLeadSessionId === root.id && effectiveTeamState(team) === "active").sort((left, right) => left.id.localeCompare(right.id));
  if (teams.length === 0) return undefined;
  if (rootCanAutonomouslyWait(document, root)) return { kind: "waiting", teams };
  let kind;
  if (teams.some((team) => team.tasks.some((task) => task.state === "submitted"))) kind = "review_submission";
  else if (teams.every((team) => team.tasks.length > 0 && team.tasks.every(taskIsTerminal))) kind = "close_team";
  else if (teams.some((team) => team.members.some((member) => member.kind === "worker" && ["idle", "ready", "failed"].includes(member.state)
    && team.tasks.some((task) => task.assigneeSessionId === member.sessionId && !taskIsTerminal(task))))) kind = "member_attention";
  else if (teams.some((team) => team.tasks.some((task) => task.state === "pending" && taskDependenciesAreSatisfied(document, team, task)
    && (task.assigneeSessionId === undefined || !memberCanStillProduceTaskProgress(memberOf(team, task.assigneeSessionId)))))) kind = "dispatch_work";
  else if (teams.some((team) => team.tasks.some((task) => !taskIsTerminal(task)))) kind = "reconcile_work";
  else return undefined;
  const material = teams.map((team) => ({
    id: team.id,
    pauseEpoch: team.pauseEpoch ?? 0,
    planHash: team.plan?.hash,
    // Revisions and checkpoints are audit/progress metadata, not a new action.
    // Hash only facts that can change what the root must do so a no-op turn or
    // duplicate projection cannot consume another bounded Goal round.
    tasks: team.tasks.map((task) => ({
      id: task.id,
      state: task.state,
      assigneeSessionId: task.assigneeSessionId,
      claimId: task.claimId,
      leaseEpoch: task.leaseEpoch,
      dependencies: [...deriveTaskAcrossTeams(task, team, document.teams).dependencies].sort(),
      blockedBy: [...deriveTaskAcrossTeams(task, team, document.teams).blockedBy].sort(),
    })),
    members: team.members.filter((member) => member.kind === "worker").map((member) => ({ id: member.id, sessionId: member.sessionId, state: member.state, runId: member.runId })),
  }));
  const stateHash = createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-state-v2", kind, material])).digest("hex");
  return { kind, stateHash, teams };
}
function pendingAgentTeamAutopilotWake(autopilot) {
  return [...(autopilot?.wakes ?? [])].reverse().find((wake) => ["prepared", "goal_mutated"].includes(wake.status));
}
function agentTeamAutopilotWakeComparable(wake) {
  if (wake === undefined) return undefined;
  const comparable = clone(wake);
  // This is diagnostic provenance for the local team record, not part of the
  // root-wide wake identity replicated across every grant.
  comparable.teamRevision = 0;
  return comparable;
}
function agentTeamAutopilotWakeGroup(grants, wakeKey) {
  const copies = grants.map((team) => team.autopilot.wakes.find((wake) => wake.key === wakeKey));
  if (copies.every((wake) => wake === undefined)) return { wake: undefined };
  if (copies.some((wake) => wake === undefined)) return { error: "automatic wake ledger is incomplete across the root team group" };
  const canonical = JSON.stringify(agentTeamAutopilotWakeComparable(copies[0]));
  if (copies.some((wake) => JSON.stringify(agentTeamAutopilotWakeComparable(wake)) !== canonical)) return { error: "automatic wake ledger diverged across the root team group" };
  return { wake: clone(copies[0]) };
}
function agentTeamAutopilotInvalidReason(team, root, goal, settings) {
  const autopilot = team.autopilot;
  if (autopilot === undefined || !["pending_plan", "active"].includes(autopilot.status)) return undefined;
  if (settings?.autopilotEnabled !== true) return "trusted Host autopilot setting is disabled";
  if (typeof autopilot.authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(autopilot.authorizationEpoch)) return "trusted Host autopilot authorization epoch is missing";
  if (!Number.isSafeInteger(settings.autopilotMaxAdditionalRounds) || autopilot.maxAdditionalRounds > settings.autopilotMaxAdditionalRounds) return "trusted Host autopilot budget was reduced";
  if (effectiveTeamState(team) !== "active") return "team is no longer active";
  if (autopilot.rootSessionId !== root.id || team.rootLeadSessionId !== root.id) return "fixed root identity changed";
  const projectKey = optionalProjectKeyForRoot(root);
  if (projectKey === undefined || team.projectKey !== projectKey || autopilot.projectKey !== projectKey) return "canonical project scope changed";
  if (autopilot.pauseEpochAtGrant !== (team.pauseEpoch ?? 0)) return "Stop or resume advanced the pause epoch";
  if (goal === undefined || goal.id !== autopilot.goalId) return "bound goal changed or was cleared";
  if (agentTeamAutopilotObjectiveHash(goal.objective) !== autopilot.goalObjectiveHash) return "bound goal objective changed";
  if (["paused", "complete"].includes(goal.phase) || goal.phase === "blocked" && goal.blockedReason?.code !== "round-limit") return `goal entered ${goal.phase}`;
  const pending = pendingAgentTeamAutopilotWake(autopilot);
  const previousExpectedCap = pending?.targetMaxGoalRounds === autopilot.expectedMaxGoalRounds ? autopilot.expectedMaxGoalRounds - AGENT_TEAM_AUTOPILOT_ROUND_GRANT : undefined;
  if (goal.maxGoalRounds !== autopilot.expectedMaxGoalRounds && goal.maxGoalRounds !== previousExpectedCap) return "goal round cap changed outside the bounded autopilot grant";
  if (autopilot.status === "active") {
    if (autopilot.planHashAtGrant !== team.plan?.hash || !teamHasSafeAutopilotAuthority(team, root)) return "team plan or safety facts changed";
    const deliveredThisRevision = [...autopilot.wakes].reverse().some((wake) => wake.status === "delivered" && wake.goalRevision === goal.revision);
    if (goal.phase === "active" && goal.activation !== "armed" && pending === undefined
      && autopilot.parkedGoalRevision !== goal.revision && !deliveredThisRevision) return "goal continuation was disarmed outside an autopilot wait";
  }
  return undefined;
}
function agentTeamAutopilotWakeRoots(previous, current) {
  const wake = new Set();
  const priorById = new Map((previous?.teams ?? []).map((team) => [team.id, team]));
  const dependencySignature = (document, team, task) => {
    const derived = deriveTaskAcrossTeams(task, team, document.teams);
    return JSON.stringify([
      [...derived.dependencies].sort(),
      [...derived.blockedBy].sort(),
      [...derived.failedBy].sort(),
    ]);
  };
  for (const team of current.teams) {
    if (effectiveTeamState(team) !== "active") continue;
    const before = priorById.get(team.id);
    if (before !== undefined && before.rootLeadSessionId !== team.rootLeadSessionId) continue;
    const beforeTasks = new Map((before?.tasks ?? []).map((task) => [task.id, task]));
    const beforeMembers = new Map((before?.members ?? []).map((member) => [member.id, member]));
    const submitted = team.tasks.some((task) => {
      if (task.state !== "submitted" || task.submission?.submittedBy === team.rootLeadSessionId) return false;
      const prior = beforeTasks.get(task.id);
      return prior?.state !== "submitted" || prior.submission?.claimId !== task.submission?.claimId
        || prior.submission?.leaseEpoch !== task.submission?.leaseEpoch || prior.submission?.submittedAt !== task.submission?.submittedAt;
    });
    const failed = team.members.some((member) => member.kind === "worker" && member.state === "failed" && beforeMembers.get(member.id)?.state !== "failed");
    const dependencyChanged = previous !== undefined && team.tasks.some((task) => {
      const prior = beforeTasks.get(task.id);
      if (prior === undefined) return task.dependsOn.length > 0 || (task.crossTeamDependsOn ?? []).length > 0;
      return dependencySignature(previous, before, prior) !== dependencySignature(current, team, task);
    });
    if (submitted || failed || dependencyChanged) wake.add(team.rootLeadSessionId);
  }
  return [...wake];
}
function createAgentTeamAutopilot(ctx, store, ready = Promise.resolve(store.snapshot()), authorizationProvider, options = {}) {
  let closed = false;
  let requested = false;
  let run;
  let request = () => {};
  const retryBaseMs = options.retryBaseMs ?? AGENT_TEAM_AUTOPILOT_RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? AGENT_TEAM_AUTOPILOT_RETRY_MAX_MS;
  const maxRetries = options.maxRetries ?? AGENT_TEAM_AUTOPILOT_MAX_RETRIES;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1 || !Number.isSafeInteger(retryMaxMs) || retryMaxMs < retryBaseMs
    || !Number.isSafeInteger(maxRetries) || maxRetries < 1 || typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new TypeError("agent-team autopilot retry options are invalid");
  }
  const retryStates = new Map();
  let observedDocument = store.snapshot();
  let wakeEvidenceSequence = 0;
  const wakeEvidenceByRoot = new Map();
  const rootIsLive = (root) => root !== undefined && ctx.agents.get(root.id) === root && ctx.agents.roots().includes(root);
  const activeGrantTeams = (document, root) => document.teams.filter((team) => team.rootLeadSessionId === root.id && team.state !== "closed" && team.autopilot?.status === "active");
  const revokeRoot = async (root, reason, status = "revoked") => {
    if (!rootIsLive(root)) return;
    return revokeRootAgentTeamAutopilot(ctx, store, root, reason, status, authorizationProvider);
  };
  const sameAutopilotAction = (current, expected) => current?.kind === expected?.kind
    && (current?.kind === "waiting"
      ? JSON.stringify(current.teams.map((team) => team.id).sort()) === JSON.stringify(expected.teams.map((team) => team.id).sort())
      : current?.stateHash === expected?.stateHash);
  const parkRootGoal = async (root, goal, { resetActionState = false, action } = {}) => {
    if (!rootIsLive(root) || root.status !== "idle" || goal === undefined || action === undefined) return false;
    const beforeDocument = store.snapshot();
    const beforeAction = rootAgentTeamAutopilotAction(beforeDocument, root);
    const current = ctx.goals.get(root);
    if (!sameAutopilotAction(beforeAction, action) || current?.id !== goal.id || current.revision !== goal.revision
      || current.phase !== "active" || !["armed", "disarmed"].includes(current.activation)) return false;
    // Goal activation is process-local and can be consumed by the official driver.
    // Remove that authority synchronously, before the first await or durable parked
    // marker, so every crash prefix is disarmed rather than marker-only.
    if (current.activation === "armed") ctx.goals.disarm(root);
    const parkedGoal = ctx.goals.get(root);
    const exactPark = rootIsLive(root) && root.status === "idle" && parkedGoal?.id === current.id
      && parkedGoal.phase === "active" && parkedGoal.activation === "disarmed"
      && parkedGoal.roundsStarted === current.roundsStarted && parkedGoal.maxGoalRounds === current.maxGoalRounds
      && agentTeamAutopilotObjectiveHash(parkedGoal.objective) === agentTeamAutopilotObjectiveHash(current.objective);
    if (!exactPark) {
      await revokeRoot(root, "root changed while automatic continuation was being parked");
      return false;
    }
    let persisted;
    try {
      persisted = await store.mutate((draft) => {
        const mutationGoal = ctx.goals.get(root);
        const mutationAction = rootAgentTeamAutopilotAction(draft, root);
        const grants = activeGrantTeams(draft, root);
        if (!rootIsLive(root) || root.status !== "idle" || mutationGoal?.id !== parkedGoal.id
          || mutationGoal.phase !== "active" || mutationGoal.activation !== "disarmed"
          || mutationGoal.roundsStarted !== parkedGoal.roundsStarted || mutationGoal.maxGoalRounds !== parkedGoal.maxGoalRounds
          || !sameAutopilotAction(mutationAction, action) || grants.length === 0) return false;
        const timestamp = now();
        for (const team of grants) {
          team.autopilot.parkedGoalRevision = mutationGoal.revision;
          team.autopilot.parkedAt = timestamp;
          if (resetActionState) team.autopilot.lastStateHash = undefined;
          team.updatedAt = timestamp;
        }
        return true;
      });
    } catch (error) {
      await revokeRoot(root, `automatic continuation parked-state persistence failed: ${error?.code ?? error?.message ?? "unknown error"}`);
      return false;
    }
    const finalGoal = ctx.goals.get(root);
    const finalAction = rootAgentTeamAutopilotAction(store.snapshot(), root);
    if (persisted !== true || !rootIsLive(root) || root.status !== "idle" || finalGoal?.id !== parkedGoal.id
      || finalGoal.phase !== "active" || finalGoal.activation !== "disarmed"
      || finalGoal.roundsStarted !== parkedGoal.roundsStarted || !sameAutopilotAction(finalAction, action)) {
      await revokeRoot(root, "automatic continuation park boundary changed before durable confirmation");
      return false;
    }
    return true;
  };
  const reconcileRoot = async (root) => {
    if (!rootIsLive(root)) return;
    let document = store.snapshot();
    let goal = ctx.goals.get(root);
    const candidates = document.teams.filter((team) => team.rootLeadSessionId === root.id && ["pending_plan", "active"].includes(team.autopilot?.status));
    // The running root may be applying one exact admitted Goal-round plan CAS.
    // No scheduler effect is possible until it becomes idle; validate/revoke at
    // that boundary so a safe draft→commit transaction can rebind its grant
    // instead of being torn down between the two model tool calls.
    if (root.status !== "idle") return;
    if (candidates.length > 0) {
      let hostState;
      try {
        if (typeof authorizationProvider?.readAutopilotAuthorizationState !== "function") throw new Error("Desktop Host authorization capability is unavailable");
        hostState = await authorizationProvider.readAutopilotAuthorizationState();
      } catch {
        await revokeRoot(root, "trusted Host autopilot authorization state is unavailable");
        return;
      }
      if (!agentTeamAutopilotSettingsProofMatches(hostState, document.settings, { requireLive: true })) {
        await revokeRoot(root, "trusted Host autopilot settings proof changed");
        return;
      }
      if (candidates.some((team) => team.autopilot.authorizationEpoch !== hostState.authorizationEpoch)) {
        await revokeRoot(root, "trusted Host autopilot authorization epoch changed");
        return;
      }
    }
    const invalid = candidates.map((team) => [team.id, agentTeamAutopilotInvalidReason(team, root, goal, document.settings)]).filter(([, reason]) => reason !== undefined);
    if (invalid.length > 0) {
      const reason = `root automatic-continuation grant group became invalid: ${invalid.map(([teamId, value]) => `${teamId}: ${value}`).join("; ")}`;
      await revokeRoot(root, reason);
      return;
    }
    const ownedOpen = document.teams.filter((team) => team.rootLeadSessionId === root.id && team.state !== "closed");
    const liveScope = ownedOpen.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
    if (liveScope.length !== ownedOpen.length) {
      if (liveScope.length > 0) await revokeRoot(root, "automatic continuation scope contains an open team without the same live grant boundary");
      return;
    }
    // A newly established draft/bootstrap team is part of the exact root scope,
    // but cannot resume the goal until its first real worker publication binds the
    // plan-specific capability. Existing siblings stay parked in the meantime.
    if (liveScope.some((team) => team.autopilot.status === "pending_plan")) return;
    const grants = activeGrantTeams(document, root);
    if (ownedOpen.length === 0 || grants.length !== ownedOpen.length || goal === undefined) return;
    if (new Set(grants.map((team) => team.autopilot.authorizationEpoch)).size !== 1
      || new Set(grants.map((team) => team.autopilot.goalId)).size !== 1
      || new Set(grants.map((team) => team.autopilot.baseMaxGoalRounds)).size !== 1
      || new Set(grants.map((team) => team.autopilot.expectedMaxGoalRounds)).size !== 1
      || new Set(grants.map((team) => team.autopilot.maxAdditionalRounds)).size !== 1
      || new Set(grants.map((team) => team.autopilot.additionalRoundsGranted)).size !== 1
      || new Set(grants.map((team) => team.autopilot.lastStateHash)).size !== 1) {
      await revokeRoot(root, "automatic continuation grant group diverged");
      return;
    }
    const action = rootAgentTeamAutopilotAction(document, root);
    const wakeEvidence = wakeEvidenceByRoot.get(root.id);
    if (action?.kind === "waiting") {
      // Ordinary producer-owned waiting is parked rather than treated as a
      // blocker or a reason to spend another Goal round.
      await parkRootGoal(root, goal, { resetActionState: true, action });
      if (wakeEvidenceByRoot.get(root.id) === wakeEvidence) wakeEvidenceByRoot.delete(root.id);
      return;
    }
    if (action === undefined) {
      if (wakeEvidenceByRoot.get(root.id) === wakeEvidence) wakeEvidenceByRoot.delete(root.id);
      return;
    }
    const pendingKeys = grants.map((team) => team.autopilot.wakes.filter((wake) => ["prepared", "goal_mutated"].includes(wake.status)).map((wake) => wake.key));
    if (pendingKeys.some((keys) => keys.length > 1) || new Set(pendingKeys.map((keys) => keys[0] ?? "")).size !== 1) {
      await revokeRoot(root, "automatic wake ledger has multiple or divergent pending entries");
      return;
    }
    const deliveredRoundObserved = grants.every((team) => team.autopilot.wakes.some((wake) => wake.status === "delivered"
      && wake.stateHash === action.stateHash && wake.roundsStarted < goal.roundsStarted));
    if (pendingKeys.every((keys) => keys.length === 0) && deliveredRoundObserved
      && grants.every((team) => team.autopilot.additionalRoundsGranted >= team.autopilot.maxAdditionalRounds)) {
      await revokeRoot(root, "bounded automatic goal-round budget exhausted", "exhausted");
      return;
    }
    if (pendingKeys.every((keys) => keys.length === 0) && deliveredRoundObserved
      && grants.every((team) => team.autopilot.lastStateHash === action.stateHash)) {
      // The previous wake already granted one root turn for this exact durable
      // action. Park only after that turn is observable in roundsStarted; the
      // delivery mutation itself must not disarm the just-resumed Goal.
      await parkRootGoal(root, goal, { action });
      return;
    }
    const newWakeKey = createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-wake-v1", root.id, goal.id, action.kind, action.stateHash, goal.roundsStarted])).digest("hex");
    const wakeKey = pendingKeys[0][0] ?? newWakeKey;
    let groupedWake = agentTeamAutopilotWakeGroup(grants, wakeKey);
    if (groupedWake.error !== undefined) {
      await revokeRoot(root, groupedWake.error);
      return;
    }
    let wake = groupedWake.wake;
    if (wake === undefined && pendingKeys.every((keys) => keys.length === 0) && wakeEvidence === undefined) {
      // Attention already present in a projection is not a scheduler event.
      // Only a new submission, member failure, or dependency transition may
      // allocate a fresh wake; persisted pending ledgers recover above.
      await parkRootGoal(root, goal, { action });
      return;
    }
    if (wake === undefined) {
      const prepared = await store.mutate((draft) => {
        const currentGoal = ctx.goals.get(root);
        const currentAction = rootAgentTeamAutopilotAction(draft, root);
        const currentOwnedOpen = draft.teams.filter((team) => team.rootLeadSessionId === root.id && team.state !== "closed");
        const currentGrants = activeGrantTeams(draft, root).sort((left, right) => left.id.localeCompare(right.id));
        if (currentGoal === undefined || currentAction?.stateHash !== action.stateHash || currentAction.kind !== action.kind
          || currentGrants.length !== currentOwnedOpen.length || currentGrants.length !== grants.length
          || currentGrants.some((team) => agentTeamAutopilotInvalidReason(team, root, currentGoal, draft.settings) !== undefined)) return undefined;
        const currentGroup = agentTeamAutopilotWakeGroup(currentGrants, wakeKey);
        if (currentGroup.error !== undefined) return { autopilotTerminal: { reason: currentGroup.error, status: "revoked" } };
        if (currentGroup.wake !== undefined) return currentGroup.wake;
        const extend = currentGoal.roundsStarted >= currentGoal.maxGoalRounds;
        if (extend && currentGrants.some((team) => team.autopilot.additionalRoundsGranted >= team.autopilot.maxAdditionalRounds)) {
          return { autopilotTerminal: { reason: "bounded automatic goal-round budget exhausted", status: "exhausted" } };
        }
        const targetMaxGoalRounds = currentGoal.maxGoalRounds + (extend ? AGENT_TEAM_AUTOPILOT_ROUND_GRANT : 0);
        if (extend) for (const team of currentGrants) {
          team.autopilot.additionalRoundsGranted += AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
          team.autopilot.expectedMaxGoalRounds += AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
        }
        for (const team of currentGrants) {
          while (team.autopilot.wakes.length >= MAX_AGENT_TEAM_AUTOPILOT_WAKES) {
            const terminalIndex = team.autopilot.wakes.findIndex((candidate) => ["delivered", "cancelled"].includes(candidate.status));
            if (terminalIndex < 0) {
              return { autopilotTerminal: { reason: "automatic wake receipt capacity exhausted", status: "exhausted" } };
            }
            team.autopilot.wakes.splice(terminalIndex, 1);
          }
        }
        const timestamp = now();
        for (const team of currentGrants) {
          team.autopilot.wakes.push({ key: wakeKey, kind: action.kind, stateHash: action.stateHash, roundsStarted: currentGoal.roundsStarted, status: "prepared", teamRevision: team.revision ?? 1, targetMaxGoalRounds, createdAt: timestamp });
          team.autopilot.lastStateHash = action.stateHash;
          team.autopilot.parkedGoalRevision = undefined;
          team.autopilot.parkedAt = undefined;
          team.updatedAt = timestamp;
        }
        return clone(currentGrants[0].autopilot.wakes.at(-1));
      });
      if (prepared?.autopilotTerminal !== undefined) {
        await revokeRoot(root, prepared.autopilotTerminal.reason, prepared.autopilotTerminal.status);
        return;
      }
      if (prepared === undefined) return;
      wake = prepared;
    }
    if (["delivered", "cancelled"].includes(wake.status)) return;
    const deliveryState = async () => store.read((currentDocument) => {
      const currentGoal = ctx.goals.get(root);
      const currentOwnedOpen = currentDocument.teams.filter((team) => team.rootLeadSessionId === root.id && team.state !== "closed");
      const currentGrants = activeGrantTeams(currentDocument, root).sort((left, right) => left.id.localeCompare(right.id));
      if (root.status !== "idle") return { wait: true };
      if (currentGoal === undefined || currentGrants.length !== currentOwnedOpen.length || currentGrants.length === 0) return { authorityError: "automatic continuation scope changed before wake delivery" };
      const invalidReason = currentGrants.map((team) => agentTeamAutopilotInvalidReason(team, root, currentGoal, currentDocument.settings)).find((reason) => reason !== undefined);
      if (invalidReason !== undefined) return { authorityError: invalidReason };
      const currentGroup = agentTeamAutopilotWakeGroup(currentGrants, wakeKey);
      if (currentGroup.error !== undefined || currentGroup.wake === undefined) return { authorityError: currentGroup.error ?? "automatic wake ledger disappeared before delivery" };
      if (currentGoal.maxGoalRounds > currentGroup.wake.targetMaxGoalRounds
        || currentGoal.maxGoalRounds < currentGroup.wake.targetMaxGoalRounds - AGENT_TEAM_AUTOPILOT_ROUND_GRANT) return { authorityError: "goal cap diverged from the durable automatic wake target" };
      if (currentGoal.roundsStarted === currentGroup.wake.roundsStarted + 1) {
        if (currentGoal.maxGoalRounds !== currentGroup.wake.targetMaxGoalRounds) return { authorityError: "goal round advanced without the exact durable wake cap" };
        return { goal: currentGoal, wake: currentGroup.wake, recoveredDelivery: true };
      }
      if (currentGoal.roundsStarted !== currentGroup.wake.roundsStarted) return { authorityError: "goal round advanced beyond the exact durable wake" };
      const currentAction = rootAgentTeamAutopilotAction(currentDocument, root);
      if (currentAction === undefined || currentAction.kind === "waiting") return { stale: true };
      return { goal: currentGoal, wake: currentGroup.wake };
    });
    const markWakeDelivered = async (deliveredGoal) => store.mutate((draft) => {
      const currentGoal = ctx.goals.get(root);
      const currentGrants = activeGrantTeams(draft, root).sort((left, right) => left.id.localeCompare(right.id));
      const currentGroup = agentTeamAutopilotWakeGroup(currentGrants, wakeKey);
      if (currentGroup.error !== undefined || currentGroup.wake === undefined || currentGoal?.id !== deliveredGoal.id
        || currentGoal.revision !== deliveredGoal.revision || currentGoal.maxGoalRounds !== currentGroup.wake.targetMaxGoalRounds
        || ![currentGroup.wake.roundsStarted, currentGroup.wake.roundsStarted + 1].includes(currentGoal.roundsStarted)) {
        reject("automatic wake delivery facts changed before durable acknowledgement", "AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED");
      }
      const deliveredAt = now();
      for (const team of currentGrants) {
        const receipt = team.autopilot.wakes.find((candidate) => candidate.key === wakeKey);
        if (receipt !== undefined && !["delivered", "cancelled"].includes(receipt.status)) {
          receipt.status = "delivered";
          receipt.goalRevision = currentGoal.revision;
          receipt.deliveredAt = deliveredAt;
          team.updatedAt = deliveredAt;
        }
      }
      return true;
    });
    const cancelStaleWake = async () => store.mutate((draft) => {
      const currentGoal = ctx.goals.get(root);
      const currentGrants = activeGrantTeams(draft, root);
      const currentGroup = agentTeamAutopilotWakeGroup(currentGrants, wakeKey);
      if (currentGroup.wake === undefined || currentGroup.error !== undefined) return;
      const timestamp = now();
      const rollbackReservation = currentGoal?.maxGoalRounds === currentGroup.wake.targetMaxGoalRounds - AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
      for (const team of currentGrants) {
        const receipt = team.autopilot.wakes.find((candidate) => candidate.key === wakeKey);
        if (receipt !== undefined && !["delivered", "cancelled"].includes(receipt.status)) {
          receipt.status = "cancelled";
          receipt.cancelledAt = timestamp;
          receipt.reason = "durable team state no longer requires an automatic goal turn";
        }
        if (rollbackReservation) {
          team.autopilot.additionalRoundsGranted -= AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
          team.autopilot.expectedMaxGoalRounds -= AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
        }
        team.updatedAt = timestamp;
      }
    });
    let checked = await deliveryState();
    if (checked.wait) return;
    if (checked.authorityError !== undefined) return revokeRoot(root, checked.authorityError);
    if (checked.stale) { await cancelStaleWake(); return; }
    if (checked.recoveredDelivery) {
      await markWakeDelivered(checked.goal);
      if (wakeEvidence !== undefined && wakeEvidenceByRoot.get(root.id) === wakeEvidence) wakeEvidenceByRoot.delete(root.id);
      return;
    }
    goal = checked.goal;
    wake = checked.wake;
    if (goal.maxGoalRounds < wake.targetMaxGoalRounds) {
      if (goal.maxGoalRounds + AGENT_TEAM_AUTOPILOT_ROUND_GRANT !== wake.targetMaxGoalRounds || goal.roundsStarted < goal.maxGoalRounds) return revokeRoot(root, "automatic wake observed an unexpected goal cap");
      goal = ctx.goals.edit(root, { id: goal.id, revision: goal.revision }, { maxGoalRounds: wake.targetMaxGoalRounds });
      const authorityInvalid = await store.mutate((draft) => {
        const currentGrants = activeGrantTeams(draft, root);
        if (currentGrants.some((team) => agentTeamAutopilotInvalidReason(team, root, goal, draft.settings) !== undefined)) return true;
        for (const team of currentGrants) {
          const receipt = team.autopilot.wakes.find((candidate) => candidate.key === wakeKey);
          if (receipt !== undefined && receipt.status === "prepared") { receipt.status = "goal_mutated"; receipt.goalRevision = goal.revision; team.updatedAt = now(); }
        }
        return false;
      });
      if (authorityInvalid) return revokeRoot(root, "automatic continuation authority changed after goal-cap mutation");
    } else if (goal.maxGoalRounds > wake.targetMaxGoalRounds) return revokeRoot(root, "goal cap exceeded the durable automatic wake target");
    checked = await deliveryState();
    if (checked.wait) return;
    if (checked.authorityError !== undefined) return revokeRoot(root, checked.authorityError);
    if (checked.stale) { await cancelStaleWake(); return; }
    if (checked.recoveredDelivery) {
      await markWakeDelivered(checked.goal);
      if (wakeEvidence !== undefined && wakeEvidenceByRoot.get(root.id) === wakeEvidence) wakeEvidenceByRoot.delete(root.id);
      return;
    }
    goal = checked.goal;
    if (goal.phase === "blocked" && goal.blockedReason?.code === "round-limit" || goal.phase === "active" && goal.activation === "disarmed") {
      goal = ctx.goals.resume(root, { id: goal.id, revision: goal.revision });
    }
    if (goal.phase !== "active" || goal.activation !== "armed") return revokeRoot(root, "automatic wake could not arm the exact bound goal");
    await markWakeDelivered(goal);
    if (wakeEvidence !== undefined && wakeEvidenceByRoot.get(root.id) === wakeEvidence) wakeEvidenceByRoot.delete(root.id);
  };
  const clearRootRetry = (rootId) => {
    const state = retryStates.get(rootId);
    if (state?.timer !== undefined) clearTimer(state.timer);
    retryStates.delete(rootId);
  };
  const failRootReconcile = async (root, error) => {
    if (!rootIsLive(root)) return clearRootRetry(root?.id);
    // Never leave a retry window with process-local armed authority. A later
    // exact retry may resume from its durable wake, but a crash between attempts
    // remains safely disarmed.
    if (root.status === "idle") disarmBoundAgentTeamGoal(ctx, root, store.snapshot());
    const prior = retryStates.get(root.id) ?? { attempts: 0, timer: undefined };
    if (prior.timer !== undefined) clearTimer(prior.timer);
    prior.attempts += 1;
    prior.timer = undefined;
    ctx.logger.warn(`agent-teams autopilot reconciliation failed (${prior.attempts}/${maxRetries}): ${String(error?.code ?? error?.message ?? error)}`);
    if (prior.attempts >= maxRetries) {
      retryStates.delete(root.id);
      try { await revokeRoot(root, `automatic continuation failed after ${maxRetries} bounded recovery attempts: ${error?.code ?? error?.message ?? "unknown error"}`); }
      catch (revokeError) { ctx.logger.warn(`agent-teams autopilot fail-closed revocation failed: ${String(revokeError?.code ?? revokeError?.message ?? revokeError)}`); }
      return;
    }
    const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** (prior.attempts - 1)));
    prior.timer = setTimer(() => {
      prior.timer = undefined;
      if (!closed && retryStates.get(root.id) === prior) request();
    }, delay);
    prior.timer?.unref?.();
    retryStates.set(root.id, prior);
  };
  const reconcile = async () => {
    for (const root of ctx.agents.roots()) {
      try {
        await reconcileRoot(root);
        clearRootRetry(root.id);
      } catch (error) {
        await failRootReconcile(root, error);
      }
    }
  };
  request = () => {
    if (closed) return;
    requested = true;
    if (run !== undefined) return;
    const operation = async () => {
      while (requested && !closed) {
        requested = false;
        await reconcile();
      }
    };
    run = typeof ctx.agents.withoutInitiator === "function" ? ctx.agents.withoutInitiator(operation) : operation();
    run.finally(() => { run = undefined; if (requested && !closed) request(); });
  };
  const onDocument = (document) => {
    const current = document ?? store.snapshot();
    for (const rootSessionId of agentTeamAutopilotWakeRoots(observedDocument, current)) {
      wakeEvidenceSequence += 1;
      wakeEvidenceByRoot.set(rootSessionId, wakeEvidenceSequence);
    }
    observedDocument = current;
    request();
  };
  const onStatus = ({ agent, status }) => { if (status === "idle" && rootIsLive(agent)) request(); };
  const onSessionEvent = (session, event) => {
    const root = ctx.agents.get(session.id);
    if (!rootIsLive(root)) return;
    if (event?.type === "goal/change" || event?.type === "user/message" && event.data?.source?.kind === "goal") request();
    if (event?.type === "turn/end" && ["max-tokens", "aborted"].includes(event.data?.reason?.kind)) void revokeRoot(root, `goal turn ended with ${event.data.reason.kind}`).catch((error) => ctx.logger.warn(String(error)));
  };
  const onSessionStart = ({ agent }) => { if (rootIsLive(agent)) void revokeRoot(agent, "session restart requires fresh direct-human continuation authority").catch((error) => ctx.logger.warn(String(error))); };
  const onAgentError = ({ agent }) => { if (rootIsLive(agent)) void revokeRoot(agent, "agent error requires fresh direct-human continuation authority").catch((error) => ctx.logger.warn(String(error))); };
  const unsubscribe = store.subscribe(onDocument);
  const disposeStatus = ctx.on("agent/status", onStatus);
  const disposeSessionEvent = ctx.on("session/event", onSessionEvent);
  const disposeSessionStart = ctx.on("agent/session-start", onSessionStart);
  const disposeAgentError = ctx.on("agent/error", onAgentError);
  const recoverPendingWakeBeforeLifecycleRevoke = async (root) => {
    const document = store.snapshot();
    const grants = activeGrantTeams(document, root).sort((left, right) => left.id.localeCompare(right.id));
    const pendingKeys = grants.map((team) => team.autopilot.wakes.filter((wake) => ["prepared", "goal_mutated"].includes(wake.status)).map((wake) => wake.key));
    if (grants.length === 0 || pendingKeys.some((keys) => keys.length > 1)
      || new Set(pendingKeys.map((keys) => keys[0] ?? "")).size !== 1 || pendingKeys[0].length === 0) return;
    const wakeKey = pendingKeys[0][0];
    const grouped = agentTeamAutopilotWakeGroup(grants, wakeKey);
    if (grouped.error !== undefined || grouped.wake === undefined) return;
    const wake = grouped.wake;
    // Lifecycle readiness is not authority to resume a Goal. Disarm first, then
    // recover the exact durable effect prefix solely for audit/rollback before
    // rotating authority and revoking the grant group.
    disarmBoundAgentTeamGoal(ctx, root, document);
    let goal = ctx.goals.get(root);
    if (goal?.id !== grants[0].autopilot.goalId) return;
    if (goal.roundsStarted === wake.roundsStarted + 1 && goal.maxGoalRounds === wake.targetMaxGoalRounds) {
      await store.mutate((draft) => {
        const currentGoal = ctx.goals.get(root);
        const currentGrants = activeGrantTeams(draft, root).sort((left, right) => left.id.localeCompare(right.id));
        const currentGroup = agentTeamAutopilotWakeGroup(currentGrants, wakeKey);
        if (currentGroup.error !== undefined || currentGroup.wake === undefined || currentGoal?.id !== goal.id
          || currentGoal.roundsStarted !== wake.roundsStarted + 1 || currentGoal.maxGoalRounds !== wake.targetMaxGoalRounds) return;
        const deliveredAt = now();
        for (const team of currentGrants) {
          const receipt = team.autopilot.wakes.find((candidate) => candidate.key === wakeKey);
          receipt.status = "delivered";
          receipt.goalRevision = currentGoal.revision;
          receipt.deliveredAt = deliveredAt;
          team.updatedAt = deliveredAt;
        }
      });
      return;
    }
    if (goal.roundsStarted !== wake.roundsStarted) return;
    const reservationExtended = grants.every((team) => team.autopilot.expectedMaxGoalRounds === wake.targetMaxGoalRounds
      && team.autopilot.additionalRoundsGranted > 0)
      && wake.targetMaxGoalRounds > grants[0].autopilot.baseMaxGoalRounds;
    const previousCap = wake.targetMaxGoalRounds - AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
    if (reservationExtended && goal.maxGoalRounds === wake.targetMaxGoalRounds && goal.roundsStarted <= previousCap) {
      try { ctx.goals.edit(root, { id: goal.id, revision: goal.revision }, { maxGoalRounds: previousCap }); }
      catch (error) {
        const observed = ctx.goals.get(root);
        if (observed?.id !== goal.id || observed.maxGoalRounds !== previousCap) {
          ctx.logger.warn(`agent-teams startup could not roll back an unconsumed automatic Goal cap: ${String(error?.code ?? error?.message ?? error)}`);
          return;
        }
      }
      goal = ctx.goals.get(root);
    }
    const exactRollback = reservationExtended && goal?.id === grants[0].autopilot.goalId && goal.roundsStarted === wake.roundsStarted
      && goal.maxGoalRounds === previousCap;
    const noCapEffect = !reservationExtended && goal?.maxGoalRounds === wake.targetMaxGoalRounds;
    if (!exactRollback && !noCapEffect) return;
    await store.mutate((draft) => {
      const currentGoal = ctx.goals.get(root);
      const currentGrants = activeGrantTeams(draft, root).sort((left, right) => left.id.localeCompare(right.id));
      const currentGroup = agentTeamAutopilotWakeGroup(currentGrants, wakeKey);
      if (currentGroup.error !== undefined || currentGroup.wake === undefined || currentGoal?.id !== goal.id
        || currentGoal.roundsStarted !== wake.roundsStarted || currentGoal.maxGoalRounds !== goal.maxGoalRounds) return;
      const cancelledAt = now();
      for (const team of currentGrants) {
        const receipt = team.autopilot.wakes.find((candidate) => candidate.key === wakeKey);
        receipt.status = "cancelled";
        receipt.cancelledAt = cancelledAt;
        receipt.reason = "plugin lifecycle recovered an unconsumed automatic wake before revocation";
        if (exactRollback) {
          team.autopilot.additionalRoundsGranted -= AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
          team.autopilot.expectedMaxGoalRounds -= AGENT_TEAM_AUTOPILOT_ROUND_GRANT;
        }
        team.updatedAt = cancelledAt;
      }
    });
  };
  // Goal activation is intentionally process-local. A persisted team grant is an
  // audit fact, never authority to cross a session-start edge; revoke every live
  // grant before the first reconciliation in this plugin lifecycle.
  void ready.then(async () => {
    const reason = "plugin or session lifecycle restart requires fresh direct-human continuation authority";
    const liveRootIds = new Set();
    for (const root of ctx.agents.roots()) if (rootIsLive(root)) {
      liveRootIds.add(root.id);
      try { await recoverPendingWakeBeforeLifecycleRevoke(root); }
      catch (error) { ctx.logger.warn(`agent-teams autopilot startup wake recovery failed: ${String(error?.code ?? error?.message ?? error)}`); }
      await revokeRoot(root, reason);
    }
    await store.mutate((document) => {
      for (const team of document.teams) if (!liveRootIds.has(team.rootLeadSessionId)) revokeAgentTeamAutopilot(team, reason);
    });
    request();
  })
    .catch((error) => ctx.logger.warn(`agent-teams autopilot initialization failed: ${String(error)}`));
  return {
    close() {
      closed = true;
      for (const rootId of [...retryStates.keys()]) clearRootRetry(rootId);
      unsubscribe();
      if (typeof disposeStatus === "function") disposeStatus();
      if (typeof disposeSessionEvent === "function") disposeSessionEvent();
      if (typeof disposeSessionStart === "function") disposeSessionStart();
      if (typeof disposeAgentError === "function") disposeAgentError();
    },
    onDocument,
    onStatus,
    request,
    async flush() { request(); while (run !== undefined) await run; },
  };
}
function projectTaskWakeMessage(root, wakeRef) {
  return createUserMessage({
    content: textContent(`[Project task wake ${wakeRef}] Project work is eligible again. Resume the durable project loop: read targeted collaboration requests, then call project_task claim_next with a new request_id. Do not replay work already claimed or completed.`),
    source: { kind: "plugin", plugin: "dsh-agent-teams", form: "notice", summary: "Project tasks" },
  });
}
function projectTaskWakeRefFromMessage(candidate) {
  const message = candidate?.data?.message ?? candidate;
  const source = message?.source;
  // Reconcile wakes persisted before the Host queue provenance migration as well as current plugin notices.
  const supportedSource = source?.kind === "coordinator" || (source?.kind === "plugin" && source.plugin === "dsh-agent-teams");
  if (!supportedSource || source.summary !== "Project tasks") return undefined;
  const text = message.content?.[0]?.type === "text" ? message.content[0].text : "";
  return /^\[Project task wake ([A-Za-z0-9_-]{1,256})\]/u.exec(text)?.[1];
}
function rootHasProjectTaskWake(root, wakeRef) {
  const pending = [...(root.inbox?.nextTurn ?? []), ...(root.inbox?.nextStep ?? [])];
  if (pending.some((message) => projectTaskWakeRefFromMessage(message) === wakeRef)) return true;
  const events = snapshotSessionEvents(root?.session);
  return events.slice(-PROJECT_TASK_WAKE_EVENT_TAIL).some((event) => event?.type === "user/message" && projectTaskWakeRefFromMessage(event) === wakeRef);
}
function rootProjectTaskWakeEvidence(root, wakeRef) {
  if (rootHasProjectTaskWake(root, wakeRef)) return "exact_message";
  const session = root?.session;
  const events = typeof session?.snapshotEvents === "function" ? snapshotSessionEvents(session) : undefined;
  const nextTurn = root?.inbox?.nextTurn;
  const nextStep = root?.inbox?.nextStep;
  // Absence is evidence only when every persisted session event and both live inbox
  // queues were inspected. A bounded tail that omitted older events is never used
  // to justify a retry, so an uncertain delivery cannot be replayed blindly.
  if (Array.isArray(events) && events.length <= PROJECT_TASK_WAKE_EVENT_TAIL && Array.isArray(nextTurn) && Array.isArray(nextStep)) return "complete_history_absence";
  return "unknown";
}
function clearQueuedProjectTaskWakes(root) {
  if (!root?.inbox || typeof root.inbox.remove !== "function") return 0;
  const pending = [...(root.inbox.nextTurn ?? []), ...(root.inbox.nextStep ?? [])];
  let removed = 0;
  for (const message of pending) {
    if (projectTaskWakeRefFromMessage(message) === undefined || typeof message?.id !== "string") continue;
    if (root.inbox.remove(message.id)) removed += 1;
  }
  return removed;
}
async function dispatchProjectTaskWakeSignalsNow(ctx, binding, { limit = 16 } = {}) {
  const dispatcherRef = binding.dispatcherRef;
  const claimed = binding.wake.claim({ dispatcherRef, limit });
  let delivered = 0, retryable = 0;
  for (const signal of claimed) {
    const root = ctx.agents.roots().find((candidate) => ["idle", "running"].includes(candidate.status)
      && optionalProjectKeyForRoot(candidate) === binding.canonicalProjectKey
      && binding.actorRefForSessionId(candidate.id) === signal.actorRef);
    let outcome = "not_delivered";
    if (root !== undefined && PROJECT_TASK_STOPPED_ROOTS.has(root.id)) {
      clearQueuedProjectTaskWakes(root);
      outcome = "paused";
    } else if (root !== undefined) {
      try {
        if (!rootHasProjectTaskWake(root, signal.wakeRef)) {
          const accepted = root.status === "idle" ? root.followup(projectTaskWakeMessage(root, signal.wakeRef)) : root.steer(projectTaskWakeMessage(root, signal.wakeRef));
          await accepted;
        }
        if (PROJECT_TASK_STOPPED_ROOTS.has(root.id)) {
          clearQueuedProjectTaskWakes(root);
          outcome = "paused";
        } else {
          outcome = "delivered";
          delivered += 1;
        }
      } catch {
        try {
          if (PROJECT_TASK_STOPPED_ROOTS.has(root.id)) { clearQueuedProjectTaskWakes(root); outcome = "paused"; }
          else if (rootHasProjectTaskWake(root, signal.wakeRef)) { outcome = "delivered"; delivered += 1; }
          else outcome = "outcome_unknown";
        } catch { outcome = "outcome_unknown"; }
      }
    }
    if (outcome === "not_delivered") retryable += 1;
    binding.wake.ack({ wakeRef: signal.wakeRef, dispatcherRef, outcome });
  }
  return { claimed: claimed.length, delivered, retryable };
}
function dispatchProjectTaskWakeSignals(ctx, binding, options) {
  const key = binding.canonicalProjectKey;
  const previous = PROJECT_TASK_WAKE_CHAINS.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => dispatchProjectTaskWakeSignalsNow(ctx, binding, options));
  const settled = run.finally(() => { if (PROJECT_TASK_WAKE_CHAINS.get(key) === settled) PROJECT_TASK_WAKE_CHAINS.delete(key); });
  PROJECT_TASK_WAKE_CHAINS.set(key, settled);
  return run;
}
function queuedTeamRelayId(message) {
  const source = message?.source;
  const supportedSource = source?.kind === "agent-message" && source.form === "relay"
    || source?.kind === "coordinator" && source.summary === "Agent Teams";
  if (!supportedSource) return undefined;
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
    appendTaskLifecycleEvent(task, { kind: "cancel", at: timestamp, attempt: task.attempt ?? 0, ...(task.claimId === undefined ? {} : { claimId: task.claimId }), leaseEpoch: task.leaseEpoch ?? team.pauseEpoch ?? 0, actorId: team.rootLeadSessionId, reason });
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
    bumpTaskRevision(task);
    cancelledTaskIds.push(task.id);
  }
  return cancelledTaskIds;
}
function closeTeamRecord(team, reason = "team closed before delivery acknowledgement", { forced = false, failures = [] } = {}) {
  const timestamp = now();
  if (failures.length > 0) reject("a failed shutdown attempt cannot be persisted as a closed team", "AGENT_TEAMS_INVALID_CLOSURE");
  if (!forced) {
    const unacceptedTaskIds = team.tasks.filter(taskAwaitsAcceptance).map((task) => task.id);
    if (unacceptedTaskIds.length > 0) reject(`non-forced closure has submitted tasks awaiting independent lead acceptance: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
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
  const objective = nonEmptyString(input.objective ?? input.name ?? "Agent team", "objective", 16_384);
  const normalizedName = nonEmptyString(input.name ?? objective.slice(0, 500), "name", 500);
  const normalizedLeadName = normalizeMemberName(input.leadName ?? "Lead", "leadName");
  const requestId = optionalString(input.requestId, "requestId", 256);
  const inputHash = requestId === undefined ? undefined : createHash("sha256").update(JSON.stringify({ objective, name: normalizedName, leadName: normalizedLeadName })).digest("hex");
  const mainSelection = await resolveModelSelection(store, "main", undefined, lead.options);
  return store.mutate((document) => {
    assertEnabled(document);
    if (requestId !== undefined) {
      const existing = document.teams.find((team) => team.rootLeadSessionId === lead.id && team.start?.requestId === requestId);
      if (existing !== undefined) {
        if (existing.start.inputHash !== inputHash) reject("team_start request_id was already used with different input", "AGENT_TEAMS_IDEMPOTENCY_CONFLICT");
        if (input.routingReceiptId !== undefined) finalizeRoutingReceiptForTeam(document, input.routingReceiptId, existing, "reused");
        return projectTeam(existing);
      }
    }
    const openTeams = document.teams.filter((team) => team.rootLeadSessionId === lead.id && team.state !== "closed").length;
    if (openTeams >= HARD_MAX_TEAMS_PER_ROOT) reject(`root lead peer-team limit reached (${HARD_MAX_TEAMS_PER_ROOT})`, "AGENT_TEAMS_TEAM_LIMIT");
    const timestamp = now();
    const initialPlanHash = createHash("sha256").update(JSON.stringify({ objective, tasks: [] })).digest("hex");
    const autopilotGrant = agentTeamAutopilotGrantForCreation(document, lead, input.autopilotGoal, {
      directHumanGrantIntent: input.directHumanGrantIntent,
      goalRoundGrantIntent: input.goalRoundGrantIntent,
      routingReceiptId: input.routingReceiptId,
    });
    const team = {
      id: randomUUID(),
      rootLeadSessionId: lead.id,
      name: normalizedName,
      objective,
      state: "active",
      pauseEpoch: 0,
      ...(optionalProjectKeyForRoot(lead) === undefined ? {} : { projectKey: optionalProjectKeyForRoot(lead) }),
      ownershipHistory: [],
      taskCommandReceipts: [],
      ...(requestId === undefined ? {} : { start: { requestId, inputHash } }),
      createdAt: timestamp,
      updatedAt: timestamp,
      members: [{
        id: `lead:${lead.id}`,
        sessionId: lead.id,
        name: normalizedLeadName,
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
      ...(autopilotGrant === undefined ? {} : { autopilot: autopilotGrant }),
    };
    document.teams.push(team);
    if (input.routingReceiptId !== undefined) finalizeRoutingReceiptForTeam(document, input.routingReceiptId, team, "created");
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
function assertExactAutomaticGoalRound(ctx, lead, authority) {
  if (!isRecord(authority)) reject("automatic plan recommit requires the exact admitted Goal round", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  const exact = exactGoalRoundRootAuthority(ctx, { agent: lead, turnKey: authority.turnKey });
  if (exact === undefined) {
    reject("automatic plan recommit requires the exact admitted Goal round", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  }
  if (exact.projectKey !== authority.projectKey) {
    reject("automatic plan recommit requires the same canonical project scope", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
  }
  if (Object.keys(exact).some((key) => exact[key] !== authority[key])) {
    reject("automatic plan recommit requires the exact admitted Goal round", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  }
  return ctx.goals.get(lead);
}
function automaticPlanRecommitGrantGroup(document, team, lead, goal, authority) {
  const openTeams = document.teams.filter((candidate) => candidate.rootLeadSessionId === lead.id && candidate.state !== "closed");
  const grants = openTeams.filter((candidate) => ["pending_plan", "active"].includes(candidate.autopilot?.status));
  if (grants.length === 0) return [];
  if (grants.length !== openTeams.length || !grants.includes(team)) reject("automatic plan recommit requires one complete live root grant group", "AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED");
  const template = grants[0].autopilot;
  if (authority.goalId !== goal.id || authority.goalObjectiveHash !== template.goalObjectiveHash
    || authority.goalMaxGoalRounds !== template.expectedMaxGoalRounds
    || new Set(grants.map((candidate) => candidate.autopilot.authorizationEpoch)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.goalId)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.goalObjectiveHash)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.baseMaxGoalRounds)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.expectedMaxGoalRounds)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.maxAdditionalRounds)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.additionalRoundsGranted)).size !== 1
    || new Set(grants.map((candidate) => candidate.autopilot.lastStateHash)).size !== 1) {
    reject("automatic plan recommit grant group diverged", "AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED");
  }
  if (grants.some((candidate) => pendingAgentTeamAutopilotWake(candidate.autopilot) !== undefined)) {
    reject("automatic plan recommit cannot move a pending durable wake", "AGENT_TEAMS_AUTOPILOT_WAKE_PENDING");
  }
  for (const candidate of grants) {
    const autopilot = candidate.autopilot;
    if (document.settings.autopilotEnabled !== true || autopilot.maxAdditionalRounds > document.settings.autopilotMaxAdditionalRounds
      || effectiveTeamState(candidate) !== "active" || candidate.rootLeadSessionId !== lead.id
      || candidate.projectKey !== authority.projectKey || autopilot.projectKey !== authority.projectKey
      || autopilot.rootSessionId !== lead.id || autopilot.goalId !== goal.id
      || autopilot.goalObjectiveHash !== agentTeamAutopilotObjectiveHash(goal.objective)
      || autopilot.expectedMaxGoalRounds !== goal.maxGoalRounds
      || autopilot.pauseEpochAtGrant !== (candidate.pauseEpoch ?? 0)
      || candidate.closure !== undefined || candidate.handoff !== undefined
      || (candidate.memberRecoveries ?? []).some((receipt) => receipt.status === "outcome_unknown" || receipt.status === "prepared")) {
      reject("automatic plan recommit grant scope changed", "AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED");
    }
    if (candidate !== team && agentTeamAutopilotInvalidReason(candidate, lead, goal, document.settings) !== undefined) {
      reject("automatic plan recommit sibling authority changed", "AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED");
    }
  }
  return grants;
}
function assertAutomaticPlanRecommitAllowed(ctx, document, team, lead, authority) {
  requireLiveRootLead(ctx, team, lead);
  requireActiveTeam(team);
  const goal = assertExactAutomaticGoalRound(ctx, lead, authority);
  const grantGroup = automaticPlanRecommitGrantGroup(document, team, lead, goal, authority);
  const exactPendingGrant = team.autopilot?.status === "pending_plan" && grantGroup.includes(team);
  if (!teamHasEstablishedWorker(team) && !exactPendingGrant) reject("automatic plan recommit requires an established team or the exact pending Host Goal-round grant", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  const currentProjectKey = projectKeyForRoot(lead);
  if (team.projectKey === undefined || team.projectKey !== currentProjectKey) reject("automatic plan recommit requires the same canonical project scope", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
  if (team.tasks.some((task) => task.capabilities.some((capability) => capability.status === "unavailable"))) reject("automatic plan recommit cannot use an unavailable capability", "AGENT_TEAMS_CAPABILITY_UNAVAILABLE");
  if (!planCapabilitiesAreVerified(team)) reject("automatic plan recommit cannot expand unknown capabilities", "AGENT_TEAMS_CAPABILITY_UNKNOWN");
  if (!planFilesAreConflictFree(team)) reject("automatic plan recommit requires conflict-free file ownership", "AGENT_TEAMS_FILE_CONFLICT");
  if (!planEffectsAreOrdinary(team)) reject("automatic plan recommit is limited to effect-free internal work", "AGENT_TEAMS_EXTERNAL_EFFECT_CONFIRMATION_REQUIRED");
  return { goal, grantGroup };
}
function rebindAutomaticPlanGrantGroup(grantGroup, team, planHash) {
  if (grantGroup.length === 0) return;
  const timestamp = now();
  for (const candidate of grantGroup) {
    // A plan transition changes the scheduler action material. Clear the shared
    // action fingerprint atomically across the whole root group while preserving
    // terminal wake receipts. Pending wakes were rejected by the preflight.
    candidate.autopilot.lastStateHash = undefined;
    candidate.autopilot.parkedGoalRevision = undefined;
    candidate.autopilot.parkedAt = undefined;
    candidate.updatedAt = timestamp;
  }
  if (team.autopilot.status === "active" || teamHasEstablishedWorker(team)) {
    team.autopilot.status = "active";
    team.autopilot.planHashAtGrant = planHash;
  }
}

async function commitTeamPlan(ctx, store, lead, input) {
  try {
    return await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const team = optionalString(input.teamId, "teamId", 256) === undefined
      ? resolveUniqueLeadTeam(document, undefined, lead.id, (candidate) => candidate.state === "active")
      : findTeam(document, input.teamId);
    requireLiveRootLead(ctx, team, lead);
    requireActiveTeam(team);
    const automatic = input.automaticContinuation === true
      ? assertAutomaticPlanRecommitAllowed(ctx, document, team, lead, input.automaticGoalRoundAuthority)
      : undefined;
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
      if (input.automaticContinuation === true) rebindAutomaticPlanGrantGroup(automatic.grantGroup, team, currentHash);
      else if (bindAgentTeamAutopilotPlan(team, input.autopilotGoal)) team.updatedAt = now();
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
    if (input.automaticContinuation === true) rebindAutomaticPlanGrantGroup(automatic.grantGroup, team, currentHash);
    else bindAgentTeamAutopilotPlan(team, input.autopilotGoal);
    team.updatedAt = timestamp;
    return { teamId: team.id, plan: clone(team.plan), reused: false };
    }));
  } catch (error) {
    if (input.automaticContinuation === true && liveAgentTeamAutopilotTeams(store.snapshot(), lead.id).length > 0) {
      await revokeRootAgentTeamAutopilot(ctx, store, lead, `automatic plan recommit failed closed: ${error?.code ?? "invalid plan authority"}`, "revoked", input.authorizationProvider);
    }
    throw error;
  }
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
    const revokeReason = "ownership handoff requires fresh direct-human continuation authority";
    let autopilotRevocationAudit;
    if (team.autopilot !== undefined) {
      const statusAtHandoff = team.autopilot.status;
      revokeAgentTeamAutopilot(team, revokeReason);
      autopilotRevocationAudit = {
        autopilotGrantId: team.autopilot.grantId,
        autopilotRoutingReceiptId: team.autopilot.routingReceiptId,
        autopilotGoalId: team.autopilot.goalId,
        autopilotStatusAtHandoff: statusAtHandoff,
        autopilotRevokedAt: timestamp,
        autopilotRevokeReason: revokeReason,
      };
      // A grant is bound to the former exact root. Retain only the bounded private
      // ownership audit above; the new owner must establish fresh direct-human
      // authority before any automatic Goal continuation can resume.
      team.autopilot = undefined;
    }
    // A resumed goal can coordinate every team owned by the source root. Moving
    // even one of those teams changes that authority scope, so revoke siblings in
    // the same ownership transaction rather than waiting for an idle reconciler.
    for (const sibling of document.teams) if (sibling.id !== team.id && sibling.rootLeadSessionId === handoff.sourceRootSessionId) revokeAgentTeamAutopilot(sibling, revokeReason);
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
        bumpTaskRevision(task);
      }
    }
    const selection = { modelTier: "main", inheritsMain: false, routeSource: "live-lead", ...(optionalProvider(target.options) === undefined ? {} : { provider: optionalProvider(target.options) }), ...(optionalString(target.options?.model, "target model", 256) === undefined ? {} : { model: target.options.model.trim() }) };
    team.members.push({ id: `lead:${target.id}`, sessionId: target.id, name: normalizeMemberName(input.leadName ?? "Lead", "leadName"), role: "root lead and coordinator", ...selection, kind: "lead", state: "running", createdAt: timestamp, updatedAt: timestamp });
    team.rootLeadSessionId = target.id;
    team.ownershipHistory ??= [];
    boundedPush(team.ownershipHistory, { kind: "handoff_adopted", sourceRootSessionId: handoff.sourceRootSessionId, targetRootSessionId: target.id, projectKey: handoff.projectKey, tokenHash: handoff.tokenHash, at: timestamp, pauseEpoch: team.pauseEpoch, ...(autopilotRevocationAudit === undefined ? {} : autopilotRevocationAudit) }, MAX_OWNERSHIP_HISTORY);
    team.handoff = undefined;
    team.resume = undefined;
    USER_PAUSED_TEAMS.add(team.id);
    USER_PAUSE_EPOCHS.set(team.id, team.pauseEpoch);
    team.updatedAt = timestamp;
    return { teamId: team.id, adopted: true, automaticallyWoken: false, pauseEpoch: team.pauseEpoch, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === target.id || candidate.id === team.id)) };
  }));
}

function taskWorkspaceAnchors(tasks) {
  const anchors = new Set();
  for (const task of tasks) for (const file of task.files ?? []) {
    const boundary = normalizeExpansionBoundary(file, `task ${task.id} file scope`, { file: true });
    if (/^(?:[A-Za-z]:\/|\/)/u.test(boundary)) reject(`task ${task.id} file scope must be relative to the Host workspace`, "AGENT_TEAMS_WORKSPACE_SCOPE_INVALID");
    const prefix = expansionGlobPrefix(boundary).prefix;
    const anchor = prefix.split("/").find((segment) => segment.length > 0);
    if (anchor !== undefined) anchors.add(anchor);
  }
  return [...anchors];
}
function assertSpawnWorkspacePreflight(team, lead, tasks) {
  if (team.projectKey === undefined) return;
  if (projectKeyForRoot(lead) !== team.projectKey) reject("team canonical project identity no longer matches the spawning root workspace", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
  const workspace = projectScopeForRoot(lead);
  let children;
  try { children = readdirSync(workspace, { withFileTypes: true }); }
  catch { reject("Host workspace cannot be inspected for task file-scope binding", "AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN"); }
  for (const anchor of taskWorkspaceAnchors(tasks)) {
    if (existsSync(join(workspace, anchor))) continue;
    const siblingMatches = children.filter((entry) => entry.isDirectory() && existsSync(join(workspace, entry.name, anchor)));
    if (siblingMatches.length > 0) reject(`task file scope anchor ${JSON.stringify(anchor)} exists only below ${siblingMatches.length} child workspace candidate(s); select one exact workspace before spawning`, "AGENT_TEAMS_WORKSPACE_SCOPE_AMBIGUOUS");
  }
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
      if (input.routingReceiptId !== undefined) finalizeRoutingReceiptForTeam(document, input.routingReceiptId, existing, "reused");
      return { teamId: existing.id, reused: true };
    }
    if (document.teams.filter((team) => team.rootLeadSessionId === lead.id && team.state !== "closed").length >= HARD_MAX_TEAMS_PER_ROOT) reject(`root lead peer-team limit reached (${HARD_MAX_TEAMS_PER_ROOT})`, "AGENT_TEAMS_TEAM_LIMIT");
    if (plan.members.length > document.settings.maxMembers) reject("bootstrap exceeds the configured teammate limit", "AGENT_TEAMS_MEMBER_LIMIT");
    if (activeWorkerTurnsForLead(document, lead.id) + plan.members.length > document.settings.maxActiveTurns) reject("bootstrap exceeds the root lead active-turn limit", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
    const timestamp = now(), teamId = randomUUID();
    const taskIds = new Map(plan.tasks.map((task) => [task.key, randomUUID()]));
    const autopilotGrant = agentTeamAutopilotGrantForCreation(document, lead, input.autopilotGoal, {
      directHumanGrantIntent: input.directHumanGrantIntent,
      goalRoundGrantIntent: input.goalRoundGrantIntent,
      routingReceiptId: input.routingReceiptId,
    });
    const team = {
      id: teamId, rootLeadSessionId: lead.id, name: plan.name ?? plan.objective.slice(0, 500), objective: plan.objective, state: "active", pauseEpoch: 0, ...(optionalProjectKeyForRoot(lead) === undefined ? {} : { projectKey: optionalProjectKeyForRoot(lead) }), ownershipHistory: [], taskCommandReceipts: [], createdAt: timestamp, updatedAt: timestamp,
      members: [{ id: `lead:${lead.id}`, sessionId: lead.id, name: plan.leadName, role: "root lead and coordinator", ...mainSelection, kind: "lead", state: "running", createdAt: timestamp, updatedAt: timestamp }],
      tasks: plan.tasks.map((task) => ({ id: taskIds.get(task.key), title: task.title, ...(task.description === undefined ? {} : { description: task.description }), state: "pending", revision: 1, dependsOn: task.dependsOn.map((key) => taskIds.get(key)), files: task.files, attempt: 0, leaseEpoch: 0, attemptHistory: [], interruptionHistory: [], lifecycleLedger: [], capabilities: [], externalEffects: [], createdAt: timestamp, updatedAt: timestamp })),
      messages: [],
      bootstrap: { requestId: plan.requestId, inputHash: plan.inputHash, phase: "prepared", taskRefs: plan.tasks.map((task) => ({ key: task.key, taskId: taskIds.get(task.key) })), memberRefs: plan.members.map((member) => ({ key: member.key, name: member.name, status: "pending" })), createdAt: timestamp, updatedAt: timestamp },
    };
    const bootstrapPlanHash = teamPlanHash(team);
    team.plan = {
      phase: "active", revision: 1, hash: bootstrapPlanHash, committedAt: timestamp, activatedAt: timestamp, migrationState: "ready",
      authorization: { source: "human_attested", attestedAt: timestamp, confirmedPlanHash: bootstrapPlanHash, permissions: "human_attested", files: "human_attested", cost: "human_attested", externalSideEffects: "human_attested" },
    };
    if (autopilotGrant !== undefined) team.autopilot = autopilotGrant;
    document.teams.push(team);
    if (input.routingReceiptId !== undefined) finalizeRoutingReceiptForTeam(document, input.routingReceiptId, team, "created");
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
    await drainContinuableChildrenWithDeadline(ctx, lead, [cleanup.childId]);
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
      bumpTaskRevision(task);
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
function managedMemberToolGuard(store, execution) {
  const sessionId = execution?.agent?.id;
  if (typeof sessionId !== "string" || !MANAGED_MEMBER_DENIED_TOOL_NAMES.has(execution?.name)) return undefined;
  if (!PROVISIONING_MEMBER_SESSION_IDS.has(sessionId) && !store.hasManagedMember(sessionId)) return undefined;
  return `managed Agent Team members cannot call ${execution.name}; request a visible peer through team_expansion_request instead`;
}
async function withProvisioningMemberSession(sessionId, operation) {
  PROVISIONING_MEMBER_SESSION_IDS.add(sessionId);
  try { return await operation(); }
  finally { PROVISIONING_MEMBER_SESSION_IDS.delete(sessionId); }
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
    assertSpawnWorkspacePreflight(team, lead, tasks);
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
      bumpTaskRevision(task);
    }
    team.updatedAt = timestamp;
    return reservation;
  }));
  return queueTeamOperation(store.filePath, reservation.teamId, async () => withProvisioningMemberSession(reservation.childId, async () => {
    const admitted = await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const record = team.members.find((candidate) => candidate.id === reservation.memberId);
      if (effectiveTeamState(team) === "active" && record?.sessionId === reservation.placeholderSessionId && record.state === "provisioning") return true;
      if (record !== undefined) {
        confirmMemberRetired(record);
        for (const task of team.tasks) if (task.state === "pending" && task.assigneeSessionId === reservation.placeholderSessionId) {
          task.assigneeSessionId = undefined;
          task.updatedAt = record.updatedAt;
          bumpTaskRevision(task);
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
          bumpTaskRevision(task);
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
          bumpTaskRevision(task);
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
        return queueAgentTeamPrompt(ctx.subagents, lead, started.childId, textContent(workPrompt(reservation.teamId, reservation.memberId, reservation.prompt, reservation.taskIds)), { source: relaySource(lead.id), signal });
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
      if (bindAgentTeamAutopilotPlan(team, ctx.goals?.get?.(lead))) team.updatedAt = now();
      return { teamId: team.id, member: clone(current ?? member), plan: clone(team.plan) };
    }));
  }));
}

function memberRecoveryInputHash(input) {
  return createHash("sha256").update(JSON.stringify({
    action: input.action,
    teamId: input.teamId,
    memberId: input.memberId,
    expectedRevision: input.expectedRevision,
  })).digest("hex");
}
function memberRecoveryPrompt(team, member, tasks, action) {
  const taskLines = tasks.map((task) => {
    const checkpoint = task.checkpoint?.text ?? task.nextStep?.text;
    return `- ${task.id}: ${task.title}${checkpoint === undefined ? "" : `\n  Recovery context (unverified): ${checkpoint.slice(0, 1_200)}`}`;
  }).join("\n");
  return [
    `Direct-human member recovery (${action}) for Agent Team ${team.id}.`,
    `Continue only the durable tasks listed below. Inspect their current Host state before writing.`,
    taskLines,
    `Do not create hidden subagents or a nested team. Preserve claimId/leaseEpoch for retry; replacement must claim each pending task before work.`,
    `When the deliverable is finished, explicitly complete the durable task with its current claimId and leaseEpoch before reporting.`,
  ].join("\n").slice(0, 16_384);
}
function replacementMemberName(team, original) {
  const basePoints = [...canonicalMemberName(original.name)].slice(0, 7).join("");
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const candidate = normalizeWorkerName(`${basePoints}${suffix === 1 ? "续作" : `续作${suffix}`}`);
    if ([...candidate].length < 2 || [...candidate].length > 12) continue;
    if (!team.members.some((member) => memberNameKey(member.name) === memberNameKey(candidate))) return candidate;
  }
  reject("unable to allocate a unique replacement duty name", "AGENT_TEAMS_MEMBER_LIMIT");
}
function memberRecoveryFailureCode(error) {
  return typeof error?.code === "string" ? error.code : "AGENT_TEAMS_MEMBER_RECOVERY_FAILED";
}
function memberRecoveryPublic(team, receipt, teams) {
  return { teamId: team.id, recovery: clone(receipt), team: projectTeam(team, teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId || candidate.id === team.id)) };
}
function compactMemberRecoveryReceipts(team) {
  team.memberRecoveries ??= [];
  while (team.memberRecoveries.length >= MAX_MEMBER_RECOVERY_RECEIPTS) {
    const index = team.memberRecoveries.findIndex((receipt) => receipt.status === "delivered" || receipt.status === "failed");
    if (index < 0) reject("member recovery receipt capacity is occupied by unresolved attempts; reconcile an exact receipt first", "AGENT_TEAMS_RECOVERY_RECEIPT_LIMIT");
    team.memberRecoveries.splice(index, 1);
  }
}
function memberRecoveryDeliveryProof(team, receipt, sessionId) {
  const expectedClaims = receipt.action === "retry" ? new Map(receipt.activeClaims.map((claim) => [claim.taskId, claim])) : new Map();
  const tasks = [];
  for (const taskId of receipt.taskIds) {
    const task = team.tasks.find((candidate) => candidate.id === taskId), expected = expectedClaims.get(taskId);
    if (task === undefined || task.assigneeSessionId !== sessionId) return undefined;
    if (task.state === "pending") {
      if (expected !== undefined || task.claimId !== undefined || task.submission !== undefined) return undefined;
    } else if (task.state === "in_progress") {
      if (typeof task.claimId !== "string" || task.leaseEpoch !== receipt.pauseEpoch || expected !== undefined && (task.claimId !== expected.claimId || task.leaseEpoch !== expected.leaseEpoch)) return undefined;
    } else if (["submitted", "completed"].includes(task.state)) {
      if (task.submission?.source !== "explicit_complete" || !taskSubmissionMatches(task) || task.leaseEpoch !== receipt.pauseEpoch || expected !== undefined && (task.claimId !== expected.claimId || task.leaseEpoch !== expected.leaseEpoch)) return undefined;
    } else return undefined;
    tasks.push(task);
  }
  return { tasks, memberState: tasks.some((task) => task.state === "in_progress") ? "running" : tasks.some((task) => task.state === "pending") ? "ready" : "idle" };
}
function finalizeMemberRecoveryDelivery(document, team, receipt) {
  requireActiveTeam(team);
  if (receipt.status !== "outcome_unknown" || receipt.phase !== "followup_returned" || (team.pauseEpoch ?? 0) !== receipt.pauseEpoch) reject("member recovery delivery cannot be finalized from this durable phase", "AGENT_TEAMS_STALE_LEASE");
  const timestamp = now(), sessionId = receipt.action === "retry" ? receipt.sessionId : receipt.replacementSessionId, proof = memberRecoveryDeliveryProof(team, receipt, sessionId);
  if (proof === undefined) reject("member recovery tasks no longer prove delivery by the exact session, claim, and lease", "AGENT_TEAMS_TASK_CONFLICT");
  const member = team.members.find((candidate) => candidate.id === (receipt.action === "retry" ? receipt.memberId : receipt.replacementMemberId));
  if (member?.sessionId !== sessionId || !["failed", "running", "ready", "idle"].includes(member.state)) reject("member recovery publication changed after delivery", "AGENT_TEAMS_STALE_LEASE");
  member.state = proof.memberState; member.error = undefined; member.updatedAt = timestamp;
  receipt.status = "delivered"; receipt.updatedAt = timestamp; team.updatedAt = timestamp;
  return memberRecoveryPublic(team, receipt, document.teams);
}
function rollbackUnstartedReplacement(team, receipt, timestamp) {
  const original = team.members.find((member) => member.id === receipt.memberId);
  const replacement = team.members.find((member) => member.id === receipt.replacementMemberId);
  if (original !== undefined) { original.state = "failed"; original.updatedAt = timestamp; }
  if (replacement !== undefined) team.members = team.members.filter((member) => member.id !== replacement.id);
  for (const taskId of receipt.taskIds) {
    const task = team.tasks.find((candidate) => candidate.id === taskId);
    if (task !== undefined && task.state === "pending") { task.assigneeSessionId = original?.sessionId; task.updatedAt = timestamp; bumpTaskRevision(task); }
  }
}
async function recoverFailedMember(ctx, store, admission, lead, input, signal) {
  const action = assertEnum(input.action, MEMBER_RECOVERY_ACTIONS, "action") ?? input.action;
  const requestId = nonEmptyString(input.requestId, "requestId", 256), teamId = nonEmptyString(input.teamId, "teamId", 256), memberId = nonEmptyString(input.memberId, "memberId", 256);
  const expectedRevision = positiveInteger(input.expectedRevision, "expectedRevision");
  const inputHash = memberRecoveryInputHash({ action, teamId, memberId, expectedRevision });
  return queueTeamOperation(store.filePath, teamId, async () => {
    const prepared = await store.runOperation(() => store.mutate((document) => {
      assertEnabled(document);
      const team = findTeam(document, teamId); requireLiveRootLead(ctx, team, lead); requireActiveTeam(team);
      team.memberRecoveries ??= [];
      const replay = team.memberRecoveries.find((receipt) => receipt.requestId === requestId);
      if (replay !== undefined) {
        if (replay.inputHash !== inputHash) reject("member recovery request_id was reused with different input", "AGENT_TEAMS_RECOVERY_REPLAY_CONFLICT");
        return { replay: true, receipt: clone(replay) };
      }
      if (team.memberRecoveries.some((receipt) => receipt.memberId === memberId && ["prepared", "outcome_unknown"].includes(receipt.status))) reject("a prior member recovery is unresolved; reconcile the exact receipt before another attempt", "AGENT_TEAMS_RECOVERY_OUTCOME_UNKNOWN");
      if (team.revision !== expectedRevision) reject("team changed before member recovery; refresh and confirm again", "AGENT_TEAMS_STALE_TEAM");
      const member = team.members.find((candidate) => candidate.id === memberId);
      if (member?.kind !== "worker" || member.state !== "failed") reject("only an exact failed worker may be recovered", "AGENT_TEAMS_MEMBER_NOT_FAILED");
      const tasks = team.tasks.filter((task) => task.assigneeSessionId === member.sessionId && !taskIsTerminal(task));
      if (tasks.length === 0) reject("failed member has no unfinished durable task to recover", "AGENT_TEAMS_TASK_BINDING_REQUIRED");
      const activeTasks = tasks.filter((task) => task.state === "in_progress");
      if (team.tasks.some((task) => (task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown"))) reject("team recovery is blocked by an external effect with outcome_unknown", "AGENT_TEAMS_OUTCOME_UNKNOWN");
      const otherActiveTasks = team.tasks.filter((task) => task.state === "in_progress" && task.assigneeSessionId !== member.sessionId);
      for (const task of tasks) for (const file of task.files ?? []) for (const other of otherActiveTasks) for (const otherFile of other.files ?? []) if (fileBoundaryOverlap(file, otherFile)) reject(`member recovery file scope conflicts with active task ${other.id}`, "AGENT_TEAMS_FILE_CONFLICT");
      assertTaskExecutionPreflight(team, tasks);
      if (!["host_verified", "human_attested"].includes(team.plan.authorization?.cost)) reject("member route cost is unknown; recommit the exact plan hash", "AGENT_TEAMS_COST_UNKNOWN");
      if (action === "retry" && activeTasks.length !== 1) reject("same-session retry requires exactly one unchanged active claim; pending assigned tasks are preserved", "AGENT_TEAMS_STALE_CLAIM");
      for (const task of activeTasks) if (typeof task.claimId !== "string" || task.leaseEpoch !== (team.pauseEpoch ?? 0)) reject("failed member task claim is stale or malformed", "AGENT_TEAMS_STALE_CLAIM");
      if (activeWorkerTurnsForLead(document, team.rootLeadSessionId) >= document.settings.maxActiveTurns) reject("root lead active-turn limit reached across its teams", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
      if (action === "replace" && team.members.filter(workerConsumesMemberSlot).length > document.settings.maxMembers) reject("team teammate limit is not safely known", "AGENT_TEAMS_MEMBER_LIMIT");
      const timestamp = now();
      const receipt = { requestId, inputHash, action, status: "prepared", phase: "prepared", memberId: member.id, sessionId: member.sessionId, taskIds: tasks.map((task) => task.id), activeTaskIds: activeTasks.map((task) => task.id), activeClaims: activeTasks.map((task) => ({ taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch })), createdAt: timestamp, updatedAt: timestamp, pauseEpoch: team.pauseEpoch ?? 0, teamRevision: team.revision };
      if (action === "replace") {
        const replacementMemberId = randomUUID(), childId = randomUUID(), placeholderSessionId = `provisioning:${replacementMemberId}`, name = replacementMemberName(team, member);
        const replacement = { id: replacementMemberId, sessionId: placeholderSessionId, name, role: member.role, ...(member.model === undefined ? {} : { model: member.model }), ...(member.provider === undefined ? {} : { provider: member.provider }), modelTier: member.modelTier ?? "subagent", inheritsMain: member.inheritsMain === true, routeSource: member.routeSource ?? "recovery-inherited", kind: "worker", state: "provisioning", createdAt: timestamp, updatedAt: timestamp };
        receipt.replacementMemberId = replacementMemberId; receipt.replacementSessionId = childId;
        member.state = "retired"; member.runId = undefined; member.updatedAt = timestamp; member.error = member.error ?? "failed member replaced by direct-human recovery";
        for (const task of tasks) {
          boundedPush(task.interruptionHistory, { kind: "member_replaced", at: timestamp, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, reason: `recovery request ${requestId}` }, MAX_TASK_INTERRUPTION_HISTORY);
          task.state = "pending"; task.assigneeSessionId = placeholderSessionId; task.claimedAt = undefined; task.claimId = undefined; clearTaskTerminalMetadata(task); task.releasedAt = timestamp; task.releaseReason = "failed member replaced by explicit direct-human recovery; prior claim and lease revoked"; task.updatedAt = timestamp; bumpTaskRevision(task);
        }
        team.members.push(replacement);
      }
      compactMemberRecoveryReceipts(team); team.memberRecoveries.push(receipt); team.updatedAt = timestamp;
      return { replay: false, receipt: clone(receipt) };
    }));
    let provisioningSessionId;
    if (prepared.replay && ["delivered", "failed"].includes(prepared.receipt.status)) {
      const document = await store.read((current) => current), team = findTeam(document, teamId);
      return memberRecoveryPublic(team, team.memberRecoveries.find((receipt) => receipt.requestId === requestId), document.teams);
    }
    if (prepared.replay && prepared.receipt.status === "outcome_unknown") {
      if (prepared.receipt.action === "retry" && prepared.receipt.phase === "followup_returned") return store.runOperation(() => store.mutate((document) => { const team = findTeam(document, teamId), receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(document, team, receipt); }));
      const child = prepared.receipt.action === "replace" ? ctx.agents.get(prepared.receipt.replacementSessionId) : undefined;
      const resumable = prepared.receipt.action === "replace" && (["drain_started"].includes(prepared.receipt.phase) || (["start_dispatched", "child_started", "published", "followup_returned"].includes(prepared.receipt.phase) && child !== undefined));
      if (!resumable) {
        const document = await store.read((current) => current), team = findTeam(document, teamId);
        return memberRecoveryPublic(team, team.memberRecoveries.find((receipt) => receipt.requestId === requestId), document.teams);
      }
      provisioningSessionId = prepared.receipt.replacementSessionId;
      PROVISIONING_MEMBER_SESSION_IDS.add(provisioningSessionId);
    }
    try {
      if (action === "retry") {
        const marked = await store.runOperation(() => store.mutate((document) => {
          const team = findTeam(document, teamId); requireActiveTeam(team);
          const receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
          if (receipt.status === "prepared") { receipt.status = "outcome_unknown"; receipt.phase = "retry_dispatching"; receipt.updatedAt = now(); team.updatedAt = receipt.updatedAt; }
          return clone(receipt);
        }));
        if (marked.phase !== "retry_dispatching") return memberRecoveryPublic(findTeam(await store.read((current) => current), teamId), marked, (await store.read((current) => current)).teams);
        const document = await store.read((current) => current), team = findTeam(document, teamId), member = team.members.find((candidate) => candidate.id === memberId), tasks = marked.taskIds.map((taskId) => team.tasks.find((task) => task.id === taskId)).filter(Boolean);
        await runWithLifecycleDeadline(
          (lifecycleSignal) => admission.run(lead, marked.sessionId, lifecycleSignal, async () => { requireExactRootAgent(ctx, lead); return queueAgentTeamPrompt(ctx.subagents, lead, marked.sessionId, textContent(memberRecoveryPrompt(team, member, tasks, action)), { source: relaySource(lead.id), signal: lifecycleSignal }); }),
          { signal, label: "failed member retry" },
        );
        await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam);
          const receipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), liveMember = liveTeam.members.find((candidate) => candidate.id === memberId);
          if (receipt.status !== "outcome_unknown" || receipt.phase !== "retry_dispatching" || liveMember?.sessionId !== receipt.sessionId || !["failed", "running", "ready", "idle"].includes(liveMember.state) || (liveTeam.pauseEpoch ?? 0) !== receipt.pauseEpoch || memberRecoveryDeliveryProof(liveTeam, receipt, receipt.sessionId) === undefined) reject("exact retry session, task claim, or lease changed after delivery", "AGENT_TEAMS_STALE_LEASE");
          receipt.phase = "followup_returned"; receipt.updatedAt = now(); liveTeam.updatedAt = receipt.updatedAt;
        }));
        return store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId), receipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(current, liveTeam, receipt); }));
      }
      let document = await store.read((current) => current), team = findTeam(document, teamId), receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      provisioningSessionId = receipt.replacementSessionId;
      PROVISIONING_MEMBER_SESSION_IDS.add(provisioningSessionId);
      let started = ctx.agents.get(receipt.replacementSessionId);
      if (["prepared", "drain_started"].includes(receipt.phase)) {
        await store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); liveReceipt.status = "outcome_unknown"; liveReceipt.phase = "drain_started"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }));
        await drainContinuableChildrenWithDeadline(ctx, lead, [receipt.sessionId], signal);
        await store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); liveReceipt.phase = "start_dispatched"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }));
        document = await store.read((current) => current); team = findTeam(document, teamId); receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId); started = ctx.agents.get(receipt.replacementSessionId);
      }
      if (started === undefined && receipt.phase === "start_dispatched") {
        started = await runWithLifecycleDeadline(
          (lifecycleSignal) => admission.run(lead, receipt.replacementSessionId, lifecycleSignal, async () => { requireExactRootAgent(ctx, lead); const replacement = team.members.find((candidate) => candidate.id === receipt.replacementMemberId); return ctx.subagents.startContinuable({ childId: receipt.replacementSessionId, provider: "spawn", label: replacement.name, request: { parent: lead, prompt: textContent(registrationPrompt(team.id, replacement.name, replacement.role)), ...(replacement.provider === undefined && replacement.model === undefined ? {} : { agentOptions: { ...(replacement.provider === undefined ? {} : { provider: replacement.provider }), ...(replacement.model === undefined ? {} : { model: replacement.model }) } }) }, signal: lifecycleSignal }); }),
          { signal, label: "replacement member start" },
        );
      }
      if (started === undefined) return memberRecoveryPublic(team, receipt, document.teams);
      const startedId = started.childId ?? started.id;
      if (startedId !== receipt.replacementSessionId) reject("replacement provider returned a different child id", "AGENT_TEAMS_CONFLICT");
      if (["start_dispatched", "child_started", "published", "followup_returned"].includes(receipt.phase)) {
        await store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); if (liveReceipt.phase === "start_dispatched") { liveReceipt.phase = "child_started"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; } }));
        const published = await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId);
          if (liveReceipt.status !== "outcome_unknown" || !["provisioning", "running", "ready", "idle", "failed"].includes(replacement?.state) || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch) reject(`team changed during replacement publication (status=${liveReceipt.status}, phase=${liveReceipt.phase}, member=${replacement?.state ?? "missing"}, pause=${liveTeam.pauseEpoch ?? 0}/${liveReceipt.pauseEpoch})`, "AGENT_TEAMS_STALE_LEASE");
          if (["provisioning", "ready", "idle", "failed"].includes(replacement.state)) { replacement.sessionId = startedId; replacement.state = "running"; replacement.publishedAt = now(); replacement.updatedAt = replacement.publishedAt; for (const taskId of liveReceipt.taskIds) { const task = liveTeam.tasks.find((candidate) => candidate.id === taskId); if (task?.state !== "pending" || ![startedId, `provisioning:${replacement.id}`, undefined].includes(task.assigneeSessionId)) reject("replacement task pre-binding changed", "AGENT_TEAMS_TASK_CONFLICT"); task.assigneeSessionId = startedId; task.leaseEpoch = liveReceipt.pauseEpoch; task.updatedAt = replacement.updatedAt; bumpTaskRevision(task); } }
          if (["start_dispatched", "child_started"].includes(liveReceipt.phase)) liveReceipt.phase = "published"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; return { team: clone(liveTeam), receipt: clone(liveReceipt) };
        }));
        team = published.team; receipt = published.receipt;
      }
      if (receipt.phase === "followup_returned") return store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(current, liveTeam, liveReceipt); }));
      if (receipt.phase === "published") {
        await store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); liveReceipt.phase = "followup_dispatching"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }));
        const replacement = team.members.find((candidate) => candidate.id === receipt.replacementMemberId), tasks = receipt.taskIds.map((taskId) => team.tasks.find((task) => task.id === taskId)).filter(Boolean);
        await runWithLifecycleDeadline(
          (lifecycleSignal) => admission.run(lead, startedId, lifecycleSignal, async () => queueAgentTeamPrompt(ctx.subagents, lead, startedId, textContent(memberRecoveryPrompt(team, replacement, tasks, action)), { source: relaySource(lead.id), signal: lifecycleSignal })),
          { signal, label: "replacement member followup" },
        );
        await store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); if (liveReceipt.status !== "outcome_unknown" || liveReceipt.phase !== "followup_dispatching" || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch) reject("team changed during replacement followup", "AGENT_TEAMS_STALE_LEASE"); liveReceipt.phase = "followup_returned"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }));
        return store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(current, liveTeam, liveReceipt); }));
      }
      document = await store.read((current) => current); team = findTeam(document, teamId); return memberRecoveryPublic(team, team.memberRecoveries.find((candidate) => candidate.requestId === requestId), document.teams);
    } catch (error) {
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, teamId), receipt = team.memberRecoveries?.find((candidate) => candidate.requestId === requestId); if (receipt === undefined || receipt.status !== "outcome_unknown") return;
        receipt.errorCode = memberRecoveryFailureCode(error); receipt.errorStage = receipt.phase; receipt.errorMessage = String(error).slice(0, 4_096); receipt.updatedAt = now();
        const childExists = action === "replace" && receipt.replacementSessionId !== undefined && ctx.agents.get(receipt.replacementSessionId) !== undefined;
        if (action === "replace" && !childExists && receipt.phase === "drain_started") {
          receipt.status = "failed"; receipt.phase = "reconciled"; rollbackUnstartedReplacement(team, receipt, receipt.updatedAt);
          const original = team.members.find((candidate) => candidate.id === receipt.memberId);
          if (original !== undefined && error?.code === "AGENT_TEAMS_LIFECYCLE_TIMEOUT") {
            original.state = "failed";
            original.shutdownUnconfirmed = true;
            original.stopUnconfirmed = true;
            original.error = "replacement could not confirm that the previous member stopped before the lifecycle deadline";
            original.updatedAt = receipt.updatedAt;
          }
        }
        team.updatedAt = receipt.updatedAt;
      }));
      throw error;
    } finally {
      if (provisioningSessionId !== undefined) PROVISIONING_MEMBER_SESSION_IDS.delete(provisioningSessionId);
    }
  });
}

async function reconcileMemberRecovery(ctx, store, lead, input) {
  const teamId = nonEmptyString(input.teamId, "teamId", 256), requestId = nonEmptyString(input.requestId, "requestId", 256), resolution = assertEnum(input.resolution, ["delivered", "not_delivered"], "resolution") ?? input.resolution;
  const expectedRevision = positiveInteger(input.expectedRevision, "expectedRevision");
  return queueTeamOperation(store.filePath, teamId, async () => {
    let document = await store.read((current) => current), team = findTeam(document, teamId); requireLiveRootLead(ctx, team, lead); if (team.state === "closed" || team.state === "closing") reject("closed team recovery cannot be reconciled", "AGENT_TEAMS_NOT_FOUND");
    let receipt = team.memberRecoveries?.find((candidate) => candidate.requestId === requestId); if (receipt === undefined) reject("member recovery receipt is unavailable", "AGENT_TEAMS_NOT_FOUND");
    if (receipt.status !== "outcome_unknown") return memberRecoveryPublic(team, receipt, document.teams);
    if (team.revision !== expectedRevision) reject("team changed before recovery reconciliation; refresh the durable receipt", "AGENT_TEAMS_STALE_TEAM");
    if (team.state === "paused" && resolution !== "not_delivered") reject("paused recovery can only be reconciled as not delivered", "AGENT_TEAMS_PAUSED");
    if (receipt.action === "replace" && resolution === "not_delivered") {
      const binding = await store.runOperation(() => store.mutate((current) => {
        const liveTeam = findTeam(current, teamId); requireLiveRootLead(ctx, liveTeam, lead); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId);
        if (liveReceipt.status !== "outcome_unknown" || replacement === undefined) reject("replacement recovery receipt changed before reconciliation", "AGENT_TEAMS_CONFLICT");
        const placeholder = `provisioning:${replacement.id}`, childId = liveReceipt.replacementSessionId;
        for (const taskId of liveReceipt.taskIds) { const task = liveTeam.tasks.find((candidate) => candidate.id === taskId); if (task?.state !== "pending" || ![undefined, placeholder, childId].includes(task.assigneeSessionId)) reject("replacement task changed before not-delivered reconciliation", "AGENT_TEAMS_TASK_CONFLICT"); if (task.assigneeSessionId === undefined) { task.assigneeSessionId = childId ?? placeholder; task.updatedAt = now(); bumpTaskRevision(task); } }
        liveTeam.updatedAt = now(); return { childId, placeholder, replacementMemberId: liveReceipt.replacementMemberId };
      }));
      if (binding.childId !== undefined && ctx.agents.get(binding.childId) !== undefined) {
        try { await drainContinuableChildrenWithDeadline(ctx, lead, [binding.childId]); }
        catch (error) {
          await store.runOperation(() => store.mutate((current) => {
            const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
            const replacement = liveTeam.members.find((candidate) => candidate.id === binding.replacementMemberId);
            if (replacement !== undefined && replacement.state !== "retired") {
              replacement.state = "failed"; replacement.shutdownUnconfirmed = true; replacement.stopUnconfirmed = true;
              replacement.error = `replacement reconciliation could not confirm shutdown: ${String(error)}`; replacement.updatedAt = now();
            }
            if (liveReceipt?.status === "outcome_unknown") {
              liveReceipt.errorCode = memberRecoveryFailureCode(error); liveReceipt.errorStage = liveReceipt.phase;
              liveReceipt.errorMessage = String(error).slice(0, 4_096); liveReceipt.updatedAt = now();
            }
            liveTeam.updatedAt = now();
          }));
          throw error;
        }
      }
    }
    return store.runOperation(() => store.mutate((current) => {
      const liveTeam = findTeam(current, teamId); requireLiveRootLead(ctx, liveTeam, lead); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      if (liveReceipt.status !== "outcome_unknown") return memberRecoveryPublic(liveTeam, liveReceipt, current.teams);
      const timestamp = now();
      if (resolution === "delivered") {
        requireActiveTeam(liveTeam);
        const sessionId = liveReceipt.action === "retry" ? liveReceipt.sessionId : liveReceipt.replacementSessionId, member = liveTeam.members.find((candidate) => candidate.id === (liveReceipt.action === "retry" ? liveReceipt.memberId : liveReceipt.replacementMemberId));
        if (liveReceipt.action === "replace") {
          const childExists = sessionId !== undefined && ctx.agents.get(sessionId) !== undefined;
          if (!childExists || !["followup_dispatching", "followup_returned"].includes(liveReceipt.phase)) reject("replacement delivery cannot be proven from the durable published child", "AGENT_TEAMS_RECOVERY_UNPROVEN");
        }
        const proof = memberRecoveryDeliveryProof(liveTeam, liveReceipt, sessionId);
        if (member?.sessionId !== sessionId || !["failed", "running", "ready", "idle"].includes(member?.state) || proof === undefined) reject("delivery cannot be reconciled because the exact session, claim, lease, or submission changed", "AGENT_TEAMS_STALE_CLAIM");
        member.state = proof.memberState; member.error = undefined; member.updatedAt = timestamp;
        liveReceipt.status = "delivered";
      } else {
        if (liveReceipt.action === "replace") {
          const replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId); if (replacement === undefined) reject("replacement disappeared before not-delivered reconciliation", "AGENT_TEAMS_CONFLICT"); const placeholder = `provisioning:${replacement.id}`;
          for (const taskId of liveReceipt.taskIds) { const task = liveTeam.tasks.find((candidate) => candidate.id === taskId); if (task?.state !== "pending" || ![placeholder, liveReceipt.replacementSessionId].includes(task.assigneeSessionId)) reject("replacement task changed after drain; recovery remains unresolved", "AGENT_TEAMS_TASK_CONFLICT"); }
          rollbackUnstartedReplacement(liveTeam, liveReceipt, timestamp);
        } else { const member = liveTeam.members.find((candidate) => candidate.id === liveReceipt.memberId); if (member !== undefined) { member.state = "failed"; member.updatedAt = timestamp; } }
        liveReceipt.status = "failed";
      }
      liveReceipt.phase = "reconciled"; liveReceipt.resolution = resolution; liveReceipt.reconciledAt = timestamp; liveReceipt.reconciledBy = lead.id; liveReceipt.updatedAt = timestamp; liveTeam.updatedAt = timestamp;
      return memberRecoveryPublic(liveTeam, liveReceipt, current.teams);
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
        return queueAgentTeamPrompt(ctx.subagents, lead, prepared.recipient.sessionId, content, { source: relaySource(caller.id), signal });
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
      revision: 1,
      dependsOn: [...new Set(dependsOn)],
      ...(crossTeamDependsOn.length === 0 ? {} : { crossTeamDependsOn }),
      files: [...new Set(files.map((file) => nonEmptyString(file, "files item", 1_024)))],
      ...(assigneeSessionId === undefined ? {} : { assigneeSessionId }),
      attempt: 0,
      leaseEpoch: team.pauseEpoch ?? 0,
      attemptHistory: [],
      interruptionHistory: [],
      lifecycleLedger: [],
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
    bumpTaskRevision(task);
    team.updatedAt = effect.updatedAt;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), effect: clone(effect), deliveryGuarantee: "host_effect_key_available_no_exactly_once_claim" };
  });
}

function bumpTaskRevision(task) {
  const current = task.revision === undefined ? 1 : positiveInteger(task.revision, "task.revision");
  task.revision = current + 1;
  return task.revision;
}
function normalizedFixedRootTaskCommand(team, task, action, requestedState, input) {
  const requestId = nonEmptyString(input.requestId, "requestId", 256);
  const expectedTaskRevision = positiveInteger(input.expectedTaskRevision, "expectedTaskRevision");
  const expectedPauseEpoch = positiveInteger(input.expectedPauseEpoch, "expectedPauseEpoch", { allowZero: true });
  const assigneeSelector = action === "assign" ? nonEmptyString(input.assigneeSessionId, "assigneeSessionId", 256) : undefined;
  const canonical = {
    teamId: team.id,
    taskId: task.id,
    action,
    expectedTaskRevision,
    expectedPauseEpoch,
    ...(requestedState === undefined ? {} : { state: requestedState }),
    ...(assigneeSelector === undefined ? {} : { assigneeSessionId: assigneeSelector }),
  };
  return { requestId, expectedTaskRevision, expectedPauseEpoch, assigneeSelector, inputHash: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}
function prepareFixedRootTaskCommand(team, task, action, requestedState, input, document, required) {
  if (!required) return undefined;
  const command = normalizedFixedRootTaskCommand(team, task, action, requestedState, input);
  const replay = (team.taskCommandReceipts ?? []).find((receipt) => receipt.requestId === command.requestId);
  if (replay !== undefined) {
    if (replay.inputHash !== command.inputHash) reject("task command request_id was reused with different canonical input", "AGENT_TEAMS_TASK_COMMAND_REPLAY_CONFLICT");
    return { replay: { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), reused: true, operation: clone(replay) } };
  }
  return command;
}
function validateNewFixedRootTaskCommand(team, task, action, command) {
  if (command === undefined) return undefined;
  if (command.expectedPauseEpoch !== (team.pauseEpoch ?? 0)) reject("expected_pause_epoch is missing or stale", "AGENT_TEAMS_STALE_LEASE");
  if (command.expectedTaskRevision !== task.revision) reject("expected_task_revision is missing or stale", "AGENT_TEAMS_STALE_TASK_REVISION");
  if ((team.taskCommandReceipts ?? []).length >= MAX_TASK_COMMAND_RECEIPTS) reject("task command receipt limit reached; archive the team before issuing another destructive command", "AGENT_TEAMS_TASK_COMMAND_RECEIPT_LIMIT");
  if (action === "assign") return { ...command, assigneeSessionId: requireAssignableMember(resolveMember(team, command.assigneeSelector)).sessionId };
  return command;
}
function recordFixedRootTaskCommand(team, task, action, command, createdAt) {
  if (command === undefined) return undefined;
  const receipt = {
    requestId: command.requestId,
    inputHash: command.inputHash,
    taskId: task.id,
    action,
    taskRevisionBefore: command.expectedTaskRevision,
    taskRevisionAfter: task.revision,
    pauseEpoch: command.expectedPauseEpoch,
    createdAt,
  };
  team.taskCommandReceipts ??= [];
  team.taskCommandReceipts.push(receipt);
  return receipt;
}

async function updateTask(store, caller, input) {
  return store.mutate((document) => {
    assertEnabled(document);
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    const task = team.tasks.find((candidate) => candidate.id === nonEmptyString(input.taskId, "taskId", 256));
    if (task === undefined) reject("unknown team task", "AGENT_TEAMS_NOT_FOUND");
    const isLead = caller.id === team.rootLeadSessionId;
    const requestedState = optionalString(input.state, "state", 32);
    if (requestedState !== undefined) assertEnum(requestedState, MUTABLE_TASK_STATES, "state");
    if (input.requireFixedRootCommand === true && isLead && input.action === undefined) reject("public fixed-root task updates require an explicit action", "AGENT_TEAMS_INVALID_TASK");
    if (input.action === undefined && requestedState === undefined) reject("task update requires action or state", "AGENT_TEAMS_INVALID_TASK");
    const action = input.action ?? (requestedState === "in_progress" ? "claim" : requestedState === "completed" ? "complete" : taskIsTerminal(task) ? "reopen" : "release");
    assertEnum(action, ["claim", "release", "complete", "accept", "reject", "cancel", "reopen", "assign", "unassign"], "action");
    if (input.requireFixedRootCommand === true && FIXED_ROOT_TASK_COMMANDS.has(action) && action !== "release" && !isLead) reject("fixed-root task commands require the team root lead", "AGENT_TEAMS_UNAUTHORIZED");
    const fixedRootCommandRequired = input.requireFixedRootCommand === true && FIXED_ROOT_TASK_COMMANDS.has(action) && (action !== "release" || isLead);
    let fixedRootCommand = prepareFixedRootTaskCommand(team, task, action, requestedState, input, document, fixedRootCommandRequired);
    if (fixedRootCommand?.replay !== undefined) return fixedRootCommand.replay;
    requireActiveTeam(team);
    fixedRootCommand = validateNewFixedRootTaskCommand(team, task, action, fixedRootCommand);
    const blockedBy = deriveTaskAcrossTeams(task, team, document.teams).blockedBy;
    let fixedRootNoOp = false;
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
      appendTaskLifecycleEvent(task, { kind: "claim", at: claimedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: caller.id });
      if (team.plan?.phase === "committed") {
        team.plan.phase = "active";
        team.plan.activatedAt = claimedAt;
      }
      // A prior attempt's checkpoint remains explicitly unverified recovery context
      // until this claimant replaces it; fencing metadata keeps its origin visible.
      clearTaskTerminalMetadata(task);
          } else if (action === "complete") {
      if (["submitted", "completed"].includes(task.state)) {
        if (task.assigneeSessionId !== caller.id) reject("only the original claimant may replay task submission; the lead must use accept", "AGENT_TEAMS_UNAUTHORIZED");
        assertCurrentTaskLease(team, task, caller, input, { leadMayOverride: false });
        if (!taskSubmissionMatches(task)) reject("submitted task has no current task-scoped submission fact", "AGENT_TEAMS_DELIVERY_REQUIRED");
        return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), reused: true };
      }
      if (task.state !== "in_progress") reject(`only an in-progress task can submit completion (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (task.assigneeSessionId !== caller.id) reject("only the exact task claimant may submit completion; the lead cannot complete a foreign claim", "AGENT_TEAMS_UNAUTHORIZED");
      assertCurrentTaskLease(team, task, caller, input, { leadMayOverride: false });
      if ((task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown")) reject("task is blocked by an unknown external side-effect outcome", "AGENT_TEAMS_OUTCOME_UNKNOWN");
      if (blockedBy.length > 0) reject(`task is blocked by: ${blockedBy.join(", ")}`, "AGENT_TEAMS_TASK_BLOCKED");
      const submittedAt = now();
      task.state = "submitted";
      task.completedAt = undefined;
      task.submission = taskSubmission(task, caller.id, submittedAt);
      task.acceptance = undefined;
      appendTaskLifecycleEvent(task, { kind: "submission", at: submittedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: caller.id });
      task.cancelledAt = undefined;
      task.cancellationReason = undefined;
          } else if (action === "accept") {
      if (!isLead) reject("only the fixed root lead may accept a submitted task", "AGENT_TEAMS_UNAUTHORIZED");
      if (task.state === "completed" && taskAcceptanceMatches(task)) {
        if (fixedRootCommand === undefined) return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), reused: true };
        fixedRootNoOp = true;
      } else {
        if (task.state !== "submitted" || !taskSubmissionMatches(task)) reject("acceptance requires a current submitted task-scoped delivery", "AGENT_TEAMS_DELIVERY_REQUIRED");
        const acceptedAt = now();
        task.state = "completed";
        task.completedAt = acceptedAt;
        task.acceptance = { taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch, acceptedAt, acceptedBy: caller.id, ownerEpoch: team.pauseEpoch ?? 0 };
        appendTaskLifecycleEvent(task, { kind: "acceptance", at: acceptedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: caller.id, ownerEpoch: team.pauseEpoch ?? 0 });
      }
    } else if (action === "reject") {
      if (!isLead) reject("only the fixed root lead may reject a submitted task", "AGENT_TEAMS_UNAUTHORIZED");
      if (task.state !== "submitted" || !taskSubmissionMatches(task)) reject("rejection requires a current submitted task-scoped delivery", "AGENT_TEAMS_DELIVERY_REQUIRED");
      const rejectedAt = now();
      appendTaskLifecycleEvent(task, { kind: "reject", at: rejectedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: caller.id, reason: "rejected by the fixed root lead for another attempt" });
      task.state = "pending";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      task.claimId = undefined;
      clearTaskTerminalMetadata(task);
      task.releasedAt = rejectedAt;
      task.releaseReason = "submitted delivery rejected by the fixed root lead";
    } else if (action === "release") {
      if (task.state !== "in_progress") reject(`only an in-progress task can be released (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      if (!isLead && task.assigneeSessionId !== caller.id) reject("only the task claimant or team lead can release it", "AGENT_TEAMS_UNAUTHORIZED");
      assertCurrentTaskLease(team, task, caller, input);
      const releasedAt = now();
      boundedPush(task.interruptionHistory, { kind: "released", at: releasedAt, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0 }, MAX_TASK_INTERRUPTION_HISTORY);
      appendTaskLifecycleEvent(task, { kind: "release", at: releasedAt, attempt: task.attempt, claimId: task.claimId, leaseEpoch: task.leaseEpoch, actorId: caller.id });
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
      const cancelledAt = now();
      appendTaskLifecycleEvent(task, { kind: "cancel", at: cancelledAt, attempt: task.attempt ?? 0, ...(task.claimId === undefined ? {} : { claimId: task.claimId }), leaseEpoch: task.leaseEpoch ?? 0, actorId: caller.id, reason: "cancelled explicitly by the team lead" });
      clearTaskTerminalMetadata(task);
      task.state = "cancelled";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      task.completedAt = undefined;
      task.cancelledAt = cancelledAt;
      task.cancellationReason = "cancelled explicitly by the team lead";
          } else if (action === "reopen") {
      if (!isLead) reject("only the team lead can reopen a task", "AGENT_TEAMS_UNAUTHORIZED");
      if (!taskIsTerminal(task)) reject(`only a completed or cancelled task can be reopened (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      const progressed = progressedDependents(document, team.id, task.id);
      if (progressed.length > 0) reject(`cannot reopen a prerequisite used by progressed tasks: ${progressed.join(", ")}`, "AGENT_TEAMS_TASK_CONFLICT");
      appendTaskLifecycleEvent(task, { kind: "reopen", at: now(), attempt: task.attempt ?? 0, ...(task.claimId === undefined ? {} : { claimId: task.claimId }), leaseEpoch: task.leaseEpoch ?? 0, actorId: caller.id, reason: `reopened authoritative ${task.state} projection` });
      task.state = "pending";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      clearTaskTerminalMetadata(task);
          } else if (action === "assign") {
      if (!isLead) reject("only the team lead can assign a task", "AGENT_TEAMS_UNAUTHORIZED");
      const assignee = fixedRootCommand?.assigneeSessionId ?? requireAssignableMember(resolveMember(team, input.assigneeSessionId)).sessionId;
      if (task.assigneeSessionId === assignee && (task.state === "pending" || task.state === "in_progress")) {
        // Internal legacy callers keep the old no-op behavior. Public fixed-root commands
        // persist a durable request receipt without fabricating a task revision.
        if (fixedRootCommand === undefined) return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams) };
        fixedRootNoOp = true;
      } else {
        if (task.state !== "pending") reject(`only a pending task can be assigned (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
        task.assigneeSessionId = assignee;
      }
          } else {
      if (!isLead) reject("only the team lead can unassign a task", "AGENT_TEAMS_UNAUTHORIZED");
      if (task.state !== "pending") reject(`only a pending task can be unassigned (current state: ${task.state})`, "AGENT_TEAMS_TASK_CONFLICT");
      task.assigneeSessionId = undefined;
    }
    const commandAt = now();
    if (!fixedRootNoOp) {
      task.updatedAt = commandAt;
      bumpTaskRevision(task);
    }
    const operation = recordFixedRootTaskCommand(team, task, action, fixedRootCommand, commandAt);
    team.updatedAt = commandAt;
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), ...(operation === undefined ? {} : { operation: clone(operation) }) };
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
    if (typeof task.claimId === "string") appendTaskLifecycleEvent(task, { kind: "release", at: timestamp, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? team.pauseEpoch ?? 0, actorId: team.rootLeadSessionId, reason });
    task.state = "pending";
    task.assigneeSessionId = undefined;
    task.claimedAt = undefined;
    task.claimId = undefined;
    clearTaskTerminalMetadata(task);
    task.releasedAt = timestamp;
    task.releaseReason = reason;
    task.updatedAt = timestamp;
    bumpTaskRevision(task);
    releasedTaskIds.push(task.id);
  }
  return releasedTaskIds;
}
function resetTaskStoppedAfter(task, stoppedAt, pauseEpoch) {
  const submittedAfterStop = task.state === "submitted" && typeof task.submission?.submittedAt === "string" && task.submission.submittedAt >= stoppedAt;
  const completedAfterStop = task.state === "completed" && typeof task.completedAt === "string" && task.completedAt >= stoppedAt;
  if (task.state !== "in_progress" && !submittedAfterStop && !completedAfterStop) return;
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
  bumpTaskRevision(task);
}
async function pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt, authorizationProvider) {
  const selectedChildren = new Map(selections.map((entry) => [entry.teamId, new Set(entry.childIds)]));
  const teamIds = new Set(selectedChildren.keys());
  const childIds = [...new Set(selections.flatMap((entry) => entry.childIds))];
  // Stop must remove the bound Goal activation before durable team authority is
  // revoked or the pause epoch advances; otherwise an already-armed continuation
  // can escape the newly paused scope.
  await revokeRootAgentTeamAutopilot(ctx, store, lead, "explicit user Stop requires fresh direct-human continuation authority", "revoked", authorizationProvider);
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
  try { await drainContinuableChildrenWithDeadline(ctx, lead, childIds); }
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
    const directRoutingReceipt = document.routingReceipts.find((receipt) => receipt.teamId === team.id && receipt.establishmentAuthority === "direct_human" && ["created", "reused"].includes(receipt.outcome));
    const refreshedAutopilot = directRoutingReceipt === undefined ? undefined : agentTeamAutopilotGrantForCreation(document, lead, input.autopilotGoal, {
      directHuman: true,
      planHash: team.plan?.hash,
      pauseEpoch: team.pauseEpoch ?? 0,
      routingReceiptId: directRoutingReceipt.id,
      excludeTeamId: team.id,
    });
    if (refreshedAutopilot !== undefined && planAuthorizationSupportsAutopilot(team)) team.autopilot = refreshedAutopilot;
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
    const unfinishedTaskIds = team.tasks.filter((task) => task.assigneeSessionId === member.sessionId && !taskSatisfiesDependency(task)).map((task) => task.id);
    if (!force && unfinishedTaskIds.length > 0) reject(`member owns work that is not independently accepted; submit and await root acceptance or release it before graceful retirement: ${unfinishedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
    const invalidSubmissionTaskIds = team.tasks.filter((task) => task.assigneeSessionId === member.sessionId && ["submitted", "completed"].includes(task.state) && !taskSubmissionMatches(task)).map((task) => task.id);
    if (!force && invalidSubmissionTaskIds.length > 0) reject(`member completed tasks without a current task-scoped submission fact: ${invalidSubmissionTaskIds.join(", ")}`, "AGENT_TEAMS_DELIVERY_REQUIRED");
    if (member.state === "retired") return { teamId: team.id, member: clone(member), releasedTaskIds: [], noop: true };
    markMemberShuttingDown(member, force);
    team.updatedAt = member.updatedAt;
    return { teamId: team.id, member: clone(member), noop: false };
  }));
  if (prepared.noop) return prepared;
  const gracefulWaiter = force ? undefined : registerGracefulLifecycleWaiter(prepared.member.sessionId);
  try {
    if (force) await drainContinuableChildrenWithDeadline(ctx, lead, [prepared.member.sessionId], signal);
    else {
      await runWithLifecycleDeadline(async (lifecycleSignal) => {
        await admission.run(lead, prepared.member.sessionId, lifecycleSignal, async () => {
          requireExactRootAgent(ctx, lead);
          return queueAgentTeamPrompt(ctx.subagents, lead, prepared.member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
            source: relaySource(lead.id), signal: lifecycleSignal,
          });
        });
        gracefulWaiter.accept();
        await waitForGracefulLifecycle(gracefulWaiter, lifecycleSignal);
      }, { signal, label: "graceful member retirement" });
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

async function shutdownTeam(ctx, store, admission, lead, input, signal, authorizationProvider) {
  const teamId = await store.read((document) => optionalString(input.teamId, "teamId", 256) === undefined ? resolveUniqueLeadTeam(document, undefined, lead.id, (candidate) => candidate.state !== "closed").id : findTeam(document, input.teamId).id);
  if (input.memberSessionId !== undefined && input.memberSessionId !== "") {
    return queueTeamOperation(store.filePath, teamId, () => retireMember(ctx, store, admission, lead, { ...input, teamId }, signal));
  }
  const force = input.force === true;
  const prepared = await queueTeamOperation(store.filePath, teamId, () => store.runOperation(async () => {
    const preflight = await store.read((document) => {
      const team = findTeam(document, teamId);
      requireLiveRootLead(ctx, team, lead);
      if (team.state !== "closing") requireActiveTeam(team);
      const unacceptedTaskIds = team.tasks.filter(taskAwaitsAcceptance).map((task) => task.id);
      if (!force && unacceptedTaskIds.length > 0) reject(`team has submitted tasks awaiting independent lead acceptance: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
      const unfinishedTaskIds = team.tasks.filter((task) => !taskIsTerminal(task)).map((task) => task.id);
      if (!force && unfinishedTaskIds.length > 0) reject(`team has unfinished tasks; complete or cancel them before graceful shutdown: ${unfinishedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
      return { hasLiveAutopilot: document.teams.some((candidate) => candidate.rootLeadSessionId === lead.id && ["pending_plan", "active"].includes(candidate.autopilot?.status)) };
    });
    if (preflight.hasLiveAutopilot) await revokeRootAgentTeamAutopilot(ctx, store, lead, "team shutdown requires fresh direct-human continuation authority", "revoked", authorizationProvider);
    return store.mutate((document) => {
      const team = findTeam(document, teamId);
      requireLiveRootLead(ctx, team, lead);
      if (team.state !== "closing") requireActiveTeam(team);
      const unacceptedTaskIds = team.tasks.filter(taskAwaitsAcceptance).map((task) => task.id);
      if (!force && unacceptedTaskIds.length > 0) reject(`team has submitted tasks awaiting independent lead acceptance: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
      const unfinishedTaskIds = team.tasks.filter((task) => !taskIsTerminal(task)).map((task) => task.id);
      if (!force && unfinishedTaskIds.length > 0) reject(`team has unfinished tasks; complete or cancel them before graceful shutdown: ${unfinishedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
      team.state = "closing";
      const workers = team.members.filter((member) => member.kind === "worker" && member.state !== "retired");
      for (const member of workers) markMemberShuttingDown(member, force);
      team.updatedAt = now();
      return { teamId: team.id, workers: workers.map((member) => clone(member)) };
    });
  }));

  let drainError;
  let outcomes = [];
  if (force) {
    try {
      await drainContinuableChildrenWithDeadline(ctx, lead, prepared.workers.map((member) => member.sessionId), signal);
    } catch (error) {
      drainError = error;
    }
  } else {
    const gracefulRequests = prepared.workers.map((member) => ({ member, waiter: registerGracefulLifecycleWaiter(member.sessionId) }));
    outcomes = await Promise.allSettled(gracefulRequests.map(async ({ member, waiter }) => {
      try {
        await runWithLifecycleDeadline(async (lifecycleSignal) => {
          await admission.run(lead, member.sessionId, lifecycleSignal, async () => {
            requireExactRootAgent(ctx, lead);
            return queueAgentTeamPrompt(ctx.subagents, lead, member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
              source: relaySource(lead.id), signal: lifecycleSignal,
            });
          });
          waiter.accept();
          await waitForGracefulLifecycle(waiter, lifecycleSignal);
        }, { signal, label: `graceful retirement for ${member.sessionId}` });
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
          member.shutdownUnconfirmed = true;
          member.stopUnconfirmed = true;
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
      const unacceptedTaskIds = team.tasks.filter(taskAwaitsAcceptance).map((task) => task.id);
      if (unacceptedTaskIds.length > 0) reject(`orphan recovery cannot certify submitted tasks awaiting independent lead acceptance: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
      for (const member of team.members) if (member.kind === "worker") confirmMemberRetired(member);
      closeTeamRecord(team, "orphaned team closed by an explicit direct-human recovery");
      recovered.push(projectTeam(team));
    }
    return { candidates: candidates.map(projectTeam), recovered };
  }));
}

const TEAM_SNAPSHOT_INDEXES = new WeakMap();
function teamSnapshotIndex(document) {
  let index = TEAM_SNAPSHOT_INDEXES.get(document);
  if (index !== undefined) return index;
  const bySession = new Map(), byRoot = new Map(), byProject = new Map();
  for (const team of document.teams) {
    const rootTeams = byRoot.get(team.rootLeadSessionId) ?? [];
    rootTeams.push(team);
    byRoot.set(team.rootLeadSessionId, rootTeams);
    if (typeof team.projectKey === "string" && /^[a-f0-9]{64}$/u.test(team.projectKey)) {
      const projectTeams = byProject.get(team.projectKey) ?? [];
      projectTeams.push(team);
      byProject.set(team.projectKey, projectTeams);
    }
    for (const member of team.members) {
      const related = bySession.get(member.sessionId) ?? [];
      related.push(team);
      bySession.set(member.sessionId, related);
    }
  }
  index = { bySession, byRoot, byProject, boards: new Map() };
  TEAM_SNAPSHOT_INDEXES.set(document, index);
  return index;
}
function cachedProjectTeamBoardEntry(index, projectKey) {
  const projectTeams = index.byProject.get(projectKey) ?? [];
  const signature = JSON.stringify(projectTeams.map((team) => [team.id, team.revision ?? 1, effectiveTeamState(team), team.updatedAt]));
  const cached = index.boards.get(projectKey);
  if (cached?.signature === signature) {
    index.boards.delete(projectKey);
    index.boards.set(projectKey, cached);
    return cached;
  }
  const prepared = prepareProjectTeamBoard(projectKey, projectTeams, { teamState: effectiveTeamState, satisfiesDependency: taskSatisfiesDependency });
  const entry = { signature, prepared, firstPage: undefined };
  index.boards.delete(projectKey);
  index.boards.set(projectKey, entry);
  while (index.boards.size > UI_PROJECT_TEAM_BOARD_CACHE_MAX_PROJECTS) index.boards.delete(index.boards.keys().next().value);
  return entry;
}
function cachedProjectTeamBoard(index, projectKey, cursor) {
  if (projectKey === undefined) return createProjectTeamBoard(undefined, []);
  const entry = cachedProjectTeamBoardEntry(index, projectKey);
  if (cursor !== undefined) return paginatePreparedProjectTeamBoard(entry.prepared, { cursor });
  if (entry.firstPage === undefined) entry.firstPage = paginatePreparedProjectTeamBoard(entry.prepared);
  return entry.firstPage;
}
function projectTeamBoardCacheSize(document) {
  return teamSnapshotIndex(document).boards.size;
}
function projectTeamBoardPage(document, sessionId, selectedTeamId, cursor) {
  const index = teamSnapshotIndex(document);
  const selected = (index.bySession.get(sessionId) ?? []).find((team) => team.id === selectedTeamId);
  if (selected === undefined) reject("the calling session does not belong to the selected team", "AGENT_TEAMS_PROJECT_BOARD_FORBIDDEN");
  if (typeof selected.projectKey !== "string" || !/^[a-f0-9]{64}$/u.test(selected.projectKey)) reject("the selected team has no canonical project", "AGENT_TEAMS_NOT_FOUND");
  const projectTeams = index.byProject.get(selected.projectKey) ?? [];
  return decorateProjectTeamBoardRecovery(cachedProjectTeamBoard(index, selected.projectKey, cursor), projectTeams, sessionId, { teamState: effectiveTeamState });
}
function teamSnapshot(document, sessionId, selectedTeamId) {
  const index = teamSnapshotIndex(document);
  const related = sessionId === "settings" ? [] : index.bySession.get(sessionId) ?? [];
  const ordered = [...related].sort((left, right) => {
    const leftClosed = left.state === "closed";
    const rightClosed = right.state === "closed";
    if (leftClosed !== rightClosed) return leftClosed ? 1 : -1;
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
  const selected = ordered.find((team) => team.id === selectedTeamId) ?? ordered[0];
  const peerTeams = selected === undefined ? [] : index.byRoot.get(selected.rootLeadSessionId) ?? [];
  const projectTeams = selected?.projectKey === undefined ? [] : index.byProject.get(selected.projectKey) ?? [];
  const projectTeamBoard = decorateProjectTeamBoardRecovery(cachedProjectTeamBoard(index, selected?.projectKey), projectTeams, sessionId, { teamState: effectiveTeamState });
  const config = clone(document.settings);
  const teams = ordered.map(projectTeamUiSummary);
  const team = selected === undefined ? null : projectTeamForUi(selected, peerTeams);
  const cursor = JSON.stringify([
    config.enabled,
    config.maxMembers,
    config.maxActiveTurns,
    config.autopilotEnabled,
    config.autopilotMaxAdditionalRounds,
    selected?.id ?? null,
    projectTeamBoard.cursor,
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
    projectTeamBoard,
    crossTeamEvents: projectCrossTeamEvents(peerTeams),
  };
}
function teamSnapshotWithAutopilotAuthorization(ctx, document, sessionId, selectedTeamId) {
  const snapshot = teamSnapshot(document, sessionId, selectedTeamId);
  const root = ctx.agents?.get?.(sessionId);
  const team = document.teams.find((candidate) => candidate.id === snapshot.activeTeamId);
  const goal = root === undefined || typeof ctx.goals?.get !== "function" ? undefined : ctx.goals.get(root);
  const exactRoot = root !== undefined && ctx.agents?.get?.(root.id) === root && ctx.agents?.roots?.().includes(root);
  const liveGrant = ["pending_plan", "active"].includes(team?.autopilot?.status) && team.autopilot.goalId === goal?.id
    && team.autopilot.rootSessionId === root?.id && team.autopilot.pauseEpochAtGrant === (team?.pauseEpoch ?? 0);
  const goalCanBeScoped = goal?.phase === "active" && (goal.activation === "armed" || liveGrant && goal.activation === "disarmed");
  const openRootTeams = exactRoot ? document.teams.filter((candidate) => candidate.rootLeadSessionId === root.id && candidate.state !== "closed") : [];
  const teamScopeHash = openRootTeams.length === 0 ? undefined : agentTeamAutopilotHostTeamScopeHash(openRootTeams);
  const scope = exactRoot && team?.rootLeadSessionId === root.id && effectiveTeamState(team) === "active"
    && typeof team.projectKey === "string" && /^[a-f0-9]{64}$/u.test(team.projectKey)
    && team.projectKey === optionalProjectKeyForRoot(root) && goalCanBeScoped && teamScopeHash !== undefined
    ? { rootSessionId: root.id, projectKey: team.projectKey, goalId: goal.id, teamId: team.id, pauseEpoch: team.pauseEpoch ?? 0, teamScopeHash }
    : null;
  snapshot.autopilotAuthorization = scope;
  snapshot.cursor = JSON.stringify([snapshot.cursor, scope === null ? null : [scope.rootSessionId, scope.projectKey, scope.goalId, scope.teamId, scope.pauseEpoch, scope.teamScopeHash]]);
  return snapshot;
}

function teamSystemPrompt(store) {
  if (!store.isEnabled()) {
    return "Agent Teams automatic-team mode is DISABLED. Do not proactively call any team tool. Work normally without creating, spawning, messaging, or managing teams unless the direct user first enables the feature through its settings. Team members must never create teams.";
  }
  const autopilotPolicy = store.autopilotPolicy();
  const capacityPolicy = store.capacityPolicy();
  const bootstrapCapacity = Math.min(MAX_BOOTSTRAP_ITEMS, capacityPolicy.maxMembers, capacityPolicy.maxActiveTurns);
  return [
    "Agent Teams automatic-team mode is ENABLED.",
    `Configured capacity is ${capacityPolicy.maxMembers} managed member(s) per team and ${capacityPolicy.maxActiveTurns} simultaneously active member(s) across all teams owned by this root. These values are ceilings, not a target roster size: choose the number justified by sustained independent workstreams. A complete bootstrap plan may contain up to ${bootstrapCapacity} visible peers right now; if maxMembers is higher than maxActiveTurns, create or start additional members only as active-turn capacity becomes available.`,
    "Before substantive work on every ordinary direct-human root turn, and before first creating an Agent Team during an exact admitted continuation of that root's active, armed goal, apply the three-level gate below and persist exactly one Host-scoped routing decision for that root/turn/project: all three levels call team_route_goal first; for Level 3, team_start/team_bootstrap then finalize that same immutable decision with the creation outcome and Host-validated team. Decision content is model-declared; the receipt is an audit record only, does not force or prove model-route selection, and model input cannot choose another root, project, turn, or team scope. When Level 3 conditions are met, choose exactly one creation path in that same authorized turn: use team_bootstrap when the complete bounded task/member plan is already known; otherwise use team_start and then the existing task/spawn tools. Never ask the user to send “continue” merely to cross from an admitted automatic goal round into safe internal team creation. Never call both team_start and team_bootstrap for the same team, and never replace the required visible managed members with multiple hidden ordinary subagents.",
    "Keep durable team task state synchronized at every handoff: members must explicitly complete finished tasks before their final report, and the root lead must reconcile every task before retiring members or closing the team. A report or successful subagent turn is not completion evidence. Graceful retirement and shutdown require no unfinished owned work; force shutdown records unfinished work as cancelled rather than leaving permanent pending tasks.",
    "Once an Agent Team is established for the current goal, the root lead defaults to coordination only: decompose the user's objective into substantive outcomes, persist and assign durable tasks, coordinate dependencies and handoffs, monitor and reconcile task state, review and accept member deliverables, then perform final integration and user-facing synthesis. The root lead must not personally implement, research, design, test, or otherwise substitute for a core professional deliverable that is assigned or should be assigned to a member role. If substantive coverage is missing, create or restructure the relevant durable task and assign or expand the visible team instead of absorbing that work; the root may make only minimal glue changes required to integrate accepted member outputs.",
    autopilotPolicy.enabled
      ? `Agent Team waiting is event-driven, and the trusted Host automatic-continuation preference is ON with a fixed budget of at most ${autopilotPolicy.maxAdditionalRounds} extra goal rounds. First inspect team_status: only when every open team reports autopilot.status=active and every unfinished safe internal task is either owned by a live worker or blocked on such work may you end the current turn without polling team_status and without asking the user to send ‘continue’. The Host parks normal waiting; it is not a blocked Goal outcome. Only a new claim-bound durable task submission, a worker transition to failed, or a durable dependency/reference/satisfaction change wakes the exact fixed root. Worker release, ready/idle transitions, checkpoints, and duplicate projections do not spend a round. If the goal's configured round slice is exhausted, the Host grants exactly one additional round for that durable transition. This grant is not a timer, retry loop, or permission upgrade: missing/revoked grants, paused teams, cross-project scope, unknown capabilities, file conflicts, non-none/outcome_unknown effects, explicit Stop/resume, real safety blockers, permission anomalies, recovery, handoff, confirmation boundaries, or the finite budget remain stopped and require manual recovery.`
      : "The trusted Host automatic-continuation preference is OFF. Do not end a coordinator turn on the assumption that worker progress will wake it, and do not claim that the Host will extend goal rounds. Finish currently actionable coordination in this turn; if a safe team must continue across future rounds, explain that automatic continuation can be explicitly enabled in Agent Teams settings. Never repeatedly ask the user to send ‘continue’ as a substitute for that setting.",
    "A team's durable tasks and member roles must collectively cover the substantive outputs required to satisfy the user's goal, each with a real deliverable and observable acceptance criteria. Never create decorative, token, or review-only members while leaving the core professional output to the root lead; if the work does not justify delegating its substantive production, do not create a team.",
    "Only the outermost top-level root lead/brain evaluates each ordinary direct-user goal using a strict three-level gate. Level 1 — main model: Complete simple, tightly coupled, or non-parallel work alone. Level 2 — ordinary subagent: when only one auxiliary executor is needed, use an official normal subagent or subagent_fork even if that single helper must be continuable or work across multiple turns. Level 3 — Agent Team: in automatic mode, proactively choose one Agent Team creation path only when the goal normally has at least two sustained, genuinely independent workstreams that need delegation to different visible managed members; the root/lead's own work or coordination does not count as the second workstream. The work must also require ongoing coordination across turns, such as shared tasks, dependencies, handoffs, or status tracking. An explicit user request for a team may still be followed, but automatic mode must not create a one-worker team. Parallelism by itself is not enough for a team; the user does not need to say ‘create a team’, design members, or know the team tools. Never create a team merely to fill seats, demonstrate the feature, or make routine work look parallel. When an active team's objective needs another delegation, it must be added as a visible managed member rather than a hidden ordinary subagent. Managed team members must never create teams or fan out through subagent, subagent_fork, workflow, or ralph; if they need more parallel work, they must report that need to the root, which decides whether to spawn another visible member under maxActiveTurns. A member may report only from its own in-progress task through team_expansion_request; the request is a proposal, never authority to spawn.",
    "When a new team already has a complete bounded task/member plan that fits the configured bootstrap capacity described above, call team_bootstrap directly with a stable request_id and do not call team_start first. Otherwise team_start creates a draft: persist tasks, then use team_plan_commit with the exact plan revision and confirmed_plan_hash before any team_spawn. Without durable successful worker-publication history that CAS persists phase committed; the first fully successful spawn records publication and activates it, while later recommit persists active even after every published worker gracefully retires. Provisioning or initial publication/work-followup failure never establishes this history. Upgraded retired workers without the new marker qualify only through a task submission/result or checkpoint bound to their exact historical claim; retired state alone and former-root adoption history do not qualify. Both committed and active pass new claim/spawn execution gates. New team creation and bootstrap require either the current direct-human root turn or the exact admitted automatic continuation of the same root's active, armed goal; every other non-human turn remains forbidden. After that authorized establishment and one successful worker publication, the same exact live root may recommit a later draft during an automatic goal round without another user message only while the team remains active and unpaused in the same canonical project, every capability is individually verified, file scopes are conflict-free, cost stays within the direct user's ordinary default AI-routing grant, every effect policy is none, and no outcome is unknown. Public spawn always requires non-empty persisted task_ids, and the Host atomically pre-binds those tasks with the member placeholder before child creation. Bootstrap persists all tasks before starting members, and exact replay reuses its plan. Neither path may bypass capacity checks, file-scope separation, capability preflight, or explicit review of partial/uncertain starts.",
    "An ordinary internal team that the direct user explicitly requested needs no redundant confirmation for a dynamically safe automatic-round recommit. Plan authority remains explicitly host_verified, human_attested, or unknown: a continuing/default grant stays human_attested and never becomes Host proof. Tool/model booleans can create only human_attested facts, never host_verified facts, and can never bulk-upgrade unknown capability records. Any material change to task scope, file ownership, capability/permission facts, model-cost class, or external effects returns the plan to draft and requires a fresh exact-hash CAS commit. New team creation and bootstrap remain behind the direct-human-or-exact-admitted-goal-round gate. Stop recovery/resume, handoff/adopt/recover, resolve_unknown, cross-project scope, unknown/unavailable or separately billed capabilities, conflicting files, and confirm_each/idempotent/forbidden effects remain behind their stricter direct-human or Host gates. An already active main-tier worker does not itself create a new cost grant or block safe continuation.",
    "A task claim returns claimId and leaseEpoch. Members must echo both for checkpoint, submission, or release; stale attempts are rejected and only an exact submission replay is a no-op. Worker complete moves the task only to submitted/in-review and appends an immutable claim-bound submission event. It does not complete the task, unlock dependencies, or permit graceful retirement. Only a later fixed-root accept of the current submission moves it to authoritative completed and appends acceptance; reject/reopen/cancel never erase older lifecycle events. Member checkpoints and next steps are unverified annotations separate from the five task states (pending, in_progress, submitted, completed, cancelled). External effect keys are Host-derived from stable team/task/effect identity. Only participating idempotency protocols can claim exactly-once; outcome_unknown blocks retry until an exact direct-human root resolves it.",
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

function projectToolFailure(error) { return { ok: false, error: { code: typeof error?.code === "string" ? error.code : "PROJECT_COLLABORATION_FAILED", retryable: false } }; }
function projectToolRef(prefix, requestId) { return `${prefix}_${createHash("sha256").update(nonEmptyString(requestId, "request_id", 256)).digest("base64url")}`; }
function projectToolPayload(value, allowed) {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) reject("payload must be an object", "PROJECT_COLLABORATION_INVALID");
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) reject(`payload contains unsupported or identity-bearing fields: ${extras.join(", ")}`, "PROJECT_COLLABORATION_INVALID");
  return value;
}
const PROJECT_MODEL_TASK_LIMIT = 120;
const PROJECT_MODEL_COLLECTION_LIMIT = 120;
const PROJECT_MODEL_MAX_BYTES = 128 * 1024;
const PROJECT_MODEL_REQUIREMENTS_BYTES = 8 * 1024;
const PROJECT_MODEL_TOTAL_KEYS = Object.freeze(["seats", "locks", "handoffs", "evidence", "history", "tasks", "unclaimed", "claimed", "inProgress", "inReview", "done", "blocked"]);
function projectModelRef(value) { return typeof value === "string" && value.length > 0 && value.length <= 256 ? value : undefined; }
function projectModelString(value, maxChars, maxBytes) {
  if (typeof value !== "string") return undefined;
  let result = "", bytes = 0, chars = 0;
  for (const character of value) { const size = Buffer.byteLength(character, "utf8"); if (chars >= maxChars || bytes + size > maxBytes) break; result += character; chars += 1; bytes += size; }
  return result;
}
function projectModelRequirements(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value === "string") return projectModelString(value, 1_000, 4 * 1024);
  if (Array.isArray(value)) return value.slice(0, 32).map((entry) => projectModelRequirements(entry, depth + 1));
  if (!isRecord(value)) return undefined;
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 32)) { const safeKey = projectModelString(key, 128, 512); if (safeKey) result[safeKey] = projectModelRequirements(entry, depth + 1); }
  return result;
}
function boundedProjectRequirements(value) {
  const projected = projectModelRequirements(value ?? {});
  return Buffer.byteLength(JSON.stringify(projected), "utf8") <= PROJECT_MODEL_REQUIREMENTS_BYTES ? projected : { truncated: true };
}
function finalizeProjectModelResult(result) {
  let bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  while (bytes > PROJECT_MODEL_MAX_BYTES && Array.isArray(result.tasks) && result.tasks.length > 0) { result.tasks.pop(); result.taskPage = { ...(result.taskPage ?? {}), hasMore: true }; bytes = Buffer.byteLength(JSON.stringify(result), "utf8"); }
  while (bytes > PROJECT_MODEL_MAX_BYTES && Array.isArray(result.requests) && result.requests.length > 0) { result.requests.pop(); result.hasMore = true; bytes = Buffer.byteLength(JSON.stringify(result), "utf8"); }
  for (const key of ["history", "evidence", "handoffs", "locks", "seats"]) while (bytes > PROJECT_MODEL_MAX_BYTES && Array.isArray(result.board?.[key]) && result.board[key].length > 0) { result.board[key].pop(); bytes = Buffer.byteLength(JSON.stringify(result), "utf8"); }
  if (bytes > PROJECT_MODEL_MAX_BYTES) reject("project model projection exceeds the bounded output budget", "PROJECT_COLLABORATION_OUTPUT_TOO_LARGE");
  return result;
}
function projectModelInteger(value) { return Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function projectModelTotals(value) {
  if (!isRecord(value)) return {};
  const totals = {};
  for (const key of PROJECT_MODEL_TOTAL_KEYS) {
    const count = projectModelInteger(value[key]);
    if (count !== undefined) totals[key] = count;
  }
  return totals;
}
function projectModelTask(task) {
  if (!isRecord(task)) return undefined;
  const taskRef = projectModelRef(task.taskRef, "taskRef");
  if (taskRef === undefined) return undefined;
  return {
    taskRef,
    ...(typeof task.status === "string" ? { status: task.status } : {}),
    ...(typeof task.collaborationStatus === "string" ? { collaborationStatus: task.collaborationStatus } : {}),
    ...(projectModelInteger(task.revision) === undefined ? {} : { revision: task.revision }),
    ...(projectModelInteger(task.requirementsRevision) === undefined ? {} : { requirementsRevision: task.requirementsRevision }),
    ...(projectModelInteger(task.priority) === undefined || task.priority > 1_000_000 ? {} : { priority: task.priority }),
    ...(projectModelString(task.title, 500, 2 * 1024) === undefined ? {} : { title: projectModelString(task.title, 500, 2 * 1024) }),
    requirements: boundedProjectRequirements(task.requirements),
    assigned: typeof task.assigneeActorRef === "string" && task.assigneeActorRef.length > 0,
    blockedBy: (Array.isArray(task.blockedBy) ? task.blockedBy : []).slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map((ref) => projectModelRef(ref, "taskRef")).filter(Boolean),
  };
}
function projectModelBoard(board) {
  if (!isRecord(board)) return undefined;
  const project = {
    ...(projectModelInteger(board.revision) === undefined ? {} : { revision: board.revision }),
    ...(projectModelInteger(board.projectRevision) === undefined ? {} : { projectRevision: board.projectRevision }),
    ...(typeof board.status === "string" ? { status: board.status } : {}),
    totals: projectModelTotals(board.totals),
    seats: (Array.isArray(board.seats) ? board.seats : []).filter((seat) => seat?.state !== "reserved").slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map((seat) => ({
      ...(projectModelRef(seat.actorRef) === undefined ? {} : { seatRef: seat.actorRef }),
      ...(projectModelRef(seat.parentActorRef) === undefined ? {} : { parentSeatRef: seat.parentActorRef }),
      ...(typeof seat.kind === "string" ? { kind: seat.kind } : {}),
      ...(typeof seat.state === "string" ? { state: seat.state } : {}),
      ...(projectModelInteger(seat.revision) === undefined ? {} : { revision: seat.revision }),
    })),
    locks: (Array.isArray(board.locks) ? board.locks : []).slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map((lock) => ({
      ...(projectModelRef(lock.taskRef) === undefined ? {} : { taskRef: lock.taskRef }),
      ...(typeof lock.state === "string" ? { state: lock.state } : {}),
      ...(projectModelInteger(lock.revision) === undefined ? {} : { revision: lock.revision }),
    })),
    handoffs: (Array.isArray(board.handoffs) ? board.handoffs : []).slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map((handoff) => ({
      ...(projectModelRef(handoff.handoffRef) === undefined ? {} : { handoffRef: handoff.handoffRef }),
      ...(projectModelRef(handoff.taskRef) === undefined ? {} : { taskRef: handoff.taskRef }),
      ...(projectModelRef(handoff.sourceActorRef) === undefined ? {} : { sourceSeatRef: handoff.sourceActorRef }),
      ...(projectModelRef(handoff.targetActorRef) === undefined ? {} : { targetSeatRef: handoff.targetActorRef }),
      ...(typeof handoff.state === "string" ? { state: handoff.state } : {}),
      ...(projectModelInteger(handoff.revision) === undefined ? {} : { revision: handoff.revision }),
    })),
    evidence: (Array.isArray(board.evidence) ? board.evidence : []).slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map((evidence) => ({
      ...(projectModelRef(evidence.evidenceRef) === undefined ? {} : { evidenceRef: evidence.evidenceRef }),
      ...(projectModelRef(evidence.taskRef) === undefined ? {} : { taskRef: evidence.taskRef }),
      ...(projectModelRef(evidence.actorRef) === undefined ? {} : { seatRef: evidence.actorRef }),
    })),
    history: (Array.isArray(board.history) ? board.history : []).slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map((event) => ({
      ...(projectModelInteger(event.revision) === undefined ? {} : { revision: event.revision }),
      ...(typeof event.kind === "string" ? { kind: event.kind } : {}),
    })),
  };
  if (isRecord(board.page)) project.page = {
    ...(projectModelInteger(board.page.includedHistory) === undefined ? {} : { includedHistory: board.page.includedHistory }),
    hasMoreHistory: board.page.hasMoreHistory === true,
    ...(projectModelInteger(board.page.nextBeforeRevision) === undefined ? {} : { nextBeforeRevision: board.page.nextBeforeRevision }),
  };
  return project;
}
function projectCollaborationModelResult(value) {
  if (!isRecord(value)) return { available: false };
  if (Object.hasOwn(value, "available")) {
    const result = {
      available: value.available === true,
      ...(value.writable === true ? { writable: true } : {}),
      ...(projectModelInteger(value.projectRevision) === undefined ? {} : { projectRevision: value.projectRevision }),
    };
    const board = projectModelBoard(value.collaboration);
    if (board !== undefined) result.board = board;
    result.recoveries=(Array.isArray(value.collaboration?.recoveries)?value.collaboration.recoveries:[]).slice(0,PROJECT_MODEL_COLLECTION_LIMIT).map(item=>({recoveryRef:projectModelRef(item.recoveryRef),mode:typeof item.mode==="string"?item.mode:undefined,state:typeof item.state==="string"?item.state:undefined,revision:projectModelInteger(item.revision),failureCode:typeof item.failureCode==="string"?item.failureCode:undefined})).filter(item=>item.recoveryRef);
    result.tasks = (Array.isArray(value.tasks) ? value.tasks : []).slice(0, PROJECT_MODEL_TASK_LIMIT).map(projectModelTask).filter(Boolean);
    result.totals = projectModelTotals(value.totals);
    if (isRecord(value.taskPage)) result.taskPage = { hasMore: value.taskPage.hasMore === true };
    if (isRecord(value.permissions)) result.permissions = {
      canCreate: value.permissions.canCreate === true, canAssign: value.permissions.canAssign === true,
      canReview: value.permissions.canReview === true, canResolveConflict: value.permissions.canResolveConflict === true,
      canUpdateOwnSeat: value.permissions.canUpdateOwnSeat === true, canClaim: value.permissions.canClaim === true, canSubmit: value.permissions.canSubmit === true,
    };
    return finalizeProjectModelResult(result);
  }
  return finalizeProjectModelResult({ board: projectModelBoard(value) ?? { totals: {} } });
}
function projectTaskModelResult(value) {
  if (value === undefined) return { found: false };
  if (isRecord(value) && Object.hasOwn(value, "available")) return projectCollaborationModelResult(value);
  if (!isRecord(value)) return { found: false };
  const task = projectModelTask(value.task);
  return finalizeProjectModelResult({
    found: task !== undefined,
    ...(value.duplicate === true ? { duplicate: true } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    ...(Array.isArray(value.blockers) ? { blockerRefs: value.blockers.slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map(projectModelRef).filter(Boolean) } : {}),
    ...(projectModelInteger(value.projectRevision) === undefined ? {} : { projectRevision: value.projectRevision }),
    ...(task === undefined ? {} : { task }),
  });
}
function projectRequestModelRow(request) {
  if (!isRecord(request)) return undefined;
  const requestRef = projectModelRef(request.requestRef), taskRef = projectModelRef(request.taskRef);
  if (requestRef === undefined || taskRef === undefined) return undefined;
  return {
    requestRef, taskRef,
    ...(projectModelRef(request.dependencyTaskRef) === undefined ? {} : { dependencyTaskRef: request.dependencyTaskRef }),
    ...(typeof request.kind === "string" ? { kind: request.kind } : {}),
    ...(typeof request.state === "string" ? { state: request.state } : {}),
    ...(projectModelInteger(request.revision) === undefined ? {} : { revision: request.revision }),
    ...(projectModelInteger(request.respondByAt) === undefined ? {} : { respondByAt: request.respondByAt }),
    mine: request.mine === true,
    targetedToMe: request.targetedToMe === true,
    escalationEligible: request.escalationEligible === true,
    ...(projectModelString(request.reason, 2_000, 4 * 1024) === undefined ? {} : { reason: projectModelString(request.reason, 2_000, 4 * 1024) }),
    ...(projectModelString(request.resolution, 2_000, 4 * 1024) === undefined ? {} : { resolution: projectModelString(request.resolution, 2_000, 4 * 1024) }),
  };
}
function projectRequestModelResult(value) {
  if (!isRecord(value)) return { requests: [], totals: {} };
  const rows = Array.isArray(value.requests) ? value.requests : value.request ? [value.request] : [];
  const totals = {};
  for (const key of ["total", "open", "accepted", "rejected", "cancelled", "escalated", "resolved"]) if (projectModelInteger(value.totals?.[key]) !== undefined) totals[key] = value.totals[key];
  const boundary = isRecord(value.nextBoundary) && projectModelInteger(value.nextBoundary.updatedAt) !== undefined && projectModelRef(value.nextBoundary.requestRef) !== undefined ? { updatedAt: value.nextBoundary.updatedAt, requestRef: value.nextBoundary.requestRef } : undefined;
  return finalizeProjectModelResult({
    ...(value.duplicate === true ? { duplicate: true } : {}),
    ...(projectModelInteger(value.projectRevision) === undefined ? {} : { projectRevision: value.projectRevision }),
    totals,
    requests: rows.slice(0, PROJECT_MODEL_COLLECTION_LIMIT).map(projectRequestModelRow).filter(Boolean),
    ...(value.hasMore === true ? { hasMore: true } : {}),
    ...(boundary === undefined ? {} : { nextBoundary: boundary }),
  });
}
const OFFICIAL_CORE_PORTS_BY_ENTRY = new WeakMap();
function officialCompatibleRawProjectContext(rawContext) {
  if (rawContext === null || typeof rawContext !== "object" || Array.isArray(rawContext)) reject("project task context is invalid", "PROJECT_ENTRY_TASK_CONTEXT_INVALID");
  const own = (field) => {
    const descriptor = Object.getOwnPropertyDescriptor(rawContext, field);
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined || !("value" in descriptor)) reject(`project task context field ${field} must be an own data property`, "PROJECT_ENTRY_TASK_CONTEXT_INVALID");
    return descriptor.value;
  };
  const disposeDescriptor = Object.getOwnPropertyDescriptor(rawContext, "dispose");
  const disposeRaw = disposeDescriptor !== undefined && disposeDescriptor.get === undefined && disposeDescriptor.set === undefined && typeof disposeDescriptor.value === "function" ? disposeDescriptor.value : undefined;
  let values;
  try {
    values = Object.fromEntries(["projectRef", "databasePath", "execution", "actorResolver", "keyProvider", "dispose"].map((field) => [field, own(field)]));
    if (typeof values.actorResolver !== "function" || typeof values.keyProvider !== "function" || typeof values.dispose !== "function") reject("project task context capability is invalid", "PROJECT_ENTRY_TASK_CONTEXT_INVALID");
  } catch (error) {
    try { disposeRaw?.call(rawContext); } catch {}
    throw error;
  }
  const execution = Object.freeze(Object.create(null));
  let disposed = false;
  const dispose = () => { if (disposed) return; disposed = true; values.dispose.call(rawContext); };
  const context = Object.create(null);
  Object.defineProperties(context, {
    projectRef: { value: values.projectRef },
    databasePath: { value: values.databasePath },
    execution: { value: execution },
    actorResolver: { value: (candidate, projectRef) => { if (candidate !== execution) reject("project task execution context is invalid or stale", "PROJECT_ENTRY_TASK_CONTEXT_INVALID"); return values.actorResolver.call(rawContext, values.execution, projectRef); } },
    keyProvider: { value: (projectRef) => values.keyProvider.call(rawContext, projectRef) },
    dispose: { value: dispose },
  });
  return Object.freeze(context);
}
function officialCorePortsForProjectEntry(projectEntry) {
  if (isOfficialCorePorts(projectEntry)) return projectEntry;
  if ((typeof projectEntry !== "object" && typeof projectEntry !== "function") || projectEntry === null) reject("official-compatible project entry is unavailable", "OFFICIAL_CORE_PRIMARY_REQUIRED");
  const cached = OFFICIAL_CORE_PORTS_BY_ENTRY.get(projectEntry);
  if (cached !== undefined) return cached;
  const ports = createOfficialCorePorts({ providers: [createCustomOfficialCoreProvider({
    projectIdentity: {
      open: async ({ canonicalProjectKey, bindLegacy }) => {
        let rawContext;
        if (bindLegacy) {
          if (typeof projectEntry.bindLegacyProjectCollaborationContext !== "function") reject("legacy project binding is unavailable", "PROJECT_ENTRY_LEGACY_BINDING_REQUIRED");
          rawContext = await projectEntry.bindLegacyProjectCollaborationContext({ canonicalProjectKey });
        } else {
          const contextFactory = projectEntry.localProjectCollaborationContext ?? projectEntry.localProjectTaskContext;
          if (typeof contextFactory !== "function") reject("project task context is unavailable", "PROJECT_ENTRY_TASK_CONTEXT_INVALID");
          rawContext = await (projectEntry.requiresCanonicalProjectKey === true ? contextFactory.call(projectEntry, { canonicalProjectKey }) : contextFactory.call(projectEntry));
        }
        return officialCompatibleRawProjectContext(rawContext);
      },
      webEntry: () => projectEntry,
    },
    task: { bind: ({ store, actorResolver, now: clock, wakeScheduler }) => new ProjectTaskCommandService({ store, actorResolver, ...(clock === undefined ? {} : { now: clock }), ...(wakeScheduler === undefined ? {} : { wakeScheduler }) }) },
    collaboration: { bind: ({ store, actorResolver, earlyResolutionAuthorizer, rootFailureResolver }) => new ProjectCollaborationService({ store, actorResolver, earlyResolutionAuthorizer, rootFailureResolver }) },
    projection: { createWebRuntime: (options) => new ProjectTaskWebRuntime(options) },
    recovery: { continueRoot: ({ operation }) => operation(), recoverMember: ({ operation }) => operation(), reconcileMember: ({ operation }) => operation() },
  })] });
  OFFICIAL_CORE_PORTS_BY_ENTRY.set(projectEntry, ports);
  return ports;
}
async function withProjectCollaborationContext(projectEntry, execution, operation, { earlyResolutionAuthorizer = () => false, rootFailureResolver = () => undefined, bindLegacy = false } = {}) {
  const officialCorePorts = officialCorePortsForProjectEntry(projectEntry);
  const canonicalProjectKey = isOfficialCorePorts(projectEntry) || projectEntry?.requiresCanonicalProjectKey === true ? projectKeyForRoot(execution.agent) : "0".repeat(64);
  const context = await officialCorePorts.projectIdentity.open({ canonicalProjectKey, bindLegacy });
  let store;
  try {
    store = new ProjectTaskStore({ filePath: context.databasePath, keyProvider: context.keyProvider });
    context.actorResolver(context.execution, context.projectRef);
    store.initialize();
    const deriveProjectHmac = (domain, ...parts) => {
      let key;
      try {
        key = context.keyProvider(context.projectRef);
        return createHmac("sha256", key).update(domain).update("\0").update(context.projectRef).update("\0").update(JSON.stringify(parts)).digest("base64url");
      } finally { key?.fill(0); }
    };
    const actorRefForSessionId = (sessionId) => `actor_${deriveProjectHmac("dsh-agent-teams/project-root-actor/v1", sessionId)}`;
    const actorRef = actorRefForSessionId(execution.agent.id);
    const actorResolver = (candidate, requestedProjectRef) => {
      if (candidate !== execution) reject("project collaboration execution is invalid, stale, or belongs to another tool call", "PROJECT_COLLABORATION_CONTEXT_INVALID");
      context.actorResolver(context.execution, requestedProjectRef);
      const coordinatorActorRef = store.getCollaborationCoordinatorActorRef(requestedProjectRef);
      const authorities = coordinatorActorRef === undefined || coordinatorActorRef === actorRef ? ["project_lead"] : [];
      return Object.freeze({ projectRef: requestedProjectRef, actorRef, kind: "agent", authorities });
    };
    const collaboration = officialCorePorts.collaboration.bind({ store, actorResolver, earlyResolutionAuthorizer, rootFailureResolver });
    const tasks = officialCorePorts.task.bind({ store, actorResolver });
    const wake = Object.freeze({
      claim: (input) => tasks.claimTaskWakeSignals(execution, { projectRef: context.projectRef, ...input }),
      ack: (input) => tasks.ackTaskWakeSignal(execution, { projectRef: context.projectRef, ...input }),
      inspect: () => tasks.inspectTaskWakeWaiter(execution, { projectRef: context.projectRef }),
      reconcile: (input) => tasks.reconcileTaskWakeSignal(execution, { projectRef: context.projectRef, ...input }),
      setPaused: (paused) => tasks.setTaskWakePaused(execution, { projectRef: context.projectRef, paused }),
    });
    return await operation({
      projectRef: context.projectRef, actorRef, collaboration, tasks, wake, actorRefForSessionId, canonicalProjectKey,
      dispatcherRef: `dispatcher_${deriveProjectHmac("dsh-agent-teams/project-task-wake-dispatcher/v1")}`,
      isBoardAvailable: () => store.hasCollaborationBoard(context.projectRef),
      deriveOpaque: (kind, ...parts) => `${kind}_${deriveProjectHmac(`dsh-agent-teams/project-${kind}/v1`, ...parts)}`,
    });
  } finally {
    try { store?.close(); } finally { context.dispose(); }
  }
}
async function reconcileProjectTaskWakeRoot(ctx, projectEntry, root, { paused, dispatch = false, reconcile = true } = {}) {
  if (ctx.agents.get(root.id) !== root || !ctx.agents.roots().includes(root)) return;
  const execution = Object.freeze({ agent: root });
  await withProjectCollaborationContext(projectEntry, execution, async (binding) => {
    if (!binding.isBoardAvailable()) return;
    if (paused === true) binding.wake.setPaused(true);
    else {
      if (reconcile) {
        const waiter = binding.wake.inspect();
        if (waiter.state === "outcome_unknown" && typeof waiter.wakeRef === "string") {
          const evidence = rootProjectTaskWakeEvidence(root, waiter.wakeRef);
          if (evidence !== "unknown") binding.wake.reconcile({ wakeRef: waiter.wakeRef, evidence });
        }
      }
      if (paused === false) binding.wake.setPaused(false);
    }
    if (dispatch) await dispatchProjectTaskWakeSignals(ctx, binding);
  });
}
function observeProjectTaskWakeLifecycle(ctx, projectEntry, ready, { reconcile = reconcileProjectTaskWakeRoot } = {}) {
  void ready.then(async () => {
    const representatives = new Map();
    const roots = ctx.agents.roots().filter((root) => ["idle", "running"].includes(root.status));
    for (const root of roots) {
      const key = optionalProjectKeyForRoot(root);
      if (key === undefined) continue;
      try {
        await reconcile(ctx, projectEntry, root, { dispatch: false });
        if (!representatives.has(key)) representatives.set(key, root);
      } catch (error) { ctx.logger.warn(`project task wake root reconciliation failed: ${String(error?.code ?? "unavailable")}`); }
    }
    for (const root of representatives.values()) {
      try { await reconcile(ctx, projectEntry, root, { dispatch: true, reconcile: false }); }
      catch (error) { ctx.logger.warn(`project task wake project dispatch failed: ${String(error?.code ?? "unavailable")}`); }
    }
  }).catch((error) => ctx.logger.warn(`project task wake restart recovery failed: ${String(error?.code ?? "unavailable")}`));
}
function createProjectTaskWakeScheduler(ctx, projectEntry, ready, options = {}) {
  const retryBaseMs = options.retryBaseMs ?? PROJECT_TASK_WAKE_RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? PROJECT_TASK_WAKE_RETRY_MAX_MS;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const states = new Map();
  let closed = false;
  const pump = options.pump ?? (async (projectRef) => {
    const seen = new Set();
    const roots = ctx.agents.roots().filter((root) => ["idle", "running"].includes(root.status));
    for (const root of roots) {
      const key = optionalProjectKeyForRoot(root);
      if (key === undefined || seen.has(key)) continue;
      seen.add(key);
      const execution = Object.freeze({ agent: root });
      let matched = false, result;
      await withProjectCollaborationContext(projectEntry, execution, async (binding) => {
        if (binding.projectRef !== projectRef || !binding.isBoardAvailable()) return;
        matched = true;
        result = await dispatchProjectTaskWakeSignals(ctx, binding);
      });
      if (matched) return result ?? { retryable: 0 };
    }
    return { retryable: 1 };
  });
  const startDrain = (projectRef, state) => {
    if (closed || state.running) return;
    state.running = true;
    const drain = async () => {
      let retryable = 0;
      try {
        await ready;
        do {
          state.pending = false;
          try { retryable = Math.max(0, Number((await pump(projectRef))?.retryable) || 0); }
          catch (error) { retryable = 1; ctx.logger.warn(`project task wake scheduling failed: ${String(error?.code ?? "unavailable")}`); }
        } while (state.pending);
      } catch (error) {
        state.pending = false;
        ctx.logger.warn(`project task wake initialization failed: ${String(error?.code ?? "unavailable")}`);
      } finally {
        state.running = false;
        if (closed) {
          state.pending = false;
          if (states.get(projectRef) === state) states.delete(projectRef);
        } else if (state.pending) startDrain(projectRef, state);
        else if (retryable > 0) {
          const delay = Math.min(retryMaxMs, retryBaseMs * (2 ** Math.min(state.retryAttempt, 16)));
          state.retryAttempt += 1;
          state.timer = setTimer(() => {
            state.timer = undefined;
            if (closed) return;
            state.pending = true;
            startDrain(projectRef, state);
          }, delay);
          state.timer?.unref?.();
        } else if (states.get(projectRef) === state) states.delete(projectRef);
      }
    };
    void drain();
  };
  const schedule = ({ projectRef } = {}) => {
    if (closed || typeof projectRef !== "string" || projectRef.length === 0) return;
    let state = states.get(projectRef);
    if (state === undefined) { state = { pending: false, running: false, timer: undefined, retryAttempt: 0 }; states.set(projectRef, state); }
    state.retryAttempt = 0;
    if (state.timer !== undefined) { clearTimer(state.timer); state.timer = undefined; }
    state.pending = true;
    startDrain(projectRef, state);
  };
  schedule.close = () => {
    if (closed) return;
    closed = true;
    for (const state of states.values()) {
      state.pending = false;
      if (state.timer !== undefined) clearTimer(state.timer);
      state.timer = undefined;
    }
    states.clear();
  };
  return schedule;
}
async function reservePreparedProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,current,deriveOpaque){
  if(current.state!=="prepared") return current;
  if(current.mode==="retry") {
    if(typeof current.launchRef!=="string") reject("retry recovery lost its exact Host failure reference","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED");
    return collaboration.reserveRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,launchRef:current.launchRef}).recovery;
  }
  const snapshot=collaboration.snapshot(execution,{projectRef,historyLimit:1,taskLimit:120}),seat=snapshot.collaboration?.seats?.find(candidate=>candidate.actorRef===current.failedActorRef),task=snapshot.tasks?.find(candidate=>candidate.taskRef===current.replacementTaskRef);
  if(seat===undefined||task===undefined) reject("takeover recovery lost its durable seat or task evidence","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED");
  const batch=await projectSessionLaunch.prepareStart(execution,{requestId:`root-recovery:${current.recoveryRef}:${current.revision}`,totalSessions:2,slots:[{title:"Replacement root",role:seat.duty,resources:seat.resourceScope,task:seat.nextStep||task.title}],projectBinding:binding});
  const adoptions=await projectSessionLaunch.prepareAdoptions(execution,{batchRef:batch.batchRef,projectBinding:binding}),adoption=adoptions.prepared[0];
  if(adoption===undefined) reject("takeover recovery Host reservation is unavailable","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED");
  return collaboration.reserveRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,replacementSlotActorRef:deriveOpaque("slot-actor",adoption.slotRef),slotCapability:adoption.adoptionCapability,launchRef:batch.batchRef}).recovery;
}
function createProjectRootRecoveryScheduler(ctx,projectEntry,projectSessionLaunch,ready=Promise.resolve(),options={}){
  const retryBaseMs=options.retryBaseMs??PROJECT_ROOT_RECOVERY_RETRY_BASE_MS,retryMaxMs=options.retryMaxMs??PROJECT_ROOT_RECOVERY_RETRY_MAX_MS,setTimer=options.setTimer??setTimeout,clearTimer=options.clearTimer??clearTimeout,openRecoveryContext=options.openRecoveryContext??((execution,operation)=>withProjectCollaborationContext(projectEntry,execution,operation));
  if(!Number.isSafeInteger(retryBaseMs)||retryBaseMs<1||!Number.isSafeInteger(retryMaxMs)||retryMaxMs<retryBaseMs||typeof setTimer!=="function"||typeof clearTimer!=="function"||typeof openRecoveryContext!=="function") throw new TypeError("project root recovery scheduler options are invalid");
  const states=new Map(),activeRuns=new Set(); let closed=false,closePromise;
  const retryableState=state=>["prepared","reserved","activated","failed","outcome_unknown"].includes(state);
  const retryableError=error=>!["PROJECT_COLLABORATION_NOT_FOUND","PROJECT_ROOT_RECOVERY_FORBIDDEN","PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED","PROJECT_SESSION_LAUNCH_NOT_FOUND","PROJECT_SESSION_LAUNCH_PROJECT_MISMATCH","PROJECT_COLLABORATION_CONTEXT_INVALID"].includes(error?.code);
  const pump=options.pump??(async target=>{
    const root=ctx.agents.get(target.rootId);
    if(root===undefined||!ctx.agents.roots().includes(root)||PROJECT_TASK_STOPPED_ROOTS.has(root.id)||optionalProjectKeyForRoot(root)!==target.canonicalProjectKey) return {retryable:false};
    const execution=Object.freeze({agent:root}),binding={canonicalProjectKey:target.canonicalProjectKey,workspacePath:projectScopeForRoot(root),callerRootId:root.id};
    return openRecoveryContext(execution,async({projectRef,actorRef,collaboration,deriveOpaque})=>{
      let current=collaboration.getRootRecovery(execution,{projectRef,recoveryRef:target.recoveryRef});
      if(current.initiatorActorRef!==actorRef||!retryableState(current.state)) return {retryable:false};
      if(current.state==="prepared") current=await reservePreparedProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,current,deriveOpaque);
      if(current.state==="failed"&&current.revision>=PROJECT_ROOT_RECOVERY_AUTO_EFFECT_REVISION_LIMIT) return {retryable:false};
      await continueProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,current.recoveryRef,current.revision);
      current=collaboration.getRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef});
      return {retryable:retryableState(current.state)};
    });
  });
  const start=(key,state)=>{
    if(closed||state.running||states.get(key)!==state) return;
    state.running=true;
    const run=(async()=>{
      let retryable=false;
      try { await ready; retryable=(await pump(state.target))?.retryable===true; }
      catch(error) { retryable=retryableError(error); ctx.logger.warn(`project root recovery scheduling failed: ${String(error?.code??"unavailable")}`); }
      finally {
        state.running=false;
        if(closed||states.get(key)!==state){if(states.get(key)===state) states.delete(key);return;}
        if(state.pending){state.pending=false;start(key,state);return;}
        if(retryable){const delay=Math.min(retryMaxMs,retryBaseMs*(2**Math.min(state.retryAttempt,16)));state.retryAttempt+=1;state.timer=setTimer(()=>{state.timer=undefined;start(key,state)},delay);state.timer?.unref?.();}
        else if(states.get(key)===state) states.delete(key);
      }
    })();
    activeRuns.add(run); void run.finally(()=>activeRuns.delete(run));
  };
  const schedule=({rootId,canonicalProjectKey,recoveryRef}={})=>{
    if(closed||typeof rootId!=="string"||typeof canonicalProjectKey!=="string"||typeof recoveryRef!=="string") return;
    const key=`${rootId}\0${canonicalProjectKey}\0${recoveryRef}`; let state=states.get(key);
    if(state===undefined){state={target:{rootId,canonicalProjectKey,recoveryRef},running:false,pending:false,timer:undefined,retryAttempt:0};states.set(key,state);}
    state.retryAttempt=0;
    if(state.timer!==undefined){clearTimer(state.timer);state.timer=undefined;}
    if(state.running){state.pending=true;return;}
    start(key,state);
  };
  schedule.discover=async root=>{
    if(closed||root===undefined||!ctx.agents.roots().includes(root)||PROJECT_TASK_STOPPED_ROOTS.has(root.id)) return;
    const canonicalProjectKey=optionalProjectKeyForRoot(root); if(canonicalProjectKey===undefined) return;
    const execution=Object.freeze({agent:root});
    await withProjectCollaborationContext(projectEntry,execution,async({projectRef,actorRef,collaboration})=>{
      let boundary;
      do {
        const page=collaboration.sectionWindow(execution,{projectRef,section:"recoveries",limit:100,...(boundary===undefined?{}:{boundary})});
        for(const recovery of page.items) if(recovery.initiatorActorRef===actorRef&&retryableState(recovery.state)) schedule({rootId:root.id,canonicalProjectKey,recoveryRef:recovery.recoveryRef});
        boundary=page.hasMore?page.nextBoundary:undefined;
      } while(boundary!==undefined&&!closed);
    });
  };
  schedule.cancelRoot=rootId=>{for(const [key,state] of states) if(state.target.rootId===rootId){if(state.timer!==undefined) clearTimer(state.timer);states.delete(key);}};
  schedule.close=()=>{if(closePromise!==undefined)return closePromise;closed=true;for(const state of states.values()) if(state.timer!==undefined) clearTimer(state.timer);states.clear();closePromise=Promise.allSettled([...activeRuns]).then(()=>undefined);return closePromise;};
  schedule.size=()=>states.size;
  return schedule;
}
function observeProjectRootRecoveryLifecycle(ctx,scheduler,ready=Promise.resolve()){
  void ready.then(()=>Promise.allSettled(ctx.agents.roots().map(root=>scheduler.discover(root)))).catch(error=>ctx.logger.warn(`project root recovery restart discovery failed: ${String(error?.code??"unavailable")}`));
  ctx.on("session/event",(session,event)=>{
    const root=ctx.agents.get(session.id); if(root===undefined||root.session!==session||!ctx.agents.roots().includes(root)) return;
    if(event.type==="turn/end"&&event.data?.reason?.kind==="aborted"&&event.data.reason.reason?.kind==="user") scheduler.cancelRoot(root.id);
    else if(event.type==="user/message"&&event.data?.source?.kind==="user") void scheduler.discover(root).catch(error=>ctx.logger.warn(`project root recovery resume discovery failed: ${String(error?.code??"unavailable")}`));
  });
}
function requireProjectRootCaller(ctx, exec) {
  const execution = toolExecution(ctx, exec);
  if (!ctx.agents.roots().includes(execution.agent)) reject("project collaboration tools require the exact top-level root; Agent Team members and subagents are forbidden", "PROJECT_COLLABORATION_ROOT_REQUIRED");
  return exec;
}
async function activateReservedRootRecovery(projectSessionLaunch,execution,binding,current){
  const reservation=await projectSessionLaunch.recoveryReservation(execution,{batchRef:current.launchRef,projectBinding:binding});
  return projectSessionLaunch.activatePreparedBatch(execution,{batchRef:current.launchRef,reservations:[{slotActorRef:current.replacementSlotActorRef,taskRef:current.replacementTaskRef,slotRef:reservation.slotRef,operationRef:reservation.operationRef}],projectBinding:binding});
}
async function continueProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,recoveryRef,expectedRevision){
  let current=collaboration.getRootRecovery(execution,{projectRef,recoveryRef}),launch,retried=false;
  if(expectedRevision!==undefined&&current.revision!==expectedRevision) reject("root recovery revision changed","PROJECT_ROOT_RECOVERY_CONFLICT");
  if(["ready","cancelled"].includes(current.state)) return collaboration.snapshot(execution,{projectRef,historyLimit:20,taskLimit:100});
  if(current.mode==="retry"&&current.state==="reserved"){
    // The recovery CAS is the durable effect fence.  A crash after this point
    // resumes from activated and observes the exact Host slot; a losing caller
    // never reaches retryFailedSlot.
    current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:"activated"}).recovery;
    launch=await projectSessionLaunch.retryFailedSlot(execution,{slotRef:current.launchRef,projectBinding:binding});retried=true;
  }
  else if(current.mode==="retry"&&current.state==="failed") {
    // Fence the durable recovery before the exact Host retry effect. Concurrent
    // continuations race on this CAS, so only its winner may call retryFailedSlot.
    current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:"activated"}).recovery;
    launch=await projectSessionLaunch.retryFailedSlot(execution,{slotRef:current.launchRef,projectBinding:binding});retried=true;
  }
  else if(current.mode==="takeover"&&current.state==="reserved") launch=await activateReservedRootRecovery(projectSessionLaunch,execution,binding,current);
  else if(current.mode==="takeover"&&current.state==="failed") {
    const reservation=await projectSessionLaunch.recoveryReservation(execution,{batchRef:current.launchRef,projectBinding:binding});
    current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:"activated"}).recovery;
    launch=await projectSessionLaunch.retryFailedSlot(execution,{slotRef:reservation.slotRef,projectBinding:binding});
    retried=true;
  }
  else launch=current.mode==="retry"?await projectSessionLaunch.slotStatus(execution,{slotRef:current.launchRef,projectBinding:binding}):await projectSessionLaunch.status(execution,{batchRef:current.launchRef,projectBinding:binding});
  let slot=current.mode==="retry"?launch.slots.find(candidate=>candidate.slotRef===current.launchRef):launch.slots[0],launchState=slot?.state;
  if(retried&&launchState==="outcome_unknown") {
    // Host reconcile consults the exact persisted prompt request evidence. It may
    // prove ready/failed here; unavailable evidence remains outcome_unknown and is
    // observed again by the bounded recovery scheduler without another effect.
    launch=current.mode==="retry"?await projectSessionLaunch.slotStatus(execution,{slotRef:current.launchRef,projectBinding:binding}):await projectSessionLaunch.status(execution,{batchRef:current.launchRef,projectBinding:binding});
    slot=current.mode==="retry"?launch.slots.find(candidate=>candidate.slotRef===current.launchRef):launch.slots[0]; launchState=slot?.state;
  }
  if(current.state==="reserved"&&!["failed","outcome_unknown"].includes(launchState)) current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:"activated"}).recovery;
  const desired=launchState==="ready"?"ready":launchState==="failed"?"failed":launchState==="outcome_unknown"?"outcome_unknown":undefined;
  if(desired!==undefined&&current.state!==desired) {
    if(current.state==="failed"&&desired==="ready") current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:"activated"}).recovery;
    if(current.state==="reserved"&&desired==="ready") current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:"activated"}).recovery;
    if(current.state!==desired) current=collaboration.updateRootRecovery(execution,{projectRef,recoveryRef:current.recoveryRef,expectedRevision:current.revision,state:desired}).recovery;
  }
  return collaboration.snapshot(execution,{projectRef,historyLimit:20,taskLimit:100});
}
function registerProjectCollaborationTools(ctx, projectEntry, projectSessionLaunch, ready = Promise.resolve(), projectRootRecoveryScheduler) {
  const officialCorePorts = officialCorePortsForProjectEntry(projectEntry);
  ctx.systemPrompt.section({ name: "tool:project-collaboration", order: 114, text: () => "Only exact top-level roots may call project_collaboration and project_task. A newly launched root must first adopt_slot, then at adoption and every project-task boundary call read_requests and respond to rows with targetedToMe=true before taking unrelated work. Request kinds are dependency_unblock, release, handoff, and takeover; target responses are accept, reject, or release. Respect respondByAt: audit_resolve_request is eligible only when escalationEligible=true, including an early deadline only when the current root turn carries explicit direct-user authorization verified by the Host. Requests are durable and no-wake: never poll or wake a stopped root. Read the assigned project task, work it, explicitly submit project status/evidence, and call project_task claim_next with a new stable request_id. Repeat one task at a time until all_terminal, or blocked with every remaining blocker represented by one durable request. A temporarily_empty claim durably arms one deduplicated Host wake, so end the turn without polling; when that exact wake arrives, resume with read_requests and a fresh claim_next request_id. A root's private Agent Team may receive only bounded context for the current claimed project task; members retain team_task_* only and never call project tools. The root must reconcile Team deliverables into explicit project task status and evidence—Team reports or completion are not project evidence. For project_task add_dependency/remove_dependency, task_ref is the blocked dependent and payload.blockerTaskRef is the prerequisite; the Host persists blockerTaskRef -> task_ref. The Host derives project/actor identity; model outputs may expose mine, targetedToMe, and escalationEligible but never actor refs, raw session, workspace, filesystem, or project identities." });
  ctx.tools.register(defineTool({
    name: "project_collaboration",
    description: "Read or mutate the current canonical project's collaboration board using the invoking root's Host-derived seat. bind_legacy is a distinct one-time recovery action restricted to the exact current top-level direct-human root; ordinary initialize never claims legacy data. A newly launched root adopts its reserved seat with adopt_slot and only the opaque assigned slot_ref; the Host uses this routing ref to validate the exact ready child and privately redeem the one-time capability, which never enters tool arguments or model-visible data. Also supports board initialization, own-seat updates, resource locks, two-phase handoff, and delivery evidence. No raw actor/session/project/path identities are accepted; evidence paths and resource scopes are project-relative.",
    parameters: { action: { type: "string", required: true, enum: ["read", "initialize", "bind_legacy", "adopt_slot", "recover_root", "continue_root_recovery", "update_own_seat", "acquire_lock", "release_lock", "prepare_handoff", "commit_handoff", "add_evidence", "read_requests", "create_request", "respond_request", "cancel_request", "audit_resolve_request"] }, request_id: { type: "string" }, payload: { type: "object", additionalProperties: true } }, output: TOOL_OUTPUT,
    execute: async (args, exec) => {
      try {
        await ready;
        const execution = requireProjectRootCaller(ctx, exec);
        if (args.action === "bind_legacy" && !hasDirectHumanRootAuthority(ctx, execution)) reject("legacy project binding requires the exact current top-level direct-human root", "PROJECT_COLLABORATION_FORBIDDEN");
        let recoveryInput,rootFailureEvidence;
        if(args.action==="continue_root_recovery") requireDirectHumanRoot(ctx,execution);
        if(args.action==="recover_root") { requireDirectHumanRoot(ctx,execution); recoveryInput=projectToolPayload(args.payload,new Set(["failure_ref","mode","collaboration_request_ref"])); if(!["retry","takeover"].includes(recoveryInput.mode)) reject("root recovery mode is invalid","PROJECT_COLLABORATION_INVALID"); rootFailureEvidence=await projectSessionLaunch.rootFailureEvidence(execution,{failureRef:recoveryInput.failure_ref,projectBinding:{canonicalProjectKey:projectKeyForRoot(execution.agent),workspacePath:projectScopeForRoot(execution.agent),callerRootId:execution.agent.id}}); }
        const requestAction = ["read_requests", "create_request", "respond_request", "cancel_request", "audit_resolve_request"].includes(args.action);
        let recoverySchedule;
        try {
        const value = await withProjectCollaborationContext(projectEntry, execution, async ({ projectRef, collaboration, deriveOpaque }) => {
          if (args.action === "read") { const input = projectToolPayload(args.payload, new Set(["history_limit", "before_revision", "task_limit"])); return collaboration.snapshot(execution, { projectRef, historyLimit: input.history_limit, beforeRevision: input.before_revision, taskLimit: input.task_limit }); }
          if (args.action === "initialize" || args.action === "bind_legacy") { const input = projectToolPayload(args.payload, new Set(["title"])); return collaboration.createBoard(execution, { projectRef, title: input.title }); }
          if (args.action === "adopt_slot") { const input = projectToolPayload(args.payload, new Set(["slot_ref"])); return adoptProjectLaunchSlot(projectSessionLaunch, execution, { canonicalProjectKey: projectKeyForRoot(execution.agent), workspacePath: projectScopeForRoot(execution.agent), callerRootId: execution.agent.id }, projectRef, collaboration, input.slot_ref); }
          if(args.action==="continue_root_recovery") {
            const input=projectToolPayload(args.payload,new Set(["recovery_ref"])),binding={canonicalProjectKey:projectKeyForRoot(execution.agent),workspacePath:projectScopeForRoot(execution.agent),callerRootId:execution.agent.id},current=collaboration.getRootRecovery(execution,{projectRef,recoveryRef:input.recovery_ref});
            recoverySchedule={rootId:execution.agent.id,canonicalProjectKey:binding.canonicalProjectKey,recoveryRef:input.recovery_ref};
            const result=await officialCorePorts.recovery.continueRoot({ confirm: true, expectedRevision: current.revision, operation: () => continueProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,input.recovery_ref,current.revision) });
            return result;
          }
          if(args.action==="recover_root") {
            const requestId=nonEmptyString(args.request_id,"request_id",256),binding={canonicalProjectKey:projectKeyForRoot(execution.agent),workspacePath:projectScopeForRoot(execution.agent),callerRootId:execution.agent.id},recoveryRef=deriveOpaque("root-recovery",requestId);
            let current=collaboration.prepareRootRecovery(execution,{projectRef,recoveryRef,requestId:deriveOpaque("root-recovery-request",requestId),mode:recoveryInput.mode,failureRef:recoveryInput.failure_ref,collaborationRequestRef:recoveryInput.collaboration_request_ref}).recovery;
            recoverySchedule={rootId:execution.agent.id,canonicalProjectKey:binding.canonicalProjectKey,recoveryRef};
            if(current.state==="prepared") current=await reservePreparedProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,current,deriveOpaque);
            const result=await officialCorePorts.recovery.continueRoot({ confirm: true, expectedRevision: current.revision, operation: () => continueProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,recoveryRef,current.revision) });
            return result;
          }
          if (args.action === "update_own_seat") { const input = projectToolPayload(args.payload, new Set(["expected_revision", "state", "duty", "resource_scope", "phase", "next_step"])); return collaboration.upsertSeat(execution, { projectRef, expectedRevision: input.expected_revision, kind: "root", state: input.state, duty: input.duty, resourceScope: input.resource_scope, phase: input.phase, nextStep: input.next_step }); }
          if (args.action === "acquire_lock") { const input = projectToolPayload(args.payload, new Set(["resource_ref", "task_ref"])); return collaboration.acquireLock(execution, { projectRef, resourceRef: input.resource_ref, taskRef: input.task_ref }); }
          if (args.action === "release_lock") { const input = projectToolPayload(args.payload, new Set(["resource_ref", "force"])); return collaboration.releaseLock(execution, { projectRef, resourceRef: input.resource_ref, force: input.force }); }
          if (args.action === "prepare_handoff") { const input = projectToolPayload(args.payload, new Set(["handoff_ref", "task_ref", "target_actor_ref", "summary"])); return collaboration.prepareHandoff(execution, { projectRef, handoffRef: input.handoff_ref, taskRef: input.task_ref, targetActorRef: input.target_actor_ref, summary: input.summary }); }
          if (args.action === "commit_handoff") { const input = projectToolPayload(args.payload, new Set(["handoff_ref"])); return collaboration.commitHandoff(execution, { projectRef, handoffRef: input.handoff_ref }); }
          if (args.action === "add_evidence") { const input = projectToolPayload(args.payload, new Set(["evidence_ref", "task_ref", "path", "digest", "summary"])); return collaboration.addEvidence(execution, { projectRef, evidenceRef: input.evidence_ref, taskRef: input.task_ref, path: input.path, digest: input.digest, summary: input.summary }); }
          if (args.action === "read_requests") { const input = projectToolPayload(args.payload, new Set(["limit", "after_updated_at", "after_request_ref"])); return collaboration.collaborationRequestWindow(execution, { projectRef, limit: input.limit, afterUpdatedAt: input.after_updated_at, afterRequestRef: input.after_request_ref }); }
          if (args.action === "create_request") { const requestId = nonEmptyString(args.request_id, "request_id", 256); const input = projectToolPayload(args.payload, new Set(["kind", "task_ref", "dependency_task_ref", "reason", "respond_by_at"])); return collaboration.requestCollaboration(execution, { projectRef, requestRef: deriveOpaque("request", requestId), requestId: deriveOpaque("request-id", requestId), kind: input.kind, taskRef: input.task_ref, dependencyTaskRef: input.dependency_task_ref, reason: input.reason, respondByAt: input.respond_by_at }); }
          if (args.action === "respond_request") { const input = projectToolPayload(args.payload, new Set(["request_ref", "expected_revision", "response", "resolution"])); return collaboration.respondCollaborationRequest(execution, { projectRef, requestRef: input.request_ref, expectedRevision: input.expected_revision, action: input.response, resolution: input.resolution }); }
          if (args.action === "cancel_request") { const input = projectToolPayload(args.payload, new Set(["request_ref", "expected_revision", "resolution"])); return collaboration.cancelCollaborationRequest(execution, { projectRef, requestRef: input.request_ref, expectedRevision: input.expected_revision, resolution: input.resolution }); }
          if (args.action === "audit_resolve_request") { const input = projectToolPayload(args.payload, new Set(["request_ref", "expected_revision", "resolution"])); return collaboration.resolveCollaborationRequest(execution, { projectRef, requestRef: input.request_ref, expectedRevision: input.expected_revision, resolution: input.resolution }); }
          reject("unsupported project collaboration action", "PROJECT_COLLABORATION_INVALID");
        }, {
          earlyResolutionAuthorizer: ({ execution: candidate }) => candidate === execution && hasDirectHumanRootAuthority(ctx, execution),
          rootFailureResolver: ({execution:candidate,failureRef,mode}) => candidate===execution&&failureRef===recoveryInput?.failure_ref&&mode===recoveryInput?.mode?rootFailureEvidence:undefined,
          bindLegacy: args.action === "bind_legacy",
        });
        if (!new Set(["read", "read_requests"]).has(args.action)) {
          await withProjectCollaborationContext(projectEntry, execution, async (binding) => {
            if (binding.isBoardAvailable()) await dispatchProjectTaskWakeSignals(ctx, binding);
          });
        }
        return publicResult(requestAction ? projectRequestModelResult(value) : projectCollaborationModelResult(value));
        } finally { if(recoverySchedule!==undefined) projectRootRecoveryScheduler?.(recoverySchedule); }
      } catch (error) { return projectToolFailure(error); }
    }, presentCall: (args) => present("Project collaboration", args.action),
  }));
  ctx.tools.register(defineTool({
    name: "project_task",
    description: "Create, list, claim, atomically claim_next one eligible item, update, submit, review, transition, comment on, or edit current-project task dependencies. list returns each task's current prerequisite refs in blockedBy. For add_dependency/remove_dependency, task_ref is always the BLOCKED dependent task and payload.blockerTaskRef is always its prerequisite; the Host stores blockerTaskRef -> task_ref and derives the relation reference. create and edit accept an optional integer priority from 0 through 1000000; edit priority null clears it. request_id is stable and Host-derives refs. claim_next enforces one in_progress item per root and returns all_terminal, temporarily_empty, or blocked when nothing is eligible. The current canonical project and invoking root actor are Host-derived.",
    parameters: { action: { type: "string", required: true, enum: ["list", "create", "claim", "claim_next", "edit", "add_dependency", "remove_dependency", "start_attempt", "submit_attempt", "review", "transition", "comment", "receipt"] }, request_id: { type: "string" }, task_ref: { type: "string" }, expected_revision: { type: "number" }, payload: { type: "object", additionalProperties: true } }, output: TOOL_OUTPUT,
    execute: async (args, exec) => {
      try {
        await ready;
        const execution = requireProjectRootCaller(ctx, exec);
        const value = await withProjectCollaborationContext(projectEntry, execution, async (binding) => {
          const { projectRef, collaboration, tasks, isBoardAvailable, deriveOpaque } = binding;
          if (args.action === "list") { const input = projectToolPayload(args.payload, new Set(["history_limit", "before_revision", "task_limit"])); return collaboration.snapshot(execution, { projectRef, historyLimit: input.history_limit, beforeRevision: input.before_revision, taskLimit: input.task_limit }); }
          if (!isBoardAvailable()) reject("initialize the project collaboration board before mutating project tasks", "PROJECT_COLLABORATION_NOT_INITIALIZED");
          if (args.action === "receipt") return tasks.getCommandReceipt(execution, { projectRef, commandId: deriveOpaque("command", args.request_id) });
          let result;
          if (args.action === "claim_next") {
            projectToolPayload(args.payload, new Set());
            result = collaboration.claimNextTask(execution, { projectRef, requestId: deriveOpaque("claim-next", args.request_id) });
          } else {
            const types = { create: "create", claim: "claim", edit: "edit_requirements", add_dependency: "dependency.add", remove_dependency: "dependency.remove", start_attempt: "attempt.start", submit_attempt: "attempt.submit", review: "review", transition: "transition", comment: "comment" };
            const allowed = {
              create: new Set(["title", "requirements", "fileScope", "priority"]), edit: new Set(["title", "requirements", "fileScope", "priority"]), claim: new Set(), add_dependency: new Set(["blockerTaskRef"]), remove_dependency: new Set(["blockerTaskRef"]), start_attempt: new Set(["attemptRef"]), submit_attempt: new Set(["attemptRef"]), review: new Set(["reviewRef", "attemptRef", "verdict", "body"]), transition: new Set(["to", "blockReason", "attemptRef", "reviewRef"]), comment: new Set(["commentRef", "kind", "body"]),
            }[args.action];
            const inputPayload = projectToolPayload(args.payload, allowed ?? new Set());
            const payload = args.action === "add_dependency" ? { ...inputPayload, relationRef: deriveOpaque("relation", args.request_id) } : inputPayload;
            const commandId = deriveOpaque("command", args.request_id), eventRef = deriveOpaque("event", args.request_id);
            const taskRef = args.action === "create" ? deriveOpaque("task", args.request_id) : args.task_ref;
            result = tasks.executeCommand(execution, { projectRef, taskRef, commandId, eventRef, type: types[args.action], expectedRevision: args.action === "create" ? 0 : args.expected_revision, payload });
          }
          await dispatchProjectTaskWakeSignals(ctx, binding);
          return result;
        });
        return publicResult(args.action === "list" ? projectCollaborationModelResult(value) : projectTaskModelResult(value));
      } catch (error) { return projectToolFailure(error); }
    }, presentCall: (args) => present("Project task", args.task_ref ?? args.request_id),
  }));
}

async function adoptProjectLaunchSlot(projectSessionLaunch, execution, projectBinding, projectRef, collaboration, slotRef) {
  const redemption = await projectSessionLaunch.redeemAdoption(execution, { slotRef, projectBinding });
  try {
    // Project Entry and the Host launch service intentionally use independent
    // authority domains for their opaque project refs. Exact canonical-lane
    // equality was already enforced inside redeemAdoption from Host-derived data.
    const adopted=collaboration.adoptRootSeat(execution, { projectRef, slotActorRef: redemption.slotActorRef, slotCapability: redemption.slotCapability });
    await projectSessionLaunch.recordAdoption(execution,{slotRef,adoptedActorRef:adopted.seat.actorRef,projectBinding});
    return adopted;
  } finally { redemption.slotCapability = undefined; }
}
async function ensureProjectLaunchBoard(projectEntry, execution) {
  return withProjectCollaborationContext(projectEntry, execution, ({ projectRef, collaboration }) => {
    let snapshot = collaboration.snapshot(execution, { projectRef, historyLimit: 1, taskLimit: 1 });
    if (!snapshot.available) {
      if (snapshot.writable !== true) reject("only a project_lead coordinator may initialize the collaboration board", "PROJECT_COLLABORATION_FORBIDDEN");
      collaboration.createBoard(execution, { projectRef, title: "Project collaboration" });
      snapshot = collaboration.snapshot(execution, { projectRef, historyLimit: 1, taskLimit: 1 });
    }
    if (!snapshot.available || snapshot.permissions?.canCreate !== true) reject("only the project_lead coordinator may launch project sessions", "PROJECT_COLLABORATION_FORBIDDEN");
    return { projectRef };
  });
}
async function reserveProjectLaunchSlots(projectEntry, execution, args) {
  return withProjectCollaborationContext(projectEntry, execution, async ({ projectRef, collaboration, deriveOpaque }) => {
    const snapshot = collaboration.snapshot(execution, { projectRef, historyLimit: 1, taskLimit: 1 });
    if (!snapshot.available || snapshot.permissions?.canCreate !== true) reject("only the project_lead coordinator may launch project sessions", "PROJECT_COLLABORATION_FORBIDDEN");
    const intentRef = deriveOpaque("launch-intent", args.request_id), reservations = [], publicSlots = [];
    for (let index = 0; index < args.slots.length; index += 1) {
      const slot = args.slots[index], adoption = args.prepared[index], slotActorRef = deriveOpaque("slot-actor", adoption.slotRef), taskRef = deriveOpaque("task", "session-launch", args.request_id, index), requestId = deriveOpaque("reservation", args.request_id, index);
      try {
        const result = collaboration.reserveRootSeat(execution, { projectRef, requestId, slotActorRef, slotCapability: adoption.adoptionCapability, duty: slot.role, resourceScope: slot.resources, phase: "queued", nextStep: "Adopt this reserved root seat before project work", task: { taskRef, title: slot.role, requirements: slot.task, fileScope: slot.resources } });
        reservations.push({ slotActorRef, taskRef, slotRef: adoption.slotRef, operationRef: adoption.operationRef });
        publicSlots.push({ seatRef: slotActorRef, taskRef, state: "reserved", duplicate: result.duplicate === true, projectRevision: result.projectRevision });
      } catch (error) {
        publicSlots.push({ seatRef: slotActorRef, taskRef, state: "reservation_failed", errorCode: typeof error?.code === "string" ? error.code : "PROJECT_SESSION_LAUNCH_RESERVATION_FAILED" });
        for (let pending = index + 1; pending < args.slots.length; pending += 1) publicSlots.push({ seatRef: deriveOpaque("slot-actor", args.prepared[pending].slotRef), taskRef: deriveOpaque("task", "session-launch", args.request_id, pending), state: "pending" });
        return { complete: false, intentRef, reservations, failedIndex: index, slots: publicSlots };
      }
    }
    return { complete: true, intentRef, reservations, slots: publicSlots };
  });
}
function projectSessionLaunchFailure(error) {
  return { ok: false, error: { code: typeof error?.code === "string" ? error.code : "PROJECT_SESSION_LAUNCH_FAILED", action: error?.code === "PROJECT_SESSION_LAUNCH_HOST_UNAVAILABLE" ? "install_or_enable_host_project_session_launch_capability" : error?.code === "PROJECT_SESSION_LAUNCH_CAPACITY" ? "ask_for_a_feasible_total" : error?.code === "PROJECT_SESSION_LAUNCH_OUTCOME_UNKNOWN" ? "inspect_batch_status_without_retrying" : "inspect_or_fix_request", retryable: false } };
}
function registerProjectSessionLaunchTool(ctx, projectEntry, runtime, ready = Promise.resolve()) {
  ctx.systemPrompt.section({
    name: "tool:project-session-launch",
    order: 115,
    text: () => [
      "When the direct user explicitly requests multiple real top-level sessions for project collaboration, ask once for the TOTAL session count and say that it includes the current root session. Do not call project_session_launch until the current user has answered with that total.",
      "Persist one role, resource scope, and initial task for each of the N-1 new roots. Never use team_spawn, hidden subagents, or represent these roots as one Agent Team. Each created root may later create its own independent Agent Team.",
      "Use one stable request_id. A repeated request_id is status-safe only for byte-equivalent input; never blindly retry outcome_unknown. Use action=status to reconcile. Only an explicit direct-user action=retry_failed may retry the exact definitively failed slot with its existing Host operation; action=stop follows an explicit Stop/cancel request.",
    ].join("\n"),
  });
  ctx.tools.register(defineTool({
    name: "project_session_launch",
    description: "After the current direct user confirms the TOTAL top-level session count (including this root), durably persist N-1 project-board slots/tasks and queue creation of N-1 real same-project top-level sessions through the Host capability. Never uses Agent Teams members or hidden subagents. Stable request_id is idempotent; status reconciles unknown outcomes; stop cancels queued work.",
    parameters: {
      action: { type: "string", required: true, enum: ["start", "status", "resolve_unknown", "retry_failed", "stop"] },
      request_id: { type: "string", description: "Stable idempotency key required for start and resolve_unknown." },
      total_sessions: { type: "number", description: "Confirmed total including the current root; required for start." },
      batch_ref: { type: "string", description: "Opaque batch reference required for status/stop." },
      slot_ref: { type: "string", description: "Exact slot required for resolve_unknown/retry_failed." },
      decision: { type: "string", enum: ["delivered", "not_delivered"], description: "Host-authorized prompt outcome required for resolve_unknown." },
      expected_revision: { type: "number", description: "Exact Host operation revision required for resolve_unknown OCC." },
      slots: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string", required: true }, role: { type: "string", required: true }, resources: { type: "array", required: true, items: { type: "string" } }, task: { type: "string", required: true } } }, description: "Exactly total_sessions-1 new-root slots; persisted before any session effect." },
    }, output: TOOL_OUTPUT,
    execute: async (args, exec) => {
      try {
        await ready;
        const execution = toolExecution(ctx, exec);
        if (!ctx.agents.roots().includes(execution.agent)) reject("project_session_launch requires a top-level root", "PROJECT_SESSION_LAUNCH_FORBIDDEN");
        const projectBinding = { canonicalProjectKey: projectKeyForRoot(execution.agent), workspacePath: projectScopeForRoot(execution.agent), callerRootId: execution.agent.id };
        if (args.action === "start") {
          requireDirectHumanRoot(ctx, execution);
          const slots = runtime.validateSlots(args.total_sessions, args.slots);
          await ensureProjectLaunchBoard(projectEntry, exec);
          const preparedBatch = await runtime.prepareStart(exec, { requestId: args.request_id, totalSessions: args.total_sessions, slots, projectBinding });
          if (preparedBatch.noHostEffects !== true) return publicResult(await runtime.start(exec, { batchRef: preparedBatch.batchRef, projectBinding }));
          const adoptions = await runtime.prepareAdoptions(exec, { batchRef: preparedBatch.batchRef, projectBinding });
          const reservation = await reserveProjectLaunchSlots(projectEntry, exec, { request_id: args.request_id, slots, prepared: adoptions.prepared });
          if (!reservation.complete) return publicResult(await runtime.recordReservationFailure(exec, { batchRef: preparedBatch.batchRef, reservations: reservation.reservations, failedIndex: reservation.failedIndex, errorCode: reservation.slots[reservation.failedIndex]?.errorCode, projectBinding }));
          return publicResult(await runtime.activatePreparedBatch(exec, { batchRef: preparedBatch.batchRef, reservations: reservation.reservations, projectBinding }));
        }
        if (args.action === "status") return publicResult(await runtime.status(exec, { batchRef: args.batch_ref, projectBinding }));
        if (args.action === "resolve_unknown") { requireDirectHumanRoot(ctx, execution); return publicResult(await runtime.resolveUnknownSlot(exec,{slotRef:args.slot_ref,requestId:args.request_id,decision:args.decision,expectedRevision:args.expected_revision,projectBinding})); }
        if (args.action === "retry_failed") { requireDirectHumanRoot(ctx, execution); return publicResult(await runtime.retryFailedSlot(exec,{slotRef:args.slot_ref,projectBinding})); }
        if (args.action === "stop") return publicResult(await runtime.stop(exec, { batchRef: args.batch_ref, projectBinding }));
        reject("unsupported project session launch action", "PROJECT_SESSION_LAUNCH_INVALID");
      } catch (error) { return projectSessionLaunchFailure(error); }
    },
    presentCall: (args) => present(`${args.action === "start" ? "Launch" : args.action === "stop" ? "Stop" : args.action === "resolve_unknown" ? "Reconcile" : "Inspect"} top-level project sessions`, args.batch_ref ?? args.request_id),
  }));
}

function registerTools(ctx, store, ready, collaboration, admission, resolveUnknownAuthorization, authorizationProvider) {
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
    name: "team_route_goal",
    description: "Persist the Host-scoped Level 1, Level 2, or initial Level 3 routing decision for this direct-human goal turn or its exact admitted automatic continuation before substantive work. A later team_start/team_bootstrap finalizes the same immutable Level 3 decision with its Host-validated team and outcome. Decision fields are model-declared; identity, canonical project, open turn, and final team scope are Host-derived. This receipt does not force or prove model routing.",
    parameters: {
      level: { type: "string", required: true, enum: ROUTING_LEVELS },
      reason_category: { type: "string", required: true, enum: ROUTING_REASON_CATEGORIES },
      explicit_user_team_request: { type: "boolean" },
      candidate_workstreams: { type: "number", required: true },
      creation_path: { type: "string", required: true, enum: ROUTING_CREATION_PATHS },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      requireTeamCreationRoot(ctx, execution);
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const goalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      return publicResult(await recordRoutingReceipt(store, execution, { level: args.level, reasonCategory: args.reason_category, explicitUserTeamRequest: args.explicit_user_team_request, candidateWorkstreams: args.candidate_workstreams, creationPath: args.creation_path, outcome: "recorded", establishmentAuthority: directHuman ? "direct_human" : "goal_round", goalRoundAuthority }));
    }),
    presentCall: (args) => present("Record goal routing decision", args.level),
  }));
  ctx.tools.register(defineTool({
    name: "team_start",
    description: "Start a durable peer team owned by this fixed top-level root lead. Use this manual creation path only when a complete bounded team_bootstrap plan is not ready; never call team_start before team_bootstrap for the same team. Call this in the current authorized root turn as soon as you identify at least two sustained independent workstreams that require visible managed members and ongoing coordination; do not substitute multiple ordinary subagents. An exact admitted automatic continuation of the root's active, armed goal carries creation authority without another user message. Automatic use normally requires at least two sustained independent workstreams delegated to different visible workers; the lead does not count, and one continuable helper should use ordinary subagent instead. An explicit user team request may override this automatic threshold. At most 8 teams may remain unclosed, and all peers share maxActiveTurns. Requires either direct-human root authority or the exact current admitted goal continuation in the open turn.",
    parameters: {
      request_id: { type: "string", required: true, description: "Stable idempotency key. Exact replay reuses the durably created team." },
      objective: { type: "string", required: true, description: "Concrete objective shared by the team." },
      name: { type: "string", description: "Optional short team display name." },
      lead_name: { type: "string", description: "Optional display name for the root lead." },
      explicit_user_team_request: { type: "boolean", description: "Model-declared true only when the direct user explicitly requested a team; this is audited but is not Host proof." },
      candidate_workstreams: { type: "number", required: true, description: "Model-declared number of sustained independent workstreams identified by the routing gate." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      requireTeamCreationRoot(ctx, execution);
      // Refresh Host-managed policy before deriving the one-time Goal grant intent.
      await store.read(() => undefined);
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const establishmentAuthority = directHuman ? "direct_human" : "goal_round";
      const goalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      const directHumanGrantIntent = !directHuman || !store.autopilotPolicy().enabled ? undefined : await exactDirectHumanAutopilotGrantIntent(ctx, authorizationProvider, execution);
      const goalRoundGrantIntent = directHuman || !store.autopilotPolicy().enabled ? undefined : await exactGoalRoundAutopilotGrantIntent(ctx, authorizationProvider, execution, goalRoundAuthority);
      const routingDecision = { level: "level3", reasonCategory: args.explicit_user_team_request === true ? "explicit_user_team_request" : "independent_sustained_workstreams", explicitUserTeamRequest: args.explicit_user_team_request, candidateWorkstreams: args.candidate_workstreams, creationPath: "team_start" };
      const recorded = await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "recorded", establishmentAuthority, goalRoundAuthority });
      try {
        const team = await createTeam(store, execution.agent, { requestId: args.request_id, objective: args.objective, name: args.name, leadName: args.lead_name, routingReceiptId: recorded.receipt.id, autopilotGoal: ctx.goals?.get?.(execution.agent), directHumanGrantIntent, goalRoundGrantIntent });
        const routing = await store.read((document) => ({ receipt: clone(document.routingReceipts.find((receipt) => receipt.id === recorded.receipt.id)), reused: recorded.reused }));
        return publicResult({ team, routing });
      } catch (error) {
        try { await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "failed", establishmentAuthority, goalRoundAuthority }); } catch {}
        throw error;
      }
    }),
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
    execute: run(async (args, execution) => {
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const automaticGoalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      return publicResult(await commitTeamPlan(ctx, store, execution.agent, { teamId: args.team_id, expectedRevision: args.expected_revision, confirmedPlanHash: args.confirmed_plan_hash, permissionsVerified: args.permissions_verified, filesVerified: args.files_verified, costVerified: args.cost_verified, externalSideEffectsVerified: args.external_side_effects_verified, automaticContinuation: !directHuman, automaticGoalRoundAuthority, authorizationProvider, ...(directHuman ? { autopilotGoal: ctx.goals?.get?.(execution.agent) } : {}) }));
    }),
    presentCall: (args) => present("Commit agent team plan", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_bootstrap",
    description: "Create one bounded team plan, persist all tasks before work starts, and provision up to the configured member/active-turn capacity (hard maximum 8 visible peers). Use this directly instead of team_start when the complete plan is ready; never call both for the same team. Different members must have non-overlapping file scopes. Requires either the exact direct-human root turn or the exact admitted automatic continuation of that root's active, armed goal. request_id makes exact replays reuse the same durable plan; uncertain partial starts fail closed and never duplicate a visible member automatically.",
    parameters: {
      request_id: { type: "string", required: true }, objective: { type: "string", required: true }, name: { type: "string" }, lead_name: { type: "string" },
      explicit_user_team_request: { type: "boolean", description: "Model-declared true only when the direct user explicitly requested a team; this is audited but is not Host proof." },
      candidate_workstreams: { type: "number", required: true, description: "Model-declared number of sustained independent workstreams identified by the routing gate." },
      tasks: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { key: { type: "string", required: true }, title: { type: "string", required: true }, description: { type: "string" }, member_key: { type: "string", required: true }, depends_on: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } } } } },
      members: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { key: { type: "string", required: true }, name: { type: "string", required: true }, role: { type: "string", required: true }, prompt: { type: "string", required: true }, model_tier: { type: "string", enum: MODEL_TIERS }, model: { type: "string" } } } },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => {
      requireTeamCreationRoot(ctx, execution);
      // Refresh Host-managed policy before deriving the one-time Goal grant intent.
      await store.read(() => undefined);
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const establishmentAuthority = directHuman ? "direct_human" : "goal_round";
      const goalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      const directHumanGrantIntent = !directHuman || !store.autopilotPolicy().enabled ? undefined : await exactDirectHumanAutopilotGrantIntent(ctx, authorizationProvider, execution);
      const goalRoundGrantIntent = directHuman || !store.autopilotPolicy().enabled ? undefined : await exactGoalRoundAutopilotGrantIntent(ctx, authorizationProvider, execution, goalRoundAuthority);
      const routingDecision = { level: "level3", reasonCategory: args.explicit_user_team_request === true ? "explicit_user_team_request" : "independent_sustained_workstreams", explicitUserTeamRequest: args.explicit_user_team_request, candidateWorkstreams: args.candidate_workstreams, creationPath: "team_bootstrap" };
      const recorded = await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "recorded", establishmentAuthority, goalRoundAuthority });
      try {
        const result = await bootstrapTeam(ctx, store, admission, execution.agent, { requestId: args.request_id, objective: args.objective, name: args.name, leadName: args.lead_name, routingReceiptId: recorded.receipt.id, autopilotGoal: ctx.goals?.get?.(execution.agent), directHumanGrantIntent, goalRoundGrantIntent, tasks: (args.tasks ?? []).map((task) => ({ key: task.key, title: task.title, description: task.description, memberKey: task.member_key, dependsOn: task.depends_on, files: task.files })), members: (args.members ?? []).map((member) => ({ key: member.key, name: member.name, role: member.role, prompt: member.prompt, modelTier: member.model_tier, model: member.model })) }, signal);
        const routing = await store.read((document) => ({ receipt: clone(document.routingReceipts.find((receipt) => receipt.id === recorded.receipt.id)), reused: recorded.reused || result.operation.reused }));
        return publicResult({ ...result, routing });
      } catch (error) {
        try { await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "failed", establishmentAuthority, goalRoundAuthority }); } catch {}
        throw error;
      }
    }),
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
    name: "team_member_recover",
    description: "Explicitly retry an exact failed continuable member or replace it with one visible same-level member. Requires the current direct-human root turn, a stable request_id, and exact team revision. Retry preserves task claims and leases. Replace durably revokes prior claims, preserves audit/checkpoint evidence, and pre-binds the same tasks before starting the replacement. Replays never duplicate a model turn or member.",
    parameters: { team_id: { type: "string", required: true }, member_id: { type: "string", required: true }, action: { type: "string", required: true, enum: MEMBER_RECOVERY_ACTIONS }, request_id: { type: "string", required: true }, expected_revision: { type: "number", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => { requireDirectHumanRoot(ctx, execution); return publicResult(await recoverFailedMember(ctx, store, admission, execution.agent, { teamId: args.team_id, memberId: args.member_id, action: args.action, requestId: args.request_id, expectedRevision: args.expected_revision }, signal)); }),
    presentCall: (args) => present(args.action === "replace" ? "Replace failed team member" : "Retry failed team member", args.member_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_member_reconcile",
    description: "Direct-human reconciliation for one exact outcome_unknown member-recovery receipt. Reuses the durable request_id and never starts or redelivers a model turn.",
    parameters: { team_id: { type: "string", required: true }, request_id: { type: "string", required: true }, resolution: { type: "string", required: true, enum: ["delivered", "not_delivered"] }, expected_revision: { type: "number", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await reconcileMemberRecovery(ctx, store, execution.agent, { teamId: args.team_id, requestId: args.request_id, resolution: args.resolution, expectedRevision: args.expected_revision })); }),
    presentCall: (args) => present("Reconcile member recovery", args.request_id),
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
    name: "team_task_update", description: "Atomically claim, release, submit completion for review, independently accept or reject, cancel, reopen, assign, or unassign a team task. An explicit action is always required. Fixed-root destructive commands (release/accept/reject/cancel/reopen/assign/unassign) require request_id, expected_task_revision, and expected_pause_epoch; member release instead requires the current claim_id and lease_epoch. Exact durable replays are idempotent and stale commands fail closed. Only the exact claimant may submit with its claimId/leaseEpoch. Submission remains non-authoritative until the fixed root accepts it; only acceptance marks completed and unlocks dependencies. Lifecycle history is append-only and survives reopen.",
    parameters: { team_id: { type: "string" }, task_id: { type: "string", required: true }, action: { type: "string", required: true, enum: ["claim", "release", "complete", "accept", "reject", "cancel", "reopen", "assign", "unassign"], description: "Explicit requested transition; repeated claim and exact submission replay are safe no-ops" }, state: { type: "string", enum: MUTABLE_TASK_STATES }, assignee_session_id: { type: "string", description: "target member id or unique member name for assign; must be the current assignee to be a no-op, otherwise the task must still be pending" }, claim_id: { type: "string", description: "Required for non-lead release/complete; exact claimId returned by claim." }, lease_epoch: { type: "number", description: "Required for non-lead release/complete; exact leaseEpoch returned by claim." }, request_id: { type: "string", description: "Required stable idempotency key for fixed-root destructive commands." }, expected_task_revision: { type: "number", description: "Required current task revision for fixed-root destructive commands." }, expected_pause_epoch: { type: "number", description: "Required current team pause epoch for fixed-root destructive commands." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await updateTask(store, execution.agent, { teamId: args.team_id, taskId: args.task_id, action: args.action, state: args.state, assigneeSessionId: args.assignee_session_id, claimId: args.claim_id, leaseEpoch: args.lease_epoch, requestId: args.request_id, expectedTaskRevision: args.expected_task_revision, expectedPauseEpoch: args.expected_pause_epoch, requireFixedRootCommand: true }))),
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
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await resumePausedTeam(ctx, store, execution.agent, { teamId: args.team_id, requestId: args.request_id, commit: args.commit, previewId: args.preview_id, expectedPauseEpoch: args.expected_pause_epoch, expectedTeamRevision: args.expected_team_revision, autopilotGoal: ctx.goals?.get?.(execution.agent) })); }),
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
    execute: run(async (args, execution, signal) => publicResult(await shutdownTeam(ctx, store, admission, execution.agent, { teamId: args.team_id, memberSessionId: args.member_session_id, force: args.force }, signal, authorizationProvider))),
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
function trustedRequest(req, { requireOrigin = false } = {}) {
  const rawHost = req.headers.host;
  if (typeof rawHost !== "string") return false;
  let host;
  try { host = new URL(`http://${rawHost}`).hostname.toLowerCase(); } catch { return false; }
  if (host !== "127.0.0.1" && host !== "localhost") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return !requireOrigin;
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

function agentTeamAutopilotHostTeamScopeHash(teams) {
  const material = [...teams].sort((left, right) => left.id.localeCompare(right.id)).map((team) => [
    team.id,
    team.rootLeadSessionId,
    team.projectKey ?? null,
    effectiveTeamState(team),
    team.pauseEpoch ?? 0,
    team.plan?.phase ?? null,
    team.plan?.hash ?? null,
  ]);
  return createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-host-team-scope-v1", material])).digest("hex");
}
function normalizeAgentTeamAutopilotHostScope(value) {
  if (!isRecord(value)) reject("automatic continuation requires an exact Desktop Host scope", "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID");
  assertAllowedKeys(value, AGENT_TEAM_AUTOPILOT_HOST_SCOPE_KEYS, "hostAuthorization");
  const scope = {
    rootSessionId: nonEmptyString(value.rootSessionId, "hostAuthorization.rootSessionId", 256),
    projectKey: nonEmptyString(value.projectKey, "hostAuthorization.projectKey", 64),
    goalId: nonEmptyString(value.goalId, "hostAuthorization.goalId", 256),
    teamId: nonEmptyString(value.teamId, "hostAuthorization.teamId", 256),
    pauseEpoch: positiveInteger(value.pauseEpoch, "hostAuthorization.pauseEpoch", { allowZero: true }),
    teamScopeHash: nonEmptyString(value.teamScopeHash, "hostAuthorization.teamScopeHash", 64),
  };
  if (!/^[a-f0-9]{64}$/u.test(scope.projectKey) || !/^[a-f0-9]{64}$/u.test(scope.teamScopeHash)) reject("automatic continuation project scope is invalid", "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID");
  return scope;
}
function verifyAgentTeamAutopilotAuthorizationReceipt(receipt, expected) {
  if (!isRecord(receipt) || receipt.tool !== "team_autopilot" || receipt.authorizationId !== expected.authorizationId
    || receipt.sessionId !== expected.sessionId
    || JSON.stringify(receipt.hostAuthorization) !== JSON.stringify(expected.hostAuthorization)
    || !isRecord(receipt.settings) || Object.keys(expected.settings).some((key) => receipt.settings[key] !== expected.settings[key])
    || typeof receipt.desktopBindingHash !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.desktopBindingHash)
    || typeof receipt.authorizationEpoch !== "string" || !/^[A-Za-z0-9_-]{16,128}$/u.test(receipt.authorizationEpoch)
    || !agentTeamAutopilotSettingsProofMatches(receipt, expected.settings)
    || !Number.isSafeInteger(receipt.issuedAt) || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now()) {
    reject("Desktop Host automatic-continuation authorization did not match the exact request", "AGENT_TEAMS_HOST_AUTHORIZATION_INVALID");
  }
  return receipt.authorizationEpoch;
}
function attachAuthorizedAgentTeamAutopilot(ctx, document, scope, settings, authorizationEpoch) {
  const root = ctx.agents.get(scope.rootSessionId);
  if (root === undefined || ctx.agents.get(root.id) !== root || !ctx.agents.roots().includes(root)) reject("automatic continuation requires the exact live root", "AGENT_TEAMS_UNAUTHORIZED");
  const team = findTeam(document, scope.teamId);
  const goal = ctx.goals?.get?.(root);
  if (team.rootLeadSessionId !== root.id || effectiveTeamState(team) !== "active" || team.projectKey !== scope.projectKey
    || optionalProjectKeyForRoot(root) !== scope.projectKey || (team.pauseEpoch ?? 0) !== scope.pauseEpoch
    || goal?.id !== scope.goalId || goal.phase !== "active") {
    reject("automatic continuation scope changed before Host authorization was consumed", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
  }
  const openTeams = document.teams.filter((candidate) => candidate.rootLeadSessionId === root.id && candidate.state !== "closed");
  if (!openTeams.includes(team) || openTeams.length === 0 || agentTeamAutopilotHostTeamScopeHash(openTeams) !== scope.teamScopeHash) {
    reject("automatic continuation team group changed before Host authorization was consumed", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
  }
  const exactParkedGroup = goal.activation === "disarmed" && openTeams.every((candidate) => ["pending_plan", "active"].includes(candidate.autopilot?.status)
    && candidate.autopilot.rootSessionId === root.id && candidate.autopilot.projectKey === scope.projectKey
    && candidate.autopilot.goalId === goal.id && candidate.autopilot.pauseEpochAtGrant === (candidate.pauseEpoch ?? 0));
  if (goal.activation !== "armed" && !exactParkedGroup) reject("automatic continuation requires the exact armed Goal or its complete safely parked grant group", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
  const existingLive = openTeams.filter((candidate) => ["pending_plan", "active"].includes(candidate.autopilot?.status));
  if (existingLive.length > 0 && existingLive.length !== openTeams.length) {
    reject("automatic continuation cannot rebind an incomplete live grant group", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
  }
  if (existingLive.some((candidate) => pendingAgentTeamAutopilotWake(candidate.autopilot) !== undefined)) {
    reject("automatic continuation cannot rebind while a durable wake is pending", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
  }
  if (existingLive.some((candidate) => candidate.autopilot.rootSessionId !== root.id || candidate.autopilot.projectKey !== scope.projectKey
    || candidate.autopilot.goalId !== goal.id || candidate.autopilot.goalObjectiveHash !== agentTeamAutopilotObjectiveHash(goal.objective)
    || candidate.autopilot.pauseEpochAtGrant !== (candidate.pauseEpoch ?? 0) || candidate.autopilot.expectedMaxGoalRounds !== goal.maxGoalRounds
    || candidate.autopilot.additionalRoundsGranted > settings.autopilotMaxAdditionalRounds)) {
    reject("automatic continuation cannot reset consumed rounds or rebind stale grant facts", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
  }
  const grants = openTeams.map((candidate) => {
    if (effectiveTeamState(candidate) !== "active" || candidate.projectKey !== scope.projectKey || candidate.closure !== undefined || candidate.handoff !== undefined
      || (candidate.memberRecoveries ?? []).some((receipt) => receipt.status === "outcome_unknown" || receipt.status === "prepared")) {
      reject("automatic continuation can authorize only the exact safe open team group", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
    }
    const routingReceipt = [...document.routingReceipts].reverse().find((receipt) => receipt.teamId === candidate.id
      && receipt.rootSessionId === root.id && receipt.establishmentAuthority === "direct_human" && ["created", "reused"].includes(receipt.outcome))
      ?? document.routingReceipts.find((receipt) => receipt.id === candidate.autopilot?.routingReceiptId
        && receipt.establishmentAuthority === "direct_human" && ["created", "reused"].includes(receipt.outcome));
    if (routingReceipt === undefined) reject("automatic continuation requires direct-human team establishment evidence", "AGENT_TEAMS_UNAUTHORIZED");
    const planHash = candidate.plan?.phase === "active" && teamHasEstablishedWorker(candidate) && planAuthorizationSupportsAutopilot(candidate)
      && planCapabilitiesAreVerified(candidate) && planFilesAreConflictFree(candidate) && planEffectsAreOrdinary(candidate) ? candidate.plan.hash : undefined;
    let grant;
    if (["pending_plan", "active"].includes(candidate.autopilot?.status)) {
      grant = clone(candidate.autopilot);
      grant.grantId = randomUUID();
      grant.routingReceiptId = routingReceipt.id;
      grant.authorizationEpoch = authorizationEpoch;
      grant.status = planHash === undefined ? "pending_plan" : "active";
      grant.maxAdditionalRounds = settings.autopilotMaxAdditionalRounds;
      grant.grantedAt = now();
      grant.revokedAt = undefined;
      grant.revokeReason = undefined;
      if (planHash === undefined) grant.planHashAtGrant = undefined;
      else grant.planHashAtGrant = planHash;
      if (goal.activation === "armed") {
        grant.parkedGoalRevision = undefined;
        grant.parkedAt = undefined;
      }
    } else {
      grant = createAgentTeamAutopilotGrant(root, goal, {
        authorizationEpoch,
        planHash,
        pauseEpoch: candidate.pauseEpoch ?? 0,
        routingReceiptId: routingReceipt.id,
        maxAdditionalRounds: settings.autopilotMaxAdditionalRounds,
      });
    }
    if (grant === undefined) reject("automatic continuation grant facts are incomplete", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
    return [candidate, grant];
  });
  const timestamp = now();
  for (const [candidate, grant] of grants) { candidate.autopilot = grant; candidate.updatedAt = timestamp; }
  return true;
}

async function failClosedAfterAgentTeamSettingsConsume(ctx, store, preview, reason) {
  const rootGoalIds = new Map();
  for (const team of preview.document.teams) {
    if (!["pending_plan", "active"].includes(team.autopilot?.status)) continue;
    const ids = rootGoalIds.get(team.rootLeadSessionId) ?? new Set();
    ids.add(team.autopilot.goalId);
    rootGoalIds.set(team.rootLeadSessionId, ids);
  }
  for (const [rootSessionId, goalIds] of rootGoalIds) {
    disarmBoundAgentTeamGoal(ctx, ctx.agents.get(rootSessionId), preview.document, goalIds);
  }
  if (rootGoalIds.size > 0) {
    await store.mutate((document) => {
      for (const team of document.teams) if (rootGoalIds.has(team.rootLeadSessionId)) {
        revokeAgentTeamAutopilot(team, reason, "revoked");
      }
      return true;
    });
  }
  const finalDocument = store.snapshot();
  for (const [rootSessionId, goalIds] of rootGoalIds) {
    const root = ctx.agents.get(rootSessionId);
    disarmBoundAgentTeamGoal(ctx, root, finalDocument, goalIds);
    const goal = typeof ctx.goals?.get === "function" ? ctx.goals.get(root) : undefined;
    if (liveAgentTeamAutopilotTeams(finalDocument, rootSessionId).length > 0
      || goal?.phase === "active" && goal.activation === "armed" && goalIds.has(goal.id)) {
      reject("Host settings failure could not revoke every old automatic-continuation boundary", "AGENT_TEAMS_GOAL_DEACTIVATION_FAILED");
    }
  }
}

function registerWebApi(ctx, store, ready, admission, projectEntry, projectSessionLaunch, projectTaskRuntimeForSession, projectRootRecoveryScheduler, authorizationProvider) {
  const officialCorePorts = officialCorePortsForProjectEntry(projectEntry);
  const stateSnapshot = (document, sessionId, selectedTeamId) => teamSnapshotWithAutopilotAuthorization(ctx, document, sessionId, selectedTeamId);
  const broadcaster = createSseBroadcaster({ snapshot: stateSnapshot });
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
        return json(res, 200, await store.read((document) => stateSnapshot(document, sessionId, selectedTeamId)));
      } catch (error) { return json(res, 400, errorPayload(error)); }
    },
  }), "agent-teams state route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/team-board/page", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { ok: false, error: { code: "AGENT_TEAMS_METHOD_NOT_ALLOWED", action: "use_get", retryable: false } });
      if (!trustedRequest(req)) return json(res, 403, { ok: false, error: { code: "AGENT_TEAMS_FORBIDDEN", action: "use_same_origin_local_request", retryable: false } });
      try {
        await ready;
        const parameters = projectTaskQuery(req, new Set(["sessionId", "teamId", "cursor"]));
        const sessionId = nonEmptyString(parameters.get("sessionId"), "sessionId", 256);
        const selectedTeamId = nonEmptyString(parameters.get("teamId"), "teamId", 256);
        const cursor = nonEmptyString(parameters.get("cursor"), "cursor", 2_048);
        const projectTeamBoard = await store.read((document) => projectTeamBoardPage(document, sessionId, selectedTeamId, cursor));
        return json(res, 200, { ok: true, projectTeamBoard });
      } catch (error) {
        if (error?.code === "AGENT_TEAMS_PROJECT_BOARD_CURSOR_STALE") return json(res, 409, { ok: false, stale: true, error: { code: error.code, action: "refresh_first_page", retryable: false } });
        const status = error?.code === "AGENT_TEAMS_PROJECT_BOARD_FORBIDDEN" ? 403 : error?.code === "AGENT_TEAMS_NOT_FOUND" ? 404 : error?.code === "AGENT_TEAMS_PROJECT_BOARD_PAGE_TOO_LARGE" ? 413 : 400;
        return json(res, status, { ok: false, error: { code: typeof error?.code === "string" ? error.code : "AGENT_TEAMS_INVALID_REQUEST", action: status === 403 ? "select_a_team_owned_by_the_session" : status === 404 ? "refresh_team_state" : "refresh_first_page", retryable: false } });
      }
    },
  }), "agent-teams project team board page route");
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
        broadcaster.send(client, await store.read((document) => stateSnapshot(document, sessionId, selectedTeamId)));
        req.once("close", () => broadcaster.remove(client));
      } catch (error) { if (!res.headersSent) return json(res, 400, errorPayload(error)); }
    },
  }), "agent-teams events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/action", handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req, { requireOrigin: true }) || req.headers["x-harness-agent-teams"] !== "1") return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      let body;
      try { body = await readJsonBody(req); } catch (error) { return json(res, error?.status === 413 ? 413 : 400, errorPayload(error, error?.status === 413 ? "AGENT_TEAMS_BODY_TOO_LARGE" : "AGENT_TEAMS_INVALID_REQUEST")); }
      try {
        await ready;
        const action = nonEmptyString(body.action, "action", 64);
        const sessionId = nonEmptyString(body.sessionId, "sessionId", 256);
        let result;
        if (action === "settings") {
          result = await store.runOperation(async () => {
            const preview = await store.read((document) => {
              if (body.enabled === false && document.teams.some((team) => team.state !== "closed")) reject("close the active team before disabling Agent Teams", "AGENT_TEAMS_CONFLICT");
              if (body.autopilotEnabled !== undefined && typeof body.autopilotEnabled !== "boolean") reject("autopilotEnabled must be a boolean", "AGENT_TEAMS_INVALID_REQUEST");
              const nextSettings = {
                enabled: body.enabled === undefined ? document.settings.enabled : Boolean(body.enabled),
                maxMembers: safeLimit(body.maxMembers, "maxMembers", document.settings.maxMembers),
                maxActiveTurns: safeLimit(body.maxActiveTurns, "maxActiveTurns", document.settings.maxActiveTurns),
                autopilotEnabled: body.autopilotEnabled === undefined ? document.settings.autopilotEnabled : body.autopilotEnabled,
                autopilotMaxAdditionalRounds: safeLimit(body.autopilotMaxAdditionalRounds, "autopilotMaxAdditionalRounds", document.settings.autopilotMaxAdditionalRounds, AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS),
              };
              return { document, nextSettings, hostScope: body.hostAuthorization === undefined ? undefined : normalizeAgentTeamAutopilotHostScope(body.hostAuthorization) };
            });
            const budgetChanged = preview.nextSettings.autopilotMaxAdditionalRounds !== preview.document.settings.autopilotMaxAdditionalRounds;
            const autopilotModeChanged = preview.nextSettings.autopilotEnabled !== preview.document.settings.autopilotEnabled;
            const hasLiveAutopilotGrant = preview.document.teams.some((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
            const authorizationRequired = preview.nextSettings.autopilotEnabled || budgetChanged || autopilotModeChanged && hasLiveAutopilotGrant;
            if (!authorizationRequired) {
              return store.mutate((document) => {
                document.settings = preview.nextSettings;
                return { settings: document.settings };
              });
            }
            if (preview.nextSettings.autopilotEnabled && preview.hostScope === undefined && hasLiveAutopilotGrant) {
              reject("refreshing a live automatic-continuation grant requires its exact Desktop Host scope", "AGENT_TEAMS_HOST_AUTHORIZATION_REQUIRED");
            }
            // The outer web session is an independent trust boundary. Check it
            // before claiming the one-time Host receipt so a misbound request
            // cannot burn a valid capability that the exact root can still use.
            if (preview.hostScope !== undefined && sessionId !== preview.hostScope.rootSessionId) {
              reject("Desktop Host authorization is bound to a different root session", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
            }
            const suppliedHeader = req.headers[AGENT_TEAM_AUTOPILOT_AUTHORIZATION_HEADER];
            const suppliedBodyCapability = body.hostAuthorizationCapability;
            if (suppliedHeader === undefined || suppliedBodyCapability === undefined) {
              reject("automatic continuation settings require a one-time Desktop Host authorization", "AGENT_TEAMS_HOST_AUTHORIZATION_REQUIRED");
            }
            const authorizationId = nonEmptyString(suppliedHeader, "Desktop Host authorization", 256);
            const bodyAuthorizationId = nonEmptyString(suppliedBodyCapability, "Desktop Host authorization capability", 256);
            if (bodyAuthorizationId !== authorizationId) reject("Desktop Host authorization did not match the exact settings request", "AGENT_TEAMS_HOST_AUTHORIZATION_MISMATCH");
            if (typeof authorizationProvider?.consumeAutopilotAuthorization !== "function") reject("Desktop Host automatic-continuation authorization is unavailable", "AGENT_TEAMS_HOST_AUTHORIZATION_UNAVAILABLE");
            const expected = { authorizationId, sessionId, settings: preview.nextSettings, hostAuthorization: preview.hostScope ?? null };
            let budgetExhaustsScopedGroup = false;
            // Prove the exact stable team/plan/pause scope before consuming the
            // one-time epoch-changing receipt. An unscoped save still records
            // the persistent Host preference but cannot mint a current grant.
            if (preview.nextSettings.autopilotEnabled && preview.hostScope !== undefined) {
              const scopedOpenTeams = preview.document.teams.filter((team) => team.rootLeadSessionId === preview.hostScope.rootSessionId && team.state !== "closed");
              const liveScopedTeams = scopedOpenTeams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
              budgetExhaustsScopedGroup = liveScopedTeams.some((team) => team.autopilot.additionalRoundsGranted > preview.nextSettings.autopilotMaxAdditionalRounds);
              const preflightBudget = Math.max(preview.nextSettings.autopilotMaxAdditionalRounds,
                ...liveScopedTeams.map((team) => Math.max(team.autopilot.maxAdditionalRounds, team.autopilot.additionalRoundsGranted)));
              attachAuthorizedAgentTeamAutopilot(ctx, clone(preview.document), preview.hostScope,
                { ...preview.nextSettings, autopilotMaxAdditionalRounds: preflightBudget }, "preflight_host_authority_epoch");
            }
            let hostConsumeStarted = false;
            try {
              hostConsumeStarted = true;
              const receipt = await authorizationProvider.consumeAutopilotAuthorization(expected);
              const authorizationEpoch = verifyAgentTeamAutopilotAuthorizationReceipt(receipt, expected);
              const authorized = preview.nextSettings.autopilotEnabled && preview.hostScope !== undefined && !budgetExhaustsScopedGroup
                ? { scope: preview.hostScope, authorizationEpoch } : undefined;
              const retainedRootId = authorized?.scope.rootSessionId;
              const revokedRootIds = new Set(preview.document.teams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status)
                && team.rootLeadSessionId !== retainedRootId).map((team) => team.rootLeadSessionId));
              const revokedGoalIds = new Map([...revokedRootIds].map((rootSessionId) => [rootSessionId, liveAgentTeamAutopilotGoalIds(preview.document, rootSessionId)]));
              for (const rootSessionId of revokedRootIds) disarmBoundAgentTeamGoal(ctx, ctx.agents.get(rootSessionId), preview.document);
              const mutationResult = await store.mutate((document) => {
                for (const team of document.teams) {
                  if (!["pending_plan", "active"].includes(team.autopilot?.status) || team.rootLeadSessionId === retainedRootId) continue;
                  const exhaustedByBudget = budgetExhaustsScopedGroup && team.rootLeadSessionId === preview.hostScope?.rootSessionId;
                  revokeAgentTeamAutopilot(team, exhaustedByBudget
                    ? "Host automatic-continuation budget is below the rounds already consumed by this Goal"
                    : preview.nextSettings.autopilotEnabled ? "Host settings authorization moved to another exact root scope"
                      : "Host disabled automatic goal continuation", exhaustedByBudget ? "exhausted" : "revoked");
                }
                document.settings = preview.nextSettings;
                if (authorized !== undefined) attachAuthorizedAgentTeamAutopilot(ctx, document, authorized.scope, preview.nextSettings, authorized.authorizationEpoch);
                return { settings: document.settings };
              });
              // Recheck both process-local Goal activation and durable grants
              // after the write. The consumed receipt already rotated the Host
              // epoch, so no second Host rotation is permitted here.
              const finalDocument = store.snapshot();
              for (const [rootSessionId, boundGoalIds] of revokedGoalIds) {
                const root = ctx.agents.get(rootSessionId);
                disarmBoundAgentTeamGoal(ctx, root, finalDocument, boundGoalIds);
                const goal = typeof ctx.goals?.get === "function" ? ctx.goals.get(root) : undefined;
                if (liveAgentTeamAutopilotTeams(finalDocument, rootSessionId).length > 0
                  || goal?.phase === "active" && goal.activation === "armed" && boundGoalIds.has(goal.id)) {
                  reject("automatic-continuation settings revocation did not reach both authority boundaries", "AGENT_TEAMS_GOAL_DEACTIVATION_FAILED");
                }
              }
              return mutationResult;
            } catch (error) {
              if (hostConsumeStarted) {
                await failClosedAfterAgentTeamSettingsConsume(ctx, store, preview,
                  `Host settings authorization failed closed after consumption: ${error?.code ?? "unknown error"}`);
              }
              throw error;
            }
          });
        } else if (action === "root-recovery-continue") {
          if (body.confirm !== true) reject("root recovery requires explicit direct-human confirmation", "AGENT_TEAMS_RECOVERY_CONFIRMATION_REQUIRED");
          const lead=ctx.agents.get(sessionId);
          if(lead===undefined||!ctx.agents.roots().includes(lead)) reject("root recovery requires the exact top-level root session","AGENT_TEAMS_UNAUTHORIZED");
          if(typeof projectTaskRuntimeForSession!=="function") reject("root recovery capability runtime is unavailable","AGENT_TEAMS_UNAUTHORIZED");
          const recoveryAction=nonEmptyString(body.recoveryAction,"recoveryAction",32),expectedRevision=positiveInteger(body.expectedRevision,"expectedRevision"),capability=nonEmptyString(body.recoveryCapability,"recoveryCapability",16_384);
          if(!["retry","takeover"].includes(recoveryAction)) reject("root recovery action is invalid","AGENT_TEAMS_UNAUTHORIZED");
          const authorized=await projectTaskRuntimeForSession(sessionId).resolveRootRecoveryCapability({capability,action:recoveryAction,expectedRevision});
          const execution=Object.freeze({agent:lead}),binding={canonicalProjectKey:projectKeyForRoot(lead),workspacePath:projectScopeForRoot(lead),callerRootId:lead.id};
          try {
            result=await officialCorePorts.recovery.continueRoot({confirm:true,expectedRevision,operation:()=>withProjectCollaborationContext(officialCorePorts,execution,async({projectRef,collaboration,deriveOpaque})=>{
              let current=collaboration.getRootRecovery(execution,{projectRef,recoveryRef:authorized.recoveryRef});
              if(current.revision!==expectedRevision||current.mode!==recoveryAction) reject("root recovery capability no longer matches durable state","PROJECT_ROOT_RECOVERY_CONFLICT");
              if(current.state==="prepared") current=await reservePreparedProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,current,deriveOpaque);
              return continueProjectRootRecovery(projectSessionLaunch,execution,binding,projectRef,collaboration,current.recoveryRef,current.revision);
            })});
          } finally { projectRootRecoveryScheduler?.({rootId:lead.id,canonicalProjectKey:binding.canonicalProjectKey,recoveryRef:authorized.recoveryRef}); }
        } else if (action === "member-retry" || action === "member-replace") {
          if (body.confirm !== true) reject("member recovery requires explicit direct-human confirmation", "AGENT_TEAMS_RECOVERY_CONFIRMATION_REQUIRED");
          const lead = ctx.agents.get(sessionId);
          if (lead === undefined || !ctx.agents.roots().includes(lead)) reject("member recovery requires the exact fixed root session", "AGENT_TEAMS_UNAUTHORIZED");
          result = await officialCorePorts.recovery.recoverMember({ confirm: true, expectedRevision: body.expectedRevision, operation: () => recoverFailedMember(ctx, store, admission, lead, { teamId: body.teamId, memberId: body.memberId, action: action === "member-retry" ? "retry" : "replace", requestId: body.requestId, expectedRevision: body.expectedRevision }, req.signal ?? new AbortController().signal) });
        } else if (action === "member-reconcile") {
          if (body.confirm !== true) reject("member recovery reconciliation requires explicit direct-human confirmation", "AGENT_TEAMS_RECOVERY_CONFIRMATION_REQUIRED");
          const lead = ctx.agents.get(sessionId);
          if (lead === undefined || !ctx.agents.roots().includes(lead)) reject("member recovery reconciliation requires the exact fixed root session", "AGENT_TEAMS_UNAUTHORIZED");
          result = await officialCorePorts.recovery.reconcileMember({ confirm: true, expectedRevision: body.expectedRevision, resolution: body.resolution, operation: () => reconcileMemberRecovery(ctx, store, lead, { teamId: body.teamId, requestId: body.requestId, resolution: body.resolution, expectedRevision: body.expectedRevision }) });
        } else reject("team mutations are available only through authenticated model tools; use the lead conversation or open a member conversation", "AGENT_TEAMS_UNAUTHORIZED");
        const state = await store.read((document) => stateSnapshot(document, sessionId, body.teamId));
        return json(res, 200, publicResult({ result, state }));
      } catch (error) {
        const status = error?.code === "AGENT_TEAMS_NOT_FOUND" ? 404 : ["AGENT_TEAMS_UNAUTHORIZED", "PROJECT_TASK_WEB_FORBIDDEN"].includes(error?.code) || error?.code?.startsWith("AGENT_TEAMS_HOST_AUTHORIZATION") ? 403 : error?.code?.includes("CONFLICT") || error?.code?.includes("LIMIT") ? 409 : 400;
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
  const mapped = projectBusinessApiError(error, resource) ?? (typeof error?.code === "string" && error.code.startsWith("PROJECT_TASK_") ? projectTaskWebError(error) : fallback(error));
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
function projectTaskRuntimeResolver(runtime) {
  if (runtime instanceof ProjectTaskWebRuntime) return () => runtime;
  if (typeof runtime !== "function") throw new TypeError("runtime must be a ProjectTaskWebRuntime or session runtime resolver");
  return (sessionId) => {
    const selected = runtime(sessionId);
    if (!(selected instanceof ProjectTaskWebRuntime)) throw new TypeError("session runtime resolver must return a ProjectTaskWebRuntime");
    return selected;
  };
}
function createProjectTaskSseBridge(runtime, { keepaliveMs = PROJECT_TASK_SSE_KEEPALIVE_MS } = {}) {
  const resolveRuntime = projectTaskRuntimeResolver(runtime);
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
    try { client.unsubscribe?.(); } catch {}
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
  const add = (request, response, sessionId) => {
    if (closed) throw new Error("project task SSE bridge is closed");
    const selectedRuntime = resolveRuntime(sessionId);
    const client = { request, response, closed: false, keepalive: undefined, onClose: undefined, unsubscribe: undefined };
    const scopeStillValid = () => { try { return resolveRuntime(sessionId) === selectedRuntime; } catch { return false; } };
    client.onClose = () => remove(client);
    client.unsubscribe = selectedRuntime.subscribe((update) => {
      if (closed || update?.type !== "project-task" || !isRecord(update.event)) return;
      if (!scopeStillValid()) { remove(client, true); return; }
      write(client, encodedProjectTaskSse("task", update.event, update.event.projectRevision));
    });
    request.once?.("close", client.onClose);
    request.once?.("aborted", client.onClose);
    response.once?.("close", client.onClose);
    response.once?.("error", client.onClose);
    client.keepalive = setInterval(() => { if (!scopeStillValid()) { remove(client, true); return; } write(client, ": keepalive\n\n"); }, keepaliveMs);
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
    for (const client of [...clients]) remove(client, true);
  };
  return { add, clients, close, remove, reset };
}
function registerProjectTaskApi(ctx, runtime, businessRuntime) {
  const sessionScoped = typeof runtime === "function";
  const resolveRuntime = projectTaskRuntimeResolver(runtime);
  const bridge = createProjectTaskSseBridge(resolveRuntime);
  const scopedRuntime = (parameters) => {
    const rawSessionId = parameters.get("sessionId");
    const sessionId = rawSessionId === null ? undefined : nonEmptyString(rawSessionId, "sessionId", 256);
    return { sessionId, runtime: resolveRuntime(sessionId) };
  };
  const unsubscribeBusiness = businessRuntime === undefined || sessionScoped ? undefined : businessRuntime.subscribe(() => bridge.reset());
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
        const { runtime: selectedRuntime } = scopedRuntime(projectTaskQuery(req, new Set(["sessionId"])));
        if (businessRuntime === undefined || sessionScoped) return json(res, 200, await selectedRuntime.state());
        try {
          const businessStatus = await businessRuntime.initialize();
          if (businessStatus.mode !== "collaborator") return json(res, 200, await selectedRuntime.state());
          const preview = await businessRuntime.taskState();
          const includedTasks = Array.isArray(preview.tasks) ? preview.tasks.length : 0;
          return json(res, 200, { ...preview, totalTasks: includedTasks, totalExact: false, page: { includedTasks, hasMore: false, nextCursor: null, available: false, reason: "authority_required", nextAction: "open_authority_project" }, pagination: { available: false, reason: "authority_required", nextAction: "open_authority_project" } });
        } catch (error) { if (error?.code === "PROJECT_ENTRY_NOT_CREATED") return json(res, 200, await selectedRuntime.state()); throw error; }
      } catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
    },
  }), "agent-teams project task state route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/page", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try {
        const parameters = projectTaskQuery(req, new Set(["sessionId", "cursor"]));
        const { runtime: selectedRuntime } = scopedRuntime(parameters);
        const cursor = nonEmptyString(parameters.get("cursor"), "cursor", 2_048);
        if (businessRuntime === undefined || sessionScoped) return json(res, 200, await selectedRuntime.page(cursor));
        try {
          const businessStatus = await businessRuntime.initialize();
          if (businessStatus.mode === "collaborator") return projectTaskApiFailure(res, 409, "PROJECT_TASK_PAGE_AUTHORITY_REQUIRED", "Complete project task pagination is available only on the authority project device.", "open_authority_project");
          return json(res, 200, await selectedRuntime.page(cursor));
        } catch (error) { if (error?.code === "PROJECT_ENTRY_NOT_CREATED") return json(res, 200, await selectedRuntime.page(cursor)); throw error; }
      } catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
    },
  }), "agent-teams project task page route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/events", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      try {
        const parameters = projectTaskQuery(req, new Set(["sessionId", "afterRevision", "limit"]));
        const { runtime: selectedRuntime } = scopedRuntime(parameters);
        const afterRevision = projectTaskQueryInteger(parameters, "afterRevision", 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = projectTaskQueryInteger(parameters, "limit", 100, 1, 100);
        if (!sessionScoped && businessRuntime !== undefined && (await businessRuntime.initialize()).mode === "collaborator") {
          return json(res, 200, { ok: true, fromRevision: afterRevision, currentRevision: afterRevision, events: [], hasMore: false, reset: true, nextAfterRevision: afterRevision });
        }
        return json(res, 200, await selectedRuntime.events({ afterRevision, limit }));
      } catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
    },
  }), "agent-teams project task events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/stream", handler: async (req, res) => {
      if (!checkGet(req, res)) return;
      let sessionId;
      try { ({ sessionId } = scopedRuntime(projectTaskQuery(req, new Set(["sessionId"])))); }
      catch (error) { return mappedProjectTaskFailure(res, error); }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      });
      res.flushHeaders?.();
      try { bridge.add(req, res, sessionId); }
      catch { try { res.end(); } catch {} }
    },
  }), "agent-teams project task stream route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/project/tasks/action", handler: async (req, res) => {
      if (req.method !== "POST") return projectTaskApiFailure(res, 405, "PROJECT_TASK_WEB_METHOD_NOT_ALLOWED", "Method not allowed.", "use_supported_method");
      if (!trustedRequest(req) || req.headers["x-harness-agent-teams"] !== "1") return projectTaskApiFailure(res, 403, "PROJECT_TASK_WEB_FORBIDDEN", "Request origin is not trusted.", "open_local_task_board");
      let selectedRuntime;
      try { ({ runtime: selectedRuntime } = scopedRuntime(projectTaskQuery(req, new Set(["sessionId"])))); }
      catch (error) { return mappedProjectTaskFailure(res, error); }
      let body;
      try { body = await readJsonBody(req); }
      catch (error) {
        if (error?.status === 413) error.code = "PROJECT_TASK_WEB_BODY_TOO_LARGE";
        return mappedProjectTaskFailure(res, error);
      }
      try {
        if (!sessionScoped && businessRuntime !== undefined && (await businessRuntime.initialize()).mode === "collaborator") return json(res, 200, await businessRuntime.taskAction(body));
        return json(res, 200, await selectedRuntime.action(body));
      } catch (error) { return mappedProjectBusinessFailure(res, error, "tasks", projectTaskWebError); }
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
    if (task.assigneeSessionId !== member.sessionId || task.state !== "submitted" || task.result !== undefined || !taskSubmissionMatches(task)) return false;
    const submittedAt = Date.parse(task.submission?.submittedAt ?? "");
    return Number.isFinite(submittedAt) && submittedAt >= runStartedAt;
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

function observeProjectRootFailures(ctx,projectEntry,projectSessionLaunch,ready=Promise.resolve()) {
  ctx.on("agent/error",({agent})=>{
    if(agent===undefined||ctx.agents.get(agent.id)!==agent||!ctx.agents.roots().includes(agent)) return;
    void ready.then(async()=>{
      const execution=Object.freeze({agent}),projectBinding={canonicalProjectKey:projectKeyForRoot(agent),workspacePath:projectScopeForRoot(agent),callerRootId:agent.id};
      const adoptedActorRef=await withProjectCollaborationContext(projectEntry,execution,({actorRef})=>actorRef);
      await projectSessionLaunch.recordAdoptedActorFailure(execution,{adoptedActorRef,projectBinding});
    }).catch((error)=>{if(error?.code!=="PROJECT_ROOT_RECOVERY_EVIDENCE_REQUIRED") ctx.logger.warn("project root failure observer rejected Host lifecycle evidence [PROJECT_ROOT_FAILURE_OBSERVER_REJECTED]");});
  });
}

function observeUserStops(ctx, store, ready, admission, projectSessionLaunch, projectEntry, authorizationProvider) {
  const scheduleProjectTaskWake = (root, options) => {
    if (projectEntry === undefined || !ctx.agents.roots().includes(root)) return;
    void ready.then(() => reconcileProjectTaskWakeRoot(ctx, projectEntry, root, options))
      .catch((error) => ctx.logger.warn(`project task wake lifecycle reconciliation failed: ${String(error?.code ?? "unavailable")}`));
  };
  ctx.on("session/event", (session, event) => {
    const lead = ctx.agents.get(session.id);
    if (lead === undefined || lead.session !== session) return;
    if (event.type === "user/message" && event.data?.source?.kind === "user") {
      PROJECT_TASK_STOPPED_ROOTS.delete(lead.id);
      scheduleProjectTaskWake(lead, { paused: false, dispatch: true });
      return;
    }
    if (event.type !== "turn/end" || event.data?.reason?.kind !== "aborted" || event.data.reason.reason?.kind !== "user") return;
    PROJECT_TASK_STOPPED_ROOTS.add(lead.id);
    clearQueuedProjectTaskWakes(lead);
    scheduleProjectTaskWake(lead, { paused: true });
    const projectBinding = { canonicalProjectKey: projectKeyForRoot(lead), workspacePath: projectScopeForRoot(lead), callerRootId: lead.id };
    void Promise.resolve(projectSessionLaunch?.stopForRoot?.(lead.id, projectBinding)).catch((error) => ctx.logger.warn(`project session launch Stop reconciliation failed: ${String(error)}`));
    admission?.cancelRoot?.(lead, admissionCancellation());
    const selections = store.activeTeamsForRoot(lead.id);
    if (selections.length === 0) return;
    const stoppedAt = now();
    // The in-memory overlay closes the event gate immediately, but the reconciliation
    // durably increments pauseEpoch and marks every team paused before it drains or
    // interrupts any child. Late lifecycle/task writes are fenced by that epoch.
    for (const selection of selections) USER_PAUSED_TEAMS.add(selection.teamId);
    const reconciliation = ready.then(() => pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt, authorizationProvider));
    for (const selection of selections) USER_PAUSE_RECONCILIATIONS.set(selection.teamId, reconciliation);
    store.notify?.();
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
    autopilotEnabled: config.autopilotEnabled ?? DEFAULT_SETTINGS.autopilotEnabled,
    autopilotMaxAdditionalRounds: safeLimit(config.autopilotMaxAdditionalRounds, "autopilotMaxAdditionalRounds", DEFAULT_SETTINGS.autopilotMaxAdditionalRounds, AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS),
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
    const projected = { available: true };
    for (const name of ["consumeResolveUnknown", "consumeAutopilotAuthorization", "readAutopilotAuthorizationState", "revokeAutopilotAuthorizations"]) {
      const method = ownDataDescriptorOrAbsent(value, name);
      if (typeof method === "function") projected[name] = (request) => method.call(value, request);
    }
    if (Object.keys(projected).length > 1) return Object.freeze(projected);
  }
  return desktop;
}

function createProjectTaskSessionRuntimeResolver(ctx, projectEntryRegistry, wakeScheduler = () => undefined) {
  if (typeof projectEntryRegistry?.localProjectCollaborationContext !== "function") throw new TypeError("projectEntryRegistry must provide canonical project contexts");
  if (typeof wakeScheduler !== "function") throw new TypeError("wakeScheduler must be a function");
  const runtimes = new Map();
  let closed = false;
  const resolve = (sessionId) => {
    if (closed) reject("project task session runtime registry is closed", "PROJECT_TASK_WEB_CLOSED");
    if (sessionId === undefined) reject("project task panel requires an exact top-level root session", "PROJECT_TASK_WEB_FORBIDDEN");
    const root = ctx.agents.get(sessionId);
    if (root === undefined || !ctx.agents.roots().includes(root)) reject("project task panel requires an exact top-level root session", "PROJECT_TASK_WEB_FORBIDDEN");
    const canonicalProjectKey = projectKeyForRoot(root);
    const runtimeKey = `${root.id}\0${canonicalProjectKey}`;
    let runtime = runtimes.get(runtimeKey);
    if (runtime !== undefined) return runtime;
    const projectEntry = Object.freeze({
      localProjectCollaborationContext: () => projectEntryRegistry.localProjectCollaborationContext({ canonicalProjectKey }),
      localProjectTaskContext: () => projectEntryRegistry.localProjectTaskContext({ canonicalProjectKey }),
    });
    runtime = new ProjectTaskWebRuntime({
      projectEntry,
      legacySummaryProvider: async () => false,
      wakeScheduler,
      rootRecoveryAuthorityProvider: ({ context, store }) => {
        let key;
        try {
          key = context.keyProvider(context.projectRef);
          const actorRef = `actor_${createHmac("sha256", key).update("dsh-agent-teams/project-root-actor/v1").update("\0").update(context.projectRef).update("\0").update(JSON.stringify([root.id])).digest("base64url")}`;
          const coordinatorActorRef = store.getCollaborationCoordinatorActorRef(context.projectRef);
          return { actorRef, isCoordinator: coordinatorActorRef === undefined || coordinatorActorRef === actorRef };
        } finally { key?.fill(0); }
      },
    });
    runtimes.set(runtimeKey, runtime);
    return runtime;
  };
  resolve.close = async () => {
    if (closed) return;
    closed = true;
    const pending = [...runtimes.values()].map((runtime) => runtime.close());
    runtimes.clear();
    await Promise.allSettled(pending);
  };
  resolve.size = () => runtimes.size;
  return resolve;
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
  // Managed workers may inherit delegation tools from an agent-local preset. Those
  // names are deliberately not valid inputs to tools.restrict(), so enforce the
  // no-fan-out boundary at execution time instead of filtering child composition.
  ctx.tools.guard((execution) => managedMemberToolGuard(store, execution));
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
  const projectSessionLaunchProvider = resolveProjectSessionLaunchProvider(ctx);
  const projectSessionLaunch = new ProjectSessionLaunchRegistry({
    rootPath: join(dshHome, "storages", "project_session_launch_lanes"),
    legacyFilePath: join(dshHome, "storages", "project_session_launch.json"),
    provider: projectSessionLaunchProvider,
    maxConcurrent: Math.min(2, defaults.maxActiveTurns),
    maxConcurrentPerProject: 1,
    maxSessionsPerProject: HARD_MAX_MEMBERS,
  });
  const projectEntryRegistry = new ProjectEntryRegistry({
    projectEntry,
    dshHome,
    legacyEvidenceProvider: async () => {
      try {
        const document = JSON.parse(await readFile(join(dshHome, "storages", "project_session_launch.json"), "utf8"));
        const keys = [...new Set((document?.batches ?? []).map((batch) => batch?.canonicalProjectKey).filter((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)))];
        return keys.length === 1 ? keys[0] : undefined;
      } catch { return undefined; }
    },
  });
  let projectTaskWakeScheduler = () => undefined;
  const officialCorePorts = createOfficialCorePorts({ providers: [createCustomOfficialCoreProvider({
    projectIdentity: {
      open: ({ canonicalProjectKey, bindLegacy }) => bindLegacy
        ? projectEntryRegistry.bindLegacyProjectCollaborationContext({ canonicalProjectKey })
        : projectEntryRegistry.localProjectCollaborationContext({ canonicalProjectKey }),
      webEntry: () => projectEntry,
    },
    task: { bind: ({ store: taskStore, actorResolver, now: clock }) => new ProjectTaskCommandService({ store: taskStore, actorResolver, ...(clock === undefined ? {} : { now: clock }), wakeScheduler: (signal) => projectTaskWakeScheduler(signal) }) },
    collaboration: { bind: ({ store: taskStore, actorResolver, now: clock, earlyResolutionAuthorizer, rootFailureResolver }) => new ProjectCollaborationService({ store: taskStore, actorResolver, ...(clock === undefined ? {} : { now: clock }), ...(earlyResolutionAuthorizer === undefined ? {} : { earlyResolutionAuthorizer }), ...(rootFailureResolver === undefined ? {} : { rootFailureResolver }) }) },
    projection: { createWebRuntime: (options) => new ProjectTaskWebRuntime(options) },
    recovery: {
      continueRoot: ({ operation }) => operation(),
      recoverMember: ({ operation }) => operation(),
      reconcileMember: ({ operation }) => operation(),
    },
  })] });
  const ready = Promise.all([store.init(), projectSessionLaunch.init()]).then(([document]) => document);
  const teamAutopilot = createAgentTeamAutopilot(ctx, store, ready, authorizationProvider);
  ctx.effect(() => () => teamAutopilot.close(), "agent-teams event-driven autopilot");
  projectTaskWakeScheduler = createProjectTaskWakeScheduler(ctx, officialCorePorts, ready);
  ctx.effect(() => () => projectTaskWakeScheduler.close());
  const projectRootRecoveryScheduler = createProjectRootRecoveryScheduler(ctx, officialCorePorts, projectSessionLaunch, ready);
  ctx.effect(() => () => projectRootRecoveryScheduler.close());
  const legacySummaryProvider = async () => {
    await ready;
    return store.read((document) => ({ detected: document.teams.some((team) => team.tasks.length > 0) }));
  };
  const projectTasks = officialCorePorts.projection.createWebRuntime({
    projectEntry: officialCorePorts.projectIdentity.webEntry(),
    legacySummaryProvider,
    wakeScheduler: projectTaskWakeScheduler,
  });
  const projectTaskRuntimeForSession = createProjectTaskSessionRuntimeResolver(ctx, projectEntryRegistry, projectTaskWakeScheduler);
  const projectAutomations = new ProjectAutomationWebRuntime({ projectEntry, wakeScheduler: projectTaskWakeScheduler });
  const projectBusiness = new ProjectBusinessSyncRuntime({
    projectEntry,
    taskDelegate: { state: () => projectTasks.state(), action: (input) => projectTasks.action(input) },
    automationDelegate: { state: () => projectAutomations.state(), action: (input) => projectAutomations.action(input) },
    wakeScheduler: projectTaskWakeScheduler,
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
      await Promise.allSettled([
        projectSessionLaunch.close(),
        projectFoundations.close(),
        projectBusiness.close(),
        projectAutomations.close(),
        projectTaskRuntimeForSession.close(),
        projectTasks.close(),
        collaboration.close(),
        projectEntryRegistry.close(),
        projectEntry.close(),
      ]);
      store.close();
    };
  }, "agent-teams collaboration presence");
  registerTools(ctx, store, ready, collaboration, admission, resolveUnknownAuthorization, authorizationProvider);
  registerProjectCollaborationTools(ctx, officialCorePorts, projectSessionLaunch, ready, projectRootRecoveryScheduler);
  registerProjectSessionLaunchTool(ctx, officialCorePorts, projectSessionLaunch, ready);
  registerProjectFoundationTools(ctx, projectFoundations, ready);
  registerProjectFoundationsApi(ctx, projectFoundations, ready);
  registerWebApi(ctx, store, ready, admission, officialCorePorts, projectSessionLaunch, projectTaskRuntimeForSession, projectRootRecoveryScheduler, authorizationProvider);
  registerProjectEntryApi(ctx, projectEntry);
  registerProjectTaskApi(ctx, projectTaskRuntimeForSession, projectBusiness);
  registerProjectAutomationApi(ctx, projectAutomations, projectBusiness);
  observeSubagents(ctx, store, ready, admission);
  observeProjectRootRecoveryLifecycle(ctx, projectRootRecoveryScheduler, ready);
  // Preserve the established lifecycle wiring contract:
  // observeUserStops(ctx, store, ready, admission, projectSessionLaunch, officialCorePorts)
  // The trailing capability only rotates the trusted Host authorization epoch.
  observeUserStops(ctx, store, ready, admission, projectSessionLaunch, officialCorePorts, authorizationProvider);
  observeProjectTaskWakeLifecycle(ctx, officialCorePorts, ready);
  observeProjectRootFailures(ctx,projectEntryRegistry,projectSessionLaunch,ready);
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
  ProjectSessionLaunchRegistry,
  ProjectSessionLaunchRuntime,
  SSE_COALESCE_MS,
  SUBAGENT_RECONCILE_MS,
  TEAM_ADMISSION_TIMEOUT_MS,
  UI_MAX_EVENTS_PER_TEAM,
  UI_MAX_TASKS_PER_TEAM,
  UI_MAX_TASK_WORKFLOW_EVENTS,
  UI_PROJECT_TEAM_BOARD_CACHE_MAX_PROJECTS,
  UI_PROJECT_TEAM_BOARD_MAX_BYTES,
  UI_PROJECT_TEAM_BOARD_MAX_TASKS,
  UI_PROJECT_TEAM_BOARD_MAX_TEAMS,
  createProjectAutomationSseBridge,
  createProjectTeamBoard,
  createProjectTeamBoardPage,
  decorateProjectTeamBoardRecovery,
  paginatePreparedProjectTeamBoard,
  prepareProjectTeamBoard,
  projectTeamBoardCacheSize,
  projectTeamBoardPage,
  createProjectFoundationManager,
  createProjectTaskSseBridge,
  createProjectTaskSessionRuntimeResolver,
  createProjectTaskWakeScheduler,
  createAgentTeamAutopilot,
  createProjectRootRecoveryScheduler,
  rootProjectTaskWakeEvidence,
  rootCanAutonomouslyWait,
  rootHasSafeAutopilotAuthority,
  agentTeamAutopilotWakeRoots,
  reconcileProjectTaskWakeRoot,
  observeProjectTaskWakeLifecycle,
  observeProjectRootRecoveryLifecycle,
  createResolveUnknownAuthorizationGate,
  createSseBroadcaster,
  createSubagentEventReconciler,
  drainContinuableChildrenWithDeadline,
  dispatchProjectTaskWakeSignals,
  createTeamTurnAdmission,
  fileBoundaryOverlap,
  exactDirectHumanAutopilotRootAuthority,
  exactDirectHumanAutopilotGrantIntent,
  agentTeamAutopilotGrantForCreation,
  exactGoalRoundRootAuthority,
  hasExactGoalRoundRootAuthority,
  hasTeamCreationRootAuthority,
  normalizeExpansionRequest,
  resourceBoundaryOverlap,
  runWithLifecycleDeadline,
  pauseTeamsForUserStop,
  resumePausedTeam,
  observeUserStops,
  observeProjectRootFailures,
  MEMBER_STATES,
  TASK_STATES,
  apply,
  authorizeResolveUnknown,
  bootstrapTeam,
  buildResumePlan,
  commitTeamPlan,
  continueProjectRootRecovery,
  createTask,
  createTeam,
  adoptTeamHandoff,
  prepareTeamHandoff,
  deriveAttention,
  deriveTask,
  inject,
  name,
  readModelRouting,
  requireProjectRootCaller,
  registerProjectCollaborationTools,
  registerWebApi,
  registerProjectAutomationApi,
  registerProjectFoundationsApi,
  registerProjectFoundationTools,
  resolveProjectFoundationHostOptions,
  resolveProjectSessionLaunchProvider,
  projectFoundationsBrowserState,
  projectTaskDetailForUi,
  adoptProjectLaunchSlot,
  ensureProjectLaunchBoard,
  projectCollaborationModelResult,
  projectRequestModelResult,
  projectTaskModelResult,
  reserveProjectLaunchSlots,
  withProjectCollaborationContext,
  registerProjectTaskApi,
  releaseRetiredMemberTasks,
  resolveAgentTeamsAuthorizationProvider,
  resolveConfig,
  resolveModelSelection,
  resolveUniqueLeadTeam,
  recoverFailedMember,
  reconcileMemberRecovery,
  recordRoutingReceipt,
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
