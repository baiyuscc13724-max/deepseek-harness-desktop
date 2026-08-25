import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

const SECURE_CHANNEL_VERSION = 1;
const PACKET_ALGORITHM = "x25519-hkdf-sha256+a256gcm+ed25519";
const TRANSPORTS = new Set(["lan_mtls", "remote_wss"]);
const PROJECT_REF = /^project_[A-Za-z0-9_-]{20,64}$/u;
const DEVICE_REF = /^device_[A-Za-z0-9_-]{20,64}$/u;
const MAX_PACKET_BYTES = 256 * 1024;
const MAX_PACKET_LIFETIME_MS = 10 * 60 * 1_000;
const DEFAULT_CLOCK_SKEW_MS = 2 * 60 * 1_000;
const DEFAULT_REPLAY_CAPACITY = 5_000;
const MAX_PAYLOAD_DEPTH = 32;
const PACKET_REPLAY_SCOPE = "channel_instance";
const FORBIDDEN_RAW_KEYS = new Set(["sessionid", "membersessionid", "targetsessionid", "userid", "deviceid", "accountid", "email", "ipaddress"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${field} must be a safe integer of at least ${minimum}`);
  return value;
}
function opaqueRef(value, field, pattern) {
  const ref = nonEmptyString(value, field, 128);
  if (!pattern.test(ref)) throw new TypeError(`${field} must be an opaque project reference`);
  return ref;
}
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function assertLosslessJson(value, field = "payload", ancestors = new Set(), depth = 0) {
  if (depth > MAX_PAYLOAD_DEPTH) throw new RangeError(`${field} exceeds the maximum depth of ${MAX_PAYLOAD_DEPTH}`);
  const bounded = (bytes) => {
    if (bytes > MAX_PACKET_BYTES) throw new RangeError(`payload exceeds ${MAX_PACKET_BYTES} bytes`);
    return bytes;
  };
  if (value === null || typeof value === "string" || typeof value === "boolean") return bounded(Buffer.byteLength(JSON.stringify(value), "utf8"));
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${field} contains a non-finite number`);
    if (Object.is(value, -0)) throw new TypeError(`${field} contains negative zero`);
    return bounded(Buffer.byteLength(JSON.stringify(value), "utf8"));
  }
  if (typeof value !== "object") throw new TypeError(`${field} must be lossless JSON`);
  if (ancestors.has(value)) throw new TypeError(`${field} contains a cycle`);
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key === "symbol")) throw new TypeError(`${field} contains a symbol key`);
    if (Array.isArray(value)) {
      const expectedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
      if (keys.some((key) => !expectedKeys.has(key))) throw new TypeError(`${field} contains custom array properties`);
      let bytes = 2 + Math.max(0, value.length - 1);
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index), descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined) throw new TypeError(`${field} contains a sparse array`);
        if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${field}[${index}] must be an enumerable JSON data property`);
        bytes = bounded(bytes + assertLosslessJson(descriptor.value, `${field}[${index}]`, ancestors, depth + 1));
      }
      return bytes;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${field} must contain plain objects only`);
    let bytes = 2 + Math.max(0, keys.length - 1);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${field}.${key} must be an enumerable JSON data property`);
      if (FORBIDDEN_RAW_KEYS.has(key.replaceAll(/[-_]/gu, "").toLowerCase())) throw new TypeError(`${field} contains forbidden raw identity field ${key}`);
      bytes = bounded(bytes + Buffer.byteLength(JSON.stringify(key), "utf8") + 1 + assertLosslessJson(descriptor.value, `${field}.${key}`, ancestors, depth + 1));
    }
    return bytes;
  } finally { ancestors.delete(value); }
}
function encodeValidatedJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length; index += 1) items.push(encodeValidatedJson(Object.getOwnPropertyDescriptor(value, String(index)).value));
    return `[${items.join(",")}]`;
  }
  const fields = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    fields.push(`${JSON.stringify(key)}:${encodeValidatedJson(descriptor.value)}`);
  }
  return `{${fields.join(",")}}`;
}
function clonePayload(value) {
  const preflightBytes = assertLosslessJson(value);
  // Encode descriptor values directly instead of calling JSON.stringify on the
  // container, which would execute a polluted inherited toJSON hook.
  const encoded = encodeValidatedJson(value);
  if (typeof encoded !== "string") throw new TypeError("payload must encode as JSON");
  const byteLength = Buffer.byteLength(encoded, "utf8");
  if (byteLength > MAX_PACKET_BYTES) throw new RangeError(`payload exceeds ${MAX_PACKET_BYTES} bytes`);
  if (byteLength !== preflightBytes) throw new TypeError("payload changed while it was being encoded");
  const bytes = Buffer.from(encoded, "utf8");
  if (bytes.length !== byteLength || bytes.length > MAX_PACKET_BYTES) { bytes.fill(0); throw new RangeError(`payload exceeds ${MAX_PACKET_BYTES} bytes`); }
  return { value: JSON.parse(encoded), bytes };
}
function immutable(value) {
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function keyObject(value, type, asymmetricKeyType, field) {
  let key;
  try {
    if (isRecord(value) && value.type === type && typeof value.export === "function") key = value;
    else key = type === "private" ? createPrivateKey(value) : createPublicKey(value);
  } catch (error) { throw new TypeError(`${field} is not a valid ${type} key: ${String(error)}`); }
  if (key.asymmetricKeyType !== asymmetricKeyType) throw new TypeError(`${field} must be ${asymmetricKeyType}`);
  return key;
}
function publicKeyBytes(value, asymmetricKeyType, field) {
  return keyObject(value, "public", asymmetricKeyType, field).export({ type: "spki", format: "der" });
}
function keyId(value, asymmetricKeyType, field) {
  return `key_${createHash("sha256").update(publicKeyBytes(value, asymmetricKeyType, field)).digest("base64url")}`;
}
function shaRef(prefix, ...values) {
  const hash = createHash("sha256");
  for (const value of values) hash.update(value);
  return `${prefix}_${hash.digest("base64url")}`;
}
function packetHeader(value) {
  return {
    version: value.version,
    algorithm: value.algorithm,
    projectRef: value.projectRef,
    authorityEpoch: value.authorityEpoch,
    senderDeviceRef: value.senderDeviceRef,
    targetDeviceRef: value.targetDeviceRef,
    senderSigningKeyId: value.senderSigningKeyId,
    recipientEncryptionKeyId: value.recipientEncryptionKeyId,
    transport: value.transport,
    hop: value.hop,
    fanout: value.fanout,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    ephemeralPublicKey: value.ephemeralPublicKey,
    nonce: value.nonce,
  };
}
function packetSignatureBody(value) {
  return {
    ...packetHeader(value),
    ciphertext: value.ciphertext,
    tag: value.tag,
    ciphertextDigest: value.ciphertextDigest,
    packetRef: value.packetRef,
  };
}
function normalizeEnvelope(value) {
  if (!isRecord(value)) throw new TypeError("secure project packet must be an object");
  assertAllowedKeys(value, new Set(["version", "algorithm", "projectRef", "authorityEpoch", "senderDeviceRef", "targetDeviceRef", "senderSigningKeyId", "recipientEncryptionKeyId", "transport", "hop", "fanout", "createdAt", "expiresAt", "ephemeralPublicKey", "nonce", "ciphertext", "tag", "ciphertextDigest", "packetRef", "signature"]), "secure project packet");
  if (value.version !== SECURE_CHANNEL_VERSION || value.algorithm !== PACKET_ALGORITHM) throw new TypeError("secure project packet version or algorithm is unsupported");
  const transport = nonEmptyString(value.transport, "packet.transport", 32);
  if (!TRANSPORTS.has(transport)) throw new TypeError("packet.transport is unsupported");
  const normalized = {
    version: SECURE_CHANNEL_VERSION,
    algorithm: PACKET_ALGORITHM,
    projectRef: opaqueRef(value.projectRef, "packet.projectRef", PROJECT_REF),
    authorityEpoch: safeInteger(value.authorityEpoch, "packet.authorityEpoch", 1),
    senderDeviceRef: opaqueRef(value.senderDeviceRef, "packet.senderDeviceRef", DEVICE_REF),
    targetDeviceRef: opaqueRef(value.targetDeviceRef, "packet.targetDeviceRef", DEVICE_REF),
    senderSigningKeyId: nonEmptyString(value.senderSigningKeyId, "packet.senderSigningKeyId", 128),
    recipientEncryptionKeyId: nonEmptyString(value.recipientEncryptionKeyId, "packet.recipientEncryptionKeyId", 128),
    transport,
    hop: safeInteger(value.hop, "packet.hop"),
    fanout: safeInteger(value.fanout, "packet.fanout", 1),
    createdAt: safeInteger(value.createdAt, "packet.createdAt"),
    expiresAt: safeInteger(value.expiresAt, "packet.expiresAt"),
    ephemeralPublicKey: nonEmptyString(value.ephemeralPublicKey, "packet.ephemeralPublicKey", 512),
    nonce: nonEmptyString(value.nonce, "packet.nonce", 128),
    ciphertext: nonEmptyString(value.ciphertext, "packet.ciphertext", MAX_PACKET_BYTES * 2),
    tag: nonEmptyString(value.tag, "packet.tag", 128),
    ciphertextDigest: nonEmptyString(value.ciphertextDigest, "packet.ciphertextDigest", 128),
    packetRef: nonEmptyString(value.packetRef, "packet.packetRef", 128),
    signature: nonEmptyString(value.signature, "packet.signature", 256),
  };
  const ephemeral = Buffer.from(normalized.ephemeralPublicKey, "base64url");
  const nonce = Buffer.from(normalized.nonce, "base64url");
  const ciphertext = Buffer.from(normalized.ciphertext, "base64url");
  const tag = Buffer.from(normalized.tag, "base64url");
  if (ephemeral.length < 32 || ephemeral.length > 256 || nonce.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PACKET_BYTES) throw new TypeError("secure project packet cryptographic fields are invalid");
  return { ...normalized, ephemeral, nonceBytes: nonce, ciphertextBytes: ciphertext, tagBytes: tag };
}
function withPacketKey(privateKey, publicKey, projectRef, authorityEpoch, senderDeviceRef, targetDeviceRef, operation) {
  let secret, salt, info, packetKey;
  try {
    // Node KeyObjects keep native key material and do not expose a supported
    // zeroization API. Every temporary Buffer derived from them is scoped here.
    secret = diffieHellman({
      privateKey: keyObject(privateKey, "private", "x25519", "encryptionPrivateKey"),
      publicKey: keyObject(publicKey, "public", "x25519", "encryptionPublicKey"),
    });
    salt = createHash("sha256").update(`${projectRef}\u0000${authorityEpoch}`).digest();
    info = Buffer.from(`dsh-project-packet-v1\u0000${senderDeviceRef}\u0000${targetDeviceRef}`);
    packetKey = Buffer.from(hkdfSync("sha256", secret, salt, info, 32));
    return operation(packetKey);
  } finally {
    packetKey?.fill(0);
    info?.fill(0);
    salt?.fill(0);
    secret?.fill(0);
  }
}

export function generateProjectTransportKeys() {
  return Object.freeze({ signing: generateKeyPairSync("ed25519"), encryption: generateKeyPairSync("x25519") });
}

export function sealProjectPacket({ projectRef, authorityEpoch, senderDeviceRef, targetDeviceRef, transport, payload, senderSigningPrivateKey, recipientEncryptionPublicKey, createdAt = Date.now(), expiresAt = createdAt + MAX_PACKET_LIFETIME_MS } = {}) {
  const normalizedProjectRef = opaqueRef(projectRef, "projectRef", PROJECT_REF);
  const senderRef = opaqueRef(senderDeviceRef, "senderDeviceRef", DEVICE_REF);
  const targetRef = opaqueRef(targetDeviceRef, "targetDeviceRef", DEVICE_REF);
  if (senderRef === targetRef) throw new Error("secure project packets require a distinct exact target");
  const normalizedEpoch = safeInteger(authorityEpoch, "authorityEpoch", 1);
  const normalizedTransport = nonEmptyString(transport, "transport", 32);
  if (!TRANSPORTS.has(normalizedTransport)) throw new TypeError("transport must be lan_mtls or remote_wss");
  const created = safeInteger(createdAt, "createdAt");
  const expiry = safeInteger(expiresAt, "expiresAt");
  if (expiry <= created || expiry > created + MAX_PACKET_LIFETIME_MS) throw new Error("packet expiry is outside the allowed lifetime");
  const signingPrivateKey = keyObject(senderSigningPrivateKey, "private", "ed25519", "senderSigningPrivateKey");
  const signingPublicKey = createPublicKey(signingPrivateKey);
  const recipientPublicKey = keyObject(recipientEncryptionPublicKey, "public", "x25519", "recipientEncryptionPublicKey");
  const ephemeral = generateKeyPairSync("x25519");
  const nonce = randomBytes(12);
  const header = {
    version: SECURE_CHANNEL_VERSION,
    algorithm: PACKET_ALGORITHM,
    projectRef: normalizedProjectRef,
    authorityEpoch: normalizedEpoch,
    senderDeviceRef: senderRef,
    targetDeviceRef: targetRef,
    senderSigningKeyId: keyId(signingPublicKey, "ed25519", "senderSigningPublicKey"),
    recipientEncryptionKeyId: keyId(recipientPublicKey, "x25519", "recipientEncryptionPublicKey"),
    transport: normalizedTransport,
    hop: 0,
    fanout: 1,
    createdAt: created,
    expiresAt: expiry,
    ephemeralPublicKey: publicKeyBytes(ephemeral.publicKey, "x25519", "ephemeralPublicKey").toString("base64url"),
    nonce: nonce.toString("base64url"),
  };
  const encoded = clonePayload(payload);
  let aad;
  try {
    aad = Buffer.from(canonicalJson(header));
    return withPacketKey(ephemeral.privateKey, recipientPublicKey, normalizedProjectRef, normalizedEpoch, senderRef, targetRef, (packetKey) => {
      const cipher = createCipheriv("aes-256-gcm", packetKey, nonce);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(encoded.bytes), cipher.final()]);
      const tag = cipher.getAuthTag();
      const ciphertextDigest = shaRef("ciphertext", ciphertext);
      const packetRef = shaRef("packet", Buffer.from(canonicalJson(header)), ciphertext, tag);
      const body = { ...header, ciphertext: ciphertext.toString("base64url"), tag: tag.toString("base64url"), ciphertextDigest, packetRef };
      const signature = cryptoSign(null, Buffer.from(canonicalJson(body)), signingPrivateKey).toString("base64url");
      return immutable({ ...body, signature });
    });
  } finally {
    aad?.fill(0);
    encoded.bytes.fill(0);
  }
}

export class ProjectSecureChannel {
  constructor({ projectRef, authorityEpoch, targetDeviceRef, recipientEncryptionPrivateKey, resolveSenderSigningKey, verifyTlsPeer = () => false, now = Date.now, clockSkewMs = DEFAULT_CLOCK_SKEW_MS, replayCapacity = DEFAULT_REPLAY_CAPACITY } = {}) {
    this.projectRef = opaqueRef(projectRef, "projectRef", PROJECT_REF);
    this.authorityEpoch = safeInteger(authorityEpoch, "authorityEpoch", 1);
    this.targetDeviceRef = opaqueRef(targetDeviceRef, "targetDeviceRef", DEVICE_REF);
    this.recipientEncryptionPrivateKey = keyObject(recipientEncryptionPrivateKey, "private", "x25519", "recipientEncryptionPrivateKey");
    this.recipientEncryptionPublicKey = createPublicKey(this.recipientEncryptionPrivateKey);
    this.recipientEncryptionKeyId = keyId(this.recipientEncryptionPublicKey, "x25519", "recipientEncryptionPublicKey");
    if (typeof resolveSenderSigningKey !== "function") throw new TypeError("resolveSenderSigningKey must be a function");
    if (typeof verifyTlsPeer !== "function") throw new TypeError("verifyTlsPeer must be a function");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    this.resolveSenderSigningKey = resolveSenderSigningKey;
    this.verifyTlsPeer = verifyTlsPeer;
    this.now = now;
    this.clockSkewMs = safeInteger(clockSkewMs, "clockSkewMs", 1);
    this.replayCapacity = safeInteger(replayCapacity, "replayCapacity", 1);
    this.seenPackets = new Map();
  }

  toJSON() {
    return { version: SECURE_CHANNEL_VERSION, projectRef: this.projectRef, authorityEpoch: this.authorityEpoch, targetDeviceRef: this.targetDeviceRef, recipientEncryptionKeyId: this.recipientEncryptionKeyId, replayCount: this.seenPackets.size };
  }

  open(packet, { tlsPeer } = {}) {
    const envelope = normalizeEnvelope(packet);
    if (envelope.projectRef !== this.projectRef || envelope.authorityEpoch !== this.authorityEpoch || envelope.targetDeviceRef !== this.targetDeviceRef) throw new Error("secure project packet scope, epoch, or exact target is invalid");
    if (envelope.hop !== 0 || envelope.fanout !== 1) throw new Error("secure project packet hop or fanout policy is invalid");
    const current = this.now();
    if (envelope.createdAt > current + this.clockSkewMs || envelope.expiresAt <= current || envelope.expiresAt > envelope.createdAt + MAX_PACKET_LIFETIME_MS) throw new Error("secure project packet lifetime is invalid or expired");
    if (envelope.recipientEncryptionKeyId !== this.recipientEncryptionKeyId) throw new Error("secure project packet targets another encryption key");
    if (envelope.transport === "lan_mtls" && !this.verifyTlsPeer(tlsPeer, { projectRef: this.projectRef, senderDeviceRef: envelope.senderDeviceRef, targetDeviceRef: this.targetDeviceRef })) throw new Error("LAN project packet requires an authenticated pinned mTLS peer");
    const senderPublicKey = keyObject(this.resolveSenderSigningKey(envelope.senderDeviceRef, envelope.senderSigningKeyId), "public", "ed25519", "senderSigningPublicKey");
    if (keyId(senderPublicKey, "ed25519", "senderSigningPublicKey") !== envelope.senderSigningKeyId) throw new Error("secure project packet sender key id is invalid");
    if (envelope.ciphertextDigest !== shaRef("ciphertext", envelope.ciphertextBytes)) throw new Error("secure project packet ciphertext digest is invalid");
    const expectedPacketRef = shaRef("packet", Buffer.from(canonicalJson(packetHeader(envelope))), envelope.ciphertextBytes, envelope.tagBytes);
    if (envelope.packetRef !== expectedPacketRef) throw new Error("secure project packet reference is invalid");
    if (!cryptoVerify(null, Buffer.from(canonicalJson(packetSignatureBody(envelope))), senderPublicKey, Buffer.from(envelope.signature, "base64url"))) throw new Error("secure project packet signature is invalid");
    this.#pruneReplay(current);
    if (this.seenPackets.has(envelope.packetRef)) {
      const error = new Error("secure project packet replay was rejected");
      error.code = "PROJECT_PACKET_REPLAY";
      throw error;
    }
    let payload, plaintext, copied, aad;
    try {
      const ephemeralPublicKey = keyObject({ key: envelope.ephemeral, type: "spki", format: "der" }, "public", "x25519", "ephemeralPublicKey");
      payload = withPacketKey(this.recipientEncryptionPrivateKey, ephemeralPublicKey, this.projectRef, this.authorityEpoch, envelope.senderDeviceRef, this.targetDeviceRef, (packetKey) => {
        const decipher = createDecipheriv("aes-256-gcm", packetKey, envelope.nonceBytes);
        aad = Buffer.from(canonicalJson(packetHeader(envelope)));
        decipher.setAAD(aad);
        decipher.setAuthTag(envelope.tagBytes);
        plaintext = Buffer.concat([decipher.update(envelope.ciphertextBytes), decipher.final()]);
        if (plaintext.length > MAX_PACKET_BYTES) throw new RangeError("secure project packet payload exceeds the limit");
        const parsed = JSON.parse(plaintext.toString("utf8"));
        copied = clonePayload(parsed);
        return copied.value;
      });
    } catch (error) {
      const failure = new Error("secure project packet authentication or decryption failed");
      failure.cause = error;
      throw failure;
    } finally {
      copied?.bytes.fill(0);
      plaintext?.fill(0);
      aad?.fill(0);
    }
    this.seenPackets.set(envelope.packetRef, envelope.expiresAt);
    this.#pruneReplay(current);
    return immutable({ packetRef: envelope.packetRef, projectRef: envelope.projectRef, authorityEpoch: envelope.authorityEpoch, senderDeviceRef: envelope.senderDeviceRef, targetDeviceRef: envelope.targetDeviceRef, transport: envelope.transport, payload, createdAt: envelope.createdAt, expiresAt: envelope.expiresAt });
  }

  #pruneReplay(current) {
    for (const [packetRef, expiresAt] of this.seenPackets) if (expiresAt <= current) this.seenPackets.delete(packetRef);
    while (this.seenPackets.size > this.replayCapacity) this.seenPackets.delete(this.seenPackets.keys().next().value);
  }
}

export {
  DEFAULT_REPLAY_CAPACITY,
  MAX_PACKET_BYTES,
  MAX_PACKET_LIFETIME_MS,
  MAX_PAYLOAD_DEPTH,
  PACKET_ALGORITHM,
  PACKET_REPLAY_SCOPE,
  SECURE_CHANNEL_VERSION,
  TRANSPORTS,
};
