import { createHash } from "node:crypto";
import { EncryptedAuthorityStateStore } from "./project-state-store.js";
import { ExternalDefectConnector } from "./external-defect-connectors.js";

const OUTBOX_VERSION = 1;
const MAX_QUEUE_RECORDS = 10_000;

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function nonEmptyString(value, field, max = 2_000) {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) throw new TypeError(`${field} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function queueRef(kind, payload) { return `outbox_${createHash("sha256").update(`${kind}\u0000${canonicalJson(payload)}`).digest("base64url")}`; }
function immutable(value) {
  if (Array.isArray(value)) for (const item of value) immutable(item);
  else if (isRecord(value)) for (const nested of Object.values(value)) immutable(nested);
  return Object.freeze(value);
}
function persistedState(connector, pending, completed, paused, pauseEpoch) {
  return { version: OUTBOX_VERSION, stateKind: "external-defect-outbox", projectRef: connector.projectRef, repositoryRef: connector.repositoryRef, connectorRef: connector.connectorRef, connectorState: connector.exportHostState(), paused, pauseEpoch, pending, completed };
}
function normalizeState(value) {
  if (!isRecord(value) || value.version !== OUTBOX_VERSION || value.stateKind !== "external-defect-outbox" || !Array.isArray(value.pending) || !Array.isArray(value.completed) || value.pending.length > MAX_QUEUE_RECORDS || value.completed.length > MAX_QUEUE_RECORDS || !isRecord(value.connectorState)) throw new TypeError("persisted external defect outbox is invalid");
  const refs = new Set();
  const pending = value.pending.map((record) => {
    if (!isRecord(record) || !new Set(["defect", "release_observation"]).has(record.kind) || !isRecord(record.payload)) throw new TypeError("persisted external defect outbox record is invalid");
    const ref = nonEmptyString(record.queueRef, "record.queueRef", 128);
    if (ref !== queueRef(record.kind, record.payload) || refs.has(ref)) throw new Error("persisted external defect outbox reference is invalid");
    refs.add(ref);
    return { queueRef: ref, kind: record.kind, payload: record.payload, queuedAt: Number.isSafeInteger(record.queuedAt) ? record.queuedAt : 0 };
  });
  const completed = value.completed.map((record) => {
    if (!isRecord(record)) throw new TypeError("persisted completed outbox record is invalid");
    const ref = nonEmptyString(record.queueRef, "completed.queueRef", 128);
    const kind = nonEmptyString(record.kind, "completed.kind", 64);
    if (!/^outbox_[A-Za-z0-9_-]{20,}$/u.test(ref) || refs.has(ref) || !new Set(["defect", "release_observation"]).has(kind)) throw new Error("persisted completed outbox reference is invalid");
    refs.add(ref);
    return { queueRef: ref, kind, completedAt: Number.isSafeInteger(record.completedAt) ? record.completedAt : 0 };
  });
  if (typeof value.paused !== "boolean" || !Number.isSafeInteger(value.pauseEpoch) || value.pauseEpoch < 0) throw new TypeError("persisted external defect outbox pause state is invalid");
  return { projectRef: nonEmptyString(value.projectRef, "state.projectRef", 128), repositoryRef: nonEmptyString(value.repositoryRef, "state.repositoryRef", 128), connectorRef: nonEmptyString(value.connectorRef, "state.connectorRef", 128), connectorState: value.connectorState, paused: value.paused, pauseEpoch: value.pauseEpoch, pending, completed };
}

export class PersistedExternalDefectOutbox {
  #credentialProvider;
  #webhookSecretProvider;
  #request;

  constructor({ store, connector, pending = [], completed = [], paused = false, pauseEpoch = 0, revision, credentialProvider, webhookSecretProvider, request, now = Date.now } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store must be an EncryptedAuthorityStateStore");
    if (!(connector instanceof ExternalDefectConnector)) throw new TypeError("connector must be an ExternalDefectConnector");
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("revision must be a positive safe integer");
    if (typeof paused !== "boolean" || !Number.isSafeInteger(pauseEpoch) || pauseEpoch < 0) throw new TypeError("pause state is invalid");
    if (typeof credentialProvider !== "function" || typeof webhookSecretProvider !== "function" || typeof request !== "function" || typeof now !== "function") throw new TypeError("outbox callbacks must be functions");
    this.store = store;
    this.connector = connector;
    this.pending = pending;
    this.completed = completed;
    this.paused = paused;
    this.pauseEpoch = pauseEpoch;
    this.revision = revision;
    this.now = now;
    this.#credentialProvider = credentialProvider;
    this.#webhookSecretProvider = webhookSecretProvider;
    this.#request = request;
    this.operationTail = Promise.resolve();
    this.closing = false;
    this.closePromise = undefined;
  }

  static async create({ store, connector, credentialProvider, webhookSecretProvider, request, now = Date.now } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore) || !(connector instanceof ExternalDefectConnector)) throw new TypeError("store and connector are required");
    if (store.projectRef !== connector.projectRef || await store.load() !== undefined) throw new Error("external defect outbox scope is inconsistent or already exists");
    const saved = await store.save(persistedState(connector, [], [], false, 0), { expectedRevision: 0 });
    return new PersistedExternalDefectOutbox({ store, connector, revision: saved.revision, credentialProvider, webhookSecretProvider, request, now });
  }

  static async open({ store, credentialProvider, webhookSecretProvider, request, now = Date.now } = {}) {
    if (!(store instanceof EncryptedAuthorityStateStore)) throw new TypeError("store is required");
    const loaded = await store.load();
    if (loaded === undefined) throw new Error("persisted external defect outbox does not exist");
    const state = normalizeState(loaded.state);
    const connector = ExternalDefectConnector.restore(state.connectorState, { credentialProvider, webhookSecretProvider, request });
    if (state.projectRef !== store.projectRef || connector.projectRef !== state.projectRef || connector.repositoryRef !== state.repositoryRef || connector.connectorRef !== state.connectorRef) throw new Error("persisted external defect outbox scope is inconsistent");
    return new PersistedExternalDefectOutbox({ store, connector, pending: state.pending, completed: state.completed, paused: state.paused, pauseEpoch: state.pauseEpoch, revision: loaded.revision, credentialProvider, webhookSecretProvider, request, now });
  }

  toJSON() { return this.#snapshot(); }

  enqueueDefect(defect) {
    return this.#queue(async () => {
      const operation = this.connector.prepareDefectSync(defect);
      return this.#enqueue("defect", operation);
    });
  }

  enqueueReleaseObservation({ defectRef, releaseObservation } = {}) {
    return this.#queue(async () => {
      const ref = nonEmptyString(defectRef, "defectRef", 128);
      if (!isRecord(releaseObservation) || releaseObservation.defectRef !== ref || !/^releaseobservation_[A-Za-z0-9_-]{6,}$/u.test(releaseObservation.releaseObservationRef ?? "") || !new Set(["clean", "recurred"]).has(releaseObservation.outcome)) throw new TypeError("releaseObservation is invalid or belongs to another defect");
      const payload = { defectRef: ref, releaseObservation };
      return this.#enqueue("release_observation", payload);
    });
  }

  deliverNext() {
    return this.#queue(async () => {
      if (this.paused) return undefined;
      const record = this.pending[0];
      if (record === undefined) return undefined;
      const working = this.#cloneConnector();
      const result = record.kind === "defect" ? await working.deliverDefect(record.payload) : await working.publishReleaseObservation(record.payload);
      const pending = this.pending.slice(1);
      const completed = [...this.completed, { queueRef: record.queueRef, kind: record.kind, completedAt: this.now() }].slice(-MAX_QUEUE_RECORDS);
      const saved = await this.store.save(persistedState(working, pending, completed, this.paused, this.pauseEpoch), { expectedRevision: this.revision });
      this.connector = working;
      this.pending = pending;
      this.completed = completed;
      this.revision = saved.revision;
      return immutable({ queueRef: record.queueRef, result, revision: this.revision });
    });
  }

  pause() {
    return this.#queue(async () => {
      if (this.paused) return this.#snapshot();
      const pauseEpoch = this.pauseEpoch + 1;
      const saved = await this.store.save(persistedState(this.connector, this.pending, this.completed, true, pauseEpoch), { expectedRevision: this.revision });
      this.paused = true;
      this.pauseEpoch = pauseEpoch;
      this.revision = saved.revision;
      return this.#snapshot();
    });
  }

  resume() {
    return this.#queue(async () => {
      if (!this.paused) return this.#snapshot();
      const saved = await this.store.save(persistedState(this.connector, this.pending, this.completed, false, this.pauseEpoch), { expectedRevision: this.revision });
      this.paused = false;
      this.revision = saved.revision;
      return this.#snapshot();
    });
  }

  acceptWebhook(input) {
    return this.#queue(async () => {
      const working = this.#cloneConnector();
      const result = await working.acceptWebhook(input);
      const saved = await this.store.save(persistedState(working, this.pending, this.completed, this.paused, this.pauseEpoch), { expectedRevision: this.revision });
      this.connector = working;
      this.revision = saved.revision;
      return immutable({ result: { ...result, deferred: this.paused }, revision: this.revision });
    });
  }

  #enqueue(kind, payload) {
    const ref = queueRef(kind, payload);
    if (this.pending.some((record) => record.queueRef === ref) || this.completed.some((record) => record.queueRef === ref)) return Promise.resolve(immutable({ queueRef: ref, duplicate: true, revision: this.revision }));
    if (this.pending.length >= MAX_QUEUE_RECORDS) throw new Error("external defect outbox is full");
    const pending = [...this.pending, { queueRef: ref, kind, payload, queuedAt: this.now() }];
    return this.store.save(persistedState(this.connector, pending, this.completed, this.paused, this.pauseEpoch), { expectedRevision: this.revision }).then((saved) => {
      this.pending = pending;
      this.revision = saved.revision;
      return immutable({ queueRef: ref, duplicate: false, revision: this.revision });
    });
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = this.operationTail.then(() => this.store.close());
    return this.closePromise;
  }

  #snapshot() { return { version: OUTBOX_VERSION, connector: this.connector.toJSON(), paused: this.paused, pauseEpoch: this.pauseEpoch, pendingCount: this.pending.length, completedCount: this.completed.length, persistedRevision: this.revision }; }
  #assertOpen() { if (this.closing) { const error = new Error("External Defect Outbox is closed"); error.code = "EXTERNAL_DEFECT_OUTBOX_CLOSED"; throw error; } }

  #cloneConnector() {
    return ExternalDefectConnector.restore(this.connector.exportHostState(), { credentialProvider: this.#credentialProvider, webhookSecretProvider: this.#webhookSecretProvider, request: this.#request });
  }

  #queue(operation) {
    try { this.#assertOpen(); } catch (error) { return Promise.reject(error); }
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export { MAX_QUEUE_RECORDS, OUTBOX_VERSION };
