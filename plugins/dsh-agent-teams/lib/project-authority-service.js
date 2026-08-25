import { ProjectCollaborationAuthority } from "./project-collaboration.js";
import { EncryptedProjectStateStore } from "./project-state-store.js";

const MUTATING_METHODS = new Set(["registerDevice", "renewGrant", "submitEvent", "revokeDevice", "rotateDeviceKey", "advanceAuthorityEpoch"]);
const READ_METHODS = new Set(["authorityPublicKeyPem", "listMembers", "nextEvent", "cursorAtEnd", "replay"]);

function nonEmptyString(value, field, max = 256) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

export class PersistedProjectAuthority {
  constructor(store, authority, revision) {
    if (!(store instanceof EncryptedProjectStateStore)) throw new TypeError("store must be an EncryptedProjectStateStore");
    if (!(authority instanceof ProjectCollaborationAuthority)) throw new TypeError("authority must be a ProjectCollaborationAuthority");
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("revision must be a positive safe integer");
    this.store = store;
    this.authority = authority;
    this.revision = revision;
    this.operationTail = Promise.resolve();
    this.closing = false;
    this.closed = false;
    this.closePromise = undefined;
  }

  static async create({ store, authority } = {}) {
    if (!(store instanceof EncryptedProjectStateStore)) throw new TypeError("store must be an EncryptedProjectStateStore");
    if (!(authority instanceof ProjectCollaborationAuthority)) throw new TypeError("authority must be a ProjectCollaborationAuthority");
    const existing = await store.load();
    if (existing !== undefined) throw new Error("project authority state already exists");
    if (authority.projectRef !== store.projectRef) throw new Error("new authority projectRef does not match its encrypted store");
    const saved = await store.save(authority, { expectedRevision: 0 });
    return new PersistedProjectAuthority(store, authority, saved.revision);
  }

  static async open({ store, now = Date.now } = {}) {
    if (!(store instanceof EncryptedProjectStateStore)) throw new TypeError("store must be an EncryptedProjectStateStore");
    const loaded = await store.load();
    if (loaded === undefined) throw new Error("project authority state does not exist");
    const authority = ProjectCollaborationAuthority.restore(loaded.state, { now });
    return new PersistedProjectAuthority(store, authority, loaded.revision);
  }

  toJSON() {
    return { ...this.authority.toJSON(), persistedRevision: this.revision };
  }

  read(method, input) {
    this.#assertOpen();
    const name = nonEmptyString(method, "method", 64);
    if (!READ_METHODS.has(name)) throw new Error(`project authority read method ${name} is not allowed`);
    return this.authority[name](input);
  }

  mutate(method, input) {
    this.#assertOpen();
    const name = nonEmptyString(method, "method", 64);
    if (!MUTATING_METHODS.has(name)) throw new Error(`project authority mutation method ${name} is not allowed`);
    return this.#queue(async () => {
      const working = ProjectCollaborationAuthority.restore(this.authority.exportHostState(), { now: this.authority.now });
      const result = working[name](input);
      const saved = await this.store.save(working, { expectedRevision: this.revision });
      this.authority = working;
      this.revision = saved.revision;
      return { result, revision: this.revision };
    });
  }

  refresh() {
    this.#assertOpen();
    return this.#queue(async () => {
      const loaded = await this.store.load();
      if (loaded === undefined) throw new Error("persisted project authority disappeared");
      if (loaded.revision < this.revision) throw new Error("persisted project authority rollback was detected");
      if (loaded.revision > this.revision) {
        this.authority = ProjectCollaborationAuthority.restore(loaded.state, { now: this.authority.now });
        this.revision = loaded.revision;
      }
      return this.toJSON();
    });
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = this.operationTail.then(
      () => this.store.close(),
      () => this.store.close(),
    ).then(() => { this.closed = true; });
    return this.closePromise;
  }

  #assertOpen() {
    if (!this.closing && !this.closed) return;
    const error = new Error("persisted project authority is closed");
    error.code = "PROJECT_AUTHORITY_CLOSED";
    throw error;
  }

  #queue(operation) {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export {
  MUTATING_METHODS,
  READ_METHODS,
};
