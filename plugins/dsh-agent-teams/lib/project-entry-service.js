import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as nodeTls from "node:tls";
import { ProjectCollaborationAuthority } from "./project-collaboration.js";
import { PersistedProjectAuthority } from "./project-authority-service.js";
import { EncryptedProjectStateStore } from "./project-state-store.js";
import { LanProjectTransport } from "./project-lan-transport.js";
import { ProjectWssRelayTransport, safeRelayUrl } from "./project-wss-relay-transport.js";
import { generateProjectTransportKeys } from "./project-secure-channel.js";

const DEVICE_FILE = "agent_project_device.json";
const STATE_FILE = "agent_project_state.json";
const INVITES_FILE = "agent_project_invites.json";
const RELAY_FILE = "agent_project_relay.json";
const DEVICE_VERSION = 1;
const INVITES_VERSION = 1;
const RELAY_VERSION = 1;
const INVITE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_PERSISTED_INVITES = 50;
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
function importPrivateKey(value, field) {
  return createPrivateKey({ key: Buffer.from(nonEmptyString(value, field, 8_192), "base64url"), type: "pkcs8", format: "der" });
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
  }

  /** Serialize the public, non-secret status projection used by the Web API and the client panel. */
  async status() {
    return this.#queue(async () => {
      const project = await this.#loadProjectProjection();
      const relay = await this.#loadRelayProjection();
      const lan = this.#lanProjection();
      return { project, lan, relay };
    });
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
      const device = await this.#requireDevice();
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
    return this.#queue(async () => {
      const device = await this.#requireDevice();
      const code = nonEmptyString(inviteCode, "inviteCode", 4_096);
      const match = /^invite_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(code);
      if (match === null) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code is malformed");
      let payload;
      try { payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); }
      catch { throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code payload is invalid"); }
      if (!isRecord(payload) || payload.version !== 1) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code version is unsupported");
      const expected = createHmac("sha256", device.secret).update(canonicalJson(payload)).digest("base64url");
      const supplied = Buffer.from(match[2], "base64url");
      const wanted = Buffer.from(expected, "base64url");
      if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code signature is invalid");
      if (payload.projectRef !== device.projectRef || payload.authorityKeyId !== await this.#authorityKeyId(device)) {
        throw entryError("PROJECT_ENTRY_INVITE_INVALID", "invite code belongs to another project or authority epoch");
      }
      if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= this.now()) throw entryError("PROJECT_ENTRY_INVITE_EXPIRED", "invite code has expired");
      const role = optionalRole(payload.role);
      const name = nonEmptyString(displayName, "displayName", 120);
      const collaboratorPublicKey = publicKeyInput(publicKey, "publicKey");
      const inviteRef = inviteFingerprint(code);
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
        userHandle: `invite-user:${payload.roomRef}`,
        deviceHandle: `invite-device:${match[1].slice(0, 24)}`,
        displayName: name,
        role,
        publicKey: collaboratorPublicKey,
      });
      return { grant: result.grant, member: result.member, projectRef: device.projectRef };
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
  async connectRemote({ role = "authority" } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireDevice();
      const relay = await this.#loadRelayFile();
      if (relay.enabled !== true || relay.relayUrl === "") throw entryError("PROJECT_ENTRY_RELAY_NOT_CONFIGURED", "relay is not configured; set a wss relay URL first");
      const roomRef = typeof relay.roomRef === "string" ? relay.roomRef : "";
      if (!/^[A-Za-z0-9_-]{43}$/u.test(roomRef)) throw entryError("PROJECT_ENTRY_RELAY_ROOM_MISSING", "relay room reference is missing or invalid; create an invite first");
      const normalizedRole = nonEmptyString(role, "role", 32);
      if (normalizedRole !== "authority" && normalizedRole !== "collaborator") throw new TypeError("role must be authority or collaborator");
      const WebSocketImpl = this.WebSocketImpl ?? (this.resolveWebSocket ? await this.resolveWebSocket() : undefined);
      if (typeof WebSocketImpl !== "function") throw entryError("PROJECT_ENTRY_RELAY_WEBSOCKET_UNAVAILABLE", "no WebSocket implementation is available in this runtime");
      await this.#stopRelayTransport();
      const transport = new ProjectWssRelayTransport({
        enabled: true,
        projectRef: device.projectRef,
        role: normalizedRole,
        roomRef,
        relayUrl: relay.relayUrl,
        WebSocketImpl,
        resolveChannel: () => undefined,
        onDelivery: () => undefined,
      });
      await transport.start();
      this.relayTransport = transport;
      const projection = transport.toJSON();
      return {
        connected: true,
        channelReady: false,
        reason: "relay connection is real; per-device E2EE channel key exchange is a separate explicit configuration step",
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

  /** Start the real LAN mTLS listener with explicit certificates. */
  async startLan({ host = "127.0.0.1", port = 0, cert, key, ca } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireDevice();
      await this.#stopLanTransport();
      const transport = new LanProjectTransport({
        enabled: true,
        endpointRef: randomRef("endpoint", 24),
        host,
        port,
        cert,
        key,
        ca,
        resolveChannel: () => undefined,
        onDelivery: () => undefined,
        tlsModule: this.tlsModule,
      });
      await transport.start();
      this.lanTransport = transport;
      return this.#lanProjection();
    });
  }

  async stopLan() {
    return this.#queue(async () => {
      await this.#stopLanTransport();
      return this.#lanProjection();
    });
  }

  async close() {
    await this.#stopRelayTransport();
    await this.#stopLanTransport();
  }

  #lanProjection() {
    const listening = this.lanTransport?.server !== undefined;
    return {
      implemented: true,
      listening,
      requiresExplicitCertificates: true,
      autoDiscovery: {
        implemented: false,
        reason: "LAN auto-discovery beacon is not implemented; the base layer requires explicit mTLS certificate pinning, so discovery cannot be pretended.",
      },
      reason: listening
        ? "LAN mTLS listener is active on an explicit private address."
        : "LAN mTLS transport is implemented but not listening; it requires explicit certificate and key configuration.",
    };
  }

  async #buildStatus() {
    const project = await this.#loadProjectProjection();
    const relay = await this.#loadRelayProjection();
    return { project, lan: this.#lanProjection(), relay };
  }

  async #loadProjectProjection() {
    const device = await this.#loadDeviceFile();
    if (device === undefined) return null;
    const persisted = await this.#requirePersisted(device);
    return {
      projectRef: device.projectRef,
      authorityKeyId: persisted.authority.authorityKeyId,
      authorityEpoch: persisted.authority.authorityEpoch,
      memberCount: persisted.authority.members.size,
      revision: persisted.revision,
      ownerDisplayName: device.device?.displayName,
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
      channelReady: false,
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

  async #loadDeviceFile() {
    if (this.device !== undefined) return this.device;
    const device = await readJson(this.deviceFile, undefined);
    if (device === undefined) return undefined;
    if (!isRecord(device) || device.version !== DEVICE_VERSION || !isRecord(device.device) || typeof device.secret !== "string" || device.secret.length < 24) {
      throw entryError("PROJECT_ENTRY_NOT_CREATED", "project device credential file is invalid");
    }
    this.device = device;
    return device;
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

  async #stopRelayTransport() {
    const transport = this.relayTransport;
    this.relayTransport = undefined;
    if (transport !== undefined) await transport.stop();
  }

  async #stopLanTransport() {
    const transport = this.lanTransport;
    this.lanTransport = undefined;
    if (transport !== undefined) await transport.stop();
  }

  #queue(operation) {
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
  MAX_PERSISTED_INVITES,
  RELAY_FILE,
  RELAY_VERSION,
  ROLES,
};
