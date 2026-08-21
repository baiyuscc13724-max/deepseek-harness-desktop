import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = "aes-256-gcm";
const PROJECT_REF = /^project_[A-Za-z0-9_-]{20,64}$/u;
const MAX_ENCRYPTED_STATE_BYTES = 24 * 1024 * 1024;
const STORE_CHAINS = new Map();

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeRevision(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer`);
  return value;
}
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function normalizeKey(value) {
  let key;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) key = Buffer.from(value);
  else key = Buffer.from(nonEmptyString(value, "encryptionKey", 256), "base64url");
  if (key.length !== 32) throw new TypeError("encryptionKey must contain exactly 32 bytes");
  return key;
}
function normalizeProjectRef(value) {
  const projectRef = nonEmptyString(value, "projectRef", 128);
  if (!PROJECT_REF.test(projectRef)) throw new TypeError("projectRef must be an opaque project reference");
  return projectRef;
}
function aad(envelope) {
  return Buffer.from(JSON.stringify({ version: envelope.version, algorithm: envelope.algorithm, projectRef: envelope.projectRef, revision: envelope.revision }));
}
function normalizeEnvelope(value, expectedProjectRef) {
  if (!isRecord(value)) throw new TypeError("project state envelope must be an object");
  assertAllowedKeys(value, new Set(["version", "algorithm", "projectRef", "revision", "nonce", "ciphertext", "tag"]), "project state envelope");
  if (value.version !== ENVELOPE_VERSION || value.algorithm !== ENVELOPE_ALGORITHM) throw new TypeError("project state envelope version or algorithm is unsupported");
  const projectRef = normalizeProjectRef(value.projectRef);
  if (projectRef !== expectedProjectRef) throw new Error("project state envelope belongs to another project");
  const revision = safeRevision(value.revision, "envelope.revision");
  if (revision < 1) throw new TypeError("persisted project state revision must be positive");
  const nonce = Buffer.from(nonEmptyString(value.nonce, "envelope.nonce", 128), "base64url");
  const ciphertext = Buffer.from(nonEmptyString(value.ciphertext, "envelope.ciphertext", MAX_ENCRYPTED_STATE_BYTES * 2), "base64url");
  const tag = Buffer.from(nonEmptyString(value.tag, "envelope.tag", 128), "base64url");
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_ENCRYPTED_STATE_BYTES) throw new TypeError("project state envelope cryptographic fields are invalid");
  return { version: ENVELOPE_VERSION, algorithm: ENVELOPE_ALGORITHM, projectRef, revision, nonce, ciphertext, tag };
}
function queueStore(filePath, operation) {
  const previous = STORE_CHAINS.get(filePath) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(() => undefined, () => undefined);
  STORE_CHAINS.set(filePath, settled);
  void settled.finally(() => { if (STORE_CHAINS.get(filePath) === settled) STORE_CHAINS.delete(filePath); });
  return result;
}

export class EncryptedProjectStateStore {
  constructor(filePath, { projectRef, encryptionKey, minimumRevision = 0 } = {}) {
    this.filePath = resolve(nonEmptyString(filePath, "filePath", 4_096));
    this.projectRef = normalizeProjectRef(projectRef);
    this.encryptionKey = normalizeKey(encryptionKey);
    this.minimumRevision = safeRevision(minimumRevision, "minimumRevision");
    this.lastSeenRevision = this.minimumRevision;
  }

  toJSON() {
    return { version: ENVELOPE_VERSION, projectRef: this.projectRef, minimumRevision: this.minimumRevision, lastSeenRevision: this.lastSeenRevision };
  }

  async load() {
    return queueStore(this.filePath, async () => {
      const envelope = await this.#readEnvelope();
      if (envelope === undefined) return undefined;
      if (envelope.revision < this.minimumRevision || envelope.revision < this.lastSeenRevision) throw new Error("project state rollback was detected");
      const state = this.#decrypt(envelope);
      this.lastSeenRevision = envelope.revision;
      return { state, revision: envelope.revision };
    });
  }

  async save(authorityOrState, { expectedRevision } = {}) {
    const expected = safeRevision(expectedRevision, "expectedRevision");
    const state = typeof authorityOrState?.exportHostState === "function" ? authorityOrState.exportHostState() : authorityOrState;
    if (!isRecord(state) || state.projectRef !== this.projectRef) throw new Error("Host state does not belong to this project store");
    return queueStore(this.filePath, async () => {
      const currentEnvelope = await this.#readEnvelope();
      const currentRevision = currentEnvelope?.revision ?? 0;
      if (currentEnvelope !== undefined) this.#decrypt(currentEnvelope);
      if (currentRevision < this.minimumRevision || currentRevision < this.lastSeenRevision) throw new Error("project state rollback was detected");
      if (currentRevision !== expected) {
        const error = new Error("project state compare-and-swap revision changed");
        error.code = "PROJECT_STATE_CONFLICT";
        error.currentRevision = currentRevision;
        throw error;
      }
      const revision = currentRevision + 1;
      const envelope = this.#encrypt(state, revision);
      await this.#writeEnvelope(envelope);
      this.lastSeenRevision = revision;
      return { revision, projectRef: this.projectRef };
    });
  }

  async #readEnvelope() {
    let text;
    try { text = await readFile(this.filePath, "utf8"); }
    catch (error) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
    if (Buffer.byteLength(text, "utf8") > MAX_ENCRYPTED_STATE_BYTES * 2) throw new RangeError("project state envelope exceeds the storage limit");
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new TypeError("project state envelope is not valid JSON"); }
    return normalizeEnvelope(parsed, this.projectRef);
  }

  #encrypt(state, revision) {
    const plaintext = Buffer.from(JSON.stringify(state));
    if (plaintext.length > MAX_ENCRYPTED_STATE_BYTES) throw new RangeError("project Host state exceeds the storage limit");
    const nonce = randomBytes(12);
    const header = { version: ENVELOPE_VERSION, algorithm: ENVELOPE_ALGORITHM, projectRef: this.projectRef, revision };
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(aad(header));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ...header, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
  }

  #decrypt(envelope) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, envelope.nonce);
      decipher.setAAD(aad(envelope));
      decipher.setAuthTag(envelope.tag);
      const plaintext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
      if (plaintext.length > MAX_ENCRYPTED_STATE_BYTES) throw new RangeError("project Host state exceeds the storage limit");
      const state = JSON.parse(plaintext.toString("utf8"));
      if (!isRecord(state) || state.projectRef !== this.projectRef) throw new Error("decrypted Host state belongs to another project");
      return state;
    } catch (error) {
      const failure = new Error("project state authentication or decryption failed");
      failure.cause = error;
      throw failure;
    }
  }

  async #writeEnvelope(envelope) {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.filePath);
      let directory;
      try {
        directory = await open(dirname(this.filePath), "r");
        await directory.sync();
      } catch {
        // Windows may reject directory handles; the file itself is already fsynced.
      } finally {
        await directory?.close().catch(() => undefined);
      }
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

export {
  EncryptedProjectStateStore as EncryptedAuthorityStateStore,
  ENVELOPE_ALGORITHM,
  ENVELOPE_VERSION,
  MAX_ENCRYPTED_STATE_BYTES,
};
