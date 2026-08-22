import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as nodeTls from "node:tls";
import { ProjectCollaborationAuthority, verifyMembershipGrant } from "./project-collaboration.js";
import { PersistedProjectAuthority } from "./project-authority-service.js";
import { EncryptedProjectStateStore } from "./project-state-store.js";
import { assertPrivateBindHost, LAN_PROTOCOL, LanProjectTransport } from "./project-lan-transport.js";
import { createProjectLanAuthorityCredentials, createProjectLanClientCredentials, preferredLanHost, privateLanHosts, refreshProjectLanServerCredentials } from "./project-lan-credentials.js";
import { ProjectWssRelayTransport, safeRelayUrl } from "./project-wss-relay-transport.js";
import { generateProjectTransportKeys, ProjectSecureChannel, sealProjectPacket } from "./project-secure-channel.js";

const DEVICE_FILE = "agent_project_device.json";
const STATE_FILE = "agent_project_state.json";
const INVITES_FILE = "agent_project_invites.json";
const RELAY_FILE = "agent_project_relay.json";
const PENDING_JOIN_FILE = "agent_project_pending_join.json";
const LAN_CREDENTIALS_FILE = "agent_project_lan_credentials.json";
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
    this.lanClient = { connected: false };
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
        displayName: device.device.displayName,
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
      const device = {
        version: DEVICE_VERSION,
        kind: "collaborator",
        projectRef: pending.projectRef,
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
          displayName: response.authorityDevice.displayName,
          signingPublicKey: exportPublicKey(authoritySigningKey),
          encryptionPublicKey: exportPublicKey(authorityEncryptionKey),
        }],
        lan: isRecord(pairing.lan) && typeof pairing.lan.cert === "string" && typeof pairing.lan.key === "string" && typeof pairing.lan.ca === "string"
          ? {
              version: pairing.lan.version,
              cert: pairing.lan.cert,
              key: pairing.lan.key,
              ca: pairing.lan.ca,
              expiresAt: pairing.lan.expiresAt,
              endpoints: Array.isArray(pairing.lan.endpoints) ? pairing.lan.endpoints.filter((endpoint) => isRecord(endpoint) && typeof endpoint.host === "string" && Number.isSafeInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65_535) : [],
            }
          : undefined,
      };
      await atomicWriteJson(this.deviceFile, device);
      if (typeof pairing.relayUrl === "string" && pairing.relayUrl !== "" && typeof pairing.roomRef === "string") {
        await atomicWriteJson(this.relayFile, { version: RELAY_VERSION, enabled: true, relayUrl: safeRelayUrl(pairing.relayUrl), roomRef: pairing.roomRef });
      }
      await rm(this.pendingJoinFile, { force: true });
      this.device = device;
      return { projectRef: device.projectRef, member: response.member, status: await this.#buildStatus() };
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
        onDelivery: async (opened) => {
          this.lastDelivery = { senderDeviceRef: opened.senderDeviceRef, type: opened.payload?.type, receivedAt: this.now() };
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
        onDelivery: (opened) => { this.lastDelivery = { senderDeviceRef: opened.senderDeviceRef, type: opened.payload?.type, receivedAt: this.now() }; },
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

  /** Verify an invited desktop can reach the authority over the configured LAN mTLS endpoint. */
  async connectLan({ host, port, cert, key, ca } = {}) {
    return this.#queue(async () => {
      const device = await this.#requireDevice();
      if (device.kind !== "collaborator") throw new TypeError("LAN client connection is available on an invited desktop");
      if (typeof this.tlsModule.connect !== "function") throw new TypeError("tlsModule must provide connect");
      const storedLan = isRecord(device.lan) ? device.lan : undefined;
      const endpoint = Array.isArray(storedLan?.endpoints) ? storedLan.endpoints[0] : undefined;
      const targetHost = assertPrivateBindHost(host || endpoint?.host);
      const targetPort = safeTime(Number(port ?? endpoint?.port), "port", 65_535);
      if (targetPort < 1) throw new TypeError("port must be from 1 through 65535");
      const authorityPeer = this.#peerRecords(device)[0];
      if (authorityPeer === undefined) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "authority device keys are missing from this pairing");
      const packet = this.#sealForPeer(device, authorityPeer.deviceRef, "lan_mtls", { type: "presence", displayName: device.device.displayName });
      const socket = this.tlsModule.connect({
        host: targetHost,
        port: targetPort,
        cert: nonEmptyString(cert ?? storedLan?.cert, "cert", 256 * 1024),
        key: nonEmptyString(key ?? storedLan?.key, "key", 256 * 1024),
        ca: nonEmptyString(ca ?? storedLan?.ca, "ca", 256 * 1024),
        rejectUnauthorized: true,
        minVersion: "TLSv1.3",
        ALPNProtocols: [LAN_PROTOCOL],
      });
      try {
        const acknowledgment = await new Promise((resolve, reject) => {
          let body = "";
          const timer = setTimeout(() => reject(new Error("LAN project connection timed out")), 15_000);
          timer.unref?.();
          const finish = (error, value) => {
            clearTimeout(timer);
            socket.off?.("secureConnect", onSecure);
            socket.off?.("data", onData);
            socket.off?.("error", onError);
            if (error) reject(error); else resolve(value);
          };
          const onError = (error) => finish(error);
          const onSecure = () => {
            if (socket.authorized !== true || socket.alpnProtocol !== LAN_PROTOCOL) return finish(new Error("LAN project mTLS peer or ALPN was rejected"));
            socket.write(`${JSON.stringify(packet)}\n`);
          };
          const onData = (chunk) => {
            body += Buffer.from(chunk).toString("utf8");
            if (body.length > 64 * 1024) return finish(new Error("LAN project acknowledgment exceeded the limit"));
            const newline = body.indexOf("\n");
            if (newline < 0) return;
            let parsed;
            try { parsed = JSON.parse(body.slice(0, newline)); } catch (error) { return finish(error); }
            if (parsed?.ok !== true || parsed?.packetRef !== packet.packetRef) return finish(new Error("LAN project acknowledgment is invalid"));
            finish(undefined, parsed);
          };
          socket.once?.("secureConnect", onSecure);
          socket.on?.("data", onData);
          socket.once?.("error", onError);
        });
        this.lanClient = { connected: true, checkedAt: this.now() };
        return { connected: true, packetRef: acknowledgment.packetRef };
      } finally {
        socket.end?.();
        socket.destroy?.();
      }
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
    const pairedEndpoint = Array.isArray(this.device?.lan?.endpoints) ? this.device.lan.endpoints[0] : undefined;
    return {
      implemented: true,
      listening,
      connected: this.lanClient.connected === true,
      endpoint: listening ? { host: this.lanTransport.host, port: this.lanTransport.boundPort } : pairedEndpoint,
      requiresExplicitCertificates: false,
      automaticCredentials: true,
      autoDiscovery: {
        implemented: false,
        reason: "LAN discovery is not broadcast; the one-time pairing response carries the pinned endpoint and mTLS credential.",
      },
      reason: listening
        ? "LAN mTLS listener is active on an explicit private address."
        : "LAN mTLS transport is ready; start the project entry to generate and use project-scoped credentials automatically.",
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

  #sealForPeer(device, targetDeviceRef, transport, payload) {
    const peer = this.#peerRecords(device).find((candidate) => candidate.deviceRef === targetDeviceRef);
    if (peer === undefined) throw entryError("PROJECT_ENTRY_INVITE_INVALID", "paired device encryption key is unavailable");
    const authorityEpoch = device.kind === "collaborator" ? device.authority?.authorityEpoch : this.persisted?.authority?.authorityEpoch;
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
    const authorityShape = device?.kind !== "collaborator" && typeof device?.secret === "string" && device.secret.length >= 24 && typeof device?.encryptionKey === "string";
    const collaboratorShape = device?.kind === "collaborator" && isRecord(device.authority) && typeof device.authority.authorityPublicKey === "string";
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
  LAN_CREDENTIALS_FILE,
  MAX_PERSISTED_INVITES,
  PENDING_JOIN_FILE,
  RELAY_FILE,
  RELAY_VERSION,
  ROLES,
};
