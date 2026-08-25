import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, sign as cryptoSign, verify as cryptoVerify, X509Certificate } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import * as nodeTls from "node:tls";
import { ProjectCollaborationAuthority, ROLE_PERMISSIONS, verifyMembershipGrant } from "./project-collaboration.js";
import { PersistedProjectAuthority } from "./project-authority-service.js";
import { EncryptedProjectStateStore } from "./project-state-store.js";
import { assertPrivateBindHost, LAN_PROTOCOL, LanProjectTransport, PersistentLanProjectClient } from "./project-lan-transport.js";
import { createProjectLanAuthorityCredentials, createProjectLanClientCredentials, preferredLanHost, privateLanHosts, refreshProjectLanServerCredentials } from "./project-lan-credentials.js";
import { ProjectWssRelayTransport, safeRelayUrl } from "./project-wss-relay-transport.js";
import { generateProjectTransportKeys, ProjectSecureChannel, sealProjectPacket } from "./project-secure-channel.js";

const DEVICE_FILE = "agent_project_device.json";
const STATE_FILE = "agent_project_state.json";
const INVITES_FILE = "agent_project_invites.json";
const RELAY_FILE = "agent_project_relay.json";
const PENDING_JOIN_FILE = "agent_project_pending_join.json";
const LAN_CREDENTIALS_FILE = "agent_project_lan_credentials.json";
const PROJECT_TASK_DATABASE_FILE = "agent_project_tasks.sqlite";
const PROJECT_TASK_KEY_DOMAIN = "dsh-agent-teams/project-task-store/v1";
const PROJECT_AUTOMATION_DATABASE_FILE = "agent_project_automation.enc.json";
const PROJECT_AUTOMATION_KEY_DOMAIN = "dsh/project-automation-store/v1";
const PROJECT_BUSINESS_SYNC_DATABASE_FILE = "agent_project_business_sync.enc.json";
const PROJECT_BUSINESS_SYNC_KEY_DOMAIN = "dsh/project-business-sync/v1";
const PROJECT_FOUNDATIONS_DIRECTORY = "agent_project_foundations";
const PROJECT_FOUNDATION_KEY_DOMAINS = Object.freeze({
  workspace: "dsh/project-workspace/v1",
  cas: "dsh/project-cas/v1",
  quality: "dsh/project-quality/v1",
  defect: "dsh/project-defect/v1",
  defectOutbox: "dsh/project-defect-outbox/v1",
});
const PROJECT_FOUNDATION_DOMAIN_SET = new Set(Object.values(PROJECT_FOUNDATION_KEY_DOMAINS));
const DEVICE_VERSION = 1;
const INVITES_VERSION = 1;
const RELAY_VERSION = 1;
const INVITE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_INVITES = 50;
const JOIN_REQUEST_PREFIX = "joinreq_";
const JOIN_RESPONSE_PREFIX = "joinack_";
const ROLES = Object.freeze(["owner", "maintainer", "contributor", "reviewer", "observer"]);
const ENTRY_ERROR_CODES = Object.freeze([
  "PROJECT_ENTRY_ALREADY_EXISTS",
  "PROJECT_ENTRY_NOT_CREATED",
  "PROJECT_ENTRY_INVITE_INVALID",
  "PROJECT_ENTRY_INVITE_EXPIRED",
  "PROJECT_ENTRY_INVITE_LIMIT",
  "PROJECT_ENTRY_RELAY_NOT_CONFIGURED",
  "PROJECT_ENTRY_RELAY_WEBSOCKET_UNAVAILABLE",
  "PROJECT_ENTRY_RELAY_ROOM_MISSING",
  "PROJECT_ENTRY_CLOSED",
  "PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN",
  "PROJECT_ENTRY_TASK_CONTEXT_INVALID",
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function optionalRole(value) {
  const role = typeof value === "string" ? value.trim() : "";
  if (!ROLES.includes(role)) throw new TypeError(`role must be one of ${ROLES.join(", ")}`);
  return role;
}
function entryError(code, message) {
  if (!ENTRY_ERROR_CODES.includes(code)) throw new TypeError(`unsupported project entry error code ${code}`);
  const error = new Error(message);
  error.code = code;
  return error;
}
function exactBase64urlKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) return undefined;
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) {
    key.fill(0);
    return undefined;
  }
  return key;
}
function strictOpenedPeerMetadata(opened) {
  if (!isRecord(opened)) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer metadata is invalid");
  const prototype = Object.getPrototypeOf(opened);
  if (prototype !== Object.prototype && prototype !== null) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer metadata is invalid");
  const ownKeys = Reflect.ownKeys(opened);
  if (ownKeys.length !== 2 || !ownKeys.includes("senderDeviceRef") || !ownKeys.includes("authorityEpoch")) {
    throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer metadata is invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(opened);
  const sender = descriptors.senderDeviceRef;
  const epoch = descriptors.authorityEpoch;
  if (sender?.get !== undefined || sender?.set !== undefined || epoch?.get !== undefined || epoch?.set !== undefined
    || sender?.enumerable !== true || epoch?.enumerable !== true
    || typeof sender?.value !== "string" || sender.value.trim() === "" || sender.value !== sender.value.trim() || sender.value.length > 128
    || !Number.isSafeInteger(epoch?.value) || epoch.value < 1) {
    throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer metadata is invalid");
  }
  return { senderDeviceRef: sender.value, authorityEpoch: epoch.value };
}
function trustedSyncPeer({ deviceRef, collaboratorRef, role, permissions }) {
  return Object.freeze({ deviceRef, collaboratorRef, role, permissions: Object.freeze([...permissions]) });
}
function hasCanonicalSignature(value) { try { return typeof value === "string" && value !== "" && /^[A-Za-z0-9_-]+$/u.test(value) && Buffer.from(value, "base64url").toString("base64url") === value; } catch { return false; } }
function validatedCollaboratorIdentity(device, now) {
  try {
    if (!isRecord(device) || device.kind !== "collaborator" || !isRecord(device.authority) || !isRecord(device.device)) return undefined;
    const authorityPublicKey = importPublicKey(device.authority.authorityPublicKey, "authorityPublicKey", "ed25519");
    const grant = device.device.grant;
    const signingKey = importPrivateKey(device.device.signingPrivateKey, "signingPrivateKey");
    const deviceKeyId = `key_${createHash("sha256").update(createPublicKey(signingKey).export({ type: "spki", format: "der" })).digest("base64url")}`;
    if (!hasCanonicalSignature(grant?.signature)
      || !verifyMembershipGrant(grant, authorityPublicKey, now())
      || grant.projectRef !== device.projectRef
      || grant.authorityEpoch !== device.authority.authorityEpoch
      || grant.authorityKeyId !== device.authority.authorityKeyId
      || grant.deviceRef !== device.device.deviceRef
      || grant.deviceKeyId !== deviceKeyId
      || grant.displayName !== device.device.displayName
      || grant.role !== device.device.role
      || !Number.isSafeInteger(grant.grantVersion)
      || typeof grant.collaboratorRef !== "string"
      || !Array.isArray(grant.permissions)) return undefined;
    return { authorityPublicKey, grant };
  } catch {
    return undefined;
  }
}
function descriptorSafeFrozenCopy(value, seen = new Map()) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value !== "object") throw new TypeError("business delivery payload must be finite JSON data");
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key)))) throw new TypeError("business delivery array is invalid");
    const copy = []; seen.set(value, copy);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) throw new TypeError("business delivery accessor is forbidden");
      copy.push(descriptorSafeFrozenCopy(descriptor.value, seen));
    }
    return Object.freeze(copy);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("business delivery payload prototype is invalid");
  const copy = {}; seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("business delivery symbols are forbidden");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get !== undefined || descriptor?.set !== undefined || descriptor?.enumerable !== true) throw new TypeError("business delivery accessor is forbidden");
    copy[key] = descriptorSafeFrozenCopy(descriptor.value, seen);
  }
  return Object.freeze(copy);
}
function safeOpenedDelivery(opened) {
  if (!isRecord(opened)) throw new TypeError("opened project delivery must be an object");
  const descriptors = Object.getOwnPropertyDescriptors(opened);
  const sender = descriptors.senderDeviceRef;
  const epoch = descriptors.authorityEpoch;
  const payload = descriptors.payload;
  if (sender?.get !== undefined || sender?.set !== undefined || typeof sender?.value !== "string"
    || epoch?.get !== undefined || epoch?.set !== undefined || !Number.isSafeInteger(epoch?.value)
    || payload?.get !== undefined || payload?.set !== undefined) throw new TypeError("opened project delivery descriptors are invalid");
  return Object.freeze({ senderDeviceRef: sender.value, authorityEpoch: epoch.value, payload: descriptorSafeFrozenCopy(payload.value) });
}
function assertNoTransportClaims(value) {
  const forbidden = new Set(["projectRef", "senderDeviceRef", "authorityEpoch", "transport", "key", "path"]);
  const visit = (candidate, seen = new Set()) => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    for (const key of Object.keys(candidate)) {
      if (forbidden.has(key)) throw new TypeError(`message cannot provide ${key}`);
      visit(candidate[key], seen);
    }
  };
  visit(value);
}
function serverCertificateRef(cert) {
  const certificate = new X509Certificate(cert);
  return `cert_${createHash("sha256").update(certificate.raw).digest("base64url")}`;
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function nowIso() {
  return new Date().toISOString();
}
function randomRef(prefix, bytes = 24) {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}
function randomRoomRef() {
  // ROOM_REF requires exactly 43 base64url characters (32 random bytes).
  return randomBytes(32).toString("base64url");
}
function inviteFingerprint(inviteCode) {
  return createHash("sha256").update(nonEmptyString(inviteCode, "inviteCode", 4_096)).digest("base64url");
}
function exportPrivateKey(key) {
  return key.export({ type: "pkcs8", format: "der" }).toString("base64url");
}
function exportPublicKey(key) {
  const publicKey = key?.type === "public" ? key : createPublicKey(key);
  return publicKey.export({ type: "spki", format: "der" }).toString("base64url");
}
function importPrivateKey(value, field) {
  return createPrivateKey({ key: Buffer.from(nonEmptyString(value, field, 8_192), "base64url"), type: "pkcs8", format: "der" });
}
function importPublicKey(value, field, type) {
  const key = publicKeyInput({ key: Buffer.from(nonEmptyString(value, field, 8_192), "base64url"), type: "spki", format: "der" }, field);
  if (type && key.asymmetricKeyType !== type) throw new TypeError(`${field} must be ${type}`);
  return key;
}
function encodeExchange(prefix, value) {
  return `${prefix}${Buffer.from(canonicalJson(value), "utf8").toString("base64url")}`;
}
function decodeExchange(value, prefix, field) {
  const text = nonEmptyString(value, field, 64 * 1024);
  if (!text.startsWith(prefix)) throw new TypeError(`${field} has an unsupported format`);
  try {
    const parsed = JSON.parse(Buffer.from(text.slice(prefix.length), "base64url").toString("utf8"));
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch (error) { throw new TypeError(`${field} is invalid: ${String(error)}`); }
}
function pairingKey(privateKey, publicKey, aad) {
  return createHash("sha256")
    .update("Harness Desktop project pairing v1\0", "utf8")
    .update(diffieHellman({ privateKey, publicKey }))
    .update(canonicalJson(aad), "utf8")
    .digest();
}
function sealPairingMaterial(privateKey, publicKey, aad, value) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", pairingKey(privateKey, publicKey, aad), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(canonicalJson(aad), "utf8"));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(canonicalJson(value), "utf8")), cipher.final()]);
  return {
    version: 1,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}
function openPairingMaterial(privateKey, publicKey, aad, sealed) {
  if (!isRecord(sealed) || sealed.version !== 1) throw new TypeError("pairing material has an unsupported format");
  const nonce = Buffer.from(nonEmptyString(sealed.nonce, "pairing nonce", 64), "base64url");
  const ciphertext = Buffer.from(nonEmptyString(sealed.ciphertext, "pairing ciphertext", 128 * 1024), "base64url");
  const tag = Buffer.from(nonEmptyString(sealed.tag, "pairing tag", 64), "base64url");
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0 || ciphertext.length > 96 * 1024) throw new TypeError("pairing material is invalid");
  const decipher = createDecipheriv("aes-256-gcm", pairingKey(privateKey, publicKey, aad), nonce, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(canonicalJson(aad), "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext);
  if (!isRecord(parsed)) throw new TypeError("pairing material is invalid");
  return parsed;
}
function publicKeyInput(publicKey, field) {
  try {
    if (publicKey && typeof publicKey === "object" && publicKey.type === "public" && typeof publicKey.export === "function") return publicKey;
    return createPublicKey(publicKey);
  } catch (error) { throw new TypeError(`${field} must be a valid public key: ${String(error)}`); }
}
function assertIsoDate(value, field) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new TypeError(`${field} must be an ISO date string`);
}
function safeTime(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || (maximum !== undefined && value > maximum)) throw new TypeError(`${field} is invalid`);
  return value;
}
function queueByKey(queues, key, operation) {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(key, settled);
  void settled.finally(() => { if (queues.get(key) === settled) queues.delete(key); });
  return result;
}
async function atomicWriteJson(file, document) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(document)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, file);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

/**
 * Product-facing entry for cross-network project teaming. Wires the already
 * implemented project collaboration domain (authority, encrypted host state,
 * LAN mTLS transport, WSS relay transport) into a small, honest service:
 *   - createProject  creates the persisted project authority and the owner device;
 *   - createInvite   issues an HMAC-signed remote invite bound to project/room/authority;
 *   - redeemInvite   validates an invite and registers the collaborator device with a grant;
 *   - setRelay/connectRemote/disconnectRemote manage the real WSS relay transport;
 *   - lanStatus      reports the real LAN transport state without faking discovery.
 * No transport capability that does not exist at the base layer is pretended.
 */
export class ProjectEntryService {
  constructor({ dshHome, WebSocketImpl, resolveWebSocket, tlsModule = nodeTls, now = Date.now } = {}) {
    this.dshHome = nonEmptyString(dshHome, "dshHome", 4_096);
    this.storages = join(this.dshHome, "storages");
    this.deviceFile = join(this.storages, DEVICE_FILE);
    this.stateFile = join(this.storages, STATE_FILE);
    this.invitesFile = join(this.storages, INVITES_FILE);
    this.relayFile = join(this.storages, RELAY_FILE);
    this.pendingJoinFile = join(this.storages, PENDING_JOIN_FILE);
    this.lanCredentialsFile = join(this.storages, LAN_CREDENTIALS_FILE);
    this.WebSocketImpl = typeof WebSocketImpl === "function" ? WebSocketImpl : undefined;
    this.resolveWebSocket = typeof resolveWebSocket === "function" ? resolveWebSocket : undefined;
    if (!isRecord(tlsModule) || typeof tlsModule.createServer !== "function") throw new TypeError("tlsModule must provide createServer");
    this.tlsModule = tlsModule;
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.now = now;
    this.operationQueues = new Map();
    this.persisted = undefined;
    this.device = undefined;
    this.lanTransport = undefined;
    this.relayTransport = undefined;
    this.lastDelivery = undefined;
    this.businessDeliveryListeners = new Set();
    this.lanClient = undefined;
    this.taskContextEpoch = 0;
    this.taskContextKeys = new Set();
    this.taskContextClosed = false;
    this.entryClosing = false;
    this.entryClosed = false;
    this.closePromise = undefined;
  }

  /** Serialize the public, non-secret status projection used by the Web API and the client panel. */
  async status() {
    return this.#queue(async () => {
      const project = await this.#loadProjectProjection();
      const relay = await this.#loadRelayProjection();
      const lan = this.#lanProjection();
      const pendingJoin = await this.#loadPendingJoin();
      return { project, lan, relay, pairing: { pending: pendingJoin !== undefined, projectRef: pendingJoin?.projectRef } };
    });
  }

  /**
   * Return a Host-only capability context for the local project task store.
   * The opaque execution token and both closures are deliberately non-enumerable:
   * public status and accidental JSON serialization cannot expose identity or keys.
   */
  async localProjectTaskContext() {
    return this.#queue(async () => {
      const contextEpoch = this.taskContextEpoch;
      if (this.taskContextClosed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project task execution context is closed");
      let device;
      try { device = await this.#requireAuthorityDevice(); }
      catch (error) {
        if (error?.code === "PROJECT_ENTRY_NOT_CREATED" && (await this.#loadDeviceFile())?.kind === "collaborator") {
          throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project tasks require the local authority desktop");
        }
        throw error;
      }
      const persisted = await this.#requirePersisted(device);
      await persisted.refresh();
      const projectRef = persisted.authority.projectRef;
      const localDeviceRef = device.device?.deviceRef;
      const grant = device.device?.grant;
      let members;
      try { members = persisted.read("listMembers", localDeviceRef); }
      catch {
        throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local project member is no longer active");
      }
      const member = members.find((candidate) => candidate.deviceRef === localDeviceRef);
      const grantMatches = member !== undefined
        && member.status === "active"
        && member.role === "owner"
        && device.projectRef === projectRef
        && verifyMembershipGrant(grant, persisted.authority.authorityPublicKey, this.now())
        && grant.projectRef === projectRef
        && grant.authorityEpoch === persisted.authority.authorityEpoch
        && grant.authorityKeyId === persisted.authority.authorityKeyId
        && grant.collaboratorRef === member.collaboratorRef
        && grant.deviceRef === member.deviceRef
        && grant.role === member.role
        && grant.deviceKeyId === member.deviceKeyId
        && grant.grantVersion === member.grantVersion;
      if (!grantMatches) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local owner membership grant is invalid, stale, or mismatched");

      const rawProjectKey = Buffer.from(device.encryptionKey, "base64url");
      if (rawProjectKey.length !== 32) {
        rawProjectKey.fill(0);
        throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local project encryption key is invalid");
      }
      let taskStoreKey;
      try {
        taskStoreKey = createHmac("sha256", rawProjectKey).update(PROJECT_TASK_KEY_DOMAIN).update("\0").update(projectRef).digest();
      } finally {
        rawProjectKey.fill(0);
      }
      if (this.taskContextClosed || this.taskContextEpoch !== contextEpoch) {
        taskStoreKey.fill(0);
        throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project task execution context is closed");
      }
      this.taskContextKeys.add(taskStoreKey);
      let disposed = false;
      const execution = Object.freeze(Object.create(null));
      const actor = Object.freeze({ projectRef, actorRef: member.collaboratorRef, kind: "human", role: "owner" });
      const authorityRevision = persisted.revision;
      const assertCurrentProject = (requestedProjectRef) => {
        if (disposed || this.taskContextClosed || this.taskContextEpoch !== contextEpoch || requestedProjectRef !== projectRef || this.persisted !== persisted || persisted.revision !== authorityRevision) {
          throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project task execution context is invalid, stale, or belongs to another project");
        }
      };
      const assertExecution = (candidate, requestedProjectRef) => {
        if (candidate !== execution) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project task execution context is invalid, stale, or belongs to another project");
        assertCurrentProject(requestedProjectRef);
      };
      const dispose = () => {
        if (disposed) return false;
        disposed = true;
        this.taskContextKeys.delete(taskStoreKey);
        taskStoreKey.fill(0);
        return true;
      };
      const context = { projectRef, databasePath: join(this.storages, PROJECT_TASK_DATABASE_FILE) };
      Object.defineProperties(context, {
        execution: { value: execution, enumerable: false },
        actorResolver: { value: (candidate, requestedProjectRef) => { assertExecution(candidate, requestedProjectRef); return actor; }, enumerable: false },
        keyProvider: { value: (requestedProjectRef) => { assertCurrentProject(requestedProjectRef); return Buffer.from(taskStoreKey); }, enumerable: false },
        dispose: { value: dispose, enumerable: false },
      });
      return Object.freeze(context);
    });
  }

  /**
   * Derive a Host-only Automation capability from the already-authoritative task
   * context. This intentionally runs outside #queue: localProjectTaskContext owns
   * the queued authority check, while the second resolver check closes the race
   * between reading the internal project key and publishing this capability.
   */
  async localProjectAutomationContext() {
    const taskContext = await this.localProjectTaskContext();
    let automationKey;
    try {
      taskContext.actorResolver(taskContext.execution, taskContext.projectRef);
      const rawProjectKey = Buffer.from(this.device?.encryptionKey ?? "", "base64url");
      if (rawProjectKey.length !== 32) {
        rawProjectKey.fill(0);
        throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "the local project encryption key is invalid");
      }
      try {
        automationKey = createHmac("sha256", rawProjectKey).update(PROJECT_AUTOMATION_KEY_DOMAIN).update("\0").update(taskContext.projectRef).digest();
      } finally {
        rawProjectKey.fill(0);
      }
      taskContext.actorResolver(taskContext.execution, taskContext.projectRef);
      if (this.taskContextClosed || this.entryClosing || this.entryClosed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project automation execution context is closed");
      this.taskContextKeys.add(automationKey);
      let disposed = false;
      const assertCurrent = (requestedProjectRef) => taskContext.actorResolver(taskContext.execution, requestedProjectRef);
      const dispose = () => {
        if (disposed) return false;
        disposed = true;
        this.taskContextKeys.delete(automationKey);
        automationKey.fill(0);
        taskContext.dispose();
        return true;
      };
      const context = { projectRef: taskContext.projectRef, filePath: join(this.storages, PROJECT_AUTOMATION_DATABASE_FILE) };
      Object.defineProperties(context, {
        execution: { value: taskContext.execution, enumerable: false },
        actorResolver: { value: (candidate, requestedProjectRef) => taskContext.actorResolver(candidate, requestedProjectRef), enumerable: false },
        keyProvider: { value: (requestedProjectRef) => { assertCurrent(requestedProjectRef); return Buffer.from(automationKey); }, enumerable: false },
        dispose: { value: dispose, enumerable: false },
      });
      return Object.freeze(context);
    } catch (error) {
      if (automationKey !== undefined) this.taskContextKeys.delete(automationKey);
      automationKey?.fill(0);
      taskContext.dispose();
      throw error;
    }
  }

  /** Return the Host-only authority DB or collaborator-local cache capability for M4 sync. */
  async localProjectBusinessSyncContext() {
    const kind = await this.#queue(async () => (await this.#requireDevice()).kind);
    if (kind !== "collaborator") {
      let taskContext;
      try { taskContext = await this.localProjectTaskContext(); }
      catch (error) {
        if (error?.code === "PROJECT_ENTRY_CLOSED") throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context closed before publication");
        throw error;
      }
      let syncKey;
      try {
        taskContext.actorResolver(taskContext.execution, taskContext.projectRef);
        const rawProjectKey = Buffer.from(this.device?.encryptionKey ?? "", "base64url");
        if (rawProjectKey.length !== 32) {
          rawProjectKey.fill(0);
          throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "the local project encryption key is invalid");
        }
        try {
          syncKey = createHmac("sha256", rawProjectKey).update(PROJECT_BUSINESS_SYNC_KEY_DOMAIN).update("\0").update(taskContext.projectRef).digest();
        } finally {
          rawProjectKey.fill(0);
        }
        taskContext.actorResolver(taskContext.execution, taskContext.projectRef);
        if (this.taskContextClosed || this.entryClosing || this.entryClosed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context is closed");
        const persisted = this.persisted;
        const authorityEpoch = persisted.authority.authorityEpoch;
        const localDeviceRef = this.device.device.deviceRef;
        const assertCurrent = (requestedProjectRef) => taskContext.actorResolver(taskContext.execution, requestedProjectRef);
        const peerDeviceRefs = async () => {
          assertCurrent(taskContext.projectRef);
          await persisted.refresh();
          assertCurrent(taskContext.projectRef);
          let members;
          try { members = persisted.read("listMembers", localDeviceRef); }
          catch { throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peers are not currently available"); }
          return Object.freeze([...new Set(members
            .filter((member) => member.status === "active" && member.deviceRef !== localDeviceRef)
            .map((member) => member.deviceRef))]
            .sort());
        };
        const peerResolver = async (opened) => {
          const metadata = strictOpenedPeerMetadata(opened);
          assertCurrent(taskContext.projectRef);
          await persisted.refresh();
          assertCurrent(taskContext.projectRef);
          if (metadata.authorityEpoch !== persisted.authority.authorityEpoch) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer is not currently authorized");
          let members;
          try { members = persisted.read("listMembers", localDeviceRef); }
          catch { throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer is not currently authorized"); }
          const member = members.find((candidate) => candidate.deviceRef === metadata.senderDeviceRef && candidate.status === "active");
          if (member === undefined) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer is not currently authorized");
          return trustedSyncPeer(member);
        };
        return this.#publishBusinessSyncContext({
          projectRef: taskContext.projectRef,
          mode: "authority",
          authorityEpoch,
          localDeviceRef,
          syncKey,
          execution: taskContext.execution,
          assertCurrent,
          peerResolver,
          peerDeviceRefs,
          disposeUnderlying: () => taskContext.dispose(),
        });
      } catch (error) {
        if (syncKey !== undefined) this.taskContextKeys.delete(syncKey);
        syncKey?.fill(0);
        taskContext.dispose();
        throw error;
      }
    }

    return this.#queue(async () => {
      const contextEpoch = this.taskContextEpoch;
      const device = await this.#requireDevice();
      const identity = validatedCollaboratorIdentity(device, this.now);
      if (identity === undefined) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local collaborator grant is invalid, stale, or mismatched");
      let syncKey;
      let generatedKey;
      let migrated = false;
      try {
        if (device.syncCacheKey === undefined) {
          generatedKey = randomBytes(32);
          device.syncCacheKey = generatedKey.toString("base64url");
          try {
            await atomicWriteJson(this.deviceFile, device);
            migrated = true;
          } catch (error) {
            delete device.syncCacheKey;
            throw error;
          } finally {
            generatedKey.fill(0);
            generatedKey = undefined;
          }
        }
        syncKey = exactBase64urlKey(device.syncCacheKey);
        if (syncKey === undefined) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local collaborator sync cache key is invalid");
        const projectRef = device.projectRef;
        const authorityEpoch = device.authority.authorityEpoch;
        const localDeviceRef = device.device.deviceRef;
        const identityStamp = canonicalJson({ authority: device.authority, grant: device.device.grant, deviceRef: localDeviceRef, role: device.device.role, syncCacheKey: device.syncCacheKey, peers: device.peers });
        const execution = Object.freeze(Object.create(null));
        const assertCurrent = (requestedProjectRef) => {
          if (this.taskContextClosed || this.taskContextEpoch !== contextEpoch || this.entryClosing || this.entryClosed || requestedProjectRef !== projectRef || this.device !== device) {
            throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context is invalid, stale, or belongs to another project");
          }
        };
        const peerDeviceRefs = async () => {
          assertCurrent(projectRef);
          const fresh = await readJson(this.deviceFile, undefined);
          const freshIdentity = validatedCollaboratorIdentity(fresh, this.now);
          if (freshIdentity === undefined) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peers are not currently available");
          const freshStamp = canonicalJson({ authority: fresh.authority, grant: fresh.device.grant, deviceRef: fresh.device.deviceRef, role: fresh.device.role, syncCacheKey: fresh.syncCacheKey, peers: fresh.peers });
          if (freshStamp !== identityStamp) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context is invalid or stale");
          return Object.freeze([...new Set(this.#peerRecords(fresh)
            .filter((peer) => peer.role === "owner" && peer.deviceRef !== localDeviceRef)
            .map((peer) => peer.deviceRef))]
            .sort());
        };
        const peerResolver = async (opened) => {
          const metadata = strictOpenedPeerMetadata(opened);
          assertCurrent(projectRef);
          const fresh = await readJson(this.deviceFile, undefined);
          const freshIdentity = validatedCollaboratorIdentity(fresh, this.now);
          if (freshIdentity === undefined) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer is not currently authorized");
          const freshStamp = canonicalJson({ authority: fresh.authority, grant: fresh.device.grant, deviceRef: fresh.device.deviceRef, role: fresh.device.role, syncCacheKey: fresh.syncCacheKey, peers: fresh.peers });
          if (freshStamp !== identityStamp) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context is invalid or stale");
          const authorityPeer = this.#peerRecords(fresh).find((peer) => peer.deviceRef === metadata.senderDeviceRef && peer.role === "owner" && peer.deviceRef !== localDeviceRef);
          if (metadata.authorityEpoch !== fresh.authority.authorityEpoch || authorityPeer === undefined) {
            throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project sync peer is not currently authorized");
          }
          return trustedSyncPeer({
            deviceRef: authorityPeer.deviceRef,
            collaboratorRef: typeof authorityPeer.collaboratorRef === "string" ? authorityPeer.collaboratorRef : fresh.authority.authorityKeyId,
            role: "owner",
            permissions: ROLE_PERMISSIONS.owner,
          });
        };
        if (this.taskContextClosed || this.taskContextEpoch !== contextEpoch || this.entryClosing || this.entryClosed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context is closed");
        return this.#publishBusinessSyncContext({ projectRef, mode: "collaborator", authorityEpoch, localDeviceRef, syncKey, execution, assertCurrent, peerResolver, peerDeviceRefs });
      } catch (error) {
        if (!migrated && generatedKey !== undefined) generatedKey.fill(0);
        if (syncKey !== undefined) this.taskContextKeys.delete(syncKey);
        syncKey?.fill(0);
        throw error;
      }
    });
  }

  #publishBusinessSyncContext({ projectRef, mode, authorityEpoch, localDeviceRef, syncKey, execution, assertCurrent, peerResolver, peerDeviceRefs, disposeUnderlying }) {
    this.taskContextKeys.add(syncKey);
    let disposed = false;
    const requireCurrent = (requestedProjectRef) => {
      if (disposed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project business sync context is disposed");
      assertCurrent(requestedProjectRef);
    };
    const dispose = () => {
      if (disposed) return false;
      disposed = true;
      this.taskContextKeys.delete(syncKey);
      syncKey.fill(0);
      disposeUnderlying?.();
      return true;
    };
    const context = { projectRef, mode };
    Object.defineProperties(context, {
      authorityEpoch: { value: authorityEpoch, enumerable: false },
      localDeviceRef: { value: localDeviceRef, enumerable: false },
      filePath: { value: join(this.storages, PROJECT_BUSINESS_SYNC_DATABASE_FILE), enumerable: false },
      execution: { value: execution, enumerable: false },
      keyProvider: { value: (requestedProjectRef) => { requireCurrent(requestedProjectRef); return Buffer.from(syncKey); }, enumerable: false },
      peerResolver: { value: async (opened) => {
        requireCurrent(projectRef);
        const peer = await peerResolver(opened);
        requireCurrent(projectRef);
        return peer;
      }, enumerable: false },
      peerDeviceRefs: { value: async () => {
        requireCurrent(projectRef);
        const refs = await peerDeviceRefs();
        requireCurrent(projectRef);
        return refs;
      }, enumerable: false },
      dispose: { value: dispose, enumerable: false },
    });
    return Object.freeze(context);
  }

  /**
   * Return the Host-only M5 foundations capability. Every key and path remains
   * non-enumerable; the only JSON-visible fact is the already-public projectRef.
   */
  async localProjectFoundationsContext() {
    const taskContext = await this.localProjectTaskContext();
    const keys = new Map();
    try {
      taskContext.actorResolver(taskContext.execution, taskContext.projectRef);
      const rawProjectKey = Buffer.from(this.device?.encryptionKey ?? "", "base64url");
      if (rawProjectKey.length !== 32) {
        rawProjectKey.fill(0);
        throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "the local project encryption key is invalid");
      }
      try {
        for (const domain of PROJECT_FOUNDATION_DOMAIN_SET) {
          const key = createHmac("sha256", rawProjectKey).update(domain).update("\0").update(taskContext.projectRef).digest();
          keys.set(domain, key);
        }
      } finally {
        rawProjectKey.fill(0);
      }
      taskContext.actorResolver(taskContext.execution, taskContext.projectRef);
      if (this.taskContextClosed || this.entryClosing || this.entryClosed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project foundations execution context is closed");
      for (const key of keys.values()) this.taskContextKeys.add(key);

      let disposed = false;
      const assertCurrent = (requestedProjectRef) => {
        taskContext.actorResolver(taskContext.execution, requestedProjectRef);
        if (disposed || this.taskContextClosed || this.entryClosing || this.entryClosed) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project foundations execution context is invalid or stale");
      };
      const keyProvider = (domain, requestedProjectRef) => {
        assertCurrent(requestedProjectRef);
        if (!PROJECT_FOUNDATION_DOMAIN_SET.has(domain)) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project foundation key domain is invalid");
        return Buffer.from(keys.get(domain));
      };
      const repositoryRefFor = (realGitRoot) => {
        assertCurrent(taskContext.projectRef);
        const root = typeof realGitRoot === "string" ? realGitRoot : "";
        if (root === "" || root.trim() !== root || !isAbsolute(root) || normalize(root) !== root) throw new TypeError("realGitRoot must be an exact normalized absolute path");
        const digest = createHmac("sha256", keys.get(PROJECT_FOUNDATION_KEY_DOMAINS.workspace))
          .update(root).update("\0").update(taskContext.projectRef).digest();
        try { return `repository_${digest.toString("base64url")}`; }
        finally { digest.fill(0); }
      };
      const dispose = () => {
        if (disposed) return false;
        disposed = true;
        for (const key of keys.values()) {
          this.taskContextKeys.delete(key);
          key.fill(0);
        }
        keys.clear();
        taskContext.dispose();
        return true;
      };

      const foundationsRoot = join(this.storages, PROJECT_FOUNDATIONS_DIRECTORY);
      const context = { projectRef: taskContext.projectRef };
      Object.defineProperties(context, {
        foundationsRoot: { value: foundationsRoot, enumerable: false },
        workspaceStatePath: { value: join(foundationsRoot, "workspace-authority.enc.json"), enumerable: false },
        authorityRoot: { value: join(foundationsRoot, "git-authority"), enumerable: false },
        worktreeRoot: { value: join(foundationsRoot, "worktrees"), enumerable: false },
        casObjectRoot: { value: join(foundationsRoot, "cas", "objects"), enumerable: false },
        casStagingRoot: { value: join(foundationsRoot, "cas", "staging"), enumerable: false },
        qualityStatePath: { value: join(foundationsRoot, "quality-orchestrator.enc.json"), enumerable: false },
        defectStatePath: { value: join(foundationsRoot, "defect-lifecycle.enc.json"), enumerable: false },
        outboxStatePath: { value: join(foundationsRoot, "defect-outbox.enc.json"), enumerable: false },
        execution: { value: taskContext.execution, enumerable: false },
        actorResolver: { value: (candidate, requestedProjectRef) => taskContext.actorResolver(candidate, requestedProjectRef), enumerable: false },
        keyProvider: { value: keyProvider, enumerable: false },
        repositoryRefFor: { value: repositoryRefFor, enumerable: false },
        dispose: { value: dispose, enumerable: false },
      });
      return Object.freeze(context);
    } catch (error) {
      for (const key of keys.values()) {
        this.taskContextKeys.delete(key);
        key.fill(0);
      }
      keys.clear();
      taskContext.dispose();
      throw error;
    }
  }

  /** Create the project authority and register the owner device. Idempotent when a project exists. */
  async createProject({ projectName, displayName } = {}) {
    return this.#queue(async () => {
      const name = nonEmptyString(projectName, "projectName", 200);
      const ownerName = nonEmptyString(displayName, "displayName", 120);
      if (await this.#loadDeviceFile() !== undefined) {
        return { existing: true, status: await this.#buildStatus() };
      }
      const secret = randomBytes(32).toString("base64url");
      const encryptionKey = randomBytes(32);
      const authorityKeys = generateKeyPairSync("ed25519");
      const deviceKeys = generateProjectTransportKeys();
      const authority = new ProjectCollaborationAuthority({
        projectIdentity: name,
        secret,
        authorityPrivateKey: authorityKeys.privateKey,
        now: this.now,
      });
      const store = new EncryptedProjectStateStore(this.stateFile, { projectRef: authority.projectRef, encryptionKey });
      const persisted = await PersistedProjectAuthority.create({ store, authority });
      const userHandle = randomRef("user", 24);
      const deviceHandle = randomRef("device", 24);
      const { result } = await persisted.mutate("registerDevice", {
        userHandle,
        deviceHandle,
        displayName: ownerName,
        role: "owner",
        publicKey: deviceKeys.signing.publicKey,
      });
      const device = {
        version: DEVICE_VERSION,
        kind: "authority",
        projectRef: authority.projectRef,
        secret,
        encryptionKey: encryptionKey.toString("base64url"),
        device: {
          deviceRef: result.member.deviceRef,
          userHandle,
          deviceHandle,
          displayName: ownerName,
          signingPrivateKey: exportPrivateKey(deviceKeys.signing.privateKey),
          encryptionPrivateKey: exportPrivateKey(deviceKeys.encryption.privateKey),
          grant: result.grant,
        },
        peers: [],
      };
      await atomicWriteJson(this.deviceFile, device);
      this.device = device;
      this.persisted = persisted;
      return { existing: false, status: await this.#buildStatus() };
    });
  }

  /** Issue an HMAC-signed remote invite code bound to the project, room, and authority key. */
  async createInvite({ displayName, role = "contributor", expiresAtMs } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireAuthorityDevice();
      const name = nonEmptyString(displayName, "displayName", 120);
      const normalizedRole = optionalRole(role);
      const issuedAt = this.now();
      const expiresAt = expiresAtMs === undefined ? issuedAt + INVITE_MAX_AGE_MS : safeTime(expiresAtMs, "expiresAtMs", issuedAt + INVITE_MAX_AGE_MS);
      if (expiresAt <= issuedAt) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite expiry must be in the future");
      const roomRef = randomRoomRef();
      const payload = {
        version: 1,
        projectRef: device.projectRef,
        authorityKeyId: await this.#authorityKeyId(device),
        roomRef,
        role: normalizedRole,
        displayName: name,
        issuedAt,
        expiresAt,
      };
      const signature = createHmac("sha256", device.secret).update(canonicalJson(payload)).digest("base64url");
      const inviteCode = `invite_${Buffer.from(canonicalJson(payload)).toString("base64url")}.${signature}`;
      const invites = await this.#loadInvites();
      const pruned = invites.invites.filter((invite) => Date.parse(invite.expiresAt) > this.now()).slice(-(MAX_PERSISTED_INVITES - 1));
      pruned.push({
        inviteRef: inviteFingerprint(inviteCode),
        roomRef,
        projectRef: payload.projectRef,
        authorityKeyId: payload.authorityKeyId,
        role: normalizedRole,
        displayName: name,
        createdAt: nowIso(),
        expiresAt: new Date(expiresAt).toISOString(),
      });
      invites.invites = pruned;
      await atomicWriteJson(this.invitesFile, invites);
      // The latest invite's room is the host's active relay room for the authority role.
      const relay = await this.#loadRelayFile();
      relay.roomRef = roomRef;
      await atomicWriteJson(this.relayFile, relay);
      return { inviteCode, roomRef, projectRef: payload.projectRef, authorityKeyId: payload.authorityKeyId, role: normalizedRole, displayName: name, expiresAt: new Date(expiresAt).toISOString() };
    });
  }

  /** Validate an invite code and register the collaborator device, returning its signed grant. */
  async redeemInvite({ inviteCode, displayName, publicKey } = {}) {
    return this.#queue(() => this.#redeemInvite({ inviteCode, displayName, publicKey }));
  }

  /** Prepare an offline-safe join request on the invited desktop without creating a fake local authority. */
  async createJoinRequest({ inviteCode, displayName } = {}) {
    return this.#queue(async () => {
      if (await this.#loadDeviceFile() !== undefined) throw entryError("PROJECT_ENTRY_ALREADY_EXISTS", "this desktop already belongs to a project");
      const parsed = this.#parseInviteCode(inviteCode);
      if (!Number.isSafeInteger(parsed.payload.expiresAt) || parsed.payload.expiresAt <= this.now()) throw entryError("PROJECT_ENTRY_INVITE_EXPIRED", "invite code has expired");
      const name = nonEmptyString(displayName || parsed.payload.displayName, "displayName", 120);
      const keys = generateProjectTransportKeys();
      const pending = {
        version: 1,
        projectRef: nonEmptyString(parsed.payload.projectRef, "projectRef", 128),
        authorityKeyId: nonEmptyString(parsed.payload.authorityKeyId, "authorityKeyId", 128),
        roomRef: nonEmptyString(parsed.payload.roomRef, "roomRef", 128),
        displayName: name,
        signingPrivateKey: exportPrivateKey(keys.signing.privateKey),
        encryptionPrivateKey: exportPrivateKey(keys.encryption.privateKey),
        signingPublicKey: exportPublicKey(keys.signing.publicKey),
        encryptionPublicKey: exportPublicKey(keys.encryption.publicKey),
        createdAt: this.now(),
        expiresAt: parsed.payload.expiresAt,
      };
      await atomicWriteJson(this.pendingJoinFile, pending);
      const joinRequest = encodeExchange(JOIN_REQUEST_PREFIX, {
        version: 1,
        inviteCode: parsed.code,
        displayName: name,
        signingPublicKey: pending.signingPublicKey,
        encryptionPublicKey: pending.encryptionPublicKey,
      });
      return { joinRequest, projectRef: pending.projectRef, expiresAt: new Date(pending.expiresAt).toISOString() };
    });
  }

  /** Approve a join request on the authority desktop and return a response safe to carry out-of-band. */
  async approveJoinRequest({ joinRequest } = {}) {
    return this.#queue(async () => {
      const request = decodeExchange(joinRequest, JOIN_REQUEST_PREFIX, "joinRequest");
      if (request.version !== 1) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join request version is unsupported");
      const signingPublicKey = importPublicKey(request.signingPublicKey, "signingPublicKey", "ed25519");
      const encryptionPublicKey = importPublicKey(request.encryptionPublicKey, "encryptionPublicKey", "x25519");
      const redeemed = await this.#redeemInvite({ inviteCode: request.inviteCode, displayName: request.displayName, publicKey: signingPublicKey });
      const device = await this.#requireAuthorityDevice();
      const persisted = await this.#requirePersisted(device);
      const peers = Array.isArray(device.peers) ? device.peers.filter((peer) => peer?.deviceRef !== redeemed.member.deviceRef) : [];
      peers.push({
        deviceRef: redeemed.member.deviceRef,
        displayName: redeemed.member.displayName,
        signingPublicKey: exportPublicKey(signingPublicKey),
        encryptionPublicKey: exportPublicKey(encryptionPublicKey),
      });
      device.peers = peers;
      await atomicWriteJson(this.deviceFile, device);
      const relay = await this.#loadRelayFile();
      const lanAuthority = await this.#ensureLanAuthorityCredentials();
      const lanClient = await createProjectLanClientCredentials(lanAuthority, { deviceRef: redeemed.member.deviceRef, now: this.now() });
      const lanEndpoint = this.lanTransport?.server !== undefined
        ? { host: this.lanTransport.host, port: this.lanTransport.boundPort }
        : lanAuthority.lastEndpoint;
      const authorityDevice = {
        deviceRef: device.device.deviceRef,
        collaboratorRef: device.device.grant.collaboratorRef,
        displayName: device.device.displayName,
        role: device.device.grant.role,
        permissions: [...device.device.grant.permissions],
        signingPublicKey: exportPublicKey(importPrivateKey(device.device.signingPrivateKey, "signingPrivateKey")),
        encryptionPublicKey: exportPublicKey(importPrivateKey(device.device.encryptionPrivateKey, "encryptionPrivateKey")),
      };
      const responseMeta = {
        version: 1,
        projectRef: device.projectRef,
        authorityEpoch: persisted.authority.authorityEpoch,
        authorityKeyId: persisted.authority.authorityKeyId,
        authorityPublicKey: exportPublicKey(persisted.authority.authorityPublicKey),
        member: redeemed.member,
        grant: redeemed.grant,
        authorityDevice,
      };
      const pairingCipher = sealPairingMaterial(
        importPrivateKey(device.device.encryptionPrivateKey, "encryptionPrivateKey"),
        encryptionPublicKey,
        responseMeta,
        {
          roomRef: relay.roomRef,
          relayUrl: relay.enabled ? relay.relayUrl : "",
          lan: {
            ...lanClient,
            serverCertificateRef: serverCertificateRef(lanAuthority.serverCert),
            endpoints: lanEndpoint && Number.isSafeInteger(lanEndpoint.port) && lanEndpoint.port > 0 ? [lanEndpoint] : [],
          },
        },
      );
      const responseBody = { ...responseMeta, pairingCipher };
      const response = {
        ...responseBody,
        approvalSignature: cryptoSign(null, Buffer.from(canonicalJson(responseBody)), persisted.authority.authorityPrivateKey).toString("base64url"),
      };
      return { joinResponse: encodeExchange(JOIN_RESPONSE_PREFIX, response), member: redeemed.member };
    });
  }

  /** Finish pairing on the invited desktop after the authority has signed its member grant. */
  async completeJoinRequest({ joinResponse } = {}) {
    return this.#queue(async () => {
      if (await this.#loadDeviceFile() !== undefined) throw entryError("PROJECT_ENTRY_ALREADY_EXISTS", "this desktop already belongs to a project");
      const pending = await this.#loadPendingJoin();
      if (pending === undefined) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "no pending join request exists on this desktop");
      if (pending.expiresAt <= this.now()) throw entryError("PROJECT_ENTRY_INVITE_EXPIRED", "pending join request has expired");
      const response = decodeExchange(joinResponse, JOIN_RESPONSE_PREFIX, "joinResponse");
      if (response.version !== 1 || response.projectRef !== pending.projectRef || !isRecord(response.member) || !isRecord(response.grant) || !isRecord(response.authorityDevice) || !isRecord(response.pairingCipher)) {
        throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join response does not match the pending request");
      }
      const authorityPublicKey = importPublicKey(response.authorityPublicKey, "authorityPublicKey", "ed25519");
      const responseAuthorityKeyId = `key_${createHash("sha256").update(authorityPublicKey.export({ type: "spki", format: "der" })).digest("base64url")}`;
      const { approvalSignature, ...responseBody } = response;
      if (response.authorityKeyId !== pending.authorityKeyId || responseAuthorityKeyId !== pending.authorityKeyId || typeof approvalSignature !== "string" || approvalSignature === ""
        || !cryptoVerify(null, Buffer.from(canonicalJson(responseBody)), authorityPublicKey, Buffer.from(approvalSignature, "base64url"))) {
        throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join response authority signature is invalid");
      }
      if (!verifyMembershipGrant(response.grant, authorityPublicKey, this.now())) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join response grant signature or lifetime is invalid");
      const pendingSigningKey = importPrivateKey(pending.signingPrivateKey, "signingPrivateKey");
      const pendingSigningKeyId = `key_${createHash("sha256").update(createPublicKey(pendingSigningKey).export({ type: "spki", format: "der" })).digest("base64url")}`;
      if (response.grant.projectRef !== pending.projectRef || response.grant.deviceRef !== response.member.deviceRef || response.grant.deviceKeyId !== pendingSigningKeyId || response.authorityKeyId !== response.grant.authorityKeyId) {
        throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join response is not bound to this desktop's pending keys");
      }
      const authoritySigningKey = importPublicKey(response.authorityDevice.signingPublicKey, "authority signingPublicKey", "ed25519");
      const authorityEncryptionKey = importPublicKey(response.authorityDevice.encryptionPublicKey, "authority encryptionPublicKey", "x25519");
      const { approvalSignature: _approvalSignature, pairingCipher, ...pairingAad } = response;
      let pairing;
      try {
        pairing = openPairingMaterial(importPrivateKey(pending.encryptionPrivateKey, "encryptionPrivateKey"), authorityEncryptionKey, pairingAad, pairingCipher);
      } catch {
        throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join response encrypted pairing material is invalid");
      }
      const syncCacheKeyBuffer = randomBytes(32);
      let syncCacheKey;
      try { syncCacheKey = syncCacheKeyBuffer.toString("base64url"); }
      finally { syncCacheKeyBuffer.fill(0); }
      const device = {
        version: DEVICE_VERSION,
        kind: "collaborator",
        projectRef: pending.projectRef,
        syncCacheKey,
        authority: {
          authorityEpoch: response.authorityEpoch,
          authorityKeyId: response.authorityKeyId,
          authorityPublicKey: exportPublicKey(authorityPublicKey),
        },
        device: {
          deviceRef: response.member.deviceRef,
          displayName: response.member.displayName,
          role: response.member.role,
          signingPrivateKey: pending.signingPrivateKey,
          encryptionPrivateKey: pending.encryptionPrivateKey,
          grant: response.grant,
        },
        peers: [{
          deviceRef: response.authorityDevice.deviceRef,
          collaboratorRef: typeof response.authorityDevice.collaboratorRef === "string" ? response.authorityDevice.collaboratorRef : response.authorityKeyId,
          displayName: response.authorityDevice.displayName,
          role: "owner",
          permissions: [...ROLE_PERMISSIONS.owner],
          signingPublicKey: exportPublicKey(authoritySigningKey),
          encryptionPublicKey: exportPublicKey(authorityEncryptionKey),
        }],
        lan: isRecord(pairing.lan) && typeof pairing.lan.cert === "string" && typeof pairing.lan.key === "string" && typeof pairing.lan.ca === "string"
          ? {
              version: pairing.lan.version,
              cert: pairing.lan.cert,
              key: pairing.lan.key,
              ca: pairing.lan.ca,
              serverCertificateRef: pairing.lan.serverCertificateRef,
              expiresAt: pairing.lan.expiresAt,
              endpoints: Array.isArray(pairing.lan.endpoints) ? pairing.lan.endpoints.filter((endpoint) => isRecord(endpoint) && typeof endpoint.host === "string" && Number.isSafeInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65_535) : [],
            }
          : undefined,
      };
      const relayUrl = typeof pairing.relayUrl === "string" && pairing.relayUrl !== "" ? safeRelayUrl(pairing.relayUrl) : "";
      const roomRef = typeof pairing.roomRef === "string" && pairing.roomRef !== "" ? pairing.roomRef : pending.roomRef;
      if (!/^[A-Za-z0-9_-]{43}$/u.test(roomRef) || (pairing.roomRef !== undefined && pairing.roomRef !== roomRef)) {
        throw entryError("PROJECT_ENTRY_INVITE_INVALID", "join response relay room reference is invalid");
      }
      // Keep the approved room even when the owner has not configured a relay yet.
      // The collaborator can then enter the same credential-free WSS URL later,
      // without requiring a second invitation or another exchange of device keys.
      await atomicWriteJson(this.relayFile, { version: RELAY_VERSION, enabled: relayUrl !== "", relayUrl, roomRef });
      await atomicWriteJson(this.deviceFile, device);
      await rm(this.pendingJoinFile, { force: true });
      this.device = device;
      return { projectRef: device.projectRef, member: response.member, status: await this.#buildStatus() };
    });
  }

  /** Register a Host-only synchronous delivery boundary; returned promises are deliberately ignored. */
  subscribeProjectBusinessDelivery(listener) {
    if (this.entryClosing || this.entryClosed) throw entryError("PROJECT_ENTRY_CLOSED", "project entry service is closed");
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.businessDeliveryListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      this.businessDeliveryListeners.delete(listener);
      return true;
    };
  }

  /** Seal and enqueue one business message over an already-authenticated paired transport. */
  async sendProjectBusinessMessage(input = {}) {
    return this.#queue(async () => {
      if (!isRecord(input) || Reflect.ownKeys(input).length !== 2 || !Object.hasOwn(input, "targetDeviceRef") || !Object.hasOwn(input, "message")) throw new TypeError("business send accepts only targetDeviceRef and message");
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (descriptors.targetDeviceRef?.get !== undefined || descriptors.targetDeviceRef?.set !== undefined || descriptors.message?.get !== undefined || descriptors.message?.set !== undefined) throw new TypeError("business send accessors are forbidden");
      const targetDeviceRef = nonEmptyString(descriptors.targetDeviceRef.value, "targetDeviceRef", 128);
      if (!/^device_[A-Za-z0-9_-]{20,64}$/u.test(targetDeviceRef)) throw new TypeError("targetDeviceRef must be opaque");
      const message = descriptorSafeFrozenCopy(descriptors.message.value);
      assertNoTransportClaims(message);
      const currentDevice = await this.#requireDevice();
      const freshDevice = await readJson(this.deviceFile, undefined);
      if (!isRecord(freshDevice)
        || freshDevice.projectRef !== currentDevice.projectRef
        || freshDevice.kind !== currentDevice.kind
        || freshDevice.device?.deviceRef !== currentDevice.device?.deviceRef
        || canonicalJson(freshDevice) !== canonicalJson(currentDevice)) {
        throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project entry identity changed before send");
      }
      let authorityEpoch;
      if (freshDevice.kind === "collaborator") {
        const currentIdentity = validatedCollaboratorIdentity(currentDevice, this.now), freshIdentity = validatedCollaboratorIdentity(freshDevice, this.now);
        if (currentIdentity === undefined || freshIdentity === undefined) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local collaborator grant is invalid, stale, or mismatched");
        const authorities = this.#peerRecords(freshDevice).filter((peer) => peer.role === "owner" && peer.deviceRef !== freshDevice.device.deviceRef);
        if (authorities.length !== 1 || authorities[0].deviceRef !== targetDeviceRef) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "target project authority is not currently authorized");
        authorityEpoch = freshIdentity.grant.authorityEpoch;
      } else {
        const persisted = await this.#requirePersisted(freshDevice);
        await persisted.refresh();
        if (persisted.authority.projectRef !== freshDevice.projectRef) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "project authority changed before send");
        let members;
        try { members = persisted.read("listMembers", freshDevice.device.deviceRef); }
        catch { throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "project membership is not currently authorized"); }
        const localMembers = members.filter((member) => member.deviceRef === freshDevice.device.deviceRef && member.status === "active");
        const localMember = localMembers[0];
        const grant = freshDevice.device.grant;
        const localGrantMatches = localMembers.length === 1
          && localMember.role === "owner"
          && hasCanonicalSignature(grant?.signature)
          && verifyMembershipGrant(grant, persisted.authority.authorityPublicKey, this.now())
          && grant.projectRef === persisted.authority.projectRef
          && grant.authorityEpoch === persisted.authority.authorityEpoch
          && grant.authorityKeyId === persisted.authority.authorityKeyId
          && grant.collaboratorRef === localMember.collaboratorRef
          && grant.deviceRef === localMember.deviceRef
          && grant.role === localMember.role
          && grant.deviceKeyId === localMember.deviceKeyId
          && grant.grantVersion === localMember.grantVersion;
        if (!localGrantMatches) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "the local authority membership is invalid, stale, or revoked");
        const targets = members.filter((member) => member.deviceRef === targetDeviceRef && member.status === "active");
        const target = targets[0];
        const peers = this.#peerRecords(freshDevice).filter((peer) => peer.deviceRef === targetDeviceRef);
        let peerKeyId;
        try {
          if (peers.length === 1) peerKeyId = `key_${createHash("sha256").update(importPublicKey(peers[0].signingPublicKey, "peer signingPublicKey", "ed25519").export({ type: "spki", format: "der" })).digest("base64url")}`;
        } catch {}
        if (targets.length !== 1 || peers.length !== 1 || peerKeyId !== target.deviceKeyId) throw entryError("PROJECT_ENTRY_TASK_CONTEXT_FORBIDDEN", "target project device is not currently authorized");
        authorityEpoch = persisted.authority.authorityEpoch;
      }
      let transport;
      let kind;
      if (freshDevice.kind === "collaborator" && this.lanClient?.canSend(targetDeviceRef)) { transport = this.lanClient; kind = "lan_mtls"; }
      else if (freshDevice.kind !== "collaborator" && this.lanTransport?.canSend(targetDeviceRef)) { transport = this.lanTransport; kind = "lan_mtls"; }
      else if (this.relayTransport?.canSend(targetDeviceRef)) { transport = this.relayTransport; kind = "remote_wss"; }
      else throw entryError("PROJECT_ENTRY_TASK_CONTEXT_INVALID", "no authenticated project transport is available for the target");
      const packet = this.#sealForPeer(freshDevice, targetDeviceRef, kind, message, authorityEpoch);
      const queued = transport.send(packet);
      return Object.freeze({ queued: queued.queued === true, packetRef: queued.packetRef, targetDeviceRef, transport: kind });
    });
  }

  /** Persist the relay URL used by the real WSS relay transport. */
  async setRelay({ relayUrl, roomRef } = {}) {
    return this.#queue(async () => {
      const url = relayUrl === undefined || relayUrl === null || String(relayUrl).trim() === "" ? "" : safeRelayUrl(String(relayUrl));
      const previous = await this.#loadRelayFile();
      const room = roomRef === undefined || roomRef === null || String(roomRef).trim() === "" ? previous.roomRef : nonEmptyString(roomRef, "roomRef", 128);
      if (room !== "" && !/^[A-Za-z0-9_-]{43}$/u.test(room)) throw new TypeError("roomRef must be a 32-byte opaque reference");
      const relay = { version: RELAY_VERSION, enabled: url !== "", relayUrl: url, roomRef: room };
      await atomicWriteJson(this.relayFile, relay);
      return { enabled: relay.enabled, relayUrl: relay.relayUrl, roomRef: relay.roomRef };
    });
  }

  /** Connect the real WSS relay transport when configured. Never pretends a connection without a configured relay. */
  async connectRemote({ role } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireDevice();
      const relay = await this.#loadRelayFile();
      if (relay.enabled !== true || relay.relayUrl === "") throw entryError("PROJECT_ENTRY_RELAY_NOT_CONFIGURED", "relay is not configured; set a wss relay URL first");
      const roomRef = typeof relay.roomRef === "string" ? relay.roomRef : "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(roomRef)) throw entryError("PROJECT_ENTRY_RELAY_ROOM_MISSING", "relay room reference is missing or invalid; create an invite first");
      const defaultRole = device.kind === "collaborator" ? "collaborator" : "authority";
      const normalizedRole = nonEmptyString(role || defaultRole, "role", 32);
      if (normalizedRole !== "authority" && normalizedRole !== "collaborator") throw new TypeError("role must be authority or collaborator");
      if (normalizedRole !== defaultRole) throw new TypeError(`this desktop must connect with the ${defaultRole} relay role`);
      const WebSocketImpl = this.WebSocketImpl ?? (this.resolveWebSocket ? await this.resolveWebSocket() : undefined);
      if (typeof WebSocketImpl !== "function") throw entryError("PROJECT_ENTRY_RELAY_WEBSOCKET_UNAVAILABLE", "no WebSocket implementation is available in this runtime");
      await this.#stopRelayTransport();
      const channel = await this.#createLocalSecureChannel(device);
      let transport;
      transport = new ProjectWssRelayTransport({
        enabled: true,
        projectRef: device.projectRef,
        role: normalizedRole,
        roomRef,
        relayUrl: relay.relayUrl,
        WebSocketImpl,
        resolveChannel: (targetDeviceRef) => targetDeviceRef === device.device.deviceRef ? channel : undefined,
        onDelivery: (opened) => {
          this.#handleTransportDelivery(opened);
          if (normalizedRole === "authority" && opened.payload?.type === "presence") {
            const response = this.#sealForPeer(device, opened.senderDeviceRef, "remote_wss", { type: "presence.ack", receivedAt: this.now() });
            transport.send(response);
          }
        },
      });
      await transport.start();
      this.relayTransport = transport;
      if (normalizedRole === "collaborator") {
        const authorityPeer = this.#peerRecords(device)[0];
        if (authorityPeer === undefined) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "authority device keys are missing from this pairing");
        transport.send(this.#sealForPeer(device, authorityPeer.deviceRef, "remote_wss", { type: "presence", displayName: device.device.displayName }));
      }
      const projection = transport.toJSON();
      return {
        connected: true,
        channelReady: true,
        reason: "relay connection and the paired per-device E2EE channel are ready",
        ...projection,
      };
    });
  }

  async disconnectRemote() {
    return this.#queue(async () => {
      await this.#stopRelayTransport();
      return { connected: false };
    });
  }

  /** Report the real LAN transport state. Auto-discovery is honestly marked as not implemented. */
  lanStatus() {
    return this.#lanProjection();
  }

  /** Start the LAN mTLS listener. Project-scoped certificates are generated automatically. */
  async startLan({ host, port, cert, key, ca } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireAuthorityDevice();
      await this.#stopLanTransport();
      const automatic = cert === undefined && key === undefined && ca === undefined;
      let credentials = automatic ? await this.#ensureLanAuthorityCredentials() : undefined;
      const currentHosts = automatic ? privateLanHosts() : [];
      const savedHost = credentials?.lastEndpoint?.host;
      const targetHost = assertPrivateBindHost(host || (currentHosts.includes(savedHost) ? savedHost : preferredLanHost()));
      if (automatic && !credentials.hosts.includes(targetHost)) {
        credentials = await refreshProjectLanServerCredentials(credentials, { hosts: [...new Set([...currentHosts, targetHost])], now: this.now() });
        await atomicWriteJson(this.lanCredentialsFile, credentials);
      }
      const targetPort = port === undefined ? (credentials?.lastEndpoint?.port || 0) : port;
      const channel = await this.#createLocalSecureChannel(device);
      const transport = new LanProjectTransport({
        enabled: true,
        endpointRef: randomRef("endpoint", 24),
        host: targetHost,
        port: targetPort,
        cert: cert ?? credentials.serverCert,
        key: key ?? credentials.serverPrivateKey,
        ca: ca ?? credentials.caCert,
        resolveChannel: (targetDeviceRef) => targetDeviceRef === device.device.deviceRef ? channel : undefined,
        onDelivery: (opened) => { this.#handleTransportDelivery(opened); },
        tlsModule: this.tlsModule,
      });
      await transport.start();
      this.lanTransport = transport;
      if (automatic) {
        credentials.lastEndpoint = { host: transport.host, port: transport.boundPort };
        await atomicWriteJson(this.lanCredentialsFile, credentials);
      }
      return this.#lanProjection();
    });
  }

  /** Start or reuse the invited desktop's persistent, bidirectional LAN mTLS client. */
  async connectLan({ host, port, cert, key, ca } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireDevice();
      if (device.kind !== "collaborator") throw new TypeError("LAN client connection is available on an invited desktop");
      const storedLan = isRecord(device.lan) ? device.lan : undefined;
      const endpoint = Array.isArray(storedLan?.endpoints) ? storedLan.endpoints[0] : undefined;
      const targetHost = assertPrivateBindHost(host || endpoint?.host);
      const targetPort = safeTime(Number(port ?? endpoint?.port), "port", 65_535);
      if (targetPort < 1) throw new TypeError("port must be from 1 through 65535");
      const authorityPeer = this.#peerRecords(device)[0];
      if (authorityPeer === undefined) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "authority device keys are missing from this pairing");
      await this.lanClient?.stop?.();
      const channel = await this.#createLocalSecureChannel(device);
      const client = new PersistentLanProjectClient({
        host: targetHost,
        port: targetPort,
        cert: nonEmptyString(cert ?? storedLan?.cert, "cert", 256 * 1024),
        key: nonEmptyString(key ?? storedLan?.key, "key", 256 * 1024),
        ca: nonEmptyString(ca ?? storedLan?.ca, "ca", 256 * 1024),
        serverCertificateRef: nonEmptyString(storedLan?.serverCertificateRef, "serverCertificateRef", 128),
        resolveChannel: (targetDeviceRef) => targetDeviceRef === device.device.deviceRef ? channel : undefined,
        onDelivery: (opened) => { this.#handleTransportDelivery(opened); },
        tlsModule: this.tlsModule,
      });
      await client.start();
      this.lanClient = client;
      const packet = this.#sealForPeer(device, authorityPeer.deviceRef, "lan_mtls", { type: "presence", displayName: device.device.displayName });
      const queued = client.send(packet);
      return { connected: true, packetRef: queued.packetRef };
    });
  }

  async stopLan() {
    return this.#queue(async () => {
      await this.#stopLanTransport();
      return this.#lanProjection();
    });
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.entryClosing = true;
    this.businessDeliveryListeners.clear();
    if (!this.taskContextClosed) {
      this.taskContextClosed = true;
      this.taskContextEpoch += 1;
      for (const key of this.taskContextKeys) key.fill(0);
      this.taskContextKeys.clear();
    }
    const accepted = this.operationQueues.get("entry") ?? Promise.resolve();
    this.closePromise = accepted.then(async () => {
      let failure;
      try { await this.#stopRelayTransport(); } catch (error) { failure = error; }
      try { await this.#stopLanTransport(); } catch (error) { failure ??= error; }
      const persisted = this.persisted;
      this.persisted = undefined;
      this.device = undefined;
      try { await persisted?.close?.(); } catch (error) { failure ??= error; }
      this.entryClosed = true;
      if (failure !== undefined) throw failure;
    });
    return this.closePromise;
  }

  #lanProjection() {
    const client = this.lanClient?.toJSON?.() ?? { connected: false, reconnecting: false };
    return {
      connected: client.connected === true,
      reconnecting: client.reconnecting === true,
      listening: this.lanTransport?.server !== undefined,
      connectionCount: this.lanTransport?.socketByDevice?.size ?? 0,
    };
  }

  #parseInviteCode(inviteCode) {
    const code = nonEmptyString(inviteCode, "inviteCode", 4_096);
    const match = /^invite_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(code);
    if (match === null) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code is malformed");
    let payload;
    try { payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); }
    catch { throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code payload is invalid"); }
    if (!isRecord(payload) || payload.version !== 1) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code version is unsupported");
    return { code, match, payload };
  }

  async #redeemInvite({ inviteCode, displayName, publicKey }) {
    const device = await this.#requireAuthorityDevice();
    const parsed = this.#parseInviteCode(inviteCode);
    const expected = createHmac("sha256", device.secret).update(canonicalJson(parsed.payload)).digest("base64url");
    const supplied = Buffer.from(parsed.match[2], "base64url");
    const wanted = Buffer.from(expected, "base64url");
    if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code signature is invalid");
    if (parsed.payload.projectRef !== device.projectRef || parsed.payload.authorityKeyId !== await this.#authorityKeyId(device)) {
      throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code belongs to another project or authority epoch");
    }
    if (!Number.isSafeInteger(parsed.payload.expiresAt) || parsed.payload.expiresAt <= this.now()) throw entryError("PROJECT_ENTRY_INVITE_EXPIRED", "invite code has expired");
    const role = optionalRole(parsed.payload.role);
    const name = nonEmptyString(displayName, "displayName", 120);
    const collaboratorPublicKey = publicKeyInput(publicKey, "publicKey");
    const inviteRef = inviteFingerprint(parsed.code);
    const invites = await this.#loadInvites();
    if (!invites.invites.some((invite) => invite.inviteRef === inviteRef && Date.parse(invite.expiresAt) > this.now())) {
      throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code is no longer active");
    }
    // Consume before mutating membership. On a persistence failure the caller must
    // request a new invite rather than risk replaying a credential.
    invites.invites = invites.invites.filter((invite) => invite.inviteRef !== inviteRef);
    await atomicWriteJson(this.invitesFile, invites);
    const persisted = await this.#requirePersisted(device);
    const { result } = await persisted.mutate("registerDevice", {
      actorDeviceRef: device.device.deviceRef,
      userHandle: `invite-user:${parsed.payload.roomRef}`,
      deviceHandle: `invite-device:${parsed.match[1].slice(0, 24)}`,
      displayName: name,
      role,
      publicKey: collaboratorPublicKey,
    });
    return { grant: result.grant, member: result.member, projectRef: device.projectRef };
  }

  #peerRecords(device) {
    return Array.isArray(device?.peers)
      ? device.peers.filter((peer) => isRecord(peer) && typeof peer.deviceRef === "string" && typeof peer.signingPublicKey === "string" && typeof peer.encryptionPublicKey === "string")
      : [];
  }

  async #createLocalSecureChannel(device) {
    const epoch = device.kind === "collaborator" ? device.authority?.authorityEpoch : (await this.#requirePersisted(device)).authority.authorityEpoch;
    return new ProjectSecureChannel({
      projectRef: device.projectRef,
      authorityEpoch: epoch,
      targetDeviceRef: device.device.deviceRef,
      recipientEncryptionPrivateKey: importPrivateKey(device.device.encryptionPrivateKey, "encryptionPrivateKey"),
      resolveSenderSigningKey: (deviceRef) => {
        const peer = this.#peerRecords(device).find((candidate) => candidate.deviceRef === deviceRef);
        return peer ? importPublicKey(peer.signingPublicKey, "peer signingPublicKey", "ed25519") : undefined;
      },
      verifyTlsPeer: (peer) => peer?.authorized === true && peer?.protocol === LAN_PROTOCOL && typeof peer?.certificateRef === "string",
      now: this.now,
    });
  }

  #sealForPeer(device, targetDeviceRef, transport, payload, verifiedAuthorityEpoch) {
    const peer = this.#peerRecords(device).find((candidate) => candidate.deviceRef === targetDeviceRef);
    if (peer === undefined) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "paired device encryption key is unavailable");
    const authorityEpoch = verifiedAuthorityEpoch ?? (device.kind === "collaborator" ? device.authority?.authorityEpoch : this.persisted?.authority?.authorityEpoch);
    if (!Number.isSafeInteger(authorityEpoch)) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "project authority epoch is unavailable");
    return sealProjectPacket({
      projectRef: device.projectRef,
      authorityEpoch,
      senderDeviceRef: device.device.deviceRef,
      targetDeviceRef,
      transport,
      payload,
      senderSigningPrivateKey: importPrivateKey(device.device.signingPrivateKey, "signingPrivateKey"),
      recipientEncryptionPublicKey: importPublicKey(peer.encryptionPublicKey, "peer encryptionPublicKey", "x25519"),
      createdAt: this.now(),
    });
  }

  async #buildStatus() {
    const project = await this.#loadProjectProjection();
    const relay = await this.#loadRelayProjection();
    const pendingJoin = await this.#loadPendingJoin();
    return { project, lan: this.#lanProjection(), relay, pairing: { pending: pendingJoin !== undefined, projectRef: pendingJoin?.projectRef } };
  }

  async #loadProjectProjection() {
    const device = await this.#loadDeviceFile();
    if (device === undefined) return null;
    if (device.kind === "collaborator") {
      return {
        projectRef: device.projectRef,
        authorityKeyId: device.authority.authorityKeyId,
        authorityEpoch: device.authority.authorityEpoch,
        memberCount: 1,
        memberCountKnown: false,
        revision: device.device.grant?.grantVersion || 1,
        ownerDisplayName: device.device.displayName,
        role: device.device.role,
      };
    }
    const persisted = await this.#requirePersisted(device);
    return {
      projectRef: device.projectRef,
      authorityKeyId: persisted.authority.authorityKeyId,
      authorityEpoch: persisted.authority.authorityEpoch,
      memberCount: persisted.authority.members.size,
      revision: persisted.revision,
      ownerDisplayName: device.device?.displayName,
      role: "owner",
    };
  }

  async #loadRelayProjection() {
    const device = await this.#loadDeviceFile();
    const relay = await this.#loadRelayFile();
    const webSocketAvailable = typeof this.WebSocketImpl === "function" || typeof this.resolveWebSocket === "function";
    const roomRef = relay.roomRef ?? "";
    return {
      enabled: relay.enabled === true && relay.relayUrl !== "",
      relayUrl: relay.enabled === true ? relay.relayUrl : "",
      roomRef: roomRef === "" ? undefined : roomRef,
      webSocketAvailable,
      connected: this.relayTransport?.status === "connected",
      channelReady: device !== undefined && this.#peerRecords(device).length > 0,
      role: device?.kind === "collaborator" ? "collaborator" : "authority",
      lastDelivery: this.lastDelivery ? { type: this.lastDelivery.type, receivedAt: this.lastDelivery.receivedAt } : undefined,
      reason: relay.enabled === true && relay.relayUrl !== ""
        ? "relay transport is configured and can connect when a WebSocket implementation is available."
        : "relay is not configured; remote connection stays disabled until a wss relay URL is set.",
    };
  }

  async #authorityKeyId(device) {
    const persisted = await this.#requirePersisted(device);
    return persisted.authority.authorityKeyId;
  }

  async #requirePersisted(device) {
    if (device.kind === "collaborator") throw entryError("PROJECT_ENTRY_NOT_CREATED", "this desktop is a collaborator and does not own the project authority state");
    if (this.persisted !== undefined && this.persisted.authority.projectRef === device.projectRef) return this.persisted;
    const store = new EncryptedProjectStateStore(this.stateFile, { projectRef: device.projectRef, encryptionKey: Buffer.from(device.encryptionKey, "base64url") });
    const persisted = await PersistedProjectAuthority.open({ store, now: this.now });
    this.persisted = persisted;
    return persisted;
  }

  async #requireDevice() {
    const device = await this.#loadDeviceFile();
    if (device === undefined) throw entryError("PROJECT_ENTRY_NOT_CREATED", "no project exists yet; create the project first");
    return device;
  }

  async #requireAuthorityDevice() {
    const device = await this.#requireDevice();
    if (device.kind === "collaborator") throw entryError("PROJECT_ENTRY_NOT_CREATED", "this action requires the project authority desktop");
    return device;
  }

  async #loadDeviceFile() {
    if (this.device !== undefined) return this.device;
    const device = await readJson(this.deviceFile, undefined);
    if (device === undefined) return undefined;
    const persistedCacheKey = exactBase64urlKey(device?.syncCacheKey);
    const authorityShape = device?.kind !== "collaborator" && device?.syncCacheKey === undefined && typeof device?.secret === "string" && device.secret.length >= 24 && typeof device?.encryptionKey === "string";
    const collaboratorShape = device?.kind === "collaborator" && (device.syncCacheKey === undefined || persistedCacheKey !== undefined) && isRecord(device.authority) && typeof device.authority.authorityPublicKey === "string";
    persistedCacheKey?.fill(0);
    if (!isRecord(device) || device.version !== DEVICE_VERSION || !isRecord(device.device) || (!authorityShape && !collaboratorShape)) {
      throw entryError("PROJECT_ENTRY_NOT_CREATED", "project device credential file is invalid");
    }
    if (device.kind === undefined) device.kind = "authority";
    if (!Array.isArray(device.peers)) device.peers = [];
    this.device = device;
    return device;
  }

  async #loadPendingJoin() {
    const pending = await readJson(this.pendingJoinFile, undefined);
    if (pending === undefined) return undefined;
    if (!isRecord(pending) || pending.version !== 1 || typeof pending.projectRef !== "string" || typeof pending.authorityKeyId !== "string" || !Number.isSafeInteger(pending.expiresAt)) {
      throw entryError("PROJECT_ENTRY_INVITE_INVALID", "pending join request is invalid");
    }
    return pending;
  }

  async #loadInvites() {
    const invites = await readJson(this.invitesFile, { version: INVITES_VERSION, invites: [] });
    if (!isRecord(invites) || invites.version !== INVITES_VERSION || !Array.isArray(invites.invites)) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite store is invalid");
    return invites;
  }

  async #loadRelayFile() {
    const relay = await readJson(this.relayFile, { version: RELAY_VERSION, enabled: false, relayUrl: "", roomRef: "" });
    if (!isRecord(relay) || relay.version !== RELAY_VERSION) return { version: RELAY_VERSION, enabled: false, relayUrl: "", roomRef: "" };
    return { version: RELAY_VERSION, enabled: relay.enabled === true, relayUrl: typeof relay.relayUrl === "string" ? relay.relayUrl : "", roomRef: typeof relay.roomRef === "string" ? relay.roomRef : "" };
  }

  async #ensureLanAuthorityCredentials() {
    const device = await this.#requireAuthorityDevice();
    const existing = await readJson(this.lanCredentialsFile, undefined);
    if (isRecord(existing)
      && existing.version === 1
      && existing.projectRef === device.projectRef
      && Array.isArray(existing.hosts)
      && existing.hosts.length > 0
      && typeof existing.caCert === "string"
      && typeof existing.caPrivateKey === "string"
      && typeof existing.serverCert === "string"
      && typeof existing.serverPrivateKey === "string"
      && Date.parse(existing.expiresAt) > this.now() + 24 * 60 * 60 * 1_000) return existing;
    const credentials = await createProjectLanAuthorityCredentials({ projectRef: device.projectRef, hosts: privateLanHosts(), now: this.now() });
    await atomicWriteJson(this.lanCredentialsFile, credentials);
    return credentials;
  }

  async #stopRelayTransport() {
    const transport = this.relayTransport;
    this.relayTransport = undefined;
    if (transport !== undefined) await transport.stop();
  }

  #handleTransportDelivery(opened) {
    let delivery;
    try { delivery = safeOpenedDelivery(opened); }
    catch { return; }
    this.lastDelivery = { senderDeviceRef: delivery.senderDeviceRef, type: delivery.payload?.type, receivedAt: this.now() };
    for (const listener of [...this.businessDeliveryListeners]) {
      try {
        const result = listener(delivery);
        if (result !== null && (typeof result === "object" || typeof result === "function") && typeof result.then === "function") Promise.resolve(result).catch(() => undefined);
      } catch {}
    }
  }

  async #stopLanTransport() {
    const transport = this.lanTransport;
    const client = this.lanClient;
    this.lanTransport = undefined;
    this.lanClient = undefined;
    await Promise.allSettled([transport?.stop?.(), client?.stop?.()]);
  }

  #queue(operation) {
    if (this.entryClosing || this.entryClosed) return Promise.reject(entryError("PROJECT_ENTRY_CLOSED", "project entry service is closed"));
    return queueByKey(this.operationQueues, "entry", operation);
  }
}

function timingSafeEqual(left, right) {
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export {
  DEVICE_FILE,
  DEVICE_VERSION,
  ENTRY_ERROR_CODES,
  INVITES_FILE,
  INVITES_VERSION,
  LAN_CREDENTIALS_FILE,
  MAX_PERSISTED_INVITES,
  PENDING_JOIN_FILE,
  PROJECT_BUSINESS_SYNC_DATABASE_FILE,
  PROJECT_BUSINESS_SYNC_KEY_DOMAIN,
  PROJECT_FOUNDATIONS_DIRECTORY,
  PROJECT_FOUNDATION_KEY_DOMAINS,
  RELAY_FILE,
  RELAY_VERSION,
  ROLES,
};
