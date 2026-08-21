import { EncryptedAuthorityStateStore } from "./project-state-store.js";
import { DefectLifecycle } from "./defect-lifecycle.js";

const MUTATING_METHODS = new Set(["recordSignal", "recordOccurrence", "triageOccurrence", "assignDefect", "linkFix", "recordVerification", "recordReleaseObservation", "closeDefect"]);
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

export class PersistedDefectLifecycle {
  constructor({ store, lifecycle, revision, resolveAttestation } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(lifecycle instanceof DefectLifecycle)) throw new TypeError("lifecycle must be a DefectLifecycle");
    if (!Number.isSafeInteger(revision) || revision < 1 || typeof resolveAttestation !== "function") throw new TypeError("revision and resolveAttestation are required");
    this.store = store;
    this.lifecycle = lifecycle;
    this.revision = revision;
    this.resolveAttestation = resolveAttestation;
    this.operationTail = Promise.resolve();
  }

  static async create({ store, lifecycle, resolveAttestation } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore) || !(lifecycle instanceof DefectLifecycle)) throw new TypeError("store and lifecycle are required");
    if (store.projectRef !== lifecycle.projectRef || await store.load() !== undefined) throw new Error("Defect Lifecycle persistence scope is inconsistent or already exists");
    const saved = await store.save(lifecycle.exportHostState(), { expectedRevision: 0 });
    return new PersistedDefectLifecycle({ store, lifecycle, revision: saved.revision, resolveAttestation });
  }

  static async open({ store, resolveAttestation, now = Date.now, expectedRepositoryRef } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore) || typeof resolveAttestation !== "function") throw new TypeError("store and resolveAttestation are required");
    const loaded = await store.load();
    if (loaded === undefined) throw new Error("persisted Defect Lifecycle does not exist");
    const lifecycle = DefectLifecycle.restore(loaded.state, { resolveAttestation, now });
    if (lifecycle.projectRef !== store.projectRef || (expectedRepositoryRef !== undefined && lifecycle.repositoryRef !== expectedRepositoryRef)) throw new Error("persisted Defect Lifecycle scope is inconsistent");
    return new PersistedDefectLifecycle({ store, lifecycle, revision: loaded.revision, resolveAttestation });
  }

  toJSON() { return { ...this.lifecycle.toJSON(), persistedRevision: this.revision }; }

  mutate(method, input) {
    const name = nonEmptyString(method, "method", 64);
    if (!MUTATING_METHODS.has(name)) throw new Error(`Defect Lifecycle mutation method ${name} is not allowed`);
    return this.#queue(async () => {
      const working = DefectLifecycle.restore(this.lifecycle.exportHostState(), { resolveAttestation: this.resolveAttestation, now: this.lifecycle.now });
      const result = working[name](input);
      const saved = await this.store.save(working.exportHostState(), { expectedRevision: this.revision });
      this.lifecycle = working;
      this.revision = saved.revision;
      return { result, revision: this.revision };
    });
  }

  refresh() {
    return this.#queue(async () => {
      const loaded = await this.store.load();
      if (loaded === undefined) throw new Error("persisted Defect Lifecycle disappeared");
      if (loaded.revision < this.revision) throw new Error("persisted Defect Lifecycle rollback was detected");
      if (loaded.revision === this.revision) return this.toJSON();
      const lifecycle = DefectLifecycle.restore(loaded.state, { resolveAttestation: this.resolveAttestation, now: this.lifecycle.now });
      if (lifecycle.projectRef !== this.lifecycle.projectRef || lifecycle.repositoryRef !== this.lifecycle.repositoryRef) throw new Error("persisted Defect Lifecycle scope changed");
      this.lifecycle = lifecycle;
      this.revision = loaded.revision;
      return this.toJSON();
    });
  }

  getDefect(defectRef) { return this.lifecycle.getDefect(defectRef); }

  #queue(operation) {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export { MUTATING_METHODS };
