import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const DIGEST = /^sha256:([a-f0-9]{64})$/u;
const UPLOAD_REF = /^upload_[A-Za-z0-9_-]{20,96}$/u;
const DEFAULT_MAX_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_READ_BYTES = 1024 * 1024;

function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function safeInteger(value, field, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${field} must be a safe integer from ${minimum} through ${maximum}`);
  return value;
}
function digestRef(value, field = "digest") {
  const digest = nonEmptyString(value, field, 80).toLowerCase();
  if (!DIGEST.test(digest)) throw new TypeError(`${field} must be a sha256 digest`);
  return digest;
}
function uploadRef(value) {
  const ref = nonEmptyString(value, "uploadRef", 128);
  if (!UPLOAD_REF.test(ref)) throw new TypeError("uploadRef must be an opaque upload reference");
  return ref;
}
function isSameOrWithin(root, candidate) {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}
function ensureDisjoint(left, right) {
  if (isSameOrWithin(left, right) || isSameOrWithin(right, left)) throw new Error("CAS object and staging roots must be disjoint");
}
async function exists(value) {
  try { return await stat(value); } catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
}
function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
async function hashFile(filePath, expectedSize) {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  let offset = 0;
  try {
    for (;;) {
      const buffer = Buffer.alloc(Math.min(MAX_READ_BYTES, Math.max(1, expectedSize - offset)));
      const result = await handle.read(buffer, 0, buffer.length, offset);
      if (result.bytesRead === 0) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
      if (offset > expectedSize) throw new Error("CAS object grew while it was verified");
    }
  } finally { await handle.close(); }
  if (offset !== expectedSize) throw new Error("CAS object size changed while it was verified");
  return `sha256:${hash.digest("hex")}`;
}

export class ArtifactContentAddressedStore {
  constructor({ objectRoot, stagingRoot, maxObjectBytes = DEFAULT_MAX_OBJECT_BYTES } = {}) {
    this.objectRoot = resolve(nonEmptyString(objectRoot, "objectRoot", 4_096));
    this.stagingRoot = resolve(nonEmptyString(stagingRoot, "stagingRoot", 4_096));
    ensureDisjoint(this.objectRoot, this.stagingRoot);
    this.maxObjectBytes = safeInteger(maxObjectBytes, "maxObjectBytes", 1, DEFAULT_MAX_OBJECT_BYTES);
    this.uploads = new Map();
    this.ready = false;
  }

  toJSON() {
    return { version: 1, ready: this.ready, activeUploadCount: this.uploads.size, maxObjectBytes: this.maxObjectBytes };
  }

  async initialize() {
    await mkdir(this.objectRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    this.objectRoot = await realpath(this.objectRoot);
    this.stagingRoot = await realpath(this.stagingRoot);
    ensureDisjoint(this.objectRoot, this.stagingRoot);
    this.ready = true;
    return this.toJSON();
  }

  async beginUpload({ uploadRef: inputRef, expectedDigest, expectedSize } = {}) {
    this.#requireReady();
    const ref = uploadRef(inputRef);
    const digest = digestRef(expectedDigest, "expectedDigest");
    const size = safeInteger(expectedSize, "expectedSize", 0, this.maxObjectBytes);
    if (this.uploads.has(ref)) {
      const current = this.uploads.get(ref);
      if (current.expectedDigest === digest && current.expectedSize === size) return Object.freeze({ uploadRef: ref, offset: current.offset, resumed: true });
      throw new Error("uploadRef is already bound to another object");
    }
    const final = this.#objectPath(digest);
    const present = await exists(final);
    if (present !== undefined) {
      if (!present.isFile() || present.size !== size || await hashFile(final, size) !== digest) throw new Error("existing CAS object metadata is inconsistent");
      return Object.freeze({ uploadRef: ref, offset: size, complete: true, digest, size });
    }
    const temporary = resolve(this.stagingRoot, `${ref}.${randomUUID()}.part`);
    if (!isSameOrWithin(this.stagingRoot, temporary)) throw new Error("upload staging path escapes its root");
    const handle = await open(temporary, "wx", 0o600);
    this.uploads.set(ref, { uploadRef: ref, expectedDigest: digest, expectedSize: size, offset: 0, hash: createHash("sha256"), handle, temporary });
    return Object.freeze({ uploadRef: ref, offset: 0, resumed: false });
  }

  async appendChunk({ uploadRef: inputRef, offset, bytes, chunkDigest } = {}) {
    this.#requireReady();
    const ref = uploadRef(inputRef);
    const upload = this.uploads.get(ref);
    if (upload === undefined) throw new Error("upload is not active");
    const expectedOffset = safeInteger(offset, "offset", 0, upload.expectedSize);
    if (expectedOffset !== upload.offset) throw new Error("upload chunk offset is stale or out of order");
    if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError("upload chunk bytes must be a Buffer or Uint8Array");
    const chunk = Buffer.from(bytes);
    if (chunk.length < 1 || chunk.length > MAX_CHUNK_BYTES || upload.offset + chunk.length > upload.expectedSize) throw new RangeError("upload chunk size exceeds its bound");
    if (digestRef(chunkDigest, "chunkDigest") !== hashBytes(chunk)) throw new Error("upload chunk digest is invalid");
    await upload.handle.write(chunk, 0, chunk.length, upload.offset);
    upload.hash.update(chunk);
    upload.offset += chunk.length;
    return Object.freeze({ uploadRef: ref, offset: upload.offset, remaining: upload.expectedSize - upload.offset });
  }

  async finalizeUpload(inputRef) {
    this.#requireReady();
    const ref = uploadRef(inputRef);
    const upload = this.uploads.get(ref);
    if (upload === undefined) throw new Error("upload is not active");
    this.uploads.delete(ref);
    try {
      if (upload.offset !== upload.expectedSize) throw new Error("upload is incomplete");
      const actualDigest = `sha256:${upload.hash.digest("hex")}`;
      if (actualDigest !== upload.expectedDigest) throw new Error("uploaded object digest does not match its declaration");
      await upload.handle.sync();
      await upload.handle.close();
      upload.handle = undefined;
      const target = this.#objectPath(actualDigest);
      const targetDirectory = resolve(target, "..");
      await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
      const realTargetDirectory = await realpath(targetDirectory);
      if (!isSameOrWithin(this.objectRoot, realTargetDirectory)) throw new Error("CAS object directory escapes its root");
      const current = await exists(target);
      if (current === undefined) {
        try { await rename(upload.temporary, target); }
        catch (error) {
          if (error?.code !== "EEXIST" && error?.code !== "EPERM") throw error;
        }
      }
      const stored = await exists(target);
      if (stored === undefined || !stored.isFile() || stored.size !== upload.expectedSize || await hashFile(target, stored.size) !== actualDigest) throw new Error("CAS object publication did not produce the expected immutable file");
      let directoryHandle;
      try { directoryHandle = await open(realTargetDirectory, "r"); await directoryHandle.sync(); } catch {} finally { await directoryHandle?.close().catch(() => undefined); }
      await rm(upload.temporary, { force: true });
      return Object.freeze({ digest: actualDigest, size: upload.expectedSize, stored: true });
    } catch (error) {
      await upload.handle?.close().catch(() => undefined);
      await rm(upload.temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async abortUpload(inputRef) {
    const ref = uploadRef(inputRef);
    const upload = this.uploads.get(ref);
    if (upload === undefined) return Object.freeze({ uploadRef: ref, aborted: false });
    this.uploads.delete(ref);
    await upload.handle.close().catch(() => undefined);
    await rm(upload.temporary, { force: true }).catch(() => undefined);
    return Object.freeze({ uploadRef: ref, aborted: true });
  }

  async inspect(inputDigest) {
    this.#requireReady();
    const digest = digestRef(inputDigest);
    const objectPath = this.#objectPath(digest);
    const metadata = await exists(objectPath);
    if (!metadata?.isFile()) return Object.freeze({ digest, size: 0, present: false });
    if (await hashFile(objectPath, metadata.size) !== digest) throw new Error("CAS object integrity verification failed");
    return Object.freeze({ digest, size: metadata.size, present: true });
  }

  async readChunk({ digest: inputDigest, offset = 0, length = MAX_READ_BYTES } = {}) {
    this.#requireReady();
    const digest = digestRef(inputDigest);
    const metadata = await exists(this.#objectPath(digest));
    if (metadata === undefined || !metadata.isFile()) throw new Error("CAS object is unavailable");
    const start = safeInteger(offset, "offset", 0, metadata.size);
    const count = safeInteger(length, "length", 1, MAX_READ_BYTES);
    const size = Math.min(count, metadata.size - start);
    const handle = await open(this.#objectPath(digest), "r");
    try {
      const buffer = Buffer.alloc(size);
      const result = await handle.read(buffer, 0, size, start);
      return Object.freeze({ digest, offset: start, bytes: buffer.subarray(0, result.bytesRead), eof: start + result.bytesRead >= metadata.size, size: metadata.size });
    } finally { await handle.close(); }
  }

  async close() {
    const refs = [...this.uploads.keys()];
    for (const ref of refs) await this.abortUpload(ref);
    this.ready = false;
  }

  #objectPath(inputDigest) {
    const digest = digestRef(inputDigest);
    const hex = DIGEST.exec(digest)[1];
    const value = resolve(this.objectRoot, "sha256", hex.slice(0, 2), hex);
    if (!isSameOrWithin(this.objectRoot, value)) throw new Error("CAS object path escapes its root");
    return value;
  }

  #requireReady() {
    if (!this.ready) throw new Error("Artifact CAS is not initialized");
  }
}

export {
  DEFAULT_MAX_OBJECT_BYTES,
  DIGEST,
  MAX_CHUNK_BYTES,
  MAX_READ_BYTES,
};
