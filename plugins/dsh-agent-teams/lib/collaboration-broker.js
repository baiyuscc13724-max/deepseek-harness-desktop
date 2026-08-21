import { createHmac, randomBytes } from "node:crypto";

export const COLLABORATION_REASONS = Object.freeze([
  "DEPENDENCY_BLOCKED",
  "UNIQUE_OWNER",
  "RESOURCE_CONFLICT",
  "FORMAL_HANDOFF",
  "MANDATORY_REVIEW",
]);

const REASON_EVIDENCE = Object.freeze({
  DEPENDENCY_BLOCKED: ["dependencyTaskRef"],
  UNIQUE_OWNER: ["resourceRef"],
  RESOURCE_CONFLICT: ["resourceRef"],
  FORMAL_HANDOFF: ["handoffRef"],
  MANDATORY_REVIEW: ["policyRef"],
});
const ACTIVITY_STATES = new Set(["running", "ready", "idle", "paused", "offline", "unknown"]);
const ROUTE_REF = /^route_[A-Za-z0-9_-]{20,64}$/u;
const PRIVATE_TARGET_FIELDS = new Set(["sessionId", "targetSessionId", "memberSessionId", "userId", "deviceId"]);

function nonEmptyString(value, name, max = 512) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > max) throw new RangeError(`${name} exceeds ${max} characters`);
  return normalized;
}

function optionalString(value, name, max = 512) {
  return value === undefined || value === null || value === "" ? undefined : nonEmptyString(value, name, max);
}

function finiteTime(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function uniqueStrings(value, name, limit = 64) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  if (value.length > limit) throw new RangeError(`${name} exceeds ${limit} entries`);
  return [...new Set(value.map((item, index) => nonEmptyString(item, `${name}[${index}]`, 512)))];
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function hmacRef(prefix, secret, parts, length = 26) {
  const digest = createHmac("sha256", secret).update(parts.map((part) => String(part)).join("\u0000")).digest("base64url");
  return `${prefix}_${digest.slice(0, length)}`;
}

function publicPresence(record, now, maxFreshnessMs) {
  const ageMs = Math.max(0, now - record.updatedAt);
  return Object.freeze({
    routeRef: record.routeRef,
    collaboratorId: record.routeRef,
    displayName: record.displayName,
    activity: record.activity,
    projectRef: record.projectRef,
    taskRefs: [...record.taskRefs],
    resourceRefs: [...record.resourceRefs],
    capabilities: [...record.capabilities],
    updatedAt: record.updatedAt,
    freshness: ageMs <= maxFreshnessMs ? "fresh" : "stale",
  });
}

function requiredEvidence(reason, evidence) {
  if (evidence === null || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  return REASON_EVIDENCE[reason].every((field) => typeof evidence[field] === "string" && evidence[field].trim() !== "");
}

function reject(code, detail) {
  return Object.freeze({ admitted: false, code, ...(detail === undefined ? {} : { detail }) });
}

export class CollaborationDirectory {
  #secret;
  #now;
  #maxFreshnessMs;
  #byRoute = new Map();
  #byScopedSession = new Map();

  constructor({ secret, now = Date.now, maxFreshnessMs = 60_000 } = {}) {
    if (typeof secret !== "string" && !Buffer.isBuffer(secret)) throw new TypeError("directory secret is required");
    if (secret.length < 16) throw new RangeError("directory secret must contain at least 16 bytes");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (!Number.isSafeInteger(maxFreshnessMs) || maxFreshnessMs < 1_000) throw new RangeError("maxFreshnessMs must be at least 1000");
    this.#secret = secret;
    this.#now = now;
    this.#maxFreshnessMs = maxFreshnessMs;
  }

  upsert(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("presence input must be an object");
    const sessionId = nonEmptyString(input.sessionId, "sessionId", 256);
    const scopeRef = nonEmptyString(input.scopeRef, "scopeRef", 256);
    const projectRef = nonEmptyString(input.projectRef, "projectRef", 256);
    const displayName = nonEmptyString(input.displayName, "displayName", 128);
    const activity = optionalString(input.activity, "activity", 32) ?? "unknown";
    if (!ACTIVITY_STATES.has(activity)) throw new RangeError(`unsupported activity state: ${activity}`);
    const routeRef = hmacRef("route", this.#secret, [scopeRef, projectRef, sessionId]);
    const record = {
      routeRef,
      sessionId,
      scopeRef,
      projectRef,
      displayName,
      activity,
      userRef: optionalString(input.userRef, "userRef", 256),
      deviceRef: optionalString(input.deviceRef, "deviceRef", 256),
      repoRefs: uniqueStrings(input.repoRefs, "repoRefs"),
      taskRefs: uniqueStrings(input.taskRefs, "taskRefs"),
      resourceRefs: uniqueStrings(input.resourceRefs, "resourceRefs"),
      capabilities: uniqueStrings(input.capabilities, "capabilities", 32),
      updatedAt: finiteTime(input.updatedAt, this.#now()),
      pauseEpoch: Number.isSafeInteger(input.pauseEpoch) && input.pauseEpoch >= 0 ? input.pauseEpoch : 0,
    };
    const scopedSession = `${scopeRef}\u0000${sessionId}`;
    const previousRoute = this.#byScopedSession.get(scopedSession);
    if (previousRoute !== undefined && previousRoute !== routeRef) this.#byRoute.delete(previousRoute);
    this.#byRoute.set(routeRef, record);
    this.#byScopedSession.set(scopedSession, routeRef);
    return publicPresence(record, this.#now(), this.#maxFreshnessMs);
  }

  remove({ scopeRef, sessionId }) {
    const scopedSession = `${nonEmptyString(scopeRef, "scopeRef", 256)}\u0000${nonEmptyString(sessionId, "sessionId", 256)}`;
    const routeRef = this.#byScopedSession.get(scopedSession);
    if (routeRef === undefined) return false;
    this.#byScopedSession.delete(scopedSession);
    return this.#byRoute.delete(routeRef);
  }

  prune({ staleAfterMs = this.#maxFreshnessMs * 4 } = {}) {
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < this.#maxFreshnessMs) throw new RangeError("staleAfterMs is too small");
    const cutoff = this.#now() - staleAfterMs;
    let removed = 0;
    for (const record of [...this.#byRoute.values()]) {
      if (record.updatedAt >= cutoff) continue;
      this.#byRoute.delete(record.routeRef);
      this.#byScopedSession.delete(`${record.scopeRef}\u0000${record.sessionId}`);
      removed += 1;
    }
    return removed;
  }

  discover(query, { requesterSessionId, authorize } = {}) {
    if (query === null || typeof query !== "object" || Array.isArray(query)) throw new TypeError("discovery query must be an object");
    if (typeof authorize !== "function") return [];
    const scopeRef = nonEmptyString(query.scopeRef, "scopeRef", 256);
    const projectRef = optionalString(query.projectRef, "projectRef", 256);
    const repoRef = optionalString(query.repoRef, "repoRef", 512);
    const taskRef = optionalString(query.taskRef, "taskRef", 512);
    const resourceRef = optionalString(query.resourceRef, "resourceRef", 512);
    const requester = nonEmptyString(requesterSessionId, "requesterSessionId", 256);
    const now = this.#now();
    const results = [];
    for (const record of this.#byRoute.values()) {
      if (record.scopeRef !== scopeRef || record.sessionId === requester) continue;
      if (projectRef !== undefined && record.projectRef !== projectRef) continue;
      if (repoRef !== undefined && !record.repoRefs.includes(repoRef)) continue;
      if (taskRef !== undefined && !record.taskRefs.includes(taskRef)) continue;
      if (resourceRef !== undefined && !record.resourceRefs.includes(resourceRef)) continue;
      if (authorize({ requesterSessionId: requester, targetSessionId: record.sessionId, scopeRef, projectRef: record.projectRef }) !== true) continue;
      results.push(publicPresence(record, now, this.#maxFreshnessMs));
    }
    return results.sort((left, right) => right.updatedAt - left.updatedAt || left.routeRef.localeCompare(right.routeRef));
  }

  resolve(routeRef) {
    return this.#byRoute.get(nonEmptyString(routeRef, "routeRef", 128));
  }

  resolveSession(scopeRef, sessionId) {
    const routeRef = this.#byScopedSession.get(`${nonEmptyString(scopeRef, "scopeRef", 256)}\u0000${nonEmptyString(sessionId, "sessionId", 256)}`);
    return routeRef === undefined ? undefined : this.#byRoute.get(routeRef);
  }
}

export class CollaborationBroker {
  #directory;
  #authorize;
  #verifyReason;
  #hasWakeGrant;
  #now;
  #maxFreshnessMs;
  #cooldownMs;
  #admissionTtlMs;
  #secret;
  #cooldowns = new Map();
  #admissions = new Map();

  constructor({ directory, secret, authorize, verifyReason, hasWakeGrant = () => false, now = Date.now, maxFreshnessMs = 60_000, cooldownMs = 90_000, admissionTtlMs = 30_000 } = {}) {
    if (!(directory instanceof CollaborationDirectory)) throw new TypeError("directory must be a CollaborationDirectory");
    if (typeof secret !== "string" && !Buffer.isBuffer(secret)) throw new TypeError("broker secret is required");
    if (secret.length < 16) throw new RangeError("broker secret must contain at least 16 bytes");
    if (typeof authorize !== "function" || typeof verifyReason !== "function" || typeof hasWakeGrant !== "function") throw new TypeError("broker policy callbacks are required");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    for (const [name, value, minimum] of [["maxFreshnessMs", maxFreshnessMs, 1_000], ["cooldownMs", cooldownMs, 1_000], ["admissionTtlMs", admissionTtlMs, 1_000]]) {
      if (!Number.isSafeInteger(value) || value < minimum) throw new RangeError(`${name} must be at least ${minimum}`);
    }
    this.#directory = directory;
    this.#secret = secret;
    this.#authorize = authorize;
    this.#verifyReason = verifyReason;
    this.#hasWakeGrant = hasWakeGrant;
    this.#now = now;
    this.#maxFreshnessMs = maxFreshnessMs;
    this.#cooldownMs = cooldownMs;
    this.#admissionTtlMs = admissionTtlMs;
  }

  async admit(intent, context) {
    if (intent === null || typeof intent !== "object" || Array.isArray(intent)) return reject("INVALID_INTENT");
    for (const field of PRIVATE_TARGET_FIELDS) if (Object.prototype.hasOwnProperty.call(intent, field)) return reject("RAW_ID_FORBIDDEN", field);
    if (Array.isArray(intent.targets) || Array.isArray(intent.routeRefs)) return reject("FANOUT_FORBIDDEN");
    if (context === null || typeof context !== "object" || Array.isArray(context)) return reject("INVALID_CONTEXT");

    let routeRef;
    let reason;
    let scopeRef;
    let senderSessionId;
    try {
      routeRef = nonEmptyString(intent.routeRef, "routeRef", 128);
      reason = nonEmptyString(intent.reason, "reason", 64);
      scopeRef = nonEmptyString(context.scopeRef, "scopeRef", 256);
      senderSessionId = nonEmptyString(context.senderSessionId, "senderSessionId", 256);
    } catch (error) {
      return reject("INVALID_INTENT", String(error));
    }
    if (!ROUTE_REF.test(routeRef)) return reject("INVALID_ROUTE_REF");
    if (!COLLABORATION_REASONS.includes(reason)) return reject("UNSUPPORTED_REASON");
    if (!requiredEvidence(reason, intent.evidence)) return reject("EVIDENCE_REQUIRED", REASON_EVIDENCE[reason].join(","));

    const target = this.#directory.resolve(routeRef);
    const sender = this.#directory.resolveSession(scopeRef, senderSessionId);
    if (target === undefined) return reject("TARGET_NOT_FOUND");
    if (sender === undefined) return reject("SENDER_NOT_REGISTERED");
    if (sender.activity === "paused") return reject("SENDER_PAUSED");
    if (sender.activity === "offline") return reject("SENDER_UNAVAILABLE");
    if (target.activity === "offline") return reject("TARGET_UNAVAILABLE");
    if (target.sessionId === senderSessionId) return reject("SELF_TARGET");
    if (target.scopeRef !== scopeRef) return reject("SCOPE_MISMATCH");
    if (context.projectRef !== undefined && target.projectRef !== context.projectRef) return reject("PROJECT_MISMATCH");

    const now = this.#now();
    if (now - sender.updatedAt > this.#maxFreshnessMs) return reject("SENDER_STALE");
    if (now - target.updatedAt > this.#maxFreshnessMs) return reject("TARGET_STALE");
    const hop = intent.hop === undefined ? 0 : intent.hop;
    if (!Number.isSafeInteger(hop) || hop < 0) return reject("INVALID_HOP");
    const maxHop = context.transport === "lan" ? 0 : 1;
    if (hop > maxHop) return reject("HOP_LIMIT");
    const chain = uniqueStrings(context.chain ?? [], "chain", 8);
    if (chain.includes(routeRef) || new Set(chain).size !== chain.length) return reject("COLLABORATION_LOOP");
    const fanoutUsed = context.fanoutUsed === undefined ? 0 : context.fanoutUsed;
    if (!Number.isSafeInteger(fanoutUsed) || fanoutUsed < 0) return reject("INVALID_FANOUT");
    if (fanoutUsed >= 1) return reject("FANOUT_LIMIT");

    const authorized = await this.#authorize({ sender, target, intent, context });
    if (authorized !== true) return reject("UNAUTHORIZED");
    const verification = await this.#verifyReason({ sender, target, reason, evidence: intent.evidence, context });
    const verified = verification === true || verification?.ok === true;
    if (!verified) return reject("REASON_NOT_VERIFIED");

    const evidenceDigest = hmacRef("evidence", this.#secret, [reason, canonicalJson(intent.evidence)], 20);
    const dedupeKey = hmacRef("collab", this.#secret, [sender.routeRef, routeRef, reason, evidenceDigest], 24);
    const cooldownUntil = this.#cooldowns.get(dedupeKey);
    if (cooldownUntil !== undefined && cooldownUntil > now) return reject("COOLDOWN", { retryAfterMs: cooldownUntil - now });

    let deliveryMode = "inbox";
    let wakeLevel = 1;
    let wakeDowngraded = false;
    const requestedWakeLevel = intent.wakeLevel === undefined ? 1 : intent.wakeLevel;
    if (![0, 1, 2].includes(requestedWakeLevel)) return reject("INVALID_WAKE_LEVEL");
    if (target.activity === "paused") {
      deliveryMode = "deferred";
      wakeLevel = 0;
      wakeDowngraded = requestedWakeLevel > 0;
    } else if (requestedWakeLevel === 2) {
      const granted = await this.#hasWakeGrant({ sender, target, intent, context });
      if (granted === true) {
        deliveryMode = "wake";
        wakeLevel = 2;
      } else {
        wakeDowngraded = true;
      }
    } else if (requestedWakeLevel === 0) {
      deliveryMode = "suggestion";
      wakeLevel = 0;
    }

    const admissionRef = `admit_${randomBytes(18).toString("base64url")}`;
    const expiresAt = now + this.#admissionTtlMs;
    this.#admissions.set(admissionRef, {
      admissionRef,
      targetSessionId: target.sessionId,
      targetRouteRef: target.routeRef,
      targetPauseEpoch: target.pauseEpoch,
      senderSessionId,
      senderRouteRef: sender.routeRef,
      reason,
      evidenceDigest,
      deliveryMode,
      wakeLevel,
      expiresAt,
    });
    this.#cooldowns.set(dedupeKey, now + this.#cooldownMs);
    return Object.freeze({
      admitted: true,
      code: wakeDowngraded ? "ADMITTED_WAKE_DOWNGRADED" : "ADMITTED",
      admissionRef,
      routeRef,
      reason,
      evidenceDigest,
      deliveryMode,
      wakeLevel,
      dedupeKey,
      expiresAt,
    });
  }

  consume(admissionRef) {
    const ref = nonEmptyString(admissionRef, "admissionRef", 128);
    const admission = this.#admissions.get(ref);
    if (admission === undefined) return undefined;
    this.#admissions.delete(ref);
    if (admission.expiresAt <= this.#now()) return undefined;
    return { ...admission };
  }

  cleanup() {
    const now = this.#now();
    for (const [key, expiresAt] of this.#cooldowns) if (expiresAt <= now) this.#cooldowns.delete(key);
    for (const [key, admission] of this.#admissions) if (admission.expiresAt <= now) this.#admissions.delete(key);
  }
}
