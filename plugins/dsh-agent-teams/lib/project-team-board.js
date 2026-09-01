import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const UI_PROJECT_TEAM_BOARD_MAX_TEAMS = 24;
const UI_PROJECT_TEAM_BOARD_MAX_TASKS = 120;
const UI_PROJECT_TEAM_BOARD_MAX_BYTES = 128 * 1024;
const UI_PROJECT_TEAM_BOARD_RECOVERY_RESERVE_BYTES = 48 * 1024;
const UI_PROJECT_TEAM_BOARD_MAX_RECOVERY_RECEIPTS = 24;
const UI_PROJECT_TEAM_BOARD_TEAM_NAME_CHARS = 160;
const UI_PROJECT_TEAM_BOARD_TASK_TITLE_CHARS = 240;
const UI_PROJECT_TEAM_BOARD_DUTY_NAME_CHARS = 80;
const PROJECT_TEAM_BOARD_CURSOR_VERSION = 1;
const PROJECT_TEAM_BOARD_CURSOR_PREFIX = "ptb1";
const DEFAULT_CURSOR_INTEGRITY_KEY = randomBytes(32);
const TASK_STATES = Object.freeze(["pending", "in_progress", "submitted", "completed", "cancelled"]);

function text(value, max) {
  if (typeof value !== "string") return "";
  return [...value.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/gu, " ").replace(/\s+/gu, " ").trim()].slice(0, max).join("");
}
function newestFirst(left, right) {
  const stateOrder = (value) => value === "closed" ? 1 : 0;
  const stateDelta = stateOrder(left.state) - stateOrder(right.state);
  if (stateDelta !== 0) return stateDelta;
  const updatedDelta = Date.parse(right.updatedAt ?? 0) - Date.parse(left.updatedAt ?? 0);
  return updatedDelta || String(left.id).localeCompare(String(right.id));
}
function emptyTaskStats() { return { total: 0, pending: 0, inProgress: 0, submitted: 0, completed: 0, cancelled: 0, blocked: 0, attention: 0, acceptanceRequired: 0 }; }
function taskStateKey(state) { return state === "in_progress" ? "inProgress" : TASK_STATES.includes(state) ? state : undefined; }
function ownerDutyName(team, task) {
  if (task.assigneeSessionId === undefined) return null;
  const member = team.members.find((candidate) => candidate.sessionId === task.assigneeSessionId);
  return member === undefined ? null : text(member.name, UI_PROJECT_TEAM_BOARD_DUTY_NAME_CHARS) || null;
}
function taskNodeKey(teamId, taskId) { return `${teamId}\u0000${taskId}`; }
function buildTaskIndex(teams) {
  const tasks = new Map();
  for (const team of teams) for (const task of team.tasks) tasks.set(taskNodeKey(team.id, task.id), task);
  return tasks;
}
function taskIsBlocked(team, task, taskIndex, satisfiesDependency) {
  for (const dependencyId of task.dependsOn ?? []) if (!satisfiesDependency(taskIndex.get(taskNodeKey(team.id, dependencyId)))) return true;
  for (const dependency of task.crossTeamDependsOn ?? []) if (!satisfiesDependency(taskIndex.get(taskNodeKey(dependency.teamId, dependency.taskId)))) return true;
  return false;
}
function taskNeedsAttention(team, task, blocked) {
  if (blocked || task.state === "cancelled") return true;
  if (task.state === "submitted") return true;
  if ((task.capabilities ?? []).some((capability) => capability.status !== "verified")) return true;
  if ((task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown")) return true;
  if (task.state === "pending" && task.assigneeSessionId === undefined && task.releaseReason !== undefined) return true;
  if (task.state === "in_progress" && task.assigneeSessionId !== undefined) {
    const assignee = team.members.find((member) => member.sessionId === task.assigneeSessionId);
    if (assignee === undefined || ["failed", "retired"].includes(assignee.state)) return true;
  }
  return false;
}
function teamAttentionCodes(team, taskFacts) {
  const codes = new Set();
  if (team.members.some((member) => member.kind === "worker" && member.state === "failed")) codes.add("failed_member");
  if (team.members.some((member) => member.kind === "worker" && (member.shutdownUnconfirmed === true || member.stopUnconfirmed === true))) codes.add("unconfirmed_shutdown");
  // There is no durable retry lineage/message identity linking two delivery
  // attempts. Preserve every failed-delivery warning until an explicit lineage
  // contract can prove that the exact payload was superseded.
  if (team.messages.some((message) => message.status === "failed")) codes.add("failed_delivery");
  if (team.bootstrap !== undefined && team.bootstrap.phase !== "complete") codes.add("bootstrap_incomplete");
  if (team.plan !== undefined && !["committed", "active"].includes(team.plan.phase)) codes.add("plan_draft");
  if (team.tasks.some((task) => (task.capabilities ?? []).some((capability) => capability.status !== "verified"))) codes.add("capability_unknown");
  if (team.tasks.some((task) => (task.externalEffects ?? []).some((effect) => effect.outcome === "outcome_unknown"))) codes.add("outcome_unknown");
  if (team.tasks.some((task) => task.state === "pending" && task.assigneeSessionId === undefined && task.releaseReason !== undefined)) codes.add("released_task");
  if (team.tasks.some((task) => task.state === "in_progress" && task.assigneeSessionId !== undefined && !team.members.some((member) => member.sessionId === task.assigneeSessionId && !["failed", "retired"].includes(member.state)))) codes.add("stranded_task");
  if (team.tasks.some((task) => task.state === "submitted")) codes.add("acceptance_required");
  if (team.state === "closing") codes.add("closure_incomplete");
  if (taskFacts.some((fact) => fact.blocked)) codes.add("blocked_task");
  return [...codes].sort();
}
function boardRevisionCursor(projectKey, teams, teamState) {
  const revision = teams.map((team) => [team.id, team.revision ?? 1, teamState(team), team.updatedAt]);
  return `project_board_${createHash("sha256").update(JSON.stringify([projectKey, revision])).digest("hex").slice(0, 32)}`;
}
function cursorKeyBytes(value) {
  if (typeof value === "string" && value.length > 0) return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value) && value.length > 0) return value;
  if (value instanceof Uint8Array && value.byteLength > 0) return Buffer.from(value);
  return DEFAULT_CURSOR_INTEGRITY_KEY;
}
function cursorSignature(projectKey, payload, key) {
  return createHmac("sha256", cursorKeyBytes(key)).update(JSON.stringify(["project-team-board-page-v1", projectKey, payload])).digest("base64url");
}
function encodeProjectTeamBoardCursor(projectKey, revisionCursor, position, key) {
  const payload = Buffer.from(JSON.stringify({ v: PROJECT_TEAM_BOARD_CURSOR_VERSION, r: revisionCursor, i: position.teamIndex, t: position.taskIndex }), "utf8").toString("base64url");
  return `${PROJECT_TEAM_BOARD_CURSOR_PREFIX}.${payload}.${cursorSignature(projectKey, payload, key)}`;
}
function cursorError(message, code, stale = false) {
  const error = new Error(message); error.code = code; error.stale = stale; return error;
}
function decodeProjectTeamBoardCursor(projectKey, cursor, revisionCursor, key) {
  if (typeof cursor !== "string" || cursor.length < 32 || cursor.length > 2_048) throw cursorError("project team board cursor is invalid", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID");
  const parts = cursor.split(".");
  if (parts.length !== 3 || parts[0] !== PROJECT_TEAM_BOARD_CURSOR_PREFIX || !/^[A-Za-z0-9_-]+$/u.test(parts[1]) || !/^[A-Za-z0-9_-]+$/u.test(parts[2])) throw cursorError("project team board cursor is invalid", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID");
  const expected = Buffer.from(cursorSignature(projectKey, parts[1], key), "utf8"), actual = Buffer.from(parts[2], "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw cursorError("project team board cursor failed integrity validation", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID");
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { throw cursorError("project team board cursor is invalid", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID"); }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).sort().join(",") !== "i,r,t,v" || payload.v !== PROJECT_TEAM_BOARD_CURSOR_VERSION || typeof payload.r !== "string" || !Number.isSafeInteger(payload.i) || payload.i < 0 || !Number.isSafeInteger(payload.t) || payload.t < 0) throw cursorError("project team board cursor is invalid", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID");
  if (payload.r !== revisionCursor) throw cursorError("project team board cursor is stale", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_STALE", true);
  return { teamIndex: payload.i, taskIndex: payload.t };
}

function prepareProjectTeamBoard(projectKey, projectTeams, { teamState = (team) => team.state, satisfiesDependency = (task) => task?.state === "completed" } = {}) {
  if (typeof projectKey !== "string" || !/^[a-f0-9]{64}$/u.test(projectKey)) return null;
  const scoped = projectTeams.filter((team) => team.projectKey === projectKey && team.state !== "closed");
  const ordered = [...scoped].sort((left, right) => newestFirst({ ...left, state: teamState(left) }, { ...right, state: teamState(right) }));
  const taskIndex = buildTaskIndex(scoped), totalTaskStats = emptyTaskStats(), teamRecords = [];
  let totalAttentionTeams = 0;
  for (const team of ordered) {
    const taskFacts = team.tasks.map((task) => {
      const blocked = taskIsBlocked(team, task, taskIndex, satisfiesDependency), attention = taskNeedsAttention(team, task, blocked), stateKey = taskStateKey(task.state);
      totalTaskStats.total += 1; if (stateKey !== undefined) totalTaskStats[stateKey] += 1; if (task.state === "submitted") totalTaskStats.acceptanceRequired += 1; if (blocked) totalTaskStats.blocked += 1; if (attention) totalTaskStats.attention += 1;
      return { task, blocked, attention };
    });
    const attentionCodes = teamAttentionCodes(team, taskFacts); if (attentionCodes.length > 0) totalAttentionTeams += 1;
    const teamTaskStats = emptyTaskStats();
    const tasks = taskFacts.map(({ task, blocked, attention }) => {
      const stateKey = taskStateKey(task.state); teamTaskStats.total += 1; if (stateKey !== undefined) teamTaskStats[stateKey] += 1; if (task.state === "submitted") teamTaskStats.acceptanceRequired += 1; if (blocked) teamTaskStats.blocked += 1; if (attention) teamTaskStats.attention += 1;
      return { id: task.id, title: text(task.title, UI_PROJECT_TEAM_BOARD_TASK_TITLE_CHARS), status: task.state, ownerDutyName: ownerDutyName(team, task), blocked, attention, updatedAt: task.updatedAt };
    }).sort(newestFirst);
    teamRecords.push({ summary: { id: team.id, name: text(team.name, UI_PROJECT_TEAM_BOARD_TEAM_NAME_CHARS), status: teamState(team), planPhase: team.plan?.phase ?? "active", memberCount: team.members.filter((member) => member.state !== "retired").length, taskStats: teamTaskStats, attention: { required: attentionCodes.length > 0, codes: attentionCodes }, updatedAt: team.updatedAt }, tasks });
  }
  return { projectKey, cursor: boardRevisionCursor(projectKey, ordered, teamState), totalTeams: ordered.length, totalTaskStats, totalAttentionTeams, teamRecords };
}

function planPage(teamRecords, start, taskLimit) {
  let teamIndex = start.teamIndex, taskIndex = start.taskIndex, includedTasks = 0;
  const teams = [];
  while (teamIndex < teamRecords.length && teams.length < UI_PROJECT_TEAM_BOARD_MAX_TEAMS) {
    const record = teamRecords[teamIndex];
    if (taskIndex > record.tasks.length || taskIndex > 0 && record.tasks.length === 0) throw cursorError("project team board cursor position is invalid", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID");
    if (record.tasks.length === 0) { teams.push({ ...record.summary, tasks: [] }); teamIndex += 1; taskIndex = 0; continue; }
    const remaining = taskLimit - includedTasks; if (remaining <= 0) break;
    const tasks = record.tasks.slice(taskIndex, taskIndex + remaining);
    if (tasks.length === 0) { teamIndex += 1; taskIndex = 0; continue; }
    teams.push({ ...record.summary, tasks }); includedTasks += tasks.length; taskIndex += tasks.length;
    if (taskIndex >= record.tasks.length) { teamIndex += 1; taskIndex = 0; }
  }
  return { teams, includedTasks, nextPosition: { teamIndex, taskIndex }, hasMore: teamIndex < teamRecords.length };
}
function composePage(prepared, start, taskLimit, key) {
  const planned = planPage(prepared.teamRecords, start, taskLimit);
  const nextCursor = planned.hasMore ? encodeProjectTeamBoardCursor(prepared.projectKey, prepared.cursor, planned.nextPosition, key) : null;
  return { available: true, cursor: prepared.cursor,
    stats: { totalTeams: prepared.totalTeams, includedTeams: planned.teams.length, totalTasks: prepared.totalTaskStats.total, includedTasks: planned.includedTasks, pendingTasks: prepared.totalTaskStats.pending, inProgressTasks: prepared.totalTaskStats.inProgress, submittedTasks: prepared.totalTaskStats.submitted, acceptanceRequiredTasks: prepared.totalTaskStats.acceptanceRequired, completedTasks: prepared.totalTaskStats.completed, cancelledTasks: prepared.totalTaskStats.cancelled, blockedTasks: prepared.totalTaskStats.blocked, attentionTasks: prepared.totalTaskStats.attention, attentionTeams: prepared.totalAttentionTeams },
    page: { includedTeams: planned.teams.length, includedTasks: planned.includedTasks, hasMore: planned.hasMore, nextCursor },
    projection: { scope: "page", maxTeams: UI_PROJECT_TEAM_BOARD_MAX_TEAMS, maxTasks: UI_PROJECT_TEAM_BOARD_MAX_TASKS, maxBytes: UI_PROJECT_TEAM_BOARD_MAX_BYTES, teamsTruncated: planned.hasMore, tasksTruncated: planned.hasMore, payloadTruncated: taskLimit < UI_PROJECT_TEAM_BOARD_MAX_TASKS }, teams: planned.teams };
}
function unavailableBoard() {
  return Object.freeze({ available: false, cursor: "project_board_unavailable", stats: { totalTeams: 0, includedTeams: 0, totalTasks: 0, includedTasks: 0, pendingTasks: 0, inProgressTasks: 0, submittedTasks: 0, acceptanceRequiredTasks: 0, completedTasks: 0, cancelledTasks: 0, blockedTasks: 0, attentionTasks: 0, attentionTeams: 0 }, page: { includedTeams: 0, includedTasks: 0, hasMore: false, nextCursor: null }, projection: { scope: "page", maxTeams: UI_PROJECT_TEAM_BOARD_MAX_TEAMS, maxTasks: UI_PROJECT_TEAM_BOARD_MAX_TASKS, maxBytes: UI_PROJECT_TEAM_BOARD_MAX_BYTES, teamsTruncated: false, tasksTruncated: false, payloadTruncated: false }, teams: [] });
}
function paginatePreparedProjectTeamBoard(prepared, { cursor, cursorIntegrityKey } = {}) {
  if (prepared === null) return unavailableBoard();
  const start = cursor === undefined || cursor === null ? { teamIndex: 0, taskIndex: 0 } : decodeProjectTeamBoardCursor(prepared.projectKey, cursor, prepared.cursor, cursorIntegrityKey);
  if (start.teamIndex > prepared.teamRecords.length || start.teamIndex === prepared.teamRecords.length && start.taskIndex !== 0) throw cursorError("project team board cursor position is invalid", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_INVALID");
  let low = 0, high = UI_PROJECT_TEAM_BOARD_MAX_TASKS, board = composePage(prepared, start, high, cursorIntegrityKey);
  const basePayloadBudget = UI_PROJECT_TEAM_BOARD_MAX_BYTES - UI_PROJECT_TEAM_BOARD_RECOVERY_RESERVE_BYTES;
  if (Buffer.byteLength(JSON.stringify(board)) <= basePayloadBudget) return board;
  while (low < high) { const middle = Math.ceil((low + high) / 2), candidate = composePage(prepared, start, middle, cursorIntegrityKey); if (Buffer.byteLength(JSON.stringify(candidate)) <= basePayloadBudget) low = middle; else high = middle - 1; }
  board = composePage(prepared, start, low, cursorIntegrityKey);
  if (Buffer.byteLength(JSON.stringify(board)) > basePayloadBudget || board.page.hasMore && board.page.includedTeams === 0) throw cursorError("project team board page cannot make progress within the payload budget", "AGENT_TEAMS_PROJECT_BOARD_PAGE_TOO_LARGE");
  board.projection.payloadTruncated = true; return board;
}
function decorateProjectTeamBoardRecovery(board, projectTeams, sessionId, { teamState = (team) => team.state } = {}) {
  if (board === null || typeof board !== "object" || board.available !== true || !Array.isArray(board.teams)) return board;
  const teamsById = new Map(projectTeams.map((team) => [team.id, team])), projections = [];
  const teams = board.teams.map((summary, index) => {
    const team = teamsById.get(summary.id), state = team === undefined ? undefined : teamState(team);
    if (team === undefined || team.rootLeadSessionId !== sessionId || !["active", "paused"].includes(state)) return summary;
    const allUnresolved = (team.memberRecoveries ?? []).filter((receipt) => receipt.status === "outcome_unknown"), unresolvedMemberIds = new Set(allUnresolved.map((receipt) => receipt.memberId));
    const allMembers = state === "active" ? team.members.filter((member) => member.kind === "worker" && member.state === "failed" && !unresolvedMemberIds.has(member.id) && team.tasks.some((task) => task.assigneeSessionId === member.sessionId && !["completed", "cancelled"].includes(task.state))) : [];
    if (allUnresolved.length === 0 && allMembers.length === 0) return summary;
    const recovery = { teamId: team.id, expectedRevision: team.revision ?? 1, paused: state === "paused", members: [], membersTruncated: allMembers.length > 0, unresolved: [], unresolvedRemaining: allUnresolved.length, unresolvedTruncated: allUnresolved.length > 0 };
    projections.push({ index, team, recovery, allUnresolved, allMembers });
    return { ...summary, memberRecovery: recovery };
  });
  if (projections.length === 0) return board;
  const decorated = { ...board, teams };
  if (Buffer.byteLength(JSON.stringify(decorated)) > UI_PROJECT_TEAM_BOARD_MAX_BYTES) throw cursorError("project team board recovery metadata exceeds the page payload budget", "AGENT_TEAMS_PROJECT_BOARD_PAGE_TOO_LARGE");
  let includedReceipts = 0, receiptBudgetExhausted = false;
  for (const projection of projections) {
    if (receiptBudgetExhausted) break;
    for (const receipt of projection.allUnresolved) {
      if (includedReceipts >= UI_PROJECT_TEAM_BOARD_MAX_RECOVERY_RECEIPTS) { receiptBudgetExhausted = true; break; }
      const member = projection.team.members.find((candidate) => candidate.id === receipt.memberId);
      projection.recovery.unresolved.push({ requestId: receipt.requestId, action: receipt.action, phase: receipt.phase, member: { id: receipt.memberId, name: text(member?.name, UI_PROJECT_TEAM_BOARD_DUTY_NAME_CHARS) } });
      projection.recovery.unresolvedRemaining -= 1;
      projection.recovery.unresolvedTruncated = projection.recovery.unresolvedRemaining > 0;
      if (Buffer.byteLength(JSON.stringify(decorated)) > UI_PROJECT_TEAM_BOARD_MAX_BYTES) {
        projection.recovery.unresolved.pop(); projection.recovery.unresolvedRemaining += 1; projection.recovery.unresolvedTruncated = true; receiptBudgetExhausted = true; break;
      }
      includedReceipts += 1;
    }
  }
  let memberBudgetExhausted = false;
  for (const projection of projections) {
    if (memberBudgetExhausted) break;
    for (const member of projection.allMembers) {
      projection.recovery.members.push({ id: member.id, name: text(member.name, UI_PROJECT_TEAM_BOARD_DUTY_NAME_CHARS) });
      projection.recovery.membersTruncated = projection.recovery.members.length < projection.allMembers.length;
      if (Buffer.byteLength(JSON.stringify(decorated)) > UI_PROJECT_TEAM_BOARD_MAX_BYTES) { projection.recovery.members.pop(); projection.recovery.membersTruncated = true; memberBudgetExhausted = true; break; }
    }
  }
  if (Buffer.byteLength(JSON.stringify(decorated)) > UI_PROJECT_TEAM_BOARD_MAX_BYTES) throw cursorError("project team board recovery projection exceeded the page payload budget", "AGENT_TEAMS_PROJECT_BOARD_PAGE_TOO_LARGE");
  return decorated;
}
function createProjectTeamBoard(projectKey, projectTeams, options = {}) { return paginatePreparedProjectTeamBoard(prepareProjectTeamBoard(projectKey, projectTeams, options), options); }
function createProjectTeamBoardPage(projectKey, projectTeams, options = {}) {
  if (typeof options.cursor !== "string" || options.cursor.length === 0) throw cursorError("project team board cursor is required", "AGENT_TEAMS_PROJECT_BOARD_CURSOR_REQUIRED");
  return paginatePreparedProjectTeamBoard(prepareProjectTeamBoard(projectKey, projectTeams, options), options);
}

export { PROJECT_TEAM_BOARD_CURSOR_VERSION, UI_PROJECT_TEAM_BOARD_MAX_BYTES, UI_PROJECT_TEAM_BOARD_MAX_TASKS, UI_PROJECT_TEAM_BOARD_MAX_TEAMS, createProjectTeamBoard, createProjectTeamBoardPage, decodeProjectTeamBoardCursor, decorateProjectTeamBoardRecovery, encodeProjectTeamBoardCursor, paginatePreparedProjectTeamBoard, prepareProjectTeamBoard };
