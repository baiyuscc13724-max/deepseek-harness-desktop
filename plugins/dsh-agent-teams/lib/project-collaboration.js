import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

const PROJECT_PROTOCOL_VERSION = 1;
const PROJECT_HOST_STATE_VERSION = 1;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_HOST_STATE_BYTES = 16 * 1024 * 1024;
const MAX_PERSISTED_MEMBERS = 2_000;
const MAX_PERSISTED_EVENTS = 20_000;
const MAX_REPLAY_LIMIT = 500;
const DEFAULT_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const DEFAULT_EVENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const ROLES = Object.freeze(["owner", "maintainer", "contributor", "reviewer", "observer"]);
const ROLE_RANK = Object.freeze({ owner: 0, maintainer: 1, contributor: 2, reviewer: 2, observer: 3 });
const EVENT_PERMISSIONS = Object.freeze({
  "presence.update": "presence",
  "task.upsert": "task",
  "resource.claim": "source",
  "changeset.publish": "source",
  "review.submit": "review",
  "defect.route": "defect",
  "handoff.request": "collaboration",
});
const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(["presence", "task", "source", "review", "defect", "collaboration", "membership", "authority"]),
  maintainer: Object.freeze(["presence", "task", "source", "review", "defect", "collaboration", "membership"]),
  contributor: Object.freeze(["presence", "task", "source", "collaboration"]),
  reviewer: Object.freeze(["presence", "review", "defect", "collaboration"]),
  observer: Object.freeze(["presence"]),
});
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "sessionid", "targetsessionid", "membersessionid", "userid", "deviceid", "accountid", "email", "ipaddress",
]);
const PROJECT_REF = /^project_[A-Za-z0-9_-]{20,64}$/u;
const COLLABORATOR_REF = /^collaborator_[A-Za-z0-9_-]{20,64}$/u;
const DEVICE_REF = /^device_[A-Za-z0-9_-]{20,64}$/u;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeTime(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer timestamp`);
  return value;
}
function safePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`);
  return value;
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function assertLosslessJson(value, field = "payload", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${field} contains a non-finite number`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${field} must be lossless JSON`);
  if (seen.has(value)) throw new TypeError(`${field} contains a cycle`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`${field} contains a sparse array`);
      assertLosslessJson(value[index], `${field}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must contain plain objects only`);
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_PAYLOAD_KEYS.has(key.replaceAll(/[-_]/gu, "").toLowerCase())) throw new TypeError(`${field} contains forbidden raw identity field ${key}`);
      assertLosslessJson(nested, `${field}.${key}`, seen);
    }
  }
  seen.delete(value);
}
function cloneJson(value, field = "payload", maxBytes = MAX_EVENT_BYTES) {
  assertLosslessJson(value, field);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) throw new RangeError(`${field} exceeds ${maxBytes} bytes`);
  return JSON.parse(encoded);
}
function immutable(value) {
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function hmacRef(prefix, secret, ...parts) {
  return `${prefix}_${createHmac("sha256", secret).update(parts.map(String).join("\u0000")).digest("base64url").slice(0, 26)}`;
}
function shaRef(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("base64url")}`;
}
function keyObject(value, kind, field) {
  let key;
  try {
    if (isRecord(value) && value.type === kind && typeof value.export === "function") key = value;
    else key = kind === "private" ? createPrivateKey(value) : createPublicKey(value);
  } catch (error) { throw new TypeError(`${field} is not a valid ${kind} key: ${String(error)}`); }
  if (key.asymmetricKeyType !== "ed25519") throw new TypeError(`${field} must be Ed25519`);
  return key;
}
function publicKeyBytes(value) {
  return keyObject(value, "public", "publicKey").export({ type: "spki", format: "der" });
}
function keyId(value) {
  return shaRef("key", publicKeyBytes(value));
}
function exportPrivateKey(value) {
  return keyObject(value, "private", "privateKey").export({ type: "pkcs8", format: "der" }).toString("base64url");
}
function exportPublicKey(value) {
  return publicKeyBytes(value).toString("base64url");
}
function importPrivateKey(value, field) {
  return keyObject({ key: Buffer.from(nonEmptyString(value, field, 8_192), "base64url"), type: "pkcs8", format: "der" }, "private", field);
}
function importPublicKey(value, field) {
  return keyObject({ key: Buffer.from(nonEmptyString(value, field, 8_192), "base64url"), type: "spki", format: "der" }, "public", field);
}
function signObject(value, privateKey) {
  return cryptoSign(null, Buffer.from(canonicalJson(value)), keyObject(privateKey, "private", "privateKey")).toString("base64url");
}
function verifyObject(value, signature, publicKey) {
  if (typeof signature !== "string" || signature === "") return false;
  try { return cryptoVerify(null, Buffer.from(canonicalJson(value)), keyObject(publicKey, "public", "publicKey"), Buffer.from(signature, "base64url")); }
  catch { return false; }
}
function grantBody(grant) {
  return {
    version: grant.version,
    projectRef: grant.projectRef,
    authorityEpoch: grant.authorityEpoch,
    authorityKeyId: grant.authorityKeyId,
    collaboratorRef: grant.collaboratorRef,
    deviceRef: grant.deviceRef,
    displayName: grant.displayName,
    role: grant.role,
    permissions: grant.permissions,
    deviceKeyId: grant.deviceKeyId,
    grantVersion: grant.grantVersion,
    issuedAt: grant.issuedAt,
    expiresAt: grant.expiresAt,
  };
}
function eventBody(event) {
  return {
    version: event.version,
    projectRef: event.projectRef,
    authorityEpoch: event.authorityEpoch,
    collaboratorRef: event.collaboratorRef,
    deviceRef: event.deviceRef,
    grantVersion: event.grantVersion,
    sequence: event.sequence,
    prevDigest: event.prevDigest,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt,
  };
}
function publicMember(member) {
  return immutable({
    collaboratorRef: member.collaboratorRef,
    deviceRef: member.deviceRef,
    displayName: member.displayName,
    role: member.role,
    permissions: [...member.permissions],
    deviceKeyId: member.deviceKeyId,
    grantVersion: member.grantVersion,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  });
}
function eventPermission(type) {
  const permission = EVENT_PERMISSIONS[type];
  if (permission === undefined) throw new TypeError(`unsupported project event type ${String(type)}`);
  return permission;
}
function normalizeHostState(value) {
  if (!isRecord(value)) throw new TypeError("project Host state must be an object");
  assertAllowedKeys(value, new Set(["version", "identitySeed", "secret", "projectRef", "authorityEpoch", "authorityPrivateKey", "authorityKeyId", "authoritySequence", "grantTtlMs", "eventMaxAgeMs", "clockSkewMs", "members", "events"]), "project Host state");
  if (value.version !== PROJECT_HOST_STATE_VERSION) throw new TypeError("unsupported project Host state version");
  const secret = nonEmptyString(value.secret, "hostState.secret", 512);
  if (secret.length < 24) throw new TypeError("hostState.secret must contain at least 24 characters");
  const identitySeed = nonEmptyString(value.identitySeed, "hostState.identitySeed", 128);
  if (!/^identity_[A-Za-z0-9_-]{20,64}$/u.test(identitySeed)) throw new TypeError("hostState.identitySeed is invalid");
  const projectRef = nonEmptyString(value.projectRef, "hostState.projectRef", 128);
  if (!PROJECT_REF.test(projectRef) || projectRef !== hmacRef("project", secret, identitySeed)) throw new TypeError("hostState.projectRef does not match its identity seed");
  const authorityPrivateKey = importPrivateKey(value.authorityPrivateKey, "hostState.authorityPrivateKey");
  const authorityPublicKey = createPublicKey(authorityPrivateKey);
  const authorityKeyId = nonEmptyString(value.authorityKeyId, "hostState.authorityKeyId", 128);
  if (authorityKeyId !== keyId(authorityPublicKey)) throw new TypeError("hostState authority key id is invalid");
  const authorityEpoch = safePositiveInteger(value.authorityEpoch, "hostState.authorityEpoch");
  const authoritySequence = safeTime(value.authoritySequence, "hostState.authoritySequence");
  const grantTtlMs = safePositiveInteger(value.grantTtlMs, "hostState.grantTtlMs");
  const eventMaxAgeMs = safePositiveInteger(value.eventMaxAgeMs, "hostState.eventMaxAgeMs");
  const clockSkewMs = safePositiveInteger(value.clockSkewMs, "hostState.clockSkewMs");
  if (!Array.isArray(value.members) || value.members.length > MAX_PERSISTED_MEMBERS) throw new TypeError("hostState.members is invalid");
  const memberRefs = new Set();
  const members = value.members.map((member, index) => {
    if (!isRecord(member)) throw new TypeError(`hostState.members[${index}] must be an object`);
    assertAllowedKeys(member, new Set(["collaboratorRef", "deviceRef", "displayName", "role", "publicKey", "deviceKeyId", "grantVersion", "status", "lastSequence", "lastDigest", "createdAt", "updatedAt"]), `hostState.members[${index}]`);
    const collaboratorRef = nonEmptyString(member.collaboratorRef, `hostState.members[${index}].collaboratorRef`, 128);
    const deviceRef = nonEmptyString(member.deviceRef, `hostState.members[${index}].deviceRef`, 128);
    if (!COLLABORATOR_REF.test(collaboratorRef) || !DEVICE_REF.test(deviceRef) || memberRefs.has(deviceRef)) throw new TypeError(`hostState.members[${index}] has invalid or duplicate opaque references`);
    memberRefs.add(deviceRef);
    const role = nonEmptyString(member.role, `hostState.members[${index}].role`, 32);
    if (!ROLES.includes(role)) throw new TypeError(`hostState.members[${index}].role is unsupported`);
    const publicKey = importPublicKey(member.publicKey, `hostState.members[${index}].publicKey`);
    const deviceKeyId = nonEmptyString(member.deviceKeyId, `hostState.members[${index}].deviceKeyId`, 128);
    if (deviceKeyId !== keyId(publicKey)) throw new TypeError(`hostState.members[${index}] key id is invalid`);
    const status = nonEmptyString(member.status, `hostState.members[${index}].status`, 32);
    if (!new Set(["active", "revoked"]).has(status)) throw new TypeError(`hostState.members[${index}].status is unsupported`);
    return {
      collaboratorRef,
      deviceRef,
      displayName: nonEmptyString(member.displayName, `hostState.members[${index}].displayName`, 128),
      role,
      permissions: [...ROLE_PERMISSIONS[role]],
      publicKey,
      deviceKeyId,
      grantVersion: safePositiveInteger(member.grantVersion, `hostState.members[${index}].grantVersion`),
      status,
      lastSequence: safeTime(member.lastSequence, `hostState.members[${index}].lastSequence`),
      lastDigest: nonEmptyString(member.lastDigest, `hostState.members[${index}].lastDigest`, 128),
      createdAt: safeTime(member.createdAt, `hostState.members[${index}].createdAt`),
      updatedAt: safeTime(member.updatedAt, `hostState.members[${index}].updatedAt`),
    };
  });
  if (!Array.isArray(value.events) || value.events.length > MAX_PERSISTED_EVENTS) throw new TypeError("hostState.events is invalid");
  const events = cloneJson(value.events, "hostState.events", MAX_HOST_STATE_BYTES).map((event, index) => {
    if (!isRecord(event) || !new Set(["device", "authority"]).has(event.issuer) || event.projectRef !== projectRef || typeof event.eventRef !== "string" || typeof event.signature !== "string") throw new TypeError(`hostState.events[${index}] is invalid`);
    return immutable(event);
  });
  if (new Set(events.map((event) => event.eventRef)).size !== events.length) throw new TypeError("hostState.events contains duplicate event references");
  return { secret, identitySeed, projectRef, authorityEpoch, authorityPrivateKey, authorityPublicKey, authorityKeyId, authoritySequence, grantTtlMs, eventMaxAgeMs, clockSkewMs, members, events };
}

export function verifyMembershipGrant(grant, authorityPublicKey, now = Date.now()) {
  if (!isRecord(grant) || !isRecord(grantBody(grant))) return false;
  if (!PROJECT_REF.test(grant.projectRef ?? "") || !COLLABORATOR_REF.test(grant.collaboratorRef ?? "") || !DEVICE_REF.test(grant.deviceRef ?? "")) return false;
  if (!Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= now) return false;
  return verifyObject(grantBody(grant), grant.signature, authorityPublicKey);
}

export function signProjectEvent(event, devicePrivateKey) {
  const body = eventBody(event);
  cloneJson(body.payload);
  return immutable({ ...body, signature: signObject(body, devicePrivateKey) });
}

export function verifyAuthorityTransition(transition, previousAuthorityPublicKey, nextAuthorityPublicKey) {
  if (!isRecord(transition)) return false;
  const body = {
    version: transition.version,
    projectRef: transition.projectRef,
    previousEpoch: transition.previousEpoch,
    nextEpoch: transition.nextEpoch,
    previousAuthorityKeyId: transition.previousAuthorityKeyId,
    nextAuthorityKeyId: transition.nextAuthorityKeyId,
    createdAt: transition.createdAt,
  };
  return body.version === PROJECT_PROTOCOL_VERSION
    && PROJECT_REF.test(body.projectRef ?? "")
    && body.nextEpoch === body.previousEpoch + 1
    && verifyObject(body, transition.previousSignature, previousAuthorityPublicKey)
    && verifyObject(body, transition.nextSignature, nextAuthorityPublicKey);
}

export function createDeviceKeyRotationProof({ projectRef, authorityEpoch, deviceRef, grantVersion, newPublicKey }, oldPrivateKey) {
  const proof = {
    version: PROJECT_PROTOCOL_VERSION,
    projectRef: nonEmptyString(projectRef, "projectRef", 128),
    authorityEpoch: safePositiveInteger(authorityEpoch, "authorityEpoch"),
    deviceRef: nonEmptyString(deviceRef, "deviceRef", 128),
    nextGrantVersion: safePositiveInteger(grantVersion, "grantVersion") + 1,
    newDeviceKeyId: keyId(newPublicKey),
  };
  return immutable({ proof, signature: signObject(proof, oldPrivateKey) });
}

export class ProjectCollaborationAuthority {
  constructor({ projectIdentity, secret, authorityPrivateKey, hostState, now = Date.now, grantTtlMs = DEFAULT_GRANT_TTL_MS, eventMaxAgeMs = DEFAULT_EVENT_MAX_AGE_MS, clockSkewMs = DEFAULT_CLOCK_SKEW_MS } = {}) {
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    if (hostState !== undefined) {
      const restored = normalizeHostState(hostState);
      this.secret = restored.secret;
      this.identitySeed = restored.identitySeed;
      this.projectRef = restored.projectRef;
      this.authorityEpoch = restored.authorityEpoch;
      this.authorityPrivateKey = restored.authorityPrivateKey;
      this.authorityPublicKey = restored.authorityPublicKey;
      this.authorityKeyId = restored.authorityKeyId;
      this.authoritySequence = restored.authoritySequence;
      this.grantTtlMs = restored.grantTtlMs;
      this.eventMaxAgeMs = restored.eventMaxAgeMs;
      this.clockSkewMs = restored.clockSkewMs;
      this.members = new Map(restored.members.map((member) => [member.deviceRef, member]));
      this.events = restored.events;
      this.eventsByRef = new Map(restored.events.map((event) => [event.eventRef, event]));
      return;
    }
    const privateProjectIdentity = nonEmptyString(projectIdentity, "projectIdentity", 512);
    this.secret = nonEmptyString(secret, "secret", 512);
    if (this.secret.length < 24) throw new TypeError("secret must contain at least 24 characters");
    this.identitySeed = hmacRef("identity", this.secret, privateProjectIdentity);
    this.authorityPrivateKey = keyObject(authorityPrivateKey, "private", "authorityPrivateKey");
    this.authorityPublicKey = createPublicKey(this.authorityPrivateKey);
    this.authorityKeyId = keyId(this.authorityPublicKey);
    this.projectRef = hmacRef("project", this.secret, this.identitySeed);
    this.authorityEpoch = 1;
    this.grantTtlMs = safePositiveInteger(grantTtlMs, "grantTtlMs");
    this.eventMaxAgeMs = safePositiveInteger(eventMaxAgeMs, "eventMaxAgeMs");
    this.clockSkewMs = safePositiveInteger(clockSkewMs, "clockSkewMs");
    this.members = new Map();
    this.events = [];
    this.eventsByRef = new Map();
    this.authoritySequence = 0;
  }

  static restore(hostState, options = {}) {
    return new ProjectCollaborationAuthority({ ...options, hostState });
  }

  authorityPublicKeyPem() {
    return this.authorityPublicKey.export({ type: "spki", format: "pem" });
  }

  toJSON() {
    return { version: PROJECT_PROTOCOL_VERSION, projectRef: this.projectRef, authorityEpoch: this.authorityEpoch, authorityKeyId: this.authorityKeyId, memberCount: this.members.size, eventCount: this.events.length };
  }

  exportHostState() {
    return cloneJson({
      version: PROJECT_HOST_STATE_VERSION,
      identitySeed: this.identitySeed,
      secret: this.secret,
      projectRef: this.projectRef,
      authorityEpoch: this.authorityEpoch,
      authorityPrivateKey: exportPrivateKey(this.authorityPrivateKey),
      authorityKeyId: this.authorityKeyId,
      authoritySequence: this.authoritySequence,
      grantTtlMs: this.grantTtlMs,
      eventMaxAgeMs: this.eventMaxAgeMs,
      clockSkewMs: this.clockSkewMs,
      members: [...this.members.values()].map((member) => ({
        collaboratorRef: member.collaboratorRef,
        deviceRef: member.deviceRef,
        displayName: member.displayName,
        role: member.role,
        publicKey: exportPublicKey(member.publicKey),
        deviceKeyId: member.deviceKeyId,
        grantVersion: member.grantVersion,
        status: member.status,
        lastSequence: member.lastSequence,
        lastDigest: member.lastDigest,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
      })),
      events: this.events,
    }, "project Host state", MAX_HOST_STATE_BYTES);
  }

  registerDevice({ actorDeviceRef, userHandle, deviceHandle, displayName, role, publicKey, expiresAt } = {}) {
    const normalizedRole = nonEmptyString(role, "role", 32);
    if (!ROLES.includes(normalizedRole)) throw new TypeError(`role must be one of ${ROLES.join(", ")}`);
    if (this.members.size === 0) {
      if (actorDeviceRef !== undefined || normalizedRole !== "owner") throw new Error("the first project device must bootstrap the owner without an actor");
    } else {
      const actor = this.#requirePermission(actorDeviceRef, "membership");
      if (actor.role !== "owner" && ROLE_RANK[normalizedRole] <= ROLE_RANK.maintainer) throw new Error("only an owner can grant owner or maintainer roles");
    }
    const privateUserHandle = nonEmptyString(userHandle, "userHandle", 512);
    const privateDeviceHandle = nonEmptyString(deviceHandle, "deviceHandle", 512);
    const collaboratorRef = hmacRef("collaborator", this.secret, this.identitySeed, privateUserHandle);
    const deviceRef = hmacRef("device", this.secret, this.identitySeed, privateUserHandle, privateDeviceHandle);
    if (this.members.has(deviceRef)) throw new Error("this private user/device identity is already registered");
    const publicKeyObject = keyObject(publicKey, "public", "publicKey");
    const current = this.now();
    const member = {
      collaboratorRef,
      deviceRef,
      displayName: nonEmptyString(displayName, "displayName", 128),
      role: normalizedRole,
      permissions: [...ROLE_PERMISSIONS[normalizedRole]],
      publicKey: publicKeyObject,
      deviceKeyId: keyId(publicKeyObject),
      grantVersion: 1,
      status: "active",
      lastSequence: 0,
      lastDigest: `event_genesis_${deviceRef}`,
      createdAt: current,
      updatedAt: current,
    };
    this.members.set(deviceRef, member);
    const grant = this.#issueGrant(member, expiresAt);
    this.#appendAuthorityEvent("membership.granted", { collaboratorRef, deviceRef, role: normalizedRole, deviceKeyId: member.deviceKeyId, grantVersion: member.grantVersion });
    return Object.freeze({ grant, member: publicMember(member) });
  }

  renewGrant({ actorDeviceRef, deviceRef, expiresAt } = {}) {
    this.#requirePermission(actorDeviceRef, "membership");
    const member = this.#activeMember(deviceRef);
    return this.#issueGrant(member, expiresAt);
  }

  listMembers(requesterDeviceRef) {
    this.#activeMember(requesterDeviceRef);
    return [...this.members.values()].map(publicMember);
  }

  nextEvent({ deviceRef, type, payload, createdAt = this.now() } = {}) {
    const member = this.#activeMember(deviceRef);
    const permission = eventPermission(type);
    if (!member.permissions.includes(permission)) throw new Error(`role ${member.role} cannot emit ${type}`);
    const event = {
      version: PROJECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      authorityEpoch: this.authorityEpoch,
      collaboratorRef: member.collaboratorRef,
      deviceRef: member.deviceRef,
      grantVersion: member.grantVersion,
      sequence: member.lastSequence + 1,
      prevDigest: member.lastDigest,
      type,
      payload: cloneJson(payload),
      createdAt: safeTime(createdAt, "createdAt"),
    };
    return immutable(event);
  }

  submitEvent({ grant, event, signature } = {}) {
    const body = eventBody(event ?? {});
    const member = this.#activeMember(body.deviceRef);
    this.#assertCurrentGrant(grant, member);
    if (body.version !== PROJECT_PROTOCOL_VERSION || body.projectRef !== this.projectRef || body.authorityEpoch !== this.authorityEpoch) throw new Error("project event scope or authority epoch is stale");
    if (body.collaboratorRef !== member.collaboratorRef || body.grantVersion !== member.grantVersion) throw new Error("project event identity or grant version does not match");
    const permission = eventPermission(body.type);
    if (!member.permissions.includes(permission)) throw new Error(`role ${member.role} cannot emit ${body.type}`);
    body.payload = cloneJson(body.payload);
    safeTime(body.createdAt, "event.createdAt");
    const current = this.now();
    if (body.createdAt > current + this.clockSkewMs) throw new Error("project event is too far in the future");
    if (body.createdAt + this.eventMaxAgeMs < current) throw new Error("project event is too old for admission");
    if (!verifyObject(body, signature, member.publicKey)) throw new Error("project event signature is invalid");
    const digest = shaRef("event", Buffer.from(canonicalJson(body)));
    const existing = this.eventsByRef.get(digest);
    if (existing !== undefined) return Object.freeze({ admitted: true, duplicate: true, event: existing });
    if (body.sequence !== member.lastSequence + 1 || body.prevDigest !== member.lastDigest) throw new Error("project event sequence or hash chain is stale");
    const record = immutable({ issuer: "device", ...body, eventRef: digest, payloadDigest: shaRef("payload", Buffer.from(canonicalJson(body.payload))), signature });
    this.events.push(record);
    this.eventsByRef.set(digest, record);
    member.lastSequence = body.sequence;
    member.lastDigest = digest;
    member.updatedAt = current;
    return Object.freeze({ admitted: true, duplicate: false, event: record });
  }

  revokeDevice({ actorDeviceRef, targetDeviceRef, reason = "revoked" } = {}) {
    const actor = this.#requirePermission(actorDeviceRef, "membership");
    const target = this.#activeMember(targetDeviceRef);
    if (actor.deviceRef === target.deviceRef) throw new Error("an owner or maintainer cannot revoke its own current device");
    if (actor.role !== "owner" && ROLE_RANK[target.role] <= ROLE_RANK[actor.role]) throw new Error("a maintainer cannot revoke an owner or peer maintainer");
    if (target.role === "owner" && [...this.members.values()].filter((member) => member.status === "active" && member.role === "owner").length <= 1) throw new Error("the final active owner cannot be revoked");
    target.status = "revoked";
    target.updatedAt = this.now();
    target.grantVersion += 1;
    const event = this.#appendAuthorityEvent("membership.revoked", { targetDeviceRef: target.deviceRef, targetCollaboratorRef: target.collaboratorRef, reason: nonEmptyString(reason, "reason", 256) });
    return Object.freeze({ revoked: true, event });
  }

  rotateDeviceKey({ actorDeviceRef, deviceRef, newPublicKey, proof, expiresAt } = {}) {
    const actor = this.#activeMember(actorDeviceRef);
    const member = this.#activeMember(deviceRef);
    if (actor.deviceRef !== member.deviceRef && !actor.permissions.includes("membership")) throw new Error("device key rotation requires the same device or membership authority");
    const newPublicKeyObject = keyObject(newPublicKey, "public", "newPublicKey");
    const expectedProof = {
      version: PROJECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      authorityEpoch: this.authorityEpoch,
      deviceRef: member.deviceRef,
      nextGrantVersion: member.grantVersion + 1,
      newDeviceKeyId: keyId(newPublicKeyObject),
    };
    if (!isRecord(proof) || canonicalJson(proof.proof) !== canonicalJson(expectedProof) || !verifyObject(expectedProof, proof.signature, member.publicKey)) throw new Error("device key rotation proof is invalid");
    member.publicKey = newPublicKeyObject;
    member.deviceKeyId = expectedProof.newDeviceKeyId;
    member.grantVersion += 1;
    member.updatedAt = this.now();
    const grant = this.#issueGrant(member, expiresAt);
    const event = this.#appendAuthorityEvent("membership.key-rotated", { deviceRef: member.deviceRef, collaboratorRef: member.collaboratorRef, deviceKeyId: member.deviceKeyId, grantVersion: member.grantVersion });
    return Object.freeze({ grant, event });
  }

  advanceAuthorityEpoch({ newAuthorityPrivateKey } = {}) {
    const previousPrivateKey = this.authorityPrivateKey;
    const previousKeyId = this.authorityKeyId;
    const nextPrivateKey = keyObject(newAuthorityPrivateKey, "private", "newAuthorityPrivateKey");
    const nextPublicKey = createPublicKey(nextPrivateKey);
    const transition = {
      version: PROJECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      previousEpoch: this.authorityEpoch,
      nextEpoch: this.authorityEpoch + 1,
      previousAuthorityKeyId: previousKeyId,
      nextAuthorityKeyId: keyId(nextPublicKey),
      createdAt: this.now(),
    };
    const previousSignature = signObject(transition, previousPrivateKey);
    const nextSignature = signObject(transition, nextPrivateKey);
    this.authorityEpoch += 1;
    this.authorityPrivateKey = nextPrivateKey;
    this.authorityPublicKey = nextPublicKey;
    this.authorityKeyId = transition.nextAuthorityKeyId;
    for (const member of this.members.values()) member.grantVersion += 1;
    const event = this.#appendAuthorityEvent("authority.epoch-advanced", { ...transition, previousSignature, nextSignature });
    return Object.freeze({ transition: Object.freeze({ ...transition, previousSignature, nextSignature }), event });
  }

  cursorAtEnd(requesterDeviceRef) {
    this.#activeMember(requesterDeviceRef);
    return this.#cursor(this.events.length);
  }

  replay({ requesterDeviceRef, cursor, limit = 100 } = {}) {
    this.#activeMember(requesterDeviceRef);
    const offset = this.#parseCursor(cursor);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPLAY_LIMIT) throw new TypeError(`limit must be an integer from 1 through ${MAX_REPLAY_LIMIT}`);
    const events = this.events.slice(offset, offset + limit);
    const nextOffset = offset + events.length;
    return immutable({ events: [...events], nextCursor: this.#cursor(nextOffset), hasMore: nextOffset < this.events.length });
  }

  #issueGrant(member, expiresAt) {
    const issuedAt = this.now();
    const expiry = expiresAt === undefined ? issuedAt + this.grantTtlMs : safeTime(expiresAt, "expiresAt");
    if (expiry <= issuedAt || expiry > issuedAt + this.grantTtlMs) throw new Error("grant expiry is outside the allowed lifetime");
    const body = {
      version: PROJECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      authorityEpoch: this.authorityEpoch,
      authorityKeyId: this.authorityKeyId,
      collaboratorRef: member.collaboratorRef,
      deviceRef: member.deviceRef,
      displayName: member.displayName,
      role: member.role,
      permissions: [...member.permissions],
      deviceKeyId: member.deviceKeyId,
      grantVersion: member.grantVersion,
      issuedAt,
      expiresAt: expiry,
    };
    return immutable({ ...body, signature: signObject(body, this.authorityPrivateKey) });
  }

  #assertCurrentGrant(grant, member) {
    if (!verifyMembershipGrant(grant, this.authorityPublicKey, this.now())) throw new Error("membership grant signature or lifetime is invalid");
    if (grant.projectRef !== this.projectRef || grant.authorityEpoch !== this.authorityEpoch || grant.authorityKeyId !== this.authorityKeyId) throw new Error("membership grant authority epoch is stale");
    if (grant.deviceRef !== member.deviceRef || grant.collaboratorRef !== member.collaboratorRef || grant.grantVersion !== member.grantVersion || grant.deviceKeyId !== member.deviceKeyId) throw new Error("membership grant is stale for this device");
  }

  #activeMember(deviceRef) {
    const ref = nonEmptyString(deviceRef, "deviceRef", 128);
    if (!DEVICE_REF.test(ref)) throw new Error("deviceRef is not an opaque project device reference");
    const member = this.members.get(ref);
    if (member === undefined || member.status !== "active") throw new Error("project device is unavailable or revoked");
    return member;
  }

  #requirePermission(deviceRef, permission) {
    const member = this.#activeMember(deviceRef);
    if (!member.permissions.includes(permission)) throw new Error(`role ${member.role} lacks ${permission} permission`);
    return member;
  }

  #appendAuthorityEvent(type, payload) {
    const body = {
      version: PROJECT_PROTOCOL_VERSION,
      projectRef: this.projectRef,
      authorityEpoch: this.authorityEpoch,
      authorityKeyId: this.authorityKeyId,
      sequence: ++this.authoritySequence,
      type,
      payload: cloneJson(payload),
      createdAt: this.now(),
    };
    const signature = signObject(body, this.authorityPrivateKey);
    const eventRef = shaRef("event", Buffer.from(canonicalJson(body)));
    const event = immutable({ issuer: "authority", ...body, eventRef, payloadDigest: shaRef("payload", Buffer.from(canonicalJson(body.payload))), signature });
    this.events.push(event);
    this.eventsByRef.set(eventRef, event);
    return event;
  }

  #cursor(offset) {
    const body = Buffer.from(JSON.stringify({ version: PROJECT_PROTOCOL_VERSION, projectRef: this.projectRef, offset })).toString("base64url");
    const signature = createHmac("sha256", this.secret).update(body).digest("base64url");
    return `cursor_${body}.${signature}`;
  }

  #parseCursor(cursor) {
    const value = nonEmptyString(cursor, "cursor", 2_000);
    const match = /^cursor_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(value);
    if (match === null) throw new Error("offline cursor is invalid");
    const expected = createHmac("sha256", this.secret).update(match[1]).digest("base64url");
    const supplied = Buffer.from(match[2], "base64url");
    const wanted = Buffer.from(expected, "base64url");
    if (supplied.length !== wanted.length || !cryptoVerifyCursor(supplied, wanted)) throw new Error("offline cursor signature is invalid");
    let body;
    try { body = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { throw new Error("offline cursor payload is invalid"); }
    if (!isRecord(body) || body.version !== PROJECT_PROTOCOL_VERSION || body.projectRef !== this.projectRef || !Number.isSafeInteger(body.offset) || body.offset < 0 || body.offset > this.events.length) throw new Error("offline cursor scope or offset is invalid");
    return body.offset;
  }
}

function cryptoVerifyCursor(left, right) {
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export {
  EVENT_PERMISSIONS,
  PROJECT_HOST_STATE_VERSION,
  PROJECT_PROTOCOL_VERSION,
  ROLE_PERMISSIONS,
  ROLES,
};
