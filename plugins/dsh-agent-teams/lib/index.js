import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import z from "@deepseek-ai/schemastery";
import { createUserMessage, HarnessError } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";

/** Host-only agent-team coordinator. A future client bundle is advertised by package metadata. */
const name = "agent-teams";
const inject = ["agents", "subagents", "tools", "systemPrompt", "webServer"];
const STORE_VERSION = 1;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_TEAM_MESSAGES = 500;
const MAX_TEAM_TASKS = 1_000;
const HARD_MAX_MEMBERS = 8;
const DEFAULT_SETTINGS = Object.freeze({ enabled: false, maxMembers: 4, maxActiveTurns: 4 });
const TASK_STATES = Object.freeze(["pending", "in_progress", "completed"]);
const MEMBER_STATES = Object.freeze([
  "provisioning", "running", "idle", "ready", "failed", "shutting_down", "retired",
]);
const TEAM_STATES = Object.freeze(["active", "closing", "closed"]);
const TRANSIENT_MEMBER_STATES = new Set(["provisioning", "running", "idle", "shutting_down"]);
const Config = z.object({
  enabled: z.boolean().default(false),
  maxMembers: z.number().step(1).min(1).max(HARD_MAX_MEMBERS).default(4),
  maxActiveTurns: z.number().step(1).min(1).max(HARD_MAX_MEMBERS).default(4),
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  optionalString(member.error, "member.error", 4_096);
  return member;
}

/** Validate one persisted task and its dependency shape. */
function validateTask(task) {
  if (!isRecord(task)) throw new TypeError("task must be an object");
  nonEmptyString(task.id, "task.id", 256);
  nonEmptyString(task.title, "task.title", 500);
  optionalString(task.description, "task.description", 32_768);
  assertEnum(task.state, TASK_STATES, "task.state");
  assertStringArray(task.dependsOn, "task.dependsOn");
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
  if (team.members.filter((member) => member.kind === "worker" && member.state !== "retired").length > HARD_MAX_MEMBERS) throw new TypeError(`team exceeds the hard limit of ${HARD_MAX_MEMBERS} active teammates`);
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
    if (!sessions.has(message.fromSessionId) || !sessions.has(message.toSessionId)) throw new TypeError(`message ${message.id} must stay within its team`);
  }
  return team;
}

/** Validate and normalize the complete disk document. */
function validateStoreDocument(document) {
  if (!isRecord(document) || document.version !== STORE_VERSION || !isRecord(document.settings) || !Array.isArray(document.teams)) {
    throw new TypeError("agent teams store has an unsupported shape or version");
  }
  document.settings.enabled = Boolean(document.settings.enabled);
  document.settings.maxMembers = safeLimit(document.settings.maxMembers, "settings.maxMembers", 4);
  document.settings.maxActiveTurns = safeLimit(document.settings.maxActiveTurns, "settings.maxActiveTurns", 4);
  document.teams.forEach(validateTeam);
  const activeLeads = new Set();
  for (const team of document.teams) {
    if (team.state === "closed") continue;
    if (activeLeads.has(team.rootLeadSessionId)) throw new TypeError("more than one active team exists for a root lead session");
    activeLeads.add(team.rootLeadSessionId);
  }
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
function projectTeam(team) {
  const members = team.members.map((member) => ({ ...clone(member), status: member.state }));
  const names = new Map(members.map((member) => [member.sessionId, member.name]));
  return {
    ...clone(team),
    leadSessionId: team.rootLeadSessionId,
    objective: team.objective ?? team.name,
    status: team.state,
    revision: team.revision ?? 1,
    members,
    tasks: team.tasks.map((task) => deriveTask(task, team.tasks)),
    messages: team.messages.map((message) => ({
      ...clone(message),
      text: message.body,
      fromName: names.get(message.fromSessionId) ?? message.fromSessionId,
    })),
  };
}
function projectTeamForUi(team) {
  const projected = projectTeam(team);
  return {
    ...projected,
    tasks: projected.tasks.map(({ description, files, ...task }) => task),
    messages: projected.messages.map((message) => ({
      id: message.id,
      fromSessionId: message.fromSessionId,
      toSessionId: message.toSessionId,
      fromName: message.fromName,
      status: message.status,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
    })),
  };
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

/**
 * Durable JSON store with a single mutation chain and same-directory temp+rename commits.
 * No state escapes until its complete document has reached the atomic rename boundary.
 */
class AgentTeamsStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.document = defaultDocument(defaults);
    this.chain = Promise.resolve();
    this.operationChain = Promise.resolve();
    this.listeners = new Set();
  }
  async init() {
    try {
      this.document = validateStoreDocument(JSON.parse(await readFile(this.filePath, "utf8")));
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
        member.state = member.state === "provisioning" ? "failed" : "ready";
        if (member.state === "failed") member.error = "host restarted before provisioning completed";
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
    if (changed) await this.#write(this.document);
    return this.snapshot();
  }
  snapshot() {
    return clone(this.document);
  }
  async read(reader = (document) => document) {
    await this.chain;
    return clone(reader(this.document));
  }
  mutate(mutator) {
    const operation = this.chain.then(async () => {
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
      this.document = draft;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        try { listener(snapshot); } catch { /* observers never veto a committed mutation */ }
      }
      return clone(value);
    });
    this.chain = operation.catch(() => undefined);
    return operation;
  }
  runOperation(operation) {
    const result = this.operationChain.then(operation, operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async #write(document) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temp, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
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
    form: "relay",
    senderSessionId,
  };
}
function textContent(text) {
  return [{ type: "text", text }];
}
function publicResult(value) {
  return { ok: true, ...value };
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
function activeTeamForLead(document, sessionId) {
  return document.teams.find((team) => team.rootLeadSessionId === sessionId && team.state !== "closed");
}
function memberOf(team, sessionId) {
  return team.members.find((member) => member.sessionId === sessionId);
}
function resolveMember(team, reference) {
  const value = nonEmptyString(reference, "member reference", 256);
  const lower = value.toLocaleLowerCase();
  const matches = team.members.filter((member) => member.sessionId === value || member.id === value || member.name.toLocaleLowerCase() === lower);
  if (matches.length !== 1) reject(matches.length === 0 ? "unknown team member" : "team member name is ambiguous", "AGENT_TEAMS_NOT_FOUND");
  return matches[0];
}
function authenticateParticipant(team, sessionId) {
  const member = memberOf(team, sessionId);
  if (member === undefined || ["shutting_down", "retired"].includes(member.state)) reject("caller is not an active member of this team", "AGENT_TEAMS_UNAUTHORIZED");
  return member;
}
function requireLead(team, sessionId) {
  if (team.rootLeadSessionId !== sessionId) reject("operation requires the team root lead", "AGENT_TEAMS_UNAUTHORIZED");
}
function requireActiveTeam(team) {
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
function assertEnabled(document) {
  if (!document.settings.enabled) reject("agent teams are disabled; enable them in settings first", "AGENT_TEAMS_DISABLED");
}
function resolveTeamForCaller(document, teamId, sessionId) {
  const team = teamId === undefined ? document.teams.find((candidate) => candidate.state !== "closed" && memberOf(candidate, sessionId)) : findTeam(document, teamId);
  if (team === undefined) reject("caller has no active team", "AGENT_TEAMS_NOT_FOUND");
  authenticateParticipant(team, sessionId);
  return team;
}
function registrationPrompt(teamId, memberName, role) {
  return `You are being provisioned as ${memberName} (${role}) for agent team ${teamId}. Do not begin any task in this turn. Do not infer work from prior context. Reply only that you are waiting for the coordinator registration follow-up; membership must be durably persisted before work starts.`;
}
function workPrompt(teamId, memberId, prompt) {
  return `Coordinator registration complete. Team ${teamId}; member ${memberId}. You may now begin the assigned work. Use agent-team tools for team tasks and coordinator relays. Assignment:\n${prompt}`;
}

async function createTeam(store, lead, input) {
  return store.mutate((document) => {
    assertEnabled(document);
    if (activeTeamForLead(document, lead.id) !== undefined) reject("this root lead already has an active team", "AGENT_TEAMS_TEAM_EXISTS");
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
        name: nonEmptyString(input.leadName ?? "Lead", "leadName", 120),
        role: "root lead and coordinator",
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

async function spawnMember(ctx, store, lead, input, signal) {
  return store.runOperation(() => spawnMemberUnlocked(ctx, store, lead, input, signal));
}
async function spawnMemberUnlocked(ctx, store, lead, input, signal) {
  // Persist a provisioning slot before any await outside the mutation chain. This makes
  // concurrent member-limit and active-turn checks atomic even before a child id exists.
  const reservation = await store.mutate((document) => {
    assertEnabled(document);
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    requireLead(team, lead.id);
    if (team.state !== "active") reject("team is not accepting new members", "AGENT_TEAMS_CLOSING");
    if (team.members.filter((member) => member.kind === "worker" && member.state !== "retired").length >= document.settings.maxMembers) reject("team teammate limit reached", "AGENT_TEAMS_MEMBER_LIMIT");
    if (activeWorkerTurns(team) >= document.settings.maxActiveTurns) reject("team active-turn limit reached", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
    const memberName = nonEmptyString(input.name, "name", 120);
    if (team.members.some((member) => member.state !== "retired" && member.name.toLocaleLowerCase() === memberName.toLocaleLowerCase())) reject("an active team member already uses this name", "AGENT_TEAMS_CONFLICT");
    const timestamp = now();
    const memberId = randomUUID();
    const reservation = {
      teamId: team.id,
      memberId,
      placeholderSessionId: `provisioning:${memberId}`,
      name: memberName,
      role: nonEmptyString(input.role, "role", 500),
      prompt: nonEmptyString(input.prompt, "prompt", 65_536),
      model: optionalString(input.model, "model", 256),
    };
    team.members.push({
      id: memberId,
      sessionId: reservation.placeholderSessionId,
      name: reservation.name,
      role: reservation.role,
      ...(reservation.model === undefined ? {} : { model: reservation.model }),
      kind: "worker",
      state: "provisioning",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    team.updatedAt = timestamp;
    return reservation;
  });
  let started;
  try {
    started = await ctx.subagents.startContinuable({
      provider: "spawn",
      label: reservation.name,
      request: {
        parent: lead,
        prompt: textContent(registrationPrompt(reservation.teamId, reservation.name, reservation.role)),
        ...(reservation.model === undefined ? {} : { agentOptions: { model: reservation.model } }),
      },
      signal,
    });
  } catch (error) {
    await store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      team.members = team.members.filter((candidate) => candidate.id !== reservation.memberId);
      team.updatedAt = now();
    });
    throw new HarnessError(`member provisioning failed before publication: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED");
  }
  let member;
  try {
    member = await store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const record = team.members.find((candidate) => candidate.id === reservation.memberId);
      if (team.state !== "active" || record === undefined || record.sessionId !== reservation.placeholderSessionId || team.members.some((candidate) => candidate.sessionId === started.childId)) reject("team changed during member provisioning", "AGENT_TEAMS_CONFLICT");
      record.sessionId = started.childId;
      record.updatedAt = now();
      team.updatedAt = record.updatedAt;
      return record;
    });
  } catch (error) {
    try { ctx.subagents.interrupt(started.childId, { kind: "ancestor", agent: lead }); } catch { /* retain the child id below for later manual retirement */ }
    await store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const record = team.members.find((candidate) => candidate.id === reservation.memberId);
      if (record !== undefined) {
        record.sessionId = started.childId;
        record.state = "failed";
        record.error = `publication failed; child interrupt requested: ${String(error)}`;
        record.updatedAt = now();
        team.updatedAt = record.updatedAt;
      }
    }).catch(() => {});
    throw new HarnessError(`member publication failed after child creation: ${String(error)}`, "AGENT_TEAMS_SPAWN_FAILED");
  }
  try {
    await ctx.subagents.followup(lead, started.childId, textContent(workPrompt(reservation.teamId, reservation.memberId, reservation.prompt)), {
      source: relaySource(lead.id),
      signal,
    });
    return store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const current = memberOf(team, started.childId);
      if (current !== undefined && current.state === "provisioning") {
        current.state = "running";
        current.updatedAt = now();
        team.updatedAt = current.updatedAt;
      }
      return { teamId: team.id, member: clone(current ?? member) };
    });
  } catch (error) {
    await store.mutate((document) => {
      const team = findTeam(document, reservation.teamId);
      const current = memberOf(team, started.childId);
      if (current !== undefined) {
        current.state = "failed";
        current.error = String(error);
        current.updatedAt = now();
        team.updatedAt = current.updatedAt;
      }
    });
    throw error;
  }
}

async function sendTeamMessage(ctx, store, caller, input, signal) {
  return store.runOperation(() => sendTeamMessageUnlocked(ctx, store, caller, input, signal));
}
async function sendTeamMessageUnlocked(ctx, store, caller, input, signal) {
  const prepared = await store.mutate((document) => {
    assertEnabled(document);
    const team = resolveTeamForCaller(document, optionalString(input.teamId, "teamId", 256), caller.id);
    requireActiveTeam(team);
    const recipient = resolveMember(team, input.recipientSessionId ?? input.recipient);
    authenticateParticipant(team, recipient.sessionId);
    const recipientId = recipient.sessionId;
    if (recipient.sessionId === caller.id) reject("cannot relay a team message to self", "AGENT_TEAMS_INVALID_MESSAGE");
    if (recipient.kind === "worker" && ["ready", "idle"].includes(recipient.state)) {
      if (activeWorkerTurns(team) >= document.settings.maxActiveTurns) reject("team active-turn limit reached", "AGENT_TEAMS_ACTIVE_TURN_LIMIT");
      recipient.state = "running";
      recipient.updatedAt = now();
    }
    const message = {
      id: randomUUID(),
      fromSessionId: caller.id,
      toSessionId: recipientId,
      body: nonEmptyString(input.message, "message", 65_536),
      status: "pending",
      createdAt: now(),
    };
    team.messages.push(message);
    if (team.messages.length > MAX_TEAM_MESSAGES) {
      const removable = team.messages.findIndex((candidate) => candidate.status !== "pending");
      team.messages.splice(removable < 0 ? 0 : removable, 1);
    }
    team.updatedAt = message.createdAt;
    return { teamId: team.id, leadId: team.rootLeadSessionId, sender: clone(memberOf(team, caller.id)), recipient: clone(recipient), message };
  });
  try {
    const team = await store.read((document) => findTeam(document, prepared.teamId));
    const lead = exactLiveLead(ctx, team);
    const content = textContent(`[Agent team message ${prepared.message.id} from ${prepared.sender?.name ?? caller.id}]\n${prepared.message.body}`);
    if (prepared.recipient.kind === "lead") {
      await lead.followup(createUserMessage({ content, source: relaySource(caller.id) }));
    } else {
      await ctx.subagents.followup(lead, prepared.recipient.sessionId, content, { source: relaySource(caller.id), signal });
    }
    return store.mutate((document) => {
      const currentTeam = findTeam(document, prepared.teamId);
      const message = currentTeam.messages.find((candidate) => candidate.id === prepared.message.id);
      if (currentTeam.state === "closed") return { teamId: currentTeam.id, message };
      if (message !== undefined) {
        message.status = "delivered";
        message.deliveredAt = now();
        message.deliveryError = undefined;
      }
      currentTeam.updatedAt = now();
      return { teamId: currentTeam.id, message };
    });
  } catch (error) {
    await store.mutate((document) => {
      const currentTeam = findTeam(document, prepared.teamId);
      const message = currentTeam.messages.find((candidate) => candidate.id === prepared.message.id);
      if (currentTeam.state === "closed") return { teamId: currentTeam.id, message };
      if (message !== undefined) {
        message.status = "failed";
        message.deliveryError = String(error).slice(0, 4_096);
      }
      const recipient = memberOf(currentTeam, prepared.recipient.sessionId);
      if (recipient?.state === "running" && recipient.runId === undefined) recipient.state = "ready";
      currentTeam.updatedAt = now();
    });
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
    const files = input.files ?? [];
    assertStringArray(dependsOn, "dependsOn");
    assertStringArray(files, "files");
    const known = new Set(team.tasks.map((task) => task.id));
    if (dependsOn.some((id) => !known.has(id))) reject("task dependency does not exist in this team", "AGENT_TEAMS_INVALID_TASK");
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
      files: [...new Set(files.map((file) => nonEmptyString(file, "files item", 1_024)))],
      ...(assigneeSessionId === undefined ? {} : { assigneeSessionId }),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    team.tasks.push(task);
    team.updatedAt = timestamp;
    return { teamId: team.id, task: deriveTask(task, team.tasks) };
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
    const blockedBy = deriveTask(task, team.tasks).blockedBy;
    const isLead = caller.id === team.rootLeadSessionId;
    if (action === "claim") {
      if (task.state !== "pending" || task.assigneeSessionId !== undefined && task.assigneeSessionId !== caller.id) reject("task is not atomically claimable by caller", "AGENT_TEAMS_TASK_CONFLICT");
      if (blockedBy.length > 0) reject(`task is blocked by: ${blockedBy.join(", ")}`, "AGENT_TEAMS_TASK_BLOCKED");
      task.state = "in_progress";
      task.assigneeSessionId = caller.id;
      task.claimedAt = now();
      task.completedAt = undefined;
    } else if (action === "complete") {
      if (task.state !== "in_progress" || !isLead && task.assigneeSessionId !== caller.id) reject("only the claimant or lead can complete an in-progress task", "AGENT_TEAMS_TASK_CONFLICT");
      task.state = "completed";
      task.completedAt = now();
    } else if (action === "release") {
      if (task.state !== "in_progress" || !isLead && task.assigneeSessionId !== caller.id) reject("only the claimant or lead can release an in-progress task", "AGENT_TEAMS_TASK_CONFLICT");
      task.state = "pending";
      task.assigneeSessionId = undefined;
      task.claimedAt = undefined;
      task.completedAt = undefined;
    } else if (action === "reopen") {
      if (!isLead || task.state !== "completed") reject("only the lead can reopen a completed task", "AGENT_TEAMS_TASK_CONFLICT");
      task.state = "pending";
      task.completedAt = undefined;
      task.claimedAt = undefined;
    } else if (action === "assign") {
      if (!isLead || task.state !== "pending") reject("only the lead can assign a pending task", "AGENT_TEAMS_TASK_CONFLICT");
      const assignee = resolveMember(team, input.assigneeSessionId).sessionId;
      authenticateParticipant(team, assignee);
      task.assigneeSessionId = assignee;
    } else {
      if (!isLead || task.state !== "pending") reject("only the lead can unassign a pending task", "AGENT_TEAMS_TASK_CONFLICT");
      task.assigneeSessionId = undefined;
    }
    task.updatedAt = now();
    team.updatedAt = task.updatedAt;
    return { teamId: team.id, task: deriveTask(task, team.tasks) };
  });
}

async function interruptMember(ctx, store, lead, input) {
  const prepared = await store.read((document) => {
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    requireLead(team, lead.id);
    requireActiveTeam(team);
    const member = resolveMember(team, input.memberSessionId);
    if (member.kind !== "worker" || member.state === "retired") reject("unknown active worker member", "AGENT_TEAMS_NOT_FOUND");
    return { teamId: team.id, member };
  });
  ctx.subagents.interrupt(prepared.member.sessionId, { kind: "ancestor", agent: lead });
  return { teamId: prepared.teamId, member: prepared.member, interrupted: true };
}

async function retireMember(ctx, store, lead, input, signal) {
  const prepared = await store.mutate((document) => {
    const team = findTeam(document, nonEmptyString(input.teamId, "teamId", 256));
    requireLead(team, lead.id);
    requireOpenTeam(team);
    const member = resolveMember(team, input.memberSessionId);
    if (member.kind !== "worker") reject("unknown worker member", "AGENT_TEAMS_NOT_FOUND");
    if (member.state === "retired") return { teamId: team.id, member: clone(member), noop: true };
    member.state = "shutting_down";
    member.updatedAt = now();
    team.updatedAt = member.updatedAt;
    return { teamId: team.id, member: clone(member), noop: false };
  });
  if (prepared.noop) return prepared;
  try {
    if (input.force === true) {
      ctx.subagents.interrupt(prepared.member.sessionId, { kind: "ancestor", agent: lead });
    } else {
      await ctx.subagents.followup(lead, prepared.member.sessionId, textContent("The team lead requests graceful retirement. Finish only essential cleanup, report any final result to the lead, and then stop taking team work."), {
        source: relaySource(lead.id), signal,
      });
    }
  } catch (error) {
    await store.mutate((document) => {
      const team = findTeam(document, prepared.teamId);
      requireOpenTeam(team);
      const member = memberOf(team, prepared.member.sessionId);
      if (member !== undefined) {
        member.state = "failed";
        member.error = `retirement request failed: ${String(error)}`;
        member.updatedAt = now();
        team.updatedAt = member.updatedAt;
      }
    }).catch(() => {});
    throw error;
  }
  return store.mutate((document) => {
    const team = findTeam(document, prepared.teamId);
    requireOpenTeam(team);
    const member = memberOf(team, prepared.member.sessionId);
    if (member !== undefined) {
      member.state = input.force === true ? "retired" : "shutting_down";
      member.runId = undefined;
      member.updatedAt = now();
      team.updatedAt = member.updatedAt;
    }
    return { teamId: team.id, member };
  });
}

async function shutdownTeam(ctx, store, lead, input, signal) {
  return store.runOperation(() => shutdownTeamUnlocked(ctx, store, lead, input, signal));
}
async function shutdownTeamUnlocked(ctx, store, lead, input, signal) {
  const snapshot = await store.read((document) => findTeam(document, nonEmptyString(input.teamId, "teamId", 256)));
  requireLead(snapshot, lead.id);
  requireActiveTeam(snapshot);
  if (input.memberSessionId !== undefined && input.memberSessionId !== "") return retireMember(ctx, store, lead, input, signal);
  await store.mutate((document) => {
    const team = findTeam(document, snapshot.id);
    requireActiveTeam(team);
    team.state = "closing";
    team.updatedAt = now();
  });
  const workers = snapshot.members.filter((member) => member.kind === "worker" && member.state !== "retired");
  const outcomes = await Promise.allSettled(workers.map((member) => retireMember(ctx, store, lead, {
    teamId: snapshot.id,
    memberSessionId: member.sessionId,
    force: input.force === true,
  }, signal)));
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");
  return store.mutate((document) => {
    const team = findTeam(document, snapshot.id);
    const shouldClose = failures.length === 0 && team.members.filter((member) => member.kind === "worker").every((member) => member.state === "retired");
    if (shouldClose) closeTeamRecord(team);
    else {
      team.state = failures.length === 0 ? "closing" : "active";
      team.updatedAt = now();
    }
    return { team: projectTeam(team), failures: failures.map((failure) => String(failure.reason)) };
  });
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
      const unsafe = team.members.some((member) => member.kind === "worker" && ["provisioning", "running", "shutting_down"].includes(member.state));
      if (unsafe) {
        if (requestedId !== undefined) reject("orphan recovery requires all workers to be inactive", "AGENT_TEAMS_CONFLICT");
        continue;
      }
      for (const member of team.members) if (member.kind === "worker") member.state = "retired";
      closeTeamRecord(team, "orphaned team closed by an explicit direct-human recovery");
      recovered.push(projectTeam(team));
    }
    return { candidates: candidates.map(projectTeam), recovered };
  }));
}

function teamSnapshot(document, sessionId) {
  const team = sessionId === "settings" ? undefined : document.teams.find((candidate) => candidate.state !== "closed" && memberOf(candidate, sessionId));
  const config = clone(document.settings);
  return { enabled: config.enabled, config, settings: config, team: team === undefined ? null : projectTeamForUi(team) };
}

function registerTools(ctx, store, ready) {
  ctx.systemPrompt.section({
    name: "tool:agent-teams",
    order: 116,
    text: "Agent teams are durable coordinator-owned groups. Start a team only from a direct human root turn. Persist tasks before work, atomically claim pending unblocked tasks, use team_message for authenticated coordinator relays, gracefully retire members before closing a team, and use direct-human team_recover only for inactive orphaned teams.",
  });
  const run = (handler) => async (args, exec) => { await ready; return handler(args, toolExecution(ctx, exec), exec.signal); };
  ctx.tools.register(defineTool({
    name: "team_start",
    description: "Start the one active durable agent team allowed for this root lead. Requires direct-human root authority in the current open turn.",
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
    description: "Provision a continuable independent-context team member through the spawn provider. Membership is persisted before the work follow-up is delivered.",
    parameters: {
      team_id: { type: "string", required: true }, name: { type: "string", required: true },
      role: { type: "string", required: true }, prompt: { type: "string", required: true },
      model: { type: "string", description: "Optional model override; provider is inherited from the lead." },
    }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await spawnMember(ctx, store, execution.agent, { teamId: args.team_id, name: args.name, role: args.role, prompt: args.prompt, model: args.model }, signal))),
    presentCall: (args) => present("Spawn team member", args.name),
  }));
  ctx.tools.register(defineTool({
    name: "team_status", description: "Read the authenticated caller's team, members, tasks, messages, settings, and derived task blockers.",
    parameters: { team_id: { type: "string" } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => store.read((document) => {
      const team = resolveTeamForCaller(document, optionalString(args.team_id, "team_id", 256), execution.agent.id);
      return publicResult({ settings: document.settings, team: projectTeam(team) });
    })), presentCall: () => present("Read team status"),
  }));
  ctx.tools.register(defineTool({
    name: "team_message", description: "Send an authenticated same-team coordinator relay. Peer delivery routes through the exact live root lead and is never attributed to a user.",
    parameters: { team_id: { type: "string" }, recipient_session_id: { type: "string", required: true, description: "Recipient session id, member id, or unique member name." }, message: { type: "string", required: true } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution, signal) => publicResult(await sendTeamMessage(ctx, store, execution.agent, { teamId: args.team_id, recipientSessionId: args.recipient_session_id, message: args.message }, signal))),
    presentCall: (args) => present("Relay team message", args.recipient_session_id),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_create", description: "Create a durable pending team task with optional assignee and dependency ids.",
    parameters: { team_id: { type: "string" }, title: { type: "string", required: true }, description: { type: "string" }, assignee_session_id: { type: "string" }, depends_on: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" }, description: "Optional normalized file paths this task may edit; overlapping active tasks are flagged." } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => publicResult(await createTask(store, execution.agent, { teamId: args.team_id, title: args.title, description: args.description, assigneeSessionId: args.assignee_session_id, dependsOn: args.depends_on, files: args.files }))),
    presentCall: (args) => present("Create team task", args.title),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_list", description: "List team tasks with dependency-derived blockedBy arrays.",
    parameters: { team_id: { type: "string" }, state: { type: "string", enum: TASK_STATES } }, output: TOOL_OUTPUT,
    execute: run(async (args, execution) => store.read((document) => {
      const team = resolveTeamForCaller(document, optionalString(args.team_id, "team_id", 256), execution.agent.id);
      const tasks = team.tasks.map((task) => deriveTask(task, team.tasks)).filter((task) => args.state === undefined || task.state === args.state);
      return publicResult({ teamId: team.id, tasks });
    })), presentCall: () => present("List team tasks"),
  }));
  ctx.tools.register(defineTool({
    name: "team_task_update", description: "Atomically claim, release, complete, reopen, or assign a team task. Claim rejects unmet dependencies and competing claims.",
    parameters: { team_id: { type: "string" }, task_id: { type: "string", required: true }, action: { type: "string", enum: ["claim", "release", "complete", "reopen", "assign", "unassign"] }, state: { type: "string", enum: TASK_STATES }, assignee_session_id: { type: "string" } }, output: TOOL_OUTPUT,
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
    name: "team_shutdown", description: "Gracefully retire one member or close the whole team. Force mode interrupts descendants using exact live ancestor authority.",
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
function sseSnapshot(res, snapshot) {
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
}

function registerWebApi(ctx, store, ready) {
  const clients = new Map();
  const unsubscribe = store.subscribe((document) => {
    for (const [sessionId, responses] of clients) {
      const snapshot = teamSnapshot(document, sessionId);
      for (const response of responses) {
        try { sseSnapshot(response, snapshot); } catch { responses.delete(response); }
      }
      if (responses.size === 0) clients.delete(sessionId);
    }
  });
  ctx.effect(() => unsubscribe, "agent-teams store subscription");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/state", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
      try {
        await ready;
        const sessionId = nonEmptyString(new URL(req.url, "http://x").searchParams.get("sessionId"), "sessionId", 256);
        return json(res, 200, await store.read((document) => teamSnapshot(document, sessionId)));
      } catch (error) { return json(res, 400, { error: String(error?.message ?? error) }); }
    },
  }), "agent-teams state route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/events", handler: async (req, res) => {
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!trustedRequest(req)) return json(res, 403, { error: "forbidden" });
      try {
        await ready;
        const sessionId = nonEmptyString(new URL(req.url, "http://x").searchParams.get("sessionId"), "sessionId", 256);
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-content-type-options": "nosniff" });
        const responses = clients.get(sessionId) ?? new Set();
        responses.add(res);
        clients.set(sessionId, responses);
        sseSnapshot(res, await store.read((document) => teamSnapshot(document, sessionId)));
        req.once("close", () => { responses.delete(res); if (responses.size === 0) clients.delete(sessionId); });
      } catch (error) { if (!res.headersSent) return json(res, 400, { error: String(error?.message ?? error) }); }
    },
  }), "agent-teams events route");
  ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: "/api/agent-teams/action", handler: async (req, res) => {
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      if (!trustedRequest(req) || req.headers["x-harness-agent-teams"] !== "1") return json(res, 403, { error: "forbidden" });
      let body;
      try { body = await readJsonBody(req); } catch (error) { return json(res, error?.status === 413 ? 413 : 400, { error: String(error?.message ?? error) }); }
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
        return json(res, status, { error: String(error?.message ?? error), code: error?.code });
      }
    },
  }), "agent-teams action route");
  ctx.effect(() => () => {
    for (const responses of clients.values()) for (const response of responses) response.end();
    clients.clear();
  }, "agent-teams SSE clients");
}

function observeSubagents(ctx, store, ready) {
  ctx.on("subagent/start", (info) => {
    return ready.then(() => store.runOperation(() => store.mutate((document) => {
      for (const team of document.teams) {
        if (team.state === "closed") continue;
        const member = memberOf(team, info.id);
        if (member === undefined || member.state === "retired") continue;
        member.state = "running";
        member.runId = String(info.runId);
        member.error = undefined;
        member.updatedAt = now();
        team.updatedAt = member.updatedAt;
        return;
      }
    }))).catch((error) => ctx.logger.warn(`agent-teams start reconciliation failed: ${String(error)}`));
  });
  ctx.on("subagent/end", (info) => {
    return ready.then(() => store.runOperation(() => store.mutate((document) => {
      for (const team of document.teams) {
        if (team.state === "closed") continue;
        const member = memberOf(team, info.id);
        if (member === undefined || member.state === "retired") continue;
        if (member.state === "shutting_down") member.state = "retired";
        else if (["error", "refusal"].includes(info.stopReason)) {
          member.state = "failed";
          member.error = `subagent ended with ${info.stopReason}`;
        } else member.state = "ready";
        member.runId = undefined;
        member.updatedAt = now();
        team.updatedAt = member.updatedAt;
        if (team.state === "closing" && team.members.filter((candidate) => candidate.kind === "worker").every((candidate) => candidate.state === "retired")) closeTeamRecord(team);
        return;
      }
    }))).catch((error) => ctx.logger.warn(`agent-teams end reconciliation failed: ${String(error)}`));
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
  const ready = store.init();
  ready.catch((error) => ctx.logger.error(`agent-teams store initialization failed: ${String(error)}`));
  registerTools(ctx, store, ready);
  registerWebApi(ctx, store, ready);
  observeSubagents(ctx, store, ready);
}

export {
  AgentTeamsStore,
  Config,
  HARD_MAX_MEMBERS,
  MEMBER_STATES,
  TASK_STATES,
  apply,
  createTask,
  createTeam,
  deriveTask,
  inject,
  name,
  resolveConfig,
  teamSnapshot,
  trustedRequest,
  updateTask,
  validateMember,
  validateMessage,
  validateStoreDocument,
  validateTask,
  validateTeam,
};
