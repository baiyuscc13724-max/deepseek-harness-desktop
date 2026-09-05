import { createHash, createHmac, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, posix as posixPath, relative, resolve, win32 as win32Path } from "node:path";
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
const HOT_COLD_STORE_VERSION = 1;
const HOT_COLD_POINTER_VERSION = 1;
const HOT_COLD_PROMOTION_SENTINEL_VERSION = 2;
const HOT_COLD_AUTO_CLOSED_TEAM_THRESHOLD = 16;
const HOT_COLD_STORE_ENV = "DSH_AGENT_TEAMS_HOT_COLD_STORE";
const HOT_COLD_FILE_REF = /^(?:closed\/team-[a-f0-9]{64}|catalog\/catalog-[a-f0-9]{64}|hot\/hot-[1-9][0-9]*-[a-f0-9]{64}|legacy\/v8-[a-f0-9]{64}|manifests\/manifest-[1-9][0-9]*-[a-f0-9]{64})\.json$/u;
// Every published pointer must retain itself plus two complete predecessors. Keep
// two further complete generations at a normal head so two pointer rollbacks can
// consume that reserve without weakening the invariant at the selected current.
const HOT_COLD_RETENTION_COMPLETE_GENERATIONS = 3;
const HOT_COLD_RETENTION_ROLLBACK_RESERVE = 2;
const HOT_COLD_RETENTION_MAX_COMPLETE_GENERATIONS = HOT_COLD_RETENTION_COMPLETE_GENERATIONS + HOT_COLD_RETENTION_ROLLBACK_RESERVE;
const HOT_COLD_RETENTION_SOFT_BYTES = 4 * 1024 * 1024;
const HOT_COLD_RETENTION_HARD_BYTES = 16 * 1024 * 1024;
const HOT_COLD_RETENTION_SOFT_FILES = 48;
const HOT_COLD_RETENTION_HARD_FILES = 192;
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
const TEAM_PROJECTION_CACHE_ENV = "DSH_AGENT_TEAMS_PROJECTION_CACHE";
const TEAM_PROJECTION_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const TEAM_PROJECTION_CACHE_MODES = new Set(["disabled", "shadow", "enabled"]);
const UI_PROJECT_TEAM_BOARD_CACHE_MAX_PROJECTS = 16;
const SUBAGENT_RECONCILE_MS = 20;
const GRACEFUL_LIFECYCLE_TIMEOUT_MS = 120_000;
const GLOBAL_TEAM_ACTIVE_ACTIVATIONS = 8;
const MAX_TEAM_ADMISSION_QUEUE = 32;
const MAX_TEAM_ADMISSION_QUEUE_PER_ROOT = 8;
const TEAM_ADMISSION_TIMEOUT_MS = 30_000;
const HARD_MAX_MEMBERS = 8;
const HARD_MAX_TEAMS_PER_ROOT = 8;
const MAX_PROVISIONING_QUEUE = HARD_MAX_MEMBERS;
const MAX_EXPANSION_WORKSTREAMS = HARD_MAX_MEMBERS;
const MAX_EXPANSION_BOUNDARIES = 16;
const MAX_EXPANSION_REQUEST_CHARS = 24_000;
const MAX_BOOTSTRAP_ITEMS = HARD_MAX_MEMBERS;
const MAX_BOOTSTRAP_TASKS = MAX_TEAM_TASKS;
const MAX_TASK_ATTEMPT_HISTORY = 24;
const MAX_TASK_INTERRUPTION_HISTORY = 24;
const MAX_TASK_LIFECYCLE_EVENTS = 256;
const MAX_TASK_COMMAND_RECEIPTS = 2_048;
const MAX_ROUTING_RECEIPTS = 2_048;
const MAX_OWNERSHIP_HISTORY = 24;
const MAX_MEMBER_RECOVERY_RECEIPTS = 24;
const MEMBER_RECOVERY_ACTIONS = Object.freeze(["retry", "replace"]);
const MEMBER_RECOVERY_STATES = Object.freeze(["prepared", "delivered", "failed", "outcome_unknown"]);
const MEMBER_RECOVERY_PHASES = Object.freeze(["prepared", "retry_awaiting_admission", "retry_dispatching", "drain_started", "start_awaiting_admission", "start_dispatched", "child_started", "published", "followup_awaiting_admission", "followup_dispatching", "followup_returned", "reconciled"]);
const PROVISIONING_QUEUE_STATES = Object.freeze(["queued", "provisioning", "dispatching", "outcome_unknown"]);
const MEMBER_RETIREMENT_STATES = Object.freeze(["pending", "completed", "failed"]);
const MEMBER_RETIREMENT_SCOPES = Object.freeze(["member", "team"]);
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
const AUTOMATIC_MEMBER_RECOVERY_ATTEMPTS = new Map();
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
const TERMINAL_DIAGNOSTIC_KEYS = new Set(["errorCode", "category", "stage", "retryable", "partialOutputPresent", "nextAction"]);
const TERMINAL_DIAGNOSTIC_CODES = Object.freeze(["PI_AI_ERROR", "SUBAGENT_ABNORMAL_END", "SUBAGENT_ABORTED", "SUBAGENT_MAX_TOKENS", "SUBAGENT_REFUSAL", "SUBAGENT_TIMEOUT", "SUBAGENT_PROVIDER_UNAVAILABLE", "SUBAGENT_ACTIVATION_TEARDOWN_FAILED", "SUBAGENT_ERROR", "AGENT_TEAMS_PROVIDER_TRANSIENT", "AGENT_TEAMS_LIFECYCLE_TIMEOUT", "AGENT_TEAMS_BACKPRESSURE", "AGENT_TEAMS_OUTCOME_UNKNOWN", "AGENT_TEAMS_RUNTIME_FAILURE"]);
const TERMINAL_DIAGNOSTIC_CATEGORIES = Object.freeze(["provider_transient", "lifecycle_timeout", "backpressure", "outcome_unknown", "resource_limit", "policy", "cancellation", "teardown", "internal"]);
const TERMINAL_DIAGNOSTIC_STAGES = Object.freeze(["registration", "admission", "provider_dispatch", "work_followup", "retirement", "recovery", "unknown"]);
const TERMINAL_DIAGNOSTIC_NEXT_ACTIONS = Object.freeze(["view_live_status", "wait_for_capacity", "retry_current_task", "reconcile_unknown_outcome", "review_submission", "resume_team", "none"]);
const TEAM_STATES = Object.freeze(["active", "paused", "closing", "closed"]);
const TRANSIENT_MEMBER_STATES = new Set(["provisioning", "running", "idle", "shutting_down"]);
const STORE_MUTATION_CHAINS = new Map();
const STORE_OPERATION_CHAINS = new Map();
const STORE_RETENTION_MAINTENANCE = new Map();
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
const AGENT_TEAM_AUTOPILOT_LIFECYCLE_REVOKE_REASON = "plugin or session lifecycle restart requires fresh direct-human continuation authority";
const AGENT_TEAM_AUTOPILOT_STOP_REVOKE_REASON = "explicit user Stop requires fresh direct-human continuation authority";
const AGENT_TEAM_AUTOPILOT_AUTHORIZATION_HEADER = "x-harness-agent-teams-authorization";
const MAX_AGENT_TEAM_AUTOPILOT_WAKES = 128;
const AGENT_TEAM_AUTOPILOT_STATUSES = Object.freeze(["pending_plan", "active", "revoked", "exhausted"]);
const AGENT_TEAM_AUTOPILOT_WAKE_STATUSES = Object.freeze(["prepared", "goal_mutated", "delivered", "cancelled"]);
const AGENT_TEAM_AUTOPILOT_WAKE_KINDS = Object.freeze(["review_expansion", "review_submission", "dispatch_work", "member_attention", "close_team", "reconcile_work"]);
const AGENT_TEAM_AUTOPILOT_HOST_SCOPE_KEYS = new Set(["rootSessionId", "projectKey", "goalId", "teamId", "pauseEpoch", "teamScopeHash"]);
// A recovery starts at revision 1, reserves at revision 2, and every retry
// effect is fenced by a durable transition to activated.  Stop background
// effects at revision 10 so even the shortest failed cycle can perform no more
// than four total launch attempts (the user-initiated attempt plus three
// automatic attempts).  Extra evidence transitions only reduce that budget.
const PROJECT_ROOT_RECOVERY_AUTO_EFFECT_REVISION_LIMIT = 10;
const STOPPABLE_MEMBER_STATES = new Set(["provisioning", "running", "idle", "ready", "shutting_down"]);
const STORE_INSTANCES = new Map();
const LAZY_TEAM_STATES = new WeakMap();
const LAZY_TEAM_VIEW_STATES = new WeakMap();
const STORE_PROJECTION_METADATA = new WeakMap();
const LEDGER_PROJECTION_IDENTITIES = new WeakMap();
const SSE_SNAPSHOT_ENCODINGS = new WeakMap();
const TEAM_KEYS = new Set(["id", "rootLeadSessionId", "name", "objective", "revision", "state", "createdAt", "updatedAt", "members", "tasks", "messages", "provisioningQueue", "start", "bootstrap", "plan", "autopilot", "pauseEpoch", "resume", "handoff", "projectKey", "ownershipHistory", "closure", "memberRecoveries", "taskCommandReceipts"]);
const TEAM_START_KEYS = new Set(["requestId", "inputHash"]);
const AUTOPILOT_KEYS = new Set(["version", "status", "authority", "grantId", "routingReceiptId", "authorizationEpoch", "rootSessionId", "projectKey", "goalId", "goalObjectiveHash", "pauseEpochAtGrant", "planHashAtGrant", "baseMaxGoalRounds", "expectedMaxGoalRounds", "maxAdditionalRounds", "additionalRoundsGranted", "lastStateHash", "parkedGoalRevision", "parkedStateHash", "parkedAt", "wakes", "grantedAt", "revokedAt", "revokeReason"]);
const AUTOPILOT_WAKE_KEYS = new Set(["key", "kind", "stateHash", "roundsStarted", "status", "teamRevision", "targetMaxGoalRounds", "createdAt", "goalRevision", "deliveredAt", "cancelledAt", "reason"]);
const TASK_COMMAND_RECEIPT_KEYS = new Set(["requestId", "inputHash", "taskId", "action", "taskRevisionBefore", "taskRevisionAfter", "pauseEpoch", "createdAt"]);
const MEMBER_RECOVERY_KEYS = new Set(["requestId", "inputHash", "action", "status", "phase", "memberId", "sessionId", "taskIds", "activeTaskIds", "activeClaims", "createdAt", "updatedAt", "pauseEpoch", "teamRevision", "replacementMemberId", "replacementSessionId", "dispatchOutcome", "retryable", "admission", "errorCode", "errorStage", "errorMessage", "reconciledAt", "reconciledBy", "resolution"]);
const MEMBER_RETIREMENT_KEYS = new Set(["intentId", "scope", "status", "pauseEpoch", "requestedAt", "updatedAt", "targetRunId", "completedAt", "stopReason", "errorCode"]);
const PROVISIONING_QUEUE_KEYS = new Set(["id", "inputHash", "enqueueSequence", "memberId", "childId", "name", "role", "prompt", "taskIds", "pauseEpoch", "planRevision", "planHash", "model", "provider", "modelTier", "inheritsMain", "routeSource", "status", "attempt", "createdAt", "updatedAt", "admissionEpoch", "retryAfterRelease", "admissionGeneration", "errorCode", "errorStage"]);
const EXPANSION_REQUEST_KEYS = new Set(["id", "teamId", "sourceTaskId", "sourceTaskTitle", "parallelBenefit", "requestedBy", "workstreams", "capacity", "requestedAt"]);
const EXPANSION_REQUESTER_KEYS = new Set(["memberId", "sessionId", "name"]);
const EXPANSION_CAPACITY_KEYS = new Set(["memberSlots", "activeTurnSlots", "taskSlots", "availableWorkstreams"]);
const EXPANSION_STORED_WORKSTREAM_KEYS = new Set(["title", "deliverable", "acceptanceCriteria", "files", "resources"]);
const ADMISSION_DIAGNOSTIC_KEYS = new Set(["active", "queued", "quarantined", "limit", "waitMs"]);
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
const TASK_HISTORY_KEYS = new Set(["kind", "at", "attempt", "claimId", "leaseEpoch", "reason", "errorCode", "errorStage", "retryable", "admission"]);
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
  return {
    ...document,
    teams: document.teams.map((team) => team.state === "closed"
      ? { id: team.id, rootLeadSessionId: team.rootLeadSessionId, state: "closed" }
      : { ...team, state: effectiveTeamState(team) }),
  };
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
  const lazyTeam = value !== null && typeof value === "object" ? LAZY_TEAM_STATES.get(value) : undefined;
  return structuredClone(lazyTeam === undefined ? value : lazyTeam.load());
}
function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}
function immutableClone(value) {
  return deepFreeze(clone(value));
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
  // File and external-resource boundaries are identity-bearing. Preserve every
  // Unicode code point; only separators and literal dot segments are structural.
  let normalized = nonEmptyString(value, field, 1_024);
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(normalized)) reject(`${field} contains unsupported control characters`, "AGENT_TEAMS_INVALID_EXPANSION");
  normalized = normalized.replace(/\\/gu, "/");
  const scheme = file ? undefined : normalized.match(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)(.*)$/u);
  const prefix = scheme?.[1] ?? "";
  normalized = scheme?.[2] ?? normalized;
  normalized = normalized.replace(/\/{2,}/gu, "/");
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(/(^|\/)\.(?:\/|$)/gu, "$1").replace(/\/{2,}/gu, "/");
  } while (normalized !== previous);
  if (normalized.split("/").includes("..")) reject(`${field} must not contain parent-directory traversal`, "AGENT_TEAMS_INVALID_EXPANSION");
  if (normalized.length > 1 && !(file && /^[A-Za-z]:\/$/u.test(normalized))) normalized = normalized.replace(/\/+$/u, "");
  normalized = `${prefix}${normalized}`;
  if (normalized.length === 0) reject(`${field} must identify a file or directory boundary`, "AGENT_TEAMS_INVALID_EXPANSION");
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
  return normalizeExpansionBoundary(value, "resource boundary");
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
  if (!Array.isArray(input.workstreams) || input.workstreams.length < 2 || input.workstreams.length > MAX_EXPANSION_WORKSTREAMS) {
    reject(`workstreams must contain 2 through ${MAX_EXPANSION_WORKSTREAMS} sustained independent outcomes; one stream stays with the current member`, "AGENT_TEAMS_INVALID_EXPANSION");
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
function canonicalExpansionText(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
function canonicalExpansionWorkstreams(request, { comparisonPlatform } = {}) {
  return request.workstreams.map((workstream) => ({
    title: canonicalExpansionText(workstream.title).toLocaleLowerCase("en-US"),
    deliverable: canonicalExpansionText(workstream.deliverable),
    acceptanceCriteria: canonicalExpansionText(workstream.acceptanceCriteria),
    // Persistent v2 identity intentionally omits platform comparison. It records
    // codepoint-preserving structural identity and therefore reloads cross-OS.
    files: [...new Set(workstream.files.map((boundary) => comparisonPlatform === undefined
      ? normalizeExpansionBoundary(boundary, "file boundary", { file: true })
      : comparableExpansionFileBoundary(boundary, { platform: comparisonPlatform })))].sort(),
    resources: [...new Set(workstream.resources.map((boundary) => comparableExpansionResourceBoundary(boundary)))].sort(),
  })).sort((left, right) => {
    const leftKey = JSON.stringify(left), rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
function legacyExpansionRequestIdentity(teamId, worker, request) {
  const workstreams = request.workstreams.map((workstream) => ({
    title: canonicalExpansionText(workstream.title).toLocaleLowerCase("en-US"),
    deliverable: canonicalExpansionText(workstream.deliverable),
    acceptanceCriteria: canonicalExpansionText(workstream.acceptanceCriteria),
    files: [...workstream.files].sort(),
    resources: [...workstream.resources].sort(),
  })).sort((left, right) => {
    const leftKey = JSON.stringify(left), rightKey = JSON.stringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return createHash("sha256").update(JSON.stringify([
    "agent-teams-expansion-request-v1",
    teamId,
    worker.sessionId,
    request.sourceTaskId,
    canonicalExpansionText(request.parallelBenefit),
    workstreams,
  ])).digest("hex");
}
function expansionRequestIdentity(teamId, worker, request) {
  return createHash("sha256").update(JSON.stringify([
    "agent-teams-expansion-request-v2",
    teamId,
    worker.sessionId,
    request.sourceTaskId,
    canonicalExpansionText(request.parallelBenefit),
    canonicalExpansionWorkstreams(request),
  ])).digest("hex");
}
function expansionRequestsSemanticallyEquivalent(left, right, { platform = process.platform } = {}) {
  try {
    return left.sourceTaskId === right.sourceTaskId
      && canonicalExpansionText(left.parallelBenefit) === canonicalExpansionText(right.parallelBenefit)
      && JSON.stringify(canonicalExpansionWorkstreams(left, { comparisonPlatform: platform }))
        === JSON.stringify(canonicalExpansionWorkstreams(right, { comparisonPlatform: platform }));
  } catch {
    return false;
  }
}
function expansionRequestMessages(team) {
  return team.messages.filter((message) => message.kind === "expansion_request" && isRecord(message.expansionRequest));
}
function pendingExpansionRequestMessages(team) {
  return expansionRequestMessages(team).filter((message) => message.expansionWakeDeliveredAt === undefined);
}
function projectExpansionRequest(request) {
  return {
    ...clone(request),
    requestedBy: { memberId: request.requestedBy.memberId, name: request.requestedBy.name },
  };
}
function validateStoredExpansionRequest(value, field = "message.expansionRequest") {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(value, EXPANSION_REQUEST_KEYS, field);
  nonEmptyString(value.id, `${field}.id`, 256);
  nonEmptyString(value.teamId, `${field}.teamId`, 256);
  nonEmptyString(value.sourceTaskId, `${field}.sourceTaskId`, 256);
  nonEmptyString(value.sourceTaskTitle, `${field}.sourceTaskTitle`, 500);
  nonEmptyString(value.parallelBenefit, `${field}.parallelBenefit`, 2_000);
  if (!isRecord(value.requestedBy)) throw new TypeError(`${field}.requestedBy must be an object`);
  assertAllowedKeys(value.requestedBy, EXPANSION_REQUESTER_KEYS, `${field}.requestedBy`);
  nonEmptyString(value.requestedBy.memberId, `${field}.requestedBy.memberId`, 256);
  nonEmptyString(value.requestedBy.sessionId, `${field}.requestedBy.sessionId`, 256);
  nonEmptyString(value.requestedBy.name, `${field}.requestedBy.name`, 120);
  if (!Array.isArray(value.workstreams) || value.workstreams.length < 2 || value.workstreams.length > MAX_EXPANSION_WORKSTREAMS) throw new TypeError(`${field}.workstreams is invalid`);
  for (const [index, workstream] of value.workstreams.entries()) {
    if (!isRecord(workstream)) throw new TypeError(`${field}.workstreams[${index}] must be an object`);
    assertAllowedKeys(workstream, EXPANSION_STORED_WORKSTREAM_KEYS, `${field}.workstreams[${index}]`);
    nonEmptyString(workstream.title, `${field}.workstreams[${index}].title`, 200);
    nonEmptyString(workstream.deliverable, `${field}.workstreams[${index}].deliverable`, 2_000);
    nonEmptyString(workstream.acceptanceCriteria, `${field}.workstreams[${index}].acceptanceCriteria`, 2_000);
    assertStringArray(workstream.files, `${field}.workstreams[${index}].files`);
    assertStringArray(workstream.resources, `${field}.workstreams[${index}].resources`);
  }
  if (!isRecord(value.capacity)) throw new TypeError(`${field}.capacity must be an object`);
  assertAllowedKeys(value.capacity, EXPANSION_CAPACITY_KEYS, `${field}.capacity`);
  for (const key of EXPANSION_CAPACITY_KEYS) positiveInteger(value.capacity[key], `${field}.capacity.${key}`, { allowZero: true });
  assertIsoDate(value.requestedAt, `${field}.requestedAt`);
  return value;
}

function validateAdmissionDiagnostic(value, field) {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(value, ADMISSION_DIAGNOSTIC_KEYS, field);
  positiveInteger(value.active, `${field}.active`, { allowZero: true });
  positiveInteger(value.queued, `${field}.queued`, { allowZero: true });
  positiveInteger(value.quarantined, `${field}.quarantined`, { allowZero: true });
  positiveInteger(value.limit, `${field}.limit`);
  positiveInteger(value.waitMs, `${field}.waitMs`);
  return value;
}
function validateMemberRetirement(retirement) {
  if (!isRecord(retirement)) throw new TypeError("member.retirement must be an object");
  assertAllowedKeys(retirement, MEMBER_RETIREMENT_KEYS, "member.retirement");
  nonEmptyString(retirement.intentId, "member.retirement.intentId", 256);
  assertEnum(retirement.scope, MEMBER_RETIREMENT_SCOPES, "member.retirement.scope");
  assertEnum(retirement.status, MEMBER_RETIREMENT_STATES, "member.retirement.status");
  positiveInteger(retirement.pauseEpoch, "member.retirement.pauseEpoch", { allowZero: true });
  assertIsoDate(retirement.requestedAt, "member.retirement.requestedAt");
  assertIsoDate(retirement.updatedAt, "member.retirement.updatedAt");
  optionalString(retirement.targetRunId, "member.retirement.targetRunId", 256);
  if (retirement.completedAt !== undefined) assertIsoDate(retirement.completedAt, "member.retirement.completedAt");
  optionalString(retirement.stopReason, "member.retirement.stopReason", 64);
  optionalString(retirement.errorCode, "member.retirement.errorCode", 128);
  if (retirement.status === "completed" && retirement.completedAt === undefined) throw new TypeError("completed member retirement requires completedAt");
  return retirement;
}
function validateTerminalDiagnostic(diagnostic, field = "member.terminalDiagnostic") {
  if (!isRecord(diagnostic)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(diagnostic, TERMINAL_DIAGNOSTIC_KEYS, field);
  assertEnum(diagnostic.errorCode, TERMINAL_DIAGNOSTIC_CODES, `${field}.errorCode`);
  assertEnum(diagnostic.category, TERMINAL_DIAGNOSTIC_CATEGORIES, `${field}.category`);
  assertEnum(diagnostic.stage, TERMINAL_DIAGNOSTIC_STAGES, `${field}.stage`);
  if (typeof diagnostic.retryable !== "boolean") throw new TypeError(`${field}.retryable must be boolean`);
  if (typeof diagnostic.partialOutputPresent !== "boolean") throw new TypeError(`${field}.partialOutputPresent must be boolean`);
  assertEnum(diagnostic.nextAction, TERMINAL_DIAGNOSTIC_NEXT_ACTIONS, `${field}.nextAction`);
  return diagnostic;
}
function terminalDiagnosticCategory(rawCode, rawCategory, rawMessage, stopReason) {
  const code = typeof rawCode === "string" ? rawCode.slice(0, 256).toUpperCase() : "";
  const category = typeof rawCategory === "string" ? rawCategory.slice(0, 128).toLowerCase() : "";
  const message = typeof rawMessage === "string" ? rawMessage.slice(0, 1_024).toLowerCase() : "";
  if (code === "PI_AI_ERROR" || code.includes("PROVIDER") || message.includes("not found") || message.includes("provider")) return "provider_transient";
  if (TERMINAL_DIAGNOSTIC_CATEGORIES.includes(category)) return category;
  if (code.includes("TIMEOUT") || message.includes("timed out") || message.includes("timeout")) return "lifecycle_timeout";
  if (code.includes("ADMISSION") || code.includes("QUEUE_FULL") || message.includes("capacity") || message.includes("backpressure")) return "backpressure";
  if (code.includes("OUTCOME_UNKNOWN") || message.includes("outcome is unknown")) return "outcome_unknown";
  if (code.includes("TOKEN") || message.includes("token limit")) return "resource_limit";
  if (stopReason === "refusal" || code.includes("REFUSAL") || message.includes("refusal")) return "policy";
  if (code.includes("ABORT") || message.includes("cancel")) return "cancellation";
  if (code.includes("TEARDOWN") || message.includes("teardown")) return "teardown";
  return "internal";
}
function terminalDiagnosticStage(rawStage, category) {
  const stage = typeof rawStage === "string" ? rawStage.slice(0, 128).toLowerCase() : "";
  if (TERMINAL_DIAGNOSTIC_STAGES.includes(stage)) return stage;
  if (stage.includes("register") || stage.includes("provision")) return "registration";
  if (stage.includes("admission") || stage.includes("queue")) return "admission";
  if (stage.includes("dispatch") || category === "provider_transient") return "provider_dispatch";
  if (stage.includes("followup") || stage.includes("work")) return "work_followup";
  if (stage.includes("retir") || stage.includes("shutdown") || stage.includes("stop") || category === "teardown") return "retirement";
  if (stage.includes("recover") || stage.includes("reconcil") || stage.includes("retry")) return "recovery";
  return category === "backpressure" ? "admission" : category === "lifecycle_timeout" ? "work_followup" : "unknown";
}
function terminalDiagnosticNextAction(rawNextAction, category) {
  const nextAction = typeof rawNextAction === "string" ? rawNextAction.slice(0, 128).toLowerCase() : "";
  if (TERMINAL_DIAGNOSTIC_NEXT_ACTIONS.includes(nextAction)) return nextAction;
  if (category === "backpressure") return "wait_for_capacity";
  if (category === "outcome_unknown") return "reconcile_unknown_outcome";
  if (["provider_transient", "lifecycle_timeout"].includes(category)) return "retry_current_task";
  return "view_live_status";
}
function boundedSubagentTerminalDiagnostic(info) {
  if (!isPlainRecord(info)) return undefined;
  const source = ownDataDescriptorOrAbsent(info, "terminalDiagnostic");
  if (!isPlainRecord(source)) return undefined;
  const rawErrorCode = ownDataDescriptorOrAbsent(source, "errorCode");
  const rawCode = rawErrorCode === undefined ? ownDataDescriptorOrAbsent(source, "code") : rawErrorCode;
  const rawCategory = ownDataDescriptorOrAbsent(source, "category");
  const rawStage = ownDataDescriptorOrAbsent(source, "stage");
  const rawRetryable = ownDataDescriptorOrAbsent(source, "retryable");
  const rawPartialOutputPresent = ownDataDescriptorOrAbsent(source, "partialOutputPresent");
  const rawNextAction = ownDataDescriptorOrAbsent(source, "nextAction");
  const rawMessage = ownDataDescriptorOrAbsent(source, "message");
  const stopReason = ownDataDescriptorOrAbsent(info, "stopReason");
  const category = terminalDiagnosticCategory(rawCode, rawCategory, rawMessage, stopReason);
  const candidateCode = typeof rawCode === "string" ? rawCode.slice(0, 256).toUpperCase() : "";
  const errorCode = TERMINAL_DIAGNOSTIC_CODES.includes(candidateCode) ? candidateCode
    : category === "provider_transient" ? "AGENT_TEAMS_PROVIDER_TRANSIENT"
      : category === "lifecycle_timeout" ? "AGENT_TEAMS_LIFECYCLE_TIMEOUT"
        : category === "backpressure" ? "AGENT_TEAMS_BACKPRESSURE"
          : category === "outcome_unknown" ? "AGENT_TEAMS_OUTCOME_UNKNOWN"
            : stopReason === "refusal" ? "SUBAGENT_REFUSAL" : "AGENT_TEAMS_RUNTIME_FAILURE";
  return {
    errorCode,
    category,
    stage: terminalDiagnosticStage(rawStage, category),
    retryable: typeof rawRetryable === "boolean" ? rawRetryable : ["provider_transient", "lifecycle_timeout", "backpressure"].includes(category),
    partialOutputPresent: rawPartialOutputPresent === true,
    nextAction: terminalDiagnosticNextAction(rawNextAction, category),
  };
}
function terminalDiagnosticsEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return TERMINAL_DIAGNOSTIC_KEYS.size === Object.keys(left).length
    && Object.keys(left).every((key) => left[key] === right[key]);
}
function replaceMemberTerminalDiagnostic(member, diagnostic) {
  if (terminalDiagnosticsEqual(member.terminalDiagnostic, diagnostic)) return false;
  if (diagnostic === undefined) delete member.terminalDiagnostic;
  else member.terminalDiagnostic = diagnostic;
  return true;
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
  if (member.retirement !== undefined) validateMemberRetirement(member.retirement);
  optionalString(member.error, "member.error", 4_096);
  if (member.terminalDiagnostic !== undefined) validateTerminalDiagnostic(member.terminalDiagnostic);
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
      optionalString(entry.errorCode, `task.${field}[${index}].errorCode`, 128);
      optionalString(entry.errorStage, `task.${field}[${index}].errorStage`, 64);
      if (entry.retryable !== undefined && typeof entry.retryable !== "boolean") throw new TypeError(`task.${field}[${index}].retryable must be boolean`);
      if (entry.admission !== undefined) validateAdmissionDiagnostic(entry.admission, `task.${field}[${index}].admission`);
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

function validateProvisioningQueueEntry(entry, index) {
  const field = `team.provisioningQueue[${index}]`;
  if (!isRecord(entry)) throw new TypeError(`${field} must be an object`);
  assertAllowedKeys(entry, PROVISIONING_QUEUE_KEYS, field);
  nonEmptyString(entry.id, `${field}.id`, 256);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(entry.inputHash, `${field}.inputHash`, 64))) throw new TypeError(`${field}.inputHash is invalid`);
  positiveInteger(entry.enqueueSequence, `${field}.enqueueSequence`);
  nonEmptyString(entry.memberId, `${field}.memberId`, 256);
  nonEmptyString(entry.childId, `${field}.childId`, 256);
  normalizeWorkerName(entry.name);
  nonEmptyString(entry.role, `${field}.role`, 500);
  nonEmptyString(entry.prompt, `${field}.prompt`, 65_536);
  assertStringArray(entry.taskIds, `${field}.taskIds`);
  if (entry.taskIds.length === 0 || new Set(entry.taskIds).size !== entry.taskIds.length) throw new TypeError(`${field}.taskIds must be non-empty and unique`);
  positiveInteger(entry.pauseEpoch, `${field}.pauseEpoch`, { allowZero: true });
  positiveInteger(entry.planRevision, `${field}.planRevision`);
  if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(entry.planHash, `${field}.planHash`, 64))) throw new TypeError(`${field}.planHash is invalid`);
  const provider = optionalString(entry.provider, `${field}.provider`, 128);
  if (provider !== undefined && !PROVIDER_ID.test(provider)) throw new TypeError(`${field}.provider is invalid`);
  const model = optionalString(entry.model, `${field}.model`, 256);
  if (model !== undefined && !MODEL_ID.test(model)) throw new TypeError(`${field}.model is invalid`);
  assertEnum(entry.modelTier, MODEL_TIERS, `${field}.modelTier`);
  if (typeof entry.inheritsMain !== "boolean") throw new TypeError(`${field}.inheritsMain must be boolean`);
  nonEmptyString(entry.routeSource, `${field}.routeSource`, 128);
  assertEnum(entry.status, PROVISIONING_QUEUE_STATES, `${field}.status`);
  positiveInteger(entry.attempt, `${field}.attempt`, { allowZero: true });
  assertIsoDate(entry.createdAt, `${field}.createdAt`);
  assertIsoDate(entry.updatedAt, `${field}.updatedAt`);
  nonEmptyString(entry.admissionEpoch, `${field}.admissionEpoch`, 128);
  positiveInteger(entry.retryAfterRelease, `${field}.retryAfterRelease`);
  if (entry.admissionGeneration !== undefined) positiveInteger(entry.admissionGeneration, `${field}.admissionGeneration`);
  optionalString(entry.errorCode, `${field}.errorCode`, 128);
  optionalString(entry.errorStage, `${field}.errorStage`, 64);
  if (["dispatching", "outcome_unknown"].includes(entry.status) && entry.admissionGeneration === undefined) throw new TypeError(`${field}.${entry.status} requires an exact admission generation`);
  if (["queued", "provisioning"].includes(entry.status) && entry.admissionGeneration !== undefined) throw new TypeError(`${field}.${entry.status} cannot claim an admission generation`);
  return entry;
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
  if (message.status !== undefined) assertEnum(message.status, ["pending", "queued", "delivered", "failed"], "message.status");
  optionalString(message.deliveryError, "message.deliveryError", 4_096);
  if (message.queuedAt !== undefined) assertIsoDate(message.queuedAt, "message.queuedAt");
  if (message.deliveredAt !== undefined) assertIsoDate(message.deliveredAt, "message.deliveredAt");
  if (message.status === "queued" && (message.queuedAt === undefined || message.deliveredAt !== undefined)) throw new TypeError("queued message requires transport acceptance without claiming recipient delivery");
  if (message.kind !== undefined) {
    if (message.kind !== "expansion_request") throw new TypeError("message.kind is invalid");
    if (!/^[a-f0-9]{64}$/u.test(nonEmptyString(message.dedupeKey, "message.dedupeKey", 64))) throw new TypeError("message.dedupeKey is invalid");
    validateStoredExpansionRequest(message.expansionRequest);
    if (message.expansionRequest.id !== message.id) throw new TypeError("expansion request id must match its durable message id");
    if (message.expansionRequest.requestedBy.sessionId !== message.fromSessionId) throw new TypeError("expansion request sender must match its durable message sender");
    if (message.expansionWakeDeliveredAt !== undefined) assertIsoDate(message.expansionWakeDeliveredAt, "message.expansionWakeDeliveredAt");
  } else if (message.dedupeKey !== undefined || message.expansionRequest !== undefined || message.expansionWakeDeliveredAt !== undefined) throw new TypeError("structured message fields require a message kind");
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
  if (!Array.isArray(bootstrap.taskRefs) || bootstrap.taskRefs.length < 1 || bootstrap.taskRefs.length > MAX_BOOTSTRAP_TASKS) throw new TypeError("team.bootstrap.taskRefs is invalid");
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
  if (receipt.dispatchOutcome !== undefined) assertEnum(receipt.dispatchOutcome, ["not_started", "outcome_unknown", "accepted"], `team.memberRecoveries[${index}].dispatchOutcome`);
  if (receipt.retryable !== undefined && typeof receipt.retryable !== "boolean") throw new TypeError(`team.memberRecoveries[${index}].retryable must be boolean`);
  if (receipt.admission !== undefined) validateAdmissionDiagnostic(receipt.admission, `team.memberRecoveries[${index}].admission`);
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
  if (autopilot.parkedStateHash !== undefined && !/^[a-f0-9]{64}$/u.test(nonEmptyString(autopilot.parkedStateHash, "team.autopilot.parkedStateHash", 64))) throw new TypeError("team.autopilot.parkedStateHash is invalid");
  if (autopilot.parkedAt !== undefined) assertIsoDate(autopilot.parkedAt, "team.autopilot.parkedAt");
  if (autopilot.parkedStateHash !== undefined && (autopilot.parkedGoalRevision === undefined || autopilot.parkedAt === undefined)) throw new TypeError("team.autopilot parked state hash requires its durable Goal revision and timestamp");
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
  const provisioningQueue = team.provisioningQueue ?? [];
  if (!Array.isArray(provisioningQueue) || provisioningQueue.length > MAX_PROVISIONING_QUEUE) throw new TypeError("team.provisioningQueue is invalid");
  provisioningQueue.forEach(validateProvisioningQueueEntry);
  if (new Set(provisioningQueue.map((entry) => entry.id)).size !== provisioningQueue.length
    || new Set(provisioningQueue.map((entry) => entry.inputHash)).size !== provisioningQueue.length
    || new Set(provisioningQueue.map((entry) => entry.memberId)).size !== provisioningQueue.length
    || new Set(provisioningQueue.map((entry) => entry.childId)).size !== provisioningQueue.length) throw new TypeError("team.provisioningQueue identities must be unique");
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
  const queuedTaskIds = new Set();
  for (const entry of provisioningQueue) {
    if (entry.inputHash !== provisioningQueueInputHash({ teamId: team.id, ...entry })) throw new TypeError(`provisioning queue ${entry.id} input hash is invalid`);
    if (entry.taskIds.some((taskId) => !taskIds.has(taskId))) throw new TypeError(`provisioning queue ${entry.id} references an unknown task`);
    for (const taskId of entry.taskIds) {
      if (queuedTaskIds.has(taskId)) throw new TypeError(`task ${taskId} belongs to more than one provisioning queue entry`);
      queuedTaskIds.add(taskId);
    }
    const member = team.members.find((candidate) => candidate.id === entry.memberId);
    if (team.members.some((candidate) => candidate.id !== entry.memberId && memberNameKey(candidate.name) === memberNameKey(entry.name))
      || provisioningQueue.some((candidate) => candidate.id !== entry.id && memberNameKey(candidate.name) === memberNameKey(entry.name))) throw new TypeError(`provisioning queue ${entry.id} normalized member name is not unique`);
    if (entry.status === "queued") {
      if (member !== undefined) throw new TypeError(`queued provisioning entry ${entry.id} must not retain a member placeholder`);
      if (entry.taskIds.some((taskId) => team.tasks.find((task) => task.id === taskId)?.assigneeSessionId !== undefined)) throw new TypeError(`queued provisioning entry ${entry.id} tasks must remain unassigned`);
    } else if (["provisioning", "dispatching"].includes(entry.status)) {
      if (member?.state !== "provisioning" || member.sessionId !== `provisioning:${entry.memberId}`) throw new TypeError(`active provisioning entry ${entry.id} must bind its exact placeholder member`);
      if (entry.taskIds.some((taskId) => team.tasks.find((task) => task.id === taskId)?.assigneeSessionId !== member.sessionId)) throw new TypeError(`active provisioning entry ${entry.id} tasks must bind its exact placeholder`);
    } else if (entry.status === "outcome_unknown") {
      if (member?.state !== "failed" || member.sessionId !== entry.childId) throw new TypeError(`outcome-unknown provisioning entry ${entry.id} must retain its exact failed child`);
      if (entry.taskIds.some((taskId) => team.tasks.find((task) => task.id === taskId)?.assigneeSessionId !== entry.childId)) throw new TypeError(`outcome-unknown provisioning entry ${entry.id} tasks must retain their exact failed child`);
    }
  }
  if (team.members.filter(workerConsumesMemberSlot).length + provisioningQueue.filter((entry) => entry.status === "queued").length > HARD_MAX_MEMBERS) throw new TypeError(`team exceeds the hard limit of ${HARD_MAX_MEMBERS} active or queued teammates`);
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
  const expansionDedupeKeys = new Set();
  for (const message of team.messages) {
    if (messageIds.has(message.id)) throw new TypeError("team message ids must be unique");
    messageIds.add(message.id);
    if (!sessions.has(message.fromSessionId)) throw new TypeError(`message ${message.id} sender must belong to its source team`);
    if ((message.toTeamId === undefined || message.toTeamId === team.id) && !sessions.has(message.toSessionId)) {
      throw new TypeError(`message ${message.id} recipient must belong to its team`);
    }
    if (message.kind === "expansion_request") {
      const request = message.expansionRequest;
      if (message.toTeamId !== undefined || message.toSessionId !== team.rootLeadSessionId || request.teamId !== team.id) throw new TypeError(`expansion request ${message.id} must target its fixed root lead`);
      const requester = team.members.find((member) => member.id === request.requestedBy.memberId);
      if (requester?.kind !== "worker" || requester.sessionId !== request.requestedBy.sessionId || requester.sessionId !== message.fromSessionId) throw new TypeError(`expansion request ${message.id} must bind its exact requesting worker`);
      if (!taskIds.has(request.sourceTaskId)) throw new TypeError(`expansion request ${message.id} references an unknown source task`);
      const legacyDedupeKey = legacyExpansionRequestIdentity(team.id, requester, request);
      let canonicalDedupeKey;
      try { canonicalDedupeKey = expansionRequestIdentity(team.id, requester, request); }
      catch { /* A structurally invalid v2 boundary may remain valid historical v1 data. */ }
      if (![canonicalDedupeKey, legacyDedupeKey].includes(message.dedupeKey) || message.id !== `expansion:${message.dedupeKey}`) throw new TypeError(`expansion request ${message.id} canonical identity is invalid`);
      if (expansionDedupeKeys.has(message.dedupeKey)) throw new TypeError("team expansion request dedupe keys must be unique");
      expansionDedupeKeys.add(message.dedupeKey);
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
  let nextProvisioningSequence = Math.max(0, ...document.teams.flatMap((team) => (team.provisioningQueue ?? [])
    .map((entry) => Number.isSafeInteger(entry.enqueueSequence) && entry.enqueueSequence > 0 ? entry.enqueueSequence : 0)));
  for (const team of document.teams) {
    // No pre-v8 store could contain a Desktop Host-issued autopilot capability.
    // Discard any forged/experimental legacy grant instead of upgrading it into
    // trusted continuation authority during migration.
    if (legacy) team.autopilot = undefined;
    team.pauseEpoch ??= 0;
    team.ownershipHistory ??= [];
    team.taskCommandReceipts ??= [];
    for (const entry of team.provisioningQueue ?? []) if (entry.enqueueSequence === undefined) entry.enqueueSequence = ++nextProvisioningSequence;
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

function validateStoreHeader(document) {
  if (!isRecord(document) || document.version !== STORE_VERSION || !isRecord(document.settings)
    || !Array.isArray(document.routingReceipts)) throw new TypeError("agent teams store header has an unsupported shape or version");
  document.settings.enabled = Boolean(document.settings.enabled);
  document.settings.maxMembers = safeLimit(document.settings.maxMembers, "settings.maxMembers", 4);
  document.settings.maxActiveTurns = safeLimit(document.settings.maxActiveTurns, "settings.maxActiveTurns", 4);
  document.settings.autopilotEnabled = Boolean(document.settings.autopilotEnabled);
  document.settings.autopilotMaxAdditionalRounds = safeLimit(document.settings.autopilotMaxAdditionalRounds, "settings.autopilotMaxAdditionalRounds", DEFAULT_SETTINGS.autopilotMaxAdditionalRounds, AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS);
  if (document.routingReceipts.length > MAX_ROUTING_RECEIPTS) throw new TypeError("routingReceipts is invalid");
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
  return document;
}

/** Validate and normalize the complete disk document with non-destructive legacy migration. */
function validateStoreDocument(document) {
  if (!isRecord(document) || !(document.version === STORE_VERSION || LEGACY_STORE_VERSIONS.has(document.version)) || !isRecord(document.settings) || !Array.isArray(document.teams)) {
    throw new TypeError("agent teams store has an unsupported shape or version");
  }
  migrateStoreDocument(document);
  validateStoreHeader(document);
  document.teams.forEach(validateTeam);
  const provisioningEntries = document.teams.flatMap((team) => team.provisioningQueue ?? []);
  const provisioningSequences = provisioningEntries.map((entry) => entry.enqueueSequence);
  if (new Set(provisioningSequences).size !== provisioningSequences.length
    || new Set(provisioningEntries.map((entry) => entry.id)).size !== provisioningEntries.length
    || new Set(provisioningEntries.map((entry) => entry.childId)).size !== provisioningEntries.length) throw new TypeError("provisioning queue order and entry identities must be globally unique");
  const teamsById = new Map(document.teams.map((team) => [team.id, team]));
  if (teamsById.size !== document.teams.length) throw new TypeError("team ids must be unique");
  for (const owner of document.teams) for (const entry of owner.provisioningQueue ?? []) {
    const matches = document.teams.flatMap((team) => team.members.filter((member) => member.sessionId === entry.childId).map((member) => ({ team, member })));
    const exactUnknown = entry.status === "outcome_unknown" && matches.length === 1 && matches[0].team === owner && matches[0].member.id === entry.memberId;
    if (!(matches.length === 0 || exactUnknown)) throw new TypeError(`provisioning queue ${entry.id} child identity conflicts with an existing member`);
  }
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
      .flatMap((message) => [message.createdAt, message.queuedAt, message.deliveredAt]),
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
    ...(message.queuedAt === undefined ? {} : { queuedAt: message.queuedAt }),
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
  const provisioningOutcomeUnknown = (team.provisioningQueue ?? []).filter((entry) => entry.status === "outcome_unknown").map((entry) => entry.id);
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
  if (outcomeUnknownTasks.length > 0 || provisioningOutcomeUnknown.length > 0) codes.push("outcome_unknown");
  const derivedTasks = team.tasks.map((task) => deriveTaskAcrossTeams(task, team, teams));
  const blockedTasks = derivedTasks.filter((task) => task.blockedBy.length > 0).map((task) => task.id);
  const failedDependencyTasks = derivedTasks.filter((task) => task.failedBy.length > 0).map((task) => task.id);
  if (failedDependencyTasks.length > 0) codes.push("failed_dependency");
  return { required: codes.length > 0, codes, failedMembers, unconfirmedMembers, strandedTasks, releasedTasks, failedDeliveries, submittedTasks, blockedTasks, failedDependencyTasks, bootstrapIncomplete, planDraft, capabilityUnknownTasks, outcomeUnknownTasks, provisioningOutcomeUnknown };
}
function projectTeamScope(team) {
  // A task is not a user requirement. This is an observed work-plan baseline,
  // not a semantic verdict that the user approved (or rejected) later scope.
  const published = team.members.filter(member => member.kind === "worker")
    .map(member => Date.parse(member.publishedAt)).filter(Number.isFinite);
  const startedAt = published.length === 0 ? undefined : Math.min(...published);
  const datedTasks = team.tasks.filter(task => Number.isFinite(Date.parse(task.createdAt)));
  const baselineKnown = startedAt !== undefined && datedTasks.length === team.tasks.length;
  const addedTaskCount = baselineKnown ? datedTasks.filter(task => Date.parse(task.createdAt) > startedAt).length : undefined;
  return {
    objective: team.objective ?? team.name,
    baselineKnown,
    ...(baselineKnown ? { initialTaskCount: team.tasks.length - addedTaskCount, addedTaskCount } : {}),
    totalTaskCount: team.tasks.length,
    remainingTaskCount: team.tasks.filter(task => !taskIsTerminal(task)).length,
    reviewRecommended: baselineKnown && addedTaskCount > 0,
    ...(baselineKnown && addedTaskCount > 0 ? { notice: "Tasks were added after work started. Compare them with the team's original objective and the user's latest request. Internal task growth is not proof of new user requirements; defer unrelated findings instead of automatically expanding the project." } : {}),
  };
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
  const expansionRequests = expansionRequestMessages(team).map((message) => ({
    ...projectExpansionRequest(message.expansionRequest), messageStatus: message.status ?? "pending",
    ...(message.queuedAt === undefined ? {} : { queuedAt: message.queuedAt }),
    ...(message.expansionWakeDeliveredAt === undefined ? {} : { wakeDeliveredAt: message.expansionWakeDeliveredAt }),
  }));
  const provisioningQueue = (team.provisioningQueue ?? []).map((entry) => ({
    id: entry.id, enqueueSequence: entry.enqueueSequence, name: entry.name, taskIds: [...entry.taskIds], status: entry.status, attempt: entry.attempt,
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode }),
    ...(entry.errorStage === undefined ? {} : { errorStage: entry.errorStage }),
  }));
  const lifecycleState = effectiveTeamState(team);
  const projectedTeam = clone(team);
  delete projectedTeam.projectKey;
  delete projectedTeam.handoff;
  delete projectedTeam.taskCommandReceipts;
  delete projectedTeam.provisioningQueue;
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
    scope: projectTeamScope(team),
    status: lifecycleState,
    ...(team.closure === undefined ? {} : { closureOutcome: team.closure.outcome }),
    revision: team.revision ?? 1,
    lastActivityAt: latestTimestamp([
      team.updatedAt,
      ...members.map((member) => member.lastActivityAt),
      ...tasks.map((task) => task.updatedAt),
      ...messages.flatMap((message) => [message.createdAt, message.queuedAt, message.deliveredAt]),
    ]) ?? team.updatedAt,
    members,
    tasks,
    expansionRequests,
    provisioningQueue,
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
  return Date.parse(right.updatedAt ?? right.deliveredAt ?? right.queuedAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.deliveredAt ?? left.queuedAt ?? left.createdAt ?? 0);
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
    ...team.messages.flatMap((message) => [message.createdAt, message.queuedAt, message.deliveredAt]),
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
    scope: projectTeamScope(team),
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
function storeRetentionMaintenanceState(filePath) {
  let state = STORE_RETENTION_MAINTENANCE.get(filePath);
  if (state === undefined) {
    state = {
      foregroundEpoch: 0,
      foregroundCount: 0,
      requested: false,
      scheduled: undefined,
      running: false,
      runPromise: undefined,
    };
    STORE_RETENTION_MAINTENANCE.set(filePath, state);
  }
  return state;
}
function cleanupStoreRetentionMaintenance(filePath, state) {
  if (state.foregroundCount === 0 && !state.requested && state.scheduled === undefined && !state.running && state.runPromise === undefined) {
    if (STORE_RETENTION_MAINTENANCE.get(filePath) === state) STORE_RETENTION_MAINTENANCE.delete(filePath);
  }
}
function storeRetentionMaintenanceOwner(filePath) {
  return [...(STORE_INSTANCES.get(filePath) ?? [])].find((instance) => instance._retentionMaintenanceNeeded());
}
function scheduleStoreRetentionMaintenance(filePath) {
  const state = storeRetentionMaintenanceState(filePath);
  if (!state.requested || state.scheduled !== undefined || state.running || state.foregroundCount > 0) return;
  const scheduled = setImmediate(() => {
    if (state.scheduled !== scheduled) return;
    state.scheduled = undefined;
    if (!state.requested || state.running || state.foregroundCount > 0) {
      if (state.requested && !state.running && state.foregroundCount === 0) scheduleStoreRetentionMaintenance(filePath);
      else cleanupStoreRetentionMaintenance(filePath, state);
      return;
    }
    const owner = storeRetentionMaintenanceOwner(filePath);
    if (owner === undefined) {
      state.requested = false;
      cleanupStoreRetentionMaintenance(filePath, state);
      return;
    }
    state.requested = false;
    state.running = true;
    const foregroundEpoch = state.foregroundEpoch;
    const run = queueStoreMutation(filePath, () => owner._runRetentionMaintenance(state, foregroundEpoch));
    const captured = (async () => {
      try {
        let outcome;
        try { outcome = await run; }
        catch (error) { outcome = owner._recordUnexpectedRetentionMaintenanceFailure(error, state, foregroundEpoch); }
        state.running = false;
        if (state.runPromise === captured) state.runPromise = undefined;
        if (outcome?.status === "superseded" && storeRetentionMaintenanceOwner(filePath) !== undefined) state.requested = true;
        if (state.requested && state.foregroundCount === 0) scheduleStoreRetentionMaintenance(filePath);
        else cleanupStoreRetentionMaintenance(filePath, state);
      } catch {
        // The low-priority branch is always captured, even if diagnostic bookkeeping
        // itself fails. Never let maintenance become an unhandled rejection.
        state.running = false;
        if (state.runPromise === captured) state.runPromise = undefined;
        cleanupStoreRetentionMaintenance(filePath, state);
      }
    })();
    state.runPromise = captured;
  });
  scheduled.unref?.();
  state.scheduled = scheduled;
}
function requestStoreRetentionMaintenance(filePath) {
  const state = storeRetentionMaintenanceState(filePath);
  state.requested = true;
  scheduleStoreRetentionMaintenance(filePath);
}
function beginStoreRetentionForeground(filePath) {
  const state = storeRetentionMaintenanceState(filePath);
  state.foregroundEpoch += 1;
  state.foregroundCount += 1;
  if (state.scheduled !== undefined) {
    clearImmediate(state.scheduled);
    state.scheduled = undefined;
    state.requested = true;
  }
  if (state.running) state.requested = true;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    state.foregroundCount = Math.max(0, state.foregroundCount - 1);
    if (state.requested && state.foregroundCount === 0) scheduleStoreRetentionMaintenance(filePath);
    else cleanupStoreRetentionMaintenance(filePath, state);
  };
}
function cancelStoreRetentionMaintenance(filePath) {
  const state = STORE_RETENTION_MAINTENANCE.get(filePath);
  if (state === undefined) return;
  state.foregroundEpoch += 1;
  if (state.scheduled !== undefined) {
    clearImmediate(state.scheduled);
    state.scheduled = undefined;
  }
  state.requested = storeRetentionMaintenanceOwner(filePath) !== undefined;
  if (state.requested && !state.running && state.foregroundCount === 0) scheduleStoreRetentionMaintenance(filePath);
  else cleanupStoreRetentionMaintenance(filePath, state);
}
function storeRetentionMaintenanceDiagnostics(filePath) {
  const state = STORE_RETENTION_MAINTENANCE.get(filePath);
  return {
    requested: state?.requested === true,
    scheduled: state?.scheduled !== undefined,
    running: state?.running === true,
    foregroundCount: state?.foregroundCount ?? 0,
    foregroundEpoch: state?.foregroundEpoch ?? 0,
  };
}
async function settleStoreRetentionMaintenance(filePath) {
  for (;;) {
    const state = STORE_RETENTION_MAINTENANCE.get(filePath);
    if (state === undefined || !state.requested && state.scheduled === undefined && !state.running && state.runPromise === undefined) return;
    if (state.runPromise !== undefined) await state.runPromise;
    else await new Promise((resolveImmediate) => setImmediate(resolveImmediate));
  }
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
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  for (const [field, value] of [["limit", limit], ["maxQueued", maxQueued], ["maxQueuedPerRoot", maxQueuedPerRoot], ["waitMs", waitMs]]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  }
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") throw new TypeError("admission timer functions must be callable");
  let active = 0;
  let queued = 0;
  let closed = false;
  let nextGeneration = 0;
  let rejectedStarts = 0;
  let rejectedEnds = 0;
  let readyBarrier;
  let releaseSequence = 0;
  const admissionEpoch = randomUUID();
  const releaseListeners = new Set();
  const queues = new Map();
  const rootCancelEpochs = new WeakMap();
  const rootRing = [];
  const leases = new Map();
  const reservations = new Map();

  const removeRootFromRing = (root) => {
    const index = rootRing.indexOf(root);
    if (index >= 0) rootRing.splice(index, 1);
  };
  const cleanupWaiter = (waiter) => {
    if (waiter.timer !== undefined) clearTimer(waiter.timer);
    waiter.signal?.removeEventListener?.("abort", waiter.onAbort);
  };
  const rejectWaiter = (waiter, error) => {
    if (waiter.settled) return;
    waiter.settled = true;
    cleanupWaiter(waiter);
    waiter.reject(error);
  };
  const releaseSlot = (root, childId) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
      pump();
      const event = Object.freeze({ epoch: admissionEpoch, sequence: ++releaseSequence, rootSessionId: root?.id, childId, active });
      for (const listener of releaseListeners) {
        try { listener(event); } catch { /* release observers never veto capacity */ }
      }
    };
  };
  const grant = (waiter) => {
    if (waiter.settled) return;
    waiter.settled = true;
    cleanupWaiter(waiter);
    active += 1;
    waiter.resolve(releaseSlot(waiter.root, waiter.childId));
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
      let granted = false;
      for (let remaining = rootRing.length; remaining > 0 && !granted; remaining -= 1) {
        const root = rootRing.shift();
        const rootQueue = queues.get(root);
        if (rootQueue === undefined || rootQueue.length === 0) {
          queues.delete(root);
          continue;
        }
        const waiter = rootQueue[0];
        if (leases.has(waiter.childId)) {
          rootRing.push(root);
          continue;
        }
        rootQueue.shift();
        queued -= 1;
        if (rootQueue.length === 0) queues.delete(root);
        else rootRing.push(root);
        grant(waiter);
        granted = true;
      }
      if (!granted) break;
    }
  }
  const acquire = (root, childId, signal) => {
    if ((typeof root !== "object" && typeof root !== "function") || root === null) throw new TypeError("root must be the exact live root Agent object");
    if (closed) return Promise.reject(admissionFailure("team worker admission is closed", "AGENT_TEAMS_ADMISSION_CLOSED"));
    if (signal?.aborted) return Promise.reject(admissionCancellation());
    if (active < limit && rootRing.length === 0 && !leases.has(childId)) {
      active += 1;
      return Promise.resolve(releaseSlot(root, childId));
    }
    const rootQueue = queues.get(root) ?? [];
    if (queued >= maxQueued || rootQueue.length >= maxQueuedPerRoot) {
      return Promise.reject(admissionFailure("team worker admission queue is full; retry after active work settles", "AGENT_TEAMS_ADMISSION_QUEUE_FULL"));
    }
    return new Promise((resolve, rejectPromise) => {
      const waiter = { root, childId, signal, resolve, reject: rejectPromise, settled: false, timer: undefined, onAbort: undefined };
      waiter.onAbort = () => {
        if (!detach(waiter)) return;
        rejectWaiter(waiter, admissionCancellation());
        pump();
      };
      waiter.timer = setTimer(() => {
        if (!detach(waiter)) return;
        rejectWaiter(waiter, admissionFailure("team worker admission timed out before activation; retry later", "AGENT_TEAMS_ADMISSION_TIMEOUT"));
        pump();
      }, waitMs);
      waiter.timer?.unref?.();
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
  const current = (childId) => {
    const lease = leases.get(childId);
    return lease === undefined ? undefined : { generation: lease.generation, phase: lease.phase, runId: lease.runId };
  };
  const abandon = (childId, generation) => {
    const lease = leases.get(childId);
    if (lease === undefined || generation !== undefined && lease.generation !== generation || lease.runId !== undefined || lease.phase !== "reserved") return false;
    leases.delete(childId);
    lease.release();
    return true;
  };
  const confirmDrained = (childId, generation) => {
    const lease = leases.get(childId);
    if (lease === undefined || !Number.isSafeInteger(generation) || lease.generation !== generation) return false;
    leases.delete(childId);
    lease.release();
    return true;
  };
  const adopt = (root, childId, runId) => {
    if ((typeof root !== "object" && typeof root !== "function") || root === null) throw new TypeError("root must be the exact live root Agent object");
    nonEmptyString(childId, "childId", 256);
    const exactRunId = nonEmptyString(String(runId), "runId", 256);
    const existing = leases.get(childId);
    if (existing !== undefined) {
      if (existing.root !== root || existing.runId !== undefined && existing.runId !== exactRunId) return false;
      existing.runId = exactRunId;
      existing.phase = "adopted";
      return true;
    }
    active += 1;
    leases.set(childId, { root, generation: ++nextGeneration, runId: exactRunId, phase: "adopted", release: releaseSlot(root, childId) });
    return true;
  };
  const setReady = (promise) => {
    readyBarrier = Promise.resolve(promise);
    return readyBarrier;
  };
  const run = async (root, childId, signal, operation, continuationGeneration) => {
    nonEmptyString(childId, "childId", 256);
    if ((typeof root !== "object" && typeof root !== "function") || root === null) throw new TypeError("root must be the exact live root Agent object");
    if (typeof operation !== "function") throw new TypeError("team worker admission operation must be a function");
    if (continuationGeneration !== undefined && (!Number.isSafeInteger(continuationGeneration) || continuationGeneration < 1)) throw new TypeError("continuationGeneration must be a positive safe integer");
    const cancelEpoch = rootCancelEpochs.get(root) ?? 0;
    if (readyBarrier !== undefined) await readyBarrier;
    if ((rootCancelEpochs.get(root) ?? 0) !== cancelEpoch || signal?.aborted) throw admissionCancellation();
    if (closed) throw admissionFailure("team worker admission is closed", "AGENT_TEAMS_ADMISSION_CLOSED");
    const existing = leases.get(childId);
    if (continuationGeneration !== undefined) {
      if (existing?.root !== undefined && existing.root !== root) reject("team worker activation belongs to another exact root", "AGENT_TEAMS_UNAUTHORIZED");
      if (existing === undefined || existing.generation !== continuationGeneration || existing.runId === undefined || !["started", "adopted"].includes(existing.phase)) {
        const error = admissionFailure("team worker continuation does not match an exact started admission generation", "AGENT_TEAMS_ADMISSION_HANDSHAKE_PENDING");
        error.admissionGeneration = existing?.generation;
        throw error;
      }
      if (reservations.has(childId)) throw admissionFailure("team worker activation already has an unresolved admission reservation", "AGENT_TEAMS_ADMISSION_HANDSHAKE_PENDING");
      return operation();
    }
    if (existing !== undefined && existing.root !== root) reject("team worker activation belongs to another exact root", "AGENT_TEAMS_UNAUTHORIZED");
    let reservation = reservations.get(childId);
    if (reservation !== undefined) {
      if (reservation.root !== root) reject("team worker activation belongs to another exact root", "AGENT_TEAMS_UNAUTHORIZED");
      const error = admissionFailure("team worker activation already has an unresolved admission reservation", "AGENT_TEAMS_ADMISSION_HANDSHAKE_PENDING");
      error.admissionGeneration = leases.get(childId)?.generation;
      throw error;
    }
    reservation = { root, promise: undefined };
    reservation.promise = (async () => {
      const release = await acquire(root, childId, signal);
      if (closed) {
        release();
        throw admissionFailure("team worker admission is closed", "AGENT_TEAMS_ADMISSION_CLOSED");
      }
      if (signal?.aborted) {
        release();
        throw admissionCancellation();
      }
      const exact = { root, generation: ++nextGeneration, runId: undefined, phase: "reserved", release };
      leases.set(childId, exact);
      return exact;
    })();
    reservations.set(childId, reservation);
    let lease;
    try { lease = await reservation.promise; }
    finally { if (reservations.get(childId) === reservation) reservations.delete(childId); }
    if (lease.root !== root) reject("team worker activation belongs to another exact root", "AGENT_TEAMS_UNAUTHORIZED");
    const created = true;
    if (signal?.aborted) {
      if (created) abandon(childId, lease.generation);
      throw admissionCancellation();
    }
    try {
      const value = await operation();
      if (created && leases.get(childId) === lease && lease.runId === undefined) lease.phase = "accepted_unbound";
      return value;
    } catch (error) {
      if (created && leases.get(childId) === lease && lease.runId === undefined) lease.phase = "operation_failed_unbound";
      throw error;
    }
  };
  const noteStart = (info) => {
    const lease = leases.get(info?.id);
    if (lease === undefined || info?.runId === undefined) { rejectedStarts += 1; return false; }
    const runId = String(info.runId);
    if (lease.runId !== undefined && lease.runId !== runId) { rejectedStarts += 1; return false; }
    lease.runId = runId;
    lease.phase = lease.phase === "adopted" ? "adopted" : "started";
    return true;
  };
  const noteEnd = (info) => {
    const lease = leases.get(info?.id);
    if (lease === undefined || lease.runId === undefined || info?.runId === undefined || lease.runId !== String(info.runId)) { rejectedEnds += 1; return false; }
    leases.delete(info.id);
    lease.release();
    return true;
  };
  const cancelRoot = (root, error = admissionCancellation()) => {
    if ((typeof root === "object" || typeof root === "function") && root !== null) rootCancelEpochs.set(root, (rootCancelEpochs.get(root) ?? 0) + 1);
    const rootQueue = queues.get(root);
    if (rootQueue === undefined) return 0;
    queues.delete(root);
    removeRootFromRing(root);
    queued -= rootQueue.length;
    for (const waiter of rootQueue) rejectWaiter(waiter, error);
    pump();
    return rootQueue.length;
  };
  const subscribeRelease = (listener) => {
    if (typeof listener !== "function") throw new TypeError("admission release listener must be a function");
    if (closed) return () => undefined;
    releaseListeners.add(listener);
    return () => releaseListeners.delete(listener);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    const error = admissionFailure("team worker admission closed before activation", "AGENT_TEAMS_ADMISSION_CLOSED");
    for (const rootQueue of queues.values()) for (const waiter of rootQueue) rejectWaiter(waiter, error);
    queues.clear();
    rootRing.length = 0;
    queued = 0;
    releaseListeners.clear();
  };
  const snapshot = () => ({
    active,
    queued,
    quarantined: [...leases.values()].filter((lease) => lease.runId === undefined && lease.phase !== "reserved").length,
    reserved: [...leases.values()].filter((lease) => lease.phase === "reserved").length,
    started: [...leases.values()].filter((lease) => lease.phase === "started").length,
    adopted: [...leases.values()].filter((lease) => lease.phase === "adopted").length,
    rejectedStarts,
    rejectedEnds,
    closed,
    limit,
    maxQueued,
    maxQueuedPerRoot,
    waitMs,
  });
  return {
    abandon, adopt, cancelRoot, close, confirmDrained, current, noteEnd, noteStart, run, setReady, snapshot, subscribeRelease,
    epoch: () => admissionEpoch,
    releaseSequence: () => releaseSequence,
  };
}
function boundedDiagnosticCode(error, fallback) {
  const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(error.code) ? error.code : fallback;
  return code.slice(0, 128);
}
function admissionDiagnostic(admission) {
  const snapshot = admission?.snapshot?.();
  if (!isRecord(snapshot)) return undefined;
  return {
    active: Number.isSafeInteger(snapshot.active) && snapshot.active >= 0 ? snapshot.active : 0,
    queued: Number.isSafeInteger(snapshot.queued) && snapshot.queued >= 0 ? snapshot.queued : 0,
    quarantined: Number.isSafeInteger(snapshot.quarantined) && snapshot.quarantined >= 0 ? snapshot.quarantined : 0,
    limit: Number.isSafeInteger(snapshot.limit) && snapshot.limit > 0 ? snapshot.limit : GLOBAL_TEAM_ACTIVE_ACTIVATIONS,
    waitMs: Number.isSafeInteger(snapshot.waitMs) && snapshot.waitMs > 0 ? snapshot.waitMs : TEAM_ADMISSION_TIMEOUT_MS,
  };
}
function admissionDidNotDispatch(error) {
  return ["AGENT_TEAMS_ADMISSION_CANCELLED", "AGENT_TEAMS_ADMISSION_TIMEOUT", "AGENT_TEAMS_ADMISSION_QUEUE_FULL", "AGENT_TEAMS_ADMISSION_CLOSED", "AGENT_TEAMS_ADMISSION_HANDSHAKE_PENDING"].includes(error?.code);
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
    if (waiter.initialRunId !== undefined) waiter.targetRunId = waiter.initialRunId;
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
function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}
function jsonArtifact(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  return { bytes, hash: sha256Bytes(bytes), size: bytes.length };
}
function storeHeader(document) {
  return {
    version: STORE_VERSION,
    settings: clone(document.settings),
    routingReceipts: clone(document.routingReceipts),
    routingReceiptArchive: clone(document.routingReceiptArchive),
  };
}
function assembleStoreDocument(header, teams) {
  return {
    version: STORE_VERSION,
    settings: clone(header.settings),
    teams,
    routingReceipts: clone(header.routingReceipts),
    routingReceiptArchive: clone(header.routingReceiptArchive),
  };
}
function assembleImmutableStoreView(header, teams) {
  return Object.freeze({
    version: STORE_VERSION,
    settings: immutableClone(header.settings),
    teams: Object.freeze(teams),
    routingReceipts: immutableClone(header.routingReceipts),
    routingReceiptArchive: immutableClone(header.routingReceiptArchive),
  });
}
function teamComparableJson(team) {
  const comparable = {};
  for (const [key, value] of Object.entries(team)) if (key !== "revision") comparable[key] = value;
  return JSON.stringify(comparable);
}
function hotColdLayout(filePath) {
  const root = `${filePath}.ledger`;
  return {
    root,
    pointerPath: join(root, "current.json"),
    promotionMarkerPath: `${filePath}.promoted.json`,
    legacyPromotionMarkerPath: join(root, "promoted.json"),
  };
}
function hotColdPreference(defaults) {
  if (defaults?.hotColdStore === true) return "force";
  if (defaults?.hotColdStore === false) return "disabled";
  const configured = String(process.env[HOT_COLD_STORE_ENV] ?? "").trim().toLowerCase();
  if (["0", "false", "off", "legacy"].includes(configured)) return "disabled";
  if (["1", "true", "on", "force"].includes(configured)) return "force";
  return "auto";
}
function hotColdArtifactPath(layoutRoot, reference) {
  if (typeof reference !== "string" || !HOT_COLD_FILE_REF.test(reference)) throw new TypeError("agent teams hot/cold artifact reference is invalid");
  return join(layoutRoot, ...reference.split("/"));
}
function validateCanonicalArtifactDescriptor(artifact, kind, generation) {
  if (!isRecord(artifact) || !/^[a-f0-9]{64}$/u.test(artifact.hash ?? "") || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) throw new TypeError("Agent Teams artifact descriptor is invalid");
  const expected = kind === "closed" ? `closed/team-${artifact.hash}.json`
    : kind === "catalog" ? `catalog/catalog-${artifact.hash}.json`
      : kind === "legacy" ? `legacy/v8-${artifact.hash}.json`
        : kind === "hot" ? `hot/hot-${generation}-${artifact.hash}.json`
          : kind === "manifest" ? `manifests/manifest-${generation}-${artifact.hash}.json`
            : undefined;
  if (expected === undefined || artifact.path !== expected) throw new TypeError(`Agent Teams ${kind} artifact descriptor is noncanonical`);
  hotColdArtifactPath(".", artifact.path);
  return artifact;
}
async function syncStoreDirectory(directoryPath) {
  let directory;
  try {
    directory = await open(directoryPath, "r");
    await directory.sync();
  } catch {
    // Windows commonly rejects directory handles; every file was independently fsynced.
  } finally {
    await directory?.close().catch(() => undefined);
  }
}
async function writeImmutableArtifact(layoutRoot, reference, bytes, { beforeRename } = {}) {
  const destination = hotColdArtifactPath(layoutRoot, reference);
  await mkdir(dirname(destination), { recursive: true });
  try {
    const existing = await readFile(destination);
    if (!existing.equals(bytes)) throw new TypeError(`immutable Agent Teams artifact collision at ${reference}`);
    return destination;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  let tempOwned = true;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await beforeRename?.(temp, destination);
      await rename(temp, destination);
      tempOwned = false;
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      const existing = await readFile(destination);
      if (!existing.equals(bytes)) throw new TypeError(`immutable Agent Teams artifact collision at ${reference}`);
    }
    const [verification] = await Promise.allSettled([
      readFile(destination),
      syncStoreDirectory(dirname(destination)),
    ]);
    if (verification.status === "rejected") throw verification.reason;
    if (!verification.value.equals(bytes)) throw new TypeError(`immutable Agent Teams artifact failed verification at ${reference}`);
    return destination;
  } finally {
    await handle?.close().catch(() => undefined);
    if (tempOwned) await rm(temp, { force: true }).catch(() => undefined);
  }
}
async function prepareAtomicArtifact(filePath, bytes) {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  let tempOwned = true;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return {
    async commit() {
      if (!tempOwned) throw new TypeError(`atomic Agent Teams artifact preparation was already committed at ${filePath}`);
      await rename(temp, filePath);
      tempOwned = false;
      const [verification] = await Promise.allSettled([
        readFile(filePath),
        syncStoreDirectory(dirname(filePath)),
      ]);
      if (verification.status === "rejected") throw verification.reason;
      if (!verification.value.equals(bytes)) throw new TypeError(`atomic Agent Teams artifact failed verification at ${filePath}`);
    },
    async dispose() {
      if (!tempOwned) return;
      tempOwned = false;
      await rm(temp, { force: true }).catch(() => undefined);
    },
  };
}
async function replaceAtomicArtifact(filePath, bytes) {
  const prepared = await prepareAtomicArtifact(filePath, bytes);
  try { await prepared.commit(); }
  finally { await prepared.dispose(); }
}
function filesystemPathIdentityKey(value, platform = process.platform) {
  const literal = String(value);
  if (platform !== "win32") return literal;
  // Filesystem identity must never compose, decompose, or compatibility-normalize
  // Unicode. Windows identity only folds its actual separator/case/trailing rules.
  let normalized = win32Path.normalize(literal.replace(/\//gu, "\\"));
  const root = win32Path.parse(normalized).root;
  while (normalized.length > root.length && normalized.endsWith("\\")) normalized = normalized.slice(0, -1);
  return normalized.toLowerCase();
}
function filesystemStatIdentity(info) {
  const validPart = (value) => typeof value === "bigint" ? value >= 0n : Number.isSafeInteger(value) && value >= 0;
  if (!isRecord(info) || !validPart(info.dev) || !validPart(info.ino) || String(info.ino) === "0") return undefined;
  return `${String(info.dev)}:${String(info.ino)}`;
}
function canonicalPathIsWithin(root, candidate, platform = process.platform) {
  const dialect = platform === "win32" ? win32Path : posixPath;
  const rootKey = filesystemPathIdentityKey(root, platform);
  const candidateKey = filesystemPathIdentityKey(candidate, platform);
  const offset = dialect.relative(rootKey, candidateKey);
  return offset === "" || !dialect.isAbsolute(offset) && offset.split(platform === "win32" ? /[\\/]/u : /\//u)[0] !== "..";
}
async function canonicalFilesystemLocation(inputPath, { requireExisting = false } = {}) {
  const absolute = resolve(inputPath);
  let direct;
  try { direct = await lstat(absolute); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (requireExisting) throw error;
  }
  if (direct !== undefined) {
    const canonicalPath = await realpath(absolute);
    const info = await stat(canonicalPath, { bigint: true });
    return { absolute, canonicalPath: resolve(canonicalPath), info, identity: filesystemStatIdentity(info), directReparse: direct.isSymbolicLink() };
  }
  let ancestor = dirname(absolute);
  for (;;) {
    let ancestorLink;
    try { ancestorLink = await lstat(ancestor); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
      continue;
    }
    let canonicalAncestor;
    try { canonicalAncestor = await realpath(ancestor); }
    catch (error) {
      // A dangling or otherwise unresolvable junction/reparse point is not a safe
      // basis for an export path. Never fall back to its lexical spelling.
      throw new HarnessError("the export destination parent cannot be resolved safely", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN", { cause: error });
    }
    const ancestorInfo = await stat(canonicalAncestor, { bigint: true });
    if (!ancestorInfo.isDirectory()) throw new HarnessError("the export destination parent is not a directory", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN");
    return {
      absolute,
      canonicalPath: resolve(canonicalAncestor, relative(ancestor, absolute)),
      info: undefined,
      identity: undefined,
      directReparse: false,
      ancestorReparse: ancestorLink.isSymbolicLink(),
    };
  }
}
async function managedLedgerFilesystemLocations(ledgerRoot) {
  const paths = [join(ledgerRoot, "current.json"), join(ledgerRoot, "promoted.json")];
  for (const directory of ["closed", "catalog", "hot", "legacy", "manifests"]) {
    let children;
    try { children = await readdir(join(ledgerRoot, directory), { withFileTypes: true }); }
    catch (error) { if (error?.code === "ENOENT") continue; throw error; }
    for (const child of children) {
      const reference = `${directory}/${child.name}`;
      if (HOT_COLD_FILE_REF.test(reference)) paths.push(join(ledgerRoot, directory, child.name));
    }
  }
  const locations = [];
  for (const filePath of paths) {
    try { locations.push(await canonicalFilesystemLocation(filePath, { requireExisting: true })); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  return locations;
}
async function canonicalV8ExportTarget(sourcePath, ledgerRoot, destination) {
  let source;
  let ledger;
  let sentinel;
  let target;
  let managedLedgerLocations;
  try {
    [source, ledger, sentinel, target, managedLedgerLocations] = await Promise.all([
      canonicalFilesystemLocation(sourcePath, { requireExisting: true }),
      canonicalFilesystemLocation(ledgerRoot),
      canonicalFilesystemLocation(`${sourcePath}.promoted.json`),
      canonicalFilesystemLocation(destination),
      managedLedgerFilesystemLocations(ledgerRoot),
    ]);
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("the export destination cannot be resolved safely", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN", { cause: error });
  }
  const sourceKey = filesystemPathIdentityKey(source.canonicalPath);
  const sentinelKey = filesystemPathIdentityKey(sentinel.canonicalPath);
  const targetKey = filesystemPathIdentityKey(target.canonicalPath);
  if (sourceKey === targetKey || source.identity !== undefined && source.identity === target.identity) {
    throw new HarnessError("the immutable v8 migration source cannot be overwritten", "AGENT_TEAMS_V8_SOURCE_READ_ONLY");
  }
  if (sentinelKey === targetKey || sentinel.identity !== undefined && sentinel.identity === target.identity) {
    throw new HarnessError("v8 exports cannot overwrite the promotion sentinel", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN");
  }
  if (managedLedgerLocations.some((location) => filesystemPathIdentityKey(location.canonicalPath) === targetKey
    || location.identity !== undefined && location.identity === target.identity)) {
    throw new HarnessError("v8 exports cannot overwrite or alias managed hot/cold ledger artifacts", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN");
  }
  if (canonicalPathIsWithin(ledger.canonicalPath, target.canonicalPath)) {
    throw new HarnessError("v8 exports cannot overwrite hot/cold ledger artifacts", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN");
  }
  if (target.info !== undefined && !target.info.isFile()) throw new HarnessError("the v8 export destination must be a regular file", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN");
  if (target.directReparse) throw new HarnessError("the v8 export destination cannot be a reparse point", "AGENT_TEAMS_V8_EXPORT_TARGET_FORBIDDEN");
  return target.canonicalPath;
}
function verifiedArtifactBytesSync(layoutRoot, artifact) {
  if (!isRecord(artifact) || !/^[a-f0-9]{64}$/u.test(artifact.hash ?? "") || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) throw new TypeError("Agent Teams artifact descriptor is invalid");
  const bytes = readFileSync(hotColdArtifactPath(layoutRoot, artifact.path));
  if (bytes.length !== artifact.bytes || sha256Bytes(bytes) !== artifact.hash) throw new TypeError(`Agent Teams artifact integrity mismatch at ${artifact.path}`);
  return bytes;
}
async function verifiedArtifactBytes(layoutRoot, artifact) {
  if (!isRecord(artifact) || !/^[a-f0-9]{64}$/u.test(artifact.hash ?? "") || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) throw new TypeError("Agent Teams artifact descriptor is invalid");
  const bytes = await readFile(hotColdArtifactPath(layoutRoot, artifact.path));
  if (bytes.length !== artifact.bytes || sha256Bytes(bytes) !== artifact.hash) throw new TypeError(`Agent Teams artifact integrity mismatch at ${artifact.path}`);
  return bytes;
}
function parseVerifiedArtifactSync(layoutRoot, artifact) {
  return JSON.parse(verifiedArtifactBytesSync(layoutRoot, artifact).toString("utf8"));
}
async function parseVerifiedArtifact(layoutRoot, artifact) {
  return JSON.parse((await verifiedArtifactBytes(layoutRoot, artifact)).toString("utf8"));
}
function promotionSentinelArtifact(sourceV8, phase) {
  validateCanonicalArtifactDescriptor(sourceV8, "legacy");
  if (!["prepared", "committed"].includes(phase)) throw new TypeError("Agent Teams promotion sentinel phase is invalid");
  return jsonArtifact({ version: HOT_COLD_PROMOTION_SENTINEL_VERSION, phase, sourceV8: clone(sourceV8) });
}
function validatePromotionSentinel(value) {
  if (!isRecord(value)) throw new TypeError("Agent Teams promotion sentinel is invalid");
  assertAllowedKeys(value, new Set(["version", "phase", "sourceV8"]), "Agent Teams promotion sentinel");
  if (value.version !== HOT_COLD_PROMOTION_SENTINEL_VERSION || !["prepared", "committed"].includes(value.phase)) throw new TypeError("Agent Teams promotion sentinel is invalid");
  validateCanonicalArtifactDescriptor(value.sourceV8, "legacy");
  return value;
}
function validateLegacyPromotionMarker(value, sourceV8) {
  if (!isRecord(value)) throw new TypeError("Agent Teams legacy promotion marker is invalid");
  assertAllowedKeys(value, new Set(["version", "sourceV8Hash"]), "Agent Teams legacy promotion marker");
  if (value.version !== HOT_COLD_STORE_VERSION || !/^[a-f0-9]{64}$/u.test(value.sourceV8Hash ?? "") || value.sourceV8Hash !== sourceV8.hash) throw new TypeError("Agent Teams legacy promotion marker disagrees with the immutable v8 source");
  return value;
}
function teamLedgerIndex(team) {
  return {
    ownershipHistory: clone(team.ownershipHistory ?? []),
    members: team.members.map((member) => ({ id: member.id, sessionId: member.sessionId, kind: member.kind, state: member.state })),
    tasks: team.tasks.map((task) => ({ id: task.id, state: task.state, dependsOn: [...task.dependsOn], crossTeamDependsOn: clone(task.crossTeamDependsOn ?? []) })),
    provisioning: (team.provisioningQueue ?? []).map((entry) => ({ id: entry.id, childId: entry.childId, memberId: entry.memberId, enqueueSequence: entry.enqueueSequence, status: entry.status })),
    crossMessages: team.messages.filter((message) => message.toTeamId !== undefined && message.toTeamId !== team.id)
      .map((message) => ({ id: message.id, fromSessionId: message.fromSessionId, toSessionId: message.toSessionId, toTeamId: message.toTeamId })),
    ...(team.autopilot === undefined ? {} : { autopilot: clone(team.autopilot) }),
  };
}
function buildTeamLedgerEntry(team, ordinal, storage, artifact) {
  const content = jsonArtifact(team);
  if (artifact !== undefined && (artifact.hash !== content.hash || artifact.bytes !== content.size)) throw new TypeError(`Agent Teams team artifact does not match ${team.id}`);
  return {
    ordinal,
    id: team.id,
    storage,
    hash: content.hash,
    bytes: content.size,
    keys: Object.entries(team).filter(([, value]) => value !== undefined).map(([key]) => key),
    rootLeadSessionId: team.rootLeadSessionId,
    name: team.name,
    objective: team.objective,
    scope: projectTeamScope(team),
    revision: team.revision ?? 1,
    state: team.state,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    pauseEpoch: team.pauseEpoch ?? 0,
    ...(team.projectKey === undefined ? {} : { projectKey: team.projectKey }),
    ...(storage === "closed" ? { shard: clone(artifact) } : {}),
    index: teamLedgerIndex(team),
  };
}
function validateTeamLedgerEntry(entry, ordinal) {
  if (!isRecord(entry) || entry.ordinal !== ordinal || entry.id === undefined || !["hot", "closed"].includes(entry.storage)) throw new TypeError("Agent Teams manifest team entry is invalid");
  nonEmptyString(entry.id, "manifest.teams.id", 256);
  nonEmptyString(entry.rootLeadSessionId, "manifest.teams.rootLeadSessionId", 256);
  nonEmptyString(entry.name, "manifest.teams.name", 500);
  nonEmptyString(entry.objective, "manifest.teams.objective", 8_192);
  positiveInteger(entry.revision, "manifest.teams.revision");
  assertEnum(entry.state, TEAM_STATES, "manifest.teams.state");
  if ((entry.storage === "closed") !== (entry.state === "closed")) throw new TypeError("Agent Teams manifest storage class disagrees with team state");
  assertIsoDate(entry.createdAt, "manifest.teams.createdAt");
  assertIsoDate(entry.updatedAt, "manifest.teams.updatedAt");
  positiveInteger(entry.pauseEpoch, "manifest.teams.pauseEpoch", { allowZero: true });
  optionalString(entry.projectKey, "manifest.teams.projectKey", 64);
  if (!/^[a-f0-9]{64}$/u.test(entry.hash ?? "") || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw new TypeError("Agent Teams manifest team hash is invalid");
  if (!Array.isArray(entry.keys) || entry.keys.some((key) => !TEAM_KEYS.has(key)) || new Set(entry.keys).size !== entry.keys.length) throw new TypeError("Agent Teams manifest team keys are invalid");
  if (entry.storage === "closed" && (!isRecord(entry.shard) || entry.shard.hash !== entry.hash || entry.shard.bytes !== entry.bytes)) throw new TypeError("Agent Teams closed shard descriptor is invalid");
  if (entry.storage === "closed") validateCanonicalArtifactDescriptor(entry.shard, "closed");
  if (!isRecord(entry.index) || !Array.isArray(entry.index.ownershipHistory) || !Array.isArray(entry.index.members)
    || !Array.isArray(entry.index.tasks) || !Array.isArray(entry.index.provisioning) || !Array.isArray(entry.index.crossMessages)) throw new TypeError("Agent Teams manifest team index is invalid");
  return entry;
}
function teamEntrySecurityMaterial(entry) {
  return {
    id: entry.id,
    rootLeadSessionId: entry.rootLeadSessionId,
    state: entry.state,
    revision: entry.revision,
    pauseEpoch: entry.pauseEpoch,
    projectKey: entry.projectKey,
    hash: entry.hash,
    ownershipHistory: entry.index.ownershipHistory,
    members: entry.index.members,
    tasks: entry.index.tasks,
    provisioning: entry.index.provisioning,
    crossMessages: entry.index.crossMessages,
    autopilot: entry.index.autopilot,
  };
}
function documentMerkleHash(header, entries) {
  return sha256Bytes(Buffer.from(JSON.stringify(["agent-teams-document-merkle-v1", sha256Bytes(jsonArtifact(header).bytes), entries.map((entry) => [entry.ordinal, entry.id, entry.hash])]), "utf8"));
}
function documentSecurityHash(header, entries) {
  return sha256Bytes(Buffer.from(JSON.stringify(["agent-teams-security-index-v1", header.settings, header.routingReceipts, header.routingReceiptArchive, entries.map(teamEntrySecurityMaterial)]), "utf8"));
}
function rootProjectionHashes(document) {
  const roots = [...new Set(document.teams.map((team) => team.rootLeadSessionId))].sort();
  return roots.map((rootSessionId) => ({ rootSessionId, hash: sha256Bytes(Buffer.from(JSON.stringify(teamSnapshot(document, rootSessionId)), "utf8")) }));
}
function ledgerProjectionEntries(entries, rootSessionId) {
  const directlyRelated = entries.filter((entry) => entry.rootLeadSessionId === rootSessionId || entry.index.members.some((member) => member.sessionId === rootSessionId));
  const projects = new Set(directlyRelated.map((entry) => entry.projectKey).filter((value) => value !== undefined));
  const roots = new Set(directlyRelated.map((entry) => entry.rootLeadSessionId));
  return entries.filter((entry) => roots.has(entry.rootLeadSessionId) || entry.projectKey !== undefined && projects.has(entry.projectKey));
}
function rootLedgerProjectionHashes(header, entries) {
  const roots = [...new Set(entries.map((entry) => entry.rootLeadSessionId))].sort();
  const scopeHashes = new Map();
  return roots.map((rootSessionId) => {
    const projectedEntries = ledgerProjectionEntries(entries, rootSessionId);
    // Roots in the same project often have the exact same ACL projection. Preserve
    // the byte-identical projection hash while serializing that shared scope once.
    // Ordinals are already validated canonical integers, so this cache key never
    // normalizes or otherwise changes Unicode-bearing team identity fields.
    const scopeKey = JSON.stringify(projectedEntries.map((entry) => entry.ordinal));
    let hash = scopeHashes.get(scopeKey);
    if (hash === undefined) {
      hash = sha256Bytes(Buffer.from(JSON.stringify(["agent-teams-root-ledger-projection-v1", header.settings, projectedEntries]), "utf8"));
      scopeHashes.set(scopeKey, hash);
    }
    return { rootSessionId, hash };
  });
}
function rootAppearsInLedgerEntry(entry, rootSessionId) {
  return rootAppearsInValidOwnershipChain({
    rootLeadSessionId: entry.rootLeadSessionId,
    pauseEpoch: entry.pauseEpoch,
    projectKey: entry.projectKey,
    ownershipHistory: entry.index.ownershipHistory,
  }, rootSessionId);
}
function validateIndexedStore(header, entries, fullTeams = new Map()) {
  validateStoreHeader(header);
  entries.forEach(validateTeamLedgerEntry);
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new TypeError("Agent Teams manifest team ids must be unique");
  for (const [teamId, team] of fullTeams) {
    validateTeam(team);
    const entry = entries.find((candidate) => candidate.id === teamId);
    if (entry === undefined) throw new TypeError(`Agent Teams hot team ${teamId} is absent from the manifest`);
    const rebuilt = buildTeamLedgerEntry(team, entry.ordinal, entry.storage, entry.storage === "closed" ? entry.shard : undefined);
    if (JSON.stringify(rebuilt) !== JSON.stringify(entry)) throw new TypeError(`Agent Teams manifest index disagrees with team ${teamId}`);
  }
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const provisioning = entries.flatMap((entry) => entry.index.provisioning.map((item) => ({ owner: entry, ...item })));
  const provisioningSequences = provisioning.map((entry) => entry.enqueueSequence);
  if (new Set(provisioningSequences).size !== provisioningSequences.length
    || new Set(provisioning.map((entry) => entry.id)).size !== provisioning.length
    || new Set(provisioning.map((entry) => entry.childId)).size !== provisioning.length) throw new TypeError("provisioning queue order and entry identities must be globally unique");
  for (const queueEntry of provisioning) {
    const matches = entries.flatMap((entry) => entry.index.members.filter((member) => member.sessionId === queueEntry.childId).map((member) => ({ entry, member })));
    const exactUnknown = queueEntry.status === "outcome_unknown" && matches.length === 1 && matches[0].entry === queueEntry.owner && matches[0].member.id === queueEntry.memberId;
    if (!(matches.length === 0 || exactUnknown)) throw new TypeError(`provisioning queue ${queueEntry.id} child identity conflicts with an existing member`);
  }
  for (const receipt of header.routingReceipts) if (receipt.teamId !== undefined) {
    const entry = byId.get(receipt.teamId);
    if (entry === undefined || !rootAppearsInLedgerEntry(entry, receipt.rootSessionId) || entry.projectKey !== receipt.projectKey) throw new TypeError("routing receipt team scope must be Host-derived from the same ownership chain and project");
  }
  for (const entry of entries) {
    const autopilot = entry.index.autopilot;
    if (autopilot === undefined || !["pending_plan", "active"].includes(autopilot.status)) continue;
    const receipt = header.routingReceipts.find((candidate) => candidate.id === autopilot.routingReceiptId);
    const authority = receipt?.teamId === undefined ? undefined : byId.get(receipt.teamId);
    const exactGoalRoundAuthority = receipt?.establishmentAuthority === "goal_round"
      && receipt.goalId === autopilot.goalId && receipt.goalObjectiveHash === autopilot.goalObjectiveHash
      && receipt.goalMaxGoalRounds === autopilot.baseMaxGoalRounds && Number.isSafeInteger(receipt.goalRevision) && receipt.goalRevision > 0
      && Number.isSafeInteger(receipt.goalRound) && receipt.goalRound > 0 && receipt.goalRound <= receipt.goalMaxGoalRounds;
    if (receipt === undefined || receipt.level !== "level3" || !["created", "reused"].includes(receipt.outcome)
      || !(receipt.establishmentAuthority === "direct_human" || exactGoalRoundAuthority) || authority === undefined
      || receipt.projectKey !== entry.projectKey || authority.projectKey !== entry.projectKey
      || authority.rootLeadSessionId !== entry.rootLeadSessionId || !rootAppearsInLedgerEntry(authority, receipt.rootSessionId)) throw new TypeError("team.autopilot must bind one finalized Host-admitted Level 3 routing receipt in the same fixed-root project and exact Goal scope");
    if (header.settings.autopilotEnabled !== true || autopilot.maxAdditionalRounds > header.settings.autopilotMaxAdditionalRounds) throw new TypeError("live team autopilot exceeds the trusted Host policy");
  }
  const rootLeadSessions = new Set(entries.map((entry) => entry.rootLeadSessionId));
  const openTeamCounts = new Map();
  const activeWorkers = new Set();
  for (const entry of entries) {
    if (entry.state !== "closed") {
      const count = (openTeamCounts.get(entry.rootLeadSessionId) ?? 0) + 1;
      if (count > HARD_MAX_TEAMS_PER_ROOT) throw new TypeError(`a root lead cannot own more than ${HARD_MAX_TEAMS_PER_ROOT} unclosed peer teams`);
      openTeamCounts.set(entry.rootLeadSessionId, count);
      for (const member of entry.index.members) {
        if (member.kind !== "worker" || member.state === "retired") continue;
        if (rootLeadSessions.has(member.sessionId)) throw new TypeError("a root lead session cannot also be an active worker; nested teams are forbidden");
        if (activeWorkers.has(member.sessionId)) throw new TypeError("an active worker session cannot belong to multiple teams");
        activeWorkers.add(member.sessionId);
      }
    }
    for (const task of entry.index.tasks) for (const dependency of task.crossTeamDependsOn ?? []) {
      const target = byId.get(dependency.teamId);
      if (target === undefined) throw new TypeError(`task ${task.id} references an unknown dependency team`);
      if (target.rootLeadSessionId !== entry.rootLeadSessionId) throw new TypeError(`task ${task.id} crosses fixed root leads`);
      if (target.index.tasks.every((candidate) => candidate.id !== dependency.taskId)) throw new TypeError(`task ${task.id} references an unknown cross-team task`);
      if (dependency.teamId === entry.id && dependency.taskId === task.id) throw new TypeError("a task cannot depend on itself across teams");
    }
    for (const message of entry.index.crossMessages) {
      const target = byId.get(message.toTeamId);
      if (target === undefined) throw new TypeError(`message ${message.id} references an unknown target team`);
      if (target.rootLeadSessionId !== entry.rootLeadSessionId || message.fromSessionId !== entry.rootLeadSessionId) throw new TypeError(`message ${message.id} crosses teams without their common fixed root lead`);
      if (target.index.members.every((member) => member.sessionId !== message.toSessionId)) throw new TypeError(`message ${message.id} has an unknown target-team recipient`);
    }
  }
  const taskNodes = new Map(entries.flatMap((entry) => entry.index.tasks.map((task) => [taskNodeKey(entry.id, task.id), { entry, task }])));
  const visiting = new Set(), visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) throw new TypeError("cross-team task dependency cycle detected");
    if (visited.has(key)) return;
    const node = taskNodes.get(key);
    if (node === undefined) throw new TypeError("task dependency references an unknown task");
    visiting.add(key);
    for (const taskId of node.task.dependsOn) visit(taskNodeKey(node.entry.id, taskId));
    for (const dependency of node.task.crossTeamDependsOn ?? []) visit(taskNodeKey(dependency.teamId, dependency.taskId));
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of taskNodes.keys()) visit(key);
  return { header, entries };
}
function ledgerTeamStub(entry) {
  return Object.freeze({
    id: entry.id,
    rootLeadSessionId: entry.rootLeadSessionId,
    name: entry.name,
    objective: entry.objective,
    revision: entry.revision,
    state: entry.state,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    pauseEpoch: entry.pauseEpoch,
    ...(entry.projectKey === undefined ? {} : { projectKey: entry.projectKey }),
    ...(entry.index.autopilot === undefined ? {} : { autopilot: immutableClone(entry.index.autopilot) }),
  });
}
function createLazyTeamProxy(entry, loadTeam, tracker, { mutable = false } = {}) {
  const state = { entry, original: undefined, current: undefined, loaded: false, mutable };
  const summary = ledgerTeamStub(entry);
  const load = () => {
    if (!state.loaded) {
      const original = loadTeam(entry);
      state.original = original;
      // Even read callbacks receive an isolated value; only mutate() later commits it.
      state.current = clone(original);
      state.loaded = true;
    }
    return state.current;
  };
  const proxy = new Proxy({}, {
    get(_target, property) {
      // Mutable nested autopilot fields must load the real COW record so writes
      // cannot disappear into an index summary. Immutable/read views may use it.
      if (!state.loaded && Object.prototype.hasOwnProperty.call(summary, property) && !(state.mutable && property === "autopilot")) return summary[property];
      return Reflect.get(load(), property);
    },
    set(_target, property, value) { return Reflect.set(load(), property, value); },
    deleteProperty(_target, property) { return Reflect.deleteProperty(load(), property); },
    ownKeys() { return Reflect.ownKeys(load()); },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Object.getOwnPropertyDescriptor(load(), property);
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
    has(_target, property) {
      if (!state.loaded && Object.prototype.hasOwnProperty.call(summary, property)) return true;
      return Reflect.has(load(), property);
    },
    getPrototypeOf() { return Object.prototype; },
  });
  state.proxy = proxy;
  state.load = load;
  tracker.states.push(state);
  tracker.byProxy.set(proxy, state);
  LAZY_TEAM_STATES.set(proxy, state);
  return proxy;
}
function createLazyTeamView(entry, loadTeam) {
  const summary = ledgerTeamStub(entry);
  const state = { entry, current: undefined };
  const load = () => {
    state.current ??= immutableClone(loadTeam(entry));
    return state.current;
  };
  const view = {};
  for (const key of entry.keys) Object.defineProperty(view, key, {
    enumerable: true,
    configurable: false,
    get() {
      return state.current === undefined && Object.prototype.hasOwnProperty.call(summary, key) ? summary[key] : load()[key];
    },
  });
  state.load = load;
  LAZY_TEAM_VIEW_STATES.set(view, state);
  return Object.freeze(view);
}
function cloneLazyValue(value, tracker, seen = new Map()) {
  const tracked = tracker?.byProxy?.get(value);
  if (tracked !== undefined) return cloneLazyValue(tracked.load(), tracker, seen);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneLazyValue(item, tracker, seen));
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = cloneLazyValue(item, tracker, seen);
  return copy;
}
function validateHotColdPointer(pointer) {
  if (!isRecord(pointer) || pointer.version !== HOT_COLD_POINTER_VERSION || !Number.isSafeInteger(pointer.generation) || pointer.generation < 1 || !isRecord(pointer.manifest)) throw new TypeError("Agent Teams hot/cold pointer is invalid");
  assertAllowedKeys(pointer, new Set(["version", "generation", "manifest", "retentionFloorGeneration"]), "Agent Teams hot/cold pointer");
  if (pointer.manifest.generation !== pointer.generation) throw new TypeError("Agent Teams hot/cold pointer manifest is invalid");
  if (pointer.retentionFloorGeneration !== undefined) {
    const minimum = Math.max(1, pointer.generation - (HOT_COLD_RETENTION_MAX_COMPLETE_GENERATIONS - 1));
    const maximum = Math.max(1, pointer.generation - (HOT_COLD_RETENTION_COMPLETE_GENERATIONS - 1));
    if (!Number.isSafeInteger(pointer.retentionFloorGeneration) || pointer.retentionFloorGeneration < minimum || pointer.retentionFloorGeneration > maximum) throw new TypeError("Agent Teams hot/cold pointer retention floor is invalid");
  }
  validateCanonicalArtifactDescriptor(pointer.manifest, "manifest", pointer.generation);
  return pointer;
}
function validateHotColdManifest(manifest) {
  if (!isRecord(manifest) || manifest.version !== HOT_COLD_STORE_VERSION || manifest.storeVersion !== STORE_VERSION
    || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1 || !isRecord(manifest.sourceV8)
    || !isRecord(manifest.hot) || !isRecord(manifest.closedCatalog) || !Array.isArray(manifest.hotTeams)
    || !Number.isSafeInteger(manifest.teamCount) || manifest.teamCount < manifest.hotTeams.length
    || !Array.isArray(manifest.projectionHashes)) throw new TypeError("Agent Teams hot/cold manifest is invalid");
  assertIsoDate(manifest.createdAt, "manifest.createdAt");
  validateCanonicalArtifactDescriptor(manifest.sourceV8, "legacy");
  validateCanonicalArtifactDescriptor(manifest.hot, "hot", manifest.generation);
  validateCanonicalArtifactDescriptor(manifest.closedCatalog, "catalog");
  if (manifest.previous !== undefined) {
    if (!isRecord(manifest.previous) || !Number.isSafeInteger(manifest.previous.generation) || manifest.previous.generation < 1 || manifest.previous.generation >= manifest.generation) throw new TypeError("Agent Teams previous manifest reference is invalid");
    validateCanonicalArtifactDescriptor(manifest.previous, "manifest", manifest.previous.generation);
  }
  for (const entry of manifest.hotTeams) validateTeamLedgerEntry(entry, entry.ordinal);
  if (manifest.hotTeams.some((entry) => entry.storage !== "hot")) throw new TypeError("Agent Teams manifest hotTeams contains a closed entry");
  if (!/^[a-f0-9]{64}$/u.test(manifest.documentHash ?? "") || !/^[a-f0-9]{64}$/u.test(manifest.securityHash ?? "")) throw new TypeError("Agent Teams manifest document hashes are invalid");
  const projectionRoots = new Set();
  for (const projection of manifest.projectionHashes) {
    if (!isRecord(projection) || typeof projection.rootSessionId !== "string" || projection.rootSessionId.length === 0 || !/^[a-f0-9]{64}$/u.test(projection.hash ?? "") || projectionRoots.has(projection.rootSessionId)) throw new TypeError("Agent Teams manifest projection hash is invalid");
    projectionRoots.add(projection.rootSessionId);
  }
  return manifest;
}
function validateClosedCatalog(catalog) {
  if (!isRecord(catalog) || catalog.version !== HOT_COLD_STORE_VERSION || !Array.isArray(catalog.entries)) throw new TypeError("Agent Teams closed catalog is invalid");
  for (const entry of catalog.entries) {
    validateTeamLedgerEntry(entry, entry.ordinal);
    if (entry.storage !== "closed") throw new TypeError("Agent Teams closed catalog contains a hot entry");
  }
  return catalog;
}
function validateHotDocument(hot, manifest) {
  if (!isRecord(hot) || hot.version !== HOT_COLD_STORE_VERSION || hot.storeVersion !== STORE_VERSION
    || hot.generation !== manifest.generation || !isRecord(hot.header) || !Array.isArray(hot.teams)) throw new TypeError("Agent Teams hot document is invalid");
  validateStoreHeader(hot.header);
  for (const team of hot.teams) {
    if (team.state === "closed") throw new TypeError("closed Agent Teams records cannot remain in the hot document");
    validateTeam(team);
  }
  return hot;
}
function hotColdPublication(pointer, manifest, hotDocument, entries) {
  // Physical generations are immutable after publication. Sharing their index and hot
  // objects between same-process readers avoids another O(all teams) clone per commit.
  return { mode: "hot-cold", pointer, manifest, hotDocument, entries };
}

function projectionArtifactDescriptorKey(artifact) {
  if (!isRecord(artifact)) return undefined;
  return JSON.stringify([artifact.path, artifact.hash, artifact.bytes, artifact.generation ?? null]);
}
function projectionTeamIdentityFromLedger(entry) {
  const cached = LEDGER_PROJECTION_IDENTITIES.get(entry);
  if (cached !== undefined) return cached;
  const members = entry.index.members.map((member) => Object.freeze([
    member.id,
    member.sessionId,
    member.kind,
    member.state,
    member.updatedAt ?? null,
  ]));
  const identity = Object.freeze({
    id: entry.id,
    hash: entry.hash,
    bytes: entry.bytes,
    rootSessionId: entry.rootLeadSessionId,
    projectKey: entry.projectKey ?? null,
    revision: entry.revision,
    state: entry.state,
    pauseEpoch: entry.pauseEpoch,
    authorizationEpoch: entry.index.autopilot?.authorizationEpoch ?? null,
    ownershipHash: sha256Bytes(Buffer.from(JSON.stringify(entry.index.ownershipHistory), "utf8")),
    members: Object.freeze(members),
  });
  LEDGER_PROJECTION_IDENTITIES.set(entry, identity);
  return identity;
}
function projectionTeamIdentityFromDocument(team) {
  const artifact = jsonArtifact(team);
  const members = (team.members ?? []).map((member) => Object.freeze([
    member.id,
    member.sessionId,
    member.kind,
    member.state,
    member.updatedAt ?? null,
  ]));
  return Object.freeze({
    id: team.id,
    hash: artifact.hash,
    bytes: artifact.size,
    rootSessionId: team.rootLeadSessionId,
    projectKey: team.projectKey ?? null,
    revision: team.revision ?? 1,
    state: team.state,
    pauseEpoch: team.pauseEpoch ?? 0,
    authorizationEpoch: team.autopilot?.authorizationEpoch ?? null,
    ownershipHash: sha256Bytes(Buffer.from(JSON.stringify(team.ownershipHistory ?? []), "utf8")),
    members: Object.freeze(members),
  });
}
function createStoreProjectionMetadata({ storeId, serial, mode, branchKey, previousBranchKey, canReusePrevious, header, entries, rootProjectionHashes = [] }) {
  const headerArtifact = jsonArtifact(header);
  const frozenEntries = Object.freeze(entries);
  const frozenRootHashes = Object.freeze(rootProjectionHashes.map((entry) => Object.freeze([entry.rootSessionId, entry.hash])));
  const tuple = (entry) => [entry.id, entry.hash, entry.bytes, entry.rootSessionId, entry.projectKey, entry.revision, entry.state, entry.pauseEpoch, entry.authorizationEpoch, entry.ownershipHash];
  const digest = (label, values) => sha256Bytes(Buffer.from(JSON.stringify([label, values.map(tuple)]), "utf8"));
  const group = (keyFor) => {
    const grouped = new Map();
    for (const entry of frozenEntries) {
      const keys = keyFor(entry);
      for (const key of Array.isArray(keys) ? new Set(keys) : [keys]) {
        const values = grouped.get(key) ?? [];
        values.push(entry);
        grouped.set(key, values);
      }
    }
    return grouped;
  };
  const roots = group((entry) => entry.rootSessionId);
  const projects = group((entry) => entry.projectKey);
  const sessions = group((entry) => entry.members.map((member) => member[1]));
  // A single exact team artifact hash is already a collision-resistant semantic
  // identity. Hash only multi-team scopes instead of doing hundreds of redundant
  // digests on every Store publication.
  const semanticMap = (label, grouped) => new Map([...grouped].map(([key, values]) => [key, values.length === 1 ? values[0].hash : digest(label, values)]));
  return Object.freeze({
    storeId,
    serial,
    mode,
    branchKey,
    previousBranchKey,
    canReusePrevious,
    headerHash: headerArtifact.hash,
    settingsHash: sha256Bytes(Buffer.from(JSON.stringify(header.settings), "utf8")),
    entries: frozenEntries,
    entryMap: new Map(frozenEntries.map((entry) => [entry.id, entry])),
    rootSemanticHashMap: semanticMap("root", roots),
    projectSemanticHashMap: semanticMap("project", projects),
    // This map is ACL-scoped because groups are formed only from exact member links.
    sessionSemanticHashMap: semanticMap("related", sessions),
    rootProjectionHashes: frozenRootHashes,
    rootProjectionHashMap: new Map(frozenRootHashes),
  });
}
function markStoreProjectionDocument(document, metadata) {
  if (document !== null && typeof document === "object" && metadata !== undefined) STORE_PROJECTION_METADATA.set(document, metadata);
  return document;
}

function publishStoreDocument(filePath, document, stamp, publication, { adoptedHotColdOrigin } = {}) {
  for (const instance of STORE_INSTANCES.get(filePath) ?? []) {
    if (publication?.mode === "hot-cold") {
      if (instance === adoptedHotColdOrigin) instance._normalizeCommittedHotColdPublication(publication, stamp);
      else instance._adoptHotColdPublication(publication, stamp);
    } else {
      // Legacy mutations clone before editing, so instances can share this committed,
      // immutable-by-convention document without multiplying full-store clones.
      instance._adoptLegacyPublication(document, stamp, { previousBranchKey: publication?.previousBranchKey });
    }
    if (instance.listeners.size === 0) continue;
    for (const listener of instance.listeners) {
      // Each observer gets an independent lazy view. A UI or collaboration consumer
      // that needs one closed team cannot hydrate (or retain) every other observer's view.
      try { listener(instance._listenerDocument()); } catch { /* observers never veto committed state */ }
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
    this.storageMode = "legacy";
    this.layout = hotColdLayout(filePath);
    this.hotColdPreference = hotColdPreference(defaults);
    this.hotColdFaultInjector = typeof defaults.hotColdFaultInjector === "function" ? defaults.hotColdFaultInjector : undefined;
    this.pointer = undefined;
    this.manifest = undefined;
    this.hotDocument = undefined;
    this.entries = [];
    this.teamEntries = new Map();
    this.lastStorageMutation = undefined;
    this.closedShardReadCount = 0;
    this.promotionBlocked = undefined;
    this.projectionStoreId = randomUUID();
    this.projectionSerial = 0;
    this.projectionBranchKey = undefined;
    this.projectionMetadata = undefined;
    const retentionNumber = (value, fallback, field) => {
      const resolved = value ?? fallback;
      if (!Number.isSafeInteger(resolved) || resolved < 1) throw new TypeError(`${field} must be a positive safe integer`);
      return resolved;
    };
    const softBytes = retentionNumber(defaults.hotColdRetentionSoftBytes, HOT_COLD_RETENTION_SOFT_BYTES, "hotColdRetentionSoftBytes");
    const hardBytes = retentionNumber(defaults.hotColdRetentionHardBytes, HOT_COLD_RETENTION_HARD_BYTES, "hotColdRetentionHardBytes");
    const softFiles = retentionNumber(defaults.hotColdRetentionSoftFiles, HOT_COLD_RETENTION_SOFT_FILES, "hotColdRetentionSoftFiles");
    const hardFiles = retentionNumber(defaults.hotColdRetentionHardFiles, HOT_COLD_RETENTION_HARD_FILES, "hotColdRetentionHardFiles");
    if (hardBytes < softBytes || hardFiles < softFiles) throw new TypeError("Agent Teams retention hard watermarks cannot be below their soft watermarks");
    this.retention = {
      policy: { softBytes, hardBytes, softFiles, hardFiles },
      debtBytes: 0,
      debtFiles: 0,
      consecutiveFailures: 0,
      blocked: false,
      lastSweep: undefined,
      lastError: undefined,
    };
    this.retentionKeep = undefined;
    this.retentionKeepGeneration = 0;
    this.retentionAuthority = undefined;
    this.retentionManifestChain = undefined;
    this.retentionRevision = 0;
    this.retentionLifecycleEpoch = 0;
    this.retentionGarbage = new Map();
    this.retentionAuthorityReloadRequired = false;
    this.closed = false;
    this._adoptLegacyPublication(this.document);
    const instances = STORE_INSTANCES.get(filePath) ?? new Set();
    instances.add(this);
    STORE_INSTANCES.set(filePath, instances);
  }
  async init() {
    const endForeground = beginStoreRetentionForeground(this.filePath);
    try {
      return await queueStoreOperation(this.filePath, () => queueStoreMutation(this.filePath, async () => {
    const previousStamp = this.fileStamp;
    let migrated = false;
    let legacySourceBytes;
    const pointerExists = existsSync(this.layout.pointerPath);
    const promotionSentinel = await this.#readPromotionSentinel();
    const legacyPromotionMarker = await this.#readLegacyPromotionMarker();
    if (pointerExists) {
      const loaded = await this.#loadHotColdState();
      this._adoptHotColdPublication(loaded.publication, loaded.stamp);
      await this.#reconcilePromotionSentinel(promotionSentinel, legacyPromotionMarker);
      // Startup reconciliation sees full hot records and closed index stubs; closed
      // detail is fetched only when a repair or caller actually demands it.
      this.document = loaded.document;
    } else {
      if (promotionSentinel?.phase === "committed" || legacyPromotionMarker !== undefined) throw new TypeError("Agent Teams hot/cold manifest pointer disappeared; refusing stale v8 fallback");
      try {
        legacySourceBytes = await readFile(this.filePath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        if (promotionSentinel !== undefined) throw new TypeError("Agent Teams prepared promotion lost its immutable v8 source");
        // Disabled-by-default must not create storage on mere plugin activation.
        return this.view();
      }
      const persisted = JSON.parse(legacySourceBytes.toString("utf8"));
      migrated = LEGACY_STORE_VERSIONS.has(persisted?.version)
        || persisted?.teams?.some((team) => !Array.isArray(team?.taskCommandReceipts) || team?.tasks?.some((task) => task?.revision === undefined));
      this.document = validateStoreDocument(persisted);
      this.fileStamp = await this.#currentFileStamp();
      this._adoptLegacyPublication(this.document, this.fileStamp);
      if (promotionSentinel?.phase === "prepared") {
        if (migrated || persisted?.version !== STORE_VERSION) throw new TypeError("Agent Teams prepared promotion source is not a canonical v8 document");
        await this.#verifyOuterV8Source(promotionSentinel.sourceV8, legacySourceBytes, { requireCopy: false });
        const migrationSource = this.document;
        await this.#promoteHotCold(migrationSource, legacySourceBytes, { prepared: true });
        this.document = migrationSource;
      } else if (!migrated && this.#shouldPromote(this.document, { allowAutomatic: true })) {
        // Generation one is a byte-for-byte logical shadow of the authoritative v8
        // source. Host-restart reconciliation, when needed, becomes generation two.
        const migrationSource = this.document;
        await this.#promoteHotCold(migrationSource, legacySourceBytes);
        this.document = migrationSource;
      }
    }
    let changed = false;
    const changedTeamIds = new Set();
    for (let teamIndex = 0; teamIndex < this.document.teams.length; teamIndex += 1) {
      const persistedTeam = this.document.teams[teamIndex];
      const entry = this.storageMode === "hot-cold" ? this.teamEntries.get(persistedTeam.id) : undefined;
      if (persistedTeam.state === "closed") {
        const hasUnfinished = entry === undefined
          ? persistedTeam.tasks?.some((task) => !taskIsTerminal(task))
          : entry.index.tasks.some((task) => !taskIsTerminal(task));
        if (hasUnfinished) {
          const team = entry === undefined ? persistedTeam : this.#teamForEntrySync(entry);
          team.updatedAt = now();
          terminalizeTeamTasks(team, team.updatedAt, "legacy closed team contained unfinished work");
          team.closure.cancelledTaskIds = team.tasks.filter((task) => task.state === "cancelled").map((task) => task.id);
          team.revision = (team.revision ?? 1) + 1;
          this.document.teams[teamIndex] = team;
          changedTeamIds.add(team.id);
          changed = true;
        }
        continue;
      }
      const team = entry === undefined ? persistedTeam : this.#teamForEntrySync(entry);
      let teamChanged = false;
      const restartInterruptedWorkerSessions = new Set();
      for (const member of team.members) {
        if (!TRANSIENT_MEMBER_STATES.has(member.state)) continue;
        const persistedState = member.state;
        if (member.kind === "worker" && persistedState !== "provisioning") restartInterruptedWorkerSessions.add(member.sessionId);
        if (persistedState === "shutting_down" && member.retirement?.status === "pending") {
          member.state = "failed";
          member.shutdownUnconfirmed = true;
          member.stopUnconfirmed = true;
          member.error = "host restarted before exact graceful-retirement lifecycle completion";
          member.retirement.errorCode = "AGENT_TEAMS_HOST_RESTARTED";
          member.retirement.updatedAt = now();
        } else if (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true) {
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
        const recoveryOwnsPlaceholder = team.memberRecoveries?.some((receipt) => receipt.action === "replace" && receipt.status === "outcome_unknown" && receipt.replacementMemberId === placeholder.id && ["start_dispatched", "child_started", "published"].includes(receipt.phase)) === true;
        if (recoveryOwnsPlaceholder) continue;
        task.assigneeSessionId = undefined;
        task.updatedAt = now();
        bumpTaskRevision(task);
        boundedPush(task.interruptionHistory, { kind: "host_restart_during_provisioning", at: task.updatedAt, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0 }, MAX_TASK_INTERRUPTION_HISTORY);
        teamChanged = true;
      }
      for (const entry of team.provisioningQueue ?? []) {
        if (entry.status === "provisioning") {
          const memberIndex = team.members.findIndex((member) => member.id === entry.memberId && member.state === "failed" && member.sessionId === `provisioning:${entry.memberId}`);
          if (memberIndex >= 0) team.members.splice(memberIndex, 1);
          entry.status = "queued";
          entry.admissionGeneration = undefined;
          entry.errorCode = "AGENT_TEAMS_HOST_RESTARTED";
          entry.errorStage = "awaiting_admission";
          entry.updatedAt = now();
          teamChanged = true;
        } else if (entry.status === "dispatching") {
          const member = team.members.find((candidate) => candidate.id === entry.memberId);
          if (member !== undefined) {
            member.sessionId = entry.childId;
            member.state = "failed";
            member.shutdownUnconfirmed = true;
            member.stopUnconfirmed = true;
            member.error = "host restarted after exact admission but before provisioning publication; dispatch outcome is unknown";
            member.updatedAt = now();
          }
          for (const taskId of entry.taskIds) {
            const task = team.tasks.find((candidate) => candidate.id === taskId);
            if (task?.state !== "pending") continue;
            task.assigneeSessionId = entry.childId;
            task.leaseEpoch = team.pauseEpoch ?? 0;
            task.updatedAt = now();
            bumpTaskRevision(task);
          }
          entry.status = "outcome_unknown";
          entry.errorCode = "AGENT_TEAMS_HOST_RESTARTED";
          entry.errorStage = "dispatching";
          entry.updatedAt = now();
          teamChanged = true;
        }
      }
      for (const message of team.messages) {
        if (message.status !== "pending") continue;
        // `pending` means transport acceptance was never durably recorded. The
        // crash window may still have reached the queue, so mark it uncertain
        // rather than replaying and risking duplicate injection. A persisted
        // `queued` message is intentionally left queued/unconfirmed on restart.
        message.status = "failed";
        message.deliveryError = "host restarted before transport acceptance was durably recorded; recipient injection is unknown, do not retry manually until reconciled";
        teamChanged = true;
      }
      teamChanged = reconcileSafePlanAuthorization(team) || teamChanged;
      if (teamChanged) {
        team.updatedAt = now();
        // Startup repair is one semantic team mutation even when it touches several
        // members, tasks, queue entries, messages, or authorization fields.
        team.revision = (team.revision ?? 1) + 1;
        this.document.teams[teamIndex] = team;
        changedTeamIds.add(team.id);
      }
      changed ||= teamChanged;
    }
    if (this.storageMode === "hot-cold") {
      if (changed) {
        const teamsById = new Map(this.document.teams.map((team) => [team.id, team]));
        const ordered = this.entries.map((entry) => changedTeamIds.has(entry.id)
          ? { entry, team: clone(teamsById.get(entry.id)) }
          : entry.storage === "closed" ? { entry } : { entry, team: clone(teamsById.get(entry.id)) });
        await this.#commitHotColdPlan(storeHeader(this.document), ordered);
      } else this._adoptHotColdPublication(hotColdPublication(this.pointer, this.manifest, this.hotDocument, this.entries), this.fileStamp);
    } else {
      if (migrated) {
        await this.#writeLegacy(this.document);
        legacySourceBytes = await readFile(this.filePath);
      }
      if (this.#shouldPromote(this.document, { allowAutomatic: true })) {
        legacySourceBytes ??= await readFile(this.filePath);
        await this.#promoteHotCold(this.document, legacySourceBytes);
      } else if (changed && !migrated) await this.#writeLegacy(this.document);
    }
    if (this.storageMode === "hot-cold") await this.#maybeSweepRetention({ refresh: true });
    const publication = this.storageMode === "hot-cold" ? hotColdPublication(this.pointer, this.manifest, this.hotDocument, this.entries) : undefined;
    // A repeated init of an already-loaded, unchanged authority is a read-only no-op.
    // Fresh instances and externally advanced authority stamps still publish once.
    if (changed || previousStamp !== this.fileStamp) publishStoreDocument(this.filePath, this.document, this.fileStamp, publication);
    return this._listenerDocument();
      }));
    } finally {
      endForeground();
    }
  }
  snapshot() {
    // Callers may intentionally edit a detached snapshot before submitting it to
    // another API. Do not tag that mutable copy as a trusted Store publication;
    // projection caching must bind its freshly computed content identity instead.
    return this.storageMode === "hot-cold" ? this.#materializeHotColdSync() : clone(this.document);
  }
  view() {
    const document = this.storageMode === "hot-cold" ? this.#hotColdViewDocument() : immutableClone(this.document);
    return markStoreProjectionDocument(document, this.projectionMetadata);
  }
  _listenerDocument() {
    return this.view();
  }
  storageDiagnostics() {
    return {
      mode: this.storageMode,
      generation: this.manifest?.generation ?? 0,
      hotTeamCount: this.storageMode === "hot-cold" ? this.entries.filter((entry) => entry.storage === "hot").length : this.document.teams.filter((team) => team.state !== "closed").length,
      closedShardCount: this.storageMode === "hot-cold" ? this.entries.filter((entry) => entry.storage === "closed").length : 0,
      retainedClosedDetails: this.storageMode === "hot-cold" ? 0 : this.document.teams.filter((team) => team.state === "closed" && Array.isArray(team.tasks)).length,
      closedShardReadCount: this.closedShardReadCount,
      legacySource: this.manifest?.sourceV8?.path,
      promotionSentinel: this.storageMode === "hot-cold" ? this.layout.promotionMarkerPath : undefined,
      lastMutation: this.lastStorageMutation === undefined ? undefined : clone(this.lastStorageMutation),
      retention: { ...clone(this.retention), maintenance: storeRetentionMaintenanceDiagnostics(this.filePath) },
      promotionBlocked: this.promotionBlocked,
    };
  }
  async _settleRetentionMaintenance() {
    await settleStoreRetentionMaintenance(this.filePath);
  }
  async exportV8(destination) {
    const requestedTarget = resolve(nonEmptyString(destination, "destination", 32_768));
    const target = await canonicalV8ExportTarget(this.filePath, this.layout.root, requestedTarget);
    const document = await this.read();
    validateStoreDocument(document);
    const artifact = jsonArtifact(document);
    await replaceAtomicArtifact(target, artifact.bytes);
    return { destination: target, hash: artifact.hash, version: STORE_VERSION };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.retentionLifecycleEpoch += 1;
    this.listeners.clear();
    const instances = STORE_INSTANCES.get(this.filePath);
    instances?.delete(this);
    if (instances?.size === 0) STORE_INSTANCES.delete(this.filePath);
    cancelStoreRetentionMaintenance(this.filePath);
  }
  async closeAndSettle() {
    this.close();
    await this._settleRetentionMaintenance();
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
    const endForeground = beginStoreRetentionForeground(this.filePath);
    try {
      await this.chain;
      return await queueStoreMutation(this.filePath, async () => {
        // A read is also an externally visible state boundary. Refresh here so a
        // Host-managed settings update is observed before callers derive a
        // one-time authorization intent from the current policy.
        await this.#refreshFromDiskIfChanged();
        if (this.storageMode !== "hot-cold") {
          markStoreProjectionDocument(this.document, this.projectionMetadata);
          return clone(await reader(this.document));
        }
        const { document, tracker } = this.#hotColdLazyDocument();
        return cloneLazyValue(await reader(document), tracker);
      });
    } finally {
      endForeground();
    }
  }
  mutate(mutator) {
    const endForeground = beginStoreRetentionForeground(this.filePath);
    const operation = this.chain.then(() => queueStoreMutation(this.filePath, async () => {
      // Same-process instances synchronize at publication. A cheap metadata check keeps
      // explicit external recovery/test edits visible without reparsing on every event.
      await this.#refreshFromDiskIfChanged();
      if (this.storageMode === "hot-cold") return this.#mutateHotCold(mutator);
      const previousProjectionBranchKey = this.projectionBranchKey;
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
      await this.#writeLegacy(draft);
      this.document = draft;
      if (this.#shouldPromote(draft)) await this.#promoteHotCold(draft, await readFile(this.filePath));
      const publication = this.storageMode === "hot-cold"
        ? hotColdPublication(this.pointer, this.manifest, this.hotDocument, this.entries)
        : { mode: "legacy", previousBranchKey: previousProjectionBranchKey };
      publishStoreDocument(this.filePath, this.document, this.fileStamp, publication);
      return clone(value);
    }));
    this.chain = operation.then(() => undefined, () => undefined);
    return operation.then(
      (value) => { endForeground(); return value; },
      (error) => { endForeground(); throw error; },
    );
  }
  runOperation(operation) {
    return queueStoreOperation(this.filePath, operation);
  }
  notify() {
    const publication = this.storageMode === "hot-cold" ? hotColdPublication(this.pointer, this.manifest, this.hotDocument, this.entries) : undefined;
    publishStoreDocument(this.filePath, this.document, this.fileStamp, publication);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  _setProjectionPublication({ mode, branchKey, previousBranchKey, header, entries, rootProjectionHashes }) {
    const priorMetadata = this.projectionMetadata;
    const changed = priorMetadata === undefined || priorMetadata.mode !== mode || this.projectionBranchKey !== branchKey;
    if (!changed) return priorMetadata;
    const canReusePrevious = priorMetadata !== undefined && (
      mode === "legacy" && priorMetadata.mode === "legacy" && previousBranchKey === priorMetadata.branchKey
      || mode === "hot-cold" && priorMetadata.mode === "hot-cold" && previousBranchKey === priorMetadata.branchKey
    );
    this.projectionSerial += 1;
    this.projectionBranchKey = branchKey;
    this.projectionMetadata = createStoreProjectionMetadata({
      storeId: this.projectionStoreId,
      serial: this.projectionSerial,
      mode,
      branchKey,
      previousBranchKey,
      canReusePrevious,
      header,
      entries,
      rootProjectionHashes,
    });
    return this.projectionMetadata;
  }
  #retentionAuthorityFor(pointer, pointerStamp, pointerBytes) {
    if (pointer === undefined || pointerStamp === undefined) return undefined;
    const canonicalPointerBytes = pointerBytes ?? jsonArtifact(pointer).bytes;
    return Object.freeze({
      pointerHash: sha256Bytes(canonicalPointerBytes),
      pointerBytes: canonicalPointerBytes.length,
      pointerStamp,
      generation: pointer.generation,
      manifest: JSON.stringify(pointer.manifest),
      retentionFloorGeneration: pointer.retentionFloorGeneration ?? null,
    });
  }
  #retentionAuthorityEquals(left, right) {
    return left !== undefined && right !== undefined
      && left.pointerHash === right.pointerHash
      && left.pointerBytes === right.pointerBytes
      && left.pointerStamp === right.pointerStamp
      && left.generation === right.generation
      && left.manifest === right.manifest
      && left.retentionFloorGeneration === right.retentionFloorGeneration;
  }
  #retentionAuthorityMatches(pointer, stamp) {
    return this.retentionKeep !== undefined
      && this.#retentionAuthorityEquals(this.retentionAuthority, this.#retentionAuthorityFor(pointer, stamp));
  }
  #retentionReachabilityIsCurrent() {
    return this.storageMode === "hot-cold" && this.#retentionAuthorityMatches(this.pointer, this.fileStamp);
  }
  #invalidateRetentionReachability({ clearDebt = false, requireAuthorityReload = false } = {}) {
    this.retentionKeep = undefined;
    this.retentionKeepGeneration = 0;
    this.retentionAuthority = undefined;
    this.retentionManifestChain = undefined;
    if (requireAuthorityReload) this.retentionAuthorityReloadRequired = true;
    if (clearDebt) {
      this.retentionGarbage = new Map();
      this.retention.debtBytes = 0;
      this.retention.debtFiles = 0;
      this.retention.blocked = false;
    }
    this.retentionRevision += 1;
  }
  #normalizeHotColdRetention(pointer, stamp, { preserveRetention = false } = {}) {
    if (!preserveRetention && !this.#retentionAuthorityMatches(pointer, stamp)) {
      // A peer, rollback, or exact-origin post-commit failure may make a formerly
      // garbage content-addressed artifact live again. Clear estimates until the
      // next real write performs an exact branch-bound refresh.
      this.#invalidateRetentionReachability({ clearDebt: true });
    }
  }
  _adoptLegacyPublication(document, stamp, { previousBranchKey } = {}) {
    const artifact = jsonArtifact(document);
    this.storageMode = "legacy";
    this.document = document;
    this.pointer = undefined;
    this.manifest = undefined;
    this.hotDocument = undefined;
    this.entries = [];
    this.teamEntries = new Map();
    this.retentionAuthorityReloadRequired = false;
    this.#invalidateRetentionReachability({ clearDebt: true });
    if (stamp !== undefined) this.fileStamp = stamp;
    const entries = document.teams.map(projectionTeamIdentityFromDocument);
    this._setProjectionPublication({
      mode: "legacy",
      branchKey: JSON.stringify(["agent-teams-legacy-v8", artifact.hash, artifact.size]),
      previousBranchKey,
      header: storeHeader(document),
      entries,
      rootProjectionHashes: [],
    });
    markStoreProjectionDocument(document, this.projectionMetadata);
  }
  _normalizeCommittedHotColdPublication(publication, stamp) {
    const pointer = validateHotColdPointer(publication.pointer);
    const manifest = validateHotColdManifest(publication.manifest);
    if (pointer.generation !== manifest.generation
      || this.storageMode !== "hot-cold"
      || publication.pointer !== this.pointer
      || publication.manifest !== this.manifest
      || publication.hotDocument !== this.hotDocument
      || publication.entries !== this.entries
      || this.fileStamp !== stamp
      || projectionArtifactDescriptorKey(this.pointer?.manifest) !== projectionArtifactDescriptorKey(pointer.manifest)) throw new TypeError("Agent Teams exact-origin publication is not the locally adopted commit");
    this.retentionAuthorityReloadRequired = false;
    this.#normalizeHotColdRetention(pointer, stamp);
  }
  _adoptHotColdPublication(publication, stamp, { preserveRetention = false } = {}) {
    const pointer = validateHotColdPointer(publication.pointer);
    const manifest = validateHotColdManifest(publication.manifest);
    const hotDocument = validateHotDocument(publication.hotDocument, manifest);
    const entries = publication.entries;
    if (!Array.isArray(entries) || entries.length !== manifest.teamCount) throw new TypeError("Agent Teams hot/cold publication index is invalid");
    entries.forEach(validateTeamLedgerEntry);
    if (pointer.generation !== manifest.generation) throw new TypeError("Agent Teams hot/cold publication generations disagree");
    this.#normalizeHotColdRetention(pointer, stamp, { preserveRetention });
    const hotById = new Map(hotDocument.teams.map((team) => [team.id, team]));
    const teams = entries.map((entry) => {
      if (entry.storage === "closed") return ledgerTeamStub(entry);
      const team = hotById.get(entry.id);
      if (team === undefined) throw new TypeError(`Agent Teams hot document is missing ${entry.id}`);
      return team;
    });
    if (teams.filter((team) => team.state !== "closed").length !== hotDocument.teams.length) throw new TypeError("Agent Teams hot document contains an unindexed team");
    this.storageMode = "hot-cold";
    this.pointer = pointer;
    this.manifest = manifest;
    this.hotDocument = hotDocument;
    this.entries = entries;
    this.teamEntries = new Map(entries.map((entry) => [entry.id, entry]));
    this.document = assembleStoreDocument(hotDocument.header, teams);
    if (stamp !== undefined) this.fileStamp = stamp;
    this.retentionAuthorityReloadRequired = false;
    this._setProjectionPublication({
      mode: "hot-cold",
      branchKey: projectionArtifactDescriptorKey(pointer.manifest),
      previousBranchKey: projectionArtifactDescriptorKey(manifest.previous),
      header: hotDocument.header,
      entries: entries.map(projectionTeamIdentityFromLedger),
      rootProjectionHashes: manifest.projectionHashes,
    });
    markStoreProjectionDocument(this.document, this.projectionMetadata);
  }
  #hotColdViewDocument() {
    // Capture one immutable generation. A later publication swaps store fields but
    // cannot mutate this view or make its lazy shard descriptors point elsewhere.
    const hotDocument = this.hotDocument;
    const entries = this.entries;
    const hotById = new Map(hotDocument.teams.map((team) => [team.id, team]));
    const teams = entries.map((entry) => entry.storage === "closed"
      ? createLazyTeamView(entry, (candidate) => this.#teamForEntrySync(candidate, hotDocument))
      : immutableClone(hotById.get(entry.id)));
    return markStoreProjectionDocument(assembleImmutableStoreView(hotDocument.header, teams), this.projectionMetadata);
  }
  async rollbackHotColdManifest() {
    const endForeground = beginStoreRetentionForeground(this.filePath);
    const operation = this.chain.then(() => queueStoreMutation(this.filePath, async () => {
      await this.#refreshFromDiskIfChanged();
      if (this.storageMode !== "hot-cold" || this.manifest?.previous === undefined) throw new HarnessError("no previous Agent Teams manifest is available", "AGENT_TEAMS_MANIFEST_ROLLBACK_UNAVAILABLE");
      const previous = validateHotColdManifest(await parseVerifiedArtifact(this.layout.root, this.manifest.previous));
      const retentionFloorGeneration = this.pointer.retentionFloorGeneration
        ?? Math.max(1, this.pointer.generation - (HOT_COLD_RETENTION_COMPLETE_GENERATIONS - 1));
      const requiredPredecessors = Math.min(HOT_COLD_RETENTION_COMPLETE_GENERATIONS - 1, previous.generation - 1);
      if (previous.generation - retentionFloorGeneration < requiredPredecessors) throw new HarnessError("the retained Agent Teams rollback history cannot preserve the minimum complete predecessor depth", "AGENT_TEAMS_MANIFEST_ROLLBACK_UNAVAILABLE");
      const pointer = {
        version: HOT_COLD_POINTER_VERSION,
        generation: previous.generation,
        manifest: { ...clone(this.manifest.previous), generation: previous.generation },
        retentionFloorGeneration,
      };
      const loaded = await this.#loadValidatedRollbackState(pointer);
      await this.#fault("before-manifest-rollback");
      await replaceAtomicArtifact(this.layout.pointerPath, jsonArtifact(pointer).bytes);
      loaded.stamp = await this.#currentFileStamp(this.layout.pointerPath);
      this._adoptHotColdPublication(loaded.publication, loaded.stamp);
      await this.#maybeSweepRetention({ refresh: true });
      publishStoreDocument(this.filePath, this.document, this.fileStamp, loaded.publication);
      await this.#fault("after-manifest-rollback");
      return this.storageDiagnostics();
    }));
    this.chain = operation.then(() => undefined, () => undefined);
    return operation.then(
      (value) => { endForeground(); return value; },
      (error) => { endForeground(); throw error; },
    );
  }
  async #currentFileStamp(filePath = this.storageMode === "hot-cold" ? this.layout.pointerPath : this.filePath) {
    const info = await stat(filePath);
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  }
  #shouldPromote(document, { allowAutomatic = false } = {}) {
    if (this.hotColdPreference === "disabled" || existsSync(this.layout.pointerPath)) return false;
    if (this.hotColdPreference === "force") return document.teams.length > 0;
    // Automatic migration is a startup boundary. Changing the authority path in the
    // middle of a live legacy process would strand compatibility readers on the now-
    // immutable v8 source. A later fresh instance promotes the completed document.
    return allowAutomatic && document.teams.filter((team) => team.state === "closed").length >= HOT_COLD_AUTO_CLOSED_TEAM_THRESHOLD;
  }
  async #fault(stage) {
    if (this.hotColdFaultInjector !== undefined) await this.hotColdFaultInjector(stage);
  }
  async #readPromotionSentinel() {
    let bytes;
    try { bytes = await readFile(this.layout.promotionMarkerPath); }
    catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
    let sentinel;
    try { sentinel = validatePromotionSentinel(JSON.parse(bytes.toString("utf8"))); }
    catch (error) { throw new TypeError(`Agent Teams promotion sentinel is corrupt: ${error?.message ?? String(error)}`); }
    if (!bytes.equals(promotionSentinelArtifact(sentinel.sourceV8, sentinel.phase).bytes)) throw new TypeError("Agent Teams promotion sentinel is noncanonical");
    return sentinel;
  }
  async #readLegacyPromotionMarker() {
    let bytes;
    try { bytes = await readFile(this.layout.legacyPromotionMarkerPath); }
    catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
    let marker;
    try {
      marker = JSON.parse(bytes.toString("utf8"));
      if (!isRecord(marker)) throw new TypeError("marker must be an object");
      assertAllowedKeys(marker, new Set(["version", "sourceV8Hash"]), "Agent Teams legacy promotion marker");
      if (marker.version !== HOT_COLD_STORE_VERSION || !/^[a-f0-9]{64}$/u.test(marker.sourceV8Hash ?? "")) throw new TypeError("marker fields are invalid");
    } catch (error) { throw new TypeError(`Agent Teams legacy promotion marker is corrupt: ${error?.message ?? String(error)}`); }
    if (!bytes.equals(jsonArtifact(marker).bytes)) throw new TypeError("Agent Teams legacy promotion marker is noncanonical");
    return marker;
  }
  async #verifyOuterV8Source(sourceV8, knownBytes, { requireCopy = true, knownCopyBytes } = {}) {
    validateCanonicalArtifactDescriptor(sourceV8, "legacy");
    const sourceBytes = knownBytes ?? await readFile(this.filePath);
    if (sourceBytes.length !== sourceV8.bytes || sha256Bytes(sourceBytes) !== sourceV8.hash) throw new TypeError("Agent Teams immutable v8 source disagrees with the promotion sentinel");
    const source = JSON.parse(sourceBytes.toString("utf8"));
    if (source?.version !== STORE_VERSION) throw new TypeError("Agent Teams immutable migration source is not v8");
    validateStoreDocument(source);
    try {
      const copied = knownCopyBytes ?? await verifiedArtifactBytes(this.layout.root, sourceV8);
      if (!copied.equals(sourceBytes)) throw new TypeError("Agent Teams immutable v8 source copy is not byte-identical");
    } catch (error) {
      if (!(error?.code === "ENOENT" && !requireCopy)) throw error;
    }
    return sourceBytes;
  }
  async #writePromotionSentinel(sourceV8, phase) {
    const desired = promotionSentinelArtifact(sourceV8, phase);
    const current = await this.#readPromotionSentinel();
    if (current !== undefined) {
      if (JSON.stringify(current.sourceV8) !== JSON.stringify(sourceV8)) throw new TypeError("Agent Teams promotion sentinel disagrees with the immutable v8 source");
      if (current.phase === phase || current.phase === "committed" && phase === "prepared") return current;
    }
    await replaceAtomicArtifact(this.layout.promotionMarkerPath, desired.bytes);
    await this.#fault(phase === "prepared" ? "after-promotion-prepared" : "after-promotion-committed");
    if (phase === "committed") await this.#fault("after-promotion-marker");
    return validatePromotionSentinel(JSON.parse(desired.bytes.toString("utf8")));
  }
  async #reconcilePromotionSentinel(sentinel, legacyMarker) {
    const sourceV8 = this.manifest.sourceV8;
    await this.#verifyOuterV8Source(sourceV8);
    if (legacyMarker !== undefined) validateLegacyPromotionMarker(legacyMarker, sourceV8);
    if (sentinel !== undefined && JSON.stringify(sentinel.sourceV8) !== JSON.stringify(sourceV8)) throw new TypeError("Agent Teams promotion sentinel disagrees with the committed manifest");
    if (sentinel?.phase !== "committed") await this.#writePromotionSentinel(sourceV8, "committed");
  }
  #assertTeamMatchesEntry(team, entry) {
    validateTeam(team);
    const rebuilt = buildTeamLedgerEntry(team, entry.ordinal, entry.storage, entry.storage === "closed" ? entry.shard : undefined);
    if (JSON.stringify(rebuilt) !== JSON.stringify(entry)) throw new TypeError(`Agent Teams manifest index disagrees with team ${entry.id}`);
    return team;
  }
  #teamForEntrySync(entry, hotDocument = this.hotDocument) {
    if (entry.storage === "hot") {
      const team = hotDocument.teams.find((candidate) => candidate.id === entry.id);
      if (team === undefined) throw new TypeError(`Agent Teams hot document is missing ${entry.id}`);
      return this.#assertTeamMatchesEntry(clone(team), entry);
    }
    this.closedShardReadCount += 1;
    return this.#assertTeamMatchesEntry(parseVerifiedArtifactSync(this.layout.root, entry.shard), entry);
  }
  async #loadHotColdState(candidatePointer) {
    const pointer = candidatePointer === undefined
      ? validateHotColdPointer(JSON.parse(await readFile(this.layout.pointerPath, "utf8")))
      : validateHotColdPointer(clone(candidatePointer));
    const stamp = candidatePointer === undefined ? await this.#currentFileStamp(this.layout.pointerPath) : undefined;
    const manifest = validateHotColdManifest(await parseVerifiedArtifact(this.layout.root, pointer.manifest));
    if (manifest.generation !== pointer.generation) throw new TypeError("Agent Teams hot/cold pointer generation mismatch");
    const hotDocument = validateHotDocument(await parseVerifiedArtifact(this.layout.root, manifest.hot), manifest);
    const closedCatalog = validateClosedCatalog(await parseVerifiedArtifact(this.layout.root, manifest.closedCatalog));
    await verifiedArtifactBytes(this.layout.root, manifest.sourceV8);
    if (manifest.previous !== undefined) await verifiedArtifactBytes(this.layout.root, manifest.previous);
    const entries = [...manifest.hotTeams, ...closedCatalog.entries].sort((left, right) => left.ordinal - right.ordinal);
    if (entries.length !== manifest.teamCount) throw new TypeError("Agent Teams manifest team count disagrees with the closed catalog");
    entries.forEach(validateTeamLedgerEntry);
    const hotById = new Map(hotDocument.teams.map((team) => [team.id, team]));
    const hotEntries = entries.filter((entry) => entry.storage === "hot");
    if (hotById.size !== hotDocument.teams.length || hotEntries.length !== hotDocument.teams.length) throw new TypeError("Agent Teams hot document index is not one-to-one");
    const verifiedHotTeams = new Map(hotEntries.map((entry) => {
      const team = hotById.get(entry.id);
      if (team === undefined) throw new TypeError(`Agent Teams hot document is missing ${entry.id}`);
      return [entry.id, this.#assertTeamMatchesEntry(clone(team), entry)];
    }));
    validateIndexedStore(clone(hotDocument.header), entries, verifiedHotTeams);
    if (documentMerkleHash(hotDocument.header, entries) !== manifest.documentHash
      || documentSecurityHash(hotDocument.header, entries) !== manifest.securityHash) throw new TypeError("Agent Teams hot/cold manifest hash mismatch");
    if (JSON.stringify(rootLedgerProjectionHashes(hotDocument.header, entries)) !== JSON.stringify(manifest.projectionHashes)) throw new TypeError("Agent Teams hot/cold root projection hash mismatch");
    const teams = entries.map((entry) => entry.storage === "closed" ? ledgerTeamStub(entry) : verifiedHotTeams.get(entry.id));
    const document = assembleStoreDocument(hotDocument.header, teams);
    return { document, stamp, publication: hotColdPublication(pointer, manifest, hotDocument, entries) };
  }
  async #validateCompleteHotColdPublication(publication) {
    const { hotDocument, entries } = publication;
    const hotById = new Map(hotDocument.teams.map((team) => [team.id, team]));
    const fullTeams = new Map();
    for (const entry of entries) {
      const team = entry.storage === "hot"
        ? hotById.get(entry.id)
        : await parseVerifiedArtifact(this.layout.root, entry.shard);
      if (team === undefined) throw new TypeError(`Agent Teams rollback generation is missing ${entry.id}`);
      fullTeams.set(entry.id, this.#assertTeamMatchesEntry(clone(team), entry));
    }
    validateIndexedStore(clone(hotDocument.header), entries, fullTeams);
    validateStoreDocument(assembleStoreDocument(hotDocument.header, entries.map((entry) => fullTeams.get(entry.id))));
  }
  async #loadValidatedRollbackState(pointer) {
    const loaded = await this.#loadHotColdState(pointer);
    await this.#validateCompleteHotColdPublication(loaded.publication);
    const secondDescriptor = loaded.publication.manifest.previous;
    if (secondDescriptor !== undefined) {
      const secondPointer = {
        version: HOT_COLD_POINTER_VERSION,
        generation: secondDescriptor.generation,
        manifest: clone(secondDescriptor),
      };
      const secondLoaded = await this.#loadHotColdState(secondPointer);
      await this.#validateCompleteHotColdPublication(secondLoaded.publication);
      const thirdDescriptor = secondLoaded.publication.manifest.previous;
      if (thirdDescriptor !== undefined) {
        const thirdManifest = validateHotColdManifest(await parseVerifiedArtifact(this.layout.root, thirdDescriptor));
        if (thirdManifest.generation !== thirdDescriptor.generation) throw new TypeError("Agent Teams third rollback manifest generation mismatch");
      }
    }
    return loaded;
  }
  #materializeHotColdSync() {
    const teams = this.entries.map((entry) => this.#teamForEntrySync(entry));
    return assembleStoreDocument(this.hotDocument.header, teams);
  }
  #hotColdLazyDocument() {
    const tracker = { states: [], byProxy: new WeakMap() };
    const entries = this.entries;
    const hotDocument = this.hotDocument;
    const teams = entries.map((entry) => createLazyTeamProxy(entry, (candidate) => this.#teamForEntrySync(candidate, hotDocument), tracker, { mutable: true }));
    const document = assembleStoreDocument(hotDocument.header, teams);
    markStoreProjectionDocument(document, this.projectionMetadata);
    return { document, tracker };
  }
  async #writeTeamShard(team) {
    const artifact = jsonArtifact(team);
    const descriptor = { path: `closed/team-${artifact.hash}.json`, hash: artifact.hash, bytes: artifact.size };
    await writeImmutableArtifact(this.layout.root, descriptor.path, artifact.bytes);
    await this.#fault(`after-closed-shard:${team.id}`);
    await this.#fault("after-closed-shard");
    return descriptor;
  }
  async #writeHotDocument(hotDocument) {
    const artifact = jsonArtifact(hotDocument);
    const descriptor = { path: `hot/hot-${hotDocument.generation}-${artifact.hash}.json`, hash: artifact.hash, bytes: artifact.size };
    await writeImmutableArtifact(this.layout.root, descriptor.path, artifact.bytes);
    await this.#fault("after-hot-document");
    return descriptor;
  }
  async #commitHotColdPlan(header, ordered, { sourceV8 = this.manifest?.sourceV8, promotionDocument } = {}) {
    let previousRetentionKeep = new Set();
    let previousRetentionManifestChain;
    if (this.manifest !== undefined) {
      // A failed prior write may have left immutable artifacts outside the cached
      // reachability set. Refresh that stale state before the hard gate and before
      // writing even the first byte of the next real generation.
      if (!this.#retentionReachabilityIsCurrent()) await this.#refreshRetentionDebt();
      await this.#ensureRetentionWritable();
      previousRetentionKeep = new Set(this.retentionKeep);
      previousRetentionManifestChain = this.retentionManifestChain;
      // From this point an injected or physical write failure can leave an orphan.
      // The next real mutation must rescan; semantic no-ops never enter this method.
      this.#invalidateRetentionReachability();
    }
    const previousEntries = this.entries ?? [];
    const generation = (this.manifest?.generation ?? 0) + 1;
    const fullTeams = new Map();
    const entries = [];
    let artifactBytes = 0;
    let artifactFiles = 0;
    let catalogBytesWritten = 0;
    for (let ordinal = 0; ordinal < ordered.length; ordinal += 1) {
      const item = ordered[ordinal];
      if (item.team === undefined) {
        entries.push(item.entry.ordinal === ordinal ? item.entry : { ...item.entry, ordinal });
        continue;
      }
      const team = item.team;
      validateTeam(team);
      if (team.state === "closed") {
        let shard = item.entry?.storage === "closed" && item.entry.hash === jsonArtifact(team).hash ? item.entry.shard : undefined;
        if (shard === undefined) {
          shard = await this.#writeTeamShard(team);
          artifactBytes += shard.bytes;
          artifactFiles += 1;
        }
        entries.push(buildTeamLedgerEntry(team, ordinal, "closed", shard));
      } else {
        entries.push(buildTeamLedgerEntry(team, ordinal, "hot"));
      }
      fullTeams.set(team.id, team);
    }
    const hotTeams = entries.filter((entry) => entry.storage === "hot").map((entry) => {
      const team = fullTeams.get(entry.id) ?? this.#teamForEntrySync(this.teamEntries.get(entry.id));
      fullTeams.set(entry.id, team);
      return team;
    });
    const closedEntries = entries.filter((entry) => entry.storage === "closed");
    const previousClosedEntries = previousEntries.filter((entry) => entry.storage === "closed");
    const closedCatalogUnchangedByIdentity = closedEntries.length === previousClosedEntries.length
      && closedEntries.every((entry, index) => entry === previousClosedEntries[index]);
    let closedCatalog = (closedCatalogUnchangedByIdentity
      || JSON.stringify(closedEntries) === JSON.stringify(previousClosedEntries)) ? this.manifest?.closedCatalog : undefined;
    if (closedCatalog === undefined) {
      const catalogArtifact = jsonArtifact({ version: HOT_COLD_STORE_VERSION, entries: closedEntries });
      closedCatalog = { path: `catalog/catalog-${catalogArtifact.hash}.json`, hash: catalogArtifact.hash, bytes: catalogArtifact.size };
      await writeImmutableArtifact(this.layout.root, closedCatalog.path, catalogArtifact.bytes);
      catalogBytesWritten = closedCatalog.bytes;
      artifactBytes += closedCatalog.bytes;
      artifactFiles += 1;
      await this.#fault("after-closed-catalog");
    }
    validateClosedCatalog(await parseVerifiedArtifact(this.layout.root, closedCatalog));
    validateIndexedStore(clone(header), entries, fullTeams);
    const hotDocument = { version: HOT_COLD_STORE_VERSION, storeVersion: STORE_VERSION, generation, header: clone(header), teams: clone(hotTeams) };
    const hotArtifact = jsonArtifact(hotDocument);
    const hot = { path: `hot/hot-${generation}-${hotArtifact.hash}.json`, hash: hotArtifact.hash, bytes: hotArtifact.size };
    const projectionHashes = rootLedgerProjectionHashes(header, entries);
    const manifest = validateHotColdManifest({
      version: HOT_COLD_STORE_VERSION,
      storeVersion: STORE_VERSION,
      generation,
      createdAt: now(),
      ...(this.pointer?.manifest === undefined ? {} : { previous: clone(this.pointer.manifest) }),
      sourceV8: clone(sourceV8),
      hot,
      closedCatalog,
      hotTeams: entries.filter((entry) => entry.storage === "hot"),
      teamCount: entries.length,
      documentHash: documentMerkleHash(header, entries),
      securityHash: documentSecurityHash(header, entries),
      projectionHashes,
    });
    const manifestArtifact = jsonArtifact(manifest);
    const manifestDescriptor = { path: `manifests/manifest-${generation}-${manifestArtifact.hash}.json`, hash: manifestArtifact.hash, bytes: manifestArtifact.size, generation };
    const priorRetentionFloor = this.pointer?.retentionFloorGeneration
      ?? (this.pointer === undefined ? 1 : Math.max(1, this.pointer.generation - (HOT_COLD_RETENTION_COMPLETE_GENERATIONS - 1)));
    const retentionFloorGeneration = Math.max(priorRetentionFloor, generation - (HOT_COLD_RETENTION_MAX_COMPLETE_GENERATIONS - 1));
    const pointer = validateHotColdPointer({ version: HOT_COLD_POINTER_VERSION, generation, manifest: manifestDescriptor, retentionFloorGeneration });
    const pointerArtifact = jsonArtifact(pointer);
    // These content-addressed artifacts and the replaceable pointer temp are still
    // unreachable. Overlap their temp/write/file-fsync paths, but expose the pointer
    // only after both immutable artifacts have settled and the hot bytes revalidate.
    const [hotWrite, manifestWrite, pointerWrite] = await Promise.allSettled([
      (async () => {
        await this.#fault("before-hot-document-write");
        return writeImmutableArtifact(this.layout.root, hot.path, hotArtifact.bytes, {
          beforeRename: () => this.#fault(`before-immutable-rename:${hot.path}`),
        });
      })(),
      (async () => {
        await this.#fault("before-manifest-document-write");
        return writeImmutableArtifact(this.layout.root, manifestDescriptor.path, manifestArtifact.bytes, {
          beforeRename: () => this.#fault(`before-immutable-rename:${manifestDescriptor.path}`),
        });
      })(),
      prepareAtomicArtifact(this.layout.pointerPath, pointerArtifact.bytes),
    ]);
    const preparedPointer = pointerWrite.status === "fulfilled" ? pointerWrite.value : undefined;
    try {
      if (hotWrite.status === "rejected") throw hotWrite.reason;
      await this.#fault("after-hot-document");
      const physicalHot = validateHotDocument(await parseVerifiedArtifact(this.layout.root, hot), { generation });
      const physicalTeamCache = new Map();
      const physicalLoader = (entry) => {
        if (!physicalTeamCache.has(entry.id)) {
          const team = entry.storage === "hot"
            ? this.#assertTeamMatchesEntry(clone(physicalHot.teams.find((candidate) => candidate.id === entry.id)), entry)
            : this.#teamForEntrySync(entry, physicalHot);
          physicalTeamCache.set(entry.id, team);
        }
        return physicalTeamCache.get(entry.id);
      };
      for (const entry of entries) if (entry.storage === "hot" || fullTeams.has(entry.id)) physicalLoader(entry);
      // The complete index and logical teams were validated immediately before the
      // write. No local reference to `entries` escapes across that boundary; the
      // physical loader then validates and rebuilds every newly written team against
      // its exact entry, so repeating the global index walk cannot add a safety check.
      if (promotionDocument !== undefined) {
        const reconstructed = assembleStoreDocument(header, entries.map((entry) => physicalLoader(entry)));
        validateStoreDocument(reconstructed);
        const reconstructedJson = JSON.stringify(reconstructed), sourceJson = JSON.stringify(promotionDocument);
        const reconstructedProjections = JSON.stringify(rootProjectionHashes(reconstructed)), sourceProjections = JSON.stringify(rootProjectionHashes(promotionDocument));
        if (reconstructedJson !== sourceJson || reconstructedProjections !== sourceProjections) throw new TypeError(`Agent Teams v8 migration shadow comparison diverged (document ${sha256Bytes(Buffer.from(reconstructedJson))}/${sha256Bytes(Buffer.from(sourceJson))}; projections ${sha256Bytes(Buffer.from(reconstructedProjections))}/${sha256Bytes(Buffer.from(sourceProjections))})`);
        const rebuiltEntries = reconstructed.teams.map((team, ordinal) => buildTeamLedgerEntry(team, ordinal, team.state === "closed" ? "closed" : "hot", team.state === "closed" ? entries[ordinal].shard : undefined));
        if (documentMerkleHash(header, rebuiltEntries) !== manifest.documentHash || documentSecurityHash(header, rebuiltEntries) !== manifest.securityHash) throw new TypeError("Agent Teams v8 migration hash or security epoch diverged");
      }
      if (manifestWrite.status === "rejected") throw manifestWrite.reason;
      if (pointerWrite.status === "rejected") throw pointerWrite.reason;
      await this.#fault("after-manifest-document");
      artifactBytes += hot.bytes + manifestDescriptor.bytes;
      artifactFiles += 2;
      await this.#fault("before-manifest-switch");
      await preparedPointer.commit();
    } catch (error) {
      await preparedPointer?.dispose();
      throw error;
    }
    await preparedPointer.dispose();
    const stamp = await this.#currentFileStamp(this.layout.pointerPath);
    const publication = hotColdPublication(pointer, manifest, hotDocument, entries);
    this._adoptHotColdPublication(publication, stamp, { preserveRetention: true });
    this.lastStorageMutation = {
      generation,
      artifactBytes: artifactBytes + pointerArtifact.size,
      artifactFiles,
      hotBytes: hot.bytes,
      manifestBytes: manifestDescriptor.bytes,
      catalogBytes: catalogBytesWritten,
      closedShardBytes: artifactBytes - hot.bytes - manifestDescriptor.bytes - catalogBytesWritten,
      logicalBytes: entries.reduce((sum, entry) => sum + entry.bytes, jsonArtifact(header).size),
      changedTeamCount: ordered.filter((item) => item.team !== undefined && (item.entry === undefined || item.entry.hash !== jsonArtifact(item.team).hash)).length,
    };
    await this.#fault("after-manifest-switch");
    if (promotionDocument === undefined) {
      // Pointer replacement is the durable commit boundary. Retention is
      // maintenance after that boundary: a validation/read failure must never turn
      // a committed mutation into an ambiguous rejected operation. Mark the cache
      // stale so the next real mutation refreshes and enforces the hard gate first.
      try {
        // Only refs that just fell out of the bounded keep set are garbage. Newly
        // written current/rollback artifacts never enter debt, even transiently.
        await this.#advanceRetentionDebt(previousRetentionKeep, previousRetentionManifestChain);
        await this.#maybeSweepRetention();
      } catch (error) {
        this.#invalidateRetentionReachability();
        this.retention.consecutiveFailures += 1;
        this.retention.lastError = `post-commit retention maintenance failed: ${error?.message ?? String(error)}`;
      }
    }
    return publication;
  }
  async #promoteHotCold(document, legacyBytes, { prepared = false } = {}) {
    validateStoreDocument(document);
    const legacy = validateStoreDocument(JSON.parse(legacyBytes.toString("utf8")));
    if (legacy.version !== STORE_VERSION) throw new TypeError("Agent Teams hot/cold migration source must be v8");
    const sourceHash = sha256Bytes(legacyBytes);
    const sourceV8 = { path: `legacy/v8-${sourceHash}.json`, hash: sourceHash, bytes: legacyBytes.length };
    await writeImmutableArtifact(this.layout.root, sourceV8.path, legacyBytes);
    await this.#fault("after-v8-source-copy");
    const originalBytes = await readFile(this.filePath);
    if (!originalBytes.equals(legacyBytes)) throw new TypeError("Agent Teams v8 source changed during copy-only migration");
    try {
      if (prepared) {
        const sentinel = await this.#readPromotionSentinel();
        if (sentinel?.phase !== "prepared" || JSON.stringify(sentinel.sourceV8) !== JSON.stringify(sourceV8)) throw new TypeError("Agent Teams prepared promotion sentinel does not match the byte-identical v8 source");
      } else await this.#writePromotionSentinel(sourceV8, "prepared");
      await this.#commitHotColdPlan(storeHeader(document), document.teams.map((team) => ({ team: clone(team) })), { sourceV8, promotionDocument: document });
      await this.#writePromotionSentinel(sourceV8, "committed");
      // Generation one is entirely retained. Refresh only reachability metadata so
      // prior crash-orphan artifacts are classified without charging live bytes.
      await this.#maybeSweepRetention({ refresh: true });
      this.promotionBlocked = undefined;
    } catch (error) {
      this.promotionBlocked = error?.message ?? String(error);
      throw error;
    }
  }
  async #mutateHotCold(mutator) {
    const previousHeader = clone(this.hotDocument.header);
    const previousEntries = this.entries;
    const previousById = new Map(previousEntries.map((entry) => [entry.id, entry]));
    const { document: draft, tracker } = this.#hotColdLazyDocument();
    const value = await mutator(draft);
    if (draft.version !== STORE_VERSION || !Array.isArray(draft.teams)) throw new TypeError("agent teams store has an unsupported shape or version");
    const ordered = [];
    const seenIds = new Set();
    for (const candidate of draft.teams) {
      const state = tracker.byProxy.get(candidate);
      if (state !== undefined && !state.loaded) {
        if (seenIds.has(state.entry.id)) throw new TypeError("team ids must be unique");
        seenIds.add(state.entry.id);
        ordered.push({ entry: state.entry });
        continue;
      }
      const team = state === undefined ? cloneLazyValue(candidate, tracker) : state.current;
      const priorEntry = previousById.get(team.id);
      let priorTeam = state?.original;
      if (priorEntry !== undefined && priorTeam === undefined) priorTeam = this.#teamForEntrySync(priorEntry);
      if (seenIds.has(team.id)) throw new TypeError("team ids must be unique");
      seenIds.add(team.id);
      ordered.push({ team, entry: priorEntry, priorTeam });
    }
    let nextProvisioningSequence = Math.max(0, ...previousEntries.flatMap((entry) => entry.index.provisioning.map((item) => item.enqueueSequence)));
    const touchedTeams = ordered.flatMap((item) => item.team === undefined ? [] : [item.team]);
    for (const team of touchedTeams) for (const entry of team.provisioningQueue ?? []) entry.enqueueSequence ??= ++nextProvisioningSequence;
    const normalized = migrateStoreDocument(assembleStoreDocument(storeHeader(draft), touchedTeams));
    const header = storeHeader(normalized);
    for (const item of ordered) if (item.team !== undefined) {
      if (item.entry === undefined) item.team.revision = 1;
      else item.team.revision = teamComparableJson(item.priorTeam) === teamComparableJson(item.team) ? item.entry.revision : item.entry.revision + 1;
    }
    validateStoreHeader(header);
    const prospective = ordered.map((item, ordinal) => item.team === undefined
      ? { ...item.entry, ordinal }
      : buildTeamLedgerEntry(item.team, ordinal, item.team.state === "closed" ? "closed" : "hot", item.team.state === "closed" && item.entry?.storage === "closed" && item.entry.hash === jsonArtifact(item.team).hash ? item.entry.shard : item.team.state === "closed" ? { path: `closed/team-${jsonArtifact(item.team).hash}.json`, hash: jsonArtifact(item.team).hash, bytes: jsonArtifact(item.team).size } : undefined));
    if (JSON.stringify(header) === JSON.stringify(previousHeader)
      && JSON.stringify(prospective.map((entry) => [entry.ordinal, entry.id, entry.storage, entry.hash])) === JSON.stringify(previousEntries.map((entry) => [entry.ordinal, entry.id, entry.storage, entry.hash]))) return cloneLazyValue(value, tracker);
    const publication = await this.#commitHotColdPlan(header, ordered);
    publishStoreDocument(this.filePath, this.document, this.fileStamp, publication, { adoptedHotColdOrigin: this });
    return cloneLazyValue(value, tracker);
  }
  #retentionMaintenanceSuperseded() {
    const error = new Error("Agent Teams retention maintenance was superseded by foreground work");
    error.code = "AGENT_TEAMS_RETENTION_MAINTENANCE_SUPERSEDED";
    return error;
  }
  #isRetentionMaintenanceSuperseded(error) {
    return error?.code === "AGENT_TEAMS_RETENTION_MAINTENANCE_SUPERSEDED";
  }
  #retentionContinuationActive(shouldContinue) {
    return shouldContinue === undefined || shouldContinue();
  }
  #assertRetentionContinuation(shouldContinue) {
    if (!this.#retentionContinuationActive(shouldContinue)) throw this.#retentionMaintenanceSuperseded();
  }
  async #managedRetentionFiles({ shouldContinue } = {}) {
    this.#assertRetentionContinuation(shouldContinue);
    await this.#fault("before-retention-scan");
    this.#assertRetentionContinuation(shouldContinue);
    const files = [];
    for (const directory of ["closed", "catalog", "hot", "legacy", "manifests"]) {
      this.#assertRetentionContinuation(shouldContinue);
      const directoryPath = join(this.layout.root, directory);
      let children;
      try { children = await readdir(directoryPath, { withFileTypes: true }); }
      catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      this.#assertRetentionContinuation(shouldContinue);
      for (const child of children) {
        const reference = `${directory}/${child.name}`;
        if (!child.isFile() || !HOT_COLD_FILE_REF.test(reference)) continue;
        this.#assertRetentionContinuation(shouldContinue);
        const filePath = hotColdArtifactPath(this.layout.root, reference);
        let info;
        try { info = await lstat(filePath); }
        catch (error) { if (error?.code === "ENOENT") continue; throw error; }
        this.#assertRetentionContinuation(shouldContinue);
        if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(info.size) || info.size < 0) continue;
        files.push({ reference, filePath, bytes: info.size });
      }
    }
    return files.sort((left, right) => left.reference.localeCompare(right.reference));
  }
  async #retentionPlan({ fullValidation = false, shouldContinue, expectedAuthority, previousManifestChain } = {}) {
    this.#assertRetentionContinuation(shouldContinue);
    const pointerBytes = await readFile(this.layout.pointerPath);
    this.#assertRetentionContinuation(shouldContinue);
    const pointer = validateHotColdPointer(JSON.parse(pointerBytes.toString("utf8")));
    if (!pointerBytes.equals(jsonArtifact(pointer).bytes)) throw new TypeError("Agent Teams hot/cold pointer is noncanonical");
    const retentionAuthorityContext = Promise.all([
      this.#currentFileStamp(this.layout.pointerPath),
      this.#readPromotionSentinel(),
      this.#readLegacyPromotionMarker(),
    ]).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    const keep = new Set();
    const artifactBytesCache = new Map();
    const artifactJsonCache = new Map();
    const validatedClosedCatalogCache = new Map();
    const descriptorCacheKey = (candidate) => JSON.stringify([candidate.path, candidate.hash, candidate.bytes, candidate.generation ?? null]);
    const cachedArtifactBytes = async (candidate) => {
      const key = descriptorCacheKey(candidate);
      if (!artifactBytesCache.has(key)) artifactBytesCache.set(key, (async () => {
        this.#assertRetentionContinuation(shouldContinue);
        await this.#fault(`before-retention-artifact-read:${candidate.path}`);
        this.#assertRetentionContinuation(shouldContinue);
        const bytes = await verifiedArtifactBytes(this.layout.root, candidate);
        this.#assertRetentionContinuation(shouldContinue);
        return bytes;
      })());
      return artifactBytesCache.get(key);
    };
    const cachedArtifactJson = async (candidate) => {
      const key = descriptorCacheKey(candidate);
      if (!artifactJsonCache.has(key)) artifactJsonCache.set(key, cachedArtifactBytes(candidate).then((bytes) => JSON.parse(bytes.toString("utf8"))));
      return artifactJsonCache.get(key);
    };
    const cachedClosedCatalog = async (candidate) => {
      const key = descriptorCacheKey(candidate);
      if (!validatedClosedCatalogCache.has(key)) validatedClosedCatalogCache.set(key, cachedArtifactJson(candidate).then(validateClosedCatalog));
      return validatedClosedCatalogCache.get(key);
    };
    const expectedManifestDescriptors = Array.isArray(previousManifestChain)
      ? [pointer.manifest, ...previousManifestChain.slice(0, HOT_COLD_RETENTION_MAX_COMPLETE_GENERATIONS)]
      : [];
    const prefetchedManifestJson = new Map();
    for (const candidate of expectedManifestDescriptors) {
      validateCanonicalArtifactDescriptor(candidate, "manifest", candidate.generation);
      const key = descriptorCacheKey(candidate);
      if (!prefetchedManifestJson.has(key)) prefetchedManifestJson.set(key, cachedArtifactJson(candidate).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ));
    }
    const authorityOutcome = await retentionAuthorityContext;
    if (authorityOutcome.error !== undefined) throw authorityOutcome.error;
    const [pointerStamp, sentinel, legacyMarker] = authorityOutcome.value;
    this.#assertRetentionContinuation(shouldContinue);
    const authority = this.#retentionAuthorityFor(pointer, pointerStamp, pointerBytes);
    if (expectedAuthority !== undefined && !this.#retentionAuthorityEquals(authority, expectedAuthority)) throw this.#retentionMaintenanceSuperseded();
    if (sentinel?.phase !== "committed") throw new TypeError("Agent Teams retention requires a committed sibling promotion sentinel");
    let descriptor = pointer.manifest;
    let currentSource;
    const manifestChain = [];
    const retainedGenerations = [];
    const retentionFloorGeneration = pointer.retentionFloorGeneration
      ?? Math.max(1, pointer.generation - (HOT_COLD_RETENTION_COMPLETE_GENERATIONS - 1));
    for (let depth = 0; descriptor !== undefined && depth <= HOT_COLD_RETENTION_MAX_COMPLETE_GENERATIONS; depth += 1) {
      this.#assertRetentionContinuation(shouldContinue);
      validateCanonicalArtifactDescriptor(descriptor, "manifest", descriptor.generation);
      const expectedDescriptor = expectedManifestDescriptors[depth];
      if (expectedDescriptor !== undefined && descriptorCacheKey(descriptor) !== descriptorCacheKey(expectedDescriptor)) throw new TypeError("Agent Teams retained manifest chain diverged from the prior validated generation");
      const prefetched = prefetchedManifestJson.get(descriptorCacheKey(descriptor));
      const outcome = prefetched === undefined
        ? { value: await cachedArtifactJson(descriptor) }
        : await prefetched;
      if (outcome.error !== undefined) throw outcome.error;
      const manifest = validateHotColdManifest(outcome.value);
      if (manifest.generation !== descriptor.generation) throw new TypeError("Agent Teams retention manifest generation mismatch");
      manifestChain.push(descriptor);
      keep.add(descriptor.path);
      const retainComplete = depth < HOT_COLD_RETENTION_MAX_COMPLETE_GENERATIONS && manifest.generation >= retentionFloorGeneration;
      if (retainComplete) {
        currentSource ??= manifest.sourceV8;
        if (JSON.stringify(manifest.sourceV8) !== JSON.stringify(currentSource)) throw new TypeError("Agent Teams retained generations disagree on their immutable v8 source");
        for (const artifact of [manifest.sourceV8, manifest.hot, manifest.closedCatalog]) keep.add(artifact.path);
        // Catalog integrity is independent of the preceding manifest chain. Start
        // each distinct content-addressed read now while the next manifest resolves.
        const catalogOutcome = cachedClosedCatalog(manifest.closedCatalog).then(
          (catalog) => ({ catalog }),
          (error) => ({ error }),
        );
        retainedGenerations.push({ manifest, catalogOutcome });
      }
      if (!retainComplete) break;
      descriptor = manifest.previous;
    }
    for (const retained of retainedGenerations) {
      const { manifest } = retained;
      const outcome = await retained.catalogOutcome;
      if (outcome.error !== undefined) throw outcome.error;
      const catalog = outcome.catalog;
      const entries = [...manifest.hotTeams, ...catalog.entries].sort((left, right) => left.ordinal - right.ordinal);
      if (entries.length !== manifest.teamCount) throw new TypeError("Agent Teams retained generation team count mismatch");
      // Both descriptor classes were fully validated above; only their merged
      // canonical ordinal sequence is generation-specific.
      if (entries.some((entry, ordinal) => entry.ordinal !== ordinal)) throw new TypeError("Agent Teams retained generation team ordinals mismatch");
      for (const entry of catalog.entries) keep.add(entry.shard.path);
      if (fullValidation) {
        await cachedArtifactBytes(manifest.sourceV8);
        const hotDocument = validateHotDocument(await cachedArtifactJson(manifest.hot), manifest);
        const hotById = new Map(hotDocument.teams.map((team) => [team.id, team]));
        const fullTeams = new Map();
        for (const entry of entries) {
          this.#assertRetentionContinuation(shouldContinue);
          let team;
          if (entry.storage === "hot") team = hotById.get(entry.id);
          else team = await cachedArtifactJson(entry.shard);
          if (team === undefined) throw new TypeError(`Agent Teams retained generation is missing ${entry.id}`);
          fullTeams.set(entry.id, this.#assertTeamMatchesEntry(clone(team), entry));
        }
        validateIndexedStore(clone(hotDocument.header), entries, fullTeams);
        const document = assembleStoreDocument(hotDocument.header, entries.map((entry) => fullTeams.get(entry.id)));
        validateStoreDocument(document);
        if (documentMerkleHash(hotDocument.header, entries) !== manifest.documentHash
          || documentSecurityHash(hotDocument.header, entries) !== manifest.securityHash
          || JSON.stringify(rootLedgerProjectionHashes(hotDocument.header, entries)) !== JSON.stringify(manifest.projectionHashes)) throw new TypeError("Agent Teams retained generation hash validation failed");
      }
    }
    if (currentSource === undefined || JSON.stringify(sentinel.sourceV8) !== JSON.stringify(currentSource)) throw new TypeError("Agent Teams promotion sentinel disagrees with the retained generation chain");
    if (legacyMarker !== undefined) validateLegacyPromotionMarker(legacyMarker, currentSource);
    if (fullValidation) {
      const sourceBytes = await cachedArtifactBytes(currentSource);
      this.#assertRetentionContinuation(shouldContinue);
      await this.#verifyOuterV8Source(currentSource, undefined, { knownCopyBytes: sourceBytes });
      this.#assertRetentionContinuation(shouldContinue);
    }
    return { pointer, pointerBytes, pointerStamp, authority, keep, manifestChain };
  }
  #setRetentionReachability(plan, candidates) {
    this.retentionKeep = plan.keep;
    this.retentionKeepGeneration = plan.pointer.generation;
    this.retentionAuthority = plan.authority;
    this.retentionManifestChain = plan.manifestChain;
    this.retentionGarbage = new Map(candidates.map((candidate) => [candidate.reference, candidate]));
    this.retention.debtBytes = candidates.reduce((sum, file) => sum + file.bytes, 0);
    this.retention.debtFiles = candidates.length;
    this.retentionRevision += 1;
  }
  async #refreshRetentionDebt({ shouldContinue, expectedAuthority } = {}) {
    const [planResult, filesResult] = await Promise.allSettled([
      this.#retentionPlan({ shouldContinue, expectedAuthority }),
      this.#managedRetentionFiles({ shouldContinue }),
    ]);
    if (planResult.status === "rejected") throw planResult.reason;
    if (filesResult.status === "rejected") throw filesResult.reason;
    const plan = planResult.value, files = filesResult.value;
    const candidates = files.filter((file) => !plan.keep.has(file.reference));
    this.#setRetentionReachability(plan, candidates);
    return { plan, files, candidates };
  }
  async #advanceRetentionDebt(previousKeep, previousManifestChain) {
    const plan = await this.#retentionPlan({ previousManifestChain });
    for (const reference of plan.keep) this.retentionGarbage.delete(reference);
    const expiredReferences = [...previousKeep].filter((reference) => !plan.keep.has(reference) && !this.retentionGarbage.has(reference));
    const expiredArtifacts = await Promise.all(expiredReferences.map(async (reference) => {
      const filePath = hotColdArtifactPath(this.layout.root, reference);
      let info;
      try { info = await lstat(filePath); }
      catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
      if (!info.isFile() || info.isSymbolicLink() || !Number.isSafeInteger(info.size) || info.size < 0) return undefined;
      return { reference, filePath, bytes: info.size };
    }));
    for (const artifact of expiredArtifacts) if (artifact !== undefined) this.retentionGarbage.set(artifact.reference, artifact);
    this.#setRetentionReachability(plan, [...this.retentionGarbage.values()]);
  }
  #retentionAtSoftWatermark() {
    return this.retention.debtBytes >= this.retention.policy.softBytes || this.retention.debtFiles >= this.retention.policy.softFiles;
  }
  #retentionAtHardWatermark() {
    return this.retention.debtBytes >= this.retention.policy.hardBytes || this.retention.debtFiles >= this.retention.policy.hardFiles;
  }
  _retentionMaintenanceNeeded() {
    return !this.closed && this.storageMode === "hot-cold" && this.#retentionAtSoftWatermark();
  }
  #captureRetentionMaintenanceToken(state, foregroundEpoch) {
    if (this.closed || state.foregroundCount !== 0 || state.foregroundEpoch !== foregroundEpoch || !this._retentionMaintenanceNeeded() || !this.#retentionReachabilityIsCurrent()) return undefined;
    return Object.freeze({
      authority: this.retentionAuthority,
      retentionRevision: this.retentionRevision,
      debtBytes: this.retention.debtBytes,
      debtFiles: this.retention.debtFiles,
      lifecycleEpoch: this.retentionLifecycleEpoch,
      foregroundEpoch,
    });
  }
  #retentionMaintenanceContextMatches(token, state) {
    return !this.closed
      && this.retentionLifecycleEpoch === token.lifecycleEpoch
      && state.foregroundCount === 0
      && state.foregroundEpoch === token.foregroundEpoch
      && this.#retentionAuthorityMatches(this.pointer, this.fileStamp)
      && this.#retentionAuthorityEquals(this.retentionAuthority, token.authority);
  }
  #retentionMaintenanceTokenMatches(token, state) {
    return this.#retentionMaintenanceContextMatches(token, state)
      && this.retentionRevision === token.retentionRevision
      && this.retention.debtBytes === token.debtBytes
      && this.retention.debtFiles === token.debtFiles;
  }
  async #sweepRetention({ shouldContinue, expectedAuthority } = {}) {
    this.#assertRetentionContinuation(shouldContinue);
    await this.#fault("before-retention-sweep");
    this.#assertRetentionContinuation(shouldContinue);
    // Finish every hash/ACL/epoch validation before the first unlink. A failed
    // retained generation therefore causes exactly zero deletion.
    const plan = await this.#retentionPlan({ fullValidation: true, shouldContinue, expectedAuthority });
    const files = await this.#managedRetentionFiles({ shouldContinue });
    const candidates = files.filter((file) => !plan.keep.has(file.reference));
    const deleted = new Set();
    const failures = [];
    const syncedDirectories = new Set();
    let aborted = false;
    let superseded = false;
    for (const candidate of candidates) {
      if (!this.#retentionContinuationActive(shouldContinue)) {
        superseded = true;
        aborted = true;
        break;
      }
      try { await this.#fault(`before-retention-unlink:${candidate.reference}`); }
      catch (error) {
        if (!this.#retentionContinuationActive(shouldContinue)) {
          superseded = true;
          aborted = true;
          break;
        }
        failures.push({ reference: candidate.reference, error: error?.message ?? String(error) });
        await syncStoreDirectory(dirname(candidate.filePath));
        continue;
      }
      if (!this.#retentionContinuationActive(shouldContinue)) {
        superseded = true;
        aborted = true;
        break;
      }
      let currentBytes;
      let currentStamp;
      try {
        currentBytes = await readFile(this.layout.pointerPath);
        currentStamp = await this.#currentFileStamp(this.layout.pointerPath);
      } catch (error) {
        failures.push({ reference: candidate.reference, error: `pointer recheck failed: ${error?.message ?? String(error)}` });
        aborted = true;
        break;
      }
      if (!this.#retentionContinuationActive(shouldContinue)) {
        superseded = true;
        aborted = true;
        break;
      }
      if (!currentBytes.equals(plan.pointerBytes) || currentStamp !== plan.pointerStamp) {
        failures.push({ reference: candidate.reference, error: "pointer identity changed before deletion" });
        aborted = true;
        break;
      }
      try {
        await unlink(candidate.filePath);
        deleted.add(candidate.reference);
        syncedDirectories.add(dirname(candidate.filePath));
        await this.#fault(`after-retention-unlink:${candidate.reference}`);
      } catch (error) {
        if (error?.code === "ENOENT") deleted.add(candidate.reference);
        else failures.push({ reference: candidate.reference, error: error?.message ?? String(error) });
        await syncStoreDirectory(dirname(candidate.filePath));
      }
      if (!this.#retentionContinuationActive(shouldContinue)) {
        superseded = true;
        aborted = true;
        break;
      }
    }
    for (const directory of syncedDirectories) await syncStoreDirectory(directory);
    if (!superseded) await this.#fault("after-retention-sweep");
    const remaining = candidates.filter((candidate) => !deleted.has(candidate.reference));
    return {
      plan,
      remaining,
      deletedFiles: deleted.size,
      deletedBytes: candidates.filter((candidate) => deleted.has(candidate.reference)).reduce((sum, file) => sum + file.bytes, 0),
      remainingFiles: remaining.length,
      remainingBytes: remaining.reduce((sum, file) => sum + file.bytes, 0),
      failures,
      aborted,
      superseded,
    };
  }
  #applyRetentionSweepResult(result) {
    if (result.aborted) this.#invalidateRetentionReachability({ requireAuthorityReload: true });
    else this.#setRetentionReachability(result.plan, result.remaining);
    this.retention.lastSweep = {
      at: now(),
      deletedFiles: result.deletedFiles,
      deletedBytes: result.deletedBytes,
      remainingFiles: result.remainingFiles,
      remainingBytes: result.remainingBytes,
      failures: clone(result.failures),
      aborted: result.aborted,
    };
    if (result.failures.length === 0 && !result.aborted) {
      this.retention.consecutiveFailures = 0;
      this.retention.blocked = false;
      this.retention.lastError = undefined;
      return true;
    }
    this.retention.consecutiveFailures += 1;
    this.retention.lastError = result.failures[0]?.error ?? "retention sweep aborted";
    this.retention.blocked = this.#retentionAtHardWatermark();
    return false;
  }
  async #recordRetentionValidationFailure(error, options = {}) {
    // A failed full validation must never turn the legitimate live baseline into
    // garbage debt. A cheaper reachability pass may still classify candidates.
    try { await this.#refreshRetentionDebt(options); }
    catch (refreshError) {
      if (this.#isRetentionMaintenanceSuperseded(refreshError)) throw refreshError;
      // Preserve the prior exact generation-derived estimate when refresh also fails.
    }
    this.retention.consecutiveFailures += 1;
    this.retention.lastError = error?.message ?? String(error);
    this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, validationFailed: true, error: this.retention.lastError };
    this.retention.blocked = this.#retentionAtHardWatermark();
  }
  async #runRetentionSweep() {
    const expectedAuthority = this.#retentionReachabilityIsCurrent() ? this.retentionAuthority : undefined;
    try {
      const result = await this.#sweepRetention({ expectedAuthority });
      return this.#applyRetentionSweepResult(result);
    } catch (error) {
      if (this.#isRetentionMaintenanceSuperseded(error)) {
        this.#invalidateRetentionReachability({ requireAuthorityReload: true });
        this.retention.consecutiveFailures += 1;
        this.retention.lastError = "pointer identity changed before hard retention maintenance";
        this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, failures: [{ error: this.retention.lastError }], aborted: true };
        this.retention.blocked = this.#retentionAtHardWatermark();
        return false;
      }
      await this.#recordRetentionValidationFailure(error, { expectedAuthority });
      return false;
    }
  }
  async _runRetentionMaintenance(state, foregroundEpoch) {
    const lifecycleEpoch = this.retentionLifecycleEpoch;
    const contextActive = () => !this.closed
      && this.retentionLifecycleEpoch === lifecycleEpoch
      && state.foregroundCount === 0
      && state.foregroundEpoch === foregroundEpoch;
    if (!contextActive()) return { status: "superseded" };
    if (!this.#retentionReachabilityIsCurrent()) {
      const expectedAuthority = this.#retentionAuthorityFor(this.pointer, this.fileStamp);
      try { await this.#refreshRetentionDebt({ shouldContinue: contextActive, expectedAuthority }); }
      catch (error) {
        if (this.#isRetentionMaintenanceSuperseded(error)) {
          if (!contextActive()) return { status: "superseded" };
          this.#invalidateRetentionReachability({ requireAuthorityReload: true });
          this.retention.consecutiveFailures += 1;
          this.retention.lastError = "pointer identity changed before retention maintenance";
          this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, failures: [{ error: this.retention.lastError }], aborted: true };
          this.retention.blocked = this.#retentionAtHardWatermark();
          return { status: "failed" };
        }
        this.retention.consecutiveFailures += 1;
        this.retention.lastError = error?.message ?? String(error);
        this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, validationFailed: true, error: this.retention.lastError };
        this.retention.blocked = this.#retentionAtHardWatermark();
        return { status: "failed" };
      }
    }
    const token = this.#captureRetentionMaintenanceToken(state, foregroundEpoch);
    if (token === undefined) return { status: contextActive() && !this._retentionMaintenanceNeeded() ? "completed" : "superseded" };
    const shouldContinue = () => this.#retentionMaintenanceTokenMatches(token, state);
    try {
      const result = await this.#sweepRetention({ shouldContinue, expectedAuthority: token.authority });
      if (result.superseded || !this.#retentionMaintenanceTokenMatches(token, state)) {
        this.#invalidateRetentionReachability();
        return { status: "superseded" };
      }
      const succeeded = this.#applyRetentionSweepResult(result);
      return { status: succeeded ? "completed" : "failed" };
    } catch (error) {
      if (!this.#retentionMaintenanceTokenMatches(token, state)) {
        this.#invalidateRetentionReachability();
        return { status: "superseded" };
      }
      if (this.#isRetentionMaintenanceSuperseded(error)) {
        this.#invalidateRetentionReachability({ requireAuthorityReload: true });
        this.retention.consecutiveFailures += 1;
        this.retention.lastError = "pointer identity changed during retention validation";
        this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, failures: [{ error: this.retention.lastError }], aborted: true };
        this.retention.blocked = this.#retentionAtHardWatermark();
        return { status: "failed" };
      }
      try {
        await this.#recordRetentionValidationFailure(error, { shouldContinue, expectedAuthority: token.authority });
      } catch (refreshError) {
        if (this.#isRetentionMaintenanceSuperseded(refreshError)) {
          if (!this.#retentionMaintenanceContextMatches(token, state)) {
            this.#invalidateRetentionReachability();
            return { status: "superseded" };
          }
          this.#invalidateRetentionReachability({ requireAuthorityReload: true });
          this.retention.consecutiveFailures += 1;
          this.retention.lastError = "pointer identity changed while retention failure was reconciled";
          this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, failures: [{ error: this.retention.lastError }], aborted: true };
          this.retention.blocked = this.#retentionAtHardWatermark();
          return { status: "failed" };
        }
        throw refreshError;
      }
      if (!this.#retentionMaintenanceContextMatches(token, state)) {
        this.#invalidateRetentionReachability();
        return { status: "superseded" };
      }
      return { status: "failed" };
    }
  }
  _recordUnexpectedRetentionMaintenanceFailure(error, state, foregroundEpoch) {
    if (this.closed || state.foregroundCount !== 0 || state.foregroundEpoch !== foregroundEpoch) return { status: "superseded" };
    this.#invalidateRetentionReachability();
    this.retention.consecutiveFailures += 1;
    this.retention.lastError = error?.message ?? String(error);
    this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, validationFailed: true, error: this.retention.lastError };
    this.retention.blocked = this.#retentionAtHardWatermark();
    return { status: "failed" };
  }
  async #maybeSweepRetention({ refresh = false } = {}) {
    if (this.storageMode !== "hot-cold") return;
    if (refresh) {
      try { await this.#refreshRetentionDebt(); }
      catch (error) {
        // Unknown live artifacts are not garbage. Retain only the previously
        // accumulated generation estimate until reachability validates again.
        this.retention.consecutiveFailures += 1;
        this.retention.lastError = error?.message ?? String(error);
        this.retention.lastSweep = { at: now(), deletedFiles: 0, deletedBytes: 0, validationFailed: true, error: this.retention.lastError };
        this.retention.blocked = this.#retentionAtHardWatermark();
        return;
      }
    }
    if (this.#retentionAtSoftWatermark()) requestStoreRetentionMaintenance(this.filePath);
  }
  async #ensureRetentionWritable() {
    if (!this.retention.blocked && !this.#retentionAtHardWatermark()) return;
    await this.#runRetentionSweep();
    this.retention.blocked = this.#retentionAtHardWatermark();
    if (!this.retention.blocked) return;
    throw new HarnessError(`Agent Teams ledger retention is blocked at the hard watermark: ${this.retention.lastError ?? "garbage collection failed"}`, "AGENT_TEAMS_LEDGER_RETENTION_BLOCKED");
  }
  async #refreshFromDiskIfChanged() {
    const pointerExists = existsSync(this.layout.pointerPath);
    if (!pointerExists && (this.storageMode === "hot-cold" || existsSync(this.layout.promotionMarkerPath) || existsSync(this.layout.legacyPromotionMarkerPath))) throw new TypeError("Agent Teams hot/cold manifest pointer disappeared; refusing stale v8 fallback");
    const authorityPath = pointerExists ? this.layout.pointerPath : this.filePath;
    let stamp;
    try { stamp = await this.#currentFileStamp(authorityPath); }
    catch (error) { if (error?.code === "ENOENT" && !pointerExists) return; throw error; }
    if (!this.retentionAuthorityReloadRequired
      && stamp === this.fileStamp
      && (pointerExists ? this.storageMode === "hot-cold" : this.storageMode === "legacy")) return;
    if (pointerExists) {
      const loaded = await this.#loadHotColdState();
      this._adoptHotColdPublication(loaded.publication, loaded.stamp);
      await this.#reconcilePromotionSentinel(await this.#readPromotionSentinel(), await this.#readLegacyPromotionMarker());
      await this.#maybeSweepRetention({ refresh: true });
      return;
    }
    const persisted = validateStoreDocument(JSON.parse(await readFile(this.filePath, "utf8")));
    this._adoptLegacyPublication(persisted, stamp);
  }
  async #writeLegacy(document) {
    await replaceAtomicArtifact(this.filePath, jsonArtifact(document).bytes);
    this.fileStamp = await this.#currentFileStamp(this.filePath);
  }
}

function storeReadView(store) {
  return typeof store?.view === "function" ? store.view() : store.snapshot();
}

function reject(message, code = "AGENT_TEAMS_POLICY") {
  throw new HarnessError(message, code);
}
function rejectWithNextAction(message, code, nextAction) {
  const error = new HarnessError(`${message}; next action: ${nextAction}`, code);
  error.nextAction = nextAction;
  throw error;
}
function annotateNextAction(error, nextAction) {
  if (error !== null && typeof error === "object" && error.nextAction === undefined) {
    error.nextAction = nextAction;
    if (typeof error.message === "string" && !error.message.includes("next action:")) error.message = `${error.message}; next action: ${nextAction}`;
  }
  return error;
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
  if (receipt.outcome !== outcome || receipt.teamId !== team.id) rejectWithNextAction("terminal routing receipt replay must match its exact outcome and team binding", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT", "reuse the exact original terminal outcome and team binding, or wait for a new authorized root turn; never mutate this receipt");
  return receipt;
}
async function recordRoutingReceipt(store, execution, input) {
  const material = routingReceiptMaterial(execution, input);
  return store.mutate((document) => {
    assertEnabled(document);
    const existing = document.routingReceipts.find((receipt) => receipt.rootSessionId === material.rootSessionId && receipt.turnKey === material.turnKey);
    if (existing !== undefined) {
      if (JSON.stringify(routingDecisionComparable(existing)) !== JSON.stringify(routingDecisionComparable(material))) rejectWithNextAction("current root turn already has a different routing decision", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT", "keep this turn's immutable decision; start team creation only from a new direct-human or exact admitted Goal turn");
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
      if (existing.outcome !== material.outcome || existing.teamId !== material.teamId) rejectWithNextAction("terminal routing receipt replay must match its exact outcome and team binding", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT", "reuse the exact original terminal outcome and team binding, or wait for a new authorized root turn; never mutate this receipt");
      return { receipt: clone(existing), reused: true };
    }
    if (material.outcome !== "recorded") rejectWithNextAction("terminal Level 3 routing outcome requires an existing matching recorded decision", "AGENT_TEAMS_ROUTING_RECEIPT_CONFLICT", "record the immutable Level 3 decision before attempting its exact terminal outcome");
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
function exactDirectHumanAutopilotIntentMatches(document, root, goal, intent) {
  return isRecord(intent) && typeof intent.authorizationEpoch === "string" && /^[A-Za-z0-9_-]{16,128}$/u.test(intent.authorizationEpoch)
    && typeof intent.autopilotSettingsHash === "string" && /^[a-f0-9]{64}$/u.test(intent.autopilotSettingsHash)
    && intent.autopilotSettingsHash === agentTeamAutopilotSettingsHash(document.settings)
    && intent.rootSessionId === root.id && intent.projectKey === optionalProjectKeyForRoot(root)
    && goal !== undefined && intent.goalId === goal.id && intent.goalRevision === goal.revision
    && intent.goalRound === goal.roundsStarted && intent.goalObjectiveHash === agentTeamAutopilotObjectiveHash(goal.objective)
    && intent.goalMaxGoalRounds === goal.maxGoalRounds;
}
function exactDirectHumanGrantIntentMatches(document, root, goal, routingReceiptId, intent) {
  if (!exactDirectHumanAutopilotIntentMatches(document, root, goal, intent)) return false;
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
  let liveGrantTeams = openTeams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
  const exactDirectHumanCreation = exactDirectHumanGrantIntentMatches(document, root, goal, routingReceiptId, directHumanGrantIntent);
  if (openTeams.length > 0 && liveGrantTeams.length !== openTeams.length && exactDirectHumanCreation) {
    deriveDirectHumanAutopilotGrantGroup(document, openTeams[0], root, goal, directHumanGrantIntent);
    liveGrantTeams = openTeams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
  }
  if (openTeams.length > 0) {
    // A sibling may inherit only a complete exact grant group. Direct-human
    // creation can first repair a safe missing/lifecycle-revoked group from the
    // durable global Host proof; ordinary Goal rounds cannot.
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
    inherited.routingReceiptId = routingReceiptId;
    inherited.status = planHash === undefined ? "pending_plan" : "active";
    inherited.pauseEpochAtGrant = pauseEpoch;
    inherited.grantedAt = now();
    inherited.revokedAt = undefined;
    inherited.revokeReason = undefined;
    inherited.parkedGoalRevision = undefined;
    inherited.parkedStateHash = undefined;
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
function finalizedAutopilotRoutingReceipt(document, team, goal) {
  return [...document.routingReceipts].reverse().find((receipt) => receipt.teamId === team.id
    && receipt.level === "level3" && ["created", "reused"].includes(receipt.outcome)
    && receipt.projectKey === team.projectKey && rootAppearsInValidOwnershipChain(team, receipt.rootSessionId)
    && (receipt.establishmentAuthority === "direct_human" || receipt.establishmentAuthority === "goal_round"
      && receipt.goalId === goal?.id && receipt.goalObjectiveHash === agentTeamAutopilotObjectiveHash(goal?.objective)
      && receipt.goalMaxGoalRounds === goal?.maxGoalRounds));
}
function directHumanAutopilotPlanBinding(team) {
  if (effectiveTeamState(team) !== "active" || team.closure !== undefined || team.handoff !== undefined
    || memberRecoveryBlocksAutopilot(team)
    || (team.provisioningQueue ?? []).some((entry) => entry.status === "outcome_unknown")
    || !planCapabilitiesAreVerified(team) || !planFilesAreConflictFree(team) || !planEffectsAreOrdinary(team)) return undefined;
  if (teamHasEstablishedWorker(team)) return planAuthorizationSupportsAutopilot(team) ? { status: "active", planHash: team.plan.hash } : undefined;
  return team.plan?.phase === "committed" && team.plan.migrationState === "ready" && team.plan.hash === teamPlanHash(team)
    && team.plan.authorization?.confirmedPlanHash === team.plan.hash
    ? { status: "pending_plan", planHash: undefined }
    : undefined;
}
function deriveDirectHumanAutopilotGrantGroup(document, selectedTeam, root, goal, intent, { resumeBoundary = false } = {}) {
  if (document.settings.autopilotEnabled !== true || !exactDirectHumanAutopilotIntentMatches(document, root, goal, intent)) return [];
  const configuredBudget = document.settings.autopilotMaxAdditionalRounds;
  if (!Number.isSafeInteger(configuredBudget) || configuredBudget < 1 || configuredBudget > AGENT_TEAM_AUTOPILOT_MAX_ADDITIONAL_ROUNDS) return [];
  const openTeams = document.teams.filter((team) => team.rootLeadSessionId === root.id && team.state !== "closed").sort((left, right) => left.id.localeCompare(right.id));
  if (openTeams.length === 0 || !openTeams.includes(selectedTeam) || openTeams.some((team) => team.projectKey !== intent.projectKey)) return [];
  const bindings = new Map();
  const receipts = new Map();
  for (const team of openTeams) {
    const binding = directHumanAutopilotPlanBinding(team);
    const receipt = finalizedAutopilotRoutingReceipt(document, team, goal);
    if (binding === undefined || receipt === undefined) return [];
    bindings.set(team.id, binding);
    receipts.set(team.id, receipt);
  }
  const terminalGrants = openTeams.filter((team) => ["revoked", "exhausted"].includes(team.autopilot?.status));
  if (terminalGrants.length > 0) {
    const recoverableLifecycle = (team) => team.autopilot.status === "revoked"
      && team.autopilot.revokeReason === AGENT_TEAM_AUTOPILOT_LIFECYCLE_REVOKE_REASON
      && team.autopilot.authorizationEpoch === intent.authorizationEpoch
      && team.autopilot.pauseEpochAtGrant === (team.pauseEpoch ?? 0);
    const recoverableStop = (team) => resumeBoundary && team.autopilot.status === "revoked"
      && team.autopilot.revokeReason === AGENT_TEAM_AUTOPILOT_STOP_REVOKE_REASON
      && team.autopilot.pauseEpochAtGrant + 1 === (team.pauseEpoch ?? 0);
    const exactTerminalScope = (team) => team.autopilot.rootSessionId === root.id && team.autopilot.projectKey === intent.projectKey
      && team.autopilot.goalId === goal.id && team.autopilot.goalObjectiveHash === agentTeamAutopilotObjectiveHash(goal.objective)
      && team.autopilot.expectedMaxGoalRounds === goal.maxGoalRounds && team.autopilot.maxAdditionalRounds <= configuredBudget;
    if (!terminalGrants.every((team) => (recoverableLifecycle(team) || recoverableStop(team)) && exactTerminalScope(team))) return [];
  }
  const liveTeams = openTeams.filter((team) => ["pending_plan", "active"].includes(team.autopilot?.status));
  if (liveTeams.length === 0 && terminalGrants.length > 0) {
    const template = terminalGrants[0].autopilot;
    const wakeLedger = JSON.stringify(template.wakes);
    const inconsistent = terminalGrants.some((team) => {
      const grant = team.autopilot;
      return grant.baseMaxGoalRounds !== template.baseMaxGoalRounds || grant.expectedMaxGoalRounds !== template.expectedMaxGoalRounds
        || grant.maxAdditionalRounds !== template.maxAdditionalRounds || grant.additionalRoundsGranted !== template.additionalRoundsGranted
        || grant.baseMaxGoalRounds + grant.additionalRoundsGranted !== grant.expectedMaxGoalRounds
        || grant.additionalRoundsGranted > configuredBudget || JSON.stringify(grant.wakes) !== wakeLedger;
    });
    if (inconsistent || terminalGrants.some((team) => pendingAgentTeamAutopilotWake(team.autopilot) !== undefined)) return [];
    const proposals = openTeams.map((team) => {
      const binding = bindings.get(team.id);
      const restored = clone(team.autopilot ?? template);
      restored.grantId = randomUUID();
      restored.routingReceiptId = receipts.get(team.id).id;
      restored.authorizationEpoch = intent.authorizationEpoch;
      restored.status = binding.status;
      restored.pauseEpochAtGrant = team.pauseEpoch ?? 0;
      restored.planHashAtGrant = binding.planHash;
      restored.maxAdditionalRounds = configuredBudget;
      restored.lastStateHash = undefined;
      restored.grantedAt = now();
      restored.revokedAt = undefined;
      restored.revokeReason = undefined;
      restored.parkedGoalRevision = undefined;
      restored.parkedStateHash = undefined;
      restored.parkedAt = undefined;
      return [team, restored];
    });
    for (const [team, grant] of proposals) team.autopilot = grant;
    return openTeams;
  }
  if (liveTeams.length > 0) {
    const template = liveTeams[0].autopilot;
    const inconsistent = liveTeams.some((team) => {
      const grant = team.autopilot;
      return grant.authorizationEpoch !== intent.authorizationEpoch || grant.rootSessionId !== root.id
        || grant.projectKey !== intent.projectKey || grant.goalId !== goal.id
        || grant.goalObjectiveHash !== agentTeamAutopilotObjectiveHash(goal.objective)
        || grant.expectedMaxGoalRounds !== goal.maxGoalRounds || grant.pauseEpochAtGrant !== (team.pauseEpoch ?? 0)
        || grant.baseMaxGoalRounds !== template.baseMaxGoalRounds || grant.maxAdditionalRounds !== template.maxAdditionalRounds
        || grant.additionalRoundsGranted !== template.additionalRoundsGranted || grant.lastStateHash !== template.lastStateHash;
    });
    const terminalInconsistent = terminalGrants.some((team) => team.autopilot.baseMaxGoalRounds !== template.baseMaxGoalRounds
      || team.autopilot.expectedMaxGoalRounds !== template.expectedMaxGoalRounds
      || team.autopilot.maxAdditionalRounds !== template.maxAdditionalRounds
      || team.autopilot.additionalRoundsGranted !== template.additionalRoundsGranted
      || JSON.stringify(team.autopilot.wakes) !== JSON.stringify(template.wakes));
    const pendingWake = liveTeams.some((team) => pendingAgentTeamAutopilotWake(team.autopilot) !== undefined);
    if (inconsistent || terminalInconsistent || pendingWake || template.maxAdditionalRounds > configuredBudget) return [];
    const proposals = openTeams.filter((team) => team.autopilot === undefined || ["revoked", "exhausted"].includes(team.autopilot.status)).map((team) => {
      const inherited = clone(template);
      const binding = bindings.get(team.id);
      inherited.grantId = randomUUID();
      inherited.routingReceiptId = receipts.get(team.id).id;
      inherited.status = binding.status;
      inherited.pauseEpochAtGrant = team.pauseEpoch ?? 0;
      inherited.planHashAtGrant = binding.planHash;
      inherited.grantedAt = now();
      inherited.revokedAt = undefined;
      inherited.revokeReason = undefined;
      inherited.parkedGoalRevision = undefined;
      inherited.parkedStateHash = undefined;
      inherited.parkedAt = undefined;
      return [team, inherited];
    });
    for (const [team, grant] of proposals) team.autopilot = grant;
    return openTeams;
  }
  const proposals = openTeams.map((team) => {
    const binding = bindings.get(team.id);
    const grant = createAgentTeamAutopilotGrant(root, goal, {
      authorizationEpoch: intent.authorizationEpoch,
      planHash: binding.planHash,
      pauseEpoch: team.pauseEpoch ?? 0,
      routingReceiptId: receipts.get(team.id).id,
      maxAdditionalRounds: configuredBudget,
    });
    return grant === undefined ? undefined : [team, grant];
  });
  if (proposals.some((proposal) => proposal === undefined)) return [];
  for (const [team, grant] of proposals) team.autopilot = grant;
  return openTeams;
}
function directHumanAutopilotGrantGroup(ctx, document, selectedTeam, root, goal, intent, options = {}) {
  if (!isRecord(intent) || intent.turnKey !== currentTurnKey(root)) return [];
  let currentDirectHumanTurn = false;
  try { currentDirectHumanTurn = hasDirectHumanRootAuthority(ctx, { agent: root }); }
  catch { return []; }
  return currentDirectHumanTurn ? deriveDirectHumanAutopilotGrantGroup(document, selectedTeam, root, goal, intent, options) : [];
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
    || memberRecoveryBlocksAutopilot(team)) return false;
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
  autopilot.parkedStateHash = undefined;
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
  const before = storeReadView(store);
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
  disarmBoundAgentTeamGoal(ctx, root, storeReadView(store), boundGoalIds);
  if (liveAgentTeamAutopilotTeams(storeReadView(store), rootSessionId).length > 0) {
    changed = await store.mutate((document) => {
      let repeated = false;
      for (const team of document.teams) if (team.rootLeadSessionId === rootSessionId) repeated = revokeAgentTeamAutopilot(team, reason, status) || repeated;
      return repeated;
    }) || changed;
    disarmBoundAgentTeamGoal(ctx, root, storeReadView(store), boundGoalIds);
  }
  const finalDocument = storeReadView(store);
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
function automaticMemberRecoveryAttemptKey(teamId, requestId) {
  return JSON.stringify([teamId, requestId]);
}
function memberRecoveryBlocksAutopilot(team) {
  return (team.memberRecoveries ?? []).some((receipt) => {
    if (!["outcome_unknown", "prepared"].includes(receipt.status)) return false;
    if (receipt.status === "prepared" && receipt.dispatchOutcome === "not_started" && receipt.retryable === true) return false;
    const attempt = AUTOMATIC_MEMBER_RECOVERY_ATTEMPTS.get(automaticMemberRecoveryAttemptKey(team.id, receipt.requestId));
    return attempt === undefined || attempt.inputHash !== receipt.inputHash || attempt.rootSessionId !== team.rootLeadSessionId
      || attempt.memberId !== receipt.memberId || attempt.action !== receipt.action || attempt.expectedRevision !== receipt.teamRevision
      || attempt.pauseEpoch !== receipt.pauseEpoch;
  });
}
function teamHasSafeAutopilotAuthority(team, root) {
  if (effectiveTeamState(team) !== "active" || team.rootLeadSessionId !== root.id) return false;
  const projectKey = optionalProjectKeyForRoot(root);
  if (projectKey === undefined || team.projectKey !== projectKey) return false;
  return team.closure === undefined && team.handoff === undefined && teamHasEstablishedWorker(team)
    && planAuthorizationSupportsAutopilot(team) && planCapabilitiesAreVerified(team)
    && planFilesAreConflictFree(team) && planEffectsAreOrdinary(team)
    && !memberRecoveryBlocksAutopilot(team)
    && !(team.provisioningQueue ?? []).some((entry) => entry.status === "outcome_unknown");
}
function rootHasSafeAutopilotAuthority(document, root) {
  const owned = document.teams.filter((team) => team.rootLeadSessionId === root.id && effectiveTeamState(team) === "active");
  return owned.length > 0 && owned.every((team) => teamHasSafeAutopilotAuthority(team, root));
}
function rootCanAutonomouslyWait(document, root) {
  return rootCanWaitForWork(document, root, true);
}
function rootCanWaitForWork(document, root, requireAuthority) {
  const owned = document.teams.filter((team) => team.rootLeadSessionId === root.id && effectiveTeamState(team) === "active");
  if (owned.length === 0 || requireAuthority && !owned.every((team) => teamHasSafeAutopilotAuthority(team, root))) return false;
  const teamsById = new Map(document.teams.map((team) => [team.id, team]));
  const ownedById = new Map(owned.map((team) => [team.id, team]));
  let hasLiveProducer = false;
  const settled = new Map();
  const resolvesToLiveProducer = (team, task, visiting = new Set()) => {
    const key = taskNodeKey(team.id, task.id);
    if (settled.has(key)) return settled.get(key);
    if (visiting.has(key) || task.state === "submitted" || task.state === "cancelled") return false;
    if (taskSatisfiesDependency(task)) return true;
    if (!ownedById.has(team.id) || requireAuthority && !teamHasSafeAutopilotAuthority(team, root)) return false;
    const assignee = task.assigneeSessionId === undefined ? undefined : memberOf(team, task.assigneeSessionId);
    if (task.state === "in_progress") {
      const live = memberCanStillProduceTaskProgress(assignee);
      if (live) hasLiveProducer = true;
      settled.set(key, live);
      return live;
    }
    if (task.state !== "pending") return false;
    const queuedProvisioning = (team.provisioningQueue ?? []).some((entry) => entry.status === "queued" && entry.taskIds.includes(task.id));
    if (queuedProvisioning) {
      hasLiveProducer = true;
      settled.set(key, true);
      return true;
    }
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
// Passive observation holds the current authorized tool call. It never mutates
// a Goal, creates a wake, authorizes work, or resumes a paused team. In
// particular, it does not pretend a missing autopilot grant is valid.
function createTeamChangeWaiter(ctx, store) {
  const pending = new Map();
  let disposed = false;
  return {
    wait(root, teamId, signal) {
      if (disposed) reject("team observation is disposed", "AGENT_TEAMS_CLOSING");
      if (!signal || typeof signal.addEventListener !== "function") reject("passive waiting requires a cancellable tool turn", "AGENT_TEAMS_DRIVER_REQUIRED");
      const initial = storeReadView(store);
      const selected = resolveTeamForCaller(initial, optionalString(teamId, "teamId", 256), root.id);
      requireLiveRootLead(ctx, selected, root);
      const projectKey = projectKeyForRoot(root);
      if (pending.has(root.id)) reject("one passive wait is already pending for this root", "AGENT_TEAMS_WAIT_PENDING");
      return new Promise((resolve) => {
        let previous = initial, done = false, unsubscribe = () => {};
        const finish = (reason) => {
          if (done) return;
          done = true;
          unsubscribe();
          signal.removeEventListener("abort", onAbort);
          pending.delete(root.id);
          resolve({ reason, teamId: selected.id });
        };
        const onAbort = () => finish("cancelled");
        const inspect = (current) => {
          if (done) return;
          const team = current.teams.find(candidate => candidate.id === selected.id);
          if (ctx.agents.get(root.id) !== root || !ctx.agents.roots().includes(root)
            || projectKeyForRoot(root) !== projectKey || !team || team.rootLeadSessionId !== root.id
            || team.projectKey !== selected.projectKey) { finish("scope_changed"); return; }
          if (effectiveTeamState(team) !== "active") { finish("stopped"); return; }
          if (agentTeamAutopilotWakeRoots(previous, current).includes(root.id)) { finish("changed"); return; }
          // If no producer remains, return an actionable state rather than hang.
          // This completes the same tool call; it never allocates a Goal round.
          if (!rootCanWaitForWork(current, root, false)) { finish("attention"); return; }
          previous = current;
        };
        pending.set(root.id, finish);
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
        const observe = document => {
          try { inspect(document ?? storeReadView(store)); }
          catch { finish("unavailable"); }
        };
        try {
          unsubscribe = store.subscribe(observe);
          // Subscribe may synchronously deliver its initial snapshot.
          if (done) unsubscribe();
          if (signal.aborted) onAbort();
          else observe();
        } catch { finish("unavailable"); }
      });
    },
    dispose() {
      disposed = true;
      for (const finish of [...pending.values()]) finish("cancelled");
    },
  };
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
  const expansionMaterial = teams.flatMap((team) => pendingExpansionRequestMessages(team)
    .map((message) => ({ teamId: team.id, id: message.id, dedupeKey: message.dedupeKey })))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : left.teamId < right.teamId ? -1 : left.teamId > right.teamId ? 1 : 0);
  if (expansionMaterial.length > 0) {
    const stateHash = createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-expansion-v1", expansionMaterial])).digest("hex");
    return { kind: "review_expansion", stateHash, teams };
  }
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
function agentTeamAutopilotParkStateHash(document, root, goal, action, { reason, resetActionState = false } = {}) {
  if (root === undefined || goal === undefined || action === undefined || typeof reason !== "string" || reason.length === 0) return undefined;
  const teamIds = action.teams.map((team) => team.id).sort();
  if (teamIds.length === 0 || new Set(teamIds).size !== teamIds.length) return undefined;
  const byId = new Map(document.teams.map((team) => [team.id, team]));
  const teams = teamIds.map((teamId) => byId.get(teamId));
  if (teams.some((team) => team === undefined)) return undefined;
  const byStableId = (left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  const schedulerMaterial = teams.map((team) => ({
    id: team.id,
    pauseEpoch: team.pauseEpoch ?? 0,
    planHash: team.plan?.hash,
    grant: {
      status: team.autopilot?.status,
      grantId: team.autopilot?.grantId,
      routingReceiptId: team.autopilot?.routingReceiptId,
      authorizationEpoch: team.autopilot?.authorizationEpoch,
      rootSessionId: team.autopilot?.rootSessionId,
      projectKey: team.autopilot?.projectKey,
      goalId: team.autopilot?.goalId,
      pauseEpochAtGrant: team.autopilot?.pauseEpochAtGrant,
      planHashAtGrant: team.autopilot?.planHashAtGrant,
      baseMaxGoalRounds: team.autopilot?.baseMaxGoalRounds,
      expectedMaxGoalRounds: team.autopilot?.expectedMaxGoalRounds,
      maxAdditionalRounds: team.autopilot?.maxAdditionalRounds,
      additionalRoundsGranted: team.autopilot?.additionalRoundsGranted,
    },
    tasks: [...team.tasks].sort(byStableId).map((task) => {
      const derived = deriveTaskAcrossTeams(task, team, document.teams);
      return {
        id: task.id,
        state: task.state,
        assigneeSessionId: task.assigneeSessionId,
        claimId: task.claimId,
        leaseEpoch: task.leaseEpoch,
        dependencies: [...derived.dependencies].sort(),
        blockedBy: [...derived.blockedBy].sort(),
        failedBy: [...derived.failedBy].sort(),
        externalEffects: [...(task.externalEffects ?? [])].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
          .map((effect) => ({ name: effect.name, policy: effect.policy, outcome: effect.outcome, attemptId: effect.attemptId })),
      };
    }),
    members: team.members.filter((member) => member.kind === "worker").sort(byStableId).map((member) => ({
      id: member.id,
      sessionId: member.sessionId,
      state: member.state,
      runId: member.runId,
      shutdownUnconfirmed: member.shutdownUnconfirmed,
      stopUnconfirmed: member.stopUnconfirmed,
    })),
  }));
  const schedulerStateHash = createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-park-scheduler-v1", schedulerMaterial])).digest("hex");
  // Activation is deliberately absent: an armed Goal and the exact process-local
  // disarmed Goal produced by parking must share one durable park identity.
  return createHash("sha256").update(JSON.stringify(["agent-teams-autopilot-park-v1", {
    rootSessionId: root.id,
    goalId: goal.id,
    goalRevision: goal.revision,
    goalPhase: goal.phase,
    goalRoundsStarted: goal.roundsStarted,
    goalMaxGoalRounds: goal.maxGoalRounds,
    goalObjectiveHash: agentTeamAutopilotObjectiveHash(goal.objective),
    reason,
    actionKind: action.kind,
    actionStateHash: action.stateHash,
    schedulerStateHash,
    resetActionState,
    schedulerMaterial,
  }])).digest("hex");
}
function agentTeamAutopilotParkMatches(grants, goal, stateHash, { resetActionState = false } = {}) {
  if (grants.length === 0 || goal === undefined || stateHash === undefined) return false;
  const parkedAt = grants[0].autopilot?.parkedAt;
  return typeof parkedAt === "string" && grants.every((team) => team.autopilot?.parkedGoalRevision === goal.revision
    && team.autopilot.parkedStateHash === stateHash && team.autopilot.parkedAt === parkedAt
    && (!resetActionState || team.autopilot.lastStateHash === undefined));
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
    const beforeExpansionKeys = new Set(before === undefined ? [] : expansionRequestMessages(before).map((message) => message.dedupeKey));
    const expansionProposed = expansionRequestMessages(team).some((message) => !beforeExpansionKeys.has(message.dedupeKey));
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
    if (expansionProposed || submitted || failed || dependencyChanged) wake.add(team.rootLeadSessionId);
  }
  return [...wake];
}
function createAgentTeamAutopilot(ctx, store, ready = Promise.resolve(storeReadView(store)), authorizationProvider, options = {}) {
  let closed = false;
  let requested = false;
  let run;
  let request = () => {};
  const retryBaseMs = options.retryBaseMs ?? AGENT_TEAM_AUTOPILOT_RETRY_BASE_MS;
  const retryMaxMs = options.retryMaxMs ?? AGENT_TEAM_AUTOPILOT_RETRY_MAX_MS;
  const maxRetries = options.maxRetries ?? AGENT_TEAM_AUTOPILOT_MAX_RETRIES;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const parkNow = options.now ?? now;
  if (!Number.isSafeInteger(retryBaseMs) || retryBaseMs < 1 || !Number.isSafeInteger(retryMaxMs) || retryMaxMs < retryBaseMs
    || !Number.isSafeInteger(maxRetries) || maxRetries < 1 || typeof setTimer !== "function" || typeof clearTimer !== "function"
    || typeof parkNow !== "function") {
    throw new TypeError("agent-team autopilot retry options are invalid");
  }
  const retryStates = new Map();
  let observedDocument = storeReadView(store);
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
  const parkRootGoal = async (root, goal, { resetActionState = false, action, reason } = {}) => {
    if (!rootIsLive(root) || root.status !== "idle" || goal === undefined || action === undefined
      || typeof reason !== "string" || reason.length === 0) return false;
    const beforeDocument = storeReadView(store);
    const beforeAction = rootAgentTeamAutopilotAction(beforeDocument, root);
    const current = ctx.goals.get(root);
    if (!sameAutopilotAction(beforeAction, action) || current?.id !== goal.id || current.revision !== goal.revision
      || current.roundsStarted !== goal.roundsStarted || current.maxGoalRounds !== goal.maxGoalRounds
      || agentTeamAutopilotObjectiveHash(current.objective) !== agentTeamAutopilotObjectiveHash(goal.objective)
      || current.phase !== "active" || !["armed", "disarmed"].includes(current.activation)) return false;
    const beforeParkStateHash = agentTeamAutopilotParkStateHash(beforeDocument, root, current, beforeAction, { reason, resetActionState });
    if (current.activation === "disarmed"
      && agentTeamAutopilotParkMatches(activeGrantTeams(beforeDocument, root), current, beforeParkStateHash, { resetActionState })) {
      // A parked Goal is a state transition, not a heartbeat. Returning before
      // store.mutate prevents timestamp-only writes from publishing themselves.
      return true;
    }
    // Goal activation is process-local and can be consumed by the official driver.
    // Remove that authority synchronously, before the first await or durable parked
    // marker, so every crash prefix is disarmed rather than marker-only.
    if (current.activation === "armed") ctx.goals.disarm(root);
    const parkedGoal = ctx.goals.get(root);
    const exactPark = rootIsLive(root) && root.status === "idle" && parkedGoal?.id === current.id
      && parkedGoal.revision === current.revision && parkedGoal.phase === "active" && parkedGoal.activation === "disarmed"
      && parkedGoal.roundsStarted === current.roundsStarted && parkedGoal.maxGoalRounds === current.maxGoalRounds
      && agentTeamAutopilotObjectiveHash(parkedGoal.objective) === agentTeamAutopilotObjectiveHash(current.objective);
    const parkedStateHash = exactPark
      ? agentTeamAutopilotParkStateHash(beforeDocument, root, parkedGoal, beforeAction, { reason, resetActionState })
      : undefined;
    if (!exactPark || parkedStateHash === undefined) {
      await revokeRoot(root, "root changed while automatic continuation was being parked");
      return false;
    }
    let persisted;
    try {
      persisted = await store.mutate((draft) => {
        const mutationGoal = ctx.goals.get(root);
        const mutationAction = rootAgentTeamAutopilotAction(draft, root);
        const grants = activeGrantTeams(draft, root);
        const mutationStateHash = agentTeamAutopilotParkStateHash(draft, root, mutationGoal, mutationAction, { reason, resetActionState });
        if (!rootIsLive(root) || root.status !== "idle" || mutationGoal?.id !== parkedGoal.id
          || mutationGoal.revision !== parkedGoal.revision || mutationGoal.phase !== "active" || mutationGoal.activation !== "disarmed"
          || mutationGoal.roundsStarted !== parkedGoal.roundsStarted || mutationGoal.maxGoalRounds !== parkedGoal.maxGoalRounds
          || !sameAutopilotAction(mutationAction, action) || mutationStateHash !== parkedStateHash || grants.length === 0) return false;
        // A racing publication may have completed this exact park after the
        // pre-mutation check. Keep that race a store-level no-op as well.
        if (agentTeamAutopilotParkMatches(grants, mutationGoal, parkedStateHash, { resetActionState })) return true;
        const timestamp = parkNow();
        for (const team of grants) {
          team.autopilot.parkedGoalRevision = mutationGoal.revision;
          team.autopilot.parkedStateHash = parkedStateHash;
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
    const finalDocument = storeReadView(store);
    const finalAction = rootAgentTeamAutopilotAction(finalDocument, root);
    const finalStateHash = agentTeamAutopilotParkStateHash(finalDocument, root, finalGoal, finalAction, { reason, resetActionState });
    if (persisted !== true || !rootIsLive(root) || root.status !== "idle" || finalGoal?.id !== parkedGoal.id
      || finalGoal.revision !== parkedGoal.revision || finalGoal.phase !== "active" || finalGoal.activation !== "disarmed"
      || finalGoal.roundsStarted !== parkedGoal.roundsStarted || finalGoal.maxGoalRounds !== parkedGoal.maxGoalRounds
      || !sameAutopilotAction(finalAction, action) || finalStateHash !== parkedStateHash
      || !agentTeamAutopilotParkMatches(activeGrantTeams(finalDocument, root), finalGoal, parkedStateHash, { resetActionState })) {
      await revokeRoot(root, "automatic continuation park boundary changed before durable confirmation");
      return false;
    }
    return true;
  };
  const reconcileRoot = async (root) => {
    if (!rootIsLive(root)) return;
    // Store publications already deliver one committed snapshot that observers
    // treat as immutable. Reusing it avoids cloning an arbitrarily large closed
    // history again for every root; effect boundaries below still re-snapshot or
    // mutate with full race validation before they can change durable state.
    let document = observedDocument;
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
    const deliveredExpansionAwaitingRound = grants.every((team) => team.autopilot.wakes.some((wake) => wake.kind === "review_expansion"
      && wake.status === "delivered" && wake.roundsStarted === goal.roundsStarted));
    if (deliveredExpansionAwaitingRound) {
      // Marking the one-shot proposal wake delivered removes it from the action
      // hash. Keep the just-resumed Goal armed until its exact new round starts;
      // the delivery publication itself is never an empty waiting transition.
      // Any additional distinct proposal arriving before that turn starts joins
      // the already-admitted review round instead of spending another one.
      if (grants.some((team) => pendingExpansionRequestMessages(team).length > 0)) await store.mutate((draft) => {
        const timestamp = now();
        for (const team of activeGrantTeams(draft, root)) {
          let changed = false;
          for (const message of pendingExpansionRequestMessages(team)) { message.expansionWakeDeliveredAt = timestamp; changed = true; }
          if (changed) team.updatedAt = timestamp;
        }
      });
      if (wakeEvidenceByRoot.get(root.id) === wakeEvidence) wakeEvidenceByRoot.delete(root.id);
      return;
    }
    if (action?.kind === "waiting") {
      // Ordinary producer-owned waiting is parked rather than treated as a
      // blocker or a reason to spend another Goal round.
      await parkRootGoal(root, goal, { resetActionState: true, action, reason: "waiting" });
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
      await parkRootGoal(root, goal, { action, reason: "delivered_action" });
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
      await parkRootGoal(root, goal, { action, reason: "no_wake_evidence" });
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
          team.autopilot.parkedStateHash = undefined;
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
        if (currentGroup.wake.kind === "review_expansion") {
          for (const message of pendingExpansionRequestMessages(team)) message.expansionWakeDeliveredAt = deliveredAt;
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
    if (root.status === "idle") disarmBoundAgentTeamGoal(ctx, root, storeReadView(store));
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
    const current = document ?? storeReadView(store);
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
    const document = storeReadView(store);
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
  // Goal activation is intentionally process-local. Persisted team grants never
  // cross a lifecycle edge as live authority: recover any uncertain wake, disarm
  // the exact bound Goal, then revoke those grants locally before reconciliation.
  // The Desktop Host's durable global settings proof remains intact so a later
  // allowed direct-human create/plan/Resume boundary can safely derive the group
  // without asking for another per-team Save.
  void ready.then(async () => {
    for (const root of ctx.agents.roots()) if (rootIsLive(root)) {
      try { await recoverPendingWakeBeforeLifecycleRevoke(root); }
      catch (error) { ctx.logger.warn(`agent-teams autopilot startup wake recovery failed: ${String(error?.code ?? error?.message ?? error)}`); }
      const document = storeReadView(store);
      disarmBoundAgentTeamGoal(ctx, root, document);
    }
    await store.mutate((document) => {
      for (const team of document.teams) revokeAgentTeamAutopilot(team, AGENT_TEAM_AUTOPILOT_LIFECYCLE_REVOKE_REASON);
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
  return /^\[Agent team message (expansion:[a-f0-9]{64}|[0-9a-f-]{36}) from /u.exec(text)?.[1]
    ?? /^\[Structured agent-team expansion request (expansion:[a-f0-9]{64})\]/u.exec(text)?.[1];
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
// Stopping execution must not prevent an explicitly authorized root from
// discarding work. This capability is derived by the public handler, never an
// argument accepted from a model, and does not resume the team or its workers.
function requireTeamCleanupState(team, allowPausedCleanup) {
  if (allowPausedCleanup === true && (team.state === "paused" || USER_PAUSED_TEAMS.has(team.id))) return;
  requireActiveTeam(team);
}
function authorizePausedTeamCleanup(ctx, execution) {
  // No extra store read: it could let a queued message overtake shutdown.
  // Exact team ownership and Stop/OCC are checked inside the serialized write.
  return ctx.agents.get(execution.agent.id) === execution.agent
    && ctx.agents.roots().includes(execution.agent)
    && hasDirectHumanRootAuthority(ctx, execution);
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
function closeTeamRecord(team, reason = "team closed before transport acceptance was durably recorded", { forced = false, failures = [] } = {}) {
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
  team.provisioningQueue = [];
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
function queuedProvisioningReservations(team, excludeEntryId) {
  return (team.provisioningQueue ?? []).filter((entry) => entry.status === "queued" && entry.id !== excludeEntryId).length;
}
function queuedProvisioningReservationsForLead(document, rootLeadSessionId, excludeEntryId) {
  return document.teams.filter((team) => team.rootLeadSessionId === rootLeadSessionId && team.state !== "closed")
    .reduce((total, team) => total + queuedProvisioningReservations(team, excludeEntryId), 0);
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
  if (team === undefined) rejectWithNextAction("caller has no active team", "AGENT_TEAMS_NOT_FOUND", "complete or recover team creation first, then use the exact team_id returned by team_bootstrap/team_start before calling active-team tools");
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
  return `Coordinator registration complete. Team ${teamId}; member ${memberId}. You may now begin the assigned work.${taskNotice} Keep the claimId and leaseEpoch returned by claim; echo both on checkpoint, completion, or release so stale attempts cannot write. A report, message, or successful turn end does not complete a durable team task: immediately call team_task_update with action=complete after its deliverable is actually finished and before sending the final report; otherwise explicitly release it. Use agent-team tools for team tasks and coordinator relays. You cannot create or fork agents. At task start or the first bounded checkpoint, evaluate structural parallelism once: when the claimed task contains at least two sustained, independently deliverable workstreams, use team_expansion_request with explicit deliverables, acceptance criteria, and non-overlapping file/resource boundaries exactly once and immediately, while retaining a bounded integration slice yourself. Three or more independent resource domains that each require quantified or stress evidence are a strong trigger. Wall-clock duration alone never authorizes expansion. If the work is not genuinely parallel, record the concrete coupling reason in the first checkpoint instead. The request is a proposal only: the root coordinator decides whether to create persistent tasks and visible peer members without bypassing maxMembers or maxActiveTurns, and applies cost, capability/effect, ownership, Stop/revocation, and source-scope-restructure gates first. Duplicate or synonymous proposals are durable no-ops. Assignment:\n${prompt}`;
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
  const memberSlots = Math.max(0, document.settings.maxMembers - team.members.filter(workerConsumesMemberSlot).length - queuedProvisioningReservations(team));
  const recordedActiveTurns = activeWorkerTurnsForLead(document, team.rootLeadSessionId) + queuedProvisioningReservationsForLead(document, team.rootLeadSessionId);
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
async function submitExpansionRequest(ctx, store, admission, caller, input, signal, { platform = process.platform } = {}) {
  const teamId = optionalString(input.teamId, "teamId", 256);
  const normalized = normalizeExpansionRequest(input, { platform });
  const identity = await store.read((document) => {
    const team = resolveTeamForCaller(document, teamId, caller.id);
    const requester = authenticateParticipant(team, caller.id);
    if (requester.kind !== "worker" || !["running", "idle", "ready"].includes(requester.state)) {
      reject("team expansion requests require a current active worker", "AGENT_TEAMS_EXPANSION_WORKER_REQUIRED");
    }
    return { teamId: team.id, rootLeadSessionId: team.rootLeadSessionId };
  });
  return sendTeamMessage(ctx, store, admission, caller, {
    teamId: identity.teamId,
    recipientSessionId: identity.rootLeadSessionId,
    prepareMessage(document, sourceTeam, targetTeam, recipient) {
      if (targetTeam !== sourceTeam || recipient.sessionId !== sourceTeam.rootLeadSessionId || recipient.kind !== "lead") {
        reject("expansion request must target the fixed root lead", "AGENT_TEAMS_UNAUTHORIZED");
      }
      const requester = authenticateParticipant(sourceTeam, caller.id);
      const dedupeKey = expansionRequestIdentity(sourceTeam.id, requester, normalized);
      const existing = expansionRequestMessages(sourceTeam).find((message) => message.dedupeKey === dedupeKey
        || (message.expansionRequest.requestedBy?.sessionId === requester.sessionId
          && expansionRequestsSemanticallyEquivalent(message.expansionRequest, normalized, { platform })));
      if (existing !== undefined) return {
        kind: "expansion_request", dedupeKey: existing.dedupeKey, expansionRequest: clone(existing.expansionRequest), message: existing.body,
        result: { expansionRequest: projectExpansionRequest(existing.expansionRequest), deduplicated: true },
      };
      const checked = validateExpansionRequestForDelivery(document, sourceTeam, caller, normalized);
      const request = {
        id: `expansion:${dedupeKey}`,
        teamId: sourceTeam.id,
        sourceTaskId: checked.sourceTask.id,
        sourceTaskTitle: checked.sourceTask.title,
        requestedBy: { memberId: checked.requester.id, sessionId: checked.requester.sessionId, name: checked.requester.name },
        parallelBenefit: normalized.parallelBenefit,
        workstreams: normalized.workstreams,
        capacity: checked.capacity,
        requestedAt: now(),
      };
      return { kind: "expansion_request", dedupeKey, expansionRequest: request, message: expansionRequestRelayBody(request), result: { expansionRequest: projectExpansionRequest(request), deduplicated: false } };
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
        if (input.routingReceiptId !== undefined) {
          const receipt = document.routingReceipts.find((candidate) => candidate.id === input.routingReceiptId);
          const outcome = receipt !== undefined && !routingReceiptIsPending(receipt) && ["created", "reused"].includes(receipt.outcome) && receipt.teamId === existing.id ? receipt.outcome : "reused";
          finalizeRoutingReceiptForTeam(document, input.routingReceiptId, existing, outcome);
        }
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
      provisioningQueue: [],
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
function assertExactAutomaticGoalRound(ctx, lead, authority, action = "automatic plan recommit") {
  if (!isRecord(authority)) reject(`${action} requires the exact admitted Goal round`, "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  const exact = exactGoalRoundRootAuthority(ctx, { agent: lead, turnKey: authority.turnKey });
  if (exact === undefined) {
    reject(`${action} requires the exact admitted Goal round`, "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  }
  if (exact.projectKey !== authority.projectKey) {
    reject(`${action} requires the same canonical project scope`, "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN");
  }
  if (Object.keys(exact).some((key) => exact[key] !== authority[key])) {
    reject(`${action} requires the exact admitted Goal round`, "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
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
      || memberRecoveryBlocksAutopilot(candidate)) {
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
function assertAutomaticMemberRecoveryAllowed(ctx, document, team, lead, authority) {
  requireLiveRootLead(ctx, team, lead);
  requireActiveTeam(team);
  const goal = assertExactAutomaticGoalRound(ctx, lead, authority, "automatic member recovery");
  const grantGroup = automaticPlanRecommitGrantGroup(document, team, lead, goal, authority);
  if (team.autopilot?.status !== "active" || !grantGroup.includes(team)) {
    reject("automatic member recovery requires the exact complete active autopilot grant group", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  }
  const invalidReason = grantGroup.map((candidate) => agentTeamAutopilotInvalidReason(candidate, lead, goal, document.settings)).find((reason) => reason !== undefined);
  if (invalidReason !== undefined || !teamHasSafeAutopilotAuthority(team, lead)) {
    reject(`automatic member recovery authority changed${invalidReason === undefined ? "" : `: ${invalidReason}`}`, "AGENT_TEAMS_AUTOPILOT_SCOPE_CHANGED");
  }
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
    candidate.autopilot.parkedStateHash = undefined;
    candidate.autopilot.parkedAt = undefined;
    candidate.updatedAt = timestamp;
  }
  if (team.autopilot.status === "active" || teamHasEstablishedWorker(team)) {
    team.autopilot.status = "active";
    team.autopilot.planHashAtGrant = planHash;
  }
}

async function commitTeamPlan(ctx, store, lead, input) {
  // A non-admitted ordinary/relay turn has no Host-derived Goal authority to
  // validate. Reject that predictable absence before the fail-closed recovery
  // catch so an already safe grant and its delivered wake remain available to
  // the next exact Goal round. Any supplied authority is still revalidated
  // inside the transaction, where scope, Goal, pause, epoch, and plan risks
  // continue to revoke the live grant on failure.
  if (input.automaticContinuation === true && input.automaticGoalRoundAuthority === undefined) {
    reject("automatic plan recommit requires the exact admitted Goal round", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  }
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
      else {
        const grantGroup = directHumanAutopilotGrantGroup(ctx, document, team, lead, input.autopilotGoal, input.directHumanGrantIntent);
        if (grantGroup.length > 0) rebindAutomaticPlanGrantGroup(grantGroup, team, currentHash);
        else if (bindAgentTeamAutopilotPlan(team, input.autopilotGoal)) team.updatedAt = now();
      }
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
    else {
      const grantGroup = directHumanAutopilotGrantGroup(ctx, document, team, lead, input.autopilotGoal, input.directHumanGrantIntent);
      if (grantGroup.length > 0) rebindAutomaticPlanGrantGroup(grantGroup, team, currentHash);
      else bindAgentTeamAutopilotPlan(team, input.autopilotGoal);
    }
    team.updatedAt = timestamp;
    return { teamId: team.id, plan: clone(team.plan), reused: false };
    }));
  } catch (error) {
    if (input.automaticContinuation === true && liveAgentTeamAutopilotTeams(storeReadView(store), lead.id).length > 0) {
      await revokeRootAgentTeamAutopilot(ctx, store, lead, `automatic plan recommit failed closed: ${error?.code ?? "invalid plan authority"}`, "revoked", input.authorizationProvider);
    }
    throw error;
  }
}
function projectScopeForRoot(root) {
  const cwd = root?.session?.header?.cwd;
  if (typeof cwd !== "string" || cwd.trim().length === 0 || !isAbsolute(cwd)) rejectWithNextAction("project workspace is unavailable or is not an absolute Host path", "AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN", "open the exact existing project workspace in the root session before creating or spawning team members");
  // This value is an I/O identity. Never apply Unicode compatibility
  // normalization or case folding to a real workspace path: e.g. NFKC turns
  // the valid full-width comma `，` into `,` and can silently target a sibling.
  return resolve(cwd);
}
function projectScopeKeyForRoot(root) {
  const canonicalPath = projectScopeForRoot(root).replace(/\\/gu, "/");
  // The comparison/hash key may normalize platform separators and Windows case,
  // but deliberately preserves every Unicode code point from the real path so
  // compatibility-equivalent sibling directories remain distinct projects.
  return process.platform === "win32" ? canonicalPath.toLocaleLowerCase("en-US") : canonicalPath;
}
function projectKeyForRoot(root) {
  return createHash("sha256").update(JSON.stringify(["agent-teams-project-v1", projectScopeKeyForRoot(root)])).digest("hex");
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
  if (team.projectKey === undefined) rejectWithNextAction("team has no canonical project identity for member workspace binding", "AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN", "recreate or safely migrate the team from the exact existing root workspace before spawning a member");
  if (projectKeyForRoot(lead) !== team.projectKey) rejectWithNextAction("team canonical project identity no longer matches the spawning root workspace", "AGENT_TEAMS_CROSS_PROJECT_FORBIDDEN", "return to the exact root workspace that created the team; never substitute a compatibility-normalized or sibling path");
  const workspace = projectScopeForRoot(lead);
  let children;
  try { children = readdirSync(workspace, { withFileTypes: true }); }
  catch { rejectWithNextAction("Host workspace cannot be inspected for task file-scope binding", "AGENT_TEAMS_PROJECT_SCOPE_UNKNOWN", "open or restore the exact original workspace path and replay the same safe bootstrap/spawn request; do not create a junction or copy"); }
  for (const anchor of taskWorkspaceAnchors(tasks)) {
    if (existsSync(join(workspace, anchor))) continue;
    const siblingMatches = children.filter((entry) => entry.isDirectory() && existsSync(join(workspace, entry.name, anchor)));
    if (siblingMatches.length > 0) rejectWithNextAction(`task file scope anchor ${JSON.stringify(anchor)} exists only below ${siblingMatches.length} child workspace candidate(s)`, "AGENT_TEAMS_WORKSPACE_SCOPE_AMBIGUOUS", "open one exact child workspace as the root cwd before spawning; never guess between sibling worktrees");
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
  if (!Array.isArray(input.tasks) || input.tasks.length < 1 || input.tasks.length > MAX_BOOTSTRAP_TASKS) rejectWithNextAction(`bootstrap tasks must be an array containing 1 through ${MAX_BOOTSTRAP_TASKS} durable items; task count is independent from the managed-member limit`, "AGENT_TEAMS_INVALID_BOOTSTRAP", "supply the complete bounded task array, assigning multiple sequential tasks to one member when appropriate, then replay the same request_id before using active-team tools");
  if (!Array.isArray(input.members) || input.members.length < 1 || input.members.length > MAX_BOOTSTRAP_ITEMS) rejectWithNextAction(`bootstrap members must be an array containing 1 through ${MAX_BOOTSTRAP_ITEMS} visible managed peers; the root lead does not consume a managed-member slot`, "AGENT_TEAMS_INVALID_BOOTSTRAP", "supply only the justified visible peer members and map every task to one member_key, then replay the same request_id");
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
function bootstrapPreflightNextAction(error) {
  if (error?.nextAction !== undefined) return error.nextAction;
  if (["AGENT_TEAMS_INVALID_BOOTSTRAP", "AGENT_TEAMS_BOOTSTRAP_SCOPE_CONFLICT", "AGENT_TEAMS_DUPLICATE_MEMBER_NAME"].includes(error?.code)) return "correct the bounded task/member plan and replay the same request_id before calling team_status, team_spawn, or other active-team tools";
  if (error?.code === "AGENT_TEAMS_IDEMPOTENCY_CONFLICT") return "reuse byte-equivalent input with this request_id, or choose a new request_id in a new authorized root turn";
  if (["AGENT_TEAMS_MEMBER_LIMIT", "AGENT_TEAMS_ACTIVE_TURN_LIMIT"].includes(error?.code)) return "reduce the visible peer count or explicitly raise the corresponding global capacity, then retry from a new authorized root turn";
  if (error?.code === "AGENT_TEAMS_TEAM_LIMIT") return "close an unneeded peer team before retrying from a new authorized root turn";
  return "fix the reported preflight condition and replay the exact safe bootstrap request before using active-team tools";
}
async function preflightBootstrapTeam(ctx, store, lead, input) {
  let plan;
  try {
    plan = normalizeBootstrapInput(input);
    requireExactRootAgent(ctx, lead);
    const mainSelection = await resolveModelSelection(store, "main", undefined, lead.options);
    await Promise.all(plan.members.map((member) => resolveModelSelection(store, member.modelTier, member.model, lead.options)));
    await store.read((document) => {
      assertEnabled(document);
      const existing = document.teams.find((team) => team.rootLeadSessionId === lead.id && team.bootstrap?.requestId === plan.requestId);
      if (existing !== undefined) {
        requireLiveRootLead(ctx, existing, lead);
        if (existing.bootstrap.inputHash !== plan.inputHash) reject("bootstrap request_id was already used with different input", "AGENT_TEAMS_IDEMPOTENCY_CONFLICT");
        requireActiveTeam(existing);
        assertSpawnWorkspacePreflight(existing, lead, plan.tasks.map((task) => ({ id: task.key, files: task.files })));
        return;
      }
      if (document.teams.filter((team) => team.rootLeadSessionId === lead.id && team.state !== "closed").length >= HARD_MAX_TEAMS_PER_ROOT) reject(`root lead peer-team limit reached (${HARD_MAX_TEAMS_PER_ROOT})`, "AGENT_TEAMS_TEAM_LIMIT");
      if (plan.members.length > document.settings.maxMembers) reject(`bootstrap requests ${plan.members.length} managed peers but maxMembers is ${document.settings.maxMembers}; the root lead does not consume a managed-member slot`, "AGENT_TEAMS_MEMBER_LIMIT");
      if (activeWorkerTurnsForLead(document, lead.id) + plan.members.length > document.settings.maxActiveTurns) reject(`bootstrap requests ${plan.members.length} new active peer turns but only ${Math.max(0, document.settings.maxActiveTurns - activeWorkerTurnsForLead(document, lead.id))} are available; the root lead is not counted`, "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
      const projectKey = projectKeyForRoot(lead);
      assertSpawnWorkspacePreflight({ projectKey }, lead, plan.tasks.map((task) => ({ id: task.key, files: task.files })));
    });
    return { plan, mainSelection };
  } catch (error) {
    throw annotateNextAction(error, bootstrapPreflightNextAction(error));
  }
}
async function bootstrapTeam(ctx, store, admission, lead, input, signal, checked) {
  const { plan, mainSelection } = checked ?? await preflightBootstrapTeam(ctx, store, lead, input);
  const prepared = await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const existing = document.teams.find((team) => team.rootLeadSessionId === lead.id && team.bootstrap?.requestId === plan.requestId);
    if (existing !== undefined) {
      requireLiveRootLead(ctx, existing, lead);
      if (existing.bootstrap.inputHash !== plan.inputHash) reject("bootstrap request_id was already used with different input", "AGENT_TEAMS_IDEMPOTENCY_CONFLICT");
      requireActiveTeam(existing);
      // Reuse is still non-terminal while a prior Bootstrap is partial. The
      // public wrapper finalizes only after it sees a complete result, so an
      // exact recovery cannot be trapped behind a premature terminal receipt.
      return { teamId: existing.id, reused: true };
    }
    if (document.teams.filter((team) => team.rootLeadSessionId === lead.id && team.state !== "closed").length >= HARD_MAX_TEAMS_PER_ROOT) reject(`root lead peer-team limit reached (${HARD_MAX_TEAMS_PER_ROOT})`, "AGENT_TEAMS_TEAM_LIMIT");
    if (plan.members.length > document.settings.maxMembers) rejectWithNextAction(`bootstrap requests ${plan.members.length} managed peers but maxMembers is ${document.settings.maxMembers}; the root lead does not consume a managed-member slot`, "AGENT_TEAMS_MEMBER_LIMIT", "reduce the peer count or explicitly raise maxMembers, then retry from a new authorized root turn");
    if (activeWorkerTurnsForLead(document, lead.id) + plan.members.length > document.settings.maxActiveTurns) rejectWithNextAction(`bootstrap requests ${plan.members.length} new active peer turns but only ${Math.max(0, document.settings.maxActiveTurns - activeWorkerTurnsForLead(document, lead.id))} are available; the root lead is not counted`, "AGENT_TEAMS_ACTIVE_TURN_LIMIT", "reduce simultaneous peers or explicitly raise maxActiveTurns, then retry from a new authorized root turn");
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
      provisioningQueue: [],
      bootstrap: { requestId: plan.requestId, inputHash: plan.inputHash, phase: "prepared", taskRefs: plan.tasks.map((task) => ({ key: task.key, taskId: taskIds.get(task.key) })), memberRefs: plan.members.map((member) => ({ key: member.key, name: member.name, status: "pending" })), createdAt: timestamp, updatedAt: timestamp },
    };
    const bootstrapPlanHash = teamPlanHash(team);
    team.plan = {
      phase: "committed", revision: 1, hash: bootstrapPlanHash, committedAt: timestamp, migrationState: "ready",
      authorization: { source: "human_attested", attestedAt: timestamp, confirmedPlanHash: bootstrapPlanHash, permissions: "human_attested", files: "human_attested", cost: "human_attested", externalSideEffects: "human_attested" },
    };
    if (autopilotGrant !== undefined) team.autopilot = autopilotGrant;
    document.teams.push(team);
    // The durable team and all tasks exist, but routing is not yet terminal:
    // the first fully published worker must complete its work followup before
    // this Bootstrap can truthfully finalize as created.
    return { teamId, reused: false };
  }));
  for (const memberPlan of plan.members) {
    const state = await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, prepared.teamId), ref = team.bootstrap.memberRefs.find((candidate) => candidate.key === memberPlan.key);
      requireActiveTeam(team);
      if (ref.status === "complete") return { skip: true };
      if (ref.status === "starting" && ref.memberId !== undefined) {
        const member = team.members.find((candidate) => candidate.id === ref.memberId);
        if (member !== undefined) return { blocked: true, error: { code: "AGENT_TEAMS_BOOTSTRAP_UNCERTAIN", stage: "member-reconcile", retryable: false, nextAction: "inspect the exact member/task state and reconcile or recover that member; never replay an uncertain child start" } };
      }
      if (ref.status === "failed" && ref.memberId !== undefined) return { blocked: true, error: { code: ref.errorCode ?? "AGENT_TEAMS_BOOTSTRAP_PARTIAL", stage: ref.errorStage ?? "member-start", retryable: false, nextAction: "use team_member_recover for the returned failed member, preserving the durable tasks; do not replay bootstrap to create a duplicate" } };
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
      const retryable = team.bootstrap.memberRefs.find((ref) => ref.key === memberPlan.key).memberId === undefined;
      return bootstrapResult(team, prepared.reused, {
        code: cause?.code ?? "AGENT_TEAMS_BOOTSTRAP_FAILED",
        stage,
        retryable,
        nextAction: retryable
          ? "fix the reported pre-publication condition and replay this exact request_id; all durable tasks remain persisted and no member was published"
          : "inspect the returned failed member and use team_member_recover/reconcile; never replay bootstrap to duplicate an uncertain or published child",
      });
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
        for (const task of team.tasks) if (task.state === "pending" && task.assigneeSessionId === `provisioning:${record.id}`) {
          task.assigneeSessionId = undefined;
          task.updatedAt = record.updatedAt;
          bumpTaskRevision(task);
        }
        if (cleanup.queueEntryId !== undefined) team.provisioningQueue = (team.provisioningQueue ?? []).filter((entry) => entry.id !== cleanup.queueEntryId);
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
    const causeCode = boundedDiagnosticCode(cleanup.cause, "AGENT_TEAMS_SPAWN_FAILED");
    const drainCode = drainError === undefined ? undefined : boundedDiagnosticCode(drainError, "AGENT_TEAMS_DRAIN_FAILED");
    const occupancy = cleanup.admission;
    const outcomeUnknown = drainError !== undefined;
    for (const task of team.tasks) if (task.state === "pending" && (task.assigneeSessionId === cleanup.childId || task.assigneeSessionId === `provisioning:${cleanup.memberId}`)) {
      task.assigneeSessionId = outcomeUnknown ? cleanup.childId : undefined;
      task.updatedAt = record.updatedAt;
      bumpTaskRevision(task);
      boundedPush(task.interruptionHistory, { kind: "member_start_failed", at: record.updatedAt, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0, reason: cleanup.phase, errorCode: drainCode ?? causeCode, errorStage: cleanup.phase, retryable: false, ...(occupancy === undefined ? {} : { admission: occupancy }) }, MAX_TASK_INTERRUPTION_HISTORY);
    }
    const failure = cleanup.phase === "publication" ? "publication failed after child creation" : "initial work followup failed after child became live";
    if (cleanup.queueEntryId !== undefined) {
      if (!outcomeUnknown) team.provisioningQueue = (team.provisioningQueue ?? []).filter((entry) => entry.id !== cleanup.queueEntryId);
      else {
        const entry = (team.provisioningQueue ?? []).find((candidate) => candidate.id === cleanup.queueEntryId);
        if (entry !== undefined) {
          entry.status = "outcome_unknown";
          entry.errorCode = drainCode ?? causeCode;
          entry.errorStage = cleanup.phase;
          entry.updatedAt = record.updatedAt;
        }
      }
    }
    if (drainError === undefined) {
      record.shutdownUnconfirmed = false;
      record.stopUnconfirmed = false;
      record.error = `${failure} after confirmed drain (${causeCode})`;
    } else {
      record.shutdownUnconfirmed = true;
      record.stopUnconfirmed = true;
      record.error = `${failure}; cleanup drain remains unconfirmed (${causeCode}/${drainCode})`;
    }
    team.updatedAt = record.updatedAt;
  }));
  return { drained: drainError === undefined, drainSkipped: false };
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
function provisioningQueueInputHash(reservation) {
  return createHash("sha256").update(JSON.stringify([
    "agent-teams-provisioning-queue-v1", reservation.teamId, reservation.memberId, reservation.childId,
    reservation.name, reservation.role, reservation.prompt, reservation.taskIds,
    reservation.pauseEpoch, reservation.planRevision, reservation.planHash,
    reservation.provider, reservation.model, reservation.modelTier, reservation.inheritsMain, reservation.routeSource,
  ])).digest("hex");
}
function queueableProvisioningAdmissionFailure(error) {
  return ["AGENT_TEAMS_ADMISSION_TIMEOUT", "AGENT_TEAMS_ADMISSION_QUEUE_FULL"].includes(error?.code);
}
function requeueProvisioningEntry(entry, admission, timestamp, errorCode, errorStage = "admission") {
  entry.status = "queued";
  entry.admissionGeneration = undefined;
  entry.admissionEpoch = admission?.epoch?.() ?? entry.admissionEpoch;
  entry.retryAfterRelease = (admission?.releaseSequence?.() ?? entry.retryAfterRelease ?? 0) + 1;
  entry.errorCode = errorCode;
  entry.errorStage = errorStage;
  entry.updatedAt = timestamp;
}
async function spawnMember(ctx, store, admission, lead, input, signal) {
  const queuedProvisioningId = optionalString(input.queuedProvisioningId, "queuedProvisioningId", 256);
  const modelSelection = queuedProvisioningId === undefined ? await resolveModelSelection(store, input.modelTier ?? "subagent", input.model, lead.options) : undefined;
  const reservation = await store.runOperation(() => store.mutate((document) => {
    assertEnabled(document);
    const team = optionalString(input.teamId, "teamId", 256) === undefined ? resolveUniqueLeadTeam(document, undefined, lead.id, (candidate) => candidate.state === "active") : findTeam(document, input.teamId);
    requireLiveRootLead(ctx, team, lead);
    requireActiveTeam(team);
    const queuedEntry = queuedProvisioningId === undefined ? undefined : (team.provisioningQueue ?? []).find((entry) => entry.id === queuedProvisioningId);
    if (queuedProvisioningId !== undefined && queuedEntry === undefined) reject("queued provisioning intent no longer exists", "AGENT_TEAMS_NOT_FOUND");
    if (queuedEntry !== undefined) {
      if (queuedEntry.status !== "queued") reject("queued provisioning intent is already active or unresolved", "AGENT_TEAMS_CONFLICT");
      if (queuedEntry.pauseEpoch !== (team.pauseEpoch ?? 0) || queuedEntry.planRevision !== team.plan?.revision || queuedEntry.planHash !== team.plan?.hash || team.plan.hash !== teamPlanHash(team)) reject("queued provisioning intent no longer matches the exact team plan", "AGENT_TEAMS_STALE_PLAN");
      if (queuedEntry.admissionEpoch !== input.queueAdmissionEpoch || queuedEntry.admissionEpoch !== admission.epoch?.()
        || queuedEntry.retryAfterRelease > input.queueReleaseSequence || input.queueReleaseSequence > (admission.releaseSequence?.() ?? -1)) reject("queued provisioning intent requires a new exact capacity-release transition", "AGENT_TEAMS_ADMISSION_HANDSHAKE_PENDING");
    }
    if (team.members.filter(workerConsumesMemberSlot).length + queuedProvisioningReservations(team, queuedProvisioningId) >= document.settings.maxMembers) reject("team teammate limit reached", "AGENT_TEAMS_MEMBER_LIMIT");
    if (activeWorkerTurnsForLead(document, team.rootLeadSessionId) + queuedProvisioningReservationsForLead(document, team.rootLeadSessionId, queuedProvisioningId) >= document.settings.maxActiveTurns) reject("root lead active-turn limit reached across its teams", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
    const memberName = normalizeWorkerName(queuedEntry?.name ?? input.name);
    const memberNameIdentity = memberNameKey(memberName);
    if (team.members.some((member) => memberNameKey(member.name) === memberNameIdentity)
      || (team.provisioningQueue ?? []).some((entry) => entry.id !== queuedProvisioningId && memberNameKey(entry.name) === memberNameIdentity)) reject("a team member or queued peer already uses this normalized display name", "AGENT_TEAMS_DUPLICATE_MEMBER_NAME");
    const taskIds = queuedEntry?.taskIds ?? input.taskIds ?? [];
    assertStringArray(taskIds, "taskIds");
    if (taskIds.length === 0) reject("public spawn requires a non-empty task_ids binding", "AGENT_TEAMS_TASK_BINDING_REQUIRED");
    if (queuedEntry === undefined && (team.provisioningQueue ?? []).some((entry) => entry.taskIds.some((taskId) => taskIds.includes(taskId)))) reject("one or more spawn tasks already have a durable provisioning intent", "AGENT_TEAMS_PROVISIONING_QUEUED");
    const tasks = [...new Set(taskIds)].map((taskId) => {
      const task = team.tasks.find((candidate) => candidate.id === taskId);
      if (task === undefined || task.state !== "pending" || task.assigneeSessionId !== undefined) reject("spawn tasks must be persisted, pending, and unassigned", "AGENT_TEAMS_TASK_CONFLICT");
      return task;
    });
    assertTaskExecutionPreflight(team, tasks);
    assertSpawnWorkspacePreflight(team, lead, tasks);
    if (!["host_verified", "human_attested"].includes(team.plan.authorization?.cost)) reject("member route cost is unknown; recommit the exact plan hash", "AGENT_TEAMS_COST_UNKNOWN");
    const timestamp = now();
    const memberId = queuedEntry?.memberId ?? randomUUID();
    const placeholderSessionId = `provisioning:${memberId}`;
    const selection = queuedEntry === undefined ? modelSelection : {
      ...(queuedEntry.model === undefined ? {} : { model: queuedEntry.model }),
      ...(queuedEntry.provider === undefined ? {} : { provider: queuedEntry.provider }),
      modelTier: queuedEntry.modelTier,
      inheritsMain: queuedEntry.inheritsMain,
      routeSource: queuedEntry.routeSource,
    };
    const reservation = {
      teamId: team.id, memberId, childId: queuedEntry?.childId ?? randomUUID(), placeholderSessionId, name: memberName,
      role: nonEmptyString(queuedEntry?.role ?? input.role, "role", 500), prompt: nonEmptyString(queuedEntry?.prompt ?? input.prompt, "prompt", 65_536),
      taskIds: tasks.map((task) => task.id), pauseEpoch: team.pauseEpoch ?? 0, planRevision: team.plan.revision, planHash: team.plan.hash,
      ...(queuedEntry === undefined ? {} : { queuedProvisioningId: queuedEntry.id }), ...selection,
    };
    if (queuedEntry !== undefined) {
      queuedEntry.status = "provisioning";
      queuedEntry.admissionGeneration = undefined;
      queuedEntry.updatedAt = timestamp;
    }
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
        const timestamp = now();
        if (reservation.queuedProvisioningId === undefined) confirmMemberRetired(record);
        else {
          team.members = team.members.filter((candidate) => candidate.id !== reservation.memberId);
          const entry = (team.provisioningQueue ?? []).find((candidate) => candidate.id === reservation.queuedProvisioningId);
          if (entry !== undefined) requeueProvisioningEntry(entry, admission, timestamp, "AGENT_TEAMS_CLOSING", "preflight");
        }
        for (const task of team.tasks) if (task.state === "pending" && task.assigneeSessionId === reservation.placeholderSessionId) {
          task.assigneeSessionId = undefined;
          task.updatedAt = timestamp;
          bumpTaskRevision(task);
          boundedPush(task.interruptionHistory, { kind: "stop_before_provisioning", at: timestamp, attempt: task.attempt ?? 0, leaseEpoch: task.leaseEpoch ?? 0 }, MAX_TASK_INTERRUPTION_HISTORY);
        }
        team.updatedAt = timestamp;
      }
      return false;
    }));
    if (!admitted) reject("team stopped accepting members before provisioning started", "AGENT_TEAMS_CLOSING");
    let started;
    let startDispatchBegan = false;
    let exactAdmissionGeneration;
    try {
      started = await admission.run(lead, reservation.childId, signal, async () => {
        const exactLease = admission.current?.(reservation.childId);
        exactAdmissionGeneration = exactLease?.generation;
        if (reservation.queuedProvisioningId !== undefined) {
          if (!Number.isSafeInteger(exactLease?.generation)) reject("queued provisioning acquired no exact admission generation", "AGENT_TEAMS_ADMISSION_HANDSHAKE_PENDING");
          await store.runOperation(() => store.mutate((document) => {
            const team = findTeam(document, reservation.teamId);
            const entry = (team.provisioningQueue ?? []).find((candidate) => candidate.id === reservation.queuedProvisioningId);
            const record = team.members.find((candidate) => candidate.id === reservation.memberId);
            if (effectiveTeamState(team) !== "active" || entry?.status !== "provisioning" || record?.sessionId !== reservation.placeholderSessionId || record.state !== "provisioning") reject("queued provisioning changed before exact dispatch fence", "AGENT_TEAMS_STALE_PLAN");
            entry.status = "dispatching";
            entry.admissionGeneration = exactLease.generation;
            entry.attempt += 1;
            entry.errorCode = undefined;
            entry.errorStage = undefined;
            entry.updatedAt = now();
            team.updatedAt = entry.updatedAt;
          }));
          reservation.admissionGeneration = exactLease.generation;
        }
        requireExactRootAgent(ctx, lead);
        startDispatchBegan = true;
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
      const notStarted = !startDispatchBegan;
      const errorCode = boundedDiagnosticCode(error, "AGENT_TEAMS_SPAWN_FAILED");
      const errorStage = notStarted ? "admission" : "provisioning_dispatch";
      const occupancy = admissionDiagnostic(admission);
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, reservation.teamId);
        const record = team.members.find((candidate) => candidate.id === reservation.memberId);
        const timestamp = now();
        let queueEntry = reservation.queuedProvisioningId === undefined ? undefined : (team.provisioningQueue ?? []).find((candidate) => candidate.id === reservation.queuedProvisioningId);
        if (notStarted) {
          team.members = team.members.filter((candidate) => candidate.id !== reservation.memberId);
          if (queueEntry !== undefined) requeueProvisioningEntry(queueEntry, admission, timestamp, errorCode, errorStage);
          else if (queueableProvisioningAdmissionFailure(error) && effectiveTeamState(team) === "active" && team.autopilot?.status === "active") {
            const queued = {
              id: randomUUID(), inputHash: provisioningQueueInputHash(reservation),
              enqueueSequence: Math.max(0, ...document.teams.flatMap((candidate) => (candidate.provisioningQueue ?? []).map((entry) => entry.enqueueSequence ?? 0))) + 1,
              status: "queued", memberId: reservation.memberId, childId: reservation.childId, name: reservation.name, role: reservation.role, prompt: reservation.prompt,
              taskIds: [...reservation.taskIds], pauseEpoch: reservation.pauseEpoch, planRevision: reservation.planRevision, planHash: reservation.planHash,
              ...(reservation.provider === undefined ? {} : { provider: reservation.provider }), ...(reservation.model === undefined ? {} : { model: reservation.model }),
              modelTier: reservation.modelTier, inheritsMain: reservation.inheritsMain, routeSource: reservation.routeSource,
              admissionEpoch: admission.epoch?.() ?? "legacy-admission", retryAfterRelease: (admission.releaseSequence?.() ?? 0) + 1,
              attempt: 0, errorCode, errorStage, createdAt: timestamp, updatedAt: timestamp,
            };
            team.provisioningQueue ??= [];
            team.provisioningQueue.push(queued);
            queueEntry = queued;
          }
        } else if (record !== undefined) {
          record.sessionId = reservation.childId;
          record.state = "failed";
          record.shutdownUnconfirmed = true;
          record.stopUnconfirmed = true;
          record.error = `member provisioning outcome is unknown at ${errorStage} (${errorCode})`;
          record.updatedAt = timestamp;
          if (queueEntry !== undefined) {
            queueEntry.status = "outcome_unknown";
            queueEntry.errorCode = errorCode;
            queueEntry.errorStage = errorStage;
            queueEntry.updatedAt = timestamp;
          }
        }
        for (const task of team.tasks) if (task.assigneeSessionId === reservation.placeholderSessionId && task.state === "pending") {
          task.assigneeSessionId = notStarted ? undefined : reservation.childId;
          task.updatedAt = timestamp;
          bumpTaskRevision(task);
          boundedPush(task.interruptionHistory, {
            kind: "provisioning_failed",
            at: timestamp,
            attempt: task.attempt ?? 0,
            leaseEpoch: task.leaseEpoch ?? 0,
            reason: notStarted ? (queueEntry === undefined ? "member provisioning was not dispatched" : "member provisioning was safely queued until a later capacity release") : "member provisioning dispatch outcome is unknown",
            errorCode,
            errorStage,
            retryable: notStarted && queueEntry === undefined,
            ...(occupancy === undefined ? {} : { admission: occupancy }),
          }, MAX_TASK_INTERRUPTION_HISTORY);
        }
        team.updatedAt = timestamp;
      }));
      if (notStarted && Number.isSafeInteger(exactAdmissionGeneration)) admission.confirmDrained?.(reservation.childId, exactAdmissionGeneration);
      if (typeof error?.code === "string" && error.code.startsWith("AGENT_TEAMS_ADMISSION_")) throw annotateStage(error, "admission");
      throw annotateStage(new HarnessError(`member provisioning failed before publication (${errorCode})`, "AGENT_TEAMS_SPAWN_FAILED"), errorStage);
    }
    const reservedAdmission = admission.current?.(reservation.childId);
    if (started.childId !== reservation.childId) {
      const cause = new HarnessError("subagent provider returned a different child id than the reserved identity", "AGENT_TEAMS_CONFLICT");
      const cleanup = await settleSpawnedChildFailure(ctx, store, lead, { phase: "publication", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause, admission: admissionDiagnostic(admission), queueEntryId: reservation.queuedProvisioningId });
      // A contract-violating provider can return an identity whose lifecycle was
      // not observable under the reserved child id. Release the exact reservation only
      // after the unexpected child was conclusively drained; intentionally skipping an
      // existing child is not proof that the accepted turn ended.
      if (cleanup?.drained === true) admission.confirmDrained?.(reservation.childId, reservedAdmission?.generation);
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
          if (reservation.queuedProvisioningId !== undefined) team.provisioningQueue = (team.provisioningQueue ?? []).filter((entry) => entry.id !== reservation.queuedProvisioningId);
          team.updatedAt = record.updatedAt;
          return { duplicateChildId: true };
        }
        if (effectiveTeamState(team) !== "active" || record === undefined || record.sessionId !== reservation.placeholderSessionId || record.state !== "provisioning") reject("team changed during member provisioning", "AGENT_TEAMS_CONFLICT");
        if (!["committed", "active"].includes(team.plan?.phase) || team.plan.revision !== reservation.planRevision || team.plan.hash !== reservation.planHash || team.plan.hash !== teamPlanHash(team)) reject("team plan changed during member provisioning", "AGENT_TEAMS_STALE_PLAN");
        if (reservation.queuedProvisioningId !== undefined) {
          const entry = (team.provisioningQueue ?? []).find((candidate) => candidate.id === reservation.queuedProvisioningId);
          if (entry?.status !== "dispatching" || entry.memberId !== reservation.memberId || entry.childId !== reservation.childId
            || entry.admissionGeneration !== reservation.admissionGeneration || entry.admissionGeneration !== reservedAdmission?.generation) reject("queued provisioning dispatch generation changed before publication", "AGENT_TEAMS_STALE_LEASE");
        }
        record.sessionId = started.childId;
        record.state = "running";
        record.runId = reservedAdmission?.runId;
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
        if (reservation.queuedProvisioningId !== undefined) team.provisioningQueue = (team.provisioningQueue ?? []).filter((entry) => entry.id !== reservation.queuedProvisioningId);
        team.updatedAt = record.updatedAt;
        return { duplicateChildId: false, member: clone(record) };
      }));
    } catch (error) {
      const cleanup = { phase: "publication", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause: error, admission: admissionDiagnostic(admission), queueEntryId: reservation.queuedProvisioningId };
      const settled = await settleSpawnedChildFailure(ctx, store, lead, cleanup);
      if (settled?.drained === true) admission.confirmDrained?.(started.childId, reservedAdmission?.generation);
      throw annotateStage(new HarnessError(`member publication failed after child creation: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED"), "publication");
    }
    if (publication.duplicateChildId) reject("subagent provider returned a child id already owned by another member", "AGENT_TEAMS_CONFLICT");
    const member = publication.member;
    try {
      await admission.run(lead, started.childId, signal, async () => {
        requireExactRootAgent(ctx, lead);
        return queueAgentTeamPrompt(ctx.subagents, lead, started.childId, textContent(workPrompt(reservation.teamId, reservation.memberId, reservation.prompt, reservation.taskIds)), { source: relaySource(lead.id), signal });
      }, reservedAdmission?.generation);
    } catch (error) {
      const activeAdmission = admission.current?.(started.childId);
      const settled = await settleSpawnedChildFailure(ctx, store, lead, { phase: "work-followup", teamId: reservation.teamId, memberId: reservation.memberId, childId: started.childId, cause: error, admission: admissionDiagnostic(admission) });
      if (settled?.drained === true) admission.confirmDrained?.(started.childId, activeAdmission?.generation);
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
    `Authorized member recovery (${action}) for Agent Team ${team.id}.`,
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
  return boundedDiagnosticCode(error, "AGENT_TEAMS_MEMBER_RECOVERY_FAILED");
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
  member.state = proof.memberState; member.error = undefined; delete member.terminalDiagnostic; member.updatedAt = timestamp;
  receipt.status = "delivered"; receipt.dispatchOutcome = "accepted"; receipt.retryable = false; receipt.errorCode = undefined; receipt.errorStage = undefined; receipt.errorMessage = undefined; receipt.admission = undefined; receipt.updatedAt = timestamp; team.updatedAt = timestamp;
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
  if (input.automaticContinuation === true && input.automaticGoalRoundAuthority === undefined) {
    reject("automatic member recovery requires the exact admitted Goal round", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
  }
  const action = assertEnum(input.action, MEMBER_RECOVERY_ACTIONS, "action") ?? input.action;
  const requestId = nonEmptyString(input.requestId, "requestId", 256), teamId = nonEmptyString(input.teamId, "teamId", 256), memberId = nonEmptyString(input.memberId, "memberId", 256);
  const expectedRevision = positiveInteger(input.expectedRevision, "expectedRevision");
  const inputHash = memberRecoveryInputHash({ action, teamId, memberId, expectedRevision });
  const automaticAttemptKey = input.automaticContinuation === true ? automaticMemberRecoveryAttemptKey(teamId, requestId) : undefined;
  const automaticAttempt = automaticAttemptKey === undefined ? undefined : { inputHash, rootSessionId: lead.id, memberId, action, expectedRevision, pauseEpoch: undefined };
  try {
    return await queueTeamOperation(store.filePath, teamId, async () => {
    const prepared = await store.runOperation(() => store.mutate((document) => {
      assertEnabled(document);
      const team = findTeam(document, teamId); requireLiveRootLead(ctx, team, lead); requireActiveTeam(team);
      if (input.automaticContinuation === true) {
        assertAutomaticMemberRecoveryAllowed(ctx, document, team, lead, input.automaticGoalRoundAuthority);
        automaticAttempt.pauseEpoch = team.pauseEpoch ?? 0;
        AUTOMATIC_MEMBER_RECOVERY_ATTEMPTS.set(automaticAttemptKey, automaticAttempt);
      }
      team.memberRecoveries ??= [];
      const replay = team.memberRecoveries.find((receipt) => receipt.requestId === requestId);
      if (replay !== undefined) {
        if (replay.inputHash !== inputHash) reject("member recovery request_id was reused with different input", "AGENT_TEAMS_RECOVERY_REPLAY_CONFLICT");
        return { replay: true, receipt: clone(replay) };
      }
      if (team.memberRecoveries.some((receipt) => receipt.memberId === memberId && ["prepared", "outcome_unknown"].includes(receipt.status))) reject("a prior member recovery is unresolved; reconcile the exact receipt before another attempt", "AGENT_TEAMS_RECOVERY_OUTCOME_UNKNOWN");
      if (team.revision !== expectedRevision) reject("team changed before member recovery; refresh current state and retry", "AGENT_TEAMS_STALE_TEAM");
      const member = team.members.find((candidate) => candidate.id === memberId);
      if (member?.kind !== "worker" || member.state !== "failed") reject("only an exact failed worker may be recovered", "AGENT_TEAMS_MEMBER_NOT_FAILED");
      if (input.automaticContinuation === true && action === "retry" && team.memberRecoveries.some((receipt) => receipt.memberId === memberId && receipt.action === "retry" && receipt.status === "delivered" && receipt.dispatchOutcome === "accepted")) {
        reject("the safe automatic retry was already used for this failed member; replace it without asking the user", "AGENT_TEAMS_AUTOMATIC_RETRY_EXHAUSTED");
      }
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
      const receipt = {
        requestId,
        inputHash,
        action,
        status: "prepared",
        phase: action === "retry" ? "retry_awaiting_admission" : "prepared",
        memberId: member.id,
        sessionId: member.sessionId,
        taskIds: tasks.map((task) => task.id),
        activeTaskIds: activeTasks.map((task) => task.id),
        activeClaims: activeTasks.map((task) => ({ taskId: task.id, claimId: task.claimId, leaseEpoch: task.leaseEpoch })),
        dispatchOutcome: "not_started",
        retryable: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        pauseEpoch: team.pauseEpoch ?? 0,
        teamRevision: team.revision,
      };
      if (action === "replace") {
        receipt.replacementMemberId = randomUUID();
        receipt.replacementSessionId = randomUUID();
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
      if (prepared.receipt.phase === "followup_returned") return store.runOperation(() => store.mutate((document) => { const team = findTeam(document, teamId), receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(document, team, receipt); }));
      const child = prepared.receipt.action === "replace" ? ctx.agents.get(prepared.receipt.replacementSessionId) : undefined;
      const resumable = prepared.receipt.action === "replace" && ["start_dispatched", "child_started", "published", "followup_awaiting_admission", "followup_dispatching"].includes(prepared.receipt.phase) && child !== undefined;
      if (!resumable) {
        const document = await store.read((current) => current), team = findTeam(document, teamId);
        return memberRecoveryPublic(team, team.memberRecoveries.find((receipt) => receipt.requestId === requestId), document.teams);
      }
      provisioningSessionId = prepared.receipt.replacementSessionId;
      PROVISIONING_MEMBER_SESSION_IDS.add(provisioningSessionId);
    }
    try {
      if (action === "retry") {
        const document = await store.read((current) => current), team = findTeam(document, teamId), currentReceipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId), member = team.members.find((candidate) => candidate.id === memberId), tasks = currentReceipt.taskIds.map((taskId) => team.tasks.find((task) => task.id === taskId)).filter(Boolean);
        let retryDispatchBegan = false;
        try {
          await runWithLifecycleDeadline(
            (lifecycleSignal) => admission.run(lead, currentReceipt.sessionId, lifecycleSignal, async () => {
              retryDispatchBegan = true;
              await store.runOperation(() => store.mutate((current) => {
                const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam);
                const receipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), liveMember = liveTeam.members.find((candidate) => candidate.id === memberId);
                if (receipt.status !== "prepared" || receipt.phase !== "retry_awaiting_admission" || liveMember?.sessionId !== receipt.sessionId || liveMember.state !== "failed" || (liveTeam.pauseEpoch ?? 0) !== receipt.pauseEpoch || memberRecoveryDeliveryProof(liveTeam, receipt, receipt.sessionId) === undefined) reject("exact retry session, task claim, or lease changed before dispatch", "AGENT_TEAMS_STALE_LEASE");
                receipt.status = "outcome_unknown"; receipt.phase = "retry_dispatching"; receipt.dispatchOutcome = "outcome_unknown"; receipt.retryable = false; receipt.errorCode = undefined; receipt.errorStage = undefined; receipt.errorMessage = undefined; receipt.admission = undefined; receipt.updatedAt = now(); liveTeam.updatedAt = receipt.updatedAt;
              }));
              requireExactRootAgent(ctx, lead);
              return queueAgentTeamPrompt(ctx.subagents, lead, currentReceipt.sessionId, textContent(memberRecoveryPrompt(team, member, tasks, action)), { source: relaySource(lead.id), signal: lifecycleSignal });
            }),
            { signal, label: "failed member retry" },
          );
        } catch (error) {
          const waitError = !retryDispatchBegan && signal?.aborted && !admissionDidNotDispatch(error) ? admissionCancellation() : error;
          if (!retryDispatchBegan) await store.runOperation(() => store.mutate((current) => {
            const liveTeam = findTeam(current, teamId), receipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
            if (receipt?.status === "prepared" && receipt.phase === "retry_awaiting_admission") {
              receipt.dispatchOutcome = "not_started"; receipt.retryable = true; receipt.errorCode = boundedDiagnosticCode(waitError, "AGENT_TEAMS_ADMISSION_FAILED"); receipt.errorStage = "retry_awaiting_admission"; receipt.errorMessage = undefined; receipt.admission = admissionDiagnostic(admission); receipt.updatedAt = now(); liveTeam.updatedAt = receipt.updatedAt;
            }
          }));
          throw waitError;
        }
        await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam);
          const receipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), liveMember = liveTeam.members.find((candidate) => candidate.id === memberId);
          if (receipt.status !== "outcome_unknown" || receipt.phase !== "retry_dispatching" || liveMember?.sessionId !== receipt.sessionId || !["failed", "running", "ready", "idle"].includes(liveMember.state) || (liveTeam.pauseEpoch ?? 0) !== receipt.pauseEpoch || memberRecoveryDeliveryProof(liveTeam, receipt, receipt.sessionId) === undefined) reject("exact retry session, task claim, or lease changed after delivery", "AGENT_TEAMS_STALE_LEASE");
          receipt.phase = "followup_returned"; receipt.dispatchOutcome = "accepted"; receipt.updatedAt = now(); liveTeam.updatedAt = receipt.updatedAt;
        }));
        return store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId), receipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(current, liveTeam, receipt); }));
      }
      let document = await store.read((current) => current), team = findTeam(document, teamId), receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      provisioningSessionId = receipt.replacementSessionId;
      PROVISIONING_MEMBER_SESSION_IDS.add(provisioningSessionId);
      let started = ctx.agents.get(receipt.replacementSessionId);
      if (receipt.status === "prepared" && receipt.phase === "prepared") {
        await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam);
          const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
          if (liveReceipt.status !== "prepared" || liveReceipt.phase !== "prepared" || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch) reject("replacement drain fence changed", "AGENT_TEAMS_STALE_LEASE");
          liveReceipt.status = "outcome_unknown"; liveReceipt.phase = "drain_started"; liveReceipt.dispatchOutcome = "outcome_unknown"; liveReceipt.retryable = false; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt;
        }));
        const drainedAdmission = admission.current?.(receipt.sessionId);
        await drainContinuableChildrenWithDeadline(ctx, lead, [receipt.sessionId], signal);
        admission.confirmDrained?.(receipt.sessionId, drainedAdmission?.generation);
        await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam);
          const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
          if (liveReceipt.status !== "outcome_unknown" || liveReceipt.phase !== "drain_started" || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch) reject("replacement drain completion is stale", "AGENT_TEAMS_STALE_LEASE");
          liveReceipt.status = "prepared"; liveReceipt.phase = "start_awaiting_admission"; liveReceipt.dispatchOutcome = "not_started"; liveReceipt.retryable = true; liveReceipt.errorCode = undefined; liveReceipt.errorStage = undefined; liveReceipt.errorMessage = undefined; liveReceipt.admission = undefined; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt;
        }));
        document = await store.read((current) => current); team = findTeam(document, teamId); receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId); started = ctx.agents.get(receipt.replacementSessionId);
      }
      if (started === undefined && receipt.status === "prepared" && receipt.phase === "start_awaiting_admission") {
        let startDispatchBegan = false;
        try {
          started = await runWithLifecycleDeadline(
            (lifecycleSignal) => admission.run(lead, receipt.replacementSessionId, lifecycleSignal, async () => {
              startDispatchBegan = true;
              const staged = await store.runOperation(() => store.mutate((current) => {
                const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam);
                const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), original = liveTeam.members.find((candidate) => candidate.id === liveReceipt.memberId);
                if (liveReceipt.status !== "prepared" || liveReceipt.phase !== "start_awaiting_admission" || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch || original?.state !== "failed" || memberRecoveryDeliveryProof(liveTeam, liveReceipt, original.sessionId) === undefined) reject("replacement task, claim, lease, or member changed before start dispatch", "AGENT_TEAMS_STALE_LEASE");
                let replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId);
                if (replacement === undefined) {
                  const timestamp = now(), placeholderSessionId = `provisioning:${liveReceipt.replacementMemberId}`;
                  replacement = { id: liveReceipt.replacementMemberId, sessionId: placeholderSessionId, name: replacementMemberName(liveTeam, original), role: original.role, ...(original.model === undefined ? {} : { model: original.model }), ...(original.provider === undefined ? {} : { provider: original.provider }), modelTier: original.modelTier ?? "subagent", inheritsMain: original.inheritsMain === true, routeSource: original.routeSource ?? "recovery-inherited", kind: "worker", state: "provisioning", createdAt: timestamp, updatedAt: timestamp };
                  confirmMemberRetired(original, { timestamp, stopReason: "drained_for_replacement" });
                  for (const taskId of liveReceipt.taskIds) {
                    const task = liveTeam.tasks.find((candidate) => candidate.id === taskId);
                    boundedPush(task.interruptionHistory, { kind: "member_replaced", at: timestamp, attempt: task.attempt ?? 0, claimId: task.claimId, leaseEpoch: task.leaseEpoch ?? 0, reason: `recovery request ${requestId}` }, MAX_TASK_INTERRUPTION_HISTORY);
                    task.state = "pending"; task.assigneeSessionId = placeholderSessionId; task.claimedAt = undefined; task.claimId = undefined; clearTaskTerminalMetadata(task); task.releasedAt = timestamp; task.releaseReason = "failed member replaced by authorized recovery; prior claim and lease revoked"; task.updatedAt = timestamp; bumpTaskRevision(task);
                  }
                  liveTeam.members.push(replacement);
                }
                liveReceipt.status = "outcome_unknown"; liveReceipt.phase = "start_dispatched"; liveReceipt.dispatchOutcome = "outcome_unknown"; liveReceipt.retryable = false; liveReceipt.errorCode = undefined; liveReceipt.errorStage = undefined; liveReceipt.errorMessage = undefined; liveReceipt.admission = undefined; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt;
                return { teamId: liveTeam.id, replacement: clone(replacement) };
              }));
              requireExactRootAgent(ctx, lead);
              return ctx.subagents.startContinuable({ childId: receipt.replacementSessionId, provider: "spawn", label: staged.replacement.name, request: { parent: lead, prompt: textContent(registrationPrompt(staged.teamId, staged.replacement.name, staged.replacement.role)), ...(staged.replacement.provider === undefined && staged.replacement.model === undefined ? {} : { agentOptions: { ...(staged.replacement.provider === undefined ? {} : { provider: staged.replacement.provider }), ...(staged.replacement.model === undefined ? {} : { model: staged.replacement.model }) } }) }, signal: lifecycleSignal });
            }),
            { signal, label: "replacement member start" },
          );
        } catch (error) {
          const waitError = !startDispatchBegan && signal?.aborted && !admissionDidNotDispatch(error) ? admissionCancellation() : error;
          if (!startDispatchBegan) await store.runOperation(() => store.mutate((current) => {
            const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
            if (liveReceipt?.status === "prepared" && liveReceipt.phase === "start_awaiting_admission") {
              liveReceipt.dispatchOutcome = "not_started"; liveReceipt.retryable = true; liveReceipt.errorCode = boundedDiagnosticCode(waitError, "AGENT_TEAMS_ADMISSION_FAILED"); liveReceipt.errorStage = "start_awaiting_admission"; liveReceipt.errorMessage = undefined; liveReceipt.admission = admissionDiagnostic(admission); liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt;
            }
          }));
          throw waitError;
        }
      }
      document = await store.read((current) => current); team = findTeam(document, teamId); receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      if (started === undefined) return memberRecoveryPublic(team, receipt, document.teams);
      const startedId = started.childId ?? started.id;
      if (startedId !== receipt.replacementSessionId) reject("replacement provider returned a different child id", "AGENT_TEAMS_CONFLICT");
      if (receipt.status === "outcome_unknown" && receipt.phase === "start_dispatched") {
        await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
          if (liveReceipt.status === "outcome_unknown" && liveReceipt.phase === "start_dispatched") { liveReceipt.phase = "child_started"; liveReceipt.dispatchOutcome = "accepted"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }
        }));
        document = await store.read((current) => current); team = findTeam(document, teamId); receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      }
      if (receipt.status === "outcome_unknown" && ["start_dispatched", "child_started"].includes(receipt.phase)) {
        const exactStartedRunId = admission.current?.(startedId)?.runId;
        const published = await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId);
          if (liveReceipt.status !== "outcome_unknown" || !["start_dispatched", "child_started"].includes(liveReceipt.phase) || !["provisioning", "failed"].includes(replacement?.state) || ![`provisioning:${replacement?.id}`, startedId].includes(replacement?.sessionId) || replacement?.shutdownUnconfirmed === true || replacement?.stopUnconfirmed === true || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch) reject("team changed during replacement publication", "AGENT_TEAMS_STALE_LEASE");
          replacement.sessionId = startedId; replacement.state = "running"; replacement.runId = exactStartedRunId; replacement.publishedAt = now(); replacement.updatedAt = replacement.publishedAt;
          for (const taskId of liveReceipt.taskIds) { const task = liveTeam.tasks.find((candidate) => candidate.id === taskId); if (task?.state !== "pending" || task.assigneeSessionId !== `provisioning:${replacement.id}`) reject("replacement task pre-binding changed", "AGENT_TEAMS_TASK_CONFLICT"); task.assigneeSessionId = startedId; task.leaseEpoch = liveReceipt.pauseEpoch; task.updatedAt = replacement.updatedAt; bumpTaskRevision(task); }
          liveReceipt.phase = "published"; liveReceipt.dispatchOutcome = "accepted"; liveReceipt.retryable = false; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; return { team: clone(liveTeam), receipt: clone(liveReceipt) };
        }));
        team = published.team; receipt = published.receipt;
      } else {
        document = await store.read((current) => current); team = findTeam(document, teamId); receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      }
      if (receipt.status === "outcome_unknown" && receipt.phase === "published") {
        await store.runOperation(() => store.mutate((current) => {
          const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
          if (liveReceipt.status === "outcome_unknown" && liveReceipt.phase === "published") { liveReceipt.status = "prepared"; liveReceipt.phase = "followup_awaiting_admission"; liveReceipt.dispatchOutcome = "not_started"; liveReceipt.retryable = true; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }
        }));
        document = await store.read((current) => current); team = findTeam(document, teamId); receipt = team.memberRecoveries.find((candidate) => candidate.requestId === requestId);
      }
      if (receipt.phase === "followup_returned") return store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(current, liveTeam, liveReceipt); }));
      if (receipt.status === "prepared" && receipt.phase === "followup_awaiting_admission") {
        const replacement = team.members.find((candidate) => candidate.id === receipt.replacementMemberId), tasks = receipt.taskIds.map((taskId) => team.tasks.find((task) => task.id === taskId)).filter(Boolean);
        const continuationGeneration = admission.current?.(startedId)?.generation;
        let followupDispatchBegan = false;
        try {
          await runWithLifecycleDeadline(
            (lifecycleSignal) => admission.run(lead, startedId, lifecycleSignal, async () => {
              followupDispatchBegan = true;
              await store.runOperation(() => store.mutate((current) => {
                const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
                if (liveReceipt.status !== "prepared" || liveReceipt.phase !== "followup_awaiting_admission" || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch || memberRecoveryDeliveryProof(liveTeam, liveReceipt, startedId) === undefined) reject("team changed before replacement followup dispatch", "AGENT_TEAMS_STALE_LEASE");
                liveReceipt.status = "outcome_unknown"; liveReceipt.phase = "followup_dispatching"; liveReceipt.dispatchOutcome = "outcome_unknown"; liveReceipt.retryable = false; liveReceipt.errorCode = undefined; liveReceipt.errorStage = undefined; liveReceipt.errorMessage = undefined; liveReceipt.admission = undefined; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt;
              }));
              requireExactRootAgent(ctx, lead);
              return queueAgentTeamPrompt(ctx.subagents, lead, startedId, textContent(memberRecoveryPrompt(team, replacement, tasks, action)), { source: relaySource(lead.id), signal: lifecycleSignal });
            }, continuationGeneration),
            { signal, label: "replacement member followup" },
          );
        } catch (error) {
          const waitError = !followupDispatchBegan && signal?.aborted && !admissionDidNotDispatch(error) ? admissionCancellation() : error;
          if (!followupDispatchBegan) await store.runOperation(() => store.mutate((current) => {
            const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
            if (liveReceipt?.status === "prepared" && liveReceipt.phase === "followup_awaiting_admission") {
              liveReceipt.dispatchOutcome = "not_started"; liveReceipt.retryable = true; liveReceipt.errorCode = boundedDiagnosticCode(waitError, "AGENT_TEAMS_ADMISSION_FAILED"); liveReceipt.errorStage = "followup_awaiting_admission"; liveReceipt.errorMessage = undefined; liveReceipt.admission = admissionDiagnostic(admission); liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt;
            }
          }));
          throw waitError;
        }
        await store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId); requireActiveTeam(liveTeam); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); if (liveReceipt.status !== "outcome_unknown" || liveReceipt.phase !== "followup_dispatching" || (liveTeam.pauseEpoch ?? 0) !== liveReceipt.pauseEpoch) reject("team changed during replacement followup", "AGENT_TEAMS_STALE_LEASE"); liveReceipt.phase = "followup_returned"; liveReceipt.dispatchOutcome = "accepted"; liveReceipt.updatedAt = now(); liveTeam.updatedAt = liveReceipt.updatedAt; }));
        return store.runOperation(() => store.mutate((current) => { const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId); return finalizeMemberRecoveryDelivery(current, liveTeam, liveReceipt); }));
      }
      document = await store.read((current) => current); team = findTeam(document, teamId); return memberRecoveryPublic(team, team.memberRecoveries.find((candidate) => candidate.requestId === requestId), document.teams);
    } catch (error) {
      await store.runOperation(() => store.mutate((document) => {
        const team = findTeam(document, teamId), receipt = team.memberRecoveries?.find((candidate) => candidate.requestId === requestId); if (receipt === undefined || receipt.status !== "outcome_unknown") return;
        const errorCode = boundedDiagnosticCode(error, "AGENT_TEAMS_MEMBER_RECOVERY_FAILED");
        receipt.errorCode = errorCode; receipt.errorStage = receipt.phase; receipt.errorMessage = `member recovery outcome is unknown at ${receipt.phase} (${errorCode})`; receipt.retryable = false; receipt.dispatchOutcome = "outcome_unknown"; receipt.updatedAt = now();
        if (action === "replace" && receipt.phase === "drain_started") {
          const original = team.members.find((candidate) => candidate.id === receipt.memberId);
          if (original !== undefined) {
            original.state = "failed";
            original.shutdownUnconfirmed = true;
            original.stopUnconfirmed = true;
            original.error = `replacement drain remains unconfirmed (${errorCode})`;
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
  } finally {
    if (automaticAttemptKey !== undefined && AUTOMATIC_MEMBER_RECOVERY_ATTEMPTS.get(automaticAttemptKey) === automaticAttempt) {
      AUTOMATIC_MEMBER_RECOVERY_ATTEMPTS.delete(automaticAttemptKey);
    }
  }
}

async function reconcileMemberRecovery(ctx, store, lead, input, admission = createTeamTurnAdmission()) {
  const teamId = nonEmptyString(input.teamId, "teamId", 256), requestId = nonEmptyString(input.requestId, "requestId", 256), resolution = assertEnum(input.resolution, ["delivered", "not_delivered"], "resolution") ?? input.resolution;
  const expectedRevision = positiveInteger(input.expectedRevision, "expectedRevision");
  return queueTeamOperation(store.filePath, teamId, async () => {
    let document = await store.read((current) => current), team = findTeam(document, teamId); requireLiveRootLead(ctx, team, lead); if (team.state === "closed" || team.state === "closing") reject("closed team recovery cannot be reconciled", "AGENT_TEAMS_NOT_FOUND");
    let receipt = team.memberRecoveries?.find((candidate) => candidate.requestId === requestId); if (receipt === undefined) reject("member recovery receipt is unavailable", "AGENT_TEAMS_NOT_FOUND");
    if (receipt.status !== "outcome_unknown") return memberRecoveryPublic(team, receipt, document.teams);
    if (team.revision !== expectedRevision) reject("team changed before recovery reconciliation; refresh the durable receipt", "AGENT_TEAMS_STALE_TEAM");
    if (team.state === "paused" && resolution !== "not_delivered") reject("paused recovery can only be reconciled as not delivered", "AGENT_TEAMS_PAUSED");
    if (receipt.action === "replace" && resolution === "not_delivered" && receipt.phase !== "drain_started") {
      const binding = await store.runOperation(() => store.mutate((current) => {
        const liveTeam = findTeam(current, teamId); requireLiveRootLead(ctx, liveTeam, lead); const liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId), replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId);
        if (liveReceipt.status !== "outcome_unknown" || replacement === undefined) reject("replacement recovery receipt changed before reconciliation", "AGENT_TEAMS_CONFLICT");
        const placeholder = `provisioning:${replacement.id}`, childId = liveReceipt.replacementSessionId;
        for (const taskId of liveReceipt.taskIds) { const task = liveTeam.tasks.find((candidate) => candidate.id === taskId); if (task?.state !== "pending" || ![undefined, placeholder, childId].includes(task.assigneeSessionId)) reject("replacement task changed before not-delivered reconciliation", "AGENT_TEAMS_TASK_CONFLICT"); if (task.assigneeSessionId === undefined) { task.assigneeSessionId = childId ?? placeholder; task.updatedAt = now(); bumpTaskRevision(task); } }
        liveTeam.updatedAt = now(); return { childId, placeholder, replacementMemberId: liveReceipt.replacementMemberId, admissionGeneration: admission.current?.(childId)?.generation };
      }));
      if (binding.childId !== undefined && ctx.agents.get(binding.childId) !== undefined) {
        try {
          await drainContinuableChildrenWithDeadline(ctx, lead, [binding.childId]);
          admission.confirmDrained?.(binding.childId, binding.admissionGeneration);
        }
        catch (error) {
          await store.runOperation(() => store.mutate((current) => {
            const liveTeam = findTeam(current, teamId), liveReceipt = liveTeam.memberRecoveries.find((candidate) => candidate.requestId === requestId);
            const replacement = liveTeam.members.find((candidate) => candidate.id === binding.replacementMemberId);
            if (replacement !== undefined && replacement.state !== "retired") {
              replacement.state = "failed"; replacement.shutdownUnconfirmed = true; replacement.stopUnconfirmed = true;
              const errorCode = memberRecoveryFailureCode(error);
              replacement.error = `replacement reconciliation could not confirm shutdown (${errorCode})`; replacement.updatedAt = now();
            }
            if (liveReceipt?.status === "outcome_unknown") {
              const errorCode = memberRecoveryFailureCode(error);
              liveReceipt.errorCode = errorCode; liveReceipt.errorStage = liveReceipt.phase;
              liveReceipt.errorMessage = `replacement reconciliation remains unconfirmed (${errorCode})`; liveReceipt.updatedAt = now();
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
        member.state = proof.memberState; member.error = undefined; delete member.terminalDiagnostic; member.updatedAt = timestamp;
        liveReceipt.status = "delivered"; liveReceipt.dispatchOutcome = "accepted"; liveReceipt.retryable = false;
      } else {
        if (liveReceipt.action === "replace" && liveReceipt.phase === "drain_started") {
          const original = liveTeam.members.find((candidate) => candidate.id === liveReceipt.memberId);
          if (original !== undefined) { original.state = "failed"; original.shutdownUnconfirmed = undefined; original.stopUnconfirmed = undefined; original.error = "replacement recovery was reconciled as not delivered"; original.updatedAt = timestamp; }
        } else if (liveReceipt.action === "replace") {
          const replacement = liveTeam.members.find((candidate) => candidate.id === liveReceipt.replacementMemberId); if (replacement === undefined) reject("replacement disappeared before not-delivered reconciliation", "AGENT_TEAMS_CONFLICT"); const placeholder = `provisioning:${replacement.id}`;
          for (const taskId of liveReceipt.taskIds) { const task = liveTeam.tasks.find((candidate) => candidate.id === taskId); if (task?.state !== "pending" || ![placeholder, liveReceipt.replacementSessionId].includes(task.assigneeSessionId)) reject("replacement task changed after drain; recovery remains unresolved", "AGENT_TEAMS_TASK_CONFLICT"); }
          rollbackUnstartedReplacement(liveTeam, liveReceipt, timestamp);
        } else { const member = liveTeam.members.find((candidate) => candidate.id === liveReceipt.memberId); if (member !== undefined) { member.state = "failed"; member.updatedAt = timestamp; } }
        liveReceipt.status = "failed"; liveReceipt.dispatchOutcome = "not_started"; liveReceipt.retryable = true;
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
    let structuredMessage;
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
      if (preparedMessage.kind !== undefined) {
        if (preparedMessage.kind !== "expansion_request") throw new TypeError("prepared message kind is invalid");
        const dedupeKey = nonEmptyString(preparedMessage.dedupeKey, "prepared message dedupeKey", 64);
        if (!/^[a-f0-9]{64}$/u.test(dedupeKey)) throw new TypeError("prepared message dedupeKey is invalid");
        const expansionRequest = validateStoredExpansionRequest(clone(preparedMessage.expansionRequest));
        const existing = expansionRequestMessages(sourceTeam).find((message) => message.dedupeKey === dedupeKey);
        if (existing !== undefined) return {
          reused: true,
          teamId: sourceTeam.id,
          targetTeamId: targetTeam.id,
          message: clone(existing),
          result: { expansionRequest: projectExpansionRequest(existing.expansionRequest), deduplicated: true },
        };
        structuredMessage = { kind: preparedMessage.kind, dedupeKey, expansionRequest };
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
    const targetLead = recipient.kind === "lead" ? ctx.agents.get(sourceTeam.rootLeadSessionId) : undefined;
    const deferToAutopilot = structuredMessage?.kind === "expansion_request" && targetTeam === sourceTeam
      && targetLead !== undefined && sourceTeam.autopilot?.status === "active"
      && agentTeamAutopilotInvalidReason(sourceTeam, targetLead, ctx.goals?.get?.(targetLead), document.settings) === undefined;
    const createdAt = now();
    const message = {
      id: structuredMessage?.expansionRequest.id ?? randomUUID(),
      fromSessionId: caller.id,
      toSessionId: recipientId,
      ...(targetTeam === sourceTeam ? {} : { toTeamId: targetTeam.id }),
      body: persistedBody,
      status: deferToAutopilot ? "queued" : "pending",
      ...(deferToAutopilot ? { queuedAt: createdAt } : {}),
      createdAt,
      ...(structuredMessage ?? {}),
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
      deferToAutopilot,
      ...(result === undefined ? {} : { result }),
    };
  }));
  if (prepared.reused === true || prepared.deferToAutopilot === true) {
    return store.read((document) => {
      const currentTeam = findTeam(document, prepared.teamId);
      const currentTarget = findTeam(document, prepared.targetTeamId);
      const message = currentTeam.messages.find((candidate) => candidate.id === prepared.message.id);
      const names = new Map([...currentTeam.members, ...currentTarget.members].map((member) => [member.sessionId, canonicalMemberName(member.name)]));
      return { teamId: currentTeam.id, targetTeamId: currentTarget.id, message: message === undefined ? undefined : projectMessageEvent(message, names, currentTeam.id), ...(prepared.result ?? {}) };
    });
  }
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
        // followup/steer and the subagent prompt queue acknowledge transport
        // acceptance only. They do not prove that the recipient model actually
        // received this body, so never expose that acknowledgment as delivered.
        message.status = "queued";
        message.queuedAt = now();
        message.deliveredAt = undefined;
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
        message.queuedAt = undefined;
        message.deliveredAt = undefined;
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
    return { teamId: team.id, task: deriveTaskAcrossTeams(task, team, document.teams), scope: projectTeamScope(team) };
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
    requireTeamCleanupState(team, isLead && action === "cancel" && input.allowPausedCleanup === true);
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

function memberRetirementBlocksRetry(member) {
  return member.retirement !== undefined && member.retirement.status !== "completed" && member.retirement.stopReason !== "not_started";
}
function markMemberShuttingDown(member, force, { pauseEpoch, scope } = {}) {
  member.state = "shutting_down";
  if (force) {
    member.shutdownUnconfirmed = true;
    member.stopUnconfirmed = true;
  } else if (pauseEpoch !== undefined && scope !== undefined) {
    const timestamp = now();
    member.retirement = {
      intentId: randomUUID(),
      scope,
      status: "pending",
      pauseEpoch,
      requestedAt: timestamp,
      updatedAt: timestamp,
      ...(member.runId === undefined ? {} : { targetRunId: member.runId }),
    };
  }
  member.updatedAt = now();
}
function bindMemberRetirementTarget(member, intentId, runId, timestamp = now()) {
  const retirement = member.retirement;
  if (retirement?.intentId !== intentId || retirement.status !== "pending" || runId === undefined) return false;
  const exactRunId = String(runId);
  if (retirement.targetRunId !== undefined && retirement.targetRunId !== exactRunId) return false;
  retirement.targetRunId = exactRunId;
  retirement.updatedAt = timestamp;
  return true;
}
function confirmMemberRetired(member, { timestamp = now(), stopReason = "confirmed" } = {}) {
  if (member.retirement !== undefined && member.retirement.status !== "completed") {
    member.retirement.status = "completed";
    member.retirement.stopReason = stopReason;
    member.retirement.completedAt = timestamp;
    member.retirement.updatedAt = timestamp;
    member.retirement.errorCode = undefined;
  }
  member.state = "retired";
  member.shutdownUnconfirmed = undefined;
  member.stopUnconfirmed = undefined;
  member.runId = undefined;
  member.error = undefined;
  delete member.terminalDiagnostic;
  member.updatedAt = timestamp;
}
function failMemberRetirement(member, stopReason, timestamp = now()) {
  if (member.retirement !== undefined) {
    member.retirement.status = "failed";
    member.retirement.stopReason = stopReason;
    member.retirement.errorCode = "AGENT_TEAMS_GRACEFUL_RETIREMENT_FAILED";
    member.retirement.updatedAt = timestamp;
  }
  member.state = "failed";
  member.shutdownUnconfirmed = true;
  member.stopUnconfirmed = true;
  member.error = `graceful retirement ended with ${stopReason}`;
  member.updatedAt = timestamp;
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
async function pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt, authorizationProvider, admission) {
  const selectedChildren = new Map(selections.map((entry) => [entry.teamId, new Set(entry.childIds)]));
  const teamIds = new Set(selectedChildren.keys());
  const childIds = [...new Set(selections.flatMap((entry) => entry.childIds))];
  const admissionBindings = childIds.map((childId) => ({ childId, generation: admission?.current?.(childId)?.generation }));
  // Stop must remove the bound Goal activation before durable team authority is
  // revoked or the pause epoch advances; otherwise an already-armed continuation
  // can escape the newly paused scope.
  await revokeRootAgentTeamAutopilot(ctx, store, lead, AGENT_TEAM_AUTOPILOT_STOP_REVOKE_REASON, "revoked", authorizationProvider);
  await store.runOperation(() => store.mutate((document) => {
    for (const team of document.teams) {
      if (!teamIds.has(team.id) || team.rootLeadSessionId !== lead.id || !["active", "paused"].includes(team.state)) continue;
      team.pauseEpoch = (team.pauseEpoch ?? 0) + 1;
      team.state = "paused";
      team.resume = undefined;
      USER_PAUSE_EPOCHS.set(team.id, team.pauseEpoch);
      for (const entry of team.provisioningQueue ?? []) {
        if (entry.status === "queued") {
          requeueProvisioningEntry(entry, admission, stoppedAt, "AGENT_TEAMS_STOPPED", "user_stop");
        } else if (entry.status === "provisioning") {
          team.members = team.members.filter((member) => member.id !== entry.memberId);
          for (const task of team.tasks) if (task.state === "pending" && task.assigneeSessionId === `provisioning:${entry.memberId}`) {
            task.assigneeSessionId = undefined;
            task.leaseEpoch = team.pauseEpoch;
            task.updatedAt = stoppedAt;
            bumpTaskRevision(task);
          }
          requeueProvisioningEntry(entry, admission, stoppedAt, "AGENT_TEAMS_STOPPED", "user_stop");
        } else if (entry.status === "dispatching") {
          const member = team.members.find((candidate) => candidate.id === entry.memberId);
          if (member !== undefined) {
            member.sessionId = entry.childId;
            member.state = "failed";
            member.shutdownUnconfirmed = true;
            member.stopUnconfirmed = true;
            member.error = "user Stop interrupted an already-fenced provider dispatch; provisioning outcome is unknown";
            member.updatedAt = stoppedAt;
          }
          for (const task of team.tasks) if (task.state === "pending" && task.assigneeSessionId === `provisioning:${entry.memberId}`) {
            task.assigneeSessionId = entry.childId;
            task.leaseEpoch = team.pauseEpoch;
            task.updatedAt = stoppedAt;
            bumpTaskRevision(task);
          }
          entry.status = "outcome_unknown";
          entry.errorCode = "AGENT_TEAMS_STOPPED";
          entry.errorStage = "dispatching";
          entry.updatedAt = stoppedAt;
        }
      }
      // A user Stop revokes every pre-dispatch spawn authorization. Only an
      // already-dispatched, genuinely uncertain identity remains fenced.
      team.provisioningQueue = (team.provisioningQueue ?? []).filter((entry) => entry.status === "outcome_unknown");
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
  try {
    await drainContinuableChildrenWithDeadline(ctx, lead, childIds);
    for (const binding of admissionBindings) admission?.confirmDrained?.(binding.childId, binding.generation);
  } catch (error) { drainError = error; }
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
async function resumePausedTeam(ctx, store, lead, input, admission) {
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
    try { await pauseTeamsForUserStop(ctx, store, lead, [repairSelection], now(), undefined, admission); }
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
    const grantGroup = directHumanAutopilotGrantGroup(ctx, document, team, lead, input.autopilotGoal, input.directHumanGrantIntent, { resumeBoundary: true });
    if (grantGroup.length > 0) rebindAutomaticPlanGrantGroup(grantGroup, team, team.plan.hash);
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
    if (!force && memberRetirementBlocksRetry(member)) reject("a prior graceful retirement still lacks exact lifecycle resolution; use force only after confirming the target worker", "AGENT_TEAMS_SHUTDOWN_UNCONFIRMED");
    const unclaimedTaskIds = team.tasks.filter((task) => !taskIsTerminal(task) && task.assigneeSessionId === undefined).map((task) => task.id);
    const hasOtherAssignableWorker = team.members.some((candidate) => candidate.kind === "worker" && candidate.sessionId !== member.sessionId
      && ["running", "idle", "ready"].includes(candidate.state) && candidate.shutdownUnconfirmed !== true && candidate.stopUnconfirmed !== true);
    const hasLiveAutopilot = ["pending_plan", "active"].includes(team.autopilot?.status);
    if (!force && hasLiveAutopilot && unclaimedTaskIds.length > 0 && !hasOtherAssignableWorker) {
      reject(`retiring the last assignable worker would strand unfinished unclaimed tasks under live automatic continuation; assign another worker or reconcile them first: ${unclaimedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
    }
    const priorState = member.state;
    markMemberShuttingDown(member, force, { pauseEpoch: team.pauseEpoch ?? 0, scope: "member" });
    team.updatedAt = member.updatedAt;
    return { teamId: team.id, member: clone(member), priorState, retirementIntentId: member.retirement?.intentId, noop: false };
  }));
  if (prepared.noop) return prepared;
  const gracefulWaiter = force ? undefined : registerGracefulLifecycleWaiter(prepared.member.sessionId);
  let retirementDispatchBegan = false;
  let gracefulEnd;
  try {
    if (force) {
      const drainedAdmission = admission?.current?.(prepared.member.sessionId);
      await drainContinuableChildrenWithDeadline(ctx, lead, [prepared.member.sessionId], signal);
      admission?.confirmDrained?.(prepared.member.sessionId, drainedAdmission?.generation);
    } else {
      const continuationGeneration = admission.current?.(prepared.member.sessionId)?.generation;
      await runWithLifecycleDeadline(async (lifecycleSignal) => {
        await admission.run(lead, prepared.member.sessionId, lifecycleSignal, async () => {
          retirementDispatchBegan = true;
          requireExactRootAgent(ctx, lead);
          return queueAgentTeamPrompt(ctx.subagents, lead, prepared.member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
            source: relaySource(lead.id), signal: lifecycleSignal,
          });
        }, continuationGeneration);
        const targetRunId = admission.current?.(prepared.member.sessionId)?.runId ?? GRACEFUL_ACTIVE_RUNS.get(prepared.member.sessionId);
        if (targetRunId !== undefined) await store.runOperation(() => store.mutate((document) => {
          const team = findTeam(document, prepared.teamId);
          const member = memberOf(team, prepared.member.sessionId);
          if (member !== undefined && bindMemberRetirementTarget(member, prepared.retirementIntentId, targetRunId)) team.updatedAt = member.retirement.updatedAt;
        }));
        gracefulWaiter.accept();
        gracefulEnd = await waitForGracefulLifecycle(gracefulWaiter, lifecycleSignal);
      }, { signal, label: "graceful member retirement" });
    }
  } catch (error) {
    gracefulWaiter?.cancel();
    const notStarted = !retirementDispatchBegan;
    const errorCode = boundedDiagnosticCode(error, "AGENT_TEAMS_GRACEFUL_RETIREMENT_FAILED");
    await store.runOperation(() => store.mutate((document) => {
      const team = findTeam(document, prepared.teamId);
      if (team.state === "closed") return;
      const member = memberOf(team, prepared.member.sessionId);
      if (member !== undefined && member.state !== "retired" && member.retirement?.intentId === prepared.retirementIntentId) {
        const timestamp = now();
        member.retirement.errorCode = errorCode;
        member.retirement.updatedAt = timestamp;
        if (notStarted) {
          member.retirement.status = "failed";
          member.retirement.stopReason = "not_started";
          member.state = prepared.priorState;
          member.shutdownUnconfirmed = undefined;
          member.stopUnconfirmed = undefined;
          member.error = undefined;
          delete member.terminalDiagnostic;
        } else {
          member.state = "failed";
          member.shutdownUnconfirmed = true;
          member.stopUnconfirmed = true;
          member.error = `graceful retirement remains unconfirmed (${errorCode})`;
        }
        member.updatedAt = timestamp;
        team.updatedAt = timestamp;
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
      if (!force && gracefulEnd?.runId !== undefined) bindMemberRetirementTarget(member, prepared.retirementIntentId, gracefulEnd.runId);
      confirmMemberRetired(member, { stopReason: force ? "drained" : gracefulEnd?.stopReason ?? "completed" });
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
      if (team.state !== "closing") requireTeamCleanupState(team, input.allowPausedCleanup);
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
      if (team.state !== "closing") requireTeamCleanupState(team, input.allowPausedCleanup);
      const unacceptedTaskIds = team.tasks.filter(taskAwaitsAcceptance).map((task) => task.id);
      if (!force && unacceptedTaskIds.length > 0) reject(`team has submitted tasks awaiting independent lead acceptance: ${unacceptedTaskIds.join(", ")}`, "AGENT_TEAMS_ACCEPTANCE_REQUIRED");
      const unfinishedTaskIds = team.tasks.filter((task) => !taskIsTerminal(task)).map((task) => task.id);
      if (!force && unfinishedTaskIds.length > 0) reject(`team has unfinished tasks; complete or cancel them before graceful shutdown: ${unfinishedTaskIds.join(", ")}`, "AGENT_TEAMS_UNFINISHED_TASKS");
      const workers = team.members.filter((member) => member.kind === "worker" && member.state !== "retired");
      if (!force && workers.some(memberRetirementBlocksRetry)) reject("a prior graceful team shutdown still lacks exact lifecycle resolution; use force only after confirming every target worker", "AGENT_TEAMS_SHUTDOWN_UNCONFIRMED");
      const wasPaused = team.state === "paused" || USER_PAUSED_TEAMS.has(team.id);
      const pauseEpoch = team.pauseEpoch ?? 0;
      team.state = "closing";
      const preparedWorkers = workers.map((member) => {
        const priorState = member.state;
        markMemberShuttingDown(member, force || wasPaused, { pauseEpoch, scope: "team" });
        return { ...clone(member), priorState, retirementIntentId: member.retirement?.intentId };
      });
      team.updatedAt = now();
      return { teamId: team.id, workers: preparedWorkers, wasPaused, pauseEpoch };
    });
  }));

  let drainError;
  let outcomes = [];
  // A paused team is drained without sending retirement prompts or waking it.
  const drainOnly = force || prepared.wasPaused;
  if (drainOnly) {
    const admissionBindings = prepared.workers.map((member) => ({ childId: member.sessionId, generation: admission?.current?.(member.sessionId)?.generation }));
    try {
      await drainContinuableChildrenWithDeadline(ctx, lead, prepared.workers.map((member) => member.sessionId), signal);
      for (const binding of admissionBindings) admission?.confirmDrained?.(binding.childId, binding.generation);
    } catch (error) {
      drainError = error;
    }
  } else {
    const gracefulRequests = prepared.workers.map((member) => ({ member, waiter: registerGracefulLifecycleWaiter(member.sessionId), continuationGeneration: admission.current?.(member.sessionId)?.generation, dispatchBegan: false }));
    outcomes = await Promise.allSettled(gracefulRequests.map(async (request) => {
      const { member, waiter } = request;
      try {
        let gracefulEnd;
        await runWithLifecycleDeadline(async (lifecycleSignal) => {
          await admission.run(lead, member.sessionId, lifecycleSignal, async () => {
            request.dispatchBegan = true;
            requireExactRootAgent(ctx, lead);
            return queueAgentTeamPrompt(ctx.subagents, lead, member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
              source: relaySource(lead.id), signal: lifecycleSignal,
            });
          }, request.continuationGeneration);
          const targetRunId = admission.current?.(member.sessionId)?.runId ?? GRACEFUL_ACTIVE_RUNS.get(member.sessionId);
          if (targetRunId !== undefined) await store.runOperation(() => store.mutate((document) => {
            const team = findTeam(document, prepared.teamId);
            const durableMember = memberOf(team, member.sessionId);
            if (durableMember !== undefined && bindMemberRetirementTarget(durableMember, member.retirementIntentId, targetRunId)) team.updatedAt = durableMember.retirement.updatedAt;
          }));
          waiter.accept();
          gracefulEnd = await waitForGracefulLifecycle(waiter, lifecycleSignal);
        }, { signal, label: `graceful retirement for ${member.sessionId}` });
        return gracefulEnd;
      } catch (error) {
        waiter.cancel();
        throw error;
      }
    }));
    prepared.gracefulRequests = gracefulRequests;
  }

  const result = await queueTeamOperation(store.filePath, prepared.teamId, () => store.runOperation(() => store.mutate((document) => {
    const team = findTeam(document, prepared.teamId);
    if (team.state === "closed") return { team: projectTeam(team), failures: [] };
    requireLiveRootLead(ctx, team, lead);
    if ((team.pauseEpoch ?? 0) !== prepared.pauseEpoch) reject("team stop epoch changed during cleanup", "AGENT_TEAMS_PAUSED");
    const failures = [];
    if (drainOnly) {
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
        const preparedMember = prepared.workers[index];
        const request = prepared.gracefulRequests[index];
        const member = memberOf(team, preparedMember.sessionId);
        if (outcome.status === "fulfilled") {
          if (member !== undefined) {
            if (outcome.value?.runId !== undefined) bindMemberRetirementTarget(member, preparedMember.retirementIntentId, outcome.value.runId);
            confirmMemberRetired(member, { stopReason: outcome.value?.stopReason ?? "completed" });
          }
          return;
        }
        const errorCode = boundedDiagnosticCode(outcome.reason, "AGENT_TEAMS_GRACEFUL_RETIREMENT_FAILED");
        failures.push(`graceful retirement failed (${errorCode})`);
        if (member !== undefined && member.state !== "retired" && member.retirement?.intentId === preparedMember.retirementIntentId) {
          const timestamp = now();
          member.retirement.errorCode = errorCode;
          member.retirement.updatedAt = timestamp;
          if (!request.dispatchBegan) {
            member.retirement.status = "failed";
            member.retirement.stopReason = "not_started";
            member.state = preparedMember.priorState;
            member.shutdownUnconfirmed = undefined;
            member.stopUnconfirmed = undefined;
            member.error = undefined;
            delete member.terminalDiagnostic;
          } else {
            member.state = "failed";
            member.shutdownUnconfirmed = true;
            member.stopUnconfirmed = true;
            member.error = `graceful retirement remains unconfirmed (${errorCode})`;
          }
          member.updatedAt = timestamp;
        }
      });
    }
    const shouldClose = failures.length === 0 && team.members.filter((member) => member.kind === "worker").every((member) => member.state === "retired");
    if (shouldClose) closeTeamRecord(team, force ? "team was force-closed before unfinished work completed" : "team closed after all tracked work was submitted, accepted, or explicitly cancelled", { forced: force });
    else {
      team.state = prepared.wasPaused ? "paused" : failures.length === 0 ? "closing" : "active";
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
function teamSnapshotAuthorizationSignature(document) {
  return JSON.stringify(document.teams.map((team) => [
    team.id,
    team.rootLeadSessionId,
    team.projectKey ?? null,
    team.revision ?? 1,
    team.state,
    team.pauseEpoch ?? 0,
    (LAZY_TEAM_VIEW_STATES.get(team)?.entry.index.members ?? team.members).map((member) => [member.id, member.sessionId, member.kind, member.state]),
  ]));
}
function teamSnapshotIndex(document) {
  const trustedMetadata = STORE_PROJECTION_METADATA.get(document);
  const authorizationSignature = trustedMetadata === undefined
    ? teamSnapshotAuthorizationSignature(document)
    : `${trustedMetadata.storeId}:${trustedMetadata.serial}:${trustedMetadata.branchKey}`;
  let index = TEAM_SNAPSHOT_INDEXES.get(document);
  if (index?.authorizationSignature === authorizationSignature) return index;
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
    const indexedMembers = LAZY_TEAM_VIEW_STATES.get(team)?.entry.index.members ?? team.members;
    for (const member of indexedMembers) {
      const related = bySession.get(member.sessionId) ?? [];
      related.push(team);
      bySession.set(member.sessionId, related);
    }
  }
  index = { authorizationSignature, bySession, byRoot, byProject, boards: new Map() };
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
function authorizeTeamSnapshot(document, sessionId, selectedTeamId) {
  // Authorization is intentionally recomputed before every cache lookup. The
  // per-document index is reused only after a fresh membership signature proves
  // that its exact session/team ACL relation is unchanged.
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
  return { index, ordered, selected, peerTeams, projectTeams };
}
function teamSnapshotFromAuthorization(document, sessionId, authorization) {
  const { index, ordered, selected, peerTeams, projectTeams } = authorization;
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
function teamSnapshot(document, sessionId, selectedTeamId) {
  return teamSnapshotFromAuthorization(document, sessionId, authorizeTeamSnapshot(document, sessionId, selectedTeamId));
}
function projectionCacheMode(value = process.env[TEAM_PROJECTION_CACHE_ENV]) {
  const configured = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "on", "enabled"].includes(configured)) return "enabled";
  if (["shadow", "verify", "a-b"].includes(configured)) return "shadow";
  if (["0", "false", "off", "disabled", "legacy", "rollback"].includes(configured)) return "disabled";
  return "disabled";
}
function untrustedStoreProjectionMetadata(document) {
  const artifact = jsonArtifact(document);
  const header = {
    version: document.version ?? STORE_VERSION,
    settings: clone(document.settings ?? {}),
    routingReceipts: clone(document.routingReceipts ?? []),
    routingReceiptArchive: clone(document.routingReceiptArchive ?? { version: 1, count: 0, chainHash: "0".repeat(64) }),
  };
  return createStoreProjectionMetadata({
    storeId: `untrusted:${artifact.hash}`,
    serial: 0,
    mode: "content",
    branchKey: JSON.stringify(["agent-teams-content", artifact.hash, artifact.size]),
    previousBranchKey: undefined,
    canReusePrevious: false,
    header,
    entries: document.teams.map(projectionTeamIdentityFromDocument),
  });
}
function teamProjectionCacheIdentity(document, sessionId, selectedTeamId, selectedTaskId, authorization) {
  const metadata = STORE_PROJECTION_METADATA.get(document) ?? untrustedStoreProjectionMetadata(document);
  const { selected, peerTeams, projectTeams } = authorization;
  const selectedIdentity = selected === undefined ? undefined : metadata.entryMap.get(selected.id) ?? projectionTeamIdentityFromDocument(selected);
  // Durable member/team state is already inside the exact team hashes. Only the
  // process-local Stop overlay can change without a Store publication, so bind it
  // explicitly without allocating per-hit cryptographic digests.
  const pausedTeamIds = [...new Set([...authorization.ordered, ...peerTeams, ...projectTeams]
    .filter((team) => USER_PAUSED_TEAMS.has(team.id)).map((team) => team.id))].sort();
  const rootProjectionHash = selected === undefined ? null : metadata.rootProjectionHashMap.get(selected.rootLeadSessionId) ?? null;
  const semanticKey = JSON.stringify([
    "agent-teams-ui-projection-cache-v1",
    metadata.storeId,
    metadata.settingsHash,
    sessionId,
    selectedTeamId ?? null,
    selectedTaskId ?? null,
    selected?.id ?? null,
    selected?.rootLeadSessionId ?? null,
    selected?.projectKey ?? null,
    selectedIdentity === undefined ? null : [selectedIdentity.hash, selectedIdentity.revision, selectedIdentity.pauseEpoch, selectedIdentity.authorizationEpoch, selectedIdentity.ownershipHash],
    metadata.sessionSemanticHashMap.get(sessionId) ?? null,
    metadata.rootSemanticHashMap.get(selected?.rootLeadSessionId) ?? null,
    selected?.projectKey === undefined ? null : metadata.projectSemanticHashMap.get(selected.projectKey) ?? null,
    rootProjectionHash,
    pausedTeamIds,
  ]);
  const exactKey = JSON.stringify([
    "agent-teams-ui-projection-cache-entry-v1",
    metadata.storeId,
    metadata.serial,
    metadata.branchKey,
    semanticKey,
  ]);
  return { metadata, semanticKey, exactKey };
}
const canonicalTeamProjectionCandidate = (_document, _sessionId, _selectedTeamId, _selectedTaskId, _authorization, canonical) => canonical;
function createTeamProjectionCache({
  maxBytes = TEAM_PROJECTION_CACHE_MAX_BYTES,
  mode,
  canonicalSnapshot = teamSnapshot,
  candidateSnapshot = canonicalTeamProjectionCandidate,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > TEAM_PROJECTION_CACHE_MAX_BYTES) throw new TypeError(`maxBytes must be a positive safe integer no greater than ${TEAM_PROJECTION_CACHE_MAX_BYTES}`);
  if (typeof canonicalSnapshot !== "function" || typeof candidateSnapshot !== "function") throw new TypeError("projection cache snapshots must be callable");
  const entries = new Map(), semanticEntries = new Map();
  let bytes = 0, closed = false, circuitOpen = false, disabledReason, lastMode;
  const counters = { hits: 0, misses: 0, semanticReuses: 0, shadowMatches: 0, mismatches: 0, failures: 0, promotions: 0, evictions: 0 };
  const configuredMode = () => {
    const resolved = projectionCacheMode(typeof mode === "function" ? mode() : mode);
    return TEAM_PROJECTION_CACHE_MODES.has(resolved) ? resolved : "disabled";
  };
  const removeEntry = (entry) => {
    if (entries.get(entry.exactKey) !== entry) return;
    entries.delete(entry.exactKey);
    bytes -= entry.bytes;
    const related = semanticEntries.get(entry.semanticKey);
    related?.delete(entry);
    if (related?.size === 0) semanticEntries.delete(entry.semanticKey);
    SSE_SNAPSHOT_ENCODINGS.delete(entry.snapshot);
    entry.snapshot = undefined;
    entry.jsonByteLength = undefined;
    entry.payload = undefined;
  };
  const clear = () => {
    for (const entry of entries.values()) SSE_SNAPSHOT_ENCODINGS.delete(entry.snapshot);
    entries.clear();
    semanticEntries.clear();
    bytes = 0;
  };
  const trip = (reason, mismatch = false) => {
    clear();
    circuitOpen = true;
    disabledReason = String(reason ?? "projection_cache_failure").slice(0, 512);
    if (mismatch) counters.mismatches += 1;
    else counters.failures += 1;
  };
  const touch = (entry) => {
    entries.delete(entry.exactKey);
    entries.set(entry.exactKey, entry);
    return entry.snapshot;
  };
  const insert = (identity, snapshot, jsonByteLength, payload) => {
    const entryBytes = (jsonByteLength * 2) + Buffer.byteLength("event: snapshot\ndata: \n\n") + Buffer.byteLength(identity.exactKey) + Buffer.byteLength(identity.semanticKey);
    if (entryBytes > maxBytes) return snapshot;
    const entry = { exactKey: identity.exactKey, semanticKey: identity.semanticKey, serial: identity.metadata.serial, bytes: entryBytes, snapshot, jsonByteLength, payload };
    SSE_SNAPSHOT_ENCODINGS.set(snapshot, payload);
    entries.set(entry.exactKey, entry);
    const related = semanticEntries.get(entry.semanticKey) ?? new Set();
    related.add(entry);
    semanticEntries.set(entry.semanticKey, related);
    bytes += entry.bytes;
    while (bytes > maxBytes && entries.size > 0) {
      counters.evictions += 1;
      removeEntry(entries.values().next().value);
    }
    return snapshot;
  };
  const project = (document, sessionId, selectedTeamId, selectedTaskId) => {
    let activeMode;
    try { activeMode = configuredMode(); }
    catch (error) {
      trip(error?.message ?? error);
      return canonicalSnapshot(document, sessionId, selectedTeamId, selectedTaskId);
    }
    if (activeMode !== lastMode) {
      clear();
      lastMode = activeMode;
    }
    if (closed || circuitOpen || activeMode === "disabled") return canonicalSnapshot(document, sessionId, selectedTeamId, selectedTaskId);
    let authorization, identity;
    try {
      authorization = authorizeTeamSnapshot(document, sessionId, selectedTeamId);
      identity = teamProjectionCacheIdentity(document, sessionId, selectedTeamId, selectedTaskId, authorization);
      if (activeMode === "enabled") {
        const exact = entries.get(identity.exactKey);
        if (exact !== undefined) { counters.hits += 1; return touch(exact); }
        if (identity.metadata.canReusePrevious) {
          const reusable = [...(semanticEntries.get(identity.semanticKey) ?? [])].find((entry) => entry.serial === identity.metadata.serial - 1);
          if (reusable !== undefined) {
            counters.hits += 1;
            counters.semanticReuses += 1;
            return insert(identity, reusable.snapshot, reusable.jsonByteLength, reusable.payload);
          }
        }
      }
    } catch (error) {
      trip(error?.message ?? error);
      return canonicalSnapshot(document, sessionId, selectedTeamId, selectedTaskId);
    }
    counters.misses += 1;
    const canonical = canonicalSnapshot(document, sessionId, selectedTeamId, selectedTaskId);
    let candidate, candidateByteLength, candidateText;
    try {
      // The built-in enabled path owns this freshly authorized pure projection, so
      // freezing it directly preserves isolation without parsing the same JSON again.
      // Shadow/custom candidates retain the independent byte-for-byte A/B guard.
      const canonicalText = JSON.stringify(canonical);
      if (activeMode === "enabled" && canonicalSnapshot === teamSnapshot && candidateSnapshot === canonicalTeamProjectionCandidate) {
        candidate = deepFreeze(canonical);
        candidateText = canonicalText;
        candidateByteLength = Buffer.byteLength(canonicalText);
      } else {
        const canonicalBytes = Buffer.from(canonicalText, "utf8");
        const candidateValue = candidateSnapshot(document, sessionId, selectedTeamId, selectedTaskId, authorization, canonical);
        let candidateBytes;
        if (candidateValue === canonical) {
          candidate = deepFreeze(JSON.parse(canonicalText));
          candidateBytes = canonicalBytes;
          candidateText = canonicalText;
        } else {
          candidate = immutableClone(candidateValue);
          candidateText = JSON.stringify(candidate);
          candidateBytes = Buffer.from(candidateText, "utf8");
        }
        const bytesMatch = candidateBytes === canonicalBytes || canonicalBytes.equals(candidateBytes);
        const canonicalHash = sha256Bytes(canonicalBytes), candidateHash = bytesMatch ? canonicalHash : sha256Bytes(candidateBytes);
        if (!bytesMatch || canonicalHash !== candidateHash) {
          trip(`shadow_mismatch:${canonicalHash}:${candidateHash}`, true);
          return canonical;
        }
        candidateByteLength = candidateBytes.length;
      }
      counters.shadowMatches += 1;
    } catch (error) {
      trip(error?.message ?? error);
      return canonical;
    }
    if (activeMode === "shadow") return canonical;
    const payload = `event: snapshot\ndata: ${candidateText}\n\n`;
    counters.promotions += 1;
    return insert(identity, candidate, candidateByteLength, payload);
  };
  const stats = () => Object.freeze({
    mode: closed ? "closed" : circuitOpen ? "disabled" : lastMode ?? configuredMode(),
    closed,
    circuitOpen,
    disabledReason,
    bytes,
    maxBytes,
    entries: entries.size,
    ...counters,
  });
  const close = () => { if (closed) return; closed = true; clear(); };
  return Object.freeze({ clear, close, project, stats });
}
function teamSnapshotWithAutopilotAuthorization(ctx, document, sessionId, selectedTeamId, projectStoreSnapshot = teamSnapshot) {
  const storeSnapshot = projectStoreSnapshot(document, sessionId, selectedTeamId);
  const root = ctx.agents?.get?.(sessionId);
  const team = document.teams.find((candidate) => candidate.id === storeSnapshot.activeTeamId);
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
  return {
    ...storeSnapshot,
    autopilotAuthorization: scope,
    cursor: JSON.stringify([storeSnapshot.cursor, scope === null ? null : [scope.rootSessionId, scope.projectKey, scope.goalId, scope.teamId, scope.pauseEpoch, scope.teamScopeHash]]),
  };
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
    `Configured capacity is ${capacityPolicy.maxMembers} managed member(s) per team and ${capacityPolicy.maxActiveTurns} simultaneously active member(s) across all teams owned by this root. The root lead consumes neither managed-member quota nor a managed active-turn slot. These values are ceilings, not a target roster size: choose the number justified by sustained independent workstreams. A complete bootstrap plan may contain up to ${bootstrapCapacity} visible peers right now; its durable task array is independently bounded and may contain more tasks because one member can own several sequential tasks. If maxMembers is higher than maxActiveTurns, create or start additional members only as active-turn capacity becomes available.`,
    "Before substantive work on every ordinary direct-human root turn, and before first creating an Agent Team during an exact admitted continuation of that root's active, armed goal, apply the three-level gate below and persist exactly one Host-scoped routing decision for that root/turn/project: all three levels call team_route_goal first; for Level 3, team_start/team_bootstrap then finalize that same immutable decision with the creation outcome and Host-validated team. Decision content is model-declared; the receipt is an audit record only, does not force or prove model-route selection, and model input cannot choose another root, project, turn, or team scope. When Level 3 conditions are met, choose exactly one creation path in that same authorized turn: use team_bootstrap when the complete bounded task/member plan is already known; otherwise use team_start and then the existing task/spawn tools. Never ask the user to send “continue” merely to cross from an admitted automatic goal round into safe internal team creation. Never call both team_start and team_bootstrap for the same team, and never replace the required visible managed members with multiple hidden ordinary subagents.",
    "Keep durable team task state synchronized at every handoff: members must explicitly complete finished tasks before their final report, and the root lead must reconcile every task before retiring members or closing the team. A report or successful subagent turn is not completion evidence. Graceful retirement and shutdown require no unfinished owned work; while automatic continuation is live, graceful retirement also refuses to remove the last assignable worker if unfinished unclaimed tasks remain. Assign another worker or reconcile that work first. Force shutdown remains an explicit recovery path and records unfinished work as cancelled rather than leaving permanent pending tasks.",
    "Once an Agent Team is established for the current goal, the root lead defaults to coordination only: decompose the user's objective into substantive outcomes, persist and assign durable tasks, coordinate dependencies and handoffs, monitor and reconcile task state, review and accept member deliverables, then perform final integration and user-facing synthesis. The root lead must not personally implement, research, design, test, or otherwise substitute for a core professional deliverable that is assigned or should be assigned to a member role. If substantive coverage is missing, create or restructure the relevant durable task and assign or expand the visible team instead of absorbing that work; the root may make only minimal glue changes required to integrate accepted member outputs.",
    "Scope discipline: the team objective and latest direct user request bound the work. Status and task creation include an observed scope summary: tasks at first worker publication versus tasks added afterwards. These are internal task counts, not user requirement counts or approval evidence. Before adding work after execution starts, identify its connection to the requested outcome; defer unrelated findings instead of converting every discovery into another task. When the user asks to stop expansion, finish only the authorized necessary repair, validation and delivery. Do not resume cancelled work to simplify cleanup: in a direct-human root turn, paused tasks can be cancelled and the whole team can be closed directly; execution, reassignments and acceptance still remain behind Stop.",
    "For normal waiting inside the current already-authorized turn, use team_status with wait_for_change:true and the selected team_id instead of polling tools or narrating unchanged progress. This passive, cancellable event subscription holds the current tool call; it does not park/resume a Goal, grant autopilot authority, start workers, or extend any round budget. Check wait.reason: cancelled/stopped means stop, attention means reconcile the actual pending decision or missing producer once, changed means inspect the newly returned state. Do not repeatedly call after an unchanged attention result. No-change waiting needs no assistant report; report real deliveries, scope changes, decisions and blockers only. The separate automatic Goal wake rules below remain unchanged.",
    autopilotPolicy.enabled
      ? `Agent Team waiting is event-driven, and the trusted Host automatic-continuation preference is ON with a fixed budget of at most ${autopilotPolicy.maxAdditionalRounds} extra goal rounds. First inspect team_status: only when every open team reports autopilot.status=active and every unfinished safe internal task is either owned by a live worker or blocked on such work may you end the current turn without polling team_status and without asking the user to send ‘continue’. The Host parks normal waiting; it is not a blocked Goal outcome. Only a new claim-bound durable task submission, a worker transition to failed, or a durable dependency/reference/satisfaction change wakes the exact fixed root through the established work-transition path. A first canonical durable expansion proposal is the sole additional structural-review wake. Worker release, ready/idle transitions, checkpoints, and duplicate projections do not spend a round. Reordered or synonymous duplicate expansion proposals also do not spend a round. If the goal's configured round slice is exhausted, the Host grants exactly one additional round for that durable transition. This grant is not a timer, retry loop, or permission upgrade: missing/revoked grants, paused teams, cross-project scope, unknown capabilities, file conflicts, non-none/outcome_unknown effects, explicit Stop/resume, real safety blockers, permission anomalies, orphan/outcome_unknown recovery, handoff, external confirmation boundaries, or the finite budget remain stopped and require manual recovery.`
      : "The trusted Host automatic-continuation preference is OFF. Do not end a coordinator turn on the assumption that worker progress will wake it, and do not claim that the Host will extend goal rounds. Finish currently actionable coordination in this turn; if a safe team must continue across future rounds, explain that automatic continuation can be explicitly enabled in Agent Teams settings. Never repeatedly ask the user to send ‘continue’ as a substitute for that setting.",
    "A missing/revoked grant means the scheduler has no wake/state-hash authority and cannot park an armed Goal: never manually resume that Goal or treat ordinary Goal rounds, team_status reads, or coordinator progress messages as autopilot wakes. One globally saved Desktop Host proof may derive an exact complete root-team grant group only at a direct-human team creation, direct-human plan commit, or committed two-phase Resume boundary, and only while every team remains safe; a direct-human plan recommit may rebind an already-live complete group without another settings Save. Lifecycle cleanup revokes persisted team grants locally but keeps the global proof, and only a later exact direct-human boundary may safely rederive them; Stop recovery is limited to committed two-phase Resume with a current proof. Handoff, scope/Goal drift, true terminal safety revocation, unknown capability, file conflict, or non-ordinary effect still fail closed and are never overridden by the global default.",
    "A team's durable tasks and member roles must collectively cover the substantive outputs required to satisfy the user's goal, each with a real deliverable and observable acceptance criteria. Never create decorative, token, or review-only members while leaving the core professional output to the root lead; if the work does not justify delegating its substantive production, do not create a team.",
    "Only the outermost top-level root lead/brain evaluates each ordinary direct-user goal using a strict three-level gate. Level 1 — main model: Complete simple, tightly coupled, or non-parallel work alone. Level 2 — ordinary subagent: when only one auxiliary executor is needed, use an official normal subagent or subagent_fork even if that single helper must be continuable or work across multiple turns. Level 3 — Agent Team: in automatic mode, proactively choose one Agent Team creation path only when the goal normally has at least two sustained, genuinely independent workstreams that need delegation to different visible managed members; the root/lead's own work or coordination does not count as the second workstream. The work must also require ongoing coordination across turns, such as shared tasks, dependencies, handoffs, or status tracking. An explicit user request for a team may still be followed, but automatic mode must not create a one-worker team. Parallelism by itself is not enough for a team; the user does not need to say ‘create a team’, design members, or know the team tools. Never create a team merely to fill seats, demonstrate the feature, or make routine work look parallel. When an active team's objective needs another delegation, it must be added as a visible managed member rather than a hidden ordinary subagent. Managed team members must never create teams or fan out through subagent, subagent_fork, workflow, or ralph; if they need more parallel work, they must report that need to the root, which decides whether to spawn another visible member under maxActiveTurns. A member may report only from its own in-progress task through team_expansion_request; the request is a proposal, never authority to spawn.",
    "When a new team already has a complete bounded task/member plan that fits the configured bootstrap capacity described above, call team_bootstrap directly with a stable request_id and do not call team_start first. Otherwise team_start creates a draft: persist tasks, then use team_plan_commit with the exact plan revision and confirmed_plan_hash before any team_spawn. Without durable successful worker-publication history that CAS persists phase committed; the first fully successful spawn records publication and activates it, while later recommit persists active even after every published worker gracefully retires. Provisioning or initial publication/work-followup failure never establishes this history. Upgraded retired workers without the new marker qualify only through a task submission/result or checkpoint bound to their exact historical claim; retired state alone and former-root adoption history do not qualify. Both committed and active pass new claim/spawn execution gates. New team creation and bootstrap require either the current direct-human root turn or the exact admitted automatic continuation of the same root's active, armed goal; every other non-human turn remains forbidden. After that authorized establishment and one successful worker publication, the same exact live root may recommit a later draft during an automatic goal round without another user message only while the team remains active and unpaused in the same canonical project, every capability is individually verified, file scopes are conflict-free, cost stays within the direct user's ordinary default AI-routing grant, every effect policy is none, and no outcome is unknown. Public spawn always requires non-empty persisted task_ids, and the Host atomically pre-binds those tasks with the member placeholder before child creation. Bootstrap validates its pure plan and exact real workspace before terminalizing its routing receipt, persists all tasks before starting members, and exact replay reuses its plan. If pre-publication start fails, correct the cause and replay the same request_id; if a member may exist or was published, use the returned recovery/reconciliation path instead of replaying Bootstrap. Never call team_status/team_spawn after a bootstrap error that returned no team_id. A queued team_message is transport-accepted only and is not proof that its body reached the recipient model. Neither path may bypass capacity checks, file-scope separation, capability preflight, or explicit review of partial/uncertain starts.",
    "An ordinary effect-free internal team needs no redundant confirmation for a dynamically safe automatic-round recommit. When a worker is definitively failed and the exact active autopilot grant, Goal round, file scopes, capabilities, and effect-free plan remain valid, use team_member_recover automatically in that Goal round. Retry once when the exact failed session and unchanged claim/lease remain viable; otherwise replace it with one visible same-level member. Choose from the live Host state and never ask the user to send a recovery phrase or choose the safe internal action. Plan authority remains explicitly host_verified, human_attested, or unknown: a continuing/default grant stays human_attested and never becomes Host proof. Tool/model booleans can create only human_attested facts, never host_verified facts, and can never bulk-upgrade unknown capability records. Any material change to task scope, file ownership, capability/permission facts, model-cost class, or external effects returns the plan to draft and requires a fresh exact-hash CAS commit. New team creation and bootstrap remain behind the direct-human-or-exact-admitted-goal-round gate. Stop recovery/resume, handoff/adopt/orphan recovery, outcome_unknown reconciliation, cross-project scope, unknown/unavailable or separately billed capabilities, conflicting files, and confirm_each/idempotent/forbidden effects remain behind their stricter direct-human or Host gates. An already active main-tier worker does not itself create a new cost grant or block safe continuation.",
    "A task claim returns claimId and leaseEpoch. Members must echo both for checkpoint, submission, or release; stale attempts are rejected and only an exact submission replay is a no-op. Worker complete moves the task only to submitted/in-review and appends an immutable claim-bound submission event. It does not complete the task, unlock dependencies, or permit graceful retirement. Only a later fixed-root accept of the current submission moves it to authoritative completed and appends acceptance; reject/reopen/cancel never erase older lifecycle events. Member checkpoints and next steps are unverified annotations separate from the five task states (pending, in_progress, submitted, completed, cancelled). External effect keys are Host-derived from stable team/task/effect identity. Only participating idempotency protocols can claim exactly-once; outcome_unknown blocks retry until an exact direct-human root resolves it.",
    "Team ownership may move only through team_handoff then team_adopt: both require direct-human root turns, the team must be durably paused, source and target must be exact live roots with the same canonical projectKey, and adoption must present the short-lived single-use token. Adoption increments pauseEpoch, revokes every old claim/lease, retires old-parent workers for bounded audit history, safely releases unfinished work to pending, and never wakes anyone automatically. Unknown scope and cross-project adoption fail closed.",
    "For every team_expansion_request, the fixed root lead approves only when the remaining outcomes are genuinely parallel and independent, inputs and acceptance criteria are explicit, file/external-resource ownership does not conflict, the handoff context is small, critical-path reduction or independent-review value materially exceeds coordination cost, and current member/turn/task budget is sufficient. The Host compares proposed file scopes with other in-progress task files and checks proposal-internal resource hierarchy, but existing external-resource ownership is not persisted and must be verified by the root. If a broad source task is split, first release/restructure it so its in-progress file scope no longer overlaps; then call team_task_create for each accepted durable outcome and only then call team_spawn for visible same-level peers. If a provider admission fails definitively before dispatch, the exact spawn identity remains in a bounded FIFO provisioning queue and retries only after a real later capacity/lifecycle release; do not ask for continue, retry manually, or create a duplicate member. Stop, revoked authority, stale plan/scope, unsafe capability/effect/conflict state, and dispatch outcome_unknown stay fail-closed. If the proposal is rejected, explain the reason to the requester. Never invent a leader→group-leader→hidden-worker hierarchy.",
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
  const changeWaiter = createTeamChangeWaiter(ctx, store);
  ctx.effect(() => () => changeWaiter.dispose());
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
    description: "CAS-commit the current durable draft plan. Without durable successful worker-publication history it persists committed; the first fully successful spawn records publication and activates it, and that history survives graceful retirement while provisioning or initial publication/work-followup failure never establishes it. Upgraded retired workers without the marker require an exact task execution receipt; retired state alone does not qualify. Initial establishment requires direct-human root authority. A later automatic goal round may recommit without a new user message only for the same exact live root and canonical project while the team is active/unpaused, every capability is verified, files are conflict-free, cost remains inside the user's ordinary default AI-routing grant, and every effect is policy none with no outcome_unknown. Any unsafe or uncertain fact fails closed. Continuing/default authority remains human_attested, never host_verified; material changes still require the exact current hash and revision. A direct-human commit may use the globally saved Desktop Host proof to derive or rebind one exact complete safe root-team grant group without another per-team Save; ordinary Goal rounds, agent messages, terminal safety revocations, and unsafe facts cannot do so.",
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
      await store.read(() => undefined);
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const automaticGoalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      const directHumanGrantIntent = !directHuman || !store.autopilotPolicy().enabled ? undefined : await exactDirectHumanAutopilotGrantIntent(ctx, authorizationProvider, execution);
      return publicResult(await commitTeamPlan(ctx, store, execution.agent, { teamId: args.team_id, expectedRevision: args.expected_revision, confirmedPlanHash: args.confirmed_plan_hash, permissionsVerified: args.permissions_verified, filesVerified: args.files_verified, costVerified: args.cost_verified, externalSideEffectsVerified: args.external_side_effects_verified, automaticContinuation: !directHuman, automaticGoalRoundAuthority, authorizationProvider, ...(directHuman ? { autopilotGoal: ctx.goals?.get?.(execution.agent), directHumanGrantIntent } : {}) }));
    }),
    presentCall: (args) => present("Commit agent team plan", args.team_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_bootstrap",
    description: "Create one bounded team plan, persist all tasks before work starts, and provision up to the configured member/active-turn capacity (hard maximum 8 visible peers; all are managed peers and the root lead is not a managed-member slot). Task count is independently bounded by the durable team-task limit, so one member may own several sequential tasks. Pure plan/workspace preflight occurs before a routing receipt can become terminal. Use this directly instead of team_start when the complete plan is ready; never call both for the same team. Different members must have non-overlapping file scopes. Requires either the exact direct-human root turn or the exact admitted automatic continuation of that root's active, armed goal. request_id makes exact replays reuse the same durable plan; pre-publication failure preserves every task and may replay the exact request, while uncertain/published-member failure requires explicit recovery and never duplicates a visible member automatically.",
    parameters: {
      request_id: { type: "string", required: true }, objective: { type: "string", required: true }, name: { type: "string" }, lead_name: { type: "string" },
      explicit_user_team_request: { type: "boolean", description: "Model-declared true only when the direct user explicitly requested a team; this is audited but is not Host proof." },
      candidate_workstreams: { type: "number", required: true, description: "Model-declared number of sustained independent workstreams identified by the routing gate." },
      tasks: { type: "array", required: true, description: `One through ${MAX_BOOTSTRAP_TASKS} durable tasks; this count is independent from the visible-member cap and several tasks may share one member_key.`, items: { type: "object", additionalProperties: false, properties: { key: { type: "string", required: true }, title: { type: "string", required: true }, description: { type: "string" }, member_key: { type: "string", required: true }, depends_on: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } } } } },
      members: { type: "array", required: true, description: `One through ${MAX_BOOTSTRAP_ITEMS} visible managed peers; the root lead does not consume this capacity.`, items: { type: "object", additionalProperties: false, properties: { key: { type: "string", required: true }, name: { type: "string", required: true }, role: { type: "string", required: true }, prompt: { type: "string", required: true }, model_tier: { type: "string", enum: MODEL_TIERS }, model: { type: "string" } } } },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => {
      requireTeamCreationRoot(ctx, execution);
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const establishmentAuthority = directHuman ? "direct_human" : "goal_round";
      const goalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      const routingDecision = { level: "level3", reasonCategory: args.explicit_user_team_request === true ? "explicit_user_team_request" : "independent_sustained_workstreams", explicitUserTeamRequest: args.explicit_user_team_request, candidateWorkstreams: args.candidate_workstreams, creationPath: "team_bootstrap" };
      // Validate the immutable routing material and the complete task/member plan,
      // including the exact real workspace, before a receipt can become terminal.
      // A caller may safely correct pure input and replay the same request_id
      // without encountering a stale `failed` routing outcome.
      const routingProbe = routingReceiptMaterial(execution, { ...routingDecision, outcome: "recorded", establishmentAuthority, goalRoundAuthority });
      const bootstrapInput = {
        requestId: args.request_id,
        objective: args.objective,
        name: args.name,
        leadName: args.lead_name,
        tasks: Array.isArray(args.tasks) ? args.tasks.map((task) => ({ key: task.key, title: task.title, description: task.description, memberKey: task.member_key, dependsOn: task.depends_on, files: task.files })) : args.tasks,
        members: Array.isArray(args.members) ? args.members.map((member) => ({ key: member.key, name: member.name, role: member.role, prompt: member.prompt, modelTier: member.model_tier, model: member.model })) : args.members,
      };
      const checked = await preflightBootstrapTeam(ctx, store, execution.agent, bootstrapInput);
      const directHumanGrantIntent = !directHuman || !store.autopilotPolicy().enabled ? undefined : await exactDirectHumanAutopilotGrantIntent(ctx, authorizationProvider, execution);
      const goalRoundGrantIntent = directHuman || !store.autopilotPolicy().enabled ? undefined : await exactGoalRoundAutopilotGrantIntent(ctx, authorizationProvider, execution, goalRoundAuthority);
      const replayOutcome = await store.read((document) => {
        const currentReceipt = document.routingReceipts.find((receipt) => receipt.rootSessionId === routingProbe.rootSessionId && receipt.turnKey === routingProbe.turnKey);
        return currentReceipt?.outcome === "failed" ? "failed" : "recorded";
      });
      const recorded = await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: replayOutcome, establishmentAuthority, goalRoundAuthority });
      try {
        const result = await bootstrapTeam(ctx, store, admission, execution.agent, { ...bootstrapInput, routingReceiptId: recorded.receipt.id, autopilotGoal: ctx.goals?.get?.(execution.agent), directHumanGrantIntent, goalRoundGrantIntent }, signal, checked);
        if (result.operation.phase === "complete") {
          await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "created", teamId: result.team.id, establishmentAuthority, goalRoundAuthority });
        } else if (result.error?.retryable !== true) {
          await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "failed", establishmentAuthority, goalRoundAuthority });
        }
        const routing = await store.read((document) => ({ receipt: clone(document.routingReceipts.find((receipt) => receipt.id === recorded.receipt.id)), reused: recorded.reused || result.operation.reused }));
        return publicResult({ ...result, routing });
      } catch (error) {
        try { await recordRoutingReceipt(store, execution, { ...routingDecision, outcome: "failed", establishmentAuthority, goalRoundAuthority }); } catch {}
        throw annotateNextAction(error, "inspect the durable bootstrap/team result, then recover with the exact request or failed-member receipt from a new authorized root turn; never create a duplicate team/member");
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
    description: "Retry an exact failed continuable member or replace it with one visible same-level member. A direct-human root turn is accepted, and a safe active autopilot grant automatically authorizes the exact admitted Goal round without another user message; choose retry once for a viable unchanged failed session, otherwise replace automatically. Retry preserves task claims and leases. Replace durably revokes prior claims, preserves audit/checkpoint evidence, and pre-binds the same tasks before starting the replacement. Replays never duplicate a model turn or member; unsafe scope, effects, conflicts, or uncertain outcomes still fail closed.",
    parameters: { team_id: { type: "string", required: true }, member_id: { type: "string", required: true }, action: { type: "string", required: true, enum: MEMBER_RECOVERY_ACTIONS }, request_id: { type: "string", required: true }, expected_revision: { type: "number", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => {
      if (!ctx.agents.roots().includes(execution.agent)) reject("member recovery requires the exact top-level root agent", "AGENT_TEAMS_UNAUTHORIZED");
      const directHuman = hasDirectHumanRootAuthority(ctx, execution);
      const automaticGoalRoundAuthority = directHuman ? undefined : exactGoalRoundRootAuthority(ctx, execution);
      if (!directHuman && automaticGoalRoundAuthority === undefined) reject("member recovery requires a direct-human turn or the exact safe admitted Goal round", "AGENT_TEAMS_DIRECT_HUMAN_REQUIRED");
      return publicResult(await recoverFailedMember(ctx, store, admission, execution.agent, { teamId: args.team_id, memberId: args.member_id, action: args.action, requestId: args.request_id, expectedRevision: args.expected_revision, automaticContinuation: !directHuman, automaticGoalRoundAuthority }, signal));
    }),
    presentCall: (args) => present(args.action === "replace" ? "Replace failed team member" : "Retry failed team member", args.member_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_member_reconcile",
    description: "Direct-human reconciliation for one exact outcome_unknown member-recovery receipt. Reuses the durable request_id and never starts or redelivers a model turn.",
    parameters: { team_id: { type: "string", required: true }, request_id: { type: "string", required: true }, resolution: { type: "string", required: true, enum: ["delivered", "not_delivered"] }, expected_revision: { type: "number", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => { requireDirectHumanRoot(ctx, execution); return publicResult(await reconcileMemberRecovery(ctx, store, execution.agent, { teamId: args.team_id, requestId: args.request_id, resolution: args.resolution, expectedRevision: args.expected_revision }, admission)); }),
    presentCall: (args) => present("Reconcile member recovery", args.request_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_status", description: "Read one authenticated team in detail. If team_id is omitted while several are active, return only safe team summaries so the caller can choose explicitly. A root may set wait_for_change to hold this cancellable tool call silently while members work, until actionable progress or Stop, instead of polling and reporting unchanged status. Passive waiting never grants authority, changes a Goal, wakes workers, or resumes a team; it does not require an autopilot grant. Check wait.reason on return.",
    parameters: { team_id: { type: "string" }, wait_for_change: { type: "boolean", description: "Root-only passive event wait in this current turn, not an automatic Goal wake. No polling timer. Stop cancels it." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => {
      const projectKey = projectKeyForRoot(execution.agent);
      const observation = args.wait_for_change === true ? await changeWaiter.wait(execution.agent, args.team_id, signal) : undefined;
      if (observation?.reason === "scope_changed") reject("team observation scope changed", "AGENT_TEAMS_UNAUTHORIZED");
      if (observation?.reason === "cancelled") return publicResult({ wait: observation });
      if (observation !== undefined && (ctx.agents.get(execution.agent.id) !== execution.agent || projectKeyForRoot(execution.agent) !== projectKey)) reject("team observation root changed", "AGENT_TEAMS_UNAUTHORIZED");
      const result = await store.read((document) => {
      const teamId = optionalString(args.team_id, "team_id", 256);
      if (teamId !== undefined) {
        const team = resolveTeamForCaller(document, teamId, execution.agent.id);
        return publicResult({ settings: document.settings, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)), teams: [projectTeamSummary(team)], selectionRequired: false });
      }
      const candidates = document.teams.filter((team) => team.state !== "closed" && memberOf(team, execution.agent.id) !== undefined)
        .filter((team) => !["shutting_down", "retired"].includes(memberOf(team, execution.agent.id).state));
      if (candidates.length === 0) rejectWithNextAction("caller has no active team", "AGENT_TEAMS_NOT_FOUND", "do not call active-team tools yet; complete or recover team creation first, then retry with the exact returned team_id");
      if (candidates.length > 1) return publicResult({ settings: document.settings, team: null, teams: candidates.map(projectTeamSummary), selectionRequired: true });
      const [team] = candidates;
      return publicResult({ settings: document.settings, team: projectTeam(team, document.teams.filter((candidate) => candidate.rootLeadSessionId === team.rootLeadSessionId)), teams: [projectTeamSummary(team)], selectionRequired: false });
      });
      if (observation !== undefined) {
        const currentTeam = storeReadView(store).teams.find(team => team.id === observation.teamId);
        if (signal.aborted) return publicResult({ wait: { ...observation, reason: "cancelled" } });
        if (!currentTeam || currentTeam.rootLeadSessionId !== execution.agent.id || ctx.agents.get(execution.agent.id) !== execution.agent
          || !ctx.agents.roots().includes(execution.agent) || projectKeyForRoot(execution.agent) !== projectKey) reject("team observation changed during result read", "AGENT_TEAMS_UNAUTHORIZED");
      }
      return observation === undefined ? result : { ...result, wait: observation };
    }), presentCall: (args) => present(args.wait_for_change ? "Wait for team progress" : "Read team status"),
  }));
  ctx.tools.register(defineTool({
    name: "team_message", description: "Queue an authenticated coordinator relay. Cross-team relay requires target_team_id and is allowed only when the caller is the same fixed root lead of both peer teams. A queued result proves transport acceptance only, not that the recipient model received the body; never report queued as delivered.",
    parameters: { team_id: { type: "string" }, target_team_id: { type: "string", description: "Optional peer team owned by the same fixed root lead." }, recipient_session_id: { type: "string", required: true, description: "Recipient session id, member id, or unique member name in the target team." }, message: { type: "string", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await sendTeamMessage(ctx, store, admission, execution.agent, { teamId: args.team_id, targetTeamId: args.target_team_id, recipientSessionId: args.recipient_session_id, message: args.message }, signal))),
    presentCall: (args) => present("Relay team message", args.recipient_session_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_expansion_request",
    description: "Submit exactly one structured, durable expansion proposal from the exact active worker that owns the cited in-progress task to its fixed root lead after structural evaluation finds at least two sustained independently deliverable peer workstreams while the requester retains a bounded integration slice. Three or more independent resource domains needing quantified or stress evidence are a strong trigger; elapsed time alone never is. Canonically duplicate or reordered proposals are a zero-write/no-wake no-op. This never spawns, creates tasks, or grants delegation authority. The Host enforces capacity, proposal-internal file/resource separation, and proposed-file conflicts with other in-progress task files; existing external-resource ownership remains a root approval check. The root must reject or first release/restructure a broad source scope, persist accepted tasks, and then spawn visible same-level peers.",
    parameters: {
      team_id: { type: "string", description: "Required only if the caller could participate in more than one unclosed team." },
      source_task_id: { type: "string", required: true, description: "The requesting worker's own in-progress durable task." },
      parallel_benefit: { type: "string", required: true, description: "Concrete critical-path or independent-review benefit that exceeds coordination cost." },
      workstreams: {
        type: "array", required: true, description: `Two through ${MAX_EXPANSION_WORKSTREAMS} independent outcomes, each intended for one visible peer member while the requester keeps the integration slice.`,
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
    execute: run(async (args, execution) => {
      const allowPausedCleanup = args.action === "cancel" && authorizePausedTeamCleanup(ctx, execution);
      return publicResult(await updateTask(store, execution.agent, { teamId: args.team_id, taskId: args.task_id, action: args.action, state: args.state, assigneeSessionId: args.assignee_session_id, claimId: args.claim_id, leaseEpoch: args.lease_epoch, requestId: args.request_id, expectedTaskRevision: args.expected_task_revision, expectedPauseEpoch: args.expected_pause_epoch, requireFixedRootCommand: true, allowPausedCleanup }));
    }),
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
    name: "team_resume", description: "Two-phase resume for a team paused by explicit Stop. First call without commit to persist a preview. Then CAS-commit with preview_id, expected_pause_epoch, and expected_team_revision. At that exact direct-human commit boundary, a current global Desktop Host proof may derive the complete safe root-team autopilot grant group; abnormal nodes and unsafe facts remain attention items and no member is woken automatically.",
    parameters: { team_id: { type: "string", description: "Optional only when the root lead owns exactly one paused team." }, request_id: { type: "string", description: "Optional request id. Replaying it returns the same durable preview/receipt." }, commit: { type: "boolean", description: "False/omitted creates a preview; true CAS-commits it." }, preview_id: { type: "string" }, expected_pause_epoch: { type: "number" }, expected_team_revision: { type: "number" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => {
      requireDirectHumanRoot(ctx, execution);
      await store.read(() => undefined);
      const directHumanGrantIntent = args.commit === true && store.autopilotPolicy().enabled
        ? await exactDirectHumanAutopilotGrantIntent(ctx, authorizationProvider, execution)
        : undefined;
      return publicResult(await resumePausedTeam(ctx, store, execution.agent, { teamId: args.team_id, requestId: args.request_id, commit: args.commit, previewId: args.preview_id, expectedPauseEpoch: args.expected_pause_epoch, expectedTeamRevision: args.expected_team_revision, autopilotGoal: ctx.goals?.get?.(execution.agent), directHumanGrantIntent }, admission));
    }),
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
    name: "team_shutdown", description: "Gracefully retire one member or close the whole team only after its durable tasks are reconciled. Graceful member retirement rejects unfinished owned tasks and, while automatic continuation is live, refuses to remove the last assignable worker if unfinished unclaimed tasks remain; graceful team shutdown rejects any unfinished task. Force member retirement releases owned tasks with an attention marker, while force team shutdown records unfinished tasks as cancelled before closing.",
    parameters: { team_id: { type: "string", description: "Optional only when the root lead owns exactly one unclosed team." }, member_session_id: { type: "string" }, force: { type: "boolean" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => {
      const allowPausedCleanup = !args.member_session_id && authorizePausedTeamCleanup(ctx, execution);
      return publicResult(await shutdownTeam(ctx, store, admission, execution.agent, { teamId: args.team_id, memberSessionId: args.member_session_id, force: args.force, allowPausedCleanup }, signal, authorizationProvider));
    }),
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
  const cached = snapshot !== null && typeof snapshot === "object" ? SSE_SNAPSHOT_ENCODINGS.get(snapshot) : undefined;
  if (cached !== undefined) return cached;
  return `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;
}
function blockSseClientUntilDrain(client) {
  client.blocked = true;
  if (typeof client.response?.once !== "function" || client.onDrain !== undefined) return;
  client.onDrain = () => {
    client.onDrain = undefined;
    if (client.closed) return;
    client.blocked = false;
    const pending = client.pendingPayload;
    client.pendingPayload = undefined;
    if (pending !== undefined) writeSseClient(client, pending);
  };
  client.response.once("drain", client.onDrain);
}
function writeSseClient(client, payload) {
  if (client.closed) return;
  if (client.blocked) {
    if (payload === client.pendingPayload) return;
    // Keep only the newest complete snapshot while the socket applies backpressure.
    // If the newest state returns to the already-written state, discard an older
    // queued divergence instead of emitting it after the drain event.
    client.pendingPayload = payload === client.lastPayload ? undefined : payload;
    return;
  }
  if (payload === client.lastPayload) return;
  let writable;
  try { writable = client.response.write(payload); }
  catch { client.remove?.(); return; }
  client.lastPayload = payload;
  if (writable === false) blockSseClientUntilDrain(client);
}
function writeSseKeepalive(client) {
  if (client.closed || client.blocked) return;
  try { if (client.response.write(": keepalive\n\n") === false) blockSseClientUntilDrain(client); }
  catch { client.remove?.(); }
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
  const clearPending = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pendingDocument = undefined;
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
    if (client === undefined) return;
    const response = client.response;
    const entries = clients.get(client.sessionId);
    entries?.delete(client);
    if (entries?.size === 0) clients.delete(client.sessionId);
    if (typeof response?.removeListener === "function") {
      if (client.onDrain !== undefined) response.removeListener("drain", client.onDrain);
      if (client.onClose !== undefined) response.removeListener("close", client.onClose);
      if (client.onError !== undefined) response.removeListener("error", client.onError);
    }
    if (typeof client.request?.removeListener === "function" && client.onRequestClose !== undefined) client.request.removeListener("close", client.onRequestClose);
    client.closed = true;
    client.blocked = false;
    client.pendingPayload = undefined;
    client.lastPayload = undefined;
    client.onDrain = undefined;
    client.onClose = undefined;
    client.onError = undefined;
    client.onRequestClose = undefined;
    client.response = undefined;
    client.request = undefined;
    if (clients.size === 0) {
      stopKeepalive();
      clearPending();
    }
  };
  const add = (sessionId, selectedTeamId, response, selectedTaskId, request) => {
    const client = { sessionId, selectedTeamId, selectedTaskId, response, request, blocked: false, closed: false, lastPayload: undefined, pendingPayload: undefined, onDrain: undefined, onClose: undefined, onError: undefined, onRequestClose: undefined, remove: undefined };
    client.remove = () => remove(client);
    if (typeof response?.once === "function") {
      client.onClose = client.remove;
      client.onError = client.remove;
      response.once("close", client.onClose);
      response.once("error", client.onError);
    }
    if (typeof request?.once === "function") {
      client.onRequestClose = client.remove;
      request.once("close", client.onRequestClose);
    }
    const entries = clients.get(sessionId) ?? new Set();
    entries.add(client);
    clients.set(sessionId, entries);
    ensureKeepalive();
    return client;
  };
  const send = (client, snapshotValue) => writeSseClient(client, encodedSseSnapshot(snapshotValue));
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const document = pendingDocument;
    pendingDocument = undefined;
    if (document === undefined || clients.size === 0) return;
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
    if (clients.size === 0) { clearPending(); return; }
    pendingDocument = document;
    if (timer !== undefined) return;
    timer = setTimeout(flush, delayMs);
    timer.unref?.();
  };
  const close = () => {
    clearPending();
    stopKeepalive();
    for (const entries of [...clients.values()]) for (const client of [...entries]) {
      const response = client.response;
      remove(client);
      try { response?.end?.(); } catch { /* close remains best effort */ }
    }
    clients.clear();
  };
  const stats = () => Object.freeze({ clients: [...clients.values()].reduce((total, entries) => total + entries.size, 0), pendingDocument: pendingDocument !== undefined, timer: timer !== undefined, keepaliveTimer: keepaliveTimer !== undefined });
  return { add, clients, close, flush, remove, schedule, send, stats };
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
      || memberRecoveryBlocksAutopilot(candidate)) {
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
        grant.parkedStateHash = undefined;
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
  const finalDocument = storeReadView(store);
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
  const projectionCache = createTeamProjectionCache();
  const stateSnapshot = (document, sessionId, selectedTeamId) => teamSnapshotWithAutopilotAuthorization(ctx, document, sessionId, selectedTeamId, projectionCache.project);
  const broadcaster = createSseBroadcaster({ snapshot: stateSnapshot });
  const detailSnapshot = (document, sessionId, selectedTeamId, selectedTaskId) => projectTaskDetailForUi(ctx, document, sessionId, selectedTeamId, selectedTaskId)
    ?? { unavailable: true, taskId: selectedTaskId ?? null };
  const detailBroadcaster = createSseBroadcaster({ snapshot: detailSnapshot });
  const unsubscribe = store.subscribe((document) => { broadcaster.schedule(document); detailBroadcaster.schedule(document); });
  ctx.on("session/event", (_session, event) => {
    if (detailBroadcaster.clients.size === 0 || !TASK_WORKFLOW_EVENT_TYPES.has(event?.type)) return;
    detailBroadcaster.schedule(storeReadView(store));
  });
  ctx.effect(() => () => { unsubscribe(); broadcaster.close(); detailBroadcaster.close(); projectionCache.close(); }, "agent-teams store subscription");
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
      let client;
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
        client = detailBroadcaster.add(sessionId, selectedTeamId, res, selectedTaskId, req);
        detailBroadcaster.send(client, detail);
        detailBroadcaster.send(client, await store.read((document) => detailSnapshot(document, sessionId, selectedTeamId, selectedTaskId)));
      } catch (error) {
        if (client !== undefined) detailBroadcaster.remove(client);
        if (!res.headersSent) return json(res, error?.code === "AGENT_TEAMS_NOT_FOUND" ? 404 : 400, errorPayload(error));
        try { res.end?.(); } catch { /* SSE cleanup is already complete */ }
      }
    },
  }), "agent-teams task detail events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/events", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed", code: "AGENT_TEAMS_METHOD_NOT_ALLOWED" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden", code: "AGENT_TEAMS_FORBIDDEN" });
      let client;
      try {
        await ready;
        const requestUrl = new URL(req.url, "http://x");
        const sessionId = nonEmptyString(requestUrl.searchParams.get("sessionId"), "sessionId", 256);
        const selectedTeamId = optionalString(requestUrl.searchParams.get("teamId"), "teamId", 256);
        const initialSnapshot = await store.read((document) => stateSnapshot(document, sessionId, selectedTeamId));
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "x-content-type-options": "nosniff" });
        res.flushHeaders?.();
        client = broadcaster.add(sessionId, selectedTeamId, res, undefined, req);
        broadcaster.send(client, initialSnapshot);
        // Close the read→subscribe race without sacrificing snapshot-first order.
        // A byte-identical catch-up is suppressed by writeSseClient.
        broadcaster.send(client, await store.read((document) => stateSnapshot(document, sessionId, selectedTeamId)));
      } catch (error) {
        if (client !== undefined) broadcaster.remove(client);
        if (!res.headersSent) return json(res, 400, errorPayload(error));
        try { res.end?.(); } catch { /* SSE cleanup is already complete */ }
      }
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
            const autopilotSettingsRequested = Object.hasOwn(body, "autopilotEnabled") || Object.hasOwn(body, "autopilotMaxAdditionalRounds");
            const suppliedHeader = req.headers[AGENT_TEAM_AUTOPILOT_AUTHORIZATION_HEADER];
            const suppliedBodyCapability = body.hostAuthorizationCapability;
            const authorizationCapabilitySupplied = suppliedHeader !== undefined || suppliedBodyCapability !== undefined;
            const authorizationRequired = authorizationCapabilitySupplied || autopilotSettingsRequested
              && (preview.nextSettings.autopilotEnabled || budgetChanged || autopilotModeChanged && hasLiveAutopilotGrant);
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
              const finalDocument = storeReadView(store);
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
          result = await officialCorePorts.recovery.reconcileMember({ confirm: true, expectedRevision: body.expectedRevision, resolution: body.resolution, operation: () => reconcileMemberRecovery(ctx, store, lead, { teamId: body.teamId, requestId: body.requestId, resolution: body.resolution, expectedRevision: body.expectedRevision }, admission) });
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
  if (member.runId === undefined || info?.runId === undefined || member.runId !== String(info.runId) || info.stopReason !== "completed") return 0;
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
          if (type === "start") {
            if (member.state === "retired" || info.runId === undefined) continue;
            const runId = String(info.runId);
            if (member.retirement !== undefined) {
              if (member.retirement.status !== "pending") continue;
              if (member.retirement.targetRunId === runId && member.runId === runId && member.terminalDiagnostic === undefined) continue;
              const updatedAt = now();
              if (!bindMemberRetirementTarget(member, member.retirement.intentId, runId, updatedAt)) continue;
              member.runId = runId;
              replaceMemberTerminalDiagnostic(member, undefined);
              member.updatedAt = updatedAt;
              team.updatedAt = updatedAt;
              continue;
            }
            let changed = replaceMemberTerminalDiagnostic(member, undefined);
            if (member.state !== "shutting_down") {
              if (member.state !== "running") { member.state = "running"; changed = true; }
              if (member.error !== undefined) { delete member.error; changed = true; }
            }
            if (member.runId !== runId) { member.runId = runId; changed = true; }
            if (!changed) continue;
            const updatedAt = now();
            member.updatedAt = updatedAt;
            team.updatedAt = updatedAt;
            continue;
          }
          const eventRunId = info.runId === undefined ? undefined : String(info.runId);
          const terminalDiagnosticCandidate = boundedSubagentTerminalDiagnostic(info);
          const failed = info.stopReason !== "completed" && (info.stopReason !== undefined || terminalDiagnosticCandidate !== undefined);
          const terminalDiagnostic = failed ? terminalDiagnosticCandidate : undefined;
          const safeStopReason = ["error", "refusal", "aborted", "max-tokens"].includes(info.stopReason) ? info.stopReason : failed ? "abnormal" : "completed";
          const retirement = member.retirement;
          if (retirement !== undefined) {
            if (retirement.status !== "pending" || retirement.targetRunId === undefined || eventRunId === undefined || retirement.targetRunId !== eventRunId) continue;
            const updatedAt = now();
            attachCompletedTaskResults(team, member, info, updatedAt);
            if (failed) {
              failMemberRetirement(member, safeStopReason, updatedAt);
              replaceMemberTerminalDiagnostic(member, terminalDiagnostic);
            } else confirmMemberRetired(member, { timestamp: updatedAt, stopReason: safeStopReason });
            team.updatedAt = updatedAt;
            if (retirement.scope === "team" && team.tasks.every(taskIsTerminal) && team.members.filter((candidate) => candidate.kind === "worker").every((candidate) => candidate.state === "retired")) {
              closeTeamRecord(team, "team closed after every exact graceful-retirement lifecycle completed", { forced: false });
            }
            continue;
          }
          // The run id is the lifecycle OCC fence. Once an end clears it, a duplicate
          // or an older end event is a semantic no-op and cannot overwrite recovered state.
          if (eventRunId === undefined ? member.runId === undefined : member.runId !== eventRunId) continue;
          const updatedAt = now();
          let changed = attachCompletedTaskResults(team, member, info, updatedAt) > 0;
          if (member.state === "shutting_down") {
            if (member.runId !== undefined) { member.runId = undefined; changed = true; }
            if (replaceMemberTerminalDiagnostic(member, terminalDiagnostic)) changed = true;
            if (!changed) continue;
            member.updatedAt = updatedAt;
            team.updatedAt = updatedAt;
            continue;
          }
          if (member.state === "retired") continue;
          const nextState = failed ? "failed" : "ready";
          const nextError = failed ? `subagent ended with ${safeStopReason}` : undefined;
          if (member.state !== nextState) { member.state = nextState; changed = true; }
          if (nextError === undefined) {
            if (member.error !== undefined) { delete member.error; changed = true; }
          } else if (member.error !== nextError) { member.error = nextError; changed = true; }
          if (replaceMemberTerminalDiagnostic(member, terminalDiagnostic)) changed = true;
          if (member.runId !== undefined) { member.runId = undefined; changed = true; }
          if (member.shutdownUnconfirmed !== undefined) { member.shutdownUnconfirmed = undefined; changed = true; }
          if (member.stopUnconfirmed !== undefined) { member.stopUnconfirmed = undefined; changed = true; }
          if (!changed) continue;
          member.updatedAt = updatedAt;
          team.updatedAt = updatedAt;
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
    const reconciliation = ready.then(() => pauseTeamsForUserStop(ctx, store, lead, selections, stoppedAt, authorizationProvider, admission));
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

function createProvisioningQueueScheduler(ctx, store, admission, ready = Promise.resolve()) {
  let closed = false;
  let drainPromise;
  let initializationFailure;
  const releaseEvents = [];
  const currentEpoch = () => admission.epoch?.() ?? "legacy-admission";
  const initialize = Promise.resolve(ready).then(async () => {
    const epoch = currentEpoch();
    const release = admission.releaseSequence?.() ?? 0;
    const needsRebase = await store.read((document) => document.teams.some((team) => (team.provisioningQueue ?? []).some((entry) => entry.status === "queued" && entry.admissionEpoch !== epoch)));
    if (!needsRebase || closed) return;
    await store.runOperation(() => store.mutate((document) => {
      const timestamp = now();
      for (const team of document.teams) for (const entry of team.provisioningQueue ?? []) {
        if (entry.status !== "queued" || entry.admissionEpoch === epoch) continue;
        entry.admissionEpoch = epoch;
        entry.retryAfterRelease = release + 1;
        entry.errorCode = "AGENT_TEAMS_HOST_RESTARTED";
        entry.errorStage = "awaiting_capacity_release";
        entry.updatedAt = timestamp;
        team.updatedAt = timestamp;
      }
    }));
  });
  const nextForRelease = async (event) => store.read((document) => {
    const roots = new Set(ctx.agents?.roots?.() ?? []);
    const candidates = [];
    for (const team of document.teams) {
      if (effectiveTeamState(team) !== "active" || team.autopilot?.status !== "active") continue;
      const root = ctx.agents.get(team.rootLeadSessionId);
      if (root === undefined || !roots.has(root) || !teamHasSafeAutopilotAuthority(team, root)
        || agentTeamAutopilotInvalidReason(team, root, ctx.goals?.get?.(root), document.settings) !== undefined) continue;
      for (const entry of team.provisioningQueue ?? []) {
        if (entry.status !== "queued" || entry.admissionEpoch !== event.epoch || entry.retryAfterRelease > event.sequence) continue;
        candidates.push({ teamId: team.id, rootSessionId: root.id, entry: clone(entry) });
      }
    }
    candidates.sort((left, right) => left.entry.enqueueSequence - right.entry.enqueueSequence || left.entry.id.localeCompare(right.entry.id));
    return candidates[0];
  });
  const drain = async () => {
    await initialize;
    while (!closed && releaseEvents.length > 0) {
      const event = releaseEvents.shift();
      const candidate = await nextForRelease(event);
      if (candidate === undefined) continue;
      const root = ctx.agents.get(candidate.rootSessionId);
      if (root === undefined || !ctx.agents.roots().includes(root)) continue;
      try {
        await spawnMember(ctx, store, admission, root, {
          teamId: candidate.teamId,
          queuedProvisioningId: candidate.entry.id,
          queueAdmissionEpoch: event.epoch,
          queueReleaseSequence: event.sequence,
        });
      } catch (error) {
        ctx.logger?.warn?.(`agent-teams queued provisioning deferred: ${String(error?.code ?? "unavailable")}`);
      }
    }
  };
  const requestDrain = () => {
    if (closed || drainPromise !== undefined) return;
    drainPromise = drain().catch((error) => {
      releaseEvents.length = 0;
      if (error !== initializationFailure) ctx.logger?.warn?.(`agent-teams provisioning queue drain failed: ${String(error?.code ?? "unavailable")}`);
    }).finally(() => {
      drainPromise = undefined;
      if (!closed && releaseEvents.length > 0) requestDrain();
    });
  };
  const unsubscribe = admission.subscribeRelease?.((event) => {
    if (closed || !isRecord(event) || event.epoch !== currentEpoch() || !Number.isSafeInteger(event.sequence)) return;
    releaseEvents.push(Object.freeze({ epoch: event.epoch, sequence: event.sequence, rootSessionId: event.rootSessionId, childId: event.childId }));
    requestDrain();
  }) ?? (() => undefined);
  initialize.catch((error) => {
    initializationFailure = error;
    ctx.logger?.warn?.(`agent-teams provisioning queue initialization failed: ${String(error?.code ?? "unavailable")}`);
  });
  return {
    ready: initialize,
    async flush() { await initialize; while (drainPromise !== undefined) await drainPromise; },
    close() { closed = true; releaseEvents.length = 0; unsubscribe(); },
    pendingEvents: () => releaseEvents.length,
  };
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
  const admissionReady = ready.then((document) => {
    const rootList = ctx.agents?.roots?.();
    if (!Array.isArray(rootList)) return document;
    const roots = new Set(rootList);
    for (const team of document.teams) {
      if (team.state === "closed") continue;
      const root = ctx.agents.get(team.rootLeadSessionId);
      if (root === undefined || !roots.has(root)) continue;
      for (const member of team.members) {
        if (member.kind !== "worker" || member.state === "retired") continue;
        const runId = member.runId ?? (member.retirement?.status === "pending" ? member.retirement.targetRunId : undefined) ?? GRACEFUL_ACTIVE_RUNS.get(member.sessionId);
        if (runId !== undefined) admission.adopt(root, member.sessionId, runId);
      }
    }
    return document;
  });
  admission.setReady(admissionReady);
  const provisioningQueueScheduler = createProvisioningQueueScheduler(ctx, store, admission, admissionReady);
  ctx.effect(() => () => provisioningQueueScheduler.close(), "agent-teams release-driven provisioning queue");
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
      await store.closeAndSettle();
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
  TEAM_PROJECTION_CACHE_ENV,
  TEAM_PROJECTION_CACHE_MAX_BYTES,
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
  createTeamChangeWaiter,
  projectTeamScope,
  rootHasSafeAutopilotAuthority,
  agentTeamAutopilotWakeRoots,
  reconcileProjectTaskWakeRoot,
  observeProjectTaskWakeLifecycle,
  observeProjectRootRecoveryLifecycle,
  createResolveUnknownAuthorizationGate,
  createSseBroadcaster,
  createTeamProjectionCache,
  createSubagentEventReconciler,
  drainContinuableChildrenWithDeadline,
  dispatchProjectTaskWakeSignals,
  createTeamTurnAdmission,
  createProvisioningQueueScheduler,
  fileBoundaryOverlap,
  filesystemPathIdentityKey,
  canonicalPathIsWithin,
  exactDirectHumanAutopilotRootAuthority,
  exactDirectHumanAutopilotGrantIntent,
  agentTeamAutopilotGrantForCreation,
  exactGoalRoundRootAuthority,
  assertAutomaticMemberRecoveryAllowed,
  hasExactGoalRoundRootAuthority,
  hasTeamCreationRootAuthority,
  normalizeExpansionRequest,
  expansionRequestIdentity,
  expansionRequestsSemanticallyEquivalent,
  submitExpansionRequest,
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
  provisioningQueueInputHash,
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
  teamSnapshotWithAutopilotAuthorization,
  projectionCacheMode,
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
