import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FIELD_ENVELOPE_VERSION = 1;
const FIELD_ALGORITHM = "aes-256-gcm";
const MAX_FIELD_PLAINTEXT_BYTES = 64 * 1024;
const MAX_FIELD_ENVELOPE_BYTES = 128 * 1024;
const PROJECT_REF = /^project_[A-Za-z0-9_-]{20,64}$/u;

function cryptoError(message, cause) {
  const error = new Error(message);
  error.code = "PROJECT_TASK_CIPHERTEXT_INVALID";
  if (cause !== undefined) error.cause = cause;
  return error;
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function normalizeProjectRef(value) {
  const projectRef = nonEmptyString(value, "projectRef", 128);
  if (!PROJECT_REF.test(projectRef)) throw new TypeError("projectRef must be an opaque project reference");
  return projectRef;
}
function normalizeField(value) {
  return nonEmptyString(value, "field", 512);
}
function normalizeKey(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) throw new TypeError("project task encryption key provider must return bytes");
  const key = Buffer.from(value);
  if (key.length !== 32) throw new TypeError("project task encryption key must contain exactly 32 bytes");
  return key;
}
function aad({ version, algorithm, projectRef, field }) {
  return Buffer.from(JSON.stringify({ version, algorithm, projectRef, field }), "utf8");
}
function parseEnvelope(value, expectedProjectRef, expectedField) {
  const encoded = nonEmptyString(value, "ciphertext envelope", MAX_FIELD_ENVELOPE_BYTES);
  let envelope;
  try { envelope = JSON.parse(encoded); } catch (error) { throw cryptoError("project task ciphertext envelope is invalid", error); }
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) throw cryptoError("project task ciphertext envelope is invalid");
  const keys = Object.keys(envelope);
  const allowed = new Set(["version", "algorithm", "projectRef", "field", "nonce", "ciphertext", "tag"]);
  if (keys.some((key) => !allowed.has(key)) || keys.length !== allowed.size) throw cryptoError("project task ciphertext envelope is invalid");
  if (envelope.version !== FIELD_ENVELOPE_VERSION || envelope.algorithm !== FIELD_ALGORITHM || envelope.projectRef !== expectedProjectRef || envelope.field !== expectedField) {
    throw cryptoError("project task ciphertext scope or algorithm is invalid");
  }
  let nonce;
  let ciphertext;
  let tag;
  try {
    nonce = Buffer.from(nonEmptyString(envelope.nonce, "envelope.nonce", 128), "base64url");
    ciphertext = Buffer.from(nonEmptyString(envelope.ciphertext, "envelope.ciphertext", MAX_FIELD_ENVELOPE_BYTES), "base64url");
    tag = Buffer.from(nonEmptyString(envelope.tag, "envelope.tag", 128), "base64url");
  } catch (error) { throw cryptoError("project task ciphertext encoding is invalid", error); }
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_FIELD_PLAINTEXT_BYTES) throw cryptoError("project task ciphertext fields are invalid");
  return { version: envelope.version, algorithm: envelope.algorithm, projectRef: envelope.projectRef, field: envelope.field, nonce, ciphertext, tag };
}

class ProjectTaskFieldCipher {
  constructor({ keyProvider, maxPlaintextBytes = MAX_FIELD_PLAINTEXT_BYTES } = {}) {
    if (typeof keyProvider !== "function") throw new TypeError("keyProvider must be a function");
    if (!Number.isSafeInteger(maxPlaintextBytes) || maxPlaintextBytes < 1 || maxPlaintextBytes > MAX_FIELD_PLAINTEXT_BYTES) throw new TypeError(`maxPlaintextBytes must be from 1 through ${MAX_FIELD_PLAINTEXT_BYTES}`);
    this.keyProvider = keyProvider;
    this.maxPlaintextBytes = maxPlaintextBytes;
  }

  seal(inputProjectRef, inputField, value) {
    const projectRef = normalizeProjectRef(inputProjectRef);
    const field = normalizeField(inputField);
    let plaintext;
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new TypeError("value is not JSON serializable");
      plaintext = Buffer.from(encoded, "utf8");
    } catch (error) { throw new TypeError(`project task field must be JSON serializable: ${String(error?.message ?? error)}`); }
    if (plaintext.length > this.maxPlaintextBytes) throw new RangeError(`project task field exceeds ${this.maxPlaintextBytes} bytes`);
    let key;
    try {
      key = normalizeKey(this.keyProvider(projectRef));
      const nonce = randomBytes(12);
      const header = { version: FIELD_ENVELOPE_VERSION, algorithm: FIELD_ALGORITHM, projectRef, field };
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(header));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const envelope = {
        ...header,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
      };
      return JSON.stringify(envelope);
    } finally {
      key?.fill(0);
      plaintext.fill(0);
    }
  }

  open(inputProjectRef, inputField, value) {
    const projectRef = normalizeProjectRef(inputProjectRef);
    const field = normalizeField(inputField);
    const envelope = parseEnvelope(value, projectRef, field);
    let key;
    let plaintext;
    try {
      key = normalizeKey(this.keyProvider(projectRef));
      const decipher = createDecipheriv("aes-256-gcm", key, envelope.nonce);
      decipher.setAAD(aad(envelope));
      decipher.setAuthTag(envelope.tag);
      plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
      if (plaintext.length > this.maxPlaintextBytes) throw new RangeError("decrypted field exceeds its bound");
      return JSON.parse(plaintext.toString("utf8"));
    } catch (error) {
      if (error?.code === "PROJECT_TASK_CIPHERTEXT_INVALID") throw error;
      throw cryptoError("project task ciphertext authentication or decryption failed", error);
    } finally {
      key?.fill(0);
      plaintext?.fill(0);
    }
  }
}

export {
  FIELD_ALGORITHM,
  FIELD_ENVELOPE_VERSION,
  MAX_FIELD_ENVELOPE_BYTES,
  MAX_FIELD_PLAINTEXT_BYTES,
  PROJECT_REF,
  ProjectTaskFieldCipher,
};
