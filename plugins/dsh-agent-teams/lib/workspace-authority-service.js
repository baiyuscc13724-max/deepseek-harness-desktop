import { EncryptedAuthorityStateStore } from "./project-state-store.js";
import { GitWorkspaceAdapter } from "./git-workspace-adapter.js";
import { WorkspaceAuthority } from "./workspace-authority.js";

const SERVICE_STATE_VERSION = 1;
const MUTATING_METHODS = new Set(["openWorkspace", "closeWorkspace", "claimResources", "publishChangeSet", "enqueueChangeSet", "planMergeGroup", "recordMergeResult", "recordArtifactSet", "advanceAuthorityEpoch"]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function assertAllowedKeys(value, allowed, field) {
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) throw new TypeError(`${field} contains unsupported fields: ${extras.join(", ")}`);
}
function readyState(authority) {
  return {
    version: SERVICE_STATE_VERSION,
    stateKind: "persisted-workspace-authority",
    projectRef: authority.projectRef,
    repositoryRef: authority.repositoryRef,
    phase: "ready",
    authorityState: authority.exportHostState(),
  };
}
function pendingState(currentAuthority, finalAuthority, mergeGroup) {
  return {
    version: SERVICE_STATE_VERSION,
    stateKind: "persisted-workspace-authority",
    projectRef: currentAuthority.projectRef,
    repositoryRef: currentAuthority.repositoryRef,
    phase: "landing_pending",
    authorityState: currentAuthority.exportHostState(),
    landing: {
      mergeGroupRef: mergeGroup.mergeGroupRef,
      baseHead: mergeGroup.baseHead,
      resultCommit: mergeGroup.resultCommit,
      finalAuthorityState: finalAuthority.exportHostState(),
    },
  };
}
function normalizeServiceState(value) {
  if (!isRecord(value)) throw new TypeError("persisted Workspace Authority state must be an object");
  assertAllowedKeys(value, new Set(["version", "stateKind", "projectRef", "repositoryRef", "phase", "authorityState", "landing"]), "persisted Workspace Authority state");
  if (value.version !== SERVICE_STATE_VERSION || value.stateKind !== "persisted-workspace-authority") throw new TypeError("persisted Workspace Authority state version or kind is unsupported");
  const projectRef = nonEmptyString(value.projectRef, "state.projectRef", 128);
  const repositoryRef = nonEmptyString(value.repositoryRef, "state.repositoryRef", 128);
  if (!new Set(["ready", "landing_pending"]).has(value.phase) || !isRecord(value.authorityState)) throw new TypeError("persisted Workspace Authority phase or snapshot is invalid");
  if (value.authorityState.projectRef !== projectRef || value.authorityState.repositoryRef !== repositoryRef) throw new Error("persisted Workspace Authority snapshot scope is invalid");
  if (value.phase === "ready") {
    if (value.landing !== undefined) throw new Error("ready Workspace Authority state cannot contain a landing journal");
    return { projectRef, repositoryRef, phase: "ready", authorityState: value.authorityState };
  }
  if (!isRecord(value.landing)) throw new TypeError("pending Workspace Authority state requires a landing journal");
  assertAllowedKeys(value.landing, new Set(["mergeGroupRef", "baseHead", "resultCommit", "finalAuthorityState"]), "landing journal");
  const mergeGroupRef = nonEmptyString(value.landing.mergeGroupRef, "landing.mergeGroupRef", 128);
  const baseHead = nonEmptyString(value.landing.baseHead, "landing.baseHead", 64);
  const resultCommit = nonEmptyString(value.landing.resultCommit, "landing.resultCommit", 64);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseHead) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(resultCommit) || !isRecord(value.landing.finalAuthorityState)) throw new TypeError("landing journal bindings are invalid");
  if (value.landing.finalAuthorityState.projectRef !== projectRef || value.landing.finalAuthorityState.repositoryRef !== repositoryRef || value.landing.finalAuthorityState.headCommit !== resultCommit) throw new Error("landing journal final snapshot binding is invalid");
  if (value.authorityState.headCommit !== baseHead) throw new Error("landing journal base snapshot binding is invalid");
  return { projectRef, repositoryRef, phase: "landing_pending", authorityState: value.authorityState, landing: { mergeGroupRef, baseHead, resultCommit, finalAuthorityState: value.landing.finalAuthorityState } };
}
function verifyExpected(authority, expected = {}) {
  for (const field of ["projectRef", "repositoryRef", "authorityRoot", "sourceWorkspaceRoot", "workspaceRoot"]) {
    if (expected[field] !== undefined && authority[field] !== expected[field]) throw new Error(`restored Workspace Authority ${field} does not match the configured project`);
  }
}

export class PersistedWorkspaceAuthority {
  constructor({ store, gitAdapter, authority, revision, phase = "ready" } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(gitAdapter instanceof GitWorkspaceAdapter)) throw new TypeError("gitAdapter must be a GitWorkspaceAdapter");
    if (!(authority instanceof WorkspaceAuthority)) throw new TypeError("authority must be a WorkspaceAuthority");
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("revision must be a positive safe integer");
    this.store = store;
    this.gitAdapter = gitAdapter;
    this.authority = authority;
    this.revision = revision;
    this.phase = phase;
    this.operationTail = Promise.resolve();
    this.closing = false;
    this.closePromise = undefined;
  }

  static async create({ store, gitAdapter, authority } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(gitAdapter instanceof GitWorkspaceAdapter)) throw new TypeError("gitAdapter must be a GitWorkspaceAdapter");
    if (!(authority instanceof WorkspaceAuthority)) throw new TypeError("authority must be a WorkspaceAuthority");
    const existing = await store.load();
    if (existing !== undefined) throw new Error("persisted Workspace Authority already exists");
    if (store.projectRef !== authority.projectRef || gitAdapter.repositoryRef !== authority.repositoryRef) throw new Error("Workspace Authority persistence scope is inconsistent");
    if (await gitAdapter.head() !== authority.headCommit) throw new Error("bare Git authority head does not match the new Workspace Authority");
    const saved = await store.save(readyState(authority), { expectedRevision: 0 });
    return new PersistedWorkspaceAuthority({ store, gitAdapter, authority, revision: saved.revision });
  }

  static async open({ store, gitAdapter, now = Date.now, verifyGateReceipt = () => false, expected = {} } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(gitAdapter instanceof GitWorkspaceAdapter)) throw new TypeError("gitAdapter must be a GitWorkspaceAdapter");
    const loaded = await store.load();
    if (loaded === undefined) throw new Error("persisted Workspace Authority does not exist");
    const state = normalizeServiceState(loaded.state);
    if (state.projectRef !== store.projectRef || state.repositoryRef !== gitAdapter.repositoryRef) throw new Error("persisted Workspace Authority service scope is inconsistent");
    const restoreOptions = { now, verifyGateReceipt };
    let authority = WorkspaceAuthority.restore(state.authorityState, restoreOptions);
    verifyExpected(authority, expected);
    let revision = loaded.revision;
    let phase = state.phase;
    if (state.phase === "landing_pending") {
      const finalAuthority = WorkspaceAuthority.restore(state.landing.finalAuthorityState, restoreOptions);
      verifyExpected(finalAuthority, expected);
      const gitHead = await gitAdapter.head();
      if (gitHead === state.landing.baseHead) {
        await gitAdapter.compareAndSwapHead({ mergeGroupRef: state.landing.mergeGroupRef, expectedHead: state.landing.baseHead, resultCommit: state.landing.resultCommit });
      } else if (gitHead !== state.landing.resultCommit) {
        const error = new Error("pending Workspace Authority landing conflicts with the bare Git head");
        error.code = "WORKSPACE_RECOVERY_CONFLICT";
        throw error;
      }
      const saved = await store.save(readyState(finalAuthority), { expectedRevision: revision });
      authority = finalAuthority;
      revision = saved.revision;
      phase = "ready";
    } else if (await gitAdapter.head() !== authority.headCommit) {
      throw new Error("persisted Workspace Authority head diverges from bare Git");
    }
    return new PersistedWorkspaceAuthority({ store, gitAdapter, authority, revision, phase });
  }

  toJSON() { return this.#snapshot(); }

  readStatus() { this.#assertOpen(); return this.#snapshot(); }

  mutate(method, input) {
    try { this.#assertOpen(); } catch (error) { return Promise.reject(error); }
    const name = nonEmptyString(method, "method", 64);
    if (!MUTATING_METHODS.has(name)) throw new Error(`Workspace Authority mutation method ${name} is not allowed`);
    return this.#queue(async () => {
      this.#requireReady();
      const working = WorkspaceAuthority.restore(this.authority.exportHostState(), { now: this.authority.now, verifyGateReceipt: this.authority.verifyGateReceipt });
      const result = working[name](input);
      const saved = await this.store.save(readyState(working), { expectedRevision: this.revision });
      this.authority = working;
      this.revision = saved.revision;
      return { result, revision: this.revision };
    });
  }

  landMergeGroup(input) {
    return this.#queue(async () => {
      this.#requireReady();
      const working = WorkspaceAuthority.restore(this.authority.exportHostState(), { now: this.authority.now, verifyGateReceipt: this.authority.verifyGateReceipt });
      const result = working.landMergeGroup(input);
      const group = result.mergeGroup;
      const pending = pendingState(this.authority, working, group);
      const journal = await this.store.save(pending, { expectedRevision: this.revision });
      this.revision = journal.revision;
      this.phase = "landing_pending";
      try {
        const currentGitHead = await this.gitAdapter.head();
        if (currentGitHead === group.baseHead) await this.gitAdapter.compareAndSwapHead({ mergeGroupRef: group.mergeGroupRef, expectedHead: group.baseHead, resultCommit: group.resultCommit });
        else if (currentGitHead !== group.resultCommit) {
          const conflict = new Error("bare Git head conflicts with the pending Workspace Authority landing");
          conflict.code = "AUTHORITY_HEAD_CONFLICT";
          throw conflict;
        }
        const saved = await this.store.save(readyState(working), { expectedRevision: this.revision });
        this.authority = working;
        this.revision = saved.revision;
        this.phase = "ready";
        return { result, revision: this.revision };
      } catch (error) {
        const failure = new Error("Workspace Authority landing requires persisted recovery");
        failure.code = "WORKSPACE_LANDING_PENDING";
        failure.cause = error;
        throw failure;
      }
    });
  }

  refresh() {
    return this.#queue(async () => {
      this.#requireReady();
      const loaded = await this.store.load();
      if (loaded === undefined) throw new Error("persisted Workspace Authority disappeared");
      if (loaded.revision < this.revision) throw new Error("persisted Workspace Authority rollback was detected");
      if (loaded.revision === this.revision) return this.#snapshot();
      const state = normalizeServiceState(loaded.state);
      if (state.phase !== "ready") throw new Error("persisted Workspace Authority requires landing recovery by reopening the service");
      const authority = WorkspaceAuthority.restore(state.authorityState, { now: this.authority.now, verifyGateReceipt: this.authority.verifyGateReceipt });
      if (await this.gitAdapter.head() !== authority.headCommit) throw new Error("persisted Workspace Authority head diverges from bare Git");
      this.authority = authority;
      this.revision = loaded.revision;
      return this.#snapshot();
    });
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = this.operationTail.then(() => this.store.close());
    return this.closePromise;
  }

  #snapshot() { return { ...this.authority.status(), persistedRevision: this.revision, persistencePhase: this.phase }; }
  #assertOpen() { if (this.closing) { const error = new Error("Workspace Authority service is closed"); error.code = "WORKSPACE_AUTHORITY_CLOSED"; throw error; } }

  #requireReady() {
    if (this.phase !== "ready") throw new Error("Workspace Authority is waiting for landing recovery");
  }

  #queue(operation) {
    try { this.#assertOpen(); } catch (error) { return Promise.reject(error); }
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export {
  MUTATING_METHODS,
  SERVICE_STATE_VERSION,
};
