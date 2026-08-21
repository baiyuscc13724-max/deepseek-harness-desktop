import { EncryptedAuthorityStateStore } from "./project-state-store.js";
import { TestOrchestrator } from "./test-orchestrator.js";

const MUTATING_METHODS = new Set(["registerTemplate", "disableTemplate", "startCampaign", "claimJob", "heartbeat", "completeJob", "reportInfrastructureFailure", "cancelCampaign", "pauseProject", "resumeProject", "sweep"]);

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}

export class PersistedTestOrchestrator {
  constructor({ store, orchestrator, revision } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(orchestrator instanceof TestOrchestrator)) throw new TypeError("orchestrator must be a TestOrchestrator");
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("revision must be a positive safe integer");
    this.store = store;
    this.orchestrator = orchestrator;
    this.revision = revision;
    this.operationTail = Promise.resolve();
  }

  static async create({ store, orchestrator } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(orchestrator instanceof TestOrchestrator)) throw new TypeError("orchestrator must be a TestOrchestrator");
    if (store.projectRef !== orchestrator.projectRef) throw new Error("Test Orchestrator persistence scope is inconsistent");
    if (await store.load() !== undefined) throw new Error("persisted Test Orchestrator already exists");
    const saved = await store.save(orchestrator.exportHostState(), { expectedRevision: 0 });
    return new PersistedTestOrchestrator({ store, orchestrator, revision: saved.revision });
  }

  static async open({ store, now = Date.now, expectedRepositoryRef } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    const loaded = await store.load();
    if (loaded === undefined) throw new Error("persisted Test Orchestrator does not exist");
    const orchestrator = TestOrchestrator.restore(loaded.state, { now });
    if (orchestrator.projectRef !== store.projectRef || (expectedRepositoryRef !== undefined && orchestrator.repositoryRef !== expectedRepositoryRef)) throw new Error("persisted Test Orchestrator scope is inconsistent");
    const reconciledState = orchestrator.exportHostState();
    let revision = loaded.revision;
    if (canonicalJson(reconciledState) !== canonicalJson(loaded.state)) revision = (await store.save(reconciledState, { expectedRevision: loaded.revision })).revision;
    return new PersistedTestOrchestrator({ store, orchestrator, revision });
  }

  toJSON() {
    return { ...this.orchestrator.toJSON(), persistedRevision: this.revision };
  }

  mutate(method, input) {
    const name = nonEmptyString(method, "method", 64);
    if (!MUTATING_METHODS.has(name)) throw new Error(`Test Orchestrator mutation method ${name} is not allowed`);
    return this.#queue(async () => {
      const working = TestOrchestrator.restore(this.orchestrator.exportHostState(), { now: this.orchestrator.now });
      const result = working[name](input);
      const saved = await this.store.save(working.exportHostState(), { expectedRevision: this.revision });
      this.orchestrator = working;
      this.revision = saved.revision;
      return { result, revision: this.revision };
    });
  }

  refresh() {
    return this.#queue(async () => {
      const loaded = await this.store.load();
      if (loaded === undefined) throw new Error("persisted Test Orchestrator disappeared");
      if (loaded.revision < this.revision) throw new Error("persisted Test Orchestrator rollback was detected");
      if (loaded.revision === this.revision) return this.toJSON();
      const orchestrator = TestOrchestrator.restore(loaded.state, { now: this.orchestrator.now });
      if (orchestrator.projectRef !== this.orchestrator.projectRef || orchestrator.repositoryRef !== this.orchestrator.repositoryRef) throw new Error("persisted Test Orchestrator scope changed");
      this.orchestrator = orchestrator;
      this.revision = loaded.revision;
      return this.toJSON();
    });
  }

  campaignStatus(campaignRef) {
    return this.orchestrator.campaignStatus(campaignRef);
  }

  jobStatus(jobRef) {
    return this.orchestrator.jobStatus(jobRef);
  }

  #queue(operation) {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export { MUTATING_METHODS };
