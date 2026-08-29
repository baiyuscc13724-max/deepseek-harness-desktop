import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { CollaborationBroker, CollaborationDirectory } from "./collaboration-broker.js";

const STATE_VERSION = 2;
const LEGACY_STATE_VERSION = 1;
const AUDIT_GENESIS = "audit_genesis_v1";
const MAX_PRESENCES = 2_000;
const MAX_INBOX_ITEMS = 2_000;
const MAX_AUDIT_EVENTS = 5_000;
const INBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const COLLABORATION_COOLDOWN_MS = 90_000;
const STATE_LOCK_TIMEOUT_MS = 5_000;
const STATE_STALE_LOCK_MS = 30_000;
const ACTIVE_TASK_STATES = new Set(["pending", "in_progress"]);
const INBOX_STATES = new Set(["pending", "deferred", "delivered", "acknowledged", "superseded", "expired"]);
const ROUTE_REF = /^route_[A-Za-z0-9_-]{20,64}$/u;
const SCOPE_REF = /^scope_[A-Za-z0-9_-]{20,64}$/u;
const PROJECT_REF = /^project_[A-Za-z0-9_-]{20,64}$/u;
const MEMBER_ACTIVITY = Object.freeze({
  provisioning: "running",
  running: "running",
  ready: "ready",
  idle: "idle",
  shutting_down: "paused",
  retired: "offline",
  failed: "offline",
});

function clone(value) {
  return structuredClone(value);
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
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function stringArray(value, field, maximum = 256) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${field} must be an array with at most ${maximum} entries`);
  return [...new Set(value.map((item, index) => nonEmptyString(item, `${field}[${index}]`, 512)))];
}
function timestamp(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer timestamp`);
  return value;
}
function boundedEpoch(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}
function opaqueRef(prefix, secret, ...parts) {
  return `${prefix}_${createHmac("sha256", secret).update(parts.join("\u0000")).digest("base64url").slice(0, 26)}`;
}
function opaqueValue(value, field, pattern) {
  const ref = nonEmptyString(value, field, 128);
  if (!pattern.test(ref)) throw new TypeError(`${field} must be an opaque Host reference`);
  return ref;
}
function legacyDedupeKey(secret, item) {
  const parts = [item.senderRouteRef, item.targetRouteRef, item.reason, item.evidenceDigest].map((part) => String(part)).join("\u0000");
  return `collab_${createHmac("sha256", secret).update(parts).digest("base64url").slice(0, 24)}`;
}
function normalizedFiles(task) {
  return Array.isArray(task.files) ? task.files.filter((file) => typeof file === "string" && file.trim() !== "").map((file) => file.trim()) : [];
}
function taskRef(teamId, taskId) {
  return `${teamId}:${taskId}`;
}
function taskState(task) {
  return String(task.state ?? task.status ?? "pending").toLowerCase();
}
function memberSessionId(member) {
  return member.sessionId ?? member.childSessionId ?? member.id;
}
function memberActivity(member, teams, knownStates) {
  const states = knownStates ?? teams.map((team) => team.members.find((candidate) => memberSessionId(candidate) === memberSessionId(member))?.state).filter(Boolean);
  if (states.length > 0 && states.every((state) => state === "retired" || state === "failed")) return "offline";
  if (teams.length > 0 && teams.every((team) => team.state === "paused")) return "paused";
  if (states.some((state) => state === "running" || state === "provisioning")) return "running";
  if (states.some((state) => state === "ready")) return "ready";
  if (states.some((state) => state === "idle")) return "idle";
  return MEMBER_ACTIVITY[member.state] ?? "unknown";
}

function validatePresence(value, index) {
  if (!isRecord(value)) throw new TypeError(`presence[${index}] must be an object`);
  assertAllowedKeys(value, new Set(["sessionId", "scopeRef", "projectRef", "displayName", "activity", "repoRefs", "taskRefs", "resourceRefs", "capabilities", "updatedAt", "pauseEpoch"]), `presence[${index}]`);
  return {
    sessionId: nonEmptyString(value.sessionId, `presence[${index}].sessionId`, 256),
    scopeRef: opaqueValue(value.scopeRef, `presence[${index}].scopeRef`, SCOPE_REF),
    projectRef: opaqueValue(value.projectRef, `presence[${index}].projectRef`, PROJECT_REF),
    displayName: nonEmptyString(value.displayName, `presence[${index}].displayName`, 128),
    activity: nonEmptyString(value.activity, `presence[${index}].activity`, 32),
    repoRefs: stringArray(value.repoRefs, `presence[${index}].repoRefs`),
    taskRefs: stringArray(value.taskRefs, `presence[${index}].taskRefs`),
    resourceRefs: stringArray(value.resourceRefs, `presence[${index}].resourceRefs`),
    capabilities: stringArray(value.capabilities, `presence[${index}].capabilities`, 32),
    updatedAt: timestamp(value.updatedAt, `presence[${index}].updatedAt`),
    pauseEpoch: boundedEpoch(value.pauseEpoch, `presence[${index}].pauseEpoch`),
  };
}
function validateInboxItem(value, index) {
  if (!isRecord(value)) throw new TypeError(`inbox[${index}] must be an object`);
  assertAllowedKeys(value, new Set(["id", "targetSessionId", "targetRouteRef", "targetPauseEpoch", "senderRouteRef", "senderDisplayName", "reason", "evidenceDigest", "dedupeKey", "message", "deliveryMode", "wakeLevel", "status", "createdAt", "expiresAt", "deliveredAt", "acknowledgedAt", "supersededAt"]), `inbox[${index}]`);
  const status = nonEmptyString(value.status, `inbox[${index}].status`, 32);
  if (!INBOX_STATES.has(status)) throw new TypeError(`inbox[${index}].status is unsupported`);
  return {
    id: nonEmptyString(value.id, `inbox[${index}].id`, 128),
    targetSessionId: nonEmptyString(value.targetSessionId, `inbox[${index}].targetSessionId`, 256),
    targetRouteRef: opaqueValue(value.targetRouteRef, `inbox[${index}].targetRouteRef`, ROUTE_REF),
    targetPauseEpoch: boundedEpoch(value.targetPauseEpoch, `inbox[${index}].targetPauseEpoch`),
    senderRouteRef: opaqueValue(value.senderRouteRef, `inbox[${index}].senderRouteRef`, ROUTE_REF),
    senderDisplayName: nonEmptyString(value.senderDisplayName, `inbox[${index}].senderDisplayName`, 128),
    reason: nonEmptyString(value.reason, `inbox[${index}].reason`, 64),
    evidenceDigest: nonEmptyString(value.evidenceDigest, `inbox[${index}].evidenceDigest`, 128),
    dedupeKey: nonEmptyString(value.dedupeKey, `inbox[${index}].dedupeKey`, 128),
    message: nonEmptyString(value.message, `inbox[${index}].message`, 2_000),
    deliveryMode: nonEmptyString(value.deliveryMode, `inbox[${index}].deliveryMode`, 32),
    wakeLevel: boundedEpoch(value.wakeLevel, `inbox[${index}].wakeLevel`),
    status,
    createdAt: timestamp(value.createdAt, `inbox[${index}].createdAt`),
    expiresAt: timestamp(value.expiresAt, `inbox[${index}].expiresAt`),
    ...(value.deliveredAt === undefined ? {} : { deliveredAt: timestamp(value.deliveredAt, `inbox[${index}].deliveredAt`) }),
    ...(value.acknowledgedAt === undefined ? {} : { acknowledgedAt: timestamp(value.acknowledgedAt, `inbox[${index}].acknowledgedAt`) }),
    ...(value.supersededAt === undefined ? {} : { supersededAt: timestamp(value.supersededAt, `inbox[${index}].supersededAt`) }),
  };
}
function validateAuditBase(value, index, chained) {
  if (!isRecord(value)) throw new TypeError(`audit[${index}] must be an object`);
  const allowed = new Set(["id", "type", "actorRouteRef", "targetRouteRef", "itemRef", "decisionCode", "at"]);
  if (chained) { allowed.add("prevDigest"); allowed.add("digest"); }
  assertAllowedKeys(value, allowed, `audit[${index}]`);
  return {
    id: nonEmptyString(value.id, `audit[${index}].id`, 128),
    type: nonEmptyString(value.type, `audit[${index}].type`, 64),
    ...(value.actorRouteRef === undefined ? {} : { actorRouteRef: opaqueValue(value.actorRouteRef, `audit[${index}].actorRouteRef`, ROUTE_REF) }),
    ...(value.targetRouteRef === undefined ? {} : { targetRouteRef: opaqueValue(value.targetRouteRef, `audit[${index}].targetRouteRef`, ROUTE_REF) }),
    ...(value.itemRef === undefined ? {} : { itemRef: nonEmptyString(value.itemRef, `audit[${index}].itemRef`, 128) }),
    ...(value.decisionCode === undefined ? {} : { decisionCode: nonEmptyString(value.decisionCode, `audit[${index}].decisionCode`, 128) }),
    at: timestamp(value.at, `audit[${index}].at`),
    ...(chained ? {
      prevDigest: nonEmptyString(value.prevDigest, `audit[${index}].prevDigest`, 128),
      digest: nonEmptyString(value.digest, `audit[${index}].digest`, 128),
    } : {}),
  };
}
function auditDigest(secret, event) {
  const payload = [event.id, event.type, event.actorRouteRef ?? null, event.targetRouteRef ?? null, event.itemRef ?? null, event.decisionCode ?? null, event.at, event.prevDigest];
  return `audit_${createHmac("sha256", secret).update(JSON.stringify(payload)).digest("base64url")}`;
}
function chainAudit(events, anchor, secret) {
  let previous = anchor;
  return events.map((event) => {
    const chained = { ...event, prevDigest: previous };
    chained.digest = auditDigest(secret, chained);
    previous = chained.digest;
    return chained;
  });
}
function validateState(value) {
  if (!isRecord(value)) throw new TypeError("collaboration state must be an object");
  const legacy = value.version === LEGACY_STATE_VERSION;
  assertAllowedKeys(value, new Set(["version", "secrets", "presence", "inbox", "audit", ...(legacy ? [] : ["auditAnchor"])]), "collaboration state");
  if (!legacy && value.version !== STATE_VERSION) throw new TypeError("unsupported collaboration state version");
  if (!isRecord(value.secrets)) throw new TypeError("collaboration secrets must be an object");
  assertAllowedKeys(value.secrets, new Set(["directory", "broker", "scope"]), "collaboration secrets");
  const secrets = {
    directory: nonEmptyString(value.secrets.directory, "secrets.directory", 256),
    broker: nonEmptyString(value.secrets.broker, "secrets.broker", 256),
    scope: nonEmptyString(value.secrets.scope, "secrets.scope", 256),
  };
  if (secrets.directory.length < 24 || secrets.broker.length < 24 || secrets.scope.length < 24) throw new TypeError("collaboration secrets are too short");
  if (!Array.isArray(value.presence) || value.presence.length > MAX_PRESENCES) throw new TypeError("collaboration presence is invalid");
  if (!Array.isArray(value.inbox) || value.inbox.length > MAX_INBOX_ITEMS) throw new TypeError("collaboration inbox is invalid");
  if (!Array.isArray(value.audit) || value.audit.length > MAX_AUDIT_EVENTS) throw new TypeError("collaboration audit is invalid");
  const inboxInput = legacy ? value.inbox.map((item) => isRecord(item) && item.dedupeKey === undefined ? { ...item, dedupeKey: legacyDedupeKey(secrets.broker, item) } : item) : value.inbox;
  const auditAnchor = legacy ? AUDIT_GENESIS : nonEmptyString(value.auditAnchor, "auditAnchor", 128);
  let audit = value.audit.map((event, index) => validateAuditBase(event, index, !legacy));
  if (legacy) audit = chainAudit(audit, auditAnchor, secrets.broker);
  else {
    let previous = auditAnchor;
    for (const event of audit) {
      if (event.prevDigest !== previous || event.digest !== auditDigest(secrets.broker, event)) throw new TypeError("collaboration audit chain is invalid");
      previous = event.digest;
    }
  }
  return {
    version: STATE_VERSION,
    secrets,
    presence: value.presence.map(validatePresence),
    inbox: inboxInput.map(validateInboxItem),
    auditAnchor,
    audit,
  };
}
function defaultState() {
  return {
    version: STATE_VERSION,
    secrets: {
      directory: randomBytes(32).toString("base64url"),
      broker: randomBytes(32).toString("base64url"),
      scope: randomBytes(32).toString("base64url"),
    },
    presence: [],
    inbox: [],
    auditAnchor: AUDIT_GENESIS,
    audit: [],
  };
}

const STATE_STORE_CHAINS = new Map();
const STATE_STORE_DOCUMENTS = new Map();
const STATE_STORE_INSTANCES = new Map();

function queueStateStore(filePath, operation) {
  const previous = STATE_STORE_CHAINS.get(filePath) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  STATE_STORE_CHAINS.set(filePath, result.then(() => undefined, () => undefined));
  return result;
}
function publishStateStore(filePath, document) {
  STATE_STORE_DOCUMENTS.set(filePath, document);
  for (const instance of STATE_STORE_INSTANCES.get(filePath) ?? []) instance.document = document;
}

class CollaborationStateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
    this.document = undefined;
    const instances = STATE_STORE_INSTANCES.get(filePath) ?? new Set();
    instances.add(this);
    STATE_STORE_INSTANCES.set(filePath, instances);
  }
  async init() {
    if (this.document !== undefined) return clone(this.document);
    return queueStateStore(this.filePath, () => this.#withFileLock(async () => {
      let document;
      try { document = validateState(JSON.parse(await readFile(this.filePath, "utf8"))); }
      catch (error) {
        if (error?.code !== "ENOENT") throw error;
        document = defaultState();
        await this.#write(document);
      }
      publishStateStore(this.filePath, document);
      return clone(document);
    }));
  }
  snapshot() {
    if (this.document === undefined) throw new Error("collaboration store is not initialized");
    return clone(this.document);
  }
  close() {
    const instances = STATE_STORE_INSTANCES.get(this.filePath);
    instances?.delete(this);
    if (instances?.size === 0) STATE_STORE_INSTANCES.delete(this.filePath);
  }
  mutate(mutator) {
    return queueStateStore(this.filePath, () => this.#withFileLock(async () => {
      let current;
      try { current = validateState(JSON.parse(await readFile(this.filePath, "utf8"))); }
      catch (error) {
        if (error?.code !== "ENOENT") throw error;
        current = defaultState();
      }
      const draft = clone(current);
      const result = await mutator(draft);
      const document = validateState(draft);
      await this.#write(document);
      publishStateStore(this.filePath, document);
      return clone(result);
    }));
  }
  async #withFileLock(operation) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const startedAt = Date.now();
    let handle;
    while (handle === undefined) {
      try {
        handle = await open(this.lockPath, "wx", 0o600);
        await handle.writeFile(`${process.pid} ${randomUUID()}\n`, "utf8");
        await handle.sync();
      } catch (error) {
        const createdLock = handle !== undefined;
        await handle?.close().catch(() => undefined);
        handle = undefined;
        if (createdLock) await rm(this.lockPath, { force: true }).catch(() => undefined);
        if (error?.code !== "EEXIST") throw error;
        try {
          if (Date.now() - (await stat(this.lockPath)).mtimeMs > STATE_STALE_LOCK_MS) {
            await rm(this.lockPath, { force: true });
            continue;
          }
        } catch (staleError) {
          if (staleError?.code === "ENOENT") continue;
          throw staleError;
        }
        if (Date.now() - startedAt >= STATE_LOCK_TIMEOUT_MS) {
          const timeout = new Error("collaboration state lock timed out");
          timeout.code = "COLLABORATION_STATE_LOCK_TIMEOUT";
          throw timeout;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    try { return await operation(); }
    finally {
      await handle.close().catch(() => undefined);
      await rm(this.lockPath, { force: true });
    }
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
      let directoryHandle;
      try {
        directoryHandle = await open(dirname(this.filePath), "r");
        await directoryHandle.sync();
      } catch {
        // Directory fsync is unavailable on some Windows filesystems. The state
        // file itself is flushed before its atomic rename.
      } finally {
        await directoryHandle?.close().catch(() => undefined);
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}

function appendAudit(document, event) {
  const record = {
    id: `audit_${randomUUID()}`,
    type: event.type,
    ...(event.actorRouteRef === undefined ? {} : { actorRouteRef: event.actorRouteRef }),
    ...(event.targetRouteRef === undefined ? {} : { targetRouteRef: event.targetRouteRef }),
    ...(event.itemRef === undefined ? {} : { itemRef: event.itemRef }),
    ...(event.decisionCode === undefined ? {} : { decisionCode: event.decisionCode }),
    at: event.at,
    prevDigest: document.audit.at(-1)?.digest ?? document.auditAnchor,
  };
  record.digest = auditDigest(document.secrets.broker, record);
  document.audit.push(record);
  if (document.audit.length > MAX_AUDIT_EVENTS) {
    const removed = document.audit.splice(0, document.audit.length - MAX_AUDIT_EVENTS);
    document.auditAnchor = removed.at(-1).digest;
  }
}
function publicInboxItem(item) {
  return {
    itemRef: item.id,
    senderRouteRef: item.senderRouteRef,
    senderDisplayName: item.senderDisplayName,
    reason: item.reason,
    message: item.message,
    deliveryMode: item.deliveryMode,
    createdAt: item.createdAt,
    status: item.status,
  };
}

export class AgentCollaborationService {
  constructor(filePath, { now = Date.now } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    this.store = new CollaborationStateStore(filePath);
    this.ready = undefined;
    this.directory = undefined;
    this.broker = undefined;
    this.knownPresence = new Map();
    this.scopeByRoot = new Map();
    this.teamById = new Map();
    this.memberMetaByRoute = new Map();
    this.memberRoutesBySession = new Map();
    this.pendingSyncSnapshot = undefined;
    this.pendingSyncWaiters = [];
    this.syncDrain = undefined;
    this.closed = false;
  }

  async init() {
    if (this.ready !== undefined) return this.ready;
    this.ready = this.#initialize();
    return this.ready;
  }
  async #initialize() {
    const document = await this.store.init();
    this.directory = new CollaborationDirectory({ secret: document.secrets.directory, now: this.now, maxFreshnessMs: 60_000 });
    for (const presence of document.presence) {
      const projected = this.directory.upsert(presence);
      this.knownPresence.set(`${presence.scopeRef}\u0000${presence.sessionId}`, projected.routeRef);
    }
    this.broker = new CollaborationBroker({
      directory: this.directory,
      secret: document.secrets.broker,
      now: this.now,
      maxFreshnessMs: 60_000,
      cooldownMs: COLLABORATION_COOLDOWN_MS,
      admissionTtlMs: 30_000,
      authorize: ({ sender, target }) => sender.scopeRef === target.scopeRef && sender.projectRef === target.projectRef && target.activity !== "offline",
      verifyReason: (request) => this.#verifyReason(request),
      hasWakeGrant: () => false,
    });
    return this;
  }

  syncTeams(teamDocument) {
    if (this.closed) return Promise.resolve();
    this.pendingSyncSnapshot = clone(teamDocument);
    const completion = new Promise((resolve, reject) => this.pendingSyncWaiters.push({ resolve, reject }));
    this.#ensureSyncDrain();
    return completion;
  }
  #ensureSyncDrain() {
    if (this.closed || this.syncDrain !== undefined) return;
    const drain = this.#drainSyncs();
    this.syncDrain = drain;
    void drain.finally(() => {
      if (this.syncDrain === drain) this.syncDrain = undefined;
      if (!this.closed && this.pendingSyncSnapshot !== undefined) this.#ensureSyncDrain();
    });
  }
  async #drainSyncs() {
    while (!this.closed && this.pendingSyncSnapshot !== undefined) {
      const snapshot = this.pendingSyncSnapshot;
      const waiters = this.pendingSyncWaiters.splice(0);
      this.pendingSyncSnapshot = undefined;
      try {
        await this.#syncTeams(snapshot);
        for (const waiter of waiters) waiter.resolve();
      } catch (error) {
        for (const waiter of waiters) waiter.reject(error);
      }
    }
  }
  async close() {
    this.closed = true;
    this.pendingSyncSnapshot = undefined;
    for (const waiter of this.pendingSyncWaiters.splice(0)) waiter.resolve();
    await this.syncDrain;
    this.store.close();
  }
  async #syncTeams(teamDocument) {
    await this.init();
    if (this.closed) return;
    if (!isRecord(teamDocument) || !Array.isArray(teamDocument.teams)) throw new TypeError("team document is invalid");
    const persisted = this.store.snapshot();
    const previousPresence = new Map(persisted.presence.map((record) => [`${record.scopeRef}\u0000${record.sessionId}`, record]));
    const secret = persisted.secrets.scope;
    const openTeams = teamDocument.teams.filter((team) => team.state !== "closed");
    const teamsByRoot = new Map();
    for (const team of openTeams) {
      const peers = teamsByRoot.get(team.rootLeadSessionId) ?? [];
      peers.push(team);
      teamsByRoot.set(team.rootLeadSessionId, peers);
    }
    const presenceRecords = [];
    const nextKeys = new Set();
    const nextScopeByRoot = new Map();
    const nextTeamById = new Map(openTeams.map((team) => [team.id, team]));
    const nextMemberMetaByRoute = new Map();
    const nextMemberRoutesBySession = new Map();

    for (const [rootLeadSessionId, teams] of teamsByRoot) {
      const scopeRef = opaqueRef("scope", secret, rootLeadSessionId);
      const projectRef = opaqueRef("project", secret, rootLeadSessionId);
      nextScopeByRoot.set(rootLeadSessionId, { scopeRef, projectRef });
      const members = new Map();
      const memberTeamsBySession = new Map();
      const memberStatesBySession = new Map();
      const assignmentsBySession = new Map();
      for (const team of teams) {
        for (const member of team.members) {
          const sessionId = memberSessionId(member);
          if (typeof sessionId !== "string" || sessionId === "") continue;
          const existing = members.get(sessionId);
          members.set(sessionId, existing === undefined ? member : { ...existing, ...member });
          const memberTeams = memberTeamsBySession.get(sessionId) ?? new Set();
          const firstInTeam = !memberTeams.has(team);
          memberTeams.add(team);
          memberTeamsBySession.set(sessionId, memberTeams);
          if (firstInTeam && member.state) {
            const states = memberStatesBySession.get(sessionId) ?? [];
            states.push(member.state);
            memberStatesBySession.set(sessionId, states);
          }
        }
        for (const task of team.tasks) {
          const sessionId = task.assigneeSessionId;
          if (typeof sessionId !== "string" || sessionId === "") continue;
          const assignments = assignmentsBySession.get(sessionId) ?? { assigned: [], allAssigned: [], resources: [] };
          const reference = taskRef(team.id, task.id);
          assignments.allAssigned.push(reference);
          if (ACTIVE_TASK_STATES.has(taskState(task))) {
            assignments.assigned.push(reference);
            assignments.resources.push(...normalizedFiles(task));
          }
          assignmentsBySession.set(sessionId, assignments);
        }
      }
      for (const [sessionId, member] of members) {
        const memberTeams = [...(memberTeamsBySession.get(sessionId) ?? [])];
        const assignments = assignmentsBySession.get(sessionId);
        const assigned = assignments?.assigned ?? [];
        const allAssigned = assignments?.allAssigned ?? [];
        const resources = assignments?.resources ?? [];
        const observedAt = this.now();
        const activity = memberActivity(member, memberTeams, memberStatesBySession.get(sessionId) ?? []);
        const presenceKey = `${scopeRef}\u0000${sessionId}`;
        const previous = previousPresence.get(presenceKey);
        const pauseChanged = previous !== undefined && (previous.activity === "paused") !== (activity === "paused");
        const pauseEpoch = previous === undefined ? (activity === "paused" ? 1 : 0) : previous.pauseEpoch + (pauseChanged ? 1 : 0);
        const record = {
          sessionId,
          scopeRef,
          projectRef,
          displayName: String(member.name ?? member.displayName ?? "Collaborator").slice(0, 128),
          activity,
          repoRefs: [],
          taskRefs: [...new Set(assigned)],
          resourceRefs: [...new Set(resources)],
          capabilities: [member.kind === "lead" ? "lead" : "agent-team"],
          updatedAt: observedAt,
          pauseEpoch,
        };
        const projected = this.directory.upsert(record);
        const key = `${scopeRef}\u0000${sessionId}`;
        nextKeys.add(key);
        presenceRecords.push(record);
        nextMemberMetaByRoute.set(projected.routeRef, { sessionId, rootLeadSessionId, teamIds: memberTeams.map((team) => team.id), taskRefs: record.taskRefs, allTaskRefs: [...new Set(allAssigned)], resourceRefs: record.resourceRefs });
        const routes = nextMemberRoutesBySession.get(sessionId) ?? [];
        routes.push(projected.routeRef);
        nextMemberRoutesBySession.set(sessionId, routes);
      }
    }
    for (const key of this.knownPresence.keys()) {
      if (nextKeys.has(key)) continue;
      const separator = key.indexOf("\u0000");
      this.directory.remove({ scopeRef: key.slice(0, separator), sessionId: key.slice(separator + 1) });
    }
    this.knownPresence = new Map(presenceRecords.map((record) => [`${record.scopeRef}\u0000${record.sessionId}`, this.directory.resolveSession(record.scopeRef, record.sessionId).routeRef]));
    this.scopeByRoot = nextScopeByRoot;
    this.teamById = nextTeamById;
    this.memberMetaByRoute = nextMemberMetaByRoute;
    this.memberRoutesBySession = nextMemberRoutesBySession;

    const currentByTarget = new Map(presenceRecords.map((record) => [record.sessionId, record]));
    await this.store.mutate((document) => {
      document.presence = presenceRecords.slice(0, MAX_PRESENCES);
      const now = this.now();
      for (const item of document.inbox) {
        if (!["pending", "deferred", "delivered"].includes(item.status)) continue;
        const target = currentByTarget.get(item.targetSessionId);
        if (item.expiresAt <= now) item.status = "expired";
        else if (target === undefined || target.pauseEpoch !== item.targetPauseEpoch) {
          item.status = "superseded";
          item.supersededAt = now;
          appendAudit(document, { type: "inbox-superseded", targetRouteRef: item.targetRouteRef, itemRef: item.id, at: now });
        }
      }
      document.inbox = document.inbox.filter((item) => item.createdAt + INBOX_RETENTION_MS > now).slice(-MAX_INBOX_ITEMS);
    });
  }

  #scope(rootLeadSessionId) {
    const scope = this.scopeByRoot.get(nonEmptyString(rootLeadSessionId, "rootLeadSessionId", 256));
    if (scope === undefined) throw new Error("collaboration scope is not available for this team root");
    return scope;
  }
  #routeForCaller(rootLeadSessionId, callerSessionId) {
    const scope = this.#scope(rootLeadSessionId);
    const record = this.directory.resolveSession(scope.scopeRef, nonEmptyString(callerSessionId, "callerSessionId", 256));
    if (record === undefined) throw new Error("caller is not present in this collaboration scope");
    return record;
  }

  discover({ callerSessionId, rootLeadSessionId, resourceRef, taskRef: requestedTaskRef }) {
    const scope = this.#scope(rootLeadSessionId);
    this.#routeForCaller(rootLeadSessionId, callerSessionId);
    return this.directory.discover({
      scopeRef: scope.scopeRef,
      projectRef: scope.projectRef,
      ...(resourceRef === undefined ? {} : { resourceRef: nonEmptyString(resourceRef, "resourceRef", 512) }),
      ...(requestedTaskRef === undefined ? {} : { taskRef: nonEmptyString(requestedTaskRef, "taskRef", 512) }),
    }, {
      requesterSessionId: callerSessionId,
      authorize: ({ scopeRef, projectRef }) => scopeRef === scope.scopeRef && projectRef === scope.projectRef,
    });
  }

  async submitIntent({ callerSessionId, rootLeadSessionId, routeRef, reason, evidence, message, wakeLevel = 1 }) {
    const sender = this.#routeForCaller(rootLeadSessionId, callerSessionId);
    const scope = this.#scope(rootLeadSessionId);
    const decision = await this.broker.admit({ routeRef, reason, evidence, wakeLevel }, {
      senderSessionId: callerSessionId,
      scopeRef: scope.scopeRef,
      projectRef: scope.projectRef,
      transport: "local",
      fanoutUsed: 0,
      chain: [sender.routeRef],
    });
    if (!decision.admitted) {
      const auditTargetRouteRef = typeof routeRef === "string" && ROUTE_REF.test(routeRef.trim()) ? routeRef.trim() : undefined;
      await this.store.mutate((document) => appendAudit(document, { type: "intent-rejected", actorRouteRef: sender.routeRef, targetRouteRef: auditTargetRouteRef, decisionCode: decision.code, at: this.now() }));
      return decision;
    }
    const now = this.now();
    const internal = this.broker.consume(decision.admissionRef);
    if (internal === undefined) throw new Error("collaboration admission expired before persistence");
    if (decision.deliveryMode === "suggestion") {
      await this.store.mutate((document) => appendAudit(document, { type: "intent-suggested", actorRouteRef: sender.routeRef, targetRouteRef: decision.routeRef, decisionCode: decision.code, at: now }));
      const { admissionRef: _consumed, ...publicDecision } = decision;
      return publicDecision;
    }
    const text = nonEmptyString(message, "message", 2_000);
    const target = this.directory.resolve(decision.routeRef);
    const item = {
      id: `inbox_${randomUUID()}`,
      targetSessionId: internal.targetSessionId,
      targetRouteRef: decision.routeRef,
      targetPauseEpoch: internal.targetPauseEpoch,
      senderRouteRef: sender.routeRef,
      senderDisplayName: sender.displayName,
      reason: decision.reason,
      evidenceDigest: decision.evidenceDigest,
      dedupeKey: decision.dedupeKey,
      message: text,
      deliveryMode: decision.deliveryMode,
      wakeLevel: decision.wakeLevel,
      status: target.activity === "paused" ? "deferred" : "pending",
      createdAt: now,
      expiresAt: now + INBOX_RETENTION_MS,
    };
    return this.store.mutate((document) => {
      const duplicate = document.inbox.find((candidate) => candidate.dedupeKey === decision.dedupeKey && candidate.createdAt + COLLABORATION_COOLDOWN_MS > now);
      if (duplicate !== undefined) {
        appendAudit(document, { type: "intent-rejected", actorRouteRef: sender.routeRef, targetRouteRef: decision.routeRef, decisionCode: "COOLDOWN", at: now });
        return { admitted: false, code: "COOLDOWN", detail: { retryAfterMs: duplicate.createdAt + COLLABORATION_COOLDOWN_MS - now } };
      }
      document.inbox = document.inbox.filter((candidate) => candidate.createdAt + INBOX_RETENTION_MS > now);
      if (document.inbox.length >= MAX_INBOX_ITEMS) {
        appendAudit(document, { type: "intent-rejected", actorRouteRef: sender.routeRef, targetRouteRef: decision.routeRef, decisionCode: "INBOX_CAPACITY", at: now });
        return { admitted: false, code: "INBOX_CAPACITY" };
      }
      document.inbox.push(item);
      appendAudit(document, { type: "intent-admitted", actorRouteRef: sender.routeRef, targetRouteRef: decision.routeRef, itemRef: item.id, decisionCode: decision.code, at: item.createdAt });
      return {
        admitted: true,
        code: decision.code,
        inboxItemRef: item.id,
        routeRef: decision.routeRef,
        reason: decision.reason,
        deliveryMode: item.deliveryMode,
        wakeLevel: item.wakeLevel,
        dedupeKey: decision.dedupeKey,
        expiresAt: item.expiresAt,
      };
    });
  }

  async listInbox({ callerSessionId, rootLeadSessionId }) {
    const caller = this.#routeForCaller(rootLeadSessionId, callerSessionId);
    if (caller.activity === "paused") return [];
    const result = [];
    await this.store.mutate((document) => {
      const now = this.now();
      for (const item of document.inbox) {
        if (item.targetSessionId !== callerSessionId || item.targetRouteRef !== caller.routeRef || item.targetPauseEpoch !== caller.pauseEpoch) continue;
        if (item.expiresAt <= now) { item.status = "expired"; continue; }
        if (item.status === "pending") {
          item.status = "delivered";
          item.deliveredAt = now;
          appendAudit(document, { type: "inbox-delivered", targetRouteRef: caller.routeRef, itemRef: item.id, at: now });
        }
        if (item.status === "delivered") result.push(publicInboxItem(item));
      }
    });
    return result;
  }

  async acknowledgeInbox({ callerSessionId, rootLeadSessionId, itemRef }) {
    const caller = this.#routeForCaller(rootLeadSessionId, callerSessionId);
    const id = nonEmptyString(itemRef, "itemRef", 128);
    return this.store.mutate((document) => {
      const item = document.inbox.find((candidate) => candidate.id === id && candidate.targetSessionId === callerSessionId && candidate.targetRouteRef === caller.routeRef);
      if (item === undefined) throw new Error("collaboration inbox item was not found for this caller");
      if (item.targetPauseEpoch !== caller.pauseEpoch || ["superseded", "expired"].includes(item.status)) throw new Error("collaboration inbox item is stale");
      if (item.status !== "acknowledged") {
        item.status = "acknowledged";
        item.acknowledgedAt = this.now();
        appendAudit(document, { type: "inbox-acknowledged", targetRouteRef: caller.routeRef, itemRef: item.id, at: item.acknowledgedAt });
      }
      return { itemRef: item.id, status: item.status };
    });
  }

  #verifyReason({ sender, target, reason, evidence }) {
    const senderMeta = this.memberMetaByRoute.get(sender.routeRef);
    const targetMeta = this.memberMetaByRoute.get(target.routeRef);
    if (senderMeta === undefined || targetMeta === undefined || senderMeta.rootLeadSessionId !== targetMeta.rootLeadSessionId) return false;
    if (reason === "UNIQUE_OWNER") {
      const resourceRef = evidence.resourceRef;
      if (!targetMeta.resourceRefs.includes(resourceRef)) return false;
      const owners = [...this.memberMetaByRoute.values()].filter((meta) => meta.rootLeadSessionId === targetMeta.rootLeadSessionId && meta.resourceRefs.includes(resourceRef));
      return owners.length === 1 && owners[0].sessionId === targetMeta.sessionId;
    }
    if (reason === "RESOURCE_CONFLICT") return senderMeta.resourceRefs.includes(evidence.resourceRef) && targetMeta.resourceRefs.includes(evidence.resourceRef);
    if (reason === "DEPENDENCY_BLOCKED") {
      const dependencyRef = evidence.dependencyTaskRef;
      if (!targetMeta.taskRefs.includes(dependencyRef)) return false;
      for (const teamId of senderMeta.teamIds) {
        const team = this.teamById.get(teamId);
        for (const task of team?.tasks ?? []) {
          if (task.assigneeSessionId !== senderMeta.sessionId || !ACTIVE_TASK_STATES.has(taskState(task))) continue;
          const localDependencies = (task.dependsOn ?? []).map((id) => taskRef(team.id, id));
          const crossDependencies = (task.crossTeamDependsOn ?? []).map((dependency) => taskRef(dependency.teamId, dependency.taskId));
          if ([...localDependencies, ...crossDependencies].includes(dependencyRef)) return true;
        }
      }
      return false;
    }
    if (reason === "FORMAL_HANDOFF") {
      const handoffRef = evidence.handoffRef;
      const sourceTaskRef = evidence.sourceTaskRef;
      if (typeof sourceTaskRef !== "string" || !senderMeta.allTaskRefs.includes(sourceTaskRef) || !targetMeta.taskRefs.includes(handoffRef)) return false;
      const [targetTeamId, targetTaskId] = handoffRef.split(":");
      const targetTask = this.teamById.get(targetTeamId)?.tasks.find((task) => task.id === targetTaskId);
      if (targetTask === undefined) return false;
      const local = (targetTask.dependsOn ?? []).map((id) => taskRef(targetTeamId, id));
      const cross = (targetTask.crossTeamDependsOn ?? []).map((dependency) => taskRef(dependency.teamId, dependency.taskId));
      return [...local, ...cross].includes(sourceTaskRef);
    }
    return false;
  }
}

export { CollaborationStateStore, STATE_VERSION as COLLABORATION_STATE_VERSION, validateState as validateCollaborationState };
